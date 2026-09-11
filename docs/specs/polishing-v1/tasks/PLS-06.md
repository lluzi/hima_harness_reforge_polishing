# [PLS-06] 核验并打磨运行、阻塞、取消和继续的用户控制

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-03
Blocked by: #3

## 目标与开工条件

已有取消/恢复测试先按分级执行；没有反例时不修改生产逻辑。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/fabric.ts` | resumeRun / drive |
| `packages/harness/src/recovery.ts` | reconcileRuns / cancelRun |
| `packages/harness/src/remote.ts` | cancelOperation / resume 路由及 RunView |
| `packages/harness/src/card-labels.ts` | runControls / cancelAsked / cancelObserved |
| `packages/harness/src/workbench.ts` | 运行状态、错误及控制刷新 |
| `packages/harness/src/client/HimaRunCard.tsx` | 聊天卡片的同 Run 控制 |
| `test/contract/window.test.ts` | 既有交互用例 |

## 修改内容

1. 先记录从运行、等资源、阻塞、查看失败日志到继续/取消的有限使用路径；具体缺陷必须附复现和原因，每个原因独立补丁。
2. 用户看见原因、当前仍在执行的工作、可执行动作和动作后的实际状态；取消请求不等于 Job 已停止。
3. 继续使用既有 resume/取消记录，不能靠清理历史恢复；失败尝试日志可追溯，对话卡片与工作台指向同一 Run。

## 验收标准

- [ ] 取消与自然完成竞争、取消失败、恢复与重启竞争、分支一项阻塞而另一项仍在执行时，视图与真实 Ledger/Job 一致。
- [ ] 重复或不适用的操作得到可理解的结果，不能产生第二个不应启动的 Job 或把终态写回 running。
- [ ] 正常刷新不清空用户正在编辑的输入；拒绝后控件状态和提示允许用户继续纠正。
- [ ] 若既有实现全部满足，交付验证记录并明确无需代码修改，不能为完成任务制造重构。

## 分级测试

- L0 + L2：复用 fabric-restart/retry、view-run、jobs-unreadable 等真实 Host/local tmux 场景。
- L3：保留取消、阻塞后继续两条关键操作与一个 checkpoint 体验走查；状态组合不逐个走 desktop。
- L4 Site：只有实际修改远程 Job 恢复/kill/连接语义时触发最小真实检查。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不增加后台常驻服务，不承诺桌面关闭后继续驱动整个 Campaign，不预设所有现有行为都有缺陷。

## 回滚

每个复现单独 diff 回滚；Ledger/schema 若变更必须保留兼容读取证据。
