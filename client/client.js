/**
 * @zhujiuyi/dsh-token-dashboard — browser half (DSH web client).
 *
 * Loaded as a classic script through `window.__ModuleLoader__.load()`, exactly
 * like every other client bundle. Conventions this file keeps:
 *   - `id` equals the package name, because that identity is how the loader and
 *     the Plugins page address this bundle;
 *   - only the platform-seed specifier `react` is required — no Harness client
 *     package is imported as a module;
 *   - styles are self-contained: no @import, no remote URL, and every colour
 *     comes from a `--dsw-alias-*` token or the `--dsw-static-*` palette, so a
 *     theme swap degrades appearance rather than rendering;
 *   - nothing writes host DOM outside this plugin's own slot.
 *
 * Two extension points are registered:
 *   - `main` (key `token-dashboard`) — the dashboard page itself.
 *   - `sidebar.panellist` (id `token-dashboard`, order 5) — the sidebar row,
 *     which opens that main panel by id. Its icon is an inline SVG drawn here.
 *
 * Data comes from the host half's `GET /api/token-dashboard/snapshot` route
 * (see SPEC.md §3). The page polls it once a minute while the document is
 * visible, keeps the last good snapshot when a read fails, and never throws
 * into the slot: a failed component would blank the whole entry.
 */

window.__ModuleLoader__.load({
	id: '@zhujiuyi/dsh-token-dashboard',
	factory(require) {
		'use strict'

		const React = require('react')
		const h = React.createElement

		/** Locale namespace this browser half owns. */
		const NS = 'tokenDashboard'
		/** The snapshot route the host half registers. */
		const SNAPSHOT_PATH = '/api/token-dashboard/snapshot'
		/** Re-read cadence; the host caches its own work behind this. */
		const POLL_MS = 60000
		/** Series colours available for provider channels, in assignment order. */
		const SERIES_COUNT = 10
		/** Estimated tooltip box, used only for edge flipping. */
		const TIP_W = 236
		const TIP_H = 116
		const DAY_MS = 86400000

		const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
		const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
		const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

		// ── dictionaries ────────────────────────────────────────────────────
		// `lang` is a real key on purpose: the bound `t` is the only channel the
		// slot hands a page, and the active dictionary is the one authoritative
		// answer to "which language am I rendering in".
		const zh = {
			lang: 'zh',
			nav: 'Token 用量',
			title: 'Token 用量',
			lede: '查看每一天的 Token 消耗，并按供应商渠道与会话拆分。已归档与已删除会话同样计入统计。',
			refresh: '刷新',
			refreshing: '刷新中…',
			loading: '正在读取本机会话日志…',
			lastUpdated: '最后更新',
			never: '尚未读取',
			rangeAll: '全部时间',
			timeZone: '时区',
			daysUnit: '天',
			dayWord: '{n} 天',
			overviewAria: 'Token 用量概览',
			statTotal: '累计 Tokens 数',
			statPeak: '单日峰值',
			statLongestTurn: '最长任务用时',
			statLongestStreak: '最长连续天数',
			statCurrentStreak: '当前连续天数',
			peakDayNote: '峰值日 {d}',
			heatTitle: 'Token 活动',
			heatSub: '近 12 个月 · 每一格代表一天',
			heatDaily: '每天',
			heatWeekly: '每周',
			heatCumulative: '累计总量',
			heatAria: 'Token 活动热力图',
			heatAriaDays: '{n} 天有使用记录',
			heatModes: '{m}热力图',
			railActive: '活跃天数',
			railActiveNote: '共计 365 天',
			railPeak: '单日最高',
			rail30: '近 30 天合计',
			rail30Note: '含全部渠道',
			legendLess: '少',
			legendMore: '多',
			noRecord: '无使用记录',
			tokens: 'Tokens',
			shareOfAll: '占全部用量',
			weekTotal: '按周合计',
			until: '截至',
			cumulative: '累计',
			completion: '完成度',
			provTitle: '按供应商渠道',
			provSubDaily: '按天统计的 Token 消耗',
			provSubWeekly: '按周汇总的 Token 消耗',
			provSubHourly: '按小时统计的 Token 消耗（今天）',
			provAria: '按供应商渠道的 Token 消耗',
			provRange: '{mode} · {from} – {to}',
			rToday: '今天',
			r7: '近 7 天',
			r30: '近 30 天',
			rAll: '全部',
			legendAria: '切换渠道显示',
			colChannel: '渠道',
			colUsage: '用量',
			colAvg: '日均',
			colPeak: '单日峰值',
			colShare: '占比',
			unused: '未使用',
			sessTitle: '按会话',
			sessSub: 'Token 用量最高的会话 · 含已归档与已删除',
			statusAria: '按会话状态筛选',
			fAll: '全部',
			fActive: '进行中',
			fArchived: '已归档',
			fDeleted: '已删除',
			searchPlaceholder: '搜索会话或渠道',
			searchAria: '搜索会话或渠道',
			colSession: '会话',
			colStatus: '状态',
			colProvider: '渠道',
			colMessages: '消息',
			colTokens: 'Token 用量',
			colLast: '最后活跃',
			sortAria: '切换排序',
			statusActive: '进行中',
			statusArchived: '已归档',
			statusDeleted: '已删除',
			subagentsMerged: '含 {n} 个子代理',
			orphan: '父会话缺失',
			untitled: '未命名会话',
			providerMore: '+{n}',
			emptySessions: '没有匹配的会话',
			clearFilters: '清除筛选条件',
			sessFoot: '共 {a} 个会话，其中 {b} 个已归档，合并了 {c} 个子代理会话',
			sessFootNote: '已归档与已删除会话的用量仍计入每日与渠道统计',
			footSource: '数据来源：本机会话日志 · 统计含输入、输出与缓存读取 Token',
			footZone: '时区',
			footWarnings: '读取提示',
			errorTitle: '读取失败',
			errorKeep: '已保留上次成功读取的数据',
			retry: '重试',
			today: '今天',
			yesterday: '昨天',
			unitWan: '万',
			unitYi: '亿',
			unitThousand: 'K',
			unitMillion: 'M',
			unitBillion: 'B',
			durHour: '小时',
			durMinute: '分',
			durSecond: '秒',
			emptyTitle: '还没有可统计的 Token 用量',
			emptyHint: '开始一轮对话后，这里会按天、按渠道与按会话显示消耗。',
			emptyRefresh: '重新读取',
			subagentMergeNote: '子代理会话已合并进父会话',
		}

		const en = {
			lang: 'en',
			nav: 'Token usage',
			title: 'Token usage',
			lede: 'Daily token consumption, broken down by provider channel and by session. Archived and deleted sessions still count.',
			refresh: 'Refresh',
			refreshing: 'Refreshing…',
			loading: 'Reading local session logs…',
			lastUpdated: 'Updated',
			never: 'never',
			rangeAll: 'All time',
			timeZone: 'Time zone',
			daysUnit: 'days',
			dayWord: '{n} days',
			overviewAria: 'Token usage overview',
			statTotal: 'Total tokens',
			statPeak: 'Peak day',
			statLongestTurn: 'Longest task',
			statLongestStreak: 'Longest streak',
			statCurrentStreak: 'Current streak',
			peakDayNote: 'peak on {d}',
			heatTitle: 'Token activity',
			heatSub: 'Last 12 months · one cell per day',
			heatDaily: 'Daily',
			heatWeekly: 'Weekly',
			heatCumulative: 'Cumulative',
			heatAria: 'Token activity heatmap',
			heatAriaDays: '{n} active days',
			heatModes: '{m} heatmap',
			railActive: 'Active days',
			railActiveNote: 'of 365 days',
			railPeak: 'Busiest day',
			rail30: 'Last 30 days',
			rail30Note: 'all channels',
			legendLess: 'Less',
			legendMore: 'More',
			noRecord: 'No usage recorded',
			tokens: 'Tokens',
			shareOfAll: 'of all usage',
			weekTotal: 'week total',
			until: 'through',
			cumulative: 'Cumulative',
			completion: 'progress',
			provTitle: 'By provider channel',
			provSubDaily: 'Token consumption per day',
			provSubWeekly: 'Token consumption per week',
			provSubHourly: 'Token consumption per hour (today)',
			provAria: 'Token consumption by provider channel',
			provRange: '{mode} · {from} – {to}',
			rToday: 'Today',
			r7: '7 days',
			r30: '30 days',
			rAll: 'All',
			legendAria: 'Toggle channels',
			colChannel: 'Channel',
			colUsage: 'Usage',
			colAvg: 'Daily avg',
			colPeak: 'Peak day',
			colShare: 'Share',
			unused: 'unused',
			sessTitle: 'By session',
			sessSub: 'Heaviest sessions · archived and deleted included',
			statusAria: 'Filter by session status',
			fAll: 'All',
			fActive: 'Active',
			fArchived: 'Archived',
			fDeleted: 'Deleted',
			searchPlaceholder: 'Search sessions or channels',
			searchAria: 'Search sessions or channels',
			colSession: 'Session',
			colStatus: 'Status',
			colProvider: 'Channel',
			colMessages: 'Messages',
			colTokens: 'Tokens',
			colLast: 'Last active',
			sortAria: 'Toggle sort',
			statusActive: 'Active',
			statusArchived: 'Archived',
			statusDeleted: 'Deleted',
			subagentsMerged: 'includes {n} subagents',
			orphan: 'parent session missing',
			untitled: 'Untitled session',
			providerMore: '+{n}',
			emptySessions: 'No matching sessions',
			clearFilters: 'Clear filters',
			sessFoot: '{a} sessions, {b} archived, {c} subagent sessions merged in',
			sessFootNote: 'Archived and deleted sessions still count towards daily and channel totals',
			footSource: 'Source: local session logs · includes input, output and cache-read tokens',
			footZone: 'Time zone',
			footWarnings: 'Read warnings',
			errorTitle: 'Read failed',
			errorKeep: 'showing the last successful snapshot',
			retry: 'Retry',
			today: 'today',
			yesterday: 'yesterday',
			unitWan: '万',
			unitYi: '亿',
			unitThousand: 'K',
			unitMillion: 'M',
			unitBillion: 'B',
			durHour: 'h ',
			durMinute: 'm ',
			durSecond: 's',
			emptyTitle: 'No token usage to summarise yet',
			emptyHint: 'Once a turn runs, daily, per-channel and per-session usage appears here.',
			emptyRefresh: 'Read again',
			subagentMergeNote: 'Subagent sessions are merged into their parent',
		}

		// ── styles ──────────────────────────────────────────────────────────
		// Every colour is either an alias token (theme-aware) or a static palette
		// entry (theme-independent brand colours for series bars). Where a tint is
		// needed, it is mixed from a token with color-mix so light and dark both
		// stay legible instead of relying on a hard-coded grey.
		const CSS = [
			// ── shell ───────────────────────────────────────────────────────
			'.tdb-root{--tdb-cell:12px;--tdb-cols:53;--tdb-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--tdb-c0:var(--dsw-static-deepseek-500,#4176e6);--tdb-c1:var(--dsw-static-blue-500,#3b82f6);--tdb-c2:var(--dsw-static-amber-500,#f59e0b);--tdb-c3:var(--dsw-static-green-500,#22c55e);--tdb-c4:var(--dsw-static-deepseek-300,#8fb0f5);--tdb-c5:var(--dsw-static-blue-300,#93c5fd);--tdb-c6:var(--dsw-static-amber-400,#fbbf24);--tdb-c7:var(--dsw-static-green-400,#4ade80);--tdb-c8:var(--dsw-static-deepseek-600,#2f5bbf);--tdb-c9:var(--dsw-static-blue-600,#2563eb);--tdb-heat0:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent);--tdb-heat1:color-mix(in srgb,var(--dsw-static-deepseek-500,#4176e6) 22%,transparent);--tdb-heat2:color-mix(in srgb,var(--dsw-static-deepseek-500,#4176e6) 48%,transparent);--tdb-heat3:color-mix(in srgb,var(--dsw-static-deepseek-500,#4176e6) 74%,transparent);--tdb-heat4:var(--dsw-static-deepseek-500,#4176e6);--tdb-track:color-mix(in srgb,var(--dsw-alias-label-primary) 11%,transparent);--tdb-tint:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);--tdb-tint-strong:color-mix(in srgb,var(--dsw-alias-label-primary) 13%,transparent);height:100%;min-height:0;display:flex;flex-direction:column;position:relative;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);font-size:14px;line-height:1.6;letter-spacing:.005em}',
			'.tdb-root *,.tdb-root *::before,.tdb-root *::after{box-sizing:border-box}',
			'.tdb-root h1,.tdb-root h2,.tdb-root h3,.tdb-root p{margin:0}',
			'.tdb-root button{font:inherit;color:inherit}',
			'.tdb-root :focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
			'.tdb-scroll{overflow-y:auto;flex:1 1 auto;min-height:0;overscroll-behavior:contain;scrollbar-width:thin}',
			'.tdb-page{max-width:1160px;margin:0 auto;padding:32px 32px 48px}',
			'.tdb-num{font-variant-numeric:tabular-nums}',

			// ── header ──────────────────────────────────────────────────────
			'.tdb-head{display:flex;align-items:flex-end;justify-content:space-between;gap:26px;flex-wrap:wrap}',
			'.tdb-h1{margin:0;font-size:26px;line-height:1.2;letter-spacing:-.02em;font-weight:600}',
			'.tdb-lede{margin:9px 0 0;color:var(--dsw-alias-label-secondary);font-size:13.5px;max-width:640px}',
			'.tdb-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap;padding-bottom:2px}',
			'.tdb-sep{width:3px;height:3px;border-radius:50%;background:var(--dsw-alias-label-tertiary);opacity:.75;flex:none}',
			'.tdb-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;white-space:nowrap;transition:border-color .15s ease,color .15s ease,background .15s ease}',
			'.tdb-btn:hover{background:var(--tdb-tint);border-color:var(--dsw-alias-border-l4);color:var(--dsw-alias-label-primary)}',
			'.tdb-btn:active{background:var(--tdb-tint-strong)}',
			'.tdb-btn[data-busy="true"]{color:var(--dsw-alias-label-tertiary);cursor:progress}',
			'.tdb-btn svg{flex:none}',
			'.tdb-btn[data-busy="true"] svg{animation:tdb-spin .9s linear infinite}',
			'.tdb-error{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:16px;padding:9px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12.5px}',
			'.tdb-error b{font-weight:600}',
			'.tdb-error .tdb-btn{height:26px;background:transparent;border-color:currentColor;color:inherit}',

			// ── overview ────────────────────────────────────────────────────
			'.tdb-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
			'.tdb-stat{padding:18px 20px;min-width:0}',
			'.tdb-stat + .tdb-stat{border-left:1px solid var(--dsw-alias-border-l2)}',
			'.tdb-stat-v{display:block;font-size:clamp(19px,2vw,23px);font-weight:600;letter-spacing:-.015em;line-height:1.3;white-space:nowrap;font-variant-numeric:tabular-nums}',
			'.tdb-stat-l{display:block;margin-top:5px;font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.tdb-stat-note{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',

			// Summary strip: active days / peak day / last 30 days + the heat legend.
			// It sits directly under the overview card (the page's dead space there
			// was worth using), not beside the heatmap — the grid is only 7 rows tall,
			// so a vertical rail would leave a tall empty column next to it.
			'.tdb-overview-rail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:10px 26px;align-items:end;margin-top:18px;padding:0 4px}',
			'.tdb-rail-k{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-rail-v{margin-top:3px;font-size:17px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;font-variant-numeric:tabular-nums}',
			'.tdb-rail-note{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',

			// ── sections ────────────────────────────────────────────────────
			'.tdb-section{margin-top:44px}',
			'.tdb-sec-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}',
			'.tdb-sec-title{margin:0;font-size:16.5px;font-weight:600;letter-spacing:-.01em}',
			'.tdb-sec-sub{margin:5px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',

			// ── segmented control ───────────────────────────────────────────
			'.tdb-seg{display:inline-flex;gap:2px;padding:3px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;flex-wrap:wrap}',
			'.tdb-seg > button{height:26px;padding:0 10px;border:0;border-radius:7px;background:none;color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap;cursor:pointer;transition:background .15s ease,color .15s ease}',
			'.tdb-seg > button:hover{color:var(--dsw-alias-label-primary)}',
			'.tdb-seg > button[aria-pressed="true"]{background:var(--tdb-tint-strong);color:var(--dsw-alias-label-primary)}',
			'.tdb-fcount{margin-left:3px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
			'.tdb-seg > button[aria-pressed="true"] .tdb-fcount{color:var(--dsw-alias-label-secondary)}',

			// ── heatmap ─────────────────────────────────────────────────────
			// The heatmap grid is centred in the page: a year of 12px cells is wider
			// than a narrow window but narrower than a wide one, and left-aligning it
			// left the section visibly lopsided on a 2K display.
			'.tdb-heat-body{display:flex;flex-direction:column;gap:8px}',
			'.tdb-heat-scroll{flex:1 1 auto;min-width:0;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:thin}',
			'.tdb-heat-grid{margin:0 auto;display:grid;grid-template-columns:repeat(var(--tdb-cols,53),var(--tdb-cell,12px));grid-template-rows:repeat(7,var(--tdb-cell,12px)) 20px;gap:3px;width:max-content;padding-right:2px}',
			'.tdb-hcell{display:block;width:100%;height:100%;border-radius:3px;background:var(--tdb-heat0);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);transition:transform .12s ease,box-shadow .12s ease}',
			'.tdb-hcell[data-level="1"]{background:var(--tdb-heat1)}',
			'.tdb-hcell[data-level="2"]{background:var(--tdb-heat2)}',
			'.tdb-hcell[data-level="3"]{background:var(--tdb-heat3)}',
			'.tdb-hcell[data-level="4"]{background:var(--tdb-heat4)}',
			'.tdb-hcell:hover{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 40%,transparent);transform:scale(1.12)}',
			'.tdb-heat-month{grid-row:8;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:visible;align-self:start;padding-top:7px;font-variant-numeric:tabular-nums}',
			'.tdb-rail-k{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-rail-v{margin-top:3px;font-size:19px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;font-variant-numeric:tabular-nums}',
			'.tdb-rail-note{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
			'.tdb-heat-legend{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-heat-legend-cells{display:flex;gap:3px}',
			'.tdb-heat-legend-cells i{display:block;width:10px;height:10px;border-radius:2px}',

			// ── tooltip ─────────────────────────────────────────────────────
			'.tdb-tip{position:fixed;left:0;top:0;z-index:70;pointer-events:none;opacity:0;overflow:hidden;transition:opacity .13s ease;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,9px);padding:9px 11px;min-width:150px;max-width:270px;box-shadow:var(--dsw-shadow-lv2,0 12px 32px rgba(0,0,0,.35))}',
			'.tdb-tip[data-show="true"]{opacity:1}',
			'.tdb-tip-title{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
			'.tdb-tip-main{margin-top:3px;font-size:13px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
			'.tdb-tip-row{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
			'.tdb-tip-row > span{overflow:hidden;text-overflow:ellipsis}',
			'.tdb-tip-row b{margin-left:auto;padding-left:14px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
			'.tdb-dot{display:block;width:7px;height:7px;border-radius:2px;flex:none;background:currentColor}',

			// ── provider chart ──────────────────────────────────────────────
			'.tdb-legend-row{display:flex;flex-wrap:wrap;gap:2px;margin:0 0 6px -8px}',
			'.tdb-lg{display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border:0;border-radius:8px;background:none;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s ease,color .15s ease,opacity .15s ease}',
			'.tdb-lg:hover{background:var(--tdb-tint);color:var(--dsw-alias-label-primary)}',
			'.tdb-lg[aria-pressed="false"]{opacity:.45}',
			'.tdb-lg[aria-pressed="false"] .tdb-dot{background:var(--dsw-alias-label-tertiary)!important}',
			'.tdb-chart{display:flex;margin-top:2px}',
			'.tdb-chart-y{position:relative;width:54px;flex:none;height:236px}',
			'.tdb-chart-y span{position:absolute;right:9px;transform:translateY(50%);font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums}',
			'.tdb-chart-main{flex:1 1 auto;min-width:0}',
			'.tdb-chart-plot{position:relative;height:236px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
			'.tdb-chart-lines{position:absolute;inset:0;pointer-events:none}',
			'.tdb-gridline{position:absolute;left:0;right:0;border-top:1px dashed color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}',
			'.tdb-bars{position:absolute;inset:0;display:flex;align-items:flex-end;gap:3px;padding:0 2px}',
			'.tdb-bar{flex:1 1 0;min-width:1px;height:100%;display:flex;flex-direction:column-reverse;border-radius:2px 2px 0 0;transition:opacity .14s ease,background .14s ease}',
			'.tdb-bar i{display:block;width:100%;flex:0 0 auto}',
			'.tdb-bars:hover .tdb-bar{opacity:.45}',
			'.tdb-bars .tdb-bar:hover{opacity:1;background:var(--tdb-tint)}',
			'.tdb-bars[data-sparse="true"]{justify-content:center}',
			'.tdb-bars[data-sparse="true"] .tdb-bar{flex:0 0 64px;max-width:64px}',
			'.tdb-chart-x{position:relative;height:22px;margin-top:8px}',
			'.tdb-chart-x span{position:absolute;top:0;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;transform:translateX(-50%);font-variant-numeric:tabular-nums}',

			// ── provider table ──────────────────────────────────────────────
			'.tdb-table{width:100%;border-collapse:collapse;margin-top:22px;font-size:13px}',
			'.tdb-table th{font-weight:400;font-size:11.5px;color:var(--dsw-alias-label-tertiary);text-align:left;padding:0 0 9px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap}',
			'.tdb-table td{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:middle}',
			'.tdb-table tbody tr:last-child td{border-bottom:0}',
			'.tdb-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
			'.tdb-table tbody tr:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
			'.tdb-pname{display:flex;align-items:center;gap:9px;white-space:nowrap;font-size:13px}',
			'.tdb-table th.tdb-share-col,.tdb-table td.tdb-share-col{width:32%}',
			'.tdb-share-cell{display:flex;align-items:center;gap:11px;min-width:140px}',
			'.tdb-share-track{flex:1 1 auto;height:4px;border-radius:2px;background:var(--tdb-track);overflow:hidden;min-width:56px}',
			'.tdb-share-fill{display:block;height:100%;border-radius:2px}',
			'.tdb-share-pct{width:46px;text-align:right;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
			'.tdb-unused{margin-left:8px;padding:1px 6px;border-radius:5px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);background:var(--tdb-tint);white-space:nowrap}',

			// ── session list ────────────────────────────────────────────────
			'.tdb-search{display:flex;align-items:center;gap:7px;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,9px);background:var(--dsw-alias-bg-layer-2);width:226px;transition:border-color .15s ease}',
			'.tdb-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}',
			'.tdb-search svg{color:var(--dsw-alias-label-tertiary);flex:none}',
			'.tdb-search input{flex:1 1 auto;min-width:0;border:0;outline:none;background:none;font:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary)}',
			'.tdb-search input::placeholder{color:var(--dsw-alias-label-tertiary)}',
			'.tdb-search input::-webkit-search-cancel-button{-webkit-appearance:none}',
			'.tdb-sess{border-top:1px solid var(--dsw-alias-border-l2)}',
			'.tdb-sess-head,.tdb-sess-row{display:grid;grid-template-columns:minmax(220px,1.65fr) 104px 130px 68px minmax(170px,1fr) 100px;align-items:center;gap:16px}',
			'.tdb-sess-head{padding:11px 4px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-sess-col-num{text-align:right}',
			'.tdb-th-btn{display:inline-flex;align-items:center;gap:5px;padding:2px 0;border:0;background:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:color .15s ease}',
			'.tdb-th-btn:hover{color:var(--dsw-alias-label-primary)}',
			'.tdb-th-btn svg{opacity:0;transition:opacity .15s ease,transform .15s ease}',
			'[aria-sort="descending"] .tdb-th-btn svg{opacity:1}',
			'[aria-sort="ascending"] .tdb-th-btn svg{opacity:1;transform:rotate(180deg)}',
			'.tdb-sess-row{padding:14px 4px;border-bottom:1px solid var(--dsw-alias-border-l2);transition:background .15s ease}',
			'.tdb-sess-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent)}',
			'.tdb-sess-name{display:block;font-size:13.5px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.tdb-sess-id{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--tdb-mono);letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.tdb-badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:6px;font-size:11.5px;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}',
			'.tdb-badge .tdb-bdot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}',
			'.tdb-badge[data-status="archived"]{background:var(--tdb-tint-strong);color:var(--dsw-alias-label-secondary)}',
			'.tdb-badge[data-status="deleted"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}',
			'.tdb-badge[data-status="orphan"]{background:var(--tdb-tint-strong);color:var(--dsw-alias-label-secondary)}',
			'.tdb-p-mini{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.tdb-p-mini .tdb-more{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
			'.tdb-c-msgs{font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
			'.tdb-tok-cap{display:none}',
			'.tdb-tok-value{display:block;font-size:13px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}',
			'.tdb-tok-bar{display:block;margin-top:5px;height:3px;border-radius:2px;background:var(--tdb-track);overflow:hidden}',
			'.tdb-tok-bar i{display:block;height:100%;border-radius:2px;background:var(--tdb-c0)}',
			'.tdb-c-last{font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
			'.tdb-sess-foot{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:13px;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-empty-sess{padding:56px 0 44px;text-align:center;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-empty-sess svg{color:var(--dsw-alias-label-tertiary);opacity:.7}',
			'.tdb-empty-sess p{margin:12px 0 16px;font-size:13px;color:var(--dsw-alias-label-secondary)}',

			// ── page states ─────────────────────────────────────────────────
			'.tdb-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:90px 0;color:var(--dsw-alias-label-tertiary);font-size:13px}',
			'.tdb-spinner{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--tdb-track);border-top-color:var(--dsw-alias-state-business-primary);animation:tdb-spin .9s linear infinite;flex:none}',
			'.tdb-empty{display:grid;place-items:center;text-align:center;padding:64px 20px;margin-top:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}',
			'.tdb-empty h2{margin:0 0 8px;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.tdb-empty p{max-width:420px;font-size:12.5px;margin:0 0 18px}',

			// ── footer ──────────────────────────────────────────────────────
			'.tdb-foot{margin-top:44px;padding-top:18px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-tertiary)}',
			'.tdb-warn{margin-top:12px;display:flex;align-items:flex-start;gap:8px;font-size:11.5px;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}',
			'.tdb-warn svg{flex:none;margin-top:2px}',

			// ── keyframes + media ──────────────────────────────────────────
			'@keyframes tdb-spin{to{transform:rotate(360deg)}}',
			'@media (max-width:1100px){.tdb-root{--tdb-cell:11px}}',
			'@media (max-width:1024px){.tdb-page{padding:26px 24px 44px}.tdb-overview-rail{grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:9px 18px}.tdb-sess-head,.tdb-sess-row{grid-template-columns:minmax(200px,1.6fr) 96px 118px 60px minmax(150px,1fr) 92px;gap:13px}}',
			'@media (max-width:900px){.tdb-overview-rail{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.tdb-overview-rail .tdb-heat-legend{grid-column:1 / -1;justify-self:start}.tdb-chart-y{height:204px;width:50px}.tdb-chart-plot{height:204px}}',
			'@media (max-width:860px){.tdb-stats{grid-template-columns:1fr 1fr}.tdb-stat{padding:15px 17px}.tdb-stat + .tdb-stat{border-left:0}.tdb-stat:nth-child(2n){border-left:1px solid var(--dsw-alias-border-l2)}.tdb-stat:nth-child(n+3){border-top:1px solid var(--dsw-alias-border-l2)}.tdb-stat:last-child{grid-column:1 / -1;border-left:0}}',
			'@media (max-width:780px){.tdb-sess-head{display:none}.tdb-sess-row{grid-template-columns:1fr auto;grid-template-areas:"name status" "prov last" "tokens tokens";gap:8px 12px;padding:14px 2px}.tdb-c-session{grid-area:name}.tdb-c-status{grid-area:status;justify-self:end}.tdb-c-prov{grid-area:prov;align-self:center}.tdb-c-last{grid-area:last;align-self:center}.tdb-c-tokens{grid-area:tokens}.tdb-c-msgs{display:none}.tdb-sess-name{white-space:normal;overflow:visible}.tdb-tok-cap{display:block;margin-bottom:4px;font-size:11px;color:var(--dsw-alias-label-tertiary)}}',
			'@media (max-width:720px){.tdb-h1{font-size:23px}.tdb-lede{font-size:13px}.tdb-section{margin-top:38px}.tdb-chart-y{height:178px;width:46px}.tdb-chart-plot{height:178px}.tdb-table .hide-sm{display:none}.tdb-share-cell{min-width:110px}}',
			'@media (max-width:600px){.tdb-page{padding:20px 16px 40px}.tdb-sec-tools{width:100%}.tdb-search{width:100%}.tdb-seg{flex-wrap:wrap}.tdb-chart-x span:nth-child(even){display:none}.tdb-stats{grid-template-columns:1fr}.tdb-stat + .tdb-stat{border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.tdb-stat:last-child{grid-column:auto}.tdb-overview-rail{grid-template-columns:1fr 1fr}}',
			'@media (prefers-reduced-motion:reduce){.tdb-root *,.tdb-root *::before,.tdb-root *::after{transition:none!important;animation:none!important}.tdb-hcell:hover{transform:none}}',
		].join('')

		// ── helpers ─────────────────────────────────────────────────────────
		/** Locale lookup that can never throw and never renders an empty label. */
		function tr(t, key, fallback) {
			try {
				const value = t(key)
				if (typeof value === 'string' && value !== '') return value
				if (typeof value === 'number') return String(value)
			} catch {
				// A missing binding falls through to the caller's fallback.
			}
			return fallback === undefined ? key : fallback
		}

		/** Same lookup, with `{name}` placeholders filled. */
		function tf(t, key, vars) {
			let out = tr(t, key)
			if (vars) {
				for (const name of Object.keys(vars)) out = out.split('{' + name + '}').join(String(vars[name]))
			}
			return out
		}

		function pad2(value) {
			return String(value).padStart(2, '0')
		}

		/** `YYYY-MM-DD` → local midnight Date, or null when unparsable. */
		function parseDay(value) {
			if (typeof value !== 'string') return null
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
			if (!match) return null
			const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0)
			return Number.isFinite(date.getTime()) ? date : null
		}

		/** Local midnight Date → `YYYY-MM-DD` (the host's day key). */
		function dayKey(date) {
			return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate())
		}

		function startOfDay(date) {
			return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
		}

		function addDays(date, count) {
			return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count, 0, 0, 0, 0)
		}

		function diffDays(from, to) {
			return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
		}

		function trim1(value) {
			return value.toFixed(1).replace(/\.0$/, '')
		}

		/** Two decimals, grouping the integer part (e.g. 1897560866 → "18.98"). */
		function round2(value) {
			const fixed = Math.abs(value).toFixed(2)
			const [whole, fraction] = fixed.split('.')
			const grouped = Number(whole).toLocaleString('en-US')
			return (value < 0 ? '-' : '') + grouped + '.' + fraction
		}

		function asArray(value) {
			return Array.isArray(value) ? value : []
		}

		function asNumber(value) {
			const number = typeof value === 'number' ? value : Number(value)
			return Number.isFinite(number) ? number : 0
		}

		function asRecord(value) {
			return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
		}

		/** Builder for the language-aware formatters every section shares. */
		function makeFmt(t) {
			const lang = tr(t, 'lang', 'zh') === 'en' ? 'en' : 'zh'
			const locale = lang === 'en' ? 'en-US' : 'zh-CN'

			const int = (value) => Math.round(asNumber(value)).toLocaleString(locale)

			const tok = (value) => {
				const number = asNumber(value)
				if (number === 0) return '0'
				const abs = Math.abs(number)
				if (lang === 'zh') {
					if (abs >= 1e8) return trim1(number / 1e8) + tr(t, 'unitYi', '亿')
					if (abs >= 1e4) return Math.round(number / 1e4).toLocaleString(locale) + tr(t, 'unitWan', '万')
					return Math.round(number).toLocaleString(locale)
				}
				if (abs >= 1e9) return trim1(number / 1e9) + tr(t, 'unitBillion', 'B')
				if (abs >= 1e6) return trim1(number / 1e6) + tr(t, 'unitMillion', 'M')
				if (abs >= 1e3) return trim1(number / 1e3) + tr(t, 'unitThousand', 'K')
				return Math.round(number).toLocaleString(locale)
			}

			/**
			 * Same magnitude unit as `tok`, but always two decimals.
			 *
			 * The overview strips use this: at 1.9e9 tokens a rounded "19亿" throws
			 * away ~100M of information, while "18.98亿" resolves to the nearest
			 * million — the precision a reader comparing two totals expects.
			 * `tail` carries what the unit cannot show, e.g. "（1,897,560,866）".
			 */
			const tokExact = (value) => {
				const number = asNumber(value)
				if (number === 0) return '0'
				const abs = Math.abs(number)
				if (lang === 'zh') {
					if (abs >= 1e8) return round2(number / 1e8) + tr(t, 'unitYi', '亿')
					if (abs >= 1e4) return round2(number / 1e4) + tr(t, 'unitWan', '万')
					return Math.round(number).toLocaleString(locale)
				}
				if (abs >= 1e9) return round2(number / 1e9) + tr(t, 'unitBillion', 'B')
				if (abs >= 1e6) return round2(number / 1e6) + tr(t, 'unitMillion', 'M')
				if (abs >= 1e3) return round2(number / 1e3) + tr(t, 'unitThousand', 'K')
				return Math.round(number).toLocaleString(locale)
			}

			/** The raw token count, grouped, for the detail under an exact figure. */
			const raw = (value) => Math.round(asNumber(value)).toLocaleString(locale)

			// Calendar labels come from Intl rather than the dictionary: month and
			// weekday names must follow the reader's locale even beyond zh/en, and
			// both fall back to the shipped tables if Intl is unavailable.
			const formatter = (options) => {
				try {
					return typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
						? new Intl.DateTimeFormat(locale, options)
						: null
				} catch {
					return null
				}
			}
			const monthFmt = formatter({ month: 'short' })
			const dateFmt = formatter({ month: 'long', day: 'numeric' })
			const weekdayFmt = formatter({ weekday: 'short' })

			const monthLabel = (index) => {
				if (monthFmt !== null) {
					try {
						return monthFmt.format(new Date(2026, index, 1))
					} catch {
						// fall through to the table
					}
				}
				return lang === 'en' ? MONTHS_EN[index] : (index + 1) + '月'
			}

			const dateFull = (date) => {
				if (dateFmt !== null) {
					try {
						return dateFmt.format(date)
					} catch {
						// fall through to the table
					}
				}
				return lang === 'en'
					? MONTHS_EN[date.getMonth()] + ' ' + date.getDate()
					: (date.getMonth() + 1) + '月' + date.getDate() + '日'
			}

			const dateTime = (date) => dayKey(date) + ' ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes())

			const weekday = (date) => {
				if (weekdayFmt !== null) {
					try {
						return weekdayFmt.format(date)
					} catch {
						// fall through to the table
					}
				}
				return lang === 'en' ? WEEKDAYS_EN[date.getDay()] : WEEKDAYS_ZH[date.getDay()]
			}

			const md = (date) => (date.getMonth() + 1) + '/' + date.getDate()

			const dur = (ms) => {
				const total = Math.round(asNumber(ms) / 1000)
				if (total <= 0) return '—'
				const hours = Math.floor(total / 3600)
				const minutes = Math.floor((total % 3600) / 60)
				const seconds = total % 60
				if (hours > 0) return hours + tr(t, 'durHour', 'h ') + (minutes > 0 ? minutes + tr(t, 'durMinute', 'm ') : '')
				if (minutes > 0) return minutes + tr(t, 'durMinute', 'm ')
				return seconds + tr(t, 'durSecond', 's')
			}

			return { lang, t: (key, fallback) => tr(t, key, fallback), tf: (key, vars) => tf(t, key, vars), int, tok, tokExact, raw, dur, dateFull, dateTime, weekday, monthLabel, md }
		}

		/** Percent with one decimal; keeps tiny shares visible instead of "0.0". */
		function pct(value, total) {
			if (!(total > 0)) return '0.0'
			const share = (value / total) * 100
			if (share > 0 && share < 0.1) return '<0.1'
			return share.toFixed(1)
		}

		/** Walk a few ancestors looking for a `data-*` attribute (tooltip targets). */
		function closestAttr(node, name, depth) {
			let current = node
			let left = typeof depth === 'number' ? depth : 4
			while (current && left >= 0) {
				if (current.getAttribute) {
					const value = current.getAttribute(name)
					if (value !== null && value !== undefined) return { node: current, value }
				}
				current = current.parentNode
				left--
			}
			return null
		}

		/**
		 * Resolve the snapshot route against the page's own base.
		 *
		 * `refresh` asks the host to drop its memoised payload; only the explicit
		 * Refresh button sets it, so a poll keeps riding the host's short cache.
		 */
		function snapshotUrl(refresh) {
			try {
				const url = new URL('api/token-dashboard/snapshot', document.baseURI)
				if (refresh === true) url.searchParams.set('refresh', '1')
				return url.pathname + url.search
			} catch {
				return refresh === true ? SNAPSHOT_PATH + '?refresh=1' : SNAPSHOT_PATH
			}
		}

		/**
		 * Shared tooltip state.
		 *
		 * Position is clamped against the viewport with an estimated box size, so
		 * a hover near the right or bottom edge flips instead of overflowing.
		 */
		function useTooltip() {
			const [tip, setTip] = React.useState(null)

			const show = React.useCallback((event, data) => {
				const viewportW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1280
				const viewportH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800
				const x = event && typeof event.clientX === 'number' ? event.clientX : 0
				const y = event && typeof event.clientY === 'number' ? event.clientY : 0
				let left = x + 14
				let top = y + 14
				if (left + TIP_W > viewportW - 12) left = x - TIP_W - 14
				if (top + TIP_H > viewportH - 12) top = Math.max(12, y - TIP_H - 14)
				if (left < 12) left = 12
				setTip({ title: data.title, main: data.main, rows: data.rows || [], left, top })
			}, [])

			const hide = React.useCallback(() => setTip(null), [])

			return { tip, show, hide }
		}

		/** The floating readout both charts feed. Fixed, so scrolling cannot clip it. */
		function Tooltip(props) {
			const tip = props.tip
			const style = tip
				? { left: tip.left + 'px', top: tip.top + 'px' }
				: { left: '-9999px', top: '0px' }
			const children = []
			if (tip) {
				children.push(h('div', { className: 'tdb-tip-title', key: 'title' }, tip.title))
				if (tip.main) children.push(h('div', { className: 'tdb-tip-main', key: 'main' }, tip.main))
				for (let index = 0; index < tip.rows.length; index++) {
					const row = tip.rows[index]
					children.push(h(
						'div',
						{ className: 'tdb-tip-row', key: 'row' + index },
						row.color === undefined || row.color === null
							? null
							: h('span', { className: 'tdb-dot', style: { background: row.color } }),
						h('span', null, row.label),
						h('b', null, row.value),
					))
				}
			}
			return h('div', {
				className: 'tdb-tip',
				role: 'status',
				'aria-live': 'polite',
				'data-show': tip ? 'true' : 'false',
				style,
			}, children)
		}

		/** One inline SVG series colour, by provider index. */
		function seriesColor(index) {
			return 'var(--tdb-c' + (index % SERIES_COUNT) + ')'
		}

		// ── page ────────────────────────────────────────────────────────────
		/**
		 * The dashboard page.
		 *
		 * Data flow: mount → read the snapshot, then poll every 60 s while the
		 * document is visible. A failed read keeps the previous snapshot and
		 * surfaces the failure in an alert bar, because a blank page after one
		 * hiccup would hide perfectly good numbers.
		 */
		function DashboardPage(props) {
			const t = props && typeof props.t === 'function' ? props.t : (key) => key
			const f = React.useMemo(() => makeFmt(t), [t])

			const [snapshot, setSnapshot] = React.useState(null)
			const [error, setError] = React.useState(null)
			const [loading, setLoading] = React.useState(true)
			const [busy, setBusy] = React.useState(false)
			const [updatedAt, setUpdatedAt] = React.useState(null)
			const mounted = React.useRef(true)
			const tip = useTooltip()

			const load = React.useCallback(async (manual) => {
				if (manual) setBusy(true)
				try {
					const response = await fetch(snapshotUrl(manual === true), {
						method: 'GET',
						credentials: 'same-origin',
						cache: 'no-store',
						headers: { accept: 'application/json' },
					})
					if (!response.ok) throw new Error('HTTP ' + response.status)
					const data = await response.json()
					if (!data || typeof data !== 'object') throw new Error('unexpected payload')
					if (data.version !== 1) throw new Error('unsupported snapshot version ' + String(data.version))
					setSnapshot(data)
					// The header reports when the data was built, not when this tab
					// happened to read it.
					setUpdatedAt(typeof data.generatedAt === 'number' ? data.generatedAt : Date.now())
					setError(null)
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause))
				} finally {
					if (mounted.current) {
						setLoading(false)
						setBusy(false)
					}
				}
			}, [])

			React.useEffect(() => {
				mounted.current = true
				void load(false)
				const timer = setInterval(() => {
					// A hidden page costs nothing to keep stale; it refreshes on the
					// next visible tick.
					if (typeof document !== 'undefined' && document.hidden) return
					void load(false)
				}, POLL_MS)
				return () => {
					mounted.current = false
					clearInterval(timer)
				}
			}, [load])

			const onRefresh = React.useCallback(() => {
				void load(true)
			}, [load])

			const warnings = asArray(snapshot && snapshot.warnings).filter((entry) => typeof entry === 'string' && entry !== '')
			const stats = asRecord(snapshot && snapshot.stats)
			const days = asArray(snapshot && snapshot.days)
			const firstDay = parseDay(snapshot && snapshot.firstDay)
			const lastDay = parseDay(snapshot && snapshot.lastDay)
			const spanDays = firstDay !== null && lastDay !== null ? diffDays(firstDay, lastDay) + 1 : 0
			const hasData = snapshot !== null && (asNumber(stats.total) > 0 || days.length > 0)
			const initialLoading = snapshot === null && loading
			const initialFailure = snapshot === null && error !== null
			const updatedText = updatedAt === null ? f.t('never') : f.dateTime(new Date(updatedAt))

			const rangeText = firstDay !== null && lastDay !== null
				? dayKey(firstDay) + ' – ' + dayKey(lastDay)
				: f.t('rangeAll')
			const zoneText = typeof (snapshot && snapshot.timeZone) === 'string' && snapshot.timeZone !== ''
				? snapshot.timeZone
				: '—'
			const daysText = spanDays > 0 ? spanDays + ' ' + f.t('daysUnit') : '—'

			const header = h('header', { className: 'tdb-head' },
				h('div', null,
					h('h1', { className: 'tdb-h1' }, f.t('title')),
					h('p', { className: 'tdb-lede' }, f.t('lede'))),
				h('div', { className: 'tdb-meta' },
					h('span', null, rangeText),
					h('span', { className: 'tdb-sep', 'aria-hidden': 'true' }),
					h('span', null, f.t('timeZone') + ' ' + zoneText),
					h('span', { className: 'tdb-sep', 'aria-hidden': 'true' }),
					h('span', null, daysText),
					h('button', {
						type: 'button',
						className: 'tdb-btn',
						'data-busy': busy ? 'true' : 'false',
						'aria-label': busy ? f.t('refreshing') : f.t('refresh'),
						title: busy ? f.t('refreshing') : f.t('refresh'),
						onClick: onRefresh,
					},
					h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
						h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.75', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
						h('path', { d: 'M13.4 1.9v3.1h-3.1', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })),
					busy ? f.t('refreshing') : f.t('refresh')),
					h('span', null, f.t('lastUpdated') + ' ' + updatedText)),
			)

			const errorBar = error === null || initialFailure ? null : h('div', { className: 'tdb-error', role: 'alert' },
				h('b', null, f.t('errorTitle')),
				h('span', null, error),
				snapshot === null ? null : h('span', null, '· ' + f.t('errorKeep')),
				h('button', { type: 'button', className: 'tdb-btn', onClick: onRefresh }, f.t('retry')),
			)

			let body
			if (initialLoading) {
				body = h('div', { className: 'tdb-loading' },
					h('span', { className: 'tdb-spinner', 'aria-hidden': 'true' }),
					f.t('loading'))
			} else if (initialFailure) {
				// Nothing has ever loaded, so "no usage yet" would be a lie: the panel
				// reports the read failure and offers the only action that helps.
				body = h('section', { className: 'tdb-empty' },
					h('div', null,
						h('h2', null, f.t('errorTitle')),
						h('p', null, error),
						h('button', { type: 'button', className: 'tdb-btn', onClick: onRefresh }, f.t('retry'))))
			} else if (!hasData) {
				body = h('section', { className: 'tdb-empty' },
					h('div', null,
						h('h2', null, f.t('emptyTitle')),
						h('p', null, f.t('emptyHint')),
						h('button', { type: 'button', className: 'tdb-btn', onClick: onRefresh }, f.t('emptyRefresh'))))
			} else {
				body = [
					h(SummaryStats, { key: 'stats', f, snapshot }),
					h(OverviewRail, { key: 'rail', f, snapshot }),
					h(HeatSection, { key: 'heat', f, snapshot, tip }),
					h(ProvidersSection, { key: 'prov', f, snapshot, tip }),
					h(SessionsSection, { key: 'sess', f, snapshot }),
				]
			}

			const footer = h('footer', null,
				warnings.length > 0
					? h('div', { className: 'tdb-warn' },
						h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
							h('path', { d: 'M8 2.4 14.4 13.6H1.6L8 2.4Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
							h('path', { d: 'M8 6.4v3.2M8 11.6v.1', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })),
						h('span', null, f.t('footWarnings') + ' · ' + warnings.join(' · ')))
					: null,
				h('div', { className: 'tdb-foot' },
					h('span', null, f.t('footSource')),
					h('span', null, f.t('footZone') + ' ' + zoneText + ' · ' + f.t('lastUpdated') + ' ' + updatedText)),
			)

			return h('div', { className: 'tdb-root' },
				h('div', { className: 'tdb-scroll' },
					h('div', { className: 'tdb-page' }, header, errorBar, body, footer)),
				h(Tooltip, { tip: tip.tip }),
			)
		}

		/**
		 * Five equal columns: the prototype's overview strip.
		 *
		 * The two token figures keep two decimals ("18.98亿") and carry the exact
		 * count underneath, because a rounded "19亿" hides a hundred million tokens
		 * — the difference a reader is usually looking for on this page.
		 */
		function SummaryStats(props) {
			const f = props.f
			const snapshot = props.snapshot
			const stats = asRecord(snapshot && snapshot.stats)
			const peak = asRecord(stats.peakDay)
			const peakDate = parseDay(peak.day)
			const peakNote = peakDate === null
				? null
				: f.tf('peakDayNote', { d: f.dateFull(peakDate) }) + ' · ' + f.raw(peak.tokens)
			const items = [
				{ key: 'total', value: f.tokExact(stats.total), label: f.t('statTotal'), note: f.raw(stats.total), title: f.raw(stats.total) },
				{ key: 'peak', value: f.tokExact(peak.tokens), label: f.t('statPeak'), note: peakNote, title: peakNote },
				{ key: 'turn', value: f.dur(stats.longestTurnMs), label: f.t('statLongestTurn'), note: null, title: null },
				{ key: 'longest', value: f.tf('dayWord', { n: f.int(stats.longestStreak) }), label: f.t('statLongestStreak'), note: null, title: null },
				{ key: 'current', value: f.tf('dayWord', { n: f.int(stats.currentStreak) }), label: f.t('statCurrentStreak'), note: null, title: null },
			]
			return h('section', { className: 'tdb-stats', 'aria-label': f.t('overviewAria') },
				items.map((item) => h('div', { className: 'tdb-stat', key: item.key },
					h('span', {
						className: 'tdb-stat-v tdb-num',
						title: item.title === null ? undefined : item.title,
					}, item.value),
					h('span', { className: 'tdb-stat-l' }, item.label),
					item.note === null ? null : h('span', { className: 'tdb-stat-note tdb-num' }, item.note))))
		}

		// ── heatmap ─────────────────────────────────────────────────────────
		/** Last 365 local days, with each day's total and the weekly roll-up. */
		function buildHeatModel(snapshot) {
			const anchor = parseDay(snapshot && snapshot.today) || startOfDay(new Date())
			const start = addDays(anchor, -364)
			const totals = new Map()
			for (const row of asArray(snapshot && snapshot.days)) {
				if (row && typeof row.day === 'string') totals.set(row.day, asNumber(row.total))
			}

			const cells = []
			for (let index = 0; index < 365; index++) {
				const date = addDays(start, index)
				const key = dayKey(date)
				cells.push({ date, key, tokens: totals.get(key) || 0 })
			}

			const offset = (start.getDay() + 6) % 7
			const cols = Math.ceil((offset + cells.length) / 7)
			const weekSums = new Map()
			const weekStarts = new Map()
			const weekEnds = new Map()
			const cumulative = []
			let total = 0
			for (let index = 0; index < cells.length; index++) {
				const cell = cells[index]
				const col = Math.floor((offset + index) / 7)
				weekSums.set(col, (weekSums.get(col) || 0) + cell.tokens)
				if (!weekStarts.has(col)) weekStarts.set(col, cell.date)
				weekEnds.set(col, cell.date)
				total += cell.tokens
				cumulative.push(total)
			}
			return { cells, offset, cols, weekSums, weekStarts, weekEnds, cumulative, total, start, anchor }
		}

		function quantile(sorted, fraction) {
			if (!sorted.length) return 0
			return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
		}

		/** Four intensity levels, using the prototype's quantile splits. */
		function buildHeatLevels(model, mode) {
			const levels = new Array(model.cells.length).fill(0)
			if (mode === 'weekly') {
				const values = Array.from(model.weekSums.values()).filter((value) => value > 0).sort((a, b) => a - b)
				const t1 = quantile(values, 0.35)
				const t2 = quantile(values, 0.62)
				const t3 = quantile(values, 0.85)
				model.cells.forEach((cell, index) => {
					const col = Math.floor((model.offset + index) / 7)
					const value = model.weekSums.get(col) || 0
					if (!value) return
					let level = 1
					if (value > t1) level++
					if (value > t2) level++
					if (value > t3) level++
					levels[index] = Math.min(4, level)
				})
				return levels
			}
			if (mode === 'cumulative') {
				model.cells.forEach((cell, index) => {
					const value = model.cumulative[index]
					if (!value || !model.total) return
					const ratio = value / model.total
					let level = 1
					if (ratio > 0.2) level++
					if (ratio > 0.5) level++
					if (ratio > 0.78) level++
					levels[index] = Math.min(4, level)
				})
				return levels
			}
			const values = model.cells.filter((cell) => cell.tokens > 0).map((cell) => cell.tokens).sort((a, b) => a - b)
			const t1 = quantile(values, 0.35)
			const t2 = quantile(values, 0.62)
			const t3 = quantile(values, 0.85)
			model.cells.forEach((cell, index) => {
				if (!cell.tokens) return
				let level = 1
				if (cell.tokens > t1) level++
				if (cell.tokens > t2) level++
				if (cell.tokens > t3) level++
				levels[index] = Math.min(4, level)
			})
			return levels
		}

		/** Share text: tiny shares keep three decimals so they are not shown as 0%. */
		function shareText(share) {
			if (!(share > 0)) return '0%'
			if (share < 0.001) return share.toFixed(3) + '%'
			if (share < 0.1) return share.toFixed(2) + '%'
			return share.toFixed(1) + '%'
		}

		function heatTip(model, mode, index, f) {
			const cell = model.cells[index]
			if (!cell) return null
			if (mode === 'daily') {
				const title = cell.key + ' ' + f.weekday(cell.date)
				if (!cell.tokens) return { title, main: f.t('noRecord'), rows: [] }
				const share = model.total > 0 ? (cell.tokens / model.total) * 100 : 0
				return {
					title,
					main: f.tok(cell.tokens) + ' ' + f.t('tokens'),
					rows: [{ label: f.t('shareOfAll'), value: shareText(share) }],
				}
			}
			const col = Math.floor((model.offset + index) / 7)
			if (mode === 'weekly') {
				const from = model.weekStarts.get(col)
				const to = model.weekEnds.get(col)
				const sum = model.weekSums.get(col) || 0
				const title = from && to && from.getTime() === to.getTime()
					? f.dateFull(from)
					: f.dateFull(from) + ' – ' + f.dateFull(to)
				return {
					title,
					main: f.tok(sum) + ' ' + f.t('tokens'),
					rows: [{ label: f.t('weekTotal'), value: shareText(model.total > 0 ? (sum / model.total) * 100 : 0) }],
				}
			}
			const cumulative = model.cumulative[index] || 0
			return {
				title: f.t('until') + ' ' + f.dateFull(cell.date),
				main: f.t('cumulative') + ' ' + f.tok(cumulative) + ' ' + f.t('tokens'),
				rows: [{ label: f.t('completion'), value: shareText(model.total > 0 ? (cumulative / model.total) * 100 : 0) }],
			}
		}

		function HeatSection(props) {
			const f = props.f
			const snapshot = props.snapshot
			const tip = props.tip
			const [mode, setMode] = React.useState('daily')
			const scroller = React.useRef(null)

			const model = React.useMemo(() => buildHeatModel(snapshot), [snapshot])
			const levels = React.useMemo(() => buildHeatLevels(model, mode), [model, mode])

			// The interesting end of a year of cells is the right edge.
			React.useEffect(() => {
				const node = scroller.current
				if (node && typeof node.scrollWidth === 'number') node.scrollLeft = node.scrollWidth
			}, [model, mode])

			const activeCount = model.cells.reduce((count, cell) => (cell.tokens > 0 ? count + 1 : count), 0)

			const modes = [
				{ id: 'daily', label: f.t('heatDaily') },
				{ id: 'weekly', label: f.t('heatWeekly') },
				{ id: 'cumulative', label: f.t('heatCumulative') },
			]
			const modeLabel = mode === 'weekly' ? f.t('heatWeekly') : mode === 'cumulative' ? f.t('heatCumulative') : f.t('heatDaily')

			const labels = []
			let lastMonth = -1
			model.cells.forEach((cell, index) => {
				const month = cell.date.getMonth()
				const isStartMonth = cell.date.getFullYear() === model.start.getFullYear() && month === model.start.getMonth()
				if (month !== lastMonth && !isStartMonth) {
					const col = Math.floor((model.offset + index) / 7)
					labels.push(h('span', {
						className: 'tdb-heat-month',
						key: 'm' + cell.key,
						style: { gridColumn: String(col + 1) },
					}, f.monthLabel(month)))
				}
				lastMonth = month
			})

			const grid = h('div', {
				className: 'tdb-heat-grid',
				role: 'img',
				'aria-label': f.tf('heatModes', { m: modeLabel }) + ' · ' + f.tf('heatAriaDays', { n: f.int(activeCount) }),
				style: { '--tdb-cols': String(model.cols) },
				onPointerMove: (event) => {
					const hit = closestAttr(event.target, 'data-i', 3)
					if (hit === null) {
						tip.hide()
						return
					}
					const data = heatTip(model, mode, Number(hit.value), f)
					if (data !== null) tip.show(event, data)
				},
				onPointerLeave: () => tip.hide(),
			},
			model.cells.map((cell, index) => {
				const col = Math.floor((model.offset + index) / 7)
				const row = ((model.offset + index) % 7) + 1
				return h('span', {
					className: 'tdb-hcell',
					key: 'c' + cell.key,
					'data-level': String(levels[index]),
					'data-i': String(index),
					'aria-hidden': 'true',
					style: { gridColumn: String(col + 1), gridRow: String(row) },
				})
			}),
			labels)

			return h('section', { className: 'tdb-section', 'aria-labelledby': 'tdb-heat-title' },
				h('div', { className: 'tdb-sec-head' },
					h('div', null,
						h('h2', { className: 'tdb-sec-title', id: 'tdb-heat-title' }, f.t('heatTitle')),
						h('p', { className: 'tdb-sec-sub' }, f.t('heatSub'))),
					h('div', { className: 'tdb-seg', role: 'group', 'aria-label': f.t('heatAria') },
						modes.map((entry) => h('button', {
							type: 'button',
							key: entry.id,
							'aria-pressed': mode === entry.id ? 'true' : 'false',
							onClick: () => setMode(entry.id),
						}, entry.label)))),
				h('div', { className: 'tdb-heat-body' },
					h('div', { className: 'tdb-heat-scroll', ref: scroller }, grid)))
		}

		/**
		 * The four summary figures that justify the heatmap, rendered directly
		 * under the overview card. They used to sit in a rail beside the grid, but
		 * the grid is only seven rows tall: the rail was far taller than the cells
		 * and left a dead column down the page. The figures now use the space under
		 * the card, and the grid gets the full page width, centred.
		 */
		function OverviewRail(props) {
			const f = props.f
			const snapshot = props.snapshot
			const model = React.useMemo(() => buildHeatModel(snapshot), [snapshot])

			const activeCount = model.cells.reduce((count, cell) => (cell.tokens > 0 ? count + 1 : count), 0)
			let peakCell = null
			for (const cell of model.cells) {
				if (peakCell === null || cell.tokens > peakCell.tokens) peakCell = cell
			}
			const last30 = model.cells.slice(-30).reduce((sum, cell) => sum + cell.tokens, 0)

			return h('aside', { className: 'tdb-overview-rail', 'aria-label': f.t('heatAria') },
				h('div', null,
					h('div', { className: 'tdb-rail-k' }, f.t('railActive')),
					h('div', { className: 'tdb-rail-v' }, f.tf('dayWord', { n: f.int(activeCount) })),
					h('div', { className: 'tdb-rail-note' }, f.t('railActiveNote'))),
				h('div', null,
					h('div', { className: 'tdb-rail-k' }, f.t('railPeak')),
					h('div', { className: 'tdb-rail-v' }, f.tok(peakCell === null ? 0 : peakCell.tokens)),
					h('div', { className: 'tdb-rail-note' }, peakCell === null ? '—' : f.dateFull(peakCell.date) + ' · ' + f.weekday(peakCell.date))),
				h('div', null,
					h('div', { className: 'tdb-rail-k' }, f.t('rail30')),
					h('div', { className: 'tdb-rail-v' }, f.tok(last30)),
					h('div', { className: 'tdb-rail-note' }, f.t('rail30Note'))),
				h('div', { className: 'tdb-heat-legend', 'aria-label': f.t('heatSub') },
					h('span', null, f.t('legendLess')),
					h('span', { className: 'tdb-heat-legend-cells', 'aria-hidden': 'true' },
						[0, 1, 2, 3, 4].map((level) => h('i', {
							key: 'lv' + level,
							style: { background: 'var(--tdb-heat' + level + ')' },
						}))),
					h('span', null, f.t('legendMore'))))
		}

		// ── providers ───────────────────────────────────────────────────────
		/**
		 * Provider rows in a stable order: the host already sorts by total, and ids
		 * that only appear inside day rows are appended so nothing silently drops
		 * out of a chart.
		 */
		function buildProviders(snapshot) {
			const list = []
			const seen = new Set()
			for (const row of asArray(snapshot && snapshot.providers)) {
				if (!row || typeof row.id !== 'string' || row.id === '' || seen.has(row.id)) continue
				seen.add(row.id)
				list.push({
					id: row.id,
					name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id,
					configured: row.configured === true,
					total: asNumber(row.total),
				})
			}
			const extras = new Set()
			for (const row of asArray(snapshot && snapshot.days)) {
				const map = asRecord(row && row.providers)
				for (const id of Object.keys(map)) if (!seen.has(id)) extras.add(id)
			}
			const hours = asRecord(snapshot && snapshot.todayHours)
			for (const id of Object.keys(hours)) if (!seen.has(id)) extras.add(id)
			for (const id of extras) {
				seen.add(id)
				list.push({ id, name: id, configured: false, total: 0 })
			}
			return list
		}

		function niceCeil(value) {
			if (!(value > 0)) return 1
			const power = Math.pow(10, Math.floor(Math.log10(value)))
			const normalized = value / power
			const step = normalized <= 1 ? 1
				: normalized <= 1.5 ? 1.5
					: normalized <= 2 ? 2
						: normalized <= 3 ? 3
							: normalized <= 4 ? 4
								: normalized <= 5 ? 5
									: normalized <= 6 ? 6
										: normalized <= 8 ? 8
											: 10
			return step * power
		}

		/** Buckets for the channel chart: 24 hours, N days, or Monday-start weeks. */
		function buildBuckets(snapshot, providers, range) {
			const today = parseDay(snapshot && snapshot.today) || startOfDay(new Date())
			const rows = new Map()
			for (const row of asArray(snapshot && snapshot.days)) {
				if (row && typeof row.day === 'string') rows.set(row.day, row)
			}
			const valuesFor = (row) => asRecord(row && row.providers)

			if (range === 'today') {
				const hours = asRecord(snapshot && snapshot.todayHours)
				const hasHours = Object.keys(hours).length > 0
				if (!hasHours) {
					// Degrade to the single bucket the day row can answer, instead of
					// drawing twenty-four zeroes.
					const map = valuesFor(rows.get(dayKey(today)))
					const values = {}
					let total = 0
					for (const provider of providers) {
						const value = asNumber(map[provider.id])
						values[provider.id] = value
						total += value
					}
					return {
						buckets: [{ key: dayKey(today), start: today, end: today, values, total, unit: 'day' }],
						dayCount: 1,
						unit: 'day',
						from: today,
						to: today,
						weekly: false,
					}
				}
				const buckets = []
				for (let hour = 0; hour < 24; hour++) {
					const values = {}
					let total = 0
					for (const provider of providers) {
						const series = hours[provider.id]
						const value = Array.isArray(series) ? asNumber(series[hour]) : 0
						values[provider.id] = value
						total += value
					}
					buckets.push({ key: 'h' + hour, start: today, end: today, values, total, unit: 'hour', hour })
				}
				return { buckets, dayCount: 1, unit: 'hour', from: today, to: today, weekly: false }
			}

			if (range === '7' || range === '30') {
				const length = range === '7' ? 7 : 30
				const from = addDays(today, -(length - 1))
				const buckets = []
				for (let index = 0; index < length; index++) {
					const date = addDays(from, index)
					const map = valuesFor(rows.get(dayKey(date)))
					const values = {}
					let total = 0
					for (const provider of providers) {
						const value = asNumber(map[provider.id])
						values[provider.id] = value
						total += value
					}
					buckets.push({ key: dayKey(date), start: date, end: date, values, total, unit: 'day' })
				}
				return { buckets, dayCount: length, unit: 'day', from, to: today, weekly: false }
			}

			const first = parseDay(snapshot && snapshot.firstDay)
			const from = first === null ? today : first
			const span = diffDays(from, today) + 1
			const weekly = span > 90
			const buckets = []
			if (weekly) {
				let current = null
				for (let index = 0; index < span; index++) {
					const date = addDays(from, index)
					const mondayIndex = (date.getDay() + 6) % 7
					if (current === null || mondayIndex === 0) {
						current = { key: dayKey(date), start: date, end: date, values: {}, total: 0, unit: 'week' }
						for (const provider of providers) current.values[provider.id] = 0
						buckets.push(current)
					}
					current.end = date
					const map = valuesFor(rows.get(dayKey(date)))
					for (const provider of providers) {
						const value = asNumber(map[provider.id])
						current.values[provider.id] += value
						current.total += value
					}
				}
			} else {
				for (let index = 0; index < span; index++) {
					const date = addDays(from, index)
					const map = valuesFor(rows.get(dayKey(date)))
					const values = {}
					let total = 0
					for (const provider of providers) {
						const value = asNumber(map[provider.id])
						values[provider.id] = value
						total += value
					}
					buckets.push({ key: dayKey(date), start: date, end: date, values, total, unit: 'day' })
				}
			}
			return { buckets, dayCount: span, unit: weekly ? 'week' : 'day', from, to: today, weekly }
		}

		/** Per-provider totals and per-day peaks for the table. */
		function providerTableStats(snapshot, providers, from, to, unit) {
			const totals = new Map()
			const peaks = new Map()
			for (const provider of providers) {
				totals.set(provider.id, 0)
				peaks.set(provider.id, 0)
			}

			if (unit === 'hour' && dayKey(from) === dayKey(to)) {
				let any = false
				for (const row of asArray(snapshot && snapshot.days)) {
					if (!row || row.day !== dayKey(from)) continue
					const map = asRecord(row.providers)
					for (const provider of providers) {
						const value = asNumber(map[provider.id])
						totals.set(provider.id, value)
						peaks.set(provider.id, value)
						if (value > 0) any = true
					}
				}
				if (!any) {
					const hours = asRecord(snapshot && snapshot.todayHours)
					for (const provider of providers) {
						let sum = 0
						for (const value of asArray(hours[provider.id])) sum += asNumber(value)
						totals.set(provider.id, sum)
						peaks.set(provider.id, sum)
					}
				}
				return { totals, peaks }
			}

			const fromKey = dayKey(from)
			const toKey = dayKey(to)
			for (const row of asArray(snapshot && snapshot.days)) {
				if (!row || typeof row.day !== 'string' || row.day < fromKey || row.day > toKey) continue
				const map = asRecord(row.providers)
				for (const provider of providers) {
					const value = asNumber(map[provider.id])
					totals.set(provider.id, (totals.get(provider.id) || 0) + value)
					if (value > (peaks.get(provider.id) || 0)) peaks.set(provider.id, value)
				}
			}
			return { totals, peaks }
		}

		/** Six evenly spaced x labels; the first and last anchor to the plot edges. */
		function xTickIndexes(count) {
			const target = Math.min(6, count)
			const indexes = []
			for (let step = 0; step < target; step++) {
				const index = Math.round((step * (count - 1)) / Math.max(1, target - 1))
				if (indexes.indexOf(index) === -1) indexes.push(index)
			}
			return indexes
		}

		function bucketTooltip(bucket, visible, f) {
			if (!bucket) return null
			const title = bucket.unit === 'hour'
				? f.dateFull(bucket.start) + ' ' + pad2(bucket.hour) + ':00'
				: bucket.start.getTime() === bucket.end.getTime()
					? f.dateFull(bucket.start) + ' ' + f.weekday(bucket.start)
					: f.dateFull(bucket.start) + ' – ' + f.dateFull(bucket.end)
			let total = 0
			const rows = []
			for (const entry of visible) {
				const value = asNumber(bucket.values[entry.provider.id])
				total += value
				rows.push({ color: seriesColor(entry.index), label: entry.provider.name, value: f.tok(value) })
			}
			return { title, main: f.tok(total) + ' ' + f.t('tokens'), rows }
		}

		function ProvidersSection(props) {
			const f = props.f
			const snapshot = props.snapshot
			const tip = props.tip
			const [range, setRange] = React.useState('30')
			const [hidden, setHidden] = React.useState([])

			const providers = React.useMemo(() => buildProviders(snapshot), [snapshot])
			const visibleIds = React.useMemo(() => {
				const all = providers.map((provider) => provider.id)
				if (!hidden.length) return all
				const kept = all.filter((id) => hidden.indexOf(id) === -1)
				return kept.length ? kept : all
			}, [providers, hidden])

			const model = React.useMemo(() => buildBuckets(snapshot, providers, range), [snapshot, providers, range])
			const table = React.useMemo(
				() => providerTableStats(snapshot, providers, model.from, model.to, model.unit),
				[snapshot, providers, model],
			)

			const visible = providers
				.map((provider, index) => ({ provider, index }))
				.filter((entry) => visibleIds.indexOf(entry.provider.id) !== -1)

			const buckets = model.buckets
			const maxTotal = buckets.reduce((max, bucket) => {
				let sum = 0
				for (const entry of visible) sum += asNumber(bucket.values[entry.provider.id])
				return Math.max(max, sum)
			}, 0)
			const axisMax = niceCeil(maxTotal * 1.06)

			const ticks = [0, 0.25, 0.5, 0.75, 1]
			const gridlines = ticks.filter((tick) => tick > 0).map((tick) => h('div', {
				className: 'tdb-gridline',
				key: 'g' + tick,
				style: { bottom: tick * 100 + '%' },
			}))

			const yAxis = ticks.map((tick) => h('span', {
				key: 'y' + tick,
				style: { bottom: tick * 100 + '%' },
			}, f.tok(axisMax * tick)))

			const barGap = buckets.length <= 10 ? '12px' : buckets.length <= 40 ? '4px' : '3px'
			const bars = h('div', {
				className: 'tdb-bars',
				'data-sparse': buckets.length <= 10 ? 'true' : 'false',
				style: { gap: barGap },
				onPointerMove: (event) => {
					const hit = closestAttr(event.target, 'data-b', 4)
					if (hit === null) {
						tip.hide()
						return
					}
					const data = bucketTooltip(buckets[Number(hit.value)], visible, f)
					if (data !== null) tip.show(event, data)
				},
				onPointerLeave: () => tip.hide(),
			}, buckets.map((bucket, bucketIndex) => h('div', {
				className: 'tdb-bar',
				key: bucket.key,
				'data-b': String(bucketIndex),
			}, visible.map((entry) => {
				const value = asNumber(bucket.values[entry.provider.id])
				if (value <= 0) return null
				return h('i', {
					key: entry.provider.id,
					style: { height: (value / axisMax) * 100 + '%', background: seriesColor(entry.index) },
				})
			}))))

			const xLabels = []
			if (model.unit === 'hour' && buckets.length === 24) {
				for (const hour of [0, 4, 8, 12, 16, 20, 23]) {
					xLabels.push(h('span', {
						key: 'x' + hour,
						style: {
							left: (hour + 0.5) / buckets.length * 100 + '%',
							transform: hour === 0 ? 'translateX(0)' : hour === 23 ? 'translateX(-100%)' : 'translateX(-50%)',
						},
					}, pad2(hour) + ':00'))
				}
			} else {
				const indexes = xTickIndexes(buckets.length)
				indexes.forEach((index, order) => {
					const first = order === 0
					const last = order === indexes.length - 1
					xLabels.push(h('span', {
						key: 'x' + buckets[index].key,
						style: {
							left: first ? '0%' : last ? '100%' : ((index + 0.5) / buckets.length) * 100 + '%',
							transform: first ? 'translateX(0)' : last ? 'translateX(-100%)' : 'translateX(-50%)',
						},
					}, f.md(buckets[index].start)))
				})
			}

			const grand = providers.reduce((sum, provider) => sum + (table.totals.get(provider.id) || 0), 0)
			const rows = providers.map((provider, index) => {
				const total = table.totals.get(provider.id) || 0
				const peak = table.peaks.get(provider.id) || 0
				const share = grand > 0 ? (total / grand) * 100 : 0
				const average = model.dayCount > 0 ? total / model.dayCount : 0
				const unused = total === 0 && provider.total === 0
				return h('tr', { key: provider.id },
					h('td', null,
						h('span', { className: 'tdb-pname' },
							h('span', { className: 'tdb-dot', style: { background: seriesColor(index) } }),
							h('span', null, provider.name),
							unused ? h('span', { className: 'tdb-unused' }, f.t('unused')) : null)),
					h('td', { className: 'num' }, f.tok(total)),
					h('td', { className: 'num hide-sm' }, f.tok(average)),
					h('td', { className: 'num hide-sm' }, f.tok(peak)),
					h('td', { className: 'tdb-share-cell' },
						h('span', { className: 'tdb-share-track' },
							h('span', {
								className: 'tdb-share-fill',
								style: { width: Math.min(100, share) + '%', background: seriesColor(index) },
							})),
						h('span', { className: 'tdb-share-pct' }, pct(total, grand) + '%')))
			})

			const modeLabel = model.unit === 'hour'
				? f.t('provSubHourly')
				: model.weekly
					? f.t('provSubWeekly')
					: f.t('provSubDaily')
			const subText = f.tf('provRange', {
				mode: modeLabel,
				from: dayKey(model.from),
				to: dayKey(model.to),
			})
			const rangeTotal = providers.reduce((sum, provider) => sum + (table.totals.get(provider.id) || 0), 0)

			const toggleProvider = (id) => {
				if (visibleIds.indexOf(id) !== -1) {
					if (visibleIds.length <= 1) return
					setHidden(hidden.concat([id]))
				} else {
					setHidden(hidden.filter((entry) => entry !== id))
				}
			}

			const ranges = [
				{ id: 'today', label: f.t('rToday') },
				{ id: '7', label: f.t('r7') },
				{ id: '30', label: f.t('r30') },
				{ id: 'all', label: f.t('rAll') },
			]

			return h('section', { className: 'tdb-section', 'aria-labelledby': 'tdb-prov-title' },
				h('div', { className: 'tdb-sec-head' },
					h('div', null,
						h('h2', { className: 'tdb-sec-title', id: 'tdb-prov-title' }, f.t('provTitle')),
						h('p', { className: 'tdb-sec-sub' }, subText)),
					h('div', { className: 'tdb-seg', role: 'group', 'aria-label': f.t('provTitle') },
						ranges.map((entry) => h('button', {
							type: 'button',
							key: entry.id,
							'aria-pressed': range === entry.id ? 'true' : 'false',
							onClick: () => setRange(entry.id),
						}, entry.label)))),
				h('div', { className: 'tdb-legend-row', role: 'group', 'aria-label': f.t('legendAria') },
					providers.map((provider, index) => h('button', {
						type: 'button',
						key: provider.id,
						className: 'tdb-lg',
						'aria-pressed': visibleIds.indexOf(provider.id) !== -1 ? 'true' : 'false',
						onClick: () => toggleProvider(provider.id),
					},
					h('span', { className: 'tdb-dot', style: { background: seriesColor(index) } }),
					provider.name))),
				h('div', {
					className: 'tdb-chart',
					role: 'img',
					'aria-label': f.t('provAria') + ' · ' + subText + ' · ' + f.tok(rangeTotal) + ' ' + f.t('tokens'),
				},
				h('div', { className: 'tdb-chart-y', 'aria-hidden': 'true' }, yAxis),
				h('div', { className: 'tdb-chart-main' },
					h('div', { className: 'tdb-chart-plot' },
						h('div', { className: 'tdb-chart-lines', 'aria-hidden': 'true' }, gridlines),
						bars),
					h('div', { className: 'tdb-chart-x', 'aria-hidden': 'true' }, xLabels))),
				h('table', { className: 'tdb-table' },
					h('thead', null, h('tr', null,
						h('th', { scope: 'col' }, f.t('colChannel')),
						h('th', { scope: 'col', className: 'num' }, f.t('colUsage')),
						h('th', { scope: 'col', className: 'num hide-sm' }, f.t('colAvg')),
						h('th', { scope: 'col', className: 'num hide-sm' }, f.t('colPeak')),
						h('th', { scope: 'col', className: 'tdb-share-col' }, f.t('colShare')))),
					h('tbody', null, rows)))
		}

		// ── sessions ────────────────────────────────────────────────────────
		/** Token usage of each session inside the selected window. */
		function buildSessionRows(snapshot, range) {
			const today = parseDay(snapshot && snapshot.today) || startOfDay(new Date())
			const length = range === 'today' ? 1 : range === '7' ? 7 : range === '30' ? 30 : 0
			const keys = []
			if (length > 0) {
				for (let index = 0; index < length; index++) keys.push(dayKey(addDays(today, -index)))
			}
			return asArray(snapshot && snapshot.sessions).map((session) => {
				const byDay = asRecord(session && session.byDay)
				let tokens
				if (range === 'all') {
					tokens = asNumber(session && session.total)
					if (tokens === 0) {
						for (const day of Object.keys(byDay)) tokens += asNumber(byDay[day])
					}
				} else {
					tokens = 0
					for (const key of keys) tokens += asNumber(byDay[key])
				}
				return { session: session || {}, tokens, today }
			})
		}

		function sessionTitle(session, f) {
			const raw = typeof session.title === 'string' ? session.title.trim() : ''
			if (raw === '' || raw === '未命名会话' || raw === 'Untitled session') return f.t('untitled')
			return raw
		}

		function lastActiveText(lastAt, today, f) {
			const value = asNumber(lastAt)
			if (value <= 0) return '—'
			const date = new Date(value)
			if (!Number.isFinite(date.getTime())) return '—'
			const clock = pad2(date.getHours()) + ':' + pad2(date.getMinutes())
			if (dayKey(date) === dayKey(today)) return f.t('today') + ' ' + clock
			if (dayKey(date) === dayKey(addDays(today, -1))) return f.t('yesterday') + ' ' + clock
			return f.dateFull(date)
		}

		function SessionsSection(props) {
			const f = props.f
			const snapshot = props.snapshot
			const [range, setRange] = React.useState('30')
			const [status, setStatus] = React.useState('all')
			const [query, setQuery] = React.useState('')
			const [sortKey, setSortKey] = React.useState('tokens')
			const [sortDir, setSortDir] = React.useState('desc')

			const providerMeta = React.useMemo(() => {
				const map = new Map()
				buildProviders(snapshot).forEach((provider, index) => map.set(provider.id, { provider, index }))
				return map
			}, [snapshot])

			const rows = React.useMemo(() => buildSessionRows(snapshot, range), [snapshot, range])
			const today = parseDay(snapshot && snapshot.today) || startOfDay(new Date())

			const providerName = (id) => {
				const meta = providerMeta.get(id)
				return meta === undefined ? id : meta.provider.name
			}

			const counts = { all: 0, active: 0, archived: 0, deleted: 0 }
			for (const row of rows) {
				if (row.tokens <= 0) continue
				counts.all++
				const key = row.session.status
				if (key === 'active' || key === 'archived' || key === 'deleted') counts[key]++
			}

			const needle = query.trim().toLowerCase()
			const filtered = rows.filter((row) => {
				// A session with nothing in the selected window has no row to show, and
				// keeping it would make the list longer than the status chip above it.
				if (row.tokens <= 0) return false
				if (status !== 'all' && row.session.status !== status) return false
				if (needle === '') return true
				const title = sessionTitle(row.session, f).toLowerCase()
				const id = String(row.session.id || '').toLowerCase()
				const ids = asArray(row.session.providers).map((entry) => String(entry).toLowerCase())
				const names = ids.map((entry) => providerName(entry).toLowerCase())
				if (title.indexOf(needle) !== -1) return true
				if (id.indexOf(needle) !== -1) return true
				for (const entry of ids) if (entry.indexOf(needle) !== -1) return true
				for (const entry of names) if (entry.indexOf(needle) !== -1) return true
				return false
			})

			const listed = filtered.slice().sort((left, right) => {
				const a = sortKey === 'last' ? asNumber(left.session.lastAt) : left.tokens
				const b = sortKey === 'last' ? asNumber(right.session.lastAt) : right.tokens
				if (a === b) return asNumber(right.session.total) - asNumber(left.session.total)
				return sortDir === 'asc' ? a - b : b - a
			})

			const maxTokens = listed.reduce((max, row) => Math.max(max, row.tokens), 0)
			const toggleSort = (key) => {
				if (sortKey === key) {
					setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
				} else {
					setSortKey(key)
					setSortDir('desc')
				}
			}
			const sortState = (key) => {
				if (sortKey !== key) return 'none'
				return sortDir === 'desc' ? 'descending' : 'ascending'
			}

			const totalSessions = asArray(snapshot && snapshot.sessions).length
			const archivedCount = asArray(snapshot && snapshot.sessions)
				.filter((session) => session && session.status === 'archived').length
			const mergedSubagents = asArray(snapshot && snapshot.sessions)
				.reduce((sum, session) => sum + asNumber(session && session.subagentCount), 0)

			const statusFilters = [
				{ id: 'all', label: f.t('fAll'), count: counts.all },
				{ id: 'active', label: f.t('fActive'), count: counts.active },
				{ id: 'archived', label: f.t('fArchived'), count: counts.archived },
				{ id: 'deleted', label: f.t('fDeleted'), count: counts.deleted },
			]
			const ranges = [
				{ id: 'today', label: f.t('rToday') },
				{ id: '7', label: f.t('r7') },
				{ id: '30', label: f.t('r30') },
				{ id: 'all', label: f.t('rAll') },
			]

			const chevron = h('svg', { width: 11, height: 11, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
				h('path', { d: 'M4 6.5 8 10.5l4-4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))

			const rowNodes = listed.map((row) => {
				const session = row.session
				const providerIds = asArray(session.providers).filter((entry) => typeof entry === 'string' && entry !== '')
				const primaryId = typeof session.provider === 'string' && session.provider !== ''
					? session.provider
					: providerIds.length > 0 ? providerIds[0] : null
				const meta = primaryId === null ? undefined : providerMeta.get(primaryId)
				const extra = Math.max(0, providerIds.length - 1)
				const statusKey = session.status === 'archived' || session.status === 'deleted' ? session.status : 'active'
				const statusLabel = statusKey === 'archived' ? f.t('statusArchived') : statusKey === 'deleted' ? f.t('statusDeleted') : f.t('statusActive')
				const subagents = asNumber(session.subagentCount)
				const barWidth = maxTokens > 0 ? Math.max(1.5, (row.tokens / maxTokens) * 100) : 0
				return h('div', { className: 'tdb-sess-row', role: 'row', key: session.id },
					h('div', { className: 'tdb-c-session', role: 'cell' },
						h('span', { className: 'tdb-sess-name', title: sessionTitle(session, f) }, sessionTitle(session, f)),
						h('span', { className: 'tdb-sess-id' }, String(session.id || '—')),
						subagents > 0
							? h('span', { className: 'tdb-sess-id' }, f.tf('subagentsMerged', { n: f.int(subagents) }))
							: null),
					h('div', { className: 'tdb-c-status', role: 'cell' },
						h('span', { className: 'tdb-badge', 'data-status': statusKey },
							h('span', { className: 'tdb-bdot', 'aria-hidden': 'true' }),
							statusLabel),
						session.orphan === true
							? h('span', { className: 'tdb-badge', 'data-status': 'orphan' }, f.t('orphan'))
							: null),
					h('div', { className: 'tdb-c-prov', role: 'cell' },
						h('span', { className: 'tdb-p-mini' },
							primaryId === null
								? null
								: h('span', {
									className: 'tdb-dot',
									style: { background: seriesColor(meta === undefined ? 0 : meta.index) },
								}),
							primaryId === null ? '—' : providerName(primaryId),
							extra > 0 ? h('span', { className: 'tdb-more' }, f.tf('providerMore', { n: f.int(extra) })) : null)),
					h('div', { className: 'tdb-c-msgs', role: 'cell' }, f.int(session.messages)),
					h('div', { className: 'tdb-c-tokens', role: 'cell' },
						h('span', { className: 'tdb-tok-cap' }, f.t('colTokens')),
						h('span', { className: 'tdb-tok-value' }, f.tok(row.tokens)),
						h('span', { className: 'tdb-tok-bar', 'aria-hidden': 'true' },
							h('i', { style: { width: barWidth + '%' } }))),
					h('div', { className: 'tdb-c-last', role: 'cell' }, lastActiveText(session.lastAt, today, f)))
			})

			return h('section', { className: 'tdb-section', 'aria-labelledby': 'tdb-sess-title' },
				h('div', { className: 'tdb-sec-head' },
					h('div', null,
						h('h2', { className: 'tdb-sec-title', id: 'tdb-sess-title' }, f.t('sessTitle')),
						h('p', { className: 'tdb-sec-sub' }, f.t('sessSub'))),
					h('div', { className: 'tdb-tools tdb-sec-tools' },
						h('div', { className: 'tdb-seg', role: 'group', 'aria-label': f.t('sessTitle') },
							ranges.map((entry) => h('button', {
								type: 'button',
								key: entry.id,
								'aria-pressed': range === entry.id ? 'true' : 'false',
								onClick: () => setRange(entry.id),
							}, entry.label))),
						h('div', { className: 'tdb-seg', role: 'group', 'aria-label': f.t('statusAria') },
							statusFilters.map((entry) => h('button', {
								type: 'button',
								key: entry.id,
								'aria-pressed': status === entry.id ? 'true' : 'false',
								onClick: () => setStatus(entry.id),
							},
							entry.label,
							h('span', { className: 'tdb-fcount' }, f.int(entry.count))))),
						h('label', { className: 'tdb-search' },
							h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
								h('circle', { cx: 7, cy: 7, r: 4.5, stroke: 'currentColor', strokeWidth: 1.4 }),
								h('path', { d: 'm10.6 10.6 3 3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })),
							h('input', {
								type: 'search',
								value: query,
								placeholder: f.t('searchPlaceholder'),
								'aria-label': f.t('searchAria'),
								onChange: (event) => setQuery(event && event.target ? event.target.value : ''),
							})))),
				h('div', { className: 'tdb-sess', role: 'table', 'aria-label': f.t('sessTitle') },
					h('div', { className: 'tdb-sess-head', role: 'row' },
						h('div', { role: 'columnheader' }, f.t('colSession')),
						h('div', { role: 'columnheader' }, f.t('colStatus')),
						h('div', { role: 'columnheader' }, f.t('colProvider')),
						h('div', { role: 'columnheader', className: 'tdb-sess-col-num' }, f.t('colMessages')),
						h('div', { role: 'columnheader', 'aria-sort': sortState('tokens') },
							h('button', {
								type: 'button',
								className: 'tdb-th-btn',
								'aria-label': f.t('sortAria') + ': ' + f.t('colTokens'),
								onClick: () => toggleSort('tokens'),
							}, f.t('colTokens'), chevron)),
						h('div', { role: 'columnheader', className: 'tdb-sess-col-num', 'aria-sort': sortState('last') },
							h('button', {
								type: 'button',
								className: 'tdb-th-btn',
								'aria-label': f.t('sortAria') + ': ' + f.t('colLast'),
								onClick: () => toggleSort('last'),
							}, f.t('colLast'), chevron))),
					h('div', { role: 'rowgroup' }, rowNodes)),
				listed.length === 0
					? h('div', { className: 'tdb-empty-sess' },
						h('svg', { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
							h('path', { d: 'M4 5.5h16v11H9.5L4 20.5v-15Z', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }),
							h('path', { d: 'M8 9.5h8M8 12.5h5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })),
						h('p', null, f.t('emptySessions')),
						h('button', {
							type: 'button',
							className: 'tdb-btn',
							onClick: () => {
								setQuery('')
								setStatus('all')
							},
						}, f.t('clearFilters')))
					: null,
				h('div', { className: 'tdb-sess-foot' },
					h('span', null, f.tf('sessFoot', {
						a: f.int(totalSessions),
						b: f.int(archivedCount),
						c: f.int(mergedSubagents),
					})),
					h('span', null, f.t('sessFootNote'))))
		}

		// ── sidebar entry ───────────────────────────────────────────────────
		/**
		 * The sidebar glyph: three bars with a rising trend line — an original
		 * drawing, sized by the host and painted with `currentColor` so it takes
		 * the row's own foreground in either theme.
		 */
		function SidebarIcon(props) {
			const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 16
			return h('svg', {
				width: size,
				height: size,
				viewBox: '0 0 16 16',
				fill: 'none',
				focusable: 'false',
				'aria-hidden': 'true',
				style: { display: 'block' },
			},
			h('rect', { x: 1.6, y: 9.4, width: 2.5, height: 4.6, rx: 0.7, fill: 'currentColor', opacity: 0.42 }),
			h('rect', { x: 6.75, y: 6.4, width: 2.5, height: 7.6, rx: 0.7, fill: 'currentColor', opacity: 0.7 }),
			h('rect', { x: 11.9, y: 3.2, width: 2.5, height: 10.8, rx: 0.7, fill: 'currentColor' }),
			h('path', {
				d: 'M2.85 6.9 8 4.1l4.2-1.9',
				stroke: 'currentColor',
				strokeWidth: 1.2,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				opacity: 0.95,
			}),
			h('circle', { cx: 13.15, cy: 2.8, r: 1.15, fill: 'currentColor' }))
		}

		/** Slot occupant: the host passes owner props, `size` included. */
		function SidebarRow(owner) {
			const size = owner && typeof owner.size === 'number' ? owner.size : 16
			return h(SidebarIcon, { size })
		}

		return {
			/** Cordis client services this browser half needs. */
			inject: ['slots', 'locale'],
			/** @param {object} ctx */
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-dashboard: dictionaries')

				ctx.effect(() => {
					if (typeof document === 'undefined') return () => {}
					const style = document.createElement('style')
					style.setAttribute('data-plugin', '@zhujiuyi/dsh-token-dashboard')
					style.textContent = CSS
					document.head.appendChild(style)
					return () => {
						style.remove()
					}
				}, 'token-dashboard: styles')

				const t = ctx.locale.bind(NS)

				// The panel. `key` matches the sidebar row's `id`, which is how the
				// layout links a row to its page; `locale` gives the renderer the `t`
				// named here.
				ctx.slots.inject('main', () => ctx.slots.register({
					name: 'main',
					key: 'token-dashboard',
					locale: NS,
					inject: () => ({ t }),
				}, DashboardPage))

				// The sidebar row. `order: 5` puts it between the plugins (0), the
				// plugin market (1) and automation tasks (10).
				ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
					name: 'sidebar.panellist',
					id: 'token-dashboard',
					order: 5,
					label: () => t('nav'),
					locale: NS,
				}, SidebarRow))
			},
		}
	},
})
