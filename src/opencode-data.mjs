import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { enrichThreadRuntime } from './insights.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_COUNT = 120;
const DEFAULT_DESKTOP_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'ai.opencode.desktop');
const DEFAULT_DESKTOP_CACHE_FILES = 16;
const DEFAULT_DESKTOP_CACHE_BYTES = 6 * 1024 * 1024;
const OPEN_CODE_PROVIDER = {
  id: 'opencode',
  label: 'OpenCode',
};

function coerceNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timestampToMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  if (Number.isFinite(number)) {
    if (number <= 0) return 0;
    return number > 1_000_000_000_000 ? number : number * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function shellQuote(value) {
  const text = String(value || '');
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function appleScriptString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function sessionListFromJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.sessions)) return parsed.sessions;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function modelLabel(session) {
  const model = session?.model;
  if (typeof model === 'string') {
    return firstPresent(session.provider, session.providerID, session.providerId)
      ? `${firstPresent(session.provider, session.providerID, session.providerId)}/${model}`
      : model;
  }

  if (model && typeof model === 'object') {
    const provider = firstPresent(model.providerID, model.providerId, model.provider, session.providerID, session.providerId);
    const modelId = firstPresent(model.modelID, model.modelId, model.id, model.name);
    if (provider && modelId) return `${provider}/${modelId}`;
    if (modelId) return String(modelId);
  }

  const provider = firstPresent(session.providerID, session.providerId, session.provider);
  const modelId = firstPresent(session.modelID, session.modelId, session.modelName);
  if (provider && modelId) return `${provider}/${modelId}`;
  return String(modelId || provider || '');
}

function tokenTotal(session) {
  const direct = firstPresent(
    session.totalTokens,
    session.total_tokens,
    session.tokensUsed,
    session.tokenUsage,
    session.usage?.totalTokens,
    session.usage?.total_tokens,
    session.usage?.total,
    session.tokens?.total,
    session.token?.total,
  );
  if (direct !== undefined) return coerceNumber(direct);

  const usage = session.tokens || session.token || session.usage || {};
  return [
    usage.input,
    usage.inputTokens,
    usage.input_tokens,
    usage.output,
    usage.outputTokens,
    usage.output_tokens,
    usage.cache,
    usage.cacheTokens,
    usage.cache_tokens,
    usage.reasoning,
    usage.reasoningTokens,
    usage.reasoning_tokens,
  ].reduce((sum, value) => sum + coerceNumber(value), 0);
}

function openCommandForSession(session) {
  const externalId = firstPresent(session.externalId, session.id, session.sessionId, session.sessionID);
  const cwd = session.cwd || '';
  const command = `opencode --session ${shellQuote(externalId)}`;
  return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
}

function desktopDeepLink(directory) {
  return `opencode://open-project?directory=${encodeURIComponent(directory)}`;
}

function desktopOpenCommand(directory) {
  return `open ${shellQuote(desktopDeepLink(directory))}`;
}

async function execOpenCode(args) {
  const { stdout } = await execFileAsync('opencode', args, {
    timeout: 5000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function parseStoreValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function readTailText(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    if (length <= 0) return '';

    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function listDesktopCacheFiles(dataDir, maxFiles) {
  const cacheDir = path.join(dataDir, 'Cache', 'Cache_Data');
  let names = [];
  try {
    names = await fs.readdir(cacheDir);
  } catch {
    return [];
  }

  const entries = await Promise.all(names.map(async (name) => {
    const filePath = path.join(cacheDir, name);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return null;
      return { filePath, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }));

  return entries
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.filePath);
}

function parseServerEventLine(line) {
  const index = line.indexOf('data: ');
  if (index < 0) return null;

  const raw = line.slice(index + 'data: '.length).trim();
  if (!raw || raw === '[DONE]') return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeDesktopPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  if (payload.type === 'sync' && payload.syncEvent?.data) {
    return {
      type: String(payload.syncEvent.type || '').replace(/\.\d+$/, ''),
      properties: payload.syncEvent.data,
      raw: payload,
    };
  }

  return {
    type: String(payload.type || ''),
    properties: payload.properties || {},
    raw: payload,
  };
}

function openCodeEventTimeMs(properties, part) {
  return timestampToMs(firstPresent(
    properties?.time,
    properties?.timestamp,
    part?.state?.time?.end,
    part?.state?.time?.start,
    part?.time?.updated,
    part?.time?.created,
  ));
}

function toolPartKey(part) {
  return String(firstPresent(
    part?.id,
    part?.callID,
    part?.callId,
    part?.toolCallID,
    part?.toolCallId,
    `${part?.tool || 'tool'}:${part?.messageID || part?.messageId || ''}`,
  ));
}

function isOpenTodo(todo) {
  const status = String(todo?.status || '').toLowerCase();
  return status && !['completed', 'done', 'cancelled', 'canceled'].includes(status);
}

function activeToolLabel(tool) {
  return String(firstPresent(tool?.title, tool?.tool, '工具调用'));
}

export async function loadOpenCodeDesktopSignals({
  dataDir = DEFAULT_DESKTOP_DATA_DIR,
  maxFiles = DEFAULT_DESKTOP_CACHE_FILES,
  maxBytesPerFile = DEFAULT_DESKTOP_CACHE_BYTES,
} = {}) {
  const toolEventsBySession = new Map();
  const todosBySession = new Map();
  const filePaths = await listDesktopCacheFiles(dataDir, maxFiles);

  for (const filePath of filePaths) {
    let text = '';
    try {
      text = await readTailText(filePath, maxBytesPerFile);
    } catch {
      continue;
    }

    for (const line of text.split(/\r?\n/)) {
      if (!line.includes('data: ')) continue;
      if (
        !line.includes('message.part.updated')
        && !line.includes('todo.updated')
      ) continue;
      if (
        line.length > 1_500_000
        && !line.includes('"status":"pending"')
        && !line.includes('"status":"running"')
        && !line.includes('todo.updated')
      ) continue;

      const event = parseServerEventLine(line);
      const normalized = normalizeDesktopPayload(event?.payload);
      if (!normalized?.type) continue;

      const properties = normalized.properties || {};
      if (normalized.type === 'message.part.updated') {
        const part = properties.part;
        if (!part || part.type !== 'tool') continue;

        const sessionID = String(firstPresent(
          properties.sessionID,
          properties.sessionId,
          part.sessionID,
          part.sessionId,
          '',
        ));
        if (!sessionID) continue;

        const status = String(firstPresent(part.state?.status, part.status, '')).toLowerCase();
        if (!status) continue;

        const signalAtMs = openCodeEventTimeMs(properties, part);
        const key = toolPartKey(part);
        const toolEvents = toolEventsBySession.get(sessionID) || new Map();
        const existing = toolEvents.get(key);
        if (!existing || signalAtMs >= existing.signalAtMs) {
          toolEvents.set(key, {
            id: key,
            tool: String(firstPresent(part.tool, part.name, 'tool')),
            title: activeToolLabel(part),
            status,
            signalAtMs,
          });
          toolEventsBySession.set(sessionID, toolEvents);
        }
      }

      if (normalized.type === 'todo.updated') {
        const sessionID = String(firstPresent(properties.sessionID, properties.sessionId, ''));
        const todos = Array.isArray(properties.todos) ? properties.todos : [];
        if (!sessionID || !todos.length) continue;

        const signalAtMs = timestampToMs(firstPresent(properties.time, properties.timestamp));
        const existing = todosBySession.get(sessionID);
        if (!existing || signalAtMs >= existing.signalAtMs) {
          todosBySession.set(sessionID, { todos, signalAtMs });
        }
      }
    }
  }

  const sessionIds = new Set([
    ...toolEventsBySession.keys(),
    ...todosBySession.keys(),
  ]);
  const sessions = {};

  for (const sessionID of sessionIds) {
    const toolEvents = [...(toolEventsBySession.get(sessionID)?.values() || [])];
    const pendingTools = toolEvents
      .filter((tool) => tool.status === 'pending')
      .sort((a, b) => b.signalAtMs - a.signalAtMs);
    const todoRecord = todosBySession.get(sessionID);
    const todos = todoRecord?.todos || [];
    const latestToolAtMs = toolEvents.reduce((latest, tool) => Math.max(latest, coerceNumber(tool.signalAtMs)), 0);
    const pendingToolAtMs = pendingTools.reduce((latest, tool) => Math.max(latest, coerceNumber(tool.signalAtMs)), 0);

    sessions[sessionID] = {
      pendingTools,
      pendingToolAtMs,
      todos,
      openTodoCount: todos.filter(isOpenTodo).length,
      latestEventAtMs: Math.max(latestToolAtMs, coerceNumber(todoRecord?.signalAtMs)),
    };
  }

  return { sessions };
}

async function readDesktopModelSelections(dataDir) {
  const modelBySession = new Map();
  const names = await fs.readdir(dataDir);
  const workspaceNames = names.filter((name) => /^opencode\.workspace.*\.dat$/.test(name));

  await Promise.all(workspaceNames.map(async (name) => {
    try {
      const store = await readJsonFile(path.join(dataDir, name));
      const selection = parseStoreValue(store['workspace:model-selection'], {});
      for (const [sessionId, value] of Object.entries(selection?.session || {})) {
        modelBySession.set(sessionId, value?.model || {});
      }
    } catch {
      // Desktop state files are best-effort cache records; ignore partial writes.
    }
  }));

  return modelBySession;
}

export function normalizeOpenCodeSession(session, nowMs = Date.now()) {
  const externalId = String(firstPresent(
    session.id,
    session.sessionId,
    session.sessionID,
    session.uuid,
    session.path,
  ) || '');
  const cwd = String(firstPresent(
    session.cwd,
    session.directory,
    session.projectPath,
    session.project?.path,
    '',
  ));
  const title = String(firstPresent(
    session.title,
    session.name,
    session.summary,
    session.description,
    session.firstMessage,
    session.prompt,
    'OpenCode 任务',
  ));
  const createdAtMs = timestampToMs(firstPresent(
    session.time?.created,
    session.createdAt,
    session.created_at,
    session.created,
  ));
  const updatedAtMs = timestampToMs(firstPresent(
    session.time?.updated,
    session.updatedAt,
    session.updated_at,
    session.updated,
    session.time?.created,
    session.createdAt,
    session.created_at,
    session.created,
  )) || createdAtMs || nowMs;
  const thread = {
    id: `opencode:${externalId}`,
    externalId,
    provider: OPEN_CODE_PROVIDER.id,
    providerLabel: OPEN_CODE_PROVIDER.label,
    title,
    cwd,
    projectName: cwd ? path.basename(cwd) : 'OpenCode',
    source: 'opencode',
    model: modelLabel(session),
    reasoningEffort: '',
    tokensUsed: tokenTotal(session),
    hasUnreadTurn: false,
    awaitingPermission: false,
    archived: Boolean(session.archived),
    createdAtMs: createdAtMs || updatedAtMs,
    updatedAtMs,
    rolloutPath: '',
    gitBranch: '',
    gitSha: '',
    gitOriginUrl: '',
    appDeepLink: '',
    canOpen: Boolean(externalId),
    openLabel: '打开',
    resumeCommand: externalId ? openCommandForSession({ externalId, cwd }) : '',
  };

  return enrichThreadRuntime(thread, nowMs);
}

export function normalizeOpenCodeDesktopSession(session, nowMs = Date.now()) {
  const externalId = String(session.id || '');
  const cwd = String(session.directory || '');
  const pendingTools = Array.isArray(session.openCodePendingTools) ? session.openCodePendingTools : [];
  const openCodeTodos = Array.isArray(session.openCodeTodos) ? session.openCodeTodos : [];
  const openCodePendingToolAtMs = coerceNumber(session.openCodePendingToolAtMs)
    || pendingTools.reduce((latest, tool) => Math.max(latest, coerceNumber(tool.signalAtMs)), 0);
  const openCodeLatestEventAtMs = coerceNumber(session.openCodeLatestEventAtMs);
  const updatedAtMs = Math.max(
    timestampToMs(session.updatedAtMs || session.at),
    openCodeLatestEventAtMs,
  ) || nowMs;
  const appDeepLink = cwd ? desktopDeepLink(cwd) : '';
  const awaitingPermission = Boolean(session.awaitingPermission || pendingTools.length);
  const pendingToolText = pendingTools.map(activeToolLabel).slice(0, 3).join('、');
  const thread = {
    id: `opencode:${externalId}`,
    externalId,
    provider: OPEN_CODE_PROVIDER.id,
    providerLabel: OPEN_CODE_PROVIDER.label,
    title: session.title || (cwd ? path.basename(cwd) : 'OpenCode 任务'),
    cwd,
    projectName: cwd ? path.basename(cwd) : 'OpenCode',
    source: 'opencode-desktop',
    model: modelLabel(session),
    reasoningEffort: '',
    tokensUsed: 0,
    hasUnreadTurn: Boolean(session.hasUnreadTurn),
    awaitingPermission,
    awaitingReview: false,
    openCodePendingTools: pendingTools,
    openCodePendingToolCount: pendingTools.length,
    openCodePendingToolAtMs,
    openCodeTodos,
    openCodeTodoCount: coerceNumber(session.openCodeTodoCount, openCodeTodos.filter(isOpenTodo).length),
    archived: false,
    createdAtMs: updatedAtMs,
    updatedAtMs,
    rolloutPath: '',
    gitBranch: '',
    gitSha: '',
    gitOriginUrl: '',
    appDeepLink,
    canOpen: Boolean(appDeepLink),
    openLabel: '打开',
    resumeCommand: appDeepLink ? desktopOpenCommand(cwd) : '',
    lastAgentMessage: awaitingPermission
      ? `OpenCode 请求权限：${pendingToolText || '工具调用'}`
      : '',
  };

  return enrichThreadRuntime(thread, nowMs);
}

export async function loadOpenCodeDesktopThreads({
  dataDir = DEFAULT_DESKTOP_DATA_DIR,
  nowMs = Date.now(),
} = {}) {
  const globalStore = await readJsonFile(path.join(dataDir, 'opencode.global.dat'));
  const layoutPage = parseStoreValue(globalStore['layout.page'], {});
  const notifications = parseStoreValue(globalStore.notification, {});
  const modelBySession = await readDesktopModelSelections(dataDir);
  const desktopSignals = await loadOpenCodeDesktopSignals({ dataDir });
  const notificationBySession = new Map();

  for (const item of notifications?.list || []) {
    if (!item?.session) continue;
    const existing = notificationBySession.get(item.session);
    if (!existing || timestampToMs(item.time) > timestampToMs(existing.time)) {
      notificationBySession.set(item.session, item);
    }
  }

  const sessions = Object.values(layoutPage?.lastProjectSession || {})
    .map((entry) => {
      const notification = notificationBySession.get(entry.id);
      const signal = desktopSignals.sessions?.[entry.id] || {};
      return {
        ...entry,
        model: modelBySession.get(entry.id),
        updatedAtMs: Math.max(
          timestampToMs(entry.at),
          timestampToMs(notification?.time),
          coerceNumber(signal.latestEventAtMs),
        ),
        hasUnreadTurn: notification ? notification.viewed === false : false,
        awaitingPermission: Boolean(signal.pendingTools?.length),
        openCodePendingTools: signal.pendingTools || [],
        openCodePendingToolAtMs: signal.pendingToolAtMs || 0,
        openCodeTodos: signal.todos || [],
        openCodeTodoCount: signal.openTodoCount || 0,
        openCodeLatestEventAtMs: signal.latestEventAtMs || 0,
      };
    })
    .filter((entry) => entry.id && entry.directory);
  const threads = sessions.map((session) => normalizeOpenCodeDesktopSession(session, nowMs));
  const pendingPermissionCount = threads.filter((thread) => thread.awaitingPermission).length;

  return {
    provider: {
      ...OPEN_CODE_PROVIDER,
      installed: true,
      cliInstalled: false,
      desktopInstalled: true,
      status: 'desktop',
      message: threads.length
        ? `已检测到 OpenCode 桌面端，读取 ${threads.length} 个最近任务${pendingPermissionCount ? `，${pendingPermissionCount} 个等待授权` : ''}`
        : '已检测到 OpenCode 桌面端，暂无最近任务',
      threadCount: threads.length,
    },
    threads,
  };
}

export async function loadOpenCodeThreads({
  maxCount = DEFAULT_MAX_COUNT,
  nowMs = Date.now(),
  runOpenCode = execOpenCode,
  desktopDataDir = DEFAULT_DESKTOP_DATA_DIR,
} = {}) {
  const args = ['session', 'list', '--max-count', String(maxCount), '--format', 'json'];

  try {
    const stdout = await runOpenCode(args);
    const parsed = JSON.parse(String(stdout || '').trim() || '[]');
    const sessions = sessionListFromJson(parsed);
    const threads = sessions
      .map((session) => normalizeOpenCodeSession(session, nowMs))
      .filter((thread) => thread.externalId);

    return {
      provider: {
        ...OPEN_CODE_PROVIDER,
        installed: true,
        cliInstalled: true,
        desktopInstalled: false,
        status: 'ready',
        message: threads.length ? `已读取 ${threads.length} 个 OpenCode 任务` : '已接入，暂无任务',
        threadCount: threads.length,
      },
      threads,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      try {
        return await loadOpenCodeDesktopThreads({ dataDir: desktopDataDir, nowMs });
      } catch {
        return {
          provider: {
            ...OPEN_CODE_PROVIDER,
            installed: false,
            cliInstalled: false,
            desktopInstalled: false,
            status: 'missing',
            message: '未检测到 opencode CLI 或 OpenCode 桌面端数据',
            threadCount: 0,
          },
          threads: [],
        };
      }
    }

    return {
      provider: {
        ...OPEN_CODE_PROVIDER,
        installed: true,
        cliInstalled: true,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        threadCount: 0,
      },
      threads: [],
    };
  }
}

export async function openOpenCodeSession(thread, {
  platform = process.platform,
  runCommand = execFileAsync,
} = {}) {
  const resumeCommand = thread.resumeCommand || openCommandForSession(thread);
  if (!resumeCommand) {
    throw new Error('OpenCode 缺少 session id');
  }

  if (thread.appDeepLink) {
    const { command, args } = platform === 'darwin'
      ? { command: 'open', args: [thread.appDeepLink] }
      : { command: 'xdg-open', args: [thread.appDeepLink] };
    await runCommand(command, args);
    return {
      opened: true,
      method: 'opencode-deeplink',
      resumeCommand,
    };
  }

  if (platform === 'darwin') {
    await runCommand('osascript', [
      '-e',
      `tell application "Terminal" to do script "${appleScriptString(resumeCommand)}"`,
    ]);
    return {
      opened: true,
      method: 'opencode-terminal',
      resumeCommand,
    };
  }

  return {
    opened: false,
    method: 'copy-command',
    resumeCommand,
  };
}
