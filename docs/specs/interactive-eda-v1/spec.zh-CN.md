# 交互式终端与 EDA Operator：需求、接口和验收方案

日期：2026-09-23。基线：`301a4818af9d5e98b3092dfdddd5656a98ec37de`。

开发跟踪：[INTERACTIVE-EDA-01 / #50](https://github.com/lluzi/hima_harness_reforge_polishing/issues/50)。

**状态：需求已确认；本文为下一阶段方案，接口字段均为建议，尚未实现。** 用户本轮明确选择“先补齐方案、接口和验收标准”。没有改运行代码、启用终端插件、运行本地/远端测试，或恢复暂停的 trial30。

## 1. 用户结果

工程师能够让 Agent 通过真正的交互式终端操作 EDA。例如在 XTop manual ECO 中：加载一次设计，连续查询对象和时序，根据上一条输出决定下一条操作，修改工作副本，检查结果，保存明确的 checkpoint，导出 ECO 交付物，再进入验证流程。

关键能力是**同一 EDA 进程中的持续操作**。不能每条命令重新启动工具、重读数据库；也不能把 `run_in_background` 加上 log tail 就宣称已经支持交互。

EDA Operator 是承担这类任务的 Agent 角色，具有工具知识、当前设计/会话上下文及明确任务范围。第一版由 owning Campaign Agent 在对应节点承担此角色；分析型 subagent 可以只读协助。以后允许专门的操作子 Agent 时，须增加明确的节点级委派与单写者约束，不能让子 Agent 获得整个 Run 的第二份执行权。

## 2. 当前实现与实际缺口

| 层 | 当前证据 | 能支持 | 不能据此宣称 |
| --- | --- | --- | --- |
| 普通 Bash | 安装的 `dsh-tool-bash@0.1.5-alpha.1` | 每次新 shell；前台结果；可选后台 Job 输出/终止 | 保留 REPL/EDA 内存状态；后续 stdin 输入 |
| 持久 Bash | 安装的 `dsh-tool-bash-persistent` | 每 Agent 一个 shell，跨调用保留 cwd/env；部分平台能识别输入等待 | 任意交互工具都能安全提前返回；超时/取消不丢状态 |
| 原生终端 service/backend | 已安装 `dsh-terminal`、`dsh-terminal-bash`，默认 standard 组合未挂载交互工具 | owner-scoped PTY、send/read/signal/cleanup；行式交互 | 当前 Hima profile 已有完整 model-facing tools；Host 重启后 PTY 仍在 |
| Hima Job | `jobs.ts`、`channel.ts` | local/SSH、tmux、日志、退出文件、身份、资源与恢复 | 活动进程的标准输入通道、交互回合和 prompt 协议 |
| Hima 执行 | `hima_execute`、Fabric owner/epoch/revision | 节点 begin/work/read/complete、控制和证据 | 当前存在 interact/send 操作；工具内部任意 Tcl 被 Permit 逐条约束 |

具体缺口：`jobs.ts::wrapperScript` 将 stdout/stderr 重定向到日志；即使外面使用 tmux，工具的输出也不是直接连到 PTY。`Channel.exec` 的 stdin 是一次命令的输入，不是一个持久 EDA 会话。现有 Job API 没有受控 send-input。

当前默认 standard preset 配置为一次性 Bash。`@deepseek-ai/dsh-tool-terminal@0.1.5-alpha.1` 的发布包已查到，但本仓库 manifest/lock/node_modules 均没有它。它提供 `terminal_open/send/read/signal/close/list` 六个工具；不是当前 Agent 已经有但没用的隐藏能力。原生 `terminal_send` 可后台返回通用 jobId，再由 `job_output` 读取；这些通用 Job 身份仍不是 Hima 的 Campaign Job。

原生 `TerminalSessionService` 的已见接口为 `spawn/startSend/read/signal/kill/list`，使用 exact Agent ownership；等待原因区分 `stdin_read/inferred_idle/timeout/session_exit`。终端会话是 process-local，owner/service dispose 会清理。其 `read` 为有界 scrollback 页，不是 Hima 的持久证据游标。

持久 Bash 在 timeout、取消或不确定状态时可能重置 shell；文档还对 foreground child 的 stdin readiness 存在平台条件。这与“加载昂贵 EDA DB 后等待几分钟仍保留会话”的要求不同，因此**不通过简单替换 Bash 插件完成这个功能**。

来源：[当前 Job 实现](../../../packages/harness/src/jobs.ts)、[Channel](../../../packages/harness/src/channel.ts)、[Fabric](../../../packages/harness/src/fabric.ts)、[原生终端固定源码](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/terminal)。安装包/类型的本轮核查另见 [native-evidence.md](native-evidence.md)。

## 3. 产品形态：批量命令和交互会话都要有

### 普通工程工作

保留当前一次性 `bash` 的名称和语义；为需要状态的工作提供清楚的交互式终端入口，内部优先复用 DSH terminal service/backend 及经核查的 model-facing consumer。界面上可统称“命令与终端”，但 API 不把一次执行和持续会话混成同一种返回值。

普通终端适合本地 REPL、检查脚本、调试工具。它使用 DSH 权限和 exact owner 生命周期。其输出不会自动获得 Campaign evidence 身份。新增终端不能绕过现有 Pack 作者会话的“禁 shell、限制写入范围”规则；仅封禁名字 `bash` 已不足够，创建/输入/信号等新入口均需纳入真实工具清单复核。

### Campaign 内的 EDA 工作

交互 EDA 是 **Pack 声明的 tool 的一种执行模式，仍属于现有 Job 和 admitted node**。工具启动、输入、输出、费用/许可、关闭和结果都经过现有 Fabric/Job/Channel/Ledger 路径。不要让 Agent 为了进入 REPL 私自开 SSH、tmux 或第二 root 来绕过节点和 Site 控制。

现有参考图保留；一个交互节点内部可以有多轮命令，不要求每条命令成为图节点。只有形成独立输入/产物/判断、需要独立重试或回溯的业务阶段，才分成节点。

Workbench 复用当前节点卡和终端/证据入口：工程师能看完整会话、当前输入状态、谁在操作、命令队列、已保存 checkpoint、在途作业与剩余预算，并随时暂停新输入或中断当前操作。

## 4. 最小职责分配与接口

### 4.1 三种身份不可混用

- `runId + executionId + ownerEpoch`：谁有权推进该节点。
- `jobSession + toolSessionId`：实际 Site/进程会话身份。DSH 的 PTY ID 与 tmux session ID 都不能单独代表业务授权。
- `requestId + commandId + inputDigest`：某一次输入的唯一身份和原字节，防止重复派发、错会话与重试误执行。

以既有 Ledger/Job 记录为权威。终端的屏幕、scrollback、前端缓存只作投影。每次写操作都重新验证 owner、epoch、execution、method/input identity、暂停状态与预算。

### 4.2 Pack 声明（建议，非现行 schema）

在既有 `packTool` 增加可选交互配置，未声明时保持现有 batch 行为：

```yaml
# 示意，不可直接放入当前 contract.yml 运行
id: manual-eco
execution:
  mode: interactive
  adapter: xtop-terminal-v1
  policy: campaign-workspace-eco
  protocolVersion: '1'
  idleLimitSeconds: 900
  inputMaxBytes: 16384
  outputPageBytes: 65536
# argv、inputs、licences、Site wrapper 等继续用已有声明
```

`adapter` 负责工具版本、启动/初始化、prompt/完成/错误判别、checkpoint/退出和产物验证；不能只靠一个通用正则识别所有 EDA。`policy` 指向 Site 已允许的交互能力和命令/执行环境边界，不是模型自报“安全”的标签。示例数值是首轮可配置预算建议，须通过测试校准；不是已实现常量。

输出至少声明 transcript、checkpoint manifest，以及该节点实际需要的报告或 ECO 文件。工具版本不支持 adapter 时在准备阶段明确失败，不能退回无记录的裸 shell。

### 4.3 Agent 业务入口（建议）

沿用 `hima_execute`，而不建立独立业务控制服务：

| 请求 | 含义 | 必须有的回执 |
| --- | --- | --- |
| `begin` | 按现有流程取得节点执行权 | executionId、owner/epoch、允许动作 |
| `work`，tool mode=interactive | 启动或核对已启动的唯一工具会话 | job/toolSession 身份、状态、首次输出；不会因客户端等待结束自动判节点完成 |
| `interact: read` | 读取现有 transcript 的有界增量 | cursor、范围、截断/缺口、当前状态，不产生新命令 |
| `interact: input` | 向该会话输入一条或一段明确原字节 | commandId、派发状态、输出/后续读取位置、完成证据或 unknown |
| `interact: interrupt` | 请求中断当前前台操作，尽可能保留 EDA 会话 | signal requested/delivered 与后续实际状态分开 |
| `interact: close` | 在允许边界请求工具正常退出；失败后按既有取消策略处理 | 退出确认、产物保存状态、许可释放状态；未知不写成功 |
| `complete` | owner 请求结束业务节点 | 依现有规则检查实际输出、退出/关闭、Reader/Judge 和引用 |

原生 model-facing tools 与此表不是同一协议：普通工程终端直接消费六个 `terminal_*`；Campaign 只开放经 Hima admission 的 `interact`。不要同时向同一活动 EDA 会话提供一条绕过 Hima 的原生输入路径。

`input` 的建议请求字段：`runId/executionId/toolSessionId/requestId/expectedEpoch/expectedRevision`、`text`、`submit`、`waitMs`。只将 `waitMs` 解释为这次调用等待输出的上限，不解释为命令终止时间。原生 0.1.5 `terminal_send` 没有 per-call waitMs 字段，适配层必须独立实现有界等待，不能将其翻译为取消 signal 或重置会话。

控制字符单独声明：正常输入不得夹带隐藏 Ctrl-C、Ctrl-D 或终端 escape 来执行隐式控制。`submit` 区分“写入”与“提交换行”；多行 Tcl 由 adapter 的提交方式处理，不能用 shell 拼接。需要分页器按键/确认输入时，也必须记录明确的交互操作和对应等待原因。

`read` 复用只读事实入口的身份检查；它可以服务已获准的旁观者，但不可写。`input/interrupt/close` 第一版只对 owning Agent 和明确的人类控制开放。EDA Operator 子 Agent 的节点级可撤销委派是后续切片，不通过 UI 选择或传入任意 sessionId 自动授权。

### 4.4 返回状态（建议）

进程存活、交互准备、命令完成和业务成功是四件事。回执分开表达：

```text
transport: connected | disconnected | unknown
process: running | exited | unknown
interaction: starting | ready | busy | awaiting-input | interrupted | uncertain | closed
command: admitted | sent | completed | failed | outcome-unknown
business: 未由终端回执判定；仍由 Reader/Judge/owner 完成协议决定
```

原生 send 在 `inferred_idle/timeout` 后可能已释放它自己的 send lock，但前台 EDA 命令仍运行。Hima 需要按 commandId 保持自己的单写者门，直到 adapter 确认命令完成/可提交下一条；向当前命令补输入必须显式携带 `replyToCommandId` 和 `reply-to-input-request` 语义，不能误当下一次 ECO。

`inferred_idle`、看到 prompt 文本、没有新输出都不能单独证明命令成功。由 adapter 给出 command completion 证据；若只能观察输出，就如实保留 unknown。OS exit code 0 也不能覆盖 EDA 内部 Tcl error 或报告缺失。

## 5. 传输、超时和恢复

### Local 与 SSH 共用现有 Channel 思路

普通本地交互优先复用 DSH PTY。Campaign 的远端会话优先加深现有 SSH/tmux Job：工具直接连接真实 PTY，输出通过受控 transcript capture 保存；SSH 断开不应按默认路径结束远端 EDA。不能仅在旧 stdout 重定向外增加 send-keys 就当作完成。

Hima 的 transcript cursor 由持久追加流产生，并记录可读起点/终点及缺口；原生 newest-relative scrollback offset 不可改名后冒充稳定 cursor。若输出在 capture 前已丢失，必须标记 gap，禁止用残缺 transcript 证明完整命令结果。

适配器需验证本地与远端实际 `isatty`、输入回显、ANSI、UTF-8、无换行输出、管道和工具启动方式。具体 tmux pipe/capture 或 DSH backend 方案由最小 L2/L4 证据决定，不预先宣称其中一种已满足所有要求。

### 四个时间预算

1. **调用等待预算**：到期只返回当前输出/状态，会话和正在执行的命令继续。
2. **单命令预算**：达到上限按 adapter 约定中断并核实；不能擅自重发。
3. **空闲会话预算**：空闲仍持有工具和许可；界面显示剩余时间，并按已声明的保存/关闭策略收束。
4. **Campaign 总预算**：沿用现有硬预算与关闭预留；到期停止新输入，并按声明策略处理在途进程，记录真实结果。

用户暂停阻止新的改变状态的输入。已经运行的命令按既有明确策略完成或中断；输出和退出事实可以继续收集。命令结束不能自动解除人类暂停。实现前需修复上一轮已定位的人类 hold 来源/清除缺口。

### 至多一次派发，不承诺做不到的 exactly-once

先记录命令意图和字节身份，再尝试派发；相同 requestId/内容返回原回执，相同 ID 不同内容拒绝。如果发送后断线、无法确认是否已执行，标 `outcome-unknown` 并停止后续修改。不能把 SSH 重连当作重新输入 ECO 的理由。

恢复先核对既有 session/进程启动身份、工具状态和最近 checkpoint；不能仅看 PID 或同名 tmux 会话。只在能够证明未执行时重发。无法核对的修改保留待审，使用经验证的 checkpoint/workspace 恢复；transcript 本身不是设计状态恢复机制。

DSH 本地终端在 Host/owner 销毁时可能被清理，不能承诺跨重启保持 DB 内存；远端 tmux 的存活也不意味着 Hima 已自动恢复授权。重启后未知 session 要核对后接管，不能静默重启并回放所有历史 Tcl。

## 6. EDA 专属约束：交互能力不等于任意 Tcl 都受控

启动 wrapper 被 Site Permit 允许，不等于工具内部的 `exec/source/file` 等行为都经过 Permit。Shell/Tcl 字符串黑名单也不能可靠限制嵌套替换、别名和脚本执行。因此明确两种可交付边界：

- **经过验证的交互 adapter**：将需要的查询/修改操作绑定到有类型参数、工具版本和已检查的 Tcl 编码/状态协议；固定脚本也通过会话运行。覆盖到的行为才可以作为受控 Pack 能力发布。
- **自由终端探索**：权限按整个交互工具进程及其执行环境授权。只有 Site 的真实隔离能保持 golden 输入只读、写入范围与凭据/网络边界时，才可纳入对应受控 Campaign。不能提供这种边界时，明确作为普通工程终端操作，其结果须经过显式导入和验证，不能冒充受控 Pack 完成。

这不是要求所有 EDA 命令预先写死。研究可以产生新的命令序列；正式采用前，必须清楚它在什么隔离与授权范围内运行，以及如何验证输出。新增能力不能只靠限制 tool 名字就宣称子 Agent 没有别的副作用。

XTop manual ECO 的最小完成证据：工作副本身份、实际采用的命令/版本、修改前后 checkpoint、ECO 输出及 hash、相关对象/连接变化、后续 fresh extraction/STA，必要的 DRC/connectivity 以及 best/last 的区别。沿用用户既定要求：若采用 XTop 输出到 Innovus 的流程，继续使用两个保路 Tcl，并保留既有验证；本功能不授权改回 loadECO。

## 7. EDA Operator 的上下文与工作流程

Operator 输入应包含：任务和固定约束；Run/node/Job/工具会话身份；工具版本与获准 manual/help；当前工作副本/checkpoint；上一条输入与已证实结果；待完成动作；输出 cursor 和预算。只按需读取 transcript，避免每轮复制整段 EDA 日志。

一轮典型工作：

1. Guide 确认用户目标、Site/tool 能力和可修改工作副本，提出具体计划。
2. owner 在交互节点开始会话，adapter 确认工具已就绪和当前 DB 身份。
3. Operator 查询当前对象/时序，结合输出决定下一步；必要时请只读 specialist 分析。
4. 对一次 ECO 修改取得可追踪命令回执；出现工具 error/unknown 时先处理，不继续堆叠修改。
5. 检查局部结果，显式保存新 checkpoint 和交付物；正常关闭会话并核对许可释放。
6. 后续独立节点读取/验证产物，比较 setup/hold/物理结果；只有这条链支持结果采用和节点完成。

本方案不在未读 XTop 精确版本手册前编造 manual ECO 命令名或 prompt 规则；这些必须在 adapter qualification 中从实际工具建立。

## 8. Workbench 的最小呈现

沿用当前节点面板：

- 当前工具、Site、Run/节点/代际、连接状态、Agent owner 与是否人类暂停；
- 增量 transcript，输入/输出、commandId、时间、错误和不确定状态可追踪；
- “读取输出”“暂停新输入”“中断当前命令”“保存/关闭”的语义清楚；不要一个 Stop 按钮同时代表 Ctrl-C、关闭会话与取消 Campaign；
- 显示长命令仍在运行、工具正在等待输入、连接断开、会话已退出的区别；
- 人类接管时只有一个写者；Agent 待写请求失效或明确排队，交还后重新读取当前状态；
- 大输出截断和 transcript 缺口可见；不要把滚动区域当作完整证据。

第一版只覆盖行式 shell/EDA CLI。curses/full-screen TUI、EDA 图形窗口、鼠标点布局、跨终端共同编辑不在此次交互终端切片中，也不妨碍以后单独设计 Computer Use。

## 9. 验收矩阵

以下为计划，不是本轮通过的测试。先做无需模型/许可的本地 PTY/有状态 REPL，再做小规模真实工具资格检查。

| 层级 | 场景 | 通过标准 / 反例 |
| --- | --- | --- |
| L0 | Pack batch/interactive 声明与 tool/profile 组成 | 原 batch 合同继续有效；未知 adapter/policy、缺关键字段、重复 Bash consumer 明确拒绝 |
| L1/L2 | 本地 PTY + 有状态 REPL | `isatty` 可证；同进程跨 3 次输入保留变量/对象；每次结果均能关联实际输入 |
| L2 | 普通 Bash/持久 Bash/终端区分 | 普通 Bash 原语义不变；interactive 不靠重新启动进程完成多轮 |
| L2 | 有界等待 | 超过调用 waitMs 后返回 busy/cursor；进程仍在，后续读取能看到完成；不能因等待超时重置 shell |
| L2 | prompt 与 error 反例 | 输出伪装 prompt、无换行 prompt、多行 Tcl、工具内 error但OS未退出，都不能误判命令或业务成功 |
| L2 | 输出与证据 | UTF-8 边界、ANSI、大输出、滚动丢页/旧 cursor 有明确处理；持久 transcript 可核对，旧页不混进新 command |
| L2 | 中断/关闭 | Ctrl-C/信号实际回执与 EDA 是否仍可用分别检查；关闭后无残留测试进程；许可状态 unknown 不冒充释放 |
| L2 | 并发与重复 | 同会话仅一条 mutating input 在途；相同 requestId 不重发，内容变化拒绝；并行会话不串状态 |
| L2 | 丢确认与恢复 | 发送后失联保留 outcome-unknown；不重放修改；重启后不能拿旧 PTY ID 当新会话 |
| L2 | owner/作者边界 | foreign session/旧 epoch/旁观者不能输入；Pack 作者禁 shell 不被 terminal 绕过 |
| L2 | 人类控制 | human pause 后 Job/命令结束仍保持 hold；read 可继续，新的 mutation 被拒绝；接管不产生双写 |
| L2 | 预算与许可 | input/output/idle/command/Campaign 预算分别生效；持有许可期间不允许超 cap 再开 session |
| L2 | 命令内越界 | nested Tcl、source/exec/文件写入的越界反例，必须被真实 adapter/隔离拦住或明确拒绝纳入受控模式 |
| L3 | 同工作区操作 | 终端与节点、日志、checkpoint 联动；忙碌/等待输入/断线可辨；键盘可达；不启动真实 EDA |
| L4 Site | 合格 XTop 环境最小操作 | 同一次工具加载完成查询→一次工作副本修改→检查→保存；日志和 checkpoint 匹配，无 golden 修改 |
| L4 模型 | DeepSeek Operator 小任务 | 模型正确选工具/会话、读取真实输出、遇错收束、不重复 ECO；不使用 fixture 代替实际模型证据 |
| L5 | 一条正式手工 ECO Campaign | 独立工具结果验证、物理/时序对照、恢复与交付闭环；不以 terminal 可用宣称 PPA 改善 |

## 10. 开发切片与现有归属

| 顺序 | 范围 | 预计归属 | 退出条件 |
| --- | --- | --- | --- |
| I0 | 当前原生 terminal/model-facing tools 和 profile 的最小装配核查；评估精确 pin 的缺失 consumer | Hima profile、依赖清单、现有 boot/authoring tests | 确认工具名/参数/权限，记录未挂载项；不升级 DSH 主版本 |
| I1 | 普通交互终端体验与作者权限封闭；以 standard 派生 preset 局部组合，保留无通用工具的 hima-moment | profile、原生 terminal consumer、`authoring.ts`、现有终端 UI seam | 本地 REPL、多轮输入、超时/中断、owner 和作者反例通过 |
| I2 | Pack 交互 tool 与 Job 输入/输出协议 | `packs.ts`、`jobs.ts`、`channel.ts`、`ledger.ts`、`node-turns.ts` | 单写者、意图/派发/unknown、PTY 与 transcript 成立，旧 batch 无回归 |
| I3 | Fabric/Agent/Workbench 接口 | `fabric.ts`、`tools.ts`、`remote.ts`、当前 client API/节点面板 | 同 Run/node/epoch 全链路、human hold、预算、恢复与 UI 可观察 |
| I4 | XTop adapter/manual ECO qualification | 独立 Pack 候选/工具 adapter、既有 XTop Site contract | 精确版本最小 L4，通过后再安排真实 Campaign；保留原 trial 证据 |

I2/I3 涉及持久记录兼容，实施前需给字段缺省、旧 Ledger 读取、升级/回滚和在途会话处置一个具体测试；不在当前 paused Run 上热改。若原生 process-local terminal 不能承载远端持久会话，优先扩展现有 Job/Channel；任何跨模块新生命周期都要明确成本和 ADR，不把它包装成一个无风险的配置开关。

常规实现按 Terra/Medium，执行权限、输入幂等、恢复和证据边界由 Sol/High 独立审查。共享接线文件由单一集成者拥有；transport 与 schema 稳定后再并行 UI/adapter。测试按最低可证伪层推进，不为文档或 UI 修改重跑完整 P&R。

## 11. 完成定义

用户可以在产品中完成有状态 EDA 操作；同一会话身份、输入输出、暂停/中断/退出、checkpoint、预算与证据可解释；旧批量工作保持；工具未就绪、断线和未知结果不冒充成功；下一位工程师能够从保留材料知道如何继续或回滚。

本文完成的是方案与验收定义。真实 XTop 可用性、交互 adapter 安全边界以及 PPA 收益均待后续验证。

## 文档交付核查

本轮按用户选择只交付设计。已核对 26 个本地文档目标，`git diff --check` 通过；原生接口由 Sol/High 独立静态复核，修正了 native wait 参数、scrollback cursor 和 premature send-unlock 三处适配风险。未执行 L0–L5 产品测试，未启动终端会话、App、模型或 EDA。后续测试项均为验收计划，开发/审查 token 开销未测量。
