# Current method (Issue #66, Pack 0.2.3)

Use common native XTop analysis, one mandatory initial AutoFix, then post-auto residual analysis.
The Owner writes one concise `research/fix-strategy-risk.md`. Six Operators trial unique clusters in
private clones of that R1. The Campaign Owner then serves as active Timing Lead: it directs one retained
qualified Operator child in one persistent integration XTop session. Replay compatible Contributions,
measure and rebase, keep/undo, and add manual ECO under the Owner's direction. Return exact results per
coherent batch; keep the same child/session open until the Owner chooses the final candidate.

Export that cumulative final ECO directly to Innovus ECO route, StarRC, PrimeTime and DRC/connectivity.
There is **no final global AutoFinish** after the Timing Lead. Do not add internal control/merged-arm
arbitration, PreSTA or repeated compose/read/admit/judge gates. Existing dormant helpers and historical
examples describe earlier frozen methods and do not override this sequence.

Fresh strong C0 uses `workerSlots: 0`, the same external R0 and independently reproduced common R1,
then repeated default setup/hold GBA with re-observation until goal, no-change or its bounded deadline.
Both arms use the same 120-minute Run wall limit, 30-minute physical/closing reserve and one physical
refresh. The Pack method clock starts with baseline; Runtime retains the actual Run deadline. Report
actual Run wall time including preparation and the common stage. Never compare against historical C0.
Require matching R1 semantic state/worklist identities before interpreting a fresh comparison; retain
arm-specific raw workspace hashes and all tool identities. Native R1 timings are predictions. Only
refreshed per-scenario PrimeTime WNS/TNS and physical checks decide effectiveness. A tie or zero retained
manual benefit is NEGATIVE. Report additional seat/license hours separately.

## Earlier rationale (retained context, superseded sequence)

# 方法与对照基准

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_SPEC.md`（2026-09-26 快照）
  Goal template、Constraints、Run contract 章节：目标参数
  `target_setup_wns_ns = 0.0`、`target_hold_wns_ns = 0.0`，三个独立状态指针
  `workingState`/`bestVerifiedState`/`deliveryState`。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§1–§2：工程价值三来源（并行研究、集成前预验证、经验共享）；
  §16「实施路线：先证明协作合并的最小价值」。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`
  （2026-09-26 快照）§1「唯一主对照：lazy agentic migration from human flow」。
- Issue #66（2026-09-30）ATCS-09 规格 §D1（cluster 席位）与 §D8（`workerSlots 0` 对照臂），
  `tools/read-atcs.py` 的 `seat-clusters`。
- 冻结对照身份：`packs/xtop-timing-closure@1.0.14`，
  digest `19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92`
  （`docs/package-development/agentic-timing-closure-system/b-lazy-freeze.md`，本仓库，只读参考）。

## Applies when

- Campaign 开始时固定 Goal/Constraints，以及每次 Workshop 被问「这次改动是否已经足够」
  （对应 `next-decision` 产物、`tc_stop_required`/`tc_next_action`）。
- 报告 elapsed time、seat-hours、完整物理刷新次数等代价指标时。
- 任何试图把本 Pack 的执行简化为「单 Agent 反复调用 auto-fix，再加一段解释」的场景——
  即把协作合并方法退化为 B_lazy 的线性 flow。

## Changes this decision

- **主指标是首次获得合格交付数据库的 elapsed time，而不是脚本数、Agent 数或轨迹长度。**
  违例数、TNS、WNS 都只是解释过程的中间指标，不能替代 `tc_final_setup_wns_ns`/
  `tc_final_hold_wns_ns` 与覆盖完整性共同构成的合格判据。
- **对照是 B_lazy 整条链路，不是某一次局部改进。** 引用 B_lazy 数字时必须给出其 Run 身份
  （如 `run-ddabd488-f05c-44d6-9c9b-45abccaff226`）；缺 Run 身份的数字不得用于对照结论。
- **协作合并的价值来自把交互处理在便宜的集成层完成，只让确有物理不确定性的联合方案进入
  昂贵验证。** 如果一次实现把「多 worker 并行」等同于「多个分支各自跑完整流程后选一个」，
  说明已经偏离方法核心，应回到 Integration Fix Session 的设计（见
  `contribution-and-merge.md`），不是增加更多并行分支。
- **人工 ECO 是瓶颈消除，不是单点演示。** 每个专家席位拥有一个同因的 blocker cluster（共享
  startpoint 或 clock-enable 网络、层级、fail-reason 模式），在私有 XTop 会话中按最难优先逐点处理，
  交出一批改变全局 auto-fix 入口条件的协调编辑。`read-atcs.py seat-clusters` 给出至多
  `workerSlots` 个互不相交的候选 cluster；不设 endpoint 数量上限。
- **合格对照是同一 Pack 的 `workerSlots 0`。** 所有席位停放，分支全部走批处理空操作，组合不选任何
  贡献，批次只运行与处理臂相同的四遍 auto-finish。只有至少一个人工批次存活到最终 ECO，且刷新后的
  referee 优于该对照，才可声称人工增益；平局记录为无人工价值。
- **资源换时间但不允许模型自行提高硬上限。** Site 提供有限、可见的默认预算；报告成本时
  与「更早获得合格数据库」分开陈述，不把资源消耗包装成方法学收益。
- **完整物理刷新次数有 Run 级硬上限，即 Goal 值 `max_physical_refreshes`（默认 2，1–4）。**
  它由人在创建 Campaign/Run 时设定，Run 内任何决定都不能改变它。每次 Explore 回访都
  消耗一个 generation，无论是否刷新，所以 generation 上限不等于刷新上限。`implement` 与
  `apr-prepare` 之前各有 Judge 用 `refresh-budget` 核对账本中已完成的刷新数
  `tc_refreshes_completed < max_physical_refreshes`；用尽时 Run 停在 `wait-for-person`，
  该节点没有出边，清除后 Run 如实结束。需要更多刷新的人应以更高的 `max_physical_refreshes`
  新建一个 Run。
  选择 `implement`/`earlier-apr` 前先确认还剩一次刷新，并把它花在联合方案上。
  每个 generation 是一个研究批次加一次刷新（第一个 generation 也是，基线直接进入首个计划）。
  决定性实验只要一个 generation、一次刷新（#66 D9），所以本 Pack 声明
  `budget.minimumGenerations: 1`；刷新上限仍由 `max_physical_refreshes` 决定，用尽时如实结束。
- **timing closure 不等同于整芯 signoff 或 tapeout-ready。** 遗留的全芯 DRC/PG 问题（例如
  Golden Flow 记录的 72,799 条全芯 DRC）不在本 Pack 的整改目标内；报告合格状态时必须与
  「设计已全面签核」明确区分。

## Counterexample

Golden Flow（`AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md` §18.1 与本 Pack
`INTENT.md` Golden Flow 一节所引用的 SWERV28 Foundation Flow 状态链）显示：
第二轮 XTop ECO 回灌后，`func_ssg_rcworst_m40` 的 setup 违例数从 43 降到 12，
setup WNS 仍约 −0.04 ns，未达到 `target_setup_wns_ns = 0.0`。如果只用「违例数明显下降」
作为进度证据，就会把一次尚未闭合的中间结果误报为接近完成，掩盖了 hold WNS 从
−0.15 ns 变为 −0.16 ns 的局部恶化（重新布线和寄生变化导致）。正确做法是把违例数、
TNS 当作过程解释，只用固定的 `target_*_wns_ns = 0.0` 与覆盖完整性判定是否真正闭合。
