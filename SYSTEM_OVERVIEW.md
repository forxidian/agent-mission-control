# Agent Mission Control 系统交接文档

更新日期：2026-05-13

这个文件用于新开 Codex 线程时快速接手本项目。建议新线程先读本文件，再根据具体需求查看相关源码和测试。

## 一句话目标

Agent Mission Control 是一个本地只读任务控制台，用来集中查看 Codex、OpenCode、Claude Code/Cowork 等 Agent 线程、项目分布、token 用量、quota、运行状态和待处理事项，并能一键跳转或恢复到对应线程继续工作。

本地地址：

```bash
http://127.0.0.1:4629/
```

## 当前能力

- 读取 Codex 线程列表、项目、标题、归档状态、更新时间、模型、累计 token、今日 token、当前轮运行时长。
- 读取 Codex rollout JSONL，解析 token_count、rate_limits、latest user message、latest final answer、今日 token 用量。
- 读取 Codex `session_index.jsonl`，优先使用和 Codex 侧边栏一致的线程名，避免 sqlite 里的旧 prompt 标题误导。
- 读取 OpenCode Desktop 状态，展示 OpenCode 会话，并识别 pending tool approval / todo。
- 读取 Claude Code CLI 的 `~/.claude/projects/**/*.jsonl` 会话，展示标题、项目、模型、token、状态和 resume 命令。
- 读取 Claude Desktop Code 的 `claude-code-sessions` 元数据，并和 CLI JSONL 去重，避免同一会话重复出现。
- 读取 Claude Desktop Cowork 的 `local-agent-mode-sessions` 元数据和 `audit.jsonl`，展示 Cowork 会话、今日/历史 token、pending 用户处理信号。
- 检测 Codex CLI / Claude Code CLI 是否安装，并在 provider 状态区展示接入状态。
- 支持搜索线程、项目、来源、路径。
- 支持按来源、状态、项目筛选，支持显示归档线程。
- 支持打开 Codex 线程 deep link：`codex://threads/<thread_id>`。
- 支持打开 OpenCode Desktop 项目 deep link：`opencode://open-project?directory=...`。
- 支持用 macOS Terminal 打开 Claude Code CLI resume 命令。
- 支持通过 `claude://resume?session=...` 拉起 Claude Desktop Code 会话。
- 支持打开 Claude Desktop 应用回到 Cowork 工作区入口；当前 Cowork 没有可靠的单线程 deep link。
- 支持复制 resume / open 命令。
- 支持作为 PWA 安装到 Chrome / Edge 的独立应用窗口；安装后浏览器页优先通过本地 API 打开 macOS PWA app shim，失败时再尝试 `web+agentmissioncontrol:` 协议；只缓存静态前端壳，不缓存 `/api/*` Agent 元数据。
- PWA 独立窗口内提供“收起”按钮，通过本地 API 最小化 macOS app shim；原生红色关闭按钮不能被网页改写，且不使用 `beforeunload` 拦截，避免误伤 deep link 跳转。
- 桌面提醒暂时屏蔽：当前 macOS 脚本通知投递不够可靠，发布版本只保留站内待处理提醒。
- 支持通知中心：等待验收、等待授权、标记已处理、稍后提醒。
- 性能保护：前端自动刷新默认每 30 秒一次，可切到 10 秒或 60 秒；页面在后台时暂停拉取，窗口失焦时自动降频到 60 秒；dashboard 数据未变化时跳过整页重绘。后端 `/api/dashboard` 对同一进程内请求做 10 秒共享快照，通知刷新默认缓存 30 秒，Codex rollout、Claude JSONL 和 Claude Desktop usage cache 读取都有短 TTL / mtime 有界缓存。
- 性能指标：`/api/dashboard` 返回 `performance` 字段，`/api/performance` 可单独读取当前进程 RSS/heap、dashboard 扫描耗时、通知刷新耗时、cache 命中率和缓存条目数。
- 后端 notification monitor 默认关闭；如果启用，会复用 dashboard 共享快照，避免和前端重复全量扫描。

## 运行与验证

启动：

```bash
cd agent-mission-control
npm start
```

可选的后台重启方式：

```bash
screen -S agent-mission-control -X quit >/dev/null 2>&1 || true
lsof -tiTCP:4629 -sTCP:LISTEN | xargs -r kill
: > /tmp/agent-mission-control.log
screen -dmS agent-mission-control zsh -lc 'cd /path/to/agent-mission-control && node src/server.mjs > /tmp/agent-mission-control.log 2>&1'
```

验证：

```bash
npm test
curl -sS http://127.0.0.1:4629/api/dashboard
tail -n 50 /tmp/agent-mission-control.log
```

项目没有外部 npm 依赖，使用 Node.js 内置 test runner、浏览器原生 API、系统 `sqlite3` 命令。`package.json` 要求 Node `>=20`。

## 代码结构

```text
src/server.mjs          HTTP server、静态文件、API、打开线程、通知接口
src/dashboard.mjs       聚合 Codex + OpenCode + Claude provider，再统一 buildDashboard
src/codex-data.mjs      Codex sqlite / session_index / rollout JSONL 读取和解析
src/claude-data.mjs     Claude Code CLI / Claude Desktop Code / Claude Cowork 数据读取和打开逻辑
src/opencode-data.mjs   OpenCode CLI/Desktop 数据读取、pending tool/todo 解析、打开会话
src/insights.mjs        线程标准化、状态推断、项目聚合、quota 汇总、dashboard summary
src/notifications.mjs   通知中心、通知持久化、软提醒过期
public/index.html       页面结构
public/app.js           前端状态、筛选、渲染、打开线程、通知操作、自动刷新
public/styles.css       UI 样式
public/manifest.webmanifest
public/service-worker.js
public/icon-*.png       PWA 安装清单、离线壳缓存和应用图标
test/*.test.mjs         单元测试和 API 行为测试
```

## 数据来源

Codex：

- `~/.codex/state_5.sqlite`
  - 线程 id、rollout_path、cwd、title、model、tokens_used、archived、updated_at_ms 等。
  - 注意：这里的 `title` 可能是很早的首条 prompt，不一定等同 Codex 侧边栏显示。
- `~/.codex/session_index.jsonl`
  - Codex 侧边栏使用的 `thread_name`。
  - 当前面板优先使用它作为线程标题。
- `~/.codex/sessions/**/rollout-*.jsonl`
  - token_count、rate_limits、user_message、agent_message、final_answer 等。
  - 用于解析今日 token、quota、运行中状态、软提醒。

OpenCode：

- CLI 优先：`opencode session list --max-count ... --format json`
- Desktop fallback：
  - `~/Library/Application Support/ai.opencode.desktop/opencode.global.dat`
  - 各 workspace state/cache 文件
  - 可识别 pending tool approval、todo、未读状态等。

Claude：

- CLI：
  - `~/.claude/projects/**/*.jsonl`
  - 解析 user / assistant / result 事件、usage、model、cwd、pending AskUserQuestion 等。
- Desktop Code：
  - `~/Library/Application Support/Claude/claude-code-sessions/**/*.json`
  - 通过 `cliSessionId` 关联 `~/.claude/projects/<session>.jsonl`，并从 CLI provider 去重。
- Desktop Cowork：
  - `~/Library/Application Support/Claude/local-agent-mode-sessions/**/*.json`
  - 同名目录下的 `audit.jsonl`
  - `spaces.json` 用于把 Cowork 的 `spaceId` 映射为更友好的项目名和工作目录。

本系统自己的状态：

- `~/.agent-mission-control/notifications.json`
  - 通知状态、已观察 completion signal。

## 核心概念

线程状态：

- `running`：最近 user message 晚于 latest final answer，且当前轮仍有 6 小时内活动；避免缺失 final answer 的旧会话永久算作工作中。
- `fresh`：非运行中，但更新时间在 15 分钟内。
- `warm`：非运行中，更新时间在 6 小时内。
- `idle`：更久未更新。
- `archived`：Codex sqlite 标记归档。

token：

- `tokensUsed`：线程历史累计 token，来自 sqlite `tokens_used`。
- `todayTokenUsage`：今天新增 token，从 rollout token_count 的 `last_token_usage.total_tokens` 累加。
- 列表 UX 当前以今日 token 为主数字，历史 token 为副行。
- token 显示单位：小于 1B 用 M，大于等于 1B 用 B，例如 `223M`、`2.02B`。

quota：

- 从最新 rollout `token_count.rate_limits` 获取。
- Claude Desktop/Cowork 额外读取本地 Chromium Cache 里的 `https://claude.ai/api/organizations/.../usage` 响应，解压 zstd 后映射 `five_hour` / `seven_day` 为统一 quota 信号；如果未来 statusline JSONL 直接落 `rate_limits`，也走同一解析链路。
- 当前展示实时可用 quota、本周可用 quota、刷新时间；存在多个 LLM 家族时按 GPT、Claude 等分组显示，每组取最新 rate limit 信号。
- 不再展示“单线程限流用量”，因为实际限制看总 quota。

通知：

- 硬待处理：
  - Codex unread/blue dot：`source = codex-unread`
  - OpenCode pending permission：`source = opencode-permission`
  - Claude explicit user/permission request：`source = <provider>-permission`（普通未完成 tool_use 不算硬待处理）
  - 这些会保留，直到信号消失、打开并标记处理、或手动处理。
- 软提醒：
  - 从“Agent final answer after latest user message”推断的新进展：`source = observed-completion`
  - 当前作为站内短暂软提醒展示，不触发 macOS 桌面通知；没有可靠已读回执时，不能把它当成硬待处理。

## 重要 UX 决策

- 这是工作台，不是营销页；信息密度优先，避免大 hero、装饰卡片、无用说明。
- 列表首屏要能扫出：
  - 哪些线程今天正在烧 token。
  - 哪些线程刚更新。
  - 哪些线程真正待处理。
  - 能否一键打开回到 Codex/OpenCode。
- “今日 token”比“历史 token”优先级更高，因为日常决策更关心今天花了多少。
- 通知必须隐私化，不在系统 Push 正文显示具体回话。
- Codex 侧边栏蓝点是“等待验收”的更可靠信号；纯 rollout completion 只能算“新进展”。
- 打开 Codex 线程优先走前端 `window.location.href = codex://...`，不要等本地 server round trip，否则体验慢。

## 最近修过的坑

- 旧问题：很多线程被误判为“等待验收”。
  - 原因：rollout final answer 被当成硬待处理。
  - 现在：只有 Codex unread / OpenCode permission / Claude permission 是硬待处理；observed completion 是短暂软提醒。
- 旧问题：桌面提醒通过 `osascript` 投递后，macOS 可能静默接收但不显示。
  - 现在：发布版本已屏蔽桌面提醒入口和投递逻辑，只保留站内待处理。
- 旧问题：同一线程标题显示成不对应的文字。
  - 原因：sqlite title 可能是旧 prompt，rollout 推断也可能误伤。
  - 现在：优先读 `session_index.jsonl` 的 `thread_name`，和 Codex 侧边栏保持一致。
- 旧问题：`2,015M` 可读性差。
  - 现在：超过 1B 自动显示为 B。
- 旧问题：线程列表只显示历史 token。
  - 现在：主数字显示今日 token，副行显示历史 token；项目排行也显示今日和历史。
- 旧问题：长标题撑爆列表。
  - 现在：线程标题 2 行截断，待处理标题 4 行截断。

## API

主要接口：

- `GET /api/dashboard`
  - 返回 summary、providers、projects、threads、notifications、performance。
- `GET /api/performance`
  - 返回本地进程内存、dashboard/通知耗时、cache 命中率和缓存条目数，不读取 Agent 元数据。
- `GET /api/notifications`
  - 刷新并返回通知，不触发桌面提醒。
- `POST /api/notifications`
  - 兼容旧调用，刷新并返回通知，不触发桌面提醒。
- `PATCH /api/notifications/:id`
  - 更新通知状态：`done`、`dismissed`、`snoozed` 等。
- `PATCH /api/notification-settings`
  - 当前返回 410，桌面提醒已禁用。
- `POST /api/notification-test`
  - 当前返回 410，桌面提醒已禁用。
- `POST /api/threads/:id/open`
  - server 侧打开线程 fallback。Codex deep link 在前端优先直接打开。

## 测试重点

每次改动后跑：

```bash
npm test
```

已有测试覆盖：

- Codex rollout token_count/rate_limit/user/final 解析。
- 今日 token 去重累加。
- rollout tail 扩容读取。
- running/fresh/warm/idle/archived 状态推断。
- session_index 标题优先。
- OpenCode CLI/Desktop session 解析。
- pending tool approval / todo 识别。
- 通知创建、过期、snooze、桌面提醒禁用保护。
- server API 行为。
- 前端文案、token 格式、长标题截断、deep link 快速打开。

## 新功能迭代建议

如果新功能涉及更多 provider：

- 先新增 provider adapter，输出和 Codex/OpenCode 一样的标准 thread shape。
- 再在 `src/dashboard.mjs` 聚合 provider。
- 尽量不要把 provider 特有逻辑塞到 `public/app.js`，前端只消费标准字段。

如果新功能涉及通知：

- 先区分“硬待处理”和“软提醒”。
- 硬待处理必须有可靠外部信号能清除。
- 软提醒不能长期挂在待处理里。
- 重新启用桌面提醒前，先换成可靠的原生通知 helper；不要回退到裸 `osascript`。

如果新功能涉及 token/quota：

- 优先明确是“今日新增”“历史累计”“当前 quota”还是“本轮 token”。
- 列表视图里不要同时放太多同级数字，优先级应为：今日 token > 状态/更新时间 > 历史 token。

如果新功能涉及标题/命名：

- Codex 标题优先级目前是 `session_index.thread_name` > sqlite `title` > rollout 推断。
- 不要直接用 rollout 最近用户消息覆盖已有短标题，否则会误伤已经命名的线程。

如果新功能涉及打开线程：

- Codex：优先使用 `codex://threads/<id>`。
- OpenCode Desktop：使用 `opencode://open-project?directory=<cwd>`。
- Claude Code CLI / Desktop Code：使用 Terminal 执行 `claude --resume <session_id>`。
- Claude Cowork：只能打开 Claude Desktop 应用；目前未发现稳定的单线程 deep link。
- 需要考虑“打开后是否标记通知已处理”的语义，只有从通知动作打开时默认标记。

## 给新线程的建议开场

可以这样开新线程：

```text
请先阅读本仓库的 SYSTEM_OVERVIEW.md 和相关源码。
我要在 Agent Mission Control 上迭代一个新功能。请先理解当前架构、数据来源、通知语义、token UX，再根据我的需求实现。
```
