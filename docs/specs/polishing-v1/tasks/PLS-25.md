# [PLS-25] 在同一 Agent 执行方式下完成 AES 定制 Cell 挖掘全链路

Part of [#1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [本轮规格](../../step4-takeover/spec.md)

GitHub: [PLS-25 / #28](https://github.com/lluzi/hima_harness_reforge_polishing/issues/28)

Blocked by: [PLS-09 / #10](https://github.com/lluzi/hima_harness_reforge_polishing/issues/10), [PLS-24 / #27](https://github.com/lluzi/hima_harness_reforge_polishing/issues/27), [PLS-22 / #25](https://github.com/lluzi/hima_harness_reforge_polishing/issues/25)

承接来源：[上游 #67](https://github.com/lluzi/hima_harness_reforge_claude/issues/67)。原项目任务只读，完成状态由本仓库独立验证。

Triage: `ready-for-agent`。标签不解除依赖与真实资源前置；真人验收不能由 agent 代做。

## 目标与开工条件

依赖完成后实施；真实模型和 Site 作业另须具备明确输入、凭据与预算。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改内容与目标 |
| --- | --- |
| `packs/aes-tsmc28-dtco/` | 计划新增的正式 Pack 目录由 PLS-23 创建，本任务形成新版本：六条挖掘路线、library gate、双臂与验证 |
| `packages/harness/src/node-turns.ts` | 仅修复 Pack 无法表达的最小通用缺口 |
| `packages/harness/src/forks.ts` | 既有 fork/join 依赖和资源上限由 Agent 请求驱动 |
| `packages/harness/src/readers.ts` | Pack 自带 reader 优先；领域格式放 Pack |
| `packages/desktop/src/local-site.ts` | 现有九阶段 stand-in 与实际格式校准 |
| `test/contract/standin-stages.test.ts` | 保留前置缺失、zero adoption、失败与残留文件反例 |
| `scripts/acceptance-step3.ts` | 复用审计和阶段证据结构，完整候选验收由 PLS-18 |

## 修改内容

1. 在新 Pack 版本中承接六条路线、候选合并、bool2cmos/celluzi、表征、Library Compiler gate、定制库综合、采用关系、双臂 P&R 与验证的输入输出；这些专有业务均留在 Pack。
2. 挖掘节点由同一对话 Agent 根据输入、Pack 知识和反馈编写/修订算法，实际执行产物经 reader 与 Judge 校验；不以 area/1000 等机制样例当作真实候选挖掘。
3. fork/join 沿现有图和 Site cap 接纳，各分支在同一总预算内；没有下一 Agent 请求不能自动开下一业务节点。
4. library gate 失败阻止使用被拒绝的库；zero adoption 保留库进入会话与实例到 master 关系两方面证据，区分未使用与未看见。
5. 本地验证整个方法，然后按必要工具做有限真实 bring-up 并发布新版本；完整研究与双臂结果主张统一交给 PLS-18，不重复跑两套 L5。

## 验收标准

- [ ] 六路线的候选有来源、算法版本、合并依据和独立样本校验；代码变化与实际采用的代码身份相符。
- [ ] 库通过/失败、采用/零采用、验证失败、前置缺失等路径由真实记录支持；必需证据不存在不能宣称结果成立。
- [ ] 合法工具输入和真实生成文件能够贯穿全链路；无替身性能数字被写成真实 AES 收益。
- [ ] 正式 Pack 已提供 PLS-18 所需双臂测量、收敛和 ending 契约，以及审计/继续/报告入口。

## 分级测试

- L0/L2：九阶段方法全链路、有限策略/故障矩阵、真实文件与 Ledger。
- L4 模型：已有研究贡献证据扩展到实际挖掘输入与反馈；新增 prompt/工具做小验证。
- L4 Site：按 report/wrapper/Library Compiler 等实际变更做最小作业，昂贵 DC/Innovus 遵循 Site cap。
- L3：同屏研究节点与证据入口；L5 集中 PLS-18。

## 交付证据

记录实际 commit、构建/Pack/输入/环境身份、命令及退出码、通过/失败/跳过/未跑、耗时、Host/窗口启动数、模型调用与 Site 作业数、材料 hash 和原断言去向。每个本地提交立即推送并核对远端 SHA。

## 不在范围内

不改只读源项目，不新增第二图/模型/知识/测试服务，不将 stand-in、replay 或上游历史记录称为本版本真实研究通过。纯重构只有本切片的有效反例或交付要求需要时才做。

## 回滚

恢复已发布 probe 版本，保留矿工代码、所有工作目录和已运行 Job；不能删除失败候选或覆盖前一方法。
