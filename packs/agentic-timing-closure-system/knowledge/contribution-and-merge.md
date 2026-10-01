# 贡献与合并

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§5「核心对象：ECO Contribution」及 §5.1–§5.3；§7「从 Git 类比到
  物理设计的语义合并」及 §7.1–§7.3；§8「Integration Fix Session」及 §8.1–§8.5。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`
  （2026-09-26 快照）§3 M3 `flow/contributions.py`、M4 `flow/composition.py`、
  M5 `flow/integration.py` 的 Interface 与验收判据。
- Git 官方三方合并说明（`AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md` §7 引用）：
  https://git-scm.com/docs/git-merge-tree ——仅借用共同祖先/分支/重放/冲突的类比词汇，
  比较对象在本 Pack 扩展为电路与工程条件，不是同一算法。
- XTop `write_design_changes.1`、`undo.1`（安装快照 2025.09.tmp15，见
  `xtop-capabilities.md` Source）：`-last_n` 边界与 manual undo checkpoint 生命周期，
  是本文「提交确定变更、不冒用重放」规则的直接依据。

## Applies when

- M3 `seal(base_ref, result_refs, operation_trace)` 从一个 workspace 的实际操作提取
  `contribution` 时。
- M4 `analyze(base_state_id, contributions, resolutions)` 做三方比较、判断
  `duplicates`/`conflicts`/`interactions` 时。
- M5 在 Integration Fix Session 内决定 replay 顺序、rebase、或生成
  `integration-plan.resolutions` 时。

## Changes this decision

- **提交必须携带确定的变更集合，而非可重新触发的搜索。** 一个 sizing 操作至少记录
  「哪个实例从什么 master 改为什么 master」；一个 insertion 记录原连接、插入 cell、
  新建对象和目标连接。集成时重放的是这份结构化 `delta`，不是重新跑一遍
  auto-fix——重新跑一遍可能得到另一组修改，不能再称为「重放原提交」
  （ARCHITECTURE §5.1）。
- **`write_design_changes -last_n` 只限制逻辑动作范围，不能用来推断提交的完整边界。**
  physical 输出仍可能包含所有历史变化；提交的 `touches`/`delta` 必须来自与共同基线的
  对象级差分，不能靠文件尾部或命令条数判断（ARCHITECTURE §5.2，`xtop-capabilities.md`
  已核实的同一约束）。
- **三方比较（基线值、分支目标值、集成当前值）决定合并动作，而不是简单对象名匹配。**
  集成当前仍等于基线：可重放；集成已等于分支目标：疑似重复，需核实依赖后去重；
  两者都不同：需要检查是否可组合或要 rebase，不能直接覆盖前者（ARCHITECTURE §7.1）。
- **四类组合关系需要不同的集成动作，不能一律「先来后到」处理：** 可直接组合的候选按
  确定次序重放；有依赖的贡献先确认依赖方生效后再重放被依赖方；可协商的交互需要联合
  分析并生成适配版本（保留原提交作证据）；互斥方案只能在冲突局部选择或重新设计，
  其余贡献继续保留（ARCHITECTURE §7.2）。
- **原子组不能只采用「看起来有益」的一半。** 一个联合 setup/hold 修复由多个操作构成时，
  声明 `atomicGroups`；若只采用某个子集，必须生成新的贡献修订及验证证据，不能悄悄
  丢弃另一半操作却沿用原提交的效果证据（ARCHITECTURE §5.3）。
- **rebase 后必须重新验证受影响的提交，不能只改 parent hash。** 基线更新为 B' 后，检查
  旧提交的读取前提、对象关系和影响范围是否改变，在 B' 上重新重放/验证生成 ΔA'；
  只有已核验不受影响的部分才能复用旧分析依据（ARCHITECTURE §8.3）。
- **`undo` 不能作为回退机制的唯一依赖。** manual ECO checkpoint 在关闭重开 workspace 后
  即消失（XTop `undo.1`/`save_workspace.1` 已核实）；系统恢复依赖公共基线的身份和已确认的
  操作/证据清单重放，不能依赖 worker 私有 saved workspace，也不能假定任意自动修复都有
  可用的逆操作。worker 交付的是可重放的 Contribution：typed commands、before/after dumps、
  ops/gain/read logs、clean close 与 ECO scripts/limitations；私有 DB 不是交付物或验收门。
  每个 downstream session 从该代的公共基线新建，再重放已接纳命令；不重开 worker DB。
  缺失或失败的 ECO export 在 commands/dumps 可重放时是显式 advisory/limitation，不能挡住
  Contribution、join 或 successor（ARCHITECTURE §8.4）。
- **post-route 网表是层级化的：action 和 editDomain 的 instance 必须是从设计 top 出发、
  `/` 分隔的完整层级路径（例如 `<inst>/<inst>/g96219`），绝不能是裸叶名。** 一个端点 pin
  的 owning cell 只给出叶名，它上面的路径来自实例化它的各级 module，要通过沿层级走
  module 实例化关系去找，而不能靠猜测或截断前缀（Issue #63 实测：`g96219` 声明在
  `dec_tlu_ctl` module 内，`dec_tlu_ctl` 又被上一级 module 实例化，一路到 top
  `swerv_wrapper`；把裸名 `g96219` 交给在 top 打开的 XTop 会话，得到
  `Cell 'g96219' not found in design 'swerv_wrapper'`，整个 Operator session 无效）。
  必须读取完整网表，绝不能只读截断的前缀。port 端点没有 instance，不适用本条尺寸
  （sizing）约束。
  Verilog 转义名（`\\name `）作为路径中的一段时，其内部的 `/` 是名字的一部分，不是层级分隔符。
- 一个 no-fix Contribution 只是不出现在 `select` 里，不需要额外声明；`resolutions`
  仅用于 composition facts 中已命名的冲突，`decision` 的形式是
  `<keep|drop|revise>:<contributionId>`，并带上该冲突自己的 `conflictKey`。

### 批量 Contribution 记录（#66 D4）

一个专家席位点对点处理自己的 blocker 簇：逐个试验、测量、不安全的立即 undo，最后交出
一批保留的编辑。`seal_session` 把这一批封成一个 `xtop-session` Contribution，在原有字段
（`commands`、`delta`、`touches`、`gainSummary`、`failReasons`、`value`、`valueDetail`）
之外再记录：

- `effectiveDomain`：会话写在 `ops.jsonl` 旁的 `domain.json`（`atcs-local-domain/1`）原样
  封入；缺失或不可读时为 `null`。封存的域检查读它的 `instances`（加上计划的
  `editDomain.instances` 和本会话以 `namePrefix` 新建的实例）；没有可用记录时退回计划的域，
  `session.domainSource` 写明用的是哪一个。派生域里的实例上保留的编辑因此被接纳。
- `commands[].gain`：该命令自己的 `gain.jsonl` 读数，按检查和场景分 `target`/`opposite`，
  增益相对它开始时那个设计状态的读数（`fromSeq`；undo 之后的命令相对 undo 恢复的状态）。
- `commands[].blockers`：该命令之后的读数里 slack 变好的目标检查（`atcs_point` 的
  `reads.jsonl` 行或 `atcs_gain` 探测的 top-N 表）。不需要 Operator 额外声明。
- `attempted`：至少读过一次的目标检查；`aggregateGain`：每个必需场景里目标检查族在会话
  参考与最后读数之间的 WNS/TNS 变化；`oppositeEffects`：对侧检查的同样变化。
- `physicalRisk`：`{legalFailures, newCells, newNets, moves, tainted}`；`undone`：撤销的
  试验数和它们的命令（各带自己的 `gain`）；`reads`：`reads.jsonl` 摘要（每行的 `seq`、
  `proc`、`args`、`rowsDigest`，供引用证据；读日志从不拒绝）；`limitations`：Operator 在
  `summary.json` 写的（`operator: ` 前缀在前），然后是封存自己的（`seal: `，例如没读过的
  目标、缺失的域记录）。

价值判断是 batch-net 的：`no-predicted-gain`、`breaks-target-check`、`breaks-opposite-check`
比较的是这一批最后的读数与会话参考，也就是整批保留命令的净效果，从不看单步。它们以及
`missing-gain-line`、`missing-export` 都只是 **advisory**：写进 Contribution 的
`advisories: [{code, detail}]`，从不拒绝这一批。例如任一必需场景里对侧检查的净 WNS 变差
超过一个舍入步（1e-4 ns）时，这一批照样 `admissible: true`，带 `breaks-opposite-check`
进入排序和重放；Operator 测到这样的一步仍应当场 undo，因为排名和最终 PrimeTime 都会算这笔账。

只有设计状态未知才拒绝一批（`admissible: false`，`refusals`）：`tainted`（会话没有正常
关闭，或设计状态未知）。`trace-mismatch`（命令日志解释不了前后 dump）和 `out-of-scope`
（改了域外的对象）自 #64 T06 起也只是 advisory（D-T06-7：重放是聚合器；T06 w01 的真实插入
被日志漏记，整批曾因此被排除）：这一批照样进入排序，重放在会话域内逐条尝试其命令；日志
不可解析、基线身份不一致在封存时直接报错。质量
的裁判是刷新后的 Innovus/StarRC/PrimeTime 结果加 DRC/连通性，不是封存前的证据门。

### 批次排序与聚合重放（#66 D5，#64 聚合决定）

`xtop-session` Contribution 是整批的专家修复。重放是聚合器，不是第二个方法裁判：组合
（`composition.analyze`）不在它们之间挑冲突，也不整批排除重叠的批次，而是给出
`facts.recipe`：先排序，再逐条命令标记跳过；每个完成的私有会话封存的 Contribution 都进入
排序重放。

- **排序。** `rankedBy` 是 `blockerCoverage desc`、`aggregateRankGain desc`、`value desc`、
  `id asc`。`blockerCoverage` 是这一批覆盖了多少个本批最差检查（和计划 Reader 同一个
  `covers` 规则）。`aggregateRankGain` 是封存的 `aggregateGain` 里每个场景的目标检查 TNS
  增益之和，加上 `oppositeEffects` 里每个对侧检查带符号的 TNS 变化；读不到的场景记 0。所以
  对侧 TNS 损失会压低排名，但不拒绝这一批。`value`（最差目标检查的 WNS 增益）只在总增益
  相同时才起作用。没有这两个字段的旧 Contribution 用 `valueDetail.rankTnsGain`；每个
  `recipe.sessions[]` 的 `gainSource` 写明用的是 `aggregate` 还是 `rankTnsGain`，
  `aggregateRankGain` 写出参与排序的数值。每个 `recipe.sessions[]` 还带 `advisories`
  （封存时的 advisory 代码），只供阅读，不影响是否重放。
- **重叠只跳过命令，不排除批次。** 没有 `domain-collision`：两批的域或对象重叠时都进入
  recipe。低排名批次里碰到高排名批次已改实例的命令标 `skip: shared-instance`（`sharedWith`
  写明是谁），依赖被跳过的新建对象的命令标 `depends-on-skipped`；其余命令在重放时按排名
  依次尝试，已不适用、出错或被工具包拒绝的命令记为 `skipped` 并写明原因，重放继续。
- **只有损坏数据才排除。** 被封存拒绝的批次（`tainted`）以其拒绝代码列在
  `recipe.excluded`；基线 dump 与多数不一致的批次以 `base-dump-mismatch`
  排除。
- **重放记录。** 每个会话的 `applied`（步骤 id）和 `skipped`（`{stepId, attempted,
  reason}`）；`arm-result.json` 与集成状态的 `appliedCommands`、`skippedCommands`、
  `protectedCount`。重放 delta 与 Contribution 自己的 delta 不一致（`replayMismatch`）、
  会话 dump 缺失（`replayDeltaMissing`）、重放改了会话域外的实例（`outOfDomain`）都只是
  `warnings`，从不让合并臂失效。成功重放的实例先 `set_dont_touch` 保护，再跑不变的四步
  全局 auto-finish。
- **合并臂与对照臂打平。** 组合只负责排序和逐命令跳过。XTop 里合并臂与只跑自动收尾的对照臂打平时，
  集成记录 `manualValue: none`：这一批的人工 ECO 没有带来可归功的价值，不能据此宣称收益。

## Counterexample

ARCHITECTURE §10 的示例：任务 B 依赖共享 driver `U_DRV`（任务 A 的编辑对象）的当前状态
生成 sink buffer 方案 ΔB。集成 session 先重放 ΔA（driver sizing），此时 B 的原始前提
（driver 未加速）已经失效。如果直接把 ΔB 按「不同对象，可组合」归类并原样重放，就会在
一个已经改变了驱动能力的电路上应用一份基于旧驱动能力计算的 buffer 方案——这既不是
「独立性初始假设」的合法运用（ARCHITECTURE §4.1 已限定独立性只是初始假设），也不满足
ΔB 声明的成立条件。正确处理是识别出 B 对 A 存在隐式依赖，在 A 生效后的集成态上重新
计算生成 ΔB'，并保留原 ΔB 作为研究证据，而不是把三方比较简化为「对象未重叠即可合并」。
