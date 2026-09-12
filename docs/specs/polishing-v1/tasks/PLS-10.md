# [PLS-10] 在声明位置追加研究节点而保持参考图不变

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-06
Blocked by: [PLS-20 / #23](https://github.com/lluzi/hima_harness_reforge_polishing/issues/23), [PLS-13 / #14](https://github.com/lluzi/hima_harness_reforge_polishing/issues/14), [PLS-19 / #22](https://github.com/lluzi/hima_harness_reforge_polishing/issues/22)

## 目标与开工条件

需要已交接的模型工具与方法文件身份，以及 PLS-19 的 Agent 节点执行协议；首切片限一个声明的探索位置。附加工作由对话执行 Agent 提议和执行，Fabric 接纳结构与约束，不自行接管业务推进。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/packs.ts` | packNode / packGraph / positionOf / 图验证 |
| `packages/harness/src/ledger.ts` | 追加探索提议、接纳与生命周期记录 |
| `packages/harness/src/fabric.ts` | drive 与既有边/节点调度 |
| `packages/harness/src/node-turns.ts` | exploreNode 与工具结果交接 |
| `packages/harness/src/tools.ts` | 通过既有工具系统接收结构化提议 |
| `packages/harness/src/generations.ts` | 实际探索分支与参考图的投影 |

## 修改内容

1. 先用一个最小 Pack 证明预声明 revisit/Loop 不能表达当前需求，再在既有图/记录模块中支持附加节点；新增文件名不等于组件许可，多模块适配要列全。
2. 提议至少带稳定身份、参考方法身份、父节点/代际、输入记录与内容身份、影响节点、预计策略/代码变化、既有 kind 的新增节点/依赖、必需输出、结束条件、返回位置与可选性。
3. Executor 在任何新 Job 启动前验证并记录接纳/拒绝；参考节点和依赖保持不可改，新增图只追加且使用现有 act/judge/explore/wait 语义，合法回边仍受既有规则约束。
4. 重复提议幂等；必需证据不满足不能回到原流程宣称成功；可选支路失败/取消/放弃保留记录并按声明返回。

## 验收标准

- [ ] 合法追加、引用不存在节点、同名节点、删除/改写参考节点、非法环、缺失返回/输出、越权路径、预算不足均有明确接纳/拒绝证据。
- [ ] 接纳前后参考图内容 hash 相同；界面/RunView 能区分参考与实际附加工作。
- [ ] 在接纳记录前后分别中断重启，不丢失已接纳分支、不重复新增或启动。
- [ ] 已有 fork/Loop 不受影响；首切片未支持的嵌套位置必须在接受前明确拒绝，不能悄悄降级。

## 分级测试

- L0/L1：结构与依赖校验，输入期望独立于生产验证器。
- L2：真实 Host/local Jobs 的追加、拒绝、去重、返回与重启矩阵。
- L3：一个实际分支的显示/展开/返回路径；不把所有坏图放到窗口测。
- L4 模型：提议工具 schema/prompt 落地后一次真实工具协作；L5 在完整业务里验证用途。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不新建第二图引擎，不删除参考节点，不把动态提议写回 Pack 的默认方法，不扩展成任意可编程图平台。

## 回滚

特性只对显式声明 Pack 开启；保留附加记录，旧版本不支持时明确拒绝该 Run，不能忽略后继续。
