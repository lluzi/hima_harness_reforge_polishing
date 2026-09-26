# 观察策略

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md`
  （2026-09-26 快照）§2「Operator 的一个工作单元」步骤 2–3；§3「检查分三类，并规定何时不
  检查」；§4「评估与落地：允许有边界的不确定性」。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§12「Agent 在哪里体现不可替代的决策价值」第 2 条「分配观察」；
  §6「分支验证：以最低成本获得足够的提交可信度」。
- XTop `get_paths`、`get_attribute` man pages（安装快照 2025.09.tmp15，man page 页脚日期
  `12/15/2025`，路径见 `xtop-capabilities.md` Source）：`-lower_bound`/`-upper_bound`、
  `-scenario`、`-delay_type` 等参数决定一次查询能看到多宽的 path 集合。
- PrimeTime `report_timing(2)` man page（`X-2025.06`，`/data/eda/software/eda_tools/
  synopsys/prime/X-2025.06/doc/pt/man/cat2/report_timing.2`，只读读取核实）：
  `-significant_digits digits` 「Specifies the number of digits after the decimal
  point displayed for time values ... the default is determined by the
  report_default_significant_digits variable, which is 2 by default. ... This
  option controls only the number of digits displayed, not the precision used
  internally for analysis.」——即默认 2 位小数只影响显示，不影响 PT 内部判定；一条
  真实违例仍可能显示为 `-0.00`，此时 PT 自己在该行追加
  `(VIOLATED: increase significant digits)`（Task 16 真实 corpus 核实：Foundation/
  B_lazy 语料中出现的每一条该注记行，其显示值都恰好是 `-0.00`，且没有一条未加注记
  的 `(VIOLATED)` 行显示为 `-0.00`/`0.00`）。

## Applies when

- 计划 Workshop 决定「这次要看什么」：是否需要更宽的 path breadth/diversity、是否切换
  GBA/PBA、是否需要跨 scenario 查询之前。
- 每次深入分析前，判断该分析是否会改变下一步动作（OPERATOR §4：「每次深入分析必须回答
  '它会决定什么'」）。
- 判断是否停止当前分支的分析、转入真实试验或真实 probe。

## Changes this decision

- **观察宽度由假设的区分力决定，不是固定 dump 参数。** `get_paths` 的
  `-lower_bound`/`-upper_bound`/`-path_type`/`-delay_type` 组合应该按「当前候选机制需要
  看到哪些 path」选择，而不是每次都用同一组固定阈值；只看足以区分当前假设的对象
  （OPERATOR §2 步骤 2）。
- **GBA 结果可以驱动大部分候选筛选，但 insertion/split 等改变拓扑的动作必须有有效的
  PBA 或新寄生模型支持，否则新增路径的估计是 unknown，不能被当作 clean。**
  （ARCHITECTURE §6：「对 insertion/split 等动作，PT 的新网寄生建模必须有效；
  unknown 不转成 clean」）。
- **检查分三类，且只在会改变行动时运行「有条件的便宜诊断」。** 必须正确的检查
  （父状态、scope、工具命令是否成功）每次 mutation 都要做；有条件的便宜诊断
  （targeted PBA、PT 预演、局部空间/路由检查）只在其不确定性会改变下一步时运行；
  不支持的模型标 unknown 并转向适用实验，而不是无限重复同一诊断（OPERATOR §3）。
- **停止分析的判据是「继续分析的成本高于一次受控试验，且不能有效区分方案」，不是
  已经查询了足够多次。** 一个批次的规模由剩余风险、交互强度和等待价值决定，不必等
  所有高阶手段、完整能力图都准备好才落实已成熟的组合（OPERATOR §4）。
- **同一读取前提上重复的根因报告不产生新信息。** 若某项可选检查持续不改变行动且没有
  发现预期失败，应降低频率或移除；共享缓存受输入/工具/配置身份约束，不能跨身份复用
  （OPERATOR §3）。
- **判定一条 path 是否违例，用 PT 自己的分类结论，不用显示出来的 slack 数值本身。**
  显示精度默认只有 2 位小数，一条真实、非零的负 slack 完全可能被四舍五入显示成
  `-0.00`；Python 的 `-0.0 < 0` 为 `False`，若只看数值符号会把一条 PT 明确判定为
  `VIOLATED` 的 path 错误地当作「未违例」。`atcs.reports.parse_path_report` 因此记录
  PT 自己的 `VIOLATED`/`MET` 分类为一个独立事实（`violated`），精度受限的行
  （`(VIOLATED: increase significant digits)`）其 slack 数值本身记为 `unknown`——
  该行确定违例，只是具体数值不可信，两者不能混为一谈。这条 Pack 自己的
  `pt-scenario.tcl` 也把 `-significant_digits` 从默认的 2 提高到 4，减少（但不能
  消除，PT 内部仍可能存在更小的真实违例）今后新鲜报告落入这个边界的概率。

## Counterexample

OPERATOR §4 给出的反例：routing 改动需要新的 RC 才显现效果，用旧 RC 的 PT 预演无法评估
预期收益。如果观察策略坚持「PT 预演必须先证明收益才允许试验」，就会被这类改动无限期
挡住——旧 RC 下的预演对这类问题结构性地给不出有意义的答案，继续加密预演频率或加宽
path breadth 都不会改变结论。正确策略是识别出这是「证据不足、模型不适用」的情形，转入
一次有界的真实物理 probe，而不是持续增加同一种廉价查询的次数。
