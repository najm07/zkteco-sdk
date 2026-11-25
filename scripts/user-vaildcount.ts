/**
 * Check whether the user table exposes per-user biometric counts.
 * Prints pin, name, VaildCount and the sum of VaildCount across users.
 *
 * Usage: node scripts/user-vaildcount.ts [host]
 */
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });
const text = (value: unknown): string =>
  Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '');

try {
  const started = Date.now();
  await device.connect();
  const users = await device.users();
  console.log(`users=${users.length} in ${Date.now() - started}ms`);

  let sum = 0;
  let nonZero = 0;
  for (const user of users) {
    const count = Number(user.VaildCount ?? 0);
    if (count > 0) nonZero++;
    sum += Number.isFinite(count) ? count : 0;
  }
  const interesting = users
    .map((u) => ({
      pin: text(u.Pin),
      name: text(u.Name),
      vaildCount: Number(u.VaildCount ?? 0),
      pri: Number(u.Pri ?? 0),
      uid: Number(u.UID ?? 0),
    }))
    .filter((u) => u.vaildCount > 0);
  console.log(`rows with VaildCount>0: ${nonZero}, sum=${sum}`);
  console.log('first 20 with count:', interesting.slice(0, 20));
  console.log('known pins:', interesting.filter((u) => ['1', '5', '30', '70', '100'].includes(u.pin)));
  const status = await device.status();
  console.log('status fingerprints:', status.fingerprints);
} finally {
  await device.disconnect().catch(() => {});
}
