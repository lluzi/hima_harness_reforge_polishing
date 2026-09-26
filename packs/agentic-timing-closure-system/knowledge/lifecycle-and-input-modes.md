# 生命周期与输入模式

## Source

- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md`
  （2026-09-26 快照）§6「Plan-fix 未能闭合：立即形成 Residual Case」段首「输入前提」；
  §7「何时判断成功，何时停止当前修复方式」；§8「重新 APR：选择最近的有效起点」及
  「当前 Foundation Flow 的真实接入点」表。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
  （2026-09-26 快照）§11「生命周期风险管理如何融入这个体系」阶段表。
- 本 Pack `INTENT.md`（`packs/agentic-timing-closure-system/INTENT.md`）Answers 8–10、12：
  可恢复输入合同选 B（数据本身识别范围）、模式选 auto、部分阶段资料选 A（全流程齐全才
  开放生命周期干预）、转 APR 时机选 B（全流程模式不必穷尽局部 ECO）。
- 本 Pack `SPEC.md`（`packs/agentic-timing-closure-system/SPEC.md`）Semantics 章节：
  `tc_lifecycle_available`（Measure 0/1）的语义。

## Applies when

- M1 `input_readiness(manifest)` 判定 `scope`（`full-flow`/`post-route-only`）和
  `lifecycleAvailable` 时。
- Residual Case 决定是否可以选择 `suggestedStage`（`postroute`/`route`/`cts`/`place`）
  还是必须停在 `null`（post-route-only 模式下不生成早期 APR 任务）。
- 任何要「回退到某个更早 checkpoint 重新开始」的提案，无论证据看起来多有说服力。

## Changes this decision

- **`auto` 只有两种范围，且由数据本身、不是由用户偏好或 Agent 判断决定：** 全流程
  资料齐全（`lifecycleAvailable = 1`）才开放生命周期干预；否则严格落在 post-route-only，
  只做按需 fix，不生成早期 APR 任务。这是 Judge/Rule 层的确定性判断，不是 Chooser 的
  策略选择（`INTENT.md` Answers 8–10）。
- **不开放部分阶段回退，不允许自行重建未提供的早期状态。** 即使某个早期 checkpoint
  文件存在，也不等于「已测过恢复」，不能据此认定全流程输入合同完整
  （`INTENT.md` Golden Flow 一节「历史残余」段的既有反例）。资料不完整时，`missing[]`
  必须列出具体缺项，而不是把部分可用的早期数据当作已验证的完整生命周期。
- **全流程模式下不必穷尽局部 ECO 才能转向更早阶段。** 有证据支持早期干预能缩短总闭合
  时间时，即使 local ECO 尚未耗尽，也可以直接转向该阶段；「转移」的合法理由包括：
  没有合法位置且局部方案不能释放所需空间、合理 cell 候选在共同 setup/hold 窗口下都
  不可行、主要延迟来自当前 ECO 动作无法改变的布局/布线路径、本地修复反复制造同一外溢
  且前提没有变化（OPERATOR §7）。
- **重启起点由问题机制决定，不是「越早越安全」：** routing 层/绕行问题优先从
  pre-route/CTS 状态重启；clock 结构/相对 latency 问题从 place 或 CTS 前状态重启；
  距离/局部容量/密度/macro 通道问题从 pre-place/init 重启；逻辑级数/映射本身的问题
  先检查允许范围内的 Innovus 物理优化，需要重新综合或 RTL 修改则报告任务范围限制，
  不启动综合或 RTL 任务（OPERATOR §8）。
- **checkpoint 重启后必须重新映射，不能复用旧物理坐标/SPEF/context 当新状态事实。**
  Residual Case 的逻辑对象按 lineage/拓扑重新定位；失效的下游阶段重新运行，未受影响的
  只读工艺资料继续共享（OPERATOR §8）。
- **约束、时钟频率和功能意图在任何阶段干预中都保持权威，不能借降低目标赢得比较。**
  一个预期会改变功能/PG 完整性的提案使用对应合同与项目授权，不能把「早期干预更快」
  的判断建立在放松约束之上（OPERATOR §8）。

## Counterexample

Golden Flow（本 Pack `INTENT.md`）记录了 `init/place/cts/postcts_hold/route/postroute/
postroute_final` 等 checkpoint 路径存在的「历史残余」，并明确标注：这只是文件存在的
证据，不等于已测过恢复，也不能据此认定新 Pack 的全流程输入合同完整。如果 `auto` 的
范围判定看到这些路径存在就直接判 `lifecycleAvailable = 1`、开放生命周期干预，就会在
资料实际不完整（例如缺少某阶段的匹配约束/工具版本身份）的情况下错误地允许早期 APR
任务，进而尝试从一个未经验证可恢复的 checkpoint 重建状态——这正是本节「不允许自行
重建未提供的早期状态」要防止的失败模式。
