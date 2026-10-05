# DBOS / ATCS 迁移验收

2026-10-05：冻结的 macOS App 完成了一次真实 ATCS 全流程。五个任务自动完成，首次不合法交付由原生会话自动修正，随后自动评估、报告、归档和收束。独立操作员通过普通界面打开了报告、checkpoint、ECO、脚本、原始 Timing 和复现说明，并正常退出；本次所属本地与远端资源关闭已另行核验。

本次工程结果是 **best-effort，Goal 未达成**。本页保留 source32a 真实运行的原身份与结论；当前 Mac 发布及剩余验收范围见以下更新，Linux 与整套旧语料已移出本轮门槛。

2026-10-05 更新：U9 已按用户授权的 Mac-only 规则关闭。当前普通 App/Pack 发布封板与验收入口见 [Mac 试用发布](mac-trial-release.md)；用户签收待取得。下文真实 Run 与原指标保持原身份，历史平台/整套旧语料不再作为本轮门槛。

## 四项结论

| 项目 | 本次结论 | 范围 |
| --- | --- | --- |
| Durable migration | PASS | 已测试的故障/恢复机制与本次自动交接、原身份修复、持久结果及实际收束；剩余平台/语料契约单列 |
| Product journey | PASS，保留体验与隔离限制 | 单个新 Run、普通安装/准备/追问/交付打开/正常退出，无开发者救援或人工 completion；Guide 曾自行探查实现，操作员立即停止且未使用其输出 |
| Timing result | Goal not met | Hold 清零，Setup 改善但仍有 18 个违例 |
| Adoption scope | LIMITED | XTop prediction-only；四项全局 collateral 与 regression 为 UNKNOWN，未证明物理采用/签核 |

与 common R1 的原始报告比较：

| 指标 | 修复前 | 选中结果 r1final |
| --- | ---: | ---: |
| Setup WNS / TNS，ns | −0.038 / −0.2306 | −0.0237 / −0.0973 |
| Setup 违例 | 28 | 18 |
| Hold WNS / TNS，ns | −0.1523 / −4.7021 | 0 / 0 |
| Hold 违例 | 109 | 0 |

没有新建独立 AutoFix 对照 Campaign；上述是本次工程任务相对其 common 阶段的实测变化。用户本人最终签收尚未取得。

## 冻结身份与实际运行

- App 来源：`32a03eb4d8b31454d64525d3465566a17768b72e`；外部原生义务报告工具来源 `b8f63256e45f4b91f769603dd8423f5123c8649e`。
- App artifact digest：`f3761080797de7cc6d2d85f11eae2f1309514ca68a236d9847b6e043ef92e9a1`。
- ATCS 0.4.0 digest：`ede79ecaf59981fa8107962298b5c2c12ce01bb00b8862118b4738a177f3c83e`。
- Run：`run-e7ed880e-5d24-44b8-9b92-0e72bd63129d`。
- Campaign：`agentic-timing-closure-system-20261005-002400-ad70`。
- 120 分钟原预算、15 分钟收束预留；DBOS 根流程于 02:14:07 UTC 完成，早于 02:24:00 UTC 硬截止。没有续期。
- 模型仍为 `deepseek-flash`，既有环境变量供认证；编排、数据库和 App 全本地。独立操作员请求模型为 Sol 6.1 medium，没有 Claude review 或实操。

完整身份见 [candidate-manifest.json](candidate-manifest.json)，结构化结论见 [acceptance.json](acceptance.json)。IR 来自未改动的冻结已安装 Pack 与相同编译源码的确定性重读；不冒充退出后重新查询过 PG 内的定义。

## 失败、修正与资源

首次 Reader 物理退出 1：`remaining` 包含字符串，而 Reader 要求事实对象。产品向同一原生会话发送修正要求，保留原 baseline、common、ECO 和工程工作；第二次 Reader 物理退出 0，最终结果提交后自动进入评估和交付。操作员未提供内部修正脚本或旧 ECO 答案。

交接期间的重复许可根解析导致大量 SSH 往返，延迟已结束 Reader 的收取。新源码提交 `e7a777e7` 优先尝试可能包含实际文件的字面根，所有尝试仍实时解析并检查包含关系，别名根保持可用；没有缓存、TTL 或减少摘要检查。真实 25 目录反例由 26 次解析降为最多 2 次。独立复核接受，集成后的 10 项定点检查、全类型与边界通过。

一次后续只读观测用新模块核验原修订交付的 218 个文件：658 次远端命令，13.612 秒，全部摘要通过，审计无丢失，零产品模型/EDA。历史一次同数量文件扫描约 289 秒；两者不是受控基准或稳定 p95。观测自己的 SSH 控制连接也已自然消失。记录见 [read-permit-remote-observation.json](actual-run/read-permit-remote-observation.json)。

首次失败 Reader 的退出码在旧 Job 投影中丢失。后续源码修复仅保留真实观察到的数值；旧事实缺数值时仍为未知，不解析错误文字补造历史。原冻结 Run/报告/事实没有改写。真实 Host/PG 的 exit7、exit0、缺历史元数据证明与四项附近回归分别通过，独立复核接受。后续源码修复不等于原 source32a App 已包含这些变更。

远端核验覆盖本次 7 个记录 Job 的 PID/进程组和 tmux 会话、原生 signed-owned 的 PID/进程组/子孙，以及其精确容器 ID：全部无活动资源，签名 `quiescent: true`、`phase: released`。正常 Quit 后，本地本次 App/Host/PG 及此前记录的子进程均为零。没有强杀昂贵 EDA 或清理其他工作。证据：[远端](actual-run/owned-remote.json)、[本地](actual-run/owned-local-after-quit.json)。

## 材料与剩余资格

[操作记录](actual-run/operator-report.md)、[实际 REPORT](actual-run/REPORT.md)、[实际 JSON](actual-run/report.json)、[证据索引](evidence-index.json)保留了入口、错误、普通打开/下载和校验范围。Guide 源码探查、文件选择按钮无响应、阶段性状态表达和短暂报告未写入提示均保留；这不是无摩擦的首次使用声明。截图/AX 在工具会话中保留，没有虚构磁盘录屏。

已下载的工程包为 81,317,581 字节，SHA256 `3d78c1ea0a87d3864adb367856e052370a97f6e0d8c339bd0ad23b37b724d4ae`。大包在本地证据索引指向的位置及原 Site 工作区保留；不写入 Git。checkpoint 作为文件实际打开，未重新恢复执行 XTop。

[U9 原生资格](U9-native-qualification.md)记录实际 Mac/Linux 分发物、冷备份、许可通知/源码/替换证明及外部原生义务报告。新 Mac 非管理员账户、真实 Linux 硬件/物理桌面资格尚未取得；当前 Linux 证据是 Ubuntu22 x64 用户空间在 Mac 上模拟的隔离桌面。不能声明两个平台全部交付完成。

原始完整 local 基线仍是 954 项、713 PASS / 238 FAIL / 3 SKIP。已修复的实际问题和已迁移用例各有定点证据，其余有效业务、权限、历史、预算和资源契约须逐项对账，不能整批删除或写成全绿。正式 Pack VERSION、App 发布以及整个计划完成仍以实际资格为条件。
