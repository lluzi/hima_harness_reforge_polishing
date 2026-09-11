# [PLS-02] 提供构建一次且按成本选择的验证命令

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-01
Blocked by: #2

## 目标与开工条件

PLS-01 完成后实施。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `package.json` | build / typecheck / test:contract / 新增薄验证 scripts |
| `scripts/run-unit-tests.mjs` | 无用例与通过的区分 |
| `scripts/require-node.mjs` | Node 版本前置检查 |
| `.githooks/pre-commit` | 开发静态检查入口 |
| `.githooks/pre-push` | 取消重复构建及隐式昂贵依赖 |
| `README.md` | 首次准备与日常命令 |

## 修改内容

1. 沿用 Node test runner，提供清楚的 check:local、test:local、test:desktop、test:live:site 入口；未来模型/完整 pilot 入口在对应实现落地时接入，缺失能力不能用空命令假通过。
2. check:local 执行版本/seam 检查、一次新构建、类型检查及本地组；各测试叶命令不再内嵌重复 build，并说明其构建前置条件。暂不新增自动缓存判定系统。
3. 首次没有 lib 时 check:local 可成功准备；pre-push 调用一次完整的本地检查。窗口或真实依赖检查由任务的影响与分级要求触发并留下证据，hook 的通过不等于已完成所有层级。
4. 默认本地入口不启动 Electron、模型或 SSH；无用例输出明确，显式选择的文件集合为空/丢失时拒绝宣称通过。

## 验收标准

- [ ] 在一次无构建产物的干净副本中 install → check:local 可通过；保留首轮安装与构建耗时。
- [ ] 同轮跨组执行的 build 次数可核对为一次；源码变化后使用新构建，不能用旧 lib 声明通过。
- [ ] 缺失显式要求的 Electron、报告 fixture 或真实依赖能明确失败/跳过；输出包含通过、失败、跳过、未跑和命令退出码。
- [ ] 相关 L0–L2 子集目标 3 分钟、关键 L3 子集目标 5 分钟；这是初始反馈目标，超标须定位成本，不能删覆盖达标。

## 分级测试

- L0：全新副本的初始化顺序和脚本出口验证。
- L2：按新入口执行原有本地集合，保留每组时间和覆盖对账。
- L3：检查一次新 desktop 命令确实运行既有关键 driver 用例；后续纯入口文字修改无需反复开窗口。
- L4/L5：不运行，只验证显式入口不会被默认组间接选择。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不增加通用测试服务，不改模型或 EDA 环境，不把所有变更都绑定全量 desktop。

## 回滚

还原 scripts/hooks/README 及分组配置，产物不作为源码提交。
