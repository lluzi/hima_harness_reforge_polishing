# 第一性原理与 Active Frontier 驱动的协同优化方法学 v5

状态：既有模块增量与首轮 AES E0 已完成；5% Fmax 目标未达到

开发对象：`packs/custom-cell-fmax-dtco` HimaPack

跟踪标识：`LFR-V5-*`，继续归属 [Issue #40](https://github.com/lluzi/hima_harness_reforge_polishing/issues/40)

实施证据：[2026-09-17 AES V5 开发与 E0](evidence/2026-09-17-aes-v5-first-principles-e0.md)；
[结构化摘要](evidence/aes-v5-first-principles-e0.summary.json)

前置方法：

- [Library Function Richness Framework](framework-development.zh-CN.md)
- [方法升级 v2](methodology-v2.zh-CN.md)
- [累计收益驱动的协同优化方法学 v3](cumulative-gain-cooptimization-v3.zh-CN.md)
- [Post-route Design Information Graph 方法学 v4](postroute-design-information-graph-methodology-v4.zh-CN.md)

主要证据：

- [Fresh AES 50-Cell E0](evidence/2026-09-16-fresh-aes-50cell-e0.md)
- [Fresh AES 50-Cell 根因分析](evidence/2026-09-16-fresh-aes-50cell-root-cause.md)
- [AES 20-Cell 双输出商业 P&R](evidence/2026-09-16-aes-mo20-commercial-pnr.md)
- [AES 40-Cell 双/三输出商业 P&R](evidence/2026-09-16-aes-mo40-hier3-commercial.md)
- [AES 100-Cell 累计收益商业观察](evidence/2026-09-16-aes-cgo100-cumulative-gain.md)
- [DIG v4 免费闭环](evidence/2026-09-16-aes-dig-v4-free-closure.md)
- [DIG v4 商业校准](evidence/2026-09-16-aes-dig-v4-observation-calibration.md)

## 1. V5 的决定

V5 不建立新的 Runtime、Fabric、图数据库、ECO 引擎或商业验证系统。它继续深化 v4 已有的
Design Information Graph（DIG）、CrossPhaseMap、Custom Cell ECO Integrator（CCEI）、
`multi_output_resynth`、Library-richness domain 逻辑和 P&R 模板。

V5 把方法学的中心从“选择看起来更好的 Cell 或 Action”改为：

> 在新的真实物理基线中识别阻碍目标 Fmax 的 active endpoint frontier；为候选动作形成分层、
> 条件化、可被推翻的局部收益证书；把候选作为一个 Portfolio 真正应用到同一张候选图并重算；
> 最后只用一对身份严格匹配的商业 E0 arms 观察整个 Portfolio 的流程总效应。

### 1.1 首轮实现与实验出口

2026-09-17 的实现保持上述边界，在现有 Pack 模块中完成 PG/DCAP/85% baseline、endpoint-complete
timing state、Active Frontier、break-even envelope、whole-graph beam、physical-sharing audit、
common-parent/full-replay CCEI 以及 staggered-pin abstract。真实 AES 两臂得到：

- WNS -57 ps → -57 ps，derived Fmax 0%；
- TNS -6.641 ns → -5.885 ns，setup violations 289 → 227；
- area -3.182%、wire -1.449%、modeled power -2.042%；
- 530/530 endpoints 完整，冻结 5% frontier 128 → 127；只移出 2 个旧 frontier endpoints，新增 1 个；
- reference/generated Custom census 0/50，650 颗 DCAP plan hash 完全一致；
- hold 未闭合、route DRC 约 2,070、未做 IR/EM，因此不构成 physical closure。

它是针对 5% 目标的有效负结果。V5 证明当前 50-Action Portfolio 能广泛改善非瓶颈 PPA/TNS，但没有
同时击穿完整 WNS frontier；下一轮的搜索输入应是 generated DIG 上仍存的 127 个 endpoints，而不是
继续增加未定位 Actions。

V5 的成功首先意味着实验有效、证据分层正确、结果可解释。5% matched post-route Fmax 仍是 AES
Campaign 的业务目标，但不能预先写入 Mock Liberty、证书门槛或结果解释。

## 2. 四版方法留下的事实

| 版本 | 已支持的结论 | 已被反例推翻或仍未证明的结论 |
| --- | --- | --- |
| V1 | 挖掘、免费 mapping、商业综合与 P&R 链路可以运行 | adoption、实例减少、平均级数或平均 proxy 改善不能推出最坏 endpoint 改善；“F1/F2/F3 不全负向”只是试验政策 |
| V2 | 局部双/三输出 ECO、层级证明和商业 P&R 可以执行 | 更多输出、更多 adoption 和更多替换不保证 QoR；MO20/MO40 未做共享晶体管优化，不能否定真正的共享机制 |
| V3 | Action、完整边界、source conflict、Portfolio、proof 和 rollback 是正确工程对象 | sampled top path 不是 endpoint 完整状态；孤立 Action gain 不能直接相加；强制保留只保证干预存续 |
| V4 | DIG、跨阶段映射、CCEI、商业响应回写提高了可观察性；一次 50-Action E0 得到模型条件下 +1.085% Fmax | 50 比 27 好不能单独证明互补性、非线性或 placement response 中的任何一种机制；局部 commercial label 不是逐 Action 因果系数 |

### 2.1 当前最强正结果的准确表述

V4 50-Action Portfolio 在 source-cover 相对乐观 Mock Liberty、当前物理抽象和给定流程下，matched
commercial E0 观察到：

- WNS：`-59 ps -> -53 ps`；
- derived Fmax：`+1.085%`；
- TNS：改善 `0.287 ns`；
- logic area：`+9.32%`；
- wire：`+4.43%`；
- modeled power：`+6.82%`；
- 391 个共同 endpoints 中，194 改善、176 恶化、21 不变；
- 修复 35 个 violation，同时新增 39 个；
- 新旧 WNS path 均不直接经过 custom Cell。

这是一次正向性能观察，不是 measured Cell characterization、完整 PPA 改善、跨 design 泛化或
5% 目标完成。

### 2.2 必须保留的反例

- V1 Fresh 50-Cell：DC reg-to-reg WNS 改善，但 post-route Fmax `-2.792%`；
- V2 MO20：Fmax `+0.180%`，但只有 6/20 custom instances 存活；
- V2 MO40：更多双/三输出 adoption 后 Fmax `-0.179%`，area/wire/power 全部变差；
- V3 11-Action preserved ECO：area `-17.99%`、wire `-11.05%`、modeled power `-11.29%`，
  但 Fmax `-3.130%`；
- V4 27-Action calibration：按第一轮局部正标签剪枝后只得到 `+0.540%`，弱于 50-Action；
- V4 免费闭环的 389 个 endpoints 中有 384 个触及 `nworst=100`，timing-path completeness 为
  `partial`。完整 structural cones 不能写成完整 timing alternatives。

## 3. 术语与事实权威

### 3.1 核心对象

- **Design State**：一个 hash-bound 设计状态，包含逻辑父本、约束、Library、PVT/RC、clock、
  placement、PG、物理资源和工具身份。
- **Common Parent `N*`**：baseline/generated 两臂共同继承的 coarse-preparation 逻辑网表和环境。
- **Action**：在一个已声明 Local Window 中进行的单输出、多输出、fusion、sizing 或 area-recovery
  逻辑/物理变换。
- **Master**：Action 使用的物理 standard-cell master。一个 master 可服务一次或多次 Action。
- **Local Window**：包含 source logic、边界输入前级、旁路 sinks、全部边界输出负载和局部物理区域的
  最小闭合分析窗口。
- **Active Frontier**：在当前约束和目标周期下，可能限制目标 Fmax 的 setup endpoints 集合。
- **Portfolio**：在同一 Design State 上可共同实施、无 source conflict、经过整组重算的一组 Actions。
- **Commercial Label**：一次完整 E0 后对整个 Portfolio 和条件的观察，不是逐 Action 固有收益。

### 3.2 四层证据，禁止合成一个 `pass`

| 层 | 内容 | 允许声明 |
| --- | --- | --- |
| L：严格逻辑事实 | 全边界输出等价、消费者完整、相位/pin permutation 正确、变更外逻辑保持 | 替换保持规定逻辑语义 |
| C：条件化电气/物理证书 | 冻结模型、PVT/RC、边界波形/负载/几何范围和窗口约束，给出收益或退化界 | 仅在声明条件集合内成立 |
| P：免费/Mock 观察 | NLDM 假设、估算 RC、结构与图指标、情景敏感度 | 当前假设下的方向、break-even 条件和观测值 |
| E0：商业流程观察 | 最终 netlist、clock、placement、route、寄生、拥塞和优化器共同结果 | 本次完整流程的系统结果 |

L 层的逻辑等价、全部输出被使用、source conflict、预算、Site Permit、CCEI 可实施性、proof 和
rollback 继续是硬门。P 层保持 observation-only。在没有 measured characterization 或已证明误差界时，
C/P 数值不能暗中恢复为 E0 准入/拒绝规则。

V5 可以要求每个被选 Action 拥有结构完整、可复算的 C/P 证书；证书缺失属于证据缺失。证书中的
Mock 正负值只用于构造和解释实验，不自动决定商业收益。

## 4. 新的 matched 物理基线

PG mesh、密度、DCAP 和 Mock LEF pin 几何会改变 routing capacity、placement、RC 和全局优化轨迹。
因此 v4 以前的 DIG 可以保留为历史失败与软件回归证据，但不能继续作为 V5 的物理 Opportunity 事实。

### 4.1 两臂共同冻结的环境

两臂必须使用同一份：

- top `aes_cipher_top`、逻辑父本 `N*`、SDC 和不确定度；
- core、IO、macros、rows、placement/routing blockages；
- PG mesh 的 layer、width、pitch、offset、via 与特殊布线结果；
- foundry tap/endcap 策略；不把 tap/endcap 当 filler 删除；
- DCAP master 清单、区域、pitch、checkerboard 坐标、方向和电源连接；
- CTS DCCK buffer/inverter 集合、early clock、useful skew 和 `100 ps` max allowed delay；
- RC corners、analysis mode、优化命令、线程、随机设置和报告配置；
- floorplan、pin plan、PG、DCAP 和父网表的规范化 hash。

本 Campaign 不插入 ordinary filler。若省略 filler，则报告必须注明 geometry/tapeout closure 未完成。
如果 PDK 要求 tap/endcap，仍必须插入并保持 matched。

### 4.2 85% 密度的定义

V5 的 85% 是最终有效 standard-cell site occupancy 上限，不是只对 pure logic gates 报告的工具字段：

```text
effective_site_occupancy =
  occupied_sites(movable logic + clock/buffer + DCAP + tap/endcap + fixed standard cells)
  / placeable_sites_after_blockages
```

要求：

- 全局 `effective_site_occupancy <= 85%`；
- placement 初始目标必须扣除计划中的 DCAP、tap/endcap、clock/buffer 和安全余量，不能直接把
  movable logic target 设为 85%；最终读回超过 85% 时本轮物理条件不合格；
- 单独记录工具的 pure-gate density，不把它冒充最终有效密度；
- 记录局部 density bins，不能从全局 85% 推出关键区域一定有 15% 空间；
- 记录 PG mesh 之后可用 routing tracks 和 congestion；
- DCAP 插入不能发生在“逻辑先占满 85%”之后；DCAP、tap/endcap 已计入预算。

### 4.3 DCAP checkerboard

DCAP 使用 Site 声明的 foundry master，按预先冻结的区域、pitch 和 checkerboard 相位生成确定性坐标。
两个 arms 从同一 DCAP plan 开始；不能在各自 placement 结束后分别见缝插针。DCAP 必须合法放置、
方向正确并连到 PG。没有 IR/EM 分析时，它只证明物理资源占用和连接建模，不能证明供电质量。

### 4.4 Mock LEF pin access

`flow/domain/abstract_cell.py` 当前把信号 pin 放在同一水平 pin band、按 site column 排列。V5 要在
既有 generator 中深化 pin-placement rule：

- pin rect 和 landing stub 位于合法 routing tracks；
- 输入、输出和多输出 pins 使用确定性的多 track/staggered 分配，不挤在一条水平带；
- 保持 M1/M2 spacing、EOL、minimum area、via landing、PG rail 和 OBS 检查；
- 记录每个 pin 的 access points 和被 OBS/PG 遮挡后的可达性；
- 同一个 master 的 LEF 不按具体 instance sink 位置定制；
- abstract-only 几何继续明确标注，不冒充完成的晶体管 layout。

## 5. Common Parent 与两臂顺序

V5 的商业实验只保留一个 baseline full-route arm 和一个 generated full-route arm。两臂评估一份
Portfolio 的流程总效应，不能识别逐 Action 因果效应，也不能同时比较 incremental placement 与
full placement 的商业差异。

```text
new physical environment
        |
common coarse preparation
        |
        +--> freeze common logical parent N* + environment identity
        |
        +--> baseline: clear movable std-cell coordinates
        |              full placement -> CTS -> route -> setup optimization
        |              export DIG_baseline_postroute
        |
        +--> mine from DIG_baseline_postroute
                       |
                       v
             project region back to common N*
                       |
             anchored rediscovery + proof + Portfolio
                       |
             freeze N* + ECO
                       |
        +--> generated: clear movable std-cell coordinates
                       full placement -> CTS -> route -> setup optimization
                       export DIG_generated_postroute
```

如果 common coarse preparation 已经 resize、clone、buffer 或重综合，改变后的网表就是两臂共同父本
`N*`。不能让 baseline 继承 coarse 改写，而 generated 回到更早的 DC netlist，也不能只凭两边都执行
`unplaceAllInsts` 就声明 matched。

清除坐标只作用于允许移动的 standard-cell instances。floorplan、IO、macros、rows、PG、DCAP、
tap/endcap、fixed instances 和 blockages 保持。实际 Innovus 命令和对象过滤必须由真实 Site probe
验证，不能仅根据命令名字推断效果。

局部 fixed/incremental 分析仍保留，用于 C 层证书、CCEI 可实施性和诊断。它不是第三个完整 E0 arm，
也不把旧物理坐标写成 full re-placement 后的最终事实。

## 6. DIG timing 完备性与 Active Frontier

### 6.1 路径列表不是时序状态

V5 不用 Top-N timing paths 定义 endpoint 完整状态。DIG 必须保留并验证：

- 所有合法 setup endpoints 和 path groups；
- combinational timing arcs、rise/fall、timing sense；
- launch/capture clock、clock latency、setup、uncertainty、CPPR/derate 口径；
- false path、multicycle、disable timing 等 exceptions；
- input slew、pin capacitance、net load 和输出 slew；
- 缺失 arc、截断、unsupported constraint 和多时钟歧义；
- structural cone completeness 与 timing-state completeness 分开报告。

对固定时序模型，arrival 通过图传播而不是枚举路径：

\[
A(v)=\max_{u\rightarrow v}\{A(u)+d_{uv}\}.
\]

Action 或 Portfolio 应用后，至少对受影响扇出锥及所有退化哨兵重新传播。这样一条 launch path 被优化
后，另一条 alternative path 会自然接管。

### 6.2 Active Frontier 定义

对 baseline 周期 \(T_0\) 和 endpoint setup slack \(s_e\)，定义：

\[
q_e=T_0-s_e,
\qquad
Q_0=\max_e q_e.
\]

\(q_e\) 是当前条件下 endpoint 达到零 slack 所需的周期。目标 Fmax 提升 \(r\) 时：

\[
Q_{target}=\frac{Q_0}{1+r},
\qquad
G_{target}=Q_0-Q_{target}.
\]

给定事先冻结、来源明确的退化保护带 \(\rho\)，active frontier 是：

\[
\mathcal F=\{e:q_e\ge Q_{target}-\rho\}.
\]

V4 baseline 的示例是 \(T_0=500\,ps\)、WNS \(-59\,ps\)，所以 \(Q_0=559\,ps\)。5% Fmax
目标需要：

\[
Q_{target}=559/1.05\approx532.38\,ps,
\qquad G_{target}\approx26.62\,ps.
\]

当前最好观察推进 6 ps，不能写成已接近 5% 完成。

不同 path group、clock 和 multicycle 约束分别规范化；不能把原始 slack 直接混成一个全局排名。
所有 endpoints 保留为退化哨兵。active frontier 是搜索集合；在 full re-placement 缺少全局误差界时，
它不是对其他 endpoints 永不接管的形式保证。

### 6.3 Slack 分解口径修正

V4 文档中的简式

```text
DeltaSlack = DeltaDataArrival + DeltaCaptureClock - DeltaLaunchClock
```

不能作为 V5 的权威公式。若 data arrival 指 clock-to-Q 加组合/互连传播，方向应按工具口径写为：

\[
\Delta Slack=
-\Delta t_{cq}
-\Delta d_{data}
+\Delta L_{capture}
-\Delta L_{launch}
-\Delta t_{setup}
-\Delta U
+\Delta CPPR.
\]

如果 arrival 已含 launch latency，就不能重复扣除。Reader 报告必须列出工具实际 required/arrival
定义，禁止凭字段名字重复归因。

## 7. 第一性原理局部收益证书

### 7.1 证书不是最终 Fmax 预测

对 Local Window \(W\)、允许的边界条件集合 \(b\in\mathcal B\) 和每个边界输出 \(o\)，定义条件化
下界：

\[
g_o^{LB}=\inf_{b\in\mathcal B}
\left[A_o^{old}(b)-A_o^{new}(b)\right].
\]

证书允许至少一个目标输出有正收益，同时为其余输出声明允许退化和下游 slack guard。它不能只比较
新 Cell delay 与旧 cone delay，也不能只固定 input arrival/slew 后忽略 input-cap 反作用。

### 7.2 闭合窗口

Local Window 至少包含：

- source instances 和被删除的内部 nets；
- 每个边界输入的前一级 driver；
- 因 input capacitance 变化受到影响的旁路 sinks；
- 全部边界 outputs、它们的真实 loads 和直接下游；
- 原位置、候选 bbox、合法 site、pin access 和局部 routing 区域；
- 被内化 net 的 extracted R/C、via 和长度；
- 与 active frontier 的 endpoint influence 关系。

若无法闭合，证书状态是 `incomplete`，不能用零 penalty 填补。

### 7.3 必须输出的收益分解

证书至少记录：

```text
stage/depth effect
cell arc effect by output and transition
removed internal-net R/C/via effect
drive and output-slew effect
input-cap/upstream-driver penalty
bystander-sink penalty
sink-divergence and boundary-wire penalty
pin-access/legal-placement status
local displacement and congestion observation
break-even arc-delay/capacitance/slew envelope
model identity, uncertainty and invalidation conditions
```

级数减少、internal net 删除和 logical effort 降低是机制解释，不是充分证明。transistor stack、输入电容、
输出 slew、pin density 或物理牵拉可以抵消这些收益。

### 7.4 Break-even envelope 取代预设收益证明

`relative_mock_timing.py` 的 5%/10% source-cover-relative Mock 继续保留为历史 E0 calibration 模型，
但不再作为第一性原理证书。

V5 对候选先求：

- 每条 timing arc 在各 slew/load 网格点最多允许的 delay；
- 每个输入最多允许的 capacitance；
- 每个输出允许的最大 slew 和 load；
- 至少需要消除的 net/via/RC；
- candidate width、pin access 和 displacement 的可行范围。

这形成 `break_even_envelope`。Mock Cell 模型与 envelope 的关系写成 `inside`、`outside` 或 `unknown`；
它仍是条件化观察。没有 transistor implementation 和 measured characterization 时，不产生 silicon benefit
声明。

## 8. Opportunity 类型与职责

| Action | 目标 | 默认实施 | 主要证书要求 |
| --- | --- | --- | --- |
| 单输出逻辑替换 | 相位吸收、复合逻辑化简、关键级数减少 | 当前定点动作走 CCEI；具有完整通用 views 后可 synthesis-eligible | 完整单输出边界、upstream cap、下游 slew、alternative path |
| 多输出替换 | 共享真实逻辑/器件，同时服务多个输出 | CCEI-only | 所有 outputs 有用途、逐输出 drive/load、sink cohesion、真实共享审计 |
| Physical fusion | 内化真实昂贵 net/via，减少局部 RC | CCEI-only | extracted RC/via、几何局部性、full-replacement 后机制存续观察 |
| Drive sizing | 处理长距离、高负载和输出 slew | 完整表征族可交给综合/P&R；否则定点 CCEI | input-cap/upstream penalty 与逐 load/slew arc |
| Transistor tuning | 优化已确认瓶颈 master 的 stack、非对称尺寸和内部节点 | Cell implementation/characterization 流 | 电路级实现、表征和 break-even 对照，不扩展函数枚举 |
| Area recovery | 用非 frontier slack 回收面积、wire 和局部资源 | CCEI 或后续 synthesis-eligible | 不把 endpoint 推入 frontier；面积收益不计作直接 Fmax gain |

### 8.1 多输出真实共享审计

MO20/MO40 的证据声明 `independentOutputNetworks=true`、`sharedTransistorOptimization=false`。V5 因此
把以下字段加入多输出需求与结果：

- `shared_internal_nodes`；
- `shared_transistor_count`；
- `independent_output_networks`；
- 每个 output 的 pull-up/pull-down cone 与驱动能力；
- 相比独立单输出 cover 的 transistor、diffusion/internal-net 变化；
- 无共享时的明确状态 `multi-output-container-only`。

没有共享的多输出 Cell 仍可作为逻辑 ECO 对照，但不能用来证明共享晶体管机制。

### 8.2 一次使用的 master

复用率不是硬门。Portfolio 对一个 master \(m\) 使用二元变量 \(y_m\)，每次 Action 使用 \(x_a\)：

```text
x_a <= y_master(a)
sum(characterization_cost[m] * y_m) <= master_budget
sum(action_cost[a] * x_a) <= action_budget
```

master 只使用一次但能推进 active frontier，可以被选中；它仍支付一次生成、characterization、view、
pin-access 和维护成本。没有可靠货币换算时使用预算和字典序，不臆造“1 ps 等于多少成本”。

## 9. Portfolio 构造

### 9.1 目标

Portfolio 必须先执行整组图变换，再重新计算负载、slew、arrival 和所有 endpoint 哨兵。不能把各
Action 的孤立收益相加。

条件化字典序目标为：

\[
\min_x^{lex}
\left[
\tau(x),
\sum_e w_e[q_e(x)-Q_{target}]_+,
\sum_m c_m y_m,
\sum_a c_a x_a
\right]
\]

其中：

\[
\tau(x)=\max_{\omega\in\Omega}\max_e
q_e(Apply(G,x);\omega).
\]

\(\Omega\) 是事先冻结的 load、parasitic、Cell model 和 boundary 情景。若情景来自未校准 Mock，
结果只构成条件化比较，不构成真实物理保证。

约束至少包括：

\[
x_a+x_b\le1
\quad\text{对 source、boundary 或 ECO window 冲突},
\]

以及 logical proof、全部输出使用、master/action 预算、CCEI 可实施性、rollback、电气限制、局部区域
改动预算和保护语义。

### 9.2 有界搜索，不假设 submodularity

V5 不声明目标天然 submodular，也不使用“只有单项立即改善 WNS 才加入”的 greedy。建议在现有
`optimize_action_portfolio` 中实现有界 beam/swap：

```text
frontier = {empty portfolio}
while budget remains:
    choose uncovered or insufficiently improved endpoint alternatives
    propose compatible actions and small action groups
    for each retained prefix + proposal:
        apply the complete candidate portfolio to one candidate graph
        recompute affected timing state, loads, slew and all endpoint sentinels
        reject hard conflicts and invalid proofs
        retain raw conditional metrics and uncertainty
    keep a bounded set of lexicographically non-dominated prefixes
run bounded delete/swap checks on retained prefixes
freeze one portfolio and all identities before E0
```

必须允许“单项不改变 WNS，但多个 Action 共同覆盖 bottleneck alternatives”的组合。商业层面仍只观察
冻结 Portfolio 的总效应，不从一个 E0 拟合几十个 Action 的因果系数。

## 10. CCEI 与 full placement

CCEI 继续发生在共同 `N*` 可被可靠重识别的 coarse-preparation seam：

1. Opportunity 绑定 `DIG_baseline_postroute` 的 region、frontier endpoints 和证书；
2. CrossPhaseMap 把 region 投影回共同 `N*`，不产生 point-to-point replacement；
3. `multi_output_resynth` 在投影窗口内进行 anchored rediscovery；
4. 检查 source identity、完整边界、所有 outputs、conflict 和 proof；
5. Portfolio 在同一 `N*` 上整组实施并做 top/module/window equivalence；
6. 生成唯一 hash-bound `N* + ECO`、CCEI plan 和 rollback；
7. generated arm 清除允许移动的 standard-cell 坐标，重新 full placement；
8. post-route 读回 custom census、master substitutions 和保护语义。

ECO-only 保护只覆盖必须存活的 custom function/instances。文档和证据必须说明工具仍允许哪些 drive
substitution、buffering 和移动。`dont_touch` 的实际行为通过读回验证，不根据 Tcl 名字推断。

full placement 后，旧 Local Window 的坐标、sink geometry 和 RC 证书自动降级为历史条件化证据。
最终 DIG 记录机制是否仍存续，但不能把旧局部 gain 直接写成最终贡献。

## 11. 最少 E0 商业运行方案

### 11.1 E0 前冻结

- baseline/generated 共同父本 `N*` 和环境 hashes；
- PG、DCAP、tap/endcap、density、pin、clock、PVT/RC、工具和命令；
- active frontier 定义、目标 5% 对应的 `Q_target`、保护带来源；
- Portfolio、master/action budget、proof、rollback 和 Mock 限制；
- 成功、有效负结果、比较无效和停止条件。

### 11.2 两个 full-route arms

| Arm | 输入 | 唯一允许的逻辑差异 |
| --- | --- | --- |
| baseline | `N*` + frozen physical environment | 无 Custom Cell Portfolio |
| generated | `N* + frozen ECO Portfolio` + same environment | 已声明并证明的 Portfolio |

两臂都执行一致的 full placement、CTS、route、RC extraction 和 setup optimization。共同 coarse
preparation 和局部商用诊断如实际调用，单独记录资源，但不伪装成免费层或第三个 full E0 arm。

### 11.3 必须报告

- compare identity 和每阶段规范化 netlist/constraint/environment hashes；
- setup WNS、derived Fmax、TNS、violating endpoints/path groups；
- hold WNS/TNS，明确本 Campaign 没有 post-route hold fix；
- slew/cap/fanout violations、clock/data/uncertainty/CPPR 分解；
- effective/global/local density、congestion、wire、area、power、DRC、connectivity；
- custom masters/instances 的 coarse-place、post-place、post-CTS、post-route census；
- endpoint `q_e` 变化、frontier migration、新 bottlenecks 和 alternative takeover；
- Local Window 假设越界、break-even envelope 与最终 load/slew 的对照；
- 逻辑变化、placement displacement 和全局响应分层说明。

### 11.4 声明边界

- 一对 arms 只是一项 Portfolio 的一次流程观察，没有统计置信区间；
- 同一 seed 不等于对扰动稳健；
- setup-only、hold 未闭合的结果不能称为产品可工作频率；
- abstract LEF、Mock Liberty、无 filler 或无 IR/EM 时，不能称 tapeout/silicon ready；
- 5% 目标未达到时如实退出，不通过改变基线、约束或 Mock 收益补成成功。

## 12. E0 后的系统辨识

E0 结果作为同一个 Portfolio 的 Commercial Label 写回 DIG：

- 比较 active frontier 与所有 endpoint 哨兵；
- 标记 custom-path、non-custom-path、clock、placement、load/slew 和 routing 响应；
- 识别 boundary envelope 越界、alternative takeover、sink divergence 和全局 displacement；
- 记录 Portfolio-level success/failure 与条件；
- Action-local 行只作为归因线索，不当作独立干预样本；
- 不从一次 Portfolio 拟合几十个 Action 的因果系数；
- 不因 50 比 27 好就自动声明互补性，除非在冻结候选图中出现可复算的组合效应。

下一轮只针对已识别的新问题更新 Opportunity、Cell implementation 或 Portfolio。失败不会覆盖历史
annotation，也不会触发无根因的另一套盲试。

## 13. 现有代码归属与明确修改

| 文件/模块 | V5 深化内容 | 不允许扩张 |
| --- | --- | --- |
| `flow/domain/pnr.tcl.tmpl` | PG mesh、matched tap/endcap、无 ordinary filler、冻结 DCAP plan、full placement replay、阶段 census 与报告 | 不建立第二 P&R runner；不把同名命令当作 matched 证据 |
| `flow/stages.py` 的 `build_arm_files`、P&R stage | 生成共同 `N*`/环境身份、两臂同源脚本、effective density/DCAP/PG artifacts、唯一 Portfolio arm | 不新增 Fabric graph node；不为每类算法启动商业分支 |
| `flow/read-stage.py` | 独立复算父本、PG/DCAP/density、阶段 census、timing/hold/electrical/physical 与 claim limits | 不复制优化器选择；不把报告缺失当零 |
| `flow/domain/abstract_cell.py` | 多 track/staggered pins、access-point/OBS/PG 审计、确定性 LEF identity | 不按 instance sink 定制 master；不声称完整 layout |
| `flow/domain/innovus_dig_export.tcl`、`innovus_timing_facts.py` | 导出完整 endpoint/path-group/constraint/clock/electrical 状态和截断事实 | 不用更多 Top-N 路径冒充 timing completeness |
| `flow/domain/design_information_graph.py`、`dig_store.py`、`build_dig_snapshot.py` | timing-state completeness、环境 identity、active frontier、证书与 Commercial Label 分层 annotation | 不引入第二图数据库或第二事实源 |
| `flow/domain/mine_timing_route.py` 的 endpoint/frontier 逻辑 | 用完整传播状态构建 `q_e`、frontier、退化哨兵、Local Window 和 candidate influence | 不再以一条 path 或固定 `nworst` 列表代表 endpoint |
| `flow/domain/relative_mock_timing.py` | 保留旧模型 replay；新增 break-even envelope、边界情景与假设越界报告 | 不把 5%/10% preset 写成 first-principles pass |
| `flow/library_richness.py` 的 `optimize_action_portfolio` | Portfolio whole-graph apply/recompute、beam/swap、master/action budgets、lexicographic objective | 不对孤立 Action gain 求和；不把 proxy 恢复为 E0 gate |
| `flow/domain/multi_output_resynth/service.py` | 闭合边界、旁路 sink、逐输出 load、真实共享审计、anchored rediscovery | 不扩张为全局综合器；不把 container-only 写成 transistor sharing |
| `flow/domain/cross_phase_graph.py` | post-route region 到共同 `N*` 的带歧义投影与环境身份 | 不直接输出 point-to-point ECO target |
| `flow/domain/innovus_ccei.py` | 共同父本上的整组 plan、保护语义、`N*+ECO` 与 rollback | 不保留旧坐标作为 generated final placement |

`tools/` 中与 `flow/` 重复的发布副本继续遵循现有逐字节一致要求。V5 不增加 Hima Runtime 组件、
Fabric action、隐藏 Agent、商业搜索服务或新的资产生命周期。

## 14. 实施任务与依赖

| 任务 | 修改范围 | 输出与验收 | 依赖/并行 |
| --- | --- | --- | --- |
| LFR-V5-01 真实物理基线 | `pnr.tcl.tmpl`、`stages.py`、`read-stage.py`、Site bindings/tests | PG/DCAP/tap/endcap/85% identity；无 ordinary filler；两臂 matched | 可与 02/03/04 并行 |
| LFR-V5-02 完整 timing state | Innovus export、`innovus_timing_facts.py`、DIG/store/snapshot、`mine_timing_route.py` | 不依赖 `nworst` 的 endpoint state；截断/exception/clock completeness fail closed | 可与 01/03/04 并行 |
| LFR-V5-03 Break-even 证书 | `relative_mock_timing.py`、`mine_timing_route.py`、`library_richness.py` | 闭合窗口、逐输出 envelope、upstream/旁路 penalty、Mock claim limits | 可与 01/02/04 并行；使用 02 schema 接线 |
| LFR-V5-04 Cell physical contract | `abstract_cell.py`、resynth/generation metadata/tests | staggered pin access；多输出共享审计；drive/output identities | 可与 01/02/03 并行 |
| LFR-V5-05 Portfolio v5 | `library_richness.py`、现有 fixtures/tests | whole-Portfolio graph recompute、beam/swap、budget/conflict、deterministic frozen result | 等待 02/03 contract |
| LFR-V5-06 Common-parent CCEI replay | `cross_phase_graph.py`、`innovus_ccei.py`、`stages.py`、P&R template | `N*`/`N*+ECO`、两臂 full replay、proof/rollback、阶段 census | 等待 01/02/04/05 |
| LFR-V5-07 两臂 E0 与报告 | existing P&R stage、DIG response、Reader/evidence | 新 baseline + 一个 generated arm；完整 claims/limits；5% 或诚实负结果 | 等待 06 |

首轮状态：01～07 均已形成代码和对应测试；01/02/04/06/07 已由真实 Innovus/OpenDB 两臂验证；03/05
以 L1 的 closed-window/alternative-takeover 反例验证，并在 E0 中保持 observation-only，没有用免费指标
删减 50-Action calibration Portfolio。真实结果是 07 允许的“诚实负结果”，Issue #40 不因此关闭。

共享接线文件 `stages.py`、`read-stage.py` 和 P&R template 保持单一所有者。任务可以在模块边界内并行，
但接口冻结前不同时编辑共享接线。每项规格应足以让第二梯队模型在不重新定义产品的情况下实施。

## 15. 分级测试

### L0：静态合同

- V5 文档链接、文件路径和证据引用存在；
- `flow/` 与要求一致的 `tools/` 发布副本逐字节一致；
- P&R template 不含 ordinary filler，包含 PG/DCAP/tap/endcap/density 身份输出；
- schema 版本、父本 hash、环境 hash 和 claim-limit 字段完整。

### L1：纯逻辑反证

在现有 tests 内深化：

- `test_design_information_graph.py`：路径列表截断但完整 timing graph 可传播；缺 constraint/arc 时 fail closed；
- `test_mine_timing_route.py`：同一 endpoint 两条近等 launch alternatives，优化一条后另一条接管；
- `test_cumulative_gain_cooptimization.py`：单项均不推进 WNS、组合覆盖 frontier；冲突、swap、预算和
  deterministic selection；
- `test_multi_output_resynth.py`：旁路 sink、所有 outputs 使用、container-only 与 shared-transistor 状态；
- `test_pnr_fmax_policy.py`：common parent、PG/DCAP/85%、无 filler、full replay 与 hold-report contract；
- `abstract_cell.py` 对应测试：多 track pin access、spacing/EOL/via/OBS/PG 反例；
- break-even tests：固定 arrival 隐藏 input-cap 反作用的反例；envelope 在 delay/cap 边界两侧翻转。

### L2：Pack/Host 接线

- 现有 Pack stage 和 Reader 对 V5 artifacts 做真实文件/hash 复算；
- 缺父本、环境身份、timing completeness 或 rollback 时拒绝；
- 免费 proxy 的 `metric_success=false` 仍不能单独阻止商业观察；
- 历史 v4 evidence replay 保持可读，并明确旧语义。

### L4：真实工具有界检查

在完整 E0 前只运行必要 probe：

- Innovus 对 PG mesh、DCAP、tap/endcap、85% occupancy、unplace/filter 和 common-parent census 的真实语义；
- LC 对 V5 Mock Liberty/DB 的读取；
- Yosys 对 `N*` 与 `N*+ECO` 的 window/module/top proof；
- Innovus 导出的 constraint/clock/endpoint facts 能被 DIG 完整接收；
- abstract LEF 在真实 router/checker 中无 pin-access/geometry 结构性错误。

### L5：唯一完整 pilot

- 一次 baseline full P&R；
- 从该 baseline DIG 产生并冻结一个 Portfolio；
- 一次 generated full P&R；
- 不为单输出、多输出、fusion、sizing 或 area recovery 各跑商业分支；
- 用户/资深工程师根据完整报告判断研究价值。

## 16. 退出、停止与结论

### 16.1 实验有效

只有以下条件全部满足，才能比较两臂：

- common parent、constraints、Library baseline、floorplan、PG、DCAP、tap/endcap、clock、PVT/RC 和脚本身份匹配；
- 两臂完整结束，报告与数据库对应当前源码和输入；
- generated 只包含冻结 Portfolio 的逻辑差异；
- proof、rollback、custom census 和环境 claims 可复算；
- timing/hold/electrical/physical 报告没有被缺失值填零；
- Mock、abstract、hold 和统计限制完整披露。

身份不匹配、流程未完成或关键报告缺失时，状态是 `comparison-invalid`，不是负收益。

### 16.2 业务目标达到

在实验有效的前提下：

- matched derived Fmax 改善至少 5%；
- 不通过修改其他逻辑、约束、floorplan、PG、clock 或优化策略制造差异；
- 事先冻结的 area/power/density/DRC/electrical 边界满足；
- custom Cell 在 final database 中实际存在并可追溯到 Portfolio；
- 报告明确 setup-focused 与 hold closure 的边界。

### 16.3 停止条件

- Portfolio 证书或 proof 不完整；
- 新物理 baseline 不能形成稳定共同父本；
- PG/DCAP/密度或 pin access 使 abstract experiment 不再可解释；
- E0 比较无效；
- 有效 E0 未达到目标且结果已经指出新的具体瓶颈时，本轮结束并进入分析，不在同一轮盲目重跑；
- 预算耗尽后停止新的 EDA 作业，只用已形成事实完成报告。

## 17. V5 明确不做的事情

- 不把 5%/10% Mock 加速当作 first-principles proof；
- 不把 Top-N timing report 当作完整 endpoint alternatives；
- 不把 MO20/MO40 当作共享晶体管机制验证；
- 不从一个 Portfolio 的 endpoint 行拟合逐 Action 因果系数；
- 不把 area、wire、power、adoption 或 custom census 代替 Fmax；
- 不用多个商业 branches 举办算法比赛；
- 不因 full re-placement 后最终结果为正，就把旧局部几何证书写成最终因果；
- 不用 setup-only 结果声称 hold-clean 产品频率；
- 不新增 Harness/Runtime/Fabric 组件来承载 Pack 内方法学；
- 不删除 V1～V4 的负结果和历史证据。

V5 的首个交付不是一段新的宣传结论，而是一份能够被真实工具和真实 endpoint 反驳的冻结实验。
只有在这份实验中观察到结果，才继续讨论哪些因子能够晋级为可靠的下一轮决策规则。
