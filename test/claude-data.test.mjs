import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as zlib from 'node:zlib';
import {
  loadClaudeAgentThreads,
  loadClaudeDesktopCoworkThreads,
  normalizeClaudeCodeCliSession,
  normalizeClaudeDesktopCodeSession,
  normalizeClaudeDesktopCoworkSession,
  openClaudeThread,
  parseClaudeJsonlSignals,
  readClaudeUsageCache,
} from '../src/claude-data.mjs';

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

async function writeClaudeUsageCache(appDir, payload, {
  organizationId = 'org_123',
  observedAt = 'Tue, 12 May 2026 08:24:03 GMT',
} = {}) {
  const cacheDir = path.join(appDir, 'Cache', 'Cache_Data');
  await mkdir(cacheDir, { recursive: true });
  const header = Buffer.from(
    `1/0/https://claude.ai/api/organizations/${organizationId}/usage\0`
    + `HTTP/1.1 200\0date:${observedAt}\0content-type:application/json\0`
    + `${zlib.zstdCompressSync ? 'content-encoding:zstd\0' : ''}\0`,
  );
  const rawBody = Buffer.from(JSON.stringify(payload));
  const body = zlib.zstdCompressSync ? zlib.zstdCompressSync(rawBody) : rawBody;
  await writeFile(path.join(cacheDir, 'usage-cache-entry_0'), Buffer.concat([header, body]));
}

test('parses Claude JSONL usage, running state, and pending user prompts', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T02:00:00.000Z',
      sessionId: 'ses_cli',
      cwd: '/Users/example/work',
      entrypoint: 'cli',
      message: { role: 'user', content: '帮我检查这个项目' },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:01:00.000Z',
      message: {
        id: 'msg_1',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 200,
          output_tokens: 50,
        },
        content: [
          {
            type: 'tool_use',
            id: 'tool_ask',
            name: 'AskUserQuestion',
            input: { question: '可以运行测试吗？' },
          },
        ],
      },
    },
  ]), { todayStartMs: Date.parse('2026-05-09T00:00:00.000Z') });

  assert.equal(signals.sessionId, 'ses_cli');
  assert.equal(signals.cwd, '/Users/example/work');
  assert.equal(signals.model, 'claude-sonnet-4-6');
  assert.equal(signals.tokensUsed, 350);
  assert.equal(signals.todayTokenUsage, 350);
  assert.equal(signals.latestUserMessage, '帮我检查这个项目');
  assert.equal(signals.latestAgentFinalAtMs, null);
  assert.equal(signals.pendingToolCount, 1);
  assert.equal(signals.pendingTools[0].title, '向用户提问');
  assert.equal(signals.pendingTools[0].kind, 'permission');
});

test('parses Claude rate limits from status line JSONL events', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'system',
      timestamp: '2026-05-12T08:00:00.000Z',
      rate_limits: {
        five_hour: {
          used_percentage: 41,
          resets_at: '2026-05-12T08:30:00.000Z',
        },
        seven_day: {
          used_percentage: 5,
          resets_at: '2026-05-16T12:00:00.000Z',
        },
      },
    },
  ]));

  assert.equal(signals.rateLimits.primary.used_percent, 41);
  assert.equal(signals.rateLimits.primary.window_minutes, 300);
  assert.equal(signals.rateLimits.primary.resets_at, Date.parse('2026-05-12T08:30:00.000Z') / 1000);
  assert.equal(signals.rateLimits.secondary.used_percent, 5);
  assert.equal(signals.rateLimits.secondary.window_minutes, 10_080);
  assert.equal(signals.latestRateLimitAtMs, Date.parse('2026-05-12T08:00:00.000Z'));
  assert.equal(signals.latestThreadRateLimitAtMs, Date.parse('2026-05-12T08:00:00.000Z'));
});

test('ignores ordinary unresolved Claude tool uses as user pending work', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T02:00:00.000Z',
      sessionId: 'ses_cli',
      cwd: '/Users/example/work',
      message: { role: 'user', content: '跑一下测试' },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:01:00.000Z',
      message: {
        id: 'msg_tool',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [
          {
            type: 'tool_use',
            id: 'tool_bash',
            name: 'Bash',
            input: {
              command: 'npm test',
              description: 'Run test suite',
            },
          },
        ],
      },
    },
  ]));

  assert.equal(signals.latestUserMessage, '跑一下测试');
  assert.equal(signals.latestAgentFinalAtMs, null);
  assert.equal(signals.pendingToolCount, 0);
  assert.equal(signals.pendingToolAtMs, 0);
  assert.deepEqual(signals.pendingTools, []);
});

test('keeps ordinary Claude tool results out of user pending work', () => {
  const resolvedByToolResult = parseClaudeJsonlSignals(jsonl([
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:01:00.000Z',
      message: {
        id: 'msg_tool',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_bash',
            name: 'Bash',
            input: { description: 'Run test suite' },
          },
        ],
      },
    },
    {
      type: 'user',
      timestamp: '2026-05-09T02:02:00.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_bash',
            content: 'ok',
          },
        ],
      },
    },
  ]));

  const resolvedByResult = parseClaudeJsonlSignals(jsonl([
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:01:00.000Z',
      message: {
        id: 'msg_tool',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_bash',
            name: 'Bash',
            input: { description: 'Run test suite' },
          },
        ],
      },
    },
    {
      type: 'result',
      timestamp: '2026-05-09T02:03:00.000Z',
      terminal_reason: 'completed',
    },
  ]));

  assert.equal(resolvedByToolResult.pendingToolCount, 0);
  assert.equal(resolvedByToolResult.pendingToolAtMs, 0);
  assert.equal(resolvedByResult.pendingToolCount, 0);
  assert.equal(resolvedByResult.pendingToolAtMs, 0);
});

test('does not treat intermediate Claude text before tool work as a completed turn', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T02:00:00.000Z',
      sessionId: 'ses_cli',
      cwd: '/Users/example/work',
      message: { role: 'user', content: '继续实现这个模块' },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:01:00.000Z',
      message: {
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [{ type: 'text', text: '我会先拆分任务，然后继续改代码。' }],
      },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:02:00.000Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_edit',
            name: 'Edit',
            input: { file_path: '/Users/example/work/app.js' },
          },
        ],
      },
    },
    {
      type: 'user',
      timestamp: '2026-05-09T02:03:00.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_edit',
            content: 'ok',
          },
        ],
      },
    },
  ]));
  const thread = normalizeClaudeDesktopCodeSession({
    sessionId: 'local_active',
    cliSessionId: '123e4567-e89b-12d3-a456-426614174000',
    originCwd: '/Users/example/work',
    lastActivityAt: Date.parse('2026-05-09T02:03:00.000Z'),
  }, {
    signals,
  }, Date.parse('2026-05-09T02:04:00.000Z'));

  assert.equal(signals.lastAgentMessage, '我会先拆分任务，然后继续改代码。');
  assert.equal(signals.latestAgentFinalAtMs, null);
  assert.equal(thread.status, 'running');
  assert.equal(thread.currentTurnStartedAtMs, Date.parse('2026-05-09T02:00:00.000Z'));
});

test('uses Claude assistant end_turn events as completed-turn markers', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T02:00:00.000Z',
      sessionId: 'ses_cli',
      cwd: '/Users/example/work',
      message: { role: 'user', content: '跑一次回测' },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:03:00.000Z',
      sessionId: 'ses_cli',
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '回测已经跑完，可以查看结果。' }],
      },
    },
  ]));
  const thread = normalizeClaudeDesktopCodeSession({
    sessionId: 'local_done',
    cliSessionId: '123e4567-e89b-12d3-a456-426614174000',
    originCwd: '/Users/example/work',
    lastActivityAt: Date.parse('2026-05-09T02:03:00.000Z'),
  }, {
    signals,
  }, Date.parse('2026-05-09T03:00:00.000Z'));

  assert.equal(signals.lastAgentMessage, '回测已经跑完，可以查看结果。');
  assert.equal(signals.latestAgentFinalAtMs, Date.parse('2026-05-09T02:03:00.000Z'));
  assert.equal(thread.status, 'warm');
  assert.equal(thread.currentTurnStartedAtMs, null);
});

test('uses Claude stop hook summaries as completed-turn markers', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T02:00:00.000Z',
      sessionId: 'ses_cli',
      cwd: '/Users/example/work',
      message: { role: 'user', content: '生成报告' },
    },
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:02:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '报告已生成。' }],
      },
    },
    {
      type: 'system',
      subtype: 'stop_hook_summary',
      timestamp: '2026-05-09T02:03:00.000Z',
      sessionId: 'ses_cli',
    },
  ]));

  assert.equal(signals.lastAgentMessage, '报告已生成。');
  assert.equal(signals.latestAgentFinalAtMs, Date.parse('2026-05-09T02:03:00.000Z'));
  assert.equal(signals.latestMessageKind, 'agent');
});

test('normalizes Claude Code CLI sessions into provider threads', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T02:00:00.000Z',
      sessionId: 'ses_cli',
      cwd: '/Users/example/project',
      entrypoint: 'cli',
      version: '2.1.89',
      message: { role: 'user', content: '生成报告' },
    },
    {
      type: 'result',
      timestamp: '2026-05-09T02:03:00.000Z',
      session_id: 'ses_cli',
      terminal_reason: 'completed',
      result: '报告已生成',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
      },
    },
  ]), { todayStartMs: Date.parse('2026-05-09T00:00:00.000Z') });

  const thread = normalizeClaudeCodeCliSession({
    filePath: '/tmp/ses_cli.jsonl',
    stat: { mtimeMs: Date.parse('2026-05-09T02:03:00.000Z') },
    signals,
  }, Date.parse('2026-05-09T03:00:00.000Z'));

  assert.equal(thread.id, 'claude-code-cli:ses_cli');
  assert.equal(thread.provider, 'claude-code-cli');
  assert.equal(thread.providerLabel, 'Claude Code CLI');
  assert.equal(thread.title, '生成报告');
  assert.equal(thread.projectName, 'project');
  assert.equal(thread.tokensUsed, 30);
  assert.equal(thread.todayTokenUsage, 30);
  assert.equal(thread.status, 'warm');
  assert.equal(thread.resumeCommand, 'cd /Users/example/project && claude --resume ses_cli');
  assert.equal(thread.openLabel, '打开');
});

test('prefers Claude result usage over duplicate assistant usage', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'assistant',
      timestamp: '2026-05-09T02:01:00.000Z',
      message: {
        id: 'msg_duplicate',
        role: 'assistant',
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: 'text', text: '处理中' }],
      },
    },
    {
      type: 'result',
      timestamp: '2026-05-09T02:03:00.000Z',
      uuid: 'result_1',
      terminal_reason: 'completed',
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  ]), { todayStartMs: Date.parse('2026-05-09T00:00:00.000Z') });

  assert.equal(signals.tokensUsed, 30);
  assert.equal(signals.todayTokenUsage, 30);
});

test('reads Claude Desktop usage cache as rate limits', async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), 'claude-usage-cache-'));
  await writeClaudeUsageCache(appDir, {
    five_hour: {
      utilization: 41,
      resets_at: '2026-05-12T08:30:00.000Z',
    },
    seven_day: {
      utilization: 5,
      resets_at: '2026-05-16T12:00:00.000Z',
    },
  });

  const usageCache = await readClaudeUsageCache({ appDir });

  assert.equal(usageCache.source, 'claude-desktop-cache');
  assert.equal(usageCache.organizationId, 'org_123');
  assert.equal(usageCache.observedAtMs, Date.parse('Tue, 12 May 2026 08:24:03 GMT'));
  assert.equal(usageCache.rateLimits.primary.used_percent, 41);
  assert.equal(usageCache.rateLimits.primary.resets_at, Date.parse('2026-05-12T08:30:00.000Z') / 1000);
  assert.equal(usageCache.rateLimits.secondary.used_percent, 5);
  assert.equal(usageCache.rateLimits.secondary.window_minutes, 10_080);
});

test('reuses Claude Desktop usage cache within its TTL', async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), 'claude-usage-cache-ttl-'));
  const cacheDir = path.join(appDir, 'Cache', 'Cache_Data');
  await writeClaudeUsageCache(appDir, {
    five_hour: { utilization: 22 },
  });

  const first = await readClaudeUsageCache({
    appDir,
    cacheTtlMs: 60_000,
    nowMs: 1_000,
  });
  await rm(cacheDir, { recursive: true, force: true });
  const cached = await readClaudeUsageCache({
    appDir,
    cacheTtlMs: 60_000,
    nowMs: 2_000,
  });
  const expired = await readClaudeUsageCache({
    appDir,
    cacheTtlMs: 60_000,
    nowMs: 62_001,
  });

  assert.equal(first.rateLimits.primary.used_percent, 22);
  assert.equal(cached.rateLimits.primary.used_percent, 22);
  assert.equal(expired, null);
});

test('loads Claude Cowork desktop metadata and audit signals', async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), 'claude-app-'));
  const root = path.join(appDir, 'local-agent-mode-sessions', 'account', 'workspace');
  const sessionId = 'local_123';
  await mkdir(path.join(root, sessionId), { recursive: true });
  await writeFile(path.join(root, 'spaces.json'), JSON.stringify({
    spaces: [
      {
        id: 'space_1',
        name: '产品研究',
        folders: [{ path: '/Users/example/research' }],
      },
    ],
  }));
  await writeFile(path.join(root, `${sessionId}.json`), JSON.stringify({
    sessionId,
    cliSessionId: 'cli_123',
    cwd: `${root}/${sessionId}/outputs`,
    createdAt: Date.parse('2026-05-09T01:00:00.000Z'),
    lastActivityAt: Date.parse('2026-05-09T02:00:00.000Z'),
    model: 'claude-opus-4-6',
    isArchived: false,
    title: '研究 Agent 面板',
    hostLoopMode: true,
    spaceId: 'space_1',
  }));
  await writeFile(path.join(root, sessionId, 'audit.jsonl'), jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T01:00:00.000Z',
      session_id: 'audit_123',
      message: { role: 'user', content: '研究 Agent 面板' },
    },
    {
      type: 'result',
      timestamp: '2026-05-09T02:00:00.000Z',
      session_id: 'audit_123',
      terminal_reason: 'completed',
      result: '研究完成',
      usage: { input_tokens: 500, output_tokens: 200 },
    },
  ]));
  await writeClaudeUsageCache(appDir, {
    five_hour: {
      utilization: 38,
      resets_at: '2026-05-09T04:30:00.000Z',
    },
    seven_day: {
      utilization: 12,
      resets_at: '2026-05-16T12:00:00.000Z',
    },
  }, { observedAt: 'Sat, 09 May 2026 02:01:00 GMT' });

  const result = await loadClaudeDesktopCoworkThreads({
    appDir,
    nowMs: Date.parse('2026-05-09T03:00:00.000Z'),
    todayStartMs: Date.parse('2026-05-09T00:00:00.000Z'),
  });

  assert.equal(result.provider.status, 'desktop');
  assert.equal(result.provider.threadCount, 1);
  assert.equal(result.threads[0].id, 'claude-desktop-cowork:local_123');
  assert.equal(result.threads[0].projectName, '产品研究');
  assert.equal(result.threads[0].cwd, '/Users/example/research');
  assert.equal(result.threads[0].tokensUsed, 700);
  assert.equal(result.threads[0].resumeCommand, 'open -a Claude');
  assert.equal(result.threads[0].isAgentCompleted, null);
  assert.equal(result.threads[0].agentRunning, false);
  assert.equal(result.threads[0].rateLimits.primary.used_percent, 38);
  assert.equal(result.threads[0].rateLimits.secondary.used_percent, 12);
  assert.equal(result.threads[0].rateLimitUpdatedAtMs, Date.parse('Sat, 09 May 2026 02:01:00 GMT'));
  assert.equal(result.threads[0].rateLimitActivityAtMs, null);
});

test('deduplicates Claude Desktop Code sessions from the CLI provider', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-dedupe-'));
  const projectsDir = path.join(dir, 'projects', '-Users-example-project');
  const appDir = path.join(dir, 'Claude');
  const desktopDir = path.join(appDir, 'claude-code-sessions', 'account', 'workspace');
  await mkdir(projectsDir, { recursive: true });
  await mkdir(desktopDir, { recursive: true });
  await writeFile(path.join(projectsDir, 'cli_shared.jsonl'), jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T01:00:00.000Z',
      sessionId: 'cli_shared',
      cwd: '/Users/example/project',
      entrypoint: 'cli',
      message: { role: 'user', content: '桌面 Code 任务' },
    },
  ]));
  await writeFile(path.join(desktopDir, 'local_shared.json'), JSON.stringify({
    sessionId: 'local_shared',
    cliSessionId: 'cli_shared',
    cwd: '/Users/example/project',
    originCwd: '/Users/example/project',
    createdAt: Date.parse('2026-05-09T01:00:00.000Z'),
    lastActivityAt: Date.parse('2026-05-09T01:10:00.000Z'),
    title: '桌面 Code 任务',
    model: 'claude-sonnet-4-6',
  }));

  const result = await loadClaudeAgentThreads({
    appDir,
    projectsDir,
    nowMs: Date.parse('2026-05-09T03:00:00.000Z'),
    todayStartMs: Date.parse('2026-05-09T00:00:00.000Z'),
    runCommand: async () => ({ stdout: '2.1.89 (Claude Code)' }),
  });

  assert.equal(result.threads.filter((thread) => thread.provider === 'claude-code-cli').length, 0);
  assert.equal(result.threads.filter((thread) => thread.provider === 'claude-desktop-code').length, 1);
});

test('deduplicates Claude Desktop Code metadata that points at the same CLI session', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-desktop-code-dedupe-'));
  const projectsDir = path.join(dir, 'projects', '-Users-example-project');
  const appDir = path.join(dir, 'Claude');
  const desktopDir = path.join(appDir, 'claude-code-sessions', 'account', 'workspace');
  const cliSessionId = 'cli_shared';
  await mkdir(projectsDir, { recursive: true });
  await mkdir(desktopDir, { recursive: true });
  await writeFile(path.join(projectsDir, `${cliSessionId}.jsonl`), jsonl([
    {
      type: 'assistant',
      timestamp: '2026-05-09T01:12:00.000Z',
      sessionId: cliSessionId,
      cwd: '/Users/example/project',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_pending',
            name: 'Bash',
            input: { description: 'Check status' },
          },
        ],
      },
    },
  ]));
  await writeFile(path.join(desktopDir, 'local_old.json'), JSON.stringify({
    sessionId: 'local_old',
    cliSessionId,
    originCwd: '/Users/example/project',
    createdAt: Date.parse('2026-05-09T01:00:00.000Z'),
    lastActivityAt: Date.parse('2026-05-09T01:05:00.000Z'),
    title: 'Older duplicate',
  }));
  await writeFile(path.join(desktopDir, 'local_new.json'), JSON.stringify({
    sessionId: 'local_new',
    cliSessionId,
    originCwd: '/Users/example/project',
    createdAt: Date.parse('2026-05-09T01:00:00.000Z'),
    lastActivityAt: Date.parse('2026-05-09T01:10:00.000Z'),
    title: 'Newer duplicate',
  }));

  const result = await loadClaudeAgentThreads({
    appDir,
    projectsDir,
    nowMs: Date.parse('2026-05-09T03:00:00.000Z'),
    todayStartMs: Date.parse('2026-05-09T00:00:00.000Z'),
    runCommand: async () => ({ stdout: '2.1.89 (Claude Code)' }),
  });
  const desktopThreads = result.threads.filter((thread) => thread.provider === 'claude-desktop-code');

  assert.equal(desktopThreads.length, 1);
  assert.equal(desktopThreads[0].id, 'claude-desktop-code:local_new');
  assert.equal(desktopThreads[0].pendingToolCount, 0);
});

test('uses Claude Cowork incomplete metadata as a running signal', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T01:00:00.000Z',
      session_id: 'audit_123',
      message: { role: 'user', content: '持续研究这个问题' },
    },
    {
      type: 'result',
      timestamp: '2026-05-09T01:20:00.000Z',
      session_id: 'audit_123',
      terminal_reason: 'completed',
      result: '阶段性完成',
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  ]), { todayStartMs: Date.parse('2026-05-09T00:00:00.000Z') });
  const thread = normalizeClaudeDesktopCoworkSession({
    sessionId: 'local_running',
    cliSessionId: 'cli_running',
    cwd: '/Users/example/research',
    createdAt: Date.parse('2026-05-09T01:00:00.000Z'),
    lastActivityAt: Date.parse('2026-05-09T01:30:00.000Z'),
    model: 'claude-opus-4-6',
    isArchived: false,
    isAgentCompleted: false,
    title: '持续研究',
    hostLoopMode: true,
  }, {
    signals,
  }, Date.parse('2026-05-09T03:00:00.000Z'));

  assert.equal(thread.provider, 'claude-desktop-cowork');
  assert.equal(thread.isAgentCompleted, false);
  assert.equal(thread.agentRunning, true);
  assert.equal(thread.status, 'running');
  assert.equal(thread.currentTurnStartedAtMs, Date.parse('2026-05-09T01:00:00.000Z'));
});

test('normalizes Claude Desktop Code sessions with a desktop resume deep link', () => {
  const cliSessionId = '123e4567-e89b-12d3-a456-426614174000';
  const thread = normalizeClaudeDesktopCodeSession({
    sessionId: 'local_123',
    cliSessionId,
    originCwd: '/Users/example/project',
    createdAt: Date.parse('2026-05-09T01:00:00.000Z'),
    lastActivityAt: Date.parse('2026-05-09T01:10:00.000Z'),
    title: '桌面 Code 任务',
    model: 'claude-sonnet-4-6',
  }, {}, Date.parse('2026-05-09T03:00:00.000Z'));

  assert.equal(thread.provider, 'claude-desktop-code');
  assert.equal(thread.appDeepLink, `claude://resume?session=${cliSessionId}`);
  assert.equal(thread.resumeCommand, `open 'claude://resume?session=${cliSessionId}'`);
  assert.equal(thread.cliSessionId, cliSessionId);
});

test('uses Claude Desktop Code panel default title for untitled task-notification sessions', () => {
  const signals = parseClaudeJsonlSignals(jsonl([
    {
      type: 'user',
      timestamp: '2026-05-09T02:00:00.000Z',
      sessionId: 'ses_cli',
      cwd: '/Users/example/project',
      message: {
        role: 'user',
        content: '<task-notification><task-id>abc</task-id><output-file>/tmp/out</output-file></task-notification>',
      },
    },
  ]));
  const thread = normalizeClaudeDesktopCodeSession({
    sessionId: 'local_untitled',
    cliSessionId: '123e4567-e89b-12d3-a456-426614174000',
    originCwd: '/Users/example/project',
    createdAt: Date.parse('2026-05-09T01:00:00.000Z'),
    lastActivityAt: Date.parse('2026-05-09T02:00:00.000Z'),
  }, {
    signals,
  }, Date.parse('2026-05-09T03:00:00.000Z'));

  assert.equal(thread.title, 'General coding session');
});

test('opens Claude CLI sessions in Terminal on macOS', async () => {
  const calls = [];
  const result = await openClaudeThread({
    provider: 'claude-code-cli',
    externalId: 'ses_cli',
    cwd: '/Users/example/project',
    resumeCommand: 'cd /Users/example/project && claude --resume ses_cli',
  }, {
    platform: 'darwin',
    runCommand: async (command, args) => {
      calls.push({ command, args });
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.method, 'claude-terminal');
  assert.equal(calls[0].command, 'osascript');
  assert.match(calls[0].args.join('\n'), /claude --resume ses_cli/);
});

test('opens Claude Desktop Code sessions through the registered resume deep link', async () => {
  const cliSessionId = '123e4567-e89b-12d3-a456-426614174000';
  const appDeepLink = `claude://resume?session=${cliSessionId}`;
  const calls = [];
  const result = await openClaudeThread({
    provider: 'claude-desktop-code',
    externalId: 'local_123',
    cliSessionId,
    appDeepLink,
    resumeCommand: `open '${appDeepLink}'`,
  }, {
    platform: 'darwin',
    runCommand: async (command, args) => {
      calls.push({ command, args });
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.method, 'claude-desktop-deeplink');
  assert.deepEqual(calls[0], {
    command: 'open',
    args: [appDeepLink],
  });
});
