# Durable engines evidence packet — Temporal / DBOS TypeScript / Restate

研究员 lane；root 是唯一综合者。本包是官方资料和小量固定源码的静态研究，未安装、启动、运行候选/Hima/模型/EDA/测试。核对时间：2026-10-02 PDT（UTC 2026-10-03 04:46–04:51）。F=官方事实，I=Hima适配推论，U=未验证。产品源码基线 77223fe；future研究HEAD d540d9de。

## 判断先行

三个候选都值得研究“唯一执行持久化权威”的形态，不能因为它们有journal就判定不合适。它们都能保存已完成步骤结果、恢复确定性流程、异步等待和并行协调；**没有一个能仅靠引擎日志，让SSH启动/EDA设计写入在effect-before-ack窗口中自动exactly-once**。引擎解决的是进度/路由恢复的很大一部分，真实工具身份、unknown、成果/Reader/Goal与权限仍是Hima领域职责。

- **DBOS TS**：接入Node模块最短，但引入Postgres且要求确定性调用序列；MIT库与proprietary Conductor必须分开。适合比较“现有TS Host内的持久步骤”，不可将任意`runStep(ssh)`当安全发射器。
- **Temporal**：最完整的长程流程、异步Activity与部署版本能力；自托管服务/数据库和Worker运维代价最显著。适合用户接受服务型执行基础且真正需要长Run、多worker/远端异步协作时比较。
- **Restate**：单binary+嵌入持久磁盘的生产形态和按key序列化很有吸引力；服务端BSL是source-available。可以成为单一控制/执行状态authority，但Hima要通过请求进入Virtual Object，并承受旧endpoint保留和状态schema兼容成本。

本包没有新增第四候选：现有三者已覆盖服务集群、库+SQL DB、单binary+嵌入存储这三个决定性适配形态；无必要泛搜。

## 现行版本、许可与维护

| 组件 | GitHub最新release / 发布时间 | 固定release SHA | 许可与边界 |
|---|---|---|---|
| Temporal server | v1.32.0 / 2026-09-11 | d94e34a1ebba5410a2e7d07119a76896909591aa | MIT；Temporal Cloud不是该开源服务许可承诺 |
| Temporal TS SDK | v1.24.0 / 2026-09-15 | 1fd1c81a0383f5f5c7923dd735472c7d1ffdc867 | MIT |
| DBOS TypeScript | GitHub v5.2 / 2026-09-29；npm latest 5.2.11 | 3f36908f58fd8b3079cbf5372203c7a2d0ba06cc | MIT库；可选Conductor self-host是proprietary，需要license key，production需协议 |
| Restate server | v1.7.13 / 2026-10-01 | 5ab87a6b5eabb70d5ba09738e281edc69b6ae10e | BSL1.1，明确不是Open Source license；各版本发布4年后转Apache-2.0 |
| Restate TS SDK | v1.17.2 / 2026-09-21 | 734ab9cea65fe0efec7bc507c22f7ec8980bf737 | MIT |

来源：[Temporal server release](https://github.com/temporalio/temporal/releases/tag/v1.32.0)、[TS release](https://github.com/temporalio/sdk-typescript/releases/tag/v1.24.0)、[DBOS release](https://github.com/dbos-inc/dbos-transact-ts/releases/tag/v5.2)、[Restate server release](https://github.com/restatedev/restate/releases/tag/v1.7.13)、[TS release](https://github.com/restatedev/sdk-typescript/releases/tag/v1.17.2)。许可全文固定release snapshot保存在durable-raw；许可链接与检索时间在durable-sources.json。

F：五仓库最近默认分支commit均为2026-10-02，release并非仅历史包；这证明近期维护，不能证明生产无缺陷。Restate v1.7.13修复VQueues下Admin API对Virtual Object改state未应用到followers，leader更换后可能变回旧state；受影响多replica用户要升级并重提交state。这是能力承诺的实际反证，不是因近期bug而一票否决。DBOS v5.2包含conflict resolution与consistent resume修复。F：Restate BSL额外授权允许内部/自写workflow生产使用，并允许GUI/DSL/proprietary API抽象平台，限制直接允许第三方注册自己的Restate endpoint的public managed platform。I：Hima抽象平台可能落入允许项，但未来具体交付形态需按全文核验，不视为无限制再托管许可。[Restate LICENSE](https://github.com/restatedev/restate/blob/5ab87a6b5eabb70d5ba09738e281edc69b6ae10e/LICENSE)、[Conductor许可](https://docs.dbos.dev/conductor/self-hosting/hosting-conductor)。

## Temporal：完整可靠执行内核，成本移到服务与版本运营

F：Workflow是确定性普通控制逻辑，Activity承载外部非确定性工作。Activity输入、输出、重试属于历史，Child Workflow有独立完整history。`await activityResult`显式消费结果，分支和join可写进Workflow；它不是Pack YAML业务图解释器。I：可以把Hima节点的已验证结果作为明确值传给Judge/后续动作，删除“最后Reading”推断，但nodeId/executionId/generation/input/Reader摘要仍须进入payload，不会自动出现。Workflow函数调用/结果不自动声明Campaign Goal。[Activities](https://docs.temporal.io/activity-definition)、[Child Workflows](https://docs.temporal.io/child-workflows)。

F：保存completed Activity后，Workflow可重放历史中的结果并继续确定性路由；Activity内部任意机器指令/EDA过程没有逐指令持久化。默认Activity retry意味着at-least-once；官方明确Activity不是原子操作，推荐幂等。可把normal Activity设maximumAttempts=1取得at-most-once语义（可能0次），但不能由此证明外部effect发生与否。I：未知启动必须回查原Job，不自动另start；若一次调用中既launch又wait，崩溃会重试整次Activity，特别需要现有Site launch intent协议。[幂等说明](https://temporal.io/blog/idempotency-and-durable-execution)。

F：支持持久Signals/Updates、condition等待、Child Workflow与并行promise；异步Activity可将task token或namespace/workflow/activity ID给外部，Function返回后由Client heartbeat/complete。I：这很贴近Hima异步Job，不需Activity占着Node线程等EDA结束；但只有Reader验证后才能传业务结果，token receipt丢失须从Job身份核对。[Message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)、[异步Activity](https://docs.temporal.io/develop/typescript/activities/asynchronous-activity)。

F：Activity取消靠heartbeat接收，Workflow取消等待方式可显式选WAIT_CANCELLATION_COMPLETED；TRY_CANCEL可能Workflow先继续而Activity仍在执行，ABANDON更不发送取消。没有代码把cancel映射到SSH/OS进程终止就不会停EDA。最新API文档默认WAIT_CANCELLATION_COMPLETED，教程仍写TRY_CANCEL，资料不一致，因此必须显式设置并按固定SDK验证。[取消教程](https://docs.temporal.io/develop/typescript/workflows/cancellation)、[ActivityOptions API](https://typescript.temporal.io/api/interfaces/workflow.ActivityOptions)。I：human hold应Workflow中持久控制并在每次admission/route检查，Activity成功不能清hold；cancel完成也不等native Job quiescence。

F：新Worker Versioning可Pinned Workflow锁定一个Worker Deployment Version；Auto-Upgrade仍有determinism兼容负担，patch可作为另一策略。旧Run继续意味着保留可运行旧worker/bundle，不只是存version字段。TS Worker依赖真实Node，官方强烈不建议以其他兼容runtime代替。[Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)、[SDK README](https://github.com/temporalio/sdk-typescript/tree/1fd1c81a0383f5f5c7923dd735472c7d1ffdc867)。

F：开发CLI是一个无外部依赖binary，但官方把它定位本地开发；生产自托管需要Temporal Service和持久数据库/Visibility配置，Worker另运行。可全在本地自托管并离线执行，但无网络service形态并未变成嵌入JS库，备份/升级/监控/权限/故障域由Hima交付方承担。[Self-host](https://docs.temporal.io/self-hosted-guide)、[配置](https://docs.temporal.io/references/service-configuration)。I：完整采用成本高；局部adapter适合一个复杂工程action，但若Fabric仍为其内部步骤维护完整第二份可执行状态，减少维护量的优势会消失。设计借鉴收益：结果绑定、durable completion、固定旧代码与effect retry边界。

## DBOS TypeScript：库嵌入更近，但SQL状态和确定性序列是实价

F：DBOS库运行在现有TypeScript/JavaScript应用进程内，system DB需要Postgres；不要求专用durable server。workflow参数/结果可JSON序列化，step可`runStep`或注册函数；DBOS保存step返回值/异常，重启重跑workflow代码但跳过已保存step。非确定性time/random/file/API必须在step内。[Guide](https://docs.dbos.dev/typescript/programming-guide)、[Steps](https://docs.dbos.dev/typescript/tutorials/step-tutorial)。I：这与既有TS Host较近，仍新增数据库权限/schema migration、连接与备份，不是SQLite/文件内嵌替换。固定v5.2 package.json的engines为Node >=20；源码package version为构建占位符，不能当发布包版本，npm latest 5.2.11的gitHead正是该release SHA，engines同为Node >=20；元数据另存durable-raw/DBOS-npm-latest.json。本轮未主张任意Bun/Deno支持。

F：workflowID是启动去重身份；checkpoint实际按workflow UUID+递增functionID定位，检查functionName，不是按任意业务node名做缓存。已固定v5.2源码`src/dbos-executor.ts:907`取得funcID，`runInternalStep:1186`读checkpoint，`recordOperationResultInternal`与`checkOwner`在`src/system_database.ts:6277,6352`同事务验证owner token，并对workflow_status行加锁。I：可以成为唯一执行checkpoint authority，Hima通过固定payload保持node/execution/generation和证据引用；不能先让模型选择新route再回放旧序列。

F：steps at-least-once；事务exactly-once是具备DBOS事务协议/数据库范围的结论，不能延伸到SSH/文件设计改动。官方说明重启或control-plane误判时两个executor可能同时运行同workflow，zombie会在下次checkpoint失去ownership并停止。它防止旧owner写入后续checkpoint，不能让已经发出的外部非幂等效果倒退。关闭异常retry也不消除executor崩溃恢复重进未落账step。[Workflow guarantees](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)、[并发执行](https://docs.dbos.dev/explanations/concurrent-executions)。这是“库加DB即可省掉外部effect协议”的直接反证。

F：`send/recv`持久消息、setEvent/getEvent结果持久化、durable sleep、child workflow和queue均存在。并行启动step的序列必须确定；官方明确禁止两个async step链在同一workflow里交错，因为step2/4顺序取决于step1/3耗时。复杂并行应每支用child workflow，取各handle结果并join；不能直接照搬任意Promise结构。[Communication](https://docs.dbos.dev/typescript/tutorials/workflow-communication)、[Workflows](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)。I：Hima异质branch结果可以按child handle明确绑定，不需把join强制变成同题Judge，但图语义、invalidations仍要Hima写清。

F：cancel把status设CANCELLED并在下一step/checkpoint抢断；resume从已完成step后恢复，fork复制到指定step前的历史并产生新workflowID。step timeout是协作AbortSignal，忽略signal的函数继续后台执行、结果被弃，随后retry可能叠加外部工作。[Management](https://docs.dbos.dev/typescript/tutorials/workflow-management)、[Step reference](https://docs.dbos.dev/typescript/reference/workflows-steps)。U：最新网页提cancelSignal，固定v5.2执行源码本轮仅确认timeoutSignal，不把cancelSignal版本支持列为已证。I：取消/暂停都要保留Hima process kill/unknown和human hold；DBOS resume会恢复调度，不自动恢复业务授权。

F：applicationVersion默认workflow源码hash，恢复只捡同version；patch/deprecatePatch可兼容修改。旧Run继续要保留旧app版本执行器，fork/rewind不是无成本旧Run迁移且可能重做副作用。[升级](https://docs.dbos.dev/typescript/tutorials/upgrading-workflows)。F：最低自托管组合是一个已有Node应用/Host进程内嵌DBOS库，加一个Postgres进程/既有数据库服务，**无需Conductor即可自托管与同executor重启恢复**；不是SQLite嵌入库。官方production文档明确不需sidecar/operator或Postgres以外服务。固定v5.2 `dbos-executor.ts:389`启动调用`recoverPendingWorkflows([this.executorID])`，方法1264的默认executor为local。生产多executor自动探测死亡/remote管理由可选Conductor提供，self-host Conductor是proprietary。U：无Conductor、换executorID的自动故障转移接线本轮不当作无配置保证。I：若新增本地Postgres可接受，最适合先做“节点结果落账→确定性route”的对照；若不能新增DB，可仅借其owner fencing、step receipt和版本边界设计。

## Restate：单一按key持久控制很有价值，BSL与endpoint运营不能省略

F：Restate服务端单binary，嵌入state store持久磁盘；TS服务endpoint运行另一个进程/Host并通过协议被调用，SDK支持Node >=22及Bun/Deno。service、Virtual Object、workflow三个模型区别明确，workflow有唯一key及run，shared handlers可接外部事件。`ctx.run`记录非确定性结果，ctx service calls/state/timers等也记录journal。它仍是代码流程，非Pack图解释器。[Services](https://docs.restate.dev/develop/ts/services)、[Durable steps](https://docs.restate.dev/develop/ts/durable-steps)。

F：`ctx.run`包HTTP/DB等外部工作，已记录结果重放；失败默认会retry。官方数据库guide直接给出非幂等更新在query成功但Restate未见completion时可能重复，并分别展示版本条件写、同事务idempotency table、2PC等额外协议。ctx.run内部不能嵌套Restate context动作。I：EDA设计文件与SSH无该原子事务，仍需Site/Job固定effect ID+reconcile；“可靠RPC到另一个Restate handler”的去重保证不能套在任意外部命令上。[DB guide](https://docs.restate.dev/guides/databases)。

F：外部signals/awakeable/workflow promise可持久等待；RestatePromise.all/allSettled/any/race记录完成顺序保证replay确定性。I：适合异步Job完成/人类批准及branch join；明确返回结果数组可避免“最后observation”推断，结果业务身份仍由Hima保存。[Events](https://docs.restate.dev/develop/ts/external-events)、[Parallel](https://docs.restate.dev/develop/ts/concurrent-tasks)。

F：Virtual Object按key single-writer并且state与执行journal同consensus，适合把一个Run的控制/进度纳入唯一authority；state只有key范围事务、不能SQL update、必须经object请求修改。I：若Hima把human hold和route都放同Run key，而Ledger只保存不可变领域证据和投影，职责可清楚而非第二控制者；但Site跨Run job-cap不自然等于同一个Run key，另需保留Site admission原职责。exclusive handler等待awakeable会让该object其他调用排队；若把long Run全塞独占handler，可能妨碍hold/control，要按workflow/shared handler模型设计，不用再造控制系统掩盖这个错位。[State边界](https://docs.restate.dev/guides/databases)、[Events](https://docs.restate.dev/develop/ts/external-events)。

F：cancel为非阻塞、需endpoint可达、SDK在下一个await暴露TerminalError；ctx.run执行中取消在该block结束时抛出。detached send/delayed call即使caller取消仍运行；kill不执行补偿，不能保证外部效果/对象状态一致。pause/resume是引擎invocation控制，不证明外部process停止。I：必须映射现有Job terminate/check-quiescence、保存late completion事实、在routing前重新检查hold；不能把cancel API返回当EDA已停。[Invocation管理](https://docs.restate.dev/services/invocation/managing-invocations)。

F：immutable deployment endpoint pin每个invocation从始至终同版；新invocation用最新版。旧endpoint保持到in-flight全部完成，Virtual Object state跨版保留且schema必须兼容。手工resume到新deployment可能non-determinism errors；同endpoint force更新仅适合dev，旧Run可能失败。[Versioning](https://docs.restate.dev/services/versioning)。I：桌面升级若旧Run跨天，不可直接覆盖唯一Host service endpoint，必须保留旧handler或显式兼容；snapshot的Pack方法还需自己的版本锁。

F：single node+durable disk明确支持能容忍短停机、无高吞吐需求的production，fsync后再ack；server进程崩溃可重启，磁盘丢失不是其保证。无外部DB必要，但备份/security/upgrades仍是运营责任。server BSL与TS SDK MIT不能合称全OSI开源；本轮未核所有enterprise能力分界，普通single-node durable能力不靠enterprise推断。[Self-host overview](https://docs.restate.dev/server/overview)。I：用户接受一个常驻binary且许可交付可接受时，Restate是最值得与DBOS对照的服务形态；本轮不宣布替换Fabric，也不主张比它更可靠已经实测。

## A/B/C：故障对照与Hima保留责任

| 场景 | Temporal | DBOS TS | Restate | Hima仍须负责 |
|---|---|---|---|---|
| A EDA effect已发生，worker在结果落账前崩溃 | 未completion的Activity可retry；task/ActivityID去重只在引擎范围，需幂等外部effect或禁止重发并reconcile | 未checkpoint step可重执行；ownership fencing不撤销已经发出的SSH | 未journal run可retry；官方DB反例直认success-before-completion重复窗口 | 持久launch intent/effect ID，原Job/native状态与输入/方法核对，unknown不start第二份，Reader验真实产物 |
| B结果已保存，但graph routing前崩溃 | replay读原结果，确定性route可重算并产生一致commands | 重跑workflow读同funcID结果，确定性route继续 | replay读journal返回值/分支顺序，state/commands接续 | 若route只是纯流程这三者大幅帮助；若route又写Hima Ledger/更改generation，此写需固定commit身份幂等或移入同authority，不能跨两日志宣称原子 |
| C human pause/cancel与异步完成并发 | history有事件顺序，但业务hold要代码落实；取消与正在执行Activity可并行 | cancel撤销owner，checkpoint可被拒；已发生effect与late结果仍可能存在 | journal/context控制一致；取消只在await边界，可detach子call存活 | durable human hold先影响未来admission/route；late结果只收证据不自动清hold；取消请求≠quiescent，按Site/Job验证；不把不落账结果当“未执行” |

上述B收益是源码/文档支持的机制推论，没有运行Hima对照。三者都不自动识别Reader、Goal、Permit、Job cap、generation失效范围。Hima的现有“unknown保守停”可以在**纯路由**窗口中变少，在**外部effect**窗口中不能靠更换引擎强行消失。

## 适配边界、迁移与最小反证

**全采用**：引擎拥有admission/步骤完成/进度控制/等待/路由持久化，Hima拥有Pack语义、业务结果、证据原件/Reader/Goal、Site真实作业/权限。Ledger保留证据记录并由引擎固定execution/commit ID投影，避免同时拥有“下一步可执行”事实。旧Run按原Fabric读/恢复，新Run按固定new engine version创建，不在原Run中途强搬，退出需要导出checkpoint与稳定业务身份。迁移代价包括workflow interpreter、serializable结果schema、控制协议、版本保留、数据库或server生命周期、备份/恢复及domain evidence与journal交界，不只是adapter函数。

**局部adapter**：一个复杂action由引擎拥有内部步骤，Fabric只见一个Job/effect handle与最终已验交付；父Fabric不复制内部执行图。价值是节点内可靠等待/child join/版本恢复，不能解决父Fabric“result已存route未提交”的窗口。适用范围必须明确，不新增每项独立control层。

**设计借鉴**：显式result handle/步骤输入输出、owner fencing、deterministic completion commit、版本冻结、cancel request/ack/quiescence分层，可以在现有Fabric内加深接口；无需声称已复用候选成熟度。

建议root保留两项未来、另行授权的比较试验（本轮不执行）：
1. 同一无EDA fake Site effect store具备stable JobID、query/reconcile，故障注入A/B/C。比较旧Fabric与DBOS/Restate或Temporal其中一个；记录effect调用数、unknown数、自动恢复纯route数、hold后非法admission数、late完成保存情况。A中再使用**非幂等无query** effect：若框架仍自动重发则否决该接线，不因workflow最终success通过。
2. 旧Run停在external wait，发布破坏步骤顺序的新代码，再完成旧event；验证旧版继续、新版Run新行为、删除旧worker/endpoint后的明确错误、恢复导出成本。若必须保留第二执行状态、升版破坏旧Run、或减少人工机械回合但新增多套operator操作，即缩小到局部adapter/设计借鉴。

## 证据缺口与停止理由

- 在线latest API/release日期/SHA/许可已核；docs多为unversioned，涉及最新页与release支持范围有差异的能力已标U。没有用roadmap证明当前能力。
- Temporal教程/API取消默认不一致；显式配置再验证。DBOS cancelSignal支持版本未闭合；只用已证下一checkpoint停止和timeoutSignal。
- 不掌握Hima目标部署能否接受Postgres/常驻server及Restate许可形态；同时评估，没有替用户设硬限制。
- 未验证runtime性能、真实EDA效果恢复、迁移实现成本与生产SLA，不能做效果优越结论。
- 已覆盖三种故障、身份绑定、版本、控制、部署、许可和反证。定向检索再增加相同类别候选不太可能改变主要取舍，停止泛搜，交root独立核对。
