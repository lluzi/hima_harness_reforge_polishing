# #106 软件团队：真实 GitHub 验收

验收仓库是用户授权的 `lluzi/himateam_test`。预置的 [Issue #1](https://github.com/lluzi/himateam_test/issues/1)
在基线 `d6fccb90243bc93240e8057f345665b9d5e0ec68` 上稳定复现 CRLF 清单解析失败：
`npm test` 为 1 PASS、1 FAIL。OpenCode 成员在任务分支提交并经 Host 推送
`3ce544bc10186a69a7c8e2d6077988fc46a4c899`，修复后 2 PASS、0 FAIL。
独立 Pi 审查者检查该精确提交的 diff 与测试，Pi lead 通过 Host 创建或复用
[PR #2](https://github.com/lluzi/himateam_test/pull/2)。PR 保持 OPEN，base 为 `main`，
head 精确为上述提交；目标仓库只存在这一条 PR，未执行合并或发布。

最终真实运行使用当前 Pi/OpenCode 混编模板、DeepSeek Flash 和原生 MCP/Host GitHub
接口。官方 `live-model` 测试 `himateam-software.live.test.ts` **1/1 PASS**，
有界运行 208.6 秒、总进程峰值 1,575.8 MiB（预算 2,048 MiB／600 秒）、
swap 增长 0、SSH 尝试 0，Team `resourceState=closed`。验收器先确认基线红灯，
再交叉核对开发者和审查者的已提交结果、各自独立工作树、远端 SHA、PR 内容与
提交身份，并在审查者的实际文件沙箱中再次运行 `npm test`，得到 2 PASS、0 FAIL。
保留证据：
`/Users/lluzi/code/hima_harness_reforge_polishing/.scratch/himateam-issue97/issue106-live/mixed-issue-1-2026-10-15T00-49-21-848Z/`
及同级预算记录 `integration-issue101-trusted-native-issue106-mixed8-result.json`。
产品请求数和 token 未测量，不从账号额度推算。

权限实测包括真实 Pi 的只读 GitHub 检出和沙箱内 `main` 直推 dry-run 拒绝：
`himateam-software-github.live.test.ts` 1/1 PASS，实际成员可读分配的工作树，
无法读取 Host GitHub 配置目录，直接 `git push --dry-run origin HEAD:refs/heads/main`
不能认证。Host/PG 合同另拒绝非人工打开、错误 Issue、错误角色、撤权后的请求和
未绑定租约的写入；策略合同拒绝 `merge`、受保护分支 push、远端删除、tag、Release，
仅允许冻结任务分支 push 与提交绑定的 PR。没有对目标仓库执行破坏性负操作。

真实运行还揭示并修正两处边界。原生会话最初仅换私有 `HOME`，成员仍能用绝对路径
探查宿主；GitHub 软件 Team 现由 Host 在 macOS 文件沙箱中启动，用户主目录的
读取仅为成员工作树、私有控制目录和固定运行依赖开例外。系统路径仍受原有 OS 权限
约束。日志洪泛曾使 Host 在 512 MiB 堆限制下 OOM；
现在仅对 GitHub 软件成员的原生日志设置 12 MiB 上限，达到上限即停止物理工作并
诚实保留未知证据关闭状态。对应真实 Node 反例通过；既有非软件成员的 3,482 条、
27,938,818 字节完整日志合同仍通过。另一次实际 PR 运行发现首个 successor 的
实收回执晚于其 `delegate/wait` 工具回复，导致父任务不能提交结果；现在先记录原生
实收、再放行工具回复。OpenCode 的实收仅取原生 Frame 中的工具调用或完成后的
prompt 回执，不把 OAR 合成的 `turn_started` 当作实收。官方交接合同 18/18 PASS，
原生日志与边界合同 37/37 PASS；独立复核未留下可执行 P1。

人工补充、暂停、继续及旧授权失效已在同一软件任务的真实 Host/PG 合同中通过
（`himateam-software.host.test.ts` 2/2 PASS）。先前的真实模型补充验收
`himateam-software-control.live.test.ts` 亦为 1/1 PASS：原生 Pi 成员实际出生后，
人类暂停将原 Run 从 epoch 0 推至 1，原生进程被持有并禁止新业务；普通同 Run
`continue` 明确拒绝。人类消息落账后，显式 `resume` 先确认旧成员的物理关闭，
再在相同 Task 和原截止时间下创建一个新 Run 与新会话。新成员从 Host 的 MCP 回执
读到消息原文，Host 返回 `state: existing` 和 PR #2 的精确 SHA；用时 53.7 秒、
总进程峰值 618.6 MiB、swap 增长 0、资源关闭。证据：
`/Users/lluzi/code/hima_harness_reforge_polishing/.scratch/himateam-issue97/issue106-live/human-control-2026-10-15T01-39-47-341Z/`。
当前源码在消除代际竞态后，软件及冷重开后继 Run 合同重跑 12/12 PASS；
完整四文件合同先有 39/40 PASS，唯一失败由测试在冷启动恢复完成前读取 App
exit fence 导致，测试现等待已有 `reconciled` 边界。实际绘制的目标 App
控制视图再次 1/1 PASS、40.8 秒、总进程峰值 1,568.1 MiB、swap 增长 0。
所有暂停的 Team
任务投影为 Resume；即使成员尚未出生，普通 Continue 也不能清除旧 Run 的
代际边界。显式 Resume 先核对原任务的物理关闭，再创建新 Run。RunStore 在同一
事务中拒绝暂停、取消或已被替代 Run 的新 effect 准备；既有同身份 effect
仍可幂等读取，用于关闭与恢复。
当前源码的两次真实控制链（`control8`、`control9`）均走到新 Run 的成员
读取人类消息、检出目标分支、Host 回执 `state: existing`／PR #2／精确 head；
最终成员回合因 DeepSeek 上游 HTTP 503 `service_unavailable_error` 失败。
两次保留失败证据，未把它们记为 PASS、未切换产品模型。之前 `control6` 的
完整 1/1 PASS 仍是终态交付证据；竞态修复后的终态模型回合尚未取得绿色结果。
真实 GitHub 任务的取消后重跑与多次完整验收也只复用 PR #2，没有重复 PR。
`#109` 仍负责最终安装候选组合核对。
