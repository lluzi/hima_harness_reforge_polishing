# AES Post-route DIG v4 开发与免费闭环证据

日期：2026-09-16  
轨道：Library Function Richness / GitHub Issue #40  
结构化摘要：[aes-dig-v4-free-closure.summary.json](aes-dig-v4-free-closure.summary.json)

## 结论

后续 Owner 决策已取消免费代理的 E0 拒绝权。本报告中的 `skip E0` 是当时方法的历史记录，
已由 append-only invalidation annotation 失效。新的 observation-only commercial calibration
见 [AES DIG v4 商业校准](2026-09-16-aes-dig-v4-observation-calibration.md)。

V4 的 Pack 内基础设施、真实 AES 双阶段图、graph-native Opportunity、place-state
anchored resynthesis、单项 CCEI apply/rollback、Yosys proof、OpenSTA 局部代理与
useful-skew 配置探针已经形成可执行闭环。完整 E0 没有运行：唯一送入 CCEI seam 的
Cell 在免费 OpenSTA 对照中覆盖 30 条路径。按每个 start/end pair 的 worst slack 复算后，
14 个可比 pair 中 11 个变差、3 个改善，delta 为 -3.138 ps 到 +1.463 ps，平均
-0.656 ps。强制经过相同逻辑分支时，新 Cell 的 I0→Y1 为 22.149 ps，原 INV+NAND
source cover 为 15.089 ps，局部慢 7.060 ps。按 V4 门禁，该 Action 被拒绝，
不能再让商业 route 充当试错引擎。

这轮证明的是方法和控制闭环，不是 Fmax 收益。它没有产生新的商业 QoR、没有证明
OpenSTA 等于 Innovus，也没有将 HAL 或完整 D1/D2/D4/D6/D8 family 晋级为现场依赖。

## 已实现的现有模块升级

- `design_information_graph.py`：hash-bound projection、Liberty 顺序/组合属性、稳定
  PathAlternative identity；
- `dig_store.py`：SQLite snapshot、hyperedge、RTree、append-only annotation、lineage、
  LocalWindow 与单事务 AES 导入；
- `opendb_dig.py`：LEF/DEF 导入、`.odb` save/reload、instance/pin/net/geometry 与语义边界；
- `innovus_dig_export.tcl`、`build_dig_bundle.py`、`innovus_timing_facts.py`：只读 checkpoint
  导出、SPEF 重建、bounded timing view 与 manifest；
- `cross_phase_graph.py`：双数据库 correspondence、歧义/缺失保留、Opportunity region
  投影；
- `mine_timing_route.py`、`mine_patterns.py`：完整结构 cone、四象限与共享 endpoint
  influence；
- `proxy_mapping.py`、`opensta_dig.tcl`：并列局部因子和可替换 STA view，不输出全局 MHz；
- `_generation_projection.py`：D1/D2/D4/D6/D8 电气/几何单调性 contract；
- `multi_output_resynth/service.py`：`anchored` operation、1～2 hop 局部搜索、显式 backend
  fallback；
- `innovus_ccei.py`：placed-state apply/rollback、centroid seed、PG、dont-touch、ecoPlace、
  census 与 checkpoint；
- P&R stage/Reader：保留并验证 `place_checkpoint`；P&R template 启用相同的 Early Clock /
  useful skew 策略，借用上限为 100 ps。

这些文件继续属于现有 `custom-cell-fmax-dtco` Pack。没有新增 Runtime/Fabric 动作、服务、
外部图数据库或第二个 resynthesizer。

## 真实数据结果

### 双阶段图

| 项目 | baseline coarse place | 负样本 generated post-route |
| --- | ---: | ---: |
| instances | 16,647 | 28,224 |
| pins | 81,196 | 106,284 |
| nets | 15,466 | 16,313 |
| driver-to-sink hyperedges | 15,464 | 16,313 |
| endpoints | 389 | 389 |
| graph SHA-256 | `0b3b97be...327d1` | `5f66aae9...a183` |

OpenDB 对 post-route 的 28,224 instances、16,313 nets 和 106,284 pins 完成导入、保存、
重载与确定性 projection；没有出现 multi-output pin 或 regular net 静默丢失。

timing report 的结果反而证实 path list 不能作为 timing graph：38,470 条记录覆盖 389 个
endpoint，其中 384 个 endpoint 已触及每端 100 条上限。因此该层被标为 `partial`；完整性
来自 netlist hypergraph 上的 endpoint cone，而不是继续提高 Top-N。

### CrossPhaseMap 与 Opportunity

post-route 到下一轮 baseline place 的 correspondence 为：64,005 `one-to-one`、1,086
`semantic-region`、38 `many-to-one`、124,551 `absent`。389 个 post-route endpoint region
均可投影到非空 place candidate region；覆盖率为 36.1%～90.5%，中位 64.7%。这些是搜索
区域，不是 ECO target。

389/389 endpoint 的结构 cone 完成。四象限结果：358 `deep-long`、26 `deep-short`、5
`shallow-short`；最大逻辑深度 23，最大局部物理跨度约 126.0 µm，一个共享节点最多影响
128 个 endpoint。这说明该 AES 的主要控制问题确实是跨 endpoint 的深逻辑与长物理路径，
不是某一条 report path 上的一颗 Cell。

### place-state anchored CCEI

旧 post-route 信息只作为 seed/stable-net 提示。在 baseline place netlist 上重新搜索后：

- 62 个 function-matched Opportunities；
- 50 个互不重叠窗口；
- 16,806 cuts、117 hash hits、119 pair checks；
- runtime 81.8 s，peak RSS 43,060 KiB；
- Yosys 对所选 `aes_sbox_9` 修改完成层次等价证明。

单项 Innovus seam 将 4 个 place-state source instances 合成
`XS_CGO_ENDPOINT_FRONTIER_MAPPED_MULTI_0020_MO_D8`。apply 后新实例为 1、
`dont_touch=true`，位置为 `(39.48, 134.3)`；rollback 后新实例为 0，四个 source 全部恢复。
baseline/apply/rollback 的 `checkPlace` violation 分别是 11791/11788/11791，说明 apply 没有
增加 placement violation，rollback 恢复了原始计数。绝对 violation 是保留 checkpoint 的
既有状态，不能写成新 ECO 的通过数字。

### 免费局部代理与停止决定

OpenSTA 对 baseline/applied 使用同一 Liberty、SDC 和 baseline SPEF。两边 2,000-path
上限下的全局 worst slack 都是 -33.178 ps；新 Cell 出现在 30 条已报告路径。按每个
start/end pair 保留 worst slack 后，14 个可比 pair 中 11 个负向、3 个正向，平均
-0.656 ps。一个固定 `sa22_reg_3_/Q -> sa10_reg_2_/D` 分支中，原 source cover 从输入
到 `n171` 约 15.089 ps，新 Cell I0→Y1 约 22.149 ps；该分支 slack 从 -26.008 ps
变为 -30.914 ps。新 Cell 还把原先排名靠后的逻辑分支推入更关键的位置。这两项证据与
全局 proxy WNS 无改善共同构成拒绝理由。

初版分析曾错误地用每个 pair 的“最后一条路径”而不是 worst path，得到“22/22 全负”的
错误统计。原 annotation 保留并以 `invalidation` 标记失效；本报告和 v2 annotation 使用
上述 worst-per-pair 复算结果。

因此 annotation lineage 为：

```text
opportunity proposal
  -> local-proxy: rejected-negative-local-proxy
  -> decision: blocked-by-negative-local-proxy
```

旧 100-Cell 商业负样本以 `commercial-response` 写入 post-route DIG，继续标记为
`locally-positive-path-migrated`。本轮没有新的完整 E0 job。

## 过程中被反证并修正的问题

1. `edarun` 不透传任意环境变量：exporter 同时支持显式 Tcl setting；
2. restore 后没有可直接 `rcOut` 的内存 RC：在一次性进程中从 checkpoint geometry
   `extractRC`，不保存回原 DB；
3. `defOut` 默认不含 regular nets：改为 `-netlist`，post-route 再加 `-routing`；
4. 逐对象 SQLite commit 导致 AES 导入不可接受：改为单事务批量导入；
5. 空 filler boundary 产生相同 semantic signature，CrossPhaseMap 曾平方膨胀到约 18 GB：
   空边界不签名，超过 16 个候选的非唯一签名直接 fail closed；
6. report rank 不能作为跨阶段 PathAlternative identity：改为 beginpoint、endpoint 与 ordered
   pin/edge digest；
7. DC window 不能直接操作 place：第一次计划因 source 已消失而拒绝，随后改为 place-state
   anchored rediscovery；
8. Innovus `addInst -moduleBased` 接受 module type，不接受 hierarchy instance；
9. `-loc` 不能与 `unplaced` 同用；
10. `get_cells full/path` 的空集合曾使 dont-touch 静默失效：现在唯一 census 不等于 1 就拒绝；
11. `saveDesign` base 和 `restoreDesign` `.dat` 目录被分开建模。

所有失败日志保留在 Site workspace；没有用最后一次成功覆盖这些失败事实。

## 测试

- L0/L1：Pack domain tests 106/106 通过；其中 DIG/CCEI 相关 tests 32/32 通过，覆盖身份、事务、
  RTree、hyperedge、annotation、CrossPhaseMap、容量反例、LocalWindow、四象限、local proxy、
  drive family、anchored discovery、HAL 显式 fallback、CCEI script 与 useful skew policy；
- L2 Host：Node 24 build 通过；`custom-cell-fmax-pack.test.ts` 与
  `lfr-cumulative-library.test.ts` 共 31/31 通过；零 Electron、零 SSH subprocess；
- L2 真实 AES 免费层：OpenDB、SQLite、CrossPhaseMap、Opportunity、anchored native、Yosys、
  OpenSTA 已执行；
- L3 小型商业 seam：coarse place、单项 CCEI apply/rollback 和 useful-skew 配置 probe 已执行；
- L4 完整 E0：未运行，原因是本轮 local proxy 明确负向；
- Desktop：未运行，Framework 没有 Desktop 改动。

## 尚未晋级的能力

- HAL 未安装，`hal_v0` 保持显式不可用；`native_v1` 是本轮实际 backend；
- OpenTimer 与 LadybugDB 没有材料收益，未集成；
- D1/D2/D4/D6/D8 contract 已实现，完整电气/LEF/Liberty/LC family 尚未物化；
- useful skew 的 100 ps 设置已由 Innovus 23.14 读回为 0.1 ns，但尚无 matched full-route
  baseline/generated 商业结果；
- 下一次 E0 必须从新的正向、冻结 Action Portfolio 出发，不能复用本轮被拒绝的 Cell。
