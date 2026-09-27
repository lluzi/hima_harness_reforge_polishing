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
- **资源换时间但不允许模型自行提高硬上限。** Site 提供有限、可见的默认预算；报告成本时
  与「更早获得合格数据库」分开陈述，不把资源消耗包装成方法学收益。
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
