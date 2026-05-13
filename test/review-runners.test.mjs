import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listReviewTargets,
  runReviewWithProvider,
} from '../src/review-runners.mjs';

test('codex runner calls codex exec with stdin prompt and read-only sandbox', async () => {
  const calls = [];
  const result = await runReviewWithProvider({
    provider: 'codex-cli',
    prompt: 'Review this output',
    cwd: '/repo',
    model: 'gpt-5.5',
    tempFilePath: () => '/tmp/codex-review-output.txt',
    readFile: async () => 'Codex review result',
    unlink: async () => {},
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: 'ignored stdout', stderr: '' };
    },
  });

  assert.equal(calls[0].command, 'codex');
  assert.deepEqual(calls[0].args, [
    'exec',
    '-C',
    '/repo',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
    '-m',
    'gpt-5.5',
    '--output-last-message',
    '/tmp/codex-review-output.txt',
    '-',
  ]);
  assert.equal(calls[0].options.input, 'Review this output');
  assert.equal(calls[0].options.timeout, 300000);
  assert.equal(result.ok, true);
  assert.equal(result.resultText, 'Codex review result');
});

test('claude runner calls claude print with json output and disabled tools', async () => {
  const calls = [];
  await runReviewWithProvider({
    provider: 'claude-code-cli',
    prompt: 'Review this output',
    cwd: '/repo',
    model: 'sonnet',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: '{"result":"Claude review result"}', stderr: '' };
    },
  });

  assert.equal(calls[0].command, 'claude');
  assert.deepEqual(calls[0].args, [
    '-p',
    'Review this output',
    '--output-format',
    'json',
    '--permission-mode',
    'dontAsk',
    '--tools',
    '',
    '--model',
    'sonnet',
  ]);
  assert.equal(calls[0].options.cwd, '/repo');
  assert.equal(calls[0].options.timeout, 300000);
});

test('opencode runner calls opencode run with json format', async () => {
  const calls = [];
  await runReviewWithProvider({
    provider: 'opencode-cli',
    prompt: 'Review this output',
    cwd: '/repo',
    model: 'anthropic/claude-sonnet-4-6',
    agent: 'reviewer',
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: '{"type":"message","text":"OpenCode review"}', stderr: '' };
    },
  });

  assert.equal(calls[0].command, 'opencode');
  assert.deepEqual(calls[0].args, [
    'run',
    '--dir',
    '/repo',
    '--format',
    'json',
    '--model',
    'anthropic/claude-sonnet-4-6',
    '--agent',
    'reviewer',
    'Review this output',
  ]);
  assert.equal(calls[0].options.timeout, 300000);
});

test('target discovery reports available and unavailable runners', async () => {
  const targets = await listReviewTargets({
    commandVersion: async (command) => {
      if (command === 'codex') return { available: true, version: 'codex 1.0.0' };
      if (command === 'claude') return { available: false, message: 'not found' };
      return { available: true, version: 'opencode 2.0.0' };
    },
  });

  assert.deepEqual(targets.items.map((target) => ({
    provider: target.provider,
    available: target.available,
  })), [
    { provider: 'codex-cli', available: true },
    { provider: 'claude-code-cli', available: false },
    { provider: 'opencode-cli', available: true },
  ]);
  assert.match(targets.items[0].message, /codex 1\.0\.0/);
  assert.match(targets.items[1].message, /not found/);
});

test('missing provider throws a useful error', async () => {
  await assert.rejects(
    () => runReviewWithProvider({
      provider: 'missing-provider',
      prompt: 'Review this',
      runCommand: async () => ({ stdout: '', stderr: '' }),
    }),
    /Unknown review provider: missing-provider/,
  );
});

test('non-zero exit is captured as failure metadata', async () => {
  const result = await runReviewWithProvider({
    provider: 'claude-code-cli',
    prompt: 'Review this',
    runCommand: async () => {
      const error = new Error('exit 1');
      error.exitCode = 1;
      error.stdout = 'partial result';
      error.stderr = 'bad things happened';
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.resultText, 'partial result');
  assert.equal(result.stderr, 'bad things happened');
  assert.equal(result.timedOut, false);
  assert.match(result.error, /exited with code 1/);
});

test('timeout returns failure metadata with timedOut true', async () => {
  const result = await runReviewWithProvider({
    provider: 'opencode-cli',
    prompt: 'Review this',
    runCommand: async () => {
      const error = new Error('Command timed out');
      error.timedOut = true;
      error.stderr = 'still running';
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.error, /timed out/);
});

test('stdout and stderr are truncated before returning metadata', async () => {
  const result = await runReviewWithProvider({
    provider: 'claude-code-cli',
    prompt: 'Review this',
    maxResultChars: 8,
    maxStderrChars: 6,
    runCommand: async () => ({
      stdout: 'r'.repeat(20),
      stderr: 'e'.repeat(20),
    }),
  });

  assert.equal(result.resultText, `${'r'.repeat(8)}...`);
  assert.equal(result.resultPreview, `${'r'.repeat(8)}...`);
  assert.equal(result.stderr, `${'e'.repeat(6)}...`);
  assert.equal(result.truncatedResult, true);
});
