# Agent Loop Principles for Agent Mission Control

更新时间：2026-05-13

## 来源与用途

这份文档把 [Agent Loop 最佳实践调研](https://www.bilibili.com/toy/agent-loop-best-practices/index.html) 中对本项目有用的部分，转化为 Agent Mission Control 的产品和技术设计原则。

它不是第三方资料的全文摘录，也不是要求把 Mission Control 做成开放式聊天室。它的用途是约束后续 Agent Review、Fix Loop、Memory Loop、并行评审等功能，避免“本地 Agent 群聊”变成无边界的多模型互相回复。

## 核心判断

该知识库对当前 Agent 群聊方向有直接参考价值，原因是它强调的不是“让 Agent 多说几轮”，而是把目标、工具、环境反馈、验证、记忆和人类审批组织成可收敛的 loop。

对 Agent Mission Control 来说，最重要的转译是：

- 群聊不是目标，闭环是目标。
- 多 Agent 的价值主要来自第二视角审查、并行探索、反例查找和沉淀复用。
- Mission Control 应该做本地 harness：路由消息、限制上下文、记录 job、展示结果、保留人工审批点。
- 每个跨 Agent workflow 都要有输入边界、目标 Agent、模板、观察信号、停止条件和结果沉淀。

## 对本项目的产品原则

### 1. 做 workflow，不做无边界聊天室

“本地 Agent 群聊”在产品上应表现为一组明确动作，而不是一个多人聊天窗口：

- Review：把一个 Agent 的输出交给另一个 Agent 审查。
- Fix：把 review 结果交回原 Agent 处理。
- Verify：让独立 Agent 或工具检查修复结果。
- Debate：让多个 Agent 对同一方案给出独立意见，再汇总差异。
- Memory：把有效结论沉淀为 checklist、prompt 模板、AGENTS.md 建议或测试。

开放式群聊可以作为 P2 以后的一种展示形式，但底层仍应由这些可追踪 workflow 组成。

### 2. 默认把额度花在验证和沉淀

当前 Agent Review Workflow 已经符合这个方向：一个 Agent 产出，另一个 Agent 评审。后续应继续优先投入：

- 独立审查：事实错误、逻辑漏洞、边界条件、隐私风险、过度设计。
- 可运行验证：测试、lint、截图、API smoke test、来源核查。
- 复利资产：检查清单、回归测试、调试摘要、可复用 prompt。

不要优先做“让 Agent 继续聊下去”的能力。继续回合必须服务于更明确的检查或交付物。

### 3. 上下文是稀缺资源

Mission Control 不应默认把完整线程历史投递给另一个 Agent。跨 Agent 投递的输入应按隐私面从小到大分层：

1. `latest-agent-signal`：最近 Agent 输出信号，默认最小输入。
2. `thread-summary`：标准 thread 字段 + 最近用户/Agent 信号。
3. `latest-turn`：最近一轮 user -> final answer，且只对有稳定 transcript 边界的 provider 开放。
4. future explicit full context：必须由用户明确确认，并有更强的截断、预览和审计。

这和现有 review input modes 一致，应继续作为后续 workflow 的默认边界。

### 4. 人类审批放在关键门口

本项目应尽量减少每一步都打断用户，但必须在风险点保留人工确认：

- 把更多本地 transcript 交给目标 Agent 前。
- 写入第三方 Agent 原始状态前。如果未来做这件事，必须另立设计。
- 执行外部可见动作前，例如发消息、发 PR、发布、删除、购买、改生产数据。
- 自动把 review 结果交回原 Agent 并要求其修改前，至少在 MVP/P1 阶段让用户确认。

### 5. 每次 loop 都要留下可审计记录

Review job 已经记录了源线程、目标 Agent、模板、输入模式、状态、结果和 stderr。后续 workflow 应继续沿用这个方向：

- 每个 job 都有稳定 id。
- 每次状态变化可追踪。
- 结果和错误信息有长度上限。
- debug summary 默认只包含元数据和截断预览。
- 不修改 Codex、Claude、OpenCode 原始状态文件。

## 可落地的 Workflow 路线图

### P1 已做：Review Loop

目标：减少手动复制粘贴，让用户从线程详情页发起跨 Agent 评审。

当前状态：

- 支持目标 Agent：Codex CLI、Claude Code CLI、OpenCode CLI。
- 支持输入模式：`latest-agent-signal`、`thread-summary`、Codex `latest-turn`。
- 支持 review job 持久化、状态展示、结果复制、调试摘要复制。

继续优化：

- 增加 review 结果详情页。
- 支持从 review job 继续投递给另一个 Agent 复核。
- 支持 review job cancel / retry。

### P1/P2 候选：Fix Loop

目标：把 review 结果交回源 Agent，让其基于审查意见继续修改。

建议边界：

- MVP 不直接写入第三方 Agent 会话数据库。
- 先生成“可复制回源线程”的修复 prompt。
- 如果源 provider 支持安全 resume command，可提供“打开源线程 + 复制修复 prompt”组合动作。
- 后续再评估 non-interactive runner 方式，让 Codex CLI 在同一 cwd 上执行修复，但必须区分“审查 job”和“写文件 job”。

建议 job 字段：

- `sourceReviewJobId`
- `sourceThreadId`
- `fixTargetProvider`
- `fixPromptPreview`
- `status`
- `resultPreview`

停止条件：

- 相关测试通过。
- 或 runner 返回明确阻塞，需要用户介入。

### P2 候选：Parallel Review Loop

目标：同一份源输出并行交给多个目标 Agent，收集差异后汇总。

建议边界：

- 每个目标 Agent 仍是独立 review job。
- 增加一个 parent `reviewBatchId`。
- 汇总 job 只读取多个 review result preview 或完整截断结果，不重新读取源 transcript。
- UI 上按“阻塞问题 / 非阻塞建议 / 分歧点”展示。

适用场景：

- 重要技术方案。
- 大改动合并前。
- UI/UX 方案审查。
- 需求理解有歧义时。

### P2 候选：Memory Loop

目标：把一次有效 review 或修复沉淀成下次可复用资产。

输出形式：

- checklist。
- prompt 模板。
- AGENTS.md 建议。
- 回归测试建议。
- 项目内 docs 更新建议。

建议默认不自动写入 `AGENTS.md`。先生成候选内容，由用户确认后再写入，避免把偶然经验变成长期规则。

## 启动任意跨 Agent Workflow 前的检查表

- 交付物是什么：review 结果、修复 prompt、测试结果、汇总报告、checklist。
- 成功怎么判断：无阻塞问题、测试通过、来源充分、用户确认。
- 输入边界是什么：最近信号、线程摘要、最近 turn，还是用户明确选择的更多内容。
- 目标 Agent 是谁：Codex CLI、Claude Code CLI、OpenCode CLI，是否当前可用。
- 使用哪个模板：代码审查、技术方案审查、需求审查、回复质量审查，或后续新增模板。
- 观察信号在哪里：runner exit code、stderr、测试输出、截图、来源链接、人工反馈。
- 最多跑多久：runner timeout、job cancel、retry 上限。
- 这次能沉淀什么：调试摘要、检查清单、模板、测试、文档。

## 对当前实现的设计约束

- `latest-agent-signal` 继续作为默认输入模式。
- `latest-turn` 只对有稳定本地 transcript 边界的 provider 开放；不要猜 Claude/OpenCode 私有 cache。
- 目标 Agent 列表必须来自后端能力检测。
- 自动刷新不能覆盖用户在详情面板里的本地选择。
- 任何新 workflow 都不应默认读取完整线程历史。
- 任何会写文件或执行外部动作的 loop 都必须和纯 review job 区分，并有更明确的 UI 风险提示。
