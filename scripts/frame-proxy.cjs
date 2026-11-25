/**
 * Frame-aware TCP proxy for the ZKTeco protocol.
 *
 * Unlike tcpproxy.cjs, this reassembles frames and logs command numbers, sizes
 * and timing instead of dumping megabytes of hex. Request payloads below
 * --hex-limit bytes are printed in hex, which is enough to identify commands
 * like READ_TABLE, GET_RECORD_COUNT and the SSR family.
 *
 * Usage:
 *   node scripts/frame-proxy.cjs [listenPort] [targetHost] [targetPort]
 *
 * Env:
 *   HEX_LIMIT=64   print request payloads up to this many bytes (default 64)
 *   LOG=file       also append the log to a file
 */
'use strict';

const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const listenPort = Number(process.argv[2] || 4371);
const targetHost = process.argv[3] || '192.168.1.100';
const targetPort = Number(process.argv[4] || 4370);
const HEX_LIMIT = Number(process.env.HEX_LIMIT || 64);
const LOG_FILE = process.env.LOG || '';
const DUMP_DIR = process.env.DUMP_DIR || '';
if (DUMP_DIR) fs.mkdirSync(DUMP_DIR, { recursive: true });

const MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);

const NAMES = {
  1000: 'CONNECT',
  1001: 'EXIT',
  8: 'WRITE_TABLE',
  9: 'USERTEMP_RRQ',
  11: 'GET_OPTION',
  12: 'SET_OPTION',
  13: 'ATTLOG_RRQ',
  50: 'GET_FREE_SIZES',
  69: 'GET_STATUS',
  201: 'GET_TIME',
  202: 'SET_TIME',
  501: 'GET_OPTIONS_ALL',
  1100: 'GET_VERSION',
  1102: 'AUTH',
  119: 'WRITE_COMMIT',
  1500: 'PREPARE_DATA',
  1501: 'DATA',
  1502: 'FREE_DATA',
  1503: 'DATA_WRRQ',
  1504: 'DATA_RDY',
  2000: 'ACK_OK',
  2001: 'ACK_ERROR',
  2002: 'ACK_DATA',
  2005: 'ACK_CONNECT',
  10000: 'GET_TABLE_SCHEMA',
  10001: 'WRITE_REFRESH',
  10002: 'READ_TABLE',
  10003: 'DELETE_TABLE',
  10033: 'GET_RECORD_COUNT',
};

function name(command) {
  return NAMES[command] || `CMD_${command}`;
}

function checksum(command, session, reply, data) {
  let sum = command + session + reply;
  while (sum > 0xffff) sum = (sum & 0xffff) + 1;
  for (let i = 0; i < data.length; i += 2) {
    sum += data[i] | ((data[i + 1] ?? 0) << 8);
    while (sum > 0xffff) sum = (sum & 0xffff) + 1;
  }
  return ~sum & 0xffff;
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
      checksum: body.readUInt16LE(2),
      session: body.readUInt16LE(4),
      reply: body.readUInt16LE(6),
      data: body.subarray(8),
      at: performance.now(),
    });
    offset = magicIndex + 8 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function log(line) {
  const stamped = `${new Date().toISOString().slice(11, 23)} ${line}`;
  console.log(stamped);
  if (LOG_FILE) fs.appendFileSync(LOG_FILE, `${stamped}\n`);
}

net
  .createServer((client) => {
    const id = `${client.remoteAddress}:${client.remotePort}`;
    log(`client connected ${id}`);
    const upstream = net.createConnection({ host: targetHost, port: targetPort });
    upstream.setNoDelay(true);
    client.setNoDelay(true);

    let clientBuffer = Buffer.alloc(0);
    let upstreamBuffer = Buffer.alloc(0);
    let lastClientFrame = null;

    client.on('data', (chunk) => {
      clientBuffer = Buffer.concat([clientBuffer, chunk]);
      const { frames, rest } = decodeFrames(clientBuffer);
      clientBuffer = rest;
      for (const frame of frames) {
        lastClientFrame = frame;
        const hex =
          frame.data.length > 0 && frame.data.length <= HEX_LIMIT
            ? ` hex=${frame.data.toString('hex')}`
            : '';
        log(
          `C->D ${name(frame.command)}(${frame.command}) reply=${frame.reply} session=${frame.session} len=${frame.data.length}${hex}`,
        );
      }
      upstream.write(chunk);
    });

    upstream.on('data', (chunk) => {
      upstreamBuffer = Buffer.concat([upstreamBuffer, chunk]);
      const { frames, rest } = decodeFrames(upstreamBuffer);
      upstreamBuffer = rest;
      for (const frame of frames) {
        const delta = lastClientFrame ? Math.round(frame.at - lastClientFrame.at) : null;
        const hex =
          frame.data.length > 0 && frame.data.length <= HEX_LIMIT
            ? ` hex=${frame.data.toString('hex')}`
            : '';
        if (DUMP_DIR && frame.command === 1501 && frame.data.length > 0) {
          fs.appendFileSync(
            path.join(DUMP_DIR, `stream-${frame.reply}.bin`),
            frame.data,
          );
        }
        log(
          `D->C ${name(frame.command)}(${frame.command}) reply=${frame.reply} session=${frame.session} len=${frame.data.length}${delta !== null ? ` after=${delta}ms` : ''}${hex}${DUMP_DIR && frame.command === 1501 ? ` dump=stream-${frame.reply}.bin` : ''}`,
        );
      }
      client.write(chunk);
    });

    client.on('error', (e) => log(`client error ${e.message}`));
    upstream.on('error', (e) => log(`upstream error ${e.message}`));
    client.on('close', () => {
      log(`client closed ${id}`);
      upstream.destroy();
    });
    upstream.on('close', () => {
      log(`upstream closed ${id}`);
      client.destroy();
    });
  })
  .listen(listenPort, '127.0.0.1', () => {
    log(`proxy listening 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}`);
  });
