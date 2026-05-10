import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isSubagentThread } from './thread-classification.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_STORE_PATH = path.join(os.homedir(), '.agent-mission-control', 'notifications.json');
const ACTIVE_STATUSES = new Set(['unread', 'read']);
const TERMINAL_STATUSES = new Set(['done', 'dismissed']);
const VALID_STATUSES = new Set(['unread', 'read', 'snoozed', 'done', 'dismissed']);
const ACTION_NOTIFICATION_TYPES = new Set(['AWAITING_REVIEW', 'AWAITING_PERMISSION']);
const RECENT_OBSERVED_COMPLETION_WINDOW_MS = 2 * 60 * 60 * 1000;
const DESKTOP_NOTIFICATIONS_DISABLED_REASON = 'disabled-until-native-notifier';

function coerceNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function defaultState() {
  return {
    version: 2,
    settings: {
      desktopNotificationsEnabled: false,
      privacyMode: true,
    },
    notifications: {},
    observedReviewSignals: {},
    reviewSignalsInitializedAtMs: null,
  };
}

function appleScriptString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export async function sendMacNotification({ title, message }) {
  if (process.platform !== 'darwin') return { sent: false, reason: 'unsupported-platform' };

  const script = `display notification "${appleScriptString(message)}" with title "${appleScriptString(title)}"`;
  await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  return { sent: true };
}

function hasUnreadReviewSignal(thread) {
  return Boolean(thread.hasUnreadTurn || thread.awaitingReview || thread.has_unread_turn);
}

function providerLabel(thread) {
  return thread?.providerLabel || (thread?.provider === 'opencode' ? 'OpenCode' : 'Agent');
}

function permissionSignalCount(thread) {
  return Math.max(
    coerceNumber(thread.openCodePendingToolCount),
    coerceNumber(thread.pendingToolCount),
  );
}

function hasPermissionSignal(thread) {
  return Boolean(thread.awaitingPermission || permissionSignalCount(thread) > 0);
}

function permissionSignalAtMs(thread, nowMs) {
  return coerceNumber(
    thread.pendingToolAtMs
    || thread.openCodePendingToolAtMs
    || thread.updatedAtMs,
    nowMs,
  );
}

function hasCompletedAfterLastUserMessage(thread) {
  const finalAtMs = coerceNumber(thread.latestAgentFinalAtMs);
  if (finalAtMs <= 0) return false;

  const userAtMs = coerceNumber(thread.latestUserMessageAtMs);
  if (userAtMs > finalAtMs) return false;
  return !thread.latestMessageKind || thread.latestMessageKind === 'agent';
}

export function createNotificationCandidates(dashboard, nowMs = Date.now(), {
  includeObservedCompletions = false,
} = {}) {
  const threads = Array.isArray(dashboard?.threads) ? dashboard.threads : [];
  const candidates = [];

  for (const thread of threads) {
    if (thread.archived) continue;
    if (isSubagentThread(thread)) continue;

    if (hasPermissionSignal(thread)) {
      const signalAtMs = permissionSignalAtMs(thread, nowMs);
      const label = providerLabel(thread);
      candidates.push({
        id: `${thread.id}:AWAITING_PERMISSION:${signalAtMs}`,
        threadId: thread.id,
        type: 'AWAITING_PERMISSION',
        source: `${thread.provider || 'agent'}-permission`,
        priority: 'high',
        status: 'unread',
        title: `${label} 请求处理`,
        reason: `${label} 有待处理事项`,
        threadTitle: thread.title || '未命名会话',
        projectName: thread.projectName || '未知项目',
        appDeepLink: thread.appDeepLink || '',
        resumeCommand: thread.resumeCommand || '',
        createdAtMs: nowMs,
        signalAtMs,
        dueAtMs: null,
      });
      continue;
    }

    const hasObservedCompletion = includeObservedCompletions
      && hasCompletedAfterLastUserMessage(thread);

    if (!hasUnreadReviewSignal(thread) && !hasObservedCompletion) {
      continue;
    }

    const isUnread = hasUnreadReviewSignal(thread);
    const signalAtMs = coerceNumber(thread.latestAgentFinalAtMs || thread.updatedAtMs, nowMs);
    candidates.push({
      id: `${thread.id}:AWAITING_REVIEW:${signalAtMs}`,
      threadId: thread.id,
      type: 'AWAITING_REVIEW',
      source: isUnread ? 'codex-unread' : 'observed-completion',
      priority: 'normal',
      status: 'unread',
      title: '线程已完成，等待处理',
      reason: isUnread ? 'Codex 侧边栏标记为未读' : 'Agent 已完成一轮工作',
      threadTitle: thread.title || '未命名线程',
      projectName: thread.projectName || '未知项目',
      appDeepLink: thread.appDeepLink || '',
      resumeCommand: thread.resumeCommand || `codex resume ${thread.id}`,
      createdAtMs: nowMs,
      signalAtMs,
      dueAtMs: null,
    });
  }

  return candidates;
}

function normalizeRecord(record, nowMs) {
  const normalized = {
    ...record,
    status: VALID_STATUSES.has(record.status) ? record.status : 'unread',
  };

  if (normalized.status === 'snoozed' && coerceNumber(normalized.dueAtMs) <= nowMs) {
    normalized.status = 'unread';
    normalized.dueAtMs = null;
  }

  return normalized;
}

function activeItemsFromRecords(records, nowMs) {
  return Object.values(records)
    .map((record) => normalizeRecord(record, nowMs))
    .filter((record) => ACTIVE_STATUSES.has(record.status))
    .sort((a, b) => coerceNumber(b.signalAtMs) - coerceNumber(a.signalAtMs));
}

function summaryFromRecords(records, nowMs) {
  const normalized = Object.values(records).map((record) => normalizeRecord(record, nowMs));
  return {
    activeCount: normalized.filter((record) => ACTIVE_STATUSES.has(record.status)).length,
    unreadCount: normalized.filter((record) => record.status === 'unread').length,
    snoozedCount: normalized.filter((record) => record.status === 'snoozed').length,
    doneCount: normalized.filter((record) => record.status === 'done').length,
  };
}

function uniqueCandidates(candidates) {
  return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
}

function isObservedCompletion(record) {
  return record?.source === 'observed-completion';
}

function isRecentObservedCompletion(candidate, nowMs) {
  const signalAtMs = coerceNumber(candidate?.signalAtMs);
  return Boolean(
    signalAtMs
    && nowMs - signalAtMs <= RECENT_OBSERVED_COMPLETION_WINDOW_MS
  );
}

function isLegacyAutoDismissedObservedCompletion(record, candidate, nowMs) {
  if (!isObservedCompletion(record) || record.status !== 'dismissed') return false;
  if (record.dismissReason) return false;
  if (candidate?.source !== 'observed-completion') return false;

  return isRecentObservedCompletion(candidate, nowMs);
}

function shouldIncludeObservedCompletion(candidate, records, observedReviewSignals, nowMs) {
  const existing = records[candidate.id];

  if (isLegacyAutoDismissedObservedCompletion(existing, candidate, nowMs)) return true;
  if (existing && TERMINAL_STATUSES.has(existing.status)) return false;
  if (existing && existing.source !== 'observed-completion') return false;
  if (existing?.source === 'observed-completion') {
    return existing.observedCompletionPolicy === 'sticky-until-handled'
      || isRecentObservedCompletion(candidate, nowMs);
  }
  if (!existing && isRecentObservedCompletion(candidate, nowMs)) return true;
  if (!observedReviewSignals[candidate.id]) return isRecentObservedCompletion(candidate, nowMs);
  return false;
}

export class NotificationCenter {
  constructor({
    storePath = DEFAULT_STORE_PATH,
    now = () => Date.now(),
    notifyDesktop = sendMacNotification,
  } = {}) {
    this.storePath = storePath;
    this.now = now;
    this.notifyDesktop = notifyDesktop;
    this.operationQueue = Promise.resolve();
  }

  async runExclusive(operation) {
    const run = this.operationQueue.catch(() => {}).then(operation);
    this.operationQueue = run.catch(() => {});
    return run;
  }

  async readState() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...defaultState(),
        ...parsed,
        settings: {
          ...defaultState().settings,
          ...(parsed.settings || {}),
        },
        notifications: parsed.notifications && typeof parsed.notifications === 'object'
          ? parsed.notifications
          : {},
        observedReviewSignals: parsed.observedReviewSignals && typeof parsed.observedReviewSignals === 'object'
          ? parsed.observedReviewSignals
          : {},
        reviewSignalsInitializedAtMs: parsed.reviewSignalsInitializedAtMs || null,
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return defaultState();
      throw error;
    }
  }

  async writeState(state) {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const temporaryPath = `${this.storePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
    await fs.rename(temporaryPath, this.storePath);
  }

  async refresh(dashboard, { notify = false } = {}) {
    return this.runExclusive(() => this.refreshUnlocked(dashboard, { notify }));
  }

  async refreshUnlocked(dashboard, { notify = false } = {}) {
    const nowMs = this.now();
    const state = await this.readState();
    const records = { ...state.notifications };
    const observedReviewSignals = { ...state.observedReviewSignals };
    const settings = { ...state.settings, desktopNotificationsEnabled: false };
    const desktopNotificationsEnabled = false;
    const unreadCandidates = createNotificationCandidates(dashboard, nowMs);
    const completionCandidates = createNotificationCandidates(dashboard, nowMs, {
      includeObservedCompletions: true,
    }).filter((candidate) => candidate.source === 'observed-completion');
    const hasInitializedReviewSignals = Boolean(state.reviewSignalsInitializedAtMs);

    if (!hasInitializedReviewSignals) {
      for (const candidate of completionCandidates) {
        observedReviewSignals[candidate.id] = nowMs;
      }
    }

    const newCompletionCandidates = completionCandidates.filter((candidate) => (
      hasInitializedReviewSignals
        ? shouldIncludeObservedCompletion(candidate, records, observedReviewSignals, nowMs)
        : isRecentObservedCompletion(candidate, nowMs)
    ));
    const candidates = uniqueCandidates([...unreadCandidates, ...newCompletionCandidates]);
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));

    for (const candidate of candidates) {
      observedReviewSignals[candidate.id] ||= nowMs;
      const existing = records[candidate.id];
      if (!existing) {
        records[candidate.id] = {
          ...candidate,
          ...(candidate.source === 'observed-completion'
            ? { observedCompletionPolicy: 'sticky-until-handled' }
            : {}),
          desktopNotificationPending: desktopNotificationsEnabled,
          desktopNotifiedAtMs: null,
        };
        continue;
      }

      const reopenObservedCompletion = isLegacyAutoDismissedObservedCompletion(existing, candidate, nowMs);
      records[candidate.id] = {
        ...existing,
        threadTitle: candidate.threadTitle,
        projectName: candidate.projectName,
        appDeepLink: candidate.appDeepLink,
        resumeCommand: candidate.resumeCommand,
        signalAtMs: candidate.signalAtMs,
        source: candidate.source,
        reason: candidate.reason,
        status: reopenObservedCompletion ? 'unread' : existing.status,
        dismissReason: reopenObservedCompletion ? undefined : existing.dismissReason,
        updatedAtMs: reopenObservedCompletion ? nowMs : existing.updatedAtMs,
        observedCompletionPolicy: candidate.source === 'observed-completion'
          ? (
            existing.observedCompletionPolicy
            || (isRecentObservedCompletion(candidate, nowMs) ? 'sticky-until-handled' : undefined)
          )
          : existing.observedCompletionPolicy,
        desktopNotificationPending: false,
      };
    }

    for (const [id, record] of Object.entries(records)) {
      const missingLiveSignal = ACTION_NOTIFICATION_TYPES.has(record.type)
        && !candidateIds.has(id)
        && !TERMINAL_STATUSES.has(record.status);

      if (missingLiveSignal) {
        records[id] = normalizeRecord({
          ...record,
          status: 'dismissed',
          dismissReason: 'live-signal-missing',
          desktopNotificationPending: false,
          updatedAtMs: nowMs,
        }, nowMs);
        continue;
      }

      records[id] = normalizeRecord({
        ...record,
        desktopNotificationPending: false,
      }, nowMs);
    }

    const nextState = {
      ...state,
      version: 2,
      settings,
      notifications: records,
      observedReviewSignals,
      reviewSignalsInitializedAtMs: state.reviewSignalsInitializedAtMs || nowMs,
    };
    await this.writeState(nextState);

    const summary = summaryFromRecords(records, nowMs);
    return {
      summary,
      settings: nextState.settings,
      items: activeItemsFromRecords(records, nowMs),
    };
  }

  async updateNotification(id, patch = {}) {
    return this.runExclusive(() => this.updateNotificationUnlocked(id, patch));
  }

  async updateNotificationUnlocked(id, patch = {}) {
    const nowMs = this.now();
    const state = await this.readState();
    const record = state.notifications[id];
    if (!record) {
      const error = new Error('Notification not found');
      error.statusCode = 404;
      throw error;
    }

    const status = patch.status || record.status;
    if (!VALID_STATUSES.has(status)) {
      const error = new Error('Invalid notification status');
      error.statusCode = 422;
      throw error;
    }

    const nextRecord = {
      ...record,
      status,
      updatedAtMs: nowMs,
    };

    if (TERMINAL_STATUSES.has(status)) {
      nextRecord.desktopNotificationPending = false;
    }

    if (status === 'snoozed') {
      const minutes = Math.min(Math.max(coerceNumber(patch.snoozeMinutes, 30), 1), 24 * 60);
      nextRecord.dueAtMs = nowMs + minutes * 60 * 1000;
    } else if (status !== 'snoozed') {
      nextRecord.dueAtMs = null;
    }

    state.notifications[id] = nextRecord;
    await this.writeState(state);
    return normalizeRecord(nextRecord, nowMs);
  }

  async updateSettings(patch = {}) {
    return this.runExclusive(() => this.updateSettingsUnlocked(patch));
  }

  async updateSettingsUnlocked(patch = {}) {
    const state = await this.readState();
    const nextSettings = { ...state.settings };

    if (typeof patch.desktopNotificationsEnabled === 'boolean') {
      nextSettings.desktopNotificationsEnabled = false;
    }

    if (typeof patch.privacyMode === 'boolean') {
      nextSettings.privacyMode = patch.privacyMode;
    }

    nextSettings.desktopNotificationsEnabled = false;

    const nextState = { ...state, settings: nextSettings };
    await this.writeState(nextState);
    return nextSettings;
  }

  async sendTestNotification() {
    return { sent: false, reason: DESKTOP_NOTIFICATIONS_DISABLED_REASON };
  }
}
