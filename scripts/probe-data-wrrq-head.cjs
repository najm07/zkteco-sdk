/**
 * Send only the DATA_WRRQ request and print the advertised stream size, then
 * FREE_DATA. No payload download: safe and fast for mapping request bytes.
 *
 * Usage: node scripts/probe-data-wrrq-head.cjs [host] [requestHex ...]
 */
'use strict';

const net = require('node:net');
const crypto = require('node:crypto');

const HOST = process.argv[2] || '192.168.1.100';
const PORT = Number(process.env.PORT || 4370);
const REQUESTS = process.argv.slice(3);

const CMD = {
  CONNECT: 1000,
  EXIT: 1001,
  AUTH: 1102,
  PREPARE_DATA: 1500,
  DATA: 1501,
  FREE_DATA: 1502,
  DATA_WRRQ: 1503,
  DATA_RDY: 1504,
  ACK_OK: 2000,
  CMD_2221: 2221,
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
    if (magicIndex < 0) break;
    if (magicIndex + 8 > buffer.length) break;
    const length = buffer.readUInt32LE(magicIndex + 4);
    if (length < 8 || length > 64 * 1024 * 1024) {
      offset = magicIndex + 4;
      continue;
    }
    if (magicIndex + 8 + length > buffer.length) break;
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
    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const { frames, rest } = decodeFrames(this.buffer);
      this.buffer = rest;
      for (const frame of frames) this.onFrame(frame);
    });
    this.socket.on('error', (e) => this.failAll(e));
    this.socket.on('close', () => this.failAll(new Error('closed')));
  }

  onFrame(frame) {
    const pending = this.pending.get(frame.reply);
    if (!pending) return;
    if (frame.session !== 0 && this.session === 0) this.session = frame.session;
    if (frame.command === CMD.PREPARE_DATA) {
      pending.expected = frame.data.length >= 4 ? frame.data.readUInt32LE(0) : null;
      return;
    }
    if (frame.command === CMD.DATA) {
      pending.chunks.push(frame.data);
      return;
    }
    this.pending.delete(frame.reply);
    pending.resolve({
      ack: frame.command,
      payload: pending.chunks.length ? Buffer.concat(pending.chunks) : frame.data,
    });
  }

  failAll(error) {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }

  send(command, data = Buffer.alloc(0), timeoutMs = 600_000) {
    const reply = this.reply;
    this.reply = (this.reply + 1) & 0xffff;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reply);
        reject(new Error(`timeout for ${command} reply=${reply}`));
      }, timeoutMs);
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
        expected: null,
      });
      this.socket.write(encodeFrame(command, this.session, reply, data));
    });
  }

  close() {
    this.socket?.destroy();
  }
}

(async () => {
  const device = new RawDevice(HOST, PORT);
  await device.open();
  const hello = await device.send(CMD.CONNECT);
  console.log(`connect ack=${hello.ack} session=${device.session}`);
  const auth = await device.send(CMD.AUTH, crypto.randomBytes(4));
  console.log(`auth ack=${auth.ack}`);
  const option = await device.send(12, Buffer.from('SDKBuild=1\0', 'latin1'));
  console.log(`SDKBuild=1 ack=${option.ack}`);

  for (const hex of REQUESTS) {
    const started = performance.now();
    try {
      const response = await device.send(CMD.DATA_WRRQ, Buffer.from(hex, 'hex'), 120_000);
      const ms = Math.round(performance.now() - started);
      if (response.ack !== CMD.ACK_OK || response.payload.length < 13) {
        console.log(`${hex} -> ack=${response.ack} len=${response.payload.length} hex=${response.payload.toString('hex')} in ${ms}ms`);
      } else {
        const total = response.payload.readUInt32LE(1);
        console.log(
          `${hex} -> total=${total} second=${response.payload.readUInt32LE(5)} trailer=${response.payload.subarray(9).toString('hex')} in ${ms}ms`,
        );
      }
      const free = await device.send(CMD.FREE_DATA);
      console.log(`  FREE_DATA ack=${free.ack}`);
    } catch (error) {
      console.log(`${hex} -> FAILED ${error.message}`);
      break;
    }
  }

  await device.send(CMD.EXIT).catch(() => {});
  device.close();
})().catch((error) => {
  console.error('FAILED:', error);
  process.exit(1);
});
