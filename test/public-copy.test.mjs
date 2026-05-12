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
    '复制评审结果',
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
