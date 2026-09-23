# S07 — 以代际差异驱动下一轮研究

覆盖：NXT-H1（保留已合入 H2 的具体策略/Cell Demand 要求）。基线：`1a79cb1`。状态：规格可派工，不承诺研究正收益。

## Problem Statement

工程师需要知道一次试验到底改变了哪些 endpoint、为什么下一代选了不同策略。只看 WNS/TNS、候选数量或模型措辞，会把换名/重复尝试误认为自主改进。

## Solution

升级既有两个 Pack 的研究输入和反馈展示，保留原 frontier/demand 分母，把测量→局部变化→判断→具体下一行动连接起来。沿用现有研究 schema、Workshop、analyze 和报告，不建研究调度引擎。

## User Stories

1. 作为研究工程师，我希望每代看到原目标集合和当前覆盖，从而知道收益是否只是统计范围改变。
2. 作为时序工程师，我希望看到 fixed/remaining/entrant/regressed，从而追踪具体 endpoint。
3. 作为研究工程师，我希望下一策略引用失败的 arc/endpoint，从而避免泛泛增加函数。
4. 作为库工程师，我希望 Cell Demand 含 pins、函数、真值表与条件化 delay 目标，从而交给生成平台。
5. 作为研究工程师，我希望 sizing/stack/topology 变化可与纯重命名区分，从而衡量创新。
6. 作为工程师，我希望缺字段明确报错，从而不会让缺失数据变成零收益或零违规。
7. 作为工程师，我希望反馈未改变选择时有解释，从而能检查反馈是否被忽略。
8. 作为工程师，我希望失败和不采用方案仍保留，从而以后不重复踩坑。
9. 作为工程师，我希望长报告完整校验后再投影到小上下文，从而 compact 不丢关键反例。
10. 作为用户，我希望界面能从一句变化摘要下钻到代码/报告，从而复核改进依据。

## Implementation Decisions

### 当前证据与文件归属

| 文件 / 符号 | 已有能力与最小增量 |
| --- | --- |
| `packs/custom-cell-fmax-dtco/flow/ai_research_runner.py` / `_compact_candidate_pool`, `build_residual_research_context`, `load_residual_research_context`, `execute_candidate_program`, `validate_residual_research_proposal` | 已有 typed candidate、商业响应、完整校验后有界投影；复用这些合同，补跨代对照字段/缺失反例，禁止另造第二候选模型 |
| `packs/custom-cell-fmax-dtco/flow/library_richness.py` / `derive_cell_demands` | 已有 Demand；验证实际 pins/function/truth tables 与生成实现对应，扩展缺少的条件化目标和反馈出处 |
| `packs/custom-cell-fmax-dtco/flow/read-stage.py` / `read_residual_ai_research`，`readers/read-ai-research-selection.yml` | 保持 Reader/unit/schema 一致，新字段必须经读回验证 |
| `packs/xtop-timing-closure/flow/closure.py` / `compare`, `validate_plan` | 已产四类 endpoint delta 与 experience；补 coverage/历史集合/plan行动对应，保留所有快照 |
| `packages/harness/src/generations.ts`、`experience-report.ts`、`remote.ts` 的代际投影 | 通用层只展示 Pack 已证明的变化与证据；新增字段按现有 observation/analysis 投影 |
| `packages/harness/src/fabric.ts` / analyze；`workshop.ts` 的输入/知识读取 | 保留来源校验；仅缺通用表达时由集成者增量接线，不能赋予模型 verdict 写权 |

### 输入、输出与失败行为

- 输入：固定方法/输入身份、原 frontier 或 Demand 集合及 hash、前后代测量与条件、覆盖集合、代码/参数/Cell identity、原候选池及商业反馈引用。
- 输出：代际对照（原分母、已覆盖、缺失）、四类 endpoint delta、测量变化、可区分的策略差异、下一步行动及证据。endpoint 从报告消失若不是明确覆盖下的修复，不记 fixed；需保留 missing/unmeasured。
- 比较只在设计/约束/角/单位/目标集合可比时给数值；不兼容时报告不可比原因。global PPA 与局部代理分开，代理继续没有决策权。
- Cell Demand 复用既有合同中的输入/输出有序 pin、Boolean function 和真值表身份；delay recommendation 必须附 arc、slew/load/corner 或说明未知。关联商业失败、生成版本和 meet/miss/unknown；meet 不等于全局收益保证。
- 下一行动明确作用对象、改变的 sizing/topology/函数/算法、预计作用、廉价验证和停止条件。无新假设时可结束并说明；不能为完成反馈字段虚构创新。
- 大报告先完整读取/校验再做有界投影，保留原 bytes/hash。沿用已有 compact 修正，不恢复此前的截断读取问题。

### 子切片与并行

S07a 冻结候选池/商业响应正反 fixture，并做无需模型的反馈 A/B；S07b 对两个 Pack 的输出/Reader/研究模板逐项修缺口；S07c 接通用代际摘要给 S08。DTCO 与 XTop 可以分别开发；XTop `closure.py` 等 S03b 合入后由同一 Pack owner 追加。S05 负责跨任务经验检索/停用，本规格不写其存储。真实研究 A/B 在低层门通过且另行授权后运行。

## Testing Decisions

主 seam 为 Pack 的 research context/program/Reader 输出与现有 Host analyze，不检测固定文案或模型隐藏思维。先复用 `packs/custom-cell-fmax-dtco/flow/domain/tests/test_ai_residual_research_context.py`、`test_residual_research_document_contract.py`、`test_residual_research_reader_round_trip.py`、`test_cell_demand_coverage_pct_unit.py` 和 XTop `flow/tests/test_closure.py`。

正例：只改变商业反馈，选择/下一行动产生有证据解释的差异，或者记录不变原因；原池/预算相同。反例：删缺失值、只重命名cell、报告删endpoint、替换corner、重复历史、反馈出处过期均不能算改进。

实现后：`pnpm run build`；`pnpm run test:local --files test/contract/aes-timing-research-reader.test.ts test/contract/research-analysis.host.test.ts test/contract/xtop-timing-closure.test.ts`；`python3 -m unittest discover -s packs/custom-cell-fmax-dtco/flow/domain/tests -p 'test_ai_residual_research_context.py'`。补 fixture 时运行受影响同目录测试，不全扫商业flow。机制 A/B 不冒充真实 DeepSeek A/B，更不等于 PPA 收益。

## Out of Scope

重做Mock Liberty、强制每代换策略、修改商业工具判据、自动更新活动Pack、将代理升级为裁决者、开启新Campaign取得漂亮结果。

## Further Notes

现有通过合同优先保留，新缺口先最小反例；Pack字节变化新版本，旧Run原方法不漂移。保留前后报告和输入身份回滚。Terra/Medium实施；跨代证据真实性Sol/High复核。输出字段消费方是现有研究模板、Reader、S08代际视图和S05条件化经验。
