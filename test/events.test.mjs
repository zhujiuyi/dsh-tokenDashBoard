import assert from 'node:assert/strict'
import { test } from 'node:test'

import { foldSession, foldSessionText, parseEventLines } from '../src/host/events.mjs'
import { localDay } from '../src/host/time.mjs'

/** Local epoch ms for a wall-clock instant (tests must not depend on UTC). */
function at(year, month, day, hour, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

function usage(input, output, cacheRead, cacheWrite) {
  const buckets = { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead }
  if (cacheWrite !== undefined) buckets.cacheWriteTokens = cacheWrite
  // The log also carries totalTokens = input + output + cacheRead. The folder
  // must ignore it; it is set here so a double count would be obvious.
  buckets.totalTokens = input + output + cacheRead
  return buckets
}

function assistant(turn, time, buckets, sourceProvider) {
  const data = { turn, step: 1, usage: buckets }
  if (sourceProvider !== undefined) data.message = { role: 'assistant', source: { kind: 'model', provider: sourceProvider } }
  return { type: 'assistant/message', time, data }
}

function context(time, provider, model = 'm') {
  return { type: 'request/context', time, data: { provider, model, contextWindow: 1000 } }
}

function header(time, provider, model = 'm') {
  return { type: 'request/header', time, data: { header: { config: { provider, model } } } }
}

test('usage totals only the four buckets and never totalTokens', () => {
  const events = [
    { type: 'session', version: 4, id: 's1', createdAt: at(2026, 1, 10, 9), cwd: 'C:/x', delegationDepth: 0 },
    context(at(2026, 1, 10, 9), 'opencode-go'),
    assistant(1, at(2026, 1, 10, 9, 0, 5), usage(100, 10, 1000)),
    assistant(1, at(2026, 1, 10, 9, 0, 9), usage(200, 20, 2000, 50)),
  ]
  const folded = foldSession(events)
  assert.deepEqual(folded.usage, { input: 300, output: 30, cacheRead: 3000, cacheWrite: 50 })
  // 1110 + 2270: not 1110+1110 and not 2270+2270.
  assert.equal(folded.total, 3380)
  assert.equal(folded.messages, 2)
  assert.equal(folded.assistantMessages, 2)
  assert.equal(folded.turns, 0)
})

test('cacheWriteTokens is optional and defaults to 0', () => {
  const folded = foldSession([context(at(2026, 1, 10, 9), 'a'), assistant(1, at(2026, 1, 10, 9, 1), usage(5, 5, 5))])
  assert.equal(folded.usage.cacheWrite, 0)
  assert.equal(folded.total, 15)
})

test('usage is attributed to the provider active at that point in the log', () => {
  const events = [
    { type: 'session', version: 4, id: 's1', createdAt: at(2026, 1, 10, 9), delegationDepth: 0 },
    header(at(2026, 1, 10, 9), 'opencode-go'),
    assistant(1, at(2026, 1, 10, 9, 0, 1), usage(10, 1, 100)),
    context(at(2026, 1, 10, 9, 5), 'opendesign'),
    assistant(1, at(2026, 1, 10, 9, 5, 1), usage(20, 2, 200)),
    header(at(2026, 1, 10, 9, 9), 'deepseek-official'),
    assistant(2, at(2026, 1, 10, 9, 9, 1), usage(30, 3, 300)),
    header(at(2026, 1, 10, 9, 9), 'opendesign'),
    assistant(2, at(2026, 1, 10, 9, 9, 2), usage(40, 4, 400)),
  ]
  const folded = foldSession(events)
  assert.deepEqual(folded.providerTotals, {
    'opencode-go': 111,
    opendesign: 222 + 444,
    'deepseek-official': 333,
  })
  assert.equal(folded.total, 111 + 666 + 333)
  assert.deepEqual([...folded.providersSeen].sort(), ['deepseek-official', 'opencode-go', 'opendesign'])
})

test('a message source provider is the fallback when no routing event was seen', () => {
  const folded = foldSession([assistant(1, at(2026, 1, 10, 9), usage(1, 1, 1), 'siliconflow')])
  assert.deepEqual(folded.providerTotals, { siliconflow: 3 })
  // With no evidence at all the bucket still has to live somewhere.
  const unknown = foldSession([assistant(1, at(2026, 1, 10, 9), usage(1, 1, 1))])
  assert.deepEqual(unknown.providerTotals, { unknown: 3 })
})

test('days and hours split on local calendar boundaries', () => {
  const beforeMidnight = at(2026, 1, 15, 23, 59, 30)
  const afterMidnight = at(2026, 1, 16, 0, 1, 0)
  const events = [
    { type: 'session', version: 4, id: 's1', createdAt: beforeMidnight, delegationDepth: 0 },
    context(beforeMidnight, 'opencode-go'),
    assistant(1, beforeMidnight, usage(10, 1, 100)),
    assistant(1, afterMidnight, usage(20, 2, 200)),
  ]
  const folded = foldSession(events)
  assert.deepEqual(folded.byDay, { '2026-01-15': 111, '2026-01-16': 222 })
  assert.deepEqual(folded.hoursByDay['2026-01-15']['opencode-go'][23], 111)
  assert.deepEqual(folded.hoursByDay['2026-01-16']['opencode-go'][0], 222)
  // Each provider keeps a dense 24-slot array, so the client can plot it as-is.
  assert.equal(folded.hoursByDay['2026-01-15']['opencode-go'].length, 24)
  assert.equal(folded.hoursByDay['2026-01-15']['opencode-go'][22], 0)
  assert.deepEqual(folded.activeDays, ['2026-01-15', '2026-01-16'])
})

test('turn durations take the longest turn, and turns count turn/start events', () => {
  const base = at(2026, 1, 10, 9)
  const events = [
    { type: 'session', version: 4, id: 's1', createdAt: base, delegationDepth: 0 },
    { type: 'turn/start', time: base, data: { turn: 1 } },
    { type: 'turn/end', time: base + 5_000, data: { turn: 1 } },
    { type: 'turn/start', time: base + 10_000, data: { turn: 2 } },
    { type: 'turn/end', time: base + 18_000, data: { turn: 2 } },
    { type: 'turn/start', time: base + 20_000, data: { turn: 3 } },
  ]
  const folded = foldSession(events)
  assert.equal(folded.turns, 3)
  assert.equal(folded.longestTurnMs, 8_000)
})

test('messages count user and assistant messages only', () => {
  const base = at(2026, 1, 10, 9)
  const folded = foldSession([
    { type: 'session', version: 4, id: 's1', createdAt: base, delegationDepth: 0 },
    { type: 'user/message', time: base, data: { role: 'user', content: [] } },
    { type: 'user/message', time: base, data: { content: [] } },
    { type: 'user/message', time: base, data: { role: 'system', content: [] } },
    { type: 'system/message', time: base, data: { content: [] } },
    assistant(1, base + 1, usage(1, 1, 1)),
  ])
  assert.equal(folded.userMessages, 2)
  assert.equal(folded.assistantMessages, 1)
  assert.equal(folded.messages, 3)
})

test('titles come from session/title, with title or val, last one winning', () => {
  const base = at(2026, 1, 10, 9)
  const fromTitle = foldSession([
    { type: 'session', version: 4, id: 's1', createdAt: base, delegationDepth: 0 },
    { type: 'session/title', time: base, data: { title: '第一个标题' } },
  ])
  assert.equal(fromTitle.title, '第一个标题')

  const fromVal = foldSession([
    { type: 'session', version: 4, id: 's1', createdAt: base, delegationDepth: 0 },
    { type: 'session/title', time: base, data: { val: '旧式标题' } },
  ])
  assert.equal(fromVal.title, '旧式标题')

  const lastWins = foldSession([
    { type: 'session', version: 4, id: 's1', createdAt: base, delegationDepth: 0 },
    { type: 'session/title', time: base, data: { title: '兜底标题', source: { kind: 'fallback' } } },
    { type: 'session/title', time: base + 1, data: { title: '模型标题', source: { kind: 'provider' } } },
  ])
  assert.equal(lastWins.title, '模型标题')
})

test('first/last activity and the head fields survive malformed neighbours', () => {
  const base = at(2026, 1, 10, 9)
  const text = [
    JSON.stringify({ type: 'session', version: 4, id: 's1', createdAt: base, cwd: 'C:/w', delegationDepth: 1, parentSession: 'session-parent', origin: 'subagent' }),
    '{"broken":',
    JSON.stringify({ type: 'user/message', time: base + 1_000, data: { role: 'user', content: [] } }),
    JSON.stringify({ type: 'assistant/message', time: base + 2_000, data: { usage: usage(1, 1, 1) } }),
  ].join('\n')

  const folded = foldSessionText(text)
  assert.equal(folded.hasHead, true)
  assert.equal(folded.id, 's1')
  assert.equal(folded.version, 4)
  assert.equal(folded.cwd, 'C:/w')
  assert.equal(folded.delegationDepth, 1)
  assert.equal(folded.parentSession, 'session-parent')
  assert.equal(folded.origin, 'subagent')
  assert.equal(folded.firstAt, base + 1_000)
  assert.equal(folded.lastAt, base + 2_000)
  assert.equal(folded.malformedLines, 1)
})

test('parseEventLines skips unparsable and non-object lines', () => {
  const { events, malformed } = parseEventLines('{"a":1}\n\n42\nnot json\n{"b":2}\n')
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }])
  assert.equal(malformed, 2)
})

test('an empty event list folds to a zeroed session', () => {
  const folded = foldSession([])
  assert.equal(folded.total, 0)
  assert.deepEqual(folded.byDay, {})
  assert.equal(folded.hasHead, false)
  assert.equal(folded.title, null)
  assert.deepEqual(folded.activeDays, [])
})

test('localDay is the day bucket used by the folder', () => {
  const timestamp = at(2026, 3, 8, 0, 30)
  assert.equal(localDay(timestamp), '2026-03-08')
})
