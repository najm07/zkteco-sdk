import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });
try {
  await device.connect();
  const users = await device.readTable('user', { filter: 'Pin=30' });
  console.log('user Pin=30:', JSON.stringify(users, (_k, v) => Buffer.isBuffer(v) ? v.toString('hex') : v));

  const faceRows = await device.readTable('pers_biotemplate', { filter: 'Pin=30?Type=2' });
  console.log('face rows Pin=30 Type=2:', faceRows.length);
  for (const r of faceRows) console.log('  row:', { Pin: r.Pin, Type: r.Type, Index: r.Index, TmpLen: (r.Tmp as Buffer).length });

  const allFacePins = new Set((await device.readTable('pers_biotemplate', { filter: 'Type=2' })).map((r) => String(r.Pin)));
  console.log('Pin=30 in all face pins?', allFacePins.has('30'));
  console.log('sample face pins:', [...allFacePins].slice(0, 10));

  const tmpl = await device.biometricTemplates('Pin=30');
  console.log('biometricTemplates(Pin=30):', tmpl.map((t) => ({ type: t.type, chunks: t.chunks.length, bytes: t.bytes })));
} finally {
  await device.disconnect().catch(() => {});
}
