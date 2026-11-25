/**
 * Inspect what the device actually stores in the tables the HRMS app needs:
 * people, punches, and opaque biometric templates.
 *
 * Usage: node scripts/inspect.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 20_000 });

const start = Date.now();
try {
  await device.connect();
  const identity = await device.identify();
  console.log('identity:', identity);

  const users = await device.users();
  const names = users.filter((u) => Buffer.isBuffer(u.Name) && (u.Name as Buffer).length > 0);
  console.log(`\nusers: ${users.length} (${names.length} with a name)`);
  console.log('sample:', users.slice(0, 5).map((u) => ({
    pin: u.Pin,
    name: Buffer.isBuffer(u.Name) ? (u.Name as Buffer).toString('utf8') : u.Name,
    group: u.Group,
    pri: u.Pri,
    card: u.CardNo,
  })));

  const punches = await device.attendance();
  const stamps = punches
    .map((p) => Number(p.time_second))
    .filter((n) => Number.isFinite(n) && n > 0);
  const first = new Date(Math.min(...stamps) * 1000);
  const last = new Date(Math.max(...stamps) * 1000);
  console.log(`\ntransactions: ${punches.length}`);
  console.log(`range: ${first.toISOString()} .. ${last.toISOString()}`);
  console.log('sample:', punches.slice(0, 5));

  const bio = await device.biometrics();
  const byType = new Map<number, { count: number; sizes: Set<number>; pins: Set<string>; indices: Set<number> }>();
  for (const row of bio) {
    const type = Number(row.Type);
    const tmp = row.Tmp;
    const size = Buffer.isBuffer(tmp) ? tmp.length : 0;
    const entry = byType.get(type) ?? { count: 0, sizes: new Set<number>(), pins: new Set<string>(), indices: new Set<number>() };
    entry.count += 1;
    entry.sizes.add(size);
    entry.pins.add(String(row.Pin));
    entry.indices.add(Number(row.Index));
    byType.set(type, entry);
  }
  console.log(`\npers_biotemplate: ${bio.length} rows`);
  for (const [type, entry] of [...byType].sort((a, b) => a[0] - b[0])) {
    console.log(
      `  type=${type} rows=${entry.count} pins=${entry.pins.size} indices=[${[...entry.indices].sort((a, b) => a - b).join(',')}] sizes=[${[...entry.sizes].sort((a, b) => a - b).join(',')}]`,
    );
  }

  const sample = bio.find((row) => Number(row.Type) === 12);
  if (sample && Buffer.isBuffer(sample.Tmp)) {
    const tmp = sample.Tmp as Buffer;
    console.log(`\nface sample pin=${sample.Pin} no=${sample.No} index=${sample.Index} major=${sample.MajorVer} minor=${sample.MinorVer} format=${sample.Format}`);
    console.log('  first 32 bytes:', tmp.subarray(0, 32).toString('hex'));
  }
  console.log(`\ntotal ${Date.now() - start}ms`);
} finally {
  await device.disconnect().catch(() => {});
}
