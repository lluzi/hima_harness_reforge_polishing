# [PLS-08] 接收 Step 4 完整快照并核对模型、Pack 与作者流程

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-05, POL-07, POL-09
Blocked by: #3

## 目标与开工条件

外部前置：prototype 提供包含所需能力的明确已提交快照；未到来时保持依赖未满足，不拼接进行中的工作树。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/index.ts` | 当前服务/工具/视图的注册，接上游真实实现 |
| `packages/harness/src/tools.ts` | 现有模型可调用生产工具入口 |
| `packages/harness/src/packs.ts` | Pack 工具/知识/语义及 release 相关契约 |
| `packages/harness/src/node-turns.ts` | 现有 act/explore 执行入口 |
| `profiles/hima/cordis.patch.yml` | profile 能力与隐私配置 |
| `package.json` | 依赖和测试入口 |
| `pnpm-lock.yaml` | 导入快照锁定依赖 |
| `docs/assessment/2026-09-11/source-import.json` | 基线来源与逐文件 diff 的起点 |

## 修改内容

1. 以只读导出接收整个可验证快照，记录源 SHA、依赖锁、本地修改和重叠修复归属；保持 polishing 文档权威。
2. 清点模型会话、Workshop、Pack 自带工具/reader/rule/知识、作者流程及正式 DTCO Pack 的实际完成度。缺少哪个环节就记录缺口，不能用临近功能替代。
3. 把上游实际新增文件/接口写入本任务的交接表，并刷新后续任务模块映射；当前基线没有这些实现，因此不预造 model-moment 文件名。
4. 核对正式 Pack 的 Goal、运行图与 release 文件身份能否由现有表单和执行入口表达；若有通用缺口，给出最小反例及本模块内修正，不迁入旧架构。

## 验收标准

- [ ] 导入 diff 可重建，产品代码与源只读目录无共享可写依赖/运行状态。
- [ ] 相关既有本地集合及新增 replay 合同在 polishing 独立通过；机制样本注明手写或真实录制。
- [ ] 模型可参与会话不被写成已完成 AI 研究；未完成作者/Pack 能力明确未验证并阻断依赖它的任务。
- [ ] 提供后续任务可使用的能力清单、模块/符号、生产入口、版本与测试证据；冲突修复有根因和归属。
- [ ] 正式 Pack 至少交接一条可独立运行的挖掘/分析路线、输入输出语义、一份有界小样本及独立校验方法，作为 PLS-09 的真实模型任务；缺失时不得将交接标为完整。

## 分级测试

- L0–L2：受影响依赖、Pack 与模型工具/replay 机制。
- L3：启动/会话/聊天到工作台等受影响连线的有限 smoke，不全套最高层。
- L4 模型：仅当导入改变模型接口/工具协议时做有预算的小依赖检查；研究价值由 PLS-09。
- L4 Site/L5：按真正改变的语义决定，不因每次快照自动跑完整研究。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不修改 prototype，不主动引入第二模型驱动器，不因工作树存在就认定上游已完成。

## 回滚

保持前一快照与本地补丁清单；回退代码前先核对 Ledger/Pack 存储版本兼容，保留已生成资产。
