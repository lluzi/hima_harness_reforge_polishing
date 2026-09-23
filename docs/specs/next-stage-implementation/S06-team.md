# S06 — Agent 合作合同与有界委派（NXT-C1 / C3）

状态：实施规格；基线 `1a79cb1514364aa049e775d7b18bbb063a223092`。本规格是 C1/C3 的生命周期、预算、权限与产物合同；child 的独立视图/transcript 由 C2/S08 消费，不能在此另造 team UI。产品决定来自 ADR-0001/0002/0006/0008/0009/0014、访谈 Q6/Q15/Q16/Q17 和 backlog。

## Problem Statement

已有 DSH 多会话/Agent Registry seam 是 side talk 的基础，`tools.ts:himaTools()` 和 `agentWorkspaceOf()` 已将工具按 Agent/workspace 接入；`fabric.ts:executionAction()` 已用 owner、epoch、revision、request identity、预算、暂停与 receipt 约束 Campaign 动作；`Ledger.runControl` 保存控制；`index.ts` 使用 `agent.followup()` 做 owner 提示。然而这些能力尚未被组成一个经过核查的专业角色/任务合同：没有已确认的 pinned 原生 spawn/follow-up/cancel/result API、子任务预算汇总、依赖/取消/回收语义或权限包。

结果是“Subagent 可真实 Coding/研究/操作”的产品目标容易退化为模型自述，或反过来把普通 Coding 权限错误扩大成 Campaign owner、Site Permit 或 EDA 操作权。本规格把可授权范围、实际生效配置、workspace、证据、取消和结果采用明确投影到已有 authority；不新建调度服务或第二 Agent Loop。

## Solution

C1 先资格化 pinned DSH 的原生 child session 入口及其真实可观察能力，再以 Host/Fabric 为单一调度与授权裁决者。拟议 `DelegationContract` 声明角色、任务、输入引用、工具/读写范围、总预算份额、依赖、关联 Run/节点、取消语义、parent/child identity 和结果接收者。实际生效值与建议配置分别显示。一个总 Campaign/任务预算是上限，child 仅领取份额，不能为每个 child 复制总额；CPU/许可证容量仍由 Site/Fabric 分开约束。

C3 以该合同提供 Coding、Researcher 与 Operator 的不同权限包。Coding 仅能在任务获准的私有 workspace 和方法范围修改脚本并产生 diff/测试证据；Researcher 可读/分析；Operator 仅在 F2/F3 已资格化的交互终端、已授权工具、工作副本、预算和单写者协议内执行。所有影响 Campaign 节点的动作仍经 `executionAction`，独立 child 的结果是候选，owner 或既有 Judge/验证路径才可采用。

## User Stories

1. Guide 创建 Analyst 子任务时，用户可看到实际角色、模型、工具、输入引用、预算份额和 parent；没有获得 owner 或 Site 写权限。
2. Analyst 完成后自动创建 Reviewer，Reviewer 只收到明确产物和引用，不能把 Analyst 的全部会话/客户资料隐式继承。
3. 两个独立 counter-analysis 在总预算和无许可证冲突时并行运行，界面显示总消耗；每个 child 都不能单独花完整父预算。
4. 用户直接给 child 补充委派范围内的指令，消息精确送到 child，并同步 owner；跨目标、预算、数据或权限边界的请求被拒绝或要求协调。
5. Coding child 修复私有工作区的算法脚本并运行获准测试，用户可查 diff、命令和实际结果；它不能改 Harness、已发布 Pack、工具安装、判据或 Permit。
6. child 返回旧输入的结果时，owner 看到 version/epoch 不匹配并不采用；不能把过期 child 冒充为当前任务完成。
7. 用户取消一个 child 时，只有该 child 与其获准操作收到停止；若底层 Job 不可确定停止，显示 requested/actual/unknown，不能误停 parent Campaign。
8. Operator 请求同一工具进程内组织下一条 manual 命令时，只有在 F2/F3 合格、工作副本和单写者 token 都有效时才执行；断连不得盲重发 ECO。
9. Researcher 给出有价值建议但未通过当前测量时，结果以候选和来源呈现，不能被写成 Judge verdict 或自动改变策略。
10. Host 重启或 child 归档后，用户仍可按稳定 identity 查任务、合同、结果与未知；不可用的原生 transcript/context 如实标注，不补写历史。

## Implementation Decisions

### 现有模块、符号与文件所有权

| 路径 / 符号 | 已核实责任 | 拟议增量 | 所有权 |
| --- | --- | --- | --- |
| pinned DSH Agent/Session APIs | 多会话/Registry 被 ADR-0008 作为复用 seam；静态确认 `AgentRegistry.createAgent(ownerCtx, CreateAgentOptions): Promise<AgentHandle>` 是公开入口，其他取消/结果/trace 语义未验证 | C1-a capability matrix 从该入口核实身份、parent、handle dispose、follow-up/cancel/result；不得以 UI 需求假定更多 native 事件 | C1 资格实施者 |
| `packages/harness/src/index.ts:Hima`, `agent.followup` | Host 配置、owner 通知、prompt/runtime 绑定 | 只接已核实的 child lifecycle/receipt bridge；Guide 不成为 owner | **主集成者** |
| `packages/harness/src/tools.ts:himaTools`, `agentWorkspaceOf` | Hima 工具注册与 Agent workspace 取值 | role-specific tool exposure、workspace identity 验证；无宽泛 shell/owner bypass | **主集成者**（共享） |
| `packages/harness/src/fabric.ts:executionAction`, `executionContext`, `controlling` | Run owner/epoch/revision、幂等、控制/节点执法 | child 请求回到既有 action；不得平行调度 Campaign 图 | **主集成者**（共享） |
| `packages/harness/src/ledger.ts:runControl`, `executionRequest`, `workspaceRecord`, records | durable Run/control/operation record | 仅在证据证明必要时添加 delegation reference/receipt；预算与事实仍归 Run | **主集成者**（共享） |
| `packages/harness/src/workshop.ts:workshopTools`, `workshopInstructions` | 受控方法工作区读写与知识 | Coding 的私有 workspace/文件边界；消费者为有合同的 child | Workshop 实施者 |
| `packages/harness/src/channel.ts`, Job/F2/F3 adapter | 本地/SSH 命令与交互 EDA 将走既有 Job/Channel/Fabric | Operator 只依赖 F2/F3 qualification；C3 不新增 terminal runtime | F2/F3 实施者 |
| `packages/harness/src/remote.ts`, `client/api.ts`, `client/HimaWorkbench.tsx` | host route/UI control projection | 仅显示实际合同/receipt；C2/S08 负责 session/transcript view | **主集成者**（与 S08 串行） |

可新增一个 `delegation` typed helper 仅当它由 `tools.ts` 和一个 Host route 共同消费且不成为服务；否则合同留在现有 Fabric/Ledger/tool 类型内。不得创建 scheduler daemon、team database、第二 runner、第二 permission system 或影子 execution graph。

### 合同：输入、输出、错误与顺序

拟议 `DelegationContract`：`{ delegationId, parentSessionId, childSessionId?, role: 'analyst'|'reviewer'|'researcher'|'coding'|'operator', task, inputRefs[], workspaceRef?, runRef?, nodeRef?, allowedTools[], writeScope?, budgetShare, dependencyIds[], recipient, status }`。实际模型/effort、工具、权限、预算和 workspace 必须与 `requested` 分开呈现为 `effective`；`childSessionId` 在 native spawn 成功前缺失。`DelegationResult`：`{ status: 'created'|'accepted'|'refused'|'duplicate'|'uncertain'|'completed', effectiveContract?, receipt?, artifacts[], unknowns[], reason? }`。

调度顺序：(1) 认证 parent/workspace；(2) 校验 role、输入 identities、合同格式；(3) 重读 Run owner/epoch、human hold、总预算、Site/许可证和依赖；(4) 缩减为实际可授予的工具/私有 workspace/预算；(5) 调用已资格化的 DSH child API；(6) 写 receipt/reference；(7) 仅将结果作为候选交给明确 recipient；(8) owner/Judge 依既有路径采用。错误优先级：身份/workspace 拒绝 → 合同格式/role 无效 → 输入/依赖不存在 → 权限/Site Permit/共享写入禁止 → human hold/owner/epoch/revision 拒绝 → 总预算/容量不足 → native API 不支持或 spawn 失败 → uncertain delivery。取消也必须按同一 identity 与 receipt 返回，未知停止不能转为 completed/stopped。

### 可执行子切片、依赖与并行

| 子切片 | 依赖 | 并行范围 / owner | 完成边界 |
| --- | --- | --- | --- |
| C1-a：pinned DSH lifecycle capability | 无 | 可与 S04 B1/B2、S05 M1 并行 | spawn/followup/cancel/reopen/context/trace 的公开 API 与反例 |
| C1-b：角色/预算/依赖合同 | C1-a；S04 B2 context address | 可与 C3-a 并行 | contract、effective 投影、总预算分摊规则 |
| C3-a：Coding/Researcher 权限 matrix | C1-b、Workshop 边界 | 可与 F2 qualification 准备并行 | workspace/tool/产物/验证限制 |
| C3-b：Operator contract | C1-b、**F2/F3 qualification 通过** | 不得抢先实施 | 单写者、checkpoint、transcript、unknown 规则 |
| C1-c：普通 child Host/Fabric/tool 接线 | C1-b/C3-a；S01 A1/A3 合同冻结；S04 Guide command consumer；仅需 S08 的**冻结视图合同** | **主集成者串行** | Coding/Researcher 实际 receipt、候选结果、无 owner bypass |
| C3-c：Operator 接线 | C1-c；F2/F3 qualification；S09 terminal consumer | 不阻塞一般 Coding child | Operator 的单写者/receipt/unknown 路径 |

## Testing Decisions

先执行最小 L2 Host 合同：`pnpm run build`，然后 `pnpm run test:local --files test/contract/side-talk.host.test.ts test/contract/conversation-execution.host.test.ts test/contract/agent-execution.host.test.ts test/contract/agent-controls.host.test.ts test/contract/agent-recovery.host.test.ts test/contract/agent-workshop.host.test.ts test/contract/agent-desktop-replay.host.test.ts`。这些现有文件分别覆盖 Side Talk/owner、受控工具、执行、控制、恢复、Workshop 与真实会话 tool result；C1 新增的 native child 资格测试只能在 API 被核实后使用真实 Host，不得以模型输出替代。

正例：Analyst→Reviewer 的依赖、两个无资源冲突 child 的总预算并行、Coding 私有 diff+测试证据、owner 经 `executionAction` 采用候选、Operator 在资格后按 checkpoint 执行。反例：每 child 获得全额预算；旧 epoch/输入采用；Coding 改共享 Pack/Harness/Permit；Reviewer 自动看父全历史；child cancel 停掉 parent；无 F2/F3 的 Operator 获命令；未知发送/停止显示成功；child 自述成为 verdict。UI 的接收者与状态显示才升级 L3：`pnpm run test:desktop --files test/contract/unified-workbench.test.ts test/contract/agent-execution.desktop.test.ts`。测试现在暂停，以上均未运行。

## Out of Scope

- 不实现 C2 的 transcript/context UI、S08 双模式导航或第二团队面板。
- 不实施 F2/F3 PTY/EDA adapter、真实 EDA 资格或泛化 shell 权限。
- 不替代 Campaign owner、Fabric graph、Ledger/Judge、Site Permit 或人类控制。
- 不保证任一 DSH provider 都保存 child context/transcript；不可用时显示缺失。
- 不恢复测试、执行 EDA/模型、安装依赖或改动 `tmp/`。

## Further Notes

资格核查可先派 C1-a：从已确认公开 `createAgent` 入口读取 pinned 版本、CreateAgentOptions/AgentHandle 的实际 identity、parent、dispose、follow-up/cancel/result 语义与反例；它不改 Host/Fabric。接线门禁仅针对 C1-c：上述最小身份/生命周期能力、S01 控制合同、S04 address 和 S08 冻结视图合同必须明确；没有可用 API，不能用新服务模拟后称原生协作交付。C3-b/Operator 严格依赖 F2/F3 的交互 terminal、真实隔离、single-writer、checkpoint 和独立验证资格，但不阻塞普通 Coding/Researcher child。Operator 写入及审计消费属于 S09/F2/F3 顺序接线。

回滚：合同/role 配置单独提交；撤销 child 创建/工具 exposure/projection 后保留 Ledger、workspace、Pack、Job 和既有 owner 控制，不自动删除用户或 child 产物。模型分配：C1-a/b、C3-a 用 `gpt-5.6-terra` / medium；权限、状态恢复、资产隔离、Operator 资格的独立复核用 `gpt-5.6-sol` / high；`index.ts`、`remote.ts`、`tools.ts`、`fabric.ts`、`ledger.ts` 与 `profiles/hima/cordis.patch.yml` 的接线由主集成者单一所有并按依赖顺序进行。
