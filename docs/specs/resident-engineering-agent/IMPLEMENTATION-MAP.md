# Issue82 实施入口与验收矩阵

本附录提供仓库 `polishing-discipline` 要求的具体文件、符号、现有测试与回滚入口；正文保持模块/行为规格。**这是可修改范围，不是要求把所有文件全部改一遍。** 若某项已可复用，直接复用；不得为追求下表覆盖新增层或广泛重构。

## 基线与 ownership

- 正确源码：`b20ef44a9672f8c5a5ab645e49e0ef3446e2c0f7`；设计文档分支以此为父级。ATCS graph SHA256 `d46bf2f217646d78e4febf1296c1f2725096435c5e0c4cca94e872598e132d9a`；contract SHA256 `57a8295b6bd48501881ba08e1c960009d036578ae6937423299fc3ecde3fea9a`，二者版本均 `0.2.10`。
- 主目录 `0626bba3` 中 ATCS `0.1.10` 不得拿来当本切片 module/graph事实。落地前核对实际分支与 base，保留用户 dirty状态。
- 一个 Codex gpt-6.1-sol/High 主集成者负责共享 `packs/fabric/tools/index/ledger` 接线。独立 worker可在已冻结接口后处理 Site adapter、Pack方法和测试；也使用 gpt-6.1-sol/High且fresh boundedcontext，不继续派生。
- 实现稳定后一次独立 gpt-6.1-sol/High关键复核。真实 Site/产品操作由既有 Opus5.5/High FL负责，产品实际模型为 DeepSeek4.1Flash。
- 当前仅规格写作；以下命令和验收尚未执行。

## 平台代码地图

| 职责 | 当前文件／符号 | 最小增量及保持项 |
|---|---|---|
| Pack 允许外包与材料引用 | `packages/harness/src/packs.ts`: `packTool`, `actNode`, `validatePack`, `checkPack` | tools上可选 `outsourcing {role,reads,knowledge,produces}`；复用description/inputs/file/argv/licences/outputReader。验证声明引用与对应Site能力；无字段保留普通tool。不要改native Team、Workshop语义或加新graphkind。 |
| 公开Agent动作 | `packages/harness/src/tools.ts`: `hima_execute` schema/execute | `action:engineering` + operation `start/message/status/cancel/delivery/release`，沿用实际agent actor和当前Run控制参数；不收原始启动argv/任意cwd/credential。 |
| 声明上下文与真实Agent能力 | `packages/harness/src/index.ts`: product systemPrompt section/context/inventory；`fabric.ts`: `executionContext`；已有recommend描述 | Agent实际知道可外包工程能力、节点资格和完整方法，能自行发任务与跟进；不以被动脚本固定prompt代替Agent。 |
| admission／单execution／幂等 | `packages/harness/src/fabric.ts`: `ExecutionActionRequest`, `executionAction`, `controlling`, `actOnExecution` | 在现有控制锁/epoch/revision/requestreceipt下处理engineering。任务ref绑定既有execution/Job；普通work与engineering互斥；未声明/重复/旧owner/staleexecution无副作用。 |
| launch与容量 | `packages/harness/src/node-turns.ts`: `toolNode`, `launchAndWait`；`job-cap.ts`: `claimSlotAndLaunch`；`jobs.ts`: `launchJob` | 复用普通SiteJob launch/slot/Permit/intents，不要求nativeWorkshop代码、nativeOperatorchild或全部工程完成后才返回start。 |
| 材料准备 | `packages/harness/src/workshop.ts`: `captureWorkshopInputs`, knowledge读取/身份；`node-turns.ts`现有材料/参数准备 | 复用材料保留/hash/读取函数形成当前taskenvelope，不能复制另一套Workshop作者或把entry验证绕成成功。 |
| Site具体能力 | `packages/harness/src/sites.ts`: `loadSite`/既有bindings；`shell.ts`: `decideLaunch`, `decideWrite` | 首版采用 `bindings.engineeringCapabilities` 的受Permit约束材料；内容固定wrapper/executable/protocol/profile/model/read-write/tool/environment/stopgrace。沿用binding/配置加载职责，非新providerregistry。 |
| SSH／消息文件 | `packages/harness/src/channel.ts`: `Channel`, `LocalChannel`, `SshChannel`, checked workspacePlumbing | 复用私有任务目录read/checkedtee/jobplumbing。帧完整+requestId/digest才接收；不新增任意SSHshell/cwd语言。 |
| Job状态／实际停止 | `packages/harness/src/jobs.ts`: `jobStatus`, `jobTail`, `jobKill`, `reconcileLaunchIntent`, `killSession`；`interactive-job.ts`: `endJobProcessGroup` | Job/native ownedchild真实quiescence，不能只看tmux会话或cancelack；释放进程不删工程文件。保留现有Runpause与cancel区别。 |
| 记录／恢复／既有view | `packages/harness/src/ledger.ts`: nodeExecution/job/launchIntent/executionReceipt；`recovery.ts`: `reconcileRuns`, `cancelRun`；`remote.ts`: 现有Run/execution/control投影 | 先用已有receipt.data、Job目录/日志和产物引用表达task。仅必要时加可选metadata；遵守既有ledger版本/兼容规则，不新建EngineeringTask表/状态服务/伪nativechild。恢复不重放不确定操作。 |
| artifact保留 | `packages/harness/src/experience.ts`: `retainRunMaterial` 及已有Run归档 | 保存真正的脚本、报告、native事件和来源引用，再release。既有delete禁止和历史方法保护保持。 |

允许一个 module-private OpenCode adapter/helper文件来集中协议转换，若拆文件能改善locality可采用，例如 `packages/harness/src/engineering-executor.ts`；**不注册新Cordis/Harness组件或ctx任务服务**。启动在Site侧的薄wrapper模板可放在现有 `sites/linglong-atcs28/templates/`，明确标为部署材料，例如 `resident-engineering-wrapper.py`。它只实现task-local ACP/native-session过程与request/receipt衔接，不实施Timing策略。实际落地路径由模块owner选择并在变更记录列明；不能用一个新文件名掩盖新的业务主脑。

普通task/privateCoding目录具备正常文件读写/脚本/测试能力。既有允许wrapper/cwd并不自动隔离wrapper内任意shell；Site/native工作环境必须有真正有效的目录与执行边界，正常访问positive与保护资产negative均可达。不能把nativepermissiondeny、文件规则字符串错误或host失联算作模型不会修复。

## Pack代码地图与具体路线

| 范围 | 当前入口 | 新版变更 |
|---|---|---|
| 方法与图 | `packs/agentic-timing-closure-system/contract.yml`, `graph.yml`, `INTENT.md`, `SPEC.md`, `FABRIC.md`, `TEST.md`, `knowledge/*` | 增加一个通用role外包工具与 `fix-timing` act节点，完整goal/context/playbook/delivery。去掉新版的六workerTeam/fork/compose/retainedHimaLead和必需physical路径；其他Pack/native执行不改。 |
| 当前共同R1 | `flow/atcs_cli.py`: `_cmd_common_autofix`, `_native_analysis_tcl`, `_verified_xtop_context`, `_native_task`, `_eco_pair` | 复用身份、native分析、initialAutoFix/seed/rawreports/export；抽小共享helper可行。移除新route内部90min/physicalreserve等旧比较假设，不用短deadline证明工程穷尽。 |
| 新任务入口替代 | 当前 `bind-worker-slots`→plan→prepare-workers→六research/operate/capture/read分支→join/collect/compose→`prepare-lead/timing-lead/finalize-lead` | 新版改成一个外包 `fix-timing` task；模型自己研究/协作/操作。主Hima工程Agent不再分别写六包和merge内部团队成果。 |
| 前置physicalproducer | 当前 `observe-baseline`, `physical-baseline`, `risk-baseline`, `residual-baseline` 的PT/Innovus生产路径 | 在新route用合法保留输入/nativeXTop事实保留基线/约束/库/scenarios。不是仅断开尾部implement；不启动新的PT/Innovus作为外包前置。 |
| 尾部交付 | 当前 `implement/extract/sta/physical-candidate/evaluate/adopt/observe-working/refresh-budget/check-generation` | 不作为新XTop-only工程交付必需路径。改为native结果Reader、效果/Goal、残余及experience/report/ending；保持旧helper/旧方法快照/旧final语义。 |
| 结果格式／读取 | `flow/atcs/core.py`: stamp/digest/filehash；`flow/atcs/contributions.py`: native gain/log/fail/session parsers；`flow/atcs/state.py`: compare_checks；`flow/atcs/residual.py`；`tools/read-atcs.py`；`semantics.yml`, `readers/*`, `rules/*` | 新增Pack-local `engineering-result` Reader/交付/Goal值，复用native parsing、摘要、rawreports、ECO/checkpoint/残余引用。不强塞进six-slotContribution。 |
| 普通AutoFix参照 | `_cmd_prepare_lead` control分支；`flow/templates/xtop-repeat-control.tcl`；integration中的默认修复序列 | 在现有flow抽最小控制入口，从同commonR1反复普通AutoFix直至不再改善，输出同native观察。不要搬出一个新Harness优化器或模型helperAB脚手架。 |
| Site发布材料 | `sites/linglong-atcs28/site.yml`, `permit.yml`, `inputs`/`templates`/部署说明 | 增加明确的工程executor能力材料和wrapper许可，任务私有写区/共享只读材料/正常XTop环境；不能用旧13原语allowlist当OpenCode全部能力。不要全局宽权或改用户已有OpenCode会话。 |

旧0.2.10新旧版本均应可明确加载；新安装方法/digest不可在旧Run里替换。当前referee `tc_final_*`/physical acceptance仍仅对应真实DB→SPEF→PT；新route只写XTop范围的结果和值。产物JSON必须有有效fixture/Reader，不能把第一真实模型当第一个格式生产者。

最小result消费者所需字段：当前task/execution和base/R1/选中state身份；before/after真实native报告与覆盖；工程脚本/ECO/checkpoint/复现引用与摘要；remaining/regressed/blocked/unknown事实；停止原因/最佳状态说明。内部team图/思考/每一步工作包不是新的必须schema。零改进可交付真实no-op和诊断；缺必要脚本/身份/测量是未完成交付，不是假装best-effort PASS。

## 验收矩阵：通过公开Host seam

| 用例 | 可观察positive | 直接反例／不得冒充 |
|---|---|---|
| 发现并委派 | owning Agent看到节点可外包、材料/方法与能力，生成真实任务；Host启动native适配器，返回execution/Jobref | 无声明、旧owner/epoch、nativework已启动时再外包；不能用test脚本预写ECO或手插ledgercompleted。 |
| 工程能力与scope | task内能读全部必要材料、写/运行自己的分析与测试；保护根不可写 | 只能跑指定verifier不算工程环境；read/edit规则不等于shell文件隔离；权限错误不能计能力负结果。 |
| 消息/控制 | 实际同task/nativeSession递送新信息，status显示正在执行/等待信息/实际delivery | 重复request双递送、旧task接收消息、CLIturnend误当goal、lostACK自动重发。 |
| stop/release | ownedprocess/CLI/EDAdescendants实际终止，交付保留 | 只有tmux消失、stderr断流、cancel请求sent或sessionhandle删掉；escapedchild仍alive不得释放/重开冲突任务。 |
| partial工程交付 | sameexecution下scripts/metrics/checkpoint/residual真实性通过，节点可complete且goalfalse | 伪zero、改约束、漏scenario、缺export/hash、stale/fake报告；reader拒绝不能强改成goal达成。 |
| 格式修复/恢复 | 在同任务补缺交付或真实reconcile后继续，已有正确工程成果保留 | 为schema问题重做baseline、重启全Campaign、自动重放不确定ECO。 |
| 新版Pack闭环 | inputs/R1→真实委派→Reader/Goal/residual/归档；不调PT/Innovus/StarRC | 用旧6fork或fakechildren结果注入证明新的执行闭环。 |
| actual业务效果 | 实际HimaAgent→实际OpenCode→XTop操作/脚本/测量，正常模型ownerfollowup，结果胜于普通AutoFix时有证据 | CLIpresence、小程序秒数/steps、开发者手改/预写答案、只末尾文字、未验证effect宣称或成本tie-break。 |

## 当前测试先例／最低命令

公开工具调用先例：`test/contract/conversation-execution.host.test.ts` 的 `bootInProcess/createRootAgent/host.ctx.tools.execute({name:'hima_execute',agent,...})`；现有 `agent-execution.host.test.ts`、`agent-controls.host.test.ts` 为用户执行/control先例。Job/remote/恢复先例：`jobs.test.ts`, `jobs.live.test.ts`, `agent-recovery.host.test.ts`, `node-jobs.host.test.ts`, `interactive-eda.host.test.ts`, `ssh.test.ts`, `ssh.live.test.ts`（文件落地前确认其所属分组，live组不混入local）。新的完整外包行为可增加一个 `resident-engineering.host.test.ts` 加入现有分组，而非建新测试框架；尽量从此最高seam证明所有通用行为。

Pack先例：`test/contract/agentic-timing-closure-system.test.ts`、`atcs-dry-path.host.test.ts`；native解析样本：`flow/tests/test_live_xtop_samples.py`、`test_xtop_session_capture.py`、`test_readers.py`、`test_evidence_identity.py`、`test_observation_contract.py`、`test_experience_residual.py`。当前0.2.10旧路线先例为 `test_owner_timing_lead.py` 与 `atcs-expert-operator.host.test.ts`，它们不能替新route规定mutation次数或six-Team结构；保留匹配旧方法fixture的回归语义。

实施时：

```sh
export PATH="/Users/lluzi/.local/node24/bin:$PATH"
pnpm run build
pnpm run typecheck
pnpm run test:local --files test/contract/conversation-execution.host.test.ts test/contract/agentic-timing-closure-system.test.ts test/contract/atcs-dry-path.host.test.ts
```

新增的resident外包Host文件按 `test/contract-groups.json` 注册后进入相同子集；以上是基线文件，不是假定新测试已存在。包内Python按当前 suite入口选择真正受影响的Reader/native/graph检查，完整local/桌面/live只在变更或风险必要时运行。不可测试旧lib；先一次构建后各组复用。真实L4通过生产adapter证明原生OpenCode协议、任务/目录/控制，再实际工程Agent与XTop任务验证业务；无root/开发者模型stepwise修复指导。需要UI时才补L3/Catsights。

## 切片、边界与回滚

1. **通用contract/Host切片**：声明+context/tool+当前execution/Job admission/receipt；可用确定性native-protocol进程fixture证明start/message/stop/delivery与旧pack兼容。固定接口后Siteadapter与新Pack可独立实现。
2. **Site/OpenCode adapter切片**：task-local会话、正常coding/EDA环境、真实消息/permission/control/childcleanup；只一个wrapper/adapter职责，不新建长期平台。
3. **ATCS Pack切片**：新版单工程节点、nativeR1/结果Reader/partialgoal/普通AutoFix效果入口、方法知识和例子；不改旧physicaltruth。
4. **集成与真实工程验收**：同一candidate+task输入身份，真实HimaAgent调用OpenCode。平台功能与XTop效果分别保留证据；效果负结果不改写平台已证行为，也不预先宣称业务成功。

shared接线只一个owner。所有commit立即push并验证remoteSHA；source/Pack/Site/wrapper变动生成一个新candidate身份，测试changedsurface，旧runs immutable。回滚恢复此前Harness和已安装ATCS0.2.10/v31，新任务停止并保留partial/uncertain证据；不能在旧liveRun内替换method或删用户工作区。

需要新Harness注册组件/状态主脑的例外只有在这条既有seam路线被最小反例证明确实无法承载时才提出：记录用户行为缺口、现有接口为何不能承载、选项、收益/适配成本、test seam与回滚，然后改本spec/ADR。普通新增helper文件本身不构成新增组件，但不可隐藏第二事实源。
