# 低成本验证

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§6「分支验证：以最低成本获得足够的提交可信度」及其检查/边界表；
  §9.2「物理变化如何反馈到提交」。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md`
  （2026-09-26 快照）§3「检查分三类，并规定何时不检查」；§4「评估与落地：允许有边界的
  不确定性」。
- `/data/eda/software/eda_tools/empyrean/xtop-2025.09.tmp15/utilities/post_verification/refine_xtop_eco_commands.tcl`
  （295 行，`192.168.50.41` 只读读取）：`refine_xtop_eco_commands` 的参数
  `update_timing`（默认不触发）、`margin`（默认 setup margin 0.0），说明 vendor 提供的
  refinement 示例默认不做增量 timing update，且以 sizing 为主要对象。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`
  （2026-09-26 快照）§7.2「PT Adapter」：预演与最终 STA 用不同输出类型防止混用。

## Applies when

- 一个 workspace 决定是否要为某个候选动作做 XTop before/after、PT 预演，还是直接进入
  实施前物理检查。
- M6 `plan_checks(merge_commit, policy)` 决定哪些检查是「必需正确」、哪些是「有条件的
  便宜诊断」、哪些只在采用/交付时统一做一次。
- Reader/Judge 判断一份 `precheck` 证据是否可以支持它声称的判断（`validationLevel`
  是 `none`/`xtop`/`presta` 中的哪一级）。

## Changes this decision

- **五层检查解决不同问题，互不替代：** 对象/库/操作校验只保证脚本改了预期对象、动作
  合法；XTop before/after 只是模型内观察，不是独立签核 STA；PT 预演扩大 path 采样但
  不能替代新拓扑/新 routing 的实际寄生；实施前物理检查只保证合法 footprint/位置/
  资源边界；针对性真实 probe 才为新机制、复杂 routing 等取得必要证据
  （ARCHITECTURE §6 表格）。任何一层的通过结论不能被写成上一层或下一层已经通过。
- **RC 建模无效时，预演结果是 unknown，不是「未测出问题所以算过」。** 对
  insertion/split 等改变拓扑的动作，PT 的新网寄生建模必须有效；vendor 提供的
  `refine_xtop_eco_commands` 示例主要针对 sizing 且默认不触发 `update_timing`——
  把它直接套用到 insertion/split 类改动上，不能视为已完成有效预演
  （ARCHITECTURE §6，`refine_xtop_eco_commands.tcl` 已核实的参数默认值）。
- **几何 diff 只能提示风险，不能唯一解释时序结果。** 前后 DB/DEF 差异给出实际移动的
  实例、重布的 nets 等，但大幅度层调整可能就是计划中的有效修复；观察必须分为
  「预期且兑现、预期但效果不足、未预期且有损、尚不能归因」四类，不能把「有大幅几何
  变化」直接等同于「引入新问题」（ARCHITECTURE §9.2）。
- **有条件的便宜诊断只在会改变下一步行动时才运行，且要与成本一起记录。** 若某项可选
  检查持续不改变行动、也没有发现预期失败，应降低运行频率或移除；共享缓存受输入/
  工具/配置身份约束，不能跨身份复用（OPERATOR §3）。
- **值得真实试验时不再用近似模型的分歧拖延决策。** 评价结果分「已知非法、模型内不利、
  证据不足、值得真实试验」四类；只对前置条件被证实违反的动作做硬拒绝；机制可解释、
  预算与恢复点具备时，可以直接付出一次有界实现取得真实证据，不必等所有近似模型一致
  同意（OPERATOR §4）。

## Counterexample

对一个 net-split/insert-buffer 类动作，若沿用「sizing 场景下 PT 预演已经足够」的经验，
仅用旧的、未覆盖新增网络的寄生估算跑一次 PT 预演，并把「没有发现新的负 slack」当作
该动作已通过验证的证据——这忽略了新增 net 的寄生尚未被有效建模，预演结果本应标记为
unknown。`refine_xtop_eco_commands.tcl` 的默认行为（不自动触发 `update_timing`，且面向
sizing 场景）恰好说明 vendor 自带的 refinement 路径并未对这类新拓扑改动做出承诺；
把这层默认行为的沉默当作「验证通过」，会让一个实际上未被验证的 insertion 提交被判定
为可信，直到后续真实实施暴露出未预期的 slack 回退才被发现。
