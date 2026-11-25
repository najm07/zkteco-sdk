import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });
const UID = 5002;
const PIN = '9902';

async function cleanup() {
  try { await device.deleteBiometric(PIN); } catch {}
  try { await device.deleteRows('user', `Pin=${PIN}`); } catch {}
}

try {
  await device.connect();
  const tpl = await device.getFingerprintTemplate(323, 6);
  if (!tpl) throw new Error('no source template');

  await device.setUserInfo({ uid: UID, pin: PIN, name: 'zzsdk' });
  console.log('user created');

  await device.enrollBiometric(PIN, 1, [{ index: 0, data: tpl }]);
  console.log('enrollBiometric ok');

  const back = await device.getFingerprintTemplate(UID, 0);
  console.log('readback:', back ? back.length : null, 'match:', back?.equals(tpl));

  // bulk check
  const bulk = await device.bulkRead(Buffer.from('0107000200000000000000', 'hex'));
  let found = false, o = 4;
  while (o + 6 <= bulk.length) {
    const size = bulk.readUInt16LE(o);
    if (size < 6 || o + size > bulk.length) break;
    if (bulk.readUInt16LE(o + 2) === UID && bulk[o + 4] === 0) { found = true; break; }
    o += size;
  }
  console.log('in bulk stream:', found);

  await device.deleteBiometric(PIN);
  console.log('deleted');
  const after = await device.getFingerprintTemplate(UID, 0);
  console.log('after delete:', after ? after.length : null);
} catch (e) {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
} finally {
  await cleanup();
  await device.disconnect().catch(() => {});
}
