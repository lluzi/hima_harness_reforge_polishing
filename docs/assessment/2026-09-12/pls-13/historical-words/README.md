# PLS-13：历史 Run 的标签与单位

基线：`6b0e1481d8fe279b58e4ee29bc4aa65ff28b4cbf`。工作分支：`codex/pls13-run-words`。
范围：[PLS-13 / #14](https://github.com/lluzi/hima_harness_reforge_polishing/issues/14) 的“旧 Run 仍按原方法身份解释”验收项；Spec review P2 补丁。

## 复现与根因

真实 Host 运行隔离的、以 wait 节点为入口的测试方法，记录 Goal `target_period_ns=2`、Strategy `periodNs=2.25` 和实际方法 digest。之后通过 `installPackMethod` 安装同 ID 的新版本，把标签改为 `upgraded period`、单位改为 `ps`。

修改前 `/hima status` 把原来的 `clock period at most 2 ns` / `clock period 2.25 ns` 改成了 `upgraded period at most 2 ps` / `upgraded period 2.25 ps`，见 [red.log](red.log)：1 fail，退出码 1，9.501 秒。命令、状态工具、HTTP 元数据与新生成报告都按 packId 加载当前安装包，忽略了 Run 已记录的 packDigest。

## 修复

`packs.ts` 增加 `runPackWords(packsDir, run)`，使用现有 `loadRunPack` 验证并加载该 Run 的原方法，解析原标签和单位。未记录 digest 的旧行保留未知，显示原始字段名。已记录身份但原方法不可读时，显示入口保留原始字段名，`hima_status` 保持 `unreadable` 回答。

命令、`hima_status`、`hima_context` 的 facts、HTTP Run view / generation 投影和 Experience 生成使用同一解析函数。HTTP 内部操作改为 `runWords(run)`，调用者必须传 Run。新 Run 的 `startPreparation` 仍读取当前安装版本。本补丁不修改 Fabric、Ledger 或安装/发布逻辑。

新增两个 L2 测试，均使用真实 dsh Host 公共入口和真实临时文件：

- 实际启动的 test-purpose wait Run，在方法升级以及当前 `contract.yml` 损坏后，命令、工具、context、HTTP 仍显示原单位；准备表单显示当前新单位；取消后生成的报告 Strategy 仍使用原单位，未执行试验保留证据不足说明。
- 通过公开 Ledger API 创建仅描述历史身份的 test-purpose Run 行，分别省略 digest / 指定不可用 digest；不伪造执行状态或 verdict。命令和 HTTP 不借用当前标签，状态工具区分无身份与已知但不可读的身份。

第一例显式启用 `HIMA_TEST_LEGACY_AUTO_DRIVE=1`，并通过公共 Host `startRun` 创建无 owner 的历史路径夹具；不启动模型。环境变量在测试后恢复。未改动既有测试断言。

## 本次验证

Node 24；锁定 pnpm 11.25.0。独立 worktree 以 frozen lockfile 安装依赖，复用 polishing 的内容寻址 store，534 包复用、0 下载，13.6 秒。运行前已构建本工作区源码。

| 检查 | 命令（均带 `PATH=/Users/lluzi/.local/node24/bin:$PATH`） | 结果 |
| --- | --- | --- |
| 构建 | `pnpm --config.verifyDepsBeforeRun=false run build` | 退出 0；8.78 秒；[日志](build.log) |
| 类型 | `pnpm --config.verifyDepsBeforeRun=false run typecheck` | 退出 0；23.46 秒；[日志](typecheck.log) |
| seams | `pnpm --config.verifyDepsBeforeRun=false run check:seams` | 退出 0；[日志](seams.log) |
| Pack boundary | `pnpm --config.verifyDepsBeforeRun=false run check:boundary` | 退出 0；[日志](boundary.log) |
| 定点 L2 | `pnpm --config.verifyDepsBeforeRun=false run test:local --files test/contract/historical-words.host.test.ts` | 2 pass、0 fail、0 skip；退出 0；19.472 秒；[日志](green.log) |
| 扩大相关回归 | 上述命令额外选择 `test/contract/pack-method-assets.test.ts` | 9 pass、1 fail、0 skip；退出 1；32.050 秒；[日志](related-regression.log) |

扩大回归的唯一失败是基线既有 `pack-method-assets.test.ts` 旧 Run 恢复用例：它经 `/hima run` 创建了有 conversational owner 的 Run，继而使用 `/hima resume`，被当前执行协议正确拒绝。已交给主任务随 PLS-19 旧路径夹具迁移处理；本补丁没有把该失败计为通过。

开发中两次断言修正保留：[wait Run 实际状态为 waiting](fixture-correction.log)、[报告 Goal 使用原始字段、Strategy 使用声明标签](report-assertion-correction.log)。新测试的类型声明和结果联合类型收窄修正见 [初次类型日志](typecheck-correction.log)。它们是测试错误；生产补丁没有为这些断言改变产品语义。

最终定点测试启动 2 次 in-process Host、2 次 Host 子进程，0 Electron、0 SSH；新增测试没有启动 Job、EDA 或真实模型。全 local、桌面、真实模型、真实 Site 未运行，交由主任务集成后按范围验证。本记录不能证明真实研究或 UI 视觉质量。

## 审查与回滚

已检查本地 diff、导入循环（原有 packs/release 双向关系仍只在函数内读取对方符号）、调用者覆盖和 `git diff --check`。源码、测试和输出 hash 见 [SHA256SUMS.txt](SHA256SUMS.txt)。主任务负责集成后的独立审查与最终验证。

回滚此工作分支提交可恢复旧显示行为，不改任何 Run、归档或保留的方法文件；但会重新引入错误的单位解释，因此应优先修复后继续使用。提交后立即 push 并通过远端 SHA 核对；实际提交身份和核对结果随交接提供。
