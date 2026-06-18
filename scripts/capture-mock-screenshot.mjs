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
    await waitForExpression(client, 'document.querySelectorAll(".thread-row").length >= 2 && document.querySelector(".thread-artifact-module")');
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
