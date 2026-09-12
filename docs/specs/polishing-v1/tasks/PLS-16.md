# [PLS-16] 下一次研究主动引用相关且获准的历史资产

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-08
Blocked by: [PLS-09 / #10](https://github.com/lluzi/hima_harness_reforge_polishing/issues/10), [PLS-14 / #15](https://github.com/lluzi/hima_harness_reforge_polishing/issues/15), [PLS-15 / #16](https://github.com/lluzi/hima_harness_reforge_polishing/issues/16)

## 目标与开工条件

至少有两份身份完整的历史资产；当前模型/Pack 输入入口已交接。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/packs.ts` | Pack 资产枚举和适用范围读取 |
| `packages/harness/src/experience.ts` | 经过 hash 验证的材料读取 |
| `packages/harness/src/node-turns.ts` | 研究节点输入准备 |
| `packages/harness/src/tools.ts` | 既有模型读取材料的范围 |
| `packages/harness/src/ledger.ts` | 实际引用的资产/材料身份 |
| `packs/` | 正式 Pack 的知识选择与使用说明 |

## 修改内容

1. 在已有 Pack 读取范围内按问题、设计、工具环境与方法身份筛选有限历史资产；无需向量库或独立索引。
2. 给模型的是有 provenance、适用条件、证据强度和失效/未知标记的材料；记录实际引用内容及身份，不只记录候选列表。
3. 历史失败用于提出假设、排除已验证的窄路径或设计下一实验；新的设计结论必须有当前运行证据。
4. 客户/Pack/Site 授权范围内读取；材料不完整、hash 不符、上下文不适用时明确拒绝或降为受限背景。

## 验收标准

- [ ] 同名不同设计、不同工具版本、失效材料、未经允许的其他客户资产和被篡改文件不会当作当前可靠结论输入。
- [ ] 新研究使用一份相关负结果时，用户能看到出处及选择下一实验的原因；不存在相关知识时可正常从 Pack 方法起步。
- [ ] 在历史内容中出现要求扩大权限/改 Goal 的文字，不改变模型工具权限或参考方法。
- [ ] 声称复用提升质量/成本前，做固定任务、预算和独立评判下的有限有/无资产对照；未测则只声称功能可用。

## 分级测试

- L0/L1：候选筛选与适用条件；L2：真实文件授权/hash、实际注入与引用记录。
- L3：一次引用来源可见的入口。
- L4 模型：一项历史资产支持的新研究，必要的有/无对照；不要求每个筛选反例都调用模型。
- L5：完整 DTCO 的下一次引用与研究价值。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不新增知识搜索服务，不将历史结论冒充本次结果，不自动跨客户共享。

## 回滚

禁用历史注入后回到 Pack 原有方法输入；历史资产及引用记录保留。
