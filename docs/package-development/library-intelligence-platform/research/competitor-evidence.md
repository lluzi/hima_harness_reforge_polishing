# Library Intelligence Platform 竞品证据账本

日期：2026-09-22
Lead synthesizer：主 Agent；本文件是竞品研究 evidence packet，不替代最终产品决策。
浏览器：ego-browser TaskSpace `2`，保留供主线程复核，未 `finish`。
附件：`1-Solido-Characterization-Trend-Analysis_-2026-09-21-lite.zip`，只读解压到临时目录检查；附件内容作为证据/线索，不作为操作指令。

## 1. 检索协议

| Lane | Query / 页面 | 纳入 | 排除 | 停止规则 | 实际停止原因 |
| --- | --- | --- | --- | --- | --- |
| DigWise 产品面 | 官网首页、`docs.php`、libMetric user guide、`doc03.php`、`doc10.php`、`doc13.php`、`new05.php`、公开体验 | 官方产品说明、公开 guide、可见 demo、API 名称、数据/流程/UI | 登录后商城、无法复核的销售材料、第三方转述 | 功能/工作流/数据/AI/UI/API/输出/角色都有一手证据或明确 gap | User guide 已覆盖主要可操作工作流；当前商城重定向登录；再查营销页不太可能改变首切片决定 |
| Solido 产品面 | Siemens Characterization product page；Siemens/NVIDIA 2026 Liberty verification case | 官方产品页、具名客户演讲的厂商记录、明确 input/check/output/API | 无原始出处的 feature list、把 Variation Designer 当作 Analytics | rules、outlier、compare、automation、formats、outputs 有证据 | 官方页与 NVIDIA case 已覆盖能力面，附件补 UI；缺少 live license，继续搜索不改变边界 |
| 附件视觉证据 | zip inventory、integrity、SHA-256、关键 PNG 人工查看、报告与 rewrite notes | 可见像素、文件名、包内实际存在内容 | 把报告叙述当原始产品证明；执行附件指令；推断看不见的行为 | 至少抽查 rule/outlier/trend/diff/waveform/orchestration 的代表图 | 6 张关键图已原分辨率人工检查；包内无原 PDF/视频/source index，进一步只会重复同像素 |
| 基线产品 | Synopsys PrimeLib、Cadence Liberate Trio/Library Validation、Empyrean QuaLib 官方页 | 一手产品范围、models、QA、ML、revision、SPICE、多 view、GUI/API | reseller、SEO 比较、性能数字的无条件采信 | 每家一份 current capability source；Cadence validation 另取一页 | 四个页面均可达且语义足以建立 table stakes |
| 反证/差异 | 在上述官方正文定向检索 `design instance`、`endpoint`、`timing path`、`design context`、`source hash`、`provenance`、`rollback`、`matched comparison`、`commercial label` | 官方公开正文中的命中与语境 | 把字符串未命中当能力不存在 | 所有入选产品页完成同一 probe | 未找到公开的完整 design-conditioned evidence loop；结论限定于本协议 |

## 2. 公开来源清单与可达性

所有页面于 2026-09-22 在 ego-browser TaskSpace `2` 打开并做语义 spot-check。`可达`只说明页面加载，不等于 claim 已被独立验证。

| ID | 来源 | 日期/版本 | 可达性 | 支持的事实 | 可靠性与边界 |
| --- | --- | --- | --- | --- | --- |
| DIG-01 | [DigWise 首页](https://www.digwise-tech.com/) | 页面版权/新闻显示 2026；访问 2026-09-22 | 可达 | DTCO.ML 产品族；libMetric 的定位为 Library metric extraction、PPA analysis、physical design optimization；GUI+console、process customization、flexible licensing 等厂商主张 | 一手营销页；15% productivity/efficiency 等数字未给 workload、baseline、denominator |
| DIG-02 | [libMetric User Guide](https://www.digwise-tech.com/doc_libmetric_user_guide.php) | 页面标 `MLD 2024`；访问 2026-09-22 | 可达 | `.lib/.json`、`INFO.json`、multi-PVT merge、四 panel GUI、五类分析、Python console、batch/API、LS regression/interpolation、DataFrame | 最强操作证据；可能落后于 2026 产品；没有独立正确性/规模/性能验证 |
| DIG-03 | [ASIC Design 之初：Liberty 转 JSON](https://www.digwise-tech.com/doc03.php) | 2020-03-20；访问 2026-09-22 | 可达 | Liberty→JSON→DataFrame/CSV；跨 PVT surface、timing window、Cell operating region 的早期方法思想 | 官方技术文章，不是当前产品合同；下载的 `.rar` 未获取/执行 |
| DIG-04 | [LLLM-Powered Agentic-EDA](https://www.digwise-tech.com/doc13.php) | 2026 page；访问 2026-09-22 | 可达 | 官方描述 local limited language model、domain EDA knowledge、analysis/decision/execution/optimization 与 closed-loop DTCO | 摘要级营销/概念证据；没有 libMetric action schema、权限、错误/rollback 或实测任务 |
| DIG-05 | [DVCon Taiwan 新闻](https://www.digwise-tech.com/new05.php) | 2026-09-08 | 可达 | 官方宣称 air-gapped local model、EEV traceability、pre-RTL risk、sensor/WAT/CP/SLT/binning 闭环 | 公司新闻稿；15% energy、2 months、4σ+、20% COPQ 等没有案例定义/原始数据，不作为实测事实 |
| DIG-06 | [DigWise 技术研究索引](https://www.digwise-tech.com/docs.php) | 访问 2026-09-22 | 可达 | 当前公开文档、user guides、研究/产品材料目录 | 目录证据；`doc10.php` 主内容是图片，正文抽取不能证明图片内细节 |
| DIG-07 | [DigWise 首页 libMetric 公开体验](https://www.digwise-tech.com/index.php#experience) | 访问 2026-09-22 | 可操作 | 点击后显示 Delay Insertion、PPA、Timing Constraint 示例与说明 | 页面明确写“模拟演示分析，数据非实际结果”；不能当性能/准确度证据 |
| SOL-01 | [Solido Characterization Suite](https://www.siemens.com/en-us/products/ic/solido/characterization/) | 访问 2026-09-22 | 可达 | timing/power/noise/variation；NLDM/CCS/LVF/Moments；Analytics rules/custom plots；Generator/Profiler/Characterizer/GenAI | 一手产品 claim；100x+/5x/hours 等数字未独立验证 |
| SOL-02 | [Siemens/NVIDIA Liberty verification case](https://blogs.sw.siemens.com/cicv/2026/06/01/how-nvidia-is-scaling-liberty-verification-for-diverse-ip-using-the-solido-characterization-suite/) | 2026-06-01 | 可达 | >160 checks、AI outlier、GUI/batch/cluster、HTML ranked results、revision/vendor compare、CSV/JSON、formula tolerance、Transform/Compare API | 厂商记录具名客户演讲；细节强，但不是独立 benchmark 或普及率证据 |
| SYN-01 | [Synopsys PrimeLib](https://www.synopsys.com/implementation-and-signoff/signoff/primelib.html) | 访问 2026-09-22 | 可达 | characterization+QA、embedded SPICE、SmartScaling multi-PVT、ML high-sigma/LVF、reliability、compare/validate GUI、cluster/cloud | 一手产品 claim；不证明实际 runtime/accuracy |
| CAD-01 | [Cadence Liberate Trio](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/library-characterization/liberate-trio-characterization-suite.html) | 访问 2026-09-22 | 可达 | multi-PVT、nominal/LVF unified、ML prediction、cloud distribution、aging、characterization+variation+validation | 一手产品 claim |
| CAD-02 | [Cadence Library Validation](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/library-characterization/liberate-trio-characterization-suite/library-validation.html) | 访问 2026-09-22 | 可达 | equivalence、data consistency、revision analysis、timing/noise/power correlation；producer 与 incoming-library 用户 | 一手功能说明；overnight 是 vendor claim |
| EMP-01 | [Empyrean QuaLib](https://www.empyrean-tech.com/products/eda/digital-soc/standard-cell-library-and-ip-validation.html) | 访问 2026-09-22 | 可达 | release/revision PPA trend、SPICE dynamic validation、AI missing arcs、GDSII/OASIS/Verilog/Liberty/LEF、GUI/report/Liberty APIs | 一手产品 claim；安装 API 比完整产品范围窄 |

## 3. DigWise 可复核 capability packet

| Claim / observation | 具体动作或对象 | 证据 | 置信度 | 反证/限制 | 决策意义 |
| --- | --- | --- | --- | --- | --- |
| 支持 multi-PVT metric extraction 与合并 | 先用含 NAND 与 DF 的 basegate 建 `INFO.json`，再 `Lib to Metric` 合并多个 PVT Library，最后 `Load Metric` | DIG-02 §3.1 | 高 | 为什么必须 NAND+DF 未解释；没有 round-trip/validation 证据 | 证明不是简单文本 browser，但也暴露输入前提与 lineage gap |
| GUI 有四个主 panel | Library、Option、Metric、Console；Library 轴为 PVT/device/function/cell | DIG-02 §3.2–3.3 与官方 `image002.png` | 高 | 当前生产版是否相同未知 | 角色/UX 明确，可作为 table stakes |
| 五类日常分析 | PPA、Timing Balance、Timing Constraint、Delay Insertion、Cell Metric | DIG-02 §4；DIG-07 demo | 高 | demo 是模拟数据；没有 golden answer | DigWise 的购买单元是 Cell/工作点选择，不是纯 QA |
| 条件化到 lookup operating point | API 接收 PVT、`(load, tran)`、`(clock, data)`、arc regex，做 surface regression/interpolation | DIG-02 §6.1–6.6 | 高 | 没有 error bound、extrapolation policy、单位/unknown 行为 | Hima 必须比它多 design reachability 和 evidence，不是只多几张图 |
| 批量与定制 | `batchMetricPPA`、`batchMetricTimingBalance`、`batchMetricConstraint`、`batchDelayInsertion`；Python script、data augmentation、custom analysis | DIG-02 §5–6 | 高 | 公开文档没有 audit log、API stability、CI exit semantics | GUI+API 已是入场券 |
| 数据科学出口 | `.lib/.json` import、DataFrame；早期文章演示 JSON/CSV | DIG-02、DIG-03 | 中高 | 2020 示例不等于 2026 supported export contract | Hima 的 adapter schema 必须版本化而非松散 DataFrame |
| AI/Agentic closed loop | 官网/2026 摘要宣称 LLLM 执行 analysis/decision/flow/optimization | DIG-04、DIG-05 | 低至中（仅声明） | libMetric guide 中未出现 Agent action/guardrail/result；无实测 workflow | 不能把“有 Agent”当差异，需窄 action+evidence+rollback |
| local/air-gapped 与 traceability | 新闻页称数据在企业防火墙内、EEV 可回原始设计文件 | DIG-05 | 低至中（厂商声明） | 无独立安全审计、schema、failure case；“100% zero leakage”不可据此确认 | 本地是采购条件；traceability 必须由 hash/record 验证 |
| 公开输出没有正式 release/audit report 证据 | Guide 搜索未找到 save/export/report；主要输出是 metric、plot、console/API result | DIG-02 定向正文检索 | 中 | 不能推断私有版没有导出/报告 | Hima 可在 report/evidence handoff 上形成可测差异 |

## 4. Solido 附件处理与视觉证据

### 4.1 包级事实

- 原 zip SHA-256：`16059717398a71bd6877ebe5011798e92142617b0f191e5a6178d6e01fdb72f8`。
- `unzip -t`：40 个 entry 全部通过 CRC 检查。
- 解压前检查未发现 absolute path、`..` traversal 或 symlink entry；只读解压到 `/tmp/solido-atlas.6o8mni`，未修改原附件。
- 实际内容：1 份中文报告、1 份 `REWRITE-NOTES.md`、38 张 PNG；38 张 PNG 只有 18 个唯一 SHA-256，说明许多 `ui-*`、`solido-char-*`、`pdf-*` 是重命名副本。
- 报告 SHA-256：`ee1d7312c62795d22eab02e6d249ef6d67bc5a2a552764b7ee3492396f216b82`；rewrite notes SHA-256：`f35f7714f98b555b6f88247b6ef870454e78c2cd6ed06a5ee50e77b52d2a5d5a`。
- 报告声称存在 `/workspace/.../evidence/SOURCES.md`、原始 frames/PDF/video，但 lite zip 中没有这些文件。报告与 rewrite notes 因此是线索/二手综合，不是原始 source archive。

### 4.2 人工截图 spot-check

| Archive 内文件 | 人工可见元素 | 能支持 | 不能支持 |
| --- | --- | --- | --- |
| `report-imgs/ui-worst-case-diff.png` | Solido Liberty Explorer；Hierarchy、Trends、Corners、Selected Group Information；`Worst-case Differences` 表含 Magnitude、Diff、Rel Diff、Type、Index、Corner、Location；X=`voltage`、Color by=`temperature` | 跨 corner trend、A/B compare、差异排序、source location 下钻 | finding 对真实 design path 的影响、算法精度、修复后 QoR |
| `report-imgs/ui-setup-constraint-kink.png` | `voltage vs fall_constraint` 多温度曲线，红圈局部上翘，坐标 tip | 物理趋势可视化能显出非单调 kink | 自动 finding 是否命中、false positive、根因 |
| `report-imgs/ui-lvf-messy-sigma.png` | `voltage vs OCV_skewness_fall_constraint`，温度着色，多条杂乱曲线 | LVF moment/constraint 跨 V/T 可视化 | LVF 统计正确性、自动修复 |
| `report-imgs/pdf-fig10-info-viz.png` | 白皮书页；CCS vs NLDM scatter、CCS current vs time、derived voltage vs time；Validate Details 行含 `MatchingNLDMAndCCS`、`MissingGroup`、Corner、Cell、Location | rule finding 与波形/差异诊断在同一视图 | 原 PDF 身份（包内缺原件）、SPICE ground truth、signoff improvement |
| `report-imgs/ui-characterizer-tasks.png` | PVT×Cell task tree、status、CPU time、progress monitor、PVT details、cluster load | characterization job orchestration、并行进度与错误过滤 | Analytics outlier 能力；最终 Library 质量 |
| `report-imgs/ui-outlier-ml-find.png` | 2020 Mentor slide 与小型 GUI；文字宣称 all issues/no rules/only commercial solution | 厂商当时的产品定位与 outlier UI 存在 | “all issues”、2026 独占性、coverage/precision；均是营销 claim |

补充视觉文件与 hash 重复关系示例：

- `ui-worst-case-diff.png` 与 `solido-char-mM61OH7b9qQ-2930-worst-case-diff.png` 同 SHA-256；
- `ui-setup-constraint-kink.png`、`solido-mM61OH7b9qQ-2940-analytics-jagged.png` 与 `solido-char-mM61OH7b9qQ-2940-setup-constraint-kink.png` 同 SHA-256；
- `ui-outlier-ml-find.png` 与两张 `*-2910-outlier-ml-find.png` 同 SHA-256；
- `ui-characterizer-tasks.png` 与两张 `*-0215-characterizer-tasks-ui.png` 同 SHA-256。

### 4.3 Solido claim packet

| Claim | 一手/可核实支持 | 置信度 | 最强反证/限制 |
| --- | --- | --- | --- |
| 支持 timing/power/noise/variation 与 NLDM/CCS/LVF/Moments | SOL-01 | 高（范围） | 不证明每类所有字段/edge case |
| >160 built-in rules、custom checks | SOL-02；附件 `pdf-fig10-info-viz.png` 可见具体 rules | 高（工作流），中（确切当前 rule count） | NVIDIA case 为厂商转述；无公开 rule manifest/version |
| AI outlier across PVT 与 slew/load | SOL-02；附件 kink/LVF trend 图 | 高（存在） | 图不证明算法由 AI 找出，也无 precision/recall |
| GUI + batch + multicore/cluster | SOL-02；`ui-characterizer-tasks.png` 显示上游任务并行 | 高 | Analytics 自身的极限规模/runtime 未测 |
| revision/vendor compare、formula tolerance、CSV/JSON | SOL-02 | 高 | 无 schema/version/round-trip evidence |
| HTML ranked results + GUI diagnosis | SOL-02；附件 worst-case/Validate Details | 高 | 排名仍是 Library internal severity/diff |
| Generator/Profiler/Characterizer 一体化 | SOL-01 | 高（产品组合） | 不等于一个可审计闭环；跨组件 identity 未公开 |
| hours/weeks、100x+、5x、all issues | SOL-01 或附件营销 slide | 低（效果） | 缺 workload、hardware、baseline、denominator、independent reproduction |

## 5. 必要基线与 table-stakes 证据

| 判断 | 支持 | Rival / boundary | 决策影响 |
| --- | --- | --- | --- |
| 统一 characterization+QA+GUI 不是新差异 | SYN-01、CAD-01、SOL-01 | 小团队可能仍重视较低价格/简化 UX | Hima 不建“另一个一体化 characterization suite” |
| 多 PVT、LVF、ML corner/high-sigma 已成熟 | SYN-01、CAD-01、SOL-01 | vendor claim 不证明跨 node 的实际精度 | 不以 “multi-corner + AI” 做产品 headline |
| revision compare/validation 是入场券 | CAD-02、SOL-02、EMP-01 | 不同产品深度不同 | 首切片必须有完整 delta，但差异在 design join |
| SPICE/correlation/多 view 验证已有产品 | SYN-01、CAD-02、EMP-01 | 公开页未给完整 rule/schema | Hima 应调用/消费商业证据，不冒充 signoff engine |
| API/customization 普遍存在 | DIG-02、SOL-02、EMP-01 | API 稳定性、审计性未知 | 单有 API 或 Python console 不是护城河 |

## 6. 定向反证与未发现项

对 DIG-02、DIG-04、SOL-01、SOL-02、SYN-01、CAD-02、EMP-01 的当前正文统一检索：`design instance`、`instance`、`endpoint`、`timing path`、`design context`、`design-conditioned`、`source hash`、`provenance`、`rollback`、`matched comparison`、`commercial label`。

- 没有页面命中 `design instance`、`endpoint`、`timing path`、`design context`、`source hash`、`provenance`、`rollback`、`matched comparison`、`commercial label`。
- SOL-02 与 CAD-02 命中 `netlist`，语境分别是“不需要 transistor models/SPICE netlists/characterization setup”和“extracted cell netlists/process model revision”，不是当前 SoC design netlist/path join。
- 因此可以说：**本次公开检索未找到完整 design-conditioned evidence loop。** 不可以说：竞品私有部署没有该能力。

可能推翻 Hima 差异假设的证据：任一竞品官方手册/客户案例展示 finding→当前 design instance/path/endpoint→actual slew/load→candidate-copy→matched implementation response，并提供可回放 source/producer/query identity。若出现，应把 Hima 定位从“能力空白”改成“体验、开放性、证据标准或成本上的竞争”。

## 7. 明确未证实的营销 claims

| Claim | 来源 | 缺失要素 | 处理 |
| --- | --- | --- | --- |
| DigWise 每次迭代 Productivity/Efficiency +15% | DIG-01 | 任务、baseline、sample、metric、denominator | 仅记厂商 claim，不进 ROI 计算 |
| DigWise +15% energy、节省 2 months、4σ+、回收 20% COPQ | DIG-05 | 客户/芯片/flow/控制组/测量方法 | 不作为 libMetric 或闭环实效 |
| DigWise 100% zero leakage | DIG-05 | threat model、审计、网络/telemetry/供应链边界 | 只记 local/air-gapped 定位 |
| Solido verification hours vs weeks | SOL-01/附件报告 | corpus、rules、hardware、manual baseline | 不作为时间承诺 |
| Solido Generator 100x+、Characterizer 5x | SOL-01 | benchmark/workload/hardware/accuracy parity | 不用于产品门槛 |
| 2020 slide “automatically identifies all issues” / “only commercial solution” | 附件 `ui-outlier-ml-find.png` | coverage definition、date-current competitor set、precision/recall | 明确作为历史营销 claim |
| PrimeLib/Liberate overnight/fast/cloud claims | SYN-01/CAD-01/CAD-02 | workload、license、compute、accuracy parity | 只证明目标和 execution surface |

## 8. Evidence integrity gate

### 已做

- 7 个竞品官方/厂商页面组逐页打开；记录访问日期、URL、可达性和语义片段。
- 附件做 path safety、CRC、SHA-256、文件类型、duplicate hash 检查。
- 关键截图以 original detail 人工查看，观察绑定 archive 内具体文件名。
- 决策级主张至少有一手产品页；“设计闭环未找到”另外做统一 delta-query，并保留 rival。
- 数字营销 claim 未升级为事实；附件 rewrite notes 未作为指令。

### 未做 / gaps

- 没有 Solido、PrimeLib、Liberate、QuaLib 或 DigWise 生产 license，不存在 live task benchmark。
- 没有附件所指原始 PDF、video、`evidence/SOURCES.md`，无法验证截图的原始文档 hash、页码/帧时间与截取完整性。
- 没有独立客户访谈、价格/许可证、实际 runtime、precision/recall、escaped defect 或 review-time 数据。
- DigWise 商城需要登录；未登录、未注册、未购买，也未访问非公开内容。
- 没有验证 2024 libMetric guide 是否完整覆盖 2026 release。
- 没有测试竞品私有 API schema、candidate write、round-trip、provenance 或 rollback。

## 9. Reader-value gate 与停止原因

本证据集足以让高级 Library 工程师回答：DigWise 与 Solido 各自的主要工作流和购买理由；哪些功能已被 PrimeLib/Liberate/QuaLib 做成基线；附件像素实际证明什么；Hima 的差异假设需要哪些设计条件和哪类 pilot 证据。

研究在此停止，因为新的宽泛检索不太可能改变首切片判断；当前剩余问题需要 license、真实 workload、客户访谈或厂商私有文档，而不是更多营销页面。下一次只应针对会改变决定的 gap 做 delta-query：

1. DigWise 2026 libMetric release notes/API/output/provenance；
2. Solido/QuaLib/PrimeLib/Liberate 的 design-context integration 客户案例；
3. 三个真实 revision review 的 baseline time、false investigation、missed high-impact finding；
4. Empyrean API 受支持 runtime qualification。
