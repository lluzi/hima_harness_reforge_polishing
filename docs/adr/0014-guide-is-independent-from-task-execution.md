---
status: accepted
---

# Guide 保持独立管家会话，任务使用独立执行上下文

用户于 2026-09-23 在需求澄清 R1/Q2 中确认：HimaGuide 是长期可返回、面向人的独立产品入口，收集信息并安排工作；每个执行任务和 Subagent 均有独立上下文，团队执行不干扰 Guide。Guide 派工后不转为该 Campaign 的执行会话，这样用户仍可同时询问、研究或准备其他工作。

复用既有 DSH 多会话和执行边界，不新增 Agent Loop。Campaign Agent 仍是对应 Run 的唯一业务 owner；本决定补充 ADR-0008 的会话职责，不改变其单 owner、显式授权与事实权威。Guide 收取哪些反馈、如何代传人类控制、跨项目保留多少上下文仍待后续访谈，不提前假定。

这是已接受需求，尚未实现。会话创建、上下文最小交接、失败恢复和 UI 接收者必须在相应切片验证；自动把所有执行 transcript 注入 Guide 不满足上下文独立的目标。[访谈记录](../specs/next-stage-clarification/interview.zh-CN.md)
