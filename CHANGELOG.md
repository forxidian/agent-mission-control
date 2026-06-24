# Changelog

All notable changes to Agent Mission Control are documented here.

## [0.4.5] - 2026-06-24

### English

#### Added

- Added token usage breakdowns for dashboard summaries, project rows, thread rows, and search details, separating fresh input, cache reads, cache writes, output, reasoning, and uncategorized tokens.
- Added a local Prompt Pack composer that lets users organize segmented instructions, paste or select attachments, save them under `~/.agent-mission-control/prompt-packs`, and copy a Markdown handoff package for another Agent.
- Added `POST /api/prompt-packs/:id/attachments` for same-origin local attachment persistence with safe pack ids, sanitized filenames, and size limits.
- Added a lower-emphasis grouped row action menu for recent threads and search results, with reveal-in-file-manager and deep-link copy actions while keeping open as the primary action.
- Added Codex native pinned-state badges from `pinned-thread-ids`; the unavailable direct pin/unpin menu action is not shown.
- Added `POST /api/threads/:id/reveal` to reveal known thread working directories or rollout files through the system file manager.

#### Changed

- Normalized token breakdown data from Codex, Claude, and OpenCode usage payloads, then carried the aggregates through project, search, and dashboard API responses.
- Refined the Prompt Pack composer so it starts collapsed until a segment is added, with lightweight between-segment insert controls and drag sorting while keeping arrow controls as a keyboard-friendly fallback.
- Moved the history search launcher beside, but outside of, the Prompt Pack shell, then reshaped the Prompt Pack composer as a notched module so the header and full-width segment area read as one unit without the search block being wrapped into it.
- Refreshed the README mock screenshot set with synthetic data for the 0.4.5 dashboard, history search, and artifact timeline UI.

### 中文

#### 新增

- 新增 token 用量拆分，在汇总、项目、线程和搜索详情中区分新输入、缓存复用、缓存写入、输出、推理和未细分 token。
- 新增本地 Prompt 打包器，可分段整理修改要求、粘贴或选择附件，将附件保存到 `~/.agent-mission-control/prompt-packs`，并一键复制给其他 Agent 的 Markdown 交接包。
- 新增 `POST /api/prompt-packs/:id/attachments`，用于同源本地附件保存，并限制 pack id、清理文件名和控制大小。
- 在最近线程和搜索结果右侧新增低权重的合并操作菜单，支持在文件管理器中显示和复制 deep link，同时保留“打开”为主操作。
- 新增从 `pinned-thread-ids` 读取的 Codex 原生置顶 badge；不可用的直接置顶 / 取消置顶菜单项不再展示。
- 新增 `POST /api/threads/:id/reveal`，可对已知线程的工作目录或 rollout 文件调用系统文件管理器显示。

#### 调整

- 统一解析 Codex、Claude、OpenCode 的 token 明细，并把聚合结果带入项目、搜索和 dashboard API。
- 优化 Prompt 打包器交互：默认不展开空段落，点击新增后再出现待填写段落；段落之间新增轻量插入控件，并支持拖拽排序，同时保留上 / 下箭头作为键盘友好的备用操作。
- 将历史搜索入口放到 Prompt 打包器右侧但保持为独立模块，并把 Prompt 打包器调整为缺口式一体模块：头部和下方通栏段落连成一体，但搜索不被包进 Prompt 外框。
- 更新 README 脱敏 mock 截图组，用虚构数据呈现 0.4.5 的 dashboard、历史搜索和素材时间线界面。

## [0.4.0] - 2026-06-18

### English

#### Added

- Added a dedicated full-history search mode backed by a local SQLite FTS index, with ranked thread results, filters, paging, and project history.
- Added Codex rollout-only history discovery so recent CLI or sidebar-missing Codex sessions can appear in search and open through `codex resume`.
- Added Codex artifact extraction from rollout messages, including local file / URL summaries, image previews, artifact timelines, and local file opening.
- Added a refreshed README mock screenshot set generated from synthetic data, covering the upgraded thread list, full-history search results, and Codex artifact timeline.

#### Changed

- Raised the default Codex thread window to 5000 and kept search indexing off the normal dashboard refresh path.
- Reworked the thread and search result rows around denser project, status, token, match, and artifact modules.
- Changed the installed PWA window action from Dock minimization to app hiding, avoiding minimized thumbnail clutter.

#### Fixed

- Preserved stored / sidebar Codex titles unless the title is missing or still the placeholder.
- Kept hidden Codex history threads openable through CLI resume when a browser deep link is not the right path.
- Marked Codex automation threads even when the sidebar title hides the automation prefix.
- Blocked cross-origin browser requests from using local artifact preview / open endpoints.
- Fixed mock screenshot capture to drive Chrome through DevTools with a fresh profile, so README screenshots can capture search and artifact modal states without stale service worker data.

### 中文

#### 新增

- 新增独立全历史搜索模式，使用本地 SQLite FTS 索引，支持相关性排序、筛选、分页和项目历史。
- 新增 Codex rollout-only 历史发现，让近期 CLI 或未出现在侧边栏的 Codex 会话也能被搜索，并通过 `codex resume` 打开。
- 新增 Codex artifact 抽取能力，可从 rollout 消息中展示本地文件 / URL 摘要、图片预览、artifact 时间线和本地文件打开入口。
- 更新 README 脱敏 mock 截图组，使用虚构数据分别展示 0.4 线程列表、全历史搜索结果和线程素材时间线。

#### 调整

- Codex 默认线程窗口提升到 5000，并让搜索索引构建独立于常规 dashboard 刷新路径。
- 重做线程行和搜索结果行的信息结构，压缩展示项目、状态、token、匹配原因和 artifact 模块。
- 已安装 PWA 的窗口操作从最小化改为隐藏，避免在 Dock 右侧留下最小化缩略图。

#### 修复

- 保留 Codex 已存储 / 侧边栏标题，只有标题缺失或仍为占位文案时才回退到 rollout 推断。
- 对隐藏的 Codex 历史线程使用 CLI resume 打开，避免错误依赖浏览器 deep link。
- 即使侧边栏标题隐藏了 automation 前缀，也能识别 Codex 自动化线程。
- 阻止跨站浏览器请求调用本地 artifact 预览 / 打开接口。
- 修复 mock 截图生成脚本，改用临时 Chrome profile 并通过 DevTools 驱动真实界面状态，避免旧 service worker 缓存复用过期 UI 数据，也能稳定捕获搜索和素材弹窗。

## [0.3.1] - 2026-05-14

### English

#### Added

- Added active Codex goal detection from local `thread_goals`, so long-running goal loops stay in the running Host count instead of falling into pending work.
- Added smarter Codex CLI opening on macOS: running CLI threads focus an existing Terminal tab when it can be matched, and avoid spawning duplicate resume sessions when it cannot.
- Added lightweight pending-summary polling so the dashboard can refresh stale pending and Host counts without forcing full scans on every interval.

#### Changed

- Unified in-app pending copy so hard pending work and soft progress use the same visible pending bucket, while preserving the underlying notification source labels.
- Let `/api/pending-summary` reuse a recent dashboard snapshot to reduce repeated local filesystem scans from menu-bar and lightweight polling clients.
- Added ignore coverage for local-only diagnostics and generated research reports to keep public GitHub syncs sanitized.

#### Fixed

- Fixed GPT quota aggregation by preferring the account-level Codex quota (`limit_id: codex`) over newer model-specific `codex_*` limits.
- Suppressed stale soft-progress menu badges when the source thread has already continued or is running again.
- Opened notification cards through the same source-task opener used by explicit open actions, marking the notification handled consistently.
- Refreshed legacy soft-progress notification titles to the shorter release copy.

### 中文

#### 新增

- 新增从本地 `thread_goals` 识别 Codex active goal 的能力，让长期运行的 goal 任务继续计入工作中的 Host，而不是落到待处理里。
- 优化 macOS 上 Codex CLI 任务打开逻辑：能匹配到运行中的 Terminal 标签页时直接聚焦，匹配不到时避免重复新开 resume 终端。
- 新增轻量 pending-summary 轮询，让看板可及时同步待处理和 Host 数量，而不必每次都触发全量扫描。

#### 调整

- 统一站内待处理口径：硬待处理和软性新进展都进入同一个可见待处理池，同时保留底层通知来源标签。
- `/api/pending-summary` 可复用近期 dashboard 快照，减少菜单栏和轻量轮询客户端造成的本地文件扫描。
- 增加本地诊断和生成型调研报告的忽略规则，降低公开同步到 GitHub 时误提交私密材料的风险。

#### 修复

- 修复 GPT quota 汇总选择错误：优先使用账户级 Codex quota（`limit_id: codex`），不再被更新的模型专用 `codex_*` 限额覆盖。
- 当源线程已继续或重新运行时，菜单栏摘要会隐藏过期的软性新进展，避免出现幽灵角标。
- 通知卡片现在走和显式打开按钮相同的源任务打开逻辑，并一致地标记通知已处理。
- 旧版软性新进展通知标题会刷新为更短的发布版文案。

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
- Added an installable Chrome / Edge PWA shell with manifest, icons, a service worker that avoids `/api/*` payloads, and local controls to open or hide the installed dashboard app on macOS without leaving a minimized Dock thumbnail.
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
- 新增可安装的 Chrome / Edge PWA 壳子，包含 manifest、图标、不缓存 `/api/*` 的 service worker，以及 macOS 上打开或隐藏已安装控制台应用的本地接口，隐藏后不在 Dock 右侧留下最小化缩略图。
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
