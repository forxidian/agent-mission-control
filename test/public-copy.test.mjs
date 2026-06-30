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
    '隐藏',
    '隐藏面板',
    '收起',
    '监控未启动',
    '关键指标',
    '搜索',
    '来源',
    '全部来源',
    '状态',
    '项目',
    '全部',
    '显示 Sub Agent',
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
    '最近线程',
    '搜索历史',
    '搜索线程',
    '全量历史',
    '打开搜索',
    '返回看板',
    '线程详情',
    '关闭',
    '继续向下滚动加载更多',
    '已加载全部匹配线程',
    '用量',
    '项目历史',
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
    '评审只会发送当前预览里的最近 Agent 输出，不会读取完整内容，也不会直接修改源代码，请放心评审。',
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
  assert.match(html, /id="subagent-toggle" type="checkbox"/);
  assert.doesNotMatch(html, /id="subagent-toggle" type="checkbox" checked/);
  assert.match(html, /id="automation-toggle" type="checkbox"/);
  assert.doesNotMatch(html, /id="automation-toggle" type="checkbox" checked/);

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

test('renders success notices in a fixed toast region', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  const showStart = app.indexOf('function showStatus');
  const showEnd = app.indexOf('\nasync function loadDashboard', showStart);

  assert.notEqual(showStart, -1);
  assert.notEqual(showEnd, -1);
  assert.match(html, /id="status-toast"/);
  assert.match(html, /class="status-toast"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(styles, /\.status-toast\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(styles, /\.status-toast\s*\{[\s\S]*z-index:\s*80;/);

  const context = {
    timerCallback: null,
    state: {
      noticeTimer: null,
    },
    elements: {
      statusBanner: {
        hidden: true,
        dataset: {},
        textContent: '',
      },
      statusToast: {
        hidden: true,
        dataset: {},
        textContent: '',
      },
    },
    clearTimeout() {},
    setTimeout(callback) {
      globalThis.timerCallback = callback;
      return 1;
    },
  };

  globalThis.timerCallback = null;
  try {
    vm.runInNewContext(`
      ${app.slice(showStart, showEnd)}
      showNotice('已复制评审结果。下一步：粘贴到源线程或记录里继续处理。');
    `, context);
  } finally {
    context.timerCallback = globalThis.timerCallback;
    delete globalThis.timerCallback;
  }

  assert.equal(context.elements.statusToast.hidden, false);
  assert.equal(context.elements.statusToast.dataset.tone, 'notice');
  assert.equal(context.elements.statusToast.textContent, '已复制评审结果。下一步：粘贴到源线程或记录里继续处理。');
  assert.equal(context.elements.statusBanner.hidden, false);
  assert.equal(typeof context.timerCallback, 'function');
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
  assert.match(html, /id="app-hide-button"/);
  assert.match(app, /beforeinstallprompt/);
  assert.doesNotMatch(app, /beforeunload/);
  assert.match(app, /navigator\.serviceWorker\.register\('\/service-worker\.js'/);
  assert.match(app, /navigator\.getInstalledRelatedApps/);
  assert.match(app, /web\+agentmissioncontrol:open/);
  assert.match(app, /fetch\('\/api\/app\/installed'/);
  assert.match(app, /fetch\('\/api\/app\/open-installed', \{ method: 'POST' \}/);
  assert.match(app, /fetch\('\/api\/app\/hide-installed', \{ method: 'POST' \}/);
  assert.match(app, /window\.launchQueue\?\.setConsumer/);
  assert.match(styles, /\.pwa-install-button\s*\{/);
  assert.match(styles, /\.pwa-window-button\s*\{/);
  assert.match(styles, /\.pwa-window-control-stack\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(styles, /\.pwa-window-control-stack\s*\{[\s\S]*left:\s*calc\(env\(titlebar-area-x,\s*0px\) \+ 74px\);/);
  assert.match(styles, /\.pwa-floating-button:not\(\[hidden\]\)\s*\{[\s\S]*backdrop-filter:\s*blur\(12px\);/);
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

test('documents the 0.4 mock screenshot set for thread list, search, and artifacts', async () => {
  const [readme, screenshotScript] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/capture-mock-screenshot.mjs', import.meta.url), 'utf8'),
  ]);

  for (const expected of [
    'Prompt 打包与工作台总览',
    '全历史搜索',
    '线程素材时间线',
    'docs/assets/agent-mission-control-real-ui.png',
    'docs/assets/agent-mission-control-search-ui.png',
    'docs/assets/agent-mission-control-artifacts-ui.png',
  ]) {
    assert.match(readme, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(readme, /不包含本机线程、路径、消息、token、素材文件或 quota 细节/);
  assert.match(screenshotScript, /searchOutputPath/);
  assert.match(screenshotScript, /artifactsOutputPath/);
  assert.match(screenshotScript, /promptPackScreenshotFixture/);
  assert.match(screenshotScript, /README 首屏更新/);
  assert.match(screenshotScript, /Release notes 双语补充/);
  assert.match(screenshotScript, /视觉验收重点/);
  assert.match(screenshotScript, /prompt-pack-segment"\)\.length >= 3/);
  assert.match(screenshotScript, /prompt-pack-attachment"\)\.length >= 2/);
  assert.match(screenshotScript, /#search/);
  assert.match(screenshotScript, /artifact-timeline-modal/);
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

test('renders a local prompt pack composer for segmented copy-and-paste requests', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="prompt-pack-panel"/);
  assert.match(html, /id="prompt-pack-segments"/);
  assert.match(html, /id="prompt-pack-add-segment"/);
  assert.match(html, /id="prompt-pack-copy"/);
  assert.match(html, /id="prompt-pack-clear"/);
  assert.match(html, /Prompt 打包/);
  assert.match(html, /class="prompt-pack-stage dashboard-view"/);
  assert.match(html, /class="[^"]*prompt-pack-top[^"]*"/);
  assert.doesNotMatch(html, /class="panel prompt-pack-top"/);
  assert.doesNotMatch(html, /class="panel prompt-pack-segments"/);
  assert.doesNotMatch(
    html.slice(html.indexOf('<section id="prompt-pack-panel"'), html.indexOf('</section>', html.indexOf('<section id="prompt-pack-panel"'))),
    /id="open-search-page"/,
  );
  assert.match(
    html.slice(html.indexOf('<section id="prompt-pack-panel"'), html.indexOf('</section>', html.indexOf('<section id="prompt-pack-panel"'))),
    /id="prompt-pack-segments"/,
  );
  assert.match(`${html}\n${app}`, /粘贴图片或选择文件/);
  assert.match(app, /PROMPT_PACK_STORAGE_KEY/);
  assert.match(app, /function createPromptPackSegment/);
  assert.match(app, /function uploadPromptPackAttachment/);
  assert.match(app, /\/api\/prompt-packs\/\$\{encodeURIComponent\(state\.promptPack\.id\)\}\/attachments/);
  assert.match(app, /function promptPackMarkdown/);
  assert.match(app, /请按段落编号处理/);
  assert.match(app, /如果你能读取本机文件/);
  assert.match(app, /function handlePromptPackPaste/);
  assert.match(app, /function handlePromptPackFileChange/);
  assert.match(app, /data-prompt-pack-add-file-id/);
  assert.match(styles, /\.prompt-pack-stage\s*\{/);
  assert.match(styles, /\.prompt-pack-panel\s*\{/);
  assert.match(styles, /\.prompt-pack-panel\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.match(styles, /\.prompt-pack-panel\s*\{[\s\S]*grid-template-areas:[\s\S]*"prompt"[\s\S]*"segments";/);
  assert.match(styles, /\.prompt-pack-panel\s*\{[\s\S]*filter:\s*drop-shadow\(0 18px 50px rgba\(25,\s*23,\s*18,\s*0\.08\)\);/);
  assert.match(styles, /\.prompt-pack-top\s*\{[\s\S]*grid-area:\s*prompt;[\s\S]*border:\s*1px solid var\(--line\);[\s\S]*border-radius:\s*8px;/);
  assert.match(styles, /\.prompt-pack-panel:has\(\.prompt-pack-segments:not\(:empty\)\) \.prompt-pack-top\s*\{[\s\S]*border-bottom:\s*0;/);
  assert.match(styles, /\.prompt-pack-segments\s*\{[\s\S]*grid-area:\s*segments;[\s\S]*padding:\s*16px;/);
  assert.match(styles, /\.prompt-pack-segments\s*\{[\s\S]*border:\s*1px solid var\(--line\);[\s\S]*border-radius:\s*0 0 8px 8px;/);
  assert.match(styles, /\.prompt-pack-segment\s*\{/);
  assert.match(styles, /\.prompt-pack-dropzone\s*\{/);
  assert.match(styles, /\.prompt-pack-attachment-list\s*\{/);
});

test('supports lightweight prompt pack insertion and drag sorting between segments', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /prompt-pack-toolbar-add/);
  assert.match(html, /id="prompt-pack-add-segment"[\s\S]*<span aria-hidden="true" class="prompt-pack-toolbar-add-icon">\+<\/span>[\s\S]*<span>新增段落<\/span>/);
  assert.match(app, /function promptPackInsertRowMarkup/);
  assert.match(app, /data-prompt-pack-insert-after-id/);
  assert.match(app, /data-prompt-pack-drag-id/);
  assert.match(app, /draggable="true"/);
  assert.match(app, /function movePromptPackSegmentToIndex/);
  assert.match(app, /function handlePromptPackSegmentDragStart/);
  assert.match(app, /function handlePromptPackDocumentDragOver/);
  assert.match(app, /function handlePromptPackDocumentDrop/);
  assert.match(styles, /\.prompt-pack-toolbar-add\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*gap:\s*6px;[\s\S]*padding:\s*0 10px 0 8px;/);
  assert.match(styles, /\.prompt-pack-toolbar-add-icon\s*\{/);
  assert.match(styles, /\.prompt-pack-insert-row\s*\{/);
  assert.match(styles, /\.prompt-pack-insert-row\s*\{[\s\S]*min-height:\s*44px;[\s\S]*margin:\s*4px 0;/);
  assert.match(styles, /\.prompt-pack-insert-button\s*\{/);
  assert.match(styles, /\.prompt-pack-drag-handle\s*\{/);
  assert.match(styles, /\.prompt-pack-segment\.is-dragging\s*\{/);
});

test('keeps the prompt pack composer collapsed until a segment is added', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function createPromptPackId');
  const end = app.indexOf('\nfunction promptPackFilesFromDataTransfer', start);
  const localStorageStore = new Map();
  const context = {
    state: { promptPack: null },
    elements: {
      promptPackSegments: { innerHTML: '' },
      promptPackCount: { textContent: '' },
    },
    localStorage: {
      getItem(key) { return localStorageStore.get(key) || null; },
      setItem(key, value) { localStorageStore.set(key, String(value)); },
    },
    Date,
    Math,
    Number,
    String,
    Set,
    Array,
    formatBytes(value) { return `${value} B`; },
    escapeHtml(value = '') { return String(value); },
    result: null,
  };

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  vm.runInNewContext(`
    const PROMPT_PACK_STORAGE_KEY = 'agent-mission-control:prompt-pack';
    ${app.slice(start, end)}
    const created = createPromptPack();
    state.promptPack = created;
    renderPromptPack();
    const initial = {
      segmentCount: created.segments.length,
      renderedSegments: elements.promptPackSegments.innerHTML.match(/<article class="prompt-pack-segment"/g)?.length || 0,
      countText: elements.promptPackCount.textContent,
    };
    addPromptPackSegment();
    const afterAdd = {
      segmentCount: state.promptPack.segments.length,
      renderedSegments: elements.promptPackSegments.innerHTML.match(/<article class="prompt-pack-segment"/g)?.length || 0,
      countText: elements.promptPackCount.textContent,
    };
    removePromptPackSegment(state.promptPack.segments[0].id);
    const afterRemoveLast = {
      segmentCount: state.promptPack.segments.length,
      renderedSegments: elements.promptPackSegments.innerHTML.match(/<article class="prompt-pack-segment"/g)?.length || 0,
      countText: elements.promptPackCount.textContent,
    };
    result = { initial, afterAdd, afterRemoveLast };
  `, context);

  const result = JSON.parse(JSON.stringify(context.result));

  assert.deepEqual(result.initial, {
    segmentCount: 0,
    renderedSegments: 0,
    countText: '0 段 · 0 附件',
  });
  assert.deepEqual(result.afterAdd, {
    segmentCount: 1,
    renderedSegments: 1,
    countText: '1 段 · 0 附件',
  });
  assert.deepEqual(result.afterRemoveLast, {
    segmentCount: 0,
    renderedSegments: 0,
    countText: '0 段 · 0 附件',
  });
});

test('explains stale local server when prompt pack attachment endpoint is unavailable', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function uploadPromptPackAttachment');
  const end = app.indexOf('\nfunction uploadPromptPackFiles', start);
  const source = app.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(source, /response\.status === 405/);
  assert.match(source, /本地 AMC 服务还是旧版本/);
  assert.match(source, /error: error\.message/);
  assert.match(app, /保存失败：/);
  assert.match(app, /attachment\.error/);
});

test('counts soft progress notifications in the same pending work copy', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /function notificationBreakdown\(notifications\)/);
  assert.match(app, /source === 'observed-completion'/);
  assert.match(app, /function reconcileNotificationsWithDashboard\(notifications, dashboard = state\.dashboard\)/);
  assert.match(app, /function shouldSuppressSoftProgressNotification\(notification, dashboard = state\.dashboard\)/);
  assert.match(app, /thread\.status === 'running'/);
  assert.match(app, /continuedAtMs > signalAtMs/);
  assert.match(app, /elements\.inboxHeading\.textContent = '待处理'/);
  assert.match(app, /note: `\$\{pendingCount \|\| 0\} 项需要处理`/);
  assert.match(app, /const pendingCount = counts\.totalCount/);
  assert.match(app, />打开<\/button>/);
  assert.match(app, /标记已处理/);
  assert.doesNotMatch(app, /标记已查看/);
  assert.doesNotMatch(app, /待处理 \/ 新进展/);
  assert.doesNotMatch(app, /项新进展/);
  assert.doesNotMatch(app, /unread: '待查看'/);
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
  assert.match(app, /const PENDING_SUMMARY_POLL_INTERVAL_MS = 10_000;/);
  assert.match(app, /\/api\/pending-summary/);
  assert.match(app, /function pendingSummaryDiffers\(summary\)/);
  assert.match(app, /loadDashboard\(\{ silent: true, force: true \}\)/);
  assert.match(app, /startPendingSummarySync\(\)/);
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
  assert.match(styles, /\.thread-row\.is-subagent,\s*\.search-result-row\.is-subagent\s*\{/);
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

test('keeps the dashboard summary compact above the first-screen search entry', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function summaryStripItem/);
  assert.match(app, /summary-section-compact/);
  assert.match(app, /summary-meta-row/);
  assert.match(app, /summary-lifetime-strip/);
  assert.match(app, /summary-strip-items/);
  assert.doesNotMatch(app, /summary-card-grid-lifetime/);
  assert.match(styles, /\.summary-section-compact\s*\{[\s\S]*padding:\s*10px 12px 12px;/);
  assert.match(styles, /\.summary-card\s*\{[\s\S]*min-height:\s*78px;/);
  assert.match(styles, /\.summary-lifetime-strip,[\s\S]*\.provider-strip\s*\{[\s\S]*min-height:\s*58px;/);
  assert.match(styles, /\.provider-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(styles, /\.search-launcher\s*\{[\s\S]*min-height:\s*58px;/);
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
  assert.match(styles, /\.layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(styles, /\.thread-panel\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/);
  assert.match(styles, /\.thread-panel\s*\{[\s\S]*height:\s*var\(--work-panel-height\);/);
  assert.match(styles, /\.thread-list\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*auto;/);
  assert.match(styles, /\.project-history-panel\s*\{[\s\S]*grid-template-rows:\s*auto auto;/);
  assert.match(styles, /\.project-list\s*\{[\s\S]*overflow:\s*auto;/);
});

test('renders today and history token usage together in thread rows', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function tokenUsageMarkup\(thread\)/);
  assert.match(app, /const todayTokens = Number\(thread\?\.todayTokenUsage \|\| 0\);/);
  assert.match(app, /const historyTokens = Number\(thread\?\.tokensUsed \|\| 0\);/);
  assert.match(app, /今日 \$\{escapeHtml\(formatTokens\(todayTokens\)\)\}/);
  assert.match(app, /历史 \$\{escapeHtml\(formatTokens\(historyTokens\)\)\}/);
  assert.match(styles, /\.token-history/);
});

test('renders token breakdown bars and info affordances', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /const TOKEN_BREAKDOWN_ITEMS = \[/);
  assert.match(app, /label: '新输入'/);
  assert.match(app, /label: '缓存复用'/);
  assert.match(app, /label: '缓存写入'/);
  assert.match(app, /label: '未细分'/);
  assert.match(app, /function tokenBreakdownBarMarkup\(breakdown/);
  assert.match(app, /function tokenBreakdownInfoMarkup\(breakdown/);
  assert.match(app, /function positionTokenBreakdownPopover\(container\)/);
  assert.match(app, /handleTokenBreakdownPosition/);
  assert.match(app, /class="token-info-button"/);
  assert.match(app, /class="summary-token-breakdown"/);
  assert.match(app, /projectTokenUsageMarkup\(project, 'today'\)/);
  assert.match(styles, /\.token-breakdown-bar/);
  assert.match(styles, /\.token-breakdown-popover/);
  assert.match(styles, /\.token-info-button/);
  assert.match(styles, /\.summary-token-breakdown/);
  assert.match(styles, /\.detail-token-breakdown/);
});

test('renders token breakdown hover popovers in a viewport-level layer', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function ensureTokenBreakdownPopoverLayer\(\)/);
  assert.match(app, /document\.body\.append\(layer\)/);
  assert.match(app, /function renderFloatingTokenBreakdownPopover\(container\)/);
  assert.match(app, /document\.addEventListener\('pointerout', handleTokenBreakdownExit\)/);
  assert.match(styles, /\.token-breakdown-popover-layer\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(styles, /\.token-breakdown-popover-layer\s*\{[\s\S]*z-index:\s*120;/);
  assert.match(styles, /\.token-breakdown-popover-layer\s+\.token-breakdown-popover\s*\{[\s\S]*display:\s*grid;/);
});

test('uses visually distinct token breakdown colors with segment dividers', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const tokenColorEntries = [...styles.matchAll(/--token-(input|cache-read|cache-write|output|reasoning|uncategorized):\s*(#[0-9a-f]{6});/gi)];
  const tokenColors = Object.fromEntries(tokenColorEntries.map((match) => [match[1], match[2].toLowerCase()]));

  for (const key of ['input', 'cache-read', 'cache-write', 'output', 'reasoning', 'uncategorized']) {
    assert.ok(tokenColors[key], `missing --token-${key} color`);
  }

  const rgb = (hex) => hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16));
  const distance = (left, right) => {
    const [lr, lg, lb] = rgb(left);
    const [rr, rg, rb] = rgb(right);
    return Math.hypot(lr - rr, lg - rg, lb - rb);
  };
  const pairs = Object.entries(tokenColors).flatMap(([leftKey, leftColor], index, entries) => (
    entries.slice(index + 1).map(([rightKey, rightColor]) => [leftKey, rightKey, distance(leftColor, rightColor)])
  ));

  for (const [leftKey, rightKey, colorDistance] of pairs) {
    assert.ok(colorDistance >= 80, `${leftKey} and ${rightKey} token colors are too similar`);
  }

  assert.match(styles, /\.token-breakdown-segment\s*\+\s*\.token-breakdown-segment\s*\{[\s\S]*box-shadow:/);
});

test('search controls only request hidden thread classes when their toggles are checked', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function searchParamsFromControls');
  const end = app.indexOf('\nfunction mergeSearchResults', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const context = {
    result: '',
    SEARCH_RESULT_LIMIT: 80,
    URLSearchParams,
    elements: {
      providerFilter: { value: 'all' },
      statusFilter: { value: 'all' },
      projectFilter: { value: 'all' },
      archiveToggle: { checked: false },
      subagentToggle: { checked: false },
      automationToggle: { checked: false },
    },
    currentSearchQuery() {
      return '用户';
    },
  };

  vm.runInNewContext(`
    ${app.slice(start, end)}
    result = searchParamsFromControls().toString();
  `, context);
  assert.equal(context.result.includes('subagents=1'), false);
  assert.equal(context.result.includes('automations=1'), false);

  context.elements.subagentToggle.checked = true;
  vm.runInNewContext(`
    ${app.slice(start, end)}
    result = searchParamsFromControls().toString();
  `, context);
  assert.equal(context.result.includes('subagents=1'), true);
  assert.equal(context.result.includes('automations=1'), false);

  context.elements.automationToggle.checked = true;
  vm.runInNewContext(`
    ${app.slice(start, end)}
    result = searchParamsFromControls().toString();
  `, context);
  assert.equal(context.result.includes('subagents=1'), true);
  assert.equal(context.result.includes('automations=1'), true);
});

test('keeps thread list row actions compact on smaller screens', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);
  const listStart = app.indexOf('function renderThreads()');
  const listEnd = app.indexOf('function renderNotifications', listStart);
  const listSource = app.slice(listStart, listEnd);
  const detailStart = app.indexOf('function threadDetailMarkup(');
  const detailEnd = app.indexOf('function renderDetail(', detailStart);
  const detailSource = app.slice(detailStart, detailEnd);

  assert.notEqual(listStart, -1);
  assert.notEqual(listEnd, -1);
  assert.doesNotMatch(listSource, /data-copy-command-id/);
  assert.match(detailSource, /data-copy-command-id/);
  assert.match(styles, /\.row-actions,[\s\S]*\.detail-actions\s*\{[\s\S]*flex-wrap:\s*wrap;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.thread-row,[\s\S]*\.search-result-row\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.controls:not\(\.search-controls\) > \.toggle\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.doesNotMatch(styles, /@media \(max-width: 1180px\)[\s\S]*\.search-controls > \.toggle\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.summary-section-heading\s*\{[\s\S]*flex-direction:\s*column;/);
});

test('places project history below the recent thread list before thread detail', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  const threadsIndex = html.indexOf('<section class="panel thread-panel"');
  const projectsIndex = html.indexOf('<section class="panel project-history-panel"');
  const detailIndex = html.indexOf('<section id="detail"');

  assert.notEqual(threadsIndex, -1);
  assert.notEqual(projectsIndex, -1);
  assert.notEqual(detailIndex, -1);
  assert.ok(threadsIndex < projectsIndex);
  assert.ok(projectsIndex < detailIndex);
  assert.doesNotMatch(html, /<aside class="side-rail">/);
});

test('renders recent thread rows with the same detail style as search results', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function threadMention\(thread/);
  assert.match(app, /function threadProjectRailMarkup\(thread\)/);
  assert.match(app, /function threadPrimaryModuleMarkup\(thread/);
  assert.match(app, /function threadResultDetailMarkup\(thread/);
  assert.match(app, /function threadSideMarkup\(thread/);
  assert.match(app, /class="thread-mention"/);
  assert.doesNotMatch(app, /class="thread-content-type"/);
  assert.doesNotMatch(app, /class="thread-ide-name"/);
  assert.match(app, /class="thread-side-provider"/);
  assert.match(app, /class="thread-support-meta"/);
  assert.match(app, /class="thread-result-stack"/);
  assert.match(app, /class="thread-detail-button"/);
  assert.match(app, /class="thread-result-detail"/);
  assert.match(app, /class="thread-project-rail"/);
  assert.match(app, /class="thread-status-inline"/);
  const projectRailStart = app.indexOf('function threadProjectRailMarkup');
  const projectRailEnd = app.indexOf('\nfunction threadMentionCandidates', projectRailStart);
  const resultDetailStart = app.indexOf('function threadResultDetailMarkup');
  const resultDetailEnd = app.indexOf('\nfunction threadPrimaryModuleMarkup', resultDetailStart);
  assert.notEqual(projectRailStart, -1);
  assert.notEqual(projectRailEnd, -1);
  assert.notEqual(resultDetailStart, -1);
  assert.notEqual(resultDetailEnd, -1);
  const projectRailSource = app.slice(projectRailStart, projectRailEnd);
  const resultDetailSource = app.slice(resultDetailStart, resultDetailEnd);
  assert.match(projectRailSource, /class="thread-status-inline"/);
  assert.match(projectRailSource, /statusMarkup\(thread\.status\)/);
  assert.match(projectRailSource, /class="thread-project-label"/);
  assert.doesNotMatch(resultDetailSource, /class="thread-status-inline"/);
  assert.match(app, /class="thread-side"/);
  assert.match(app, /class="thread-side-metrics"/);
  assert.match(app, /class="thread-token-inline"/);
  assert.match(app, /className: 'thread-main'[\s\S]*showMeta: false/);
  assert.match(app, /\$\{threadResultDetailMarkup\(thread, \{ query, showMeta \}\)\}/);
  assert.match(styles, /\.thread-row,\s*\.search-result-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(96px,\s*124px\) minmax\(0,\s*1fr\) minmax\(132px,\s*168px\) minmax\(236px,\s*300px\);/);
  assert.match(styles, /\.thread-main,\s*\.search-result-main\s*\{[\s\S]*grid-template-columns:\s*minmax\(96px,\s*124px\) minmax\(0,\s*1fr\);/);
  assert.match(styles, /\.thread-main,\s*\.search-result-main\s*\{[\s\S]*grid-column:\s*1 \/ span 3;/);
  assert.match(styles, /\.thread-row\.has-artifacts \.thread-main,\s*\.search-result-row\.has-artifacts \.search-result-main\s*\{[\s\S]*grid-column:\s*1 \/ span 2;/);
  assert.match(styles, /\.thread-result-detail\s*\{/);
  assert.match(styles, /\.search-hit-line\s*\{/);
  assert.match(styles, /\.thread-project-rail\s*\{[\s\S]*align-content:\s*start;/);
  assert.match(styles, /\.thread-project-label\s*\{/);
  assert.match(styles, /\.thread-side\s*\{[\s\S]*border-left:\s*1px solid var\(--line\);/);
  assert.match(styles, /\.thread-side\s*\{[\s\S]*grid-column:\s*4;/);
  assert.match(styles, /\.thread-side-provider\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
  assert.match(styles, /\.thread-side \.action-button\.primary\s*\{[\s\S]*min-width:\s*92px;[\s\S]*min-height:\s*44px;/);
  assert.match(styles, /\.thread-mention\s*\{[\s\S]*-webkit-line-clamp:\s*2;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.thread-row\.has-artifacts \.thread-main,[\s\S]*\.search-result-row\.has-artifacts \.search-result-main[\s\S]*grid-column:\s*auto;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.thread-side \.row-actions\s*\{[\s\S]*justify-content:\s*stretch;[\s\S]*width:\s*100%;/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.thread-side \.action-button\.primary\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
});

test('summarizes local file mentions by file name and type in previews', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const searchHelperStart = app.indexOf('function escapeRegExp');
  const searchHelperEnd = app.indexOf('\nfunction hasActiveSearchQuery', searchHelperStart);
  const mentionStart = app.indexOf('function threadMentionCandidates');
  const mentionEnd = app.indexOf('\nfunction threadSupportMetaItems', mentionStart);
  const searchPreviewStart = app.indexOf('function searchConversationPreview');
  const searchPreviewEnd = app.indexOf('\nfunction searchResultExcerptMarkup', searchPreviewStart);
  const compactStart = app.indexOf('function compactSignal');
  const compactEnd = app.indexOf('\nfunction formatTimestamp', compactStart);
  const recentStart = app.indexOf('function recentUserSignal');
  const recentEnd = app.indexOf('\nfunction recentAgentSignal', recentStart);
  const titleStart = app.indexOf('function displayThreadTitle');
  const titleEnd = app.indexOf('\nfunction threadTitleMarkup', titleStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(searchHelperStart, -1);
  assert.notEqual(mentionStart, -1);
  assert.notEqual(searchPreviewStart, -1);
  assert.notEqual(compactStart, -1);
  assert.notEqual(recentStart, -1);
  assert.notEqual(titleStart, -1);

  const filePrompt = [
    '# Files mentioned by the user:',
    '',
    '## codex-clipboard-2ae89a44-0864-46ad-af2d-7821167414ee.png: /var/folders/dc/14t88w9x19z0bq8hvb35slmr0000gq/T/codex-clipboard-2ae89a44-0864-46ad-af2d-7821167414ee.png',
    '',
    '## My request for Codex:',
    '',
    '这种输入是本地文件，或者图片的，你直接呈现一下名称+文件类型呀',
  ].join('\n');
  const thread = {
    title: filePrompt,
    latestUserMessage: filePrompt,
    firstUserMessage: filePrompt,
    lastAgentMessage: '已收到图片。',
  };
  const context = {
    html: '',
    title: '',
    recent: '',
    searchPreview: '',
  };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(compactStart, compactEnd)}
    ${app.slice(searchHelperStart, searchHelperEnd)}
    ${app.slice(mentionStart, mentionEnd)}
    ${app.slice(searchPreviewStart, searchPreviewEnd)}
    ${app.slice(recentStart, recentEnd)}
    ${app.slice(titleStart, titleEnd)}
    const thread = ${JSON.stringify(thread)};
    html = threadMentionMarkup(thread, '');
    title = displayThreadTitle(thread);
    recent = recentUserSignal(thread);
    searchPreview = searchConversationPreview(thread, '');
  `, context);

  for (const rendered of [context.html, context.title, context.recent, context.searchPreview]) {
    assert.match(rendered, /codex-clipboard-2ae89a44-0864-46ad-af2d-7821167414ee\.png/);
    assert.match(rendered, /图片/);
    assert.doesNotMatch(rendered, /Files mentioned by the user/);
    assert.doesNotMatch(rendered, /\/var\/folders/);
    assert.doesNotMatch(rendered, /My request for Codex/);
  }
});

test('shows first user input before non-initial recalled chat in search previews', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const compactStart = app.indexOf('function compactSignal');
  const compactEnd = app.indexOf('\nfunction formatTimestamp', compactStart);
  const searchHelperStart = app.indexOf('function escapeRegExp');
  const searchHelperEnd = app.indexOf('\nfunction hasActiveSearchQuery', searchHelperStart);
  const previewStart = app.indexOf('function searchSpeakerForField');
  const previewEnd = app.indexOf('\nfunction threadAttachmentSource', previewStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(compactStart, -1);
  assert.notEqual(searchHelperStart, -1);
  assert.notEqual(previewStart, -1);

  const context = {
    html: '',
    segments: [],
  };
  const thread = {
    firstUserMessage: '这是这个线程最开始的用户输入，用来理解业务背景。',
    latestMeaningfulUserMessage: '后续聊天里提到了 TOY 战略框架，需要被搜索词召回。',
    match: {
      field: 'recent user',
      label: '最近输入',
      snippet: '后续聊天里提到了 TOY 战略框架，需要被搜索词召回。',
    },
  };

  vm.runInNewContext(`
    const state = { search: {} };
    const elements = { searchInput: { value: '' } };
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(compactStart, compactEnd)}
    ${app.slice(searchHelperStart, searchHelperEnd)}
    ${app.slice(previewStart, previewEnd)}
    const thread = ${JSON.stringify(thread)};
    segments = searchConversationPreviewSegments(thread, 'TOY');
    html = searchResultExcerptMarkup(thread, 'TOY');
  `, context);

  assert.equal(Array.from(context.segments, (segment) => segment.type).join('|'), 'text|separator|text');
  assert.equal(Array.from(context.segments, (segment) => segment.speaker || '').join('|'), 'user||user');
  assert.match(context.html, /这是这个线程最开始的用户输入/);
  assert.match(context.html, /search-result-excerpt-separator/);
  assert.match(context.html, />……<\/span>/);
  assert.match(context.html, /search-result-speaker search-result-speaker-user/);
  assert.match(context.html, /用户：/);
  assert.match(context.html, /后续聊天里提到了 <mark>TOY<\/mark> 战略框架/);
  assert.ok(
    context.html.indexOf('这是这个线程最开始的用户输入')
      < context.html.indexOf('search-result-excerpt-separator'),
  );
  assert.ok(
    context.html.indexOf('search-result-excerpt-separator')
      < context.html.indexOf('后续聊天里提到了'),
  );
});

test('labels recalled user and agent chat with distinct speakers in search previews', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const compactStart = app.indexOf('function compactSignal');
  const compactEnd = app.indexOf('\nfunction formatTimestamp', compactStart);
  const searchHelperStart = app.indexOf('function escapeRegExp');
  const searchHelperEnd = app.indexOf('\nfunction hasActiveSearchQuery', searchHelperStart);
  const previewStart = app.indexOf('function searchSpeakerForField');
  const previewEnd = app.indexOf('\nfunction threadAttachmentSource', previewStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(compactStart, -1);
  assert.notEqual(searchHelperStart, -1);
  assert.notEqual(previewStart, -1);

  const context = {
    html: '',
    speakers: [],
  };
  const thread = {
    firstUserMessage: '用户先描述了任务背景。',
    lastAgentMessage: 'Agent 后来给出了 TOY 战略框架的整理结果。',
    match: {
      field: 'agent output',
      label: 'Agent 输出',
      snippet: 'Agent 后来给出了 TOY 战略框架的整理结果。',
    },
  };

  vm.runInNewContext(`
    const state = { search: {} };
    const elements = { searchInput: { value: '' } };
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(compactStart, compactEnd)}
    ${app.slice(searchHelperStart, searchHelperEnd)}
    ${app.slice(previewStart, previewEnd)}
    const thread = ${JSON.stringify(thread)};
    speakers = searchConversationPreviewSegments(thread, 'TOY').map((segment) => segment.speaker || '');
    html = searchResultExcerptMarkup(thread, 'TOY');
  `, context);

  assert.equal(Array.from(context.speakers).join('|'), 'user||agent');
  assert.match(context.html, /用户：/);
  assert.match(context.html, /Agent：/);
  assert.match(context.html, />……<\/span>/);
  assert.match(context.html, /search-result-speaker search-result-speaker-user/);
  assert.match(context.html, /search-result-speaker search-result-speaker-agent/);
  assert.ok(context.html.indexOf('用户：') < context.html.indexOf('Agent：'));
  assert.match(styles, /\.search-result-speaker-user\s*\{[\s\S]*color:\s*var\(--blue\);/);
  assert.match(styles, /\.search-result-speaker-agent\s*\{[\s\S]*color:\s*var\(--red\);/);
});

test('renders clickable image attachment thumbnails with an enlarge modal', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const searchHelperStart = app.indexOf('function escapeRegExp');
  const searchHelperEnd = app.indexOf('\nfunction hasActiveSearchQuery', searchHelperStart);
  const attachmentStart = app.indexOf('function attachmentPreviewStripMarkup');
  const attachmentEnd = app.indexOf('\nfunction formatTimestamp', attachmentStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(searchHelperStart, -1);
  assert.notEqual(attachmentStart, -1);
  assert.match(html, /id="image-preview-modal"/);
  assert.match(html, /id="image-preview-image"/);
  assert.match(html, /data-close-image-preview/);
  assert.match(styles, /\.attachment-preview-strip\s*\{/);
  assert.match(styles, /\.attachment-thumb-button\s*\{/);
  assert.match(styles, /\.attachment-thumb-button img\s*\{/);
  assert.match(styles, /\.attachment-thumb-button\.is-unavailable\s*\{/);
  assert.match(styles, /\.image-preview-modal\s*\{/);
  assert.match(styles, /\.image-preview-image\s*\{/);
  assert.match(app, /function openImagePreview/);
  assert.match(app, /function closeImagePreview/);
  assert.match(app, /function markAttachmentPreviewUnavailable/);
  assert.match(app, /data-preview-image-src/);
  assert.match(app, /data-preview-image-thumb/);

  const filePrompt = [
    '# Files mentioned by the user:',
    '',
    '## codex-clipboard-8feab611-d697-434a-8126-3c6dc953052c.png: /var/folders/dc/14t88w9x19z0bq8hvb35slmr0000gq/T/codex-clipboard-8feab611-d697-434a-8126-3c6dc953052c.png',
    '',
    '## My request for Codex:',
    '',
    '你这里应该有缩略图，点击缩略图可以放大看原图',
  ].join('\n');
  const context = { rendered: '' };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(searchHelperStart, searchHelperEnd)}
    ${app.slice(attachmentStart, attachmentEnd)}
    rendered = attachmentPreviewStripMarkup(${JSON.stringify(filePrompt)});
  `, context);

  assert.match(context.rendered, /class="attachment-preview-strip"/);
  assert.match(context.rendered, /class="attachment-thumb-button"/);
  assert.match(context.rendered, /data-preview-image-src="\/api\/local-file-preview\?path=/);
  assert.match(context.rendered, /data-preview-image-thumb/);
  assert.match(context.rendered, /<img /);
  assert.match(context.rendered, /codex-clipboard-8feab611-d697-434a-8126-3c6dc953052c\.png/);
  assert.match(context.rendered, /查看原图/);
  assert.doesNotMatch(context.rendered, /\/var\/folders/);
});

test('keeps search result image attachments compact', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.thread-row,\s*\.search-result-row\s*\{[\s\S]*min-height:\s*var\(--thread-row-height\);/);
  assert.match(styles, /\.thread-main,\s*\.search-result-main\s*\{[\s\S]*min-height:\s*var\(--thread-row-height\);/);
  assert.match(styles, /\.thread-list\s*\{[\s\S]*grid-auto-rows:\s*max-content;/);
  assert.match(styles, /\.search-result-row \.thread-side\s*\{[\s\S]*grid-column:\s*3;/);
  assert.doesNotMatch(styles, /\.search-result-row\s*\{[\s\S]*?min-height:\s*182px;/);
  assert.doesNotMatch(styles, /\.search-result-main\s*\{[\s\S]*?min-height:\s*182px;/);
  assert.doesNotMatch(styles, /\.search-result-side\s*\{[\s\S]*?min-height:\s*182px;/);
  assert.match(styles, /\.thread-result-stack\s*\{[\s\S]*align-content:\s*start;[\s\S]*align-self:\s*center;[\s\S]*gap:\s*9px;/);
  assert.match(styles, /\.search-result-attachments\s*\{[\s\S]*padding:\s*0;/);
  assert.match(styles, /\.search-result-title\s*\{[\s\S]*font-size:\s*20px;/);
  assert.match(styles, /\.attachment-thumb-button\s*\{[\s\S]*min-height:\s*44px;/);
  assert.match(styles, /\.attachment-thumb-button img\s*\{[\s\S]*width:\s*42px;/);
  assert.match(styles, /\.attachment-thumb-button img\s*\{[\s\S]*height:\s*42px;/);
  assert.match(styles, /\.thread-side\s*\{[\s\S]*gap:\s*18px;[\s\S]*padding:\s*14px 18px;/);
  assert.match(styles, /\.thread-side \.action-button\.primary\s*\{[\s\S]*min-height:\s*44px;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.search-result-row\.has-artifacts \.thread-side[\s\S]*grid-column:\s*auto;/);
});

test('renders thread artifact posters without exposing raw local paths', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const artifactStart = app.indexOf('function localFilePreviewUrl');
  const artifactEnd = app.indexOf('\nfunction artifactOpenLabel', artifactStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(artifactStart, -1);
  assert.match(html, /id="artifact-timeline-modal"/);
  assert.match(html, /id="artifact-detail-modal"/);
  assert.match(styles, /\.thread-artifact-module\s*\{/);
  assert.match(styles, /\.artifact-poster-stack\s*\{/);
  assert.match(styles, /\.artifact-timeline-modal\s*\{/);
  assert.match(styles, /\.artifact-detail-modal\s*\{/);
  assert.match(app, /function threadArtifactModuleMarkup\(thread/);
  assert.match(app, /data-open-artifact-timeline-id/);
  assert.match(app, /data-open-artifact-detail-id/);

  const thread = {
    id: 'thread-1',
    artifacts: {
      total: 2,
      items: [
        {
          id: 'artifact-2',
          type: 'html',
          title: 'report.html',
          path: '/Users/example/private/report.html',
          atMs: 1777444508583,
          source: 'agent',
          turn: 1,
        },
        {
          id: 'artifact-1',
          type: 'image',
          title: 'codex-clipboard-demo.png',
          path: '/var/folders/private/codex-clipboard-demo.png',
          atMs: 1777444408583,
          source: 'user',
          turn: 1,
        },
      ],
    },
  };
  const context = { rendered: '' };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(artifactStart, artifactEnd)}
    const thread = ${JSON.stringify(thread)};
    rendered = threadArtifactModuleMarkup(thread);
  `, context);

  assert.match(context.rendered, /class="thread-artifact-module"/);
  assert.match(context.rendered, /class="artifact-poster-stack"/);
  assert.match(context.rendered, /data-open-artifact-timeline-id="thread-1"/);
  assert.match(context.rendered, /artifact-type-icon is-html/);
  assert.match(context.rendered, /artifact-type-icon is-image/);
  assert.match(context.rendered, /report\.html/);
  assert.match(context.rendered, /codex-clipboard-demo\.png/);
  assert.doesNotMatch(context.rendered, /\/Users\/example\/private/);
  assert.doesNotMatch(context.rendered, /\/var\/folders\/private/);
});

test('artifact timeline renders type-specific icons for media entries', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const artifactStart = app.indexOf('function localFilePreviewUrl');
  const artifactEnd = app.indexOf('\nfunction renderArtifactTimelineModal', artifactStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(artifactStart, -1);

  const items = [
    { id: 'html-1', type: 'html', title: 'index.html', source: 'agent' },
    { id: 'link-1', type: 'link', title: '127.0.0.1', url: 'http://127.0.0.1:4629', source: 'agent' },
    { id: 'video-1', title: 'clip.mp4', path: '/Users/example/private/clip.mp4', source: 'user' },
    { id: 'audio-1', title: 'voice.wav', path: '/Users/example/private/voice.wav', source: 'user' },
  ];
  const context = { rendered: '' };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(artifactStart, artifactEnd)}
    const items = ${JSON.stringify(items)};
    rendered = items.map((item) => artifactTimelineItemMarkup('thread-1', item)).join('');
  `, context);

  assert.match(context.rendered, /artifact-type-icon is-html/);
  assert.match(context.rendered, /artifact-type-icon is-link/);
  assert.match(context.rendered, /URL · Agent/);
  assert.match(context.rendered, /artifact-type-icon is-video/);
  assert.match(context.rendered, /artifact-type-icon is-audio/);
  assert.doesNotMatch(context.rendered, /\/Users\/example\/private/);
});

test('artifact image previews fall back when local files disappear', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const artifactStart = app.indexOf('function localFilePreviewUrl');
  const artifactEnd = app.indexOf('\nfunction artifactOpenLabel', artifactStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(artifactStart, -1);
  assert.match(app, /function markArtifactImagePreviewUnavailable\(image\)/);
  assert.match(app, /data-artifact-preview-image/);
  assert.match(app, /data-artifact-preview-fallback/);
  assert.match(app, /markArtifactImagePreviewUnavailable\(target\)/);
  assert.match(styles, /\.artifact-timeline-thumb\.is-unavailable/);
  assert.match(styles, /\.artifact-detail-preview\.is-unavailable/);

  const item = {
    id: 'artifact-1',
    type: 'image',
    title: 'missing.jpg',
    path: '/Users/example/private/missing.jpg',
    source: 'user',
    turn: 4,
  };
  const context = { timeline: '', detail: '' };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(artifactStart, artifactEnd)}
    const item = ${JSON.stringify(item)};
    timeline = artifactTimelineItemMarkup('thread-1', item);
    detail = artifactDetailPreviewMarkup(item);
  `, context);

  assert.match(context.timeline, /data-artifact-preview-image/);
  assert.match(context.timeline, /data-artifact-preview-fallback/);
  assert.match(context.timeline, /artifact-type-icon is-image/);
  assert.match(context.timeline, /JPG/);
  assert.match(context.detail, /data-artifact-preview-image/);
  assert.match(context.detail, /data-artifact-preview-fallback/);
  assert.match(context.detail, /artifact-type-icon is-image/);
  assert.match(context.detail, /JPG/);
  assert.doesNotMatch(context.timeline, /\/Users\/example\/private/);
  assert.doesNotMatch(context.detail, /\/Users\/example\/private/);
});

test('renders artifact module inside search result rows', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTokens', escapeStart);
  const searchHelperStart = app.indexOf('function escapeRegExp');
  const searchHelperEnd = app.indexOf('\nfunction hasActiveSearchQuery', searchHelperStart);
  const previewStart = app.indexOf('function threadKindBadgesMarkup');
  const previewEnd = app.indexOf('\nfunction threadMetaItems', previewStart);
  const artifactStart = app.indexOf('function localFilePreviewUrl');
  const artifactEnd = app.indexOf('\nfunction formatTimestamp', artifactStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(searchHelperStart, -1);
  assert.notEqual(previewStart, -1);
  assert.notEqual(artifactStart, -1);

  const thread = {
    id: 'thread-1',
    title: '带素材的搜索结果',
    projectName: 'demo',
    providerLabel: 'Codex',
    model: 'gpt-5.5',
    status: 'idle',
    latestUserMessage: '请看这个结果',
    artifacts: {
      total: 2,
      items: [
        {
          id: 'artifact-2',
          type: 'html',
          title: 'report.html',
          path: '/Users/example/private/report.html',
          source: 'agent',
          turn: 2,
        },
        {
          id: 'artifact-1',
          type: 'image',
          title: 'screen.png',
          path: '/var/folders/private/screen.png',
          source: 'user',
          turn: 1,
        },
      ],
    },
  };
  const context = { rendered: '' };

  vm.runInNewContext(`
    const state = { search: {} };
    const elements = { searchInput: { value: '' } };
    const STATUS_LABELS = { idle: '空闲' };
    function providerLabel(thread) { return thread.providerLabel || 'Agent'; }
    function canOpenThread() { return true; }
    function openLabel() { return '打开'; }
    function isSubagentThread() { return false; }
    function statusMarkup(status) { return '<span class="status-pill">' + status + '</span>'; }
    function tokenUsageMarkup() { return '<span class="thread-token-inline"></span>'; }
    function searchResultMetaItems(thread) { return [thread.projectName, '6/17 12:00']; }
    function displayThreadTitle(thread) { return thread.title || '未命名任务'; }
    function compactSignal(value = '') { return String(value || '').replace(/\\s+/g, ' ').trim(); }
    function attachmentPreviewStripMarkup() { return ''; }
    function currentTurnDuration() { return ''; }
    function threadRelationshipLabel() { return ''; }
    function relativeTime() { return '58 分钟前'; }
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(searchHelperStart, searchHelperEnd)}
    ${app.slice(artifactStart, artifactEnd)}
    ${app.slice(previewStart, previewEnd)}
    const thread = ${JSON.stringify(thread)};
    rendered = searchResultRowMarkup(thread, { query: '', isSelected: false });
  `, context);

  assert.match(context.rendered, /class="search-result-row[^"]*has-artifacts/);
  assert.match(context.rendered, /class="search-result-main"/);
  assert.match(context.rendered, /class="thread-project-rail"/);
  assert.match(context.rendered, /class="thread-side"/);
  assert.match(context.rendered, /class="thread-artifact-module"/);
  assert.match(context.rendered, /data-open-artifact-timeline-id="thread-1"/);
  assert.match(context.rendered, /report\.html/);
  assert.match(context.rendered, /screen\.png/);
  assert.doesNotMatch(context.rendered, /\/Users\/example\/private/);
  assert.doesNotMatch(context.rendered, /\/var\/folders\/private/);
});

test('moves thread search into a dedicated full-width search page', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  const searchPageIndex = html.indexOf('<section id="search-page"');
  const windowControlsIndex = html.indexOf('<div class="pwa-window-control-stack"');
  const topbarIndex = html.indexOf('<header class="topbar">');
  const hideButtonIndex = html.indexOf('id="app-hide-button"');
  const returnButtonIndex = html.indexOf('id="close-search-page"');
  const searchControlsIndex = html.indexOf('<section class="controls search-controls"');
  const searchControlsSource = html.slice(searchControlsIndex, html.indexOf('</section>', searchControlsIndex));
  const topbarActionsIndex = html.indexOf('<div class="topbar-actions">');
  const promptStageIndex = html.indexOf('<section class="prompt-pack-stage dashboard-view"');
  const promptPackIndex = html.indexOf('<section id="prompt-pack-panel"');
  const promptPackSegmentsIndex = html.indexOf('<div id="prompt-pack-segments"');
  const searchLauncherIndex = html.indexOf('id="open-search-page"');
  const promptPackPanelSource = html.slice(promptPackIndex, html.indexOf('</section>', promptPackIndex));
  const promptStageSource = html.slice(promptStageIndex, html.indexOf('</section>', promptStageIndex));
  const statusBannerIndex = html.indexOf('<section id="status-banner"');
  const topbarActionsSource = html.slice(topbarActionsIndex, statusBannerIndex);
  const threadPanelIndex = html.indexOf('<section class="panel thread-panel"');
  const defaultPanelSource = html.slice(threadPanelIndex, html.indexOf('<section class="panel project-history-panel"', threadPanelIndex));

  assert.notEqual(searchPageIndex, -1);
  assert.notEqual(windowControlsIndex, -1);
  assert.notEqual(topbarIndex, -1);
  assert.notEqual(topbarActionsIndex, -1);
  assert.notEqual(hideButtonIndex, -1);
  assert.notEqual(returnButtonIndex, -1);
  assert.notEqual(searchControlsIndex, -1);
  assert.notEqual(promptStageIndex, -1);
  assert.notEqual(promptPackIndex, -1);
  assert.notEqual(promptPackSegmentsIndex, -1);
  assert.notEqual(searchLauncherIndex, -1);
  assert.notEqual(statusBannerIndex, -1);
  assert.notEqual(threadPanelIndex, -1);
  assert.ok(windowControlsIndex < topbarIndex);
  assert.ok(windowControlsIndex < hideButtonIndex);
  assert.ok(hideButtonIndex < returnButtonIndex);
  assert.ok(topbarActionsIndex < searchLauncherIndex);
  assert.ok(searchLauncherIndex < statusBannerIndex);
  assert.ok(promptStageIndex < promptPackIndex);
  assert.ok(promptPackIndex < promptPackSegmentsIndex);
  assert.ok(searchPageIndex < threadPanelIndex);
  assert.doesNotMatch(defaultPanelSource, /id="search-input"/);
  assert.doesNotMatch(defaultPanelSource, /id="open-search-page"/);
  assert.doesNotMatch(promptPackPanelSource, /id="open-search-page"/);
  assert.doesNotMatch(promptStageSource, /id="open-search-page"/);
  assert.doesNotMatch(searchControlsSource, /id="close-search-page"/);
  assert.match(topbarActionsSource, /id="open-search-page"/);
  assert.match(html, /id="open-search-page"/);
  assert.match(html, /id="close-search-page"/);
  assert.match(html, /id="search-load-sentinel"/);
  assert.match(html, /id="search-detail-modal"/);
  assert.match(html, /id="search-detail-content"/);
  assert.match(html, /class="search-launcher[^"]*"/);
  assert.match(styles, /\[hidden\],[\s\S]*\.dashboard-view\[hidden\]\s*\{[\s\S]*display:\s*none !important;/);
  assert.match(styles, /\.topbar-search-launcher\s*\{[\s\S]*grid-column:\s*2;/);
  assert.match(styles, /\.topbar-search-launcher\s*\{[\s\S]*min-height:\s*38px;/);
  assert.match(styles, /\.topbar-search-launcher \.search-launcher-placeholder\s*\{[\s\S]*font-size:\s*13px;/);
  assert.match(styles, /\.prompt-pack-panel\s*\{[\s\S]*grid-template-areas:[\s\S]*"prompt"[\s\S]*"segments";/);
  assert.doesNotMatch(styles, /\.prompt-pack-search-launcher\s*\{/);
  assert.match(styles, /\.search-launcher\s*\{[\s\S]*min-height:\s*58px;/);
  assert.match(styles, /\.search-field\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.match(styles, /\.search-page\s*\{/);
  assert.match(styles, /\.pwa-window-control-stack\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(styles, /\.pwa-window-control-stack\s*\{[\s\S]*left:\s*calc\(env\(titlebar-area-x,\s*0px\) \+ 74px\);/);
  assert.match(styles, /\.pwa-window-control-stack\s*\{[\s\S]*z-index:\s*30;/);
  assert.match(styles, /\.pwa-floating-button:not\(\[hidden\]\)\s*\{[\s\S]*border-radius:\s*999px;/);
  assert.match(styles, /body\[data-view="search"\] \.topbar\s*\{[\s\S]*display:\s*none;/);
  assert.match(styles, /body\[data-view="search"\] \.search-page\s*\{[\s\S]*margin-top:\s*0;/);
  assert.match(styles, /body\[data-view="search"\] \.search-page-top\s*\{[\s\S]*position:\s*absolute;/);
  assert.match(styles, /body\[data-view="search"\] \.search-panel-heading\s*\{[\s\S]*display:\s*none;/);
  assert.match(styles, /body\[data-view="search"\] \.search-field > span\s*\{[\s\S]*clip-path:\s*inset\(50%\);/);
  assert.match(styles, /\.search-return-button\s*\{[\s\S]*display:\s*none;/);
  assert.match(styles, /body\[data-view="search"\] \.search-return-button\s*\{[\s\S]*display:\s*inline-flex;/);
  assert.match(styles, /@media \(min-width: 721px\)[\s\S]*body\[data-view="search"\] \.search-field\s*\{[\s\S]*box-sizing:\s*border-box;/);
  assert.match(styles, /@media \(min-width: 721px\)[\s\S]*body\[data-view="search"\] \.search-field\s*\{[\s\S]*padding-left:\s*max\(0px,/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*body\[data-view="search"\] \.search-page\s*\{[\s\S]*padding-top:\s*82px;/);
  assert.match(styles, /\.search-panel\s*\{[\s\S]*overflow:\s*visible;/);
  assert.match(styles, /\.search-result-list\s*\{[\s\S]*min-height:\s*0;/);
  assert.match(styles, /\.search-load-sentinel\s*\{/);
  assert.match(styles, /\.search-detail-modal\s*\{/);
  assert.match(styles, /\.search-detail-sheet\s*\{/);
  assert.match(styles, /\.search-controls input\[type="search"\]\s*\{[\s\S]*min-height:\s*62px;/);
  assert.match(styles, /\.search-controls input\[type="search"\]\s*\{[\s\S]*font-size:\s*19px;/);
  assert.match(styles, /\.search-controls\s*\{[\s\S]*grid-template-columns:\s*minmax\(148px,\s*0\.82fr\) minmax\(108px,\s*156px\) minmax\(180px,\s*1fr\) max-content max-content max-content;/);
  assert.match(styles, /\.search-controls > \.toggle\s*\{[\s\S]*justify-self:\s*start;/);
});

test('uses dedicated search page state and API for history searches', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /search:\s*\{/);
  assert.match(app, /function openSearchPage/);
  assert.match(app, /function closeSearchPage/);
  assert.match(app, /function setPageView/);
  assert.match(app, /function focusSearchInputAtTop/);
  assert.match(app, /focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /window\.scrollTo\(\{ top: Math\.max\(0, top\), behavior: 'auto' \}\)/);
  assert.match(app, /async function runSearch/);
  assert.match(app, /function loadMoreSearchResults/);
  assert.match(app, /function openSearchDetailModal/);
  assert.match(app, /function closeSearchDetailModal/);
  assert.match(app, /fetch\(`\/api\/search\?\$\{params\.toString\(\)\}`/);
  assert.match(app, /params\.set\('cursor', cursor\)/);
  assert.match(app, /mergeSearchResults\(state\.search\.result, result\)/);
  assert.match(app, /elements\.detail\.hidden = isSearch/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderSearchResults'), app.indexOf('function renderNotifications')), /renderDetail\(/);
  assert.match(app, /function handleSearchControlsChanged/);
  assert.match(app, /elements\.searchInput\.addEventListener\('input', handleSearchControlsChanged\)/);
  assert.match(app, /window\.addEventListener\('scroll'/);
  assert.match(app, /event\.key === 'Escape'/);
});

test('renders search result match metadata and project history', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /function searchMatchMarkup\(thread, query/);
  assert.match(app, /function searchConversationPreview\(thread, query/);
  assert.match(app, /function searchSpeakerForField\(field/);
  assert.match(app, /function searchTextSegment\(text, speaker/);
  assert.match(app, /function searchConversationPreviewSegments\(thread, query/);
  assert.match(app, /const firstUser = compactSignal\(thread\?\.firstUserMessage \|\| ''\);/);
  assert.match(app, /if \(\['first user', 'recent user', 'agent output'\]\.includes\(matchField\) && thread\?\.match\?\.snippet\)/);
  assert.match(app, /return \[searchTextSegment\(/);
  assert.match(app, /function searchSpeakerLabel\(speaker/);
  assert.match(app, /function searchSpeakerClass\(speaker/);
  assert.match(app, /function searchResultExcerptMarkup\(thread/);
  assert.match(app, /function searchResultSideMetaMarkup\(thread\)/);
  assert.match(app, /function searchResultRowMarkup\(thread/);
  assert.match(app, /function threadPrimaryModuleMarkup\(thread/);
  assert.match(app, /class="search-result-excerpt"/);
  assert.match(app, /class="search-result-excerpt-line"/);
  assert.match(app, /class="search-result-speaker \$\{searchSpeakerClass\(segment\.speaker\)\}"/);
  assert.match(app, /class="search-result-message"/);
  assert.match(app, /class="search-result-excerpt-separator"/);
  assert.match(app, /class="thread-project-rail"/);
  assert.match(app, /class="thread-side"/);
  assert.match(app, /class="thread-detail-button"/);
  assert.match(app, /class="search-result-row/);
  assert.match(app, /class="search-hit-line"/);
  assert.match(app, /searchResultMetaItems\(thread\)\.map\(.*\)\.join\('<span aria-hidden="true">\\|<\/span>'\)/s);
  assert.match(app, /async function loadProjectHistory/);
  assert.match(app, /fetch\(`\/api\/projects\/history\?\$\{params\.toString\(\)\}`/);
  assert.match(app, /renderProjectHistory\(state\.search\.projectHistory/);
  assert.match(styles, /\.thread-row,\s*\.search-result-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(96px,\s*124px\) minmax\(0,\s*1fr\) minmax\(132px,\s*168px\) minmax\(236px,\s*300px\);/);
  assert.match(styles, /\.thread-row\.has-artifacts \.thread-main,\s*\.search-result-row\.has-artifacts \.search-result-main\s*\{[\s\S]*grid-column:\s*1 \/ span 2;/);
  assert.match(styles, /\.search-result-excerpt\s*\{[\s\S]*min-height:\s*0;/);
  assert.match(styles, /\.search-result-excerpt\s*\{[\s\S]*max-height:\s*calc\(1\.45em \* 5 \+ 16px\);/);
  assert.match(styles, /\.search-result-speaker-user\s*\{[\s\S]*color:\s*var\(--blue\);/);
  assert.match(styles, /\.search-result-speaker-agent\s*\{[\s\S]*color:\s*var\(--red\);/);
  assert.match(styles, /\.search-result-excerpt-line:only-child \.search-result-message\s*\{[\s\S]*-webkit-line-clamp:\s*3;/);
  assert.match(styles, /\.search-result-excerpt-separator\s*\{/);
  assert.match(styles, /\.search-result-row \.thread-side\s*\{[\s\S]*grid-column:\s*4;/);
  assert.match(styles, /\.search-result-row\.has-artifacts \.thread-side\s*\{[\s\S]*grid-column:\s*4;/);
  assert.match(styles, /\.project-history-summary/);
});

test('uses yellow marker styling for highlighted search terms', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const markerBlock = styles.match(/\.thread-title mark,[\s\S]*?\.search-match mark\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

  assert.match(markerBlock, /background:\s*#fff200;/);
  assert.match(markerBlock, /color:\s*#111111;/);
  assert.match(markerBlock, /box-shadow:\s*none;/);
  assert.doesNotMatch(markerBlock, /var\(--red\)/);
});

test('lets project history rows expand to fit metadata and usage bars', async () => {
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const projectListBlock = [...styles.matchAll(/(?:^|\n)\.project-list\s*\{(?<body>[^}]*)\}/g)]
    .map((match) => match.groups?.body || '')
    .join('\n');

  assert.match(projectListBlock, /align-content:\s*start;/);
  assert.match(projectListBlock, /grid-auto-rows:\s*max-content;/);
});

test('opens thread deep links without waiting for the local server round trip', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function openThread');
  const end = app.indexOf('async function updateNotification', start);
  const openThreadSource = app.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(app, /function shouldOpenDeepLinkInBrowser\(thread\)/);
  assert.match(app, /thread\?\.provider === 'codex'/);
  assert.match(app, /startsWith\('codex:\/\/'\)/);
  assert.match(openThreadSource, /if \(shouldOpenDeepLinkInBrowser\(thread\)\)/);
  assert.match(openThreadSource, /window\.location\.href = thread\.appDeepLink/);
  assert.ok(
    openThreadSource.indexOf('window.location.href = thread.appDeepLink') < openThreadSource.indexOf('fetch(`/api/threads/'),
    'Codex deep link path should run before the server opener fallback',
  );
});

test('opens Codex deep links even when a thread is missing from the sidebar index', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function shouldOpenDeepLinkInBrowser');
  const end = app.indexOf('\nfunction disableButtonBriefly', start);
  const context = { results: [] };

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  vm.runInNewContext(`
    ${app.slice(start, end)}
    results = [
      shouldOpenDeepLinkInBrowser({
        provider: 'codex',
        defaultOpenMode: 'codex-cli-resume',
        appDeepLink: 'codex://threads/019ed427-0796-7d22-9eed-943079ff6b8e',
      }),
      shouldOpenDeepLinkInBrowser({
        provider: 'opencode',
        appDeepLink: 'opencode://open-project?directory=/tmp/demo',
      }),
    ];
  `, context);

  assert.deepEqual(Array.from(context.results), [true, false]);
});

test('uses clear visible labels for thread open actions', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function openLabel');
  const end = app.indexOf('\nfunction canOpenThread', start);
  const context = { labels: [] };

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(app, /function openLabel\(thread\)/);
  assert.match(app, /data-open-thread-id="\$\{escapeHtml\(thread\.id\)\}"\$\{openDisabled\}>\$\{escapeHtml\(openLabel\(thread\)\)\}<\/button>/);
  vm.runInNewContext(`
    ${app.slice(start, end)}
    labels = [
      openLabel({ openLabel: '恢复' }),
      openLabel({ openLabel: '打开会话' }),
      openLabel({}),
    ];
  `, context);
  assert.deepEqual(Array.from(context.labels), ['打开', '打开会话', '打开']);
});

test('adds a weaker grouped thread action menu beside the primary open action', async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  const sideStart = app.indexOf('function threadSideMarkup');
  const sideEnd = app.indexOf('\nfunction searchResultMetaItems', sideStart);
  const sideSource = app.slice(sideStart, sideEnd);

  assert.notEqual(sideStart, -1);
  assert.notEqual(sideEnd, -1);
  assert.match(sideSource, /class="action-button primary"[\s\S]*data-open-thread-id/);
  assert.match(sideSource, /class="thread-more-menu"/);
  assert.match(sideSource, /data-thread-action-menu-id/);
  assert.match(sideSource, /aria-label="更多线程操作"/);
  assert.match(sideSource, /data-thread-action="reveal"/);
  assert.match(sideSource, /data-thread-action="copy-link"/);
  assert.doesNotMatch(sideSource, /data-thread-action="pin"/);
  assert.doesNotMatch(sideSource, /置顶对话/);
  assert.match(sideSource, /在 Finder 中显示/);
  assert.match(sideSource, /复制深度链接/);
  assert.match(styles, /\.thread-more-trigger\s*\{[\s\S]*width:\s*44px;[\s\S]*min-height:\s*44px;[\s\S]*aspect-ratio:\s*1;[\s\S]*opacity:\s*0\.72;/);
  assert.match(styles, /\.thread-action-popover\s*\{/);
});

test('does not keep a browser-local pin list or sort rows by pin', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function compareThreadsForList');
  const end = app.indexOf('\nfunction openLabel', start);
  const context = {
    state: { dashboard: null },
    Number,
  };

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.doesNotMatch(app, /PINNED_THREADS_STORAGE_KEY/);
  assert.doesNotMatch(app, /pinnedThreadIds/);

  vm.runInNewContext(`
    ${app.slice(start, end)}
    result = [
      { id: 'fresh', updatedAtMs: 200 },
      { id: 'pinned', pinned: true, updatedAtMs: 100 },
    ].sort(compareThreadsForList).map((thread) => thread.id);
  `, context);

  assert.deepEqual(Array.from(context.result), ['fresh', 'pinned']);
});

test('renders a visible badge for Codex native pinned threads', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function threadKindBadgesMarkup');
  const end = app.indexOf('\nfunction threadProjectRailMarkup', start);
  const context = {
    html: '',
  };

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  vm.runInNewContext(`
    function escapeHtml(value = '') { return String(value); }
    function isSubagentThread() { return false; }
    function isThreadPinned(threadOrId) {
      return Boolean(threadOrId?.pinned);
    }
    ${app.slice(start, end)}
    html = threadKindBadgesMarkup({ id: 'thread-1', pinned: true, subagentCount: 0 });
  `, context);

  assert.match(context.html, /置顶/);
  assert.match(context.html, /thread-kind-badge/);
});

test('does not render an unavailable Codex pin menu action', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(app, /function canPinThreadInCodex/);
  assert.doesNotMatch(app, /toggleThreadPinned/);
  assert.doesNotMatch(app, /data-thread-action="pin"/);
  assert.doesNotMatch(app, /pinnedThreadIds/);
});

test('explains stale local server when Finder reveal endpoint is unavailable', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function revealThreadLocation');
  const end = app.indexOf('\nasync function copyThreadDeepLink', start);
  const source = app.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(source, /response\.status === 405/);
  assert.match(source, /重启本地服务/);
});

test('opens notification cards through the same source task opener', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf("const notificationMain = clicked.closest('.notification-main[data-thread-id]')");
  const end = app.indexOf("\n  const target = clicked.closest('[data-thread-id]')", start);
  const notificationMainSource = app.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(notificationMainSource, /openThread\(notificationMain\.dataset\.threadId, notificationMain/);
  assert.match(notificationMainSource, /notificationId: notificationItem\?\.dataset\.notificationId \|\| ''/);
  assert.doesNotMatch(notificationMainSource, /selectThread\(notificationMain\.dataset\.threadId\)/);
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
        { provider: 'codex-cli', label: 'Codex CLI', available: true, capabilities: { repoAccess: 'readonly', writeProtection: 'sandbox-readonly' } },
        { provider: 'claude-code-cli', label: 'Claude Code CLI', available: true, capabilities: { repoAccess: 'readonly', writeProtection: 'write-tools-denied' } },
        { provider: 'opencode', label: 'OpenCode CLI', available: true, capabilities: { repoAccess: 'prompt-guarded', writeProtection: 'prompt-only' } }
      ]
    }, 'claude-code-cli');
  `, context);

  assert.match(context.options, /value="claude-code-cli" selected/);
  assert.match(context.options, />\s*Claude Code CLI\s*</);
  assert.match(context.options, />\s*OpenCode CLI\s*</);
  assert.doesNotMatch(context.options, /可读 repo/);
  assert.doesNotMatch(context.options, /只读沙盒|禁写工具|Prompt 禁写/);
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
        targets: {
          items: [{
            provider: 'codex-cli',
            label: 'Codex CLI',
            available: true,
            capabilities: { repoAccess: 'readonly', writeProtection: 'sandbox-readonly' },
          }],
        },
        isLoading: false,
        selectedJobIdByThread: new Map(),
        templateByThread: new Map([['thread-1', 'custom-review']]),
        customInstructionByThread: new Map([['thread-1', '只检查串台风险']]),
        fixLoopFilterByThread: new Map(),
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
    selectedReviewFixLoopFilter() {
      return 'all';
    },
    selectedReviewTemplate() {
      return 'custom-review';
    },
    reviewTargetOptions() {
      return '<option>Codex CLI · 可读 repo · 只读沙盒</option>';
    },
    selectedReviewTarget() {
      return context.state.review.targets.items[0];
    },
    reviewTargetCapabilitySummary() {
      return '可读 repo · 只读沙盒';
    },
    filterReviewJobsByFixLoop(jobs) {
      return jobs;
    },
    reviewFixLoopFilterTabs() {
      return '<button>全部</button>';
    },
    reviewInputModeOptions() {
      return '<option>最近 Agent 输出</option>';
    },
    reviewTemplateOptions() {
      return '<option value="custom-review" selected>自定义审查</option>';
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
  assert.match(context.html, /可读 repo · 只读沙盒/);
  assert.match(context.html, /name="customReviewInstruction"/);
  assert.match(context.html, /只检查串台风险/);
  assert.equal(context.payload.templateId, 'custom-review');
  assert.equal(context.payload.customReviewInstruction, '只检查串台风险');
});

test('keeps browser review notifications hidden for release', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(app, /开启评审结果通知/);
  assert.doesNotMatch(app, /data-review-notification-opt-in/);
  assert.doesNotMatch(app, /Notification\.requestPermission/);
  assert.doesNotMatch(app, /new Notification/);
});

test('builds and wires copyable review debug summaries', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const buildStart = app.indexOf('function buildReviewDebugSummary');
  const buildEnd = app.indexOf('\nfunction renderReviewJobs', buildStart);
  const copyStart = app.indexOf('function findReviewJob');
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
  assert.deepEqual(context.notices, ['已复制评审调试摘要。下一步：把它粘贴给当前线程，用来排查评审任务。']);
});

test('shows guided success notices for copied review results', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const helperStart = app.indexOf('function findReviewJob');
  const helperEnd = app.indexOf('\nasync function openThread', helperStart);

  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  const context = {
    copied: '',
    notices: [],
    state: {
      review: {
        jobsByThread: new Map([[
          'thread-1',
          [{
            id: 'review-1',
            resultText: '评审结果正文',
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
      throw new Error(message);
    },
  };

  globalThis.copied = context.copied;
  globalThis.notices = context.notices;
  try {
    await vm.runInNewContext(`
      ${app.slice(helperStart, helperEnd)}
      copyReviewResult('review-1');
    `, context);
    context.copied = globalThis.copied;
  } finally {
    delete globalThis.copied;
    delete globalThis.notices;
  }

  assert.equal(context.copied, '评审结果正文');
  assert.deepEqual(context.notices, ['已复制评审结果。下一步：粘贴到源线程或记录里继续处理。']);
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
      fixLoop: { status: 'source-opened' },
      stderr: 'OpenAI Codex v0.130.0 workdir: local-private-path prompt text',
      error: ''
    });
  `, context);

  assert.match(context.html, /评审结果详情/);
  assert.match(context.html, /源线程/);
  assert.match(context.html, /Claude Code CLI/);
  assert.match(context.html, /评审完整结果/);
  assert.match(context.html, /data-copy-review-fix-id="review-1"/);
  assert.match(context.html, /data-copy-open-review-fix-id="review-1"/);
  assert.match(context.html, /data-review-fix-status-id="review-1"/);
  assert.match(context.html, /修复状态/);
  assert.match(context.html, /已回源线程/);
  assert.match(context.html, /data-open-thread-id="thread-1"/);
  assert.match(context.html, /data-open-thread-notice="[^"]*下一步：回到源线程继续处理评审意见。"/);
  assert.doesNotMatch(context.html, /stderr:/);
  assert.doesNotMatch(context.html, /OpenAI Codex/);
  assert.doesNotMatch(context.html, /private prompt text/);
  assert.match(styles, /\.review-job-detail pre\s*\{[\s\S]*max-height:\s*none;/);
  assert.match(styles, /\.review-job-detail \.review-preview pre\s*\{[\s\S]*border:\s*1px solid var\(--line\);/);
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
  assert.match(styles, /\.review-field\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(36px,\s*auto\) 16px;/);
  assert.match(styles, /\.review-field-helper\s*\{[\s\S]*min-height:\s*16px;/);
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
  assert.match(context.html, /technical-review · 尚未处理 · 2026-05-13 16:00/);
  assert.match(context.html, /Claude Code CLI/);
  assert.match(context.html, /完整性检查通过/);
});

test('filters review history by fix loop status', async () => {
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
    formatTimestamp() {
      return '2026-05-13 16:00';
    },
  };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(statusStart, statusEnd)}
    ${app.slice(jobsStart, jobsEnd)}
    const jobs = [
      {
        id: 'review-pending',
        status: 'succeeded',
        templateId: 'technical-review',
        resultPreview: '待修复项',
        source: { threadId: 'thread-1' },
        target: { label: 'Claude Code CLI' },
        fixLoop: { status: 'source-opened' }
      },
      {
        id: 'review-applied',
        status: 'succeeded',
        templateId: 'technical-review',
        resultPreview: '已处理项',
        source: { threadId: 'thread-1' },
        target: { label: 'Codex CLI' },
        fixLoop: { status: 'applied' }
      },
      {
        id: 'review-dismissed',
        status: 'succeeded',
        templateId: 'technical-review',
        resultPreview: '不采纳项',
        source: { threadId: 'thread-1' },
        target: { label: 'OpenCode CLI' },
        fixLoop: { status: 'dismissed' }
      }
    ];
    html = renderReviewJobs(jobs, '', 'pending');
  `, context);

  assert.match(context.html, /待修复项/);
  assert.doesNotMatch(context.html, /已处理项/);
  assert.doesNotMatch(context.html, /不采纳项/);
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
    selectedReviewTarget() {
      return { provider: 'codex-cli', label: 'Codex CLI' };
    },
    reviewTargetCapabilitySummary() {
      return '可读 repo · 只读沙盒';
    },
    selectedReviewFixLoopFilter() {
      return 'all';
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
    reviewFixLoopFilterTabs() {
      return '<button>全部</button>';
    },
    filterReviewJobsByFixLoop(jobs) {
      return jobs;
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

test('renders review panel loading state before target agents are loaded', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const capabilityStart = app.indexOf('function reviewTargetCapabilitySummary');
  const capabilityEnd = app.indexOf('\nfunction buildReviewDebugSummary', capabilityStart);
  const panelStart = app.indexOf('function renderReviewPanel');
  const panelEnd = app.indexOf('\nfunction renderDetail', panelStart);

  assert.notEqual(capabilityStart, -1);
  assert.notEqual(capabilityEnd, -1);
  assert.notEqual(panelStart, -1);
  assert.notEqual(panelEnd, -1);

  const context = {
    html: '',
    state: {
      review: {
        openThreadId: 'thread-1',
        targets: null,
        isLoading: true,
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
      return null;
    },
    reviewContentErrorForThread() {
      return '';
    },
    reviewJobsForThread() {
      return [];
    },
    selectedReviewTargetProvider() {
      return '';
    },
    selectedReviewTarget() {
      return null;
    },
    selectedReviewFixLoopFilter() {
      return 'all';
    },
    selectedReviewTemplate() {
      return 'technical-review';
    },
    reviewTargetOptions() {
      return '<option value="">正在检测目标 Agent</option>';
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
      return '<p class="empty-state compact">暂无评审记录。</p>';
    },
    reviewFixLoopFilterTabs() {
      return '<button>全部</button>';
    },
    filterReviewJobsByFixLoop(jobs) {
      return jobs;
    },
    renderReviewJobDetail() {
      throw new Error('detail should not render without a selected job');
    },
  };

  vm.runInNewContext(`
    ${app.slice(capabilityStart, capabilityEnd)}
    ${app.slice(panelStart, panelEnd)}
    html = renderReviewPanel({ id: 'thread-1' });
  `, context);

  assert.match(context.html, /正在读取评审输入/);
  assert.match(context.html, /正在检测目标 Agent/);
  assert.doesNotMatch(context.html, /能力未知/);
});

test('renders review target capability below the target select only', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const escapeStart = app.indexOf('function escapeHtml');
  const escapeEnd = app.indexOf('\nfunction formatTimestamp', escapeStart);
  const optionsStart = app.indexOf('function reviewTargetOptions');
  const capabilityStart = app.indexOf('function reviewTargetCapabilitySummary');
  const capabilityEnd = app.indexOf('\nfunction buildReviewDebugSummary', capabilityStart);
  const panelStart = app.indexOf('function renderReviewPanel');
  const panelEnd = app.indexOf('\nfunction renderDetail', panelStart);

  assert.notEqual(escapeStart, -1);
  assert.notEqual(escapeEnd, -1);
  assert.notEqual(optionsStart, -1);
  assert.notEqual(capabilityStart, -1);
  assert.notEqual(capabilityEnd, -1);
  assert.notEqual(panelStart, -1);
  assert.notEqual(panelEnd, -1);

  const context = {
    html: '',
    state: {
      review: {
        openThreadId: 'thread-1',
        targets: {
          items: [
            { provider: 'codex-cli', label: 'Codex CLI', available: true, capabilities: { repoAccess: 'readonly', writeProtection: 'sandbox-readonly' } },
            { provider: 'claude-code-cli', label: 'Claude Code CLI', available: true, capabilities: { repoAccess: 'readonly', writeProtection: 'write-tools-denied' } },
          ],
        },
        isLoading: false,
        selectedJobIdByThread: new Map(),
        targetProviderByThread: new Map([['thread-1', 'codex-cli']]),
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
    selectedReviewTarget() {
      return { provider: 'codex-cli', label: 'Codex CLI', available: true, capabilities: { repoAccess: 'readonly', writeProtection: 'sandbox-readonly' } };
    },
    selectedReviewFixLoopFilter() {
      return 'all';
    },
    selectedReviewTemplate() {
      return 'technical-review';
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
      return '<p class="empty-state compact">暂无评审记录。</p>';
    },
    reviewFixLoopFilterTabs() {
      return '<button>全部</button>';
    },
    filterReviewJobsByFixLoop(jobs) {
      return jobs;
    },
    renderReviewJobDetail() {
      throw new Error('detail should not render without a selected job');
    },
  };

  vm.runInNewContext(`
    ${app.slice(escapeStart, escapeEnd)}
    ${app.slice(optionsStart, capabilityStart)}
    ${app.slice(capabilityStart, capabilityEnd)}
    ${app.slice(panelStart, panelEnd)}
    html = renderReviewPanel({ id: 'thread-1' });
  `, context);

  assert.match(context.html, /<option value="codex-cli" selected>\s*Codex CLI\s*<\/option>/);
  assert.match(context.html, /<small class="review-field-helper review-target-capability">可读 repo · 只读沙盒<\/small>/);
  assert.equal(context.html.match(/<label class="review-field">/g)?.length, 4);
  assert.equal(context.html.match(/class="review-field-helper/g)?.length, 4);
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
    dashboardDataSignature() {
      return 'updated-dashboard';
    },
    clearError() {},
    showError(message) {
      throw new Error(message);
    },
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
  const copyStart = app.indexOf('function findReviewJob');
  const copyEnd = app.indexOf('\nasync function openThread', copyStart);

  assert.notEqual(buildStart, -1);
  assert.notEqual(buildEnd, -1);
  assert.notEqual(copyStart, -1);
  assert.notEqual(copyEnd, -1);

  const context = {
    copied: '',
    notices: [],
    patch: null,
    Date: { now: () => 123 },
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
    async updateReviewJobMetadata(reviewId, patch) {
      globalThis.patch = { reviewId, patch };
      return { id: reviewId, source: { threadId: 'thread-1' }, fixLoop: patch.fixLoop };
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
    context.patch = globalThis.patch;
  } finally {
    delete globalThis.copied;
    delete globalThis.notices;
    delete globalThis.patch;
  }

  assert.match(context.copied, /请根据下面的评审结果修复当前线程中的工作/);
  assert.match(context.copied, /这条 Prompt 会粘贴回源线程继续执行/);
  assert.match(context.copied, /评审上下文/);
  assert.match(context.copied, /只处理评审中明确指出的问题/);
  assert.match(context.copied, /不要 push，不要创建 PR/);
  assert.match(context.copied, /源线程/);
  assert.match(context.copied, /Claude Code CLI/);
  assert.match(context.copied, /请补测试并简化实现。/);
  assert.doesNotMatch(context.copied, /源内容预览/);
  assert.doesNotMatch(context.copied, /源 Agent 输出预览/);
  assert.equal(context.patch.reviewId, 'review-1');
  assert.equal(context.patch.patch.fixLoop.status, 'prompt-copied');
  assert.equal(context.patch.patch.fixLoop.promptCopiedAtMs, 123);
  assert.deepEqual(context.notices, ['已复制修复 Prompt。下一步：打开源线程并粘贴执行。']);
});

test('copies a fix prompt and opens the source thread without overwriting the clipboard', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const buildStart = app.indexOf('function buildReviewFixPrompt');
  const buildEnd = app.indexOf('\nfunction renderReviewJobDetail', buildStart);
  const helperStart = app.indexOf('function findReviewJob');
  const helperEnd = app.indexOf('\nasync function openThread', helperStart);

  assert.notEqual(buildStart, -1);
  assert.notEqual(buildEnd, -1);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  const context = {
    copied: '',
    opened: null,
    patch: null,
    state: {
      review: {
        jobsByThread: new Map([[
          'thread-1',
          [{
            id: 'review-1',
            status: 'succeeded',
            templateId: 'technical-review',
            inputMode: 'latest-agent-signal',
            inputPreview: '源 Agent 输出预览',
            resultPreview: '请补测试。',
            source: { threadId: 'thread-1', title: '源线程', providerLabel: 'Codex' },
            target: { label: 'Claude Code CLI', provider: 'claude-code-cli' },
          }],
        ]]),
      },
    },
    Date: { now: () => 456 },
    async copyText(value) {
      globalThis.copied = value;
    },
    async updateReviewJobMetadata(reviewId, patch) {
      globalThis.patch = { reviewId, patch };
      return { id: reviewId, source: { threadId: 'thread-1' }, fixLoop: patch.fixLoop };
    },
    async openThread(threadId, sourceButton, options) {
      globalThis.opened = { threadId, sourceButton, options };
    },
    showError(message) {
      throw new Error(message);
    },
  };

  globalThis.copied = context.copied;
  globalThis.opened = context.opened;
  globalThis.patch = context.patch;
  try {
    await vm.runInNewContext(`
      ${app.slice(buildStart, buildEnd)}
      ${app.slice(helperStart, helperEnd)}
      copyAndOpenReviewFix('review-1', 'button-ref');
    `, context);
    context.copied = globalThis.copied;
    context.opened = globalThis.opened;
    context.patch = globalThis.patch;
  } finally {
    delete globalThis.copied;
    delete globalThis.opened;
    delete globalThis.patch;
  }

  assert.match(context.copied, /请根据下面的评审结果修复当前线程中的工作/);
  assert.equal(context.patch.patch.fixLoop.status, 'source-opened');
  assert.equal(context.patch.patch.fixLoop.sourceOpenedAtMs, 456);
  assert.equal(context.opened.threadId, 'thread-1');
  assert.equal(context.opened.options.copyResume, false);
  assert.equal(context.opened.options.noticeMessage, '已复制修复 Prompt，正在打开源线程。下一步：粘贴 Prompt 开始修复。');
});

test('marks a review fix loop as applied or dismissed', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const helperStart = app.indexOf('function findReviewJob');
  const helperEnd = app.indexOf('\nasync function openThread', helperStart);

  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  const context = {
    notices: [],
    patches: [],
    Date: { now: () => 789 },
    async updateReviewJobMetadata(reviewId, patch) {
      globalThis.patches.push({ reviewId, patch });
      return { id: reviewId, source: { threadId: 'thread-1' }, fixLoop: patch.fixLoop };
    },
    showNotice(message) {
      globalThis.notices.push(message);
    },
    showError(message) {
      throw new Error(message);
    },
  };

  globalThis.notices = context.notices;
  globalThis.patches = context.patches;
  try {
    await vm.runInNewContext(`
      ${app.slice(helperStart, helperEnd)}
      markReviewFixLoopStatus('review-1', 'applied');
      markReviewFixLoopStatus('review-2', 'dismissed');
    `, context);
    context.patches = globalThis.patches;
  } finally {
    delete globalThis.notices;
    delete globalThis.patches;
  }

  assert.equal(context.patches[0].reviewId, 'review-1');
  assert.equal(context.patches[0].patch.fixLoop.status, 'applied');
  assert.equal(context.patches[0].patch.fixLoop.resolvedAtMs, 789);
  assert.equal(context.patches[1].reviewId, 'review-2');
  assert.equal(context.patches[1].patch.fixLoop.status, 'dismissed');
  assert.equal(context.patches[1].patch.fixLoop.resolvedAtMs, 789);
  assert.deepEqual(context.notices, [
    '已标记为已处理。下一步：继续处理其他待修复评审。',
    '已标记为不采纳。下一步：继续查看其他评审记录。',
  ]);
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
