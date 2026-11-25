/**
 * Measure READ_TABLE with a column subset that excludes Tmp.
 *
 * The biometrics status endpoint only needs Pin/Type/Index/Valid. If the device
 * honours the column list, the transfer shrinks from megabytes to kilobytes.
 *
 * Usage: node scripts/bench-columns.ts [host] [type]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const type = Number(process.argv[3] ?? 2);

const device = new ZkDevice({ host, timeoutMs: 600_000 });

try {
  await device.connect();
  const table = await device.table('pers_biotemplate');
  const noTmp = table.ordinals.filter((_, index) => table.columns[index] !== 'Tmp');
  console.log(`table=${table.name} id=${table.id} columns=${table.columns.join(',')}`);
  console.log(`columnIds without Tmp: ${noTmp.join(',')}`);

  for (const filter of [`Type=${type}`]) {
    const started = Date.now();
    const rows = await device.readTable(table.id, {
      columnIds: noTmp,
      filter,
    });
    console.log(
      `${filter}: rows=${rows.length} elapsed=${Date.now() - started}ms first=${JSON.stringify(rows[0] ?? null)}`,
    );
    const pins = new Set(rows.map((row) => String(row.Pin)));
    console.log(`  pins=${pins.size}`);
  }

  const free = await device.sendRaw(1502);
  console.log(`FREE_DATA ack=${free.ack}`);
} finally {
  await device.disconnect().catch(() => {});
}
