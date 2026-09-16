# AES 20-Cell 多输出逻辑商业 P&R 对照

日期：2026-09-16
结论：两个 Innovus 分支均完成 placement、DCCK CTS、global/detail route、RC extraction、setup-only post-route optimization、timing、power、DRC、connectivity、post-route netlist 和 database。多输出分支得到小幅 Fmax 正收益，但没有达到 5% 目标。

## 1. 控制变量

两个分支都以 `aes_cipher_top` 为完整设计对象，并使用：

- 同一份 DC X-2025.06-SP3 baseline netlist 和同一份 SDC；
- 0.5 ns clock、DC 50% uncertainty、APR 25%+50 ps uncertainty；
- 同一 core `{2.1 2.0 187.6 187.4}`、206 rows；
- 同一 pin plan；
- 同一 foundry Liberty、LEF、tech LEF、QRC tech；
- 同一 Innovus 23.14-s088_1 P&R 模板；
- 同一 DCCK clock buffer/inverter 集合；
- 两边都不运行 post-route hold optimization。

Baseline 使用原 DC 网表和 foundry library。Generated 分支唯一增加 20 种双输出 standard cell 及 resynthesizer 产生的完整 AES ECO 网表。

层次化只用于容量管理：机会来自 `aes_sbox_9`、`aes_sbox_8` 和 `aes_sbox_0`，交付物仍是一份 `aes_cipher_top` 网表。20 个 Cell 在 P&R 前全部显式实例化；三个修改叶子分别通过 Yosys，接口保持不变，其他模块定义逐字节不变，rollback 恢复原始 DC 网表 SHA-256。

## 2. 新 Library

每个 Cell 有 2 或 3 个输入和两个输出。两个输出分别由 bool2cmos 生成，再合并为一个标准高度 SPICE subckt；当前没有共享晶体管优化。20 个 Cell 均形成：

- 结构 SPICE：8–18 个 transistor；
- 0.9 µm 标准高度 LEF abstract，宽度 0.7–1.4 µm；
- 每个输出独立的 learned-model timing/power arcs；
- Library Compiler T-2022.03 接受的 `.db`。

这沿用此前 Package 的标准单元生成方法，但仍有两个限制：characterization 是模型预测而非 SPICE measurement；LEF 是未完成 intra-cell routing 的 abstract。它足够进入 Innovus 做 placement、route 和条件化 QoR 对照，不是可 tapeout 的最终 Cell library。

## 3. 商业结果

| 指标 | Foundry baseline | Multi-output generated | 变化 |
| --- | ---: | ---: | ---: |
| reg-to-reg WNS | -57 ps | -56 ps | +1 ps |
| 推导 Fmax | 1795.33 MHz | 1798.56 MHz | **+0.180%** |
| TNS | -7.213 ns | -6.313 ns | +0.900 ns / 12.48% |
| violating paths | 315 | 240 | -75 / 23.81% |
| 非物理 Cell 面积 | 22614.354 µm² | 20969.298 µm² | **-7.274%** |
| gate equivalents | 59826 | 55474 | -7.274% |
| 非物理 Cell 数 | 16145 | 15963 | -1.127% |
| 总 wirelength | 188099.67 µm | 175859.64 µm | **-6.507%** |
| modeled total power | 26.5230 | 25.3842 | **-4.294%** |
| route DRC | 5 | 2 | -3 |
| signal connectivity errors | 0 | 0 | 持平 |
| post-route hold WNS | -125 ps | -121 ps | +4 ps |
| Innovus P&R wall time | 805 s | 727 s | -9.69% |

Fmax 的推导使用 `1 / (0.5 ns + |reg-to-reg WNS|)`。因此这次观察到的正收益是真实商业 route/timing 结果，但只有 0.18%，没有达到 Campaign 的 5% 出口。

面积、wirelength 和 modeled power 的改善明显大于频率。它们说明 multi-output ECO 改变了 Innovus 的全局 sizing/buffering/logic optimization 轨迹；它们不等于 6 个保留 Cell 自身直接贡献了全部差值。Power 还依赖 learned model，不能升级为 silicon power claim。

## 4. 采用结果

20 个 master 在 generated 初始网表中各出现一次。Innovus 最终保留 6 个：

- `HMO_AES20_03_D1`
- `HMO_AES20_06_D1`
- `HMO_AES20_09_D1`
- `HMO_AES20_12_D1`
- `HMO_AES20_16_D1`
- `HMO_AES20_20_D1`

采用率为 30%。`HMO_AES20_06_D1` 和 `HMO_AES20_09_D1` 出现在 post-route top-100 timing path 报告中，并具有非零 timing arc delay。Generated 的两个 DRC 都位于普通 foundry Cell/WellTap，不指向 HMO Cell。

这表明下一轮不应平均对待 20 个候选。应优先分析这 6 个最终保留的功能，尤其是 timing path 中的 06/09；被商业优化器移除的 14 个功能属于负向采用因子。

## 5. 等价与未闭合项

P&R 前的完整 ECO 逻辑闭环已通过：20 个 window truth vector、三个修改叶子的 Yosys proof、接口不变、其他模块逐字一致、rollback 一致。

P&R 后，独立 full-top Yosys proof 在 900 秒超时，没有返回 counterexample。23 个逐模块尝试中，22 个因 Innovus 为两边生成不同的 `FE_OCPN*` feedthrough module ports 而无法建立同名接口，top 仍超时。因此：

- 商业流程和商业 QoR 已完成；
- Innovus 正常输出不能替代独立逻辑证明；
- post-route 独立等价状态是 **未闭合**，不是失败反例，也不是通过。

本轮没有生成 GDS。20 个新 Cell 只有 abstract LEF，没有 signoff GDS；两边在 routed database、netlist 和报告处停止，避免把缺少 Cell geometry 的 stream-out 冒充成完整物理交付。

## 6. 证据

结构化数据和全部 SHA-256 位于 [`aes-mo20-commercial-pnr.summary.json`](aes-mo20-commercial-pnr.summary.json)。20 个函数定义位于 [`aes-mo20-commercial-function-cells.lib`](aes-mo20-commercial-function-cells.lib)。原始商业证据保留在 Site：

`/data/eda/project/hima_harness/polishing-runs/aes-mo20-commercial-20260916`

该目录包含 LC log、20 个 SPICE、20 个 LEF abstract、Liberty/DB、两套脚本、init/post-route database、timing/power/DRC/connectivity 报告和两个 post-route netlist。
