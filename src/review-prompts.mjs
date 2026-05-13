const REVIEW_TEMPLATES = [
  {
    id: 'code-review',
    label: '代码审查',
    role: '你是一个严格的软件工程代码审查者。',
    focus: [
      '代码行为是否符合需求',
      '是否存在明显 bug、回归或边界条件遗漏',
      '测试覆盖是否足够',
      '实现是否保持简单、局部且可维护',
    ],
  },
  {
    id: 'technical-review',
    label: '技术方案审查',
    role: '你是一个严格的软件工程审查者。',
    focus: [
      '需求是否理解正确',
      '架构边界是否合理',
      '是否有遗漏的风险',
      '是否有更简单的 MVP 路径',
    ],
  },
  {
    id: 'product-review',
    label: '产品/需求审查',
    role: '你是一个严格的产品和需求审查者。',
    focus: [
      '用户目标是否被准确回应',
      '范围是否适合 MVP',
      '交互和文案是否会造成误解',
      '是否遗漏关键验收条件',
    ],
  },
  {
    id: 'response-quality-review',
    label: '回复质量审查',
    role: '你是一个严格的 Agent 回复质量审查者。',
    focus: [
      '结论是否清晰可执行',
      '事实和假设是否区分明确',
      '是否存在不必要的冗长或遗漏',
      '是否需要补充验证或风险提示',
    ],
  },
  {
    id: 'custom-review',
    label: '自定义审查',
    role: '你是一个严格的 Agent 审查者。',
    focus: [
      '优先执行用户自定义审查要求',
      '指出阻塞问题和可验证风险',
      '区分事实、推断和建议',
      '给出可执行的后续修改建议',
    ],
  },
];

const REQUIRED_OUTPUT_STRUCTURE = [
  '1. 总体结论',
  '2. 主要问题',
  '3. 风险和遗漏',
  '4. 建议修改',
  '5. 是否建议采纳原输出',
];

function findTemplate(templateId) {
  const template = REVIEW_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) {
    throw new Error(`Unknown review template: ${templateId}`);
  }
  return template;
}

export function listReviewTemplates() {
  return REVIEW_TEMPLATES.map(({ id, label }) => ({ id, label }));
}

export function buildReviewPrompt({
  templateId,
  source = {},
  content,
  customReviewInstruction = '',
}) {
  const template = findTemplate(templateId);
  const provider = source.providerLabel || source.provider || 'Unknown';
  const title = source.title || 'Untitled thread';
  const cwd = source.cwd || 'Unknown';
  const model = source.model || 'Unknown';
  const customInstruction = String(customReviewInstruction || '').trim();
  const customInstructionSection = template.id === 'custom-review'
    ? `\n用户自定义审查要求：\n${customInstruction || '用户未提供额外审查要求，请按上面的通用审查重点执行。'}\n`
    : '';

  return `${template.role}

请评审下面来自 ${provider} 的输出。

请重点检查：
${template.focus.map((item) => `- ${item}`).join('\n')}
${customInstructionSection}
评审方式：
- 可以读取项目文件来核对事实、架构边界和实现细节。
- 非必要不要读取文件；如果待评审内容已经足够，请直接基于已提供上下文评审，避免无谓消耗 token。
- 不要读取 .env、密钥、cookie、token、私有配置或本地 Agent 状态文件，除非用户明确要求审查这些文件本身。
- 禁止修改、写入、删除文件，禁止改动工作区状态。
- 不要执行提交、push 或创建 PR。

来源：
- provider: ${provider}
- thread: ${title}
- project: ${cwd}
- model: ${model}

待评审内容：
${content || ''}

请按下面结构输出：

${REQUIRED_OUTPUT_STRUCTURE.join('\n')}`;
}
