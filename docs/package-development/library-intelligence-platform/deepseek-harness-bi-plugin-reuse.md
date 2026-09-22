# DeepSeek Harness 数据分析/BI 插件调查与 Library Intelligence 复用建议

日期：2026-09-22

状态：研究结论，不是依赖引入、安装授权或已实现功能。

## 结论

DeepSeek Harness 生态中已经出现可运行的数据分析与可视化插件，但没有一个可以原样成为 HimaHarness
Library Intelligence。最有价值的结论是：

1. **直接复用官方 Harness 扩展面。** 当前仓库固定使用 DSH `0.1.5-alpha.1`，已经在
   `@hima/harness` 中注册了右侧 Sidebar Tab、React Slot 与 tool-view；无需再建一套 BI shell。
2. **优先借用 `dsh-data-agent` 的分析呈现协议和实现模式。** 它已有严格版本化 report schema、ECharts、
   冻结 Tool Result replay、离线 HTML、数据/视图/字节/行数边界和测试，最接近所需底座。
3. **不直接安装完整 `dsh-data-agent`。** 它以 SQL/database 为 authority，带 `sql-write`，且 `readonly`
   默认值为 `false`；Library Intelligence 的 authority 必须是 Liberty 原件、Lib API facts、Ledger 和设计
   证据，而不是通用数据库连接。
4. **`dsh-genui` 只适合原型与低风险 ad-hoc visualization。** 它能快速生成丰富交互 UI，但最终界面由
   模型给出；权威 Finding、rule result 和 action 不能由自由生成的 UI spec 决定。
5. **确定性统计可以复用思想或窄代码，不应把大数组经过模型工具参数传递。** `dsh-tool-stat` 的数值算法
   与 fail-closed 语义有价值，但 Library 大表应在 Site/Host 侧计算，只把 bounded result 进入会话。
6. **PaperMachine 是产品参考，不是插件依赖。** 它证明 trace、artifact provenance、环境记录和图表版本
   编辑的产品价值，但它是一个完整 DSH fork/应用，直接合入会扩大架构。

推荐做法是：在现有 `@hima/harness` client bundle 与 Hima Workbench 内实现 Library Intelligence tab；
抽取或重写一个 Library-specific、版本化的 `InsightReport` contract，并用 ECharts 渲染。Lib API 负责
产生领域事实，Harness 插件只负责组合、呈现、交互和安全地请求后续动作。

## 1. 版本与调查边界

当前仓库依赖：

- `@deepseek-ai/dsh`、Agent、Tools、Skill 等：`0.1.5-alpha.1`；
- Cordis：`4.0.2`；
- `@hima/harness`：`0.1.0`。

官方仓库在调查时的 `master` 已推进至 `0.1.7-alpha.1`，而官方 README 明确标注 Developer Preview 与
compatibility-breaking changes。因此任何社区插件只能按**当前固定版本**做隔离 POC，不能因其 README
写“兼容 DSH 0.1.x”就直接进入产品依赖。

当前权威代码还确认：

- [client/index.ts](/Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/client/index.ts)
  已经使用 `sidebarRightTabs.register`、`sidebar.right.pane.tab` 和 `tool.call.toolview`；
- [HimaWorkbench.tsx](/Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/client/HimaWorkbench.tsx)
  已经是对话右侧的 Hima 原生 Workbench；
- 新特性默认应加深该 Workbench，而不是安装另一个 modal、panel 或控制面。

## 2. 官方 Harness 中可直接使用的底座

| 官方组件 | 已证明的能力 | Library Intelligence 用法 | 关键限制 |
| --- | --- | --- | --- |
| `dsh-app-boot` + Cordis Loader/Profile Bundle | 通过 Bundle/patch 加载插件，支持配置层和失败定位 | 如果以后独立发布 Library Intelligence，可作为 `@hima/harness` Bundle 的一部分交付 | DSH 仍快速变化；当前产品纪律优先在现有 Hima bundle 内实现 |
| `dsh-client-ui-sidebar-right` | 第三方可注册右侧 Tab type/body/title/menu；支持 split、push/fullscreen 和 resource navigation | 注册 `library-intelligence` tab，或在现有 Hima Workbench 内增加业务 section | Sidebar layout state 是 memory-only；业务 insight/history 必须来自 Host/Ledger，不来自 Tab 内存 |
| `dsh-client-ui-renderer` + Slots | React business plugin 可插入标准 UI seats，Host object state 通过 typed props/hook 投影 | 实现 chart、table、Finding Dossier、Rule Studio 与 Action Center | 只是 rendering seam，不提供分析语义或持久化 |
| `tool.call.toolview` | Tool call/result 可注册专属可视行 | 对 Lib API query、analysis、rule、action receipt 提供小型摘要并一键打开右侧 Insight | 不应把完整大表塞进聊天 Tool Result |
| `dsh-client-ui-deliverables` | 显示第一方 mutation tools 产生的文件并打开右侧文本预览 | 报告、rule pack、candidate diff 可作为交付物链接 | 终端间接生成的文件不会自动进入 vocabulary；Library 工具需显式声明 location |
| `dsh-mcp-client` | 把 MCP Tools 映射为 native tools；保留 `structuredContent`，支持持久 image | 隔离 POC 时可桥接外部分析服务或临时 Lib API MCP | 只桥接 Tools，不桥接 Resources/Prompts；不应替代 Pack/Site/Reader/Ledger 权威链 |
| PTC + `dsh-code-runtime-worker-thread` | 模型可运行有预算的 TypeScript，并调用生成 SDK | 高级用户的临时 query/分析原型 | 官方明确是 containment、不是 security boundary，权限近似 Bash；不能作为默认 Rule Studio runtime |
| `dsh-session-query-sqlite` | 可丢弃、可重建的 SQLite FTS derived index，与 authority store 分离 | 复用其“derived index never source store”、generation/cursor 与单 owner 原则 | 它只索引 session history，不是 Library 数据库，不能直接拿来查询 Liberty facts |
| Plugin Inventory UI | 展示当前插件、preset composition、enablement 与 live phase | Diagnostics 中显示 Library Intelligence 插件/版本/状态 | 只读瞬时 snapshot，无历史、来源 provenance 或 mutation |

这些底座的竞争价值不是“少写一些 UI 代码”，而是让 Library Intelligence 保持 HimaHarness 的原生体验：
同一对话、同一 Session、右侧同一工作台、同一 tool receipt 和同一插件生命周期。

## 3. 社区候选评估

### 3.1 `@yejiming/dsh-data-agent`：最值得借用，但只借分析层

调查版本：`0.1.5`，MIT，commit
[`6657771`](https://github.com/omdsh-dev/dsh-data-agent/commit/6657771b8b9e66b3c06d6a6ce3056e601e7ff1fe)。

可借用能力：

- ECharts `6.1`；
- `AnalysisReportV1` 严格 schema；
- 1–6 个 dataset、1–8 个 view、512 KiB report 上限；
- metric、line、bar、pie、scatter、table；
- unknown property、dangling dataset、非法 shape fail closed；
- `presentationMeta` 保存完整结构化结果，模型只收到短摘要；
- browser replay 从 frozen Tool Result 纯函数解码，不重新查询数据库；
- 离线 HTML report 原子发布，不覆盖已有报告；
- dataset 预验证、只读 query、row/result/query timeout 限制；
- Catalog governance、connection/session isolation 与 extensive tests 的实现参考。

不能原样采用的原因：

- authority 是 SQL database，不是 Lib API；
- `sql-write` 存在，工具层 `readonly` 默认是 `false`；
- Web workbench 是 modal/composer control，不是当前 Hima right-sidebar architecture；
- chart schema 没有 Library 所需的 heatmap、surface、waveform、parallel coordinates、corner matrix；
- model-written SQL 与 business catalog 不等于 Library semantic identity、condition、unit 和 evidence level；
- package peer range/测试不能替代对本仓库固定 DSH `0.1.5-alpha.1` 的消费验证。

建议：做一个隔离 POC，抽取其 report/schema/view-model/chart/offline-HTML 模式，形成 Hima 自己的
`LibraryInsightReport/v1`；不要把数据库连接、SQL preset、catalog 或 write tool 装入正式产品。

### 3.2 `@changfenhuang/dsh-genui`：快速原型强，权威洞察弱

调查版本：`0.11.1-preview.2`，MIT，commit
[`05aa822`](https://github.com/omdsh-dev/dsh-genui/commit/05aa8226409f6e9a585b2cb3a1ce57175a7331d7)。

优点：

- 明确支持当前 DSH `0.1.5-alpha.1`；
- 30+ 组件、ECharts、plot、table、forms、Mermaid、panel、action loop；
- whitelist、node/depth/size 限制、坏节点丢弃、无 `eval`；
- local interaction、action feedback、state persistence 与 lazy asset loading；
- 很适合验证“对话生成可交互洞察”的视觉和交互品味。

不适合直接承担 Library authority：

- UI spec 由模型生成，可能选择错误字段、聚合、单位或视图；
- inline fence / composer panel 与用户指定的右侧 Hima Workbench 不是同一信息架构；
- action 回到模型，不等于通过 Hima Fabric 的 typed action、Permit、proof 与 rollback；
- generic ECharts option 难以保证 Finding 与 exact source/producer/design evidence 绑定。

建议：仅用于设计原型、内部 demo 和低风险 ad-hoc exploration；正式界面用固定 typed renderer，模型只
选择经过允许的 query/view/action，不生成权威 payload。

### 3.3 `dsh-tool-stat`：算法值得借，工具形态不适合大表

调查 commit
[`23069a4`](https://github.com/omdsh-dev/dsh-tool-stat/commit/23069a4344dcfebd98ea381a77d07091f039f357)，
MIT，仓库 package 标记 `private`，主要从 GitHub 安装。

可借用：Neumaier compensated sum、Welford variance、linear percentile、Spearman midrank、有限数/溢出/
零方差/预算的确定性语义及测试。

不建议原样让 Agent 调用：工具参数会进入 Session log；最多 100,000 个显式 number；没有分组、二维
lookup surface、condition、unit、PVT、regression 或 anomaly semantics。Library 数值应在 Site/Host 侧对
hash-bound facts 计算，再把小型 result/identity 返回 Agent。

### 3.4 PaperMachine：高价值产品参考，不是可安装插件

调查版本 `0.1.2`，MIT，commit
[`b7f095e`](https://github.com/SuperJJ007/papermachine/commit/b7f095ed665d3c0693006d20fbf0ad33f061cf82)。

值得借鉴：

- Python/R persistent kernels；
- 每一步 code/output/kernel-state trace；
- 右侧 artifact panel；
- chart/table/file 到 code、log、question/result、environment 的 provenance；
- artifact version、human edit 与版本保留；
- 独立 micromamba 环境与 package manifest。

但它是完整 DSH fork/桌面产品，不是一个能装进当前 Hima profile 的小插件；其 persistent Python/R 环境
也不能替代 Empyrean Python 3.7/native Lib API runtime。借用产品原则和少量解耦代码前，必须另做接口、
依赖、许可/NOTICE 和生命周期评估。

### 3.5 不建议采用

| 候选 | 原因 |
| --- | --- |
| `dsh-plugin-chart` | 图表数据发送到 configured chart service；不符合客户 Library 默认不外发。可以参考 AntV skill，但不能处理 proprietary data |
| 通用 `dsh-sql` / MySQL 插件 | Lib API 不是 SQL authority；引入连接、写权限与 schema drift，却没有解决 Library semantics |
| 任意通用 GenUI/HTML 作为最终事实面 | 图能画出来不代表数据、单位、条件、Finding 或因果关系正确 |
| 官方 PTC 作为 Rule Studio 默认执行器 | 模型代码权限接近 Bash，官方只承诺 containment；不满足受控、可审计规则执行 |
| Session SQLite search 直接存 Library truth | 它的合同是 session text derived index，复用会混淆 authority 与生命周期 |

## 4. 核心产品特性：竞争价值 × Lib API 可实现性 × Harness 复用

下表只保留同时回答两项原则的功能。`直接`表示主要事实可由 Lib API 读取；`派生`表示 Lib API facts
加确定性算法；`联合`表示必须再结合 Hima 或 EDA 外部证据。

| 产品特性 | 为什么提高产品竞争力 | 为什么 Lib API 能实现 | Harness/插件复用 | 证据等级 |
| --- | --- | --- | --- | --- |
| Library Catalog & Lineage | 先消除错版本、重复 run copy、corner/view 混淆；没有可信 inventory，后续 BI 都会被污染 | `tmlib` 读取 Library、units、operating conditions、Cell；`corner` 管理多文件；输入 hash/API build 补充 provenance | 现有 Hima Workbench + Data Agent Catalog 的 versioned-governance 模式；SQLite 只做可重建 index | 直接；exact source line/offset 尚未由 API 证明 |
| Cell/Pin/Arc 360° Dossier | 把工程师跨文件、跨窗口找信息的成本压成一个可追问对象，是日常高频入口 | API 暴露 Cell、Pin、PgPin、Bus、Bundle、Timing、Power、Leakage、Template、Function/FF/Latch 等对象 | Right Sidebar Tab + typed React component；点击对象把 identity 写回对话 draft | 直接 |
| Multi-PVT / Revision Compare | DigWise/Solido 已证明是购买基线；Hima 必须达到 parity，且增加 source identity 与 unknown | `corner.linkFile`、Cell/arc/table traversal、units/templates/values 可形成 semantic key 和完整 delta | 借 Data Agent report/dataset/view pattern，不借 SQL authority | 直接 + 派生 |
| Trend / Surface / Waveform Explorer | 非单调、kink、spike、corner ordering 和工作域覆盖直接影响模型可信度与 review 时间 | API 可取得 table axes/values、NLDM data、CCS trans/load/current、receiver cap；`interpolate` 只能在资格验证后使用 | ECharts；扩展 typed schema 为 heatmap/surface/waveform/corner-matrix；右侧 canvas 固定渲染 | 直接 + 派生；ECSM specialized coverage 未证明 |
| Finding Dossier | 竞品能报异常；竞争壁垒是把异常的机制、邻域、反例、unknown 与下一验证装进同一决策包 | Generic attribute/group + specialized facts 支持结构、completeness、shape、condition、trend、delta rules | Frozen `presentationMeta`/Ledger record；Tool Result 只显示摘要并打开右侧 | 派生；root cause 通常仍是 inferred/unknown |
| Custom Rule Studio | 客户工艺、命名、表征和 signoff 方法不同；无需等产品发版即可形成组织资产 | Lib API 提供稳定 fact vocabulary；规则作用于 normalized facts，不直接操作 native object | 不用 PTC；定义 typed Rule IR、fixture、preview、positive/negative tests、versioned Rule Pack | 派生；只支持 API 能稳定抽取的字段 |
| Insight Builder | 用户把查询、metric、过滤、图表和 ranking 保存为可重复方法，形成切换成本与知识积累 | Lib API query 可返回 bounded datasets；同 source hash/query/version 可重放 | 借 Data Agent `AnalysisReportV1`/offline HTML 思路；Hima Pack/Knowledge 保存方法 | 直接 + 派生 |
| Evidence-linked Visualization | 可复核性明显优于普通 BI：每个点能回到 source hash、Cell/arc/table/condition，而不是只有 tooltip 数字 | API 提供对象层次和数据；Hima 增加 source hash、producer、query、unit、condition | Typed chart datum + right-sidebar drilldown + Files/Evidence links | 直接；源码行号需 sidecar/额外验证 |
| Insight-to-Action Center | 把分析产品变成工程闭环：用户知道接下来查什么、成本/许可/风险/停止条件是什么 | API 可继续 query、evaluate、corner compare，并通过 `outputLib` 生成 candidate copy | Action 只形成 typed proposal；执行仍由 Campaign Agent/Fabric、Permit、Ledger 完成 | 直接 + 联合；芯片结果需要外部工具 |
| Candidate Library Sandbox | 支持安全 what-if 和修复验证，同时避免破坏 golden Library | `outputLib` 声明了写副本能力；可 re-read/compare/round-trip，前提是 API qualification 通过 | Campaign workspace、Pack tool、hash/invariant、rollback；绝不走通用 SQL write | 直接；当前 runtime qualification 阻塞 |
| Design-Conditioned Impact | 把 Library 内最大异常升级为“当前芯片最值得处理的问题”，这是超越普通 BI/QA 的核心 | Lib API 提供 exact Cell/pin/arc/table identity 和工作域；但不提供当前 design consumption | 与 Hima DIG、netlist、STA readback、endpoint frontier、actual slew/load 联合 | 联合，Lib API alone 不可完成 |
| Offline Insight Report | 企业可审阅、归档、分享，减少截图和手工 PPT；也是版本/release 证据载体 | Report 数据全部来自 Lib API facts/derived findings，带身份即可重放 | 借 Data Agent offline HTML 原子写入与 Deliverables file links | 派生；报告不是 signoff |
| Analysis Provenance & Versioning | 这是与普通 BI/GenUI 的关键差异：图表改变后仍能复算、比较、审计 | API build、source hash、query/rule/schema version 可绑定每个 artifact | 借 PaperMachine 产品原则与 Data Agent frozen replay；权威记录在 Hima Ledger/Archive | 直接 + Harness evidence |

## 5. 推荐的产品结构

```text
Liberty source files
  ↓  Site-local Python 3.7 worker / Lib API
hash-bound LibraryFacts + unknowns
  ↓  deterministic analyzers / typed rules
InsightReport + Findings + action proposals
  ↓
Hima Host/Ledger authority
  ├─ conversation summary / tool receipt
  ├─ right-side Library Intelligence canvas
  ├─ versioned custom Rule/Insight assets
  └─ Campaign Agent → Fabric → approved follow-up action
```

关键原则：

- UI 不直接调用 `_tmlib.so`；native crash 被 worker/process boundary 隔离；
- 图表不重查原始数据，读取 frozen、hash-bound Insight report；
- 大数组不进入模型 prompt/tool arguments；模型看到摘要、schema 和查询 handle；
- custom rule 使用 typed IR，不默认执行模型生成代码；
- chart/filter selection 是 UI local state；只有需要新证据或执行时才生成 action；
- derived SQLite/Arrow/JSONL 可删除重建，不成为第二事实源；
- Hima Workbench 是投影，Campaign Agent/Fabric 继续拥有业务行动与执行约束。

## 6. 建议的首个 POC

不要先安装五个插件。建议一个隔离 POC，只验证四件事：

1. 从 `dsh-data-agent` 提取/重写严格 typed report、ECharts 和 frozen replay 模式；
2. 在当前 `HimaWorkbench` 新建一个只读 `Library Insight` section，而不是新 modal/新控制面；
3. 使用合成 fixture 生成一个 `LibraryInsightReport/v1`，包含 metric、line、table、heatmap 四类 view；
4. 点击任一点形成带 exact semantic identity 的“Ask HimaGuide”草稿，不启动工具、不改变数据。

第一阶段不需要真实 Lib API、SQL、MCP、PTC、Python/R kernel 或 EDA license。它回答一个设计问题：
**现有 Harness seam 能否承载用户要求的对话 ↔ 右侧 business-insight 交互，而且所有显示都来自 typed facts？**

POC 通过后，才把已 qualification 的 Lib API worker 接到同一 report contract。若必须先安装通用 Data
Agent、生成自由 HTML 或把 Library 表灌入模型才能完成 POC，说明界面/数据边界设计错了。

## 7. 产品验收信号

| 原则 | Continue signal | Stop signal |
| --- | --- | --- |
| 竞争价值 | 同一 review 任务中，右侧 drilldown 与对话把定位/解释/下一动作时间明显缩短；用户能保存并复用 insight/rule | 只是把已有 Markdown/表格换成彩色图；不改变判断或行动 |
| Lib API 可实现 | 每个图/表/Finding 都能回到 API fact、source hash、unit、condition、query/rule version；unsupported 明确为 unknown | 主要特性依赖 API 没有的数据，却用 AI 补齐；或 native object 直接泄漏到 UI |
| 真实性 | report replay 不重新查询、不改变历史；同输入身份得到同一 deterministic result | 刷新页面后图表漂移，或模型重新生成不同 dataset/aggregation |
| 安全 | golden 只读、candidate copy、零数据外发、bounded result、typed action | 采用外部 chart service、通用 SQL write、自由 HTML/script、PTC/Bash 作为默认规则执行 |
| 架构 | 加深现有 Hima client/Workbench/Pack/Ledger seam | 新建 BI 控制面、第二事实数据库或第二 Campaign executor |

## 8. 最终建议

采用优先级：

1. **立即采用：** 官方 right-sidebar、Slots、tool-view、Deliverables、Bundle/Inventory；它们已经在当前
   Hima 客户端中存在。
2. **隔离 POC 后采用：** `dsh-data-agent` 的 typed report、ECharts、frozen replay、offline HTML 模式。
3. **选择性移植：** `dsh-tool-stat` 的确定性统计算法与 fail-closed 测试；PaperMachine 的 trace/provenance/
   artifact-version 产品模式。
4. **仅原型：** `dsh-genui` 的丰富组件、local interaction 与 ECharts lazy-loading。
5. **不采用：** 外部 chart service、完整通用 SQL/Data Agent、自由 GenUI 作为权威报告、PTC 作为默认
   Rule runtime、Session FTS 作为 Library source store。

产品特性的排序也必须遵守用户的两个原则：先证明它改变工程判断/行动，再证明它可以从 Lib API 的
真实字段和受控派生中产生。缺任何一项，就不进入首个产品版本。

本次没有复制任何社区代码。若后续 POC 移植 MIT 代码或图表组件，必须逐仓核对 `LICENSE`、
`THIRD_PARTY_NOTICES`、依赖许可与 NOTICE/attribution，并记录固定 commit，而不是只依据 README badge。

## 来源

- [DeepSeek Harness official repository](https://github.com/deepseek-ai/deepseek-harness)；调查时 master
  commit [`c36a83f`](https://github.com/deepseek-ai/deepseek-harness/commit/c36a83ff6bb95e3f82cf79f9be7c724270a8aa61)。
- 本仓库安装的 DSH `0.1.5-alpha.1` package references：`dsh-client-ui-sidebar-right`、
  `dsh-client-ui-renderer`、`dsh-client-ui-deliverables`、`dsh-mcp-client`、
  `dsh-code-runtime-worker-thread`、`dsh-session-query-sqlite`、`dsh-app-boot`。
- [`dsh-data-agent`](https://github.com/omdsh-dev/dsh-data-agent)，MIT，v0.1.5。
- [`dsh-genui`](https://github.com/omdsh-dev/dsh-genui)，MIT，0.11.1-preview.2。
- [`dsh-tool-stat`](https://github.com/omdsh-dev/dsh-tool-stat)，MIT，GitHub-source package。
- [`PaperMachine`](https://github.com/SuperJJ007/papermachine)，MIT，v0.1.2。
- [`dsh-plugin-chart`](https://github.com/lxfu1/dsh-plugin-chart)，MIT；README 明确说明 chart data 会发送到配置的 chart service，因此不适合 proprietary Library。
