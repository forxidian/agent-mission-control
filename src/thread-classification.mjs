function sourceText(thread) {
  return [
    thread?.source,
    thread?.threadSource,
    thread?.thread_source,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase())
    .join('\n');
}

export function isSubagentThread(thread) {
  if (!thread || typeof thread !== 'object') return false;
  if (thread.isSubagent || thread.isSubAgent || thread.subagent) return true;
  if (thread.parentThreadId || thread.parent_thread_id) return true;

  const source = sourceText(thread);
  return (
    source.includes('subagent')
    || source.includes('sub-agent')
    || source.includes('thread_spawn')
    || source.includes('parent_thread_id')
  );
}
