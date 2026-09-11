# PLS-03：方法矩阵移到真实 Host

起点 `a9228de`，PLS-02 的干净副本/新入口已通过并解除依赖。对应 Issue #4。仅迁移 honest-standin 三 Campaign 对照和保留窗口连线，没有改变产品语义或大批重写其他矩阵。

`honest-standin.test.ts` 现在用既有 localHome + bootHimaHost/openSession，通过真实 HTTP 启动 Run，保留同一 stand-in（achievable 2.2 ns、每代 sleep 1 秒）、Ledger、Judge、Chooser、Fabric、本地 tmux 和实际报告。起始 2.3 ns；旧 timing-push 六代预算结束、over-constraining 五代收敛未达 2.0 ns，以及两代达成 2.25 ns 的独立期望全部保留。

`honest-standin-window.test.ts` 保留真实窗口的状态/决定/协议断言，并从实际表单启动同一不可达目标下的收敛 Run；仍有真实会话和表单到结果的连线。所有原 25 条断言表达式都可在新 L2/L3 文件中找到；当前 27 条，多出表单点击和 Run 身份检查。主代理与独立 subagent 分别用 TS AST 对照确认，见 [逐断言映射](assertion-mapping.json)。分组和 README 示例已更新；其他 Strategy/Budget/Experience 矩阵本任务没有整体迁移。

| 观察 | 结果 | 秒数 | Electron main 启动 |
| --- | --- | --- | --- |
| PLS-02 冻结副本原完整 driver 用例 | 1 pass / 0 fail / 0 skip | 23.504 | 1 |
| 同一旧文件尝试进入 local | 预期拒绝，退出 1，未导入 | 0.324 | 0 |
| 迁移后 L2 三方法矩阵 | 1 pass / 0 fail / 0 skip | 21.352 | 0 |
| 保留 L3 表单到收敛结果 | 1 pass / 0 fail / 0 skip | 10.995 | 1 |

日常方法回归现在可以只用 L2、无需 Electron；完整 checkpoint 的本次合计 **32.347 秒**，高于原例 23.504 秒，所以不宣称整体提速。两次计时只是当前机器、并行任务背景下的单次样本，不是稳定分位数。保留的窗口路径更强（从表单开始），也多执行一个 Campaign，不拿它与旧三个 Campaign 的总时间做同工作量提速结论。

L0 类型检查及文件清单通过；新构建 1.817 秒，后续两个叶组复用该产物。SSH 尝试 0、真实模型/远程 Site/EDA 0。实际窗口主进程数由只读子进程观察器记录在各 `*-boots.jsonl` 中。迁移前的原日志见 [PLS-02](../pls-02/desktop-before-migration.log)；迁移后的命令、退出码、时间和 TAP 在本目录对应 JSON/log 中。

独立切片审查的 Standards / Spec 均无 findings；没有删断言、复制状态机或引入假的 Host。最终批次还会在合并后的版本上跑完整本地组及必要窗口路径，不能把此处单例结果称为最终集成通过。

回滚本次测试迁移、分组及命令示例即可；产品 Pack/Judge/Fabric 未变化，历史对账保留。
