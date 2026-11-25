/**
 * Measure small-column READ_TABLE reads for users and palm templates.
 *
 * Usage: node scripts/bench-subsets.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 600_000 });

try {
  await device.connect();

  const usersStarted = Date.now();
  const users = await device.readTable('user', { columnIds: [1, 2, 3] });
  console.log(
    `users subset [UID,Pin,Name]: rows=${users.length} in ${Date.now() - usersStarted}ms first=${JSON.stringify(users[0] ?? null)}`,
  );

  const palmStarted = Date.now();
  const palm = await device.readTable('pers_biotemplate', {
    columnIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    filter: 'Type=8',
  });
  console.log(
    `palm subset: rows=${palm.length} pins=${new Set(palm.map((r) => String(r.Pin))).size} in ${Date.now() - palmStarted}ms`,
  );

  const free = await device.sendRaw(1502);
  console.log(`FREE_DATA ack=${free.ack}`);
} finally {
  await device.disconnect().catch(() => {});
}
