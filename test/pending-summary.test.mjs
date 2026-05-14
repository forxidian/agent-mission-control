import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPendingSummary } from '../src/pending-summary.mjs';

test('counts hard pending and soft progress in one pending bucket', () => {
  const summary = buildPendingSummary({
    summary: { activeCount: 3 },
    items: [
      { id: 'permission', source: 'opencode-permission' },
      { id: 'review', source: 'codex-unread' },
      { id: 'progress', source: 'observed-completion' },
    ],
  }, 1778420000000);

  assert.deepEqual(summary, {
    activeCount: 3,
    displayCount: 3,
    hardPendingCount: 3,
    progressCount: 1,
    runningHostThreadCount: 0,
    label: '3 待处理',
    hostLabel: 'Host 空闲',
    generatedAtMs: 1778420000000,
  });
});

test('counts soft progress as pending work', () => {
  const summary = buildPendingSummary({
    summary: { activeCount: 1 },
    items: [{ id: 'progress', source: 'observed-completion' }],
  }, 1778420000000);

  assert.equal(summary.hardPendingCount, 1);
  assert.equal(summary.progressCount, 1);
  assert.equal(summary.displayCount, 1);
  assert.equal(summary.label, '1 待处理');
});

test('does not show a ghost badge when the active summary and visible items diverge', () => {
  const summary = buildPendingSummary({
    summary: { activeCount: 1 },
    items: [],
  }, 1778420000000);

  assert.equal(summary.activeCount, 0);
  assert.equal(summary.hardPendingCount, 0);
  assert.equal(summary.displayCount, 0);
  assert.equal(summary.label, '暂无待处理');
});

test('uses the dashboard thread state to hide stale soft progress in the menu summary', () => {
  const summary = buildPendingSummary({
    summary: { activeCount: 1 },
    items: [{
      id: 'progress',
      source: 'observed-completion',
      threadId: 'thread-1',
      signalAtMs: 1778420000000,
    }],
  }, 1778420100000, {
    threads: [{
      id: 'thread-1',
      status: 'running',
      latestUserMessageAtMs: 1778420050000,
      currentTurnStartedAtMs: 1778420050000,
    }],
  });

  assert.equal(summary.activeCount, 0);
  assert.equal(summary.displayCount, 0);
  assert.equal(summary.progressCount, 0);
  assert.equal(summary.label, '暂无待处理');
});

test('keeps hard pending notifications even when the thread is running', () => {
  const summary = buildPendingSummary({
    summary: { activeCount: 1 },
    items: [{
      id: 'permission',
      source: 'opencode-permission',
      threadId: 'thread-1',
      signalAtMs: 1778420000000,
    }],
  }, 1778420100000, {
    threads: [{ id: 'thread-1', status: 'running' }],
  });

  assert.equal(summary.activeCount, 1);
  assert.equal(summary.displayCount, 1);
  assert.equal(summary.label, '1 待处理');
});

test('includes running host thread count without exposing thread details', () => {
  const summary = buildPendingSummary({
    summary: { activeCount: 0 },
    items: [],
  }, 1778420000000, {
    threads: [
      { id: 'host-1', status: 'warm' },
      { id: 'sub-1', parentThreadId: 'host-1', isSubagent: true, status: 'running' },
      { id: 'sub-2', parentThreadId: 'host-1', isSubagent: true, status: 'running' },
      { id: 'host-2', status: 'running' },
      { id: 'archived-host', status: 'running', archived: true },
    ],
  });

  assert.equal(summary.runningHostThreadCount, 2);
  assert.equal(summary.hostLabel, '2 Host 工作中');
  assert.equal(JSON.stringify(summary).includes('host-1'), false);
});
