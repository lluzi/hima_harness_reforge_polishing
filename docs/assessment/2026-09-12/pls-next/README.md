# PLS-21 / 22 / 13 / 19 批次验收

状态：安装态作者编译检查点的真实续跑待验证，整合后定点回归已通过；四个任务尚未统一关闭。源项目保持只读，所有修改在 polishing 与其独立 worktree。每个提交均立即 push 并核对远端 SHA。

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
| L4 作者 | 前两次失败分别是总预算不够，以及实际编译方法与批准的argv/结束路径不一致后耗尽预算；全部源文件、TEST、数据、代码与记录已归档。第三次通过实际argv/参数/图/Judge检查，但有序等价的chooser写法被语法过严的断言拒绝，尚未创建Run；已独立证明合法输入域内的等价关系并修正检查器。将保留原会话与编译检查点继续真实test/release。 |

单次短子集和完整回归成本分别记录；未选择的桌面/真实 Site 组不是通过。手写 replay 只证明协议和机制；实际模型样本没有使用 replay。模型 token 与底层 API 重试/账单调用数未测量，request steps 不冒充这些指标。真实模型只运行小型数字方法，没有执行 EDA、SSH 或完整 DTCO。

独立 Standards/Spec 审查发现的问题均有对应修复和红绿证据。原核心审查及后续关闭见 [Standards](final-verification/review-standards.md)、[Spec](final-verification/review-spec.md)；最终描述/作者指南/API拒绝与测试改动的两路独立增量审查均无新问题，见 [增量复核](final-verification/delta-review.md)。HTTP 的策略拒绝现返回409及真实原因，见 [消费者修正](final-verification/moment-http-refusal.md)。

## 明确边界与回滚

- grow/revise 现在明确返回 unsupported；完整受影响下游修订和附加节点由 PLS-10/11 接续，参考图和历史不能被删除。
- inputDigest 绑定当前执行元数据与记录版本，不是整个物理工作区文件树的冻结或 SHA 证明。Run 原方法保留不等于冻结 Harness、Site、所有输入文件与外部工具环境。
- `run-assets/<runId>/` 的身份隔离和更新保护已提供；完整知识归档/复用、正式 AES probe、EDA/Fmax、复杂 DTCO 与真人使用验收属于后续任务。
- Ledger 导入是显式离线v19→新空v20 home，保留原字节备份和回执；不升级原 home、不复制Site/Pack/工作文件/Agent、不直接授予owner。参见 [导入](../pls-19/ledger-import/README.md)。
- 回滚先停止新接纳，保留真实Job/Run、资产、方法历史和导入原件；不能让旧构建读取v20或恢复会删除客户资产的旧seeding。独立工作分支保留每个可追溯切片。
