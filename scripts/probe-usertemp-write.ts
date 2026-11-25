import { ZkDevice } from '../src/ZkDevice.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });
const UID = 5000;
const PIN = '9900';

async function cleanup() {
  try {
    await device.deleteFingerprintTemplate(UID, 0);
  } catch {}
  try {
    await device.deleteRows('user', `Pin=${PIN}`);
  } catch {}
}

try {
  await device.connect();
  const tpl = await device.getFingerprintTemplate(323, 6);
  if (!tpl) throw new Error('no source template');
  console.log('source template bytes:', tpl.length);

  await device.setUserInfo({ uid: UID, pin: PIN, name: 'zzprobe' });
  console.log('user created');

  const candidates: Array<[string, Buffer]> = [
    ['A size+uid+fid+valid', (() => {
      const h = Buffer.alloc(6);
      h.writeUInt16LE(6 + tpl.length, 0);
      h.writeUInt16LE(UID, 2);
      h[4] = 0;
      h[5] = 1;
      return Buffer.concat([h, tpl]);
    })()],
    ['B uid+fid+valid+size', (() => {
      const h = Buffer.alloc(6);
      h.writeUInt16LE(UID, 0);
      h[2] = 0;
      h[3] = 1;
      h.writeUInt16LE(6 + tpl.length, 4);
      return Buffer.concat([h, tpl]);
    })()],
    ['C uid+fid+template', (() => {
      const h = Buffer.alloc(3);
      h.writeUInt16LE(UID, 0);
      h[2] = 0;
      return Buffer.concat([h, tpl]);
    })()],
    ['D uid+fid+valid+template(no size)', (() => {
      const h = Buffer.alloc(4);
      h.writeUInt16LE(UID, 0);
      h[2] = 0;
      h[3] = 1;
      return Buffer.concat([h, tpl]);
    })()],
  ];

  for (const [name, payload] of candidates) {
    console.log(`--- ${name} (payload ${payload.length})`);
    let ack = 0;
    try {
      ack = await device.probeUserTempWrq(payload);
    } catch (e) {
      console.log('  threw:', e instanceof Error ? e.message : String(e));
      // reconnect
      try { await device.disconnect(); } catch {}
      await new Promise((r) => setTimeout(r, 1000));
      await device.connect();
      await device.setUserInfo({ uid: UID, pin: PIN, name: 'zzprobe' }).catch(() => {});
      continue;
    }
    console.log('  ack:', ack);
    const back = await device.getFingerprintTemplate(UID, 0);
    console.log('  readback:', back ? back.length : null, 'match:', back?.equals(tpl));
    if (back && back.equals(tpl)) {
      console.log('  *** SUCCESS ***');
    }
    // delete before next attempt
    await device.deleteFingerprintTemplate(UID, 0);
  }
} catch (error) {
  console.error('ERROR:', error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
  await device.disconnect().catch(() => {});
}
