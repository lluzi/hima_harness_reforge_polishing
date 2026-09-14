# [PLS-31] 将现有检查加深为 Campaign Preparation

状态：ready-for-agent
父规格：[Product Upgrade v2](../spec.md)
模型：`gpt-5.6-terra` / medium
最低测试：L0 + 定点 L2 + 一条 Catsights L3

## 用户场景

用户在普通对话中安装/选择 Pack 后询问如何运行。HimaGuide 主动发现 Site、design、输入和知识，全部完备后给出简短 Campaign proposal；用户只确认一次，随后当前会话成为 Campaign Agent。准备失败不创建 Campaign。

## 当前证据

- `packages/harness/src/index.ts:startPreparation` 已加载 Pack/Site 并调用 `checkPack`。
- `remote.ts:startChoices` 已返回安装列表、goal、strategy、words 和静态 check，但会默认选择第一个 Pack/Site。
- `client/HimaWorkbench.tsx:StartRunForm` 直接展示 Goal、Strategy、timeBox、retries、generations 表单并启动 Run。
- `workspace.ts:prepareWorkspace` 已在正式 start 中处理身份、Permit、占用和复制；它不应在 Preparation 中提前制造 Campaign workspace。

## 固定代码范围

- 共享接线：`packages/harness/src/index.ts`、`remote.ts`、`paths.ts`、`tools.ts`、`client/api.ts`，由主集成者独占。
- `packages/harness/src/run-arguments.ts`：继续作为确定性 Goal/Strategy/预算校验，不扩成向导。
- `packages/harness/src/client/HimaWorkbench.tsx`：`StartRunForm`、空状态、Pack/Site/Preparation 入口；本任务是该文件的第一 UI 所有者。
- `packages/harness/src/client/index.ts`：只使用现有 sessions/conversation/directory-picker seam。
- `test/contract/preparation.host.test.ts`：新增；复用 `start-form.test.ts`、`input-admission.host.test.ts`、`pack.test.ts`、`start-form-window.test.ts`。

## 精确增量

1. 加深现有 start preparation 为一个结构化 `PreparationView`：PackOverview、Site discovery/readiness、输入 identities、知识 readiness、最小 tool probe、Goal proposal、reference graph、unknowns 和整体 ready。
2. Preparation 是读取/检查操作：不创建 Run、workspace、Job、Ledger Campaign row 或隐藏 Agent。
3. Pack/Site/design/knowledge/probe identity 任一变化后，旧 proposal 不能确认；重新读取后才产生新 proposal identity。
4. 为 HimaGuide提供一个窄的 `hima_prepare` 工具或对现有 `hima_pack_check` 的单一加深入口；同一函数同时服务 Host route 和 Agent tool，避免两套准备逻辑。
5. 空状态提供了解 Pack、安装 Pack、连接 Site、继续普通 Coding；不自动选择第一个 Pack/Site并假装这是用户意图。
6. 普通入口通过对话准备。高级表单保留在折叠区，继续使用同一 validator，不成为第二种 start 语义。
7. 用户确认 proposal 后调用现有 `hima_run/startRun`，固定 proposal 的 Pack/Site/input/goal 身份；当前会话成为唯一 owner。

## 保持项

- 不新增 Preparation 数据库、列表、Campaign manager 或第二表单框架。
- `startRun`、`prepareWorkspace`、Permit、goalFrom/strategyFrom 和 Ledger 保持最终接纳权威。
- Preparation 的通过不是 Site/EDA 业务结果，也不进入正式 Campaign 报告。

## 验收标准

- 空/缺 Pack、缺 Site、SSH 不可达、输入有歧义、工具 probe 失败均不创建 Campaign，并返回下一行动。
- 准备齐备时 proposal 含用户可理解的目标、design、Site、Pack、图、工具、资源和未知；内部参数折叠。
- stale proposal、重复确认和并发修改不会产生重复 Campaign。
- 一个 Campaign 对应一个持久 Run和当前 live owner。
- 用户不需要读 YAML、输入 Home/Run ID 或手填已发现事实。

## 测试

- L0：build/typecheck/seams/boundary。
- L2：`pnpm run test:local --files test/contract/preparation.host.test.ts test/contract/input-admission.host.test.ts test/contract/start-form.test.ts test/contract/pack.test.ts`。
- L3：Catsights 上只保留一条空状态→对话准备→proposal→确认路径，复用 `start-form-window.test.ts`/driver；不运行模型或 EDA。

## 依赖、并行与回滚

依赖 PLS-28/29/30 的稳定读取结果。共享接线文件只由主集成者修改；PLS-33 在本任务完成 `HimaWorkbench.tsx` 后接管该文件。回滚恢复旧高级表单入口，不能删除已创建 Campaign、Site profile 或知识。
