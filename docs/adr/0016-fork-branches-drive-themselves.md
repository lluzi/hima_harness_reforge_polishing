---
status: accepted
---

# Fork 分支自行推进，owner 只在 join 与 Explore 决定

用户于 2026-09-29 明确：fork 分支必须自行推进——工具 Job、Workshop、Reader、Judge 与 Team
成员（按 schema 自动采纳）在分支内连续执行，owner 不在分支内逐节点轮转，也没有人在循环里；
六个并行 XTop 分支必须真正并行；owner 只在 join 与 Explore 决定处行动；Pack 可以把 refresh
链声明为自行推进。随后用户要求结构化精简：“不要让过度的官僚流程和无意义的决定妨碍效率；
结构缺陷会让最强的模型也无法发挥。”

依据是 #64 两次现场 Campaign 的 Ledger 实测（fork 窗口内每分支时间）：T02 运行 12%、等待 owner
44%、等待人 31%、Host 停顿 13%，分支内 owner 调用 103 次；T03 运行 15%、等待 owner 30%、等待人
54%，114 次。分支真正工作的时间不足五分之一，其余都在排队等同一个 owner 或等人。

## 决定

- Pack 图可以声明 `autopilot`：`{fork, revisions, author}` 让一个 fork 的全部分支自行推进；
  `{from, until}` 让一段非分支节点自行推进，停在 `until`（owner 的 Workshop、Explore 或 wait）。
  加载时拒绝段内的 wait/Explore/Workshop、未标注 UNDETERMINED 出边的 Judge、以及非 fork 节点。
- 声明区域内由 Harness 自己的 autopilot（`origin: autopilot`，记录为 executor）完成 begin/work/
  complete；owner 在这些节点上的节点轮转被拒绝并说明原因。离开区域时只通知 owner 一次，摘要中
  带每个分支的最后节点、采纳的 Team 结果 id、最终 Reading 与 Contribution id。
- 分支 Workshop 由该分支自己的 child Agent 撰写入口（`hima-workshop-entry/1`）；下一代复用已
  保留的代码。Reader 拒绝请求时，autopilot 在同一代内从该 Workshop 重启分支，并把 Reader 写出的
  逐条问题交给同一个作者修订，最多 `revisions` 次。
- Team 成员按 schema 自动采纳；结果不符合 schema 时追问一次，仍不符合则该分支在 join 处以
  refused 结束，不找人。Operator 直接由被 Reader 接纳的请求物化：请求的完整字段嵌入其任务，
  请求自身的 scope 与内容哈希成为 Host 强制的不可变范围（`reviewedAction.mode: request-scope`）；
  Reviewer 可声明为 `optional` 的建议角色，其缺席从不阻塞。
- Operator 请求 Harness 关闭会话时，节点以 done/no-fix 结算，不计为失败尝试。
- Explore 增加 `stop` 决定：诚实结束，目标未达成。人的暂停只挂起受影响的分支；时间盒、预算与
  generation limit 照旧结束 Run。Ledger 升至 v31，Harness 升至 0.2.0。

ATCS Pack 0.2.0 按此重塑：每代为 plan → 六个自行推进的分支 → merge（compose、replay、reconcile、
presta）→ 一次 refresh → evaluate → 自动重新观测 → owner 的一个决定（从 working state 继续下一代，
或诚实停止）。环内 Judge 只保留身份与合并完整性检查（baseState/planSha256、domain 不相交）以及
refresh-budget 的 Goal 上限；其余意见写入 problems 文件作为建议。人只作为诚实结束出现
（输入不可用或 refresh 上限用尽）。图从 136 节点/178 边缩减到 81/103。

## 后果

owner 的回合数与分支数、节点数脱钩；分支失败被限制在分支内。自行推进仅由 Pack 声明开启，
未声明的 Pack 行为不变。评估与 referee 需要的全部事实记录（节点、Job、Reading、Verdict、代码、
委派与采纳、restart）在 autopilot 下照常写入，写入者标为 executor。代价是 owner 不再逐步审阅分支
内部；审阅改为 join 处的一次摘要与 Ledger 事实。
