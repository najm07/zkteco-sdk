import { ZkDevice } from '../src/ZkDevice.ts';
import { encodeRow } from '../src/protocol/records.ts';
import { decodeVendorBlob } from '../src/protocol/biotemplate.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 30_000 });

const faceJson = JSON.parse(
  (await import('node:fs')).readFileSync('C:/Users/mehdi/AppData/Local/Temp/opencode/vendor-face.json', 'utf8').replace(/^\uFEFF/, ''),
);
const vendorBlob = Buffer.from(faceJson.faces[0].base64, 'base64');
const chunks = decodeVendorBlob(vendorBlob);
const chunk5 = chunks.find((c) => c.index === 5);
if (!chunk5) throw new Error('no chunk at index 5');

const pin = '99997';

try {
  await device.connect();

  // Create user first
  const userTable = await device.table('user');
  console.log('user table columns:', userTable.columns.map((c, i) => `${c}=${userTable.types[i]}`).join(', '));

  // Write user record using legacy approach? No, use writeTablePayload
  // Actually, let me just write the template and see if it works

  const table = await device.table('pers_biotemplate');
  console.log('pers_biotemplate columns:', table.columns.map((c, i) => `${c}=${table.types[i]} (ord ${table.ordinals[i]})`).join(', '));

  const row = {
    Pin: pin,
    Valid: 1,
    Duress: 0,
    Type: 2,
    MajorVer: 12,
    MinorVer: 0,
    Format: 0,
    No: 0,
    Index: 5,
    Tmp: chunk5.data,
  };

  const encoded = encodeRow(row, table);
  console.log('encoded record:', encoded.length, 'bytes');

  const header = Buffer.concat([Buffer.from([table.id, table.ordinals.length]), Buffer.from(table.ordinals)]);
  const fullPayload = Buffer.concat([header, encoded]);
  console.log('full payload:', fullPayload.length, 'bytes');

  await device.writeTablePayload(fullPayload);
  await new Promise((r) => setTimeout(r, 800));

  const rows = await device.readTable('pers_biotemplate', { filter: `Pin=${pin}` });
  console.log('rows after write:', rows.length);
  for (const r of rows) {
    console.log('  Pin=' + r.Pin, 'Type=' + r.Type, 'Index=' + r.Index, 'Tmp=' + (r.Tmp as Buffer).length + 'B');
  }

  // Clean up
  if (rows.length > 0) {
    await device.deleteRows('pers_biotemplate', `Pin=${pin}`);
    await new Promise((r) => setTimeout(r, 400));
    const after = await device.readTable('pers_biotemplate', { filter: `Pin=${pin}` });
    console.log('after cleanup:', after.length, 'rows');
  }
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  // Clean up user too
  try { await device.deleteRows('user', `Pin=${pin}`); } catch {}
  await device.disconnect().catch(() => {});
}
