# HimaHarness 产品与客户价值独立 Review

日期：2026-09-22。审阅代码：`c1583dcc85f9295d69a088b86fa20c6026c43a20`。范围：polishing 当前产品定义、实现、五个 Pack、保留的测试记录及 trial24–26 材料。本文是产品决策 Review，不是新的产品定义、验收签字或工具运行结果。

## 结论先行

**HimaHarness 最值得出售的能力，是让资深工程师在可检查的环境和权限内，组织跨工具、会根据结果调整策略、能够交接和恢复的工程研究，并拿到足以决定下一步的证据与资产。** Pack 提供具体业务方法，Agent 承担分析、代码与推进，Fabric 保持事实和执行边界，Site 接入客户工具，Knowledge 积累有条件的经验，Desktop 让工程师看见并介入这些工作。这与现行产品定义一致；“一个人代替十人团队”仍是愿景，不能作为销售数字。[产品价值与执行主体][definition]

**当前最强的证据是复杂研究机制已能在真实环境持续工作，商业优化效果与可规模交付能力仍未充分证明。** trial24 有七代已结束研究、一次完成的第七代 matched comparison、显式 owner handoff 和预算结束；该 matched Fmax 为 **−2.93%**，未达到本次 +5% 目标。trial25 的 XTop Pack 连第一个商业工具节点都未完成；trial26 正在进行。不能把跑图成功变成业务成功，也不能用一个有效负结果否定组织研究、保留知识与降低恢复成本的潜在价值。[trial24][t24] [trial25][t25] [trial26 检查点][t26]

**短期最有说服力的证明，是在现有 routed DB 上交付一轮完整的“诊断 → 有依据的动作 → ECO 回灌 → fresh extraction/STA → endpoint 变化 → 可恢复的 best DB”，再证明第二轮确实使用第一轮反馈。** 它比继续展示节点数更贴近客户的交付任务。Custom Cell/Fmax DTCO 保留为能力上限与探索价值场景；其正向 QoR、跨设计迁移和真实 Cell 交付成熟度必须单独证明。[XTop 业务与验证门][xtop-doc] [Custom Cell 方法边界][custom-intent]

**当前应优先修复入口与事实链上的断点，而不是扩大架构。** 核心问题是 Site 实测能力与人工授权政策的保留、真实 wrapper 边界、长期 Agent 的无谓停顿、研究目标与候选集合变化的可解释性，以及客户能否通过产品入口完成版本安装和资产接续。源码和历史记录已经提供了合适的修改落点。[持续升级纪律][discipline] [trial25 入口问题][t25-f1]

## 1. 审阅方法与证据边界

本次只读检查仓库和明确指定的 `.hima-tmp` 证据；只新增本文。未操作 HimaHarness/Catsights、未登录 Site、未发起 EDA 或产品模型调用、未干预正在进行的 trial26、未访问用户 `tmp/` 内容、未运行产品测试。已阅读根 `AGENTS.md`、产品定义、polishing discipline/model policy、测试策略、`CONTEXT.md`、相关 ADR 和 backlog。评审不以旧仓库或 `docs/upstream/` 作为当前事实。

本文采用以下证据等级，**仅用于标注判断强度，不是新增 Runtime gate**：

| 等级 | 本文含义 | 可支持的结论 |
| --- | --- | --- |
| E1 | 当前规格与源码检查 | 职责、接口、算法和约束确实存在；不能证明用户实际跑成 |
| E2 | 可定位的保留测试/构建记录 | 对记录中版本和条件的机制验证；fixture、replay、真实依赖分别说明 |
| E3 | 保留的真实 Campaign/试用证据 | 某设计、某 Site、某版本下实际发生的行为和结果；不外推其他设计 |
| E4 | 客户独立使用、跨样本重复、带成本对照的验证 | 可重复客户价值与规模交付；本次材料未建立此等级 |

各节用“事实”“解释”“建议”区分证据和判断。测试层级仍采用仓库 L0–L5：L2 不能认证模型研究或商业工具，L4 不能替代完整 pilot，L5 也不证明普遍 PPA 收益。[测试策略][testing]

证据冻结点：代码 SHA 如页首；trial26 以 `tester-checkpoint.json` 的 **2026-09-22T04:13:50Z** 快照为准，状态 `RUNNING`、当前节点 `prepare`、`reportPath: null`。较早的 `cycle.json` 仍是 `DISPATCHED`，不能据其空 Run ID 认定没有 Campaign；也不能从较新的 checkpoint 推断商业节点已完成。动态文件今后可能变化，本文不追认未来结果。[cycle][cycle] [checkpoint][t26]

对 trial24，额外核对本地 Ledger 中 `run-adf41cad-660b-41fc-99b0-bfc23d2c4c99#001334` 的 `read-compare` observation，以及其保留文件：31,282 字节，SHA-256 `063e97502e2ccc55adb5cf008ca8d806b8dc02cd2e45b6cd10a4a70961a68352` 与记录一致。其余远端原始日志、DB 和工具条件未在本次重新审计；trial25 工具错误主要依靠具身份的试用报告和当前修复源码交叉核对。[第七代保留 compare][compare]

## 2. 平台怎样组合成客户购买的业务能力

**事实。** 现行领域模型将“业务能力”定义为模型、Harness、Pack 和 EDA 共同完成的可验证任务。Campaign 是有 Goal、Site、Pack 和预算的业务活动；Run、Job 是执行实体，不是客户结果。Campaign Agent 是唯一业务 owner；Side Talk 可并行对话/Coding，必须显式 handoff 才能接管。[领域定义][context] [执行归属 ADR][adr8]

| 产品部分 | 已有职责与实现依据 | 对客户有意义的结果 | 尚不能承诺 |
| --- | --- | --- | --- |
| Package / HimaPack | 方法、输入合同、graph、读数/判断规则、允许的研究位置及知识；`packs.ts`、Pack 目录、`release.ts` | 把专家方法变成能检查适用性、固定版本并执行的业务资产 | 任意设计零适配；`released` 或 seal 自动代表 QoR 成功 |
| Agent / HimaGuide | 产品认知、Preparation、节点研究、代码、反馈后继续；`index.ts`、`workshop.ts` | 让工程师提出业务目标后能组织实际分析和试验，减少手动转译 | 持续无人照管、所有策略都创新或有效 |
| Fabric | 参考图、依赖、owner/epoch、执行、预算、资源与恢复；`fabric.ts`、`jobs.ts`、`recovery.ts` | 一个持续任务跨多次作业和会话保持身份，不因聊天切换失去责任主体 | 第二个自主决策者；自动处理所有不确定状态 |
| Site | 环境绑定、wrapper、Permit、容量；`sites.ts`、`channel.ts`、`job-cap.ts` | 同一方法在获准的客户环境里执行，CAD 保有边界 | Pack fit 等于工具已跑通；统一管理全公司的许可证池 |
| Knowledge | Pack 内置材料、当前文档、Run 资产；`workshop.ts`、`experience.ts` | 历史失败和方法可被引用，下次研究少走已知弯路 | 存储/检索本身已证明研究效率提升；默认自学习改方法 |
| Evidence | 原始产物身份、Reader observations、Judge verdict、Ledger 与报告 | 工程师能核验“做了什么、为什么信、哪里未知”，支持交接和审计 | hash 正确即测量正确；一次 PASS 即签核 |
| Desktop | 现有 dsh 会话、配置、Campaign 图、代码/证据入口；`client/HimaWorkbench.tsx` 等 | 同一工作区追问、下钻、修改、控制与普通 Coding | 代操作通过即真人易用性认可 |

源码落点：[Pack loader/check][packs-code]、[产品上下文][identity-code]、[owner 与 handoff][owner-code]、[Site 容量控制][cap-code]、[归档实现][assets-code]、[Judge][judge-code]、[Desktop][desktop-code]。这些是 E1 实现证据；相关真实行为在后文单独分级。

**解释。** 客户愿意付费的单位应是“解决一类设计任务的可交付能力”：例如用既有 routed DB 推进 timing closure、组织跨库和物理实现的 DTCO 研究、在新 Site 上建立可工作的研究环境、在数天迭代后仍能交给下一位工程师。Harness 的调度、聊天和图是实现条件。只有同时具备合适 Pack、环境适用性、可控 Agent 和可复核产出，这些部分才组合成客户价值。

**数据边界。** 现场证据默认本地/Site 保留，不等于产品模型完全离线。手册明确试用采用 DeepSeek API，对话、所选文件及工具返回内容可能进入模型服务。客户的数据授权须覆盖实际模型输入，不能用“没有自动遥测上传”替代模型服务的数据流说明。[手册模型边界][handbook-model]

### 当前五个 Pack 各提供什么证据

| Pack | 当前定位 | 本次能采信的证据与边界 |
| --- | --- | --- |
| `custom-cell-fmax-dtco` 5.2.10 | 从 Site 绑定的 RTL/约束/库研究增量 Cell Library；免费因子、商业 E0 与 frontier 反馈 | trial24 为 E3 多代机制和负结果；其 `TEST.md` 自身只是 publication smoke，不能借 seal 增强效果声明。[方法][custom-intent] [TEST][custom-test] |
| `xtop-timing-closure` 1.0.1，development | routed Innovus DB → StarRC/PT → AI plan → XTop → Innovus ECO → fresh STA → best DB | 1.0.0 的 E2 局部测试和 E3 首节点 blocker；1.0.1 已在代码中修复传参，trial26 进行中，完整闭环未证明。[当前 contract][xtop-contract] [方法][xtop-spec] |
| `aes-timing-research` v1 | 不占 EDA 许可的有限候选选择/算法反馈研究 | 保留测试记录：第一代 score 16、冲突 1，第二代 Agent 改代码后 score 21、冲突 0。证明有限样本上的数据依赖修正，不能推导 Fmax。[INTENT][aes-research] [TEST][aes-research-test] |
| `aes-tsmc28-dtco` v5 | AES 定制 Cell 多路线与物理对照的前序业务方法 | Pack 内 `TEST.md` 的 goal-met 明确来自 synthetic external tools；另有旧 pilot 的真实 reference path 和未达标结论，必须分别引用。[fixture][aes-test] [旧版本手册边界][handbook-bounds] |
| `opene902-timing-probe` v2 | 通过 DC QoR 检查和 period 策略进行有边界探测 | 合同声明设计/flow/Site 绑定和 DC 资源；保留 stand-in 的策略反例适于检查“收敛”语义，不能当当前真实客户收益。[contract][e902] [历史反例][backlog-probe] |

**解释。** Catalog 已表达从有限无许可研究，到单工具探测，再到复杂 DTCO 和多工具 ECO 的不同业务范围，因此平台价值不等同于当前两个重点 Pack。但 Pack 数量并不证明通用性：样本仍集中在少量设计、环境和作者团队；成熟度必须按 Pack、Site 和版本展示。

## 3. 对真实芯片工程成本的影响

下表是基于现有任务结构的产品推断，没有引用行业平均数，也没有把可降低的成本写成已实现节省。

| 工程成本 | Hima 可以承担的部分 | 目前证据 | 仍需测量的部分 |
| --- | --- | --- | --- |
| 长周期盯守、跨工具串接 | 保持 Campaign 身份、等待 Job、依结果进入下一节点、记录 blocker | trial24 持续多代；XTop 有明确工具链合同 | 人工净工时；多少停顿需要催促；与合格脚本/现有方法相比节省多少 |
| 策略试错与重复运行 | 当前数据生成代码、复用有效资产、保留失败，避免把过期结果当新证据 | AES 有限样本修正；trial24 反馈循环与旧程序缺陷被发现 | 每次策略变化是否产生新信息；知识引用是否真正减少无效实验 |
| 许可证稀缺与排队 | Site 下 Job/许可额度约束；免费研究后再做昂贵实验 | `job-cap.ts` 在同一 Ledger/Host 内序列化资源申领；trial24 仍因现场 I/O 大量耗时 | 外部用户/其他 Home 占用、真实 checkout/释放、排队与停滞的区分；许可费用是否下降 |
| 环境迁移与交接 | Pack 固定方法与 Site 私有绑定分离；Preparation 提前暴露缺项 | trial25 admission 通过，但 wrapper 环境变量仍失败，且需要人工修改配置 | 新 Site/设计的适配工时、首次有效工具动作时间、CAD 支持次数 |
| 失败恢复 | owner handoff、在途 Job 核对、保留 Run/历史 | trial24 显式 handoff 成功；当前有恢复实现与定点测试 | 数天、断网、重启、工具挂起后的恢复成本；不能从一次安全边界 handoff 推导任意故障恢复 |
| 多角色复核与审计 | 报告、代码/方法身份、原始材料与判断可追溯 | trial24 compare 可从 Ledger 找回并核对 hash；旧手册有阅读/控制路径 | 另一位工程师不问原作者能否重建结论、找到 best DB，以及所需时间 |

依据：[trial24 handoff/停顿/I/O][t24-handoff]、[资源控制范围][cap-code]、[恢复代码][recovery-code]、[恢复测试对象][recovery-tests]、[新 Site 交接要求][handbook-site]。

**解释。** 第一种收入理由是“以前因跨领域组织成本而做不起的探索，现在有一条可行路径”；第二种才是同等研究质量下减少工程工时、无效作业和交接成本。两种价值应分别证明。不能以更多自动提交的 Job 充当效率，也不能将所有负结果计为有价值知识：它必须排除一个明确假设，改变下一步选择，或使客户接受停止。

## 4. 五个客户场景

### 场景 A：从已有 routed DB 推进 setup/hold closure

- **客户输入：** 只读 `.enc.dat` 和 restore script、Site profile、源 manifest、完整且获认可的 STA scenarios/库/约束、目标与资源预算。客户已经有设计资产，任务是推进它，而不是从 RTL 重做全部流程。
- **Hima 承担：** 在 Campaign 副本恢复 DB；export、StarRC、PT 获取 baseline；Agent 根据 endpoint 群和前次动作提出有类型 plan；XTop 给 ECO，Innovus 回灌/布线；fresh extraction/PT 后比较 fixed、remaining、entrant、regressed，保留 best DB。
- **人类判断：** scenarios/SDC 是否覆盖业务需求；允许的优化动作和 area/power/DRC guardrails；是否接受带剩余 violation 的停点；任何“timing clean”是否足以进入客户自己的签核流程。
- **产出：** `best.enc`/`best.enc.dat`、相应 netlist/DEF/SPEF/PT reports、plan/ECO、endpoint delta、完整条件和 unresolved boundary；不是仅一张优化后 WNS 截图。
- **KPI：** refreshed setup/hold WNS/TNS 和 violation 数；固定 endpoint 集合的 slack 变化及 entrants；每个被接纳改善的许可小时；每轮时间、到收敛轮数、人工介入；best DB 可恢复率。
- **当前证据：** 方法与局部实现 E1/E2；trial25 为 E3 blocker，未执行完整一代；trial26 正在进行。**未证明真实 closure movement。**
- **最大风险：** 把 XTop 预测当最终 STA，或者只改善 worst path、遗漏新 entrant/hold 回退；容器、库、场景绑定不成立会先于算法收益阻断。

依据：[XTop SPEC][xtop-spec]、[endpoint compare 与 best DB 实现][xtop-compare]、[trial25 未到达范围][t25-unreached]。**建议：** 第一场客户价值演示只在真实完成并独立复核上述证据链后展示改善；在此之前称为受控工程验证。

### 场景 B：Custom Cell / Fmax DTCO 机会研究

- **客户输入：** 某设计的 RTL、时序约束、foundry library/物理技术与工具绑定，允许的 Cell 生成/研究范围，matched 对照条件，频率目标与预算。
- **Hima 承担：** 在免费研究中比较函数、结构、mapping、局部 timing 因子；Agent 根据 residual graph/frontier 和商业反馈编写下一轮算法；增量生成、布局、表征、库接纳；商业综合/P&R 检查实际采用与 matched Fmax；保留失败和 Library lineage。
- **人类判断：** 研究假设值不值得预算；生成 Cell 模型/布局的适用性；哪些约束不可牺牲；何时把探索候选交给正式 characterization、可靠性和签核流程。
- **产出：** 条件化的候选 Library、算法、需求/采用记录、商业对照、局限和下一轮可证伪问题。未证明的 Cell 不能作为 signoff IP 出售。
- **KPI：** matched post-route Fmax、endpoint frontier movement、实际采用/route survival、硬约束完整性；增量生成复用比例；每个有效 E0 的成本；连续停滞轮数和改变决策的负结果数。
- **当前证据：** trial24 为 E3 多代运行和有效负 Fmax；有限研究 Pack 提供数据依赖算法修正证据。尚无本次 Review 可确认的 +5% 目标成功、跨设计改善或硅验证。
- **最大风险：** 免费因子或 calibration accepted 被误当业务成功；通过缩小 demand 集合“改善通过率”；原有 frontier 的困难部分没有被解决；探索性 Liberty/几何被误当最终 IP。

依据：[Custom Cell INTENT][custom-intent]、[trial24 代际轨迹与集合缩小][t24-generations]、[探索性单元边界][aes-intent]。**建议：** 演示一条“负结果如何具体改变下一次算法/候选”的证据链，比展示候选数量更能证明研究能力；仍须另设真实 QoR 成功门。

### 场景 C：新 Site / 新设计 onboarding

- **客户输入：** 既有 SSH/本机访问授权、允许读写根目录、人工确定的并发/许可上限、工具入口、设计/库/约束和选定 Pack。CAD 提供环境事实，研究工程师提供任务。
- **Hima 承担：** 发现环境、读取 Pack 条件、提出绑定和缺项、保留人工政策、执行最小必要能力检查；形成具体 proposal 后由人确认，再创建有身份的 Campaign。
- **人类判断：** PDK/数据授权、资源分配、允许操作、工具/scenarios 的适用性，以及缺失适配由谁负责。
- **产出：** 可重复使用的 Site/Permit、Pack 适用性结论、版本/输入身份、缺项及责任人、一次真正有效的首工具动作。
- **KPI：** time-to-first-valid-action；配置往返次数；人工改 YAML/开发者介入次数；准入后首节点失败率；新设计/Site 适配工时和方法文件改动量。
- **当前证据：** 有 E1 discovery/preparation 实现；trial25 E3 显示静态 fit/preflight 不足且需要人工修配置。无“新客户无需开发者即可迁移”的证据。
- **最大风险：** 把探测出的硬件上限覆盖人工配额；fit 与实际可执行性混淆；错误 UI 无出口，客户被迫修改内部文件。

依据：[Preparation 要求][definition-prep]、[Site discovery][site-code]、[trial25 admission][t25-admission]、[当前 rediscover 分支][rediscover-code]。**建议：** 以另一位工程师在受支持的新环境中完成一次最小业务动作作为 onboarding 验收，不能只演示环境卡片变绿。

### 场景 D：跨工具长期 Campaign、跨角色介入和恢复

- **客户输入：** 多日工程目标、固定方法/输入身份、Site 与预算、可接手人员、计划停止点和资源责任人。
- **Hima 承担：** 单 owner 推进；机械设施保管在途 Job 和硬约束；工程师在 Side Talk 做其他 Coding；节点暂停/修正，安全边界显式 handoff；恢复时核对原 Job 和产物，复用仍有效结果，输出可交接资产。
- **人类判断：** 范围是否变化、实验是否值得继续、超出授权的动作、现场基础设施故障处理以及最终结果接受。
- **产出：** 连续的 Run/Job/代码/策略历史、可验证控制回执、恢复说明、未解决事项、足以由其他角色继续的报告和材料。
- **KPI：** 非业务必要的人工介入次数/时长；重复提交和重复工具小时；从中断到安全继续时间；有效结果复用率；接手者重建上下文时间；控制请求到确认停止/确认 Job 退出的时间。
- **当前证据：** trial24 在安全边界完成一次 owner handoff；L2 恢复用例覆盖某些历史与不确定状态；尚无 1–2 周客户多角色连续使用和完整故障矩阵的价值实测。
- **最大风险：** Agent 因上下文或错误理解授权而停止推进；界面显示取消但现场进程尚存；多 Home/外部作业超出本地资源计数范围。

依据：[ADR-0008][adr8]、[owner 实现][owner-code]、[trial24 handoff/停顿][t24-handoff]、[Job 资源范围][cap-code]。**建议：** 以原 Campaign 的连续性及恢复成本验收，不能用“再开一个成功 Run”替代恢复。

### 场景 E：普通工程 Coding 与受控小研究

- **客户输入：** 本地工作区、获准样本、要解决的小问题，例如从 timing 报告提取 endpoint 表，或有限候选冲突消解。
- **Hima 承担：** 对话澄清、编写执行代码、展示真实输出和文件；需要业务判定时使用已有研究 Pack 的 Reader/规则。
- **人类判断：** 接口语义、测试/对照是否充分、代码能否进入正式工程；普通 Bash 的结果不能自动冒充 Campaign 证据。
- **产出：** 可阅读和执行的程序、输入/输出、错误说明；有限研究可交付独立 Reader 复核结果。
- **KPI：** 首个有效产物时间、一次修正后的独立正确率、人工编辑/介入、结果定位时间。
- **当前证据：** 旧试用版手册有对话/文件/Python 实跑记录，有限 AES 两代研究有可追溯结果；不是所有语言和任务都已验证。
- **最大风险：** 只有通用 coding 体验却无法引导到业务 Pack；客户看不见与现有编码助手相比的增量价值。

依据：[手册能力范围][handbook-bounds]、[有限研究 TEST][aes-research-test]。**建议：** 将此作为无 EDA 入门和 Side Talk 能力，不作为芯片客户主要购买理由。

## 5. trial24、trial25、trial26 对价值叙事的实际影响

### trial24：研究循环成立，效果目标未达成

**事实。** App 源 `7a054151...`、Custom Cell Pack 5.2.10、`aes_cipher_top`、12 小时时限、最多八代。前七代结束，第八代在 `pnr-foundry` 期间耗尽预算。第七代比较有效，foundry 1773.05 MHz、generated 1721.17 MHz，实际采用 374 个实例，Fmax −2.92599%。最终 Judge 正确区分 comparison valid 和 fmax improved；第七代失败后进入第八代。[trial24 身份与数值][t24]

**重要口径校正。** 报告代际表还在第一代列出 −3.92%，但同一报告将第七代称为唯一完成的 matched pair。本次本地 Ledger 检查也只找到该 Campaign 的第七代 `read-compare` observation。因此本文不把第一代表中数值计为第二个完成的商业对照样本，不计算跨两次 E0 的改善趋势。[代际表][t24-generations] [保留 compare][compare]

**解释。** 机制价值包括真实反馈驱动的多代推进、失败没有伪装成成功、owner handoff 和 budget closure。效果上仍是目标失败。第七代 38/38、第八代 7/7 的 calibration acceptance 来自需求集合缩小，不是原 42 项困难全部解决；这种策略可以合法，但必须让客户看见删去了什么及为何有助于原 Goal。[需求集合变化][t24-demands]

第七代保留数据还记录 frontier reference 128、resolved 8、remaining 120、entrant 0，同时 Fmax 下降。**这是局部 endpoint movement 不能替代全局效果的具体例子。** 同一文件有 `full_constraint_failures=1319` 与 `cell_checker_diagnostic_count=216957`；本次没有解析其详细类别，不将它们解释为某种特定签核缺陷，也绝不因 `verification_error_count=0` 宣称全约束干净。[compare facts][compare]

**后续已修复的历史缺陷。** 第四代未写新 `entry.py` 却使用旧程序的问题，在 App trial.16 已加入当代代码要求，并保留 24/24 Host 子集、构建和打包验证。当前代码按 generation/loop/attempt/branch 选择记录，不得将这个问题继续笼统列为“当前仍未修复”；同样，低层修复不等于新的完整 DTCO pilot 已通过。[修复记录][fresh-fix] [当前实现][fresh-code]

**仍待加强的产品边界。** 第七代曾因误解已有授权而等待一句“continue”；第八代严重 I/O 阻塞报告中，预算到期发出了 kill，但 OS 进程仍存活数分钟。本次没有重新确认现场根因；按报告可区分环境故障与 Pack 缺陷。不过客户仍需要从产品知道是否在耗资源、取消是否仅已发送、许可证是否真正释放。环境不是产品能保证修好的，但对它的可观测性是产品责任。[handoff/停顿/I/O][t24-handoff]

### trial25：准入成立不等于一次有效业务动作

**事实。** Pack 1.0.0 的 4/4 inputs、五项许可声明、source manifest、DB 和 profile 检查通过；第一项 Innovus export 仍因容器不转发 `WORK_ROOT/CURRENT_DB/DESIGN/EXPORT_ROOT` 失败。报告记录一次真实 Innovus 启动和约 14.676 秒许可计时；未到 Workshop/XTop/ECO/endpoint compare。没有 closure 结果。[admission][t25-admission] [根因与未到达范围][t25-root]

**解释。** 这既削弱“拿到 Pack 就能顺利复现”的近期叙事，也验证了保留失败和禁止在运行中偷换方法身份的价值。把错误复现成低成本测试、修改 Pack 而不改共享 `edarun`，是合理的修复归属。当前 main 已有 `2215161` 的 Tcl 参数固化及 1.0.1；但真实工具端修复成功仍待 trial26，不能停在 4/4 单测就宣布交付业务能力。[修复源码][xtop-fix]

**试用报告需要源码交叉核对。** F1 报告称 Rediscover 自动写入并丢 bindings；当前源码实际有“预览 → Save reviewed Site”，且省略 ssh 的 reuse 分支保留 bindings。因此“所有 Rediscover 都丢绑定/不经确认写入”不是本 Review 确认的当前事实。可信且需修复的较窄问题是：现有 discovery 重建 capacity/forbidden，rediscoverInput 没有携带人工配额和额外 forbidden；试用也确实记录了人工改配置。具体丢 bindings 路径应带原版本/调用参数再复现。[报告 F1][t25-f1] [当前 discoverSite][rediscover-code] [discovery 默认值][site-code] [UI review/save][rediscover-ui]

F2 的初始文件读取错误则有当前源码支持：读取失败会设置 error，但 `draft === undefined` 分支只显示 Reading，遮住错误出口。应作为清晰的小切片修复，而不是重做配置系统。[读取错误][config-error] [loading 分支][config-loading]

### trial26：正在进行，不能被借用为成果

**事实。** 读取到的 checkpoint 记录 Pack 1.0.1 安装并建立 Campaign，状态 RUNNING，当前 `prepare`；没有终局报告。checkpoint 还提出 development Pack 替换入口和旧资产接续的问题。这些是操作者的进行中反馈，尚未独立复现，不能提升为已确认数据丢失或完整系统缺陷。[checkpoint][t26]

**解释。** 它支持“下一验证已启动”，不支持“trial25 修复已真实闭环”或“XTop 已有 timing 改善”。方法安装接口本来就明确保留 run-assets 和旧方法，故应先检查 UI 入口到现有接口的覆盖差距；操作者手工绕过入口的体验不能自动代表全部迁移实现失效。[安装语义][install-code]

## 6. 当前产品总评

| 类别 | 判断 | 证据与边界 |
| --- | --- | --- |
| 已证明（限定条件） | 真实 DTCO Campaign 可形成多代反馈、有效负结果、一次安全 owner handoff 和预算结束 | E3，trial24；不证明无人工照管或正向 QoR |
| 已证明（有限研究） | Agent 可以根据真实反馈修改数据依赖算法，并通过独立读数检查 | 有限 AES 两代记录；不证明可制造性或物理优化 |
| 部分证明 | owner/epoch、资源约束、重启恢复、知识身份/归档、Desktop 同屏控制 | 当前代码/定点测试及部分试用；不能外推所有故障和用户群 |
| 部分证明 | Pack 方法与客户 Site 分离，理论上可迁移 | 有合同和真实绑定，trial25 暴露边界；没有第二客户自助迁移对照 |
| 未证明 | routed DB timing closure 的真实端到端有效改善 | trial25 首节点失败，trial26 仍进行中 |
| 未证明 | 正向 DTCO ROI、稳定 +5% Fmax、减少许可证小时、替代跨域团队 | 缺效果样本和人工/脚本对照；5% 是特定 Campaign 目标 |
| 未证明 | 数周长期知识复用让后续研究更好；商业规模交付与留存 | 有存储、引用及测试，不等于长期效果和客户采购意愿 |

依据汇总：[trial24][t24]、[有限研究][aes-research-test]、[恢复测试][recovery-tests]、[知识测试][knowledge-tests]、[产品验收边界][definition-acceptance]。

**系统性短板的判断是：验证覆盖在“方法内部”较强，在“真实环境边界”和“普通客户接手”仍薄。** trial25 的 container 传参、Site policy、配置错误共同指向这个问题；trial24 的停顿和旧代码复用说明光有执行图不足以保证每轮新的研究贡献。这是需要补齐的质量面，不构成重写架构的理由。[trial25][t25] [trial24 findings][t24-demands]

另外，资源限制目前针对一个 Host/Home 的 Ledger 内已知 Jobs；不能把它宣传为对外部 EDA 用户、其他 Home 或全公司的公平许可调度。Knowledge 的当前文本检索实现是词项/短语计分，有身份校验价值，但它本身不证明深层技术匹配或跨语言召回质量。[资源范围][cap-code] [检索实现][search-code]

## 7. 让客户看见价值的 P0/P1/P2 工作

以下均为建议，不表示本次已修改产品或授权新 Campaign。成本为相对估计：低＝现有单模块/文档和本地验证；中＝相邻模块加关键 UI/依赖检查；高＝真实多工具 pilot 与领域复核。开始实现前按 issue tracker 建立具体切片，并依现有纪律先复现；未确认反馈先查明，不先改代码。[现有模块地图][discipline]

| 优先级与工作 | 现有修改落点 | 验收证据 | 客户可见变化 | 成本/风险 |
| --- | --- | --- | --- | --- |
| **P0：完成 XTop 1.0.1 的最小真实闭环** | `packs/xtop-timing-closure/flow/closure.py`、四个 Tcl、已有 tests/graph/readers；当前 trial26 由原 tester 继续 | 先精确验证原 export failure，再完成一次 baseline→ECO→fresh STA→compare，独立恢复 best DB；报告 pass/fail/未达阶段。若失败，先最小复现再修 | 第一次拿到可复核的 timing 优化产物，而非绿图 | 高；许可证与物理工具格式/场景差异；不为演示另开重复 Campaign |
| **P0：Site 实测事实不覆盖人工政策** | `sites.ts`、`index.ts` 的 discoverSite/rediscoverInput、`ConfigurationPage.tsx` 与既有 Site tests | 用已保存的更严格容量/forbidden/bindings 做 L2 反例；L3 展示 rediscover 差异和保存；人工限制未经明确修改不能扩大 | 重新探测可安全使用，CAD 不必事后手改 YAML | 中；权限真实性，需要关键边界复核 |
| **P0：配置失败给可行动出口** | `ConfigurationPage.tsx` 初始 read error、`campaign-file.ts` 字段提示、既有 host/desktop tests | 非法 budget 键时有限时间内看到确切字段错误和修复入口；有效恢复后可准备；不新建 Run | 从“永远 Reading”变为知道怎样继续 | 低；保持旧文件，不自动悄悄修值 |
| **P0：把准入结论分清楚** | `packs.ts::checkPack`、`index.ts::preparation`、XTop Site wrapper/最小 probe、配置视图 | UI 分别显示声明匹配、文件/权限检查、真实 wrapper/工具检查的时间/身份；容器去环境变量反例在低层失败；一次最小 L4 确认 | 客户理解 ready 的边界，少花一次完整试验才发现入口不通 | 中；检查自身也可能耗许可，应有明确范围 |
| **P0：复现并收口 development Pack 安装/资产接续** | `release.ts::installPackMethod/previewPackTransfer`、`client/PackOwnerPanel.tsx`、已有安装入口 | 先重现 trial26 checkpoint 反馈；以保留旧 Run/方法/资产的本地升级与中断回滚验证；L3 通过支持入口完成，不删除客户目录 | 换修复版本后仍能打开旧研究，避免人工搬目录 | 中；历史身份/资产完整性高风险；不能把进行中反馈当已确认数据丢失 |
| **P1：一页业务结果与证据状态** | `experience-report.ts`、`record-views.ts`、`client/CampaignTab.tsx`，Pack 原有读数 | trial24 negative、trial25 blocked、完整正/负结果各保留准确口径；Goal、best、endpoint、成本、未知都有来源；L2 数据投影+L3 阅读 | 先看到“目标是否推进、花了什么、哪些可复用”，再下钻节点 | 中；不让新摘要成为第二事实源 |
| **P1：DTCO 每代展示研究增量和困难保留** | Custom Cell `research-template.py`、`flow/ai_research_runner.py`、现有 research knowledge/readers | 展示前代证据→假设→当代代码 hash→变化的 demand/frontier→E0；缩小集合须有明示理由；已有 freshness 修复保持回归 | 38/38 不再掩盖原 42 项问题；客户能判断 AI 是否在研究 | 中至高；不能为提高 through-rate 降低固定 Goal，也不把 proxy 偷换成硬门 |
| **P1：运行停滞、控制与实际资源分开显示** | `jobs.ts`、`budget.ts`、`record-views.ts`、现有节点卡/诊断 | 受控 L2 停滞/断连/kill 未确认反例；最小 Site 验证显示 requested/acknowledged/job still present/unknown；代际授权等待有可解释原因 | 工程师知道该等、介入、联系 CAD，或确认作业确已退出 | 中；未知不能自动判死；不能建立第二执行 Agent |
| **P1：新工程师完成一次新绑定** | `docs/user-guide/evaluation-handbook.md`、现有管理员交接卡、Site/Preparation 与一个既有 Pack | 固定受支持版本，非原作者从交接卡完成首有效动作；记录人工工时、配置往返和 method diff；失败保留 | 可估算客户导入成本，区分方法可迁移与数值可复现 | 中至高；先同等受支持环境，不扩大为任意平台承诺 |
| **P1：为成本建立同口径基线** | 既有 Ledger/meters、`experience-report.ts` 和评估记录表 | 一项人工/合格脚本基线与 Hima 任务使用同输入、工具、约束、预算；记录双方的操作时间、资源和有效结论 | 客户能计算花费与获得的工程能力，避免只比较节点数 | 中；任务难度不同、人工熟练度和失败删样会扭曲对照 |
| **P2：历史知识复用的实证** | `experience.ts::listRunKnowledge`、`workshop.ts`、现有 Pack knowledge | 第二个相关任务明确引用前次负结果/算法，解释适用性，并以当前试验验证；比较无需重复的工作与错误引用 | 客户看见前次投入如何帮助下一次决策 | 高；过拟合旧设计，检索命中不等于有用 |
| **P2：规模与可移植性样本** | 既有两个业务 Pack、Site profiles、方法升级/迁移入口 | 第二设计与第二个同等受支持 Site；列明适配工时、变更、失败和重新验证范围；至少另一位工程师审阅 | 更可信的采购范围和维护成本 | 高；先收敛 P0，不新增 Pack 平台或许可调度服务 |

这些工作沿用已有执行主体、权限层级、固定 Pack 和客户资产规则。普通 Coding 的 Full 权限不能用来绕过 Site Permit 后再把输出纳入受控 Campaign；知识迁移也不能默认外发客户资产。[权限 ADR][adr9] [知识归档 ADR][adr4]

## 8. 客户演示与试用组合

### 30 分钟：价值发现，不等待一轮 P&R

**前提：** 准备固定版本 App、获准的本地样本和去敏的已归档证据；原始客户材料默认留在现场。旧评估手册可复用阅读、Coding、控制练习，但其版本是 v0.2.0-trial.1，演示前必须更新所用版本与入口，不能直接宣称是当前手册。[手册基线][handbook]

| 时间安排 | 给客户看的内容 | 必须展示的证据 |
| --- | --- | --- |
| 0–5 分钟 | 从客户一项真实任务和约束选择 Pack，说明输入与适用范围 | Pack/版本、Site 条件、目标、未知与人类责任 |
| 5–12 分钟 | 一个保留 Campaign 的“问题→策略→实际结果” | 原始报告、代码/输入身份、Judge；必须包含一次负结果或 blocker |
| 12–20 分钟 | 一次廉价的有限样本或普通 Coding 修正；从对话打开产物 | 真正执行的程序和输出，能由客户检查；旧记录回放明确标注 |
| 20–26 分钟 | owner、Side Talk、控制与恢复的已有证据或受控本地场景 | 明确谁可执行；请求与实际状态分开；不对正在运行的生产 Campaign 做演示干预 |
| 26–30 分钟 | 客户确定哪项工作值得一天试用 | 可交付物、预算、KPI 与 stop 条件的简短试用卡 |

**不能承诺：** 30 分钟获得真实物理收益、自动适配任意 Site、无人值守或替代签核。**通过标准（建议）：** 客户能自行指出一个产出、一个证据来源、一个未知和一项下一步工程决定。不是“看完觉得 UI 很强”。

### 1 天：工程可用性试用

**前提：** Site/许可证已预约，使用现有 Pack 支持的设计和固定工具链；一天是活动窗口，不保证所有工具在一天内结束。上午由非原作者完成输入绑定和最小有效工具动作，下午完成一个足够小的研究闭环并阅读交付物。若 XTop 真实最小门尚未通过，则用有限研究 Pack 完成反馈闭环，并将 XTop 仅作为工程验证，不替换成模拟成功。

**必须展示：** 输入/方法身份；真实 wrapper 检查；一次 Agent 数据依赖工作；一次独立 Reader/Judge；明示的 Goal/result/未完成范围；客户自己能找到代码、原报告与产物；操作工时、人工求助、工具与许可计时的原始记录。[测试层级][testing] [真实试用准备][handbook-trial]

**不能承诺：** 单日普遍 QoR 成功、跨客户迁移完成、长期学习已有效。**退出判断：** 可进入受控长 Campaign，或给出精确阻断及适配责任；不以后台工程师替用户补完后宣布“自助通过”。

### 1–2 周：真实 Campaign 与客户接受

围绕客户的一项真实目标，在开始时冻结输入/场景、目标、硬约束、预算及人工基线。优先完成 routed DB 的数轮 endpoint closure；若选 DTCO，则目标与探索性 Cell 边界单列。计划一次安全节点交接/恢复、一次相关历史引用；实际未遇到的故障另用廉价定点验证，不为录像制造昂贵事故。

**必须展示：** 每轮计划依据与 refreshed results、负结果如何影响下一轮、已消耗与剩余预算、保留 best 产物、一次连续 Run 的交接/恢复证据、独立工程师复核、完整成本对照。改善需满足事先声明的 guardrails；如果目标未达成，只有当客户接受一个由有效证据改变的工程决定时，才计为“有用的研究结论”，不能计成“admitted improvement”。

**不能承诺：** 必达 +5%、所有 endpoint 清零、无人介入、签核完成或普遍压缩团队规模。**退出交付：** 客户能恢复/复核的产物或明确的停止结论、剩余限制、完整账本，以及“值得继续/需要适配/不适用”的决定。上述都是建议试用标准，当前没有这些多周实测结果。[产品验收责任][definition-acceptance] [评估评分与客户判断][handbook-score]

## 9. 指标：从活动量转向客户接受的工程结果

**建议的平台北极星：在声明质量、权限和资源边界内，每个工程师投入小时形成的、经客户复核接受的有效工程决策/交付物数量。** 必须同时报告任务类别、结果类型和证据完整性，不能把容易的 Coding、小样本选择与一次物理 closure 混成一个漂亮总数。降低操作工时不是牺牲物理结果或将工作转移给幕后 CAD 的理由。

“有效”至少包括：具体决策/交付物；来源可回查；所有必需验证已完成或未知被准确保留；客户确认可用于下一步。分开统计 **admitted improvement**（真实测量改善并满足 guardrails）、**accepted negative finding**（支持停止/改方向）、**blocker diagnosis**；前两类分别列为北极星分子，第三类只列为支持服务成果，不进入该分子，不能不断失败却积累成优化成功数。当前尚无平台北极星基线。

| 指标 | 可执行定义与采集方式 | 不能怎样使用 |
| --- | --- | --- |
| time-to-first-valid-action | 从客户开始准备到首个输入/方法身份正确、真实工具输出被 Reader 接纳的动作；同时给 onboarding 全时长和 ready 后时长 | 首次启动模型、工具进程或 Pack fit 不算；不删掉失败准备时间 |
| human interventions | 每 Campaign 人工干预次数、分钟、原因：业务判断/授权、环境问题、产品救援、无谓催促分别记录 | 必要判断不是产品失败；幕后手改配置必须计入 |
| license-hours per admitted improvement | 分工具累计本次所有尝试的 seat-hours ÷ 满足 guardrails 的被接纳改善数；等待/运行/挂起分列 | 当前 `licenceMs` 是产品计量，应核对真实占用；零改善时写“无改善，已耗 X”，不可给零成本 |
| iterations to convergence | 按 Pack 明确的完整测量轮计数，到 goal-met 或预声明稳定条件；同时列预算截断、阻断 | calibration 次数不能全部当商业迭代；converged 不等于 clean |
| restart/recovery cost | 中断至安全恢复所需墙钟/人工时间、重复工具小时、丢失或不可再用材料量 | 新建成功 Run 不能掩盖原 Run 的恢复失败 |
| endpoint closure movement | 固定 scenario/mode/group/endpoint 键的 fixed、remaining、entrant、regressed 与 slack delta；附 WNS/TNS/violation counts | 修复数量不能替代最差值、hold、约束覆盖和新 entrant |
| evidence completeness | 任务所需证据清单中可读、身份匹配、阶段/条件正确的项目比例；关键缺项有独立 blocker 标记 | 不以大量次要文件把必需缺项平均掉；hash 不等于正确性 |
| Pack portability/adaptation effort | 新设计/Site 从绑定到首有效闭环的工程小时、配置/方法改动量、需作者介入次数和失败分布 | 仅编辑 Site YAML 就宣称零适配；未跑环境不进入成功分母 |
| knowledge reuse effectiveness | 被下一任务实际读取、说明适用性并影响决策的资产；记录避免的重复工作和错误引用 | 检索命中数、归档文件数、token 数不等于研究价值 |
| customer acceptance / audit time | 非原作者理解并复核结果至作出决策的耗时与退回原因；记录最终是否接受 | Agent 自述不能替代客户签收 |

**Pack 级指标。** XTop 以所有声明场景的 fresh STA、endpoint delta、best DB 可恢复性、guardrails、每次接纳改进的资源成本为主。Custom Cell 以 matched Fmax、实际采用与 route survival、frontier 变化、需求集合/Library 增量 lineage、有效 E0 成本为主；代理分数和 calibration 是解释变量。AES 有限研究以独立 Reader 的 score/冲突/预算为主。OpenE902 probe 以真实 DC QoR、period 探索边界和正确结束语义为主。所有指标必须写明版本、设计、Site、工具/场景及统计分母。[XTop 语义][xtop-spec] [Custom Cell 观测边界][custom-intent] [有限研究判据][aes-research] [probe 合同][e902]

## 10. 客户为什么买业务能力；双重 lock-in 怎样才成立

**解释。** 客户要的是“这个 routed DB 的 timing 怎样推进”“这项 Cell 假设是否值得投入”“这个研究能否由下一位工程师接手”，并愿为可靠产出、扩大可做任务范围和降低总工程成本付费。Harness 的通用聊天、工具调用和图本身不足以回答这些问题。Pack 与客户环境之间适配得好、Agent 能在证据上工作、结果能交付和审查，才构成购买理由。[业务能力与知识资产定义][context]

“双重 lock-in”适合作为**待验证的留存机制**，不是已经建立的护城河：

1. **方法与环境的积累。** 客户认可的 Pack 方法、工具/场景适配、测量/判断规则、Site 政策及团队工作习惯形成一套已验证的工作方式。换平台需要重新连接和验证这些工程关系。价值来自可靠业务能力，不能来自不透明格式或阻止迁移。
2. **客户自身研究资产的积累。** 设计条件、算法、失败、Commercial Labels、可恢复 DB 和适用性经验不断形成后续任务的输入。替换工作方式的成本在于重新建立可解释、可信任的使用关系；不是供应商占有客户数据。现行定义要求客户控制资产、同客户升级保留、迁移可携带、对外分享明确选择。[资产规则][definition-assets] [归档与迁移 ADR][adr4]

这两个机制可能相互增强：更好的方法产生更有用的证据，更多有效经验帮助选择下一次方法。但仓库还没有“积累后研究更快/更准、客户愿意持续购买”的长期对照，不能将结构上的可能性写成商业事实。升级/安装断点反而会破坏这种积累；透明导出、历史方法可读和迁移可验证应加强信任，而不是被当成降低 lock-in 的问题。[固定方法/旧 Run 解析][install-code] [trial26 进行中反馈][t26]

**下一步最有说服力的价值证明：** 在不干预当前 tester 的前提下，先由 trial26 给出 XTop 原 blocker 的真实修复结果；若通过，在客户认可的 routed checkpoint 上完成至少一轮 full refresh，交付能独立恢复的 best DB 和 endpoint 变化，再以第二轮证明反馈影响了计划。由另一位工程师在产品中独立解释、复核并接受结果，完整记录人工与工具成本。同一证据包必须能回答“是否改善”“是否值得继续”“下个人如何接手”。如果没有改善，诚实的停止/改方向仍可证明研究服务价值，但还不足以支持“timing optimization 已有效”的承诺。

## 证据索引

所有路径指向本次审阅工作区；动态 `.hima-tmp` 文件需结合文内冻结时间和 Run ID 阅读。未使用外部行业统计或二手资料。

[definition]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/product-definition.md:5
[definition-prep]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/product-definition.md:58
[definition-assets]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/product-definition.md:43
[definition-acceptance]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/product-definition.md:65
[context]: /Users/lluzi/code/hima_harness_reforge_polishing/CONTEXT.md:7
[discipline]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/agents/polishing-discipline.md:35
[testing]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/testing-strategy.md:16
[adr8]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0008-visible-campaign-agent-and-side-talk.md:7
[adr9]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0009-dsh-permission-does-not-bypass-site-permit.md:7
[adr4]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/adr/0004-archive-run-knowledge-inside-pack.md:7
[packs-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/packs.ts:2538
[identity-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/index.ts:331
[owner-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/fabric.ts:2028
[cap-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/job-cap.ts:21
[assets-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/experience.ts:715
[judge-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/judge.ts:149
[desktop-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/client/HimaWorkbench.tsx:1
[site-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/sites.ts:188
[rediscover-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/index.ts:737
[rediscover-ui]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/client/ConfigurationPage.tsx:456
[config-error]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/client/ConfigurationPage.tsx:291
[config-loading]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/client/ConfigurationPage.tsx:411
[install-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/release.ts:550
[recovery-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/recovery.ts:96
[recovery-tests]: /Users/lluzi/code/hima_harness_reforge_polishing/test/contract/agent-recovery.host.test.ts:63
[knowledge-tests]: /Users/lluzi/code/hima_harness_reforge_polishing/test/contract/knowledge-reuse.host.test.ts:80
[search-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/workshop.ts:1160
[custom-intent]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/custom-cell-fmax-dtco/INTENT.md:1
[custom-test]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/custom-cell-fmax-dtco/TEST.md:1
[xtop-contract]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/xtop-timing-closure/contract.yml:1
[xtop-doc]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/package-development/xtop-timing-closure-pack.md:5
[xtop-spec]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/xtop-timing-closure/SPEC.md:1
[xtop-compare]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/xtop-timing-closure/flow/closure.py:600
[xtop-fix]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/xtop-timing-closure/flow/closure.py:273
[aes-research]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/aes-timing-research/INTENT.md:1
[aes-research-test]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/aes-timing-research/TEST.md:17
[aes-intent]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/aes-tsmc28-dtco/INTENT.md:35
[aes-test]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/aes-tsmc28-dtco/TEST.md:1
[e902]: /Users/lluzi/code/hima_harness_reforge_polishing/packs/opene902-timing-probe/contract.yml:6
[backlog-probe]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/polishing-backlog.md:41
[handbook]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/user-guide/evaluation-handbook.md:5
[handbook-bounds]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/user-guide/evaluation-handbook.md:84
[handbook-model]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/user-guide/evaluation-handbook.md:104
[handbook-site]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/user-guide/evaluation-handbook.md:333
[handbook-trial]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/user-guide/evaluation-handbook.md:288
[handbook-score]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/user-guide/evaluation-handbook.md:372
[t24]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/validation/trial-release/2026-09-21-trial24-result-review.md:3
[t24-generations]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/validation/trial-release/2026-09-21-trial24-result-review.md:37
[t24-demands]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/validation/trial-release/2026-09-21-trial24-result-review.md:86
[t24-handoff]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/validation/trial-release/2026-09-21-trial24-result-review.md:114
[fresh-fix]: /Users/lluzi/code/hima_harness_reforge_polishing/docs/validation/trial-release/2026-09-21-app-trial16-build-receipt.md:8
[fresh-code]: /Users/lluzi/code/hima_harness_reforge_polishing/packages/harness/src/node-turns.ts:1068
[t25]: </Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/Agent Trial Report v25.md:3>
[t25-admission]: </Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/Agent Trial Report v25.md:41>
[t25-f1]: </Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/Agent Trial Report v25.md:71>
[t25-root]: </Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/Agent Trial Report v25.md:120>
[t25-unreached]: </Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/Agent Trial Report v25.md:218>
[cycle]: /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/improver-tester/cycle.json:5
[t26]: /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/improver-tester/tester-checkpoint.json:2
[compare]: </Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.15/Trial Data/dsh/hima/packs/custom-cell-fmax-dtco/run-assets/.evidence/run-adf41cad-660b-41fc-99b0-bfc23d2c4c99/063e97502e2ccc55adb5cf008ca8d806b8dc02cd2e45b6cd10a4a70961a68352.dat:23>
