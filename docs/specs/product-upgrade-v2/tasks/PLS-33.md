# [PLS-33] 在现有 Workbench 投影完整业务运行图

状态：ready-for-agent
父规格：[Product Upgrade v2 / #30](https://github.com/lluzi/hima_harness_reforge_polishing/issues/30)
Issue：[PLS-33 / #37](https://github.com/lluzi/hima_harness_reforge_polishing/issues/37)
模型：`gpt-5.6-terra` / medium
最低测试：L0 + 既有 L2 graph + 一条 Catsights L3

## 用户场景

用户查看 Campaign 时能立即看见完整参考图、当前位置、实际状态、增长/回溯和需要关注的节点；点击后查看输入、输出、Job、代码、知识和证据。页面不再由内部 ID、预算和无用记录占据主体。

## 当前证据

- `fabric.ts:executionContext` 已返回全部 nodes、available、executions、growths、revisions和 `method.reference`。
- `client/api.ts:fetchExecutionContext` 已存在。
- `HimaWorkbench.tsx:ExecutionTrace` 只渲染 `RunView.nodes` 中已经发生的线性 transition，没有边和未运行节点。
- `HimaWorkbench` 已有 Live/Experiments/Evidence/Report、Material、Archive、Workshop 等视图，主要问题是信息层级而非数据缺失。

## 固定代码范围

- `packages/harness/src/client/HimaWorkbench.tsx`：`HimaWorkbench`、`RunSummary`、`ExecutionTrace`、`JobActivity`、`EvidenceTrail`。
- `packages/harness/src/client/HimaRunCard.tsx`：复用现有 Growth/Revision/Workshop/Material/Archive/Experience sections。
- `packages/harness/src/client/workbench-style.ts`：当前视觉系统内的 graph、node、inspector和 notice 样式。
- `packages/harness/src/client/api.ts`：只消费已有 `fetchExecutionContext`；共享修改由集成者完成。
- `packages/harness/src/remote.ts`：仅当现有 view缺少用户必须看到的已存在事实时，由集成者增加投影。
- `test/contract/campaign-graph.desktop.test.ts`：新增；复用 graph/growth/revision Host tests和 `unified-workbench.test.ts`。

## 精确增量

1. 在当前 Live Run pane中读取 `fetchRun` 和 `fetchExecutionContext`，以 reference nodes/edges为图骨架，叠加 actual node/execution/growth/revision状态。
2. 开始前显示完整参考图；运行中区分 planned、available、running、waiting、done、blocked、cancelled、invalidated和added work。
3. Hover展示一句摘要；click打开同一 pane内 node inspector，显示类型、输入、输出、工具、当前 evidence、Job、代码/知识和可用控制。
4. 顶层只保留 Campaign名/Pack/design/Site、Goal、当前节点、下一行动、attention和主要状态。Run ID、hash、meters和原始 records放入 details。
5. Side Talk查看非 owner Campaign时只显示 Open Campaign Agent/请求人类控制入口，不给 owner业务动作。
6. Files、真实 terminal、evidence和report继续在现有 DSH右侧工作区，不创建独立页面或状态副本。

## 保持项

- 图只投影 Fabric/Ledger事实，不拥有状态转换。
- 不新增图数据库、布局服务、Campaign管理系统或另一个 workbench。
- 参考图不可改/删；growth/revision保留原身份。

## 验收标准

- 零 transition的 Campaign仍显示全部 reference nodes/edges。
- 已运行、增长、回溯、invalidated、暂停和取消状态与 Host context一致。
- 51节点级图可以滚动/缩放/定位当前节点，用户无需读原始 JSON。
- 点击一个节点能到其真实 Job、代码、知识和证据；不存在的材料明确说未形成。
- 主界面不以 Run ID、hash、预算细节或空板块为视觉中心。

## 测试

- L2复用：`agent-graph.host.test.ts`、`growth.host.test.ts`、`revision.host.test.ts`，不新增图语义实现测试。
- L3：Catsights 上 `campaign-graph.desktop.test.ts` 覆盖完整图、一个 growth、一个 revision、一个 attention节点和 inspector；不逐边点击。
- 视觉/文案改变不触发模型或 EDA。

## 依赖、并行与回滚

依赖 PLS-31完成 intake UI、PLS-32固定 owner语义。本任务是 `HimaWorkbench.tsx`/`HimaRunCard.tsx` 的唯一后续所有者。回滚只恢复旧 presentation，不修改 Run/Graph/Ledger 数据。
