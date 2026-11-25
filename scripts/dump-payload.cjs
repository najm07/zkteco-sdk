/**
 * Dump an assembled DATA payload from a proxy capture, with hex + ascii, so the
 * record encoding can be read off real bytes instead of guessed.
 *
 * Usage: node scripts/dump-payload.cjs <logfile> <replyId> [bytes]
 */
'use strict';

const fs = require('node:fs');

const MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
const [file, replyArg, limitArg] = process.argv.slice(2);
const replyId = Number(replyArg);
const limit = Number(limitArg || 256);

const text = fs.readFileSync(file, 'utf8');
const chunks = [];
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/\] D->C #\d+ \(\d+B\) ([0-9a-f]+)$/);
  if (m) chunks.push(Buffer.from(m[1], 'hex'));
}
const buf = Buffer.concat(chunks);

const frames = [];
let offset = 0;
while (offset + 8 <= buf.length) {
  const idx = buf.indexOf(MAGIC, offset);
  if (idx < 0 || idx + 8 > buf.length) break;
  const len = buf.readUInt32LE(idx + 4);
  if (idx + 8 + len > buf.length) break;
  const body = buf.subarray(idx + 8, idx + 8 + len);
  frames.push({
    command: body.readUInt16LE(0),
    reply: body.readUInt16LE(6),
    data: body.subarray(8),
  });
  offset = idx + 8 + len;
}

const parts = frames.filter((f) => f.reply === replyId && f.command === 1501).map((f) => f.data);
const payload = Buffer.concat(parts);
console.log(`reply=${replyId} data chunks=${parts.length} total=${payload.length}B\n`);

for (let i = 0; i < Math.min(payload.length, limit); i += 16) {
  const row = payload.subarray(i, i + 16);
  const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = [...row].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
  console.log(`${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${ascii}`);
}
