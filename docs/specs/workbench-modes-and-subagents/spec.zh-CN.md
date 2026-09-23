# Campaign / Data Insight 同级工作模式与 Subagent 独立会话

日期：2026-09-23。源码基线：`ce02f2eaa7ff3b8788f524a4e412f06e6c1fdf28`。

跟踪任务：[WORKBENCH-02 / #51](https://github.com/lluzi/hima_harness_reforge_polishing/issues/51)。

状态：用户已明确产品方向；本文固化需求与验收，具体接口为拟议方案，尚未实施。当前测试保持暂停。

## 1. 信息层级

Campaign 与 Data Insight 是面向人的两种同级工作模式。Live Run 是 Campaign 的执行视图；Data Insight 不是 Live Run 或 Campaign 详情中的一个子页。它也不是 DSH Standard/Code/Minimal 这类工具组合模式。

```text
Start：选择工作，或直接向 HimaGuide 描述需求
  ├─ Campaign：准备 → Live Run / Generations / Evidence / Report
  └─ Data Insight：选择数据 → 表图与发现 → 条件化比较 / 证据 / 下一步

两种工作都可打开：Agent 团队与独立 Subagent 会话、Files & Code、Terminal、证据与产物
```

沿用已有对话区、右侧 Workbench/dock、标签样式、主题、字体、图标、表格、卡片、错误提示和文件打开方式。增加同级标签及相应 body，不新建一个独立 BI 应用，也不重复实现一套侧边栏、聊天框架或执行引擎。

2026-09-23 R1 补充：用户确认 Guide 为独立长期入口，执行任务使用独立会话/上下文；派工不占住
Guide。耗时 Data Insight 沿用持久受控任务/Run，具备进度、预算、取消与恢复，前台仍为 Insight。
用户可在 child 委派范围内直接调整执行并同步 owner。R2 确认 Guide 聚合摘要和出处，普通进度更新
面板，需人处理及最终结果主动提醒；Guide 可代传明确任务的控制，由 owner/Host 实施并回执。
R3/Q14 确认同一 Guide 入口按工程工作区保留独立历史和工作记忆；个人偏好经确认共享，跨项目材料
明确引用。以上为目标行为，实际会话与对象隔离仍需验证。

## 2. 按任务打开对应面板

| 用户意图 | 默认展示 | 动作边界 |
| --- | --- | --- |
| “分析这个 Library”“比较这两版库” | 打开或激活 Data Insight | 输入未知时显示数据选择/缺项，不先打开空 Live Run |
| “继续 timing closure”“开始 DTCO Campaign” | 打开对应 Campaign 的准备或已有运行视图 | 沿用既有准备/确认/恢复机制，不重复创建 Run |
| “查看上次 Library 分析” | 打开保留的 Insight 报告及其数据身份 | 展示原报告，不因打开面板重算 |
| “让这个 finding 做一次真实 STA/ECO 验证” | 保留 Insight，形成受控执行 proposal，再打开/关联 Campaign | 选择图点或切标签不构成工具执行授权 |
| “看看这个 Subagent 正在做什么” | 打开精确的子会话 | 不改变 Campaign owner，不打断父任务 |

路由来自当前用户任务和 Host 已知对象。Agent 可以请求打开对应视图；用户仍可手动切换。后台任务刷新只更新所属面板状态或提示新结果，不能反复抢走用户正在查看的 tab。

模式切换保存当前对话草稿、图表 filter/selection、节点选择和滚动/缩放等视图状态。不会暂停/启动 Campaign、改变权限或修改数据。每个视图显式标明 session、Run/report、版本和时刻，避免“看着 A、问到 B”。

## 3. Data Insight 的范围

独立入口允许在没有当前选中 Campaign 时打开数据准备页或已有报告。**打开 Insight 不得要求创建一个空 Campaign。** 需要工具计算的分析仍使用已有 Pack/Site/Job/受控执行能力；多步分析可关联实际 Run，执行详情按需下钻。前台模式独立，不自动推出需要新的 Analysis Runtime 或另一张 Ledger。

Library 方向继续遵循 ADR-0012 的三个用户任务：

1. 库健康与发布风险；
2. 库性能与竞争力；
3. 设计影响与行动。

在这些任务内提供数据/版本/条件选择、表图联动、load/slew/corner/filter、finding、unknown 和证据来源。长期计算可在 Insight 中显示真实进度、阻塞和取消入口，无需强迫用户回 Live Run 才知道进展。对原始 Library 的修改或商业 EDA 操作，仍要进入同一受控执行链。

R3/Q19 确认：已加载数据范围内的筛选/切片即时响应，不调用模型；需要新工具计算时说明范围，在
原授权/预算内执行并保留新结果版本，扩大范围才确认。切换一个 filter 不隐式覆盖旧报告或扩大
任务；界面区分当前视图条件、正在计算的条件与结果实际对应条件。

仅有 Library 数据时可以做相应库分析，不要求先有 design；设计影响分析缺少设计证据时，说明该部分不可计算，不能用推断冒充实测。Native Liberty API 未通过 qualification 的现状继续明确呈现，不能用新增 tab 掩盖它。

## 4. Subagent 必须是可独立查看的真实工作会话

团队入口可从父会话、节点或工作区打开。每个条目至少显示角色/任务、状态、父任务、当前进度、产物和错误；点击打开准确的 child session，而不只是展开一段最终摘要。

| 子会话内容 | 用户能够看到什么 | 数据要求 |
| --- | --- | --- |
| 任务与配置 | 委派任务、角色模板、模型配置、工具/读写范围、预算、关联 Run/节点/代际 | 区分实际生效值与建议值 |
| 对话 transcript | 发给子 Agent 的消息、可展示的模型回复、工具调用/返回、错误及结果；运行时可持续更新 | 按原会话事件展示，不由主 Agent 事后生成“转述 transcript” |
| 上下文 | 实际装配或保留的角色指令、任务输入、引用文档/文件、来源与身份、fork/spawn 方式、compact 边界 | 可选查看当前/某一步快照；没有保留的部分显示不可用，不能补写 |
| 工具轨迹与产物 | 文件读写、代码 diff、测试/命令输出、生成报告与证据引用 | 链到具体执行与文件版本；区分模型判断和工具事实 |
| 控制与跟进 | 向该 child 发后续消息、请求中断、在支持时继续同一 child；明确消息接收者 | 继续使用原生生命周期/权限检查，不能通过查看会话取得 Run owner 权限 |

Subagent 不是只能聊天的旁观者。被配置为 Coding/研究角色时，应能在分配范围内读写文件、修改算法、调用允许的命令、运行测试并交付产物；分析/复核角色可保持只读。具备这些能力的目标不等于本轮已给所有 child 开放 shell/EDA 权限。

R3/Q15/Q16 确认：团队在任务总预算和已批准模型/工具/权限内自主调度 child，显示开销而不为每个
child 复制总预算。Coding 修改限于获准私有工作区及方法允许范围；共享/已发布 Pack、Harness、
工具安装、判据与权限变更另走开发发布。UI 显示真实范围、差异和验证，不把模型自述当作授权。

EDA Operator 的交互 transcript 可以从它的子会话或相应节点下钻，但共享同一受控终端身份与单写者协议。普通子会话、当前执行节点和 EDA 进程的状态分别显示。

## 5. 独立查看、消息和控制的具体语义

- 打开 child 不自动重跑、接管或取消父任务；父子历史均保留。子任务完成后仍能找到 transcript、上下文出处和产物。
- 从父会话进入后有返回父任务入口；同名 child 用稳定身份区分，不能靠显示标题寻找 session。
- 当前输入框明确标示消息将发给哪个 Agent。打开 child 的文件或证据不应悄悄把聊天接收者切回 parent。
- 中断 child 默认只影响该子任务及其获准操作，不等于停止整个 Campaign；若底层 Job 无法中断，显示 requested/actual/unknown，不能提前写 stopped。
- 已结束任务的“继续”沿用原生可续会话能力及新授权检查。过期 Run/输入/epoch 下的结果不得直接作用到当前代际；不能把新建 child 冒充原会话恢复。
- 查看上下文使用已授权的本地/Site 数据，不因团队页面暴露其他 workspace 或不相关历史。导出 transcript/上下文是独立显式操作，不默认外发。

## 6. 复用现有实现，新增薄的视图与身份适配

本轮静态确认 `client/index.ts` 已通过 DSH `sidebarRightTabs`、`sidebar.right.pane.tab` 与 title slot 注册 HimaWorkbench；`HimaWorkbench.tsx` 当前按 runId 选择 Campaign/Configuration，尚无 Data Insight 路由。已有 `openOwner` 使用原生 session 打开方式，原生 child Session、subagent UI 和 SessionQuery 是团队视图的复用起点。

| 工作 | 默认落点 | 需要新增的最小内容 |
| --- | --- | --- |
| Start 双入口与同级 tab | 当前 DSH Start/导航 slot、`client/index.ts`、HimaWorkbench | Campaign/Data Insight 入口与独立 body；Start 的准确 slot 在实现切片首先核查 |
| Agent 请求展示 | 现有 Host/client 连接和 sidebar navigation | 一个受控 view request；只负责导航，不执行分析/Job |
| Insight 展示 | 现有 Workbench 视觉、typed report/Host read route | 数据准备、报告、表图和发现；复用前一轮 renderer 方案 |
| Subagent 列表及打开 | 原生 child catalog/session lineage、现有 session navigation | Hima 任务/节点关联、角色状态标签和返回父任务 |
| transcript / context / artifacts | 原生 session read/trace、已保留 context、Files/Code | 身份校验、有界读取和缺失提示；不复制另一份历史存储 |
| 操作入口 | 原生 child 控制、现有 Hima 执行检查 | 接收者可见、可用动作与拒绝原因，不新增 Run owner |

建议 view address 用封闭 union，例如 Campaign 的 runId、Data Insight 的 reportRef/待选数据 scope、Subagent 的 parent/child sessionId。字段格式待消费端确定；所有地址由 Host 重新解析和检查。客户端的 active tab/filter 属于视图状态，Run/报告/session 内容来自原权威，不建立两个“当前状态”。

Subagent transcript 可通过现有独立 Session 查看；“某一步实际模型上下文”是否已有充分保留需另核查。已有包或 UI 文件不代表 Hima profile 当前全部挂载，也不代表所有外部 subagent provider 都提供完整 transcript/context；不支持的字段应如实说明，不能阻塞所有已有能力的使用。

## 7. 验收实例与实施顺序

| 场景 | 必须观察到的结果 |
| --- | --- |
| Start 无活动 Campaign，用户选择 Data Insight | 打开数据分析准备页，无虚构 Run、无额外工具执行 |
| 中文请求 Library 分析 | Agent 打开 Data Insight 并指向正确数据，缺项可见；不默认跳 Live Run |
| 已有 Campaign 运行时切到 Insight | 原 Run 身份/状态不变；返回后视图状态可恢复 |
| 后台 Agent 产生新报告 | 所属面板更新/提示，不抢当前 tab 或覆盖草稿 |
| report A 与 B 来回切换，异步 A 请求晚返回 | 不把 A 的图、单位或证据显示成 B |
| 点击 chart/finding 询问 Agent | 消息携带当前报告/对象身份；不自动触发 STA/ECO |
| 打开运行中的 child | 看见真实消息和工具输出增量，parent 继续工作 |
| 查看 child 某一步上下文 | 读实际快照/引用；缺失标不可用；当前快照不冒充历史输入 |
| 向 child 跟进或中断 | 接收者准确；不重复创建任务；不误停 parent/其他 child |
| Coding child 修改文件并测试 | 产物、diff、命令和结果可查；越界写入拒绝，不能自述测试通过 |
| child 完成、会话重开/归档、Run 进入新代际 | 历史仍可查，旧结果不直接获得当前执行权 |
| 主/子 Agent 与两种模式切换 | 使用同一视觉体系与原生导航；键盘焦点、草稿和当前位置行为一致 |

先以现有报告/session fixtures 做 L2 读数/权限/路由验证，再用 L3 实际检查 Start、tab、会话导航与视觉一致性。Data Insight 真实 Library 计算仍受原 API qualification 门约束；Subagent Coding/交互 EDA 的工具能力分别用其独立测试验证。看见 transcript 不等于子任务正确完成，展示合成图不等于完成真实分析。

用户本轮确认的是两种同级产品模式和完整 Subagent 使用体验；本轮只改设计文档，不运行上述测试、不更换 UI 底座、不恢复 EDA Campaign。

## 文档验证

已核对当前 Hima client 的 Workbench 注册、runId 导航和 session 打开接口；原生 subagent 的复用范围沿用已冻结的生态审查，不把包存在当成产品验收。本轮检查了 27 个本地 Markdown 链接，未发现缺失，`git diff --check` 通过。仅更新文档/术语/ADR；产品 L0–L5、模型、UI 与 EDA 测试均未运行。
