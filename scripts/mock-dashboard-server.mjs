import { createServer } from '../src/server.mjs';
import { createSearchIndex } from '../src/search-index.mjs';
import { createMockDashboard, createMockNotifications } from './mock-dashboard-data.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const port = Number.parseInt(process.env.PORT || '4629', 10);
const host = process.env.HOST || '127.0.0.1';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-mission-control-mock-'));

const notificationCenter = {
  async refresh() {
    return createMockNotifications();
  },
  async updateNotification(id, patch = {}) {
    return { id, ...patch };
  },
  async updateSettings(patch = {}) {
    return {
      desktopNotificationsEnabled: true,
      privacyMode: true,
      ...patch,
    };
  },
  async sendTestNotification() {
    return { sent: true };
  },
};

function compareArtifactsDesc(a, b) {
  return Number(b.atMs || 0) - Number(a.atMs || 0)
    || Number(b.sequence || 0) - Number(a.sequence || 0);
}

function artifactTurns(items = []) {
  const byTurn = new Map();
  for (const item of items) {
    const turn = Number(item.turn || 0) || 1;
    const group = byTurn.get(turn) || { turn, atMs: item.atMs || null, items: [] };
    group.atMs = Math.max(Number(group.atMs || 0), Number(item.atMs || 0)) || group.atMs;
    group.items.push(item);
    byTurn.set(turn, group);
  }

  return [...byTurn.values()]
    .map((turn) => ({ ...turn, items: turn.items.sort(compareArtifactsDesc) }))
    .sort((a, b) => Number(b.atMs || 0) - Number(a.atMs || 0) || Number(b.turn || 0) - Number(a.turn || 0));
}

async function loadMockCodexThreadArtifacts({ thread } = {}) {
  const dashboard = createMockDashboard();
  const currentThread = dashboard.threads.find((candidate) => candidate.id === thread?.id) || thread;
  const artifacts = currentThread?.artifacts || { total: 0, latestAtMs: null, typeCounts: {}, items: [] };
  const items = Array.isArray(artifacts.items) ? artifacts.items : [];
  return {
    threadId: currentThread?.id || '',
    artifacts: {
      ...artifacts,
      items,
      turns: artifactTurns(items),
    },
  };
}

const server = createServer({
  loadDashboard: async () => createMockDashboard(),
  notificationCenter,
  searchIndex: createSearchIndex({
    databasePath: path.join(tempDir, 'search-index.sqlite'),
  }),
  loadCodexThreadArtifacts: loadMockCodexThreadArtifacts,
});

async function cleanup() {
  await rm(tempDir, { recursive: true, force: true });
}

process.once('SIGTERM', () => {
  server.close(() => {
    cleanup().finally(() => process.exit(0));
  });
});

process.once('SIGINT', () => {
  server.close(() => {
    cleanup().finally(() => process.exit(0));
  });
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Agent Mission Control mock dashboard: http://${host}:${actualPort}`);
});
