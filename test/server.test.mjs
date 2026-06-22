import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, hideInstalledPwaApp, openThreadInCodexCli, openThreadInProvider } from '../src/server.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.once('error', reject);
  });
}

test('serves dashboard json from injected loader', async () => {
  const server = createServer({
    loadDashboard: async () => ({
      summary: { activeThreads: 1, inboxCount: 1 },
      threads: [{ id: 'abc', title: 'Thread' }],
      projects: [{ projectName: 'demo' }],
      inbox: [{ id: 'abc', reason: 'recent activity' }],
    }),
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/dashboard`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.summary.activeThreads, 1);
    assert.equal(body.threads[0].title, 'Thread');
    assert.equal(body.inbox[0].reason, 'recent activity');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves search results from a dedicated search index', async () => {
  const calls = [];
  const searchIndex = {
    status: async () => ({ available: true, indexedAtMs: 0, threadCount: 0 }),
    indexDashboard: async (dashboard) => {
      calls.push({ method: 'indexDashboard', dashboard });
      return { indexedAtMs: 123, threadCount: dashboard.threads.length };
    },
    searchThreads: async (params) => {
      calls.push({ method: 'searchThreads', params });
      return {
        query: params.query,
        total: 1,
        items: [{ id: 'abc', title: 'Everything search' }],
      };
    },
    projectHistory: async () => ({ items: [] }),
  };
  const server = createServer({
    searchIndex,
    loadDashboard: async () => ({
      summary: {},
      threads: [{ id: 'abc', title: 'Everything search' }],
      projects: [],
      inbox: [],
    }),
  });

  const address = await listen(server);
  try {
    const response = await fetch(
      `http://${address.address}:${address.port}/api/search?q=Everything&provider=codex&status=idle&project=%2Ftmp%2Fdemo&archived=1&limit=25`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.query, 'Everything');
    assert.equal(body.items[0].id, 'abc');
    assert.equal(calls[0].method, 'indexDashboard');
    assert.equal(calls[1].method, 'searchThreads');
    assert.deepEqual(calls[1].params, {
      query: 'Everything',
      provider: 'codex',
      status: 'idle',
      project: '/tmp/demo',
      includeArchived: true,
      includeSubagents: false,
      includeAutomations: false,
      limit: 25,
      cursor: '',
    });

    await fetch(`http://${address.address}:${address.port}/api/search?q=Everything&subagents=1`);
    assert.equal(calls.at(-1).method, 'searchThreads');
    assert.equal(calls.at(-1).params.includeSubagents, true);

    await fetch(`http://${address.address}:${address.port}/api/search?q=Everything&automations=1`);
    assert.equal(calls.at(-1).method, 'searchThreads');
    assert.equal(calls.at(-1).params.includeAutomations, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hydrates Codex artifact summaries in search results', async () => {
  const artifactCalls = [];
  const searchIndex = {
    status: async () => ({ available: true, indexedAtMs: 1000, threadCount: 1 }),
    indexDashboard: async () => ({ indexedAtMs: 1000, threadCount: 1 }),
    searchThreads: async (params) => ({
      query: params.query,
      total: 2,
      items: [
        {
          id: 'codex-thread',
          provider: 'codex',
          title: 'Toy artifact thread',
          rolloutPath: '/tmp/rollout.jsonl',
          artifacts: { total: 0, items: [] },
        },
        {
          id: 'claude-thread',
          provider: 'claude-code-cli',
          title: 'Other result',
          rolloutPath: '/tmp/claude.jsonl',
        },
      ],
    }),
    projectHistory: async () => ({ items: [] }),
  };
  const server = createServer({
    now: () => 1000,
    searchIndex,
    loadDashboard: async () => ({
      summary: {},
      threads: [],
      projects: [],
      inbox: [],
    }),
    loadCodexThreadArtifacts: async ({ thread }) => {
      artifactCalls.push(thread.id);
      return {
        threadId: thread.id,
        artifacts: {
          total: 4,
          latestAtMs: 2000,
          typeCounts: { html: 2, image: 2 },
          items: [
            { id: 'artifact-4', type: 'html', title: 'index.html', source: 'agent', turn: 2 },
            { id: 'artifact-3', type: 'image', title: 'poster.png', source: 'agent', turn: 2 },
            { id: 'artifact-2', type: 'link', title: 'https://example.com/demo', source: 'user', turn: 1 },
            { id: 'artifact-1', type: 'markdown', title: 'notes.md', source: 'user', turn: 1 },
          ],
        },
      };
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/search?q=toy`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(artifactCalls, ['codex-thread']);
    assert.equal(body.items[0].artifacts.total, 4);
    assert.equal(body.items[0].artifacts.latestAtMs, 2000);
    assert.equal(body.items[0].artifacts.items.length, 3);
    assert.equal(body.items[0].artifacts.items[0].title, 'index.html');
    assert.equal(body.items[1].artifacts, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reports and rebuilds search index state', async () => {
  let indexed = false;
  const searchIndex = {
    status: async () => ({
      available: true,
      indexedAtMs: indexed ? 456 : 0,
      threadCount: indexed ? 2 : 0,
      databasePath: '/tmp/search.sqlite',
    }),
    indexDashboard: async (dashboard) => {
      indexed = true;
      return { indexedAtMs: 456, threadCount: dashboard.threads.length };
    },
    searchThreads: async () => ({ items: [], total: 0 }),
    projectHistory: async () => ({ items: [] }),
  };
  const server = createServer({
    searchIndex,
    loadDashboard: async () => ({
      summary: {},
      threads: [{ id: 'one' }, { id: 'two' }],
      projects: [],
      inbox: [],
    }),
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const beforeResponse = await fetch(`${base}/api/search/status`);
    const before = await beforeResponse.json();
    const rebuildResponse = await fetch(`${base}/api/search/reindex`, { method: 'POST' });
    const rebuilt = await rebuildResponse.json();
    const afterResponse = await fetch(`${base}/api/search/status`);
    const after = await afterResponse.json();

    assert.equal(beforeResponse.status, 200);
    assert.equal(before.threadCount, 0);
    assert.equal(rebuildResponse.status, 200);
    assert.equal(rebuilt.threadCount, 2);
    assert.equal(afterResponse.status, 200);
    assert.equal(after.threadCount, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rebuilds a fresh search index once when a non-empty query has no matches', async () => {
  const calls = [];
  let rebuilt = false;
  const searchIndex = {
    status: async () => ({
      available: true,
      indexedAtMs: rebuilt ? 2000 : 1000,
      threadCount: rebuilt ? 1 : 0,
    }),
    indexDashboard: async (dashboard) => {
      calls.push({ method: 'indexDashboard', threadCount: dashboard.threads.length });
      rebuilt = true;
      return { indexedAtMs: 2000, threadCount: dashboard.threads.length };
    },
    searchThreads: async (params) => {
      calls.push({ method: 'searchThreads', rebuilt, query: params.query });
      return rebuilt
        ? { query: params.query, total: 1, items: [{ id: 'fresh-thread', title: '布局简化' }] }
        : { query: params.query, total: 0, items: [] };
    },
    projectHistory: async () => ({ items: [] }),
  };
  const server = createServer({
    now: () => 2000,
    searchIndex,
    searchIndexMaxAgeMs: 60_000,
    loadDashboard: async () => ({
      summary: {},
      threads: [{ id: 'fresh-thread', title: '布局简化' }],
      projects: [],
      inbox: [],
    }),
  });

  const address = await listen(server);
  try {
    const response = await fetch(
      `http://${address.address}:${address.port}/api/search?q=%E5%B8%83%E5%B1%80%E7%AE%80%E5%8C%96`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].id, 'fresh-thread');
    assert.deepEqual(calls.map((call) => call.method), ['searchThreads', 'indexDashboard', 'searchThreads']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rebuilds a fresh search index when its version is stale', async () => {
  const calls = [];
  let rebuilt = false;
  const searchIndex = {
    status: async () => ({
      available: true,
      indexedAtMs: rebuilt ? 2000 : 1900,
      threadCount: 1,
      needsRebuild: !rebuilt,
    }),
    indexDashboard: async (dashboard) => {
      calls.push({ method: 'indexDashboard', threadCount: dashboard.threads.length });
      rebuilt = true;
      return { indexedAtMs: 2000, threadCount: dashboard.threads.length };
    },
    searchThreads: async (params) => {
      calls.push({ method: 'searchThreads', rebuilt, query: params.query });
      return { query: params.query, total: 1, items: [{ id: 'versioned-thread', title: '[图片] 设计师权限' }] };
    },
    projectHistory: async () => ({ items: [] }),
  };
  const server = createServer({
    now: () => 2000,
    searchIndex,
    searchIndexMaxAgeMs: 60_000,
    loadDashboard: async () => ({
      summary: {},
      threads: [{ id: 'versioned-thread', title: '[图片] 设计师权限' }],
      projects: [],
      inbox: [],
    }),
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/search?q=%E8%AE%BE%E8%AE%A1`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].id, 'versioned-thread');
    assert.deepEqual(calls.map((call) => call.method), ['indexDashboard', 'searchThreads']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves project history from the search index', async () => {
  const calls = [];
  const searchIndex = {
    status: async () => ({ available: true, indexedAtMs: 999, threadCount: 2 }),
    indexDashboard: async () => ({ indexedAtMs: 999, threadCount: 2 }),
    searchThreads: async () => ({ items: [], total: 0 }),
    projectHistory: async (params) => {
      calls.push(params);
      return {
        items: [{
          cwd: '/tmp/demo',
          projectName: 'demo',
          threadCount: 2,
          activeThreadCount: 1,
          archivedThreadCount: 1,
        }],
      };
    },
  };
  const server = createServer({ searchIndex });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/projects/history?limit=12&q=demo`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].projectName, 'demo');
    assert.deepEqual(calls[0], { limit: 12, query: 'demo' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves static index html', async () => {
  const server = createServer({
    loadDashboard: async () => ({ summary: {}, threads: [], projects: [], inbox: [] }),
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Agent 任务控制台/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves PWA assets with installable metadata', async () => {
  const server = createServer({
    loadDashboard: async () => ({ summary: {}, threads: [], projects: [], inbox: [] }),
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
    const manifest = await manifestResponse.json();
    const serviceWorkerResponse = await fetch(`${base}/service-worker.js`);
    const serviceWorker = await serviceWorkerResponse.text();
    const iconResponse = await fetch(`${base}/icon-192.png`);

    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-type') || '', /application\/manifest\+json/);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.protocol_handlers[0].protocol, 'web+agentmissioncontrol');
    assert.equal(manifest.launch_handler.client_mode[0], 'focus-existing');
    assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
    assert.equal(serviceWorkerResponse.status, 200);
    assert.match(serviceWorkerResponse.headers.get('content-type') || '', /text\/javascript/);
    assert.match(serviceWorker, /pathname\.startsWith\('\/api\/'\)/);
    assert.equal(iconResponse.status, 200);
    assert.match(iconResponse.headers.get('content-type') || '', /image\/png/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves local image previews with image-only safeguards', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amc-local-preview-'));
  const pngPath = path.join(dir, 'codex-clipboard-preview.png');
  const textPath = path.join(dir, 'notes.txt');
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]);
  await writeFile(pngPath, pngBytes);
  await writeFile(textPath, 'private notes');

  const server = createServer({
    loadDashboard: async () => ({ summary: {}, threads: [], projects: [], inbox: [] }),
  });
  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const imageResponse = await fetch(`${base}/api/local-file-preview?path=${encodeURIComponent(pngPath)}`);
    const imageBody = Buffer.from(await imageResponse.arrayBuffer());
    const textResponse = await fetch(`${base}/api/local-file-preview?path=${encodeURIComponent(textPath)}`);
    const postResponse = await fetch(`${base}/api/local-file-preview?path=${encodeURIComponent(pngPath)}`, {
      method: 'POST',
    });
    const crossSiteResponse = await fetch(`${base}/api/local-file-preview?path=${encodeURIComponent(pngPath)}`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });

    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.equal(imageResponse.headers.get('cache-control'), 'no-store');
    assert.equal(imageResponse.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.deepEqual(imageBody, pngBytes);
    assert.equal(textResponse.status, 415);
    assert.equal(postResponse.status, 405);
    assert.equal(crossSiteResponse.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves Codex thread artifacts lazily from rollout files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amc-artifacts-'));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const htmlPath = path.join(dir, 'report.html');
  await writeFile(htmlPath, '<!doctype html><title>Report</title>');
  await writeFile(rolloutPath, [
    JSON.stringify({
      timestamp: '2026-06-17T08:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: `请看 https://example.com/input.png` },
    }),
    JSON.stringify({
      timestamp: '2026-06-17T08:01:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: `报告已生成：${htmlPath}`, phase: 'final_answer' },
    }),
  ].join('\n'));

  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [{ id: 'thread-1', provider: 'codex', title: 'Artifacts', rolloutPath }],
      projects: [],
      inbox: [],
    }),
  });
  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/threads/thread-1/artifacts`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.threadId, 'thread-1');
    assert.equal(body.artifacts.total, 2);
    assert.deepEqual(body.artifacts.turns.map((turn) => turn.turn), [1]);
    assert.equal(body.artifacts.items[0].type, 'html');
    assert.equal(body.artifacts.items[0].path, htmlPath);
    assert.equal(body.artifacts.items[1].type, 'image');
    assert.equal(body.artifacts.items[1].url, 'https://example.com/input.png');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('opens local artifact files through an injected opener', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amc-open-artifact-'));
  const htmlPath = path.join(dir, 'report.html');
  await writeFile(htmlPath, '<!doctype html><title>Report</title>');
  const resolvedHtmlPath = await realpath(htmlPath);

  const calls = [];
  const server = createServer({
    loadDashboard: async () => ({ summary: {}, threads: [], projects: [], inbox: [] }),
    openLocalFile: async (filePath) => {
      calls.push(filePath);
      return { opened: true, method: 'test-open' };
    },
  });
  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/local-file-open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: htmlPath }),
    });
    const body = await response.json();
    const crossSiteResponse = await fetch(`http://${address.address}:${address.port}/api/local-file-open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.com',
      },
      body: JSON.stringify({ path: htmlPath }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(body, { opened: true, method: 'test-open', path: resolvedHtmlPath });
    assert.deepEqual(calls, [resolvedHtmlPath]);
    assert.equal(crossSiteResponse.status, 403);
    assert.deepEqual(calls, [resolvedHtmlPath]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reports, opens, and hides the installed local PWA app through injected handlers', async () => {
  const calls = [];
  const server = createServer({
    getInstalledAppStatus: async () => ({ installed: true, method: 'macos-pwa-app' }),
    openInstalledApp: async () => {
      calls.push('open');
      return { opened: true, method: 'macos-pwa-app' };
    },
    hideInstalledApp: async () => {
      calls.push('hide');
      return { hidden: true, method: 'macos-pwa-app' };
    },
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const statusResponse = await fetch(`${base}/api/app/installed`);
    const status = await statusResponse.json();
    const openResponse = await fetch(`${base}/api/app/open-installed`, { method: 'POST' });
    const opened = await openResponse.json();
    const hideResponse = await fetch(`${base}/api/app/hide-installed`, { method: 'POST' });
    const hidden = await hideResponse.json();

    assert.equal(statusResponse.status, 200);
    assert.deepEqual(status, { installed: true, method: 'macos-pwa-app' });
    assert.equal(openResponse.status, 200);
    assert.deepEqual(opened, { opened: true, method: 'macos-pwa-app' });
    assert.equal(hideResponse.status, 200);
    assert.deepEqual(hidden, { hidden: true, method: 'macos-pwa-app' });
    assert.deepEqual(calls, ['open', 'hide']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hides installed PWA app through System Events without miniaturizing windows', async () => {
  const calls = [];
  const result = await hideInstalledPwaApp({
    platform: 'darwin',
    appScriptNames: ['Agent Mission Control'],
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { stdout: '', stderr: '' };
    },
  });

  assert.deepEqual(result, { hidden: true, method: 'macos-pwa-app' });
  assert.equal(calls[0].command, 'osascript');
  assert.match(calls[0].args.join('\n'), /id of application "Agent Mission Control"/);
  assert.match(calls[0].args.join('\n'), /bundle identifier is targetBundleId/);
  assert.doesNotMatch(calls[0].args.join('\n'), /miniaturized/);
});

test('returns not found when the installed local PWA app cannot be opened', async () => {
  const server = createServer({
    openInstalledApp: async () => {
      const error = new Error('Installed Agent Mission Control app was not found');
      error.statusCode = 404;
      throw error;
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/app/open-installed`, {
      method: 'POST',
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, 'Installed Agent Mission Control app was not found');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('opens a known Codex thread through the injected opener', async () => {
  const thread = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Continue work',
    appDeepLink: 'codex://threads/123e4567-e89b-12d3-a456-426614174000',
    resumeCommand: 'codex resume 123e4567-e89b-12d3-a456-426614174000',
  };
  const opened = [];
  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [thread],
      projects: [],
      inbox: [],
    }),
    openThread: async (selectedThread) => {
      opened.push(selectedThread);
      return { opened: true, method: 'test' };
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/threads/${thread.id}/open`, {
      method: 'POST',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].id, thread.id);
    assert.deepEqual(body, {
      opened: true,
      method: 'test',
      threadId: thread.id,
      provider: 'codex',
      appDeepLink: thread.appDeepLink,
      resumeCommand: thread.resumeCommand,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('opens indexed history threads when they are not in the dashboard snapshot', async () => {
  const indexedThread = {
    id: 'history-thread',
    provider: 'claude-code-cli',
    providerLabel: 'Claude Code CLI',
    title: 'Old investigation',
    resumeCommand: 'claude --resume history-thread',
  };
  const opened = [];
  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [],
      projects: [],
      inbox: [],
    }),
    searchIndex: {
      status: async () => ({ available: true, indexedAtMs: 123, threadCount: 1 }),
      indexDashboard: async () => ({ indexedAtMs: 123, threadCount: 1 }),
      searchThreads: async (params) => ({
        query: params.query,
        total: 1,
        items: [indexedThread],
      }),
      projectHistory: async () => ({ items: [] }),
    },
    openThread: async (selectedThread) => {
      opened.push(selectedThread);
      return { opened: false, method: 'copy-command' };
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/threads/${indexedThread.id}/open`, {
      method: 'POST',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(opened[0].id, indexedThread.id);
    assert.equal(body.resumeCommand, indexedThread.resumeCommand);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('focuses an existing Codex CLI Terminal tab on macOS', async () => {
  const calls = [];
  const result = await openThreadInCodexCli({
    id: '123e4567-e89b-12d3-a456-426614174000',
    provider: 'codex-cli',
    cwd: '/Users/example/project',
    rolloutPath: '/Users/example/.codex/sessions/rollout-123e4567-e89b-12d3-a456-426614174000.jsonl',
    status: 'running',
    resumeCommand: 'codex resume 123e4567-e89b-12d3-a456-426614174000',
  }, {
    platform: 'darwin',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'ps') {
        return {
          stdout: [
            '123 1 ttys071 node /Users/example/.local/bin/codex',
            '124 123 ttys071 /Users/example/.local/lib/node_modules/@openai/codex/vendor/codex/codex',
          ].join('\n'),
        };
      }
      if (command === 'lsof') {
        return {
          stdout: [
            `p${args[1]}`,
            'fcwd',
            'n/Users/example/project',
            'f50',
            'n/Users/example/.codex/sessions/rollout-123e4567-e89b-12d3-a456-426614174000.jsonl',
          ].join('\n'),
        };
      }
      return { stdout: 'focused' };
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.method, 'codex-terminal-existing');
  assert.equal(calls.at(-1).command, 'osascript');
  assert.match(calls.at(-1).args.join('\n'), /set targetTTY to "\/dev\/ttys071"/);
  assert.match(calls.at(-1).args.join('\n'), /set selected of terminalTab to true/);
  assert.match(calls.at(-1).args.join('\n'), /\bactivate\b/);
  assert.doesNotMatch(calls.at(-1).args.join('\n'), /do script/);
  assert.equal(calls.at(-1).options.timeout, 5000);
});

test('does not start a duplicate Codex CLI Terminal for running threads without a matching process', async () => {
  const calls = [];
  const result = await openThreadInCodexCli({
    id: '123e4567-e89b-12d3-a456-426614174000',
    provider: 'codex-cli',
    cwd: '/Users/example/project',
    status: 'running',
    resumeCommand: 'codex resume 123e4567-e89b-12d3-a456-426614174000',
  }, {
    platform: 'darwin',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'ps') return { stdout: '' };
      return { stdout: '' };
    },
  });

  assert.equal(result.opened, false);
  assert.equal(result.method, 'copy-command');
  assert.deepEqual(calls.map((call) => call.command), ['ps']);
});

test('opens idle Codex CLI threads in a new Terminal resume session on macOS', async () => {
  const calls = [];
  const result = await openThreadInCodexCli({
    id: '123e4567-e89b-12d3-a456-426614174000',
    provider: 'codex-cli',
    cwd: '/Users/example/project',
    status: 'idle',
    resumeCommand: 'codex resume 123e4567-e89b-12d3-a456-426614174000',
  }, {
    platform: 'darwin',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'ps') return { stdout: '' };
      return { stdout: '' };
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.method, 'codex-terminal');
  assert.deepEqual(calls.map((call) => call.command), ['ps', 'osascript']);
  assert.match(calls.at(-1).args.join('\n'), /tell application "Terminal"/);
  assert.match(calls.at(-1).args.join('\n'), /\bactivate\b/);
  assert.match(calls.at(-1).args.join('\n'), /codex resume 123e4567-e89b-12d3-a456-426614174000/);
  assert.equal(calls.at(-1).options.timeout, 5000);
});

test('opens Codex desktop history threads through CLI resume when requested', async () => {
  const calls = [];
  const result = await openThreadInProvider({
    id: '123e4567-e89b-12d3-a456-426614174000',
    provider: 'codex',
    cwd: '/Users/example/project',
    status: 'idle',
    defaultOpenMode: 'codex-cli-resume',
    appDeepLink: 'codex://threads/123e4567-e89b-12d3-a456-426614174000',
    resumeCommand: 'codex resume 123e4567-e89b-12d3-a456-426614174000',
  }, {
    platform: 'darwin',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'ps') return { stdout: '' };
      return { stdout: '' };
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.method, 'codex-terminal');
  assert.deepEqual(calls.map((call) => call.command), ['ps', 'osascript']);
  assert.match(calls.at(-1).args.join('\n'), /codex resume 123e4567-e89b-12d3-a456-426614174000/);
});

test('marks the source notification done after opening from the inbox', async () => {
  const thread = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Continue work',
    appDeepLink: 'codex://threads/123e4567-e89b-12d3-a456-426614174000',
    resumeCommand: 'codex resume 123e4567-e89b-12d3-a456-426614174000',
  };
  const opened = [];
  const updates = [];
  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [thread],
      projects: [],
      inbox: [],
    }),
    openThread: async (selectedThread) => {
      opened.push(selectedThread);
      return { opened: true, method: 'test' };
    },
    notificationCenter: {
      refresh: async () => ({ summary: {}, settings: {}, items: [] }),
      updateNotification: async (id, patch) => {
        updates.push({ id, patch });
        return { id, status: patch.status };
      },
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/threads/${thread.id}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notificationId: 'n1', markNotificationDone: true }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(opened.length, 1);
    assert.deepEqual(updates, [{ id: 'n1', patch: { status: 'done' } }]);
    assert.deepEqual(body.notification, { id: 'n1', status: 'done' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('does not open unknown thread ids', async () => {
  const server = createServer({
    loadDashboard: async () => ({ summary: {}, threads: [], projects: [], inbox: [] }),
    openThread: async () => {
      throw new Error('should not be called');
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/threads/missing/open`, {
      method: 'POST',
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, 'Thread not found');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves actionable notifications from the notification center', async () => {
  const calls = [];
  const server = createServer({
    loadDashboard: async () => ({ summary: {}, threads: [{ id: 'abc' }], projects: [], inbox: [] }),
    notificationCenter: {
      refresh: async (dashboard, options) => {
        calls.push({ dashboard, options });
        return {
          summary: { activeCount: 1, unreadCount: 1 },
          settings: { desktopNotificationsEnabled: false },
          items: [{ id: 'n1', threadId: 'abc', status: 'unread' }],
        };
      },
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/notifications`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.summary.activeCount, 1);
    assert.equal(body.items[0].id, 'n1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dashboard.threads[0].id, 'abc');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('coalesces concurrent dashboard loads across API routes', async () => {
  let releaseLoad;
  let loadCalls = 0;
  const loadStarted = [];
  const loadGate = new Promise((resolve) => {
    releaseLoad = resolve;
  });
  const server = createServer({
    loadDashboard: async () => {
      loadCalls += 1;
      loadStarted.push(loadCalls);
      await loadGate;
      return {
        summary: { activeThreads: 1 },
        threads: [{ id: 'abc' }],
        projects: [],
        inbox: [],
      };
    },
    notificationCenter: {
      refresh: async () => ({
        summary: { activeCount: 0, unreadCount: 0 },
        settings: { desktopNotificationsEnabled: false },
        items: [],
      }),
    },
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const dashboardRequest = fetch(`${base}/api/dashboard`);
    const notificationsRequest = fetch(`${base}/api/notifications`);

    while (loadStarted.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(loadCalls, 1);

    releaseLoad();
    const [dashboardResponse, notificationsResponse] = await Promise.all([
      dashboardRequest,
      notificationsRequest,
    ]);

    assert.equal(dashboardResponse.status, 200);
    assert.equal(notificationsResponse.status, 200);
    assert.equal(loadCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reuses cached dashboard snapshots for repeated API reads within the TTL', async () => {
  let nowMs = 1_000;
  let loadCalls = 0;
  const server = createServer({
    dashboardCacheTtlMs: 60_000,
    now: () => nowMs,
    loadDashboard: async () => {
      loadCalls += 1;
      return {
        summary: { loadCalls },
        threads: [{ id: `thread-${loadCalls}` }],
        projects: [],
        inbox: [],
      };
    },
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const firstResponse = await fetch(`${base}/api/dashboard`);
    const first = await firstResponse.json();
    const secondResponse = await fetch(`${base}/api/pending-summary`);
    const second = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.equal(first.summary.loadCalls, 1);
    assert.equal(second.runningHostThreadCount, 0);
    assert.equal(loadCalls, 1);

    nowMs += 60_001;
    const thirdResponse = await fetch(`${base}/api/dashboard`);
    const third = await thirdResponse.json();

    assert.equal(thirdResponse.status, 200);
    assert.equal(third.summary.loadCalls, 2);
    assert.equal(loadCalls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('pending summary reuses a recent stale dashboard snapshot instead of forcing a scan', async () => {
  let nowMs = 1_000;
  let loadCalls = 0;
  const server = createServer({
    dashboardCacheTtlMs: 10_000,
    pendingSummaryDashboardMaxAgeMs: 120_000,
    now: () => nowMs,
    loadDashboard: async () => {
      loadCalls += 1;
      return {
        summary: { runningHostThreads: loadCalls },
        threads: [{ id: `thread-${loadCalls}`, status: 'running' }],
        projects: [],
        inbox: [],
      };
    },
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const firstResponse = await fetch(`${base}/api/dashboard`);
    const first = await firstResponse.json();

    nowMs += 30_000;
    const summaryResponse = await fetch(`${base}/api/pending-summary`);
    const summary = await summaryResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(summaryResponse.status, 200);
    assert.equal(first.summary.runningHostThreads, 1);
    assert.equal(summary.runningHostThreadCount, 1);
    assert.equal(loadCalls, 1);

    nowMs += 120_001;
    const freshSummaryResponse = await fetch(`${base}/api/pending-summary`);
    const freshSummary = await freshSummaryResponse.json();

    assert.equal(freshSummaryResponse.status, 200);
    assert.equal(freshSummary.runningHostThreadCount, 2);
    assert.equal(loadCalls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reuses notification refreshes across dashboard scans by default', async () => {
  let nowMs = 1_000;
  let loadCalls = 0;
  let refreshCalls = 0;
  const server = createServer({
    now: () => nowMs,
    loadDashboard: async () => {
      loadCalls += 1;
      return {
        summary: { loadCalls },
        threads: [{ id: 'abc', updatedAtMs: nowMs }],
        projects: [],
        inbox: [],
      };
    },
    notificationCenter: {
      refresh: async () => {
        refreshCalls += 1;
        return {
          summary: { activeCount: 0, unreadCount: 0 },
          settings: { desktopNotificationsEnabled: false },
          items: [],
        };
      },
    },
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const firstResponse = await fetch(`${base}/api/dashboard`);
    nowMs += 10_001;
    const secondResponse = await fetch(`${base}/api/dashboard`);
    const second = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.equal(loadCalls, 2);
    assert.equal(refreshCalls, 1);
    assert.equal(second.performance.notifications.cacheTtlMs, 30_000);
    assert.equal(second.performance.notifications.hits, 1);
    assert.equal(second.performance.notifications.refreshCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reports local performance metrics for scan time, memory, and cache behavior', async () => {
  let nowMs = 1_000;
  let loadCalls = 0;
  const server = createServer({
    dashboardCacheTtlMs: 10_000,
    now: () => nowMs,
    loadDashboard: async () => {
      loadCalls += 1;
      return {
        summary: {},
        threads: [],
        projects: [],
        inbox: [],
      };
    },
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const firstResponse = await fetch(`${base}/api/dashboard`);
    const first = await firstResponse.json();
    nowMs += 1_000;
    const secondResponse = await fetch(`${base}/api/dashboard`);
    const second = await secondResponse.json();
    const metricsResponse = await fetch(`${base}/api/performance`);
    const metrics = await metricsResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.equal(metricsResponse.status, 200);
    assert.equal(loadCalls, 1);
    assert.equal(first.performance.dashboard.loadCount, 1);
    assert.equal(second.performance.dashboard.hits, 1);
    assert.equal(metrics.dashboard.cacheTtlMs, 10_000);
    assert.equal(metrics.dashboard.loadCount, 1);
    assert.equal(metrics.dashboard.hits, 1);
    assert.equal(typeof metrics.process.rssBytes, 'number');
    assert.ok(metrics.caches.codex.rolloutSignals);
    assert.ok(metrics.caches.claude.jsonlSignals);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves a privacy-limited pending summary for the macOS menu bar', async () => {
  const server = createServer({
    loadDashboard: async () => ({
      summary: { runningHostThreads: 2 },
      threads: [
        { id: 'abc', status: 'running' },
        { id: 'done-thread', status: 'fresh' },
      ],
      projects: [],
      inbox: [],
    }),
    notificationCenter: {
      refresh: async () => ({
        summary: { activeCount: 3, unreadCount: 2 },
        settings: { desktopNotificationsEnabled: false },
        items: [
          { id: 'n1', threadId: 'abc', status: 'unread', source: 'codex-unread', threadTitle: 'private title' },
          { id: 'n2', threadId: 'abc', status: 'unread', source: 'opencode-permission', threadTitle: 'private title' },
          { id: 'n3', threadId: 'done-thread', status: 'read', source: 'observed-completion', threadTitle: 'private title' },
        ],
      }),
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/pending-summary`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.activeCount, 3);
    assert.equal(body.displayCount, 3);
    assert.equal(body.hardPendingCount, 3);
    assert.equal(body.progressCount, 1);
    assert.equal(body.runningHostThreadCount, 2);
    assert.equal(body.hostLabel, '2 Host 工作中');
    assert.equal(body.label, '3 待处理');
    assert.equal('items' in body, false);
    assert.equal(JSON.stringify(body).includes('private title'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('keeps the menu bar summary aligned with the dashboard when cached progress is stale', async () => {
  const server = createServer({
    loadDashboard: async () => ({
      summary: { runningHostThreads: 1 },
      threads: [{
        id: 'abc',
        status: 'running',
        currentTurnStartedAtMs: 1778420050000,
        latestUserMessageAtMs: 1778420050000,
      }],
      projects: [],
      inbox: [],
    }),
    notificationCenter: {
      refresh: async () => ({
        summary: { activeCount: 1, unreadCount: 1 },
        settings: { desktopNotificationsEnabled: false },
        items: [{
          id: 'n1',
          threadId: 'abc',
          status: 'unread',
          source: 'observed-completion',
          signalAtMs: 1778420000000,
          threadTitle: 'private title',
        }],
      }),
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/pending-summary`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.activeCount, 0);
    assert.equal(body.displayCount, 0);
    assert.equal(body.hardPendingCount, 0);
    assert.equal(body.progressCount, 0);
    assert.equal(body.runningHostThreadCount, 1);
    assert.equal(body.hostLabel, '1 Host 工作中');
    assert.equal(body.label, '暂无待处理');
    assert.equal(JSON.stringify(body).includes('private title'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('updates notification status through PATCH', async () => {
  const updates = [];
  const server = createServer({
    notificationCenter: {
      updateNotification: async (id, patch) => {
        updates.push({ id, patch });
        return { id, status: patch.status };
      },
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/notifications/n1`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(updates, [{ id: 'n1', patch: { status: 'done' } }]);
    assert.equal(body.status, 'done');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('keeps desktop notification settings endpoint disabled', async () => {
  const settingsUpdates = [];
  const server = createServer({
    notificationCenter: {
      updateSettings: async (patch) => {
        settingsUpdates.push(patch);
        return { desktopNotificationsEnabled: patch.desktopNotificationsEnabled };
      },
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/notification-settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ desktopNotificationsEnabled: true }),
    });
    const body = await response.json();

    assert.equal(response.status, 410);
    assert.deepEqual(settingsUpdates, []);
    assert.equal(body.error, 'Desktop notifications are disabled');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('keeps manual desktop notification test endpoint disabled', async () => {
  const calls = [];
  const server = createServer({
    notificationCenter: {
      sendTestNotification: async () => {
        calls.push('test');
        return { sent: true };
      },
    },
  });

  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/notification-test`, {
      method: 'POST',
    });
    const body = await response.json();

    assert.equal(response.status, 410);
    assert.deepEqual(calls, []);
    assert.equal(body.error, 'Desktop notifications are disabled');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
