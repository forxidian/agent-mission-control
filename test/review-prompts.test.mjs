import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewPrompt,
  listReviewTemplates,
} from '../src/review-prompts.mjs';

test('lists the review templates including custom review', () => {
  const templates = listReviewTemplates();

  assert.deepEqual(templates.map((template) => template.id), [
    'code-review',
    'technical-review',
    'product-review',
    'response-quality-review',
    'custom-review',
  ]);
  assert.ok(templates.every((template) => template.label));
});

test('builds a review prompt with metadata, content, and required structure', () => {
  const prompt = buildReviewPrompt({
    templateId: 'technical-review',
    source: {
      provider: 'codex',
      providerLabel: 'Codex',
      title: '实现评审工作流',
      cwd: '/Users/ellic/code/agent-mission-control',
      model: 'gpt-5.5',
    },
    content: '这里是需要被评审的 Agent 输出。',
  });

  assert.match(prompt, /严格的软件工程审查者/);
  assert.match(prompt, /provider: Codex/);
  assert.match(prompt, /thread: 实现评审工作流/);
  assert.match(prompt, /project: \/Users\/ellic\/code\/agent-mission-control/);
  assert.match(prompt, /model: gpt-5\.5/);
  assert.match(prompt, /这里是需要被评审的 Agent 输出。/);

  for (const requiredHeading of [
    '1. 总体结论',
    '2. 主要问题',
    '3. 风险和遗漏',
    '4. 建议修改',
    '5. 是否建议采纳原输出',
  ]) {
    assert.match(prompt, new RegExp(requiredHeading));
  }
});

test('builds a custom review prompt with user-provided requirements', () => {
  const prompt = buildReviewPrompt({
    templateId: 'custom-review',
    source: {
      providerLabel: 'Codex',
      title: '实现本地 Agent 群聊',
    },
    content: '待评审内容',
    customReviewInstruction: '请重点检查是否有串台风险，以及 UI 状态是否会被轮询覆盖。',
  });

  assert.match(prompt, /严格的 Agent 审查者/);
  assert.match(prompt, /用户自定义审查要求/);
  assert.match(prompt, /串台风险/);
  assert.match(prompt, /待评审内容/);
});

test('throws a useful error for unknown review templates', () => {
  assert.throws(
    () => buildReviewPrompt({
      templateId: 'missing-template',
      source: { providerLabel: 'Codex', title: 'Thread' },
      content: 'text',
    }),
    /Unknown review template: missing-template/,
  );
});
