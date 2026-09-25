# S05 — 可核查的工作记忆与经验采用（NXT-M1 / M2 / H3）

> **2026-09-25 现行状态：Wave 2 PASS。** Work Memory 已绑定 native retained-prefix/current-surface identity、完整 Run-row authority identity、record cursor 与当前 Run/Job/hold/report projection；缺少项目 identity 的历史不能自动采用。Experience disable/re-adopt 和 bounded child handoff 均为 append-only/durable，且已通过 compact、Host restart、follow-up 后旧 handoff、human hold、Job completion、correction retention 与 cross-workspace refusal。证据见 [Wave 2 receipt](../../assessment/2026-09-25/next-stage/wave2-vertical-slice.md)。下文“拟议/未运行”是原始实施规格，不再表示当前产品状态。

状态：实施规格；基线 `1a79cb1514364aa049e775d7b18bbb063a223092`。M1 是资格核查先行切片；M2/H3 的字段均为拟议增量，不能因本文件出现而被称作已持久化。约束来自 ADR-0001/0002/0004/0008/0014/0015、访谈 Q4/Q5/Q10/Q14/Q18 与 backlog。

## Problem Statement

当前产品已有多种但不同用途的持久材料：`Ledger` 保存 Run、控制、记录与 Archive；`experience.ts` 写入 Experience/Run assets；`workshop.ts` 有受控知识索引与 `knowledgeForWorkshop()`；Pack archive 保留方法关联资产。`index.ts:himaRuntimeContext()` 则每回合重算极小 inventory。当前源码没有证据证明 pinned DSH 的 Session log、compaction、SessionQuery 或 context 注入可公开读写成可恢复的 Hima long-term memory，也没有证明其 retention、scope 与 child lineage 满足本需求。

因此长对话 compact、Host 重启、owner handoff 和 child 完成后，用户目标、明确决定、待办和来源未被定义成可追溯且重新核对 authority 的摘要；历史经验也需要能按设计/工具/版本条件候选引用、被用户停用并保留更正，不能覆盖当前指令或测量。

## Solution

先执行 M1：以一张能力/保留期/作用域/恢复路径矩阵和最小反例核查 DSH 与 Hima 现有载体。M1 的结论可以是“不支持写 Session 事件”；这是合格结果。只有经核实的公开接口才可成为 M2 的 carrier。

M2 在现有 Session、获准 workspace 文件、Ledger/Knowledge/Archive 引用内装配**拟议** `WorkMemorySummary`，按 `session`、`campaign`、`child` 区分 scope。它保存目标、已确认决定、未决问题、待办及来源引用/生成时刻/版本/采用状态；恢复先重读 Run/Job/控制，再让摘要协助理解。摘要永远不能解除 human hold、启动 Job、确认 owner 或替代测量。

H3 复用 `Knowledge`、`experience` 与 Pack archive 把经验作为有条件候选。用户停用时追加 correction/supersession 引用，保留原审计材料；检索、compact 和重开不再自动采用旧结论。重新采用必须显示新依据；被 Pack owner 确认的发布仍走 G3，记忆不直接修改活动 Pack。

## User Stories

1. 用户的无 Campaign 长对话经过 compact 后回来，Guide 能看到目标、明确决定、待办和引用；没有可用原生持久化接口时明确显示缺失，不能假装恢复。
2. 12 小时 Campaign 在中途 compact 后恢复，摘要提示当前节点与最近证据，但恢复前先从 Ledger/Job/控制重读事实。
3. 旧摘要建议继续而人类已暂停时，系统保留摘要但拒绝自动推进，并说明 hold 的权威来源。
4. Job 实际已完成而摘要滞后时，当前 Job/observation 优先；摘要标为 stale，不能再派同一 Job。
5. 用户切至相同 Site 的另一工作区，材料不会自动串入；只有明确引用的跨项目资料才可作为候选，且保留引用理由。
6. child 完成后，parent 得到最小交接：任务、输入引用、结果、未知与产物；不能把整个 parent transcript 复制给 child 或反向混入。
7. 用户说“不要再采用这个经验”，经验变为 disabled，保留原证据和更正；compact、检索、重开后都不得复活旧建议。
8. 用户希望重新采用已停用经验时，界面显示原来源、适用设计/工具/版本、停用理由与新的验证依据，用户可评估后采用。
9. 两份同名但版本不同的报告同时存在时，摘要/检索以 identity 和 hash/版本区别，不能按文件名合并。
10. 新方法从经验中得到启发时，经验只给候选；当前测量与 Pack owner 的确认前，不能写入活动 Pack 或报告为已验证成功。

## Implementation Decisions

### 现有模块、符号与文件所有权

| 路径 / 符号 | 已核实能力 | 拟议增量或核查职责 | 所有权 |
| --- | --- | --- | --- |
| pinned DSH package：Session log/compaction/SessionQuery/context injection | 能力、写入授权、保留期和 child lineage **尚未被本次源码核实** | M1 必须以公开 API、版本、最小反例登记 capability；不可直接写 Session 文件 | M1 资格实施者，单文件调查/测试 |
| `packages/harness/src/index.ts:himaRuntimeContext` | 每轮动态 inventory，不是长期 memory | 仅在 M1 资格通过后读取 summary 引用；不能承载第二 inventory/fact store | **主集成者** |
| `packages/harness/src/ledger.ts:sessionRecord`, `knowledgeRecord`, `archiveRecord`, `RunRecord`, `Ledger` | 已有持久 record/Run authority | M2/H3 只引用其 identity；若新增 schema 必须证明现有 record 无法表达，迁移/兼容由主集成者 | **主集成者**（共享） |
| `packages/harness/src/workshop.ts:knowledgeForWorkshop`, knowledge index/search, `campaignKnowledgeScope` | 有界知识读取、索引、Campaign scope | 检索候选附 scope/来源/条件/状态；不把总结塞入无限 prompt | Knowledge 实施者；共享工具注册由主集成者 |
| `packages/harness/src/experience.ts:writeExperience`, `experienceOf`, `RunKnowledgeCandidate`, `RunKnowledgeList` | Experience 与历史候选资产 | H3 条件、停用/更正、重新采用 evidence 的投影；原始资产不删 | Experience 实施者 |
| `packages/harness/src/remote.ts:experienceView`, `registerHimaRoutes`；`client/api.ts` | Experience 的远程/客户端投影 | 有界查看、停用/重采 action 的请求/receipt；权限重新检查 | **主集成者**（共享） |
| `profiles/hima/cordis.patch.yml` | Hima profile patch；不是 memory carrier或 Session 日志 | 不向 profile patch 写记忆，也不以它的存在推断 DSH Session 支持 | 不改动；列为反例 |

新小文件只能是现有 `workshop`/`experience` 的 typed summary/validator，必须有一个明确 consumer（恢复装配或经验视图），不新建 `memory` 服务、数据库、向量库、后台 worker 或平行索引。

### 合同：输入、输出、错误与顺序

拟议 `WorkMemorySummary`：`{ schemaVersion, scope: { kind: 'session'|'campaign'|'child'; workspaceRef; sessionId?; runId?; parentSessionId? }, subject, decisions[], openQuestions[], todo[], references[], generatedAt, sourceVersion, status: 'current'|'stale'|'conflicted'|'unavailable' }`。每个 `reference` 至少有 authority kind/id、observedAt、适用条件；摘要文本必须标明 model-generated 或 deterministic projection。`ExperienceAdoption` 拟议含 `candidateRef`, `conditions`, `state: 'candidate'|'adopted'|'disabled'|'superseded'`, `correctionRef?`, `evidenceRefs[]`, `changedBy`, `changedAt`。

恢复顺序：(1) 认证 workspace/session；(2) 解析 scope 与 stable identities；(3) 重读 Run/Job/控制/报告 authority；(4) 验证 summary reference、版本和适用条件；(5) 标出 stale/conflict/unknown；(6) 仅装配合格候选；(7) 由原控制路径决定是否继续。错误顺序：跨 workspace/身份拒绝 → schema/identity 无效 → source 不存在或不可读 → scope/lineage 不匹配 → integrity/version 不匹配 → stale/conflict → 人类暂停/预算/owner 拒绝 → 可恢复的下游故障。任何不确定 source 都返回 unavailable/unknown，绝不静默采用。

### 可执行子切片、依赖与并行

| 子切片 | 依赖 | 并行与所有权 | 交付物 |
| --- | --- | --- | --- |
| M1-a：DSH capability matrix | 无 | 可与 S04 B1/B2、C1-a 并行 | API/版本/读写/retention/scope/recovery 表和最小反例 |
| M1-b：Hima carrier matrix | 无 | 可与 M1-a 并行 | Ledger/Knowledge/Archive/Experience authority map |
| M2-a：summary schema/authority precedence | M1-a/b | 可与 H3-a 设计并行 | scope、reference、stale/conflict 合同 |
| M2-b：恢复装配 | M2-a；S01 A1/A3 的可信 human-control、Host 恢复/通知/窗口退出合同冻结；S04 context consumer | 主集成者串行接线 | 不启动 Job 的 read/validate/assemble 路径 |
| H3-a：experience condition/correction model | M1-b | 可与 M2-a 并行 | candidate/disable/re-adopt 规则和 view 合同 |
| H3-b：经验查询与用户控制 | H3-a；G3 发布边界 | Experience owner 后由主集成者接 remote/client | 受控 action、receipt 与 evidence view |

## Testing Decisions

M1 先用静态/API 可达性小测试与隔离的真实 Host L2，不启动模型、EDA 或长任务。最低现有入口：先 `pnpm run build`，再 `pnpm run test:local --files test/contract/knowledge-reuse.host.test.ts test/contract/knowledge-documents.test.ts test/contract/experience.host.test.ts test/contract/experience-files.test.ts test/contract/agent-recovery.host.test.ts test/contract/profile-overlay.test.ts`。`profile-overlay.test.ts` 是 profile 不能充当 memory 事实的保护反例；DSH 原生能力的新增测试只在确认公开 API 后进入相邻 host test，不能用 mock event 宣称真实恢复。

M2/H3 的正例：compact/reopen 后有引用的目标/决定/待办仍可理解；恢复重读的 Job 完成覆盖旧摘要；匹配条件的负经验以 candidate 形式可查；用户停用后检索不自动采用。反例：human hold 被摘要清除；同名不同版本材料混合；child 继承未授权 parent 历史；跨 workspace 自动注入；损坏/缺 source 的摘要仍指导执行；disabled 经验在 compact 后复活；经验写入活动 Pack。涉及真实窗口校正/显示时再用 L3 `pnpm run test:desktop --files test/contract/experience.test.ts test/contract/unified-workbench.test.ts`。所有命令目前只计划，测试暂停且未运行。

## Out of Scope

- 不承诺 DSH 原生事件、compaction 或 SessionQuery 可写/可读，M1 未通过时不做 M2 carrier 假设。
- 不创建 memory 服务、embedding/vector database、跨项目自动资料池或 transcript 镜像。
- 不替代 A3 的 Job/owner 恢复、A1 人类暂停、Fabric 预算或 Ledger 测量。
- 不修改 Pack 默认方法、发布版本或客户资产共享策略；G3 负责确认发布。
- 不恢复测试、不运行模型/EDA、不装依赖、不触碰 `tmp/`。

## Further Notes

资格核查可先派 M1-a：静态读取 pinned `dsh-agent` 的公开 `AgentRegistry.createAgent(ownerCtx, CreateAgentOptions): Promise<AgentHandle>` 与其 Session persistence/compaction 相关 API，逐项记录实际可用/不适用与最小反例。它不修改接线。只有 M1 确认某 carrier 的 pinned version、公开性、写读、retention、scope、failure semantics 后，M2-b 才能由主集成者接线；不支持时只可用既有获准文件/Knowledge/Archive 引用，不直接写 DSH Session。M2 还遵从 S01 的 human pause 来源、可信 human-control receipt 与 Host 恢复合同，摘要永不能构成 continue 授权。H3 先确定 Experience/Knowledge 权限、归档 identity 与 Pack 发布边界。`ledger.ts`、`index.ts`、`remote.ts`、`tools.ts` 与 `profiles/hima/cordis.patch.yml` 的任何接线均仅由主集成者顺序所有，禁止各子切片造 schema 事实。

回滚：M1 只有文档/测试证据；M2/H3 每项采用 append-only 记录或可删除的 projection，撤销 summary/检索 UI 即恢复既有 Ledger/Experience/Archive。不得删除原始证据或用户 correction。模型分配：M1、schema/普通实现使用 `gpt-5.6-terra` / medium；会话隔离、数据保留、权限与恢复真实性复核使用 `gpt-5.6-sol` / high；主集成者负责共享接线和实际配置记录。
