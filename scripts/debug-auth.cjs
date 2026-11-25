/**
 * Raw auth debugging: use the session the device assigns, then vary only the
 * AUTH payload. Isolates "is my framing right" from "is my auth value right".
 *
 * Usage: node scripts/debug-auth.cjs [host]
 */
'use strict';

const net = require('node:net');

const HOST = process.argv[2] || '192.168.1.100';
const PORT = 4370;
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

function frame(command, session, reply, data = Buffer.alloc(0)) {
  const len = 8 + data.length;
  const buf = Buffer.alloc(8 + len);
  MAGIC.copy(buf, 0);
  buf.writeUInt32LE(len, 4);
  buf.writeUInt16LE(command, 8);
  buf.writeUInt16LE(checksum(command, session, reply, data), 10);
  buf.writeUInt16LE(session, 12);
  buf.writeUInt16LE(reply, 14);
  data.copy(buf, 16);
  return buf;
}

function decode(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const idx = buffer.indexOf(MAGIC, offset);
    if (idx < 0 || idx + 8 > buffer.length) break;
    const len = buffer.readUInt32LE(idx + 4);
    if (idx + 8 + len > buffer.length) break;
    const body = buffer.subarray(idx + 8, idx + 8 + len);
    frames.push({
      command: body.readUInt16LE(0),
      session: body.readUInt16LE(4),
      reply: body.readUInt16LE(6),
      data: Buffer.from(body.subarray(8)),
    });
    offset = idx + 8 + len;
  }
  return frames;
}

/** Connect, handshake, then run `then(session, send)` and collect replies. */
function session(label, then) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: PORT });
    socket.setNoDelay(true);
    let buffer = Buffer.alloc(0);
    let sessionId = null;
    let reply = 0;
    const log = [];

    const send = (command, data = Buffer.alloc(0)) => {
      const packet = frame(command, sessionId ?? 0, reply, data);
      reply = (reply + 1) & 0xffff;
      socket.write(packet);
      log.push(`tx cmd=${command} ${packet.toString('hex')}`);
    };

    socket.on('connect', () => send(1000));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (const f of decode(buffer)) {
        if (sessionId === null) {
          sessionId = f.session;
          log.push(`session=0x${sessionId.toString(16)}`);
          then(sessionId, send, log);
        } else if (f.command !== 1500 && f.command !== 1501) {
          log.push(`rx cmd=${f.command} reply=${f.reply} data=${f.data.toString('hex')}`);
        }
      }
    });
    socket.on('error', (error) => log.push(`error ${error.message}`));
    socket.setTimeout(4000, () => {
      log.push('timeout');
      socket.destroy();
    });
    socket.on('close', () => {
      console.log(`\n=== ${label} ===`);
      for (const line of log) console.log(`  ${line}`);
      resolve(log);
    });
  });
}

const NOOP = () => {};

(async () => {
  await session('CONNECT only (control)', NOOP);

  await session('CONNECT + AUTH random', (sid, send) => {
    send(1102, Buffer.from([0xd7, 0xcb, 0x84, 0x61]));
  });

  await session('CONNECT + AUTH zeros', (sid, send) => {
    send(1102, Buffer.alloc(4));
  });

  await session('CONNECT + AUTH, then VERSION', (sid, send) => {
    send(1102, Buffer.alloc(4));
    setTimeout(() => send(1100), 400);
  });

  await session('CONNECT + VERSION only', (sid, send) => {
    send(1100);
  });
})();
