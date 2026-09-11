# 旧版 himaharness 对标简报

本文件保留对标时的观察与建议。后续用户已确认旧版架构仅供参考，polishing 必须在当前 prototype 架构上进行；最新价值定位和决定见 [产品访谈](/Users/lluzi/code/hima_harness_reforge_polishing/docs/product-interview.md)。

调研日期：2026-09-10，美国太平洋时间。

**旧版的强项是完整的工程执行与证据交付体系。当前 prototype 已简化宿主集成和执行主线，但还要在真实业务深度、作者体验、长任务连续性和可观察性上追赶。真正的超越应表现为：工程师更容易完成一项有效探索，同时保留旧版的可恢复性和证据可信度。**

## 阅读范围

本轮只读 `/Users/lluzi/code/himaharness`，HEAD 为 `636475cb30c7d312222b0c492872154f327d9113`。文件身份见 [legacy-evidence.json](/Users/lluzi/code/hima_harness_reforge_polishing/docs/assessment/2026-09-10/legacy-evidence.json)；工作区存在用户原有修改，故报告依据包含当前工作树，不能视作干净发布版本。本轮未运行产品、测试或 EDA 作业，未读取凭据文件。历史 Demo 只核对留存报告，未重新播放或验收。

对照 prototype 采用上一轮的 `55e6ba18f5d8fa67c02fe0ac8651a28d7b5ff573`，本轮复核 HEAD 未变。其 #58/#59 开发分支不能计为主分支完成能力。旧项目的开发授权、产品锁和 Phase 4 规范仅用于理解旧版，不转移到 polishing。

## 旧版的产品与架构

旧版同样面向复杂芯片设计工作。**Extension Package 定义业务，Runtime 执行并保留事实，AI 在声明的决策点选择，Desktop 展示同一份运行事实。** 当前工作树的产品锁仍为 Phase 2，附带 Phase 3 作者工具和桌面层；Compiler 2.1、Runtime contract 1.4.0。Phase 4 开发进展不等于产品已接纳。

主链路是：

```text
HimaCode（完整 OpenCode Desktop + Hima Live Run）
    ↕ Hima Operator / MCP
独立 Python Runtime service + 持久 Execution Driver
    ← Package Compiler：Execution Grammar → Graph IR
    → Site / workspace / remote tmux / EDA tools
    ← Parser / Artifact / Evidence
    → typed Claims / immutable Finalization / Desktop projection
```

Package 包含能力、工具、Grammar、Parsers、Policies、Evidence/Claims、Agent Skill、Recovery Knowledge 八类资产。Grammar 的四个原子为 `action / decision / wait / end`，六个组合器为 `sequence / select / repeat / spawn_join / recover / finalize`。组合器编译后消失，Runtime 接收稳定 Graph IR。

代码定位：[产品锁](/Users/lluzi/code/himaharness/configs/current-product.yaml)、[架构说明](/Users/lluzi/code/himaharness/docs/architecture/hima-harness-phase2-architecture-and-celluzi-extension-guide.md:41)、[Grammar](/Users/lluzi/code/himaharness/docs/architecture/hima-execution-grammar-v1.md:47)、[Execution Driver](/Users/lluzi/code/himaharness/hima_runtime/execution_driver.py)、[Final claims](/Users/lluzi/code/himaharness/hima_runtime/final_claims.py:108)。

## 值得超过的六项能力

| 维度 | 旧版已有的基线 | Prototype 现状与后续对标点 |
| --- | --- | --- |
| 真实业务深度 | 历史材料涵盖 TSMC28 定制 Cell、Fmax、SKY130、3DIC；有跨工具、Child 并行、post-route 和证据闭环 | 主分支仍是 opene902 timing probe。优先让 AES/TSMC28 一条完整方法有效运行；其他业务作为扩展性参考，不立即扩大为四个 Pack 的开发任务。 |
| 长任务连续性 | Desktop bootstrap 复用或 detached 启动 Runtime；关闭桌面不停止 Runtime，Driver 有独立生命周期 | 当前 Electron 关闭会停止 dsh Host。远端 Job 存活与后续 Generation 自动推进须分别证明；恢复不能重复启动仍在运行的 Job。 |
| AI 的工程参与 | Operator 在 Package 限定的 Decision/恢复点提交结构化选择；历史录制记录包含真实模型回合；另有 adaptive-script 实现 | 当前主分支 chooser 是确定性数据，model moment 正在 #59 分支开发。要证明模型在 Workshop 中产出的工具能完成当前业务，并把文件、执行结果和判断连起来。 |
| 作者工具链 | 有 Golden Flow inventory、自然语言 intake、缺失语义问答、受限报告编译器、draft/candidate 检查、静态 HTML inspection 和 review 包 | 五阶段作者流程仍待形成。衡量“外部工程师能否独立做出可运行 Pack”，同时记录用时、返工和需要开发者帮助的次数。 |
| 运行透明度 | 完整 OpenCode 工作台加 Live Run；业务 Graph、Root/Child、当前工作、真实终端输出、Evidence 和结果使用边界；AI 文本与 Runtime 事实分开呈现 | 现有表单、Run 卡片、代际趋势和报告已有基础。要让用户知道正在做什么、哪里被阻塞、需要采取什么动作，并能追到原始日志与报告。 |
| 可信交付 | 显式区分执行结束、证据验证、最终声明和发布；finalization 绑定 Package、Graph、Root/Child 与状态身份 | 当前 typed observation、Judge、报告哈希值得保留。需要按实际业务验证终态与“结果可用”的关系，避免以进程退出、预算耗尽或一条 PASS 代替完整结论。 |

独立 Runtime 的直接代码证据是 [hima-bootstrap.ts](/Users/lluzi/code/himaharness/desktop/opencode-overlay/src/main/hima-bootstrap.ts:240) 中的 `detached: true` 与 `child.unref()`；这不意味着笔记本睡眠时本机 Python 仍能继续执行，也不意味着模型决策在 Agent Host 退出后必然持续。作者能力和限制见 [AI Authoring](/Users/lluzi/code/himaharness/docs/hima-extension-package-ai-authoring-feature.md:633)，桌面投影见 [Desktop README](/Users/lluzi/code/himaharness/desktop/README.md:49)。

## 历史结果：旧版不是只有设计文档

本轮读取四个代表性 Demo 的 `recording-report.json`。四份记录均保存：Runtime `SUCCEEDED`、verification `FINALIZED`、publication `PUBLISHED`、Desktop acceptance `pass: true`，frame drop 为 0。模型回合数分别为 2、2、3、2。

| 历史场景 | Run | 能力与结论边界 |
| --- | --- | --- |
| TSMC28 定制 Cell | `gr_20260816_060117_938542` | 展示综合、LC、APR、挖掘、adoption 与证据链；生成 Cell 有 abstract geometry 限制，不能视作真实版图 signoff。 |
| Autonomous Fmax | `gr_20260821_020514_327246` | 有长流程、现场反馈、post-route 与最终发布的历史记录；“成功发布”不单独证明发生了有效的多代收敛。 |
| SKY130 | `gr_20260816_110825_751522` | 有开源工具链的历史完整路径；较新的失败录制没有被当成成功版本。 |
| Cool3D | `gr_20260813_212158_934319` | 有 OpenROAD、三个隔离热分析 Child、Join、选择和 HotSpot 确认；是声明假设下的模型分析，不是硅测量。 |

来源：[四个代表性 Demo](/Users/lluzi/code/himaharness/outputs/HimaHarness-Four-Representative-Customer-Demos-2026-08-25/README.md)；各 JSON 的字段与哈希已摘录至本目录的 evidence 文件。以上是旧身份下的历史证据，不能用于认证当前 dirty 工作树、当前 Package 版本或新一轮探索效果。没有逐帧重验视频、重新计算各 Demo 的业务收益或复查全部底层 EDA 原始输出。

## 旧版仍未完成的部分

**领域效果仍有缺口。** Phase 4 Register 的 T7 登记为 `MECHANICS_PASS / EFFECTIVENESS_INEFFECTIVE`：该次真实实验 Fmax gain 为 **0.5859375%**，adoption 为 **5**，没有达到 5% 目标。它和上表历史 Fmax Demo 是不同实验，不能相互替代。[T7 记录](/Users/lluzi/code/himaharness/docs/phase4/hima-harness-phase4-m1-evidence-and-disposition-register.md:6283)

**作者工具多，并不自动代表作者更轻松。** Register 记载 S7 authoring correctness 已验证，但该次 candidate/control 用时比为 **2.014129**，效果被判为 `INEFFECTIVE`。这个对照结果只适用于该实验，仍足以说明后续应直接测量作者任务完成成本。[M4 汇总](/Users/lluzi/code/himaharness/docs/phase4/hima-harness-phase4-m1-evidence-and-disposition-register.md:6389)

**完整作者体验和交付接纳仍有边界。** 当前作者说明明确未支持可视化 Grammar 编辑器、任意 vendor-specific 报告及一般多决策/循环/多阶段恢复的自动作者路径；这不等于 Runtime 不支持相应执行语义。较新的 Source 280 在通用本地流程执行和发布成功后，仍因同会话缺少明确的 evidence retrieval 被操作验收拒绝，Source 281 是下一次预登记。这反映了产品集成、证据操作和验收之间仍有成本，不是本轮对相关检查必要性的否定。[作者限制](/Users/lluzi/code/himaharness/docs/hima-extension-package-ai-authoring-feature.md:655)、[Source 280](/Users/lluzi/code/himaharness/docs/phase4/hima-harness-phase4-m1-evidence-and-disposition-register.md:10055)

产品锁仍为 Phase 2；没有因为某些低层检查、Demo 发布或预登记就把 Phase 4/M5 全部算作完成。本轮是简要对标，没有重做完整的 Phase 4 状态审计。

## 对 polishing 的直接启发

把旧版的恢复、事实来源和结果边界作为质量底线；把一条真实探索的完成率、Pack 作者的独立完成能力、异常处理的清晰程度作为超过它的主要尺度。测试应包含普通工程师的完整操作，而不仅是开发者脚本顺利跑通。

在 prototype 上持续打磨的方向因此很明确：先完成一项真正有用的 Pack，并让用户能顺畅地创建、运行、理解和复用它；保留必要约束，把身份校验、证据收集和内部状态协调尽量由产品自动处理。每项改进以可复现的用户问题和前后对照证明价值。
