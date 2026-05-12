# Privacy

Agent Mission Control runs locally and does not send telemetry.

What it reads:

- Codex local state under `~/.codex`
- OpenCode CLI output or desktop state under
  `~/Library/Application Support/ai.opencode.desktop`
- Claude Code and Claude Desktop metadata under `~/.claude` and
  `~/Library/Application Support/Claude`
- Claude Desktop's local Chromium cache entry for the Claude usage endpoint,
  used only to read aggregate rate-limit percentages and reset times
- Its own notification state under `~/.agent-mission-control`
- Its own review job state under `~/.agent-mission-control/reviews.jsonl`

What it may display locally:

- Thread titles, project names, working directories, models, status, token
  usage, quota samples, and recent user/final-message signals needed for the
  dashboard
- Pending permission or review signals
- Review job status, source/target Agent metadata, selected input preview,
  stderr snippets, and truncated review results stored locally in
  `~/.agent-mission-control/reviews.jsonl`
- The optional macOS menu bar helper shows only aggregate pending/progress
  counts and does not display thread titles or message text

Review workflow:

- When you start a review job, Agent Mission Control sends the selected
  thread's current preview content to another local CLI Agent such as Codex
  CLI, Claude Code CLI, or OpenCode CLI.
- The P0 review input is the recent Agent output signal already shown in the
  dashboard. It does not read complete provider transcripts or write back to
  Codex, OpenCode, or Claude state.
- Review job metadata and results are stored only in Agent Mission Control's
  own local state file: `~/.agent-mission-control/reviews.jsonl`.
- Future complete-transcript review modes would expand local data exposure and
  should require an explicit confirmation before sending that larger content to
  a target CLI Agent.

What it avoids:

- Writing to Codex, OpenCode, or Claude state
- Publishing data externally
- Caching dashboard API payloads in the PWA service worker
- Sending desktop/system notifications in the public release

Keep `HOST` at the default `127.0.0.1` unless you fully understand the privacy
tradeoff. Binding the server to a LAN or public interface can expose local
agent metadata to other machines.
