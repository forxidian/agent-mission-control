# Agent Review Workflow Technical Design

更新时间：2026-05-13

## 当前项目基础

Agent Mission Control 当前有三个适合承载该需求的基础层：

- Provider adapter：`src/codex-data.mjs`、`src/claude-data.mjs`、`src/opencode-data.mjs` 已经把不同 Agent 的本地状态归一化成 thread shape。
- Dashboard API：`src/server.mjs` 已经提供 `/api/dashboard`、通知 API 和打开线程 API。
- Thread detail UI：`public/app.js` 已经能展示单线程详情、最近用户/Agent 信号、恢复命令和“复制线程摘要”。

当前缺口：

- 没有 review job 数据模型。
- 没有读取“可评审内容”的统一接口。
- 没有把 prompt 投递给另一个 Agent 的 runner。
- 没有前端 review 发起、进度展示和结果查看。

## 已确认的本机 CLI 入口

2026-05-12 在当前开发机上已检查：

- `codex exec` 支持从 stdin 读取 prompt，支持 `-C/--cd`、`--sandbox`、`--output-last-message`、`--json`。当前 CLI 不支持旧设计里的 `--ask-for-approval never`；实测该 flag 会报 `unexpected argument`。MVP runner 应通过 `-c approval_policy="never"` 固定 non-interactive approval 行为，并继续使用 `--sandbox read-only`。
- `claude -p/--print` 支持非交互式输出，支持 `--output-format json`、`--permission-mode`、`--tools`。`--help` 未明确承诺 `-` stdin prompt 语义，MVP runner 应先使用 positional prompt；如需 stdin，必须在 smoke test 中确认。
- `opencode run` 支持非交互式运行，支持 `--dir`、`--format json`、`--model`、`--agent`。

实现 runner 前仍应在测试中通过 fake command 固定参数，并在手动 smoke test 中用真实 CLI 跑一次最小 prompt，防止用户机器上的 CLI 版本不同。

## 设计原则

- 本地优先：只调用本机 CLI，不接入远程编排服务。
- 不写第三方状态：不修改 Codex、Claude、OpenCode 的原始状态文件。
- 轻依赖：优先使用 Node.js 内置模块和现有浏览器原生能力。
- 显式隐私边界：默认使用短内容，完整正文必须由用户确认。
- 可审计：每次 review job 记录源线程、目标 Agent、模板、状态、时间和结果。
- 可降级：如果目标 CLI 不存在，UI 显示不可用，不影响 dashboard 读取。
- Workflow 优先：跨 Agent 协作应以 Review、Fix、Verify、Memory 等可收敛 workflow 组织，而不是无边界群聊。详细原则见 [Agent Loop Principles](agent-loop-principles.md)。

## 建议文件结构

```text
src/review-content.mjs      从标准 thread 和 provider 本地文件中提取可评审内容
src/review-jobs.mjs         review job store、状态机、JSONL 持久化
src/review-runners.mjs      Codex / Claude / OpenCode runner
src/review-prompts.mjs      评审模板和 prompt 组装
test/review-content.test.mjs
test/review-jobs.test.mjs
test/review-runners.test.mjs
test/server-review.test.mjs
```

前端优先继续放在 `public/app.js`，等交互复杂度明显上升后再拆文件。

## 数据模型

### ReviewJob

```js
{
  id: 'review_1778515200000_abcd',
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled',
  createdAtMs: 1778515200000,
  updatedAtMs: 1778515230000,
  startedAtMs: 1778515205000,
  completedAtMs: 1778515230000,
  source: {
    threadId: '...',
    provider: 'codex',
    providerLabel: 'Codex',
    title: '...',
    cwd: '...',
    model: '...'
  },
  target: {
    provider: 'claude-code-cli',
    model: 'sonnet',
    runner: 'claude-print'
  },
  templateId: 'technical-review',
  inputMode: 'latest-agent-signal' | 'latest-turn' | 'thread-summary',
  inputPreview: 'truncated text for UI',
  resultText: '...',
  resultPreview: '...',
  error: '',
  stderr: '',
  timedOut: false,
  truncatedResult: false,
  exitCode: 0
}
```

MVP 不保存 `promptHash`。如果后续需要去重、审计 prompt 版本或复现 runner 输入，再引入 hash 字段。

### 持久化

MVP 使用 JSONL：

```text
~/.agent-mission-control/reviews.jsonl
```

每次状态变化 append 一条完整 job snapshot。读取时按 `id` 取最后一条。

实现要求：

- 同一进程内通过一个 promise queue 串行化 append 和 compact，避免当前 server 进程内并发写入乱序。
- 明确记录限制：MVP 不处理多个 Mission Control 进程同时写入同一个 JSONL 文件；如果要支持，需要后续增加文件锁或迁移 sqlite。
- 读取时如果 snapshot 数超过阈值，例如 1,000 行，触发 compact：按 `id` 保留最新 snapshot，写入临时文件后 rename 替换原文件。
- 保存 `resultText`、`resultPreview`、`stderr` 前必须按上限截断。建议常量：`MAX_RESULT_CHARS = 24000`、`MAX_STDERR_CHARS = 4000`、`MAX_PREVIEW_CHARS = 800`。

原因：

- 简单。
- 易调试。
- 符合现有项目轻依赖方向。
- 不需要引入 sqlite 写入层。

## API 设计

### `GET /api/reviews`

返回最近 review jobs。

查询参数：

- `limit`：默认 50，最大 200。
- `threadId`：可选，按源线程筛选。

返回：

```js
{
  items: [ReviewJob],
  summary: {
    total: 12,
    running: 1,
    failed: 0
  }
}
```

### `GET /api/review-targets`

返回当前机器可用的 review target。前端必须从该接口渲染目标 Agent 列表，而不是硬编码。

返回：

```js
{
  items: [
    {
      provider: 'codex-cli',
      label: 'Codex CLI',
      runner: 'codex-exec',
      available: true,
      message: '已检测到 codex'
    },
    {
      provider: 'claude-code-cli',
      label: 'Claude Code CLI',
      runner: 'claude-print',
      available: false,
      message: '未检测到 claude CLI'
    }
  ]
}
```

### `GET /api/threads/:id/review-content`

返回指定线程可用于评审的内容预览。

查询参数：

- `mode=latest-agent-signal`：只使用 dashboard 已经展示的最近 Agent 输出信号。
- `mode=thread-summary`：使用 Mission Control 标准 thread 字段生成摘要，并附带最近用户/Agent 信号。
- `mode=latest-turn`：读取 provider 支持的本地 transcript，提取最近一轮 user -> Agent final answer。

返回：

```js
{
  threadId: '...',
  mode: 'latest-agent-signal' | 'latest-turn' | 'thread-summary',
  content: '...',
  preview: '...',
  truncated: false,
  sourceDescription: '最近 Agent 输出信号'
}
```

错误语义：

- 缺少线程返回 404。
- 空的 `latest-agent-signal`、缺失 Codex `rolloutPath`、无法解析最近完整 turn、或 provider 暂不支持 `latest-turn` 返回 422。
- malformed JSONL 行必须跳过，不应让整个 preview 失败。

### `POST /api/reviews`

创建并启动一次 review job。

请求：

```js
{
  sourceThreadId: '...',
  targetProvider: 'claude-code-cli',
  targetModel: 'sonnet',
  templateId: 'technical-review',
  inputMode: 'latest-agent-signal' | 'latest-turn' | 'thread-summary'
}
```

返回：

```js
{
  job: ReviewJob
}
```

### `GET /api/reviews/:id`

返回单个 job 最新状态。

## Review content extraction

### P0：只使用标准 thread 字段

优先级：

1. `thread.lastAgentMessage`
2. 如果没有 Agent 输出，返回 422，提示该线程暂无可评审的 Agent 输出。

P0 不读取完整 JSONL 正文，降低隐私和解析复杂度。

`thread-summary` 不放入 P0 fallback。原因是用户要求评审的是另一个 Agent 的“消息/回复”，线程摘要会混入状态、路径和 token 信息，容易让目标 Agent 评审对象变形。

### P1：thread-summary

`thread-summary` 不读取 provider transcript，只使用 Mission Control 当前 thread 标准字段：

- title / provider / project / cwd / model / status
- today token / historical token
- latest meaningful user signal
- latest Agent output signal

它适合在不扩大到完整 transcript 的情况下，让目标 Agent 理解线程上下文。内容仍会作为 prompt 的一部分发送给目标本地 CLI Agent。

### P1：latest-turn

按 provider 分开实现：

- Codex：支持。读取 `thread.rolloutPath` 的尾部 JSONL，解析最近 `user_message` 到 `agent_message` final answer 的完整 turn。读取从 512 KiB tail 起步；如果长 final answer 把对应 user message 挤出窗口，则按倍数渐进扩读，最高 16 MiB。prompt 内容上限为 24,000 字符，preview 上限为 800 字符；malformed JSONL 行会被忽略。
- Claude Code CLI：暂不支持自动定位。当前 `claude-data` 只提供 dashboard 所需的标准 thread 字段；没有稳定的 per-thread JSONL 路径暴露给 review extractor。P1 不猜 `~/.claude` 私有 cache，返回 422。
- OpenCode：暂不支持。P1 不猜内部 cache；如果后续有稳定 export 或 thread transcript path，再接入 extractor。当前返回 422。

这些限制是有意的本地状态边界：review extractor 只读 Mission Control 已知的 thread 字段和明确路径，不扫描或写入第三方 Agent 状态。

## Runner 设计

### Codex runner

命令：

```bash
codex exec -C <cwd> --sandbox read-only -c 'approval_policy="never"' --output-last-message <temp-file> -
```

输入通过 stdin 传入。

可选：

- `-m <model>`
- `--output-last-message <temp-file>`
- `--json` 用于后续更细粒度进度。

### Claude runner

命令：

```bash
claude -p <prompt> --output-format json --permission-mode dontAsk --tools ""
```

当前 Claude Code CLI 版本要求 prompt 紧跟 `-p/--print`。如果把 prompt 放在所有 flags 后面，CLI 会报 `Input must be provided either through stdin or as a prompt argument when using --print`。

建议默认禁用工具，避免评审任务意外读写文件。需要代码上下文时，再让用户选择允许工具或 add-dir。不要依赖 shell 拼接；用 `spawn`/`execFile` 参数数组传递 prompt，因此 prompt 中的换行或 `--` 文本会作为同一个参数传入，不会被 shell 重新解析为 CLI flag。

### OpenCode runner

命令：

```bash
opencode run --dir <cwd> --format json <prompt>
```

如果目标机器没有 OpenCode CLI，provider runner 标记 unavailable。

### Runner 超时和错误处理

- 每个 runner 必须设置 timeout，MVP 默认 5 分钟。
- 超时后 job 更新为 `failed`，设置 `timedOut: true`，`error` 写入明确超时文案。
- 非 0 exit code 不抛到 HTTP 进程顶层；runner 返回 failure metadata，由 job store 保存。
- 保存 stdout/stderr 时必须截断，避免无限增长。
- Runner 默认只做评审，不允许写文件。需要工具权限或目录读写时放到后续版本单独设计。

## Prompt 模板

模板放在 `src/review-prompts.mjs`。

MVP 模板：

- `code-review`
- `technical-review`
- `product-review`
- `response-quality-review`

模板输出要求统一：

```text
请按下面结构输出：

1. 总体结论
2. 主要问题
3. 风险和遗漏
4. 建议修改
5. 是否建议采纳原输出
```

## 前端改动

### Thread detail

在 `renderDetail(thread)` 的“下一步动作”里新增按钮：

```text
交给另一个 Agent 评审
```

点击后打开轻量面板或 dialog：

- 源线程标题。
- 输入模式：最近 Agent 输出、线程摘要和最近输出；Codex 线程额外显示最近一轮对话。
- 目标 Agent，从 `GET /api/review-targets` 获取。
- 评审模板。
- 输入预览。
- 隐私提示：`latest-turn` 会读取并发送更多本地会话内容给目标 CLI Agent。
- 确认按钮。

### Review panel

MVP 先放在线程详情页下方，作为 inline panel，不引入全局 modal。这样符合当前单文件 vanilla JS 结构，状态也更容易绑定到选中的 thread。

- 最近 review jobs。
- running / succeeded / failed 状态。
- 结果预览。
- 复制结果。
- 打开源线程。
- 失败时展示 `error` 和截断后的 `stderr`。

Review job 状态通过 polling 刷新：

- 复用当前 dashboard 的自动刷新节奏，或者在存在 running review job 时每 5 秒请求 `GET /api/reviews?threadId=<id>`。
- 不引入 WebSocket。
- 创建 job 后立即把返回的 job 插入本地 state，再进入轮询。

后续再升级成独立“Agent 评审”面板。

## 测试策略

### Unit tests

- `review-prompts`：不同模板生成稳定 prompt。
- `review-content`：缺少 lastAgentMessage 时返回 422 风格错误，不悄悄 fallback 成线程摘要；覆盖 `thread-summary`、Codex `latest-turn`、unsupported provider 422、截断和 malformed JSONL 容错。
- `review-jobs`：JSONL append、读取、按 id 去重、状态更新、compact、结果/stderr 截断。
- `review-runners`：使用 fake `runCommand` 验证命令参数、stdin、timeout 和错误 metadata，不调用真实 CLI。

### Server tests

- `POST /api/reviews` 创建 job。
- `GET /api/review-targets` 返回可用和不可用 target。
- 目标 provider 不可用时返回明确错误。
- `GET /api/reviews` 返回最新 job snapshot。
- `GET /api/threads/:id/review-content` 找不到线程时返回 404。
- `GET /api/threads/:id/review-content` 没有 Agent 输出时返回 422。
- `GET /api/threads/:id/review-content?mode=thread-summary` 返回摘要内容。
- `GET /api/threads/:id/review-content?mode=latest-turn` 对 Codex 返回最近 turn，对不支持 provider 返回 422。
- `POST /api/reviews` 支持 `latest-turn` / `thread-summary` input mode。
- `POST /api/reviews` 先校验目标 Agent 可用性，再读取 review input，避免无效目标触发额外本地 transcript 读取。

### Frontend copy tests

更新 `test/public-copy.test.mjs`，确保新增按钮、input mode selector 文案和隐私提示存在。

## 实施顺序

1. 增加 review prompt 模板和测试。
2. 增加 review content P0 提取和测试。
3. 增加 review job store、compact、截断和测试。
4. 增加 runner abstraction、target discovery、timeout 和 fake command 测试。
5. 增加 server API 和测试。
6. 增加前端发起 review 的 inline panel。
7. 增加 review 结果展示、失败展示、polling 和复制。
8. 更新 `docs/PRIVACY.md`。
9. 跑 `npm test`。

## 风险

- CLI 输出格式变化：runner 必须容忍非 JSON 输出，至少能保存 stdout/stderr。
- 用户机器上的 CLI 版本不同：实现前和 smoke test 时要验证 `codex exec`、`claude -p`、`opencode run` 的实际参数。
- 长 prompt 成本：默认输入必须短，完整正文要用户确认。
- 长输出成本：结果和 stderr 必须截断后保存和展示。
- 权限误用：评审 runner 默认不应允许写文件。
- 后台任务挂起：runner 必须设置超时。
- 多进程写入 JSONL：MVP 只保证单 Mission Control 进程内串行写入，多进程并发作为已知限制。
- UI 复杂度膨胀：MVP 不做完整群聊，只做单次 review job。
- 用户误以为结果已回写原线程：UI 必须明确“复制结果”或“打开源线程继续处理”。

## 推荐 MVP 判定

当用户能完成下面流程，即可认为 MVP 成立：

1. 打开一个 Codex 线程详情。
2. 点击“交给另一个 Agent 评审”。
3. 选择 Claude Code CLI 和“技术方案审查”。
4. 等待评审完成。
5. 在 Mission Control 中看到评审结果。
6. 复制评审结果，粘回 Codex 继续处理。
