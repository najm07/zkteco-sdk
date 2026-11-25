/**
 * Raw READ_TABLE probe. Prints request/response size per table so "returns
 * nothing" can be attributed to the request rather than the decoder.
 *
 * Usage: node scripts/debug-read.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 20_000 });

try {
  await device.connect();
  for (const name of ['user', 'transaction', 'pers_biotemplate', 'templatev10'] as const) {
    const table = await device.table(name);
    const count = await device.count(name);
    const raw = await device.readTableRaw(table.id, table.ordinals);
    console.log(
      `${name}: id=${table.id} columns=${table.columns.length} count=${count} payload=${raw.length}B head=${raw.subarray(0, 24).toString('hex')}`,
    );
    if (raw.length > 2) {
      const rows = await device.readTable(name);
      console.log(`  decoded=${rows.length} first=${JSON.stringify(rows[0] ?? null).slice(0, 240)}`);
    }
  }
} finally {
  await device.disconnect().catch(() => {});
}
