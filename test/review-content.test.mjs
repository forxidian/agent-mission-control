import test from 'node:test';
import assert from 'node:assert/strict';
import { getReviewContentForThread } from '../src/review-content.mjs';

test('latest-agent-signal mode uses thread lastAgentMessage', () => {
  const result = getReviewContentForThread({
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

test('latest-agent-signal mode rejects empty agent signal without summary fallback', () => {
  assert.throws(
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

test('returns preview and truncation metadata for long agent signal', () => {
  const content = 'a'.repeat(900);
  const result = getReviewContentForThread({
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

test('missing thread throws a not-found style error', () => {
  assert.throws(
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
