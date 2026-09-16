# AES 层次化 40-Cell 双/三输出商业验证

日期：2026-09-16

## 结果

本轮把挖掘扩展到 20 个 AES S-box hierarchy，选取 24 种双输出、16 种三输出 standard cell，并在完整 `aes_cipher_top` 网表中安排 120 次互不冲突的 ECO。商业 Innovus 成功完成 placement、DCCK CTS、route、RC extraction、setup-only post-route optimization 和报告；三输出 Cell 可以进入真实商业实现。

扩大采用没有改善 QoR。最终 reg-to-reg WNS 为 -58 ps，比 matched baseline 的 -57 ps 差 1 ps，比上一轮 20-Cell 的 -56 ps 差 2 ps。面积、wirelength、TNS 和 modeled power 也都恶化。因此本轮是“商业可用、方法负结果”。

## 挖掘与逻辑闭环

- 20 个 S-box 模块；
- 3,102 个完整多输出窗口；
- 93 个 P-canonical 功能族；
- Library budget：24 种双输出、16 种三输出；
- ECO：63 个双输出、57 个三输出，共 120 个；
- 396 个原实例替换为 120 个多输出实例，输入网表净减少 276 个实例；
- 19 个修改模块全部通过 Yosys，接口不变，模块外字节一致，rollback 通过。

## Standard-cell Library

40 个 Cell 均由 2 或 3 个独立 bool2cmos 输出网络合并为一个标准高度 subckt，随后生成 LEF abstract、learned-model Liberty 和 Library Compiler T-2022.03 DB。40 个 Cell 全部通过 read/check/write，没有 characterization skip。

这证明了三输出 standard cell 的工具链兼容性，不证明物理效率。输出之间当前不共享晶体管，abstract 没有完成 intra-cell routing，timing/power 是 learned-model prediction。

## 商业结果

Baseline 直接复用上一轮哈希固定的 reference，因为 DC netlist、SDC、floorplan、pin plan、foundry views 和 P&R 方法完全相同。

| 指标 | Baseline | 20-Cell 双输出 | 40-Cell 双/三输出 |
| --- | ---: | ---: | ---: |
| reg-to-reg WNS | -57 ps | -56 ps | **-58 ps** |
| 推导 Fmax | 1795.33 MHz | 1798.56 MHz | **1792.11 MHz** |
| TNS | -7.213 ns | -6.313 ns | **-7.773 ns** |
| violating paths | 315 | 240 | **324** |
| 非物理 Cell 面积 | 22614.354 µm² | 20969.298 µm² | **24690.582 µm²** |
| wirelength | 188099.67 µm | 175859.64 µm | **193119.94 µm** |
| modeled total power | 26.5230 | 25.3842 | **28.3984** |
| route DRC | 5 | 2 | **1** |

相对 baseline：Fmax -0.179%、面积 +9.181%、wirelength +2.669%、modeled power +7.071%。相对上一轮 20-Cell：Fmax -0.358%、面积 +17.746%、wirelength +9.815%、modeled power +11.874%。只有 DRC 数继续改善。

## 采用

120 个初始实例最终保留 40 个，涉及 27 种 master：

- 双输出：18 个实例、15 种 master；
- 三输出：22 个实例、12 种 master；
- 总实例保留率：33.3%。

6 种 master 出现在 post-route top-100 timing reports，其中 `HMO_AESX_014_D1` 和 `HMO_AESX_017_D1` 为三输出 Cell。由此可以确认三输出 Cell 被商业 timing engine 实际计时和采用。

但采用数量不等于收益。当前独立输出实现扩大了 Cell 宽度、pin 数、input capacitance 和 routing demand；候选排序又主要奖励结构合并与出现次数，没有用 post-route criticality 和物理净 margin约束。更多 Cell 因而把优化空间推向了错误方向。

## 方法结论

下一轮不应继续扩大 Library 数量。应：

1. 只保留 timing report 中真正出现且有正 margin 的双/三输出功能；
2. 三输出必须有真实内部共享，不能继续使用三个独立输出网络；
3. 在挖掘时计入 pin capacitance、sink divergence、预计宽度和 removed net/via delay；
4. 用本轮 40 个保留/淘汰结果形成 adoption factor，并把 WNS/TNS 影响作为商业标签；
5. 优先改进 20-Cell 轮保留的 6 个功能及本轮 timing-path 中的 6 个功能，而不是追求更高采用数量。

结构化证据见 [`aes-mo40-hier3-commercial.summary.json`](aes-mo40-hier3-commercial.summary.json)，函数索引见 [`aes-mo40-hier3-function-cells.lib`](aes-mo40-hier3-function-cells.lib)。原始商业证据保留在：

`/data/eda/project/hima_harness/polishing-runs/aes-mo40-hier3-commercial-20260916`
