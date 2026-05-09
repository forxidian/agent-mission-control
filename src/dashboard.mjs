import { loadCodexCliProvider, loadCodexDashboard } from './codex-data.mjs';
import { loadClaudeAgentThreads } from './claude-data.mjs';
import { loadOpenCodeThreads } from './opencode-data.mjs';
import { buildDashboard } from './insights.mjs';

function codexProvider(dashboard) {
  const threadCount = (dashboard?.threads || [])
    .filter((thread) => (thread.provider || 'codex') === 'codex').length;
  return {
    id: 'codex',
    label: 'Codex',
    installed: true,
    status: 'ready',
    message: threadCount ? `已读取 ${threadCount} 条 Codex 线程` : '已接入，暂无线程',
    threadCount,
  };
}

export async function loadDashboard(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const [codexDashboard, openCodeResult, claudeResult] = await Promise.all([
    loadCodexDashboard({ ...options, nowMs }),
    loadOpenCodeThreads({
      nowMs,
      runOpenCode: options.runOpenCode,
      maxCount: options.openCodeMaxCount,
      desktopDataDir: options.openCodeDesktopDataDir,
    }),
    loadClaudeAgentThreads({
      nowMs,
      runCommand: options.runClaudeCommand,
      maxCount: options.claudeMaxCount,
      projectsDir: options.claudeProjectsDir,
      appDir: options.claudeAppDir,
    }),
  ]);
  const codexCliThreadCount = (codexDashboard.threads || [])
    .filter((thread) => thread.provider === 'codex-cli').length;
  const codexCli = await loadCodexCliProvider({
    runCommand: options.runCodexCommand,
    threadCount: codexCliThreadCount,
  });
  const providers = [
    codexProvider(codexDashboard),
    codexCli,
    openCodeResult.provider,
    ...claudeResult.providers,
  ];
  const dashboard = buildDashboard([
    ...(codexDashboard.threads || []),
    ...(openCodeResult.threads || []),
    ...(claudeResult.threads || []),
  ], nowMs);

  return {
    ...dashboard,
    providers,
    summary: {
      ...dashboard.summary,
      providers,
    },
  };
}
