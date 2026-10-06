# 开发模型与 Effort 分配

## DBOS 迁移本轮分配（2026-10-04 用户更新）

本轮 U8–U10 优先采用以下分工，覆盖下文较早的固定 high/Claude 默认规则：

- 主力编码：`gpt-6.1-sol / medium`，fresh context、明确文件所有权。
- 架构、独立 review、复杂故障诊断：`gpt-6.1-sol / high`。
- 非常简单的操作测试：可用 `gpt-6-luna`，只执行已明确的步骤和断言；领域判断及复杂故障交回 Sol。
- 独立 App/ATCS 操作继续使用 Codex；外部 Claude review 与实操均已取消。
- 产品模型仍为 DeepSeek 4.1 Flash。模型认证从既有环境变量取得，密钥不进入日志或证据。

每次派工记录实际模型、Effort、理由和最低测试层级。普通等待或失败不触发模型升级；
只有工作内容属于上面的架构、review 或复杂问题时使用 high。

用户于 2026-09-30 更新。适用于 polishing 的 Codex、Claude Code 与产品内 HimaHarness
Agent。各梯队使用固定模型，不因成本、等待或普通失败自行降级。

本仓库默认进行已有架构上的持续升级。任务必须按
`docs/agents/polishing-discipline.md` 写到 fresh session 无需重建历史即可执行；模型能力不用于
弥补含糊任务或混乱交接。

## 选择与派工

每个切片开始时，用一句话说明梯队、分工及最低必要测试层级。

| 梯队 | 固定模型 | Effort | 职责 |
| --- | --- | --- | --- |
| Codex 主协调者、实现与复核 Agent | 最新 `gpt-6.1-sol` | `high` | frontier、规格、实现、集成、最低 seam 验证、Claude handoff 消费 |
| Claude Code 主 Agent | `Opus 5.5` | Claude Code 对应高质量档 | 独立操作、拟人测试、商业 EDA、tester checkpoint/handoff |
| Claude Code Sub-agent | `Opus 5.5` | 与主 Agent 一致 | fresh context 下的明确工作包；不得换用低阶模型代替领域判断 |
| HimaHarness 产品 Agent | `DeepSeek 4.1 Flash` | 产品配置 | Pack 声明的业务角色、Agent Team 与 Campaign 执行 |

Codex 派工显式传入 `model: gpt-6.1-sol`、`reasoning_effort: high` 和 `fork_turns: "none"`，
避免继承旧会话配置。Claude 每次启动主/子 Agent 时核对显示模型为 Opus 5.5；无法满足时停止，
不静默替换。普通 follow-up 不当作模型切换，配置不符时另建 fresh session。
输入只给目标、规格指针、拥有的文件、接口、验收标准与必要失败摘要。
返回变更、证据路径、风险和 commit/远端 SHA；大日志及 Run JSON 留在文件中按需读取。
模型不可用或执行器不能应用覆盖时，报告实际配置并停止依赖该模型的工作。

## 并发与升级

小切片直接完成，不为派工而派工。存在独立任务、明确文件所有权且主任务也有可推进工作时，
允许主任务加最多三个 worker 并行；共享接线文件保持单一所有者。主任务先说明接口、文件范围、
验收与最低测试，子 agent 不自行继续派生 agent。

先区分任务不清、环境/输入问题和模型能力不足。规格不完整时先补任务；不得用更长上下文、
更多 Agent 或换模型掩盖缺少目标、身份、工具或验收标准的问题。产品重定义仍需用户明确授权。
交接保留最小复现、失败命令、预期/实际差异及已排除原因，不固定按重试次数升级。

切片稳定后集中做一次独立审查；后续只复核原发现涉及的增量。
出现新的权限、数据完整性或结果真实性风险时，补对应的专项审查。
主任务自行完成简单文档、格式和状态更新的差异检查。

## 上下文与等待

以一个可验收切片维护 `docs/agents/codex-claude-coordination.md` 定义的短 baton，记录目标、
当前提交、候选身份、已通过检查和唯一下一步。上下文出现陈旧注意力时写完 baton 后更换 session；
compact 不代替交接。
搜索和日志读取限定到相关符号、失败段或结构化字段，避免反复加载整份历史和原始证据。
长命令使用工具等待或脚本收集状态；按现有进度更新要求回传变化和简短摘要。

## 验证与开销

沿用测试分级，先运行能推翻当前行为的最便宜检查。真实工具接入前，盘点一份完整实际产物：
目录/链接、压缩格式、版本与命令头、阶段差异和必要字段；据此建立本地反例后集中修复。
局部格式修复先用 L0；接口稳定后运行相关 L2。L3 用于必要 UI 路径，L4 验证真实模型/工具，
L5 留给完整 pilot；具体要求以 `docs/testing-strategy.md` 为准。
复用满足身份和完整性要求的输入/结果，保留原失败，避免为整理报告重新进行研究或 EDA 作业。
判断完成以真实运行状态和产物为依据；文字回复超时与业务已完成分别记录。

在原验收记录补充实际开发模型/Effort、并发与升级原因；可得的请求数、token 和时间如实记录，
不可得时标为未测量。账号额度快照为全账号值，不能直接归因到一个任务或某个 agent。
Hima 测试中的“零模型”仅指被测产品未调用模型，不代表开发助手没有使用 Codex quota。
DeepSeek 4.1 Flash 保持产品真实模型基线；L0/L2、审计和机械封板优先零产品模型调用。

## 当前前沿的应用

当前工作由 GPT-6.1 Sol/High 的 Codex fresh session 协调，Opus 5.5 的 Claude fresh session
独立操作与测试，DeepSeek 4.1 Flash 执行真实 HimaHarness Agent/Campaign。三者通过 baton、
checkpoint、handoff 和不可变证据协作，不共享完整聊天历史。
