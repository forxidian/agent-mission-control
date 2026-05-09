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
};

const elements = {
  autoRefresh: document.querySelector('#auto-refresh'),
  archiveToggle: document.querySelector('#archive-toggle'),
  detail: document.querySelector('#detail'),
  inbox: document.querySelector('#inbox'),
  lastUpdated: document.querySelector('#last-updated'),
  monitorStatus: document.querySelector('#monitor-status'),
  notificationButton: document.querySelector('#notification-button'),
  notificationTestButton: document.querySelector('#notification-test-button'),
  notificationCount: document.querySelector('#notification-count'),
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
  const notificationSummary = state.notifications?.summary || {};
  const realtimeQuota = summary.quota?.realtime;
  const weeklyQuota = summary.quota?.weekly;
  const pendingCount = notificationSummary.activeCount ?? summary.inboxCount;
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
      note: `${pendingCount || 0} 项需要处理`,
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
    <section class="summary-section" aria-labelledby="lifetime-summary-heading">
      <div class="summary-section-heading">
        <h2 id="lifetime-summary-heading">长期累计</h2>
        <p>线程与 token 总账</p>
      </div>
      <div class="summary-card-grid summary-card-grid-lifetime">
        ${lifetimeItems.map(summaryCard).join('')}
      </div>
    </section>
    ${renderProviderStrip(state.dashboard?.providers || summary.providers || [])}
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

  if (!state.selectedThreadId || !threads.some((thread) => thread.id === state.selectedThreadId)) {
    state.selectedThreadId = threads[0].id;
  }

  elements.threads.innerHTML = threads.map((thread) => {
    const isSelected = thread.id === state.selectedThreadId;
    const openDisabled = canOpenThread(thread) ? '' : ' disabled';
    const turnDuration = currentTurnDuration(thread);
    return `
      <article class="thread-row ${isSelected ? 'is-selected' : ''}">
        <button class="thread-main" type="button" data-thread-id="${escapeHtml(thread.id)}" aria-pressed="${isSelected}">
          <div>${statusMarkup(thread.status)}</div>
          <div>
            <div class="thread-title">${escapeHtml(thread.title)}</div>
            <div class="thread-meta">
              <span>${escapeHtml(providerLabel(thread))}</span>
              <span>${escapeHtml(thread.projectName)}</span>
              <span>${escapeHtml(thread.model || '未知模型')}</span>
              <span>${escapeHtml(relativeTime(thread.updatedAtMs))}</span>
              ${turnDuration ? `<span>本轮 ${escapeHtml(turnDuration)}</span>` : ''}
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

  renderDetail(threads.find((thread) => thread.id === state.selectedThreadId));
}

function renderNotifications(notifications) {
  const items = notifications?.items || [];
  const summary = notifications?.summary || {};
  elements.notificationCount.textContent = `${summary.activeCount || 0} 项`;

  if (!items.length) {
    elements.inbox.innerHTML = '<p class="empty-state">暂无待处理。</p>';
    return;
  }

  elements.inbox.innerHTML = items.map((notification) => `
    <article class="notification-item ${notification.status === 'unread' ? 'is-unread' : ''}">
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
        >打开并标记已处理</button>
        <button class="action-button secondary" type="button" data-notification-done-id="${escapeHtml(notification.id)}">标记已处理</button>
        <button class="action-button secondary" type="button" data-notification-snooze-id="${escapeHtml(notification.id)}">稍后提醒</button>
      </div>
    </article>
  `).join('');
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

function renderDetail(thread) {
  if (!thread) {
    elements.detail.innerHTML = '<p class="empty-state">选择一个线程查看本地信号。</p>';
    return;
  }

  const lastTokens = thread.lastTokenUsage?.total_tokens;
  const openDisabled = canOpenThread(thread) ? '' : ' disabled';
  const turnDuration = currentTurnDuration(thread);
  const rolloutLine = thread.rolloutPath
    ? `<div class="path-line">${escapeHtml(thread.rolloutPath)}</div>`
    : '';
  const commandLine = thread.resumeCommand
    ? `<div class="path-line">${escapeHtml(thread.resumeCommand)}</div>`
    : '';
  const pendingTools = Array.isArray(thread.pendingTools)
    ? thread.pendingTools
    : (Array.isArray(thread.openCodePendingTools) ? thread.openCodePendingTools : []);
  const openTodos = (Array.isArray(thread.todos)
    ? thread.todos
    : (Array.isArray(thread.openCodeTodos) ? thread.openCodeTodos : []))
    .filter((todo) => !['completed', 'done', 'cancelled', 'canceled'].includes(String(todo.status || '').toLowerCase()));
  const sourceLabel = providerLabel(thread);
  const permissionLine = pendingTools.length
    ? `<p class="message-line">${escapeHtml(sourceLabel)} 等待处理：${escapeHtml(pendingTools.map((tool) => tool.title || tool.tool || '工具调用').slice(0, 3).join('、'))}</p>`
    : '';
  const todoLine = openTodos.length
    ? `<p class="message-line">${escapeHtml(sourceLabel)} todo：${openTodos.length} 项未完成</p>`
    : '';
  elements.detail.innerHTML = `
    <div class="detail-heading">
      <div>
        <p class="eyebrow">当前任务</p>
        <h2>${escapeHtml(thread.title)}</h2>
      </div>
      <div class="detail-actions" aria-label="当前线程操作">
        <button class="action-button primary" type="button" data-open-thread-id="${escapeHtml(thread.id)}"${openDisabled}>${escapeHtml(openLabel(thread))}</button>
        <button class="action-button secondary" type="button" data-copy-command-id="${escapeHtml(thread.id)}">复制命令</button>
      </div>
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
        <span>今日 token</span>
        <strong>${escapeHtml(formatTokens(thread.todayTokenUsage))}</strong>
      </div>
      <div class="detail-cell">
        <span>总 token</span>
        <strong>${escapeHtml(formatTokens(thread.tokensUsed))}</strong>
      </div>
      <div class="detail-cell">
        <span>最近一轮</span>
        <strong>${lastTokens ? escapeHtml(formatTokens(lastTokens)) : '-'}</strong>
      </div>
      <div class="detail-cell">
        <span>本轮耗时</span>
        <strong>${turnDuration ? escapeHtml(turnDuration) : '-'}</strong>
      </div>
    </div>
    <div class="path-line">${escapeHtml(thread.cwd || '无工作目录')}</div>
    ${rolloutLine}
    ${commandLine}
    ${permissionLine}
    ${todoLine}
    ${thread.lastAgentMessage ? `<p class="message-line">${escapeHtml(thread.lastAgentMessage)}</p>` : ''}
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
  renderNotificationButton();
  renderMonitorStatus();
}

function renderNotificationButton() {
  const enabled = Boolean(state.notifications?.settings?.desktopNotificationsEnabled);
  elements.notificationButton.textContent = enabled ? '桌面提醒已开启' : '开启桌面提醒';
  elements.notificationButton.classList.toggle('is-enabled', enabled);
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
  renderNotificationButton();
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

async function enableDesktopNotifications() {
  try {
    const response = await fetch('/api/notification-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ desktopNotificationsEnabled: true }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    state.notifications = {
      ...(state.notifications || { summary: {}, items: [] }),
      settings: body,
    };
    renderNotificationButton();
    showNotice('桌面提醒已开启。系统通知只显示「Codex 有新进展待处理」。');
  } catch (error) {
    showError(`无法开启桌面提醒：${error.message}`);
  }
}

async function sendTestNotification() {
  try {
    const response = await fetch('/api/notification-test', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    showNotice('测试提醒已发送。系统通知只显示「Codex 有新进展待处理」；如果没看到，请检查 macOS 通知权限和专注模式。');
  } catch (error) {
    showError(`无法发送测试提醒：${error.message}`);
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
elements.notificationButton.addEventListener('click', enableDesktopNotifications);
elements.notificationTestButton.addEventListener('click', sendTestNotification);
elements.searchInput.addEventListener('input', renderThreads);
elements.providerFilter.addEventListener('change', renderThreads);
elements.statusFilter.addEventListener('change', renderThreads);
elements.projectFilter.addEventListener('change', renderThreads);
elements.archiveToggle.addEventListener('change', renderThreads);
elements.autoRefresh.addEventListener('change', syncMonitor);

document.addEventListener('click', (event) => {
  const clicked = event.target instanceof Element ? event.target : null;
  if (!clicked) return;

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
