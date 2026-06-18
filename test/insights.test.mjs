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
  assert.equal(thread.openLabel, '打开');
  assert.equal(thread.defaultOpenMode, 'codex-deeplink');
  assert.equal(thread.inCodexSidebar, true);
  assert.equal(thread.resumeCommand, `codex resume ${id}`);
});

test('prefers CLI resume for Codex threads missing from the sidebar index', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const thread = normalizeThread({
    id,
    title: 'Old hidden thread',
    cwd: '/Users/example/Documents/work',
    source: 'vscode',
    in_codex_sidebar: 0,
    archived: 0,
    created_at: 1777420000,
    updated_at: 1777423600,
  }, 1777427200000);

  assert.equal(thread.provider, 'codex');
  assert.equal(thread.inCodexSidebar, false);
  assert.equal(thread.appDeepLink, `codex://threads/${id}`);
  assert.equal(thread.defaultOpenMode, 'codex-cli-resume');
  assert.equal(thread.openLabel, '打开');
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

test('marks Codex automation threads even when sidebar title hides the automation prefix', () => {
  const thread = normalizeThread({
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Automation: Codex Project Folder Check\nAutomation ID: codex-project-folder-check',
    thread_name: 'Codex Project Folder Check',
    cwd: '/Users/example/Documents/work',
    archived: 0,
    created_at: 1777420000,
    updated_at: 1777423600,
  }, 1777427200000);

  assert.equal(thread.title, 'Codex Project Folder Check');
  assert.equal(thread.isAutomation, true);
});

test('normalizes Codex sub-agent spawn metadata', () => {
  const thread = normalizeThread({
    id: '223e4567-e89b-12d3-a456-426614174000',
    title: 'Review strategy',
    cwd: '/Users/example/Documents/work',
    source: '{"subagent":{"thread_spawn":{"parent_thread_id":"123e4567-e89b-12d3-a456-426614174000","depth":1,"agent_nickname":"Dirac","agent_role":"explorer"}}}',
    archived: 0,
    created_at: 1777420000,
    updated_at: 1777423600,
  }, 1777427200000);

  assert.equal(thread.isSubagent, true);
  assert.equal(thread.parentThreadId, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(thread.subagentDepth, 1);
  assert.equal(thread.agentNickname, 'Dirac');
  assert.equal(thread.agentRole, 'explorer');
});

test('infers running, fresh, warm, idle, and archived thread statuses', () => {
  const now = 1777427200000;

  assert.equal(inferThreadStatus({
    archived: false,
    updatedAtMs: now,
    latestUserMessageAtMs: now - 10 * 60 * 1000,
    latestAgentFinalAtMs: now - 20 * 60 * 1000,
  }, now), 'running');
  assert.equal(inferThreadStatus({
    archived: false,
    updatedAtMs: now - 2 * 24 * 60 * 60 * 1000,
    latestUserMessageAtMs: now - 2 * 24 * 60 * 60 * 1000,
    latestAgentFinalAtMs: now - 2 * 24 * 60 * 60 * 1000 - 60_000,
  }, now), 'idle');
  assert.equal(inferThreadStatus({ archived: false, updatedAtMs: now - 5 * 60 * 1000 }, now), 'fresh');
  assert.equal(inferThreadStatus({ archived: false, updatedAtMs: now - 2 * 60 * 60 * 1000 }, now), 'warm');
  assert.equal(inferThreadStatus({ archived: false, updatedAtMs: now - 2 * 24 * 60 * 60 * 1000 }, now), 'idle');
  assert.equal(inferThreadStatus({ archived: true, updatedAtMs: now }, now), 'archived');
});

test('uses active Codex goals as an explicit running signal', () => {
  const now = 1777427200000;
  const thread = normalizeThread({
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Goal loop',
    cwd: '/Users/example/Documents/work',
    source: 'cli',
    archived: 0,
    created_at_ms: now - 4 * 60 * 60 * 1000,
    updated_at_ms: now - 60_000,
    goal_id: 'goal-1',
    goal_status: 'active',
    goal_created_at_ms: now - 2 * 60 * 60 * 1000,
    goal_updated_at_ms: now - 30_000,
    goal_tokens_used: 1000,
    goal_time_used_seconds: 7200,
  }, now);

  assert.equal(thread.provider, 'codex-cli');
  assert.equal(thread.activeGoal, true);
  assert.equal(thread.status, 'running');
  assert.equal(thread.currentTurnStartedAtMs, now - 2 * 60 * 60 * 1000);
  assert.equal(thread.currentTurnElapsedMs, 2 * 60 * 60 * 1000);

  const dashboard = buildDashboard([
    {
      ...thread,
      latestUserMessageAtMs: now - 90 * 60 * 1000,
      latestAgentFinalAtMs: now - 60_000,
      latestMessageKind: 'agent',
    },
  ], now);

  assert.equal(dashboard.threads[0].status, 'running');
  assert.equal(dashboard.summary.runningHostThreads, 1);
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
      id: 'stale-turn',
      title: 'Stale unfinished turn',
      cwd: '/b',
      projectName: 'b',
      tokensUsed: 50,
      archived: false,
      updatedAtMs: now - 2 * 24 * 60 * 60 * 1000,
      latestUserMessageAtMs: now - 2 * 24 * 60 * 60 * 1000,
      latestAgentFinalAtMs: now - 2 * 24 * 60 * 60 * 1000 - 60_000,
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

  assert.equal(dashboard.summary.activeThreads, 3);
  assert.equal(dashboard.summary.runningThreads, 1);
  assert.equal(dashboard.summary.archivedThreads, 1);
  assert.equal(dashboard.summary.totalTokensUsed, 8_000_250);
  assert.equal(dashboard.inbox.length, 2);
  assert.deepEqual(dashboard.inbox.map((item) => item.reason), ['running', 'high token usage']);
  assert.equal(dashboard.threads[0].status, 'running');
  assert.equal(dashboard.threads[0].currentTurnElapsedMs, 600_000);
  const staleTurn = dashboard.threads.find((thread) => thread.id === 'stale-turn');
  assert.equal(staleTurn.status, 'idle');
  assert.equal(staleTurn.currentTurnStartedAtMs, null);
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

test('does not add sub-agent threads to the dashboard inbox', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'subagent-thread',
      title: 'Worker task',
      cwd: '/a',
      projectName: 'a',
      source: '{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}',
      tokensUsed: 8_000_000,
      archived: false,
      awaitingPermission: true,
      pendingToolCount: 1,
      updatedAtMs: now - 60_000,
      latestUserMessageAtMs: now - 30_000,
      latestAgentFinalAtMs: now - 60_000,
    },
  ], now);

  assert.equal(dashboard.inbox.length, 0);
});

test('attaches sub-agent threads to their host thread metadata', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'host-thread',
      title: 'Host task',
      cwd: '/a',
      projectName: 'a',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 120_000,
    },
    {
      id: 'subagent-thread',
      title: 'Worker task',
      cwd: '/a',
      projectName: 'a',
      source: '{"subagent":{"thread_spawn":{"parent_thread_id":"host-thread","agent_nickname":"Dirac","agent_role":"explorer"}}}',
      isSubagent: true,
      parentThreadId: 'host-thread',
      tokensUsed: 10,
      archived: false,
      updatedAtMs: now - 30_000,
    },
  ], now);

  const host = dashboard.threads.find((thread) => thread.id === 'host-thread');
  const subagent = dashboard.threads.find((thread) => thread.id === 'subagent-thread');

  assert.equal(host.subagentCount, 1);
  assert.deepEqual(host.childThreadIds, ['subagent-thread']);
  assert.equal(host.groupUpdatedAtMs, now - 30_000);
  assert.equal(subagent.parentThreadTitle, 'Host task');
  assert.equal(subagent.parentThreadProjectName, 'a');
});

test('counts running host thread groups without inflating sub-agents', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'host-thread',
      title: 'Host task',
      cwd: '/a',
      projectName: 'a',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 120_000,
    },
    {
      id: 'subagent-a',
      title: 'Worker A',
      cwd: '/a',
      projectName: 'a',
      isSubagent: true,
      parentThreadId: 'host-thread',
      tokensUsed: 10,
      archived: false,
      updatedAtMs: now - 30_000,
      latestUserMessageAtMs: now - 20_000,
      latestAgentFinalAtMs: now - 60_000,
    },
    {
      id: 'subagent-b',
      title: 'Worker B',
      cwd: '/a',
      projectName: 'a',
      isSubagent: true,
      parentThreadId: 'host-thread',
      tokensUsed: 10,
      archived: false,
      updatedAtMs: now - 25_000,
      latestUserMessageAtMs: now - 15_000,
      latestAgentFinalAtMs: now - 60_000,
    },
    {
      id: 'solo-host',
      title: 'Solo host',
      cwd: '/b',
      projectName: 'b',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 20_000,
      latestUserMessageAtMs: now - 10_000,
      latestAgentFinalAtMs: now - 50_000,
    },
  ], now);

  assert.equal(dashboard.summary.runningThreads, 3);
  assert.equal(dashboard.summary.runningHostThreads, 2);
});

test('counts explicit provider running signals as host threads', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'claude-active',
      title: 'Claude active loop',
      cwd: '/a',
      projectName: 'a',
      provider: 'claude-desktop-cowork',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 30 * 60 * 1000,
      latestUserMessageAtMs: now - 2 * 60 * 60 * 1000,
      latestAgentFinalAtMs: now - 90 * 60 * 1000,
      agentRunning: true,
      agentStartedAtMs: now - 2 * 60 * 60 * 1000,
      agentActivityAtMs: now - 30 * 60 * 1000,
    },
    {
      id: 'claude-stale',
      title: 'Claude stale loop',
      cwd: '/b',
      projectName: 'b',
      provider: 'claude-desktop-cowork',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 7 * 60 * 60 * 1000,
      agentRunning: true,
      agentStartedAtMs: now - 8 * 60 * 60 * 1000,
      agentActivityAtMs: now - 7 * 60 * 60 * 1000,
    },
  ], now);

  const active = dashboard.threads.find((thread) => thread.id === 'claude-active');
  const stale = dashboard.threads.find((thread) => thread.id === 'claude-stale');

  assert.equal(active.status, 'running');
  assert.equal(active.currentTurnStartedAtMs, now - 2 * 60 * 60 * 1000);
  assert.equal(stale.status, 'idle');
  assert.equal(dashboard.summary.runningThreads, 1);
  assert.equal(dashboard.summary.runningHostThreads, 1);
});

test('does not use provider-level quota refresh as Claude turn activity', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'claude-stale-cache',
      title: 'Claude stale loop with fresh quota',
      cwd: '/b',
      projectName: 'b',
      provider: 'claude-desktop-cowork',
      providerLabel: 'Claude Cowork',
      model: 'claude-opus-4-6',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 17 * 24 * 60 * 60 * 1000,
      agentRunning: true,
      agentStartedAtMs: now - 17 * 24 * 60 * 60 * 1000,
      agentActivityAtMs: now - 17 * 24 * 60 * 60 * 1000,
      rateLimitUpdatedAtMs: now - 1_000,
      rateLimitActivityAtMs: null,
      rateLimits: {
        primary: { used_percent: 40, window_minutes: 300, resets_at: 1777430000 },
      },
    },
  ], now);

  const stale = dashboard.threads.find((thread) => thread.id === 'claude-stale-cache');
  assert.equal(stale.status, 'idle');
  assert.equal(stale.currentTurnStartedAtMs, null);
  assert.equal(dashboard.summary.runningThreads, 0);
  assert.equal(dashboard.summary.quota.groups[0].sourceThreadId, 'claude-stale-cache');
  assert.equal(dashboard.summary.quota.groups[0].realtime.availablePercent, 60);
});

test('builds current quota and daily token summary from latest rate-limit signal', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: '1',
      title: 'Latest quota',
      cwd: '/a',
      projectName: 'a',
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.2',
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
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.1',
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
  assert.equal(dashboard.summary.quota.groups.length, 1);
  assert.equal(dashboard.summary.quota.groups[0].key, 'gpt');
  assert.equal(dashboard.summary.quota.groups[0].label, 'GPT');
  assert.equal(dashboard.summary.quota.groups[0].sourceThreadId, '1');
});

test('ignores incomplete quota percent signals instead of treating them as fully available', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'gpt-incomplete',
      title: 'Incomplete quota',
      cwd: '/a',
      projectName: 'a',
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.2',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 30_000,
      rateLimitUpdatedAtMs: now - 1_000,
      rateLimits: {
        primary: { window_minutes: 300, resets_at: 1777430000 },
        secondary: { window_minutes: 10080, resets_at: 1778000000 },
      },
    },
    {
      id: 'gpt-previous',
      title: 'Previous valid quota',
      cwd: '/b',
      projectName: 'b',
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.1',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 90_000,
      rateLimitUpdatedAtMs: now - 60_000,
      rateLimitStale: true,
      rateLimitStaleAtMs: now - 1_000,
      rateLimits: {
        primary: { used_percent: 38, window_minutes: 300, resets_at: 1777430000 },
        secondary: { used_percent: 49, window_minutes: 10080, resets_at: 1778000000 },
      },
    },
  ], now);

  assert.equal(dashboard.summary.quota.sourceThreadId, 'gpt-previous');
  assert.equal(dashboard.summary.quota.realtime.availablePercent, 62);
  assert.equal(dashboard.summary.quota.weekly.availablePercent, 51);
  assert.equal(dashboard.summary.quota.stale, true);
  assert.equal(dashboard.summary.quota.groups[0].sourceThreadId, 'gpt-previous');
  assert.equal(dashboard.summary.quota.groups[0].stale, true);
});

test('groups quota by LLM family and keeps the freshest signal per family', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'gpt-new',
      title: 'GPT current quota',
      cwd: '/a',
      projectName: 'a',
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.2',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 60_000,
      rateLimitUpdatedAtMs: now - 1_000,
      rateLimits: {
        primary: { used_percent: 14, window_minutes: 300, resets_at: 1777430000 },
        secondary: { used_percent: 25, window_minutes: 10080, resets_at: 1778000000 },
      },
    },
    {
      id: 'gpt-old',
      title: 'GPT stale quota',
      cwd: '/b',
      projectName: 'b',
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.1',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 120_000,
      rateLimitUpdatedAtMs: now - 90_000,
      rateLimits: {
        primary: { used_percent: 90, window_minutes: 300, resets_at: 1777429000 },
        secondary: { used_percent: 80, window_minutes: 10080, resets_at: 1777990000 },
      },
    },
    {
      id: 'claude-new',
      title: 'Claude quota',
      cwd: '/c',
      projectName: 'c',
      provider: 'claude-code-cli',
      providerLabel: 'Claude Code CLI',
      model: 'claude-sonnet-4.5',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 30_000,
      rateLimitUpdatedAtMs: now - 2_000,
      rateLimits: {
        primary: { used_percent: 44, window_minutes: 300, resets_at: 1777431000 },
        secondary: { used_percent: 52, window_minutes: 10080, resets_at: 1778010000 },
      },
    },
  ], now);

  assert.deepEqual(
    dashboard.summary.quota.groups.map((group) => group.key),
    ['gpt', 'claude'],
  );
  assert.equal(dashboard.summary.quota.groups[0].sourceThreadId, 'gpt-new');
  assert.equal(dashboard.summary.quota.groups[0].realtime.availablePercent, 86);
  assert.equal(dashboard.summary.quota.groups[1].label, 'Claude');
  assert.equal(dashboard.summary.quota.groups[1].realtime.availablePercent, 56);
});

test('prefers Codex account quota over model-specific Codex GPT limits', () => {
  const now = 1778773400000;
  const dashboard = buildDashboard([
    {
      id: 'codex-main-quota',
      title: 'Codex main quota',
      cwd: '/a',
      projectName: 'a',
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.5',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 60 * 60_000,
      rateLimitUpdatedAtMs: now - 60 * 60_000,
      rateLimits: {
        limit_id: 'codex',
        primary: { used_percent: 54, window_minutes: 300, resets_at: 1778774541 },
        secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1779158013 },
        plan_type: 'pro',
      },
    },
    {
      id: 'codex-model-quota',
      title: 'Codex model quota',
      cwd: '/b',
      projectName: 'b',
      provider: 'codex-cli',
      providerLabel: 'Codex CLI',
      model: 'gpt-5.3-codex-spark',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 1_000,
      rateLimitUpdatedAtMs: now - 1_000,
      rateLimits: {
        limit_id: 'codex_bengalfox',
        limit_name: 'GPT-5.3-Codex-Spark',
        primary: { used_percent: 0, window_minutes: 300, resets_at: 1778791396 },
        secondary: { used_percent: 0, window_minutes: 10080, resets_at: 1779378196 },
      },
    },
  ], now);

  assert.equal(dashboard.summary.quota.sourceThreadId, 'codex-main-quota');
  assert.equal(dashboard.summary.quota.realtime.availablePercent, 46);
  assert.equal(dashboard.summary.quota.weekly.availablePercent, 60);
  assert.equal(dashboard.summary.quota.groups[0].sourceThreadId, 'codex-main-quota');
});

test('includes running LLM families even when they have no quota signal', () => {
  const now = 1777427200000;
  const dashboard = buildDashboard([
    {
      id: 'gpt-quota',
      title: 'GPT quota source',
      cwd: '/a',
      projectName: 'a',
      provider: 'codex',
      providerLabel: 'Codex',
      model: 'gpt-5.5',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 60_000,
      latestUserMessageAtMs: now - 5 * 60_000,
      rateLimitUpdatedAtMs: now - 1_000,
      rateLimits: {
        primary: { used_percent: 8, window_minutes: 300, resets_at: 1777430000 },
        secondary: { used_percent: 3, window_minutes: 10080, resets_at: 1778000000 },
      },
    },
    {
      id: 'claude-running',
      title: 'Claude active loop',
      cwd: '/b',
      projectName: 'b',
      provider: 'claude-desktop-cowork',
      providerLabel: 'Claude Cowork',
      model: 'claude-opus-4-7',
      tokensUsed: 100,
      archived: false,
      updatedAtMs: now - 30_000,
      agentRunning: true,
      agentStartedAtMs: now - 10 * 60_000,
      agentActivityAtMs: now - 30_000,
    },
  ], now);

  assert.deepEqual(
    dashboard.summary.quota.groups.map((group) => group.key),
    ['gpt', 'claude'],
  );
  assert.equal(dashboard.summary.quota.groups[0].realtime.availablePercent, 92);
  assert.equal(dashboard.summary.quota.groups[1].label, 'Claude');
  assert.equal(dashboard.summary.quota.groups[1].realtime, null);
  assert.equal(dashboard.summary.quota.groups[1].sourceThreadId, 'claude-running');
});
