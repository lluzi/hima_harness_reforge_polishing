# SWERV28 28 nm Foundation Flow 与 PT→XTop 迭代式 Timing Closure 方法学

文档状态：2026-09-21 已在 `linglong` 实机验证。本文面向后续执行 Agent，描述已经跑通的流程、完成判据、证据位置、恢复方法和当前未闭合边界。

## 1. 先读这里

当任务涉及 SWERV28 的 Innovus、StarRC、PrimeTime、XTop、ECO、重新提取或重新 STA 时，按以下顺序执行：

1. 把服务器上的 Foundation Flow 目录视为唯一可执行权威。
2. 检查存储、许可证、活动进程、阶段 marker、日志和产物。
3. 从最后一个“marker、日志、产物三者一致”的阶段继续。
4. 每一轮 ECO 使用新的迭代目录、STA 数据和 ECO 单元前缀。
5. XTop 结果是优化预测；只有回灌 Innovus、ecoRoute、重新 StarRC 和重新 PrimeTime 后的结果，才是该轮实际结果。
6. 用返回码、非空产物、日志错误数、时序/DRC/连通性报告共同判定完成。

完成一次 timing-closure 迭代的判据是：

```text
PT baseline
  -> XTop fix
  -> XTop ECO files
  -> Innovus loadECO + physical Tcl + ecoRoute
  -> routed DEF/netlist
  -> StarRC SPEF
  -> PrimeTime refreshed STA
  -> before/after comparison
```

其中任一步失败，本轮保持未完成；保留失败日志和已有产物，从失败 marker 恢复。

## 2. 权威、范围与边界

### 2.1 权威路径

| 用途 | 服务器路径 | 权限语义 |
|---|---|---|
| 可执行 Foundation Flow | `/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation` | 本流程唯一修改和执行位置 |
| 输入副本 | `/data/eda/project/design_zoo/flows/swerv_wrapper_tsmc28/input` | 只读输入，不在其中生成运行产物 |
| TSMC28 技术文件 | `/data/eda/project/techlib/tsmc28` | 只读技术权威 |
| EDA 服务器指南 | `/data/eda/project/design_zoo/docs/EDA_SERVER_AND_DESIGN_ZOO_AGENT_GUIDE.md` | 环境证据；当前用户请求决定操作授权 |
| 本地可编辑镜像 | `/Users/lluzi/Documents/linglong setup/a53_foundation` | 修改脚本后同步到服务器 |

`/home/luzi/Downloads/a53` 仅是历史输入来源，不是部署或运行位置。新 Agent 不应在那里继续本流程。

### 2.2 当前工艺与工具

| 项目 | 已验证值 |
|---|---|
| Design | `swerv_wrapper` |
| 工艺/金属栈 | TSMC 28 nm HPC+，`1P10M_5X2Y2Z` |
| Tech LEF | `tsmcn28_10lm5X2Y2ZUTRDL.tlef` |
| Innovus | `23.14-s088_1` |
| StarRC | `X-2025.06-SP1` |
| PrimeTime | `X-2025.06` |
| Library Compiler | `T-2022.03` |
| XTop | `2025.09.tmp15` |
| EDA userland | AlmaLinux 容器 `eda-runner-interactive-luzi`，由 `/usr/local/bin/edarun` 进入 |

四个 Liberty 目录各包含 20 个 `.lib`，LEF 目录包含 20 个 `.lef`。PrimeTime 使用由这 80 个 Liberty 编译出的 `.db`。

### 2.3 四场景定义

| 场景 | Liberty PVT | SPEF |
|---|---|---|
| `func_ssg_rcworst_m40` | `ssg0p81vm40c` | `cworst_T` |
| `func_ssg_rcworst_125` | `ssg0p81v125c` | `cworst_T` |
| `func_ffg_cbest_m40` | `ffg0p99vm40c` | `cbest` |
| `func_ffg_cbest_125` | `ffg0p99v125c` | `cbest` |

### 2.4 这是什么，不是什么

该部署已经证明以下链路可执行：Innovus post-route DEF → StarRC → PrimeTime → XTop → Innovus ecoRoute → 重新 StarRC → 重新 PrimeTime。

这不等于 sign-off clean。当前仍存在负 slack、每个 PT 场景 3 个 unconstrained endpoints、72,799 条全芯 DRC 和报告上限内的 1,000 条 VDD special-wire open。方法学必须区分“流程贯通”和“设计闭合”。

## 3. 启动前门禁

### 3.1 主机侧检查

在 Ubuntu 主机执行：

```bash
cat /sys/class/nvme/nvme1/state
findmnt -no SOURCE,FSTYPE,OPTIONS /data
df -hT /data
pgrep -a -f '(innovus|StarXtract|pt_shell|lc_shell|xtop|make all)'
```

完成判据：

- `nvme1` 为 `live`；
- `/data` 是 `/dev/nvme1n1p1` 上的读写 XFS；
- 空间足够；
- 没有需要保护的活动 EDA 作业；僵尸进程不视为运行作业；
- Synopsys、Cadence、Empyrean license services 为 active。

然后执行：

```bash
cd /data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation
make preflight
```

`scripts/preflight.sh` 检查关键输入、20 个 LEF、四角各 20 个 Liberty、设计名、0.8 ns clock、许可证服务、工具启动和关键输入哈希。活动大作业存在时返回码为 75。只有用户明确授权时才设置 `ALLOW_BUSY=1`。

### 3.2 EDA 运行模型

商业工具在 AlmaLinux 容器内运行。主机侧标准入口为：

```bash
env EDA_CONTAINER=eda-runner-interactive-luzi \
  /usr/local/bin/edarun bash -lc '<command>'
```

不要在 Ubuntu host 直接启动商业工具，也不要绕开 `edarun` 自行拼接库路径。StarRC 的 TBB 兼容路径只在 `scripts/run_starrc.sh` 和迭代脚本中局部设置。

## 4. Foundation Flow 状态机

`Makefile` 是初始全流程的编排权威。依赖链如下：

```text
setup
  -> init
  -> place
  -> cts
  -> postcts_hold
  -> route
  -> postroute
  -> starrc
  -> pt_dbs
  -> pt
  -> xtop
  -> eco_route
```

### 4.1 阶段、入口和完成判据

| 阶段 | 主要入口 | 关键输出 | 完成判据 |
|---|---|---|---|
| preflight | `scripts/preflight.sh` | `PRECHECK/summary.txt`, `critical_inputs.sha256` | 返回码 0，工具/许可/输入通过 |
| init | `FF/INNOVUS/run_init.tcl` | `DBS/init.enc.dat` | Innovus 0 error，DB 存在 |
| place | `FF/INNOVUS/run_place.tcl` | `DBS/place.enc.dat` | Innovus 0 error，DB 存在 |
| cts | `FF/INNOVUS/run_cts.tcl` | `DBS/cts.enc.dat` | CTS 完成，DB 存在 |
| post-CTS hold | `FF/INNOVUS/run_postcts_hold.tcl` | `DBS/postcts_hold.enc.dat` | 优化完成，DB 存在 |
| route | `FF/INNOVUS/run_route.tcl` | `DBS/route.enc.dat` | detail route 完成，DB 存在 |
| post-route/export | `FF/INNOVUS/run_postroute.tcl` | `DBS/postroute_final.enc.dat`, post-route DEF/netlist/SDC | 日志 0 error，DEF/网表非空 |
| StarRC | `scripts/run_starrc.sh` | 两个 SPEF 和 `spef.sha256` | 两角日志 Errors=0，SPEF 非空 |
| PT DB | `scripts/compile_pt_dbs.sh` | `SIGNOFF/PT/libdb/`, manifest | 80 个非空 DB，manifest 81 行含表头 |
| PrimeTime | `scripts/run_pt.sh` | 四场景报告、XTop timing data | link 成功、有 clocks、有 max path、无 Error/Fatal |
| XTop | `scripts/run_xtop.sh` | timestamp run、两类 ECO 文件 | fix 完成、ECO 文件非空、日志无 Error/Fatal |
| ECO route | `FF/INNOVUS/run_xtop_eco_route.tcl` | ECO DB/DEF/网表、DRC/连通性报告 | loadECO 成功、ecoRoute 完成、产物非空 |

marker 位于 `make/<stage>`。marker 只是缓存，不是独立证据。确认阶段完成时必须同时检查 marker、日志、产物和阶段报告。

### 4.2 初始全流程命令

```bash
cd /data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation
make preflight
make init
make place
make cts
make postcts_hold
make route
make postroute
make starrc
make pt_dbs
make pt
make xtop
make eco_route
```

或运行：

```bash
make all
```

`make all` 可从已有 marker 恢复。不要删除前序证据来“重跑干净”；失败时归档失败日志，移除或拒绝生成失败阶段 marker，然后从该阶段恢复。

## 5. Post-route 物理交接

`FF/INNOVUS/run_postroute.tcl` 从 routed DB 完成 post-route 优化并显式写出：

```text
EXPORT/swerv_wrapper.postroute.def
EXPORT/swerv_wrapper.postroute.v
EXPORT/swerv_wrapper.postroute.sdc
EXPORT/swerv_wrapper.input.sdc
EXPORT/swerv_wrapper.lef
```

StarRC 使用 DEF 和完整 LEF 集；PrimeTime 使用门级网表、输入 SDC、编译 DB 和 SPEF；XTop 使用网表、DEF、LEF、Liberty 和 PrimeTime timing data。不要让三个工具从不同物理版本读取输入。

## 6. StarRC 方法

### 6.1 初始提取

入口：

```bash
env EDA_CONTAINER=eda-runner-interactive-luzi \
  /usr/local/bin/edarun bash -lc 'scripts/run_starrc.sh'
```

命令文件：

- `SIGNOFF/STARRC/cworst_T.cmd`
- `SIGNOFF/STARRC/cbest.cmd`

关键设置：

- `TOP_DEF_FILE` 指向本轮 routed DEF；
- `MAPPING_FILE` 指向 TSMC28 StarRC mapping；
- `TCAD_GRD_FILE` 分别使用 `cworst_T.nxtgrd` 和 `cbest.nxtgrd`；
- `COUPLE_TO_GROUND: NO`，保留 coupling capacitance；
- `NETLIST_FORMAT: SPEF`；
- `NUM_CORES: 8`。

完成判据：

```bash
rg 'Errors:[[:space:]]*[1-9]|^ERROR:|^Error:|^Fatal:' SIGNOFF/STARRC/*.log
test -s SIGNOFF/STARRC/swerv_wrapper.cworst_T.spef
test -s SIGNOFF/STARRC/swerv_wrapper.cbest.spef
sha256sum -c SIGNOFF/STARRC/spef.sha256
```

NXTGRD 是 2015 年文件。其年代本身不是通过依据；真实 StarRC 日志 Errors=0、SPEF 非空和 PT 可成功读入才构成兼容性证据。

## 7. PrimeTime 与 XTop timing-data 交接

### 7.1 为什么先编译 DB

直接在 PrimeTime 中逐个 `read_lib` 曾出现设计无法可靠 link、标准单元被 blackbox 的情况。当前流程用 Library Compiler 将四角共 80 个 Liberty 编译为 `.db`：

```text
SIGNOFF/PT/compile_libs.tcl
scripts/compile_pt_dbs.sh
SIGNOFF/PT/libdb/<corner>/*.db
SIGNOFF/PT/libdb_manifest.tsv
```

该转换是输入适配，不改变 PVT。manifest 记录 Liberty 和 DB 的 SHA-256。

### 7.2 PrimeTime 每个场景的步骤

`SIGNOFF/PT/run_scenario.tcl` 对每个场景执行：

1. 把该角全部 DB 放入 `target_library` 和 `link_path`；
2. 读取本轮网表并 `link_design swerv_wrapper`；
3. 把输入 SDC 中硬编码的 `ssg0p81vm40c` driving-cell library 替换为当前场景 library；
4. 读取归一化 SDC，并确认至少一个 clock；
5. 读取对应 SPEF，设置 propagated clocks，`update_timing -full`；
6. 确认至少存在一条 constrained max path；
7. 写出 `check_timing`、global timing、constraint、setup、hold 报告；
8. source XTop 官方 `timing_data_0.tcl`；
9. 执行 `report_scenario_data_for_icexplorer` 和 `report_pba_data_for_icexplorer`。

关键输出：

```text
SIGNOFF/PT/reports/<scenario>/
SIGNOFF/PT/sta_data/<scenario>_data_*
SIGNOFF/PT/sta_data.sha256
```

完成判据：

- 四个 PT 日志均无 `Error:`/`Fatal:`；
- 四个 `<scenario>_data_finish` 非空；
- setup report 不是 `No constrained paths`；
- `check_timing.rpt` 中的 unconstrained endpoint 数量已记录并解释。

### 7.3 XTop 导入和 fix

`SIGNOFF/XTOP/run_xtop.tcl` 执行：

1. 读取 Tech LEF、cell LEF、网表和 DEF；
2. 创建四个 timing corners、一个 `func` mode 和四个 scenarios；
3. 从 PT `sta_data` 读取 timing；
4. 检查 reference/timing library 对应关系；
5. 执行 setup 和 hold fix；
6. 写出 Innovus ECO netlist 指令和 physical Tcl。

已验证的 fix 顺序为：

```tcl
fix_setup_gba_violations -methods size_cell -effort high -setup_target 0.0 -hold_margin 0.02
fix_setup_gba_violations -methods insert_buffer -setup_target 0.0 -hold_margin 0.02
fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target 0.0 -setup_margin 0.02
fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin 0.02
```

ECO 输出的两部分语义不同：

```text
*_netlist_swerv_wrapper.txt   Innovus FORMATVERSION 2 ECO directives
*_physical_swerv_wrapper.txt Innovus Tcl physical placement commands
```

netlist 文件必须由 Innovus `loadECO` 读取；physical 文件必须由 Tcl `source` 执行。文件扩展名都是 `.txt`，不能按扩展名猜语义。

XTop `write_design_changes -write_atomic_cmd` 与 `-reorder` 不兼容。当前已验证写法不带 `-reorder`。

## 8. PT→XTop→Innovus 迭代式 closure

### 8.1 单轮状态机

```text
Freeze routed DEF/netlist
  -> StarRC(cworst_T, cbest)
  -> PT(4 scenarios)
  -> Export XTop timing data
  -> XTop setup/hold fix
  -> Write ECO netlist + physical commands
  -> Innovus restore the matching routed DB
  -> loadECO(netlist)
  -> source(physical)
  -> ecoRoute
  -> export new DEF/netlist
  -> StarRC again
  -> PT again
  -> compare like-for-like PT reports
```

核心原则：XTop post-opt 数字用于判断优化方向；该轮 admission 使用回灌后重新 StarRC/PrimeTime 的数字。不要把 XTop 内部 aggregate count 与 PT 单场景 count 混为同一种指标。

### 8.2 已实现的迭代目录

| 物理/时序状态 | 目录或产物 |
|---|---|
| 初始 post-route | `EXPORT/swerv_wrapper.postroute.*`, `SIGNOFF/STARRC`, `SIGNOFF/PT`, `SIGNOFF/XTOP` |
| 第一轮 XTop 回灌后 | `DBS/xtop_eco_route.enc.dat`, `EXPORT/swerv_wrapper.xtop_eco_route.*` |
| 基于第一轮回灌结果的第二轮提取/PT/XTop fix | `SIGNOFF/ROUND2/` |
| 第二轮 XTop ECO 回灌、再提取、再 STA | `DBS/xtop_round2_eco_route.enc.dat`, `EXPORT/swerv_wrapper.xtop_round2_eco_route.*`, `SIGNOFF/ROUND3/` |

“ROUND2” 表示第二次 XTop fix 的输入与输出；“ROUND3” 表示第二次 XTop ECO 回灌后的第三组 RC/STA 证据。新迭代必须继续使用新目录，不能覆盖这些证据。

### 8.3 第二轮 fix 的可恢复入口

从第一轮 ecoRoute 结果重新提取、刷新 STA 并执行第二轮 XTop fix：

```bash
cd /data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation
env EDA_CONTAINER=eda-runner-interactive-luzi \
  /usr/local/bin/edarun bash -lc 'scripts/run_round2_fix.sh'
```

marker：

```text
SIGNOFF/ROUND2/starrc.done
SIGNOFF/ROUND2/pt.done
SIGNOFF/ROUND2/xtop_fix.done
```

脚本把第二轮新单元前缀设置为 `xtop_r2_eco`，避免与第一轮 `xtop_eco` 名称碰撞。

### 8.4 第二轮 ECO 回灌及刷新入口

```bash
cd /data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation
env EDA_CONTAINER=eda-runner-interactive-luzi \
  /usr/local/bin/edarun bash -lc 'scripts/apply_round2_and_refresh_sta.sh'
```

该脚本：

1. 从 `DBS/xtop_eco_route.enc.dat` 恢复；
2. 应用 ROUND2 的 netlist/physical ECO；
3. 执行 ecoRoute，写出 `xtop_round2_eco_route` DB/DEF/网表；
4. 基于新 DEF 重新提取两角 SPEF；
5. 基于新网表/SPEF 重新执行四场景 PT；
6. 写出新的 XTop timing data，便于后续第三轮 fix。

marker：

```text
SIGNOFF/ROUND3/innovus_eco_route.done
SIGNOFF/ROUND3/starrc.done
SIGNOFF/ROUND3/pt.done
```

## 9. 已验证的两轮结果

### 9.1 初始 XTop fix

XTop 初始基线与 post-opt：

| 指标 | fix 前 | fix 后 |
|---|---:|---:|
| setup violations | 281 | 33 |
| setup WNS | -0.1567 ns | -0.0380 ns |
| setup TNS | -15.4228 ns | -0.2650 ns |
| hold violations | 7430 | 148 |
| hold WNS | -0.2016 ns | -0.1523 ns |
| hold TNS | -279.7907 ns | -4.7862 ns |

第一轮 XTop 插入 2,908 个单元，size 919 个单元。回灌后必须以重新 StarRC/PT 的结果为准。

### 9.2 第二轮 XTop fix

第二轮 XTop 基于第一轮 ecoRoute 后重新提取的 RC：

| 指标 | fix 前 | fix 后 |
|---|---:|---:|
| setup violations | 43 | 11 |
| setup WNS | -0.0383 ns | -0.0383 ns |
| setup TNS | -0.2839 ns | -0.1091 ns |
| hold violations | 483 | 74 |
| hold WNS | -0.1540 ns | -0.1540 ns |
| hold TNS | -6.2365 ns | -4.1761 ns |

该轮插入 116 个单元，size 121 个单元。

### 9.3 第二轮 ECO 回灌后的 PrimeTime 实测

| 场景 | 检查 | 回灌前 WNS/TNS | 回灌后 WNS/TNS | 违例数变化 |
|---|---|---:|---:|---:|
| `func_ssg_rcworst_m40` | setup | -0.04/-0.28 ns | -0.04/-0.12 ns | 43 → 12 |
| `func_ssg_rcworst_m40` | hold | -0.15/-5.80 ns | -0.16/-4.10 ns | 280 → 52 |
| `func_ssg_rcworst_125` | hold | -0.14/-3.94 ns | -0.14/-3.13 ns | 169 → 50 |
| `func_ffg_cbest_m40` | hold | -0.07/-1.12 ns | -0.07/-0.80 ns | 200 → 70 |
| `func_ffg_cbest_125` | hold | -0.08/-1.08 ns | -0.08/-0.83 ns | 108 → 49 |

其余三个场景无 setup 违例。setup TNS 和所有场景的 hold TNS/违例数改善；最差 hold WNS 因重新布线和寄生变化从约 -0.15 ns 轻微变为 -0.16 ns。这说明优化方向有效，但尚未闭合。

完整快照：`SIGNOFF/ROUND3/COMPARISON.md`。

## 10. 物理检查的解释

第二轮增量 NanoRoute 报告：

```text
Total number of DRC violations = 0
Total number of process antenna violations = 0
```

全芯 `verify_drc` 仍报告 72,799 条，主要是已有 PG/special-wire spacing、min-step、minimum-area、via-enclosure 等问题。`verifyConnectivity` 报告上限内有 1,000 条 VDD special-wire open。

这两个结果不矛盾：前者说明本轮增量信号 ECO routing 没产生 router-level violation；后者说明整个既有设计的 PG/特殊布线基础仍不 clean。报告时必须同时给出两者。

## 11. 故障恢复与已知根因

### 11.1 存储和输入复制

历史上 `/dev/nvme1` 曾停在 resetting，导致早期输入复制出现 18 个截断文件。重启后通过 checksum 修复。任何 I/O 异常后，先检查 NVMe 和 `/data`，再检查输入哈希；不要把截断文件导致的工具错误误判为 Tcl 问题。

### 11.2 CTS 命令和 cell list

- PODv2 环境拒绝旧的 `ccopt_design` 调用，当前使用 `clock_opt_design`。
- 原 CTS cell list 包含库中不存在的 D2/D3/D6 DCCK 单元；当前使用跨四角验证存在的 D4/D8/D12/D16。

### 11.3 PrimeTime link

直接 `read_lib` 的尝试产生 unresolved/blackbox 行为。最小修复是 Library Compiler `.lib -> .db`，并把完整 DB 集放入 `target_library`/`link_path`。失败证据保留在 `SIGNOFF/PT/attempt_failed_*`。

### 11.4 SDC driving library

输入 SDC 把 driving-cell library 固定为 `ssg0p81vm40c`。PT 脚本按场景替换 library 名。若替换数为 0，脚本 fail closed，因为这通常意味着 SDC 格式或权威发生变化。

### 11.5 XTop 写出

- `-write_atomic_cmd` 与 `-reorder` 同时使用会报 `Invalid -reorder option for atomic command`；当前移除 `-reorder`。
- XTop netlist ECO 是 `FORMATVERSION 2` 指令，Innovus 用 `loadECO`；physical 文件才用 `source`。

### 11.6 marker 和日志

失败阶段不应留下成功 marker。保存原日志到 timestamped 失败目录，再修复并重跑。当前部署保留了 CTS、PT link、XTop 参数和 ECO 导入的失败证据；不要删除这些目录来美化结果。

## 12. Agent 继续工作的判定流程

### 12.1 读状态

```bash
cd /data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation
find make -maxdepth 1 -type f -printf '%f %TY-%Tm-%TdT%TH:%TM:%TS\n' | sort
find SIGNOFF/ROUND2 SIGNOFF/ROUND3 -maxdepth 1 -name '*.done' -print
pgrep -a -f '(innovus|StarXtract|pt_shell|lc_shell|xtop|make all)'
```

### 12.2 选择分支

- 初始 `make/eco_route` 缺失：从 `make all` 的第一个未通过阶段恢复。
- `ROUND2/xtop_fix.done` 缺失：运行 `scripts/run_round2_fix.sh`。
- `ROUND3/pt.done` 缺失：运行 `scripts/apply_round2_and_refresh_sta.sh`。
- `ROUND3/pt.done` 已存在且用户要求继续 closure：从 ROUND3 的 routed DEF/netlist 和 PT timing data 建立新 XTop run，使用新前缀如 `xtop_r3_eco`，再建立下一轮独立证据目录。
- 用户只要求报告：读取现有报告，不启动工具。

### 12.3 扩展下一轮时的硬规则

1. XTop physical input、PT netlist 和 StarRC DEF 必须来自同一轮 Innovus export。
2. 每轮 timing data 放在独立目录。
3. 每轮 ECO 新对象前缀唯一。
4. Innovus 从与该 ECO 基线匹配的 DB 恢复。
5. 回灌前记录输入哈希，回灌后记录 DB/DEF/网表/SPEF 哈希。
6. 用同一版本 PT 的同类报告做 before/after；XTop aggregate 只作辅助。
7. 保留 unconstrained endpoint、DRC、connectivity 和工具 warning 边界。

## 13. 源文件索引

以下路径均相对于 Foundation Flow 根目录；在服务器上加前缀 `/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation/`。

执行 `sha256sum -c docs/SWERV28_AGENT_SOURCE_MANIFEST.sha256` 可验证本文引用的核心源文件是否仍与本次实机验证版本一致。

| 文件 | 职责 |
|---|---|
| `Makefile` | 初始 Foundation Flow 编排、marker 和产物门禁 |
| `README.md` | 快速入口和已知边界 |
| `scripts/preflight.sh` | 输入、存储关联、许可、工具和 busy-job 门禁 |
| `FF/vars.tcl` | Foundation Flow 设计和库变量 |
| `FF/all/view_definition.tcl` | 四场景 MMMC 定义 |
| `FF/INNOVUS/run_postroute.tcl` | post-route 优化与 DEF/netlist/SDC 写出 |
| `SIGNOFF/STARRC/cworst_T.cmd` | slow/RC-worst StarRC 模板 |
| `SIGNOFF/STARRC/cbest.cmd` | fast/RC-best StarRC 模板 |
| `scripts/run_starrc.sh` | 初始两角 StarRC 执行和哈希 |
| `SIGNOFF/PT/compile_libs.tcl` | 单批 Liberty-to-DB 编译 |
| `scripts/compile_pt_dbs.sh` | 80 个 PT DB 生成和 manifest |
| `SIGNOFF/PT/run_scenario.tcl` | 初始四场景 PT 和 XTop timing-data export |
| `scripts/run_pt.sh` | 初始 PT 场景编排和 fail-closed 检查 |
| `SIGNOFF/XTOP/run_xtop.tcl` | 第一轮 XTop setup/hold fix |
| `scripts/run_xtop.sh` | timestamped XTop run 和 current 链接 |
| `FF/INNOVUS/run_xtop_eco_route.tcl` | 第一轮 XTop ECO 回灌和 ecoRoute |
| `scripts/run_round2_fix.sh` | 第一轮回灌后的 StarRC/PT/第二轮 XTop fix |
| `SIGNOFF/PT/run_scenario_round2.tcl` | ROUND2 PT 场景实现 |
| `SIGNOFF/XTOP/run_xtop_round2.tcl` | 第二轮 XTop fix，使用 `xtop_r2_eco` 前缀 |
| `scripts/apply_round2_and_refresh_sta.sh` | 第二轮 ECO 回灌、ecoRoute、再提取、再 STA |
| `FF/INNOVUS/run_xtop_round2_eco_route.tcl` | 第二轮 Innovus ECO 应用和 export |
| `SIGNOFF/PT/run_scenario_round3.tcl` | 第二轮回灌后的 PT 刷新 |
| `SIGNOFF/ROUND3/COMPARISON.md` | 实测 before/after、物理检查和关键哈希 |

## 14. 当前关键产物

```text
EXPORT/swerv_wrapper.postroute.def
EXPORT/swerv_wrapper.xtop_eco_route.def
EXPORT/swerv_wrapper.xtop_round2_eco_route.def
DBS/xtop_eco_route.enc.dat
DBS/xtop_round2_eco_route.enc.dat
SIGNOFF/STARRC/*.spef
SIGNOFF/PT/reports/
SIGNOFF/PT/sta_data/
SIGNOFF/ROUND2/STARRC/
SIGNOFF/ROUND2/PT/
SIGNOFF/ROUND2/XTOP/current/
SIGNOFF/ROUND3/STARRC/
SIGNOFF/ROUND3/PT/
RPT/xtop_eco_route/
RPT/xtop_round2_eco_route/
```

第二轮回灌后的关键 SHA-256：

```text
29a00d689508bb3c96cc5922edead9852df2f8823283b5dc32fb6a30c1a5a066  EXPORT/swerv_wrapper.xtop_round2_eco_route.def
2ee25435aae67c1bead5dc91aa970a27d5a3178aa75415fcf02b343e04fe12f0  EXPORT/swerv_wrapper.xtop_round2_eco_route.v
f3fad4eed2f88863b7d965f1c4ef4d1755ae8bf56244cb3adab9a253ef64d5fc  SIGNOFF/ROUND3/STARRC/swerv_wrapper.cbest.spef
c11d1475f91bba11155eb99e2967dfb14550123ba8c058d7a31ed3788793939a  SIGNOFF/ROUND3/STARRC/swerv_wrapper.cworst_T.spef
```

哈希是 2026-09-21 快照。脚本或产物改变后重新计算，不要继续引用旧哈希。

## 15. 最终验收清单

Agent 在声称一轮完成前逐项回答：

- [ ] 本轮 routed DB、DEF、网表来自同一 Innovus save/export 吗？
- [ ] StarRC 两角都 Errors=0，SPEF 非空且哈希已记录吗？
- [ ] PT 四场景都 link 成功、有 clocks、有 constrained max path 吗？
- [ ] XTop timing data 与本轮 PT reports 位于同一迭代目录吗？
- [ ] XTop fix 的 pre/post 指标和 ECO action 数已记录吗？
- [ ] Innovus 用 `loadECO` 读取 netlist directives、用 `source` 读取 physical Tcl 吗？
- [ ] ecoRoute 的增量 DRC/antenna 以及全芯 verify_drc/connectivity 都已报告吗？
- [ ] 回灌后重新 StarRC/PT，而不是复用旧 SPEF/STA 吗？
- [ ] before/after 使用同类 PT 报告，未用 XTop aggregate 替代 PT admission 吗？
- [ ] unconstrained endpoints、负 slack、PG DRC/open 等边界是否明确保留？
- [ ] 所有 marker 都有对应的返回码、日志和非空产物支持吗？

只有这些条件都满足，才能称为“该轮流程完成”。只有时序、物理验证、约束和签核标准全部满足，才能称为“设计闭合”。
