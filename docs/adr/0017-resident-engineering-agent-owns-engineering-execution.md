---
status: accepted
---

# 由驻场工程 Agent 承接完整工程任务

用户在 2026-10-02 的 Issue #82 设计访谈 Q1/Q2 中确认：以 OpenCode 支撑 HimaHarness 的通用“驻场工程 Agent”，让它获得能自主完成完整工程任务的工作环境，负责学习 playbook、分析、Coding、获准工具操作与内部协作；Hima 的工程对接 Agent 负责用户目标、材料、工作边界、沟通介入和成果验收。Fix Timing 是首个业务，目标是修复目标违例、输出脚本与完整工程交付，并超过一般 AutoFix 迭代；具体违例范围、最终判据和对照边界继续在该访谈明确。

选择完整工程委派，是为了让已有 Coding Agent 的自主学习、执行与组织能力真正进入业务，避免 Hima 再组织一套重复的细粒度修复团队。驻场工程 Agent 是通用角色，既不是只写代码的助手，也不由少量模型步骤或工具调用次数定义。原生 DSH 与 OpenCode 的 AB 比较不作为接入前置条件；对 AutoFix 的业务效果比较仍是用户声明的工程目标。

本文记录已确认的产品责任分工，尚未实现。它调整 Fix Timing 的内部工程编排，与 ADR-0016 的既有固定分支/Team/Operator执行方法需要衔接或替换；不自动授予 OpenCode 会话 Campaign owner 身份，也不替换 ADR-0008/0014 的用户入口、单一 Run 所有权、事实、权限与用户介入责任。驻场的寿命和上下文范围、与现有 Agent/Run 的映射、协议与持久化、目录及审批等仍待访谈决定。

Issue: https://github.com/lluzi/hima_harness_reforge_polishing/issues/82
