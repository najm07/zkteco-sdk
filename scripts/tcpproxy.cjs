/**
 * Transparent TCP proxy with hex logging.
 *
 * Point a vendor client at the local port; it forwards to the real device and
 * records every byte in both directions. This is how we obtain ground truth for
 * a proprietary protocol without a packet capture driver.
 *
 * Usage: node scripts/tcpproxy.cjs <listenPort> <targetHost> <targetPort>
 */
'use strict';

const net = require('node:net');

const listenPort = Number(process.argv[2] || 4371);
const targetHost = process.argv[3] || '192.168.1.100';
const targetPort = Number(process.argv[4] || 4370);

const stamp = () => new Date().toISOString().slice(11, 23);

net
  .createServer((client) => {
    const label = `${client.remoteAddress}:${client.remotePort}`;
    console.log(`\n[${stamp()}] client connected ${label}`);
    const upstream = net.createConnection({ host: targetHost, port: targetPort });
    upstream.setNoDelay(true);
    client.setNoDelay(true);

    let n = 0;
    client.on('data', (d) => {
      n += 1;
      console.log(`[${stamp()}] C->D #${n} (${d.length}B) ${d.toString('hex')}`);
      upstream.write(d);
    });
    upstream.on('data', (d) => {
      console.log(`[${stamp()}] D->C #${n} (${d.length}B) ${d.toString('hex')}`);
      client.write(d);
    });
    client.on('error', (e) => console.log(`[${stamp()}] client error ${e.message}`));
    upstream.on('error', (e) => console.log(`[${stamp()}] upstream error ${e.message}`));
    client.on('close', () => {
      console.log(`[${stamp()}] client closed ${label}`);
      upstream.destroy();
    });
    upstream.on('close', () => {
      console.log(`[${stamp()}] upstream closed ${label}`);
      client.destroy();
    });
  })
  .listen(listenPort, '127.0.0.1', () => {
    console.log(`proxy listening 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}`);
  });
