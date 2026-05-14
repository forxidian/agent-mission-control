import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  assert.equal(candidates[0].title, '任务等待验收');
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

test('does not create actionable notifications for sub-agent threads', () => {
  const source = '{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}';
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({ source }),
      permissionThread({ source }),
    ],
  }, 1777427300000, { includeObservedCompletions: true });

  assert.equal(candidates.length, 0);
});

test('does not create review notifications for sub-agent completions', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        hasUnreadTurn: false,
        source: '{"subagent":{"thread_spawn":{"parent_thread_id":"parent"}}}',
      }),
    ],
  }, 1777427300000, { includeObservedCompletions: true });

  assert.equal(candidates.length, 0);
});

test('creates soft progress notifications for Claude Desktop completions', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        id: 'claude-desktop-code:local_123',
        provider: 'claude-desktop-code',
        providerLabel: 'Claude Desktop Code',
        source: 'claude-desktop-code',
        hasUnreadTurn: false,
        latestUserMessageAtMs: 1777427100000,
        latestAgentFinalAtMs: 1777427200000,
        latestMessageKind: 'agent',
        status: 'fresh',
        currentTurnStartedAtMs: null,
        appDeepLink: 'claude://resume?session=123e4567-e89b-12d3-a456-426614174000',
        resumeCommand: "open 'claude://resume?session=123e4567-e89b-12d3-a456-426614174000'",
      }),
    ],
  }, 1777427300000, { includeObservedCompletions: true });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, 'AWAITING_REVIEW');
  assert.equal(candidates[0].source, 'observed-completion');
  assert.equal(candidates[0].title, '任务有新进展');
  assert.equal(candidates[0].threadId, 'claude-desktop-code:local_123');
  assert.equal(candidates[0].reason, 'Agent 已完成一轮工作');
});

test('does not infer observed completions for unsupported non-Codex providers', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        id: 'opencode-session',
        provider: 'opencode',
        source: 'opencode',
        hasUnreadTurn: false,
      }),
    ],
  }, 1777427300000, { includeObservedCompletions: true });

  assert.equal(candidates.length, 0);
});

test('does not infer observed completions for still-running Claude Cowork sessions', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        id: 'claude-desktop-cowork:local_running',
        provider: 'claude-desktop-cowork',
        providerLabel: 'Claude Cowork',
        source: 'claude-desktop-cowork',
        hasUnreadTurn: false,
        latestUserMessageAtMs: 1777427100000,
        latestAgentFinalAtMs: 1777427200000,
        latestMessageKind: 'agent',
        status: 'idle',
        currentTurnStartedAtMs: null,
        agentRunning: true,
      }),
    ],
  }, 1777427300000, { includeObservedCompletions: true });

  assert.equal(candidates.length, 0);
});

test('does not infer observed completions for exec-spawned Codex threads', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        id: 'exec-thread',
        provider: 'codex',
        source: 'exec',
        hasUnreadTurn: false,
      }),
    ],
  }, 1777427300000, { includeObservedCompletions: true });

  assert.equal(candidates.length, 0);
});

test('does not infer observed completions for running threads', () => {
  const candidates = createNotificationCandidates({
    threads: [
      reviewThread({
        hasUnreadTurn: false,
        status: 'running',
        currentTurnStartedAtMs: 1777427250000,
      }),
    ],
  }, 1777427300000, { includeObservedCompletions: true });

  assert.equal(candidates.length, 0);
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

    const second = await center.refresh({
      threads: [
        reviewThread({
          hasUnreadTurn: false,
          latestUserMessageAtMs: 1777427300000,
        }),
      ],
    });
    assert.equal(second.summary.activeCount, 0);
    assert.equal(second.items.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('notifies recent observed completion signals during initialization', async () => {
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
    assert.equal(initialized.summary.activeCount, 1);
    assert.equal(initialized.items[0].threadId, existingCompletion.id);
    assert.equal(initialized.items[0].source, 'observed-completion');

    now += 60_000;
    const newCompletion = reviewThread({
      id: 'new-thread',
      hasUnreadTurn: false,
      latestAgentFinalAtMs: 1777427360000,
      updatedAtMs: 1777427360000,
    });
    const next = await center.refresh({ threads: [existingCompletion, newCompletion] });
    assert.equal(next.summary.activeCount, 2);
    assert.equal(next.items[0].threadId, 'new-thread');
    assert.equal(next.items[0].source, 'observed-completion');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refreshes legacy observed completion titles to soft progress copy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const completion = reviewThread({ hasUnreadTurn: false });
    const candidateId = `${completion.id}:AWAITING_REVIEW:${completion.latestAgentFinalAtMs}`;
    await writeFile(storePath, `${JSON.stringify({
      version: 2,
      settings: { desktopNotificationsEnabled: false, privacyMode: true },
      notifications: {
        [candidateId]: {
          id: candidateId,
          threadId: completion.id,
          type: 'AWAITING_REVIEW',
          source: 'observed-completion',
          status: 'unread',
          title: '任务有新进展，等待处理',
          reason: 'Agent 已完成一轮工作',
          threadTitle: completion.title,
          projectName: completion.projectName,
          signalAtMs: completion.latestAgentFinalAtMs,
          createdAtMs: completion.latestAgentFinalAtMs,
        },
      },
      observedReviewSignals: { [candidateId]: completion.latestAgentFinalAtMs },
      reviewSignalsInitializedAtMs: now - 60_000,
    }, null, 2)}\n`);

    const result = await center.refresh({ threads: [completion] });
    assert.equal(result.items[0].title, '任务有新进展');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('suppresses stale observed completions during initialization', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const staleCompletion = reviewThread({
      hasUnreadTurn: false,
      latestAgentFinalAtMs: now - (3 * 60 * 60 * 1000),
      updatedAtMs: now - (3 * 60 * 60 * 1000),
    });
    const initialized = await center.refresh({ threads: [staleCompletion] });
    assert.equal(initialized.summary.activeCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expires inferred completion notifications after the recent window', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const existingCompletion = reviewThread({
      hasUnreadTurn: false,
      latestAgentFinalAtMs: now - (3 * 60 * 60 * 1000),
      updatedAtMs: now - (3 * 60 * 60 * 1000),
    });
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

    now += 3 * 60 * 60 * 1000;
    const later = await center.refresh({ threads: [existingCompletion, newCompletion] });
    assert.equal(later.summary.activeCount, 0);
    assert.equal(later.items.length, 0);

    const stored = JSON.parse(await readFile(storePath, 'utf8'));
    assert.equal(stored.notifications[created.items[0].id].status, 'dismissed');
    assert.equal(stored.notifications[created.items[0].id].dismissReason, 'live-signal-missing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clears inferred completion notifications when the user continues the thread', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const completedThread = reviewThread({
      hasUnreadTurn: false,
      latestAgentFinalAtMs: 1777427200000,
      updatedAtMs: 1777427200000,
    });
    const first = await center.refresh({ threads: [completedThread] });
    assert.equal(first.summary.activeCount, 1);
    assert.equal(first.items[0].source, 'observed-completion');

    now += 60_000;
    const continuedThread = reviewThread({
      hasUnreadTurn: false,
      latestAgentFinalAtMs: 1777427200000,
      latestUserMessageAtMs: 1777427350000,
      status: 'running',
      currentTurnStartedAtMs: 1777427350000,
      updatedAtMs: 1777427350000,
    });
    const second = await center.refresh({ threads: [continuedThread] });
    assert.equal(second.summary.activeCount, 0);
    assert.equal(second.items.length, 0);

    const stored = JSON.parse(await readFile(storePath, 'utf8'));
    assert.equal(stored.notifications[first.items[0].id].status, 'dismissed');
    assert.equal(stored.notifications[first.items[0].id].dismissReason, 'new-user-message');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reopens legacy auto-dismissed observed completions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const existingCompletion = reviewThread({
      hasUnreadTurn: false,
      latestAgentFinalAtMs: now - (3 * 60 * 60 * 1000),
      updatedAtMs: now - (3 * 60 * 60 * 1000),
    });
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

    const stored = JSON.parse(await readFile(storePath, 'utf8'));
    stored.notifications[created.items[0].id] = {
      ...stored.notifications[created.items[0].id],
      status: 'dismissed',
      updatedAtMs: now + 60_000,
    };
    await writeFile(storePath, `${JSON.stringify(stored, null, 2)}\n`);

    now += 2 * 60_000;
    const reopened = await center.refresh({ threads: [existingCompletion, newCompletion] });
    assert.equal(reopened.summary.activeCount, 1);
    assert.equal(reopened.items[0].status, 'unread');
    assert.equal(reopened.items[0].source, 'observed-completion');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not reopen stale legacy observed completions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  let now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    now += 1_000;
    const oldCompletion = reviewThread({
      id: 'old-thread',
      hasUnreadTurn: false,
      latestAgentFinalAtMs: now - (3 * 60 * 60 * 1000),
      updatedAtMs: now - (3 * 60 * 60 * 1000),
    });
    const candidateId = `${oldCompletion.id}:AWAITING_REVIEW:${oldCompletion.latestAgentFinalAtMs}`;
    await writeFile(storePath, `${JSON.stringify({
      version: 2,
      settings: { desktopNotificationsEnabled: false, privacyMode: true },
      notifications: {
        [candidateId]: {
          id: candidateId,
          threadId: oldCompletion.id,
          type: 'AWAITING_REVIEW',
          source: 'observed-completion',
          status: 'dismissed',
          threadTitle: oldCompletion.title,
          projectName: oldCompletion.projectName,
          signalAtMs: oldCompletion.latestAgentFinalAtMs,
          createdAtMs: oldCompletion.latestAgentFinalAtMs,
          updatedAtMs: oldCompletion.latestAgentFinalAtMs + 60_000,
        },
      },
      observedReviewSignals: { [candidateId]: oldCompletion.latestAgentFinalAtMs },
      reviewSignalsInitializedAtMs: 1777427200000,
    }, null, 2)}\n`);

    const result = await center.refresh({ threads: [oldCompletion] });
    assert.equal(result.summary.activeCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dismisses stale active legacy observed completions without the sticky policy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const staleCompletion = reviewThread({
      id: 'stale-active-thread',
      hasUnreadTurn: false,
      latestAgentFinalAtMs: now - (3 * 60 * 60 * 1000),
      updatedAtMs: now - (3 * 60 * 60 * 1000),
    });
    const candidateId = `${staleCompletion.id}:AWAITING_REVIEW:${staleCompletion.latestAgentFinalAtMs}`;
    await writeFile(storePath, `${JSON.stringify({
      version: 2,
      settings: { desktopNotificationsEnabled: false, privacyMode: true },
      notifications: {
        [candidateId]: {
          id: candidateId,
          threadId: staleCompletion.id,
          type: 'AWAITING_REVIEW',
          source: 'observed-completion',
          status: 'unread',
          threadTitle: staleCompletion.title,
          projectName: staleCompletion.projectName,
          signalAtMs: staleCompletion.latestAgentFinalAtMs,
          createdAtMs: staleCompletion.latestAgentFinalAtMs,
        },
      },
      observedReviewSignals: { [candidateId]: staleCompletion.latestAgentFinalAtMs },
      reviewSignalsInitializedAtMs: 1777427200000,
    }, null, 2)}\n`);

    const result = await center.refresh({ threads: [staleCompletion] });
    assert.equal(result.summary.activeCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dismisses stale active legacy observed completions with the sticky policy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cmc-notifications-'));
  const storePath = path.join(dir, 'notifications.json');
  const now = 1777427300000;
  const center = new NotificationCenter({
    storePath,
    now: () => now,
  });

  try {
    const staleCompletion = reviewThread({
      id: 'stale-sticky-thread',
      hasUnreadTurn: false,
      latestAgentFinalAtMs: now - (3 * 60 * 60 * 1000),
      updatedAtMs: now - (3 * 60 * 60 * 1000),
    });
    const candidateId = `${staleCompletion.id}:AWAITING_REVIEW:${staleCompletion.latestAgentFinalAtMs}`;
    await writeFile(storePath, `${JSON.stringify({
      version: 2,
      settings: { desktopNotificationsEnabled: false, privacyMode: true },
      notifications: {
        [candidateId]: {
          id: candidateId,
          threadId: staleCompletion.id,
          type: 'AWAITING_REVIEW',
          source: 'observed-completion',
          status: 'unread',
          observedCompletionPolicy: 'sticky-until-handled',
          threadTitle: staleCompletion.title,
          projectName: staleCompletion.projectName,
          signalAtMs: staleCompletion.latestAgentFinalAtMs,
          createdAtMs: staleCompletion.latestAgentFinalAtMs,
        },
      },
      observedReviewSignals: { [candidateId]: staleCompletion.latestAgentFinalAtMs },
      reviewSignalsInitializedAtMs: 1777427200000,
    }, null, 2)}\n`);

    const result = await center.refresh({ threads: [staleCompletion] });
    assert.equal(result.summary.activeCount, 0);
    assert.equal(result.items.length, 0);
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

test('does not send desktop notifications while the feature is hidden', async () => {
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

    assert.equal(sent.length, 0);

    const stored = JSON.parse(await readFile(storePath, 'utf8'));
    assert.equal(stored.settings.desktopNotificationsEnabled, false);
    const record = stored.notifications['123e4567-e89b-12d3-a456-426614174000:AWAITING_REVIEW:1777427200000'];
    assert.equal(record.desktopNotificationPending, false);
    assert.equal(record.desktopNotifiedAtMs, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('returns disabled for manual desktop notification tests', async () => {
  const sent = [];
  const center = new NotificationCenter({
    now: () => 1777427300000,
    notifyDesktop: async (payload) => {
      sent.push(payload);
      return { sent: true };
    },
  });

  const result = await center.sendTestNotification();

  assert.deepEqual(result, { sent: false, reason: 'disabled-until-native-notifier' });
  assert.equal(sent.length, 0);
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

test('keeps desktop notification metadata disabled across refreshes', async () => {
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

    assert.equal(sent.length, 0);

    const stored = JSON.parse(await readFile(storePath, 'utf8'));
    const record = stored.notifications['123e4567-e89b-12d3-a456-426614174000:AWAITING_REVIEW:1777427200000'];
    assert.equal(record.desktopNotificationPending, false);
    assert.equal(record.desktopNotifiedAtMs, null);
    assert.equal(stored.settings.desktopNotificationsEnabled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
