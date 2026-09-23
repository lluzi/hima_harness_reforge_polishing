---
status: accepted
---

# Campaign 与 Data Insight 是同级工作模式

用户于 2026-09-23 明确：Start 和工作区同时提供 Campaign、Data Insight 两种同级入口；Agent 收到 Library 分析需求时展示 Data Insight panel。沿用现有对话、Workbench/dock 和视觉体系，不能把 Data Insight 仅做成 Campaign/Live Run 的子页，也不重新建设一套 BI 应用。

这是用户任务与导航层级的决定，不替换 Campaign 业务实体或 DSH 的 Standard/Code 等工具组合，不引入第二执行或事实系统。已有报告可独立打开而不创建空 Campaign；需要计算/验证的工作继续使用现有受控执行能力，按需关联执行详情。切换面板不改变 owner 或任务状态。

ADR-0012 的三个 Library 分析任务继续作为 Data Insight 内部的业务组织。独立 Subagent 会话、文件、终端和证据是两种模式共同可达的工作视图，不作为第三种产品运行模式。需求与验收见 [工作区和 Subagent 方案](../specs/workbench-modes-and-subagents/spec.zh-CN.md)。本决定尚未实现。
