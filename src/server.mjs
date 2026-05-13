import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CLAUDE_PROVIDER_IDS, getClaudeCacheStats, openClaudeThread } from './claude-data.mjs';
import { getCodexCacheStats } from './codex-data.mjs';
import { loadDashboard as loadMissionControlDashboard } from './dashboard.mjs';
import { NotificationCenter } from './notifications.mjs';
import { openOpenCodeSession } from './opencode-data.mjs';
import { buildPendingSummary } from './pending-summary.mjs';
import { getReviewContentForThread } from './review-content.mjs';
import { createReviewJobStore } from './review-jobs.mjs';
import { buildReviewPrompt } from './review-prompts.mjs';
import { listReviewTargets, runReviewWithProvider } from './review-runners.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const execFileAsync = promisify(execFile);
const PWA_APP_NAMES = [
  'Agent Mission Control.app',
  'Agent 任务控制台.app',
  'Agent 控制台.app',
];
const PWA_APP_SCRIPT_NAMES = [
  'Agent Mission Control',
  'Agent 任务控制台',
  'Agent 控制台',
];
const PWA_APP_DIRS = [
  path.join(os.homedir(), 'Applications', 'Chrome Apps.localized'),
  path.join(os.homedir(), 'Applications', 'Chrome Apps'),
  path.join(os.homedir(), 'Applications', 'Edge Apps.localized'),
  path.join(os.homedir(), 'Applications', 'Edge Apps'),
];
const DEFAULT_DASHBOARD_CACHE_TTL_MS = 10_000;
const DEFAULT_NOTIFICATION_CACHE_TTL_MS = 30_000;
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function durationSince(startedAtMs) {
  return Math.max(0, Date.now() - startedAtMs);
}

function hitRatePercent(hits, misses) {
  const total = Number(hits || 0) + Number(misses || 0);
  if (!total) return null;
  return Math.round((Number(hits || 0) / total) * 100);
}

async function readJsonBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64 * 1024) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
  }

  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendError(response, error, fallbackMessage = 'Request failed') {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  sendJson(response, statusCode, {
    error: error instanceof Error ? error.message : fallbackMessage,
  });
}

function openCommandForUrl(url) {
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

function appleScriptString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function firstExistingPath(paths) {
  for (const candidate of paths) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) return candidate;
    } catch {
      // Try the next known app shim path.
    }
  }
  return '';
}

export async function findInstalledPwaApp({
  platform = process.platform,
  appDirs = PWA_APP_DIRS,
  appNames = PWA_APP_NAMES,
} = {}) {
  if (platform !== 'darwin') return '';

  const candidates = appDirs.flatMap((dir) => appNames.map((name) => path.join(dir, name)));
  return firstExistingPath(candidates);
}

export async function getInstalledPwaAppStatus(options = {}) {
  const appPath = await findInstalledPwaApp(options);
  return {
    installed: Boolean(appPath),
    method: appPath ? 'macos-pwa-app' : 'not-found',
  };
}

export async function openInstalledPwaApp({
  platform = process.platform,
  runCommand = execFileAsync,
  appDirs = PWA_APP_DIRS,
  appNames = PWA_APP_NAMES,
} = {}) {
  if (platform !== 'darwin') {
    const error = new Error('Installed PWA app opener is only supported on macOS');
    error.statusCode = 501;
    throw error;
  }

  const appPath = await findInstalledPwaApp({ platform, appDirs, appNames });
  if (!appPath) {
    const error = new Error('Installed Agent Mission Control app was not found');
    error.statusCode = 404;
    throw error;
  }

  await runCommand('open', [appPath], { timeout: 5000 });
  return { opened: true, method: 'macos-pwa-app' };
}

export async function minimizeInstalledPwaApp({
  platform = process.platform,
  runCommand = execFileAsync,
  appScriptNames = PWA_APP_SCRIPT_NAMES,
} = {}) {
  if (platform !== 'darwin') {
    const error = new Error('Installed PWA app minimizer is only supported on macOS');
    error.statusCode = 501;
    throw error;
  }

  let lastError = null;
  for (const appName of appScriptNames) {
    try {
      await runCommand('osascript', [
        '-e',
        `tell application "${appleScriptString(appName)}" to set miniaturized of every window to true`,
      ], { timeout: 5000 });
      return { minimized: true, method: 'macos-pwa-app' };
    } catch (error) {
      lastError = error;
    }
  }

  const error = new Error(lastError?.message || 'Installed Agent Mission Control app window was not found');
  error.statusCode = 404;
  throw error;
}

export async function openThreadInCodex(thread) {
  if (!thread.appDeepLink) {
    throw new Error('Thread is missing a Codex deep link');
  }

  const { command, args } = openCommandForUrl(thread.appDeepLink);
  await execFileAsync(command, args, { timeout: 5000 });
  return { opened: true, method: 'codex-deeplink' };
}

export async function openThreadInCodexCli(thread, {
  platform = process.platform,
  runCommand = execFileAsync,
} = {}) {
  const resumeCommand = thread.resumeCommand || `codex resume ${thread.externalId || thread.id}`;
  if (!resumeCommand) {
    throw new Error('Codex CLI 缺少 resume 命令');
  }

  if (platform === 'darwin') {
    await runCommand('osascript', [
      '-e',
      `tell application "Terminal" to do script "${appleScriptString(resumeCommand)}"`,
    ]);
    return {
      opened: true,
      method: 'codex-terminal',
      resumeCommand,
    };
  }

  return {
    opened: false,
    method: 'copy-command',
    resumeCommand,
  };
}

export async function openThreadInProvider(thread) {
  if (thread.provider === 'opencode') {
    return openOpenCodeSession(thread);
  }

  if (CLAUDE_PROVIDER_IDS.has(thread.provider)) {
    return openClaudeThread(thread);
  }

  if (thread.provider === 'codex-cli') {
    return openThreadInCodexCli(thread);
  }

  return openThreadInCodex(thread);
}

function safeStaticPath(publicDir, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const resolved = path.resolve(publicDir, `.${decodedPath}`);
  if (!resolved.startsWith(publicDir)) return null;
  return resolved;
}

async function serveStatic(request, response, publicDir) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const filePath = safeStaticPath(publicDir, url.pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

function findDashboardThread(dashboard, threadId) {
  return dashboard.threads?.find((candidate) => candidate.id === threadId) || null;
}

function reviewSourceForThread(thread) {
  return {
    threadId: thread.id,
    provider: thread.provider || '',
    providerLabel: thread.providerLabel || thread.provider || 'Agent',
    title: thread.title || '',
    cwd: thread.cwd || '',
    projectName: thread.projectName || '',
    model: thread.model || '',
  };
}

function parseReviewLimit(value) {
  const limit = Number.parseInt(value || '50', 10);
  if (!Number.isFinite(limit) || limit < 1) return 50;
  return Math.min(limit, 200);
}

async function executeReviewJob({
  job,
  prompt,
  cwd,
  targetModel,
  runReview,
  reviewStore,
}) {
  try {
    const result = await runReview({
      provider: job.target.provider,
      prompt,
      cwd,
      model: targetModel,
    });

    if (result.ok) {
      await reviewStore.updateJob(job.id, {
        status: 'succeeded',
        completedAtMs: Date.now(),
        resultText: result.resultText || '',
        resultPreview: result.resultPreview || '',
        stderr: result.stderr || '',
        timedOut: Boolean(result.timedOut),
        truncatedResult: Boolean(result.truncatedResult),
        exitCode: result.exitCode ?? 0,
      });
      return;
    }

    await reviewStore.updateJob(job.id, {
      status: 'failed',
      completedAtMs: Date.now(),
      resultText: result.resultText || '',
      resultPreview: result.resultPreview || '',
      error: result.error || 'Review runner failed',
      stderr: result.stderr || '',
      timedOut: Boolean(result.timedOut),
      truncatedResult: Boolean(result.truncatedResult),
      exitCode: result.exitCode ?? null,
    });
  } catch (error) {
    await reviewStore.updateJob(job.id, {
      status: 'failed',
      completedAtMs: Date.now(),
      error: error instanceof Error ? error.message : 'Review runner failed',
    });
  }
}

export function createServer({
  loadDashboard = loadMissionControlDashboard,
  notificationCenter = null,
  monitorNotifications = false,
  notificationScanIntervalMs = 20_000,
  dashboardCacheTtlMs = positiveInteger(process.env.DASHBOARD_CACHE_TTL_MS, DEFAULT_DASHBOARD_CACHE_TTL_MS),
  notificationCacheTtlMs = positiveInteger(process.env.NOTIFICATION_CACHE_TTL_MS, DEFAULT_NOTIFICATION_CACHE_TTL_MS),
  now = Date.now,
  openThread = openThreadInProvider,
  openInstalledApp = openInstalledPwaApp,
  minimizeInstalledApp = minimizeInstalledPwaApp,
  getInstalledAppStatus = getInstalledPwaAppStatus,
  reviewStore = createReviewJobStore(),
  runReview = runReviewWithProvider,
  loadReviewTargets = listReviewTargets,
  publicDir = DEFAULT_PUBLIC_DIR,
} = {}) {
  let dashboardLoadPromise = null;
  let dashboardCache = null;
  let notificationCache = null;
  const serverMetrics = {
    dashboardCacheHits: 0,
    dashboardCacheMisses: 0,
    dashboardCoalescedLoads: 0,
    dashboardLoadCount: 0,
    dashboardLoadErrors: 0,
    dashboardLastLoadMs: null,
    dashboardLastLoadedAtMs: null,
    notificationCacheHits: 0,
    notificationCacheMisses: 0,
    notificationRefreshCount: 0,
    notificationRefreshErrors: 0,
    notificationLastRefreshMs: null,
    notificationLastRefreshedAtMs: null,
  };

  const performanceSnapshot = () => {
    const memory = process.memoryUsage();
    const dashboardCacheAgeMs = dashboardCache?.cachedAtMs ? Math.max(0, now() - dashboardCache.cachedAtMs) : null;
    const notificationCacheAgeMs = notificationCache?.cachedAtMs
      ? Math.max(0, now() - notificationCache.cachedAtMs)
      : null;

    return {
      generatedAtMs: now(),
      process: {
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
      },
      dashboard: {
        cacheTtlMs: dashboardCacheTtlMs,
        cacheAgeMs: dashboardCacheAgeMs,
        cached: dashboardCacheAgeMs !== null && dashboardCacheAgeMs < dashboardCacheTtlMs,
        hits: serverMetrics.dashboardCacheHits,
        misses: serverMetrics.dashboardCacheMisses,
        hitRatePercent: hitRatePercent(
          serverMetrics.dashboardCacheHits,
          serverMetrics.dashboardCacheMisses,
        ),
        coalescedLoads: serverMetrics.dashboardCoalescedLoads,
        loadCount: serverMetrics.dashboardLoadCount,
        errorCount: serverMetrics.dashboardLoadErrors,
        lastLoadMs: serverMetrics.dashboardLastLoadMs,
        lastLoadedAtMs: serverMetrics.dashboardLastLoadedAtMs,
      },
      notifications: {
        cacheTtlMs: notificationCacheTtlMs,
        cacheAgeMs: notificationCacheAgeMs,
        cached: notificationCacheAgeMs !== null && notificationCacheAgeMs < notificationCacheTtlMs,
        hits: serverMetrics.notificationCacheHits,
        misses: serverMetrics.notificationCacheMisses,
        hitRatePercent: hitRatePercent(
          serverMetrics.notificationCacheHits,
          serverMetrics.notificationCacheMisses,
        ),
        refreshCount: serverMetrics.notificationRefreshCount,
        errorCount: serverMetrics.notificationRefreshErrors,
        lastRefreshMs: serverMetrics.notificationLastRefreshMs,
        lastRefreshedAtMs: serverMetrics.notificationLastRefreshedAtMs,
      },
      caches: {
        codex: getCodexCacheStats(),
        claude: getClaudeCacheStats(),
      },
    };
  };

  const loadSharedDashboard = ({ force = false } = {}) => {
    const cachedAtMs = Number(dashboardCache?.cachedAtMs || 0);
    const cacheAgeMs = now() - cachedAtMs;
    if (!force && dashboardCache?.dashboard && cacheAgeMs >= 0 && cacheAgeMs < dashboardCacheTtlMs) {
      serverMetrics.dashboardCacheHits += 1;
      return Promise.resolve(dashboardCache.dashboard);
    }

    if (!dashboardLoadPromise) {
      serverMetrics.dashboardCacheMisses += 1;
      const startedAtMs = Date.now();
      dashboardLoadPromise = Promise.resolve()
        .then(() => loadDashboard())
        .then((dashboard) => {
          serverMetrics.dashboardLoadCount += 1;
          serverMetrics.dashboardLastLoadMs = durationSince(startedAtMs);
          serverMetrics.dashboardLastLoadedAtMs = now();
          dashboardCache = {
            dashboard,
            cachedAtMs: now(),
          };
          return dashboard;
        })
        .catch((error) => {
          serverMetrics.dashboardLoadErrors += 1;
          serverMetrics.dashboardLastLoadMs = durationSince(startedAtMs);
          throw error;
        })
        .finally(() => {
          dashboardLoadPromise = null;
        });
    } else {
      serverMetrics.dashboardCoalescedLoads += 1;
    }
    return dashboardLoadPromise;
  };

  const dashboardForRequest = async (options = {}) => {
    const dashboard = await loadSharedDashboard(options);
    return {
      ...dashboard,
      summary: { ...(dashboard.summary || {}) },
    };
  };

  const notificationsForDashboard = async (dashboard, { force = false } = {}) => {
    if (!notificationCenter) return null;

    const cachedAtMs = Number(notificationCache?.cachedAtMs || 0);
    const cacheAgeMs = now() - cachedAtMs;
    if (!force && notificationCache?.notifications && cacheAgeMs >= 0 && cacheAgeMs < notificationCacheTtlMs) {
      serverMetrics.notificationCacheHits += 1;
      return notificationCache.notifications;
    }

    serverMetrics.notificationCacheMisses += 1;
    const startedAtMs = Date.now();
    try {
      const notifications = await notificationCenter.refresh(dashboard);
      serverMetrics.notificationRefreshCount += 1;
      serverMetrics.notificationLastRefreshMs = durationSince(startedAtMs);
      serverMetrics.notificationLastRefreshedAtMs = now();
      notificationCache = {
        notifications,
        cachedAtMs: now(),
      };
      return notifications;
    } catch (error) {
      serverMetrics.notificationRefreshErrors += 1;
      serverMetrics.notificationLastRefreshMs = durationSince(startedAtMs);
      throw error;
    }
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');

    if (url.pathname === '/api/dashboard') {
      try {
        const force = url.searchParams.get('force') === '1';
        const dashboard = await dashboardForRequest({ force });
        if (notificationCenter) {
          dashboard.notifications = await notificationsForDashboard(dashboard, { force });
          dashboard.summary = {
            ...dashboard.summary,
            inboxCount: dashboard.notifications.summary.activeCount,
          };
        }
        dashboard.performance = performanceSnapshot();
        sendJson(response, 200, dashboard);
      } catch (error) {
        sendJson(response, 500, {
          error: 'Failed to load dashboard data',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (url.pathname === '/api/notifications') {
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.writeHead(405, { allow: 'GET, POST' });
        response.end('Method not allowed');
        return;
      }

      if (!notificationCenter) {
        sendJson(response, 503, { error: 'Notification center is not configured' });
        return;
      }

      try {
        const force = url.searchParams.get('force') === '1';
        const dashboard = await dashboardForRequest({ force });
        const notifications = await notificationsForDashboard(dashboard, { force });
        sendJson(response, 200, notifications);
      } catch (error) {
        sendError(response, error, 'Failed to load notifications');
      }
      return;
    }

    if (url.pathname === '/api/pending-summary') {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' });
        response.end('Method not allowed');
        return;
      }

      try {
        const dashboard = await dashboardForRequest();
        const notifications = notificationCenter
          ? await notificationsForDashboard(dashboard)
          : dashboard.notifications || {
            summary: { activeCount: dashboard.summary?.inboxCount ?? dashboard.inbox?.length ?? 0 },
            items: dashboard.inbox || [],
          };

        sendJson(response, 200, buildPendingSummary(notifications, Date.now(), dashboard));
      } catch (error) {
        sendError(response, error, 'Failed to load pending summary');
      }
      return;
    }

    if (url.pathname === '/api/performance') {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' });
        response.end('Method not allowed');
        return;
      }

      sendJson(response, 200, performanceSnapshot());
      return;
    }

    const notificationMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)$/);
    if (notificationMatch) {
      if (request.method !== 'PATCH') {
        response.writeHead(405, { allow: 'PATCH' });
        response.end('Method not allowed');
        return;
      }

      if (!notificationCenter) {
        sendJson(response, 503, { error: 'Notification center is not configured' });
        return;
      }

      try {
        const body = await readJsonBody(request);
        const id = decodeURIComponent(notificationMatch[1]);
        const updated = await notificationCenter.updateNotification(id, body);
        notificationCache = null;
        sendJson(response, 200, updated);
      } catch (error) {
        sendError(response, error, 'Failed to update notification');
      }
      return;
    }

    if (url.pathname === '/api/review-targets') {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' });
        response.end('Method not allowed');
        return;
      }

      try {
        sendJson(response, 200, await loadReviewTargets());
      } catch (error) {
        sendError(response, error, 'Failed to load review targets');
      }
      return;
    }

    const reviewContentMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/review-content$/);
    if (reviewContentMatch) {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' });
        response.end('Method not allowed');
        return;
      }

      try {
        const threadId = decodeURIComponent(reviewContentMatch[1]);
        const dashboard = await loadDashboard();
        const thread = findDashboardThread(dashboard, threadId);
        const content = await getReviewContentForThread({
          thread,
          mode: url.searchParams.get('mode') || 'latest-agent-signal',
        });
        sendJson(response, 200, content);
      } catch (error) {
        sendError(response, error, 'Failed to load review content');
      }
      return;
    }

    if (url.pathname === '/api/reviews') {
      if (request.method === 'GET') {
        try {
          const jobs = await reviewStore.listJobs({
            limit: parseReviewLimit(url.searchParams.get('limit')),
            threadId: url.searchParams.get('threadId') || undefined,
          });
          sendJson(response, 200, jobs);
        } catch (error) {
          sendError(response, error, 'Failed to list review jobs');
        }
        return;
      }

      if (request.method === 'POST') {
        try {
          const body = await readJsonBody(request);
          const sourceThreadId = String(body.sourceThreadId || '');
          if (!sourceThreadId) {
            sendJson(response, 400, { error: 'sourceThreadId is required' });
            return;
          }

          const targetProvider = String(body.targetProvider || '');
          if (!targetProvider) {
            sendJson(response, 400, { error: 'targetProvider is required' });
            return;
          }

          const targets = await loadReviewTargets();
          const target = targets.items?.find((candidate) => candidate.provider === targetProvider);
          if (!target || !target.available) {
            sendJson(response, 422, { error: 'Selected review target is not available' });
            return;
          }

          const dashboard = await loadDashboard();
          const thread = findDashboardThread(dashboard, sourceThreadId);
          const content = await getReviewContentForThread({
            thread,
            mode: body.inputMode || 'latest-agent-signal',
          });

          const source = reviewSourceForThread(thread);
          const templateId = body.templateId || 'technical-review';
          const prompt = buildReviewPrompt({
            templateId,
            source,
            content: content.content,
            customReviewInstruction: body.customReviewInstruction,
          });
          const queued = await reviewStore.createJob({
            source,
            target: {
              provider: target.provider,
              label: target.label,
              runner: target.runner,
              model: body.targetModel || '',
            },
            templateId,
            inputMode: content.mode,
            inputPreview: content.preview,
          });
          const running = await reviewStore.updateJob(queued.id, {
            status: 'running',
            startedAtMs: Date.now(),
          });

          void executeReviewJob({
            job: running,
            prompt,
            cwd: thread.cwd || process.cwd(),
            targetModel: body.targetModel || '',
            runReview,
            reviewStore,
          });

          sendJson(response, 202, { job: running });
        } catch (error) {
          sendError(response, error, 'Failed to create review job');
        }
        return;
      }

      response.writeHead(405, { allow: 'GET, POST' });
      response.end('Method not allowed');
      return;
    }

    const reviewJobMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)$/);
    if (reviewJobMatch) {
      if (request.method !== 'GET' && request.method !== 'PATCH') {
        response.writeHead(405, { allow: 'GET, PATCH' });
        response.end('Method not allowed');
        return;
      }

      try {
        const id = decodeURIComponent(reviewJobMatch[1]);
        if (request.method === 'PATCH') {
          const body = await readJsonBody(request);
          sendJson(response, 200, { job: await reviewStore.updateJob(id, { fixLoop: body.fixLoop }) });
          return;
        }

        sendJson(response, 200, { job: await reviewStore.getJob(id) });
      } catch (error) {
        sendError(response, error, 'Failed to load review job');
      }
      return;
    }

    if (url.pathname === '/api/notification-settings') {
      sendJson(response, 410, {
        error: 'Desktop notifications are disabled',
        detail: 'Desktop notification delivery is hidden until a reliable native notifier is available.',
      });
      return;
    }

    if (url.pathname === '/api/notification-test') {
      sendJson(response, 410, {
        error: 'Desktop notifications are disabled',
        detail: 'Desktop notification delivery is hidden until a reliable native notifier is available.',
      });
      return;
    }

    if (url.pathname === '/api/app/installed') {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' });
        response.end('Method not allowed');
        return;
      }

      try {
        const status = await getInstalledAppStatus();
        sendJson(response, 200, status);
      } catch (error) {
        sendError(response, error, 'Failed to check installed app');
      }
      return;
    }

    if (url.pathname === '/api/app/open-installed') {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' });
        response.end('Method not allowed');
        return;
      }

      try {
        const result = await openInstalledApp();
        sendJson(response, 200, result);
      } catch (error) {
        sendError(response, error, 'Failed to open installed app');
      }
      return;
    }

    if (url.pathname === '/api/app/minimize-installed') {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' });
        response.end('Method not allowed');
        return;
      }

      try {
        const result = await minimizeInstalledApp();
        sendJson(response, 200, result);
      } catch (error) {
        sendError(response, error, 'Failed to minimize installed app');
      }
      return;
    }

    const openThreadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/open$/);
    if (openThreadMatch) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' });
        response.end('Method not allowed');
        return;
      }

      try {
        const body = await readJsonBody(request);
        const threadId = decodeURIComponent(openThreadMatch[1]);
        const dashboard = await dashboardForRequest();
        const thread = dashboard.threads?.find((candidate) => candidate.id === threadId);

        if (!thread) {
          sendJson(response, 404, { error: 'Thread not found' });
          return;
        }

        const result = await openThread(thread);
        const notification = body.markNotificationDone && body.notificationId && notificationCenter
          ? await notificationCenter.updateNotification(String(body.notificationId), { status: 'done' })
          : null;
        if (notification) notificationCache = null;
        sendJson(response, 200, {
          ...result,
          threadId: thread.id,
          provider: thread.provider || 'codex',
          appDeepLink: thread.appDeepLink,
          resumeCommand: thread.resumeCommand || `codex resume ${thread.id}`,
          ...(notification ? { notification } : {}),
        });
      } catch (error) {
        sendJson(response, 500, {
          error: 'Failed to open thread',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }

    await serveStatic(request, response, publicDir);
  });

  if (monitorNotifications && notificationCenter) {
    let firstScan = true;
    const scan = async () => {
      try {
        const dashboard = await dashboardForRequest();
        await notificationsForDashboard(dashboard);
        firstScan = false;
      } catch (error) {
        console.warn('Notification scan failed:', error instanceof Error ? error.message : String(error));
      }
    };
    const timer = setInterval(scan, notificationScanIntervalMs);
    timer.unref?.();
    server.once('close', () => clearInterval(timer));
    scan();
  }

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.PORT || '4629', 10);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer({
    notificationCenter: new NotificationCenter(),
    monitorNotifications: false,
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Agent Mission Control: http://${host}:${actualPort}`);
  });
}
