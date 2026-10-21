import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import zlib from 'node:zlib'

import { SNAPSHOT_VERSION, createDashboardService, discoverSessionLogs } from '../src/host/index.mjs'
import { localDay } from '../src/host/time.mjs'

/** Local epoch ms for a wall-clock instant. */
function at(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

const NOW = at(2026, 5, 20, 12)
const TODAY = localDay(NOW)

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'tdb-service-'))
}

/** Compress JSONL text into `perFrame`-line zstd frames, like the Harness does. */
function encodeFrames(text, perFrame = 1) {
  const lines = text.split('\n').filter((line) => line !== '')
  const chunks = []
  for (let index = 0; index < lines.length; index += perFrame) {
    chunks.push(zlib.zstdCompressSync(Buffer.from(lines.slice(index, index + perFrame).join('\n') + '\n', 'utf8')))
  }
  return Buffer.concat(chunks)
}

/**
 * Build a synthetic session log.
 * @param {object} options
 * @param {string} options.id
 * @param {Array<{ time: number, tokens: number, turnMs?: number }>} [options.entries]
 */
function sessionEvents(options) {
  const entries = options.entries ?? []
  const events = [
    {
      type: 'session',
      version: 4,
      id: options.id,
      createdAt: entries.length > 0 ? entries[0].time : NOW,
      cwd: `C:/work/${options.id}`,
      delegationDepth: options.delegationDepth ?? 0,
      ...(options.parentSession === undefined ? {} : { parentSession: options.parentSession }),
    },
  ]
  if (options.title !== undefined) {
    events.push({ type: 'session/title', time: events[0].createdAt, data: { title: options.title } })
  }
  let turn = 1
  for (const entry of entries) {
    events.push({ type: 'request/context', time: entry.time, data: { provider: options.provider ?? 'opencode-go', model: 'm' } })
    events.push({ type: 'user/message', time: entry.time, data: { role: 'user', content: [] } })
    events.push({ type: 'turn/start', time: entry.time, data: { turn } })
    events.push({
      type: 'assistant/message',
      time: entry.time,
      data: {
        turn,
        step: 1,
        usage: { inputTokens: entry.tokens, outputTokens: 0, cacheReadTokens: 0, totalTokens: entry.tokens },
      },
    })
    if (entry.turnMs !== undefined) events.push({ type: 'turn/end', time: entry.time + entry.turnMs, data: { turn } })
    turn += 1
  }
  return events
}

/** Write `<home>/sessions/<workspace>/<id>/session.v4.jsonl(.zstd)`. */
function writeLog(home, options) {
  const workspace = options.workspace ?? 'ws-one'
  const directory = join(home, 'sessions', workspace, options.id)
  mkdirSync(directory, { recursive: true })
  const file = join(directory, options.plain === true ? 'session.v4.jsonl' : 'session.v4.jsonl.zstd')
  if (options.bytes !== undefined) {
    writeFileSync(file, options.bytes)
    return file
  }
  const text = sessionEvents(options)
    .map((event) => JSON.stringify(event))
    .join('\n')
  if (options.plain === true) writeFileSync(file, text + '\n')
  else writeFileSync(file, encodeFrames(text, options.perFrame ?? 2))
  return file
}

function appendFrame(file, events) {
  const text = events.map((event) => JSON.stringify(event)).join('\n')
  writeFileSync(file, Buffer.concat([readFileSync(file), encodeFrames(text, 1)]))
}

function writeWorkspace(home, document) {
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify(document))
}

test('an empty Harness home yields a valid empty snapshot', async () => {
  const home = makeHome()
  try {
    const service = createDashboardService({
      homeDir: home,
      configuredProviders: () => [{ id: 'opencode-go', name: 'opencode-go' }],
      now: () => NOW,
    })
    const snapshot = await service.snapshot()
    assert.equal(snapshot.version, SNAPSHOT_VERSION)
    assert.equal(snapshot.today, TODAY)
    assert.equal(typeof snapshot.timeZone, 'string')
    assert.equal(snapshot.firstDay, null)
    assert.equal(snapshot.lastDay, null)
    assert.deepEqual(snapshot.days, [])
    assert.deepEqual(snapshot.sessions, [])
    assert.equal(snapshot.stats.total, 0)
    assert.deepEqual(snapshot.warnings, [])
    assert.deepEqual(snapshot.providers.map((row) => row.id), ['opencode-go'])
    assert.equal(snapshot.providers[0].total, 0)
    assert.deepEqual(snapshot.todayHours, { 'opencode-go': new Array(24).fill(0) })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('reads multi-frame zstd and uncompressed logs', async () => {
  const home = makeHome()
  try {
    writeLog(home, {
      workspace: 'ws-a',
      id: 'zstd-session',
      title: '压缩会话',
      entries: [
        { time: at(2026, 5, 19, 10), tokens: 100 },
        { time: at(2026, 5, 20, 10), tokens: 200, turnMs: 3_000 },
      ],
      perFrame: 1,
    })
    writeLog(home, {
      workspace: 'ws-b',
      id: 'plain-session',
      title: '明文会话',
      plain: true,
      entries: [{ time: at(2026, 5, 20, 11), tokens: 50 }],
    })
    writeWorkspace(home, {
      global: { archivedSessionIds: [] },
      tables: {
        workspaces: {
          'w-a': { path: 'C:\\a', title: 'A', sessionIds: ['session-zstd-session'] },
          'w-b': { path: 'C:\\b', title: 'B', sessionIds: ['session-plain-session'] },
        },
      },
    })

    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW })
    const snapshot = await service.snapshot()

    assert.equal(snapshot.sessions.length, 2)
    const zstd = snapshot.sessions.find((row) => row.id === 'zstd-session')
    const plain = snapshot.sessions.find((row) => row.id === 'plain-session')
    assert.equal(zstd.total, 300)
    assert.equal(zstd.title, '压缩会话')
    assert.equal(zstd.status, 'active')
    assert.equal(zstd.workspacePath, 'C:\\a')
    assert.equal(zstd.messages, 4)
    assert.equal(zstd.turns, 2)
    assert.equal(zstd.longestTurnMs, 3_000)
    assert.equal(plain.total, 50)
    assert.equal(plain.title, '明文会话')

    assert.equal(snapshot.stats.total, 350)
    assert.deepEqual(snapshot.days.map((row) => [row.day, row.total]), [
      ['2026-05-19', 100],
      ['2026-05-20', 250],
    ])
    const todayRow = snapshot.days.find((row) => row.day === TODAY)
    const hourSum = Object.values(snapshot.todayHours).reduce(
      (total, buckets) => total + buckets.reduce((sum, value) => sum + value, 0),
      0,
    )
    assert.equal(hourSum, todayRow.total)
    assert.deepEqual(snapshot.warnings, [])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a corrupt log becomes a warning, not a failed snapshot', async () => {
  const home = makeHome()
  try {
    writeLog(home, { id: 'good-session', title: '好会话', entries: [{ time: at(2026, 5, 20, 10), tokens: 42 }] })
    writeLog(home, { id: 'bad-session', bytes: Buffer.from('this is not a session log\n{"broken":\n') })

    const warnings = []
    const service = createDashboardService({
      homeDir: home,
      configuredProviders: [],
      now: () => NOW,
      logger: { warn: (message) => warnings.push(message) },
    })
    const snapshot = await service.snapshot()

    assert.equal(snapshot.sessions.length, 1)
    assert.equal(snapshot.sessions[0].id, 'good-session')
    assert.equal(snapshot.stats.total, 42)
    assert.ok(snapshot.warnings.length > 0)
    assert.ok(snapshot.warnings.some((warning) => warning.includes('bad-session')))
    assert.ok(warnings.length > 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a truncated tail frame stays a log-only note, not a snapshot warning', async () => {
  const home = makeHome()
  try {
    const head = sessionEvents({ id: 'growing', title: '仍在写', entries: [{ time: at(2026, 5, 20, 10), tokens: 100 }] })
      .map((event) => JSON.stringify(event))
      .join('\n')
    const tail = JSON.stringify({
      type: 'assistant/message',
      time: at(2026, 5, 20, 11),
      data: { turn: 2, step: 1, usage: { inputTokens: 400, outputTokens: 0, cacheReadTokens: 0, totalTokens: 400 } },
    })
    const finished = encodeFrames(head, 100)
    const unfinished = encodeFrames(tail, 1)
    // Simulates reading the file while the Harness appends the next frame.
    writeLog(home, {
      id: 'growing',
      bytes: Buffer.concat([finished, unfinished]).subarray(0, finished.length + Math.floor(unfinished.length / 2)),
    })

    const logLines = []
    const service = createDashboardService({
      homeDir: home,
      configuredProviders: [],
      now: () => NOW,
      logger: { warn: (message) => logLines.push(message) },
    })
    const snapshot = await service.snapshot()

    assert.deepEqual(snapshot.warnings, [], 'a half-written frame must not show a footer warning')
    assert.equal(snapshot.sessions.length, 1)
    assert.equal(snapshot.stats.total, 100, 'only the complete frame is counted')
    assert.ok(
      logLines.some((line) => line.includes('incomplete')),
      'the diagnostic still reaches the logger',
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a genuinely corrupt frame still produces a snapshot warning', async () => {
  const home = makeHome()
  try {
    const head = sessionEvents({ id: 'damaged', title: '坏帧', entries: [{ time: at(2026, 5, 20, 10), tokens: 100 }] })
      .map((event) => JSON.stringify(event))
      .join('\n')
    const tail = JSON.stringify({
      type: 'assistant/message',
      time: at(2026, 5, 20, 11),
      data: { turn: 2, step: 1, usage: { inputTokens: 400, outputTokens: 0, cacheReadTokens: 0, totalTokens: 400 } },
    })
    const finished = encodeFrames(head, 100)
    const second = Buffer.from(encodeFrames(tail, 1))
    const bytes = Buffer.concat([finished, second])
    // Destroy the second frame's block headers/payload: not an unfinished write,
    // a real corruption that must be surfaced.
    for (let index = finished.length + 8; index < bytes.length - 2; index += 1) bytes[index] = 0xaa
    writeLog(home, { id: 'damaged', bytes })

    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW })
    const snapshot = await service.snapshot()

    assert.ok(snapshot.warnings.length > 0)
    assert.ok(snapshot.warnings.some((warning) => warning.includes('damaged')))
    assert.equal(snapshot.stats.total, 100, 'the intact frame is still counted')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('workspace.json decides active/archived/deleted', async () => {
  const home = makeHome()
  try {
    for (const id of ['active-session', 'archived-session', 'deleted-session']) {
      writeLog(home, { id, title: id, entries: [{ time: at(2026, 5, 20, 10), tokens: 10 }] })
    }
    writeWorkspace(home, {
      global: { archivedSessionIds: ['session-archived-session'] },
      tables: { workspaces: { 'w-a': { path: 'C:\\a', title: 'A', sessionIds: ['session-active-session'] } } },
    })
    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW })
    const snapshot = await service.snapshot()
    const statuses = new Map(snapshot.sessions.map((row) => [row.id, row.status]))
    assert.equal(statuses.get('active-session'), 'active')
    assert.equal(statuses.get('archived-session'), 'archived')
    assert.equal(statuses.get('deleted-session'), 'deleted')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('subagent logs merge into the parent, orphan logs stand alone', async () => {
  const home = makeHome()
  try {
    writeLog(home, { id: 'parent', title: '父', entries: [{ time: at(2026, 5, 20, 9), tokens: 100 }] })
    writeLog(home, {
      id: 'child',
      parentSession: 'session-parent',
      delegationDepth: 1,
      title: '子',
      entries: [{ time: at(2026, 5, 20, 10), tokens: 25 }],
    })
    writeLog(home, {
      id: 'orphan',
      parentSession: 'session-gone',
      delegationDepth: 1,
      title: '孤儿',
      entries: [{ time: at(2026, 5, 20, 11), tokens: 7 }],
    })
    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW })
    const snapshot = await service.snapshot()

    assert.equal(snapshot.sessions.length, 2)
    const parent = snapshot.sessions.find((row) => row.id === 'parent')
    assert.equal(parent.total, 125)
    assert.equal(parent.subagentCount, 1)
    assert.equal(parent.orphan, false)
    const orphan = snapshot.sessions.find((row) => row.id === 'orphan')
    assert.equal(orphan.orphan, true)
    assert.equal(orphan.total, 7)
    assert.equal(snapshot.stats.total, 132)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the projection cache fills a missing session title', async () => {
  const home = makeHome()
  try {
    writeLog(home, { id: 'no-title', entries: [{ time: at(2026, 5, 20, 10), tokens: 5 }] })
    mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    writeFileSync(
      join(home, 'storages', 'session_projcache', 'sessions', 'no-title.json'),
      JSON.stringify({ version: 1, record: { rows: { title: { ver: 1, seq: 2, val: '投影标题' } } } }),
    )
    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW })
    const snapshot = await service.snapshot()
    assert.equal(snapshot.sessions[0].title, '投影标题')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the ttl reuses a snapshot and invalidate() refreshes it', async () => {
  const home = makeHome()
  try {
    const file = writeLog(home, { id: 'growing', title: '增长中', entries: [{ time: at(2026, 5, 20, 10), tokens: 100 }] })
    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW, ttlMs: 60_000 })

    const first = await service.snapshot()
    assert.equal(first.stats.total, 100)
    assert.equal(first.sessions[0].title, '增长中')

    appendFrame(file, [
      {
        type: 'assistant/message',
        time: at(2026, 5, 20, 11),
        data: { turn: 2, step: 1, usage: { inputTokens: 400, outputTokens: 0, cacheReadTokens: 0, totalTokens: 400 } },
      },
    ])

    const cached = await service.snapshot()
    assert.equal(cached, first, 'within the ttl the very same payload is reused')
    assert.equal(cached.stats.total, 100)

    service.invalidate()
    const refreshed = await service.snapshot()
    assert.notEqual(refreshed, first)
    assert.equal(refreshed.stats.total, 500)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('unchanged logs are not reparsed; only the changed log is', async () => {
  const home = makeHome()
  try {
    const fileA = writeLog(home, { id: 'a', title: 'A', entries: [{ time: at(2026, 5, 20, 10), tokens: 10 }] })
    writeLog(home, { id: 'b', title: 'B', entries: [{ time: at(2026, 5, 20, 10), tokens: 20 }] })

    const parsed = []
    const service = createDashboardService({
      homeDir: home,
      configuredProviders: [],
      now: () => NOW,
      ttlMs: 0,
      onSessionParsed: (id) => parsed.push(id),
    })

    await service.snapshot()
    assert.deepEqual(parsed.sort(), ['a', 'b'])

    await service.snapshot()
    assert.deepEqual(parsed.sort(), ['a', 'b'], 'a second build re-reads only metadata')

    appendFrame(fileA, [
      {
        type: 'assistant/message',
        time: at(2026, 5, 20, 11),
        data: { turn: 2, step: 1, usage: { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, totalTokens: 5 } },
      },
    ])
    const after = await service.snapshot()
    assert.deepEqual(parsed.sort(), ['a', 'a', 'b'])
    assert.equal(after.sessions.find((row) => row.id === 'a').total, 15)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('concurrent snapshot() calls share one in-flight build', async () => {
  const home = makeHome()
  try {
    writeLog(home, { id: 'a', title: 'A', entries: [{ time: at(2026, 5, 20, 10), tokens: 10 }] })
    let parsedCount = 0
    const service = createDashboardService({
      homeDir: home,
      configuredProviders: [],
      now: () => NOW,
      ttlMs: 0,
      onSessionParsed: () => {
        parsedCount += 1
      },
    })

    const first = service.snapshot()
    const second = service.snapshot()
    const [left, right] = await Promise.all([first, second])
    assert.equal(left, right)
    assert.equal(parsedCount, 1)
    assert.equal(left.stats.total, 10)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('discovery prefers the highest log version in a directory', async () => {
  const home = makeHome()
  try {
    const directory = join(home, 'sessions', 'ws', 'mixed')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'session.v3.jsonl'),
      JSON.stringify(sessionEvents({ id: 'mixed', title: '旧版本', entries: [{ time: at(2026, 5, 20, 10), tokens: 1 }] })[0]) + '\n',
    )
    const newer = sessionEvents({ id: 'mixed', title: '新版本', entries: [{ time: at(2026, 5, 20, 10), tokens: 9 }] })
      .map((event) => JSON.stringify(event))
      .join('\n')
    writeFileSync(join(directory, 'session.v4.jsonl.zstd'), encodeFrames(newer, 2))

    const discovered = discoverSessionLogs(home)
    assert.equal(discovered.entries.length, 1)
    assert.match(discovered.entries[0].logPath, /session\.v4\.jsonl\.zstd$/)

    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW })
    const snapshot = await service.snapshot()
    assert.equal(snapshot.sessions[0].title, '新版本')
    assert.equal(snapshot.stats.total, 9)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a deleted session log drops out of the snapshot', async () => {
  const home = makeHome()
  try {
    writeLog(home, { id: 'keep', title: '保留', entries: [{ time: at(2026, 5, 20, 10), tokens: 10 }] })
    writeLog(home, { id: 'vanish', title: '消失', entries: [{ time: at(2026, 5, 20, 10), tokens: 10 }] })
    const service = createDashboardService({ homeDir: home, configuredProviders: [], now: () => NOW, ttlMs: 0 })

    const before = await service.snapshot()
    assert.equal(before.sessions.length, 2)

    rmSync(join(home, 'sessions', 'ws-one', 'vanish'), { recursive: true, force: true })
    const after = await service.snapshot()
    assert.equal(after.sessions.length, 1)
    assert.equal(after.sessions[0].id, 'keep')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
