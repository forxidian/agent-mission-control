# Agent Loop 进化 / Agent Mission Control

This repository is the working project for Agent Loop 进化. When a new thread is opened in this project and the user says "这个系统", "这个控制台", "Agent 任务控制台", "Agent Loop 进化", or "咱们这个项目", assume they mean this repository unless they explicitly point to another path.

## Start Here

- First read `SYSTEM_OVERVIEW.md` for current architecture, data sources, UX decisions, and known pitfalls.
- Then read `README.md` for public-facing positioning and open-source expectations.
- If the task touches privacy, release readiness, or GitHub publishing, also read `docs/PRIVACY.md` and `docs/OPEN_SOURCE_PLAN.md`.

## Product Context

Agent Mission Control is a local, read-only dashboard for tracking Codex, OpenCode, Claude Code, and related agent sessions. It helps the user see active threads, token usage, quota state, pending review/permission work, and recovery links across tools.

The release target is a GitHub-friendly open-source version. Be conservative about privacy:

- Do not commit local Codex/OpenCode/Claude state, logs, screenshots with private text, cookies, tokens, API keys, or machine-specific secrets.
- Prefer mock data for public screenshots and examples.
- Keep defaults local-only, especially `HOST=127.0.0.1`.

## Development Rules

- Use existing patterns in `src/*`, `public/*`, and `test/*`.
- Keep the app dependency-light unless the user explicitly approves adding a package.
- Run `npm test` after behavior changes.
- If a local dev server is needed, default to `npm start` and `http://127.0.0.1:4629`.
- After completing user-visible features, behavior changes, data source/API changes, notification semantics, or release work, check whether `SYSTEM_OVERVIEW.md`, `README.md`, and `CHANGELOG.md` need to be updated so future threads inherit the current project memory.
- Preserve user edits in the working tree; this repo is often dirty during iteration.

## Current Notification Stance

Desktop/system notifications are intentionally hidden for release until a reliable native notifier exists. Keep the in-app "待处理" notification center working, but do not expose a desktop reminder button or rely on script-based `osascript display notification` delivery for user-facing release behavior.

If desktop reminders are revisited later, implement them behind a clear native helper or reliable platform path, update tests, and document exactly what app owns the macOS notification permission.
