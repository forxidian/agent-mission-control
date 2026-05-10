# Thread Artifact Detail Brief

更新时间：2026-05-10

## 背景

Agent Mission Control 已经是一个本地多 Agent 控制台，不是“还缺网页”的阶段。当前能力包括：

- 聚合 Codex、Codex CLI、OpenCode、Claude Code CLI、Claude Desktop Code、Claude Cowork。
- 展示线程、项目、token、quota、运行状态、待处理事项和通知。
- 支持 deep link / resume command / 站内待处理提醒。
- 前端每 10 秒刷新，后端 notification monitor 每 20 秒扫描。

这份优化不是要重做 dashboard，而是补一个“单线程工作产物 / 单线程审计页”的 detail layer：当用户点开某个线程时，不只看到状态和路径，还能看到这次 Agent 工作为什么值得处理、哪里卡住、下一步该怎么接。

## 目标

为每个线程提供更像 HTML artifact 的单线程详情视图，让 Mission Control 从“全局监控台”进一步变成“Agent 工作审计台”。

它应该帮助用户快速回答：

1. 这个线程当前处于哪个阶段？
2. 本轮从什么时候开始，是否还在跑？
3. 有没有 pending permission、todo、等待验收或新进展？
4. 最近一次用户输入和最终输出信号是什么？
5. token 消耗、quota、项目路径和恢复命令是什么？
6. 我能不能把这个线程的状态导出成一份静态 HTML/摘要，交给下一个 Agent 继续？

## 建议范围

优先做 P0，保持本地只读和隐私原则。

### P0

- 增强 `public/app.js` 的 `renderDetail(thread)`，让单线程详情从“信号列表”升级为结构化审计卡片。
- 不改变 `/api/dashboard` 的主体 shape，优先消费已有标准字段。
- 详情区至少包含：
  - 状态摘要：provider、status、project、model、updated、current turn duration。
  - 待处理区：pending tools、open todos、awaiting review/permission。
  - 运行证据区：rollout path / resume command / deep link / cwd。
  - token 区：today tokens、history tokens、last token usage。
  - 下一步动作：打开线程、复制命令、复制线程摘要。
- 增加“复制线程摘要”按钮，复制一段适合粘给新 Codex 线程的文本。

### P1

- 增加单线程 artifact 导出：
  - 前端可生成并下载一个静态 HTML，或
  - 后端提供 `/api/threads/:id/artifact` 返回 HTML。
- artifact 内容只包含本地元数据和必要信号，不泄露长正文。
- 可以借鉴 `12-incident-report.html` 的时间线结构，展示 thread lifecycle。

## 可借鉴的 HTML 模式

参考复杂状态型 HTML artifact 的通用模式即可，例如代码审查报告、事故复盘页、prompt 调优记录页等。不要在公开文档中提交本机绝对路径或私有示例文件名。

借鉴点不是视觉风格，而是：

- 复杂状态要分层展示。
- 证据和操作要放在同一页。
- 复制/导出按钮是回流下一轮 Agent 的关键。
- 单线程详情应该像一个“可交接的工作单”。

## 非目标

- 不读取或展示完整线程正文。
- 不重新启用桌面通知；当前发布版本只保留站内待处理。
- 不把 dashboard 做成营销页。
- 不引入重前端框架。
- 不绑定外部服务。

## 验收标准

- `npm test` 通过。
- 详情面板在没有 pending tools/todos 的线程上也保持清晰。
- “复制线程摘要”有测试或至少前端文案测试覆盖。
- 不破坏现有筛选、打开线程、复制命令和通知操作。
- 不提交、不回滚现有已修改文件。
