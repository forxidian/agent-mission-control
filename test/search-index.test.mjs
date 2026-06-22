import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSearchIndex } from '../src/search-index.mjs';

async function tempDb() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-search-index-'));
  return path.join(dir, 'search.sqlite');
}

function thread(overrides = {}) {
  return {
    id: overrides.id || 'thread-1',
    provider: overrides.provider || 'codex',
    providerLabel: overrides.providerLabel || 'Codex',
    title: overrides.title || 'Untitled task',
    projectName: overrides.projectName || 'mission-control',
    cwd: overrides.cwd || '/Users/example/mission-control',
    status: overrides.status || 'idle',
    archived: Boolean(overrides.archived),
    updatedAtMs: overrides.updatedAtMs || 1_700_000_000_000,
    createdAtMs: overrides.createdAtMs || 1_699_999_900_000,
    tokensUsed: overrides.tokensUsed || 0,
    todayTokenUsage: overrides.todayTokenUsage || 0,
    tokenBreakdown: overrides.tokenBreakdown,
    todayTokenBreakdown: overrides.todayTokenBreakdown,
    model: overrides.model || 'gpt-5-codex',
    latestMeaningfulUserMessage: overrides.latestMeaningfulUserMessage || '',
    latestUserMessage: overrides.latestUserMessage || '',
    firstUserMessage: overrides.firstUserMessage || '',
    lastAgentMessage: overrides.lastAgentMessage || '',
    appDeepLink: overrides.appDeepLink || '',
    resumeCommand: overrides.resumeCommand || '',
    defaultOpenMode: overrides.defaultOpenMode || 'codex-deeplink',
    inCodexSidebar: overrides.inCodexSidebar ?? true,
    isSubagent: Boolean(overrides.isSubagent),
    isAutomation: Boolean(overrides.isAutomation),
    parentThreadId: overrides.parentThreadId || '',
    parentThreadTitle: overrides.parentThreadTitle || '',
    artifacts: overrides.artifacts,
  };
}

test('indexes dashboard threads and ranks title matches before body matches', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({
    generatedAtMs: 1_800_000_000_000,
    threads: [
      thread({
        id: 'thread-title',
        title: 'Everything style thread search',
        projectName: 'agent-mission-control',
        updatedAtMs: 3000,
      }),
      thread({
        id: 'thread-body',
        title: 'Dashboard planning',
        latestMeaningfulUserMessage: '需要一个 Everything 式高速检索面板',
        projectName: 'agent-mission-control',
        updatedAtMs: 4000,
      }),
    ],
  });

  const result = await index.searchThreads({ query: 'Everything', includeArchived: true });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, 'thread-title');
  assert.equal(result.items[0].match.field, 'title');
  assert.equal(result.items[1].id, 'thread-body');
  assert.equal(result.items[1].match.field, 'recent user');
  assert.equal(result.total, 2);
});

test('search supports provider, status, project, archived, and short Chinese queries', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({
    threads: [
      thread({
        id: 'active-hit',
        title: '历史线程检索',
        projectName: 'alpha',
        cwd: '/Users/example/alpha',
        status: 'idle',
        provider: 'codex',
      }),
      thread({
        id: 'archived-hit',
        title: '历史归档任务',
        projectName: 'alpha',
        cwd: '/Users/example/alpha',
        status: 'archived',
        provider: 'codex',
        archived: true,
      }),
      thread({
        id: 'wrong-provider',
        title: '历史线程检索',
        projectName: 'beta',
        cwd: '/Users/example/beta',
        status: 'running',
        provider: 'claude-code-cli',
        providerLabel: 'Claude Code CLI',
      }),
    ],
  });

  const withoutArchived = await index.searchThreads({ query: '历史', provider: 'codex', project: '/Users/example/alpha' });
  assert.deepEqual(withoutArchived.items.map((item) => item.id), ['active-hit']);

  const withArchived = await index.searchThreads({
    query: '历史',
    provider: 'codex',
    project: '/Users/example/alpha',
    includeArchived: true,
    status: 'archived',
  });
  assert.deepEqual(withArchived.items.map((item) => item.id), ['archived-hit']);
});

test('search excludes sub-agent threads unless explicitly included', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({
    threads: [
      thread({
        id: 'host-thread',
        title: '用户筛选主任务',
        updatedAtMs: 3000,
      }),
      thread({
        id: 'subagent-thread',
        title: '用户筛选子任务',
        isSubagent: true,
        parentThreadId: 'host-thread',
        parentThreadTitle: '用户筛选主任务',
        updatedAtMs: 4000,
      }),
    ],
  });

  const defaultResult = await index.searchThreads({ query: '用户', includeArchived: true });
  assert.deepEqual(defaultResult.items.map((item) => item.id), ['host-thread']);

  const withSubagents = await index.searchThreads({
    query: '用户',
    includeArchived: true,
    includeSubagents: true,
  });
  assert.deepEqual(withSubagents.items.map((item) => item.id), ['subagent-thread', 'host-thread']);
  assert.equal(withSubagents.items[0].isSubagent, true);
});

test('search excludes automation threads unless explicitly included', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({
    threads: [
      thread({
        id: 'manual-thread',
        title: 'Codex usage investigation',
        updatedAtMs: 3000,
      }),
      thread({
        id: 'automation-thread',
        title: 'Codex Project Folder Check',
        isAutomation: true,
        firstUserMessage: 'Automation: Codex Project Folder Check Automation ID: codex-project-folder-check',
        updatedAtMs: 4000,
      }),
    ],
  });

  const defaultResult = await index.searchThreads({ query: 'Codex', includeArchived: true });
  assert.deepEqual(defaultResult.items.map((item) => item.id), ['manual-thread']);

  const withAutomations = await index.searchThreads({
    query: 'Codex',
    includeArchived: true,
    includeAutomations: true,
  });
  assert.deepEqual(new Set(withAutomations.items.map((item) => item.id)), new Set(['automation-thread', 'manual-thread']));
  assert.equal(withAutomations.items.find((item) => item.id === 'automation-thread').isAutomation, true);
});

test('preserves Codex open mode metadata in history search results', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({
    threads: [
      thread({
        id: 'hidden-codex-thread',
        title: 'Hidden Codex history',
        defaultOpenMode: 'codex-cli-resume',
        inCodexSidebar: false,
      }),
    ],
  });

  const result = await index.searchThreads({ query: 'Hidden', includeArchived: true });

  assert.equal(result.items[0].id, 'hidden-codex-thread');
  assert.equal(result.items[0].defaultOpenMode, 'codex-cli-resume');
  assert.equal(result.items[0].inCodexSidebar, false);
});

test('preserves artifact summaries in history search results', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({
    threads: [
      thread({
        id: 'media-thread',
        title: 'Has media artifacts',
        artifacts: {
          total: 2,
          latestAtMs: 1_800_000_000_000,
          typeCounts: { html: 1, image: 1 },
          items: [
            {
              id: 'artifact-2',
              type: 'html',
              title: 'report.html',
              path: '/Users/example/private/report.html',
              source: 'agent',
              turn: 2,
            },
            {
              id: 'artifact-1',
              type: 'image',
              title: 'screen.png',
              path: '/var/folders/private/screen.png',
              source: 'user',
              turn: 1,
            },
          ],
        },
      }),
    ],
  });

  const result = await index.searchThreads({ query: 'report.html', includeArchived: true });

  assert.equal(result.items[0].id, 'media-thread');
  assert.equal(result.items[0].artifacts.total, 2);
  assert.equal(result.items[0].artifacts.items[0].title, 'report.html');
  assert.equal(result.items[0].artifacts.items[1].type, 'image');
});

test('marks an unversioned search index for rebuild and clears it after indexing', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });

  const before = await index.status();
  assert.equal(before.needsRebuild, true);

  await index.indexDashboard({ threads: [thread({ id: 'versioned-thread', title: '[图片] 设计师权限' })] });
  const after = await index.status();

  assert.equal(after.needsRebuild, false);
  assert.equal(after.indexVersion, after.currentIndexVersion);
});

test('project history groups all indexed threads and keeps archived counts separate', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({
    threads: [
      thread({ id: 'one', cwd: '/Users/example/alpha', projectName: 'alpha', tokensUsed: 10, updatedAtMs: 1000 }),
      thread({
        id: 'two',
        cwd: '/Users/example/alpha',
        projectName: 'alpha',
        tokensUsed: 20,
        todayTokenUsage: 5,
        tokenBreakdown: { total: 20, input: 8, cacheRead: 6, cacheWrite: 0, output: 4, reasoning: 2, uncategorized: 0 },
        todayTokenBreakdown: { total: 5, input: 2, cacheRead: 1, cacheWrite: 0, output: 2, reasoning: 0, uncategorized: 0 },
        archived: true,
        status: 'archived',
        updatedAtMs: 2000,
      }),
      thread({ id: 'three', cwd: '/Users/example/beta', projectName: 'beta', provider: 'opencode', providerLabel: 'OpenCode', tokensUsed: 8, updatedAtMs: 3000 }),
    ],
  });

  const projects = await index.projectHistory({ limit: 10 });

  assert.equal(projects.items.length, 2);
  assert.deepEqual(projects.items[0], {
    cwd: '/Users/example/alpha',
    projectName: 'alpha',
    threadCount: 2,
    activeThreadCount: 1,
    archivedThreadCount: 1,
    tokensUsed: 30,
    todayTokensUsed: 5,
    tokenBreakdown: {
      total: 30,
      input: 8,
      cacheRead: 6,
      cacheWrite: 0,
      output: 4,
      reasoning: 2,
      uncategorized: 10,
    },
    todayTokenBreakdown: {
      total: 5,
      input: 2,
      cacheRead: 1,
      cacheWrite: 0,
      output: 2,
      reasoning: 0,
      uncategorized: 0,
    },
    latestUpdatedAtMs: 2000,
    providers: ['Codex'],
  });
  assert.equal(projects.items[1].projectName, 'beta');
  assert.deepEqual(projects.items[1].providers, ['OpenCode']);
});

test('status reports index freshness and thread count', async () => {
  const index = createSearchIndex({ databasePath: await tempDb(), now: () => 1_800_000_000_000 });
  await index.indexDashboard({ threads: [thread({ id: 'one' }), thread({ id: 'two' })] });

  const status = await index.status();

  assert.equal(status.available, true);
  assert.equal(status.threadCount, 2);
  assert.equal(status.indexedAtMs, 1_800_000_000_000);
  assert.equal(status.needsRebuild, false);
  assert.equal(status.indexVersion, status.currentIndexVersion);
  assert.match(status.databasePath, /search\.sqlite$/);
});
