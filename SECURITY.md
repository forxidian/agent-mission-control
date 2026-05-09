# Security Policy

Agent Mission Control is designed for local, read-only use. It reads local
agent state files and serves a dashboard on `127.0.0.1` by default.

Please do not publish bug reports that include private thread titles, prompts,
rollout logs, local databases, cookies, API keys, or screenshots containing
private work. If GitHub private vulnerability reporting is enabled for the
repository, use that for security-sensitive reports.

Before sharing diagnostics, remove:

- `~/.codex/**`
- `~/.claude/**`
- `~/Library/Application Support/Claude/**`
- `~/Library/Application Support/ai.opencode.desktop/**`
- `~/.agent-mission-control/**`
- Any `.env`, database, JSONL log, cookie, token, or key files
