# [PLS-18] 完成真实 DTCO 研究 pilot 与第二次知识复用

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-09
Blocked by: [PLS-03 / #4](https://github.com/lluzi/hima_harness_reforge_polishing/issues/4), [PLS-04 / #5](https://github.com/lluzi/hima_harness_reforge_polishing/issues/5), [PLS-05 / #6](https://github.com/lluzi/hima_harness_reforge_polishing/issues/6), [PLS-06 / #7](https://github.com/lluzi/hima_harness_reforge_polishing/issues/7), [PLS-12 / #13](https://github.com/lluzi/hima_harness_reforge_polishing/issues/13), [PLS-15 / #16](https://github.com/lluzi/hima_harness_reforge_polishing/issues/16), [PLS-16 / #17](https://github.com/lluzi/hima_harness_reforge_polishing/issues/17), [PLS-17 / #18](https://github.com/lluzi/hima_harness_reforge_polishing/issues/18), [PLS-25 / #28](https://github.com/lluzi/hima_harness_reforge_polishing/issues/28)

## 目标与开工条件

所依赖能力已通过对应低层验证；指定 Site、正式 Pack、输入、模型凭据和 Campaign 预算已具备，现场条件缺口必须先解决。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packs/` | PLS-23/25 在 polishing 编写并验证的正式定制 Cell/Fmax Pack |
| `sites/` | 指定 pilot Site 绑定与 Permit；仅在确有配置差异时修改 |
| `scripts/acceptance-step3.ts` | 复用其证据清单/审计/重启结构，新增本地 pilot 验证脚本而非第二运行系统 |
| `packages/desktop/src/main.ts` | 仅处理实际 pilot 暴露的部署/操作缺陷 |
| `docs/specs/polishing-v1/` | 规格与任务验收对账 |

## 修改内容

1. 先验证真实模型小任务与一个必要的真实工具作业，再执行完整 Campaign；不在 UI 小改后重复整个 EDA 研究。
2. 使用匹配的设计、约束、工具/库和测量条件，对照基础路线与定制 Cell 路线；完整记录算法、采用/拒绝、回溯、附加研究与局限。
3. 在首次 Site 准备后由工程师通过桌面/对话提供输入、启动、查看和干预，不要求每日编译源码或手改内部 YAML。
4. 交付技术报告和 Pack 内资产，再发起一项引用该资产的有界后续研究；由用户/指定资深工程师判断研究价值。

## 验收标准

- [ ] 真实 V4 Flash 在至少一个关键研究环节提供可核对的算法/策略改变，并完成执行与反馈；不是纯固定脚本演示。
- [ ] 发生或安排的一次回溯/附加探索有明确影响范围，参考图不变，历史保留，受影响下游按有效性重新运行。
- [ ] 所有停止原因与资源消耗可对账；无提升时交付证据支持的负结果或未决问题，不承诺固定提升百分比。
- [ ] 必要报告、算法、数据、环境与 supporting material 可交付且 hash 正确；第二次研究实际引用来源可见。
- [ ] 独立产品测试清单逐项标注通过/失败/未验证；使用验收意见和剩余风险留档。未完成的客户使用验收不能由 agent 自行认定通过。

## 分级测试

- L0–L3：候选快照上受影响范围与必要的窗口 checkpoint；复用明确适用的历史证据并标版本，不伪装成重跑。
- L4 模型与 Site：分开最小检查，记录预算和真实投入；发现问题回到最低可复现层。
- L5：完整研究及第二次引用，真实用户操作与报告审阅。本任务是昂贵测试的集中入口。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不扩展多操作系统安装/商业签名/任意 Site，不追求未经授权的无限探索，不迁移旧产品架构。

## 回滚

保留全部 Site workspace、方法版本与资产；代码修复按根因独立切片；终止 pilot 只停止本次拥有的作业。

## 承接 Step 4 完整 Campaign 的统一验收

本任务同时承接上游 lluzi/hima_harness_reforge_claude#68，不再另跑一份旧自动 drive 的 Step 4 全量验收。PLS-25 的正式方法在本任务形成候选发布：foundry 与定制库双臂的设计、工具/版本、约束、输入、测量定义及验证条件必须匹配；从真实报告计算效果，保留 asked、measured、inferred 的区别。

- [ ] 同一对话 Agent 实际组织算法、作业和反馈；记录本次采用的脚本/方法/环境身份，不能用独立默认 moment 代替主执行者。
- [ ] 双臂 probe、Library Compiler gate、采用关系、验证与 liveness、策略反馈和停止依据可查；无效或残缺支路不能支持收益数字。
- [ ] 指标未提升但证据充分可形成有效负结果；预算截断只能给出覆盖范围内的结论，不能因此声称完整探索验收已通过。
- [ ] 保存同屏启动/介入、重启回读、Job 审计、报告/资产和第二次有界知识引用；已有昂贵运行结果可以在身份和适用性一致时复用，不机械重复完整 Campaign。

PLS-26 专门保留非开发者真人使用验收。PLS-18 的技术 pilot 完成不代表真人验收已通过；若真人尚未安排，最终产品使用门槛继续未满足。
