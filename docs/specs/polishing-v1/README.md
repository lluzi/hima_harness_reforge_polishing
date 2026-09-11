# Polishing v1 规格与任务索引

首轮发布：父规格与 18 个任务已发布 GitHub，正文、标签、18 条父子关系与 33 条阻塞依赖均已核验。源快照：`b4ac9d9360ad6da68b5fd2824621ba6edab7408b`。后续新增事项见下文。

[GitHub 父规格 #1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [完整本地规格](spec.md)包含 50 条用户故事、模块修改目标与 L0–L5 标准。任务正文逐项给出代码、修改内容、验收、测试和回滚；这些文档是本次发布副本，实时状态以发布后的 GitHub Issue 为准。

最新执行职责见 [ADR-0006](../../adr/0006-conversational-agent-owns-business-execution.md)：由同一个对话 Agent 执行节点，Fabric 提供运行约束与事实。[执行补充规格](node-intervention.md)与 [PLS-19](tasks/PLS-19.md)（[GitHub #22](https://github.com/lluzi/hima_harness_reforge_polishing/issues/22)）已据此改写。下表更新为当前任务衔接；publication/remote-verification 文件仍是首轮发布快照。方向已接受，具体协议与迁移待细化，当前不计为已实现能力。

## 任务与依赖

| 任务 | GitHub | 原工作单 | 依赖 | 开工范围 |
| --- | --- | --- | --- | --- |
| [PLS-01：本地测试不加载真实 Site 用例](tasks/PLS-01.md) | [#2](https://github.com/lluzi/hima_harness_reforge_polishing/issues/2) | POL-01 | 无 | 当前基线 |
| [PLS-02：提供构建一次且按成本选择的验证命令](tasks/PLS-02.md) | [#3](https://github.com/lluzi/hima_harness_reforge_polishing/issues/3) | POL-01 | PLS-01 | 当前基线 |
| [PLS-03：把策略对照与非视觉矩阵放到真实 Host 测试](tasks/PLS-03.md) | [#4](https://github.com/lluzi/hima_harness_reforge_polishing/issues/4) | POL-01, POL-02, POL-04 | PLS-02 | 当前基线 |
| [PLS-04：让默认本地 Pack 使用有依据的 Fmax 探索方法](tasks/PLS-04.md) | [#5](https://github.com/lluzi/hima_harness_reforge_polishing/issues/5) | POL-02 | PLS-02, PLS-03 | 当前基线 |
| [PLS-05：开始前展示 Pack/Site 静态匹配与可行动的输入错误](tasks/PLS-05.md) | [#6](https://github.com/lluzi/hima_harness_reforge_polishing/issues/6) | POL-03 | PLS-02 | 当前基线 |
| [PLS-06：核验并打磨运行、阻塞、取消和继续的用户控制](tasks/PLS-06.md) | [#7](https://github.com/lluzi/hima_harness_reforge_polishing/issues/7) | POL-03 | PLS-02 | 当前基线 |
| [PLS-07：报告区分执行结束与研究结论并约束证据范围](tasks/PLS-07.md) | [#8](https://github.com/lluzi/hima_harness_reforge_polishing/issues/8) | POL-04 | PLS-02 | 当前基线 |
| [PLS-08：接收 Step 4 完整快照并核对模型、Pack 与作者流程](tasks/PLS-08.md) | [#9](https://github.com/lluzi/hima_harness_reforge_polishing/issues/9) | POL-05, POL-07, POL-09 | PLS-02 | 含明确 Step 4 /能力/资源前置 |
| [PLS-09：证明 AI 在研究节点生成并验证有意义的算法](tasks/PLS-09.md) | [#10](https://github.com/lluzi/hima_harness_reforge_polishing/issues/10) | POL-05 | PLS-08, PLS-19 | 同一对话 Agent 的真实研究 |
| [PLS-10：在声明位置追加研究节点而保持参考图不变](tasks/PLS-10.md) | [#11](https://github.com/lluzi/hima_harness_reforge_polishing/issues/11) | POL-06 | PLS-08, PLS-13, PLS-19 | 同一执行协议下的附加探索 |
| [PLS-11：回溯时保留历史并只重跑受影响的下游](tasks/PLS-11.md) | [#12](https://github.com/lluzi/hima_harness_reforge_polishing/issues/12) | POL-06 | PLS-10 | 含明确 Step 4 /能力/资源前置 |
| [PLS-12：让扩展研究遵守总预算并留出诚实收尾](tasks/PLS-12.md) | [#13](https://github.com/lluzi/hima_harness_reforge_polishing/issues/13) | POL-06, POL-04 | PLS-07, PLS-09, PLS-11 | 含明确 Step 4 /能力/资源前置 |
| [PLS-13：分开方法身份与运行资产并保护 Pack 更新](tasks/PLS-13.md) | [#14](https://github.com/lluzi/hima_harness_reforge_polishing/issues/14) | POL-07 | PLS-08 | 含明确 Step 4 /能力/资源前置 |
| [PLS-14：把 Campaign 知识材料可靠归档到 Pack 内](tasks/PLS-14.md) | [#15](https://github.com/lluzi/hima_harness_reforge_polishing/issues/15) | POL-07 | PLS-07, PLS-13 | 含明确 Step 4 /能力/资源前置 |
| [PLS-15：把 AI 研究过程、环境和算法纳入技术报告](tasks/PLS-15.md) | [#16](https://github.com/lluzi/hima_harness_reforge_polishing/issues/16) | POL-04, POL-05 | PLS-09, PLS-14 | 含明确 Step 4 /能力/资源前置 |
| [PLS-16：下一次研究主动引用相关且获准的历史资产](tasks/PLS-16.md) | [#17](https://github.com/lluzi/hima_harness_reforge_polishing/issues/17) | POL-08 | PLS-09, PLS-14, PLS-15 | 含明确 Step 4 /能力/资源前置 |
| [PLS-17：Pack 升级和分享由 owner 控制并保留客户资产](tasks/PLS-17.md) | [#18](https://github.com/lluzi/hima_harness_reforge_polishing/issues/18) | POL-07, POL-08 | PLS-13, PLS-14 | 含明确 Step 4 /能力/资源前置 |
| [PLS-18：完成真实 DTCO 研究 pilot 与第二次知识复用](tasks/PLS-18.md) | [#19](https://github.com/lluzi/hima_harness_reforge_polishing/issues/19) | POL-09 | PLS-03, PLS-04, PLS-05, PLS-06, PLS-12, PLS-15, PLS-16, PLS-17 | 含明确 Step 4 /能力/资源前置 |
| [PLS-19：对话 Agent 执行节点](tasks/PLS-19.md) | [#22](https://github.com/lluzi/hima_harness_reforge_polishing/issues/22) | 最新执行职责决定 | 已有控制/UI；开工前固定快照与迁移协议 | 先完成单节点纵向切片，复用现有 dsh Agent |

## 顺序

先推进 PLS-01 → PLS-02 → PLS-03 → PLS-04。PLS-05、06、07 在 PLS-02 后按各自修改范围推进；这不意味着允许同时改同一个共享模块。

PLS-08 是 Step 4 接口与能力交接点，必须核对新的执行主导权。PLS-19 建立 Agent 节点执行基础，PLS-13 确定方法身份与资产保护；在这些前置之后推进 PLS-09 的真实研究、PLS-10 的图扩展及后续有效性/预算/归档。PLS-18 集中承担昂贵的完整 DTCO 验收。

## 规格与测试的边界

- 首轮任务标注 ready-for-agent；依赖未完成或外部前置未提供时不可开始依赖实现。PLS-19 的主导权方向已接受，具体协议/迁移和暂停细节仍需细化，其实时状态见 #22。
- 本次没有运行产品测试或真实研究；引用的 48 个不同通过用例来自既有本地基线。
- ADR-0005 已根据用户本次明确要求接受：L1/L2 是主要回归入口，L3 限于窗口行为，L4/L5 按影响与里程碑触发。
- 不创建第二运行架构；需要跨模块改字段时列出生产者、消费者和兼容成本。

首轮发布身份、Issue 映射和回读核对见 [publication.json](publication.json) 与 [remote-verification.json](remote-verification.json)，其中状态和依赖是当时的快照。PLS-01～07 已完成，实际交付与验证见 [批次记录](../../assessment/2026-09-11/pls02-07/README.md)；后续任务依更新后的 Issue 和前置条件推进。
