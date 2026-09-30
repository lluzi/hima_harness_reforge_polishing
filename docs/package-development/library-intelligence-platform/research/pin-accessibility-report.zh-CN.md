# Standard cell pin accessibility 分析与建模调研

日期：2026-09-29。用途：为 Library Insight 增加物理可接入性分析提供研究依据。本文讨论公开方法、适用条件与候选研究路线；尚未对目标库运行评估，也不是已实现功能或产品验收记录。

后续模型定义见[基于 LEF 几何的 pin access 概率模型](pin-access-probability-model.zh-CN.md)：在真实 P&R 验证条件具备前，先对声明的环境分布计算可行概率，未来分别校准物理规则、环境分布与算法成功率。

**Pin accessibility 值得成为 Library Insight 的独立分析能力，但必须补充物理视图。** Liberty 可以提供逻辑功能、pin 名称和电气特性，无法单独确定引脚几何、routing track、via 及邻近障碍，所以不能从 `.lib` 判定实际可接入性。最有价值的输出是：哪个 pin 在什么规则和环境下难以接入、原因是什么、有哪些可验证的改善方案，以及这种局部风险是否真正影响设计布线。

公开研究支持三个判断：第一，单 pin 有接入点，不等于所有 pin 可以同时接入；第二，同一 cell 在不同邻居、朝向和轨道相位下会有不同表现；第三，局部指标、机器学习预测与完整布线结果应分别展示。Cell-Flex 等近年研究进一步把 PDN 和可穿越布线资源纳入评价。本文据此建议先建立几何与规则基线，再做上下文评估，最后用真实布线标签校准预测模型。该建议是本文的工程综合判断，不是已测量的成本优势。

## 问题究竟发生在哪里

路由器最终需要把一条网络连接到标准单元的金属 pin。一个 access point（AP）通常不仅意味着一个坐标，还隐含允许的进入方向、金属层、via 类型，以及相应的短接入线段。不同论文和工具对 AP 的计数粒度不同：有的按轨道与 pin 的交点计数，有的进一步检查 via、延伸段和 DRC。

应区分四个层次：

| 层次 | 要回答的问题 | 典型失败 |
| --- | --- | --- |
| 单 pin 接入 | 是否至少存在一个满足已建模规则的连接方案？ | via enclosure 放不下；cut spacing 或 EOL 冲突 |
| 单 cell 同时接入 | 能否为所有需要连接的 pin 同时选择方案？ | A、B 各自有合法 AP，但选中的 vias 或接入线段互相冲突 |
| 放置上下文接入 | 邻居、朝向、轨道相位及 PDN 加入后是否仍可行？ | 单独检查通过，紧贴另一个 cell 后边界入口被阻塞 |
| 网络及设计可布通 | 接入后能否连接到其他端点并满足设计目标？ | 局部入口存在，但外围拥塞、层分配或网络绕行导致失败 |

这些层次来自有效接入组合研究和实例级 pin-access routing 方法的综合。[Xu 等，SPIE 2016](https://www.cerc.utexas.edu/utda/publications/C187.pdf)；[Kahng 等，DAC 2020 PAO](https://vlsicad.ucsd.edu/Publications/Conferences/377/c377.pdf)

一个说明性反例：假设 A、B 各有两个合法 AP，但 A 的任一方案都会与 B 的任一方案形成 via 间距冲突。单 pin 的计数都是 2，整个 cell 的同时可行组合却为 0。这是逻辑示例，不是某个实测库的数据。它说明平均 AP 数不能代替联合可行性。

**原始 cell DRC-clean 也不能直接证明外部可接入。** 外部布线新加入的 via 和金属段，可能与单元内部形状或邻居产生原版图中不存在的违例。GLOBALFOUNDRIES 的 PAC 工作正是通过生成拼接测试结构、布线后检查来暴露这类问题。[Li 等，SNUG 2017](https://arxiv.org/pdf/1805.10012)

## 为什么先进工艺更敏感

困难来自具体的 cell 和互连架构，而不能只用“几纳米”概括。

- **更低的 cell height 与更少的 routing tracks。** 逻辑仍要暴露多个端口，可供进入和穿越的轨道却减少；缩小 cell footprint 可能换来更困难的 block-level routing。多输入复杂门尤其需要关注。[Seo 等，DAC 2017](https://pure.kaist.ac.kr/en/publications/pin-accessibility-driven-cell-layout-redesign-and-placement-optim/)；[Cell-Flex，ISPD 2025](https://www.sigda.org/publications/ispd-25-toc/)
- **可制造性规则约束了接入方向和形状。** 单向布线、via/cut spacing、enclosure、EOL、minimum area，以及特定工艺的 patterning 规则，会让一个几何交点失去实际用途。旧式“pin 更长或面积更大就更好”的判断不充分。[Ye 等，GLSVLSI 2015](https://www.cerc.utexas.edu/utda/publications/C174.pdf)
- **轨道与放置网格不一定具有相同节距。** 同一 master 移动位置后，pin 与 routing track 的对齐关系可变化；相同 cell density / pin density 也能产生不同接入表现。[Kahng 等，TCAD 2022](https://vlsicad.ucsd.edu/Publications/Journals/j135.pdf)
- **电源与信号共享或重新分配局部资源。** 传统前侧 PDN 占用信号路由空间；背面供电可能释放资源，也可被用于继续压缩 cell height。因此它可能缓解一部分问题，却不会自动消除信号 pin 间的局部冲突。具体收益必须重新测量。[imec 背面供电说明](https://www.imec-int.com/en/articles/how-power-chips-backside)

产业仍在为最新节点投入 pin-access 方法。Synopsys 于 **2025-09-24** 公布，其 pattern-based pin access 方法针对 TSMC A16 做了增强；公开公告未提供算法细节或可复现收益数字。[Synopsys 官方公告](https://investor.synopsys.com/news/news-details/2025/Synopsys-Collaborates-with-TSMC-to-Drive-the-Next-Wave-of-AI-and-Multi-Die-Innovation/default.aspx)

对 PPA 的影响路径是：接入受限可能迫使更大 cell spacing、更低 placement utilization、替换 cell、增加绕行或 vias，以及更多 search-and-repair。由此产生面积、延迟、功耗和运行时间代价；各项变化方向与大小依赖实际设计。**单元面积最小，不保证布通后的 block 面积最小。**

## 量化方法与建模路线

| 方法 | 核心量或操作 | 优点 | 主要盲点 |
| --- | --- | --- | --- |
| 几何 AP 计数 | pin 与轨道交点；逐候选检查 via/短线段与障碍 | 易解释，能定位 pin 和失败规则 | 候选点如何定义影响结果；单点合法不保证共同可用 |
| Pin Access Value | 可用轨道收益减去 pin-pair 重叠惩罚 | 适合早期版图优化目标 | 启发式权重、层方向和架构依赖；不等同 DRC 证明 |
| RPA / IOC | 候选 AP 减去邻近 pin 的竞争估计，累积不足项 | 快速比较困难 pin、cell 和布局候选 | 干扰与概率假设有限；分数不能当真实失败概率 |
| VHP / VHPC、access patterns | 枚举或搜索每 pin 一个入口的合法组合 | 直接暴露“各自可接但不能同时接”的问题 | 组合数增长；有限模式搜索不等于完整枚举 |
| Cell-Flex | 接入场景、PDN 下的放置自由度、可穿越轨道与 via 资源 | 把 cell 对 block 的影响考虑得更完整 | 依赖具体 PDN、规则、网格和评价流程 |
| PAC / stress routing | 对 cell 拼接、朝向和网络构造运行实际 router | 发现真实工具条件下的接入失败 | 算力开销及测试分布依赖；未触发不等于普遍无问题 |
| CNN / GNN / KAN 等预测 | 从 pin pattern、邻近图或 Cell-Flex 特征预测 DRV | 推断可用于早期筛查及样本选择 | 训练标签昂贵；迁移、类别不平衡、数据泄漏与过度约束 |
| SMT / CP / MILP 约束建模 | 在 cell 生成时约束 pin 分配、opening、spacing 与内部 routing | 将评价转成候选版图优化 | 满足所编码约束不等于覆盖所有 foundry 规则及 block 环境 |

下面给出这些方法最有代表性的原始定义和实际含义。

### AP 与 Pin Access Value

为了跨工具比较，建议把每个候选记录成 `(pin, x, y, layer, direction, via, access_segment)`，同时单独统计唯一坐标数和合法方案数。这是本文建议的数据表达：一个坐标上有三种 via，不能未经说明就算作三个独立冗余入口。

Ye 等 2015 年的 Pin Access Value 对 pin pair 使用：

`p(i,j) = h_i + h_j − α · o(i,j)`

其中 `h` 表示可用 routing-track 数，`o` 是两个 pin 的轨道重叠数，`α` 是惩罚权重；cell 的 PA 对所有 pin pair 求和。它把更多轨道机会与相互遮挡一起考虑，适合指定 MOL/层方向条件下的版图生成。它不是“通过完整 DRC 的 AP 总数”。[原论文](https://www.cerc.utexas.edu/utda/publications/C174.pdf)

### RPA 和 IOC

Seo 等 2017 年的 Remaining Pin Access 可概括为：

`RPA(pin) = AP 数 − 邻近 pin 导致的不可用接入估计`

其 UPA 计算对同一 track、干扰距离内的其他 pin 候选点按该 pin 的 AP 数倒数加权。cell 的 IOC 定义为 `Σ min(RPA(pin) − 1, 0)`，即累积低于一份接入余量的负缺口。它是一个竞争代理，不是实测余量或失败概率。原方法用于 cell redesign、替换及 whitespace redistribution。[论文与作者机构记录](https://pure.kaist.ac.kr/en/publications/pin-accessibility-driven-cell-layout-redesign-and-placement-optim/)

对我们最有用的是“先解释谁在争夺入口，再决定候选优化”，而不是原样照搬某个分数阈值。完整原式及其特定层方向、干扰距离假设见[学术证据包](pin-accessibility-academic-evidence.md)。

### 联合可行组合和实例模式

Xu 等区分 valid hit points（VHP）与 valid hit-point combinations（VHPC）。后者要求一个 cell 中每个 I/O pin 恰好被访问一次，且该组接入不产生所检查的 DRC。其 PICO 工作说明，优化单点数量与优化可同时成立的组合是不同目标。[SPIE 2016 原文](https://www.cerc.utexas.edu/utda/publications/C187.pdf)

PAO 在此基础上考虑 unique instances、cell 内 access patterns 和相邻 instance clusters，以动态规划选择模式。它更贴近路由器的实际问题，而不限于一个孤立 cell master。[DAC 2020 原文](https://vlsicad.ucsd.edu/Publications/Conferences/377/c377.pdf)

一个可用于 Library Insight 原型的简化数学表达如下，**这是本文综合模型，不声称是上述论文的原式**：

`x[p,a] ∈ {0,1}`，表示是否为 pin `p` 选方案 `a`；

`Σ(a∈A_p) x[p,a] = 1`，要求每个目标 pin 选一个方案；

`x[p,a] + x[q,b] ≤ 1`，禁止已知互斥的方案对。

若无可行解，可以给出造成冲突的 pin 与方案集合。但成对 conflict graph 只覆盖可表示为成对约束的规则；多形状、多重 patterning 或更长接入路径，需要额外约束及完整的候选组合检查。启发式找不到解、求解超时、候选集不全与证明无解必须分别报告。

### Cell-Flex 的扩展价值

Kang 等 ISPD 2025 将 cell layout flexibility 分为 PAF、CPF、TUF。PAF 对位置 `g` 上的可行场景集合 `τ` 使用 `PAF(g) = |τ(g)|^(1/nPins)`；其中 `τ(g)` 是位置 `g` 上的可行场景集合，竖线表示集合大小。CPF 表示 PDN 条件下的放置自由度；TUF 表示可供 block routing 使用的穿越轨道和 via 位置。其场景同时考虑内部障碍和 pin 间竞争。[作者报告，PDF 第 6–9 页](https://ispd.cc/ispd2026/slides/2025/protected/11_1_slides.pdf)

该研究基于 PROBE3.0 的 4-track、2-fin 库再生成，在五个 block 上报告 13.2% 面积降低；但“有效面积”采用 **200 个 DRV** 的门槛，所以不能称为零违例签核面积改善。这个限定影响产品如何展示收益，应与数字一起保留。[同一报告，PDF 第 10–12 页](https://ispd.cc/ispd2026/slides/2025/protected/11_1_slides.pdf)

### 学习模型与主动采样

NTUST 与 Synopsys Taiwan 的 ISPD 2020 工作使用 CNN 识别局部 pin pattern，通过工业 router 对 cell abutment 生成标签，再用主动学习选择有信息量及代表性的组合。预测结果可转换为 placement spacing constraints。作者也报告了反例：使用较少库训练的 Model A 应用于使用更多库的 Design B，生成过多间距限制，导致 legalization 失败。[作者报告，PDF 第 10、13–18、24 页](https://www.ispd.cc/slides/2020/ispd20_library_based_drv_prediction.pdf)

Cell-Flex 另以 KAN 为其 DRV 预测器；这与上述 CNN 是不同研究，本文不将它们作统一精度排名。2024 年的 PGNN 则结合 pin proximity graph 的 GNN 与表示拥塞的 U-Net，并研究 transfer / incremental learning。当前读到的是作者机构摘要，足以确认方法构成，不能据此比较准确率或训练成本。[Park 等，TCAD 2024](https://khu.elsevierpure.com/en/publications/pin-accessibility-and-routing-congestion-aware-drc-hotspot-predic/)

本文建议先把 ML 用于风险排序与“下一批应该布线验证哪些组合”，不要直接把未经校准的预测变成禁止放置的硬规则。这样可以将昂贵标签预算投向高价值样本，同时保留实际工具验证。

### 从分析走向 cell 生成

SMT/OMT、constraint programming 和 MILP 方法将 pin 分配及 opening 等条件写入 cell placement/routing 求解。2026 年 CPCell 扩展预印本研究 gear ratio、offset、M0 pin extension、pin separation 和 minimum pin opening。其 DFFHQN_X1 示例中，QN/CLK/D 的未阻塞重叠轨道数从 `2/2/3` 变成 `4/7/4`；作者明确把轨道重叠数作为 proxy。[CPCell v1，VI-C 与 Table IV](https://arxiv.org/html/2603.13665v1)

这说明可以通过布局约束优化接入机会，但该稿仍为投稿预印本；表中轨道数不是完整规则认证的 AP 数，也不证明任意 block 可布通。Library Insight 初期宜解释与比较候选，自动生成新版 cell 可以作为后续独立验证课题。

## 业界怎样评估

**库开发阶段的 PAC。** GLOBALFOUNDRIES 的 SNUG 2017 研究在 Synopsys PAC 思路上构造不同 cell 拼接、连接方式及受限 routing，检查新增违例。在其 108 个单高度、9-track cell 的 library1 中，比较方法发现 3 个残留路由问题 cell，强化方法发现 14 个；运行时间从 5.6 h 增至 106 h。实验限定 M2/M3、四个 routing threads。这里衡量的是检测压力和成本，不能把更多违例理解成路由质量改善。[原文 Table 2–3](https://arxiv.org/pdf/1805.10012)

**设计实现阶段的实例级优化。** Cadence 的 Innovus 资料明确区分邻近实例的 pin-access 限制与一般 pin density，并描述实例级接入规划及 spacing 优化。公开资料没有披露可直接复刻的评分公式。[Cadence 官方 datasheet](https://login.cadence.com/content/cadence-www/global/ja_JP/home/resources/datasheets/innovus-implementation-system-ds.html)

**公开可检查的算法基线。** OpenROAD 的 TritonRoute 提供单独 `pin_access` 命令和 PA debug 标记；参数可限定 via-only access、via-in-pin enclosure 范围及最小 AP 数。可以作为复现和解释的候选工具，但必须核查它对目标 PDK 规则的支持；工具运行成功不表示 foundry signoff 通过。本文只核查了文档，没有执行命令。[OpenROAD 文档](https://openroad.readthedocs.io/en/latest/main/src/drt/README.html)

## Library Insight 需要什么输入

以下分层是本文建议，尚未检查目标库是否拥有这些输入。

| 输入 | 用途 | 缺失时可交付的边界 |
| --- | --- | --- |
| Liberty 与 cell/pin 身份映射 | 逻辑功能、drive strength、电气指标关联 | 可做电气分析；不据此判定物理 AP |
| Cell LEF 或工具物理数据库 | pin shapes、层、OBS、尺寸、site、合法朝向 | 无物理视图则不能开始几何接入分析 |
| Tech LEF、via 定义、routing grid 与适用规则 | 构造候选并判定已覆盖规则下的接入合法性 | 规则不全时只称几何 proxy，并列出未覆盖规则 |
| GDS/OASIS 与合格检查器、rule deck | 需要时检查抽象视图遗漏、详细形状及制造规则 | 不把 LEF-only 结果称为完整物理签核 |
| 邻居、row、orientation、track offset、PDN | 评估上下文、组合与放置自由度 | 可先做声明过的合成上下文，无需立即拥有完整设计 |
| Netlist、DEF、routing constraints、router 版本 | 对真实设计校准风险及后果 | 无设计时只报告库/测试场景结果，不声称实际芯片影响 |

LEF 是可实施的起点，但 AP 的合法性依赖导入的规则和抽象完整性。Liberty 多个 PVT corner 通常并不意味着不同 pin 几何；物理缓存宜按 physical master、view hash、tech/规则、grid/朝向/PDN context 建立身份，再与电气 corner 关联。这是设计建议，不能假定所有库采用相同命名或同一 physical layout。

## 建议的量化输出与验证方式

首版应提供一组可定位的结果，而不是一个无法解释的“库质量总分”：

| 粒度 | 建议结果 | 有意义的比较 |
| --- | --- | --- |
| Pin | 唯一 AP 坐标与合法方案数、方向/层分布、被拒原因 | 同功能或同 pin 在不同版图版本中的变化 |
| Cell | 零入口 pin 数、最少 AP、低分位数、联合模式是否存在 | 瓶颈 pin 与总体均值同时显示 |
| 邻接场景 | 哪些 cell pair、朝向、offset、spacing、PDN phase 失败 | 最坏场景、覆盖率与采样分布 |
| Library | 风险 cell 排名、规则原因分类、变更回归 | 区分每种 cell 等权和按设计使用频率加权 |
| Design | pin-access 相关违例、未连通情况、修复时间及 PPA | 同一网表、约束和工具下比较候选；归因与总 DRV 分开 |

对于确定性模型，先校核候选位置、via enclosure、层方向、邻居冲突等可观察结果。对于 ML，除 precision/recall、F1、PR-AUC 之外，应检查概率校准、漏报代价和域外输入；按 design、cell family、library revision 分组切分，防止同一拼接结构或近重复 cell 同时进入训练与测试。跨工艺迁移需单独验证，不能用随机 tile split 的高分代替。

如果定义场景失败率 `R(c) = Σ w_s · 1[场景 s 失败]`，必须同时公开场景集合、权重与覆盖情况。它首先是**测试分布下的失败频率**；只有测试分布与实际放置/布线环境匹配且经过校准，才可能解释为生产风险。求解超时和规则缺失要统计为未知，不能并入通过。

## 可以选择的下一步

| 路线 | 前提与价值 | 成本和失败条件 | 本文判断 |
| --- | --- | --- | --- |
| 几何与规则基线 | 一套可公开或获准使用的物理库、tech/via 定义；解释 AP 与瓶颈 pin | 需对齐参考工具和规则覆盖；若只能算 bbox/面积，不能标为真实 accessibility | 最适合第一步 |
| 上下文压力评估 | 基线可复核；选择少量困难 cell 与邻居/朝向/offset 组合 | 场景爆炸、router runtime、违例归因；要记录采样和未覆盖情况 | 第二步，用于建立有代表性的标签 |
| 学习预测与主动采样 | 固定标签生产流程、足够正负例与独立留出集 | 数据分布改变、误报导致过度 spacing、模型成本大于筛查收益 | 有标签后再做；先用于排序和采样 |
| 自动版图优化 | 合格版图输入、物理规则、电气回归与设计验证 | 优化 AP 可能损害 timing、power、面积或其他 routing 资源 | 研究扩展，不纳入基本接入分析的隐式范围 |

第一轮可证伪实验建议选一个 buffer、一个多输入复杂门、一个 sequential cell，以及一个孤立可接但邻接后变差的对照。具体 cell 必须从真实输入核查后选定，不能预先宣称某类一定较差。通过条件是结果可回放、能够解释参考工具中的至少一个接入失败，并能发现“AP 较多但联合模式更差”的反例；如果结果只与 pin 面积相关，或无法区分规则缺失与通过，应先修正模型。

在 HimaHarness 中，这些分析可以进入现有 Library 分析的健康风险、竞争力和设计影响三个任务，复用 Data Insight、Site 执行与证据记录。这个方向与 [ADR-0012](../../../adr/0012-library-intelligence-has-three-user-analysis-surfaces.md)、[ADR-0013](../../../adr/0013-campaign-and-data-insight-are-peer-workbench-modes.md) 一致；具体代码接口、物理 adapter 和 Pack 改动仍需后续源码核查。

## 研究边界与来源

本轮没有获得目标 foundry 的规则、Liberty/LEF/GDS 对应关系、商业 PAC 接口和真实设计标签。因此尚不能决定某一个库的阈值、声称现有 Liberty API 支持几何接入分析，或估算我们的实际运行时间。公共 predictive PDK、缩放库、竞赛 benchmark 与生产节点证据没有混为一类。新论文的 proxy、vendor capability statement 与实测结果也分别标注。

研究停止在“能够比较方法并选择下一轮验证”这一层。继续扩大论文清单已不太可能改变上述判断；下一项决定性证据将来自一套指定物理库及参考工具。

- [研究问题、假设与检索计划](pin-accessibility-contract.md)
- [学术方法、原式与实验条件](pin-accessibility-academic-evidence.md)
- [工业流程、近年方法和反例来源](pin-accessibility-industry-evidence.md)
- [检索、链接与语义核查记录](pin-accessibility-verification.md)
