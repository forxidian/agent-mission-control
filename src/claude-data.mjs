import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import { enrichThreadRuntime } from './insights.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const DEFAULT_CLAUDE_APP_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Claude');
const DEFAULT_MAX_COUNT = 80;
const DEFAULT_MAX_JSONL_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_CACHE_COUNT = 400;
const DEFAULT_MAX_CACHE_ENTRY_BYTES = 5 * 1024 * 1024;
const LOW_SIGNAL_USER_MESSAGE = /^(\.|继续|继续吧|你继续|你继续吧|好的|好的好的|可以|可以的|行|ok|okay|收到|嗯|嗯嗯)$/iu;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLAUDE_USAGE_CACHE_PATTERN = /https:\/\/claude\.ai\/api\/organizations\/([^/\0]+)\/usage\b/;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export const CLAUDE_PROVIDER_IDS = new Set([
  'claude-code-cli',
  'claude-desktop-code',
  'claude-desktop-cowork',
]);

const CLAUDE_CODE_CLI_PROVIDER = {
  id: 'claude-code-cli',
  label: 'Claude Code CLI',
};

const CLAUDE_DESKTOP_CODE_PROVIDER = {
  id: 'claude-desktop-code',
  label: 'Claude Desktop Code',
};

const CLAUDE_DESKTOP_COWORK_PROVIDER = {
  id: 'claude-desktop-cowork',
  label: 'Claude Cowork',
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

function timestampToUnixSeconds(value) {
  const timestampMs = timestampToMs(value);
  return timestampMs ? Math.floor(timestampMs / 1000) : null;
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function optionalBoolean(object, key) {
  return hasOwn(object, key) ? Boolean(object[key]) : null;
}

function shellQuote(value) {
  const text = String(value || '');
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function appleScriptString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function compactInlineText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function truncateText(value = '', maxLength = 140) {
  const text = compactInlineText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isMeaningfulUserText(value = '') {
  const text = compactInlineText(value);
  if (text.length < 2) return false;
  if (LOW_SIGNAL_USER_MESSAGE.test(text)) return false;
  if (text.startsWith('<local-command-caveat>')) return false;
  return true;
}

function contentText(content, { includeToolResults = false } = {}) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      if (item.type === 'tool_result' && !includeToolResults) return '';
      if (typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string' && (includeToolResults || item.type !== 'tool_result')) {
        return item.content;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function usageTokenTotal(usage) {
  if (!usage || typeof usage !== 'object') return 0;

  const direct = firstPresent(
    usage.total_tokens,
    usage.totalTokens,
    usage.total,
  );
  if (direct !== undefined) return coerceNumber(direct);

  const tokenTotal = [
    usage.input_tokens,
    usage.inputTokens,
    usage.output_tokens,
    usage.outputTokens,
    usage.cache_creation_input_tokens,
    usage.cacheCreationInputTokens,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
    usage.reasoning_tokens,
    usage.reasoningTokens,
  ].reduce((sum, value) => sum + coerceNumber(value), 0);

  if (tokenTotal > 0) return tokenTotal;

  if (Array.isArray(usage.iterations)) {
    return usage.iterations.reduce((sum, item) => sum + usageTokenTotal(item), 0);
  }

  if (usage.modelUsage && typeof usage.modelUsage === 'object') {
    return Object.values(usage.modelUsage)
      .reduce((sum, item) => sum + usageTokenTotal(item), 0);
  }

  return 0;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeClaudeUsageWindow(window, windowMinutes) {
  if (!window || typeof window !== 'object') return null;

  const usedPercent = firstFiniteNumber(
    window.used_percent,
    window.usedPercentage,
    window.used_percentage,
    window.utilization,
  );
  if (usedPercent === null) return null;

  const resetsAt = timestampToUnixSeconds(firstPresent(
    window.resets_at,
    window.resetsAt,
    window.reset_at,
    window.resetAt,
  ));

  return {
    used_percent: usedPercent,
    resets_at: resetsAt,
    window_minutes: coerceNumber(window.window_minutes || window.windowMinutes, windowMinutes),
  };
}

function normalizeFirstClaudeUsageWindow(windowMinutes, ...windows) {
  for (const window of windows) {
    const normalized = normalizeClaudeUsageWindow(window, windowMinutes);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizeClaudeUsageRateLimits(value) {
  if (!value || typeof value !== 'object') return null;

  const primary = normalizeFirstClaudeUsageWindow(
    300,
    value.primary,
    value.five_hour,
    value.fiveHour,
    value['5h'],
  );
  const secondary = normalizeFirstClaudeUsageWindow(
    10_080,
    value.secondary,
    value.seven_day,
    value.sevenDay,
    value['7d'],
    value.seven_day_cowork,
    value.sevenDayCowork,
    value.seven_day_opus,
    value.sevenDayOpus,
    value.seven_day_sonnet,
    value.sevenDaySonnet,
    value.seven_day_omelette,
    value.sevenDayOmelette,
  );

  if (!primary && !secondary) return null;
  return {
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}

function rememberRateLimits(signals, value, timestampMs) {
  const rateLimits = normalizeClaudeUsageRateLimits(value);
  if (!rateLimits) return;

  signals.rateLimits = rateLimits;
  signals.latestRateLimitAtMs = timestampMs || signals.latestEventAtMs || signals.latestRateLimitAtMs;
}

function rateLimitCandidates(event) {
  return [
    event?.rate_limits,
    event?.rateLimits,
    event?.payload?.rate_limits,
    event?.payload?.rateLimits,
    event?.message?.rate_limits,
    event?.message?.rateLimits,
    event?.status_line?.rate_limits,
    event?.statusLine?.rate_limits,
    event?.statusLine?.rateLimits,
  ].filter(Boolean);
}

function modelFromUsageModelUsage(modelUsage) {
  if (!modelUsage || typeof modelUsage !== 'object') return '';
  const [model] = Object.entries(modelUsage)
    .sort((a, b) => usageTokenTotal(b[1]) - usageTokenTotal(a[1]))[0] || [];
  return model || '';
}

function isPermissionToolUse(item) {
  const name = String(item?.name || item?.tool || '');
  return /(^AskUserQuestion$|permission|approval|request.*directory|request.*folder|allow_cowork_file_delete|ask.*user)/i.test(name);
}

function toolUseTitle(item) {
  const name = String(item?.name || item?.tool || '工具调用');
  if (name === 'AskUserQuestion') return '向用户提问';
  if (name.includes('request_cowork_directory')) return '请求选择文件夹';
  if (name.includes('allow_cowork_file_delete')) return '请求删除文件';
  return name.replace(/^mcp__/, '').replaceAll('__', ' / ');
}

function addUsage(signals, usage, timestampMs, usageKey, bucket = 'assistant') {
  const tokens = usageTokenTotal(usage);
  if (tokens <= 0 || signals.seenUsageKeys.has(usageKey)) return;

  signals.seenUsageKeys.add(usageKey);
  const tokenKey = bucket === 'result' ? 'resultTokensUsed' : 'assistantTokensUsed';
  const todayTokenKey = bucket === 'result' ? 'resultTodayTokenUsage' : 'assistantTodayTokenUsage';
  signals[tokenKey] += tokens;
  if (signals.todayStartMs && timestampMs >= signals.todayStartMs) {
    signals[todayTokenKey] += tokens;
  }
}

function initialSignals(todayStartMs = 0) {
  return {
    todayStartMs,
    assistantTokensUsed: 0,
    assistantTodayTokenUsage: 0,
    resultTokensUsed: 0,
    resultTodayTokenUsage: 0,
    tokensUsed: 0,
    todayTokenUsage: 0,
    rateLimits: null,
    latestRateLimitAtMs: null,
    seenUsageKeys: new Set(),
    sessionId: '',
    cwd: '',
    entrypoint: '',
    version: '',
    model: '',
    gitBranch: '',
    firstUserMessage: '',
    latestUserMessage: '',
    latestMeaningfulUserMessage: '',
    latestUserMessageAtMs: null,
    latestAgentFinalAtMs: null,
    latestMessageKind: '',
    lastAgentMessage: '',
    oldestEventAtMs: null,
    latestEventAtMs: null,
    pendingToolsById: new Map(),
    pendingToolAtMs: 0,
  };
}

function rememberTimestamp(signals, timestampMs) {
  if (!timestampMs) return;
  signals.oldestEventAtMs = signals.oldestEventAtMs
    ? Math.min(signals.oldestEventAtMs, timestampMs)
    : timestampMs;
  signals.latestEventAtMs = Math.max(signals.latestEventAtMs || 0, timestampMs);
}

function handleUserEvent(signals, event, timestampMs) {
  if (event.isMeta) return;

  const content = event.message?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const toolUseId = item?.tool_use_id || item?.toolUseId;
      if (item?.type === 'tool_result' && toolUseId) {
        signals.pendingToolsById.delete(String(toolUseId));
      }
    }
  }

  const text = contentText(content);
  if (text && isMeaningfulUserText(text)) {
    const compactText = truncateText(text, 500);
    signals.firstUserMessage ||= compactText;
    signals.latestUserMessage = compactText;
    signals.latestMeaningfulUserMessage = compactText;
    signals.latestUserMessageAtMs = timestampMs || signals.latestUserMessageAtMs;
    signals.latestMessageKind = 'user';
  }
}

function handleAssistantEvent(signals, event, timestampMs) {
  const message = event.message || {};
  const messageId = message.id || event.uuid || '';
  const text = contentText(message.content);
  const hasText = Boolean(compactInlineText(text));

  if (message.model) signals.model = String(message.model);
  if (message.usage) {
    addUsage(signals, message.usage, timestampMs, `assistant:${messageId || timestampMs}:${JSON.stringify({
      i: message.usage.input_tokens,
      o: message.usage.output_tokens,
      cr: message.usage.cache_read_input_tokens,
      cc: message.usage.cache_creation_input_tokens,
    })}`);
  }

  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item?.type !== 'tool_use' || !item.id || !isPermissionToolUse(item)) continue;
      signals.pendingToolsById.set(String(item.id), {
        id: String(item.id),
        tool: String(item.name || 'tool'),
        title: toolUseTitle(item),
        status: 'pending',
        kind: 'permission',
        signalAtMs: timestampMs,
      });
      signals.pendingToolAtMs = Math.max(signals.pendingToolAtMs, timestampMs);
    }
  }

  if (hasText) {
    signals.lastAgentMessage = truncateText(text, 500);
    signals.latestAgentFinalAtMs = timestampMs || signals.latestAgentFinalAtMs;
    signals.latestMessageKind = 'agent';
  }
}

function handleResultEvent(signals, event, timestampMs) {
  signals.pendingToolsById.clear();
  signals.pendingToolAtMs = 0;

  if (event.usage) {
    addUsage(signals, event.usage, timestampMs, `result:${event.uuid || event.session_id || timestampMs}`, 'result');
  }

  if (event.modelUsage) {
    signals.model ||= modelFromUsageModelUsage(event.modelUsage);
  }

  if (event.result) {
    signals.lastAgentMessage = truncateText(event.result, 500);
  }

  if (!event.is_error && event.terminal_reason !== 'interrupted') {
    signals.latestAgentFinalAtMs = timestampMs || signals.latestAgentFinalAtMs;
    signals.latestMessageKind = 'agent';
  }
}

export function parseClaudeJsonlSignals(jsonlText = '', { todayStartMs = 0 } = {}) {
  const signals = initialSignals(todayStartMs);

  for (const line of String(jsonlText).split('\n')) {
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const timestampMs = timestampToMs(event.timestamp || event._audit_timestamp);
    rememberTimestamp(signals, timestampMs);
    for (const candidate of rateLimitCandidates(event)) {
      rememberRateLimits(signals, candidate, timestampMs);
    }

    signals.sessionId ||= String(event.sessionId || event.session_id || '');
    signals.cwd ||= String(event.cwd || '');
    signals.entrypoint ||= String(event.entrypoint || event.client_platform || '');
    signals.version ||= String(event.version || event.claude_code_version || '');
    signals.gitBranch ||= String(event.gitBranch || event.git_branch || '');

    if (event.type === 'user') {
      handleUserEvent(signals, event, timestampMs);
      continue;
    }

    if (event.type === 'assistant') {
      handleAssistantEvent(signals, event, timestampMs);
      continue;
    }

    if (event.type === 'result') {
      handleResultEvent(signals, event, timestampMs);
      continue;
    }

    if (event.type === 'system' && event.subtype === 'init') {
      signals.cwd ||= String(event.cwd || '');
      signals.model ||= String(event.model || '');
      signals.version ||= String(event.claude_code_version || '');
    }
  }

  const pendingTools = [...signals.pendingToolsById.values()]
    .sort((a, b) => coerceNumber(b.signalAtMs) - coerceNumber(a.signalAtMs));
  const pendingToolAtMs = pendingTools
    .reduce((latest, tool) => Math.max(latest, coerceNumber(tool.signalAtMs)), 0);
  const tokensUsed = signals.resultTokensUsed || signals.assistantTokensUsed;
  const todayTokenUsage = signals.resultTokensUsed
    ? signals.resultTodayTokenUsage
    : signals.assistantTodayTokenUsage;

  return {
    ...signals,
    tokensUsed,
    todayTokenUsage,
    seenUsageKeys: undefined,
    pendingToolsById: undefined,
    pendingToolAtMs,
    pendingTools,
    pendingToolCount: pendingTools.length,
  };
}

async function readTailText(filePath, maxBytes = DEFAULT_MAX_JSONL_BYTES) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    if (length <= 0) return '';

    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return text;

    const firstNewline = text.indexOf('\n');
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
  } finally {
    await handle.close();
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function firstJsonObjectText(text = '') {
  const start = String(text).indexOf('{');
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return '';
}

function parseJsonObjectFromText(text = '') {
  const json = firstJsonObjectText(text);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function zstdFrames(buffer) {
  const positions = [];
  let offset = 0;
  while (offset >= 0 && offset < buffer.length) {
    const position = buffer.indexOf(ZSTD_MAGIC, offset);
    if (position < 0) break;
    positions.push(position);
    offset = position + 1;
  }
  return positions;
}

export function parseClaudeUsageCacheEntry(buffer, { filePath = '', mtimeMs = 0 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const text = buffer.toString('utf8');
  const usageMatch = text.match(CLAUDE_USAGE_CACHE_PATTERN);
  if (!usageMatch) return null;

  const bodyCandidates = [];
  for (const position of zstdFrames(buffer)) {
    if (!zlib.zstdDecompressSync) continue;
    try {
      bodyCandidates.push(zlib.zstdDecompressSync(buffer.subarray(position)).toString('utf8'));
    } catch {
      // Not every zstd-looking byte sequence is a complete cache body.
    }
  }
  bodyCandidates.push(text.slice(Math.max(0, usageMatch.index || 0)));

  for (const bodyText of bodyCandidates) {
    const payload = parseJsonObjectFromText(bodyText);
    const rateLimits = normalizeClaudeUsageRateLimits(payload);
    if (!rateLimits) continue;

    const dateMatch = text.match(/date:([^\0\r\n]+)/i);
    const observedAtMs = timestampToMs(dateMatch?.[1]) || coerceNumber(mtimeMs);
    return {
      source: 'claude-desktop-cache',
      sourcePath: filePath,
      organizationId: usageMatch[1],
      observedAtMs,
      payload,
      rateLimits,
    };
  }

  return null;
}

async function walkFiles(root, predicate, output = []) {
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return output;
  }

  await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(filePath, predicate, output);
      return;
    }

    if (entry.isFile() && predicate(filePath, entry.name)) {
      try {
        const stat = await fs.stat(filePath);
        output.push({ filePath, stat });
      } catch {
        // Ignore files that disappear during a scan.
      }
    }
  }));

  return output;
}

async function recentFiles(root, predicate, maxCount = DEFAULT_MAX_COUNT) {
  const files = await walkFiles(root, predicate);
  return files
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, maxCount);
}

export async function readClaudeUsageCache({
  appDir = DEFAULT_CLAUDE_APP_DIR,
  maxCount = DEFAULT_MAX_CACHE_COUNT,
  maxBytes = DEFAULT_MAX_CACHE_ENTRY_BYTES,
} = {}) {
  const cacheDir = path.join(appDir, 'Cache', 'Cache_Data');
  const files = await recentFiles(cacheDir, (_filePath, name) => !name.startsWith('index'), maxCount);
  const entries = [];

  await Promise.all(files.map(async ({ filePath, stat }) => {
    if (stat.size <= 0 || stat.size > maxBytes) return;
    try {
      const entry = parseClaudeUsageCacheEntry(await fs.readFile(filePath), {
        filePath,
        mtimeMs: stat.mtimeMs,
      });
      if (entry) entries.push(entry);
    } catch {
      // Chromium cache entries can disappear or be partially written while Claude runs.
    }
  }));

  return entries
    .sort((a, b) => coerceNumber(b.observedAtMs) - coerceNumber(a.observedAtMs))[0] || null;
}

async function commandVersion(command, args, runCommand = execFileAsync) {
  const { stdout, stderr } = await runCommand(command, args, { timeout: 5000 });
  return String(stdout || stderr || '').trim();
}

function claudeResumeCommand({ externalId, cwd }) {
  const command = `claude --resume ${shellQuote(externalId)}`;
  return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
}

function claudeAppCommand() {
  return 'open -a Claude';
}

function claudeDesktopCodeDeepLink(cliSessionId) {
  const sessionId = String(cliSessionId || '');
  if (!UUID_PATTERN.test(sessionId)) return '';
  return `claude://resume?session=${encodeURIComponent(sessionId)}`;
}

function claudeDesktopCodeOpenCommand(cliSessionId) {
  const deepLink = claudeDesktopCodeDeepLink(cliSessionId);
  return deepLink ? `open ${shellQuote(deepLink)}` : '';
}

function openCommandForUrl(url, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

function deriveTitle(preferredTitle, signals, fallbackTitle) {
  const stored = compactInlineText(preferredTitle);
  if (stored && stored.length <= 96) return truncateText(stored);

  return truncateText(
    signals.latestMeaningfulUserMessage
    || signals.latestUserMessage
    || signals.firstUserMessage
    || stored
    || fallbackTitle,
  );
}

function projectNameFromCwd(cwd, fallback) {
  if (!cwd) return fallback;
  return path.basename(cwd) || fallback;
}

function selectedFolderPath(folder) {
  if (!folder) return '';
  if (typeof folder === 'string') return folder;
  return String(folder.path || folder.hostPath || '');
}

function isInternalClaudePath(cwd = '') {
  return cwd.startsWith('/sessions/')
    || cwd.includes('/Library/Application Support/Claude/local-agent-mode-sessions/');
}

function workspaceFromCoworkSession(session, space) {
  const selected = (Array.isArray(session.userSelectedFolders) ? session.userSelectedFolders : [])
    .map(selectedFolderPath)
    .find(Boolean);
  const approved = (Array.isArray(session.userApprovedFileAccessPaths) ? session.userApprovedFileAccessPaths : [])
    .map(selectedFolderPath)
    .find(Boolean);
  const spaceFolder = space?.folders?.map(selectedFolderPath)?.find(Boolean) || '';
  const cwd = String(session.cwd || '');

  if (selected) return selected;
  if (approved) return approved;
  if (spaceFolder) return spaceFolder;
  return isInternalClaudePath(cwd) ? '' : cwd;
}

function baseClaudeThread({
  id,
  externalId,
  provider,
  providerLabel,
  source,
  title,
  cwd,
  projectName,
  model,
  archived,
  createdAtMs,
  updatedAtMs,
  signals,
  resumeCommand,
  canOpen = true,
  openLabel = '打开会话',
  extra = {},
}, nowMs) {
  const pendingTools = Array.isArray(signals?.pendingTools) ? signals.pendingTools : [];
  const thread = {
    id,
    externalId,
    provider,
    providerLabel,
    title,
    cwd,
    projectName,
    source,
    model: model || signals?.model || '',
    reasoningEffort: '',
    tokensUsed: coerceNumber(signals?.tokensUsed),
    todayTokenUsage: coerceNumber(signals?.todayTokenUsage),
    rateLimits: signals?.rateLimits || null,
    rateLimitUpdatedAtMs: coerceNumber(signals?.latestRateLimitAtMs) || null,
    hasUnreadTurn: false,
    awaitingPermission: pendingTools.length > 0,
    awaitingReview: false,
    pendingTools,
    pendingToolCount: pendingTools.length,
    pendingToolAtMs: coerceNumber(signals?.pendingToolAtMs),
    archived: Boolean(archived),
    createdAtMs: createdAtMs || updatedAtMs,
    updatedAtMs,
    latestAgentFinalAtMs: signals?.latestAgentFinalAtMs || null,
    latestUserMessageAtMs: signals?.latestUserMessageAtMs || null,
    latestMessageKind: signals?.latestMessageKind || '',
    firstUserMessage: signals?.firstUserMessage || '',
    latestUserMessage: signals?.latestUserMessage || '',
    latestMeaningfulUserMessage: signals?.latestMeaningfulUserMessage || '',
    lastAgentMessage: signals?.lastAgentMessage || '',
    rolloutPath: '',
    gitBranch: signals?.gitBranch || '',
    gitSha: '',
    gitOriginUrl: '',
    appDeepLink: '',
    canOpen,
    openLabel,
    resumeCommand,
    ...extra,
  };

  return enrichThreadRuntime(thread, nowMs);
}

function dedupeClaudeDesktopCodeThreads(threads) {
  const bySession = new Map();

  for (const thread of threads) {
    const key = thread.cliSessionId || thread.externalId || thread.id;
    const existing = bySession.get(key);
    if (!existing || coerceNumber(thread.updatedAtMs) > coerceNumber(existing.updatedAtMs)) {
      bySession.set(key, thread);
    }
  }

  return [...bySession.values()]
    .sort((a, b) => coerceNumber(b.updatedAtMs) - coerceNumber(a.updatedAtMs));
}

export function normalizeClaudeCodeCliSession({ filePath = '', stat = {}, signals = {} }, nowMs = Date.now()) {
  const externalId = String(signals.sessionId || path.basename(filePath, '.jsonl') || '');
  const cwd = String(signals.cwd || '');
  const updatedAtMs = coerceNumber(signals.latestEventAtMs || stat.mtimeMs || nowMs);
  const createdAtMs = coerceNumber(signals.oldestEventAtMs || stat.birthtimeMs || updatedAtMs);

  return baseClaudeThread({
    id: `${CLAUDE_CODE_CLI_PROVIDER.id}:${externalId}`,
    externalId,
    provider: CLAUDE_CODE_CLI_PROVIDER.id,
    providerLabel: CLAUDE_CODE_CLI_PROVIDER.label,
    source: 'claude-code-cli',
    title: deriveTitle('', signals, 'Claude Code 会话'),
    cwd,
    projectName: projectNameFromCwd(cwd, 'Claude Code'),
    model: signals.model,
    archived: false,
    createdAtMs,
    updatedAtMs,
    signals,
    resumeCommand: externalId ? claudeResumeCommand({ externalId, cwd }) : '',
    extra: {
      cliVersion: signals.version || '',
      entrypoint: signals.entrypoint || '',
    },
  }, nowMs);
}

export function normalizeClaudeDesktopCodeSession(session, {
  signals = {},
  stat = {},
} = {}, nowMs = Date.now()) {
  const externalId = String(session.sessionId || session.id || '');
  const cliSessionId = String(session.cliSessionId || '');
  const cwd = String(session.originCwd || session.cwd || signals.cwd || '');
  const updatedAtMs = Math.max(
    timestampToMs(session.lastActivityAt),
    coerceNumber(signals.latestEventAtMs),
    coerceNumber(stat.mtimeMs),
  ) || nowMs;
  const createdAtMs = timestampToMs(session.createdAt)
    || coerceNumber(signals.oldestEventAtMs)
    || updatedAtMs;
  const appDeepLink = claudeDesktopCodeDeepLink(cliSessionId);
  let resumeCommand = claudeAppCommand();
  if (appDeepLink) {
    resumeCommand = claudeDesktopCodeOpenCommand(cliSessionId);
  } else if (cliSessionId) {
    resumeCommand = claudeResumeCommand({ externalId: cliSessionId, cwd });
  }

  return baseClaudeThread({
    id: `${CLAUDE_DESKTOP_CODE_PROVIDER.id}:${externalId}`,
    externalId,
    provider: CLAUDE_DESKTOP_CODE_PROVIDER.id,
    providerLabel: CLAUDE_DESKTOP_CODE_PROVIDER.label,
    source: 'claude-desktop-code',
    title: deriveTitle(session.title, signals, 'Claude Desktop Code 会话'),
    cwd,
    projectName: projectNameFromCwd(cwd, 'Claude Desktop Code'),
    model: session.model || signals.model,
    archived: Boolean(session.isArchived),
    createdAtMs,
    updatedAtMs,
    signals,
    resumeCommand,
    extra: {
      appDeepLink,
      cliSessionId,
      permissionMode: session.permissionMode || '',
      completedTurns: coerceNumber(session.completedTurns),
    },
  }, nowMs);
}

export function normalizeClaudeDesktopCoworkSession(session, {
  signals = {},
  stat = {},
  space = null,
} = {}, nowMs = Date.now()) {
  const externalId = String(session.sessionId || session.id || '');
  const workspace = workspaceFromCoworkSession(session, space);
  const projectName = space?.name
    || projectNameFromCwd(workspace, session.scheduledTaskId ? 'Claude 定时任务' : 'Claude Cowork');
  const updatedAtMs = Math.max(
    timestampToMs(session.lastActivityAt),
    coerceNumber(signals.latestEventAtMs),
    coerceNumber(stat.mtimeMs),
  ) || nowMs;
  const createdAtMs = timestampToMs(session.createdAt)
    || coerceNumber(signals.oldestEventAtMs)
    || updatedAtMs;
  const isAgentCompleted = optionalBoolean(session, 'isAgentCompleted');
  const agentRunning = isAgentCompleted === false;

  return baseClaudeThread({
    id: `${CLAUDE_DESKTOP_COWORK_PROVIDER.id}:${externalId}`,
    externalId,
    provider: CLAUDE_DESKTOP_COWORK_PROVIDER.id,
    providerLabel: CLAUDE_DESKTOP_COWORK_PROVIDER.label,
    source: session.hostLoopMode === false ? 'claude-desktop-local-agent' : 'claude-desktop-cowork',
    title: deriveTitle(session.title, signals, 'Claude Cowork 会话'),
    cwd: workspace || String(session.cwd || ''),
    projectName,
    model: session.model || signals.model,
    archived: Boolean(session.isArchived),
    createdAtMs,
    updatedAtMs,
    signals,
    resumeCommand: claudeAppCommand(),
    openLabel: '打开 Claude',
    extra: {
      cliSessionId: session.cliSessionId || '',
      processName: session.processName || '',
      spaceId: session.spaceId || '',
      scheduledTaskId: session.scheduledTaskId || '',
      isAgentCompleted,
      agentRunning,
      agentStartedAtMs: agentRunning
        ? coerceNumber(signals.latestUserMessageAtMs || createdAtMs || updatedAtMs)
        : null,
      agentActivityAtMs: agentRunning ? updatedAtMs : null,
    },
  }, nowMs);
}

async function readSignalsForFile(filePath, { todayStartMs, maxBytes = DEFAULT_MAX_JSONL_BYTES } = {}) {
  try {
    return parseClaudeJsonlSignals(await readTailText(filePath, maxBytes), { todayStartMs });
  } catch {
    return parseClaudeJsonlSignals('', { todayStartMs });
  }
}

function mergeClaudeUsageCacheSignals(signals = {}, usageCache = null) {
  if (!usageCache?.rateLimits) return signals;

  const signalAtMs = coerceNumber(signals.latestRateLimitAtMs);
  const cacheAtMs = coerceNumber(usageCache.observedAtMs);
  if (signals.rateLimits && signalAtMs >= cacheAtMs) return signals;

  return {
    ...signals,
    rateLimits: usageCache.rateLimits,
    latestRateLimitAtMs: cacheAtMs || signalAtMs || signals.latestEventAtMs || null,
  };
}

async function indexClaudeProjectFiles(projectsDir = DEFAULT_CLAUDE_PROJECTS_DIR) {
  const files = await walkFiles(projectsDir, (_filePath, name) => name.endsWith('.jsonl'));
  return new Map(files.map((entry) => [path.basename(entry.filePath, '.jsonl'), entry]));
}

async function readCoworkSpaces(appDir = DEFAULT_CLAUDE_APP_DIR) {
  const files = await walkFiles(
    path.join(appDir, 'local-agent-mode-sessions'),
    (_filePath, name) => name === 'spaces.json',
  );
  const spaces = new Map();

  await Promise.all(files.map(async ({ filePath }) => {
    try {
      const parsed = await readJsonFile(filePath);
      for (const space of parsed?.spaces || []) {
        if (space?.id) spaces.set(String(space.id), space);
      }
    } catch {
      // Spaces are metadata only; ignore partial writes.
    }
  }));

  return spaces;
}

export async function loadClaudeCodeCliThreads({
  projectsDir = DEFAULT_CLAUDE_PROJECTS_DIR,
  maxCount = DEFAULT_MAX_COUNT,
  maxBytes = DEFAULT_MAX_JSONL_BYTES,
  excludeSessionIds = new Set(),
  nowMs = Date.now(),
  todayStartMs = 0,
  runCommand = execFileAsync,
} = {}) {
  const version = await commandVersion('claude', ['--version'], runCommand).catch(() => '');
  const files = await recentFiles(projectsDir, (_filePath, name) => name.endsWith('.jsonl'), maxCount * 2);
  const parsed = await Promise.all(files.map(async (entry) => ({
    ...entry,
    signals: await readSignalsForFile(entry.filePath, { todayStartMs, maxBytes }),
  })));
  const threads = parsed
    .map((entry) => normalizeClaudeCodeCliSession(entry, nowMs))
    .filter((thread) => (
      thread.externalId
      && !excludeSessionIds.has(thread.externalId)
    ))
    .slice(0, maxCount);

  return {
    provider: {
      ...CLAUDE_CODE_CLI_PROVIDER,
      installed: Boolean(version),
      cliInstalled: Boolean(version),
      status: version ? 'ready' : 'missing',
      message: version
        ? `已检测到 ${version}，读取 ${threads.length} 个 CLI 会话`
        : '未检测到 claude CLI',
      threadCount: threads.length,
    },
    threads,
  };
}

export async function loadClaudeDesktopCodeThreads({
  appDir = DEFAULT_CLAUDE_APP_DIR,
  projectsDir = DEFAULT_CLAUDE_PROJECTS_DIR,
  maxCount = DEFAULT_MAX_COUNT,
  maxBytes = DEFAULT_MAX_JSONL_BYTES,
  nowMs = Date.now(),
  todayStartMs = 0,
  usageCache,
} = {}) {
  const root = path.join(appDir, 'claude-code-sessions');
  const files = await recentFiles(root, (_filePath, name) => /^local_.*\.json$/.test(name), maxCount);
  const projectFiles = await indexClaudeProjectFiles(projectsDir).catch(() => new Map());
  const desktopUsageCache = usageCache === undefined
    ? await readClaudeUsageCache({ appDir }).catch(() => null)
    : usageCache;
  const parsed = await Promise.all(files.map(async (entry) => {
    try {
      const session = await readJsonFile(entry.filePath);
      const projectFile = projectFiles.get(String(session.cliSessionId || ''));
      const signals = projectFile
        ? await readSignalsForFile(projectFile.filePath, { todayStartMs, maxBytes })
        : parseClaudeJsonlSignals('', { todayStartMs });
      return {
        session,
        signals: mergeClaudeUsageCacheSignals(signals, desktopUsageCache),
        stat: entry.stat,
      };
    } catch {
      return null;
    }
  }));
  const threads = dedupeClaudeDesktopCodeThreads(parsed
    .filter(Boolean)
    .map((entry) => normalizeClaudeDesktopCodeSession(entry.session, entry, nowMs))
    .filter((thread) => thread.externalId));

  return {
    provider: {
      ...CLAUDE_DESKTOP_CODE_PROVIDER,
      installed: files.length > 0,
      desktopInstalled: files.length > 0,
      status: files.length ? 'desktop' : 'missing',
      message: files.length
        ? `已读取 ${threads.length} 个 Claude Desktop Code 会话`
        : '未检测到 Claude Desktop Code 会话',
      threadCount: threads.length,
    },
    threads,
  };
}

export async function loadClaudeDesktopCoworkThreads({
  appDir = DEFAULT_CLAUDE_APP_DIR,
  maxCount = DEFAULT_MAX_COUNT,
  maxBytes = DEFAULT_MAX_JSONL_BYTES,
  nowMs = Date.now(),
  todayStartMs = 0,
  usageCache,
} = {}) {
  const root = path.join(appDir, 'local-agent-mode-sessions');
  const files = await recentFiles(root, (_filePath, name) => /^local_.*\.json$/.test(name), maxCount);
  const spaces = await readCoworkSpaces(appDir);
  const desktopUsageCache = usageCache === undefined
    ? await readClaudeUsageCache({ appDir }).catch(() => null)
    : usageCache;
  const parsed = await Promise.all(files.map(async (entry) => {
    try {
      const session = await readJsonFile(entry.filePath);
      const auditPath = path.join(path.dirname(entry.filePath), path.basename(entry.filePath, '.json'), 'audit.jsonl');
      const signals = mergeClaudeUsageCacheSignals(
        await readSignalsForFile(auditPath, { todayStartMs, maxBytes }),
        desktopUsageCache,
      );
      return {
        session,
        signals,
        stat: entry.stat,
        space: spaces.get(String(session.spaceId || '')) || null,
      };
    } catch {
      return null;
    }
  }));
  const threads = parsed
    .filter(Boolean)
    .map((entry) => normalizeClaudeDesktopCoworkSession(entry.session, entry, nowMs))
    .filter((thread) => thread.externalId);
  const pendingPermissionCount = threads.filter((thread) => thread.awaitingPermission).length;

  return {
    provider: {
      ...CLAUDE_DESKTOP_COWORK_PROVIDER,
      installed: files.length > 0,
      desktopInstalled: files.length > 0,
      status: files.length ? 'desktop' : 'missing',
      message: files.length
        ? `已读取 ${threads.length} 个 Cowork 会话${pendingPermissionCount ? `，${pendingPermissionCount} 个等待处理` : ''}`
        : '未检测到 Claude Cowork 会话',
      threadCount: threads.length,
    },
    threads,
  };
}

export async function loadClaudeAgentThreads(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = options.todayStartMs || todayStart.getTime();

  const [desktopCodeResult, coworkResult] = await Promise.all([
    loadClaudeDesktopCodeThreads({ ...options, nowMs, todayStartMs }),
    loadClaudeDesktopCoworkThreads({ ...options, nowMs, todayStartMs }),
  ]);
  const desktopCliSessionIds = new Set(
    desktopCodeResult.threads
      .map((thread) => thread.cliSessionId)
      .filter(Boolean),
  );
  const cliResult = await loadClaudeCodeCliThreads({
    ...options,
    nowMs,
    todayStartMs,
    excludeSessionIds: desktopCliSessionIds,
  });

  return {
    providers: [
      cliResult.provider,
      desktopCodeResult.provider,
      coworkResult.provider,
    ],
    threads: [
      ...cliResult.threads,
      ...desktopCodeResult.threads,
      ...coworkResult.threads,
    ],
  };
}

export async function openClaudeThread(thread, {
  platform = process.platform,
  runCommand = execFileAsync,
} = {}) {
  if (thread.provider === 'claude-desktop-code') {
    const appDeepLink = thread.appDeepLink || claudeDesktopCodeDeepLink(thread.cliSessionId);
    const resumeCommand = thread.resumeCommand
      || (appDeepLink ? `open ${shellQuote(appDeepLink)}` : claudeAppCommand());

    if (appDeepLink) {
      const { command, args } = openCommandForUrl(appDeepLink, platform);
      await runCommand(command, args);
      return {
        opened: true,
        method: 'claude-desktop-deeplink',
        resumeCommand,
      };
    }

    if (platform === 'darwin') {
      await runCommand('open', ['-a', 'Claude']);
      return {
        opened: true,
        method: 'claude-app',
        resumeCommand,
      };
    }

    return {
      opened: false,
      method: 'copy-command',
      resumeCommand,
    };
  }

  if (thread.provider === 'claude-desktop-cowork') {
    if (platform === 'darwin') {
      await runCommand('open', ['-a', 'Claude']);
      return {
        opened: true,
        method: 'claude-app',
        resumeCommand: thread.resumeCommand || claudeAppCommand(),
      };
    }

    return {
      opened: false,
      method: 'copy-command',
      resumeCommand: thread.resumeCommand || claudeAppCommand(),
    };
  }

  const resumeCommand = thread.resumeCommand || (thread.externalId
    ? claudeResumeCommand({ externalId: thread.externalId, cwd: thread.cwd })
    : '');
  if (!resumeCommand) {
    throw new Error('Claude 会话缺少 resume 命令');
  }

  if (platform === 'darwin') {
    await runCommand('osascript', [
      '-e',
      `tell application "Terminal" to do script "${appleScriptString(resumeCommand)}"`,
    ]);
    return {
      opened: true,
      method: 'claude-terminal',
      resumeCommand,
    };
  }

  return {
    opened: false,
    method: 'copy-command',
    resumeCommand,
  };
}
