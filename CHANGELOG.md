# Changelog

All notable changes to Agent Mission Control are documented here.

## [Unreleased]

### English

#### Added

- Added running Host task group counts to the dashboard summary, top bar, and privacy-limited pending summary API.
- Added a lightweight top-bar metric cluster for running Host tasks and hard pending work.

#### Changed

- Refined the macOS menu bar helper so clicking the badge focuses an existing Chrome or Safari dashboard tab before opening a new dashboard URL.
- Refined the macOS menu bar helper badge colors and count alignment to better match the dashboard's quieter release UI.
- Reworked the top-bar refresh controls and metric layout so status text and controls keep stable spacing across desktop and mobile widths.
- Renamed soft progress notification states and actions from "read" language to "viewed" language, separating new-progress review from hard pending work.
- Updated the work-in-progress summary copy to distinguish running Agent threads from running Host task groups.

#### Fixed

- Prevented stale unfinished turns with no recent activity from staying in the running state indefinitely.
- Marked soft progress notifications as viewed when their inbox item is opened from the notification center.

### 中文

#### 新增

- 在看板摘要、顶部栏和隐私受限的 pending summary API 中加入工作中的 Host 任务组数量。
- 新增顶部关键指标区，用于快速查看工作中的 Host 任务和硬待处理数量。

#### 调整

- 优化 macOS 菜单栏辅助工具：点击徽章会优先切回已有的 Chrome 或 Safari 控制台标签页，再按需打开新页面。
- 优化 macOS 菜单栏辅助工具徽章的配色和数字对齐，使其更贴近发布版控制台的克制视觉。
- 重做顶部刷新控制和关键指标布局，让状态文字与控件在桌面端和移动端都保持稳定间距。
- 将软性“新进展”的状态和操作文案从“已读”调整为“已查看”，和硬性的待处理事项进一步区分。
- 调整工作中摘要文案，区分运行中的 Agent 线程和运行中的 Host 任务组。

#### 修复

- 避免很久没有新活动、但缺失 final answer 的旧轮次长期停留在“运行中”状态。
- 从通知中心打开软性“新进展”条目时，会同步标记为已查看。

## [0.2.2] - 2026-05-11

### English

#### Added

- Added Host/Sub Agent relationship metadata to normalized threads, dashboard data, thread rows, and copyable thread summaries.
- Added a privacy-limited `/api/pending-summary` endpoint for aggregate pending/progress counts.
- Added an optional native macOS menu bar helper, runnable with `npm run menubar`, that shows aggregate pending/progress counts and opens the local dashboard.

#### Changed

- Separated soft "new progress" notifications from hard pending work in the dashboard summary, inbox heading, inbox actions, and notification copy.
- Let the desktop thread list and project rail fill the available work-panel height while preserving mobile flow.
- Limited inferred observed-completion reminders to recent Codex UI threads and cleared them when the user continues a thread.

#### Fixed

- Avoided inferring observed-completion reminders for non-Codex providers, exec-spawned Codex threads, and currently running threads.
- Dismissed stale legacy observed-completion reminders even when older records used the previous sticky policy.

### 中文

#### 新增

- 在线程标准化、看板数据、线程列表和可复制线程摘要中加入 Host/Sub Agent 关系信息。
- 新增隐私受限的 `/api/pending-summary` 接口，只返回待处理/新进展的聚合数量。
- 新增可选原生 macOS 菜单栏辅助工具，可通过 `npm run menubar` 显示聚合待查看数量并打开本地控制台。

#### 调整

- 在总览、收件箱标题、操作按钮和文案中区分软性的“新进展”和硬性的“待处理”。
- 让桌面端线程列表和项目栏填满工作面板高度，同时保持移动端自然排布。
- 将推断出的 observed-completion 提醒限制在近期 Codex UI 线程内，并在用户继续发言后自动清理。

#### 修复

- 避免为非 Codex provider、exec 派生的 Codex 线程和运行中的线程误推断 observed-completion 提醒。
- 即使旧记录使用过此前的 sticky 策略，也会清理过期的 legacy observed-completion 提醒。

## [0.2.1] - 2026-05-10

### Fixed

- Fixed notification tests for CI by aligning observed-completion initialization fixtures with the current recent/stale signal policy.

## [0.2.0] - 2026-05-10

### Added

- Added a priority in-app inbox at the top of the dashboard, with preview and expand/collapse behavior for pending work.
- Added a structured single-thread audit detail panel with status summary, pending signals, token usage, local evidence, recent truncated signals, and next actions.
- Added "复制线程摘要" so a thread can be handed off to another Agent with privacy-limited local metadata and truncated signals.
- Added sub-agent thread classification so child/worker threads do not pollute the main dashboard inbox or notification candidates.
- Added project-facing `AGENTS.md` guidance for future maintainers.
- Added `docs/thread-artifact-detail-brief.md` to capture the next direction for thread artifact/detail work.

### Changed

- Changed observed-completion notifications to remain visible until explicitly handled, instead of expiring after a short grace period.
- Disabled desktop/system notification delivery in the public release until a reliable native notifier is available.
- Changed notification settings and notification test endpoints to return `410 Gone` while desktop notifications are disabled.
- Moved the filter controls into the thread panel and tightened the dashboard summary/provider layout.
- Updated the README screenshot to reflect the latest real UI rendered from mock data.

### Fixed

- Reopened recent legacy auto-dismissed observed-completion records so users do not miss fresh work after upgrading.
- Dismissed stale active legacy observed-completion records that predate the new sticky policy.
- Excluded sub-agent permission/review signals from notification candidates and dashboard attention rows.

## [0.1.0] - 2026-05-09

### Added

- Initial public release.
- Local dashboard for Codex, OpenCode, Claude Code CLI, Claude Desktop Code, and Claude Cowork sessions.
- Read-only local data adapters for thread status, token usage, quota samples, project aggregation, and pending work signals.
- Local notification center with persistent in-app state.
- Privacy documentation, security guidance, contributing notes, mock screenshot workflow, and GitHub Actions tests.
