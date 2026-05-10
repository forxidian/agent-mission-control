import path from 'node:path';
import { isSubagentThread } from './thread-classification.mjs';

const FRESH_WINDOW_MS = 15 * 60 * 1000;
const WARM_WINDOW_MS = 6 * 60 * 60 * 1000;
const HIGH_TOKEN_USAGE = 5_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coerceNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unixValueToMs(value) {
  const number = coerceNumber(value);
  if (number <= 0) return 0;
  return number > 1_000_000_000_000 ? number : number * 1000;
}

function clampPercent(value) {
  return Math.min(Math.max(coerceNumber(value), 0), 100);
}

function quotaWindow(window) {
  if (!window || typeof window !== 'object') return null;

  const usedPercent = clampPercent(window.used_percent);
  return {
    usedPercent,
    availablePercent: Math.max(0, 100 - usedPercent),
    resetsAtMs: unixValueToMs(window.resets_at),
    windowMinutes: coerceNumber(window.window_minutes),
  };
}

function quotaSummary(threads) {
  const latest = threads
    .filter((thread) => thread.rateLimits)
    .sort((a, b) => (
      coerceNumber(b.rateLimitUpdatedAtMs || b.updatedAtMs)
      - coerceNumber(a.rateLimitUpdatedAtMs || a.updatedAtMs)
    ))[0];

  if (!latest) {
    return {
      realtime: null,
      weekly: null,
      observedAtMs: null,
      sourceThreadId: '',
    };
  }

  return {
    realtime: quotaWindow(latest.rateLimits.primary),
    weekly: quotaWindow(latest.rateLimits.secondary),
    observedAtMs: coerceNumber(latest.rateLimitUpdatedAtMs || latest.updatedAtMs) || null,
    sourceThreadId: latest.id || '',
  };
}

function currentTurnStartedAtMs(thread) {
  const userAtMs = coerceNumber(thread.currentTurnStartedAtMs || thread.latestUserMessageAtMs);
  const finalAtMs = coerceNumber(thread.latestAgentFinalAtMs);
  return userAtMs > 0 && userAtMs > finalAtMs ? userAtMs : 0;
}

export function inferThreadStatus(thread, nowMs = Date.now()) {
  if (thread.archived) return 'archived';
  if (currentTurnStartedAtMs(thread) > 0) return 'running';

  const ageMs = Math.max(0, nowMs - coerceNumber(thread.updatedAtMs));
  if (ageMs <= FRESH_WINDOW_MS) return 'fresh';
  if (ageMs <= WARM_WINDOW_MS) return 'warm';
  return 'idle';
}

export function enrichThreadRuntime(thread, nowMs = Date.now()) {
  const startedAtMs = currentTurnStartedAtMs(thread);
  const runtimeThread = {
    ...thread,
    currentTurnStartedAtMs: startedAtMs || null,
    currentTurnElapsedMs: startedAtMs ? Math.max(0, nowMs - startedAtMs) : 0,
  };

  return {
    ...runtimeThread,
    status: inferThreadStatus(runtimeThread, nowMs),
  };
}

export function normalizeThread(row, nowMs = Date.now()) {
  const cwd = row.cwd || '';
  const id = String(row.id || '');
  const archived = Boolean(coerceNumber(row.archived));
  const updatedAtMs = unixValueToMs(row.updated_at_ms ?? row.updated_at);
  const createdAtMs = unixValueToMs(row.created_at_ms ?? row.created_at);
  const projectName = cwd ? path.basename(cwd) : '未知项目';
  const source = String(row.source || '');
  const isCodexCli = ['cli', 'terminal', 'tui'].includes(source.toLowerCase());
  const resumeCommand = `codex resume ${id}`;
  const thread = {
    id,
    externalId: id,
    provider: isCodexCli ? 'codex-cli' : 'codex',
    providerLabel: isCodexCli ? 'Codex CLI' : 'Codex',
    title: row.thread_name || row.title || '未命名线程',
    cwd,
    projectName,
    source,
    model: row.model || row.model_provider || '',
    reasoningEffort: row.reasoning_effort || '',
    tokensUsed: coerceNumber(row.tokens_used),
    hasUnreadTurn: Boolean(coerceNumber(row.has_unread_turn ?? row.hasUnreadTurn ?? row.awaiting_review ?? row.awaitingReview)),
    archived,
    createdAtMs,
    updatedAtMs,
    rolloutPath: row.rollout_path || '',
    gitBranch: row.git_branch || '',
    gitSha: row.git_sha || '',
    gitOriginUrl: row.git_origin_url || '',
    appDeepLink: UUID_RE.test(id) ? `codex://threads/${id}` : '',
    canOpen: UUID_RE.test(id),
    openLabel: isCodexCli ? '打开会话' : '打开线程',
    resumeCommand,
  };

  return {
    ...enrichThreadRuntime(thread, nowMs),
  };
}

export function aggregateProjects(threads) {
  const groups = new Map();

  for (const thread of threads) {
    if (thread.archived) continue;

    const key = thread.cwd || thread.projectName || '未知项目';
    const existing = groups.get(key) || {
      cwd: thread.cwd,
      projectName: thread.projectName || '未知项目',
      threadCount: 0,
      tokensUsed: 0,
      todayTokensUsed: 0,
      latestUpdatedAtMs: 0,
    };

    existing.threadCount += 1;
    existing.tokensUsed += coerceNumber(thread.tokensUsed);
    existing.todayTokensUsed += coerceNumber(thread.todayTokenUsage);
    existing.latestUpdatedAtMs = Math.max(existing.latestUpdatedAtMs, coerceNumber(thread.updatedAtMs));
    groups.set(key, existing);
  }

  return [...groups.values()].sort((a, b) => b.tokensUsed - a.tokensUsed);
}

function attentionReason(thread) {
  if (thread.archived) return '';
  if (isSubagentThread(thread)) return '';
  if (
    thread.awaitingPermission
    || coerceNumber(thread.openCodePendingToolCount) > 0
    || coerceNumber(thread.pendingToolCount) > 0
  ) return 'awaiting permission';
  if (thread.status === 'running') return 'running';
  if (thread.status === 'fresh') return 'recent activity';
  if (thread.tokensUsed >= HIGH_TOKEN_USAGE) return 'high token usage';
  if (thread.hasUnreadTurn || thread.awaitingReview) return 'awaiting review';
  return '';
}

export function buildDashboard(threads, nowMs = Date.now()) {
  const sortedThreads = threads
    .map((thread) => enrichThreadRuntime(thread, nowMs))
    .sort((a, b) => coerceNumber(b.updatedAtMs) - coerceNumber(a.updatedAtMs));
  const activeThreads = sortedThreads.filter((thread) => !thread.archived);
  const archivedThreads = sortedThreads.length - activeThreads.length;
  const runningThreads = activeThreads.filter((thread) => thread.status === 'running').length;
  const totalTokensUsed = sortedThreads.reduce((sum, thread) => sum + coerceNumber(thread.tokensUsed), 0);
  const activeTokensUsed = activeThreads.reduce((sum, thread) => sum + coerceNumber(thread.tokensUsed), 0);
  const todayTokensUsed = activeThreads.reduce((sum, thread) => sum + coerceNumber(thread.todayTokenUsage), 0);
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);

  const inbox = sortedThreads
    .map((thread) => ({ ...thread, reason: attentionReason(thread) }))
    .filter((thread) => thread.reason)
    .slice(0, 12);

  return {
    generatedAtMs: nowMs,
    summary: {
      totalThreads: sortedThreads.length,
      activeThreads: activeThreads.length,
      runningThreads,
      archivedThreads,
      totalTokensUsed,
      activeTokensUsed,
      todayTokensUsed,
      updatedToday: activeThreads.filter((thread) => thread.updatedAtMs >= todayStart.getTime()).length,
      inboxCount: inbox.length,
      quota: quotaSummary(activeThreads),
    },
    inbox,
    projects: aggregateProjects(sortedThreads).slice(0, 24),
    threads: sortedThreads,
  };
}

export function enrichThreads(rows, nowMs = Date.now()) {
  return rows.map((row) => normalizeThread(row, nowMs));
}
