# Privacy

Agent Mission Control runs locally and does not send telemetry.

What it reads:

- Codex local state under `~/.codex`
- OpenCode CLI output or desktop state under
  `~/Library/Application Support/ai.opencode.desktop`
- Claude Code and Claude Desktop metadata under `~/.claude` and
  `~/Library/Application Support/Claude`
- Its own notification state under `~/.agent-mission-control`

What it may display locally:

- Thread titles, project names, working directories, models, status, token
  usage, quota samples, and recent user/final-message signals needed for the
  dashboard
- Pending permission or review signals
- The optional macOS menu bar helper shows only aggregate pending/progress
  counts and does not display thread titles or message text

What it avoids:

- Writing to Codex, OpenCode, or Claude state
- Publishing data externally
- Sending desktop/system notifications in the public release

Keep `HOST` at the default `127.0.0.1` unless you fully understand the privacy
tradeoff. Binding the server to a LAN or public interface can expose local
agent metadata to other machines.
