# Issue #83 — Fix Timing 修复效果与正常产品路径

用户最新要求（2026-10-02）：“我不关心时间，就看修复效果就行。”先前效率目标由此撤回。
Issue: https://github.com/lluzi/hima_harness_reforge_polishing/issues/83

## 现状、归属与最小切片

基线 `0d641449` / ATCS 0.3.1 已实现完整节点外包、直接原生认证/当前 session 权限、完整
成果树接回；历史修复 Hold0/Setup18 和原 frozen live FAIL 各自保留。当前产品代码未证明
正常 GUI 全过程。审计未发现必须改源码的正常入口缺口，不为本次验收改方法或 Host。

现有 `index.ts:startPreparation` / `remote.ts:startChoices` 读取同一 Pack/Site。
`graph.yml` 正常入口 `bind-inputs` → readiness/baseline/native context → common R1 →
`auto-fix-reference` → `fix-timing` → Reader/Goal。不得 overlay 入口或预创建 Run。
`_cmd_auto_fix_reference` + `xtop-autofix-reference.tcl` 从同一 R1 连续执行普通 AutoFix，
直到目标、无改善、振荡、回归，保留最佳实测 checkpoint。诚实终止不要求人为凑两轮。
`hima_execute engineering` 使用当前 owner、Job/Channel/ACP 与原 Reader；实际 OpenCode
收到完整 goal/playbook/tools/native 权限，在单一 persistent XTop 自主工作。

DL 只准备 App、分开的原样 ATCS Pack、Site/Permit 和输入身份；FL 独占 GUI/现场操作。
开发模型为用户指定 GPT-6 Astra/High，FL Opus5.5/High，产品 DeepSeek4.1Flash。

## 冻结与操作

候选 manifest 固定源码/远端 SHA、App 校验清单、Harness、Pack/flow、Site/Permit、远端
wrapper/capability/native 输入和库/场景绑定身份。App 通过现有 `package-trial.mjs` 构建，
ATCS 单独按原样提供。专用空 Home 仅可准备已有模型认证及一次站点 Site/Permit 配置；
不复制旧 Ledger、Campaign 或成功产物。预配置须明确记入 manifest，不算 FL 的 GUI 操作。

FL 使用候选指定 launcher/Home/Workspace，在 Catsights 打开唯一 HimaHarness 窗口。
通过正常 Pack 安装入口选择冻结 ATCS 文件夹，选择 `linglong-atcs28` 并检查绑定输入；
在 GUI/Guide 提出完整 Fix Timing 目标并确认启动，使用默认正常图。观察 owning Agent
自行委派，必要追问/纠偏只通过产品对话。旧人工案例已进入版本化 playbook，不现场注入
已知实例/ECO 答案。工程结果、残余和 Goal 分开解释，实际打开保留的脚本、原始报告、
checkpoint/ECO、复现材料，再正常停止/release/退出并核实 owned quiescence。

现场 Run 外层上限六小时（21600000 ms），包含准备、共同 R1/对照、工程研究与交付；
至少保留原 Pack 的 15 分钟 closing reserve。在正常配置中设定，实际开始记录绝对截止。
不增加调用/步骤/round 配额，不静默续期。FL 开跑前核对无冲突 XTop/QuaLib/原生写者。
达到目标、无合理新假设、实际 blocker 或预算边界即可诚实结束；无需用完时间。

## 判断与反证

- 质量：同输入/R1/SDC/libs/scenarios 的原始 setup/hold count、WNS/TNS 相对强对照改善，
  必要质量不回归；保留 collateral/legality 已测范围与 unknown。残余不伪装清零，XTop
  不冒充最终物理签核。达到更好修复效果可以 Goal false/best-effort。
- 产品路径：实际独立 Agent 操作员从正常入口到交付/结束，保留关键 GUI、Run/Job/native
  transcript、checkpoint/ECO/scripts/raw reports。启动成功或后台资格不能代替全程。
- 两项分别给 PASS/FAIL/NEGATIVE/INCONCLUSIVE/BLOCKED；效率不作为胜负标准。
- 反例：改约束/缺场景、弱化对照、缺 checkpoint、只口述效果、开发者预建 Run/手写答案、
  无法从产品访问产物、未释放 owned 进程，均不能称对应验收通过。

最低验证复用基线原 Host/Reader 与 Site release qualification；正常 prefix 的本地
Python native-context/common-R1/强对照测试先于现场。App packaging 校验和无 GUI Host
smoke 是新 App 的 L0/L2；L3/真实模型与 EDA 完整业务由同一次 FL 正常操作完成。无源码
变化不重复全量测试或已合格商业工作。出现真实缺口先在最低 seam 复现，再改原所属模块。

回滚：保留 `0d641449`、旧 deployed archive 和全部历史 Run。候选字节在 Run 中不变。
失败先保留成果，核实实际执行后在最近安全边界恢复；不因 schema/传输问题重做工程。
若必须换候选，先正常收束 owned Run/process，保留旧证据，新身份新任务不改写旧结果。
