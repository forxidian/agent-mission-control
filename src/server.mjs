import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CLAUDE_PROVIDER_IDS, openClaudeThread } from './claude-data.mjs';
import { loadDashboard as loadMissionControlDashboard } from './dashboard.mjs';
import { NotificationCenter } from './notifications.mjs';
import { openOpenCodeSession } from './opencode-data.mjs';
import { buildPendingSummary } from './pending-summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const execFileAsync = promisify(execFile);
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
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
    throw new Error('Codex CLI 会话缺少 resume 命令');
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

export function createServer({
  loadDashboard = loadMissionControlDashboard,
  notificationCenter = null,
  monitorNotifications = false,
  notificationScanIntervalMs = 20_000,
  openThread = openThreadInProvider,
  publicDir = DEFAULT_PUBLIC_DIR,
} = {}) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');

    if (url.pathname === '/api/dashboard') {
      try {
        const dashboard = await loadDashboard();
        if (notificationCenter) {
          dashboard.notifications = await notificationCenter.refresh(dashboard);
          dashboard.summary = {
            ...dashboard.summary,
            inboxCount: dashboard.notifications.summary.activeCount,
          };
        }
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
        const dashboard = await loadDashboard();
        const notifications = await notificationCenter.refresh(dashboard);
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
        const dashboard = await loadDashboard();
        const notifications = notificationCenter
          ? await notificationCenter.refresh(dashboard)
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
        sendJson(response, 200, updated);
      } catch (error) {
        sendError(response, error, 'Failed to update notification');
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
        const dashboard = await loadDashboard();
        const thread = dashboard.threads?.find((candidate) => candidate.id === threadId);

        if (!thread) {
          sendJson(response, 404, { error: 'Thread not found' });
          return;
        }

        const result = await openThread(thread);
        const notification = body.markNotificationDone && body.notificationId && notificationCenter
          ? await notificationCenter.updateNotification(String(body.notificationId), { status: 'done' })
          : null;
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
        const dashboard = await loadDashboard();
        await notificationCenter.refresh(dashboard);
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
