/**
 * @zhujiuyi/dsh-token-dashboard — host half.
 *
 * A standard DSH plugin: named exports `name` / `apply`, no Config, no
 * dependencies. It owns exactly one job: derive Token consumption from the
 * Harness' own session logs and serve it to the browser half at
 * `GET /api/token-dashboard/snapshot`.
 *
 * Where the data comes from, and why the log rather than a counter:
 *   - the session log (`<DSH_HOME>/sessions/**`) is the durable record of every
 *     `assistant/message` usage figure, so it keeps working for archived and
 *     deleted sessions and survives a restart;
 *   - `storages/workspace.json` supplies archived/session-list state and
 *     `storages/session_projcache/**` supplies titles when a log has none.
 *
 * What this file deliberately does not do: it never writes to the profile,
 * never starts a subprocess, and never queries a provider. Every number is a
 * local file read, so the route stays cheap and offline.
 *
 * The route is registered inside the Connection's authentication fence (like
 * every other host route), so only an authenticated page of this host can read
 * it. In a headless profile there is no Connection and the plugin simply stays
 * inert.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { SNAPSHOT_VERSION, createDashboardService } from './src/host/index.mjs'

/** Package name; also the client module id and the Loader row's plugin name. */
export const name = '@zhujiuyi/dsh-token-dashboard'

/** The plugin runs without optional services; `connection` is injected locally. */
export const inject = []

/** Path the browser half reads. */
export const SNAPSHOT_PATH = '/api/token-dashboard/snapshot'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  /** Optional services; populated if this profile mounts them. */
  let llm = undefined
  let configEditor = undefined

  ctx.inject(['llm'], (scoped) => {
    llm = scoped.llm
  })
  ctx.inject(['configEditor'], (scoped) => {
    configEditor = scoped.configEditor
  })

  const service = createDashboardService({
    homeDir: resolveHome(),
    configuredProviders: () => configuredProviders(llm, configEditor),
    logger: { warn: (message) => warn(ctx, message) },
  })

  ctx.inject(['connection'], (scoped) => {
    const conn = scoped.connection
    if (conn === undefined || conn === null || conn.fetch === undefined) return
    try {
      scoped.effect(
        () => conn.fetch.register({
          path: SNAPSHOT_PATH,
          methods: ['GET'],
          requestBody: 'buffered',
          fetch: (request) => handleSnapshot(request),
        }),
        'token-dashboard: snapshot route',
      )
    } catch (error) {
      warn(ctx, `snapshot route registration skipped: ${messageOf(error)}`)
    }
  })

  /**
   * Answer one snapshot request.
   *
   * `?refresh=1` drops the memoised result so a manual refresh in the page sees
   * a log written after the last build. The route never answers 5xx for a data
   * problem: a broken log is data, not a transport failure, and the page can
   * still render an older snapshot next to the warning.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async function handleSnapshot(request) {
    try {
      const url = new URL(request.url)
      if (url.searchParams.get('refresh') === '1') service.invalidate()
      return jsonResponse(await service.snapshot())
    } catch (error) {
      const reason = messageOf(error)
      warn(ctx, `snapshot failed: ${reason}`)
      return jsonResponse(emptySnapshot(reason))
    }
  }
}

/**
 * Resolve the Harness home the same way the rest of DSH does: an explicit
 * `DSH_HOME` wins, otherwise `<home>/.dsh`.
 * @returns {string}
 */
function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    const value = fromEnv.trim()
    return resolve(value === '~' ? homedir() : value.replace(/^~(?=[/\\])/, homedir()))
  }
  return join(homedir(), '.dsh')
}

/**
 * The routes this profile currently has, as `{ id, name }`.
 *
 * `ctx.llm.listProviders()` is the authoritative list of registered routes, so
 * a provider the user configured but never used still appears with a zero
 * total. `configEditor` fills in adapters that expose their routes as a
 * `providers` map on the row's config and are therefore invisible to
 * `listProviders()` until first use.
 *
 * Both reads are optional and may throw on an unusual build; neither is allowed
 * to take the page down.
 * @param {unknown} llm
 * @param {unknown} configEditor
 * @returns {{ id: string, name: string }[]}
 */
function configuredProviders(llm, configEditor) {
  /** @type {Map<string, { id: string, name: string }>} */
  const routes = new Map()

  const add = (rawId, rawName) => {
    const id = textOf(rawId)
    if (id === null) return
    const name = textOf(rawName)
    const existing = routes.get(id)
    if (existing !== undefined) {
      if (existing.name === existing.id && name !== null && name !== id) existing.name = name
      return
    }
    routes.set(id, { id, name: name ?? id })
  }

  try {
    const list = typeof llm?.listProviders === 'function' ? llm.listProviders() : []
    for (const provider of Array.isArray(list) ? list : []) {
      if (provider === null || typeof provider !== 'object') continue
      add(
        provider.id ?? provider.providerId ?? provider.slug ?? provider.name,
        provider.displayName ?? provider.label ?? provider.title ?? provider.name,
      )
    }
  } catch {
    // A route list that cannot be read must not hide the ones seen in logs.
  }

  try {
    const entries = typeof configEditor?.entries === 'function' ? configEditor.entries() : []
    for (const entry of Array.isArray(entries) ? entries : []) {
      const config = entry?.options?.config
      if (config === null || typeof config !== 'object') continue
      const providers = config.providers
      if (providers === null || typeof providers !== 'object') continue
      for (const id of Object.keys(providers)) add(id, null)
    }
  } catch {
    // Same rationale: configuration discovery is best effort.
  }

  return [...routes.values()]
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function textOf(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * A snapshot-shaped answer used only when the service itself throws.
 * Keeping the shape means the page shows its normal empty state plus the
 * warning instead of a parse error.
 * @param {string} reason
 * @returns {object}
 */
function emptySnapshot(reason) {
  const now = Date.now()
  const today = localDay(now)
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: now,
    timeZone: timeZoneOf(),
    today,
    firstDay: null,
    lastDay: null,
    days: [],
    providers: [],
    sessions: [],
    todayHours: {},
    stats: {
      total: 0,
      peakDay: null,
      longestTurnMs: 0,
      activeDays: 0,
      longestStreak: 0,
      currentStreak: 0,
      last30: 0,
    },
    warnings: [reason],
  }
}

/** @param {object} payload */
function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** @returns {string} */
function timeZoneOf() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

/** @param {number} timestamp */
function localDay(timestamp) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} text
 */
function warn(ctx, text) {
  try {
    ctx.logger?.warn?.(`[token-dashboard] ${text}`)
  } catch {
    // A missing logger must never be the reason a plugin fails.
  }
}
