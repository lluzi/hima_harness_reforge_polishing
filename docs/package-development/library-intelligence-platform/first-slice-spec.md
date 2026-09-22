# LIB-INT-01：Design-Conditioned Library Delta Triage

状态：**blocked before implementation**。阻塞条件是 Empyrean Liberty API qualification fixture 在已声明
运行环境中退出 139；用户已明确本轮不做 debug。解除阻塞需要厂商可用包/运行说明，或用户重新授权
诊断。本文不把规格完成写成产品完成。

GitHub tracker: [#49](https://github.com/lluzi/hima_harness_reforge_polishing/issues/49)

## 模型与最低验证

常规实现与集成使用 `gpt-5.6-terra / medium`；native API/证据真实性和写回安全在实现稳定后使用
`gpt-5.6-sol / high` 做一次关键复核。最低层级是零商业许可的本地 contract tests 加一项 `linglong`
只读 L4 qualification；没有真实 API parse/query/write-copy 证据时不得进入 UI 或批量 corpus 运行。

## 用户场景与结果

一名 Library 或 STA 工程师需要比较同一 Library family 的 baseline/revision，并知道变化对当前设计的
实际影响，而不是阅读数千条未排序 diff。工程师在 HimaGuide 中选择 Pack、Site、两个 Library set 和
一个 design evidence bundle，确认 Campaign 后得到：

- 完整且可复现的 Library semantic delta；
- 基于真实 design adoption、timing endpoint、slew/load coverage 的影响排序；
- 每个 top finding 的证据、未知、建议反证和安全候选动作；
- 一份可归档技术报告，不改变任何输入 Library。

## 当前证据

- API surface 和 runtime 证据见 [证据账本](evidence-ledger.md) INT-001～INT-004、INT-012。
- 竞品和产品差异见 [产品判断](decision-report.zh-CN.md)。
- corpus 元数据见 INT-005、INT-013。
- HimaHarness 归属依据：`CONTEXT.md`、ADR-0001、`docs/agents/polishing-discipline.md`；现有 Pack tool
  schema 在 `packages/harness/src/packs.ts:206`，Site/Permit 在 `packages/harness/src/sites.ts`，tool launch
  在 `packages/harness/src/node-turns.ts:228`。

## 行为归属

| 行为 | 现有 owner | 增量 |
| --- | --- | --- |
| 方法、输入、运行图、tool/reader | 新 `packs/library-intelligence/` HimaPack | 新业务 Pack，不新增 Harness 模块 |
| Site 路径、wrapper 和资源权限 | `sites.ts` 与 Site profile/Permit | 新 Pack bindings 和最小只读 roots；Campaign 写根保持独立 |
| Job 启动、进程状态、资源审计 | `channel.ts`、`node-turns.ts` | 复用现有 `/usr/local/bin/edarun` tool launch；无新远程执行层 |
| 解析事实 | Liberty 原件 + Site-local adapter output | 原件是 authority；index 是 hash-bound 可重建派生物 |
| finding、decision、history | Ledger、Reader、Archive/Knowledge | Reader 独立验证 record/hash；Campaign Agent 负责业务判断 |
| 用户呈现 | 现有 Campaign/Evidence/Report 投影 | 首切片先用结构化 Evidence/Report；不先建新 dashboard |

## 预计代码范围

解除 runtime 阻塞后才创建：

- `packs/library-intelligence/INTENT.md`
- `packs/library-intelligence/SPEC.md`
- `packs/library-intelligence/FABRIC.md`
- `packs/library-intelligence/TEST.md`
- `packs/library-intelligence/contract.yml`
- `packs/library-intelligence/graph.yml`
- `packs/library-intelligence/semantics.yml`
- `packs/library-intelligence/tools/libapi_worker.py`
- `packs/library-intelligence/tools/stages.py`
- `packs/library-intelligence/tools/read_stage.py`
- `packs/library-intelligence/readers/*.yml`
- `packs/library-intelligence/rules/*.yml`
- `packs/library-intelligence/knowledge/*`
- `test/contract/library-intelligence-pack.test.ts`
- 必要的独立 `sites/linglong-library/` 示例 profile/permit；不静默扩大现有 `linglong` Permit。

首切片不修改 `packages/harness/src/index.ts`、`fabric.ts`、`ledger.ts`、`tools.ts` 或 Workbench。只有具体
consumer 证明通用 Pack 输出不能表达必要行为时，重新写任务并走架构升级门。

## 精确输入

| 输入 | 语义 |
| --- | --- |
| `baselineLibrarySet` | Site-local JSON manifest；每个 Liberty 文件为 plain file，含 expected SHA-256 和 source role |
| `candidateLibrarySet` | 同族 revision manifest；与 baseline 的 family/corner/view 对齐规则必须显式 |
| `designEvidence` | 当前 design state 的 top、mapped/post-route netlist、timing report/index、约束和每个文件 SHA-256 |
| `libApiRuntime` | Python、API home、API build、adapter schema、`edarun` wrapper 的 Site-bound profile |
| `analysisPolicy` | finding 保留、排序因子、tolerance 和 query budget；默认值属于 Pack，不属于模型 |
| `workspaceRoot` | Campaign 私有写根；任何输出、cache 和 candidate copy 均只在此处 |

## 稳定 adapter 输出

SWIG object 不跨进程。每个 source file 由独立 worker 解析，写一条 schema-versioned record：

```json
{
  "schema": "hima-library-facts/1",
  "source": {
    "path": "<site-local path>",
    "sha256": "<64 hex>",
    "bytes": 0
  },
  "producer": {
    "apiBuild": "2026.master.c68db94",
    "python": "3.7.12",
    "adapterSha256": "<64 hex>"
  },
  "library": {
    "name": "...",
    "units": {},
    "operatingConditions": [],
    "cells": []
  },
  "unknowns": [],
  "warnings": []
}
```

Cell facts include identity, area/footprint/class, pins/PG pins, functions, leakage, timing/power groups, lookup axes,
values, model type and source location when the API exposes it. Missing values remain `null` plus an `unknowns`
reason. Large tables may be stored in content-addressed sidecars; the record retains shape, min/max/statistics and
sidecar hash, never an unbound path.

Worker failure is a result, not partial data: parent records input hash, exit code or signal, parser log hash and no
facts record. A failed file cannot silently disappear from corpus totals.

## 运行图

1. `bind-inputs`：验证 manifest、roots、hash、runtime identity 和 design evidence。
2. `qualify-api`：vendor fixture + one declared representative Library；read/query/write-copy/round-trip；任何
   crash or identity mismatch blocks Campaign before corpus scan。
3. `index-baseline` / `index-candidate`：content-addressed, per-file isolated workers；可并行度受 Site cap。
4. `read-indexes`：Reader 验证 source/producer/sidecar hashes、完整输入 accounting 和 unknowns。
5. `semantic-delta`：Cell/pin/arc/table/unit/corner/view 差异；完整 finding set 不裁剪。
6. `join-design-impact`：连接 actual master/instance、path/endpoint、slew/load coverage 和当前 design hashes。
7. `triage`：Campaign Agent 在 Pack 的 ranking bounds 内选择 top investigation；不得把 low design relevance
   改写为 Library PASS。
8. `targeted-check`：首切片只允许 read-only replay/query 或独立 copy 上的 what-if；不写输入。
9. `final-judge`：报告完整性、reproducibility、unknown 和 rollback 规则。
10. `archive`：技术报告、records、queries、adapter identity 和证据清单进入 Pack run assets。

## Finding 与排序语义

每个 finding 必须同时保留两套轴：

- `librarySeverity`：规则/变化自身的严重度、范围和确定性；
- `designRelevance`：当前设计是否采用、实际 instance count、是否命中 endpoint frontier、实际 slew/load
  是否落在变化区域、margin 和 path migration 风险。

排序可以组合两轴，但不能覆盖原值。`designRelevance=none` 只表示当前 design 未见影响，不表示 Library
正确。模型可以解释和选择 investigation，不得生成未被 records 支持的数值或 PASS/FAIL。

## 保持项与安全边界

- baseline/candidate Library、PDK、API 安装目录和许可证服务只读；
- 不把 proprietary Library body、license 或客户 design 上传或写入 Git；
- 不改 API/QuaLib、系统 Python、`edarun` 镜像或 Empyrean 默认服务；
- source hash、adapter version、query、finding、选择和结果完整保留；
- cache 可以删除并重建，不成为另一个 authority；
- candidate write 直到后续切片才开放，且只能写 Campaign workspace 新文件；
- 一个 Campaign Agent 仍是 Run 唯一业务 owner；Fabric 不自行决定 Library release。

## 验收与反证

### L0/L1：无 vendor API

- fixture facts 能稳定序列化，unknown 不变成零；
- 同一 source hash + producer identity 产生相同 record hash；
- 任一输入漏计、sidecar hash 错误、重复 corner identity 或 partial worker output fail closed；
- ranking 保留所有 finding，并分别显示 Library severity 和 design relevance；
- 未采用 Cell 的高严重度 finding 仍保留，不冒充 PASS。

### L2：Pack contract

- `loadPack`、`checkPack`、tool argv、Permit 和 reader contract 通过；
- Site 不允许 API/python/library roots 时 preparation 明确拒绝，且不启动 Job；
- worker exit 139 被记为 blocked evidence，不带出半份 facts；
- 全部输出位于 Campaign workspace。

### L4：真实 Site qualification

必须一次性通过：vendor fixture、一个 SAED14 representative、一个 TSMC28 representative；对每个输入
执行 read、name/units/cell/pin/arc/table query、workspace copy write、copy re-read 和关键 invariant compare。
原件 SHA-256 前后不变。任一失败则 Pack 保持 blocked，不能扩大到 933-file batch。

### 产品反证

- **通过候选：** 一个关键 arc table 变化覆盖当前 worst endpoint 的实际 slew/load；平台将其排在前列，
  展示 exact design linkage 和独立验证建议，工程师能够复算。
- **失败例 1：** 未采用 Cell 的大量变化挤掉上述关键 finding。
- **失败例 2：** 当前 design 未采用的高严重度 Library 错误被删除或标为 PASS。
- **失败例 3：** 同名 Cell/arc 在不相容 corner/view 中被错误对齐。
- **失败例 4：** API crash 后 corpus totals 仍显示完整，或报告没有明确未分析输入。

## 回滚

- 环境：删除新建 `/data/eda/venvs/qualib-libapi-2026-py37` 和
  `/data/eda/runtime/miniconda3` 可恢复安装前状态；系统 Python 和服务未变。
- Pack：一个独立 commit 包含新 Pack/test/site example；回滚该 commit 不迁移 Ledger schema、不改变现有 Pack。
- Campaign：删除一个 Campaign 的派生 cache 不损坏 source 或历史 records；重新运行必须由相同 source
  hash 和 producer identity 重建。

## 当前解除阻塞的唯一问题

选择其一即可继续实现：

1. 厂商提供在 AlmaLinux 8 + Python 3.7 可通过 `testParser.py` 的 API 包或精确运行环境；或
2. 用户重新授权对 `_tmlib.so` 的 runtime/ABI 问题做有界诊断。

在二者之前，不创建会把未合格 API 包装成“可用平台”的产品代码。
