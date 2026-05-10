const state = {
  dashboard: null,
  notifications: null,
  selectedThreadId: null,
  autoTimer: null,
  heartbeatTimer: null,
  isLoading: false,
  nextRefreshAtMs: null,
  lastRefreshAtMs: null,
  refreshError: '',
  noticeTimer: null,
  inboxExpanded: false,
};

const elements = {
  autoRefresh: document.querySelector('#auto-refresh'),
  archiveToggle: document.querySelector('#archive-toggle'),
  detail: document.querySelector('#detail'),
  inbox: document.querySelector('#inbox'),
  inboxHeading: document.querySelector('#inbox-heading'),
  lastUpdated: document.querySelector('#last-updated'),
  monitorStatus: document.querySelector('#monitor-status'),
  notificationCount: document.querySelector('#notification-count'),
  notificationToggle: document.querySelector('#notification-toggle'),
  providerFilter: document.querySelector('#provider-filter'),
  projectFilter: document.querySelector('#project-filter'),
  projects: document.querySelector('#projects'),
  refreshButton: document.querySelector('#refresh-button'),
  searchInput: document.querySelector('#search-input'),
  statusBanner: document.querySelector('#status-banner'),
  statusFilter: document.querySelector('#status-filter'),
  summary: document.querySelector('#summary'),
  threadCount: document.querySelector('#thread-count'),
  threads: document.querySelector('#threads'),
};

const REFRESH_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 1_000;
const INBOX_PREVIEW_LIMIT = 4;
const MONITOR_STORAGE_KEY = 'codex-mission-control:monitor';
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
  unread: '未读',
  read: '已读',
  snoozed: '稍后提醒',
};

const CLOSED_TODO_STATUSES = new Set(['completed', 'done', 'cancelled', 'canceled']);

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

function formatResetTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '暂无刷新时间';
  return `刷新 ${timeFormat.format(new Date(value))}`;
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

function notificationBreakdown(notifications) {
  const items = notifications?.items || [];
  const softCount = items.filter(isSoftProgressNotification).length;
  return {
    totalCount: notifications?.summary?.activeCount ?? items.length,
    hardCount: Math.max(0, items.length - softCount),
    softCount,
  };
}

function tokenUsageMarkup(thread) {
  return `
    <div class="token-block">
      <span class="token-label">今日</span>
      <strong>${escapeHtml(formatTokens(thread.todayTokenUsage))}</strong>
      <span class="token-history">历史 ${escapeHtml(formatTokens(thread.tokensUsed))}</span>
    </div>
  `;
}

function secondsUntil(timestamp) {
  if (!timestamp) return 0;
  return Math.max(0, Math.ceil((Number(timestamp) - Date.now()) / 1000));
}

function summaryCard({ label, value, note = '', tone = '' }) {
  return `
    <article class="summary-card ${tone ? `summary-${escapeHtml(tone)}` : ''}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${note ? `<small>${escapeHtml(note)}</small>` : ''}
    </article>
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
  if (count > 0) return `${count} 条`;
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

function findThread(threadId) {
  return state.dashboard?.threads?.find((thread) => thread.id === threadId) || null;
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
  ].filter(Boolean).map(escapeHtml).join(' ');
}

function threadTitleMarkup(thread) {
  const isSubagent = isSubagentThread(thread);
  const subagentCount = Number(thread?.subagentCount || 0);
  const badges = [
    isSubagent ? 'Sub' : '',
    !isSubagent && subagentCount > 0 ? 'Host' : '',
    !isSubagent && subagentCount > 0 ? `${subagentCount} Sub` : '',
  ].filter(Boolean);

  return `
    <div class="thread-title-line">
      ${badges.map((badge) => `<span class="thread-kind-badge">${escapeHtml(badge)}</span>`).join('')}
      <span class="thread-title">${escapeHtml(thread.title)}</span>
    </div>
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
  return thread?.openLabel || '打开线程';
}

function canOpenThread(thread) {
  return Boolean(thread?.appDeepLink || thread?.canOpen);
}

function disableButtonBriefly(button, durationMs = 1200) {
  if (!button) return;
  button.disabled = true;
  window.setTimeout(() => {
    button.disabled = false;
  }, durationMs);
}

function markNotificationDoneLocally(notificationId) {
  if (!notificationId || !state.notifications?.items?.length) return;

  const notification = findNotification(notificationId);
  if (!notification) return;

  const summary = state.notifications.summary || {};
  state.notifications.items = state.notifications.items.filter((item) => item.id !== notificationId);
  state.notifications.summary = {
    ...summary,
    activeCount: Math.max(0, Number(summary.activeCount || 0) - 1),
    unreadCount: notification.status === 'unread'
      ? Math.max(0, Number(summary.unreadCount || 0) - 1)
      : Number(summary.unreadCount || 0),
    doneCount: Number(summary.doneCount || 0) + 1,
  };
  renderDashboard();
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
  const realtimeQuota = summary.quota?.realtime;
  const weeklyQuota = summary.quota?.weekly;
  const pendingCount = notificationCounts.hardCount;
  const progressCount = notificationCounts.softCount;
  const providers = state.dashboard?.providers || summary.providers || [];
  const currentItems = [
    {
      label: '实时可用 quota',
      value: formatOptionalPercent(realtimeQuota?.availablePercent),
      note: formatResetTime(realtimeQuota?.resetsAtMs),
      tone: 'quota',
    },
    {
      label: '本周可用 quota',
      value: formatOptionalPercent(weeklyQuota?.availablePercent),
      note: formatResetTime(weeklyQuota?.resetsAtMs),
      tone: 'quota',
    },
    {
      label: '待处理',
      value: pendingCount,
      note: progressCount
        ? `${pendingCount || 0} 项需处理 · ${progressCount} 项新进展`
        : `${pendingCount || 0} 项需要处理`,
      tone: pendingCount > 0 ? 'attention' : '',
    },
    {
      label: '今日 token',
      value: formatTokens(summary.todayTokensUsed),
      note: `${summary.updatedToday || 0} 条线程今天更新`,
    },
    {
      label: '工作中 Agent',
      value: summary.runningThreads || 0,
      note: `${summary.runningThreads || 0} 个正在进行中`,
      tone: summary.runningThreads > 0 ? 'running' : '',
    },
  ];
  const lifetimeItems = [
    {
      label: '累计 token',
      value: formatTokens(summary.totalTokensUsed ?? summary.activeTokensUsed),
      note: '包含归档线程',
    },
    {
      label: '累计线程',
      value: summary.totalThreads,
      note: `${summary.activeThreads || 0} 条活跃线程`,
    },
    {
      label: '活跃线程',
      value: summary.activeThreads,
      note: '未归档线程',
    },
    {
      label: '已归档',
      value: summary.archivedThreads,
      note: '已收起线程',
    },
  ];

  elements.summary.innerHTML = `
    <section class="summary-section summary-section-current" aria-labelledby="current-summary-heading">
      <div class="summary-section-heading">
        <h2 id="current-summary-heading">当前重点</h2>
        <p>quota、待处理和今日消耗</p>
      </div>
      <div class="summary-card-grid">
        ${currentItems.map(summaryCard).join('')}
      </div>
    </section>
    <section class="summary-secondary-row${providers.length ? '' : ' summary-secondary-row-solo'}" aria-label="长期累计与来源接入">
      <section class="summary-section summary-section-lifetime" aria-labelledby="lifetime-summary-heading">
        <div class="summary-section-heading">
          <h2 id="lifetime-summary-heading">长期累计</h2>
          <p>线程与 token 总账</p>
        </div>
        <div class="summary-card-grid summary-card-grid-lifetime">
          ${lifetimeItems.map(summaryCard).join('')}
        </div>
      </section>
      ${renderProviderStrip(providers)}
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

  const query = elements.searchInput.value.trim().toLowerCase();
  const provider = elements.providerFilter.value;
  const status = elements.statusFilter.value;
  const project = elements.projectFilter.value;
  const includeArchived = elements.archiveToggle.checked;

  return state.dashboard.threads.filter((thread) => {
    if (!includeArchived && thread.archived) return false;
    if (provider !== 'all' && thread.provider !== provider) return false;
    if (status !== 'all' && thread.status !== status) return false;
    if (project !== 'all' && thread.cwd !== project) return false;
    if (!query) return true;

    return [
      thread.title,
      thread.projectName,
      thread.providerLabel,
      thread.provider,
      thread.cwd,
      thread.model,
      thread.id,
      threadRelationshipLabel(thread),
      hostThreadLabel(thread),
      thread.agentNickname,
      thread.agentRole,
    ].some((field) => String(field || '').toLowerCase().includes(query));
  });
}

function renderThreads() {
  const threads = filteredThreads();
  elements.threadCount.textContent = `${threads.length} 条`;

  if (!threads.length) {
    const provider = state.dashboard?.providers?.find((item) => item.id === elements.providerFilter.value);
    elements.threads.innerHTML = provider?.status === 'missing'
      ? `<p class="empty-state">${escapeHtml(provider.message || `${provider.label} 未检测到。安装后刷新看板。`)}</p>`
      : '<p class="empty-state">没有匹配线程。</p>';
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
        <button class="thread-main" type="button" data-thread-id="${escapeHtml(thread.id)}" aria-pressed="${isSelected}">
          <div>${statusMarkup(thread.status)}</div>
          <div>
            ${threadTitleMarkup(thread)}
            <div class="thread-meta">
              ${threadMetaItems(thread).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
            </div>
          </div>
          ${tokenUsageMarkup(thread)}
        </button>
        <div class="row-actions" aria-label="线程操作">
          <button class="action-button primary" type="button" data-open-thread-id="${escapeHtml(thread.id)}"${openDisabled}>${escapeHtml(openLabel(thread))}</button>
          <button class="action-button secondary" type="button" data-copy-command-id="${escapeHtml(thread.id)}">复制命令</button>
        </div>
      </article>
    `;
  }).join('');

  renderDetail(arrangedThreads.find((thread) => thread.id === state.selectedThreadId));
}

function renderNotifications(notifications) {
  const items = notifications?.items || [];
  const counts = notificationBreakdown(notifications);
  const activeCount = counts.totalCount || items.length;
  const hiddenCount = Math.max(0, items.length - INBOX_PREVIEW_LIMIT);
  const visibleItems = state.inboxExpanded ? items : items.slice(0, INBOX_PREVIEW_LIMIT);
  const hasHardItems = counts.hardCount > 0;
  const hasSoftItems = counts.softCount > 0;

  if (elements.inboxHeading) {
    elements.inboxHeading.textContent = hasHardItems && hasSoftItems
      ? '待处理 / 新进展'
      : hasSoftItems
        ? '新进展'
        : '待处理';
  }

  elements.notificationCount.textContent = hasHardItems && hasSoftItems
    ? `${counts.hardCount} 待处理 · ${counts.softCount} 新进展`
    : hasSoftItems
      ? `${counts.softCount} 项新进展`
      : `${activeCount} 项`;
  elements.notificationToggle.hidden = hiddenCount === 0;
  elements.notificationToggle.textContent = state.inboxExpanded
    ? '收起'
    : `查看全部 ${activeCount} 项`;
  elements.notificationToggle.setAttribute('aria-expanded', String(state.inboxExpanded));

  if (!items.length) {
    elements.inbox.innerHTML = '<p class="empty-state">暂无待处理或新进展。</p>';
    return;
  }

  elements.inbox.innerHTML = visibleItems.map((notification) => {
    const isSoftProgress = isSoftProgressNotification(notification);
    return `
    <article class="notification-item ${notification.status === 'unread' ? 'is-unread' : ''}" data-notification-kind="${isSoftProgress ? 'progress' : 'action'}">
      <button class="notification-main" type="button" data-thread-id="${escapeHtml(notification.threadId)}">
        <span class="reason">${escapeHtml(notificationLabel(notification))}</span>
        <span class="inbox-title">${escapeHtml(notification.threadTitle || notification.title)}</span>
        <span class="inbox-meta">
          <span>${escapeHtml(notification.projectName || '未知项目')}</span>
          <span>${escapeHtml(NOTIFICATION_STATUS_LABELS[notification.status] || notification.status)}</span>
          <span>${escapeHtml(relativeTime(notification.signalAtMs))}</span>
        </span>
      </button>
      <div class="notification-actions" aria-label="待处理操作">
        <button
          class="action-button primary"
          type="button"
          data-open-thread-id="${escapeHtml(notification.threadId)}"
          data-open-notification-id="${escapeHtml(notification.id)}"
        >${isSoftProgress ? '打开并标记已读' : '打开并标记已处理'}</button>
        <button class="action-button secondary" type="button" data-notification-done-id="${escapeHtml(notification.id)}">${isSoftProgress ? '标记已读' : '标记已处理'}</button>
        <button class="action-button secondary" type="button" data-notification-snooze-id="${escapeHtml(notification.id)}">稍后提醒</button>
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

function renderProjects(projects) {
  if (!projects.length) {
    elements.projects.innerHTML = '<p class="empty-state">暂无活跃项目。</p>';
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
            <span>${project.threadCount} 个线程</span>
            <span>今日 ${escapeHtml(formatTokens(project.todayTokensUsed))}</span>
            <span>历史 ${escapeHtml(formatTokens(project.tokensUsed))}</span>
            <span>${escapeHtml(relativeTime(project.latestUpdatedAtMs))}</span>
          </div>
        </div>
        <div class="project-bar" aria-hidden="true" style="--value: ${width}%"><span></span></div>
      </article>
    `;
  }).join('');
}

function compactSignal(value = '', maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
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
    'Agent Mission Control 线程摘要',
    '用途：粘给新的 Codex 线程接手；只含本地元数据和截断信号，不含完整线程正文。',
    '',
    '状态摘要:',
    `- 线程: ${thread.title || '未命名线程'}`,
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
    '- 先打开或恢复线程确认上下文。',
    '- 优先处理待授权、未完成 todo、等待验收或新进展。',
    '- 不要把这份摘要当作完整线程正文。',
  ].join('\n');
}

function renderDetail(thread) {
  if (!thread) {
    elements.detail.innerHTML = '<p class="empty-state">选择一个线程查看结构化审计信号。</p>';
    return;
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

  elements.detail.innerHTML = `
    <div class="detail-heading">
      <div>
        <p class="eyebrow">单线程审计</p>
        <h2>${escapeHtml(thread.title)}</h2>
      </div>
    </div>
    <div class="detail-layout">
      <section class="detail-section detail-section-wide" aria-labelledby="detail-actions-heading">
        <div class="detail-section-heading">
          <h3 id="detail-actions-heading">下一步动作</h3>
          <p>摘要只包含本地元数据和截断信号，不含完整线程正文。</p>
        </div>
        <div class="detail-actions" aria-label="当前线程操作">
          <button class="action-button primary" type="button" data-open-thread-id="${escapeHtml(thread.id)}"${openDisabled}>${escapeHtml(openLabel(thread))}</button>
          <button class="action-button secondary" type="button" data-copy-command-id="${escapeHtml(thread.id)}">复制命令</button>
          <button class="action-button secondary" type="button" data-copy-summary-id="${escapeHtml(thread.id)}">复制线程摘要</button>
        </div>
      </section>

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
      </section>
    </div>
  `;
}

function renderDashboard() {
  if (!state.dashboard) return;

  renderSummary(state.dashboard.summary);
  renderProviderFilter(state.dashboard.providers || []);
  renderProjectFilter(state.dashboard.projects);
  renderNotifications(state.notifications || state.dashboard.notifications);
  renderProjects(state.dashboard.projects);
  renderThreads();
  elements.lastUpdated.textContent = `已更新 ${timeFormat.format(new Date(state.dashboard.generatedAtMs))}`;
  renderMonitorStatus();
}

function renderMonitorStatus() {
  if (!elements.monitorStatus) return;

  if (!elements.autoRefresh.checked) {
    elements.monitorStatus.textContent = state.lastRefreshAtMs
      ? `监控暂停 · 上次心跳 ${relativeTime(state.lastRefreshAtMs)}`
      : '监控未启动';
    return;
  }

  if (state.isLoading) {
    elements.monitorStatus.textContent = '监控中 · 心跳同步中';
    return;
  }

  if (state.refreshError) {
    elements.monitorStatus.textContent = `心跳异常 · ${secondsUntil(state.nextRefreshAtMs)} 秒后重试`;
    return;
  }

  if (!state.lastRefreshAtMs) {
    elements.monitorStatus.textContent = '监控中 · 等待首次心跳';
    return;
  }

  elements.monitorStatus.textContent = `监控中 · 心跳 ${relativeTime(state.lastRefreshAtMs)} · ${secondsUntil(state.nextRefreshAtMs)} 秒后刷新`;
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

async function loadDashboard({ silent = false } = {}) {
  if (state.isLoading) return;

  state.isLoading = true;
  renderMonitorStatus();
  elements.refreshButton.disabled = true;

  try {
    const response = await fetch('/api/dashboard', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.dashboard = await response.json();
    state.notifications = state.dashboard.notifications || state.notifications;
    await loadNotifications();
    state.lastRefreshAtMs = Date.now();
    state.refreshError = '';
    if (!silent || elements.statusBanner.dataset.tone === 'error') clearError();
    renderDashboard();
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
  state.notifications = await response.json();
}

function selectThread(threadId) {
  state.selectedThreadId = threadId;
  renderThreads();
  document.querySelector('#detail')?.scrollIntoView({ block: 'nearest' });
}

async function copyResumeCommand(threadId) {
  const thread = findThread(threadId);
  if (!thread) {
    showError('找不到这个线程，先刷新看板再试。');
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
    showError('找不到这个线程，先刷新看板再试。');
    return;
  }

  try {
    await copyText(buildThreadSummary(thread));
    showNotice('已复制线程摘要。');
  } catch {
    showError('无法写入剪贴板，请手动复制详情里的线程摘要。');
  }
}

async function openThread(threadId, sourceButton, { notificationId = '' } = {}) {
  const thread = findThread(threadId);
  if (!thread) {
    showError('找不到这个线程，先刷新看板再试。');
    return;
  }

  const resumeCommand = resumeCommandForThread(thread);
  disableButtonBriefly(sourceButton);

  if (thread.appDeepLink) {
    void copyText(resumeCommand).catch(() => {});

    if (notificationId) {
      markNotificationDoneLocally(notificationId);
      void updateNotification(notificationId, { status: 'done' }).catch((error) => {
        showError(`无法持久化已处理状态：${error.message}`);
      });
    }

    const label = providerLabel(thread);
    showNotice(notificationId
      ? `正在切换到 ${label}，并已标记为已处理。`
      : `正在切换到 ${label}。`);
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

    await copyText(body.resumeCommand || resumeCommand).catch(() => {});
    if (notificationId) markNotificationDoneLocally(notificationId);

    const label = providerLabel(thread);
    showNotice(body.opened
      ? `正在打开 ${label}，并已复制命令。`
      : `已复制 ${label} 命令，请在终端继续。`);
    loadDashboard({ silent: true });
  } catch (error) {
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
  await loadNotifications();
  renderDashboard();
  return body;
}

async function markNotificationDone(notificationId) {
  try {
    await updateNotification(notificationId, { status: 'done' });
    showNotice('已标记为已处理。');
  } catch (error) {
    showError(`无法更新待处理状态：${error.message}`);
  }
}

async function snoozeNotification(notificationId) {
  try {
    await updateNotification(notificationId, { status: 'snoozed', snoozeMinutes: 30 });
    showNotice('已稍后提醒，30 分钟后再出现。');
  } catch (error) {
    showError(`无法稍后提醒：${error.message}`);
  }
}

function runMonitorTick() {
  state.nextRefreshAtMs = Date.now() + REFRESH_INTERVAL_MS;
  loadDashboard({ silent: true });
  renderMonitorStatus();
}

function startHeartbeat() {
  if (state.heartbeatTimer) return;
  state.heartbeatTimer = setInterval(renderMonitorStatus, HEARTBEAT_INTERVAL_MS);
}

function syncMonitor() {
  if (state.autoTimer) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }

  localStorage.setItem(MONITOR_STORAGE_KEY, elements.autoRefresh.checked ? '1' : '0');

  if (elements.autoRefresh.checked) {
    state.nextRefreshAtMs = Date.now() + REFRESH_INTERVAL_MS;
    state.autoTimer = setInterval(runMonitorTick, REFRESH_INTERVAL_MS);
  } else {
    state.nextRefreshAtMs = null;
  }

  renderMonitorStatus();
}

function initializeMonitor() {
  const stored = localStorage.getItem(MONITOR_STORAGE_KEY);
  elements.autoRefresh.checked = stored === null ? true : stored === '1';
  startHeartbeat();
  syncMonitor();
}

elements.refreshButton.addEventListener('click', () => loadDashboard());
elements.searchInput.addEventListener('input', renderThreads);
elements.providerFilter.addEventListener('change', renderThreads);
elements.statusFilter.addEventListener('change', renderThreads);
elements.projectFilter.addEventListener('change', renderThreads);
elements.archiveToggle.addEventListener('change', renderThreads);
elements.autoRefresh.addEventListener('change', syncMonitor);
elements.notificationToggle.addEventListener('click', () => {
  state.inboxExpanded = !state.inboxExpanded;
  renderNotifications(state.notifications || state.dashboard?.notifications);
});

document.addEventListener('click', (event) => {
  const clicked = event.target instanceof Element ? event.target : null;
  if (!clicked) return;

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

  const doneTarget = clicked.closest('[data-notification-done-id]');
  if (doneTarget) {
    event.preventDefault();
    markNotificationDone(doneTarget.dataset.notificationDoneId);
    return;
  }

  const snoozeTarget = clicked.closest('[data-notification-snooze-id]');
  if (snoozeTarget) {
    event.preventDefault();
    snoozeNotification(snoozeTarget.dataset.notificationSnoozeId);
    return;
  }

  const target = clicked.closest('[data-thread-id]');
  if (!target) return;
  selectThread(target.dataset.threadId);
});

initializeMonitor();
loadDashboard();
