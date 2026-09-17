# AES 第一性原理与 Active Frontier 方法学 v5：开发与 E0 实验

日期：2026-09-17  
归属：Library Function Richness / Issue #40  
结构化摘要：[aes-v5-first-principles-e0.summary.json](aes-v5-first-principles-e0.summary.json)

## 结论

V5 的现有模块增量已经实现并完成一次真实 AES 两臂 Innovus 23.14 E0。实验建立了新的物理基线：
真实 PG mesh、650 颗固定 checkerboard DCAP、85% effective occupancy 硬上限、无 ordinary filler、
full placement、DCCK clock family、useful skew 与 setup-only post-route optimization。两臂由共同逻辑父本
`N*` 和 `N* + frozen 50-Action ECO` 派生，reference 最终 Custom census 为 0，generated 为 50。

最终 V5 staggered-pin 结果没有提升 Fmax：WNS 均为 -57 ps，距 5% 目标所需的 26.524 ps frontier
推进仍很远。它得到 TNS +0.756 ns、setup violations -62、area -3.182%、wire -1.449%、modeled
power -2.042%。这是一个有效的 5% 目标负结果，也是一个广泛非瓶颈 PPA/时序质量正结果；两者不能
互相替代。

## 已开发能力

代码继续位于 `custom-cell-fmax-dtco` Pack 的既有模块：

- `pnr.tcl.tmpl`、`stages.py`、`read-stage.py`：PG、checkerboard DCAP、85% effective occupancy、
  无 filler、物理 facts、两臂 plan identity；
- `innovus_dig_export.tcl`、`innovus_timing_facts.py`：逐 register data pin 枚举，不再用 Top-N 代替
  endpoint state；生成 `q_e`、冻结的 `Q_target` 和 Active Frontier；
- `design_information_graph.py`、`build_dig_bundle.py`：将完整端点状态、frontier 与 sentinel 写入现有 DIG；
- `relative_mock_timing.py`：闭合 Local Window 的逐输出 break-even delay/load/slew/input-cap envelope；
- `library_richness.py`：整组 graph change 后重新传播所有 endpoints 的 bounded beam Portfolio；
- `multi_output_resynth/service.py`：区分真实共享晶体管审计与 `multi-output-container-only`；
- `innovus_ccei.py`：common-parent hash 与 full-replay placement mode；
- `abstract_cell.py`：确定性三轨 staggered pins、逐 pin access metadata、EOL/OBS/PG 审计。

免费代理仍为 observation-only，以上指标不会自动获得 E0 拒绝权。本次 50 Actions 均已通过既有
逻辑等价、全部输出使用、冲突、CCEI、proof、rollback 和预算硬门，因此作为冻结 calibration
Portfolio 全部放行；V5 beam 结果没有用来删减它们。

## 比较身份

| 项目 | reference | generated |
| --- | --- | --- |
| 逻辑输入 | `N*` | `N* + 50-Action ECO` |
| Netlist SHA-256 | `70cd1581…98d9d` | `f74e5adf…8342` |
| Custom timing/physical views | 不加载 | 只加载冻结 Portfolio 的 4 个 masters |
| 初始/最终 Custom instances | 0 / 0 | 50 / 50 |
| Custom 扩张 | 无 | Custom masters `dont_use`；已有 50 instances `dont_touch` |
| DCAP plan SHA-256 | `a26ac74b…c6e15` | `a26ac74b…c6e15` |
| DCAP | 650 | 650 |
| PG / floorplan / pins / SDC / RC / clock policy | matched | matched |
| placement | full | full |

V5 Custom LEF 只含实际使用的 4 个 masters。所有 pins 在 0.3/0.5/0.6 µm 三条高度上确定性错开，
四个 masters 的 EOL audit 均为 0。LEF SHA-256 为 `6b85db67…b0e1`；完整审计见
[aes-v5-abstract-pin-audit.json](aes-v5-abstract-pin-audit.json)。这是 abstract layout，不是 transistor
layout 或 tapeout GDS。

## 商业结果

约束周期为 0.5 ns。Fmax 使用 `1000 / (period - WNS)` 推导。

| 指标 | reference | generated | generated - reference |
| --- | ---: | ---: | ---: |
| setup WNS | -57 ps | -57 ps | **0 ps** |
| derived Fmax | 1795.33 MHz | 1795.33 MHz | **0.000%** |
| setup TNS | -6.641 ns | -5.885 ns | **+0.756 ns** |
| setup violating paths | 289 | 227 | **-62** |
| logic area | 22,401.0 µm² | 21,688.3 µm² | **-3.182%** |
| wire length | 180.400 mm | 177.786 mm | **-1.449%** |
| modeled power | 26.0879 mW | 25.5551 mW | **-2.042%** |
| effective occupancy | 62.404% | 61.135% | -1.269 points |
| hold WNS | -121 ps | -123 ps | -2 ps |
| hold TNS | -41.720 ns | -40.677 ns | +1.043 ns |
| route DRC | 2,073 | 2,070 | -3 |
| connectivity | clean | clean | matched |

两臂都有大量 DRC，主要说明这组首次加入的 PG 参数尚未完成工艺方法调优；没有 IR/EM signoff。
因此结果可作为同一物理条件下的 E0 QoR 观察，不能称为 physical closure、hold-clean product frequency、
tapeout ready 或 silicon benefit。

## Endpoint-complete DIG 响应

两臂均得到 530/530 register data endpoints，missing endpoint 为 0；path alternatives 仍明确标为
不完整。reference 的：

- `Q0 = 0.557 ns`；
- 冻结 5% 目标 `Qtarget = 0.530476 ns`；
- 所需推进 `26.524 ps`；
- active frontier 有 128 个 endpoints。

Generated 使用同一个冻结 `Qtarget`，frontier 为 127：

- 2 个 reference frontier endpoints 被移出；
- 1 个新 endpoint 进入；
- 126 个旧 frontier endpoints 仍未解决；
- 321 个共同 endpoints 改善，187 个变差，22 个不变；
- 修复 81 个原 setup violations，同时产生 26 个新 violations；
- 只有 9 个 endpoint 的当前 worst path 直接经过 `HIMA_MO_*`；
- reference WNS `sa10_reg_1_/D` 改善 6 ps；
- generated WNS 迁移到 `sa10_reg_4_/D`，它反而恶化 8 ps。

这验证了 V5 的核心判断：局部 Action gain 和广泛 TNS/PPA 收益不能自动转化为 WNS；优化必须覆盖
完整 active frontier 的替代路径，并对新瓶颈接管重新传播。DIG bundle 与 graph 均为 complete：

- reference bundle `87c333c…ad5c`，graph `f1ebcfb3…51a6`；
- generated bundle `326e5dca…ffbe`，graph `433acaa0…c848`；
- Site 上的当前 SQLite DIG 为 305 MB。

对应冻结结果见 [reference frontier](aes-v5-reference-active-frontier.json)、
[generated frontier](aes-v5-generated-active-frontier.json)、
[reference manifest](aes-v5-reference-dig-manifest.json) 和
[generated manifest](aes-v5-generated-dig-manifest.json)。

## 无效/诊断运行保留

本轮没有删除失败证据：

1. 最初 effective occupancy 审计把 Innovus nested core-box 当作平面列表，两次在 placement 后失败；
   修复为 placement 前冻结唯一四坐标 core box。
2. 第一条完整 reference 错误地加载 Custom Liberty，Innovus 自主引入 91 个 Custom instances；
   该比较无效。最终 reference 改为 foundry-only views，census 为 0。
3. 旧单带 pin LEF 的 generated 观察为 Fmax +0.723%、area +3.971%、wire +1.628%、power +3.089%；
   它被保留为 pin-geometry 敏感性样本，不能代替 V5 staggered-pin 结果。
4. V5 pin generator 首次真实运行发现两个单带残留假设；修复后四个 masters 均通过几何审计。

这些诊断表明物理抽象、Library 可见性和比较身份都能改变优化器轨迹；它们必须是 E0 身份的一部分，
不能作为报告整理细节忽略。

## 验证与成本

- Pack domain L1：120/120；
- Node 24 build/typecheck：通过；
- seam/boundary：通过；
- local Host `custom-cell-fmax-pack`：26/26，Electron 0、SSH 0；
- Innovus 23.14：新 reference 和 V5 generated full route 各 1 条有效 arm；
- 有效 P&R wall time：reference 12:39.88，generated 10:33.13；
- OpenDB/OpenROAD：两臂 projection、save/reload 与 DIG 构建通过；
- Desktop、真实模型：未运行，本切片无 Desktop/prompt 改动；
- 脚本 hash：[aes-v5-e0-scripts.sha256](aes-v5-e0-scripts.sha256)。

## 下一步只保留已识别问题

下一轮不应扩大 Cell 数量或盲跑。输入应是本次 generated DIG 的 127-endpoint frozen frontier，优先处理
`sa10_reg_4_/D` 及与它共同接管的 alternatives；Portfolio 必须在整图传播下同时降低 worst `q_e`，并保留
已经观察到的 area/wire/power/TNS 收益。PG 参数需要作为独立 Site method 调优，使 DRC 可接受；在此之前，
任何结果都只能是 E0 setup QoR 观察。
