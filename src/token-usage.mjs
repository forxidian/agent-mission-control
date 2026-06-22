export const TOKEN_BREAKDOWN_KEYS = [
  'input',
  'cacheRead',
  'cacheWrite',
  'output',
  'reasoning',
  'uncategorized',
];

export function emptyTokenBreakdown() {
  return {
    total: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    uncategorized: 0,
  };
}

function coerceToken(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number);
}

function tokenField(usage, names) {
  for (const name of names) {
    const value = coerceToken(usage?.[name]);
    if (value > 0) return value;
  }
  return 0;
}

function directTotal(usage) {
  return tokenField(usage, ['total_tokens', 'totalTokens', 'total']);
}

export function addTokenBreakdowns(...breakdowns) {
  const result = emptyTokenBreakdown();
  for (const breakdown of breakdowns) {
    if (!breakdown || typeof breakdown !== 'object') continue;
    result.total += coerceToken(breakdown.total);
    for (const key of TOKEN_BREAKDOWN_KEYS) {
      result[key] += coerceToken(breakdown[key]);
    }
  }
  return result;
}

export function tokenBreakdownWithTotal(total) {
  const value = coerceToken(total);
  return {
    ...emptyTokenBreakdown(),
    total: value,
    uncategorized: value,
  };
}

export function tokenBreakdownWithFallbackTotal(breakdown, total) {
  const normalized = addTokenBreakdowns(breakdown);
  const value = coerceToken(total);
  if (value <= 0) return normalized;
  if (normalized.total <= 0) return tokenBreakdownWithTotal(value);
  if (value > normalized.total) {
    normalized.uncategorized += value - normalized.total;
    normalized.total = value;
  }
  return normalized;
}

export function normalizeTokenBreakdown(usage) {
  if (!usage || typeof usage !== 'object') return emptyTokenBreakdown();

  const input = tokenField(usage, ['input_tokens', 'inputTokens', 'input']);
  const cachedInputSubset = tokenField(usage, ['cached_input_tokens', 'cachedInputTokens']);
  const cacheReadAdditive = tokenField(usage, ['cache_read_input_tokens', 'cacheReadInputTokens']);
  const cacheGeneric = tokenField(usage, ['cache_tokens', 'cacheTokens', 'cache']);
  const cacheWrite = tokenField(usage, ['cache_creation_input_tokens', 'cacheCreationInputTokens']);
  const output = tokenField(usage, ['output_tokens', 'outputTokens', 'output']);
  const reasoningOutputSubset = tokenField(usage, ['reasoning_output_tokens', 'reasoningOutputTokens']);
  const reasoningAdditive = tokenField(usage, ['reasoning_tokens', 'reasoningTokens', 'reasoning']);

  const breakdown = emptyTokenBreakdown();
  breakdown.input = Math.max(0, input - cachedInputSubset);
  breakdown.cacheRead = cachedInputSubset + cacheReadAdditive + cacheGeneric;
  breakdown.cacheWrite = cacheWrite;
  breakdown.output = Math.max(0, output - reasoningOutputSubset);
  breakdown.reasoning = reasoningOutputSubset + reasoningAdditive;

  const knownTotal = TOKEN_BREAKDOWN_KEYS
    .filter((key) => key !== 'uncategorized')
    .reduce((sum, key) => sum + breakdown[key], 0);
  const total = directTotal(usage) || knownTotal;
  breakdown.total = total;
  breakdown.uncategorized = Math.max(0, total - knownTotal);
  return breakdown;
}
