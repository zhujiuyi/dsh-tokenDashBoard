/**
 * Provider identity.
 *
 * The dashboard's provider list is the **union** of two sources:
 *
 *   1. providers this profile currently configures (`index.js` injects them from
 *      `ctx.llm.listProviders()` and the `llm-*` config rows), and
 *   2. providers that appear in the session logs — including routes the user has
 *      since deleted, because the history must stay readable.
 *
 * A configured provider that was never used therefore still gets a row with
 * `total: 0` (the page shows it as "not used yet"), and a provider that exists
 * only in old logs still gets a row with `configured: false`.
 *
 * The display name prefers what the runtime reports; otherwise a small
 * human-readable map covers the routes shipped with this machine, and anything
 * unknown falls back to its id — never to an empty label.
 */

/**
 * Human-readable names for routes whose id is not self-explanatory.
 * Keys are exact provider ids as written in the logs / configuration.
 * @type {Record<string, string>}
 */
export const PROVIDER_DISPLAY_NAMES = Object.freeze({
  'deepseek-official': 'DeepSeek 官方',
  'opencode-go': 'OpenCode Go',
  opendesign: 'Open Design',
  siliconflow: '硅基流动',
  volcengine: '火山引擎',
  volc: '火山引擎',
  aliyun: '阿里云百炼',
  dashscope: '阿里云百炼',
  openrouter: 'OpenRouter',
})

/**
 * Display name for a provider id.
 * @param {string} id
 * @param {string | null} [configuredName] name reported by the runtime, if any
 * @returns {string}
 */
export function displayNameOf(id, configuredName = null) {
  const clean = typeof configuredName === 'string' ? configuredName.trim() : ''
  // The runtime often echoes the id as its "name"; a real name is more useful.
  if (clean !== '' && clean !== id) return clean
  const mapped = PROVIDER_DISPLAY_NAMES[id]
  if (typeof mapped === 'string' && mapped !== '') return mapped
  return id
}

/**
 * Normalize the `configuredProviders` input accepted from `index.js`:
 * an array of `{ id, name }` objects, or a function returning one.
 * @param {unknown} input
 * @returns {{ id: string, name: string }[]}
 */
export function normalizeConfiguredProviders(input) {
  let value = input
  if (typeof value === 'function') {
    try {
      value = value()
    } catch {
      value = []
    }
  }
  if (!Array.isArray(value)) return []
  /** @type {{ id: string, name: string }[]} */
  const out = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '') continue
    const name = typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : id
    out.push({ id, name })
  }
  return out
}

/**
 * @typedef {object} ProviderIdentity
 * @property {string} id
 * @property {string} name
 * @property {boolean} configured
 * @property {boolean} seenInLogs
 */

/**
 * Merge configured providers with the providers seen in the logs.
 * Deterministic: rows are ordered by id so callers can sort by their own key
 * without the input order leaking into the output.
 * @param {unknown} configuredProviders
 * @param {Iterable<string>} seenIds
 * @returns {Map<string, ProviderIdentity>}
 */
export function mergeProviders(configuredProviders, seenIds) {
  /** @type {Map<string, ProviderIdentity>} */
  const rows = new Map()

  for (const { id, name } of normalizeConfiguredProviders(configuredProviders)) {
    if (rows.has(id)) continue
    rows.set(id, { id, name: displayNameOf(id, name), configured: true, seenInLogs: false })
  }

  for (const raw of seenIds) {
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id === '') continue
    const existing = rows.get(id)
    if (existing !== undefined) {
      existing.seenInLogs = true
      continue
    }
    rows.set(id, { id, name: displayNameOf(id, null), configured: false, seenInLogs: true })
  }

  return new Map([...rows.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
}
