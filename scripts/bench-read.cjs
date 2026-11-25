/**
 * Raw READ_TABLE benchmark with frame-level timing.
 *
 * Measures how the device streams table data: PREPARE_DATA size, DATA frame
 * sizes and inter-frame gaps, and total wall time. Useful for comparing the
 * vendor SDK's SSR_GetDeviceData with the direct-TCP implementation.
 *
 * Usage:
 *   node scripts/bench-read.cjs [host] [table] [filter]
 *
 *   table:   user | pers_biotemplate | ...   (default user)
 *   filter:  "Type=8" etc.                  (default none)
 *   env ACK_DATA=1     send ACK_OK after each DATA frame
 *   env FREE_DATA=1    send FREE_DATA after the terminating frame
 *   env REPEAT=2       run the same read N times on one connection
 */
'use strict';

const net = require('node:net');

const HOST = process.argv[2] || '192.168.1.100';
const PORT = Number(process.env.PORT || 4370);
const TABLE_NAME = process.argv[3] || 'user';
const FILTER = process.argv[4] || '';
const ACK_DATA = process.env.ACK_DATA === '1';
const FREE_DATA = process.env.FREE_DATA === '1';
const REPEAT = Math.max(1, Number(process.env.REPEAT || 1));

const CMD = {
  CONNECT: 1000,
  EXIT: 1001,
  GET_OPTION: 11,
  AUTH: 1102,
  GET_VERSION: 1100,
  PREPARE_DATA: 1500,
  DATA: 1501,
  FREE_DATA: 1502,
  ACK_OK: 2000,
  ACK_ERROR: 2001,
  ACK_CONNECT: 2005,
  GET_TABLE_SCHEMA: 10000,
  READ_TABLE: 10002,
  GET_RECORD_COUNT: 10033,
};

const MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);

function checksum(command, session, reply, data) {
  let sum = command + session + reply;
  while (sum > 0xffff) sum = (sum & 0xffff) + 1;
  for (let i = 0; i < data.length; i += 2) {
    sum += data[i] | ((data[i + 1] ?? 0) << 8);
    while (sum > 0xffff) sum = (sum & 0xffff) + 1;
  }
  return ~sum & 0xffff;
}

function encodeFrame(command, session, reply, data = Buffer.alloc(0)) {
  const payloadLength = 8 + data.length;
  const buf = Buffer.alloc(8 + payloadLength);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(payloadLength, 4);
  buf.writeUInt16LE(command, 8);
  buf.writeUInt16LE(checksum(command, session, reply, data), 10);
  buf.writeUInt16LE(session, 12);
  buf.writeUInt16LE(reply, 14);
  data.copy(buf, 16);
  return buf;
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 8) break;
    const magicIndex = buffer.indexOf(MAGIC, offset);
    if (magicIndex < 0) {
      offset = buffer.length;
      break;
    }
    if (magicIndex + 8 > buffer.length) {
      offset = magicIndex;
      break;
    }
    const length = buffer.readUInt32LE(magicIndex + 4);
    if (length < 8 || length > 64 * 1024 * 1024) {
      offset = magicIndex + 4;
      continue;
    }
    if (magicIndex + 8 + length > buffer.length) {
      offset = magicIndex;
      break;
    }
    const body = buffer.subarray(magicIndex + 8, magicIndex + 8 + length);
    frames.push({
      command: body.readUInt16LE(0),
      session: body.readUInt16LE(4),
      reply: body.readUInt16LE(6),
      data: Buffer.from(body.subarray(8)),
    });
    offset = magicIndex + 8 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function parseSchema(text) {
  const tables = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim().replace(/^"|"$/g, '');
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const name = trimmed.slice(0, eq);
    const fields = trimmed.slice(eq + 1).split(',');
    const id = Number(fields[0]);
    if (!Number.isFinite(id)) continue;
    tables.set(name, {
      id,
      columns: fields.slice(1).map((f) => f[0]),
      names: fields.slice(1).map((f) => f.replace(/^[isB]\d+$/, '')),
      ordinals: fields.slice(1).map((_, i) => i + 1),
    });
  }
  return tables;
}

function encodeFilter(filter, table) {
  if (!filter) return Buffer.from([0, 0]);
  const conditions = filter.split('\t').filter(Boolean);
  const parts = [];
  for (const condition of conditions) {
    const eq = condition.indexOf('=');
    const key = condition.slice(0, eq);
    const value = condition.slice(eq + 1);
    const index = table.names.findIndex((n) => n === key);
    if (index < 0) throw new Error(`unknown column ${key}`);
    const ordinal = index + 1;
    const type = table.columns[index][0];
    const val =
      type === 'i'
        ? Buffer.from([Number(value)])
        : type === 'B'
          ? Buffer.from(value, 'base64')
          : Buffer.from(value, 'latin1');
    parts.push(Buffer.from([ordinal, val.length]), val);
  }
  const head = Buffer.alloc(2);
  head.writeUInt16LE(conditions.length, 0);
  return Buffer.concat([head, ...parts]);
}

class RawDevice {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.session = 0;
    this.reply = 0;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.socket = null;
  }

  async open() {
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.setNoDelay(true);
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('data', (chunk) => this.onData(chunk));
    this.socket.on('error', (e) => this.failAll(e));
    this.socket.on('close', () => this.failAll(new Error('closed')));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { frames, rest } = decodeFrames(this.buffer);
    this.buffer = rest;
    for (const frame of frames) this.onFrame(frame);
  }

  onFrame(frame) {
    const pending = this.pending.get(frame.reply);
    if (!pending) return;
    if (frame.session !== 0 && this.session === 0) this.session = frame.session;
    if (frame.command === CMD.PREPARE_DATA) {
      pending.expected = frame.data.length >= 4 ? frame.data.readUInt32LE(0) : null;
      pending.timeline.push({ at: performance.now(), kind: 'prepare', size: pending.expected });
      return;
    }
    if (frame.command === CMD.DATA) {
      pending.chunks.push(frame.data);
      pending.frames.push(frame.data.length);
      pending.bytes += frame.data.length;
      pending.timeline.push({ at: performance.now(), kind: 'data', size: frame.data.length });
      if (ACK_DATA) {
        const ack = encodeFrame(CMD.ACK_OK, this.session, frame.reply);
        this.socket.write(ack);
      }
      return;
    }
    this.pending.delete(frame.reply);
    pending.timeline.push({ at: performance.now(), kind: 'final', command: frame.command });
    pending.resolve({ ack: frame.command, payload: pending.chunks.length ? Buffer.concat(pending.chunks) : frame.data, meta: pending });
  }

  failAll(error) {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }

  send(command, data = Buffer.alloc(0)) {
    const reply = this.reply;
    this.reply = (this.reply + 1) & 0xffff;
    const packet = encodeFrame(command, this.session, reply, data);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reply);
        reject(new Error(`timeout for ${command}`));
      }, 600_000);
      this.pending.set(reply, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        chunks: [],
        frames: [],
        bytes: 0,
        timeline: [{ at: performance.now(), kind: 'sent' }],
        expected: null,
      });
      this.socket.write(packet);
    });
  }

  close() {
    this.socket?.destroy();
  }
}

function summarize(meta) {
  const dataEvents = meta.timeline.filter((e) => e.kind === 'data');
  const sent = meta.timeline[0].at;
  const gaps = [];
  for (let i = 1; i < dataEvents.length; i++) {
    gaps.push(dataEvents[i].at - dataEvents[i - 1].at);
  }
  gaps.sort((a, b) => a - b);
  const pct = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0);
  const total = meta.timeline[meta.timeline.length - 1].at - sent;
  const sizes = {};
  for (const size of meta.frames) sizes[size] = (sizes[size] || 0) + 1;
  return {
    frames: meta.frames.length,
    frameSizes: sizes,
    bytes: meta.bytes,
    prepare: meta.expected,
    sentToFirstDataMs: dataEvents.length ? Math.round(dataEvents[0].at - sent) : null,
    totalMs: Math.round(total),
    bytesPerSec: total > 0 ? Math.round((meta.bytes / total) * 1000) : null,
    gapMedianMs: Math.round(pct(0.5)),
    gapP90Ms: Math.round(pct(0.9)),
    gapMaxMs: Math.round(gaps[gaps.length - 1] ?? 0),
  };
}

(async () => {
  const device = new RawDevice(HOST, PORT);
  await device.open();

  const hello = await device.send(CMD.CONNECT);
  console.log(`connect ack=${hello.ack} session=${device.session}`);
  const auth = await device.send(CMD.AUTH, require('node:crypto').randomBytes(4));
  console.log(`connected session=${device.session} auth=${auth.ack}`);

  const schemaRaw = await device.send(CMD.GET_TABLE_SCHEMA);
  const tables = parseSchema(schemaRaw.payload.toString('latin1').replace(/\0+$/, ''));
  const table = tables.get(TABLE_NAME);
  if (!table) {
    console.log('known tables:', [...tables.keys()].join(', '));
    throw new Error(`unknown table ${TABLE_NAME}`);
  }
  console.log(`table ${TABLE_NAME} id=${table.id} columns=${table.names.join(',')}`);

  const countConditions = FILTER ? FILTER.split('\t').filter(Boolean) : [];
  const countParts = [];
  for (const condition of countConditions) {
    const eq = condition.indexOf('=');
    const key = condition.slice(0, eq);
    const value = condition.slice(eq + 1);
    const index = table.names.indexOf(key);
    const type = table.columns[index][0];
    const val = type === 'i' ? Buffer.from([Number(value)]) : Buffer.from(value, 'latin1');
    countParts.push(Buffer.from([index + 1, val.length]), val);
  }
  const countPayload = Buffer.concat([Buffer.from([table.id, countConditions.length]), ...countParts]);
  const count = await device.send(CMD.GET_RECORD_COUNT, countPayload);
  console.log(
    `count(${TABLE_NAME}${FILTER ? `, ${FILTER}` : ''}) = ${count.payload.length >= 4 ? count.payload.readUInt32LE(0) : `<ack ${count.ack} len ${count.payload.length}>`}`,
  );

  for (let round = 1; round <= REPEAT; round++) {
    const request = Buffer.concat([
      Buffer.from([table.id, table.ordinals.length]),
      Buffer.from(table.ordinals),
      encodeFilter(FILTER, table),
    ]);
    const started = performance.now();
    const result = await device.send(CMD.READ_TABLE, request);
    const elapsed = performance.now() - started;
    const summary = summarize(result.meta);
    console.log(`\nround ${round}/${REPEAT} ack=${result.ack} elapsed=${Math.round(elapsed)}ms`);
    console.log(JSON.stringify(summary, null, 2));

    if (FREE_DATA) {
      const free = await device.send(CMD.FREE_DATA);
      console.log(`FREE_DATA -> ${free.ack}`);
    }
  }

  await device.send(CMD.EXIT).catch(() => {});
  device.close();
})().catch((error) => {
  console.error('FAILED:', error);
  process.exit(1);
});
