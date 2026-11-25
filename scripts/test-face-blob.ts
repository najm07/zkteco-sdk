/**
 * Prove the chunk→vendor-blob conversion against the vendor SDK's own output.
 *
 * Reads the face template from the device with the table protocol, rebuilds the
 * container `GetUserFaceStr` returns, and compares it with a blob captured from
 * the vendor DLL (scripts/com-face2.ps1).
 *
 * Usage: node scripts/test-face-blob.ts <vendor-face.json> [host] [pin]
 */
import { readFileSync } from 'node:fs';

import { ZkDevice } from '../src/ZkDevice.ts';

const file = process.argv[2] ?? 'C:/Users/mehdi/AppData/Local/Temp/opencode/vendor-face.json';
const host = process.argv[3] ?? '192.168.1.100';
const pin = process.argv[4] ?? '1';

const captured = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as {
  faces: Array<{ base64: string }>;
};
const vendorBlob = Buffer.from(captured.faces[0]!.base64, 'base64');
console.log(`vendor blob: ${vendorBlob.length} bytes`);

const device = new ZkDevice({ host, timeoutMs: 30_000 });
try {
  await device.connect();

  const templates = await device.biometricTemplates(`Pin=${pin}`);
  for (const template of templates) {
    console.log(
      `pin ${template.pin} ${template.modality}: ${template.chunks.length} chunks, ${template.bytes} payload bytes, indexes ${template.chunks[0]!.index}..${template.chunks[template.chunks.length - 1]!.index}`,
    );
  }

  const reconstructed = await device.templateBlob(pin);
  if (!reconstructed) throw new Error('no face template to write');

  console.log(`reconstructed: ${reconstructed.length} bytes`);
  const identical = reconstructed.equals(vendorBlob);
  console.log(`byte-identical to the vendor SDK: ${identical}`);

  if (!identical) {
    let firstDiff = -1;
    const limit = Math.min(reconstructed.length, vendorBlob.length);
    for (let i = 0; i < limit; i += 1) {
      if (reconstructed[i] !== vendorBlob[i]) {
        firstDiff = i;
        break;
      }
    }
    console.log(`first difference at ${firstDiff}`);
    if (firstDiff >= 0) {
      console.log(`  ours:   ${reconstructed.subarray(Math.max(0, firstDiff - 8), firstDiff + 16).toString('hex')}`);
      console.log(`  vendor: ${vendorBlob.subarray(Math.max(0, firstDiff - 8), firstDiff + 16).toString('hex')}`);
    }
    process.exitCode = 1;
  }

  const palm = templates.find((t) => t.modality === 'palm');
  console.log(
    palm
      ? `palm template present: ${palm.chunks.length} chunks, ${palm.bytes} payload bytes`
      : 'no palm template for this pin',
  );
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
