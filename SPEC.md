# dsh-token-dashboard — 实现规范（唯一契约）

DSH 宿主页脚插件：在左侧栏「插件市场」与「自动化任务」之间加一行「Token 用量」，
点击后打开一个 Token 消耗看板页面。页面视觉与交互参照原型
`C:\Users\zhuji\Desktop\index.html`（深色原型），但配色必须走 DSH 主题令牌，
亮/暗主题都成立。

本文件是 Host、Client、集成三方共同遵守的契约。**先读完本文件再写代码。**

---

## 0. 身份与文件布局

- 包名（也是 Client 模块 id）：`dsh-token-dashboard`
- 面板 id（`main` 的 key、`sidebar.panellist` 的 id）：`token-dashboard`
- Locale 命名空间：`tokenDashboard`
- Host 路由：`GET /api/token-dashboard/snapshot`
- CSS 前缀：`tdb-`
- 侧栏顺序：`order: 5`（插件=0，插件市场=1，自动化任务=10）

```
dsh-tokenDashboard/
  package.json          # 集成负责人写
  cordis.patch.yml      # 集成负责人写
  index.js              # 集成负责人写：Host 插件 apply()
  locale/en.json        # 集成负责人写：meta.title / meta.description
  locale/zh.json        # 集成负责人写
  icon.svg              # 集成负责人写（插件卡片图标）
  src/host/*.mjs        # host-engine 负责
  test/*.test.mjs       # host-engine 负责
  client/client.js      # client-ui 负责（单文件、无构建）
  SPEC.md               # 本文件
```

写入范围互斥：host-engine 只写 `src/` 与 `test/`；client-ui 只写 `client/`；
集成负责人只写根文件。谁都不许改别人的文件。

---

## 1. 数据来源（已实测）

Harness home：`process.env.DSH_HOME`，缺省 `~/.dsh`。

### 1.1 会话日志

路径：`<DSH_HOME>/sessions/<workspace-slug>/<sessionId>/session.v4.jsonl.zstd`

- 文件是**多个 zstd frame 顺序拼接**：Node 的 `zlib.zstdDecompressSync` 只解第一帧，
  必须逐帧解（实现与单测见 `src/host/zstd.mjs` / `test/zstd.test.mjs`）。
  也允许未压缩的 `session.vN.jsonl`，用文件名后缀判断。
- 每行一个 JSON 事件；本机 37 个会话日志已验证。
- 首行 `{"type":"session","version":4,"id":...,"createdAt":epochMs,"cwd":...,"delegationDepth":0,"parentSession":"<父会话id>"?}`
  —— 子代理会话带 `delegationDepth > 0` 且有 `parentSession`。
- 关键事件：
  - `request/context`：`{provider, model, contextWindow}`，路由变化时才写。
  - `request/header`：`data.header.config.{provider,model,...}`，会话首个请求必有一条。
  - `assistant/message`：`data.usage = { inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens? }`
    `inputTokens` 是**未命中缓存**的输入；`totalTokens = inputTokens + outputTokens + cacheReadTokens`。
    这是唯一的用量来源，**不要**用 `totalTokens` 再叠加缓存（会重复计）。
  - `turn/start` / `turn/end`：`data.turn` 编号，用于任务用时与轮次。
  - `session/title`：标题事件（`data.title` 或 `data.val`，以实际为准，做两种兜底）。
  - `user/message`：`data.role === 'user'`，用于消息数。
- **供应商归属**：按日志顺序维护「当前 provider」，遇到 `request/context` 或
  `request/header` 就更新；后续 `assistant/message` 的用量记到当前 provider。
  同一会话会跨供应商（实测 4 个），不能只用会话级 provider。
- 已验证：把每个 `assistant/message` 的四个桶求和，与
  `~/.dsh/storages/session_projcache/sessions/<id>.json` 的
  `record.rows.tokenUsage.val.totals`（`uncachedInputTokens/outputTokens/cacheReadTokens/cacheWriteTokens`）
  逐会话完全一致（34/35 精确相等，唯一差异是正在写入的当前会话）。这是对解析正确性的硬校验。

### 1.2 会话状态 / 标题兜底

`<DSH_HOME>/storages/workspace.json`：
- `global.archivedSessionIds: string[]` → 已归档
- `tables.workspaces[*] = { path, title, sessionIds[] }` → 工作区标题、归属、是否仍在列表中
- 兼容缺失/损坏（try/catch，绝不因此抛错）

`<DSH_HOME>/storages/session_projcache/sessions/<id>.json`（可选，兜底标题）：
`record.rows.title.val` 为字符串。

### 1.3 当前配置的供应商（由 index.js 注入）

index.js 负责从运行时取：
- `ctx.llm.listProviders()`（可用时）
- `ctx.configEditor.entries()` / `ctx.configEditor.configuration()`（可用时，补全未激活的 llm-* 行）

归一化成 `{ id: string, name: string }[]` 传给 service。Host 引擎不要直接依赖 cordis。

---

## 2. 统计口径（用户确认）

1. **按天**：以本机时区自然日 00:00–24:00 为一天；日键 `YYYY-MM-DD`（本地时间）。
2. **供应商维度**：时间周期 = `今天` / `近 7 天` / `近 30 天` / `全部`；
   供应商集合 = 当前配置的供应商 ∪ 日志中出现过的供应商（被删掉的也要在）。
3. **会话维度**：时间周期同上；包含已归档会话、日志里存在但 workspace.json 已删除的会话；
   **子代理会话合并进父会话**（父会话的 total/messages/turns/longestTurn 都含子代理）。
   父会话日志不存在时，子代理保留为独立会话行并标 `orphan: true`。
4. 会话状态：`active`（在 workspace sessionIds 且未归档）/ `archived` / `deleted`（两处都找不到）。
5. 统计范围覆盖该机器全部历史（不是只近 365 天）。

---

## 3. Snapshot 契约（Host → Client，HTTP JSON）

`GET /api/token-dashboard/snapshot` → 200，`content-type: application/json`，
`cache-control: no-store`。结构（字段名就是契约）：

```ts
type Snapshot = {
  version: 1
  generatedAt: number          // epoch ms
  timeZone: string             // 例 'Asia/Shanghai'
  today: string                // 'YYYY-MM-DD'
  firstDay: string | null      // 最早有消耗的日（null=无数据）
  lastDay: string | null
  days: Array<DayRow>          // 升序，仅含有消耗或有会话活动的日；最多覆盖全部历史
  providers: Array<ProviderRow>// 排序：total 降序，再按 id
  sessions: Array<SessionRow>  // 仅 top-level（子代理已合并）；total 降序
  todayHours: Record<string, number[]> // providerId -> 24 个小时桶的 token（今天）
  stats: Stats
  warnings: string[]           // 读取失败等，用于页脚提示，可为空
}

type DayRow = {
  day: string                  // 'YYYY-MM-DD'
  total: number
  providers: Record<string, number>   // 该日每个供应商的 token（只为 >0 的写）
  sessions: Record<string, number>    // 该日每个 top-level 会话的 token（>0 才写）
}

type ProviderRow = {
  id: string
  name: string                 // 显示名；未知时等于 id
  configured: boolean          // 来自当前配置
  seenInLogs: boolean
  total: number
  firstDay: string | null
  lastDay: string | null
  peak: { day: string, tokens: number } | null
  sessionCount: number
}

type SessionRow = {
  id: string
  title: string                // 无标题时 '未命名会话'（Host 给中文兜底；Client 再本地化）
  workspacePath: string | null
  workspaceTitle: string | null
  status: 'active' | 'archived' | 'deleted'
  provider: string | null      // 主导供应商 id（token 最多者）
  providers: string[]          // 用过的全部 provider id，按 token 降序
  messages: number             // user/message + assistant/message 计数
  turns: number
  subagentCount: number        // 合并进来的子代理会话数
  orphan: boolean              // 父会话缺失的子代理（独立成行时 true）
  firstAt: number | null       // epoch ms
  lastAt: number | null
  total: number
  longestTurnMs: number        // 0 表示未知
  byDay: Record<string, number>       // 稀疏：有消耗的日
  byProvider: Record<string, number>  // 稀疏
}

type Stats = {
  total: number
  peakDay: { day: string, tokens: number } | null
  longestTurnMs: number
  activeDays: number
  longestStreak: number
  currentStreak: number
  last30: number
}
```

约定：
- 所有 token 数字为整数，四舍五入误差可忽略（用量本身就是整数）。
- `days` 只含有数据的天；Client 自己补齐空白日用于绘图。
- 无数据时 `days=[]`, `providers` 可含 configured 且 total=0 的项, `sessions=[]`,
  `stats.total=0`, `firstDay=null`。
- 路由永不返回 5xx 表达业务失败；内部异常也要返回结构（`warnings` 记录原因）。

---

## 4. Host 模块接口（index.js 依赖）

`src/host/index.mjs` 导出：

```js
export function createDashboardService(options)
// options = {
//   homeDir: string,
//   configuredProviders: () => Array<{ id: string, name: string }>,
//   now?: () => number,
//   ttlMs?: number,        // 默认 15000：ttl 内重复请求复用整理结果
//   logger?: { warn(msg: string): void },
// }
// 返回 { snapshot(): Promise<Snapshot>, invalidate(): void }

export const SNAPSHOT_VERSION = 1
```

- 内部按 `stat.mtimeMs + size` 缓存每个日志文件的解析结果；未变文件不重解析。
- 并发请求共享同一次构建（in-flight promise）。
- 单文件解析失败 → 跳过并写 `warnings`，不影响其他会话。
- 只用 Node 内置模块；不需要任何依赖。
- 纯函数拆分便于测试：建议
  `src/host/zstd.mjs`、`src/host/events.mjs`(单会话折叠)、`src/host/workspace.mjs`、
  `src/host/providers.mjs`、`src/host/aggregate.mjs`、`src/host/index.mjs`。

---

## 5. Client 契约

`client/client.js`：单文件 classic script：

```js
window.__ModuleLoader__.load({
  id: 'dsh-token-dashboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // ... 整个页面实现 ...
    return { inject: ['slots', 'locale'], apply(ctx) { /* ... */ } }
  },
})
```

- **只允许** `require('react')`。不得 require 任何 Harness Client 包。
- `apply(ctx)` 内：
  1. `ctx.effect(() => ctx.locale.register('tokenDashboard', { zh, en }), '...')`
  2. 注入 `<style data-plugin="dsh-token-dashboard">`，cleanup 移除。
  3. 注册主面板：
     ```js
     ctx.slots.inject('main', () => ctx.slots.register(
       { name: 'main', key: 'token-dashboard', locale: NS, inject: () => ({ t }) },
       DashboardPage))
     ```
  4. 注册侧栏行：
     ```js
     ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
       { name: 'sidebar.panellist', id: 'token-dashboard', order: 5, label: () => t('nav'), locale: NS },
       SidebarIcon))
     ```
     `SidebarIcon({ size })` 返回内联 SVG（1em 大小，currentColor，原创的柱状图+折线图标）。
- 页面根：`height:100%; display:flex; flex-direction:column; min-height:0`，内部
  `.tdb-scroll { overflow-y:auto; flex:1; min-height:0 }`，自带 `padding: 32px`，
  `max-width:1160px; margin:0 auto` 的内容列。
- 数据：挂载即 `fetch(new URL('api/token-dashboard/snapshot', document.baseURI).pathname)`；
  每 60s 轮询一次（页面隐藏时跳过）；手动「刷新」按钮；失败时保留旧数据并显示错误条。
- 所有文案走 locale（zh 为主，en 完整提供），数字格式化 `万/亿` 与原型一致。
- 所有颜色走 `--dsw-alias-*` 令牌；图表/热力图的强调色可用
  `--dsw-static-deepseek-*` / `--dsw-static-blue-*` / `--dsw-static-teal?`（不存在则用
  `color-mix` 从现有令牌生成）。**不要**写死中性色。
- 不得写 `document.body`、不得改宿主 DOM、不得依赖宿主 class。

### 5.1 页面结构（自上而下）

1. **页头**：h1「Token 用量」+ 说明 + 右侧 meta（数据范围、时区、天数、「刷新」按钮、
   最后更新时间）。不要复制原型的「DeepSeek Harness / 用量统计」顶栏（宿主已有）。
2. **概览条**（5 项，等宽分栏、细边框）：
   累计 Tokens / 单日峰值（下方小字日期）/ 最长任务用时 / 最长连续天数 / 当前连续天数。
3. **Token 活动热力图**：
   - 近 12 个月（今天往前 365 天），每格一天，周一起始的 7 行；
   - 分段控件：每天 / 每周 / 累计总量（复用原型三档逻辑）；
   - 右侧栏：活跃天数、单日最高（含日期）、近 30 天合计、颜色图例；
   - 悬停 tooltip（跟手，边界翻转），触摸/键盘不要求。
4. **按供应商渠道**：
   - 分段控件：今天 / 近 7 天 / 近 30 天 / 全部（默认近 30 天）；
   - 图例按钮可开关单个供应商（至少保留一个）；
   - 堆叠柱状图：`今天` → 24 个小时柱（0–23 时，x 轴标 0/4/8/12/16/20/23）；
     其余 → 每天一根柱；`全部` 且天数 > 90 时按周聚合（原型做法）；
   - y 轴 5 档刻度 + 网格线；悬停整根柱显示 tooltip（日期/合计/各供应商明细）；
   - 表格：渠道 / 用量 / 日均 / 单日峰值 / 占比（带进度条）。配置了但没用过的供应商
     显示 0，标记「未使用」。
   - 副标题显示实际日期范围与统计口径。
5. **按会话**：
   - 分段控件：今天 / 近 7 天 / 近 30 天 / 全部（默认近 30 天）——作用于下方用量数字；
   - 状态筛选：全部 / 进行中 / 已归档 / 已删除（带该区间内有消耗的计数）；
   - 搜索框：标题、会话 id、供应商名；
   - 行：标题 + id、状态徽标（进行中/已归档/已删除；子代理合并的显示「含 N 个子代理」）、
     主导供应商（多供应商显示 +N）、消息数、Token 用量 + 比例条、最后活跃；
   - 排序：Token 用量 / 最后活跃（点表头切换升降序）；
   - 空状态 + 清除筛选；
   - 页脚：会话总数、归档数、子代理合并数、统计口径说明。
6. **页脚**：数据来源（本机会话日志）、时区、最后更新；`warnings` 非空时显示一行提示。

### 5.2 交互与可访问性

- 分段控件用 `<button aria-pressed>`；表头排序 `aria-sort`；tooltip `role=status`。
- 键盘可达；focus-visible 有轮廓；`prefers-reduced-motion` 关闭过渡。
- 数字 `font-variant-numeric: tabular-nums`。

---

## 6. 验收

Host（可自动验证）：
- `npm test`（= `node --test "test/*.test.mjs"`；Node 22 不再展开目录参数，`node --test test/` 会 MODULE_NOT_FOUND）全绿，覆盖：多帧 zstd、usage 四桶、跨供应商归属、跨日切分、
  子代理合并、两级孤儿链、workspace 状态、空数据、损坏日志容错、统计口径。
- 独立脚本对真实 `~/.dsh` 生成 snapshot，抽查：总 token 与逐会话 projcache 汇总一致；
  provider 分布包含 opencode-go / opendesign / deepseek-*；今天小时桶总和 = 今日总量。

Client（本环境无浏览器控制）：
- `node --check client/client.js` 通过；
- `npm run test:client`：用桩 `window.__ModuleLoader__.load` + 桩 `require('react')` 在 Node 里
  加载该文件，断言导出 `{inject, apply}`、`apply` 用假 ctx 执行不抛错、两个槽的注册选项正确，
  并渲染真实/空/失败三种快照验证结构。
- 视觉验证由用户在重启后的 GUI 里完成；不得声称"已看到"。

安装由用户在「插件」页用本地目录安装；集成负责人不得改 profile 配置。
