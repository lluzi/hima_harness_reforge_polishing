# S11：Library facts、typed report 与受控分析方法

状态：实施规格；覆盖 backlog 的 `NXT-E1`、`NXT-E2`、`NXT-E3`、`NXT-E4`。本文件不实现、不运行测试/EDA、不安装或诊断 Liberty API。`LIB-INT-01` 仍是唯一真实接入门。

## Problem Statement

工程师需要比较同一 Library family 的 baseline/candidate，区分 Library 自身变化和当前 design 的实际影响，并能够回到 hash-bound evidence。现有 Harness 已有 Pack、Site Permit、Channel/Job、Reader、Ledger、Archive 与 Workbench，但尚无 Library intelligence Pack、原生 API qualified facts、typed Library report 或客户规则 adapter。

最早的必要条件没有满足：Empyrean Liberty API qualification fixture 在声明环境中于 `lib.name` 退出 139。这个 native crash 不是“没有 UI”的问题，不能被 mock、fallback parser、tab 或文字包装成 Library 读取成功。用户明确本轮不 debug；只有厂商可用包/精确运行说明，或用户另行授权有界 ABI/runtime 诊断，才能解除 E1。

## Solution

在现有 HimaPack 和 Site/Channel 责任内实施四层递进能力：

1. E1 使用隔离、只读 qualification fixture 证明真实 native API 的 read/query/workspace-copy/re-read；任一 crash/identity mismatch fail closed。
2. E2 在新的 `packs/library-intelligence/` 内以每源文件隔离 worker 生成 schema-versioned、hash-bound facts 和 semantic delta；原 Liberty/设计证据是 authority，facts index 是可重建派生物。
3. E3 从 E2 facts 形成只读 `LibraryInsightReportView`，包含 library-health、library-performance、design-impact 三类报告；它由 D1 Workbench 承载、由 S08/D2 只读 renderer 消费。
4. E4 将客户规则/Python 算法限制为 versioned Pack tool/reader/rule，使用 typed I/O、Permit、budget 和 workspace；它保存 method/proposal，默认不改 golden Library、Pack、Harness 或判据。

不新增分析 runtime、数据库或 UI shell。真正用户业务 owner 仍是一个 Campaign Agent；Fabric 不根据 Library finding 自行 release/pass/fail。

## Existing modules and symbols

| 路径 | 已核实符号/责任 | S11 使用或增量 |
| --- | --- | --- |
| `packages/harness/src/packs.ts` | `loadPack`, `installedPacks`, `packWords`, `checkPack` | Pack contract、tool/reader declaration 与 Site readiness；S11 新 Pack 不重写 Harness Pack 模型。 |
| `packages/harness/src/sites.ts` | `Site`, `Permit`, `loadSite`, `pathsOf` | 新 `linglong-library` 示例 profile/Permit 只给最小只读 roots、wrapper 与 Campaign private write root；不得扩大现有 `linglong`。 |
| `packages/harness/src/channel.ts`、`node-turns.ts` | 既有 Channel 与 tool launch | 通过现有 `/usr/local/bin/edarun` 受控启动隔离 worker；不建另一远程执行层。 |
| `packages/harness/src/readers.ts` | `Reader`, `readerNamed` | E2 reader 验证 facts/index/sidecar hashes 和 input accounting；不让 UI 直接解析 Liberty。 |
| `packages/harness/src/ledger.ts` | `Ledger`, `LedgerRecord`, `KnowledgeRecord`, `appendKnowledge` | 既有 run evidence/archive 定位；若 Pack records 足以表达则不改 schema。共享 `ledger.ts` 仅主集成者接线。 |
| `packages/harness/src/record-views.ts` | `KnowledgeView`, `knowledgeView` | 复用既有 evidence/read projection；新增 Library view 仅在明确 consumer 与事实载体后由主集成者接线。 |
| `packages/harness/src/remote.ts` | `RunView`, `runView`, `RemoteOperations`, `readExperience` | E3 的 hash-bound read route/projection 由主集成者所有；S11 输出冻结 payload。 |
| `packages/harness/src/client/HimaWorkbench.tsx` | `HimaWorkbench` | **不由 S11 修改**。S08 是 UI owner；S11 仅提供 `LibraryInsightReportView`、Pack producer与fixture；client renderer归S08。 |

当前没有 `packages/harness/src/profile.ts`；profiles 由 `sites.ts` 的 Site/Permit 文件模型承载。当前也没有 Library adapter/renderer 入口；新增 `packs/library-intelligence/tools/libapi_worker.py`、`read_stage.py`、`stages.py` 和 Pack readers/rules 的必要性仅在于它们有明确消费者：E2 graph stage、Reader、E3 producer 和 E4 versioned method。它们不能假称已存在。

## Frozen contracts: inputs, outputs, errors and order

### E1 qualification

输入：Site-bound `libApiRuntime`（python/API build/adapter hash/`edarun` wrapper）、一个 vendor fixture、一个 SAED14 representative、一个 TSMC28 representative、Campaign private `workspaceRoot`。执行顺序严格为：Permit/root/wrapper identity → runtime identity → source hash → read → `name`/units/cell/pin/arc/table query → workspace copy write → copy re-read → invariant compare → source hash unchanged。

输出为每输入一条 `QualificationResult`：`passed` 或 `blocked`，含 input hash、producer identity、每一步 status、exit code/signal、log hash 和 source-after hash。错误顺序：Permit/path/wrapper 拒绝先于启动；runtime/build mismatch 先于 parse；任何 `exit 139`/signal/identity/query/copy invariant failure 立即 `blocked`，不得开始 corpus；原件 hash 改变是 `hima/library-source-mutated` 且停止。E1 不返回 partial facts。

### E2 facts and delta

输入是 `baselineLibrarySet`/`candidateLibrarySet` manifests（每 plain source 有 role、expected SHA-256、family/corner/view identity）、可选 `designEvidence`、已通过 E1 的 runtime、`analysisPolicy` 与 private `workspaceRoot`。每个 source 在独立 worker 中解析，SWIG object 不跨进程。成功 record 的最低形状：

| 字段组 | 最低类型合同 |
| --- | --- |
| identity | schema `hima-library-facts/1`；source path/sha256/bytes/role；producer apiBuild/python/adapterSha256 |
| library | name、显式单位表、PVT/operating-condition身份和可用性；缺失与实际零值分开 |
| cells | 稳定cell身份、function/drive/VT/family、area及单位、pin引用；未知属性给原因而非猜值 |
| pins/arcs | pin名称/方向；arc的related pin、输出pin、type、sense、when及原source定位 |
| tables | model/template身份、axes变量/单位/索引、shape、有限values或带hash的sidecar引用；缺表不补0 |
| findings/unknowns | finding稳定身份、派生依据、可用性和警告；未知数据不参与有效delta |


每个事实/finding 还必须有 `derivationLevel` (`explicit|derived|inferred`)、`sourceDomain` (`Liberty|design|STA|SPICE|physical|silicon`) 与 `evidenceStatus` (`available|unknown|ambiguous|contradicted|corroborated`)。大 table 可放 content-addressed sidecar，但主 record 保存 sidecar hash、shape/statistics，绝不保存未绑定路径。

失败 worker 是完整结果：输入 hash、exit/signal、log hash、`facts: none`；reader 先验证 manifest complete accounting、source/producer/sidecar hashes 和 corner/view alignment，再允许 delta。缺输入、hash 不符、重复/不相容 identity、partial output、unknown 被归零任一项都 fail closed。`designEvidence` 缺失时仍可产生 Library-only facts/delta，但 `design-impact` 为不可计算，不能推断。

### E3 report payload

E3 producer 输出与 S08 约定的 `hima-library-insight-report/1` `LibraryInsightReportView`。额外约束：每 finding 保留 `librarySeverity` 与 `designRelevance` 两轴、report source record/hash/version、conditions、unknowns/provenance、完整 finding set 和排序原因。`designRelevance:'none'` 仅表示当前 design 未见采用/影响，不是 Library PASS。报告写入新 version/ref；不覆盖先前 report 或 E2 facts。消费顺序：identity/hash → report schema → filter binding → finding provenance。filter 是已有 payload 的只读 slice；需新 tool compute 时创建一个新受控 version，说明范围、预算与进度。

### E4 rule/algorithm/proposal

输入是 versioned Pack rule/reader/Python algorithm identity、typed input facts/report refs、policy/budget/Permit、private workspace。输出是 typed analysis result 和 `proposal`：规则/脚本 hash、输入/输出 refs、unknowns、范围、建议的独立验证与写入边界。顺序：schema → input hash/provenance → Permit/wrapper/budget → compute → output validation → archive/proposal。无权限、超预算、schema/hash failure 都在工具启动或输出采纳前拒绝；proposal 不是写入授权。默认禁止修改 golden/baseline/candidate Library、PDK、API、系统 Python、License、已发布 Pack、Harness、判据。

## User Stories

1. **E1-01** Library 工程师启动 qualification，先得到每个 fixture/source 的 runtime、adapter、source hash 和逐步结果；没有任何 corpus scan。
2. **E1-02** `lib.name` 发生 exit 139 时，工程师看到 blocked evidence、signal/log hash 与未分析输入；系统没有半份 cell facts 或“已完成”报告。
3. **E2-01** 工程师比较同 family 的 baseline/candidate，得到 Cell/pin/arc/table/unit/corner/view delta，能回到每源文件 hash。
4. **E2-02** 一个 Library source 丢字段、sidecar hash 不符或 worker crash，reader 明确拒绝 complete corpus；它不会将 missing 当 zero 或忽略该文件。
5. **E2-03** 工程师只提供 Library，不提供 design evidence，仍得到 Library health/performance facts，并明确看到 design impact 不可计算。
6. **E3-01** 工程师在同一 report 中查看库健康、库性能和设计影响，top finding 同时保留 library severity 与 design relevance。
7. **E3-02** 工程师改变已加载的 corner/load/filter，立即得到切片结果且不调用模型/EDA；需要新计算时看到范围、预算、进度和新 report version。
8. **E3-03** 高严重度但当前 design 未采用的 cell 仍在报告中，且不会被标记为 PASS 或挤掉有 endpoint 证据的 finding。
9. **E4-01** 方法作者用客户 Python rule 分析已冻结 facts，输出带脚本/输入 hash 的 proposal 和建议验证，而不是隐式改 Library。
10. **E4-02** Site Permit 不允许 wrapper/read root/write root 时，方法在启动前被拒绝；现有 Library、Pack、License 和 PDK 保持不变。

## Implementation Decisions

### E1: qualification remains a gate

- 当前只保存/维护 blocked qualification specification 和 fixture contract；不创建声称 API 可用的 worker、Pack UI 或 batch corpus job。
- 解除门后，第一提交仅实现 isolated qualification，不与 E2/E3/E4 或 UI 混合。每 input 都 read/query/copy/re-read；copy 只在 Campaign workspace，source SHA-256 前后相同。
- 厂商包/环境变更必须记录 API build、Python、adapter hash、wrapper identity 和命令头。不能改 `edarun`、系统 Python、QuaLib/API install 或 license service 来使测试“通过”。

### E2: Pack-local facts

- E1 通过后创建 `packs/library-intelligence/`，包含 `INTENT.md`、`SPEC.md`、`FABRIC.md`、`TEST.md`、`contract.yml`、`graph.yml`、`semantics.yml`、`tools/libapi_worker.py`、`tools/stages.py`、`tools/read_stage.py`、`readers/`、`rules/`、`knowledge/`。这些是新业务 Pack，不是新 Harness runtime。
- graph 固定 `bind-inputs → qualify-api → index-baseline/index-candidate → read-indexes → semantic-delta → join-design-impact → triage → targeted-check → final-judge → archive`。`targeted-check` 首切片仅 read-only replay/query 或 workspace copy；不写 inputs。
- source original、design evidence 与 explicit result 是 authority；index/cache 是 hash-bound/rebuildable。Campaign Agent 可以在 Pack ranking bounds 内解释/选择 investigation，不能制造数值或 PASS/FAIL。

### E3: reports, no new UI shell

- E3新增Pack-local typed report producer（必要时 `packs/library-intelligence/tools/report_stage.py`），消费者为S08/D2的renderer和Host只读投影。S11不写client renderer、HimaWorkbench或导航。
- 三类 report 共享 finding identity/provenance，而不是各自复制 facts。表/图是 payload projection；click-through 回 source record/sidecar, never edits them.
- Data Insight is read-only during filtering. 新计算走现有 Run/Job、budget、Permit 与 new report ref；S11 不触碰 `fabric.ts`/`tools.ts`/`ledger.ts`/`remote.ts`/`index.ts` 以绕开控制面。

### E4: customer method at the Pack boundary

- 客户算法作为明确 versioned Pack tool/rule，由 contract 声明其 typed input/output、可读 roots、wrapper、workspace write root、budget 和 verification proposal schema。
- E4 可保存一个 analysis method/ref 和 proposal evidence；发布 Pack/规则变化仍走 G1/G2/G3 的作者、测试、候选和回滚流程。它不现场修改 shared/installed Pack 或 product code。

## Executable slices, dependencies and parallel ownership

| 切片 | 交付与文件所有权 | 依赖 | 并行关系 | 最低验证 |
| --- | --- | --- | --- | --- |
| S11-E1A | qualification fixture contract、blocked evidence record、Site profile/Permit review；`packs/library-intelligence/` 尚不创建可用 parser | 离线合同无前置；真实执行仍等厂商包/说明或新授权诊断 | 可与 E3 fixture schema、E4 typed-I/O design 并行 | L0 schema + L2 Permit refusal fixture；真实 L4 被阻塞 |
| S11-E1B | 解除门后 isolated `libapi_worker.py` qualification 和 `sites/linglong-library/` example | E1A 与真实 vendor runtime | E2/E3 real data 必须等此通过 | L2 local contract + 一次只读 L4 |
| S11-E2A | Pack manifest/facts/delta/readers fixtures、reader/hash/accounting logic | E1B 对真数据；可先 synthetic fixtures | 与 S08/D1/D2、E3 report schema 并行 | L1 facts/delta failures + L2 `checkPack` |
| S11-E3A | frozen report payload + Pack-local producer/fixture; S08 consumes but does not own producer | E2 schema; real report waits E1/E2 | 可与 S08 renderer 并行 | L1 projection/filter invariant + L2 read identity |
| S11-E4A | versioned rule/algorithm/proposal contract + fixtures | E2 payload schema; G2 failure templates | 可与 E3A、S08 并行 | L1 typed I/O + L2 Permit/budget refusal |
| S11-E4B | selected customer algorithm after explicit Pack method acceptance | E4A and user-approved method scope | 不能与 shared Pack release wiring 同写 | L2 local method; L4 only when actual tool changes |

主集成者是 `index.ts`、`remote.ts`、`tools.ts`、`fabric.ts`、`ledger.ts` 的唯一 owner。S11 不改共享 UI；S08 独占 `HimaWorkbench` 与 Workbench visual wiring。S11交付payload、Pack-local producer和fixture，供 S08/D2 按合同消费。

## Testing Decisions

用户确认以现有 Host/Fabric 接口夹具和关键 UI 为主，模型/EDA 单列。本规格不运行命令。实现时相关源码构建后先执行最低反证：

| 层级 | 覆盖 | 既有路径/命令 |
| --- | --- | --- |
| L0 | Pack schema、types、seams/boundary | `pnpm run typecheck`; `pnpm run check:seams`; `pnpm run check:boundary` |
| L1 | manifest alignment、facts serialization、unknown/hash/sidecar/delta/ranking、E4 typed I/O | 新 `test/contract/library-intelligence-pack.test.ts` 的无 vendor fixture 部分；独立 expected values |
| L2 | `loadPack`/`checkPack`、Site Permit、tool argv、workspace isolation、worker failure evidence、report route | `test/contract/pack-readers.host.test.ts`, `test/contract/custom-cell-fmax-pack.test.ts`, `test/contract/lfr-cumulative-library.test.ts` 可作模式；新增精确 Library contract file；`pnpm run test:local --files test/contract/pack-readers.host.test.ts test/contract/site-surface.host.test.ts` |
| L3 | D1/S08 Workbench 中一条 report selection/filter/provenance/key narrow view | 由 S08 负责 `window.test.ts`/`campaign-refresh.desktop.test.ts` 等精确 desktop 子集 |
| L4 | E1 vendor fixture + SAED14 + TSMC28 read/query/copy/re-read；原件 hash invariant | 仅 E1B 后在 `linglong` 只读运行；不可由 L0-L3 替代 |

真实模型、完整 corpus、STA/ECO、商业 EDA 和 L5 pilot 不是 E2/E3 fixture PASS 的推论。E1 仍 blocked 时，L4 标为未运行/blocked，绝不写 PASS。

## Acceptance examples

| 正例 | 能推翻实现的反例 |
| --- | --- |
| E1 对 fixture、SAED14、TSMC28 每项完成 read/name/units/cell/pin/arc/table/copy/re-read；source hash 不变。 | `lib.name` exit 139 后仍启动 corpus、写 facts 或显示 complete。 |
| 同 source hash + producer identity 产生稳定 record hash；每 manifest source 在 reader accounting 中恰好一次。 | 一份 worker 失败/sidecar hash 错仍显示完整 totals，或 unknown 被转为 0。 |
| 同 family/corner/view 的 arc delta 与 worst endpoint slew/load evidence 被报告并能回到 source hash。 | 不相容 corner/view 的同名 arc 被对齐，或 UI 显示无 provenance 的数值。 |
| 无 design evidence 时显示 Library-only report 和 design impact unavailable。 | 系统编造 instance/path relevance 或将 Library finding 标 PASS。 |
| 已加载 filter 只 slice payload；需要计算时新建带 scope/budget 的 report version。 | filter 调模型/EDA，或覆盖旧 report/facts。 |
| E4 proposal 包含 rule hash、input/output refs 和独立验证建议，所有 output 在 private workspace。 | E4 改 golden Liberty/PDK/API/license/已发布 Pack，或把 proposal 当 release。 |

## Qualification blockers

1. **当前硬阻塞：** native Liberty API `lib.name` qualification exit 139。解除路径只有厂商提供 AlmaLinux 8 + Python 3.7 可通过 `testParser.py` 的包/精确环境，或用户重新授权有界 `_tmlib.so` ABI/runtime 诊断。
2. 在 E1 未通过前，E2 真 facts、E3 真报告、E4 真算法输入和任何批量 corpus/真实 UI 验收全部 blocked；可进行无副作用的合同、fixture、导航和 renderer 研究，必须标为 synthetic/unavailable。
3. `linglong-library` 的 read roots、wrapper、license 与 Campaign write root 必须由 Site owner 的 Permit 明确批准；不得复用或放宽现有 `linglong`。
4. 设计影响还需 hash-bound top/netlist/timing/constraints evidence；缺失只阻塞该维度，不能阻塞/伪造 Library-only 结论。

## Rollback

E1：撤回独立 qualification Pack/site-example commit；不修改 vendor installation、system Python、`edarun`、license 或 sources。E2/E3/E4：每个 Pack/fixture/rule commit 可独立回滚；可重建的cache与必须保留证据分别标明，回滚不清理用户工作区；不删除 original source、recorded evidence 或旧 report version。若任何共享 route/projection 最终确有必要，由主集成者在单独兼容 commit 接线并可单独回退；不迁移 Ledger schema，除非另有批准的 ADR/迁移规格。

## Model allocation

Pack contract、fixture、普通实现和集成：`gpt-5.6-terra / medium`。native API qualification、evidence/provenance integrity、source mutation 与 candidate write boundary的独立关键复核：`gpt-5.6-sol / high`。E1 crash 不因重试次数而升级；先保存最小失败证据并等待解除条件。`gpt-6-astra` 仅在用户明确允许产品/架构扩张或已证实现有 Pack/Reader/Channel 无法承载时使用。

## Out of Scope

- 调试 `_tmlib.so`、安装/替换 vendor API、修改 `edarun`、系统 Python、QuaLib/XTop、License 服务；
- 修改 baseline/candidate/golden Library、PDK 或客户 design，或批量扫描 933 个文件；
- 新数据库、通用 analysis runtime、第二 remote execution/control plane、另一套 Workbench/UI framework；
- 由模型生成未经 facts 支持的数值、PASS/FAIL 或 release decision；
- S08 的 Workbench tab/navigation/renderer wiring、C1/C3 child lifecycle、G 系列发布流程的实现。

## Further Notes

Library severity 与 design relevance 必须并列保存和展示；dependency evidence 不自动成为 causal claim，只有匹配 intervention/counterfactual 才能升级。E1/E2/E3/E4 的完成证据必须分别记录实际模型/Effort、命令、source/build hash、Pass/Fail/Skip/Not-run 和真实依赖边界。规格完备不等于 API 合格、真实 Library 可分析或客户价值已验证。
