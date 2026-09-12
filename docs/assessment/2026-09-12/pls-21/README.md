# PLS-21 / #24：Goal 声明与输入接纳

基线：`4d8bc8c`；工作分支：`codex/pls21-input-admission`。源码、测试及构建仅在 polishing 独立 worktree 完成，两个源项目只读。本目录所含提交为交付身份；`SOURCE_SHA256SUMS.txt` 保留最终源文件、测试与锁文件身份。

## 行为与接口

`contract.goal` 可声明一个或多个数值目标，结构与 Strategy 数值字段共用 unit/min/max/default/可选 precision；默认值用于表单，缺少 Goal 字段的提交不会由默认值补齐。例如：

```yaml
goal:
  improvement_pct: { type: number, unit: '%', min: 0, max: 100, default: 5, precision: 2 }
words:
  improvement_pct: { label: relative improvement, unit: '%' }
```

Goal 名称必须与 graph 的 Goal 引用一致；文字单位必须与声明相同。`goalDeclarationOf(pack)` 取得声明，`goalFrom` 与 `strategyFrom` 执行接纳。旧 contract 未声明 Goal 时保留 graph 引用映射；没有 Goal 引用的一次性旧 Pack 使用显式 legacy period 映射。该兼容参数与旧数值图表标记集中在 `run-arguments.ts`，不再构成通用表单固定字段。旧 Run 的数字 Goal 存储格式未改变。

HTTP、命令、工具和两种表单均进入 `startRun` 的最终 Pack 读取与接纳。UI/工具可用十进制字符串保留用户原文，最终 Goal 和 Strategy 数值按声明转换。拒绝重复名字、未知名字、空值、非有限值、不可无损往返的数值、超范围和超精度值。HTTP 先确认 JSON 语法，再按 token 检查同一 object 的重复键（含转义同名）和数值原文；不会让 `JSON.parse` 丢失的信息授权启动。Strategy 的未知候选、超范围候选在下一代产生前被拒绝；Goal 不随候选变化。

动态值和最终工具/Workshop/reader argv 拒绝 dollar expansion、反引号、引号、shell 操作符、反斜杠和控制字符。保留合法空格，固定脚本仍通过文件传递。Reader 的首 operand 固定 wrapper 校验沿用已有 schema，并加强最终 argv 接纳。Permit 的真实路径/符号链接检查保持原职责；新增 Campaign 相对输出路径规则拒绝 absolute/`..`，模板和 Site 绑定后均检查。Workshop 的空白 purpose 和 graph 未绑定声明同时拒绝。

`StartRunRequest.goal` 的输入类型扩展为 `Record<string, number | string>`；持久化仍是 `Record<string, number>`。`StartChoices.goal` 是 UI 的 Goal 声明。PLS-19 可以复用这些入口，不需要自己的 Goal 校验。

## 验证

归档日志仅去除行尾空白，保留命令输出、错误和统计；hash 针对归档内容。

| 层级 | 命令与证据 | 结果 |
| --- | --- | --- |
| L0 | Node 24，frozen lockfile 安装；`pnpm run build` / `pnpm run typecheck` | exit 0；见 build-final.log / typecheck-final.log |
| L0 | `pnpm run check:boundary` / `pnpm run check:seams` | exit 0；旧固定 Goal 文件豁免已删除，只保留明确兼容映射与旧 rule |
| L1/L2 | `pnpm run test:local --files test/contract/substitute.test.ts test/contract/input-admission.host.test.ts test/contract/start-form.test.ts` | 14 passed，0 failed/skipped；67.092 s，4 个进程 Host + 5 个进程内 Host；见 final-admission.log |
| L2 回归 | `pnpm run test:local --files test/contract/input-admission.host.test.ts test/contract/pack-readers.host.test.ts test/contract/workshop.host.test.ts` | 10 passed，0 failed/skipped；28.000 s，10 个进程内 Host；见 host-regression-green.log |
| L1/L2 最终局部回归 | 原型属性名拒绝与最终 output literal guard 修改后重跑 input-admission.host/substitute | 10 passed，0 failed/skipped；17.372 s，5 个进程内 Host；见 final-guard-regression.log |
| L3 | `node --test --test-name-pattern='native declared improvement Goal' test/contract/unified-workbench.test.ts` | 1 passed，0 failed/skipped；14.432 s，1 Electron/Host；见 l3.log、screenshots/ |

L3 实际操作了原生统一工作区：新 Goal 显示 `%`，`1.001` 被拒绝且无 Run，改为 `5.25` 后创建 Run，Host 存储值完全相同。已目视核对错误字段、单位、提示和同屏对话；未发送聊天草稿。L3 后仅提取 legacy 参数兼容常量和加强路径/字典接纳；最终构建和 typecheck 通过。

L2 包含实际 make 与 Pack reader `sh` wrapper：恶意节点/绑定的 dollar、反引号、换行、分号、引号破坏载荷没有 Job launched 记录，也未生成逃逸标记；合法带空格 Campaign 路径成功生成 reader observation。Goal 测试包含旧 period、新改善字段经 HTTP/命令/工具进入、预检后 contract 改界限、合法边界、重复 raw JSON、精度和下一代策略越界。每次 Runner 使用自己的 TMPDIR、tmux socket、DSH home；最终 admission 测试 SSH 子进程为 0。

## Red → green 与修正

- `literal-red.log`：原 toolArgv 接受 make dollar expansion；新拒绝规则使反例转绿。
- `goal-red.log`：原 contract 拒绝新 Goal 声明；新声明、接口与 UI 转绿。
- `entry-red.log`：原命令重复参数以最后一个为准并启动 Run；新解析拒绝。
- `json-red.log`：原 HTTP 重复字段启动 Run；保留原文的 token 检查拒绝。
- `path-red.log`：原 outputPath 接受越过 Campaign 的路径；模板和绑定后的路径检查拒绝。
- `host-regression.log` 保留中间失败：一次新增测试 YAML fixture 未引用换行字符串；五个既有 reader/Workshop 一次性 Pack 因没有 graph Goal 引用被过严的新兼容规则拒绝。修正测试 fixture，并恢复 legacy 一次性 Pack 接纳后，原断言均在 host-regression-green.log 通过，没有删减。
- L3 首次 fixture 把 select 占位 option 漏算，等待失败；改为等待实际 Pack option 后通过。属于测试 setup 修正，无模型/真实 EDA 调用。

## 适用边界与回滚

改善目标 fixture 用于验证输入协议，借用本地 period stand-in 路线，不是 AES 相对 Fmax 方法本身的验证；不声称任何真实 Fmax 或模型研究收益。L4 模型、L4 Site、L5 均未运行。Workshop 回归使用已有 replay，只证明机制。没有改真实 EDA wrapper；固定 wrapper 的实际 EDA 语义不在这次验证范围。

全量 local 和整合后的双轴独立 review 由 root 执行，本 worktree 未重复全量测试。新增测试加入 local manifest；原断言仍在原测试文件，未迁移或删除。本提交未变更 GitHub Issue 状态。

兼容读取需保留；回滚 UI/声明扩展时不能恢复已证实危险的动态 argv、重复键或路径逃逸。可撤回新的 Goal 表单但保留输入拒绝与已保存数字 Goal 的读取。两个源项目、模型配置、真实 Site 和用户既有作业未修改。
