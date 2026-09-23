# HimaHarness Polishing 产品定义与验收目标

状态：用户于 2026-09-11 确认初始共同理解，并于 2026-09-14 确认真人试用后的升级设计树，作为后续 polishing 的产品依据。本文描述产品要求，不是已实现能力或已通过验收的声明。原始问题、建议、回答与代码核查见[初始产品访谈](/Users/lluzi/code/hima_harness_reforge_polishing/docs/product-interview.md)和[产品升级访谈](/Users/lluzi/code/hima_harness_reforge_polishing/docs/product-upgrade-interview.md)。

## 用户与价值

首位核心用户是承担复杂系统性问题的资深工程师。产品让其借助 Pack、Harness、单点 EDA 工具与 AI，开展过去需要跨领域团队才能组织的研究、试验和优化，获得原先难以承担的新能力。

代表业务是基于定制 Cell 的机会挖掘与 Fmax push。核心价值是跨领域研究能力扩展；减少盯守和执行成本是附带收益。用户关于十人以上跨团队工作有望由一人承担的描述是价值设想，尚未测量，不作为已证明的宣传数字。

## AI 与工程师

AI 承担数据分析、假设与策略生成、试验组织、算法和脚本编写，以及基于结果反馈的继续探索。具体好策略不能全部预先写死。Pack/Harness 为模型提供方法骨架、工具、数据含义、约束和事实检查，降低理解与执行门槛。

Library-richness calibration 阶段的免费代理只提供各自指标、局部响应、适用范围和历史成功率；在这些因子尚未通过真实 EDA Commercial Label 证明相关性前，它们不能批准或拒绝 Action。逻辑等价、物理可实施性、权限、预算、proof 和 rollback 仍是硬约束。Information Graph 将免费因子与后续商业响应绑定在同一设计 subgraph 上，用累积证据决定未来哪些因子可以晋级为决策规则。

用户最新明确：一个可见的 Campaign Agent 是该 Campaign 持久 Run 的唯一业务执行主体。它读取 Pack 的参考路线与实际状态，执行节点内的研究、Coding 和工具工作，并根据结果及人类指令决定后续动作；用户可以在同一产品内新开独立 Side Talk 继续普通对话和 Coding，切换会话不改变 Run owner。Fabric 提供执行上下文、合法动作、资源/依赖约束、验收与事实记录；主产品路径不再由 Fabric 自主连续推进整张图。机械的 Job 执行、状态采集和硬约束继续由基础设施代码承担。见 [并行会话与执行主导权决定](adr/0008-visible-campaign-agent-and-side-talk.md)。

用户于 2026-09-23 进一步明确：Subagent 应有可独立打开的真实工作会话。工程师能查看委派任务、
实际可用的上下文/来源、完整保留的 transcript、工具轨迹与产物，并向明确的子 Agent 跟进。
研究/Coding/EDA 操作角色在分配权限内执行实际工作；只读是某些角色的配置，不是所有 Subagent
的能力上限。查看/切换子会话不改变 Run owner，未记录的上下文不得由模型补写。

2026-09-23 需求澄清 R1：用户确认 Guide 保持独立、长期可返回的管家入口，收集信息、安排工作并
解释结果；每个执行任务及 Subagent 具有独立上下文，团队执行不占住或污染 Guide 的对话。启动
Campaign 时采用独立执行会话，Guide 不直接转为该 Run 的 owner。现有单 Run owner 和事实/权限
边界继续成立，见 [ADR-0014](adr/0014-guide-is-independent-from-task-execution.md)。

用户确认可在子会话的委派范围内直接调整工作并执行，同时同步 owner；跨目标、预算或数据范围的
变化再协调，不把每次局部修改都退回重新派工。具体授权、消息和写入边界仍在后续访谈中细化。

模型基线为用户提供的 DeepSeek-V4.1-Flash（官方 API wire id `deepseek-flash`）。预期整体工作流可靠，模型能力差异主要体现在特定研究环节的创造力和思考深度；不能依赖只有最强闭源模型才能完成的隐性前提，也不要求最弱模型具备同等研究能力。

用户于 2026-09-23 明确要求改进提示词系统与面向人的表达：HimaGuide、Pack 方法和角色上下文对
产品的解释应一致、具体、符合工程师直觉。角色/操作规则、动态任务上下文和给用户的回复分开组织；
默认说明正在做什么、结果/缺项、原因与下一步，内部记录名和协议细节按需展开。必要 EDA 术语、
单位、条件和结果精度保留，不能为简短易读而改变判断。本轮先归并任务，尚未修改运行中的提示词。

工程师设定方向和关键业务约束，AI 在授权与预算内自主推进。工程师可随时查看、追问、纠偏或停止；真正缺少业务判断、无法继续或需要超出权限的动作时返回人，并附原因、已尝试内容和下一步。
本机 Agent 权限复用 DeepSeek Harness 的 permission preset；最高权限仍受 Hima Site Permit、Pack wrapper、Channel 约束和删除红线限制，见 [权限分层决定](adr/0009-dsh-permission-does-not-bypass-site-permit.md)。

工程师观察运行图时，通过 owning Campaign Agent 介入指定节点，例如暂停推进、检查输出、更新算法，再按授权继续或重跑。Side Talk 可以查看 Campaign 并引导用户打开 owner；只有显式 handoff 才改变执行所有权。每个节点都应可被准确定位和查询可用操作；Fabric 提供持续的双向接口并落实执行约束。收到请求、实际停止推进、当前 Job 是否结束必须分别如实表达。具体协议的既有基础见 [补充规格](specs/polishing-v1/node-intervention.md)，并由 ADR-0008 的多会话决定收紧。

## Pack 与探索行为

Pack 提供方法学与推荐做法。参考运行图不被 AI 改写或删节点；AI 可回溯、调整节点策略，并在 Pack 声明的探索位置生长附加节点。附加工作继续使用现有节点语义，明确输入、结束条件和返回位置，结果经判定后决定是否采用。

开始探索前须声明会影响哪些节点、结束后这些节点如何变化。历史记录保留；仍有效的结果复用；受策略或代码变化影响的下游重新运行。中断后依据真实执行状态，以最低合理成本恢复或重跑，不基于残缺失败结果推导设计结论。

可选附加研究可失败、取消或不采用，但保留其节点与历史。当前结论必需的证据未形成时，不能绕过检查宣称完成。时间、尝试、并发和 Site 资源受预算约束，预留分析与资产交付投入；不再有可验证的新问题时可主动结束并解释。

用户于 2026-09-13 明确：预算到期停止 Campaign 作业和新的分析写入，保留对话继续回答。
到期后生成的对话不作为该 Campaign 的预算内研究成果；最终交付由已持有的事实和缺失说明组成。

## 诚实性与知识资产

欺骗、幻觉和隐藏研究过程都会破坏信任。系统明确区分执行故障、探索覆盖不足、有效试验中的负结果，以及有证据支持的策略/命题判断。结论限定于实际设计、环境、方法和试验覆盖；未知必须保留，失败分析应为下一次验证提供有效输入。

每次 Campaign 交付详实技术报告，含充分证据、数据、环境声明、研究过程及必要支持材料。核心算法属于交付内容。失败同样需要形成可复核的认识，不能仅留下“没有提升”的标签。

运行知识资产归档到对应 HimaPack 内的固定位置。客户控制其数据和研究成果，模型按客户/Site 授权读取材料，来源和处理过程可见。Pack 原有方法和本次研究资产分别说明来源。
HimaHarness 软件与 HimaPack 分开交付；Pack 以固定格式携带自身知识，Harness 自带读取和文档到知识能力。用户可以追加本地或 Site 材料，普通用户不负责部署或运维独立知识服务。
Pack 保持透明并沿用现有目录/发布形态；用户追加文档作为当前知识使用，不自动改变 Pack 方法、内置知识或 digest。知识 parser、索引、检索 runtime 和基础本地能力由 HimaHarness 软件离线提供，不重复打入每个 Pack。
HimaHarness 产品团队维护覆盖核心实体、Pack 状态、工具身份、知识来源和证据结果的稳定 ontology；Pack Owner可以声明领域词和别名，AI 可以提出映射但不能自行改写核心语义。安装哪个固定 Pack 就运行哪个；新版本通过明确安装获得，不建设 Pack 自动更新生命周期。

新的研究主动使用与当前问题、设计和环境相关的历史资产，让用户看到引用来源、适用条件和证据强度。历史经验用于形成假设与策略，当前结论仍由当前试验验证。

自动归档和提出改进不直接改变参考方法。Pack 所有者或授权作者确认方法升级后形成新版本，保留原版本与历史。同一客户升级时保留资产，自身迁移 Pack 时可以携带；向其他客户或公共来源交付参考 Pack 时，不默认包含客户输入、结果或专有算法，由客户明确选择分享内容。

用户同日要求将长期 memory 纳入 Session 和 Campaign 的整体设计。先核查当前 DSH 的会话记录、
compaction/恢复、查询和上下文装配，以及现有 Run、Knowledge、experience、Pack archive 的可复用
能力，再决定工作摘要、跨会话引用和经验晋级怎样衔接。Session-only 工作、Campaign 事实、child
交接和跨任务经验分清范围与来源；不预设新的 memory 服务、数据库或自动进化存储。

记忆用于保持目标、明确决定、未决问题和相关材料引用，恢复后仍须读取当前 Run/Job/控制事实。
模型摘要不得清除人类暂停、扩大权限、伪造测量或导致重复 Job；过时/冲突/缺失应可见，用户能够
查看和纠正记忆的采用。长期 memory 的完整能力尚待设计和验证，具体归并与并行工作见
[下一阶段任务清单](polishing-backlog.md)。

2026-09-23 R1 同时确认：本任务及同项目范围默认组织和复用已授权的决定、经验与证据；跨项目偏好
须确认，设计资料不自动串用。“项目”的具体边界仍待下一轮决定。意外中断后，原授权有效、预算未
耗尽、没有人类暂停且实际状态明确时自动接续；副作用未知时停止推进并核对，不盲重发。关闭窗口/
退出 App 时的后台服务要求尚未决定，不能从“自动接续”推导为已承诺全天后台运行。

## 用户体验与部署

用户于 2026-09-11 进一步明确：这是芯片设计工程师使用的、以 Claude Code Desktop / Codex Desktop 为体验目标的统一工程工作区。视觉与界面组织参考旧版 `himaharness`：对话常驻，运行状态、执行路径、代码/文件与证据在同一界面中工作；通过链接在聊天和独立工作台之间跳转不满足这一要求。旧版仅提供视觉与使用体验参照，底层继续采用当前 DeepSeek 架构。

HimaGuide 支持对话、Coding、Fabric 和 Pack。默认帮助工程师看清研究问题与当前状态，比较路线和追问依据，提出修正、继续或停止；可以下钻参考/实际运行信息、代码、真实终端与原始报告。

Pack 安装后，用户可直接询问用途和运行条件。HimaGuide 在建立 Campaign 前完成 Campaign Preparation：主动发现和检查 Pack、Site、输入、知识及最小工具能力，只在无法判断时向用户提问；条件完备后给出简短 proposal，由用户一次确认创建 Campaign。

用户提供 Pack 要求的输入，在检查通过的 Site 条件下，应能顺利复现方法与研究闭环，并验证结果。不同设计或环境不承诺相同数值。条件缺口和适配责任在开始前呈现。
Golden Flow 是 Pack 作者学习、校准和测试方法的参考，不是客户运行 Pack 的必要输入。Pack 与 Harness 分开版本：Pack 只声明最低 Harness 版本，Harness 对既有 Pack 保持向前兼容；Pack 状态只用于展示，不改变 Runtime。

用户于 2026-09-23 明确：**Campaign 与 Data Insight 是同级产品工作模式**，Start 与工作区均应提供
入口/标签；Agent 收到 Library 分析需求时打开 Data Insight panel，收到执行型任务时打开 Campaign
准备或运行视图。Data Insight 不嵌套为 Live Run 的子页，打开已有洞察也不要求创建空 Campaign。
复用现有对话、Workbench/dock、主题、卡片、表格、图标和文件/终端入口；需要计算或验证的分析继续
使用现有受控执行与证据体系。后台更新不抢用户焦点，切换面板不隐式启动、暂停或接管任务。

两种模式均能打开 Agent 团队和独立 Subagent 会话，像普通 Coding 会话一样检查消息、上下文、工具
调用与代码/测试产物。它是共享协作视图，不是第三种产品运行模式。具体信息层级与验收见
[工作模式与 Subagent 方案](specs/workbench-modes-and-subagents/spec.zh-CN.md)，决定见
[ADR-0013](adr/0013-campaign-and-data-insight-are-peer-workbench-modes.md)。这些为已确认需求，尚未实现。

用户确认耗时 Data Insight 分析应有可恢复的任务身份、进度、预算和取消能力，后台复用现有受控
任务/Run，前台保持 Data Insight；浏览已有报告不创建任务。下一阶段分批交付，具备独立条件的
工作并行开展；每批具体硬验收范围仍在访谈中确定。以上均是需求决定，不是实现或测试通过声明。

首个版本先支持明确环境的试点部署；一次站点准备后，研究工程师通过桌面和对话工作，无需构建源码或维护内部 YAML。商业签名、通用安装包、多操作系统未列为当前已承诺里程碑，不因本稿自动扩展范围。

## 交互式 EDA 操作

用户于 2026-09-23 明确要求：Agent 应能通过终端持续操作 EDA，包括 XTop manual ECO；除一次性
Bash/批量作业外，还需支持同一进程中的连续输入、输出观察、等待、暂停/中断、保存和退出，避免
每条命令重新加载数据库。工具等待输入、命令完成、进程退出和业务目标达成必须分别表达。

Campaign 内的交互操作继续由唯一 owner 和现有 Fabric/Site/Job/证据体系约束；普通工程终端输出
不自动成为 Campaign 结果。交互工具内部命令的实际权限边界、输入去重、断连后的不确定状态、
checkpoint 与产物验证属于必要设计内容，不能以“允许启动工具”替代这些条件。

本轮用户选择先完成方案、接口和验收标准，尚未实施。具体范围、建议接口和分级验证见
[交互式终端与 EDA Operator 方案](specs/interactive-eda-v1/spec.zh-CN.md)。

## Library Intelligence 产品面

用户于 2026-09-22 明确：Library Intelligence 是 HimaHarness 基于 Liberty API 提供的原生业务能力。
用户继续使用同一对话，右侧 Workbench 展示可交互的数据洞察和可视化；洞察可以形成有依据的后续
行动建议，并支持客户自己的检查和分析方法。

面向用户只呈现三类分析，不把 Catalog、图表、Finding、Rule Studio、报告和 Action Center 分别包装成
多个产品功能：

1. **库健康与发布风险分析——这套库可靠吗？** 检查版本与 corner/view 身份、结构和单位完整性、
   Cell/pin/arc/constraint/model coverage、跨 PVT 一致性、数值趋势异常和 revision regression，帮助
   用户判断能否交付、哪些问题需要阻塞或复查。
2. **库性能与竞争力分析——这套库强在哪里、弱在哪里？** 分析 Cell family、drive/VT/PVT、delay、
   transition、constraint、area、leakage、internal power、variation 和工作域，帮助用户比较版本/方案、
   识别优势、短板和 Library 开发优先级。
3. **设计影响与行动分析——它对我的芯片意味着什么？** 将 Library finding 与当前设计实际使用的
   Cell/instance、path/endpoint、slew/load、mode 和商业工具结果连接，帮助用户决定先处理什么、下一项
   最便宜验证是什么，以及是否需要 candidate、STA/SPICE 或 matched implementation。

自定义规则、数据探索、可视化、证据追溯、报告和后续动作是三类分析的共同能力，不作为一级产品导航。
用户可以在分析过程中用自然语言增加组织规则或保存分析方法；产品把它们编译为受控、可测试、可版本化
资产，不让自由模型代码直接成为结果权威。Liberty API 能提供 Library 内事实和候选副本能力；设计采用、
真实 PPA、相关性和芯片结果仍须由 HimaHarness 的设计证据与实际 EDA 验证补充，不能由 Liberty 单独推导。

一线 AE 的竞品观察进一步明确共同能力：trend 分析允许切换 output load；用户可过滤不关注的 Cell；
同一视图可用类别、数值与 corner 等三个维度联合表达；客户可以增加自己的 Python 分析算法。HimaHarness
应在三类分析内部提供这些能力，但 Python 算法须使用受控输入/输出 schema、fixture、版本和执行边界，
不能成为无审计的自由代码。Milkyway、NDM 等第三方数据库不属于 Liberty API 的直接读取范围；只有在
Site 具备合法工具、许可和只读访问时，才通过独立格式 adapter 投影到相同语义身份，并保留原数据库为
权威。本要求不扩展为“任意格式天然支持”的产品承诺。
见 [Library Intelligence 三类用户分析决定](adr/0012-library-intelligence-has-three-user-analysis-surfaces.md)。

## 首个里程碑与验证责任

在 DeepSeek Harness 架构上运行旧版最复杂的 DTCO 探索业务，达到并超过旧版 OpenCode 平台的研究与产品能力，包括对话、Coding、优秀 UI、Fabric 与复杂业务的 Pack 表达。

Polishing 对修改后的版本独立设计并执行技术与产品测试，提供真实模型、真实 Site 下的研究、策略反馈、回溯、附加探索、恢复和资产交付证据。既有 prototype 验收只能作基线，不能代替新版本验证。用户或指定资深工程师通过实际操作与可复核技术报告判断研究价值。
下一试用候选先由 polishing 完成干净安装、无手册引导、Site 发现、`aes_cipher_top` 目标 Campaign、显式 reg2reg 优化压力、Matched Comparison、并行 Side Talk 和控制的低层产品验收，再由用户本人最终签收高级体验与产品品味。portable Pack 本身仍以 Site 输入绑定 design，不把 AES 写成方法不变量。
产品默认不上传客户材料、对话、Campaign 数据、工具日志、报告或 debug 文件；现场证据在本地或 Site 完整保留，需要支持时由用户审阅并明确导出。

Fmax 未提升不能伪装为指标成功，但有证据的负结果可构成知识成果。当前
`aes_cipher_top` 定制 Cell Campaign 的目标是 matched post-route Fmax 提升至少 5%；这是本次
Campaign 的研究目标和停止条件，不是跨设计、跨 Site 的统一产品承诺。预算在每次 Campaign
与 Site 条件下确定。

下表把已确认要求转成验收观察点。具体用例、故障场景与执行预算由 polishing 设计，不要求一次真实研究同时制造所有异常。

| 观察点 | 可审阅的完成证据 | 来源 |
| --- | --- | --- |
| 复杂 DTCO 研究闭环 | 真实模型与 Site 完成研究、试验及结果反馈，研究价值由报告和实际操作复核 | Q3、Q7、Q27 |
| AI 研究贡献 | 当前数据如何支持假设/策略、代码或算法、试验与后续调整，不能只展示固定脚本运行 | Q3、Q9、Q14 |
| 有界回溯与生长 | 参考图保留，附加研究的输入、影响节点、结束条件、返回位置及采用/放弃结果可追溯 | Q17、Q23、Q24 |
| 结果有效性与恢复 | 历史保留，有效结果复用，受影响下游重跑，意外后从实际状态继续，失败残缺结果不支撑设计结论 | Q15、Q18 |
| 预算与诚实收束 | 达到边界后不再开实验，完成必要分析和报告；区分故障、覆盖不足、有效负结果与未知 | Q16、Q25 |
| 知识交付与再使用 | 报告、证据、数据、环境声明、算法等支持材料归档到 Pack 固定位置，下一次相关引用可见 | Q20、Q26、Q30 |
| 方法与客户资产控制 | 方法升级形成经确认的新版本；资产在升级/迁移中保留，对外分享内容由客户选择 | Q29、Q31、Q32 |
| 完整产品体验 | Site/输入条件可检查，研究人员通过桌面和对话操作，能比较路线、追问证据、修正或停止 | Q10–Q12、Q19、Q21、Q28 |
| 独立验证责任 | 每个 polishing 版本以自身代码、测试结果和真实产品证据说明通过、失败与未验证范围 | Q6、Q27 |

## 工程边界

2026-09-12 接续决定：现在接收上游已提交快照 `ca47fa0`，在已交付 polishing 状态上完成剩余 Step 4；polishing 为唯一集成主线。固定快照、两个源目录只读和独立验证要求保持，原先等待上游完整 Step 4 的顺序更新。见 [ADR-0007](adr/0007-complete-step4-on-polishing-mainline.md) 和 [当前规格](specs/step4-takeover/spec.md)。本决定及规格发布不代表源码已整合。

Polishing 在 `hima_harness_reforge_claude` 当前架构上进行，源项目保持只读。代码需要先复制到 polishing 工作区，按 Step 1–4 和明确快照与 prototype 衔接，整合前核对差异，整合后独立验证。

非万不得已不新增组件。组件扩张的重要判据是迫使多个模块适配、增加边界测试与长期治理成本；优先改进现有职责中的函数、逻辑与行为。旧版架构仅供参考，能力对标不授权迁回旧架构。

相关决定：[架构约束](/Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0001-polish-within-prototype-architecture.md)、[快照与独立验证](/Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0002-step-aligned-snapshots-and-independent-validation.md)、[参考图与附加研究](/Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0003-preserve-reference-graph-and-grow-research.md)、[Pack 内归档](/Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0004-archive-run-knowledge-inside-pack.md)。
