# Library Function Richness 方法升级 v2

状态：已接受方向，待按任务顺序实施。  
依据：[Fresh AES 50-Cell E0 根因分析](evidence/2026-09-16-fresh-aes-50cell-root-cause.md)。

本文只升级 `custom-cell-fmax-dtco` Pack 的现有 miner、generation projection、materialization、
license-free mapper 和 P&R 方法。它不增加 Hima Runtime 组件，不改变 Campaign owner、Fabric、Site、
Ledger 或 Pack 格式。

## 1. 目标与预算语义

下一轮仍以 matched final-database Fmax 为唯一主目标。物理 Cell 总预算为 50；一个函数的 D1、D2、
D3、D4 分别占一颗 Cell。研究程序在函数数量和 drive variant 之间分配同一预算，不能把 50 个函数
各自扩成四档后仍声称只用了 50 颗 Cell。

Library 由三类互补候选组成：

1. **phase-sensitive basic-function completion**：3/4 输入基础门的输入相位、输出相位和常用复合函数
   变体，优先吸收 inverter、减少逻辑级数；
2. **bounded single-output cone replacement**：保留当前 timing/structure miner，但以 predicted Cell
   delay margin 和 post-route survival 因子约束，不再只按覆盖量扩大 cone；
3. **multi-output shared logic**：独立免费 POC，只有形式等价、真实共享和 mapper adoption 全部成立后
   才能进入共同 Library。

## 2. 固定约束

- DC 和 APR 的 foundry/custom arm 继续保持相同 RTL 身份、约束、工具、核数、25% core、pin plan、
  setup pressure 和 DCCK-only CTS policy。
- P&R 只运行 `optDesign -postRoute -setup`。Hold 继续报告并归档，但不运行 post-route hold fix，
  不参与 Fmax 成功判断。
- F0、F1、F2、F3 继续是免费因子，E0 是一次昂贵商业观察。因子不拟合可移植收益预测器。
- 新 Cell 的 function、pin direction、pin order、truth table、timing arc 和 drive identity 全部由代码
  生成并校验；模型只选择已测候选。
- 商业 EDA 仍只验证一份冻结 Library，不建立函数、算法或 drive-strength 的商业分支比赛。

## 3. M2-01：Fmax-only post-route optimization

**状态：完成，commit `ee80268ddcc8d2ce2596e317073292fed4945f1b`。**

代码归属：

- `flow/domain/pnr.tcl.tmpl`：保留 setup optimization 和 hold report，删除 hold optimization；
- `SPEC.md`：声明 hold 为 observed secondary result；
- `flow/domain/tests/test_pnr_fmax_policy.py`：固定模板合同。

完成标准：模板含 `optDesign -postRoute -setup` 和 `timeDesign -postRoute -hold`，不含
`optDesign -postRoute -hold`。

## 4. M2-02：D1–D4 同函数 sizing

### 当前缺口

Generation request 已声明 `drive_strengths`，但 `_generation_projection.py` 只按 output 生成一个 job，
`stage_generate` 也只调用一次 bool2cmos。Site 的 D1 PDK profile 固定 NMOS/PMOS 宽度，因此当前所有
XS Cell 只有一档弱驱动，工具无法 sizing。

### 代码修改

| 文件 | 固定修改 |
| --- | --- |
| `flow/domain/_generation_projection.py` | `expected_generation_jobs` 展开 `(output, drive, vt)` 物理变体；D1 保持原名，D2–D4 使用稳定 suffix；job 明确 `drive_strength`、`drive_scale`、`vt_class` |
| `flow/domain/mine_patterns.py`、`mine_timing_route.py` | generation request 保留一份函数/接口，声明 D1–D4；F1 Library cost 等于物理变体数 |
| `flow/stages.py` | `route_args` 将现有 `DRIVE_STRENGTH` 一行解析为有序唯一列表；`stage_generate` 为每档 drive 生成 hash-bound 派生 PDK profile，按 1x/2x/3x/4x 同比缩放 NMOS/PMOS 宽度，L、拓扑、pin 和函数不变 |
| `flow/domain/charlib_emit.py` | 每个物理变体独立预测 Liberty；输出 pin 和 timing arc 集合必须与同函数 D1 完全相同 |
| `flow/domain/_cell_adoption_projection.py` | adoption 同时按 function 和 drive variant 汇总，保留工具实际 sizing 选择 |
| `flow/library_richness.py` | Library cost 和 50-Cell budget 按物理 Cell 计数，不按候选函数计数 |

派生 profile 是 run artifact，不修改 Site 原始 PDK profile。`D2=2x`、`D3=3x`、`D4=4x` 只定义
mock 宽度缩放；它不宣称等于 foundry drive naming 的硅实现。

### 验收

- 一份 3 输入函数生成 D1–D4 四个不同名称的结构 SPICE；器件数量、连接、pin 和 truth table 相同，
  W 分别为 1x/2x/3x/4x；
- abstract width 可以变化，height、pin name/direction 和 output function 保持；
- generated Liberty 的四个 Cell 均可被 Yosys/ABC 看见，至少两档可在同一 augmented mapping 中被选；
- 12 个四档函数加 2 个单档函数等于 50 颗 Cell，预算通过；51 颗在生成前拒绝；
- D1-only 历史 request replay 后仍产生原 Cell 名和原 job 数。

最低测试：`test_generation_projection.py`、新增 drive-variant domain test、`lfr-cumulative-library`、
`custom-cell-fmax-pack`；无需 Desktop 或商业 EDA。

## 5. M2-03：phase-sensitive basic-function completion

### 当前缺口

当前 single-output coverage 使用 NPN canonical identity。输入反相、输出反相和 pin permutation 被压成
一个类，因此一个 NPN-equivalent 但 phase-sensitive exact function 缺失时，miner 会把它记成
`library_covered`。所有当前可生成路线又来自 K-cut 或 2–3 Cell cluster composition，没有基础函数补洞
路线。

### 方法

增加 **P-canonical** identity：允许输入 pin permutation，保留每个输入相位和输出相位。NPN identity
继续用于功能族多样性；P identity 用于 mapper-visible coverage。

Phase-completion candidate 必须同时满足：

- 输入数为 3 或 4，单输出；
- P identity 在 foundry Library 中缺失；
- NPN identity 已存在，说明它是已知基础族的相位/结构变体；
- 当前 design 的 mapped/unmapped cut 中真实出现该 exact truth table；
- 被替换逻辑至少两级，候选目标为一级；
- bool2cmos 结构的 device count、max N/P stack 和 output width 落在声明上限内；复杂度不通过时保留
  refusal，不降级成大 cone candidate。

### 代码修改

| 文件 | 固定修改 |
| --- | --- |
| `flow/domain/cell_need_miner/npn.py` | 新增 permutation-only canonicalization 和相位 mask 描述；既有 NPN API 保持 |
| `flow/domain/mine_patterns.py` | `library_indexes` 同时构造 P 与 NPN 索引；在 `mapper_compatibility`、`functional_diversity` 现有 route 内发出 `PHASE_COMPLETION`，不新增 graph node |
| `flow/domain/mine_timing_route.py` | 关键 K-cut 若 P-missing/NPN-present，则记录 exact phase、原逻辑级数和 endpoint family；与 cone candidate 分开排名 |
| `flow/domain/mining_strategy_contract.py` | 把 `phase_completion` 加入现有两个结构 lens 的允许算法，不改变六个节点 |
| `flow/domain/cell_need_miner/generator_contract.py` | 校验 exact truth table、phase mask、P/NPN identity 和生成后等价 |

### 验收

- 一个 foundry NPN class 已存在但 exact phase 缺失的 3 输入 fixture 必须产生候选；加入 exact Cell 后
  候选消失；
- input permutation 不产生重复，input/output inversion 不再被 coverage 错误吞掉；
- 生成 Cell 的真值表逐 bit 等于设计 cut；
- 候选在增强 mapper 中被采用时，mapped level 减少至少一级；未采用仍记录为 F2 negative；
- 任一 device/stack bound 超限时只产生 refusal evidence。

## 6. M2-04：multi-output mapping POC

### 已核实基础

Site 的 bool2cmos CLI 已支持重复 `--function/--output` 生成真正的 multi-output subckt，
`charlib_emit.py` 也包含 multi-output header/arc 处理。当前阻断点在 Hima：

- `_generation_projection.py` 把每个 output 拆成独立物理 Cell；
- timing miner 将 `MULTI_OUTPUT_SHARED_LOGIC` 标成 `unsupported`；
- ABC 普通 technology mapping 不提供可审计的 arbitrary multi-output inference。

### POC 边界

POC 继续使用现有 `proxy_mapping.py` adapter，不增加 Runtime 动作。Augmented arm 在 ABC 前执行一项
确定性 subgraph replacement：把矿工保存的 exact shared subgraph 替换为一个 multi-output macro；
reference arm 保留原分解逻辑。

Replacement 必须由 Yosys 形式等价证明：原 subgraph 和 macro wrapper 进入 `equiv_make`、
`equiv_simple`/SAT、`equiv_status -assert`。证明失败、output 对不上、side output 未覆盖或多个 occurrence
重叠时 fail closed。

### 代码修改

| 文件 | 固定修改 |
| --- | --- |
| `_generation_projection.py` | 一个 multi-output request 产生一个物理 Cell job，job 持有有序 output/function 数组；single-output replay 不变 |
| `stages.py:stage_generate` | 对一个 job 向 bool2cmos 重复传入 `--function/--output`；验证一个 subckt 同时暴露全部 outputs |
| `abstract_cell.py`、`charlib_emit.py` | 验证多 output pin、每个 output 的 function/timing arc 和共享 cell identity |
| `mine_timing_route.py`、`mine_patterns.py` | 只有 `shared_logic_audit=PASS` 且完整 boundary 可替换的候选进入 POC pool |
| `proxy_mapping.py` | augmented-only、hash-bound、形式等价通过的 macro replacement；记录 replacement 数、macro census 和 proof log |
| `library_richness.py` | F2 adoption 读取 multi-output macro census；F1 记录共享节点、removed nodes/edges 和 output count |

### 验收

- Full Adder fixture 生成一个含 `S/CO` 的物理 Cell，而不是两个单输出 Cell；
- 等价 replacement 后两个 outputs 逐 bit 与原图一致；篡改任一 output 必须使形式证明失败；
- augmented mapper/netlist 真实包含 multi-output master，reference 不包含；
- Library cost 计一颗物理 Cell，不能按两个 output 计两颗；
- 在 held-out 非 FA shared-logic fixture 上完成同样证明，避免只支持硬编码 FA/compressor；
- POC 通过前 graph、commercial stages 和 release 状态不变，不启动 LC/DC/Innovus。

## 7. M2-05：因子与下一次 E0 准入

本轮不改变“免费因子不全为明确负向即可进入 E0”的已确认语义。新增因子进入同一 Pareto/关系历史：

- `drive_variant_adoption`：mapper 实际选择的 drive 分布；
- `predicted_cone_delay_margin`：相同 slew/load 下新 Cell delay 相对完整旧 cone 的 margin，并附模型误差；
- `phase_completion_level_reduction`：相位补洞带来的实际 mapped level 变化；
- `depth_survival`：license-free synthesis depth 收益经过免费物理代理后的保留比例；
- `multi_output_equivalence_and_adoption`：形式证明和 macro census。

下一次 50-Cell Library 在免费层必须完整披露这些因子；缺失值是 unknown，不转成零。研究程序依据因子
选择一份 Library，E0 仍只有一次。上一轮负样本作为
`F1 positive + F2 positive + F3 mixed -> E0 negative` 保留，不能删除或重复原 Library。

## 8. 任务顺序与并行边界

1. **M2-02A**：先冻结 variant-aware job/naming/budget schema；只有
   `_generation_projection.py` 及其测试由一位实现者拥有。
2. **M2-02B** 与 **M2-03** 并行：前者修改 materialization/characterization，后者只修改 miner/identity。
3. 合并后运行一次 D1 historical replay 和一个 50-Cell free mapping，不运行商业 EDA。
4. **M2-04** 在 job schema 稳定后独立 POC；它拥有 multi-output job 和 `proxy_mapping.py`，不接 graph。
5. **M2-05** 最后接因子和报告。只有所有免费证据可复算，才制定下一次 E0 Library。

共享文件 `stages.py` 由集成者单独接线。每项先运行相关 Python/domain/contract 子集；只有真实 Yosys/ABC
接口变化才升级 L2。Desktop 与 Hima Harness Campaign 不属于本方法切片。

