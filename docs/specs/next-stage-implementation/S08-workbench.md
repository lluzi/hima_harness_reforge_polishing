# S08：Workbench 的双模式、结果表达与 child session 视图

状态：实施规格；本文件不实施、不启动产品测试、模型或 EDA。范围是 backlog 的 `NXT-D1`、`NXT-D2`、`NXT-C2`。产品决定来自 `docs/specs/next-stage-clarification/interview.zh-CN.md` 和 `docs/specs/workbench-modes-and-subagents/spec.zh-CN.md`；实现仍以当前源码和 ADR-0001/0002 为准。

## Problem Statement

当前 `HimaWorkbench` 只以 `runId` 选择已有 Campaign，未选择时显示 `ConfigurationPage`，并轮询 `fetchRun` 与 `fetchExecutionContext`。因此它没有 Data Insight 地址、报告身份、迟到响应隔离、跨报告导航或 child 的真实会话阅读面。`client/index.ts` 能注册现有 Workbench tab 并通过 `openOwner` 打开原生 session，但没有把 child 的历史复制到 Hima。

用户已确认 Campaign 与 Data Insight 是同级模式。浏览已经加载的报告/筛选不得创建 Run、调用模型或启动 Job；需要计算必须经既有受控 Run/Job 路径，保留新结果版本，且不得覆盖旧报告。child 页面必须呈现原会话、原始可用上下文、transcript、工具轨迹和产物；没有保留的历史必须明确为不可用，不能由 parent 摘要补写。

## Solution

在既有 DSH dock、`HimaWorkbench`、原生 session 导航和 Hima 的只读 Host projection 上增加一个封闭的 view address 与薄的视图层：

| address kind | 必需身份 / 准备态 |
| --- | --- |
| campaign | 有 runId 则打开已有任务；缺 runId 为准备态 |
| insight | 有 reportRef 则打开明确版本；缺 reportRef 为带 scope 的数据准备态 |
| child | parentSessionId 与 childSessionId 均必需，Host 重新校验 lineage |


上表是本地 `WorkbenchAddress` 展示选择，须按 [K1](contracts.md) 映射到唯一 `TargetAddress`：campaign→run、insight→report、child→child；无目标只显示准备态。报告先解析到版本/hash，节点下钻带run/node与execution或generation。所有Host读取与S04共用同一resolver，不实现第二套身份解析。

`WorkbenchAddress` 只携带地址和本地视图选择；Host 每次解析并授权真实 Run、report、session、文件或操作。浏览器的 active tab、filter、搜索词和草稿是可丢弃的本地状态；Run、Ledger/Archive report、child session 与真实 context 是权威事实。D1 负责地址、导航和焦点；D2 负责一份冻结 report payload 的结果表达；C2 负责读取/投影原生 child 身份与获准操作入口。S08 不创建 Agent Loop、session 存储、图引擎、分析 runtime 或数据库。

## Existing modules and symbols

| 路径 | 已核实符号/当前责任 | S08 增量与 owner |
| --- | --- | --- |
| `packages/harness/src/client/HimaWorkbench.tsx` | `HimaWorkbench`, `usePollingRead`, `selected`, `fetchRun`, `fetchExecutionContext` | **S08 UI owner**：地址解析、本地 tab/filter/draft、Campaign/Insight/child body 的互斥装配、取消迟到读数；不写 Run 事实。 |
| `packages/harness/src/client/index.ts` | `ClientContext.sidebarRight.openTab`, `sidebarRightTabs.register`, `ctx.sessions.open`, `openRun` | **S08 UI 集成者唯一 owner**：把冻结 `WorkbenchAddress` 编码到既有 tab params，保持现有 slots；S08 给出参数合同，不改此共享接线文件。 |
| `packages/harness/src/client/api.ts` | `fetchRun`, `fetchExecutionContext`, `controlRun` | **S08 UI 集成者唯一 owner**：S08 所需只读 API request/response 的接线；C2/D2 只消费冻结 payload。 |
| `packages/harness/src/client/CampaignTab.tsx`、`ConfigurationPage.tsx`、`workbench-style.ts` | 现有 Campaign/Start 呈现与视觉 tokens | **S08 UI owner**：复用样式和可访问交互；不得另起 UI framework。 |
| `packages/harness/src/remote.ts` | `RunView`, `RemoteOperations`, `runView` | **主集成者唯一 owner**：将已存在的 Ledger projection 扩展为只读 report/child view route 时保持 Host 重新授权；S08 不直接读 Site。 |
| `packages/harness/src/fabric.ts` | `ExecutionContext`, `executionContext`, `executionAction` | **主集成者唯一 owner**：仍拥有 Run/控制语义。S08 只能调用已获准 action，不能让 child 取得 Campaign owner。 |
| 原生 DSH session/subagent UI 与 `ctx.sessions.open` | `openOwner` 的既有原生 session 打开方式 | **C2/S08 UI owner**：复用 native navigation/read seam；先核查实际可读的 lineage/transcript/context 字段，缺失字段不伪造。 |

`packages/harness/src/profile.ts` 当前不存在；Site profile/Permit 的现有实现是 `packages/harness/src/sites.ts` 的 `loadSite`、`Site`、`Permit`。不得为满足命名而新建 `profile.ts`。

## Frozen contracts: inputs, outputs, errors and order

### D1 address and navigation

1. 调用者向共享路由传 `{kind:'campaign', runId?}`、`{kind:'insight', reportRef?, scope?}` 或 `{kind:'child', parentSessionId, childSessionId}`；未知 kind、非字符串 identity、缺少 child 任一 identity 先返回 `hima/invalid-view-address`，不读任何数据。
2. Host 按 address 重新解析当前身份与授权。不存在或不属于可见 workspace 的对象返回 `hima/not-found`；可见性/Permit/session fence 不通过返回 `hima/not-authorized`；不能把授权失败折叠成空列表。
3. `insight` 无 `reportRef` 返回可选 scope/准备态，绝不创建空 Run；有 `reportRef` 时先核验 report identity、hash/版本和 scope，再返回该 immutable version 的 payload。报告已被记录但 Site/hash 不可读，沿用 `hima/experience-changed` 或具体只读错误，不显示混合旧缓存。
4. `child` 先验证 child 与 parent 的实际 lineage，再读取允许的 session event、context reference、tool/artifact reference；lineage 不符为 `hima/child-lineage-mismatch`，不可用历史为字段级 `{availability:'unavailable', reason}`，不是错误替身 transcript。
5. 客户端只在 response address/identity 与当前请求相同、且 AbortSignal 未取消时提交结果；A 晚到不能更新 B。后台新 report 仅提示可刷新，不能抢 tab、改变 filter 或覆盖草稿。

### D2 frozen report payload

本规格与S11约定E3提供只读、schema-versioned `LibraryInsightReportView`；在 E3 实施前，D2 只允许 fixture payload，不能声称真 Library analysis。最小字段为：

| 字段 | 类型与要求 |
| --- | --- |
| schema/reportRef/version | 固定 `hima-library-insight-report/1`；不可变报告引用与版本 |
| source | 已记录产物id、sha256、createdAt；不能只有未绑定的路径 |
| analysis | library-health / library-performance / design-impact |
| conditions | family、corners、views、已加载load/slew范围及单位；本地filter不改变结果条件 |
| findings | 稳定id、标题、librarySeverity与designRelevance两轴、数值/单位/条件、provenance、unknowns |
| values | 有限数值或明确null+缺失原因；显示标签不是事实身份 |
| provenance | source ref及sha256或recordId、available/unknown/ambiguous；缺失不可标available |
| summary | best、unresolved、nextActions的finding/证据引用，不能只有无法验证的文案 |


Report payload 排序由生产者固定；D2 的本地 filter 只能筛已加载 `findings`，不得重算、调用模型或修改 payload。点击 finding 只写入 composer 的引用（保留已有草稿的 append 行为），不调用 STA/ECO。

### C2 child projection and operations

输入是已验证 `parentSessionId`/`childSessionId` 和当前 viewer；输出至少含 task/role、实际配置、状态、parent relation、可读 events、context references、artifact references、每字段 availability 和允许动作。顺序为 identity → parent lineage → viewer authorization → requested retained material → operation availability。继续/消息/中断均向原 child identity 发送，先显示准确 recipient；已结束但不可续、已归档或底层不支持的动作分别返回明确拒绝。中断显示 `requested`、`actual` 或 `unknown`，不预写 `stopped`。所有操作仍由 C1/C3/Host 生命周期与权限检查执行。

## User Stories

1. **D1-01** 用户在没有活动 Campaign 的 Start 处选 Data Insight，看到准备/选择页；系统没有创建 Run、Job 或模型调用。
2. **D1-02** 用户以中文请求 Library 分析，Guide 打开带正确 `reportRef` 或明确缺项的 Insight；不会默认跳转到 Live Campaign。
3. **D1-03** 用户从运行中的 Campaign 切到 Insight 再返回，原 `runId`、控制状态、草稿和 Insight filter 保持各自身份。
4. **D1-04** 用户先读 report A 后迅速切 report B，A 的晚到网络响应不会覆盖 B 的图、单位、证据或标题。
5. **D2-01** 用户在报告中筛 corner/load/cell，页面只在已加载 facts 上即时筛选；不会调用模型或产生新分析版本。
6. **D2-02** 用户看到 best、未解决项和下一步，同时可展开具体数值、单位、unknown 与来源；缺设计证据时 design-impact 明确不可计算。
7. **D2-03** 用户点击 finding 询问 Guide，composer 收到该 report/finding identity 且已有草稿未被替换；没有隐式 STA/ECO。
8. **C2-01** 用户打开运行中的 child，看到原 child 的消息、工具返回、错误和产物增量；parent 继续运行且没有被接管。
9. **C2-02** 用户查看 child 某步 context，只看到实际保留的快照/引用；未保留段显示不可用，当前 context 不能冒充历史输入。
10. **C2-03** 用户向 child follow-up 或请求中断，输入框和确认结果都指向 child；parent 和其他 child 不受影响。
11. **C2-04** 用户在 child 完成、归档或 parent 进入新 epoch 后回看历史，仍按原 identity 查阅；旧结果不能获得当前 Campaign 执行权。

## Implementation Decisions

### D1: mode shell and navigation

- 新增局部 `WorkbenchAddress` 类型和 address codec 可放在 `packages/harness/src/client/` 的既有 Workbench 责任内；其唯一消费者是 `HimaWorkbench`，共享 route/type export 由主集成者接线。
- `HimaWorkbench` 仍是 Campaign、Insight、child 共享 body 的唯一装配者；S08 UI owner 统一修改该文件以及必要的同目录 renderer/style/test。不能另建第二 sidebar、全局 store 或导航框架。
- Campaign 继续走现有 `fetchRun`/`fetchExecutionContext`。Insight 不携带 `runId` 作为创建指令；其 scope 只是视图条件。跨 Files/code/terminal 只调用已有 native `openFiles`/导航入口，实际 target 必须由 Host 再解析。
- 切换 mode 时不复用另一个 mode 的 pending promise、error 或 response。保留每个 address 的本地 selection/draft，地址销毁时才释放；后台更新以 non-modal notice 表示。

### D2: result expression

- 新增局部 `LibraryInsightRenderer.tsx`（或等价 renderer）仅消费冻结 `LibraryInsightReportView`；E3 是它的唯一数据生产者，D1 是唯一 Workbench 宿主。若 E3 尚未提供 payload，renderer 显示 fixture/不可用标记，不连接 native Liberty runtime。
- 视觉复用 `workbench-style.ts` 与现有 keyboard/focus 约定。分组、搜索、图和表必须由相同 finding identity 返回原始字段/provenance；不能把图的聚合值写回 Ledger 或篡改 report。
- 所有状态文本分开表达：当前视图条件、正在计算条件（若 Host 有受控任务）、结果对应条件、unknown/blocked。没有设计 evidence 时只隐藏依赖计算，不把 Library-only finding 降为 PASS。

### D2: Campaign图与错误恢复

- 复用 `packages/harness/src/client/FabricCanvas.tsx`、`FabricNode.tsx`、`NodeCard.tsx`、`packages/harness/src/canvas-layout.ts` 及 `RunView` 的图/节点身份，增加阶段分组、搜索/定位、best/未解决项摘要与证据下钻；保持拖动、缩放、节点操作和reference/growth图来源，不新建图引擎。
- `client/ConfigurationPage.tsx` 与 `usePollingRead` 将loading/error/empty/ready分开，读取失败展示具体修复和Retry；Retry使用同一请求路径及原输入，不能产生第二Campaign。
- 新增D2-B子切片：上述图/错误交互可与Insight局部renderer并行准备，公共视觉文件由S08 UI集成者统一落地。验收：配置请求失败不永久停在Reading；刷新后成功；按nodeId搜索能定位真实节点并回到原尺度/选择；过期结果不覆盖当前Run。
- 低层复用 `test/contract/canvas-layout.test.ts` 与 `view-run.test.ts`；关键窗口追加 `test/contract/campaign-graph.desktop.test.ts`、`campaign-refresh.desktop.test.ts`，仅在实现后按登记分组执行。

### C2: real sessions only

- 在当前 native session/subagent seam 可读字段的范围内建立 `ChildSessionView` adapter；只读 adapter 可以新增在 Hima client/remote 的既有职责中。若 current DSH 不提供完整 context/transcript，不新增 session storage 或回填历史，只返回 availability。
- artifact/diff/test 输出只保留原 reference、hash、path/command/result 状态，链接到原 Files/Code/Session UI；不能复制成 Hima 的第二份 ledger/session history。
- C2 不创建 child，不分配 budget/tools/workspace，不执行 resume/interruption 语义；它显示 C1/C3/Host 已给出的 capability，并把用户请求送回原生命周期 API。

## Executable slices, dependencies and parallel ownership

| 切片 | 交付与文件所有权 | 依赖 | 可并行关系 | 最低验证 |
| --- | --- | --- | --- | --- |
| S08-D1A | 冻结 `WorkbenchAddress`、Host read request contract、错误映射；共享 `client/api.ts`/`remote.ts`/`index.ts` **只由主集成者**接线 | B1 表达字段可后补；现有 `RunView` | 可与 D1B、D2、C2 并行，先冻结合同 | L1 codec/late-response cases + L2 Host route fixture |
| S08-D1B | S08 UI owner 改 `HimaWorkbench.tsx` 的 mode shell、address-local state、focus/draft preservation | D1A frozen union | 与 D2 renderer、C2 renderer 并行 | L0/typecheck；L3 一条 Start→Insight→Campaign |
| S08-D2A | S08 UI owner 新建局部 report renderer 和 fixture contract test | E3 frozen payload；可先 fixture | 与 D1B/C2 并行 | L1 filter/no-model invariant + L3 narrow viewport |
| S08-C2A | S08 UI owner child read renderer、availability states、native `openOwner` links | C1/C3 提供实际 child identity/capabilities；DSH read seam 核查 | 与 D1/D2 并行；不等 C1/C3 全部实现 | L2 retained/unavailable/lineage fixture |
| S08-C2B | 主集成者把获准 follow-up/interruption route 接至现有 Host lifecycle | C1/C3 的 operation contracts | D1/D2 不阻塞 | L2 recipient/isolation/refusal matrix |

共享 `index.ts`、`remote.ts`、`tools.ts`、`fabric.ts`、`ledger.ts`、`profiles/hima/cordis.patch.yml` 的Host配置由主集成者接线；client共享文件由S08指定的唯一UI集成者处理。S08 UI owner 是 `HimaWorkbench` 及共享视觉组件的唯一写者；S11 交付 report payload、Pack producer和fixture；client renderer只由S08拥有。

## Testing Decisions

用户确认边界为“现有 Host/Fabric 接口夹具 + 关键 UI；模型与 EDA 分开”。本规格不运行测试。实施时先做最便宜的反证，再按下列命令选择已有分组（源码变更后先 `pnpm run build`）：

| 层级 | 目标 | 既有测试路径/最低命令 |
| --- | --- | --- |
| L0 | address/type/slot 接线 | `pnpm run typecheck`；`pnpm run check:seams` |
| L1 | address codec、同 identity 才提交、filter 不触发计算 | 新增与 `HimaWorkbench`/renderer 同责的小测试；不得 mock Fabric 语义 |
| L2 | Host authorization、lineage、report identity、child operation recipient | `test/contract/view.test.ts`、`test/contract/side-talk.host.test.ts`；`pnpm run test:local --files test/contract/view.test.ts test/contract/side-talk.host.test.ts` |
| L3 | Start/Insight/Campaign、窄窗口、焦点/草稿、child native navigation | `test/contract/window.test.ts`、`test/contract/start-form-window.test.ts`、`test/contract/campaign-refresh.desktop.test.ts`；`pnpm run test:desktop --files test/contract/unified-workbench.test.ts test/contract/window.test.ts test/contract/start-form-window.test.ts test/contract/campaign-refresh.desktop.test.ts` |

模型、真实 Liberty、STA/ECO 与 EDA operator 不属于 S08 回归；它们各自按 L4/独立资格切片运行，不能因 fixture/GUI 通过而宣称已验证。

## Acceptance examples

| 正例 | 能推翻实现的反例 |
| --- | --- |
| Start 选择 Insight 后 route 是 `{kind:'insight'}`，Host 记录中没有新 Run/Job，UI 显示可选择的数据 scope。 | 点击 Insight 产生空 `RunView`、调用 `startRun` 或模型。 |
| report B 当前可见时 A 的 aborted/late response 被丢弃；B 的 `reportRef`、hash、单位和 filters 一致。 | A 的 chart 或 error 写进 B，或后台更新覆盖用户草稿。 |
| 对已加载 findings 改 filter 只改变本地可见集合，网络/Host action 计数不变。 | 每次 filter 都调用模型/Job，或把旧 report 改写为新结果。 |
| child 页面显示原 sessionId、真实 event/reference；一个没有 snapshot 的字段显示 unavailable。 | parent summary 被填进 transcript，当前 context 被标为历史 snapshot。 |
| child interrupt request 的 recipient 是 child，返回 requested/actual/unknown；parent Run 未改变。 | 打开 child 后 composer 指向 parent，或中断 child 把 Campaign 标 stopped。 |

## Qualification blockers

- 原生 child Session/SessionQuery 是否提供 lineage、增量 transcript、实际 context snapshot、artifact/tool trace 仍需在实现前做只读接口核查。没有该能力时 C2 只能暴露现有可读字段和 unavailable，不能补写。
- E3 的 `LibraryInsightReportView` 只允许接入已冻结、hash-bound 报告。真实 Library report 仍受 S11 E1 的 `lib.name` exit 139 qualification 门约束；没有通过不展示“真实分析成功”。
- Start 的精确 DSH slot 与当前 profile 实际挂载在实施切片开始时再核实；不存在的 slot/`profile.ts` 不是创建新框架的理由。

## Rollback

每个切片单独 commit。回滚 D1B/D2A/C2A 可删除新增 renderer/address-local code 并恢复原 `HimaWorkbench` Campaign/Configuration 行为；不迁移 Ledger、Run、session 或报告。回滚共享 route 由主集成者撤回同一 contract commit。任何已记录 report/session/Run 仍由原 owner 保存，不因 UI 回滚删除。

## Model allocation

常规实现、fixture 与集成：`gpt-5.6-terra / medium`。在实现稳定后，涉及 session identity、context disclosure、child interruption recipient、报告 hash/授权的独立关键复核：`gpt-5.6-sol / high`。不因规格不完整升级模型；若 native DSH 没有所需 retained field，记录能力缺口而不是以更强模型猜测或伪造数据。

## Out of Scope

- C1/C3 的 child 创建、预算、workspace/tool 授权、真实执行和生命周期实现；
- M2 的长期记忆/恢复、B1 的产品表达定义、E3 的事实生产与真实 Library 计算；
- 新 Agent loop、second graph engine、数据库、session/transcript 存储或 UI framework；
- 自动 STA/ECO、真实 EDA、模型调用、将 child 操作扩展为 Campaign ownership。

## Further Notes

`RunView` 的 `experience` 与 `readExperience` 已将记录身份和 Site 文件 hash 分开；S08 应沿用该原则，不能以 renderer preview 代替原始 report。切片完成的证据必须分别列出 L0/L1/L2/L3 的通过、失败、跳过和未运行，以及实际开发模型/Effort。D1/D2/C2 的 UI 合入不解除 E1 qualification，也不等于 child/EDA/研究业务价值已经验证。
