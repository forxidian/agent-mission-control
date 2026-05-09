# Agent Mission Control

本地多 Agent 任务控制台，用来集中查看 Codex、OpenCode、Claude Code / Claude Desktop 等工具里的线程、项目、token 用量、运行状态、待处理事项和桌面提醒。

它默认只监听 `127.0.0.1`，只读取本机状态文件，不写入 Codex / OpenCode / Claude 的工作数据，也不发送遥测。

## 功能

- 汇总 Codex 本地线程、标题、项目、归档状态、模型、token 和 quota 信息。
- 汇总 OpenCode CLI / Desktop 会话，并识别待授权工具调用和 todo。
- 汇总 Claude Code CLI、Claude Desktop Code、Claude Cowork 会话。
- 支持按来源、状态、项目和关键词筛选。
- 支持打开 Codex / OpenCode deep link，或在 macOS Terminal 恢复 CLI 会话。
- 提供本地通知中心；系统桌面提醒只显示隐私化文案，不展示线程正文。

## 要求

- Node.js `>=20`
- macOS 推荐；Linux / Windows 可运行看板，但部分打开应用和桌面通知能力取决于系统命令
- 可选：`sqlite3` 命令，用于读取 Codex 本地 SQLite 状态
- 可选：`codex`、`opencode`、`claude` CLI，用于检测版本或恢复 CLI 会话

## 运行

```bash
git clone <your-repo-url>
cd agent-mission-control
npm start
```

打开：

```text
http://127.0.0.1:4629
```

可选环境变量：

```bash
PORT=4629 HOST=127.0.0.1 npm start
```

不要把 `HOST` 绑定到公网或不可信局域网地址，除非你已经评估过本机 Agent 元数据暴露风险。

## 数据来源

Codex：

- `~/.codex/state_5.sqlite`
- `~/.codex/session_index.jsonl`
- `~/.codex/sessions/**/rollout-*.jsonl`

OpenCode：

- `opencode session list --max-count 120 --format json`
- `~/Library/Application Support/ai.opencode.desktop/opencode.global.dat`
- OpenCode Desktop workspace state/cache 文件

Claude：

- `~/.claude/projects/**/*.jsonl`
- `~/Library/Application Support/Claude/claude-code-sessions/**/*.json`
- `~/Library/Application Support/Claude/local-agent-mode-sessions/**/*.json`
- 同目录下的 `audit.jsonl` 和 `spaces.json`

本项目自己的通知状态：

- `~/.agent-mission-control/notifications.json`

## 隐私

这个项目用于本地查看你的 Agent 工作状态。它可能在浏览器里展示线程标题、项目路径、最近消息信号、token 与 quota 信息。详见 [docs/PRIVACY.md](docs/PRIVACY.md)。

请不要提交本机状态文件、日志、数据库、`.env`、截图里的私密文本、cookie、token 或 API key。

## 开发

```bash
npm test
```

项目刻意保持轻依赖：当前没有外部 npm 依赖，主要使用 Node.js 内置 test runner、浏览器原生 API 和系统命令。

## 开源准备

这份仓库已按开源发布做过基础脱敏整理。发布前复核清单见 [docs/OPEN_SOURCE_PLAN.md](docs/OPEN_SOURCE_PLAN.md)。
