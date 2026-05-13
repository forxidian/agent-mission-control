import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReviewJobStore } from '../src/review-jobs.mjs';

async function tempStore(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'amc-review-jobs-'));
  return createReviewJobStore({
    filePath: path.join(dir, 'reviews.jsonl'),
    ...options,
  });
}

async function readSnapshots(store) {
  const raw = await readFile(store.filePath, 'utf8');
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('creating a job creates a stable review id and appends a queued snapshot', async () => {
  const store = await tempStore({ now: () => 1778515200000, randomSuffix: () => 'abcd' });

  const job = await store.createJob({
    source: { threadId: 'thread-1', provider: 'codex', title: 'Build feature' },
    target: { provider: 'claude-code-cli', runner: 'claude-print' },
    templateId: 'technical-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'Agent output preview',
  });

  assert.equal(job.id, 'review_1778515200000_abcd');
  assert.equal(job.status, 'queued');
  assert.equal(job.createdAtMs, 1778515200000);
  assert.equal(job.updatedAtMs, 1778515200000);
  assert.deepEqual(job.fixLoop, {
    status: 'not-started',
    promptCopiedAtMs: null,
    sourceOpenedAtMs: null,
    resolvedAtMs: null,
  });

  const snapshots = await readSnapshots(store);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].id, job.id);
});

test('reads the latest snapshot by id after status updates', async () => {
  let time = 1778515200000;
  const store = await tempStore({ now: () => time, randomSuffix: () => 'abcd' });
  const job = await store.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'codex-cli' },
    templateId: 'code-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'preview',
  });

  time += 10;
  await store.updateJob(job.id, { status: 'running', startedAtMs: time });
  time += 10;
  await store.updateJob(job.id, {
    status: 'succeeded',
    completedAtMs: time,
    resultText: 'Looks good',
    resultPreview: 'Looks good',
    exitCode: 0,
  });

  const latest = await store.getJob(job.id);
  assert.equal(latest.status, 'succeeded');
  assert.equal(latest.startedAtMs, 1778515200010);
  assert.equal(latest.completedAtMs, 1778515200020);
  assert.equal(latest.resultText, 'Looks good');

  const snapshots = await readSnapshots(store);
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.status), ['queued', 'running', 'succeeded']);
});

test('updates review fix loop metadata without changing review runner status', async () => {
  let time = 1778515200000;
  const store = await tempStore({ now: () => time, randomSuffix: () => 'fix' });
  const job = await store.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'claude-code-cli' },
    templateId: 'technical-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'preview',
  });

  time += 10;
  await store.updateJob(job.id, { status: 'succeeded', resultText: 'done' });
  time += 10;
  const updated = await store.updateJob(job.id, {
    fixLoop: {
      status: 'source-opened',
      promptCopiedAtMs: 1778515200020,
      sourceOpenedAtMs: 1778515200020,
    },
  });

  assert.equal(updated.status, 'succeeded');
  assert.deepEqual(updated.fixLoop, {
    status: 'source-opened',
    promptCopiedAtMs: 1778515200020,
    sourceOpenedAtMs: 1778515200020,
    resolvedAtMs: null,
  });
});

test('updates jobs to failed status with error metadata', async () => {
  const store = await tempStore({ now: () => 1778515200000, randomSuffix: () => 'fail' });
  const job = await store.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'opencode-cli' },
    templateId: 'response-quality-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'preview',
  });

  const failed = await store.updateJob(job.id, {
    status: 'failed',
    error: 'Runner exited with code 1',
    stderr: 'permission denied',
    exitCode: 1,
    timedOut: false,
  });

  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Runner exited with code 1');
  assert.equal(failed.stderr, 'permission denied');
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.timedOut, false);
});

test('lists recent jobs with limit and thread filtering', async () => {
  let time = 1778515200000;
  let suffix = 0;
  const store = await tempStore({
    now: () => time,
    randomSuffix: () => String(++suffix).padStart(4, '0'),
  });

  const first = await store.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'codex-cli' },
    templateId: 'code-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'first',
  });
  time += 10;
  await store.createJob({
    source: { threadId: 'thread-2' },
    target: { provider: 'claude-code-cli' },
    templateId: 'technical-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'second',
  });
  time += 10;
  const third = await store.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'opencode-cli' },
    templateId: 'product-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'third',
  });

  const limited = await store.listJobs({ limit: 2 });
  assert.deepEqual(limited.items.map((job) => job.id), [third.id, limited.items[1].id]);
  assert.equal(limited.items.length, 2);
  assert.equal(limited.summary.total, 3);

  const forThread = await store.listJobs({ threadId: 'thread-1' });
  assert.deepEqual(forThread.items.map((job) => job.id), [third.id, first.id]);
  assert.equal(forThread.summary.total, 2);
});

test('compacts JSONL snapshots after threshold by keeping latest snapshot per job', async () => {
  let time = 1778515200000;
  const store = await tempStore({
    now: () => time,
    randomSuffix: () => 'compact',
    compactThreshold: 3,
  });
  const job = await store.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'codex-cli' },
    templateId: 'code-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'preview',
  });

  time += 1;
  await store.updateJob(job.id, { status: 'running' });
  time += 1;
  await store.updateJob(job.id, { status: 'failed', error: 'first failure' });
  time += 1;
  await store.updateJob(job.id, { status: 'failed', error: 'latest failure' });

  const snapshots = await readSnapshots(store);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].id, job.id);
  assert.equal(snapshots[0].status, 'failed');
  assert.equal(snapshots[0].error, 'latest failure');
});

test('truncates result text, result preview, and stderr before storing', async () => {
  const store = await tempStore({
    now: () => 1778515200000,
    randomSuffix: () => 'trunc',
    maxResultChars: 12,
    maxPreviewChars: 8,
    maxStderrChars: 10,
  });
  const job = await store.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'claude-code-cli' },
    templateId: 'technical-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'input preview',
  });

  const updated = await store.updateJob(job.id, {
    status: 'succeeded',
    resultText: 'r'.repeat(40),
    resultPreview: 'p'.repeat(40),
    stderr: 'e'.repeat(40),
  });

  assert.equal(updated.resultText, `${'r'.repeat(12)}...`);
  assert.equal(updated.resultPreview, `${'p'.repeat(8)}...`);
  assert.equal(updated.stderr, `${'e'.repeat(10)}...`);
  assert.equal(updated.truncatedResult, true);
});
