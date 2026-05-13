import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getReviewContentForThread } from '../src/review-content.mjs';

test('latest-agent-signal mode uses thread lastAgentMessage', async () => {
  const result = await getReviewContentForThread({
    thread: {
      id: 'thread-1',
      title: 'Review target',
      lastAgentMessage: 'Agent 完成了实现，并说明了测试结果。',
    },
    mode: 'latest-agent-signal',
  });

  assert.equal(result.threadId, 'thread-1');
  assert.equal(result.mode, 'latest-agent-signal');
  assert.equal(result.content, 'Agent 完成了实现，并说明了测试结果。');
  assert.equal(result.preview, 'Agent 完成了实现，并说明了测试结果。');
  assert.equal(result.truncated, false);
  assert.equal(result.sourceDescription, '最近 Agent 输出信号');
});

test('latest-agent-signal mode rejects empty agent signal without summary fallback', async () => {
  await assert.rejects(
    () => getReviewContentForThread({
      thread: {
        id: 'thread-1',
        title: 'Review target',
        summary: 'This summary must not be used in P0.',
        lastAgentMessage: '   ',
      },
      mode: 'latest-agent-signal',
    }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /暂无可评审的 Agent 输出/);
      return true;
    },
  );
});

test('returns preview and truncation metadata for long agent signal', async () => {
  const content = 'a'.repeat(900);
  const result = await getReviewContentForThread({
    thread: {
      id: 'thread-1',
      lastAgentMessage: content,
    },
    mode: 'latest-agent-signal',
    maxPreviewChars: 32,
  });

  assert.equal(result.content, content);
  assert.equal(result.preview, `${'a'.repeat(32)}...`);
  assert.equal(result.truncated, true);
  assert.equal(result.sourceDescription, '最近 Agent 输出信号');
});

test('missing thread throws a not-found style error', async () => {
  await assert.rejects(
    () => getReviewContentForThread({
      thread: null,
      mode: 'latest-agent-signal',
    }),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.match(error.message, /Thread not found/);
      return true;
    },
  );
});

test('thread-summary mode builds a privacy-scoped summary from standard thread fields', async () => {
  const result = await getReviewContentForThread({
    thread: {
      id: 'thread-1',
      providerLabel: 'Codex',
      title: '实现评审工作流',
      projectName: 'agent-mission-control',
      cwd: '/Users/example/code/agent-mission-control',
      model: 'gpt-5.5',
      status: 'fresh',
      latestUserMessage: '请继续实现 P1',
      lastAgentMessage: '已经完成 P0。',
      todayTokenUsage: 1234,
      tokensUsed: 5678,
    },
    mode: 'thread-summary',
  });

  assert.equal(result.mode, 'thread-summary');
  assert.match(result.content, /Agent Mission Control 线程摘要/);
  assert.match(result.content, /线程: 实现评审工作流/);
  assert.match(result.content, /来源: Codex/);
  assert.match(result.content, /项目: agent-mission-control/);
  assert.match(result.content, /最近用户输入信号: 请继续实现 P1/);
  assert.match(result.content, /最近 Agent 输出信号: 已经完成 P0。/);
  assert.equal(result.sourceDescription, '线程摘要和最近 Agent 输出');
});

test('Codex latest-turn mode reads the latest user to final answer turn from rollout JSONL', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amc-review-turn-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const jsonl = [
    JSON.stringify({ timestamp: '2026-05-12T00:00:00.000Z', payload: { type: 'user_message', message: '第一轮需求' } }),
    JSON.stringify({ timestamp: '2026-05-12T00:01:00.000Z', payload: { type: 'agent_message', message: '第一轮结果', phase: 'final_answer' } }),
    'not json',
    JSON.stringify({ timestamp: '2026-05-12T00:02:00.000Z', payload: { type: 'user_message', text: '第二轮需求' } }),
    JSON.stringify({ timestamp: '2026-05-12T00:03:00.000Z', payload: { type: 'agent_message', text: '我先检查。', phase: 'commentary' } }),
    JSON.stringify({ timestamp: '2026-05-12T00:04:00.000Z', payload: { type: 'agent_message', text: '第二轮最终结果', phase: 'final_answer' } }),
  ].join('\n');
  await fs.writeFile(rolloutPath, jsonl);

  const result = await getReviewContentForThread({
    thread: {
      id: 'thread-1',
      provider: 'codex',
      providerLabel: 'Codex',
      title: 'Codex thread',
      rolloutPath,
    },
    mode: 'latest-turn',
  });

  assert.equal(result.mode, 'latest-turn');
  assert.equal(result.sourceDescription, '最近一轮用户输入到 Agent 最终输出');
  assert.doesNotMatch(result.content, /第一轮/);
  assert.match(result.content, /用户输入:\n第二轮需求/);
  assert.match(result.content, /Agent 输出:\n我先检查。\n\n第二轮最终结果/);
  assert.equal(result.truncated, false);
});

test('Codex latest-turn mode truncates long turn content with preview metadata', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amc-review-turn-truncate-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  await fs.writeFile(rolloutPath, [
    JSON.stringify({ payload: { type: 'user_message', message: '请评审长输出' } }),
    JSON.stringify({ payload: { type: 'agent_message', message: 'x'.repeat(200), phase: 'final_answer' } }),
  ].join('\n'));

  const result = await getReviewContentForThread({
    thread: {
      id: 'thread-1',
      provider: 'codex',
      rolloutPath,
    },
    mode: 'latest-turn',
    maxContentChars: 64,
    maxPreviewChars: 32,
  });

  assert.equal(result.content.length, 67);
  assert.equal(result.content.endsWith('...'), true);
  assert.equal(result.preview.length, 35);
  assert.equal(result.preview.endsWith('...'), true);
  assert.equal(result.truncated, true);
});

test('Codex latest-turn mode expands rollout reads when long final output hides the user message', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amc-review-turn-expand-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const longFinal = '最终输出 '.repeat(90_000);
  await fs.writeFile(rolloutPath, [
    JSON.stringify({ payload: { type: 'user_message', message: '请评审这轮被长输出挤出的用户输入' } }),
    JSON.stringify({ payload: { type: 'agent_message', message: longFinal, phase: 'final_answer' } }),
  ].join('\n'));

  const result = await getReviewContentForThread({
    thread: {
      id: 'thread-1',
      provider: 'codex',
      rolloutPath,
    },
    mode: 'latest-turn',
  });

  assert.match(result.content, /用户输入:\n请评审这轮被长输出挤出的用户输入/);
  assert.match(result.content, /Agent 输出:\n最终输出/);
  assert.equal(result.truncated, true);
});

test('latest-turn mode returns 422 for providers without stable transcript support', async () => {
  await assert.rejects(
    () => getReviewContentForThread({
      thread: {
        id: 'thread-1',
        provider: 'opencode',
        providerLabel: 'OpenCode',
        lastAgentMessage: 'Done',
      },
      mode: 'latest-turn',
    }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /latest-turn is not available/);
      return true;
    },
  );

  await assert.rejects(
    () => getReviewContentForThread({
      thread: {
        id: 'thread-2',
        provider: 'claude-code-cli',
        providerLabel: 'Claude Code',
        lastAgentMessage: 'Done',
      },
      mode: 'latest-turn',
    }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /latest-turn is not available/);
      return true;
    },
  );
});

test('Codex latest-turn mode returns 422 when rollout path is missing', async () => {
  await assert.rejects(
    () => getReviewContentForThread({
      thread: {
        id: 'thread-1',
        provider: 'codex',
        providerLabel: 'Codex',
      },
      mode: 'latest-turn',
    }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /rollout path/);
      return true;
    },
  );
});
