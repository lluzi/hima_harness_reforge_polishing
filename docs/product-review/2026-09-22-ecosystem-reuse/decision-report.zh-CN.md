# HimaHarness 生态复用与下一阶段能力建设研究

研究日期：2026-09-22（本地时区 America/Los_Angeles）。Hima 基线 `47ce341a5a8b9891e8ca168ba3477cca1d0e154a`。本轮是研究与组件取舍，未安装依赖、修改运行代码、执行候选项目或恢复 trial30。

## 1. 结论：开发效率的最大增量在哪里

**先把现有 DSH 的 agent、上下文、会话和 UI 扩展面用完整，再选择性借入报告呈现、诊断和评测能力，是目前收益最清楚的路径。** 已有 HimaPack、Fabric、Site、Ledger、Workshop 和作者流程继续承担业务规则。社区项目能缩短通用机制的开发，但不能替我们定义什么是合法 ECO、可信 Library 比较或一次正确的 timing closure。

相较上一轮产品 review，本次增加了三个层次的证据：当前实际安装的 DSH 接口；社区仓库的固定源码、manifest 和许可；候选与 Hima 数据、权限、生命周期的逐项对照。筛选结果分成五类：

- **原生复用**：当前产品已经使用或安装的公开接口，扩展现有消费者；仍需要消费端回归。
- **小范围接入**：新增一个清楚职责的依赖或 adapter，经隔离 POC 才进入 App。
- **窄提取**：借协议、测试和少量纯函数；复制代码时保留许可，并承担以后维护。
- **仅借设计**：参考交互或方法，不运行该项目，不带入它的状态和执行控制。
- **暂缓**：已有方案足够，或缺少性能/业务反例，或接入代价超过当前价值。

优先组合建议是：**DSH 原生 subagent + Hima 专属角色合同；原生 systemPrompt/context + 受控业务上下文；既有作者五阶段 + 固定反例评测；现有 Workbench + 类型化洞察报告 + ECharts；按需轻量诊断与现有 Hima 控制/完成通知结果的 UI 呈现。** 多代理团队、Guide、Pack 开发和数据洞察由这些组合共同支撑。

不建议一次安装一批“增强插件”。我们需要的是每个依赖减少一类明确工作，并且其升级、失效或卸载不会改变客户的设计事实和执行权。

### 六个升级领域的明确选择

| 领域 | 当前责任主体 | 复用选择 | 第一项用户可见结果 | 不继续扩大的信号 |
| --- | --- | --- | --- | --- |
| sub-agent 团队 | Campaign owner + DSH/Fabric | 当前原生候选；社区 teams 只借模式 | 一个分析结果被独立复核，owner 解释采纳/拒绝 | 同上下文单 agent 同样正确且成本更低 |
| HimaGuide | 现有 prompt/context、Preparation | 直接加深已用接口 | 指着当前 Run 问问题，不再猜 ID 或全盘搜索 | 必须另建执行主脑才能回答只读问题 |
| Pack 开发 | 五阶段作者、check/release | 现有流程 + 反例，Plugin Guide 仅维护参考 | 第二位作者能恢复阶段并交付小 Pack | 只生成更多文档，支持工时不降 |
| 数据洞察 | Workbench + Host/Pack 数据 | 报告协议窄提取 + ECharts adapter | 正确条件下比较库变化并回到证据 | 数据身份/单位不闭合，或 API qualification 未通过 |
| 产品竞争力 | 领域工具与业务 Pack | 通用底座复用，领域语义自己维护 | 更低导入/审阅成本的可复核交付 | 只有 agent/图表数量增加，无工程决定改善 |
| 真人体验 | 当前 client 与 RunView | 选择上下文、状态摘要、按需诊断与通知呈现 | 用户知道该等、介入还是恢复，控制始终有效 | 新面板增加学习负担或改变状态权威 |

## 2. 深层洞察：过去问题反映出的五个接口缺口

### 2.1 会话的结束和业务的结束是两个不同事件

过去的停滞、消息排队、外部 tester 催促，暴露的是三种生命周期混合：模型 turn、持久 Campaign、商业 Job。一个 turn 结束可能只是 Agent 等工具；一个 Job 结束也可能需要补读数；Campaign 完成需要满足目标或形成诚实的停止结论。

因此通知插件的“turn completed”只能作为界面提示，不能触发“任务成功”。定时插件的“新开一次 session”也不能被用于接续原 Run。我们真正需要的是现有 Host/Fabric 完成事件、可靠交付和 owner 恢复；外部定时提醒只作补充观察。这是选组件时必须先问清的对象关系。

### 2.2 上下文问题有三个不同来源，不能都用 compact 或 memory 解决

第一类是**缺少本来已知的身份**：右侧已经选中 Run，Guide 却不知道准确 ID。解决方式是受控上下文注入。
第二类是**把不必要的信息送入模型**：大日志、大表、完整知识正文。解决方式是文件引用、按需查询、预算和短回执。
第三类是**跨代或跨会话的事实漂移**：旧 pause、旧 demand、旧模型结论冒充当前状态。解决方式是版本化来源、Ledger 校验和明确失效条件。

上下文仪表盘能帮助找到第二类问题，搜索/memory 能帮助回忆材料，但它们不会自动解决第一和第三类问题。特别是人类暂停，需要代码保存和执行，不能依赖“记住不要继续”的提示词。

### 2.3 专业 agent 的价值来自任务边界和输入质量

把同一份长历史分给六个 agent，通常只是增加并发成本。更有效的分工是给每个 specialist 一个可判断的局部问题：这个报告是否完整；哪些 endpoint 发生退化；这次 Cell demand 是否真正回应前代；这个 Pack 失败后能否恢复。

团队必须交回原始证据引用、未知和候选产物，而不是只有长篇建议。当前 `analysisRecord` 记录 owner 的有依据综合分析，并没有完整的 adviser task/role/adoption 字段。原始 worker 输出先保留在其 DSH Session，A/B 中用独立评测产物关联输入和结果。只有团队 UI 的真实消费者确定后，才考虑给现有分析记录加最少的引用字段，而非宣称现在已经有完整贡献追踪。团队能力的验收单位应是“减少了多少无效往返、提高多少首次有效产物”，不是同时在线的 agent 数。

### 2.4 “把 SOP 变成 Pack”主要难在语义翻译

YAML、目录和脚本生成已有大量成熟工具。真正困难的是从 SOP 识别：何时可复用结果、何时重新提取、怎样判断工具成功和业务成功、目标缺一项时能否结束、谁能改变策略。

已有作者五阶段、Zod、`checkPack`、发布 seal 很有价值。下一步应补义务到产物的追踪、失败夹具、角色交接和恢复；引入通用文档框架或 plugin scaffolder 不能自动完成这些领域判断。

### 2.5 Library 洞察与 Live Run 应共享事实，但各自围绕不同问题组织

Live Run 帮用户理解工作过程，洞察面板帮用户比较数据、条件与影响。二者共享同一份产物身份、来源与受控动作，但不要求共享同一种图。

这使 `dsh-data-agent` 的冻结报告/图表模式比整体 BI 程序更有借用价值，也使更换整个运行图框架并非必要前提。我们可以在保持现有工作台的情况下，先交付一个可比较、可追溯的 Library 分析。

上述五个判断来自当前实现和试用回顾；详见[上一轮 review](../2026-09-22-next-stage/review.zh-CN.md)。它们是本次筛选组件的准则，不是新的运行时架构。

## 3. 生态地图与版本现实

本次把“生态”分为三层：Hima 已有业务组件、实际依赖的 DeepSeek Harness 原生/社区组件、少量职责明确的开源库。没有将其他同名网站、第三方 registry 或标有 `@deepseek-ai` 的社区 fork 自动当作官方产品。

Hima 当前固定 DSH **0.1.5-alpha.1**、Cordis **4.0.2**、React **18.3.1**、Node **24**。官方仓库本轮读取的 `master`/`dsh-v0.1.7-alpha.2` 为 `00102833dfaee1da9f48a3a8eae9d34005a75218`。官方仍将产品列为 developer preview；它的版本更新和社区 API 范围都不能替代 Hima 当前锁定版本的验证。[官方入口][dsh-home]、[固定仓库快照][dsh-source]

社区 registry 和 curated list 用于发现候选；真正的选型回到作者仓库的代码、package、patch 和 LICENSE。本轮同时遇到目录网站与当前仓库版本不同、插件使用不存在过的 UI slot 后修正、peer range 很宽却依赖特定 runtime seam 的情况。因此没有用星数、目录收录数或“可安装”标签衡量成熟度。[候选发现目录][catalog]

**“已安装”也有三层区别：** 在 lockfile 中可见；在当前 profile 真正挂载；在 Hima 当前业务路径经验证使用。这三者不能互换。例如已有传递依赖的 virtualizer，在 Hima 直接 import 前仍须显式声明依赖并验证构建；Schedule 包在锁文件中存在，也不说明当前会话已经启用了对应 overlay。

## 4. Agent 团队与可靠接续：优先复用原生能力

### 4.1 借用什么

| 能力 | 可复用基础 | Hima 必须补上的部分 |
| --- | --- | --- |
| 创建独立或继承上下文的 worker | 已安装的 DSH subagent provider、spawn/fork、会话与子 agent UI 候选；挂载/可达性待测 | 角色模板、最小任务输入、读写范围、工具白名单、预算、结果 schema |
| 主/子通信和状态查看 | 原生 subagent 控制与 agent registry | 把 child ID 与 Run/node/generation/attempt/input hash 关联；过期结果不进入当前决策 |
| 持续研究记录 | 现有 Hima analysis/observation/Knowledge 引用 | 贡献者、反例、分歧、owner 采纳理由与产物身份 |
| 工具和上下文隔离 | DSH scoped context、tool guards、agent composition | Analyst/Reviewer 只读；Coding 的隔离文件范围；禁止借 Bash/SSH 绕开 Site/Run 控制 |
| Job 完成后接续 | 现有 Fabric/Job 状态与 Host 的 owner follow-up | 去重、可恢复的交付状态、暂停优先、忙碌/失联/重启后的同 Run 处理 |

第一切片选两个只读角色：**Evidence Analyst 和 Independent Reviewer**。Analyst 先给出有界结构化结果，Reviewer 再依据同一冻结来源和这份结果进行反证。若需要并行，则将第二角色明确称为 Counter-analyst，二者独立分析后由 owner 综合；不能把两个互不看产物的分析员称为独立复核。只有 owner 调用 Hima 业务执行接口。后续再加入隔离 Node Coder、Strategy Researcher。拥有新上下文不代表它拥有新一份 Campaign 权限。

当前 0.1.5 的明确接口包括 `ctx.agents.create/resume/list`、`ctx.subagents.start/startContinuable/sendMessage/interrupt`、child `persona/toolFilter`、`subagent/start/end` 和 `agent.followup/steer/inject`。首切片固定当前 0.1.5-alpha.1，优先一次性 worker、深度 1、继承现有 DeepSeek Flash route、有界 maxTokens、只读 allowlist（不含 hima_execute、Bash/SSH）。先核对实际 profile 的 tool-schema/UI slot；若 Hima 直接 import 子包，显式声明依赖。可续聊 child 的恢复和回收生命周期留待必要时验证。fork 继承截至完整 turn 的上下文，fresh spawn 只收到任务包；Reviewer 默认 fresh 更容易避免继承 owner 的结论偏差。[当前 pin 的 Subagent 接口][dsh-subagent]

### 4.2 为什么不原样装一个 Agent Teams

社区团队组件可帮助我们理解任务板、角色、消息和依赖的呈现。但完整 captain/member/task 系统往往同时引入新的工作状态和派工控制，而 Hima 已有 Campaign owner、Fabric 图、预算和 Ledger。接入前必须证明这些状态只是投影、不会与原控制冲突。

本轮具体核查了 `dsh-agent-teams@0.1.20` 和 `dsh-background-agents@0.9.9`：前者的 captain/task/DAG/mailbox 与当前业务权威重叠，peer 列表也不含当前 alpha pin；后者虽有宽 peer 范围，但其事实事件与 projection 有实际宿主兼容限制，不能由 semver 推断全部功能工作。两者只进入设计参考。[Agent Teams][agent-teams]、[Background Agents][background-agents]

因此更合适的第一步是原生 subagent + Hima 的委派合同；社区后台 agent/团队模块可贡献角色配置、只读进度和产物回收方式。外部 Codex/Claude providers 留作以后可选 provider 适配，不把它们变成产品研究必须依赖的隐含能力，也不改变现有产品模型基线。

上游 0.1.7 已改变 continuable catalog、archive、capacity 和默认深度等语义。它可能长期有价值，但不应为了第一个只读 specialist 顺带升级：先在当前版本验证角色价值；需要持久 child 时另开兼容/迁移切片，恢复、取消、容量和原有 App 都要覆盖。[上游版本][dsh-source]

### 4.3 三种“提醒”组件的适用边界

| 组件 | 已核实语义 | 决定 |
| --- | --- | --- |
| 原生 `dsh-schedule@0.1.5-alpha.1` | durable session reminder；同一 live root 交付；冷会话保持 overdue；消息排入不等于执行成功 | 可补充同会话提醒，不能充当 Campaign 恢复或可靠 Job 通知 |
| `dsh-automation@0.1.7` | 每次调度创建新的 root Agent/Session；有自己的任务定义和运行历史 | 适合未来独立“每日回归报告”；当前 Campaign 接续暂不采用 |
| `dsh-notification@0.1.4` | session projection 驱动浏览器通知和过滤；页面关闭/断线期间的完成不能保证补通知 | 借偏好、去重和显示机制；事件由 Hima 明确映射为“等人/阻塞/业务完成”，不能把 turn completion 当成功 |

这里最值得复用的是小机制，最需要自己做好的是业务交付可靠性。不要把此前 issue #48 的消息合并修复推倒重做，也不要用每 15 分钟新建 session 来掩盖 owner 接续缺口。[Schedule 源码目录][schedule]、[Automation 固定源码][automation]、[Notification 固定源码][notification]

## 5. HimaGuide 与上下文：让事实进入正确位置

### 5.1 当前原生接口足够支持第一个明显提升

Hima 已通过 `ctx.systemPrompt.section` 注册稳定产品说明，通过 `ctx.systemPrompt.context` 提供动态 inventory。DSH 的 agent-scoped contribution、session query 与按需 skills 能支撑专用 Guide；缺少的主要是 Hima 层的上下文选择和连续体验。

建议 Guide 每轮取得一个有界上下文包：用户当前意图、已选对象、owned/selected Run 的区别、Pack 身份与成熟度、Preparation 缺项、最近有效结果、未决人类控制、允许的下一动作。大报告只提供引用和读取入口。拥有中的 Run 上下文按 owning session 注入。浏览器所选对象则在用户发送问题或点击“询问这个节点”时显式附带小型引用，由 Host 重新解析；不能把窗口焦点变化隐式灌进另一个后台 owner 的下一轮。选择可以改变本次解释范围，不能改变执行 owner。

我们自己的数据来源优先级应固定：**当前明确用户指令与 Host 记录的控制 → 当前 Run/输入/方法事实 → 已授权的当前知识 → 有出处的历史经验 → 模型假设。** 这不是让 Prompt 覆盖权限；最终动作仍由 Fabric/Permit 执行。

### 5.2 三类上下文诊断组件，选一个起步

| 候选 | 适合解决什么 | 限制与推荐 |
| --- | --- | --- |
| `dsh-context` 0.54.4，Apache-2.0 | 可视化 context 组成、请求趋势、compact/注入和 agent 关系 | 可借 dashboard 与所选 request 下钻；源码包含 npm 版本查询和价格数据获取，离线产品需关闭/替换这些外部请求；不因为它能显示上下文就允许其改变策略 |
| `dsh-context-doctor` 0.7.2，BSD-3-Clause | 按指令链、skills、工具/MCP schema 找重复和占用 | 适合作者/支持的按需诊断；token 是启发估算，不能冒充账单或精确 tokenizer；不自动删除知识与规则 |
| `dsh-fast` 0.2.14，Apache-2.0 | load/restore、spill、compact、cache 和时间分布的轻量诊断 | 适合作为首个隔离诊断候选；仍须测试 profile 生命周期与当前 DSH；其持久 metrics 只是派生缓存，不写为业务事实 |

版本及固定提交见[组件清单](component-shortlist.zh-CN.md)和[结构化证据](components.json)。三者职责有重叠，**不建议同时启用三个面板**。近期优先一个只读诊断入口，用真实 trace 找出慢在身份查找、模型、工具还是等待；有具体可视化需要再挑 `dsh-context` 的纯显示部分。[Context][context-plugin]、[Context Doctor][context-doctor]、[Fast][fast]

诊断收益也必须测量：开启后增加多少启动/渲染开销；是否改变模型可见工具；能否正确识别一次无意义全盘搜索；诊断输出是否引入新的长上下文。没有这个对照，就可能为了“优化上下文”又多塞一套工具与提示词。

### 5.3 跨会话 memory 与自我改进只借适当部分

`dsh-mnemon` 的 Source → Strategy → immutable View 对“来源、上下文预算、逐 turn 固定快照”有参考价值。`dsh-continual-evolve` 的候选、审阅、批准、验证和回滚流程，对 Pack 方法升级有参考价值。但两者另有持久状态、注入和晋级逻辑；当前不直接导入，以免与 Pack Archive、当前知识、Ledger 和已发布方法产生多条写入路径。[Mnemon][mnemon]、[Continual Evolve][evolve]

Hima 要积累的是带条件的工程经验：哪类输入、哪个工具版本、哪种动作、什么观察、何时失效。先将它们做成可引用的 evidence/fixture；提炼出的规则作为新 Pack 版本候选，经 review 和验证再发布。频繁改写 prompt 或 skill 本身不等于研究成功率提高。

## 6. Pack 开发效率：原生作者流程加一套真正的评测

### 6.1 可直接加深的已有资产

现有五阶段 author skills、`packStage/checkPack`、Zod strict schema、作者会话范围限制、真实 test Run 标记、release seal、安装预览与确认，都应该继续使用。它们已经省去了新造作者 Runtime、插件市场和发布系统的成本。

需要补齐的不是一个更大的 skill，而是每一步的可交接材料：

1. 业务目标、输入/输出、固定约束与未决项；
2. SOP 中每项义务落到了哪个规则、脚本、Reader 或失败路径；
3. 正常、空结果、真实零值、缺字段、格式变化、超时的夹具；
4. 受影响下游、可复用产物和安全重试范围；
5. 当前阶段、测试范围、发布候选和安装后的精确身份。

Guide 可自动装配这些材料并引导用户回到原作者会话；权限不够或阶段没完成时显示准确出口。既有技能要求人工触发各阶段，若以后允许一次授权生成多个候选阶段，要以明确产品改动实现，不能暗中通过 Prompt 绕过 guard。

### 6.2 三个外部方向的实际价值

**`dsh-plugin-guide`：用于 Hima 维护者扩展 DSH。** 它提供按需的 DSH/Cordis 开发参考与静态检查方式，值得作为维护者知识来源。但 DSH plugin 的 Cordis patch、host/client composition 与 HimaPack 的业务 contract/graph/readers 是不同交付物。不得用它的 plugin 验证冒充 Pack 业务验收。[Plugin Guide][plugin-guide]

**Promptfoo：用于可重复评估 Guide/作者输出。** 可以给固定 cases、输出断言和配置矩阵一个现成入口。正确用法是驱动隔离的合成/脱敏输入，并由已有 Hima checker 判定结构结果。Promptfoo 分数不能替代动作权限测试、真实模型工具闭环、商业 EDA 或 release 证据。需要测试 agent 工具行为时，先扩展已有 Host replay/contract harness，再考虑让 Promptfoo 只负责调度结果比较。[官方项目][promptfoo]

**Docling：保留为文档提取的条件候选。** 当前 `unpdf 1.8.1` 已有离线 PDF 页级提取、hash、索引和按需读取。只有实际 SOP 的扫描页、表格或布局无法可靠读取时，才评估 Docling adapter；届时必须保留页/表位置、原始来源和 unknown。没有真实失败样本前，先不增加 Python/OCR/模型运行环境。当前文本能力也不能被夸大成完整复杂文档理解。

### 6.3 最有价值的作者 fixture 库

不需要立即建设一个通用评测平台。先把现有事故转为小而明确的反例：

| 夹具 | 用来验证什么 | 可以避免的返工 |
| --- | --- | --- |
| evidence PASS、setup PASS、hold FAIL | chooser 建议与全目标完成门一致 | 执行到末尾才发现目标语义不全 |
| 正常零违例与空/截断报告 | Reader 的真实零值和 unknown 区分 | 每换一种报告格式再跑完整 EDA |
| 容器没有继承环境变量 | wrapper 输入是否真正到达工具 | 在第一商业节点才发现参数为空 |
| 第二次保留 best DB，输入包含同名符号链接 | 幂等与恢复 | 首代成功、跨代才失败 |
| 人类 pause 后 Job 完成并回传 | owner 和 worker 都不能自行解除人类 hold | 用户不敢让系统后台运行 |
| 固定 candidate pool，仅商业反馈变化 | 选择是否可解释地改变，或明确不变原因 | 代码变多但研究没有利用反馈 |
| 错误 Pack/Run ID 与旧版本知识 | Guide 是否取当前合法身份 | 漫长搜索与错误上下文 |

已有测试包含其中一些机制；新工作要先复用和对账，不再重复建同样的测试。这套数据比继续堆提示词更容易跨模型保持行为，也能让第二位 Pack 作者快速知道哪里还没闭合。

## 7. Library Intelligence：最值得具体借用的组件组合

### 7.1 复用决策

| 组件 | 决定 | 减少的开发内容 | Hima 仍需负责 |
| --- | --- | --- | --- |
| 当前 Workbench/Slots/tool-view/Files | 原生复用 | 窗口、会话、右侧面板与消息入口 | 当前分析/数据身份、与 Run 的关联、合法后续动作 |
| `dsh-data-agent@0.1.5` | 窄提取报告协议、校验与冻结回放 | dataset/view 关联、载荷限制、报告展示结构、可恢复回放 | Liberty 语义、单位、condition、实际设计影响；不接入它的 SQL authority/write tools |
| Apache ECharts 6.1.0 | 固定版本的 chart adapter 候选 | line/scatter/heatmap、zoom、legend、联动和渲染 | 从受控 view schema 生成 option；禁止自由 formatter/URL/JS，确保语义与可访问性 |
| TanStack Virtual 3.14.11 | 有大表需求时复用已有版本 | 大量 Cell/arc/finding 的渲染窗口 | 显式依赖声明、row identity、分页和 sourceHash；不能将传递依赖当稳定接口 |
| `dsh-tool-stat` 固定源码 | 窄算法和反例复用 | 稳定求和、方差、百分位、相关性和数值边界 | 在 Site/Host 数据上计算；原数组不进入模型参数；相关性不作因果证明 |
| `dsh-genui` | 仅借 renderer 限制与交互原型 | whitelist、树深/大小限制、懒加载和局部状态 | 最终事实由 typed report 提供，UI 不直接发起 EDA |
| PaperMachine | 仅借 artifact/provenance 交互 | 图表与代码/版本/环境联查的设计思路 | 不导入完整 fork、Python/R kernel 或新运行权威 |

[dsh-data-agent][data-agent] 的源码确有严格 report shape、dataset/view 引用检查和冻结 Tool Result 回放；但整体插件以通用数据库查询为中心，携带写工具。原样安装会引入我们当前不需要的权限与对象。这是“局部可用、整体不适合”的代表案例。

### 7.2 最小 GUI 应有的能力

遵循已接受的三个用户分析：库健康与发布风险、库性能与竞争力、设计影响与行动。一个分析页面包含 scope/版本/unknown、过滤、表图联动、证据 drawer；不把 Catalog、Rule Studio、Sandbox 再做成独立一级功能。

图点/表行引用准确的 Library revision、Cell、pin/arc、PVT、模型类型、rise/fall、when、slew/load 和来源。切换 load 不能暗中换 corner；同名 cell 不保证同一功能；missing 不变成零；域外插值/外推不能显示为普通实测值。选择只改变显示状态或准备问题；需要新分析/验证时，经现有 Host/Pack/Run 产生新的产物。

建议冻结报告的内容包含 `identity/scope/datasets/views/findings/unknowns/provenance/actionProposals`。大表使用有 hash 的 sidecar 与有界查询，不要求全库塞进单个 JSON。浏览器回放和按条件展开时保留数据身份；分页/过滤不能悄悄抹掉未解析对象或影响统计分母。

### 7.3 暂时不引入的“更大”组件

- **TanStack Table**：可能改善复杂排序/分组，但首版可先用原生表格和固定列；出现明确交互瓶颈再用。
- **DuckDB / Arrow**：可能缩短大表扫描和列式数据访问，但它们是可重建的派生查询层，不是 Library 事实源。先测代表性查询，再决定数据量是否值得其打包、内存和线程成本。
- **React Flow / ELK**：是运行图/关系图方向的候选，不是画 Library 曲线的前置依赖。ELK 可以以后只提供坐标布局；React Flow 若替换 FabricCanvas，需要重验 owner controls、节点定位、历史选择和恢复，当前没有足够收益证据。
- **完整 BI/Shell/fork**：额外的 SQL、terminal、Git、kernel 和页面生命周期可能比新图表节省的工作更多，当前不整体引入。

上述暂缓对象未全部做到版本、许可与代码层的采购资格评估；因此没有把它们列入可立即加入依赖的清单。

### 7.4 API 资格门保持明确

Empyrean Liberty API 的保留证据仍是 `lib.name()` 退出 139；本次没有复测或调试。可先在研究环境设计 typed report 与合成反例，但正式业务数据和发布仍须按 #49 完成 native read/query 等 qualification。再好的图表或代理都不能弥补数据入口不可靠。[当前资格边界](../../package-development/library-intelligence-platform/environment-qualification.md)

## 8. 面向人的 GUI：借交互细节，保留一个工作区

`DSH-better-sidebar` 具有文件、终端、Git、子 agent 等完整侧边工作区。它值得参考 session scope、lazy loading、可关闭 pane 和状态恢复，但整体引入将增加 node-pty、编辑器、WebSocket 和其他服务，并与已存在的 Hima Workbench 重叠；其 rc peer 与当前 alpha pin 也不是同一验证对象。因此只借无 shell 的局部交互或设计。[固定源码][better-sidebar]

下一阶段优先提高四种可见性：

1. **业务上下文可见**：当前看哪个 Run/Library/report，哪个已安装方法，哪些是草稿。
2. **控制可见**：谁暂停、影响范围、在途 Job 是否还在、谁能恢复。
3. **变化可见**：本代相对上一代和 best 的变化、未解决项、为什么继续。
4. **协作可见**：owner、specialist 的问题/进度/证据/采纳关系，而非展示更多聊天窗口。

这些信息应从现有 Host/RunView/ExecutionContext 投影。组件库减少画图、虚拟滚动、面板和筛选的代码量；产品团队仍负责业务摘要的含义、选择状态与对话的联动、错误后的下一步。

需要键盘可达、缩放后的文字可读、窄窗口状态保持和减弱动画。大图阶段分组/搜索、当前节点定位、固定 evidence drawer 可以先在现有 SVG/React 里实现；仅当测量证明布局或大规模渲染成为瓶颈，再替换相关纯模块。

## 9. 复用如何转成竞争力和开发效率

通用机制的复用，让团队将精力集中到更难被替代的四项工作：**合格 EDA adapter、可迁移业务 Pack、可信工程反馈、工程师可理解的交付与接续。** 客户自己的 Harness 可以使用这些能力，HimaGuide 也能成为完整入口；两种路径都使用相同方法身份和执行约束。

组件不能以“省下多少行代码”单独评分。总投入至少包括：接口适配、领域语义补全、资格测试、打包部署、升级维护、故障定位和替换成本。窄提取减少依赖，却增加代码维护；完整插件减少初始开发，却可能增加权限、升级和支持工作。每次选型都要明确这个交换。

建议建立以下测量，而不在本报告虚构效率倍数：

| 目标 | 复用前基线 | 复用后证明 |
| --- | --- | --- |
| Guide 更快完成首次价值 | 身份查找次数、人工补充次数、到首个正确 proposal 的时间 | 同 case 更少往返，当前身份/权限准确 |
| specialist 提高研究质量 | owner-only 的首次有效产物率和总成本 | 同输入/预算下减少错误；包括协调与审阅成本 |
| Pack 作者更快交付 | 第二作者从 SOP 到可安装小 Pack 的工时与支持次数 | 同复杂度更少定制代码，失败/恢复/升级也通过 |
| 洞察缩短工程判断 | 当前库版本审阅和 finding 定位过程 | 不降低关键问题召回，减少查证和无效调查 |
| 长任务可放心交接 | 外部催促、重复 Job、恢复时间 | 受控断连/compact/重启后仍接续同 Run，尊重暂停 |
| 依赖确实降本 | 无依赖/手工实现的对照切片 | 包体、启动、常驻内存、维护和版本升级成本可接受 |

不要让组件选型变成又一轮没有用户产出的平台建设。每个新依赖都应由一个具体 UI 或业务消费者拉动；客户看见的是少问一次、多解释一个异常、少浪费一次商业作业，以及更容易复现的结果。

## 10. 建议的验证与实施顺序

这些 POC 尚未执行，也不构成恢复暂停试验的指令。实际立项继续使用 GitHub Issues 和现有模块归属。

| 切片 | 复用组合 | 最便宜反证 | 通过后才扩大 |
| --- | --- | --- | --- |
| R0：控制和事实基线 | 当前 Fabric/Permit/Ledger/Reader | human pause 被 Agent continue 清除；rediscover 丢政策；setup/hold 建议与最终门矛盾 | 在现有模块修复后才开放团队和更多自动动作 |
| R1：Guide 有界上下文 | systemPrompt/context、Preparation、sessionQuery、已选对象 seam | UI 选 Run A、历史提 Run B；Guide 是否查 A 且不自动改变 owner；无需全盘搜索 | 新用户首次准备与原会话恢复 |
| R2：双 specialist | 当前 pin 的一次性 subagent 候选 + 工具过滤 + DSH 原始会话/owner 综合 | 先检查 profile 实际挂载、工具 schema 与入口；再测过期 input hash、直接 execute/SSH、重复回传，必须拒绝或仅归档 | 同输入 owner-only A/B 显示净改善后，加入 Coding/策略 |
| R3：作者反例包 | 已有五技能/checkPack/release + 可选 Promptfoo runner | 三目标遗漏、空报告当零、第二次 best retain、缺 test seal | 第二作者完成一次小 SOP → Pack → 安装 → 恢复 |
| R4：轻量诊断 | 原生 trace/token meter + 单个 dsh-fast/context-doctor 隔离适配 | 诊断读数与 provider usage 混淆；引入新上下文/网络/明显延迟 | 支持模式中默认可用；再决定是否用完整 context UI |
| R5：洞察报告和 renderer | data-agent 协议思想 + Zod + Workbench + ECharts | unknown、wrong unit/condition、超限、悬空引用、恶意 option；点击不能触发 Job | 经 #49 API 门后接入真实同族 Library delta triage |
| R6：业务通知与恢复 | Hima completion/control 事实 + 原生 owner/inbox + notification 呈现模式 | 重复/乱序、owner 忙碌、关闭页面、重启、人类 pause；不重复 Job | 一项小而真实的长期工作验证后再进入完整 Campaign |

R1/R3 与 R5 的合同设计可以并行；共享接线文件仍单一 owner。R0 是新增自动动作的前置，不阻碍只读上下文、合同和 UI 研究。R5 的静态/合成研究不证明 native API 可用。没有代码变动的研究阶段不启动 L5；正式开发先 L0/L1/L2，关键 UI 用 L3，真实模型/工具分别用小型 L4，只有业务闭环才使用 L5。

## 11. 依赖接入与退出的具体标准

**建议最先立项两个切片：R1 的准确上下文，以及 R0 控制条件满足后的 R2 对照试验。** R3 的反例整理可复用现有测试逐步补充，不另建平台；R4 由实际性能诊断需要触发；R5 按 Library API 与业务需求成熟度推进；R6 由当前接续/通知失败的复现拉动。这样可以尽快检验改善是否来自更好的输入，而不是默认增加所有组件。

每项进入 POC 的候选必须冻结源码或 registry integrity，核对根许可与需要保留的 NOTICE；识别实际安装脚本、运行依赖、host/client peer 与离线资源。根许可识别不等于完整传递依赖分发审查。社区上游测试结果只作线索，不写成本仓库通过。

隔离 POC 至少回答：它挂载了哪些工具/服务；卸载是否清理监听与计时器；失败后会留下什么状态；是否需要网络；读写哪些位置；输出能否稳定重放；升级是否要求更换 DSH 主版本或改动其他模块。不要默认全量采用一个插件的 storage、commands 和 UI 入口。

若一个纯展示需求必须引入第二 root/session 调度器，或一个只读分析组件要求 SQL write/终端权限，停止整体接入，改为窄提取或放弃。若插件 API 升级要求大范围改核心，先比较自行实现小接口的维护成本，不为一项局部特性升级整套 runtime。

## 补充需求：交互式 EDA Operator（2026-09-23）

用户补充 XTop manual ECO 场景，并明确本轮先写方案。这个具体需求使 DSH 原生 terminal/PTY 能力成为独立的复用方向：一次性 Bash、持久 shell 与交互 EDA 会话应分开核验。当前已有 owner-scoped terminal service/backend，但 profile 的 model-facing 入口和 Campaign 内受控输入尚不能据此视为完成。

建议增加 R7：普通终端复用原生 PTY；Campaign 交互能力扩展现有 Job/Channel/Fabric，而不整体引入社区 shell。保留同一 EDA 进程、逐次输入输出、at-most-once 派发/unknown、暂停和 checkpoint 验证。它与此前暂缓“完整 BI/Shell/fork”不冲突：新需求需要一个窄终端执行接口，没有要求替换 Workbench 或增加另一套业务控制器。

完整接口与测试场景见 [交互式 EDA 方案](../../specs/interactive-eda-v1/spec.zh-CN.md)。没有开启新测试或更改依赖；原研究的时间和验证范围保持。

## 补充决定：同级 Data Insight 与独立 Subagent 会话（2026-09-23）

用户明确了导航层级：Start 与工作区提供同级 Campaign / Data Insight 标签；Library 分析由 Agent 打开
Data Insight，Live Run 继续属于 Campaign。复用现有视觉和 dock，而不是在 Campaign 详情里塞一个
必须依赖 Run 的洞察子页。Subagent 作为真实独立工作会话，可查看任务、实际上下文、transcript、
工具轨迹、代码和产物；Coding 能力依角色权限开放，不能将只读试点固化为整个团队的能力上限。

这两项通过原生 UI/session/context 与薄的身份适配推进。产品决定与验收见
[工作模式与 Subagent 方案](../../specs/workbench-modes-and-subagents/spec.zh-CN.md)。当前只记录设计，
没有启动实现或测试。

## 12. 本次研究的完成边界

已完成组件发现、原生接口与源码/manifest 核查、主要候选许可识别、现有架构对照、分阶段 POC 和可证伪条件。没有安装候选项目或运行其 tests，没有量化节省的开发工时，没有将 upstream README 的“支持/通过”当成 Hima 实测。

原生 vendor API 的资格、客户真实效率、候选组件的包体/运行开销和全链路兼容性仍需后续小切片证明。本次停止继续搜集的原因是：新增同类组件大概率不会改变首批复用选择，关键缺口已转为接口消费验证和真实用户任务，而非缺少更多插件名字。

完整候选清单见 [component-shortlist.zh-CN.md](component-shortlist.zh-CN.md)，精确 pin 与证据范围见 [components.json](components.json)，研究问题/反例与范围见 [research-contract.md](research-contract.md)，核查与独立复核见 [verification.md](verification.md)。

## 一手来源

正文链接指向官方或作者固定源码；完整版本、许可、peer、核查范围和未验证项保存在组件清单中。社区目录只用于发现，没有用于证明兼容或安全。

[dsh-home]: https://deepseek.com/harness/en/
[dsh-source]: https://github.com/deepseek-ai/deepseek-harness/tree/00102833dfaee1da9f48a3a8eae9d34005a75218
[dsh-subagent]: https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/subagent/subagent
[schedule]: https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/schedule/schedule
[catalog]: https://github.com/SihanTeng/awesome-deepseek-harness-plugins/tree/376aa1681939edca4064f4c25734751235bf0f50
[automation]: https://github.com/titanwings/dsh-automation/blob/0d73a4e03639d4f63d0771ae4490e2718b7e7aa0/README.md
[notification]: https://github.com/omdsh-dev/dsh-notification/blob/675aab9b43d5011738feb6185281596c0365ccba/README.md
[context-plugin]: https://github.com/bowenliang123/dsh-context/blob/2ae7cfa7f8f1e4b0ff0b31c9abdfa12ac803a9f7/README.md
[context-doctor]: https://github.com/Zhenyu98/dsh-context-doctor/blob/41d5c2e4bbe0611b7928c4007bb28545f7ace38f/README.md
[fast]: https://github.com/PerryLink/dsh-fast/blob/f0c3e8cfef5149844536c8dad808a77c5bdb5ff4/README.md
[mnemon]: https://github.com/omdsh-dev/dsh-mnemon/blob/84d469ffa838a36fa579295d94029fcac8ac058e/README.md
[evolve]: https://github.com/ZK-Andy/dsh-continual-evolve/blob/981568450d9643bc481130294ce67543b4c54e15/README.md
[plugin-guide]: https://github.com/PerryLink/dsh-plugin-guide/blob/3ad707fb2c73658dd3e7c702b33bfaf469fb4f96/README.md
[promptfoo]: https://github.com/promptfoo/promptfoo/blob/d59f045c4cda1193574380aae639d84380dbf5f2/README.md
[data-agent]: https://github.com/omdsh-dev/dsh-data-agent/tree/6657771b8b9e66b3c06d6a6ce3056e601e7ff1fe
[better-sidebar]: https://github.com/omdsh-dev/DSH-better-sidebar/tree/1fcf43ccbedd6e66370b7fb81df2b4dd0ef2604e
[agent-teams]: https://github.com/NanmiCoder/dsh-agent-teams/tree/87c95c94d7847e4a242cb589916adc519981175f
[background-agents]: https://github.com/PerryLink/dsh-background-agents/tree/f2aea0460dcb1b3b03eaa13d1bdcba21650208a1
