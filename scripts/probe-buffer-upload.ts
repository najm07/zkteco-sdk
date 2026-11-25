import { ZkDevice } from '../src/ZkDevice.ts';
import { FINGERPRINTS_BULK_REQUEST } from '../src/protocol/fingerprints.ts';

const host = process.argv[2] ?? '192.168.1.100';
const device = new ZkDevice({ host, timeoutMs: 120_000 });
const UID = 5000;
const PIN = '9900';
const FID = 0;

function u16le(n: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b; }
function u32le(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

async function cleanup() {
  try { await device.deleteFingerprintTemplate(UID, FID); } catch {}
  try { await device.deleteRows('user', `Pin=${PIN}`); } catch {}
}

try {
  await device.connect();
  const tpl = await device.getFingerprintTemplate(323, 6);
  if (!tpl) throw new Error('no source template');
  console.log('source template bytes:', tpl.length);

  await device.setUserInfo({ uid: UID, pin: PIN, name: 'zzprobe' });
  console.log('user created');

  // bulk user stream
  const userReq = Buffer.from('0109000500000000000000', 'hex');
  const userBulk = await device.bulkRead(userReq);
  console.log('user bulk bytes:', userBulk.length);
  const totalSize = userBulk.readUInt32LE(0);
  console.log('declared total:', totalSize);
  let upack: Buffer | null = null;
  let pos = 4;
  while (pos + 72 <= userBulk.length && pos - 4 < totalSize) {
    const uid = userBulk.readUInt16LE(pos);
    if (uid === UID) {
      upack = Buffer.from(userBulk.subarray(pos, pos + 72));
      break;
    }
    pos += 72;
  }
  if (!upack) throw new Error('uid 5000 not found in user bulk stream');
  console.log('upack bytes:', upack.length, 'first4:', upack.subarray(0, 4).toString('hex'));

  // table entry: pack("<bHbI", 2, uid, 0x10+fid, 0)
  const table = Buffer.alloc(8);
  table[0] = 2;
  table.writeUInt16LE(UID, 1);
  table[3] = (0x10 + FID) & 0xff;
  // tstart u32 at offset 4
  table.writeUInt32LE(0, 4);

  // fpack: repack_only = [size:u16][template]
  const fpack = Buffer.concat([u16le(tpl.length), tpl]);

  const head = Buffer.concat([u32le(upack.length), u32le(table.length), u32le(fpack.length)]);
  const packet = Buffer.concat([head, upack, table, fpack]);
  console.log('packet bytes:', packet.length);

  await device.uploadBuffer(packet);
  console.log('uploaded');

  const ack110 = await device.sendRaw(110, Buffer.from([12, 0, 0, 0, 0, 0, 8, 0]));
  console.log('cmd110 ack:', ack110);

  await device.sendRaw(1013, Buffer.alloc(0)).catch(() => {});
  console.log('refresh done');

  // readback
  await new Promise((r) => setTimeout(r, 500));
  const back = await device.getFingerprintTemplate(UID, FID);
  console.log('readback:', back ? back.length : null, 'match:', back?.equals(tpl));

  // bulk fingerprint stream check
  const fpBulk = await device.bulkRead(Buffer.from('0107000200000000000000', 'hex'));
  console.log('fp bulk bytes:', fpBulk.length);
  let found = false;
  let o = 4;
  while (o + 6 <= fpBulk.length) {
    const size = fpBulk.readUInt16LE(o);
    if (size < 6 || o + size > fpBulk.length) break;
    const uid2 = fpBulk.readUInt16LE(o + 2);
    const fid2 = fpBulk[o + 4];
    if (uid2 === UID && fid2 === FID) { found = true; break; }
    o += size;
  }
  console.log('found in bulk stream:', found);
} catch (error) {
  console.error('ERROR:', error instanceof Error ? error.message : String(error));
} finally {
  await cleanup();
  await device.disconnect().catch(() => {});
}
