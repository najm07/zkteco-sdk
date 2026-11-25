/**
 * High-level device client.
 *
 * Everything here was verified against a live uFace800 Plus
 * (firmware `Ver 6.60 Nov 21 2019`) unless a doc comment
 * says otherwise. No vendor DLL, COM registration, or 32-bit process is
 * involved.
 */

import { randomBytes } from 'node:crypto';

import { Command, TABLE_IDS, type TableDefinition, type TableName } from './protocol/commands.ts';
import { ATTLOG_COMMAND, decodeAttendanceLog, type AttendanceLogRecord } from './protocol/attlog.ts';
import {
  BIOMETRIC_TYPE,
  chunkPayload,
  encodeVendorBlob,
  modalityOf,
  type BiometricChunk,
  type BiometricModality,
} from './protocol/biotemplate.ts';
import { encodeCountFilter, encodeFilter } from './protocol/filter.ts';
import {
  FINGERPRINTS_BULK_REQUEST,
  parseFingerprintSlots,
  type FingerprintSlot,
} from './protocol/fingerprints.ts';
import { decodeRows, encodeRow, parseSchema, type Row } from './protocol/records.ts';
import { decodeDeviceStatus, type DeviceStatus } from './protocol/status.ts';
import { decodeDateTime, encodeDateTime } from './protocol/time.ts';
import { ZkConnection } from './transport/connection.ts';

export class ZkError extends Error {
  readonly command?: number;
  readonly ack?: number;

  constructor(message: string, command?: number, ack?: number) {
    super(message);
    this.name = 'ZkError';
    this.command = command;
    this.ack = ack;
  }
}

export interface ZkDeviceOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
  /**
   * Keepalive interval in milliseconds. The device drops idle sessions after
   * roughly a minute, so long-lived consumers should set this.
   */
  keepAliveMs?: number;
}

export interface ReadTableOptions {
  /** Column ordinals to fetch, 1-based. Defaults to every column. */
  columnIds?: number[];
  /**
   * Record filter: tab-separated `Column=value` conditions, ANDed.
   * Verified against hardware, e.g. `Pin=1` or `Pin=1\tType=2`.
   * Comparison operators are rejected because this firmware closes the
   * connection when it cannot parse a filter.
   */
  filter?: string;
}

export interface BulkReadOptions {
  /** Bytes per DATA_RDY window; the vendor SDK uses 65,472 (0xffc0). */
  windowSize?: number;
  /** Idle timeout per window; defaults to the connection timeout. */
  timeoutMs?: number;
}


export interface DeviceIdentity {
  serial: string;
  firmware: string;
  product: string;
  platform: string;
  faceVersion: string;
  fingerprintVersion: string;
}

export interface BiometricTemplate {
  pin: string;
  /** Raw `pers_biotemplate.Type`. */
  type: number;
  modality: BiometricModality;
  /** Chunks of this template, ordered by `Index`. */
  chunks: BiometricChunk[];
  /** Payload bytes across all chunks, envelopes excluded. */
  bytes: number;
}

export class ZkDevice {
  readonly #connection: ZkConnection;
  #schema: TableDefinition[] | null = null;
  #version = '';

  constructor(options: ZkDeviceOptions) {
    this.#connection = new ZkConnection({
      host: options.host,
      port: options.port,
      timeoutMs: options.timeoutMs,
      keepAliveMs: options.keepAliveMs,
    });
  }

  get connected(): boolean {
    return this.#connection.connected;
  }

  get version(): string {
    return this.#version;
  }

  /** Connect and complete the handshake the vendor SDK performs. */
  async connect(): Promise<void> {
    await this.#connection.open();

    const hello = await this.#connection.send(Command.CONNECT);
    if (hello.ack.command !== Command.ACK_CONNECT && hello.ack.command !== Command.ACK_OK) {
      throw new ZkError(
        `unexpected handshake reply ${hello.ack.command}`,
        Command.CONNECT,
        hello.ack.command,
      );
    }
    this.#connection.setSession(hello.ack.session);

    // Command 1102 carries a 4-byte comm key. The vendor client sends a fresh
    // random value on every connection, and with no comm key configured this
    // firmware answers 2005 (ACK_CONNECT) rather than 2000 and does not gate
    // later commands on it. We mirror that, then prove the session works with a
    // real read, so a device that *does* have a comm key fails here rather than
    // halfway through a sync.
    const auth = await this.#connection.send(Command.AUTH, randomBytes(4));
    if (auth.ack.command !== Command.ACK_OK && auth.ack.command !== Command.ACK_CONNECT) {
      throw new ZkError(
        `authentication rejected (command 1102 -> ${auth.ack.command})`,
        Command.AUTH,
        auth.ack.command,
      );
    }
    try {
      await this.getVersion();
    } catch {
      throw new ZkError(
        'handshake completed but the device refused a follow-up command; a comm key is likely set',
        Command.AUTH,
        auth.ack.command,
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.#connection.connected) await this.#connection.send(Command.EXIT);
    } finally {
      this.#connection.close();
    }
  }

  /** Read a single device option, e.g. `~SerialNumber`. */
  async getOption(name: string): Promise<string> {
    const { ack, payload } = await this.#connection.send(
      Command.GET_OPTION,
      Buffer.from(`${name}\0`, 'latin1'),
    );
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError(`option ${name} failed`, Command.GET_OPTION, ack.command);
    }
    const text = payload.toString('latin1').replace(/\0+$/, '');
    const separator = text.indexOf('=');
    return separator >= 0 ? text.slice(separator + 1) : text;
  }

  /**
   * Fetch many options in one round trip. The device answers with a
   * comma-separated `name=value` list.
   */
  async getOptions(names: string[]): Promise<Record<string, string>> {
    const request = `${names.map((name) => `${name}=?`).join(',')}\0`;
    const { ack, payload } = await this.#connection.send(
      Command.GET_OPTIONS_ALL,
      Buffer.from(request, 'latin1'),
    );
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('option batch failed', Command.GET_OPTIONS_ALL, ack.command);
    }
    const result: Record<string, string> = {};
    for (const pair of payload.toString('latin1').replace(/\0+$/, '').split(',')) {
      const separator = pair.indexOf('=');
      if (separator > 0) result[pair.slice(0, separator)] = pair.slice(separator + 1);
    }
    return result;
  }

  /** Write an option, e.g. `SDKBuild=1`. */
  async setOption(assignment: string): Promise<void> {
    const { ack } = await this.#connection.send(
      Command.SET_OPTION,
      Buffer.from(`${assignment}\0`, 'latin1'),
    );
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError(`set option ${assignment} failed`, Command.SET_OPTION, ack.command);
    }
  }

  async getVersion(): Promise<string> {
    if (this.#version) return this.#version;
    const { ack, payload } = await this.#connection.send(Command.GET_VERSION);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('version request failed', Command.GET_VERSION, ack.command);
    }
    this.#version = payload.toString('latin1').replace(/\0+$/, '');
    return this.#version;
  }

  /** Device identity in one round trip. */
  async identify(): Promise<DeviceIdentity> {
    const options = await this.getOptions([
      '~SerialNumber',
      '~DeviceName',
      '~Platform',
      '~ZKFPVersion',
      'ZKFaceVersion',
    ]);
    return {
      serial: options['~SerialNumber'] ?? '',
      firmware: await this.getVersion(),
      product: options['~DeviceName'] ?? '',
      platform: options['~Platform'] ?? '',
      faceVersion: options['ZKFaceVersion'] ?? '',
      fingerprintVersion: options['~ZKFPVersion'] ?? '',
    };
  }

  /** Full table catalogue, as the device reports it. */
  async schema(): Promise<TableDefinition[]> {
    if (this.#schema) return this.#schema;
    this.#schema = await this.readSchema();
    return this.#schema;
  }

  private async readSchema(): Promise<TableDefinition[]> {
    const text = await this.rawSchemaText();
    return parseSchema(text);
  }

  /** The device's schema payload verbatim, before parsing. */
  async rawSchemaText(): Promise<string> {
    const { ack, payload } = await this.#connection.send(Command.GET_TABLE_SCHEMA);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('schema request failed', Command.GET_TABLE_SCHEMA, ack.command);
    }
    return payload.toString('latin1').replace(/\0+$/, '');
  }

  /** Resolve a table by name or wire id. */
  async table(nameOrId: TableName | number | string): Promise<TableDefinition> {
    const tables = await this.schema();
    let id: number | undefined;
    if (typeof nameOrId === 'number') id = nameOrId;
    else if (typeof nameOrId === 'string') {
      const known = (TABLE_IDS as Record<string, number | undefined>)[nameOrId];
      if (known !== undefined) id = known;
      else {
        const byName = tables.find((table) => table.name === nameOrId);
        if (byName) return byName;
      }
    }
    const found = id !== undefined ? tables.find((table) => table.id === id) : undefined;
    if (!found) throw new ZkError(`unknown table ${String(nameOrId)}`);
    return found;
  }

  /**
   * Record count for a table, optionally filtered: `count('user', 'Pin=1')`.
   *
   * Note that this is not a row count for every table: `pers_biotemplate`
   * reports 146 for 499 users' biometrics, because the device counts enrolled
   * templates rather than the chunks each template occupies.
   */
  async count(nameOrId: TableName | number | string, filter = ''): Promise<number> {
    const table = await this.table(nameOrId);
    const request = Buffer.concat([
      Buffer.from([table.id]),
      encodeCountFilter(filter, table),
    ]);
    const { ack, payload } = await this.#connection.send(Command.GET_RECORD_COUNT, request);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError(`count ${table.name} failed`, Command.GET_RECORD_COUNT, ack.command);
    }
    if (payload.length >= 4) return payload.readUInt32LE(0);
    if (payload.length >= 2) return payload.readUInt16LE(0);
    return payload[0] ?? 0;
  }

  /** Device clock. Verified against hardware: 201 reads, 202 writes. */
  async getTime(): Promise<Date> {
    const { ack, payload } = await this.#connection.send(Command.GET_TIME);
    if (ack.command !== Command.ACK_OK || payload.length < 4) {
      throw new ZkError('time request failed', Command.GET_TIME, ack.command);
    }
    return decodeDateTime(payload.readUInt32LE(0));
  }

  /** Set the device clock. Payload format verified against a live device. */
  async setTime(when: Date = new Date()): Promise<void> {
    const packed = encodeDateTime(when);
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(packed, 0);
    const { ack } = await this.#connection.send(Command.SET_TIME, payload);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('set time failed', Command.SET_TIME, ack.command);
    }
  }

  /**
   * Send a command and return the raw acknowledgement and payload.
   *
   * An escape hatch for protocol work and diagnostics: every high-level method
   * is built on this, so anything the device supports can be reached even
   * before it has a typed wrapper.
   */
  async sendRaw(command: number, data?: Buffer): Promise<{ ack: number; payload: Buffer }> {
    const { ack, payload } = await this.#connection.send(command, data);
    return { ack: ack.command, payload };
  }

  /**
   * Commit a table payload.
   *
   * The vendor shim writes with: PREPARE_DATA(1500, uint32 byte length),
   * DATA(1501, payload), then command 119 (commit) and 10001 (refresh). That
   * sequence was captured from the shim itself.
   *
   * WARNING: the outer framing is proven, but the per-record layout for writes
   * has not been established. A probe with length-prefixed rows produced a
   * corrupt user record on real hardware, so this is deliberately low level and
   * callers must supply bytes whose layout they have verified.
   */
  async writeTablePayload(payload: Buffer): Promise<void> {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(payload.length, 0);
    await this.#connection.send(Command.PREPARE_DATA, size);
    await this.#connection.send(Command.DATA, payload);
    const commit = await this.#connection.send(Command.WRITE_COMMIT);
    if (commit.ack.command !== Command.ACK_OK) {
      throw new ZkError('write commit rejected', Command.WRITE_COMMIT, commit.ack.command);
    }
    // The refresh step answers ACK_ERROR even for the vendor client; it is not
    // a reliable success signal, so it is best effort.
    await this.#connection.send(Command.WRITE_REFRESH).catch(() => {});
  }

  /**
   * Enroll a biometric template on the device.
   *
   * Writes each chunk as a `pers_biotemplate` row using the table protocol,
   * which is the same format the vendor app uses. Verified against hardware:
   * a written face template reads back byte-identical.
   *
   * The user must already exist on the device (create with SSR_SetUserInfo via
   * the COM shim, or ensure the pin is present).
   *
   * @param pin - Employee pin on the device.
   * @param type - Template type: 1 = fingerprint, 2 = face, 8 = palm.
   * @param chunks - Ordered chunks (e.g. from `biometricTemplates()` on another device).
   */
  async enrollBiometric(
    pin: string,
    type: number,
    chunks: { index: number; data: Buffer }[],
  ): Promise<void> {
    if (type === BIOMETRIC_TYPE.fingerprint) {
      const uid = await this.findDeviceUid(pin);
      if (uid === null) {
        throw new ZkError(`user ${pin} not found on device`);
      }

      // Bulk user stream gives the 72-byte user record the device expects in
      // the upload packet (pyzk's `save_user_template` protocol).
      const userBulk = await this.bulkRead(
        Buffer.from('0109000500000000000000', 'hex'),
      );
      const totalSize = userBulk.readUInt32LE(0);
      let upack: Buffer | null = null;
      let pos = 4;
      while (pos + 72 <= userBulk.length && pos - 4 < totalSize) {
        if (userBulk.readUInt16LE(pos) === uid) {
          upack = Buffer.from(userBulk.subarray(pos, pos + 72));
          break;
        }
        pos += 72;
      }
      if (!upack) {
        throw new ZkError(`user ${pin} not found in user bulk stream`);
      }

      const table = Buffer.alloc(chunks.length * 8);
      const fpackParts: Buffer[] = [];
      let tstart = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const entry = Buffer.alloc(8);
        entry[0] = 2;
        entry.writeUInt16LE(uid, 1);
        entry[3] = (0x10 + (chunk.index & 0xff)) & 0xff;
        entry.writeUInt32LE(tstart, 4);
        entry.copy(table, i * 8);
        const sizeBuf = Buffer.alloc(2);
        sizeBuf.writeUInt16LE(chunk.data.length, 0);
        fpackParts.push(sizeBuf, chunk.data);
        tstart += chunk.data.length;
      }
      const fpack = Buffer.concat(fpackParts);

      const head = Buffer.alloc(12);
      head.writeUInt32LE(upack.length, 0);
      head.writeUInt32LE(table.length, 4);
      head.writeUInt32LE(fpack.length, 8);

      await this.uploadBuffer(Buffer.concat([head, upack, table, fpack]));
      const { ack } = await this.sendRaw(
        110,
        Buffer.from([12, 0, 0, 0, 0, 0, 8, 0]),
      );
      if (ack !== Command.ACK_OK) {
        throw new ZkError('fingerprint write rejected', 110, ack);
      }
      await this.sendRaw(Command.WRITE_REFRESH, Buffer.alloc(0)).catch(
        () => {},
      );
      return;
    }
    const table = await this.table('pers_biotemplate');
    const majorVer = type === BIOMETRIC_TYPE.face ? 12 : type === BIOMETRIC_TYPE.palm ? 12 : 10;
    for (const chunk of chunks) {
      const row = {
        Pin: pin,
        Valid: 1,
        Duress: 0,
        Type: type,
        MajorVer: majorVer,
        MinorVer: 0,
        Format: 0,
        No: 0,
        Index: chunk.index,
        Tmp: chunk.data,
      };
      const header = Buffer.concat([
        Buffer.from([table.id, table.ordinals.length]),
        Buffer.from(table.ordinals),
      ]);
      const encoded = encodeRow(row, table);
      await this.writeTablePayload(Buffer.concat([header, encoded]));
    }
  }

  /**
   * Remove all biometric templates for a pin.
   *
   * The device's delete command takes a single equality condition, so this
   * removes every template row for the pin (all modalities). To replace only
   * one modality, read the others first, delete all, then re-enroll what you
   * want to keep.
   */
  async deleteBiometric(pin: string): Promise<void> {
    const uid = await this.findDeviceUid(pin).catch(() => null);
    if (uid !== null) {
      for (let fid = 0; fid < 10; fid++) {
        await this.deleteFingerprintTemplate(uid, fid);
      }
    }
    await this.deleteRows('pers_biotemplate', `Pin=${pin}`);
  }

  /**
   * Read one fingerprint template for a user/finger slot.
   *
   * Uses command 9 (USERTEMP_RRQ) with request payload [uid:u16 LE][fid:u8].
   * Returns the raw template payload when enrolled, or null when no template
   * exists for that slot (or the device rejects the request).
   *
   * The device appends six bytes of the *next* store record to this reply
   * (verified on six slots: USERTEMP = bulk data + 6 bytes, identical prefix).
   * They are stripped so the result matches the authoritative `DATA_WRRQ`
   * stream and can be pushed back without corrupting the next template.
   */
  async getFingerprintTemplate(uid: number, fid: number): Promise<Buffer | null> {
    const req = Buffer.alloc(3);
    req.writeUInt16LE(uid & 0xffff, 0);
    req[2] = fid & 0xff;
    try {
      const { ack, payload } = await this.#connection.send(Command.USERTEMP_RRQ, req);
      if (ack.command !== Command.ACK_OK) return null;
      if (!payload || payload.length === 0) return null;
      return payload.length > 6 ? payload.subarray(0, payload.length - 6) : payload;
    } catch {
      return null;
    }
  }

  /**
   * Write one fingerprint template for a user/finger slot.
   *
   * Uses command 10 (USERTEMP_WRQ) with the same record framing as the bulk
   * `DATA_WRRQ` stream: `[size:u16 LE][uid:u16 LE][fid:u8][valid:u8][template]`,
   * where `size` counts the whole record.
   */
  async probeUserTempWrq(payload: Buffer): Promise<number> {
    const { ack } = await this.#connection.send(Command.USERTEMP_WRQ, payload);
    return ack.command;
  }

  async uploadBuffer(buffer: Buffer): Promise<void> {
    await this.#connection.send(Command.FREE_DATA).catch(() => {});
    const size = Buffer.alloc(4);
    size.writeUInt32LE(buffer.length, 0);
    await this.#connection.send(Command.PREPARE_DATA, size);
    const chunkSize = 1024;
    let offset = 0;
    while (offset < buffer.length) {
      const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
      await this.#connection.send(Command.DATA, chunk);
      offset += chunkSize;
    }
  }


  async setFingerprintTemplate(
    uid: number,
    fid: number,
    template: Buffer,
    valid = true,
  ): Promise<void> {
    const record = Buffer.alloc(6);
    record.writeUInt16LE(6 + template.length, 0);
    record.writeUInt16LE(uid & 0xffff, 2);
    record[4] = fid & 0xff;
    record[5] = valid ? 1 : 0;
    const { ack } = await this.#connection.send(
      Command.USERTEMP_WRQ,
      Buffer.concat([record, template]),
    );
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError(
        `fingerprint write rejected ack=${ack.command}`,
        Command.USERTEMP_WRQ,
        ack.command,
      );
    }
  }

  /** Delete one fingerprint template (command 19, request [uid:u16 LE][fid:u8]). */
  async deleteFingerprintTemplate(
    uid: number,
    fid: number,
  ): Promise<boolean> {
    const req = Buffer.alloc(3);
    req.writeUInt16LE(uid & 0xffff, 0);
    req[2] = fid & 0xff;
    try {
      const { ack } = await this.#connection.send(Command.DELETE_USERTEMP, req);
      return ack.command === Command.ACK_OK;
    } catch {
      return false;
    }
  }

  /** Delete rows matching a single-column equality filter, e.g. `Pin=65000`. */
  async deleteRows(nameOrId: TableName | number | string, filter: string): Promise<void> {
    const table = await this.table(nameOrId);
    // The device expects just the value, not "Column=value".
    // Parse "Column=value" to extract the column name and value.
    const match = /^([^=\t]+)=(.+)$/.exec(filter.trim());
    if (!match) throw new ZkError(`invalid delete filter: ${filter}`);
    const columnName = match[1]!;
    const value = match[2]!;
    const columnIndex = table.columns.indexOf(columnName);
    if (columnIndex < 0) throw new ZkError(`unknown column ${columnName} in table ${table.name}`);
    const ordinal = table.ordinals[columnIndex]!;
    const text = Buffer.from(value, 'latin1');
    const request = Buffer.concat([
      Buffer.from([table.id, 1]),
      Buffer.from([ordinal]),
      Buffer.from([text.length]),
      text,
    ]);
    const { ack } = await this.#connection.send(Command.DELETE_TABLE, request);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('delete rejected', Command.DELETE_TABLE, ack.command);
    }
  }
  async readTable(nameOrId: TableName | number | string, options: ReadTableOptions = {}): Promise<Row[]> {
    const table = await this.table(nameOrId);
    const raw = await this.readTableRaw(table.id, options.columnIds ?? table.ordinals, options.filter);
    return decodeRows(raw, table).rows;
  }

  /**
   * The raw READ_TABLE response payload, before decoding. Exposed for tools and
   * tests that need to see exactly what the device sent.
   */
  async readTableRaw(tableId: number, columnIds: number[], filter = ''): Promise<Buffer> {
    const table = await this.table(tableId);
    const request = Buffer.concat([
      Buffer.from([tableId, columnIds.length]),
      Buffer.from(columnIds),
      encodeFilter(filter, table),
    ]);
    const { ack, payload } = await this.#connection.send(Command.READ_TABLE, request);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError(`read table ${tableId} failed`, Command.READ_TABLE, ack.command);
    }
    return payload;
  }

  /**
   * Read a vendor bulk data set (`DATA_WRRQ`, command 1503).
   *
   * Verified on the live uFace800 Plus:
   *   1. the 11-byte request selects the data set
   *   2. ACK payload: `[0][total:u32 LE][total:u32 LE][checksum:u32]`
   *   3. the client asks for one window with DATA_RDY
   *      `[offset:u32 LE][size:u32 LE]`
   *   4. the device answers PREPARE_DATA(size) + DATA(window) + ACK_OK
   *   5. FREE_DATA releases the device-side buffer
   *
   * Windows are requested sequentially: the device prepares each one before
   * sending, and pipelining does not make it produce bytes any faster.
   */
  async bulkRead(request: Buffer, options: BulkReadOptions = {}): Promise<Buffer> {
    const windowSize = Math.min(
      Math.max(options.windowSize ?? 0xffc0, 1),
      0xffff,
    );
    const started = await this.#connection.send(
      Command.DATA_WRRQ,
      request,
      options.timeoutMs,
    );
    if (started.ack.command !== Command.ACK_OK) {
      throw new ZkError('bulk read rejected', Command.DATA_WRRQ, started.ack.command);
    }
    if (started.payload.length < 13) {
      throw new ZkError('bulk read reply too short', Command.DATA_WRRQ, started.ack.command);
    }
    const total = started.payload.readUInt32LE(1);
    const parts: Buffer[] = [];
    let offset = 0;
    try {
      while (offset < total) {
        const size = Math.min(windowSize, total - offset);
        const ready = Buffer.alloc(8);
        ready.writeUInt32LE(offset, 0);
        ready.writeUInt32LE(size, 4);
        const chunk = await this.#connection.send(
          Command.DATA_RDY,
          ready,
          options.timeoutMs,
        );
        if (chunk.ack.command !== Command.ACK_OK) {
          throw new ZkError('bulk window rejected', Command.DATA_RDY, chunk.ack.command);
        }
        if (chunk.payload.length === 0) break;
        parts.push(chunk.payload);
        offset += chunk.payload.length;
      }
    } finally {
      await this.#connection.send(Command.FREE_DATA, undefined, options.timeoutMs).catch(() => {});
    }
    const payload = Buffer.concat(parts);
    if (payload.length < total) {
      throw new ZkError(
        `bulk read incomplete: ${payload.length}/${total} bytes`,
        Command.DATA_WRRQ,
      );
    }
    return payload.subarray(0, total);
  }

  /**
   * All fingerprint templates in one bulk stream (`DATA_WRRQ` 1503).
   *
   * Measured on the live device: 308 templates / 171,760 bytes in ~57 s. The
   * alternative — ten `USERTEMP_RRQ` calls per user — takes ~24 min for 499
   * users, which is why the vendor SDK uses this command for `Type=1`.
   */
  async fingerprints(): Promise<FingerprintSlot[]> {
    return parseFingerprintSlots(await this.bulkRead(FINGERPRINTS_BULK_REQUEST));
  }

  /**
   * The user table projected to `UID`, `Pin` and `Name`.
   *
   * The full row carries password, card, timezone and date fields; asking for
   * only these three columns cut the live read from ~44 s to ~6.5 s.
   */
  async userDirectory(): Promise<Array<{ uid: number; pin: string; name: string }>> {
    const table = await this.table('user');
    const ordinals = ['UID', 'Pin', 'Name']
      .map((column) => table.ordinals[table.columns.indexOf(column)])
      .filter((ordinal): ordinal is number => ordinal !== undefined);
    const rows = await this.readTable('user', { columnIds: ordinals });
    return rows.map((row) => ({
      uid: Number(row.UID ?? 0),
      pin: String(row.Pin ?? ''),
      name: textOf(row.Name),
    }));
  }


  /** All enrolled people. */
  async users(): Promise<Row[]> {
    return this.readTable('user');
  }

  /**
   * Create or update a user on the device (legacy command 8 / user struct).
   *
   * This is the same wire operation the vendor app uses for `SSR_SetUserInfo`.
   * Verified against hardware: users created with this method are readable via
   * `users()` / `readTable('user')` with correct pin, name, password and
   * privilege, and can be deleted with `deleteRows('user', 'Pin=...')`.
   *
   * @param options.uid - Internal UID (u16). If omitted, auto-assigned as
   *   max(existing UIDs) + 1.
   * @param options.pin - Employee PIN (string, stored on device; used for
   *   attendance matching).
   * @param options.name - Display name.
   * @param options.password - Optional password/PIN code (up to 8 chars).
   * @param options.privilege - 0 = normal user, 14 = administrator (default 0).
   * @param options.enabled - Whether the user is enabled (default true).
   */
  async setUserInfo(options: {
    uid?: number;
    pin: string;
    name: string;
    password?: string;
    privilege?: number;
    enabled?: boolean;
  }): Promise<void> {
    let uid = options.uid;
    if (uid === undefined) {
      const users = await this.users();
      const maxUid = users.reduce((max, u) => Math.max(max, Number(u.UID) || 0), 0);
      uid = maxUid + 1;
    }
    const pin = options.pin;
    const name = options.name ?? '';
    const password = options.password ?? '';
    const privilege = options.privilege ?? 0;
    const enabled = options.enabled ?? true;

    const buf = Buffer.alloc(72, 0);
    buf.writeUInt16LE(uid & 0xffff, 0);
    // Byte 2: privilege when enabled; 0x01 when disabled (observed from vendor).
    buf[2] = enabled ? privilege : 0x01;

    // Bytes 3-10: password field (8 bytes). Vendor stores ASCII password starting
    // at offset 3, NUL-terminated. For empty passwords, observed fill pattern.
    if (password.length > 0) {
      const pw = Buffer.from(password, 'latin1');
      pw.copy(buf, 3, 0, Math.min(pw.length, 8));
    } else {
      buf[3] = 0x00;
      buf[4] = 0xff; buf[5] = 0xff; buf[6] = 0xff; buf[7] = 0x6c;
      buf[8] = 0xe5; buf[9] = 0xda; buf[10] = 0x09;
    }

    // Bytes 11-34: name (24 bytes, NUL-padded)
    Buffer.from(name, 'latin1').copy(buf, 11, 0, Math.min(Buffer.byteLength(name, 'latin1'), 24));

    // Bytes 35-38: reserved (zeros observed)
    // Byte 39: valid/active flag (0x01 observed in all vendor captures)
    buf[39] = 0x01;
    // Bytes 40-47: reserved

    // Bytes 48-71: PIN string (24 bytes, NUL-terminated)
    Buffer.from(pin, 'latin1').copy(buf, 48, 0, Math.min(Buffer.byteLength(pin, 'latin1'), 24));

    const { ack } = await this.#connection.send(Command.WRITE_TABLE, buf);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('set user info rejected', Command.WRITE_TABLE, ack.command);
    }
  }

  /**
   * Attendance log, as the device stores it. Uses the legacy ATTLOG_RRQ command.
   */
  async attendanceLog(): Promise<AttendanceLogRecord[]> {
    const { ack, payload } = await this.#connection.send(ATTLOG_COMMAND);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('attendance log request failed', ATTLOG_COMMAND, ack.command);
    }
    return decodeAttendanceLog(payload);
  }

  /** Attendance transactions (cursor; often empty). Kept for compatibility. */
  async attendance(): Promise<Row[]> {
    return this.readTable('transaction');
  }

  /**
   * Device status and storage counters (command 50).
   */
  async status(): Promise<DeviceStatus> {
    const { ack, payload } = await this.#connection.send(Command.GET_FREE_SIZES);
    if (ack.command !== Command.ACK_OK) {
      throw new ZkError('status request failed', Command.GET_FREE_SIZES, ack.command);
    }
    return decodeDeviceStatus(payload);
  }

  /**
   * Face and palm templates. `Tmp` is an opaque vendor blob: it is only
   * meaningful when written back to compatible hardware.
   */
  async biometrics(): Promise<Row[]> {
    return this.readTable('pers_biotemplate');
  }

  /**
   * Biometric chunks grouped into enrolled templates.
   *
   * Face/palm templates are read from `pers_biotemplate`. Fingerprint templates
   * (Type=1) may also be stored in the device's fingerprint store and read via
   * USERTEMP_RRQ (cmd 9) on some firmware; for per-pin queries this method
   * augments results with fingerprint slots found that way.
   */
  async biometricTemplates(filter = ''): Promise<BiometricTemplate[]> {
    const rows = await this.readTable('pers_biotemplate', filter ? { filter } : {});
    const templates = new Map<string, BiometricTemplate>();

    for (const row of rows) {
      const pin = String(row.Pin);
      const type = Number(row.Type);
      const key = `${pin}:${type}`;
      let template = templates.get(key);
      if (!template) {
        template = { pin, type, modality: modalityOf(type), chunks: [], bytes: 0 };
        templates.set(key, template);
      }
      const data = row.Tmp as Buffer;
      template.chunks.push({ index: Number(row.Index), data });
      template.bytes += chunkPayload(data).length;
    }

    for (const template of templates.values()) {
      template.chunks.sort((a, b) => a.index - b.index);
    }

    await this.augmentFingerprintsFromUserTemp(templates, filter);

    return [...templates.values()];
  }

  private parsePinFilter(filter: string): { pin: string; type: number | null } | null {
    if (!filter) return null;
    const parts = filter.split('\t');
    let pin: string | null = null;
    let type: number | null = null;
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 'Pin' || key === 'pin') pin = value;
      if (key === 'Type' || key === 'type') {
        const n = Number(value);
        if (Number.isFinite(n)) type = n;
      }
    }
    if (!pin) return null;
    return { pin, type };
  }

  /** Resolve a PIN to the device-internal UID with a single projected row. */
  private async findDeviceUid(pin: string): Promise<number | null> {
    const table = await this.table('user');
    const uidOrdinal = table.ordinals[table.columns.indexOf('UID')];
    const pinOrdinal = table.ordinals[table.columns.indexOf('Pin')];
    if (uidOrdinal === undefined || pinOrdinal === undefined) return null;
    const rows = await this.readTable('user', {
      columnIds: [uidOrdinal, pinOrdinal],
      filter: `Pin=${pin}`,
    });
    const uid = Number(rows[0]?.UID);
    return Number.isFinite(uid) ? uid : null;
  }

  private async augmentFingerprintsFromUserTemp(
    templates: Map<string, BiometricTemplate>,
    filter: string,
  ): Promise<void> {
    const parsed = this.parsePinFilter(filter);
    if (!parsed) return; // only per-pin to avoid expensive full scans
    if (parsed.type !== null && parsed.type !== BIOMETRIC_TYPE.fingerprint) return;
    const key = `${parsed.pin}:${BIOMETRIC_TYPE.fingerprint}`;
    if (templates.has(key)) return;

    let uid: number | null = null;
    try {
      uid = await this.findDeviceUid(parsed.pin);
    } catch {
      return;
    }
    if (uid == null) return;

    const chunks: BiometricChunk[] = [];
    let bytes = 0;
    for (let fid = 0; fid < 10; fid++) {
      try {
        const tpl = await this.getFingerprintTemplate(uid, fid);
        if (!tpl || tpl.length === 0) continue;
        chunks.push({ index: fid, data: tpl });
        bytes += tpl.length;
      } catch {
        // ignore per-slot failures
      }
    }
    if (chunks.length === 0) return;

    templates.set(key, {
      pin: parsed.pin,
      type: BIOMETRIC_TYPE.fingerprint,
      modality: modalityOf(BIOMETRIC_TYPE.fingerprint),
      chunks,
      bytes,
    });
  }

  /**
   * One enrolled template as the container `GetUserFaceStr` returns.
   *
   * Returns null when the person has no template of that type. Verified
   * byte-for-byte against the vendor SDK for a face template.
   */
  async templateBlob(
    pin: string,
    type: number = BIOMETRIC_TYPE.face,
  ): Promise<Buffer | null> {
    const templates = await this.biometricTemplates(`Pin=${pin}\tType=${type}`);
    const template = templates[0];
    return template ? encodeVendorBlob(template.chunks) : null;
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8').replace(/\0+$/, '');
  switch (typeof value) {
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return '';
  }
}
