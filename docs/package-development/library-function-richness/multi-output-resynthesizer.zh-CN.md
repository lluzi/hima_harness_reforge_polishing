# Multi-output Netlist Resynthesizer 规格

状态：设计冻结，先做隔离 POC。  
归属：`custom-cell-fmax-dtco` Pack 的 domain tool；不是 Hima Runtime 组件，也不是通用 RTL synthesis 产品。

## 1. 决定

商业综合工具不承担任意 multi-output Cell 的机会发现与 mapping。Hima 提供一个独立的
netlist-to-netlist resynthesizer，在商业 DC 输出与 placement 之间执行局部逻辑 ECO：搜索机会、评估
收益、实例化 multi-output master、证明等价，并输出可回滚 patch。Innovus、ICC2 或 Fusion Compiler
只负责 link 和物理实现已经存在于网表中的 Cell。

第一版是 **logical in-place ECO**：保持 top、ports、registers、clock/reset/test boundary 和 SDC 身份，
只替换 disjoint combinational windows。Placement-aware physical folding 是后续模式，不与第一版混合。

## 2. 已核实的 mockturtle 能力与限制

固定审计快照：mockturtle commit `0886ebfdd101ce1110daf3d60b96d72edd3143ea`。

- `emap` 接受逻辑网络与 `tech_library`，`map_multioutput=true` 时映射 multi-output Cell；
- 返回 `cell_view<block_network>`，一个 node 可代表一个 multi-output Cell；
- `write_verilog_with_cell` 可输出带 Cell instance 的结构 Verilog；
- GENLIB 中同名的多个 output gate 被组合成一个 multi-output Cell；
- 自带 ripple-carry adder 和 multiplier multi-output mapping 测试；
- 当前 `tech_library` 最多两个 outputs，multi-output cut 最多三个 leaves；
- upstream opportunity enumeration 已用 leaf-set hash bucket，但 bucket 内仍执行 root-pair 双循环；
- upstream 源码将当前 multi-output enumeration 标为 experimental，并注明 restricted to half/full adders；
- exact-area 路径仍有 multi-output required-time TODO，delay cost 只能作为免费因子，不能替代 E0 timing。

POC 固定在 **最多3输入、2输出**。扩大到4输入或更多输出属于后续 mockturtle 扩展，不能静默修改常量。

## 3. 深模块接口

外部只有一个命令：

```text
hima-mo-resynth --request request.json --result result.json
```

调用者不学习 mockturtle network、cut、cell_view 或内部 node id。工具自己持有 Library elaboration、
mapping、window provenance、ECO、writer 和 equivalence 的复杂度。

### 3.1 Request

```json
{
  "schema": "hima.multi-output-resynthesis-request/1",
  "mode": "rewrite",
  "top": "aes_cipher_top",
  "netlist": {"path": "input.v", "sha256": "..."},
  "library": {
    "genlib": {"path": "mapping.genlib", "sha256": "..."},
    "liberty": {"path": "timing.lib", "sha256": "..."},
    "allowedMultiOutputMasters": ["XS_FA_D2"]
  },
  "timing": {
    "clockPeriodPs": 500.0,
    "arrivalTimesPs": [],
    "requiredTimesPs": []
  },
  "scope": {
    "maxInputs": 3,
    "maxOutputs": 2,
    "maxReplacements": 50,
    "preserveRegisters": true,
    "preservePorts": true,
    "preserveHierarchy": true
  },
  "physicalContext": {
    "def": null,
    "maxSinkBoundingBoxUm": null,
    "maxHpwlIncreaseUm": null
  },
  "tools": {
    "mockturtleCommit": "...",
    "binarySha256": "...",
    "buildFlags": ["..."]
  },
  "outputDir": "out"
}
```

所有 path 是 workspace 内普通文件并受 SHA-256 约束。第一版 `physicalContext.def=null`，物理指标为
unknown；有 DEF 时才允许产生 locality 结论。`mode` 只允许 `analyze` 或 `rewrite`：前者不写 ECO
netlist，后者必须同时生成 patch 和 equivalence proof。

### 3.2 Result

```json
{
  "schema": "hima.multi-output-resynthesis-result/1",
  "status": "succeeded",
  "inputNetlistSha256": "...",
  "rewrittenNetlist": {"path": "rewritten.v", "sha256": "..."},
  "patchManifest": {"path": "patches.json", "sha256": "..."},
  "equivalenceProof": {"path": "equivalence.json", "sha256": "..."},
  "opportunities": [],
  "selectedReplacements": [],
  "mapping": {
    "area": 0.0,
    "delayIndicator": 0.0,
    "multioutputGates": 0,
    "runtimeMs": 0.0
  },
  "claimLimits": {
    "commercialTiming": false,
    "physicalBenefit": false,
    "fmaxImprovement": false
  }
}
```

`status=succeeded` 只表示网表、patch 和证明完备，不表示 QoR 正收益。

## 4. 实现流程

### 4.1 Normalize

Yosys 读取商业 DC gate-level netlist，将 sequential Cell、clock/reset/test nets 和用户声明的 dont-touch
objects 设为 boundary，只导出组合 subject graph。导出时生成 source map：每个 AIG node 对应原 module、
instance、pin、net 和层次路径。没有 source map 的 node 不能产生 ECO patch。

### 4.2 Whole-network mapping

同一 subject graph 运行：

- ABC/reference：只使用 single-output Library；
- mockturtle/augmented：`emap`、P-configuration、`map_multioutput=true`，使用相同 single-output cells 加
  声明的 multi-output cells。

保存 `emap_stats`、Cell census、cut statistics、runtime 和完整 mapped netlist。mockturtle 的 delay/area
只用于筛选。

### 4.3 Large-netlist opportunity index

DC Verilog 与 Liberty 先形成三个关联视图：

1. **netlist graph**：instance、pin、net、driver/load、hierarchy 和 sequential boundary；
2. **Boolean graph**：把每个 Liberty output function 展开为 AIG，并保留 AIG node 到 source
   instance/pin/net 的多对多 provenance；
3. **multi-output Library relation**：一个 master 的 ordered inputs、两个 output truth tables、pin-to-output
   delays、area 和 drive identity，形成 `(f1, f2) -> master` 索引。

机会发现不枚举全网 root pair。算法按以下顺序执行：

1. 保留 hierarchy，并按 module 和 register-to-register combinational region 分区；
2. 在每个 topological level 并行枚举每个 root 的 bounded K-feasible cuts；
3. 每个 cut 生成 `(ordered-leaf-set, output-function-id, root-id)`；
4. 第一层按 ordered leaf set 分桶，第二层按 output function id 分桶；
5. 只对 Library 声明可组成同一 multi-output master 的 `(f1, f2)` 做 hash join；
6. 对命中项检查 shared interior、完整 side outputs、sequential boundary 和 source provenance；
7. 输出 opportunity，不在发现线程中修改网表。

因此发现成本主要随 `nodes × bounded-cuts-per-node` 和真实 hash hits 增长，不随全网 roots 的平方增长。
某个 leaf/function bucket 超过固定上限时保留 `bucket-overflow` refusal，并按 criticality、support 和
module 切分后重试，不能退化成无界 pair loop。

并行边界：

- module、sequential region、同一 topological level 和 leaf bucket 可以并行；
- Library lookup、truth-vector matching 和 benefit evaluation 可以并行；
- 最终 patch selection 需要全局冲突信息，按独立 module/region 分组后确定性选择；
- 跨 partition candidate 进入单独边界队列，不与局部结果并行提交。

最终选择把每个 opportunity 看作一个占用 source instances/nets 的集合。先按 timing margin、removed
levels、area、locality 和 model uncertainty 排序，再做 deterministic greedy set packing 和一次 bounded
local improvement。它不是精确全局最优，但输出稳定、可回放，并且不会产生 overlapping ECO。

### 4.4 ECO provenance

标准 `write_verilog_with_cell` 能输出全网 mapped netlist，但它会重建内部 node/instance naming，不能直接
成为 in-place ECO。Hima wrapper 必须为每个 selected multi-output mapping 额外保存：

- two roots、ordered leaves 和 truth tables；
- source AIG nodes；
- original instances/nets；
- boundary input/output nets；
- selected master 和 output-pin mapping；
- overlapping candidate ids；
- baseline single-output cover cost 与 multi-output cover cost。

只有 source map 完整且与其他 patch 不重叠的 mapping 才能进入 rewrite。全网 writer 输出保留为
diagnostic reference，不作为商业交付网表。

### 4.5 Benefit and locality

每个 opportunity 单独记录：

- removed Cell/edge/level 数；
- multi-output Cell area 和每个 output 的 delay indicator；
- output required-time margin；
- fanout、load 和两个 output sink 集合；
- 有 DEF 时的 sink bounding box、HPWL delta 和 pin-access refusal；
- model uncertainty。

选择器以完整向量做 Pareto 排序。内部共享量不能覆盖 sink divergence 或负 timing margin。

### 4.6 Rewrite

Rewrite 操作在解析后的结构网表 IR 上完成，不使用文本正则：

1. 验证 boundary nets 仍由 manifest 指定的 driver/load 使用；
2. 删除 window 内原 combinational instances 和仅供内部使用的 nets；
3. 插入一个 multi-output master；
4. 按 manifest 连接 ordered inputs 和每个 output；
5. 生成稳定 instance/internal-net 名；
6. 拒绝 multi-driver、dangling output、跨 sequential boundary、overlap 和 source hash drift。

原 netlist 保持只读。`patches.json` 同时携带 removed fragment 和 inserted fragment，可重建原 window。

### 4.7 Equivalence

两层证明都必须通过：

- window proof：ordered boundary truth vector 完全相等；
- top proof：Yosys miter/SAT 证明 original 与 rewritten top 组合等价，register boundary 逐一对应。

任一 unknown、timeout 或 unsupported construct 均为 refusal，不能输出可进入商业链的 rewritten netlist。

## 5. 商业工具链插入位置

```text
RTL
  -> Design Compiler ordinary synthesis
  -> original gate-level netlist + SDC
  -> hima-mo-resynth
  -> formally equivalent ECO netlist with explicit multi-output instances
  -> Innovus / ICC2 / Fusion Compiler physical implementation
```

商业工具不再负责 multi-output discovery。它们只需：

- link 对应 Verilog/Liberty DB/LEF；
- 接受已经实例化的 multi-output master；
- 保留 register、port 和 SDC identity；
- 在最终数据库中提供 master census 和 timing evidence。

第一项商业隔离试验以同一份 foundry DC netlist为起点：reference 直接 APR，generated 只增加已证明的
multi-output ECO。这样唯一方法变量是 multi-output Library 加其必需的 mapping adapter。与 D1–D4、
phase-completion 混合的完整 Library 留到该隔离试验通过后。

## 6. HimaPack 接线

不增加 graph node。现有 `custom-synth` stage 在 DC 完成后调用 resynthesizer，并将 rewritten netlist 继续
发布为 `synthesis_netlist`。新增 artifact 是 `multioutput_opportunities`、`eco_patch_manifest`、
`multioutput_mapping_stats` 和 `equivalence_proof`。Reader/Judge 只读取这些 artifact，不复制 mapper
事实。

建议文件归属：

| 文件 | 职责 |
| --- | --- |
| `flow/domain/multi_output_resynth.py` | request/result、hash、workspace、Yosys proof 和错误收敛 adapter |
| `flow/domain/multi_output_resynth/main.cpp` | pinned mockturtle reader、Library elaboration、emap、provenance 和 diagnostic writer |
| `flow/domain/multi_output_resynth/netlist_eco.py` | 结构 Verilog IR patch 与 rollback manifest |
| `flow/domain/proxy_mapping.py` | 免费 reference/augmented 调用和指标并列，不实现 ECO |
| `flow/stages.py` | 在现有 custom-synth 职责内调用工具并发布 artifacts |
| `flow/read-stage.py` | 将 mapping/adoption/proof/locality 投影为事实 |

这个目录是一个深模块：外部只有 request/result interface，mockturtle/Yosys/ECO 细节不泄漏到
`stages.py`。

## 7. POC 退出标准

### 功能

- 8-bit Full Adder fixture 使用 8 个 multi-output Cell 完成 ripple-adder mapping，与 pinned mockturtle test
  结果一致；
- 非 FA 双输出 fixture 至少产生一个 multi-output mapping；若 pinned upstream 失败，POC 必须以最小
  反例定位其 HA/FA 特化点，不能把 FA 通过表述成通用能力；
- 大网表 synthetic fixture 的 discovery 数量增加 10 倍时，禁止出现全网 root-pair 平方增长；记录
  cuts、bucket sizes、hash hits、pair checks、runtime 和 peak RSS；
- structural Verilog 只实例化允许的 multi-output masters；
- window 和 top equivalence 均通过；篡改任一 output 必须失败；
- patch rollback 重建原 netlist hash。

### 收益

- 相对 ABC reference 提供 whole-network area、delay indicator、runtime 和 Cell census；
- 至少一个 candidate 在 OpenROAD placement proxy 中通过 sink-locality gate；
- divergence 反例保留为负因子；
- 未测 commercial timing、route benefit 和 Fmax 明确为 unknown。

### 兼容

- 没有 multi-output Library 时 rewritten netlist 等于输入 hash；
- single-output Pack 历史 replay 不调用工具；
- current graph、Runtime、Site Permit 和 release 逻辑不变；
- POC 期间 LC/DC/Innovus Job 为零。

## 8. 已知限制

- 当前 pinned mockturtle 仅支持 3-leaf、2-output multi-output cuts；
- 当前 upstream multi-output matcher 对 HA/FA 有显式实验性假设，通用双输出能力尚待 held-out 证明；
- upstream leaf bucket 内有 pair loop；Hima 大网表 adapter 必须增加 function-id join 和 overflow bound；
- required-time exact-area 路径存在 upstream TODO；
- GENLIB 同名 outputs 的 Library elaboration需要与 Hima multi-output Liberty pin/area/delay identity 对账；
- `emap` 的全网 output 不是自动安全的局部 ECO，source provenance 和 patch proof 是 Hima 必须补的部分；
- pre-placement logical ECO 不能证明物理 sink locality，OpenROAD/DEF evidence 是独立因子；
- 商业工具是否完整保留 master 只能由最终数据库 census 证明，不能由读库成功代替。
