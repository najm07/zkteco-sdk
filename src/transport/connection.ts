/**
 * TCP session with the device: framing, reply correlation, payload assembly.
 *
 * One request -> one reply id. The device may answer a request with a
 * PREPARE_DATA / DATA* / ACK_OK sequence instead of a single frame; this class
 * hides that, so callers always receive `{ ack, payload }`.
 *
 * Bulk streams (`DATA_WRRQ`) can take tens of seconds per window on slow
 * hardware, so the idle timer resets on every PREPARE_DATA/DATA frame: a
 * transfer only fails when the device stops making progress, not when the
 * total transfer is large.
 */

import { Socket } from 'node:net';
import { Command } from '../protocol/commands.ts';
import { decodeFrames, encodeFrame, type Frame } from '../protocol/frame.ts';

export interface SendResult {
  /** The terminating frame (normally ACK_OK). */
  ack: Frame;
  /** Reassembled DATA payload, or the terminating frame's own payload. */
  payload: Buffer;
}

interface Pending {
  resolve: (value: SendResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  command: number;
  timeoutMs: number;
  expected: number | null;
  chunks: Buffer[];
  last: Frame | null;
}

export interface ConnectionOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
  /** Keepalive interval, 0 disables. */
  keepAliveMs?: number;
}

export class ZkConnection {
  #socket: Socket | null = null;
  #buffer: Buffer = Buffer.alloc(0);
  #session = 0;
  #reply = 0;
  #pending = new Map<number, Pending>();
  #timeoutMs: number;
  #keepAlive: NodeJS.Timeout | null = null;
  readonly #options: ConnectionOptions;

  constructor(options: ConnectionOptions) {
    this.#options = options;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  get connected(): boolean {
    return this.#socket !== null && !this.#socket.destroyed;
  }

  get session(): number {
    return this.#session;
  }

  async open(): Promise<void> {
    const socket = new Socket();
    socket.setNoDelay(true);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.removeListener('connect', onConnect);
        reject(error);
      };
      const onConnect = () => {
        socket.removeListener('error', onError);
        resolve();
      };
      socket.once('error', onError);
      socket.once('connect', onConnect);
      socket.connect(this.#options.port ?? 4370, this.#options.host);
    });
    socket.on('data', (chunk) => this.#onData(chunk));
    socket.on('error', (error) => this.#failAll(error));
    socket.on('close', () => this.#failAll(new Error('connection closed')));
    this.#socket = socket;

    const keepAliveMs = this.#options.keepAliveMs ?? 0;
    if (keepAliveMs > 0) {
      this.#keepAlive = setInterval(() => {
        this.send(Command.GET_OPTION, Buffer.from('~SerialNumber\0', 'latin1')).catch(() => {});
      }, keepAliveMs);
      this.#keepAlive.unref();
    }
  }

  close(): void {
    if (this.#keepAlive) clearInterval(this.#keepAlive);
    this.#keepAlive = null;
    this.#socket?.destroy();
    this.#socket = null;
    this.#failAll(new Error('connection closed'));
  }

  setSession(session: number): void {
    this.#session = session;
  }

  async send(
    command: number,
    data: Buffer = Buffer.alloc(0),
    timeoutMs: number = this.#timeoutMs,
  ): Promise<SendResult> {
    const socket = this.#socket;
    if (!socket) throw new Error('not connected');
    const reply = this.#reply;
    this.#reply = (this.#reply + 1) & 0xffff;
    const packet = encodeFrame({ command, session: this.#session, reply, data });
    return new Promise<SendResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(reply);
        reject(new Error(`timeout waiting for reply to command ${command}`));
      }, timeoutMs);
      this.#pending.set(reply, {
        resolve,
        reject,
        timer,
        command,
        timeoutMs,
        expected: null,
        chunks: [],
        last: null,
      });
      socket.write(packet);
    });
  }

  #onData(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const { frames, rest } = decodeFrames(this.#buffer);
    this.#buffer = rest;
    for (const frame of frames) this.#onFrame(frame);
  }

  #touch(pending: Pending, reply: number): void {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.#pending.delete(reply);
      pending.reject(new Error(`timeout waiting for reply to command ${pending.command}`));
    }, pending.timeoutMs);
  }

  #onFrame(frame: Frame): void {
    const pending = this.#pending.get(frame.reply);
    if (!pending) return;
    if (frame.session !== 0 && this.#session === 0) this.#session = frame.session;

    if (frame.command === Command.PREPARE_DATA) {
      pending.expected = frame.data.length >= 4 ? frame.data.readUInt32LE(0) : null;
      pending.last = frame;
      this.#touch(pending, frame.reply);
      return;
    }
    if (frame.command === Command.DATA) {
      pending.chunks.push(Buffer.from(frame.data));
      pending.last = frame;
      this.#touch(pending, frame.reply);
      return;
    }
    this.#pending.delete(frame.reply);
    clearTimeout(pending.timer);
    const assembled = pending.chunks.length > 0 ? Buffer.concat(pending.chunks) : frame.data;
    pending.resolve({ ack: frame, payload: assembled });
  }

  #failAll(error: Error): void {
    this.#socket = null;
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
