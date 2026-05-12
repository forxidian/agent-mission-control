# Agent Review Workflow Requirements

更新时间：2026-05-12

## 背景

Agent Mission Control 当前是本地只读多 Agent 控制台，已经能聚合 Codex、Codex CLI、OpenCode、Claude Code CLI、Claude Desktop Code、Claude Cowork 的线程、状态、token、quota、待处理事项和恢复入口。

用户现在的真实工作流里，经常需要让一个 LLM Agent 评审另一个 LLM Agent 的回复。例如：

1. Codex 在一个线程里生成实现方案、代码解释或最终回复。
2. 用户手动复制 Codex 的回复到 Claude Code。
3. 用户要求 Claude Code 评审 Codex 的输出。
4. Claude Code 返回评审意见。
5. 用户再手动复制 Claude Code 的评审结果回 Codex。

这个流程能工作，但非常手工、笨重，也容易丢上下文。用户希望把它变成一个本地的多 Agent 消息路由和评审工作台，接近“本地 LLM Agent 群聊”的体验。

## 目标

在 Agent Mission Control 中新增跨 Agent 评审工作流，让用户可以从一个 Agent 线程中选择需要评审的输出，并把它交给另一个本地 Agent 生成评审意见。评审结果应在 Mission Control 中沉淀为本地记录，方便查看、复制、继续投递或回到原线程处理。

一句话目标：

> 把“手动复制粘贴给另一个 Agent 评审”变成“在本地控制台里选择源线程、目标 Agent 和评审模板，然后自动生成可追踪的评审结果”。

## 用户意图

用户不是单纯想要一个聊天 UI，而是想减少多 Agent 协作时的人工搬运成本：

- 把一个 Agent 的输出交给另一个 Agent 复核。
- 用不同模型的优势互补：例如 Codex 更懂当前代码上下文，Claude 更适合审阅长文本或找漏洞。
- 在本地保留评审链路，知道“谁评审了谁、基于哪段输出、给出了什么结论”。
- 保持当前项目的本地优先和隐私边界，不把本机 Agent 状态上传到外部服务。

## MVP 范围

MVP 只做“单次跨 Agent 评审”，不做完整群聊编排。

### P0

- 在单线程详情页增加“交给另一个 Agent 评审”入口。
- 源内容默认使用该线程最近一条 Agent 输出信号。
- 用户可选择目标 Agent：
  - Codex CLI non-interactive runner。
  - Claude Code CLI non-interactive runner。
  - OpenCode CLI runner。
- 用户可选择评审模板：
  - 代码审查。
  - 产品/需求审查。
  - 技术方案审查。
  - 回复质量审查。
- 后端生成一次本地 review job。
- 评审过程和结果写入本项目自己的状态目录，例如 `~/.agent-mission-control/reviews.jsonl`。
- 前端展示 review job 列表、状态、源线程、目标 Agent、评审结果摘要。
- 前端只展示当前机器可用的目标 Agent；CLI 不存在或不可执行时，目标应显示为不可用。
- Review job 必须有超时和结果长度上限，避免任务永久 running 或把超长输出无限写入本地状态文件。
- 用户可以复制评审结果，手动粘回原 Agent 线程。

### P1

- 支持用户选择“线程摘要 + 最近 Agent 输出”作为评审输入。
- 支持读取更完整的最近 turn 正文，但必须有明确 UI 提示，因为这会扩大本地展示和传递的隐私面。
- 支持把评审结果作为新的 artifact 详情页展示。
- 支持从评审结果一键打开源线程。
- 支持“继续交给另一个 Agent 复核”，形成轻量链式 review。

### P2

- 支持真正的本地 Agent 群聊视图。
- 支持预设角色，例如 reviewer、critic、implementer、product reviewer。
- 支持多 Agent 并行评审同一输出。
- 支持自动对比多个评审结果并生成汇总。
- 支持更可靠的任务取消、超时恢复和后台任务监控。

## 非目标

- 不在 MVP 中写入 Codex、Claude 或 OpenCode 的原始会话状态文件。
- 不伪造或注入消息到第三方 Agent 的私有数据库。
- 不默认读取完整历史对话。
- 不上传任何本地线程数据到远程服务。
- 不在公开 demo、mock 数据或截图中包含本机真实 Agent 内容。
- 不重新启用系统桌面通知。
- 不引入重前端框架。

## 隐私和安全要求

- 默认继续监听 `127.0.0.1`。
- Review job 状态只写入 `~/.agent-mission-control`。
- 默认评审输入必须短且可预期，优先使用当前 dashboard 已经暴露的截断信号。
- 如果提供“完整正文”选项，UI 必须明确说明将把更多本地会话内容传给目标 CLI Agent。
- Review job 记录中应保存必要审计信息，但必须截断输入预览、评审结果和 stderr，避免无上限保存完整大段正文。
- 对外开源文档只能使用虚构示例。

## 用户流程

### 基础流程

1. 用户打开 Mission Control。
2. 用户选择一个 Codex、Claude 或 OpenCode 线程。
3. 用户在详情页点击“交给另一个 Agent 评审”。
4. 用户选择目标 Agent 和评审模板。
5. 系统展示将被评审的输入预览。
6. 用户确认。
7. 后端启动本地 CLI runner。
8. 前端展示 review job 为 running。
9. 评审完成后，前端展示结果。
10. 用户复制结果，或打开源线程继续处理。

### 示例

源线程：Codex 线程“实现 agent review workflow”

源内容：Codex 最后一条 final answer

目标 Agent：Claude Code CLI

模板：技术方案审查

生成 prompt：

```text
你是一个严格的软件工程审查者。请评审下面来自 Codex 的输出。

请重点检查：
- 需求是否理解正确
- 架构边界是否合理
- 是否有遗漏的风险
- 是否有更简单的 MVP 路径
- 最终给出可执行修改建议

来源：
- provider: Codex
- thread: 实现 agent review workflow
- project: agent-mission-control

待评审内容：
...
```

## 验收标准

- 用户能从任意支持的线程详情页发起一次跨 Agent 评审。
- 至少 Codex CLI 和 Claude Code CLI 两个目标 runner 可用。
- Review job 结果能在前端展示，并能复制。
- Review job 的本地状态文件不会写入原始 Agent 状态目录。
- 目标 Agent 列表来自后端能力检测，不由前端硬编码。
- 运行中的 review job 超时后会进入 failed，而不是永久 running。
- `npm test` 通过。
- 隐私文档更新，说明新增的 review job 会读取和保存哪些内容。
