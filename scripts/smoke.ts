/**
 * Live acceptance test against real hardware. Proves the pure-TypeScript client
 * talks to the device with no vendor DLL and no 32-bit process.
 *
 * Reading `transaction` drains the device's log, so attendance is only read
 * when explicitly requested with `--attendance`.
 *
 * Usage: node scripts/smoke.ts [host] [--attendance]
 */
import { decodeVendorBlob } from '../src/protocol/biotemplate.ts';
import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const readAttendance = process.argv.includes('--attendance');
const device = new ZkDevice({ host, timeoutMs: 20_000 });

const started = Date.now();
const step = (label: string): void => {
  console.log(`  ${label} (${Date.now() - started}ms)`);
};

try {
  await device.connect();
  step('connected');

  const identity = await device.identify();
  console.log('identity:', identity);
  step('identified');

  const schema = await device.schema();
  console.log(`tables: ${schema.length}`);
  step('schema');

  const userCount = await device.count('user');
  const users = await device.users();
  console.log(`users: count ${userCount}, rows ${users.length}`);
  const first = users[0]!;
  console.log('first user:', {
    UID: first.UID,
    Pin: first.Pin,
    Name: Buffer.isBuffer(first.Name) ? first.Name.toString('latin1') : first.Name,
    Pri: first.Pri,
  });
  step('users');

  const filtered = await device.readTable('user', { filter: 'Pin=1' });
  const subset = await device.readTable('user', { columnIds: [2, 3], filter: 'Pin=1' });
  console.log(
    `filter Pin=1: ${filtered.length} row(s); subset columns ${Object.keys(subset[0] ?? {}).join(',')}`,
  );
  step('filtered read');

  const templates = await device.biometricTemplates();
  const byModality = new Map<string, number>();
  for (const template of templates) {
    byModality.set(template.modality, (byModality.get(template.modality) ?? 0) + 1);
  }
  console.log(
    `biometric templates: ${templates.length}`,
    Object.fromEntries(byModality),
    `chunks: ${templates.reduce((n, t) => n + t.chunks.length, 0)}`,
  );

  const faceBlob = await device.templateBlob(String(first.Pin ?? '1'));
  if (faceBlob) {
    const chunks = decodeVendorBlob(faceBlob);
    console.log(`face blob for pin ${first.Pin}: ${faceBlob.length} bytes, ${chunks.length} chunks`);
  }
  step('biometrics');

  const now = await device.getTime();
  console.log(`device clock: ${now.toISOString()}`);
  step('clock');

  console.log(`attendance count: ${await device.count('transaction')}`);
  if (readAttendance) {
    const punches = await device.attendance();
    console.log(`attendance rows (drained): ${punches.length}`);
    step('attendance');
  } else {
    console.log('attendance rows not read (pass --attendance to drain the log)');
  }

  console.log(`total ${Date.now() - started}ms`);
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await device.disconnect().catch(() => {});
}
