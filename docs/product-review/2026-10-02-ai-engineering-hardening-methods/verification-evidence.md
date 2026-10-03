# 验证与独立审查证据包

研究者：GPT-6 Astra / high，fresh context；2026-10-02 PDT（检索为 2026-10-03 UTC）。本文件是给 lead synthesizer 的证据包，不是产品决定或实施报告。产品依据为 `77223febe236df94d4db4eb006b6c9e612c62206`；研究分支快照 `b645e23b5fa4ceb0d93f731396cc6e767dbb9382`。本轮只读文档、检索原始来源、下载来源与写入 ignored 研究目录；未安装依赖、未运行 Hima/EDA/模型/候选测试、未改产品、未提交。

## 1. 可带入主报告的判断

**最小可靠组合是：一个真实 consumer 的独立验收例 + 该改动触及的不变量/变形关系 + 必要的持久化或副作用断点反例。** 不是把 property、mutation、TLA+、多 Agent 和全量端到端测试全部加入每个 PR。现有 polishing/testing-strategy 已有最低层级、真实接口、独立预期与失败留存；缺口应按具体未覆盖风险判断。

最重要的独立性是“答案从哪里来”。另一个 Agent 若同看实现、同用最新状态作为预期，再投票赞成，仍可能同错。业务声明、原始工具输出、受控副作用计数、人工可算例子、不同表达的有限模型提供不同检查依据。fresh context 有助于避免沿用实现者叙述，但不自动使错误统计独立。历史 N-version 实验对独立开发程序的共因失败提供反例；它不是现代 LLM 多 Agent 的定量实验，不能据此说多 Agent 无用。[V16]

所有方法都把错误发现工作向前移，也增加设计性质、维护夹具、解释反例的成本。本轮无 Hima 效果实测；不声称节省多少时间或提升多少可靠性。

## 2. 方法卡：操作、oracle 和采用边界

| 方法 | 输入与操作 | 独立预期；能证明什么 | 不能证明什么 | 最低必要层级；采用/停止条件 |
|---|---|---|---|---|
| Characterization / golden master | 冻结当前 SHA、实际 consumer 输入、已审阅输出；通过现有入口记录少量稳定的业务结果；在相同输入下比较改动前后。只归一化明确无语义的时间戳等字段。 | 原行为是“兼容性参照”，不是正确性权威；另列领域验收例和允许变化。可发现未授权行为变化。 | 原实现和快照同错；未覆盖输入；模型推断的旧行为；仅最终 JSON 相同不证明副作用次数相同。 | 纯逻辑 L1，持久化/Job L2。适合内部重构；业务语义修复时先写独立失败例，预先列明应改变项。停止自动全量批准快照、停止把 known bug 固定为契约。原始金融系统替换案例说明固定规格及执行 adapter 可复用，不能推广为要求所有旧功能原样保留。[V01–02] |
| Property-based / metamorphic | 从 contract、用户规则与真实 consumer 提取性质；为输入域生成有效/无效/边界数据，保留 seed、最小失败例；变形测试对等价输入或事件排列比较关系。 | 性质由业务规则或数学关系推出。例如同一明确成果的消费不受无关 Reading 插入影响；重试同一 identity 不增加 effect。可发现例子未枚举的组合。 | 性质本身可能错或太弱；如 encode/decode 同错仍 round-trip，通过不代表格式兼容。任意规则重排不一定等价，若顺序有业务含义不能硬造“不变性”。 | L1 开始，成果绑定/身份需 L2。只有性质可陈述、输入生成不会全被 filter 丢弃、反例可解释才采用；无可支持性质就停止，不让 AI 创造产品规则。[V03–05] |
| Model-based sequence + controlled schedule | 用 admission、start、observe、hold、complete、restart 等真实命令生成有界序列；小模型只保存 owner/hold、effect 数、验证成果绑定、route 状态。允许生成应被拒绝的动作并断言拒绝，而非全部在 precondition 跳过。 | 不复制 Fabric phase；从独立安全性质核对每步状态、路由和 effect 数。可缩减为最小竞态/恢复序列。 | 模型遗漏、错误 fairness、未被控制的 I/O；把 await 顺序打乱不等于已注入磁盘崩溃。fast-check scheduler 主要延迟 Promise resolution，实际调用可能早已开始。 | 顺序纯模型 L1；真实 Host、文件、进程 L2。若仅有一两个已知竞态，先写显式 barrier 测试；组合爆炸和反复漏例再引入命令生成。不能为测试克隆通用 Runtime。[V03–04] |
| Targeted mutation | 对已声明高风险分支做少量有意义变异：移除 hold 检查、放宽 identity、把 local PASS 直接判 Goal、忽略 result digest；先确认基线有真实断言，再检查哪条测试杀死变异。 | 人工选择的非法行为是独立故障模型；能检验测试对这些错误是否敏感。 | 杀死 mutants 不等于所有真实 bug；等价/不可达变异可能无用；编译错误不是业务断言发现错误；变异算子覆盖不了缺失的领域行为。 | L1 为主，必要窄 L2；用在关键语义重构、测试表面覆盖充分却怀疑空断言时。停止全库追分；survivor 必须分类为有效缺口/等价/越界/基础设施问题，不为 100% 改产品。[V06–08] |
| Crash / fault injection / replay | 在持久化边界前后切断：intent 写前后、effect 发出后 receipt 前、result 验证后 route 落账间；真实本地 Host/进程/临时持久存储，受控本地副作用；保留原 identity 后重启/重放观察。 | 对原 Job、原 launch intent、原结果 hash、消费结果、effect count 直接验账；可以推翻“成功响应=完成”“重启=可重发”。 | 本地 stand-in 不能证明 SSH/商业 EDA 行为；历史回放不覆盖没发生过的新 interleaving；假进程不能证明外部 Job 存活。 | L2 主力；涉及真实远端恢复/工具 seam 才升级 L4 Site；UI控制入口才加 L3。先人工列有限高风险窗口；若故障点无法定位，先改善 seam 可观测性。FoundationDB 的确定性集群模拟是系统级长期投入案例，不能把其收益外推为 Hima 应重建模拟平台。[V09–12] |
| 轻量状态模型 / TLA+ / PlusCal | 将单一窄协议（hold/result/route/recovery）写成状态、动作、不变量；仅声明必要进程/消息/故障，枚举小边界；分别检查 safety 与 liveness，明确公平性与最终可通信假设。 | 不变量来自产品含义、不是源码翻译。可揭示设计层遗漏与长事件序列；反例转成真实实现 L2 回归。 | TLC 对给定有限实例的检查不是 TS 实现证明；未检查的 liveness 不受保证；模型通过不证明 EDA、性能、操作正确或所有尺度。 | 设计分析本身不冒充 L0–L5 PASS；实现仍需 L1/L2。适合多 actor/崩溃/重入使手工状态表不够的危险协议。先用一页状态表/穷举小模型；若两名审阅者不能解释映射、维护无 owner、范围膨胀、结论不影响设计则停止。[V13] |
| 独立验收与规格↔代码双向审查 | 实现者完成稳定切片；独立审阅者先看用户目标/contract/反例，不看实现者自评；从规格逐条找代码/测试，再从每个新增分支/字段/副作用反向找授权的规格。关键发现附可复现反例或精确路径。 | 业务 oracle 与变更范围独立于实现故事；可发现遗漏要求、擅自扩展、失效测试与同源假设。模型 review 提供候选发现，独立证据裁决。 | 角色/模型品牌多样性不保证独立；多数票不是业务真理；静态审查未执行则不叫复现。 | L0/静态分析起点，争议用最低 L1/L2；真实模型/工具能力按 L4/L5。一次切片稳定后集中审查，后续只查相关增量；不默认每个小改动派多 Agent。主报告应标这是基于来源与现有纪律的工程建议，非已实证最优流程。[V14,V16] |

## 3. 六类 Hima 反例必须具体到可观察事实

以下全是候选测试设计，除引用当前报告明确记载的源码事实外，本轮未运行、未复现。当前报告 §3/6/7 是定位依据，不是新测试结果。保持现有 `executionAction`、`completeAdmittedNode`、Reader、Jobs、Ledger 的职责。

### A. local PASS 不是 Goal

输入：数值 Workshop 的 `sum-valid` PASS；同时全局 Goal 未满足或未声明。对照：明确声明 final Goal、所有必需结果按身份验证齐备。独立预期：前者只证明局部结果有效，禁止因最后 Judge PASS 自动写 ended-goal-met；后者按声明结算。再测试 missing/UNDETERMINED/stale/wrong-scope 证据，不能被任何成功文案覆盖。L1 判定表 + L2 当前 consumer。ATCS 终端 Judge 的事实与当前 endRun 依赖 Explore 的冲突应先定义契约；不能为了通过测试私自让节点名字变成 Goal 授权。

### B. 无关 Reading 与无关事件次序不得改变所消费成果

固定 consumer C 指定的 producer execution E、generation、branch/loop、输入摘要和有效结果 R。插入另外 branch 的 newer Reading R2，交换无依赖事件落账顺序；C 的结果引用/判定应不变。修改 R 的字节、generation 或 identity 必须失效。**只有确定无业务先后关系的事件可交换**；当前第一条 rule 路由若是既有显式/隐式契约，重排不是天然合法，须先明确将消费/角色从位置独立出来的期望。L1 变形关系 + L2 行为结果；不凭“最新”生成 oracle。

### C. effect 已完成，receipt 丢失不得再发

本地受控 effect 先将 E/jobId 与一次实际动作写到测试所拥有的外部可验账对象，随后在 Host receipt 持久化前终止 Host，重启后用原 request/execution identity 查询/继续。预期 effect count 仍为 1；按原 Job/intent 找到结果或保持 unknown，禁止仅因无 receipt 新 launch。假回调“我成功了”不够，必须读取独立 side-effect 记录。现场 L4 则核对原 Job/session/launch identity、远端存活和真实产物；不知道原 Job 身份时不能换一个 Job 把结果做绿。[V09]

### D. result 验证完，route 提交中断可按原身份补齐

冻结 original execution/result digest/Reader version 与确定 route。分别在决定记录前后、位置移动前后、completed 标记前后中断；重启后 reconciliation 重复运行。预期不重做 effect、不复制逻辑决定或下游 admission，不改 input/method/result identity；可完整核对时同一 route 最终一次成立，事实不足或冲突仍 unknown。安全性（绝不重复）与活性（确实可收尾）分开断言，不能把永远 unknown 当恢复成功。当前报告说此处保守 unknown，补齐行为属于提案，非现有能力声明。

### E. human hold 与 late completion 竞态

用 barrier 固定两种线性化顺序：hold 已被 Host durable 接受后 completion 到达；completion 已提交后 hold 到达。已在跑的 Job 可产生真实 result，结果接收与新下游推进分别断言。预期 late completion 不清除 human hold，也不得凭旧 owner/epoch 获得新 admission；在 hold 生效前已合法提交的动作按明确政策记录，不能事后伪装已取消。保留结果不等于越过 hold 继续。不要把 sleep(若干毫秒) 当竞态控制。L2 持久化 + 窄 L3 用户可见状态（仅入口有变更时）。

### F. 旧 Run 遇新代码

保存有明确原 SHA/build、Pack/Reader/input digest 的真实本地 Run 三个检查点：pending effect、verified-unrouted、已结束。用候选代码只读恢复/兼容回放；预期历史事实不被新解释改写，不因字段/分支顺序变化重发 effect。需要预先选择并写清现有 seam 内的兼容规则：继续原语义、经过有验证迁移，或诚实拒绝并保留旧执行环境；不默认自动升级。Temporal 的 history replay 与 pinned/auto-upgrade 给出了原始机制例子，不是要求 Hima 安装 Temporal。[V10–11]

六类反例共同保存：source/build/Pack/Reader 身份、输入与结果 hash、初始持久记录、fault/barrier 点、实际原 Job/effect identity、每步可观察状态、独立预期、最小失败序列、通过/失败/跳过/未跑及范围。可复用现有证据记录，不必增加新审批系统。

## 4. AI 属性测试的真实支持与反证

[Agentic Property-Based Testing v1](https://arxiv.org/html/2510.09907v1) 以 Claude Opus 4.1 / Hypothesis 扫描 100 个 Python 包、933 个模块，产生 984 条候选报告。论文 §3–4 明确：人工抽样 50 条来自初始评分前 80%，并非从全部候选无条件抽样；共识后 56% 有效、32% 值得报告。最终满分的 21 条里 18 条有效、17 条值得报告。不能把这些比例当 Hima/TypeScript 的命中率，更不能称 984 个 confirmed bugs。论文未对照“同预算资深工程师”来证明净节省；token/API 成本不包含领域验收负担。[V05]

2026-01-14 的[作者后续说明](https://www.anthropic.com/research/property-based-testing) 另含 Sonnet 4.5、10 包、多次运行的第二阶段与三名专家筛选；这和 v1 第一阶段必须分开。它特别承认 NumPy 示范 transcript 的修复不正确，真正补丁另行定位了数值不稳定。博客中的人工复核成本描述不能移植为每条 Hima 测试的固定成本。[V17]

外部确认比作者自评更强：本次 GitHub API 直接核对 [NumPy #29609](https://github.com/numpy/numpy/pull/29609) 已合并（2025-10-10），[Powertools #7246](https://github.com/aws-powertools/powertools-lambda-python/pull/7246) 已合并（2025-08-28）。反方向，[dateutil #1437 维护者说明](https://github.com/dateutil/dateutil/issues/1437#issuecomment-3225141158)：输出的名义日期属于 Julian 历法，而 date 对象方法按 Gregorian 解释；“返回日期必须被该 weekday API 判 Sunday”的性质错置了历法。自动测试失败和多人筛选仍不替代领域语义。[V18–20]

**Hima 的同构陷阱：** AI 看见某节点名叫 check-engineering-goal、五条 PASS，就生成“该 Run 必须 ended-goal-met”的测试；它实际把未获授权的产品解释写成了 oracle。必须先从明确 contract 得到 Goal 范围，不能让实现、测试、review 互相引用成为闭环证明。

## 5. 较成熟方法的证据强度与上限

- Google 的 [Practical Mutation Testing at Scale](https://research.google/pubs/practical-mutation-testing-at-scale-a-view-from-google/) 是真实工业工程案例：在 code review 中只变异改动代码、过滤无关 mutants、限制每行/每次审查数量并据历史表现选择算子。它支持窄而可行动的 mutation，不支持 Hima 全库 mutation gate，也没在此证明 Stryker 的收益。[V08]
- AWS 作者的 [Use of Formal Methods at Amazon Web Services](https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf) 表列 DynamoDB 发现 3 个 bug，其中反例需 35 个高层步骤；另一个锁结构没发现 liveness bug，因为没有检查 liveness。TLA+ 的价值与边界同时在一手案例里：检查有限模型/性质、回接代码测试，不能从 safety PASS 推出会完成。此为作者工程经验，非随机对照。[V13]
- [FoundationDB 官方测试说明](https://apple.github.io/foundationdb/testing.html) 把相同运行时下的确定性模拟、机器/网络故障及不变量检查结合，保留精确复现。证明的是可行的工程机制与项目经验；其模拟规模/模拟 CPU 年份不应拿来给 Hima 做 ROI 推算。[V12]
- [Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) 将 transcript 与环境最终状态分开、组合确定性/模型/人工 grader 并按需增加。Hima 应查原成果和路由，不以 Agent 说“完成”或调用了工具充当业务完成；方法/策略研究价值仍需真实 L4/L5 与专家判断。[V14]

## 6. 与当前 Node 测试体系的窄接法

root 已核对本仓库 Node >=24、`test:unit=node scripts/run-unit-tests.mjs`、`test:local=node scripts/run-contract-tests.mjs local`，已有 `check:seams/check:boundary` 及 `agent-recovery.host`、`branch-autopilot.host`、`resident-engineering.host`。本 lane 未重跑这些入口。

1. 先在现有测试文件以人工表格例/明确 barrier 建立 oracle；不需要为六个反例先安装新库。若输入组合复杂且性质稳定，fast-check 可嵌入现有 Node test/assert，由 `fc.assert` 报错；它是生成/缩减库，不要求迁到 Jest/Vitest。持久化仍调用现有真实 Host support。[V03–04,V21]
2. Stryker 有 command runner 与 `buildCommand`；可用现有**受控子集**命令，并将 mutate 范围限到一个关键函数/文件。官方明确 command runner 没有 per-test coverage 能力；必须显式选择相应 coverage 模式，预先接受每个 mutant 重跑子集的成本。若测试读编译后的 lib，要确认变异源码真的进入新构建；旧产物会造成假幸存/假通过。此处只是适配可行性建议，本轮未安装/验证兼容性。[V22]
3. 不用模型/EDA 运行来替代本地状态验证。真实报告副本可测 Reader/绑定，但不能证明现场商业 EDA 正确；实际 timing/AutoFix 效果、原 Job 恢复及 XTop 声明范围分别需要真实证据。
4. 每个 PR 只跑触及风险的最低集合：纯格式/文档 L0；纯选择/判断 L0+L1；改变 result/route/effect/hold L0+针对性 L1/L2；控制 UI 加窄 L3；remote/job/reader实际格式 seam 改变再 L4；研究整体效果改变再 L5。Mutation 只在关键判断的断言敏感性未证实时触发；TLA 只在协议交错复杂度超出手工推演时触发。

## 7. 采用与停止信号

可采用：一个切片能提供独立业务预期、至少一个真实旧缺陷或合理故障模型、稳定的最小反例；新方法比既有测试找到额外重要错误/缩短定位，或让一项过去含糊的协议得到明确裁决。记录确认缺陷、误报、定位/审阅时间、最小反例与额外维护成本。

应缩小或停止：AI 持续发明产品性质；预期全部复制实现；同类反例现有测试已经覆盖而新工具只增加数量；多数时间在解释等价 mutants；随机失败不可复现；形式模型和实现映射无法审阅；测试只跑替身却给 EDA PASS；为了变绿换掉原 Run/Job 或删掉 unknown。停止的是该方法/该试点，不是掩盖尚存风险。

风险驱动两条最小路线：

- **行为绑定切片：** 数值 consumer 的一个人工算例 + local PASS≠Goal + 插入无关 Reading 的变形关系 + 一次规格↔代码复核。先 L1/L2，不启用 TLA/mutation 全库。
- **恢复协议切片：** 固定原 Job 的 effect/receipt 与 result/route 断点 + hold late completion 两顺序 + 旧 Run 恢复。先 L2 明确故障点；若仍无法枚举重要交错，再抽窄状态模型。实际远端身份或恢复 seam 改变才补 L4。

## 8. 核对与未闭合事项

主要使用来源正文已由 web 打开（V15 仅检索摘要、全文挑战页，未用于核心结论）；12 个核心资源另通过 Python 标准库 GET 保存并记录 HTTP、SHA256，均 200，见 `verification-raw/retrieval-status.json`。手工核对论文样本框、TLA safety/liveness反例、fast-check调度限制、Stryker command coverage限制、GitHub合并身份与dateutil原评论。HTTP 200 不代替语义核对。

未闭合：没有 Hima 实测净收益；没有现代 Astra 同模型/跨模型 reviewer 在本业务上的受控差异实验；未验证 fast-check/Stryker 对当前构建/runner 的实际兼容性；六类用例是建议而非通过记录。检索止于这些证据已足以选择最小组合，继续搜索工具榜单不会改变决定。
