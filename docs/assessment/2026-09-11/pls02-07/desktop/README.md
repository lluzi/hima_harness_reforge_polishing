# 集成桌面关键路径与 PLS-06 checkpoint

产品源码与已有 `lib` 固定为 `ac2ed3a36f40a4cb1da7c076fa92eee5818344ae`。本执行代理没有构建，也没有修改产品、测试、脚本或分组清单；只写此证据目录和 `.hima-tmp/pls02-07/` 中的一次性脚本。Root 在诊断后仅修改 `test/contract/support/driver.ts` 的 `fillForm` 就绪等待。前后逐文件 SHA-256 对账覆盖 254 个源码、测试与构建文件；最终相对最初仅该 helper 改变，后续验证期间均未变，见 [最终汇总](final-summary.json)。

## 初次失败与实际诊断

第一组 4 个既有用例中，报告与两个表单用例通过；默认 seeded-local 用例失败：点击后仍在 `/hima/`，30 秒未出现 `run-status`。记录为 **3 pass / 1 fail / 0 skip，4 次 Electron 启动**，没有把此轮算为通过。见 [key-paths.log](key-paths.log)、[命令/耗时](key-paths.json)。

在一个额外窗口中，使用现有测试调试端口延迟真实 Host 静态检查回复，观察到 `checking`、按钮 disabled、没有错误或不匹配；禁用时点击未创建 Run。释放真实回复后状态变为匹配当前 Pack/Site 的 fit，按钮可用，其上边界从 541 移到 608.797 CSS px。随后点击能创建 Run。这证明旧 helper 不等待当前静态检查，允许在按钮禁用/重排期间发出坐标点击；原始失败未保存 click note，不能从该次日志单独精确断定点击落点。

同一诊断窗口随后成功显示实际 stand-in Hard blocker 及原始日志，但我为截图将 zoom 改为 0.85 后，driver 的 resume 点击落到未标记区域，未发出恢复请求，Run 保持一项 Job 的原 waiting 状态。该 checkpoint 记为 **0 pass / 1 fail**，不归因于 Fabric 恢复。见 [原始 walkthrough](checkpoint-walkthrough.json)、[日志](checkpoint.log) 和 [阶段汇总](checkpoint-summary.json)。

Root 的最小修正是 helper 填写后等待匹配当前选择的 `start-check=fit`；settled 非 fit 明确报错，未改生产 UI 或引擎。修正后的 checkpoint 去掉人为延迟，并在点击 resume 前将 zoom 恢复为 1。

## 之后只执行必要范围

| 命令/范围 | 结果 | 实际 Electron 启动 | 命令墙钟时间 |
| --- | --- | --- | --- |
| `pnpm run test:desktop --files test/contract/honest-standin-window.test.ts` | 1 pass / 0 fail / 0 skip | 1 | 30.522 秒 |
| Native Node 仅筛选 `window.test.ts` 的 clicking cancel / hard-blocked resume 两例 | 2 pass / 0 fail / 0 skip | 2 | 39.728 秒 |
| 一次性 `checkpoint-final.test.ts` | 1 pass / 0 fail / 0 skip | 1 | 28.016 秒 |

完整命令数组、退出码、耗时及启动计数分别见 [honest](honest-standin-final.json)、[cancel/resume](cancel-resume-final.json)、[checkpoint](checkpoint-final.json)。两例名称筛选的文件已知不含 live 初始化，使用 Node 原生 `--test-name-pattern`，未执行整个 window 套件。筛选之外是未跑，不是额外通过。

合并原先三个已通过且未被产品修改影响的表单/报告用例，既有 L3 关键路径共 **6 个用例通过**，另有一个脚本 checkpoint 完成。并非这些用例在同一轮全部通过；首次失败和限定复测完整保留。新阶段 4 次启动，加初轮及诊断共 9 次；计数来自现有 Electron spawn observer，不用测试数量代替启动数量。

## 最终 checkpoint 和截图

同一窗口依次完成当前 Pack/Site 静态 fit、真实局部故障与原始 log、修改仅属于该测试的 `fail-remaining`、准确点击 resume、两代试验后 ended-goal-met、保留原 blocker 历史、schema 2 保存报告经原 API 返回 200 / goal-supported。它是 stand-in 的已知算术结果，不是模型研究或真实 EDA 效果。

- [表单与静态 fit](checkpoint-form-fit-final.png)
- [Hard blocker 与原始日志](checkpoint-blocked-log-final.png)
- [结束后的概览（原截图未进入报告区域）](checkpoint-resumed-report-final.png)
- [最终逐步观察](checkpoint-walkthrough-final.json)

截图由现有 driver 的真实窗口 capture 获取；调试端口仅用于读取状态、前次诊断的回复控制和把截图区域滚入视口，没有修改页面内容，也未编辑 PNG。三图均为 2480×1684，hash 在 [final-summary.json](final-summary.json)。最终 resume 的 click note 明确为 `the click landed on "resume"`。

本轮全部进程使用私有 TMPDIR/TMUX_TMPDIR、dsh home、agents 与 Electron user data；清除继承的 TMUX、SSH agent 和模型凭据，加载既有 SSH 哨兵。各阶段 SSH attempts 均为 0；真实模型、Site/EDA 作业为 0。只清理测试自己的目录、窗口、进程和 tmux server。

截图留待 parent 视觉检查。此证据是脚本操作与窗口观察，不是资深工程师的研究价值验收；其他 Desktop 用例、真实依赖和完整 pilot 未跑。实际浏览器缩放后 driver 坐标的局限保留在原诊断记录；本次未扩大范围修改该 driver 行为。


## 视觉复核后的修正

Parent 检查发现上面的结束概览仍有固定表格文本跨列溢出，且旧“report”截图实际是页面顶部。两者已明确记录，不能把旧截图当作报告可读性证据。Root 只为 fixed ledger 的 `.value` / `.verdict-line` 添加 `white-space:normal`，并重新构建/检查类型。

新增一个正常两代窗口验证：1 pass / 0 fail / 0 skip，1 次 Electron 启动，8.824 秒，8 个实际数量/判定文本元素左右越界均 0 CSS px。报告顶部和研究限制区域先滚入视口，等待两次 animation frame，再核对目标坐标并截图；此次确实显示相应报告区域。见 [视觉最终证据](visual-final/README.md)。总实际启动数由 9 增至 10，原始失败与额外验证均保留，没有重跑整个 Desktop 套件。
