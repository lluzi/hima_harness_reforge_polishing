# LibInsight：HimaHarness 集成与 Liberty API 驱动的库洞察规格

任务规格：[GitHub #77](https://github.com/lluzi/hima_harness_reforge_polishing/issues/77)，标签 `ready-for-agent`；本文与 Issue 正文同步。
状态：产品定义已由 Q1–Q17 确认；本规格供实现及验收使用，尚未交付完整功能。
范围：同一套库内部的 Liberty/LEF 洞察、独立 Design-specific 分析、两层导航及有依据的 AI 交互。
既有依赖：GitHub #49 的有界 Library E1–E4 切片；本规格扩展其业务能力，不重开或改写原验收结果。

## Problem Statement

工程师需要理解一套标准单元库的质量、能力、风险和改进机会，但库包含很多分支、PVT、corner、cell、
pin 和模型表。孤立文件检查和大量违规计数不能直接回答：哪里值得关注、问题影响什么、哪些 cell 的
工作范围或敏感性值得注意、哪些改进可能帮助具体设计。

现有用户原型已经实现广泛的 Liberty 分析、25 项检查及交互式证据展示，但操作层级过深，数据、解释
和后续建议仍需缩短距离。原型不含 LEF 几何/pin-access 概率分析；HimaHarness 当前已有的有界报告
呈现和原生 API 接入，也没有承载原型的全部分析体验。

用户需要一个 LibInsight：只提供 Library 时就能独立分析；提供 Design 后，在独立分析区域理解
critical-path cell 和 cell 使用情况。它应接入 HimaHarness，并使用真正的 Liberty API 读取电气数据，
让数字、模型结果、缺项和证据保持可区分、可复查。

## Solution

在 HimaHarness 的 Data Insight 工作模式中交付统一 LibInsight。以现有原型为 Library 功能复用基础，
沿用 HimaPack、Site、受控任务/Job、Reader、记录与报告机制；新增 LEF 所需的物理读取和概率分析能力。

用户选定一套库后，系统按默认模板开始基础分析，逐步产生可浏览的结果。Overall 风险地图复用工程
问题标签，可切换/filter；点中某个库对象的风险，直接打开相应分析。左侧按大类、顶部按工程问题
组织，最多两次导航点击定位分析；对象筛选及详情在当前页完成，数据、结论、影响和建议相邻呈现。

| 分析区域 | 用户得到的结果 |
| --- | --- |
| Overall | 全库覆盖/进度及按分析标签组织的风险矩阵；直接进入具体库对象的分析 |
| 库质量与风险 | 完整性、一致性、表格精度、异常、建议工作范围、pin-access 条件风险 |
| 库能力 | Cell 能力、Corner/VT、电压 Sensitivity、Drive ladder、Variation、同库分支比较 |
| Design-specific | Netlist 使用分布、critical-path cell 与可得 operating points；缺输入明确说明 |
| 共用配置和建议 | 少量可调模板、检查项及阈值；带对象、条件和依据的建议清单 |

Heatmap 区分数据覆盖、数值可信程度、使用适宜性，解释可靠/不可靠区域的含义。先展示当前条件，
再汇总选定条件的共同工作范围，给出成对成立的保守 max transition/max load 候选上限。

AI 支持主动解释、针对当前对象回答、根据自然语言调用已有分析；优先保证后两者准确且可回到证据。
首次 demo 的结果是可操作、可解释、可复算的洞察与建议，不包含原库修改、设计优化执行或物理签核。

## User Stories

### 输入、范围与来源

1. As a library engineer, I want to select one complete library release with its branches, PVTs and corners, so that I can understand the offering as a whole.
2. As a library engineer, I want to provide Liberty, LEF and relevant technology information, so that electrical and physical analyses belong to the same LibInsight task.
3. As a library engineer, I want analysis to work with only the available views, so that missing LEF or Liberty does not prevent valid partial insight.
4. As a library engineer, I want every declared input to have a visible processing status, so that missing or failed files cannot disappear from coverage.
5. As a library engineer, I want cell and pin mappings to carry source and identity evidence, so that similarly named objects are not silently combined.
6. As a library engineer, I want missing quantities to remain unknown rather than zero, so that incomplete data does not look unusually good or bad.
7. As a library engineer, I want Liberty facts to come from the qualified native API, so that displayed electrical values can be traced to the actual source and reader.
8. As a library engineer, I want unsupported models and rules to be identified, so that I know the scope of each conclusion.
9. As an engineer, I want original libraries, PDK information and design inputs to remain unchanged, so that exploration preserves my source assets.
10. As an engineer, I want my input data to remain in the authorized local or Site environment, so that analysis does not require publishing proprietary data.

### 自动分析、任务与配置

11. As an engineer, I want basic analysis to start with a default template after selecting the library, so that I do not need to configure every check before seeing value.
12. As an engineer, I want completed results to appear progressively with progress and coverage, so that I can investigate while other analyses continue.
13. As an engineer, I want long calculations to show their task state, so that I can continue browsing without confusing pending results with completed ones.
14. As an engineer, I want cancellation and recovery to follow the existing task controls, so that interruptions do not lose accepted results or duplicate work.
15. As an engineer, I want a few named reference templates with adjustable thresholds and check selections, so that I can express my priorities without writing an algorithm.
16. As an engineer, I want configuration changes to update affected conclusions, so that I can understand the consequences of my choices.
17. As an engineer, I want configuration changes to preserve my selected cell, corner, tab and chart position where valid, so that adjusting a rule does not interrupt investigation.
18. As an engineer, I want results to identify the configuration that produced them, so that old and new judgements are not mixed.
19. As an engineer, I want browsing and filtering existing results to avoid new native parsing or AI calls, so that routine inspection remains direct and predictable.

### 导航、风险与解释

20. As an engineer, I want left-side categories and top-level engineering-question tabs, so that I can locate an analysis in at most two navigation clicks.
21. As an engineer, I want the Overall map to use the same analysis labels as detailed pages, so that I do not need to learn another navigation system.
22. As an engineer, I want to switch the Overall map by analysis label, so that I can inspect the relevant risk distribution across library objects.
23. As an engineer, I want clicking a library risk to open its corresponding analysis with the relevant conditions, so that context survives the transition.
24. As an engineer, I want risk-ranked findings with their magnitude, affected objects and possible consequences, so that I can decide what deserves attention.
25. As an engineer, I want incomplete, failed and unsupported checks to remain visibly distinct from clean checks, so that silence is not mistaken for correctness.
26. As an engineer, I want data, conclusions and explanations shown together, so that I can evaluate the reasoning without repeated navigation.
27. As an engineer, I want issue details and source evidence to expand in the current page, so that investigation does not create a deep back-navigation chain.
28. As an engineer, I want an unknown or unused design relationship to leave the library risk intact, so that design relevance does not erase a library problem.

### Liberty 检查与能力

29. As a library engineer, I want structural, unit, corner, timing-sense and conditional-arc checks, so that I can identify inconsistent library information.
30. As a library engineer, I want index, shape, missing-data and legal-sign checks, so that malformed tables are distinguished from genuine numeric behaviour.
31. As a library engineer, I want interpolation and extrapolation risk explained as estimates with their assumptions, so that I do not mistake an estimator for measured error.
32. As a library engineer, I want spikes, kinks and load, voltage or VT trends inspected with applicable exceptions, so that suspicious data is understandable.
33. As a library engineer, I want LVF coverage, consistency and available cross-view table comparisons, so that I can see variation-related gaps without assuming unsupported waveform coverage.
34. As a library engineer, I want FO-based and explicit slew/load reference conditions, so that cell comparisons use meaningful declared conditions.
35. As a library engineer, I want cell capability and dominance comparisons within comparable functions and conditions, so that apparent advantages are not caused by mismatched objects.
36. As a library engineer, I want drive ladders, gaps, swap sets, VT twins and optimization-limit checks, so that I can understand the library's usable optimization choices.
37. As a library engineer, I want limiting-corner and temperature behaviour displayed, so that I can distinguish legitimate behaviour from suspicious trends.
38. As a library engineer, I want per-cell voltage sensitivity and reference-inverter comparison, so that cells with unusual slowdown are easy to investigate.
39. As a library engineer, I want same-release branch and VT comparisons, so that I can understand tradeoffs without requiring a cross-vendor comparison workflow.
40. As a library engineer, I want calibration coverage and unaudited status visible for estimates, so that reliability claims match available evidence.

### Heatmap、工作范围与约束建议

41. As an engineer, I want a heatmap of input transition and output load with selectable values, so that I can inspect a cell's behaviour across its table domain.
42. As an engineer, I want coverage, numeric trust and usage suitability represented separately, so that each boundary has a precise meaning.
43. As an engineer, I want every highlighted region to explain its reason and assumptions, so that a coloured area is not an unexplained verdict.
44. As an engineer, I want the current pin, arc, edge and corner to remain visible, so that I know which conditions the chart describes.
45. As an engineer, I want a common envelope over selected relevant conditions, so that I can obtain a cell-level recommendation with stated coverage.
46. As an engineer, I want to see the corner, pin or arc that limits that envelope, so that I know what drives the recommendation.
47. As an engineer, I want performance preferences to narrow the recommendation separately from data-quality boundaries, so that usable data is not labelled unreliable merely for missing a target.
48. As an engineer, I want paired conservative transition/load limits that stay within the recommended region, so that combining two independent maxima cannot create an invalid recommendation.
49. As an engineer, I want lower bounds, holes and insufficient evidence shown, so that the recommendation does not hide excluded operating points.
50. As an engineer, I want to export the recommendation with object identity, units, conditions, configuration and evidence, so that it can be reviewed and applied later through an appropriate flow.

### LEF 与 pin-access 概率

51. As a library engineer, I want LEF pin, PORT and obstruction geometry evaluated with declared technology and grid rules, so that pin-access conclusions reflect physical constraints.
52. As a library engineer, I want legal access candidates and rejection reasons inspectable, so that a difficult pin has an understandable geometric explanation.
53. As a library engineer, I want individual pin access and joint cell access evaluated separately, so that competing pins do not look routable merely because each has candidates.
54. As a library engineer, I want every probability to identify its legal-placement context and environment distribution, so that the percentage has a reproducible denominator.
55. As a library engineer, I want neighbor, phase, direction and resource-pressure sensitivity, so that I can understand where a cell becomes fragile.
56. As a library engineer, I want shared routing resources preserved in the model, so that correlated failures are not replaced by independent pin probabilities.
57. As a library engineer, I want solver unknowns, sampling error and rule uncertainty distinguished, so that incomplete analysis cannot silently become a pass or failure.
58. As a library engineer, I want geometry-model feasibility distinguished from router search success, so that a heuristic failure does not falsely prove physical impossibility.
59. As a library engineer, I want electrical and physical conclusions associated through verified cell/pin mappings, so that I can inspect tradeoffs on the same object.

### Design-specific、AI 与交付

60. As a design-focused engineer, I want an independent Design-specific area, so that design-oriented analysis does not complicate every library page.
61. As a design-focused engineer, I want cell usage counted from my Verilog netlist with parser coverage stated, so that I know which masters matter to this design.
62. As a design-focused engineer, I want critical-path cells linked to library properties, so that I can understand the cells on the paths I supplied.
63. As a design-focused engineer, I want available operating points shown against the corresponding tables, so that conclusions use the observed slew/load conditions.
64. As a design-focused engineer, I want unmatched cells, missing units and unsupported report formats reported explicitly, so that partial design evidence is not presented as complete analysis.
65. As an engineer, I want AI to explain important findings with evidence, so that I can form an initial view of the results.
66. As an engineer, I want to ask why a selected cell or chart region is problematic, so that the answer addresses the actual object and conditions I am viewing.
67. As an engineer, I want natural-language requests to invoke existing analysis capabilities, so that I can request comparisons without manually navigating every control.
68. As an engineer, I want AI to distinguish facts, estimates, probabilities and unknowns, so that generated explanations do not overstate results.
69. As an engineer, I want stale results or cross-project references rejected, so that concurrent tasks cannot attach conclusions to the wrong library or design.
70. As an engineer, I want retained reports and their recommendations to remain readable after an update, so that investigation and rollback preserve prior evidence.
71. As an engineer, I want legacy Library reports to remain readable during this upgrade, so that integration does not invalidate existing work.
72. As an engineer, I want the demo to exercise both library-only and Design-specific journeys in HimaHarness, so that a standalone prototype does not stand in for integrated delivery.

## Implementation Decisions

### 1. 归属与主接口

1. LibInsight 是一个统一业务能力。保留现有 Library Pack 的稳定身份，在现有版本机制内升级；不新建
   独立 BI 应用、任务调度器、数据权威或另一套 Agent Loop。Data Insight 与 Campaign 仍为同级模式。
2. 主要业务接口是现有“受控分析任务 → Reader 接纳的版本化证据/报告 → Workbench/Guide 消费”链路。
   界面与 AI 调用同一能力；只读查看、筛选和证据读取不会创建空 Run，也不会重新调用 Liberty API。
3. 可接受的业务动作是选择输入、开始/恢复/取消分析、调整并重判配置、读取已有结果、检查对象、导出
   建议。复用现有任务与报告接口表达这些动作，不以一张新页面为由新增通用服务接口。
4. 原型的分析算法、参考条件、检查目录及解释性图表是复用起点；原型的独立 HTTP 服务、固定服务器
   路径和可变目录布局不成为 Hima 的架构要求。共享接线由单一集成者负责。

### 2. 输入、身份与覆盖

| 输入组 | 必须表达的内容 | 失败或缺项语义 |
| --- | --- | --- |
| Library manifest | 单一 release 标识；分支、corner、view；每个源的角色、Site 引用、hash、尺寸与预期覆盖 | 同名不等于同源；重复/冲突身份须拆开或明确映射，不自动选一个 |
| Liberty API runtime | 原生 API/Python/适配器/wrapper 身份、Site/Permit、所需资源、通过的资格记录 | 不合格时阻止对应真实提取；合成路径只能产生 synthetic 结果 |
| Physical inputs | Cell LEF、可得 tech/via 信息、单位/DBU、site、合法朝向、grid、规则覆盖说明 | 缺失或不支持的规则进入 unknown；允许命名简化模型，但不冒充物理资格通过 |
| Physical profile | 目标 pin/网络义务、邻居/phase/PDN/背景资源/逃逸出口及预算；分布权重或采样器身份 | 无分布时只给几何结果，不能输出未定义的概率；无合法放置时条件概率为不适用 |
| Optional Design | Netlist、timing paths 的身份、top/格式、单位、使用条件与库映射 | 各输入独立可用；无 Design 不阻断库分析；格式/映射未知不做推断 |
| Analysis configuration | 模板身份、有效参数/检查选择、Reference Condition、规则版本及预算 | 参数需在声明范围内；无效设置拒绝且保留当前有效结果 |

5. Library 与 Design 是入口语境，不按文件后缀机械区分。多个电气 corner 可映射到一个 physical master；
   映射记录必须带来源和适用范围。area 的数值比较须先确认单位与语义。
6. 覆盖统计区分 declared、processed、analysed、unsupported、failed、not-run。单源失败不发布半份
   facts；已成功的独立源可形成明确 partial 的结果，但全部输入必须有状态，不得称为整库 clean。
7. 统一度量记录包含数值/单位与可用状态。真正的零值保留零，缺失为 null 加原因；尤其修正原型中
   capacitance、area、leakage 的缺失归零路径。单位转换保留原值、原单位与转换依据。

### 3. Liberty API 的执行与算法复用

8. 真实 Liberty 数据经已资格化的 Empyrean Liberty API 读取。保留 Hima 现有 prelaunch 检查、Site Permit、
   wrapper/Python/API 身份、资源声明和持久 Job 成功记录；不得绕过这些条件调用原型提取脚本。
9. 资格检查与 corpus 分析分离。既有有界资格记录可作为基线，其适用 runtime/输入范围需要核对；版本
   改变须重新验证。资格失败阻断其依赖的原生提取，不把它升级成 API/系统/许可证环境改造任务。
10. 原生对象不跨进程传递；按源隔离 worker，输出有版本的事实记录及受 hash 约束的 sidecar。提取前后
    检查原始文件身份，写入只发生在获准私有 workspace；exit/signal/日志身份与输入清单共同保留。
    原型分析代码与原生 API 可使用不同的已声明解释器：已核查原型要求 Python 3.9+ 与 NumPy，原生
    API 使用其资格记录绑定的 runtime。通过序列化 facts 对接，不假定两者可在同一 Python 中导入，
    也不为迁移原型而修改已资格化的 API runtime。

    **整库 admission 明确采用每源一个受控原生 Job。** 旧资格合同的 vendor/SAED14/TSMC28 三份样本
    仍只负责原生 runtime 资格；它们的固定角色清单不复用成任意 corpus manifest。整库 manifest
    使用独立的版本化 source 清单，并引用适用的资格记录；每个源的 Job prelaunch attestation 绑定
    manifest/source ID、source hash、Run/node/attempt/Job session、实际 Permit、runtime/wrapper/
    adapter 身份及私有输出位置。源文件数与任务并发受声明预算和 Site 资源约束，不在一个被许可的
    Job 内另开未计入资源的 native worker 池。

    Reader 接纳每源结果前，核对同一 Run 的 Host attestation 与持久 launched/finished Job 记录、
    退出状态、输入/输出及 source-after hash。仅自称成功的 worker JSON、另一源或另一 Run 的资格
    收据不能形成 native facts。失败/未运行源各有记录；成功源才能进入受标记的部分结果。
11. 复用 E1–E25 检查、table/numerics、classification、metrics、voltage、finding/attention、settings、
    Lens 与建议逻辑；复用前验证输入语义一致，避免用同名字段假定两套 facts 等价。
12. 每项检查返回明确适用性和执行状态；error、not-run、unsupported 与 clean 不互换。原型 runner
    捕获的异常不能只留在内部日志；用户能看到哪项检查缺少结论。
13. E7/E8 等估计保留 estimator、参数与校准覆盖；原型在同一批留点样本上选择因子所得 precision 不称为
    独立泛化精度。CCS/vector waveform 被提取器跳过时，显示 unsupported coverage；跨 View 已有表的
    比较不升级为完整 waveform/model equivalence。
14. 函数分类、VT twin、family、dominance 与同库比较保留匹配依据。名称、capacitance 等启发式来源
    明确标注；比较仅使用可比的函数、条件和有效数值。已有参考条件和外推标记不被压成单一质量分。

### 4. 结果契约与兼容

15. 现有报告 v1 保持只读兼容；统一能力采用同一报告家族的 v2。v1 不被原地重写，缺少 v2 字段显示
    不支持，不用伪造 corner 或 native-qualified 标签补齐。客户端与 Reader 同步支持 v1/v2 分派。
16. v2 分开表示“来源/生产者资格”和“结论依据”。原生 API 读取成功只证明相应提取资格；模型概率不
    因原始 LEF/Liberty 真实就变成实测概率。合成、声明事实、确定性派生、模型估计与外部验证可区分。

    **v2 scope 是可判别集合，不继承 v1 的全局 corner 必填约束。** 主报告携带非空 scopes，每个
    scope 有稳定 scope ID 和以下 kind；finding、图表及建议以非空 scopeRefs 引用它们，引用须存在
    且与来源和对象相容。一个跨视图结论可引用多个 scope，但必须另带经验证的对象映射。

    | scope kind | 必需条件 | 不适用字段 |
    | --- | --- | --- |
    | library-electrical | release/branch、electricalConditions；每个条件有来源view、corner/PVT及其明确可用/未知状态 | 不以physical profile代替电气条件 |
    | library-physical | release/physical master、LEF/tech/rule身份、grid/环境profile | 省略corners、electricalConditions等电气字段；不用空数组、null占位或假PVT伪装适用 |
    | design-specific | design source身份、netlist/path分析范围、库映射及可得observed-condition引用 | 未观测到的条件保持缺项；不生成假operating point |

    v2 的标识为 `hima-library-insight-report/2`。Reader/Guide/client 先按 schema version 显式分派到
    相应严格验证器；v1 保持原合同，v2 不向 v1 下转型。未知版本明确拒绝，未引用或越界的 scope
    不能靠客户端忽略字段而通过。来源角色与模型结论依据分开验证，不能仅凭一个 producer 标签取信。

| 结果层 | 必需的稳定语义 |
| --- | --- |
| Report identity | schema version、Run/record/ref、报告版本/hash、输入及配置身份、analysis revision |
| Scope | release/branch、source roles、实际覆盖、当前和缺失条件；电气条件与 physical profile 分开 |
| Finding | 对象身份、检查/分析类型、风险等级与理由、问题幅度、影响范围、可能后果及证据引用 |
| Claim basis | explicit/derived/model-estimated/synthetic 等依据类别；qualification/validation refs 与适用范围 |
| Chart/detail | 轴变量和单位、值/unknown、条件、区域/标线含义、样本及规则来源、受验证的 sidecar 引用 |
| Envelope | 当前条件或聚合条件集合、有效二维区域、排除/未知区域、约束对象、成对上限及限制来源 |
| Probability | 成功事件、q/θ/profile 身份、分母、结果/界、求解未知、抽样误差与规则覆盖分别表达 |
| Recommendation | 建议值和单位、对象、条件、配置、依据、限制及未验证范围；不带隐式执行权限 |

17. 全库数据不直接塞入模型上下文或无界报告。主报告保持有界，索引/表格采用受验证的分页或 sidecar
    引用；读取必须绑定已记录报告、对象、项目权限与 hash，不开放任意路径读取。保持当前报告读取
    上限与“超限先拒绝、后读取”语义，扩展细节使用有界请求。
18. 原始输入、实际运行记录和保留的产物是权威；索引/cache 为可重建派生物。每个数值与区域结论均可
    回到源事实、规则/算法版本和参数。稳定身份不依赖表格行号或当前排序。

### 5. 运行、增量与界面状态

19. 首次按默认模板自动运行基本分析。阶段完成即可显示其已接纳结果；各阶段进度与 input coverage
    可见。Library-only、LEF-only 和带 Design 的分析根据已具备输入启用，不强制一次提交所有输入。
20. 有效配置按内容版本化。只读筛选不重算；可由保留候选重判的阈值变化复用现有事实；依赖新数值/
    几何计算的变化走已有受控任务。无论快慢，更新后的判定带新配置身份，不篡改旧报告。
21. UI 保留有效的对象选择、tab、corner、筛选和图表位置。请求附输入/配置/目标身份；迟到结果可以
    归档，但不能覆盖用户当前已切换的对象或条件。旧结果可继续浏览，并清楚标出旧条件/更新中。
22. 失败、取消、超预算和中断走现有 Run/Job 控制与恢复机制。已接纳结果保留；不把部分阶段完成
    写成整项分析成功，不因恢复重复启动副作用不明的工作。
23. Overall 与详情共用分析标签、库对象身份及筛选语义。矩阵展示等级、覆盖/未知与必要计数；点中格子
    直达同一对象的对应 tab，不增加“矩阵专用详情”中间层。顶部配置入口为共同能力，不再造导航层。
24. 风险等级沿用可追溯检查语义，显示分级理由。Issue 数量、模型概率、库严重度与设计相关性分别
    表达；“设计未使用”不等于库正确。没有适用风险判据的能力图不强行生成风险分。

### 6. Heatmap 与建议工作范围

25. 轴为声明的 input transition 和 output load，保留单位及其对应 input/output pin。图中可选择现有
    delay、transition 等值；切换条件时图、说明和建议始终来自同一结果版本。
26. 数据覆盖层标注采样、插值/外推或缺失；数值可信层标注检查/估计支持的可疑区；使用适宜层表达已有
    使用限制及用户目标。每个区域同时有名称、图例、解释和依据，颜色不是唯一含义载体。
27. 初始以当前 pin/arc、edge、when、corner 等条件显示。cell 共同范围由用户选定的适用条件交集得到，
    列出纳入/未纳入条件及限制来源；缺失条件不能默认为无约束，未验证范围不涂为可靠。
28. 原型的数值检查可支持区域估计，但不把离散采样点全部通过当作连续内部已证明可靠。区域构造明确
    插值/曲率估计及分辨率；有孔洞、不连续、证据不足或空交集时显示这些状态，并可不提供标量建议。
29. 上限以成对方案给出。它所宣称的矩形必须在声明模型下被有效区域包含，并附必要下界、排除区与
    适用条件；不能独立拼接两个轴最大值。若没有可证的非空候选，就返回“无足够依据给出上限”。
30. 导出人可读说明与结构化建议清单，含输入/结果/配置身份、对象、单位、条件集合、成对上限、限制
    来源与未验证范围。input-slew 建议与输出 pin 的 load/capacitance 限制区分；demo 不把它们直接
    翻译为任意工具的 max_transition/max_capacitance 命令，也不写回 Liberty。

### 7. LEF 与第一性原理概率

31. 物理分析至少保留 MACRO/PIN/PORT/OBS 相关几何、层、单位、site/朝向、via/规则与 grid 身份。
    不把 pin center 当唯一 AP，不把所有 OBS 无条件从 PIN 扣除。支持范围和未支持 LEF/技术规则显式列出。
32. 候选记录坐标、层、via/enclosure、允许方向和短接入段；检查包含相应几何冲突、已支持间距规则及
    同网/异网语义。几何原语、单 pin 候选与 cell 联合路径复用一个已声明的规则模型。
    Demo 的最低闭环必须处理矩形/正交 pin 和 OBS 几何、PORT 语义、单位及合法实例变换、声明的轨道与
    preferred direction、via enclosure、显式金属/cut spacing，以及联合接入/逃逸资源冲突。复杂规则
    不支持时列出覆盖缺口，使用命名简化模型；不能以所有真实输入都返回 unsupported 来满足此能力。
    具体支持的 LEF/tech 子集与样本在实现第一切片固定，至少含孤立可接、邻接变差及共享资源冲突反例。
33. 概率主事件是在合法放置条件、指定连接义务、局部出口及预算下，存在所有活跃 pin 同时成立的合法
    逃逸路径。主概率 Pcell=E(q_legal)[Fcell]；失败概率为 1−Pcell。结构性可放置率另报；无合法放置
    时条件概率为不适用，不能除零或报告 100% 成功。
34. 参考分布定义合法朝向/轨道相位、邻居与间距、PDN/背景占用、活跃网络和方向需求。库比较使用相同
    或明确可比的义务/profile。无设计时可使用命名参考分布；结果标为该协议下模型概率，未来按真实
    分布校准，不宣称已经预测生产失败频率。
    权重必须有限、非负且总质量可核对；非法场景和被截断的质量分别记账。对合法放置条件化必须明确
    分母，不通过丢弃失败样本后重新归一化来提高成功率；采样器及种子随结果保存。
35. 固定目标/候选下，pin AP 成功概率可由“所有候选阻挡位姿集合交集”的概率质量补集计算。多个 pin
    共享轨道/via/逃逸通道，需联合约束；不能相乘 pin 边际概率。简单枚举和求解器均须保持该事件定义。
36. 场景结果为通过、已证失败、求解未知，绑定 certified-under-rule-model。只有验证 witness 才能
    通过；候选裁剪失败、超时、缺规则不能证明物理无解。放松模型的无解证明只有在可行集包含关系
    明确时才能用于原模型界。
37. 完整有限 q 的已证通过质量 WP、未知质量 WU 对应成功概率界 [WP,WP+WU]。抽样误差、规则覆盖
    不确定性、q 的假设敏感性分别记录；不混成一个“置信度”。启发式 router 成功率另算，不替代存在性。
38. 输出按 cell/pin 的条件风险、联合冲突/逃逸原因、几何证据和声明 profile 的敏感性。允许保存后续
    校准标签，但本次不要求商业 P&R 标签才能运行参考模型，也不把参考模型通过称为 foundry signoff。

### 8. Design-specific 与 AI

39. Design-specific 独立导航和结果范围，复用库身份/度量。Netlist 单独提供使用数量；timing paths
    单独可提供匹配到库的路径 cell 分析；不强制二者一起存在，也不把所有 Library 页面改为 Design 页。
40. Netlist/时序文本解析器有明确支持格式与单位。报告声明 top、已处理输入与对象、未解析结构、未匹配
    cell/pin/arc 和 coverage；碰到不支持格式给出不可计算/partial，不静默返回零 cell 或空 critical 集。
41. Operating points 仅来自实际可解析的路径行；没有 observed point 时显示缺失。若用户另选 FO 条件
    查看库指标，标为 Reference Condition，不能伪装成观察到的设计点。导入的 paths 不代表全设计 STA。
42. AI 获得当前报告版本、对象、条件、已加载证据与明确缺项。回答引用保留结果；追问范围超出当前数据
    时调用已有受控分析或解释不可计算，不生成没有来源的数值、概率、工具结果或 PASS。
43. 自然语言触发与 UI 操作共用分析/查询能力及身份校验。Agent/Host 保持现有 owner、权限、预算、取消
    与进度语义；新增算法的自主研究不属于本 demo。

    **AI 上下文必须经过数据出境检查。** 复用现有项目/Site/模型的数据访问与使用授权，只向已获该
    项目及数据范围授权的模型发送最小必要上下文。原始 Liberty/LEF/netlist、完整 timing report、
    完整表格与 sidecar 内容默认不外传；摘录、标识和派生摘要也受相同数据范围约束，不能以“摘要”
    名义绕过限制。凭据/许可证秘密不进入模型或报告。

    对外模型的允许字段在已有上下文投影中使用明确白名单（例如获准的对象标识、条件、检查结果及
    有界数值摘要），绑定授权依据和目标模型；不允许模型或浏览器直接读取任意源文件。若当前授权
    不覆盖相应数据，则保留本地可视分析，并说明该上下文不能发送；不静默扩展授权，也不反复要求
    用户确认已经覆盖该范围的既有授权。实际发送字段类别和引用身份可审计，不记录秘密值。

### 9. 交付与回滚

44. 分阶段升级原型适配、报告合同、界面和物理能力，保留既有 Pack 身份及旧报告读取；每阶段只声明其
    实际可用能力。不能以旧 E1–E4 PASS 或原型 274 项合成测试代替统一产品验收。
45. 原型源只读，复制/适配的代码以固定源码身份进入 polishing；不依赖另一 worktree 的绝对 import。
    Library 与 Design 原件只读，缓存可重建，报告不可变。回滚代码/Pack 版本不删除历史记录或输入。

## Testing Decisions

### 主验收接口与既有基础

采用一个最高业务链路作为主验收接口：从真实 Hima Host 接收分析意图，经过 Pack/Job/Reader 接纳，
到保留报告、Workbench 读取与 Guide 当前对象上下文。用户在 Q17 确认的是这条完整体验；本规格继续
使用现有接口，不新增需要重新确认的运行边界。局部算法测试仅补足链路测试难以定位的数学反例。

测试只断言外部行为、产物、状态与证据一致性，不断言私有调用顺序、不复制实现生成“期望值”，也不
要求 AI 逐字输出预设句子。数学期望使用独立小枚举/手算，格式适配使用明确样本，运行资格使用真实工具。

| 测试层级 | 模块/主接口 | 既有先例与新增责任 |
| --- | --- | --- |
| L0 | Pack 声明、schema、版本兼容、类型与构建 | 复用现有 Pack/check boundary；验证 v1/v2 分派、配置/条件类型 |
| L1 | 原型算法适配、LEF 几何、概率、工作范围与配置判定 | 原型 274 项合成测试是基线；新增 unknown-vs-zero、联合资源及区域投影反例 |
| L2 | 真实 Host/Pack-to-Reader-to-report/Guide | 既有 Library Pack、Insight、report-address 和 unified Workbench contract tests；本地 Job 使用显式 synthetic fixtures，不冒充原生资格 |
| L3 | Hima Desktop/Data Insight 实际用户链路 | 现有真实 Desktop driver；验证导航、交互保留、图例、局部展开、配置更新与AI对象引用；按仓库指定副屏运行 |
| L4 | Liberty API、实际物理输入、真实模型各自的有界验证 | 复用原生 prelaunch/qualification 先例；逐项记录输入/版本/资源与输出，不扩大成完整 EDA 流程 |
| 产品验收 | Q17 的六项场景 | 在真实 Hima 中完成 Library-only、LEF、Design-specific 与 AI 使用；报告模型及数据覆盖，不以单独网页演示代替 |

### 必须覆盖的正例与反例

| ID | 验收条件 | 能推翻实现的反例 |
| --- | --- | --- |
| A01 | 同一 release 的多个分支/corner 形成清晰覆盖与比较 | 自动混入另一 release、或名字相同但来源不兼容仍比较 |
| A02 | 只有 Liberty 或只有 LEF 时输出有效局部结论与缺项 | 缺一类输入即不允许查看任何结果，或将缺项判 clean |
| A03 | 缺失 cap/area/table 值保持 unknown，真实零保留零 | 原型归零行为传播到风险/优势结论 |
| A04 | 资格通过后，非资格样本的多个实际源分别通过Host prelaunch并关联其原生Job；任何Permit/runtime/资源身份失败先拒绝 | 用旧三样本receipt替代corpus admission；复用另一源/Run的attestation或伪造manifest绕过门 |
| A05 | 每个实际源匹配同Run的launched/finished Job与退出状态，crash完整记账；成功源可形成partial | worker JSON自称成功就被采纳；仍发布失败源部分facts，或漏计失败源后显示100% |
| A06 | 当前源/sidecar/配置身份决定有效结果 | 同路径字节改变、伪造新 hash 或跨项目引用被当原证据 |
| A07 | 调整阈值只重判适用候选，分析失败可见 | 错误检查返回零 issues，被 UI 写成 clean |
| A08 | 矩阵与详情用同一标签和库身份，可直接导航 | 矩阵点到另一 corner/cell，或引入额外多级详情页 |
| A09 | 两层导航、当前页数据与结论对照，操作保留有效选择 | 改阈值后跳回首页或清空当前 cell，迟到结果抢占新对象 |
| A10 | Heatmap 三层图例解释区域含义、来源和当前条件 | 将外推、异常与不满足性能偏好统一称“数据错误” |
| A11 | 共同范围仅覆盖选中条件且可指出限制来源 | 缺少最限制的 corner 却宣称全 corner 可靠 |
| A12 | 非矩形/带孔区域产生可解释的成对候选，或拒绝无依据建议 | 分别取轴最大值后其组合落在排除区域；忽略必要下界 |
| A13 | Pin/PORT/OBS、单位/变换、via 条件影响合法 AP | 把重叠 port 一律扣除、只用 pin center 或误解 DBU |
| A14 | 两 pin 共享两条容量一通道、各通道独立以1/4概率堵塞：单 pin=15/16，联合=9/16 | 把联合概率算成225/256；相同 AP 数被当成相同风险 |
| A15 | 两 pin 各自拥有独立两条通道时，联合=225/256 | 将所有资源强制视为相关，失去正确独立特例 |
| A16 | 八个等权合法位姿，两 AP 阻挡集合相同{0,1}时成功=3/4，互补{0,1}/{2,3}时成功=1 | 只看每 AP 的3/4边际或AP数量，无法区别冗余 |
| A17 | 完整分布的通过/失败/未知质量0.7/0.2/0.1，成功范围[0.7,0.8] | 超时当失败、未知当通过，或把范围称真实生产置信区间 |
| A18 | A可走U/V、B只能走U时，有解率1；无回溯随机先后且A先选U的策略成功率1/2 | 把策略失败推为几何上50%无解 |
| A19 | Profile/活跃义务/参考环境改变时结果身份与说明改变 | 无条件复用旧概率；减少活跃pin后声称cell几何改进 |
| A20 | Design-specific 的netlist使用量、路径cell和observed point分别有来源 | 正则未解析的路径消失，FO4 fallback伪装observed，Design未使用变成库PASS |
| A21 | 同一当前对象问题通过Guide引用当前报告和证据 | AI编造数值或使用另一项目/旧corner结果解释 |
| A22 | 配置/结果修订和导出包含完整依据，旧报告仍可查看 | 只变UI颜色不更新配置身份，或导出缺少条件的裸上限 |
| A23 | v1仍可查看；v2纯物理scope省略电气字段，跨视图引用完整映射；Reader/Guide/client按版本一致分派 | LEF-only仍被要求corner，scope引用越界、未知版本被忽略或物理模型自称native-validated |
| A24 | 取消/恢复保持已接纳结果且不重复启动未知副作用任务 | 重开页面自动重跑、覆盖旧结果或不受预算控制 |
| A25 | 独立检查原始 Library/Design hash 前后不变 | 分析或导出直接改写源文件、许可证/API安装或全局设置 |
| A26 | 拦截模型请求，确认只包含已获授权的字段投影；未授权时仍可本地看图，AI明确缺少上下文 | 原始输入/sidecar、未授权对象标识或摘录被发送到外部模型；派生摘要绕过数据范围 |

### 完成定义

- 六项 Q17 场景均有对应测试/人工使用证据，失败/跳过/未运行分别记录；未具备数据不能计为通过。
- 至少一次真实 Hima 内原生 Liberty API 读取到可信结果的闭环，且覆盖本次实际使用的 API/适配器范围。
- LEF 几何规则与概率参考模型有独立反例及真实输入资格记录；不要求商业 P&R 实测校准才能计算参考
  概率，但未校准状态必须可见。
- 原型功能迁移、Library-only、Design-specific、两层交互、AI 引用及旧报告兼容分别可复核。
- 源文件未修改、共享接口回归通过、每个交付提交已推送并核对远端 SHA；可回滚代码和 Pack。

## Out of Scope

- 跨 release、跨 PDK 或跨供应商比较；同一套库内部的分支/PVT/corner 比较属于范围内。
- DEF 频繁/邻近 pattern 的深入分析；预留 Design 输入语义，但不是本 demo 的验收必需项。
- 自动执行 cell 替换、P&R 优化、写回 golden Library/PDK/Design；生成或应用工具专属约束文件。
- AI 自主开发新算法、任意 Python 规则沙箱、另一个服务/数据库/任务控制面。
- 没有适配和证据的通用 Verilog/STA dialect、完整 CCS/vector waveform、所有 LEF58/foundry 规则承诺。
- 用局部参考概率保证 signoff、硅可靠性、全设计 routability、PPA 收益或 Library release。
- 改造 Liberty API 安装、系统 Python、网络、证书、许可证服务或生产 EDA 环境以通过资格检查。

## Further Notes

### 依据与已有证据

- 产品定义及 Q1–Q17 访谈已确认；Hima 的三类分析任务与 Data Insight 归属继续遵守 ADR-0001/0002/
  0012/0013。本规格综合已确认需求，不启动新访谈。
- [GitHub #49](https://github.com/lluzi/hima_harness_reforge_polishing/issues/49) 已关闭，证明旧有界 E1–E4
  切片，不覆盖本规格整库分析、原型完整交互、LEF 或联合产品；旧文档中的 crash/blocked 状态不可
  不加日期地复述为当前状态。
- 原型快照 `8e3abdc47adcd4d2662c161e6b85f0a9d706df47`，只读审阅；固定副本的274项合成测试通过。
  原型测试是迁移基线，不是本次 Hima/真实库/LEF 产品验收。
- 几何概率模型的独立数学反例与定义已有记录；本规格新增的是可实施合同，不宣称物理算法已经交付。

### 代码定位与文件所有权

此表是实现定位附件，具体路径不构成对外接口；Implementation Decisions 以上只约束模块职责和行为。

| 已有位置 | 核查过的符号或职责 | 后续修改归属 |
| --- | --- | --- |
| `packs/library-intelligence/contract.yml`、`graph.yml`、`tools/`、`readers/` | 已有qualification及E2–E4 producer/reader；`library-analysis.py`、`library-stages.py`、`read-library-stage.py` | Pack/算法适配切片，新增LEF算法仍在该业务职责内 |
| `packages/harness/src/adapters/library-qualification.ts` | `attestLibraryQualificationPrelaunch`、`libraryQualificationObservationRefusal` | 主集成者负责原生资格接线，保留前置拒绝与持久Job验证 |
| `packages/harness/src/library-insight-report.ts` | `libraryInsightDocument`、`LibraryInsightReportView`、`filterLibraryFindings` | 主集成者负责v1/v2合同与兼容；分析worker消费冻结契约 |
| `packages/harness/src/guide-context.ts`、`experience.ts` | `resolveReportAddress`、`readGuideContext`、`readReportMaterial`、`retainRunMaterial` | 主集成者负责有界证据/sidecar读取和对象授权，不引入任意文件读取 |
| `packages/harness/src/client/LibraryInsightPanel.tsx`、`library-insight-view.ts` | `LibraryInsightPanel`、`readLibraryInsightView`、`libraryInsightIdentity`、`libraryInsightRecalculationIntent` | UI切片扩展现有报告视图和交互，遵守已冻结对象/配置身份 |
| `packages/harness/src/client/HimaWorkbench.tsx`、`remote.ts`、`index.ts` | 既有Workbench宿主、context/report-address与Guide/任务接线 | 仅单一主集成者修改共享接线；不向并行worker分配同一文件 |
| `test/contract/library-intelligence-pack.test.ts`、`library-insight.test.ts`、`unified-workbench.test.ts` | 真实Host、qualification、report保留、读取与UI投影先例 | 按上述L1–L4责任扩展；不以新增镜像测试替代真实链路 |

原型来源及审计位于项目的 Library Intelligence 开发资料，现有目录身份不必为产品名称改动而迁移。
冻结依据：[原型核查](https://github.com/lluzi/hima_harness_reforge_polishing/blob/78d830a1db02ed8a7fbfae61165be06fbfb0b498/docs/package-development/library-intelligence-platform/research/prototype-capabilities.zh-CN.md)、
[概率模型](https://github.com/lluzi/hima_harness_reforge_polishing/blob/78d830a1db02ed8a7fbfae61165be06fbfb0b498/docs/package-development/library-intelligence-platform/research/pin-access-probability-model.zh-CN.md)、
[已确认访谈](https://github.com/lluzi/hima_harness_reforge_polishing/blob/78d830a1db02ed8a7fbfae61165be06fbfb0b498/docs/package-development/library-intelligence-platform/product-interview.zh-CN.md)。

### 实施顺序、依赖与回滚

1. 冻结v2合同/能力清单/合成反例及v1回归；先复用Host读取链路，明确按源覆盖与unknown表示。
2. 迁入原型纯分析能力、匹配原生Liberty事实与配置语义，验证274项基线及Hima接纳，解决缺失归零等
   已定位差异；真实提取仅在相应资格成立后扩大输入范围。
3. 扩展现有Data Insight导航、矩阵、Heatmap/Envelope、配置及导出，使用冻结报告合同；独立实现LEF
   几何/参考概率模块。两条线无共享写入时可并行，最终在同一报告/对象合同接合。
4. 加入Design-specific、当前对象AI调用与受控重算；完成L2/L3、各自必要L4和六项产品场景。
5. 每个切片形成独立可恢复提交与验证记录；回退至此前Pack/代码版本，保留旧schema读取及全部证据。

普通实现和常规独立复核使用仓库规定的 Terra/medium；来源真实性、权限、状态恢复等关键复核使用
Sol/high。具体实施任务按此规格切片，标明自己的代码范围、依赖、最便宜反证和回滚点。所有写入和运行
在 polishing 工作区；参考原型及用户指定只读仓库不修改。本次 to-spec 仅发布规格，不执行本功能开发。
