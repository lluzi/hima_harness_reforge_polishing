# PLS-06 补充：一条分支阻塞时另一条真实 Job 仍在运行

冻结代码：`ac2ed3a36f40a4cb1da7c076fa92eee5818344ae`。这是验收标准中混合分支状态的单项 L2 探测，不是完整套件或 Desktop 验收。生产代码、仓库 Pack、正式测试、manifest 和 lib 均未修改。

现有生成流程在 `packages/desktop/src/local-site.ts:205` **先 sleep，再检查失败计数**。默认两条分支相同 sleep 时间，因此现有用例通常在另一条分支结束后才看到失败。为稳定观察真实重叠区间，仅在本探测创建的临时 installed Pack 中，给 `synth-b` 工具 argv 加入现有 Makefile 参数 `STANDIN_SLEEP=0`；成功分支保持 3 秒，`failuresByTag={b:1}`，parallelJobs 和 Design-Compiler 席位均为 2。没有伪造任何 Ledger、Job、观测或状态记录。

第二次执行 **1 pass / 0 fail / 0 skip，6.616 秒，SSH 0**。实际观测：

- Run 仍是 `running`，停在 join `judge`；`synth-b` 分支 `blocked`，`synthesize` 分支 `running`。
- 直接询问测试独占 tmux 确认成功分支的 session 仍活着，失败分支的 session 已停止；blocker 保存正确 node 身份和真实错误日志。
- 同时读取 `/hima/` 的实际 HTML，两条分支分别显示 blocked/running；cancel 控件存在，resume 控件不出现。此时直接请求 resume 得到 409，并未启动新 Job。
- 同伴完成后 Run 进入 waiting；这时 resume 成功，只重跑 `synth-b`。最终三个 launched Job 的 branchId 为 `synthesize, synth-b, synth-b`，只有一条 resumed 记录，所有 Job session 均已结束。

原始 HTTP RunView、HTML、恢复拒绝与最终结果分别存于本目录。运行使用真实 Host 子进程、临时 Site 文件和实际本地 make/tmux。`run.py` 建立独占 TMPDIR/TMUX_TMPDIR/home，复用现有 no-SSH guard，仅清理自己创建的 tmux socket 和目录。没有 Desktop、模型或远程 EDA 投入。

第一次 probe 已命中混合状态，但我错误地期待 flow 日志里的 `failing on purpose`；blocker 实际保存 Job stderr 中的 `synthesis was told to fail this attempt`。这是探测断言错误，保留 `first-probe.ts`、`first-probe.log`、`first-execution.json` 和 `first-partial-run-view.json`，修正了诊断匹配后才得到本次通过，没有修改产品去迎合断言。

复现入口（在仓库根目录）：`python3 docs/assessment/2026-09-11/pls-06/partial-fork/run.py`。脚本显式指定 Node 24，并传播探测退出码。这份 probe 未加入正式测试清单，因而不计入正在运行的全量 local 数量；父任务可以独立引用此单项证据。
