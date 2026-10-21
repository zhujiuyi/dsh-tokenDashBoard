/**
 * The dashboard service: session logs → Snapshot.
 *
 * `index.js` (the Cordis plugin) owns the HTTP route and injects the profile's
 * configured providers; everything else lives here. The service is a plain
 * Node module with no Cordis dependency, so tests can drive it against a
 * temporary Harness home.
 *
 * Caching is in two layers, because a cold scan decompresses and parses ~144 MB
 * of JSONL while a warm request should be free:
 *
 *   1. **Per-file.** Each session log is parsed once per `mtimeMs:size`
 *      signature. Appending to one session therefore re-parses exactly one
 *      file, and a snapshot that only re-reads stats stays fast. Entries for
 *      deleted session directories are dropped on every build.
 *   2. **Whole snapshot.** The finished payload is reused for `ttlMs`
 *      (default 15 s) and a manual refresh calls `invalidate()`.
 *
 * Concurrent requests share one in-flight build, and a single bad log never
 * fails the snapshot: it is skipped and its reason is appended to `warnings`.
 */

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { SNAPSHOT_VERSION, buildSnapshot } from './aggregate.mjs'
import { foldSession, parseEventLines } from './events.mjs'
import { readProjectionTitle, readWorkspaceState, signatureOf, normalizeSessionId } from './workspace.mjs'
import { readSessionLog } from './zstd.mjs'

export { SNAPSHOT_VERSION }

/** Default snapshot reuse window (SPEC §4). */
export const DEFAULT_TTL_MS = 15000

/** Bound on how many warnings travel to the browser (the rest are counted). */
const MAX_WARNINGS = 40

/** `session.v<version>.jsonl` / `session.v<version>.jsonl.zstd` */
const LOG_PATTERN = /^session\.v(\d+)\.jsonl(\.zstd)?$/

/**
 * @typedef {object} DashboardServiceOptions
 * @property {string} [homeDir]                        Harness home, e.g. `~/.dsh`
 * @property {(() => Array<{ id: string, name: string }>) | Array<{ id: string, name: string }>} [configuredProviders]
 * @property {(() => number) | number} [now]           clock injection for tests
 * @property {number} [ttlMs]                          snapshot reuse window
 * @property {{ warn?: (message: string) => void }} [logger]
 * @property {(sessionId: string) => void} [onSessionParsed]  diagnostic seam: fires only
 *   when a log is actually parsed (never on a stat-cache hit); used by tests to prove
 *   incremental parsing. Never throws into the build.
 */

/**
 * Create the snapshot service.
 * @param {DashboardServiceOptions} [options]
 * @returns {{ snapshot: () => Promise<object>, invalidate: () => void }}
 */
export function createDashboardService(options = {}) {
  const homeDir = resolveHome(options.homeDir)
  const ttlMs =
    typeof options.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs >= 0
      ? options.ttlMs
      : DEFAULT_TTL_MS
  const configuredProviders = options.configuredProviders
  const logger = options.logger
  const onSessionParsed = typeof options.onSessionParsed === 'function' ? options.onSessionParsed : null

  /** @param {string} message */
  const warn = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      // A logging failure must never break a snapshot.
    }
  }

  /** @type {Map<string, ParsedSession>} */
  let parsedCache = new Map()
  /** @type {{ signature: string | null, state: import('./workspace.mjs').WorkspaceState } | null} */
  let workspaceCache = null
  /** @type {object | null} */
  let cachedSnapshot = null
  let cachedAt = 0
  /** @type {Promise<object> | null} */
  let inflight = null

  /**
   * Current time in epoch ms, honouring an injected clock.
   * @returns {number}
   */
  function nowMs() {
    const source = options.now
    const value = typeof source === 'function' ? source() : typeof source === 'number' ? source : Date.now()
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
  }

  /**
   * Build (or reuse) the snapshot. Never rejects: an internal failure is
   * reported as a warning in an otherwise valid, empty payload.
   * @returns {Promise<object>}
   */
  async function snapshot() {
    const startedAt = nowMs()
    if (cachedSnapshot !== null && ttlMs > 0 && startedAt - cachedAt < ttlMs) return cachedSnapshot
    if (inflight !== null) return inflight

    // Build through a shared promise so overlapping requests do one scan. The
    // promise is cleared by the *caller* side (below), never inside the build
    // body: clearing it from a `finally` inside the async function would run
    // before `inflight` is assigned and leave a stale resolved promise behind.
    const buildPromise = (async () => {
      try {
        return build()
      } catch (error) {
        const reason = `snapshot build failed: ${messageOf(error)}`
        warn(`[token-dashboard] ${reason}`)
        return buildSnapshot({ now: nowMs(), warnings: [reason] })
      }
    })()
    inflight = buildPromise

    try {
      const result = await buildPromise
      cachedSnapshot = result
      cachedAt = nowMs()
      return result
    } finally {
      if (inflight === buildPromise) inflight = null
    }
  }

  /** Drop the memoised snapshot (a manual refresh wants fresh logs). */
  function invalidate() {
    cachedSnapshot = null
    cachedAt = 0
  }

  /**
   * Full build: discover, parse changed logs, read state, aggregate.
   * @returns {object} Snapshot
   */
  function build() {
    const buildTime = nowMs()
    /** @type {string[]} */
    const warnings = []

    const discovered = discoverSessionLogs(homeDir)
    for (const warning of discovered.warnings) warn(`[token-dashboard] ${warning}`)
    for (const warning of discovered.warnings) warnings.push(warning)

    /** @type {Map<string, ParsedSession>} */
    const nextCache = new Map()
    /** @type {any[]} */
    const sessions = []

    for (const entry of discovered.entries) {
      const cached = parsedCache.get(entry.id)
      let parsed
      if (cached !== undefined && cached.signature === entry.signature) {
        parsed = cached
      } else {
        try {
          parsed = parseSessionLog(entry, warnings, warn)
        } catch (error) {
          const warning = `session ${entry.id}: parse failed: ${messageOf(error)}`
          warn(`[token-dashboard] ${warning}`)
          warnings.push(warning)
          parsed = null
        }
        if (parsed === null) continue
        if (onSessionParsed !== null) {
          try {
            onSessionParsed(entry.id)
          } catch {
            // A diagnostic hook must never break a snapshot.
          }
        }
      }
      nextCache.set(entry.id, parsed)
      // The log head's id and the directory name are the same bare uuid; the
      // directory name wins because that is what `parentSession` refers to.
      sessions.push({ ...parsed.folded, id: entry.id })
    }
    parsedCache = nextCache

    const workspace = readWorkspaceCached(homeDir, warnings, warn)

    /** @type {Map<string, string | null>} */
    const titles = new Map()
    for (const entry of discovered.entries) {
      const parsed = parsedCache.get(entry.id)
      if (parsed === undefined || isNonEmptyText(parsed.folded.title)) continue
      // A log without a title event may still have one in the projection cache.
      const fallback = readProjectionTitle(homeDir, entry.id)
      if (isNonEmptyText(fallback.title)) titles.set(entry.id, fallback.title)
    }

    const uniqueWarnings = [...new Set(warnings)]
    const snapshot = buildSnapshot({
      sessions,
      workspace: workspace.state,
      configuredProviders,
      titles,
      now: buildTime,
      warnings: uniqueWarnings.slice(0, MAX_WARNINGS),
    })
    if (uniqueWarnings.length > MAX_WARNINGS) {
      snapshot.warnings.push(`${uniqueWarnings.length - MAX_WARNINGS} more warning(s) were not shown`)
    }
    return snapshot
  }

  /**
   * Read workspace.json once per change signature.
   * @param {string} home
   * @param {string[]} warnings
   * @param {(message: string) => void} warnFn
   * @returns {{ signature: string | null, state: import('./workspace.mjs').WorkspaceState }}
   */
  function readWorkspaceCached(home, warnings, warnFn) {
    // The state reader is cheap (one small JSON file), but it also carries the
    // change signature, so re-read it and only log when that signature moved.
    const fresh = readWorkspaceState(home)
    const changed = workspaceCache === null || workspaceCache.signature !== fresh.signature
    if (changed) {
      workspaceCache = { signature: fresh.signature, state: fresh }
      for (const warning of fresh.warnings) warnFn(`[token-dashboard] ${warning}`)
    }
    for (const warning of workspaceCache.state.warnings ?? []) {
      if (!warnings.includes(warning)) warnings.push(warning)
    }
    return workspaceCache
  }

  return { snapshot, invalidate }
}

/**
 * @typedef {object} ParsedSession
 * @property {string} signature
 * @property {import('./events.mjs').FoldedSession} folded
 * @property {string} logPath
 */

/**
 * Parse one session log file. Returns null when the file contributed no
 * readable event; real read/decoding damage is appended to `warnings`, while an
 * unfinished tail frame (the log being appended right now) only goes to the
 * logger.
 * @param {{ id: string, logPath: string, signature: string }} entry
 * @param {string[]} warnings
 * @param {(message: string) => void} warnFn
 * @returns {ParsedSession | null}
 */
function parseSessionLog(entry, warnings, warnFn) {
  const decoded = readSessionLog(entry.logPath)

  // Expected during a write: a half-written tail frame. Log only, never a
  // user-visible warning — otherwise the page would flash one on every refresh
  // of an active session.
  for (const note of decoded.notes) {
    warnFn(`[token-dashboard] session ${entry.id}: ${note}`)
  }
  // Actual damage (corrupt frame, unreadable file) does reach the page.
  for (const error of decoded.errors) {
    const warning = `session ${entry.id}: ${error}`
    warnFn(`[token-dashboard] ${warning}`)
    warnings.push(warning)
  }

  // A half-written tail frame can also cut the final JSONL line in half. Drop
  // that fragment rather than reporting it as a malformed line.
  let text = decoded.text
  if (decoded.truncated && text !== '' && !text.endsWith('\n')) {
    const lastComplete = text.lastIndexOf('\n')
    text = lastComplete >= 0 ? text.slice(0, lastComplete + 1) : ''
  }

  const { events, malformed } = parseEventLines(text)
  if (malformed > 0) {
    const warning = `session ${entry.id}: ${malformed} malformed JSONL line(s) skipped`
    warnFn(`[token-dashboard] ${warning}`)
    warnings.push(warning)
  }

  if (events.length === 0) {
    // An empty log is a placeholder directory rather than a failure; only the
    // bytes we could not decode are worth a warning (already recorded above).
    return null
  }

  const folded = foldSession(events)
  folded.malformedLines = malformed
  return { signature: entry.signature, folded, logPath: entry.logPath }
}

/**
 * Find every session log under `<home>/sessions/<workspace>/<sessionId>/`.
 * Reads directories only — files are parsed lazily by the caller.
 * @param {string} homeDir
 * @returns {{ entries: Array<{ id: string, logPath: string, signature: string, workspace: string }>, warnings: string[] }}
 */
export function discoverSessionLogs(homeDir) {
  /** @type {Array<{ id: string, logPath: string, signature: string, workspace: string }>} */
  const entries = []
  /** @type {string[]} */
  const warnings = []
  const root = join(homeDir, 'sessions')

  let workspaceNames
  try {
    workspaceNames = readdirSync(root)
  } catch (error) {
    if (errorCodeOf(error) !== 'ENOENT') warnings.push(`cannot list sessions directory: ${messageOf(error)}`)
    return { entries, warnings }
  }

  for (const workspace of workspaceNames.sort()) {
    const workspaceDir = join(root, workspace)
    let sessionNames
    try {
      if (!statSync(workspaceDir).isDirectory()) continue
      sessionNames = readdirSync(workspaceDir)
    } catch (error) {
      if (errorCodeOf(error) !== 'ENOENT') warnings.push(`cannot list ${workspace}: ${messageOf(error)}`)
      continue
    }

    for (const name of sessionNames.sort()) {
      const sessionDir = join(workspaceDir, name)
      const id = normalizeSessionId(name) ?? name
      let files
      try {
        if (!statSync(sessionDir).isDirectory()) continue
        files = readdirSync(sessionDir)
      } catch (error) {
        if (errorCodeOf(error) !== 'ENOENT') warnings.push(`cannot list session ${id}: ${messageOf(error)}`)
        continue
      }

      // A directory may hold more than one log after a format migration; the
      // highest version wins, and `.zstd` wins a version tie.
      let best = null
      for (const file of files) {
        const match = LOG_PATTERN.exec(file)
        if (match === null) continue
        const version = Number(match[1])
        const compressed = match[2] === '.zstd'
        const candidate = { file, version, compressed }
        if (
          best === null ||
          version > best.version ||
          (version === best.version && compressed && !best.compressed)
        ) {
          best = candidate
        }
      }
      if (best === null) continue

      const logPath = join(sessionDir, best.file)
      try {
        const signature = signatureOf(statSync(logPath))
        entries.push({ id, logPath, signature, workspace })
      } catch (error) {
        if (errorCodeOf(error) !== 'ENOENT') warnings.push(`cannot stat session ${id}: ${messageOf(error)}`)
      }
    }
  }

  entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return { entries, warnings }
}

/**
 * Resolve the Harness home: explicit option, then `DSH_HOME`, then `~/.dsh`.
 * @param {unknown} value
 * @returns {string}
 */
function resolveHome(value) {
  if (typeof value === 'string' && value.trim() !== '') return resolve(expandHome(value.trim()))
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(expandHome(fromEnv.trim()))
  return join(homedir(), '.dsh')
}

/** @param {string} value @returns {string} */
function expandHome(value) {
  if (value === '~') return homedir()
  return value.replace(/^~(?=[/\\])/, homedir())
}

/** @param {unknown} value @returns {boolean} */
function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim() !== ''
}

/** @param {unknown} error @returns {string | undefined} */
function errorCodeOf(error) {
  return error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : undefined
}

/** @param {unknown} error @returns {string} */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
