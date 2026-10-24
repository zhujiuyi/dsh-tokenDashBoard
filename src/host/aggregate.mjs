/**
 * Aggregation: folded sessions + workspace state → the Snapshot contract
 * (SPEC §3).
 *
 * Rules encoded here:
 *
 *  - **Local calendar days.** A usage figure is placed on the local day (and
 *    local hour) of the `assistant/message` event that produced it. `days` is
 *    sparse: only days with consumption *or* session activity appear, so the
 *    client can fill the gaps for its heatmap.
 *  - **Subagents belong to their parent.** A session whose head says
 *    `delegationDepth > 0` or carries a `parentSession` is folded into its
 *    top-level ancestor: totals, per-day/per-provider maps, message count, turn
 *    count and longest turn all add up, and `subagentCount` counts the merged
 *    children. When the parent's log is gone the subagent stays a row of its own
 *    with `orphan: true`, so its tokens never vanish.
 *  - **Status** is `archived` when workspace.json lists the id as archived,
 *    `active` when a workspace still lists it, `deleted` otherwise (neither
 *    place knows it — the log still exists, so it is still counted).
 *  - **Providers** are the union of configured routes and routes seen in logs,
 *    sorted by total; a configured route with no usage keeps a zero row.
 */

import { addDays, localDay, timeZoneOf } from './time.mjs'
import { mergeProviders, normalizeConfiguredProviders } from './providers.mjs'
import { normalizeSessionId } from './workspace.mjs'

/** Fallback title (Host-side Chinese default; the client re-localizes it). */
export const UNTITLED_SESSION_TITLE = '未命名会话'

/** Snapshot contract version. */
export const SNAPSHOT_VERSION = 1

/**
 * @typedef {import('./events.mjs').FoldedSession} FoldedSession
 * @typedef {import('./workspace.mjs').WorkspaceState} WorkspaceState
 */

/**
 * Build the snapshot payload.
 * @param {object} options
 * @param {FoldedSession[]} options.sessions       folded sessions (subagents included)
 * @param {WorkspaceState} [options.workspace]     workspace.json projection
 * @param {unknown} [options.configuredProviders]  array or () => array of { id, name }
 * @param {Map<string, string | null>} [options.titles]  projcache title fallback by id
 * @param {number} [options.now]                   epoch ms; defaults to Date.now()
 * @param {string[]} [options.warnings]            file-level problems collected by the caller
 * @returns {object} Snapshot
 */
export function buildSnapshot(options = {}) {
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const today = localDay(now)
  const warnings = []
  for (const warning of Array.isArray(options.warnings) ? options.warnings : []) {
    if (typeof warning === 'string' && warning !== '') warnings.push(warning)
  }
  const workspace = isObject(options.workspace) ? options.workspace : emptyWorkspaceState()
  const titles = options.titles instanceof Map ? options.titles : new Map()
  const configured = normalizeConfiguredProviders(options.configuredProviders)

  /** @type {Map<string, FoldedSession>} canonical id -> folded session */
  const byId = new Map()
  for (const session of Array.isArray(options.sessions) ? options.sessions : []) {
    if (!isObject(session)) continue
    const id = normalizeSessionId(session.id)
    if (id === null) {
      warnings.push('a session log has no usable session id and was skipped')
      continue
    }
    if (byId.has(id)) {
      warnings.push(`duplicate session id ${id} was ignored`)
      continue
    }
    byId.set(id, session)
  }

  // ── Resolve each session's top-level ancestor ────────────────────────────
  /** @type {Map<string, { rootId: string, isOrphan: boolean }>} */
  const resolved = new Map()
  for (const id of [...byId.keys()].sort()) {
    resolved.set(id, resolveRoot(id, byId, warnings))
  }

  /** @type {Map<string, { rootId: string, root: FoldedSession, members: FoldedSession[], isOrphan: boolean }>} */
  const groups = new Map()
  for (const id of [...byId.keys()].sort()) {
    const { rootId, isOrphan } = resolved.get(id)
    const session = byId.get(id)
    let group = groups.get(rootId)
    if (group === undefined) {
      group = { rootId, root: byId.get(rootId), members: [], isOrphan: false }
      groups.set(rootId, group)
    }
    group.members.push(session)
    if (rootId === id) group.isOrphan = isOrphan
  }

  // ── Fold every group into one session row ────────────────────────────────
  /** @type {any[]} */
  const sessionRows = []
  for (const group of groups.values()) {
    sessionRows.push(buildSessionRow(group, workspace, titles))
  }
  sessionRows.sort((left, right) => right.total - left.total || compareText(left.id, right.id))
  // Internal per-day/hour detail stays inside the builder; the contract rows
  // below carry exactly the fields SPEC §3 defines.
  //
  // Sessions that never spent a token (a prompt opened and abandoned, an empty
  // session directory) are pure noise in the list and would make the footer's
  // "N sessions" disagree with the visible rows, so only `total > 0` rows are
  // published. Days still keep their session *activity*, so a day on which a
  // session was opened but nothing was spent stays on the heatmap.
  /** @type {any[]} */
  const publicSessions = sessionRows.filter((row) => row.total > 0).map(toPublicSessionRow)

  // ── Days ─────────────────────────────────────────────────────────────────
  /** @type {Map<string, number>} */
  const dayTotals = new Map()
  /** @type {Map<string, Map<string, number>>} */
  const dayProviders = new Map()
  /** @type {Map<string, Map<string, number>>} */
  const daySessions = new Map()
  /** @type {Set<string>} */
  const activeDays = new Set()
  /** @type {Map<string, Map<string, number>>} */
  const providerDayTotals = new Map()
  /** @type {Map<string, number>} */
  const providerTotals = new Map()
  /** @type {Map<string, number>} provider -> decode milliseconds, merged across sessions */
  const providerDecodeMs = new Map()
  /** @type {Map<string, number>} provider -> output tokens of timed messages */
  const providerOutputTokens = new Map()
  /** @type {Map<string, Set<string>>} */
  const providerSessions = new Map()
  /** @type {Set<string>} */
  const seenProviderIds = new Set()
  /** @type {Map<string, number[]>} */
  const todayHours = new Map()

  for (const row of sessionRows) {
    for (const day of row.activeDays) activeDays.add(day)
    for (const [day, tokens] of Object.entries(row.byDay)) {
      dayTotals.set(day, (dayTotals.get(day) ?? 0) + tokens)
      let perSession = daySessions.get(day)
      if (perSession === undefined) {
        perSession = new Map()
        daySessions.set(day, perSession)
      }
      perSession.set(row.id, (perSession.get(row.id) ?? 0) + tokens)
    }
    for (const [day, perProvider] of Object.entries(row.dayProviders)) {
      let target = dayProviders.get(day)
      if (target === undefined) {
        target = new Map()
        dayProviders.set(day, target)
      }
      for (const [providerId, tokens] of Object.entries(perProvider)) {
        if (!(tokens > 0)) continue
        target.set(providerId, (target.get(providerId) ?? 0) + tokens)
        let providerDays = providerDayTotals.get(providerId)
        if (providerDays === undefined) {
          providerDays = new Map()
          providerDayTotals.set(providerId, providerDays)
        }
        providerDays.set(day, (providerDays.get(day) ?? 0) + tokens)
      }
    }
    for (const providerId of row.providers) {
      seenProviderIds.add(providerId)
      let sessionsOfProvider = providerSessions.get(providerId)
      if (sessionsOfProvider === undefined) {
        sessionsOfProvider = new Set()
        providerSessions.set(providerId, sessionsOfProvider)
      }
      sessionsOfProvider.add(row.id)
    }
    // Totals come from the folded per-provider buckets, not from the day map:
    // a usage figure without a timestamp still counts towards its provider.
    for (const [providerId, tokens] of Object.entries(row.byProvider)) {
      providerTotals.set(providerId, (providerTotals.get(providerId) ?? 0) + numberOr0(tokens))
    }
    for (const [providerId, ms] of Object.entries(row.providerDecodeMs ?? {})) {
      providerDecodeMs.set(providerId, (providerDecodeMs.get(providerId) ?? 0) + numberOr0(ms))
    }
    for (const [providerId, tokens] of Object.entries(row.providerOutputTokens ?? {})) {
      providerOutputTokens.set(providerId, (providerOutputTokens.get(providerId) ?? 0) + numberOr0(tokens))
    }
    // A provider can be routed to without ever producing a usage figure (a
    // failed request, a fallback that was retried elsewhere). It still appeared
    // in the logs, so it belongs to the provider list — with a zero total.
    for (const providerId of row.providersSeen ?? []) seenProviderIds.add(providerId)
    const hours = row.hoursByDay[today]
    if (isObject(hours)) {
      for (const [providerId, buckets] of Object.entries(hours)) {
        let target = todayHours.get(providerId)
        if (target === undefined) {
          target = new Array(24).fill(0)
          todayHours.set(providerId, target)
        }
        for (let hour = 0; hour < 24; hour += 1) target[hour] += buckets[hour] ?? 0
      }
    }
  }

  const allDays = [...new Set([...activeDays, ...dayTotals.keys()])].sort()
  /** @type {any[]} */
  const days = allDays.map((day) => ({
    day,
    total: dayTotals.get(day) ?? 0,
    providers: mapToObject(dayProviders.get(day)),
    sessions: mapToObject(daySessions.get(day)),
  }))

  const spentDays = allDays.filter((day) => (dayTotals.get(day) ?? 0) > 0)
  const firstDay = spentDays.length > 0 ? spentDays[0] : null
  const lastDay = spentDays.length > 0 ? spentDays[spentDays.length - 1] : null

  // ── Providers ────────────────────────────────────────────────────────────
  const identities = mergeProviders(configured, [...seenProviderIds])
  // A provider that was attributed to messages carrying no usage figures (or
  // configured but never used) is still part of the identity union, total 0.
  const providerRows = [...identities.values()].map((identity) => {
    const dayMap = providerDayTotals.get(identity.id)
    const daysOfProvider = dayMap === undefined ? [] : [...dayMap.keys()].sort()
    let peak = null
    if (dayMap !== undefined) {
      for (const [day, tokens] of dayMap) {
        if (peak === null || tokens > peak.tokens || (tokens === peak.tokens && day < peak.day)) {
          peak = { day, tokens }
        }
      }
    }
    return {
      id: identity.id,
      name: identity.name,
      configured: identity.configured,
      seenInLogs: identity.seenInLogs,
      total: providerTotals.get(identity.id) ?? 0,
      firstDay: daysOfProvider.length > 0 ? daysOfProvider[0] : null,
      lastDay: daysOfProvider.length > 0 ? daysOfProvider[daysOfProvider.length - 1] : null,
      peak,
      sessionCount: providerSessions.get(identity.id)?.size ?? 0,
      // Average streaming speed, same definition as the transcript's
      // tokens/second: output tokens over the span from each step's first
      // request to its assembled message. null when nothing was timed.
      decodeMs: providerDecodeMs.get(identity.id) ?? 0,
      outputTokens: providerOutputTokens.get(identity.id) ?? 0,
      tokensPerSecond: speedOf(providerOutputTokens.get(identity.id) ?? 0, providerDecodeMs.get(identity.id) ?? 0),
    }
  })
  providerRows.sort((left, right) => right.total - left.total || compareText(left.id, right.id))

  // ── Stats ────────────────────────────────────────────────────────────────
  let total = 0
  for (const row of sessionRows) total += row.total
  let longestTurnMs = 0
  for (const row of sessionRows) longestTurnMs = Math.max(longestTurnMs, row.longestTurnMs)

  let peakDay = null
  for (const row of days) {
    if (row.total <= 0) continue
    if (peakDay === null || row.total > peakDay.tokens || (row.total === peakDay.tokens && row.day < peakDay.day)) {
      peakDay = { day: row.day, tokens: row.total }
    }
  }

  // "Active day" means a day that actually consumed tokens — opening a session
  // without sending a prompt is session activity, not usage, and the overview
  // strips / heatmap legend count consumption only. `days` still lists
  // activity-only days for the heatmap, but the streak and active-day numbers
  // below are computed over `spentDays`.
  const spentDaySet = new Set(spentDays)
  const stats = {
    total,
    peakDay,
    longestTurnMs,
    activeDays: spentDays.length,
    longestStreak: longestStreak(spentDaySet),
    currentStreak: currentStreak(spentDaySet, today),
    last30: sumLastDays(dayTotals, today, 30),
  }

  // Every provider gets 24 buckets so the client's "today" chart never has to
  // guess whether a missing key means "no data" or "not configured".
  /** @type {Record<string, number[]>} */
  const todayHoursObject = {}
  for (const row of providerRows) {
    const buckets = todayHours.get(row.id)
    todayHoursObject[row.id] = buckets === undefined ? new Array(24).fill(0) : buckets.map((value) => value)
  }

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: now,
    timeZone: timeZoneOf(),
    today,
    firstDay,
    lastDay,
    days,
    providers: providerRows,
    sessions: publicSessions,
    todayHours: todayHoursObject,
    stats,
    warnings,
  }
}

/**
 * Merge one top-level session with all of its subagents.
 * @param {{ rootId: string, root: FoldedSession, members: FoldedSession[], isOrphan: boolean }} group
 * @param {WorkspaceState} workspace
 * @param {Map<string, string | null>} titles
 */
function buildSessionRow(group, workspace, titles) {
  const { root, rootId } = group
  const members = group.members

  let total = 0
  let messages = 0
  let turns = 0
  let longestTurnMs = 0
  let firstAt = null
  let lastAt = null
  /** @type {Record<string, number>} */
  const byDay = {}
  /** @type {Record<string, number>} */
  const byProvider = {}
  /** @type {Record<string, Record<string, number>>} */
  const dayProviders = {}
  /** @type {Record<string, Record<string, number[]>>} */
  const hoursByDay = {}
  /** @type {Set<string>} */
  const activeDays = new Set()
  /** @type {Set<string>} every provider id this row saw, usage or not */
  const providersSeen = new Set()
  /** @type {Record<string, number>} provider -> decode milliseconds */
  const decodeMsByProvider = {}
  /** @type {Record<string, number>} provider -> timed output tokens */
  const outputTokensByProvider = {}

  for (const member of members) {
    total += numberOr0(member.total)
    messages += numberOr0(member.messages)
    turns += numberOr0(member.turns)
    longestTurnMs = Math.max(longestTurnMs, numberOr0(member.longestTurnMs))
    for (const providerId of member.providersSeen ?? []) {
      if (typeof providerId === 'string' && providerId !== '') providersSeen.add(providerId)
    }
    for (const [providerId, ms] of Object.entries(member.providerDecodeMs ?? {})) {
      decodeMsByProvider[providerId] = (decodeMsByProvider[providerId] ?? 0) + numberOr0(ms)
    }
    for (const [providerId, tokens] of Object.entries(member.providerOutputTokens ?? {})) {
      outputTokensByProvider[providerId] = (outputTokensByProvider[providerId] ?? 0) + numberOr0(tokens)
    }
    if (member.firstAt !== null && member.firstAt !== undefined) {
      firstAt = firstAt === null ? member.firstAt : Math.min(firstAt, member.firstAt)
    }
    if (member.lastAt !== null && member.lastAt !== undefined) {
      lastAt = lastAt === null ? member.lastAt : Math.max(lastAt, member.lastAt)
    }
    for (const [day, tokens] of Object.entries(member.byDay ?? {})) {
      byDay[day] = (byDay[day] ?? 0) + numberOr0(tokens)
    }
    for (const [providerId, tokens] of Object.entries(member.providerTotals ?? {})) {
      byProvider[providerId] = (byProvider[providerId] ?? 0) + numberOr0(tokens)
    }
    for (const [day, perProvider] of Object.entries(member.dayProviders ?? {})) {
      const target = dayProviders[day] ?? (dayProviders[day] = {})
      for (const [providerId, tokens] of Object.entries(perProvider)) {
        target[providerId] = (target[providerId] ?? 0) + numberOr0(tokens)
      }
    }
    for (const [day, perProvider] of Object.entries(member.hoursByDay ?? {})) {
      const target = hoursByDay[day] ?? (hoursByDay[day] = {})
      for (const [providerId, buckets] of Object.entries(perProvider)) {
        const existing = target[providerId]
        if (existing === undefined) {
          target[providerId] = Array.from({ length: 24 }, (_, hour) => numberOr0(buckets[hour]))
        } else {
          for (let hour = 0; hour < 24; hour += 1) existing[hour] += numberOr0(buckets[hour])
        }
      }
    }
    for (const day of member.activeDays ?? []) {
      if (typeof day === 'string' && day !== '') activeDays.add(day)
    }
  }

  // `byDay`/`byProvider` are contract-wise sparse: only days/providers with tokens.
  /** @type {Record<string, number>} */
  const sparseByDay = {}
  for (const [day, tokens] of Object.entries(byDay)) if (tokens > 0) sparseByDay[day] = tokens
  /** @type {Record<string, number>} */
  const sparseByProvider = {}
  for (const [providerId, tokens] of Object.entries(byProvider)) if (tokens > 0) sparseByProvider[providerId] = tokens

  const providers = Object.keys(sparseByProvider).sort(
    (left, right) => sparseByProvider[right] - sparseByProvider[left] || compareText(left, right),
  )
  const dominantProvider = providers.length > 0 ? providers[0] : null

  const workspaceInfo = workspace.sessions instanceof Map ? workspace.sessions.get(rootId) : undefined
  const archived = workspace.archived instanceof Set ? workspace.archived.has(rootId) : false
  /** @type {'active' | 'archived' | 'deleted'} */
  const status = archived ? 'archived' : workspaceInfo !== undefined ? 'active' : 'deleted'

  const fallbackTitle = titles.get(rootId)
  const title =
    textOf(root.title) ?? textOf(fallbackTitle) ?? UNTITLED_SESSION_TITLE

  /** @type {Record<string, Record<string, number>>} */
  const sparseDayProviders = {}
  for (const [day, perProvider] of Object.entries(dayProviders)) {
    /** @type {Record<string, number>} */
    const filtered = {}
    for (const [providerId, tokens] of Object.entries(perProvider)) if (tokens > 0) filtered[providerId] = tokens
    if (Object.keys(filtered).length > 0) sparseDayProviders[day] = filtered
  }

  return {
    id: rootId,
    title,
    workspacePath: textOf(workspaceInfo?.workspacePath) ?? null,
    workspaceTitle: textOf(workspaceInfo?.workspaceTitle) ?? null,
    status,
    provider: dominantProvider,
    providers,
    messages,
    turns,
    subagentCount: Math.max(0, members.length - 1),
    orphan: group.isOrphan === true,
    firstAt: firstAt === null ? null : firstAt,
    lastAt: lastAt === null ? null : lastAt,
    total,
    longestTurnMs,
    byDay: sparseByDay,
    byProvider: sparseByProvider,
    // Internal, stripped before the snapshot leaves `buildSnapshot`:
    providerDecodeMs: decodeMsByProvider,
    providerOutputTokens: outputTokensByProvider,
    dayProviders: sparseDayProviders,
    hoursByDay,
    activeDays: [...activeDays].sort(),
    providersSeen: [...providersSeen].sort(),
  }
}

/**
 * Project an internal row onto the `SessionRow` contract (SPEC §3) so the
 * snapshot never leaks aggregation-only fields.
 * @param {any} row
 * @returns {object}
 */
function toPublicSessionRow(row) {
  return {
    id: row.id,
    title: row.title,
    workspacePath: row.workspacePath,
    workspaceTitle: row.workspaceTitle,
    status: row.status,
    provider: row.provider,
    providers: row.providers,
    messages: row.messages,
    turns: row.turns,
    subagentCount: row.subagentCount,
    orphan: row.orphan,
    firstAt: row.firstAt,
    lastAt: row.lastAt,
    total: row.total,
    longestTurnMs: row.longestTurnMs,
    byDay: row.byDay,
    byProvider: row.byProvider,
  }
}

/**
 * Walk the `parentSession` chain to the top-level session.
 *
 * Chains can leave the set of known logs in more than one way:
 *   - the direct parent is missing → this session is an orphan row;
 *   - a multi-level chain `C → B → A` where `A` is missing keeps `B` as the
 *     row root (it is the first known child of the missing ancestor) and marks
 *     that row `orphan: true`; `C` is merged into `B` as usual.
 * A cycle cannot be ordered, so every participant is kept as its own row (never
 * merged twice) and a warning records it.
 * @param {string} id
 * @param {Map<string, FoldedSession>} byId
 * @param {string[]} warnings
 * @returns {{ rootId: string, isOrphan: boolean }}
 */
function resolveRoot(id, byId, warnings) {
  /** @type {string[]} every known session walked, from this one upwards */
  const chain = []
  /** @type {Set<string>} */
  const seen = new Set()
  let current = id
  for (;;) {
    if (seen.has(current)) {
      warnings.push(`session ${id} is part of a parent-session cycle; kept as its own row`)
      return { rootId: id, isOrphan: false }
    }
    seen.add(current)

    const session = byId.get(current)
    if (session === undefined) {
      // `current` is a missing ancestor: the first known session below it owns
      // the row, and it is an orphan because its own parent log is gone.
      const known = chain.length > 0 ? chain[chain.length - 1] : id
      return { rootId: known, isOrphan: true }
    }

    const parentSession = normalizeSessionId(session.parentSession)
    const isChild = numberOr0(session.delegationDepth) > 0 || parentSession !== null
    if (!isChild || parentSession === null) return { rootId: current, isOrphan: false }

    chain.push(current)
    if (!byId.has(parentSession)) {
      // Missing parent: this session is the first known child of it → row root.
      return { rootId: current, isOrphan: true }
    }
    current = parentSession
  }
}

/**
 * Longest run of consecutive active days.
 * @param {Set<string>} daySet
 * @returns {number}
 */
function longestStreak(daySet) {
  if (daySet.size === 0) return 0
  let best = 0
  for (const day of daySet) {
    const previous = addDays(day, -1)
    if (daySet.has(previous)) continue // not the start of a run
    let length = 1
    let cursor = day
    while (daySet.has(addDays(cursor, 1))) {
      cursor = addDays(cursor, 1)
      length += 1
    }
    best = Math.max(best, length)
  }
  return best
}

/**
 * Current run of consecutive active days.
 *
 * "Current" means the run that is still live today. When today has no activity
 * yet — the common state right after local midnight, before the first prompt —
 * yesterday anchors the streak, so a long streak does not flicker to 0 at
 * 00:00 and back to its real length minutes later. If neither today nor
 * yesterday has activity, the current streak is 0.
 * @param {Set<string>} daySet
 * @param {string} today local day key
 * @returns {number}
 */
function currentStreak(daySet, today) {
  let anchor = null
  if (daySet.has(today)) anchor = today
  else if (daySet.has(addDays(today, -1))) anchor = addDays(today, -1)
  if (anchor === null) return 0
  let length = 0
  let cursor = anchor
  while (daySet.has(cursor)) {
    length += 1
    cursor = addDays(cursor, -1)
  }
  return length
}

/**
 * Sum of the last `count` days ending today (inclusive).
 * @param {Map<string, number>} dayTotals
 * @param {string} today
 * @param {number} count
 * @returns {number}
 */
function sumLastDays(dayTotals, today, count) {
  let total = 0
  let cursor = today
  for (let index = 0; index < count; index += 1) {
    total += dayTotals.get(cursor) ?? 0
    cursor = addDays(cursor, -1)
  }
  return total
}

/**
 * @param {Map<string, number> | undefined} map
 * @returns {Record<string, number>}
 */
function mapToObject(map) {
  /** @type {Record<string, number>} */
  const out = {}
  if (map === undefined) return out
  for (const [key, value] of map) if (value > 0) out[key] = value
  return out
}

/** @returns {WorkspaceState} */
function emptyWorkspaceState() {
  return { ok: false, archived: new Set(), sessions: new Map(), warnings: [], signature: null }
}

/** Tokens per second from a token count and a duration, or null when unusable. */
function speedOf(tokens, ms) {
  const count = numberOr0(tokens)
  const duration = numberOr0(ms)
  if (!(count > 0) || !(duration > 0)) return null
  return Math.round((count / (duration / 1000)) * 10) / 10
}

/** @param {unknown} value @returns {boolean} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @returns {number} */
function numberOr0(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** @param {unknown} value @returns {string | null} */
function textOf(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** @param {string} left @param {string} right @returns {number} */
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
