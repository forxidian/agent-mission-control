import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.once('error', reject);
  });
}

function createFakeReviewStore() {
  const jobs = new Map();
  let nextId = 1;

  return {
    jobs,
    async createJob(payload) {
      const job = {
        id: `review_test_${nextId++}`,
        status: 'queued',
        createdAtMs: 1000 + nextId,
        updatedAtMs: 1000 + nextId,
        resultText: '',
        resultPreview: '',
        error: '',
        stderr: '',
        timedOut: false,
        exitCode: null,
        ...payload,
      };
      jobs.set(job.id, job);
      return job;
    },
    async updateJob(id, patch) {
      const current = jobs.get(id);
      if (!current) {
        const error = new Error(`Review job not found: ${id}`);
        error.statusCode = 404;
        throw error;
      }
      const updated = { ...current, ...patch, updatedAtMs: (current.updatedAtMs || 0) + 1 };
      jobs.set(id, updated);
      return updated;
    },
    async getJob(id) {
      const job = jobs.get(id);
      if (!job) {
        const error = new Error(`Review job not found: ${id}`);
        error.statusCode = 404;
        throw error;
      }
      return job;
    },
    async listJobs({ threadId, limit = 50 } = {}) {
      let items = [...jobs.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      if (threadId) items = items.filter((job) => job.source?.threadId === threadId);
      items = items.slice(0, limit);
      return {
        items,
        summary: {
          total: items.length,
          running: items.filter((job) => job.status === 'running').length,
          failed: items.filter((job) => job.status === 'failed').length,
        },
      };
    },
  };
}

async function nextTick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('GET /api/review-targets returns detected target agents', async () => {
  const server = createServer({
    loadReviewTargets: async () => ({
      items: [
        { provider: 'codex-cli', label: 'Codex CLI', available: true },
        { provider: 'claude-code-cli', label: 'Claude Code CLI', available: false },
      ],
    }),
  });
  const address = await listen(server);

  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/review-targets`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items[0].provider, 'codex-cli');
    assert.equal(body.items[1].available, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/threads/:id/review-content returns latest agent signal content', async () => {
  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [{
        id: 'thread-1',
        title: 'Review me',
        lastAgentMessage: 'Agent output ready for review',
      }],
      projects: [],
      inbox: [],
    }),
  });
  const address = await listen(server);

  try {
    const response = await fetch(
      `http://${address.address}:${address.port}/api/threads/thread-1/review-content?mode=latest-agent-signal`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.threadId, 'thread-1');
    assert.equal(body.content, 'Agent output ready for review');
    assert.equal(body.sourceDescription, '最近 Agent 输出信号');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/threads/:id/review-content returns 404 and 422 style errors', async () => {
  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [{ id: 'empty-thread', lastAgentMessage: '' }],
      projects: [],
      inbox: [],
    }),
  });
  const address = await listen(server);

  try {
    const base = `http://${address.address}:${address.port}`;
    const missingResponse = await fetch(`${base}/api/threads/missing/review-content`);
    const missingBody = await missingResponse.json();
    const emptyResponse = await fetch(`${base}/api/threads/empty-thread/review-content`);
    const emptyBody = await emptyResponse.json();

    assert.equal(missingResponse.status, 404);
    assert.equal(missingBody.error, 'Thread not found');
    assert.equal(emptyResponse.status, 422);
    assert.match(emptyBody.error, /暂无可评审的 Agent 输出/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/threads/:id/review-content returns thread summary mode content', async () => {
  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [{
        id: 'thread-1',
        providerLabel: 'Codex',
        title: 'Review me',
        projectName: 'mission',
        latestUserMessage: '用户要求',
        lastAgentMessage: 'Agent 输出',
      }],
      projects: [],
      inbox: [],
    }),
  });
  const address = await listen(server);

  try {
    const response = await fetch(
      `http://${address.address}:${address.port}/api/threads/thread-1/review-content?mode=thread-summary`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.mode, 'thread-summary');
    assert.match(body.content, /线程: Review me/);
    assert.match(body.content, /最近 Agent 输出信号: Agent 输出/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/threads/:id/review-content returns Codex latest-turn mode content', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amc-server-review-turn-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  await fs.writeFile(rolloutPath, [
    JSON.stringify({ payload: { type: 'user_message', message: '请做 P1' } }),
    JSON.stringify({ payload: { type: 'agent_message', message: 'P1 已做', phase: 'final_answer' } }),
  ].join('\n'));
  const server = createServer({
    loadDashboard: async () => ({
      summary: {},
      threads: [{
        id: 'thread-1',
        provider: 'codex',
        providerLabel: 'Codex',
        title: 'Review me',
        rolloutPath,
        lastAgentMessage: 'Agent 输出',
      }],
      projects: [],
      inbox: [],
    }),
  });
  const address = await listen(server);

  try {
    const response = await fetch(
      `http://${address.address}:${address.port}/api/threads/thread-1/review-content?mode=latest-turn`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.mode, 'latest-turn');
    assert.match(body.content, /用户输入:\n请做 P1/);
    assert.match(body.content, /Agent 输出:\nP1 已做/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/reviews creates a review job and saves a succeeded result', async () => {
  const reviewStore = createFakeReviewStore();
  const runnerCalls = [];
  const server = createServer({
    reviewStore,
    loadDashboard: async () => ({
      summary: {},
      threads: [{
        id: 'thread-1',
        provider: 'codex',
        providerLabel: 'Codex',
        title: 'Build review workflow',
        cwd: '/repo',
        model: 'gpt-5.5',
        lastAgentMessage: 'Agent output ready for review',
      }],
      projects: [],
      inbox: [],
    }),
    loadReviewTargets: async () => ({
      items: [{ provider: 'claude-code-cli', label: 'Claude Code CLI', runner: 'claude-print', available: true }],
    }),
    runReview: async (payload) => {
      runnerCalls.push(payload);
      return {
        ok: true,
        resultText: 'Review succeeded',
        resultPreview: 'Review succeeded',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncatedResult: false,
      };
    },
  });
  const address = await listen(server);

  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceThreadId: 'thread-1',
        targetProvider: 'claude-code-cli',
        targetModel: 'sonnet',
        templateId: 'technical-review',
        inputMode: 'latest-agent-signal',
      }),
    });
    const body = await response.json();
    await nextTick();
    const saved = await reviewStore.getJob(body.job.id);

    assert.equal(response.status, 202);
    assert.equal(body.job.status, 'running');
    assert.equal(saved.status, 'succeeded');
    assert.equal(saved.resultText, 'Review succeeded');
    assert.equal(saved.source.threadId, 'thread-1');
    assert.equal(saved.target.provider, 'claude-code-cli');
    assert.equal(runnerCalls[0].provider, 'claude-code-cli');
    assert.equal(runnerCalls[0].model, 'sonnet');
    assert.equal(runnerCalls[0].cwd, '/repo');
    assert.match(runnerCalls[0].prompt, /Agent output ready for review/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/reviews can create a review job from latest-turn input mode', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amc-server-review-post-turn-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  await fs.writeFile(rolloutPath, [
    JSON.stringify({ payload: { type: 'user_message', message: '请评审最新一轮' } }),
    JSON.stringify({ payload: { type: 'agent_message', message: '最新一轮结果', phase: 'final_answer' } }),
  ].join('\n'));
  const reviewStore = createFakeReviewStore();
  const runnerCalls = [];
  const server = createServer({
    reviewStore,
    loadDashboard: async () => ({
      summary: {},
      threads: [{
        id: 'thread-1',
        provider: 'codex',
        providerLabel: 'Codex',
        title: 'Build review workflow',
        cwd: '/repo',
        rolloutPath,
        lastAgentMessage: 'Agent output ready for review',
      }],
      projects: [],
      inbox: [],
    }),
    loadReviewTargets: async () => ({
      items: [{ provider: 'claude-code-cli', label: 'Claude Code CLI', runner: 'claude-print', available: true }],
    }),
    runReview: async (payload) => {
      runnerCalls.push(payload);
      return {
        ok: true,
        resultText: 'Review succeeded',
        resultPreview: 'Review succeeded',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncatedResult: false,
      };
    },
  });
  const address = await listen(server);

  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceThreadId: 'thread-1',
        targetProvider: 'claude-code-cli',
        templateId: 'technical-review',
        inputMode: 'latest-turn',
      }),
    });
    const body = await response.json();
    await nextTick();
    const saved = await reviewStore.getJob(body.job.id);

    assert.equal(response.status, 202);
    assert.equal(saved.inputMode, 'latest-turn');
    assert.match(saved.inputPreview, /用户输入/);
    assert.match(runnerCalls[0].prompt, /请评审最新一轮/);
    assert.match(runnerCalls[0].prompt, /最新一轮结果/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/reviews can create a review job from thread-summary input mode', async () => {
  const reviewStore = createFakeReviewStore();
  const runnerCalls = [];
  const server = createServer({
    reviewStore,
    loadDashboard: async () => ({
      summary: {},
      threads: [{
        id: 'thread-1',
        provider: 'codex',
        providerLabel: 'Codex',
        title: 'Build review workflow',
        projectName: 'agent-mission-control',
        cwd: '/repo',
        model: 'gpt-5.5',
        latestUserMessage: '请继续实现 P1',
        lastAgentMessage: 'thread summary agent signal',
      }],
      projects: [],
      inbox: [],
    }),
    loadReviewTargets: async () => ({
      items: [{ provider: 'claude-code-cli', label: 'Claude Code CLI', runner: 'claude-print', available: true }],
    }),
    runReview: async (payload) => {
      runnerCalls.push(payload);
      return {
        ok: true,
        resultText: 'Review succeeded',
        resultPreview: 'Review succeeded',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        truncatedResult: false,
      };
    },
  });
  const address = await listen(server);

  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceThreadId: 'thread-1',
        targetProvider: 'claude-code-cli',
        templateId: 'technical-review',
        inputMode: 'thread-summary',
      }),
    });
    const body = await response.json();
    await nextTick();
    const saved = await reviewStore.getJob(body.job.id);

    assert.equal(response.status, 202);
    assert.equal(saved.inputMode, 'thread-summary');
    assert.match(saved.inputPreview, /Agent Mission Control 线程摘要/);
    assert.match(runnerCalls[0].prompt, /线程: Build review workflow/);
    assert.match(runnerCalls[0].prompt, /最近 Agent 输出信号: thread summary agent signal/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/reviews saves failed runner metadata', async () => {
  const reviewStore = createFakeReviewStore();
  const server = createServer({
    reviewStore,
    loadDashboard: async () => ({
      summary: {},
      threads: [{
        id: 'thread-1',
        providerLabel: 'Codex',
        title: 'Build review workflow',
        cwd: '/repo',
        lastAgentMessage: 'Agent output ready for review',
      }],
      projects: [],
      inbox: [],
    }),
    loadReviewTargets: async () => ({
      items: [{ provider: 'codex-cli', label: 'Codex CLI', runner: 'codex-exec', available: true }],
    }),
    runReview: async () => ({
      ok: false,
      error: 'Review runner exited with code 1',
      resultText: 'partial',
      resultPreview: 'partial',
      stderr: 'bad stderr',
      exitCode: 1,
      timedOut: false,
      truncatedResult: false,
    }),
  });
  const address = await listen(server);

  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceThreadId: 'thread-1',
        targetProvider: 'codex-cli',
        templateId: 'code-review',
        inputMode: 'latest-agent-signal',
      }),
    });
    const body = await response.json();
    await nextTick();
    const saved = await reviewStore.getJob(body.job.id);

    assert.equal(response.status, 202);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.error, 'Review runner exited with code 1');
    assert.equal(saved.stderr, 'bad stderr');
    assert.equal(saved.exitCode, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/reviews and GET /api/reviews/:id return stored jobs', async () => {
  const reviewStore = createFakeReviewStore();
  const job = await reviewStore.createJob({
    source: { threadId: 'thread-1' },
    target: { provider: 'claude-code-cli' },
    templateId: 'technical-review',
    inputMode: 'latest-agent-signal',
    inputPreview: 'preview',
  });
  await reviewStore.updateJob(job.id, { status: 'succeeded', resultText: 'done' });

  const server = createServer({ reviewStore });
  const address = await listen(server);

  try {
    const base = `http://${address.address}:${address.port}`;
    const listResponse = await fetch(`${base}/api/reviews?threadId=thread-1`);
    const listBody = await listResponse.json();
    const detailResponse = await fetch(`${base}/api/reviews/${job.id}`);
    const detailBody = await detailResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listBody.items.length, 1);
    assert.equal(listBody.summary.total, 1);
    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.job.id, job.id);
    assert.equal(detailBody.job.status, 'succeeded');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
