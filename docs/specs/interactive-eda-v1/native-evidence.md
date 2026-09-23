# 原生终端复用核查

2026-09-23；Hima 源码基线 `301a481`，安装的 DSH `0.1.5-alpha.1`。本轮为 read-only source/config/type 审查，没有 boot Host、执行 PTY、安装依赖、调用模型或 EDA。

## 当前组合

- `dsh-web-app` 默认 `standard` preset；standard 使用 `dsh-tool-bash` 和普通 job tools，每条 Bash 为新的 shell。
- PTY service/backend 与 persistent-bash 已在依赖闭包中，minimal preset 可以使用持久 Bash；这不代表 Hima ordinary standard Agent 已有 terminal tool。
- model-facing `@deepseek-ai/dsh-tool-terminal@0.1.5-alpha.1` 已发布但本 checkout 未安装。核查读取了其发布包，未执行。registry integrity：`sha512-Ao6sC/wQOSr2hTL3vniMrdDKwA1gfAlfbV3Gqn3OiI+BLxR/Aaq8rVE5Aqp8puKwhTIYYwo9ELwo+wyb3uxT/Q==`。
- Hima 的 `hima-moment` preset 有意不挂通用工具，不能通过全局 terminal 注册改变它。

## 精确原生工具（已查发布包，不是当前可调用工具）

| 工具 | 输入 | 边界 |
| --- | --- | --- |
| `terminal_open` | type；可选 name/cwd | 返回 owner-scoped sessionId 和启动信息 |
| `terminal_send` | sessionId/text；可选 submit、run_in_background | foreground 回 waitReason/viewport；background 回通用 jobId；没有 per-call waitMs |
| `terminal_read` | sessionId；可选 offset/count | offset 相对最新保留行，不是持久 cursor |
| `terminal_signal` | sessionId/signal | 支持 SIGINT 等；回已投递进程组，不等于业务停止 |
| `terminal_close` | sessionId | 等待已捕获进程树清理；不是业务保存命令 |
| `terminal_list` | 无 | 只列出当前 Agent 的 session |

服务 API 为 `ctx.terminals.spawn/startSend/read/signal/kill/list`，限制 exact Agent ownership 和一次 active send。Session 是 process-local，owner/Host dispose 后不能保证保留。

PTY backend 普通 send 的 readiness timeout 只返回，不杀 shell/EDA；startup timeout 和 explicit close 的语义不同。persistent-bash consumer 则可能在 timeout/cancel/exit 重置 shell，不能混用。`inferred_idle` 是静默推断，不是已完成；原生 send lock 释放后前台程序仍可能运行。

本地 sandbox policy 在 open 时确定；已存在/创建中的终端会阻止策略切换，不能宣称可对同一存活广权限进程动态降权。工具过滤不等于 Tcl 语义授权。当前原生能力主要面向行式终端，不应以此宣称支持 full-screen TUI、命名按键或 EDA GUI。

## Hima 对接落点

- 普通终端：使用 product-owned、从 standard 派生的局部 preset；显式补齐 consumer 依赖与 composition，保留一次性 Bash。
- 受控 EDA：已有 `jobs.ts/channel.ts/node-turns.ts/fabric.ts` 承载真实 Job；新增输入与 transcript 协议必须纳入同一 owner、Permit、预算、证据和恢复链。
- 原 `jobs.ts:115` 将 stdout/stderr 重定向日志；外层使用 tmux 并不证明 EDA 的输出 fd 是 tty。
- `authoring.ts` 当前主要约束 write/edit/bash；新增 terminal 输入等入口必须重新验证作者边界，不允许绕过。

## 主要来源

- 本地安装包的 README、`lib/types/index.d.ts`、`types.d.ts` 与 `lib/index.js`：`dsh-tool-bash`、`dsh-tool-bash-persistent`、`dsh-terminal`、`dsh-terminal-bash`、`dsh-tool-jobs`。
- 本地 `dsh-agent-presets/presets/standard/agent.cordis.yml`、`minimal/agent.cordis.yml`；`dsh-web-app/cordis.patch.yml`；Hima `profiles/hima/cordis.patch.yml` 与 `hima-moment` preset。
- [精确版本发布元数据](https://registry.npmjs.org/@deepseek-ai%2fdsh-tool-terminal/0.1.5-alpha.1)；[官方固定源码](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/terminal)。
- 独立 Sol/High 审查记录保留在 `.hima-tmp/interactive-eda-20260923/native-audit.md`。其读取边界为源码/类型/发布包；没有 runtime 验证。新 spec 已吸收 waitMs 非原生字段、scrollback 非持久 cursor、native lock 与命令完成不同三项修正。
