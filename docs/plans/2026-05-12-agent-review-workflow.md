# Agent Review Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local cross-Agent review workflow that lets a user send one Agent thread's recent output to another local Agent for review and view the result in Agent Mission Control.

**Architecture:** Add a review job layer beside the existing read-only dashboard. The dashboard remains provider-read-only, while review jobs are stored only under Agent Mission Control's own local state directory and executed through local CLI runners.

**Tech Stack:** Node.js ESM, Node built-in test runner, local CLI commands (`codex exec`, `claude -p`, `opencode run`), vanilla browser JavaScript.

---

### Task 0: Verify Local CLI Compatibility

**Files:**
- No code changes

**Step 1: Check Codex CLI**

Run:

```bash
codex exec --help
```

Confirm support for:

- `-C/--cd`
- `--sandbox read-only`
- `--ask-for-approval never`
- `--output-last-message`
- stdin prompt via `-`

**Step 2: Check Claude CLI**

Run:

```bash
claude --help
```

Confirm support for:

- `-p/--print`
- `--output-format json`
- `--permission-mode dontAsk`
- `--tools ""`
- positional prompt support for non-interactive mode

Do not assume `claude -p -` means stdin unless a manual smoke test confirms it on the current CLI version.

**Step 3: Check OpenCode CLI**

Run:

```bash
opencode run --help
```

Confirm support for:

- `--dir`
- `--format json`
- `--model`
- `--agent`

**Step 4: Record differences**

If any current machine differs from the design document, update `docs/agent-review-workflow-technical-design.md` before implementing runners.

### Task 1: Add Prompt Templates

**Files:**
- Create: `src/review-prompts.mjs`
- Test: `test/review-prompts.test.mjs`

**Step 1: Write failing tests**

Create tests for:

- `listReviewTemplates()` returns the four MVP templates.
- `buildReviewPrompt()` includes source metadata, review content, and a required output structure.
- Unknown template ids throw a useful error.

**Step 2: Run tests**

Run:

```bash
node --test test/review-prompts.test.mjs
```

Expected: fails because module does not exist.

**Step 3: Implement templates**

Implement:

- `code-review`
- `technical-review`
- `product-review`
- `response-quality-review`

**Step 4: Verify**

Run:

```bash
node --test test/review-prompts.test.mjs
```

Expected: pass.

### Task 2: Add Review Content Extraction

**Files:**
- Create: `src/review-content.mjs`
- Test: `test/review-content.test.mjs`

**Step 1: Write failing tests**

Cover:

- Latest agent signal mode uses `thread.lastAgentMessage`.
- Empty agent signal returns a 422-style error; do not silently use thread summary in P0.
- Returned content includes `preview`, `truncated`, and `sourceDescription`.
- Missing thread returns a not-found style error from helper.

**Step 2: Run tests**

Run:

```bash
node --test test/review-content.test.mjs
```

Expected: fails because module does not exist.

**Step 3: Implement P0 extractor**

Support only:

- `latest-agent-signal`

Do not parse full provider JSONL yet.
Do not implement `thread-summary` in P0; keep it documented as P1.

**Step 4: Verify**

Run:

```bash
node --test test/review-content.test.mjs
```

Expected: pass.

### Task 3: Add Review Job Store

**Files:**
- Create: `src/review-jobs.mjs`
- Test: `test/review-jobs.test.mjs`

**Step 1: Write failing tests**

Cover:

- Creating a job creates a stable `review_` id.
- Appending snapshots to JSONL and reading latest snapshots by id.
- Updating status to `running`, `succeeded`, and `failed`.
- Limiting recent jobs.
- Compacting JSONL snapshots after a threshold by keeping the latest snapshot per job id.
- Truncating `resultText`, `resultPreview`, and `stderr`.

**Step 2: Run tests**

Run:

```bash
node --test test/review-jobs.test.mjs
```

Expected: fails because module does not exist.

**Step 3: Implement store**

Default path:

```text
~/.agent-mission-control/reviews.jsonl
```

Tests should use temp directories.
Use a single-process promise queue for append and compact operations. Document that MVP does not support multiple Mission Control processes writing to the same JSONL file at once.

**Step 4: Verify**

Run:

```bash
node --test test/review-jobs.test.mjs
```

Expected: pass.

### Task 4: Add Runner Abstraction

**Files:**
- Create: `src/review-runners.mjs`
- Test: `test/review-runners.test.mjs`

**Step 1: Write failing tests**

Use fake `runCommand` functions. Cover:

- Codex runner calls `codex exec` with stdin prompt and read-only sandbox.
- Claude runner calls `claude -p`.
- OpenCode runner calls `opencode run`.
- Target discovery reports available and unavailable runners.
- Missing provider throws a useful error.
- Non-zero exit is captured as failure metadata.
- Timeout returns failure metadata with `timedOut: true`.
- stdout and stderr are truncated before returning metadata.

**Step 2: Run tests**

Run:

```bash
node --test test/review-runners.test.mjs
```

Expected: fails because module does not exist.

**Step 3: Implement runners**

Keep implementation side-effect-light and injectable:

- `runReviewWithProvider({ provider, prompt, cwd, model, runCommand })`
- `listReviewTargets({ commandVersion })`

Default runner timeout: 5 minutes.

**Step 4: Verify**

Run:

```bash
node --test test/review-runners.test.mjs
```

Expected: pass.

### Task 5: Add Server APIs

**Files:**
- Modify: `src/server.mjs`
- Test: `test/server-review.test.mjs`

**Step 1: Write failing API tests**

Cover:

- `GET /api/review-targets`
- `GET /api/threads/:id/review-content`
- `POST /api/reviews`
- `GET /api/reviews`
- `GET /api/reviews/:id`

Use fake dashboard, fake job store, and fake runner.

**Step 2: Run tests**

Run:

```bash
node --test test/server-review.test.mjs
```

Expected: fails because routes do not exist.

**Step 3: Implement routes**

Add optional dependencies to `createServer()`:

- `reviewStore`
- `runReview`
- `loadReviewTargets`

Keep route code readable by adding small helper functions inside `server.mjs`, for example:

- `findDashboardThread(dashboard, threadId)`
- `handleReviewTargetsRoute(...)`
- `handleReviewContentRoute(...)`
- `handleReviewsRoute(...)`

`GET /api/threads/:id/review-content` should call `loadDashboard()` and locate the thread from `dashboard.threads`. It should return 404 when the thread id is unknown and 422 when the thread has no reviewable Agent output.

Do not block `/api/dashboard` on review runner availability.

**Step 4: Verify**

Run:

```bash
node --test test/server-review.test.mjs
```

Expected: pass.

### Task 6: Add Frontend Review UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/public-copy.test.mjs`

**Step 1: Add copy tests**

Assert that the UI includes:

- `交给另一个 Agent 评审`
- Review privacy hint text.
- `复制评审结果`

**Step 2: Run tests**

Run:

```bash
node --test test/public-copy.test.mjs
```

Expected: fails until UI text exists.

**Step 3: Implement UI**

Add to thread detail:

- Review action button.
- Target provider selector.
- Template selector.
- Input preview.
- Submit button.
- Review results list.

Use an inline panel under the selected thread detail, not a full modal. Fetch target providers from `GET /api/review-targets`. Fetch review jobs with `GET /api/reviews?threadId=<id>`. When any job is running, poll every 5 seconds; otherwise rely on the normal dashboard refresh and explicit user actions.

**Step 4: Verify**

Run:

```bash
node --test test/public-copy.test.mjs
```

Expected: pass.

### Task 7: Update Privacy Documentation

**Files:**
- Modify: `docs/PRIVACY.md`

**Step 1: Update docs**

Document:

- Review jobs can send selected local thread content to another local CLI Agent.
- Review job metadata and results are stored in `~/.agent-mission-control/reviews.jsonl`.
- Complete transcript mode, when added, expands local data exposure and requires confirmation.

**Step 2: Review**

Read the updated privacy doc and confirm it does not imply remote telemetry.

### Task 8: Full Verification

**Files:**
- All changed files

**Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

**Step 2: Manual smoke test**

Run:

```bash
npm start
```

Open:

```text
http://127.0.0.1:4629
```

Verify:

- Existing dashboard still loads.
- Existing thread open/copy controls still work.
- Review button appears in thread detail.
- Review job can be created with a fake or real local runner.

**Step 3: Commit**

Commit in three practical groups:

```bash
git add src/review-*.mjs test/review-*.test.mjs src/server.mjs test/server-review.test.mjs
git commit -m "feat: add review job backend"
```

```bash
git add public/app.js public/styles.css test/public-copy.test.mjs
git commit -m "feat: add review workflow UI"
```

```bash
git add docs/PRIVACY.md
git commit -m "docs: update privacy for review workflow"
```
