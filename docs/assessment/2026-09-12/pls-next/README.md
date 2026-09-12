# PLS-21 / 22 / 13 / 19 批次验收

状态：PLS-21、PLS-22、PLS-13、PLS-19 的实现与验收已完成。完整 local 377/377与安装态作者只读终检11/11通过；原始 finalization 的属性顺序比较失败原样保留，实际模型执行/发布与独立只读终检共同确认作者闭环。源项目保持只读，所有修改在 polishing 与其独立 worktree。每个提交均立即 push 并核对远端 SHA。

## 产品变化

| 任务 | 现有模块中的变化 | 具体证据 |
| --- | --- | --- |
| PLS-21 | Pack 声明 Goal/Strategy 的类型、单位、范围与精度；命令、工具、HTTP、表单及最终启动共用校验。拒绝重复/有损数值、危险动态参数和越界路径，旧 period Pack 保留集中兼容映射。 | [参数接纳](../pls-21/README.md) |
| PLS-22 | 原生 author session 注册到实际 Pack workspace；安装包带齐技能与知识。Workshop 被编译为真实 contract/graph/reader，并通过同一 Agent 的实际代码、Job、Judge 和 release 验证。指南明确工作区/代码目录、参数位置、图的实际结束路径和数值证据。 | [安装与作者会话](../pls-22/README.md)、[作者语义修正](../pls-22/authoring-semantics/README.md) |
| PLS-13 | 一套方法文件集合贯穿加载、Run、test、seal、安装和导出；run-assets 不进入方法 digest。更新按 manifest 保留客户资产，旧 Run 按原方法身份读取；归属不明、同版本异内容、symlink 或半更新拒绝。 | [方法与资产](../pls-13/README.md)、[发布清单](../pls-13/publication-fix/README.md)、[历史标签](../pls-13/historical-words/README.md) |
| PLS-19 | 对话 Agent 是 Run 唯一业务 owner。begin/work/complete、Workshop 读写、策略选择、暂停/继续/取消、交接与安全接管复用 Fabric/Jobs/Ledger；没有下一次 Agent 请求就没有后继节点。 | [实施接口盘点](implementation-plan.md)、[真实模型闭环](../pls-19/live-workshop-3/acceptance.md) |

执行状态在原 Ledger v20 中持久化：owner/epoch/revision、execution identity、请求摘要/回执、真实 Job 与代码身份。Loop/fork/join、依赖暂停、硬预算、恢复及未知启动均在现有模块处理，没有第二图引擎、模型驱动器或状态服务。实际命令由 Jobs/Channel/操作系统执行，业务选择由同一个对话 Agent 提交。

在途 Job 可在暂停期间完成并保存事实；继续须显式授权，取消以实际停止结果为准。启动前和持久 intent 写入后都检查硬期限；确定未发送的启动不会保留虚假的不确定 intent，已发送但未确认的 Job 继续保留身份和资源占用。历史独立 moment 在生产环境关闭，避免与接管竞态；原记录仍可读取。停止后欠写的报告可由重启机械补写，不自动推进新业务。

## 验证与失败记录

| 检查 | 实际结果与范围 |
| --- | --- |
| L0 | 相关版本 build、完整 TypeScript、Node/seam/boundary/inventory 通过；各阶段日志保留。最终指南整合的完整类型检查通过；首次新增 HTTP 测试缺少 JSON 类型标注的失败及修正保留。 |
| 首个完整 local 候选40f5afa | 348/352，4 个契约变更后的旧 fixture 失败；33 项相关文件修正后通过。见 [候选修正](candidate/fixture-regression.md)。 |
| 第二个完整 local 候选59f15f3 | 357/359，2 个测试等待条件失败；1429.030s，47 subprocess Hosts +340 in-process Hosts，0 Electron/SSH。原始 [TAP](final-verification/local-final-1.tap) 保留。 |
| 两个等待条件 | 1500ms 启动 fixture 改为实际 tmux dispatch 门槛后8/8；导入中断从等待命名通知改为实际文件状态后9/9。后者原失败的精确平台事件原因没有被记录，不能追溯声称导入产品失败。见 [启动证据](../pls-19/review-fixes/unknown-launch-fixture/README.md)、[导入说明](final-verification/import-state-observation.md)。 |
| 最终定点整合 | 9 文件60/60，0fail/skip，171.017s；1 subprocessHost +92 in-processHosts，0Electron/SSH。见 [TAP](final-verification/acceptance-local.tap)。 |
| L3 整合版 | 同一原生对话中运行、正常输入暂停、Continue、Files 和草稿保留1/1，45.908s；1 Electron，0 SSH。见 [TAP](final-verification/desktop.tap) 与 [截图](final-desktop/owned-paused.png)。Goal/作者会话的其他关键路径及其开发失败见各任务记录。 |
| L4 Workshop 最终样本be1bb76 | 19/19，536.880s；1 Host、1 model session、64 model request steps、3 用户消息。实际179→200，策略阈值11→0，Goal200不变，5真实 Jobs，明确goal-met；过程含实际在途暂停。两次脚本字节相同，策略变化，不能声称算法创新。 |
| 最终完整 local `93afd76` | 377/377，0fail/skip，1195.578s；47 subprocess Hosts +357 in-process Hosts，0 Electron/SSH。见 [原字节gzip TAP](final-verification/release-candidate-local.tap.gz) 与 [摘要/源SHA/hash](final-verification/release-candidate-local.json)；最终类型日志同目录。 |
| 完整 local 后的检查器修正 | 仅将测试工具的属性顺序敏感比较改为结构比较；相关4/4通过，0fail/skip，3.262s，1 in-process Host、0 subprocess/Electron/SSH。见 [定点TAP](final-verification/property-order-integrated.tap.gz)。其中新增1个属性顺序反例；未把此后的378项当前全量声称为已跑。 |
| L4 作者 | 原安装态原生作者会话经受控检查点续跑，已经实际产生 Goal-met 的数字 test Run 和 native release；finalization 的原始记录不变性断言因属性顺序失败，随后[独立只读终检](../pls-22/post-finalization-audit/README.md)11/11通过，另启1个实际安装态复制Host，0模型请求、0Run执行。各次失败与修正按下文独立保留。 |

安装态作者验证的完整顺序如下。后续步骤不抹去先前的失败或成本：

- [作者1](../pls-22/live-authoring-1/README.md)在总预算边界停止；[作者2](../pls-22/live-authoring-2/README.md)生成的方法与批准的 argv/结束路径不一致，修正期间用完预算，两次均为失败。
- [作者3](../pls-22/live-authoring-3/README.md)的实际 argv、参数、图和 Judge 通过检查，但检查器过严地限定 chooser 写法，在创建 Run 前拒绝了有序等价 fallback。[独立等价验证](../pls-22/chooser-equivalence/README.md)使用实际 Judge/choose 在合法输入域证明关系后修正检查器。
- [续跑1](../pls-22/live-continuation-1/README.md)的 driver 漏传 provider/model，实际为1个 agent/request事件、0次provider请求，清理又遇已释放句柄；[修正](../pls-22/checkpoint-continuation/resume-fix/README.md)显式恢复模型选择并保留清理所有权，不能称其为模型供应商无响应。
- [续跑2](../pls-22/live-continuation-2/README.md)由原 Agent 修正 reader，并通过9个直接数值反例；实际 Run 在原预算内读取169、3个 Jobs、178891ms，结束为 `ended-goal-met`。随后 TEST 使用了错误的行内标记，末尾步骤到期而没有 VERSION。停滞根因未确立，不声称供应商失败，也不把这一轮整体记为通过。
- [generic workspace 修正](../pls-22/generic-workspace-restart/README.md)从真实冷重启反例定位已写出的 absent-design v20 数据与读取 schema 不一致。当前读取器保留未声明 design 的事实；Ledger 仍为v20，v19离线导入仍使用原严格 schema。新构建通过真实 `prepareHimaHome` [升级原安装 bundle](../pls-22/runtime-upgrade/README.md)，旧 bundle 备份、新旧 hash 和61个受保护文件不变性由 [manifest](../pls-22/runtime-upgrade/manifest.json)记录。
- [finalization1](../pls-22/live-finalization-1/README.md)恢复同一原 Agent，只修正两个 TEST 标记行并通过原生发布。实际 seal、原 Run/方法/文件 hash、原始输入和9个 reader反例通过检查；最后“不得创建/执行 Run、重置预算或改变科学记录”的检查失败。独立逐字段核对显示 Run/records 全部同值，原断言的 `JSON.stringify` 对 Zod 冷解码后的对象属性顺序敏感；原始失败不改写。修正结构比较后的[只读终检](../pls-22/post-finalization-audit/evidence.json)11/11通过，核对剩余 tail、实际 seal 和允许的文件变化，未调用模型或执行 Run。原会话104个持久化工具调用包含五个技能和 native release；14个seal文件hash全部一致，稳定文件树仅TEST.md和VERSION.yml变化。原Ledger字节hash仍为 `4b259e4938dc1961eb0525c4cb1b3b7906f9b4482fbcca92800756b13b79c444`，与升级前相同。

作者1/2/3、续跑1/2和finalization1各自保留34/102/26/1/37/8个 agent/request 事件及对应 Host、会话、消息和耗时；续跑1的1个事件实际没有 provider 请求。检查点续跑和 finalization 的 provenance 指向原始尝试，不能只计最后成功收尾的成本。

单次短子集和完整回归成本分别记录；未选择的桌面/真实 Site 组不是通过。手写 replay 只证明协议和机制；实际模型样本没有使用 replay。模型 token 与底层 API 重试/账单调用数未测量，request steps 不冒充这些指标。真实模型只运行小型数字方法，没有执行 EDA、SSH 或完整 DTCO。

独立 Standards/Spec 审查发现的问题均有对应修复和红绿证据。原核心审查及后续问题关闭见 [Standards](final-verification/review-standards.md)、[Spec](final-verification/review-spec.md)；最终描述/作者指南/API拒绝与测试改动的两路独立增量审查均无新问题，见 [增量复核](final-verification/delta-review.md)。HTTP 的策略拒绝现返回409及真实原因，见 [消费者修正](final-verification/moment-http-refusal.md)。generic workspace读取器与finalization工具另经独立审查；最终只读终检11项通过，原始失败JSON的SHA未改变。

## 明确边界与回滚

- grow/revise 现在明确返回 unsupported；完整受影响下游修订和附加节点由 PLS-10/11 接续，参考图和历史不能被删除。
- inputDigest 绑定当前执行元数据与记录版本，不是整个物理工作区文件树的冻结或 SHA 证明。Run 原方法保留不等于冻结 Harness、Site、所有输入文件与外部工具环境。
- `run-assets/<runId>/` 的身份隔离和更新保护已提供；完整知识归档/复用、正式 AES probe、EDA/Fmax、复杂 DTCO 与真人使用验收属于后续任务。
- Ledger 导入是显式离线v19→新空v20 home，保留原字节备份和回执；不升级原 home、不复制Site/Pack/工作文件/Agent、不直接授予owner。参见 [导入](../pls-19/ledger-import/README.md)。
- 回滚先停止新接纳，保留真实Job/Run、资产、方法历史和导入原件；不能让旧构建读取v20或恢复会删除客户资产的旧seeding。generic absent-design记录需要保留已修正的当前读取器；恢复升级前bundle会再次拒绝这些记录。独立工作分支保留每个可追溯切片。

当前完成12/26个PLS（01～07、13、19、20、21、22）；下一依赖前沿为 PLS-23 #26、PLS-24 #27、PLS-10 #11、PLS-14 #15。本批不启动这些任务，实时Issue状态以GitHub为准。
