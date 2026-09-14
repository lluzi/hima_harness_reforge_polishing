# Agent代操作审阅，非真人认可

状态：PLS-26 最终 UI 工作流的本轮操作已完成；录像自然结束、独立离线审计与受控重启读回仍由实施者另行核验。

## 已查看的正式研究

在 Catsights 上的 trial-final 中打开同屏 Live Run，查看了正式 Run
`run-6077b417-daf5-4db3-a1f4-72420fc5d15d` 的状态、51/51 reference 节点、Job ledger、算法代码
入口、输入/知识身份、Pack v5 technical report 与 archive delivery。界面显示其为 `ended — budget exhausted`：
generation 1 的 final Judge 为 FAIL，`full-evidence-valid` 失败而 clock-period rule PASS；报告把
下一策略标为未执行/未测量，并明确不从该结果推出 Fmax、PPA 或 signoff 收益。报告也保留三条空选择为
`generator_contract.interface` 查询缺陷、以及三条被拒绝的 optional growth 历史；这些均未被当作正面
研究结论。

## 有界知识复用与控制 study

约 23:12--23:13，通过新会话启动**唯一** Run
`run-a1809077-009a-47d0-883f-c57f066f7228`：`aes-tsmc28-dtco@5 / linglong-aes`，Goal
`target_period_ns=0.5`，strategy `periodNs=0.5, algorithmRevision=1, floorplanUtilization=0.5`，
generation 1、retries 2、timeBox 5 min。

Agent 在任何 begin/work/图节点或 Hima Job 前成功 RUN-scope pause：`control.paused=["*"]`，随后
`hima_context` 显示 `available=[]`、`executions={}`、`jobs=[]`、`jobsLaunched=0`、`attempts=0`。
它用普通 read 工具读取了指定 first-run `manifest.json` 与 `experience.md`，其中 manifest 显示完整交付、
Pack v5、frozen digest，且 analysis 记录引用 source Run 和 manifest SHA
`9e1534f25b60efa76c50c04097d9eedbbc36abc762ce8f88d75740553b21bf68`。

第一次 analyze 调用因遗漏 schema-required `analysis.claims` 被拒绝；Agent 保留该失败并以新 requestId
重试。第二次在 `probe` 写入 claims=[] 的 source-linked analysis `#000002`，带限制和 discriminating next
experiments。取消前的 UI 错误要求刷新控制上下文，但离线审计确认 `priorCancelAttempts=[]`，故不作为持久
`hima_execute cancel` 控制记录；读取当前 epoch/revision 后，对同一 Run 成功 cancel。
最终界面显示 `status=cancelled`、`endedBy=cancel`、`control.stop.status=confirmed`、probe `cancelled`，
仍为 `jobsLaunched=0`、`attempts=0`。等待 cancel settlement 时 Agent 使用过一个短 Bash wait 工具；它不是
Hima 图节点或 EDA Job，且最终图 Job ledger 为空，应在离线审计中单独核对其作用域。零实验 Job/EDA
不等于零 Site I/O：SSH Site 仍承担 Campaign workspace 和 archive 的正常文件 I/O。

这证明的是一次界面可操作的、无图执行的历史资产阅读/控制 study，不是第二次 PPA 或 EDA 试验，也不是
真人认可。用户后续视频 Review 和实际试用保持独立。

## 受控重启读回

在原 Catsights 录像自然结束、原应用关闭后，使用同一 final candidate、同一 home/user-data 受控重启。
约 11:26 的界面读回显示工作区仍存在，正式负结果会话和 history-study 会话均仍在侧栏。打开正式会话后，
历史仍呈现其预算截断的负结果与三个被拒绝的 optional growth；打开 history-study 后，其 claims=[] 分析、
source Run/manifest hash、cancelled 状态和零图 Job 事实均可读回。

Live Run 的已取消 Run 仍为 `aes-tsmc28-dtco@5 / linglong-aes`，显示 `cancelled by a person`、probe
`cancelled`、execution trace `0/1 done`、无 Job lifecycle event、零 observations，且 Pack 内归档入口仍可用。
界面验证的 archive materials 包含 `experience.md`（SHA 前缀 `c9d04936ec40`）及 `experience.json`
（SHA 前缀 `5bd483cfd43d`）。本重启读回未发送模型提示、未创建新 Run、未启动实验 Job 或 EDA；既有
SSH Site workspace/archive 文件 I/O 仍是系统正常读取范围。

我建议在实施者完成本轮录屏文件与独立离线审计/hash 检查后，将 PLS-26 的 Agent 代操作部分判为通过，
并以本记录保留其范围和失败重试历史；这不是真人认可，用户的录像 Review 与后续试用仍独立。
