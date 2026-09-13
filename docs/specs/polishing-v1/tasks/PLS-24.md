# [PLS-24] 在统一工作区展示代码版本、知识引用和 Pack 结束依据

Part of [#1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [本轮规格](../../step4-takeover/spec.md)

GitHub: [PLS-24 / #27](https://github.com/lluzi/hima_harness_reforge_polishing/issues/27)

Blocked by: [PLS-19 / #22](https://github.com/lluzi/hima_harness_reforge_polishing/issues/22)

承接来源：[上游 #66](https://github.com/lluzi/hima_harness_reforge_claude/issues/66)。原项目任务只读，完成状态由本仓库独立验证。

Triage: `ready-for-agent`。标签不解除依赖与真实资源前置；真人验收不能由 agent 代做。

## 目标与开工条件

依赖完成后实施；真实模型和 Site 作业另须具备明确输入、凭据与预算。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改内容与目标 |
| --- | --- |
| `packages/harness/src/client/HimaWorkbench.tsx` | 在现有证据/报告区域展示 code 与 knowledge，不新增独立工作台 |
| `packages/harness/src/client/HimaRunCard.tsx` | 会话卡片与右侧面板共享事实投影 |
| `packages/harness/src/client/api.ts` | 沿用验证过的代码/报告读取入口 |
| `packages/harness/src/remote.ts` | 代码读取、内容身份和可行动拒绝 |
| `packages/harness/src/card-labels.ts` | Pack 声明 ending 与执行/研究结论分层 |
| `packages/harness/src/experience-report.ts` | 代码和知识材料章节，保留 PLS-07 |
| `packages/harness/src/experience.ts` | 已保存报告读取和 schema 兼容 |
| `packages/harness/src/generations.ts` | 记录所属节点/代际/尝试及历史版本 |

## 修改内容

1. 承接上游 #66 到 UI-02 的既有同屏面板；每条代码记录含 node/generation/attempt/来源与 hash，选择后在现有代码区域阅读。
2. 按记录 hash 读取，路径当前内容变化时明确拒绝冒充旧版本；有归档/保存版本时使用其核验内容，否则如实显示历史内容不可取得。
3. 知识引用列出文件/版本/用途和实际引用来源；只有声明但没有读取/引用证据的知识不能显示成 AI 已使用。
4. Pack 的 ending words、Judge verdict、执行终态、研究结果分别表达。报告 schema 基于当前 hima-experience/2 协调演进，不能复用同一版本号表达不兼容字段。
5. 为 PLS-15 提供可信材料投影；研究解释的真实性与分析价值继续由 PLS-09/15 验证。

## 验收标准

- [x] 至少两个代码版本和一个真实知识引用从聊天、面板与报告可定位到同一记录。
- [x] 篡改、缺文件、无权限、未知版本、取消/失败节点均有真实结果；不能展示别的 Run 的文件。
- [x] 旧报告可读，已保存报告字节/hash 不因新投影改变；报告草稿与已保存报告区别清楚。
- [x] light/dark 同屏、草稿保留、A→B→A 切换与过时响应保护继续成立；不导航离开当前对话。

## 分级测试

- L0/L1：schema/结果投影。
- L2：真实文件/hash、记录范围、引用缺失、旧报告与同一资源身份矩阵。
- L3：少量真实同屏代码/报告打开、篡改拒绝、切换场景。
- L4 模型非单纯投影必需；真实研究解释在 PLS-15 验证。

## 交付证据

记录实际 commit、构建/Pack/输入/环境身份、命令及退出码、通过/失败/跳过/未跑、耗时、Host/窗口启动数、模型调用与 Site 作业数、材料 hash 和原断言去向。每个本地提交立即推送并核对远端 SHA。

## 不在范围内

不改只读源项目，不新增第二图/模型/知识/测试服务，不将 stand-in、replay 或上游历史记录称为本版本真实研究通过。纯重构只有本切片的有效反例或交付要求需要时才做。

## 回滚

回退视图/新字段消费者，保留记录与报告原文件；不降级写入既有新 schema 报告。

## 实施验收

已完成。实际版本、原始失败、分级验证及边界见 [本轮交付](../../../validation/pls-frontier/probe-handoff.md)。不据此声明 PLS-09、PLS-25 或完整 L5 完成。
