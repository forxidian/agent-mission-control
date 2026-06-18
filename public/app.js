const state = {
  dashboard: null,
  notifications: null,
  selectedThreadId: null,
  autoTimer: null,
  heartbeatTimer: null,
  pendingSummaryTimer: null,
  installPromptEvent: null,
  isInstalledApp: false,
  isLoading: false,
  isPendingSummarySyncing: false,
  dashboardSignature: '',
  nextRefreshAtMs: null,
  lastRefreshAtMs: null,
  refreshError: '',
  noticeTimer: null,
  inboxExpanded: false,
  search: {
    isOpen: false,
    query: '',
    result: null,
    error: '',
    isLoading: false,
    timer: null,
    requestId: 0,
    nextCursor: '',
    hasMore: false,
    isLoadingMore: false,
    loadMoreError: '',
    modalThreadId: '',
    projectHistory: null,
    projectHistoryError: '',
  },
  artifacts: {
    threadId: '',
    detailThreadId: '',
    detailArtifactId: '',
    dataByThread: new Map(),
    errorsByThread: new Map(),
    isLoading: false,
  },
  review: {
    openThreadId: '',
    targets: null,
    contentByThread: new Map(),
    contentErrorsByThread: new Map(),
    jobsByThread: new Map(),
    fixLoopFilterByThread: new Map(),
    inputModeByThread: new Map(),
    selectedJobIdByThread: new Map(),
    targetProviderByThread: new Map(),
    templateByThread: new Map(),
    customInstructionByThread: new Map(),
    isLoading: false,
    pollTimer: null,
  },
};

const elements = {
  autoRefresh: document.querySelector('#auto-refresh'),
  archiveToggle: document.querySelector('#archive-toggle'),
  artifactDetailContent: document.querySelector('#artifact-detail-content'),
  artifactDetailModal: document.querySelector('#artifact-detail-modal'),
  artifactDetailTitle: document.querySelector('#artifact-detail-title'),
  artifactTimelineContent: document.querySelector('#artifact-timeline-content'),
  artifactTimelineModal: document.querySelector('#artifact-timeline-modal'),
  artifactTimelineTitle: document.querySelector('#artifact-timeline-title'),
  subagentToggle: document.querySelector('#subagent-toggle'),
  automationToggle: document.querySelector('#automation-toggle'),
  appInstallButton: document.querySelector('#app-install-button'),
  appHideButton: document.querySelector('#app-hide-button'),
  closeSearchPage: document.querySelector('#close-search-page'),
  detail: document.querySelector('#detail'),
  inbox: document.querySelector('#inbox'),
  inboxHeading: document.querySelector('#inbox-heading'),
  imagePreviewImage: document.querySelector('#image-preview-image'),
  imagePreviewModal: document.querySelector('#image-preview-modal'),
  imagePreviewTitle: document.querySelector('#image-preview-title'),
  lastUpdated: document.querySelector('#last-updated'),
  monitorStatus: document.querySelector('#monitor-status'),
  monitorStatusLabel: document.querySelector('#monitor-status .monitor-status-label'),
  monitorStatusTooltip: document.querySelector('#monitor-status-tooltip'),
  notificationCount: document.querySelector('#notification-count'),
  notificationToggle: document.querySelector('#notification-toggle'),
  openSearchPage: document.querySelector('#open-search-page'),
  providerFilter: document.querySelector('#provider-filter'),
  projectFilter: document.querySelector('#project-filter'),
  refreshInterval: document.querySelector('#refresh-interval'),
  projects: document.querySelector('#projects'),
  pwaWindowControls: document.querySelector('.pwa-window-control-stack'),
  refreshButton: document.querySelector('#refresh-button'),
  searchCount: document.querySelector('#search-count'),
  searchDetailContent: document.querySelector('#search-detail-content'),
  searchDetailModal: document.querySelector('#search-detail-modal'),
  searchDetailTitle: document.querySelector('#search-detail-title'),
  searchInput: document.querySelector('#search-input'),
  searchLoadSentinel: document.querySelector('#search-load-sentinel'),
  searchPage: document.querySelector('#search-page'),
  searchResults: document.querySelector('#search-results'),
  statusBanner: document.querySelector('#status-banner'),
  statusFilter: document.querySelector('#status-filter'),
  summary: document.querySelector('#summary'),
  threadCount: document.querySelector('#thread-count'),
  threads: document.querySelector('#threads'),
  topbarMetrics: document.querySelector('#topbar-metrics'),
};

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;
const REFRESH_INTERVAL_OPTIONS_MS = new Set([10_000, 30_000, 60_000]);
const UNFOCUSED_REFRESH_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 1_000;
const PENDING_SUMMARY_POLL_INTERVAL_MS = 10_000;
const REVIEW_POLL_INTERVAL_MS = 5_000;
const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_RESULT_LIMIT = 80;
const RECENT_THREAD_LIMIT = 12;
const INBOX_PREVIEW_LIMIT = 4;
const MONITOR_STORAGE_KEY = 'codex-mission-control:monitor';
const REFRESH_INTERVAL_STORAGE_KEY = 'codex-mission-control:refresh-interval-ms';
const PWA_INSTALLED_STORAGE_KEY = 'codex-mission-control:pwa-installed';
const PWA_OPEN_PROTOCOL_URL = 'web+agentmissioncontrol:open';
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_LABELS = {
  running: '工作中',
  fresh: '活跃',
  warm: '温热',
  idle: '空闲',
  archived: '已归档',
};

const REASON_LABELS = {
  running: '正在工作',
  'recent activity': '最近活动',
  'high token usage': '高 token 用量',
  'awaiting review': '等待验收',
  'awaiting permission': '等待授权',
};

const NOTIFICATION_TYPE_LABELS = {
  AWAITING_REVIEW: '等待验收',
  AWAITING_PERMISSION: '等待授权',
};

const NOTIFICATION_SOURCE_LABELS = {
  'codex-unread': '等待验收',
  'observed-completion': '新进展',
  'opencode-permission': '等待授权',
  'claude-code-cli-permission': '等待授权',
  'claude-desktop-code-permission': '等待授权',
  'claude-desktop-cowork-permission': '等待处理',
};

const NOTIFICATION_STATUS_LABELS = {
  unread: '待处理',
  read: '已处理',
};

const SOFT_PROGRESS_STATUS_LABELS = {
  unread: '待处理',
  read: '已处理',
};

const ACTIVE_NOTIFICATION_STATUSES = new Set(['unread', 'read']);
const CLOSED_TODO_STATUSES = new Set(['completed', 'done', 'cancelled', 'canceled']);
const REVIEW_TEMPLATES = [
  ['code-review', '代码审查'],
  ['product-review', '产品/需求审查'],
  ['technical-review', '技术方案审查'],
  ['response-quality-review', '回复质量审查'],
  ['custom-review', '自定义审查'],
];
const REVIEW_INPUT_MODES = [
  ['latest-agent-signal', '最近 Agent 输出'],
  ['latest-turn', '最近一轮对话'],
  ['thread-summary', '线程摘要和最近输出'],
];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTokens(value) {
  const number = Math.max(0, Number(value || 0));
  if (!Number.isFinite(number) || number === 0) return '0M';

  if (number >= 1_000_000_000) {
    const billions = number / 1_000_000_000;
    const fractionDigits = billions >= 100 ? 0 : billions >= 10 ? 1 : 2;
    return `${Number(billions.toFixed(fractionDigits)).toLocaleString('en-US')}B`;
  }

  const millions = number / 1_000_000;
  if (millions < 0.1) return '<0.1M';

  const fractionDigits = millions >= 100 ? 0 : 1;
  return `${Number(millions.toFixed(fractionDigits)).toLocaleString('en-US')}M`;
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '0%';
  return `${Math.round(Number(value))}%`;
}

function formatOptionalPercent(value) {
  if (!Number.isFinite(Number(value))) return '-';
  return formatPercent(value);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (!Number.isFinite(bytes) || bytes === 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Number(mb.toFixed(mb >= 100 ? 0 : 1))} MB`;
  const gb = mb / 1024;
  return `${Number(gb.toFixed(gb >= 10 ? 1 : 2))} GB`;
}

function formatMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${Number((ms / 1000).toFixed(1))} s`;
}

function formatCompactResetTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '暂无刷新时间';
  return `刷新 ${timeFormat.format(new Date(value))}`;
}

function formatQuotaNote(timestamp, stale = false) {
  const resetText = formatCompactResetTime(timestamp);
  return stale ? `沿用上次记录 · ${resetText}` : resetText;
}

function relativeTime(timestamp) {
  const diffMs = Date.now() - Number(timestamp || 0);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return '刚刚';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
  return timeFormat.format(new Date(timestamp));
}

function formatDuration(ms) {
  const durationMs = Math.max(0, Number(ms || 0));
  const second = 1000;
  const minute = 60 * second;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (durationMs < minute) return `${Math.max(1, Math.floor(durationMs / second))} 秒`;
  if (durationMs < hour) return `${Math.floor(durationMs / minute)} 分钟`;
  if (durationMs < day) {
    const hours = Math.floor(durationMs / hour);
    const minutes = Math.floor((durationMs % hour) / minute);
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }

  const days = Math.floor(durationMs / day);
  const hours = Math.floor((durationMs % day) / hour);
  return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`;
}

function currentTurnDuration(thread) {
  const startedAtMs = Number(thread?.currentTurnStartedAtMs || thread?.latestUserMessageAtMs || 0);
  if (!startedAtMs || thread?.status !== 'running') return '';
  return formatDuration(Date.now() - startedAtMs);
}

function notificationLabel(notification) {
  return NOTIFICATION_SOURCE_LABELS[notification?.source]
    || NOTIFICATION_TYPE_LABELS[notification?.type]
    || notification?.type
    || '通知';
}

function isSoftProgressNotification(notification) {
  return notification?.source === 'observed-completion';
}

function shouldSuppressSoftProgressNotification(notification, dashboard = state.dashboard) {
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

function reconcileNotificationsWithDashboard(notifications, dashboard = state.dashboard) {
  if (!notifications?.items?.length) return notifications;

  const items = notifications.items.filter((item) => (
    !shouldSuppressSoftProgressNotification(item, dashboard)
  ));
  if (items.length === notifications.items.length) return notifications;

  const summary = notifications.summary || {};
  return {
    ...notifications,
    items,
    summary: {
      ...summary,
      activeCount: items.length,
      unreadCount: items.filter((item) => item.status === 'unread').length,
    },
  };
}

function notificationStatusLabel(notification) {
  const labels = isSoftProgressNotification(notification)
    ? SOFT_PROGRESS_STATUS_LABELS
    : NOTIFICATION_STATUS_LABELS;
  return labels[notification?.status] || notification?.status || '未知状态';
}

function notificationDoneLabel(notification) {
  return '标记已处理';
}

function notificationActionLabel(notification) {
  return '待处理操作';
}

function notificationOutcomeLabel(notification) {
  return '已处理';
}

function notificationMarkedPhrase(notification) {
  return `已标记为${notificationOutcomeLabel(notification)}`;
}

function notificationBreakdown(notifications) {
  const items = notifications?.items || [];
  const softCount = items.filter(isSoftProgressNotification).length;
  const activeCount = items.length;
  return {
    totalCount: activeCount,
    hardCount: activeCount,
    softCount,
  };
}

function fallbackNotificationsFromDashboard(dashboard) {
  const items = Array.isArray(dashboard?.inbox) ? dashboard.inbox : [];
  const activeCount = dashboard?.summary?.inboxCount ?? items.length;
  return {
    summary: {
      activeCount,
      unreadCount: items.filter((item) => item.status === 'unread').length,
      snoozedCount: 0,
      doneCount: 0,
    },
    settings: {},
    items,
  };
}

function localScanStatus(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return '等待首次扫描';
  if (value <= 800) return '轻松';
  if (value <= 2_000) return '正常';
  if (value <= 5_000) return '偏慢';
  return '很慢';
}

function localMemoryStatus(bytes) {
  const mb = Number(bytes || 0) / (1024 * 1024);
  if (!Number.isFinite(mb) || mb <= 0) return '等待数据';
  if (mb <= 250) return '正常';
  if (mb <= 600) return '偏高';
  return '很高';
}

function topbarLoadLabel(performance = state.dashboard?.performance || {}) {
  const dashboard = performance.dashboard || {};
  const processInfo = performance.process || {};
  const scanStatus = localScanStatus(dashboard.lastLoadMs);
  const memoryStatus = localMemoryStatus(processInfo.rssBytes);
  return `负载${scanStatus} · 内存${memoryStatus}`;
}

function topbarLoadTitle(performance = state.dashboard?.performance) {
  const dashboard = performance?.dashboard || {};
  const processInfo = performance?.process || {};
  return `本地扫描耗时：${formatMs(dashboard.lastLoadMs)}；服务内存占用：${formatBytes(processInfo.rssBytes)}`;
}

function cacheFreshnessLabel(cache = {}) {
  const ageMs = Number(cache.cacheAgeMs);
  const ttlMs = Number(cache.cacheTtlMs);
  if (!Number.isFinite(ageMs)) return '等待缓存';
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return formatMs(ageMs);
  const stateLabel = cache.cached ? '有效' : '已过期';
  return `${stateLabel} ${formatMs(ageMs)} / ${formatMs(ttlMs)}`;
}

function topbarLoadTooltip(performance = state.dashboard?.performance) {
  const dashboard = performance?.dashboard || {};
  const notifications = performance?.notifications || {};
  const processInfo = performance?.process || {};
  const scanMs = dashboard.lastLoadMs;
  const rssBytes = processInfo.rssBytes;
  const heapUsedBytes = processInfo.heapUsedBytes;

  return [
    `本地负载：${localScanStatus(scanMs)} · 扫描 ${formatMs(scanMs)}`,
    `服务内存：${localMemoryStatus(rssBytes)} · 占用 ${formatBytes(rssBytes)} · 堆内存 ${formatBytes(heapUsedBytes)}`,
    `看板缓存：${cacheFreshnessLabel(dashboard)} · 复用 ${formatOptionalPercent(dashboard.hitRatePercent)}`,
    `通知缓存：${cacheFreshnessLabel(notifications)} · 复用 ${formatOptionalPercent(notifications.hitRatePercent)}`,
  ].join('\n');
}

function setNotifications(notifications) {
  const reconciled = reconcileNotificationsWithDashboard(notifications, state.dashboard);
  state.notifications = reconciled;
  if (state.dashboard) {
    state.dashboard.notifications = reconciled;
    state.dashboard.summary = {
      ...(state.dashboard.summary || {}),
      inboxCount: reconciled?.summary?.activeCount ?? reconciled?.items?.length ?? 0,
    };
  }
}

function countRunningHostThreads(dashboard = state.dashboard) {
  const summaryCount = Number(dashboard?.summary?.runningHostThreads);
  if (Number.isFinite(summaryCount)) return Math.max(0, summaryCount);

  const hostIds = new Set();
  for (const thread of dashboard?.threads || []) {
    if (thread?.archived || thread?.status !== 'running') continue;
    const hostId = isSubagentThread(thread) ? thread.parentThreadId : thread.id;
    if (hostId) hostIds.add(hostId);
  }

  return hostIds.size;
}

function tokenUsageMarkup(thread) {
  const todayTokens = Number(thread?.todayTokenUsage || 0);
  const historyTokens = Number(thread?.tokensUsed || 0);

  return `
    <span class="thread-token-inline">
      <span class="token-label">今日 ${escapeHtml(formatTokens(todayTokens))}</span>
      <span class="token-history">历史 ${escapeHtml(formatTokens(historyTokens))}</span>
    </span>
  `;
}

function searchMatchMarkup(thread, query = currentSearchQuery()) {
  const match = thread?.match;
  if (!match?.field && !match?.snippet) return '';

  const label = match.label || match.field || 'match';
  const snippet = match.snippet || '';
  return `
    <div class="search-match">
      <span>${escapeHtml(label)}</span>
      ${snippet ? `<em>${highlightSearchTerm(snippet, query, 220)}</em>` : ''}
    </div>
  `;
}

function secondsUntil(timestamp) {
  if (!timestamp) return 0;
  return Math.max(0, Math.ceil((Number(timestamp) - Date.now()) / 1000));
}

function normalizeRefreshInterval(value) {
  const number = Number.parseInt(value, 10);
  return REFRESH_INTERVAL_OPTIONS_MS.has(number) ? number : DEFAULT_REFRESH_INTERVAL_MS;
}

function currentRefreshIntervalMs() {
  return normalizeRefreshInterval(elements.refreshInterval?.value);
}

function pageHasFocus() {
  return typeof document.hasFocus !== 'function' || document.hasFocus();
}

function effectiveRefreshIntervalMs() {
  const intervalMs = currentRefreshIntervalMs();
  return pageHasFocus() ? intervalMs : Math.max(intervalMs, UNFOCUSED_REFRESH_INTERVAL_MS);
}

function refreshIntervalLabel(intervalMs = currentRefreshIntervalMs()) {
  return intervalMs < 1000 ? `${intervalMs} ms` : `${Math.round(intervalMs / 1000)} 秒`;
}

function dashboardDataSignature(dashboard) {
  if (!dashboard) return '';

  const runningThreads = (dashboard.threads || []).some((thread) => thread.status === 'running');
  const runtimeMinuteBucket = runningThreads ? Math.floor(Date.now() / 60_000) : 0;
  const threadSignatures = (dashboard.threads || []).map((thread) => {
    const { currentTurnElapsedMs, ...stableThread } = thread;
    return stableThread;
  });

  return JSON.stringify({
    summary: dashboard.summary || {},
    providers: dashboard.providers || [],
    projects: dashboard.projects || [],
    threads: threadSignatures,
    notifications: dashboard.notifications || null,
    inbox: dashboard.inbox || [],
    runtimeMinuteBucket,
  });
}

function quotaGroupLabel(group = {}) {
  return group.label || group.model || group.providerLabel || 'LLM';
}

function quotaRows(groups, windowKey) {
  return groups.map((group) => {
    const window = group?.[windowKey];
    const hasWindow = Boolean(window);
    return {
      label: quotaGroupLabel(group),
      value: hasWindow ? formatOptionalPercent(window?.availablePercent) : '-',
      note: hasWindow ? formatQuotaNote(window?.resetsAtMs, group?.stale) : '暂无 quota 信号',
    };
  });
}

function quotaSummaryCards(quota) {
  const groups = Array.isArray(quota?.groups) ? quota.groups : [];

  if (groups.length > 1) {
    return [
      {
        label: '实时可用 quota',
        rows: quotaRows(groups, 'realtime'),
        tone: 'quota',
      },
      {
        label: '本周可用 quota',
        rows: quotaRows(groups, 'weekly'),
        tone: 'quota',
      },
    ];
  }

  return [
    {
      label: '实时可用 quota',
      value: formatOptionalPercent(quota?.realtime?.availablePercent),
      note: formatQuotaNote(quota?.realtime?.resetsAtMs, quota?.stale),
      tone: 'quota',
    },
    {
      label: '本周可用 quota',
      value: formatOptionalPercent(quota?.weekly?.availablePercent),
      note: formatQuotaNote(quota?.weekly?.resetsAtMs, quota?.stale),
      tone: 'quota',
    },
  ];
}

function summaryCard({ label, value, note = '', tone = '', rows = [], title = '' }) {
  const hasRows = Array.isArray(rows) && rows.length > 0;
  const classes = [
    'summary-card',
    tone ? `summary-${escapeHtml(tone)}` : '',
    hasRows ? 'summary-card-with-lines' : '',
  ].filter(Boolean).join(' ');
  const body = hasRows
    ? `
      <div class="summary-card-lines">
        ${rows.map((row) => `
          <div class="summary-card-line"${row.title ? ` title="${escapeHtml(row.title)}"` : ''}>
            <span class="summary-card-line-label">${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.value)}</strong>
            ${row.note ? `<small>${escapeHtml(row.note)}</small>` : ''}
          </div>
        `).join('')}
      </div>
    `
    : `
      <strong>${escapeHtml(value)}</strong>
      ${note ? `<small>${escapeHtml(note)}</small>` : ''}
    `;

  return `
    <article class="${classes}"${title ? ` title="${escapeHtml(title)}"` : ''}>
      <span>${escapeHtml(label)}</span>
      ${body}
    </article>
  `;
}

function summaryStripItem({ label, value, note = '' }) {
  return `
    <span class="summary-strip-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${note ? `<small>${escapeHtml(note)}</small>` : ''}
    </span>
  `;
}

function renderTopbarMetrics(summary = {}) {
  if (!elements.topbarMetrics) return;

  const notifications = state.notifications || state.dashboard?.notifications;
  const counts = notificationBreakdown(notifications);
  const pendingCount = counts.totalCount;
  const runningHostThreads = countRunningHostThreads(state.dashboard || { summary });
  const pendingTitle = `${pendingCount || 0} 项待处理`;
  const hostTitle = `${runningHostThreads || 0} 个 Host 工作中`;

  elements.topbarMetrics.innerHTML = `
    <button
      class="topbar-metric topbar-metric-button${runningHostThreads > 0 ? ' is-running' : ''}"
      type="button"
      title="${escapeHtml(hostTitle)}"
      aria-label="${escapeHtml(hostTitle)}"
      data-topbar-action="running"
    >
      <span>Host 工作中</span>
      <span class="topbar-metric-value">
        <strong>${escapeHtml(runningHostThreads)}</strong>
        ${runningHostThreads > 0 ? '<span class="work-activity" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}
      </span>
    </button>
    <button
      class="topbar-metric topbar-metric-button${pendingCount > 0 ? ' is-attention' : ''}"
      type="button"
      title="${escapeHtml(pendingTitle)}"
      aria-label="${escapeHtml(pendingTitle)}"
      data-topbar-action="pending"
    >
      <span>待处理</span>
      <strong>${escapeHtml(pendingCount)}</strong>
    </button>
  `;
}

function providerStatusLabel(provider = {}) {
  if (provider.status === 'missing') return '未检测到';
  if (provider.status === 'error') return '读取失败';
  if (provider.status === 'desktop') return '桌面端';
  if (Number(provider.threadCount || 0) <= 0 && provider.installed) return '已检测';
  return '已接入';
}

function providerCountLabel(provider = {}) {
  const count = Number(provider.threadCount || 0);
  if (count > 0) return `${count} 项`;
  if (provider.status === 'missing') return '待接入';
  if (provider.status === 'error') return '异常';
  return '';
}

function providerItemClasses(provider = {}) {
  const classes = ['provider-item', `provider-${provider.status || 'ready'}`];
  if (Number(provider.threadCount || 0) <= 0) classes.push('provider-empty');
  return classes.map(escapeHtml).join(' ');
}

function renderProviderStrip(providers = []) {
  if (!providers.length) return '';

  return `
    <section class="provider-strip" aria-label="来源接入状态">
      <div class="provider-strip-heading">
        <span>来源接入</span>
        <small>${providers.length} 项</small>
      </div>
      <div class="provider-list">
        ${providers.map((provider) => {
          const countLabel = providerCountLabel(provider);
          return `
        <article class="${providerItemClasses(provider)}" title="${escapeHtml(provider.message || '')}">
          <span class="provider-dot" aria-hidden="true"></span>
          <span class="provider-name">${escapeHtml(provider.label)}</span>
          <span class="provider-state">${escapeHtml(providerStatusLabel(provider))}</span>
          ${countLabel ? `<span class="provider-count">${escapeHtml(countLabel)}</span>` : ''}
        </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function currentSearchQuery() {
  return elements.searchInput?.value?.trim() || '';
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSearchTerm(value = '', query = currentSearchQuery(), maxLength = 260) {
  const text = compactSignal(value, maxLength);
  const escaped = escapeHtml(text);
  const needle = String(query || '').trim();
  if (!needle) return escaped;

  const pattern = escapeRegExp(needle);
  if (!pattern) return escaped;
  return escaped.replace(new RegExp(pattern, 'gi'), (match) => `<mark>${match}</mark>`);
}

function hasActiveSearchQuery() {
  return state.search.isOpen && currentSearchQuery().length > 0;
}

function isSearchPageOpen() {
  return Boolean(state.search.isOpen);
}

function searchResultThreads() {
  return state.search?.result?.items || [];
}

function dashboardViewSections() {
  return [...document.querySelectorAll('.dashboard-view')];
}

function searchInputTopOffset() {
  const fallbackOffset = 8;
  const controls = elements.pwaWindowControls;
  if (controls) {
    const style = window.getComputedStyle(controls);
    if (style.position === 'fixed') {
      const rect = controls.getBoundingClientRect();
      if (rect.height > 0) return Math.max(fallbackOffset, Math.ceil(rect.bottom + 6));
    }
  }

  const hideButton = elements.appHideButton;
  if (!hideButton || hideButton.hidden) return fallbackOffset;
  const style = window.getComputedStyle(hideButton);
  if (style.position !== 'fixed') return fallbackOffset;
  return Math.max(fallbackOffset, Math.ceil(hideButton.getBoundingClientRect().bottom + 6));
}

function focusSearchInputAtTop() {
  const input = elements.searchInput;
  if (!input) return;

  window.requestAnimationFrame(() => {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }

    const top = input.getBoundingClientRect().top + window.scrollY - searchInputTopOffset();
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  });
}

function setPageView(view) {
  const isSearch = view === 'search';
  state.search.isOpen = isSearch;
  document.body.dataset.view = isSearch ? 'search' : 'dashboard';
  if (elements.searchPage) elements.searchPage.hidden = !isSearch;
  if (elements.detail) elements.detail.hidden = isSearch;
  for (const section of dashboardViewSections()) {
    section.hidden = isSearch;
  }

  if (isSearch) {
    renderSearchResults();
    requestSearchLoadCheck();
    focusSearchInputAtTop();
  } else {
    closeSearchDetailModal({ renderResults: false });
    renderThreads();
  }
}

function openSearchPage({ pushState = true } = {}) {
  if (pushState && window.location.hash !== '#search') {
    window.history.pushState(null, '', '#search');
  }
  setPageView('search');
}

function closeSearchPage({ pushState = true } = {}) {
  if (pushState && window.location.hash === '#search') {
    window.history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  setPageView('dashboard');
}

function syncPageViewFromLocation() {
  if (window.location.hash === '#search') {
    openSearchPage({ pushState: false });
  } else {
    closeSearchPage({ pushState: false });
  }
}

function findThread(threadId) {
  return state.dashboard?.threads?.find((thread) => thread.id === threadId)
    || searchResultThreads().find((thread) => thread.id === threadId)
    || null;
}

function findNotification(notificationId) {
  return state.notifications?.items?.find((notification) => notification.id === notificationId) || null;
}

function resumeCommandForThread(thread) {
  return thread.resumeCommand || `codex resume ${thread.id}`;
}

function providerLabel(thread) {
  return thread?.providerLabel || 'Agent';
}

function isSubagentThread(thread) {
  return Boolean(thread?.isSubagent || thread?.parentThreadId);
}

function subagentRoleLabel(thread) {
  return [thread?.agentNickname, thread?.agentRole]
    .filter(Boolean)
    .join(' · ');
}

function hostThreadLabel(thread) {
  return thread?.parentThreadTitle || thread?.parentThreadId || '';
}

function threadRelationshipLabel(thread) {
  if (isSubagentThread(thread)) {
    const roleLabel = subagentRoleLabel(thread);
    return roleLabel ? `Sub · ${roleLabel}` : 'Sub Agent';
  }

  const count = Number(thread?.subagentCount || 0);
  return count > 0 ? `Host · ${count} Sub` : '';
}

function threadRowClasses(thread, isSelected) {
  return [
    'thread-row',
    isSelected ? 'is-selected' : '',
    isSubagentThread(thread) ? 'is-subagent' : '',
    Number(thread?.subagentCount || 0) > 0 ? 'is-host-agent' : '',
    Number(thread?.artifacts?.total || 0) > 0 ? 'has-artifacts' : '',
  ].filter(Boolean).map(escapeHtml).join(' ');
}

function displayThreadTitle(thread) {
  return compactSignal(thread?.title || '未命名任务', 140) || '未命名任务';
}

function threadTitleMarkup(thread, query = currentSearchQuery()) {
  const isSubagent = isSubagentThread(thread);
  const subagentCount = Number(thread?.subagentCount || 0);
  const badges = [
    isSubagent ? 'Sub' : '',
    !isSubagent && subagentCount > 0 ? 'Host' : '',
    !isSubagent && subagentCount > 0 ? `${subagentCount} Sub` : '',
  ].filter(Boolean);

  return `
    <div class="thread-title-line">
      <span class="thread-title">${highlightSearchTerm(displayThreadTitle(thread), query, 140)}</span>
      ${badges.map((badge) => `<span class="thread-kind-badge">${escapeHtml(badge)}</span>`).join('')}
    </div>
  `;
}

function threadKindBadgesMarkup(thread) {
  const isSubagent = isSubagentThread(thread);
  const subagentCount = Number(thread?.subagentCount || 0);
  const badges = [
    isSubagent ? 'Sub' : '',
    !isSubagent && subagentCount > 0 ? 'Host' : '',
    !isSubagent && subagentCount > 0 ? `${subagentCount} Sub` : '',
  ].filter(Boolean);

  return badges.map((badge) => `<span class="thread-kind-badge">${escapeHtml(badge)}</span>`).join('');
}

function threadProjectRailMarkup(thread) {
  const projectName = thread?.projectName || '未知项目';
  return `
    <div class="thread-project-rail" title="${escapeHtml(projectName)}">
      <span class="thread-status-inline">${statusMarkup(thread.status)}</span>
      <span class="thread-project-copy">
        <span class="thread-project-label">项目</span>
        <strong>${escapeHtml(projectName)}</strong>
      </span>
    </div>
  `;
}

function threadMentionCandidates(thread) {
  return [
    { type: '用户输入', field: 'recent user', text: thread?.latestMeaningfulUserMessage || thread?.latestUserMessage || '' },
    { type: 'Agent回答', field: 'agent output', text: thread?.lastAgentMessage || '' },
    { type: '用户首次输入', field: 'first user', text: thread?.firstUserMessage || '' },
  ].filter((item) => compactSignal(item.text));
}

function threadMention(thread, query = currentSearchQuery()) {
  const candidates = threadMentionCandidates(thread);
  const matchField = thread?.match?.field || '';
  const fieldMatch = candidates.find((item) => item.field === matchField);
  if (fieldMatch) return fieldMatch;

  const needle = String(query || '').trim().toLocaleLowerCase();
  const textMatch = needle
    ? candidates.find((item) => compactSignal(item.text).toLocaleLowerCase().includes(needle))
    : null;
  if (textMatch) return textMatch;

  return candidates[0] || {
    type: '用户输入',
    field: 'recent user',
    text: '暂无可展示的聊天内容',
  };
}

function threadMentionMarkup(thread, query = currentSearchQuery()) {
  const mention = threadMention(thread, query);
  return `
    <div class="thread-mention">${highlightSearchTerm(mention.text, query, 220)}</div>
  `;
}

function threadSupportMetaItems(thread) {
  const relationship = threadRelationshipLabel(thread);
  const host = isSubagentThread(thread) ? hostThreadLabel(thread) : '';
  const turnDuration = currentTurnDuration(thread);

  return [
    relationship ? `<span>${escapeHtml(relationship)}</span>` : '',
    host ? `<span title="${escapeHtml(host)}">Host: ${escapeHtml(host)}</span>` : '',
    turnDuration ? `<span>${escapeHtml(`本轮 ${turnDuration}`)}</span>` : '',
  ].filter(Boolean);
}

function threadSideMarkup(thread, openDisabled) {
  return `
    <aside class="thread-side" aria-label="线程属性">
      <div class="thread-side-metrics">
        <span class="thread-side-metric">
          <span>最近</span>
          <strong>${escapeHtml(relativeTime(thread.updatedAtMs))}</strong>
        </span>
        ${tokenUsageMarkup(thread)}
        <span class="thread-side-provider" title="${escapeHtml(providerLabel(thread))}">${escapeHtml(providerLabel(thread))}</span>
      </div>
      <div class="row-actions" aria-label="任务操作">
        <button class="action-button primary" type="button" data-open-thread-id="${escapeHtml(thread.id)}"${openDisabled}>${escapeHtml(openLabel(thread))}</button>
      </div>
    </aside>
  `;
}

function searchResultMetaItems(thread) {
  return [
    thread.projectName || '未知项目',
    thread.updatedAtMs ? timeFormat.format(new Date(thread.updatedAtMs)) : '-',
  ].filter(Boolean);
}

function threadResultDetailMarkup(thread, {
  query = currentSearchQuery(),
  showMeta = true,
} = {}) {
  const supportMetaItems = threadSupportMetaItems(thread);
  const metaItems = showMeta ? searchResultMetaItems(thread) : [];

  return `
    <div class="thread-result-detail">
      ${metaItems.length ? `
        <div class="search-result-meta">
          ${metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('<span aria-hidden="true">|</span>')}
        </div>
      ` : ''}
      <div class="search-result-heading">
        <span class="search-result-title">${highlightSearchTerm(displayThreadTitle(thread), query, 160)}</span>
        ${threadKindBadgesMarkup(thread)}
      </div>
      <div class="search-hit-line">
        ${searchResultExcerptMarkup(thread, query)}
      </div>
      ${supportMetaItems.length ? `
        <div class="thread-support-meta">
          ${supportMetaItems.join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function threadPrimaryModuleMarkup(thread, {
  className = 'thread-main',
  query = currentSearchQuery(),
  isSelected = false,
  showMeta = true,
} = {}) {
  const attachmentStrip = attachmentPreviewStripMarkup(threadAttachmentSource(thread));

  return `
    <div class="${escapeHtml(className)}">
      ${threadProjectRailMarkup(thread)}
      <div class="thread-result-stack">
        <button class="thread-detail-button" type="button" data-thread-id="${escapeHtml(thread.id)}" aria-pressed="${isSelected}">
          ${threadResultDetailMarkup(thread, { query, showMeta })}
        </button>
        ${attachmentStrip ? `<div class="thread-result-attachments search-result-attachments">${attachmentStrip}</div>` : ''}
      </div>
    </div>
  `;
}

function searchConversationPreview(thread, query = currentSearchQuery()) {
  return searchConversationPreviewSegments(thread, query)
    .map((segment) => segment.text)
    .join(' ');
}

function searchSpeakerForField(field = '') {
  return field === 'agent output' ? 'agent' : 'user';
}

function searchTextSegment(text, speaker = 'user') {
  return { type: 'text', speaker, text };
}

function searchConversationPreviewSegments(thread, query = currentSearchQuery()) {
  const firstUser = compactSignal(thread?.firstUserMessage || '');
  const recentUser = compactSignal(thread?.latestMeaningfulUserMessage || thread?.latestUserMessage || '');
  const agentOutput = compactSignal(thread?.lastAgentMessage || '');
  const candidates = [
    { field: 'first user', speaker: 'user', text: firstUser },
    { field: 'recent user', speaker: 'user', text: recentUser },
    { field: 'agent output', speaker: 'agent', text: agentOutput },
  ].filter((item) => item.text);

  const matchField = thread?.match?.field || '';
  if (['first user', 'recent user', 'agent output'].includes(matchField) && thread?.match?.snippet) {
    const recalledText = compactSignal(thread.match.snippet);
    const recalledSpeaker = searchSpeakerForField(matchField);
    if (firstUser && matchField !== 'first user' && recalledText !== firstUser) {
      return [
        searchTextSegment(firstUser, 'user'),
        { type: 'separator', text: '……' },
        searchTextSegment(recalledText, recalledSpeaker),
      ];
    }
    return [searchTextSegment(recalledText, recalledSpeaker)];
  }

  const needle = String(query || '').trim().toLocaleLowerCase();
  if (needle) {
    const textMatch = candidates.find((item) => item.text.toLocaleLowerCase().includes(needle));
    if (textMatch) {
      if (firstUser && textMatch.field !== 'first user' && textMatch.text !== firstUser) {
        return [
          searchTextSegment(firstUser, 'user'),
          { type: 'separator', text: '……' },
          searchTextSegment(textMatch.text, textMatch.speaker),
        ];
      }
      return [searchTextSegment(textMatch.text, textMatch.speaker)];
    }
  }

  const fallback = candidates[0];
  return [searchTextSegment(
    fallback?.text || '暂无可展示的聊天内容',
    fallback?.speaker || 'user',
  )];
}

function searchSpeakerLabel(speaker = 'user') {
  return speaker === 'agent' ? 'Agent：' : '用户：';
}

function searchSpeakerClass(speaker = 'user') {
  return speaker === 'agent' ? 'search-result-speaker-agent' : 'search-result-speaker-user';
}

function searchResultExcerptMarkup(thread, query = currentSearchQuery()) {
  const segments = searchConversationPreviewSegments(thread, query);
  return `
    <div class="search-result-excerpt">
      ${segments.map((segment) => (
        segment.type === 'separator'
          ? `<span class="search-result-excerpt-separator" aria-hidden="true">${escapeHtml(segment.text || '……')}</span>`
          : `
            <span class="search-result-excerpt-line" data-speaker="${escapeHtml(segment.speaker || 'user')}">
              <span class="search-result-speaker ${searchSpeakerClass(segment.speaker)}">${escapeHtml(searchSpeakerLabel(segment.speaker))}</span>
              <span class="search-result-message">${highlightSearchTerm(segment.text, query, 420)}</span>
            </span>
          `
      )).join('')}
    </div>
  `;
}

function threadAttachmentSource(thread) {
  return thread?.latestMeaningfulUserMessage
    || thread?.latestUserMessage
    || thread?.firstUserMessage
    || thread?.title
    || '';
}

function searchResultSideMetaMarkup(thread) {
  return `
    <div class="search-result-side-meta">
      <span>${escapeHtml(providerLabel(thread))}</span>
      <span aria-hidden="true">|</span>
      <span>${escapeHtml(thread.model || '未知模型')}</span>
    </div>
  `;
}

function searchResultRowMarkup(thread, { query = currentSearchQuery(), isSelected = false } = {}) {
  const openDisabled = canOpenThread(thread) ? '' : ' disabled';
  const artifactModule = threadArtifactModuleMarkup(thread);
  return `
    <article class="search-result-row${isSelected ? ' is-selected' : ''}${isSubagentThread(thread) ? ' is-subagent' : ''}${Number(thread?.subagentCount || 0) > 0 ? ' is-host-agent' : ''}${artifactModule ? ' has-artifacts' : ''}" data-thread-kind="${isSubagentThread(thread) ? 'subagent' : 'host'}">
      ${threadPrimaryModuleMarkup(thread, {
        className: 'search-result-main',
        query,
        isSelected,
        showMeta: false,
      })}
      ${artifactModule}
      ${threadSideMarkup(thread, openDisabled)}
    </article>
  `;
}

function threadMetaItems(thread) {
  const relationship = threadRelationshipLabel(thread);
  const host = isSubagentThread(thread) ? hostThreadLabel(thread) : '';
  const turnDuration = currentTurnDuration(thread);

  return [
    relationship,
    host ? `Host: ${host}` : '',
    providerLabel(thread),
    thread.projectName,
    thread.model || '未知模型',
    relativeTime(thread.updatedAtMs),
    turnDuration ? `本轮 ${turnDuration}` : '',
  ].filter(Boolean);
}

function arrangeThreadRows(threads) {
  const visibleIds = new Set(threads.map((thread) => thread.id));
  const childIds = new Set();
  const childrenByParent = new Map();

  for (const thread of threads) {
    if (!isSubagentThread(thread) || !thread.parentThreadId || !visibleIds.has(thread.parentThreadId)) continue;

    const children = childrenByParent.get(thread.parentThreadId) || [];
    children.push(thread);
    childrenByParent.set(thread.parentThreadId, children);
    childIds.add(thread.id);
  }

  const roots = threads
    .filter((thread) => !childIds.has(thread.id))
    .sort((a, b) => (
      Number(b.groupUpdatedAtMs || b.updatedAtMs || 0)
      - Number(a.groupUpdatedAtMs || a.updatedAtMs || 0)
    ));
  const arranged = [];

  for (const root of roots) {
    arranged.push(root);
    const children = childrenByParent.get(root.id) || [];
    arranged.push(...children.sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0)));
  }

  return arranged;
}

function openLabel(thread) {
  const label = String(thread?.openLabel || '打开').trim() || '打开';
  return label === '恢复' ? '打开' : label;
}

function canOpenThread(thread) {
  return Boolean(thread?.appDeepLink || thread?.canOpen);
}

function shouldOpenDeepLinkInBrowser(thread) {
  return thread?.provider === 'codex'
    && String(thread?.appDeepLink || '').startsWith('codex://');
}

function disableButtonBriefly(button, durationMs = 1200) {
  if (!button) return;
  button.disabled = true;
  window.setTimeout(() => {
    button.disabled = false;
  }, durationMs);
}

function updateNotificationLocally(notificationId, patch = {}) {
  const notifications = state.notifications || fallbackNotificationsFromDashboard(state.dashboard);
  if (!notificationId || !notifications?.items?.length) return null;

  const notification = notifications.items.find((item) => item.id === notificationId);
  if (!notification) return null;

  const currentStatus = notification.status || 'unread';
  const nextStatus = patch.status || currentStatus;
  const remainsActive = ACTIVE_NOTIFICATION_STATUSES.has(nextStatus);
  const items = remainsActive
    ? notifications.items.map((item) => (
      item.id === notificationId ? { ...item, ...patch, status: nextStatus } : item
    ))
    : notifications.items.filter((item) => item.id !== notificationId);

  const summary = notifications.summary || {};
  const nextUnreadCount = items.filter((item) => item.status === 'unread').length;
  const nextSummary = {
    ...summary,
    activeCount: items.length,
    unreadCount: nextUnreadCount,
  };
  if (nextStatus === 'done' && currentStatus !== 'done') {
    nextSummary.doneCount = Number(summary.doneCount || 0) + 1;
  }
  if (nextStatus === 'snoozed' && currentStatus !== 'snoozed') {
    nextSummary.snoozedCount = Number(summary.snoozedCount || 0) + 1;
  }

  setNotifications({
    ...notifications,
    items,
    summary: nextSummary,
  });
  renderDashboard();
  return { ...notification, ...patch, status: nextStatus };
}

function markNotificationDoneLocally(notificationId) {
  return updateNotificationLocally(notificationId, { status: 'done' });
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function statusMarkup(status) {
  const label = STATUS_LABELS[status] || status;
  return `
    <span class="status-pill status-${escapeHtml(status)}">
      <span class="status-dot" aria-hidden="true"></span>
      ${escapeHtml(label)}
    </span>
  `;
}

function renderSummary(summary) {
  const notifications = state.notifications || state.dashboard?.notifications;
  const notificationCounts = notificationBreakdown(notifications);
  const pendingCount = notificationCounts.totalCount;
  const providers = state.dashboard?.providers || summary.providers || [];
  const currentItems = [
    ...quotaSummaryCards(summary.quota),
    {
      label: '待处理',
      value: pendingCount,
      note: `${pendingCount || 0} 项需要处理`,
      tone: pendingCount > 0 ? 'attention' : '',
    },
    {
      label: '今日 token',
      value: formatTokens(summary.todayTokensUsed),
      note: `${summary.updatedToday || 0} 项任务今天更新`,
    },
    {
      label: '工作中 Agent',
      value: summary.runningThreads || 0,
      note: `${summary.runningHostThreads || 0} 个 Host 任务组`,
      tone: summary.runningThreads > 0 ? 'running' : '',
    },
  ];
  const lifetimeItems = [
    {
      label: '累计 token',
      value: formatTokens(summary.totalTokensUsed ?? summary.activeTokensUsed),
      note: '包含归档任务',
    },
    {
      label: '累计任务',
      value: summary.totalThreads,
      note: `${summary.activeThreads || 0} 项活跃任务`,
    },
    {
      label: '活跃任务',
      value: summary.activeThreads,
      note: '未归档任务',
    },
    {
      label: '已归档',
      value: summary.archivedThreads,
      note: '已收起任务',
    },
  ];

  elements.summary.innerHTML = `
    <section class="summary-section summary-section-compact" aria-labelledby="current-summary-heading">
      <div class="summary-section-heading">
        <h2 id="current-summary-heading">当前重点</h2>
        <p>quota、待处理、今日消耗、长期累计和来源接入</p>
      </div>
      <div class="summary-card-grid">
        ${currentItems.map(summaryCard).join('')}
      </div>
      <div class="summary-meta-row${providers.length ? '' : ' summary-meta-row-solo'}" aria-label="长期累计与来源接入">
        <div class="summary-lifetime-strip" aria-label="长期累计">
          <div class="summary-strip-heading">
            <span>长期累计</span>
            <small>任务与 token 总账</small>
          </div>
          <div class="summary-strip-items">
            ${lifetimeItems.map(summaryStripItem).join('')}
          </div>
        </div>
        ${renderProviderStrip(providers)}
      </div>
    </section>
  `;
}

function renderProviderFilter(providers = []) {
  const current = elements.providerFilter.value;
  elements.providerFilter.innerHTML = '<option value="all">全部来源</option>';

  for (const provider of providers) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = `${provider.label}${provider.status === 'missing' ? '（未检测到）' : ''}`;
    elements.providerFilter.append(option);
  }

  elements.providerFilter.value = [...elements.providerFilter.options].some((option) => option.value === current)
    ? current
    : 'all';
}

function renderProjectFilter(projects) {
  const current = elements.projectFilter.value;
  elements.projectFilter.innerHTML = '<option value="all">全部项目</option>';

  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.cwd;
    option.textContent = project.projectName;
    elements.projectFilter.append(option);
  }

  elements.projectFilter.value = [...elements.projectFilter.options].some((option) => option.value === current)
    ? current
    : 'all';
}

function filteredThreads() {
  if (!state.dashboard) return [];

  return [...state.dashboard.threads]
    .filter((thread) => !thread.archived)
    .sort((a, b) => (
      Number(b.groupUpdatedAtMs || b.updatedAtMs || 0)
      - Number(a.groupUpdatedAtMs || a.updatedAtMs || 0)
    ))
    .slice(0, RECENT_THREAD_LIMIT);
}

function renderThreads() {
  const threads = filteredThreads();

  elements.threadCount.textContent = `${threads.length} 项 · 最近`;

  if (!threads.length) {
    const missingProvider = state.dashboard?.providers?.find((item) => item.status === 'missing');
    elements.threads.innerHTML = missingProvider
      ? `<p class="empty-state">${escapeHtml(missingProvider.message || `${missingProvider.label} 未检测到。安装后刷新看板。`)}</p>`
      : '<p class="empty-state">暂无最近线程。</p>';
    renderDetail(null);
    return;
  }

  const arrangedThreads = arrangeThreadRows(threads);
  if (!state.selectedThreadId || !arrangedThreads.some((thread) => thread.id === state.selectedThreadId)) {
    state.selectedThreadId = arrangedThreads[0].id;
  }

  elements.threads.innerHTML = arrangedThreads.map((thread) => {
    const isSelected = thread.id === state.selectedThreadId;
    const openDisabled = canOpenThread(thread) ? '' : ' disabled';
    return `
      <article class="${threadRowClasses(thread, isSelected)}" data-thread-kind="${isSubagentThread(thread) ? 'subagent' : 'host'}">
        ${threadPrimaryModuleMarkup(thread, {
          className: 'thread-main',
          query: '',
          isSelected,
          showMeta: false,
        })}
        ${threadArtifactModuleMarkup(thread)}
        ${threadSideMarkup(thread, openDisabled)}
      </article>
    `;
  }).join('');

  renderDetail(arrangedThreads.find((thread) => thread.id === state.selectedThreadId));
}

function renderSearchResults() {
  if (!elements.searchResults) return;

  const query = currentSearchQuery();
  const threads = searchResultThreads();
  const total = Number(state.search?.result?.total ?? threads.length);
  const searchIndex = state.search?.result?.index;
  const indexed = searchIndex?.threadCount ? ` · 索引 ${searchIndex.threadCount} 条` : '';
  const loadedCount = threads.length;
  const loadMoreText = state.search.loadMoreError
    ? `加载更多失败：${state.search.loadMoreError}`
    : state.search.isLoadingMore
    ? '正在加载更多历史线程...'
    : (state.search.hasMore ? '继续向下滚动加载更多' : '已加载全部匹配线程');

  if (!query && !state.search.result) {
    elements.searchCount.textContent = '输入关键词';
    elements.searchResults.innerHTML = '<p class="empty-state search-empty-state">输入关键词后搜索全部历史线程。</p>';
    renderSearchLoadState('');
    return;
  }

  if (state.search.isLoading && !state.search.result) {
    elements.searchCount.textContent = '搜索中';
    elements.searchResults.innerHTML = '<p class="empty-state search-empty-state">正在搜索全部历史线程...</p>';
    renderSearchLoadState('');
    return;
  }

  if (state.search.error) {
    elements.searchCount.textContent = '搜索异常';
    elements.searchResults.innerHTML = `<p class="empty-state search-empty-state">搜索失败：${escapeHtml(state.search.error)}</p>`;
    renderSearchLoadState('');
    return;
  }

  const countLabel = total > loadedCount
    ? `${loadedCount} / ${total} 项${indexed}`
    : `${total} 项${indexed}`;
  elements.searchCount.textContent = state.search.isLoading ? `更新中 · ${countLabel}` : countLabel;

  if (!threads.length) {
    elements.searchResults.innerHTML = '<p class="empty-state search-empty-state">没有匹配历史线程。</p>';
    renderSearchLoadState('');
    return;
  }

  elements.searchResults.innerHTML = threads.map((thread) => searchResultRowMarkup(thread, {
    query,
    isSelected: thread.id === state.search.modalThreadId,
  })).join('');

  renderSearchLoadState(loadMoreText);
}

function renderSearchLoadState(message = '') {
  if (!elements.searchLoadSentinel) return;
  elements.searchLoadSentinel.textContent = message;
  elements.searchLoadSentinel.hidden = !message;
}

function renderNotifications(notifications) {
  const items = notifications?.items || [];
  const counts = notificationBreakdown(notifications);
  const activeCount = counts.totalCount || items.length;
  const hiddenCount = Math.max(0, items.length - INBOX_PREVIEW_LIMIT);
  const visibleItems = state.inboxExpanded ? items : items.slice(0, INBOX_PREVIEW_LIMIT);

  if (elements.inboxHeading) {
    elements.inboxHeading.textContent = '待处理';
  }

  elements.notificationCount.textContent = `${activeCount} 项`;
  elements.notificationToggle.hidden = hiddenCount === 0;
  elements.notificationToggle.textContent = state.inboxExpanded
    ? '收起'
    : `查看全部 ${activeCount} 项`;
  elements.notificationToggle.setAttribute('aria-expanded', String(state.inboxExpanded));

  if (!items.length) {
    elements.inbox.innerHTML = '<p class="empty-state">暂无待处理。</p>';
    return;
  }

  elements.inbox.innerHTML = visibleItems.map((notification) => {
    const isSoftProgress = isSoftProgressNotification(notification);
    const actionLabel = notificationDoneLabel(notification);
    return `
    <article
      class="notification-item ${notification.status === 'unread' ? 'is-unread' : ''}"
      data-notification-id="${escapeHtml(notification.id)}"
      data-notification-kind="${isSoftProgress ? 'progress' : 'action'}"
    >
      <button class="notification-main" type="button" data-thread-id="${escapeHtml(notification.threadId)}">
        <span class="reason">${escapeHtml(notificationLabel(notification))}</span>
        <span class="inbox-title">${escapeHtml(notification.threadTitle || notification.title)}</span>
        <span class="inbox-meta">
          <span>${escapeHtml(notification.projectName || '未知项目')}</span>
          <span>${escapeHtml(notificationStatusLabel(notification))}</span>
          <span>${escapeHtml(relativeTime(notification.signalAtMs))}</span>
        </span>
      </button>
      <div class="notification-actions" aria-label="${escapeHtml(notificationActionLabel(notification))}">
        <button
          class="action-button primary"
          type="button"
          data-open-thread-id="${escapeHtml(notification.threadId)}"
          data-open-notification-id="${escapeHtml(notification.id)}"
        >打开</button>
        <button class="action-button secondary" type="button" data-notification-done-id="${escapeHtml(notification.id)}">${escapeHtml(actionLabel)}</button>
      </div>
    </article>
  `;
  }).join('') + (!state.inboxExpanded && hiddenCount > 0 ? `
    <button class="inbox-more-row" type="button" data-toggle-inbox>
      还有 ${escapeHtml(hiddenCount)} 项通知
      <span>展开查看全部</span>
    </button>
  ` : '');
}

function renderProjectHistory(history) {
  const projects = history?.items || [];
  if (!projects.length) {
    elements.projects.innerHTML = state.search?.projectHistoryError
      ? `<p class="empty-state">项目历史加载失败：${escapeHtml(state.search.projectHistoryError)}</p>`
      : '<p class="empty-state">暂无项目历史。</p>';
    return;
  }

  const maxTokens = Math.max(...projects.map((project) => project.tokensUsed), 1);
  elements.projects.innerHTML = projects.slice(0, 12).map((project) => {
    const width = Math.max(3, Math.round((project.tokensUsed / maxTokens) * 100));
    return `
      <article class="project-row">
        <div>
          <div class="project-name">${escapeHtml(project.projectName)}</div>
          <div class="project-meta">
            <span>${project.threadCount} 项任务</span>
            ${Number.isFinite(Number(project.activeThreadCount)) ? `<span>${escapeHtml(project.activeThreadCount)} 活跃</span>` : ''}
            ${Number(project.archivedThreadCount || 0) > 0 ? `<span>${escapeHtml(project.archivedThreadCount)} 归档</span>` : ''}
            <span>今日 ${escapeHtml(formatTokens(project.todayTokensUsed))}</span>
            <span>历史 ${escapeHtml(formatTokens(project.tokensUsed))}</span>
            <span>${escapeHtml(relativeTime(project.latestUpdatedAtMs))}</span>
          </div>
          ${project.providers?.length ? `<div class="project-history-summary">${project.providers.map(escapeHtml).join(' · ')}</div>` : ''}
        </div>
        <div class="project-bar" aria-hidden="true" style="--value: ${width}%"><span></span></div>
      </article>
    `;
  }).join('');
}

function renderProjects(projects) {
  if (state.search?.projectHistory?.items?.length || state.search?.projectHistoryError) {
    renderProjectHistory(state.search.projectHistory);
    return;
  }

  renderProjectHistory({ items: projects });
}

function attachmentPreviewStripMarkup(value = '') {
  const imageItems = localFileMentionItems(value)
    .filter((item) => item.previewable && item.path)
    .slice(0, 3);

  if (!imageItems.length) return '';

  return `
    <div class="attachment-preview-strip" aria-label="图片附件预览">
      ${imageItems.map((item) => {
        const src = localFilePreviewUrl(item.path);
        const title = `${item.name} · ${item.type}`;
        return `
          <button
            class="attachment-thumb-button"
            type="button"
            data-preview-image-src="${escapeHtml(src)}"
            data-preview-image-title="${escapeHtml(title)}"
            aria-label="${escapeHtml(`查看原图 ${item.name}`)}"
          >
            <span class="attachment-thumb-frame" aria-hidden="true">
              <img data-preview-image-thumb src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">
              <span class="attachment-thumb-fallback" data-preview-image-fallback hidden>不可预览</span>
            </span>
            <span class="attachment-thumb-label">${escapeHtml(item.name)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function compactSignal(value = '', maxLength = 180) {
  const text = (localFileMentionSummary(value) || String(value || '')).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function localFileMentionSummary(value = '') {
  const items = localFileMentionItems(value);
  if (!items.length) return '';

  const visibleItems = items.slice(0, 3);
  const summary = visibleItems.map((item) => `${item.name} · ${item.type}`).join('；');
  const hiddenCount = items.length - visibleItems.length;
  return hiddenCount > 0 ? `${summary}；另 ${hiddenCount} 个文件` : summary;
}

function localFileMentionItems(value = '') {
  const text = String(value || '');
  if (!shouldSummarizeLocalFileMentions(text)) return [];

  const items = [];
  const seen = new Set();
  const addItem = (name, filePath = '') => {
    const fileName = localFileName(name) || localFileName(filePath);
    const cleanPath = localFilePath(filePath || name);
    const key = cleanPath || fileName;
    if (!fileName || seen.has(key)) return;
    seen.add(key);
    items.push({
      name: fileName,
      path: cleanPath,
      previewable: Boolean(cleanPath && isPreviewableImageFile(fileName)),
      type: localFileTypeLabel(fileName),
    });
  };

  const fileHeadingPattern = /##\s+([^:\n#]+?\.[A-Za-z0-9]{1,12})\s*:\s*((?:file:\/\/|~\/|\/|[A-Za-z]:[\\/])[^#\n\r]*?)(?=(?:\s+##\s)|(?:\s+#\s)|\n|$)/g;
  for (const match of text.matchAll(fileHeadingPattern)) {
    addItem(match[1], match[2]);
  }

  const imagePathPattern = /<image\b[^>]*\bpath=(["'])(.*?)\1[^>]*>/gi;
  for (const match of text.matchAll(imagePathPattern)) {
    addItem('', match[2]);
  }

  if (!items.length) {
    const standalonePathPattern = /(?:^|[\s(["'`])((?:file:\/\/|~\/|\/|[A-Za-z]:[\\/])[^"'`<>\n\r]+?\.[A-Za-z0-9]{1,12})(?=$|[\s)"'`<>])/g;
    for (const match of text.matchAll(standalonePathPattern)) {
      addItem('', match[1]);
    }
  }

  return items;
}

function shouldSummarizeLocalFileMentions(value = '') {
  const text = String(value || '');
  if (/Files mentioned by the user/i.test(text) || /<image\b/i.test(text)) return true;

  const compactText = text.replace(/\s+/g, ' ').trim();
  return /^(?:file:\/\/|~\/|\/|[A-Za-z]:[\\/]).+\.[A-Za-z0-9]{1,12}$/.test(compactText);
}

function localFileName(value = '') {
  let text = String(value || '').trim();
  if (!text) return '';

  text = text.replace(/^["'(<]+|[>"')]+$/g, '');
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the original text if it is not URL encoded.
  }
  text = text.replace(/^file:\/+/, '/').replace(/\\/g, '/').split(/[?#]/)[0];

  const parts = text.split('/').filter(Boolean);
  const fileName = parts.pop() || text;
  return /\.[A-Za-z0-9]{1,12}$/.test(fileName) ? fileName : '';
}

function localFilePath(value = '') {
  let text = String(value || '').trim();
  if (!text) return '';

  text = text.replace(/^["'(<]+|[>"')]+$/g, '');
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the original text if it is not URL encoded.
  }
  text = text.replace(/^file:\/+/, '/').replace(/\\/g, '/').split(/[?#]/)[0];
  return /^(?:~\/|\/|[A-Za-z]:\/)/.test(text) ? text : '';
}

function isPreviewableImageFile(fileName = '') {
  const extension = (String(fileName).match(/\.([A-Za-z0-9]{1,12})$/)?.[1] || '').toLowerCase();
  return ['bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'].includes(extension);
}

function localFilePreviewUrl(filePath = '') {
  return `/api/local-file-preview?path=${encodeURIComponent(filePath)}`;
}

function markAttachmentPreviewUnavailable(image) {
  const button = image?.closest?.('.attachment-thumb-button');
  if (!button) return;

  const fallback = button.querySelector('[data-preview-image-fallback]');
  image.hidden = true;
  image.removeAttribute('src');
  button.classList.add('is-unavailable');
  button.disabled = true;
  button.removeAttribute('data-preview-image-src');
  button.setAttribute('aria-label', `${button.dataset.previewImageTitle || '图片'} 暂不可预览`);
  if (fallback) fallback.hidden = false;
}

function markArtifactImagePreviewUnavailable(image) {
  const frame = image?.closest?.('.artifact-poster, .artifact-timeline-thumb, .artifact-detail-preview');
  if (!frame) return;

  const fallback = frame.querySelector('[data-artifact-preview-fallback]');
  image.hidden = true;
  image.removeAttribute('src');
  frame.classList.add('is-unavailable');
  if (fallback) fallback.hidden = false;
}

function localFileExtension(fileName = '') {
  const cleanName = String(fileName || '').split(/[?#]/)[0];
  const match = cleanName.match(/\.([A-Za-z0-9]{1,12})$/);
  return match ? match[1].toLowerCase() : '';
}

function localFileTypeLabel(fileName = '') {
  const extension = localFileExtension(fileName);
  if (!extension) return '文件';

  if (['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'].includes(extension)) return '图片';
  if (extension === 'pdf') return 'PDF';
  if (['md', 'markdown', 'mdx'].includes(extension)) return 'Markdown';
  if (['doc', 'docx', 'pages', 'rtf'].includes(extension)) return '文档';
  if (['csv', 'numbers', 'xls', 'xlsx'].includes(extension)) return '表格';
  if (['key', 'ppt', 'pptx'].includes(extension)) return '演示文稿';
  if (['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'].includes(extension)) return '视频';
  if (['aac', 'aiff', 'flac', 'm4a', 'mp3', 'wav'].includes(extension)) return '音频';
  if (['zip', 'gz', 'rar', 'tar', 'tgz', '7z'].includes(extension)) return '压缩包';
  if (['txt', 'log'].includes(extension)) return '文本';
  if (['css', 'go', 'html', 'java', 'js', 'json', 'jsx', 'mjs', 'py', 'rs', 'sh', 'ts', 'tsx', 'xml', 'yaml', 'yml'].includes(extension)) return '代码';
  return extension.toUpperCase();
}

function artifactItems(thread) {
  return Array.isArray(thread?.artifacts?.items) ? thread.artifacts.items : [];
}

function artifactTotal(thread) {
  return Number(thread?.artifacts?.total || artifactItems(thread).length || 0);
}

function artifactTypeLabel(item = {}) {
  if (item.typeLabel) return item.typeLabel;
  if (item.type === 'image') return '图片';
  if (item.type === 'html') return 'HTML';
  if (item.type === 'markdown') return 'Markdown';
  if (item.type === 'link') return 'URL';
  return localFileTypeLabel(item.title || item.path || item.url || '') || '文件';
}

function artifactSourceLabel(source = '') {
  return source === 'agent' ? 'Agent' : '用户';
}

function artifactDisplayTitle(item = {}) {
  return item.title || item.name || item.url || artifactTypeLabel(item);
}

function artifactPosterGlyph(item = {}) {
  const extension = String(item.extension || localFileExtension(item.title || item.path || item.url) || '').toUpperCase();
  if (item.type === 'image') return extension ? extension.slice(0, 4) : 'IMG';
  if (item.type === 'html') return 'HTML';
  if (item.type === 'markdown') return 'MD';
  if (item.type === 'link') return 'URL';
  return extension ? extension.slice(0, 4) : 'FILE';
}

function artifactIconKind(item = {}) {
  const extension = String(item.extension || localFileExtension(item.title || item.path || item.url) || '').toLowerCase();
  if (item.type === 'image' || ['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp'].includes(extension)) return 'image';
  if (item.type === 'link') return 'link';
  if (item.type === 'html' || ['htm', 'html'].includes(extension)) return 'html';
  if (item.type === 'markdown' || ['md', 'markdown', 'mdx'].includes(extension)) return 'markdown';
  if (extension === 'pdf') return 'pdf';
  if (['doc', 'docx', 'pages', 'rtf'].includes(extension)) return 'document';
  if (['csv', 'numbers', 'xls', 'xlsx'].includes(extension)) return 'spreadsheet';
  if (['key', 'ppt', 'pptx'].includes(extension)) return 'presentation';
  if (['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'].includes(extension)) return 'video';
  if (['aac', 'aiff', 'flac', 'm4a', 'mp3', 'wav'].includes(extension)) return 'audio';
  if (['zip', 'gz', 'rar', 'tar', 'tgz', '7z'].includes(extension)) return 'archive';
  if (['txt', 'log'].includes(extension)) return 'text';
  if (['css', 'go', 'java', 'js', 'json', 'jsx', 'mjs', 'py', 'rs', 'sh', 'ts', 'tsx', 'xml', 'yaml', 'yml'].includes(extension)) return 'code';
  return 'file';
}

function artifactIconSvg(kind = 'file') {
  const paths = {
    image: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="8" cy="10" r="1.5"></circle><path d="m4 17 5-5 4 4 2-2 5 5"></path>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"></path>',
    html: '<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="m10 9-3 3 3 3"></path><path d="m14 9 3 3-3 3"></path>',
    markdown: '<path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"></path><path d="M7 15V9l3 3 3-3v6"></path><path d="M16 9v6"></path><path d="m14 13 2 2 2-2"></path>',
    pdf: '<path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M14 3v5h5"></path><path d="M8 13h8"></path><path d="M8 17h5"></path>',
    document: '<path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M14 3v5h5"></path><path d="M8 12h8"></path><path d="M8 16h8"></path>',
    spreadsheet: '<rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M4 10h16"></path><path d="M4 15h16"></path><path d="M10 4v16"></path><path d="M15 4v16"></path>',
    presentation: '<rect x="4" y="5" width="16" height="11" rx="2"></rect><path d="M12 16v4"></path><path d="M8 20h8"></path><path d="M9 12l2-2 2 2 3-4"></path>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m10 9 5 3-5 3V9Z"></path>',
    audio: '<path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle>',
    archive: '<path d="M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"></path><path d="M4 7l2-4h12l2 4"></path><path d="M9 11h6"></path>',
    text: '<path d="M7 3h10a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path>',
    code: '<path d="m9 8-4 4 4 4"></path><path d="m15 8 4 4-4 4"></path><path d="m13 5-2 14"></path>',
    file: '<path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M14 3v5h5"></path>',
  };

  return `<svg class="artifact-type-icon-svg" aria-hidden="true" viewBox="0 0 24 24" fill="none" focusable="false">${paths[kind] || paths.file}</svg>`;
}

function artifactTypeIconMarkup(item = {}, attributes = '') {
  const kind = artifactIconKind(item);
  const glyph = artifactPosterGlyph(item);
  const attributeText = attributes ? ` ${attributes}` : '';
  return `
    <span class="artifact-type-icon is-${kind}"${attributeText} aria-hidden="true">
      ${artifactIconSvg(kind)}
      <span class="artifact-type-icon-label">${escapeHtml(glyph)}</span>
    </span>
  `;
}

function artifactPreviewImageSrc(item = {}) {
  if (item.type !== 'image' || !item.path) return '';
  return localFilePreviewUrl(item.path);
}

function artifactPosterMarkup(item = {}, index = 0) {
  const title = artifactDisplayTitle(item);
  const src = artifactPreviewImageSrc(item);
  return `
    <span class="artifact-poster" style="--poster-index: ${index}" title="${escapeHtml(`${title} · ${artifactTypeLabel(item)}`)}">
      ${src
        ? `<img data-artifact-preview-image src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">${artifactTypeIconMarkup(item, 'data-artifact-preview-fallback hidden')}`
        : artifactTypeIconMarkup(item)}
    </span>
  `;
}

function artifactPosterStackMarkup(items = [], total = items.length) {
  const visibleItems = items.slice(0, 3);
  if (!visibleItems.length) {
    return `<span class="artifact-empty-poster" aria-hidden="true">${artifactTypeIconMarkup({})}</span>`;
  }

  return `
    <span class="artifact-poster-stack" aria-hidden="true">
      ${visibleItems.map((item, index) => artifactPosterMarkup(item, index)).join('')}
      ${total > visibleItems.length ? `<span class="artifact-count-badge">+${escapeHtml(total - visibleItems.length)}</span>` : ''}
    </span>
  `;
}

function threadArtifactModuleMarkup(thread) {
  const total = artifactTotal(thread);
  if (!total) return '';

  const items = artifactItems(thread);
  const firstItem = items[0] || {};
  const isSingle = total === 1 && firstItem.id;
  const actionAttributes = isSingle
    ? `data-open-artifact-detail-id="${escapeHtml(firstItem.id)}" data-artifact-thread-id="${escapeHtml(thread.id)}"`
    : `data-open-artifact-timeline-id="${escapeHtml(thread.id)}"`;
  const label = total === 1
    ? `${artifactTypeLabel(firstItem)} · ${artifactDisplayTitle(firstItem)}`
    : `${total} 项素材`;

  return `
    <button class="thread-artifact-module" type="button" ${actionAttributes} aria-label="${escapeHtml(`查看${label}`)}">
      ${artifactPosterStackMarkup(items, total)}
      <span class="thread-artifact-copy">
        <span>素材</span>
        <strong>${escapeHtml(total === 1 ? artifactTypeLabel(firstItem) : `${total} 项`)}</strong>
        <small>${escapeHtml(total === 1 ? artifactDisplayTitle(firstItem) : '图片 / 文件 / URL')}</small>
      </span>
    </button>
  `;
}

function formatTimestamp(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '-';
  return `${relativeTime(value)} · ${timeFormat.format(new Date(value))}`;
}

function mergeThreadItems(...groups) {
  const seen = new Set();
  const items = [];

  for (const group of groups) {
    if (!Array.isArray(group)) continue;

    for (const item of group) {
      const key = typeof item === 'object' && item
        ? `${item.id || ''}:${item.title || item.tool || item.name || ''}:${item.status || ''}`
        : String(item || '');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  return items;
}

function threadPendingTools(thread) {
  return mergeThreadItems(thread?.pendingTools, thread?.openCodePendingTools);
}

function isOpenTodo(todo) {
  return !CLOSED_TODO_STATUSES.has(String(todo?.status || '').toLowerCase());
}

function threadOpenTodos(thread) {
  return mergeThreadItems(thread?.todos, thread?.openCodeTodos).filter(isOpenTodo);
}

function threadNotifications(thread) {
  const closedStatuses = new Set(['done', 'dismissed']);
  return (state.notifications?.items || [])
    .filter((notification) => (
      notification.threadId === thread.id
      && !closedStatuses.has(String(notification.status || '').toLowerCase())
    ));
}

function hasPermissionSignal(thread, pendingTools, notifications) {
  return Boolean(
    thread.awaitingPermission
    || pendingTools.length
    || Number(thread.pendingToolCount || thread.openCodePendingToolCount || 0) > 0
    || notifications.some((notification) => (
      notification.type === 'AWAITING_PERMISSION'
      || String(notification.source || '').includes('permission')
    )),
  );
}

function hasReviewSignal(thread, notifications) {
  return Boolean(
    thread.hasUnreadTurn
    || thread.awaitingReview
    || notifications.some((notification) => (
      notification.type === 'AWAITING_REVIEW'
      || ['codex-unread', 'observed-completion'].includes(notification.source)
    )),
  );
}

function itemLabel(item, fallback) {
  if (typeof item === 'string') return compactSignal(item, 96);
  return compactSignal(item?.title || item?.tool || item?.name || item?.id || fallback, 96);
}

function renderDetailList(items, emptyText) {
  if (!items.length) {
    return `<p class="detail-note">${escapeHtml(emptyText)}</p>`;
  }

  return `
    <div class="detail-signal-list">
      ${items.map((item) => `
        <div class="detail-signal-item">
          <span class="detail-signal-label">${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          ${item.note ? `<span class="detail-signal-note">${escapeHtml(item.note)}</span>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function tokenField(usage, names) {
  for (const name of names) {
    const value = Number(usage?.[name]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function lastTokenUsageLabel(usage) {
  if (!usage) return '-';

  const total = tokenField(usage, ['total_tokens', 'totalTokens']);
  const parts = [
    ['输入', tokenField(usage, ['input_tokens', 'inputTokens'])],
    ['输出', tokenField(usage, ['output_tokens', 'outputTokens'])],
    ['推理', tokenField(usage, ['reasoning_output_tokens', 'reasoning_tokens', 'reasoningTokens'])],
    ['缓存', tokenField(usage, ['cached_input_tokens', 'cache_read_input_tokens', 'cachedInputTokens'])],
  ].filter(([, value]) => value > 0);

  if (!total && !parts.length) return '-';
  const main = total ? formatTokens(total) : formatTokens(parts.reduce((sum, [, value]) => sum + value, 0));
  if (!parts.length) return main;
  return `${main} · ${parts.map(([label, value]) => `${label} ${formatTokens(value)}`).join(' / ')}`;
}

function threadPhaseLabel(thread, pendingTools, notifications) {
  if (thread.status === 'running') return '当前轮运行中';
  if (hasPermissionSignal(thread, pendingTools, notifications)) return '等待授权处理';
  if (hasReviewSignal(thread, notifications)) return '等待验收或新进展';
  return STATUS_LABELS[thread.status] || thread.status || '未知阶段';
}

function recentUserSignal(thread) {
  return compactSignal(
    thread.latestMeaningfulUserMessage
    || thread.latestUserMessage
    || thread.firstUserMessage
    || '',
  );
}

function recentAgentSignal(thread) {
  return compactSignal(thread.lastAgentMessage || '');
}

function relationshipSummaryLine(thread) {
  if (isSubagentThread(thread)) {
    const parts = ['Sub Agent'];
    const roleLabel = subagentRoleLabel(thread);
    const host = hostThreadLabel(thread);
    if (roleLabel) parts.push(roleLabel);
    if (host) parts.push(`Host: ${host}`);
    return parts.join(' · ');
  }

  const count = Number(thread?.subagentCount || 0);
  return count > 0 ? `Host Agent · ${count} 个 Sub Agent` : '';
}

function relationshipDetailCellMarkup(thread) {
  const relation = relationshipSummaryLine(thread);
  if (!relation) return '';

  return `
    <div class="detail-cell detail-cell-wide">
      <span>关系</span>
      <strong>${escapeHtml(relation)}</strong>
    </div>
  `;
}

function buildThreadSummary(thread) {
  const pendingTools = threadPendingTools(thread);
  const openTodos = threadOpenTodos(thread);
  const notifications = threadNotifications(thread);
  const turnDuration = currentTurnDuration(thread);
  const permissionSignal = hasPermissionSignal(thread, pendingTools, notifications);
  const reviewSignal = hasReviewSignal(thread, notifications);
  const pendingLines = [];

  if (permissionSignal) {
    pendingLines.push(`- 等待授权: ${pendingTools.length ? pendingTools.map((tool) => itemLabel(tool, '工具调用')).slice(0, 5).join('、') : '有权限处理信号'}`);
  }
  if (openTodos.length) {
    pendingLines.push(`- 未完成 todo: ${openTodos.length} 项，${openTodos.map((todo) => itemLabel(todo, 'todo')).slice(0, 5).join('、')}`);
  }
  if (reviewSignal) {
    pendingLines.push('- 等待验收或新进展: 有待处理信号');
  }
  if (!pendingLines.length) pendingLines.push('- 暂无明确待处理信号');

  return [
    'Agent Mission Control 任务摘要',
    '用途：粘给新的 Codex 任务接手；只含本地元数据和截断信号，不含完整内容。',
    '',
    '状态摘要:',
    `- 任务: ${displayThreadTitle(thread)}`,
    `- 来源: ${providerLabel(thread)}`,
    `- 阶段: ${threadPhaseLabel(thread, pendingTools, notifications)}`,
    `- 状态: ${STATUS_LABELS[thread.status] || thread.status || '-'}`,
    `- 关系: ${relationshipSummaryLine(thread) || '-'}`,
    `- 项目: ${thread.projectName || '未知项目'}`,
    `- 模型: ${thread.model || '未知模型'}`,
    `- 最近更新: ${formatTimestamp(thread.updatedAtMs)}`,
    `- 本轮耗时: ${turnDuration || '-'}`,
    '',
    '待处理:',
    ...pendingLines,
    '',
    'token:',
    `- 今日 token: ${formatTokens(thread.todayTokenUsage)}`,
    `- 历史 token: ${formatTokens(thread.tokensUsed)}`,
    `- 最近一轮: ${lastTokenUsageLabel(thread.lastTokenUsage)}`,
    '',
    '恢复证据:',
    `- cwd: ${thread.cwd || '-'}`,
    `- rollout path: ${thread.rolloutPath || '-'}`,
    `- deep link: ${thread.appDeepLink || '-'}`,
    `- resume 命令: ${resumeCommandForThread(thread) || '-'}`,
    '',
    '最近信号（截断）:',
    `- 用户输入信号: ${recentUserSignal(thread) || '-'}`,
    `- Agent 输出信号: ${recentAgentSignal(thread) || '-'}`,
    '',
    '接手建议:',
    '- 先打开确认上下文。',
    '- 优先处理待授权、未完成 todo、等待验收或新进展。',
    '- 不要把这份摘要当作完整内容。',
  ].join('\n');
}

function reviewJobsForThread(threadId) {
  return state.review.jobsByThread.get(threadId) || [];
}

function reviewContentKey(threadId, mode) {
  return `${threadId}:${mode}`;
}

function selectedReviewInputMode(threadId) {
  const thread = findThread(threadId);
  const selected = state.review.inputModeByThread.get(threadId) || 'latest-agent-signal';
  return reviewInputModesForThread(thread).some(([id]) => id === selected) ? selected : 'latest-agent-signal';
}

function reviewContentForThread(threadId, mode = selectedReviewInputMode(threadId)) {
  return state.review.contentByThread.get(reviewContentKey(threadId, mode)) || null;
}

function reviewContentErrorForThread(threadId, mode = selectedReviewInputMode(threadId)) {
  return state.review.contentErrorsByThread.get(reviewContentKey(threadId, mode)) || '';
}

function selectedReviewTargetProvider(threadId) {
  const selected = state.review.targetProviderByThread.get(threadId) || '';
  const items = state.review.targets?.items || [];
  if (selected && items.some((target) => target.provider === selected && target.available)) return selected;
  return items.find((target) => target.available)?.provider || selected;
}

function hasRunningReviewJob(threadId) {
  return reviewJobsForThread(threadId).some((job) => job.status === 'running' || job.status === 'queued');
}

function reviewStatusLabel(status) {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '评审中';
  if (status === 'succeeded') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return status || '未知';
}

function fixLoopStatusLabel(status) {
  if (status === 'prompt-copied') return '已复制修复 Prompt';
  if (status === 'source-opened') return '已回源线程';
  if (status === 'applied') return '已处理';
  if (status === 'dismissed') return '不采纳';
  return '尚未处理';
}

function fixLoopFilterLabel(filter) {
  if (filter === 'pending') return '待修复';
  if (filter === 'applied') return '已处理';
  if (filter === 'dismissed') return '不采纳';
  return '全部';
}

function selectedReviewFixLoopFilter(threadId) {
  const selected = state.review.fixLoopFilterByThread.get(threadId) || 'all';
  return ['all', 'pending', 'applied', 'dismissed'].includes(selected) ? selected : 'all';
}

function reviewFixLoopFilterTabs(threadId, selected = 'all') {
  return ['all', 'pending', 'applied', 'dismissed'].map((filter) => (
    `<button class="review-filter-tab${filter === selected ? ' is-selected' : ''}" type="button" data-review-fix-filter-thread-id="${escapeHtml(threadId)}" data-review-fix-filter="${escapeHtml(filter)}">${escapeHtml(fixLoopFilterLabel(filter))}</button>`
  )).join('');
}

function isPendingFixLoopJob(job) {
  if (job.status !== 'succeeded') return false;
  const status = job.fixLoop?.status || 'not-started';
  return status !== 'applied' && status !== 'dismissed';
}

function filterReviewJobsByFixLoop(jobs, filter = 'all') {
  if (filter === 'pending') return jobs.filter(isPendingFixLoopJob);
  if (filter === 'applied') return jobs.filter((job) => job.fixLoop?.status === 'applied');
  if (filter === 'dismissed') return jobs.filter((job) => job.fixLoop?.status === 'dismissed');
  return jobs;
}

function reviewTemplateOptions(selected = 'technical-review') {
  return REVIEW_TEMPLATES.map(([id, label]) => (
    `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

function selectedReviewTemplate(threadId) {
  const selected = state.review.templateByThread.get(threadId) || 'technical-review';
  return REVIEW_TEMPLATES.some(([id]) => id === selected) ? selected : 'technical-review';
}

function isCodexReviewThread(thread = {}) {
  const provider = String(thread.provider || thread.source || '').toLowerCase();
  return provider === 'codex' || provider === 'codex-cli' || provider === '';
}

function reviewInputModesForThread(thread = {}) {
  if (isCodexReviewThread(thread)) return REVIEW_INPUT_MODES;
  return REVIEW_INPUT_MODES.filter(([id]) => id !== 'latest-turn');
}

function reviewInputModeOptions(selected = 'latest-agent-signal', thread = {}) {
  return reviewInputModesForThread(thread).map(([id, label]) => (
    `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

function reviewInputPrivacyHint(mode) {
  if (mode === 'latest-turn') {
    return '最近一轮会读取并发送更多本地会话内容给目标 CLI Agent。';
  }
  if (mode === 'thread-summary') {
    return '线程摘要会发送标准线程字段和最近输出信号给目标 CLI Agent。';
  }
  return '评审只会发送当前预览里的最近 Agent 输出，不会读取完整内容，也不会直接修改源代码，请放心评审。';
}

function reviewTargetOptions(targets, selectedProvider = '') {
  const items = targets?.items || [];
  if (!items.length) return '<option value="">正在检测目标 Agent</option>';
  const selected = selectedProvider || items.find((target) => target.available)?.provider || '';

  return items.map((target) => `
    <option value="${escapeHtml(target.provider)}"${target.provider === selected ? ' selected' : ''}${target.available ? '' : ' disabled'}>
      ${escapeHtml(target.label || target.provider)}${target.available ? '' : '（不可用）'}
    </option>
  `).join('');
}

function selectedReviewTarget(threadId) {
  const provider = selectedReviewTargetProvider(threadId);
  return (state.review.targets?.items || []).find((target) => target.provider === provider) || null;
}

function reviewTargetCapabilitySummary(target = {}) {
  const capabilities = target?.capabilities || {};
  const repoAccess = capabilities.repoAccess;
  const writeProtection = capabilities.writeProtection;

  if (repoAccess === 'readonly' && writeProtection === 'sandbox-readonly') return '可读 repo · 只读沙盒';
  if (repoAccess === 'readonly' && writeProtection === 'write-tools-denied') return '可读 repo · 禁写工具';
  if (repoAccess === 'prompt-guarded') return '可读 repo · Prompt 禁写';
  if (repoAccess === 'text-only') return '仅文本评审';
  return '';
}

function buildReviewDebugSummary(job) {
  return [
    'Agent Mission Control 评审调试摘要',
    '用途：排查本地 review job；不包含完整 prompt 或评审正文。',
    '',
    `- job: ${job.id || '-'}`,
    `- 状态: ${reviewStatusLabel(job.status)}`,
    `- 来源: ${job.source?.providerLabel || job.source?.provider || '-'} / ${job.source?.title || '-'}`,
    `- 目标: ${job.target?.label || job.target?.provider || '-'}`,
    `- runner: ${job.target?.runner || '-'}`,
    `- 模型: ${job.target?.model || '-'}`,
    `- 模板: ${job.templateId || '-'}`,
    `- 输入模式: ${job.inputMode || '-'}`,
    `- startedAt: ${formatTimestamp(job.startedAtMs)}`,
    `- completedAt: ${formatTimestamp(job.completedAtMs)}`,
    `- exitCode: ${job.exitCode ?? '-'}`,
    `- timedOut: ${job.timedOut ? 'yes' : 'no'}`,
    `- truncatedResult: ${job.truncatedResult ? 'yes' : 'no'}`,
    `- error: ${job.error || '-'}`,
    `- stderr: ${job.stderr || '-'}`,
  ].join('\n');
}

function buildReviewFixPrompt(job) {
  return [
    '请根据下面的评审结果修复当前线程中的工作。',
    '',
    '这条 Prompt 会粘贴回源线程继续执行。请基于当前线程已有上下文、项目文件和下面的评审结果完成修复。',
    '',
    '评审上下文：',
    `- 评审 job: ${job.id || '-'}`,
    `- 源 Agent: ${job.source?.providerLabel || job.source?.provider || '-'}`,
    `- 源线程: ${job.source?.title || '-'}`,
    `- 源线程 ID: ${job.source?.threadId || '-'}`,
    `- 项目: ${job.source?.projectName || job.source?.cwd || '-'}`,
    `- 评审 Agent: ${job.target?.label || job.target?.provider || '-'}`,
    `- 评审模板: ${job.templateId || '-'}`,
    `- 输入模式: ${job.inputMode || '-'}`,
    '',
    '修复约束：',
    '- 先阅读相关文件和现有实现，不要凭空修改。',
    '- 只处理评审中明确指出的问题，避免无关重构。',
    '- 保持当前分支和用户已有改动，不要 reset 或回滚他人修改。',
    '- 修改后运行相关测试；如果无法运行，说明原因。',
    '- 不要 push，不要创建 PR，除非用户明确要求。',
    '- 不要假设这里包含完整线程历史；如果需要更多上下文，请先查看当前项目和源线程已有内容。',
    '',
    '评审意见：',
    job.resultText || job.resultPreview || '-',
    '',
    '请输出：',
    '1. 你接受哪些评审意见，哪些不接受，并说明原因。',
    '2. 你实际修改或建议修改的内容。',
    '3. 已运行或建议运行的验证命令。',
    '4. 仍需人工确认的部分。',
  ].join('\n');
}

function renderReviewJobDetail(job) {
  if (!job) return '';

  return `
    <article class="review-job-detail" aria-labelledby="review-job-detail-heading">
      <div class="review-results-heading">
        <div>
          <h4 id="review-job-detail-heading">评审结果详情</h4>
          <p class="detail-note">${escapeHtml(job.id || '')}</p>
        </div>
        <button class="action-button secondary" type="button" data-close-review-detail-id="${escapeHtml(job.source?.threadId || '')}">关闭详情</button>
      </div>
      <div class="detail-grid detail-grid-compact">
        <div class="detail-cell">
          <span>状态</span>
          <strong>${escapeHtml(reviewStatusLabel(job.status))}</strong>
        </div>
        <div class="detail-cell">
          <span>来源</span>
          <strong>${escapeHtml(job.source?.providerLabel || job.source?.provider || '-')}</strong>
        </div>
        <div class="detail-cell">
          <span>源线程</span>
          <strong>${escapeHtml(job.source?.title || '-')}</strong>
        </div>
        <div class="detail-cell">
          <span>目标 Agent</span>
          <strong>${escapeHtml(job.target?.label || job.target?.provider || '-')}</strong>
        </div>
        <div class="detail-cell">
          <span>模板</span>
          <strong>${escapeHtml(job.templateId || '-')}</strong>
        </div>
        <div class="detail-cell">
          <span>输入模式</span>
          <strong>${escapeHtml(job.inputMode || '-')}</strong>
        </div>
        <div class="detail-cell">
          <span>开始</span>
          <strong>${escapeHtml(formatTimestamp(job.startedAtMs))}</strong>
        </div>
        <div class="detail-cell">
          <span>完成</span>
          <strong>${escapeHtml(formatTimestamp(job.completedAtMs))}</strong>
        </div>
        <div class="detail-cell">
          <span>修复状态</span>
          <strong>${escapeHtml(fixLoopStatusLabel(job.fixLoop?.status))}</strong>
        </div>
      </div>
      ${job.error ? `<p class="review-error">${escapeHtml(job.error)}</p>` : ''}
      <div class="review-preview">
        <h5>输入预览</h5>
        <pre>${escapeHtml(job.inputPreview || '暂无输入预览')}</pre>
      </div>
      <div class="review-preview">
        <h5>评审结果</h5>
        <pre>${escapeHtml(job.resultText || job.resultPreview || '暂无评审结果')}</pre>
      </div>
      <div class="detail-actions">
        <button class="action-button secondary" type="button" data-copy-review-id="${escapeHtml(job.id)}"${job.resultText ? '' : ' disabled'}>复制评审结果</button>
        <button class="action-button secondary" type="button" data-copy-review-fix-id="${escapeHtml(job.id)}"${job.resultText || job.resultPreview ? '' : ' disabled'}>复制修复 Prompt</button>
        <button class="action-button secondary" type="button" data-copy-open-review-fix-id="${escapeHtml(job.id)}"${(job.resultText || job.resultPreview) && job.source?.threadId ? '' : ' disabled'}>复制并打开源线程</button>
        <button class="action-button secondary" type="button" data-review-fix-status-id="${escapeHtml(job.id)}" data-review-fix-status="applied"${job.resultText || job.resultPreview ? '' : ' disabled'}>标记已处理</button>
        <button class="action-button secondary" type="button" data-review-fix-status-id="${escapeHtml(job.id)}" data-review-fix-status="dismissed"${job.resultText || job.resultPreview ? '' : ' disabled'}>标记不采纳</button>
        <button class="action-button secondary" type="button" data-copy-review-debug-id="${escapeHtml(job.id)}">复制调试摘要</button>
        <button class="action-button secondary" type="button" data-open-thread-id="${escapeHtml(job.source?.threadId || '')}"${job.source?.threadId ? '' : ' disabled'}>打开源线程</button>
      </div>
    </article>
  `;
}

function renderReviewJobs(jobs, selectedJobId = '', fixLoopFilter = 'all') {
  const visibleJobs = filterReviewJobsByFixLoop(jobs, fixLoopFilter);
  if (!visibleJobs.length) {
    return `<p class="empty-state compact">${fixLoopFilter === 'all' ? '暂无评审记录。' : `暂无${fixLoopFilterLabel(fixLoopFilter)}记录。`}</p>`;
  }

  return `
    <div class="review-job-list">
      ${visibleJobs.map((job) => `
        <article class="review-job${job.id === selectedJobId ? ' is-selected' : ''}" data-review-status="${escapeHtml(job.status)}" data-review-fix-status="${escapeHtml(job.fixLoop?.status || 'not-started')}">
          <div class="review-job-heading">
            <strong>${escapeHtml(reviewStatusLabel(job.status))}</strong>
            <span>${escapeHtml(job.target?.label || job.target?.provider || 'Agent')}</span>
          </div>
          <p class="review-job-meta">${escapeHtml(job.templateId || '-')} · ${escapeHtml(fixLoopStatusLabel(job.fixLoop?.status))} · ${escapeHtml(formatTimestamp(job.completedAtMs || job.startedAtMs))}</p>
          ${job.error ? `<p class="review-error">${escapeHtml(job.error)}</p>` : ''}
          ${job.resultPreview ? `<pre>${escapeHtml(job.resultPreview)}</pre>` : ''}
          ${job.stderr && job.status === 'failed' ? `<p class="detail-note">stderr: ${escapeHtml(job.stderr)}</p>` : ''}
          <div class="detail-actions">
            <button class="action-button secondary" type="button" data-open-review-detail-id="${escapeHtml(job.id)}" data-review-detail-thread-id="${escapeHtml(job.source?.threadId || '')}">查看详情</button>
            <button class="action-button secondary" type="button" data-copy-review-id="${escapeHtml(job.id)}"${job.resultText ? '' : ' disabled'}>复制评审结果</button>
            <button class="action-button secondary" type="button" data-copy-review-fix-id="${escapeHtml(job.id)}"${job.resultText || job.resultPreview ? '' : ' disabled'}>复制修复 Prompt</button>
            <button class="action-button secondary" type="button" data-copy-review-debug-id="${escapeHtml(job.id)}">复制调试摘要</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderReviewPanel(thread) {
  if (state.review.openThreadId !== thread.id) return '';

  const targets = state.review.targets;
  const inputMode = selectedReviewInputMode(thread.id);
  const content = reviewContentForThread(thread.id, inputMode);
  const contentError = reviewContentErrorForThread(thread.id, inputMode);
  const jobs = reviewJobsForThread(thread.id);
  const isLoading = state.review.isLoading;
  const selectedTargetProvider = selectedReviewTargetProvider(thread.id);
  const target = selectedReviewTarget(thread.id);
  const targetOptions = reviewTargetOptions(targets, selectedTargetProvider);
  const targetReady = Boolean(targets?.items?.some((target) => target.available));
  const contentReady = Boolean(content?.preview);
  const selectedJobId = state.review.selectedJobIdByThread.get(thread.id) || '';
  const fixLoopFilter = selectedReviewFixLoopFilter(thread.id);
  const visibleJobs = filterReviewJobsByFixLoop(jobs, fixLoopFilter);
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId) || null;
  const selectedTemplate = selectedReviewTemplate(thread.id);
  const customInstruction = state.review.customInstructionByThread.get(thread.id) || '';
  const targetCapability = reviewTargetCapabilitySummary(target);
  const emptyFieldHelper = '<small class="review-field-helper" aria-hidden="true">&nbsp;</small>';
  const targetCapabilityHelper = targetCapability
    ? `<small class="review-field-helper review-target-capability">${escapeHtml(targetCapability)}</small>`
    : emptyFieldHelper;

  return `
    <section class="detail-section detail-section-wide review-panel" aria-labelledby="review-panel-heading">
      <div class="detail-section-heading">
        <h3 id="review-panel-heading">交给另一个 Agent 评审</h3>
        <p>${escapeHtml(reviewInputPrivacyHint(inputMode))}</p>
      </div>
      <form class="review-form" data-review-form-thread-id="${escapeHtml(thread.id)}">
        <label class="review-field">
          <span>评审输入</span>
          <select name="inputMode" data-review-input-mode-id="${escapeHtml(thread.id)}">${reviewInputModeOptions(inputMode, thread)}</select>
          ${emptyFieldHelper}
        </label>
        <label class="review-field">
          <span>目标 Agent</span>
          <select name="targetProvider" data-review-target-provider-id="${escapeHtml(thread.id)}"${targetReady ? '' : ' disabled'}>${targetOptions}</select>
          ${targetCapabilityHelper}
        </label>
        <label class="review-field">
          <span>评审模板</span>
          <select name="templateId" data-review-template-id="${escapeHtml(thread.id)}">${reviewTemplateOptions(selectedTemplate)}</select>
          ${emptyFieldHelper}
        </label>
        <label class="review-field">
          <span>目标模型</span>
          <input name="targetModel" type="text" autocomplete="off" placeholder="可选，例如 sonnet">
          ${emptyFieldHelper}
        </label>
        ${selectedTemplate === 'custom-review' ? `
          <label class="review-custom-instruction">
            <span>自定义审查</span>
            <textarea name="customReviewInstruction" rows="4" data-review-custom-instruction-id="${escapeHtml(thread.id)}" placeholder="例如：只检查是否存在跨线程串台、状态刷新覆盖、隐私泄露风险。">${escapeHtml(customInstruction)}</textarea>
          </label>
        ` : ''}
        <div class="review-preview">
          <span>输入预览</span>
          <pre>${escapeHtml(content?.preview || contentError || (isLoading ? '正在读取评审输入...' : '暂无可评审的 Agent 输出'))}</pre>
        </div>
        <div class="detail-actions">
          <button class="action-button primary" type="submit"${targetReady && contentReady && !isLoading ? '' : ' disabled'}>开始评审</button>
        </div>
      </form>
      <div class="review-results-divider" aria-hidden="true"></div>
      <div class="review-results">
        <div class="review-results-heading">
          <div>
            <strong>评审记录</strong>
            <p>左侧是当前线程的历史评审，右侧显示选中记录的完整详情。</p>
          </div>
          <button class="action-button secondary" type="button" data-refresh-review-jobs-id="${escapeHtml(thread.id)}">刷新</button>
        </div>
        <div class="review-filter-tabs" role="group" aria-label="Fix Loop 状态筛选">
          ${reviewFixLoopFilterTabs(thread.id, fixLoopFilter)}
        </div>
        <div class="review-results-layout">
          <aside class="review-records-column" aria-label="评审记录列表">
            ${renderReviewJobs(jobs, selectedJobId, fixLoopFilter)}
          </aside>
          <div class="review-detail-column" aria-live="polite">
            ${selectedJob ? renderReviewJobDetail(selectedJob) : '<p class="empty-state compact">选择左侧记录查看详情。</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function threadDetailMarkup(thread) {
  if (!thread) {
    return '<p class="empty-state">选择一个任务查看结构化审计信号。</p>';
  }

  const openDisabled = canOpenThread(thread) ? '' : ' disabled';
  const turnDuration = currentTurnDuration(thread);
  const pendingTools = threadPendingTools(thread);
  const openTodos = threadOpenTodos(thread);
  const notifications = threadNotifications(thread);
  const permissionSignal = hasPermissionSignal(thread, pendingTools, notifications);
  const reviewSignal = hasReviewSignal(thread, notifications);
  const pendingItems = [];
  const signalItems = [
    {
      label: '用户输入信号',
      value: recentUserSignal(thread) || '暂无截断信号',
      note: formatTimestamp(thread.latestUserMessageAtMs),
    },
    {
      label: 'Agent 输出信号',
      value: recentAgentSignal(thread) || '暂无截断信号',
      note: formatTimestamp(thread.latestAgentFinalAtMs || thread.updatedAtMs),
    },
  ];

  if (permissionSignal) {
    pendingItems.push({
      label: '等待授权',
      value: pendingTools.length
        ? pendingTools.map((tool) => itemLabel(tool, '工具调用')).slice(0, 4).join('、')
        : '有权限处理信号',
      note: pendingTools.length ? `${pendingTools.length} 个 pending tool` : '',
    });
  }
  if (openTodos.length) {
    pendingItems.push({
      label: '未完成 todo',
      value: openTodos.map((todo) => itemLabel(todo, 'todo')).slice(0, 4).join('、'),
      note: `${openTodos.length} 项 open todos`,
    });
  }
  if (reviewSignal) {
    pendingItems.push({
      label: '等待验收或新进展',
      value: notifications.length
        ? notifications.map((notification) => notificationLabel(notification)).slice(0, 3).join('、')
        : '有待处理信号',
      note: notifications.length ? `${notifications.length} 项通知` : '',
    });
  }

  return `
    <div class="detail-heading">
      <div>
        <p class="eyebrow">任务详情</p>
        <h2>${escapeHtml(displayThreadTitle(thread))}</h2>
      </div>
    </div>
    <div class="detail-layout">
      <section class="detail-section detail-section-wide" aria-labelledby="detail-actions-heading">
        <div class="detail-section-heading">
          <h3 id="detail-actions-heading">下一步动作</h3>
          <p>摘要只包含本地元数据和截断信号，不含完整内容。</p>
        </div>
        <div class="detail-actions" aria-label="当前任务操作">
          <button class="action-button primary" type="button" data-open-thread-id="${escapeHtml(thread.id)}"${openDisabled}>${escapeHtml(openLabel(thread))}</button>
          <button class="action-button secondary" type="button" data-copy-command-id="${escapeHtml(thread.id)}">复制命令</button>
          <button class="action-button secondary" type="button" data-copy-summary-id="${escapeHtml(thread.id)}">复制摘要</button>
          <button class="action-button secondary" type="button" data-open-review-panel-id="${escapeHtml(thread.id)}">交给另一个 Agent 评审</button>
        </div>
      </section>
      ${renderReviewPanel(thread)}

      <section class="detail-section detail-section-wide" aria-labelledby="detail-summary-heading">
        <div class="detail-section-heading">
          <h3 id="detail-summary-heading">状态摘要</h3>
          <p>${escapeHtml(threadPhaseLabel(thread, pendingTools, notifications))}</p>
        </div>
        <div class="detail-grid">
          <div class="detail-cell">
            <span>来源</span>
            <strong>${escapeHtml(providerLabel(thread))}</strong>
          </div>
          <div class="detail-cell">
            <span>状态</span>
            ${statusMarkup(thread.status)}
          </div>
          <div class="detail-cell">
            <span>项目</span>
            <strong>${escapeHtml(thread.projectName || '未知项目')}</strong>
          </div>
          <div class="detail-cell">
            <span>模型</span>
            <strong>${escapeHtml(thread.model || '未知模型')}</strong>
          </div>
          <div class="detail-cell">
            <span>最近更新</span>
            <strong>${escapeHtml(formatTimestamp(thread.updatedAtMs))}</strong>
          </div>
          <div class="detail-cell">
            <span>本轮耗时</span>
            <strong>${turnDuration ? escapeHtml(turnDuration) : '-'}</strong>
          </div>
          ${relationshipDetailCellMarkup(thread)}
        </div>
      </section>

      <section class="detail-section" aria-labelledby="detail-pending-heading">
        <div class="detail-section-heading">
          <h3 id="detail-pending-heading">待处理区</h3>
          <p>pending tools、todo、验收信号</p>
        </div>
        ${renderDetailList(pendingItems, '暂无 pending tool、open todo 或等待验收信号。')}
      </section>

      <section class="detail-section" aria-labelledby="detail-token-heading">
        <div class="detail-section-heading">
          <h3 id="detail-token-heading">token 区</h3>
          <p>今日、历史和最近一轮</p>
        </div>
        <div class="detail-grid detail-grid-compact">
          <div class="detail-cell">
            <span>今日 token</span>
            <strong>${escapeHtml(formatTokens(thread.todayTokenUsage))}</strong>
          </div>
          <div class="detail-cell">
            <span>历史 token</span>
            <strong>${escapeHtml(formatTokens(thread.tokensUsed))}</strong>
          </div>
          <div class="detail-cell detail-cell-wide">
            <span>最近一轮</span>
            <strong>${escapeHtml(lastTokenUsageLabel(thread.lastTokenUsage))}</strong>
          </div>
        </div>
      </section>

      <section class="detail-section" aria-labelledby="detail-evidence-heading">
        <div class="detail-section-heading">
          <h3 id="detail-evidence-heading">运行证据区</h3>
          <p>恢复入口和本地路径</p>
        </div>
        <div class="detail-evidence-list">
          <div class="detail-evidence-item">
            <span>cwd</span>
            <code>${escapeHtml(thread.cwd || '无工作目录')}</code>
          </div>
          <div class="detail-evidence-item">
            <span>rollout path</span>
            <code>${escapeHtml(thread.rolloutPath || '-')}</code>
          </div>
          <div class="detail-evidence-item">
            <span>deep link</span>
            <code>${escapeHtml(thread.appDeepLink || '-')}</code>
          </div>
          <div class="detail-evidence-item">
            <span>resume 命令</span>
            <code>${escapeHtml(resumeCommandForThread(thread) || '-')}</code>
          </div>
        </div>
      </section>

      <section class="detail-section" aria-labelledby="detail-signals-heading">
        <div class="detail-section-heading">
          <h3 id="detail-signals-heading">最近信号</h3>
          <p>只展示截断片段</p>
        </div>
        ${renderDetailList(signalItems, '暂无最近输入或输出信号。')}
        ${attachmentPreviewStripMarkup(threadAttachmentSource(thread))}
      </section>
    </div>
  `;
}

function renderDetail(thread) {
  elements.detail.innerHTML = threadDetailMarkup(thread);
}

function renderDashboard() {
  if (!state.dashboard) return;

  state.dashboardSignature = dashboardDataSignature(state.dashboard);
  renderTopbarMetrics(state.dashboard.summary);
  renderSummary(state.dashboard.summary);
  renderProviderFilter(state.dashboard.providers || []);
  renderProjectFilter(state.dashboard.projects);
  renderNotifications(state.notifications || state.dashboard.notifications);
  renderProjects(state.dashboard.projects);
  renderThreads();
  if (isSearchPageOpen()) renderSearchResults();
  elements.lastUpdated.textContent = `已更新 ${timeFormat.format(new Date(state.dashboard.generatedAtMs))}`;
  renderMonitorStatus();
}

function renderDashboardStatusOnly() {
  if (!state.dashboard) return;

  elements.lastUpdated.textContent = `已更新 ${timeFormat.format(new Date(state.dashboard.generatedAtMs))}`;
  renderMonitorStatus();
}

function updatedAtLabel() {
  const timestamp = Number(state.dashboard?.generatedAtMs || state.lastRefreshAtMs || 0);
  return timestamp ? timeFormat.format(new Date(timestamp)) : '等待数据';
}

function renderMonitorStatus() {
  if (!elements.monitorStatus) return;
  const intervalMs = effectiveRefreshIntervalMs();
  const updated = updatedAtLabel();
  const loadLabel = topbarLoadLabel();
  const loadTitle = topbarLoadTitle();
  const loadTooltip = topbarLoadTooltip();
  const setMonitorText = (text) => {
    if (elements.monitorStatusLabel) {
      elements.monitorStatusLabel.textContent = text;
    } else {
      elements.monitorStatus.textContent = text;
    }
  };
  elements.monitorStatus.title = loadTitle;
  elements.monitorStatus.setAttribute('aria-label', `${updated}，${loadTitle}`);
  if (elements.monitorStatusTooltip) {
    elements.monitorStatusTooltip.textContent = loadTooltip;
  }

  if (!elements.autoRefresh.checked) {
    setMonitorText(`${updated} · ${loadLabel} · 暂停`);
    return;
  }

  if (document.visibilityState === 'hidden') {
    setMonitorText(`${updated} · ${loadLabel} · 后台`);
    return;
  }

  if (!pageHasFocus()) {
    setMonitorText(`${updated} · ${loadLabel} · 降频 · ${secondsUntil(state.nextRefreshAtMs)}s`);
    return;
  }

  if (state.isLoading) {
    setMonitorText(`${updated} · ${loadLabel} · 同步`);
    return;
  }

  if (state.refreshError) {
    setMonitorText(`${updated} · ${loadLabel} · 异常 · ${secondsUntil(state.nextRefreshAtMs)}s`);
    return;
  }

  if (!state.lastRefreshAtMs) {
    setMonitorText(`${updated} · ${loadLabel} · ${refreshIntervalLabel(intervalMs)}`);
    return;
  }

  setMonitorText(`${updated} · ${loadLabel} · ${refreshIntervalLabel(intervalMs)} · ${secondsUntil(state.nextRefreshAtMs)}s`);
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallButton() {
  if (!elements.appInstallButton) return;

  if (isStandaloneApp()) {
    elements.appInstallButton.hidden = true;
    return;
  }

  if (state.isInstalledApp) {
    elements.appInstallButton.hidden = false;
    elements.appInstallButton.title = '打开桌面应用';
    elements.appInstallButton.querySelector('span').textContent = '打开应用';
    return;
  }

  elements.appInstallButton.hidden = !state.installPromptEvent;
  elements.appInstallButton.title = '安装为应用';
  elements.appInstallButton.querySelector('span').textContent = '安装应用';
}

function updateWindowButtons() {
  if (!elements.appHideButton) return;
  elements.appHideButton.hidden = !isStandaloneApp();
}

async function hideInstalledApp() {
  try {
    const response = await fetch('/api/app/hide-installed', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.detail || `HTTP ${response.status}`);
  } catch (error) {
    showError(`无法隐藏桌面应用：${error.message}`);
  }
}

function openInstalledApp() {
  showNotice('正在打开桌面应用。');
  return fetch('/api/app/open-installed', { method: 'POST' })
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || body.detail || `HTTP ${response.status}`);
      state.isInstalledApp = true;
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
      updateInstallButton();
      showNotice('已切换到桌面应用。');
      return body;
    })
    .catch((error) => {
      localStorage.removeItem(PWA_INSTALLED_STORAGE_KEY);
      state.isInstalledApp = false;
      updateInstallButton();

      if (error.message.includes('not found') || error.message.includes('not-found')) {
        showError('找不到已安装的桌面应用，请重新安装一次。');
        return null;
      }

      showNotice('本地打开失败，改用浏览器协议尝试唤起桌面应用。');
      window.location.href = PWA_OPEN_PROTOCOL_URL;
      return null;
    });
}

async function installOrOpenApp() {
  if (state.isInstalledApp) {
    await openInstalledApp();
    return;
  }

  const promptEvent = state.installPromptEvent;
  if (!promptEvent) {
    updateInstallButton();
    return;
  }

  state.installPromptEvent = null;
  updateInstallButton();

  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
      showNotice('正在安装应用。');
    } else {
      showNotice('已取消安装。');
    }
  } catch (error) {
    showError(`无法打开安装提示：${error.message}`);
  }
}

async function detectInstalledApp() {
  state.isInstalledApp = localStorage.getItem(PWA_INSTALLED_STORAGE_KEY) === '1';

  try {
    const response = await fetch('/api/app/installed', { cache: 'no-store' });
    if (response.ok) {
      const body = await response.json();
      state.isInstalledApp = Boolean(body.installed);
      if (state.isInstalledApp) {
        localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
      } else {
        localStorage.removeItem(PWA_INSTALLED_STORAGE_KEY);
      }
      updateInstallButton();
      return;
    }
  } catch (error) {
    console.warn('Local installed app detection failed:', error);
  }

  try {
    const relatedApps = await navigator.getInstalledRelatedApps?.();
    if (Array.isArray(relatedApps) && relatedApps.some((app) => app.platform === 'webapp')) {
      state.isInstalledApp = true;
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
    }
  } catch (error) {
    console.warn('Installed app detection failed:', error);
  }

  updateInstallButton();
}

function handleLaunchTarget(targetURL = window.location.href) {
  let url = null;
  try {
    url = new URL(targetURL);
  } catch {
    return;
  }

  const launchValue = url.searchParams.get('launch') || '';
  if (!launchValue.startsWith('web+agentmissioncontrol:')) return;

  showNotice('已回到桌面应用窗口。');
  url.searchParams.delete('launch');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function initializeLaunchHandling() {
  handleLaunchTarget();
  window.launchQueue?.setConsumer?.((launchParams) => {
    if (launchParams?.targetURL) handleLaunchTarget(launchParams.targetURL);
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  } catch (error) {
    console.warn('Service worker registration failed:', error);
  }
}

function showStatus(message, tone) {
  if (state.noticeTimer) {
    clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
  }

  elements.statusBanner.hidden = false;
  elements.statusBanner.dataset.tone = tone;
  elements.statusBanner.textContent = message;
}

function showError(message) {
  showStatus(message, 'error');
}

function showNotice(message) {
  showStatus(message, 'notice');
  state.noticeTimer = setTimeout(() => {
    clearError();
  }, 4500);
}

function clearError() {
  if (state.noticeTimer) {
    clearTimeout(state.noticeTimer);
    state.noticeTimer = null;
  }

  elements.statusBanner.hidden = true;
  elements.statusBanner.textContent = '';
  elements.statusBanner.dataset.tone = '';
}

async function loadDashboard({ silent = false, force = false } = {}) {
  if (state.isLoading) return;

  state.isLoading = true;
  const deferRender = silent && hasActiveReviewInteraction();
  renderMonitorStatus();
  elements.refreshButton.disabled = true;

  try {
    const endpoint = force ? '/api/dashboard?force=1' : '/api/dashboard';
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.dashboard = await response.json();
    setNotifications(state.dashboard.notifications || fallbackNotificationsFromDashboard(state.dashboard));
    const nextSignature = dashboardDataSignature(state.dashboard);
    const shouldRenderDashboard = force || nextSignature !== state.dashboardSignature;
    state.lastRefreshAtMs = Date.now();
    state.refreshError = '';
    if (!silent || elements.statusBanner.dataset.tone === 'error') clearError();
    await refreshOpenReviewContent({ silent });
    if (!deferRender) {
      if (shouldRenderDashboard) {
        renderDashboard();
      } else {
        state.dashboardSignature = nextSignature;
        renderDashboardStatusOnly();
      }
      if (state.search && (force || !state.search.projectHistory)) {
        void loadProjectHistory({ force });
      }
    }
  } catch (error) {
    state.refreshError = error.message;
    if (!silent) showError(`无法加载 Agent 数据：${error.message}`);
  } finally {
    state.isLoading = false;
    elements.refreshButton.disabled = false;
    renderMonitorStatus();
  }
}

async function loadNotifications() {
  const response = await fetch('/api/notifications', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  setNotifications(await response.json());
}

function currentPendingSummaryCounts() {
  const notifications = state.notifications || state.dashboard?.notifications;
  const counts = notificationBreakdown(notifications);
  return {
    displayCount: counts.totalCount,
    runningHostThreadCount: countRunningHostThreads(state.dashboard || {}),
  };
}

function pendingSummaryDiffers(summary) {
  if (!state.dashboard || !summary) return false;

  const current = currentPendingSummaryCounts();
  const summaryDisplayCount = Number(summary.displayCount ?? summary.activeCount ?? 0);
  const summaryHostCount = Number(summary.runningHostThreadCount ?? 0);

  return Number.isFinite(summaryDisplayCount)
    && Number.isFinite(summaryHostCount)
    && (
      current.displayCount !== Math.max(0, summaryDisplayCount)
      || current.runningHostThreadCount !== Math.max(0, summaryHostCount)
    );
}

function shouldPollPendingSummary() {
  return Boolean(
    state.dashboard
    && elements.autoRefresh.checked
    && document.visibilityState !== 'hidden'
    && effectiveRefreshIntervalMs() > PENDING_SUMMARY_POLL_INTERVAL_MS
  );
}

async function syncPendingSummaryWithDashboard() {
  if (state.isLoading || state.isPendingSummarySyncing || !shouldPollPendingSummary()) return;

  state.isPendingSummarySyncing = true;
  try {
    const response = await fetch('/api/pending-summary', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const summary = await response.json();
    if (pendingSummaryDiffers(summary)) {
      await loadDashboard({ silent: true, force: true });
    }
  } catch {
    // Full dashboard refresh owns visible error state; this tiny sync should stay quiet.
  } finally {
    state.isPendingSummarySyncing = false;
  }
}

function startPendingSummarySync() {
  if (state.pendingSummaryTimer) return;
  state.pendingSummaryTimer = setInterval(syncPendingSummaryWithDashboard, PENDING_SUMMARY_POLL_INTERVAL_MS);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.detail || `HTTP ${response.status}`);
  return body;
}

function searchParamsFromControls({ force = false, cursor = '' } = {}) {
  const params = new URLSearchParams();
  params.set('q', currentSearchQuery());
  params.set('provider', elements.providerFilter?.value || 'all');
  params.set('status', elements.statusFilter?.value || 'all');
  params.set('project', elements.projectFilter?.value || 'all');
  params.set('limit', String(SEARCH_RESULT_LIMIT));
  if (cursor) params.set('cursor', cursor);
  if (elements.archiveToggle?.checked) params.set('archived', '1');
  if (elements.subagentToggle?.checked) params.set('subagents', '1');
  if (elements.automationToggle?.checked) params.set('automations', '1');
  if (force) params.set('force', '1');
  return params;
}

function mergeSearchResults(previous, next) {
  const seen = new Set();
  const items = [];
  for (const item of [...(previous?.items || []), ...(next?.items || [])]) {
    const key = item?.id || item?.externalId || '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    items.push(item);
  }
  return {
    ...next,
    items,
  };
}

function resetSearchPaging() {
  state.search.nextCursor = '';
  state.search.hasMore = false;
  state.search.isLoadingMore = false;
  state.search.loadMoreError = '';
}

async function runSearch({ force = false, allowEmpty = false, append = false, cursor = '' } = {}) {
  const query = currentSearchQuery();
  state.search.query = query;

  if (!query && !allowEmpty) {
    state.search.result = null;
    state.search.error = '';
    state.search.isLoading = false;
    resetSearchPaging();
    closeSearchDetailModal({ renderResults: false });
    renderSearchResults();
    return null;
  }

  if (append && (!cursor || state.search.isLoadingMore || !state.search.hasMore)) return null;
  if (!append) {
    resetSearchPaging();
    closeSearchDetailModal({ renderResults: false });
  }

  const requestId = state.search.requestId + 1;
  state.search.requestId = requestId;
  state.search.isLoading = !append;
  state.search.isLoadingMore = append;
  state.search.error = '';
  state.search.loadMoreError = '';
  renderSearchResults();

  try {
    const params = searchParamsFromControls({ force, cursor });
    const result = await fetch(`/api/search?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || body.detail || `HTTP ${response.status}`);
        return body;
      });
    if (requestId !== state.search.requestId) return null;
    state.search.result = append ? mergeSearchResults(state.search.result, result) : result;
    state.search.nextCursor = result.nextCursor || '';
    state.search.hasMore = Boolean(result.nextCursor);
    state.search.error = '';
    return result;
  } catch (error) {
    if (requestId !== state.search.requestId) return null;
    if (append && state.search.result) {
      state.search.loadMoreError = error.message;
      state.search.hasMore = false;
      state.search.nextCursor = '';
    } else {
      state.search.error = error.message;
    }
    return null;
  } finally {
    if (requestId === state.search.requestId) {
      state.search.isLoading = false;
      state.search.isLoadingMore = false;
      renderSearchResults();
      requestSearchLoadCheck();
    }
  }
}

async function loadProjectHistory({ force = false } = {}) {
  try {
    const params = new URLSearchParams();
    params.set('limit', '24');
    if (force) params.set('force', '1');
    const history = await fetch(`/api/projects/history?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || body.detail || `HTTP ${response.status}`);
        return body;
      });
    state.search.projectHistory = history;
    state.search.projectHistoryError = '';
    renderProjectHistory(state.search.projectHistory);
    return history;
  } catch (error) {
    state.search.projectHistoryError = error.message;
    renderProjects(state.dashboard?.projects || []);
    return null;
  }
}

function clearSearchResult() {
  if (state.search.timer) {
    clearTimeout(state.search.timer);
    state.search.timer = null;
  }
  state.search.requestId += 1;
  state.search.query = '';
  state.search.result = null;
  state.search.error = '';
  state.search.isLoading = false;
  resetSearchPaging();
  closeSearchDetailModal({ renderResults: false });
  renderSearchResults();
}

function shouldLoadMoreSearchResults() {
  if (!isSearchPageOpen()) return false;
  if (!state.search.result || !state.search.hasMore) return false;
  if (state.search.isLoading || state.search.isLoadingMore) return false;
  if (!elements.searchLoadSentinel || elements.searchLoadSentinel.hidden) return false;
  const sentinelBox = elements.searchLoadSentinel.getBoundingClientRect();
  return sentinelBox.top < window.innerHeight + 520;
}

function loadMoreSearchResults() {
  if (!shouldLoadMoreSearchResults()) return;
  void runSearch({
    allowEmpty: Boolean(state.search.result),
    append: true,
    cursor: state.search.nextCursor,
  });
}

function requestSearchLoadCheck() {
  window.requestAnimationFrame(() => {
    loadMoreSearchResults();
  });
}

function handleSearchControlsChanged() {
  if (state.search.timer) {
    clearTimeout(state.search.timer);
    state.search.timer = null;
  }

  if (!hasActiveSearchQuery()) {
    clearSearchResult();
    renderSearchResults();
    return;
  }

  state.search.timer = window.setTimeout(() => {
    state.search.timer = null;
    runSearch();
  }, SEARCH_DEBOUNCE_MS);
  state.search.isLoading = true;
  renderSearchResults();
}

async function loadReviewTargets() {
  if (state.review.targets) return state.review.targets;
  state.review.targets = await fetchJson('/api/review-targets', { cache: 'no-store' });
  return state.review.targets;
}

async function loadReviewContent(threadId, mode = selectedReviewInputMode(threadId)) {
  const key = reviewContentKey(threadId, mode);
  const content = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/review-content?mode=${encodeURIComponent(mode)}`, {
    cache: 'no-store',
  });
  state.review.contentByThread.set(key, content);
  state.review.contentErrorsByThread.delete(key);
  return content;
}

async function refreshOpenReviewContent({ silent = false } = {}) {
  const threadId = state.review.openThreadId;
  if (!threadId || !findThread(threadId)) return;

  const inputMode = selectedReviewInputMode(threadId);
  try {
    await loadReviewContent(threadId, inputMode);
  } catch (error) {
    state.review.contentByThread.delete(reviewContentKey(threadId, inputMode));
    state.review.contentErrorsByThread.set(reviewContentKey(threadId, inputMode), error.message);
    if (!silent) showError(`无法刷新评审输入：${error.message}`);
  }
}

async function loadReviewJobs(threadId) {
  const jobs = await fetchJson(`/api/reviews?threadId=${encodeURIComponent(threadId)}`, { cache: 'no-store' });
  const items = jobs.items || [];
  state.review.jobsByThread.set(threadId, items);
  return items;
}

function isSearchDetailModalOpen() {
  return Boolean(state.search.modalThreadId && elements.searchDetailModal && !elements.searchDetailModal.hidden);
}

function isImagePreviewModalOpen() {
  return Boolean(elements.imagePreviewModal && !elements.imagePreviewModal.hidden);
}

function isArtifactTimelineModalOpen() {
  return Boolean(state.artifacts.threadId && elements.artifactTimelineModal && !elements.artifactTimelineModal.hidden);
}

function isArtifactDetailModalOpen() {
  return Boolean(state.artifacts.detailArtifactId && elements.artifactDetailModal && !elements.artifactDetailModal.hidden);
}

function syncModalBodyClass() {
  document.body.classList.toggle(
    'has-modal',
    isSearchDetailModalOpen()
      || isImagePreviewModalOpen()
      || isArtifactTimelineModalOpen()
      || isArtifactDetailModalOpen(),
  );
}

function renderSearchDetailModal() {
  if (!elements.searchDetailModal || !elements.searchDetailContent) return;

  const thread = findThread(state.search.modalThreadId);
  if (!thread) {
    closeSearchDetailModal({ renderResults: true });
    return;
  }

  if (elements.searchDetailTitle) {
    elements.searchDetailTitle.textContent = displayThreadTitle(thread);
  }
  elements.searchDetailContent.innerHTML = threadDetailMarkup(thread);
  elements.searchDetailModal.hidden = false;
  syncModalBodyClass();
}

function openSearchDetailModal(threadId) {
  state.search.modalThreadId = threadId;
  renderSearchDetailModal();
  renderSearchResults();
  window.setTimeout(() => {
    elements.searchDetailModal?.querySelector('[data-close-search-detail]')?.focus();
  }, 0);
}

function closeSearchDetailModal({ renderResults = true } = {}) {
  state.search.modalThreadId = '';
  if (elements.searchDetailModal) elements.searchDetailModal.hidden = true;
  if (elements.searchDetailContent) elements.searchDetailContent.innerHTML = '';
  syncModalBodyClass();
  if (renderResults) renderSearchResults();
}

function openImagePreview(src, title = '原图') {
  if (!elements.imagePreviewModal || !elements.imagePreviewImage) return;

  elements.imagePreviewImage.src = src;
  elements.imagePreviewImage.alt = title;
  if (elements.imagePreviewTitle) elements.imagePreviewTitle.textContent = title;
  elements.imagePreviewModal.hidden = false;
  syncModalBodyClass();
  window.setTimeout(() => {
    elements.imagePreviewModal?.querySelector('[data-close-image-preview]')?.focus();
  }, 0);
}

function closeImagePreview() {
  if (elements.imagePreviewImage) {
    elements.imagePreviewImage.removeAttribute('src');
    elements.imagePreviewImage.alt = '';
  }
  if (elements.imagePreviewModal) elements.imagePreviewModal.hidden = true;
  syncModalBodyClass();
}

function artifactDataForThread(threadId) {
  return state.artifacts.dataByThread.get(threadId) || null;
}

function artifactErrorForThread(threadId) {
  return state.artifacts.errorsByThread.get(threadId) || '';
}

function artifactItemsForThread(threadId) {
  const loaded = artifactDataForThread(threadId);
  if (Array.isArray(loaded?.artifacts?.items)) return loaded.artifacts.items;
  return artifactItems(findThread(threadId));
}

function artifactTurnsForThread(threadId) {
  const loaded = artifactDataForThread(threadId);
  if (Array.isArray(loaded?.artifacts?.turns)) return loaded.artifacts.turns;
  const items = artifactItemsForThread(threadId);
  const byTurn = new Map();
  for (const item of items) {
    const turn = Number(item.turn || 0) || 1;
    const group = byTurn.get(turn) || { turn, atMs: item.atMs || null, items: [] };
    group.atMs = Math.max(Number(group.atMs || 0), Number(item.atMs || 0)) || group.atMs;
    group.items.push(item);
    byTurn.set(turn, group);
  }
  return [...byTurn.values()].sort((a, b) => Number(b.atMs || 0) - Number(a.atMs || 0) || Number(b.turn || 0) - Number(a.turn || 0));
}

function findArtifact(threadId, artifactId) {
  return artifactItemsForThread(threadId).find((item) => item.id === artifactId) || null;
}

async function loadThreadArtifacts(threadId) {
  if (!threadId) return null;
  const existing = artifactDataForThread(threadId);
  if (existing) return existing;

  state.artifacts.isLoading = true;
  state.artifacts.errorsByThread.delete(threadId);
  renderArtifactTimelineModal();
  try {
    const data = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/artifacts`, {
      cache: 'no-store',
    });
    state.artifacts.dataByThread.set(threadId, data);
    state.artifacts.errorsByThread.delete(threadId);
    return data;
  } catch (error) {
    state.artifacts.errorsByThread.set(threadId, error.message);
    return null;
  } finally {
    state.artifacts.isLoading = false;
    renderArtifactTimelineModal();
  }
}

function artifactMetaLine(item = {}) {
  return [
    item.turn ? `第 ${item.turn} 轮` : '',
    artifactSourceLabel(item.source),
    formatTimestamp(item.atMs),
  ].filter((part) => part && part !== '-').join(' · ');
}

function artifactTimelineItemMarkup(threadId, item = {}) {
  const src = artifactPreviewImageSrc(item);
  return `
    <button class="artifact-timeline-item" type="button" data-open-artifact-detail-id="${escapeHtml(item.id || '')}" data-artifact-thread-id="${escapeHtml(threadId)}">
      <span class="artifact-timeline-thumb" aria-hidden="true">
        ${src
          ? `<img data-artifact-preview-image src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">${artifactTypeIconMarkup(item, 'data-artifact-preview-fallback hidden')}`
          : artifactTypeIconMarkup(item)}
      </span>
      <span class="artifact-timeline-copy">
        <strong>${escapeHtml(artifactDisplayTitle(item))}</strong>
        <small>${escapeHtml(`${artifactTypeLabel(item)} · ${artifactSourceLabel(item.source)}`)}</small>
      </span>
    </button>
  `;
}

function renderArtifactTimelineModal() {
  if (!elements.artifactTimelineModal || !elements.artifactTimelineContent) return;

  const threadId = state.artifacts.threadId;
  const thread = findThread(threadId);
  if (!threadId || !thread) {
    closeArtifactTimelineModal();
    return;
  }

  if (elements.artifactTimelineTitle) {
    elements.artifactTimelineTitle.textContent = displayThreadTitle(thread);
  }

  const error = artifactErrorForThread(threadId);
  const turns = artifactTurnsForThread(threadId);
  const total = artifactDataForThread(threadId)?.artifacts?.total || artifactTotal(thread);
  let content = '';
  if (state.artifacts.isLoading && !artifactDataForThread(threadId)) {
    content = '<p class="empty-state compact">正在读取素材时间轴...</p>';
  } else if (error) {
    content = `<p class="empty-state compact">素材读取失败：${escapeHtml(error)}</p>`;
  } else if (!turns.length) {
    content = '<p class="empty-state compact">这个线程暂未发现素材。</p>';
  } else {
    content = `
      <div class="artifact-timeline-summary">
        <strong>${escapeHtml(total)} 项素材</strong>
        <span>按对话时间逆序排列</span>
      </div>
      <div class="artifact-timeline-list">
        ${turns.map((turn) => `
          <article class="artifact-turn">
            <div class="artifact-turn-marker" aria-hidden="true"></div>
            <div class="artifact-turn-body">
              <div class="artifact-turn-heading">
                <strong>第 ${escapeHtml(turn.turn)} 轮</strong>
                <span>${escapeHtml(formatTimestamp(turn.atMs))}</span>
              </div>
              <div class="artifact-turn-grid">
                ${(turn.items || []).map((item) => artifactTimelineItemMarkup(threadId, item)).join('')}
              </div>
            </div>
          </article>
        `).join('')}
      </div>
    `;
  }

  elements.artifactTimelineContent.innerHTML = content;
  elements.artifactTimelineModal.hidden = false;
  syncModalBodyClass();
}

function openArtifactTimeline(threadId) {
  state.artifacts.threadId = threadId;
  renderArtifactTimelineModal();
  loadThreadArtifacts(threadId);
  window.setTimeout(() => {
    elements.artifactTimelineModal?.querySelector('[data-close-artifact-timeline]')?.focus();
  }, 0);
}

function closeArtifactTimelineModal() {
  state.artifacts.threadId = '';
  if (elements.artifactTimelineModal) elements.artifactTimelineModal.hidden = true;
  if (elements.artifactTimelineContent) elements.artifactTimelineContent.innerHTML = '';
  syncModalBodyClass();
}

function artifactDetailPreviewMarkup(item = {}) {
  const src = artifactPreviewImageSrc(item);
  if (src) {
    return `
      <div class="artifact-detail-preview is-image">
        <img data-artifact-preview-image src="${escapeHtml(src)}" alt="${escapeHtml(artifactDisplayTitle(item))}">
        ${artifactTypeIconMarkup(item, 'data-artifact-preview-fallback hidden')}
      </div>
    `;
  }

  return `
    <div class="artifact-detail-preview">
      ${artifactTypeIconMarkup(item)}
    </div>
  `;
}

function artifactOpenLabel(item = {}) {
  if (item.url) return item.type === 'image' ? '打开图片链接' : '打开链接';
  if (item.type === 'html') return '用浏览器打开';
  if (item.type === 'markdown') return '打开 Markdown';
  return '打开文件';
}

function artifactDetailMarkup(threadId, item = {}) {
  const canOpen = Boolean(item.url || item.path);
  const urlLine = item.url ? `
    <p class="artifact-link-line">
      <span>链接</span>
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a>
    </p>
  ` : '';

  return `
    <div class="artifact-detail-layout">
      ${artifactDetailPreviewMarkup(item)}
      <div class="artifact-detail-info">
        <div class="artifact-detail-type">${escapeHtml(artifactTypeLabel(item))}</div>
        <h3>${escapeHtml(artifactDisplayTitle(item))}</h3>
        <p>${escapeHtml(artifactMetaLine(item))}</p>
        ${urlLine}
        <div class="detail-actions">
          <button class="action-button primary" type="button" data-open-artifact-target-id="${escapeHtml(item.id || '')}" data-artifact-thread-id="${escapeHtml(threadId)}"${canOpen ? '' : ' disabled'}>${escapeHtml(artifactOpenLabel(item))}</button>
        </div>
      </div>
    </div>
  `;
}

function renderArtifactDetailModal() {
  if (!elements.artifactDetailModal || !elements.artifactDetailContent) return;
  const threadId = state.artifacts.detailThreadId;
  const artifactId = state.artifacts.detailArtifactId;
  const item = findArtifact(threadId, artifactId);

  if (!threadId || !artifactId || !item) {
    closeArtifactDetailModal();
    return;
  }

  if (elements.artifactDetailTitle) elements.artifactDetailTitle.textContent = artifactDisplayTitle(item);
  elements.artifactDetailContent.innerHTML = artifactDetailMarkup(threadId, item);
  elements.artifactDetailModal.hidden = false;
  syncModalBodyClass();
}

async function openArtifactDetail(threadId, artifactId) {
  state.artifacts.detailThreadId = threadId;
  state.artifacts.detailArtifactId = artifactId;
  if (!findArtifact(threadId, artifactId)) {
    await loadThreadArtifacts(threadId);
  }
  renderArtifactDetailModal();
  window.setTimeout(() => {
    elements.artifactDetailModal?.querySelector('[data-close-artifact-detail]')?.focus();
  }, 0);
}

function closeArtifactDetailModal() {
  state.artifacts.detailThreadId = '';
  state.artifacts.detailArtifactId = '';
  if (elements.artifactDetailModal) elements.artifactDetailModal.hidden = true;
  if (elements.artifactDetailContent) elements.artifactDetailContent.innerHTML = '';
  syncModalBodyClass();
}

async function openArtifactTarget(threadId, artifactId, sourceButton = null) {
  const item = findArtifact(threadId, artifactId);
  if (!item) return;

  if (item.url) {
    window.open(item.url, '_blank', 'noopener,noreferrer');
    return;
  }

  if (!item.path) return;
  const originalText = sourceButton?.textContent || '';
  if (sourceButton) {
    sourceButton.disabled = true;
    sourceButton.textContent = '正在打开';
  }
  try {
    await fetchJson('/api/local-file-open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: item.path }),
    });
    showNotice('已交给系统打开。');
  } catch (error) {
    showError(`打开失败：${error.message}`);
  } finally {
    if (sourceButton) {
      sourceButton.disabled = false;
      sourceButton.textContent = originalText;
    }
  }
}

function renderSelectedDetail() {
  if (isSearchDetailModalOpen()) {
    renderSearchDetailModal();
    return;
  }
  renderDetail(findThread(state.selectedThreadId));
}

function hasActiveReviewInteraction() {
  const active = document.activeElement;
  return active instanceof Element && Boolean(active.closest('.review-form'));
}

function syncReviewPolling() {
  if (state.review.pollTimer) {
    clearInterval(state.review.pollTimer);
    state.review.pollTimer = null;
  }

  const threadId = state.review.openThreadId;
  if (!threadId || !hasRunningReviewJob(threadId)) return;

  state.review.pollTimer = setInterval(() => {
    refreshReviewJobs(threadId, { silent: true });
  }, REVIEW_POLL_INTERVAL_MS);
}

async function openReviewPanel(threadId) {
  state.review.openThreadId = threadId;
  state.review.isLoading = true;
  renderSelectedDetail();

  try {
    const inputMode = selectedReviewInputMode(threadId);
    await Promise.all([
      loadReviewTargets(),
      loadReviewContent(threadId, inputMode),
      loadReviewJobs(threadId),
    ]);
  } catch (error) {
    showError(`无法加载评审面板：${error.message}`);
  } finally {
    state.review.isLoading = false;
    renderSelectedDetail();
    syncReviewPolling();
  }
}

async function changeReviewInputMode(threadId, inputMode) {
  state.review.inputModeByThread.set(threadId, inputMode);
  state.review.isLoading = true;
  renderSelectedDetail();

  try {
    await loadReviewContent(threadId, inputMode);
  } catch (error) {
    state.review.contentByThread.delete(reviewContentKey(threadId, inputMode));
    state.review.contentErrorsByThread.set(reviewContentKey(threadId, inputMode), error.message);
    showError(`无法读取评审输入：${error.message}`);
  } finally {
    state.review.isLoading = false;
    renderSelectedDetail();
  }
}

function changeReviewTargetProvider(threadId, targetProvider) {
  if (targetProvider) {
    state.review.targetProviderByThread.set(threadId, targetProvider);
  } else {
    state.review.targetProviderByThread.delete(threadId);
  }
  renderSelectedDetail();
}

function changeReviewTemplate(threadId, templateId) {
  if (REVIEW_TEMPLATES.some(([id]) => id === templateId)) {
    state.review.templateByThread.set(threadId, templateId);
  } else {
    state.review.templateByThread.delete(threadId);
  }
  renderSelectedDetail();
}

function changeReviewFixLoopFilter(threadId, filter) {
  if (['pending', 'applied', 'dismissed'].includes(filter)) {
    state.review.fixLoopFilterByThread.set(threadId, filter);
  } else {
    state.review.fixLoopFilterByThread.delete(threadId);
  }
  renderSelectedDetail();
}

function updateCustomReviewInstruction(threadId, value) {
  state.review.customInstructionByThread.set(threadId, value || '');
}

function openReviewJobDetail(threadId, reviewId) {
  if (threadId && reviewId) {
    state.review.selectedJobIdByThread.set(threadId, reviewId);
  }
  renderSelectedDetail();
}

function closeReviewJobDetail(threadId) {
  if (threadId) {
    state.review.selectedJobIdByThread.delete(threadId);
  }
  renderSelectedDetail();
}

async function refreshReviewJobs(threadId, { silent = false } = {}) {
  try {
    await loadReviewJobs(threadId);
    if (!silent || !hasActiveReviewInteraction()) renderSelectedDetail();
    syncReviewPolling();
  } catch (error) {
    if (!silent) showError(`无法刷新评审记录：${error.message}`);
  }
}

function selectThread(threadId) {
  if (isSearchPageOpen()) {
    openSearchDetailModal(threadId);
    return;
  }

  state.selectedThreadId = threadId;
  renderThreads();
  document.querySelector('#detail')?.scrollIntoView({ block: 'nearest' });
}

function scrollPanelIntoView(element) {
  element?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}

function focusTopbarAction(action) {
  if (action === 'pending') {
    state.inboxExpanded = true;
    renderNotifications(state.notifications || state.dashboard?.notifications);
    scrollPanelIntoView(elements.inbox?.closest('.priority-inbox-panel'));

    const counts = notificationBreakdown(state.notifications || state.dashboard?.notifications);
    if (!counts.totalCount) showNotice('当前暂无待处理。');
    return;
  }

  if (action === 'running') {
    openSearchPage();
    if (elements.searchInput) elements.searchInput.value = '';
    if (elements.providerFilter) elements.providerFilter.value = 'all';
    if (elements.projectFilter) elements.projectFilter.value = 'all';
    if (elements.statusFilter) elements.statusFilter.value = 'running';
    if (elements.archiveToggle) elements.archiveToggle.checked = false;
    if (elements.subagentToggle) elements.subagentToggle.checked = false;
    if (elements.automationToggle) elements.automationToggle.checked = false;
    void runSearch({ allowEmpty: true });
    scrollPanelIntoView(elements.searchPage);

    if (!countRunningHostThreads()) showNotice('当前没有工作中的 Host Agent。');
  }
}

async function copyResumeCommand(threadId) {
  const thread = findThread(threadId);
  if (!thread) {
    showError('找不到这个任务，先刷新看板再试。');
    return;
  }

  try {
    await copyText(resumeCommandForThread(thread));
    showNotice('已复制 resume 命令。');
  } catch {
    showError('无法写入剪贴板，请手动复制详情里的 resume 命令。');
  }
}

async function copyThreadSummary(threadId) {
  const thread = findThread(threadId);
  if (!thread) {
    showError('找不到这个任务，先刷新看板再试。');
    return;
  }

  try {
    await copyText(buildThreadSummary(thread));
    showNotice('已复制摘要。');
  } catch {
    showError('无法写入剪贴板，请手动复制详情里的摘要。');
  }
}

async function submitReview(form) {
  const threadId = form.dataset.reviewFormThreadId;
  const thread = findThread(threadId);
  if (!thread) {
    showError('找不到这个线程，先刷新看板再试。');
    return;
  }

  const formData = new FormData(form);
  const templateId = formData.get('templateId') || selectedReviewTemplate(threadId);
  const payload = {
    sourceThreadId: threadId,
    targetProvider: formData.get('targetProvider') || selectedReviewTargetProvider(threadId),
    targetModel: formData.get('targetModel'),
    templateId,
    inputMode: formData.get('inputMode') || selectedReviewInputMode(threadId),
  };
  if (templateId === 'custom-review') {
    payload.customReviewInstruction = formData.get('customReviewInstruction') || '';
  }

  state.review.isLoading = true;
  renderSelectedDetail();

  try {
    const body = await fetchJson('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const jobs = reviewJobsForThread(threadId);
    state.review.jobsByThread.set(threadId, [body.job, ...jobs.filter((job) => job.id !== body.job.id)]);
    showNotice('评审任务已启动。');
    await refreshReviewJobs(threadId, { silent: true });
  } catch (error) {
    showError(`无法启动评审任务：${error.message}`);
  } finally {
    state.review.isLoading = false;
    renderSelectedDetail();
    syncReviewPolling();
  }
}

async function updateReviewJobMetadata(reviewId, patch) {
  const body = await fetchJson(`/api/reviews/${encodeURIComponent(reviewId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  mergeReviewJob(body.job);
  renderSelectedDetail();
  return body.job;
}

function findReviewJob(reviewId) {
  return [...state.review.jobsByThread.values()].flat().find((candidate) => candidate.id === reviewId);
}

function mergeReviewJob(job) {
  const threadId = job?.source?.threadId;
  if (!threadId) return;

  const jobs = reviewJobsForThread(threadId);
  const nextJobs = jobs.some((candidate) => candidate.id === job.id)
    ? jobs.map((candidate) => (candidate.id === job.id ? job : candidate))
    : [job, ...jobs];
  state.review.jobsByThread.set(threadId, nextJobs);
}

async function copyReviewResult(reviewId) {
  const job = findReviewJob(reviewId);
  if (!job?.resultText) {
    showError('这条评审还没有可复制的结果。');
    return;
  }

  try {
    await copyText(job.resultText);
    showNotice('已复制评审结果。');
  } catch {
    showError('无法写入剪贴板，请手动复制评审结果。');
  }
}

async function copyReviewDebugInfo(reviewId) {
  const job = findReviewJob(reviewId);
  if (!job) {
    showError('找不到这条评审记录，刷新后再试。');
    return;
  }

  try {
    await copyText(buildReviewDebugSummary(job));
    showNotice('已复制评审调试摘要。');
  } catch {
    showError('无法写入剪贴板，请手动复制评审调试摘要。');
  }
}

async function copyReviewFixPrompt(reviewId) {
  const job = findReviewJob(reviewId);
  if (!job?.resultText && !job?.resultPreview) {
    showError('这条评审还没有可生成修复 Prompt 的结果。');
    return;
  }

  try {
    await copyText(buildReviewFixPrompt(job));
  } catch {
    showError('无法写入剪贴板，请手动复制修复 Prompt。');
    return;
  }

  try {
    await updateReviewJobMetadata(reviewId, {
      fixLoop: {
        status: 'prompt-copied',
        promptCopiedAtMs: Date.now(),
      },
    });
    showNotice('已复制修复 Prompt。');
  } catch (error) {
    showError(`已复制修复 Prompt，但无法记录状态：${error.message}`);
  }
}

async function copyAndOpenReviewFix(reviewId, sourceButton) {
  const job = findReviewJob(reviewId);
  if (!job?.resultText && !job?.resultPreview) {
    showError('这条评审还没有可生成修复 Prompt 的结果。');
    return;
  }
  if (!job.source?.threadId) {
    showError('这条评审缺少源线程，无法打开。');
    return;
  }

  try {
    const timestamp = Date.now();
    await copyText(buildReviewFixPrompt(job));
    await updateReviewJobMetadata(reviewId, {
      fixLoop: {
        status: 'source-opened',
        promptCopiedAtMs: timestamp,
        sourceOpenedAtMs: timestamp,
      },
    });
    await openThread(job.source.threadId, sourceButton, {
      copyResume: false,
      noticeMessage: '已复制修复 Prompt，正在打开源线程。',
    });
  } catch (error) {
    showError(`无法启动回源修复：${error.message}`);
  }
}

async function markReviewFixLoopStatus(reviewId, status) {
  if (status !== 'applied' && status !== 'dismissed') {
    showError('未知的修复状态。');
    return;
  }

  try {
    await updateReviewJobMetadata(reviewId, {
      fixLoop: {
        status,
        resolvedAtMs: Date.now(),
      },
    });
    showNotice(status === 'applied' ? '已标记为已处理。' : '已标记为不采纳。');
  } catch (error) {
    showError(`无法更新修复状态：${error.message}`);
  }
}

async function openThread(threadId, sourceButton, { notificationId = '', copyResume = true, noticeMessage = '' } = {}) {
  const thread = findThread(threadId);
  if (!thread) {
    showError('找不到这个任务，先刷新看板再试。');
    return;
  }

  const resumeCommand = resumeCommandForThread(thread);
  disableButtonBriefly(sourceButton);

  if (shouldOpenDeepLinkInBrowser(thread)) {
    if (copyResume) void copyText(resumeCommand).catch(() => {});

    let updatedNotification = null;
    if (notificationId) {
      updatedNotification = markNotificationDoneLocally(notificationId);
      void updateNotification(notificationId, { status: 'done' }).catch((error) => {
        showError(`无法持久化${notificationOutcomeLabel(updatedNotification)}状态：${error.message}`);
      });
    }

    const label = providerLabel(thread);
    showNotice(noticeMessage || (notificationId
      ? `正在切换到 ${label}，并${notificationMarkedPhrase(updatedNotification)}。`
      : `正在切换到 ${label}。`));
    window.location.href = thread.appDeepLink;
    return;
  }

  try {
    const response = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        notificationId,
        markNotificationDone: Boolean(notificationId),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.detail || `HTTP ${response.status}`);

    if (copyResume) await copyText(body.resumeCommand || resumeCommand).catch(() => {});
    const updatedNotification = notificationId
      ? markNotificationDoneLocally(notificationId)
      : null;
    const notificationPhrase = notificationId
      ? `，并${notificationMarkedPhrase(updatedNotification)}`
      : '';

    const label = providerLabel(thread);
    showNotice(noticeMessage || (body.opened
      ? `正在打开 ${label}${notificationPhrase}，并已复制命令。`
      : `已复制 ${label} 命令${notificationPhrase}，请在终端继续。`));
    loadDashboard({ silent: true });
  } catch (error) {
    if (!copyResume) {
      showError(`无法直接打开任务，请手动打开源线程：${displayThreadTitle(thread) || thread.id}`);
      return;
    }
    try {
      await copyText(resumeCommand);
      showError(`无法直接打开任务，已复制命令：${resumeCommand}`);
    } catch {
      showError(`无法直接打开任务，请手动复制命令：${resumeCommand}`);
    }
  }
}

async function updateNotification(notificationId, patch) {
  const response = await fetch(`/api/notifications/${encodeURIComponent(notificationId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function markNotificationDone(notificationId) {
  const updated = markNotificationDoneLocally(notificationId);
  if (!updated) {
    showError('找不到这条通知，刷新看板后再试。');
    return;
  }

  showNotice(`${notificationMarkedPhrase(updated)}。`);
  try {
    await updateNotification(notificationId, { status: 'done' });
  } catch (error) {
    showError(`已从当前面板移除，但无法持久化状态：${error.message}`);
  }
}

function scheduleNextMonitorTick(delayMs = effectiveRefreshIntervalMs()) {
  if (state.autoTimer) {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
  }

  if (!elements.autoRefresh.checked || document.visibilityState === 'hidden') {
    state.nextRefreshAtMs = null;
    renderMonitorStatus();
    return;
  }

  state.nextRefreshAtMs = Date.now() + delayMs;
  state.autoTimer = setTimeout(runMonitorTick, delayMs);
  renderMonitorStatus();
}

function runMonitorTick() {
  if (document.visibilityState === 'hidden' || !elements.autoRefresh.checked) {
    scheduleNextMonitorTick();
    return;
  }

  state.nextRefreshAtMs = null;
  renderMonitorStatus();
  loadDashboard({ silent: true }).finally(() => scheduleNextMonitorTick());
}

function startHeartbeat() {
  if (state.heartbeatTimer) return;
  state.heartbeatTimer = setInterval(renderMonitorStatus, HEARTBEAT_INTERVAL_MS);
}

function syncMonitor() {
  if (state.autoTimer) {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
  }

  localStorage.setItem(MONITOR_STORAGE_KEY, elements.autoRefresh.checked ? '1' : '0');
  localStorage.setItem(REFRESH_INTERVAL_STORAGE_KEY, String(currentRefreshIntervalMs()));

  if (elements.autoRefresh.checked) {
    scheduleNextMonitorTick();
  } else {
    state.nextRefreshAtMs = null;
    renderMonitorStatus();
  }
}

function initializeMonitor() {
  const stored = localStorage.getItem(MONITOR_STORAGE_KEY);
  const storedInterval = normalizeRefreshInterval(localStorage.getItem(REFRESH_INTERVAL_STORAGE_KEY));
  elements.autoRefresh.checked = stored === null ? true : stored === '1';
  if (elements.refreshInterval) elements.refreshInterval.value = String(storedInterval);
  startHeartbeat();
  syncMonitor();
}

function refreshWhenVisible() {
  if (document.visibilityState === 'hidden' || !elements.autoRefresh.checked) {
    scheduleNextMonitorTick();
    return;
  }

  const intervalMs = effectiveRefreshIntervalMs();
  state.nextRefreshAtMs = Date.now() + intervalMs;
  const staleForMs = Date.now() - Number(state.lastRefreshAtMs || 0);
  if (!state.lastRefreshAtMs || staleForMs >= intervalMs) {
    loadDashboard({ silent: true });
  }
  scheduleNextMonitorTick(intervalMs);
  renderMonitorStatus();
}

function initializeInstallPrompt() {
  updateInstallButton();
  updateWindowButtons();
  detectInstalledApp();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    state.installPromptEvent = null;
    state.isInstalledApp = true;
    localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, '1');
    updateInstallButton();
    showNotice('应用已安装，可从独立窗口打开。');
  });

  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => {
    updateInstallButton();
    updateWindowButtons();
  });
}

elements.appHideButton?.addEventListener('click', hideInstalledApp);
elements.appInstallButton?.addEventListener('click', installOrOpenApp);
elements.refreshButton.addEventListener('click', () => {
  if (isSearchPageOpen()) {
    void Promise.all([
      runSearch({ force: true, allowEmpty: true }),
      loadProjectHistory({ force: true }),
    ]);
    return;
  }
  loadDashboard({ force: true });
});
elements.openSearchPage?.addEventListener('click', () => openSearchPage());
elements.closeSearchPage?.addEventListener('click', () => closeSearchPage());
elements.searchInput.addEventListener('input', handleSearchControlsChanged);
elements.providerFilter.addEventListener('change', handleSearchControlsChanged);
elements.statusFilter.addEventListener('change', handleSearchControlsChanged);
elements.projectFilter.addEventListener('change', handleSearchControlsChanged);
elements.archiveToggle.addEventListener('change', handleSearchControlsChanged);
elements.subagentToggle?.addEventListener('change', handleSearchControlsChanged);
elements.automationToggle?.addEventListener('change', handleSearchControlsChanged);
elements.autoRefresh.addEventListener('change', syncMonitor);
elements.refreshInterval?.addEventListener('change', syncMonitor);
document.addEventListener('visibilitychange', refreshWhenVisible);
window.addEventListener('focus', refreshWhenVisible);
window.addEventListener('scroll', () => {
  if (isSearchPageOpen()) loadMoreSearchResults();
}, { passive: true });
window.addEventListener('blur', () => {
  if (elements.autoRefresh.checked && document.visibilityState !== 'hidden') {
    scheduleNextMonitorTick();
  } else {
    renderMonitorStatus();
  }
});
elements.notificationToggle.addEventListener('click', () => {
  state.inboxExpanded = !state.inboxExpanded;
  renderNotifications(state.notifications || state.dashboard?.notifications);
});

document.addEventListener('error', (event) => {
  const target = event.target;
  if (target instanceof HTMLImageElement && target.matches('[data-preview-image-thumb]')) {
    markAttachmentPreviewUnavailable(target);
    return;
  }

  if (target instanceof HTMLImageElement && target.matches('[data-artifact-preview-image]')) {
    markArtifactImagePreviewUnavailable(target);
  }
}, true);

document.addEventListener('click', (event) => {
  const clicked = event.target instanceof Element ? event.target : null;
  if (!clicked) return;

  const closeSearchDetailTarget = clicked.closest('[data-close-search-detail]');
  if (closeSearchDetailTarget) {
    event.preventDefault();
    closeSearchDetailModal();
    elements.searchInput?.focus();
    return;
  }

  const closeImagePreviewTarget = clicked.closest('[data-close-image-preview]');
  if (closeImagePreviewTarget) {
    event.preventDefault();
    closeImagePreview();
    return;
  }

  const closeArtifactTimelineTarget = clicked.closest('[data-close-artifact-timeline]');
  if (closeArtifactTimelineTarget) {
    event.preventDefault();
    closeArtifactTimelineModal();
    return;
  }

  const closeArtifactDetailTarget = clicked.closest('[data-close-artifact-detail]');
  if (closeArtifactDetailTarget) {
    event.preventDefault();
    closeArtifactDetailModal();
    return;
  }

  const imagePreviewTarget = clicked.closest('[data-preview-image-src]');
  if (imagePreviewTarget) {
    event.preventDefault();
    openImagePreview(
      imagePreviewTarget.dataset.previewImageSrc,
      imagePreviewTarget.dataset.previewImageTitle || '原图',
    );
    return;
  }

  const artifactTarget = clicked.closest('[data-open-artifact-target-id]');
  if (artifactTarget) {
    event.preventDefault();
    openArtifactTarget(
      artifactTarget.dataset.artifactThreadId,
      artifactTarget.dataset.openArtifactTargetId,
      artifactTarget,
    );
    return;
  }

  const artifactDetailTarget = clicked.closest('[data-open-artifact-detail-id]');
  if (artifactDetailTarget) {
    event.preventDefault();
    openArtifactDetail(
      artifactDetailTarget.dataset.artifactThreadId,
      artifactDetailTarget.dataset.openArtifactDetailId,
    );
    return;
  }

  const artifactTimelineTarget = clicked.closest('[data-open-artifact-timeline-id]');
  if (artifactTimelineTarget) {
    event.preventDefault();
    openArtifactTimeline(artifactTimelineTarget.dataset.openArtifactTimelineId);
    return;
  }

  const inboxToggle = clicked.closest('[data-toggle-inbox]');
  if (inboxToggle) {
    event.preventDefault();
    state.inboxExpanded = !state.inboxExpanded;
    renderNotifications(state.notifications || state.dashboard?.notifications);
    return;
  }

  const openTarget = clicked.closest('[data-open-thread-id]');
  if (openTarget) {
    event.preventDefault();
    openThread(openTarget.dataset.openThreadId, openTarget, {
      notificationId: openTarget.dataset.openNotificationId || '',
    });
    return;
  }

  const topbarTarget = clicked.closest('[data-topbar-action]');
  if (topbarTarget) {
    event.preventDefault();
    focusTopbarAction(topbarTarget.dataset.topbarAction);
    return;
  }

  const copyTarget = clicked.closest('[data-copy-command-id]');
  if (copyTarget) {
    event.preventDefault();
    copyResumeCommand(copyTarget.dataset.copyCommandId);
    return;
  }

  const summaryTarget = clicked.closest('[data-copy-summary-id]');
  if (summaryTarget) {
    event.preventDefault();
    copyThreadSummary(summaryTarget.dataset.copySummaryId);
    return;
  }

  const reviewPanelTarget = clicked.closest('[data-open-review-panel-id]');
  if (reviewPanelTarget) {
    event.preventDefault();
    openReviewPanel(reviewPanelTarget.dataset.openReviewPanelId);
    return;
  }

  const refreshReviewTarget = clicked.closest('[data-refresh-review-jobs-id]');
  if (refreshReviewTarget) {
    event.preventDefault();
    refreshReviewJobs(refreshReviewTarget.dataset.refreshReviewJobsId);
    return;
  }

  const openReviewDetailTarget = clicked.closest('[data-open-review-detail-id]');
  if (openReviewDetailTarget) {
    event.preventDefault();
    openReviewJobDetail(
      openReviewDetailTarget.dataset.reviewDetailThreadId,
      openReviewDetailTarget.dataset.openReviewDetailId,
    );
    return;
  }

  const closeReviewDetailTarget = clicked.closest('[data-close-review-detail-id]');
  if (closeReviewDetailTarget) {
    event.preventDefault();
    closeReviewJobDetail(closeReviewDetailTarget.dataset.closeReviewDetailId);
    return;
  }

  const copyReviewTarget = clicked.closest('[data-copy-review-id]');
  if (copyReviewTarget) {
    event.preventDefault();
    copyReviewResult(copyReviewTarget.dataset.copyReviewId);
    return;
  }

  const copyReviewFixTarget = clicked.closest('[data-copy-review-fix-id]');
  if (copyReviewFixTarget) {
    event.preventDefault();
    copyReviewFixPrompt(copyReviewFixTarget.dataset.copyReviewFixId);
    return;
  }

  const copyOpenReviewFixTarget = clicked.closest('[data-copy-open-review-fix-id]');
  if (copyOpenReviewFixTarget) {
    event.preventDefault();
    copyAndOpenReviewFix(copyOpenReviewFixTarget.dataset.copyOpenReviewFixId, copyOpenReviewFixTarget);
    return;
  }

  const reviewFixStatusTarget = clicked.closest('[data-review-fix-status-id]');
  if (reviewFixStatusTarget) {
    event.preventDefault();
    markReviewFixLoopStatus(
      reviewFixStatusTarget.dataset.reviewFixStatusId,
      reviewFixStatusTarget.dataset.reviewFixStatus,
    );
    return;
  }

  const reviewFixFilterTarget = clicked.closest('[data-review-fix-filter-thread-id]');
  if (reviewFixFilterTarget) {
    event.preventDefault();
    changeReviewFixLoopFilter(
      reviewFixFilterTarget.dataset.reviewFixFilterThreadId,
      reviewFixFilterTarget.dataset.reviewFixFilter,
    );
    return;
  }

  const copyReviewDebugTarget = clicked.closest('[data-copy-review-debug-id]');
  if (copyReviewDebugTarget) {
    event.preventDefault();
    copyReviewDebugInfo(copyReviewDebugTarget.dataset.copyReviewDebugId);
    return;
  }

  const doneTarget = clicked.closest('[data-notification-done-id]');
  if (doneTarget) {
    event.preventDefault();
    markNotificationDone(doneTarget.dataset.notificationDoneId);
    return;
  }

  const notificationMain = clicked.closest('.notification-main[data-thread-id]');
  if (notificationMain) {
    event.preventDefault();
    const notificationItem = notificationMain.closest('[data-notification-id]');
    openThread(notificationMain.dataset.threadId, notificationMain, {
      notificationId: notificationItem?.dataset.notificationId || '',
    });
    return;
  }

  const target = clicked.closest('[data-thread-id]');
  if (!target) return;
  selectThread(target.dataset.threadId);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isArtifactDetailModalOpen()) {
    closeArtifactDetailModal();
    return;
  }

  if (event.key === 'Escape' && isArtifactTimelineModalOpen()) {
    closeArtifactTimelineModal();
    return;
  }

  if (event.key === 'Escape' && isImagePreviewModalOpen()) {
    closeImagePreview();
    return;
  }

  if (event.key === 'Escape' && isSearchDetailModalOpen()) {
    closeSearchDetailModal();
    elements.searchInput?.focus();
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target instanceof Element ? event.target.closest('[data-review-form-thread-id]') : null;
  if (!form) return;
  event.preventDefault();
  submitReview(form);
});

document.addEventListener('change', (event) => {
  const changed = event.target instanceof Element ? event.target : null;
  if (!changed) return;

  const inputModeTarget = changed.closest('[data-review-input-mode-id]');
  if (inputModeTarget) {
    changeReviewInputMode(inputModeTarget.dataset.reviewInputModeId, inputModeTarget.value);
    return;
  }

  const reviewTarget = changed.closest('[data-review-target-provider-id]');
  if (reviewTarget) {
    changeReviewTargetProvider(reviewTarget.dataset.reviewTargetProviderId, reviewTarget.value);
    return;
  }

  const reviewTemplate = changed.closest('[data-review-template-id]');
  if (reviewTemplate) {
    changeReviewTemplate(reviewTemplate.dataset.reviewTemplateId, reviewTemplate.value);
  }
});

document.addEventListener('input', (event) => {
  const changed = event.target instanceof Element ? event.target : null;
  if (!changed) return;

  const customInstruction = changed.closest('[data-review-custom-instruction-id]');
  if (customInstruction) {
    updateCustomReviewInstruction(customInstruction.dataset.reviewCustomInstructionId, customInstruction.value);
  }
});

window.addEventListener('hashchange', syncPageViewFromLocation);
syncPageViewFromLocation();
initializeInstallPrompt();
initializeLaunchHandling();
registerServiceWorker();
initializeMonitor();
startPendingSummarySync();
loadDashboard({ force: true });
