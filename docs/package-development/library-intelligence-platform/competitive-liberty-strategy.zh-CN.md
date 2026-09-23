# Library Intelligence Platform：竞品能力、Liberty 数据价值与超越路线

日期：2026-09-22

状态：研究报告，非已实现能力或市场领先声明

## 结论

要远远超过 DigWise、Solido、PrimeLib、Liberate 和 QuaLib，Hima 不能把产品定义成一个更漂亮的
Liberty viewer、更大的 checker 集合，或一个会解释曲线的聊天机器人。成熟竞品已经能做大规模
规则检查、跨 PVT 趋势、ML outlier、NLDM/CCS/LVF 分析、跨 revision/vendor 比较、可编程 tolerance、
Custom Plot、批处理与交互 debug；Solido 已经把生成、表征、验证和比较串在同一产品族中，并通过
agentic demo/厂商叙述展示了 repair 闭环方向，但本轮没有 live repair workflow 证据。

Hima 应当占据更高一层：**Library engineering 的证据型决策与闭环优化平台**。它必须把四种对象绑定在
同一条可复现证据链上，并严格区分确定 lineage、模型推断、实验观察与真正的因果 claim：

1. Liberty 原件中明确声明的 Cell、arc、condition、table、waveform、power 和 variation facts；
2. 跨 Cell、corner、revision、model/view 推导出的关系和异常；
3. 当前芯片设计中真正采用这些对象的 instance、endpoint、slew/load、path、placement 和商业响应；
4. 工程师或 Agent 采取的验证、修复、回滚和 release 决定。

核心产品问题不是“这个点异常吗”，而是：

> 它为什么异常；在哪些条件下异常；当前哪些芯片会暴露；若不处理会损失什么；最便宜的反证是什么；
> 哪种修改能改善目标且不制造更大风险；这个判断能否被另一个工程师从原始字节完整复算。

## 1. 两条独立研究线给出的共同判断

### 1.1 竞品不是一个层级

| 产品 | 公开证据支持的核心强项 | 客户为什么会买 | 本轮没有被公开证据证明的部分 |
| --- | --- | --- | --- |
| DigWise `libMetric` | 多 PVT metric extraction/merge；按 PVT/device/function/cell 查询；PPA、timing balance、constraint、delay insertion、Cell metric；2D/3D/surface；Python console/API；LS regression/interpolation | 以较低门槛得到 Cell/PVT 选择工作台，并允许方法工程师扩展 Python/DataFrame；厂商另以弹性/按需授权、process customization、全地端/air-gapped 和 design→test→binning 产品组合形成采购叙事 | 完整 QA rule catalog、NLDM/CCS/LVF correlation、source/provenance schema、当前 design path/instance join、修复后商业结果；部署/闭环收益仍是厂商 claim |
| Solido Analytics | hundreds of standard/custom checks；AI outlier；跨 PVT 与 slew/load trend；LVF moments；revision/vendor Compare；equation tolerance；GUI/batch/cluster；HTML/CSV/JSON；waveform 下钻 | 用成熟产品替代低覆盖、高维护内部脚本，并与 Characterizer/Generator/Profiler 联动；incoming vendor IP/revision 验收后可按 PVT failure summary、equation tolerance 和 CSV/JSON 交接前端团队 | finding 与当前 SoC instance/path/endpoint/actual operating point、candidate-copy 和 matched implementation response 的完整公开链 |
| PrimeLib / Liberate Trio | characterization、multi-PVT/LVF/variation、ML、SPICE correlation、QA/validation、cloud/cluster、aging | 与 PrimeTime/Tempus 等 signoff 生态形成统一表征/验证流程 | 本轮不比较其私有部署深度、价格、真实 runtime/accuracy |
| QuaLib | PPA release/revision trend、SPICE dynamic validation、AI missing-arc、多 view、GUI/report/Liberty API | 直接做 standard-cell/IP 多视图检查和定制分析 | 已安装 API 只是完整 QuaLib 产品的窄接口，而且当前 runtime 未合格 |

DigWise 公开 user guide 的可操作内容比官网宣传更有价值：它明确给出四区 GUI、五类分析和六个
主要 API，并把 `(load, transition)`、`(clock, data)`、PVT 与 arc regex 作为条件。它证明“条件化
Cell metric 工作台”本身已经是竞品能力。Solido 则把质量覆盖和 debug UX 推得更深：用户附件中的
`ui-worst-case-diff.png` 可以直接看到 Hierarchy、Corners、Selected Group Information、趋势图和带
Magnitude/Diff/Rel Diff/Type/Index/Corner/Location 的 Worst-case Differences 表。

附件本身经独立检查：ZIP SHA-256 为
`16059717398a71bd6877ebe5011798e92142617b0f191e5a6178d6e01fdb72f8`，40 个 entry 全部通过 CRC，
无 absolute/`..` 路径；38 张 PNG 只有 18 个唯一 hash。lite 包没有正文声称的原 PDF、video 和
`evidence/SOURCES.md`，所以图像可证明可见 UI，不足以证明算法召回、性能、独占性或修复后的芯片收益。

完整功能图谱和逐条证据见[竞品能力图谱](research/competitor-capability-atlas.md)与
[竞品证据账本](research/competitor-evidence.md)。

### 1.2 Liberty 专家线：先标明“能知道到什么程度”

研究线最初使用 `E/D/M/U` shorthand。为避免把设计侧真实观察误归入模型推断，产品 contract 应拆成
两个正交维度，再单列相对当前证据集的状态：

| 维度/等级 | 含义 | 可以说什么 | 不能说什么 |
| --- | --- | --- | --- |
| `derivation_level=explicit` | 某 source domain 的有 hash 原件直接表达 | “这个 Liberty 声明……”“该 STA report 观察到……” | 从声明直接升级为模型正确或芯片因果 |
| `derivation_level=derived` | identity、单位、条件和算法冻结后可复算 | “在共同 grid 内，B 相对 A 改变 8%”“该 instance 确定引用此 master” | 域外外推、missing=0、语义不等价对象比较 |
| `derivation_level=inferred` | 异常模型、代理或历史 label 给出的概率/排序 | “较可能影响这些 endpoint；置信度中” | PASS/FAIL、root cause、固定 PPA 收益 |
| `source_domain` | `Liberty / design / STA / SPICE / physical / silicon` | 区分“文件声明”“工具消费”“独立测量” | 把不同 domain 的 explicit facts 混成同一事实 |
| `evidence_status` | `available / unknown / contradicted / ambiguous / corroborated`；“Liberty-alone unknown”是当前 query 的状态 | “Liberty alone unknown；需 STA readback + SPICE” | 外部证据加入后仍永久标 U，或用模型猜测补空 |

Liberty 的信息密度足以建立严格、版本化的事实与派生层：units/PVT/template、Cell/pin/pg_pin/bus/bundle、
function/three-state/FF/latch/statetable、条件化 timing/constraint、NLDM、CCS/CCSN、ECSM、receiver cap、
driver/current/noise waveform、internal/switching/leakage power、LVF moments/sigma、EM 与部分 reliability
construct。ECSM 和新语法只有在版本语义与 parser coverage 注册后才能进入 specialized projection；当前
Empyrean wrapper 未证明 ECSM 专用覆盖。真正的价值来自正确的 identity、condition、unit、sample
domain 和 model-family 语义，不是字段数量。

它也有明确边界：Liberty 单独不能证明跨 View 是同一个物理 Cell、模型与 SPICE/硅相关、综合/布局
会采用该 Cell、全芯片 PPA/IR/EM/DRC/LVS 会改善。完整语义、反例、ontology、首批 queries 和多维
指标见[Liberty 语义价值地图](research/liberty-semantic-value-map.md)与
[Liberty 证据账本](research/liberty-evidence.md)。

## 2. “远远超过”必须如何测量

领先不能用 feature 数量或宣传数字定义。建议在同一批真实 Library release/revision 和设计任务上比较：

| 维度 | 测量对象 | 领先信号 |
| --- | --- | --- |
| 发现能力 | seeded 与历史真实缺陷 | 高严重度缺陷召回；soft failure 与 cross-view failure 均可见 |
| 调查效率 | 从首次 finding 到最小可复现根因 | review 时间、打开的无效 finding、人工脚本数量下降 |
| 设计相关性 | top-K finding 对当前芯片的实际影响 | top-K 命中真实 instance/path/endpoint 和实际 slew/load；未采用不冒充无错 |
| 结论真实性 | 每个判断的 provenance | source hash、API/规则版本、条件、公式、query、外部 corroboration 和 unknown 完整 |
| 行动质量 | 建议验证/修复的结果 | 首次验证命中率、无效重跑、回滚次数、escaped defect 改善 |
| 芯片结果 | matched flow 的实际响应 | adoption、WNS/TNS、PPA、DRC；可靠性只写成声明模型+activity+physical/thermal 条件下的预测 margin/lifetime，除非另有 qualification/silicon observation；无提升如实保留 |
| 覆盖 | Library 对象被实际消费的程度 | Cell/function/arc/condition/corner/view/use-case coverage，而非文件能读 |
| 安全 | golden data 与运行边界 | 零原件覆盖、零无证据自动 PASS、零跨 Site 数据外发 |

只有在这些内部任务指标上持续优于竞品或原有流程，才可以说“远远超过”。

## 3. 产品北极星：从数据浏览器到 Library Decision Graph

平台需要一个可查询的 **Library Decision Graph**，但它不是第二事实源：

- 节点包括 source file、Library/corner/view、Cell、pin、timing/power/constraint group、table point、
  waveform、rule/finding、design master/instance、endpoint/path、experiment、repair candidate 和 release；
- 边包括 declares、same-identity、derived-from、differs-from、covers、used-by、validated-by、
  contradicted-by、repaired-by；影响边必须分成 `deterministic-lineage`、`hypothesized-impact`、
  `experimentally-observed-response`，只有满足 matched intervention/反事实条件时才允许 `causal-claim`；
- 每个节点和边绑定 source hash、producer identity、condition、scope 和 confidence；
- SQLite/graph/index 只是可删除的投影，Liberty 原件、设计报告和 EDA 数据库继续是权威。

这使五类以往分散的问题进入同一查询：

1. **What is it?** 某 Cell/arc/table 在各 corner/revision 中是什么；
2. **Is it plausible?** 数值、趋势、物理关系与模型间是否自洽；
3. **Where does it matter?** 当前哪些设计对象和 operating points 会用到它；
4. **What should we do?** 哪个反证、修复或实验具有最高信息价值；
5. **Did it work?** 修复是否被工具实际采用，并改善了什么、恶化了什么。

## 4. 三类用户分析背后的内部能力

下面七层是三类分析共同使用的内部能力和演进顺序，不是七个产品入口。用户只看到“库健康与发布风险”、
“库性能与竞争力”和“设计影响与行动”；source truth、semantic cube、Finding、验证、修复和学习根据问题
自动组合，并在需要审计时才展开。

### L1：可审计的 source truth

Liberty read/write、单位、condition、template、group、table 和 waveform 全部保留原始身份；输入不完整、
parser crash、unsupported construct 和 unknown 分别表达。每个派生事实可回到文件 hash、对象路径和 producer。

### L2：完整的 semantic cube

查询不再局限于一个 Cell 或一张表，而能沿 function、drive、VT、PVT、model type、revision、arc、when、
slew、load、state 和 statistical moment 切片。支持严格 identity alignment，拒绝用同名替代同一物理对象。

### L3：多机制异常解释

同时存在并明确区分：

- 规范/结构规则；
- 跨对象一致性和 completeness；
- 数值单调性、光滑性和物理 plausibility；对 CCS/PG current/internal power 的能量或电荷关系必须绑定
  quantity、参考方向、stimulus、rail scope 与 characterization convention，不使用通用“守恒”规则；
- ML/statistical outlier；
- nominal model（NLDM/CCS/ECSM）分别对 golden SPICE 的 correlation；nominal 与 LVF attachment 的
  identity/coverage consistency；AOCV depth/distance derate 与 POCV/LVF arc-specific sigma/moments 分开
  建模，并通过实际 STA OCV 配置/readback 验证消费；
- cross-view 与 source/golden identity；
- 历史 revision regression。

历史 `wire_load` 也作为 release/configuration finding：它不是现代 routed interconnect 真相，但平台应检测
综合是否意外消费旧 wire-load assumption，并用 synthesis readback 与 post-route SPEF 对照。

Finding 不是一个红点，而是一份含机制、邻域、反例、置信度和最便宜下一验证的 evidence dossier。

### L4：设计条件化风险

把 finding 连接到真实 master/instance、timing arc、path group、完整 endpoint frontier、实际 slew/load、
toggle/state、placement、RC 和 clock condition。必须同时显示 `librarySeverity` 与 `designRelevance`：当前
未采用只能降低当前芯片优先级，不能把 Library 错误改写为 PASS。

### L5：主动验证与 counterfactual

系统按显式成本、预期结果和不确定度估计选择性价比最高的下一动作：先用同一 Liberty 的域内
interpolation/replay 检查 adapter、单位和数值实现，再用独立 SPICE 点、STA readback、重做一个 arc、
强制 synthesis coverage、isolated ECO 或 matched P&R 验证模型/设计假设。前者不是独立模型验证。

### L6：安全修复与 release intelligence

所有写操作只产生 candidate copy；支持 semantic diff、round-trip invariant、影响闭包、回滚和修复后
全量 regression。Release gate 不使用一个总分，而交付：coverage、未闭合 high-risk finding、design
exposure、correlation、unknown、waiver、repair history 和签收责任。

### L7：跨 Campaign 的条件化学习

积累 `Library factor + Design State + Action -> Commercial Label`，学习哪些免费指标在什么条件下能预测
风险或收益。模型只能在已验证条件内晋级；不能把一个设计或一个 node 的经验宣传成通用 PPA 预测。

## 5. 竞争优势不来自单一 AI 模型

AI 负责提出假设、写查询/分析代码、选择验证和解释结果；确定性代码负责 identity、单位、权限、hash、
插值、状态、预算、回滚和 evidence admission。这样的分工同时避开两个陷阱：

- 把固定规则包装成 AI；
- 让模型根据一张曲线自由生成“芯片会更快”的不可复核结论。

最重要的智能资产不是 prompt，而是积累下来的条件化关系、反例、失败实验、真实 design exposure 和
commercial response。

## 6. 分阶段超越路线

| 阶段 | 用户结果 | 必须证明 | 不做什么 |
| --- | --- | --- | --- |
| R0：事实底座 | 可信读取、查询、写副本、身份和 corpus inventory | vendor fixture + representative Library round-trip；原件 hash 不变 | 不做大批量，不宣称洞察 |
| R1：Interop + 必要基础 | 能消费 Solido/QuaLib/PrimeLib/Liberate finding/report，并实现首切片必需的 bounded rules、semantic delta、trend/outlier 和 custom query；不重建竞品全部数百规则 | 输入 accounting、必要 defect corpus recall、false-investigation、batch/interactive evidence | 不把全量 Solido parity 设为 Design Impact 的前置工程 |
| R2：Design Impact | Finding 与真实 design instance/path/endpoint/operating point 相连 | top-K design relevance 和 review time 改善 | 不把未采用变成 PASS |
| R3：Active Validation | 自动选择最便宜的 SPICE/STA/coverage 反证 | hypothesis hit rate、重复作业与人工介入下降 | 不盲跑完整 EDA flow |
| R4：Safe Repair | 候选修复、影响闭包、round-trip、rollback、matched validation | 零 golden overwrite；修复后 regression 和商业响应 | 不自动发布 Library |
| R5：Portfolio Intelligence | 条件化学习跨 design/revision 的真实响应 | transfer boundary、校准、unknown 和失败样本完整 | 不承诺通用 MHz/PPA 预测 |

## 7. 产品体验应当长什么样

工程师不面对图表和模块目录，而是从三个问题开始：

1. **这套库可靠吗？** 进入库健康与发布风险分析；
2. **这套库强在哪里、弱在哪里？** 进入库性能与竞争力分析；
3. **它对我的芯片意味着什么？** 进入设计影响与行动分析。

右侧 Workbench 根据问题自动组合 summary、trend/surface/waveform、Finding 与下一动作。用户点击任意
Cell、arc、corner、finding、instance 或 endpoint 都能在同一分析中继续追问；需要解释时展开来源、规则、
反例和 unknown，需要执行时形成 typed action proposal。自定义规则表现为“添加公司检查”，可复用洞察
表现为“保存这个分析”，而不是要求用户先理解 Rule Studio 或 Insight Builder。

对话、工作台、报告和 Ledger 读取同一事实，不存在“AI 说已修复但 release evidence 不知道”的第二叙事。

## 8. 关键边界

Liberty 很丰富，但它不能单独证明：layout/LEF/GDS/CDL/SPICE/Verilog/UPF 彼此描述同一个 Cell、模型与
硅完全相关、某 Cell 会被综合/布局采用、全芯片 PPA 会改善、IR/EM/DRC/LVS/signoff 会通过。真正的竞争力
来自把 Liberty intelligence 放进多 View、真实 consumption 和 matched experiment 的证据链，而不是把
缺失上下文用模型补齐。

## 9. 当前执行门

产品路线不改变当前事实：Empyrean Liberty API 的 vendor fixture 在隔离 Python 3.7.12 + AlmaLinux 8
`edarun` 中仍于 `lib.name()` 退出 139；用户要求本轮不 debug。研究和规格可以继续，R0 产品实现必须
等待厂商可用包/精确环境，或新的有界诊断授权。

## 10. 研究与模型执行记录

- [研究合同](research-contract.md)
- [竞品与 Liberty 证据账本](evidence-ledger.md)
- [环境资格记录](environment-qualification.md)
- [现有产品判断](decision-report.zh-CN.md)
- [首个实现切片](first-slice-spec.md)
- [竞品能力图谱](research/competitor-capability-atlas.md)
- [竞品证据账本](research/competitor-evidence.md)
- [Liberty 语义价值地图](research/liberty-semantic-value-map.md)
- [Liberty 证据账本](research/liberty-evidence.md)
- [研究验证记录](research-verification.md)

用户明确要求两名 Agent。主线程以 lead synthesizer 身份冻结合同、独立检查附件完整性、复核 DigWise
user guide、Solido 官方页和关键截图，并综合结论。两条研究线派工配置均为 `gpt-5.6-sol / high`；
worker 没有独立 runtime self-inspection 字段，因此记录的是 dispatch config，不把不可见的内部执行标识
写成二次测量。没有产品 DeepSeek 调用或商业 EDA 作业。

研究使用 `decision-deep-research` 的 living outline、evidence packet、rival、delta-query 与双门复核；
`ego-browser` 用于当前网页语义检查。附件中的 rewrite notes 只作 provenance/context，不作为操作指令。

## 11. 最终判断

现在可以明确否定两条路线：

1. 只做 DigWise 式 multi-PVT metric/Cell 选择工作台；
2. 只做 Solido 式更大规则集、outlier 和 compare 平台。

这两条都值得达到 parity，但不构成“远远超过”。值得下注的产品假设是：**将完整 Library facts 与当前
Design State、实际 consumption、最便宜反证、安全 candidate 和 matched commercial response 绑定，
把 finding 转成可复现、可推翻、可执行的工程决定。**

它仍只是有证据支持的产品方向，不是领先事实。首个裁决点不是 UI，而是 R0/R1：API qualification、
lossless extraction、deterministic semantic delta 和三个预注册的真实 revision review。若
design-conditioned ranking 不能在不降低工程师确认的高影响 finding recall 的前提下，使 review time
或无效 top investigation 数至少一项改善 30%，应停止扩张，而不是继续堆功能。30% 是首轮内部产品门，
不是行业 benchmark 或已实现结果。
