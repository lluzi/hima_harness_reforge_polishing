# 标准单元 pin accessibility：学术量化与建模证据包

日期：2026-09-29。范围：公开、可直接打开的一手作者论文、作者实验室论文页和工具源码/文档；不运行 EDA，不主张任何本地 Library 已通过 pin-access 资格认定。本文补充 [pin-accessibility-contract.md](pin-accessibility-contract.md)，不是产品规格或工业 PAC 的替代品。

## 可交付的结论

“一个 pin 有多少可到达点”是有用的**局部几何特征**，却不是“该 cell 在任意相邻 cell、放置相位、网表和 router 下都可布通”的证明。文献中最强的升级路径是：

1. 由真实 LEF/GDS 几何、track、via、cut/EOL 和 blockage 生成候选 AP/hit point；
2. 在一个 cell 内或相邻 instance cluster 中选择**同时**合法的 access pattern；
3. 把实际 placement、orientation、track offset 和 router 规则带入后，观察 DRC-clean AP 覆盖与详细布线结果；
4. 用特定工艺、库、router、benchmark 的 post-route DRC/runtime/WL 验证相关性。

所以 Library Insight 的合理研究输出是带输入版本和规则版本的 `local-AP`、`joint-pattern`、`placement-context` 与 `router-label` 四层证据；不应由 Liberty 或一个全库分数批准 cell、替代 foundry/route sign-off，或把论文中一个 node 的结果外推到目标库。

## 术语和量纲：不要混用的四类量

| 量 | 它回答的问题 | 最小输入 | 不能回答的问题 |
| --- | --- | --- | --- |
| AP / hit point 数 | 单一 pin 有多少候选连接位置？ | pin shape、routing track、via/planar rule、blockage | 其他 pin 同时使用后还剩多少；邻居或整网是否可路由 |
| RPA / IOC | 在给定邻接干扰模型中，一个 pin/cell 的候选点是否可能被邻近点消耗？ | AP、同 track 邻点、干扰距离 | 任意 DRC、真实 router 的模式选择、全局拥塞 |
| VHP / VHPC | 一个 cell 的单点或“每 pin 一次”的组合有多少 DRC-clean 选择？ | cell 几何、track、方向、完整指定 DRC | 相邻 cell、placement phase、net demand 和全局路线 |
| instance/cluster access pattern | 当前 placement 中相邻 instance 是否能同时得到 DRC-clean 入口？ | placement/orientation/offset、LEF/DEF、router DRC | 后续全网是否绕行成功、timing/IR/制造 sign-off |

## 核心证据包

### A. Seo et al. DAC 2017：RPA 和 IOC 是带干扰模型的局部代理

**来源。** Jaewoo Seo, Jinwook Jung, Sangmin Kim, Youngsoo Shin, [*Pin Accessibility-Driven Cell Layout Redesign and Placement Optimization*（DAC 2017，可读原论文镜像）](https://picture.iczhiku.com/resource/ieee/wyKSlfpQpIaaRxvm.pdf)，DOI [10.1145/3061639.3062302](https://doi.org/10.1145/3061639.3062302)。KAIST 的[论文记录](https://pure.kaist.ac.kr/en/publications/pin-accessibility-driven-cell-layout-redesign-and-placement-optim/)也确认作者、会期和摘要中的 12 个测试电路数字。

**原始定义。** 假设 I/O pin 在 M1，M2 水平 track 访问。对 via 宽度 `w`、最小 via overlap `o`、最小 line-end spacing `s`，干扰距离为

`d_int = w + 2o + s`。

pin `p` 的 AP 集合为 `A(p)`；`N(a_i)` 是与 `a_i` 同一 routing track、属于另一 pin 且距它不超过 `d_int` 的 AP。论文定义：

`UPA(p) = Σ_(a_i∈A(p)) Σ_(a_j∈N(a_i)) 1 / |A(p(a_j))|`

`RPA(p) = |A(p)| − UPA(p)`

`IOC(c) = Σ_(p∈P(c)) min(RPA(p) − 1, 0)`。

作者把 `RPA < 1` 定义为该 pin “不太可能”成功访问；`IOC` 是负值缺口的 cell-level 累积，不是概率，也不是 DRC 数。原文同时给出反例：每 pin `RPA ≥ 1` 的 cell 在 abut 后仍可能被边界邻居降低 RPA。因此它适合筛查、空白注入和候选替换，不能当作单 cell 的充分证明。

**实验证据和条件。** 12 个 OpenCores/ITC'99 电路，工业 28nm library，规则调整为 14nm；360 个 cell 中 56 个重设计。允许 cell substitution 后，平均 31% instances 替为容易访问版本、平均 cell area +4%，论文报告 detailed-routing errors -82%、routing runtime -72%、total routed WL -0.98%。这是该库/规则/商业 P&R 条件下的实验结果；不能解释为“RPA/IOC 在所有库中有 82% 效果”。仅 whitespace redistribution 时的对应均值为 errors -48%、runtime -30%、WL +0.42%。

### B. Ye et al. GLSVLSI 2015：Pin Access Value 是 pin-pair 可用 track 的启发式

**来源。** Wei Ye, Bei Yu, Yong-Chan Ban, Lars Liebmann, David Z. Pan, [*Standard Cell Layout Regularity and Pin Access Optimization Considering Middle-of-Line*（GLSVLSI 2015，作者实验室 PDF）](https://www.cerc.utexas.edu/utda/publications/C174.pdf)；UT Austin [publication record](https://www.cerc.utexas.edu/utda/publications/publications.html)列出同一题目和会议。

**原始公式。** 对 I/O pin pair `(i,j)`，`h_i`/`h_j` 是各 pin 可用 routing-track 数，`o(i,j)` 是两 pin 同时重叠的垂直 track 数，`α` 是 overlap 惩罚权重：

`p(i,j) = h_i + h_j − α·o(i,j)`

若 cell 有 `m` 个 pin，则总 Pin Access Value：

`PA = Σ_(i=1)^m Σ_(j>i)^m p(i,j)`。

其含义是长 pin 带来更多 Via-1 位置、而 pin overlap 限制 M2 access；如果 track 被 M2 intra-cell wire 占据，`h` 减一。该论文的 `PA` 是 pairwise、加权且依赖 `α` 的 layout-objective，**不是**每 pin 的合法 AP 个数，更不是全 cell 同时可选组合数。

**条件/限制。** 方法面向带 MOL 的规则化布局，采用 M1 横向、poly/M2 纵向、gridded DRC/10nm parameter setting 的 ILP/hybrid 优化。它证明该 score 可引导布局生成；没有用多个真实 placement/orientation/routers 校准 `α`，也没有把 `PA` 解释为 post-route DRC probability。

### C. Xu et al. SPIE 2016：从单点计数升级为 DRC-clean 的组合计数

**来源。** Xiaoqing Xu, Brian Cline, Greg Yeric, David Z. Pan, [*Standard Cell Pin Access and Physical Design in Advanced Lithography*（SPIE 2016，作者 PDF）](https://www.cerc.utexas.edu/utda/publications/C187.pdf)；UT Austin 的[论文目录](https://www.cerc.utexas.edu/utda/publications/publications.html)给出作者、会议和日期。

**模型。** hit point 是预定 M2 routing track 与 I/O pin shape 的 overlap；hit-point combination 是“cell 中每个 I/O pin 恰被访问一次”的带 left/right access-direction 集合；只有该组合产生零 DRC 才是 `VHPC`，在任一 VHPC 中可双向访问的 hit point 是 `VHP`。因此 `#VHP` 是候选单点余量，`#VHPC` 才开始表达 cell 内同步可行性；两者均高表示更多详细布线弹性，仍不含相邻 instance 和 net-level demand。

**条件/数字。** PICO 在约 700-cell ARM 10nm PTM library 上，以 10nm 参数、CBC LP/MILP 运行；论文称相对 DRC 基线，多数 cell 的 `VHPC` 提升至少 10×，超过 25% cell 的 `VHP` 提升至少 30%，大多数 cell 完成优化在 500 s 内。详细布线则用 OpenSPARC T1，Nangate 45nm 修改并缩放来代表 10nm+ pin access，以 DC + Encounter placement 和 SADP router 比较；`LPAP+GPAP+RNR` 的可路由 net 比例平均约 +10%，代价是略高 WL/via。该两段实验不是同一个真实生产库，也不是 sign-off correlation。

**关键反证。** 论文明确说 pin-area cost 无法代表 1D-routing 下 hit-point/available-track 的关键性，并把 M2/V1 intra-cell blockage 如何纳入 placement cost 留为问题。这直接反驳“pin area 或 pin density 足够”的产品假设。

### D. Kahng, Wang, Xu DAC 2020：instance/cluster 级 access pattern

**来源。** Andrew B. Kahng, Lutong Wang, Bangqi Xu, [*The Tao of PAO: Anatomy of a Pin Access Oracle for Detailed Routing*（DAC 2020，UCSD 作者 PDF）](https://vlsicad.ucsd.edu/Publications/Conferences/377/c377.pdf)，DOI [10.1109/DAC18072.2020.9218532](https://doi.org/10.1109/DAC18072.2020.9218532)。

**模型与意义。** PAAF 生成 unique-instance 的 AP（planar/via、on-track/off-track），再以动态规划生成 intra-cell、design-rule/boundary-conflict-aware access patterns，并对 standard-cell instance cluster 选择 pattern。此处“可访问”已经依赖 cell 的 placement、orientation、track alignment 和邻居边界，不再只是 cell master 的静态属性。论文报告：面对最多 790K instance pins，single-thread pin-access analysis 少于一分钟；集成 TritonRoute 后，ISPD-2018 基准最终仅 2 DRC，而比较的 Dr. CU 2.0 为 755 DRC，且无残留 pin-access 问题。

**边界。** 这是官方 ISPD-2018 contest benchmark 上的学术 router 对比，非商业 foundry sign-off，也不能把“2 total DRC”转换为某库任何 placement 都可访问。论文自己批评早期 hit-point 枚举的 runtime 和 1D-gridded/distance-cost 假设，支持 Library Insight 保留原始 AP、pattern 和 context，而非只存一个分数。

### E. TritonRoute 与当前 OpenROAD：router 的 `min_access_points` 是门槛，不是质量证明

**来源。** Kahng, Wang, Xu, [*TritonRoute: The Open Source Detailed Router*（作者 PDF，TCAD 2021）](https://vlsicad.ucsd.edu/Publications/Journals/j133.pdf)；[OpenROAD `drt` 当前文档](https://openroad.readthedocs.io/en/latest/main/src/drt/README.html)和[源码仓库](https://github.com/The-OpenROAD-Project/OpenROAD/tree/master/src/drt)。

**证据。** TritonRoute 的公开 benchmark 含 45nm/32nm、10 tests、最多 290K standard cells/182K nets，并包括 off-track pin access、macro/power blockage；论文说明完整 DRC 还含 spacing/EOL/min-area/cut spacing。当前 `pin_access` 接口的 `-min_access_points` 明确定义为“每 pin 最小 AP 数”，而 `via_in_pin_*` 和 access-layer 参数改变合法 AP 集。因而阈值是可配置 acceptance screen，不能脱离 tech/route configuration 与 router version 解释。

**数字的正确读法。** 论文报告相对已发表学术 router best-known：平均 WL -0.4%、via -9.3%、DRC -92.0%；7/10 test <20 DRC。它证明 AP analysis 必须与路由模型一起评估，并不测量标准单元 library 的固有“pin access 分数”。

### F. Kahng et al. TCAD 2022：同密度、不同 track offset 可有不同可访问性

**来源。** Andrew B. Kahng, Jian Kuang, Wen-Hao Liu, Bangqi Xu, [*In-Route Pin Access-Driven Placement Refinement for Improved Detailed Routing Convergence*（作者 PDF）](https://vlsicad.ucsd.edu/Publications/Journals/j135.pdf)，DOI [10.1109/TCAD.2021.3066528](https://doi.org/10.1109/TCAD.2021.3066528)。

**结果和限制。** 两个 placement 可有相同 cell/pin density，却因 pin shape 对 routing track 的相对 offset 而有不同 on-grid AP；作者因此采用 router 理解的精确 pin access 与邻近-instance interaction，而不是 density model。19 个 industry designs/多 advanced nodes 上，接入一个领先商业 P&R 后，详细路由 runtime 最多 -31.82%（平均 -15.06%），initial detailed-route DRC 最多 -10.13%，论文声称无 timing degradation。工具、nodes、designs 未公开到可复现实验；这是“placement context 必须入模”的强案例，不能用作公开库之间的效果承诺。

### G. Lee et al. ASP-DAC 2020：SMT/OMT synthesis 把 pin allocation 放入 place-and-route 求解

**来源。** Daeyeal Lee et al., [*SP&R: Simultaneous Placement and Routing framework for standard cell synthesis in sub-7nm*（ASP-DAC 2020）](https://ieeexplore.ieee.org/document/9045729/)，DOI [10.1109/ASP-DAC47756.2020.9045729](https://doi.org/10.1109/ASP-DAC47756.2020.9045729)。

SP&R 的关键不是新的通用 access 分数，而是动态 pin allocation 与 simultaneous P&R 的 OMT formulation：把 pin access 作为布局可行性/优化决策的一部分。作者报告在面向 sub-7nm 的 practical cells 上，较顺序方法平均 metal length -10.5%。公开摘要不足以复原全部 constraint、库、DRC、AP-count 或 router benchmark，因此只能作为“把 joint access 约束写入 synthesis”的方法证据，不能把该数字用于有效性比较。

## 对 Library Insight 的可证伪建模建议（本文件的综合，不是任何论文原话）

建立三个不相互替代的候选输出，并让后两层明确依赖输入身份：

| 输出 | 推荐字段 | 最廉价反证 |
| --- | --- | --- |
| `local_access` | pin/layer、candidate AP coordinate/type、planar/via、哪条 rule/obstruction 拒绝、`#AP` | 同一几何由 reference DRC/router 给出不同合法 AP |
| `joint_access` | cell 或 neighbor-pair/orientation/relative-offset，pattern identity，`#VHP/#VHPC` 或 exact legal patterns，所用 rules | 单点数足够但 no legal simultaneous pattern |
| `placement_router_label` | DEF/LEF/tech/router version、placement/orientation/track offset、failed pin、DRC category、post-route result | 换 router/config 或 placement phase 后 ranking/label 改变 |

把 RPA/IOC、PA、AP count 作为可解释特征和有条件的排序特征；只有在固定 Library、tech rules、placement generation、router version、benchmark split 下，以 post-route label 校准 precision/recall、rank correlation 和 false-negative cost 后，才可升级为该条件下的决策规则。任何 learned predictor 也应把上述 identity、training split、label producer 和 OOD/unknown 状态保存；本学术分支未取得足以进行跨方法量化比较的完整深度学习论文实验；主报告后续补充了可完整审阅的 ISPD 2020 作者报告与 Cell-Flex 报告，见工业与近年方法证据包。仍不据此比较预测精度。

## 检索协议、可达性与停止理由

| Lane | 查询 | 纳入 / 排除 | 停止理由 |
| --- | --- | --- | --- |
| RPA/IOC | `standard cell pin access RPA pin access driven cell layout redesign PDF` | 2017 原论文镜像 + KAIST 元数据；排除只有二次转述的网页 | 有原公式、工艺/benchmark、post-route 结果和明确边界 |
| PA/MOL | `Pin Access Value standard cell layout regularity Ye GLSVLSI 2015 PDF` | Ye 论文检索全文 + UT Austin publication index；最终链接使用 UT C174.pdf | 有原公式与特定 MOL assumptions；继续搜索不改变其为 heuristic 的判断 |
| valid combinations | `Standard Cell Pin Access Physical Design Advanced Lithography PICO PDF` | ARM/UT Austin 作者 PDF | 有 VHP/VHPC 定义、实验库和 router benchmark，足够区分 AP 与 joint choice |
| router patterns | `The Tao of PAO PDF Kahng Wang Xu`、`TritonRoute pin access patterns` | UCSD 作者 PDF、OpenROAD source/docs | 有 instance/cluster algorithm 和可复核公开 command semantics |
| contextual placement | `In-Route Pin Access-Driven Placement Refinement PDF` | UCSD 作者 PDF | 直接反例证明 density 不足；商业 designs 的不可公开性已记录 |
| synthesis / learning | `pin accessibility prediction deep learning`、`SMT standard cell synthesis pin accessibility` | IEEE SP&R abstract；排除无可访问全文的 ML 数字 | 已得到 synthesis 机制；ML 缺可审阅完整原始结果，不把摘要宣传升级成量化事实 |

研究子任务读取并语义核对了 Seo 原论文镜像、Xu/PAO 等作者 PDF、大学目录、IEEE metadata 和 OpenROAD 文档；Ye 原链接检索文本可读但直接打开失败，最终改用 UT 作者实验室地址。根任务复查时部分 URL 失败，具体访问渠道与自动检查结果见 verification 和 link-check 文件。链接可达性不等于论文结果的适用性。研究到此停止：下一步会改变产品判断的不是更宽泛的论文清单，而是对一个具体目标 PDK/Library 在固定 router + placement stress matrix 上建立可回放的 `local → joint → post-route` 标签；该工作需明确授权和合格 Site 输入。

## 未解决的决定性缺口

1. 未取得目标 foundry rule deck、LEF/GDS、router/PAC 配置或工业 benchmark，故没有目标库的 AP/VHPC/RPA 数字。
2. 论文的 14/10nm predictive/scaled rules、contest 32/45nm 和未公开 commercial nodes 不可互相归一；不能构成 3nm/2nm 工艺主张。
3. RPA 的 `d_int`、PA 的 `α`、router 的 `min_access_points` 都是规则/工具条件参数，必须随 run identity 存档，不能作为全局常量。
4. 主报告新增公开 ML 作者报告后，已能说明 CNN/主动学习方法及一个迁移失败案例；仍不足以统一比较不同模型的泛化或总成本。先实施可解释基线是研究次序建议，而非已验证的性能结论。
