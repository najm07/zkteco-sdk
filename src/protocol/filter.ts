/**
 * READ_TABLE filter encoding, reversed from the vendor shim on a live device.
 *
 * The vendor client sends, after `[tableId][columnCount][ordinal...]`:
 *
 *   00 01 02 01 31             filter `Pin=1`      (Pin is ordinal 2)
 *   00 01 02 02 31 32          filter `Pin=12`
 *   00 02 02 08 01 31 01 0e    filter `Pin=1<TAB>Pri=14`
 *
 * which is:
 *
 *   [reserved:00][conditionCount][ordinal × count][(length, value) × count]
 *
 * An empty filter is `00 00`. Conditions are joined by tabs and are ANDed. The
 * device accepts equality only; a filter containing an operator such as `>=`
 * was observed to make this firmware drop the connection, so anything other
 * than `Column=value` is rejected here rather than sent.
 *
 * Values are typed. A string column carries its text (`Pin=1` is `01 31`), but
 * an integer column carries the number in binary: `Pri=14` is `01 0e`, and
 * `Type=2` is `01 02`. Sending ASCII digits for an integer filter makes the
 * device match nothing, so the column type is consulted for every term.
 *
 * GET_RECORD_COUNT uses the same shape without the reserved byte:
 *
 *   01 00                      count all users
 *   01 01 02 05 36 35 30 30 30     count users with `Pin=65000`
 */

import type { TableDefinition } from './commands.ts';

export interface FilterCondition {
  column: string;
  ordinal: number;
  value: Buffer;
}

/** Longest value the 1-byte length prefix can describe. */
const MAX_CONDITIONS = 0xff;
const MAX_VALUE_BYTES = 0xff;

/**
 * Encode a filter value the way the device expects for that column's type.
 *
 * Integers are binary, not text: the captured `Pri=14` term was `01 0e`.
 */
function encodeValue(type: string, column: string, raw: string): Buffer {
  if (type !== 'i') return Buffer.from(raw, 'latin1');

  if (!/^\d+$/.test(raw)) {
    throw new Error(`filter value for integer column ${column} must be a non-negative integer`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n > 0xffffffff) {
    throw new Error(`filter value ${raw} for ${column} does not fit in 32 bits`);
  }
  const width = n <= 0xff ? 1 : n <= 0xffff ? 2 : 4;
  const buf = Buffer.alloc(width);
  buf.writeUIntLE(n, 0, width);
  return buf;
}

/**
 * Parse `Pin=1<TAB>Type=2` into conditions, validated against the table.
 *
 * Throws on anything the wire format cannot represent rather than truncating,
 * because a silently mangled filter reads the wrong rows.
 */
export function parseFilter(filter: string, table: TableDefinition): FilterCondition[] {
  if (!filter) return [];

  const conditions: FilterCondition[] = [];
  const used = new Set<number>();

  for (const part of filter.split('\t')) {
    const term = part.trim();
    if (!term) continue;

    const separator = term.indexOf('=');
    if (separator <= 0) {
      throw new Error(
        `filter term ${JSON.stringify(term)} is not Column=value; the device only supports equality`,
      );
    }

    const column = term.slice(0, separator).trim();
    const raw = term.slice(separator + 1);

    // Reject `Pin>=1`, `Pin!=1`, `Pin~1` and friends explicitly: this firmware
    // closes the connection on a filter it cannot parse.
    if (/[<>=!~^$*]/.test(column)) {
      throw new Error(`filter term ${JSON.stringify(term)} uses an operator other than equality`);
    }

    const index = table.columns.indexOf(column);
    if (index < 0) {
      throw new Error(
        `filter column ${JSON.stringify(column)} is not in table ${table.name} (${table.columns.join(', ')})`,
      );
    }

    const ordinal = table.ordinals[index]!;
    if (used.has(ordinal)) throw new Error(`filter column ${column} is repeated`);
    used.add(ordinal);

    const value = encodeValue(table.types[index]!, column, raw);
    if (value.length > MAX_VALUE_BYTES) {
      throw new Error(`filter value for ${column} exceeds ${MAX_VALUE_BYTES} bytes`);
    }

    conditions.push({ column, ordinal, value });
  }

  if (conditions.length > MAX_CONDITIONS) {
    throw new Error(`a filter may contain at most ${MAX_CONDITIONS} conditions`);
  }
  return conditions;
}

function valueBlock(conditions: FilterCondition[]): Buffer {
  return Buffer.concat(conditions.map((c) => Buffer.concat([Buffer.from([c.value.length]), c.value])));
}

/** Filter block for READ_TABLE, including its leading reserved byte. */
export function encodeFilter(filter: string, table: TableDefinition): Buffer {
  const conditions = parseFilter(filter, table);
  return Buffer.concat([
    Buffer.from([0x00, conditions.length]),
    Buffer.from(conditions.map((c) => c.ordinal)),
    valueBlock(conditions),
  ]);
}

/** Filter block for GET_RECORD_COUNT, which omits the reserved byte. */
export function encodeCountFilter(filter: string, table: TableDefinition): Buffer {
  const conditions = parseFilter(filter, table);
  return Buffer.concat([
    Buffer.from([conditions.length]),
    Buffer.from(conditions.map((c) => c.ordinal)),
    valueBlock(conditions),
  ]);
}
