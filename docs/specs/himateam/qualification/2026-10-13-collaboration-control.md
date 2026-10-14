# P08 / #105：委派、人类控制、退出和真实交接

日期：2026-10-13（证据时间使用 UTC，部分记录为 10 月 14 日）。开发起点 `c05294593da979b2e3489e3529cad886674c1ee1`，分支 `codex/himateam-platform`。
状态：#105 当前候选的真实混编 L4 与正式 App L3 已通过；原仓库 hooks、提交与远端 SHA 在本文件成稿时尚待核验。本记录不授权 main 合并或发布；#110 的打包、Linux 与强 OS 隔离继续 HOLD。

## 行为及权威

负责人通过已有 `member_context` 接纳冻结成员的委派、依赖、人类请求和等待。Host 解析真实成员、原 Task/Run/effect、grant、generation、revision、来源与期限；请求不自行声明这些权限。DBOS 保持唯一执行内核，现有 Flow 承接动态派生节点。接纳与排队不代表结果已经完成。

等待保存原请求和原始 delegation IDs。Host 从已接纳依赖推导前置任务闭包；只等待 B 时可以先执行其前置 A，不自动放行无关任务。当前真实继任负责人可以继续等待同一逻辑任务先前已接纳的剩余委派。原接纳、父身份、输入 hash、派生链接和期限不改写。选择最早因果覆盖等待，避免历史结果检查递归进入较新的等待。

容量为一时，先保留上下文并实际关闭原负责人、记录关闭证明和释放，再启动子任务；结果经原合同检查、实际关闭后，交给同一 Run 的新负责人。原生恢复可用时保留 checkpoint；不可用时明确记录 reconstruction，不能声称恢复了原生会话。继任负责人真实收到精确结果输入才记录 receipt，最终交付必须覆盖所有已接纳子任务的真实收到结果。

依赖结果通过现有 Flow 输入绑定进入 B 的实际 native input，并保留 A 的完整 checked TaskResult/来源。继任等待不绕过后来负责人的撤权或物理关闭；旧链接下已启动的 B 也会因有效等待负责人的 operator revoke 进入已有真实清理路径。

正式人类响应绑定原 request、Task、Run、effect、内容、schema、principal、revision 与 expiry；普通问答不成为正式批准。人类节点等待不占 native 作业/许可证资源。重放和缓存结果前仍核对当前有效授权。自身停止永久封住首个资源接纳；父流程的继承暂停按已有控制事实呈现。

退出先持久保留 Team 停止门并收束实际成员。正常退出模式、SIGTERM/SIGINT、纯讨论成员与父子派生执行均使用原关闭证明；未知或未注册的活动后代保持 unknown，同时清理已知自有进程。冷重开与外层 Campaign Continue 不自动解锁 Team。只有人类显式继续才在同一 Task 创建新 Run，沿用原范围/输入/期限及精确选择版本；旧事实不可变。

活动 Task 应用已保存定义采用明确的暂停、关闭和 CAS 交接；固定 v2 不被随后保存的 v3 草稿替换。现有 Pack 节点委派 Team 的成果仍通过原节点合同、来源和字节核对，再接续一次。keep-jobs 退出只在真实 Team closure 已核验、且原 Pack 委派资源严格为零 job/空许可证的情况下判断该元数据租约就绪；不伪造释放、stopped 或结果，未知关闭不放行。

## 已完成验证与待补范围

| 层级 | 当前证据 |
| --- | --- |
| L0 | 当前修订正常构建、整仓/客户端/测试类型检查通过。最终原 hooks 待执行；没有旁路 hooks |
| Native I/O / context L2 | 当前 monitor/journal/context 登记子集 34/34 PASS；69.560 s 测试、88.249 s 总时长，1050.109375 MiB，全部自有 PID 消失，零产品模型 |
| 原始 IPC 反证 | 3,482 条原始 SDK 观测完整保存，journal 3,493 行 / 27,938,818 bytes；最大 timer delay 16.814 ms（原阈值 100 ms）、SDK→Host 9 ms（原阈值 500 ms），实际关闭；未丢 raw/reasoning 或提高阈值 |
| Host/PG 委派与控制 | RunStore `36358421…` + Local `5e745a6a…` 的四文件回归 33 项：32 PASS，唯一 FAIL 是测试比较了可变观测 phase。实际依赖、连续部分等待、未知继任关闭、原撤权/取消/期限、原生父子交接和冷重开 successor 均已通过。该比较修正后，已启动 B 撤权关闭单独 1/1 PASS：32.980 s body / 53.278 s test / 56.966 s 总时长，821.8125 MiB，PID 全部消失；不把之前整轮改成全 PASS |
| 退出/Pack | 此前 48/48 PASS，包含真实 Host/PG Pack 冷重开与显式 Team 继续、原节点接续一次、未知关闭，以及 shipped runProfile 的 leader/peer × SIGTERM/SIGINT 四个场景。严格 readiness 矩阵与实际 Pack 路径分开计数；不宣称 SIGHUP 支持 |
| 派生关闭 | 实际 Node unregistered grandchild 严格拒绝完整关闭证明；已知 native 身份仍实际收束，原 Job 真正关闭后用新 accepted exit 重试原树。2/2 PASS，14.638 s 测试、22.735 s 总时长，771.84375 MiB，无残留 PID |
| T20 | 实际 forked Host 在 child commit 后 SIGKILL，再冷恢复；原 child 交付不重提，后续推进一次。与模拟崩溃或其他恢复用例分开记录 |
| 正式 Human / 活动定义 L3 | 实际 Electron 2 个正式人类响应、v2/v3 冻结/成员裁剪/草稿、旧 binding 4xx 和物理关闭 PASS，65.039 s，1520.765625 MiB，无残留 PID，零产品模型。该检查在后续 IO/等待增量之前完成，UI 与正式响应合同随后未改；不称为当前 cut 新跑的 UI |
| 实际混编 L4 + 同 Task 冷 UI | 最终注册测试 1/1 PASS：真实 Pi/OpenCode 各任负责人，原期限内完成真实计算器、原生普通消息、checked child、物理关闭与同 Run 来源后继；再由真实 Electron 冷读同一 Home/Task/Run 的四张成员视图。238.536 s 测试 / 244.554 s 总时长、总进程树峰值 2016.625 MiB < 已授权 2048 MiB，全部自有 PID 退出。原失败与修复边界保留在下文；最终测试为保预算关闭了测试专用 PG 旁路观察器，业务断言未删。产品模型真实使用 DeepSeek，调用数/token 未独立计量。 |
| 最终原 hooks / 同步 | 本文件成稿时待执行；本地 commit 后立即 push，远端 SHA 完全一致才交付与关单。 |

## 失败、根因与修正

保留了原生首次 PG/SCRAM 连接超时：3482 条观测、13.9 MiB raw 时，Host 出现秒级卡顿。同步 observation journal 写入及周期同步 process-table 采集是已测得的阻塞路径；没有把单次 fsync 说成整个超时原因，也没有以修改连接超时、删除观测或扩大预算替代修正。

journal 改为有界、有序异步写入，所有接纳行都包含在边界内；批次、错误和完整 durable fence 分别核对。原生关闭在已授权取消/自身暂停/退出/撤权/期限场景不等 transcript fence 才开始物理清理。已有 journal failure 保持 combined closure/capture unknown，完整已接纳前缀仍保留。冷读严格校验 UTF-8，不默默替换损坏字节。

仅周期 process-table 采集改为异步；startup、created、实际 cleanup/recovery/capture 的同步 OS 观察、单轮合并及 atomic publication 不改。single-flight、epoch/revision 和当前持有对象检查拒绝迟到回调，等待中的采集不阻止原期限检查。实际 delayed ps、stale callback/error、stopAll、期限、reparented detached grandchild 和 wrong-birth refusal 反例通过。测试清理先冻结一次性生成、核对真实 ACK/出生/命令；身份不明保留 UNKNOWN，不以数字 PID 文件为信号授权。

旧 L4 busy 判据依赖 OpenCode 的 `received`，但固定 OAR/ACP 实际 prompt response 接近 turn end，不能证明 work 正在执行；该次在期限后清理阶段发生 Node heap OOM（239.576 s，1898.1875 MiB，总树仍低于 2048 MiB，最终 PID 均消失）。原始堆因尚未证明，不能称为已修复。新测试以真实 execute call、session/input、原始 SDK seq、实际 Node birth/ancestry 和唯一 nonce marker 建立 busy barrier；人类消息先落账再释放，原 ACK 和普通问题 ACK 仍必须来自 native。两个受控 Pi/ACP 协议用例已通过，但不替代实际 SDK/model 验收。

最终 Spec 复核发现 dependency-only 和连续部分等待的真实缺口。首个夹具错误使用非 UUID 请求文件名，被生产 Local 忽略，保留为夹具 FAIL；改用现有 randomUUID 后，真实 Host 接纳 A/B/wait(B)，已关闭父资源却不能启动 A，以及新负责人 wait(B) 被严格旧父规则拒绝，分别复现。修订没有改写旧接纳和链接。

修订首次回归又发现 native close 在 DBOS Step 内误调用新增 DBOS transaction。实际错误栈为 `Invalid call to hima.teamEffectOperatorRevoked inside a step or transaction`；未暂停撤权和普通 child 完成因此卡在关闭/提交，暂停撤权短路该查询则通过。最小修正复用已有 `#externalTransaction` I/O 接口，保持相同查询体、grant locks 与有效继任等待检查。后续原例、依赖和连续部分等待均通过。诊断夹具仅临时采集错误，未作为产品路径或永久重复查询引入。

新真实 Pi 验收保留了 Host tool response seq 918（yield-accepted）→ seq 1931 completed → seq 1932 Invalid initial delivery JSON → seq 1934 ordinary stop 的实际顺序；数据库原 wait 无 saved context/closure、无 child、资源未释放。根因为 successful wait reply 发布先于 Local accepted-yield fence。原 ordinary-close guard 保持，下一修订在已有 tool reply/Local 边界先核对真实 persisted wait 并持久 fence，再发布响应；真实清理、容量释放和 successor 仍归 Flow。原等待交接竞态的定向 Node/真实 Host 反例已通过；不把早前失败 Run 修改成成功。

第二次真实模型失败的收尾 OOM 已独立复现：原数据 50 张应用/DBOS 表合计 306,708,419 JSON 行字节，其中 dbos.operation_outputs 占 264,734,208。直接在同一私有 Home 执行旧 LocalDatabase.stop()，512 MiB Node 堆内 2.284 s 后 SIGABRT；仅该私有 PG 残留并经精确身份正常关闭。关闭改为保留原 authority/1 的逐行 COPY 流式私有临时文件，实际停止 PG 后追加控制 hash/时间并原子发布；坏表名、UTF-8、部分 COPY、失败后同次重试由 25/25 真实 PG 测试覆盖。在同一原数据集重跑 stop 成功：2.866 s、总进程树峰值 224.890625 MiB、306,737,445-byte 私有记录 SHA256 ca485bba71ef25aa792588bf626f32bec9fede22036c6c9bf3c9a28da26307a9；PID/PG PID 文件均不存在。大体量备份读取器与跨进程 finalization 属后续 #108，当前无接受声明。

第二方向等待的完整原始异常曾被收尾 OOM 遮蔽；保留事实证明命令字节与原要求一致、SDK 工具启动和实际 PID/进入标记成立，PG 观察也持久化到启动事件。相同保留行通过纯证据匹配；历史进程实时状态不能从冷数据补造。第三次 L4 驱动在 finally 前保存有界错误及最后检查阶段，不降低任何原身份、出生时间或期限断言。

## 当前候选的最后反证与验收（2026-10-14 UTC）

- 资源预算：原有 DBOS system pool 在稀疏工作时保留已释放连接。真实 PG 反证旧配置在 4.5 s 后仍有 5 条 idle client；仅将现有 system pool 的 `idleTimeoutMillis` 设为 2000 ms，保持 max=10/min=0、连接超时和业务容量不变。新配置观察至少两条真实已释放 backend 退出，借出的原 PID 保留、两条 DBOS workflow 重叠且各得正确结果；相关真实 Host/DBOS 33/33 PASS，165.069 s，峰值 584.09375 MiB。静态节省估算不能替代最终实测；最终 L4 整树峰值见上表。
- 原生证据：OpenCode ACP 的原始命令可省略可选 `cwd`；字段存在时仍须等于冻结目录，字段缺失时用实际计算器 marker、`process.cwd()`、出生身份及进程祖先核验。Pi/OpenCode Local 受控协议 2/2 PASS；它们不是实际 SDK/model 资格。OpenCode 负责人让出 `wait` 时原 prompt 尚未返回，实际 accepted `delegate` 和 `yield-accepted` MCP 回执证明处理过冻结输入，不能伪造 `received`；最终验收分别记录 Pi 4 个 native receive 与 OpenCode 3 个 receive + 1 个已确认让出输入。
- 真实子结果红测：原 Local 校验把字段顺序不同但值完全相同的 `TaskToolOutput.artifacts` 用 `JSON.stringify` 比较，错误返回 `result=null`，使真实 child 到原期限仍无后继。Pi/OpenCode 实际 Local 管理的 Node 反例旧代码 0/2，新代码使用深度值比较 2/2 PASS；schema、身份、原 receive/terminal/finish、文件 SHA 与来源检查仍在。原保留数据的答案为 703，artifact 字节/散列相符。
- 第二方向等待：DBOS 先在一个事务保留 continuation/invocation，随后创建 successor effect。测试先看见计划就调用 `effectSnapshot`，可能在 effect 尚未创建的窗口触发“identity reused”拒绝。保留备份中 continuation、已创建 effect 和 prepared 的最终 canonical identity 完全一致；测试改为等待原 effect 实际存在并严格比对 identity，然后等待结果。未变更 DBOS 容量、权限或后继事实权威。
- 冷窗口：正式 L4 使用桌面 Home `Workspace`，测试按真实目录名定位行与按钮。保留同一 Home 的零模型 Electron 探针显示两条 Team 的真实 retained lead work，并保存截图，15.355 s、峰值 1388.3125 MiB；最终注册 L4 继续用原完整 result/原生出生数/冷读前后事实断言通过。正式人类响应与活动定义采用在当前构建的独立 App L3 1/1 PASS，58.893 s 测试 / 59.237 s 总时长、峰值 1526.8125 MiB、零 SSH/产品模型，低于单独获批的 2048 MiB。
- 关机 OOM：原私有 306,708,419-byte 表数据使旧 `LocalDatabase.stop()` 在 512 MiB Node 堆 SIGABRT。新逐行流式 cold authority 在同一数据集正常停库、写出 306,737,445-byte 私有 authority（SHA256 `ca485bba71ef25aa792588bf626f32bec9fede22036c6c9bf3c9a28da26307a9`），2.866 s、整树峰值 224.890625 MiB，25/25 真实 PG 反例通过；已核对 PG PID 与自有进程退出。大体量备份读取/跨进程 finalization 仍属 #108，不能从本 stop 验收外推。
- 退出观察补测：原全量第 501 项的 Pack→Team Home 留存表明，`prepareExit` 后原 supervisor 与 detached child 已实际消失，但 Local 返回 `Process closure observation unavailable`，未生成 `oar:closed`，原 1-job PG 租约保持未释放；45 秒轮询不能将 unknown 变成就绪。独立 Local 反例使首次同步 `ps` 读取失败，旧代码保持 unknown（登记文件 24 PASS / 1 FAIL）；另一次真实 Local 失败栈显示收束 detached 子进程时，旧组信号遇到 `EPERM`，当次信号前的组状态未原子记录。现有 Local 模块只对失败的同步进程表读取再作一次真实观察；仅在当前原组有成员时才发组信号，组在观察与信号之间消失仍须按原 PID/出生身份和实际缺席完成证明，两次读取失败或关闭不明依旧 unknown。当前注册 Local 文件 27/27 PASS（39.076 s、354.938 MiB），其中连续两次 `ps` 失败仍要求原进程存活且同 lease 重试才可证实关闭；注册 Pack Host 文件 12/12 PASS（121.919 s、691.094 MiB），原退出边界 `ready:true`，同一 PID 组缺席证明已释放原 1-job 租约，随后才显式人类 Resume。此局部结果不替代待完成的原全量 hooks。
- PG 权威与旧观察入口：后续原全量第 133 项曾在 DBOS 已接纳暂停、Ledger 投影尚无 control 的窗口让 `hima_observe` 返回非错误。受控 Host 反例保留真实 PG 暂停，仅让该工具看见滞后的 Ledger control，旧工具 3 PASS / 1 FAIL；既有“拒绝后 observation 不增加”的断言仍保留。现有工具用已在本文件其他操作复用的 `knownDurableRun` 核对 PG Run，再沿原 Ledger guard 拒绝旧受控 Run 的直写，PG 查询异常不能放行。当前注册 conversation Host 文件 4/4 PASS（22.887 s、808.297 MiB），observe/guide 五文件 40/40 PASS（123.045 s、817.453 MiB）；合法独立 Probe 的观察合同未删。此局部结果不替代待完成的原全量 hooks。
- 原全量第 488/489 项（Pi/OpenCode 受控 Local busy barrier）在全部业务交接、回执、终端和 artifact 断言后，最终 `runtime.close` 返回 `closed:false`；该轮日志没有保留关闭 reason，因此不能把这一失败直接归因于 `EPERM`。测试现于主关闭失败时保留原 Home 和精确关闭结果，清理钩子仅在再次证实资源关闭时删除 Home，主失败仍保持 FAIL。另一个实际 Local 栈中的旧进程组 `EPERM` 有独立反例：信号前成员消失的竞态下，旧实现继续向同一负 PGID 发信号；现有 Local 模块在拒绝后只于原关闭期限内观察原组和已知 PID 的实际缺席，缺席时按原状态与 journal 生成物理关闭证明，仍有成员时返回 unknown，绝不重新向该组发信号。注册 Local 文件 29/29 PASS（48.660 s、351.453 MiB），含竞态退出及持续 `EPERM` 仍存活的反例；注册 busy barrier 2/2 PASS（4.681 s、341.922 MiB）。整仓 typecheck 在 768 MiB 单进程上限内通过，总进程峰值 1097.156 MiB；512 MiB 单进程堆上限曾于客户端 typecheck 触发 OOM。上述定点证据不替代原全量 hooks 的重新验证。
- 再次原全量在第 69 项 Campaign-file Host 收尾返回 `AbortSignal.timeout`，请求行为断言未失败，随后第 70–78 项通过；在文件边界受控停止，本轮峰值 1221.109 MiB、原测试所属 PID 全部消失，远端未更新。同一注册 Campaign 文件独立运行 21/21 PASS（160.656 s、603.219 MiB）。检查发现测试共用 `bootHimaHost.stop()` 只给 15 秒，而原桌面启动器 `stop()` 默认 30 秒；这证实测试期限与产品期限不一致，但失败轮没有留下足以证明该 Host 在 30 秒内完成的回执。测试入口现沿用启动器 30 秒期限，仍要求零退出与资源确认；该 Campaign 夹具在失败时仅打印退出状态、资源关闭回执和错误，不打印完整 Host 日志。最终能否接受仍由下一次原全量 hooks 判定。

最终 L4 证据：`.scratch/himateam-issue97/local-memory-bounded/native/integration-issue101-trusted-native-issue105-final12-{log,result.json,resources.jsonl}` 与 `.scratch/himateam-issue97/issue105-live/2026-10-14T08-44-10-699Z/`。正式 App 证据：`integration-issue101-trusted-native-issue105-app-current-{log,result.json,resources.jsonl}`。测试的历史失败各有独立原始结果，未被覆盖或改记 PASS。最终原仓库钩子、commit 与远端核对另按 Issue #105 交付记录补充。

## 来源、边界和交付

证据根为 primary polishing `.scratch/himateam-issue97/`：`local-memory-bounded/native/integration-issue105-*`、`2026-10-13-parallel-next/dispatch/` 的独立 review/精确 base-post/Root 诊断、`issue105-wait-fixture-evidence/` 的原请求/原生 journal/Store 导出、`issue105-live/`、`.scratch/issue105-human-ui/`；实际 unregistered grandchild mainbody 留在 integration `.hima-tmp/issue105-case-evidence/`。失败输出不改成 PASS。

主协调 Sol/high；明确文件范围的 fresh 编码 Sol/medium；架构、复杂故障与独立 Standards/Spec/专项 review Sol/high。叶 serving model/Effort 无法独立读取时记录 requested/unobservable，产品真实模型仍为 DeepSeek `deepseek-flash`。零产品模型不等于开发助手未用 Codex quota；实际模型请求/token 未单独计量。

独立 Standards 复核无硬性违规，保留两个非阻断重复代码建议。Spec 的 partial-wait P1，以及 journal cleanup/UTF-8、monitor callback/测试清理、Step transaction 等专项发现分别有修正与复核记录；真实 L4 与最终 hooks 尚未通过前不作最终验收结论。

回退须保留原 Home/数据库与当前可用二进制。已升级 migration 7 的 Home 不用旧 migration 构建打开，不删除 Team handoff、结果、控制、记忆或资源事实，不因回退恢复旧停止任务。当前可信本机/LAN 范围不提供恶意同 UID 抵抗或新的强隔离保证。
