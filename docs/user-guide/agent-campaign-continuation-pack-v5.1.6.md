# HimaHarness Pack 5.1.6：真实 Campaign 续测与 Bug Fix 任务

## 任务

你接手的是一次新的真实 Campaign，不是继续 trial.5 的旧 Run。使用现有
HimaHarness 0.3.0-trial.11 App、DeepSeek-V4.1-Flash 和 Reference Pack 5.1.6，在
`aes_cipher_top` 上持续探索累积 Custom Cell Library，争取 matched post-route Fmax
提升达到或超过 5%。

trial.10 已证明 Pack 5.1.5 能在同一 Run 中把第一代 Goal miss 路由到第二代，并让第七条
`onsite-inspiration` 策略引用上一代商业反馈。第二代 Workshop 已成功写出约 1.23 MiB 的
研究文档，但 reader 错误地用 512 KiB 上限读取历史轮次，因而在形成第二代累计 Library
之前 hard-block。Pack 5.1.6 只修正这个写入/回读上限不一致的问题。首要验收是历史文档
能够被 reader 读取、第二代真正走完 E0，并在目标未达成时继续后续世代。

## 固定身份

| 项目 | 值 |
| --- | --- |
| App | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.11/HimaHarness.app` |
| 启动器 | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.11/launch-hima-trial.command` |
| Pack 来源 | `/Users/lluzi/code/hima_harness_reforge_polishing/packs/custom-cell-fmax-dtco` |
| Pack version | `5.1.6` |
| Pack method digest | `d63e082fcd0e19c9733cf8bb25d852d4afb1fcb0fdd4567896cb5c160a52731a` |
| Pack release | `https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/custom-cell-fmax-dtco-v5.1.6` |
| Site | `luzi@192.168.50.41` |
| Workspace root | `/data/eda/project/hima_harness/polishing-runs` |
| Design top | `aes_cipher_top` |
| Model | App 当前配置的 `DeepSeek-V4.1-Flash` |

主仓库、已发布 Pack、App bundle 和旧 Run 证据保持只读。产品 Bug 只在独立 worktree
`/Users/lluzi/code/hima_harness_agent_trial_fix_v11`、分支
`agent/hima-trial-bugfix-v11` 中修改。Site 上只写 Campaign workspace 或明确的隔离临时目录，
不删除文件，不修改共享 EDA、许可证、网络或他人作业。

## 步骤 1：启动并安装正确 Pack

在 Catsights 副屏运行：

```bash
cd "/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.11"
zsh ./launch-hima-trial.command
```

打开 **Pack & assets**。全新 trial profile 选择 **Install Pack from folder**；只有清单中已存在
旧版 `custom-cell-fmax-dtco` 时才选择 **Install tested method upgrade**。Pack ID 使用
`custom-cell-fmax-dtco`，source folder 使用上表的 Pack 来源。审阅并确认文件。

安装后同时核对：

- 页面显示 version `5.1.6`；
- `VERSION.yml` 的 method digest 与上表一致；
- 当前 Campaign configuration 选择的是 5.1.6；
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

完成条件：新 Run 的 Pack identity 是 5.1.6，且当前节点从 `bind-inputs` 正常推进。

## 步骤 4：5.1.6 历史回读修复验收

继续执行节点，取得以下事实：

1. 第一代仍完成六条免费 miner、Workshop、累计 Library、LC/DC/adoption、两臂 P&R、verify 和 compare。
2. 若 `fmax_improvement_pct < 5`，同一 Run 必须经 `next-research` 打开 generation 2。
3. generation 2 的 `research-candidates` 必须读取当前 commercial response，并写出新的研究文档。
4. `read-research-selection` 必须成功读取 generation 1 的完整历史文档；不得再次出现
   `history[0] exceeds the bound evidence file byte limit`。
5. reader 必须形成 observation，随后进入 `merge`，而不是在 retry allowance 用尽后 hard-block。
6. 若 comparison evidence 无效或缺失，必须保持 UNDETERMINED/阻塞，不得把无效数值送入研究。

完成条件：记录 `HISTORY_ROUND_READ_PASS`，给出历史文档实际字节数、SHA、reader execution、
observation 和随后 `merge` 的 Ledger record id。

## 步骤 5：第七条现场灵感策略验收

在 generation 2 的同一个 `research-candidates` Workshop 中：

1. 不复制任何旧 trial 的 `entry.py` 或 proposal；根据当前 residual context 重新编写策略。
2. `research_lenses` 必须包含规范名 `onsite-inspiration`。
3. 该 lens 必须引用本次 Campaign 当前 `commercial_response` 的证据 hash，并依据本次实际
   frontier、adoption、route retention 和 Fmax 响应提出新策略；不得把 trial.9 或 trial.10 数值冒充当前事实。
4. `onsite-inspiration` 最多贡献 10 个 proposal；全 Portfolio 仍受每轮 50 颗 Cell 上限约束。
5. 它只选择当前 hash-bound candidate pool 的 immutable `proposal_key`，不得自行伪造 Cell identity。
6. 现场策略与其他 lens 合入同一个累计 Library，不新建 Run、商业分支或单独 P&R。
7. Reader 必须报告 `onsite_inspiration_selected_count`；为 0 时必须保留有证据的原因，不能伪造候选填数。
8. 旧 Library shard 保持字节不变，generation 2 只追加 delta。

完成条件：记录 `ONSITE_INSPIRATION_PASS`，保存 lens、商业证据引用、程序 hash、proposal 数、
累计 Library lineage 和第二代 E0 结果。

## 步骤 6：验证跨代收益闭环

第二代结束后不得因为“已经验证循环机制”而主动停止：

1. 若 matched post-route Fmax 提升达到 5%，保存采用、route retention 和最终数据库证据并正常结束。
2. 若仍低于 5%，让 `final-judge → next-research` 在同一 Run 开启下一代；新 onsite 策略必须引用
   第二代商业响应，并说明哪些因子保留、降权或替换。
3. 每一代只追加新的 Library shard，保留旧代字节、proposal identity、失败认识和 commercial label。
4. 继续到 Goal met、研究真实收敛、预算耗尽或新的 hard blocker。不得为了尽快给出 verdict 而提前关停。

完成条件：至少完整获得第二代 E0；若目标仍未达到，还要证明第三代已经开始或记录真实的
预算/收敛结束。5% Fmax 始终是 Campaign 目标和唯一成功出口。

## Bug Fix 分支

只有保存原始失败现场后才进入源码。先读取仓库 `AGENTS.md` 及其要求的产品、纪律、模型和测试文档。
目标 worktree 不存在时创建：

```bash
git -C /Users/lluzi/code/hima_harness_reforge_polishing fetch origin
git -C /Users/lluzi/code/hima_harness_reforge_polishing worktree add \
  -b agent/hima-trial-bugfix-v11 \
  /Users/lluzi/code/hima_harness_agent_trial_fix_v11 \
  origin/main
```

每个 Bug 先建立最小复现，再在现有模块内做最小修改，运行最低必要 L0/L2；窗口交互变化在
Catsights 做一条定向 L3。一个 Bug 一个 commit，并 push 到自己的分支。不得修改、merge、reset、
rebase 或 push `main`，不得创建 release/tag。Pack 方法变化必须形成新版本和原生 seal，不能手写
`VERSION.yml`。

## 报告

写入一个新的报告文件，不覆盖 trial.5 的历史报告：

`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.11/Agent Trial Report.md`

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
- `FAIL`：5.1.6 无法读取上一代历史、无法完成第二代，或现场策略/产品事实不可信。
