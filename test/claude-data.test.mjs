import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadClaudeAgentThreads,
  loadClaudeDesktopCoworkThreads,
  normalizeClaudeCodeCliSession,
  openClaudeThread,
  parseClaudeJsonlSignals,
} from '../src/claude-data.mjs';

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
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
  assert.equal(thread.openLabel, '打开会话');
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
