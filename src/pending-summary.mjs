export function isSoftProgressNotification(notification) {
  return notification?.source === 'observed-completion';
}

function isSubagentThread(thread) {
  return Boolean(thread?.isSubagent || thread?.parentThreadId);
}

function shouldSuppressSoftProgressNotification(notification, dashboard = {}) {
  if (!isSoftProgressNotification(notification)) return false;

  const thread = (dashboard?.threads || []).find((item) => item.id === notification.threadId);
  if (!thread) return false;

  const signalAtMs = Number(notification.signalAtMs || 0);
  const continuedAtMs = Math.max(
    Number(thread.latestUserMessageAtMs || 0),
    Number(thread.currentTurnStartedAtMs || 0),
  );
  if (signalAtMs > 0 && continuedAtMs > signalAtMs) return true;

  return thread.status === 'running' || Number(thread.currentTurnStartedAtMs || 0) > 0;
}

function visibleNotificationItems(notifications = {}, dashboard = {}) {
  const items = Array.isArray(notifications?.items) ? notifications.items : [];
  return items.filter((item) => !shouldSuppressSoftProgressNotification(item, dashboard));
}

function countRunningHostThreads(dashboard = {}) {
  const summaryCount = Number(dashboard?.summary?.runningHostThreads);
  if (Number.isFinite(summaryCount)) return Math.max(0, summaryCount);

  const hostIds = new Set();
  const threads = Array.isArray(dashboard?.threads) ? dashboard.threads : [];
  for (const thread of threads) {
    if (thread?.archived || thread?.status !== 'running') continue;

    const hostId = isSubagentThread(thread)
      ? thread.parentThreadId
      : thread.id;
    if (hostId) hostIds.add(hostId);
  }

  return hostIds.size;
}

export function buildPendingSummary(notifications = {}, nowMs = Date.now(), dashboard = {}) {
  const items = visibleNotificationItems(notifications, dashboard);
  const progressCount = items.filter(isSoftProgressNotification).length;
  const displayCount = items.length;
  const activeCount = displayCount;
  const hardPendingCount = displayCount;
  const runningHostThreadCount = countRunningHostThreads(dashboard);

  return {
    activeCount,
    displayCount,
    hardPendingCount,
    progressCount,
    runningHostThreadCount,
    label: displayCount > 0 ? `${displayCount} 待处理` : '暂无待处理',
    hostLabel: runningHostThreadCount > 0
      ? `${runningHostThreadCount} Host 工作中`
      : 'Host 空闲',
    generatedAtMs: nowMs,
  };
}
