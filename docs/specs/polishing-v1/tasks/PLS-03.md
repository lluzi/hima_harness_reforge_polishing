# [PLS-03] 把策略对照与非视觉矩阵放到真实 Host 测试

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-01, POL-02, POL-04
Blocked by: #3

## 目标与开工条件

先使用 PLS-02 的计时结果；首切片限于 honest-standin 方法对照。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `test/contract/honest-standin.test.ts` | 三个 Campaign 的策略/结果断言 |
| `test/contract/strategy.test.ts` | 参数与声明矩阵，保留典型表单例 |
| `test/contract/budget.test.ts` | 状态与计量矩阵，保留窗口计量例 |
| `test/contract/experience.test.ts` | 报告/hash/恢复矩阵，保留阅读入口例 |
| `test/contract/support/boot-inprocess.ts` | 真实 dsh 插件树 |
| `test/contract/support/boot-host.ts` | 真实 HTTP Host |
| `test/contract/support/fabric.ts` | localFabric 与已有记录读取 |

## 修改内容

1. 第一步只把 honest-standin 的三个方法对照移至真实 Host/local Job 路径，保留实际文件、Ledger、Judge、Chooser 和 Fabric。与窗口相关的断言由既有表单用例或一个缩小的 driver 用例承接。
2. 后续仅在计时显示必要或正修改对应行为时迁移 Strategy/Budget/Experience 的重复组合；每次一类行为，逐断言对账。
3. 纯参数、算术或报告投影通过已有生产函数接口做 L1；持久化、执行和 HTTP 必须保留 L2，不为测试暴露私有字段或复制状态机。

## 验收标准

- [ ] 相同三条策略路径的目标达成、收敛及预算耗尽仍被独立期望值推翻；不能用被测 choose() 计算期望。
- [ ] 迁移后完整行为断言继续存在；典型表单、会话、页面渲染和控制交互仍有 L3。
- [ ] 同覆盖范围记录迁移前后运行时间与实际窗口启动次数；只有实测才能声称降低成本。
- [ ] in-process Host 的 process.env 改动不在同进程并行；相互隔离后才考虑进程级有限并行。

## 分级测试

- L0 + L2：首切片迁移前后同一受控输入/断言集。
- L1：只在已有可调用纯函数上添加反例。
- L3：保留的一条正常表单/结果连线验一次；不重跑三种方法全部窗口版本。
- L4/L5：无需，语义不变且外部依赖未变。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不一次性重写整个测试架构，不删掉慢失败，不把假 Host 用作降低成本的手段。

## 回滚

按切片恢复原测试位置和 driver 断言；对账文档保留。
