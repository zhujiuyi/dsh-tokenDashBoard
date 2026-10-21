/**
 * Single-session folding: turn one session's event stream into the handful of
 * numbers the dashboard needs.
 *
 * The only usage source is `assistant/message`'s `data.usage`:
 *
 *   inputTokens  uncached input   (cache miss)
 *   outputTokens generated output
 *   cacheReadTokens  input served from the prompt cache
 *   cacheWriteTokens optional cache write (0 when the provider reports none)
 *
 * `data.usage.totalTokens` is **never** used: it already equals
 * `inputTokens + outputTokens + cacheReadTokens`, so adding it on top would
 * double count. Summing the four buckets matches the Harness' own projection
 * cache (`tokenUsage.val.totals`) for every settled session.
 *
 * Provider attribution follows log order: `request/context` and
 * `request/header` set the currently active provider, and every following
 * `assistant/message` is billed to it — so one session may split across
 * providers when the user changes routes mid-conversation. When a message
 * itself records `data.message.source.provider` and no routing event has been
 * seen yet, that value is the fallback.
 *
 * Day/hour bucketing uses local calendar days (`time.mjs`), because the
 * dashboard's "today" is the user's local today.
 */

import { localDay, localHour } from './time.mjs'

/**
 * @typedef {object} FoldedSession
 * @property {string | null} id                session id from the log head
 * @property {number | null} version
 * @property {number | null} createdAt
 * @property {string | null} cwd
 * @property {number} delegationDepth          0 for a top-level session
 * @property {string | null} parentSession     raw value from the log head
 * @property {string | null} origin
 * @property {boolean} hasHead
 * @property {string | null} title
 * @property {number} total                    four buckets summed
 * @property {{input: number, output: number, cacheRead: number, cacheWrite: number}} usage
 * @property {Record<string, number>} providerTotals  provider id -> tokens
 * @property {string[]} providersSeen           every provider id attributed at least once
 * @property {Record<string, number>} byDay     day -> tokens (>0 only)
 * @property {Record<string, Record<string, number>>} dayProviders  day -> provider -> tokens
 * @property {Record<string, Record<string, number[]>>} hoursByDay  day -> provider -> 24 buckets
 * @property {number} messages                 user + assistant messages
 * @property {number} userMessages
 * @property {number} assistantMessages
 * @property {number} turns                    turn/start count
 * @property {number} longestTurnMs            0 when unknown
 * @property {number | null} firstAt           earliest event time (epoch ms)
 * @property {number | null} lastAt            latest event time (epoch ms)
 * @property {string[]} activeDays             local days with any event (ascending)
 * @property {number} malformedLines           JSONL lines that did not parse
 * @property {number} unusableEvents           parsed non-objects / events without usable fields
 */

/**
 * Parse a JSONL session log into event objects, tolerating bad lines.
 * @param {string} text
 * @returns {{ events: any[], malformed: number }}
 */
export function parseEventLines(text) {
  /** @type {any[]} */
  const events = []
  let malformed = 0
  if (typeof text !== 'string' || text.length === 0) return { events, malformed }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') continue
    try {
      const value = JSON.parse(line)
      if (value !== null && typeof value === 'object') events.push(value)
      else malformed += 1
    } catch {
      // A half-written trailing line, or a damaged frame: skip just that line.
      malformed += 1
    }
  }
  return { events, malformed }
}

/**
 * Fold one session's events.
 * @param {any[]} events
 * @param {{ unknownProvider?: string }} [options]
 * @returns {FoldedSession}
 */
export function foldSession(events, options = {}) {
  const unknownProvider = typeof options.unknownProvider === 'string' ? options.unknownProvider : 'unknown'

  /** @type {FoldedSession} */
  const folded = {
    id: null,
    version: null,
    createdAt: null,
    cwd: null,
    delegationDepth: 0,
    parentSession: null,
    origin: null,
    hasHead: false,
    title: null,
    total: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    providerTotals: {},
    providersSeen: [],
    byDay: {},
    dayProviders: {},
    hoursByDay: {},
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    turns: 0,
    longestTurnMs: 0,
    firstAt: null,
    lastAt: null,
    activeDays: [],
    malformedLines: 0,
    unusableEvents: 0,
  }
  if (!Array.isArray(events) || events.length === 0) return folded

  /** @type {Map<string, number>} */
  const dayTotals = new Map()
  /** @type {Map<string, Map<string, number>>} */
  const dayProviders = new Map()
  /** @type {Map<string, Map<string, number[]>>} */
  const hoursByDay = new Map()
  /** @type {Map<string, number>} */
  const providerTotals = new Map()
  /** @type {Set<string>} */
  const providersSeen = new Set()
  /** @type {Set<string>} */
  const activeDays = new Set()
  /** @type {Map<string, number>} turn number -> start time */
  const turnStarts = new Map()

  let currentProvider = null
  let head = null

  for (const event of events) {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      folded.unusableEvents += 1
      continue
    }
    const type = typeof event.type === 'string' ? event.type : ''
    const time = finiteOrNull(event.time)

    if (time !== null) {
      if (folded.firstAt === null || time < folded.firstAt) folded.firstAt = time
      if (folded.lastAt === null || time > folded.lastAt) folded.lastAt = time
      activeDays.add(localDay(time))
    }

    const data = isObject(event.data) ? event.data : undefined

    switch (type) {
      case 'session': {
        if (head === null) head = event
        break
      }
      case 'request/context': {
        const provider = asText(data?.provider)
        if (provider !== null) {
          currentProvider = provider
          providersSeen.add(provider)
        }
        break
      }
      case 'request/header': {
        const config = data?.header?.config ?? data?.config
        const provider = asText(config?.provider)
        if (provider !== null) {
          currentProvider = provider
          providersSeen.add(provider)
        }
        break
      }
      case 'session/title': {
        // Older/newer builds differ: `data.title` in this build, `data.val` in
        // the projection rows. Accept both; the last title wins because the
        // fallback title is written first and the model-made title later.
        const title = asText(data?.title) ?? asText(data?.val)
        if (title !== null) folded.title = title
        break
      }
      case 'user/message': {
        // `data.role` is 'user' (or absent in older logs) for a real user turn.
        const role = asText(data?.role)
        if (role === null || role === 'user') {
          folded.messages += 1
          folded.userMessages += 1
        }
        break
      }
      case 'assistant/message': {
        folded.messages += 1
        folded.assistantMessages += 1
        const sourceProvider = asText(data?.message?.source?.provider)
        const provider = currentProvider ?? sourceProvider ?? unknownProvider
        providersSeen.add(provider)

        const usage = isObject(data?.usage) ? data.usage : undefined
        if (usage !== undefined) {
          // Only the four buckets; `totalTokens` is deliberately ignored.
          const input = countOf(usage.inputTokens)
          const output = countOf(usage.outputTokens)
          const cacheRead = countOf(usage.cacheReadTokens)
          const cacheWrite = countOf(usage.cacheWriteTokens)
          const sum = input + output + cacheRead + cacheWrite

          folded.usage.input += input
          folded.usage.output += output
          folded.usage.cacheRead += cacheRead
          folded.usage.cacheWrite += cacheWrite
          folded.total += sum
          providerTotals.set(provider, (providerTotals.get(provider) ?? 0) + sum)

          if (time !== null && sum > 0) {
            const day = localDay(time)
            const hour = localHour(time)
            dayTotals.set(day, (dayTotals.get(day) ?? 0) + sum)

            let byProvider = dayProviders.get(day)
            if (byProvider === undefined) {
              byProvider = new Map()
              dayProviders.set(day, byProvider)
            }
            byProvider.set(provider, (byProvider.get(provider) ?? 0) + sum)

            let dayHours = hoursByDay.get(day)
            if (dayHours === undefined) {
              dayHours = new Map()
              hoursByDay.set(day, dayHours)
            }
            let buckets = dayHours.get(provider)
            if (buckets === undefined) {
              buckets = new Array(24).fill(0)
              dayHours.set(provider, buckets)
            }
            buckets[hour] += sum
          }
        }
        break
      }
      case 'turn/start': {
        folded.turns += 1
        const key = turnKey(data?.turn)
        if (key !== null && time !== null) turnStarts.set(key, time)
        break
      }
      case 'turn/end': {
        const key = turnKey(data?.turn)
        if (key === null) break
        const startedAt = turnStarts.get(key)
        if (startedAt === undefined || time === null) break
        const duration = time - startedAt
        if (duration > 0 && duration > folded.longestTurnMs) folded.longestTurnMs = duration
        turnStarts.delete(key)
        break
      }
      default:
        break
    }
  }

  if (head !== null) {
    folded.hasHead = true
    folded.id = asText(head.id)
    folded.version = finiteOrNull(head.version)
    folded.createdAt = finiteOrNull(head.createdAt)
    folded.cwd = asText(head.cwd)
    folded.delegationDepth = countOf(head.delegationDepth)
    folded.parentSession = asText(head.parentSession)
    folded.origin = asText(head.origin)
  }
  // A few log builds omit `createdAt` on the head; the first event is then the
  // best available creation evidence (only used for display, never for days).
  if (folded.createdAt === null && folded.firstAt !== null) folded.createdAt = folded.firstAt

  folded.providerTotals = mapToObject(providerTotals)
  folded.providersSeen = [...providersSeen]
  folded.byDay = mapToObject(dayTotals)
  folded.dayProviders = /** @type {Record<string, Record<string, number>>} */ (
    nestedMapToObject(dayProviders)
  )
  folded.hoursByDay = /** @type {Record<string, Record<string, number[]>>} */ (nestedMapToObject(hoursByDay))
  folded.activeDays = [...activeDays].sort()
  return folded
}

/**
 * Fold JSONL text in one step (used by tests and by callers that already have
 * the decoded log).
 * @param {string} text
 * @param {{ unknownProvider?: string }} [options]
 * @returns {FoldedSession}
 */
export function foldSessionText(text, options = {}) {
  const { events, malformed } = parseEventLines(text)
  const folded = foldSession(events, options)
  folded.malformedLines = malformed
  return folded
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @returns {string | null} */
function asText(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** @param {unknown} value @returns {number | null} */
function finiteOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** @param {unknown} value @returns {number} */
function countOf(value) {
  const parsed = finiteOrNull(value)
  return parsed === null || parsed < 0 ? 0 : parsed
}

/** @param {unknown} value @returns {string | null} */
function turnKey(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return null
}

/**
 * @param {Map<string, number>} map
 * @returns {Record<string, number>}
 */
function mapToObject(map) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const [key, value] of map) {
    if (value > 0) out[key] = value
  }
  return out
}

/**
 * @param {Map<string, Map<string, any>>} map
 * @returns {Record<string, Record<string, any>>}
 */
function nestedMapToObject(map) {
  /** @type {Record<string, Record<string, any>>} */
  const out = {}
  for (const [outerKey, inner] of map) {
    /** @type {Record<string, any>} */
    const innerOut = {}
    for (const [innerKey, value] of inner) {
      if (Array.isArray(value)) {
        if (value.some((entry) => entry > 0)) innerOut[innerKey] = value
      } else if (value > 0) {
        innerOut[innerKey] = value
      }
    }
    if (Object.keys(innerOut).length > 0) out[outerKey] = innerOut
  }
  return out
}
