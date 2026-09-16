# Library Function Richness Optimization Framework 开发文档

状态：开发中

开发对象：`packs/custom-cell-fmax-dtco` HimaPack

跟踪标识：`LFR-FW-*` 与 `LFR-PACK-*`，独立于 Product Upgrade v2 的 PLS 主线

GitHub 跟踪：[Issue #40](https://github.com/lluzi/hima_harness_reforge_polishing/issues/40)

英文对照：[framework-development.en.md](framework-development.en.md)

## 1. 文档目的与完成标准

本文规定如何把 Library Function Richness Optimization Framework 做成可独立验证的方法实现，
再把同一实现接入 `custom-cell-fmax-dtco` HimaPack。开发分成两个阶段：

1. **Framework 建设阶段。** 团队自行完成映射代理、时序代理、影响图、候选组合、累计 Library、
   校准、优化循环和评估。这个阶段不依赖 HimaFabric 编排，也不启动 LC、DC 或 Innovus 搜索。
2. **HimaPack 开发阶段。** 只有 Framework 通过评估后，才按 HimaPack 的文件、契约、Reader、
   Judge、Workshop、测试 Run 和 release seal 标准接入。

最终标准不是“写出了算法”或“Pack 能启动”，而是同时满足：

- Framework 对自己的输入、指标定义、适用范围和停止原因负责；
- 高频优化只使用 license-free 工具；商业 EDA 用于观察真实 design QoR，不作为高频试错引擎；
- 旧 Cell 及其交付件按 hash 复用，不随轮次重新生成；
- AI 根据现场残余问题改变研究算法，确定性实现负责身份、计算、预算和证据；
- HimaPack 能在满足 contract 的不同 design、Site 和兼容工具版本上运行，不携带 AES 固定答案；
- `/hima pack check`、测试 Campaign、`TEST.md` 和 Harness 生成的 `VERSION.yml` 共同证明可交付性。

## 2. 背景与已知失败

现有 Pack 已经证明从输入绑定、候选 Boolean identity、Cell 生成、layout、预测表征、Library
Compiler、DC adoption 到 Innovus route 和 matched comparison 的技术链可以运行，但它还没有
证明研究方法有竞争力：

- 47 个 Cell 中有 21 个被 DC 采用、综合实例 307 个、route 保留 250 个，matched Fmax 只提升
  约 0.193%；
- 修正 APR 压力与 DCCK CTS 后仍保留 222 个 custom Cell 实例，matched Fmax 反而下降约
  0.179%；
- 当前每一代重做旧 Cell，并让 DC/APR 承担高频筛选，既昂贵，也不能解释收益为何出现或消失；
- adoption 数、单条 path 或理想 cone-removal 上界均不能预测最终 Fmax。

因此，本次开发把问题改写成：在真实 EDA 之前，如何用目标 design 的逻辑图、累计 Library、
Yosys/ABC 映射和代理 STA，建立一套可重复的多层指标体系，持续增加能够有效改造逻辑结构的
Library function。

5% 是商业设计目标，只能由 matched commercial flow 判断。开源代理不预测这 5% 或对应的
route Δps；它衡量 Boolean 可实现性、局部级数/节点/边/cut 变化、全设计映射采用、实例与
buffer/inverter 压力、fanout/load、path-family 覆盖、proxy-STA frontier 和 Library 成本。
商业结果用于观察这些指标与真实 QoR 的关系，不把代理训练成商用 EDA 的数值替代品。

## 3. 范围与架构约束

### 3.1 本次开发包含

- Yosys/ABC 的可复现 technology-mapping 代理；
- 对 mapped netlist 和完整 Liberty 进行的代理 STA；
- 从 RTL、mapped netlist 和已有 route 证据构建的 reg2reg timing-influence graph；
- K-cut、dominator、reconvergence、重复 cone、path-family 和 fanout/load 影响分析；
- function-level、局部 subgraph、全设计 mapping 和 proxy-STA 的分层评估；
- 单次 reference/augmented batch mapping 和少量有界 ablation；
- 只追加新 Cell 的 immutable Library shards 与累计 manifest；
- AI 主导的残余问题研究和确定性独立复算；
- Framework 评估、HimaPack 接入、测试 Campaign 与 release 证据。

### 3.2 本次开发不包含

- 新的 Hima Runtime、第二个 Fabric、第二个资产服务或隐藏 Agent；
- 用商业 EDA 做逐 Cell、逐方法或每轮试错；
- 把 AES、TSMC28 路径或当前 Site 命令写成 Pack 方法不变量；
- 自动把客户运行结果写回 Pack 方法知识；
- 把代理结果写成 `comparison_valid`、最终 Fmax 或 physical adoption；
- 新建 PLS-36～PLS-38，或把本轨道完成度混入 PLS 主线。

### 3.3 代码位置原则

Phase 1 的实现直接放在 Pack 自己的 `flow/` 与 `flow/domain/` 中，但在评估通过前不接入
`graph.yml`。Phase 2 复用同一批实现，不复制另一套算法。允许新增一个 Pack 内部的
`flow/domain/proxy_mapping.py`，因为当前代码没有容纳 Yosys/ABC 命令、日志和 mapped-netlist
解析的现有模块；这不是新的产品组件。其他能力优先深化现有模块。

`flow/` 是 Campaign workspace 中运行的源码。`tools/` 中当前与 `flow/` 重复的入口文件在改动后
必须保持逐字节一致，除非先证明并修改了 Pack loader/publish 约定；不能仅因重复就删除。

## 4. Framework 的一个外部接口

Framework 对调用方只提供一个深接口：给定一次 hash-bound request，产生一次
hash-bound evaluation。HimaPack stage、独立 CLI 和测试都通过同一接口，不直接拼接内部命令。

建议的 Python 接口：

```python
evaluate_round(request: Mapping[str, object]) -> Mapping[str, object]
```

CLI 只负责 JSON I/O：

```text
python3 flow/library_richness.py --request REQUEST.json --output EVALUATION.json
```

Request 至少包含：

- RTL 文件清单、top、约束摘要及其 hash；
- foundry Liberty 与累计 custom-Library manifest；
- 本轮 candidate delta；
- Yosys、ABC、proxy-STA 工具身份和固定 profile；
- 目标 reg2reg period、指标优先级、Library/轮次预算；
- 可选的历史 DC/Innovus 对照证据，明确其 design、条件和适用范围。

Evaluation 至少包含：

- request、脚本、工具、Library shards 和输出文件的 hash；
- reference 与 augmented mapped netlist；
- mapping adoption、instance、function class 和关键图覆盖；
- function feasibility，以及局部逻辑级数、节点、边、cut width、重汇聚和支配关系变化；
- 全设计 mapping adoption、实例数、逻辑深度分布、buffer/inverter 压力、fanout/load 与 overlap；
- reference/augmented proxy-STA frontier、negative-slack mass 与 path migration，明确只是指标；
- optimistic/nominal/conservative 三种 slew/load 情景下的完整指标向量和两臂 `pairwise_relation`；
- residual graph、未采用候选及原因、下一轮研究问题；
- 指标是否完备、两臂关系、收敛/停止原因及其确定性复算依据；跨候选、跨轮次 Pareto frontier
  只能由 FW-07 portfolio 产生。

Evaluation 永远是结构评估和分级筛选证据，不预测商业收益。只有现有 `compare` Reader/Judge
能根据商业数据库和报告产生最终 design QoR 比较事实。

## 5. 组件级开发要求

### 5.1 Yosys/ABC mapping adapter

**落点：**新增 `flow/domain/proxy_mapping.py`；薄 CLI 放在 `flow/library_richness.py`；工具调用最终
由 `flow/stages.py` 承接。

具体工作：

1. 固定 Yosys/ABC commit、build flags、可执行文件 hash、容器 digest 和完整命令行。现有
   `iic-osic-celluzi:2026.06` 仅可用于兼容 POC，不能自动成为产品基线。
2. 从明确文件清单执行 `read_verilog -sv`、`hierarchy -check -top`、确定性的 process/opt/memory/
   techmap 序列、`dfflibmap` 与 `abc -liberty`。禁止用工作目录 glob 偷偷扩大 RTL 输入。
3. reference 与 augmented mapping 使用同一份脚本、top、约束、ABC profile 和随机性设置，唯一差异
   是 Library 集合与输出路径。
4. 通过约束文件向 ABC 提供一致的 driving-cell/load/delay target；无法表达的 SDC 内容列入
   `unsupported_constraints`，不得静默忽略。
5. 保留完整 log、ABC script、mapped Verilog、`stat -liberty`、Cell census 和 return code。
6. 以 NPN function class、pin interface 和 drive variant 分别记录 adoption。不同 drive 是同一功能
   类下的物理选择，不得误判成全新 Boolean function。
7. 任何 mapping failure 都返回结构化失败，不返回空网表或零延迟。

该 adapter 只回答“这个 mapper 在当前 Library 下如何实现逻辑”；它不回答 post-route Fmax。

### 5.2 Proxy STA

**落点：**优先深化 `flow/domain/cell_need_miner/liberty_timing.py`，复用
`flow/domain/verilog_netlist.py`。只有 POC 证明现有解析器无法可靠承担 mapped-netlist STA 时，才
增加 OpenSTA 外部 adapter。

具体工作：

1. 解析完整 Liberty timing arc、timing sense、related pin、7×7 NLDM index/table、pin capacitance；
2. 读取 mapped netlist 的 sequential boundary、combinational arc、net fanout 和负载；
3. 按当前 input slew/output load 对 NLDM 做有界二维插值，记录超出表格时的 clamp/extrapolation；
4. 在 reg2reg scope 内传播 arrival、required、slack 与 slew，保留 endpoint family；
5. 输出每条 frontier path 的 cell、可消除 buffer/net、估算 wire/boundary penalty 和不确定项；
6. reference 与 augmented 使用相同 clock、I/O 排除、load 与 uncertainty 假设；
7. 对 combinational loop、缺 arc、unknown sequential Cell、multi-clock ambiguity 失败关闭。

若采用 OpenSTA，它只作为 Pack 内部外部工具被调用，必须固定 commit/版本/hash，并保留 TCL、log
和报告。不能把 OpenSTA 引入 Hima Runtime，也不能链接进产品进程。

### 5.3 Timing-influence graph

**落点：**深化 `mine_timing_route.py` 的 `_mapped_graph`、`_arrivals`、`_required`、
`_dominators`、`rank_critical_subgraph` 和 `parse_reg2reg_timing_graph`；复用 `aig.py`、`cuts.py`、
`npn.py` 与 `verilog_netlist.py`。

每个候选 subgraph 必须保留可解释向量：worst-endpoint relief、negative-slack mass coverage、
path-family coverage、dominator/reconvergence coverage、removable depth、cut boundary、重复且不重叠
occurrence、fanout/load、与其他候选 overlap、mapping feasibility。排序可以使用这些量，但原始量必须
保留，不能只输出一个不可解释 score。

候选 counterfactual 不是把 cone delay 设为零，而是：

```text
旧 cone 的 cell + 可消除 buffer/net delay
- 新 Cell 的 NLDM delay
- 新边界、fanout、wire 与不确定性 penalty
```

计算后必须在完整 timing graph 上重新传播，记录新的 worst endpoint 和 path migration。

### 5.4 Candidate function 与 portfolio optimizer

**落点：**深化 `mine_patterns.py` 的 cluster/canonicalization/implementation-plan 逻辑，以及
`cell_need_miner/cuts.py`、`npn.py`。

具体工作：

- 只在高影响区域枚举 K-feasible cuts，但保留多种研究镜头，不把一个排序算法写死为方法；
- equivalence key 至少为 NPN-canonical Boolean function、输入/输出 interface；drive variant 单独记录；
- 先过滤当前 generator 不能实现的 request，同时保留 unsupported 原因作为知识；
- portfolio 目标采用字典序：先降低最差 reg2reg frontier，再降低按 endpoint family 去重后的
  negative-slack mass；
- overlap 必须在一次 augmented mapping 内计算，不把相交 cone 的理想收益相加；
- 每轮只做 reference `Lk` 和 augmented `Lk + ΔLk` 两次必要 mapping；仅对归因不清的少数组合做
  license-free ablation；
- 输出 break-even delay，而不是把未实现 Cell 假设为零延迟。

### 5.5 Cumulative Library 与 delta materialization

**落点：**深化 `_generation_projection.py`、`stages.py` 的 merge/generate/layout/characterize，复用
现有 attempt、artifact 和 hash 机制，不建立新资产服务。

Workspace 内采用：

```text
flow/library/
  baseline-reference.json
  shards/0001/{functions.json,cells/,predicted.lib,mapping-evidence.json}
  shards/0002/...
  cumulative-manifest.json
```

要求：

- `L(k+1) = L(k) union ΔL(k)`；旧 shard 永不重写；
- generator、layout、prediction 只为 `ΔL(k)` 创建 Jobs；
- manifest 记录 candidate identity、function class、drive、来源轮次、文件 hash、proxy 状态和已知失败；
- manifest 使用 Pack 内部证据状态 `discovered -> proxy-mapped -> materialized -> predicted ->
  cumulative -> commercially-adopted -> route-retained -> final-benefit`，并保留
  `proxy-rejected`；这些状态不进入根 `CONTEXT.md`，也不改变 Runtime 逻辑；
- 未被当前 design 采用的 Cell 仍保留为资产，但每轮报告 Library size 和 mapping cost；
- 商业出口时才把 shards 确定性拼成一次 cumulative Liberty/LEF，拼装不算重新生成；
- `MAX_NEW_CELLS` 表示每轮新增量；原 `MAX_CELLS` 不得偷偷改义。累计上限在 Phase 1 测量后确定。

### 5.6 AI research controller

**落点：**深化 `ai_research_runner.py` 与 `research-template.py`，继续使用唯一的
`research-candidates` Workshop。

AI 接收 compact、hash-bound 的 residual graph、proxy mapping、多层指标向量、Pareto frontier、
cumulative manifest 和历史失败。它负责提出研究镜头、编写有界候选/portfolio 代码、决定下一轮扩展
区域并解释希望改变哪些结构指标。它不能修改 Goal、伪造测量、删除旧资产、直接写 Judge 事实或
自行启动商业流。

`ai_research_runner.py` 继续负责完整 I/O、候选 membership、Boolean identity、预算、source hash、
输出 schema 和代码 hash；`read-stage.py` 独立复算关键数值。第二梯队模型只需要解决明确的 residual
problem，不需要重新理解 Yosys、ABC、Liberty 与整个 Pack。

### 5.7 指标体系、商业对照与验证分级

Framework 不以预测 DC/Innovus 数值为目标。F 表示免费评估，E 表示昂贵验证。F0 是前提，
F1、F2、F3 是并列因子：

- **F0 Function：**Boolean 等价、接口、generator feasibility、break-even local bound；
- **F1 Local structure：**级数、节点/边、cut width、重汇聚、支配、重复/非重叠支持；
- **F2 Design mapping：**全设计采用、实例/面积、深度分布、buffer/inverter 压力、fanout/load；
- **F3 Timing indicator：**proxy-STA frontier、negative-slack mass、path-family coverage 和迁移。

商业 DC/Innovus 结果构成 **E0 Design QoR observation**。判断对象是一轮候选 Library，而不是某一颗
Cell。E0 与 F1/F2/F3 向量做同条件对照，用来发现哪些因子与商业收益存在正相关关系；未来可按同一
接口增加 F4、F5。precision/recall、rank correlation、方向和数值差异可以记录，但不作为追求预测
准确率的训练目标，也不升级成跨 design 的通用阈值。

一次 E0 候选至少要求：证据完备可复算、F0 有效、overlap 已处理，而且候选 Library 位于当前 Pareto
frontier。F1/F2/F3 分别标记为 positive、neutral、mixed 或 explicitly negative；只有三者全部明确
负向时才因因子方向拒绝。单独的 F1、F2 或 F3 负向结果不能否决整份 Library，缺失证据也不能被当成
“非负”。通过表示“值得验证”，不表示“预计会获得多少收益”。E0 次数是 Campaign/Pack 的显式预算，
不是 Runtime 常量。

## 6. Phase 1：独立 Framework 建设与评估

### 6.1 工作项与依赖

| ID | 依赖 | 具体修改 | 交付证据 |
| --- | --- | --- | --- |
| LFR-FW-01 | 无 | 冻结 AES RTL、top、SDC 摘要、foundry Liberty、47-Cell predicted Liberty、DC adoption、两份 route timing/census 的 hash-bound calibration corpus；写清两轮条件不同 | corpus manifest、来源路径、hash、可用/缺失字段；不复制客户原始材料进 Git |
| LFR-FW-02 | FW-01 | 实现 `proxy_mapping.py` 与薄 CLI；固定 Yosys/ABC profile；reference/augmented batch mapping | 相同输入重复运行的 netlist/census 身份；脚本唯一差异审计；失败反例 |
| LFR-FW-03 | FW-01 | 扩展 `liberty_timing.py` 完成 NLDM 插值和 mapped-netlist reg2reg STA；决定是否需要 OpenSTA | 手算小电路、slew/load 边界、缺 arc、multi-clock 反例；同一引擎复算 reference/augmented |
| LFR-FW-04 | FW-02、FW-03 | 用 47-Cell 证据建立可用的 F0/F2/F3 基线，并与保存的 E0 commercial QoR 做条件化对照；F1 缺失须明示 | 指标向量、adoption/排序/QoR 对照；明确适用范围与 root cause；零 LC/DC/Innovus Job |
| LFR-FW-05 | FW-04 | 深化 influence graph、K-cut、结构 counterfactual、path migration 与多指标 Pareto portfolio | synthetic reconvergence/dominator/overlap 用例；Pareto 层可从原始向量复算 |
| LFR-FW-06 | FW-01，可与 FW-05 并行 | 实现 immutable shards、累计 manifest、delta-only generation projection 与 invalidation | 两轮 synthetic Library；旧文件 hash 不变；第二轮不产生旧 Cell Job |
| LFR-FW-07 | FW-05、FW-06 | 接入 AI residual research、两级 proxy、收敛和停止；实现独立 CLI 闭环 | 一个固定 replay 和一个第二梯队真实模型小任务；输出可复算，未越权启动商业工具 |
| LFR-FW-08 | FW-07 | 对 Framework 做正式评估：可复现性、校准、优化趋势、成本、泛化边界与失败资产 | Framework assessment；决定进入 HimaPack、修正代理或停止，不能以代码完成代替评估通过 |

FW-02 与 FW-03 可并行，FW-06 可在 FW-04 后半与 FW-05 并行。FW-04 是指标设计门：单一 timing
指标不能解释结构变化时扩充指标体系，不把问题改写成追求商业结果预测精度。

### 6.2 Framework 测试分级

| 层级 | 内容 | 不能证明 |
| --- | --- | --- |
| FW-T0 | Python 编译、JSON schema、source/tool/hash provenance | 算法正确 |
| FW-T1 | 纯逻辑：NPN、cut、dominator、NLDM 插值、到达时间、overlap、目标函数、manifest | 真实 mapper/tool 兼容 |
| FW-T2 | 本地真实 Yosys/ABC + proxy STA 的小 RTL/Library；两轮 shard 复用 | DC/Innovus 相关性 |
| FW-T3 | AES 保存证据的 calibration 与回放，零商业 Job | 新 design 的 5% 收益 |
| FW-T4 | 一个不同结构的 held-out RTL、第二梯队模型研究、成本与停止评审 | commercial Fmax 或 Pack 可交付性 |

日常修改只运行受影响的 FW-T0～T2。FW-T3 在 proxy/profile/校准逻辑实质改变时运行；FW-T4 在
Phase 1 出口运行一次。测试 fixture 的期望来自手算、固定工具输出或保存的商业证据，不能由被测实现
自己生成。

### 6.3 Phase 1 出口

只有以下条件同时满足才进入 Phase 2：

- 所有输入、工具、Library 和结果有稳定身份；
- reference/augmented mapping 可重复，约束差异为零；
- proxy STA 对受支持结构的指标含义、保守假设和未知项可解释；
- 对照报告说明已提供层与商业 E0 的条件、关系、缺失层和不可外推边界；
- 至少一个 held-out RTL 上，优化循环能从 residual graph 产生新候选并推进多指标 Pareto frontier；
- 旧 Cell 不重新生成，Library 只追加，失败候选不会重复试验；
- 第二梯队模型能在给定 compact context 下完成研究程序；
- Framework assessment 明确批准 Pack integration。

## 7. Phase 2：按 HimaPack 标准接入

### 7.1 工作项与文件映射

| ID | 依赖 | 固定文件 | 具体开发内容与完成证据 |
| --- | --- | --- | --- |
| LFR-PACK-01 | FW-08 | `INTENT.md`, `SPEC.md` | 用现有五段/九段 authoring 格式重写方法目标、约束、Run contract、语义、Judge、Chooser、结束、Workshop 和知识；保留作者已确认决定 |
| LFR-PACK-02 | PACK-01 | `contract.yml`, `flow/bind-inputs.py`, `knowledge/site-profile.md` | 声明 Yosys/ABC/proxy-STA 身份、超时和资源；增加 `MAX_NEW_CELLS`；原 `MAX_CELLS` 显式退休或保留累计硬上限；HimaGuide 默认发现，不要求用户手填 |
| LFR-PACK-03 | PACK-01 | `graph.yml` | 用 evaluation baseline 替代开头的商业 probe；在商业 compile/DC/APR 前放置 function/local/design/timing 分层评估、delta materialization、Pareto Judge 与 research revisit；值得验证时才进入现有最终链 |
| LFR-PACK-04 | PACK-02、03 | `flow/stages.py`, `flow/library_richness.py`, `flow/domain/*`, `tools/stages.py` | 将 Phase 1 接口接入已有 stage dispatch；保留 attempt/artifact/hash；同步发布副本；不得复制算法或绕过 Permit/Job 记录 |
| LFR-PACK-05 | PACK-03、04 | `contract.yml` outputs/workshop、`readers/`, `semantics.yml`, `rules/`, `choosers/`, `flow/read-stage.py`, `tools/read-stage.py` | 声明一个完整 proxy-evaluation 输出和必要 Library manifest；Reader 独立复算；Judge 只在证据完备时通过；Chooser 只调整研究策略，不改 Goal |
| LFR-PACK-06 | PACK-05 | `flow/ai_research_runner.py`, `flow/research-template.py`, `knowledge/full-mining-method.md`, `knowledge/manifest.yml` | Workshop 读取 residual graph、calibration、manifest 和失败资产；更新方法知识与来源；不把运行结果自动写回 Pack |
| LFR-PACK-07 | PACK-06 | `FABRIC.md`, `TEST.md`, `test/contract/custom-cell-fmax-pack.test.ts` | `/hima pack check`；受影响 L0/L1/L2；真实 test Campaign；记录 Run status、CodeRecord hash、refusal id 和所有 disagreement |
| LFR-PACK-08 | PACK-07 | Harness 生成的 `VERSION.yml`、候选验证目录 | Phase 1 通过后只做一次必要的 commercial matched exit；测试 Pack 无误后通过 `/hima pack release` 生成 seal；用户签收仍独立 |

### 7.2 参考运行图的目标形状

```text
bind-inputs
  -> proxy-baseline/read
  -> high-influence mining branches
  -> research-candidates/read
  -> function-and-local-evaluation/read/judge
       FAIL -> residual research revisit
       PASS -> generate/layout/characterize only delta
  -> design-mapping-and-timing-evaluation/read/judge
       FAIL -> residual research revisit
       PASS -> freeze cumulative Library
  -> compile -> matched foundry/custom DC -> adoption gate
  -> matched foundry/custom APR -> verify -> compare -> final Judge
       below target and commercial budget remains -> recalibrate -> proxy research revisit
       otherwise -> honest Campaign ending and archive
```

这仍是一张固定参考图。运行时 AI 只能在声明的 Explore/Workshop 位置改变策略、回溯和增加受控研究，
不能删除参考节点或创建第二个 Run owner。

### 7.3 Pack 输出与语义

优先把内部细节封装在一个 `proxyEvaluation` 输出中，其 Reader 发出最少但足够判断的类型：

- `proxy_local_level_delta`、`proxy_removed_node_count`、`proxy_cut_width`、
  `proxy_reconvergence_coverage`；
- `proxy_mapped_instance_delta`、`proxy_logic_depth_p95_delta`、
  `proxy_buffer_inverter_pressure_delta`、`proxy_fanout_load_delta`；
- `proxy_worst_reg2reg_delay_indicator`、`proxy_negative_slack_mass_indicator`；
- `proxy_adopted_candidate_count`、`new_library_cell_count`、`cumulative_library_cell_count`；
- `proxy_metric_vector_complete`、`proxy_pairwise_relation`、
  `portfolio_frontier_membership`、`e0_library_validation_candidate`。

每一种 type 必须由 Pack Reader 实际发出并在 `semantics.yml` 声明；不为 UI 方便制造无人产生的语义。
规则至少分开“指标证据完备”“两臂 pairwise 关系”“FW-07 portfolio frontier 成员”和“值得一次
E0 验证”，不能用一个大布尔值掩盖未知原因，也不能把 `e0_library_validation_candidate` 表述为
收益预测。

### 7.4 HimaPack 标准门

1. `INTENT.md`、`SPEC.md`、`FABRIC.md`、`TEST.md` 保持 authoring pipeline 规定的精确 heading 顺序；
2. `contract.yml` 和 `graph.yml` id/version 一致；所有 tool、output、reader、rule、chooser、knowledge
   和 Workshop 引用可解析；
3. Pack 中只有 plain files/directories，无 symlink、隐藏交付件或客户路径；
4. `/hima pack check <pack> --site <site>` 为 fit，并能明确报告 incompatible Site；
5. 测试 Campaign 标记为 test，运行的 Pack digest 与当前文件一致；
6. `TEST.md` 中 Run、status、CodeRecord hash 与 refusal id 能由 Ledger 核对；
7. `VERSION.yml` 只能由 `/hima pack release` 生成，禁止手写 hash 或文件清单；
8. 发布后任何文件变化都会使 seal 失效并要求重新测试。

### 7.5 Authoring pipeline 的使用顺序

Hima authoring pipeline 是 Package 的接纳顺序，不是重新生成 Framework 的理由：

1. `/hima-grill` 只更新 `INTENT.md`，保留既有访谈决定并解决新方法与 Golden Flow 的冲突；
2. `/hima-spec` 只从已接受的 Intent 产生九段 `SPEC.md`；
3. `/hima-fabric` 把 Spec 编译成 Pack 声明，并把不能表达的内容记录为 gap。它通过 tools 包装
   Phase 1 实现，不能复制或改写优化算法；
4. Package developer 只在 gap 指向的现有 Pack 文件中完成实现，再运行 pack check；如果 gap 需要
   新 Hima Runtime 能力，则停止并回到产品决策；
5. `/hima-test` 在真实 Site 上启动标记为 test 的 Campaign，由 Ledger 事实生成 `TEST.md`；
6. `/hima-release` 在 tested folder 上生成 `VERSION.yml`，任何人都不手写或修补 seal。

## 8. 验证与成本纪律

Phase 2 继续使用仓库 L0～L5：

- **L0/L1：**Pack schema、graph 引用、Python、proxy 纯逻辑；
- **L2：**真实 Host、本地 Yosys/ABC、proxy STA、两轮 shards、Reader/Judge/恢复；
- **L3：**只验证 Campaign graph、Library 增长、多层指标、pairwise 关系、portfolio frontier 身份和
  验证候选理由可见；所有 Desktop
  测试只在 Catsights 副屏；
- **L4：**一次真实模型小任务和一次 AES 保存指标/E0 对照；没有 LC/DC/Innovus 搜索；
- **L5：**Pareto 候选形成后的一次 matched commercial QoR observation。负结果写入关系证据，不能
  原样重跑或反向拟合收益预测器。

同一次修改不重复构建和跑完整桌面。先运行最便宜的可推翻测试；只有接口、真实依赖或用户路径变化
才升级验证层。通过、失败、跳过和未运行分别记录。

## 9. 跟踪、提交与决策

- 本轨道使用 `LFR-FW-01..08` 与 `LFR-PACK-01..08`；GitHub 使用独立 umbrella Issue，不创建 PLS
  编号。
- 每个工作项在开始前记录输入 commit、修改文件和最低测试；结束时记录 evidence、限制和 rollback。
- Phase 1 不修改 `graph.yml`、`contract.yml` 或发布状态；Phase 2 不重新实现 Framework。
- 任何新增 Hima Runtime 能力、第二资产系统、Pack 格式变化或产品领域定义变化，回到用户确认；Pack
  内部算法、Reader、工具参数和测试修正按本文件执行。
- 每次本地 commit 后立即 push 并核对远端 SHA。

## 10. 当前开发前沿

当前前沿是 **LFR-PACK-07**。PACK-01 至 PACK-06 已在现有 HimaPack 文件中接入冻结的
Framework。本地合同和一次真实 Yosys/ABC 集成 pilot 已通过。按当前并列因子规则，保留 Library
已经具备 E0 资格：F1 positive、F2 positive、F3 mixed。下一项必须取得的事实，是一条由 Harness
持有、带 Ledger、CodeRecord 和 refusal 证据的 test Campaign。随后 PACK-08 还需要 matched E0
observation，以及 Harness 从已测试目录生成的 release seal。
