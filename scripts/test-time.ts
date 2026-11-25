/**
 * Device clock round trip against real hardware.
 *
 * Reads the clock, writes back the same instant (a no-op in effect), and checks
 * the value survives. Refuses to run if the clock is far from the local one,
 * because a wrong write would shift every future punch timestamp.
 *
 * Usage: node scripts/test-time.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 20_000 });

try {
  await device.connect();

  const before = await device.getTime();
  console.log('device time:', before.toISOString());
  console.log('local time :', new Date().toISOString());

  const driftMinutes = Math.abs(Date.now() - before.getTime()) / 60_000;
  console.log(`drift: ${driftMinutes.toFixed(1)} minutes`);

  // Write the same instant back: proves the write path without changing state.
  await device.setTime(before);
  console.log('wrote the same instant back');

  const after = await device.getTime();
  console.log('device time after:', after.toISOString());

  const deltaSeconds = Math.abs(after.getTime() - before.getTime()) / 1000;
  console.log(`delta: ${deltaSeconds}s`);
  if (deltaSeconds > 2) throw new Error('clock did not round-trip');
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
