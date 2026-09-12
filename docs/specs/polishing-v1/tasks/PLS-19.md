# [PLS-19] 由对话 Agent 执行节点，Fabric 提供约束与事实

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

GitHub: https://github.com/lluzi/hima_harness_reforge_polishing/issues/22

用户最新决定：同一个对话 AI Agent 是业务执行主体，它依据参考路线和状态实际执行节点工作并决定下一步。此前仅给自动 Fabric 添加外部介入接口的方案已被替代。

方向已接受，见 [ADR-0006](https://github.com/lluzi/hima_harness_reforge_polishing/blob/main/docs/adr/0006-conversational-agent-owns-business-execution.md)。本轮已在执行补充规格中细化节点协议、所有者/在途任务迁移和暂停的工程默认；开工时先验证 dsh 接口的要求已落实，实际实现和验证以 [本轮记录](../../../assessment/2026-09-12/pls-next/README.md) 为准。完整规格见 [Agent 执行与 Fabric 约束](https://github.com/lluzi/hima_harness_reforge_polishing/blob/main/docs/specs/polishing-v1/node-intervention.md)。

Blocked by: [PLS-20 / #23](https://github.com/lluzi/hima_harness_reforge_polishing/issues/23), [PLS-21 / #24](https://github.com/lluzi/hima_harness_reforge_polishing/issues/24)

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

- [x] 一个 Run 的业务推进所有者唯一且对应左侧对话 Agent；查看其他 Run 不会悄悄更换所有者。
- [x] Agent 实际执行节点内工作；没有下一次 Agent 业务请求，就不会由 Fabric 自动启动下一业务节点。
- [x] 节点上下文完整，合法动作可查询；权限、输入版本、依赖与总预算在执行层生效。
- [x] 节点完成由真实产物、观测和必需判断验证，模型伪报成功无效。
- [x] 同一节点的重复/过时请求不会重复启动；控制交接后旧所有者无法继续推进。
- [x] 长 Job 期间同一对话 Agent 能落实暂停和检查指令；修订未实现时明确回执而非阻塞或假成功。完整修订由 PLS-11 联合验收，不仅检查输入框可打字。
- [x] Agent 中断后在途 Job 仍被如实追踪；新业务动作等待 Agent 恢复，重启不偷偷进入旧 `drive`。
- [x] 提供与 PLS-10/11 共用的执行版本/修订接口；尚未实现的增长或修订明确拒绝，参考图与历史不被绕过或删除。完整受影响下游重跑在 PLS-11 联合验收，避免循环依赖。
- [x] 当前旧模式在途 Run 有明确迁移/隔离方案，不出现两个推进者。

## 分级测试和依赖衔接

L0/L1 检查接口与状态；L2 以真实 Host/Job/文件和确定性 Agent 工具调用序列验证控制协议，主力覆盖竞态、重复、恢复、预算和错误完成声明。L3 保留同一对话/运行图的完整路径。L4 使用 DeepSeek V4 Flash 验证实际执行、反馈调整和中途人类指令。真实 EDA 与完整研究另做最小 L4 Site / PLS-18 验收。

PLS-08 交接时必须核对新职责；PLS-09 的研究工具/知识继续复用，但不再以另一个默认后台 AI 代替对话执行 Agent。PLS-10/11/12 的增长、有效性和预算使用同一执行协议。先完成受控纵向切片，再扩大复杂研究范围。

## 本轮验收证据

状态：本轮实现与验收已完成。完整 local 377/377、安装态作者只读终检11/11通过；原始模型 finalization 的属性顺序比较失败记录保留，闭环由实际模型执行/发布事实和独立只读终检共同确认。详见[本批验收](../../../assessment/2026-09-12/pls-next/README.md)。

[批次验收](../../../assessment/2026-09-12/pls-next/README.md)汇总 owner/epoch/revision、去重与过时请求、显式节点动作、产物完成校验、Loop/fork/join、暂停/取消、硬预算、未知启动和重启的真实 Host/Job 证据，以及同屏原生对话 L3 和独立 Standards/Spec 审查。[离线 Ledger 导入](../../../assessment/2026-09-12/pls-19/ledger-import/README.md)保持 v19 原件，显式写入新的空 v20 home；导入不自动授予 owner，也不复制 Site/Pack/会话。

[DeepSeek V4 Flash 闭环](../../../assessment/2026-09-12/pls-19/live-workshop-3/acceptance.md)在同一 Agent 内通过 19/19 检查：实际在途 Job 暂停、显式继续、根据实际179选择 cutoff0，再读得200并由 owner 选择 goal-met；固定 Goal200，5个真实本地 Jobs。两个执行目录的算法字节相同，变化的是策略参数，不能声称算法创新或 EDA/Fmax 提升。`grow`/`revise` 明确拒绝至 PLS-10/11 交付；`inputDigest` 不是整个物理工作区文件树的 hash。

## 回滚和边界

不新建第二图引擎、模型驱动器或预算服务。旧代码不得忽略新模式所有者/暂停后继续执行；迁移方案需说明旧模式 Run 如何保留历史或完成收束。暂停默认采用停止新接纳并允许当前 Job 落下事实；显式立即停止才终止 Job。范围和状态见执行补充规格。

## 本轮有界实施顺序

1. 先固定生产者/消费者：Host 真实会话取得 owner，Ledger 持久化 owner epoch、control revision、node execution 与 request identity；所有突变入口复用同一接纳规则。
2. 完成两个普通节点的纵向场景：prepare 不调用 drive，Agent 显式开始节点、提交实际 Job、检查并完成，再显式选择下一节点；没有下一调用就没有下一启动。
3. 把 Workshop 的输入读取、知识读取、代码落盘/回读/hash、Job launch 能力交给同一个对话 Agent 使用；保留通用 Coding，受控 Run 的产物由实际记录确认。
4. 覆盖全部既有节点种类与 Loop/fork/join 的合法动作，确认不会在 helper 内隐式推进业务。增长和算法修订的完整语义由 PLS-10/11 实现，本任务必须提供版本接口并在未实现时明确拒绝；不得为赶本任务另写一份修订引擎。
5. 测试暂停/取消、owner 交接、重启、旧 Run 只读/收束与安全边界迁移；再做同屏 L3 和 V4 Flash 的小 L4 场景。

ready-for-agent 表示规格充分；PLS-20/21 依赖仍必须完成。每个阶段可独立提交并立即同步 GitHub，但两个普通节点的演示不等于整个 PLS-19 完成。
