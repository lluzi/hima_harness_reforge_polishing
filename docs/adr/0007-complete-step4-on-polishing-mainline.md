---
status: accepted
---

# 在 polishing 主线接收快照并完成 Step 4

用户于 2026-09-12 选择：现在接收 prototype 已提交快照，在保留已交付 polish 的基础上由 polishing 完成剩余 Step 4；不再等待另一代码线完成正式 Pack 与整体验收。这把 ADR-0002 的阶段性并行开发安排更新为 polishing 负责当前后续开发，固定快照、源目录只读和独立验证责任继续有效。

首个接收点为 `ca47fa05ebe7417c23f0aebbb769db627bbf08a0`，已交付 polishing 基线为 `263a0739c45a420c158c46786fb82cea70c5ec44`。代码整合与执行职责迁移分开验收；正式 Pack、报告与 pilot 在 ADR-0006 的同一对话 Agent 执行方式上完成，避免在旧 UI/自动 drive 上重复交付。

后续实现者在 polishing 的任务分支协作；上游源码与其 Issues 作为只读来源。PLS-08 拆为当前快照整合和正式业务交接的递进完成点，缺少正式 Pack 不阻止接收已完成基础，也不允许只导入就宣称 Step 4 完成。详见 [接续规格](../specs/step4-takeover/spec.md)。
