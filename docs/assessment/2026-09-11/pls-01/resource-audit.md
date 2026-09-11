# PLS-01 原 29 个文件的资源与清理核查

基线为 `d6cadfb` 中原样导入的 `b4ac9d9` 测试。表内数量为静态测试声明/断言表达式，不是运行次数或通过数。逐例标题、原/新位置、级别、所用接口及文件内辅助函数见 [case-mapping.json](case-mapping.json)；所有原断言的文字、hash、原/新行号见 [assertion-mapping.jsonl](assertion-mapping.jsonl)。列表是迁移证据，实际入口只有 `test/contract-groups.json`。

清点不以文件名决定资源：例如 budget、drill-down、experience、fork-join、loop、strategy 同时含 L2 和 driver 用例，本任务保守地将整个文件留在 desktop；PLS-03 按实测必要性迁移。三份原本混合 SSH 的文件必须先拆分才能进入 local。`dc-reader` 和 `judge` 的部分测试使用外部目录的本地报告副本，这不是远端 Site。

| 原文件 | 声明 / 断言 | local / desktop / live-site 声明去向 | 资源与清理侧重点 |
| --- | --- | --- | --- |
| boot.test.ts | 2 / 10 | 2 / 0 / 0 | 真实 Host 子进程、HTTP；关闭进程并删除临时 home |
| budget.test.ts | 6 / 123 | 0 / 6 / 0 | driver + 本地 tmux/stand-in；确切 session 清理 |
| command.test.ts | 1 / 5 | 1 / 0 / 0 | 真实 in-process Host；关闭 Host/home |
| dc-reader.test.ts | 14 / 118 | 14 / 0 / 0 | 真实 Host/HTTP、hash 校验的本地 DC 报告副本；临时 home |
| desktop.test.ts | 1 / 42 | 0 / 1 / 0 | Electron 冷启动/本地 Site；关闭窗口/Host/user data |
| drill-down.test.ts | 7 / 117 | 0 / 7 / 0 | driver + Host/本地 tmux/stand-in；关闭重启前后 Host 和自身 sessions |
| driver.test.ts | 2 / 75 | 0 / 2 / 0 | Electron driver、HTTP；关闭窗口/Host/user data |
| experience.test.ts | 9 / 134 | 0 / 9 / 0 | driver/Host + 本地报告/stand-in；删除的报告只在本次 workspace |
| fabric-licences.test.ts | 4 / 41 | 4 / 0 / 0 | 真实 Host/HTTP + tmux/stand-in；自己的 Job 与 home |
| fabric-restart.test.ts | 16 / 182 | 16 / 0 / 0 | 真实 Host 重启/HTTP、tmux/stand-in；自己的 session/exit 文件、临时目录权限复原 |
| fabric-retry.test.ts | 13 / 177 | 13 / 0 / 0 | 真实 Host 重启/HTTP、tmux/stand-in；自己的 Job、故障输入和 home |
| fabric.test.ts | 14 / 162 | 14 / 0 / 0 | 真实 Host/HTTP、tmux/stand-in；确切 session 和临时 home |
| fork-join.test.ts | 10 / 148 | 0 / 10 / 0 | driver/Host、tmux/stand-in；临时 PATH shadow 复原、自己的 sessions |
| honest-standin.test.ts | 1 / 25 | 0 / 1 / 0 | Electron + 本地 stand-in 三个 Campaign；窗口/Host/home 清理 |
| jobs-unreadable.test.ts | 11 / 115 | 11 / 0 / 0 | 真实 Host、本地 tmux；每例独立短 socket 目录、权限/rename/PATH shadow 先复原后清理 |
| jobs.test.ts | 14 / 128 | 10 / 0 / 4 | 本地 tmux 与独立 Host；远端四例移入 live，仅 UUID workspace；stale socket 增加归属检查 |
| judge.test.ts | 12 / 100 | 12 / 0 / 0 | 真实 Host、临时规则与 hash 校验的本地报告；关闭前后 Host/home |
| ledger-version.test.ts | 1 / 15 | 0 / 1 / 0 | 真实 Electron/Host 重启、临时 ledger；关闭两次启动和 home |
| loop.test.ts | 13 / 178 | 0 / 13 / 0 | driver/Host、本地 tmux/stand-in；自己的 sessions 和 home |
| observe-ledger.test.ts | 6 / 38 | 6 / 0 / 0 | 真实 Host、临时 ledger/报告；关闭 Host/home |
| observe-readers.test.ts | 7 / 54 | 7 / 0 / 0 | 真实 Host、本地样本与 hash 校验的参考报告；关闭 Host/home |
| observe.test.ts | 1 / 17 | 1 / 0 / 0 | 真实 Host、本地生成报告；关闭 Host/home |
| pack.test.ts | 24 / 188 | 21 / 0 / 3 | 文件/schema/Host、本地 stand-in 复制与拒绝路径；远端三例移入 live，仅 UUID workspace |
| site-name.test.ts | 3 / 20 | 3 / 0 / 0 | 真实 Host、临时 Site 配置和文件；关闭 Host/home |
| ssh.test.ts | 13 / 66 | 5 / 0 / 8 | 本地参考配置/schema；远端八例移入 live，删除或改写 socket 前校验私有目录 |
| strategy.test.ts | 5 / 72 | 0 / 5 / 0 | driver/Host、本地 tmux/stand-in；临时 Pack 和自己的 sessions |
| view-run.test.ts | 5 / 84 | 5 / 0 / 0 | 真实 Host/HTTP、本地 Job/stand-in；关闭 Host 和确切 session |
| view.test.ts | 6 / 61 | 6 / 0 / 0 | 真实 Host/HTTP、临时文件及 hash 校验的参考报告；关闭 Host/home |
| window.test.ts | 9 / 145 | 0 / 9 / 0 | 真实 Electron/Host、local Site；临时 Site rename 复原、自己的 sessions/user data |

`support/site.ts` 只安装配置或生成本地文件，没有导入时 SSH；保持原样。`support/tmux.ts` 的 session 操作用 `=session` 精确匹配；socket 故障由 jobs-unreadable 在自建目录中注入，保持原样。新入口再用私有 TMUX_TMPDIR 和明确 `-S <本次 socket>` 收尾，并清除继承的 TMUX。`createEmptyHome`/driver 均使用临时 home/user data；`bootInProcess` 的环境修改决定同文件不能盲目并发，因此保持 Node 文件串行。

live 远端清理只涉及当例构造并断言过的 `<campaignRoot>/hima-test-<UUID>`；现有 Site reference 数据只读。辅助 SSH 禁用 ControlMaster 复用；生产 Channel 的 master 位于入口创建的私有 TMPDIR，故障注入通过 ownControlPath 检查后才进行。未执行 live，以上远端清理属于代码核查，不是当前真实 Site 验证。

原代码部分 setup 位于 try/finally 外；这次错误地移除共享 import 的中间失败暴露了失败后 Host 保持活动的问题，已修正导入并保留失败记录；本任务没有扩展为全部测试生命周期重构。完成的本地组正常退出，入口创建的临时目录已移除。
