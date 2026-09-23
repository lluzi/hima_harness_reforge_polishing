# HimaHarness 下一阶段总体任务清单

更新：2026-09-23。源码基线：`48bae4e0eecbfed7b4ec2e66bb2bcc800360e436`。

本文当前部分是下一阶段的总体规划入口，汇总用户六项原始要求、生态研究，以及新增的交互式 EDA Operator、同级 Data Insight 和独立 Subagent 会话。**本轮只刷新清单；没有开始实现、安装依赖或恢复测试。** 本文保留历史 POL/PLS 工作单作为追溯材料；旧日期的“当前顺序”不再表示下一阶段前沿。

总跟踪：[下一阶段总体任务 #52](https://github.com/lluzi/hima_harness_reforge_polishing/issues/52)，关联 #49/#50/#51 的详细规格。

需求权威仍为 [产品定义](product-definition.md) 与 accepted ADR。执行状态由 GitHub Issues 跟踪；此处的 `NXT-*` 是规划索引，不能据其存在或优先级视为已派工/已完成。进入实现前，每个切片都须补齐当前复现、精确代码范围、验收、测试层级、模型与回滚，不把总体任务直接当作可执行规格。

## 一览：十条工作线

| 工作线 | 下一阶段要交付什么 | 当前规划状态 |
| --- | --- | --- |
| A. 可靠执行与人类控制 | 暂停/恢复、Site 政策、错误出口、正确判定与 best 结果 | 有审查证据；先局部复现和修复 |
| B. 专用 HimaGuide | 理解业务、准确上下文、准备/恢复、研究解释、辅助编写 Pack | 复用既有接口，补角色与连续体验 |
| C. Subagent 团队 | 独立上下文、专业分工、并行、可查看/跟进的子会话与真实 Coding | 先原生能力/只读对照，再开放获准写入和操作 |
| D. 双模式 GUI | Start 和工作区的 Campaign / Data Insight 同级入口 | 需求与 ADR 已确认，界面尚未实现 |
| E. Library Intelligence | 库健康、库性能、设计影响三类分析及可交互证据 | API qualification 是真实数据前置；#49 |
| F. Interactive EDA Operator | 保留同一 EDA 进程，多轮输入输出、manual ECO、checkpoint 与恢复 | 方案/接口/验收已写；#50 |
| G. Pack 开发体系 | SOP/脚本/报告 → 方法 → 校验/测试 → 发布/安装/复用 | 加深现有五阶段作者体系 |
| H. 研究反馈与知识积累 | 每代解释变化、形成具体需求与下一策略、复用有条件经验 | 补反馈质量与晋级验证，不以代数替代收益 |
| I. 生态复用与工程效率 | 原生 seam 优先，候选依赖有 pin、边界、资格与退出方案 | 研究已完成，POC 与集成未开始 |
| J. 交付、真实验收与商业价值 | 可安装 App/Pack、陌生用户使用、业务闭环和成本对照 | 按受影响范围分层验证，不重开研究作发布门槛 |

## 基本边界

1. 一个 Campaign 保留唯一业务 owner；可以委派并行工作，但没有第二个 Run 主控。共享设计/终端保持单写者。
2. 沿用 DSH、Pack、Fabric、Site、Job、Ledger、Workshop 与现有视觉体系。新增视图不建立新的执行/事实系统。
3. Campaign 与 Data Insight 是同级产品工作模式；Live Run 留在 Campaign 内。Agent 依任务打开正确面板。
4. Subagent 有真实可独立打开的会话；研究、Coding、EDA 操作都属于目标能力。只读角色是分期与权限配置，不是整个团队的能力上限。
5. 原始输入、历史 Run/试用与 golden DB 保留；方法变更形成新版本。需要条件的权限或收益不能靠模型自述。
6. 所有以下验收均是待实施标准。低成本检查、真实模型、真实 EDA、真人体验和业务效果分别记录，不能互相替代。

## A. 可靠执行与人类控制

| 索引 / 优先级 | 任务与用户可观察结果 | 默认归属 / 最低验收 |
| --- | --- | --- |
| NXT-A1 / P0 | 人类暂停持久化；Job 结束、owner compact/restart 后不能由 Agent 自行清除 hold | 既有 `ledger.ts/fabric.ts`、控制入口；human-origin pause → Agent continue 拒绝 → 明确人类恢复，L2 + 关键 L3 |
| NXT-A2 / P0 | Site 再发现完整保留管理员 policy、Permit 身份、容量和绑定；观察事实不覆盖政策 | `sites.ts/index.ts`、Site UI；原配置再发现对照与显式 diff，L2/L3 |
| NXT-A3 / P0 | 可靠接续同一 Run；分清等工具/等模型/等人/失联；完成事件去重与恢复 | Job/recovery/owner inbox；忙碌/重复/乱序/重启反例，无重复商业 Job。#48 已修部分保留回归，不重复算新缺陷 |
| NXT-A4 / P1 | 配置读写失败有字段、原因和修复/Retry 出口，不长期停在 Reading | `ConfigurationPage`、campaign-file routes；坏配置与有效恢复 L2/L3 |
| NXT-A5 / P0（业务采用前） | 多目标建议与完成门一致；best DB 具有同代 timing、DRC/connectivity 与约束覆盖证据 | XTop chooser/Reader/compare + 既有完成门；setup/hold 四组合、物理退化反例。已有 all-verdict guard 保持，不能宣称已经发生 false goal-met |
| NXT-A6 / P1 | 当前 App/Pack/方法/证据版本清楚；权威文档和实际路由对齐 | Guide inventory、README/文档、Pack words；观察性 proxy 旧定义与当前政策的漂移修正，旧版本仍可追溯 |

根因与范围依据：[2026-09-22 产品评审](product-review/2026-09-22-next-stage/review.zh-CN.md)。这些不是本轮重新复现的全部 bug；实施前在当前源码做对应反例，防止修旧问题或重复修复。

## B. 专用 HimaGuide

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-B1 / P1 | 专用角色、稳定职责与小型能力清单；解释可做任务、适用输入、成熟度和未验证范围 | 复用 systemPrompt/context/Pack loader；无全盘搜索回答产品问题，L2 + 小型 L4 模型 |
| NXT-B2 / P1，首批 | 准确理解用户当前选择的 Run/node/report/child；区分 selected 与 owned | 显式消息引用由 Host 复验；错 Run/旧版本/切会话反例，不改变 owner |
| NXT-B3 / P1 | 主动发现 Site/输入/知识，给具体 proposal；重新进入后恢复同一工作 | A2/A4；用户无需先懂内部 YAML；不重复 Campaign，L2/L3 + 小型 L4 |
| NXT-B4 / P1 | 研究问题、解释结果和引导 Pack 作者各有明确交接；缺少业务事实时准确追问 | 关联 G/H；有引用的结论、草案与实际执行分开；新用户与返回用户都能继续 |

不通过新增一个同名聊天 prompt 宣称专用角色完成；也不要求 Guide 代替 owner 绕过执行接口。

## C. Subagent 团队与独立会话

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-C1 / P1，首批对照 | 核对当前 profile 的原生 subagent；给角色配置任务/上下文/工具/预算/结果合同 | B2，相关 A 控制门；当前 DSH pin、一次性 Analyst → Reviewer，owner-only 同输入 A/B；无净增益就不扩大 |
| NXT-C2 / P1 | 团队列表和独立 child 视图，查看任务、实际保留上下文、transcript、工具轨迹与产物 | #51；复用原生 Session/catalog/query/navigation；运行/完成/归档可查，缺失不补写，接收者清晰 |
| NXT-C3 / P1→P2 | Coding/Researcher 角色实际改算法、写文件、跑测试，独立复核并交付 | A1/A2/C1；分配 workspace 与工具范围，过期结果拒绝，测试按实际产物；不将只读永久化 |
| NXT-C4 / P1→P2 | 独立工作并行；有依赖的复核顺序执行；跟进/中断/恢复不影响错任务 | C1/C2；任务/会话/输入身份绑定，聚合预算；Agent 并行与 CPU/EDA licence 并行分别管理 |

角色包括 Evidence Analyst、Strategy Researcher、Node/Pack Coder、Independent Reviewer 和 EDA Operator。Operator 委派写入的最后一段由 F4 负责；不得因为 child 有 Coding 能力就自动授予整个 Run 的操作权。

## D. Campaign / Data Insight 双模式 GUI

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-D1 / P1 | Start 双入口与同级标签；Library 分析自动打开 Data Insight，执行任务打开 Campaign | #51/ADR-0013；已有报告无需空 Campaign；导航动作不启动计算/EDA |
| NXT-D2 / P1 | 复用当前视觉；Live Run 阶段分组、搜索/定位、业务摘要、变化/best/未解决项易读 | 既有 Workbench/RunView；草稿、选择与缩放保持，键盘与窄窗口 L3，不重造 shell |
| NXT-D3 / P1 | Insight↔执行详情↔child↔代码/终端/证据联动，后台更新不抢焦点 | B2/C2/E3/F；迟到 A 结果不能覆盖 B，点击 finding 只提出准确问题/行动 proposal |

Data Insight 内的报告和可视化不属于 Live Run 子页；Subagent/Files/Terminal 是共享工作视图，不另立第三种产品运行模式。具体接口与验收：[双模式与 Subagent 规格](specs/workbench-modes-and-subagents/spec.zh-CN.md)。

## E. Library Intelligence

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-E1 / 前置阻塞 | 资格化 Empyrean Liberty API 的读取/查询与隔离失败处理 | #49；留存 `lib.name()` exit139、未有新资格证据。需可用厂商包/说明或另行授权诊断；本清单不启动 debug |
| NXT-E2 / P1 | 保留版本、Cell/arc/when/PVT/单位/工作域/unknown/provenance 的 facts 与 semantic delta | E1 后接真实数据；先静态合同与已批准 fixture，缺失不当零、崩溃不产生半份事实 |
| NXT-E3 / P1 | 三类分析：库健康与发布风险、库性能与竞争力、设计影响与行动 | D1/E2；同族 baseline/revision 首切片，load/filter、表图联动、证据下钻；设计缺项不能假定 |
| NXT-E4 / P2 | 客户自定义规则/Python 分析、保存方法及有依据的验证建议 | E2/E3/G；typed 输入输出、版本/预算/权限/反例；不默认写 golden Library |

E1 阻塞真实数据接入与对应生产验收，不应阻塞无数据副作用的模式导航或明确标注的合同/视觉研究；仍遵守 [#49 首切片](package-development/library-intelligence-platform/first-slice-spec.md) 的真实接入门。图表库不能替代 native API 的资格证明。

## F. Terminal 与 Interactive EDA Operator

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-F1 / P1 | 保留普通 Bash，补齐原生 terminal consumer 和局部 preset，支持同进程多轮输入输出 | #50 I0/I1；当前 pin 的 PTY service/backend 可借用，六工具 consumer 尚未安装；本地 REPL/owner/作者禁 shell 反例 |
| NXT-F2 / P1 | 交互模式进入 Pack/Job/Channel/Fabric：启动、read/input/interrupt/close、持久 transcript | A1/A2/A3，#50 I2/I3；wait 不 kill，input 不盲重发，单写者、unknown、预算/许可和恢复 |
| NXT-F3 / P1→P2 | XTop manual ECO Operator：加载一次 DB，查询→修改工作副本→检查→保存→独立验证 | F2 + 版本手册/工具环境资格；小型 L4，不改回 loadECO，不将看到 prompt 当完成 |
| NXT-F4 / P2 | 将限定节点的实际操作安全委派给独立 EDA Operator child | C3/C4/F2；可撤销的节点/会话权限，防双写与旧 epoch；仍只有一个 Campaign 业务 owner |

第一阶段可由 owner 在节点内承担 Operator 角色；F4 明确列为目标能力，不以它尚未完成为由阻止先验证交互工具。普通 terminal、工具内部 Tcl 授权、受控 Campaign evidence 必须区分。[交互式 EDA 规格](specs/interactive-eda-v1/spec.zh-CN.md)

## G. Pack 开发、验证与发布体系

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-G1 / P1 | Guide 帮第二位作者从 SOP/脚本/报告形成目标、数据合同、节点、工具和反馈 | B4；复用五阶段技能/checkPack；一项小业务的 obligation→artifact 可追踪 |
| NXT-G2 / P1 | 建立工具/Reader/规则/失败恢复的可复用模板与真实反例库 | A5；零违例/截断、容器参数、二次保留、setup/hold、预算和恢复；已有测试先复用 |
| NXT-G3 / P1 | packStage 恢复、测试范围展示、release/安装交接、升级回滚和资产保留 | B3/G1/G2；非原作者从入口完成，明确区分 publication integrity 与业务成熟度 |

当前研究/校验机制继续使用同一份有类型数据合同。每次有意义的流程改进进入候选版本，再验证/确认发布；不直接改活动 Pack。DSH plugin author 与 HimaPack author 是不同交付物。

## H. 研究反馈、Cell Demand 与知识积累

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-H1 / P1 | 每代展示 fixed/remaining/entrant/regressed、原始 demand/frontier 分母、策略/代码/动作变化 | 既有 Pack Reader/analysis/experience；需求删减不冒充解决，负结果/部分结果如实保留 |
| NXT-H2 / P1 | Researcher 用实际反馈提出具体下一策略、算法或 Cell Demand，并解释选择 | C1/C3/G2；冻结 candidate pool 反馈 A/B；单独核对函数/drive/arc/endpoint 等实质变化；真实效果另测 |
| NXT-H3 / P1→P2 | 条件化经验归档、跨任务引用、失效管理与方法晋级 | G3/H1；区分事实/假设/规则，保留失败和适用条件，模型建议不自动写入已发布方法 |

保留真实研究自由度：专用角色可提出和编码新策略，不把研究退化为固定策略菜单。免费 proxy 仍是观察/指标来源，未验证的因子不能越权决定商业收益；mock Library 与真实 characterization/签核能力的边界保持。

## I. 生态复用与开发效率

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-I1 / 横向支撑 | 按最小消费者引入 native seam、窄协议/算法或 adapter；锁版本与必要许可/NOTICE | 参考 [32 项组件清单](product-review/2026-09-22-ecosystem-reuse/component-shortlist.zh-CN.md)；installed/mounted/verified 分列，无用户收益则不引入 |
| NXT-I2 / P1，按问题触发 | 分清模型/工具/排队/上下文成本，轻量诊断和通知状态有用且不制造噪声 | 既有 trace/meters/coalescing 优先；组件开销、隐私/离线、去重和生命周期回归 |

近期候选：原生 subagent/context/session/terminal、data-agent 的 typed report 思路、ECharts、小型可选评测/诊断。完整团队调度器、整套 BI/shell、自动进化 store 与新 runtime 默认不引入。当前 DSH pin 不因一个局部特性自动升级。

## J. 产品交付、客户使用和商业价值

| 索引 / 优先级 | 任务与用户可观察结果 | 依赖 / 验收 |
| --- | --- | --- |
| NXT-J1 / 持续 | 为新接口建立低成本回归、实际模型小任务和分层证据 | L0/L1/L2 主力、L3 关键交互、L4 模型/工具分开；合成/重放与真实结果明确标记 |
| NXT-J2 / 每次发布 | 可安装 App 与固定 Pack、版本兼容、资产迁移/回滚、当前手册和发布证据一致 | 受影响测试通过；不要求用户运行源码；运行时字节变化单独打 App；发布前验证不扩大为完整研究 |
| NXT-J3 / 里程碑 | 陌生工程师通过 Guide 完成首次使用、双模式、子会话、控制和交付；再做代表业务闭环 | 先本地/小型依赖；恢复或新建商业试验须明确授权与预算，保留旧证据、禁止重复 Campaign |
| NXT-J4 / 客户验证 | 在同输入/工具/预算下衡量人工干预、有效试验、工时、计算/许可及交接成本 | Timing Closure 验执行交付，Library 验洞察决定，DTCO 验研究上限；再扩大到第二设计/操作者/受支持 Site |

竞争定位持续验证：工具的领域深度 + 经过验证的 Pack/经验资产形成客户留存；客户自有 Harness/coding agent 可作入口。数据可携带、可导出，不靠隐藏格式制造黏性。+5% Fmax 仍是明确 DTCO Campaign 的研究目标，不能变成所有 App/Pack 发布的阻塞门或跨设计承诺。

## 开发顺序与并行安排

| 批次 | 重点 | 批次退出信号 |
| --- | --- | --- |
| 第一批：可靠入口与最小团队证据 | A 的可复现缺陷；B1/B2；D1；C1/C2 的本地原生能力和对照；G2 的既有反例对账；F1 装配设计 | 用户能正确定位任务/child，暂停与授权有效；不因切标签造 Run；团队有可审阅贡献而非只增加成本 |
| 第二批：业务工具与深度交互 | B3/B4、C3/C4、D2/D3、E1→E2/E3、F2/F3、G1/G3、H1/H2 | 一项 Library 分析和一次有状态工具操作各有真实资格与独立结果；第二作者完成小 Pack |
| 第三批：委派执行、经验复用与客户验收 | F4、E4、H3、J2/J3/J4 | 下一位工程师可查看、接续、复现和使用成果；成本/收益数据支持扩大 |

同批不等于全并行：依赖只约束需要它的动作。read-only 上下文/导航、Pack fixture、洞察合同、终端源码资格可以分别推进；A1/A2/A3 未闭合时不开放新的委派写入/商业操作；E1 未通过时不宣称真实 Library 可用，但不拖住 Guide/其他 UI。许可证、CPU、内存、IO 与 Agent 并发分别限额。

`index.ts/remote.ts/fabric.ts/tools.ts` 等共享接线单一集成者；冻结小接口后才能并行 UI、传输、Pack 内容。常规实现 Terra/Medium，权限、恢复、证据与运行图关键审查 Sol/High。没有资源和实测基础前不承诺日历工期。

## 已有 Issues、旧编号和当前状态

- [#51 双模式/Subagent](https://github.com/lluzi/hima_harness_reforge_polishing/issues/51)：C2、D1/D3 的详细设计；目前为规格，不是已实现。
- [#50 Interactive EDA](https://github.com/lluzi/hima_harness_reforge_polishing/issues/50)：F1–F4 的具体协议、边界和验收。
- [#49 Library](https://github.com/lluzi/hima_harness_reforge_polishing/issues/49)：E1–E3 的真实数据前置与首切片。
- [#41 既有 Campaign UI](https://github.com/lluzi/hima_harness_reforge_polishing/issues/41)：保留现有成果，D 系列补同级模式与新的体验，不重做旧界面。
- #30、#38–44 及旧 POL/PLS：先核对已合入源码/证据/剩余范围再拆分或关闭；open 标签不证明全部仍未修。禁止盲目合并或重开一批重复实现。
- #48：已修通知路径的相关回归继续保留，不作为本轮尚未修复的同一个 bug。

本轮“完成”的是需求、总体任务和依赖刷新。37 个 `NXT-*` 规划项尚未因此进入开发或通过验收；实际派工与完成逐项落到 Issue。本轮没有恢复 Claude 测试或 EDA。

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
