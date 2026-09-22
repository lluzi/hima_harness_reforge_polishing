# Library Intelligence Platform：产品判断与竞争边界

日期：2026-09-22

## 结论先行

不能把“Liberty API + 大量规则 + Dashboard + AI 异常检测”定义为领先产品。公开资料显示，
Synopsys PrimeLib、Cadence Liberate Trio、Siemens Solido Characterization Suite 和 Empyrean
QuaLib 已经覆盖其中大部分；尤其 Solido 已公开 160+ 规则、PVT/lookup-table 异常检测、跨版本和
跨供应商比较、公式化 tolerance、JSON/CSV、可编程 Transform/Compare，以及 GUI/batch/cluster
运行。

HimaHarness 有机会形成代差的地方，是把 Library 文件内的异常提升为**设计条件化的工程决策**：

> 哪个 Cell/pin/arc/table 的变化，在当前设计、当前 endpoint frontier、当前 slew/load 和当前
> 商业实现中真正可达；它可能影响哪些实例和路径；证据强度如何；最便宜的下一项反证是什么；
> 修复候选是否在相同条件下减少风险或改善结果；全过程能否从最终结论返回原 Library 字节、
> API 提取结果、设计事实、试验和回滚。

因此建议交付新的 HimaPack，而不是新建独立平台组件，也不是把功能塞进现有
`custom-cell-fmax-dtco` Pack。首个产品楔子是 **Design-Conditioned Library Delta Triage**：对两个
Library revision 做语义差异和异常分析，再与一个真实设计的采用、时序和物理证据相连，交付按
设计风险排序、可复现、可反证的工程结论。

当前不能进入产品实现：厂商 fixture 在已经建立的 Python 3.7.12 + AlmaLinux 8 `edarun` 环境中
仍于 `lib.name()` 退出 139。用户明确要求不做 debug，因此本轮只完成可逆环境、能力盘点、产品
定位和可执行规格，不把 API 称为已合格。

## 1. 竞品已经把哪些能力做成基线

| 能力 | PrimeLib | Liberate Trio | Solido Characterization Suite | QuaLib | 对 Hima 的含义 |
| --- | --- | --- | --- | --- | --- |
| characterization 与 QA 一体 | 是 | 是 | 是 | QuaLib 偏验证，Liberal 承担表征 | 不能靠“统一入口”领先 |
| multi-PVT / LVF / variation | SmartScaling、LVF、高 sigma | multi-PVT、nominal/LVF unified、ML corner | NLDM/CCS/LVF/Moments、AI characterizer/generator | 官网声明多种 Library/IP/view | 模型覆盖和 corner 缩减属于成熟竞争区 |
| 静态规则与一致性检查 | comprehensive QA | equivalence/data consistency/correlation | hundreds of standard/custom checks | comprehensive inspection | “规则更多”没有稳固护城河 |
| revision/vendor compare | GUI compare/validate | revision analysis | Compare API、跨 revision/vendor、公式 tolerance | release/revision PPA trend | 普通 semantic diff 只是入场券 |
| AI 异常或补全 | ML high-sigma/LVF | ML PVT prediction | PVT/table outlier、rule generation、log assistant | AI missing-arc validation | “加 AI”不是产品定义 |
| 自动修改与自定义接口 | 加密 re-characterization kit | 流程脚本与工具组合 | Margin/Copy/Trim/Resize/Merge、Transform API | Liberty APIs | 直接写 Library 必须比竞品更安全、更可审计 |
| 设计条件化优先级 | 本次公开材料未展示 | 本次公开材料未展示 | Profiler 做 Library PPA 选择；本次公开材料未展示真实设计 path/instance join | PPA trend；本次公开材料未展示真实设计 path/instance join | 这是值得验证的差异，不是已证明的空白 |
| 闭环商业结果与证据 lineage | characterization/signoff 集成 | Tempus/characterization 集成 | characterization/QA/rerun 集成 | SPICE/多 view 验证 | Hima 必须证明的不只是集成，而是结论到当前设计结果的完整证据链 |

来源：[Synopsys PrimeLib](https://www.synopsys.com/implementation-and-signoff/signoff/primelib.html)、
[Cadence Liberate Trio](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/library-characterization/liberate-trio-characterization-suite.html)、
[Cadence Library Validation](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/library-characterization/liberate-trio-characterization-suite/library-validation.html)、
[Siemens Solido Characterization Suite](https://www.siemens.com/en-us/products/ic/solido/characterization/)、
[Siemens/NVIDIA Liberty workflow](https://blogs.sw.siemens.com/cicv/2026/06/01/how-nvidia-is-scaling-liberty-verification-for-diverse-ip-using-the-solido-characterization-suite/)、
[Empyrean QuaLib](https://www.empyrean-tech.com/products/eda/digital-soc/standard-cell-library-and-ip-validation.html)。

公开页面只证明厂商声明和公开工作流，不证明速度、精度或市场效果。本轮针对
`design netlist / timing path / design context` 做了定向搜索，没有找到上述产品公开说明把 Library
异常直接绑定到当前设计实例、完整 endpoint frontier 和 matched implementation response；这个结果
只限定于记录的检索协议，不能解释为竞品私有能力不存在。

## 2. 为什么 Hima 仍有机会

### 判断 A：竞争单元应该从“检查”变成“决定”

**机制。** Library QA 工具擅长产生大量局部 finding，但工程师真正需要决定的是修什么、先修什么、
是否阻塞 release、需要哪种独立验证，以及问题是否影响当前产品。若 ranking 只使用 deviation magnitude
或固定 severity，同一个异常会在未采用 Cell、非关键 Cell 和真实 frontier Cell 上得到相同优先级。

**支持。** Siemens/NVIDIA 案例明确显示成熟工具已经能排序 finding、跨 PVT 找 outlier 并输出详细
报告，但该公开流程的核心仍是 Library 内部验证和跨文件比较。Hima 现有 DIG、Endpoint Frontier、
Commercial Label、Matched Comparison 和 Ledger 可以提供另一个维度：finding 是否被当前设计采用、
是否出现在可迁移最差路径、是否覆盖实际 slew/load，以及修复后的商业响应。

**反例。** 竞品可能在非公开部署中已经完成相同集成；同时，Library 发布方不能只服务一个设计，
仍需要 exhaustive QA。Hima 不应声称替代 Solido/PrimeLib/Liberate/QuaLib，而应先证明自己的排序使一次
真实 review 更快、更准确。

**产品影响。** 第一版保留所有 finding，但把 design reachability 和 impact 作为额外的、有证据的
排序与解释层；不允许设计上“未采用”把 Library 规则错误自动降为 PASS。

### 判断 B：Library 原件必须继续是唯一事实源

**机制。** 解析后的表格、SQLite、图或 embedding 一旦脱离输入 hash、解析器版本和查询语义，就会
产生第二份 Library。这样得到的漂亮解释无法在签核或事故分析中复现。

**支持。** HimaHarness 已有 Site、Pack、Ledger、Reader、Knowledge 和 evidence archive 的身份链；
Pack 工具可以在 Site 本地处理 proprietary data，只把 hash-bound 派生报告带入 Campaign。安装 API
暴露 read/write、Cell/pin/arc/table、corner 和 evaluator 能力，足以做窄 adapter。

**反例。** 如果每次查询都从 80 GB 级 SAED14 corpus 重新解析，交互不可用。派生索引不可避免。

**产品影响。** 允许 content-addressed SQLite/JSONL cache，但它是可删除、可重建的派生物；每条记录
必须带 source SHA-256、API build、adapter schema 和 extractor version。任何 write 都只产生候选副本，
不得原地改 golden Library。

### 判断 C：原生 API 必须隔离为 Site-local worker

**机制。** SWIG/native parser 的进程级失败会绕过 Python exception。若 Campaign Agent 或 Host 直接
导入 `_tmlib.so`，一个坏 Library 或 ABI 问题会带走整个产品进程。

**支持。** 当前 vendor fixture 已经在 `lib.name()` 给出退出 139。API README 还明确提醒部分公共类型
可能随版本替换。

**反例。** 完全用文本 parser 重写功能可以回避 native crash，但违反“基于 Lib API”的产品边界，
也会建立重复语义。

**产品影响。** HimaPack tool 通过 `/usr/local/bin/edarun` 启动独立 Python 3.7 worker；一个输入文件
一个受控子进程。父进程收集 exit code/signal、stderr、parser log 和输出 hash。业务 schema 是稳定
JSON，不把 SWIG object 暴露给 Harness 或前端。

## 3. 现场数据意味着什么

只读元数据盘点确认：

- SAED14 有 933 个 Liberty 文件、约 80.5 GB，覆盖 HVT/LVT/RVT/SLVT、SRAM、IO 和 PLL；
- `celluzi/lib` 有 246 个文件、约 704 MB，包含建模、表征、场景和自定义 Cell 资产；
- `tsmc28_work` 当前扫描到 39 个文件、约 1.41 GB，其中有 foundry baseline、Skeleton、候选和运行副本；
- 更宽的 Hima workspace 扫描会立即扩张到 14,267 个文件、2,229 个目录，且存在大量重复 ORFS/ASAP7
  副本。

因此平台的第一项能力不是画图，而是**来源分类、content hash 去重、canonical corpus 与 run copy 的
区分**。否则重复工作区会被误当作更多 corner/revision，异常统计和趋势都会失真。该盘点没有把
proprietary Library 内容复制到 Git；仓库只记录聚合统计、代表性 hash 和边界。

## 4. 推荐的产品结构

新能力以 `library-intelligence` HimaPack 交付：

1. **Site discovery/profile** 绑定 Library roots、Lib API、Python 3.7 和设计证据；只读根与 Campaign
   写根分离。
2. **Lib API adapter** 将不稳定 native object 映射成稳定、版本化、hash-bound JSON schema。
3. **Corpus index** 做来源、corner、model/view、Cell/pin/arc/table、revision 和 hash identity；原件权威。
4. **Validation and delta** 输出结构、单位、完整性、曲线/网格、cross-corner 和 cross-revision finding；
   unknown 不变成零或 PASS。
5. **Design relevance join** 连接当前 netlist、timing reports、Endpoint Frontier、actual slew/load、adoption
   和 Commercial Label。
6. **Campaign Agent triage** 对 finding 形成假设、选择最便宜反证、组织 SPICE/STA/implementation 验证。
7. **Candidate write sandbox** 使用 API 写候选 Library，round-trip 和 invariant 检查后才能进入独立试验；
   golden 原件不写。
8. **Workbench projection** 展示同一 Ledger 中的 finding、受影响设计对象、证据、状态和下一动作；不建
   第二控制器或第二结论数据库。

这一结构沿用 Pack、Site/Channel、Reader、Ledger/Archive、Campaign Agent 和 Workbench 职责。只有当
首个切片证明现有 Pack 输出和 Workbench projection 无法承载交互查询，才讨论独立服务或数据库组件。

## 5. 首个可证伪切片

**场景。** Library 工程师给出 baseline/revision 两个同族 Liberty set 和一个真实设计证据 bundle，
系统在一次 Campaign 中回答：“哪些变化最可能改变当前设计结果，证据是什么，下一项最便宜验证
是什么？”

**输出。** 一份 hash-bound delta inventory、一份完整 finding set、一份 design-impact ranking，以及
每个 top finding 的 source location、Cell/pin/arc/table identity、变化量、实际 instance/path/endpoint、
slew/load coverage、置信度、unknown、建议验证和复现命令。完整 finding 不因排名而丢失。

**能推翻本切片的例子。** 两个 revision 只在未采用 Cell 上变化，平台却把它们列为当前设计阻塞项；
或一个关键 arc 的单位/lookup-table 改变真实覆盖当前 path operating point，平台却因全局平均变化小而
降级。任一发生都说明 ranking 不能用于工程决策。

详细接口和门槛见 [首个切片规格](first-slice-spec.md)。
该切片已登记为 [GitHub #49](https://github.com/lluzi/hima_harness_reforge_polishing/issues/49)，当前标签
为 `needs-info`，不标记为可实施。

## 6. Continue / stop 信号

继续到第二阶段需要同时看到：

- API qualification fixture 和至少一个真实 Library 读/query/write-copy/round-trip 通过；
- 同一结果可由 source hash + adapter version + query 复现；
- 在一项真实 revision review 中，top finding 的 design linkage 由工程师判定正确；
- 与不带 design context 的 severity 排序相比，review time、无效调查数或漏掉的高影响 finding 至少一项
  有可测改善；
- candidate write 从不覆盖输入，并能给出明确 rollback 和 diff。

任一情况应停止扩大：

- API 对受支持 fixture 或代表性输入仍发生进程级崩溃，且用户不授权诊断或厂商没有可用包；
- design evidence 无法稳定对齐 Cell/pin/arc identity；
- 缓存不能从 source hash 重建或出现第二事实源；
- 工程师试用显示 design ranking 没有改变 review 决策，只增加解释负担；
- 需要新增独立控制面才能完成首个切片。

## 7. 本轮边界

这不是已完成的平台，也没有证明“远超竞品”。本轮已经完成的是：可逆 Python 3.7 环境、实际 API
fixture 运行结果、公开竞品基线、现场 corpus 盘点、产品差异判断和可执行首切片。API qualification
仍是实现门；在用户“不做 debug”的指令下，本轮不尝试 ABI/native 修复。

研究合同、检索协议、反证和证据账本分别见
[research-contract.md](research-contract.md) 与 [evidence-ledger.md](evidence-ledger.md)。
