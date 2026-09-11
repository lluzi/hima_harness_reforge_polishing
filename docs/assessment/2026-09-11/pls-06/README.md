# PLS-06：运行控制验证与并发恢复修正

批次基线 `f0a5d4a`。本地真实 Host 的两个界面同时调用 resumeRun 时，复现出同一个 blocker 被两条 resumed 记录重复清除。失败证据在 resume-race-reproduced.log（2 != 1）；最初 resume-race-red.log 是测试准备把预期 blocked 命令错当 success，已先修正断言再获得真正反例，没有为这个准备错误修改产品。

修正在现有 fabric.ts：沿用 Ledger/Job/Experience 已有的每 Ledger、每 Run promise 排队方式，只串行“读取最新状态→检查→记录人的恢复→更新运行位置”这一段；drive 和实际 Job 在队列外执行。下一请求读到真实 running/终态后得到原有 not-waiting 回答。失败的准入不阻塞后续请求，已完成的临时队列项清除。没有新增持久状态、schema、运行组件或远端 kill/连接实现。

当前三个新增 L2 反例通过（5.802 秒，0 skip、SSH/Electron 0）：同时恢复只清除一次且只启动一个替换 Job；恢复与取消竞争后保持终态且没有存活 Job，后续重复动作不改历史；恢复时 Pack 暂缺失败后纠正并能继续。类型检查通过。原取消/重启/Job不可读的完整本地场景已在本批 PLS-02 的干净副本作为修改前基线执行；本次修正后的整体回归与两条窗口控制路径将在合并版本上补齐，本记录尚不代表 PLS-06 最终验收。

回滚只恢复 fabric.ts 恢复入口和本任务测试/分组，不改变 Ledger 数据。代码与运行仅在 polishing，source/legacy 只读。
