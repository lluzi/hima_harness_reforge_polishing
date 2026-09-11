# [PLS-19] 为每个节点提供 Agent 可调用的运行介入接口

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

GitHub: https://github.com/lluzi/hima_harness_reforge_polishing/issues/22

来源：用户 2026-09-11 明确要求在观察运行图时，通过左侧 Agent 对指定节点暂停、检查输出、更新算法并继续。

状态：需求已明确，控制协议待细化。默认暂停是等待当前作业完成还是立即终止，已向用户提出建议并等待选择；不得将该建议当成已经接受的运行语义。

完整补充规格：[节点级运行介入](https://github.com/lluzi/hima_harness_reforge_polishing/blob/main/docs/specs/polishing-v1/node-intervention.md)。

## 目标和安排

每个节点均可准确寻址、检查并请求运行控制；图中选择能形成左侧 Agent 可核对的节点引用。Agent/UI 使用同一操作接口，返回接纳/拒绝以及实际生效状态。仅全 Run 的开始、取消和恢复不满足此任务。

基础控制先以确定性工具调用与 local Jobs 验证，不以真实算法研究效果为前提。实施前锁定 polishing/原型快照和重叠修改归属，沿用已完成的 PLS-06 与 UI-02；不拼接正在变化的原型工作树。PLS-09/10/11/12 的研究、附加节点、有效性和预算与此接口衔接；本任务不重做这些机制。

## 明确修改模块

- `tools.ts`、`commands.ts`、`remote.ts`、`index.ts`：节点查询、可用操作、结构化介入请求和结果查询，共用现有注册及围栏。
- `fabric.ts`、`node-turns.ts`、`forks.ts`、`job-cap.ts`：接纳边界与精确作用域，暂停生效后不启动受控范围内的新节点/Job。
- `ledger.ts`、`runs.ts`、`recovery.ts`、`budget.ts`：请求与效果记录、去重/过时请求处理、重启保留、预算及记录兼容。
- `jobs.ts`、`channel.ts`：明确终止时操作真实 Job；保持请求与实际停止分离。
- `client/index.ts`、`client/HimaWorkbench.tsx`、`client/HimaRunCard.tsx`、`client/api.ts`、`card-labels.ts`：节点引用、控制可用性、Agent 和图的同一事实反馈。
- `workspace.ts`、`generations.ts`：核对与 PLS-11 修订/有效性的交接，避免第二条绕过暂停的算法修改路径。

这是潜在消费者清单；开工设计须逐项说明实际修改必要性，不要求改满所有文件。

## 验收

- [ ] 已运行、正在运行、未来节点均可定位；kind/state 不允许的操作有明确原因。
- [ ] Run/图身份/节点/代际/Loop/branch/attempt 不能混淆；过时的“当前节点”请求不会误作用到下一次执行。
- [ ] 暂停请求接收、调度受控、仍运行/未知的 Job 与暂停实际生效能区分；不能把正常介入写成 Hard blocker。
- [ ] 已生效范围不产生后续新作业；未来边界已错过时不能谎报成功。
- [ ] 重复 UI/Agent 请求、与启动/取消/恢复的竞争和重启都保留正确作用域，继续不重复启动已有 Job。
- [ ] 暂停中的输出可检查，残缺/失败结果不成为有效判断；算法修订前有安全状态与输入身份依据，并交给 PLS-11 保留历史、重跑受影响下游。
- [ ] 左侧自然语言请求能转为生产工具调用；图与对话显示同一请求及其实际效果，不靠自然语言自称完成。

## 分级测试

L0/L1 覆盖寻址、状态和范围；L2 是主力，使用真实 Host/Ledger/local Jobs 测暂停前后、竞态、重复、fork/join、重启与预算。L3 保留选中 B→对话引用→暂停→检查→继续的一条完整路径。工具 schema/prompt 改动后用 DeepSeek V4 Flash 做小规模 L4；真实 EDA 的终止/检查点能力另做最小验证。完整人工介入研究的价值留给 PLS-18。

## 边界与回滚

不新增控制服务、第二图引擎或第二套预算。参考图不可改写/删除，判定结果不能由 Agent 任意指定；不把普通 Shell 操作自动当作 Fabric 介入。算法改变按既有回溯/有效性要求处理。新增记录与旧版兼容必须明确，旧代码不得忽略已生效暂停后继续执行。

本次只发布需求与待细化任务；没有实现或验收节点控制。
