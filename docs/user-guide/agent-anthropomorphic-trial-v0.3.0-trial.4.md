# HimaHarness 0.3.0-trial.4：拟人试用、持续 Campaign 与 Bug Fix 任务

## 任务目标

你是一名第一次接触 HimaHarness、具备一般调试能力的 AI Coding Agent。你要完成三个连续阶段：

1. 像真实的新用户一样，在不看源码的情况下理解和试用产品；
2. 使用 HimaHarness、DeepSeek-V4.1-Flash 和 V5 Reference Pack 持续推进一个真实 Campaign；
3. 产品 Bug 阻碍 Campaign 时，只在你自己的 Git worktree 中定位、修复、验证并提交。

业务目标是在 `aes_cipher_top` 上通过累积定制 Standard Cell Library，使 matched post-route
Fmax 提升达到或超过 5%。这是本任务的核心检验：廉价开源模型能否在 Hima Harness 与 Pack 的
脚手架下不断分析真实反馈、改进研究算法、扩充 Library，并代替一个跨领域小团队推进设计上限。

Coding Agent 是用户代理和产品调试者。候选发现、研究算法、Cell 方案、免费代理评估、商业 EDA
验证和反馈迭代必须通过 Hima Harness 中可见的 Campaign Agent 与 Pack 执行。不要在产品之外手工
完成研究，再把答案交给 Hima；那不能检验产品能力。

## 交付材料

试用目录：

`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.4`

其中包含：

- `HimaHarness.app`：macOS Apple Silicon App；
- `launch-hima-trial.command`：Coding Agent 使用的唯一启动入口，窗口固定在 Catsights 副屏；
- `Reference Packs/custom-cell-fmax-dtco/`：V5 Reference Pack；
- `trial-manifest.json`、`BUILD-RECEIPT.md`、`SHA256SUMS.txt`：构建与校验事实；
- 本任务文档的交付副本。

业务入口：

- EDA Site SSH：`luzi@192.168.50.41`；
- 推荐 workspace root：`/data/eda/project/hima_harness/polishing-runs`；
- 目标 design：`aes_cipher_top`；
- 目标：matched post-route Fmax improvement `>= 5%`；
- 本机已有可用 OpenSSH 身份，不需要索要密码；
- Hima product model 使用 App 当前配置的 DeepSeek-V4.1-Flash，不自行更换模型。

## 两种身份与一条红线

### 黑盒试用身份

阶段 A 只操作 App、HimaGuide 和可见 Campaign。此时不读源码、不改配置文件、不运行内部测试、
不使用恢复卡。先保留一个真实新用户会遇到的完整路径。

### 调试身份

完成阶段 A 的黑盒检查点后，产品 Bug 阻碍 Campaign 才进入阶段 B。先保存错误现场，再读取源码。
所有代码修改、构建、测试和 commit 必须发生在独立 worktree：

`/Users/lluzi/code/hima_harness_agent_trial_fix_v4`

### 红线

以下路径保持只读：

- `/Users/lluzi/code/hima_harness_reforge_polishing` 的 `main` checkout；
- `/Users/lluzi/code/hima_harness_reforge_claude`；
- `/Users/lluzi/code/himaharness`；
- 已安装的 Reference Pack、正式 App bundle和已有 Campaign 证据。

真实 Site 上不删除文件、不修改 licence server、网络、共享工具安装或他人作业。任何删除需求都作为
阻塞报告。允许的写入只在 Campaign workspace、隔离 Trial Data 和你的 worktree 内。

## 证据纪律

- App 操作和录制全部在 Catsights 副屏进行。
- 从首次启动开始录屏。长时间 EDA 阶段可以停止连续录像，但每次状态检查和人工介入需要录像。
- 分开记录“界面事实”“Agent 自述”“Ledger/Job/Reader/Judge 事实”“商业 EDA 事实”。
- 每个卡点记录时间、页面、意图、动作、反馈、下一步依据。
- Fmax、WNS、TNS、adoption、route retention 和 PPA 只引用实际报告或 final database Reader。
- 失败结果、无收益候选、新瓶颈、拒绝和修复前现场都保留；不覆盖失败记录。
- 一次商业失败不是产品 Bug。先检查 Pack 是否把 frontier response 反馈给下一轮研究。

完成条件：最终报告能够从每项结论追溯到截图、录像时间点、Run/Job/record id、报告或 Git commit。

## trial.4 必须复核的修复

这不改变阶段 A 的黑盒身份，只规定上一轮失败后必须重新走到的用户结果：

- Pack folder picker 不可用时，**Install a Pack** 自动打开可手工输入路径的审阅面板，不能静默无响应；
- Site discovery 从已选 Pack 提出它声明的 wrapper/command，并为用户给出的 workspace root
  提出最小读写范围；Rediscover 后页面显示 roots/wrappers，Save 保存刚才审阅的同一份快照；
- 顶部 Refresh 重新读取 Configuration readiness；
- Hard blocker 或 Pack Wait 等待人类的时间不耗尽 Campaign time box；人类解除后，后续真实
  `work`/Job 和 revision 仍进入各自正常校验；普通人工 pause 仍计入预算；
- `research-candidates` 模板让 Agent 直接取得合法 residual evidence hashes。第一次提交若仍
  被拒，错误须指出具体字段和改法，不能只说笼统的 “not evidence-bound”。

## 测试能力门与唯一启动协议

开始前确认你拥有以下能力：

1. 能截取 Catsights 屏幕；
2. 能在 Catsights 上移动鼠标、点击、输入文字和读取窗口；
3. 能保持一个长期 shell/PTY session，而不是命令启动后立即关闭 stdin；
4. 能识别窗口标题 `HimaHarness`，不把已经运行的 `DSH Desktop` 当成被测 App。

缺少鼠标/键盘 GUI 控制能力时，记录 `TESTER_CAPABILITY_BLOCKED` 并停止。仅有 shell 和截图能力
不能完成拟人 UI 试用。不得为绕过能力缺口自行创建 FIFO、拼装 driver 客户端或修改 App。

唯一允许的启动方式：

```bash
cd "/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.4"
./launch-hima-trial.command
```

保持这个 shell session 存活。不要使用 `open HimaHarness.app`、不要直接运行 App 内二进制、不要增加
`--driver`，也不要通过 LaunchServices、DSH Desktop 或临时 FIFO 启动。`--driver` 是仓库自动化测试
接口，不是本次拟人试用入口。

启动成功必须同时满足：

- shell 输出和 `Trial Data/launcher.log` 都写明
  `DSH_HOME: .../ui-trial-0.3.0-trial.4/Trial Data/dsh`；
- Catsights 出现标题为 `HimaHarness` 的窗口；
- 窗口显示 Internal Testing Notice 或产品首页，而不是启动失败页；
- `Trial Data/dsh` 出现 profile 和 storage 文件。

任一条件不满足时停止启动尝试，记录准确命令、退出码、日志和截图。不要发明第二种启动方案。

## 阶段 A：零背景黑盒试用

### A1. 冷启动和产品认知

1. 按“唯一启动协议”运行 `./launch-hima-trial.command`，确认四项成功条件全部成立。
2. 接受测试提示，建立新会话。
3. 不阅读其他手册，依次询问 HimaGuide：
   - “你是什么产品？你能帮我完成什么？”
   - “什么是 HimaPack、Site 和 Campaign？它们之间是什么关系？”
   - “你现在带了哪些 Pack？我第一次使用应该怎么开始？”
4. 观察回答是否直接，是否检索无关代码，是否说明当前安装状态和下一步。

完成条件：你仅根据产品回答，能够写出 HimaHarness 的用途、三个核心概念和下一项可执行动作。

### A2. 安装并理解 Reference Pack

1. 打开对话旁的 **Campaign** 工作区。
2. 在 **Campaign configuration** 中使用 **Install a Pack**。
3. 选择 `Reference Packs/custom-cell-fmax-dtco`。如果系统 folder picker 不可用，产品应自动打开
   **Pack & assets** 审阅面板；在 `Pack source folder` 中输入该路径并继续，不能另找安装方式。
4. 安装前阅读文件审阅：Pack id、版本、知识、方法和目标目录。
5. 确认安装，选择 `custom-cell-fmax-dtco`。
6. 阅读标题、状态和迷你运行图，再询问：
   - “这个 Pack 接受什么输入、交付什么结果？”
   - “它如何在失败后继续研究，而不是重复固定自动化？”
   - “现有 V5 证据证明了什么，又没有证明什么？”

完成条件：Pack 版本为 `5.0.1`；方法图可见；你能区分 5% Goal、既有 Fmax 负结果、次级 PPA
收益和下一 Campaign 的剩余 Active Frontier。

### A3. 让产品建立 Site

1. 只输入 SSH destination `luzi@192.168.50.41` 和 workspace hint
   `/data/eda/project/hima_harness/polishing-runs`。
2. 使用 **Discover with HimaGuide**。
3. 阅读服务器、资源、工具和缺失输入的发现结果。
4. 告诉 HimaGuide：
   “我要在这个 Site 上运行刚安装的 Pack，目标 design 是 aes_cipher_top。请主动检查还缺少哪些
   输入；能自行发现的请自行发现，确实无法判断时一次只问我一个关键问题。”
5. 优先让 HimaGuide 更新同一份 Campaign configuration，不预先手填全部路径。
6. 打开恢复卡并补齐输入后，如果 readiness 指出 Site Permit 或 discovery 仍不完整，点击
   **Rediscover**。核对页面显示的 read roots、write roots、wrappers 和 unknowns，再点击
   **Save reviewed Site**。保存后点顶部 Refresh；不要手改 Site/Permit YAML。

完成条件：Site 可再次选择；已绑定、未绑定、失败和 stale 状态清楚；HimaGuide 能推进准备，或明确
提出一个可行动阻塞。经过一次完整自然尝试仍无法推进时，先记录 `ONBOARDING_BLOCKED`，再读取恢复卡。

### A4. 黑盒检查点

在读取源码或修 Bug 前，先在 `Agent Trial Report.md` 写入：

- 产品和 Pack 的理解；
- Pack 安装、Site discovery 和 readiness 的实际结果；
- 至少一张首次界面、Pack 审阅和 Configuration 截图；
- 所有已发现问题；
- 是否打开恢复卡。

完成条件：即使后续修复改变了产品，仍能重建原始用户经历。

## 恢复卡：仅在 A3 已记录 ONBOARDING_BLOCKED 后读取

打开前记录 `RECOVERY_CARD_OPENED`、时间、阻塞原因和已尝试动作。

| 输入 | 值 |
| --- | --- |
| `designRoot` | `/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes` |
| `rtlGlob` | `/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes/*.v` |
| `designTop` | `aes_cipher_top` |
| `constraints` | `/data/eda/project/hima_harness/polishing-inputs/aes-v5-reference-20260917/constraints.tcl` |
| `foundryLibrary` | `/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/tcbn28hpcplusbwp40p140tt0p9v25c.db` |
| `physicalInputs` | `/data/eda/project/hima_harness/polishing-inputs/aes-v5-reference-20260917/physical.json` |
| `toolStack` | `/data/eda/project/hima_harness/polishing-inputs/aes-v5-reference-20260917/tools.json` |
| `workspaceRoot` | `/data/eda/project/hima_harness/polishing-runs` |

把值填入现有 Campaign configuration。使用恢复卡不能把自然 onboarding 判为通过。

## 阶段 B：独立 Worktree Bug Fix

### B1. 建立隔离工作区

只有黑盒检查点完成后才执行。先运行 `git worktree list`。若目标 worktree 已存在，进入该目录并核对
分支与状态，不重复创建；只有目标不存在时才运行：

```bash
git -C /Users/lluzi/code/hima_harness_reforge_polishing fetch origin
git -C /Users/lluzi/code/hima_harness_reforge_polishing worktree add \
  -b agent/hima-trial-bugfix-v4 \
  /Users/lluzi/code/hima_harness_agent_trial_fix_v4 \
  origin/main
```

进入 worktree 后核对：

```bash
pwd
git branch --show-current
git status --short
git rev-parse HEAD
```

完成条件：目录是 `/Users/lluzi/code/hima_harness_agent_trial_fix_v4`，分支是
`agent/hima-trial-bugfix-v4`，初始状态干净。分支已存在时停止创建，先检查已有 worktree，不覆盖它。
已有 worktree 干净且没有自己的 commit 时，先执行 `git fetch origin` 和
`git merge --ff-only origin/main`；存在修改或独有 commit 时保留现场并报告，不自行 rebase 或覆盖。

### B2. 读取开发边界

在 worktree 中先读：

- `AGENTS.md`；
- `docs/product-definition.md`；
- `docs/agents/polishing-discipline.md`；
- `docs/agents/model-policy.md`；
- `docs/testing-strategy.md`。

现有模块归属：

| 问题 | 首先检查 |
| --- | --- |
| Desktop 启动、打包、窗口 | `packages/desktop/src/` |
| Campaign UI、完整图、Side Talk | `packages/harness/src/client/` |
| Pack 安装与升级 | `packages/harness/src/release.ts`、`PackOwnerPanel.tsx` |
| Site discovery | `packages/harness/src/sites.ts`、`channel.ts`、`ConfigurationPage.tsx` |
| Campaign configuration | `campaign-file.ts`、`workbench.ts`、`ConfigurationPage.tsx` |
| Agent 执行与恢复 | `fabric.ts`、`node-turns.ts`、`recovery.ts`、`workshop.ts` |
| DTCO 方法与研究反馈 | `packs/custom-cell-fmax-dtco/` |

完成条件：每个 Bug 在修改前写明复现、实际/期望、根因证据、归属文件和最低测试。

### B3. 修复纪律

对每个阻塞 Bug 单独执行：

1. 在 worktree 复现，不以原 App 的一次现象直接猜根因；
2. 先运行能推翻假设的最低成本测试；
3. 在现有模块内做最小修改；
4. 运行相关 L0/L1/L2；涉及窗口时在 Catsights 运行一条定向 L3；
5. 重新执行原用户路径；
6. 一个 Bug 一个本地 commit，记录测试与限制；
7. 只推送自己的分支：`git push -u origin agent/hima-trial-bugfix-v4`；
8. 不 push、merge、reset 或 rebase `main`，不创建 Release 或 tag。

修复失败后重新建立根因，不连续盲改。错误修改未合入 main 时可直接 revert 自己的 commit，或丢弃
worktree；不得用正式仓库中的文件覆盖 worktree 来制造“恢复”。

Harness 或 Desktop 修复通过定向测试后，使用同一 Trial Data 验证恢复，不创建第二套用户状态：

```bash
cd /Users/lluzi/code/hima_harness_agent_trial_fix_v4
pnpm install --frozen-lockfile
pnpm --filter @hima/harness run build
pnpm --filter @hima/desktop run build
HIMA_USER_DATA="/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.4/Trial Data" \
DSH_HOME="/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.4/Trial Data/dsh" \
HIMA_WORKSPACE="/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.4/Trial Workspace" \
HIMA_DRIVER_DISPLAY="Catsights" \
pnpm --filter @hima/desktop run start
```

运行前先通过 UI 暂停 Campaign，或等待当前 Job 到达安全边界，再关闭原 App。新进程必须读回同一
Run id、Pack digest 和当前节点；否则把恢复失败作为新 Bug，不另起一个 Run 掩盖它。

已发布 Pack 带有 `VERSION.yml` seal。Pack 方法修改必须形成新版本，保留旧 Run 和旧 Pack 证据；
不得手写或修补 seal。Workshop 研究代码、策略变化和累积 Library 属于同一 Campaign 的正常探索，
不等于 Pack 方法修改。

### B4. Bug 与研究负结果的分界

以下通常是产品 Bug：崩溃、状态不一致、Site 明明可用却无法保存、Pack 安装失败、图与 Ledger 不符、
停止无效、Reader 不能读取实际工具格式、反馈没有进入下一研究轮、同一动作产生隐藏 Run。

以下本身不是 Bug：某轮没有 Fmax 收益、候选未采用、新 endpoint 接管、免费因子与 E0 不相关、算法
假设被真实结果否定。遇到这些情况，应让 Campaign Agent 读取保留证据并生成下一轮研究算法。

## 阶段 C：持续 Fmax Campaign

### C1. 准备

Configuration 必须满足：

- Pack：`custom-cell-fmax-dtco`；
- Site：已发现并保存的 SSH Site；
- Goal：`target_period_ns = 0.5`、`target_fmax_improvement_pct = 5`；
- Strategy：从 Pack 默认值开始，后续只由有证据的 Campaign 决策改变；
- Budget：time box `360` 分钟、generation limit `8`、retry allowance `1`；
- Inputs：全部已绑定；Knowledge：ready；Readiness：无未解释阻塞；
- 模型：DeepSeek-V4.1-Flash；
- Site job cap：不超过 5；每轮新 Cell 不超过 Pack 声明的 50。

确认前，让 HimaGuide 复述 Goal、唯一业务变量、matched 条件、预算和停止条件。设置、工具、floorplan、
pins、PG、DCAP、约束和分析视图必须 apple-to-apple；两臂唯一逻辑变量是累积 Custom Library。

### C2. 启动与所有权

1. 点击 **Confirm & start Campaign** 一次；
2. 确认一个 Campaign 对应一个持久 Run；
3. Campaign Agent 是执行 owner，Coding Agent 只观察和处理产品 Bug；
4. Side Talk 可做普通工作，但不自动取得 ownership；
5. App 或 Coding Agent 会话重启后恢复同一个 Run，不因等待创建新 Run。

启动后立即把 Campaign id、Run id、owner session、Pack digest、workspace 和当前节点写入报告。Job
处于 working 时等待它产生实际完成/失败事实；不要重复点击、重复 begin 或启动同一节点。长 Job 每
五分钟观察一次 UI/Job 状态即可。Coding Agent 会话即将结束时先写 checkpoint，下一会话从相同
Trial Data 和报告恢复，不重新执行 A1-A3，不创建新 Campaign。

### C3. 研究迭代

持续观察每一代：

1. 机会挖掘覆盖完整 reg2reg Active Frontier、替代路径、dominator/reconvergence、逻辑深度、物理距离、
   load/slew、单/多输出与非瓶颈 PPA recovery；
2. F0 检查功能和生成可行性；F1/F2/F3 只报告免费指标，不替代 E0 决策；
3. 一轮候选形成一个累积 Library，旧 Cell 与失败证据不删除、不重复生成；
4. 商业验证读取综合 adoption、route retention、endpoint-complete timing graph 和 matched PPA；
5. 未达到 5% 时，确认 commercial frontier response 回到下一轮 Workshop；
6. 下一轮必须针对 remaining frontier、新 entrant、regression 或 adoption failure 形成多个有依据的新假设；
7. 不把 240 次动作预算解释成 240 条商业 P&R，不并行铺开算法竞赛。

每次 E0 后记录：Library id、累计 Cell 数、实际 adoption/retention、WNS/TNS/Fmax、area/wire/power、
resolved endpoints、new entrants、remaining frontier、下一轮问题和证据引用。

### C4. 停止条件

持续到以下真实 ending 之一：

1. **Goal met**：matched final database 证明 Custom Cell 在综合采用并在 route 后保留，Fmax 提升
   `>= 5%`；
2. **Research converged**：多轮后无新的有证据方向，Pack 按声明收敛；
3. **Budget exhausted**：6 小时、8 代、Cell、Site 或商业 observation 预算用完；
4. **Hard blocker**：必要输入、工具、Reader、证据身份或产品 Bug 无法在本 worktree 内安全解决。

不要在“看到完整图”“完成一轮”或“一次 E0 失败”时结束。代码修复后优先恢复原 Run。Harness/Desktop
Bug 可以恢复同一 Run；Pack 方法本身需要修改时，发布新 Pack 版本并开启新 Campaign，旧 Run 作为失败
资产保留，不能伪装成同一方法的连续结果。

## 最终报告

在试用目录写入 `Agent Trial Report.md`：

```markdown
# HimaHarness 0.3.0-trial.4 Trial and Bug Fix Report

## Verdict
MILESTONE_PASS / LOOP_WORKS_TARGET_MISS / PARTIAL / FAIL，以及最关键理由。

## Environment
App、manifest SHA、macOS、显示器、模型、Site、开始/结束时间、token/时间（可得时）。

## Black-box journey
首次认知、Pack 安装、Site discovery、readiness；恢复卡使用前后的事实分开记录。

## Campaign identity
Campaign/Run id、Pack version/digest、Goal、初始 Strategy、预算、workspace、owner。

## Campaign generations
逐代记录 Library、研究假设、免费指标、E0、frontier response、下一轮决策和证据。

## Final commercial result
matched identity、adoption、route retention、WNS/TNS/Fmax/PPA、endpoint frontier、claim limits。

## Bugs and fixes
每项列出复现、根因、修改文件、commit、测试、回滚方法、是否已推送 agent 分支。

## Trust assessment
区分 UI、Agent 自述、Ledger、Reader/Judge 和商业 EDA 事实；记录幻觉、隐藏动作和权限异常。

## Recommendation
能否交给不了解 HimaHarness 的芯片工程师，以及 main 应 cherry-pick 的 commits。
```

判定：

- **MILESTONE_PASS**：不依赖产品外人工研究，Hima Campaign 以有效 matched E0 达到或突破 5%；
- **LOOP_WORKS_TARGET_MISS**：自主反馈与多轮研究真实运行并积累知识，但预算内未达到 5%；
- **PARTIAL**：依赖恢复卡或 worktree 修复后才运行，且研究闭环未完整结束；
- **FAIL**：无法安装/准备/启动/恢复，完整图或所有权错误，证据不可信，或必须绕开 Hima 完成研究。
