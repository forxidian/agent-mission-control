import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTokenBreakdowns,
  normalizeTokenBreakdown,
  tokenBreakdownWithTotal,
} from '../src/token-usage.mjs';

test('normalizes Codex usage into additive token categories', () => {
  const breakdown = normalizeTokenBreakdown({
    input_tokens: 100,
    cached_input_tokens: 40,
    output_tokens: 12,
    reasoning_output_tokens: 3,
    total_tokens: 112,
  });

  assert.deepEqual(breakdown, {
    total: 112,
    input: 60,
    cacheRead: 40,
    cacheWrite: 0,
    output: 9,
    reasoning: 3,
    uncategorized: 0,
  });
});

test('normalizes Claude usage with cache creation and cache reads', () => {
  const breakdown = normalizeTokenBreakdown({
    input_tokens: 100,
    cache_creation_input_tokens: 50,
    cache_read_input_tokens: 200,
    output_tokens: 25,
  });

  assert.deepEqual(breakdown, {
    total: 375,
    input: 100,
    cacheRead: 200,
    cacheWrite: 50,
    output: 25,
    reasoning: 0,
    uncategorized: 0,
  });
});

test('keeps total-only usage as uncategorized tokens', () => {
  assert.deepEqual(tokenBreakdownWithTotal(500), {
    total: 500,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    uncategorized: 500,
  });
});

test('adds token breakdowns without mutating inputs', () => {
  const first = normalizeTokenBreakdown({ input_tokens: 10, output_tokens: 3 });
  const second = normalizeTokenBreakdown({ input_tokens: 4, cached_input_tokens: 1, output_tokens: 2 });

  assert.deepEqual(addTokenBreakdowns(first, second), {
    total: 19,
    input: 13,
    cacheRead: 1,
    cacheWrite: 0,
    output: 5,
    reasoning: 0,
    uncategorized: 0,
  });
  assert.equal(first.total, 13);
  assert.equal(second.total, 6);
});
