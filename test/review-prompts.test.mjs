import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewPrompt,
  listReviewTemplates,
} from '../src/review-prompts.mjs';

test('lists the four MVP review templates', () => {
  const templates = listReviewTemplates();

  assert.deepEqual(templates.map((template) => template.id), [
    'code-review',
    'technical-review',
    'product-review',
    'response-quality-review',
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
