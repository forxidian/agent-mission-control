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
    '监控未启动',
    '监控中',
    '心跳',
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
    '工作中 Agent',
    'Host 工作中',
    'Sub Agent',
    'Host',
    '长期累计',
    '累计 token',
    '累计线程',
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
    '打开线程',
    '打开并标记已处理',
    '复制命令',
    '复制线程摘要',
    'resume 命令',
    '本轮耗时',
    '单线程审计',
    '下一步动作',
    '状态摘要',
    '待处理区',
    '运行证据区',
    '最近信号',
    '不含完整线程正文',
    '待处理',
    '新进展',
    '标记已处理',
    '标记已查看',
    '待查看',
    '稍后提醒',
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
  ]) {
    assert.equal(publicCopy.includes(oldCopy), false, `leftover English UI copy: ${oldCopy}`);
  }
});

test('separates soft progress notifications from hard pending work copy', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /function notificationBreakdown\(notifications\)/);
  assert.match(app, /source === 'observed-completion'/);
  assert.match(app, new RegExp('待处理 / 新进展'));
  assert.match(app, /项需处理 · \$\{progressCount\} 项新进展/);
  assert.match(app, /打开并标记已查看/);
  assert.match(app, /标记已查看/);
  assert.match(app, /SOFT_PROGRESS_STATUS_LABELS/);
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

test('offers privacy-limited thread summary copy from the detail panel', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /function buildThreadSummary\(thread\)/);
  assert.match(app, /function copyThreadSummary\(threadId\)/);
  assert.match(app, /data-copy-summary-id/);
  assert.match(app, /只含本地元数据和截断信号，不含完整线程正文/);
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
