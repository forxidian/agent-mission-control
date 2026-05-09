import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateProjects,
  buildDashboard,
  inferThreadStatus,
  normalizeThread,
} from '../src/insights.mjs';

test('normalizes sqlite thread rows into dashboard thread objects', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const thread = normalizeThread({
    id,
    title: 'Build report',
    cwd: '/Users/example/Documents/work',
    source: 'vscode',
    model: 'gpt-5.5',
    reasoning_effort: 'medium',
    tokens_used: 1200,
    has_unread_turn: 1,
    archived: 0,
    created_at: 1777420000,
    updated_at: 1777423600,
    rollout_path: '/tmp/rollout.jsonl',
    git_branch: 'main',
  }, 1777427200000);

  assert.equal(thread.id, id);
  assert.equal(thread.externalId, id);
  assert.equal(thread.provider, 'codex');
  assert.equal(thread.providerLabel, 'Codex');
  assert.equal(thread.projectName, 'work');
  assert.equal(thread.tokensUsed, 1200);
  assert.equal(thread.archived, false);
  assert.equal(thread.hasUnreadTurn, true);
  assert.equal(thread.status, 'warm');
  assert.equal(thread.createdAtMs, 1777420000000);
  assert.equal(thread.updatedAtMs, 1777423600000);
  assert.equal(thread.appDeepLink, `codex://threads/${id}`);
  assert.equal(thread.canOpen, true);
  assert.equal(thread.openLabel, '打开线程');
  assert.equal(thread.resumeCommand, `codex resume ${id}`);
});

test('prefers Codex sidebar thread names over stale sqlite titles', () => {
  const thread = normalizeThread({
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'OK，上述信息生成html并发布toy',
    thread_name: '调研 /goal 新命令',
    cwd: '/Users/example/Documents/work',
    archived: 0,
    created_at: 1777420000,
    updated_at: 1777423600,
  }, 1777427200000);

  assert.equal(thread.title, '调研 /goal 新命令');
});

test('infers running, fresh, warm, idle, and archived thread statuses', () => {
  const now = 1777427200000;

  assert.equal(inferThreadStatus({
    archived: false,
    updatedAtMs: now,
    latestUserMessageAtMs: now - 10 * 60 * 1000,
    latestAgentFinalAtMs: now - 20 * 60 * 1000,
  }, now), 'running');
  assert.equal(inferThreadStatus({ archived: false, updatedAtMs: now - 5 * 60 * 1000 }, now), 'fresh');
  assert.equal(inferThreadStatus({ archived: false, updatedAtMs: now - 2 * 60 * 60 * 1000 }, now), 'warm');
  assert.equal(inferThreadStatus({ archived: false, updatedAtMs: now - 2 * 24 * 60 * 60 * 1000 }, now), 'idle');
  assert.equal(inferThreadStatus({ archived: true, updatedAtMs: now }, now), 'archived');
});

test('aggregates active token usage by project', () => {
  const projects = aggregateProjects([
    { cwd: '/a/one', projectName: 'one', tokensUsed: 10, todayTokenUsage: 3, archived: false, updatedAtMs: 2000 },
    { cwd: '/a/one', projectName: 'one', tokensUsed: 20, todayTokenUsage: 4, archived: false, updatedAtMs: 3000 },
    { cwd: '/a/two', projectName: 'two', tokensUsed: 50, archived: true, updatedAtMs: 4000 },
  ]);

  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0], {
    cwd: '/a/one',
    projectName: 'one',
    threadCount: 2,
    tokensUsed: 30,
    todayTokensUsed: 7,
    latestUpdatedAtMs: 3000,
  });
});

test('builds summary counts and inbox candidates', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: '1',
      title: 'Running',
      cwd: '/a',
      projectName: 'a',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 60_000,
      latestUserMessageAtMs: now - 600_000,
      latestAgentFinalAtMs: now - 900_000,
    },
    {
      id: '2',
      title: 'Big',
      cwd: '/b',
      projectName: 'b',
      tokensUsed: 8_000_000,
      archived: false,
      updatedAtMs: now - 90_000_000,
      status: 'idle',
    },
    {
      id: '3',
      title: 'Old',
      cwd: '/c',
      projectName: 'c',
      tokensUsed: 100,
      archived: true,
      updatedAtMs: now - 90_000_000,
      status: 'archived',
    },
  ], now);

  assert.equal(dashboard.summary.activeThreads, 2);
  assert.equal(dashboard.summary.runningThreads, 1);
  assert.equal(dashboard.summary.archivedThreads, 1);
  assert.equal(dashboard.summary.totalTokensUsed, 8_000_200);
  assert.equal(dashboard.inbox.length, 2);
  assert.deepEqual(dashboard.inbox.map((item) => item.reason), ['running', 'high token usage']);
  assert.equal(dashboard.threads[0].status, 'running');
  assert.equal(dashboard.threads[0].currentTurnElapsedMs, 600_000);
});

test('prioritizes OpenCode permission requests in the inbox reason', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'opencode:ses_waiting',
      title: 'Waiting approval',
      cwd: '/a',
      projectName: 'a',
      provider: 'opencode',
      tokensUsed: 100,
      archived: false,
      awaitingPermission: true,
      openCodePendingToolCount: 1,
      updatedAtMs: now - 60_000,
      status: 'warm',
    },
  ], now);

  assert.equal(dashboard.inbox.length, 1);
  assert.equal(dashboard.inbox[0].reason, 'awaiting permission');
});

test('builds current quota and daily token summary from latest rate-limit signal', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: '1',
      title: 'Latest quota',
      cwd: '/a',
      projectName: 'a',
      tokensUsed: 100,
      todayTokenUsage: 700,
      archived: false,
      updatedAtMs: now - 60_000,
      rateLimitUpdatedAtMs: now - 1_000,
      rateLimits: {
        primary: { used_percent: 27, window_minutes: 300, resets_at: 1777430000 },
        secondary: { used_percent: 41, window_minutes: 10080, resets_at: 1778000000 },
      },
    },
    {
      id: '2',
      title: 'Older quota',
      cwd: '/b',
      projectName: 'b',
      tokensUsed: 300,
      todayTokenUsage: 50,
      archived: false,
      updatedAtMs: now - 90_000,
      rateLimitUpdatedAtMs: now - 30_000,
      rateLimits: {
        primary: { used_percent: 90, window_minutes: 300, resets_at: 1777429000 },
        secondary: { used_percent: 80, window_minutes: 10080, resets_at: 1777990000 },
      },
    },
    {
      id: '3',
      title: 'Archived tokens',
      cwd: '/c',
      projectName: 'c',
      tokensUsed: 500,
      todayTokenUsage: 10,
      archived: true,
      updatedAtMs: now - 120_000,
    },
  ], now);

  assert.equal(dashboard.summary.todayTokensUsed, 750);
  assert.equal(dashboard.summary.totalTokensUsed, 900);
  assert.equal(dashboard.summary.quota.realtime.availablePercent, 73);
  assert.equal(dashboard.summary.quota.realtime.usedPercent, 27);
  assert.equal(dashboard.summary.quota.realtime.resetsAtMs, 1777430000000);
  assert.equal(dashboard.summary.quota.weekly.availablePercent, 59);
  assert.equal(dashboard.summary.quota.weekly.windowMinutes, 10080);
  assert.equal(dashboard.summary.quota.observedAtMs, now - 1_000);
});
