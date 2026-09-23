# HimaHarness 下一阶段总体任务清单

更新：2026-09-23，第二次归并。源码基线：`bfa59f0f9b81b23bb4727419eaf2c2753e29a400`。

本轮增加用户提出的两项要求：**提示词与上下文表达更符合人的直觉；Session/Campaign 的 memory 能支撑长时间任务。** 它们与 Guide、上下文、恢复、研究经验存在重叠，因此先合并职责，再具体化可并行的工作，不增加新的架构层。

需求澄清进行中：[决策树与访谈记录](specs/next-stage-clarification/interview.zh-CN.md)。下面清单仍是规划，未答问题的建议不视为已确认；共同理解由用户确认后再进入实施。

总跟踪：[总体任务 #52](https://github.com/lluzi/hima_harness_reforge_polishing/issues/52)。需求以 [产品定义](product-definition.md) 与 accepted ADR 为准。本轮仅整理规划和依赖，没有派工实现、安装组件或恢复测试。

**结果：原 10 条线、37 项规划，归并为 8 个工作包、29 个任务。** 10 个旧项合入已有任务，新增两个 memory 专项；原需求均保留，旧编号映射见文末。工作包只是开发分工，不对应 8 个新产品模块。这里是可拆分的总体清单，实施前仍需在 Issue 中补齐具体接口、复现、测试和回滚。

## 已确认的访谈决定（R1）

- 分批交付，符合依赖/文件所有权的工作可以并行；不是删减八个工作包的目标。
- Guide 为独立、长期可返回的面向人入口；每个执行任务与 Subagent 使用独立上下文，不让执行团队占住 Guide。B1/B3/C1 按此明确会话创建与交接，具体反馈/控制方式待 R2。
- 耗时 Data Insight 沿用可恢复的受控任务/Run；用户留在 Insight 面板，浏览报告不创建 Run。
- 本任务及同项目默认组织并引用已授权的记忆；跨项目偏好确认，设计资料不自动串用；项目范围待下一轮定义。
- 原授权/预算有效、无人类暂停且状态明确的意外中断自动接续；未知副作用不重试。后台常驻范围待 R2，不恢复当前暂停测试。
- 用户可以在 child 的委派范围内直接调整执行并同步 owner，跨目标/预算/数据范围再协调。

以上是用户已确认的产品选择；后续问题仍未全部澄清，尚未进入实现。记录见 [访谈决策树](specs/next-stage-clarification/interview.zh-CN.md)。

## 一览：八个工作包

| 工作包 | 合并范围 | 用户最终得到什么 |
| --- | --- | --- |
| 1. Guide、提示词与表达 | Guide、产品/Pack 术语、动态上下文、准备/解释 | 能听懂、能准确识别当前任务、能带用户做完工作 |
| 2. 长期记忆与研究反馈 | Session/Campaign 连续性、上下文恢复、每代反馈、经验引用 | 长任务接续时不丢目标与关键决定，下一轮用得上有效经验 |
| 3. Agent 协作与委派 | 角色、上下文、并行、Coding/研究/操作授权 | 专业分工和真实执行，主 Agent 不必包办所有工作 |
| 4. 可靠执行与交互 EDA | 人类控制、Site、Job 恢复、结果有效性、Terminal/Operator | 可控制、可恢复、不会重复操作的实际 EDA 工作 |
| 5. Pack 开发与发布 | SOP 转方法、Reader/规则、反例、作者恢复、安装/升级 | 第二位作者也能交付可用 Pack |
| 6. 双模式工作区与子会话 | Campaign/Data Insight、可理解结果、Subagent transcript/context | 同一视觉体系中看数据、看执行、看各 Agent 的实际工作 |
| 7. Library 数据分析 | 原生 API、数据语义、三类洞察、自定义算法 | 正确条件下的 Library 比较、风险与设计影响分析 |
| 8. 验证、交付与客户价值 | 生态接入、回归、App/Pack、真人使用、成本/收益对照 | 可安装、可验证、可交接且有购买理由的产品 |

## 不改变的架构与范围

- 沿用 DSH、Pack、Fabric、Site、Job、Ledger、Workshop、知识/归档及现有 Workbench；不新建 memory 服务、第二数据库、第二 Agent Loop 或图引擎。
- 一个 Campaign 保留唯一业务 owner；局部工作可委派，独立任务可并行，设计/终端的改变状态操作保持单写者。
- Campaign 与 Data Insight 同级；Subagent、代码、终端和证据是共享工作视图。只读是角色配置，不是整个团队的能力上限。
- 新 memory 只帮助恢复理解和查找材料；目标、权限、暂停、作业是否执行及测量结果继续读取原权威。摘要不能替代执行事实。
- 保留历史证据、golden 输入、旧方法版本和用户资产。固定 Pack 不被聊天或 memory 自动改写。
- 下列测试均为将来验收计划，尚未运行。Liberty 原生 API 的阻塞与测试暂停状态没有被本清单解除。

## 1. Guide、提示词与表达

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-B1 / P1 | Guide 保持独立管家会话；统一 Guide、Pack、角色提示词的职责说明和面向用户的语言；整理产品/领域术语及别名；稳定角色说明、动态任务摘要、用户回复分别组织。沿用 `HIMA_PRODUCT_CONTEXT`、Pack 方法/技能和现有标签 | 用户能说出“在做什么、结果如何、哪里受阻、下一步需要什么”；当前版本/适用边界有依据；内部 ID/协议细节可下钻，不以其充当默认解释 |
| NXT-B2 / P1，首批 | 同一套有来源的任务上下文：用户选中对象、owned Run、报告/节点/child、时间/版本、当前已知与缺项。由现有 Host/`himaRuntimeContext`/Preparation 投影，UI 与角色共同消费 | 不猜 Run ID、不全盘搜索；selected 不变成 owner；旧摘要/错对象/迟到响应不覆盖当前事实 |
| NXT-B3 / P1 | Guide 主动发现 Pack/Site/输入/知识，研究问题并解释结果；给具体准备方案、缺项和恢复出口；安排独立执行会话，自己保持可交互；把作者工作交给原作者会话 | 新用户与返回用户都能继续；不要求先懂 YAML，不重复 Campaign；研究解释引用当前证据，作者衔接由 G1/G3 完成 |

### 新要求：提示词与表达的具体范围

不是只改几句 UI 文案。要核对 HimaGuide、Pack Intent/Spec/Knowledge、节点/研究模板、交接摘要和错误说明是否使用一致的概念，并区分三类内容：

| 内容 | 应当怎样组织 | 不改变什么 |
| --- | --- | --- |
| 给 Agent 的角色与操作规则 | 职责、能做的事、输入输出、判断边界和升级条件清楚，按角色按需加载 | 精确的工具/schema/权限语义 |
| 动态上下文 | 目标、当前对象、已完成与未完成、重要决定、最近证据、下一步，附精确来源引用 | 由 Host 决定的身份和运行事实 |
| 给用户的解释 | 先说业务结果、原因、影响和下一步；需要时展开技术细节 | Liberty、setup/hold、单位/条件等必要 EDA 精度 |

表达示例是待验证的产品文案，不是实测结果：`owner epoch stale` 的默认解释可为“这个会话已不负责该任务，请打开当前负责的会话”；缺 observation 应说明“还缺更新后的时序报告，暂时不能判断结果”，而不是让人先理解内部记录类型。Campaign/Data Insight 的稳定名称可以配中文说明，不为易读而随意改协议 ID。

验收同时检查可理解性与正确性：新用户能指出下一步，专家能找到原字段和证据；短文案不能隐去失败、未知或改变技术结论。Guide/B1 定义公共表达原则，Pack 作者和 UI 使用它；不各自维护一套相互矛盾的提示词。

## 2. 长期记忆与研究反馈

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-M1 / P1，首批先核查 | 对当前 DSH Session log、compaction、恢复、SessionQuery、context 注入及 Hima Run/Knowledge/Archive 做能力对照，明确哪些已持久化、哪些会丢、哪些可用公开接口读取/写入 | 一份来源/保留期/作用域/恢复路径表和最小反例；不得以“支持长上下文”推断长任务 memory 已成立 |
| NXT-M2 / P1 | 在现有 Session/工作区/知识载体内形成有来源、可恢复的工作摘要；区分 Session-only、Campaign 和 child 范围；读取当前权威后再装配下一轮上下文 | compact、重开会话、owner handoff、Host 重启、子任务完成后的目标/决定/待办保持；不重复 Job、不突破暂停、不串 workspace；过时/冲突/未知可见 |
| NXT-H1 / P1 | 合并每代变化展示与 Researcher 的反馈行动：保留原 demand/frontier 分母、fixed/remaining/entrant/regressed，记录假设、代码/动作差异、下一策略或具体 Cell Demand | 冻结 candidate pool 的反馈 A/B 可解释；研究实质变化与只改措辞区分；负结果/部分结果如实保留，真实收益单独验证 |
| NXT-H3 / P1→P2 | 让有效经验跨任务可检索、有条件引用、可纠正/失效并经验证晋级；沿用 Knowledge/experience/Pack archive | 能追到来源和适用设计/工具/版本；历史建议不覆盖当前指令/测量；用户能查看并纠正“不再采用”的记忆，原审计事实仍可追溯；新方法经确认发布 |

### 新要求：memory 是待设计能力，不预设新系统

先区分用途，再决定已有载体怎样复用：

| 用途 | 要保留什么 | 首选已有来源 / 谁维护 |
| --- | --- | --- |
| Session 连续工作 | 当前目标、明确决定、偏好范围、未决问题、待办与相关材料引用 | DSH Session/实际可用恢复接口及获准工作区；M1 先核查，不默认写自定义 Session 事件 |
| Campaign 接续 | 当前 Run/代际/方法/输入、最近有效结果、暂停/预算、已启动或已完成的动作 | Fabric/Ledger/Job 原记录；M2 只整理引用，A3 负责真正的执行恢复 |
| Subagent 交接 | 委派任务、输入快照、工具范围、进度、结果/未知与 parent 关联 | 原生 child Session + 原有执行/产物记录；只继承获准范围，不全量复制所有父历史 |
| 跨任务经验 | 成功/失败条件、验证证据、反例、可重用方法及失效条件 | 当前知识、experience 与 Pack archive；H1 产经验，H3 负责采用与晋级 |

每项记忆需要可追溯的来源、所属范围、生成时间/版本及采用状态。模型生成的摘要/假设与确定性事实分开；检索只提供候选，恢复时重新读取当前 Run/Job/控制状态。忘记一项建议不等于删除它指向的原始试验记录。

不要先选向量库或 memory 插件，也不要把整个 transcript 长期灌入 prompt。先看当前 DSH 哪些接口实际可用；若现成 Session 事件写入不被支持，使用已有获准文件/知识产物与引用，不能直接改 Session 文件或插入不可恢复的事件。确有检索质量/规模缺口再做隔离候选评估。

首组恢复样例应包含：没有 Campaign 的长对话；12 小时任务中途 compact；旧摘要说继续但人类已暂停；Job 实际完成但摘要滞后；同名不同版本报告；child 返回时输入已换代。它们是验收设计，不是本轮已完成的长时测试。

## 3. Agent 协作与委派

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-C1 / P1 | 合并角色/任务合同与并行调度：核查 pinned DSH 原生入口，配置专业角色、上下文、工具、预算、依赖、取消与结果回收 | 初始一次性 Analyst→Reviewer；独立 counter-analysis 可并行；owner-only 同输入 A/B；旧身份/重复结果/超预算拒绝；Agent 与 CPU/许可并发分开 |
| NXT-C3 / P1→P2 | 编码、研究与 EDA 操作的有界委派：分配 workspace/工具，产物复核与可撤销节点级操作权 | 真实 Coding/测试可查；Operator 必须等 F2/F3 资格与单写者协议；不把普通 Coding 权限扩大为整个 Run owner 权限 |

独立会话的显示、上下文与 transcript 由工作包 6 的 C2 实现，不再另造团队 UI。工作摘要/恢复来源由 M2 提供；对业务产物的研究评价由 H1/G2/J1 承担。

## 4. 可靠执行与交互 EDA

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-A1 / P0 | 持久的人类暂停与明确恢复，现有控制记录/入口执法 | Job 完成、compact/重启后 Agent 不能自行解除 human hold，L2 + 关键 L3 |
| NXT-A2 / P0 | Site 再发现保留全部管理员政策、Permit 身份、容量/绑定 | 探测事实与政策分开；显式 diff/确认；不静默放宽权限 |
| NXT-A3 / P0 | 合并 Job/owner 接续、通知去重与必要诊断：显示谁在等什么、实际进度与最后有效事件 | 同 Run、无重复 Job；忙碌/断连/重启/乱序可解释；诊断指标不变成业务事实；已修 #48 保留回归 |
| NXT-A5 / P0（业务采用前） | 多目标建议/完成门一致，best DB 有同代 timing、DRC/connectivity 和约束覆盖证据 | setup/hold 四组合与物理退化反例；保持已有 all-verdict guard；不虚构已发生 false completion |
| NXT-F1 / P1 | 普通 Bash 保留，补精确版本 terminal consumer 与局部 preset，支持真实 PTY 多轮输入 | 本地 REPL、owner 隔离、作者禁 shell、等待/中断/关闭；保持无通用工具 preset 的边界 |
| NXT-F2 / P1 | 交互 tool 纳入既有 Job/Channel/Fabric：会话、输入回执、transcript、超时、预算/许可与恢复 | wait 不 kill；发送失联不盲重发；单写者/unknown/人类控制正确；不建第二控制器 |
| NXT-F3 / P1→P2 | XTop manual ECO Operator 的版本化 adapter 与小型真实资格验证 | 加载一次 DB，查询→修改工作副本→检查→保存→独立验证；保留两个保路 Tcl，禁止以 prompt/退出码单独认证业务成功 |

依据：[执行问题评审](product-review/2026-09-22-next-stage/review.zh-CN.md)、[交互 EDA 规格 / #50](specs/interactive-eda-v1/spec.zh-CN.md)。A3 的运行事实恢复与 M2 的理解恢复分别负责、共同验证；记忆不能替代 tmux/进程/checkpoint 的实际核对。

## 5. Pack 开发与发布

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-G1 / P1 | Guide 的研究/作者交接并入现有五阶段：SOP/脚本/报告到明确目标、合同、节点、工具、反馈和人能读懂的方法说明 | 采用 B1 公共表达和 B2 上下文；第二位作者完成小 Pack，业务义务可追到产物 |
| NXT-G2 / P1 | 工具/Reader/规则/失败恢复模板与反例库 | 真零值/空报告、容器参数、二次保留、多个目标、缺字段等先便宜验证；复用旧测试，不复制验证平台 |
| NXT-G3 / P1 | 作者 packStage 恢复、测试范围、发布/安装交接、升级回滚和资产保留 | B3/M2 对接原会话；发布完整性与业务成熟度分开，实际版本明确，旧资产不丢 |

提示词的公共角色/语言由 B1 定义，Pack-specific 方法仍由 Pack 作者维护。已发布方法变更经过候选/测试/确认，memory 不直接改活动 Pack；DSH plugin 和 HimaPack 的开发验证不能互换。

## 6. 双模式工作区与子会话

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-D1 / P1 | 合并 Start 双入口、同级 Campaign/Data Insight 和跨报告/执行/代码/终端导航，复用当前 dock/视觉 | Agent 按任务打开正确 panel；浏览报告不造空 Run；迟到结果不串对象；草稿/选择保持、后台不抢焦点 |
| NXT-D2 / P1 | 合并用户结果摘要、图分组/搜索、best/未解决项和配置错误出口，使用 B1 的表达原则 | 用户理解状态和下一步；错误不困在 Reading；专家能下钻原字段/来源；键盘与窄窗口 L3 |
| NXT-C2 / P1 | 独立 child Session 视图：任务、实际上下文/来源、transcript、工具调用、diff/测试/产物，以及明确接收者的跟进 | parent 不被误停/接管；缺失历史不补写；已完成/归档仍可查；M2 说明恢复摘要与历史快照区别 |

详细设计：[双模式与 Subagent / #51](specs/workbench-modes-and-subagents/spec.zh-CN.md)。Data Insight 的 Library renderer 由 E3 提供，任务导航由 D1 提供；subagent 生命周期由 C1/C3 提供，C2 只投影并调用获准操作，不维护另一份 Agent 状态。

## 7. Library 数据分析

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-E1 / 前置阻塞 | 原生 API 读取/查询与隔离失败处理资格化 | #49 留存 lib.name exit139；等待可用厂商包/说明或另行授权诊断；本清单不启动 debug |
| NXT-E2 / P1 | Library 版本、Cell/arc/condition/PVT/单位/工作域、unknown/provenance 的 facts 和 delta | 真数据在 E1 后接；丢字段/崩溃不形成半份事实；库事实与设计证据分别定位 |
| NXT-E3 / P1 | 三类分析的 typed report 与表图：库健康、库性能、设计影响 | 同族版本比较首切片，load/filter 联动并回到原证据；使用 D1 的 Data Insight 宿主，不重造 UI 外壳 |
| NXT-E4 / P2 | 客户规则/Python 算法、保存分析方法及后续验证 proposal | typed I/O、fixture、版本/权限/预算，关联 G/H；不默认修改 golden Library |

E1 阻塞真实数据接入与对应验收，不阻塞无副作用的导航、合同/视觉研究；遵守 [#49 的真实接入门](package-development/library-intelligence-platform/first-slice-spec.md)。

## 8. 验证、交付与客户价值

| 任务 / 优先级 | 具体交付与默认归属 | 完成证据 |
| --- | --- | --- |
| NXT-J1 / 持续 | 合并生态接入资格和低成本验证：原生接口优先，候选组件 pin/许可/消费契约/退出边界明确；按影响建立回归和小型真实模型测试 | [组件清单](product-review/2026-09-22-ecosystem-reuse/component-shortlist.zh-CN.md)只作候选；installed/mounted/verified 分列；重放/合成不冒充真实；无必要不升级 DSH |
| NXT-J2 / 每次发布 | 可安装 App/固定 Pack、兼容/资产迁移/回滚、当前手册和发布证据 | runtime 字节变化单独打 App，用户无需跑源码；发布前验证不扩成完整商业研究 |
| NXT-J3 / 里程碑 | 合并陌生用户使用、真实业务闭环与客户价值对照 | 能上手、查看/控制/恢复/交付；同输入/工具/预算比人工干预、工时、有效试验、计算/许可与交接；再扩大设计/人员/Site |

Timing Closure 验执行交付，Library 验洞察决定，DTCO 验研究上限。+5% Fmax 仍属于具体研究目标，不是所有发布的前置。领域工具与合格 Pack/经验资产形成客户留存，允许客户自有 Harness/coding agent 接入，成果可携带。

## 先明确四项共享约定，再解耦开发

下表是现有接口的读写约定，不是四个新服务，也不在本轮锁定详细 schema。

| 共享约定 | 提供方 | 消费方 | 必须先明确的内容 |
| --- | --- | --- | --- |
| 面向人的表达与角色说明 | B1 | Guide、Pack 模板、UI、Operator | 公共词汇/别名、默认摘要、展开细节、事实/假设/未知的表达 |
| 任务上下文与恢复摘要 | B2 + M1/M2；A3 提供运行事实 | Guide、child、Pack 作者、工作区 | 精确对象/版本/来源、作用域、何时失效、缺项与重新读取；不以摘要授权 |
| 委派与交互回执 | C1/C3 + A/F | 团队视图、Operator、memory | 任务/child/Job/command 身份、单写者、完成/未知、取消/暂停和采纳关系 |
| 分析/产物的视图数据 | E2/E3、既有 Reader/Archive | Data Insight、报告、Guide | 数值/单位/条件、unknown、来源/版本、只读选择与行动 proposal 分界 |

没有必要先设计一套万能数据协议。先以“继续一个暂停任务”“打开一个 child”“解释一个 Library finding”“完成一条交互命令”四个具体样例确定最小字段与失败例，再交给各线实现。

## 可并行工作与文件所有权

| 开发线 | 可以独立推进的部分 | 对接点与共享写入限制 |
| --- | --- | --- |
| 表达与 Guide | B1 的语言/角色/示例，B3 的交互路径；对照现有 context | 消费 B2/M2；公共 `index.ts/tools.ts` 注册由集成者落地；不改 Run 状态机 |
| Memory 与研究反馈 | M1 能力盘点、M2 恢复用例、H1/H3 的证据与经验逻辑 | 复用 Session/Knowledge/Archive；运行事实接口从 A3 读；不直接改原生 Session 存储 |
| 工作区与子会话 UI | D1/D2/C2 的视觉/导航/错误/历史展示，可用冻结视图样例开发 | 消费 task/child/report 只读接口；UI 负责人统一 `HimaWorkbench/client/index`，不碰执行许可 |
| Pack 与领域分析 | G1/G2/G3 的作者材料和测试；E1/E2/E3/E4 的隔离 adapter/report | Pack 路径分开；共享 `packs.ts/release.ts/workshop.ts` 每批指定一个 owner，UI 宿主归上一线 |
| 执行与终端 | A1/A2/A3/A5，F1/F2/F3，C1/C3 的权限/派发适配 | `fabric.ts/ledger.ts/jobs.ts/channel.ts` 及共享 Host 接线单一集成者；terminal transport 与 Pack adapter 在合同冻结后分开 |
| 验证与交付 | J1 用例/fixture/候选检查，J2 发布准备，J3 使用与成本基线 | 等相应实现后跑验收；不为补报告另开商业 Campaign |

逻辑并行不等于同时改同一文件。`index.ts/remote.ts/tools.ts/fabric.ts/ledger.ts` 等共享接线和状态定义由主集成者协调；其他开发线先交可独立验证的内容、局部实现和接口用例。常规实现 Terra/Medium，权限/恢复/证据关键复核 Sol/High；按现行政策一次主任务加最多三个 worker，以上六线可分波次，不机械开六个 Agent。

## 建议推进波次

1. **先归并与小接口核查。** B1/B2/M1 确认语言、上下文和 memory 实际载体；A 的已见问题建立最便宜反例；D1/C2 做导航/会话视图设计；G2 复用已有反例。不等待完整 memory 产品才做文案与 UI。
2. **接口冻结后并行第一批。** Guide/表达线、Memory/恢复线、UI/子会话线可使用相同冻结样例各自推进；主集成者承担必要控制修复与接线。Pack 方法/报告可单独准备。此处是建议顺序，尚未派工。
3. **接入实际能力。** C 的权限/协作、F 的交互 Job、E 的合格真实数据接入分别按前置推进；H 用真实反馈验证。A 的控制门未闭合不开放新的委派写入；E1 未通过不宣称真实 Library 已可用。
4. **组合验收与交付。** 先 L0–L3，再分别小型 L4 模型/工具；最后在明确恢复/新测试授权和预算下做代表业务与真人验收。当前 trial30/Claude 测试继续暂停。

## 合并映射与跟踪

没有列在“被合入”一栏的旧 NXT 编号继续保留原身份。合并意味着同一个负责人和验收结果，不意味着原要求删除或已完成。

| 旧编号 | 合并到 | 保留的要求 |
| --- | --- | --- |
| NXT-A6 | NXT-B1 | 版本/能力说明、权威概念对齐与用户易懂表达 |
| NXT-B4 | NXT-G1（B1/B3 提供公共 Guide 能力） | 研究解释与作者连续交接，不新开另一套 Guide |
| NXT-C4 | NXT-C1 | 并行、依赖、预算、跟进/中断/恢复与结果身份 |
| NXT-F4 | NXT-C3（依赖 F2/F3） | 独立 Operator 的有界实际操作委派 |
| NXT-A4 | NXT-D2 | 配置失败的错误、修复与 Retry 出口 |
| NXT-D3 | NXT-D1 | 跨视图准确导航、草稿/选择保持、后台不抢焦点 |
| NXT-H2 | NXT-H1 | 反馈落实为具体策略/算法/Cell Demand，冻结 A/B |
| NXT-I1 | NXT-J1 | 生态 pin/资格/退出边界与接入验证 |
| NXT-I2 | NXT-A3 | 必要诊断、运行等待解释和无噪声通知 |
| NXT-J4 | NXT-J3 | 客户成本/收益、第二设计/人员/Site 对照 |
| 新要求：提示词与人的直觉 | NXT-B1，并由 B2/G1/D2 使用 | 内部规则、动态上下文、用户表达分开设计，真实可理解性验收 |
| 新要求：长期 memory | 新增 NXT-M1/NXT-M2，连接 H1/H3/A3 | Session/Campaign/child 的记忆、恢复、作用域与事实核对 |

[#52](https://github.com/lluzi/hima_harness_reforge_polishing/issues/52) 更新同一清单，不另建重复总任务。#51 对应 D1/D2/C2；#50 对应 F1/F2/F3 与 C3 的 Operator 部分；#49 对应 E 系列。#41 既有 UI 成果继续复用；#30、#38–44 先核对源码/证据再处置；#48 已修内容只保留相关回归。

本次 29 个任务仍为规划，不是“29 个已就绪实现票”或完成计数。后续逐项补规格与最小反例后再派工。原 [37 项清单快照](https://github.com/lluzi/hima_harness_reforge_polishing/blob/bfa59f0f9b81b23bb4727419eaf2c2753e29a400/docs/polishing-backlog.md) 与历史证据保持可查。

本轮规划校验：原 37 项经 10 项合并与 2 项新增得到 29 个唯一任务，旧要求均有映射；GitHub #52 的 29 项与本文一致；75 个本地文档链接无缺失，`git diff --check` 通过。没有运行产品测试或更改运行时代码。

## 历史工作单（2026-09-11～14，非当前执行顺序）

以下保留原规划、当时状态和 POL/PLS 锚点。它们只用于追溯，不覆盖本文当前清单、最新产品定义与 ADR。

历史顺序（2026-09-14）：用户真人试用否定 `v0.2.0-trial.1` 的产品准入，并确认[产品升级设计树](product-upgrade-interview.md)。后续唯一现行计划是 [Product Upgrade v2](specs/product-upgrade-v2/README.md)：PLS-27～35 在现有模块上完成产品上下文、Pack、Site、离线知识、Campaign Preparation、Campaign Agent/Side Talk、完整图、可迁移 Fmax-DTCO Pack 和 `aes_cipher_top` 目标 reg2reg 候选验收。此前 26/26 表示历史工程任务完成，不代表当前产品升级已经开始或通过。

本轮规格优先于下文 2026-09-11～13 的旧前沿和“同一个对话窗口”描述；既有实现、测试和证据继续复用。一个可见 Campaign Agent 保持唯一 Run owner，用户可在同一 DSH App 中新开独立 Side Talk，见 [ADR-0008](adr/0008-visible-campaign-agent-and-side-talk.md)。

历史顺序（2026-09-12）：[接收 ca47fa0 并在 polishing 完成 Step 4](specs/step4-takeover/README.md)。PLS-01～07 与 UI-02 保持已完成；新建 PLS-20～26，调整 PLS-08～19 的依赖。PLS-20 集成结果见 [实施证据](assessment/2026-09-12/pls-20/README.md)，后续按 Agent/输入/作者/方法身份→正式 probe→挖掘→资产/完整验收推进，不继续等待上游整体验收。以下 b4ac9d9 分析作为首轮背景，当前开工范围与模块以接续规格为准。

历史进度（2026-09-13）：26/26 个 PLS 实施任务已完成本轮验收。完整真实研究为有证据的负结果；增长控制使用独立真实模型补验，桌面使用由用户授权的独立 Agent 完成并录屏。前沿转为用户实际试用反馈与 Pack 方法质量改进，见[试用交付](validation/pilot-release/README.md)。不得把任务完成称为已验证 Fmax 提升或真人认可。

日期：2026-09-11。产品目标以 [已确认定义](product-definition.md) 为准；批次与测试层级沿用 [pilot 方案](pilot-plan.md) 和 [测试方案](testing-strategy.md)。本表保留原规划与产品动机；PLS-01～07 的实际实现、测试及边界见 [批次交付记录](assessment/2026-09-11/pls02-07/README.md)。后续任务仍按其依赖和 Step 4 交接条件开展。

实施任务已细化为 [Polishing v1 首轮规格与子任务](specs/polishing-v1/README.md)，其中明确模块、验收、分级测试和依赖；本工作单保留原 POL 编号和产品动机。

用户新增的 DeepSeek Harness UI 对标工作见 [UI-01 #20](https://github.com/lluzi/hima_harness_reforge_polishing/issues/20) 与 [对标/验证记录](assessment/2026-09-11/ui-benchmark/README.md)。首轮打磨现有导航、输入和报告阅读层级；后续聊天摘要与证据侧栏继续按现有架构及 Step 4 能力切片。

用户随后否定 UI-01 的分离页面与视觉方向，明确以旧版 himaharness 的视觉系统构建统一工程桌面。新的现行方向及实现见 [UI-02 #21](https://github.com/lluzi/hima_harness_reforge_polishing/issues/21) 和 [同屏工作区验证](assessment/2026-09-11/unified-ui/README.md)；UI-01 记录保留为历史，不是产品体验已获认可的证明。

2026-09-12 的执行迁移由同一个 owning conversation Agent 执行节点、Fabric 提供约束与事实，见已被后续决定收紧的 [ADR-0006](adr/0006-conversational-agent-owns-business-execution.md)、[执行补充规格](specs/polishing-v1/node-intervention.md)和 [PLS-19](specs/polishing-v1/tasks/PLS-19.md)。2026-09-14 继续保留一个 owner，但允许独立 Side Talk；当前执行归属以 ADR-0008 和 Product Upgrade v2 为准。

### 起点与判断

已从 prototype 的提交 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 导入 159 个文件。运行代码、Pack、Site 示例、依赖锁及测试原样保留；源项目说明移到 `docs/upstream/b4ac9d9/`。导入映射及逐文件 hash 见 [source-import.json](assessment/2026-09-11/source-import.json)。本轮没有产品源码修改。

这个基线具备真实 Host、桌面、Pack 自定义 Strategy、确定性判断/选策、多代循环、预声明 drill-down/fork-join、预算、阻塞恢复和报告。它仍只携带 `opene902-timing-probe` 参考 Pack；没有把尚未合入主线的 model-moment 分支提前拼进来。

因此工作分两段：先把已存在的执行与使用路径变成可靠的本地开发基础，再接收 Step 4 的研究能力，补齐已确认的产品要求。AI 的研究贡献、动态附加探索、知识资产交付都是首个里程碑的一部分，不能用桌面变漂亮或固定流程跑通来代替。

### 第一批：可以立即在本地推进

#### POL-01：建立便宜、明确的开发验证入口（P0，先做）

**已经证实的问题。** 全新安装后直接 `pnpm run typecheck` 失败：测试通过 `@hima/harness` 的包导出读取 `lib/types/index.d.ts`，该文件要先构建生成。先构建再检查可通过。另有两个测试文件在注册时探测真实 SSH：`pack.test.ts:694`、`ssh.test.ts:187`；根目录的全量 contract 命令会包含它们。现有 pre-push 还会重复构建。

**改动位置。** `package.json`、已有 `scripts/`、`.githooks/` 和上述两个测试文件；保留 Node runner、`boot-inprocess.ts`、`boot-host.ts` 与 `driver.ts`。先用薄的显式入口区分本地、桌面和真实 Site；必要时只移动混合文件中的真实 Site 用例与其专属辅助函数，原断言继续存在。首次准备先 build，之后根据产物是否受影响安排构建；不依赖过时的类型产物。

**完成证据。** 一个新工作区能按 README 完成安装、构建和本地测试；运行本地组不会加载真实 Site 测试；29 个原测试文件中的用例都有去向，迁移前后对账。分别报告首次与重复耗时、实际通过/失败/跳过和未跑范围。没有 unit 文件时明确报告“无用例”。先解决入口，再按实测成本决定是否下移重复的桌面组合。

**实施进展。** PLS-01 已分离三个混合文件的真实 Site 用例（逐例清点补充发现 `jobs.test.ts`），建立 local/desktop/live-site 文件入口和测试资源隔离，见 [验证记录](assessment/2026-09-11/pls-01/README.md)。PLS-02 已加入一次构建的 `check:local`、不内嵌构建的叶命令、受控短子集和 hooks 编排，见 [验证记录](assessment/2026-09-11/pls-02/README.md)；hooks 尚未安装。该切片不改产品执行语义，回滚范围限于入口和测试组织。

#### POL-02：让本地研究样例展示正确的研究行为（P1，POL-01 后）

**现有证据。** `packs/opene902-timing-probe/graph.yml` 默认使用 `timing-push`。诚实 stand-in 在满足约束时给出零 slack，这个 chooser 会继续放宽 period，直到预算耗尽。仓库已经有 `over-constraining-push.yml`，以及 `honest-standin.test.ts` 对照三个 Campaign 的反例。本轮已在 polishing 独立执行并通过这条测试，三个 Campaign 的预期差异得到复核。

**先作业务选择，再最小修改。** 确定用户打开 local 样例时是学习正确的 Fmax 探索，还是查看一个有意保留的反例。正常样例应有可解释的研究路线；反例继续保留在测试中。优先调整现有 Pack 的 chooser 绑定、方法说明及 local seeding，不能为修一个 Pack 的策略去改 Fabric 的通用状态机。

**完成证据。** 同一个本地受控模型下，可达目标与不可达目标得到正确而不同的结束原因；预算耗尽仍被诚实表达。记录实际测过的策略、约束与最佳有效结果，不能把“converged”说成“目标已达成”，也不能把 stand-in 的改善说成真实 EDA 收益。最低 L2 的方法对照与一条 L3 表单启动路径；真实工具结论要另做 L4。

**衔接。** 接入 Step 4 的正式 Fmax Pack 时复核这一局部改动是否仍有必要，消除重复实现。

#### POL-03：打磨从输入到恢复的完整桌面路径（P1–P2）

**已有基础。** `window.test.ts` 已有表单启动、非法值、取消、失败后继续及窄窗口检查；`remote.ts`、`card-labels.ts`、`workbench.ts` 和 `client/HimaRunCard.tsx` 承载相同运行事实的不同入口。不能从“已有测试”推断完整使用体验已好，也不能预先声称这些入口都坏了。

**具体走查。** 在隔离 local home 中依次记录：首次启动与空状态 → Pack/Site/输入条件 → 提交与防重复操作 → 正在执行/等资源/等人 → 一次明确失败 → 查看原因与证据 → 继续或停止 → 报告。把可观察到的卡点拆成单独修复，不同时重写整个工作台。对话与工作台对同一 Run 的身份、状态和证据要一致。

**重点核对。** 表单的 Goal 仍写死为 `target_period_ns`（`card-labels.ts:1153`，`workbench.ts:1216`），Strategy 已由 Pack 声明。正式 Pack 到来时要核对业务是否还适用；只有新 Pack 的明确需求不能表达时才扩大声明，而非先引入一套通用表单框架。Site 的静态匹配不等于真实工具已就绪，提示须反映实际做过的检查。

**完成证据。** 每个入选问题有屏幕/操作记录、复现和原因；L2 校验数据与操作结果，L3 只保留该交互必要路径。纯文字和样式不新增镜像测试。最终由实际使用检查确认可读性、焦点、滚动与错误后的下一步。

#### POL-04：把结束状态变成可复核的研究结论（P2）

**已有基础与差距。** `experience.ts:113` 已写 Site 上的 Markdown/JSON 并保存 hash；`experience-report.ts:90` 的报告主要包含 Run、代际、计量、路径和阻塞等执行事实。这些事实很有价值，但还不等于包含研究问题、算法、环境、有效负结果与后续实验建议的知识资产。

**分两次交付。** 先在已有报告与视图里明确区分目标达成、稳定但未达标、预算截断、执行故障和未形成证据，复用 Ledger 事实；随后在 Step 4 代码/模型记录可用时纳入假设、算法及脚本、引用、试验条件和下一步验证。未记录的环境或因果关系明确为未知，不由模板补出。

**完成证据。** 正常、有效负结果、覆盖不足、失败和取消的报告都能追到对应测量/日志/代码；失败或未运行的一代不支持设计结论。L1/L2 验证报告内容与 hash，L3 验证实际可达的阅读入口。分析质量及研究价值留给 L4/L5，不靠固定措辞的断言认证。

### 第二批：随 Step 4 快照接入，按依赖展开

| 切片 | 依赖与现有落点 | 具体工作及退出证据 |
| --- | --- | --- |
| POL-05：接入模型与 Workshop | 接收含对应实现、依赖锁和测试的主线快照；现有 Pack、节点执行、Ledger、视图 | 先核对新增能力和本地差异。用 replay 验证工具范围、取消/中断与代码记录，再用 DeepSeek V4 Flash 完成一项有真实输入、实际可执行产物和结果反馈的小研究。代码 hash、模型作用与工具结果可追溯；机制测试不能认证研究质量。 |
| POL-06：支持有界研究回溯与附加探索 | POL-05；`packs.ts`、`fabric.ts`、`node-turns.ts`、`workspace.ts`、`ledger.ts`、`generations.ts` | 先用一个 Pack 声明的探索点验证：保留参考图，新增工作有输入、影响节点、结束与返回条件，采用/放弃可追溯；改变策略或代码时只复用仍有效结果，受影响下游重跑。现有 revisit 和预声明 Loop 不等于此要求已完成。先验证一个位置，再扩大；不新增第二图引擎。 |
| POL-07：Pack 内知识归档与保留 | POL-04；与上游 Pack release/版本实现对齐；`experience.ts`、`packs.ts`、`local-site.ts`、已有记录 | 固定资产位置、一次运行的资产身份和必要材料；原报告保留，归档副本可核验。先解决方法文件身份与可变资产的区别。`local-site.ts:449` 当前会删除已安装的样例 Pack 后重拷，接入归档前须验证并修正资产保留路径；本轮没有宣称已发生客户资产丢失。写一半中断、重复归档、升级/迁移都不损坏历史。 |
| POL-08：让新研究用上旧知识 | POL-05、POL-07；Pack 知识与模型输入的既有入口 | 按授权选择相关资产，显式携带来源、适用条件和证据强度；当前结论仍需本次测量。方法升级由 Pack owner 确认后形成新版本；同客户升级保留资产，对外复制默认不带客户研究内容。先用有限资产集合实现，不新建知识检索服务。 |
| POL-09：完整 DTCO pilot | 前述必要能力闭环；正式 Pack、真实 Site、用户预算 | 用旧版最复杂的定制 Cell/Fmax 业务在新架构运行：输入 → AI 研究/算法 → 试验 → 反馈/回溯 → 结果判断 → 报告/资产 → 下一次引用。先小规模真实模型与工具检查，再进行完整 Campaign。保留对照条件和全部负结果，由资深工程师复核研究价值。 |

POL-06 涉及多个现有模块，适配成本必须明确估算。先拿出一条现有语义无法表达的最小用例，再定义新增记录或字段及其消费者，避免把“沿用旧文件”当成架构扩张没有成本的理由。以上代码落点是候选修改范围，并非要求全部改动。

### 最近三个交付点

1. **本地基线与测试入口。** 先收口 POL-01；交付能复现的命令、覆盖对账、耗时与未验证范围。
2. **一个可信的本地研究体验。** POL-02 加 POL-03 中实际复现的首个卡点，必要时带 POL-04 的对应结束解释；每个原因独立修改和验证。
3. **第一个真实 AI 研究切片。** 在明确的 Step 4 快照上完成 POL-05 的小任务，再处理回溯与资产要求。若上游尚未就绪，继续已有恢复/报告路径的局部工作，不复制一个竞争中的模型实现。

每个切片保留固定源 SHA、本地 diff、复现、根因、最低有效验证、原有覆盖去向及回滚方式。代码完整度和行为风险决定顺序；不按文件长度、测试数量或 UI 重写规模衡量进度。没有基于实测的估算前，不给整套工作承诺日历工期。
