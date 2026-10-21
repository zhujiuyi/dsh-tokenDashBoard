import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSnapshot, SNAPSHOT_VERSION, UNTITLED_SESSION_TITLE } from '../src/host/aggregate.mjs'
import { foldSession } from '../src/host/events.mjs'
import { localDay } from '../src/host/time.mjs'

/** Local epoch ms for a wall-clock instant. */
function at(year, month, day, hour = 12, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

function usage(input, output = 0, cacheRead = 0, cacheWrite) {
  const buckets = { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, totalTokens: input + output + cacheRead }
  if (cacheWrite !== undefined) buckets.cacheWriteTokens = cacheWrite
  return buckets
}

/**
 * Fold a synthetic session log.
 * @param {object} options
 * @param {string} options.id
 * @param {string} [options.parentSession]
 * @param {number} [options.delegationDepth]
 * @param {string} [options.provider]
 * @param {Array<{ time: number, tokens: number, turn?: number, turnMs?: number, title?: string, userOnly?: boolean }>} options.entries
 */
function session(options) {
  const entries = []
  entries.push({
    type: 'session',
    version: 4,
    id: options.id,
    createdAt: options.entries.length > 0 ? options.entries[0].time : at(2026, 1, 1),
    cwd: options.cwd ?? `C:/work/${options.id}`,
    delegationDepth: options.delegationDepth ?? 0,
    ...(options.parentSession === undefined ? {} : { parentSession: options.parentSession }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  })
  let turn = 1
  for (const entry of options.entries) {
    if (options.provider !== undefined) {
      entries.push({ type: 'request/context', time: entry.time, data: { provider: options.provider, model: 'm' } })
    }
    if (entry.userOnly === true) {
      entries.push({ type: 'user/message', time: entry.time, data: { role: 'user', content: [] } })
      continue
    }
    entries.push({ type: 'user/message', time: entry.time, data: { role: 'user', content: [] } })
    entries.push({ type: 'turn/start', time: entry.time, data: { turn: entry.turn ?? turn } })
    entries.push({
      type: 'assistant/message',
      time: entry.time,
      data: { turn: entry.turn ?? turn, step: 1, usage: usage(entry.tokens) },
    })
    if (entry.turnMs !== undefined) {
      entries.push({ type: 'turn/end', time: entry.time + entry.turnMs, data: { turn: entry.turn ?? turn } })
    }
    turn += 1
  }
  if (options.title !== undefined) entries.push({ type: 'session/title', time: entries[0].createdAt, data: { title: options.title } })
  return foldSession(entries)
}

/** A workspace.json projection with the given ids. */
function workspace({ archived = [], active = {}, titles = {} } = {}) {
  return {
    ok: true,
    archived: new Set(archived.map((id) => id.replace(/^session-/, ''))),
    sessions: new Map(
      Object.entries(active).map(([id, info]) => [
        id.replace(/^session-/, ''),
        {
          workspaceId: info.workspaceId ?? 'w1',
          workspacePath: info.path ?? 'C:/work',
          workspaceTitle: info.title ?? 'work',
        },
      ]),
    ),
    warnings: [],
    signature: 'sig',
  }
}

const NOW = at(2026, 5, 20, 12)
const TODAY = localDay(NOW)

test('buildSnapshot emits the SPEC contract version and empty shape', () => {
  const snapshot = buildSnapshot({
    sessions: [],
    workspace: workspace(),
    configuredProviders: [{ id: 'opencode-go', name: 'opencode-go' }],
    now: NOW,
  })
  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.version, SNAPSHOT_VERSION)
  assert.equal(snapshot.generatedAt, NOW)
  assert.equal(snapshot.today, TODAY)
  assert.equal(snapshot.firstDay, null)
  assert.equal(snapshot.lastDay, null)
  assert.deepEqual(snapshot.days, [])
  assert.deepEqual(snapshot.sessions, [])
  assert.equal(snapshot.stats.total, 0)
  assert.equal(snapshot.stats.peakDay, null)
  assert.equal(snapshot.stats.longestTurnMs, 0)
  assert.deepEqual(snapshot.warnings, [])
  // A configured-but-unused route still has a row (and a zero hour chart).
  assert.deepEqual(
    snapshot.providers.map((row) => [row.id, row.name, row.configured, row.seenInLogs, row.total]),
    [['opencode-go', 'OpenCode Go', true, false, 0]],
  )
  assert.deepEqual(snapshot.todayHours['opencode-go'], new Array(24).fill(0))
})

test('days split on local midnight and stay sparse', () => {
  const sessions = [
    session({
      id: 'a',
      provider: 'opencode-go',
      entries: [
        { time: at(2026, 1, 15, 23, 59), tokens: 100 },
        { time: at(2026, 1, 16, 0, 1), tokens: 200 },
        { time: at(2026, 1, 18, 10, 0), tokens: 300 },
      ],
    }),
  ]
  const snapshot = buildSnapshot({ sessions, workspace: workspace(), configuredProviders: [], now: NOW })
  assert.deepEqual(snapshot.days.map((row) => row.day), ['2026-01-15', '2026-01-16', '2026-01-18'])
  assert.deepEqual(snapshot.days.map((row) => row.total), [100, 200, 300])
  assert.deepEqual(snapshot.days[0].providers, { 'opencode-go': 100 })
  assert.deepEqual(snapshot.days[0].sessions, { a: 100 })
  assert.equal(snapshot.firstDay, '2026-01-15')
  assert.equal(snapshot.lastDay, '2026-01-18')
  assert.equal(snapshot.stats.total, 600)
  assert.deepEqual(snapshot.stats.peakDay, { day: '2026-01-18', tokens: 300 })
})

test('active days, streaks and last30 count only days with token usage', () => {
  const sessions = [
    session({
      id: 'a',
      provider: 'opencode-go',
      entries: [
        // An activity-only day: a prompt was opened but no usage was recorded.
        { time: at(2026, 5, 15, 9), tokens: 0, userOnly: true },
        { time: at(2026, 5, 18, 9), tokens: 10 },
        { time: at(2026, 5, 19, 9), tokens: 20 },
        { time: at(2026, 5, 20, 9), tokens: 30 },
        // Older than the 30-day window.
        { time: at(2026, 3, 1, 9), tokens: 1000 },
      ],
    }),
  ]
  const snapshot = buildSnapshot({ sessions, workspace: workspace(), configuredProviders: [], now: NOW })
  // The heatmap still shows the activity-only day...
  assert.equal(snapshot.days.length, 5)
  assert.equal(snapshot.days[0].day, '2026-03-01')
  assert.equal(snapshot.days[1].day, '2026-05-15')
  assert.equal(snapshot.days[1].total, 0)
  // ...but "active days" and the streaks are usage-only.
  assert.equal(snapshot.stats.activeDays, 4)
  assert.equal(snapshot.stats.longestStreak, 3)
  assert.equal(snapshot.stats.currentStreak, 3)
  assert.equal(snapshot.stats.last30, 60)
  assert.equal(snapshot.stats.total, 1060)
})

test('current streak anchors on yesterday before today has any usage', () => {
  const yesterday = at(2026, 5, 19, 9)
  const sessions = [
    session({
      id: 'a',
      provider: 'opencode-go',
      entries: [
        { time: at(2026, 5, 18, 9), tokens: 10 },
        { time: yesterday, tokens: 10 },
      ],
    }),
  ]
  const snapshot = buildSnapshot({ sessions, workspace: workspace(), configuredProviders: [], now: NOW })
  assert.equal(snapshot.stats.currentStreak, 2)
  // No usage today, so nothing is reported for today's hours.
  assert.deepEqual(snapshot.todayHours['opencode-go'], new Array(24).fill(0))
})

test('todayHours buckets add up to today', () => {
  const sessions = [
    session({
      id: 'a',
      provider: 'opencode-go',
      entries: [
        { time: at(2026, 5, 19, 23, 30), tokens: 999 }, // yesterday, must not leak in
        { time: new Date(2026, 4, 20, 9, 15).getTime(), tokens: 40 },
        { time: new Date(2026, 4, 20, 9, 45).getTime(), tokens: 60 },
        { time: new Date(2026, 4, 20, 18, 0).getTime(), tokens: 500 },
      ],
    }),
    session({
      id: 'b',
      provider: 'opendesign',
      entries: [{ time: new Date(2026, 4, 20, 9, 30).getTime(), tokens: 400 }],
    }),
  ]
  const snapshot = buildSnapshot({ sessions, workspace: workspace(), configuredProviders: [], now: NOW })
  const today = snapshot.days.find((row) => row.day === TODAY)
  assert.ok(today !== undefined)
  assert.equal(today.total, 1000)

  const summed = Object.values(snapshot.todayHours).reduce(
    (total, buckets) => total + buckets.reduce((sum, value) => sum + value, 0),
    0,
  )
  assert.equal(summed, today.total)
  assert.equal(snapshot.todayHours['opencode-go'][9], 100)
  assert.equal(snapshot.todayHours['opencode-go'][18], 500)
  assert.equal(snapshot.todayHours['opendesign'][9], 400)
  // Yesterday's 999 stayed on yesterday.
  assert.equal(snapshot.days.find((row) => row.day === '2026-05-19').total, 999)
})

test('subagents merge into their parent row', () => {
  const parent = session({
    id: 'parent',
    provider: 'opencode-go',
    title: '父会话',
    entries: [
      { time: at(2026, 5, 20, 9), tokens: 100, turnMs: 1_000 },
      { time: at(2026, 5, 20, 10), tokens: 200, turnMs: 4_000 },
    ],
  })
  const child = session({
    id: 'child-1',
    parentSession: 'session-parent',
    delegationDepth: 1,
    origin: 'subagent',
    provider: 'opendesign',
    entries: [
      { time: at(2026, 5, 20, 11), tokens: 300, turnMs: 9_000 },
      { time: at(2026, 5, 20, 12), tokens: 400, turnMs: 2_000 },
    ],
  })
  const child2 = session({
    id: 'child-2',
    parentSession: 'session-parent',
    delegationDepth: 1,
    provider: 'opencode-go',
    entries: [{ time: at(2026, 5, 20, 13), tokens: 500, turnMs: 500 }],
  })

  const snapshot = buildSnapshot({
    sessions: [parent, child, child2],
    workspace: workspace({ active: { parent: {} } }),
    configuredProviders: [],
    now: NOW,
  })

  assert.equal(snapshot.sessions.length, 1)
  const row = snapshot.sessions[0]
  assert.equal(row.id, 'parent')
  assert.equal(row.title, '父会话')
  assert.equal(row.total, 100 + 200 + 300 + 400 + 500)
  // Every synthetic entry writes one user/message and one assistant/message.
  assert.equal(row.messages, 10)
  assert.equal(row.turns, 5)
  assert.equal(row.subagentCount, 2)
  assert.equal(row.orphan, false)
  assert.equal(row.status, 'active')
  assert.equal(row.longestTurnMs, 9_000)
  assert.equal(row.firstAt, at(2026, 5, 20, 9))
  assert.deepEqual(row.byProvider, { 'opencode-go': 800, opendesign: 700 })
  assert.equal(row.provider, 'opencode-go')
  assert.deepEqual(row.providers, ['opencode-go', 'opendesign'])
  assert.equal(snapshot.stats.total, 1500)
  assert.equal(snapshot.providers.find((provider) => provider.id === 'opendesign').sessionCount, 1)
})

test('an orphan subagent keeps its own row', () => {
  const orphan = session({
    id: 'child-lonely',
    parentSession: 'session-missing',
    delegationDepth: 1,
    provider: 'opencode-go',
    entries: [{ time: at(2026, 5, 20, 9), tokens: 250 }],
  })
  const snapshot = buildSnapshot({
    sessions: [orphan],
    workspace: workspace(),
    configuredProviders: [],
    now: NOW,
  })
  assert.equal(snapshot.sessions.length, 1)
  assert.equal(snapshot.sessions[0].id, 'child-lonely')
  assert.equal(snapshot.sessions[0].orphan, true)
  assert.equal(snapshot.sessions[0].subagentCount, 0)
  assert.equal(snapshot.sessions[0].status, 'deleted')
  assert.equal(snapshot.sessions[0].total, 250)
})

test('a multi-level orphan chain roots on the first known child', () => {
  // C → B → A, where only B and C logs exist: B becomes the orphan row root
  // and C is merged into it.
  const b = session({
    id: 'b',
    parentSession: 'session-a',
    delegationDepth: 1,
    provider: 'opencode-go',
    entries: [{ time: at(2026, 5, 20, 9), tokens: 100 }],
  })
  const c = session({
    id: 'c',
    parentSession: 'session-b',
    delegationDepth: 1,
    provider: 'opencode-go',
    entries: [{ time: at(2026, 5, 20, 10), tokens: 200 }],
  })
  const snapshot = buildSnapshot({
    sessions: [c, b],
    workspace: workspace(),
    configuredProviders: [],
    now: NOW,
  })
  assert.equal(snapshot.sessions.length, 1)
  assert.equal(snapshot.sessions[0].id, 'b')
  assert.equal(snapshot.sessions[0].orphan, true)
  assert.equal(snapshot.sessions[0].subagentCount, 1)
  assert.equal(snapshot.sessions[0].total, 300)
})

test('a parent chain cycle does not duplicate tokens', () => {
  const x = session({
    id: 'x',
    parentSession: 'session-y',
    delegationDepth: 1,
    provider: 'opencode-go',
    entries: [{ time: at(2026, 5, 20, 9), tokens: 100 }],
  })
  const y = session({
    id: 'y',
    parentSession: 'session-x',
    delegationDepth: 1,
    provider: 'opencode-go',
    entries: [{ time: at(2026, 5, 20, 10), tokens: 200 }],
  })
  const snapshot = buildSnapshot({ sessions: [x, y], workspace: workspace(), configuredProviders: [], now: NOW })
  assert.equal(snapshot.stats.total, 300)
  assert.equal(snapshot.sessions.reduce((sum, row) => sum + row.total, 0), 300)
  assert.ok(snapshot.warnings.some((warning) => warning.includes('cycle')))
})

test('session status comes from workspace.json', () => {
  const active = session({ id: 'active-1', provider: 'opencode-go', entries: [{ time: at(2026, 5, 20, 9), tokens: 10 }] })
  const archived = session({ id: 'archived-1', provider: 'opencode-go', entries: [{ time: at(2026, 5, 20, 9), tokens: 20 }] })
  const deleted = session({ id: 'deleted-1', provider: 'opencode-go', entries: [{ time: at(2026, 5, 20, 9), tokens: 30 }] })
  const untitled = session({ id: 'untitled-1', provider: 'opencode-go', entries: [{ time: at(2026, 5, 20, 9), tokens: 40 }] })

  const state = workspace({
    active: { 'session-active-1': { path: 'C:/proj', title: '项目 A' } },
    archived: ['session-archived-1'],
  })
  const snapshot = buildSnapshot({
    sessions: [active, archived, deleted, untitled],
    workspace: state,
    configuredProviders: [],
    titles: new Map([['untitled-1', '来自 projcache']]),
    now: NOW,
  })

  const byId = new Map(snapshot.sessions.map((row) => [row.id, row]))
  assert.equal(byId.get('active-1').status, 'active')
  assert.equal(byId.get('active-1').workspacePath, 'C:/proj')
  assert.equal(byId.get('active-1').workspaceTitle, '项目 A')
  assert.equal(byId.get('archived-1').status, 'archived')
  assert.equal(byId.get('deleted-1').status, 'deleted')
  assert.equal(byId.get('deleted-1').workspacePath, null)
  assert.equal(byId.get('untitled-1').title, '来自 projcache')
  assert.equal(byId.get('active-1').title, UNTITLED_SESSION_TITLE)
})

test('providers keep configured-but-unused routes and map display names', () => {
  const seen = session({ id: 'a', provider: 'opendesign', entries: [{ time: at(2026, 5, 20, 9), tokens: 42 }] })
  const snapshot = buildSnapshot({
    sessions: [seen],
    workspace: workspace(),
    configuredProviders: [
      { id: 'opencode-go', name: 'opencode-go' },
      { id: 'deepseek-official', name: 'deepseek-official' },
      { id: 'siliconflow', name: 'siliconflow' },
      { id: 'my-route', name: '我的通道' },
    ],
    now: NOW,
  })
  const rows = new Map(snapshot.providers.map((row) => [row.id, row]))
  assert.equal(rows.get('opendesign').name, 'Open Design')
  assert.equal(rows.get('opendesign').configured, false)
  assert.equal(rows.get('opendesign').seenInLogs, true)
  assert.equal(rows.get('opendesign').total, 42)
  assert.equal(rows.get('opendesign').sessionCount, 1)
  assert.deepEqual(rows.get('opendesign').peak, { day: TODAY, tokens: 42 })
  assert.equal(rows.get('opencode-go').configured, true)
  assert.equal(rows.get('opencode-go').seenInLogs, false)
  assert.equal(rows.get('opencode-go').total, 0)
  assert.equal(rows.get('opencode-go').peak, null)
  assert.equal(rows.get('deepseek-official').name, 'DeepSeek 官方')
  assert.equal(rows.get('siliconflow').name, '硅基流动')
  assert.equal(rows.get('my-route').name, '我的通道')
  // Sorted by total, then id.
  assert.deepEqual(snapshot.providers.map((row) => row.id), ['opendesign', 'deepseek-official', 'my-route', 'opencode-go', 'siliconflow'])
  // Every provider id has a 24-slot chart row.
  for (const row of snapshot.providers) assert.equal(snapshot.todayHours[row.id].length, 24)
})

test('a provider that was routed but produced no usage still appears', () => {
  const at10 = at(2026, 5, 20, 10)
  const folded = foldSession([
    { type: 'session', version: 4, id: 'a', createdAt: at10, delegationDepth: 0 },
    { type: 'request/context', time: at10, data: { provider: 'free', model: 'm' } },
    { type: 'request/header', time: at10 + 1, data: { header: { config: { provider: 'opencode-go', model: 'm' } } } },
    {
      type: 'assistant/message',
      time: at10 + 2,
      data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, totalTokens: 10 } },
    },
  ])
  const snapshot = buildSnapshot({
    sessions: [folded],
    workspace: workspace(),
    configuredProviders: [],
    now: NOW,
  })
  const free = snapshot.providers.find((row) => row.id === 'free')
  assert.ok(free !== undefined, 'the routed-but-unused provider keeps a row')
  assert.equal(free.total, 0)
  assert.equal(free.seenInLogs, true)
  assert.equal(free.configured, false)
  assert.equal(free.sessionCount, 0)
  assert.equal(snapshot.providers.find((row) => row.id === 'opencode-go').total, 10)
  // The session row only lists providers that actually spent tokens.
  assert.deepEqual(snapshot.sessions[0].providers, ['opencode-go'])
})

test('sessions that never spent a token are filtered out of the list', () => {
  // An abandoned session: a prompt was opened, no usage was recorded.
  const abandoned = session({
    id: 'abandoned',
    provider: 'opencode-go',
    entries: [{ time: at(2026, 5, 20, 9), tokens: 0, userOnly: true }],
  })
  const real = session({ id: 'real', provider: 'opencode-go', entries: [{ time: at(2026, 5, 20, 10), tokens: 50 }] })
  // Structurally odd but explicit: tokens without any message count. Only
  // `total <= 0` is filtered, so this row must survive.
  const tokensOnly = { ...session({ id: 'tokens-only', provider: 'opencode-go', entries: [{ time: at(2026, 5, 20, 11), tokens: 7 }] }), messages: 0 }

  const snapshot = buildSnapshot({
    sessions: [abandoned, real, tokensOnly],
    workspace: workspace(),
    configuredProviders: [],
    now: NOW,
  })
  assert.deepEqual(snapshot.sessions.map((row) => row.id).sort(), ['real', 'tokens-only'])
  assert.equal(snapshot.stats.total, 57)
  // The heatmap still records the abandoned session's activity that day.
  assert.deepEqual(snapshot.days.map((row) => row.day), [TODAY])
  // And a zero-usage session still marks its provider as seen in the logs.
  assert.equal(snapshot.providers.find((row) => row.id === 'opencode-go').total, 57)
})

test('session rows expose exactly the contract fields', () => {
  const one = session({ id: 'a', provider: 'opencode-go', entries: [{ time: at(2026, 5, 20, 9), tokens: 5 }] })
  const snapshot = buildSnapshot({ sessions: [one], workspace: workspace(), configuredProviders: [], now: NOW })
  assert.deepEqual(Object.keys(snapshot.sessions[0]).sort(), [
    'byDay',
    'byProvider',
    'firstAt',
    'id',
    'lastAt',
    'longestTurnMs',
    'messages',
    'orphan',
    'provider',
    'providers',
    'status',
    'subagentCount',
    'title',
    'total',
    'turns',
    'workspacePath',
    'workspaceTitle',
  ])
})
