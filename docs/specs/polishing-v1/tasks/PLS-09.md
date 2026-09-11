# [PLS-09] 证明 AI 在研究节点生成并验证有意义的算法

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-05
Blocked by: #9, #22

## 目标与开工条件

PLS-08 已交接模型/Workshop 能力，PLS-19 已建立对话 Agent 的节点执行接口；DeepSeek V4 Flash 凭据和小任务预算由运行环境提供。研究由同一个对话执行 Agent 发起并完成节点内工作，遵循 ADR-0006。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/node-turns.ts` | 对话 Agent 调用的研究工具执行与结果交接 |
| `packages/harness/src/tools.ts` | 实际研究/代码工具调用入口 |
| `packages/harness/src/ledger.ts` | 导入后的模型/代码记录及事实关联 |
| `packages/harness/src/experience-report.ts` | 研究贡献的可追溯信息 |
| `packs/` | PLS-08 交接的正式 Pack 方法、知识和 Workshop 声明；先明确具体目录 |

## 修改内容

1. 使用 PLS-08 交接的正式 Pack 中一条挖掘/分析路线及有界网表或路径样本，给模型输入/输出契约和预算；让模型写候选生成或分析算法、在本地执行，并使用检查结果继续判断。候选必须能追到样本中的实际对象，结果由独立校验方法检查。
2. 至少覆盖一个初始策略被证据否定后修改算法/代码的路径；模型贡献不能只是选择固定 profile 或转述固定脚本输出。
3. 模型会话、引用输入、代码内容/hash、工具执行和输出观测关联到相应节点/尝试；模型不能直接写 Judge verdict、改 Goal 或绕过工具范围。
4. 核对控制所有者与实际调用链：不能由 Fabric 自主推进后仅在内部调用一个隐藏的研究 Agent，来替代对话 Agent 的执行。已有 Workshop 能力应通过 PLS-19 的上下文/工具协议复用。

## 验收标准

- [ ] replay 覆盖合法产物、格式错误、越界文件、工具失败、中断/取消；拒绝不产生可用于判断的伪证据。
- [ ] 一项真实 DeepSeek V4 Flash 小研究产生可执行算法，测试使用独立 oracle 或已知 holdout 检查结果，而非匹配模型措辞。
- [ ] 失败时保留代码、错误及已尝试路径，不让没有执行过的脚本支撑技术结论。
- [ ] 记录模型配置、预算和实际调用/运行次数；本小任务的成功不宣称完整 DTCO 闭环或相对模型优势。

## 分级测试

- L0/L2：生产模型入口加 replay 与本地实际进程，覆盖机制与边界。
- L3：有新的模型/代码状态显示时验证一次入口/展开/追溯。
- L4 模型：本任务必须有小而真实的 V4 Flash 研究；没有凭据或预算时记录阻塞。
- L4 Site/L5：此任务可以本地独立算法数据集完成，真实 EDA 留正式 Pack 验证。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不新增通用 planner 服务，不把模型自由文本当 verdict，不以更强闭源模型代替指定基线。

## 回滚

恢复 Pack prompt/知识/工具声明和局部实现；已有代码记录、输入与输出保留。
