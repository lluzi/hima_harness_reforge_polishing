# S10 — Pack 作者五阶段、反例与可恢复发布（NXT-G1 / G2 / G3）

状态更新（2026-09-25）：**PASS**。Wave 3 的独立第二作者从新的 Library SOP、资格与报告要求开始，
经独立 Guide 交接完成 grill → spec → fabric → terminal TEST → native release，并通过安装、幂等升级、
stale review 拒绝、升级中断 rollback 和客户资产字节保持。现行回执见
[wave3-pack-authoring-and-portable-method.md](../../assessment/2026-09-25/next-stage/wave3-pack-authoring-and-portable-method.md)。
下文基线状态与拟议措辞保留为实施设计历史，不覆盖该终态证据。

历史基线状态（终态 PASS 前）：实施规格；基线 `1a79cb1514364aa049e775d7b18bbb063a223092`。
以下“拟议”“测试暂停”等措辞记录当时的实施设计，不是 2026-09-25 的当前运行状态。
本文复用现有作者 session、五阶段技能、Pack 合同、测试与发布链；依从
ADR-0001/0002/0004/0010、S04 Guide、S05 memory 和 backlog。

## Problem Statement

当前作者已经可经 `authoring.ts:openAuthoringSession()` 创建/选择 Pack 原生 session；`registerAuthoringGuard()` 强制该 session 只在一个 Pack folder 内 `write`/`edit`，并拒绝 shell。`skills.ts:HIMA_SKILLS` 已注册人手调用的 grill → spec → fabric → test → release 五阶段，`packs.ts:packStage()`/`checkPack()` 报告梯级和 Site fit，`release.ts:releasePack()` 用 `VERSION.yml`、TEST record 和文件 hash seal 方法。现有能力没有被 S04 的准备解释、S05 的有来源交接/经验候选和一套第二位作者可执行的反例、checkpoint、安装升级/回滚说明整合成明确合同。

风险是 Guide 越权直接改 Pack、作者在错误目录操作、模型文字替代 Reader/Judge 证据，或把客户资产、已发布方法和记忆混为一体。本规格保持作者 session 与 Pack folder 是作者工作的唯一 runtime；Guide 只移交，memory 只提供有条件引用，发布仍需原有可核验证据和 owner 确认。

## Solution

把五阶段的输入、输出、证据、失败出口和消费者明确为一个拟议 `AuthoringHandoff`/`PackStageReceipt` 投影。Guide 用 S04 的 context 说明业务目标、Pack/Site/输入缺项和下一步，然后 `hima_author` 创建或打开原作者会话；它不直接承担作者执行，原生user-invocable阶段规则保持。S05 可给出满足 workspace/设计/工具版本条件的经验候选，作者明确采用并在合同/证据中记录，不能自动改默认方法。

G1 让第二位作者从 SOP、脚本和报告形成目标、合同、节点、工具、读者、知识及人能读懂的说明。G2 在既有 Reader/规则/Workshop 与测试界面中补最便宜的反例和失败恢复模板。G3 依赖 `releasePack`、`previewPackTransfer`、`applyPackTransfer` 和 `installPackMethod` 的现有原子/审阅语义，明确方法 identity、兼容、资产保留和恢复；不能新增作者 runtime、发布服务或无审计插件。

## User Stories

1. **作为新作者**，我希望 Guide 将 SOP 转成目标、输入、已知缺项和引用并打开独立 Pack 作者 session，从而让 Guide 保持可对话且不直接写 Pack。
2. **作为 Pack 作者**，我希望只能在自己的 Pack folder 写入并得到跨 Pack、`..`、symlink 和 shell 的明确拒绝，从而不误改其他资产。
3. **作为 Pack 作者**，我希望按 grill/spec/fabric/test/release 五阶段推进并看到 `hima_pack_check` 的 rung、next、needs 和 Site fit，从而不把空 folder 当作可运行 Pack。
4. **作为第二位作者**，我希望从 SOP/脚本/报告写出能追到目的、输入输出、节点、工具、知识和人可读说明的小 Pack，从而不以模型文字代替实际文件。
5. **作为 Reader 作者**，我希望真零值、空报告、缺字段、容器参数或多个目标返回明确 failure/unknown 与恢复建议，从而不把空字符串当成功测量。
6. **作为中断后返回的作者**，我希望看到完成 stage、未完成项和可验证引用，并只收到 S05 的条件化经验候选，从而不让 memory 覆盖当前 contract。
7. **作为发布作者**，我希望只有当前文件、TEST record、Run identity 和版本一致时才生成 seal，从而使改过文件或同版本方法改动被拒绝。
8. **作为 Pack 安装者**，我希望在安装/升级前审阅精确 transfer manifest，并在内容变化时使旧 review hash 失效，从而避免静默应用。
9. **作为持有客户资产的 Pack 所有者**，我希望升级后旧 Run 仍按原 digest 读取且 run-assets 字节不丢，从而能从中断升级恢复或得到明确拒绝。
10. **作为需要分享方法的作者**，我希望默认只导出经验证 method、并仅在明确 review 后迁移批准资产，从而不泄漏客户 run-assets/私有算法。

## Implementation Decisions

### 现有路径、符号与所有权

下表未带目录的 TypeScript 文件均相对 `packages/harness/src/`。

| 路径 / 符号 | 已核实责任 | 本规格的拟议增量 | 文件所有权 |
| --- | --- | --- | --- |
| `authoring.ts:openAuthoringSession`, `registerAuthoringGuard`, `FILE_WRITING_TOOLS`, `SHELL_TOOL` | 原生作者 session；单 Pack 写边界；禁止 shell | 交接引用与用户可读 refusal；不削弱 guard | 作者实施者；`index.ts/tools.ts` 接线仅主集成者 |
| `tools.ts:hima_author`, `hima_pack_check`, `hima_pack_release` | 作者、stage 检查、release 工具表面 | S04 handoff 的引用输入及 stage receipt 展示；不让模型自动选 stage | **主集成者**（共享工具） |
| `skills.ts:HIMA_SKILLS`、`packages/harness/skills/hima-{grill,spec,fabric,test,release}` | 五个仅 user-invocable 的 stage bodies | 统一每阶段输入/产物/反例/恢复语言；保持阶段由人发起 | Pack-author content owner |
| `packs.ts:packStage`, `packStageOf`, `checkPack`, `loadPack` | Pack 梯级、身份、Site fit/加载 | 只投影同一检查结果；不复制 loader/check 规则 | Pack implementation owner |
| `release.ts:releasePack`, `installPackMethod`, `previewPackTransfer`, `applyPackTransfer`, `readPackMigrationReceipt` | seal、安装/升级、审阅 transfer、迁移 receipt | 展示 identity/compatibility/assets/rollback receipt；保持 review hash 与原子写语义 | Release implementation owner |
| `workshop.ts` / `experience.ts` | 有界知识/经验候选 | S05 条件化引用；memory 绝不写活动 Pack | S05 owner；消费接线由主集成者 |

新小文件只可为 Pack 内 stage template、fixture 或 reader failure example，必须由一个五阶段 skill 或现有 test 消费；不新建 authoring daemon、Pack registry、自由执行平台或第二发布系统。

### 拟议合同、错误与顺序

`AuthoringHandoff` 拟议为 `{ packId, workspaceRef, goal, sourceRefs[], siteRef?, inputGaps[], suggestedStage?, memoryCandidates[] }`；`packId/workspaceRef` 都由 Host 解析，`suggestedStage` 不是自动执行命令。`PackStageReceipt` 拟议为 `{ packId, stage, status: 'ready'|'blocked'|'completed'|'unknown', producedRefs[], check: { rung, next?, needs?, fit? }, failures[], resumedFrom? }`。经验候选必须带 source、conditions、adoption state。

顺序：验证当前 workspace/Pack id → 打开原生 authoring session 与 guard → 人发起一个 stage → stage 读前一阶段及具名来源 → 以现有工具写 Pack 内可验证产物 → `packStage/checkPack` 复查 → test Run/TEST record → `releasePack` seal → preview 精确 transfer → owner review hash → apply/install/upgrade → 读回 receipt/identity。错误顺序：session/Pack 身份或目录拒绝 → guard path/shell 拒绝 → 前一 stage/合同/来源缺失 → Pack/Reader/fit 不成立 → test evidence/版本/hash 不一致 → review hash stale → destination/ownership/客户资产冲突 → interrupted update/读回失败。失败不创建虚构 receipt、不删客户材料。

### 子切片、依赖和并行

| 子切片 | 依赖 | 可并行 / 单一所有者 | 交付 |
| --- | --- | --- | --- |
| G1-a：五阶段与作者语言审计 | S04 B1 表达原则 | 与 G2-a、S05 H3 条件表并行 | stage 输入/输出/人类解释表 |
| G1-b：Guide→author handoff | S04 B2 context；原openAuthoringSession可复用，新增调用才需C1对应资格 | 主集成者串行接 `tools.ts/index.ts` | 不占用 Guide 的最小交接 |
| G2-a：Reader/规则反例矩阵 | 现有 Pack/Reader 合同 | 可与 G1-a 并行 | 零值/空值/缺字段/多目标反例及恢复模板 |
| G2-b：作者 checkpoint/恢复 | S05 M1/M2 carrier 资格 | 与 release 内容工作并行 | 只引用已核实来源的 resumed receipt |
| G3-a：release/install/upgrade UX contract | 现有 release 函数与 S12 J2 发布身份 | 与 G2-a 并行 | seal/review/receipt/rollback 的用户步骤 |
| G3-b：共享接线与验证 | G1-b、G2-a、G3-a | **主集成者**唯一修改共享入口 | 真实结果投影，不另造事实 |

## Testing Decisions

最低 L2：先 `pnpm run build`，再 `pnpm run test:local --files test/contract/pipeline-stages.host.test.ts test/contract/pipeline-checkpoint.test.ts test/contract/pipeline-finalize.test.ts test/contract/pack-method-assets.test.ts test/contract/skills.test.ts`。`pipeline-stages.host.test.ts` 覆盖 Host 五阶段；checkpoint/finalize 覆盖 provenance/禁止越权最终化；`pack-method-assets.test.ts` 覆盖 release、transfer、升级、中断与资产保护。作者 UI/完整窗口 stage 变更才加 L3：`pnpm run test:desktop --files test/contract/pack-owner.desktop.test.ts test/contract/pipeline-stages.test.ts`。`test/contract-groups.json` 当前将后者列在 desktop；每次先用 Node 24 执行 `pnpm run test:local --list` 或 `pnpm run test:desktop --list` 核验选集。

正例：独立作者 session 从 grill 到 seal；符合证据的 release；精确 review 后 upgrade，旧 digest/run-assets 保留。反例：作者 shell/跨 Pack 写；矛盾 spec；空报告被判 PASS；改 seal 后继续运行；stale review hash apply；同版本方法改动；未知客户文件/软链接/中断升级；memory 自动改变 Pack。历史基线写作时测试尚暂停；当前实跑结果以本文顶部 Wave 3 PASS 回执为准。

## Out of Scope

- 不新建作者 runtime、自动 stage 调度、远程发布服务或全新 Pack registry。
- 不把 Guide、memory、模型输出或 UI 点击变成 Pack owner 的发布确认。
- 不替代 S12 的 App 发布身份和影响验证；不把 Pack test 冒充完整商业 EDA 研究。
- 不恢复测试、执行产品/EDA、安装依赖 或触碰 `tmp/`。

## Further Notes

资格门：G1-b复用已存在的openAuthoringSession，可先做最小交接；只有新增原生调用才依赖C1对应API资格，不能让整个团队系统阻塞作者内容；G2-b 必须等 S05 M1 明确可用 carrier，未知原生 Session 事件不可承诺恢复。任何 Pack 必须经 `checkPack`、真实 TEST record 与 seal 才可称为 release-ready；reader/工具实际资格仍由各领域切片验证。`index.ts`、`tools.ts`、`remote.ts` 和共享 release/ledger 接线由主集成者按序所有。

回滚：stage 内容、反例、handoff 和 UI 分开提交；撤销它们不触碰已 sealed method 或客户资产。已开始 install/upgrade 按 `release.ts` 的 verified method history/receipt 做原恢复，失败保持拒绝而非删除目录。模型分配：文案、fixtures、普通 Pack/Reader 实现用 `gpt-5.6-terra` / medium；guard、资产保留、release identity 与权限边界由 `gpt-5.6-sol` / high 独立复核；实际模型/effort 记录在验收。
