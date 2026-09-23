# S12 — 影响验证、可安装交付与独立业务价值证据（NXT-J1 / J2 / J3）

状态：实施规格；基线 `1a79cb1514364aa049e775d7b18bbb063a223092`。发布验证不扩大为完整商业 EDA 研究；J3 的真实业务价值试验须取得独立、明确的恢复授权。候选生态清单仅是候选，不是已安装/挂载/验证声明。

## Problem Statement

当前仓库有 `scripts/package-trial.mjs` 和 `trial-package.test.ts` 的候选 App 打包/失败关闭入口，且 Pack 已有独立的 release seal、transfer review、install/upgrade 与资产迁移机制。它们不是同一个发布身份：App 是运行时字节/安装物，Pack 是被 contract/version/test evidence/digest 固定的方法。把任一方的通过冒充另一方，或把低成本发布验证扩大成完整 EDA 研究，都会损害可恢复性和结论诚实性。

此外，J1 要按影响资格化生态候选、pin/许可/消费合同/退出边界和小型真实模型测试；当前 `package-trial` 及 replay/stand-in 不能证明真实模型、真实 Site 或真实业务收益。J3 的陌生用户、真实闭环和客户价值比较需要受控的独立授权和相同输入/工具/预算基线，不能借日常发布自动开研究。

## Solution

在现有发布清单和验证文档内分别记录三类 delivery evidence：`ComponentQualification`（J1）、`ReleaseManifest`（J2）和 `ValueStudyCharter`/`ValueStudyResult`（J3）。每项标明 planned/installed/mounted/qualified/verified、版本/identity、消费点、许可/网络/数据范围、影响测试、退出/回滚和未验证范围。

App ReleaseManifest 绑定打包字节、平台、安装/升级/卸载与 App rollback；Pack ReleaseManifest 引用现有 `VERSION.yml`、method digest、TEST Run、transfer review/receipt、兼容和资产迁移。二者可出现在同一交付说明中，但分别记录身份、分别升级、分别回滚。J2 仅按改动影响跑 L0/L2/L3 和必要的小型真实模型检查，不启动完整 EDA study。J3 在独立批准的 Charter 下比较使用/人工基线与实际价值；负结果、覆盖不足和未知照实报告。

## User Stories

1. **作为发布者**，我希望候选组件显示 planned、installed、mounted、qualified 或 verified 及 pin、许可、消费者和退出边界，从而不把依赖存在称作已集成。
2. **作为 App 用户**，我希望一次运行时变更只生成 App identity 与影响测试证据、无需跑源码，从而不改变已安装 Pack 的 method digest。
3. **作为 Pack 使用者**，我希望方法更新只生成 Pack seal/digest、TEST evidence 和 transfer review，从而不将其误称为 App upgrade。
4. **作为遇到回归的 App 用户**，我希望按 App release receipt 回到上一个可安装版本，从而保持客户 Pack、Run archive 和 Site 配置不变。
5. **作为升级 Pack 的用户**，我希望先看准确 manifest 和兼容说明，从而使确认后旧 Run 仍按原 method digest 重现并保持 run-assets。
6. **作为发布审核者**，我希望候选缺 contract、知识 manifest、test evidence 或 seal/hash 一致性时失败关闭，从而不产生“可试用”标签。
7. **作为发布工程师**，我希望验证仅覆盖受影响的 local/desktop/small-model slice，从而不会在未授权时连接商业 Site 或启动完整 EDA/DTCO 研究。
8. **作为陌生试用用户**，我希望能够发现 Site、完成准备、查看/控制/恢复并取得交付物，从而将卡点记录为具体体验事实。
9. **作为已获授权的价值研究负责人**，我希望以相同输入、工具、预算和目标对照人工干预并记录成本、交接和结果，从而将不可比较指标标为 unknown。
10. **作为评审价值结论的人**，我希望未达到 Fmax/效率目标时仍保留负结果和证据，从而不以安装成功、Agent 自述或单一 demo 替代客户价值。

## Implementation Decisions

### 现有路径、符号与文件所有权

下表未带目录的 TypeScript 文件均相对 `packages/harness/src/`。

| 路径 / 符号 | 已核实现状 | 拟议增量 | 文件所有权 |
| --- | --- | --- | --- |
| `scripts/package-trial.mjs` | trial candidate 的打包/验证入口；细节资格仍需逐版本核对 | 复用现有 `verify`、`trial-manifest.json`、`smokeVersionIsolatedTrialHome`/`smokeRelocatedHost`；仅补受影响检查和回滚引用；不等于 EDA certification | Delivery owner |
| `test/contract/trial-package.test.ts` | help inert；不完整 App/缺 Pack contract 或 knowledge manifest 失败关闭 | App manifest/upgrade/rollback 的相邻 contract 断言 | Delivery owner |
| `release.ts:releasePack`, `packVersionFile`, `installPackMethod`, `previewPackTransfer`, `applyPackTransfer`, `readPackMigrationReceipt` | Pack seal、method transfer/upgrade、审阅 hash、迁移 receipt | Pack release identity/资产证明投影；不把它变成 App manifest | S10 release owner；共享 route 由主集成者 |
| `scripts/run-contract-tests.mjs`, `test/contract-groups.json`, `docs/testing-strategy.md` | L2/L3/live-site 的现有分组与成本边界 | 每个 manifest 指向最小影响组/命令、未跑范围 | Delivery owner |
| `packages/desktop/`, root `package.json`, `packages/harness/package.json` | App/runtime 与 Harness package 的实际构建边界 | App 版本/字节/平台/安装路径须由 implementation 再核实，不从 package name 推断 | App release owner |
| `Ledger`、`experience.ts`、Pack archive、report/test records | 运行、经验、归档/证据 authority | J3 只引用真实 trial 证据；不新建价值事实库 | J3 evidence owner；共享 schema 仅主集成者 |

新文件只能是 release manifest、qualification record、value-study charter/result 或现有测试 fixture，且必须有明确的 package/installer/report consumer。不得创建 SaaS telemetry、全局产品分析平台、第二 artifact store 或自动真实研究 runner。

### 拟议合同、错误与顺序

`ComponentQualification` 拟议：`{ component, versionPin, licenseScope, consumerRef, status: 'planned'|'installed'|'mounted'|'qualified'|'verified', evidenceRefs[], exitBoundary, limitations[] }`。`AppReleaseManifest` 扩展现有 `scripts/package-trial.mjs` 输出的 `trial-manifest.json`（format 2、source SHA/dirty/diff hash、files、ad-hoc signing）；不得另建同事实的第二manifest。拟议新增消费字段：`{ appVersion, artifactDigest, platform, runtimeInputs, compatibility, impactedChecks[], rollbackRef, status }`。`PackReleaseManifest` 引用而不复制 `{ packId, contractVersion, methodDigest, versionFileRef, testRunRef, transferReviewRef?, migrationReceiptRef?, compatibility }`。`ValueStudyCharter` 拟议：`{ authorizationRef, scope, inputIdentity, tool/site/model/budget, comparisonPlan, stopConditions, dataHandling }`；没有 `authorizationRef` 不得开始 J3。

顺序：分类改动影响 → 盘点组件/许可证/消费者与既有身份 → 构建候选 → 跑最低影响检查 → 独立记录通过/失败/未跑 → 分别生成 App 与 Pack manifest → 对 Pack 先 preview、显式 review hash、再 apply/install → 读回 identity/receipt → 提供 rollback。J3 另行：取得明确授权 → 固定输入/工具/预算/比较方法 → 执行获批的最小真实试验 → 记录结果/成本/unknown → 独立复核后报告。错误优先级：授权/许可/范围拒绝 → identity/manifest 格式错误 → component 未 pin/无 consumer → artifact/Pack evidence 缺失或 hash 不符 → 影响测试失败 → stale review/destination/asset ownership 冲突 → install/rollback/readback 失败 → J3 预算/stop condition/真实环境不可用。任何失败均不得提升 verified/value-proven 状态。

### 子切片、依赖与并行

| 子切片 | 依赖 | 并行 / 所有权 | 交付 |
| --- | --- | --- | --- |
| J1-a：组件清单和影响矩阵 | 无 | 可与 S10 G2、App manifest 设计并行 | pin/license/consumer/exit/status/evidence 表 |
| J1-b：最小资格检查 | J1-a、真实 consumer 已确定 | 与 Pack 交付并行 | L0/L2/小型模型资格结果，非完整 EDA |
| J2-a：App identity/installer/rollback 合同 | package-trial 当前行为核实 | 与 S10 G3-a 并行 | App manifest 与失败关闭矩阵 |
| J2-b：Pack identity/upgrade/asset contract | S10 G3-a | 串到同一 release owner | seal/review/receipt/恢复说明 |
| J2-c：交付清单和最小回归 | J1/J2-a/b | **主集成者**接共享 package/route 文件 | 两种身份、兼容、未跑范围 |
| J3-a：价值 study charter | 用户独立恢复授权；J2 evidence | 可做协议设计，不能执行 study | 对照、隐私、预算、停止条件 |
| J3-b：受控真实试验与报告 | 已批准 J3-a；Site/模型/数据资格 | 单一 evidence owner，非发布阻塞默认项 | 可复核正/负/unknown 结果 |

## Testing Decisions

J1/J2 最低命令：`pnpm run build`，然后 `pnpm run test:local --files test/contract/trial-package.test.ts test/contract/pack-method-assets.test.ts test/contract/pipeline-finalize.test.ts test/contract/experience-files.test.ts`；package candidate 的脚本语义由 `node scripts/package-trial.mjs --help` 和其 contract 测试验证，正式实际参数须先查脚本当前接口。App 窗口/升级或 Ledger-version 改动才加 L3：`pnpm run test:desktop --files test/contract/desktop.test.ts test/contract/window.test.ts test/contract/ledger-version.test.ts`。`test/contract-groups.json` 是分组 authority，执行前在 Node 24 下用 `pnpm run test:local --list` 或 `pnpm run test:desktop --list` 核验选集。Pack 发布行为继续用 S10 的 pipeline/asset tests；不以 `test:unit` 的零文件退出当覆盖。

正例：组件有 pin/consumer/exit/evidence；App 与 Pack 各有独立 identity；exact preview hash 后成功 Pack upgrade；旧 Run/资产可读；不完整 candidate fail closed；有明确 charter 的价值试验记录真实正/负结果。反例：把 installed 当 verified；App package 成功称为 EDA 研究；Pack seal/hash/test 不一致；stale review；未知客户资产被覆盖；没有授权启动 J3；replay/self-report 成为价值结论；失败/未跑仍标发布合格。所有测试当前暂停，以上均未运行。

## Out of Scope

- 不把发布验证扩大成完整商业 EDA、DTCO 或 Library 研究；这类 J3 工作另需恢复授权。
- 不实现新组件安装、自动上传/telemetry、云发布平台或客户数据外发。
- 不改变 S10 的作者五阶段/Pack ownership，或用 App manifest 代替 Pack seal。
- 不恢复测试、执行产品/EDA/模型、安装依赖 或触碰 `tmp/`。

## Further Notes

资格门：J1 的每个候选必须先证明已 pin、许可允许、实际 consumer 存在、退出边界和最小证据；不存在则只能是 planned。J2 App 安装/升级/回滚的真实平台、签名、installer 和 artifact identity需要在当前 script/desktop 实现中专项核实，不能从 `package-trial` 名称推断。J3 必须有用户明确恢复的独立授权以及 Site、模型、输入、预算和数据处理许可；发布完成不自动授权它。真实模型小测试也只证明其声明范围，不等于业务价值。

回滚：App 按其 manifest 的前一 artifact/installer rollback；Pack 按 `release.ts` 的 sealed historical method、review receipt 和保留 run-assets rollback，二者互不覆盖。资格/价值记录 append-only，撤销展示或候选版本不删除客户资产、旧报告或负结果。模型分配：J1/J2 文档、影响矩阵、普通 contract 变更用 `gpt-5.6-terra` / medium；release identity、资产迁移、许可/数据范围与 J3 真实性复核用 `gpt-5.6-sol` / high；共享 `index.ts/remote.ts/tools.ts/fabric.ts/ledger.ts` 与 `profiles/hima/cordis.patch.yml` 只由主集成者按依赖顺序接线。
