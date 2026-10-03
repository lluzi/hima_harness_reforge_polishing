# 现有Hima纪律与可用增量

固定产品源码77223febe236df94d4db4eb006b6c9e612c62206，future研究HEAD b645e23b。下述是本轮源码/文档读取，不是运行验证；不借历史测试通过作本轮PASS。

| 主题 | 已有基础（不要重新发明） | 本轮能指出的增量/限制 |
|---|---|---|
| 小步治理/先证后改 | docs/agents/polishing-discipline.md完整定位→当前行为→最小增量→反证→验证→复核同步；要求真正新增职责才新架构 | 方法原则已有。要验证每次是否真的形成独立预期、局部实现和删除的caller负担；不再加一套总流程 |
| 最便宜反证/避免官僚 | docs/agents/fast-convergence-testing.md§3–4：gate必须防假证据/错身份/重复效果等，且有可执行成功路径；§6复用未变证据 | 强制“再写更多文档”与之冲突。每项推荐有适用条件和停止条件，不能成为每PR全量清单 |
| 架构机械检查 | package.json已有check:seams/check:boundary；scripts/check-seams.mjs检查DSH import旁有声明marker；check-boundary.mjs检查Pack-first名词/豁免 | 它们是有限静态约束，不证明依赖架构、无双控制者或业务正确；在已有入口加极少真实契约检查，勿夸大existing coverage |
| 测试层次 | docs/testing-strategy.md L0–L5，真实Host local、真实model、Site、GUI分开；test/contract/agent-recovery.host.test.ts、branch-autopilot.host.test.ts、resident-engineering.host.test.ts已有 | 不从零建测试平台，不假设无恢复测试；补现有测试未表达的语义，是否缺失需逐条实查。本轮未做完整coverage审计 |
| 当前风险例1：结果选择 | packs.ts judge规则顺序、node-turns.ts:1994 exploreEvidence以当前代最近Judge与首两规则等组装依据 | 添加无关Reading/交换无关完成顺序应不改变目标成果消费（目标提案）；这种metamorphic反例能审查隐含耦合。可能需先补业务声明，不能靠测试猜预期 |
| 当前风险例2：完成语义 | fabric.ts:1289 endRun依赖latestDecision goal-met；completeAdmittedNode:3394拒绝没有actual result，局部结果与整体Goal区别真实存在 | 要把“声明了最终Goal且全部必需证据PASS”与“sum-valid局部PASS”分开；当前代码静态推论不等业务失败复现，不引入虚假Explore通过测试 |
| 当前风险例3：恢复窗口 | completeAdmittedNode多步写request/decision/route/completed；agent-recovery.host.test.ts:95断言中断完成仍uncertain，成功Job不足以证明route | 正确保护不能直接删；用独立状态表描述何时有足够事实恢复纯提交，何时外部effect不明只能unknown；现有测试目标可能需在契约改变后有意更新，而非characterization永久冻结 |
| Caller协议知识 | fabric.ts:1330 ExecutionActionRequest含expectedEpoch/revision/requestId及begin/work/complete；autopilot已有，ADR16已下沉区域推进 | 优先测Interface能否减少调用者排序/转抄义务，不重复宣称从零实现autopilot；收回字段不等删除owner/hold/去重校验 |
| Resident工程委派 | ADR17已有完整任务外包，OpenCode内部团队不再由Hima重复编排；包装进程丢失时收束/核对，不盲重发业务 | 保持一个业务节点的完整委派；不拆每次模型/tool为Fabric节点；不把新Agent框架当本轮方法治理必要条件 |
| 测试工具适配 | package.json Node>=24，node scripts/run-unit-tests.mjs与run-contract-tests.mjs；已有TS构建 | 引入fast-check/mutation/model工具先证明现有runner可承接；不默认Jest/Vitest，不安装本轮依赖。manifest/docs限定搜索未见fast-check/Stryker，不声称全仓库绝无相关实现 |

本轮首个方法应用样例建议：数值analyze→read→judge 与工程委派→Reader→Goal两种consumer，先建立一页业务判定与最小独立反例，再比较现有interface与一种更深interface；这是方法资格样例，不是实施规格/已获批准代码切片。正式派工仍用现有GitHub Issue约定。

固定源码链接：
- [纪律](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/docs/agents/polishing-discipline.md)
- [快速收敛原则](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/docs/agents/fast-convergence-testing.md)
- [现有脚本](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/package.json)
- [完成接口](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/packages/harness/src/fabric.ts#L3394)
- [恢复测试定义](https://github.com/lluzi/hima_harness_reforge_polishing/blob/77223febe236df94d4db4eb006b6c9e612c62206/test/contract/agent-recovery.host.test.ts#L95)

交付前只读刷新：origin/codex/issue82-opencode-design已到d0a66377c8812211dfef555461079e50f21df74b，比77223fe多两提交55c3febe/d0a66377。root读取GitHub compare与fabric/graph/test补丁：ATCS0.3.2增加finish-engineering Explore；completion receipt保留requiredVerdictIds。此报告保留固定快照方法示例，不宣布最新版仍缺ATCS结束路径。相关代码应用前重新核对，未合并/修改/测试该分支。原始compare留root-raw/product-delta.json。
