/**
 * Live protocol probe against a ZKTeco device.
 *
 * Purpose: establish, empirically, the framing of the pull protocol / standalone
 * protocol on port 4370 before committing implementation to it. Never guess a
 * wire format you can observe.
 *
 * Usage: node scripts/probe.cjs [host] [port]
 */
'use strict';

const net = require('node:net');

const HOST = process.argv[2] || '192.168.1.100';
const PORT = Number(process.argv[3] || 4370);

const CMD = {
  CONNECT: 1000,
  EXIT: 1001,
  ENABLE_DEVICE: 1002,
  DISABLE_DEVICE: 1003,
  RESTART: 1004,
  POWEROFF: 1005,
  SLEEP: 1006,
  RESUME: 1007,
  GET_TIME: 201,
  SET_TIME: 202,
  OPTIONS_RRQ: 11,
  OPTIONS_WRQ: 12,
  ATTLOG_RRQ: 13,
  CLEAR_DATA: 14,
  CLEAR_ATTLOG: 15,
  DELETE_USER: 18,
  DELETE_USERTEMP: 19,
  CLEAR_ADMIN: 20,
  GET_FREE_SIZES: 50,
  VERSION: 1100,
  AUTH: 1102,
  ACK_OK: 2000,
  ACK_ERROR: 2001,
  ACK_DATA: 2002,
  ACK_UNAUTH: 2005,
  PREPARE_DATA: 1500,
  DATA: 1501,
  FREE_DATA: 1502,
  DATA_WRRQ: 1503,
  REG_EVENT: 500,
};

const CMD_NAME = Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k]));

function checksum(payload) {
  let sum = 0;
  for (let i = 0; i < payload.length; i += 2) {
    const lo = payload[i];
    const hi = i + 1 < payload.length ? payload[i + 1] : 0;
    sum = (sum + (lo | (hi << 8))) & 0xffff;
  }
  return (-sum) & 0xffff;
}

function frame(command, session, reply, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(command, 0);
  header.writeUInt16LE(checksum(payload), 2);
  header.writeUInt16LE(session, 4);
  header.writeUInt16LE(reply, 6);
  return Buffer.concat([header, payload]);
}

function describe(buf) {
  if (buf.length < 8) return `<short: ${buf.length} bytes> ${buf.toString('hex')}`;
  const command = buf.readUInt16LE(0);
  const check = buf.readUInt16LE(2);
  const session = buf.readUInt16LE(4);
  const reply = buf.readUInt16LE(6);
  const payload = buf.subarray(8);
  const name = CMD_NAME[command] || `cmd_${command}`;
  return `${name}(${command}) session=${session} reply=${reply} chk=0x${check.toString(16)} len=${payload.length} hex=${payload.subarray(0, 64).toString('hex')}`;
}

function probe(label, command, session, reply, payload) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: HOST, port: PORT });
    const chunks = [];
    let done = false;
    const finish = (note) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve({ label, note, chunks });
    };
    sock.setTimeout(4000);
    sock.on('connect', () => {
      const packet = frame(command, session, reply, payload);
      console.log(`\n--- ${label} ---`);
      console.log(`tx raw: ${packet.toString('hex')}`);
      sock.write(packet);
    });
    sock.on('data', (d) => {
      chunks.push(Buffer.from(d));
      console.log(`rx raw: ${d.toString('hex')}`);
      console.log(`rx     : ${describe(d)}`);
      setTimeout(() => finish('ok'), 400);
    });
    sock.on('timeout', () => finish('timeout'));
    sock.on('error', (e) => finish(`error: ${e.message}`));
    sock.on('close', () => finish('closed'));
  });
}

(async () => {
  console.log(`probing ${HOST}:${PORT} with node ${process.version}`);
  await probe('CONNECT (bare 8-byte header)', CMD.CONNECT, 0, 0);

  // If CONNECT answers, reuse whatever session it hands back for a follow-up.
  const first = await probe('CONNECT (repeat for session id)', CMD.CONNECT, 0, 0);
  const reply = first.chunks.find((c) => c.length >= 8);
  if (!reply) {
    console.log('\nNo 8-byte response received; framing assumption is wrong or device refused.');
    return;
  }
  const session = reply.readUInt16LE(4);
  console.log(`\n== using session=0x${session.toString(16)} for follow-up commands`);

  await probe('VERSION', CMD.VERSION, session, 1);
  await probe('GET_TIME', CMD.GET_TIME, session, 2);
  await probe('OPTIONS_RRQ ~SerialNumber', CMD.OPTIONS_RRQ, session, 3, Buffer.from('~SerialNumber\0', 'ascii'));
  await probe('GET_FREE_SIZES', CMD.GET_FREE_SIZES, session, 4);
})();
