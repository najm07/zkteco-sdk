/**
 * Compare a vendor `GetUserFaceStr` blob with the `pers_biotemplate` chunks.
 *
 * The vendor returns one base64 string; the table protocol returns 2016-byte
 * chunks each prefixed with `6a 95 01 10 <len16>`. This establishes how the
 * two views relate, which decides whether face templates can be moved between
 * devices without the vendor DLL.
 *
 * Usage: node scripts/compare-face.ts <vendor-face.json> [host] [pin]
 */
import { readFileSync } from 'node:fs';

import { ZkDevice } from '../src/ZkDevice.ts';

const file = process.argv[2] ?? 'C:/Users/mehdi/AppData/Local/Temp/opencode/vendor-face.json';
const host = process.argv[3] ?? '192.168.1.100';
const pin = process.argv[4] ?? '1';

const vendor = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as {
  pin: string;
  faces: Array<{ index: number; length: number; base64: string }>;
};

const blob = Buffer.from(vendor.faces[0]!.base64, 'base64');
console.log(`vendor blob: ${blob.length} bytes from ${vendor.faces.length} index(es), length field ${vendor.faces[0]!.length}`);
console.log(`  head: ${blob.subarray(0, 32).toString('hex')}`);

const magicOffsets: number[] = [];
for (let i = 0; i + 1 < blob.length; i += 1) {
  if (blob[i] === 0x6a && blob[i + 1] === 0x95) magicOffsets.push(i);
}
console.log(`  occurrences of 6a95: ${magicOffsets.length} at ${magicOffsets.slice(0, 8).join(', ')}${magicOffsets.length > 8 ? ' ...' : ''}`);

const device = new ZkDevice({ host, timeoutMs: 30_000 });
try {
  await device.connect();
  const rows = await device.readTable('pers_biotemplate', { filter: `Pin=${pin}\tType=2` });
  const chunks = rows
    .map((r) => ({ index: Number(r.Index), tmp: r.Tmp as Buffer }))
    .sort((a, b) => a.index - b.index);

  console.log(`device chunks: ${chunks.length}`);
  for (const c of chunks) {
    console.log(`  index ${c.index}: ${c.tmp.length} bytes, head ${c.tmp.subarray(0, 8).toString('hex')}`);
  }

  const concatenated = Buffer.concat(chunks.map((c) => c.tmp));
  console.log(`concatenated chunks: ${concatenated.length} bytes`);

  const firstMatch = blob.indexOf(concatenated);
  console.log(`concatenation found in vendor blob at: ${firstMatch}`);

  if (firstMatch >= 0) {
    const preamble = blob.subarray(0, firstMatch);
    console.log(`preamble (${preamble.length} bytes): ${preamble.toString('hex')}`);
    const trailer = blob.subarray(firstMatch + concatenated.length);
    console.log(`trailer (${trailer.length} bytes): ${trailer.subarray(0, 64).toString('hex')}`);
  } else {
    // Compare chunk payloads without their 6-byte envelope against the blob.
    const payloads = chunks.map((c) => c.tmp.subarray(6));
    let found = 0;
    for (const [i, payload] of payloads.entries()) {
      const at = blob.indexOf(payload);
      if (at >= 0) found += 1;
      if (i < 3) console.log(`  payload ${i} (${payload.length} B) at ${at}`);
    }
    console.log(`payloads found individually in blob: ${found}/${payloads.length}`);
    const joined = Buffer.concat(payloads);
    console.log(`payload concat length ${joined.length}, found at ${blob.indexOf(joined)}`);
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
