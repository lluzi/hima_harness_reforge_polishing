# [PLS-12] 让扩展研究遵守总预算并留出诚实收尾

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-06, POL-04
Blocked by: [PLS-07 / #8](https://github.com/lluzi/hima_harness_reforge_polishing/issues/8), [PLS-09 / #10](https://github.com/lluzi/hima_harness_reforge_polishing/issues/10), [PLS-11 / #12](https://github.com/lluzi/hima_harness_reforge_polishing/issues/12)

## 目标与开工条件

新研究/回溯入口齐备后，统一沿用现有 Budget，而非各自增加独立额度。

按 ADR-0006，对话 Agent 主导业务动作；预算检查、资源约束和硬停止仍由现有基础设施落实。Agent 中断不增加额度，也不能触发 Fabric 自动接管新的业务执行。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

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
3. 进入收尾后不再开始实验。到达硬界限停止 Campaign 作业并拒绝新的研究分析写入，只为该 Campaign 生成确定性的事实/缺失说明。按用户于 2026-09-13 的明确选择，对话仍可继续回答；到期后的对话内容不进入预算内研究成果。此预算不声称取消原生对话的模型请求。
4. 用户取消保留最高停止意图；文件归档失败独立显示尚未交付，由已有恢复机制补齐，不把 Run 终态伪装成已交付资产。

## 验收标准

- [ ] 在 Job、模型、回溯、附加节点前后命中预算边界时无超额新实验，已有活动工作按既定停止语义结算。
- [ ] 未执行的新策略、未完成的分析都明确记录；收尾 reserve 不被计算成额外预算。
- [ ] 取消、budget exhausted、converged 与 execution fault 不互相冒充；必要材料未生成不显示交付完整。
- [ ] 分支和 Host 重启不能获得新的总额度，保留正确的资源计量与实际停止状态。

## 分级测试

- L0/L1：边界算术和结束优先级，使用已有可控时间入口或短有限预算，不以长 sleep 模拟。
- L2：真实 Host/local Jobs + replay，测试边界、中断与记录；L3 只验一条预算提示/停止入口。
- L4 模型：真实小任务确认过期分析写入被拒绝、Campaign 停止后对话仍可回答；不把业务提交截止称为模型请求取消。L4 Site 只在远程终止机制有实质变更时做。
- L5：完整 Campaign 的预算与收尾投入对账。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不新建预算服务，不默认加入 token/货币计费平台，不把任何失败一概解释为策略错误。

## 回滚

旧 Budget 默认兼容；新字段/记录保留，恢复到旧版本前检查语义是否可读取。

## 研究写入边界

承接上游 lluzi/hima_harness_reforge_claude#81 的实际需求：Pack 为研究代码/材料声明有界文件数和字节额度，所有写入尝试按同一 Run/节点身份累计；重写、重试、附加节点不得刷新额度。达到边界拒绝后续写入并保留已落盘内容与真实记录。L2 验证临界值、重复写与失败回执；不新增预算服务。

## 对话截止决定

用户明确选择“停止 Campaign 作业与分析写入，保留对话继续回答”。当前 dsh 的公开接口
只提供整个 Agent 活动的取消，不能安全地按 Run 取消单个模型请求；因此不按 owner ID
中断可能包含其他工作的对话，也不新增隐藏 ModelMoment 或第二个 Agent。
本决定替代原文将原生对话生成本身一并纳入 Campaign 硬截止的表述。
