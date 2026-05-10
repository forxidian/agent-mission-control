# Changelog

All notable changes to Agent Mission Control are documented here.

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
