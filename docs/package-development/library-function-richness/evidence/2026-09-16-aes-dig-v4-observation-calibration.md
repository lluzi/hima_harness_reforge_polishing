# AES DIG v4 observation-only proxy 与相对 Mock Library 商业校准

日期：2026-09-16  
归属：Library Function Richness / Issue #40  
结构化摘要：[aes-dig-v4-observation-calibration.summary.json](aes-dig-v4-observation-calibration.summary.json)

## 方法决定

本轮落实两项 Owner 决策：

1. 免费 logic/physical/STA proxy 只记录指标、局部响应、适用范围和自身 metric success。
   在 proxy factor 与 E0 Commercial Label 的相关性尚未建立前，
   `decision_authority=false`、`may_block_e0=false`。满足逻辑等价、全部 outputs 使用、
   source conflict、Site Permit、预算、CCEI、proof 和 rollback 等硬约束的 Action 全部进入
   commercial calibration。
2. Mock Liberty 不再把某个 transition 点或 learned model 的悲观 delay 当成物理真相。
   每个 candidate arc 在 source cover 的完整 NLDM slew/load 网格上建模：简单/两 Cell
   cover 至少快 5%，复杂/三颗以上 cover 至少快 10%。每个网格点独立生成，多个采用位置
   共用 master 时取能覆盖所有位置的最严格 target；已有更快值不会被调慢。它仍是
   optimistic mock，不是 measured characterization。

实现提交为 `9d04c087a3c6bc3a11bc19a4786c3e118d5061a3`。相关代码位于现有 Pack 的
`proxy_mapping.py`、`library_richness.py`、`relative_mock_timing.py` 和
`multi_output_resynth/service.py`，没有新增 Runtime/Fabric 组件。

## 固定输入与构建

- AES top：`aes_cipher_top`；
- 共同 coarse-place：16,275 instances，graph SHA-256
  `c0b08692a60c569e4c4c28635e44027ff49a13db6cc398cbde725dbe0b70949e`；
- Early Clock/useful skew：启用；maximum allowed delay 0.1 ns；
- 最终 Mock Library：4 masters、72 timing/transition tables；
- 41 个简单 Action 使用 5%，9 个复杂 Action 使用 10%；
- Liberty SHA-256：`a61a0e05158908dc236595379ca52a6b60fc7c0805b21d209b3d1b4ebb5aad57`；
- Library Compiler T-2022.03 read/check/write 通过；
- 最终 50-Action patch：13 个 single-output、37 个 dual-output；113 个 source instances
  替换为 50 个 custom instances；Yosys 组合证明通过。

共同 place 到 CCEI place 的 instance 数从 16,275 变为 16,212，差值 -63，严格等于
`113 removed - 50 added`。这说明 place-stage CCEI 没有夹带额外逻辑优化。

## 第一轮 E0：50 Actions

| 指标 | matched reference | generated | 变化 |
| --- | ---: | ---: | ---: |
| WNS | -59 ps | -53 ps | +6 ps |
| derived Fmax | 1788.91 MHz | 1808.32 MHz | **+1.085%** |
| TNS | -6.962 ns | -6.675 ns | +0.287 ns |
| violating paths | 283 | 288 | +5 |
| logic area | 20,175.5 µm² | 22,055.7 µm² | +9.32% |
| wirelength | 173.496 mm | 181.178 mm | +4.43% |
| modeled power | 24.678 | 26.361 | +6.82% |
| route DRC | 4 | 4 | 0 |
| final custom instances | 0 | 50 | +50 |

性能和 TNS 获得真实正收益，50 个 custom instances 全部存活。Area、wire 和 modeled power
明显变差，因此这不是完整 PPA 改善，也没有达到 5% Fmax 目标。

## Information Graph 响应

reference post-route graph 为 `8a8077fd...0452e`，generated 为 `5159ecce...ceaa7`。
391 个共同 endpoint 的变化为：

- 194 改善、176 变差、21 不变；平均 slack delta +0.281 ps；
- 35 个原 violation 被修复，39 个新 violation 出现；
- 85 个 endpoint 的已报告路径经过 custom Cell，平均改善 +2.212 ps；
- 未经过 custom Cell 的 endpoint 平均 -0.255 ps；
- 86 个 endpoint cone 逻辑深度降低，131 个增加；
- physical span 195 个降低、196 个增加；
- 两张 cone 的平均 Jaccard 为 0.693，证明全局 optimizer 进行了大量结构迁移。

reference WNS 是 `sa12_reg_0_/Q -> sa01_reg_5_/D`；generated WNS 迁移到
`sa00_reg_2_/Q -> sa30_reg_1_/D`。两条最终 WNS path 都不经过 custom Cell。Custom mapping
已经改善其直接覆盖区域，新的未覆盖 endpoint 接管了全局瓶颈。

## 第二轮 E0：真实标签剪枝的反例

第一轮 50 Actions 中，24 个在已报告 custom-path endpoints 上具有正的商业平均 slack
响应，10 个为负，14 个未进入相应报告。generated WNS cone 又发现 3 个双输出 Action。
第二轮选择 24 个“正向” Action 加 3 个 WNS-target Action，共 27 个，经 Yosys、LC、CCEI
与 matched P&R：

| 指标 | 27-Action 变化 |
| --- | ---: |
| WNS | +3 ps |
| derived Fmax | +0.540% |
| TNS | -0.048 ns |
| violating paths | -1 |
| logic area | +13.55% |
| wirelength | +6.97% |
| modeled power | +8.83% |
| route DRC | -4 |

它在频率上仍为正，但全面弱于 50-Action 结果，面积/功耗代价更大。这是关键的系统辨识
结果：Action 在一次 E0 中覆盖 endpoint 的局部正标签不能直接相加，也不能脱离当前
Design State 作为下一轮 Portfolio 排名。Reference optimizer trajectory、Action 组合冲突、布局和
clock/route 全局响应都会改变结果。

因此当前最佳仍是 50-Action E0；第二轮作为 naive commercial-label pruning 的 false-positive
样本保留。不会为了追逐数字继续盲跑第三轮。

## Proxy 成功率的正确用途

新增的成功率汇总只形成每个 factor 的 TP/FP/TN/FN、metric-positive 条件下的商业成功率、
metric-negative 条件下的商业失败率，并始终返回 `decision_authority=false`。代码不会根据
样本量或表面相关性自动把 factor 晋级为门禁；该方法变更仍需显式确认。

本轮已经得到至少两类校准事实：

- 首个 OpenSTA local factor 对单 Cell 给出负向，本轮更广 Portfolio 的 E0 Fmax 却为正，
  证明单点 local factor 无权阻止组合商业观察；
- 第一轮 Action-level 商业正标签剪枝未在第二轮形成更强 Portfolio，证明局部 Commercial
  Label 本身也不是可直接相加的全局预测器。

## 结论边界

- 已证明：observation-only 代理、source-cover 相对 Mock Library、single/multi anchored CCEI、
  两轮 matched E0 和阶段 DIG 对照可以运行；第一轮 Fmax +1.085%。
- 未证明：5% Fmax、完整 PPA 同时改善、Mock 数值对应真实 transistor characterization、
  跨 design 泛化、任何 proxy factor 已具备决策权。
- 下一轮应从新 WNS cone、D1/D2/D4/D6/D8 物理 family 和 global-response cost 入手；不能再
  用“局部正向 Action 的简单子集”作为优化器。

## 验证

- Pack domain：110/110；
- DIG/CCEI/relative-mock 相关纯逻辑检查包含 observation-only、negative proxy 放行、
  single-output anchored discovery、层次开放端口、全表替换和 library overlay；
- Node 24 workspace build：通过；
- local Host Pack contracts：31/31，Electron launches=0，SSH subprocess attempts=0；
- Library Compiler：relative Mock v1/v2/final 与 pruned Library 均完成 read/check/write；
- Yosys：50-Action 与 27-Action 组合 proof 均通过；
- Innovus：shared place、50-Action CCEI、27-Action CCEI、四条 matched P&R arms 与
  reference/generated post-route DIG exports 均完成；
- Desktop、模型调用：未运行；本轮 Framework/Pack 无 Desktop 或 prompt 改动。
