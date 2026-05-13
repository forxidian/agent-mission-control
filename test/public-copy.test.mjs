import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('uses Chinese copy for visible system fields', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  const publicCopy = `${html}\n${app}`;

  for (const expected of [
    'Agent 任务控制台',
    '本地多 Agent 控制台',
    '等待数据',
    '自动刷新',
    '频率',
    '10 秒',
    '30 秒',
    '60 秒',
    '安装应用',
    '安装为应用',
    '打开应用',
    '打开桌面应用',
    '收起',
    '收起到 Dock',
    '监控未启动',
    '关键指标',
    '搜索',
    '来源',
    '全部来源',
    '状态',
    '项目',
    '全部',
    '当前重点',
    '历史',
    '实时可用 quota',
    '本周可用 quota',
    '今日 token',
    '负载',
    '内存',
    '工作中 Agent',
    'Host 工作中',
    'Sub Agent',
    'Host',
    '长期累计',
    '累计 token',
    '累计任务',
    '桌面端',
    '未检测到',
    '活跃',
    '工作中',
    '温热',
    '空闲',
    '已归档',
    '近期工作',
    '用量',
    '项目排行',
    'token',
    'tokens',
    '最近活动',
    '正在工作',
    '高 token 用量',
    '等待验收',
    '等待授权',
    '打开',
    '复制命令',
    '复制摘要',
    '交给另一个 Agent 评审',
    '评审只会发送当前预览里的最近 Agent 输出，不会读取完整线程正文。',
    '评审输入',
    '最近一轮对话',
    '线程摘要和最近输出',
    '最近一轮会读取并发送更多本地会话内容给目标 CLI Agent。',
    '复制评审结果',
    '复制调试摘要',
    '评审调试摘要',
    'resume 命令',
    '本轮耗时',
    '任务详情',
    '下一步动作',
    '状态摘要',
    '待处理区',
    '运行证据区',
    '最近信号',
    '不含完整内容',
    '待处理',
    '新进展',
    '标记已处理',
  ]) {
    assert.match(publicCopy, new RegExp(expected));
  }

  assert.match(html, /id="auto-refresh" type="checkbox" checked/);

  assert.equal(publicCopy.includes('令牌'), false, 'token should not be translated as 令牌');

  for (const oldCopy of [
    'Local read-only console',
    'Waiting for data',
    'Refresh dashboard',
    'Auto',
    'Thread, project, path',
    'All projects',
    'Recent Work',
    'Attention',
    'No matching threads',
    'Selected thread',
    'Rate limit',
    '测试提醒',
    '开启桌面提醒',
    '桌面提醒已开启',
    '打开线程',
    '打开会话',
    '打开并标记',
    '标记已查看',
    '待查看',
    '稍后提醒',
    '单线程',
    '复制线程摘要',
    '完整线程正文',
    '命中',
    'RSS',
    '重复读盘',
  ]) {
    assert.equal(publicCopy.includes(oldCopy), false, `leftover visible UI copy: ${oldCopy}`);
  }
});

test('declares an installable PWA shell without caching local API payloads', async () => {
  const [html, app, styles, manifest, serviceWorker] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8'),
  ]);
  const manifestJson = JSON.parse(manifest);

  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /id="app-install-button"/);
  assert.match(html, /id="app-minimize-button"/);
  assert.match(app, /beforeinstallprompt/);
  assert.doesNotMatch(app, /beforeunload/);
  assert.match(app, /navigator\.serviceWorker\.register\('\/service-worker\.js'/);
  assert.match(app, /navigator\.getInstalledRelatedApps/);
  assert.match(app, /web\+agentmissioncontrol:open/);
  assert.match(app, /fetch\('\/api\/app\/installed'/);
  assert.match(app, /fetch\('\/api\/app\/open-installed', \{ method: 'POST' \}/);
  assert.match(app, /fetch\('\/api\/app\/minimize-installed', \{ method: 'POST' \}/);
  assert.match(app, /window\.launchQueue\?\.setConsumer/);
  assert.match(styles, /\.pwa-install-button\s*\{/);
  assert.match(styles, /\.pwa-window-button\s*\{/);
  assert.match(styles, /\.pwa-minimize-button:not\(\[hidden\]\)\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(styles, /\.pwa-minimize-button:not\(\[hidden\]\)\s*\{[\s\S]*left:\s*calc\(env\(titlebar-area-x,\s*0px\) \+ 74px\);/);
  assert.match(styles, /\.pwa-minimize-button:not\(\[hidden\]\)\s*\{[\s\S]*backdrop-filter:\s*blur\(12px\);/);
  assert.equal(manifestJson.name, 'Agent Mission Control');
  assert.equal(manifestJson.start_url, '/');
  assert.equal(manifestJson.scope, '/');
  assert.equal(manifestJson.display, 'standalone');
  assert.deepEqual(manifestJson.launch_handler.client_mode, ['focus-existing', 'navigate-existing', 'auto']);
  assert.deepEqual(manifestJson.protocol_handlers, [{
    protocol: 'web+agentmissioncontrol',
    url: '/?launch=%s',
  }]);
  assert.ok(manifestJson.related_applications.some((appInfo) => (
    appInfo.platform === 'webapp'
    && appInfo.url === '/manifest.webmanifest'
    && appInfo.id === '/'
  )));
  assert.ok(manifestJson.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(manifestJson.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'));
  assert.match(serviceWorker, /CACHE_NAME = 'agent-mission-control-shell-v1'/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /event\.request\.mode === 'navigate'/);
});

test('uses topbar metrics as panel shortcuts', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /data-topbar-action="running"/);
  assert.match(app, /data-topbar-action="pending"/);
  assert.match(app, /function focusTopbarAction\(action\)/);
  assert.match(app, /elements\.searchInput\.value = ''/);
  assert.match(app, /elements\.providerFilter\.value = 'all'/);
  assert.match(app, /elements\.statusFilter\.value = 'running'/);
  assert.match(app, /state\.inboxExpanded = true/);
  assert.match(app, /clicked\.closest\('\[data-topbar-action\]'\)/);
  assert.match(styles, /\.topbar-metric-button\s*\{/);
  assert.match(styles, /\.topbar-metric-button:hover\s*\{/);
  assert.match(styles, /\.topbar-metric-button:focus-visible\s*\{/);
});

test('separates soft progress notifications from hard pending work copy', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /function notificationBreakdown\(notifications\)/);
  assert.match(app, /source === 'observed-completion'/);
  assert.match(app, /function reconcileNotificationsWithDashboard\(notifications, dashboard = state\.dashboard\)/);
  assert.match(app, /function shouldSuppressSoftProgressNotification\(notification, dashboard = state\.dashboard\)/);
  assert.match(app, /thread\.status === 'running'/);
  assert.match(app, /continuedAtMs > signalAtMs/);
  assert.match(app, new RegExp('待处理 / 新进展'));
  assert.match(app, /项需处理 · \$\{progressCount\} 项新进展/);
  assert.match(app, />打开<\/button>/);
  assert.match(app, /标记已处理/);
  assert.doesNotMatch(app, /标记已查看/);
  assert.match(app, /SOFT_PROGRESS_STATUS_LABELS/);
});

test('uses conservative automatic refresh behavior for local file scans', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /const DEFAULT_REFRESH_INTERVAL_MS = 30_000;/);
  assert.match(app, /new Set\(\[10_000, 30_000, 60_000\]\)/);
  assert.doesNotMatch(html, /<option value="1000">1 秒<\/option>/);
  assert.match(html, /<option value="30000" selected>30 秒<\/option>/);
  assert.match(app, /const UNFOCUSED_REFRESH_INTERVAL_MS = 60_000;/);
  assert.match(app, /function effectiveRefreshIntervalMs\(\)/);
  assert.match(app, /document\.hasFocus/);
  assert.match(app, /setTimeout\(runMonitorTick, delayMs\)/);
  assert.match(app, /function dashboardDataSignature\(dashboard\)/);
  assert.match(app, /renderDashboardStatusOnly\(\)/);
  assert.match(app, /本地扫描耗时/);
  assert.match(app, /服务内存占用/);
  assert.match(app, /topbarLoadLabel/);
  assert.match(app, /topbarLoadTooltip/);
  assert.match(html, /id="monitor-status-tooltip"/);
  assert.match(app, /复用/);
  assert.match(app, /document\.visibilityState === 'hidden'/);
  assert.match(app, /document\.addEventListener\('visibilitychange', refreshWhenVisible\)/);
  assert.match(app, /loadDashboard\(\{ silent: true \}\)/);
  assert.match(app, /\/api\/dashboard\?force=1/);
});

test('distinguishes sub-agent rows from host agent rows in the thread list', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function arrangeThreadRows\(threads\)/);
  assert.match(app, /thread-kind-badge/);
  assert.match(app, /Host: \$\{host\}/);
  assert.match(app, /Host Agent · \$\{count\} 个 Sub Agent/);
  assert.match(styles, /\.thread-row\.is-subagent\s*\{/);
  assert.match(styles, /\.thread-row\.is-subagent \.thread-main::before\s*\{/);
  assert.match(styles, /\.thread-kind-badge\s*\{/);
});

test('does not expose per-thread rate limit copy', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  for (const staleThreadCopy of [
    '限流用量',
    '速率限制',
    '速率限制已用量',
  ]) {
    assert.equal(app.includes(staleThreadCopy), false, `stale per-thread quota copy: ${staleThreadCopy}`);
  }
});

test('renders grouped quota rows for multiple LLM families without adding extra metric cards', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function quotaSummaryCards\(quota\)/);
  assert.match(app, /const groups = Array\.isArray\(quota\?\.groups\) \? quota\.groups : \[\]/);
  assert.match(app, /rows: quotaRows\(groups, 'realtime'\)/);
  assert.match(app, /rows: quotaRows\(groups, 'weekly'\)/);
  assert.match(app, /暂无 quota 信号/);
  assert.match(app, /summary-card-with-lines/);
  assert.match(styles, /\.summary-card-with-lines\s*\{/);
  assert.match(styles, /\.summary-card-line\s*\{/);
  assert.match(styles, /\.summary-card-line-label\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
});

test('clamps long thread and notification titles in list views', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.thread-title[\s\S]*-webkit-line-clamp: 2/);
  assert.match(styles, /\.inbox-title[\s\S]*-webkit-line-clamp: 4/);
});

test('keeps priority inbox as a page-flow preview instead of an inner scroller', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /const INBOX_PREVIEW_LIMIT = 4/);
  assert.match(app, /items\.slice\(0, INBOX_PREVIEW_LIMIT\)/);
  assert.match(app, /data-toggle-inbox/);
  assert.match(styles, /\.priority-inbox-list\s*\{\s*overflow: visible;\s*\}/);
  assert.doesNotMatch(styles, /\.priority-inbox-list\s*\{[^}]*overflow: auto/);
});

test('lets the desktop thread list fill the stretched left panel', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /--work-panel-height:\s*min\(960px,\s*max\(640px,\s*calc\(100vh - 180px\)\)\);/);
  assert.doesNotMatch(styles, /\.layout\s*\{[^}]*align-items:\s*start;/);
  assert.match(styles, /\.thread-panel\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/);
  assert.match(styles, /\.thread-panel\s*\{[\s\S]*height:\s*var\(--work-panel-height\);/);
  assert.match(styles, /\.thread-list\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*auto;/);
  assert.match(styles, /\.side-rail > \.panel\s*\{[\s\S]*max-height:\s*var\(--work-panel-height\);/);
  assert.match(styles, /\.project-list\s*\{[\s\S]*overflow:\s*auto;/);
});

test('prioritizes today token usage while retaining historical usage in thread rows', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function tokenUsageMarkup\(thread\)/);
  assert.match(app, /<span class="token-label">今日<\/span>/);
  assert.match(app, /<strong>\$\{escapeHtml\(formatTokens\(thread\.todayTokenUsage\)\)\}<\/strong>/);
  assert.match(app, /历史 \$\{escapeHtml\(formatTokens\(thread\.tokensUsed\)\)\}/);
  assert.match(styles, /\.token-history/);
});

test('keeps thread list row actions compact on smaller screens', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  const listStart = app.indexOf('function renderThreads()');
  const listEnd = app.indexOf('function renderNotifications', listStart);
  const listSource = app.slice(listStart, listEnd);
  const detailStart = app.indexOf('function renderDetail(');
  const detailEnd = app.indexOf('function renderDashboard', detailStart);
  const detailSource = app.slice(detailStart, detailEnd);

  assert.notEqual(listStart, -1);
  assert.notEqual(listEnd, -1);
  assert.doesNotMatch(listSource, /data-copy-command-id/);
  assert.match(detailSource, /data-copy-command-id/);
  assert.match(styles, /\.row-actions,[\s\S]*\.detail-actions\s*\{[\s\S]*flex-wrap:\s*wrap;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.thread-row\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.controls > \.toggle\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.summary-section-heading\s*\{[\s\S]*flex-direction:\s*column;/);
});

test('opens thread deep links without waiting for the local server round trip', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function openThread');
  const end = app.indexOf('async function updateNotification', start);
  const openThreadSource = app.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(openThreadSource, /window\.location\.href = thread\.appDeepLink/);
  assert.ok(
    openThreadSource.indexOf('window.location.href = thread.appDeepLink') < openThreadSource.indexOf('fetch(`/api/threads/'),
    'Codex deep link path should run before the server opener fallback',
  );
});

test('marks notifications done optimistically without a full notification refresh', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const doneStart = app.indexOf('async function markNotificationDone');
  const doneEnd = app.indexOf('function runMonitorTick', doneStart);
  const updateStart = app.indexOf('async function updateNotification');
  const updateEnd = app.indexOf('async function markNotificationDone', updateStart);
  const loadStart = app.indexOf('async function loadDashboard');
  const loadEnd = app.indexOf('async function loadNotifications', loadStart);
  const doneSource = app.slice(doneStart, doneEnd);
  const updateSource = app.slice(updateStart, updateEnd);
  const loadSource = app.slice(loadStart, loadEnd);

  assert.notEqual(doneStart, -1);
  assert.notEqual(doneEnd, -1);
  assert.notEqual(updateStart, -1);
  assert.notEqual(updateEnd, -1);
  assert.match(doneSource, /markNotificationDoneLocally\(notificationId\)/);
  assert.ok(
    doneSource.indexOf('markNotificationDoneLocally(notificationId)')
      < doneSource.indexOf('await updateNotification(notificationId'),
    'Done clicks should update the visible inbox before waiting on persistence',
  );
  assert.doesNotMatch(updateSource, /loadNotifications\(/);
  assert.doesNotMatch(loadSource, /loadNotifications\(/);
});

test('offers privacy-limited thread summary copy from the detail panel', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /function buildThreadSummary\(thread\)/);
  assert.match(app, /function copyThreadSummary\(threadId\)/);
  assert.match(app, /data-copy-summary-id/);
  assert.match(app, /只含本地元数据和截断信号，不含完整内容/);
  assert.match(app, /用户输入信号/);
  assert.match(app, /Agent 输出信号/);
});

test('limits latest-turn review input selector to Codex threads', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  const constStart = app.indexOf('const REVIEW_INPUT_MODES =');
  const constEnd = app.indexOf('];', constStart) + 2;
  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTimestamp', escapeStart);
  const codexStart = app.indexOf('function isCodexReviewThread');
  const optionsEnd = app.indexOf('\nfunction reviewInputPrivacyHint', codexStart);

  assert.notEqual(constStart, -1);
  assert.notEqual(escapeStart, -1);
  assert.notEqual(codexStart, -1);

  const context = { codexOptions: '', claudeOptions: '' };
  vm.runInNewContext(`
    ${app.slice(constStart, constEnd)}
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(codexStart, optionsEnd)}
    codexOptions = reviewInputModeOptions('latest-turn', { provider: 'codex' });
    claudeOptions = reviewInputModeOptions('latest-turn', { provider: 'claude-code-cli' });
  `, context);

  assert.match(context.codexOptions, /value="latest-turn"/);
  assert.doesNotMatch(context.claudeOptions, /value="latest-turn"/);
  assert.match(context.claudeOptions, /value="thread-summary"/);
});

test('preserves selected review target options across detail rerenders', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTimestamp', escapeStart);
  const optionsStart = app.indexOf('function reviewTargetOptions');
  const optionsEnd = app.indexOf('\nfunction buildReviewDebugSummary', optionsStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(escapeEnd, -1);
  assert.notEqual(optionsStart, -1);
  assert.notEqual(optionsEnd, -1);

  const context = { options: '' };
  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(optionsStart, optionsEnd)}
    options = reviewTargetOptions({
      items: [
        { provider: 'codex-cli', label: 'Codex CLI', available: true },
        { provider: 'claude-code-cli', label: 'Claude Code CLI', available: true },
        { provider: 'opencode', label: 'OpenCode CLI', available: true }
      ]
    }, 'claude-code-cli');
  `, context);

  assert.match(context.options, /value="claude-code-cli" selected/);
  assert.doesNotMatch(context.options, /value="codex-cli" selected/);
});

test('stores selected review target when target selector changes', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const changeStart = app.indexOf('function changeReviewTargetProvider');
  const changeEnd = app.indexOf('\nasync function submitReview', changeStart);

  assert.notEqual(changeStart, -1);
  assert.notEqual(changeEnd, -1);

  const context = {
    renders: 0,
    state: {
      review: {
        targetProviderByThread: new Map(),
      },
    },
    renderSelectedDetail() {
      globalThis.renders += 1;
    },
  };

  globalThis.renders = context.renders;
  try {
    vm.runInNewContext(`
      ${app.slice(changeStart, changeEnd)}
      changeReviewTargetProvider('thread-1', 'claude-code-cli');
    `, context);
    context.renders = globalThis.renders;
  } finally {
    delete globalThis.renders;
  }

  assert.equal(context.state.review.targetProviderByThread.get('thread-1'), 'claude-code-cli');
  assert.equal(context.renders, 1);
});

test('refreshes review input preview when input mode changes', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const keyStart = app.indexOf('function reviewContentKey');
  const keyEnd = app.indexOf('\nfunction selectedReviewInputMode', keyStart);
  const changeStart = app.indexOf('async function changeReviewInputMode');
  const changeEnd = app.indexOf('\nasync function refreshReviewJobs', changeStart);

  assert.notEqual(keyStart, -1);
  assert.notEqual(keyEnd, -1);
  assert.notEqual(changeStart, -1);
  assert.notEqual(changeEnd, -1);

  const context = {
    requested: [],
    renders: 0,
    notices: [],
    state: {
      review: {
        inputModeByThread: new Map(),
        contentByThread: new Map(),
        contentErrorsByThread: new Map(),
        isLoading: false,
      },
    },
    async loadReviewContent(threadId, mode) {
      globalThis.requested.push([threadId, mode]);
      return { threadId, mode, preview: 'preview' };
    },
    renderSelectedDetail() {
      globalThis.renders += 1;
    },
    showError(message) {
      globalThis.notices.push(message);
    },
  };

  globalThis.requested = context.requested;
  globalThis.renders = context.renders;
  globalThis.notices = context.notices;
  try {
    await vm.runInNewContext(`
      ${app.slice(keyStart, keyEnd)}
      ${app.slice(changeStart, changeEnd)}
      changeReviewInputMode('thread-1', 'thread-summary');
    `, context);
    context.renders = globalThis.renders;
  } finally {
    delete globalThis.requested;
    delete globalThis.renders;
    delete globalThis.notices;
  }

  assert.deepEqual(context.requested, [['thread-1', 'thread-summary']]);
  assert.equal(context.state.review.inputModeByThread.get('thread-1'), 'thread-summary');
  assert.equal(context.state.review.isLoading, false);
  assert.equal(context.renders >= 2, true);
  assert.deepEqual(context.notices, []);
});

test('submits review jobs with the selected input mode payload', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const submitStart = app.indexOf('async function submitReview');
  const submitEnd = app.indexOf('\nasync function copyReviewResult', submitStart);

  assert.notEqual(submitStart, -1);
  assert.notEqual(submitEnd, -1);

  class FakeFormData {
    constructor(form) {
      this.form = form;
    }

    get(key) {
      return this.form.values[key] || '';
    }
  }

  const context = {
    payload: null,
    notices: [],
    state: {
      review: {
        isLoading: false,
        jobsByThread: new Map(),
      },
    },
    FormData: FakeFormData,
    JSON,
    findThread(threadId) {
      return threadId === 'thread-1' ? { id: threadId } : null;
    },
    renderSelectedDetail() {},
    async fetchJson(_url, options) {
      globalThis.payload = JSON.parse(options.body);
      return { job: { id: 'review-1', status: 'queued' } };
    },
    reviewJobsForThread() {
      return [];
    },
    showNotice(message) {
      globalThis.notices.push(message);
    },
    showError(message) {
      globalThis.notices.push(message);
    },
    async refreshReviewJobs() {},
    syncReviewPolling() {},
    selectedReviewInputMode() {
      return 'latest-agent-signal';
    },
  };

  globalThis.payload = context.payload;
  globalThis.notices = context.notices;
  try {
    await vm.runInNewContext(`
      ${app.slice(submitStart, submitEnd)}
      submitReview({
        dataset: { reviewFormThreadId: 'thread-1' },
        values: {
          targetProvider: 'claude-code-cli',
          targetModel: 'sonnet',
          templateId: 'technical-review',
          inputMode: 'latest-turn'
        }
      });
    `, context);
    context.payload = globalThis.payload;
  } finally {
    delete globalThis.payload;
    delete globalThis.notices;
  }

  assert.deepEqual(context.payload, {
    sourceThreadId: 'thread-1',
    targetProvider: 'claude-code-cli',
    targetModel: 'sonnet',
    templateId: 'technical-review',
    inputMode: 'latest-turn',
  });
  assert.equal(context.state.review.jobsByThread.get('thread-1')[0].id, 'review-1');
  assert.deepEqual(context.notices, ['评审任务已启动。']);
});

test('renders and submits custom review instructions when custom template is selected', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const panelStart = app.indexOf('function renderReviewPanel');
  const panelEnd = app.indexOf('\nfunction renderDetail', panelStart);
  const submitStart = app.indexOf('async function submitReview');
  const submitEnd = app.indexOf('\nasync function copyReviewResult', submitStart);

  assert.notEqual(panelStart, -1);
  assert.notEqual(panelEnd, -1);
  assert.notEqual(submitStart, -1);
  assert.notEqual(submitEnd, -1);
  assert.match(app, /custom-review/);
  assert.match(app, /customReviewInstruction/);

  class FakeFormData {
    constructor(form) {
      this.form = form;
    }

    get(key) {
      return this.form.values[key] || '';
    }
  }

  const context = {
    html: '',
    payload: null,
    notices: [],
    state: {
      review: {
        openThreadId: 'thread-1',
        targets: { items: [{ provider: 'codex-cli', available: true }] },
        isLoading: false,
        selectedJobIdByThread: new Map(),
        templateByThread: new Map([['thread-1', 'custom-review']]),
        customInstructionByThread: new Map([['thread-1', '只检查串台风险']]),
        jobsByThread: new Map(),
      },
    },
    FormData: FakeFormData,
    JSON,
    escapeHtml(value = '') {
      return String(value);
    },
    selectedReviewInputMode() {
      return 'latest-agent-signal';
    },
    reviewContentForThread() {
      return { preview: '输入预览' };
    },
    reviewContentErrorForThread() {
      return '';
    },
    reviewJobsForThread() {
      return [];
    },
    selectedReviewTargetProvider() {
      return 'codex-cli';
    },
    selectedReviewTemplate() {
      return 'custom-review';
    },
    reviewTargetOptions() {
      return '<option>Codex CLI</option>';
    },
    reviewInputModeOptions() {
      return '<option>最近 Agent 输出</option>';
    },
    reviewTemplateOptions() {
      return '<option value="custom-review" selected>自定义审查</option>';
    },
    reviewNotificationOptInMarkup() {
      return '';
    },
    reviewInputPrivacyHint() {
      return '隐私提示';
    },
    renderReviewJobs() {
      return '';
    },
    renderReviewJobDetail() {
      return '';
    },
    findThread(threadId) {
      return threadId === 'thread-1' ? { id: threadId } : null;
    },
    renderSelectedDetail() {},
    async fetchJson(_url, options) {
      globalThis.payload = JSON.parse(options.body);
      return { job: { id: 'review-1', status: 'queued' } };
    },
    showNotice(message) {
      globalThis.notices.push(message);
    },
    showError(message) {
      globalThis.notices.push(message);
    },
    async refreshReviewJobs() {},
    syncReviewPolling() {},
  };

  globalThis.payload = context.payload;
  globalThis.notices = context.notices;
  try {
    vm.runInNewContext(`
      ${app.slice(panelStart, panelEnd)}
      html = renderReviewPanel({ id: 'thread-1' });
    `, context);

    await vm.runInNewContext(`
      ${app.slice(submitStart, submitEnd)}
      submitReview({
        dataset: { reviewFormThreadId: 'thread-1' },
        values: {
          targetProvider: 'codex-cli',
          targetModel: '',
          templateId: 'custom-review',
          inputMode: 'latest-agent-signal',
          customReviewInstruction: '只检查串台风险'
        }
      });
    `, context);
    context.payload = globalThis.payload;
  } finally {
    delete globalThis.payload;
    delete globalThis.notices;
  }

  assert.match(context.html, /自定义审查/);
  assert.match(context.html, /name="customReviewInstruction"/);
  assert.match(context.html, /只检查串台风险/);
  assert.equal(context.payload.templateId, 'custom-review');
  assert.equal(context.payload.customReviewInstruction, '只检查串台风险');
});

test('renders browser review notification opt-in only before permission is granted', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const helperStart = app.indexOf('function canUseBrowserNotifications');
  const helperEnd = app.indexOf('\nfunction isReviewTerminalStatus', helperStart);
  const panelStart = app.indexOf('function renderReviewPanel');
  const panelEnd = app.indexOf('\nfunction renderDetail', panelStart);

  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  assert.notEqual(panelStart, -1);
  assert.notEqual(panelEnd, -1);

  const baseContext = (permission) => ({
    html: '',
    Notification: { permission },
    state: {
      review: {
        openThreadId: 'thread-1',
        targets: { items: [{ provider: 'codex-cli', available: true }] },
        isLoading: false,
        selectedJobIdByThread: new Map(),
        customInstructionByThread: new Map(),
      },
    },
    escapeHtml(value = '') {
      return String(value);
    },
    selectedReviewInputMode() {
      return 'latest-agent-signal';
    },
    reviewContentForThread() {
      return { preview: '输入预览' };
    },
    reviewContentErrorForThread() {
      return '';
    },
    reviewJobsForThread() {
      return [];
    },
    selectedReviewTargetProvider() {
      return 'codex-cli';
    },
    selectedReviewTemplate() {
      return 'technical-review';
    },
    reviewTargetOptions() {
      return '<option>Codex CLI</option>';
    },
    reviewInputModeOptions() {
      return '<option>最近 Agent 输出</option>';
    },
    reviewTemplateOptions() {
      return '<option>技术方案审查</option>';
    },
    reviewNotificationOptInMarkup() {
      return '';
    },
    reviewInputPrivacyHint() {
      return '隐私提示';
    },
    renderReviewJobs() {
      return '';
    },
    renderReviewJobDetail() {
      return '';
    },
  });

  const defaultContext = baseContext('default');
  vm.runInNewContext(`
    ${app.slice(helperStart, helperEnd)}
    ${app.slice(panelStart, panelEnd)}
    html = renderReviewPanel({ id: 'thread-1' });
  `, defaultContext);

  const grantedContext = baseContext('granted');
  vm.runInNewContext(`
    ${app.slice(helperStart, helperEnd)}
    ${app.slice(panelStart, panelEnd)}
    html = renderReviewPanel({ id: 'thread-1' });
  `, grantedContext);

  assert.match(defaultContext.html, /开启评审结果通知/);
  assert.doesNotMatch(grantedContext.html, /开启评审结果通知/);
});

test('requests browser permission when review notification opt-in is clicked', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const requestStart = app.indexOf('async function requestReviewBrowserNotifications');
  const requestEnd = app.indexOf('\nfunction openReviewJobDetail', requestStart);

  assert.notEqual(requestStart, -1);
  assert.notEqual(requestEnd, -1);

  const context = {
    requested: 0,
    rendered: 0,
    notices: [],
    Notification: {
      permission: 'default',
      async requestPermission() {
        globalThis.requested += 1;
        this.permission = 'granted';
        return 'granted';
      },
    },
    canUseBrowserNotifications() {
      return true;
    },
    renderSelectedDetail() {
      globalThis.rendered += 1;
    },
    showNotice(message) {
      globalThis.notices.push(message);
    },
    showError(message) {
      globalThis.notices.push(message);
    },
  };

  globalThis.requested = context.requested;
  globalThis.rendered = context.rendered;
  globalThis.notices = context.notices;
  try {
    await vm.runInNewContext(`
      ${app.slice(requestStart, requestEnd)}
      requestReviewBrowserNotifications();
    `, context);
    context.requested = globalThis.requested;
    context.rendered = globalThis.rendered;
  } finally {
    delete globalThis.requested;
    delete globalThis.rendered;
    delete globalThis.notices;
  }

  assert.equal(context.requested, 1);
  assert.equal(context.rendered, 1);
  assert.deepEqual(context.notices, ['评审结果通知已开启。']);
});

test('sends one browser notification when a running review job completes', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const helperStart = app.indexOf('function canUseBrowserNotifications');
  const loadStart = app.indexOf('async function loadReviewJobs');
  const loadEnd = app.indexOf('\nfunction renderSelectedDetail', loadStart);

  assert.notEqual(helperStart, -1);
  assert.notEqual(loadStart, -1);
  assert.notEqual(loadEnd, -1);

  const notifications = [];
  function FakeNotification(title, options) {
    notifications.push({ title, options });
  }
  FakeNotification.permission = 'granted';

  const context = {
    Notification: FakeNotification,
    state: {
      review: {
        jobsByThread: new Map([[
          'thread-1',
          [{ id: 'review-1', status: 'running', target: { label: 'Claude Code CLI' } }],
        ]]),
        notifiedJobIds: new Set(),
      },
    },
    async fetch() {
      return {
        ok: true,
        async json() {
          return {
            items: [{ id: 'review-1', status: 'succeeded', target: { label: 'Claude Code CLI' } }],
          };
        },
      };
    },
    reviewStatusLabel(status) {
      return status === 'succeeded' ? '已完成' : status;
    },
    reviewJobsForThread(threadId) {
      return context.state.review.jobsByThread.get(threadId) || [];
    },
  };

  await vm.runInNewContext(`
    ${app.slice(helperStart, loadStart)}
    ${app.slice(loadStart, loadEnd)}
    loadReviewJobs('thread-1');
  `, context);

  await vm.runInNewContext(`
    loadReviewJobs('thread-1');
  `, context);

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, '评审已完成');
  assert.match(notifications[0].options.body, /Claude Code CLI/);
});

test('builds and wires copyable review debug summaries', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const buildStart = app.indexOf('function buildReviewDebugSummary');
  const buildEnd = app.indexOf('\nfunction renderReviewJobs', buildStart);
  const copyStart = app.indexOf('async function copyReviewDebugInfo');
  const copyEnd = app.indexOf('\nasync function openThread', copyStart);

  assert.notEqual(buildStart, -1);
  assert.notEqual(buildEnd, -1);
  assert.notEqual(copyStart, -1);
  assert.notEqual(copyEnd, -1);
  assert.match(app, /data-copy-review-debug-id/);

  const context = {
    copied: '',
    notices: [],
    state: {
      review: {
        jobsByThread: new Map([[
          'thread-1',
          [{
            id: 'review-1',
            status: 'failed',
            templateId: 'technical-review',
            inputMode: 'latest-turn',
            source: { title: '源线程', providerLabel: 'Codex' },
            target: { label: 'Claude Code CLI', provider: 'claude-code-cli', runner: 'claude-print', model: 'sonnet' },
            error: 'Runner failed',
            stderr: 'permission denied',
            timedOut: false,
            exitCode: 1,
            truncatedResult: true,
          }],
        ]]),
      },
    },
    reviewStatusLabel(status) {
      return status === 'failed' ? '失败' : status;
    },
    formatTimestamp() {
      return '-';
    },
    async copyText(value) {
      globalThis.copied = value;
    },
    showNotice(message) {
      globalThis.notices.push(message);
    },
    showError(message) {
      globalThis.notices.push(message);
    },
  };

  globalThis.copied = context.copied;
  globalThis.notices = context.notices;
  try {
    await vm.runInNewContext(`
      ${app.slice(buildStart, buildEnd)}
      ${app.slice(copyStart, copyEnd)}
      copyReviewDebugInfo('review-1');
    `, context);
    context.copied = globalThis.copied;
  } finally {
    delete globalThis.copied;
    delete globalThis.notices;
  }

  assert.match(context.copied, /Agent Mission Control 评审调试摘要/);
  assert.match(context.copied, /- job: review-1/);
  assert.match(context.copied, /- 输入模式: latest-turn/);
  assert.match(context.copied, /- 目标: Claude Code CLI/);
  assert.match(context.copied, /- stderr: permission denied/);
  assert.deepEqual(context.notices, ['已复制评审调试摘要。']);
});

test('renders review result details with safe fix loop actions', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTimestamp', escapeStart);
  const statusStart = app.indexOf('function reviewStatusLabel');
  const statusEnd = app.indexOf('\nfunction reviewTemplateOptions', statusStart);
  const detailStart = app.indexOf('function renderReviewJobDetail');
  const detailEnd = app.indexOf('\nfunction renderReviewJobs', detailStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(escapeEnd, -1);
  assert.notEqual(statusStart, -1);
  assert.notEqual(statusEnd, -1);
  assert.notEqual(detailStart, -1);
  assert.notEqual(detailEnd, -1);
  assert.match(app, /data-open-review-detail-id/);
  assert.match(app, /data-copy-review-fix-id/);

  const context = {
    html: '',
    formatTimestamp(value) {
      return value ? '2026-05-13 10:00' : '-';
    },
  };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(statusStart, statusEnd)}
    ${app.slice(detailStart, detailEnd)}
    html = renderReviewJobDetail({
      id: 'review-1',
      status: 'succeeded',
      templateId: 'technical-review',
      inputMode: 'latest-turn',
      inputPreview: '原始输入预览',
      resultText: '评审完整结果',
      resultPreview: '评审预览',
      source: { threadId: 'thread-1', title: '源线程', providerLabel: 'Codex', projectName: 'agent-mission-control' },
      target: { label: 'Claude Code CLI', provider: 'claude-code-cli', model: 'sonnet' },
      stderr: '',
      error: ''
    });
  `, context);

  assert.match(context.html, /评审结果详情/);
  assert.match(context.html, /源线程/);
  assert.match(context.html, /Claude Code CLI/);
  assert.match(context.html, /评审完整结果/);
  assert.match(context.html, /data-copy-review-fix-id="review-1"/);
  assert.match(context.html, /data-open-thread-id="thread-1"/);
  assert.match(styles, /\.review-job-detail pre\s*\{[\s\S]*max-height:\s*none;/);
});

test('keeps review history visually separated from the selected detail pane', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(app, /review-results-divider/);
  assert.match(app, /review-results-layout/);
  assert.match(app, /review-records-column/);
  assert.match(app, /review-detail-column/);
  assert.match(app, /选择左侧记录查看详情/);
  assert.match(app, /review-job-meta/);
  assert.match(styles, /\.review-form\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.review-results-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(260px,\s*0\.75fr\)\s*minmax\(0,\s*1\.45fr\);/);
  assert.match(styles, /\.review-records-column\s*\{[\s\S]*overflow:\s*visible;/);
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*\.review-results-layout,[\s\S]*grid-template-columns:\s*1fr;/);
});

test('renders selected review history items with metadata and highlight state', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTimestamp', escapeStart);
  const statusStart = app.indexOf('function reviewStatusLabel');
  const statusEnd = app.indexOf('\nfunction reviewTemplateOptions', statusStart);
  const jobsStart = app.indexOf('function renderReviewJobs');
  const jobsEnd = app.indexOf('\nfunction renderReviewPanel', jobsStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(escapeEnd, -1);
  assert.notEqual(statusStart, -1);
  assert.notEqual(statusEnd, -1);
  assert.notEqual(jobsStart, -1);
  assert.notEqual(jobsEnd, -1);

  const context = {
    html: '',
    formatTimestamp(value) {
      return value ? '2026-05-13 16:00' : '-';
    },
  };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(statusStart, statusEnd)}
    ${app.slice(jobsStart, jobsEnd)}
    html = renderReviewJobs([
      {
        id: 'review-1',
        status: 'succeeded',
        templateId: 'technical-review',
        completedAtMs: 1778660000000,
        resultPreview: '完整性检查通过',
        source: { threadId: 'thread-1' },
        target: { label: 'Claude Code CLI' },
      },
      {
        id: 'review-2',
        status: 'running',
        templateId: 'response-quality-review',
        startedAtMs: 1778660100000,
        source: { threadId: 'thread-1' },
        target: { label: 'Codex CLI' },
      },
    ], 'review-1');
  `, context);

  assert.match(context.html, /review-job is-selected/);
  assert.match(context.html, /technical-review · 2026-05-13 16:00/);
  assert.match(context.html, /Claude Code CLI/);
  assert.match(context.html, /完整性检查通过/);
});

test('renders review detail empty state beside the history list when no job is selected', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const panelStart = app.indexOf('function renderReviewPanel');
  const panelEnd = app.indexOf('\nfunction renderDetail', panelStart);

  assert.notEqual(panelStart, -1);
  assert.notEqual(panelEnd, -1);

  const context = {
    html: '',
    state: {
      review: {
        openThreadId: 'thread-1',
        targets: { items: [{ provider: 'codex-cli', available: true }] },
        isLoading: false,
        selectedJobIdByThread: new Map(),
        customInstructionByThread: new Map(),
      },
    },
    escapeHtml(value = '') {
      return String(value);
    },
    selectedReviewInputMode() {
      return 'latest-agent-signal';
    },
    reviewContentForThread() {
      return { preview: '输入预览' };
    },
    reviewContentErrorForThread() {
      return '';
    },
    reviewJobsForThread() {
      return [{ id: 'review-1', status: 'succeeded' }];
    },
    selectedReviewTargetProvider() {
      return 'codex-cli';
    },
    selectedReviewTemplate() {
      return 'technical-review';
    },
    reviewTargetOptions() {
      return '<option>Codex CLI</option>';
    },
    reviewInputModeOptions() {
      return '<option>最近 Agent 输出</option>';
    },
    reviewTemplateOptions() {
      return '<option>技术方案审查</option>';
    },
    reviewInputPrivacyHint() {
      return '隐私提示';
    },
    renderReviewJobs() {
      return '<div class="review-job-list">历史记录</div>';
    },
    reviewNotificationOptInMarkup() {
      return '';
    },
    renderReviewJobDetail() {
      throw new Error('detail should not render without a selected job');
    },
  };

  vm.runInNewContext(`
    ${app.slice(panelStart, panelEnd)}
    html = renderReviewPanel({ id: 'thread-1' });
  `, context);

  assert.match(context.html, /review-results-layout/);
  assert.match(context.html, /review-records-column/);
  assert.match(context.html, /review-detail-column/);
  assert.match(context.html, /历史记录/);
  assert.match(context.html, /选择左侧记录查看详情/);
});

test('keeps auto refresh from rerendering while review form is focused', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const activeStart = app.indexOf('function hasActiveReviewInteraction');
  const loadStart = app.indexOf('async function loadDashboard');
  const loadEnd = app.indexOf('\nasync function loadNotifications', loadStart);

  assert.notEqual(activeStart, -1);
  assert.notEqual(loadStart, -1);
  assert.notEqual(loadEnd, -1);

  const context = {
    renders: 0,
    state: {
      dashboard: null,
      isLoading: false,
      refreshError: '',
      lastRefreshAtMs: null,
    },
    elements: {
      refreshButton: { disabled: false },
      statusBanner: { dataset: { tone: '' } },
    },
    async fetch() {
      return {
        ok: true,
        async json() {
          return {
            generatedAtMs: 1778659200000,
            notifications: { items: [], summary: { activeCount: 0 } },
          };
        },
      };
    },
    setNotifications() {},
    fallbackNotificationsFromDashboard() {
      return { items: [], summary: { activeCount: 0 } };
    },
    renderMonitorStatus() {},
    clearError() {},
    showError(message) {
      throw new Error(message);
    },
    renderDashboard() {
      globalThis.renders += 1;
    },
    hasActiveReviewInteraction() {
      return true;
    },
    Date,
  };

  globalThis.renders = context.renders;
  try {
    await vm.runInNewContext(`
      ${app.slice(activeStart, loadStart)}
      ${app.slice(loadStart, loadEnd)}
      loadDashboard({ silent: true });
    `, context);
    context.renders = globalThis.renders;
  } finally {
    delete globalThis.renders;
  }

  assert.equal(context.state.dashboard.generatedAtMs, 1778659200000);
  assert.equal(context.renders, 0);
});

test('refreshes the open review input preview after dashboard refresh', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const loadStart = app.indexOf('async function loadDashboard');
  const loadEnd = app.indexOf('\nasync function loadNotifications', loadStart);

  assert.notEqual(loadStart, -1);
  assert.notEqual(loadEnd, -1);

  const context = {
    refreshed: 0,
    renders: 0,
    state: {
      dashboard: null,
      isLoading: false,
      refreshError: '',
      lastRefreshAtMs: null,
      review: {
        openThreadId: 'thread-1',
      },
    },
    elements: {
      refreshButton: { disabled: false },
      statusBanner: { dataset: { tone: '' } },
    },
    async fetch() {
      return {
        ok: true,
        async json() {
          return {
            threads: [{ id: 'thread-1', lastAgentMessage: '新的 Agent 输出' }],
            notifications: [],
          };
        },
      };
    },
    Date: { now: () => 123 },
    setNotifications() {},
    fallbackNotificationsFromDashboard() {
      return [];
    },
    clearError() {},
    renderMonitorStatus() {},
    renderDashboard() {
      globalThis.renders += 1;
    },
    hasActiveReviewInteraction() {
      return false;
    },
    async refreshOpenReviewContent() {
      globalThis.refreshed += 1;
    },
  };

  globalThis.refreshed = context.refreshed;
  globalThis.renders = context.renders;
  try {
    await vm.runInNewContext(`
      ${app.slice(loadStart, loadEnd)}
      loadDashboard();
    `, context);
    context.refreshed = globalThis.refreshed;
    context.renders = globalThis.renders;
  } finally {
    delete globalThis.refreshed;
    delete globalThis.renders;
  }

  assert.equal(context.refreshed, 1);
  assert.equal(context.renders, 1);
});

test('does not pause review job rerenders just because a detail is open', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const activeStart = app.indexOf('function hasActiveReviewInteraction');
  const activeEnd = app.indexOf('\nfunction syncReviewPolling', activeStart);

  assert.notEqual(activeStart, -1);
  assert.notEqual(activeEnd, -1);

  class FakeElement {
    closest() {
      return null;
    }
  }

  const context = {
    result: null,
    Element: FakeElement,
    document: {
      activeElement: new FakeElement(),
    },
    state: {
      review: {
        openThreadId: 'thread-1',
        selectedJobIdByThread: new Map([['thread-1', 'review-1']]),
      },
    },
  };

  vm.runInNewContext(`
    ${app.slice(activeStart, activeEnd)}
    result = hasActiveReviewInteraction();
  `, context);

  assert.equal(context.result, false);
});

test('copies a safe fix prompt from a completed review job', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const buildStart = app.indexOf('function buildReviewFixPrompt');
  const buildEnd = app.indexOf('\nfunction renderReviewJobDetail', buildStart);
  const copyStart = app.indexOf('async function copyReviewFixPrompt');
  const copyEnd = app.indexOf('\nasync function openThread', copyStart);

  assert.notEqual(buildStart, -1);
  assert.notEqual(buildEnd, -1);
  assert.notEqual(copyStart, -1);
  assert.notEqual(copyEnd, -1);

  const context = {
    copied: '',
    notices: [],
    state: {
      review: {
        jobsByThread: new Map([[
          'thread-1',
          [{
            id: 'review-1',
            status: 'succeeded',
            templateId: 'technical-review',
            inputMode: 'latest-turn',
            inputPreview: '源 Agent 输出预览',
            resultText: '请补测试并简化实现。',
            source: { threadId: 'thread-1', title: '源线程', providerLabel: 'Codex', projectName: 'agent-mission-control' },
            target: { label: 'Claude Code CLI', provider: 'claude-code-cli', model: 'sonnet' },
          }],
        ]]),
      },
    },
    async copyText(value) {
      globalThis.copied = value;
    },
    showNotice(message) {
      globalThis.notices.push(message);
    },
    showError(message) {
      globalThis.notices.push(message);
    },
  };

  globalThis.copied = context.copied;
  globalThis.notices = context.notices;
  try {
    await vm.runInNewContext(`
      ${app.slice(buildStart, buildEnd)}
      ${copyStart && copyEnd ? app.slice(copyStart, copyEnd) : ''}
      copyReviewFixPrompt('review-1');
    `, context);
    context.copied = globalThis.copied;
  } finally {
    delete globalThis.copied;
    delete globalThis.notices;
  }

  assert.match(context.copied, /请继续处理这条跨 Agent 评审意见/);
  assert.match(context.copied, /源线程/);
  assert.match(context.copied, /Claude Code CLI/);
  assert.match(context.copied, /请补测试并简化实现。/);
  assert.match(context.copied, /不要假设这里包含完整线程历史/);
  assert.deepEqual(context.notices, ['已复制修复 Prompt。']);
});

test('formats token totals with compact M and B units for consistent scanning', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const match = app.match(/function formatTokens\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'formatTokens should exist');

  const context = { result: null };
  vm.runInNewContext(`
    ${match[0]}
    result = [
      formatTokens(0),
      formatTokens(40_000),
      formatTokens(403_337),
      formatTokens(1_000_000),
      formatTokens(47_200_000),
      formatTokens(2_015_000_000),
      formatTokens(12_500_000_000)
    ];
  `, context);

  assert.deepEqual(Array.from(context.result), ['0M', '<0.1M', '0.4M', '1M', '47.2M', '2.02B', '12.5B']);
});
