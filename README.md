# @exxxp_07/zkteco-sdk

[![CI](https://github.com/najm07/zkteco-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/najm07/zkteco-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@exxxp_07/zkteco-sdk.svg)](https://www.npmjs.com/package/@exxxp_07/zkteco-sdk)

Pure TypeScript client for ZKTeco standalone devices (uFace800 Plus and siblings).

No COM. No `zkemkeeper.dll`. No 32-bit bridge process. It speaks the device's own
TCP protocol on port 4370, so it runs inside a Node/NestJS backend on any
platform Node supports.

## Install

```bash
npm install @exxxp_07/zkteco-sdk
```

Requires Node 18.12 or newer. The published package is compiled ESM JavaScript
with type declarations. The repository also runs the TypeScript sources directly
on Node 22.6+ for tests and scripts.

```ts
import { ZkDevice } from '@exxxp_07/zkteco-sdk';

const device = new ZkDevice({ host: '192.168.1.100' });
await device.connect();

const identity = await device.identify();
console.log(identity.product, identity.serial, identity.firmware);

const users = await device.users();          // 499 rows on the reference device
const faces = await device.biometricTemplates();
await device.disconnect();
```

Everything in this package was verified against a live **uFace800 Plus**
(`Ver 6.60 Nov 21 2019`). Where something could not be verified it is called out
as such instead of being guessed at.

## Status

| Area | Status |
|------|--------|
| Framing, checksum, session handshake | Verified on every captured frame |
| Schema discovery (29 tables) | Verified |
| Reads: users, attendance, biometrics, any table | Verified, 499/499 users decoded |
| Column subsets | Verified |
| Filters (`Column=value`, tab-separated) | Verified on users and biometrics |
| Filters with `<`, `>`, `!=` | Rejected locally - this firmware drops the connection |
| Device clock read/write | Verified, 0 s round-trip drift |
| Row delete by filter | Verified (single-column equality) |
| Biometric chunk ↔ vendor face blob | Byte-identical to `GetUserFaceStr` |
| Biometric template enrollment (`pers_biotemplate`) | **Verified** — table-protocol write, reads back byte-identical |
| User creation (`setUserInfo`, cmd 8) | **Verified** — pin, name, password, privilege, enabled |

### User creation and biometric sync

The vendor app creates users via the legacy command 8 (`CMD_USER_WRQ`, 72-byte
user struct) and uploads biometric templates via the table protocol. Both paths
are now implemented:

- `setUserInfo({ pin, name, password?, privilege?, enabled?, uid? })` — creates
  or updates a user. Verified: users are readable with correct fields and can be
  deleted with `deleteRows('user', 'Pin=...')`.
- `enrollBiometric(pin, type, chunks)` — uploads face/palm/fingerprint templates
  to `pers_biotemplate`. Verified byte-identical round-trip.

This enables the full "create user on device A, sync to device B" flow without
the vendor app. Note: card number, group, timezone and validity-date fields are
not yet mapped in the command 8 struct; `writeTablePayload()` remains available
as a low-level escape hatch for other proven record layouts.
## API

### Connection

```ts
const device = new ZkDevice({
  host: '192.168.1.100',
  port: 4370,        // default
  timeoutMs: 20_000, // default
  keepAliveMs: 30_000, // optional; the device drops idle sessions after ~1 min
});

await device.connect();
await device.disconnect();
```

`connect()` performs the same handshake the vendor client does and then proves
the session with a real read, so a device with a comm key set fails at connect
time rather than halfway through a sync.

### Identity

```ts
const identity = await device.identify();
// { serial, firmware, product, platform, faceVersion, fingerprintVersion }
```

Individual options: `getOption('~DeviceName')`, `getOptions([...])`,
`setOption('SDKBuild=1')`.

### Tables

The device describes its own storage. Prefer that over hardcoded names:

```ts
const tables = await device.schema();     // 29 tables
const usersTable = await device.table('user');
```

```ts
await device.readTable('user');
await device.readTable('user', { columnIds: [2, 3], filter: 'Pin=12' });
await device.count('user');               // 499
await device.count('user', 'Pin=1');      // 1
await device.deleteRows('user', 'Pin=65000');
```

Filters are tab-separated equality conditions, ANDed:

```ts
await device.readTable('pers_biotemplate', { filter: 'Pin=1\tType=2' });
```

Any other operator throws before anything is sent, because this firmware closes
the connection on a filter it cannot parse.

### Attendance

```ts
const punches = await device.attendanceLog();  // full log, non-destructive
```

The device stores attendance as a 40-byte fixed record returned by command 13
(`ATTLOG_RRQ`): a 1-based sequence index, a 24-byte NUL-padded pin, a verify
mode byte (1 = fingerprint, 15 = face, 25 = palm), a device-calendar timestamp
and 9 reserved bytes. `attendanceLog()` returns the whole log in one shot and
does **not** delete anything; two consecutive reads return identical bytes.

`attendance()` (the `transaction` table) is a cursor that the vendor app
usually drains, so it often returns nothing. Prefer `attendanceLog()`.

The device clock tracks UTC on this unit, while the vendor app stores punches
shifted to local time (UTC+1 on the reference installation).

### Status and storage counters

```ts
const status = await device.status();
// users:      { used: 499, capacity: 10000, free: 9501 }
// faces:      { used: 124, capacity: 3000,  free: 2876 }
// fingerprints, attendanceLogs, operationLogs, adminUsers, passwordUsers
```

Command 50 (`GET_FREE_SIZES`) returns 28 counters. The named fields are
cross-checked against `count()` and the user table on hardware; the remaining
words are exposed as `raw` for diagnostics.

### Biometrics

```ts
const templates = await device.biometricTemplates();
for (const template of templates) {
  console.log(template.pin, template.modality, template.chunks.length, template.bytes);
}
```

`modality` is `fingerprint` (type 1), `face` (type 2), `palm` (type 8) or
`unknown`. A face template is 10 or 15 chunks of 2016 bytes; palm templates are
5 or 10 chunks starting at index 0.

`templateBlob(pin, type)` returns exactly the container the vendor's
`GetUserFaceStr` returns:

```ts
const face = await device.templateBlob('1');        // Buffer, 25,760 bytes
const asChunks = decodeVendorBlob(face);            // back to chunks
```

This is byte-identical to the vendor DLL's output for the reference template, so
templates the app already stores in `hr_biotemplate.template_data` can be moved
between formats without loss.

### User creation

```ts
await device.setUserInfo({
  pin: '123',
  name: 'Jane Doe',
  password: '',       // optional, up to 8 chars
  privilege: 0,       // 0 = normal user, 14 = administrator
  enabled: true,
  // uid: 500,        // optional; auto-assigned (max UID + 1) if omitted
});
```

`setUserInfo` uses the legacy command 8 user struct (same as the vendor app).
Verified on hardware: created users are readable via `users()` with correct
fields and can be removed with `deleteRows('user', 'Pin=123')`.

### Cross-device user and biometric sync

Fetch a user and their biometric templates from one device and enroll them on
another so the employee can authenticate on either terminal:

```ts
import { ZkDevice } from '@exxxp_07/zkteco-sdk';

const pin = '123';

// 1. Read user + templates from the source device
const source = new ZkDevice({ host: '192.168.1.100' });
await source.connect();
const [user] = await source.readTable('user', { filter: `Pin=${pin}` });
const templates = await source.biometricTemplates(`Pin=${pin}`);
await source.disconnect();

// 2. Create user and enroll templates on the target device
const target = new ZkDevice({ host: '192.168.1.101' });
await target.connect();

await target.setUserInfo({
  pin,
  name: Buffer.isBuffer(user.Name) ? user.Name.toString('latin1') : String(user.Name ?? ''),
  password: String(user.Password ?? ''),
  privilege: Number(user.Pri ?? 0),
  enabled: true,
});

await target.deleteBiometric(pin); // clear existing templates to avoid duplicates
for (const t of templates) {
  await target.enrollBiometric(t.pin, t.type, t.chunks);
}
await target.disconnect();
```

`enrollBiometric` writes each chunk as a `pers_biotemplate` row via the table
protocol and is verified against hardware (written templates read back
byte-identical). `deleteBiometric(pin)` removes all biometric template rows for
the pin. Card number, group, timezone and validity-date fields are not yet
mapped in `setUserInfo`.

### Clock

```ts
await device.setTime(new Date());
const now = await device.getTime();
```

This firmware uses a device-specific calendar (`31` days per month, epoch 2000),
not a Unix timestamp; both directions are verified.

Device time is zone-less. `decodeDateTime` returns a `Date` whose UTC fields hold
the device wall clock, and `encodeDateTime` reads those same UTC fields, so
round-trips do not depend on the host timezone. `setTime(new Date())` sends UTC
wall-clock time, which matches the reference device.

### Escape hatch

```ts
const { ack, payload } = await device.sendRaw(1501, buffer);
```

Every high-level method is built on this, so protocol work never waits for a
typed wrapper.

## NestJS usage

The package has no native dependencies and ships compiled ESM with type
declarations, so it works in any Node 18.12+ ESM project, including a NestJS
app configured for ESM.

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ZkDevice, type Row } from '@exxxp_07/zkteco-sdk';

@Injectable()
export class DeviceService implements OnModuleDestroy {
  private readonly device = new ZkDevice({
    host: process.env.ZK_HOST ?? '192.168.1.100',
    keepAliveMs: 30_000,
  });

  async syncPunches(): Promise<Row[]> {
    if (!this.device.connected) await this.device.connect();
    return this.device.attendance();
  }

  async onModuleDestroy(): Promise<void> {
    await this.device.disconnect();
  }
}
```

## Tests

```bash
npm test        # 55 offline tests, built from captured bytes
npm run smoke   # live device: connect, identify, read every table
```

The offline tests replay real captured frames, so a refactor that changes the
wire format fails there rather than on a customer's device. Scripts under
`scripts/` are the reverse-engineering harness (vendor shim oracle, TCP proxy,
log decoder, probes) and are kept for provenance.

## Further reading

- [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — the protocol as observed, byte by byte.

## License

MIT. ZKTeco is a trademark of ZKTeco Co., Ltd.; this project is an independent
interoperability client and is not affiliated with or endorsed by ZKTeco.
