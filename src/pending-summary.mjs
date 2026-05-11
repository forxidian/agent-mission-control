export function isSoftProgressNotification(notification) {
  return notification?.source === 'observed-completion';
}

function finiteCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function isSubagentThread(thread) {
  return Boolean(thread?.isSubagent || thread?.parentThreadId);
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
  const items = Array.isArray(notifications?.items) ? notifications.items : [];
  const progressCount = items.filter(isSoftProgressNotification).length;
  const activeCount = finiteCount(notifications?.summary?.activeCount, items.length);
  const hardPendingCount = Math.max(0, items.length - progressCount);
  const displayCount = activeCount;
  const runningHostThreadCount = countRunningHostThreads(dashboard);

  return {
    activeCount,
    displayCount,
    hardPendingCount,
    progressCount,
    runningHostThreadCount,
    label: displayCount > 0 ? `${displayCount} 待查看` : '暂无待查看',
    hostLabel: runningHostThreadCount > 0
      ? `${runningHostThreadCount} Host 工作中`
      : 'Host 空闲',
    generatedAtMs: nowMs,
  };
}
