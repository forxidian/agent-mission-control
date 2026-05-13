import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildDashboard, enrichThreads } from './insights.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_CODEX_DIR = path.join(os.homedir(), '.codex');
const DEFAULT_STATE_DB = path.join(DEFAULT_CODEX_DIR, 'state_5.sqlite');
const DEFAULT_SESSION_INDEX = path.join(DEFAULT_CODEX_DIR, 'session_index.jsonl');
const DEFAULT_INITIAL_ROLLOUT_BYTES = 512 * 1024;
const DEFAULT_MAX_ROLLOUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_ROLLOUT_SIGNAL_CACHE_LIMIT = 256;
const COMPLETION_HINT = /(\bdone\b|\bcompleted?\b|ready for review|handoff|完成|已完成|验收|交付|交接|可以看|可以试)/i;
const VERBOSE_TITLE_LENGTH = 96;
const DISPLAY_TITLE_LENGTH = 140;
const LOW_SIGNAL_USER_MESSAGE = /^(继续|继续吧|你继续|你继续吧|好的|好的好的|可以|可以的|行|ok|okay|收到|嗯|嗯嗯|先这样)$/iu;
const rolloutSignalCache = new Map();
const codexCacheMetrics = {
  rolloutSignalHits: 0,
  rolloutSignalMisses: 0,
  rolloutSignalWrites: 0,
  rolloutSignalEvictions: 0,
};

function safeLimit(limit) {
  const number = Number.parseInt(limit, 10);
  if (!Number.isFinite(number)) return 180;
  return Math.min(Math.max(number, 1), 500);
}

async function querySqliteJson(databasePath, sql) {
  const { stdout } = await execFileAsync('sqlite3', ['-json', databasePath, sql], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

async function commandVersion(command, args, runCommand = execFileAsync) {
  const { stdout, stderr } = await runCommand(command, args, { timeout: 5000 });
  return String(stdout || stderr || '').trim();
}

export async function loadCodexCliProvider({
  runCommand = execFileAsync,
  threadCount = 0,
} = {}) {
  const version = await commandVersion('codex', ['--version'], runCommand).catch(() => '');

  return {
    id: 'codex-cli',
    label: 'Codex CLI',
    installed: Boolean(version),
    cliInstalled: Boolean(version),
    status: version ? 'ready' : 'missing',
    message: version
      ? `已检测到 ${version}${threadCount ? `，读取 ${threadCount} 个 CLI 任务` : '；任务由 Codex 本地库统一读取'}`
      : '未检测到 codex CLI',
    threadCount,
  };
}

export function parseSessionIndex(jsonlText = '') {
  const titleByThreadId = new Map();

  for (const line of String(jsonlText).split('\n')) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);
      if (record?.id && typeof record.thread_name === 'string' && record.thread_name.trim()) {
        titleByThreadId.set(String(record.id), record.thread_name.trim());
      }
    } catch {
      // Ignore partial/corrupt lines; the sqlite title remains a fallback.
    }
  }

  return titleByThreadId;
}

async function readSessionIndex(sessionIndexPath = DEFAULT_SESSION_INDEX) {
  try {
    return parseSessionIndex(await fs.readFile(sessionIndexPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
}

function applySessionIndexTitles(rows, titleByThreadId) {
  return rows.map((row) => ({
    ...row,
    thread_name: titleByThreadId.get(String(row.id || '')) || row.thread_name,
  }));
}

export async function readThreads({ databasePath = DEFAULT_STATE_DB, limit = 180 } = {}) {
  const cappedLimit = safeLimit(limit);
  const sql = `
    select
      id,
      rollout_path,
      created_at,
      updated_at,
      created_at_ms,
      updated_at_ms,
      source,
      model_provider,
      cwd,
      title,
      sandbox_policy,
      approval_mode,
      tokens_used,
      archived,
      git_sha,
      git_branch,
      git_origin_url,
      cli_version,
      first_user_message,
      agent_nickname,
      agent_role,
      memory_mode,
      model,
      reasoning_effort
    from threads
    order by updated_at_ms desc, updated_at desc
    limit ${cappedLimit};
  `;

  return querySqliteJson(databasePath, sql);
}

function payloadText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((item) => (typeof item === 'string' ? item : item?.text || ''))
      .join('\n');
  }
  return '';
}

function compactInlineText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function truncateText(value = '', maxLength = DISPLAY_TITLE_LENGTH) {
  const text = compactInlineText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isMeaningfulUserMessage(value = '') {
  const text = compactInlineText(value);
  if (text.length < 8) return false;
  return !LOW_SIGNAL_USER_MESSAGE.test(text);
}

function isVerboseStoredTitle(value = '') {
  const text = compactInlineText(value);
  return !text || text.length > VERBOSE_TITLE_LENGTH || String(value).includes('\n');
}

export function deriveCodexThreadTitle(storedTitle, signals = {}) {
  const title = compactInlineText(storedTitle);
  if (!isVerboseStoredTitle(storedTitle)) return title;

  const rolloutTitle = signals.latestMeaningfulUserMessage
    || signals.latestUserMessage
    || signals.firstUserMessage;
  return truncateText(rolloutTitle || title || '未命名任务');
}

function eventTimestampMs(event) {
  const timestamp = Date.parse(event?.timestamp || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRateLimitWindow(window) {
  if (!window || typeof window !== 'object') return null;

  const usedPercent = finiteNumberOrNull(
    window.used_percent
    ?? window.usedPercent
    ?? window.used_percentage,
  );
  if (usedPercent === null) return null;

  return {
    ...window,
    used_percent: usedPercent,
  };
}

function normalizeRateLimits(rateLimits) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;

  const primary = normalizeRateLimitWindow(rateLimits.primary);
  const secondary = normalizeRateLimitWindow(rateLimits.secondary);
  if (!primary && !secondary) return null;

  const normalized = { ...rateLimits };
  if (primary) {
    normalized.primary = primary;
  } else {
    delete normalized.primary;
  }

  if (secondary) {
    normalized.secondary = secondary;
  } else {
    delete normalized.secondary;
  }

  return normalized;
}

function rememberBounded(cache, key, value, limit, metrics = null, writeKey = '', evictionKey = '') {
  if (!cache || limit <= 0) return;
  if (metrics && writeKey) metrics[writeKey] = coerceMetric(metrics[writeKey]) + 1;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
    if (metrics && evictionKey) metrics[evictionKey] = coerceMetric(metrics[evictionKey]) + 1;
  }
}

function statSignature(stat) {
  return {
    size: Number(stat?.size || 0),
    mtimeMs: Number(stat?.mtimeMs || 0),
  };
}

function coerceMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getCodexCacheStats() {
  return {
    rolloutSignals: {
      entries: rolloutSignalCache.size,
      limit: DEFAULT_ROLLOUT_SIGNAL_CACHE_LIMIT,
      hits: codexCacheMetrics.rolloutSignalHits,
      misses: codexCacheMetrics.rolloutSignalMisses,
      writes: codexCacheMetrics.rolloutSignalWrites,
      evictions: codexCacheMetrics.rolloutSignalEvictions,
    },
  };
}

export function parseRolloutSignals(jsonlText, { todayStartMs = 0 } = {}) {
  const todayStart = Number(todayStartMs || 0);
  const seenTodayTokenEvents = new Set();
  const signals = {
    totalTokenUsage: null,
    lastTokenUsage: null,
    modelContextWindow: null,
    rateLimits: null,
    latestRateLimitAtMs: null,
    latestRateLimitSignalAtMs: null,
    rateLimitStale: false,
    rateLimitStaleAtMs: null,
    todayTokenUsage: 0,
    completionHint: false,
    latestAgentFinalAtMs: null,
    latestUserMessageAtMs: null,
    latestMessageKind: '',
    firstUserMessage: '',
    latestUserMessage: '',
    latestMeaningfulUserMessage: '',
    lastAgentMessage: '',
    oldestEventAtMs: null,
    latestEventAtMs: null,
  };

  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = event.payload || event;
    const timestampMs = eventTimestampMs(event);
    if (timestampMs) {
      signals.oldestEventAtMs = signals.oldestEventAtMs
        ? Math.min(signals.oldestEventAtMs, timestampMs)
        : timestampMs;
      signals.latestEventAtMs = Math.max(signals.latestEventAtMs || 0, timestampMs);
    }

    if (payload?.type === 'token_count') {
      signals.totalTokenUsage = payload.info?.total_token_usage || null;
      signals.lastTokenUsage = payload.info?.last_token_usage || null;
      signals.modelContextWindow = payload.info?.model_context_window || null;

      if (Object.prototype.hasOwnProperty.call(payload, 'rate_limits')) {
        const signalAtMs = timestampMs || signals.latestRateLimitSignalAtMs;
        signals.latestRateLimitSignalAtMs = signalAtMs;

        const rateLimits = normalizeRateLimits(payload.rate_limits);
        if (rateLimits) {
          signals.rateLimits = rateLimits;
          signals.latestRateLimitAtMs = timestampMs || signals.latestRateLimitAtMs;
          signals.rateLimitStale = false;
          signals.rateLimitStaleAtMs = null;
        } else {
          signals.rateLimitStale = true;
          signals.rateLimitStaleAtMs = signalAtMs || signals.rateLimitStaleAtMs;
        }
      }

      const todayTokens = Number(payload.info?.last_token_usage?.total_tokens || 0);
      const totalTokens = Number(payload.info?.total_token_usage?.total_tokens || 0);
      if (todayStart && timestampMs >= todayStart && todayTokens > 0) {
        const eventKey = `${totalTokens}:${todayTokens}`;
        if (!seenTodayTokenEvents.has(eventKey)) {
          seenTodayTokenEvents.add(eventKey);
          signals.todayTokenUsage += todayTokens;
        }
      }
      continue;
    }

    if (payload?.type === 'agent_message') {
      const text = payloadText(payload);
      if (text) signals.lastAgentMessage = text.slice(0, 500);
      if (payload.phase === 'final_answer' || COMPLETION_HINT.test(text)) {
        signals.completionHint = true;
      }
      if (payload.phase === 'final_answer') {
        signals.latestAgentFinalAtMs = timestampMs || signals.latestAgentFinalAtMs;
        signals.latestMessageKind = 'agent';
      } else if (text) {
        signals.latestMessageKind = 'agent';
      }
      continue;
    }

    if (payload?.type === 'user_message') {
      const text = payloadText(payload);
      if (text) {
        const compactText = truncateText(text, 500);
        signals.firstUserMessage ||= compactText;
        signals.latestUserMessage = compactText;
        if (isMeaningfulUserMessage(text)) {
          signals.latestMeaningfulUserMessage = compactText;
        }
      }
      signals.latestUserMessageAtMs = timestampMs || signals.latestUserMessageAtMs;
      signals.latestMessageKind = 'user';
    }
  }

  return signals;
}

async function readTail(filePath, maxBytes = DEFAULT_MAX_ROLLOUT_BYTES, fileStat = null) {
  const stat = fileStat || await fs.stat(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return { text, start, size: stat.size };

    const firstNewline = text.indexOf('\n');
    return {
      text: firstNewline >= 0 ? text.slice(firstNewline + 1) : text,
      start,
      size: stat.size,
    };
  } finally {
    await handle.close();
  }
}

function hasTurnBoundary(signals) {
  return Boolean(signals.latestUserMessageAtMs || signals.latestAgentFinalAtMs);
}

function coversToday(signals, tail, todayStartMs) {
  if (!todayStartMs) return true;
  if (tail.start === 0) return true;
  return Boolean(signals.oldestEventAtMs && signals.oldestEventAtMs <= todayStartMs);
}

function needsMoreRateLimitHistory(signals, bytesToRead, fileSize, maxBytes) {
  return Boolean(
    signals.rateLimitStale
    && !signals.rateLimits
    && bytesToRead < fileSize
    && bytesToRead < maxBytes,
  );
}

export async function readRolloutSignals(
  rolloutPath,
  {
    initialBytes = DEFAULT_INITIAL_ROLLOUT_BYTES,
    maxBytes = DEFAULT_MAX_ROLLOUT_BYTES,
    todayStartMs = 0,
    signalCache = rolloutSignalCache,
    signalCacheLimit = DEFAULT_ROLLOUT_SIGNAL_CACHE_LIMIT,
  } = {},
) {
  if (!rolloutPath) return parseRolloutSignals('');

  try {
    const stat = await fs.stat(rolloutPath);
    const { size, mtimeMs } = statSignature(stat);
    const cacheKey = `${rolloutPath}\0${todayStartMs}\0${initialBytes}\0${maxBytes}`;
    const cached = signalCache?.get(cacheKey);
    if (
      cached
      && cached.size === size
      && cached.mtimeMs === mtimeMs
    ) {
      codexCacheMetrics.rolloutSignalHits += 1;
      return cached.signals;
    }
    codexCacheMetrics.rolloutSignalMisses += 1;

    let bytesToRead = Math.min(Math.max(1, initialBytes), stat.size);
    let signals = parseRolloutSignals('');

    while (bytesToRead > 0) {
      const tail = await readTail(rolloutPath, bytesToRead, stat);
      signals = parseRolloutSignals(tail.text, { todayStartMs });
      const needsQuotaHistory = needsMoreRateLimitHistory(signals, bytesToRead, stat.size, maxBytes);
      if (
        (hasTurnBoundary(signals) && coversToday(signals, tail, todayStartMs) && !needsQuotaHistory)
        || bytesToRead >= stat.size
        || bytesToRead >= maxBytes
      ) {
        rememberBounded(
          signalCache,
          cacheKey,
          { size, mtimeMs, signals },
          signalCacheLimit,
          codexCacheMetrics,
          'rolloutSignalWrites',
          'rolloutSignalEvictions',
        );
        return signals;
      }

      const nextBytes = Math.min(bytesToRead * 2, maxBytes, stat.size);
      if (nextBytes === bytesToRead) {
        rememberBounded(
          signalCache,
          cacheKey,
          { size, mtimeMs, signals },
          signalCacheLimit,
          codexCacheMetrics,
          'rolloutSignalWrites',
          'rolloutSignalEvictions',
        );
        return signals;
      }
      bytesToRead = nextBytes;
    }

    rememberBounded(
      signalCache,
      cacheKey,
      { size, mtimeMs, signals },
      signalCacheLimit,
      codexCacheMetrics,
      'rolloutSignalWrites',
      'rolloutSignalEvictions',
    );
    return signals;
  } catch {
    return parseRolloutSignals('');
  }
}

async function attachRolloutSignals(threads, {
  maxRollouts = 48,
  initialRolloutBytes = DEFAULT_INITIAL_ROLLOUT_BYTES,
  maxRolloutBytes = DEFAULT_MAX_ROLLOUT_BYTES,
  todayStartMs = 0,
} = {}) {
  const enriched = threads.map((thread) => ({ ...thread }));
  const candidates = enriched
    .filter((thread) => thread.rolloutPath)
    .slice(0, maxRollouts);

  const results = await Promise.allSettled(
    candidates.map((thread) => readRolloutSignals(thread.rolloutPath, {
      initialBytes: initialRolloutBytes,
      maxBytes: maxRolloutBytes,
      todayStartMs,
    })),
  );

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;

    const thread = candidates[index];
    thread.totalTokenUsage = result.value.totalTokenUsage;
    thread.lastTokenUsage = result.value.lastTokenUsage;
    thread.modelContextWindow = result.value.modelContextWindow;
    thread.rateLimits = result.value.rateLimits;
    thread.rateLimitUpdatedAtMs = result.value.latestRateLimitAtMs;
    thread.rateLimitActivityAtMs = result.value.latestRateLimitAtMs;
    thread.latestRateLimitSignalAtMs = result.value.latestRateLimitSignalAtMs;
    thread.rateLimitStale = result.value.rateLimitStale;
    thread.rateLimitStaleAtMs = result.value.rateLimitStaleAtMs;
    thread.todayTokenUsage = result.value.todayTokenUsage;
    thread.completionHint = result.value.completionHint;
    thread.latestAgentFinalAtMs = result.value.latestAgentFinalAtMs;
    thread.latestUserMessageAtMs = result.value.latestUserMessageAtMs;
    thread.latestMessageKind = result.value.latestMessageKind;
    thread.firstUserMessage = result.value.firstUserMessage;
    thread.latestUserMessage = result.value.latestUserMessage;
    thread.latestMeaningfulUserMessage = result.value.latestMeaningfulUserMessage;
    thread.lastAgentMessage = result.value.lastAgentMessage;
    thread.title = deriveCodexThreadTitle(thread.title, result.value);
  });

  return enriched;
}

export async function loadCodexDashboard(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const rows = await readThreads(options);
  const sessionIndex = await readSessionIndex(options.sessionIndexPath || DEFAULT_SESSION_INDEX);
  const indexedRows = applySessionIndexTitles(rows, sessionIndex);
  const threads = enrichThreads(indexedRows, nowMs);
  const enrichedThreads = await attachRolloutSignals(threads, {
    ...options,
    todayStartMs: options.todayStartMs || todayStart.getTime(),
  });
  return buildDashboard(enrichedThreads, nowMs);
}
