import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'docs', 'assets');
const outputPath = path.join(assetsDir, 'agent-mission-control-real-ui.png');
const searchOutputPath = path.join(assetsDir, 'agent-mission-control-search-ui.png');
const artifactsOutputPath = path.join(assetsDir, 'agent-mission-control-artifacts-ui.png');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const host = '127.0.0.1';
const port = process.env.PORT || '46291';
const debugPort = process.env.CHROME_DEBUG_PORT || String(Number(port) + 1);
const serverUrl = `http://${host}:${port}`;
const promptPackStorageKey = 'agent-mission-control:prompt-pack';
const promptPackScreenshotFixture = {
  id: 'pack-readme-demo-20260624',
  createdAtMs: Date.UTC(2026, 5, 24, 6, 0, 0),
  segments: [
    {
      id: 'segment-a-readme',
      code: 'A',
      title: 'README 首屏更新',
      body: '把首页截图改成能直接看懂 Prompt 打包器的价值：展示多段修改要求、附件引用和复制 Markdown 包入口。',
      attachments: [
        {
          id: 'A1',
          kind: 'image',
          fileName: 'A1-current-dashboard.png',
          originalName: 'current-dashboard.png',
          path: '/Users/example/workspaces/agent-mission-control/mock/current-dashboard.png',
          contentType: 'image/png',
          size: 482_000,
          status: 'saved',
          error: '',
        },
      ],
    },
    {
      id: 'segment-b-release',
      code: 'B',
      title: 'Release notes 双语补充',
      body: '补一段中英文 update log，说明 0.4.5 新增 token 明细、Prompt 打包、多线程操作菜单和置顶 badge。',
      attachments: [
        {
          id: 'B1',
          kind: 'file',
          fileName: 'B1-changelog-draft.md',
          originalName: 'changelog-draft.md',
          path: '/Users/example/workspaces/agent-mission-control/mock/changelog-draft.md',
          contentType: 'text/markdown',
          size: 18_400,
          status: 'saved',
          error: '',
        },
      ],
    },
    {
      id: 'segment-c-polish',
      code: 'C',
      title: '视觉验收重点',
      body: '检查移动端和桌面端是否都能清楚看到段落编号、标题、正文和附件状态；如果空间不够，优先保留段落内容而不是空白说明。',
      attachments: [],
    },
  ],
};

async function waitForServer(url, isServerAlive, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isServerAlive()) {
      throw new Error('Mock dashboard server exited before it was ready');
    }

    try {
      const response = await fetch(`${url}/api/dashboard`);
      if (response.ok) return;
    } catch {
      // Wait for the child process to bind the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForChrome(debugUrl, isChromeAlive, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isChromeAlive()) {
      throw new Error('Chrome exited before DevTools was ready');
    }

    try {
      const response = await fetch(`${debugUrl}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Wait for Chrome to expose the DevTools endpoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for Chrome DevTools at ${debugUrl}`);
}

class DevToolsClient {
  constructor(webSocketUrl) {
    this.webSocket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.webSocket.addEventListener('open', resolve, { once: true });
      this.webSocket.addEventListener('error', reject, { once: true });
    });
    this.webSocket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'DevTools command failed'));
      } else {
        pending.resolve(message.result || {});
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  close() {
    this.webSocket.close();
  }
}

async function waitForExpression(client, expression, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await client.send('Runtime.evaluate', {
      expression: `Boolean(${expression})`,
      returnByValue: true,
    }).catch(() => null);
    if (result?.result?.value) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await waitForExpression(client, 'document.readyState === "complete"');
}

async function capture(client, outputFile) {
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(outputFile, Buffer.from(data, 'base64'));
  console.log(`Wrote ${outputFile}`);
}

async function seedPromptPackFixture(client) {
  await client.send('Runtime.evaluate', {
    expression: `
      localStorage.setItem(
        ${JSON.stringify(promptPackStorageKey)},
        ${JSON.stringify(JSON.stringify(promptPackScreenshotFixture))}
      );
    `,
  });
}

async function captureScreenshots(chromeProfileDir) {
  const debugUrl = `http://${host}:${debugPort}`;
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${chromeProfileDir}`,
    `--remote-debugging-address=${host}`,
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1440,1180',
    'about:blank',
  ], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let chromeExited = false;
  chrome.stdout.on('data', (chunk) => process.stdout.write(chunk));
  chrome.stderr.on('data', (chunk) => process.stderr.write(chunk));
  chrome.once('exit', () => {
    chromeExited = true;
  });

  const client = new DevToolsClient(await waitForChrome(debugUrl, () => !chromeExited));
  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1180,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await navigate(client, serverUrl);
    await seedPromptPackFixture(client);
    await navigate(client, serverUrl);
    await waitForExpression(client, 'document.querySelectorAll(".thread-row").length >= 2 && document.querySelector(".thread-artifact-module")');
    await waitForExpression(client, 'document.querySelectorAll(".prompt-pack-segment").length >= 3 && document.querySelectorAll(".prompt-pack-attachment").length >= 2');
    await capture(client, outputPath);

    await navigate(client, `${serverUrl}/#search`);
    await waitForExpression(client, 'document.querySelector("#search-page") && !document.querySelector("#search-page").hidden');
    await client.send('Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.querySelector('#search-input');
          input.value = 'artifact';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })();
      `,
    });
    await waitForExpression(client, 'document.querySelectorAll(".search-result-row").length >= 1');
    await capture(client, searchOutputPath);

    await navigate(client, serverUrl);
    await waitForExpression(client, 'document.querySelector(".thread-artifact-module")');
    await client.send('Runtime.evaluate', {
      expression: 'document.querySelector(".thread-artifact-module").click();',
    });
    await waitForExpression(client, 'document.querySelector(".artifact-timeline-modal:not([hidden]) .artifact-timeline-item")');
    await capture(client, artifactsOutputPath);
  } finally {
    client.close();
    chrome.kill('SIGTERM');
  }
}

async function main() {
  await mkdir(assetsDir, { recursive: true });
  const chromeProfileDir = await mkdtemp(path.join(os.tmpdir(), 'agent-mission-control-chrome-profile-'));

  const child = spawn(process.execPath, [path.join(rootDir, 'scripts', 'mock-dashboard-server.mjs')], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOST: host,
      PORT: port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childExited = false;

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.once('exit', () => {
    childExited = true;
  });

  try {
    await waitForServer(serverUrl, () => !childExited);
    await captureScreenshots(chromeProfileDir);
  } finally {
    child.kill('SIGTERM');
    await rm(chromeProfileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
