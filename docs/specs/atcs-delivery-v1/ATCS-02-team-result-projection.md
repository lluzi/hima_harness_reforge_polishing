# ATCS-02 — 资格并实现 adopted Team result 的 Pack 投影

状态：PASS — existing retained dependency path reused (2026-09-27)

The bounded ATCS worker keeps its existing Workshop-produced, reader-backed candidate action list.
Researcher reviews that exact input and returns hypotheses; owner adopts its exact retained result,
which Reviewer reads through `hima_delegation_input`. Reviewer selects one action from the existing
plan; the qualified Host verifies the plan SHA and injects the immutable action into Operator.
No Pack tool consumes Researcher prose, and no Researcher bytes need a second file authority.

Lowest deterministic evidence: `test/contract/interactive-eda.host.test.ts` now refuses Reviewer
creation before Researcher adoption and verifies exact Researcher JSON retrieval afterwards. Its
existing reviewed-action, adoption, typed mutation and finalization gates remain green (1/1 Host
test, one in-process Host, zero SSH/Electron/EDA). Runtime source changes: zero. ATCS-03 consumes
this path; newly generated actions must first pass the existing Workshop/Reader plan admission.

依赖：ATCS-01

产出：C1 的通用 Host/Runtime 接口

## 问题

当前 Agent Team dependency 可以读取 retained child result，Operator 可以接收一个 reviewer-selected
action，但 Pack 工具没有已证明的通用方式消费 owner 已采用的 Researcher JSON。ATCS 的 worker plan
需要成为 write-once、reader-backed、hash-bound 的 Pack output，随后 Reviewer 才能绑定其 SHA。

## 代码范围

- `packages/harness/src/packs.ts`：仅在反例成立后增加可选 result-output 声明及静态校验；
- `packages/harness/src/delegation.ts`、`delegation-runtime.ts`：adoption 幂等性和结果身份；
- `packages/harness/src/index.ts`：Host 侧路径解析、原子投影和 Reader admission；
- `packages/harness/src/remote.ts`、`tools.ts`：只有现有 wire 不能表达投影结果时才做最小增量；
- `test/contract/delegation-run.host.test.ts`、`delegation.host.test.ts`、
  `interactive-eda.host.test.ts` 和一个 Pack fixture。

不新增 result service、数据库、scheduler 或 ATCS 条件分支。

## Red

先写一个最小 Pack fixture：Researcher 返回合格 JSON，owner 采用后，下游 Reviewer 需要一个精确
Pack output observation。证明当前接口的实际失败点；若当前实现已经可以安全提供同等行为，删除本任务
的 Runtime 改动，只记录复用方法。

反例至少覆盖：未采用、错误 resultRecordId、schema 缺字段、旧 generation、目标路径已有不同 bytes、
重复同一请求、Host restart 后重试、Reader 拒绝、owner epoch 过期。

## Green

实现 [contracts.md C1](contracts.md#c1--agent-team-结果交付)。结果路径只来自 Pack output/Site，使用
create-exclusive 原子写入；记录 result/adoption/output/observation identities。投影成功不完成节点。

## 验收

- 正确 result 被投影一次，Reader observation 的 content SHA 与 child JSON 一致。
- 同请求/同 result 重试为 duplicate；不同 result 不覆盖。
- 未采用、陈旧、越权、格式错误、Reader 失败都在写入或工具启动前拒绝。
- 普通 delegation 和 `xtop-timing-closure` 当前 Team tests 不回归。
- 删除该接口会迫使三个 Pack/调用者各自实现结果落盘，证明该模块有实际深度；只有 ATCS 消费时仍
  保持在现有 delegation 模块，不再抽象新层。

## 测试

```bash
PATH="$HOME/.local/node24/bin:$PATH" pnpm run build
PATH="$HOME/.local/node24/bin:$PATH" node scripts/run-contract-tests.mjs local --files \
  test/contract/delegation-run.host.test.ts \
  test/contract/delegation.host.test.ts \
  test/contract/interactive-eda.host.test.ts \
  test/contract/xtop-timing-closure.test.ts
PATH="$HOME/.local/node24/bin:$PATH" pnpm run check:seams
PATH="$HOME/.local/node24/bin:$PATH" pnpm run check:boundary
```
