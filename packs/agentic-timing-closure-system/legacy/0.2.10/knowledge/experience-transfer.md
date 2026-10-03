# 经验迁移

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§9.2「物理变化如何反馈到提交」（回退定位、组合效应非单调）；
  §12「Agent 在哪里体现不可替代的决策价值」第 5 条「学习真实响应」。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`
  （2026-09-26 快照）§3 M8 `flow/risk_experience.py`：
  「某个局部失败不被无条件泛化；模型精度变化不冒充风险恶化」。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md`
  （2026-09-26 快照）§7「何时判断成功，何时停止当前修复方式」：「同一输入、同一参数、
  没有新解释时不再重试」。
- 本 Pack `INTENT.md`（`packs/agentic-timing-closure-system/INTENT.md`）Business 章节
  「source-linked 反例」：−0.04 ns 出现在两处不同证据（Foundation Flow 第二轮回灌 vs
  B_lazy Run `run-ddabd488-f05c-44d6-9c9b-45abccaff226` 一次 generation）的舍入风险案例。

## Applies when

- M8 `record(lineage, decision, outcome)` 把一次决策的预测、实测和 verdict 写入
  `experience` artifact 的 `entries[]` 时。
- 下一次 Workshop 决定是否重试某个之前失败的动作、或是否把某个成功经验套用到新的
  stage/scenario/precision/tool 版本组合时。
- Chooser 判断一次预测（XTop/PBA 层面）与实测（重新 StarRC/PT 后）的差异是否要改变
  后续分工或批量大小。

## Changes this decision

- **经验条目必须绑定条件（`conditions{stage, scenario, precision, toolVersion}`），
  不能只记「这类动作有效/无效」。** 一次在 post-route、`func_ssg_rcworst_m40`、PBA、
  XTop `2025.09.tmp15` 下失败的 hold-buffer 动作，不能被直接泛化为「hold-buffer 动作
  无效」，因为条件变化（不同 stage、不同 corner、不同精度）可能改变结论
  （HIMAPACK_DEVELOPMENT_SPEC §3 M8 验收）。
- **预测与实测的差异是学习对象，不是噪音。** 一次动作的 `predicted`
  （xtopSetupWns/xtopHoldWns/prestaSetupWns/prestaHoldWns）与最终 STA 实测之间的差距，
  应该改变后续的分工、候选生成和批量策略，而不是被平均掉或忽略
  （ARCHITECTURE §12 第 5 条）。
- **同一输入、同一参数、没有新解释时不再重试。** 一个之前失败的动作只有在新证据改变了
  其假设（不同端点家族、不同 RC、不同 opposing margin、不同有界 effort）时才可以
  重试；否则重复同一失败动作不产生新信息，应当计入「不再值得继续」的证据
  （OPERATOR §7）。
- **一次局部/联合结果的回退不能让所有相关提交都被判定为失败。** 需要先定位交互组，
  保留不受影响且仍满足当前条件的研究结论；对必要子集做重放/反事实实验；组合效应
  非单调时，简单二分排除法不能据此认定唯一责任提交（ARCHITECTURE §9.2）。同理，
  基础设施/工具/输入问题导致的实现失败，不能被写成某种 ECO 方法本身无效的经验。
- **两个足够接近的数字不能被当作同一次观察的直接反例，也不能因为接近目标就向达标
  方向舍入。** 一个数字必须先核实来源（哪次 Run、哪个 generation、哪个报告）才能作为
  经验依据；跨来源的巧合数值相似不构成因果证据。

## Counterexample

`INTENT.md` 记录的舍入风险案例：−0.04 ns 这个数出现在两处不同证据里——Foundation Flow
自己第二轮 ECO 历史回灌后报告的 SSG −40 setup（该角 setup 数量 43→12），以及 B_lazy
Run `run-ddabd488-...` 自己一次 generation 前后均为 −0.04 ns/12 违例（该 generation
内未改变）。如果把这两个数字当作同一次连续观察的证据链，就会误判 B_lazy 在那次
generation 内取得了 Foundation Flow 同等的改善，进而把一次「未变化」的经验错误地
记录为「有效」；同样，如果 Chooser 因为 −0.04 ns「已经很接近 0」就向达标方向舍入，
会掩盖两者其实都尚未达到 `target_setup_wns_ns = 0.0` 的事实。正确做法是分别核实每个
数字的 Run/generation 来源后再决定它能支持哪条经验。
