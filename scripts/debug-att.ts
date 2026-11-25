/**
 * Attendance read experiments.
 *
 * `transaction` reports 541 records but returns zero rows with an empty filter.
 * This tries the plausible filter and column shapes to find the one the
 * firmware actually honours, and prints sizes so the result is unambiguous.
 *
 * Usage: node scripts/debug-att.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';
import { decodeRows } from '../src/protocol/records.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 20_000 });

const head = (buf: Buffer, n = 32): string => buf.subarray(0, n).toString('hex');

try {
  await device.connect();
  const table = await device.table('transaction');
  console.log(`transaction columns: ${table.columns.join(',')}`);
  console.log(`transaction ordinals: ${table.ordinals.join(',')}`);

  const probes: Array<{ label: string; columns: number[]; filter: string }> = [
    { label: 'all columns, empty filter', columns: table.ordinals, filter: '' },
    { label: 'all columns, time>=0', columns: table.ordinals, filter: 'time_second>=0' },
    { label: 'all columns, star', columns: table.ordinals, filter: '*' },
    { label: 'key columns, empty filter', columns: [1, 2, 5, 6], filter: '' },
    { label: 'key columns, time>=0', columns: [1, 2, 5, 6], filter: 'time_second>=0' },
    { label: 'key columns, PIN2>=1', columns: [1, 2, 5, 6], filter: 'PIN2>=1' },
  ];

  for (const probe of probes) {
    try {
      const raw = await device.readTableRaw(table.id, probe.columns, probe.filter);
      console.log(`\n${probe.label}: payload=${raw.length}B head=${head(raw)}`);
      if (raw.length > 2) {
        const decoded = decodeRows(raw, table);
        console.log(`  rows=${decoded.rows.length}`);
        console.log(`  first=${JSON.stringify(decoded.rows[0] ?? null).slice(0, 240)}`);
      }
    } catch (error) {
      console.log(`\n${probe.label}: FAILED ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const rt = await device.table('realtimelog');
  const rtCount = await device.count('realtimelog');
  const rtRaw = await device.readTableRaw(rt.id, rt.ordinals, '');
  console.log(`\nrealtimelog: count=${rtCount} payload=${rtRaw.length}B head=${head(rtRaw)}`);
  if (rtRaw.length > 2) {
    const decoded = decodeRows(rtRaw, rt);
    console.log(`  rows=${decoded.rows.length}`);
    console.log(`  first=${JSON.stringify(decoded.rows[0] ?? null).slice(0, 240)}`);
  }
} finally {
  await device.disconnect().catch(() => {});
}
