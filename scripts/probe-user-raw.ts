import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });
try {
  await device.connect();
  const t = await device.table('user');
  console.log('user columns:', t.columns);
  console.log('ordinals:', t.ordinals);
  const raw = await device.readTableRaw(t.id, t.ordinals, 'Pin=1');
  console.log('raw length for Pin=1:', raw.length);
  console.log('raw first 12 hex:', raw.subarray(0, 12).toString('hex'));
  // decode via SDK
  const rows = await device.readTable('user', { filter: 'Pin=1' });
  console.log('decoded row keys:', Object.keys(rows[0] ?? {}));
  console.log('decoded UID/Pin/Name:', rows[0]?.UID, rows[0]?.Pin, rows[0]?.Name);
} finally {
  await device.disconnect().catch(() => {});
}
