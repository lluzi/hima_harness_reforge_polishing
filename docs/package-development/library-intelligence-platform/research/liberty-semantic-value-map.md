# Liberty 语义到芯片竞争力：可实施价值地图

日期：2026-09-22

读者：Standard-cell Library、characterization、STA、综合、物理实现、DTCO 与产品工程师。

证据账本：[liberty-evidence.md](liberty-evidence.md)

## 结论先行

Liberty 的真正价值不是“里面有多少属性”，而是它把一个 Cell 的**抽象行为与电气响应**编码成可查询的条件化模型：在什么 PVT、单位、输入状态、输入 slew、输出 load、波形、统计分布和电源条件下，某条 arc、constraint、power 或 reliability 模型成立。产品必须用两个正交维度和一个状态描述认识：

1. `derivation_level`：**explicit / deterministically derived / model-inferred**；
2. `source_domain`：**Liberty / design / STA / SPICE / physical / silicon**；
3. `evidence_status`：**available / unknown / ambiguous / contradicted / corroborated**。

“Unknowable from Liberty alone（U）”是某个 query 相对当前 Liberty-only 证据集的状态，不是外部证据加入后的永久 derivation level。产品必须把三个维度留在每条 finding 上，不能用一个 “Library quality score” 抹平。最有价值的产品链不是 `parse -> chart`，而是：

> source hash + Liberty 语义事实 → 可复现派生关系 → 当前 Design State 的实际消费/工作点 → 最便宜的独立反证 → 工程决策 → matched commercial response / silicon corroboration。

Liberty 可以说明“模型怎样说”；它单独不能说明模型是否与 transistor、layout、实现工具或芯片一致，也不能证明 Fmax、功耗、良率或可靠性竞争力。[LIB-E16]

## 1. 正交证据语义与表内 shorthand

| 维度/等级 | 产品中的定义 | 允许的措辞 | 禁止的升级 |
| --- | --- | --- | --- |
| `derivation_level=explicit` | 某 source domain 的有 hash artifact 直接陈述；保留原 token、scope、source location、单位与条件。 | “该 Liberty revision 声明……”“该 STA report 观察到……” | 不能从声明/观察直接升级为模型正确或芯片因果。 |
| `derivation_level=derived` | 输入 identity、归一化规则、条件 AST、插值策略与算法版本固定后，同样输入必得同样输出。 | “在共同网格和冻结插值策略下，revision B 比 A 增加 8%。”“该 instance 确定引用此 master。” | 不能把外推区、missing、默认值或语义不等价对象强行比较。 |
| `derivation_level=inferred` | 由异常模型、代理、历史 commercial label 或不完备映射给出的概率/排序。 | “较可能影响这些 endpoint；置信度中。” | 不能写成 PASS/FAIL、root cause 或固定 PPA 收益。 |
| `source_domain` | `Liberty/design/STA/SPICE/physical/silicon`，说明 explicit/derived/inferred 的证据来自哪里。 | “Liberty 声明；STA 已消费；SPICE 独立测量。” | 不能把不同 domain 的 explicit facts 混成同一事实。 |
| `evidence_status` | 当前 query 为 available/unknown/ambiguous/contradicted/corroborated。 | “Liberty alone unknown；需要 STA readback + netlist/PEX/SPICE。” | 不能用缺省、均值、文件名、模型规模或 AI 猜测补空。 |

后文 E/D/M/U 列只是一种以 Liberty 为起点的阅读 shorthand：E/D/M 分别表示 Liberty-domain 的 explicit/derived/inferred，U 表示该问题当前 Liberty-alone unknown。真正落库必须使用上述正交字段。外部 design/STA/SPICE/physical/silicon evidence 可以是 explicit 或 derived，不能一律归入 M。

## 2. 总体价值转换链

| Liberty 层 | 可挖数据 | 最近的工程判断 | 必需外部 corroboration | 可兑现的竞争力 | 最常见错误结论 |
| --- | --- | --- | --- | --- | --- |
| artifact/library | units、PVT、revision、technology、default、template、model/view inventory | 两个文件是否具备可比前提；release 是否完整、重复或错配 | manifest、owner/release mapping、tool readback、device/RC deck | 降低错版/错 corner/单位错误的 escaped risk 与 review 时间 | 文件名相似 = 同 corner；parser 可读 = release 正确 |
| cell/interface | cell、pin、pg_pin、bus、bundle、功能、sequential state | 接口/功能 coverage、供电语义、可替代候选 | Verilog、SPICE/CDL、LEF/GDS、UPF/CPF、LVR | 综合可用性、low-power 正确性、ECO/DFT 覆盖 | function 相等 = 物理可替代；pg_pin 存在 = body/power 正确 |
| arc/constraint | related pin、type、sense、when、mode、SDF condition、delay/constraint table | arc closure、conditional reachability、约束是否缺失/异常 | STA annotation/readback、SDF、clock/SDC、功能状态可达性 | Fmax、时序 yield、避免 setup/hold/pulse escape | from/to 相同 = 同一 arc；missing check = 0 |
| electrical model | NLDM、CCS/ECSM、receiver cap、driver/noise/current waveform | 工作点 coverage、table shape、模型选择风险 | golden SPICE/PEX、interconnect/load、signoff model selection | 更小 guard-band、更稳 timing/SI/power closure | CCS 一定优于 NLDM；更大表 = 更准确 |
| power | internal/switching/leakage/PG current | 每事件能量、状态漏电、rail-current 风险 | vectorless/vector activity、workload、clock gating、IR/thermal | energy/op、待机功耗、供电完整性 | Liberty internal power 直接等于芯片动态功耗 |
| variation/reliability | LVF sigma/moments、EM、SER/critical area | variation surface、非高斯风险、cell-level EM limit | STA OCV config、path depth/distance、Monte Carlo/SPICE、activity、physical rail、thermal/lifetime | yield、guard-band、寿命与可靠性 | sigma table = path yield；EM table = chip EM signoff |
| cross-* relation | corner/revision/view/cell family delta | 回归归因、异常聚类、blast radius、修复优先级 | design consumption、multi-view identity、commercial flow | 更快 release、更少 escape、更少无效调查 | 全局最大 delta = 当前设计最高风险 |

## 3. 语义族价值地图

### 3.1 library / operating condition / unit / template

| 项目 | E：显式事实 | D：确定派生 | M：模型推断 | U：Liberty 单独不可知 | 工程价值、陷阱与反例 |
| --- | --- | --- | --- | --- | --- |
| library identity | library name、revision/date、technology、delay/power model、default operating condition、原始 hash | content-addressed duplicate、结构 fingerprint、声明差异 | 文件是否属于同一 release family（需 manifest/路径先验） | foundry approval、法律授权、实际被工具加载的版本 | 先做 provenance，不先画 PPA。反例：两个不同路径文件 byte-identical，不是两个 corner；同名文件也可能不同 release。 |
| units/thresholds | time/voltage/current/capacitance/leakage/dynamic-power unit，input/output threshold 与 slew trip/derate | 转 SI、量纲校验、跨文件共同单位比较 | “单位异常最可能是 typo”只能作为假设 | characterization recipe 的测量定义是否真的匹配 | 保留 raw + normalized。缺 unit ≠ 使用任意默认；阈值不同会改变 delay/slew 可比性。[LIB-E02] |
| operating_conditions | process scalar/label、voltage、temperature、tree_type | PVT key、corner grid coverage、声明 corner gap | corner family/slow-fast clustering | device-model deck、RC corner、local variation population、actual silicon distribution | 不能由文件名覆盖正文；PVT 相同也不表示 RC/model/revision 相同。[LIB-E03] |
| templates/axes | template kind、variable_1..N、indices、dimension | cardinality、单调 axis、共享模板引用闭合、采样密度/范围、共同网格重采样（策略冻结时） | sparse region 风险与建议补点 | 超出 grid 的真实响应、tool extrapolation/clipping（未验证时） | 轴顺序属于语义；`index_1`/`index_2` 交换会产生看似平滑但错误的曲面。[LIB-E04] |

实现要求：任何数值进入比较前，必须携带 `source_sha256/parser_build/schema/unit_system/template_identity/raw_condition`。比较器先判 `comparable / conditionally-comparable / incomparable`。

### 3.2 cell / pin / pg_pin / bus / bundle

| 项目 | E | D | M | U | 价值与反例 |
| --- | --- | --- | --- | --- | --- |
| cell | name、area、footprint、Vt/category flags、dont_use/map_only、leakage、subgroups | family/drive-strength grouping（依据显式 naming/footprint policy）、接口 signature、feature coverage | “候选等价替换”“更优 size” | layout height/site、pin access、drive topology、真实可合法替换性 | 同 footprint/函数不证明 placement、电源、天线或 pin-access 等价。 |
| pin | name、direction、capacitance、clock/scan flags、function、related supplies、arc/power groups | interface signature、逻辑 support、pin-cap envelope | 输入敏感性/关键性（需设计 activity/path） | physical port geometry、ESD/analog limits | scalar cap 不是 CCS receiver cap；pin cap 小不必然更快。 |
| pg_pin | pg_type、voltage_name、bias/physical connection、related bias、power-down semantics | supply-role matrix、missing primary rail、voltage-map closure | low-power integration risk ranking | CDL body connection、UPF supply set、physical rail continuity | Liberty rail 语义正确不能证明 SPICE/layout rail 正确。[LIB-E16] |
| bus | type、width、from/to、downto、bit pins | bit expansion、range/width consistency、bit-level arc coverage | bus-wide异常聚类 | HDL packed/unpacked binding是否被具体工具一致解释 | bus name normalization若忽略方向/范围会错误对齐。 |
| bundle | explicit member list + pin semantics | member closure、共同属性覆盖 | multibit family candidate | physical multibit adjacency、shared clock/power topology | bundle 是逻辑/语义分组，不等于 physical multibit cell。 |

### 3.3 function / three-state / sequential / statetable

| 语义 | E | D | M | U | 转化链与反例 |
| --- | --- | --- | --- | --- | --- |
| function | Boolean expression on output/inout | parse AST、truth table、support set、unate class、NPN/NP equivalence、cross-revision functional diff | mapping usefulness/coverage | transistor topology、glitch/hazard、analog strength、layout equivalence | `function -> equivalence class -> design cone match -> synthesis/ECO trial -> adoption/QoR`。函数相同只证明抽象逻辑相同。[LIB-E05] |
| three_state/x_function | Z/X condition | mutual-exclusion/overlap check、truth table with 0/1/X/Z semantics | bus-contention risk ranking | analog contention current、pad/ESD behavior | 不能把 `three_state` 当普通 Boolean output；enable polarity会改变 arc reachability。 |
| ff/latch | state variables、clocked_on、next_state、clear/preset、bank reference | state-transition relation、async-control conflict、pin-role signature | scan/clock-gating suitability | metastability、real retention、setup/hold correctness | sequential function matching必须包含 clock/control polarity与状态，不只比 Q function。 |
| statetable | input/current/next-state rows | determinism、coverage、conflict/unreachable row（在声明表域内） | 未覆盖状态风险 | transistor state、power-up state、真实 illegal-state recovery | 表自身完备不等于实现安全；缺行不能自动补为 hold/X。 |

### 3.4 timing arc / type / sense / when / sdf_cond

推荐 canonical arc key：

```text
(cell, to_pin, related_pin_set, related_output_pin,
 timing_type, timing_sense, normalized_when_ast,
 mode_set, sdf_cond/start/end, model_kind, edge, sigma_type)
```

| 语义 | 可挖与判断 | 外部 corroboration | 陷阱/错误反例 |
| --- | --- | --- | --- |
| related pins / arc endpoints | E: from/to/related output；D: arc inventory、duplicate/overlap、rise/fall coverage | Verilog function、STA arc listing | 只按 pin pair diff 会把 setup、hold、propagation、three-state arc 合并。 |
| timing_type | E: propagation、edge、setup/hold、recovery/removal、pulse/period、non-seq/nochange 等；D: arc role closure | STA check type/readback | `minimum_period`/constraint 不是 cell delay；缺 type 的默认组合语义必须版本化处理。[LIB-E10] |
| timing_sense | E: positive/negative/non-unate；D: combinational function unateness cross-check | state sensitization、STA | XOR 的单条条件 path 可能 unate，但总函数 non-unate；不能覆盖多个 path 的不同 sense。[LIB-E06] |
| when/mode | E: conditional activation；D: AST canonicalization、SAT overlap/gap、条件等价/蕴含 | functional state reachability、mode/power intent、design constants | 文本不相同不代表语义不同；条件永不可达不等于 Library defect，但需 design evidence。 |
| sdf_cond/start/end | E: SDF check/path conditions；D: syntax/identity/diff | SDF annotation report、simulator semantics | `when` 与 `sdf_cond` 属不同表达/消费者，禁止字符串等同或互相替代。[LIB-E06] |

价值链：`arc semantic delta -> design instance adoption -> reachable condition -> actual slew/load/path -> endpoint frontier -> STA/matched implementation -> Fmax/yield`。前四步缺任何一步，都只能是 Library finding，不能成为芯片收益/风险事实。

### 3.5 NLDM、CCS、ECSM waveform/current/noise

| 模型 | E | D | M | U | 工程判断与陷阱 |
| --- | --- | --- | --- | --- | --- |
| NLDM | delay/transition LUT + axes | shape、coverage、gradient、monotonicity、corner/revision delta、指定插值策略下的 query | unsampled-region anomaly、design envelope risk | SPICE accuracy、waveform distortion、SI interaction | 只在相同 threshold、unit、axis semantics、PVT 下比较。负 propagation 值可能合法；delay/transition table 不可套同一规则。[LIB-E04] |
| CCS timing | output current vs time/load/slew，reference time，receiver cap segments | waveform charge/integral、peak、alignment、segment continuity、共同 grid delta | interconnect-regime suitability | signoff精度、真实 receiver/interconnect response | current 单位、time origin、reference_time、segment/load identity 任一错配都会产生错误积分。[LIB-E07] |
| CCS noise/CCSN | first/last-stage、dc current、output voltage、propagated noise | model closure、waveform/table consistency | crosstalk/noise susceptibility ranking | victim/aggressor topology、coupling SPEF、switch windows | Library noise模型没有真实 net coupling；不能从 cell 模型直接报 design noise margin。 |
| CCS power/PG current | dynamic current switching groups、PG waveform | charge、peak/RMS proxy、rail attribution、state coverage | simultaneous-switching/IR risk | design activity、temporal alignment、PDN impedance、package/thermal | 单 cell 峰值简单相加会严重误判 chip current。 |
| ECSM | ECSM format中的 current/voltage/noise/power/variation语义 | 仅在 parser 明确识别且版本语义注册后做确定派生 | CCS↔ECSM comparison需模型-aware adapter | 把未知 ECSM group 自动按 CCS 解释 | ECSM 与 CCS 是不同模型族；首版应 lossless preserve unknown group，不做伪统一。[LIB-E08] |
| receiver cap | pin/arc-level one/two/multisegment capacitance tables | segment closure、arc override、slew/threshold consistency | driver-receiver interaction risk | actual effective C under routed waveform | 不可用 scalar `capacitance` 覆盖 receiver-cap model；pin-level与arc-level override需保留。[LIB-E07] |
| driver waveform | normalized waveform、slew/voltage sample | waveform reconstruction、trip-point cross-check、tail/shape指标 | input-shape sensitivity | routed upstream waveform | “同 slew”不等于“同 waveform”；只用 10–90% slew 会丢失 tail/非线性。 |

### 3.6 internal / switching / leakage power

| 数据 | 分类与可挖结果 | 需要什么才能进入芯片判断 | 反例 |
| --- | --- | --- | --- |
| internal_power rise/fall/power | E: related pin/PG/when/mode、energy/power LUT；D: per-event energy、state/edge coverage、revision delta | instance mapping、input transition/output load、toggle count、mode residency | 把 table value 当 W 而忽略“per transition”及 unit；把 rise/fall 平均后丢掉 workload 偏置。[LIB-E09] |
| switching/dynamic PG current | E: switching condition、current waveform；D: per-event charge/peak/RMS | vector/SAIF/FSDB activity、clock gating、event alignment、PDN/IR analysis | 所有 instance 同相切换或完全独立的假设都可能错。 |
| leakage | E: cell default + state/rail/when dependent leakage；D: state map、corner delta、missing-state coverage | state probability、power state、temperature/voltage、actual instance count | `cell_leakage_power` 不能替代 state-dependent leakage；缺状态不能按零处理。 |

芯片竞争力只能在 `Library energy/leakage model × actual design state/activity × implementation × voltage/temperature` 后讨论 energy/op、standby power、IR/thermal。Liberty-only 可以产出**可解释因子**，不能产出芯片总功耗。

### 3.7 constraints / min pulse / min period

必须把三类对象分开：propagation delay、timing constraint、design rule。建议分别计算：

这里的 pulse/period 对象同时覆盖 `min_pulse_width` group、`minimum_period` group，以及相应
`timing_type` constraint arcs；它们必须按各自 precedence 和条件语义解析。

- constraint coverage：setup/hold/recovery/removal/non-seq/nochange/width/period 的应有-实有矩阵；
- conditional closure：`when/mode/sdf_cond` 的 overlap、gap、unreachable（后者需设计证据）；
- surface health：slew/load/related transition axes、非物理跳变、corner/revision delta；
- consumption：STA 是否读到、是否 annotate、是否实际形成 check/violation。

反例：clock pin 同时有 `min_period` simple attribute 与 `minimum_period` group 时存在明确优先级；扁平 parser 若把两者并列平均，会得出无意义结果。[LIB-E10]

### 3.8 OCV / AOCV / POCV / LVF / moments / sigma

| 概念 | Liberty 中能看到什么 | 正确工程解释 | 禁止结论 |
| --- | --- | --- | --- |
| nominal OCV margin | nominal tables本身不等于 OCV；可能另有 tool derate | E/D只能记录配置缺失或 join 外部 derate | 从 nominal corner spread 直接称 OCV sigma |
| AOCV | 统一 OCV 生态可使用 Liberty/外部 derate；核心决策依赖 path depth/distance 与工具配置 | 必须导入实际 AOCV table/config 与 STA readback | 从单 cell Liberty table重建 AOCV path derate |
| POCV/LVF sigma | per-arc slew/load sigma offsets、early/late sigma type | 与 nominal、n-sigma、correlation及STA算法组合 | sigma = worst-case delay；cell sigma直接相加成path sigma |
| moment-based LVF | mean shift、std dev、skewness tables | 表达 biased/asymmetric distribution的矩；仍需统计传播 | 有三个矩就等于完整分布或精确 tail yield |
| POCV evaluator | Empyrean wrapper声明 enable/n-sigma knobs | 只登记“declared surface”；qualification后以golden fixture验证 | wrapper有方法名 = 算法正确/与PrimeTime一致 |

关键区别：R-2020.09 手册明确指出，LVF/parametric OCV variation 是 cell/arc-specific；AOCV 是对多个 cell 或 Library scope 应用 derate。[LIB-E11] 产品 ontology 应把 `VariationObservation(model_family, statistic, sigma_type, scope, correlation_assumption, tool_config_hash)` 作为独立实体，不能只放一个 `sigma` 字段。

### 3.9 EM / aging / reliability

| 项目 | Liberty 能表达 | Liberty 单独不能表达 | 正确转化链 |
| --- | --- | --- | --- |
| electromigration | pin-level EM table、related pin/bus、condition、max toggle rate、temperature degradation factor、lifetime label | routed metal topology、via count/current sharing、PDN、self-heating、actual activity、foundry signoff rule | EM limit → design activity/current → physical pin/rail topology → EM tool/readback → lifetime decision |
| device aging | 可能由供应者交付 aged Liberty views；本版语法未发现通用 aging coordinate | BTI/HCI degradation physics、stress duty、recovery、aged SPICE correlation | aged artifact identity → same-cell/corner alignment → delta → aged STA → workload/duty corroboration |
| SER/critical area | soft-error/critical-area models及confidence/axes | layout-level sensitive node、particle spectrum、system masking、FIT target | model → physical implementation → workload/architectural masking → reliability target |
| generic “reliability” | 没有一个属性能代表整体可靠性 | qualification、ESD/latch-up、thermal cycling、TDDB、package、silicon history | 分机制证据；禁止总分 |

因此可以做 `Liberty reliability coverage map`，不能做 `cell reliability score`。[LIB-E12]

### 3.10 历史 wire load

`wire_load`、`wire_load_selection`、`wire_load_table` 显式描述 fanout-length、R/C/area 与 selection；它们可用于：

- E：识别 legacy synthesis assumption；
- D：检查 fanout/length continuity、selection coverage、revision delta；
- M：估计 pre-layout 模型是否过时；
- U：实际 routed parasitic、congestion、coupling、RC corner。

价值不是继续把 wire-load 当现代物理真相，而是发现**历史假设仍在被消费**：若 synthesis 配置意外启用旧 wire-load，可能系统性偏置 sizing/mapping。必须用 synthesis readback 与 post-route SPEF 对照。[LIB-E01]

## 4. 跨 cell / corner / revision / view 的派生关系

### 4.1 身份与关系图

```text
LibraryArtifact --hash_of--> SourceBytes
LibraryArtifact --declares--> LibraryRelease / UnitSystem / OperatingCondition
LibraryRelease --contains--> Cell --contains--> Pin/PGPin/Bus/Bundle
Pin --owns--> TimingArc / Constraint / PowerModel / WaveformModel / EMModel
TableModel --instantiates--> Template --samples_at--> AxisPoint
Cell --variant_of--> CellFamily
Artifact --revision_of--> Artifact
Artifact --same_declared_corner_as--> Artifact
CellView --represents?--> CanonicalCellIdentity
DesignInstance --references--> LibraryCell
TimingObservation --operates_at--> (slew, load, state, mode, corner)
Finding --derived_from--> EvidenceSet --corroborated_by/contradicted_by--> Observation
```

`represents?` 必须允许 `confirmed / ambiguous / contradicted / absent`，不能由名字强制一对一。

### 4.2 可复现关系

| 关系 | 最小 key | D 级产物 | 升级到工程判断所需证据 |
| --- | --- | --- | --- |
| cell family | function/state signature + interface + explicit footprint/Vt/drive policy | family member、coverage、Pareto curve | physical compatibility、synthesis adoption |
| cross-corner | same release/cell/arc/table semantic key + normalized units | value vector、gradient、ordering violation、missing surface | characterization/SPICE、corner deck identity |
| cross-revision | baseline/revision hashes + semantic key | added/removed/changed fact与局部 blast radius | changelog/owner intent、design consumption |
| cross-view | canonical cell/pin/supply identity | Liberty↔Verilog/SPICE/LEF schema diff | LVR/LVS/extraction/tool readback；名字匹配不是 proof |
| design join | exact lib/cell/pin/arc + source release + STA condition | used instance/path/endpoint、actual slew/load coverage | implementation DB/report hash、complete frontier |

### 4.3 三个高价值派生指标示例

1. **Operating-envelope coverage**：实际 design `(slew, load)` 落在表 grid 的 interior/boundary/outside 比例；D 需要 STA 实际点，不能由 Library 单独产生。
2. **Conditional-arc exposure**：`design instances × reachable when/mode × annotated checks`；Liberty 提供条件，设计常量与 STA readback提供可达/消费证据。
3. **Revision blast radius**：改变的 semantic objects → 采用 instance → path/endpoint/frontier → power/rail；未采用不等于 Library PASS，只表示当前 Design State exposure 为零。

## 5. 单位、插值、采样与条件化陷阱

产品必须 fail closed 的情况：

1. unit missing/unknown、threshold/slew definition不同却仍数值比较；
2. template variable顺序、dimension、index cardinality或values shape不闭合；
3. 重采样落到共同 grid 外却静默外推；
4. nominal与sigma/moment混算，early/late或rise/fall混合；
5. state/mode/when/sdf condition被丢弃后聚合；
6. pin-level receiver cap被arc-level override而比较器未保留precedence；
7. current waveform reference time不同却直接积分/相减；
8. missing被填成0，unsupported被写成PASS；
9. 同名corner/cell来自不同release或copy却被合并；
10. 统计异常模型跨Vt、cell class、model family或不同采样密度训练，产生结构性假阳性。

每个 numeric result 至少输出：`raw_value, normalized_value, unit, axes, interpolation_policy, in_domain, condition, provenance, unknown_reasons`。默认只允许域内插值；外推作为独立 finding，不返回普通数值。

## 6. 错误结论反例库

| 错误结论 | 为什么错 | 最便宜反证 |
| --- | --- | --- |
| “这个 cell delay 最小，所以能提高 Fmax。” | 没有 design adoption、slew/load、path migration、route/RC、hold/power代价。 | 当前STA instance/path join + matched mapping trial。 |
| “两个 revision 最大差异在 cell X，所以先修 X。” | X 可能未被当前设计使用；小 delta也可能落在唯一 critical arc。 | complete finding set + design exposure ranking。 |
| “CCS 文件更大，所以比 NLDM 更准。” | 数据量不是 correlation；parser/model selection也可能不用该 view。 | golden SPICE residual + STA model readback。 |
| “function 相同，所以 cross-view 一致。” | SPICE/layout/pg/bias/pin order可能错；互相一致的坏 view 也可能通过 LVS。 | Liberty/Verilog/SPICE LVR + extracted connectivity。[LIB-E16] |
| “所有表都单调，Library 质量好。” | 真实非线性可非单调；语义/单位/条件错仍可能平滑。 | recipe/SPICE correlation + semantic closure。 |
| “LVF sigma 变小，yield 一定更好。” | path相关性、mean shift/skewness、n-sigma和design path未纳入。 | 实际POCV配置与path distribution。 |
| “EM limit通过，chip寿命达标。” | 无activity、physical rail/via、thermal与foundry rule。 | activity + routed EM/IR signoff。 |
| “未使用cell不影响当前设计，因此Library PASS。” | 当前exposure为零不等于release质量；DFT/UPF/ECO/别的设计仍可使用。 | 状态分离：`current_design_not_exposed` 与 `library_validated`。 |

## 7. 可实施 ontology 与数据 contract

### 7.1 核心实体

- `SourceArtifact`: sha256、path token、size、mtime、owner class、release、parser build；原件权威。
- `SemanticObject`: object id、group kind、parent、raw name、normalized key、source location。
- `UnitSystem`、`OperatingCondition`、`Template`、`Axis`、`SampleGrid`。
- `Cell`、`Pin`、`PgPin`、`Bus`、`Bundle`、`LogicBehavior`、`SequentialBehavior`。
- `TimingArc`、`Constraint`、`PowerModel`、`WaveformModel`、`VariationModel`、`ReliabilityModel`。
- `Relation`: relation kind、left/right id、derivation rule/version、status、ambiguity。
- `DesignObservation`: Design State hash、tool/report hash、instance/path/endpoint、actual slew/load/state/mode、adoption/readback。
- `Finding`: derivation level、source domain、evidence status、scope、metric、severity、confidence、unknown、corroboration、counterexample、next test。

### 7.2 数值记录最小 schema

```json
{
  "source_sha256": "sha256:...",
  "semantic_key": "cell/pin/arc/table",
  "derivation_level": "explicit|derived|inferred",
  "source_domain": "Liberty|design|STA|SPICE|physical|silicon",
  "evidence_status": "available|unknown|ambiguous|contradicted|corroborated",
  "model_family": "NLDM|CCS|CCSN|ECSM|LVF|EM|...",
  "quantity": "cell_rise",
  "raw_unit": "1ns",
  "normalized_unit": "s",
  "axes": [{"variable": "input_net_transition", "values": []}],
  "condition_ast": {},
  "interpolation": {"policy": "none", "in_domain": true},
  "value": null,
  "unknown_reasons": [],
  "extractor_version": "..."
}
```

Null 永远表示未知/缺失，不表示零。所有 derived/inferred record 必须反向链接 explicit inputs。

## 8. 首批可回答 queries

| 优先级 | Query | 输出 | 人类决策 |
| --- | --- | --- | --- |
| P0 | 这两个 artifact 是否可比较？ | identity/unit/PVT/model/template compatibility + unknown | 是否允许delta分析 |
| P0 | 哪些引用、单位、shape、condition 不闭合？ | exact source object + invariant failure | 阻塞提取/发布还是需owner解释 |
| P1 | baseline→revision 改了哪些 semantic objects？ | full add/remove/change set，不丢unranked findings | review scope与blast radius |
| P1 | 哪些corner/revision surface有结构性异常？ | normalized local gradient/ordering/gap，保留class baseline | characterization复查点 |
| P1 | 哪些function/state/arc/constraint coverage发生退化？ | semantic coverage matrix | release regression |
| P2 | 哪些delta被当前设计真实消费？ | instance/path/endpoint + actual slew/load/state/mode | triage优先级与下一测试 |
| P2 | actual operating points位于表内、边界还是域外？ | coverage map + no-extrapolation finding | signoff/model风险 |
| P2 | 哪些power/LVF/EM finding与当前activity/frontier相交？ | exposure + evidence level | 是否升级SPICE/STA/EM/implementation |
| P3 | Liberty与Verilog/SPICE/LEF/UPF是否表达同一cell？ | view-pair relation与contradiction | release gate；不能由Liberty-only完成 |
| P4 | 哪些free factor与Commercial Label稳定相关？ | conditioned calibration、uncertainty、transfer boundary | 因子是否晋级决策规则 |

## 9. 指标体系：多维，不合成总分

| 维度 | 指标与分母 | 解释 |
| --- | --- | --- |
| provenance | hash覆盖率、release/owner已确认比例、duplicate/run-copy比例 | 防错版与统计污染 |
| semantic closure | 可解析object中引用闭合率、单位明确率、shape合法率、条件AST成功率 | 数据是否能可靠计算 |
| coverage | cell/pin/arc/constraint/model/corner应有-实有矩阵；unknown单列 | 完整性而非“文件数” |
| surface health | 域内gradient/jump/monotonicity/ordering findings，按class与sample exposure分层 | 发现候选，不自动判错 |
| cross-relation consistency | cross-corner/revision/view可对齐率、ambiguous/contradicted/absent计数 | 语义稳定性 |
| design exposure | adopted instances、affected paths/endpoints、frontier覆盖、actual envelope coverage | 当前Design State重要性 |
| correlation | 对SPICE/PEX/silicon residual的分位数、tail、特殊工作点、覆盖率 | 模型真实性 |
| consumption | synthesis/STA/P&R实际加载hash、annotated arc/check/model比例 | “交付了”是否“用到了” |
| operational outcome | review time、无效调查数、escaped defect stage、fix-to-release cycle、matched QoR | 是否产生人类价值 |

所有比率显示 numerator/denominator/unknown；任何维度可作为 gate，但不加权成单一分数。高语义完整度无法抵消低correlation，低当前design exposure也无法让release defect变PASS。

## 10. 实施优先级与产品边界

### P0：先建立可相信的事实层

1. Empyrean fixture与代表性Library完成 read/query/write-copy/round-trip qualification；当前退出139，未过门。[LIB-E15]
2. Site-local worker每文件独立进程；稳定JSON contract，不暴露SWIG object。
3. lossless generic traversal + specialized projection；未知group/attribute保留，不静默丢弃。
4. source hash、parser build、schema、units、conditions、source location全链路。
5. golden只读；write只生成候选副本并做round-trip/invariant diff。

### P1：先做高价值确定派生，不做AI总评

- identity/de-dup/source classification；
- semantic key与条件AST；
- units/template/reference/shape closure；
- function/state/arc/constraint coverage；
- cross-corner/revision full delta + anomaly candidates；
- explicit/derived/unknown分级。

### P2：形成差异化价值

加入当前Design State的netlist、STA readback、endpoint frontier、actual slew/load、power activity与implementation evidence；输出完整finding set和design-conditioned排序。排名不改变Library finding本身的PASS/FAIL。

### P3：建立真实性与闭环

对top finding组织golden SPICE/PEX、cross-view LVR/LVS、STA/EM及matched implementation；把结果作为corroboration/Commercial Label回写同一Ledger，而不是训练成无条件“质量分”。

### P4：有标签后才学习

只有在同一机制、节点、model family和证据schema下积累足够label，才训练anomaly/risk模型；输出calibration、适用域和不确定度。模型不能覆盖hard invariant、权限、proof和rollback。

## 11. Empyrean API 对实现的直接约束

安装包声明与wrapper表面足以支持一个窄adapter：generic attributes/groups、Library/Cell/Pin/PG/Bus/Bundle、timing/power/receiver-cap、NLDM/CCS、function/sequential、operating condition/template、corner manager与evaluator。[LIB-E13][LIB-E14]

但产品设计必须服从三条现实：

1. 当前runtime未qualified，所以任何“API可解析/可写/可插值/可评估POCV”都只是declared capability；
2. specialized class不覆盖的语义（尤其ECSM/某些新版本group）必须经generic traversal保留；
3. `evaluator` 的cell-level PPA是代理/聚合，不是design PPA，更不是芯片竞争力。

## 12. 验收与停止信号

首个可证伪验收应同时包含：

- positive：单位/PVT/template/condition一致的两个revision，delta可从source hash重放；top delta正确连接到真实instance/path/operating point；
- falsifying：未采用cell上的巨大delta不能被写成当前设计阻塞；关键arc上的小delta若覆盖frontier实际工作点不能被全局平均淹没；
- safety：unknown unit、域外插值、ambiguous view identity、native crash均fail closed；golden不写；
- reader test：资深Library工程师可从finding回到source object、派生规则、设计证据与下一项反证。

停止扩大功能的信号：API qualification仍失败；semantic identity无法稳定复现；design join不能证明实际消费；工程师试用表明design-conditioned排序不改变review决策；或缓存无法从source hash重建。

## 证据边界

本文是实现价值地图，不是已证明的产品能力。没有运行Empyrean API或商业EDA，没有读取/复制proprietary Liberty body，也没有完成真实设计、SPICE或硅上correlation。当前最强判断是：Liberty足以建立一个严格、可追溯的Library intelligence事实与派生层；芯片竞争力必须在外部证据加入后逐级兑现，不能从文件内部直接宣告。
