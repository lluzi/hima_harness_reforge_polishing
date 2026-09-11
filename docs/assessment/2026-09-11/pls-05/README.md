# PLS-05：开始前的 Pack/Site 静态匹配与可靠表单

实施基线：`a9228de32b941f2658491c7ff32cba56c3542598`（已完成 PLS-02），源快照仍为 `b4ac9d9`。本切片在 polishing 下独立 worktree、独立 node_modules/lib 执行；未触碰 prototype 或旧 himaharness。任务规格：[PLS-05](../../../specs/polishing-v1/tasks/PLS-05.md)，GitHub [#6](https://github.com/lluzi/hima_harness_reforge_polishing/issues/6)。父任务负责合入后的独立验证与 Issue 状态。

## 复现与修改

- 空 home 原来只有空选择框，缺少准备说明。新增真实 Host 用例先失败，`red-empty.log`；现在区分没有 Pack 与没有 Site，并指明准备责任。
- 工作台原来读取策略时吞掉坏 Pack 错误，且不展示已有 `checkPack` 结果。沿用现有 Host `RemoteOperations`，将仅用于表单的 `packStrategy` 回调替换为一次读取 Pack/Site 的 `startPreparation`：加载阶段故障交给相应 Pack/Site 准备责任；检查阶段的意外错误仍由既有 Host 内部错误边界处理。没有新增检查器、服务或状态存储。
- 新表单通过同一个 `GET /hima/?pack=…&site=…` 显示静态匹配、绑定/wrapper/规则等诊断，明确未测试连接、实际许可证和工具。所有读取沿用现有 session/Origin fence；`Fabric.startRun` 原有最终重新加载和校验保持不变。
- `red-race.log` 在真实 Electron 中复现旧响应覆盖当前 Pack：选择已回到 `opene902-timing-probe`，策略却被延迟的 `second-probe` 响应覆盖。修复用请求序号和 Pack/Site 双身份核对，只应用当前响应。
- 到达时读取当前输入，同名同类型/单位数字保留原值；choice 仅保留仍在新选项中的值。参数是否合法继续由原服务端 validator 判定。输入焦点/caret 随兼容字段保留。请求失败有可行动提示，修正选择后可重试；提交期间有独立并发守卫。

实际生产改动仅在 `index.ts` 的 Host 绑定、`remote.ts` 的表单 choices、`workbench.ts` 的开始表单与脚本、`card-labels.ts` 的准备措辞。`packs.ts`、Fabric 和 Ledger 未修改。新增 HTTP route 数为 0。

## 验证

Node 24.20.0 / pnpm 11.25.0，独立安装沿用锁文件。所有测试使用临时 home、测试独占 tmux/socket 路径和 no-SSH guard；测试命令由 PLS-02 的显式文件组执行。

| 范围 | 命令/证据 | 结果 | 耗时 |
| --- | --- | --- | --- |
| L0 构建 | `pnpm run build`，`build-final.log` | 退出 0 | 构建日志保留，未单独计时 |
| L0 类型 | `pnpm run typecheck`，`typecheck-complete.log` | 退出 0 | 首轮 3.755 s；自审清理 type-only import 后复查未单独计时 |
| L0 seams / 清单 / diff | `seams-final.log`、`inventory.log`、`diff-check.log` | 均退出 0 | 清单 0.032 s / diff 0.015 s |
| L2 最终相关回归 | `pnpm run test:local --files test/contract/start-form.test.ts test/contract/view.test.ts test/contract/view-run.test.ts test/contract/pack.test.ts` | 35 通过 / 0 失败 / 0 跳过；SSH 0 | 37.548 s |
| L3 最终关键路径 | `pnpm run test:desktop --files test/contract/start-form-window.test.ts` | 2 通过 / 0 失败 / 0 跳过；SSH 0 | 12.595 s |

最终验证共 **37 个不同通过用例，其中 5 个新增**。新增 L2 覆盖空安装、坏 Pack、Site 配置问题、缺少绑定、wrapper/规则不匹配、HTML 转义、session/Origin 拒绝、页面后配置变化、参数拒绝无 Run/Job 与修正后正常运行。既有 Host 错误分类和 Pack 行为回归继续保留。

新增 L3 只用 2 个 boot 覆盖实际 Pack/Site 响应倒序、请求中继续输入、焦点保留、503 提示及重试、参数拒绝和修正提交、重复提交不产生第二个 Campaign。CDP 只通过测试 support 的可选 Chromium 调试端口延迟实际 Host 响应；没有新生产 eval/IPC API，也没有替换 Host/Fabric。含 red 和中途 green 的全部执行共 5 次 Desktop boot，分别保留日志；不把重复执行计作不同覆盖。

完整本地套件由父任务合入后运行，本 worktree 仅执行上述相关集合。未运行完整 Desktop 套件、真实模型、SSH 或远程 EDA，也未做视觉设计验收。无新测试框架、无通用 Goal 表单，当前 Goal 仍为已支持的 `target_period_ns` 数值语义。

精确退出码、通过/失败/跳过与日志 hash 见 [results.json](results.json)。前期 red 日志是预期失败证据，不是最终失败；中途 green 标为历史执行。

## 自审与回滚

自审核对了：输入/诊断 HTML 转义；静态匹配与真实就绪的措辞边界；请求/配置/内部故障区分；页面状态不授权绕过服务端校验；取消/恢复和报告区块未更改；清单新增 2 文件且每个只归类一次；原测试断言均保留。父任务将安排独立 review。

回滚此提交恢复原表单投影和测试支持即可，没有 Ledger/schema 数据迁移或 Site 文件修改。父任务合入 PLS-04 默认 Pack、PLS-07 报告改动后，应重新构建并运行相关 Host/窗口路径。
