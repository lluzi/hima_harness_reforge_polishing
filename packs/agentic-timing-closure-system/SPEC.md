## Goal template

本文是 **Agentic Timing Closure System HimaPack 的 SPEC**，按 HimaPack 的九个规定章节组织。它与架构设计文档（`/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`，外部设计参考，不随 Pack 分发）一起指导本 Pack 的 `FABRIC.md`、Workshops、Readers、Rules、Choosers 与 Knowledge 编译；`INTENT.md` 记录的业务决定由本文件承接为可编译的方法合同。

业务目标：在冻结的功能意图与项目时序条件下，尽早完成 setup/hold 共同闭合。运行起点为 Innovus；不修改 RTL、不执行逻辑综合。主对照为 **B_lazy**：AI 接管既定人工流程、使用知识反馈并重复 fix 的现有 Timing ECO Pack（`xtop-timing-closure@1.0.14`，digest `19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92`；冻结身份见 `docs/package-development/agentic-timing-closure-system/b-lazy-freeze.md`）。

建议的 Goal 参数为 `target_setup_wns_ns = 0.0`、`target_hold_wns_ns = 0.0`，单位 ns，表示最终有效分析中必要 checks 的最差 slack 下限；项目若另有已批准的正 margin 要求，在开始前固定，不在探索中改变。最终分析允许采用预先确定、覆盖合格的 PBA 口径，不要求 GBA 同时 clean。

主要业务结果是可恢复、与最终证据一致的 Innovus 数据库。优化优先级是：在生效资源/成本硬上限内最早获得合格结果；其后报告 seat-hours、工程师时间、完整物理刷新次数与其他代价。不给本 SPEC 写未经测量的倍数承诺。

不将原数据库已有的 PG/物理问题全面整改列为目标。与本次改变直接相关、保证结果仍是有效设计的必要检查，按固定动作合同执行。Timing closure 不等同于整芯 signoff 或 tapeout-ready。

方法核心是：Operator 在工具中研究与试改；独立 workspace 产生互补的 ECO Contribution；共同 Integration Fix Session 合并、局部修订并统一导出；多个成果共享必要的实际实现及新 RC/STA。为同一问题比较互斥解可以存在，但不把“多个分支各跑完整流程后选一个”作为主要并行模型。

知识依据：`over-constrain-and-read-the-violation.md` 用于区分目标、实际 slack 与下一步假设，不用于授权改变本项目频率；`what-a-golden-flow-is.md` 确立参考流程用于学习与验证，而非新方法必须机械复制的路线。

## Constraints

**已确认的业务约束**：

1. RTL 和功能意图冻结。允许 Innovus 内保持功能等价的门级变换；不启动综合或 RTL 修改任务。
2. `auto` 严格选择两种范围：完整流程资料齐全才开放 lifecycle；否则使用 post-route-only。个别早期 checkpoint 不能开放部分阶段回退；不得自行重建未提供的早期状态。
3. 全流程模式下，若证据支持早期 APR 更快到达 closure，可以直接选择该阶段，不必先穷尽 local ECO。
4. 允许为 timing 局部调整 PG。在事先约定范围和必要验证能力具备时自主执行；缺乏该能力只限制这类动作，不自动阻断其他 timing 修复。
5. 允许有明确后续机制、退化限度和截止点的暂时退化状态继续工作；最佳已验证状态独立保留。
6. Site 提供有限可见的默认预算，用户可覆盖。Agent 调配资源但不能自行提高生效上限。
7. 动态封批，由等待价值、贡献依赖和联合验证成本决定；不以所有 worker 结束为前提。封批可提前，不代表可以省略必要的最终验证场景。

**必须由确定性机制检查的条件**：

| 检查对象 | 条件 | 检查时机 |
|---|---|---|
| 输入和查询 | 设计、库、约束、场景、分析模式与请求对应；缺失明确 | 绑定输入/打开 session 或改变相关输入时 |
| 操作 | 实际目标、编辑域、许可动作和命令结果有效 | 执行及读取实际 delta 时 |
| 贡献 | 输入/输出/操作/脚本对应；父状态可识别；原子组与依赖保留 | 提交和重放前后 |
| 组合 | 未解决冲突、命名冲突、前提失效得到处理 | 相应交互组及封批时 |
| 预验证 | 证据覆盖与模型适用性明确，特别是新网寄生 | 用其结果作决策之前 |
| 最终结果 | 新实际布局、网表、SPEF、全部必要报告属于同一候选 | 结果采用/交付时 |
| 功能与物理 | 本动作所需功能等价、合法性、连接、供电等检查满足固定合同 | 适用动作的采用条件，而非所有动作都跑所有检查 |

固定验收合同禁止模型改变频率、放宽时序例外或忽略 required checks 来“获得 clean”。局部空间、PG、逻辑变化的验证要求取决于动作影响；不得把无关旧问题整治偷加进 Goal。

检查按成本与价值分层。XTop/估算 RC/局部 PT 未能证明收益，不自动拒绝一个机制清楚、有范围、预算和恢复点的真实物理试验。也不要求每条查询存完整 DB、每个分支独立做全链验证或每次重算未变化输入。

Harness 源码保持不变。业务判断、工具适配和状态含义放在 Pack，运行身份、权限、预算、Jobs、恢复和证据沿用 Harness；Site 更新工具与资格绑定不等于升级 Harness。未验证的执行形状须在开发测试中证明，不靠额外后台控制器补齐。

知识依据：`assert-the-checker-options.md` 要求必要验证有明确版本与条件；`attribute-by-database-relation.md` 要求采用事实来自原生对象关系；`one-checker-per-session.md` 用于保持不同验证工具结果独立，不把它扩成每条诊断命令都重新打开 session 的额外负担。

## Run contract

**Pack 与 Site 分工**：Pack 携带方法、参考图、Tools、Workshops、Readers、Rules、Choosers、Semantics 和 Knowledge。Site 绑定工具路径/版本、wrappers、许可证、容量、PDK/library/input 根、工作区和合格操作能力。一个 Campaign Run 保持一个 owner；Operator/研究 child 不获得第二份 Run 控制权。

**输入**：

| 输入名 | 内容及身份要求 |
|---|---|
| `designStateManifest` | top、stage、可恢复的 Innovus 状态，以及匹配 netlist/physical/约束引用；可选完整流程资料索引 |
| `analysisContract` | 必需 scenario/check、库与 RC 映射、时钟与 SDC 权威、最终 PBA/覆盖方法、Goal/必要约束、比较条件 |
| `siteCapabilities` | 真实工具和 qualified Operator、wrapper、阶段能力、可用 cell 配置、预算与资源绑定 |
| `workspaceRoot` | Site Permit 允许的 Campaign 私有输出根 |

**Auto 输入判定**：

- Post-route 最低输入必须足以恢复当前设计并正确运行其所需的提取、STA 和 ECO；最低输入不成立时不能仅因全流程资料不足而宣布 post-route 可运行。
- Full-flow 资料必须共同支持项目约定的 Innovus 全阶段起点、阶段配置/脚本、物理与时序依赖、恢复和下游运行。完整性由声明的资料清单与实际可恢复性核验，不按目录名称或文件数量猜测。
- `lifecycle_available = 1` 当且仅当全套要求得到确认；否则为 0，并记录缺项，执行范围为 post-route-only。未知依赖不能视为存在。
- 不额外开放“只有 CTS 数据所以回退 CTS”的第三种范围；不从 post-route DB 或零散资料构造用户未提供的早期流程。

**状态及研究单位**：

| 对象 | 必需含义 |
|---|---|
| `DesignState` | 同一设计状态的原生输入、工具、场景/精度身份及可恢复材料 |
| `ObservationSet` | 绑定 DesignState 的 checks、path 样本、物理/库事实和覆盖；额外查询不创建新物理状态 |
| `WorkPackage` | 问题、目标集合、允许编辑域、影响假设、资料、工具与预算 |
| `Contribution` | base/state-out、确定操作、脚本、实际 delta、效果、前置条件、依赖/原子组与来源 |
| `IntegrationState` | 当前重放结果、所含贡献修订、实际操作、冲突和检查；与生产结果分开 |
| `MergeCommit` | 相对共同父状态的唯一联合修改、统一导出、来源映射、预验证与实施要求 |
| `Evaluation` | 同一候选的有效测量、覆盖、适用性、约束事实与成本 |
| `ResidualCase` | 未闭合 checks 的根因证据、尝试、限制、下一步选择及阶段所需输入 |

三个指针独立：`workingState` 可以指向受控的暂时退化实现；`bestVerifiedState` 保存按固定比较政策保留的最佳结果；`deliveryState` 只有最终条件满足才生成。每个批次的共同 base 明确指向一个具体状态，不能依赖可变目录名解释历史。

状态版本、观察修订、贡献修订与完整物理刷新次数分开记账。Legacy Harness generation 不被当作“又跑了一轮完整 APR”的同义词。

**产物与消费者**：以下名称是拟编译进 `contract.outputs` 的设计名称，文件路径由未来 FABRIC 在 Campaign 相对路径下固定；它们不是已创建的实现。

| 产物 | 唯一汇总生产者 | 主要消费者 |
|---|---|---|
| `baselineState` / `inputReadiness` | 状态绑定与输入核验工具 | 所有研究及模式判断 |
| `currentObservations` | 观察汇总工具，引用各工具原始结果 | diagnose、plan、worker |
| `observationRequest` | diagnose Workshop | 请求校验与查询工具 |
| `riskAtlas` | 风险汇总工具，事实/假设分区 | planner 与阶段决策 |
| `campaignPlan` | plan Workshop | owner、工作区准备、委派 |
| `workerManifestNN` / `workerResultNN` | 对应 worker 准备/结果捕获工具 | worker 与 collect |
| `workerRequestNN` | 对应 research-worker Workshop | 请求 Reader、qualified Operator/tool 与反馈捕获 |
| `contributionIndex` | collect 工具 | composition 分析与 Workshop |
| `compositionFacts` / `integrationPlan` | 确定分析工具 / composition Workshop | 重放与冲突修订 |
| `integrationState` / `mergeCommit` | 集成重放/封批工具 | 联合检查与实施 |
| `precheckEvidence` / `physicalDelta` | 各检查原件的汇总工具 | 下一次投入决策 |
| `finalEvaluation` | 最终测量汇总工具 | Reader、Judge、采用 |
| `acceptanceRecord` / `campaignExperience` | 采用 / 经验记录工具 | 后续状态、报告、结束 |
| `nextDecision` | 下一项投入 Workshop | owner 及确定决策合法性检查 |

`NN` 必须在方法编译时展开为有界 slots 或经现有受控委派结果引用实现，不假设 Harness 支持任意动态 output 名。产物入口可更新，历史原件和所引用的版本不得覆盖。模型不能直接写出 `finalEvaluation` 中的测量值。

**编译决策：worker slots 与 Workshop 目录**（本任务固定，供后续 FABRIC/Workshop 编译直接引用，不再作为开放问题）：worker slots 精确为 3 个：`workerManifest01`、`workerManifest02`、`workerManifest03`；`workerRequest01`、`workerRequest02`、`workerRequest03`；`workerResult01`、`workerResult02`、`workerResult03`。`NN` 在编译时展开为这三个有界 slots，不存在第四个或动态命名的 worker 产物。对应的 Workshop 目录固定为 `research/diagnose`、`research/plan`、`research/worker-01`、`research/worker-02`、`research/worker-03`、`research/compose`、`research/next`。每个 Workshop 的 argv 固定为 `[python3, '${ENTRY}', '${WORKSPACE}', '${WORKSHOP}']`：三个操作数分别是本次生成的程序、Campaign 根和本次私有代码目录，不按猜测的父目录层数反推路径。

**Tools、wrappers 与实际启动路径**：

| Tool 职责 | 声明的执行方式 | 输入→输出 |
|---|---|---|
| 状态/贡献/组合/风险处理 | Site 已许可 Python wrapper，显式 argv | 原件/计划→结构化结果及引用 |
| XTop 交互研究与重放 | `hima_interactive` 驱动已有 `hima-tcl-line-v1` Job；Site wrapper 准备私有环境并启动 `xtop -f <startup>` | 匹配设计/context/库→session、receipt、workspace、ECO |
| PT 查询、预演、最终 STA | 已声明 PT Job，Site 环境中执行 `pt_shell -f <script>` | 对应输入/请求→check/path/annotation 报告 |
| Innovus 导出、ECO、单 APR 阶段 | 已声明 Innovus Job，使用已见的 `innovus -batch -files <script> ...` 调用形状 | checkpoint+计划→实际 DB/DEF/netlist/报告 |
| StarRC 提取 | 已声明 StarRC Job，工艺命令与工作目录隔离 | 实际 DEF/technology→SPEF/日志 |
| 适用的功能/供电检查 | Site 另行声明的已有工具能力 | 明确修改与合同→对应独立结果 |

每个商业 tool 声明实际 licenses；Python 不另起未登记的 SSH/tmux/pexpect 控制链。Host 操作真实 session，Python 承担输入编译、解析、diff 和文件准备。新增 Pack 命令/脚本须更新 Site qualification 绑定，不复用旧 Pack 哈希伪装已合格。

**参考图的行为合同**：

1. 绑定并核验输入，确定范围，形成共同基线和初始观察。
2. Agent 选择补查、拆分工作、继续已有研究、组合、真实试验或结束说明。
3. 在私有 workspace 中，Operator 持续分析→有界试改→检查→修订/提交；查询可以返回同一研究上下文，不强制完整重跑。
4. 收集就绪贡献，生成交互/依赖事实；Agent 按等待价值与成本决定是否封批。
5. 集成 session 从明确父状态重放具体修改。重复去重；冲突局部协商/rebase；其余有效贡献保留。原子组不可无记录拆分。
6. 适用的联合预验证通过或有充分理由进行受控物理试验后，从集成状态统一导出。
7. Innovus 落实、物理差异检查、新 RC、全部必要 STA 与动作相关检查形成真实评价。
8. 更新 working/best/delivery 相应指针，记录经验，并由当前 owner 作下一决定。
9. 在 full-flow 范围，可基于总时间判断直接执行已声明早期 APR 阶段；post-route-only 不创建该类 Job。

同一候选必要验证可以用完整汇合的 fork。全部研究任务不绑定为一个必须全部结束的 fork；现有 owner/委派/独立 Job 方式收集就绪成果，批次内再使用合适的执行形状。具体图、Workshop 形状与恢复行为必须在未来 `hima_pack_check` 和现有 Harness 测试面验证；本 SPEC 不声称已验证动态封批的实现。

**Budget 及恢复**：Site 给出有限默认额度，用户覆盖后固化为 Run 实际边界；主任务与 child 不得重复扩大预算。命令调用等待超时不等于命令退出。恢复先确认实际 Job/状态，再决定重放；不得因丢回执重复插入。晚到结果只属于其原输入，重新作为当前贡献需核对/rebase。达到预算后保留已有事实，按 Harness 真实状态收束。

**设计阶段验收要求**：未来实现应证明多份互补修复进入同一 DB、共享前提冲突可局部修订、廉价检查实际改变行动、支持有依据的提前 APR，并最终与保留完整反馈能力的 B_lazy 做同口径比较。机械闭环通过与业务提速/闭合成功分别报告。

知识依据：`what-a-golden-flow-is.md` 使 Golden Flow 保持外部参考；`attribute-by-database-relation.md` 决定真实变更与采用的取证；`one-checker-per-session.md` 决定验证工具与报告各自有清楚来源。

## Semantics

所有数值须绑定来源状态、工具/版本、配置、场景及精度。复杂对象留在声明 artifact，Reader 输出当前 Harness 支持的 typed values；不擅加未支持的核心 qualifier。`mode` 使用 setup/hold，`scope` 按当前 schema 使用 all/reg2reg；scenario/check 细节在原件和 manifest 中保留。

下表是供未来 Reader 实际实现的值合同，不是本轮已产生的数据。0 只在数据明确支持零时产生；未给出、截断、身份错配不能默认为零。

| 拟 value type | 单位 | 来源与含义 | 缺失/零值规则 |
|---|---|---|---|
| `tc_required_input_missing_count` | count | 输入核验；post-route 最低必要输入缺项数 | 显式核验才可为 0 |
| `tc_lifecycle_available` | count | full-flow 完整性成立为 1，否则 0 并附缺项 | 未完成核验为 unknown |
| `tc_request_invalid_count` | count | typed 请求结构/引用/范围的失败项 | 合法性报告完整才可为 0 |
| `tc_pending_research_count` | count | 当前实际未完成研究数 | 不是必须等于 0 才可封批 |
| `tc_ready_contribution_count` | count | 合同有效、可进入当前集成的提交数 | 有效 no-fix 不计作修复贡献 |
| `tc_replay_mismatch_count` | count | 预期局部变化与实际变化不符的项 | 实际 diff 可取得时才可为 0 |
| `tc_unresolved_conflict_count` | count | 当前选择组合中未解决的冲突/依赖 | 不是整个研究池所有冲突数 |
| `tc_out_of_scope_edit_count` | count | 实际修改越出允许编辑域的项 | 影响范围未知另行说明，不当零 |
| `tc_unqualified_rc_net_count` | count | 当前预演涉及而缺有效寄生模型的 nets | 未知不能被判预演合格 |
| `tc_xtop_setup_wns_ns` / `tc_xtop_hold_wns_ns` | ns | 当前 XTop 模型的明确最差 slack 观察 | 未报数值则 unknown |
| `tc_presta_setup_wns_ns` / `tc_presta_hold_wns_ns` | ns | 当前预演模型/范围的 PT 最差 slack | 不能作最终 Goal 来源 |
| `tc_final_setup_wns_ns` / `tc_final_hold_wns_ns` | ns | 固定最终口径下全部必要 checks 的最差 slack | 若只证明 nonnegative 但未量得实际正值，记录相应下界/覆盖；不得伪造正 margin |
| `tc_missing_required_check_count` | count | 固定合同内缺少有效最终分析的 checks/scenarios | 明确完整覆盖才可为 0 |
| `tc_final_identity_error_count` | count | 实际 DB/网表/SPEF/报告身份不一致项 | 未能核验为 unknown |
| `tc_applicable_constraint_failure_count` | count | 动作相关必需约束中已测失败项 | 缺检查另计，不合并成 0 |
| `tc_applicable_constraint_unknown_count` | count | 必需约束中证据不充分的项 | 不能被 failure=0 覆盖 |
| `tc_fixed_check_count` | count | 同一身份 check 明确负转非负的数量 | 从报告消失不计 fixed |
| `tc_missing_prior_check_count` | count | 需要对比而无法再次定位/观察的旧 checks | 与结构替换 lineage 分开解释 |
| `tc_refresh_count` | count | 已完成的实际完整物理刷新次数 | 与研究次数、generation 分开 |
| `tc_accepted_artifact_ready` | count | 对应选择的实际 DB/恢复材料核验完备为 1 | 存在同名文件不足以为 1 |
| `tc_stop_required` | count | 当前研究合同内必须等待外部输入/范围条件成立为 1 | 配套明确 reason；不是全局不可行证明 |
| `tc_next_action` | count | 下一项投资决策；来自通过 schema 校验的 `next-decision` 产物的 `action` 字段编码 | 编码为 1 observe、2 research、3 compose、4 revise、5 implement、6 earlier-apr、7 wait、8 goal-met；只在 `next-decision` 通过 schema 校验时产生对应编码，否则为 unknown |
| `tc_selected_contribution_count` | count | 当前 `integration-plan` 的 `select` 列表长度，即本批次选定进入集成重放的贡献数 | `select` 明确为空但仍需封批（例如 no-fix 批次）时为 0；未产生有效 `integration-plan` 为 unknown |

当前 Harness 的 Judge 节点只按第一条命中的规则路由；因此本 SPEC 中出现的复合谓词（`replay-consistent`、`final-evidence-ready`、`required-constraints-pass`）编译为按下一章 Judge rules 所列顺序串联的多个单谓词判定节点，不假装现有单谓词 YAML 支持任意复合表达式；一个 Judge 第一条规则的路由结果不能被误当作全部规则已经通过。

若工具只给出“无负 slack”而非真实最差正 slack，Reader 可以在明确语义下支持 0 阈值结论，但不能借此支持正 margin 目标。报告精度不足以判定边界时增加适当精度的查询，不能向有利方向舍入。

TNS、唯一 check 数量、面积、位移、分层 wire/via 等保留在结构化证据中供研究使用；本版 Judge/Chooser 不消费未在上表声明的 typed value。以后确需新增规则时同步增加语义和真实 Reader。

工作态与最佳态允许不同；分支收益不能线性相加成联合收益。`input valid`、`experiment completed`、`contribution replayed`、`final goal met` 是四种不同结论。

知识依据：`over-constrain-and-read-the-violation.md` 约束真实 slack 及精度解释；`assert-the-checker-options.md` 约束观测口径；`attribute-by-database-relation.md` 排除名称 grep 充当采用事实。

## Judge rules

Judge 只执行已声明谓词，不解释根因、不选择最佳修复。Reader 读取事实，模型计划先经过请求检查，才可以成为可执行输入。

| Rule | 必需值与谓词 | 通过后的用途 | 不通过的处理 |
|---|---|---|---|
| `inputs-ready` | `tc_required_input_missing_count == 0` | 进入研究 | 等待缺失最低输入 |
| `request-admissible` | `tc_request_invalid_count == 0` | 执行本次查询/试验 | 返回明确诊断以修订请求 |
| `replay-consistent` | `tc_replay_mismatch_count == 0` 且 `tc_out_of_scope_edit_count == 0` | 继续集成 | 恢复/局部修订，不假称实际采用 |
| `composition-ready` | `tc_unresolved_conflict_count == 0` | 封闭当前选择组合 | 处理冲突或缩小当前批次 |
| `presta-model-qualified` | `tc_unqualified_rc_net_count == 0` | 使用该预演支持相应决策 | 该模型结论 unknown；可另选适用物理 probe，不一律终止 |
| `final-evidence-ready` | `tc_missing_required_check_count == 0`、`tc_final_identity_error_count == 0` | 判断最终 Goal | 补测或修复身份问题 |
| `required-constraints-pass` | `tc_applicable_constraint_failure_count == 0`、`tc_applicable_constraint_unknown_count == 0` | 允许对应结果的采用 | 不采用为合格结果，保留候选与原因 |
| `setup-goal` | `tc_final_setup_wns_ns >= target_setup_wns_ns` | 联合 Goal 的一部分 | 继续研究，不单独宣布失败终态 |
| `hold-goal` | `tc_final_hold_wns_ns >= target_hold_wns_ns` | 联合 Goal 的一部分 | 同上 |
| `artifact-ready` | `tc_accepted_artifact_ready == 1` | 支持交付/最终化 | 恢复或完成产物核验 |
| `continue-or-wait` | `tc_stop_required == 0` | 合法下一研究动作 | FAIL 到声明 wait，带具体外部需求 |

表中复合条件在未来 FABRIC 中编译为当前 schema 支持的多个规则及顺序，不假装现有单谓词 YAML 支持任意表达式。证据/约束规则先于 Goal；所有最终必需规则都通过才允许 goal-met 决定。一个 Judge 第一条规则的路由不能被误当作全部规则已经通过。

**编译决策：复合规则的拆分**。三条复合规则在编译时拆分为按顺序串联的单谓词 Judge 节点，文件按 `<id>-<part>` 命名：

- `replay-consistent` 拆分为 `replay-consistent-mismatch`（谓词 `tc_replay_mismatch_count == 0`）与 `replay-consistent-scope`（谓词 `tc_out_of_scope_edit_count == 0`），按此顺序串联——前者 PASS 才判后者，任一 FAIL 都路由到“恢复/局部修订”。
- `final-evidence-ready` 拆分为 `final-evidence-ready-coverage`（谓词 `tc_missing_required_check_count == 0`）与 `final-evidence-ready-identity`（谓词 `tc_final_identity_error_count == 0`），按此顺序串联。
- `required-constraints-pass` 拆分为 `required-constraints-pass-failures`（谓词 `tc_applicable_constraint_failure_count == 0`）与 `required-constraints-pass-unknowns`（谓词 `tc_applicable_constraint_unknown_count == 0`），按此顺序串联。

其余 8 条规则（`inputs-ready`、`request-admissible`、`composition-ready`、`presta-model-qualified`、`setup-goal`、`hold-goal`、`artifact-ready`、`continue-or-wait`）本身即单谓词，编译时不拆分，直接对应一个 Judge 节点。

定性根因置信度或未经校准的预测不作为硬拒绝谓词。模型内不利与已证实非法分开，允许预算内有范围的真实试验。

最低反例集包括：真零、缺值、截断、同名不同状态、负转正后不在 top-N、重复贡献、原子组被拆、同对象不同目标、无对象交集但共享 timing window、新网无有效 RC、晚到旧 base、工具完成但业务未通过。

知识依据：`assert-the-checker-options.md` 决定条件与缺证据处理；`end-honestly-in-more-than-one-way.md` 要求规则有真实可达的失败出口；`one-checker-per-session.md` 保持约束来源独立。

## Choosers

当前 Harness 的 Chooser DSL 不是完整工程推理引擎。Agent/Workshop 提出下一次行动及证据；Chooser 与现有 owner 执行接口承担合法策略和终态映射。不得用一条“score 下降就继续”替代本方法。

`nextDecision` 至少包含：当前 state/observation/预算引用、待解决问题、选定动作、作用对象、理由、反证/停止条件、预计成本依据、所需产物。它是计划，不是测量。`nextDecision` 的 `action` 字段由 `tc_next_action` 编码；owner 执行接口按该编码路由到下表对应的领域行动，不解释文字原因；`tc_next_action` 为 unknown 时不路由到任何行动，视为 `request-admissible` 未通过。

允许的领域行动及其前置条件：

| 行动 | 所读证据 | 具体后果 |
|---|---|---|
| Observe | 现有覆盖、竞争解释、查询成本 | 新的 PT/XTop/physical 查询，返回同一问题 |
| Research | 风险、已有贡献、可用能力和资源 | 创建/继续明确 worker，不重复无新依据的同一试验 |
| Compose | 就绪贡献、依赖、交互、等待价值 | 选择当前批次并进入集成 |
| Revise | 实际重放/预验证/物理反馈 | 只修订相关提交或交互组，保留其他成果 |
| Implement | MergeCommit、相关检查、仍需物理证据的问题 | 一次联合实际实现与刷新 |
| Earlier APR | `tc_lifecycle_available == 1` 及时间/机制比较 | 执行用户资料支持的早期阶段，不要求 local ECO 耗尽 |
| Wait/Stop explanation | `tc_stop_required` 及具体缺项/范围/预算事实 | 通过现有合法路径停止新试验、保留结果和限制 |
| Goal met | 全部当前最终规则通过、产物可恢复 | 请求现有 Explore goal-met 结束 |

`tc_selected_contribution_count` 在 Compose 动作时被读取，用于确认当前批次确实选中了贡献、值得进入集成重放；批次为 0 而仍需封批（例如只封一个 no-fix 批次以推进决策）时，Chooser 必须另有等待价值依据说明为何以空批次继续，不能默认省略集成检查、也不能把 0 当作组合失败的隐含证据。

动态封批只收集当前决定采用的贡献，不等待无依赖的所有在研任务；必要时等待某个贡献比多付一次完整刷新更便宜。延期/取消任务保留其事实；若已开始执行，以真实结束/取消结果回收资源。

每个下一步都引用已获得的新信息或明确未测假设，不能仅增加 revision 就重试。研究进展可以表现为排除错误机制、合并更好的操作或保留更有价值的物理选择，不要求每次 WNS/TNS 单调改善。

本 SPEC 不启用以聚合 score 稳定为依据的自动 converged 结束。具体图的 revisit、wait 和 owner decision 使用现有 Harness 语义；若未来编译发现某条转移不可表达，要修订 Pack 表达或报告缺口，不能另写隐藏运行循环。

知识依据：`over-constrain-and-read-the-violation.md` 使预测只指导下一试验；`end-honestly-in-more-than-one-way.md` 排除把耗尽预算或“感觉没进步”当作闭合/全局不可行。

## Endings

| 业务结束/暂停情况 | 何种事实触发 | 现有 Harness 路径 | 允许的结论 |
|---|---|---|---|
| Timing closure | 当前最终 setup/hold、必要约束、覆盖、产物规则全部通过 | Explore 显式 goal-met | 在固定合同下闭合；不扩大为整芯 signoff |
| 缺输入/能力 | `inputs-ready` 或 `continue-or-wait` 等相关规则失败，附具体缺项 | 已声明 wait | 条件阻断，不是设计不可闭合 |
| 当前允许范围内无值得继续动作 | 有记录的候选/机制/成本分析，以及明确需要的外部改变 | `tc_stop_required=1` 使 continue-or-wait 失败到 wait | 有边界的策略/范围限制；不宣称数学上无解 |
| 预算耗尽 | Runtime 实际硬预算事实 | Runtime 已有 budget ending | 未完成及已有结果；不叫 converged 或 clean |
| 用户暂停/取消 | Harness 真实控制记录 | 已有 pause/cancel 语义 | 如实记录 Job 是否仍在结束/收束 |

post-route-only 出现无法本地解决的 Residual Case 时，可形成所需资料/能力说明，但不能在该 Run 中偷偷转 APR。Full-flow 可以更早选择 APR 而非必须进入 wait。

关闭时交付已持有的最佳已验证状态、工作状态、贡献与集成记录、剩余问题、成本和真实原因。没有合格 DB 时明确没有，不能把最近 checkpoint 标成 best 以满足产物要求。

本节只定义业务含义与现有机制的映射；具体状态字符串以正式 Run 返回为准，不手写虚构 Ledger/TEST 身份。

知识依据：`end-honestly-in-more-than-one-way.md` 决定成功与有原因停止的区分；该知识中“generation limit 不是工程结论”的原则不意味着否认 Runtime 真实 budget ending，后者必须按实际事实报告。

## Workshops

所有 Workshop 声明 purpose、directory、entry、language、inputs、reads、knowledge、produces、argv 及需要的 licenses。`produces` 指向真实 contract output，并有 Reader；不是直接把未来研究程序预写成固定答案。

| Workshop | 读入的声明产物 | 运行时研究内容 | 产出 | 后续消费者 |
|---|---|---|---|---|
| `diagnose-and-observe` | baselineState、currentObservations、riskAtlas、campaignExperience | 根因竞争、最低成本区分性查询、path 覆盖/PBA 策略 | observationRequest | 请求 Reader、合法性检查、真实查询 tool |
| `plan-campaign` | inputReadiness、currentObservations、riskAtlas、contributionIndex | 问题分解、worker 作用域、共享依赖、成本与任务预算 | campaignPlan | 计划 Reader、owner 与 workspace 准备 |
| `research-worker` | workerManifestNN、对应已记录工具结果、有关经验 | 分析算法、候选生成、manual/auto 策略、补查与修订 | worker 请求/研究结果的声明 artifact | 合格 Operator/tool 与 Contribution 捕获 |
| `compose-contributions` | contributionIndex、compositionFacts、integrationState | 顺序、去重、联合窗口、局部冲突修订/rebase | integrationPlan | 计划 Reader、确定重放 tool |
| `evaluate-next-investment` | precheckEvidence、physicalDelta、finalEvaluation、experience、成本 | 下一次观察/修复/封批/APR/结束理由 | nextDecision | 请求 Reader、owner/合法图路径 |

Python 研究程序在 admitted Workshop 目录中读声明资料、计算并产出计划/派生分析；不直接启动未登记商业进程。工具交互在已 admitted 节点的真实 Operator session 中完成，多条 manual/query 不必拆成多张图节点。

Workshop 文件合同统一为 `language: python`、`entry: entry.py`、`argv: [python3, '${ENTRY}', '${WORKSPACE}', '${WORKSHOP}']`。三个操作数分别是本次生成的程序、Campaign 根和本次私有代码目录；不得按猜测的父目录层数反推路径。静态 directory 分别为 `research/diagnose`、`research/plan`、`research/worker-01`、`research/worker-02`、`research/worker-03`、`research/compose`、`research/next`。worker 变体（`worker-01`..`worker-03`）在方法编译时展开对应静态 reads/produces，`research-worker-01`/`02`/`03` 的输出准确指向 `workerRequest01`/`02`/`03`。不把 Harness 提供的保留变量重复声明为业务 inputs。

**每个 Workshop 的产出如何变成 Semantics 声明的 value**（编译决策，闭合“Workshop 产出未必是 typed value”这条自检）：`diagnose-and-observe` 的 `observationRequest` 由请求 Reader 校验产出 `tc_request_invalid_count`；`plan-campaign` 的 `campaignPlan` 与 `research-worker` 的 `workerRequestNN`/其研究结果一起，由计划/收集 Reader 核验产出 `tc_pending_research_count` 与 `tc_ready_contribution_count`（后者读 `contributionIndex` 中 Contribution 的 `admissible` 字段）；`compose-contributions` 的 `integrationPlan` 连同 `compositionFacts` 由确定重放 Reader 产出 `tc_unresolved_conflict_count`、`tc_replay_mismatch_count`、`tc_out_of_scope_edit_count` 与 `tc_selected_contribution_count`（`integrationPlan.select` 的长度）；`evaluate-next-investment` 的 `nextDecision` 由请求 Reader 产出 `tc_next_action`（`action` 字段编码）与 `tc_stop_required`。不存在未经声明 Reader 直接消费的 Workshop 输出。

每个 worker 保有独立上下文和私有写域；单一工具 session 保持单写者。子任务结果由 owner 显式采用为候选贡献，不能自行完成整个 Campaign 或改 Goal。

Code 与文档可以由 Agent 自主生成，但其输出是待检验的研究结果。引用事实必须可追溯；新算法能否改善问题由工具反馈决定，代码量和文字解释不作成功标准。

首次验收应包含：真实证据改变下一条查询/动作；至少两个互补修改共同进入同一 DB；一次共享前提变化经过局部修订；一个有理由的提前 APR 选择（仅 full-flow）；一个数据不齐全的 post-route 范围限制。最终业务效果仍用完整任务与 B_lazy 比较，不能用这些局部用例替代闭合。

知识依据：`what-a-golden-flow-is.md` 界定参考与研究自由度；`attribute-by-database-relation.md` 约束实际效果捕获；其余具体机制由下一节 Pack-owned 知识提供，不增加第二模型/执行控制面。

## Knowledge

| 拟 Pack 知识文件 | 内容 | 明确改变的决策 |
|---|---|---|
| `method-and-benchmark.md` | 已确认业务范围、B_lazy、协作合并与时间目标 | 防止退化成线性 flow 加解释 |
| `state-and-evidence.md` | 状态、覆盖、精度、working/best/delivery、unknown | 何时可信、何时补测、哪些不可混用 |
| `observation-strategy.md` | GBA/PBA、path breadth/diversity、Nworst/max_paths、查询成本 | 决定看什么和何时停止分析 |
| `mechanisms-and-falsifiers.md` | cell/net/clock/SI/空间根因、反证与联合窗口 | 问题分解、候选机制与真正试验 |
| `xtop-capabilities.md` | queries、attributes、manual/auto、输入与版本条件 | 按问题组合工具能力，不只选固定 auto-fix 菜单 |
| `contribution-and-merge.md` | base-relative 变更、导出历史、依赖/原子组、rebase 与恢复 | 积累多分支成果、局部解决交互 |
| `cheap-verification.md` | PT 预演适用性、RC 无效、几何 diff 与误判 | 选择有价值检查，允许受控真实试验 |
| `innovus-stage-interventions.md` | 已核对的 stage hooks、path group/weight/skew/route 等接口与条件 | 把 Residual 转成实际阶段请求与效果读回 |
| `lifecycle-and-input-modes.md` | auto 严格二范围、资料完整性、阶段 lineage 和 APR 选择 | 防止 partial 回退/擅自重建；提前处理风险 |
| `experience-transfer.md` | 成功/失败条件、预测与实测差异、版本/区域适用性 | 改变下一次行动，避免无条件泛化 |

每项知识声明 source/version、适用范围、资格状态、实际行动含义与反例。Site/customer 资料保持外部只读引用，分发权限未确定的手册内容不直接打包。运行经验属于当前 Campaign artifact，不能静默改写封存 Pack。

这些业务决定已经落定到 `INTENT.md → SPEC.md`；后续任务将其编译为 `FABRIC.md` 与真实方法文件（`contract.yml`、`graph.yml`、`semantics.yml`、`readers/*.yml`、`rules/*.yml`、`choosers/*.yml`、`knowledge/*.md`、`tools/*.py`、Workshops），再经 Harness 的 `hima_pack_check` 与真实测试验证。具体 TEST/VERSION 身份由相应任务在真实测试 Run 通过后填写，不在本文预先编造。

本 SPEC 依据：用户 Q1–Q14 决定、[HimaPack 开发指南](/Users/lluzi/code/hima_harness_reforge_polishing/docs/package-development/THE_DEVELOPMENT_OF_HIMA_PACK.md)、[Pack anatomy](/Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/skills/knowledge/pack-anatomy.md)、[开发映射](/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md)、[Operator 与 APR 接口核对](/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md)。引用的六份作者知识位于 `/Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/skills/knowledge/`；它们仅用于塑造已授权业务的表达，不添加用户未要求的优化任务。
