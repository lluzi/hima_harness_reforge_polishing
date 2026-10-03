# 可嵌入图／状态／执行库：供 root 综合的增量证据

研究员：GPT-6.1 Sol / high；2026-10-03 UTC（用户当地2026-10-02）。研究对象产品基线77223fe，研究分支d540d9de。只读官方资料与少量固定SHA源码，未安装依赖、运行库/Hima、调用模型/GUI/SSH/EDA或修改产品。本文不是架构批准，也不是竞争最终报告。

## 最能改变取舍的结论

1. **LangGraph JS 值得作为“业务图下面的局部调度／结果绑定”比较对象。** 节点可以纯JavaScript函数，不要求调用LLM，亦不要求采用其预制Agent Loop。DSH可以继续做唯一Campaign owner。它提供条件边、并行、barrier join、循环、状态schema、Command(update+goto)、持久节点写入和人类interrupt，确有机会减轻Fabric的某些图推进代码；接入后仍需保留Hima的结果验证、Site Permit、Job cap、唯一owner、human hold、generation/失效关系与外部Job核对。
2. **XState是控制状态的有力局部候选，不能作为外部副作用耐久内核的替代证据。** statechart/actor与Hima业务承诺图不是同一种抽象。可考虑把node execution内部admission→waiting→verified→routed及控制并发表达为机器，业务图保留为Pack资产。snapshot恢复跳过actions、重启invocations；远端launch若直接写在invocation里就有重复启动风险。
3. **Effect Workflow需要改用当前名字与稳定性事实讨论。** 最新Effect 4.0.0（2026-10-01）已将workflow合入`effect/workflow`，cluster合入`effect/cluster`；旧`@effect/workflow`最新版仍0.19.1，不能混用两个代际。当前模块/API仍标`unstable`。它确有SingleRunner SQL单进程层，可离线嵌入，无须一定部署独立cluster服务；但durable用途需要SQL message/reply storage与Effect的Layer/Schema/Scope/Fiber体系，不是给已有Promise callback加个装饰器。建议先借设计／有界Activity适配研究，暂不作为整体核心默认选项。

## 版本、维护与许可核对

| 候选 | 本轮明确核实的版本与发布 | 固定源码身份 | 许可与观察 |
|---|---|---|---|
| XState | npm `xstate` 5.33.2；GitHub release 2026-09-15 | fbee62e7c1586315ed478c2fedf530d7e0ff5a3e（release tag与main同SHA） | core MIT；本轮只评core，不将Stately托管服务/编辑器许可混入 |
| LangGraph JS | npm `@langchain/langgraph` 1.4.18；release 2026-09-25 | ec8cb378e3c7846b2a4aea31dfc4aff8f1cbf2fb；main另为9143976b… | core仓库MIT；Node >=18；`@langchain/core`和zod是peer dependencies，另有checkpoint/SDK/protocol依赖；不把Agent Server/LangSmith产品与MIT库等同 |
| Effect Workflow | npm `effect` 4.0.0；release 2026-10-01；旧包`@effect/workflow`0.19.1 | 67ba4e46a11ccda0b6761578bfd22c04ae00167d；main另为480bba2… | MIT；workflow与cluster源码`@stability unstable`；4.0.0发布仅两天，长期运行迁移成熟度未验证 |

来源：E-VER、E-LICENSE。三个release都近期有更新；这支持“仍维护”，不证明生产稳定或Hima可用。GitHub monorepo `/releases/latest`可能返回CLI等兄弟包，本轮已改用具体包tag核实，避免拿最新CLI版本冒充graph core。

## XState：状态与actor系统

**抽象与契约。** statechart用状态、事件、guard、动作及invoked/spawned actors建模；业务图通常把节点视为一项有输入、验收成果和业务outcome的承诺，不能直接把业务节点映为每个低层state。invoke可传typed input，onDone消费output，onError按失败路由；TS机器的context/events/output可类型化。普通action fire-and-forget，async action不会被等待。异步外部工作应有actor/adapter生命周期，不能以action完成冒充业务验证。并行state regions与all-final onDone可同步；循环/条件由事件与guard/transition表达。可表达局部失败和人类pause，但human优先级、owner/epoch和hold传播都是Hima要定义的语义。见E-X-INVOKE、E-X-PARALLEL。

**持久化真实边界。** `getPersistedSnapshot`产生actor内部state/context/children的可序列化快照；应用自行将它保存到localStorage/数据库，库没有替Hima提供原子业务结果日志。恢复时机器actions不重执行，invocations重启，children递归restore。JSON不能存进程、SSH连接、函数。机器逻辑改变可能与旧snapshot不兼容，没有从所读资料证实自动code version pin/migration。见E-X-PERSIST与E-X-SOURCE。

**pending和取消。** active promise actor恢复会重新调用promiseCreator；若input只存稳定Job ID并执行observe，它可以接回Job；若执行launch则可能重复。`.stop()`会abort提供给creator的signal、丢弃late resolve/reject；真正停止远端EDA取决于Channel/远端Job取消协议，AbortSignal不具备这个能力。见E-X-PROMISE。

**反例。** “远端EDA已启动，返回Job ID前进程死掉；snapshot仍在pending，restore重启invocation。”若invocation重新launch会重复消耗license/计算；snapshot里没有原Job身份则无安全接回依据。另一个反例是把异步Reader放action里，机器可以先路由至done而Reader尚未完成。

**Hima映射与成本（推论）。** 可局部采用以明确`NodeExecution.phase`和控制事件的合法转换，并从Ledger加载事实来驱动机器；避免建立第二份Run事实。如果让每个Pack business graph变成statechart，会额外引入state/actor/event概念和编译适配，图作者负担可能增加。它最适合控制正确性／UI投影或节点内部protocol，不是默认整体图替换。

## LangGraph JS：图执行与checkpoint

**抽象与契约。** StateGraph是shared state＋函数node＋路由edge，底层Pregel super-step；node可含LLM也可普通代码。允许input/output schemas及内部state、reducers、typed GraphNode；`Command({update,goto})`让成果更新与路由在同一次node返回中表达，outcome仍需Hima声明/schema，不内建PASS/FAIL/UNDETERMINED或Campaign Goal语义。条件边／Send支持fork和动态map；多start的addEdge以NamedBarrierValue实现join；回边和recursionLimit支持有界执行循环。Reducer冲突语义必须设计，不能把共享state天然等同明确producer结果引用。见E-L-GRAPH、E-L-SOURCE、E-L-PACKAGE。

**失败与人类介入。** 当前JS 1.4.x有retryPolicy和node errorHandler，失败context可checkpoint；错误handler可更新状态/返回Command路由，interrupt单独冒泡而不被当普通error retry。`interrupt()`需持久checkpointer和同thread_id resume；恢复重新执行整node函数，之前的代码重跑。node内部可用task保存更细粒度结果；未完成task仍可能重执行，task/interrupt调用次序改变有cached结果错配风险。见E-L-FAILURE、E-L-INTERRUPT、E-L-FUNCTIONAL。

**保存的东西。** checkpointer保存state channels、next、config/namespace/id、metadata、tasks/errors/interrupts等；每super-step有完整checkpoint，同步步内每个成功node有pending writes，某sibling失败时成功node不必重算。实际persist ack与durability模式有别：exit模式中途crash不可恢复；async与下一步并发写checkpoint仍有crash丢失窗口；sync等待该step的task writes与checkpoint promises settled才派下一step。只能称“已持久保存的结果跳过”，不能称所有已在外部发生效果都跳过。见E-L-CHECKPOINT、E-L-SOURCE。

**离线部署。** JS库可进现有Node process；MemorySaver只RAM。SQLite saver本地文件、Postgres/Mongo/Redis saver需对应后端。官方把SQLite标为experimentation/local，不能据此声称其Hima生产并发/灾难恢复已合格。可以做自定义BaseCheckpointSaver，但put/putWrites/getTuple/list与现有Ledger合并的事务/退出成本需要验证。云托管并非必要。见E-L-CHECKPOINT。

**pending与取消竞争。** checkpoint不保存OS进程或SSH连接；launch node必须返回稳定Job ID，后续observe node按该身份收取结果。`RunControl.requestDrain()`只在super-step之间停止；in-flight node及retry继续跑到结束。若同tick graph自然结束，返回正常结果，需额外看drainRequested；官方明确drain不取消在途async工作。AbortSignal也要传进实际adapter，不能代替远端kill与quiescence核对。这直接给出pause/cancel并发完成反例。见E-L-DRAIN。

**升级旧Run。** 官方明确resume用最新部署图，checkpoint不存edge topology或自动pin原始代码；可加删边，暂停点node重命名/删除会破坏resume；旧state类型收紧也会破坏。业务兼容由应用在thread start写flow_version并分支、保留旧实现。Hima不可变Pack/method/input identity必须继续绑定，且adapter/runtime行为版本也须考虑。见E-L-COMPAT。

**反例。** `launchEDA(); interrupt("approval?")`恢复会再次launch。换为task降低已完成结果重算，但“launch已发生、task结果未落checkpoint”仍可能再执行；必须用原launch intent核对而不是重发。另一反例：node返回Command(goto)且还配置静态edge，两条路径都会执行，可能重复派工作。

**Hima映射与成本（推论）。** 可让DSH通过现有executionAction seam选择业务动作，图内普通code执行已获准确定性区域，不必换成LangGraph Agent。优先比较数值Reader→Judge显式result binding、异质fork→pure join，检验能否删掉“最新Reading/首条rule”等顺序暗示而保持旧Pack。若LangGraph checkpoint与Ledger分别决定完成/路由，就新增双事实权威；不能仅声称“一层adapter”就消掉这个风险。以唯一提交边界或者Ledger-backed saver设计为采用门槛。

## Effect Workflow：具名Effect Activity的耐久重放

**抽象与契约。** Workflow.make以tag、payload/success/error Schema及idempotencyKey构造typed执行；执行ID由workflow tag和key哈希导出。Activity是有name、success/error schemas的Effect，engine保存和重放Exit结果；普通Effect组合支持并行、catch/retry/loop，DurableDeferred提供外部等待/恢复token和durable race。它是代码式workflow，不自带Pack作者业务图、typed结果端口/join的领域约束，需要编译/解释graph。见E-E-WORKFLOW、E-E-ACTIVITY、E-E-DEFERRED。

**保存和重放边界。** ClusterWorkflowEngine把workflow run、Activity result、deferred completion、resume等作为persisted entity RPC/message/replies。Activity标识是executionId＋activity.name＋attempt；参数本身不进入该主键，这是同名Activity改变输入仍可能读旧result的静态推论，不是实测。workflow body replay，已完成Activity从存储回答；Activity在等待child workflow/durable clock时suspend，body会再跑，官方gotcha明确提醒其前置副作用可能重复。非Activity普通Effect不能凭类型自动获得checkpoint。见E-E-ACTIVITY、E-E-CLUSTER。

**部署与适配。** layerMemory官方定位test/local development且不具durability。`ClusterWorkflowEngine.layer`要求Sharding＋MessageStorage；`SingleRunner.layer`在一个process内用noop runners/health，SQL messages/replies仍必要，即runnerStorage=memory也不取消SQL需求；也需Crypto。4.0.0源码支持SQL SQLite等dialects，但具体Node SQLite driver包与Hima现有持久层一致性本轮未运行验证。可以在局部module维护Effect runtime/layers，把现有Promise与Job adapter包成Activity，DSH无需整体改写；但该模块执行协议需Effect-native，库的Scope/interruption/Schema/Layer学习与运维成本是真实的。见E-E-ENGINE、E-E-SINGLE。

**外部副作用并不原子。** `ClusterSchema.WithTransaction`在MessageStorage实现支持时将server writes放到storage transaction；远端Innovus/SSH/进程启动不属于该SQL transaction。Activity.idempotencyKey能给调用方稳定key，只有目标adapter/业务执行协议消费它才防重复。数据库写入原子性不能外推远端EDA exactly-once。见E-E-TX与E-E-ACTIVITY。

**取消、human wait及版本。** DurableDeferred的token包含workflow/execution/deferred身份，外部done使流程wake/replay；Activity.raceAll记录race结果，interrupt-only退出不会当成completed result。workflow.interrupt与内部fiber停止不同于远端Job取消；quiescence和hold仍属Hima。当前所读源码没有找到自动code version pin／旧result schema迁移契约，记为unknown。已存Exit由当前schema decode；Activity重命名改其key，可能新执行；同name保留却改语义可能旧结果被复用，需Hima显式版本与稳定命名策略。见E-E-DEFERRED、E-E-WORKFLOW、E-E-CLUSTER。

**反例。** Activity先启动EDA，再await一个DurableDeferred或子workflow而suspend；resume重跑Activity body，可再次启动；应先单独launch Activity产稳定Job handle，再单独observe/await。另一个反例是把同name Activity的输入由A改B，主键未含输入，不能将cached A结果当B的成果。

**Hima映射与成本（推论）。** 值得借`typed Exit`、stable Activity identity、external deferred token、suspend与terminal completion分离等设计。若做局部采用，应先包一个已具有原intent/Job ID核对的异步执行adapter，不让framework重试绕过Hima unknown hold。因unstable APIs且新4.0代际刚发布，暂不作为整Fabric核心引入的首选；可在稳定单独seam候选里继续观察。

## 三个统一故障场景（静态推演，未执行）

下表“结果已保存”指对应库实际持久存储完成，不指Promise已resolve、snapshot只在内存、或Hima Ledger与库checkpoint之一单独落账。

| 场景 | XState | LangGraph JS | Effect Workflow | Hima仍需承担 |
|---|---|---|---|---|
| S1 外部effect后、结果落账前crash | 无durable effect journal。恢复旧snapshot可能重新进入state；active invocation重启。actions不重放不能填补保存之前的缺口 | 受影响node／未完成task可重执行；sync不把外部effect和checkpointer原子合并 | 未completed Activity可再执行；storage transaction只覆盖参与storage的写入 | durable launch intent、唯一effect ID、原Job查找/核对、unknown不得重发；目标协议幂等或reconcile |
| S2 结果已保存、路由提交前crash | 若持久snapshot已含context与目标state，可以restore；若只Hima结果另存而snapshot旧，库不自动收尾那笔业务路由 | 成功pending writes避免成功node重算；完整checkpoint含next；Command route写入／纯edge计算可以推进。但Hima Ledger与checkpoint若分开仍可能双写窗口 | 完成Activity结果被重用；body重新执行确定性路由；非Activity route副作用仍可能重跑，代码变更影响路线 | 明确一个结果＋路由提交权威；稳定结果绑定/输入版本/判断规则；可收尾确定性提交而不重跑外部effect |
| S3 human pause/cancel与完成并发 | event顺序确定本process transition，stop后late promise output被丢弃；远端可能已经完成 | drain等当前step，若同tick自然end正常返回；interrupt不是远端cancel；Hima持久hold仍须每次admission判定 | durable race/deferred可保留赢家结果，fiber interrupt可打断局部执行；官方不足以证明Hima human hold对remote complete的优先规则 | 记录控制请求与实际完成两个事实；hold优先级、owner epoch、禁止新admission；Job真实停止/完成独立核对 |

不能以三个库之一的本机取消成功直接把Site Job记为cancelled；完成和取消请求可能同时为事实。终态政策必须由Hima定义并落在同一个Run权威内。

## 最小可逆比较（提案，不在本轮执行）

- LangGraph：仅以纯函数／假Job adapter定义一个显式producer→Reader→Judge、两支异质结果→join、pause点；固定持久backend与sync，注入S1/S2/S3。通过标准：从已存成果安全收尾route；缺身份保留unknown；旧Pack完整身份不漂移；DSH唯一owner不变；需要维护的适配/特殊逻辑比现有更少。任何重复launch、hold绕过、Ledger/checkpoint冲突都否决直接引入。
- XState：只表达一个节点内部control machine，以Ledger facts注入events；反证async action早done、active invocation重启重复launch、pause后late done。收益应是合法转换与协议interface更深，不能拿snapshot持久当S1成功。
- Effect：只包同一个异步Job lifecycle为launch/observe Activities与deferred callback；反证同名不同input、suspend前effect重复、SQL unavailable、升级后schema decode。若需要大范围Effect化或第二个Run scheduler才可接入，则降为仅借设计。

## 证据缺口与阅读说明

本轮没有真实崩溃实验、性能测量、依赖安装、runtime integration或对维护者承诺的验证。三者对Hima已有复杂generation/回溯失效/immutable Pack/Reader引用绑定均无开箱领域语义；不能从通用loop或图time-travel推断等价。license核对限列明core与源码，不是所有可选driver/server/云产品的许可审计。当前SQLite durability、磁盘故障恢复、跨process并发owner锁、远端cancel协议、SDK未来兼容都保留未测。检索误路径与404见embedded-raw/retrieval-*.json；官方docs更名也已记录，未用缓存旧文档冒充当前。
