import { open, stat } from 'node:fs/promises';

const DEFAULT_PREVIEW_CHARS = 800;
const DEFAULT_MAX_CONTENT_CHARS = 24000;
const DEFAULT_MAX_ROLLOUT_BYTES = 512 * 1024;
const SOURCE_DESCRIPTIONS = {
  'latest-agent-signal': '最近 Agent 输出信号',
  'thread-summary': '线程摘要和最近 Agent 输出',
  'latest-turn': '最近一轮用户输入到 Agent 最终输出',
};

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function previewText(content, maxPreviewChars) {
  if (content.length <= maxPreviewChars) {
    return {
      preview: content,
      truncated: false,
    };
  }

  return {
    preview: `${content.slice(0, maxPreviewChars)}...`,
    truncated: true,
  };
}

function truncateContent(content, maxContentChars) {
  if (content.length <= maxContentChars) {
    return {
      content,
      contentTruncated: false,
    };
  }

  return {
    content: `${content.slice(0, maxContentChars)}...`,
    contentTruncated: true,
  };
}

function payloadText(payload = {}) {
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.content === 'string') return payload.content;
  if (Array.isArray(payload.content)) {
    return payload.content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

async function readTail(filePath, maxBytes) {
  const info = await stat(filePath);
  const start = Math.max(0, info.size - maxBytes);
  const length = info.size - start;
  const handle = await open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return text;
    const firstNewline = text.indexOf('\n');
    return firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
  } finally {
    await handle.close();
  }
}

function threadProvider(thread) {
  return String(thread.provider || thread.source || '').toLowerCase();
}

function isCodexThread(thread) {
  const provider = threadProvider(thread);
  return provider === 'codex' || provider === 'codex-cli' || provider === '';
}

function threadSummaryContent(thread) {
  return [
    'Agent Mission Control 线程摘要',
    '用途：交给另一个本地 Agent 做评审；包含标准线程字段和截断信号。',
    '',
    `线程: ${thread.title || '未命名线程'}`,
    `来源: ${thread.providerLabel || thread.provider || 'Agent'}`,
    `项目: ${thread.projectName || '未知项目'}`,
    `cwd: ${thread.cwd || '-'}`,
    `模型: ${thread.model || '未知模型'}`,
    `状态: ${thread.status || '-'}`,
    `今日 token: ${thread.todayTokenUsage || 0}`,
    `历史 token: ${thread.tokensUsed || 0}`,
    '',
    `最近用户输入信号: ${thread.latestMeaningfulUserMessage || thread.latestUserMessage || thread.firstUserMessage || '-'}`,
    `最近 Agent 输出信号: ${thread.lastAgentMessage || '-'}`,
  ].join('\n');
}

function parseLatestCodexTurn(jsonlText) {
  let currentTurn = null;
  let latestCompleteTurn = null;

  for (const line of jsonlText.split('\n')) {
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const payload = event.payload || event;
    if (payload?.type === 'user_message') {
      const text = payloadText(payload).trim();
      if (text) {
        currentTurn = {
          userText: text,
          agentTexts: [],
        };
      }
      continue;
    }

    if (payload?.type === 'agent_message' && currentTurn) {
      const text = payloadText(payload).trim();
      if (text) currentTurn.agentTexts.push(text);
      if (payload.phase === 'final_answer' && currentTurn.agentTexts.length) {
        latestCompleteTurn = currentTurn;
      }
    }
  }

  return latestCompleteTurn;
}

async function codexLatestTurnContent(thread, maxRolloutBytes) {
  if (!thread.rolloutPath) {
    throw httpError('Codex latest-turn requires a rollout path', 422);
  }

  let text;
  try {
    text = await readTail(thread.rolloutPath, maxRolloutBytes);
  } catch (error) {
    throw httpError(`Unable to read Codex rollout for latest-turn: ${error.message}`, 422);
  }

  const turn = parseLatestCodexTurn(text);
  if (!turn) {
    throw httpError('Codex latest-turn is not available for this thread', 422);
  }

  return [
    '最近一轮对话',
    '',
    '用户输入:',
    turn.userText,
    '',
    'Agent 输出:',
    turn.agentTexts.join('\n\n'),
  ].join('\n');
}

function contentResult({
  thread,
  mode,
  content,
  sourceDescription,
  maxContentChars,
  maxPreviewChars,
}) {
  const truncatedContent = truncateContent(content, maxContentChars);
  const preview = previewText(truncatedContent.content, maxPreviewChars);
  return {
    threadId: thread.id,
    mode,
    content: truncatedContent.content,
    preview: preview.preview,
    truncated: truncatedContent.contentTruncated || preview.truncated,
    sourceDescription,
  };
}

export async function getReviewContentForThread({
  thread,
  mode = 'latest-agent-signal',
  maxPreviewChars = DEFAULT_PREVIEW_CHARS,
  maxContentChars = DEFAULT_MAX_CONTENT_CHARS,
  maxRolloutBytes = DEFAULT_MAX_ROLLOUT_BYTES,
} = {}) {
  if (!thread) {
    throw httpError('Thread not found', 404);
  }

  if (mode === 'latest-agent-signal') {
    const content = typeof thread.lastAgentMessage === 'string' ? thread.lastAgentMessage.trim() : '';
    if (!content) {
      throw httpError('该线程暂无可评审的 Agent 输出', 422);
    }

    return contentResult({
      thread,
      mode,
      content,
      sourceDescription: SOURCE_DESCRIPTIONS[mode],
      maxContentChars,
      maxPreviewChars,
    });
  }

  if (mode === 'thread-summary') {
    return contentResult({
      thread,
      mode,
      content: threadSummaryContent(thread),
      sourceDescription: SOURCE_DESCRIPTIONS[mode],
      maxContentChars,
      maxPreviewChars,
    });
  }

  if (mode === 'latest-turn') {
    if (!isCodexThread(thread)) {
      throw httpError(`latest-turn is not available for ${thread.providerLabel || thread.provider || 'this provider'}`, 422);
    }

    return contentResult({
      thread,
      mode,
      content: await codexLatestTurnContent(thread, maxRolloutBytes),
      sourceDescription: SOURCE_DESCRIPTIONS[mode],
      maxContentChars,
      maxPreviewChars,
    });
  }

  throw httpError(`Unsupported review content mode: ${mode}`, 422);
}
