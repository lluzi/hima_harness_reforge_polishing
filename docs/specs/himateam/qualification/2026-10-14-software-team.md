# #106 软件团队：本地候选与真实验收边界

状态：本地实现候选，真实 GitHub 开发验收尚未开始。本文件记录当前源码和测试身份，
不把可调用工具、替身写操作或提示词当作真实 PR 资格。

目标仓库由用户指定为 `lluzi/himateam_test`。2026-10-14 的只读核对显示：私有仓库仅有
`README.md`，默认 `main` 为 `5841ab9781a1b117bb1312b31be8ca54783eb692`，没有 Issue，
无 branch protection/ruleset；宿主登录有 ADMIN 权限。因此原生成员不能继承宿主凭据。
已向用户请求具体目标 Issue，或授权在该仓库建立可复现验收 Issue；收到回答前不对目标仓库写入。

现有 Host skill provider 增加 `hima-team-software`，附有可编辑的混编 `team.json`。
任务开头冻结仓库、Issue、base commit、分支与人工来源；原生成员使用私有 HOME，
`member_context` 仅提供当前 grant 允许的 checkout/status、任务分支 push 与 PR 创建。
Host 每次远端写入前复查原 Run/effect/成员、暂停/撤权/退出/期限；Git worktree 验证真实
origin、linked checkout、base 祖先、任务分支和清洁状态。凭据只在 Host 的固定目标
GitHub 命令中使用；push 从临时 Host 私有 bare 仓库发送已检查 SHA 到固定 refs/heads，
不读取成员 pushurl、followTags 或 hooks。PR 先核对远端 head；测试与独立审查各须
提交相同 head SHA，已存在的同 head PR 复用。该约束只能证明绑定字段相同，不能单靠
自报字符串证明测试或审查实际发生。

最低本地证据：构建与整仓类型检查 PASS（受控总进程峰值 1023.234 MiB）；注册新文件
`himateam-github-policy.host.test.ts` 与 `himateam-software.host.test.ts` 共 6/6 PASS，
11.765 秒、峰值 372.813 MiB、零产品模型/SSH/Electron。真实 Host/PG grant 用例拒绝
Guide 冒充人类打开、错误 Issue、错误角色能力、merge、无当前租约和撤权；真实本地 Git
worktree 用例检验错误仓库/分支/base/脏目录、Host 固定 SHA push 参数、被撤权时零外部
调用、PR 幂等以及负责人读取并快进开发者分支。GitHub 写入仍由受控命令端口替身完成，
不是目标远端的 push/PR 证明。原 skill 回归 9/9 PASS；相邻 Team Host 五文件 18/18 PASS
（在后续 GitHub adapter 局部修订之前，未把它改记为新版本复跑）。

独立复核提出的四个 P1（可改 push 配置、授权检查与写入间隔、负责人无候选 checkout、
可变 HEAD）及后续两个 P1（写入前仍有异步步骤、成员仓库 Git 继承宿主环境）已定向修正；
最终专项复核无剩余可执行发现。当前未验证：真实 Pi/OpenCode 从 Issue 复现缺陷、修复、
独立 commit-bound 审查、实际 push/PR 和越权 shell/API 拒绝；人类补充及中断/继续后
PR 去重；真实 PR 内容与测试/审查事实的一致性。缺少目标 Issue 与远端写授权条件时，
这些结果保持 NOT RUN，不据本地候选关闭 #106。

首次本地提交后的原 pre-push 尚未通过，远端 #106 分支仍未创建。第一轮 AES 私有
`initdb` 达到 30 秒期限（第 17 项），同文件独立 3/3 PASS；第二轮 DBOS flow
worker 第 185/186 项各达 75 秒期限，同文件独立 27/27 PASS。第三轮发现更明确的
测试环境错误：Git 的 pre-push 子进程继承 `GIT_DIR`，新增临时 Git fixture 未清除，
第 438–440 项误操作了共享 `.git/config`，使 `core.bare=true`。已立即恢复为 `false`，
将测试 Git 命令与 Host GitHub adapter 改为明确环境；模拟同一 `GIT_DIR` 的注册
6/6 PASS，配置仍为 `core.bare=false`。第三轮第 459 项另有 PG 连接获取超时，
独立受控 Host server 日志表明 PG 曾就绪，不据此归因于 GitHub 新行为。

进一步定点 handoff 文件曾于 subsets 用例复现第二 successor 等待：原生第三次
lead 输入已实际到达，原 Run 未暂停/取消、距截止尚余约 61 秒，6 秒内没有 PG
receipt，但不重发输入的额外 15 秒观察到同一 receipt 自行落账。原断言现先观察
真实原生输入，再以证据支持的 15 秒对账窗要求同一 effect 的 PG receipt，失败时
仍保存原结果与有界诊断。注册 handoff 18/18 PASS、峰值 500.391 MiB；这不把前述
原全量失败改写成通过。上述增量独立复核无可执行发现；下一次本地提交仍必须立即
通过原钩子推送并核对远端 SHA。
