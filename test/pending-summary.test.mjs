import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPendingSummary } from '../src/pending-summary.mjs';

test('counts hard pending items separately from soft progress updates', () => {
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
    hardPendingCount: 2,
    progressCount: 1,
    label: '3 待查看',
    generatedAtMs: 1778420000000,
  });
});

test('uses active notifications for display even when only soft progress remains', () => {
  const summary = buildPendingSummary({
    summary: { activeCount: 1 },
    items: [{ id: 'progress', source: 'observed-completion' }],
  }, 1778420000000);

  assert.equal(summary.hardPendingCount, 0);
  assert.equal(summary.progressCount, 1);
  assert.equal(summary.displayCount, 1);
  assert.equal(summary.label, '1 待查看');
});
