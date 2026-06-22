import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addTokenBreakdowns,
  tokenBreakdownWithFallbackTotal,
} from './token-usage.mjs';

const DEFAULT_INDEX_PATH = path.join(os.homedir(), '.agent-mission-control', 'search-index.sqlite');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SEARCH_INDEX_VERSION = 2;

function coerceNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function folded(value = '') {
  return compactText(value).toLocaleLowerCase();
}

function sqlString(value = '') {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function sqlNumber(value = 0) {
  return String(Math.trunc(coerceNumber(value)));
}

function sqlBoolean(value) {
  return value ? '1' : '0';
}

function artifactSummaryJson(thread = {}) {
  if (!thread?.artifacts || Number(thread.artifacts.total || 0) <= 0) return '';

  try {
    return JSON.stringify(thread.artifacts);
  } catch {
    return '';
  }
}

function tokenBreakdownJson(breakdown, total) {
  const normalized = tokenBreakdownWithFallbackTotal(breakdown, total);
  if (normalized.total <= 0) return '';
  try {
    return JSON.stringify(normalized);
  } catch {
    return '';
  }
}

function parseTokenBreakdown(value = '', total = 0) {
  if (!value) return tokenBreakdownWithFallbackTotal(null, total);

  try {
    return tokenBreakdownWithFallbackTotal(JSON.parse(value), total);
  } catch {
    return tokenBreakdownWithFallbackTotal(null, total);
  }
}

function parseArtifactSummary(value = '') {
  if (!value) return { total: 0, latestAtMs: null, typeCounts: {}, items: [] };

  try {
    const parsed = JSON.parse(value);
    return {
      total: coerceNumber(parsed?.total),
      latestAtMs: parsed?.latestAtMs ?? null,
      typeCounts: parsed?.typeCounts && typeof parsed.typeCounts === 'object' ? parsed.typeCounts : {},
      items: Array.isArray(parsed?.items) ? parsed.items : [],
    };
  } catch {
    return { total: 0, latestAtMs: null, typeCounts: {}, items: [] };
  }
}

function artifactSearchText(thread = {}) {
  return compactText((Array.isArray(thread?.artifacts?.items) ? thread.artifacts.items : [])
    .map((item) => [
      item?.title,
      item?.type,
      item?.url,
    ].filter(Boolean).join(' '))
    .join(' '));
}

function safeLimit(value, fallback = DEFAULT_LIMIT) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, 1), MAX_LIMIT);
}

function queryTokens(query = '') {
  return folded(query)
    .split(/[^\p{Letter}\p{Number}_-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function ftsToken(token) {
  const safe = String(token || '').replaceAll('"', '""');
  if (!safe) return '';
  return `"${safe}"${/^[a-z0-9_-]+$/i.test(safe) && safe.length >= 3 ? '*' : ''}`;
}

function ftsQuery(query = '') {
  return queryTokens(query)
    .filter((token) => token.length >= 3 || /[a-z0-9]/i.test(token))
    .map(ftsToken)
    .filter(Boolean)
    .join(' AND ');
}

function runSql(databasePath, sql, { json = false, runCommand = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const args = json ? ['-json', databasePath] : [databasePath];
    const child = runCommand('sqlite3', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const error = new Error(stderr.trim() || `sqlite3 exited with code ${code}`);
      error.exitCode = code;
      error.stderr = stderr;
      reject(error);
    });
    child.stdin.end(`${sql.trim()}\n`);
  });
}

async function querySql(databasePath, sql, options = {}) {
  const stdout = await runSql(databasePath, sql, { ...options, json: true });
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

async function ensureThreadColumn(databasePath, columnName, definition, runCommand) {
  const columns = await querySql(databasePath, 'PRAGMA table_info(threads);', { runCommand });
  if (columns.some((column) => column.name === columnName)) return;
  await runSql(databasePath, `ALTER TABLE threads ADD COLUMN ${definition};`, { runCommand });
}

function schemaSql() {
  return `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      providerLabel TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      projectName TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      isSubagent INTEGER NOT NULL DEFAULT 0,
      isAutomation INTEGER NOT NULL DEFAULT 0,
      updatedAtMs INTEGER NOT NULL DEFAULT 0,
      createdAtMs INTEGER NOT NULL DEFAULT 0,
      tokensUsed INTEGER NOT NULL DEFAULT 0,
      todayTokenUsage INTEGER NOT NULL DEFAULT 0,
      tokenBreakdownJson TEXT NOT NULL DEFAULT '',
      todayTokenBreakdownJson TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      appDeepLink TEXT NOT NULL DEFAULT '',
      resumeCommand TEXT NOT NULL DEFAULT '',
      defaultOpenMode TEXT NOT NULL DEFAULT '',
      inCodexSidebar INTEGER NOT NULL DEFAULT 1,
      rolloutPath TEXT NOT NULL DEFAULT '',
      artifactsJson TEXT NOT NULL DEFAULT '',
      firstUserMessage TEXT NOT NULL DEFAULT '',
      latestUserMessage TEXT NOT NULL DEFAULT '',
      latestMeaningfulUserMessage TEXT NOT NULL DEFAULT '',
      lastAgentMessage TEXT NOT NULL DEFAULT '',
      relationText TEXT NOT NULL DEFAULT '',
      searchText TEXT NOT NULL DEFAULT ''
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS thread_search_fts USING fts5(
      title,
      projectName,
      cwd,
      providerLabel,
      model,
      signals,
      relationText,
      tokenize = 'unicode61'
    );
  `;
}

function threadSearchText(thread = {}) {
  return folded([
    thread.id,
    thread.externalId,
    thread.title,
    thread.projectName,
    thread.cwd,
    thread.provider,
    thread.providerLabel,
    thread.model,
    thread.status,
    thread.firstUserMessage,
    thread.latestUserMessage,
    thread.latestMeaningfulUserMessage,
    thread.lastAgentMessage,
    thread.parentThreadTitle,
    thread.parentThreadProjectName,
    thread.agentNickname,
    thread.agentRole,
    artifactSearchText(thread),
  ].filter(Boolean).join(' '));
}

function relationText(thread = {}) {
  return compactText([
    thread.parentThreadTitle ? `Host ${thread.parentThreadTitle}` : '',
    thread.parentThreadProjectName,
    thread.agentNickname,
    thread.agentRole,
    thread.isSubagent ? 'Sub Agent' : '',
    thread.isAutomation ? 'Automation' : '',
  ].filter(Boolean).join(' '));
}

function threadValuesSql(thread = {}) {
  const relation = relationText(thread);
  const searchText = threadSearchText(thread);
  const signals = compactText([
    thread.latestMeaningfulUserMessage,
    thread.latestUserMessage,
    thread.firstUserMessage,
    thread.lastAgentMessage,
    artifactSearchText(thread),
  ].filter(Boolean).join(' '));

  return `
    INSERT INTO threads (
      id, provider, providerLabel, title, projectName, cwd, status, archived,
      isSubagent, isAutomation, updatedAtMs, createdAtMs, tokensUsed, todayTokenUsage,
      tokenBreakdownJson, todayTokenBreakdownJson, model,
      appDeepLink, resumeCommand, defaultOpenMode, inCodexSidebar, rolloutPath, artifactsJson,
      firstUserMessage, latestUserMessage, latestMeaningfulUserMessage, lastAgentMessage,
      relationText, searchText
    ) VALUES (
      ${sqlString(thread.id || thread.externalId || '')},
      ${sqlString(thread.provider || '')},
      ${sqlString(thread.providerLabel || thread.provider || '')},
      ${sqlString(thread.title || '未命名任务')},
      ${sqlString(thread.projectName || '未知项目')},
      ${sqlString(thread.cwd || '')},
      ${sqlString(thread.status || '')},
      ${sqlBoolean(thread.archived)},
      ${sqlBoolean(thread.isSubagent)},
      ${sqlBoolean(thread.isAutomation)},
      ${sqlNumber(thread.updatedAtMs)},
      ${sqlNumber(thread.createdAtMs)},
      ${sqlNumber(thread.tokensUsed)},
      ${sqlNumber(thread.todayTokenUsage)},
      ${sqlString(tokenBreakdownJson(thread.tokenBreakdown, thread.tokensUsed))},
      ${sqlString(tokenBreakdownJson(thread.todayTokenBreakdown, thread.todayTokenUsage))},
      ${sqlString(thread.model || '')},
      ${sqlString(thread.appDeepLink || '')},
      ${sqlString(thread.resumeCommand || '')},
      ${sqlString(thread.defaultOpenMode || '')},
      ${sqlBoolean(thread.inCodexSidebar ?? true)},
      ${sqlString(thread.rolloutPath || '')},
      ${sqlString(artifactSummaryJson(thread))},
      ${sqlString(thread.firstUserMessage || '')},
      ${sqlString(thread.latestUserMessage || '')},
      ${sqlString(thread.latestMeaningfulUserMessage || '')},
      ${sqlString(thread.lastAgentMessage || '')},
      ${sqlString(relation)},
      ${sqlString(searchText)}
    );
    INSERT INTO thread_search_fts (
      rowid, title, projectName, cwd, providerLabel, model, signals, relationText
    ) VALUES (
      last_insert_rowid(),
      ${sqlString(thread.title || '')},
      ${sqlString(thread.projectName || '')},
      ${sqlString(thread.cwd || '')},
      ${sqlString(thread.providerLabel || thread.provider || '')},
      ${sqlString(thread.model || '')},
      ${sqlString(signals)},
      ${sqlString(relation)}
    );
  `;
}

function compactSnippet(value = '', query = '', maxLength = 132) {
  const text = compactText(value);
  if (!text) return '';

  const needle = folded(query);
  const haystack = folded(text);
  const index = needle ? haystack.indexOf(needle) : -1;
  if (index < 0 || text.length <= maxLength) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3).trimEnd()}...`;
  }

  const start = Math.max(0, index - 36);
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`;
}

function fieldMatch(row = {}, query = '') {
  const checks = [
    ['标题', row.title, 'title'],
    ['项目', row.projectName, 'project'],
    ['路径', row.cwd, 'path'],
    ['来源', `${row.providerLabel} ${row.provider}`, 'provider'],
    ['模型', row.model, 'model'],
    ['最近输入', row.latestMeaningfulUserMessage || row.latestUserMessage, 'recent user'],
    ['首次输入', row.firstUserMessage, 'first user'],
    ['Agent 输出', row.lastAgentMessage, 'agent output'],
    ['ID', row.id, 'id'],
  ];
  const needle = folded(query);

  for (const [label, value, field] of checks) {
    if (needle && folded(value).includes(needle)) {
      return { field, label, snippet: compactSnippet(value, query) };
    }
  }

  const tokens = queryTokens(query);
  for (const [label, value, field] of checks) {
    const haystack = folded(value);
    if (tokens.length && tokens.every((token) => haystack.includes(token))) {
      return { field, label, snippet: compactSnippet(value, tokens[0]) };
    }
  }

  return { field: 'indexed text', label: '索引文本', snippet: compactSnippet(row.title || row.projectName || row.id, query) };
}

function fieldScore(row = {}, query = '') {
  const needle = folded(query);
  if (!needle) return 0;
  const scoreFor = (value, exact, includes, starts = 0) => {
    const haystack = folded(value);
    if (!haystack) return 0;
    if (haystack === needle) return exact;
    if (haystack.startsWith(needle)) return Math.max(includes, starts);
    if (haystack.includes(needle)) return includes;
    return 0;
  };

  return Math.max(
    scoreFor(row.title, 1200, 900, 1050),
    scoreFor(row.id, 1000, 800),
    scoreFor(row.projectName, 700, 560, 640),
    scoreFor(row.cwd, 620, 460),
    scoreFor(`${row.providerLabel} ${row.provider}`, 360, 260),
    scoreFor(row.model, 300, 220),
    scoreFor(row.latestMeaningfulUserMessage || row.latestUserMessage, 430, 340),
    scoreFor(row.firstUserMessage, 320, 260),
    scoreFor(row.lastAgentMessage, 240, 180),
  );
}

function statusScore(row = {}) {
  if (row.archived) return -200;
  if (row.status === 'running') return 90;
  if (row.status === 'fresh') return 70;
  if (row.status === 'warm') return 35;
  return 0;
}

function normalizeRow(row = {}) {
  const artifacts = parseArtifactSummary(row.artifactsJson || '');
  return {
    id: String(row.id || ''),
    externalId: String(row.id || ''),
    provider: row.provider || '',
    providerLabel: row.providerLabel || row.provider || '',
    title: row.title || '未命名任务',
    projectName: row.projectName || '未知项目',
    cwd: row.cwd || '',
    status: row.status || '',
    archived: Boolean(coerceNumber(row.archived)),
    isSubagent: Boolean(coerceNumber(row.isSubagent)),
    isAutomation: Boolean(coerceNumber(row.isAutomation)),
    updatedAtMs: coerceNumber(row.updatedAtMs),
    createdAtMs: coerceNumber(row.createdAtMs),
    tokensUsed: coerceNumber(row.tokensUsed),
    todayTokenUsage: coerceNumber(row.todayTokenUsage),
    tokenBreakdown: parseTokenBreakdown(row.tokenBreakdownJson || '', row.tokensUsed),
    todayTokenBreakdown: parseTokenBreakdown(row.todayTokenBreakdownJson || '', row.todayTokenUsage),
    model: row.model || '',
    appDeepLink: row.appDeepLink || '',
    resumeCommand: row.resumeCommand || '',
    defaultOpenMode: row.defaultOpenMode || '',
    inCodexSidebar: Boolean(coerceNumber(row.inCodexSidebar, 1)),
    rolloutPath: row.rolloutPath || '',
    artifacts,
    firstUserMessage: row.firstUserMessage || '',
    latestUserMessage: row.latestUserMessage || '',
    latestMeaningfulUserMessage: row.latestMeaningfulUserMessage || '',
    lastAgentMessage: row.lastAgentMessage || '',
    relationText: row.relationText || '',
    searchText: row.searchText || '',
  };
}

function matchesQuery(row = {}, query = '', ftsRows = new Map()) {
  const normalizedQuery = folded(query);
  if (!normalizedQuery) return true;
  if (ftsRows.has(coerceNumber(row.rowid))) return true;
  if (String(row.searchText || '').includes(normalizedQuery)) return true;
  const tokens = queryTokens(query);
  return tokens.length > 0 && tokens.every((token) => String(row.searchText || '').includes(token));
}

function filterWhere({
  provider = 'all',
  status = 'all',
  project = 'all',
  includeArchived = false,
  includeSubagents = false,
  includeAutomations = false,
} = {}) {
  const clauses = [];
  if (!includeArchived && status !== 'archived') clauses.push('archived = 0');
  if (!includeSubagents) clauses.push('isSubagent = 0');
  if (!includeAutomations) clauses.push('isAutomation = 0');
  if (provider && provider !== 'all') clauses.push(`provider = ${sqlString(provider)}`);
  if (status && status !== 'all') clauses.push(`status = ${sqlString(status)}`);
  if (project && project !== 'all') clauses.push(`cwd = ${sqlString(project)}`);
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

async function readFtsScores(databasePath, query, runCommand) {
  const match = ftsQuery(query);
  if (!match) return new Map();

  try {
    const rows = await querySql(databasePath, `
      SELECT rowid, -bm25(thread_search_fts, 8.0, 4.0, 3.0, 3.0, 2.0, 1.5, 1.0) AS score
      FROM thread_search_fts
      WHERE thread_search_fts MATCH ${sqlString(match)};
    `, { runCommand });
    return new Map(rows.map((row) => [coerceNumber(row.rowid), coerceNumber(row.score)]));
  } catch {
    return new Map();
  }
}

export function createSearchIndex({
  databasePath = DEFAULT_INDEX_PATH,
  now = Date.now,
  runCommand = spawn,
} = {}) {
  let initialized = false;

  const init = async () => {
    if (initialized) return;
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    await runSql(databasePath, schemaSql(), { runCommand });
    await ensureThreadColumn(databasePath, 'defaultOpenMode', "defaultOpenMode TEXT NOT NULL DEFAULT ''", runCommand);
    await ensureThreadColumn(databasePath, 'inCodexSidebar', 'inCodexSidebar INTEGER NOT NULL DEFAULT 1', runCommand);
    await ensureThreadColumn(databasePath, 'isSubagent', 'isSubagent INTEGER NOT NULL DEFAULT 0', runCommand);
    await ensureThreadColumn(databasePath, 'isAutomation', 'isAutomation INTEGER NOT NULL DEFAULT 0', runCommand);
    await ensureThreadColumn(databasePath, 'artifactsJson', "artifactsJson TEXT NOT NULL DEFAULT ''", runCommand);
    await ensureThreadColumn(databasePath, 'tokenBreakdownJson', "tokenBreakdownJson TEXT NOT NULL DEFAULT ''", runCommand);
    await ensureThreadColumn(databasePath, 'todayTokenBreakdownJson', "todayTokenBreakdownJson TEXT NOT NULL DEFAULT ''", runCommand);
    initialized = true;
  };

  const indexDashboard = async (dashboard = {}) => {
    await init();
    const threads = Array.isArray(dashboard?.threads) ? dashboard.threads : [];
    const rows = threads
      .filter((thread) => thread?.id || thread?.externalId)
      .map(threadValuesSql)
      .join('\n');
    const indexedAtMs = now();

    await runSql(databasePath, `
      BEGIN IMMEDIATE;
      DELETE FROM thread_search_fts;
      DELETE FROM threads;
      ${rows}
      INSERT INTO meta(key, value) VALUES('indexedAtMs', ${sqlString(indexedAtMs)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      INSERT INTO meta(key, value) VALUES('threadCount', ${sqlString(threads.length)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      INSERT INTO meta(key, value) VALUES('indexVersion', ${sqlString(SEARCH_INDEX_VERSION)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      COMMIT;
    `, { runCommand });

    return {
      indexedAtMs,
      threadCount: threads.length,
      databasePath,
    };
  };

  const status = async () => {
    try {
      await init();
      const rows = await querySql(databasePath, 'SELECT key, value FROM meta;', { runCommand });
      const meta = new Map(rows.map((row) => [row.key, row.value]));
      const indexVersion = coerceNumber(meta.get('indexVersion'));
      return {
        available: true,
        databasePath,
        indexedAtMs: coerceNumber(meta.get('indexedAtMs')),
        threadCount: coerceNumber(meta.get('threadCount')),
        indexVersion,
        currentIndexVersion: SEARCH_INDEX_VERSION,
        needsRebuild: indexVersion !== SEARCH_INDEX_VERSION,
      };
    } catch (error) {
      return {
        available: false,
        databasePath,
        indexedAtMs: 0,
        threadCount: 0,
        indexVersion: 0,
        currentIndexVersion: SEARCH_INDEX_VERSION,
        needsRebuild: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const searchThreads = async (params = {}) => {
    await init();
    const query = compactText(params.query || params.q || '');
    const limit = safeLimit(params.limit);
    const offset = Math.max(0, Number.parseInt(params.offset || params.cursor || 0, 10) || 0);
    const ftsScores = await readFtsScores(databasePath, query, runCommand);
    const rows = await querySql(databasePath, `
      SELECT * FROM threads
      ${filterWhere(params)}
      ORDER BY updatedAtMs DESC;
    `, { runCommand });

    const scored = rows
      .filter((row) => matchesQuery(row, query, ftsScores))
      .map((row) => {
        const normalized = normalizeRow(row);
        const score = fieldScore(normalized, query)
          + coerceNumber(ftsScores.get(coerceNumber(row.rowid)))
          + statusScore(normalized)
          + Math.min(120, coerceNumber(normalized.todayTokenUsage) / 1_000_000);
        return {
          ...normalized,
          match: fieldMatch(normalized, query),
          searchScore: score,
        };
      })
      .sort((a, b) => (
        b.searchScore - a.searchScore
        || b.updatedAtMs - a.updatedAtMs
        || b.tokensUsed - a.tokensUsed
        || a.title.localeCompare(b.title)
      ));

    return {
      query,
      total: scored.length,
      limit,
      offset,
      nextCursor: offset + limit < scored.length ? String(offset + limit) : '',
      items: scored.slice(offset, offset + limit),
    };
  };

  const projectHistory = async ({ limit = 24, query = '' } = {}) => {
    await init();
    const rows = await querySql(databasePath, 'SELECT * FROM threads ORDER BY updatedAtMs DESC;', { runCommand });
    const needle = folded(query);
    const groups = new Map();

    for (const row of rows.map(normalizeRow)) {
      const key = row.cwd || row.projectName || '未知项目';
      if (needle && !folded(`${row.projectName} ${row.cwd}`).includes(needle)) continue;

      const existing = groups.get(key) || {
        cwd: row.cwd,
        projectName: row.projectName || '未知项目',
        threadCount: 0,
        activeThreadCount: 0,
        archivedThreadCount: 0,
        tokensUsed: 0,
        todayTokensUsed: 0,
        tokenBreakdown: addTokenBreakdowns(),
        todayTokenBreakdown: addTokenBreakdowns(),
        latestUpdatedAtMs: 0,
        providerSet: new Set(),
      };
      existing.threadCount += 1;
      if (row.archived) existing.archivedThreadCount += 1;
      else existing.activeThreadCount += 1;
      existing.tokensUsed += row.tokensUsed;
      existing.todayTokensUsed += row.todayTokenUsage;
      existing.tokenBreakdown = addTokenBreakdowns(existing.tokenBreakdown, row.tokenBreakdown);
      existing.todayTokenBreakdown = addTokenBreakdowns(existing.todayTokenBreakdown, row.todayTokenBreakdown);
      existing.latestUpdatedAtMs = Math.max(existing.latestUpdatedAtMs, row.updatedAtMs);
      if (row.providerLabel || row.provider) existing.providerSet.add(row.providerLabel || row.provider);
      groups.set(key, existing);
    }

    const items = [...groups.values()]
      .map(({ providerSet, ...project }) => ({
        ...project,
        providers: [...providerSet].sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => (
        b.tokensUsed - a.tokensUsed
        || b.latestUpdatedAtMs - a.latestUpdatedAtMs
        || a.projectName.localeCompare(b.projectName)
      ))
      .slice(0, safeLimit(limit, 24));

    return { items };
  };

  return {
    databasePath,
    indexDashboard,
    searchThreads,
    projectHistory,
    status,
  };
}
