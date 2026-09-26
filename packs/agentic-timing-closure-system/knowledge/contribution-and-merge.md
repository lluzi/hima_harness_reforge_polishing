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
  即消失（XTop `undo.1`/`save_workspace.1` 已核实）；系统恢复必须依赖保存的 checkpoint
  和已确认操作清单重放，不能假定任意自动修复都有可用的逆操作（ARCHITECTURE §8.4）。

## Counterexample

ARCHITECTURE §10 的示例：任务 B 依赖共享 driver `U_DRV`（任务 A 的编辑对象）的当前状态
生成 sink buffer 方案 ΔB。集成 session 先重放 ΔA（driver sizing），此时 B 的原始前提
（driver 未加速）已经失效。如果直接把 ΔB 按「不同对象，可组合」归类并原样重放，就会在
一个已经改变了驱动能力的电路上应用一份基于旧驱动能力计算的 buffer 方案——这既不是
「独立性初始假设」的合法运用（ARCHITECTURE §4.1 已限定独立性只是初始假设），也不满足
ΔB 声明的成立条件。正确处理是识别出 B 对 A 存在隐式依赖，在 A 生效后的集成态上重新
计算生成 ΔB'，并保留原 ΔB 作为研究证据，而不是把三方比较简化为「对象未重叠即可合并」。
