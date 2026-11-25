/**
 * Biometric template chunking and the vendor app's face-blob container.
 *
 * `pers_biotemplate` stores one enrolled template as several rows that share a
 * Pin and Type and differ by `Index`. Each row's `Tmp` is a self-describing
 * chunk:
 *
 *   6a 95 01 10 e0 07 <payload…>
 *   magic └──┘ │  └─ total chunk length, u16 LE (2016 here)
 *              └─ version/format byte pair seen on this firmware
 *
 * The vendor's `GetUserFaceStr` returns a different view of the same data: a
 * sequence of fixed 2,576-byte slots, each holding a 16-byte descriptor and one
 * chunk, zero padded. For a face template captured from a live device:
 *
 *   [len:u16][01 00][index:u8][01][00 × 10][chunk bytes][zeros to 2576]
 *
 * Converting between the two is lossless — verified against a 10-chunk face
 * template, where re-encoding reproduced the vendor blob byte for byte.
 */

/** Slot size of the vendor blob container. */
export const VENDOR_SLOT = 2576;

/** Bytes of envelope at the start of every `Tmp` chunk. */
export const CHUNK_HEADER = 6;

/**
 * Biometric modalities seen in `pers_biotemplate.Type`.
 *
 * 1 and 2 are corroborated by the vendor app's schema versions (fingerprint
 * "10.0", face "12.0"); 8 shares the face engine's version and matches the palm
 * verifications the app records on these terminals.
 */
export const BIOMETRIC_TYPE = {
  fingerprint: 1,
  face: 2,
  palm: 8,
} as const;

export type BiometricModality = keyof typeof BIOMETRIC_TYPE | 'unknown';

export function modalityOf(type: number): BiometricModality {
  for (const [name, value] of Object.entries(BIOMETRIC_TYPE)) {
    if (value === type) return name as BiometricModality;
  }
  return 'unknown';
}

export interface BiometricChunk {
  /** `pers_biotemplate.Index` for this chunk. */
  index: number;
  /** The `Tmp` column, envelope included. */
  data: Buffer;
}

/**
 * Body of a chunk without its per-chunk envelope.
 *
 * The envelope repeats on every chunk (its length field equals the whole chunk
 * length), so it is not a template-wide header and must be stripped per chunk.
 */
export function chunkPayload(chunk: Buffer): Buffer {
  if (chunk.length <= CHUNK_HEADER) return Buffer.alloc(0);
  return chunk.subarray(CHUNK_HEADER);
}

export interface VendorBlobChunk {
  index: number;
  data: Buffer;
}

/**
 * Build the container `GetUserFaceStr` returns, from stored chunks.
 *
 * Chunks are laid out in ascending index order; each slot records the chunk's
 * own length and index so the device can validate what it reads back.
 */
export function encodeVendorBlob(chunks: readonly BiometricChunk[]): Buffer {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const out = Buffer.alloc(ordered.length * VENDOR_SLOT);

  for (const [slot, chunk] of ordered.entries()) {
    const base = slot * VENDOR_SLOT;
    out.writeUInt16LE(chunk.data.length, base);
    out[base + 2] = 0x01;
    out[base + 3] = 0x00;
    out[base + 4] = chunk.index & 0xff;
    out[base + 5] = 0x01;
    chunk.data.copy(out, base + 16);
  }
  return out;
}

/**
 * Read a vendor blob back into chunks. Inverse of `encodeVendorBlob`; useful
 * for importing templates the vendor app already stored.
 */
export function decodeVendorBlob(blob: Buffer): VendorBlobChunk[] {
  const chunks: VendorBlobChunk[] = [];
  for (let base = 0; base + 16 <= blob.length; base += VENDOR_SLOT) {
    const length = blob.readUInt16LE(base);
    const index = blob[base + 4]!;
    if (length === 0) continue;
    if (base + 16 + length > blob.length) {
      throw new Error(`vendor blob slot at ${base} declares ${length} bytes beyond the end`);
    }
    chunks.push({ index, data: Buffer.from(blob.subarray(base + 16, base + 16 + length)) });
  }
  return chunks;
}
