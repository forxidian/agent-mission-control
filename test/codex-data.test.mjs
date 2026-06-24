import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  applySessionIndexTitles,
  applyCodexPinnedThreadIds,
  deriveCodexThreadTitle,
  loadCodexDashboard,
  parseCodexPinnedThreadIds,
  parseRolloutArtifacts,
  parseSessionIndex,
  parseRolloutSignals,
  readThreads,
  readRolloutSignals,
} from '../src/codex-data.mjs';

const execFileAsync = promisify(execFile);

async function createCodexStateDb(rowCount) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-codex-state-'));
  const databasePath = path.join(dir, 'state.sqlite');
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const number = index + 1;
    const timestamp = 1_800_000_000_000 - index;
    return `(
      'thread-${number}',
      '/tmp/rollout-${number}.jsonl',
      ${Math.floor(timestamp / 1000)},
      ${Math.floor(timestamp / 1000)},
      'vscode',
      'openai',
      '/tmp/project',
      'Thread ${number}',
      'workspace-write',
      'never',
      ${number},
      0,
      '',
      '',
      '',
      '0.0.0',
      '',
      null,
      null,
      'enabled',
      'gpt-5.5',
      '',
      ${timestamp},
      ${timestamp}
    )`;
  }).join(',');

  const insertSql = rows ? `
    insert into threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, archived, git_sha, git_branch,
      git_origin_url, cli_version, first_user_message, agent_nickname, agent_role,
      memory_mode, model, reasoning_effort, created_at_ms, updated_at_ms
    ) values ${rows};
  ` : '';

  const sql = `
    create table threads (
      id text primary key,
      rollout_path text not null,
      created_at integer not null,
      updated_at integer not null,
      source text not null,
      model_provider text not null,
      cwd text not null,
      title text not null,
      sandbox_policy text not null,
      approval_mode text not null,
      tokens_used integer not null default 0,
      archived integer not null default 0,
      git_sha text,
      git_branch text,
      git_origin_url text,
      cli_version text not null default '',
      first_user_message text not null default '',
      agent_nickname text,
      agent_role text,
      memory_mode text not null default 'enabled',
      model text,
      reasoning_effort text,
      created_at_ms integer,
      updated_at_ms integer
    );
    ${insertSql}
  `;
  await execFileAsync('sqlite3', [databasePath, sql]);

  return databasePath;
}

async function createEmptyCodexStateDb() {
  return createCodexStateDb(0);
}

test('reads the full Codex thread window by default for the dashboard', async () => {
  const databasePath = await createCodexStateDb(181);

  const rows = await readThreads({ databasePath });

  assert.equal(rows.length, 181);
});

test('indexes recent Codex rollout sessions before sqlite registers the thread', async (t) => {
  const databasePath = await createEmptyCodexStateDb();
  const sessionsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-sessions-'));
  const sessionIndexPath = path.join(sessionsDir, 'missing-session-index.jsonl');
  const rolloutDir = path.join(sessionsDir, '2026', '06', '16');
  const threadId = '019ecefe-3206-7f51-816b-79b2a0f56c4e';
  const rolloutPath = path.join(rolloutDir, `rollout-2026-06-16T13-53-46-${threadId}.jsonl`);
  t.after(() => fs.rm(sessionsDir, { recursive: true, force: true }));

  await fs.mkdir(rolloutDir, { recursive: true });
  await fs.writeFile(rolloutPath, [
    JSON.stringify({
      timestamp: '2026-06-16T05:54:08.063Z',
      type: 'session_meta',
      payload: {
        id: threadId,
        cwd: '/Users/example/Agent Loop进化',
        source: 'vscode',
        model_provider: 'openai',
        cli_version: '0.0.0-test',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-16T05:54:08.211Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: '这块布局简化合并一下，把空间让出来一些，让底下的搜索框能恰好出现在第一屏。',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-16T06:01:37.677Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '已改好。', phase: 'final_answer' },
    }),
  ].join('\n'));

  const dashboard = await loadCodexDashboard({
    databasePath,
    sessionsDir,
    sessionIndexPath,
    maxOrphanRollouts: 20,
    maxRollouts: 20,
    nowMs: Date.parse('2026-06-16T06:05:00.000Z'),
  });
  const thread = dashboard.threads.find((item) => item.id === threadId);

  assert.ok(thread);
  assert.equal(thread.title, '这块布局简化合并一下，把空间让出来一些，让底下的搜索框能恰好出现在第一屏。');
  assert.equal(thread.cwd, '/Users/example/Agent Loop进化');
  assert.equal(thread.rolloutPath, rolloutPath);
  assert.equal(thread.latestMeaningfulUserMessage, '这块布局简化合并一下，把空间让出来一些，让底下的搜索框能恰好出现在第一屏。');
  assert.equal(thread.inCodexSidebar, false);
  assert.equal(thread.defaultOpenMode, 'codex-cli-resume');
});

test('parses latest token-count and rate-limit signals from rollout jsonl', () => {
  const jsonl = [
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 12,
            reasoning_output_tokens: 3,
            total_tokens: 112,
          },
          model_context_window: 258400,
        },
        rate_limits: {
          limit_id: 'codex',
          primary: {
            used_percent: 6,
            window_minutes: 300,
            resets_at: 1777373828,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'response_item',
      payload: { type: 'agent_message', text: 'Done. Ready for review.', phase: 'final_answer' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.totalTokenUsage.total_tokens, 112);
  assert.equal(signals.totalTokenUsage.cached_input_tokens, 40);
  assert.deepEqual(signals.totalTokenBreakdown, {
    total: 112,
    input: 60,
    cacheRead: 40,
    cacheWrite: 0,
    output: 9,
    reasoning: 3,
    uncategorized: 0,
  });
  assert.equal(signals.rateLimits.primary.used_percent, 6);
  assert.equal(signals.completionHint, true);
  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestMessageKind, 'agent');
});

test('extracts Codex thread artifacts across user and agent turns', () => {
  const imagePath = '/var/folders/tmp/codex-clipboard-demo.png';
  const htmlPath = '/Users/example/project/report.html';
  const mdPath = '/Users/example/project/notes.md';
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-06-17T08:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: [
          '# Files mentioned by the user:',
          '',
          `## codex-clipboard-demo.png: ${imagePath}`,
          '',
          '## My request for Codex:',
          '',
          '看一下这张图。',
        ].join('\n'),
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-17T08:01:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        message: `已生成 HTML 报告：${htmlPath}\n补充说明在 ${mdPath}\n预览链接：https://example.com/report.html`,
        phase: 'final_answer',
      },
    }),
    JSON.stringify({
      timestamp: '2026-06-17T08:03:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: '再参考 https://github.com/forxidian/agent-mission-control',
      },
    }),
  ].join('\n');

  const artifacts = parseRolloutArtifacts(jsonl);
  const signals = parseRolloutSignals(jsonl);

  assert.equal(artifacts.total, 5);
  assert.equal(artifacts.turns.length, 2);
  assert.deepEqual(artifacts.turns.map((turn) => turn.turn), [2, 1]);
  assert.deepEqual(artifacts.items.map((item) => item.type), ['link', 'link', 'markdown', 'html', 'image']);
  assert.equal(artifacts.items.find((item) => item.type === 'image').path, imagePath);
  assert.equal(artifacts.items.find((item) => item.type === 'html' && item.path).path, htmlPath);
  assert.equal(artifacts.items.find((item) => item.type === 'markdown').path, mdPath);
  assert.equal(artifacts.items.find((item) => item.type === 'link').url, 'https://github.com/forxidian/agent-mission-control');
  assert.equal(signals.artifacts.total, 5);
  assert.equal(signals.artifacts.items.length, 3);
  assert.equal(signals.artifacts.items[0].type, 'link');
});

test('extracts clean artifact URLs from Markdown links whose label is the URL', () => {
  const url = 'https://www.bilibili.com/toy/toy-patent-disclosures/index.html';
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-06-17T08:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        message: `预览链接：[${url}](${url})`,
        phase: 'final_answer',
      },
    }),
  ].join('\n');

  const artifacts = parseRolloutArtifacts(jsonl);

  assert.equal(artifacts.total, 1);
  assert.equal(artifacts.items[0].url, url);
  assert.equal(artifacts.items[0].title, 'index.html');
  assert.equal(artifacts.items[0].type, 'link');
  assert.equal(artifacts.items[0].typeLabel, 'URL');
});

test('sums today token usage from token-count events without duplicate limit rows', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-28T23:59:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1000 },
          last_token_usage: { total_tokens: 100 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1500 },
          last_token_usage: {
            input_tokens: 300,
            cached_input_tokens: 100,
            output_tokens: 200,
            total_tokens: 500,
          },
          model_context_window: 258400,
        },
        rate_limits: {
          limit_id: 'codex',
          primary: { used_percent: 10, resets_at: 1777460000 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.001Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1500 },
          last_token_usage: {
            input_tokens: 300,
            cached_input_tokens: 100,
            output_tokens: 200,
            total_tokens: 500,
          },
          model_context_window: 258400,
        },
        rate_limits: {
          limit_id: 'codex_bengalfox',
          primary: { used_percent: 0, resets_at: 1777460000 },
        },
      },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl, {
    todayStartMs: Date.parse('2026-04-29T00:00:00.000Z'),
  });

  assert.equal(signals.todayTokenUsage, 500);
  assert.deepEqual(signals.todayTokenBreakdown, {
    total: 500,
    input: 200,
    cacheRead: 100,
    cacheWrite: 0,
    output: 200,
    reasoning: 0,
    uncategorized: 0,
  });
  assert.equal(signals.latestRateLimitAtMs, 1777428000001);
  assert.equal(signals.modelContextWindow, 258400);
});

test('keeps previous valid Codex quota when a newer rate-limit payload is incomplete', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1500 },
          last_token_usage: { total_tokens: 500 },
        },
        rate_limits: {
          limit_id: 'codex',
          primary: { used_percent: 35, window_minutes: 300, resets_at: 1777460000 },
          secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1778000000 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:05:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1600 },
          last_token_usage: { total_tokens: 100 },
        },
        rate_limits: {
          limit_id: 'codex',
          primary: { window_minutes: 300, resets_at: 1777460000 },
          secondary: { window_minutes: 10080, resets_at: 1778000000 },
        },
      },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.rateLimits.primary.used_percent, 35);
  assert.equal(signals.rateLimits.secondary.used_percent, 12);
  assert.equal(signals.latestRateLimitAtMs, 1777428000000);
  assert.equal(signals.latestRateLimitSignalAtMs, 1777428300000);
  assert.equal(signals.rateLimitStale, true);
  assert.equal(signals.rateLimitStaleAtMs, 1777428300000);
});

test('expands rollout tail to recover previous valid quota after an incomplete latest signal', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-quota-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1500 },
          last_token_usage: { total_tokens: 500 },
        },
        rate_limits: {
          limit_id: 'codex',
          primary: { used_percent: 32, window_minutes: 300, resets_at: 1777460000 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:03:00.000Z',
      type: 'response_item',
      payload: { type: 'reasoning', encrypted_content: 'x'.repeat(2048) },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:05:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1600 },
          last_token_usage: { total_tokens: 100 },
        },
        rate_limits: {
          limit_id: 'codex',
          primary: { window_minutes: 300, resets_at: 1777460000 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:06:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
  ].join('\n');

  await fs.writeFile(rolloutPath, jsonl);

  const signals = await readRolloutSignals(rolloutPath, {
    initialBytes: 512,
    maxBytes: 8192,
  });

  assert.equal(signals.rateLimits.primary.used_percent, 32);
  assert.equal(signals.rateLimitStale, true);
});

test('expands the rollout tail until it covers today token events', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-today-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T00:30:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 700 },
          last_token_usage: { total_tokens: 700 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T01:00:00.000Z',
      type: 'response_item',
      payload: { type: 'reasoning', encrypted_content: 'x'.repeat(2048) },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
  ].join('\n');

  await fs.writeFile(rolloutPath, jsonl);

  const signals = await readRolloutSignals(rolloutPath, {
    initialBytes: 128,
    maxBytes: 8192,
    todayStartMs: Date.parse('2026-04-29T00:00:00.000Z'),
  });

  assert.equal(signals.todayTokenUsage, 700);
  assert.equal(signals.latestAgentFinalAtMs, 1777428000000);
});

test('tracks a later user message after an agent final answer', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:36:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '再改一下' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestUserMessageAtMs, 1777444560000);
  assert.equal(signals.latestMessageKind, 'user');
});

test('tracks meaningful user text for stale long Codex titles', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:30:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: '我一个信得过的朋友给我分享了一个他最近在做的套利的交易系统，然后我也想进行复刻尝试。',
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:36:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '继续' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:40:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '但我已经有80份，成本0.9760的底仓' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.firstUserMessage, '我一个信得过的朋友给我分享了一个他最近在做的套利的交易系统，然后我也想进行复刻尝试。');
  assert.equal(signals.latestUserMessage, '但我已经有80份，成本0.9760的底仓');
  assert.equal(signals.latestMeaningfulUserMessage, '但我已经有80份，成本0.9760的底仓');
});

test('uses rollout user context only when the stored Codex title is missing or placeholder', () => {
  assert.equal(
    deriveCodexThreadTitle('未命名任务', {
      latestMeaningfulUserMessage: '回执部分：重复信息不需要每次都发，发一次就行了',
      firstUserMessage: '我一个信得过的朋友给我分享了一个他最近在做的套利的交易系统。',
    }),
    '回执部分：重复信息不需要每次都发，发一次就行了',
  );

  assert.equal(
    deriveCodexThreadTitle('管理多 Agent 线程', {
      latestMeaningfulUserMessage: '这个不应该覆盖短标题',
    }),
    '管理多 Agent 线程',
  );
});

test('summarizes Codex rich user messages with media and link placeholders', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-06-18T07:56:48.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: [
          '# Files mentioned by the user:',
          '',
          '## codex-clipboard-b73d2d87-e49e-4fbe-9aec-e7630d68f492.png: /var/folders/tmp/codex-clipboard-b73d2d87-e49e-4fbe-9aec-e7630d68f492.png',
          '',
          '## My request for Codex:',
          'https://git.example.com/rich-media-technology/toy-issue-tracker/-/issues/5',
          '',
          '给我们设计师加一下这个gitlab（rich-media-technology）读写权限',
          '',
          '设计师是',
          '',
          '零卡、渣渣喵、天才大人',
          '<image name=[Image #1] path="/var/folders/tmp/codex-clipboard-b73d2d87-e49e-4fbe-9aec-e7630d68f492.png">',
          '</image>',
        ].join('\n'),
      },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(
    signals.firstUserMessage,
    '[图片] [外部链接] 给我们设计师加一下这个gitlab（rich-media-technology）读写权限 设计师是 零卡、渣渣喵、天才大人',
  );
  assert.equal(signals.latestMeaningfulUserMessage, signals.firstUserMessage);
  assert.doesNotMatch(signals.firstUserMessage, /codex-clipboard|\/var\/folders|https?:\/\//);
});

test('uses rich user context instead of Codex clipboard image filenames for titles', () => {
  assert.equal(
    deriveCodexThreadTitle('codex-clipboard-b73d2d87-e49e-4fbe-9aec-e7630d68f492.png · 图片', {
      latestMeaningfulUserMessage: '[图片] [外部链接] 给我们设计师加一下这个gitlab（rich-media-technology）读写权限',
    }),
    '[图片] [外部链接] 给我们设计师加一下这个gitlab（rich-media-technology）读写权限',
  );
});

test('keeps media placeholders in titles derived from stored link text', () => {
  assert.equal(
    deriveCodexThreadTitle('https://git.example.com/rich-media-technology/issues/5 给我们设计师加一下这个gitlab（rich-media-technology）读写权限', {
      firstUserMessage: '[图片] [外部链接] 给我们设计师加一下这个gitlab（rich-media-technology）读写权限',
    }),
    '[图片] [外部链接] 给我们设计师加一下这个gitlab（rich-media-technology）读写权限',
  );
});

test('preserves stored Codex thread titles instead of replacing them with recent user text', () => {
  const storedThreadName = [
    'https://x.com/i/status/2065005648060797155',
    '',
    '调研一下，生成高辨识度，易用理解的网页报告',
  ].join('\n');
  const displayThreadName = '[外部链接] 调研一下，生成高辨识度，易用理解的网页报告';

  assert.equal(
    deriveCodexThreadTitle(storedThreadName, {
      latestMeaningfulUserMessage: 'OK，发布toy',
      latestUserMessage: '发布',
      firstUserMessage: 'OK，发布toy',
    }),
    displayThreadName,
  );
});

test('parses Codex session index titles used by the sidebar', () => {
  const index = parseSessionIndex([
    JSON.stringify({
      id: '019e07e7-192c-7941-b639-8d58d2e86b3a',
      thread_name: '调研 /goal 新命令',
      updated_at: '2026-05-08T14:04:31.849624Z',
    }),
    '{bad json}',
    JSON.stringify({ id: 'empty', thread_name: '' }),
  ].join('\n'));

  assert.equal(index.get('019e07e7-192c-7941-b639-8d58d2e86b3a'), '调研 /goal 新命令');
  assert.equal(index.has('empty'), false);
});

test('marks threads missing from the Codex sidebar index', () => {
  const rows = applySessionIndexTitles([
    { id: 'visible-thread', title: 'Stored title' },
    { id: 'hidden-thread', title: 'Old title' },
  ], new Map([
    ['visible-thread', 'Sidebar title'],
  ]));

  assert.equal(rows[0].thread_name, 'Sidebar title');
  assert.equal(rows[0].in_codex_sidebar, true);
  assert.equal(rows[1].thread_name, undefined);
  assert.equal(rows[1].in_codex_sidebar, false);
});

test('reads Codex native pinned thread ids from global state', () => {
  assert.deepEqual(parseCodexPinnedThreadIds({
    'pinned-thread-ids': ['thread-a', '', 12, 'thread-b', 'thread-a'],
  }), ['thread-a', 'thread-b']);
  assert.deepEqual(parseCodexPinnedThreadIds({}), []);
});

test('marks rows with Codex native pinned state', () => {
  const rows = applyCodexPinnedThreadIds([
    { id: 'thread-a', title: 'A' },
    { id: 'thread-b', title: 'B' },
  ], ['thread-b']);

  assert.equal(rows[0].pinned, false);
  assert.equal(rows[1].pinned, true);
});

test('keeps a thread in progress when commentary follows the latest user message', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:00:52.131Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '增加运行状态' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:01:13.213Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '我先看一下。', phase: 'commentary' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestUserMessageAtMs, 1777446052131);
  assert.equal(signals.latestMessageKind, 'agent');
});

test('ignores malformed rollout jsonl lines', () => {
  const signals = parseRolloutSignals('{bad json}\n{"type":"event_msg","payload":{"type":"message"}}');

  assert.equal(signals.totalTokenUsage, null);
  assert.equal(signals.rateLimits, null);
  assert.equal(signals.completionHint, false);
});

test('expands the rollout tail when bulky output hides the latest user turn', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:00:52.131Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '继续改状态' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:01:00.000Z',
      type: 'response_item',
      payload: { type: 'reasoning', encrypted_content: 'x'.repeat(2048) },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:01:13.213Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '我先看一下。', phase: 'commentary' },
    }),
  ].join('\n');

  await fs.writeFile(rolloutPath, jsonl);

  const signals = await readRolloutSignals(rolloutPath, {
    initialBytes: 128,
    maxBytes: 8192,
  });

  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestUserMessageAtMs, 1777446052131);
});
