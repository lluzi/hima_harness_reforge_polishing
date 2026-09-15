# HimaHarness Product Upgrade v2

状态：规格与子任务已发布为 [GitHub #30](https://github.com/lluzi/hima_harness_reforge_polishing/issues/30) 及 #31～#39。产品与架构依据见[升级访谈](../../product-upgrade-interview.md)、[产品定义](../../product-definition.md)和 ADR-0008～0011。

本轮是现有 HimaHarness 的增量升级。固定基线为 `2a1a311519757a4fb6eb5ab46858e2e669ae0df2`；两个参考仓库保持只读。

## 任务表

| 任务 | 内容 | 硬依赖 | 并行所有权 |
| --- | --- | --- | --- |
| [PLS-27 / #31](https://github.com/lluzi/hima_harness_reforge_polishing/issues/31) | HimaGuide 产品上下文与零源码扫描自我认知 | 无 | Host context |
| [PLS-28 / #32](https://github.com/lluzi/hima_harness_reforge_polishing/issues/32) | 加深现有 Pack 格式、安装、ontology、状态和最低 Harness 版本 | 无 | Pack core |
| [PLS-29 / #33](https://github.com/lluzi/hima_harness_reforge_polishing/issues/33) | 从 SSH 发现并保存 safe Site profile | 无 | Site/Channel |
| [PLS-30 / #34](https://github.com/lluzi/hima_harness_reforge_polishing/issues/34) | 在现有知识记录上提供离线 Pack/当前知识 | 无；产品接入前先过本任务 POC 门 | Knowledge core |
| [PLS-31 / #35](https://github.com/lluzi/hima_harness_reforge_polishing/issues/35) | 将现有检查加深为 Campaign Preparation 与一次确认 | PLS-28、29、30 的稳定读取接口 | Shared Host + intake UI |
| [PLS-32 / #36](https://github.com/lluzi/hima_harness_reforge_polishing/issues/36) | 复用 DSH 多会话完成 Campaign Agent、Side Talk 和可靠控制通知 | PLS-27、31；可提前做无共享文件测试 | Execution/control |
| [PLS-33 / #37](https://github.com/lluzi/hima_harness_reforge_polishing/issues/37) | 在现有 Workbench 投影完整运行图和业务信息层级 | PLS-31、32 | Client UI |
| [PLS-34 / #38](https://github.com/lluzi/hima_harness_reforge_polishing/issues/38) | 用现有 Pack 格式交付可迁移的定制 Cell Fmax-DTCO 方法 | PLS-28 格式封板；内容可提前并行 | Pack method |
| [PLS-35 / #39](https://github.com/lluzi/hima_harness_reforge_polishing/issues/39) | 用 aes_cipher_top 目标 reg2reg path 完成 Matched Comparison 并发布候选 | PLS-27～34 | Pilot/release |

## 并行波次

1. 第一波并行：PLS-27、PLS-28、PLS-29、PLS-30；PLS-34 可同步处理不依赖新 metadata 的方法内容。
2. 第二波：共享接线所有者顺序集成 PLS-31、PLS-32；PLS-32 的 Host 状态矩阵可提前准备，PLS-34 完成格式与知识接入。
3. 第三波：PLS-33 由唯一 Client UI 所有者完成，避免与 PLS-31 同改 `HimaWorkbench.tsx`。
4. 第四波：PLS-35 集中使用一次必要的 L4/L5 真实资源，不把昂贵验证分散到前置任务。

共享接线文件 `packages/harness/src/index.ts`、`remote.ts`、`paths.ts`、`tools.ts` 和 `client/api.ts` 由主集成者单独拥有。并行 worker 不直接合并这些文件。

完整规格见 [spec.md](spec.md)，机器可读依赖见 [dependencies.json](dependencies.json)。

PLS-35 在真实负结果后进入方法论升级。新的正向设计见
[Library Function Richness Optimization Framework](library-function-richness-optimization-framework.md)：
定制 Library 单调增长，Yosys/ABC 承担无许可证内层优化，商业 LC/DC/APR 仅作为代理收敛后
的最终验证。
