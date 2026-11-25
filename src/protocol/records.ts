/**
 * Table schema and record codec.
 *
 * The device describes its own storage in reply to GET_TABLE_SCHEMA:
 *
 *   user=1,UID=i1,Pin=s2,Name=B3,Password=s4,...
 *
 * Each column is `Name=<type><ordinal>`, where type is:
 *   i  integer, unsigned little-endian, 1-byte length prefix
 *   s  string,  1-byte length prefix
 *   B  bytes,   2-byte little-endian length prefix
 *
 * A READ_TABLE payload echoes `[tableId:u8][columnCount:u8][ordinal:u8]*` and
 * then packs rows back to back with no row separator. The length prefixes were
 * read off a live device: `Name=B3` on disk is `06 00 61 6c 69 63 65 31`
 * ("alice1", six bytes, length 0x0006), which is why binary columns need a
 * 16-bit length. Reading it as 8-bit desynchronises every later field.
 */

import type { TableDefinition } from './commands.ts';

const COLUMN_PATTERN = /^(.+?)=([isB])(\d+)$/;

export function parseSchema(text: string): TableDefinition[] {
  const tables: TableDefinition[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\0/g, '').trim();
    if (!line) continue;
    const [head, ...rest] = line.split(',');
    const headMatch = /^(.+)=(\d+)$/.exec(head ?? '');
    if (!headMatch) continue;
    const columns: string[] = [];
    const types: string[] = [];
    const ordinals: number[] = [];
    for (const part of rest) {
      const match = COLUMN_PATTERN.exec(part);
      if (!match) continue;
      columns.push(match[1]!);
      types.push(match[2]!);
      ordinals.push(Number(match[3]));
    }
    tables.push({ id: Number(headMatch[2]), name: headMatch[1]!, columns, types, ordinals });
  }
  return tables;
}

export type Row = Record<string, string | number | Buffer>;

export interface DecodeResult {
  tableId: number;
  columnIds: number[];
  rows: Row[];
}

function readUInt(value: Buffer): number {
  if (value.length === 0) return 0;
  if (value.length === 1) return value[0]!;
  if (value.length === 2) return value.readUInt16LE(0);
  if (value.length === 4) return value.readUInt32LE(0);
  if (value.length === 8) return Number(value.readBigUInt64LE(0));
  let n = 0;
  for (let i = value.length - 1; i >= 0; i -= 1) n = n * 256 + value[i]!;
  return n;
}

export function decodeRows(payload: Buffer, table: TableDefinition): DecodeResult {
  let offset = 0;
  const tableId = payload[offset++] ?? 0;
  const columnCount = payload[offset++] ?? 0;
  const columnIds: number[] = [];
  for (let i = 0; i < columnCount; i += 1) columnIds.push(payload[offset++] ?? 0);

  const byOrdinal = new Map<number, { name: string; type: string }>();
  for (let i = 0; i < table.columns.length; i += 1) {
    byOrdinal.set(table.ordinals[i]!, { name: table.columns[i]!, type: table.types[i]! });
  }

  const rows: Row[] = [];
  while (offset < payload.length) {
    const row: Row = {};
    let malformed = false;
    for (const columnId of columnIds) {
      const column = byOrdinal.get(columnId);
      if (!column) {
        malformed = true;
        break;
      }
      if (offset >= payload.length) {
        malformed = true;
        break;
      }
      let length: number;
      if (column.type === 'B') {
        if (offset + 2 > payload.length) {
          malformed = true;
          break;
        }
        length = payload.readUInt16LE(offset);
        offset += 2;
      } else {
        length = payload[offset]!;
        offset += 1;
      }
      if (offset + length > payload.length) {
        malformed = true;
        break;
      }
      const value = payload.subarray(offset, offset + length);
      offset += length;
      if (column.type === 'i') row[column.name] = readUInt(value);
      else if (column.type === 'B') row[column.name] = Buffer.from(value);
      else row[column.name] = value.toString('latin1');
    }
    if (malformed) break;
    rows.push(row);
  }
  return { tableId, columnIds, rows };
}

/** Inverse of the field encoding, used by write operations. */
export function encodeRow(
  row: Record<string, string | number | Buffer | null | undefined>,
  table: TableDefinition,
  columnIds: number[] = table.ordinals,
): Buffer {
  const byOrdinal = new Map<number, { name: string; type: string }>();
  for (let i = 0; i < table.columns.length; i += 1) {
    byOrdinal.set(table.ordinals[i]!, { name: table.columns[i]!, type: table.types[i]! });
  }

  const parts: Buffer[] = [];
  for (const columnId of columnIds) {
    const column = byOrdinal.get(columnId);
    if (!column) continue;
    const value = row[column.name];
    if (column.type === 'i') {
      const n = Number(value ?? 0);
      const bytes = n <= 0xff ? 1 : n <= 0xffff ? 2 : 4;
      const buf = Buffer.alloc(1 + bytes);
      buf[0] = bytes;
      buf.writeUIntLE(n, 1, bytes);
      parts.push(buf);
    } else if (column.type === 'B') {
      const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'latin1');
      const head = Buffer.alloc(2);
      head.writeUInt16LE(content.length, 0);
      parts.push(Buffer.concat([head, content]));
    } else {
      const content = Buffer.from(String(value ?? ''), 'latin1');
      if (content.length > 0xff) throw new Error(`string column ${column.name} exceeds 255 bytes`);
      parts.push(Buffer.concat([Buffer.from([content.length]), content]));
    }
  }
  return Buffer.concat(parts);
}
