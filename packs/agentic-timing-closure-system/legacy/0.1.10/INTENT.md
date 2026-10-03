## Business

用户是负责 SWERV28（`swerv_wrapper_tsmc28`）物理设计方法学的团队：在冻结的功能意图与项目时序条件下，从一个可恢复的 Innovus 只读 checkpoint 出发，尽早取得 setup/hold 共同闭合，同时保持结果可交付、可恢复、与最终证据一致。运行起点是 Innovus；不修改 RTL、不执行逻辑综合。

主对照是 **B_lazy**：既有的 `xtop-timing-closure` Pack（AI 接管既定人工流程、使用知识反馈并重复 fix 的 lazy agentic migration）。本 Pack 的业务结果是：用协作累积的并行 ECO 研究 + Contribution 合并 + 一次联合物理实现/验证，取代 B_lazy 的单一 Agent 线性重复 fix，在同一设计、同一 Site、同一口径下比 B_lazy 更早拿到合格数据库，或者如实报告为何做不到。方法核心：Operator 在工具中研究与试改，独立 workspace 产生互补的 ECO Contribution；共同 Integration Fix Session 合并、局部修订并统一导出；多个成果共享必要的实际实现及新 RC/STA。

**探索的对象**：多个独立 workspace 各自研究并试改一组 timing checks（可以是共享 driver 的 setup/hold 窗口、某个区域的 fanout/SI 等耦合问题），产出带 base/state-out、确定操作、脚本与实际效果证据的 ECO Contribution。

**测量的对象**：`tc_*` 系列 typed value（详见 SPEC.md 的 Semantics 章节），其来源分别是输入核验、请求校验、Contribution 重放/组合分析、PT/XTop 预演、最终 PrimeTime STA 与身份核验、物理 DRC/connectivity 检查、以及 `next-decision` 产物。closure 的联合判据是 `tc_final_setup_wns_ns >= 0.0` 且 `tc_final_hold_wns_ns >= 0.0`，在固定合格 PBA 口径、全部必要 checks 覆盖、身份核验通过、必需约束通过之后才成立。

**结束的方式**：timing closure（goal-met）、缺输入/能力（wait）、当前允许范围内无值得继续动作（`tc_stop_required=1` 到 wait）、预算耗尽（Runtime 已有 budget ending）、用户暂停/取消。任何一种结束都不等同于整芯 signoff 或 tapeout-ready；预算耗尽不叫 converged 或 clean。

**人不应猜测的地方**：`auto` 的范围判定结果（full-flow 还是 post-route-only，以及缺项列表）；一次 Contribution 是否已经被真正采用（必须来自数据库对象关系，不能靠命名匹配）；一次 nextDecision 的 `action` 编码含义；封批是否等待了全部 worker（不是）；工作态与最佳态哪个是可交付的（`bestVerifiedState`，不是 `workingState`）。

**source-linked 反例**（继承自 B_lazy 已跑通的同一 Foundation Flow 与 Run 证据，供后续 Reader/Rule 测试使用，见 Golden Flow 一节）：
- 真零 vs 缺值：B_lazy Run `run-ddabd488-f05c-44d6-9c9b-45abccaff226` 的 `endpointDelta` 报告 `missing: 6`——六个端点身份在新报告中消失而非被修复；这必须落在 `tc_missing_prior_check_count`/`tc_fixed_check_count` 的“消失不计 fixed”规则下，不能被读成 `tc_fixed_check_count += 6`。
- 覆盖度截断：Foundation 旧 connectivity 报告在 1,000 条处截断；同一 J3 对照实验里可比的完整物理报告（DRC 72,799、connectivity 3,465）来自 control arm（人工/既定流程，workspace `qualification-v109-20260924-1535`），不是 B_lazy 自身 Run 的字段——两份报告的分母不同、且不能把 control arm 的物理数字直接当成 B_lazy 的物理证据；这是 `tc_applicable_constraint_unknown_count`（约束证据不充分）必须能识别并拒绝的截断/来源错配输入，不是 `tc_final_identity_error_count`。
- 同名不同状态：`closed.enc` 文件名里的 “closed” 不代表 timing clean（该 Run 的历史终态是 `ended-budget-exhausted`），这是 `tc_accepted_artifact_ready` 不能只按文件是否存在判定为 1 的直接反例。
- 有利舍入风险：−0.04 ns 这个数出现在两处不同证据里——Foundation Flow 自己的两轮 ECO 历史（第二轮回灌后报告 SSG −40 setup 约 −0.04 ns，该角 setup 数量 43→12，见 Golden Flow 一节的 §8 引用）；以及 B_lazy Run 自己一次 generation 的 setup 结果（`run-ddabd488-...` 该 generation 前后均为 −0.04 ns/12 违例，未在这次 generation 内改变）。两者都足够接近 0，是 Reader/Chooser 不能因为“接近 0”就向达标方向舍入、也不能把两个不同来源的相同数字误读成一次连续观察的直接反例。

**输入/反馈/预算边界**：输入身份是 `designStateManifest`（top、stage、可恢复 Innovus 状态、匹配的 netlist/physical/约束引用，可选完整流程资料索引）、`analysisContract`（必需 scenario/check、库与 RC 映射、时钟/SDC 权威、最终 PBA/覆盖方法、Goal/必要约束）、`siteCapabilities`（真实工具、qualified Operator、wrapper、阶段能力、预算/资源绑定）与 `workspaceRoot`。反馈是每个 workspace 的重放/预验证/物理结果与 `campaignExperience`；不线性相加多个分支的收益。预算是 Site 提供的有限、可见默认额度，用户可覆盖，Agent 不得自行提高硬上限；主任务与 child 不得重复扩大。

## Golden Flow

Golden Flow 是已验证的 SWERV28 Foundation Flow，权威参考根：

```
/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation
```

输入副本 `/data/eda/project/design_zoo/flows/swerv_wrapper_tsmc28/input`；技术根 `/data/eda/project/techlib/tsmc28`；两者只读。本地研究镜像 `/Users/lluzi/Documents/linglong setup/a53_foundation`（首次输入 `/home/luzi/Downloads/a53` 仅用于追溯）。它证明了两轮完整的 PT-to-XTop-to-Innovus-to-StarRC-to-PT，是方法证据，不是客户结果模板；不复制其任何文件进 Pack。

在这条 Flow 上读到的精确状态链（`EDA_SERVER_TOOLS_AND_EVIDENCE_GUIDE.zh-CN.md` §8，路径均相对 Foundation 根）：

| 状态 | Innovus DB | 对应测量/产物 |
|---|---|---|
| 初始 post-route | `DBS/postroute_final.enc` 及 `.enc.dat` | `EXPORT/swerv_wrapper.postroute.{def,v,sdc}`、`SIGNOFF/STARRC`、`SIGNOFF/PT` |
| 第一轮 XTop 回灌 | `DBS/xtop_eco_route.enc` 及 `.enc.dat` | `EXPORT/swerv_wrapper.xtop_eco_route.{def,v}` |
| 第一轮回灌后的新 RC/PT、第二次 fix | 使用上一行物理结果 | `SIGNOFF/ROUND2/STARRC`、`PT`、`XTOP/runs/20260921-162830` |
| 第二轮 XTop 回灌及刷新 | `DBS/xtop_round2_eco_route.enc` 及 `.enc.dat` | `EXPORT/swerv_wrapper.xtop_round2_eco_route.{def,v}`、`SIGNOFF/ROUND3/STARRC`、`PT` |

读到的历史残余（同一份 §8 证据，用作本 Pack 的起点风险与反例基准）：`init/place/cts/postcts_hold/route/postroute/postroute_final` 等 checkpoint 路径存在（文件存在证据，不等于已测过恢复，也不能据此认定新 Pack 的全流程输入合同完整）；第二轮回灌后 SSG −40 setup 仍约 −0.04 ns，hold 约 −0.16 ns，该角 setup 数量 43→12、hold 数量 280→52；四个必需 scenario（`func_ssg_rcworst_m40`、`func_ssg_rcworst_125`、`func_ffg_cbest_m40`、`func_ffg_cbest_125`）各保留 3 个 unconstrained endpoints；增量 route DRC/antenna 为 0，但全芯 DRC 72,799 为既有问题（不纳入本 Pack 的整改目标），旧 connectivity 报告在 1,000 条处截断。

## Answers

1. Timing closure 范围：只负责 timing closure，不承担输入设计已有其他物理问题的全面整改；不等同整芯 signoff。
2. 资源换时间：预设容量/成本硬上限内优先最早合格交付时间，资源成本单独报告，不冒称方法智能收益。
3. 自主变更范围：RTL 冻结、起点 Innovus，不涉及 RTL 修改或逻辑综合；此回答本身不决定等价网表变换与 PG 调整的具体权限，两者分别留给 Q6、Q7 和 Q11 回答。
4. 非单调探索：允许有明确后续机制、退化限度与截止点的暂时退化状态作为继续工作起点，同时独立保留最佳已验证状态。
5. 最终分析口径：选 B，采用预先固定且覆盖合格的 PBA 口径判定 closure，不额外要求 GBA 同时 clean。
6. 等价网表变换：选 A，RTL 冻结不禁止 Innovus 内保持功能等价的门级实现变换；不修改 RTL、不跑综合。
7. PG 作为 timing 手段：允许为 timing 局部调整 PG，但不把既有 PG 问题的全面整改列为目标；具体执行/验证条件由 Q11 确定。
8. 可恢复输入合同：选 B，由数据本身识别/确定支持的范围；没有全流程资料时不能假定具备早期 checkpoint，也不能自行重建，走 post-route 按需 fix。
9. 模式选择：选 auto，自动识别当前确定的产品行为，不把其余建议选项默认视为已批必做项。
10. 部分阶段资料：选 A，全流程数据齐全才开放生命周期干预，否则 post-route-only；不开放部分阶段回退。
11. PG 修改自主范围：选 A，事先约定范围与必要验证能力具备时 Agent 可自主实施/验证/采用；能力不足只限制该动作，不阻断其他 timing 修复。
12. 何时转 APR：选 B，全流程模式下不必穷尽局部 ECO，有证据支持更早阶段干预能缩短总闭合时间时可直接转向该阶段。
13. 默认预算来源：选 B，Site 提供有限、可见的默认预算，用户可覆盖；Agent 自主调配但不提高硬上限。
14. 贡献何时封批：选 B，按等待价值、贡献依赖和联合验证成本动态封批，不强制等待所有 worker 结束，也不机械先完成先实施。

## Ambiguities resolved

以下 ADR 编号均指 campaign 文档自己的 ADR 目录
（`/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/docs/adr/000{2,3,5}-*.md`），
不是本仓库 `docs/adr/0002`–`0005`（无关文档）。

- 同步封批 vs 动态封批：早期草稿倾向等所有 worker 完成才集成实施；一致性检查与 Q14 最终确定按等待价值、依赖与联合验证成本动态封批，不以全部 worker 结束为前提（campaign ADR-0005）。
- working/best 分离缺失：早期草稿未明确区分“继续工作的状态”与“最佳已验证状态”；Q4 与一致性检查确认三个指针 `workingState`/`bestVerifiedState`/`deliveryState` 独立记账，非单调探索不得覆盖最佳已验证状态（campaign ADR-0003）。
- 局部 ECO 耗尽才转 APR vs 按时间证据提前转 APR：旧建议要求穷尽 local ECO 才能转早期 APR 阶段；一致性检查与 Q12 最终确定证据支持更早阶段能缩短总时间时可直接转，不必穷尽 local ECO（campaign ADR-0005）。
- 旧 ADR 把网表/PG 权限列为待定 vs 已决：此前 ADR 草稿仍把功能等价网表变换与 PG 局部调整标为待确认；Q6/Q7/Q11 已经把两者转为已确认的自主范围——在约定范围与必要验证能力具备时（campaign ADR-0002）。
- 修 Runtime 建议 vs 固定 Harness 策略：早期文档曾建议在 Runtime 补充控制逻辑以支持动态封批等行为；一致性检查确认 Harness 源码保持不变，业务判断只放在 Pack，未验证的执行形状要在开发测试中证明，不靠额外后台控制器补齐。

## Knowledge applied

- `over-constrain-and-read-the-violation.md`：把 `target_setup_wns_ns`/`target_hold_wns_ns` 固定为 0.0 ns 的硬阈值语句而非可迁就候选的目标；禁止借“无负 slack”结论倒推正 margin，下一步试探只依据当前实测 slack 与未测假设，不允许对 zero-slack 通过的一次尝试再加保护带。
- `end-honestly-in-more-than-one-way.md`：排除把 generation limit 当作闭合结论；要求 Endings 的每一种情况（timing closure、缺输入/能力、当前范围内无值得继续动作、预算耗尽、用户暂停/取消）都绑定可检测的 typed value 与既有 Harness 路径，`continue-or-wait` 必须有面向 wait 的真实失败出口。
- `assert-the-checker-options.md`：要求验证类 value（`tc_unqualified_rc_net_count`、`tc_applicable_constraint_failure_count`/`tc_applicable_constraint_unknown_count` 等）绑定明确的检查版本与选项状态；证据覆盖不足归 unknown，不能默认按通过处理。
- `one-checker-per-session.md`：让 XTop、PrimeTime、Innovus、StarRC 及供电检查各自对应一个 Tool 职责/一个 act node，各自产出独立命名的 typed value；不把不同验证工具的计数合并成一个不知来源的总数。
- `attribute-by-database-relation.md`：让 Contribution 的 `delta`/`touches` 与 MergeCommit 的 `sourceMap` 必须来自实际数据库对象关系（instance→master、operations trace），不能靠命名匹配断定某处修改已被采用；查询失败是 blocker，不静默退回 grep。
- `what-a-golden-flow-is.md`：让 Golden Flow（上面的 Foundation Flow）保持外部只读参考——本记录只写指针和读到的内容，不复制 Foundation 根下任何文件进 Pack；架构与研究自由度以此为界，不要求机械复制这条参考流程的具体路线。
