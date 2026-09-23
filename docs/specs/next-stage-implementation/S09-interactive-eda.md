# S09 — 交互终端与受控 EDA Operator

覆盖：NXT-F1/F2/F3；Operator 子 Agent 的委派由 S06 实施。基线：`1a79cb1`。延续 [现有接口方案](../interactive-eda-v1/spec.zh-CN.md) 与 [原生能力证据](../interactive-eda-v1/native-evidence.md)。状态：资格切片可派工，受控商业操作须各门通过。

## Problem Statement

现有一次性 Bash 与后台日志不能让 Agent 在同一 EDA 进程内观察并追加输入。manual ECO 每次重载数据库成本高；盲重发、误判 prompt 完成或子 Agent 双写会破坏设计状态。

## Solution

保留一次性 bash，在现有 DSH profile 补真实 PTY；受控工具交互仍经过 Pack tool、Fabric、Job、Channel 和原证据记录。Operator 在获准工具、工作副本和预算内自由组织命令，保存可验证 checkpoint。

## User Stories

1. 作为工程师，我希望加载一次数据库后连续查询/修改，从而避免重复启动工具。
2. 作为工程师，我希望等待超时只返回当前进度，从而不中断长命令。
3. 作为工程师，我希望工具等待输入与真正空闲分开显示，从而知道下一步该做什么。
4. 作为工程师，我希望可以暂停新输入、中断当前命令、保存和退出，从而掌握工具状态。
5. 作为工程师，我希望所有输入输出和缺口留存，从而可复核操作过程。
6. 作为工程师，我希望发送后失联不自动重发，从而不会重复插入或删除Cell。
7. 作为工程师，我希望只有一个操作者能写入，从而子Agent不与owner争抢终端。
8. 作为工程师，我希望自由组合manual命令，从而不受几个预设ECO菜单限制。
9. 作为管理员，我希望命令内的source/exec也不能突破授权环境，从而保护golden输入和其他项目。
10. 作为工程师，我希望保存后独立验证DB/STA/物理质量，从而不把exit 0当业务成功。
11. 作为工程师，我希望退出App后如实看到哪些会话存活，从而正确恢复。

## Implementation Decisions

### 已核实基础和代码范围

| 文件 / 现有接口 | 原职责与升级 |
| --- | --- |
| `profiles/hima/cordis.patch.yml`、`profiles/hima/package.json`、`pnpm-lock.yaml` | standard 当前一次性bash；精确资格化并挂载缺失的 model-facing terminal consumer，禁止顺手升级整个DSH |
| `packages/harness/src/authoring.ts` / `GOVERNED_TOOLS`, `registerAuthoringGuard` | 新terminal入口同样受到作者禁shell/写入政策限制，不仅封名字bash |
| `packages/harness/src/packs.ts` / PackTool读取与校验 | 原tool增加可选interactive声明；未声明保持batch，不复制Pack schema |
| `packages/harness/src/jobs.ts` / `wrapperScript`, `launchJob`, `jobStatus`, `jobKill` | batch stdout/stderr重定向；增加交互执行分支与同一Job身份，不用tail假装stdin |
| `packages/harness/src/channel.ts` / Channel、LocalChannel、SshChannel | 在原执行传输内承载读写输入/信号/状态；不直连另一个SSH服务 |
| `packages/harness/src/fabric.ts` / `executionAction`；`ledger.ts` / RunControl与Job记录 | 请求去重、command状态、epoch和预算/暂停执法；只增必需记录字段 |
| `packages/harness/src/tools.ts` / `hima_execute`；`remote.ts` / 现有执行读控路由 | 提供有界open/read/input/wait/signal/close能力，保持同一owner与错误回执 |
| `packs/xtop-timing-closure/flow/closure.py` 与 `flow/templates/` | 精确版本XTop adapter：初始化、输入就绪、完成/错误、保存与退出；文件可局部拆分，职责仍为Pack工具适配 |
| `packages/harness/src/client/NodeCard.tsx`、`client/api.ts` | 交互状态和轨迹入口交给S08，不增加第二Workbench |

原生0.1.5-alpha.1 terminal service/backend已安装，consumer未安装/挂载。其send没有per-call waitMs；scrollback offset不是持久cursor；inferred_idle/timeout可释放原生send锁；PTY是进程内对象。以上限制必须保留在适配设计里。

### 冻结的操作语义（字段以现有接口增量表达）

- 身份：runId、executionId、ownerEpoch、toolSessionId、requestId、commandId、inputDigest；开始工具前绑定tool版本、workspace/DB身份与授权范围。
- open产生一次实际Job/toolSession；重复request返回原回执，不启动第二进程。read/wait仅返回有界增量与durable cursor/gap，不产生新命令。
- input含原字节/submit/等待上限，写前记录意图，写后确认派发。相同ID异内容拒绝；发送后未知标outcome-unknown，禁止重发mutation。
- waitMs只是调用等待；命令期限、会话期限与Campaign硬预算分别执行。原生idle不能释放Hima的command单写者；回应工具追问带replyToCommandId，不能混为下一命令。
- 输出分别给进程存活、输入准备、命令完成、业务有效性。无输出/提示符/exit0均不能单独证明业务成功；真实Tcl error/缺报告仍失败。
- signal与close单独操作，Ctrl字符不可藏在普通input中。human hold阻止新mutation；只读观察和明确收束可继续，不能自动解hold。
- transcript追加到原Job工作目录，记录cursor、字节身份和gap，Ledger保留引用。不能另建终端日志数据库，也不能拿原生易失scrollback充当完整记录。
- 断线/Host重启先核实原Job或checkpoint；本地已丢PTY只能从确认的checkpoint重建，不能冒充原进程续连。
- 自由命令的环境必须实际限制write/exec/network/凭据边界；受控Campaign不能因隔离不足降级成“普通终端也算完成”。qualification不通过就阻塞此能力，其他batch路径继续可用。
- XTop输出仍使用两个保路Tcl；最终结果经fresh extraction/STA与所需物理检查。S03决定best采用。

### 子切片与并行

S09a/F1：精确依赖/profile、原生REPL和作者guard资格；可与Pack内容并行，只有取得consumer证据才提交依赖修改。
S09b/F2：在现有Job/Channel上完成交互合同与故障反例；依赖S01a控制，S02对channel发现部分合入后再接线；共享状态文件由集成者写。
S09c/F3：XTop adapter的输入/完成/保存最小资格；可用保存的真实输出先编写解析反例，真实命令名与行为必须从精确工具手册/小型授权会话取得。
S09d：S06有界Operator委派+S08轨迹接入；两者均消费单一toolSession和回执。

为收敛，每个切片先一个consumer/一个工具版本，不构建通用terminal backend生态。新小adapter/helper须有真实消费者且仅承担原模块职责。

## Testing Decisions

主seam是公开 `hima_execute`/Job操作，底层昂贵EDA替换成真实本地REPL进程，不能复制Fabric语义。复用 `test/contract/jobs.test.ts`、`node-jobs.host.test.ts`、`agent-controls.host.test.ts`、`profile-overlay.test.ts`、`pipeline-stages.host.test.ts` 和现有独立Host/home。新交互用例按现有分组登记，建议文件 `test/contract/interactive-eda.host.test.ts`（尚不存在）。

正例：同进程写变量→下一命令读到→保存→正常退出→验证产物。反例：假prompt、多行输入、超时仍运行、output gap、断线发送未知、重复request、旧epoch、双写、路径穿越、source/exec越界、budget到期、作者会话terminal逃逸。

实现后基线：`pnpm run build`；`pnpm run test:local --files test/contract/jobs.test.ts test/contract/node-jobs.host.test.ts test/contract/profile-overlay.test.ts test/contract/agent-controls.host.test.ts test/contract/pipeline-stages.host.test.ts`，再运行已登记的新文件。关键terminal UI做L3；本地协议通过后才小型L4 XTop，不以完整P&R作为F1发布条件。当前禁止启动这些测试。

## Out of Scope

屏幕自动化作为terminal协议、替换一次性bash、通用remote shell服务、自动安装/升级客户EDA、承诺exactly-once副作用或PTY跨进程永生。

## Further Notes

批量路径兼容必须保留。发布新App与改变的Pack，保留原固定版本与checkpoint；回滚先结束/保留有回执的旧会话，不能把其输入投到新进程。普通profile/adapter Terra/Medium；单写者、权限、预算和恢复Sol/High复核。
