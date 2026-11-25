/**
 * Command codes and the device's table registry.
 *
 * Command numbers here were observed on the wire against a live device, not
 * copied from documentation. `TABLE_IDS` mirrors the schema the device returns
 * for command 10000 (GET_TABLE_SCHEMA), which is authoritative for this
 * firmware; `ZkDevice.schema()` is the dynamic source of truth.
 */

export const Command = {
  CONNECT: 1000,
  EXIT: 1001,
  AUTH: 1102,
  GET_OPTION: 11,
  SET_OPTION: 12,
  GET_OPTIONS_ALL: 501,
  GET_VERSION: 1100,
  GET_STATUS: 69,
  GET_FREE_SIZES: 50,
  GET_TIME: 201,
  SET_TIME: 202,
  PREPARE_DATA: 1500,
  DATA: 1501,
  FREE_DATA: 1502,
  /** Vendor bulk stream: request selects the data set, reply advertises size. */
  DATA_WRRQ: 1503,
  /** Client acknowledgement that requests one window of a bulk stream. */
  DATA_RDY: 1504,
  ACK_OK: 2000,
  ACK_ERROR: 2001,
  ACK_CONNECT: 2005,
  WRITE_TABLE: 8,
  /** Fingerprint template download: request [uid:u16 LE][fid:u8]. */
  USERTEMP_RRQ: 9,
  /** Fingerprint template upload: same record framing as the bulk stream. */
  USERTEMP_WRQ: 10,
  /** Delete one fingerprint template: request [uid:u16 LE][fid:u8]. */
  DELETE_USERTEMP: 19,
  ATTLOG_RRQ: 13,
  WRITE_COMMIT: 119,
  DELETE_TABLE: 10003,
  WRITE_REFRESH: 10001,
  GET_TABLE_SCHEMA: 10000,
  READ_TABLE: 10002,
  GET_RECORD_COUNT: 10033,
} as const;

export type CommandCode = (typeof Command)[keyof typeof Command];

export interface TableDefinition {
  /** Table id used on the wire. */
  id: number;
  /** Table name as reported by the device, e.g. `user`. */
  name: string;
  /** Column names in schema order. */
  columns: string[];
  /** Per-column type tag as reported by the device: i = int, s = string, B = bytes. */
  types: string[];
  /** Wire ordinal of each column, 1-based; index-aligned with `columns`. */
  ordinals: number[];
}

/**
 * Table ids for firmware `Ver 6.60 Nov 21 2019`.
 *
 * Kept as data for convenience; the device is the source of truth, so prefer
 * `ZkDevice.schema()` when correctness matters more than keystrokes.
 */
export const TABLE_IDS = {
  user: 1,
  transaction: 2,
  templatev10: 3,
  templatev09: 4,
  facetemplatev07: 5,
  workcode: 6,
  sms: 7,
  usersms: 8,
  funclist: 9,
  keyfunc: 10,
  statekey: 11,
  statelist: 12,
  statetimezone: 13,
  realtimelog: 14,
  accgroup: 15,
  accholiday: 16,
  accunlockcomb: 17,
  acctimezone: 18,
  hid_format: 19,
  oplogs: 20,
  role: 21,
  permission: 22,
  role_permission: 23,
  app_func: 24,
  app_permission: 25,
  func_permission: 26,
  pers_biotemplate: 27,
  id_card: 28,
  fileopt: 29,
} as const;

export type TableName = keyof typeof TABLE_IDS;
