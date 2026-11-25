/**
 * Filtered reads against real hardware.
 *
 * Checks that the encoder reproduces what the vendor shim sent, then proves the
 * device accepts it by comparing filtered results with the unfiltered table.
 *
 * Usage: node scripts/test-filter.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 20_000 });

const name = (value: unknown): string =>
  Buffer.isBuffer(value) ? value.toString('latin1') : String(value);

try {
  await device.connect();

  const total = await device.count('user');
  console.log(`users: ${total}`);

  const one = await device.count('user', 'Pin=1');
  console.log(`count Pin=1: ${one}`);

  const row = await device.readTable('user', { filter: 'Pin=1' });
  console.log(`read Pin=1 -> ${row.length} row(s):`, {
    UID: row[0]?.UID,
    Pin: row[0]?.Pin,
    Name: name(row[0]?.Name),
    Pri: row[0]?.Pri,
  });

  const subset = await device.readTable('user', { columnIds: [2, 3], filter: 'Pin=12' });
  console.log(`subset Pin=12 -> ${subset.length} row(s):`, {
    UID: subset[0]?.UID,
    Pin: subset[0]?.Pin,
    Name: name(subset[0]?.Name),
  });

  const bioCount = await device.count('pers_biotemplate', 'Pin=1\tType=2');
  const bio = await device.readTable('pers_biotemplate', { filter: 'Pin=1\tType=2' });
  console.log(`biometrics Pin=1 Type=2: count=${bioCount} rows=${bio.length}`);
  for (const b of bio.slice(0, 3)) {
    console.log('  ', { Pin: b.Pin, Type: b.Type, Index: b.Index, bytes: Buffer.isBuffer(b.Tmp) ? b.Tmp.length : 0 });
  }

  const all = await device.readTable('user');
  const filtered = await device.readTable('user', { filter: 'Group=1' });
  const expected = all.filter((r) => Number(r.Group) === 1).length;
  console.log(`Group=1: filtered=${filtered.length} expected=${expected} (of ${all.length})`);

  let rejected = false;
  try {
    await device.readTable('user', { filter: 'Pri>=1' });
  } catch (error) {
    rejected = true;
    console.log('operator filter rejected locally:', (error as Error).message);
  }
  if (!rejected) throw new Error('a non-equality filter was sent to the device');
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
