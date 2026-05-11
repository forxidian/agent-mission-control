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
    assert.equal(body.label, '3 待查看');
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
