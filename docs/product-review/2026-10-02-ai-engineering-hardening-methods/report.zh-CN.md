# 从“AI 已经做得能运行”到可持续工程：Hima 的方法、Skills 与验证路径

研究日期：2026-10-02（PDT）；研究与综合：GPT-6 Astra / high。本轮固定产品源码快照 `77223fe`，研究起点 `future` 文档 HEAD `b645e23b`。本轮只读研究，没有安装或执行候选 skills，没有运行 Hima 产品或真实产品模型测试，没有运行 SSH 或 EDA。下述 Hima 应用均为提案，不是已验证改进。

交付前的版本核对：并行开发分支已推进到 `d0a6637`，包含 ATCS 结束与证据范围、比较测量和交付展示的修复。正文中的源码例子用于说明方法，仍引用固定快照；后续应用必须先在最新源码上确认具体缺口，不能把旧例直接列为最新未修故障。此次只读比较，没有合并或干预该分支。[提交差异](https://github.com/lluzi/hima_harness_reforge_polishing/compare/77223febe236df94d4db4eb006b6c9e612c62206...d0a66377c8812211dfef555461079e50f21df74b)

**本轮建议采用两个常用组合，并保留一条按需启用的路径：**日常升级用“行为刻画＋接口加深＋独立反例”；涉及持久化、外部副作用和恢复时，再加“状态模型＋故障序列”；只有反复变化的成本或现有适配器缺口被证实时，才用“历史热点诊断＋渐进替换”。AI 的优势是快速建立候选解释、搜寻遗漏、生成测试输入和完成有边界的改动；对业务真值、权限与完成状态的最终判断，应落在独立预期和实际执行事实中。

Hima 已有最小切片、真实 Host seam、分级测试、独立审查和恢复纪律。真正值得增加的是少数能够推翻错误实现的检查，以及让调用者少记协议的接口。把现有原则重写成更多规格、角色和审批，并不能增加这两项能力。

## 1. “可运行”的系统可能缺少什么

AI 写成并不等于必然难维护。一项 151 人的两阶段受控实验，让后续开发者在没有 AI 的情况下接手演进，未发现先前 AI 辅助造成系统性的可维护性优劣；但任务是较小 Java 系统、短期观察，实验发生在 2024 年末，并非当前 agentic 工作流。应按实际风险治理，而不按代码出身定罪。[原始实验](https://link.springer.com/article/10.1007/s10664-026-10889-1)

“技术债”太笼统，会把不同问题都导向重构。针对 AI 快速搭建后继续演进的系统，更有用的拆法如下。

| 风险 | 一次成功运行为何发现不了 | AI 应帮助回答的问题 |
|---|---|---|
| 业务含义仍是隐式约定 | 局部检查通过，可能被误写成整体目标达成 | 谁决定正确结果？哪条规则是必要 Goal，哪条只是输出有效性？ |
| 使用接口要重建内部协议 | 熟悉历史的 Agent 能按顺序操作，新调用者却漏步骤 | caller 必须记哪些顺序、身份和补偿动作？哪些应该由原模块承担？ |
| 时间与故障组合没有覆盖 | 正常路径看不出 receipt 丢失、重启或旧 owner 的影响 | 哪个 effect 已经发生？事实缺失时能否诚实 unknown？恢复会不会重复执行？ |
| 改动成本持续外溢 | 每次修复都通过，但同一业务变化总要触碰许多职责 | 哪些共同改动是必要依赖，哪些来自信息泄漏和重复规则？ |
| 验证与实现共享错误前提 | AI 写代码、测试、说明都使用同一个误解 | 有无不同来源的预期、独立观察、已知错误候选能打破这个闭环？ |

Hima 在该固定快照上的图评审已经给出具体例子：`sum-valid` 只说明数值结果有效；terminal Judge 的 PASS 与 Campaign Goal 不是天然等价；按“最新 Reading”寻找结果会让时间顺序参与业务含义；begin/work/complete 等操作细节仍可能要求 caller 协调。它们来自固定源码的静态分析，相关风险尚不能当成本轮复现的故障。已有恢复测试也表明项目认识到了“Job 成功不能证明 route 已提交”的区别。见[现有 Fabric 评审](../2026-10-02-fabric-business-graph/report.zh-CN.md)。

因此先做的诊断不是“把 Fabric 全库重构一次”，而是选一个真实业务承诺，写清它的输入、消费者、完成含义、外部效应和最小失败序列。若这一页仍需猜测，AI 继续写实现只会把猜测更牢固地编码进去。

## 2. 第一条路径：先辨明行为，再让接口承担更多责任

### 两种测试基线必须分开

Michael Feathers 的原始示例从一段行为不清楚的 `formatText` 开始：先运行输入观察实际输出，再把观察保留下来。他强调这种 characterization test 描述“现在发生什么”，不能证明“本来应该怎样”；他也遇到过修掉所谓 bug 后用户投诉，因为用户已经依赖它。[Feathers 原文](https://michaelfeathers.silvrback.com/characterization-testing)

这很适合 AI 接手既有系统：让它追踪当前接口、设计区分行为的输入、保留输出，通常比要求它仅靠读代码宣称“已理解”更可检查。但要在同一工作项里区分两栏：**兼容基线**记录旧消费者实际依赖什么；**正确性基线**记录业务或安全要求必须是什么。这里的 oracle 指判断测试结果对错的依据。已有独立测试够用时，直接复用。

例如 Hima 旧 Pack 通过 Explore 表达结束决定，这属于需要保持的兼容语义；新方法能否由明确声明的 Goal 自动结束，则需要独立契约。不能将现有返回值批量录成 golden snapshot，再宣布所有新行为都已验证。也不能因为某个测试能让终端 PASS，就把“最后一个 Judge PASS”升级成普遍完成规则。

AI 在这里应交付的是一个很小的行为表和测试增量：保留行为、明确改变、待判定异常各有哪些。测试输入要覆盖至少一个“看起来成功，但身份或业务含义不成立”的反例。若输出归一化会删掉 generation、input digest 或 execution identity，就应停止这种 snapshot 简化。

### 接口加深的收益是少记东西，不是少写几行

Ousterhout 与 Robert Martin 的作者对谈没有给出“函数越大越好”的结论。它展示了更实际的争议：一个小函数要连续读多个函数才能发现副作用，拆分是否真的降低理解负担？两位作者对最佳分解仍有分歧，这也说明不能把行数阈值当设计裁判。[作者对谈与 PrimeGenerator 例子](https://github.com/johnousterhout/aposd-vs-clean-code)

对 Hima 的应用判断应放在 consumer 上。拿“读取并判定这份既有成果”这个目标，列出 caller 当前必须知道的阶段和身份；再给出一个候选 interface，让原模块承担 admission、执行观察、结果验证与完成提交。调用者仍知道自己要读什么、业务允许什么，也能看到 pending、failed、unknown 等真实结果；它不必手工转抄内部协议。

一个好看的 wrapper 并不足够。如果 caller 仍需理解 ready 后要 complete、丢 receipt 后该怎样拼字段，复杂性只是搬了名字。相反，如果把所有差异压进任意 `attributes`，使用者又必须理解属性间的隐含组合，也没有加深接口。

最低的设计验收可以非常具体：让 fresh context 的实现者仅看接口契约，完成两个现有 consumer 的同类操作；记录它必须查阅的额外概念、机械调用和特殊分支。它必须保留 human hold、owner epoch、固定 effect 身份、Reader 绑定和 unknown，不得通过删除保证让调用变短。此测试检查的是接口是否承接责任；真实模型可靠性仍需后续小规模 L4，不能从代码示例推断。

## 3. 第二条路径：让时间、故障和错误结果成为可重复的反证

先把“可靠”改写为场景：**外部 effect 已发出、receipt 尚未保存时 Host 重启，系统应找到原 effect 或保留 unknown，绝不再启动一份；当足够事实已到达时，还应能完成收尾。**前一句是安全性，后一句是活性，两者不能互相代替。SEI 的 ATAM 把业务驱动、质量场景和架构取舍联系起来；这里借用这种具体化方式，不要求执行通常需要数天的完整评估。[SEI 原始方法说明](https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/)

| 触及的风险 | AI 的具体工作与输出 | 谁提供预期，如何验证 |
|---|---|---|
| 结果选择与业务判断 | 从明确契约提出一两个性质，生成输入并缩减失败例 | 人工可算例／独立业务规则；插入无关 Reading 后，同一 consumer 应仍消费明确绑定的成果；改变成果身份则应拒绝 |
| effect、hold、恢复顺序 | 为真实 Host 构造有界命令序列或明确 barrier，记录故障点和原身份 | 小状态表与独立 effect 计数；在 receipt 或 route 落账窗口终止并重启，检查没有重复启动／路由，没有越过 human hold |
| 测试看似充分却可能空转 | 对关键判断作少量 mutation，如移除 hold 校验、忽略 digest | 已明确禁止的行为应被现有断言拒绝；编译失败不算业务测试发现错误；幸存变异要判断是否等价或无关 |
| 多 actor 交错已超出手工推演 | 建单个协议的小模型，检查 safety 与有前提的 liveness，把反例转为实现测试 | 模型性质来自业务；模型与代码映射单独审查。有限模型通过不能证明 TypeScript 实现或真实 EDA 正确 |

属性测试尤其适合 AI：它能快速提出边界输入和通用关系，但**性质本身也可能是 bug**。Anthropic 的原始研究产出大量候选报告，并有 NumPy 等合并修复支持其可行性；同时，dateutil 的一个“日期应为星期日”性质被维护者指出混用了 Julian 与 Gregorian 历法。作者后续说明还承认一次示范修复不正确。这提醒 Hima：不能仅看节点名字像 Goal，就让模型自创“PASS 必须代表全局达成”的性质。[原始论文](https://arxiv.org/html/2510.09907v1)、[dateutil 维护者解释](https://github.com/dateutil/dateutil/issues/1437#issuecomment-3225141158)、[作者后续说明](https://www.anthropic.com/research/property-based-testing)

形式方法也有同样的边界。AWS 作者报告中的 DynamoDB 缺陷反例需要 35 个高层步骤，说明人工几次走读确实可能遗漏长交错；同一报告也记录某锁结构的活性问题没被发现，因为根本没有检查 liveness。借用方法应同时借用这个教训：永远停在 unknown 可以守住“不重复”，却不等于恢复完成。[AWS 一手案例](https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf)

Hima 不必先装新测试平台。先在现有 Node runner、真实 Host support 中写少量表格例与明确故障点；复杂输入组合确有价值时，再考虑 fast-check 的生成与缩减。它能嵌入现有 Node 测试，scheduler 主要控制 Promise resolution，不能替代磁盘崩溃或真实进程故障。Mutation 也先限于关键判断；Google 的工业实践采用筛选、限制范围的方式，支持的是可行动反例，不是全库追求分数。[fast-check 模型测试](https://fast-check.dev/docs/advanced/model-based-testing/)、[Google mutation 实践](https://research.google/pubs/practical-mutation-testing-at-scale-a-view-from-google/)

把经过验证的关键不变量留在已有回归中，就形成了有价值的 architecture fitness function：它持续拒绝一种真实错误。仅检查“有文档”“有日志”“覆盖率达标”则未必守住业务含义。Hima 已有 seam 检查和测试层次，新增项应证明它能拦住什么错误，而不是为每条原则加一道门。[fitness functions 原始实践](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development)

## 4. 现有 Skills 能直接用到哪一步

**可以直接从本机已有单项开始，不需要先安装新套件。** [diagnosing-bugs](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/diagnosing-bugs/SKILL.md) 适合已有确切失败输入时建立最小复现、排除假设；[codebase-design](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/codebase-design/SKILL.md) 可直接作为接口深度的设计参考；其中“删除测试”是一个思想实验：假想移除模块，观察复杂性是否回流到调用者，并非删除测试代码。[tdd](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/tdd/SKILL.md) 用于已经认可的公共 seam 和新增行为，brownfield 的保持项应先用现有或 characterization 测试保护；[code-review](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/code-review/SKILL.md) 可以分开检查 repo 规范和规格符合性，但要补上独立风险反例，并明确 diff 是否包含未提交改动。无需为了按流程走一遍而重新询问已认可的决定。

本节技能链接指向手机可读的固定上游参考；它们不代表本机版本已升级，本机 hash 与差异见技能台账。本轮实际审计了 11 个本机文件和五组开源方案的固定源码。比较对象是执行行为，而非 README 承诺或 stars。

| 方案 | 值得借用的具体机制 | 何时值得用；为何不直接全套采用 |
|---|---|---|
| **Matt Pocock skills** | 诊断、深模块和 Standards／Spec review 可分开选；接口测试有反 tautology 约束 | 当前首选已有单项。全程 idea→ship、setup 与 survey 后续阶段可能写规格／Issue／术语文档或派工，不能作为只读“扫描”盲用。[固定上游入口](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/ask-matt/SKILL.md) |
| **Superpowers** | 明确任务包、实现与审查分离、只复核修复增量；当前已有 bounded 轻路径 | 借局部机制。仍有设计审批硬门和按尝试次数升级的规则，需让位于 Hima 的授权、模型和根因纪律。[bounded 设计流程](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/brainstorming/SKILL.md) |
| **GitHub Spec Kit** | 用户故事切片、依赖任务和跨会话一致性；有 bugfix／lean 路线 | 仅在现有 Issue 规格承载不足时试。测试任务默认不是必需项，规格齐全不能当运行正确；另建 constitution 可能重复权威。[任务生成原文](https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/templates/commands/tasks.md) |
| **OpenSpec** | 用 ADDED／MODIFIED／REMOVED 表达行为差量；纯重构可不写行为规格 | 借差量写法。verify 是 advisory 的代码／测试映射检查，不强制跑测试；归档不等于验收。暂不另建 `openspec/` 事实中心。[verify 原文](https://github.com/Fission-AI/OpenSpec/blob/2500d6da971336167548b53731a35b2127df35ac/skills/openspec-verify-change/SKILL.md) |
| **Compound Engineering** | 只沉淀已验证、非显然、丢失会导致重查的教训；固定评价标准后比较方案 | 借 learning 准入与测量。默认 Full 可带来多阶段、文档写入与更多 Agent；部分执行入口有 shipping 或外部模型路由，需逐项限定。[learning 准入原文](https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-compound/SKILL.md) |
| **本机 refactor／clean-architecture** | 小步保持行为、依赖方向和重构手法 | 当参考词典。refactor 原文有分阶段审批；层次评分或函数长度容易替代真实收益，不能据此重建已有模块。[refactor](https://github.com/luongnv89/claude-howto/blob/556af8d52327525d241f17574ef3f11976982fc8/03-skills/refactor/SKILL.md)、[clean-architecture](https://github.com/wondelai/skills/blob/c172996495bed0fcd26896a9416b2093fd7073f0/clean-architecture/SKILL.md) |

有两个容易遗漏的采用成本。第一，**本机与上游不是同一版本**：本机 Matt 记录为 9 月 7 日安装／更新，上游已把多处 CONTEXT 改成 GLOSSARY；自动升级可能与 Hima 的 single-context 权威相冲突。`ask-matt`、`improve-codebase-architecture` 文件确实存在，但本轮 catalog 未列，并非已改名为 `codebase-design`。它们是不同入口，不能按名称猜行为。本次已明确 Harness／Fabric 范围，应按该范围调查，不能又被最近 Pack 提交热点带走；survey 也不等于一调用就改领域文档。

第二，**可复用经验不等于多写文档**。一个反例已清楚保留在测试里，通常不需要再写一篇同义总结；只有最终代码看不出的选择理由、环境限制或难发现事实才值得沉淀。反过来，重构后不能因为新测试“更深”就自动删除旧测试，必须核实权限、恢复和副作用顺序断言仍然存在。

五组主方案的 LICENSE 均核对为 MIT，近期均有维护活动；这些事实不证明有效或适合 Hima。本轮记录了完整 SHA、检索日期、本机 hash 与默认动作，且区分 release 元数据和真正审计的 HEAD。**可直接采用的是已有单项的工作机制；需要适配的是触发范围、写入／交付动作和现有权威；尚未证明的是在 Hima 上的净收益。**详细身份与副作用见[技能证据包](skills-evidence.md)。

## 5. 实证告诉我们什么，又没有告诉我们什么

精心选择的 skills 确实可能带来收益。SkillsBench **v4** 在 87 个任务、18 个模型与 harness 配置上报告：加入人工策划 skills 后，任务宏平均通过率由 **33.9% 提升到 50.5%**；同时有 13 个任务负增益。过重工作流、覆盖更适合的默认策略、难调试的工具选择都可能拖后腿。它评估的是特定任务完成，不是 Hima 长期维护，也不是本轮 Astra。更值得借用的是同任务、同环境、有／无 skill 的比较方法，而不是平均增益承诺。[固定版本论文 §4–6](https://arxiv.org/html/2602.12670v4)

关于 `AGENTS.md` 的研究看似冲突，实际测量不同。一项最新论文发现仓库说明并不普遍提高问题解决率，还增加推理成本；另一项配对研究发现时间与输出 token 下降，却明确没有评估正确性、可维护性或意图对齐。更快给出 final output，不能证明产品结果更好。因此，Hima 应保留确有作用的非标准约定、执行入口和权限边界；不要借研究批量删说明，也不要以说明更长替代接口改善。[正确性研究 v3](https://arxiv.org/html/2602.11988v3)、[效率研究 v2 §5](https://arxiv.org/html/2601.20404v2)

OpenAI 的 harness engineering 文章提供了有价值的一手实践：让 Agent 看见真实运行环境，把少量约束变为机械检查，以持续小修阻止坏模式扩散。但这是从空仓库开始的内部团队经验，作者也承认长期架构一致性仍未知；不能照搬为 brownfield 的因果证据，更不能据此复制其层次架构或自动合并方式。Hima 已有类似基础，值得学的是让失败信息帮助定位和修复，而非再造一套 harness。[原始工程文章](https://openai.com/index/harness-engineering/)

生产率也必须把生成、审阅、返工和运行稳定性分开。DORA 的作者分析讨论了 AI 把部分工作转移到审计验证的现象，证据包含关联与工程师自述。METR 的 2026 更新则说明模型进步后的测量受到任务选择、参与者偏好和并发归因影响，不能用早期“变慢”数字给当前模型定性。对本项目最诚实的承诺是测端到端负担和正确性，而不是先宣布提速。[DORA 分析](https://dora.dev/insights/balancing-ai-tensions/)、[METR 更新](https://metr.org/blog/2026-02-24-uplift-update/)

关于自审，现有论文足以提醒我们关注外部反馈和作者锚定，却不足以给 Astra 一个失败率。Self-Correction Bench 最新版本研究的是 14 个开源非推理模型；这与当前模型、任务都不同。**fresh context reviewer 可以减少对作者叙述的依赖，但换一个 Agent、甚至换模型，也不自动产生统计独立性。**真正有用的差异，是审查者从另一来源的业务要求、实际产物或可执行反例出发。[研究范围](https://arxiv.org/abs/2507.02778v3)

## 6. 第三条路径只在必要时启用：找准改动负担，再渐进替换

如果已经有具体失败的不变量，就从它开始修，不需要先做全库“健康评分”。只有不知道优先改哪里时，历史热点才有价值：把频繁变化、理解困难、缺陷返工和接下来的业务需要放在一起，缩小调查范围。

Tornhill 的 change coupling 从 Git 中观察经常一起变化的文件，并明确指出共变本身没有好坏：业务代码与测试一起改通常合理。它适合发现静态 import 图没有表达的关系，但不能仅凭一团连接线判断职责错误。[作者原文](https://codescene.com/blog/change-coupling-visualize-the-cost-of-change) 对 AI 密集开发的短历史尤其要排除整批导入、生成文件、统一格式和一次性迁移，否则提交习惯会被误当架构事实。

若若干真实 consumer 确实证明原实现无法承接必要行为，才考虑渐进替换。Fowler 的 branch by abstraction 是让消费者逐步通过同一 seam 切换 supplier，并保持系统可发布；旧 supplier 不再需要时删除，迁移抽象也可能删除。[Fowler 原文](https://martinfowler.com/bliki/BranchByAbstraction.html) 这里的重点是可比较、可切回、可退出。对于 Hima，优先使用现有执行 adapter seam；旧 Run 继续按其固定方法解释，不能用新语义回读旧事实。

有副作用的执行器不能把两套实现都真正启动来做影子比较。应比较无副作用的计划、记录回放或隔离测试结果；真正 effect 只能由唯一被授权路径产生。若状态已经不可逆迁移，“切回旧代码”也不等于恢复。过渡适配层要有退休条件，不能永久留下两份完成权威。Fowler 网站的过渡架构案例也把删除临时组件作为方法的一部分。[Transitional Architecture](https://martinfowler.com/articles/patterns-legacy-displacement/transitional-architecture.html)

## 7. Hima 最值得做的组合，以及如何判断它有用

本项目并非没有工程纪律。[polishing-discipline](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/docs/agents/polishing-discipline.md) 已要求先证后改、真实消费者、最小增量和反证；[fast-convergence-testing](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/docs/agents/fast-convergence-testing.md) 已反对不能阻止假证据、错身份或重复 effect 的手续。已有 `check:seams`、`check:boundary` 和 L0–L5，但静态 marker 或命名检查不能证明业务完成、唯一 owner 或恢复正确。下面是按风险选择的路径，不是每个 PR 都要全跑的清单。

| 路径 | 适用时机与必要输入 | 最小产物与成本转移 | 继续／停止信号 |
|---|---|---|---|
| **A．默认升级：刻画＋深接口＋独立反例** | 某接口难用、变化不局部；有真实 consumer、当前行为和独立期望 | 原工作项中的短行为表、前后接口用例、相关回归；工作从解释历史转到澄清语义和审阅反例 | caller 少查内部概念、后续同类改动更局部且旧行为保持才扩展；仅换名、包一层或增加配置则停止 |
| **B．高风险 seam：状态与故障验证** | 涉及持久化、并发、外部 effect、权限或恢复；已有可观察的原 effect 与状态边界 | 小状态表、少量序列／崩溃夹具，必要时 mutation 或模型检查；增加建模及故障定位成本 | 能稳定暴露错误候选、恢复事实清楚才扩展；oracle 复制实现、mock 越过风险点或序列不可复现则重做 |
| **C．条件迁移：热点诊断＋渐进替换** | 反复返工或现有实现确实阻碍多个 consumer；有语义化历史、现有 seam 和退休条件 | 少数候选、一个可比较切片、兼容与回退说明；承担过渡层与状态迁移成本 | 实际变化负担下降且旧层逐步退休才继续；只降低静态分数、双权威持续或无法安全切换则暂缓 |

第一轮应用可以选两条已有业务路径：数值 `analyze → read-analysis → judge`，以及工程委派产生完整成果、再由 Reader／Goal 判定。前者便宜而容易设独立预期；后者暴露异步和成果身份。它们用于检验同一个方法能否跨业务成立，不是本轮批准的代码切片，也不需要先跑完整 ATCS 或真实 EDA。

实际顺序应保持轻量。下面是责任分工，不要求每个 PR 增加三个 Agent 或岗位：同一实现者可以连续诊断、设计和实施；按风险沿用一次 fresh 独立审查。

1. **诊断者**读取这两条路径的现有声明、入口、测试与失败证据，分开陈述事实、推论、未知。把一个最重要的业务承诺写清，复用现有工作项。
2. **独立验证者**从该承诺给出最小错误例。例如局部 PASS 不代表整体达成；加入无关 Reading 不改变被消费成果；结果已产生但 receipt 丢失不能重发 effect。预期不能由待改实现倒推。
3. **设计／实现者**给出现有方案与一个更深接口方案，说明 caller 哪些知识消失、原模块仍守住哪些保证。先用最低 L1/L2 验证；接口改变后再决定必要的小 L4。
4. **同一切片完成后**记录实际反例、审阅与返工负担、仍需人工解释的场景。没有新增代码前不要将“减少多少调用”写成成果。若首次反例失败，重建根因，不按固定尝试次数升级模型或架构。

OpenCode 协作应沿用已有 Resident 完整任务委派：它可以在一个工程节点内理解、修改、运行工具和组织内部协作；Hima 从已有 seam 接收真实交付，继续负责 admission、控制、effect 身份以及 Reader／Goal 判断。当前已有 `start/message/status/cancel/delivery/release` 和 receipt、delivery 身份核验；本轮只做静态核对。方法上的增量是给两侧一个更清楚的输入／输出契约和故障反例，不能再让 Hima 编排 OpenCode 每次工具调用，也不能把 OpenCode 的自然语言完成当作验收。见[现有适配实现](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/packages/harness/src/engineering-executor.ts#L202)。

衡量时，至少同时看四件事：业务结果及关键不变量是否成立；审查发现与后续逃逸错误；从接手到通过验证的总负担；caller／维护者必须了解的内部概念。一次变更有价值，不一定立刻更快，可能先增加测试和审查成本。应在后续同类变化中判断这些成本是否换来更少返工与更稳定恢复。已有确定风险时，不应为了做实验而随机移除必要保护；可用安全历史任务或相同输入的隔离版本比较。公开 benchmark 不能替 Hima 设收益门槛。

我的优先判断是 **先采用 A，把 B 按触及的风险加入；C 保留为证据触发的升级路径**。若两个真实 consumer 连同必要不变量都无法在当前职责表达，才重新讨论架构；这给渐进改进留下退出条件，也避免把保持原架构变成信条。

## 附录：证据与方法使用边界

方法、skill、测试工具和 Agent 分工是四层不同东西：方法说明要解决什么问题；skill 组织工作；工具产生可执行反馈；分工减少上下文偏差。不能把四者的数量相加当作成熟度。

本报告把方法建议、作者案例、受控研究和当前 Hima 静态事实分开。没有本轮 Hima 有效性结果，也没有全面测试覆盖审计。保留的主要未知是：独立预期能否足够精确、哪些已有测试已经覆盖建议反例、选定 skills 的本地净收益、真实模型面对更深接口是否更稳定。每项都可由上述小切片验证，不需要再开启泛框架选型。

可审计材料随报告保留：[方法工作流与停止条件](method-evidence.md)、[技能身份／许可／副作用](skills-evidence.md)、[验证方法与原始案例](verification-evidence.md)、[实证版本与限制](empirical-evidence.md)、[当前仓库差距映射](repo-gap-map.md)、[论点卡](argument-cards.md)、[证据差距矩阵](gap-matrix.md)。来源与检索记录分别保存为各 lane 的 JSON／Markdown；完整方法台账没有再搬进正文。研究在正反机制与版本矛盾已足以改变选择后停止，未把检索中未发现视作不存在。
