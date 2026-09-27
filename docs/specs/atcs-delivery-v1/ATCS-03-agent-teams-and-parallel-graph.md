# ATCS-03 — Pack-declared worker Teams 与资源感知并行图

状态：INTEGRATION_READY — bounded single-worker scope (2026-09-27)

Coordinator scope update (2026-09-27, after #52 CLOSED — PASS): first qualify one complete
post-route Researcher → Reviewer → owner adoption → typed Operator → Contribution → collect path.
The three-worker concurrency matrix below is deferred; it is not implied by the bounded checkpoint.
The frozen #52 retained-result, reviewed-action and finalization interface is reused without changes.
See `docs/assessment/2026-09-27/atcs-bounded-integration.md` for evidence and limits.

依赖：ATCS-01、ATCS-02、ATCS-04、ATCS-05

产出：`INTEGRATION_READY`

## 目标

关闭 FABRIC G1：三个 worker 不再由主 Agent 串行运行三个 Workshop/Operator 链，而由三个
Pack-declared Agent Teams 在独立分支工作。AI 研究可并行，工具操作服从 Site capacity，三个成果在
Contribution join 后进入现有 composition/implementation 链。

## 代码范围

- `packs/agentic-timing-closure-system/contract.yml`：三支 Team recipe、结果 schema、预算、依赖；
- `graph.yml`：worker fork/join、no-fix/refusal 的诚实汇合；
- `readers/atcs-worker-*`、必要 semantics/rules；
- `knowledge/agent-team.md`、SPEC/FABRIC/README；
- `flow/atcs/{contributions,composition,integration,adoption,experience}.py`：仅为新的已证明结果形状做
  局部适配；
- Pack Python tests、ATCS contract/Host graph tests。

## Team 结构

按 [contracts.md C2](contracts.md#c2--每个-worker-的-team-recipe) 声明 w01/w02/w03。每支 Team 的
role 唯一，成员都绑定同一个 slot execution。Researcher plan 必须包含可校验 `actions[]`；Reviewer
最多选择一个 reader-backed action；Operator 只能执行采用后的 immutable typed action。

第一版每个 worker 每代最多一个 mutation。多个操作的 atomic portfolio 只有在当前 Runtime 能以一个
typed、hash-bound action 安全表达并具有直接测试时才开放；不使用 JSON 字符串绕过 typed arguments。

## 图行为

1. `plan-campaign` 仍由 Pack 产生三个互补 work package。
2. `prepare-workers` 建立三个私有 workspace。
3. fork 三条 worker act 分支；每条分支完成 Researcher/Reviewer/Operator/adoption/Contribution。
4. no-fix、refused、cancelled、unknown 都生成明确 slot outcome；unknown 不能冒充空 Contribution。
5. join 后 `collect`/composition/replay/presta/implement/evaluate/adopt/experience 沿用现有模块。
6. XTop capacity 为 1 时 Operator 排队，Researcher/Reviewer 不因 license 串行。
7. restart 恢复原 child/execution/workspace，不创建重复 Operator、mutation 或 Contribution。

## 验收

- Host fixture 中三个 Researcher 会话均由 Pack recipe 生成，拥有不同 child identity/input refs/write root。
- 三个 Researcher 在无 license 阶段都可处于 active/completed；XTop=1 时最多一个 Operator lease。
- 每支 Team 都显示实际 contract、transcript、result、adoption 和 slot outcome。
- 一个 slot no-fix、一个成功、一个 refused 时 join 仍保持三者差异，composition 只选择可用 Contribution。
- 重启、重复 create/adopt/complete 不产生第二 effect。
- reference graph、actual executions、child sessions 和 outputs 可由现有 Workbench 投影，不新增 UI 状态源。
- M1 全部测试通过后，在 handoff 中写出 `INTEGRATION_READY`；未运行 EDA 明确标注。

## 测试

```bash
python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests
PATH="$HOME/.local/node24/bin:$PATH" pnpm run build
PATH="$HOME/.local/node24/bin:$PATH" node scripts/run-contract-tests.mjs local --files \
  test/contract/agentic-timing-closure-system.test.ts \
  test/contract/delegation-run.host.test.ts \
  test/contract/interactive-eda.host.test.ts \
  test/contract/agent-graph.host.test.ts \
  test/contract/fabric-licences.test.ts \
  test/contract/fabric-restart.test.ts
PATH="$HOME/.local/node24/bin:$PATH" pnpm run check:seams
PATH="$HOME/.local/node24/bin:$PATH" pnpm run check:boundary
```
