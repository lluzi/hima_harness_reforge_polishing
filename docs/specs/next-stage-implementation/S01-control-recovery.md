# S01 — 人类控制、恢复与 Desktop 生命周期

覆盖：NXT-A1、NXT-A3。基线：`1a79cb1`。依据：Q5/Q8/Q9/Q11/Q13、ADR-0008/0014/0015。状态：规格可派工；实施和产品测试尚未开始。

## Problem Statement

工程师暂停长任务后，不应因为 Agent continue、重启或 Job 完成而失去控制；关窗口应能让任务留在后台，明确退出必须交代在途作业。当前观察 Job、继续业务、用户控制和通知的差别容易造成“以为已停”或重复执行。

## Solution

在原 RunControl、执行入口、Host 恢复和 Desktop 生命周期内加深现有行为，保留一份控制事实与唯一 owner。Guide 代传明确的人类指令，但不获取执行所有权。普通进度合并显示，需人处理及最终结果才主动提醒。

## User Stories

1. 作为工程师，我希望暂停能跨 compact 和重启保留，从而不用反复阻止 Agent。
2. 作为工程师，我希望暂停节点也阻止依赖它的新工作，从而修改期间不使用过时输入。
3. 作为工程师，我希望在 Guide 请求继续指定任务，从而不必寻找内部 owner ID。
4. 作为工程师，我希望看到请求收到、控制已记录、作业确已停止分别是什么状态，从而判断能否安全退出。
5. 作为工程师，我希望关闭窗口后授权任务继续，从而可以腾出桌面。
6. 作为工程师，我希望明确退出默认收束当前步骤，从而保存可恢复进度。
7. 作为工程师，我希望立即退出时明确选择停止或保留作业，从而掌握资源占用。
8. 作为工程师，我希望重开后识别同一 Job，从而不重复花许可证和计算时间。
9. 作为工程师，我希望未知副作用被指出，从而不会被自动重发 ECO。
10. 作为工程师，我希望任务进度不堆积消息，而重要阻塞仍提醒，从而放心离开后返回。

## Implementation Decisions

### 当前证据与修改模块

| 文件 / 符号 | 当前行为 | 最小升级 |
| --- | --- | --- |
| `packages/harness/src/ledger.ts` / `runControl`, `RunControl` | `paused` 是 scope 字符串数组 | 在同一控制记录保留暂停来源/请求与清除依据；旧记录保守读取，不另造控制日志 |
| `packages/harness/src/fabric.ts` / `executionAction`, `executionPauseReason`, `clearExecutionBlocker` | 普通 continue 过滤 scope；失败/Wait 才明确要求 human clearance | 人类 hold 仅可信人类继续可清除；系统恢复/失败 hold 不互相误清 |
| 同文件 / `recordExecutionResult`, `scheduleExecutionDeadline`, `scheduleExecutionStop` | 已有观察、预算与停止调度 | 观察仍记录事实，不能把完成当人类继续；预算不因关窗、退出等待或通知重置 |
| `packages/harness/src/recovery.ts` / `reconcileControlledRun` | 核对原 admission/Job；不启动下一业务步骤 | 核对后在条件满足时唤醒原 owner 读取现状；不在 recovery 内建业务循环 |
| `packages/harness/src/remote.ts` / `controlOperation`；`tools.ts` / `hima_execute` | UI 控制带 session/epoch/revision；模型执行不能自报人类权限 | 复用控制入口，为 Guide 转发绑定可信人类指令回执及精确目标；Host 校验，不依赖自然语言声称 |
| `packages/harness/src/index.ts` / notify 接线与 `agent.followup` | #48 已合并普通进度；明确控制另发 | 保持已修机制；恢复/Guide通知复用同一去重路径，不新增轮询通知器 |
| `packages/desktop/src/main.ts` / close、closed、before-quit；`host-launch.ts` | 关窗直接 app.quit，退出停止 Host | 关窗保留 Host；重新打开原实例；明确退出调用原 Host 收束/状态接口后停止 |
| `packages/harness/src/client/api.ts` / `controlRun` | 既有控制调用 | 新回执字段只投影，按钮/文案由 S08 接入 |

### 合同与顺序

- 暂停事实至少含 scope、source（human / 系统原因）、requestId、actor、有效状态；派生 `paused` 若保留只能从同一事实计算，不形成两份可独立修改状态。
- 请求继续带 runId、scope、requestId、expectedEpoch/revision 及可信人类指令关联。agent 工具不能任意填 human 来源；Guide 代传由 Host 对已记录用户意图与目标做验证。陈旧请求拒绝且不清除任何 hold。
- 重启顺序：读取控制/预算 → 核对 launch intent 与实际 Job → 完成原事实收集 → 条件满足时唤醒原 owner。无 owner 则显示可行动恢复入口，不静默造第二 owner。
- 退出顺序：记录本次退出的 admission fence → 不再开新步骤 → 当前步骤到可恢复边界 → 记录状态 → 停止 Host。退出 fence 与 human hold 区分，重开核对后只解除可自动恢复的退出 fence。
- “保留作业”只能在该作业具备可验证的脱离 Host 存活与预算约束时提供；否则说明无法保留并保留等待/停止选择。本地 PTY 不宣称跨 Host 存活。
- 立即停止返回 requested / confirmed / unknown 的实际阶段。网络不通不能报 stopped，App 退出也不能把整个 Run 标 cancelled。
- 状态/摘要/证据给 Guide 和 UI；完整 transcript 按需读取。保持 #48 的每 Run 合并，不重新实现。

### 子切片、依赖与并行

1. S01a：人类 hold 正反例与 RunControl 升级；先定合同 K3。若持久 schema 变化，使用现有版本校验/显式迁移，并保留旧 home。
2. S01b：真实状态 reconciliation 后的 owner 唤醒与通知；依赖 S01a，仅消费S04 B2-a/K1的只读身份合同与现有Run owner绑定，不等待S04 B2-b/B3-b执行实现。
3. S01c：Desktop 关窗/退出；以 S01a 的停止与退出回执开发，Desktop 文件可并行，Host 接线由集成者顺序落地。
4. S06 新委派写入、S09 交互 mutation 依赖 S01a；不要求等 Library。S08 可先用冻结回执做 UI。

`fabric.ts/ledger.ts/remote.ts/tools.ts/index.ts` 由主集成者写入。S01 不拥有 UI 全局布局、团队调度或 memory 内容。

## Testing Decisions

以现有 Host 公开执行/控制接口为主 seam，观察 Ledger/Job 回执和用户可见结果，不断言私有数组实现。复用：`test/contract/agent-controls.host.test.ts`、`agent-recovery.host.test.ts`、`notification-coalescing.host.test.ts`、`ledger-version.test.ts`、`run-controls.test.ts`；Desktop 生命周期补到 `desktop.test.ts` / 对应窗口组，保持独立 home。

正例：人类暂停→Job 完成→重启→仍暂停；可信人类继续→原 owner 单次接续。反例：Agent continue、人类请求过期、同 requestId 不同内容、预算耗尽、退出期间重复触发、unknown Job、无 owner 都不能启动新 mutation。

最低命令（实现后，共用一次新构建）：`pnpm run build`；`pnpm run test:local --files test/contract/agent-controls.host.test.ts test/contract/agent-recovery.host.test.ts test/contract/notification-coalescing.host.test.ts`。持久版本/导入相关改动另跑已归入 desktop 的 `pnpm run test:desktop --files test/contract/ledger-version.test.ts`；新增窗口用例先登记已有 test 分组，再选具体文件 L3；不能用 Host 通过替代关窗/重开体验。仅 remote 存活/预算语义改变才升级小型 L4 Site；不跑完整 P&R。

## Out of Scope

独立服务器 Agent 服务、新控制面、新定时轮询器、通知产品重写、恢复已暂停 trial、无证据重放修改命令。

## Further Notes

先重现普通 human hold 被清除的行为，再改代码；已通过的 #48 不重复修。保留首次失败与旧 home，回滚用切片前 commit 和原 App；禁止旧二进制直接读新 schema。实现 Terra/Medium，控制/恢复关键复核 Sol/High。测试通过范围与未运行 L4/L5 分开记录。
