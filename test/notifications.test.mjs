import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  NotificationCenter,
  createNotificationCandidates,
} from '../src/notifications.mjs';

function reviewThread(overrides = {}) {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Ship dashboard',
    projectName: 'mission',
    cwd: '/tmp/mission',
    archived: false,
    completionHint: true,
    hasUnreadTurn: true,
    latestAgentFinalAtMs: 1777427200000,
    lastAgentMessage: 'Done. Ready for review.',
    updatedAtMs: 1777427200000,
    appDeepLink: 'codex://threads/123e4567-e89b-12d3-a456-426614174000',
    resumeCommand: 'codex resume 123e4567-e89b-12d3-a456-426614174000',
    ...overrides,
  };
}

function permissionThread(overrides = {}) {
  return reviewThread({
    id: 'opencode:ses_waiting',
    provider: 'opencode',
    title: 'OpenCode task',
    hasUnreadTurn: false,
    awaitingReview: false,
    awaitingPermission: true,
    openCodePendingToolCount: 1,
    openCodePendingToolAtMs: 1777427250000,
    latestAgentFinalAtMs: 0,
    updatedAtMs: 1777427250000,
    appDeepLink: 'opencode://open-project?directory=%2Ftmp%2Fmission',
    resumeCommand: "open 'opencode://open-project?directory=%2Ftmp%2Fmission'",
    ...overrides,
  });
}

test('creates actionable notification candidates for unread Codex threads', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread(),
      reviewThread({ id: 'archived', archived: true }),
      reviewThread({ id: 'not-ready', hasUnreadTurn: false }),
    ],
  }, 1777427300000);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, 'AWAITING_REVIEW');
  assert.equal(candidates[0].status, 'unread');
  assert.equal(candidates[0].threadTitle, 'Ship dashboard');
  assert.equal(candidates[0].id, '123e4567-e89b-12d3-a456-426614174000:AWAITING_REVIEW:1777427200000');
});

test('does not treat historical completion hints as unread work', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        completionHint: true,
        hasUnreadTurn: false,
        latestAgentFinalAtMs: 1777427200000,
      }),
    ],
  }, 1777427300000);

  assert.equal(candidates.length, 0);
});

test('creates actionable notification candidates for OpenCode permission requests', () => {
  const candidates = createNotificationCandidates({
    threads: [
      permissionThread(),
      permissionThread({ id: 'resolved', awaitingPermission: false, openCodePendingToolCount: 0 }),
    ],
  }, 1777427300000);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, 'AWAITING_PERMISSION');
  assert.equal(candidates[0].source, 'opencode-permission');
  assert.equal(candidates[0].priority, 'high');
  assert.equal(candidates[0].threadTitle, 'OpenCode task');
  assert.equal(candidates[0].id, 'opencode:ses_waiting:AWAITING_PERMISSION:1777427250000');
});

test('creates actionable notification candidates for generic Agent permission requests', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        id: 'claude-desktop-cowork:local_123',
        provider: 'claude-desktop-cowork',
        providerLabel: 'Claude Cowork',
        title: 'Cowork task',
        hasUnreadTurn: false,
        awaitingPermission: true,
        pendingToolCount: 1,
        pendingToolAtMs: 1777427260000,
        latestAgentFinalAtMs: 0,
        updatedAtMs: 1777427260000,
        resumeCommand: 'open -a Claude',
      }),
    ],
  }, 1777427300000);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, 'AWAITING_PERMISSION');
  assert.equal(candidates[0].source, 'claude-desktop-cowork-permission');
  assert.equal(candidates[0].reason, 'Claude Cowork 有待处理事项');
  assert.equal(candidates[0].id, 'claude-desktop-cowork:local_123:AWAITING_PERMISSION:1777427260000');
});


test('persists notification state and hides completed items', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const center = new NotificationCenter({
    storePath,
    now: () => 1777427300000,
  });

  try {
    const first = await center.refresh({ threads: [reviewThread()] });
    assert.equal(first.summary.activeCount, 1);
    assert.equal(first.summary.unreadCount, 1);

    const notificationId = first.items[0].id;
    await center.updateNotification(notificationId, { status: 'done' });

    const second = await center.refresh({ threads: [reviewThread()] });
    assert.equal(second.summary.activeCount, 0);
    assert.equal(second.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dismisses stale active notifications when unread signal disappears', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const center = new NotificationCenter({
    storePath,
    now: () => 1777427300000,
  });

  try {
    const first = await center.refresh({ threads: [reviewThread()] });
    assert.equal(first.summary.activeCount, 1);

    const second = await center.refresh({ threads: [reviewThread({ hasUnreadTurn: false })] });
    assert.equal(second.summary.activeCount, 0);
    assert.equal(second.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('notifies only for newly observed completion signals after initialization', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const existingCompletion = reviewThread({ hasUnreadTurn: false });
    const initialized = await center.refresh({ threads: [existingCompletion] });
    assert.equal(initialized.summary.activeCount, 0);

    now += 60_000;
    const newCompletion = reviewThread({
      id: 'new-thread',
      hasUnreadTurn: false,
      latestAgentFinalAtMs: 1777427360000,
      updatedAtMs: 1777427360000,
    });
    const next = await center.refresh({ threads: [existingCompletion, newCompletion] });
    assert.equal(next.summary.activeCount, 1);
    assert.equal(next.items[0].threadId, 'new-thread');
    assert.equal(next.items[0].source, 'observed-completion');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expires inferred completion notifications after a short grace window', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const existingCompletion = reviewThread({ hasUnreadTurn: false });
    await center.refresh({ threads: [existingCompletion] });

    now += 1_000;
    const newCompletion = reviewThread({
      id: 'new-thread',
      hasUnreadTurn: false,
      latestAgentFinalAtMs: 1777427301000,
      updatedAtMs: 1777427301000,
    });
    const created = await center.refresh({ threads: [existingCompletion, newCompletion] });
    assert.equal(created.summary.activeCount, 1);
    assert.equal(created.items[0].source, 'observed-completion');

    now += 59_000;
    const stillVisible = await center.refresh({ threads: [existingCompletion, newCompletion] });
    assert.equal(stillVisible.summary.activeCount, 1);

    now += 1_000;
    const expired = await center.refresh({ threads: [existingCompletion, newCompletion] });
    assert.equal(expired.summary.activeCount, 0);
    assert.equal(expired.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps Codex unread notifications until the unread signal clears', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const first = await center.refresh({ threads: [reviewThread()] });
    assert.equal(first.summary.activeCount, 1);
    assert.equal(first.items[0].source, 'codex-unread');

    now += 2 * 60 * 1000;
    const later = await center.refresh({ threads: [reviewThread()] });
    assert.equal(later.summary.activeCount, 1);
    assert.equal(later.items[0].source, 'codex-unread');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps OpenCode permission notifications until permission resolves', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const first = await center.refresh({ threads: [permissionThread()] });
    assert.equal(first.summary.activeCount, 1);
    assert.equal(first.items[0].source, 'opencode-permission');

    now += 2 * 60 * 1000;
    const later = await center.refresh({ threads: [permissionThread()] });
    assert.equal(later.summary.activeCount, 1);
    assert.equal(later.items[0].source, 'opencode-permission');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('snoozes notifications until their due time', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const first = await center.refresh({ threads: [reviewThread()] });
    const notificationId = first.items[0].id;
    await center.updateNotification(notificationId, { status: 'snoozed', snoozeMinutes: 10 });

    const snoozed = await center.refresh({ threads: [reviewThread()] });
    assert.equal(snoozed.summary.activeCount, 0);
    assert.equal(snoozed.summary.snoozedCount, 1);

    now += 11 * 60 * 1000;
    const due = await center.refresh({ threads: [reviewThread()] });
    assert.equal(due.summary.activeCount, 1);
    assert.equal(due.items[0].status, 'unread');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sends one privacy-preserving desktop notification for new actionable items', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const sent = [];
  const center = new NotificationCenter({
    storePath,
    now: () => 1777427300000,
    notifyDesktop: async (payload) => sent.push(payload),
  });

  try {
    await center.updateSettings({ desktopNotificationsEnabled: true });
    await center.refresh({ threads: [reviewThread()] }, { notify: true });
    await center.refresh({ threads: [reviewThread()] }, { notify: true });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].count, 1);
    assert.equal(sent[0].title, 'Codex 有新进展待处理');
    assert.equal(sent[0].message, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sends a manual desktop notification test payload', async () => {
  const sent = [];
  const center = new NotificationCenter({
    now: () => 1777427300000,
    notifyDesktop: async (payload) => {
      sent.push(payload);
      return { sent: true };
    },
  });

  const result = await center.sendTestNotification();

  assert.deepEqual(result, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Codex 有新进展待处理');
  assert.equal(sent[0].message, '');
});

test('serializes notification state writes from overlapping refreshes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const center = new NotificationCenter({
    storePath,
    now: () => 1777427300000,
  });

  try {
    await Promise.all([
      center.refresh({ threads: [reviewThread({ id: 'thread-a' })] }),
      center.refresh({ threads: [reviewThread({ id: 'thread-b' })] }),
    ]);

    const stored = JSON.parse(await readFile(storePath, 'utf8'));
    const statuses = Object.values(stored.notifications).map((record) => record.status).sort();
    assert.deepEqual(statuses, ['dismissed', 'unread']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not let a silent dashboard refresh consume desktop notification delivery', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const sent = [];
  const center = new NotificationCenter({
    storePath,
    now: () => now,
    notifyDesktop: async (payload) => sent.push(payload),
  });

  try {
    await center.updateSettings({ desktopNotificationsEnabled: true });
    await center.refresh({ threads: [reviewThread()] });
    assert.equal(sent.length, 0);

    now += 20_000;
    await center.refresh({ threads: [reviewThread()] }, { notify: true });
    await center.refresh({ threads: [reviewThread()] }, { notify: true });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].count, 1);

    const stored = JSON.parse(await readFile(storePath, 'utf8'));
    const record = stored.notifications['123e4567-e89b-12d3-a456-426614174000:AWAITING_REVIEW:1777427200000'];
    assert.equal(record.desktopNotificationPending, false);
    assert.equal(record.desktopNotifiedAtMs, 1777427320000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
