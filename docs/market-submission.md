# 插件市场上架

**状态：PR 已提交，CI 通过，等待维护者合并**

- PR: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/8786
- CI: `check` = SUCCESS（2026-10-23 02:10 +08）
- 备注：首次跑 CI 时上游 main 上 `FrogFlaying__dsh-desktop-organizer.yml` 有未加引号的冒号导致解析失败，维护者随后修好；已把分支 rebase 到修复后的 main 重跑，现全绿。

准备时间：2026-10-22 01:40 +08
仓库创建时间：2026-10-22 01:22 +08 → **可提交时间：2026-10-23 01:22 +08 之后**

## 已完成

- GitHub 仓库：https://github.com/zhujiuyi/dsh-tokenDashBoard （public，`dsh-plugin` topic 已加）
- npm：`@zhujiuyi/dsh-token-dashboard@0.1.0`（latest，repository 字段已回指仓库）
- 市场条目文件已写好并做本地 commit，分支 `add-token-dashboard`，未 push：

```
data/plugins/zhujiuyi__dsh-tokenDashBoard.yml
---
url: https://github.com/zhujiuyi/dsh-tokenDashBoard
name: zhujiuyi/dsh-tokenDashBoard
category: usage
description:
  en: '...'
  zh: '...'
```

## 到点后执行（fork + PR）

```bash
cd %LOCALAPPDATA%\Temp\awesome-dsh        # 已 clone 的 awesome-dsh-plugin
git push  <origin 指向自己的 fork> add-token-dashboard
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --base main --head zhujiuyi:add-token-dashboard \
  --title "Add zhujiuyi/dsh-tokenDashBoard (usage)" \
  --body-file pr-body.md
```

注意：直接 `git push` 到对方仓库没有权限，需先 fork：
`gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=false --remote=true`
然后把分支推到 `zhujiuyi/awesome-dsh-plugin`。

## 自检结论（对照 contributing.md）

| 要求 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ |
| 仓库满 1 天 | ⏳ 2026-10-23 01:22 后满足 |
| 仓库有真实可用代码 | ✅ 56 + 31 项测试 |
| `dsh-plugin` topic | ✅ |
| 描述准确、无营销词 | ✅ |
| 分类匹配（usage） | ✅ |
| 截图（screenshots.json，1–8 张） | ✅ 4 张 |
| 一个 PR 最多 3 条 | ✅ 1 条 |

## PR 描述草稿

标题：`Add zhujiuyi/dsh-tokenDashBoard (usage)`

正文：

```markdown
Adds a Token usage dashboard for the DeepSeek Harness sidebar.

- Daily totals (local 00:00–24:00) with a 12-month heatmap (daily / weekly / cumulative).
- Per-provider breakdown over today / 7d / 30d / all; "today" expands to 24 hourly buckets.
- Per-session ranking including archived sessions and sessions whose log outlives the
  sidebar entry; subagent usage is folded into its parent session.
- Read-only: the Host half only reads `$DSH_HOME/sessions` and
  `storages/workspace.json`, and serves one JSON route to the browser half.
  No network, no credentials, no subprocesses.

Published to npm as `@zhujiuyi/dsh-token-dashboard`; the package's `repository`
points back at this repo. Declares `dsh.bundle` (see `cordis.patch.yml`) and
`dsh.client` for the browser half.
```
