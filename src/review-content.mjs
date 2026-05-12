const DEFAULT_PREVIEW_CHARS = 800;
const SOURCE_DESCRIPTIONS = {
  'latest-agent-signal': '最近 Agent 输出信号',
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

export function getReviewContentForThread({
  thread,
  mode = 'latest-agent-signal',
  maxPreviewChars = DEFAULT_PREVIEW_CHARS,
} = {}) {
  if (!thread) {
    throw httpError('Thread not found', 404);
  }

  if (mode !== 'latest-agent-signal') {
    throw httpError(`Unsupported review content mode: ${mode}`, 422);
  }

  const content = typeof thread.lastAgentMessage === 'string' ? thread.lastAgentMessage.trim() : '';
  if (!content) {
    throw httpError('该线程暂无可评审的 Agent 输出', 422);
  }

  const preview = previewText(content, maxPreviewChars);
  return {
    threadId: thread.id,
    mode,
    content,
    preview: preview.preview,
    truncated: preview.truncated,
    sourceDescription: SOURCE_DESCRIPTIONS[mode],
  };
}
