# ATCS 集成合同与文件所有权

本文定义 ATCS 实施时跨任务共享的接口。字段名称可以在最低层实现时按当前代码命名调整，但语义、
作者和失败方式不能改变。

## C1 — Agent Team 结果交付

一个 Team member result 的权威载体是 delegation Ledger record 和 native child transcript。Pack 工具只
能消费 owner 明确采用、满足 Pack result schema、绑定当前 Run/node/execution/generation 的结果。

若最低层测试证明现有接口无法提供 Pack 工具需要的 reader-backed 文件，允许扩展现有
`agentTeams.members[]` 声明一个结果投影：

```yaml
adoptedOutput:
  output: workerRequest01
  mode: write-once-json
```

其语义为：

- 只有 `ownerAdoption: required` 成功后可投影；
- bytes 是 child 返回的那一个 JSON object，不由模型或 owner 重写；
- 路径来自 Pack output 和 Site binding，调用者不传绝对路径；
- create-exclusive/write-once，同一 result 重试返回 duplicate；
- 不同 result、execution、generation 或 content 试图覆盖时拒绝；
- 投影后必须通过 output 的 Pack Reader，产生当前 generation 的 observation；
- result record、adoption record、content SHA-256、output path 和 observation id 相互可追溯；
- 投影不完成节点、不运行工具、不采用 Operator 结果。

优先把该行为放入现有 `packs.ts` schema、`index.ts` Host materialization、
`delegation-runtime.ts` adoption 和 Ledger/Reader 路径。没有第二个结果数据库或 ATCS 专用 route。

## C2 — 每个 worker 的 Team recipe

ATCS 声明三支结构相同、slot 身份不同的团队。每支 Team 绑定一个当前 worker interactive execution：

1. `researcher` 只读当前 observation、risk、experience、work package 和 worker manifest，返回一个
   有界 JSON plan，含 `actions[]`、falsifier、protected objects、expected effects、limitations；
2. owner 采用 Researcher result，按 C1 投影为对应 `workerRequestNN` 并由 Reader 读取；
3. `reviewer` 读取该精确 plan 和当前证据，返回最多一个 action，携带 plan SHA-256；
4. owner 采用 Reviewer result；
5. `operator` 获得 Host 注入的 immutable reviewed action，仅有 `hima_interactive`；
6. Operator 查询 falsifier，条件成立才 mutation；输出实际 receipts、before/after dump、ops log、
   logical/physical ECO 或诚实 no-fix；
7. owner 采用 Operator result；Pack deterministic tool 封存 Contribution。

Team recipe 不把一个 slot 的 edit domain、budget 或 result 交给另一个 slot。一个
Run/node/execution/member 只有一个稳定 child identity。恢复复用原 child；不能为重试创建第二 Operator。

## C3 — 并行与资源

并行的是独立 AI 研究和准备。商业工具执行服从 Site 的 `parallelJobs` 和 licence capacity。

- 三个 worker 必须具有独立 workspace/name prefix/ops log/output identity。
- `xtop: 1` 时三个 Operator 排队，不声称 XTop 并发。
- Contribution join 只等待本轮已声明为 required 的 slot；no-fix、refused、cancelled、unknown 分开。
- 不为每个 worker 运行完整 Innovus/StarRC/PT。昂贵物理刷新发生在组合后的候选上。
- dynamic batching 的等待价值由 Pack next-decision/compose 方法决定；Runtime 只执行业务决定。

## C4 — Contribution 与候选身份

Contribution 必须绑定：base design-state id、slot/work-package id、before/after dump hash、实际 operation
trace、edit domain、protected objects、dependencies、atomic groups、工具/session identity 和限制。

Composition、replay、implementation、STA 和 adoption 使用同一个 candidate lineage。缺失、截断、同名
异状态、scenario/corner/library/SPEF/DB错配均为 unknown/refusal，不能转成 0 或 PASS。

## C5 — 可交付 Pack 身份

一次发布候选由以下共同固定：

- Harness commit/App version、artifact digest、manifest hash；
- Pack id/version/digest、native TEST Run、release record；
- Site、Permit hash、wrapper hash、Operator binding id/hash；
- input manifest和 analysis contract hash；
- 工具版本、license mode、Run/Generation identity；
- 测试证据和 claim limits。

任一 method/wrapper/binding byte 改变都产生新候选。`VERSION.yml` 只能由 native release path 生成。

## C6 — 对照口径

Control 和 treatment 使用同一 Harness/App、模型/effort、设计 checkpoint、analysis contract、Site、工具
版本、license/wall-clock/generation 预算和最终有效性门。唯一方法变量是 Pack。

首先比较是否形成完整、同源、可采用的数据库；然后比较 clean/time。若都未 clean，只报告固定预算
下的 best verified frontier 和成本，不把它写成“完成 timing closure”。

## 文件所有权

| 文件组 | 唯一主任务 | 规则 |
| --- | --- | --- |
| `packages/harness/src/{packs,index,delegation,delegation-runtime,remote,tools}.ts` | ATCS-02 | 只实现通用结果投影；ATCS-03 只消费 |
| `packs/agentic-timing-closure-system/contract.yml`, `graph.yml`, Team knowledge | ATCS-03 | ATCS-04/05 交付局部变更，由 ATCS-03 集成共享 YAML |
| `flow/templates/xtop-*`, Site wrapper/Permit/binding inputs | ATCS-04 | 不改 delegation Runtime |
| `flow/atcs/{core,adapters,verification,refresh}.py` | ATCS-05 | 不重构 Contribution/composition/adoption |
| `flow/atcs/{contributions,composition,integration,adoption,experience}.py` | ATCS-03 | 保持现有模块接口；修改必须有该模块反例 |
| qualification scripts/evidence | ATCS-06 | 不顺手修改产品行为 |
| TEST/release/App/manual/final handoff | ATCS-07 | 只消费已固定候选 |
| benchmark charter/audit/report | ATCS-08 | control/treatment 都只读已发布 Pack |

