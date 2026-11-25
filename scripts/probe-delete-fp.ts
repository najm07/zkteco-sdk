import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });
const UID = 5001;
const PIN = '9901';

async function cleanup() {
  try { await device.deleteFingerprintTemplate(UID, 0); } catch {}
  try { await device.deleteRows('user', `Pin=${PIN}`); } catch {}
}

try {
  await device.connect();
  const tpl = await device.getFingerprintTemplate(323, 6);
  if (!tpl) throw new Error('no source template');
  await device.setUserInfo({ uid: UID, pin: PIN, name: 'zzprobe2' });

  // write via buffer method quickly (reuse helper by inline)
  const userBulk = await device.bulkRead(Buffer.from('0109000500000000000000', 'hex'));
  let upack: Buffer | null = null;
  let pos = 4;
  while (pos + 72 <= userBulk.length && pos - 4 < userBulk.readUInt32LE(0)) {
    if (userBulk.readUInt16LE(pos) === UID) { upack = Buffer.from(userBulk.subarray(pos, pos + 72)); break; }
    pos += 72;
  }
  if (!upack) throw new Error('upack not found');
  const table = Buffer.alloc(8);
  table[0] = 2;
  table.writeUInt16LE(UID, 1);
  table[3] = 0x10;
  table.writeUInt32LE(0, 4);
  const fpack = Buffer.concat([Buffer.from([tpl.length & 0xff, (tpl.length >> 8) & 0xff]), tpl]);
  const head = Buffer.concat([
    Buffer.from([upack.length & 0xff, (upack.length >> 8) & 0xff, (upack.length >> 16) & 0xff, (upack.length >> 24) & 0xff]),
    Buffer.from([table.length & 0xff, (table.length >> 8) & 0xff, (table.length >> 16) & 0xff, (table.length >> 24) & 0xff]),
    Buffer.from([fpack.length & 0xff, (fpack.length >> 8) & 0xff, (fpack.length >> 16) & 0xff, (fpack.length >> 24) & 0xff]),
  ]);
  await device.uploadBuffer(Buffer.concat([head, upack, table, fpack]));
  await device.sendRaw(110, Buffer.from([12, 0, 0, 0, 0, 0, 8, 0]));
  await device.sendRaw(1013, Buffer.alloc(0)).catch(() => {});

  const before = await device.getFingerprintTemplate(UID, 0);
  console.log('before delete:', before ? before.length : null);

  const del = await device.deleteFingerprintTemplate(UID, 0);
  console.log('delete ack-ish (boolean):', del);

  const after = await device.getFingerprintTemplate(UID, 0);
  console.log('after delete:', after ? after.length : null);
} catch (e) {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
} finally {
  await cleanup();
  await device.disconnect().catch(() => {});
}
