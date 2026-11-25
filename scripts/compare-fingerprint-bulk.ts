/**
 * Compare a USERTEMP fingerprint template with the same record in the
 * DATA_WRRQ bulk payload, to establish the bulk record layout.
 *
 * Usage: node scripts/compare-fingerprint-bulk.ts [host] [uid] [fid]
 */
import { readFileSync } from 'node:fs';
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const uid = Number(process.argv[3] ?? 5);
const fid = Number(process.argv[4] ?? 6);

const bulk = readFileSync('fingerprints-wrrq.bin');
const device = new ZkDevice({ host, timeoutMs: 180_000 });

try {
  await device.connect();
  const template = await device.getFingerprintTemplate(uid, fid);
  if (!template) {
    console.log('no template via USERTEMP');
  } else {
    console.log(`USERTEMP uid=${uid} fid=${fid} bytes=${template.length}`);
    console.log(`  first32=${template.subarray(0, 32).toString('hex')}`);
    // Find the template (minus its first two bytes) in the bulk payload.
    const needle = template.subarray(2, 18);
    const at = bulk.indexOf(needle);
    console.log(`  bulk match for bytes[2..18] at ${at}`);
    if (at > 0) {
      const recordStart = at - 8;
      console.log(
        `  record guess at ${recordStart}: ${bulk.subarray(recordStart, recordStart + 24).toString('hex')}`,
      );
      const size = bulk.readUInt16LE(recordStart);
      const recordUid = bulk.readUInt16LE(recordStart + 2);
      const recordFid = bulk[recordStart + 4];
      const valid = bulk[recordStart + 5];
      const data = bulk.subarray(recordStart + 6, recordStart + 6 + size);
      console.log(
        `  size=${size} uid=${recordUid} fid=${recordFid} valid=${valid} dataBytes=${data.length}`,
      );
      let diff = 0;
      const n = Math.min(data.length, template.length);
      for (let i = 0; i < n; i++) if (data[i] !== template[i]) diff++;
      console.log(
        `  compare: common=${n} diffs=${diff} bulk[0..8]=${data.subarray(0, 8).toString('hex')} usertemp[0..8]=${template.subarray(0, 8).toString('hex')}`,
      );
      const firstDiff = (() => {
        for (let i = 0; i < n; i++) if (data[i] !== template[i]) return i;
        return -1;
      })();
      console.log(`  firstDiff=${firstDiff}`);
      if (firstDiff >= 0) {
        console.log(
          `  around diff: bulk=${data.subarray(Math.max(0, firstDiff - 4), firstDiff + 8).toString('hex')} usertemp=${template.subarray(Math.max(0, firstDiff - 4), firstDiff + 8).toString('hex')}`,
        );
      }
    } else {
      console.log('  template not found in bulk payload');
    }
  }
} finally {
  await device.disconnect().catch(() => {});
}
