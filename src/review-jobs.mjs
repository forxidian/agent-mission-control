import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_REVIEW_JOBS_PATH = path.join(
  os.homedir(),
  '.agent-mission-control',
  'reviews.jsonl',
);

const DEFAULT_COMPACT_THRESHOLD = 1000;
const DEFAULT_MAX_RESULT_CHARS = 24000;
const DEFAULT_MAX_STDERR_CHARS = 4000;
const DEFAULT_MAX_PREVIEW_CHARS = 800;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function defaultRandomSuffix() {
  return randomBytes(3).toString('hex');
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

function parseSnapshots(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function latestSnapshots(snapshots) {
  const byId = new Map();
  for (const snapshot of snapshots) {
    byId.set(snapshot.id, snapshot);
  }
  return [...byId.values()];
}

function sortRecent(jobs) {
  return [...jobs].sort((a, b) => {
    const timeDiff = (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
    if (timeDiff) return timeDiff;
    return String(b.id).localeCompare(String(a.id));
  });
}

export function createReviewJobStore({
  filePath = DEFAULT_REVIEW_JOBS_PATH,
  now = () => Date.now(),
  randomSuffix = defaultRandomSuffix,
  compactThreshold = DEFAULT_COMPACT_THRESHOLD,
  maxResultChars = DEFAULT_MAX_RESULT_CHARS,
  maxPreviewChars = DEFAULT_MAX_PREVIEW_CHARS,
  maxStderrChars = DEFAULT_MAX_STDERR_CHARS,
} = {}) {
  let queue = Promise.resolve();

  function enqueue(operation) {
    const next = queue.then(operation, operation);
    queue = next.catch(() => {});
    return next;
  }

  async function ensureDir() {
    await mkdir(path.dirname(filePath), { recursive: true });
  }

  async function readSnapshots() {
    try {
      return parseSnapshots(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function compactSnapshots(snapshots) {
    const latest = latestSnapshots(snapshots);
    const tempPath = `${filePath}.tmp`;
    const body = latest.map((snapshot) => JSON.stringify(snapshot)).join('\n');
    await writeFile(tempPath, body ? `${body}\n` : '', 'utf8');
    await rename(tempPath, filePath);
  }

  async function appendSnapshot(snapshot) {
    await ensureDir();
    await appendFile(filePath, `${JSON.stringify(snapshot)}\n`, 'utf8');

    const snapshots = await readSnapshots();
    if (snapshots.length > compactThreshold) {
      await compactSnapshots(snapshots);
    }
  }

  function sanitizePatch(patch) {
    const sanitized = { ...patch };

    if ('resultText' in sanitized) {
      const result = truncateText(sanitized.resultText, maxResultChars);
      sanitized.resultText = result.text;
      sanitized.truncatedResult = Boolean(sanitized.truncatedResult || result.truncated);
    }

    if ('resultPreview' in sanitized) {
      const result = truncateText(sanitized.resultPreview, maxPreviewChars);
      sanitized.resultPreview = result.text;
      sanitized.truncatedResult = Boolean(sanitized.truncatedResult || result.truncated);
    }

    if ('stderr' in sanitized) {
      sanitized.stderr = truncateText(sanitized.stderr, maxStderrChars).text;
    }

    return sanitized;
  }

  async function getLatestJob(id) {
    const snapshots = await readSnapshots();
    let latest = null;
    for (const snapshot of snapshots) {
      if (snapshot.id === id) latest = snapshot;
    }
    return latest;
  }

  return {
    filePath,

    createJob(payload) {
      return enqueue(async () => {
        const timestamp = now();
        const job = {
          id: `review_${timestamp}_${randomSuffix()}`,
          status: 'queued',
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
          startedAtMs: null,
          completedAtMs: null,
          source: payload.source || {},
          target: payload.target || {},
          templateId: payload.templateId,
          inputMode: payload.inputMode || 'latest-agent-signal',
          inputPreview: payload.inputPreview || '',
          resultText: '',
          resultPreview: '',
          error: '',
          stderr: '',
          timedOut: false,
          truncatedResult: false,
          exitCode: null,
        };
        await appendSnapshot(job);
        return job;
      });
    },

    updateJob(id, patch) {
      return enqueue(async () => {
        const existing = await getLatestJob(id);
        if (!existing) {
          throw httpError(`Review job not found: ${id}`, 404);
        }

        const updated = {
          ...existing,
          ...sanitizePatch(patch),
          updatedAtMs: now(),
        };
        await appendSnapshot(updated);
        return updated;
      });
    },

    getJob(id) {
      return enqueue(async () => {
        const job = await getLatestJob(id);
        if (!job) {
          throw httpError(`Review job not found: ${id}`, 404);
        }
        return job;
      });
    },

    listJobs({ limit = 50, threadId } = {}) {
      return enqueue(async () => {
        const snapshots = await readSnapshots();
        let jobs = latestSnapshots(snapshots);
        if (threadId) {
          jobs = jobs.filter((job) => job.source?.threadId === threadId);
        }
        const recent = sortRecent(jobs);
        const items = recent.slice(0, limit);

        return {
          items,
          summary: {
            total: recent.length,
            running: recent.filter((job) => job.status === 'running').length,
            failed: recent.filter((job) => job.status === 'failed').length,
          },
        };
      });
    },

    compact() {
      return enqueue(async () => {
        await ensureDir();
        await compactSnapshots(await readSnapshots());
      });
    },
  };
}
