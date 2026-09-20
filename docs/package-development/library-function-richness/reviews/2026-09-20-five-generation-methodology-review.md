# Trial.13 五代 Custom Cell Fmax Campaign 方法学评审

日期：2026-09-20。范围：`aes_cipher_top`，Pack 5.1.8，Run `run-edb6a836-fd25-41bc-ba08-dea95026e52b`，Campaign `custom-cell-fmax-dtco-20260919-140208-21e5`。本评审仅新增本文，未改代码、测试、Pack 资产、trial 工件或 Git 状态，未启动模型调用或 EDA 作业，未 commit。本次按关键复核角色委派；具体模型/Effort 以主任务委派记录为准，本文未独立读取运行配置。验证为本地只读源码、JSON/SPICE/Liberty/时序报告分析，以及在内存中执行已检查的纯候选函数；不等同于产品测试或新商业实验。

## 1. 结论与证据强度

**四轮有效商业比较都没有正 Fmax 收益；第五代完成了研究和表征，但未进入商业比较。研究循环的执行机制已成立，商业反馈驱动的策略自我改进没有成立。** 这两件事必须分别验收。

本次发现了比“模型不够聪明”更具体、可低成本反证的问题：

1. **三代使用完全相同的候选程序，第四代的“反馈项”读取不存在的字段，第五代的评分字段全部不匹配实际 schema。** 第五代离线重放直接退化为 61 个候选中的前 40 个；商业反馈不影响该排序。给 onsite-inspiration 换标签、增加 lens 数、引用 hash 不能证明学习。
2. **请求中的 D4 没有落实为真实驱动实现。** 五代全部 200 个请求声明 `drive_strengths=['D4']`，但生成任务和 bool2cmos 命令没有传递驱动参数；留存 SPICE 的所有 PMOS/NMOS 宽度分别固定为 0.34/0.28 µm。不存在供工具选择的 D1/D2/D4/D8 family。单纯扩大函数数量不能解决弱输出级、深 stack 或不合理晶体管拓扑。
3. **实际使用的是 learned HGB-v2 NLDM，不是每个候选都相对原 cover 快 5%/10% 的 Mock。** 旧 `relative_mock_timing.py` 存在于仓库，不代表 Campaign 调用了它。当前表征没有针对新拓扑、真实工作 slew/load 和完整被替换 cover 的误差/盈亏平衡校准。
4. **40–50 ps 本身不能证明 Liberty 系统性过度悲观。** 实际拓扑包含 18–28 个晶体管、3–4 层 series stack，40 ps 在现有表格的正常插值区间内可直接重算，未发现 1000 倍单位错误。它可能是弱而复杂实现的合理代价，也可能含预测偏差；没有这些新 Cell 的独立 SPICE 表征，不能区分两者，更不能证明“修快 Mock 就能到 +5%”。
5. **全局路径迁移和 clock/CQ/setup 响应实质存在。** 第一代最差路径无 Custom Cell；四代 generated 与 foundry 前 50 条 reg2reg 的起终点对重合仅 3/8/0/1。第三、四代逻辑级数下降，最差路径群的总 Cell delay 仍基本不降，且 CQ/setup 增大。只盯两个 XS arc 会漏掉相当部分问题。

应暂停把“再生成 40 个新函数并跑完整 P&R”作为默认研究增量，先完成本报告的 Liberty/实现校准和反馈语义切片。**并非建议人为缩短 Liberty 延迟，也不是恢复未校准 proxy 对 Action 的 QoR 否决权。** 必须先识别真实 Cell 是否可实现、模型是否可信，以及研究程序究竟在使用什么证据。

## 2. 证据边界、身份与可复核位置

主要本地证据根目录：

- `R = .hima-tmp/trial13-methodology-review/`：本次由主任务只读导出的 Site 原始工件，本评审只读消费。
- `T = .hima-tmp/ui-trial-0.3.0-trial.13/`：原始 `Agent Trial Report.md`、本地 Ledger、安装 Pack。
- `P = packs/custom-cell-fmax-dtco/`：当前源码。下列关键文件与 T 中 5.1.8 安装副本逐字节一致：`flow/stages.py`、`ai_research_runner.py`、`domain/predict.py`、`charlib_emit.py`、`features.py`、`_generation_projection.py`。当前 checkout HEAD 为 `d0a89dca816d4852134486eeca4289e56f99bd5f`；不把后续 5.1.9 capacity 修复当成 trial.13 当时行为。

证据等级：

- **商业事实**：留存的 DC/Innovus 输出及按代 compare/adoption 记录。本地未重新恢复数据库、未重跑 EDA；matched 身份是所保留 Reader/记录的结论。
- **模型事实**：实际 `.sp`、generated `.lib`、prediction JSON 和对应源代码；证明工具被提供了什么，不证明硅上准确性。
- **可重复诊断**：本次只读解析、统计和纯函数重放；明确样本范围与四舍五入误差。
- **Agent 解释**：研究程序、lens 问题和 trial 叙述；必须与前述事实分开。
- **历史对照**：9 月 16 日 fresh-50 等文档，只支持替代解释和方法教训，不能冒充这五代的实测。

本次并未获得模型训练/holdout 全量原件、参考 CDL/完整 foundry Liberty 与新 Cell 的 SPICE 测量标签；无法独立证明预测误差的符号、精确 PVT 适配、foundry 同功能同负载 arc 的优势或硅上收益。前 50 条报告没有逐 arc slew/load 字段，因此下面的 20 ps/3 fF 是声明的诊断坐标，不是声称已恢复真实路径工作点。

## 3. 实验重建：四次比较与一次容量阻断

唯一设计变量是新增 Custom Library 对映射及其后续物理实现的影响；约束目标 period 0.5 ns，matched post-route derived Fmax 至少 +5%。声明预算 720 分钟、8 代、每轮不超过 50 个新 Cell；实际研究每代选 40。每代执行 baseline/free miners → function/local pool → Agent 候选程序 → merge → Boolean/SPICE → abstract LEF → learned Liberty → cumulative mapping/freeze → LC/DC/Innovus → compare/feedback。后代 miners 可读最新有效 generated post-route 网表和时序，并排除 cumulative 已有 function identity，故输入池确实变化。

| 代 | 新请求 / 冻结累计 | 单输出 / 多输出请求 | DC adopted masters / instances | route XS instances | WNS ns | TNS ns | setup violating paths | Fmax MHz / 相对收益 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Foundry | 0 | — | — | 0 | -0.064 | 本次导出未取到 summary | — | 1773.050 / 基准 |
| 1 | 40 / 40 | 12 / 28 | 5 / 150 | 78 | -0.065 | -9.798 | 318 | 1769.912 / -0.177% |
| 2 | 40 / 80 | 9 / 31 | 14 / 507 | 260 | -0.083 | -11.466 | 341 | 1715.266 / -3.259% |
| 3 | 40 / 120 | 0 / 40 | 20 / 539 | 272 | -0.070 | -9.591 | 322 | 1754.386 / -1.053% |
| 4 | 40 / 160 | 8 / 32 | 20 / 514 | 260 | -0.074 | -9.834 | 317 | 1742.160 / -1.742% |
| 5 | 40 / 未冻结 | 7 / 33 | 未执行 | 未执行 | 未测 | 未测 | 未测 | 未测 |

DC 的 adoption 与 compare 中 final-database 的 route census 不是同一个数；不能混称 78/260/272/260 为 DC adoption。第 1 代 28 个 MO 请求无一个被 DC 采用；第 2–4 代累计 MO 的 DC instances 分别为 306/368/343，证明 MO 能被采用，不能证明净收益。

`retained_candidate_count=0` 是**本轮 delta** 的 accounting，不代表旧 Library 被删除或忘记。累计 40/80/120/160 个旧 master 被保留并用于后代。相反，保留负收益组合与自动继续增量搜索，可能使旧弱 Cell 一直影响后续最差路径。比较四个累计库不能识别“新增第 k 代 Cell”的独立因果贡献。

第五代 `160 + 40 > MAX_CELLS=160`，在 `stage_design_mapping_timing` 两次拒绝。它没有第五个 QoR 负标签；容量失配解释了停止位置，不解释前四轮负收益。原 Run 保留为 non-terminal/running，trial verdict 为 PARTIAL。5.1.9 已通过 bind-inputs 提前要求 `MAX_CELLS >= 8 × MAX_NEW_CELLS`；这一修复不校准 Liberty，也不改善研究策略。

四轮没有一个原始 active-frontier endpoint 退出冻结目标 frontier；remaining counts 为 129/130/128/128，相对 foundry 128。第 4 轮完整 endpoint response 仍记录 271 个改善、249 个退化、10 个不变，46 个违例修复、29 个新违例。这是局部改善与全局 Fmax miss 并存的直接例子。

按 `Fmax=1000/(period-WNS)`，基准有效周期为 564 ps，+5% 需 ≤537.143 ps，即相对基准改善 26.857 ps；从第 2 代 583 ps 出发需改善 45.857 ps。即便把两个合计 80 ps 的 arc 全部降低 20%，孤立路径也只获得 16 ps，尚未计其他路径接管，不能直接推出 +5%。

## 4. Liberty 建模链与用户假设的定量审计

### 4.1 实際生产路径

`stages.py:stage_generate` 从 `expected_delta_generation_jobs` 取得作业，通过 Site `BOOL2CMOS_CMD` 传入函数、inputs、PDK、cell-name、输出路径。`_generation_projection.py:expected_generation_jobs` 对 MO 发一个多输出请求，对其他路线按输出发任务；**未按 implementation_request 中 drive_strengths/VT 展开**。留存 200 个请求全是 D4，实际五代所有晶体管仍是统一 PMOS 0.34 µm、NMOS 0.28 µm、关键样例 L=0.04 µm。D4 是请求元数据，不能当作已经兑现的电气事实。

`abstract_cell.py` 基于生成网表、placement columns、规则和 pin-track 生成 abstract LEF；不是提取了全定制 layout RC 的晶体管 characterization。`stage_characterize` 先按完整 layout admission 过滤，再执行 `charlib_emit.py` → `predict.py --which hgb --tables`，记录 `measured_characterization=False`。LC read/check/write 证明格式和模型被商业工具接受，不能证明延迟真实。

`features.py:cell_rows` 通过 Site `mock_char` 解析晶体管，提取各输入/输出关系、N/P stack、输入 gate widths、输出 diffusion 接触器件宽度、总器件数、内部链长/负载、pass gate、输入/输出数等；本地修正部分 stack/驱动关系遍历。`featurize.py` 以 19 个 log/log1p/raw 特征组成模型输入。这些是 Pack 所携 extractor 的实现；`predict.py` 将 Site helperDirs 置于 `sys.path` 前部后才 `import features`，故 Site 若存在同名模块可覆盖 Pack 版本。本次未拿到该模块实际导入路径/字节指纹，不能把本地 extractor 自动等同运行时所有特征实现。它没有把“Boolean 级数减少”直接变为延迟优惠；Boolean 变换产生的晶体管 topology 才决定特征。按总输出连接宽度近似有效驱动、使用简化链和 stack 特征，仍不能替代实际 sensitized transistor RC、内部状态及布局寄生。

`predict_scalars` 从 Site-bound model 的 HGB 树（若目标无 hgb_full 则 ridge）预测每 arc 的 intrinsic、load/slew slopes、corner、cap、k_load 等。训练源和 fit 数字不是这里重新计算的。`rebuild_table_v2` 从低端/LSQ slopes 恢复 load 和 slew 二次项，并用 corner 项约束远端值。非线性表面由少数预测量重建，不是逐网格 SPICE 测量。

### 4.2 坐标、单位、cap、slew 与多输出

- header、units、thresholds、PG 和 table templates 从 bound foundry Liberty 读取；轴取 Site 绑定 anchor 的首个 timing arc。trial generated Library 实测单位为 **1 ns / 1 pF**，不是 ps 当 ns 使用。
- slew index 从 bound anchor 原样取得；load index 为 `c0 + max(k_load,1) × (base-c0)`。floor 到 1 是实质模型假设，是否对当前训练目标适配需校准；改变 grid 不等同于真实提升驱动。
- Library 内数字已经处于 header 的单位；源码没有校验训练模型的单位/PVT/轴与本次 base header 必然相容。固定 Site 可工作不等于跨 Site 安全。当前未发现实际单位不匹配，列为校准合同缺口。
- 输入 cap 为该 pin 所有 output arc cap 预测的平均值；缺失目标可回退 0.002 pF，未产生 arc 的仍存在线路 pin 使用其他输入 cap 均值。对 MO 而言 cap 是真实共享输入器件总负载，不应靠“把几个独立预测取均值”推断正确；必须与网表 gate load 和测试标签核对。
- 每输出/输入分别写 `cell_rise/fall` 与 `rise/fall_transition`，timing sense 从完整 Boolean 函数求得；output arc 的存在来自特征拓扑。缺少 function 会报错，但不能由“arcs 非空”推出所有有影响的输入/输出组合完整。
- `max_transition` 取该 cell 最大 slew-axis top；输出 `max_capacitance` 取该输出各 arc load-axis top 的最小值。保护边界有用，但 max_transition/max_cap 属性不是所有实际工作点都未超界的证据。
- Pack license-free NLDM evaluator 使用 bounded bilinear 并记录 clamp；商业工具插值/超界行为不是这个 Python clamp。二者对 out-of-domain 点可能分歧，需要逐 arc 工作点和 STA cross-check。
- MO SPICE 存在多个输出并不证明共享晶体管优化。v5 文档已承认历史 independent-output/container 限制；trial 不应借 output 数证明共享收益。
- `validate_drive_family` 有 D1/D2/D4/D6/D8 的 cap/area/width/power/load/resistance 合同，但仅见测试调用，未接到生产 generate/characterize。**不存在已经生产并校准的 D1/D2/D4/D8 scaling 链可供本 trial 审计。** 未来不能统一乘 delay 常数代替 resizing，必须重新得到 cap、slew、面积、pin access 和逐输出驱动。

### 4.3 40–50 ps 是否异常

关键 master `XS_MAPPER_COMPATIBILITY_MAPPED_SINGLE_0010_G0001_Y`：

- 函数 `Y = !(I3 | (I1 ^ (I0 ^ I2)))`，28 devices，SPICE 注释 max series N/P=3/4，输出级没有额外 D4 sizing。
- I0→Y 为 non-unate；输入 cap 1.1731 fF（其他 pins 为 0.6473–1.7836 fF）。
- I0 falling 表低端值 19.324 ps。在 **输入 slew 20 ps、输出 load 3 fF** 的声明诊断点，直接 bilinear 为 **40.613 ps**；rise 为 **38.580 ps**。
- 改为 50 ps / 10 fF，fall/rise 为 **87.983/85.867 ps**。这些点在表内，不需要超界外推。
- `XS_FUNCTIONAL_DIVERSITY_MAPPED_SINGLE_0011_G0002_Y` 是 18-device `(I1 | I2) ^ I0`，I1→Y 在 20 ps/3 fF 的 fall/rise 为 **28.724/27.287 ps**。同一库不是普遍固定 40–50 ps。

这些数从 `R/flow/library/cumulative-custom.lib` 复算。它们说明 report 约 46 ps 与模型本身相容，也说明复杂小尺寸 CMOS 的负载斜率足以吃掉逻辑压缩收益；**没有建立预测值相对真实 SPICE 的 signed error**。与一个普通 inverter/NAND 的单级延迟对比不公平，必须与同 Boolean cover、同边界 arrival/load、同 PVT、上游 cap 和下游 slew 传播一起比较。

原始报告也纠正了一个容易混合的场景：

- 第 2 代真正 worst -83 ps，required **406 ps**，有 **3 个** XS output arc：25+46+29=100 ps。
- 第 3 代 worst -70 ps，required **403 ps**，有 **2 个** XS output arc：37+40=77 ps。
- 两者 uncertainty 都是 175 ps。用户“两个 Cell 约 80 ps，required 403 ps”的量级在第 3 代明确存在，但不能把该路径直接当作第 2 代 -83 ps 的同一条证据。可能用户看过其他路径/版本；没有该路径身份时保留这个不确定性。

175 ps uncertainty 是约束扣减，已包含在 required time 中，不是两个 Cell 所消耗的 delay，也不能再从 403 ps 重复扣除。它使目标更紧，却在 matched 两臂相同；降低它不能作为本次 Cell-only 改善。

### 4.4 表面形状的校准风险

只读扫描五代 200 个 generated masters 的四类 timing tables，得到 776/748/908/816/856 张表。全部表至少在一个 load 列存在 slew 增大而值下降的区段，最明显位于 310→628 ps；load 方向本次未见下降，未见 NaN/Inf。第 1/2/5 代分别有 3/1/6 个负 `cell_fall` entries；没有据此发现负 transition。

例如上述 G0001 I0 fall 在最大 load 的值随 slew 从 2→628 ps 由 1155.230 ps 降到 800.509 ps；其小负载列在 310→628 ps 也从 75.413 降到 50.878 ps。这提示独立 scalar 回归和 quadratic/corner 重建必须接受形状及 heldout 校准。**负 propagation delay 在阈值定义下并非自动非法；slew 局部非单调也不能单独当作普适硬拒绝。** 应核对参考同类/同 corner 曲面、幅度和实际工作区间。没有证据证明这里的高-slew异常就是 worst-path 40 ps 的原因，更不支持“统一悲观”：形状异常也可能制造乐观误差。

历史 fresh-50 诊断记录 HGB-v2 table median error 9.8–11.7%、P90 41.4–42.4%，约 5% 的设计目标不允许把这类未校准误差忽略。那是另一实验/验证记录，不能移植为本 trial 的误差条。

## 5. 路径、设计响应与因果边界

以下统计统一使用每个 arm 留存 `timingReports/aes_cipher_top_postRoute_reg2reg.tarpt.gz` 的 **50 条**路径，不混用 `postopt/post_all` 的 100-path 输出。报告精度为 1 ps，逐项求和可能有数 ps 舍入残差。Cell delay 是 launch Q 后组合 output arc 之和，net delay 为数据段 input-pin 增量，CQ 与 launch clock 分列。

| 前 50 路径均值，ps（级数无单位） | Foundry | Gen1 | Gen2 | Gen3 | Gen4 |
| --- | --- | --- | --- | --- | --- |
| Slack | -58.58 | -60.42 | -71.02 | -63.42 | -65.12 |
| Arrival | 464.28 | 466.50 | 476.18 | 467.62 | 469.24 |
| Required | 405.72 | 406.06 | 405.14 | 404.12 | 403.96 |
| 组合级数 | 16.06 | 16.60 | 16.28 | 15.18 | 15.58 |
| 组合 Cell delay | 286.82 | 286.12 | 292.70 | 288.90 | 286.54 |
| 数据 net delay | 15.68 | 16.54 | 17.70 | 11.70 | 12.12 |
| Launch clock arrival | 98.76 | 100.26 | 99.90 | 99.92 | 101.38 |
| Clock-to-Q | 61.68 | 62.34 | 64.26 | 65.96 | 67.54 |
| Capture clock arrival | 96.72 | 97.00 | 97.52 | 96.88 | 96.96 |
| Setup cost | 15.94 | 15.80 | 17.24 | 17.70 | 17.76 |
| 含 XS 的路径数 | 0 | 13 | 30 | 33 | 29 |
| XS output arc 出现次数 | 0 | 13 | 47 | 52 | 44 |
| XS delay min/median/max | — | 23/27/37 | 16/30/46 | 14/31/43 | 15/30/44 |
| 其中 MO output arc 次数 | 0 | 0 | 7 | 12 | 6 |
| 与 foundry 样本共同起终点对 | — | 3 | 8 | 0 | 1 |

最差路径的组合级数/Cell/net/CQ 分解分别为：Foundry 16/299/18/60；Gen1 18/272/32/60（0 XS）；Gen2 16/307/19/60（3 XS）；Gen3 13/297/20/60（2 XS）；Gen4 17/280/18/73（1 XS，32 ps）。Gen4 最差总组合 Cell delay 比 foundry worst 还少 19 ps，slack 仍差 10 ps；不同端点、launch、CQ、setup/required 和路径重排不能忽略。

这不是同一条路径的因果差分。起终点共同集合很小，且同一对仍可能内部换路。Gen2 的 8 个共同对平均 slack -8 ps，而 Cell/net 分别 -0.75/-6.25 ps，提示 CQ、clock/setup 等作用；不能简单把正的 XS delay 总量等同其“额外损失”。

物理/功耗也发生变化：foundry area 21568.4 µm² / power 25.6901 mW；四代 generated 分别为 21949.3/25.9705、20681.3/24.3703、20302.3/24.1452、21118.9/24.7540。第 2–4 代出现面积功耗收益而 Fmax 退化，不能说所有维度无收益。功耗仍依赖预测模型。四代 hold WNS 为 -119/-119/-117/-122 ps，foundry -118 ps；setup-derived Fmax 不是 hold-clean 工作频率。DRC 2/0/0/2 与 compare `comparison_valid=true` 并存，不能把 matched valid 解读为 signoff clean。

需要的因果链是“哪一个 source cover、哪一条实际 input→output arc、替换前后 arrival/load/slew、消失的内部 net、增加的输入 cap、upstream/旁路 sink penalty、下游 transition、endpoint alternative 以及 clock/setup 变化”。当前 commercial response 主要提供 endpoint slack 标签，不足以把这一链绑定回每个 candidate demand。

## 6. 自我改进审计：哪里真的变了，哪里没有

### 6.1 确实存在的机制

- `mining_source` 在合法 compare 后读取最新 generated post-route 网表与报告，输入不是永远固定。
- `stage_function_local` 排除 cumulative function keys，保留 F0/F1 可行性/结构证据，再暴露最多 128 个 proposal。
- `compare_v5_frontiers` 生成完整 endpoint 变化、remaining/frontier migration，`stage_function_local` 将 current response hash 绑定到下一 research context。
- runner 隔离执行、验证程序 AST、预算、身份和 hash；onsite lens 必须引用当前商业 response。
- cumulative shards 和 namespace 防止相同物理名字冲突，旧资产有真实复用。

因此不是“完全没有反馈”。但改变输入数据、保存反馈和引用反馈，均不等于程序利用反馈修改了需求或决策。

### 6.2 八份执行源码与五代策略

源码位于 `R/research/ai-discovery/.executions/<execution-id>/entry.py`；代次/attempt 来自 T 的 `hima_ledger.json` `code` 与 `job finished` 记录，不按文件 mtime 猜测。

| 代 | 成功 entry SHA 前缀 | candidate source SHA 前缀 | 实际选择逻辑 | 商业反馈的作用 |
| --- | --- | --- | --- | --- |
| 1 | 385840d387f9 | e5466a5004bc | 固定 F1 加权分，`sorted((score,index))` 升序 | 无前轮反馈 |
| 2 | 59e7b74705d3 | e5466a5004bc | 与 Gen1 同一 pure selector | lens 引用当前 response，排序未用其内容 |
| 3 | 873545dca396 | e5466a5004bc | 与 Gen1/2 字节相同；文案称恢复 revision 0 | 同上 |
| 4 | 95840d7de2e8 | 9f5e3f132588 | 用负 score 改成降序；加 F0/F3 项和 lens rotation | F0/F3 在 compact pool 不存在，项恒零；摘要读取 hash reference |
| 5 | a4a6e1774e8a | bab7d88dab9c | 读取三个错误顶层字段，所有 score=0，选 first-40 | rank0 改 onsite 标签，商业内容未参与 |

Gen1–3 分数为 `3 levels + 2 nodes + edges + 2.5 cut_width + 4 reconvergence + 1.5 path_family + 2 repeat + nonoverlap - overlap`，却升序取小值。若这些正项意在奖励压缩/覆盖，方向与意图相反：仅 levels_removed=1 和 3 的两个候选，前者必先选。也没有证据支持这些权重经过商业响应更新；正向奖励 cut_width 本身也需解释边界代价。

Gen4 的反序改动是真实算法变化，不能说“只有换名字”。但新增的 `row.F0.library_novel/duplicate` 与 `row.F3.residual_support` 均未由 `_compact_candidate_pool` 输出，自动 fallback 到零。`commercial_summary/direction` 接收到的是 `context.evidence.commercial_response` 的 path/hash/bytes 引用，既不是 `context.commercial_frontier_response` 内容，也不含它期望的 fmax 字段，所以最多生成含 hash 的问题。正确内容对象本身也主要是 endpoint/frontier，不能依赖未定义 fmax aliases。

Gen5 离线复现方法：对 `R/flow/library-richness/candidate-pool.json` 调用生产 `_compact_candidate_pool`，在内存执行保留 `research.json.candidate_program.source`，传其 budgets；输出 40 个 proposal_key 与 compact pool 前 40 个逐一相等。实际键是 `build_route`、`equivalence.digest`，代码读取 `implementation_route`、`route`、`equivalence_digest`。没有商业响应读操作，故保持 pool 不变、任意替换 commercial response 都不会改变输出。这是确定性语义失效，不是统计样本不足。

Ledger 还纠正了原 trial 报告的一个非 QoR 事实：Gen4 两次 Workshop exit 是 **1→0**；Gen5 三次为 **1→1→0**，不是“全部 exit 0”。第 4 代初稿 `sorted(reverse=True)` 后改为负数排序，第 5 代多次语法/协议适配最终留下上述空评分。应把“成功生成合法 JSON”和“科研策略有效”分别记录。

### 6.3 固定池的能力边界

当 candidate pool 非空，runner 只接受其中 proposal_key，并解析为不可变 generation_request；Agent 不能在此直接改变函数、驱动或 transistor topology。这有正确的身份/安全动机，但意味着 onsite-inspiration 当前主要是**有限重排/子集选择**，不是文档中完整的 drive-family/transistor-tuning/physical-fusion 研究能力。

compact pool 暴露 function、interface、F1 向量和 build_route，却没有完整的 candidate→commercial endpoint/arc/source-window 对应关系。commercial response 只提供 endpoint slack 排名；没有桥接，Agent 很容易退回“结构分 + lens 名称”。更严重的是 `stage_function_local` 在 Agent 前已做选集/顺序与最多 128 条截断，Gen5 零评分直接继承了这个顺序。新名字、不同函数和 MO 比例变化可以由矿工新输入、已有函数排除及池排序解释，不能自动归为 Agent 学习。

**验收判断：feedback mechanics 存在；该 trial 的有效策略更新证据不足，且 Gen4/Gen5 有明确反例；未证明自我改进。** 也不据此断言模型永远不能研究：先修合同、证据桥接和低层行为验收，才有公平的模型能力评估。

## 7. 根因排序与最便宜的反证

| 优先级 | 假设/事实 | 当前支持度 | 最便宜的下一项反证 |
| --- | --- | --- | --- |
| P0 | 候选程序没有语义消费商业反馈，schema 错配和排序方向使研究退化 | 源码与 Gen5 replay 已证实 | 冻结同一小 pool，只替换明确相关 endpoint/arc 反馈；记录选择/权重/排除变化或有证据的 no-change；错误字段必须显式报出，不再静默 0 |
| P0 | 请求驱动与生成实现脱节，反复新增函数绕过旧 critical Cell 的实现改良 | 200 请求 D4 与固定 W/L、生成 argv 已证实 | 对同函数请求 D1/D2/D4/D8，检查生成的电路/表/LEF 是否真实不同；先不跑 P&R |
| P0 | 新拓扑 learned Liberty 误差/重建偏差吞噬 27–46 ps 的设计余量 | 风险明确，signed error 未知 | 对 3–5 个已在关键路径的 master 做真实工作点参考 cover/预测/独立 SPICE 对照，先测最敏感 arc，不做全库全角 |
| P1 | 逻辑压缩未转化为电气优势，MO 采样与关键单输出瓶颈错位 | 深度/Cell-delay/route 样本支持；非独立干预 | 固定局部边界的 license-free STA 与 source-cover 逐 arc 差分，带 input-cap/slew 传播；测试 one-function resizing 是否胜过再枚举函数 |
| P1 | 物理路径、CQ/clock/setup 和替代路径接管抵消改善 | 路径重合极少、分解支持 | 用已导出 endpoint state/两臂路径做分解；同 endpoint 多 alternative 单独识别，缺真实工作点时请求小诊断而非完整重跑 |
| P1 | 全库累计提供旧弱 Cell，后代 delta 效果被旧资产和全局重映射混淆 | cumulative 事实；因果未证 | license-free 固定父网表 paired ablation：全部旧库 vs 有证据排除/替换一个旧实现的库，保留不可变历史；不先删除生产 shard |
| P2 | 求解/placement 随机波动解释小差值 | 未有重复 matched arms，不可排除；不能解释 schema bug | 首先比较冻结 seed、工具/脚本身份；只有完成校准且接近目标后才批准有限重复，不把四个不同库当噪声估计 |
| 已定位 | cumulative capacity 导致第五代停止 | 算术与两次拒绝已证实，5.1.9 已提前检查 | 重用现有 160/400 profile 低层反例，不再跑 Gen5 才发现 |

mock-only 根因目前不能排第一：Gen1 worst 无 XS、gen4 worst Cell-delay 更低仍退化，排除了“每一轮退化都只是两个 custom arc 太慢”的简单解释。反过来，不能用这些全局因素免除 Liberty 校准责任；未校准 Cell 模型会改变整个映射与 placement，影响无 XS 的最终路径。

## 8. 在现有架构内的有界修正

### 切片 A：先校准实现与 Liberty，再允许昂贵比较

归属 `stage_generate/characterize` 与现有 predictor/emitter。冻结 Site PVT/单位/轴/阈值、训练身份、输入/输出/Boolean、真实 W/L/拓扑和 LEF 身份；保存每个 arc 的模型来源与适用域。禁止把未实现的 D4 metadata 写成“已表征 D4”。

在现有 characterize record 中加入校准观察：参考已知 Cell 经同一 feature/predict/emitter round-trip 的误差；关键新 Cell 与独立 SPICE 的 signed residual；table 重建与直接拟合 scalar 的误差；网格内/外工作点；cap、transition、rise/fall、timing sense 和全输出覆盖。缺证据返回明确 unknown/uncalibrated，不能只因 LC 通过就声明可信。

校准门的硬条件是单位/PVT/模型适配、有限值、合法轴、pin/arc/实现身份完整和可复现误差证据；是否因为 margin 太小暂停昂贵研究应明确为研究决策。不要让未校准 proxy 凭预测 QoR 自动淘汰 Action。若选择有意乐观的 source-cover-relative Mock，必须单独版本/声明为条件实验，不能偷偷修改模型以达到 +5%，更不能与 measured Library 混称。

context-aware 表征是同一 cell 的完整 delay(slew,load,state) 和影响范围校准，不是对每个 instance 随意发明一张更快表。首先修复现有 prediction/axes/shape 合同，只有 signed-error 测量支持时才改模型或 topology。

### 切片 B：把商业响应变成具体 Cell demand

归属 `compare_v5_frontiers`、`stage_function_local`、`_compact_candidate_pool` 和现有 miners。保留 endpoint 完整列表，在有限 compact context 中加入 hash-bound candidate/source-window→endpoint/arc 对应、当前最差 arc 工作点、source cover 边界、上游 cap 与 downstream slew、是否 old/new Cell、函数/真实 drive 版本。压缩/截断需显式统计，不能用含糊的 F3 空字段。

下一轮必须记录一个可证伪的策略变化：例如“旧 G0001 单输出 master 在目标 endpoint 上的 I0→Y 占 46 ps，优先验证 sizing/stack，而非新增 40 个 MO”。选择程序读取真正定义的字段，输出使用的 feature/key、分数分量、选入/拒绝理由和替代方案。允许“此轮无必要新 Cell、先校准/停止”的有证据结果；不要奖励填满预算本身。

候选池不足以表达 tuning 时，先在现有 generation request/miner 的 implementation_request 内加入明确有消费者的参数和 generation tasks；不放开任意命令，不建立新 Runtime action。变更后驱动族验证必须连到生产生成结果，不能只留在单元测试。

### 切片 C：最小因果验证与停止条件

先在固定局部窗口和真实 working point 做 source-cover vs candidate 的 propagation，逐项分解 Cell、internal-net、boundary、input-cap、slew 和 alternative takeover；必要时才进入一次小规模真实 STA/LC/SPICE 检查。全设计 Fmax 的因果只能来自冻结组合的 matched comparison，不能从一个 portfolio 的几十条 endpoint 行训练几十个 action 系数。

停止新完整 P&R 的条件：校准缺失或 signed error 大到无法分辨目标 margin；研究程序 schema 不匹配/完全不消费声称的反馈；没有新的可证伪假设；相同函数/实现/策略只改 lens 标签；局部收益被可信边界代价抵消且无新实现方向；容量/预算不足。保持预算和 UI/Run 状态诚实一致，退出要有现有 Run 控制事件；这不是用文档把 stalled 状态改成完成。

## 9. 精确落点与分级验证计划

| 文件 / 函数 | 建议最小修改 | 最低验证 |
| --- | --- | --- |
| `flow/ai_research_runner.py:_compact_candidate_pool`、`build_residual_research_context`、`validate_residual_research_proposal` | 定义真实可消费字段/endpoint bindings，返回 schema 与截断事实；验证声明读取字段及必要反馈证据 | L1：错 aliases、缺 F0/F3、hash-only 误读、反馈改变/不应改变选择的反例 |
| `flow/research-template.py:residual_research` | 给当前 schema 的真实小实例，区分元数据 hash 与内容；加入解释为什么选择改变/不变；说明 sorted 方向 | L0/L1；稳定后 L4 一次小 DeepSeek 研究任务 |
| `flow/stages.py:stage_function_local`、`compare_v5_frontiers`、`stage_merge` | source-window/arc 归因随池传递；保存每代完整 research 输出和上下文快照；把有效 no-new-demand 送到已有分析/停止语义 | L1 + L2 Pack/Host 文件与 hash 贯通，不新增图引擎 |
| `flow/domain/_generation_projection.py:expected_generation_jobs`、`validate_drive_family`；`stages.py:stage_generate` | 明确 drive/VT 实现合同、实际 generator 参数/输出 identity；生产校验 family 的不同电路、电气和几何事实 | L1 请求→job/argv；L2 fixture 验证真实参数传递；必要 L4 单函数生成 |
| `flow/domain/features.py:cell_rows`、`featurize.py:build_row` | 只有与实际测量/网表复现不符时修特征；记录 topology/多输出/域外风险 | L1 独立已知电路的 stack、内部链、cap/output drive 反例 |
| `flow/domain/predict.py:load_axes`、`load_axis`、`predict_scalars`、`rebuild_table_v2` | 模型单位/PVT/axes provenance，k_load floor 与 shape 校准；报告超域与误差，必要时依证据修复拟合/重建 | L1 scalar→table 独立期望、anchor consistency、域外/非有限值；heldout signed residual |
| `flow/domain/charlib_emit.py:reference_timing_axes`、`main`；`stages.py:stage_characterize` | 模型/生成实现/Liberty/calibration 一致绑定；所有 arc/cap/slew/limits 的覆盖和 fail/unknown | L0/L1 + L2 真实 stage 临时文件，不需 DC/Innovus |
| `flow/domain/relative_mock_timing.py:build_break_even_envelope`；`cell_need_miner/liberty_timing.py:evaluate_timing_arc_transitions` | 保留历史 replay；逐真实工作点比较完整 source cover 和 cap/slew 传播，区分 clamp 与商业 extrapolation | L1 两 stage 合并、upstream 加载、non-unate、MO asymmetric、路径接管 |
| `flow/domain/innovus_timing_facts.py`、`innovus_dig_export.tcl`、`pnr.tcl.tmpl` 与 `flow/read-stage.py` | 在既有导出/reader 中保留逐 arc slew/load/cell/net/CQ/clock/setup、start/end 和 library hash，按需小诊断 | 先 L1 留存真实报告 fixture，再 L4 只读数据库/STA probe |

`tools/stages.py` 等发布镜像随实际修改保持逐字节一致；本评审未修改它们。测试优先加到已有 `test_ai_residual_research_context.py`、`test/contract/lfr-cumulative-library.test.ts`、`test/contract/custom-cell-fmax-pack.test.ts`、`test_pack_lfr_stage_adapter.py`、`test_design_information_graph.py`、`cell_need_miner/tests/test_liberty_timing.py` 与相应 Pack contract suites，不能为此建立另一测试平台。

建议次序：

1. **L0/L1，零产品模型/商业作业。** 重现 Gen5 first-40、Gen1–3 分数方向、Gen4 不存在字段；四组 tests 要断言选择结果和解释的因果输入。独立测试同 Boolean 不同 drive 不能被投影成相同实现。Liberty 全 arc 单位/轴/finite 与小网格插值、source-cover 比较。
2. **L2，真实 Pack/Host 临时闭环。** 用现有 stage seam 验证 generation→characterize→Reader 的 drive/calibration 身份、缺失拒绝、hash 历史与研究输入/输出快照。保留原负结果，不覆盖 trial evidence。
3. **L4a，小真实表征/STA。** 对一个已知 foundry 对照电路和 3–5 个真正 routed-critical XS masters，采少量覆盖实际 slew/load 的点，带 rise/fall 与相关 side states；新 SPICE 标签、预测 Liberty、OpenSTA/商业 STA 的 arc值互相交叉验证。此步骤没有完整 P&R。若预测误差不能分辨所需 27–46 ps 余量，返回 calibration。
4. **L4b，一次有界真实 DeepSeek 任务。** 给同 schema 的真实 feedback/context，要求输出可执行策略及可复算行为变化；比较 frozen-context ablation，验证模型改变了实际 demand。失败先修上下文/合同，不先增加完整 Campaign 预算。
5. **L5，只在前面通过后。** 冻结一个有物理实现依据的 portfolio，保持原 5% 目标与 matched 条件，一对完整 P&R arms（可按可信身份复用基线）。检查所有 endpoint alternatives、clock/setup/hold、工作点、census、DRC/功耗边界。若有效负结果，完成分析并按现有 Run 机制收束，不默认再填 40 个新函数。

## 10. 复核索引与未解决问题

按代关键身份：

| Gen | characterize run | compare run | generated P&R run | foundry P&R run |
| --- | --- | --- | --- | --- |
| 1 | db7adb4211094a888c031fd395207579 | 7c8168c99e7b466da6693f45bf9fc10e | 3f9a9d7676684ef9b429e573e9250722 | 3a12147b7872476db925f25291bc4056 |
| 2 | 023ad8f1ba2142599e1f401570f08f58 | 8f916a7f48c14929adc8b311be7442ea | e19dcb5c9610472e9e98dcbc1729cdd1 | e5dc8cb774a046a0ae114f7b9c9f9e43 |
| 3 | 3208b8303b32499f852927c1712ca00d | 10e427511d034bb5bbe0ee17ff2e7478 | d51fd3af2e5f49e69055b3b9431a3a11 | 9488264441284d8f97532f3220d54890 |
| 4 | 2391f4a52bfd479890cfda77f9100879 | 587de7a4da684029aa2398045e3441de | bada36c48f7a48de93ab0026ceefc546 | 785d9beec70f4326bf510a08fb858849 |
| 5 | e384da8ce17a4ef39f9b77d68c62af0c | 无 | 无 | 无 |

路径前缀为 `R/flow/artifacts/<stage>/run-<id>/`。Liberty/SPICE 分别为 characterize 下的 `generated.lib`、`admitted-cells/*.sp`，最终累计库为 `R/flow/library/cumulative-custom.lib`。汇总为 compare 的 `record.json` 与按代 `source-pnr-*-record.json`；TNS 为 generated `rpt_generated/postopt/post.summary.gz`。本次可取得的 compare inputs/artifacts 共 84 个引用均按记录 SHA-256 复算一致；未取得的引用不计通过。Gen5 research 原件 SHA-256 `7f1cea64b35644575684d9680b642508341aa4035abcd301683bd48b7f92c600`。

进一步能改变结论的缺口：

- 真实 path arc 的 slew/load、related pin/state、derate 和有效寄生；不能从默认 tarpt 的总 delay 逆推出这些量。
- 新 critical XS master 的独立晶体管表征与可靠物理实现；这是 signed mock bias 的决定性证据。
- 模型训练身份、PVT/axes/units 与 Site helper 的版本/导入实际归属；当前 helperDirs 可能包含同名模块，必须冻结真实解析路径而不只相信文件名。
- 每代完整 context/output 的不可变快照及 miner-to-candidate-to-endpoint 投影，支撑真正的跨代策略归因。现有八份源码可验证策略，不能还原所有历史池排序的数值因果。
- 复用库与单代增量的 bounded ablation；当前四个累计组合不是独立因果试验，也没有重复实验可估计统计稳健性。

方法依据：[v4](../postroute-design-information-graph-methodology-v4.zh-CN.md)、[v5](../first-principles-frontier-methodology-v5.zh-CN.md)、[Framework](../framework-development.zh-CN.md)、[历史 fresh-50 根因](../evidence/2026-09-16-fresh-aes-50cell-root-cause.md)、[5.1.9 capacity 修复](../evidence/2026-09-19-v5.1.9-cumulative-capacity-release.md)。v5 自己已要求逐 arc break-even、真实共享审计、完整 alternative、E0 后系统辨识；本建议是在已有模块中补齐实际执行与这些要求之间的缺口。
