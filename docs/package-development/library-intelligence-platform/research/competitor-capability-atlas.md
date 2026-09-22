# Library Intelligence Platform 竞品能力图谱

日期：2026-09-22
范围：DigWise `libMetric™`、Siemens Solido Characterization Suite（重点为 Analytics），并以 Synopsys PrimeLib、Cadence Liberate Trio/Library Validation、Empyrean QuaLib 作为必要基线。
证据边界：本图谱只写公开网页、公开用户指南和用户提供附件中可以复核的能力；没有把厂商营销数字当成实测结果，也没有把“本次未找到”写成“产品一定没有”。逐条证据、检索协议和附件观察见 [competitor-evidence.md](competitor-evidence.md)。

## 结论先行

公开证据支持两个不同但已经成熟的竞争范式：

1. **DigWise libMetric 是 Library metric 决策工作台。** 它把多 PVT `.lib` 转成合并的 metric 数据，以 PVT、device、function、cell 为检索轴，提供 PPA、timing balance、timing constraint、delay insertion 和 cell metric 分析；GUI 与 Python console/API 允许批量、插值、回归和定制分析。它更接近“让设计/Library 工程师看懂并选择 Cell”的产品，而不是完整的 Library QA/signoff suite。
2. **Solido Analytics 是 Library QA、异常诊断与比较平台。** 它以数百项规则、AI outlier、跨 PVT 与 slew/load 趋势、revision/vendor compare、可编程 transform/compare、GUI/batch/cluster 和结构化报告形成宽覆盖工作流。附件中的截图确实展示了趋势图、差异排序、规则详情和波形下钻，但没有展示真实 design instance/path/endpoint 与修复后商业实现结果的绑定。

PrimeLib、Liberate 和 QuaLib 进一步证明：多 PVT、LVF、ML、规则检查、revision compare、SPICE correlation、统一 GUI、批处理和 API 已经是成熟竞争区。Hima 若要“远远超过”，不能靠再做一个 parser、Dashboard、规则仓库或 AI 文案层，而必须把 Library finding 变成**设计条件化、证据可回放、可反证、能闭环到商业实现结果的工程决定**。

## 1. 全量能力图谱（以公开可核实范围为限）

### 1.1 功能、工作流与数据

| 维度 | DigWise libMetric | Solido Characterization Suite / Analytics | PrimeLib | Liberate Trio / Validation | QuaLib | 对 Hima 的含义 |
| --- | --- | --- | --- | --- | --- | --- |
| 核心工作 | metric 提取、跨 PVT 查询、Cell 比较与选择 | characterization、生成、验证、异常诊断、compare、library selection | characterization + QA + signoff correlation | characterization + variation + validation | standard-cell/IP 多视图验证 | “读 Liberty + 画图”远不够 |
| 主流程 | `.lib` → `INFO.json` → 多 PVT merge → Load Metric → 选择 PVT/device/function/cell → PPA/平衡/约束/延迟插入/Cell metric → Python 深挖 | Characterizer/Generator 产库 → Validate 规则 + AI outlier → GUI/HTML 下钻 → Compare revision/vendor → 修复/重跑 | 表征 → QA/SPICE correlation → compare/validate | nominal/LVF 表征 → validation/revision analysis/correlation | 多 view 导入 → PPA trend/SPICE validation/AI missing-arc | Hima 应接在 finding 到工程决定之间，而非复制造库主流程 |
| 对象层级 | PVT、device、function、cell、timing arc、load/transition、clock/data | library、corner、cell、pin、arc、table、metric、waveform、rule finding | library/cell/model/corner | library/cell/model/corner | library/IP/view/arc | 必须统一到稳定的 cell/pin/arc/table identity |
| 输入格式 | 用户指南明确 `.lib`、`.json`、`INFO.json`、合并后的 metric/DataFrame | `.lib`；timing/power/noise/variation；NLDM/CCS/LVF/Moments | advanced Liberty models | nominal/LVF library、cell/netlist/process-model validation context | GDSII/OASIS、Verilog、Liberty、LEF；SPICE validation | Hima 的差异不能只依赖 Liberty；设计证据也必须是一等输入 |
| 跨 PVT | 批量 cells × PVT；LS regression/interpolation；cross-probing | 趋势/outlier、Generator 新 PVT、Profiler 对齐与插值 | SmartScaling multi-PVT | 同一 run multi-PVT、ML corner prediction | 跨 release/revision PPA trend | 已是 table stakes |
| Library delta | 公开指南侧重跨 Cell/PVT metric 比较，未展示正式 revision diff 审计 | revision/vendor Compare，位置、severity、tolerance | compare/validate | revision analysis | release/revision trend | Hima 首切片仍需完整 semantic delta，但不能止于 delta |

### 1.2 规则、AI、可视化、自动化、集成与输出

| 维度 | DigWise libMetric | Solido Analytics | PrimeLib / Liberate / QuaLib 基线 | 证据边界 |
| --- | --- | --- | --- | --- |
| 规则 | 指南公开的是 regex arc filtering、参数约束、分析函数；没有展示类似 160+ 项 QA rule catalog | NVIDIA 案例称 >160 内建规则；支持 custom checks；覆盖 template/group/OCV/noise/model consistency 等 | 三家都公开 validation/QA/consistency/correlation 能力 | “DigWise 没有规则引擎”仅能写成公开指南未展示 |
| AI/ML | 官网把平台称为 AI-powered；2026 页面宣称 LLLM Agentic-EDA 闭环；但 2024 libMetric guide 的可复核算法是 LS regression/interpolation、统计分析、Python 自定义，没有展示 LLM 自动操作 libMetric 的产品证据 | AI outlier 跨 PVT 与 slew/load；Generator/Characterizer/GenAI assistant/log analyzer | PrimeLib：ML high-sigma/LVF；Liberate：ML corner prediction；QuaLib：AI missing-arc | “AI”本身没有差异性；必须看输入、约束、可复现结果和错误边界 |
| GUI | Library/Option/Metric/Console 四区；PPA、Timing Balance、Constraint、Delay Insertion、Cell Metric tabs；2D/3D/group/surface | Hierarchy、Trends、Corners、Worst-case/Largest Differences、Validate Details、Bookmarks；click-to-debug；波形与 LVF PDF/CDF/NQ | 统一 GUI、validation reports、job monitoring 已普遍 | 可视化是购买体验，不是可防御决策逻辑 |
| 批量/自动化 | `batchMetricPPA`、`batchMetricTimingBalance`、`batchMetricConstraint`、`batchDelayInsertion`；Python scripts；多 Cell/PVT | GUI + batch + multi-core/cluster；Transform/Compare API；HTML/CSV/JSON | cloud/cluster/parallelization、API 已是成熟能力 | Hima 必须提供可恢复 Job 和完整 input accounting，而非只启动脚本 |
| 定制 | Python console、data augmentation、自定义分析、正则筛选、可调权重 | custom checks、custom plots、user functions/variables、equation tolerance | re-characterization kit、validation utilities、Liberty APIs | 定制能力是购买理由，但也会制造不可审计的脚本漂移 |
| 集成 | `.lib/.json` → consolidated metric/DataFrame；官网更广泛宣称 design→validation→test→binning，但 libMetric guide 没有公开 STA/P&R adapter | Characterizer 直接联动 Analytics；Generator/Profiler；vendor/revision compare；front-end consumption JSON | PrimeTime/Tempus/QuaLib 自有生态与 SPICE/多 view 连接 | Hima 应连接现有 STA/P&R/implementation 证据，不宣称替代它们 |
| 输出 | metric database、交互 plot、2D/3D/line/surface、自定义 Python result；早期资料展示 JSON/CSV/DataFrame 转换 | ranked findings、HTML、GUI、CSV、JSON；附件还描述 PDF/text，但 lite 包没有原始生成产物 | reports、validated libraries、comparison/QA artifacts | 输出必须增加 source hash、producer、query、unknown、design linkage、验证结果 |
| 安全/部署 | 官网宣称全地端、air-gapped、弹性授权；未见独立安全审计或 libMetric 专属部署手册 | 支持企业 batch/cluster；公开页未说明 Hima 所需的客户证据默认不外发模型 | 主流企业部署与 cloud/on-prem 选项 | “本地”是必要采购条件，不等于证据真实性 |

### 1.3 用户角色与购买任务

| 角色 | DigWise 最直接的任务 | Solido 最直接的任务 | PrimeLib/Liberate/QuaLib 基线任务 | Hima 应补上的决定 |
| --- | --- | --- | --- | --- |
| Library developer | 看跨 PVT Cell 体质、PPA、constraint surface、delay insertion 候选 | 造库、验库、找 outlier、修复、回归 | 造库、variation、QA、SPICE correlation | 哪个 finding 先验证/修、为什么、修复后是否真正降低当前设计风险 |
| Library QA/release owner | 指标比较与趋势 review | exhaustive rule + AI finding、revision/vendor gate | consistency/completeness/accuracy gate | release decision 的证据链、未知、例外和 rollback |
| STA/methodology engineer | 在给定 load/tran 或 clock/data 下比较 Cell/PVT | 诊断 model/table 异常 | signoff correlation、revision impact | finding 是否覆盖当前 path operating point、是否导致 endpoint migration |
| Synthesis/PD engineer | 早期 Cell 选择、PPA trade-off、delay insertion | Profiler 选库，Analytics 辅助理解 | signoff/implementation 生态消费 Library | 当前网表实际采用、实例数、frontier、物理状态与商业工具响应 |
| IP integrator | 公开指南证据较弱 | vendor IP Compare、tolerance、JSON/CSV handoff | incoming Library cross-check、多 view validation | 外来 IP finding 是否影响当前产品、最便宜的独立反证 |
| Manager/flow owner | 官网强调可负担授权、定制和整合 | 取代低覆盖、高维护内部脚本 | 已有 enterprise suite 与 signoff 生态 | review time、无效调查、escaped defect、可复现性和投入回报 |

## 2. DigWise：强项、限制与购买理由

### 2.1 可复核强项

- **把 Library data 变成工程选择面。** 用户指南不是泛泛展示 parser，而是提供 PPA、timing balance、timing constraint、delay insertion、cell metric 五类明确任务。`batchDelayInsertion` 还把目标 delay、best/worst PVT、stage 数、area/setup penalty 与可调权重放在同一分析里。
- **工作点条件化。** `plot_cell_lsc_surface`、`cellMetricConstraint` 与各 batch API 以 `(load, transition)` 或 `(clock, data)`、PVT 和 arc regex 为输入，使用 LS regression/interpolation；这比只比较单点 scalar 更接近工程实际。
- **低门槛 GUI + 可编程出口。** 四 panel GUI 面向日常选择；Python console、DataFrame、data augmentation 和 custom analysis 面向方法工程师，避免所有需求都等待产品版本。
- **跨 PVT/跨 Cell 一屏比较。** 附图明确展示多个 corner 上 39 个 Cell 的 delay、power、leakage 趋势；早期资料也把 JSON/CSV/DataFrame 作为数据科学入口。
- **商业定位清楚。** 官网以按需/弹性授权、process customization、GUI + console 和 design→test→binning 组合为购买叙事；对无法承担完整大型 suite 或需要定制流程的团队有吸引力。

### 2.2 限制与证据缺口

- **不是公开证明的完整 QA/signoff suite。** 当前公开 guide 没有 rule catalog、Liberty syntax/semantic compliance、NLDM↔CCS correlation、LVF/noise/current-waveform validation、SPICE crosscheck、false-positive/negative 数据。
- **数据 lineage 不足。** 指南说明 `INFO.json`、merge、Load Metric 与 consolidated database，却未展示 source SHA-256、parser/build identity、query policy、cache invalidation 或结果回到原 Liberty location 的审计链。
- **设计上下文仍停在“设计前期选择”。** 公开 guide 没有把 metric 连接到当前 netlist instance、timing path、endpoint frontier、actual slew/load、route survival 或 matched implementation response。
- **AI 证据层级不一致。** 2026 官网/新闻页宣称全地端 LLLM、agentic closed-loop 和“每项决定可追溯”，但 libMetric 的公开操作指南展示的是 deterministic/statistical/Python workflow；本轮没有找到 LLM 在 libMetric 内做何种 action、如何受规则约束、失败如何落账的可操作证据。
- **输出与 release gate 较弱。** 公开 guide 没有展示正式 finding ledger、review disposition、waiver、batch audit report、CI exit semantics 或 candidate Library round-trip。
- **文档版本和产品现状不完全对齐。** Guide 标为 2024，当前官网为 2026；商城需要登录。公开 demo 明确写“模拟演示分析，数据非实际结果”。因此不能从 demo 推断当前生产版精度、规模或客户效果。

### 2.3 为什么客户仍会买

1. 不想维护自制 Liberty parser/metric scripts，希望快速获得跨 PVT 的 Cell/PPA 工作台。
2. 需要将 domain engineer 的分析扩展为 Python/DataFrame，而又希望常规用户用 GUI。
3. 主要购买任务是早期 Cell 选择、constraint/timing balance、delay insertion，而不是全套 signoff-grade QA。
4. 预算、灵活授权、local deployment 或 process customization 比大型套件生态完整性更重要。
5. 希望把 Library、WAT/CP、sensor、binning 纳入同一供应商的 DTCO 叙事；但购买前仍需用真实 workload 验证跨产品数据身份和闭环。

## 3. Solido：强项、限制与购买理由

### 3.1 可复核强项

- **宽规则覆盖。** Siemens/NVIDIA 案例公开 >160 项 built-in checks，例子包括 template/group、timing group/OCV、propagated noise、DC current waveform、NLDM/CCS/ECSM mismatch；还支持 custom checks。
- **抓“格式合法但物理可疑”的 soft failure。** AI outlier 同时分析跨 PVT 趋势与单 PVT 的 slew/load table；附件截图清楚显示 setup constraint kink、LVF sigma/skewness 的非平滑趋势。
- **强诊断 UX。** Library hierarchy、corner 选择、X-axis/Color-by、worst-case differences、Validate Details、location、CCS-vs-NLDM scatter、current/derived-voltage waveform 在一个诊断路径中。
- **compare 与自动化成熟。** revision/vendor compare 支持 absolute、relative、equation tolerance，并输出按 failure type × PVT 的摘要、位置、severity、CSV/JSON；Validate 支持 GUI、batch、multi-core、cluster 和 HTML ranked result。
- **从造库到选库的一体化。** Characterizer、Generator、Analytics、Profiler 形成 produce→expand→validate→select 的 suite；Analytics 与 Characterizer 的 live debug 连接降低上下文切换。

### 3.2 附件关键观察（绑定具体文件）

- `report-imgs/ui-worst-case-diff.png`：可见 Solido Liberty Explorer 的 Hierarchy、Trends、Corners、Selected Group Information 与 `Worst-case Differences` 表；行含 Magnitude、Diff、Rel Diff、Type、Index、Corner、Location。这直接证明跨 corner 差异排序和 source location 下钻。
- `report-imgs/ui-setup-constraint-kink.png`：可见 `voltage vs fall_constraint`，颜色条是 temperature，红圈标出局部反转；证明 trend view 能把非单调点显性化，但图本身不证明算法召回率。
- `report-imgs/ui-lvf-messy-sigma.png`：可见 `voltage vs OCV_skewness_fall_constraint` 多温度曲线高度杂乱；证明 LVF moment 可视化，不证明自动根因定位。
- `report-imgs/pdf-fig10-info-viz.png`：白皮书页同时显示 CCS vs NLDM scatter、CCS current、derived voltage 和 `Validate Details` 规则行；证明 finding→波形诊断链，不证明修复写回或 signoff 改善。
- `report-imgs/ui-characterizer-tasks.png`：可见 PVT×Cell task tree、CPU/cluster load、progress monitor；这是上游 characterization orchestration，不是 Analytics 自身发现缺陷的证据。
- `report-imgs/ui-outlier-ml-find.png`：2020 Mentor slide 声称自动识别所有问题、无需规则且是当时唯一商业方案；这是营销 claim，不应与可测的 coverage、precision 或 2026 独占性混同。

### 3.3 限制与证据缺口

- **公开证据核心仍是 Library-internal QA。** 本轮对官方产品页和 NVIDIA 案例定向检索，没有找到 finding 绑定当前 design instance/path/endpoint frontier、actual operating point 和 matched implementation response 的公开工作流。
- **排名不等于设计影响。** Score、severity、worst-case diff 能排序库内异常，但一个未采用 Cell 的巨大异常和一个命中当前 worst endpoint 的小变化需要不同决策；公开材料未展示这层分解。
- **闭环声明缺少可回放 lineage。** 没有看到 source hash、tool build、extractor/query version、完整 input accounting、unknown propagation、candidate-copy invariant、rollback 或最终商业 label 的公开 schema。
- **营销数字未独立验证。** “hours instead of weeks”“100x+”“5x”“all issues”等来自厂商页面/slide；NVIDIA 案例是 Siemens 对客户演讲的转述，不是独立 benchmark。
- **附件是 lite 二手证据包。** 压缩包有 38 张 PNG、18 个唯一 SHA-256；多张是同一像素的重命名副本。包内没有报告声称存在的 `evidence/SOURCES.md`、原始 PDF、视频或 live license session，因此只能把可见像素与公开官方页面组合使用。

### 3.4 为什么客户会买

1. 需要从维护成本高、覆盖低的内部脚本迁移到广覆盖、可扩展的 Library QA。
2. 需要同时处理 rule violation 与传统规则难以描述的 PVT/table outlier。
3. 要把 library producer、incoming-IP integrator、QA/release owner 放在同一 compare/report 流程中。
4. 已采用 Siemens characterization stack，希望从 Characterizer 到 Analytics/Generator/Profiler 直接联动。
5. 需要 batch/cluster、HTML/CSV/JSON 和 custom API/tolerance 进入企业回归流程。

## 4. 哪些已经只是 table stakes

以下能力必须有，但单独不能支撑“远超竞品”：

- 可靠 Liberty parse；Cell/pin/arc/table/units/operating condition 查询；
- 多 PVT、多 VT、多 model/view 的 index、filter、compare 和 trend；
- PPA、constraint、delay/transition/power/leakage/area 的 2D/3D/surface 可视化；
- rule-based checks、custom rules、severity 和 finding disposition；
- anomaly/outlier detection、非单调与 table spike；
- NLDM/CCS/LVF/Moments、noise/current waveform、variation 数据处理；
- revision/vendor delta 与 absolute/relative/formula tolerance；
- GUI + batch + Python/API + cluster/parallel execution；
- HTML/CSV/JSON/report 与 source location；
- custom plots、functions、data augmentation；
- characterization/validation/select 的工作流整合；
- 本地部署、权限控制和不上传 proprietary Library。

其中“AI”不是额外一项 table stake，而是若干能力的实现手段。没有可复现输入、约束、错误状态和验证结果的 AI，不构成工程能力。

## 5. Hima 要“远远超越”的必要设计条件

### 5.1 从 finding 排名升级为双轴决定

每个 finding 必须保留而不是压成一个总分：

- `librarySeverity`：规则/变化本身的严重度、确定性、覆盖范围、release 风险；
- `designRelevance`：当前 design 是否采用、instance count、是否命中 endpoint frontier、actual slew/load 是否落在变化区、margin/path-migration 风险、当前 commercial flow 是否观察到响应。

`designRelevance=none` 只表示当前设计未见影响，不能把高严重度 Library 错误改写成 PASS。排序可以组合两轴，原始值和完整 finding set 必须保留。

### 5.2 证据链必须从结论回到原字节和设计事实

最低证据链：

`Library source SHA-256 + source role`
→ `Lib API build + Python/runtime + adapter SHA/schema`
→ `cell/pin/arc/table/units/source location facts`
→ `delta/rule/outlier algorithm + parameters + query`
→ `design state hashes (netlist/timing/constraints/checkpoint)`
→ `master/instance/path/endpoint/actual slew-load linkage`
→ `hypothesis + cheapest falsifier`
→ `SPICE/STA/implementation observation`
→ `candidate copy + round-trip/invariants`
→ `matched comparison / adoption / route survival / WNS-TNS-PPA-DRC`
→ `decision, waiver, rollback, unknowns`。

任何缓存、图、embedding 或 SQLite 只能是带 source/producer identity、可删除重建的派生物；Library 原件和商业工具报告继续是 authority。

### 5.3 研究闭环必须能主动推翻自己

1. 全量 index 与完整 finding accounting；解析失败不能从 denominator 消失。
2. 规则、semantic delta、outlier 产生假设，不自动产生 release decision。
3. design join 评估 reachability 与 operating-point overlap。
4. Campaign Agent 选择最便宜的反证：source replay、局部 query、SPICE、STA 或 matched implementation。
5. 候选修改只写 Campaign workspace 新副本，先 round-trip 和 invariant，再进入独立试验。
6. Judge 同时检查 Library severity、design relevance、proof、adoption、route survival、QoR 与限制条件。
7. Commercial Label 只绑定当前 Design State；用于更新下一轮 risk/uncertainty/trust region，不外推为跨设计固定收益。
8. 成功、有效负结果、工具故障、覆盖不足和 unknown 分别归档。

这不是第二个 autonomous control plane：HimaPack 提供方法和工具；Site/Channel 执行；Ledger/Archive 保存事实；一个可见 Campaign Agent 是业务 owner；Workbench 只投影同一份事实。

### 5.4 AI 必须有窄权责

AI 可以解释 finding、生成假设、选择验证、编写受限查询/脚本并根据结果调整策略；它不能：

- 改写 source facts、rule result 或商业工具结果；
- 把缺失值补成零，把未采用写成 PASS；
- 自行删除完整 finding；
- 直接覆盖 golden Library；
- 用自然语言置信感替代 source identity、proof 和 matched result。

## 6. 购买边界：Hima 应与谁竞争

Hima 不应宣称替代 PrimeLib/Liberate/Solido/QuaLib 的 characterization 或 exhaustive QA。更可信的购买单元是：

> 客户已有 Library、STA/P&R 和至少一种 QA/characterization 工具，但缺少一个把海量 finding、revision delta、实际设计采用和商业实现结果组织成可复核工程决定的研究闭环。

因此可以与竞品互补：吃 Solido/QuaLib/Liberate/PrimeLib 的 finding/report，也可用 Empyrean Liberty API 生成自有 facts；差异在同一 Ledger 中完成 design join、反证、candidate-copy 试验、matched result 和知识资产沉淀。

## 7. 具体 Continue / Stop 信号

以下是首轮 pilot 前应冻结的候选门槛，不是已经达成的结果。

### Continue：全部满足才扩大

1. **解析资格：** vendor fixture、一个代表性 SAED14、一个代表性 TSMC28 输入完成 read/query/write-copy/re-read；三者原件 SHA-256 前后不变，0 个 silent partial result。
2. **可复现：** 相同 source hash + producer identity + query 的 facts/finding hash 100% 一致；cache 删除后可重建。
3. **完整性：** manifest 中每个输入都有 success 或 explicit failure record；完整 finding set 不因 top-N 排名丢失。
4. **identity join：** pilot 中所有进入 top investigation 的 finding 都能回到唯一或显式 ambiguous 的 cell/pin/arc/table，并连接到 design hashes；歧义不能静默择一。
5. **人类价值：** 至少 3 个历史 revision review 做预注册对照；design-conditioned ranking 不降低工程师确认的高影响 finding recall，同时把无关 top investigation 数或 review time 至少一项降低 30%。该阈值是产品门，不是行业 benchmark。
6. **反证价值：** 至少一个 top finding 通过独立 SPICE/STA/implementation 被确认或推翻，结论、未知和下一动作可由另一工程师复算。
7. **安全：** 0 次输入覆盖；所有 candidate 均为 workspace copy，具 diff、round-trip、rollback；proprietary body 不进 Git/模型外部服务。

### Stop / redirect：任一项触发即停止扩大

- 支持环境中的 fixture 或代表性输入仍发生进程级 crash，且没有厂商可用包或授权诊断；
- design evidence 无法稳定对齐 cell/pin/arc identity，或歧义被迫由模型猜测；
- cache/index 不能由 source hash 重建，或成为与原件冲突的第二事实源；
- 未采用 Cell 的 finding 被标成 PASS，或高 severity finding 因 design relevance 低而被删除；
- 与固定 severity/现有人工 review 相比，三次 pilot 没有减少 review time/无效调查，也没有减少漏掉的高影响 finding，只增加解释负担；
- 自动建议不能被最便宜反证检验，或者需要先建设独立数据库/控制面才能完成首切片；
- candidate write、AI action 或报告无法给出明确 source/producer/query/design-state identity 与 rollback；
- “远超竞品”的主要证据仍是 feature count、厂商 demo 或模型自述，而不是当前设计决定和实测结果。

## 8. 当前判断与剩余未知

当前最强判断不是“Hima 已经领先”，而是：**公开竞品已经把 Library 内分析做到很深，但本轮公开证据没有展示从 Library finding 到当前设计实例、endpoint frontier、actual operating point、最便宜反证、candidate-copy 与 matched commercial outcome 的完整链。** 这是一个值得用首切片验证的差异假设，不是已证明的市场空白。

最关键的剩余未知包括：竞品私有部署中是否已有 design-context join；DigWise 2026 生产版相对 2024 guide 的变化；Solido rule/outlier 的 false-positive/false-negative 与 disposition schema；各产品的真实价格、规模、runtime、客户 review-time 改善；以及 Empyrean API 在目标 Site 的可用运行环境。任何销售或架构决定都不应把这些 unknown 自动补成有利答案。
