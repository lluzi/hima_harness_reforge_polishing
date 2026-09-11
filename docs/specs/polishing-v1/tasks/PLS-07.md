# [PLS-07] 报告区分执行结束与研究结论并约束证据范围

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-04
Blocked by: #3

## 目标与开工条件

可在当前基线实施，AI 研究段落留待 PLS-15。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/experience-report.ts` | ExperienceJson / experienceReport / endingReason / reasoningOf |
| `packages/harness/src/experience.ts` | writeExperience / readExperience / owesAnExperience |
| `packages/harness/src/generations.ts` | generationsOf 对历史与有效结果的投影 |
| `packages/harness/src/remote.ts` | RunView/ExperienceView |
| `packages/harness/src/card-labels.ts` | 共享结果措辞与证据入口 |

## 修改内容

1. 保留 Run.status 原义，在报告里分别呈现测量结论、覆盖限制、结束原因及缺失证据；converged 不自动等于 Goal 达成或策略普遍无效。
2. 列出本次已执行策略、满足约束的观测、未执行的下一策略以及造成结论受限的故障；不把 requested period 当作 measured Fmax。
3. 对缺少环境信息、没有完整试验或无法定位因果，明确未记录/未知；确定性报告不能伪造 AI 深入分析。
4. 扩展报告数据格式时记录 schema 兼容策略；历史 Markdown/JSON 与 hash 不因新 renderer 被重写。

## 验收标准

- [ ] 目标达成、收敛未达标、预算截断、有效负结果、执行故障、取消及无 workspace 各有明确输出或无法交付原因。
- [ ] 未完成/失效/失败尝试的残缺报告不能成为有效结果；尚未执行的 next strategy 明确未测。
- [ ] 报告和 RunView 引用同一批事实，所有改进数字能够追到输入观测与比较条件。
- [ ] 文件遭修改、丢失或写入中断仍明确失败，不能把现场重算的视图称为已持久化文件。

## 分级测试

- L0：相关 source/schema 类型检查与一次构建，保证测试使用当前产物。
- L1：公开报告投影接口的小型独立期望与状态反例。
- L2：真实 Host/文件验证 hash、缺失/中断、重复读取、重启补写及兼容读取。
- L3：一次报告打开与关键结论渲染，纯内容矩阵无需重复窗口。
- L4/L5：研究因果与质量不在此层认证。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不凭模板生成因果解释，不新增研究结论数据库，不重写历史报告。

## 回滚

新增字段采用兼容读取；恢复报告投影代码，不删除新旧运行证据。
