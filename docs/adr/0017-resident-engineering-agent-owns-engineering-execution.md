---
status: accepted
---

# 由驻场工程 Agent 承接完整工程任务

用户在 2026-10-02 的 Issue #82 设计访谈 Q1/Q2 中确认：以 OpenCode 支撑 HimaHarness 的通用“驻场工程 Agent”，让它获得能自主完成完整工程任务的工作环境，负责学习 playbook、分析、Coding、获准工具操作与内部协作；Hima 的工程对接 Agent 负责用户目标、材料、工作边界、沟通介入和成果验收。Fix Timing 是首个业务，目标是修复目标违例、输出脚本与完整工程交付，并超过一般 AutoFix 迭代；Q3/Q4 明确本轮以 XTop 内充分运用各种合理手段取得的修复效果为准，不把后续 Innovus/提取/PrimeTime 作为本次升级的前置验收；AutoFix 对照只判断修复效果，不以耗时、费用或模型/工具调用数决定胜负。XTop 优化结果不冒充最终物理签核。

选择完整工程委派，是为了让已有 Coding Agent 的自主学习、执行与组织能力真正进入业务，避免 Hima 再组织一套重复的细粒度修复团队。驻场工程 Agent 是通用角色，既不是只写代码的助手，也不由少量模型步骤或工具调用次数定义。原生 DSH 与 OpenCode 的 AB 比较不作为接入前置条件；对 AutoFix 的业务效果比较仍是用户声明的工程目标。

本文责任分工已由 Issue #82 的 task-local Host/Job/ACP adapter 与 ATCS 0.3.0 实现。Q5 进一步确认“驻场”只是能力称呼：有任务时启用，任务完成后释放，不建立长期项目主会话或常驻团队服务。它替换 Fix Timing 内层固定分支/Team/Operator编排；不自动授予 OpenCode 会话 Campaign owner 身份，也不替换 ADR-0008/0014 的用户入口、单一 Run 所有权、事实、权限与用户介入责任。同一任务内保留必要的对话与协作；结束后保留脚本、报告与执行证据。Q6 已确认尽力交付：在充分探索后仍有不可修残余，可以返回最佳实际状态、可复现脚本、残余分析与原因并结束任务；不得把未解决表述为已解决。是否还有合理可行的新方案由 OpenCode 自主判断，Hima 不以操作次数、固定尝试配额或必然全清要求代替工程判断。

用户进一步确认 Pack 作者也要适配工程外包能力：方法必须明确哪些工程节点可交给驻场工程 Agent，并写清该节点的目标、输入/上下文与 playbook、所需工作范围、工程交付及结果返回位置。工程对接 Agent 依照 Pack 的声明委派，接回同一节点的实际结果，不能把外包等同于节点或 Campaign 已成功，也不能由平台按 Pack 名称隐式硬编码外包。声明面向通用工程角色；OpenCode 是当前能力实现，其内部协作者与操作细节不重复写入 Hima 的节点编排。

## 实施后的边界修正与现场结论

现场冻结候选曾使用包装进程内的 provider broker、任务 token 和 ACP permission kind 关联。它帮助完成了第一次真实工程试验，但用户随后直接纠正产品方向：OpenCode 已是工程 executor，Hima 不再建设第二套账户代理或 permission-kind 安全策略。当前代码因此删除 broker/token/净化 profile 和 kind 投影，直接只读挂载 Site 既有 OpenCode config/auth，当前 native session 的 ACP permission 统一 allow-once；真正的边界是 task-local Podman namespace、Site Permit、固定 task/Run 身份和只读/私有目录。原生认证在 OpenCode 自己的执行环境中可见，不能再宣称对 OpenCode shell 隔离账户密钥；Hima 只保证不把密钥复制进 prompt、Host request、ACP trace或交付文档。该简化尚未重新部署或重新执行 live Run，不能借用旧候选的通过事实。

最终冻结现场 Run 证明了工程效果：普通串行 AutoFix 为 setup 24、hold 82；Resident 最佳状态为 setup 18、hold 0，setup WNS/TNS 也更优。OpenCode 使用一个长驻 XTop session 完成 Hold 清零，并只做一次最终 checkpoint reopen 验证。18 条 Setup 残余使 Goal 保持 false，且 global transition/capacitance/fanout 与物理签核继续 unknown。原 live test 因 Host 只落地 result JSON、没有接回 manifest 中的 checkpoint/support tree而 FAIL；后续 Host 修复在 Pack 声明的 `artifactPrefix` 下重建不可变目录树，由原 Reader 重算 tree digest。该 retained-artifact integration 证据不冒充新的 live end-to-end PASS。

包装进程丢失时，Host 仍通过固定包装入口核对并收束同任务保留的进程／容器身份，再记录 stopped 或 unknown；此路径只做收束，不重发业务 prompt、消息或 ECO。无法确认退出时继续禁止冲突工作。实际结果仍由原始工具证据和 Pack Reader 判断，认证可用、permission allow或进程退出都不构成业务成功。

Issue: https://github.com/lluzi/hima_harness_reforge_polishing/issues/82

## Issue #83 正常产品路径（2026-10-02）

用户曾增加效率目标，随后明确“我不关心时间，就看修复效果就行”。当前沿用本 ADR 的
修复效果比较，不以效率胜出为准入或完成条件。独立实际操作员通过 HimaHarness 正常 GUI
完成从准备到工程交付及结束的验证仍在范围内；不可由临时 graph entry、开发脚本创建
Campaign、注入已知 ECO 或后台直接执行工程业务代替。预先配置 Site/Permit/native auth
属于一次站点准备，须在候选中声明；操作员仍在 GUI 检查并选择真实 Pack/Site/输入。

复用现有 Pack、Site、Host/Job/Channel/ACP 和用户入口，不增加新的控制面。历史 Hold0/
Setup18 与 retained-artifact 接回资格各守原范围；原 frozen FAIL 不改写。质量和用户路径
分别给出支持证据，XTop-only 不冒充物理签核。有限 timebox 仅是资源和恢复边界。
具体冻结、正常步骤与回滚见[Issue #83 验收增补](../specs/resident-engineering-agent/issue83-acceptance.md)。

## Issue #83：明确 Timing 目标与既有结束机制

后续用户/DRI 明确当前范围是有证据的 Timing 修复效果和可用交付，不把未知 global collateral
当作已知 Timing 没有结果，也不因 UNKNOWN 补做一轮签核。ATCS 0.3.2 在 Pack 内增加 raw-verified
Timing-only 剩余值，保留原有 broader remaining/regression 与 unknown 语义并独立呈现。已知
回归继续限制整体质量/采用声明；Timing Goal-met 不代表这些检查通过。

现场还证实旧图在 Judge 后直接终止，没有 Explore 决定；既有 endRun 在没有 goalMet 决定时
默认 ended-goal-not-met。新图使用原有 owner-driven Explore 记录有证据的 goal-met 或 stop，
不改 Runtime 结束语义或旧 Run。完成回执的已有 JSON data 保留实际必需判据 ID，报告据此区分
声明 Goal 与额外引用的 broader checks；不新增 Ledger schema、控制面或报告实体。
