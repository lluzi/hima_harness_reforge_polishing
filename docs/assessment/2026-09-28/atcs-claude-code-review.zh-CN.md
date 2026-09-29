# ATCS Claude Code 开发与测试独立评审

评审模型：GPT-6 Astra，High effort  
评审方式：只读代码、Issue、Ledger、报告和服务器证据  
固定代码：`origin/main@11f20fa07dd4b6c8ac8b77d8479cd34c1c61f198`  
重点增量：`a389e64bad1004b19dea81e39bfc0af0a58b139e..11f20fa0`  
结论：**可恢复的系统性漂移**

## 总体判断

ATCS 的工具链和证据约束正在变得真实：Agent Team、受控 XTop Operator、Contribution、Innovus、StarRC、PrimeTime、adoption 和 experience 都产生过真实证据。当前方向没有失败，也没有发现必须立即回滚的 P0。

系统性问题在于交付前沿不断移动。#63 原本要求证明 Pack 可安装、可执行、可恢复和证据一致；#64 又把并行专家、blockers-first、auto-finish 和数值收益放到同一条关键路径。完整 Campaign 仍被用于发现 schema、引用、声明输出和预算语义问题，导致模型、EDA 和人类测试成本远高于这些缺陷应有的发现成本。

#64 的 PR #65、Pack 0.2.0 和 App `030efa9f` 属于晚于固定主分支的候选与运行证据，不应表述为 `main@11f20fa0` 已交付能力。

## 主要发现

### P1：#63 的交付门被 #64 的方法收益实验挤占

#63 的 ATCS-07/08 已经区分：

- `PACK_DELIVERABLE` 不要求 timing 改善；
- matched comparison 可以是 negative 或 inconclusive；
- 负收益不能撤销一个诚实、可安装、可恢复的 Pack 交付事实。

当前流程却把 native TEST、seal、release、最终 App 和 #63 closure 排在 #64 A1–A6 方法试验之后。结果是每次策略升级都会重新生成 Pack、wrapper、binding、App 和 Campaign，发布目标没有稳定终点。

应分别维护：

1. **PACK_DELIVERABLE**：固定范围、可运行、可恢复、证据可信；
2. **METHOD_EFFECTIVENESS**：并行专家方法、刷新次数、耗时和 timing 收益。

单 worker mechanics 可以作为受限版本的交付范围，但不能被写成原定并行方法已经完成。#63 总关闭仍需 ATCS-08 的同口径记录，结果可以为负。

### P1：完整 Campaign 仍在发现便宜层可以发现的问题

最新证据包括：

- `run-c0d9e672`：`decide-next` 只写 stdout，未写声明产物，却被标记 done；恢复后又暴露上游重试与下游 pause 互锁，以及通知没有唤醒 idle owner。
- `run-6de8b715-abe5-4543-b68a-5369063d7b12`：第一个计划有 **41 项 schema 错误**；约 24 分钟后 `ended-budget-exhausted`，没有 worker 执行。
- 该 Run 的 `generationLimit=2` 被两次 `revisit-research` 消耗。Harness generation 包含 Explore revisit，并不等价于两次物理刷新。

证据：

- `.hima-tmp/hltbf/issue64-live-01/STATUS.md`
- `.hima-tmp/atcs64-live02-030efa9f/L02 Data/dsh/storages/hima_ledger.json`

把下一次 Campaign 从 2 generations 改成 6，只会延后耗尽，不能证明“最多两次 refresh”。物理刷新必须有独立的 reader-backed count 和 cap。

下一次真实 Campaign 前，必须在固定候选上低成本验证：plan schema、citation contract、声明输出、失败恢复、revisit budget 和 refresh budget。

### P1：主分支 Team 仍是一次 sizing 审批，不是完整专家探索

固定主分支的 Pack 是 `0.1.10` development。有效路径仍以 w01 为主：Researcher 分析已有候选，Reviewer 选择一个，Operator 执行一个不可变动作。它证明了真实 child session、adoption、权限和受控 mutation，但没有证明多个专家围绕 blocker 反复诊断、试验、测量、undo 和 merge。

#64 的 reviewed scope、并行 Operators、blockers-first 和 auto-finish 是合理的恢复方向。但脚本化专家 dry run、六路 graph 和大量单元测试不能证明真实模型已经学会像 XTop 专家一样工作。

需要增加一个窄的真实模型门：固定 retained blocker/context，让一个 Operator 完成“诊断 → 合法选择 → 测量 → keep/undo/refuse”，并以 transcript 和工具事实解释知识如何改变动作。通过后再测并行和第二代反馈。

### P1：XTop 选择不劣不等于刷新后 PrimeTime 不劣

#64 后续设计在 XTop 预测层比较 merged expert ECO 与 plain auto-fix。这可以支持：

> 在固定 XTop 判据下选择不劣候选。

它不能支持：

> 刷新后的 PrimeTime 一定不劣。

重新布线和寄生变化可能改变 setup/hold。若只物理刷新被选中的 arm，没有两臂 implemented DB、new SPEF 和 PT，就不能做最终 non-regression 保证。

历史 serial round 1/2 是工程参考，不满足 ATCS-08 对相同 Harness/App、模型、预算、输入、工具和人工介入的 matched 要求。

### P2：候选 churn 有真实收敛，也发生过错误资格声明

| 运行 | 实际证明 | 停止点 |
| --- | --- | --- |
| fresh01 `run-5a5b8ba5…` | 全部 Team 角色、真实 XTop、诚实失败 | 目标 master 不存在；无 ops 时不能 capture no-fix |
| fresh02 `run-14e1ec47…` | 一次真实 sizing、Contribution、replay/presta、Innovus | StarRC 缺 `libtbb.so.12`；修复后在资格副本完成 extract/PT |
| fresh03 `run-b9946c06…` | Operator、Innovus、StarRC | Ledger `#000350`：`${MAX_PATHS}` 未绑定，停在 STA，不是完整 PT 闭环 |
| PR03 `run-1ca6cdd3…` | `postroute_final` 上真实 ECO→refresh→evaluate→adopt→experience | 无全局收敛；archive 失败 |

v8 曾安装仍含 `<REPLACE-…>` 的 wrapper 模板。正例只运行 verifier，负例因占位符拒绝，却被表述成 wrapper qualification。v9 从已安装版本派生，并增加 wrapper 自身正/负 preflight，才是正确修复。

因此版本增长不全是无效循环，但 identity 更新不能代替行为资格。候选矩阵必须写清每一层的精确 bytes 和实际运行范围。

### P2：两处 Harness core 修复具有通用必要性

`9f2e0bb4` 修复 revision-seeded Workshop code 没有 retained bytes，导致后续 archive 无法复现历史。修改保持在 workspace/node-turns/experience 的现有职责内。

`7e535183` 修复 required Team member 已结束但没有结果，固定 child identity 使 execution 永久 begun。通用 settlement 复用 retry、budget 和 Hard blocker，并排除已有 Job、未释放 interactive intent、旧 generation 和 advisory Team。

未发现这两项是 ATCS 专用 Runtime 分支。但 #64 后续若继续修改 hybrid parked settlement，必须围绕通用事实契约测试，不能按当前 ATCS graph 写特判。

## Timing 证据

把入口切回 `postroute_final` 是必要且正确的。旧 fresh01/02/03 使用已经优化过的输入，不能与原始基线混算收益。

PR03 只读服务器证据：

- Workspace：`/data/eda/project/hima_harness/atcs-runs/agentic-timing-closure-system-20260928-111631-cee9`
- 真实动作：`swerv_dec_tlu/g96219`，`CKAN2D2BWP35P140HVT → CKAN2D4BWP35P140HVT`
- Contribution：`391bd34c05766b161b5a`
- Candidate：`8c9174fb5a01439ce5f3`
- Evaluation：`a1d86706715a785ee7a9`

目标 `dec_tlu_perfcnt0[0]` setup slack：

- 125°C：`-0.0364 → -0.0214 ns`
- m40：`-0.1179 → -0.1002 ns`

该 action 对局部 setup 是合理的。但全局 setup WNS 为 `-0.1567 → -0.1576 ns`，hold WNS 保持 `-0.2016 ns`。局部收益没有移动全局 blocker。另有 1788 个 parent checks 超过 recheck 上限 200，fixed/missing-prior 仍为 unknown；`delivery=null`。

这证明 Manual ECO 与刷新链真实运行过，不证明全局收敛策略有效。

## 给 Claude Code owner 的执行指令

1. 停止用完整 Campaign 发现 schema、citation、binding 和 budget 语义错误。
2. 停止把 #64 timing 收益写成 #63 的发布门。
3. 停止把 XTop 选择判据描述成刷新后 PT 保证。
4. 保留全部失败 Run/Home、旧 wrapper、两套 baseline、raw PT/SPEF/DB、transcript、ops 和 archive failure；不原位修历史证据。
5. 固定一个 source/App/Pack/flow/Site/Permit/wrapper/binding/input digest 候选矩阵，只重跑 changed surface。
6. 下一切片只关闭 live02 的 pre-worker 合同：plan schema 示例、Reader/Host 反例、citation 可复现性、声明输出、revisit budget 与 refresh cap 分离。
7. #63 M2 只要求固定范围的 Pack、完整 Team/Contribution/lineage、一次刷新或合格拒绝、恢复无重复、experience/archive、native TEST、seal/release、最终 App 安装和 rollback。Timing 不改善可以通过。
8. #63 总关闭再补冻结的 ATCS-08 matched record；#64 单独报告 A1–A6。
9. 记录模型请求/token、owner/child 时间、Campaign 次数、EDA seat-time 和人工介入。

