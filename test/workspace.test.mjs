import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  normalizeSessionId,
  readProjectionTitle,
  readWorkspaceState,
  signatureOf,
} from '../src/host/workspace.mjs'

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'tdb-workspace-'))
}

test('normalizeSessionId unifies the two id spellings', () => {
  assert.equal(normalizeSessionId('session-abc-123'), 'abc-123')
  assert.equal(normalizeSessionId('abc-123'), 'abc-123')
  assert.equal(normalizeSessionId('  abc-123 '), 'abc-123')
  assert.equal(normalizeSessionId('session-'), null)
  assert.equal(normalizeSessionId(''), null)
  assert.equal(normalizeSessionId(42), null)
  assert.equal(normalizeSessionId(null), null)
})

test('a missing workspace.json is not an error', () => {
  const home = makeHome()
  try {
    const state = readWorkspaceState(home)
    assert.equal(state.ok, false)
    assert.equal(state.sessions.size, 0)
    assert.equal(state.archived.size, 0)
    assert.deepEqual(state.warnings, [])
    assert.equal(state.signature, null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a damaged workspace.json reports a warning instead of throwing', () => {
  const home = makeHome()
  try {
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(join(home, 'storages', 'workspace.json'), '{"global": {"archivedSessionIds": [')
    const state = readWorkspaceState(home)
    assert.equal(state.ok, false)
    assert.equal(state.sessions.size, 0)
    assert.equal(state.archived.size, 0)
    assert.equal(state.warnings.length, 1)
    assert.match(state.warnings[0], /not valid JSON/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('workspace.json yields archived ids and workspace attribution', () => {
  const home = makeHome()
  try {
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(
      join(home, 'storages', 'workspace.json'),
      JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { archivedSessionIds: ['session-archived-1', 'archived-2'] },
        tables: {
          workspaces: {
            'w-1': { path: 'C:\\proj-a', title: '项目 A', sessionIds: ['session-active-1', 'session-active-2'] },
            'w-2': { path: 'E:\\proj-b', title: '项目 B', sessionIds: ['session-active-3'] },
          },
        },
      }),
    )
    const state = readWorkspaceState(home)
    assert.equal(state.ok, true)
    assert.deepEqual([...state.archived].sort(), ['archived-1', 'archived-2'])
    assert.equal(state.sessions.get('active-1').workspacePath, 'C:\\proj-a')
    assert.equal(state.sessions.get('active-1').workspaceTitle, '项目 A')
    assert.equal(state.sessions.get('active-1').workspaceId, 'w-1')
    assert.equal(state.sessions.get('active-3').workspacePath, 'E:\\proj-b')
    assert.equal(state.sessions.has('archived-1'), false)
    assert.match(state.signature, /^\d+(\.\d+)?:\d+$/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('workspace.json with unexpected shapes stays quiet and empty', () => {
  const home = makeHome()
  try {
    mkdirSync(join(home, 'storages'), { recursive: true })
    writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({ global: {}, tables: {} }))
    const state = readWorkspaceState(home)
    assert.equal(state.ok, true)
    assert.equal(state.archived.size, 0)
    assert.equal(state.sessions.size, 0)
    assert.deepEqual(state.warnings, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('projcache supplies a fallback title', () => {
  const home = makeHome()
  try {
    const directory = join(home, 'storages', 'session_projcache', 'sessions')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'abc.json'), JSON.stringify({ version: 1, record: { rows: { title: { ver: 1, seq: 4, val: '来自投影缓存' } } } }))
    const found = readProjectionTitle(home, 'abc')
    assert.equal(found.title, '来自投影缓存')
    assert.match(found.signature, /^\d+(\.\d+)?:\d+$/)

    // Some builds name the cache file with the storage id spelling, i.e.
    // `session-<uuid>.json`; both spellings must resolve to the same session.
    writeFileSync(
      join(directory, 'session-prefixed.json'),
      JSON.stringify({ version: 1, record: { rows: { title: { ver: 1, seq: 2, val: '带前缀的缓存' } } } }),
    )
    assert.equal(readProjectionTitle(home, 'prefixed').title, '带前缀的缓存')

    // Damaged cache: no title, no throw.
    writeFileSync(join(directory, 'bad.json'), '{not json')
    assert.equal(readProjectionTitle(home, 'bad').title, null)
    // Missing cache.
    assert.deepEqual(readProjectionTitle(home, 'missing'), { title: null, signature: 'none' })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('signatureOf combines mtime and size', () => {
  const home = makeHome()
  try {
    const file = join(home, 'f.txt')
    writeFileSync(file, 'hello')
    const signature = signatureOf(statSync(file))
    const [mtime, size] = signature.split(':')
    assert.equal(Number(size), 5)
    assert.equal(Number(mtime), statSync(file).mtimeMs)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
