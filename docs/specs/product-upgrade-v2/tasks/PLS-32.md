# [PLS-32] 复用 DSH 多会话完成 Campaign Agent 与 Side Talk

状态：ready-for-agent
父规格：[Product Upgrade v2 / #30](https://github.com/lluzi/hima_harness_reforge_polishing/issues/30)
Issue：[PLS-32 / #36](https://github.com/lluzi/hima_harness_reforge_polishing/issues/36)
模型：`gpt-5.6-terra` / medium；owner/权限/恢复由 `gpt-5.6-sol` / high 复核
最低测试：L0 + L2 状态矩阵 + 一条 Catsights L3

## 用户场景

Campaign Agent 在后台执行长任务时，用户在同一 App 中新开 Side Talk 继续聊天或 Coding。Side Talk 可以查看 Campaign和返回 owner，但不能偷取执行权；暂停、停止和 handoff 先持久化，再可靠通知 owner。

## 当前证据

- DSH `AgentRegistry`、Session sidebar 和 New Session 已支持多个 live root Agent；无需第二 Agent Loop。
- `fabric.ts:executionAction` 已验证 owner/epoch/revision，支持 pause/continue/cancel/handoff。
- `client/index.ts` 已支持 `sessions.open(id)`、向 owner conversation 发消息；`HimaWorkbench` 已显示 Open owning conversation。
- 当前 UI 控制成功后由浏览器 `sendToOwner()` 发消息，通知可靠性依赖当前页面；缺少双 session L3 验收。

## 固定代码范围

- `packages/harness/src/fabric.ts`：`executionContext`、`executionAction`，只修复测试证明的 owner/side-talk 缺口。
- `packages/harness/src/index.ts`：现有 `agent.followup`，新增控制落账后的 Host 通知。
- `packages/harness/src/remote.ts`：`controlOperation`，返回持久状态后触发通知，不改变控制权威。
- `packages/harness/src/tools.ts`：`hima_context`/`hima_execute` 描述与 owner语义。
- `packages/harness/src/client/index.ts`、`client/api.ts`、`client/HimaWorkbench.tsx`：复用 session navigation；浏览器不再是唯一通知发送者。
- `test/contract/side-talk.host.test.ts`、`side-talk.desktop.test.ts`：新增；复用 `agent-controls.host.test.ts`、`conversation-execution.host.test.ts`、`agent-execution.desktop.test.ts`。

## 精确增量

1. 保持一个 Campaign 的一个 Run、一个 owner session 和一个 owner epoch。创建 Side Talk不修改这些字段。
2. 控制请求由 Host 先完成 `executionAction` 持久化，再向 recorded owner 使用 `agent.followup` 投递事实消息；浏览器只显示发送结果和 owner入口。
3. 当前活动 Side Talk显示需要关注的 Campaign和 Open owner 行动，不复制完整 Campaign上下文，不获得 begin/work/complete/revise/grow 权限。
4. 显式 handoff 继续要求 live target、无不安全在途状态并提升 epoch；旧 owner随即被 fence。
5. 关闭 Live Run或切会话不停止 Campaign。App 退出时保留远端 Job，重启继续使用现有 reconciliation/owner recovery；不自动新建执行 Agent。
6. 暂停、stop requested、Job stopped和 Agent notified分别表达；用户停止后 Agent下一次可响应时确认，不继续新节点。

## 保持项

- 不新增 session registry、side-chat runtime、后台模型 driver或第二业务 owner。
- Fabric/Ledger/Jobs 是控制事实；通知失败不撤销已持久控制。
- Full DSH permission不绕过 Site Permit或删除红线。

## 验收标准

- Session A 创建 Campaign并启动长本地 Job；Session B完成普通 Coding/对话，A仍 live且 Campaign继续。
- B 可查看并打开 A，不能执行 owner node action；过时 epoch/revision被拒绝。
- 人类 pause/cancel从 B 发起时控制先落账，A inbox收到通知；notification failure仍保留控制状态。
- handoff到 B 后 A epoch失效，B成为唯一 owner。
- 重启后 Run、Job事实和 owner身份保持，不出现隐藏 Agent或旧 Fabric自动推进。

## 测试

- L2：`pnpm run test:local --files test/contract/side-talk.host.test.ts test/contract/agent-controls.host.test.ts test/contract/conversation-execution.host.test.ts test/contract/agent-recovery.host.test.ts`。
- L3：Catsights 上 `side-talk.desktop.test.ts` 一条双会话关键路径；不为 owner状态矩阵重复窗口测试。
- L4仅在工具 schema/真实模型通知行为改变时做一次小调用；不启动 EDA。

## 依赖、并行与回滚

依赖 PLS-27 的 product context 和 PLS-31 的 intake UI；Host 状态矩阵可在第一波并行准备，共享 `index.ts/remote.ts/tools.ts/client/api.ts` 由主集成者在 PLS-31 后顺序接线。回滚 UI/通知不会改变持久 owner；数据 schema 变化必须向后读取。
