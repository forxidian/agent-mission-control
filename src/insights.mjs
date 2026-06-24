import path from 'node:path';
import { isAutomationThread, isSubagentThread, subagentInfo } from './thread-classification.mjs';
import {
  addTokenBreakdowns,
  tokenBreakdownWithFallbackTotal,
} from './token-usage.mjs';

const FRESH_WINDOW_MS = 15 * 60 * 1000;
const WARM_WINDOW_MS = 6 * 60 * 60 * 1000;
const RUNNING_ACTIVITY_WINDOW_MS = WARM_WINDOW_MS;
const HIGH_TOKEN_USAGE = 5_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coerceNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function coerceBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  }
  return Boolean(coerceNumber(value));
}

function unixValueToMs(value) {
  const number = coerceNumber(value);
  if (number <= 0) return 0;
  return number > 1_000_000_000_000 ? number : number * 1000;
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(number, 0), 100);
}

function quotaWindow(window) {
  if (!window || typeof window !== 'object') return null;

  const usedPercent = clampPercent(
    window.used_percent
    ?? window.usedPercent
    ?? window.used_percentage,
  );
  if (usedPercent === null) return null;

  return {
    usedPercent,
    availablePercent: Math.max(0, 100 - usedPercent),
    resetsAtMs: unixValueToMs(window.resets_at),
    windowMinutes: coerceNumber(window.window_minutes),
  };
}

const QUOTA_FAMILY_ORDER = ['gpt', 'claude', 'gemini', 'grok', 'deepseek', 'qwen', 'llama'];

function compactModelLabel(value = '') {
  return String(value).trim().replace(/\s+/g, ' ');
}

function quotaFamily(thread) {
  const model = compactModelLabel(thread.model);
  const providerText = compactModelLabel([
    thread.provider,
    thread.providerLabel,
    thread.source,
  ].filter(Boolean).join(' '));
  const searchText = `${providerText} ${model}`.toLowerCase();

  if (searchText.includes('gpt') || searchText.includes('openai') || searchText.includes('codex')) {
    return { key: 'gpt', label: 'GPT' };
  }
  if (searchText.includes('claude') || searchText.includes('anthropic') || /(^|[^a-z])(sonnet|opus|haiku)([^a-z]|$)/.test(searchText)) {
    return { key: 'claude', label: 'Claude' };
  }
  if (searchText.includes('gemini') || searchText.includes('google')) {
    return { key: 'gemini', label: 'Gemini' };
  }
  if (searchText.includes('grok') || searchText.includes('xai')) {
    return { key: 'grok', label: 'Grok' };
  }
  if (searchText.includes('deepseek')) {
    return { key: 'deepseek', label: 'DeepSeek' };
  }
  if (searchText.includes('qwen')) {
    return { key: 'qwen', label: 'Qwen' };
  }
  if (searchText.includes('llama') || searchText.includes('meta')) {
    return { key: 'llama', label: 'Llama' };
  }

  const label = compactModelLabel(model.split('/').pop() || providerText || '未知模型');
  return {
    key: label ? `model:${label.toLowerCase()}` : 'unknown',
    label: label || '未知模型',
  };
}

function quotaFamilyRank(group) {
  const index = QUOTA_FAMILY_ORDER.indexOf(group.key);
  return index >= 0 ? index : QUOTA_FAMILY_ORDER.length;
}

function quotaObservedAtMs(thread) {
  return coerceNumber(thread.rateLimitUpdatedAtMs || thread.updatedAtMs);
}

function quotaSourcePriority(thread) {
  const family = quotaFamily(thread);
  const limitId = String(thread.rateLimits?.limit_id || '').trim().toLowerCase();

  if (family.key === 'gpt' && limitId.startsWith('codex')) {
    return limitId === 'codex' ? 3 : 1;
  }

  return 2;
}

function compareQuotaCandidates(candidate, current) {
  const priorityDelta = quotaSourcePriority(candidate.thread) - quotaSourcePriority(current.thread);
  if (priorityDelta) return priorityDelta;

  return coerceNumber(candidate.group.observedAtMs) - coerceNumber(current.group.observedAtMs);
}

function quotaGroup(thread) {
  const family = quotaFamily(thread);
  const observedAtMs = quotaObservedAtMs(thread) || null;
  const realtime = quotaWindow(thread.rateLimits?.primary);
  const weekly = quotaWindow(thread.rateLimits?.secondary);
  if (!realtime && !weekly) return null;

  return {
    ...family,
    realtime,
    weekly,
    observedAtMs,
    sourceThreadId: thread.id || '',
    model: compactModelLabel(thread.model),
    provider: thread.provider || '',
    providerLabel: thread.providerLabel || '',
    stale: Boolean(thread.rateLimitStale),
    staleAtMs: coerceNumber(thread.rateLimitStaleAtMs) || null,
  };
}

function activeQuotaFamily(thread) {
  const family = quotaFamily(thread);
  return {
    ...family,
    realtime: null,
    weekly: null,
    observedAtMs: null,
    sourceThreadId: thread.id || '',
    model: compactModelLabel(thread.model),
    provider: thread.provider || '',
    providerLabel: thread.providerLabel || '',
  };
}

function quotaGroups(threads) {
  const latestByFamily = new Map();
  const quotaThreads = threads.filter((thread) => thread.rateLimits);

  for (const thread of quotaThreads) {
    const group = quotaGroup(thread);
    if (!group) continue;

    const candidate = { thread, group };
    const current = latestByFamily.get(group.key);
    if (!current || compareQuotaCandidates(candidate, current) > 0) {
      latestByFamily.set(group.key, candidate);
    }
  }

  const runningThreads = threads
    .filter((thread) => thread.status === 'running')
    .sort((a, b) => coerceNumber(b.updatedAtMs) - coerceNumber(a.updatedAtMs));

  for (const thread of runningThreads) {
    const group = activeQuotaFamily(thread);
    if (!latestByFamily.has(group.key)) latestByFamily.set(group.key, { thread, group });
  }

  return [...latestByFamily.values()].map((candidate) => candidate.group).sort((a, b) => (
    quotaFamilyRank(a) - quotaFamilyRank(b)
    || coerceNumber(b.observedAtMs) - coerceNumber(a.observedAtMs)
  ));
}

function quotaSummary(threads) {
  const groups = quotaGroups(threads);
  const latest = groups
    .filter((group) => group.realtime || group.weekly)
    .sort((a, b) => (
      coerceNumber(b.observedAtMs) - coerceNumber(a.observedAtMs)
    ))[0];

  if (!latest) {
    return {
      realtime: null,
      weekly: null,
      observedAtMs: null,
      sourceThreadId: '',
      groups,
    };
  }

  return {
    realtime: latest.realtime,
    weekly: latest.weekly,
    observedAtMs: latest.observedAtMs,
    sourceThreadId: latest.sourceThreadId || '',
    stale: latest.stale,
    staleAtMs: latest.staleAtMs,
    groups,
  };
}

function currentTurnStartedAtMs(thread) {
  if (thread.agentRunning || thread.isAgentRunning) {
    return coerceNumber(
      thread.currentTurnStartedAtMs
      || thread.agentStartedAtMs
      || thread.latestUserMessageAtMs
      || thread.createdAtMs
      || thread.updatedAtMs,
    );
  }

  const userAtMs = coerceNumber(thread.currentTurnStartedAtMs || thread.latestUserMessageAtMs);
  const finalAtMs = coerceNumber(thread.latestAgentFinalAtMs);
  return userAtMs > 0 && userAtMs > finalAtMs ? userAtMs : 0;
}

function currentTurnActivityAtMs(thread) {
  const startedAtMs = currentTurnStartedAtMs(thread);
  if (!startedAtMs) return 0;
  const rateLimitActivityAtMs = Object.prototype.hasOwnProperty.call(thread, 'rateLimitActivityAtMs')
    ? coerceNumber(thread.rateLimitActivityAtMs)
    : coerceNumber(thread.rateLimitUpdatedAtMs);

  return Math.max(
    startedAtMs,
    coerceNumber(thread.updatedAtMs),
    coerceNumber(thread.agentActivityAtMs),
    rateLimitActivityAtMs,
  );
}

function hasActiveCurrentTurn(thread, nowMs) {
  const activityAtMs = currentTurnActivityAtMs(thread);
  return activityAtMs > 0 && Math.max(0, nowMs - activityAtMs) <= RUNNING_ACTIVITY_WINDOW_MS;
}

export function inferThreadStatus(thread, nowMs = Date.now()) {
  if (thread.archived) return 'archived';
  if (hasActiveCurrentTurn(thread, nowMs)) return 'running';

  const ageMs = Math.max(0, nowMs - coerceNumber(thread.updatedAtMs));
  if (ageMs <= FRESH_WINDOW_MS) return 'fresh';
  if (ageMs <= WARM_WINDOW_MS) return 'warm';
  return 'idle';
}

export function enrichThreadRuntime(thread, nowMs = Date.now()) {
  const startedAtMs = hasActiveCurrentTurn(thread, nowMs)
    ? currentTurnStartedAtMs(thread)
    : 0;
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
  const inCodexSidebar = coerceBoolean(row.in_codex_sidebar ?? row.inCodexSidebar, true);
  const defaultOpenMode = isCodexCli || !inCodexSidebar ? 'codex-cli-resume' : 'codex-deeplink';
  const subagent = subagentInfo(row);
  const goalStatus = String(row.goal_status || '').toLowerCase();
  const goalCreatedAtMs = unixValueToMs(row.goal_created_at_ms);
  const goalUpdatedAtMs = unixValueToMs(row.goal_updated_at_ms);
  const hasActiveGoal = goalStatus === 'active';
  const thread = {
    id,
    externalId: id,
    provider: isCodexCli ? 'codex-cli' : 'codex',
    providerLabel: isCodexCli ? 'Codex CLI' : 'Codex',
    title: row.thread_name || row.title || '未命名任务',
    cwd,
    projectName,
    source,
    model: row.model || row.model_provider || '',
    reasoningEffort: row.reasoning_effort || '',
    tokensUsed: coerceNumber(row.tokens_used),
    hasUnreadTurn: Boolean(coerceNumber(row.has_unread_turn ?? row.hasUnreadTurn ?? row.awaiting_review ?? row.awaitingReview)),
    pinned: coerceBoolean(row.pinned ?? row.isPinned, false),
    archived,
    createdAtMs,
    updatedAtMs,
    rolloutPath: row.rollout_path || '',
    gitBranch: row.git_branch || '',
    gitSha: row.git_sha || '',
    gitOriginUrl: row.git_origin_url || '',
    appDeepLink: UUID_RE.test(id) ? `codex://threads/${id}` : '',
    canOpen: UUID_RE.test(id),
    openLabel: '打开',
    defaultOpenMode,
    resumeCommand,
    inCodexSidebar,
    isAutomation: isAutomationThread(row),
    isSubagent: subagent.isSubagent,
    parentThreadId: subagent.parentThreadId,
    subagentDepth: subagent.depth,
    agentNickname: row.agent_nickname || subagent.agentNickname || '',
    agentRole: row.agent_role || subagent.agentRole || '',
    goalId: row.goal_id || '',
    goalStatus,
    goalTokenBudget: row.goal_token_budget == null ? null : coerceNumber(row.goal_token_budget),
    goalTokensUsed: coerceNumber(row.goal_tokens_used),
    goalTimeUsedSeconds: coerceNumber(row.goal_time_used_seconds),
    goalCreatedAtMs: goalCreatedAtMs || null,
    goalUpdatedAtMs: goalUpdatedAtMs || null,
    activeGoal: hasActiveGoal,
    agentRunning: hasActiveGoal,
    agentStartedAtMs: hasActiveGoal ? goalCreatedAtMs : null,
    agentActivityAtMs: hasActiveGoal ? (goalUpdatedAtMs || updatedAtMs) : null,
  };

  return {
    ...enrichThreadRuntime(thread, nowMs),
  };
}

function attachThreadRelationships(threads) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const childrenByParent = new Map();

  for (const thread of threads) {
    const parentThreadId = thread.parentThreadId || '';
    if (!thread.isSubagent || !parentThreadId) continue;

    const children = childrenByParent.get(parentThreadId) || [];
    children.push(thread);
    childrenByParent.set(parentThreadId, children);
  }

  return threads.map((thread) => {
    const children = childrenByParent.get(thread.id) || [];
    const parent = thread.parentThreadId ? byId.get(thread.parentThreadId) : null;
    const groupUpdatedAtMs = Math.max(
      coerceNumber(thread.updatedAtMs),
      ...children.map((child) => coerceNumber(child.updatedAtMs)),
    );

    return {
      ...thread,
      parentThreadTitle: parent?.title || '',
      parentThreadProjectName: parent?.projectName || '',
      parentThreadProviderLabel: parent?.providerLabel || '',
      childThreadIds: children.map((child) => child.id),
      subagentCount: children.length,
      groupUpdatedAtMs,
    };
  });
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
      tokenBreakdown: addTokenBreakdowns(),
      todayTokenBreakdown: addTokenBreakdowns(),
      latestUpdatedAtMs: 0,
    };

    existing.threadCount += 1;
    existing.tokensUsed += coerceNumber(thread.tokensUsed);
    existing.todayTokensUsed += coerceNumber(thread.todayTokenUsage);
    existing.tokenBreakdown = addTokenBreakdowns(
      existing.tokenBreakdown,
      tokenBreakdownWithFallbackTotal(thread.tokenBreakdown, thread.tokensUsed),
    );
    existing.todayTokenBreakdown = addTokenBreakdowns(
      existing.todayTokenBreakdown,
      tokenBreakdownWithFallbackTotal(thread.todayTokenBreakdown, thread.todayTokenUsage),
    );
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

function countRunningHostThreads(threads) {
  const hostIds = new Set();

  for (const thread of threads) {
    if (thread.status !== 'running') continue;

    const hostId = isSubagentThread(thread)
      ? thread.parentThreadId
      : thread.id;
    if (hostId) hostIds.add(hostId);
  }

  return hostIds.size;
}

function aggregateTokenBreakdown(threads, breakdownField, totalField) {
  return threads.reduce((sum, thread) => addTokenBreakdowns(
    sum,
    tokenBreakdownWithFallbackTotal(thread?.[breakdownField], coerceNumber(thread?.[totalField])),
  ), addTokenBreakdowns());
}

export function buildDashboard(threads, nowMs = Date.now()) {
  const sortedThreads = attachThreadRelationships(threads
    .map((thread) => enrichThreadRuntime(thread, nowMs))
    .sort((a, b) => coerceNumber(b.updatedAtMs) - coerceNumber(a.updatedAtMs)));
  const activeThreads = sortedThreads.filter((thread) => !thread.archived);
  const archivedThreads = sortedThreads.length - activeThreads.length;
  const runningThreads = activeThreads.filter((thread) => thread.status === 'running').length;
  const runningHostThreads = countRunningHostThreads(activeThreads);
  const totalTokensUsed = sortedThreads.reduce((sum, thread) => sum + coerceNumber(thread.tokensUsed), 0);
  const activeTokensUsed = activeThreads.reduce((sum, thread) => sum + coerceNumber(thread.tokensUsed), 0);
  const todayTokensUsed = activeThreads.reduce((sum, thread) => sum + coerceNumber(thread.todayTokenUsage), 0);
  const tokenBreakdown = aggregateTokenBreakdown(sortedThreads, 'tokenBreakdown', 'tokensUsed');
  const activeTokenBreakdown = aggregateTokenBreakdown(activeThreads, 'tokenBreakdown', 'tokensUsed');
  const todayTokenBreakdown = aggregateTokenBreakdown(activeThreads, 'todayTokenBreakdown', 'todayTokenUsage');
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
      runningHostThreads,
      archivedThreads,
      totalTokensUsed,
      activeTokensUsed,
      todayTokensUsed,
      tokenBreakdown,
      activeTokenBreakdown,
      todayTokenBreakdown,
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
