# XTop Timing Closure Pack 1.0.0

状态：**compiled / development**。本次完成 Pack 封装、Site 绑定、数据合同和低成本测试；没有启动新的商业 EDA Campaign，因此未写 `TEST.md` 或发布 seal。

## 业务边界

- 输入：只读 Innovus `.enc.dat` checkpoint 及其 restore script。
- 输出：Campaign 内经过完整回灌、重新提取和重新 STA 后选出的 best Innovus checkpoint。
- 目标：把 setup/hold 推进到目标，或在连续两代的 measured closure score 不再移动时诚实收敛。
- 权威：PrimeTime refreshed STA。XTop post-opt 只是一项待验证预测。
- 资产：每轮 plan、ECO、DB、DEF、netlist、SPEF、PT reports、endpoint delta、成功和失败经验全部保留。

## Fabric 工作图

Pack 位于 [`packs/xtop-timing-closure`](../../packs/xtop-timing-closure)。28 个节点把工具边界显式放在 Fabric 中：

```text
prepare
  -> Innovus export
  -> StarRC extraction
  -> PrimeTime scenarios
  -> endpoint state
  -> AI plan-fix Workshop
  -> XTop fix
  -> Innovus loadECO/source/ecoRoute
  -> StarRC extraction
  -> PrimeTime scenarios
  -> endpoint compare + retain best DB
  -> Judge evidence/setup/hold
  -> Explore goal/convergence/revisit
```

工具适配器只完成单节点职责。不存在另一个脚本在 Fabric 外串联整轮。

## Endpoint 闭环

endpoint key 是 `scenario | setup-or-hold | path-group | endpoint`。连续两轮分为：

- fixed；
- remaining；
- entrant；
- regressed；
- improved but remaining。

下一轮 Workshop 必须先解释这些集合和上一轮动作，再输出有类型的 fix plan。允许的动作只有 setup/hold 的 size-cell 与 buffer 两类，参数和 margin 有确定边界。Adapter 不接受任意 Tcl。

## SWERV28 绑定

参考 Site 是 [`sites/linglong-swerv28`](../../sites/linglong-swerv28)。当前业务输入绑定到已跑完的第二轮 database：

```text
/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation/DBS/xtop_round2_eco_route.enc.dat
```

Site profile 已部署到：

```text
/data/eda/project/hima_harness/xtop-timing-closure-inputs/swerv28-site-profile.json
```

Foundation Flow 保持只读。Campaign 只写：

```text
/data/eda/project/hima_harness/xtop-timing-closure-runs
```

## 已完成验证

1. 服务器执行 `sha256sum -c docs/SWERV28_AGENT_SOURCE_MANIFEST.sha256`，26 个核心源全部 `OK`。
2. Pack loader 通过：1.0.0，28 nodes，28 edges，authoring stage 为 `compiled`。
3. `checkPack` 对 `linglong-swerv28` 返回 `fit: true`，全部 inputs、wrappers 和 licenses 有绑定。
4. Python 低成本测试 3/3 通过：
   - source/hash 与 checkpoint copy；
   - exact fix-plan contract 和 action whitelist；
   - refreshed PT endpoint fixed/entrant/regressed、experience append 和 best DB materialization。

这些检查证明 Pack 结构、数据合同与局部闭环实现。它们不证明新 Pack 已经通过 HimaHarness 驱动商业工具，也不证明 SWERV28 已经 timing clean。

## 下一验证门

首次真实 Campaign 应先限定为一代，用当前第二轮 checkpoint 作输入，检查：

1. workspace 内 staging 与 DB restore；
2. fresh baseline export/StarRC/PT；
3. Workshop 生成合规、针对 endpoint 的 plan；
4. XTop ECO 和 Innovus 回灌；
5. fresh StarRC/PT 后 endpoint delta 与 best DB；
6. Run 结束语义、experience 和所有产物可复核。

这一门通过后再决定是否写 `TEST.md`、seal 和正式 release。

