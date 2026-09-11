# [PLS-19] 由对话 Agent 执行节点，Fabric 提供约束与事实

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

GitHub: https://github.com/lluzi/hima_harness_reforge_polishing/issues/22

用户最新决定：同一个对话 AI Agent 是业务执行主体，它依据参考路线和状态实际执行节点工作并决定下一步。此前仅给自动 Fabric 添加外部介入接口的方案已被替代。

方向已接受，见 [ADR-0006](https://github.com/lluzi/hima_harness_reforge_polishing/blob/main/docs/adr/0006-conversational-agent-owns-business-execution.md)。具体节点协议、所有者/在途任务迁移和暂停策略仍需细化；本任务不声称代码已经实现。完整规格见 [Agent 执行与 Fabric 约束](https://github.com/lluzi/hima_harness_reforge_polishing/blob/main/docs/specs/polishing-v1/node-intervention.md)。

## 目标

对话 Agent 读取 Run/节点上下文，开始并执行节点内的研究、Coding 和工具工作，获得实际结果并请求完成，再决定下一业务动作。Fabric 保有接纳、依赖/权限/预算、Job 追踪、验收和事实权威。长作业不阻塞对话控制路径。

不能通过包装旧整图 `drive`、仅让 Agent 发起运行或只在少数节点另调一个模型来交付本任务。每个节点的介入能力也不依赖预先插入 Human Handler。

## 代码落点

- `tools.ts`、`commands.ts`、`remote.ts`、`index.ts`：Run 准备、节点查询/开始/完成/控制，绑定真正调用的对话 Agent，长作业及时返回身份。
- `fabric.ts`：从自主推进主路径中拆出单节点操作、可用动作和接纳/验收；禁止与 Agent 同时驱动一个 Run。
- `node-turns.ts`、`forks.ts`、`loops.ts`：复用实际操作和图合法性，不替 Agent 做未请求的业务选择。
- `jobs.ts`、`channel.ts`、`job-cap.ts`：保持实际执行与资源保障，支持可追踪的异步工作。
- `ledger.ts`、`runs.ts`、`recovery.ts`、`budget.ts`：所有者/版本/尝试、去重、Agent 恢复上下文和硬约束；恢复不能自动回旧循环。
- `workspace.ts`、`generations.ts`：与 PLS-11 的修订、历史、有效性衔接。
- `client/index.ts`、`client/HimaWorkbench.tsx`、`client/HimaRunCard.tsx`、`client/api.ts`、`card-labels.ts`、现有 dsh/Workshop 配置：同一对话 Agent 的真实执行和控制；避免再建独立执行主脑。

开工前固定快照、盘点 `drive` 入口和真正受影响的消费者，说明新旧 Run 的兼容与迁移。沿用已有组件不意味着该执行权调整没有架构或测试成本。

## 验收

- [ ] 一个 Run 的业务推进所有者唯一且对应左侧对话 Agent；查看其他 Run 不会悄悄更换所有者。
- [ ] Agent 实际执行节点内工作；没有下一次 Agent 业务请求，就不会由 Fabric 自动启动下一业务节点。
- [ ] 节点上下文完整，合法动作可查询；权限、输入版本、依赖与总预算在执行层生效。
- [ ] 节点完成由真实产物、观测和必需判断验证，模型伪报成功无效。
- [ ] 同一节点的重复/过时请求不会重复启动；控制交接后旧所有者无法继续推进。
- [ ] 长 Job 期间对话 Agent 可以处理工程师暂停、检查和修订指令；不仅是输入框可打字。
- [ ] Agent 中断后在途 Job 仍被如实追踪；新业务动作等待 Agent 恢复，重启不偷偷进入旧 `drive`。
- [ ] 修订历史保留，按 PLS-11 只重跑受影响下游；参考图及必需判断不被绕过。
- [ ] 当前旧模式在途 Run 有明确迁移/隔离方案，不出现两个推进者。

## 分级测试和依赖衔接

L0/L1 检查接口与状态；L2 以真实 Host/Job/文件和确定性 Agent 工具调用序列验证控制协议，主力覆盖竞态、重复、恢复、预算和错误完成声明。L3 保留同一对话/运行图的完整路径。L4 使用 DeepSeek V4 Flash 验证实际执行、反馈调整和中途人类指令。真实 EDA 与完整研究另做最小 L4 Site / PLS-18 验收。

PLS-08 交接时必须核对新职责；PLS-09 的研究工具/知识继续复用，但不再以另一个默认后台 AI 代替对话执行 Agent。PLS-10/11/12 的增长、有效性和预算使用同一执行协议。先完成受控纵向切片，再扩大复杂研究范围。

## 回滚和边界

不新建第二图引擎、模型驱动器或预算服务。旧代码不得忽略新模式所有者/暂停后继续执行；迁移方案需说明旧模式 Run 如何保留历史或完成收束。具体暂停默认策略仍是待定项，不影响已经接受的 Agent 主导方向。
