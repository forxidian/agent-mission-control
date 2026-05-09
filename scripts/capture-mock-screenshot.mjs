import { execFile, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputPath = path.join(rootDir, 'docs', 'assets', 'agent-mission-control-real-ui.png');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const host = '127.0.0.1';
const port = process.env.PORT || '46291';
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

async function main() {
  await mkdir(path.dirname(outputPath), { recursive: true });

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
    await execFileAsync(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=/tmp/agent-mission-control-chrome-profile',
      '--virtual-time-budget=5000',
      '--window-size=1440,1180',
      `--screenshot=${outputPath}`,
      serverUrl,
    ], {
      cwd: rootDir,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    console.log(`Wrote ${outputPath}`);
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
