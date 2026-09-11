# 首次本地基线

日期：2026-09-11。源提交：`b4ac9d9360ad6da68b5fd2824621ba6edab7408b`。本轮导入 159 个文件，验证完成后全部仍与来源 hash 一致，未修改产品源码、测试或依赖锁。导入前的 23 份文件在导入时完整保留，之后更新了本项目工作说明。

完整命令、耗时、输出 hash、覆盖范围及原始日志路径见 [results.json](results.json)。源项目在最终只读复核时仍为上述提交，工作树干净。本地 Git 保留来源对象和冻结引用；当前工作区尚未提交或推送。

## 实际运行

环境为本机 macOS、Node `v24.20.0`、pnpm `11.25.0`。使用新的 `node_modules` 和本工作区独立的 pnpm store。测试通过既有 support 创建临时 dsh home、workspace、Electron user data；本轮另隔离 tmux socket，测试结束后清理自己的临时状态。

| 检查 | 结果 | 墙钟耗时 |
| --- | --- | --- |
| 冻结依赖安装，含 Electron 安装 | 通过 | 73.639 s |
| Node 版本检查 | 通过 | 0.235 s |
| dsh seam 检查 | 通过 | 0.223 s |
| 首次 typecheck，尚无构建产物 | 失败，退出 2 | 3.701 s |
| build | 通过 | 2.153 s |
| 构建后的 typecheck | 通过 | 3.089 s |
| 8 个本地 Host 合同测试文件 | 46 通过，0 失败，0 跳过 | 15.812 s |
| 2 个选定的真实 Electron 用例 | 2 通过，0 失败，0 跳过 | 36.919 s |
| 重复 boot 文件，仍新建隔离 home | 2 通过，0 失败，0 跳过 | 1.905 s |

共 **48 个不同用例通过，另有 2 次重复执行通过**；不把重复运行累计成 50 个不同用例。以上均为单次观测；首次运行不是严格清空系统缓存的冷机实验，也不能由一次重复结果推导稳定 p95。

## 首次失败的原因

[首次 typecheck 输出](typecheck.log) 中，两个 package 的 source typecheck 都完成；失败发生于测试/acceptance 的类型检查，最初错误为无法解析 `@hima/harness`。该包的类型导出指向 `lib/types/index.d.ts`，新安装尚未生成它。原样执行 build 后 [typecheck 通过](typecheck-after-build.log)，没有修改代码来消除错误。

当前处理是明确初始化顺序；开发检查入口的整理列入 [POL-01](../../../polishing-backlog.md)。失败记录保留，不将其改写成首次全绿。

## 这次证明了什么

- 本地 Host 组完整执行 `boot`、`command`、`dc-reader`、`judge`、`observe`、`observe-readers`、`observe-ledger`、`site-name`。验证真实 dsh 启动/会话与退出、报告读取/类型值、判断、记录、读取权限及 Site 身份等已有合同。
- 6 份现有本地真实报告副本均与 fixture manifest 的 hash 一致，测试按原有路径只读使用；未复制 vendor 内容进入仓库。
- 桌面组运行 `window.test.ts` 中的表单输入、点击启动、三代结束与页面/Run 对照；完整运行 `honest-standin.test.ts`，对照默认 chooser 预算耗尽、另一 chooser 收敛及目标可达三种 Campaign。使用真实 Electron、真实 Host 和本地 stand-in。
- 默认 `timing-push` 在该 stand-in 下继续放宽 period 的已知行为在本地独立复现；测试通过表示反例被正确识别，不表示默认 Pack 的研究策略已经令人满意。

## 仍未证明的范围

29 个 contract 文件中，9 个完整执行，1 个仅执行选定用例，19 个未执行；未选中的 `window` 用例不算 PASS，也不计作框架报告的 skip。各文件的去向在 `results.json` 中。

本轮没有全量回归、恢复/取消矩阵的完整对账、真实模型调用或远程 Site/EDA 作业。不存在 source unit test 文件，因此没有 unit coverage 成功声明。没有进行人工或视觉的完整体验验收，两个 driver 用例的成功不等于 UI 品质已达标。

模型调用与远程 EDA 作业为 0。Host/进程启动总数尚未作运行时计数；不能从测试数量推导。P0 仍需测试入口落地、剩余本地覆盖对账和最小完整体验走查，下一步按 POL-01 开展。
