# Innovus 阶段干预接口

## Source

- Innovus Text Command Reference (product version 23.14, updated 2025-02), install
  root `/data/eda/software/eda_tools/cadence/DDI231_ISR4/INNOVUS231/doc/innovusTCR/`
  (read-only on `192.168.50.41`): `setPathGroupOptions.html`, `setAttribute.html`,
  `setUsefulSkewMode.html`, `set_ccopt_property.html`, `specifyCellPad.html`,
  `createPlaceBlockage.html`, `setPlaceMode.html`, `ecoChangeCell.html`,
  `ecoAddRepeater.html`, `ecoDeleteRepeater.html`. T11 `lifecycle.py` additionally
  verified, on the same install root: `place_opt_design.html`, `clock_opt_design.html`,
  `routeDesign.html`, `optDesign.html` (the four stage-running commands), and
  `reportPathGroupOptions.html`, `getUsefulSkewMode.html`, `get_ccopt_property.html`,
  `writeFPlanScript.html` (the readback commands that confirm a compiled hook's
  settings actually applied).
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md`
  （2026-09-26 快照）§8「重新 APR：选择最近的有效起点，并改变产生问题的机制」及其
  「当前 Foundation Flow 的真实接入点」表、「在安装目录核对到的接口」表。
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`
  （2026-09-26 快照）§7.3「Innovus、提取与功能/物理验证 Adapter」。
- 本 Pack `SPEC.md`（`packs/agentic-timing-closure-system/SPEC.md`）Run contract章节，
  `siteCapabilities` 输入行（真实工具、qualified Operator、wrapper、阶段能力）；
  该输入承载 `siteCapabilities.pgVerification` 这类具体能力门（PG 局部调整仅在 Site
  声明该能力时可采用，见 `ACTION_KINDS`/`pg_local_adjust` 的准入条件）。

## Applies when

- T11 `lifecycle.py` compiles a `residual-case` into a stage-specific hook Tcl
  (`compile_intervention`) and a single APR stage task that restores the matching
  earlier checkpoint, runs the stage, and reads back every setting the hook set
  (`stage_task`).
- T7/T12 apply a merged ECO through `ecoChangeCell`/`ecoAddRepeater`/`ecoDeleteRepeater`
  and need to know which flags are safe defaults versus which must be set explicitly.
- Any decision to change net weight, path-group priority, useful-skew borrow limits,
  cell padding, placement blockage or preferred routing layer as part of a stage-level
  intervention rather than a local XTop ECO.

## Changes this decision

All commands below are **documented** — confirmed present with these exact flags in
the vendor TCR page — not **qualified**: none has been run against a real design in
this task; each still needs its own readback/qualification before a Site trusts its
outcome. The gate is this Pack's own `siteCapabilities` input (SPEC.md Run contract):
an intervention that touches PG (power/ground) is admissible only when
`siteCapabilities.pgVerification == true`; lacking that capability restricts only
PG-touching actions, it does not block the rest of this table.

| Intervention | Command (documented) | Flags relevant to this Pack |
|---|---|---|
| Resize an instance | `ecoChangeCell` | `-inst instNames {-upsize \| -downsize \| -cell list_of_cells} [-loc {x y} [-orient {R0\|R90\|R180\|R270\|MX\|MX90\|MY\|MY90}]] [-pinMap old1 new1 ...]` |
| Insert a buffer/inverter pair | `ecoAddRepeater` | `{-net netName \| -term term1 term2 ...} -cell cell1 [cell2] [-loc {x y} \| {x1 y1 x2 y2}] [-name instName] [-newNetName netName] [-noPlace] [-logicalChangeOnly] [-offLoadSlack slack \| -offLoadAtLoc ...] [-radius um]` |
| Delete a buffer/inverter pair | `ecoDeleteRepeater` | `{-inst {list_of_instances} \| -invPair {{inv1 inv2} ...}} [-logicalChangeOnly]` |
| Path-group priority/effort | `setPathGroupOptions` | `pathgroupName [-effortLevel {low\|high}] [-slackAdjustment float] [-early \| -late] [-weight integer] [-targetSlack float] [-skewingSlackConstraint value_in_ns]` |
| Net weight / layer preference | `setAttribute` | `-net netName [-weight integer] [-top_preferred_routing_layer n] [-bottom_preferred_routing_layer n] [-preferred_routing_layer_effort {low\|medium\|high\|hard}] [-non_default_rule rule_name] [-avoid_detour {true\|false}]` |
| Useful-skew borrow limit | `setUsefulSkewMode` | `[-opt_skew_max_allowed_delay delay] [-opt_skew_min_allowed_delay delay] [-opt_skew_delay_pre_cts {true\|false}] [-opt_skew_macro_only {true\|false}]` |
| Clock-tree property (skew/latency target) | `set_ccopt_property` | `name value [-skew_group name \| -clock_tree name \| -clock_tree_source_group name] [-early \| -late] [-rise \| -fall]` |
| Local placement padding | `specifyCellPad` | `leaf_cellName {padding \| [-right p] [-left p] [-top p] [-bottom p]}` |
| Local placement blockage/density | `createPlaceBlockage` | `{-box {x1 y1 x2 y2} \| -inst inst_name} [-type {hard\|soft\|partial\|macroOnly}] [-density value] [-excludeFlops]` |

### Stage-running and readback commands (T11 `lifecycle.py`)

`lifecycle.py`'s `stage_task` also needs two command families this Pack had not
previously verified: the one command per stage that actually runs the stage
(confirmed against the real Foundation Flow scripts, `FF/INNOVUS/run_{place,cts,
route}.tcl`, and this table's own vendor pages), and, for each of the three
intervention kinds above, the read-only command that lets a compiled hook's
readback confirm the setting actually applied — this table previously had no
readback column because none of the three intervention-kind sources above is
itself a report/getter page. Both families are **documented** in the same sense
as the table above: confirmed present with these exact flags, not run against a
real design in this task.

| Purpose | Command (documented) | Flags relevant to this Pack |
|---|---|---|
| Run placement + pre-CTS optimization | `place_opt_design` | `[-out_dir outputDirectory] [-prefix outputFileName] [-expanded_views]` |
| Run clock concurrent optimization (CTS) | `clock_opt_design` | `[-out_dir dirname] [-prefix fileNamePrefix] [-expandedViews]` |
| Run global + detail routing | `routeDesign` | no arguments needed — the vendor page states that, run bare, it performs global and detailed routing |
| Post-route timing optimization | `optDesign` | `-postRoute -setup -hold` |
| Read back path-group settings | `reportPathGroupOptions` | no arguments — reports `pathgroupName`, `effortLevel`, `slackAdjustment` and `targetSlack` for every existing path group (its own example output names Innovus's default `reg2reg` group) |
| Read back a useful-skew mode parameter | `getUsefulSkewMode` | `[parameter_name ...]` — e.g. `-opt_skew_max_allowed_delay`; returns the current `setUsefulSkewMode` setting for the named parameter(s) |
| Read back a CCOpt property | `get_ccopt_property` | `name [-cell ...] [-clock_tree ...] [-skew_group ...] ...` — e.g. `target_skew` for a global property |
| Dump floorplan sections, including placement blockages | `writeFPlanScript` | `-fileName fileName [-sections {... placeBlockages ...}]` |

Note the two per-stage flag-name casings are **not** interchangeable and were
each re-checked against its own page rather than assumed from the other:
`place_opt_design` takes `-expanded_views` (underscored), while `clock_opt_design`
and `optDesign` both take `-expandedViews` (camelCase) — a compiler that copies
one stage's flag spelling onto another stage's command would silently pass an
unrecognized option.

Boundaries confirmed directly in the vendor pages, not inferred from names:

- **`setAttribute -weight` is internally contradictory in the vendor's own text.**
  The parameter description reads "This value is honored by placement and not by the
  router," yet the very next example on the same page describes a weight-4 net being
  routed ahead of lower-weight nets — attributing a router-ordering effect to the same
  option the description just said the router ignores. A compiled intervention that
  relies on net weight to change router behavior must treat this as an open question
  and confirm the effect from a real routing readback, never from the option name or
  either half of the contradictory doc text alone.
- **`-top_preferred_routing_layer`/`-bottom_preferred_routing_layer` are preferences,
  not guarantees.** Setting `-preferred_routing_layer_effort hard` only raises the
  router's internal cost for using non-preferred layers; it does not forbid them
  outright. The actual routed layer must be read back from the post-route
  DEF/DB, never assumed from the setting alone.
- **`ecoChangeCell`/`ecoDeleteRepeater` cannot be used in post-mask ECO;**
  `ecoChangeCell.html` and `ecoDeleteRepeater.html` both say to use
  `loadECO <ecofile> -postMask` instead in that mode. A compiler must branch on the
  declared ECO mode rather than always emitting the same command family.
- **`ecoChangeCell`/`ecoAddRepeater`/`ecoDeleteRepeater` honor `dont_touch`/`FIXED`/
  `dontUse` by default;** overriding any of them requires an explicit
  `setEcoMode -honorDontTouch false` / `-honorFixedStatus false` / `-honorDontUse
  false`, each of which the vendor page separately warns changes protected-object
  semantics. A compiled intervention must not set these globally "to be safe" — each
  override widens the editable domain beyond what a `work-package`'s
  `protected{instances[],nets[]}` may allow.
- **`setUsefulSkewMode -opt_skew_max_allowed_delay` bounds slack *borrowed* between
  neighboring flops, and is not honored in postCTS `skewClock` mode** per its own
  page's note. A stage intervention issued at the wrong stage silently has no effect
  rather than erroring, so the compiled hook must record which stage it targeted and
  the readback must confirm the setting actually applied there.

## Counterexample

`OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md` §8 already flags the `setAttribute
-weight` contradiction as an open engineering question, not a resolved fact. If a
compiled intervention assumes the router obeys net weight (based on the example text)
and uses it as the sole mechanism to prioritize a critical net's routing, the actual
router behavior may instead follow the parameter description (placement-only) and
leave routing priority unaffected. The read-back step (`必须读回的结果` in the same
document's stage-interception table) exists precisely to catch this: a stage
intervention's effect must always be confirmed from the post-stage state (actual
layer/via/length/connectivity, or actual placement/skew), never assumed from either
half of the vendor's contradictory description.
