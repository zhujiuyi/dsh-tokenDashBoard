/**
 * Workspace / session-list state.
 *
 * `<DSH_HOME>/storages/workspace.json` is the Harness' own record of which
 * sessions still belong to a workspace and which are archived. The dashboard
 * uses it only for *state* (active / archived / deleted) and for the workspace
 * path & title; every token number comes from the session logs.
 *
 * Two id spellings exist and must be treated as one session:
 *   - session directories are named by the bare id (`<uuid>`),
 *   - workspace.json stores ids as `session-<uuid>`.
 * `normalizeSessionId()` strips the prefix and is the single place that knows
 * this, so the same session is never counted twice and never reported as
 * "deleted" only because of spelling.
 *
 * Everything here is best effort: a missing or damaged `workspace.json` must
 * never make a snapshot fail, it only means "status unknown → deleted" and an
 * entry in `warnings`.
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Session-id prefix used by storage files. */
const ID_PREFIX = 'session-'

/**
 * Canonical session id: the bare `<uuid>` used by the session directory name
 * and by the log head's `id`.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeSessionId(value) {
  if (typeof value !== 'string') return null
  let id = value.trim()
  if (id === '') return null
  if (id.startsWith(ID_PREFIX)) id = id.slice(ID_PREFIX.length)
  return id === '' ? null : id
}

/**
 * @typedef {object} WorkspaceState
 * @property {boolean} ok                     workspace.json was read and parsed
 * @property {Set<string>} archived           normalized archived session ids
 * @property {Map<string, { workspaceId: string, workspacePath: string | null, workspaceTitle: string | null }>} sessions
 * @property {string[]} warnings
 * @property {string | null} signature        `mtimeMs:size`, null when absent
 */

/**
 * Read workspace.json and project it into the two lookups the aggregate needs.
 * Never throws.
 * @param {string} homeDir Harness home (`~/.dsh`)
 * @returns {WorkspaceState}
 */
export function readWorkspaceState(homeDir) {
  /** @type {WorkspaceState} */
  const state = { ok: false, archived: new Set(), sessions: new Map(), warnings: [], signature: null }
  const file = join(homeDir, 'storages', 'workspace.json')

  try {
    const stat = statSync(file)
    state.signature = signatureOf(stat)
  } catch (error) {
    if (errorCodeOf(error) !== 'ENOENT') {
      state.warnings.push(`workspace.json is unreadable: ${messageOf(error)}`)
    }
    return state
  }

  let document
  try {
    document = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    state.warnings.push(`workspace.json is not valid JSON: ${messageOf(error)}`)
    return state
  }
  if (!isObject(document)) {
    state.warnings.push('workspace.json has an unexpected shape')
    return state
  }

  state.ok = true

  const archivedIds = document.global?.archivedSessionIds
  if (Array.isArray(archivedIds)) {
    for (const raw of archivedIds) {
      const id = normalizeSessionId(raw)
      if (id !== null) state.archived.add(id)
    }
  }

  const workspaces = document.tables?.workspaces
  if (isObject(workspaces)) {
    for (const [workspaceId, workspace] of Object.entries(workspaces)) {
      if (!isObject(workspace)) continue
      const workspacePath = asText(workspace.path)
      const workspaceTitle = asText(workspace.title)
      const sessionIds = workspace.sessionIds
      if (!Array.isArray(sessionIds)) continue
      for (const raw of sessionIds) {
        const id = normalizeSessionId(raw)
        if (id === null || state.sessions.has(id)) continue
        state.sessions.set(id, { workspaceId, workspacePath, workspaceTitle })
      }
    }
  } else if (workspaces !== undefined) {
    state.warnings.push('workspace.json tables.workspaces is not an object')
  }

  return state
}

/**
 * Fallback title from `<DSH_HOME>/storages/session_projcache/sessions/<id>.json`.
 * The projection cache stores `record.rows.title.val`. It exists for logs that
 * carry no `session/title` event (older builds, imported logs).
 * @param {string} homeDir
 * @param {string} sessionId canonical (bare) id
 * @returns {{ title: string | null, signature: string }}
 */
export function readProjectionTitle(homeDir, sessionId) {
  const id = normalizeSessionId(sessionId)
  if (id === null) return { title: null, signature: 'none' }
  const directory = join(homeDir, 'storages', 'session_projcache', 'sessions')

  // The projection cache names files by the bare id; tolerate the prefixed
  // spelling too in case a future build stores it that way.
  for (const name of [`${id}.json`, `${ID_PREFIX}${id}.json`]) {
    const file = join(directory, name)
    let signature
    try {
      signature = signatureOf(statSync(file))
    } catch {
      continue
    }
    try {
      const document = JSON.parse(readFileSync(file, 'utf8'))
      const title = asText(document?.record?.rows?.title?.val) ?? asText(document?.record?.rows?.title?.val?.text)
      return { title, signature }
    } catch {
      // A damaged projection cache is only a lost fallback title.
      return { title: null, signature }
    }
  }
  return { title: null, signature: 'none' }
}

/**
 * `mtimeMs:size` — the change signature the service caches parsed results by.
 * @param {{ mtimeMs: number, size: number }} stat
 * @returns {string}
 */
export function signatureOf(stat) {
  return `${stat.mtimeMs}:${stat.size}`
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

/** @param {unknown} error @returns {string | undefined} */
function errorCodeOf(error) {
  return isObject(error) && typeof error.code === 'string' ? error.code : undefined
}

/** @param {unknown} error @returns {string} */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
