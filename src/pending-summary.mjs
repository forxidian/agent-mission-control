export function isSoftProgressNotification(notification) {
  return notification?.source === 'observed-completion';
}

function finiteCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

export function buildPendingSummary(notifications = {}, nowMs = Date.now()) {
  const items = Array.isArray(notifications?.items) ? notifications.items : [];
  const progressCount = items.filter(isSoftProgressNotification).length;
  const activeCount = finiteCount(notifications?.summary?.activeCount, items.length);
  const hardPendingCount = Math.max(0, items.length - progressCount);
  const displayCount = activeCount;

  return {
    activeCount,
    displayCount,
    hardPendingCount,
    progressCount,
    label: displayCount > 0 ? `${displayCount} 待查看` : '暂无待查看',
    generatedAtMs: nowMs,
  };
}
