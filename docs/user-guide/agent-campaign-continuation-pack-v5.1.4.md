# HimaHarness Pack 5.1.4：真实 Campaign 续测与 Bug Fix 任务

## 任务

你接手的是一次新的真实 Campaign，不是继续 trial.5 的旧 Run。使用现有
HimaHarness 0.3.0-trial.9 App、DeepSeek-V4.1-Flash 和 Reference Pack 5.1.4，在
`aes_cipher_top` 上持续探索累积 Custom Cell Library，争取 matched post-route Fmax
提升达到或超过 5%。

前序试用已经穿过免费挖掘、Workshop、LC、DC、custom synthesis 和 adoption。trial.8 证明
固定 checkerboard 插入了 33,215 颗 DCAP，使 post-CTS occupancy 达到 97.7%、最终达到
99.6%，并伴随 2,857,352 个 DRC marker；该 Run 因此没有完成第一条 P&R 臂。trial.9 与
Pack 5.1.4 取消 DCAP insertion、扩大阶段与 Campaign 预算、补齐物理失败诊断和后台 Job
meter。首要目标是穿过两臂 P&R 并继续 E0/反馈迭代，而不是再次停在基础设施故障。

## 固定身份

| 项目 | 值 |
| --- | --- |
| App | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.9/HimaHarness.app` |
| 启动器 | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.9/launch-hima-trial.command` |
| Pack 来源 | `/Users/lluzi/code/hima_harness_reforge_polishing/packs/custom-cell-fmax-dtco` |
| Pack version | `5.1.4` |
| Pack method digest | `c20ecdab438cf0d463d8e3736a1dc6ea08e8afe9ed16b23589635077473ae7be` |
| Pack release | `https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/custom-cell-fmax-dtco-v5.1.4` |
| Site | `luzi@192.168.50.41` |
| Workspace root | `/data/eda/project/hima_harness/polishing-runs` |
| Design top | `aes_cipher_top` |
| Model | App 当前配置的 `DeepSeek-V4.1-Flash` |

主仓库、已发布 Pack、App bundle 和旧 Run 证据保持只读。产品 Bug 只在独立 worktree
`/Users/lluzi/code/hima_harness_agent_trial_fix_v9`、分支
`agent/hima-trial-bugfix-v9` 中修改。Site 上只写 Campaign workspace 或明确的隔离临时目录，
不删除文件，不修改共享 EDA、许可证、网络或他人作业。

## 步骤 1：启动并安装正确 Pack

在 Catsights 副屏运行：

```bash
cd "/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.9"
zsh ./launch-hima-trial.command
```

打开 **Pack & assets**。全新 trial profile 选择 **Install Pack from folder**；只有清单中已存在
旧版 `custom-cell-fmax-dtco` 时才选择 **Install tested method upgrade**。Pack ID 使用
`custom-cell-fmax-dtco`，source folder 使用上表的 Pack 来源。审阅并确认文件。

安装后同时核对：

- 页面显示 version `5.1.4`；
- `VERSION.yml` 的 method digest 与上表一致；
- 当前 Campaign configuration 选择的是 5.1.4；
- 旧 5.1.0 Run 保持历史状态，不被恢复成新 Pack 的 Run。

完成条件：已安装 Pack 的 version 和 digest 两项都匹配。任一不匹配时记录
`PACK_IDENTITY_BLOCKED`，停止创建 Campaign。

## 步骤 2：让 HimaGuide准备 Site

先对已保存 Site 执行 rediscover，再让 HimaGuide 做 readiness。rediscover 必须保留已审阅的
九个以上 read roots、实际 workspace、wrapper 和全部既有 bindings，并真正联系 Site；不再接受
`expected array to have <=8 items`。只有自然准备受阻后，才使用以下恢复信息：

| 输入 | Site 值 |
| --- | --- |
| `designRoot` | `/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes` |
| `rtlGlob` | `/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes/*.v` |
| `designTop` | `aes_cipher_top` |
| `constraints` | `/data/eda/project/celluzi/commercial/aes_tsmc28/scripts/constraint_tsmc28.sdc` |
| `foundryLibrary` | `/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/tcbn28hpcplusbwp40p140tt0p9v25c.lib` |
| `physicalInputs` | `/data/eda/project/hima_harness/site_inputs/xspace_cell_aes_tsmc28/physical-inputs.json` |
| `toolStack` | `/data/eda/project/hima_harness/site_inputs/xspace_cell_aes_tsmc28/tool-stack.json` |
| `workspaceRoot` | `/data/eda/project/hima_harness/polishing-runs` |

`physicalInputs` 必须声明 `FOUNDRY_DB_FILE`，并指向与上述 Liberty 匹配的 `.db`。让
HimaGuide 读取并核对，不要把 `.db` 再填进 `foundryLibrary`。保存 Site 后重新打开 readiness。

完成条件：记录 `RICH_SITE_REDISCOVER_PASS`；Readiness 无未解释阻塞；Site 显示 DC、LC、
Innovus 各一席许可证，job cap 不超过 5；HimaGuide 能说明 `.lib` 和 `.db` 的不同消费者。

## 步骤 3：创建唯一的新 Campaign

使用以下固定条件：

- Goal：`target_period_ns = 0.5`、`target_fmax_improvement_pct = 5`；
- Strategy：Pack 默认起点；
- Budget：720 分钟、8 generations、retry allowance 2；
- 每轮最多 50 颗新 Cell；
- 两个物理臂保持 matched，累积 Custom Library 是唯一逻辑变量。

点击 **Confirm & start Campaign** 一次。立即记录 Campaign ID、Run ID、owner session、Pack
version/digest、workspace 和当前节点。一个 Campaign 只对应一个持久 Run；发生等待或 App 重启时
恢复该 Run，不复制 Run。

完成条件：新 Run 的 Pack identity 是 5.1.4，且当前节点从 `bind-inputs` 正常推进。

## 步骤 4：5.1.4 修复验收出口

依次取得以下事实：

1. `bind-inputs` 的当前 `inputs.json` 中：
   - `DESIGN_TOP` 是 `aes_cipher_top`；
   - `FOUNDRY_LIB` 以 `.lib` 结尾；
   - `FOUNDRY_DB` 以 `.db` 结尾；
   - 两个路径不同并且都存在。
2. `compile` 通过，Library Compiler 的真实 invocation 和 `lc_accepted = 1` 可追溯。
3. `foundry-synth` 使用 `FOUNDRY_DB`，Design Compiler 正常产生非空 `base.dc.v`。
4. 当前 Run 不出现 `DB-1: File is not a DB file`。
5. 若 Workshop 选择多输出候选，`design-mapping-timing-evaluation` 必须把每个 request 识别为
   一颗 `_MO` Cell 和多个 output pins，不得出现 `Cell identity mismatch`；累计 Library 也只能
   记录这一颗 physical Cell。
6. `pnr-foundry` 和 `pnr-generated` 必须报告：requested utilization `0.25`、effective
   utilization `0.125`、area expansion `2`、正整数 route-layer index；两臂复用同一冻结 core
   与 pin plan。Placement 与 optimization max density 均为 `0.85`，`dcap_count` 必须为 `0`，
   脚本中不得出现 `HIMA_DCAP_*` 实例。
7. Tcl 抛错时，batch wrapper 必须立即非零退出并保留 `HIMA_BATCH_ERROR`。若 Innovus 自身退出
   `0`、但方法随后发现 legalization/DRC 失败，结构化 facts 必须区分 process exit、
   `innovus_failure_class` 和 `route_drc_violations`；不要把这种深层物理失败误判为 wrapper 失效。
8. 若任意节点 Hard block，blocker tail 必须包含 `HIMA_STAGE_DIAGNOSTIC`，至少给出 stage、
   status、facts 和 execution identity；Run meter 必须计入最后一个已结束 Job 的 elapsed/licence
   时间，Agent 不应再依赖登录 Site 才能看见失败阶段事实。

完成条件：1–4 记录 `SPLIT_LIBRARY_FIX_PASS`；自然出现多输出候选时记录
`MULTI_OUTPUT_IDENTITY_PASS`；6–7 记录 `INNOVUS_BATCH_INIT_PASS`。任何一项失败都记录准确的
节点、Job、命令、退出码、日志和绑定值，不继续后续阶段掩盖失败。

## 步骤 5：继续自主研究闭环

修复验收通过后继续同一个 Campaign：

1. 免费挖掘节点按 Site job cap 并行；trial.5 已证明该机制，无需故意重复并发压力测试。
2. Workshop 使用真实 evidence-driven 程序；不再注入 `import os` 或其他故意错误。
3. 每轮形成一个累积 Library，保留旧 Cell、失败和拒绝证据。
4. E0 读取综合 adoption、route retention、完整 endpoint frontier 和 matched PPA。
5. 未达到 5% 时，把 commercial frontier response 返回下一轮 Workshop，针对 remaining
   frontier、new entrant、regression 或 adoption failure 生成新假设。
6. 持续到 Goal met、Research converged、Budget exhausted 或有证据的 Hard blocker。

研究、Cell 选择和商业验证都由可见 Campaign Agent 通过 Hima Harness 执行。Coding Agent 负责
观察、记录和修复产品 Bug，不在产品外替它完成人工研究。

## Bug Fix 分支

只有保存原始失败现场后才进入源码。先读取仓库 `AGENTS.md` 及其要求的产品、纪律、模型和测试文档。
目标 worktree 不存在时创建：

```bash
git -C /Users/lluzi/code/hima_harness_reforge_polishing fetch origin
git -C /Users/lluzi/code/hima_harness_reforge_polishing worktree add \
  -b agent/hima-trial-bugfix-v9 \
  /Users/lluzi/code/hima_harness_agent_trial_fix_v9 \
  origin/main
```

每个 Bug 先建立最小复现，再在现有模块内做最小修改，运行最低必要 L0/L2；窗口交互变化在
Catsights 做一条定向 L3。一个 Bug 一个 commit，并 push 到自己的分支。不得修改、merge、reset、
rebase 或 push `main`，不得创建 release/tag。Pack 方法变化必须形成新版本和原生 seal，不能手写
`VERSION.yml`。

## 报告

写入一个新的报告文件，不覆盖 trial.5 的历史报告：

`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.9/Agent Trial Report.md`

报告至少包含：

- App、Pack version/digest、模型、Site、时间与 Catsights 录屏位置；
- 新 Campaign/Run/owner/workspace 身份；
- rich Permit、split-library、多输出身份和 Innovus batch/init 修复验收事实；
- 每代 Library、假设、免费指标、E0、frontier response 和下一决策；
- 最终 adoption、route retention、WNS/TNS/Fmax/PPA 与 5% Goal 判断；
- 每个 Bug 的复现、根因、修改文件、commit、测试和回滚；
- UI、Agent 自述、Ledger、Reader/Judge、商业 EDA 事实的区分。

最终 verdict 只能是：

- `MILESTONE_PASS`：matched final database 证明采用、route retention 和 Fmax 提升至少 5%；
- `LOOP_WORKS_TARGET_MISS`：多轮闭环真实结束，但预算内未达到 5%；
- `PARTIAL`：修复验收通过，完整研究闭环尚未结束；
- `FAIL`：5.1.4 仍无法穿过修复出口，或产品事实不可信。
