/**
 * Decode a proxy capture into command exchanges.
 *
 * Reassembles the byte stream per direction, splits on the 50 50 82 7d magic,
 * and pairs requests with responses by reply id. Reads the log format produced
 * by scripts/tcpproxy.cjs.
 *
 * Usage: node scripts/decode-log.cjs <logfile> [--data]
 */
'use strict';

const fs = require('node:fs');

const MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
const SHOW_DATA = process.argv.includes('--data');
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/decode-log.cjs <logfile> [--data]');
  process.exit(1);
}

const CMD_NAMES = {
  1000: 'CONNECT',
  1001: 'EXIT',
  11: 'GET_OPTION',
  12: 'SET_OPTION',
  501: 'GET_OPTIONS_ALL',
  1100: 'GET_VERSION',
  1102: 'AUTH',
  69: 'GET_STATUS?',
  1500: 'PREPARE_DATA',
  1501: 'DATA',
  1502: 'FREE_DATA',
  2000: 'ACK_OK',
  2001: 'ACK_ERROR',
  2005: 'ACK_CONNECT',
  10000: 'GET_TABLE_SCHEMA',
  10002: 'READ_TABLE',
  10033: 'GET_RECORD_COUNT',
};

function parseLog(text) {
  const streams = { 'C->D': [], 'D->C': [] };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/\] (C->D|D->C) #\d+ \(\d+B\) ([0-9a-f]+)$/);
    if (m) streams[m[1]].push(Buffer.from(m[2], 'hex'));
  }
  return streams;
}

function splitFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const idx = buf.indexOf(MAGIC, offset);
    if (idx < 0) break;
    if (idx + 8 > buf.length) break;
    const len = buf.readUInt32LE(idx + 4);
    if (len > 8 * 1024 * 1024) { offset = idx + 4; continue; }
    if (idx + 8 + len > buf.length) break;
    const body = buf.subarray(idx + 8, idx + 8 + len);
    frames.push({
      command: body.readUInt16LE(0),
      session: body.readUInt16LE(4),
      reply: body.readUInt16LE(6),
      data: body.subarray(8),
    });
    offset = idx + 8 + len;
  }
  return frames;
}

function visible(buf) {
  let out = '';
  for (const b of buf) {
    if (b === 0) out += '\\0';
    else if (b === 0x0a) out += '\\n';
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

const text = fs.readFileSync(file, 'utf8');
const streams = parseLog(text);
const reqs = splitFrames(Buffer.concat(streams['C->D']));
const reps = splitFrames(Buffer.concat(streams['D->C']));

console.log(`requests=${reqs.length} responses=${reps.length}\n`);

// Reassemble DATA payloads per exchange.
let pendingSize = 0;
let pending = [];
for (let i = 0; i < reqs.length; i += 1) {
  const q = reqs[i];
  const name = CMD_NAMES[q.command] || `cmd_${q.command}`;
  const dataDesc = q.data.length
    ? `${q.data.length}B ${SHOW_DATA || q.data.length <= 48 ? visible(q.data) : visible(q.data.subarray(0, 48)) + '…'}`
    : '-';
  console.log(`#${i + 1} REQ  reply=${q.reply} ${name}(${q.command}) data=${dataDesc}`);

  const matches = reps.filter((r) => r.reply === q.reply);
  for (const r of matches) {
    const rname = CMD_NAMES[r.command] || `cmd_${r.command}`;
    if (r.command === 1500) {
      pendingSize = r.data.readUInt32LE(0);
      pending = [];
      console.log(`     RSP  ${rname} size=${pendingSize} extra=${r.data.subarray(4).toString('hex')}`);
    } else if (r.command === 1501) {
      pending.push(Buffer.from(r.data));
      console.log(`     RSP  DATA chunk=${r.data.length}B total=${pending.reduce((a, b) => a + b.length, 0)}/${pendingSize}`);
    } else {
      let head = '';
      if (pending.length) {
        const all = Buffer.concat(pending);
        head = `\n     DATA-ASSEMBLED ${all.length}B: ${visible(all.subarray(0, 200))}`;
        pending = [];
      }
      const d = r.data.length
        ? `${r.data.length}B ${SHOW_DATA || r.data.length <= 80 ? visible(r.data) : visible(r.data.subarray(0, 80)) + '…'}`
        : '-';
      console.log(`     RSP  ${rname}(${r.command}) data=${d}${head}`);
    }
  }
  console.log('');
}
