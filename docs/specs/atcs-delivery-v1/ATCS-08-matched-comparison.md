# ATCS-08 — 普通 agentic flow 与 ATCS 的 matched comparison

状态：blocked-on-PACK_DELIVERABLE

依赖：ATCS-07

产出：`BENCHMARK_RECORDED`

## 问题

历史 B_lazy Run 是设计依据，不是同口径对照。新的结论必须让 control 和 treatment 在同一个当前
Harness、相同输入和预算上重新运行。

## Charter

运行前冻结：

- Harness/App、模型/effort、design checkpoint、analysis contract、Site/Permit、工具和 license mode；
- setup/hold Goal、required scenarios、报告精度、DRC/connectivity no-new-error 门；
- wall-clock、generation、模型 token、XTop/Innovus/PT/StarRC licence 上限；
- 人类允许的输入和介入规则；
- control Pack id/version/digest 和 ATCS Pack id/version/digest。

Control 使用发布的普通 `xtop-timing-closure` Pack；treatment 使用 ATCS。两者顺序运行，避免共享单
license 资源干扰。运行顺序及冷/热缓存影响写入报告。

## 指标

- accepted database/evidence validity；
- setup/hold WNS、TNS、violation count；
- fixed/remaining/entrant/regressed/missing endpoint；
- time-to-first-qualified-clean，若未 clean 则为固定预算下 best verified frontier；
- full physical refresh count；
- 各工具 licence time、Job 数、Agent/child 数、模型使用；
- 人工介入次数和时长；
- DRC/connectivity normalized delta；
- recovery/duplicate/refusal；
- 经验是否实际改变下一轮 action。

## 判定

1. 先要求两臂结果有效、同源、可比；无效 arm 不产生方法收益结论。
2. 若一臂 clean，报告其首次 clean 时间；两臂 clean 时比较 elapsed/cost。
3. 若均未 clean，只报告同预算 frontier 和成本，不写“更快完成 timing closure”。
4. “ATCS 更好”只在硬约束不劣、至少一个预注册主指标改善时成立，并限定到本 checkpoint/Site/model。
5. inconclusive、negative、blocked 都是有效研究结果，进入 ATCS experience，不改写 Pack release TEST。

## 验收

- 两个 Run 的输入、预算、方法和结果 identities 可独立复核。
- audit 不从文件名、模型总结或跨 arm 不同分母推断成功。
- 报告区分 Harness 集成事实、Pack mechanics、业务结果和普遍性限制。
- 形成一个下一轮方法改进列表；没有最低层证据时不直接修改 Runtime。
