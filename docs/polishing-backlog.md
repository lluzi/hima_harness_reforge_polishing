# Polishing 工作单与 Step 4 接续

当前顺序（2026-09-14）：用户真人试用否定 `v0.2.0-trial.1` 的产品准入，并确认[产品升级设计树](product-upgrade-interview.md)。后续唯一现行计划是 [Product Upgrade v2](specs/product-upgrade-v2/README.md)：PLS-27～35 在现有模块上完成产品上下文、Pack、Site、离线知识、Campaign Preparation、Campaign Agent/Side Talk、完整图、可迁移 Fmax-DTCO Pack 和 held-out design 候选验收。此前 26/26 表示历史工程任务完成，不代表当前产品升级已经开始或通过。

本轮规格优先于下文 2026-09-11～13 的旧前沿和“同一个对话窗口”描述；既有实现、测试和证据继续复用。一个可见 Campaign Agent 保持唯一 Run owner，用户可在同一 DSH App 中新开独立 Side Talk，见 [ADR-0008](adr/0008-visible-campaign-agent-and-side-talk.md)。

当前顺序（2026-09-12）：[接收 ca47fa0 并在 polishing 完成 Step 4](specs/step4-takeover/README.md)。PLS-01～07 与 UI-02 保持已完成；新建 PLS-20～26，调整 PLS-08～19 的依赖。PLS-20 集成结果见 [实施证据](assessment/2026-09-12/pls-20/README.md)，后续按 Agent/输入/作者/方法身份→正式 probe→挖掘→资产/完整验收推进，不继续等待上游整体验收。以下 b4ac9d9 分析作为首轮背景，当前开工范围与模块以接续规格为准。

当前进度（2026-09-13）：26/26 个 PLS 实施任务已完成本轮验收。完整真实研究为有证据的负结果；增长控制使用独立真实模型补验，桌面使用由用户授权的独立 Agent 完成并录屏。前沿转为用户实际试用反馈与 Pack 方法质量改进，见[试用交付](validation/pilot-release/README.md)。不得把任务完成称为已验证 Fmax 提升或真人认可。

日期：2026-09-11。产品目标以 [已确认定义](product-definition.md) 为准；批次与测试层级沿用 [pilot 方案](pilot-plan.md) 和 [测试方案](testing-strategy.md)。本表保留原规划与产品动机；PLS-01～07 的实际实现、测试及边界见 [批次交付记录](assessment/2026-09-11/pls02-07/README.md)。后续任务仍按其依赖和 Step 4 交接条件开展。

实施任务已细化为 [Polishing v1 首轮规格与子任务](specs/polishing-v1/README.md)，其中明确模块、验收、分级测试和依赖；本工作单保留原 POL 编号和产品动机。

用户新增的 DeepSeek Harness UI 对标工作见 [UI-01 #20](https://github.com/lluzi/hima_harness_reforge_polishing/issues/20) 与 [对标/验证记录](assessment/2026-09-11/ui-benchmark/README.md)。首轮打磨现有导航、输入和报告阅读层级；后续聊天摘要与证据侧栏继续按现有架构及 Step 4 能力切片。

用户随后否定 UI-01 的分离页面与视觉方向，明确以旧版 himaharness 的视觉系统构建统一工程桌面。新的现行方向及实现见 [UI-02 #21](https://github.com/lluzi/hima_harness_reforge_polishing/issues/21) 和 [同屏工作区验证](assessment/2026-09-11/unified-ui/README.md)；UI-01 记录保留为历史，不是产品体验已获认可的证明。

2026-09-12 的执行迁移由同一个 owning conversation Agent 执行节点、Fabric 提供约束与事实，见已被后续决定收紧的 [ADR-0006](adr/0006-conversational-agent-owns-business-execution.md)、[执行补充规格](specs/polishing-v1/node-intervention.md)和 [PLS-19](specs/polishing-v1/tasks/PLS-19.md)。2026-09-14 继续保留一个 owner，但允许独立 Side Talk；当前执行归属以 ADR-0008 和 Product Upgrade v2 为准。

## 起点与判断

已从 prototype 的提交 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 导入 159 个文件。运行代码、Pack、Site 示例、依赖锁及测试原样保留；源项目说明移到 `docs/upstream/b4ac9d9/`。导入映射及逐文件 hash 见 [source-import.json](assessment/2026-09-11/source-import.json)。本轮没有产品源码修改。

这个基线具备真实 Host、桌面、Pack 自定义 Strategy、确定性判断/选策、多代循环、预声明 drill-down/fork-join、预算、阻塞恢复和报告。它仍只携带 `opene902-timing-probe` 参考 Pack；没有把尚未合入主线的 model-moment 分支提前拼进来。

因此工作分两段：先把已存在的执行与使用路径变成可靠的本地开发基础，再接收 Step 4 的研究能力，补齐已确认的产品要求。AI 的研究贡献、动态附加探索、知识资产交付都是首个里程碑的一部分，不能用桌面变漂亮或固定流程跑通来代替。

## 第一批：可以立即在本地推进

### POL-01：建立便宜、明确的开发验证入口（P0，先做）

**已经证实的问题。** 全新安装后直接 `pnpm run typecheck` 失败：测试通过 `@hima/harness` 的包导出读取 `lib/types/index.d.ts`，该文件要先构建生成。先构建再检查可通过。另有两个测试文件在注册时探测真实 SSH：`pack.test.ts:694`、`ssh.test.ts:187`；根目录的全量 contract 命令会包含它们。现有 pre-push 还会重复构建。

**改动位置。** `package.json`、已有 `scripts/`、`.githooks/` 和上述两个测试文件；保留 Node runner、`boot-inprocess.ts`、`boot-host.ts` 与 `driver.ts`。先用薄的显式入口区分本地、桌面和真实 Site；必要时只移动混合文件中的真实 Site 用例与其专属辅助函数，原断言继续存在。首次准备先 build，之后根据产物是否受影响安排构建；不依赖过时的类型产物。

**完成证据。** 一个新工作区能按 README 完成安装、构建和本地测试；运行本地组不会加载真实 Site 测试；29 个原测试文件中的用例都有去向，迁移前后对账。分别报告首次与重复耗时、实际通过/失败/跳过和未跑范围。没有 unit 文件时明确报告“无用例”。先解决入口，再按实测成本决定是否下移重复的桌面组合。

**实施进展。** PLS-01 已分离三个混合文件的真实 Site 用例（逐例清点补充发现 `jobs.test.ts`），建立 local/desktop/live-site 文件入口和测试资源隔离，见 [验证记录](assessment/2026-09-11/pls-01/README.md)。PLS-02 已加入一次构建的 `check:local`、不内嵌构建的叶命令、受控短子集和 hooks 编排，见 [验证记录](assessment/2026-09-11/pls-02/README.md)；hooks 尚未安装。该切片不改产品执行语义，回滚范围限于入口和测试组织。

### POL-02：让本地研究样例展示正确的研究行为（P1，POL-01 后）

**现有证据。** `packs/opene902-timing-probe/graph.yml` 默认使用 `timing-push`。诚实 stand-in 在满足约束时给出零 slack，这个 chooser 会继续放宽 period，直到预算耗尽。仓库已经有 `over-constraining-push.yml`，以及 `honest-standin.test.ts` 对照三个 Campaign 的反例。本轮已在 polishing 独立执行并通过这条测试，三个 Campaign 的预期差异得到复核。

**先作业务选择，再最小修改。** 确定用户打开 local 样例时是学习正确的 Fmax 探索，还是查看一个有意保留的反例。正常样例应有可解释的研究路线；反例继续保留在测试中。优先调整现有 Pack 的 chooser 绑定、方法说明及 local seeding，不能为修一个 Pack 的策略去改 Fabric 的通用状态机。

**完成证据。** 同一个本地受控模型下，可达目标与不可达目标得到正确而不同的结束原因；预算耗尽仍被诚实表达。记录实际测过的策略、约束与最佳有效结果，不能把“converged”说成“目标已达成”，也不能把 stand-in 的改善说成真实 EDA 收益。最低 L2 的方法对照与一条 L3 表单启动路径；真实工具结论要另做 L4。

**衔接。** 接入 Step 4 的正式 Fmax Pack 时复核这一局部改动是否仍有必要，消除重复实现。

### POL-03：打磨从输入到恢复的完整桌面路径（P1–P2）

**已有基础。** `window.test.ts` 已有表单启动、非法值、取消、失败后继续及窄窗口检查；`remote.ts`、`card-labels.ts`、`workbench.ts` 和 `client/HimaRunCard.tsx` 承载相同运行事实的不同入口。不能从“已有测试”推断完整使用体验已好，也不能预先声称这些入口都坏了。

**具体走查。** 在隔离 local home 中依次记录：首次启动与空状态 → Pack/Site/输入条件 → 提交与防重复操作 → 正在执行/等资源/等人 → 一次明确失败 → 查看原因与证据 → 继续或停止 → 报告。把可观察到的卡点拆成单独修复，不同时重写整个工作台。对话与工作台对同一 Run 的身份、状态和证据要一致。

**重点核对。** 表单的 Goal 仍写死为 `target_period_ns`（`card-labels.ts:1153`，`workbench.ts:1216`），Strategy 已由 Pack 声明。正式 Pack 到来时要核对业务是否还适用；只有新 Pack 的明确需求不能表达时才扩大声明，而非先引入一套通用表单框架。Site 的静态匹配不等于真实工具已就绪，提示须反映实际做过的检查。

**完成证据。** 每个入选问题有屏幕/操作记录、复现和原因；L2 校验数据与操作结果，L3 只保留该交互必要路径。纯文字和样式不新增镜像测试。最终由实际使用检查确认可读性、焦点、滚动与错误后的下一步。

### POL-04：把结束状态变成可复核的研究结论（P2）

**已有基础与差距。** `experience.ts:113` 已写 Site 上的 Markdown/JSON 并保存 hash；`experience-report.ts:90` 的报告主要包含 Run、代际、计量、路径和阻塞等执行事实。这些事实很有价值，但还不等于包含研究问题、算法、环境、有效负结果与后续实验建议的知识资产。

**分两次交付。** 先在已有报告与视图里明确区分目标达成、稳定但未达标、预算截断、执行故障和未形成证据，复用 Ledger 事实；随后在 Step 4 代码/模型记录可用时纳入假设、算法及脚本、引用、试验条件和下一步验证。未记录的环境或因果关系明确为未知，不由模板补出。

**完成证据。** 正常、有效负结果、覆盖不足、失败和取消的报告都能追到对应测量/日志/代码；失败或未运行的一代不支持设计结论。L1/L2 验证报告内容与 hash，L3 验证实际可达的阅读入口。分析质量及研究价值留给 L4/L5，不靠固定措辞的断言认证。

## 第二批：随 Step 4 快照接入，按依赖展开

| 切片 | 依赖与现有落点 | 具体工作及退出证据 |
| --- | --- | --- |
| POL-05：接入模型与 Workshop | 接收含对应实现、依赖锁和测试的主线快照；现有 Pack、节点执行、Ledger、视图 | 先核对新增能力和本地差异。用 replay 验证工具范围、取消/中断与代码记录，再用 DeepSeek V4 Flash 完成一项有真实输入、实际可执行产物和结果反馈的小研究。代码 hash、模型作用与工具结果可追溯；机制测试不能认证研究质量。 |
| POL-06：支持有界研究回溯与附加探索 | POL-05；`packs.ts`、`fabric.ts`、`node-turns.ts`、`workspace.ts`、`ledger.ts`、`generations.ts` | 先用一个 Pack 声明的探索点验证：保留参考图，新增工作有输入、影响节点、结束与返回条件，采用/放弃可追溯；改变策略或代码时只复用仍有效结果，受影响下游重跑。现有 revisit 和预声明 Loop 不等于此要求已完成。先验证一个位置，再扩大；不新增第二图引擎。 |
| POL-07：Pack 内知识归档与保留 | POL-04；与上游 Pack release/版本实现对齐；`experience.ts`、`packs.ts`、`local-site.ts`、已有记录 | 固定资产位置、一次运行的资产身份和必要材料；原报告保留，归档副本可核验。先解决方法文件身份与可变资产的区别。`local-site.ts:449` 当前会删除已安装的样例 Pack 后重拷，接入归档前须验证并修正资产保留路径；本轮没有宣称已发生客户资产丢失。写一半中断、重复归档、升级/迁移都不损坏历史。 |
| POL-08：让新研究用上旧知识 | POL-05、POL-07；Pack 知识与模型输入的既有入口 | 按授权选择相关资产，显式携带来源、适用条件和证据强度；当前结论仍需本次测量。方法升级由 Pack owner 确认后形成新版本；同客户升级保留资产，对外复制默认不带客户研究内容。先用有限资产集合实现，不新建知识检索服务。 |
| POL-09：完整 DTCO pilot | 前述必要能力闭环；正式 Pack、真实 Site、用户预算 | 用旧版最复杂的定制 Cell/Fmax 业务在新架构运行：输入 → AI 研究/算法 → 试验 → 反馈/回溯 → 结果判断 → 报告/资产 → 下一次引用。先小规模真实模型与工具检查，再进行完整 Campaign。保留对照条件和全部负结果，由资深工程师复核研究价值。 |

POL-06 涉及多个现有模块，适配成本必须明确估算。先拿出一条现有语义无法表达的最小用例，再定义新增记录或字段及其消费者，避免把“沿用旧文件”当成架构扩张没有成本的理由。以上代码落点是候选修改范围，并非要求全部改动。

## 最近三个交付点

1. **本地基线与测试入口。** 先收口 POL-01；交付能复现的命令、覆盖对账、耗时与未验证范围。
2. **一个可信的本地研究体验。** POL-02 加 POL-03 中实际复现的首个卡点，必要时带 POL-04 的对应结束解释；每个原因独立修改和验证。
3. **第一个真实 AI 研究切片。** 在明确的 Step 4 快照上完成 POL-05 的小任务，再处理回溯与资产要求。若上游尚未就绪，继续已有恢复/报告路径的局部工作，不复制一个竞争中的模型实现。

每个切片保留固定源 SHA、本地 diff、复现、根因、最低有效验证、原有覆盖去向及回滚方式。代码完整度和行为风险决定顺序；不按文件长度、测试数量或 UI 重写规模衡量进度。没有基于实测的估算前，不给整套工作承诺日历工期。
