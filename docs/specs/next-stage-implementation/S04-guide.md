# S04 — Guide、上下文与准备闭环（NXT-B1 / B2 / B3）

状态：实施规格；基线 `1a79cb1514364aa049e775d7b18bbb063a223092`。本文把已确认的产品决定变成可派工切片，**不表示任何拟议字段或能力已经实现**。先决约束见产品定义、ADR-0001/0002、ADR-0008、ADR-0014 和访谈 Q1–Q19。

## Problem Statement

当前 HimaGuide 的产品语言由 `index.ts:HIMA_PRODUCT_CONTEXT` 提供；每回合的 `himaRuntimeContext()` 只给已安装 Pack、已保存 Site 和最近五个活跃 Campaign 的简短 inventory。它不携带用户选中对象、报告/节点/child、版本/时间、缺项、出处或接收者。`remote.ts:startChoices`/`runView`、`index.ts` 为 `RemoteOperations` 接入的 `startPreparation` 回调，以及 Fabric 已分别掌握准备、运行与控制事实，但没有一个有来源的共同任务上下文合同供 Guide 和 Workbench 同时读用。

这使用户不能稳定地从独立 Guide 得到“正在做什么、为何受阻、下一步是什么”的准确解释，也不能在 Guide 派出任务后继续对话。ADR-0014 已确认 Guide 是按工作区隔离的长期入口，执行会话与 child 独立；一个 Campaign 仍由唯一 owner 决策。本规格只在现有 DSH prompt、Host、Preparation、Fabric/Ledger、Pack 和 Workbench seam 内加深表达与投影，不引入第二 Agent Loop、第二运行图或第二事实库。

## Solution

先定义一个由 Host 重新解析的、只读的**拟议** `GuideContext` 投影：它包含 workspace 身份、用户选中的 address、候选/owned Run、报告/节点/child 引用、事实时间/版本、已知、缺项、来源和 refusal。它不把 selected 当作 owner，不把摘要当作执行事实，也不复制 transcript。`HIMA_PRODUCT_CONTEXT` 继续只放稳定产品角色；动态 `GuideContext` 由现有 authority 读出，供 prompt 与 UI 共同消费。

Guide 依据同一投影解释 Pack/Site/输入/知识的准备状态，提出可执行的准备方案与恢复出口。启动独立执行会话时，只传经过确认的目标、引用、权限/预算边界和接收者；Guide 留在原会话。涉及 Campaign 控制时，Guide 只代传目标明确的命令；特别是 continue/resume 必须由 Host 验证已记录的明确人类指令、目标与当前 epoch，再进入 S01 的人类控制路径。Guide/模型不得自行构造 `origin: 'human'` 或解除 hold；唯一 Run owner 不变。Host/Fabric 返回可信 receipt/refusal 后才可展示。Pack 作者工作仍移交给原作者会话与 G1/G3，不由 Guide 直接改 Pack。

## User Stories

1. 新用户在 Guide 输入“我要做 timing closure”，在没有 Pack/Site 时看到可理解的准备清单、每项缺失的来源和下一步，而不是 YAML 或内部协议名。
2. 用户选中一个已准备的 Campaign 后询问进展，Guide 说明准确 Run、当前节点、最近已核实结果、未知项和出处；仅仅选中它不能取得 owner 权限。
3. 用户从 Guide 发起一个独立任务后继续提问另一个工作，Guide 会话仍可交互；新任务拥有自己的会话与最小上下文，不能占住 Guide。
4. 用户说“暂停刚才那个 Run”且上下文唯一时，Guide 标明接收任务并代传；Host 回执 accepted、refused 或 uncertain 后如实显示，不能把请求已发送写成已暂停。
5. 用户同时看到两个同名任务时，Guide 用稳定身份、工作区和时间区分并要求选择；不按显示标题猜 Run ID。
6. 返回用户切回另一工程工作区时，只看到该工作区的 Guide 历史/工作上下文；共享 Site 或同名 Pack 不可使另一项目材料自动进入回答。
7. Site discovery 过期或 Pack 缺少输入时，Guide 给出重新发现/补输入/退出的具体路径，并保留原 Run；不得为“继续”重复创建 Campaign。
8. Guide 解释研究结论时，把模型解释、Ledger/报告证据和未知明确分开；缺更新后的时序报告时必须说不可判断。
9. 用户打开 child 或报告再返回 Guide，当前 address 仍指向原对象；迟到的旧 address 响应不得覆盖新选择。
10. Pack 作者请求将 SOP 转为方法时，Guide 只将工作转给原作者会话及 G1/G3 的流程，说明当前能做/不能做，不能越权修改已发布 Pack。

## Implementation Decisions

### 现有模块、符号与文件所有权

| 路径 / 符号 | 已核实的当前责任 | 本切片拟议增量 | 所有权 |
| --- | --- | --- | --- |
| `packages/harness/src/index.ts:HIMA_PRODUCT_CONTEXT`, `himaRuntimeContext`, `Hima.[Service.init]` | 注册稳定 prompt 与每回合 inventory；启用 owner 通知 | 将稳定角色、动态上下文、用户解释分离；注册经 authority 重读的 context provider | **主集成者**（共享接线） |
| `packages/harness/src/remote.ts:startChoices`, `runView`, `registerHimaRoutes`；`index.ts` 的 `RemoteOperations.startPreparation` 接入 | Preparation/Run 的 HTTP 投影、route 注册与 Host preparation 接线 | 只读 GuideContext/read address route 与窄 schema；不得把 UI 输入变成事实 | **主集成者**（共享接线） |
| `packages/harness/src/fabric.ts:executionContext`, `executionAction` | owner/epoch/revision、暂停、handoff、receipt 的唯一执法 | 保持原动作合同；仅供 Guide 重新读取/代传，不能新增另一控制器 | **主集成者**（共享接线） |
| `packages/harness/src/ledger.ts:RunRecord`, records/read APIs | Run、控制、证据的权威 | 不为 Guide 摘要新增平行事实；若确需 address 记录，先证明现有 record 不能承载 | **主集成者**（共享接线） |
| `packages/harness/src/client/api.ts`, `client/HimaWorkbench.tsx`, `client/index.ts` | fetch/control 与右侧 Workbench 挂载 | 读同一 context、显示来源/缺项/接收者；active tab 仍是视图状态 | **主集成者**（共享接线；与 S08 串行） |
| `packs.ts:loadPack/checkPack/packOverview`, `sites.ts:installedSites/discoveryIsStale` | Pack/Site 身份与适用性 | 以现有检查结果生成解释；不复制检查规则 | Pack/Site 实施者，可独立改其测试 |

仅在上述现有模块职责内允许新增小型 typed projection/helper；任何新文件须仅被 `index.ts`/`remote.ts`/client 的一个明确消费者使用，并由主集成者接线。不得新建 `guide-service`、持久 Guide 数据库或任意搜索服务。

### 合同：输入、输出、错误与顺序

拟议 `GuideContextRequest` 包含 workspaceRef、可选 TargetAddress、observedAt 和 requestId；TargetAddress严格采用 [K1](contracts.md) 的run/node/report/child身份组合，禁止再用一个含义不明的id替代。`workspaceRef` 必须来自当前 Host/会话绑定；`address` 是候选引用，不是授权。输出 `GuideContext` 至少含 `scope`, `selected`, `ownedRun?`, `facts[]`, `missing[]`, `citations[]`, `asOf`, `stale?`；每个 fact/citation 指向现有 Run/Ledger/Pack/Site/报告身份，模型文案不进入该合同。

处理顺序固定为：(1) 认证并解析当前 workspace；(2) 有 address 时按类型/格式校验；(3) 从 Ledger、Pack、Site、报告重读 authority；(4) 比较 address/版本/时间；(5) 形成有出处的投影；(6) 对 continue/resume 先由 Host 检查已记录的明确人类指令、同一目标和当前 epoch，并调用 S01 的可信 human-control 路径；其他明确控制也走既有 `executionAction` 路径；(7) 返回 receipt/refusal 与刷新 context。错误优先级：workspace/身份拒绝 → 格式错误 → 对象不存在/不属于 scope → stale/版本冲突 → 准备缺项 → 缺少可信人类指令/目标或 epoch 不匹配 → owner/epoch/revision 拒绝 → 下游 Site/读取故障。迟到响应必须按请求 address 与 `asOf` 丢弃，不能覆盖当前 UI。

### 可执行子切片、依赖与并行

| 子切片 | 依赖 | 可并行范围 | 交付边界 |
| --- | --- | --- | --- |
| B1-a：术语和三层表达审计 | 无 | 可与 B2-a、M1 并行 | 列出稳定 role、动态 facts、用户解释的来源与禁用措辞 |
| B2-a：address/GuideContext 合同和 authority 映射 | A1/A3 现有合同只读 | 可与 B1-a 并行 | schema、来源、stale 规则、反例；不接线共享文件 |
| B3-a：准备/解释决策表 | B1-a、B2-a | 可与 C1 合同审计并行 | Pack/Site/input/knowledge 的用户解释和恢复出口 |
| B2-b：Host/remote/client 集成 | B2-a；S01 控制合同冻结；S08 UI address 消费者明确 | 串行 | 主集成者唯一修改共享文件 |
| B3-b：独立会话发起/代传控制 | B2-b、C1 原生入口资格 | 与 Pack 作者 G1 内容工作并行 | Guide 不成为 owner，接收者/receipt 可见 |

## Testing Decisions

最低先跑 L2 local：先 `pnpm run build`，再 `pnpm run test:local --files test/contract/product-context.host.test.ts test/contract/preparation.host.test.ts test/contract/conversation-execution.host.test.ts test/contract/side-talk.host.test.ts test/contract/view.test.ts`。现有 `product-context.host.test.ts`、`preparation.host.test.ts`、`conversation-execution.host.test.ts`、`side-talk.host.test.ts` 是最接近的真实 Host 合同入口；新增断言应放入这些职责相邻文件，避免为 Guide 建假 Host。

涉及 Workbench 的 address、迟到响应、草稿/焦点与中文解释再升级 L3：`pnpm run test:desktop --files test/contract/unified-workbench.test.ts test/contract/campaign-workspace.desktop.test.ts`。具体 `--files` 是否仍属于 group 以 `pnpm run test:local --list`/`test:contract-groups.json` 复核。测试目前按总体计划暂停；本规格给出最低命令，不声称已运行。

验收正例：Guide 从真实 context 对唯一 Run 给出节点、缺项和 citation；它创建独立任务后还能回答另一个问题；明确暂停得到 Fabric 的真实 receipt。反例：selected Run 不是 owner；旧 Run 的晚到响应不覆盖新 report；不存在/跨 workspace address 被拒绝；缺 Site/Pack 不创建 Run；失败控制不得显示成功；模型解释没有记录来源不得冒充测量。

## Out of Scope

- 不实现跨项目材料自动共享、长期记忆、向量检索或 transcript 全量注入（M1/M2/H3）。
- 不实现 child transcript/UI（C2/S08）、团队调度（C1）或 Pack 作者发布（G1/G3）。
- 不改变 Fabric owner、Ledger 事实、Site Permit、Job、权限或执行图。
- 不恢复测试、启动模型/EDA、安装 DSH 组件或修改 `tmp/`。

## Further Notes

资格阻塞：B3-b 必须先由 C1 核实 pinned DSH 的独立会话创建、最小上下文、后续消息和可观测 receipt 的公开接口；未知原生事件不能被写成 ready。B2-b 必须取得 S01 的 human pause 来源、可信 human-control receipt、Host 恢复/通知/窗口退出合同与 S08 的 address consumer；Guide 的模型输出绝不是人类 continue 授权。这样避免 `index.ts`/`remote.ts`/`client` 多人并改。若 DSH 不能提供项目绑定，先交付读取现有 scope 的解释，不伪造持久 Guide scope。

回滚：每个子切片独立提交；撤销 context route/prompt 或 client projection 即回到现有 `HIMA_PRODUCT_CONTEXT` + `himaRuntimeContext`，不迁移或删除 Ledger/Pack/Site/用户资产。模型分配：B1-a/B2-a/B3-a 和普通实现用 `gpt-5.6-terra` / medium；涉及会话隔离、权限或控制通知的集成后独立复核用 `gpt-5.6-sol` / high；主集成者按序接线。未测量 token/耗时如实记录。
