/**
 * End-to-end benchmark of the biometrics read path used by
 * `DeviceBiometricsService`, but with wall-clock timings per device command.
 *
 * Usage: node scripts/bench-biometrics.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const value = await fn();
  console.log(`${label}: ${Date.now() - started}ms`);
  return value;
}

try {
  const total = Date.now();
  await device.connect();

  const directory = await timed('userDirectory (UID,Pin,Name)', () =>
    device.userDirectory(),
  );
  console.log(`  users=${directory.length}`);

  const table = await device.table('pers_biotemplate');
  const counterColumns = table.ordinals.filter(
    (_, index) => table.columns[index] !== 'Tmp',
  );
  console.log(`  counter columns=${counterColumns.join(',')}`);

  for (const [name, type] of [
    ['face counters', 2],
    ['palm counters', 8],
  ] as const) {
    const rows = await timed(name, () =>
      device.readTable('pers_biotemplate', {
        columnIds: counterColumns,
        filter: `Type=${type}`,
      }),
    );
    const pins = new Set(rows.map((row) => String(row.Pin)));
    console.log(`  rows=${rows.length} pins=${pins.size}`);
  }

  const slots = await timed('fingerprints (DATA_WRRQ)', () =>
    device.fingerprints(),
  );
  const bytes = slots.reduce((sum, slot) => sum + slot.data.length, 0);
  console.log(
    `  slots=${slots.length} users=${new Set(slots.map((s) => s.uid)).size} templateBytes=${bytes}`,
  );

  console.log(`total: ${Date.now() - total}ms`);
} finally {
  await device.disconnect().catch(() => {});
}
