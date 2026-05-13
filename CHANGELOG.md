# Changelog

All notable changes to Agent Mission Control are documented here.

## [0.3.0] - 2026-05-14

### English

#### Added

- Added an Agent review workflow from the thread detail panel, with local Codex, Claude Code, and OpenCode CLI targets.
- Added review input modes for latest Agent signal, privacy-scoped thread summary, and Codex latest-turn content.
- Added review templates for code, product/requirements, technical design, reply quality, and custom review instructions.
- Added review history, selected review details, copyable review results, and copyable debug summaries.
- Added Fix Loop MVP actions to copy a repair prompt, copy and open the source thread, and mark a review as applied or dismissed.
- Added target capability labels and review history filters for pending fixes, applied fixes, and dismissed reviews.

#### Changed

- Updated the review prompts to guide target Agents toward read-only repo inspection only when useful, while avoiding unnecessary token use.
- Restricted review runners so Codex uses a read-only sandbox and Claude Code runs with write tools denied.
- Documented review data flow, local storage, input boundaries, and Fix Loop metadata in the privacy notes and README.
- Kept desktop/system review notifications hidden for the public release while preserving in-app review status visibility.

#### Fixed

- Hid raw runner stderr from review details and replaced it with copyable debug summaries.
- Preserved selected review target options across detail panel rerenders and dashboard refreshes.
- Kept review job polling visible while a detail panel is open.
- Added borders and layout refinements for review input previews and review results.
- Hardened Codex review runner temp output handling by cleaning files on failure and using collision-resistant temp paths.

### 中文

#### 新增

- 新增从线程详情面板发起 Agent 评审的工作流，支持本机 Codex、Claude Code 和 OpenCode CLI 作为评审目标。
- 新增评审输入模式：最新 Agent 输出、隐私受限的线程摘要，以及 Codex 最新回合内容。
- 新增代码审查、产品/需求审查、技术方案审查、回复质量审查和自定义审查要求等评审模板。
- 新增评审历史、选中评审详情、复制评审结果和复制调试摘要能力。
- 新增 Fix Loop MVP 操作，可复制修复 Prompt、复制并打开源线程，以及把评审标记为已处理或不采纳。
- 新增目标 Agent 能力标签，并支持按待修复、已处理、不采纳筛选评审历史。

#### 调整

- 优化评审 Prompt：引导目标 Agent 仅在有必要时只读查看 repo 文件，避免不必要的 token 消耗。
- 收紧评审 runner 边界：Codex 使用只读沙盒，Claude Code 禁用写入工具。
- 在隐私文档和 README 中补充评审数据流、本地存储、输入边界和 Fix Loop 元数据说明。
- 发布版继续隐藏桌面/系统评审通知，只保留站内评审状态可见。

#### 修复

- 评审详情不再直接展示原始 runner stderr，改为提供可复制的调试摘要。
- 修复详情面板重绘和看板刷新后评审目标选项丢失的问题。
- 修复打开评审详情时评审任务轮询不可见的问题。
- 为评审输入预览和评审结果增加边框，并优化详情布局。
- 加固 Codex 评审 runner 临时输出处理：失败路径也会清理临时文件，并使用防撞临时路径。

## [0.2.3] - 2026-05-13

### English

#### Added

- Added running Host task group counts to the dashboard summary, top bar, and privacy-limited pending summary API.
- Added a lightweight top-bar metric cluster for running Host tasks and hard pending work.
- Added an installable Chrome / Edge PWA shell with manifest, icons, a service worker that avoids `/api/*` payloads, and local controls to open or minimize the installed dashboard app on macOS.
- Added grouped quota cards by LLM family, so GPT and Claude quota signals can be shown side by side without adding more summary cards.
- Added Claude Desktop / Cowork quota extraction from the local Claude usage cache, mapped to the same realtime and weekly quota summary shape.
- Added `claude://resume` deep links for Claude Desktop Code sessions when a valid CLI session id is available.

#### Changed

- Refined the macOS menu bar helper so clicking the badge focuses an existing Chrome or Safari dashboard tab before opening a new dashboard URL.
- Refined the macOS menu bar helper badge colors and count alignment to better match the dashboard's quieter release UI.
- Refined the macOS menu bar helper so it first asks the local server to reopen the installed PWA app before falling back to browser tabs.
- Reworked the top-bar refresh controls and metric layout so status text and controls keep stable spacing across desktop and mobile widths.
- Made the top-bar Host-running and pending metrics clickable shortcuts to the running-thread view and notification center.
- Updated the README mock UI screenshot generated from synthetic dashboard data for the latest release layout.
- Renamed soft progress notification states and actions from "read" language to "viewed" language, separating new-progress review from hard pending work.
- Updated notification done and snooze actions to update the visible inbox optimistically before waiting for persistence.
- Deduplicated Claude Desktop Code metadata that points to the same CLI session, keeping the freshest local session record.
- Tightened responsive thread-row actions by keeping copy/resume-command actions in the detail panel.
- Updated the work-in-progress summary copy to distinguish running Agent threads from running Host task groups.

#### Fixed

- Prevented stale unfinished turns with no recent activity from staying in the running state indefinitely.
- Avoided treating ordinary unresolved Claude tool calls as user-facing pending work, while still preserving explicit permission/user-request signals.
- Treated incomplete Claude Cowork metadata as a running signal only while the activity remains fresh.
- Marked soft progress notifications as viewed when their inbox item is opened from the notification center.

### 中文

#### 新增

- 在看板摘要、顶部栏和隐私受限的 pending summary API 中加入工作中的 Host 任务组数量。
- 新增顶部关键指标区，用于快速查看工作中的 Host 任务和硬待处理数量。
- 新增可安装的 Chrome / Edge PWA 壳子，包含 manifest、图标、不缓存 `/api/*` 的 service worker，以及 macOS 上打开或收起已安装控制台应用的本地接口。
- 新增按 LLM 家族分组的 quota 卡片，可在同一组摘要卡里并列展示 GPT、Claude 等 quota 信号。
- 新增从本地 Claude usage cache 读取 Claude Desktop / Cowork 聚合 quota 的能力，并映射到统一的实时 / 本周 quota 结构。
- 新增 Claude Desktop Code 的 `claude://resume` deep link 支持，可在存在有效 CLI session id 时直接恢复桌面会话。

#### 调整

- 优化 macOS 菜单栏辅助工具：点击徽章会优先切回已有的 Chrome 或 Safari 控制台标签页，再按需打开新页面。
- 优化 macOS 菜单栏辅助工具徽章的配色和数字对齐，使其更贴近发布版控制台的克制视觉。
- 优化 macOS 菜单栏辅助工具：会先请求本地服务打开已安装的 PWA 应用，再回退到浏览器标签页。
- 重做顶部刷新控制和关键指标布局，让状态文字与控件在桌面端和移动端都保持稳定间距。
- 顶部 Host 工作中和待处理指标现在可点击，分别跳到运行中线程视图和通知中心。
- 更新 README 中由虚构看板数据生成的脱敏 mock UI 示意图，以匹配最新发布版布局。
- 将软性“新进展”的状态和操作文案从“已读”调整为“已查看”，和硬性的待处理事项进一步区分。
- 通知的已处理和稍后提醒操作改为先乐观更新当前收件箱，再等待持久化结果。
- 对指向同一 CLI session 的 Claude Desktop Code 元数据做去重，保留最新的本地会话记录。
- 收紧响应式线程列表操作区，把复制 / resume 命令入口保留在详情面板里。
- 调整工作中摘要文案，区分运行中的 Agent 线程和运行中的 Host 任务组。

#### 修复

- 避免很久没有新活动、但缺失 final answer 的旧轮次长期停留在“运行中”状态。
- 避免把普通未完成 Claude tool call 误判为需要用户处理，同时保留明确的授权 / 用户请求信号。
- Claude Cowork 未完成元数据只会在活动仍然新鲜时作为运行中信号。
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
