# PLS-06：运行控制验证与并发恢复修正

批次基线 `f0a5d4a`。本地真实 Host 的两个界面同时调用 resumeRun 时，复现出同一个 blocker 被两条 resumed 记录重复清除。失败证据在 resume-race-reproduced.log（2 != 1）；最初 resume-race-red.log 是测试准备把预期 blocked 命令错当 success，已先修正断言再获得真正反例，没有为这个准备错误修改产品。

修正在现有 fabric.ts：沿用 Ledger/Job/Experience 已有的每 Ledger、每 Run promise 排队方式，只串行“读取最新状态→检查→记录人的恢复→更新运行位置”这一段；drive 和实际 Job 在队列外执行。下一请求读到真实 running/终态后得到原有 not-waiting 回答。失败的准入不阻塞后续请求，已完成的临时队列项清除。没有新增持久状态、schema、运行组件或远端 kill/连接实现。

当前三个新增 L2 反例通过（5.802 秒，0 skip、SSH/Electron 0）：同时恢复只清除一次且只启动一个替换 Job；恢复与取消竞争后保持终态且没有存活 Job，后续重复动作不改历史；恢复时 Pack 暂缺失败后纠正并能继续。类型检查通过。原取消/重启/Job不可读的完整本地场景已在本批 PLS-02 的干净副本作为修改前基线执行；本次修正后的整体回归与两条窗口控制路径将在合并版本上补齐，本记录尚不代表 PLS-06 最终验收。

回滚只恢复 fabric.ts 恢复入口和本任务测试/分组，不改变 Ledger 数据。代码与运行仅在 polishing，source/legacy 只读。

## 集成验证完成情况

合并版完整 local 181/181（0 fail/skip）覆盖既有重启、重试、Job 不可读、取消竞争等路径；另在真实 Host+HTTP+tmux 上完成 [阻塞分支与执行中同伴共存](partial-fork/README.md) 的单项探测（1/1），提前恢复拒绝、之后只重跑阻塞分支。实际窗口的取消与阻塞后继续两例均通过，39.728 秒、2 boots。脚本 checkpoint 完成静态 fit→真实失败/原始日志→修正本地故障输入→继续→两代达成目标/已保存报告，原 blocker 留存。它是自动操作加截图检查，不等于资深工程师研究价值验收。

集成时发现并修正测试操作等待：旧 fillForm 只等 knob 身份，未等 Site 静态检查；新 shared wait 观察同一产品状态，并在两个已有手工填表脚本复用。初次失败及 zoom 后未命中控件的 checkpoint 失败均保留；后者通过先恢复 zoom 1 再实际点击复核，没有把自动点击工具的坐标问题归咎于 Fabric。截图中另有数字/判定列强制不换行造成相邻列重叠，主任务只调整现有固定表格的换行规则，业务状态不变。最终图片及范围见 [桌面证据](../pls02-07/desktop/README.md)。
