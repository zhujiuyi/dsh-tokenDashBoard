/**
 * Session-log byte decoding.
 *
 * A Harness session log is a **sequence of independent zstd frames** appended
 * to one file (`session.v4.jsonl.zstd`), each frame holding the JSONL bytes
 * written by one flush. `zlib.zstdDecompressSync()` stops after the first frame,
 * so it silently truncates such a file to its first chunk — the reason this
 * module walks the frame headers itself and decompresses each frame separately.
 *
 * The walker is deliberately tolerant: a log is often read while the Harness is
 * still appending, so the last frame may be cut in half, and an older log may
 * hold a damaged frame. A frame that cannot be delimited or decompressed is
 * skipped (and reported), and every earlier frame is still returned. A file
 * that does not start with the zstd magic is treated as plain JSONL text
 * (`session.vN.jsonl`, no compression).
 *
 * Only `node:zlib` and `node:fs` are used; no dependencies.
 */

import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

/** Little-endian bytes `28 B5 2F FD`. */
const ZSTD_MAGIC = 0xfd2fb528
/** Skippable-frame magic range: `0x184D2A50`–`0x184D2A5F`. */
const SKIPPABLE_MAGIC_MIN = 0x184d2a50
const SKIPPABLE_MAGIC_MAX = 0x184d2a5f

/**
 * @typedef {object} DecodedLog
 * @property {string} text        decoded UTF-8 (possibly partial, possibly '')
 * @property {boolean} compressed whether the bytes were zstd frames
 * @property {number} frames      frames successfully decompressed
 * @property {number} skipped     frames that could not be read/decompressed
 * @property {boolean} truncated  a trailing frame started but did not finish
 * @property {string[]} errors    real damage (corrupt/unreadable): safe to surface as warnings
 * @property {string[]} notes     expected diagnostics (an unfinished tail frame while the
 *   Harness is still appending): log-only, never a user-visible warning
 */

/**
 * Decode a session-log buffer of concatenated zstd frames (or plain JSONL).
 * Never throws.
 * @param {Buffer} buffer
 * @returns {DecodedLog}
 */
export function decodeSessionLogBuffer(buffer) {
  /** @type {DecodedLog} */
  const result = { text: '', compressed: false, frames: 0, skipped: 0, truncated: false, errors: [], notes: [] }
  if (!Buffer.isBuffer(buffer)) return result
  if (buffer.length === 0) return result

  if (buffer.readUInt32LE(0) !== ZSTD_MAGIC) {
    // Uncompressed JSONL (or an empty shard): the bytes *are* the text.
    result.text = buffer.toString('utf8')
    return result
  }

  result.compressed = true
  /** @type {Buffer[]} */
  const chunks = []
  let pos = 0

  while (pos + 4 <= buffer.length) {
    const magic = buffer.readUInt32LE(pos)

    if (magic >= SKIPPABLE_MAGIC_MIN && magic <= SKIPPABLE_MAGIC_MAX) {
      // Skippable frame: magic + uint32 payload size + payload. Some encoders
      // emit these between data frames; they carry no session content.
      if (pos + 8 > buffer.length) {
        result.truncated = true
        break
      }
      const size = buffer.readUInt32LE(pos + 4)
      const next = pos + 8 + size
      if (next > buffer.length) {
        result.truncated = true
        break
      }
      pos = next
      continue
    }

    if (magic !== ZSTD_MAGIC) {
      // Bytes that are not a frame start. Either trailing garbage after the
      // last frame, or a damaged region: if another frame magic follows, skip
      // to it instead of throwing away the rest of the file.
      const next = findNextFrameMagic(buffer, pos + 1)
      if (next < 0) {
        result.truncated = true
        break
      }
      result.skipped += 1
      result.errors.push(`unexpected bytes at offset ${pos}; resumed at the next frame (${next})`)
      pos = next
      continue
    }

    const end = frameEnd(buffer, pos)
    const slice = end > 0 ? buffer.subarray(pos, end) : buffer.subarray(pos)
    try {
      const bytes = zstdDecompressSync(slice)
      if (bytes.length > 0) chunks.push(bytes)
      result.frames += 1
    } catch (error) {
      // A damaged frame must not discard the frames around it.
      result.skipped += 1
      result.errors.push(`zstd frame at byte ${pos}: ${messageOf(error)}`)
    }
    if (end > 0) {
      pos = end
      continue
    }

    // The frame's extent is unknown. That is normal for the frame currently
    // being appended: the file simply ends inside it. If a valid frame magic
    // still follows, the header was damaged instead, so resume there.
    const next = findNextFrameMagic(buffer, pos + 4)
    if (next < 0) {
      result.truncated = true
      break
    }
    pos = next
  }

  result.text = Buffer.concat(chunks).toString('utf8')
  if (result.skipped > 0) {
    result.errors.push(`${result.skipped} zstd frame(s) could not be decompressed`)
  }
  if (result.truncated) {
    // Not corruption: the file simply ends inside the frame that is being
    // appended right now. A snapshot taken mid-write is expected to see this,
    // so it stays a diagnostic instead of a user-visible warning.
    result.notes.push('last zstd frame is incomplete (log still being written?)')
  }
  return result
}

/**
 * Convenience wrapper: decode a whole file. Never throws — an unreadable file
 * comes back as an empty result with the reason in `errors`.
 * @param {string} filePath
 * @returns {DecodedLog}
 */
export function readSessionLog(filePath) {
  try {
    return decodeSessionLogBuffer(readFileSync(filePath))
  } catch (error) {
    return {
      text: '',
      compressed: false,
      frames: 0,
      skipped: 0,
      truncated: false,
      errors: [`cannot read session log: ${messageOf(error)}`],
      notes: [],
    }
  }
}

/**
 * Decompress concatenated zstd frames into text (or pass plain JSONL through).
 * Kept as the simple entry point for scripts and tests.
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decompressConcat(buffer) {
  return decodeSessionLogBuffer(buffer).text
}

/**
 * Compute the exclusive end offset of the zstd frame starting at `start`, by
 * walking the frame header and its block headers (RFC 8878 §3.1).
 * @param {Buffer} buffer
 * @param {number} start offset of the frame magic
 * @returns {number} end offset, or `-1` when the frame is incomplete/invalid
 */
export function frameEnd(buffer, start) {
  let pos = start + 4 // magic number
  if (pos >= buffer.length) return -1

  const descriptor = buffer[pos]
  pos += 1
  const contentSizeFlag = descriptor >> 6 // bits 7-6
  const singleSegment = (descriptor >> 5) & 1 // bit 5
  const hasChecksum = (descriptor >> 2) & 1 // bit 2
  const dictionaryFlag = descriptor & 3 // bits 1-0

  if (!singleSegment) pos += 1 // Window_Descriptor
  // Dictionary_ID_Flag: 0 → 0 bytes, 1 → 1, 2 → 2, 3 → 4
  pos += dictionaryFlag === 3 ? 4 : dictionaryFlag
  // Frame_Content_Size: field size by flag, with the single-segment special case
  // (flag 0 means 1 byte when Single_Segment_Flag is set, else "absent").
  pos += contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][contentSizeFlag]

  for (;;) {
    if (pos + 3 > buffer.length) return -1
    const header = buffer[pos] | (buffer[pos + 1] << 8) | (buffer[pos + 2] << 16)
    pos += 3
    const lastBlock = header & 1
    const blockType = (header >> 1) & 3
    const blockSize = header >>> 3
    if (blockType === 3) return -1 // reserved block type: not a valid frame
    // Raw and compressed blocks carry `blockSize` bytes; an RLE block carries
    // exactly one byte that is repeated `blockSize` times.
    pos += blockType === 1 ? 1 : blockSize
    if (pos > buffer.length) return -1
    if (lastBlock === 1) break
  }

  if (hasChecksum) pos += 4 // Content_Checksum
  return pos > buffer.length ? -1 : pos
}

/** @param {unknown} error @returns {string} */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * First offset at or after `from` that starts a zstd frame magic.
 * Used only to recover from a damaged frame header.
 * @param {Buffer} buffer
 * @param {number} from
 * @returns {number} offset, or -1
 */
function findNextFrameMagic(buffer, from) {
  const last = buffer.length - 4
  for (let index = from; index <= last; index += 1) {
    // Fast reject before the four-byte comparison.
    if (buffer[index] !== 0x28 || buffer[index + 1] !== 0xb5) continue
    if (buffer[index + 2] !== 0x2f || buffer[index + 3] !== 0xfd) continue
    return index
  }
  return -1
}
