import { spawn } from 'node:child_process';
import { readFile as fsReadFile, unlink as fsUnlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const REVIEW_RUNNER_TIMEOUT_MS = 5 * 60 * 1000;

const DEFAULT_MAX_RESULT_CHARS = 24000;
const DEFAULT_MAX_STDERR_CHARS = 4000;
const DEFAULT_MAX_PREVIEW_CHARS = 800;

const TARGETS = [
  {
    provider: 'codex-cli',
    label: 'Codex CLI',
    runner: 'codex-exec',
    command: 'codex',
  },
  {
    provider: 'claude-code-cli',
    label: 'Claude Code CLI',
    runner: 'claude-print',
    command: 'claude',
  },
  {
    provider: 'opencode-cli',
    label: 'OpenCode CLI',
    runner: 'opencode-run',
    command: 'opencode',
  },
];

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function truncateText(value, maxChars) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
    };
  }
  return {
    text: `${text.slice(0, maxChars)}...`,
    truncated: true,
  };
}

function defaultTempFilePath() {
  return path.join(os.tmpdir(), `agent-mission-control-review-${Date.now()}-${process.pid}.txt`);
}

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = options.timeout
      ? setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        const error = new Error(`Command timed out after ${options.timeout}ms`);
        error.timedOut = true;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }, options.timeout)
      : null;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, exitCode: 0 });
        return;
      }

      const error = new Error(`Command exited with code ${code}`);
      error.exitCode = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

function codexArgs({ cwd, model, outputPath }) {
  const args = [
    'exec',
    '-C',
    cwd || process.cwd(),
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
  ];
  if (model) args.push('-m', model);
  args.push('--output-last-message', outputPath, '-');
  return args;
}

function claudeArgs({ prompt, model }) {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--permission-mode',
    'dontAsk',
    '--tools',
    '',
  ];
  if (model) args.push('--model', model);
  return args;
}

function opencodeArgs({ prompt, cwd, model, agent }) {
  const args = [
    'run',
    '--dir',
    cwd || process.cwd(),
    '--format',
    'json',
  ];
  if (model) args.push('--model', model);
  if (agent) args.push('--agent', agent);
  args.push(prompt);
  return args;
}

function parseClaudeOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.result === 'string') return parsed.result;
    if (typeof parsed.response === 'string') return parsed.response;
  } catch {
    // Keep raw stdout if this CLI returns plain text or a changed JSON shape.
  }
  return stdout;
}

function buildSuccessMetadata({
  stdout,
  stderr,
  maxResultChars,
  maxPreviewChars,
  maxStderrChars,
}) {
  const result = truncateText(stdout, maxResultChars);
  const preview = truncateText(result.text, maxPreviewChars);
  return {
    ok: true,
    resultText: result.text,
    resultPreview: preview.text,
    stderr: truncateText(stderr, maxStderrChars).text,
    timedOut: false,
    truncatedResult: result.truncated || preview.truncated,
    exitCode: 0,
  };
}

function buildFailureMetadata({
  error,
  maxResultChars,
  maxPreviewChars,
  maxStderrChars,
}) {
  const timedOut = Boolean(error?.timedOut);
  const exitCode = Number.isInteger(error?.exitCode)
    ? error.exitCode
    : (Number.isInteger(error?.code) ? error.code : null);
  const result = truncateText(error?.stdout || '', maxResultChars);
  const preview = truncateText(result.text, maxPreviewChars);
  const stderr = truncateText(error?.stderr || '', maxStderrChars);

  return {
    ok: false,
    resultText: result.text,
    resultPreview: preview.text,
    stderr: stderr.text,
    timedOut,
    truncatedResult: result.truncated || preview.truncated,
    exitCode,
    error: timedOut
      ? 'Review runner timed out after 5 minutes'
      : `Review runner exited with code ${exitCode ?? 'unknown'}`,
  };
}

export async function runReviewWithProvider({
  provider,
  prompt,
  cwd,
  model,
  agent,
  runCommand: execute = runCommand,
  timeoutMs = REVIEW_RUNNER_TIMEOUT_MS,
  maxResultChars = DEFAULT_MAX_RESULT_CHARS,
  maxPreviewChars = DEFAULT_MAX_PREVIEW_CHARS,
  maxStderrChars = DEFAULT_MAX_STDERR_CHARS,
  tempFilePath = defaultTempFilePath,
  readFile = fsReadFile,
  unlink = fsUnlink,
} = {}) {
  const target = TARGETS.find((candidate) => candidate.provider === provider);
  if (!target) {
    throw httpError(`Unknown review provider: ${provider}`, 400);
  }

  const options = { cwd, timeout: timeoutMs };
  let command = target.command;
  let args = [];
  let outputPath = '';

  if (provider === 'codex-cli') {
    outputPath = tempFilePath();
    args = codexArgs({ cwd, model, outputPath });
    options.input = prompt;
  } else if (provider === 'claude-code-cli') {
    args = claudeArgs({ prompt, model });
  } else if (provider === 'opencode-cli') {
    args = opencodeArgs({ prompt, cwd, model, agent });
  }

  try {
    const result = await execute(command, args, options);
    let stdout = result.stdout || '';
    if (provider === 'codex-cli' && outputPath) {
      try {
        stdout = await readFile(outputPath, 'utf8');
      } catch {
        // Fall back to stdout if the CLI did not write the last-message file.
      } finally {
        try {
          await unlink(outputPath);
        } catch {
          // Best-effort cleanup for temp review output files.
        }
      }
    }
    if (provider === 'claude-code-cli') {
      stdout = parseClaudeOutput(stdout);
    }

    return buildSuccessMetadata({
      stdout,
      stderr: result.stderr || '',
      maxResultChars,
      maxPreviewChars,
      maxStderrChars,
    });
  } catch (error) {
    return buildFailureMetadata({
      error,
      maxResultChars,
      maxPreviewChars,
      maxStderrChars,
    });
  }
}

async function defaultCommandVersion(command) {
  try {
    const result = await runCommand(command, ['--version'], { timeout: 5000 });
    return {
      available: true,
      version: (result.stdout || result.stderr || '').trim(),
    };
  } catch (error) {
    return {
      available: false,
      message: error?.code === 'ENOENT' ? 'not found' : (error?.message || 'not available'),
    };
  }
}

export async function listReviewTargets({
  commandVersion = defaultCommandVersion,
} = {}) {
  const items = await Promise.all(TARGETS.map(async (target) => {
    const status = await commandVersion(target.command);
    const available = Boolean(status?.available);
    const detail = status?.version || status?.message || '';
    return {
      provider: target.provider,
      label: target.label,
      runner: target.runner,
      available,
      message: available
        ? `已检测到 ${target.command}${detail ? ` (${detail})` : ''}`
        : detail || `未检测到 ${target.command} CLI`,
    };
  }));

  return { items };
}
