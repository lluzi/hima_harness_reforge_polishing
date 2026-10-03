# 机制分解与反证

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§4.1「从问题与影响关系构建任务」；§7.3「冲突不仅是脚本改了同一行」；
  §11「生命周期风险管理如何融入这个体系」阶段表。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md`
  （2026-09-26 快照）§6「Plan-fix 未能闭合：立即形成 Residual Case」中 Residual Case 的
  必需字段（cell/net/clock/SI/variation 分解、位置、layer/via/detour、密度与空间）。
- 本 Pack `packs/xtop-timing-closure/knowledge/endpoint-feedback.md`（只读格式参考，
  版本 `1`）：fixed/remaining/entrant/regressed/improved-but-remaining 的端点分类语义。

## Applies when

- 计划 Workshop 把一组违例端点划分为独立 workspace 任务之前（判断哪些症状共享根因）。
- Residual Case 需要说明「已尝试的机制、失败条件、未试机制与不值得尝试的理由」时。
- 一次 Integration Fix Session 判断两个提交是否存在交互（共享 driver/clock/空间）而不是
  只看对象是否重叠时。

## Changes this decision

- **先按根因和影响关系分组，不按 worst slack 排队。** 共享 driver 的 setup/hold 窗口、
  同一区域的 fanout/SI 问题应该分到同一任务；固定「setup Agent、hold Agent」这种按检查
  类型而非按根因分工的方式，容易造成双方在同一路径上争夺 margin
  （ARCHITECTURE §4.1）。
- **候选机制至少覆盖 cell delay、net delay/SI、clock 关系（launch/capture、useful skew）、
  空间/密度、跨 corner variation 五类，而不是默认「slack 差就是 cell 太弱」。**
  一个 Residual Case 必须能说明是否检查过每一类，而不只是记录最终 slack
  （OPERATOR §6）。
- **反证优先于新一轮试验。** 对每个候选机制，先问「有没有观测能证伪它」：例如同一驱动
  换用更强 cell 后 setup 改善但 hold 恶化，说明瓶颈部分来自 clock/data 联合窗口而不是
  单纯 cell 驱动能力；如果没有做过这类对照，候选机制只是假设，不能作为提交的
  `diagnosis`。
- **联合窗口内的两个问题不能分别独立优化后简单相加。** 共享 margin 的两份承诺不可
  简单相加，局部 density 与容量的独立可行性也不保证合计可行（ARCHITECTURE §7.3）；
  发现两个 check 共享同一 driver 或同一 clock branch 时，应把它们并入同一任务或在
  Integration 阶段联合分析，而不是各自宣称已解决。
- **不能证明"无论如何都无法 fix"，只能证明"当前动作、状态和预算范围内不再有值得支付
  成本的修复路径"。** 这是触发转入 Residual Case/更早阶段干预的合法依据，不需要穷尽
  一个不可达的全局不可行证明（OPERATOR §7）。

## Counterexample

ARCHITECTURE §10 的协作合并示例（虚构对象名，不代表 SWERV28 实测结果）：任务 A 研究
共享 driver `U_DRV` 的 setup 瓶颈并完成 sizing；任务 B 独立研究同一逻辑区域一组 sink 的
hold 缺口。如果把 A、B 当作完全独立的机制分别验收，就会忽略「driver 加速可能改善
setup，也可能扩大 hold 缺口」这一联合窗口效应——A 的提交生效后，B 所依赖的 driver
状态已经改变，其原始 `hold-buffer` 候选机制的前提不再成立，必须在 A 之后的集成态上
重新分析 B 并生成修订版 ΔB'，而不是直接合并两份彼此假设了不同前提的贡献。
