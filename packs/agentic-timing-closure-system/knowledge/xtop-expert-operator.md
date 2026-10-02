# XTop expert Operator

## Source
- The user's XTop knowledge pack, `XTOP_ADVANCED_TIMING_CLOSURE_SKILL_AND_STRATEGY_MAP.md` (research version
  2026-09-24, installed ICExplorer-XTop `2025.09.tmp15`, read-only; server copy
  `/data/eda/project/design_zoo/docs/xtop_advanced_timing_closure/`): Level 2 diagnosis, Level 3 manual ECO,
  Level 4 ladders, Level 5 effort, section 7 fail reasons, 8.2 target and guardband, 17 principles. Condensed.
- The same pack's `evidence/man_catalog.tsv` (sha256 `591caecac2a7bf9661153b87e550e61e554d7514818d4b821885abe26f391ded`;
  all 112 fail reasons) and `evidence/command_surface.tsv` (sha256 `fcbcab580ee0fe41ad0d55e6669086801f3bf2eec325efc26d2ca8763bf1ae92`).
- Man pages under `/data/eda/software/eda_tools/empyrean/xtop-2025.09.tmp15/share/doc/man/man1/`,
  one row per toolkit procedure of `flow/templates/xtop-operator.tcl` (row = `command_surface.tsv`
  line; `man+completion` unless marked):

| Procedure | XTop command it emits | Man page (row) |
| --- | --- | --- |
| `atcs_ref` | `summarize_gba_violations -as_reference -exclude_path`, captured by `redirect -variable` | `summarize_gba_violations.1` (314), `redirect.1` (221) |
| `atcs_gain` | `summarize_gba_violations -with_delta -with_reference -exclude_path -with_top_n`, plus `-with_fail_reason` for the check of the last fix flow (XTop keeps none for the other check or before a fix) | `summarize_gba_violations.1` (314) |
| `atcs_paths` | `get_paths`; `analyze_setup_path_violations` / `analyze_hold_path_violations -detail_info`; returns the bounded fixed session report, not only its filename | `get_paths.1` (149), `analyze_setup_path_violations.1` (16), `analyze_hold_path_violations.1` (12) |
| `atcs_fail_reasons` | `report_fail_reasons -stats -verbose -pins`; `get_failed_pins -reasons` | `report_fail_reasons.1` (245), `get_failed_pins.1` (132) |
| `atcs_candidates` | `list_size_cell_candidates`, `list_insert_buffer_candidates`, `list_exchange_cell_candidates` | `list_size_cell_candidates.1` (188), `list_insert_buffer_candidates.1` (185), `list_exchange_cell_candidates.1` (183) |
| `atcs_point` | `summarize_gba_violations -with_delta -with_reference -exclude_path -with_top_n 10000 -setup\|-hold` once per call, its top-N endpoint table filtered to the named pins (real XTop has no `report_timing`, #64 Q1); rows `{endpoint, scenario, slack}`, an unlisted one with `unknown` (no violation, or above the last listed slack) | `summarize_gba_violations.1` (314) |
| `atcs_size_cell` | `size_cell` | `size_cell.1` (301) |
| `atcs_exchange_cell` | `exchange_cell` with domain partner instances | `exchange_cell.1` (106) |
| `atcs_insert_buffer` | `insert_buffer`; several lib cells make a chain; net `""` takes the load pins' one (derived) net (#64 T06) | `insert_buffer.1` (177) |
| `atcs_insert_dummy` | `insert_dummy_cell` | `insert_dummy_cell.1` (178) |
| `atcs_split_load` | `split_load -pin_group ...` | `split_load.1` (304) |
| `atcs_split_net` | `split_net -rule wire_length\|cap -segment 2..16` | `split_net.1` (305) |
| `atcs_move_cell` | `move_cell -to {(x,y)}` in microns, inside an `editDomain.regions` box (µm); XTop legalizes the point to a nearby site (origin vs centre unsettled; within about half a cell) | `move_cell.1` (201) |
| `atcs_remove_buffer` | `remove_buffer`, every net of the buffer in the domain | `remove_buffer.1` (225) |
| `atcs_fix_hold_pins` | `fix_hold_gba_violations ... -only_pins`; a size-only pass adds each named input pin's in-domain driver pin (it sizes drivers: sink pins alone gave `not_only_pin 100%`, #64 T06) | `fix_hold_gba_violations.1` (112) |
| `atcs_fix_setup_pins` | `fix_setup_gba_violations ... -only_pins` | `fix_setup_gba_violations.1` (114) |
| `atcs_path_pin_rank` | Bounded selected-path margin ranking; input = setup margin, output = hold margin; changes fix priority | `get_paths.1`, `mark_hold_path_pin_rank.1`, `mark_setup_path_pin_rank.1`, `summarize_pin_rank.1` |
| `atcs_legalization_range` | Strict placement, ECO tracks100..1000, original range0, hard readiness, reported settings | `set_placement_constraint.1`, `placement_legalization_obligated.1`, `report_placement_constraint.1` |
| `atcs_undo` | `undo` until `count_eco_actions` is back at the edit's start | `undo.1` (327, man-only), `count_eco_actions.1` (38) |
- Issue #64 (2026-09-28): the agreed spec, its Further Notes on the serial rounds, and the user's
  amendment of 2026-09-28 (the merge is a ranked recipe, never worse than plain auto-fix).

## Applies when

- The plan Workshop clusters the blockers into slot work packages: `targetPins` (instance pins,
  `<instance path>/<pin>`, not primary ports), a disjoint `editDomain`, and a `scope` whose commands
  name the moves the cluster may need. `editDomain.nets` are XTop's names: a pin inside a module sits on
  its module-local net (`block/local_net`), not a timing report's flattened spelling. The session
  widens it once to the targets' local topology, one hop; nets above 12 leaf pins stay out (`domain.json`, #66 D2).
- A research Workshop writes a slot's worker request and the Operator runs the loop below in its `xtop-operator`
  session. The optional Reviewer never gates it; the Host binds the request scope and the task carries the run-time contract.
- Clock ECO/useful skew require explicit permission; never infer it from a clock-enable data path. Path rank is now a bounded session-analysis command; it changes fix priority, not physical ECO.

## Changes this decision

AutoFix handles ordinary sizing. Expert work changes topology, placement or usable margin that AutoFix cannot safely search. A standalone size/exchange is not expert capability; use it only as setup-margin or transition compensation within a coherent insertion/split/move batch. The Lead integrates safe evidence and continues manual ECO, including collateral repair, rather than stopping at mechanical replay.

### The expert loop

1. Start from the actual common R1. Verify the automatic immutable before.dump and capture both setup/hold references with atcs_ref. Use atcs_paths/atcs_gba, atcs_fail_reasons and native pin ranks for the selected residual; state one root-cause hypothesis.
2. Choose a CURRENT high-setup-margin input or output insertion point. The planner resolves its current pin/driver and physical region through existing helpers into workPackage targetPins/editDomain before mutation. Never guess a design object or widen an open session's scope. A missing declared upstream fixpoint requires the existing preparation/revision seam.
3. Insert a suitable delay/buffer or split the branch/load/net. If break_setup or break_setup_of_driver blocks it, first CREATE setup margin with a bounded paired action, then perform the hold insertion.
4. Enable strict legalization; if no legal site, try ECO displacement 150t, 300t, 600t, 1000t, or explicit scoped neighbor moves/far placement for detour delay. Automatic original-cell displacement stays zero. If detour hurts transition/drive, compensate using an appropriate stronger buffer or inverter pair/chain. Use only actual qualified library candidates.
5. After each coherent batch use atcs_gain for HOLD WNS first, hold TNS and setup, and verify transition and legal state. Keep useful net gain with acceptable collateral; otherwise atcs_undo the batch's physical actions. Re-rank after ECO. Never call TNS-only progress a material WNS movement, or native legality physical signoff.
6. Try the next distinct useful mechanism/range while the actual Host budget remains. One operation, one undo or one model turn is not completion. Stop only on cluster clear/material improvement, evidenced ladder exhaustion, or actual Host budget closing; report exact missing capability/scope if safe work is impossible.
7. Export the CURRENT cumulative ECO, after.dump and physical-risk limitations, then typed close and wait for completed. Deliver the exact script (including settings), before/after metrics, legal state, failed mechanisms and next recommendation. The Lead rechecks/reapplies session settings when integrating in a fresh process; session settings are not physical ECO commands credited by the Contribution recipe.

A Host refusal before admission is free. A toolkit refusal after admission costs one approved mutation. The budget counts trials, undo and refusals; an undo is never a stop—try the next distinct useful rung.

### Six expertise priors

Actual disjoint clusters come from the CURRENT residuals; these priors do not force design names or endpoint counts.

| Seat | Focus |
|---|---|
| W1 | High-margin input insertion |
| W2 | Output/branch split insertion |
| W3 | Detour and legalization range |
| W4 | Setup-margin creation followed by hold repair |
| W5 | Hierarchy/unannotated-net adjacent annotated topology |
| W6 | Transition/drive and inverter-chain physical completion |

### Bounded rank and legalization settings

Both commands change XTop session state, require the current plan hash and spend the reviewed mutation allowance. They produce bounded analysis/settings evidence in reads.jsonl, not a fictitious physical edit in ops.jsonl. Physical undo does not reset these settings. Substitute CURRENT declared values for the placeholders:

```tcl
atcs_path_pin_rank hold input <endpointPin> 10 <planSha256>
atcs_legalization_range 150 <planSha256>
```

`atcs_path_pin_rank` accepts selected setup/hold paths and input/output direction, one declared endpoint, topN 1..30. It uses native get_paths and the vendor's margin rank. Input rank (`mark_hold_path_pin_rank`) is **setup margin**; output rank (`mark_setup_path_pin_rank`) is **hold margin**, so an output rank alone does not establish setup headroom. Confirm setup evidence before using an output pin for hold insertion. Marking clears old rank and changes priority; ECO makes rank dirty, so re-mark after each trial. Sources: get_paths.1, mark_hold_path_pin_rank.1, mark_setup_path_pin_rank.1, summarize_pin_rank.1, report_pin_rank.1.

`atcs_legalization_range` accepts 100..1000 ECO tracks and fixes original-instance range at zero for the CURRENT private design. It enables placement_legalization_mode/placement_legalization_obligated and hard readiness, then reports the actual placement constraint. Vendor set_placement_constraint.1 specifies ECO/original displacement separately in tracks or microns, default {100t 0}, internal maxima {1000t 50t}; this surface does not admit automatic original-cell moves. placement_legalization_obligated.1 says failed legalized placement errors without committing the ECO. Strict rejection is evidence for the next bounded range/topology trial, not permission to keep an unplaced cell.

No design-specific endpoint, margin or cell is part of this method. Current examples belong in the per-Run strategy-risk report, analysis artifact and declared work package.

What a refusal costs. A Host refusal (a command outside the scope, another plan hash, the budget spent) is
free. A mutation the Host admits but the toolkit refuses (a pin or instance outside the domain, a point outside
every region, a master already in place or not in the library, a timing window with size-only) changes
nothing, yet costs one approved mutation. So check the domain, pins, regions and candidates with the free read
procedures first; read every refusal, choose again, never resend. A master is one library cell name of the
cell's own function: a size move's `toMaster` comes from the Liberty cells `state/xtop-context.json` lists and
the Site's `cellNominalSizingPattern` (#64 attempt 1: w01 twice sent `SDGCNQOPTMC D12BWP30P140`, two
`atcs_candidates` columns joined; w03's `SDFCNQARD1BWP35P140` to `SDFCNQD2BWP35P140` dropped the reset and
was rightly undone). A tainted session (an `uncertain` line) refuses every further mutation: dump, close and
report it.

The request normally grants every domain-safe mutation and up to 600 admitted mutations; the Host receipt reports
the real remaining allowance. The budget covers trials, undo calls and toolkit refusals; it is room to investigate
a cluster, not a quota to spend. Do not stop after one success while other targets or mechanisms remain.

### Hold ladder

1. Choose a high-margin current input/output insertion point from native rank and setup evidence; atcs_insert_buffer can form a delay or inverter chain.
2. If setup/driver margin blocks insertion, create setup margin with a bounded paired action, then insert. Standalone sizing is not expert evidence.
3. Enable strict legalization; widen bounded displacement or move declared neighbors/use farther placement for detour delay.
4. Repair transition/drive with a stronger buffer or inverter chain, then measure hold WNS and both checks.
5. Try atcs_split_load, atcs_split_net or atcs_move_cell where topology supports. Keep or undo each coherent batch; record exact exhausted mechanisms, not a blanket density verdict.

### Setup ladder

Create margin for the intended hold insertion by removing a redundant buffer, isolating a load with buffer/branch topology, or split net. Size/exchange may enable this paired repair, never count as standalone expert work. Compensate transition/drive and re-measure before performing the hold insertion. Keep the final batch only with acceptable setup and physical collateral. Targeted atcs_fix_hold_pins/atcs_fix_setup_pins may commit actions that cannot be undone; they are not primary trial moves. Their sizeCellOnly/insert_buffer/split_net options remain bounded by the existing contract.

### Target/margin pairing

- The target says how far to fix; the margin says what to protect on the opposite check. Always pair
  them: `atcs_fix_hold_pins` takes `holdTarget` with `setupMargin`, and `atcs_fix_setup_pins` takes
  `setupTarget` with `holdMargin`.
- Start at target 0 and margin 0. Closure means no violation, and PrimeTime certifies only 0.
- A positive target or margin over-fixes and spends area and buffers. Use a small positive margin
  (0.005 to 0.02 ns) only on an opposite check that the paths show lies within that margin.
- A negative margin explicitly allows collateral damage. Use it only as a trial: read both checks in
  `atcs_gain`, and undo if the opposite check breaks. The toolkit bounds both to plus or minus 0.2 ns.
- Manual moves carry no margin, so read both checks after every one of them.

### Fail-reason to move table

| Fail reason (`report_fail_reasons`) | What it means | Next move |
| --- | --- | --- |
| `break_setup`, `break_setup_of_driver`, `no_setup_margin` | the hold repair hurts setup | raise `setupMargin`; timing window at low effort; a smaller step (dummy before chain); sink-side chain, not driver sizing |
| `break_hold`, `break_hold_of_driver`, `no_hold_margin` | the setup repair hurts hold | raise `holdMargin` above 0; size instead of buffer; a remove-buffer pass |
| `too_large_slack` | sizing only fixes small slack | chain or buffer, not size |
| `unable_fix_by_dummy_cell`, `no_available_dummy_cell` | a dummy load cannot help | delay or buffer chain |
| `sufficient_driving_strength` | a buffer is not needed | size, split load or remove buffer |
| `too_weak_drive_strength` | a hold size-down candidate is too weak | delay or buffer chain, or a timing window; not another sizing move |
| `no_alternative_cell` | no sizing candidate | exchange cell or buffer; check the `atcs_candidates` lists |
| `off_path_violated_pin` | an off-path pin already fails setup | sink-side chain or a timing window; or target the off-path pin's setup first |
| `large_input_transition`, `heavy_fanout_net`, `break_max_transition`, `break_max_capacitance` | slew or load problem | split load or net, buffer, then size |
| `no_setup_gain`, `no_hold_gain`, `no_setup_total_gain`, `no_hold_total_gain` | no net gain | change the method or the pin set; never only raise effort |
| `legal_fail_no_space_on_row`, `legal_fail_density` | no legal space | smaller cells, fewer inserts, a move inside a region; else record the blocker as physical |
| `illegal_net_to_split`, `node_not_on_route`, `incomplete_net` | the net cannot be split | buffer or split load instead |
| `user_dont_touch_cell`, `data_dont_touch_cell`, `cross_hierarchy_net` | protection or topology | never bypass; repair another stage, or record it |
| `no_annotated_data_net` | timing data incomplete | stop on that pin and report the data gap |

### Blockers vs bulk

Initial common AutoFix handles bulk before this stage. Workers specialize in persistent blockers and their fail reasons, with disjoint current task claims. The Lead integrates and continues manual topology/placement/margin repair; final global auto-finish is absent from the current route. Native trials are probabilistic evidence, not a guaranteed remedy or refreshed signoff.

## Counterexample

Global high effort before the blockers. Serial round 1 (Issue #64, Further Notes): global auto-fix took hold
violations from 7,430 to 148 (2,908 buffers inserted, 919 cells resized). Serial round 2 ran the global
fixes again at high effort with the blockers still in place and over-fixed: WNS stayed at -0.154 ns hold and
-0.0383 ns setup, and PrimeTime after the round-2 ECO measured hold -0.16 ns. Higher effort adds internal
pin groups and runtime, not a new mechanism for the endpoints that set WNS. The order that works: diagnose
the blockers, repair them with targeted moves, lock them, then auto-finish.

The loop has its own limit (strategy map, judgement 2): with many violations one GBA auto pass converges
faster than any expert loop. Use the loop on the residual, not on round 1.
