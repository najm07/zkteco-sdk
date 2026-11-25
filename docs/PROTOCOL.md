# The ZKTeco standalone protocol, as observed

This document records what was measured against a live **uFace800 Plus**
(`Ver 6.60 Nov 21 2019`, platform `ZMM720_TFT`) and the
vendor app `ZKBio Time.Net 3.4.4.0`. Nothing here comes from documentation; the
sections below say how each fact was proved.

## 1. Transport

TCP, default port 4370. One connection carries one session.

Every message is a frame:

```
offset  size  field
0       4     magic 50 50 82 7d
4       4     u32 LE  length of everything after these 8 bytes
8       2     u16 LE  command
10      2     u16 LE  checksum
12      2     u16 LE  session id
14      2     u16 LE  reply id
16      …     data
```

The checksum is the one's complement of a 16-bit little-endian word sum over
`command`, `session`, `reply` and `data`, with end-around carry. The magic and
length are excluded.

```ts
checksum(command, session, reply, data)
```

Verified by recomputing the stored checksum of 16/16 frames captured from the
device, and by re-encoding each frame back to identical bytes
(`test/frame.test.ts`).

The device assigns a **new session id per connection** (`0xad7a`, `0xaf97`, …).
Reusing a session id is the easiest way to reproduce a bogus "auth rejected".

## 2. Handshake

```
CONNECT(1000)                      -> 2005 (ACK_CONNECT) or 2000
AUTH(1102, 4 random bytes)         -> 2005 on a device with no comm key
GET_VERSION(1100)                  -> "Ver 6.60 Nov 21 2019"
```

`AUTH` is not gating when no comm key is configured, and the vendor client sends
a fresh random 4-byte value each time. This client mirrors that and then proves
the session with a real read, so a device that *does* have a comm key fails at
`connect()` instead of mid-sync.

## 3. Commands seen

| Code | Meaning |
|------|---------|
| 8 | legacy user write (packed struct) |
| 11 / 12 / 501 | get option / set option / get many options |
| 69 | get status |
| 119 | table write commit (status in a 4-byte payload) |
| 201 / 202 | get time / set time |
| 1000 / 1001 | connect / exit |
| 1100 / 1102 | get version / auth |
| 1500 / 1501 / 1502 | prepare data / data chunk / free data |
| 1503 / 1504 | bulk stream request / window acknowledgement |
| 2000 / 2001 / 2005 | ack ok / ack error / ack connect |
| 4996 / 4999 | device-side "unsupported / no value" replies |
| 10000 / 10001 | get table schema / refresh after write |
| 10002 / 10003 | read table / delete table rows |
| 10033 | get record count |

## 4. Records

`GET_TABLE_SCHEMA` returns one line per table:

```
user=1,UID=i1,Pin=s2,Name=B3,Password=s4,CardNo=s5,Group=i6,…
```

`Name=<type><ordinal>`, where the type tag decides the field encoding:

| Tag | Meaning | Encoding |
|-----|---------|----------|
| `i` | unsigned integer | `[len:u8][value:LE]` |
| `s` | string | `[len:u8][bytes]` |
| `B` | bytes | `[len:u16 LE][bytes]` |

Rows are packed back to back with no separator. The 16-bit length on `B` is the
subtle part: `Name=B3` on disk is `06 00 61 6c 69 63 65 31` ("alice1"), and
reading that length as 8-bit desynchronises every later field.

A read response begins with `[tableId:u8][columnCount:u8][ordinal:u8]…`, which
means a column subset decodes correctly without knowing the request.

## 5. Filters

After the column ordinals, `READ_TABLE` carries:

```
[00][conditionCount][ordinal × count][(len, value) × count]
```

Captured from the vendor client:

| Filter | Bytes after the ordinals |
|--------|--------------------------|
| *(empty)* | `00 00` |
| `Pin=1` | `00 01 02 01 31` |
| `Pin=12` | `00 01 02 02 31 32` |
| `Pin=1⇥Pri=14` | `00 02 02 08 01 31 01 0e` |
| `Pin=1⇥Type=2` | `00 02 01 04 01 31 01 02` |

Values are **typed**: `Pin` is a string column so `1` is ASCII `31`, while `Pri`
and `Type` are integer columns so `14` is the single byte `0e` and `2` is `02`.
Sending ASCII digits for an integer column matches nothing.

`GET_RECORD_COUNT` uses the same shape without the leading reserved byte:

```
01 00                          count all users
01 01 02 05 36 35 30 30 30     count users with Pin=65000
```

Comparison operators are unsafe: a filter containing `>=` made this firmware
close the connection. `parseFilter` therefore rejects anything but
`Column=value` before a byte is sent.

## 6. Clock

`SET_TIME(202)` takes a 4-byte little-endian value that is *not* a Unix time:

```
days  = ((year - 2000) * 12 + (month - 1)) * 31 + (day - 1)
value = days * 86400 + hour * 3600 + minute * 60 + second
```

`SetDeviceTime2(2026, 11, 18, 14, 13, 34)` produced `8e 0e 7f 33`
(863,964,814), which decomposes exactly. Months are 31 days wide, so durations
cannot be added by simple arithmetic.

`GET_TIME(201)` is the read counterpart and returns the same encoding.

## 7. Biometrics

`pers_biotemplate` is a chunked store. One enrolled template is several rows
sharing `Pin` and `Type`, distinguished by `Index`.

```
Pin=s1,Valid=i2,Duress=i3,Type=i4,MajorVer=i5,MinorVer=i6,Format=i7,No=i8,Index=i9,Tmp=B10
```

`Type` maps to modalities as follows:

| Type | Modality | Chunks per template | Payload bytes |
|------|----------|---------------------|---------------|
| 1 | fingerprint (v10) | per finger | ~600–1,200 |
| 2 | face (v12) | 10 or 15 | 19,088 or 29,138 |
| 8 | palm (v12) | 5 or 10 | 8,894 or 17,788 |

Corroboration: the vendor app stores these as `bio_type` 1/2/8 with schema
versions `10.0`, `12.0`, `12.0`, and it logs *Palm* verifications on this
terminal. `FingerFunOn` and `FaceFunOn` both read `1`.

Each `Tmp` value is a self-describing chunk:

```
6a 95 01 10 e0 07 <payload…>
             └────┘ total chunk length, u16 LE (2016 here)
```

The last chunk of a template is shorter and carries its own length
(`ec 03` = 1004). The envelope repeats on every chunk, so it is not a
template-wide header.

Face chunks start at index 5; palm chunks start at 0.

### The vendor's face blob

`GetUserFaceStr` returns a different view of the same bytes: fixed 2,576-byte
slots, each holding a 16-byte descriptor, the chunk and zero padding.

```
[len:u16][01 00][index:u8][01][00 × 10][chunk][zeros to 2576]
```

For a 10-chunk face template that is 25,760 bytes, and rebuilding it from the
table rows reproduced the vendor blob **byte for byte**
(`scripts/test-face-blob.ts`). Palm templates use the same container.

### Count semantics

`GET_RECORD_COUNT` does not mean "rows" for this table:

| Query | Result | Meaning |
|-------|--------|---------|
| `count('pers_biotemplate')` | 146 | people with biometrics |
| `count('pers_biotemplate','Type=2')` | 124 | face templates |
| `count('pers_biotemplate','Type=8')` | 74 | palm templates |
| rows read | 2,090 | chunks |

124 + 74 = 198 templates over 146 people, spread across 2,090 stored chunks.

### The bulk stream: DATA_WRRQ (1503)

On this firmware fingerprints are **not** in `pers_biotemplate`. `READ_TABLE`
with `Type=1` returns zero rows even though `GET_FREE_SIZES` reports 309 used.
The vendor SDK reads them through a different, streamed command. Capture from
the COM bridge, reproduced with `scripts/probe-data-wrrq.cjs`:

```
C->D DATA_WRRQ(1503) len=11  request  01 09 00 05 00 00 00 00 00 00 00
D->C ACK_OK(2000)   len=13  00 5c 8c 00 00 | 5c 8c 00 00 | 43 58 fe 00
                             ^  total=35,932  ^ total again
C->D DATA_RDY(1504) len=8   [offset:u32 LE][size:u32 LE]   00 00 00 00 5c 8c 00 00
D->C PREPARE_DATA(1500) size=35,932
D->C DATA(1501)         35,932 bytes
D->C ACK_OK(2000)
C->D FREE_DATA(1502)
```

`total` is the byte count of the whole streamed payload. Windows are 65,472
bytes (`0xffc0`) in the vendor client; the reply per window is
`PREPARE_DATA(size)` + `DATA(window)` + `ACK_OK`.

Request selectors observed (byte 0 is always `01`):

| Request | Payload | Content |
|---------|---------|---------|
| `01 09 00 05 …` | 35,932 B | user table, 499 × 72-byte fixed records |
| `01 09 00 04 …` | 3,604 B | operation log |
| `01 07 00 02 …` | 171,760 B | fingerprint store, 308 records |
| `01 07 00 01 …` | 23,604 B | attendance log |
| `01 09 00 06 …`, `01 07 00 03 …` | — | rejected with ack `4991` |

The fingerprint payload starts with a 4-byte declared length, then
variable-length records:

```
[size:u16 LE][uid:u16 LE][fid:u8][valid:u8][template:size-6 bytes]
```

`size` counts the **whole record, header included** (record 0: size 496 →
490 template bytes, uid 323, fid 6). Reading it as a data length desynchronises
the stream after the first record.

`USERTEMP_RRQ` (cmd 9) returns the same template, followed by **six extra
bytes** — literally the next store record's header. Verified on six slots:
`bulkData.equals(usertemp.subarray(0, -6))` is true for all of them. The client
strips those six bytes so per-slot reads and bulk reads agree.

### Column projection

`pers_biotemplate` is dominated by `Tmp`. The device's throughput is fine, but
the blob makes reads look slow. Asking only for the counters (ordinals 1–9,
omitting `Tmp`=10) changed the live timings by two orders of magnitude:

| Read | All columns | Counters only |
|------|-------------|---------------|
| user table (499) | ~44–86 s | 0.15 s (UID/Pin/Name) |
| face `Type=2` (1,600 chunks) | 382 s | 0.32 s |
| palm `Type=8` (490 chunks) | 85 s | 0.10 s |
| fingerprints (308) | not readable | 0.6 s (`DATA_WRRQ`) |

The counters are enough for enrollment flags and per-user counts. Template
bytes are only fetched for one PIN at a time (`Pin=…` filter).

## 8. Field mapping to the vendor app database

`hr_biotemplate` mirrors the table:

| Device column | App column |
|---------------|------------|
| `Type` | `bio_type` |
| `Index` | `template_no_index` |
| `Tmp` (bytes) | `template_data` (base64) |

Verified by comparing 15 chunks for employee 1: all 15 were byte-identical.
`size` is unused (always 0).

## 9. Attendance log (command 13, ATTLOG_RRQ)

The `transaction` table is a cursor that the vendor app usually drains, so
`readTable('transaction')` often returns nothing even though the device reports
541 records. The legacy `ATTLOG_RRQ` command returns the whole log at once and
does **not** delete anything (two consecutive reads return identical bytes).

Each record is 40 bytes:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 2 | 1-based sequence index |
| 2 | 24 | pin, ASCII NUL-padded |
| 26 | 1 | verify mode (1 = fingerprint, 15 = face, 25 = palm, 4 = card) |
| 27 | 4 | device-calendar timestamp (same encoding as the clock) |
| 31 | 9 | reserved, zero on this firmware |

The layout and verify codes were confirmed against the vendor app's
`att_punches` table: 20 of 20 punches on terminal 6 matched on pin, verify
code and timestamp (the app stores them shifted to local time, UTC+1).

The device clock tracks UTC on this unit; the vendor app stores punches shifted
to local time.

## 10. Device status (command 50, GET_FREE_SIZES)

The device answers with 28 u32 words (112 bytes). Cross-checked against
`count()` and the user table on hardware:

| Word | Value | Meaning |
|------|-------|---------|
| 4 | 499 | users used |
| 6 | 309 | fingerprints used |
| 8 | 541 | attendance logs used |
| 10 | 225 | operation logs used |
| 12 | 8 | admin users |
| 13 | 1 | users with a password |
| 14 / 17 | 4000 / 3691 | fingerprint capacity / free |
| 15 / 18 | 10000 / 9501 | user capacity / free |
| 16 / 19 | 100000 / 99459 | attendance capacity / free |
| 20 / 21 / 22 | 124 / 2876 / 3000 | face templates used / free / capacity |
| 0..3, 23..27 | 0 | reserved on this firmware |

## 11. Provenance

- `zkemkeeper.dll` v6.3.1.54 (shim) over `zkemsdk.dll` (248 exports) and
  `plcommpro.dll` (14 exports); `IZKEM` exposes 332 methods.
- Ground truth for the wire format came from a hex-logging TCP proxy in front of
  the device, driven by the vendor shim on one side and by this client on the
  other.
- Unit tests replay the captured frames, so the format cannot drift silently.
