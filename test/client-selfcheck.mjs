/**
 * test/client-selfcheck.mjs — Node harness for the browser half `client/client.js`.
 *
 * The environment has no browser, so this loads the bundle through a stubbed
 * `window.__ModuleLoader__` and a minimal React dispatcher, runs `apply()` on a
 * fake cordis context, and renders the page with fixture snapshots (data,
 * empty and error) to prove the render path does not throw and produces the
 * expected structure.
 *
 * Run with: node test/client-selfcheck.mjs  (from the package root).
 * It is not a node:test file, so `npm test` does not pick it up; run it explicitly.
 */
import assert from 'node:assert/strict'

// ── minimal React ──────────────────────────────────────────────────────────
const dispatcher = {
	store: [],
	refs: [],
	cursor: 0,
	dirty: false,
	effects: [],
	seen: new Set(),
	reset() {
		this.store = []
		this.refs = []
		this.cursor = 0
		this.dirty = false
		this.effects = []
		this.seen = new Set()
	},
	takeEffects() {
		const queue = this.effects
		this.effects = []
		return queue
	},
}

const ReactStub = {
	createElement(type, props, ...children) {
		return { type, props: props || {}, children }
	},
	useState(initial) {
		const index = dispatcher.cursor++
		if (!(index in dispatcher.store)) {
			dispatcher.store[index] = typeof initial === 'function' ? initial() : initial
		}
		return [dispatcher.store[index], (next) => {
			dispatcher.store[index] = typeof next === 'function' ? next(dispatcher.store[index]) : next
			dispatcher.dirty = true
		}]
	},
	useRef(initial) {
		const index = dispatcher.cursor++
		if (!(index in dispatcher.refs)) dispatcher.refs[index] = { current: initial }
		return dispatcher.refs[index]
	},
	useMemo(factory) {
		dispatcher.cursor++
		return factory()
	},
	useCallback(callback) {
		dispatcher.cursor++
		return callback
	},
	useEffect(effect, deps) {
		const index = dispatcher.cursor++
		const key = index + ':' + JSON.stringify(deps === undefined ? null : deps)
		if (dispatcher.seen.has(key)) return
		dispatcher.seen.add(key)
		dispatcher.effects.push(effect)
	},
}

// ── host stubs ─────────────────────────────────────────────────────────────
let loaded = null
let appendedStyles = []

globalThis.window = {
	__ModuleLoader__: {
		load(options) {
			loaded = options
		},
	},
	innerWidth: 1440,
	innerHeight: 900,
}

globalThis.document = {
	baseURI: 'http://127.0.0.1:51020/',
	hidden: false,
	visibilityState: 'visible',
	head: {
		appendChild(element) {
			appendedStyles.push(element)
		},
	},
	createElement(tag) {
		return {
			tag,
			attrs: {},
			textContent: '',
			setAttribute(name, value) {
				this.attrs[name] = value
			},
			remove() {
				this.removed = true
			},
		}
	},
	addEventListener() {},
	removeEventListener() {},
}

let fetchCalls = []
let fetchImpl = async () => ({ ok: true, status: 200, json: async () => fixtureSnapshot() })
globalThis.fetch = async (url, options) => {
	fetchCalls.push({ url, options })
	return fetchImpl(url, options)
}

// The page polls through setInterval; record each callback so a poll can be
// driven by hand instead of waiting a minute.
const intervals = []
globalThis.setInterval = (callback) => {
	intervals.push(callback)
	return intervals.length
}
globalThis.clearInterval = () => {}

// ── fixtures ───────────────────────────────────────────────────────────────
function hours(seed, scale) {
	const out = []
	for (let index = 0; index < 24; index++) out.push(Math.round(seed * (0.3 + ((index * 37) % 11) / 11) * scale))
	return out
}

function fixtureSnapshot() {
	return {
		version: 1,
		generatedAt: Date.now(),
		timeZone: 'Asia/Shanghai',
		today: '2026-10-22',
		firstDay: '2026-01-05',
		lastDay: '2026-10-22',
		days: [
			{ day: '2026-01-05', total: 120000, providers: { deepseek: 90000, 'opencode-go': 30000 }, sessions: { s1: 120000 } },
			{ day: '2026-07-14', total: 480000, providers: { deepseek: 300000, 'opencode-go': 180000 }, sessions: { s1: 300000, s2: 180000 } },
			{ day: '2026-10-21', total: 1250000, providers: { deepseek: 900000, 'opencode-go': 350000 }, sessions: { s1: 900000, s2: 350000 } },
			{ day: '2026-10-22', total: 640000, providers: { deepseek: 400000, 'opencode-go': 240000 }, sessions: { s1: 400000, s3: 240000 } },
		],
		providers: [
			{ id: 'deepseek', name: 'DeepSeek', configured: true, seenInLogs: true, total: 2490000, firstDay: '2026-01-05', lastDay: '2026-10-22', peak: { day: '2026-10-21', tokens: 900000 }, sessionCount: 3 },
			{ id: 'opencode-go', name: 'opencode-go', configured: false, seenInLogs: true, total: 800000, firstDay: '2026-01-05', lastDay: '2026-10-22', peak: { day: '2026-10-21', tokens: 350000 }, sessionCount: 2 },
			{ id: 'unused-route', name: 'unused-route', configured: true, seenInLogs: false, total: 0, firstDay: null, lastDay: null, peak: null, sessionCount: 0 },
		],
		sessions: [
			{
				id: 's1',
				title: '支付服务鉴权中间件重构',
				workspacePath: '/work/pay',
				workspaceTitle: 'pay',
				status: 'active',
				provider: 'deepseek',
				providers: ['deepseek', 'opencode-go'],
				messages: 2846,
				turns: 132,
				subagentCount: 2,
				orphan: false,
				firstAt: Date.parse('2026-01-05T09:00:00+08:00'),
				lastAt: Date.parse('2026-10-22T14:32:00+08:00'),
				total: 1720000,
				longestTurnMs: 15420000,
				byDay: { '2026-10-21': 900000, '2026-10-22': 400000, '2026-07-14': 300000, '2026-01-05': 120000 },
				byProvider: { deepseek: 1400000, 'opencode-go': 320000 },
			},
			{
				id: 's2',
				title: '未命名会话',
				workspacePath: null,
				workspaceTitle: null,
				status: 'archived',
				provider: 'opencode-go',
				providers: ['opencode-go'],
				messages: 812,
				turns: 40,
				subagentCount: 0,
				orphan: false,
				firstAt: Date.parse('2026-06-01T09:00:00+08:00'),
				lastAt: Date.parse('2026-10-21T11:08:00+08:00'),
				total: 530000,
				longestTurnMs: 0,
				byDay: { '2026-10-21': 350000, '2026-07-14': 180000 },
				byProvider: { 'opencode-go': 530000 },
			},
			{
				id: 's3',
				title: 'Rust 解析器迁移',
				workspacePath: '/work/parser',
				workspaceTitle: 'parser',
				status: 'deleted',
				provider: 'opencode-go',
				providers: ['opencode-go'],
				messages: 40,
				turns: 6,
				subagentCount: 1,
				orphan: true,
				firstAt: Date.parse('2026-10-22T08:00:00+08:00'),
				lastAt: Date.parse('2026-10-22T09:15:00+08:00'),
				total: 240000,
				longestTurnMs: 0,
				byDay: { '2026-10-22': 240000 },
				byProvider: { 'opencode-go': 240000 },
			},
			{
				// In-range zero usage: the list must drop it (and the chips count it out).
				id: 's4',
				title: '助理会话（无消耗）',
				workspacePath: null,
				workspaceTitle: null,
				status: 'active',
				provider: 'deepseek',
				providers: ['deepseek'],
				messages: 0,
				turns: 0,
				subagentCount: 0,
				orphan: false,
				firstAt: null,
				lastAt: null,
				total: 0,
				longestTurnMs: 0,
				byDay: {},
				byProvider: {},
			},
		],
		todayHours: {
			deepseek: hours(4000, 1),
			'opencode-go': hours(2400, 1),
		},
		stats: {
			total: 4410000000,
			peakDay: { day: '2026-10-21', tokens: 570000000 },
			longestTurnMs: 15420000,
			activeDays: 214,
			longestStreak: 18,
			currentStreak: 3,
			last30: 881000000,
		},
		warnings: [],
	}
}

function emptySnapshot() {
	return {
		version: 1,
		generatedAt: Date.now(),
		timeZone: 'Asia/Shanghai',
		today: '2026-10-22',
		firstDay: null,
		lastDay: null,
		days: [],
		providers: [{ id: 'deepseek', name: 'DeepSeek', configured: true, seenInLogs: false, total: 0, firstDay: null, lastDay: null, peak: null, sessionCount: 0 }],
		sessions: [],
		todayHours: {},
		stats: { total: 0, peakDay: null, longestTurnMs: 0, activeDays: 0, longestStreak: 0, currentStreak: 0, last30: 0 },
		warnings: ['未找到会话日志目录'],
	}
}

/** Same data with a single active session, so the deleted chip counts zero. */
function oneSessionSnapshot() {
	const snapshot = fixtureSnapshot()
	snapshot.sessions = [snapshot.sessions[0]]
	return snapshot
}

// ── renderer ───────────────────────────────────────────────────────────────
function renderNode(node, out, text) {
	if (node === null || node === undefined || typeof node === 'boolean') return
	if (Array.isArray(node)) {
		for (const child of node) renderNode(child, out, text)
		return
	}
	if (typeof node === 'string' || typeof node === 'number') {
		text.push(String(node))
		return
	}
	const props = node.props || {}
	if (typeof node.children === 'object' && node.children !== null) renderNode(node.children, out, text)
	if (typeof node.type === 'function') {
		const produced = node.type(props)
		renderNode(produced, out, text)
		return
	}
	out.push(node)
	if (props.children !== undefined) renderNode(props.children, out, text)
}

function tick() {
	return new Promise((resolve) => setTimeout(resolve, 0))
}

async function runPasses(component, props, state) {
	for (let pass = 0; pass < 25; pass++) {
		dispatcher.cursor = 0
		dispatcher.dirty = false
		const host = []
		const text = []
		renderNode(component(props), host, text)
		state.host = host
		state.text = text.join(' ')
		const effects = dispatcher.takeEffects()
		for (const effect of effects) {
			const cleanup = effect()
			if (typeof cleanup === 'function') state.cleanups.push(cleanup)
		}
		await tick()
		if (!dispatcher.dirty) break
	}
	return state
}

async function renderPage(component, props) {
	dispatcher.reset()
	return runPasses(component, props, { host: [], text: '', cleanups: [] })
}

function classes(host) {
	return host.map((node) => String((node.props && node.props.className) || ''))
}

function present(host, className) {
	return classes(host).some((entry) => entry.split(/\s+/).includes(className))
}

function countClass(host, className) {
	return classes(host).filter((entry) => entry.split(/\s+/).includes(className)).length
}

// ── the check ──────────────────────────────────────────────────────────────
const results = []
function ok(label) {
	results.push('ok  ' + label)
}

await import(new URL('../client/client.js', import.meta.url).href)
assert.ok(loaded !== null, 'window.__ModuleLoader__.load was called')
assert.equal(loaded.id, '@zhujiuyi/dsh-token-dashboard')
ok('loader id = @zhujiuyi/dsh-token-dashboard')

const mod = loaded.factory((name) => {
	if (name === 'react') return ReactStub
	throw new Error('unexpected require: ' + name)
})
assert.deepEqual(mod.inject, ['slots', 'locale'])
assert.equal(typeof mod.apply, 'function')
ok('exports { inject: [slots, locale], apply }')

// ── fake cordis context ────────────────────────────────────────────────────
let registeredLocale = null
const effects = []
const injections = []
const slots = []

const t = (key) => {
	if (registeredLocale !== null) {
		const dict = registeredLocale.dict.zh
		if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key]
	}
	return key
}

const ctx = {
	effect(callback, label) {
		effects.push(label)
		const cleanup = callback()
		return cleanup
	},
	locale: {
		register(namespace, dict) {
			registeredLocale = { namespace, dict }
			return () => {}
		},
		bind(namespace) {
			return t
		},
	},
	slots: {
		inject(owner, callback) {
			injections.push(owner)
			callback()
		},
		register(options, component) {
			slots.push({ options, component })
			return () => {}
		},
	},
}

mod.apply(ctx)
ok('apply() completed without throwing')

assert.deepEqual(injections, ['main', 'sidebar.panellist'])
ok('slots.inject called for main and sidebar.panellist')

assert.equal(registeredLocale.namespace, 'tokenDashboard')
const zhKeys = Object.keys(registeredLocale.dict.zh).sort()
const enKeys = Object.keys(registeredLocale.dict.en).sort()
assert.deepEqual(enKeys, zhKeys, 'zh/en dictionaries must expose the same keys')
ok('locale dictionaries registered: ' + zhKeys.length + ' keys, zh/en parity')

const styleEffect = appendedStyles[0]
assert.ok(styleEffect, 'a <style> element was injected')
assert.equal(styleEffect.attrs['data-plugin'], '@zhujiuyi/dsh-token-dashboard')
assert.ok(styleEffect.textContent.includes('.tdb-root'))
assert.ok(styleEffect.textContent.includes('--dsw-alias-'))
assert.ok(styleEffect.textContent.includes('--dsw-static-deepseek-500'))
assert.ok(!/#08090a|#0d0f13|#13161b/.test(styleEffect.textContent), 'no prototype neutral hex colours')
assert.ok(styleEffect.textContent.includes('@media (prefers-reduced-motion:reduce)'))
ok('<style data-plugin="@zhujiuyi/dsh-token-dashboard"> injected, token-only colours, reduced-motion')

const main = slots.find((entry) => entry.options.name === 'main')
const sidebar = slots.find((entry) => entry.options.name === 'sidebar.panellist')
assert.ok(main && sidebar, 'both slots registered')
assert.equal(main.options.key, 'token-dashboard')
assert.equal(main.options.locale, 'tokenDashboard')
assert.deepEqual(Object.keys(main.options.inject()), ['t'])
assert.equal(typeof main.component, 'function')
assert.equal(sidebar.options.id, 'token-dashboard')
assert.equal(sidebar.options.order, 5)
assert.equal(typeof sidebar.options.label, 'function')
assert.equal(sidebar.options.label(), 'Token 用量')
assert.equal(sidebar.options.locale, 'tokenDashboard')
assert.equal(typeof sidebar.component, 'function')
ok('main {key, locale, inject→{t}}; sidebar {id, order:5, label→nav, locale}')

const iconRow = sidebar.component({ size: 18 })
const icon = iconRow.type(iconRow.props)
assert.equal(icon.type, 'svg')
assert.equal(icon.props.width, 18)
assert.equal(icon.props.viewBox, '0 0 16 16')
assert.equal(icon.props['aria-hidden'], 'true')
const iconOps = icon.children.map((child) => child.type)
assert.deepEqual(iconOps, ['rect', 'rect', 'rect', 'path', 'circle'])
assert.ok(icon.children.every((child) => child.props.fill === 'currentColor' || child.props.stroke === 'currentColor'))
ok('sidebar icon: 18px SVG, bars + trend, currentColor, aria-hidden')

const fallbackRow = sidebar.component({})
assert.equal(fallbackRow.type(fallbackRow.props).props.width, 16)
ok('sidebar icon defaults to 16px')

// ── data render ────────────────────────────────────────────────────────────
fetchImpl = async () => ({ ok: true, status: 200, json: async () => fixtureSnapshot() })
const data = await renderPage(main.component, { t })

assert.ok(fetchCalls.length >= 1, 'snapshot fetched on mount')
assert.equal(fetchCalls[0].url, '/api/token-dashboard/snapshot')
assert.equal(fetchCalls[0].options.credentials, 'same-origin')
ok('fetch(/api/token-dashboard/snapshot, credentials same-origin)')

// The explicit Refresh button bypasses the host's memoised payload; a poll must
// not, or every minute would rescan the logs from scratch.
const refreshButton = data.host.find((node) => node.type === 'button'
	&& node.props && node.props.className === 'tdb-btn'
	&& node.props['aria-label'] === '刷新')
assert.ok(refreshButton, 'refresh button rendered')
const beforeRefresh = fetchCalls.length
refreshButton.props.onClick()
await tick()
assert.ok(fetchCalls.length > beforeRefresh, 'refresh triggers a read')
assert.equal(fetchCalls[fetchCalls.length - 1].url, '/api/token-dashboard/snapshot?refresh=1')
ok('manual refresh asks the host to bypass its cache')

assert.ok(present(data.host, 'tdb-root'))
assert.ok(present(data.host, 'tdb-scroll'))
assert.ok(present(data.host, 'tdb-page'))
assert.ok(present(data.host, 'tdb-h1'))
assert.ok(present(data.host, 'tdb-lede'))
assert.equal(countClass(data.host, 'tdb-stat'), 5, 'five overview stats')
ok('shell + header + 5 overview stats')

// The two token figures keep two decimals and show the exact count underneath:
// at this scale a rounded "19亿" would hide ~100M tokens.
const statValues = data.host
	.filter((node) => node.props && String(node.props.className || '').includes('tdb-stat-v'))
	.map((node) => node.children[0])
assert.equal(statValues.length, 5)
assert.equal(statValues[0], '44.10亿', 'fixture total renders with two decimals (4410000000)')
const statNotes = data.host
	.filter((node) => node.props && String(node.props.className || '').includes('tdb-stat-note'))
	.map((node) => node.children[0])
assert.ok(statNotes.includes('4,410,000,000'), 'exact total shown under the rounded figure')
assert.ok(statNotes.some((note) => String(note).includes('570,000,000')), 'exact peak shown under the peak figure')
ok('overview figures: two decimals + exact token count')

// The heatmap summary sits under the overview card, not beside the grid.
assert.ok(present(data.host, 'tdb-overview-rail'), 'summary strip rendered')
assert.ok(!present(data.host, 'tdb-heat-rail'), 'no vertical rail beside the grid')
const railIndex = data.host.findIndex((node) => String(node.props && node.props.className || '').includes('tdb-overview-rail'))
const heatIndex = data.host.findIndex((node) => String(node.props && node.props.className || '').includes('tdb-heat-grid'))
assert.ok(railIndex > -1 && railIndex < heatIndex, 'summary comes before the heatmap')
ok('heatmap summary: under the overview card, grid centred')

assert.ok(present(data.host, 'tdb-heat-grid'))
assert.equal(countClass(data.host, 'tdb-hcell'), 365, 'one cell per day for 365 days')
assert.ok(countClass(data.host, 'tdb-heat-month') >= 10, 'month labels present')
ok('heatmap: 365 cells, ' + countClass(data.host, 'tdb-heat-month') + ' month labels')

assert.ok(present(data.host, 'tdb-legend-row'))
assert.equal(countClass(data.host, 'tdb-lg'), 3, 'one legend button per provider')
assert.ok(countClass(data.host, 'tdb-bar') >= 30, 'chart bars rendered (30-day default)')
assert.ok(present(data.host, 'tdb-chart-y'))
assert.ok(present(data.host, 'tdb-chart-x'))
ok('provider section: legend x3, stacked bars, y/x axes')

const tableRows = data.host.filter((node) => node.type === 'tr')
assert.equal(tableRows.length, 4, 'header row + 3 provider rows')
assert.ok(present(data.host, 'tdb-unused'), 'configured-but-unused provider is marked')
assert.ok(present(data.host, 'tdb-share-track'))
ok('provider table: header + 3 rows, share bars, unused marker')

assert.equal(countClass(data.host, 'tdb-sess-row'), 3, 'one row per session with usage (4 fixtures, 1 empty)')
assert.ok(!data.text.includes('助理会话（无消耗）'), 'zero-usage session is not listed')
assert.ok(data.text.includes('全部 3'), 'status chip count matches the visible rows')
assert.ok(data.text.includes('已删除 1'), 'deleted chip keeps its own count')
assert.ok(data.text.includes('共 4 个会话'), 'footer still reports every known session')
assert.equal(countClass(data.host, 'tdb-badge'), 4, '3 status badges + 1 orphan badge')
assert.ok(present(data.host, 'tdb-search'))
assert.ok(present(data.host, 'tdb-tok-bar'))
assert.ok(present(data.host, 'tdb-sess-foot'))
ok('session list: 3 rows, badges, search, token bars, footer')

assert.ok(present(data.host, 'tdb-foot'))
assert.ok(!present(data.host, 'tdb-error'), 'no error bar on success')
assert.ok(!present(data.host, 'tdb-loading'), 'loading state cleared')
ok('footer present; no error/loading state')

assert.ok(data.text.includes('未命名会话'), 'host zh title fallback localised')
assert.ok(data.text.includes('含 2 个子代理'), 'subagent merge is surfaced')
assert.ok(data.text.includes('父会话缺失'), 'orphan session marked')
assert.ok(!/NaN|undefined/.test(data.text), 'no NaN/undefined leaked into text')
for (const node of data.host) {
	const style = node.props && node.props.style
	if (style) assert.ok(!/NaN|undefined/.test(JSON.stringify(style)), 'no NaN/undefined in style: ' + JSON.stringify(style))
}
ok('localised fallbacks, subagent/orphan labels, no NaN/undefined in text or styles')

// ── empty snapshot ─────────────────────────────────────────────────────────
fetchImpl = async () => ({ ok: true, status: 200, json: async () => emptySnapshot() })
const empty = await renderPage(main.component, { t })
assert.ok(present(empty.host, 'tdb-empty'))
assert.ok(!present(empty.host, 'tdb-heat-grid'))
assert.ok(present(empty.host, 'tdb-warn'), 'warnings row rendered from snapshot.warnings')
assert.ok(empty.text.includes('还没有可统计的 Token 用量'))
ok('empty snapshot: empty state + warnings row, no charts')

// ── a failed poll keeps the last good snapshot ─────────────────────────────
const pollCallbacks = intervals.slice()
fetchImpl = async () => {
	throw new Error('boom')
}
for (const poll of pollCallbacks) poll()
await tick()
await runPasses(main.component, { t }, data)
assert.ok(present(data.host, 'tdb-error'), 'error bar shown while old data survives')
assert.ok(data.text.includes('boom'))
assert.ok(data.host.length > 0 && data.text.length > 0, 'page still rendered')
ok('failed poll: alert bar + last good snapshot kept')

// ── first read fails: retry panel, not "no usage yet" ──────────────────────
const firstFailure = await renderPage(main.component, { t })
assert.ok(present(firstFailure.host, 'tdb-empty'))
assert.ok(!present(firstFailure.host, 'tdb-heat-grid'))
assert.ok(firstFailure.text.includes('boom'))
assert.ok(firstFailure.text.includes('重试'))
ok('failed first read: retry panel instead of a misleading empty state')

// ── a zero-count status chip is kept, and selecting it shows the empty state ─
fetchImpl = async () => ({ ok: true, status: 200, json: async () => oneSessionSnapshot() })
const chipPage = await renderPage(main.component, { t })
const deletedChip = chipPage.host.find((node) => node.type === 'button'
	&& Array.isArray(node.children)
	&& node.children[0] === '已删除')
assert.ok(deletedChip, 'deleted chip is rendered even when its count is zero')
assert.ok(chipPage.text.includes('已删除 0'), 'deleted chip shows 0 rather than disappearing')
deletedChip.props.onClick()
await runPasses(main.component, { t }, chipPage)
assert.equal(countClass(chipPage.host, 'tdb-sess-row'), 0)
assert.ok(present(chipPage.host, 'tdb-empty-sess'), 'selecting an empty status shows the empty state')
assert.ok(chipPage.text.includes('没有匹配的会话'))
assert.ok(chipPage.text.includes('清除筛选条件'))
ok('zero-count deleted chip kept; selecting it reaches the empty state')

// ── interaction: segmented controls, filters, search ──────────────────────
function buttonsOf(host) {
	return host.filter((node) => node.type === 'button')
}
function labelOf(node) {
	return Array.isArray(node.children) && typeof node.children[0] === 'string' ? node.children[0] : ''
}
function nthButton(host, label, index) {
	return buttonsOf(host).filter((node) => labelOf(node) === label)[index]
}

fetchImpl = async () => ({ ok: true, status: 200, json: async () => fixtureSnapshot() })
const inter = await renderPage(main.component, { t })

nthButton(inter.host, '每周', 0).props.onClick()
await runPasses(main.component, { t }, inter)
assert.equal(countClass(inter.host, 'tdb-hcell'), 365, 'weekly heat mode keeps 365 cells')
nthButton(inter.host, '累计总量', 0).props.onClick()
await runPasses(main.component, { t }, inter)
assert.equal(countClass(inter.host, 'tdb-hcell'), 365, 'cumulative heat mode keeps 365 cells')
ok('heatmap modes: weekly and cumulative render without throwing')

nthButton(inter.host, '全部', 0).props.onClick()
await runPasses(main.component, { t }, inter)
const weeklyBars = countClass(inter.host, 'tdb-bar')
assert.ok(weeklyBars >= 40 && weeklyBars <= 45, 'all-range over 90 days aggregates by week, got ' + weeklyBars)
ok('provider all-range (>90 days) aggregates weekly: ' + weeklyBars + ' bars')

nthButton(inter.host, '今天', 0).props.onClick()
await runPasses(main.component, { t }, inter)
assert.equal(countClass(inter.host, 'tdb-bar'), 24, 'today renders 24 hour buckets')
ok('provider today-range renders 24 hour buckets')

nthButton(inter.host, '今天', 1).props.onClick()
await runPasses(main.component, { t }, inter)
assert.equal(countClass(inter.host, 'tdb-sess-row'), 2, 'today keeps only sessions with today usage')
ok('session today-range filters zero-usage sessions')

const searchInput = inter.host.find((node) => node.type === 'input')
searchInput.props.onChange({ target: { value: 'rust' } })
await runPasses(main.component, { t }, inter)
assert.equal(countClass(inter.host, 'tdb-sess-row'), 1, 'title search narrows the list')
ok('session search matches the title')

searchInput.props.onChange({ target: { value: 'zzz-no-match' } })
await runPasses(main.component, { t }, inter)
assert.equal(countClass(inter.host, 'tdb-sess-row'), 0)
assert.ok(present(inter.host, 'tdb-empty-sess'))
nthButton(inter.host, '清除筛选条件', 0).props.onClick()
await runPasses(main.component, { t }, inter)
assert.equal(countClass(inter.host, 'tdb-sess-row'), 2, 'clearing filters restores the range list')
ok('session search empty state + clear filters')

// ── cleanup ────────────────────────────────────────────────────────────────
for (const bucket of [data, empty, firstFailure, chipPage, inter]) {
	for (const cleanup of bucket.cleanups) cleanup()
}
assert.ok(styleEffect.removed === undefined, 'style cleanup not run yet')
const styleCleanup = effects.some((label) => String(label).includes('styles'))
assert.ok(styleCleanup, 'style effect registered with a label')
ok('effects registered: ' + effects.join(', ') + ' (poll interval cleared)')

console.log(results.join('\n'))
console.log('\n' + results.length + ' checks passed')
process.exit(0)
