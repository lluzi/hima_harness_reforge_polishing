# HimaHarness 0.3.0-trial.2：零背景 Agent 拟人试用任务

## 你的角色

你是一名第一次接触 HimaHarness 的 AI Coding Agent。把自己当作一名熟悉芯片设计和命令行、
但从未看过 HimaHarness 源码、架构文档或内部测试的高级工程师。你的任务是实际使用产品，判断
它能否自然地帮助你理解产品、安装 Pack、建立 Site、准备并启动一个 Campaign、观察运行状态。

这是一项产品试用，不是源码审查。先通过可见界面和 HimaGuide 解决问题。只有界面路径已经失败、
错误证据已经保存时，才可以查看日志或附录中的恢复卡。不要修改产品仓库、Pack 或 App bundle。

## 你拿到的材料

交付目录：

`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.2`

其中包含：

- `HimaHarness.app`：待试用的 macOS Apple Silicon App；
- `Launch HimaHarness Trial.command`：隔离启动器，窗口固定打开在 Catsights 副屏；
- `Reference Packs/custom-cell-fmax-dtco/`：待安装的 V5 Reference Pack；
- `trial-manifest.json` 和 `SHA256SUMS.txt`：构建身份与文件校验；
- 本文档的交付副本。

你只得到以下业务信息：

- 目标任务：在 `aes_cipher_top` 上通过累积定制 Standard Cell Library 推进最大频率；
- 商业目标：matched post-route Fmax 提升 5%；
- EDA Site SSH：`luzi@192.168.50.41`；
- 推荐 Campaign workspace root：`/data/eda/project/hima_harness/polishing-runs`；
- 本机已有可用的 OpenSSH 身份，不需要索要密码。

## 预算与停止条件

最多使用 45 分钟和一次主 Agent 会话。Campaign 设置为一代、零重试、10 分钟 time box。
本次评估产品使用体验，不要求跑完整商业 P&R，也不以达到 5% Fmax 作为通过条件。

满足以下任一条件时停止继续尝试，保留现场并进入报告：

1. 相同界面动作连续失败两次，且错误信息没有提供新的可执行建议；
2. 需要修改产品源码、Pack 内容或手工伪造 Site 文件才能继续；
3. Campaign 已启动，并且你已经观察到完整运行图和至少一次真实状态变化；
4. 10 分钟 Campaign time box 已用完；
5. App 崩溃、无响应超过 90 秒，或无法安全停止正在运行的 Campaign。

完成条件：你必须交付一份按时间排序的试用记录、关键截图或录像、恢复卡是否使用、最终结论和
问题清单。只描述实际看见或实际执行的事实。

## 证据纪律

- 所有 App 操作和录制都在 Catsights 副屏进行，不占用主屏。
- 从启动前开始录屏，直到 Campaign 状态被观察并安全暂停或停止。
- 每个卡点记录：时间、当时页面、你的意图、执行动作、界面反馈、你下一步为什么这样选择。
- 截图至少覆盖：首次界面、HimaGuide 产品回答、Pack 安装审阅、Campaign Configuration、
  完整运行图、一个节点详情、停止后的状态。
- 将“界面显示”“Agent 回答”“实际运行事实”分开记录。Agent 的自述不能替代运行状态。
- 产品未解释清楚时，记录为发现；不要用你对源码或 Hima 内部设计的猜测替产品辩护。

## 步骤 1：冷启动和产品认知

1. 双击 `Launch HimaHarness Trial.command`，确认 App 出现在 Catsights。
2. 接受应用内的测试提示，建立一个新会话。
3. 不阅读其他手册，依次自然地询问 HimaGuide：
   - “你是什么产品？你能帮我完成什么？”
   - “什么是 HimaPack、Site 和 Campaign？它们之间是什么关系？”
   - “你现在带了哪些 Pack？我第一次使用应该怎么开始？”
4. 观察回答是否直接、是否扫描无关代码、是否给出当前安装状态和可执行下一步。

完成条件：三类问题都得到可理解的回答；你能用自己的话写出 HimaHarness 的用途和下一步。如果
回答含糊、长时间检索或声称不存在的能力，保存证据后继续，不替它补答案。

## 步骤 2：安装并理解 Reference Pack

1. 打开对话旁的 **Campaign** 工作区。
2. 在 **Campaign configuration** 的 Pack 区域使用 **Install a Pack**。
3. 选择交付目录中的 `Reference Packs/custom-cell-fmax-dtco`。
4. 在确认安装前阅读审阅页：检查 Pack id、版本、知识文件、方法文件和目标目录。
5. 确认安装，回到 Configuration，选择 `custom-cell-fmax-dtco`。
6. 先阅读 Pack 标题、状态和迷你运行图，再问 HimaGuide：
   - “这个 Pack 接受什么输入、交付什么结果？”
   - “它如何在失败后继续研究，而不是重复自动化流程？”
   - “现有 V5 证据已经证明了什么，又没有证明什么？”

完成条件：安装成功；Pack 出现在选择器；版本为 `5.0.0`；你能看到方法图，并能区分 5% 目标、
既有负结果和下一 Campaign 的研究任务。审阅页或 HimaGuide 隐藏这些边界时记录问题。

## 步骤 3：让产品建立 Site

1. 先只把 SSH destination `luzi@192.168.50.41` 和 workspace hint
   `/data/eda/project/hima_harness/polishing-runs` 填入 Site 区域。
2. 使用 **Discover with HimaGuide**，等待发现完成。
3. 阅读发现结果：服务器身份、可用资源、工具名称、workspace 以及仍缺失的 Pack 输入。
4. 告诉 HimaGuide：
   “我要在这个 Site 上运行刚安装的 Pack，目标 design 是 aes_cipher_top。请主动检查还缺少哪些
   输入，能自行发现的请自行发现；确实无法判断时一次只问我一个关键问题。”
5. 优先让 HimaGuide 更新同一份 Campaign configuration。不要一开始手工填写全部路径。

完成条件：App 保存一个可再次选择的 SSH Site；Configuration 清楚区分已绑定、未绑定和失败输入；
HimaGuide 能推进准备，或明确指出一个具体且可行动的阻塞。若 10 分钟后仍无法形成可执行动作，
保存证据并进入“恢复卡”。

## 步骤 4：准备 Campaign

在 Configuration 中核对并完成：

- Pack：`custom-cell-fmax-dtco`；
- Site：刚发现并保存的 SSH Site；
- Goal：`target_period_ns = 0.5`、`target_fmax_improvement_pct = 5`；
- Strategy：保留 Pack 默认值，除非 HimaGuide根据现场证据提出理由；
- Budget：generation limit `1`、retry allowance `0`、time box `10` 分钟；
- Inputs：所有必需项均显示已绑定；
- Knowledge：Pack 自带知识处于 ready；
- Readiness：没有未解释的 unknown、stale discovery 或 Permit 阻塞。

不要仅因为 **Confirm & start Campaign** 按钮可点就确认。先让 HimaGuide用自然语言复述将要运行的
任务、唯一业务变量、预算、Site 和停止边界，再对照页面事实。

完成条件：Configuration 显示 ready；HimaGuide 的复述与页面一致；你知道确认后会启动什么。如果
必须查看恢复卡才能达到 ready，在报告中把“自然准备失败”和“恢复后可运行”分别记录。

## 步骤 5：启动并观察 Campaign

1. 点击 **Confirm & start Campaign** 一次。
2. 确认同一个 Campaign 只有一个持久 Run，没有创建隐藏的第二个 Run。
3. 在 Live view 中观察：
   - 完整 reference graph，而不是只显示已执行节点；
   - Goal、当前节点、节点状态、分支、回访边和注意事项；
   - 至少一个节点从 awaiting/begun/working/ready 等状态发生真实变化；
   - 点击节点后能看到其类型、输入、输出、执行事实或阻塞原因。
4. 回到对话，询问 Campaign Agent：“你现在执行到哪里？依据是什么？下一步准备做什么？”
5. 打开一个 Side Talk，进行一句与 Campaign 无关的普通 coding 对话，确认 Campaign 仍可独立运行，
   Side Talk 没有自动取得 Campaign ownership。
6. 在达到本次观察目标后，通过 UI 请求暂停或停止。确认运行图更新，并确认 Campaign Agent 在最近
   一次回复后承认了控制请求。

完成条件：完整图、状态变化、节点详情、对话解释、Side Talk 隔离和人工控制均有实际证据。Campaign
若在首次业务节点前失败，也要保存节点和错误详情；不得把“Run 已创建”写成“Campaign 已成功运行”。

## 恢复卡：只在步骤 3 明确卡住后读取

使用恢复卡前，在记录中写下 `RECOVERY_CARD_OPENED`、打开时间、阻塞原因和已尝试动作。

预验证输入如下：

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

把这些值填入现有 Campaign configuration，不创建另一套 Site 管理方式。恢复卡只帮助区分现场发现问题
和后续 Campaign 问题；使用它不能把自然 onboarding 判为通过。

## 最终报告

在交付目录新建 `Agent Trial Report.md`，使用以下结构：

```markdown
# HimaHarness 0.3.0-trial.2 Agent Trial Report

## Verdict
PASS / PARTIAL / FAIL，以及一句最关键的理由。

## Environment
App version、manifest source SHA、macOS、显示器、开始/结束时间、实际模型、总 token/时间（可得时）。

## Journey
按时间记录每个用户意图、界面动作、可见结果和下一步判断。

## Product understanding
只根据 App 和 HimaGuide，说明产品、Pack、Site、Campaign 和 Agent 的关系。

## Milestone evidence
Pack 安装、Site 建立、Configuration ready、Campaign 启动、完整图、状态变化、节点详情、Side Talk、停止通知。

## Recovery
是否打开恢复卡；如果打开，说明自然流程卡在哪里，恢复后走到了哪里。

## Findings
每项包含 severity、复现步骤、期望、实际、截图/录像时间点、是否阻塞。

## Trust assessment
哪些结论由运行事实支持；哪些只是 Agent 自述；是否出现幻觉、隐藏动作或无法解释的权限请求。

## Recommendation
是否建议交给一名不了解 HimaHarness 的芯片工程师试用，以及发布前最需要修复的三项问题。
```

判定标准：

- **PASS**：不使用恢复卡即可安装 Pack、建立 Site、达到 ready、启动 Campaign，并完成步骤 5 的全部观察；
- **PARTIAL**：使用恢复卡后完成 Campaign 观察，或一个非破坏性问题需要绕行；
- **FAIL**：无法安装 Pack、无法建立 Site/ready、无法安全启动/停止、完整图不可用，或必须修改产品/Pack。
