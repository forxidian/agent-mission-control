import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildDashboard, enrichThreads } from './insights.mjs';
import {
  addTokenBreakdowns,
  emptyTokenBreakdown,
  normalizeTokenBreakdown,
} from './token-usage.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_CODEX_DIR = path.join(os.homedir(), '.codex');
const DEFAULT_STATE_DB = path.join(DEFAULT_CODEX_DIR, 'state_5.sqlite');
const DEFAULT_SESSION_INDEX = path.join(DEFAULT_CODEX_DIR, 'session_index.jsonl');
const DEFAULT_SESSIONS_DIR = path.join(DEFAULT_CODEX_DIR, 'sessions');
const DEFAULT_GLOBAL_STATE = path.join(DEFAULT_CODEX_DIR, '.codex-global-state.json');
const CODEX_PINNED_THREAD_IDS_KEY = 'pinned-thread-ids';
const DEFAULT_AUTH_PATH = path.join(DEFAULT_CODEX_DIR, 'auth.json');
const DEFAULT_CODEX_BACKEND_API_BASE_URL = 'https://chatgpt.com/backend-api';
const CODEX_RESET_CREDITS_PATH = '/wham/rate-limit-reset-credits';
const DEFAULT_THREAD_LIMIT = 5000;
const DEFAULT_ORPHAN_ROLLOUT_LIMIT = 160;
const DEFAULT_INITIAL_ROLLOUT_BYTES = 512 * 1024;
const DEFAULT_MAX_ROLLOUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_ROLLOUT_SIGNAL_CACHE_LIMIT = 256;
const DEFAULT_RESET_CREDITS_TIMEOUT_MS = 30000;
const DEFAULT_RESET_CREDITS_CACHE_TTL_MS = 10 * 60 * 1000;
const COMPLETION_HINT = /(\bdone\b|\bcompleted?\b|ready for review|handoff|完成|已完成|验收|交付|交接|可以看|可以试)/i;
const DISPLAY_TITLE_LENGTH = 140;
const LOW_SIGNAL_USER_MESSAGE = /^(继续|继续吧|你继续|你继续吧|好的|好的好的|可以|可以的|行|ok|okay|收到|嗯|嗯嗯|先这样)$/iu;
const ROLLOUT_FILE_RE = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const ARTIFACT_SUMMARY_LIMIT = 3;
const MEDIA_PLACEHOLDERS = ['[图片]', '[视频]', '[音频]', '[文件]'];
const IMAGE_ARTIFACT_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp']);
const VIDEO_ARTIFACT_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);
const AUDIO_ARTIFACT_EXTENSIONS = new Set(['aac', 'aiff', 'flac', 'm4a', 'mp3', 'wav']);
const LOCAL_ARTIFACT_EXTENSIONS = [
  'avif', 'bmp', 'gif', 'heic', 'jpeg', 'jpg', 'png', 'svg', 'tif', 'tiff', 'webp',
  'html', 'htm', 'md', 'markdown', 'mdx', 'pdf',
  'doc', 'docx', 'pages', 'rtf', 'csv', 'numbers', 'xls', 'xlsx',
  'key', 'ppt', 'pptx', 'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm',
  'aac', 'aiff', 'flac', 'm4a', 'mp3', 'wav',
  'zip', 'gz', 'rar', 'tar', 'tgz', '7z',
  'txt', 'log', 'css', 'go', 'java', 'js', 'json', 'jsx', 'mjs', 'py', 'rs', 'sh', 'ts', 'tsx', 'xml', 'yaml', 'yml',
];
const LOCAL_ARTIFACT_EXTENSION_RE = LOCAL_ARTIFACT_EXTENSIONS.join('|');
const rolloutSignalCache = new Map();
const codexCacheMetrics = {
  rolloutSignalHits: 0,
  rolloutSignalMisses: 0,
  rolloutSignalWrites: 0,
  rolloutSignalEvictions: 0,
};
const resetCreditsCache = {
  key: '',
  value: null,
  fetchedAtMs: 0,
  pending: null,
};

function safeLimit(limit) {
  const number = Number.parseInt(limit, 10);
  if (!Number.isFinite(number)) return DEFAULT_THREAD_LIMIT;
  return Math.min(Math.max(number, 1), DEFAULT_THREAD_LIMIT);
}

async function querySqliteJson(databasePath, sql) {
  const { stdout } = await execFileAsync('sqlite3', ['-json', databasePath, sql], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

async function commandVersion(command, args, runCommand = execFileAsync) {
  const { stdout, stderr } = await runCommand(command, args, { timeout: 5000 });
  return String(stdout || stderr || '').trim();
}

async function readCodexAuth(authPath = DEFAULT_AUTH_PATH) {
  try {
    return JSON.parse(await fs.readFile(authPath, 'utf8'));
  } catch {
    return null;
  }
}

function accountIdFromAccessToken(accessToken = '') {
  const [, payload] = String(accessToken).split('.');
  if (!payload) return '';

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const auth = parsed?.['https://api.openai.com/auth'];
    return typeof auth?.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : '';
  } catch {
    return '';
  }
}

function backendUrl(baseUrl, route) {
  return `${String(baseUrl || DEFAULT_CODEX_BACKEND_API_BASE_URL).replace(/\/+$/, '')}/${String(route).replace(/^\/+/, '')}`;
}

function codexResetCreditsEnabled(value = process.env.AMC_CODEX_RESET_CREDITS) {
  const normalized = String(value ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(normalized);
}

async function fetchCodexResetCredits({
  authPath = DEFAULT_AUTH_PATH,
  apiBaseUrl = DEFAULT_CODEX_BACKEND_API_BASE_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_RESET_CREDITS_TIMEOUT_MS,
  nowMs = Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') return null;

  const auth = await readCodexAuth(authPath);
  const accessToken = auth?.tokens?.access_token || auth?.access_token || '';
  if (!accessToken) return null;

  const accountId = auth?.tokens?.account_id || auth?.account_id || accountIdFromAccessToken(accessToken);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  try {
    const response = await fetchImpl(backendUrl(apiBaseUrl, CODEX_RESET_CREDITS_PATH), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
        'OAI-Language': 'zh-CN',
        originator: 'Codex Desktop',
        'User-Agent': 'Agent Mission Control',
      },
      signal: controller.signal,
    });

    if (!response?.ok) return null;
    const payload = await response.json();
    return {
      ...payload,
      observedAtMs: nowMs,
      source: 'chatgpt-wham-rate-limit-reset-credits',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function readCodexResetCredits({
  useCache = false,
  refreshInBackground = false,
  cacheTtlMs = DEFAULT_RESET_CREDITS_CACHE_TTL_MS,
  nowMs = Date.now(),
  ...options
} = {}) {
  const cacheKey = [
    options.authPath || DEFAULT_AUTH_PATH,
    options.apiBaseUrl || DEFAULT_CODEX_BACKEND_API_BASE_URL,
  ].join('|');
  const hasUsableCache = resetCreditsCache.value
    && resetCreditsCache.key === cacheKey
    && nowMs - resetCreditsCache.fetchedAtMs < cacheTtlMs;
  if (useCache && hasUsableCache) return resetCreditsCache.value;

  const refresh = () => {
    if (!resetCreditsCache.pending || resetCreditsCache.key !== cacheKey) {
      resetCreditsCache.key = cacheKey;
      resetCreditsCache.pending = fetchCodexResetCredits({ ...options, nowMs })
        .then((value) => {
          if (value) {
            resetCreditsCache.key = cacheKey;
            resetCreditsCache.value = value;
            resetCreditsCache.fetchedAtMs = nowMs;
          }
          return value;
        })
        .finally(() => {
          resetCreditsCache.pending = null;
        });
    }
    return resetCreditsCache.pending;
  };

  if (useCache && refreshInBackground) {
    refresh().catch(() => null);
    return resetCreditsCache.value;
  }

  return refresh();
}

export async function loadCodexCliProvider({
  runCommand = execFileAsync,
  threadCount = 0,
} = {}) {
  const version = await commandVersion('codex', ['--version'], runCommand).catch(() => '');

  return {
    id: 'codex-cli',
    label: 'Codex CLI',
    installed: Boolean(version),
    cliInstalled: Boolean(version),
    status: version ? 'ready' : 'missing',
    message: version
      ? `已检测到 ${version}${threadCount ? `，读取 ${threadCount} 个 CLI 任务` : '；任务由 Codex 本地库统一读取'}`
      : '未检测到 codex CLI',
    threadCount,
  };
}

export function parseSessionIndex(jsonlText = '') {
  const titleByThreadId = new Map();

  for (const line of String(jsonlText).split('\n')) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line);
      if (record?.id && typeof record.thread_name === 'string' && record.thread_name.trim()) {
        titleByThreadId.set(String(record.id), record.thread_name.trim());
      }
    } catch {
      // Ignore partial/corrupt lines; the sqlite title remains a fallback.
    }
  }

  return titleByThreadId;
}

async function readSessionIndex(sessionIndexPath = DEFAULT_SESSION_INDEX) {
  try {
    return parseSessionIndex(await fs.readFile(sessionIndexPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
}

export function applySessionIndexTitles(rows, titleByThreadId) {
  return rows.map((row) => ({
    ...row,
    thread_name: titleByThreadId.get(String(row.id || '')) || row.thread_name,
    in_codex_sidebar: titleByThreadId.has(String(row.id || '')),
  }));
}

export function parseCodexPinnedThreadIds(globalState = {}) {
  const rawIds = Array.isArray(globalState?.[CODEX_PINNED_THREAD_IDS_KEY])
    ? globalState[CODEX_PINNED_THREAD_IDS_KEY]
    : [];
  const seen = new Set();
  const threadIds = [];

  for (const rawId of rawIds) {
    if (typeof rawId !== 'string') continue;
    const threadId = rawId.trim();
    if (!threadId || seen.has(threadId)) continue;
    seen.add(threadId);
    threadIds.push(threadId);
  }

  return threadIds;
}

async function readCodexGlobalState(globalStatePath = DEFAULT_GLOBAL_STATE) {
  try {
    return JSON.parse(await fs.readFile(globalStatePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export async function readCodexPinnedThreadIds(globalStatePath = DEFAULT_GLOBAL_STATE) {
  return parseCodexPinnedThreadIds(await readCodexGlobalState(globalStatePath));
}

export function applyCodexPinnedThreadIds(rows, pinnedThreadIds = []) {
  const pinned = new Set(pinnedThreadIds.map(String));
  return rows.map((row) => ({
    ...row,
    pinned: pinned.has(String(row.id || '')),
  }));
}

function readThreadsSql(cappedLimit, { includeGoals = true } = {}) {
  const goalColumns = includeGoals ? `
      tg.goal_id as goal_id,
      tg.status as goal_status,
      tg.token_budget as goal_token_budget,
      tg.tokens_used as goal_tokens_used,
      tg.time_used_seconds as goal_time_used_seconds,
      tg.created_at_ms as goal_created_at_ms,
      tg.updated_at_ms as goal_updated_at_ms` : `
      null as goal_id,
      null as goal_status,
      null as goal_token_budget,
      null as goal_tokens_used,
      null as goal_time_used_seconds,
      null as goal_created_at_ms,
      null as goal_updated_at_ms`;
  const goalJoin = includeGoals ? 'left join thread_goals tg on tg.thread_id = threads.id' : '';

  return `
    select
      threads.id as id,
      threads.rollout_path as rollout_path,
      threads.created_at as created_at,
      threads.updated_at as updated_at,
      threads.created_at_ms as created_at_ms,
      threads.updated_at_ms as updated_at_ms,
      threads.source as source,
      threads.model_provider as model_provider,
      threads.cwd as cwd,
      threads.title as title,
      threads.sandbox_policy as sandbox_policy,
      threads.approval_mode as approval_mode,
      threads.tokens_used as tokens_used,
      threads.archived as archived,
      threads.git_sha as git_sha,
      threads.git_branch as git_branch,
      threads.git_origin_url as git_origin_url,
      threads.cli_version as cli_version,
      threads.first_user_message as first_user_message,
      threads.agent_nickname as agent_nickname,
      threads.agent_role as agent_role,
      threads.memory_mode as memory_mode,
      threads.model as model,
      threads.reasoning_effort as reasoning_effort,
      ${goalColumns}
    from threads
    ${goalJoin}
    order by threads.updated_at_ms desc, threads.updated_at desc
    limit ${cappedLimit};
  `;
}

function isMissingThreadGoalsTable(error) {
  const text = `${error?.stderr || ''}\n${error?.message || ''}`;
  return text.includes('no such table: thread_goals');
}

export async function readThreads({ databasePath = DEFAULT_STATE_DB, limit = DEFAULT_THREAD_LIMIT } = {}) {
  const cappedLimit = safeLimit(limit);
  const sql = readThreadsSql(cappedLimit, { includeGoals: true });

  try {
    return await querySqliteJson(databasePath, sql);
  } catch (error) {
    if (isMissingThreadGoalsTable(error)) {
      return querySqliteJson(databasePath, readThreadsSql(cappedLimit, { includeGoals: false }));
    }
    throw error;
  }
}

function rolloutThreadId(filePath = '') {
  const match = path.basename(filePath).match(ROLLOUT_FILE_RE);
  return match?.[1] || '';
}

async function collectRecentRolloutFiles(sessionsDir, limit = DEFAULT_ORPHAN_ROLLOUT_LIMIT) {
  if (Number(limit) <= 0) return [];
  const safeFileLimit = safeLimit(limit);
  if (!sessionsDir || safeFileLimit <= 0) return [];

  const files = [];
  const stack = [sessionsDir];

  while (stack.length) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
      throw error;
    }

    for (const entry of entries) {
      const filePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(filePath);
        continue;
      }
      if (!entry.isFile() || !ROLLOUT_FILE_RE.test(entry.name)) continue;

      try {
        const fileStat = await fs.stat(filePath);
        files.push({ filePath, stat: fileStat, mtimeMs: Number(fileStat.mtimeMs || 0) });
      } catch {
        // The rollout can disappear while Codex rotates files; skip it this pass.
      }
    }
  }

  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath))
    .slice(0, safeFileLimit);
}

async function readFileStart(filePath, maxBytes = 128 * 1024, fileStat = null) {
  const stat = fileStat || await fs.stat(filePath);
  const length = Math.min(Math.max(0, Number(stat.size || 0)), maxBytes);
  if (!length) return '';

  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function parseRolloutSessionMetadata(jsonlText = '') {
  const metadata = {
    id: '',
    cwd: '',
    source: '',
    modelProvider: '',
    model: '',
    cliVersion: '',
    gitSha: '',
    gitBranch: '',
    gitOriginUrl: '',
    createdAtMs: 0,
    latestEventAtMs: 0,
  };

  for (const line of String(jsonlText).split('\n')) {
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const timestampMs = eventTimestampMs(event);
    if (timestampMs) {
      metadata.createdAtMs ||= timestampMs;
      metadata.latestEventAtMs = Math.max(metadata.latestEventAtMs, timestampMs);
    }

    if (event?.type === 'session_meta') {
      const session = event.payload && typeof event.payload === 'object' ? event.payload : event;
      metadata.id ||= String(session.id || '');
      metadata.cwd ||= session.cwd || '';
      metadata.source ||= session.source || session.thread_source || '';
      metadata.modelProvider ||= session.model_provider || '';
      metadata.model ||= typeof session.model === 'string' ? session.model : '';
      metadata.cliVersion ||= session.cli_version || '';
      metadata.gitSha ||= session.git?.sha || session.git_sha || '';
      metadata.gitBranch ||= session.git?.branch || session.git_branch || '';
      metadata.gitOriginUrl ||= session.git?.origin_url || session.git_origin_url || '';
      continue;
    }

    if (event?.type === 'turn_context') {
      metadata.cwd ||= event.cwd || '';
      metadata.model ||= typeof event.model === 'string' ? event.model : '';
    }
  }

  return metadata;
}

async function readRolloutOnlyThreadRows({
  sessionsDir = DEFAULT_SESSIONS_DIR,
  existingThreadIds = new Set(),
  existingRolloutPaths = new Set(),
  limit = DEFAULT_ORPHAN_ROLLOUT_LIMIT,
} = {}) {
  const candidates = await collectRecentRolloutFiles(sessionsDir, limit);
  const rows = [];

  for (const candidate of candidates) {
    const fileId = rolloutThreadId(candidate.filePath);
    if (!fileId) continue;
    if (existingThreadIds.has(fileId) || existingRolloutPaths.has(candidate.filePath)) continue;

    const header = await readFileStart(candidate.filePath, 128 * 1024, candidate.stat).catch(() => '');
    const metadata = parseRolloutSessionMetadata(header);
    const id = metadata.id || fileId;
    if (!id || existingThreadIds.has(id)) continue;

    const createdAtMs = metadata.createdAtMs
      || Number(candidate.stat.birthtimeMs || 0)
      || Number(candidate.stat.mtimeMs || 0);
    const updatedAtMs = Math.max(
      metadata.latestEventAtMs || 0,
      Number(candidate.stat.mtimeMs || 0),
      createdAtMs,
    );

    rows.push({
      id,
      rollout_path: candidate.filePath,
      created_at: Math.floor(createdAtMs / 1000),
      updated_at: Math.floor(updatedAtMs / 1000),
      created_at_ms: createdAtMs,
      updated_at_ms: updatedAtMs,
      source: metadata.source || 'vscode',
      model_provider: metadata.modelProvider || '',
      cwd: metadata.cwd || '',
      title: '',
      sandbox_policy: '',
      approval_mode: '',
      tokens_used: 0,
      archived: 0,
      git_sha: metadata.gitSha || '',
      git_branch: metadata.gitBranch || '',
      git_origin_url: metadata.gitOriginUrl || '',
      cli_version: metadata.cliVersion || '',
      first_user_message: '',
      agent_nickname: '',
      agent_role: '',
      memory_mode: 'enabled',
      model: metadata.model || metadata.modelProvider || '',
      reasoning_effort: '',
    });
    existingThreadIds.add(id);
    existingRolloutPaths.add(candidate.filePath);
  }

  return rows;
}

function threadRowUpdatedAtMs(row = {}) {
  const updatedAtMs = Number(row.updated_at_ms);
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs;

  const updatedAt = Number(row.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 0;
  return updatedAt > 10_000_000_000 ? updatedAt : updatedAt * 1000;
}

function payloadText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((item) => (typeof item === 'string' ? item : item?.text || ''))
      .join('\n');
  }
  return '';
}

function cleanArtifactTarget(value = '') {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/^["'(<]+|[>"')\],.;!?，。；！）】》]+$/g, '');
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the source text if it is not URL encoded.
  }
  return text.trim();
}

function localArtifactPath(value = '') {
  const cleaned = cleanArtifactTarget(value);
  if (cleaned.startsWith('//')) return '';

  const text = cleaned
    .replace(/^file:\/+/, '/')
    .replace(/\\/g, '/')
    .split(/[?#]/)[0];
  return /^(?:~\/|\/|[A-Za-z]:\/)/.test(text) ? text : '';
}

function artifactExtension(value = '') {
  const cleanValue = cleanArtifactTarget(value).split(/[?#]/)[0];
  const match = cleanValue.match(/\.([A-Za-z0-9]{1,12})$/);
  return match ? match[1].toLowerCase() : '';
}

function artifactFileName(value = '') {
  const cleanValue = cleanArtifactTarget(value)
    .replace(/^file:\/+/, '/')
    .replace(/\\/g, '/')
    .split(/[?#]/)[0];
  const fileName = path.posix.basename(cleanValue);
  return artifactExtension(fileName) ? fileName : '';
}

function artifactTitleForUrl(url = '') {
  try {
    const parsed = new URL(url);
    const fileName = artifactFileName(parsed.pathname);
    return fileName || parsed.hostname || url;
  } catch {
    return url;
  }
}

function artifactTypeForTarget({ path: artifactPath = '', url = '', title = '' } = {}) {
  const extension = artifactExtension(title || artifactPath || url);
  const isImage = IMAGE_ARTIFACT_EXTENSIONS.has(extension);
  if (url) return isImage ? 'image' : 'link';
  if (isImage) return 'image';
  if (['html', 'htm'].includes(extension)) return 'html';
  if (['md', 'markdown', 'mdx'].includes(extension)) return 'markdown';
  return 'file';
}

function artifactLabelForType(type = '') {
  if (type === 'image') return '图片';
  if (type === 'html') return 'HTML';
  if (type === 'markdown') return 'Markdown';
  if (type === 'link') return 'URL';
  return '文件';
}

function extractLocalArtifactTargets(text = '') {
  const items = [];
  const add = (name, rawPath) => {
    const artifactPath = localArtifactPath(rawPath || name);
    const title = artifactFileName(name) || artifactFileName(artifactPath);
    if (!artifactPath || !title) return;
    items.push({ path: artifactPath, title });
  };

  const fileHeadingPattern = /##\s+([^:\n#]+?\.[A-Za-z0-9]{1,12})\s*:\s*((?:file:\/\/|~\/|\/|[A-Za-z]:[\\/])[^#\n\r]*?)(?=(?:\s+##\s)|(?:\s+#\s)|\n|$)/g;
  for (const match of text.matchAll(fileHeadingPattern)) {
    add(match[1], match[2]);
  }

  const imagePathPattern = /<image\b[^>]*\bpath=(["'])(.*?)\1[^>]*>/gi;
  for (const match of text.matchAll(imagePathPattern)) {
    add('', match[2]);
  }

  const standalonePathPattern = new RegExp(
    `(?:^|[\\s(["'\`:：])((?:file:\\/\\/|~\\/|\\/|[A-Za-z]:[\\\\/])[^"'\`<>\\n\\r]*?\\.(?:${LOCAL_ARTIFACT_EXTENSION_RE}))(?=$|[\\s)"'\`<>，。；,;!?])`,
    'gi',
  );
  for (const match of text.matchAll(standalonePathPattern)) {
    add('', match[1]);
  }

  return items;
}

function extractUrlArtifactTargets(text = '') {
  const items = [];
  const markdownLinkRanges = [];
  const addUrl = (rawUrl) => {
    const url = cleanArtifactTarget(rawUrl);
    if (!url) return;
    items.push({
      url,
      title: artifactTitleForUrl(url),
    });
  };

  const markdownLinkPattern = /\[[^\]\n]*\]\(\s*(https?:\/\/[^\s<>"'`)]+)(?:\s+["'][^"']*["'])?\s*\)/gi;
  for (const match of text.matchAll(markdownLinkPattern)) {
    addUrl(match[1]);
    markdownLinkRanges.push([match.index, match.index + match[0].length]);
  }

  const isInMarkdownLink = (index) => markdownLinkRanges.some(([start, end]) => index >= start && index < end);
  const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  for (const match of text.matchAll(urlPattern)) {
    if (isInMarkdownLink(match.index)) continue;
    addUrl(match[0]);
  }
  return items;
}

function createArtifactRecord({ target, source, turn, atMs, sequence }) {
  const type = artifactTypeForTarget(target);
  const title = target.title || artifactFileName(target.path) || artifactTitleForUrl(target.url) || artifactLabelForType(type);
  return {
    id: `artifact-${sequence + 1}`,
    type,
    typeLabel: artifactLabelForType(type),
    title,
    source,
    turn,
    atMs: atMs || null,
    path: target.path || '',
    url: target.url || '',
    extension: artifactExtension(title || target.path || target.url),
    sequence,
  };
}

function compareArtifactsDesc(a, b) {
  return Number(b.atMs || 0) - Number(a.atMs || 0)
    || Number(b.sequence || 0) - Number(a.sequence || 0);
}

function summarizeRolloutArtifacts(items, limit = ARTIFACT_SUMMARY_LIMIT) {
  const sorted = [...items].sort(compareArtifactsDesc);
  const typeCounts = {};
  for (const item of sorted) {
    typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
  }

  return {
    total: sorted.length,
    latestAtMs: sorted[0]?.atMs || null,
    typeCounts,
    items: sorted.slice(0, limit),
  };
}

function groupRolloutArtifactTurns(items) {
  const byTurn = new Map();
  for (const item of items) {
    const turn = Number(item.turn || 0) || 1;
    const group = byTurn.get(turn) || {
      turn,
      atMs: item.atMs || null,
      items: [],
    };
    group.atMs = Math.max(Number(group.atMs || 0), Number(item.atMs || 0)) || group.atMs;
    group.items.push(item);
    byTurn.set(turn, group);
  }

  return [...byTurn.values()]
    .map((turn) => ({
      ...turn,
      items: turn.items.sort(compareArtifactsDesc),
    }))
    .sort((a, b) => Number(b.atMs || 0) - Number(a.atMs || 0) || Number(b.turn || 0) - Number(a.turn || 0));
}

export function parseRolloutArtifacts(jsonlText = '') {
  const items = [];
  const seen = new Set();
  let turn = 0;
  let sequence = 0;

  const addTarget = (target, source, atMs) => {
    const safeTurn = Math.max(1, turn || 1);
    const key = [
      safeTurn,
      source,
      target.path ? `path:${target.path.toLowerCase()}` : '',
      target.url ? `url:${target.url.toLowerCase()}` : '',
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    items.push(createArtifactRecord({
      target,
      source,
      turn: safeTurn,
      atMs,
      sequence,
    }));
    sequence += 1;
  };

  for (const line of String(jsonlText || '').split('\n')) {
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = event.payload || event;
    if (payload?.type === 'user_message') turn += 1;
    if (payload?.type !== 'user_message' && payload?.type !== 'agent_message') continue;

    const text = payloadText(payload);
    if (!text) continue;

    const source = payload.type === 'user_message' ? 'user' : 'agent';
    const timestampMs = eventTimestampMs(event);
    for (const target of extractLocalArtifactTargets(text)) {
      addTarget(target, source, timestampMs);
    }
    for (const target of extractUrlArtifactTargets(text)) {
      addTarget(target, source, timestampMs);
    }
  }

  const sortedItems = items.sort(compareArtifactsDesc);
  return {
    ...summarizeRolloutArtifacts(sortedItems, sortedItems.length),
    items: sortedItems,
    turns: groupRolloutArtifactTurns(sortedItems),
  };
}

function compactInlineText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function textAfterCodexRequestHeading(value = '') {
  const text = String(value || '');
  const match = text.match(/^##\s+My request for Codex:\s*$/im);
  if (!match) return text;
  return text.slice((match.index || 0) + match[0].length);
}

function stripCodexRichMessageScaffold(value = '') {
  return String(value || '')
    .replace(/<image\b[\s\S]*?<\/image>/gi, ' ')
    .replace(/<image\b[^>]*>/gi, ' ')
    .replace(/<\/image>/gi, ' ')
    .replace(/^#\s+Files mentioned by the user:\s*$/gim, ' ')
    .replace(/^##\s+[^:\n#]+?\.[A-Za-z0-9]{1,12}\s*:\s*(?:file:\/\/|~\/|\/|[A-Za-z]:[\\/]).*$/gim, ' ')
    .replace(/^##\s+My request for Codex:\s*$/gim, ' ');
}

function externalLinkPlaceholderText(value = '') {
  return String(value || '')
    .replace(/\[[^\]\n]*\]\(\s*https?:\/\/[^\s<>"'`)]+(?:\s+["'][^"']*["'])?\s*\)/gi, ' [外部链接] ')
    .replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, ' [外部链接] ');
}

function extensionPlaceholder(extension = '') {
  const normalized = String(extension || '').toLowerCase();
  if (IMAGE_ARTIFACT_EXTENSIONS.has(normalized)) return '[图片]';
  if (VIDEO_ARTIFACT_EXTENSIONS.has(normalized)) return '[视频]';
  if (AUDIO_ARTIFACT_EXTENSIONS.has(normalized)) return '[音频]';
  return normalized ? '[文件]' : '';
}

function richAttachmentPlaceholders(value = '') {
  const raw = String(value || '');
  const placeholders = new Set();

  if (/<image\b/i.test(raw)) placeholders.add('[图片]');
  for (const target of extractLocalArtifactTargets(raw)) {
    const extension = artifactExtension(target.title || target.path);
    const placeholder = extensionPlaceholder(extension);
    if (placeholder) placeholders.add(placeholder);
  }

  return [...placeholders];
}

function isImageOnlyTitle(value = '') {
  const text = compactInlineText(value);
  if (!text) return false;
  return new RegExp(`^[^\\s]+\\.(?:${[...IMAGE_ARTIFACT_EXTENSIONS].join('|')})(?:\\s*[·-]\\s*(?:图片|image))?$`, 'iu').test(text);
}

function codexDisplayText(value = '') {
  const raw = String(value || '');
  if (!raw.trim()) return '';

  const attachmentPlaceholders = richAttachmentPlaceholders(raw);
  const body = compactInlineText(externalLinkPlaceholderText(
    stripCodexRichMessageScaffold(textAfterCodexRequestHeading(raw)),
  ));
  const leadingPlaceholders = attachmentPlaceholders.filter((placeholder) => !body.includes(placeholder));
  const displayText = compactInlineText([...leadingPlaceholders, body].filter(Boolean).join(' '));

  if (displayText) return displayText;
  if (isImageOnlyTitle(raw)) return '[图片]';
  return compactInlineText(externalLinkPlaceholderText(stripCodexRichMessageScaffold(raw)));
}

function leadingMediaPlaceholders(value = '') {
  const placeholders = [];
  let text = compactInlineText(value);

  while (text) {
    const placeholder = MEDIA_PLACEHOLDERS.find((candidate) => text.startsWith(candidate));
    if (!placeholder) break;
    placeholders.push(placeholder);
    text = compactInlineText(text.slice(placeholder.length));
  }

  return placeholders;
}

function titleWithSignalPlaceholders(title = '', signals = {}) {
  const context = codexDisplayText(signals.latestMeaningfulUserMessage)
    || codexDisplayText(signals.latestUserMessage)
    || codexDisplayText(signals.firstUserMessage);
  const missingPlaceholders = leadingMediaPlaceholders(context)
    .filter((placeholder) => !title.includes(placeholder));
  return compactInlineText([...missingPlaceholders, title].filter(Boolean).join(' '));
}

function truncateText(value = '', maxLength = DISPLAY_TITLE_LENGTH) {
  const text = compactInlineText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isMeaningfulUserMessage(value = '') {
  const text = compactInlineText(value);
  if (text.length < 8) return false;
  return !LOW_SIGNAL_USER_MESSAGE.test(text);
}

function isPlaceholderStoredTitle(value = '') {
  const text = compactInlineText(value);
  return !text || text === '未命名任务' || isImageOnlyTitle(text);
}

export function deriveCodexThreadTitle(storedTitle, signals = {}) {
  const title = codexDisplayText(storedTitle);
  if (!isPlaceholderStoredTitle(storedTitle)) {
    return truncateText(titleWithSignalPlaceholders(title, signals));
  }

  const rolloutTitle = codexDisplayText(signals.latestMeaningfulUserMessage)
    || codexDisplayText(signals.latestUserMessage)
    || codexDisplayText(signals.firstUserMessage);
  return truncateText(rolloutTitle || title || '未命名任务');
}

function eventTimestampMs(event) {
  const timestamp = Date.parse(event?.timestamp || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRateLimitWindow(window) {
  if (!window || typeof window !== 'object') return null;

  const usedPercent = finiteNumberOrNull(
    window.used_percent
    ?? window.usedPercent
    ?? window.used_percentage,
  );
  if (usedPercent === null) return null;

  return {
    ...window,
    used_percent: usedPercent,
  };
}

function normalizeRateLimits(rateLimits) {
  if (!rateLimits || typeof rateLimits !== 'object') return null;

  const primary = normalizeRateLimitWindow(rateLimits.primary);
  const secondary = normalizeRateLimitWindow(rateLimits.secondary);
  if (!primary && !secondary) return null;

  const normalized = { ...rateLimits };
  if (primary) {
    normalized.primary = primary;
  } else {
    delete normalized.primary;
  }

  if (secondary) {
    normalized.secondary = secondary;
  } else {
    delete normalized.secondary;
  }

  return normalized;
}

function rememberBounded(cache, key, value, limit, metrics = null, writeKey = '', evictionKey = '') {
  if (!cache || limit <= 0) return;
  if (metrics && writeKey) metrics[writeKey] = coerceMetric(metrics[writeKey]) + 1;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
    if (metrics && evictionKey) metrics[evictionKey] = coerceMetric(metrics[evictionKey]) + 1;
  }
}

function statSignature(stat) {
  return {
    size: Number(stat?.size || 0),
    mtimeMs: Number(stat?.mtimeMs || 0),
  };
}

function coerceMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getCodexCacheStats() {
  return {
    rolloutSignals: {
      entries: rolloutSignalCache.size,
      limit: DEFAULT_ROLLOUT_SIGNAL_CACHE_LIMIT,
      hits: codexCacheMetrics.rolloutSignalHits,
      misses: codexCacheMetrics.rolloutSignalMisses,
      writes: codexCacheMetrics.rolloutSignalWrites,
      evictions: codexCacheMetrics.rolloutSignalEvictions,
    },
  };
}

export function parseRolloutSignals(jsonlText, { todayStartMs = 0 } = {}) {
  const todayStart = Number(todayStartMs || 0);
  const seenTodayTokenEvents = new Set();
  const signals = {
    totalTokenUsage: null,
    lastTokenUsage: null,
    totalTokenBreakdown: emptyTokenBreakdown(),
    lastTokenBreakdown: emptyTokenBreakdown(),
    todayTokenBreakdown: emptyTokenBreakdown(),
    modelContextWindow: null,
    rateLimits: null,
    latestRateLimitAtMs: null,
    latestRateLimitSignalAtMs: null,
    rateLimitStale: false,
    rateLimitStaleAtMs: null,
    todayTokenUsage: 0,
    completionHint: false,
    latestAgentFinalAtMs: null,
    latestUserMessageAtMs: null,
    latestMessageKind: '',
    firstUserMessage: '',
    latestUserMessage: '',
    latestMeaningfulUserMessage: '',
    lastAgentMessage: '',
    artifacts: {
      total: 0,
      latestAtMs: null,
      typeCounts: {},
      items: [],
    },
    oldestEventAtMs: null,
    latestEventAtMs: null,
  };

  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = event.payload || event;
    const timestampMs = eventTimestampMs(event);
    if (timestampMs) {
      signals.oldestEventAtMs = signals.oldestEventAtMs
        ? Math.min(signals.oldestEventAtMs, timestampMs)
        : timestampMs;
      signals.latestEventAtMs = Math.max(signals.latestEventAtMs || 0, timestampMs);
    }

    if (payload?.type === 'token_count') {
      signals.totalTokenUsage = payload.info?.total_token_usage || null;
      signals.lastTokenUsage = payload.info?.last_token_usage || null;
      signals.totalTokenBreakdown = normalizeTokenBreakdown(signals.totalTokenUsage);
      signals.lastTokenBreakdown = normalizeTokenBreakdown(signals.lastTokenUsage);
      signals.modelContextWindow = payload.info?.model_context_window || null;

      if (Object.prototype.hasOwnProperty.call(payload, 'rate_limits')) {
        const signalAtMs = timestampMs || signals.latestRateLimitSignalAtMs;
        signals.latestRateLimitSignalAtMs = signalAtMs;

        const rateLimits = normalizeRateLimits(payload.rate_limits);
        if (rateLimits) {
          signals.rateLimits = rateLimits;
          signals.latestRateLimitAtMs = timestampMs || signals.latestRateLimitAtMs;
          signals.rateLimitStale = false;
          signals.rateLimitStaleAtMs = null;
        } else {
          signals.rateLimitStale = true;
          signals.rateLimitStaleAtMs = signalAtMs || signals.rateLimitStaleAtMs;
        }
      }

      const todayTokens = Number(payload.info?.last_token_usage?.total_tokens || 0);
      const totalTokens = Number(payload.info?.total_token_usage?.total_tokens || 0);
      if (todayStart && timestampMs >= todayStart && todayTokens > 0) {
        const eventKey = `${totalTokens}:${todayTokens}`;
        if (!seenTodayTokenEvents.has(eventKey)) {
          seenTodayTokenEvents.add(eventKey);
          signals.todayTokenUsage += todayTokens;
          signals.todayTokenBreakdown = addTokenBreakdowns(
            signals.todayTokenBreakdown,
            signals.lastTokenBreakdown,
          );
        }
      }
      continue;
    }

    if (payload?.type === 'agent_message') {
      const text = payloadText(payload);
      if (text) signals.lastAgentMessage = text.slice(0, 500);
      if (payload.phase === 'final_answer' || COMPLETION_HINT.test(text)) {
        signals.completionHint = true;
      }
      if (payload.phase === 'final_answer') {
        signals.latestAgentFinalAtMs = timestampMs || signals.latestAgentFinalAtMs;
        signals.latestMessageKind = 'agent';
      } else if (text) {
        signals.latestMessageKind = 'agent';
      }
      continue;
    }

    if (payload?.type === 'user_message') {
      const text = payloadText(payload);
      if (text) {
        const compactText = truncateText(codexDisplayText(text), 500);
        signals.firstUserMessage ||= compactText;
        signals.latestUserMessage = compactText;
        if (isMeaningfulUserMessage(text)) {
          signals.latestMeaningfulUserMessage = compactText;
        }
      }
      signals.latestUserMessageAtMs = timestampMs || signals.latestUserMessageAtMs;
      signals.latestMessageKind = 'user';
    }
  }

  signals.artifacts = summarizeRolloutArtifacts(parseRolloutArtifacts(jsonlText).items);
  return signals;
}

async function readTail(filePath, maxBytes = DEFAULT_MAX_ROLLOUT_BYTES, fileStat = null) {
  const stat = fileStat || await fs.stat(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return { text, start, size: stat.size };

    const firstNewline = text.indexOf('\n');
    return {
      text: firstNewline >= 0 ? text.slice(firstNewline + 1) : text,
      start,
      size: stat.size,
    };
  } finally {
    await handle.close();
  }
}

function hasTurnBoundary(signals) {
  return Boolean(signals.latestUserMessageAtMs || signals.latestAgentFinalAtMs);
}

function coversToday(signals, tail, todayStartMs) {
  if (!todayStartMs) return true;
  if (tail.start === 0) return true;
  return Boolean(signals.oldestEventAtMs && signals.oldestEventAtMs <= todayStartMs);
}

function needsMoreRateLimitHistory(signals, bytesToRead, fileSize, maxBytes) {
  return Boolean(
    signals.rateLimitStale
    && !signals.rateLimits
    && bytesToRead < fileSize
    && bytesToRead < maxBytes,
  );
}

export async function readRolloutSignals(
  rolloutPath,
  {
    initialBytes = DEFAULT_INITIAL_ROLLOUT_BYTES,
    maxBytes = DEFAULT_MAX_ROLLOUT_BYTES,
    todayStartMs = 0,
    signalCache = rolloutSignalCache,
    signalCacheLimit = DEFAULT_ROLLOUT_SIGNAL_CACHE_LIMIT,
  } = {},
) {
  if (!rolloutPath) return parseRolloutSignals('');

  try {
    const stat = await fs.stat(rolloutPath);
    const { size, mtimeMs } = statSignature(stat);
    const cacheKey = `${rolloutPath}\0${todayStartMs}\0${initialBytes}\0${maxBytes}`;
    const cached = signalCache?.get(cacheKey);
    if (
      cached
      && cached.size === size
      && cached.mtimeMs === mtimeMs
    ) {
      codexCacheMetrics.rolloutSignalHits += 1;
      return cached.signals;
    }
    codexCacheMetrics.rolloutSignalMisses += 1;

    let bytesToRead = Math.min(Math.max(1, initialBytes), stat.size);
    let signals = parseRolloutSignals('');

    while (bytesToRead > 0) {
      const tail = await readTail(rolloutPath, bytesToRead, stat);
      signals = parseRolloutSignals(tail.text, { todayStartMs });
      const needsQuotaHistory = needsMoreRateLimitHistory(signals, bytesToRead, stat.size, maxBytes);
      if (
        (hasTurnBoundary(signals) && coversToday(signals, tail, todayStartMs) && !needsQuotaHistory)
        || bytesToRead >= stat.size
        || bytesToRead >= maxBytes
      ) {
        rememberBounded(
          signalCache,
          cacheKey,
          { size, mtimeMs, signals },
          signalCacheLimit,
          codexCacheMetrics,
          'rolloutSignalWrites',
          'rolloutSignalEvictions',
        );
        return signals;
      }

      const nextBytes = Math.min(bytesToRead * 2, maxBytes, stat.size);
      if (nextBytes === bytesToRead) {
        rememberBounded(
          signalCache,
          cacheKey,
          { size, mtimeMs, signals },
          signalCacheLimit,
          codexCacheMetrics,
          'rolloutSignalWrites',
          'rolloutSignalEvictions',
        );
        return signals;
      }
      bytesToRead = nextBytes;
    }

    rememberBounded(
      signalCache,
      cacheKey,
      { size, mtimeMs, signals },
      signalCacheLimit,
      codexCacheMetrics,
      'rolloutSignalWrites',
      'rolloutSignalEvictions',
    );
    return signals;
  } catch {
    return parseRolloutSignals('');
  }
}

async function attachRolloutSignals(threads, {
  maxRollouts = 48,
  initialRolloutBytes = DEFAULT_INITIAL_ROLLOUT_BYTES,
  maxRolloutBytes = DEFAULT_MAX_ROLLOUT_BYTES,
  todayStartMs = 0,
} = {}) {
  const enriched = threads.map((thread) => ({ ...thread }));
  const candidates = enriched
    .filter((thread) => thread.rolloutPath)
    .slice(0, maxRollouts);

  const results = await Promise.allSettled(
    candidates.map((thread) => readRolloutSignals(thread.rolloutPath, {
      initialBytes: initialRolloutBytes,
      maxBytes: maxRolloutBytes,
      todayStartMs,
    })),
  );

  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;

    const thread = candidates[index];
    thread.totalTokenUsage = result.value.totalTokenUsage;
    thread.lastTokenUsage = result.value.lastTokenUsage;
    thread.tokenBreakdown = result.value.totalTokenBreakdown;
    thread.lastTokenBreakdown = result.value.lastTokenBreakdown;
    thread.todayTokenBreakdown = result.value.todayTokenBreakdown;
    thread.modelContextWindow = result.value.modelContextWindow;
    thread.rateLimits = result.value.rateLimits;
    thread.rateLimitUpdatedAtMs = result.value.latestRateLimitAtMs;
    thread.rateLimitActivityAtMs = result.value.latestRateLimitAtMs;
    thread.latestRateLimitSignalAtMs = result.value.latestRateLimitSignalAtMs;
    thread.rateLimitStale = result.value.rateLimitStale;
    thread.rateLimitStaleAtMs = result.value.rateLimitStaleAtMs;
    thread.todayTokenUsage = result.value.todayTokenUsage;
    thread.completionHint = result.value.completionHint;
    thread.latestAgentFinalAtMs = result.value.latestAgentFinalAtMs;
    thread.latestUserMessageAtMs = result.value.latestUserMessageAtMs;
    thread.latestMessageKind = result.value.latestMessageKind;
    thread.firstUserMessage = result.value.firstUserMessage;
    thread.latestUserMessage = result.value.latestUserMessage;
    thread.latestMeaningfulUserMessage = result.value.latestMeaningfulUserMessage;
    thread.lastAgentMessage = result.value.lastAgentMessage;
    thread.artifacts = result.value.artifacts;
    thread.title = deriveCodexThreadTitle(thread.title, result.value);
  });

  return enriched;
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isCodexProviderThread(thread = {}) {
  const provider = String(thread.provider || thread.source || '').toLowerCase();
  return provider === 'codex' || provider === 'codex-cli' || provider === '';
}

export async function getCodexThreadArtifacts({ thread } = {}) {
  if (!thread) throw httpError('Thread not found', 404);
  if (!isCodexProviderThread(thread)) {
    throw httpError('Artifacts are currently available for Codex threads only', 422);
  }
  if (!thread.rolloutPath) {
    throw httpError('Codex artifacts require a rollout path', 422);
  }

  try {
    const text = await fs.readFile(thread.rolloutPath, 'utf8');
    return {
      threadId: thread.id || '',
      artifacts: parseRolloutArtifacts(text),
    };
  } catch (error) {
    throw httpError(`Unable to read Codex rollout artifacts: ${error.message}`, 422);
  }
}

export async function loadCodexDashboard(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const rows = await readThreads(options);
  const rolloutOnlyRows = await readRolloutOnlyThreadRows({
    sessionsDir: options.sessionsDir || DEFAULT_SESSIONS_DIR,
    existingThreadIds: new Set(rows.map((row) => String(row.id || '')).filter(Boolean)),
    existingRolloutPaths: new Set(rows.map((row) => String(row.rollout_path || '')).filter(Boolean)),
    limit: options.maxOrphanRollouts ?? DEFAULT_ORPHAN_ROLLOUT_LIMIT,
  });
  const sessionIndex = await readSessionIndex(options.sessionIndexPath || DEFAULT_SESSION_INDEX);
  const pinnedThreadIds = await readCodexPinnedThreadIds(options.globalStatePath || DEFAULT_GLOBAL_STATE);
  const indexedRows = applySessionIndexTitles([...rows, ...rolloutOnlyRows]
    .sort((a, b) => threadRowUpdatedAtMs(b) - threadRowUpdatedAtMs(a)), sessionIndex);
  const pinnedRows = applyCodexPinnedThreadIds(indexedRows, pinnedThreadIds);
  const threads = enrichThreads(pinnedRows, nowMs);
  const shouldReadCodexResetCredits = options.codexResetCreditsEnabled === false
    ? false
    : codexResetCreditsEnabled(options.codexResetCreditsEnabled);
  const [enrichedThreads, codexResetCredits] = await Promise.all([
    attachRolloutSignals(threads, {
      ...options,
      todayStartMs: options.todayStartMs || todayStart.getTime(),
    }),
    options.codexResetCredits === undefined
      ? (shouldReadCodexResetCredits ? readCodexResetCredits({
        ...options,
        nowMs,
        useCache: true,
        refreshInBackground: true,
      }) : Promise.resolve(null))
      : Promise.resolve(options.codexResetCredits),
  ]);
  return buildDashboard(enrichedThreads, nowMs, { codexResetCredits });
}
