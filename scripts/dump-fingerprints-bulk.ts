/**
 * Dump and walk the fingerprint bulk stream (`DATA_WRRQ` 1503).
 *
 * Usage: node scripts/dump-fingerprints-bulk.ts [host] [outFile]
 */
import { writeFileSync } from 'node:fs';
import { ZkDevice } from '../src/ZkDevice.ts';
import { FINGERPRINTS_BULK_REQUEST } from '../src/protocol/fingerprints.ts';

const host = process.argv[2] ?? '192.168.1.100';
const out = process.argv[3] ?? 'fingerprints-now.bin';
const device = new ZkDevice({ host, timeoutMs: 120_000 });

try {
  await device.connect();
  const started = Date.now();
  const payload = await device.bulkRead(FINGERPRINTS_BULK_REQUEST);
  writeFileSync(out, payload);
  console.log(`payload=${payload.length} bytes in ${Date.now() - started}ms -> ${out}`);
  console.log(`header declared=${payload.readUInt32LE(0)}`);
  console.log(`first96=${payload.subarray(0, 96).toString('hex')}`);

  let offset = 4;
  let records = 0;
  while (offset + 6 <= payload.length && records < 12) {
    const size = payload.readUInt16LE(offset);
    const uid = payload.readUInt16LE(offset + 2);
    const fid = payload[offset + 4];
    const valid = payload[offset + 5];
    console.log(
      `#${records} offset=${offset} size=${size} uid=${uid} fid=${fid} valid=${valid} head=${payload.subarray(offset + 6, offset + 14).toString('hex')}`,
    );
    offset += 6 + size;
    records++;
  }
} finally {
  await device.disconnect().catch(() => {});
}
