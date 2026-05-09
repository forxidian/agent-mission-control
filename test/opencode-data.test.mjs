import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadOpenCodeDesktopSignals,
  loadOpenCodeDesktopThreads,
  loadOpenCodeThreads,
  normalizeOpenCodeDesktopSession,
  normalizeOpenCodeSession,
  openOpenCodeSession,
} from '../src/opencode-data.mjs';

async function writeDesktopCacheEvents(dataDir, lines) {
  const cacheDir = path.join(dataDir, 'Cache', 'Cache_Data');
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, 'events_0'), `${lines.join('\n')}\n`);
}

test('normalizes OpenCode session rows into provider threads', () => {
  const thread = normalizeOpenCodeSession({
    id: 'ses_abc',
    title: 'DeepSeek refactor',
    directory: '/Users/example/project',
    time: {
      created: 1778040000000,
      updated: 1778043600000,
    },
    model: {
      providerID: 'deepseek',
      modelID: 'deepseek-chat',
    },
    tokens: {
      input: 1200,
      output: 800,
    },
  }, 1778047200000);

  assert.equal(thread.id, 'opencode:ses_abc');
  assert.equal(thread.externalId, 'ses_abc');
  assert.equal(thread.provider, 'opencode');
  assert.equal(thread.providerLabel, 'OpenCode');
  assert.equal(thread.title, 'DeepSeek refactor');
  assert.equal(thread.cwd, '/Users/example/project');
  assert.equal(thread.projectName, 'project');
  assert.equal(thread.model, 'deepseek/deepseek-chat');
  assert.equal(thread.tokensUsed, 2000);
  assert.equal(thread.createdAtMs, 1778040000000);
  assert.equal(thread.updatedAtMs, 1778043600000);
  assert.equal(thread.resumeCommand, 'cd /Users/example/project && opencode --session ses_abc');
  assert.equal(thread.canOpen, true);
  assert.equal(thread.openLabel, '打开会话');
});

test('loads OpenCode sessions from CLI json output', async () => {
  const result = await loadOpenCodeThreads({
    nowMs: 1778047200000,
    runOpenCode: async (args) => {
      assert.deepEqual(args, ['session', 'list', '--max-count', '120', '--format', 'json']);
      return JSON.stringify({
        sessions: [
          {
            id: 'ses_one',
            name: 'Build worker',
            cwd: '/tmp/work',
            updatedAt: '2026-05-06T10:00:00.000Z',
          },
        ],
      });
    },
  });

  assert.equal(result.provider.installed, true);
  assert.equal(result.provider.threadCount, 1);
  assert.equal(result.threads[0].id, 'opencode:ses_one');
  assert.equal(result.threads[0].title, 'Build worker');
});

test('reports OpenCode as unavailable when the CLI is missing', async () => {
  const result = await loadOpenCodeThreads({
    desktopDataDir: '/missing/opencode/desktop/state',
    runOpenCode: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
  });

  assert.equal(result.provider.installed, false);
  assert.equal(result.provider.status, 'missing');
  assert.equal(result.threads.length, 0);
});

test('normalizes OpenCode desktop sessions into project deep links', () => {
  const thread = normalizeOpenCodeDesktopSession({
    id: 'ses_desktop',
    directory: '/Users/example/work',
    at: 1778050000000,
    model: {
      providerID: 'deepseek',
      modelID: 'deepseek-v4-pro',
    },
    hasUnreadTurn: true,
  }, 1778050100000);

  assert.equal(thread.id, 'opencode:ses_desktop');
  assert.equal(thread.source, 'opencode-desktop');
  assert.equal(thread.title, 'work');
  assert.equal(thread.model, 'deepseek/deepseek-v4-pro');
  assert.equal(thread.hasUnreadTurn, true);
  assert.equal(thread.appDeepLink, 'opencode://open-project?directory=%2FUsers%2Fexample%2Fwork');
  assert.equal(thread.resumeCommand, "open 'opencode://open-project?directory=%2FUsers%2Fexample%2Fwork'");
});

test('falls back to OpenCode desktop state when the CLI is missing', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-desktop-'));
  await writeFile(path.join(dataDir, 'opencode.global.dat'), JSON.stringify({
    'layout.page': JSON.stringify({
      lastProjectSession: {
        '/tmp/work': {
          directory: '/tmp/work',
          id: 'ses_one',
          at: 1778050000000,
        },
      },
    }),
    notification: JSON.stringify({
      list: [
        {
          directory: '/tmp/work',
          session: 'ses_one',
          time: 1778050100000,
          viewed: false,
          type: 'turn-complete',
        },
      ],
    }),
  }));
  await writeFile(path.join(dataDir, 'opencode.workspace.demo.dat'), JSON.stringify({
    'workspace:model-selection': JSON.stringify({
      session: {
        ses_one: {
          model: {
            providerID: 'deepseek',
            modelID: 'deepseek-v4-pro',
          },
        },
      },
    }),
  }));
  await writeDesktopCacheEvents(dataDir, [
    `data: ${JSON.stringify({
      directory: '/tmp/work',
      payload: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_one',
          part: {
            id: 'part_tool',
            type: 'tool',
            tool: 'bash',
            callID: 'call_1',
            state: {
              status: 'pending',
              time: { start: 1778050150000 },
              input: {},
            },
          },
        },
      },
    })}`,
    `data: ${JSON.stringify({
      directory: '/tmp/work',
      payload: {
        type: 'todo.updated',
        properties: {
          sessionID: 'ses_one',
          time: 1778050160000,
          todos: [
            { id: 'todo_1', content: '确认 shell 命令', status: 'pending' },
            { id: 'todo_2', content: '运行测试', status: 'completed' },
          ],
        },
      },
    })}`,
  ]);

  const result = await loadOpenCodeThreads({
    nowMs: 1778050200000,
    desktopDataDir: dataDir,
    runOpenCode: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
  });

  assert.equal(result.provider.installed, true);
  assert.equal(result.provider.status, 'desktop');
  assert.equal(result.provider.threadCount, 1);
  assert.equal(result.threads[0].id, 'opencode:ses_one');
  assert.equal(result.threads[0].model, 'deepseek/deepseek-v4-pro');
  assert.equal(result.threads[0].hasUnreadTurn, true);
  assert.equal(result.threads[0].updatedAtMs, 1778050160000);
  assert.equal(result.threads[0].awaitingPermission, true);
  assert.equal(result.threads[0].openCodePendingToolCount, 1);
  assert.equal(result.threads[0].openCodePendingTools[0].tool, 'bash');
  assert.equal(result.threads[0].openCodeTodoCount, 1);
});

test('reads OpenCode desktop cache events for pending tool approvals and todos', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-desktop-events-'));
  await writeDesktopCacheEvents(dataDir, [
    `data: ${JSON.stringify({
      directory: '/tmp/project',
      payload: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_waiting',
          part: {
            id: 'tool_pending',
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'pending',
              time: { start: 1778050150000 },
            },
          },
        },
      },
    })}`,
    `data: ${JSON.stringify({
      directory: '/tmp/project',
      payload: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_completed',
          part: {
            id: 'tool_done',
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'pending',
              time: { start: 1778050100000 },
            },
          },
        },
      },
    })}`,
    `data: ${JSON.stringify({
      directory: '/tmp/project',
      payload: {
        type: 'message.part.updated',
        properties: {
          sessionID: 'ses_completed',
          part: {
            id: 'tool_done',
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'running',
              time: { start: 1778050110000 },
            },
          },
        },
      },
    })}`,
    `data: ${JSON.stringify({
      directory: '/tmp/project',
      payload: {
        type: 'todo.updated',
        properties: {
          sessionID: 'ses_waiting',
          time: 1778050160000,
          todos: [
            { id: 'todo_1', content: '批准文件读取', status: 'pending' },
            { id: 'todo_2', content: '已完成项', status: 'completed' },
          ],
        },
      },
    })}`,
  ]);

  const signals = await loadOpenCodeDesktopSignals({ dataDir });

  assert.equal(signals.sessions.ses_waiting.pendingTools.length, 1);
  assert.equal(signals.sessions.ses_waiting.pendingTools[0].tool, 'bash');
  assert.equal(signals.sessions.ses_waiting.pendingTools[0].signalAtMs, 1778050150000);
  assert.equal(signals.sessions.ses_waiting.todos.length, 2);
  assert.equal(signals.sessions.ses_waiting.openTodoCount, 1);
  assert.equal(signals.sessions.ses_completed.pendingTools.length, 0);
});

test('loads OpenCode desktop state directly', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-desktop-direct-'));
  await writeFile(path.join(dataDir, 'opencode.global.dat'), JSON.stringify({
    'layout.page': JSON.stringify({
      lastProjectSession: {
        '/tmp/project': {
          directory: '/tmp/project',
          id: 'ses_project',
          at: 1778050000000,
        },
      },
    }),
  }));
  const result = await loadOpenCodeDesktopThreads({ dataDir, nowMs: 1778050200000 });

  assert.equal(result.provider.status, 'desktop');
  assert.equal(result.threads.length, 1);
  assert.equal(result.threads[0].projectName, 'project');
});

test('builds a nonblocking macOS Terminal opener for OpenCode sessions', async () => {
  const calls = [];
  const result = await openOpenCodeSession({
    externalId: 'ses_abc',
    cwd: '/Users/example/project with space',
  }, {
    platform: 'darwin',
    runCommand: async (command, args) => {
      calls.push({ command, args });
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.method, 'opencode-terminal');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'osascript');
  assert.match(calls[0].args.join('\n'), /opencode --session ses_abc/);
  assert.match(calls[0].args.join('\n'), /project with space/);
});

test('opens OpenCode desktop sessions through the registered deep link', async () => {
  const calls = [];
  const result = await openOpenCodeSession({
    externalId: 'ses_desktop',
    cwd: '/Users/example/work',
    appDeepLink: 'opencode://open-project?directory=%2FUsers%2Fexample%2Fwork',
    resumeCommand: "open 'opencode://open-project?directory=%2FUsers%2Fexample%2Fwork'",
  }, {
    platform: 'darwin',
    runCommand: async (command, args) => {
      calls.push({ command, args });
    },
  });

  assert.equal(result.opened, true);
  assert.equal(result.method, 'opencode-deeplink');
  assert.deepEqual(calls, [{
    command: 'open',
    args: ['opencode://open-project?directory=%2FUsers%2Fexample%2Fwork'],
  }]);
});
