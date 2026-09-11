# PLS-04：默认 Pack 的有依据探索方法

基线 `f0a5d4ab40ddb5f06894b13520bbeba6cea1bd96`，在独立 worktree 安装与执行；prototype 与旧 himaharness 保持只读。本文的真实 EDA/模型能力均未测试。

## 变化及原因

默认 `opene902-timing-probe` 方法版本从 1 升到 2，graph/contract 同步；`next-period` 改用已存在的 `over-constraining-push`，`stepNs=0.05`。节点、边、工具、reader、Judge 与 Fabric 未变；[结构核验](method-change.json) 确认拓扑原样。`local-site.ts` 仅补充一句结果是模拟数值的说明，不改 stand-in 的 `min(0, period-achievable)` 算术或 seeding 资产策略。

旧默认 PASS 分支依赖正 slack，而校准 stand-in 对满足约束的 period 给出零 slack，于是每代放宽 0.05 ns。PLS04 的首次 [red](red-default-binding.log) 保留了旧绑定与新需求冲突：20 pass / 1 fail。

旧方法被保留在明确命名的 `legacy-timing-push-probe` 变体，用当前 Pack 的输入/工具作对照；它不是伪装成原 v1 的历史快照。原 chooser YAML 和上游历史记录保持原样。默认 Pack 仍直接受命令、工具、HTTP、Pack check 和 local 桌面测试覆盖，没有把全套测试静默改回旧方法。

## 方法与证据边界

同一 stand-in，achievable=2.2 ns：

| 方法与条件 | 实际被断言的观测 | 结束 |
| --- | --- | --- |
| legacy timing-push，起点2.3，Goal2.0 | 2.3、2.35、2.4、2.45、2.5、2.55；slack均0 | generation-limit |
| 默认v2，起点2.3，Goal2.0 | 2.3、2.25、2.2、2.15、2.15；slack为0、0、0、-0.05、-0.05 | converged，Goal未满足 |
| 默认v2，起点2.3，Goal2.25 | 2.3、2.25；最后两项Judge规则均PASS | goal-met |
| 默认v2，起点2.0，Goal2.0，预算1代 | 只测2.0；下一策略2.15未运行；没有setup-PASS观测 | generation-limit |

第二行只有前3代是已测 setup-PASS，最紧已测通过 period 为2.2；2.15 的违例和 `period + abs(slack)` 推测都不能伪装成已闭合结果。没有有效观测时不产生“最佳有效结果”数字；本任务未新增第二套结果统计组件。

方法限制：若起点本来就违反 setup，如2.07 ns，v2会在2.15附近重复，可能即使Goal=2.3也收敛而没有一代setup-PASS。收敛仅是本Pack的period停止变化规则，不保证已找全可行解或全局最优。因此旧两代goal-met集成夹具改为2.35→2.30，保留它们原来要检验的两代记录/报告/恢复行为。未通过修改Judge/Fabric掩盖这一方法限制。

## 适配对账

| 原假设 | 本次适配与保留范围 |
| --- | --- |
| 默认chooser/bind为timing-push/guardBandNs | `fabric.test.ts`、`view-run.test.ts`、`fabric-restart.test.ts` 的同一命令/工具/HTTP断言改为over-constraining/stepNs，2.0违例的下一策略由2.25改成2.15 |
| 原Pack及派生Pack版本为1 | Pack/check/workspace/licence/live-check文字期望同步2；reader/rule/chooser版本仍为1 |
| drillDownGraph/forkGraph固定version1 | 共用明确的shipped方法版本2，保持复制的contract与graph一致 |
| two-knob变体替换guardBand字面量 | 只在显式variant中把当前step改为该自定义chooser所需guardBand，保留旧choice-knob语义 |
| over-constraining辅助函数替换旧default字面量 | 当前方法的命名副本；旧方法改用显式legacy helper |
| loop/experience的两代goal-met由2.07起步 | 调整输入为2.35，仍测第二代goal-met、记录、报告hash/恢复等原行为；不在产品中替换算法 |
| Step2/3验收固定旧chooser和guardBand算术 | 独立手写oracle改为PASS减step、FAIL加abs(slack)减step、双PASS结束；未从被测chooser求期望。仅类型检查，真实Site脚本未运行 |
| 默认窗口是手装method变体 | 用empty home + seed local启动实际默认Pack，检查模拟值标识与收敛/决策显示 |

## 验证状态

独立 frozen install成功，pnpm报告约4秒，复用本工作区已有store中的534包；不是全网冷下载计时。构建与类型检查通过。目标子集首轮 [输出](targeted-local.log) 为26 pass/1 fail，唯一失败是遗漏的派生Pack `@1` 文字期望；根因为方法版本已升2，已修复并纳入完整本地回归。

[命令、退出码和时间](results.json) 保存各次实际执行。完整 `check:local` 已通过：156 pass / 0 fail / 0 skip，命令总计490.166秒（含新build、Node/seam/typecheck）；local本身474.437秒，SSH尝试0。见[完整输出](check-local.log)。这是整组回归，约8分钟，不作为3分钟相关子集反馈承诺。

- [派生Pack审查](variant-check.log)：通过真实Host检查drill-down/fork/two-knob/legacy四种变体均fit@2；1 pass/0 fail/0 skip，1.780秒。[所执行脚本](variant-check-source.txt)为临时验证，原运行位置见results.json。
- [默认local窗口](default-window.log)：1 pass/0 fail/0 skip，26.427秒；单一bootDriver调用成功完成一个实际Electron窗口，无第二个窗口case。实际seed的默认flow睡眠长于PLS03专用fixture，此轮不宣称提速。
- 真实Site、远程EDA、模型、完整pilot未运行；改到文字/夹具的其余Desktop文件未全量执行。窗口验证只保留任务要求的一条路径，完整机制回归在L2。

## 集成责任与审查

PLS-03 基线中方法矩阵/窗口的27条断言表达式全部保留，当前34条，新增七条用于预算、有效观测与模拟标签；见[逐断言对账](assertion-mapping.json)。其他受方法版本或固定输入影响的断言变更见上述适配表，未删原用例。

页面/报告的通用demo来源说明由主agent在PLS05/PLS07合并后补入现有渲染位置；不能根据任意Site的名字或kind推断它是不是模拟。当前切片只证明PACK.md、raw qor的stand-in标识和seeding说明，尚不把这些当成可见页面提示已完成。真实来源声明/报告说明的这项合并责任已经明确交接给主agent。

主agent协调的独立Spec/Standards审查已完成，无blocker；仅修正negative-step用例遗留的guard-band注释，未改逻辑、未重复昂贵测试。工作台/报告的通用demo来源说明已由主agent在合并分支实现，其最终验证随主分支集成记录保留。

## 回滚

恢复本切片的Pack绑定与版本、说明、测试适配及两个验收脚本即可；无存储迁移，无新增架构组件。已有Campaign历史和未改原chooser保留。

## 主工作区集成补充

工作台静态检查说明与报告 limitations 已共用 LOCAL_DEMO_SOURCE，明确内置 demo 产生模拟报告，具体 Run 来源要看输入/原始报告；没有按任意 Site 的 kind/name 推断模拟身份。新报告 Host 用例已同步 2.35→2.30 的两代输入；合并后重点 26 例和完整 local 181 例通过。共享表单自动操作等待实际 fit 的衔接修正与最终视觉检查见 [批次记录](../pls02-07/README.md)。
