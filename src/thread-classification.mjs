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

function asObject(value) {
  return value && typeof value === 'object' ? value : null;
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return asObject(value);
  const text = value.trim();
  if (!text.startsWith('{')) return null;

  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function spawnInfoFromSource(source) {
  const parsed = parseJsonObject(source);
  const subagent = asObject(parsed?.subagent || parsed?.subAgent);
  const spawn = asObject(
    subagent?.thread_spawn
      || subagent?.threadSpawn
      || parsed?.thread_spawn
      || parsed?.threadSpawn,
  );
  const sourceString = typeof source === 'string' ? source : JSON.stringify(source || '');
  const parentFromText = sourceString.match(/"parent_thread_id"\s*:\s*"([^"]+)"/)?.[1]
    || sourceString.match(/"parentThreadId"\s*:\s*"([^"]+)"/)?.[1];

  return {
    hasSubagentMarker: Boolean(subagent || spawn || sourceText({ source }).includes('subagent')),
    parentThreadId: firstString(
      spawn?.parent_thread_id,
      spawn?.parentThreadId,
      subagent?.parent_thread_id,
      subagent?.parentThreadId,
      parsed?.parent_thread_id,
      parsed?.parentThreadId,
      parentFromText,
    ),
    depth: firstNumber(spawn?.depth, subagent?.depth, parsed?.depth),
    agentNickname: firstString(spawn?.agent_nickname, spawn?.agentNickname, subagent?.agent_nickname, subagent?.agentNickname),
    agentRole: firstString(spawn?.agent_role, spawn?.agentRole, subagent?.agent_role, subagent?.agentRole),
  };
}

export function subagentInfo(thread) {
  if (!thread || typeof thread !== 'object') {
    return {
      isSubagent: false,
      parentThreadId: '',
      depth: null,
      agentNickname: '',
      agentRole: '',
    };
  }
  const sourceInfo = spawnInfoFromSource(thread.source || thread.threadSource || thread.thread_source);
  const parentThreadId = firstString(thread.parentThreadId, thread.parent_thread_id, sourceInfo.parentThreadId);
  const directSubagent = thread.isSubagent || thread.isSubAgent || thread.subagent || thread.subAgent;

  const source = sourceText(thread);
  const sourceHasSubagentMarker = (
    sourceInfo.hasSubagentMarker
    || source.includes('subagent')
    || source.includes('sub-agent')
    || source.includes('thread_spawn')
    || source.includes('parent_thread_id')
  );

  return {
    isSubagent: Boolean(directSubagent || parentThreadId || sourceHasSubagentMarker),
    parentThreadId,
    depth: firstNumber(thread.subagentDepth, thread.subagent_depth, sourceInfo.depth),
    agentNickname: firstString(
      thread.agentNickname,
      thread.agent_nickname,
      thread.agentNickName,
      sourceInfo.agentNickname,
    ),
    agentRole: firstString(thread.agentRole, thread.agent_role, sourceInfo.agentRole),
  };
}

export function isSubagentThread(thread) {
  return Boolean(subagentInfo(thread)?.isSubagent);
}
