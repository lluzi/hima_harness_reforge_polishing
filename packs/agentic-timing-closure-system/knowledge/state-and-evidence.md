# 状态与证据

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§3.2「状态用途不可混淆」：四种状态（最佳已验证状态、继续工作的状态、
  Workspace 输出状态、集成候选状态）及其可支持的判断。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`
  （2026-09-26 快照）§3 M1 `flow/state.py` 的 Interface 与验收：
  「报告截断、负转正、scenario 缺失均不误报 fixed/clean」。
- 本 Pack `SPEC.md`（`packs/agentic-timing-closure-system/SPEC.md`）Semantics 章节：
  `tc_missing_prior_check_count`、`tc_fixed_check_count`、
  `tc_applicable_constraint_unknown_count` 等值语义。
- source-linked 反例（继承自 B_lazy 已跑通的同一 Foundation Flow 与 Run 证据，见本 Pack
  `INTENT.md` Business 章节「source-linked 反例」）：B_lazy Run
  `run-ddabd488-f05c-44d6-9c9b-45abccaff226`（endpointDelta `missing: 6`）；
  control arm workspace `qualification-v109-20260924-1535`（完整物理报告 DRC 72,799、
  connectivity 3,465）。

## Applies when

- M1 `capture(source_refs, query_spec)` 产出 `observation-set`，需要判定
  `coverage.complete` 与每个 scenario 的 `complete.setup`/`complete.hold`。
- M1 `compare_checks(prior, current, recheck)` 计算 `fixed`/`remaining`/`entrant`/
  `regressed`/`missingPrior` 时。
- 任何要引用 `workingState`、`bestVerifiedState` 或 `deliveryState` 之一作为下一步起点的
  决策（Chooser、Workshop 或人工复核）。
- 报告出现「精度不同（GBA vs PBA）」「覆盖度不同（完整流程 vs post-route-only）」的两次
  观察需要比较时。

## Changes this decision

- **四种状态各自只支持特定判断，不能互相替代。** 最佳已验证状态才可交付；继续工作的状态
  即使暂时退化也可以作为非单调探索的共同起点，但不冒充最佳或最终结果；Workspace
  输出状态只反映该分支工具模型内的效果；集成候选状态仍待物理验证。任何决策引用状态时
  必须先声明用的是哪一个指针。
- **端点从报告中消失，不等于被修复。** 一个 check key 在新报告里找不到，必须先判定是
  「身份丢失/未观测」还是「确实修复」，缺乏同身份负转非负证据时计入
  `tc_missing_prior_check_count`，不计入 `tc_fixed_check_count`。这是
  `check-comparison.missingPrior` 存在的原因。
- **报告截断不是数据的分母。** 覆盖度声明（`coverage.reasons`）必须记录报告本身的截断上限
  （如某报告在 1,000 条处截断），不能把截断处的计数当作总体真值,也不能拿另一个来源、
  另一个 workspace 的完整报告替换当前观察的分母。
- **file 存在不是状态合格的证据。** `tc_accepted_artifact_ready` 必须来自采用后的 DB/
  manifest/restore 关系核验，不能只按 checkpoint 文件名（例如包含 "closed" 字样）判断。
- **unknown 是唯一诚实的缺失表达。** Measure 只有 `known(value)` 或 `unknown(reason)`
  两种形态；证据不足、来源不明或身份不匹配时输出 `unknown`，绝不能默认写 `0` 或默认判
  `PASS`。

## Counterexample

Foundation 旧 connectivity 报告在 1,000 条处截断；同一 J3 对照实验里可比的完整物理报告
（DRC 72,799、connectivity 3,465）来自 control arm（人工/既定流程，workspace
`qualification-v109-20260924-1535`），不是 B_lazy 自身 Run 的字段。如果把 control arm
的完整数字直接当成 B_lazy 的物理证据，就会把两个分母不同、来源不同的报告混为一次连续
观察——这正是 `tc_applicable_constraint_unknown_count`（约束证据不充分）必须能识别并
拒绝的截断/来源错配输入，不是 `tc_final_identity_error_count` 能表达的问题。
