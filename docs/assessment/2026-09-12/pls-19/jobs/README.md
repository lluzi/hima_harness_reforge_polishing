# PLS-19：Jobs / 节点机制切片

基线为 `ad84d2f`，工作分支 `codex/pls19-node-jobs`。这是 PLS-19 的机制子任务，未宣称对话 owner、控制版本、UI、模型介入或整个任务已完成。测试前的源码身份见 [source-snapshot.json](source-snapshot.json)；对应源码与故障 fixture 随本提交保留。

## 已实现的接口

| 接口 | 责任和回执 |
| --- | --- |
| `Driving.nonblocking` | `toolNode`、Pack reader 与 `launchWrittenWorkshop` 实际启动后返回 `pending/session`；容量只数一次，不能启动则返回 `at-cap/reason`，不排队、不稍后自动补启动。未启用时保留旧等待行为。 |
| `LaunchRequest.beforeLaunch(intent)` | Permit、session、workspace、wire、node/branch/attempt、licences、reading/workshop metadata 已确定；回调必须在唯一的 `tmux new-session` 之前完成。回调拒绝则不启动。PID 尚不存在，不能出现在 intent 中。 |
| `JobDeps.beforeSlotClaim(siteName)` | 在现有 Site 容量串行区内、计数之前执行。集成方必须在这里重建该 Site 所有 Run 的未闭合 intent；不确定则抛错阻止任何新接纳。它不引入另一个容量锁或服务。 |
| `reconcileLaunchIntent` | 已有 launch 回执则返回 `existing`；真实 session 或有效 exit 文件确认已启动后补 `launched` 并返回 `reconciled`；不能确认则 `uncertain`，绝不启动。丢失原启动响应时 `JobIdentity.pid` 缺省。随后用现有 `jobStatus` / `resumeNode` 收集事实。调用方串行化同一 intent 的恢复。 |
| `buildWorkshopScope` / `resolveWorkshop` | 无须打开模型会话；复用 Pack、Permit 和路径解析。返回真实 `workshopAbs`、`entryAbs` 和声明的 `produces.path`。`executionId` 为 `[A-Za-z0-9_-]{1,128}`，脚本进入声明根目录下 `.executions/<id>`；输出位置不跟着移动。 |
| `writeIntoWorkshop` / `readForWorkshop` / `knowledgeForWorkshop` | 从原 Workshop tools 移出的同一实现，继续保持受控范围、拒绝记录、字节回读与 code hash。原模型工具仍调用这些函数。 |
| `launchWrittenWorkshop` | 检查本 Run/node/attempt/branch/session/私有目录中各路径的最新 code 版本（包含辅助文件），再走通用 Job 路径；不调用 `openMoment`。 |
| `exploreRecommendation` | 从既有 `exploreNode` 分出只读建议计算；不写 decision，不接受建议，不移动 Run。旧模式 adapter 复用同一建议计算。 |
| `FabricDeps.stopSignal` / `Driving.stopSignal` | 停止后台等待/轮询，不终止独立 Site Job。Host 关闭前必须等待已启动的事实任务退出，之后再关闭存储。 |

新模式的 `attempts` 由主任务的持久节点接纳计数一次；本切片在真实 launch 后只增加 `jobsLaunched`。因此同一执行遇到 `at-cap` 后再次提交不会在这些 helper 中重复计 attempt。旧模式计数保持原语义。

脚本目录隔离和 hash 检查不等于文件系统不可变。集成方必须在每次受控写入前检查 owner、控制版本和 execution 写阶段，禁止原地修改在途版本；普通 Coding 与 Run execution 的有效性边界属于主任务/PLS-11。

## 验证

Node 24，冻结 lockfile，独立 worktree 的依赖从 polishing 私有 store 离线安装。没有修改两个只读源仓库。

| 检查 | 结果 |
| --- | --- |
| [意图写失败反例](intent-red.log) | 修复前 0/1；旧代码忽略回调，`assert.rejects` 未发生。 |
| [容量非阻塞反例](cap-red.log) | 修复前 1/2；旧 helper 等待后返回 `claimed`，预期为 `at-cap`。 |
| [新增机制用例](focused-final.log) | 10/10，25.814 s，13 次真实 in-process Host 启动（包括真实子进程中的 Host），0 SSH、0 Electron。 |
| [既有 Jobs / Workshop Host 回归](regression.log) | 15/15，27.347 s，13 次 Host 启动，0 SSH、0 Electron。 |
| [完整构建](final-build.log) | 通过。测试使用本次源码构建出的 `lib/`。 |
| [完整类型检查](final-typecheck.log) / [最终测试源码类型检查](final-test-typecheck.log) | 通过；正常 launch 的本地及 live 测试显式检查 PID 存在。live 测试只检查类型，没有执行。 |
| [Seams](seams.log) / [Pack boundary](boundary.log) | 通过。`git diff --check` 通过。 |

10 个机制场景覆盖：意图持久化失败禁止启动；容量回执不排队；普通 act 返回真实 session；停止 Host observer 不杀 Job；Workshop 私有版本/辅助文件被修改/越界写/允许知识读取/无新模型会话；三种实际 SIGKILL 窗口；Pack reader 在读回前不完成；chooser 只给建议；未闭合 intent 钩子拒绝新启动。

故障 fixture 使用真实 Host、Ledger、本地 tmux 和真实文件 barrier，没有替换 Ledger 方法。`before-launch` 在意图文件已落盘但 tmux 未调用时杀 Host；其余窗口用测试自有 tmux wrapper 先执行实际 `new-session`，再扣住 stdout，使 Host 无法写 launch 回执，分别在 Job 存活和 exit 文件出现后杀 Host。测试断言 `child.kill` 成功且退出信号确为 `SIGKILL`，重启真实 Host 后查询原 session/exit，补回执且不重复启动。清理只针对测试的进程、确切 session 和私有临时目录。

此 fixture 的 intent 回调持久化到真实文件，验证 Jobs 对调用方持久化完成的时序；最终 Ledger control/NodeExecution intent 的集成与所有者/请求去重仍由主任务另验，不用该文件 fixture 代替产品持久控制存储验收。chooser 用例的输入是明确标注的 typed fixture，既有 Workshop 回归含机制 replay；都不证明真实模型或 EDA 研究能力。

L3、L4 模型、SSH/Site、EDA 与完整 PLS-19 验收未运行。代码回滚可移除新增 opt-in API，但写入缺省 PID 的恢复回执后不能直接用旧 schema 打开该 Ledger；需要恢复隔离存储快照或保留兼容读取，最终 schema 迁移/回滚由主任务负责。已有正常 Job PID 保持原字段与值，旧等待路径由独立防御检查拒绝意外收到非阻塞 Step。
