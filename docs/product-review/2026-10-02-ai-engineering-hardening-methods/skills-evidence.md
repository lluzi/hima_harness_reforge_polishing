# AI 工程方法与 Skills：源码审计证据包

研究日期：2026-10-02 PDT / 2026-10-03 UTC。研究者：GPT-6 Astra / high，fresh context，按用户本次明确要求覆盖仓库默认研究模型；不修改 model-policy。只读研究，不执行候选 skill，不安装工具，不跑产品或 EDA，不写 Issue/commit。本文不是最终综合报告。

## 可直接用于主报告的判断

Hima 已有足够的流程骨架。优先把现有 `diagnosing-bugs`、`codebase-design`、接口测试和独立 review 用在一个真实故障或高变更模块上。外部方案最值得借的是可反驳的工作单元、行为规格的差量表达、证据身份、发现筛选和少量持久经验。没有证据支持“再叠一套端到端 agent 工作流即可工程化”。这一判断是当前仓库纪律与候选源码的适配推论，不是 Hima 对照实验结果。

| 方案 | 真实解决的缺口 | 适合既有业务的部分 | 主要代价/最强反对理由 | 本轮建议 |
| --- | --- | --- | --- | --- |
| 本机 Matt skills | 诊断反馈、深模块接口、任务与规格审阅 | 已运行的失败反馈；按变更热点找接口摩擦；独立预期值 | 同一错误规格可以同时骗过 TDD 与 Spec review；一些入口带强制询问/派工/文档写入 | 首选已有单项；明确边界后用，勿整条 idea→ship 重跑 |
| Superpowers | agent 遵守开发纪律与带上下文恢复的执行 | 明确文件/接口/反例；实现与复核分离；仅复核修复增量 | 默认广泛触发和设计审批；重试次数触发架构/模型升级，与本仓库规则冲突 | 借局部机制，暂不整包迁入 |
| GitHub Spec Kit | 跨会话规格→计划→任务的一致性 | 用户场景切片、依赖顺序、只读一致性分析；已有 bugfix/lean 路径 | 规格文档可能成为第二权威；测试任务默认可选；文档门不等于运行正确 | 仅当现有 Issue 规格确实不能承载时才试独立切片 |
| OpenSpec | 已有系统的行为变化记录和归档 | ADDED/MODIFIED/REMOVED/RENAMED delta；无行为变化可 skip_specs | 维护另一套能力规格；verify 是推断性审阅，archive 不是验收 | 借 delta 写法；暂不新增 `openspec/` 权威 |
| Compound Engineering | 经验证问题的检索复用、按风险组织评审、测量优化 | 只有非显然持久教训才存；不合格就不写；固定 brief 比较备选 | Full 默认多阶段/多 agent；CONCEPTS/配置/外部模型路由和 shipping 副作用广 | 借 learning 准入与测量规则；不整套引入 |
| 本机 refactor / clean-architecture | 重构手法和依赖方向词汇 | 小步保持行为；在已有 seam 上隔离真实变化 | 函数长度/层次分数会制造无业务收益的结构改动；refactor 每阶段要审批 | 当参考词典用，暂不作为默认执行总流程 |

## 1. 本机身份核实：不是名字相近就算同一个 Skill

实际读取了 11 个本机 `SKILL.md`，原文副本和 hash 在 `skills-raw/local/`、`skills-sources.json`。`ask-matt` 与 `improve-codebase-architecture` **都存在**，路径分别为 `/Users/lluzi/.agents/skills/ask-matt/SKILL.md`、`/Users/lluzi/.agents/skills/improve-codebase-architecture/SKILL.md`；本轮注入 catalog 没列出它们，不能因此声称文件不存在，也不能假定 harness 已暴露为可调用 Skill。两者 `disable-model-invocation: true`。前者是路由表，后者是候选调查流程。`codebase-design` 是共享词汇/设计参考；**没有证据表明前者已更名为后者**。[M01][M02][M03]

`~/.agents/.skill-lock.json` 记载这 9 个 Matt skills 来源为 `mattpocock/skills`，安装/更新于 2026-09-07，提供 folder hash 与路径，没有可靠安装 Git commit 字段；不能把 folder hash 当 commit SHA。上游真正路径多为 `skills/engineering/<name>/SKILL.md`，但 `grilling` 在 `skills/productivity/grilling/SKILL.md`。本机原始安装版本 SHA 未证实。

与固定上游 `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` 比对：`codebase-design`、`code-review`、`grilling`、`prototype` 的 SKILL.md 字节相同；`diagnosing-bugs`、`tdd` 只把 CONTEXT 引用改成 GLOSSARY；`domain-modeling`、architecture survey 同样转用 GLOSSARY；ask-matt 还增加 `implement-spec` 的任务图并行路线、PR/retro 等内容。diff 保存在 `skills-raw/diff-*.patch`。**不能用一键升级顺手迁移 Hima 的 CONTEXT 权威。** 这里的相同仅指所比较 SKILL.md，非所有附属文件。

另外两个本机 skill 在所查 lock 中没有记录。通过文本出处反查后，当前 `refactor/SKILL.md` 与 `luongnv89/claude-howto@556af8d.../03-skills/refactor/SKILL.md` 字节相同；`clean-architecture/SKILL.md` 与 `wondelai/skills@c172996.../clean-architecture/SKILL.md` 字节相同。可证明内容同源，不能反推出当初安装人、安装命令或安装 commit。[L01][L02]

## 2. 本机单项：触发、输入、产物和隐含动作

| 本机 Skill 与可点击原文 | 必需输入/触发 | 产物与动作 | 用法判定 |
| --- | --- | --- | --- |
| [ask-matt](/Users/lluzi/.agents/skills/ask-matt/SKILL.md) | 不知道走哪条 flow | 路由到 interview/prototype/spec/tickets/implement；自身不是风险扫描器 | 仅作地图；不要把完整 flow 当升级业务默认入口 |
| [improve-codebase-architecture](/Users/lluzi/.agents/skills/improve-codebase-architecture/SKILL.md) | 模块痛点或热点历史；CONTEXT/ADR | 默认探索 subagent；temp HTML（CDN Tailwind/Mermaid）；候选后询问；选中后 grilling，可内联改 glossary/提 ADR；设计备选可能 3+ agents | 稍改后用：限定一个热点+真实变更困难证据；止于候选，不默认改权威文档 [M02][M05] |
| [codebase-design](/Users/lluzi/.agents/skills/codebase-design/SKILL.md) | 一个现有模块及调用者/变化点 | 接口深度、删除测试、依赖分类；核心原文是参考；附属设计流程能派工 | 可直接作为词汇参考；不把“二个 adapter”机械当抽象必要性 [M03][M04][M05] |
| [diagnosing-bugs](/Users/lluzi/.agents/skills/diagnosing-bugs/SKILL.md) | 用户确切症状、可读源码/失败输入 | 已运行的 red-capable 命令→最小复现→3–5假设→单变量探针→修复+回归→原始场景复验 | 首选已安装项；生产独有故障先获取安全观测，不能为满足秒级 loop 伪造重现 [M06] |
| [tdd](/Users/lluzi/.agents/skills/tdd/SKILL.md) | 已约定的公共 seam 和业务期望 | 一条失败测试→最少实现→下一条；反 tautology；原文要求用户确认 seam；不在循环内重构而交 review | 新行为可用；brownfield 先 characterization，再分清保留/纠错的 oracle；已有认可 seam 不需重复审批 [M07] |
| [code-review](/Users/lluzi/.agents/skills/code-review/SKILL.md) | 固定点、规格、repo standards | 两个 fresh reviewers 分别检查 Standards/Spec；无 spec 则明确跳过；只产发现 | 稍改后用：补风险/反例 lens；注意三点 diff 排除未提交工作，与广义WIP描述不完全一致 [M08] |
| [grilling](/Users/lluzi/.agents/skills/grilling/SKILL.md) | 尚未决定的方案/产品意图 | 按 frontier 分轮问决策、派 agent 查事实；全部清楚并最终确认才行动 | 只在真实决策缺口用；普通修复不做无限设计访谈 [M09] |
| [domain-modeling](/Users/lluzi/.agents/skills/domain-modeling/SKILL.md) | 术语歧义、代码与领域概念冲突 | inline 更新 CONTEXT；仅难逆、令人疑惑、真实权衡才 ADR | 可用于真正术语纠正；读取术语不意味着授权改产品定义 [M10] |
| [prototype](/Users/lluzi/.agents/skills/prototype/SKILL.md) | 一个纸面难判断的问题 | 单HTML状态demo或UI变体；默认无持久化/测试；可提交独立prototype分支并在Issue留指针 | 只回答设计问题；不算恢复、并发或生产可靠性证据 [M11] |
| [refactor](/Users/lluzi/.codex/skills/refactor/SKILL.md) | 目标/范围/现有测试 | 6阶段、多次审批、smell报告、微改测试commit、复杂度比较 | 暂不原样执行；保留手法和小步行为保持，去掉以审批/行数当质量代理 [L01] |
| [clean-architecture](/Users/lluzi/.codex/skills/clean-architecture/SKILL.md) | 真实依赖/业务规则耦合问题 | Dependency Rule、端口/适配、7项诊断映射10分 | 只借方向；不追10/10，不按书的四圈重建已工作模块 [L02] |

两项需要特别防止误用：`DEEPENING.md` 原文建议有新深模块测试后删除旧浅测试；应先证明旧测试约束被保留，尤其副作用顺序、恢复和权限约束，不能只看新测试数量。[M04] `codebase-design` 的二 adapter启发式允许生产+测试构成两个，但 fake 不能因此证明真实替代性；仍需真实接口契约或有限真实通道证据。[M03][M04]

## 3. 五组开源工作流：固定源码的比较

### Matt Pocock skills

核心优势是把反事实诊断、深模块词汇和两轴 review 拆成可单独使用的积木。survey 已明确先按用户方向或 git 热点缩小范围，不是无条件全库清理；最强反对意见是“agent 阅读时感到摩擦”仍是主观信号，必须用真实消费者需要跨几个入口、一次业务变化触及何处、故障能否在正确 seam 复现来印证。[M02][M03][M04][M05][M06][M07][M08]

**本次范围的具体解释：** 用户已指定 Harness/Fabric，survey 原文明确“用户给方向则采用并跳过热点推断”，因此应锁定 Harness/Fabric，不能借最近提交优先把研究转向最新 Pack，也不能归咎于 skill 强制偏题。调用 survey 的初始阶段是读现状、派探索者、写 temp HTML 和展示候选；只有用户选中候选进入 grilling 后，才按已形成的领域决定内联更新 CONTEXT（上游是 GLOSSARY）。默认副作用必须按阶段区分。[M02]

广义 idea→ship flow 会写规格/票据、运行 TDD/review 并 commit；setup 会修改 agent 指令和 tracker/domain docs；不能因为只想分析架构就隐式调用实现或 setup。[M01][M12][M13] 本仓库已经有对应 docs/agents 与 Issue 权威，重新 setup 的收益很低，漂移风险更高。

### Superpowers

最新版已经区分 spike、bounded、architectural，bounded 无需写 spec/plan 文档；不能拿早期“所有事都重文档”的印象批评它。但是三个路径仍有显式审批硬门，architectural 要设计、书面spec、书面plan分别认可。using-superpowers 以 1% 相关性触发 skill，插件的 SessionStart hook 将这套路由带入会话。[S01][S02][S07]

计划模板的好处是给 fresh 实现者确切接口/测试，补一个面向真实用户、规格未覆盖的 Review Focus。SDD 最新内容也知道重复 review 的成本：每task一个实现者+一个review，最后全分支一次，只复核修复增量，禁止实现worker再派自己的review。[S03][S04] 但它仍以固定次数决定升级模型或架构讨论，并把部分未解决发现经controller裁决记账后继续。这些规则是作者选择，不是已证普遍最优；Hima 应保留自己的模型与升级条件。[S04][S05]

`verification-before-completion` 的“有证据才声称通过”可直接借用；“本条消息重跑完整命令”不应照搬昂贵真实EDA。正确条件是结果与当前源码/输入/配置身份一致、未失效，必要时再运行。维护者的 agent 行为测试可证已设计遵从性评估，不能推出生产缺陷率降低。[S06][S08]

### GitHub Spec Kit

现在包含可编排 YAML workflows，Full SDD 有 spec、plan 两个 review gates；也有 guided bugfix（assess→gate→fix→test）和 lean preset，所以它并非只能做绿地大项目。[K01][K05][K06] 核心能把用户故事组织成可独立验证的任务，适合缺少任务就绪标准的团队。

需要明确：`tasks.md`生成器写明，只有规格或用户要求时才生成测试任务。implement会按任务写代码、更新checkbox，还会创建/补ignore文件，并执行启用的 mandatory extension hooks。GitHub Issue 创建是单独 `taskstoissues` 命令，不能误报为所有流程默认发Issue。最新 specify 将 Git branch 创建交给可选git hook，不再能笼统说总是强制分支。[K02][K03][K04][K07]

最强反对理由不是“文档多”，而是若同一 agent 从模糊目标编规格、计划、测试和实现，一致性工具可能把共同误解固化。Hima已有一个包含保持项、反例、归属、回滚和模型的Issue规格，再建 `.specify/`/constitution/feature records 的必要性本轮未证。

### OpenSpec

其优势更贴近 brownfield：主spec描述持续行为，change文件只表示新增、修改、移除、改名。MODIFIED要求复制完整现有需求块，移除要求写理由和迁移；不改变行为的纯重构可以明确 `skip_specs: true`，design只在跨模块/迁移/安全等复杂条件成立时创建。当前模板还要求每task写验证方式，并让测试/文档跟随本组实施而非最后补。[O01]

执行语义要分开：propose会生成规划文件并停下，要求新用户请求才apply，即使原请求包含实施也不带过去；apply会修改代码/任务；verify明确“advisory”，通过关键词、路径和合理推断检查规格映射、测试是否存在；不要求实际跑测试。archive同步主spec并移动change；有warning并非永远禁止归档。[O02][O03][O04][O05]

因此适合借鉴delta表示法，不适合把 `verified`/`archived` 直接当成Hima业务成功或sign-off。它有防意外初始化的明确root guard，也明确prompt-level上下文规则不是可执行约束；这是好的边界意识，但不替代Runtime enforcement。[O03]

### Compound Engineering

选作第五组因为它覆盖“修好了以后下次别重查”和“测量后保留改善”，不同于只增加前置规格。`ce-compound` 的准入很克制：已解决且验证、最终代码/测试看不出来、丢掉会造成复发或大量重查，才写一个learning；否则什么都不写。现有learning过时优先更新。这个规则值得借到既有Hima证据和文档里。[C01]

但默认 Full 会做研究、历史、去重/grounding等多阶段，有docs/CONCEPTS写副作用；explicit lightweight能不派agent，却会减少语义核对，且仍可能更新已有CONCEPTS。`ce-code-review` 当前是按risk/depth选reviewers，报告默认不push；更深路线可能走外部peer模型并声明代码出机，之后还有merge/validator/report agents。把它称作“一个review prompt”是不准确的。[C01][C02][C03]

`ce-work`有return-to-caller模式，只实施验证而不shipping；standalone带后续交付。`ce-debug`区分恢复既定行为的convergent fix与改变有意契约的divergent fix，很适合防止修测试就改需求；但部分模式会自动commit/push或开PR，不能作为只读诊断入口盲用。[C04][C05]

`ce-bakeoff`把共同brief、约束、预算、不同候选和独立judge分开，且直说共识不等于证明、运行时断言需要实验。`ce-optimize`有baseline、固定spec、scope.mutable/immutable、keep/revert实验、成本/时间/平台期停止条件。可以借其不可变判据，但这不是“自动全面工程化”，只适合已定义可测目标。`ce-proof`名字像证明，实际是外部Markdown发布，不能靠名称挑skill。[C06][C07][C08]

## 4. 许可、维护与版本边界

以下全部读取 GitHub official repo 的 API、固定SHA tarball与LICENSE。均为 MIT；MIT只说明许可证，不说明安全、维护承诺或效果。查询 `/releases/latest` 得到的是发布标签，**审计对象是所列默认分支SHA，不保证等于release tag**。

| 组 | 固定审计 SHA | 最新提交UTC | latest release元数据 | 维护判断 |
| --- | --- | --- | --- | --- |
| mattpocock/skills | `d81f3a183412e71a5b1e84ca21bc1a35eea03a60` | 2026-09-29 | v1.2.3，2026-08-06；HEAD消息为merge release/v1.3 | 明显有近期活动，tag落后HEAD；应锁SHA |
| obra/superpowers | `8ca22dba9a94f28898bbce59f2537ff4d87c747d` | 2026-09-25 | v6.4.2，2026-09-25 | 近期活跃；流程较早版本已变化 |
| github/spec-kit | `e1fa857a7f536b22760d48c1aa9ace41df0fd1dc` | 2026-10-02 | v1.1.0，2026-10-02 | 同日仍变更，不能把旧评测语义直接套当前HEAD |
| Fission-AI/OpenSpec | `2500d6da971336167548b53731a35b2127df35ac` | 2026-10-02 | v1.14.0，2026-09-30 | 近期活跃；artifact/verify语义已有细分 |
| EveryInc/compound-engineering-plugin | `9af474a70e7f2a844338519ad9e92aafbd92d4fb` | 2026-10-02 | compound-engineering-v3.30.3，2026-10-01 | 近期活跃；入口会读大量references，不能只看README |
| wondelai/skills（本机参考） | `c172996495bed0fcd26896a9416b2093fd7073f0` | 2026-09-10 | 未查release | local SKILL与此SHA相同；声明version1.4.0 |
| luongnv89/claude-howto（本机参考） | `556af8d52327525d241f17574ef3f11976982fc8` | 2026-09-30 | 未查release | local SKILL与此SHA相同；内容自述v1.0.0不是repo版本 |

## 5. 可证机制、尚未证明的效果、采纳条件

**已核实：** 文件/源码确实规定这些行为；本机11项存在；若干本机与上游文本同/异；5组最近仍有维护，提供了不同强度的测试/模板/解析机制。**未核实：** 这些skills在Hima被调用后实际遵从率；故障发现净收益；回归率、change lead time、人工等待、token/工具成本；也没有本轮产品实测。没有以star、安装量、MIT、release频率或“有测试目录”替代效果证据。

这也不等于断言全世界没有任何相关实验。本轮候选源码审计未发现足以证明它们在类似Hima高副作用brownfield业务中、优于现有纪律的受控比较。Superpowers行为测试和作者“real sessions”经验属于更弱的维护者证据；主报告应结合独立实证线而非把它们升格。

建议未来（本轮未执行）先做一个有真实失败输入的最小试用：保留源代码/输入身份，建立由业务约束或人工worked example给出的expected，让agent交付最小复现与现有seam内变化，fresh reviewer只拿规格/原始证据/变更，不拿作者结论；比较首次发现的问题、错误发现、返工、总耗时和人工打断数。若只增文档/角色、没有增加可推翻断言，停止扩张。对现有行为做characterization可以防意外改变，但旧输出有错时不能把快照当正解；需要独立业务oracle。这是研究者建议，不是候选已验证效果。

最小采用顺序：①已有diagnosis + 真实反例；②只对这个痛点使用codebase-design；③保持项characterization与新行为接口测试分开；④固定变更范围的一次独立review；⑤仅在教训不在最终代码/测试里时留一条证据。既有Issue/CONTEXT/ADR/Runtime身份继续拥有事实和决策，不引入另一套控制面。

## 固定版本来源索引

机器可读明细（claim / URL / fixedSHA / date / location / line markers / limit）见 `skills-sources.json`。下列链接均落到所审计SHA。

[M01]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/ask-matt/SKILL.md

[M02]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/improve-codebase-architecture/SKILL.md

[M03]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/codebase-design/SKILL.md

[M04]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/codebase-design/DEEPENING.md

[M05]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/codebase-design/DESIGN-IT-TWICE.md

[M06]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/diagnosing-bugs/SKILL.md

[M07]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/tdd/SKILL.md

[M08]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/code-review/SKILL.md

[M09]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/productivity/grilling/SKILL.md

[M10]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/domain-modeling/SKILL.md

[M11]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/prototype/SKILL.md

[M12]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/setup-matt-pocock-skills/SKILL.md

[M13]: https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement/SKILL.md

[L01]: https://github.com/luongnv89/claude-howto/blob/556af8d52327525d241f17574ef3f11976982fc8/03-skills/refactor/SKILL.md

[L02]: https://github.com/wondelai/skills/blob/c172996495bed0fcd26896a9416b2093fd7073f0/clean-architecture/SKILL.md

[S01]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/using-superpowers/SKILL.md

[S02]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/brainstorming/SKILL.md

[S03]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/writing-plans/SKILL.md

[S04]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/subagent-driven-development/SKILL.md

[S05]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/systematic-debugging/SKILL.md

[S06]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/verification-before-completion/SKILL.md

[S07]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/hooks/hooks.json

[S08]: https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/tests/claude-code/README.md

[K01]: https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/workflows/speckit/workflow.yml

[K02]: https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/templates/commands/tasks.md

[K03]: https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/templates/commands/implement.md

[K04]: https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/templates/commands/taskstoissues.md

[K05]: https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/presets/lean/commands/speckit.implement.md

[K06]: https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/workflows/bugfix/workflow.yml

[K07]: https://github.com/github/spec-kit/blob/e1fa857a7f536b22760d48c1aa9ace41df0fd1dc/templates/commands/specify.md

[O01]: https://github.com/Fission-AI/OpenSpec/blob/2500d6da971336167548b53731a35b2127df35ac/schemas/spec-driven/schema.yaml

[O02]: https://github.com/Fission-AI/OpenSpec/blob/2500d6da971336167548b53731a35b2127df35ac/skills/openspec-propose/SKILL.md

[O03]: https://github.com/Fission-AI/OpenSpec/blob/2500d6da971336167548b53731a35b2127df35ac/skills/openspec-apply-change/SKILL.md

[O04]: https://github.com/Fission-AI/OpenSpec/blob/2500d6da971336167548b53731a35b2127df35ac/skills/openspec-verify-change/SKILL.md

[O05]: https://github.com/Fission-AI/OpenSpec/blob/2500d6da971336167548b53731a35b2127df35ac/skills/openspec-archive-change/SKILL.md

[C01]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-compound/SKILL.md

[C02]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-compound/references/lightweight.md

[C03]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-code-review/SKILL.md

[C04]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-work/SKILL.md

[C05]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-debug/SKILL.md

[C06]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-bakeoff/SKILL.md

[C07]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-optimize/SKILL.md

[C08]: https://github.com/EveryInc/compound-engineering-plugin/blob/9af474a70e7f2a844338519ad9e92aafbd92d4fb/skills/ce-proof/SKILL.md
