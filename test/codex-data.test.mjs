import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deriveCodexThreadTitle,
  parseSessionIndex,
  parseRolloutSignals,
  readRolloutSignals,
} from '../src/codex-data.mjs';

test('parses latest token-count and rate-limit signals from rollout jsonl', () => {
  const jsonl = [
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 12,
            reasoning_output_tokens: 3,
            total_tokens: 112,
          },
          model_context_window: 258400,
        },
        rate_limits: {
          limit_id: 'codex',
          primary: {
            used_percent: 6,
            window_minutes: 300,
            resets_at: 1777373828,
          },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'response_item',
      payload: { type: 'agent_message', text: 'Done. Ready for review.', phase: 'final_answer' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.totalTokenUsage.total_tokens, 112);
  assert.equal(signals.totalTokenUsage.cached_input_tokens, 40);
  assert.equal(signals.rateLimits.primary.used_percent, 6);
  assert.equal(signals.completionHint, true);
  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestMessageKind, 'agent');
});

test('sums today token usage from token-count events without duplicate limit rows', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-28T23:59:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1000 },
          last_token_usage: { total_tokens: 100 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1500 },
          last_token_usage: { total_tokens: 500 },
          model_context_window: 258400,
        },
        rate_limits: {
          limit_id: 'codex',
          primary: { used_percent: 10, resets_at: 1777460000 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.001Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 1500 },
          last_token_usage: { total_tokens: 500 },
          model_context_window: 258400,
        },
        rate_limits: {
          limit_id: 'codex_bengalfox',
          primary: { used_percent: 0, resets_at: 1777460000 },
        },
      },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl, {
    todayStartMs: Date.parse('2026-04-29T00:00:00.000Z'),
  });

  assert.equal(signals.todayTokenUsage, 500);
  assert.equal(signals.latestRateLimitAtMs, 1777428000001);
  assert.equal(signals.modelContextWindow, 258400);
});

test('expands the rollout tail until it covers today token events', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-today-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T00:30:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { total_tokens: 700 },
          last_token_usage: { total_tokens: 700 },
        },
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T01:00:00.000Z',
      type: 'response_item',
      payload: { type: 'reasoning', encrypted_content: 'x'.repeat(2048) },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T02:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
  ].join('\n');

  await fs.writeFile(rolloutPath, jsonl);

  const signals = await readRolloutSignals(rolloutPath, {
    initialBytes: 128,
    maxBytes: 8192,
    todayStartMs: Date.parse('2026-04-29T00:00:00.000Z'),
  });

  assert.equal(signals.todayTokenUsage, 700);
  assert.equal(signals.latestAgentFinalAtMs, 1777428000000);
});

test('tracks a later user message after an agent final answer', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:36:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '再改一下' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestUserMessageAtMs, 1777444560000);
  assert.equal(signals.latestMessageKind, 'user');
});

test('tracks meaningful user text for stale long Codex titles', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:30:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: '我一个信得过的朋友给我分享了一个他最近在做的套利的交易系统，然后我也想进行复刻尝试。',
      },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:36:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '继续' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T06:40:00.000Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '但我已经有80份，成本0.9760的底仓' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.firstUserMessage, '我一个信得过的朋友给我分享了一个他最近在做的套利的交易系统，然后我也想进行复刻尝试。');
  assert.equal(signals.latestUserMessage, '但我已经有80份，成本0.9760的底仓');
  assert.equal(signals.latestMeaningfulUserMessage, '但我已经有80份，成本0.9760的底仓');
});

test('uses rollout user context when the stored Codex title is a stale long prompt', () => {
  const longStoredTitle = '我一个信得过的朋友给我分享了一个他最近在做的套利的交易系统，然后我也想进行复刻尝试。'.repeat(3);

  assert.equal(
    deriveCodexThreadTitle(longStoredTitle, {
      latestMeaningfulUserMessage: '回执部分：重复信息不需要每次都发，发一次就行了',
      firstUserMessage: longStoredTitle,
    }),
    '回执部分：重复信息不需要每次都发，发一次就行了',
  );

  assert.equal(
    deriveCodexThreadTitle('管理多 Agent 线程', {
      latestMeaningfulUserMessage: '这个不应该覆盖短标题',
    }),
    '管理多 Agent 线程',
  );
});

test('parses Codex session index titles used by the sidebar', () => {
  const index = parseSessionIndex([
    JSON.stringify({
      id: '019e07e7-192c-7941-b639-8d58d2e86b3a',
      thread_name: '调研 /goal 新命令',
      updated_at: '2026-05-08T14:04:31.849624Z',
    }),
    '{bad json}',
    JSON.stringify({ id: 'empty', thread_name: '' }),
  ].join('\n'));

  assert.equal(index.get('019e07e7-192c-7941-b639-8d58d2e86b3a'), '调研 /goal 新命令');
  assert.equal(index.has('empty'), false);
});

test('keeps a thread in progress when commentary follows the latest user message', () => {
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:00:52.131Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '增加运行状态' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:01:13.213Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '我先看一下。', phase: 'commentary' },
    }),
  ].join('\n');

  const signals = parseRolloutSignals(jsonl);

  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestUserMessageAtMs, 1777446052131);
  assert.equal(signals.latestMessageKind, 'agent');
});

test('ignores malformed rollout jsonl lines', () => {
  const signals = parseRolloutSignals('{bad json}\n{"type":"event_msg","payload":{"type":"message"}}');

  assert.equal(signals.totalTokenUsage, null);
  assert.equal(signals.rateLimits, null);
  assert.equal(signals.completionHint, false);
});

test('expands the rollout tail when bulky output hides the latest user turn', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rollout-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const rolloutPath = path.join(dir, 'rollout.jsonl');
  const jsonl = [
    JSON.stringify({
      timestamp: '2026-04-29T06:35:08.583Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Done.', phase: 'final_answer' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:00:52.131Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: '继续改状态' },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:01:00.000Z',
      type: 'response_item',
      payload: { type: 'reasoning', encrypted_content: 'x'.repeat(2048) },
    }),
    JSON.stringify({
      timestamp: '2026-04-29T07:01:13.213Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: '我先看一下。', phase: 'commentary' },
    }),
  ].join('\n');

  await fs.writeFile(rolloutPath, jsonl);

  const signals = await readRolloutSignals(rolloutPath, {
    initialBytes: 128,
    maxBytes: 8192,
  });

  assert.equal(signals.latestAgentFinalAtMs, 1777444508583);
  assert.equal(signals.latestUserMessageAtMs, 1777446052131);
});
