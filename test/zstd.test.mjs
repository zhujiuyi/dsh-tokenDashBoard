import assert from 'node:assert/strict'
import { test } from 'node:test'
import zlib from 'node:zlib'

import { decompressConcat, decodeSessionLogBuffer, frameEnd, readSessionLog } from '../src/host/zstd.mjs'

/** Compress one chunk of text into a single zstd frame. */
function frame(text) {
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'))
}

/** Build a log the way the Harness writes it: several appended frames. */
function multiFrame(lines, perFrame = 1) {
  /** @type {Buffer[]} */
  const frames = []
  for (let index = 0; index < lines.length; index += perFrame) {
    const chunk = lines.slice(index, index + perFrame).join('\n') + '\n'
    frames.push(frame(chunk))
  }
  return Buffer.concat(frames)
}

test('decompresses every appended frame, not only the first', () => {
  const lines = ['{"n":1}', '{"n":2}', '{"n":3}', '{"n":4}']
  const buffer = multiFrame(lines)
  // Documents why this module exists: the built-in one-shot decoder stops after
  // the first frame, so a multi-frame log would silently lose most of its lines.
  const naive = zlib.zstdDecompressSync(buffer).toString('utf8')
  assert.equal(naive, '{"n":1}\n')

  const decoded = decodeSessionLogBuffer(buffer)
  assert.equal(decoded.compressed, true)
  assert.equal(decoded.frames, 4)
  assert.equal(decoded.truncated, false)
  assert.deepEqual(decoded.errors, [])
  assert.equal(decoded.text, lines.map((line) => `${line}\n`).join(''))
  assert.equal(decompressConcat(buffer), decoded.text)
})

test('multiple lines inside one frame decode too', () => {
  const buffer = multiFrame(['{"a":1}', '{"a":2}', '{"a":3}'], 3)
  assert.equal(decompressConcat(buffer), '{"a":1}\n{"a":2}\n{"a":3}\n')
})

test('uncompressed .jsonl bytes pass through untouched', () => {
  const text = '{"type":"session"}\n{"type":"turn/start"}\n'
  const decoded = decodeSessionLogBuffer(Buffer.from(text, 'utf8'))
  assert.equal(decoded.compressed, false)
  assert.equal(decoded.text, text)
  assert.deepEqual(decoded.errors, [])
})

test('an empty file decodes to an empty string', () => {
  const decoded = decodeSessionLogBuffer(Buffer.alloc(0))
  assert.equal(decoded.text, '')
  assert.equal(decoded.compressed, false)
})

test('a truncated trailing frame keeps the complete frames before it', () => {
  const first = frame('{"keep":1}\n')
  const second = frame('{"keep":2}\n')
  const cut = Buffer.concat([first, second]).subarray(0, first.length + Math.floor(second.length / 2))

  const decoded = decodeSessionLogBuffer(cut)
  assert.equal(decoded.truncated, true)
  assert.match(decoded.text, /\{"keep":1\}/)
  // Truncation is a diagnostic, not corruption: while the Harness is appending
  // to a log, a half-written tail must not become a user-visible warning.
  assert.equal(decoded.errors.length, 0)
  assert.ok(decoded.notes.some((note) => note.includes('incomplete')))
})

test('a corrupt frame does not hide the frames after it', () => {
  const first = frame('{"keep":1}\n')
  const damaged = Buffer.from(frame('{"lost":2}\n'))
  const third = frame('{"keep":3}\n')
  // Wipe the block headers and payload of the middle frame: it can no longer be
  // delimited, which is the worst case for a frame walker.
  for (let index = 8; index < damaged.length - 2; index += 1) damaged[index] = 0xaa

  const decoded = decodeSessionLogBuffer(Buffer.concat([first, damaged, third]))
  assert.match(decoded.text, /\{"keep":1\}/)
  assert.match(decoded.text, /\{"keep":3\}/)
  assert.doesNotMatch(decoded.text, /\{"lost":2\}/)
  assert.ok(decoded.skipped >= 1)
  // Real damage belongs in errors (→ snapshot warnings), never in notes.
  assert.ok(decoded.errors.length >= 1)
  assert.equal(decoded.notes.length, 0)
})

test('a damaged frame whose extent is still readable is skipped exactly', () => {
  const first = frame('{"keep":1}\n')
  const damaged = Buffer.from(frame('{"lost":2}\n'))
  damaged[damaged.length - 1] ^= 0xff // flip the content checksum / last byte
  const third = frame('{"keep":3}\n')

  const decoded = decodeSessionLogBuffer(Buffer.concat([first, damaged, third]))
  assert.match(decoded.text, /\{"keep":1\}/)
  assert.match(decoded.text, /\{"keep":3\}/)
})

test('skippable frames between data frames are ignored', () => {
  const skip = Buffer.from([0x50, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3])
  const buffer = Buffer.concat([frame('{"a":1}\n'), skip, frame('{"a":2}\n')])
  const decoded = decodeSessionLogBuffer(buffer)
  assert.equal(decoded.text, '{"a":1}\n{"a":2}\n')
  assert.equal(decoded.frames, 2)
  assert.equal(decoded.truncated, false)
})

test('frameEnd reports the exact frame boundary', () => {
  const one = frame('{"a":1}\n')
  const two = frame('{"b":2}\n')
  const buffer = Buffer.concat([one, two])
  assert.equal(frameEnd(buffer, 0), one.length)
  assert.equal(frameEnd(buffer, one.length), buffer.length)
  assert.equal(frameEnd(buffer, 0) > 0, true)
  // A single frame cut short cannot be delimited.
  assert.equal(frameEnd(one.subarray(0, 5), 0), -1)
})

test('readSessionLog never throws on a missing file', () => {
  const decoded = readSessionLog('definitely/not/a/real/session.v4.jsonl.zstd')
  assert.equal(decoded.text, '')
  assert.ok(decoded.errors.length >= 1)
})
