import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.mjs';

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

test('reports and opens the installed local PWA app through injected handlers', async () => {
  const calls = [];
  const server = createServer({
    getInstalledAppStatus: async () => ({ installed: true, method: 'macos-pwa-app' }),
    openInstalledApp: async () => {
      calls.push('open');
      return { opened: true, method: 'macos-pwa-app' };
    },
    minimizeInstalledApp: async () => {
      calls.push('minimize');
      return { minimized: true, method: 'macos-pwa-app' };
    },
  });

  const address = await listen(server);
  try {
    const base = `http://${address.address}:${address.port}`;
    const statusResponse = await fetch(`${base}/api/app/installed`);
    const status = await statusResponse.json();
    const openResponse = await fetch(`${base}/api/app/open-installed`, { method: 'POST' });
    const opened = await openResponse.json();
    const minimizeResponse = await fetch(`${base}/api/app/minimize-installed`, { method: 'POST' });
    const minimized = await minimizeResponse.json();

    assert.equal(statusResponse.status, 200);
    assert.deepEqual(status, { installed: true, method: 'macos-pwa-app' });
    assert.equal(openResponse.status, 200);
    assert.deepEqual(opened, { opened: true, method: 'macos-pwa-app' });
    assert.equal(minimizeResponse.status, 200);
    assert.deepEqual(minimized, { minimized: true, method: 'macos-pwa-app' });
    assert.deepEqual(calls, ['open', 'minimize']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
      threads: [{ id: 'abc', status: 'running' }],
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
          { id: 'n3', threadId: 'abc', status: 'read', source: 'observed-completion', threadTitle: 'private title' },
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
    assert.equal(body.hardPendingCount, 2);
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
