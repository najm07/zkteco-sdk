/**
 * Establish the bulk fingerprint record framing by matching USERTEMP payloads
 * inside the stream.
 *
 * Usage: node scripts/align-fingerprints-bulk.ts [host]
 */
import { readFileSync } from 'node:fs';
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const file = process.argv[3] ?? 'fingerprints-now.bin';
const bulk = readFileSync(file);
const device = new ZkDevice({ host, timeoutMs: 120_000 });

try {
  await device.connect();
  for (const [uid, fid] of [
    [323, 6],
    [5, 6],
  ] as const) {
    const tpl = await device.getFingerprintTemplate(uid, fid);
    if (!tpl) {
      console.log(`uid=${uid} fid=${fid}: no USERTEMP template`);
      continue;
    }
    const at = bulk.indexOf(tpl);
    console.log(
      `uid=${uid} fid=${fid}: usertemp=${tpl.length} foundAt=${at} recordStart=${at >= 0 ? at - 6 : 'n/a'}`,
    );
    if (at >= 0) {
      const start = at - 6;
      console.log(
        `  header: ${bulk.subarray(start, at).toString('hex')} size=${bulk.readUInt16LE(start)} recordSpan=${at + tpl.length - start}`,
      );
    }
  }

  // Walk candidates using "size = data length" and print where alignment breaks.
  let offset = 4;
  for (let i = 0; i < 8 && offset + 6 <= bulk.length; i++) {
    const size = bulk.readUInt16LE(offset);
    const uid = bulk.readUInt16LE(offset + 2);
    const fid = bulk[offset + 4];
    const next = offset + 6 + size;
    console.log(
      `walk #${i} offset=${offset} size=${size} uid=${uid} fid=${fid} next=${next} plausible=${size > 0 && size < 2000 && next <= bulk.length}`,
    );
    if (!(size > 0 && size < 2000 && next <= bulk.length)) break;
    offset = next;
  }
} finally {
  await device.disconnect().catch(() => {});
}
