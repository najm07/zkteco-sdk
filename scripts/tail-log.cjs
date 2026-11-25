/**
 * Print the tail of a proxy capture as request/response pairs.
 *
 * Usage: node scripts/tail-log.cjs <logfile> [count]
 */
'use strict';

const fs = require('node:fs');

const file = process.argv[2];
const count = Number(process.argv[3] || 10);
const MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);

const text = fs.readFileSync(file, 'utf8');

function frames(dir) {
  const chunks = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(new RegExp(`\\] ${dir} #\\d+ \\(\\d+B\\) ([0-9a-f]+)$`));
    if (m) chunks.push(Buffer.from(m[1], 'hex'));
  }
  const buf = Buffer.concat(chunks);
  const out = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const idx = buf.indexOf(MAGIC, offset);
    if (idx < 0 || idx + 8 > buf.length) break;
    const len = buf.readUInt32LE(idx + 4);
    if (idx + 8 + len > buf.length) break;
    const body = buf.subarray(idx + 8, idx + 8 + len);
    out.push({
      cmd: body.readUInt16LE(0),
      session: body.readUInt16LE(4),
      reply: body.readUInt16LE(6),
      data: body.subarray(8),
    });
    offset = idx + 8 + len;
  }
  return out;
}

const requests = frames('C->D');
const responses = frames('D->C');

for (const req of requests.slice(-count)) {
  console.log(`REQ cmd=${req.cmd} reply=${req.reply} len=${req.data.length} ${req.data.toString('hex').slice(0, 120)}`);
  for (const res of responses.filter((r) => r.reply === req.reply)) {
    console.log(`  RSP cmd=${res.cmd} len=${res.data.length} ${res.data.toString('hex').slice(0, 80)}`);
  }
}
