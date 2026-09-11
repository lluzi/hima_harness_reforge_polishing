# [PLS-12] 让扩展研究遵守总预算并留出诚实收尾

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-06, POL-04
Blocked by: #8, #10, #12

## 目标与开工条件

新研究/回溯入口齐备后，统一沿用现有 Budget，而非各自增加独立额度。

按 ADR-0006，对话 Agent 主导业务动作；预算检查、资源约束和硬停止仍由现有基础设施落实。Agent 中断不增加额度，也不能触发 Fabric 自动接管新的业务执行。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/budget.ts` | timeBoxSpentAt / advance / retryStanding / nextGenerationAllowed |
| `packages/harness/src/fabric.ts` | drive / 终止与 writeExperience 调用 |
| `packages/harness/src/node-turns.ts` | 工具/探索调度前预算检查 |
| `packages/harness/src/job-cap.ts` | 现有并发/许可证控制 |
| `packages/harness/src/ledger.ts` | RunBudget/RunMeters 及结束原因 |
| `packages/harness/src/experience.ts` | 收尾/欠交付的恢复 |

## 修改内容

1. 回溯、附加支路与模型研究共享 Campaign 的时间、尝试、代数和 Site 额度；新增分支不能重置总体预算。
2. 为需要模型分析的 Pack 表达总时间盒内部的收尾预留：优先复用已接入的 Pack/运行参数；若必须增加 optional 预算字段，列出所有消费者并保持旧 Pack 默认行为兼容。
3. 进入收尾后不再开始实验；模型分析也须在总界限内结束。到达硬界限只生成确定性的事实/缺失说明，不绕过 Budget 继续模型或 EDA。
4. 用户取消保留最高停止意图；文件归档失败独立显示尚未交付，由已有恢复机制补齐，不把 Run 终态伪装成已交付资产。

## 验收标准

- [ ] 在 Job、模型、回溯、附加节点前后命中预算边界时无超额新实验，已有活动工作按既定停止语义结算。
- [ ] 未执行的新策略、未完成的分析都明确记录；收尾 reserve 不被计算成额外预算。
- [ ] 取消、budget exhausted、converged 与 execution fault 不互相冒充；必要材料未生成不显示交付完整。
- [ ] 分支和 Host 重启不能获得新的总额度，保留正确的资源计量与实际停止状态。

## 分级测试

- L0/L1：边界算术和结束优先级，使用已有可控时间入口或短有限预算，不以长 sleep 模拟。
- L2：真实 Host/local Jobs + replay，测试边界、中断与记录；L3 只验一条预算提示/停止入口。
- L4 模型：真实小任务确认工具取消/模型边界；L4 Site 只在远程终止机制有实质变更时做。
- L5：完整 Campaign 的预算与收尾投入对账。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不新建预算服务，不默认加入 token/货币计费平台，不把任何失败一概解释为策略错误。

## 回滚

旧 Budget 默认兼容；新字段/记录保留，恢复到旧版本前检查语义是否可读取。
