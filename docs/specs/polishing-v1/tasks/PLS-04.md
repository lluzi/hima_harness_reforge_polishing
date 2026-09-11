# [PLS-04] 让默认本地 Pack 使用有依据的 Fmax 探索方法

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-02
Blocked by: #3, #4

## 目标与开工条件

本地方法对照已具备；不依赖 Step 4。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packs/opene902-timing-probe/graph.yml` | next-period 的 chooser/bind/converge |
| `packs/opene902-timing-probe/contract.yml` | 方法版本与 graph 一致 |
| `packs/opene902-timing-probe/PACK.md` | 方法、结束含义与适用边界 |
| `packages/harness/choosers/over-constraining-push.yml` | 复用已有策略定义 |
| `packages/desktop/src/local-site.ts` | seedLocalSite 的默认样例说明 |
| `test/contract/support/pack.ts` | 保留旧 timing-push 的显式反例变体 |

## 修改内容

1. 把正常 local 样例定位为学习有依据的探索方法：默认参考 Pack 绑定已有 over-constraining-push 及其参数；检查现有方法版本规则并同时更新 graph/contract。
2. 旧 timing-push 的零 slack 放宽路径保留为明确命名的测试反例；既有 chooser 本身不删除。
3. 样例、页面/报告入口和说明中标明本地结果来自 stand-in；推测的可达 period 与实际完成且满足约束的测量分别表达。

## 验收标准

- [ ] 从 2.3 ns 出发，在 achievable=2.2 ns 的现有 stand-in 上，目标 2.25 ns 可达时正确 goal-met；目标 2.0 ns 不可达时正确 converged，不能宣称已闭合 2.0 ns。
- [ ] 旧 timing-push 反例仍按现有规则走到 generation-limit；新默认方法的成功不能靠改 Judge 或伪造正 slack。
- [ ] 所有所称“最佳有效结果”来自已运行且满足对应约束的观测；无有效测量时明确无数据。
- [ ] Pack load/check、命令/工具和桌面启动所用策略一致；方法变更与源快照差异有记录。

## 分级测试

- L0：Pack/schema 与构建。
- L1/L2：可达、不可达、代数预算截断和旧错误方法四类；在同一受控数据上对照。
- L3：一次默认 local 表单启动，核对方法与结束提示；不把四类反例全部走窗口。
- L4 Site：只有要声明真实工具方法效果或工具/格式变化时才运行；本任务不证明真实 PPA 收益。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不改 Fabric 的通用状态机，不迁入旧 himaharness 架构，不将零 slack 规律外推到所有设计/工具。

## 回滚

恢复 Pack 绑定和版本及相关 fixture；历史方法快照与反例保留。
