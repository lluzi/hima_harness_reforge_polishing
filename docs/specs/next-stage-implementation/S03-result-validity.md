# S03 — 多目标建议与可交付 best DB

覆盖：NXT-A5。基线：`1a79cb1`。状态：规格可派工；不宣称已经发生 false completion。

## Problem Statement

工程师需要 setup、hold 及物理质量同时可信的交付数据库。某一时序指标改善，或模型说已收敛，不足以证明数据库可采用。建议、最终完成门、best DB 选择必须一致。

## Solution

保留既有 Judge 与最终 all-verdict guard，修正建议投影与 Pack 的 best 采用条件。未验证或退化候选保留供研究，不能覆盖合格 best。

## User Stories

1. 作为工程师，我希望 setup/hold 分别展示，从而不会因单指标改善误判结束。
2. 作为工程师，我希望建议与最终完成门一致，从而不反复请求注定被拒绝的完成。
3. 作为工程师，我希望缺 DRC/connectivity 报告显示未知，从而不把未测当零违规。
4. 作为工程师，我希望 best 指向同一次数据库和测量，从而可独立恢复验证。
5. 作为工程师，我希望退化候选保留但不覆盖 best，从而能研究失败并安全交付。
6. 作为工程师，我希望所有候选都不合格时坦率报告无可交付 best，从而不收到伪装成功的输入副本。
7. 作为工程师，我希望多 corner/约束覆盖完整，从而不因少测场景得到假 clean。
8. 作为工程师，我希望 terminal、partial、converged-with-violations 分开，从而知道停止原因。

## Implementation Decisions

| 文件 / 符号 | 核实的现状与修改 |
| --- | --- |
| `packages/harness/src/node-turns.ts` / `exploreEvidence`, `exploreRecommendation` | 已收集全部 required verdicts，但推荐向 `choose` 传 constraint/goal 两项；让建议保留全约束有效性，避免与最终门矛盾 |
| `packages/harness/src/choosers.ts` / `choose` | 延用声明式选策；若输入合同需扩展保持旧双目标 Pack 行为，不硬编码 setup/hold |
| `packages/harness/src/fabric.ts` / `completeAdmittedNode` | 已要求每个 required verdict 为 PASS；保留其权威，补一致性反例而非重写 |
| `packages/harness/src/judge.ts` / `Judge`, `createJudge` | 确定性 verdict 仍唯一；未知/缺证据不得成为 PASS |
| `packs/xtop-timing-closure/flow/closure.py` / `rank`, `compare`, `copy_database_alias` | rank 仅时序，`evidence_valid` 当前取 best.ready；增加同代物理质量与测量身份资格，合格后才比较 rank |
| 同 Pack / `flow/templates/apply-eco.tcl`、`readers/xtop-iteration-result.yml`、`rules/xtop-iteration-evidence-valid.yml`、`tools/read-output.py` | 由现有工具阶段导出可核对物理报告；Reader/规则与结果一起升级，不增加外部验证控制器 |
| `test/contract/xtop-timing-closure.test.ts` 与 Pack 的 `flow/tests/test_closure.py` | 复用 Pack 输出和失败反例；不运行商业工具来证明解析规则 |

输入身份包括 DB树/恢复脚本、输入和约束、场景覆盖、提取/STA/物理报告、generation/iteration。每个必需值须有单位与来源。资格是 eligible/ineligible/unknown，unknown 不进入采用集合。best 与 last 明确分开；原 best 的身份验证失败则报错，不能悄悄回退到 last。

用户于 2026-09-23 确认物理采用门：**同口径完整检查，相对基线不新增 DRC 或连通性错误；覆盖不完整则不采用。** XTop 基线与候选必须各自以同一 Innovus 检查模板写出完整 DRC/connectivity report 和 completion manifest；解析器精确读取完整总数，缺失、重复、截断或受限报告为 unknown/拒绝，绝不以显示条数推断完整。采用时还必须核对同一 profile/source-manifest/scenario 覆盖、DB、STA report、SPEF/extraction 与物理报告 identity。更新 best 先验证完整产物，再原子更新指针；复制失败留原 best。保留两个 XTop 保路 Tcl，不改回 loadECO。

### 切片与并行

S03a：以四种 setup/hold 组合证明建议/最终门差异，升级选择投影；S03b：XTop同代物理有效性 Reader/规则与 best 保存；S03c：UI只消费资格与出处。前者 `node-turns/choosers` 经集成者接线，后者独占 XTop compare/Reader；S07 也涉及 `closure.py`，必须在 S03b 合入后追加反馈，不能双写。可与 S02、S04 内容、S10 并行。

## Testing Decisions

主 seam 是公开执行 recommend/complete 与 Pack compare/read。正例：所有规则 PASS 且同代产物可核对，允许 goal-met 和 best。反例：setup PASS/hold FAIL、反向组合、全 FAIL、DRC恶化、connectivity缺失、陈旧SPEF、跨代报告、unknown、best复制失败都不能采用。保留已有 all-verdict 测试。

实现后：`pnpm run build`；`pnpm run test:local --files test/contract/agent-execution.host.test.ts test/contract/judge.test.ts test/contract/xtop-timing-closure.test.ts`；`python3 -m unittest discover -s packs/xtop-timing-closure/flow/tests -p 'test_closure.py'`。新真实报告形状先独立资格 L4；完整时序迭代仅在单独恢复测试授权后运行。

## Out of Scope

保证 timing clean、强行达到 Fmax 目标、重做商业 signoff 引擎、用模型覆盖 Judge、清理历史失败。

## Further Notes

Pack 字节改变必须新版本与 digest，旧 Run 保持原方法。用旧 Pack/App 与原 best 归档回滚，不反写历史结果。Terra/Medium 实施，结果真实性 Sol/High 复核。
