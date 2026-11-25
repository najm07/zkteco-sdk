/**
 * Public surface of the ZKTeco client.
 *
 * Everything exported here was verified against a live uFace800 Plus
 * (`Ver 6.60 Nov 21 2019`); the protocol modules document which bytes proved
 * each detail.
 */

export { ZkDevice, ZkError } from './ZkDevice.ts';
export type {
  BiometricTemplate,
  DeviceIdentity,
  ReadTableOptions,
  ZkDeviceOptions,
} from './ZkDevice.ts';

export { Command, TABLE_IDS } from './protocol/commands.ts';
export type { CommandCode, TableDefinition, TableName } from './protocol/commands.ts';

export {
  ATTLOG_COMMAND,
  ATTLOG_RECORD_SIZE,
  VERIFY_MODE,
  decodeAttendanceLog,
  verifyModeOf,
} from './protocol/attlog.ts';
export type { AttendanceLogRecord } from './protocol/attlog.ts';

export {
  BIOMETRIC_TYPE,
  CHUNK_HEADER,
  VENDOR_SLOT,
  chunkPayload,
  decodeVendorBlob,
  encodeVendorBlob,
  modalityOf,
} from './protocol/biotemplate.ts';
export type { BiometricChunk, BiometricModality, VendorBlobChunk } from './protocol/biotemplate.ts';

export { encodeCountFilter, encodeFilter, parseFilter } from './protocol/filter.ts';
export type { FilterCondition } from './protocol/filter.ts';

export { checksum, decodeFrames, encodeFrame, HEADER_SIZE, MAGIC } from './protocol/frame.ts';
export type { Frame } from './protocol/frame.ts';

export { decodeRows, encodeRow, parseSchema } from './protocol/records.ts';
export type { DecodeResult, Row } from './protocol/records.ts';

export { decodeDeviceStatus } from './protocol/status.ts';
export type { DeviceCapacity, DeviceStatus } from './protocol/status.ts';

export { decodeDateTime, encodeDateTime } from './protocol/time.ts';
