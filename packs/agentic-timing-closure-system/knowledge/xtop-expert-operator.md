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
| `atcs_paths` | `get_paths`; `analyze_setup_path_violations` / `analyze_hold_path_violations -detail_info` | `get_paths.1` (149), `analyze_setup_path_violations.1` (16), `analyze_hold_path_violations.1` (12) |
| `atcs_fail_reasons` | `report_fail_reasons -stats -verbose -pins`; `get_failed_pins -reasons` | `report_fail_reasons.1` (245), `get_failed_pins.1` (132) |
| `atcs_candidates` | `list_size_cell_candidates`, `list_insert_buffer_candidates`, `list_exchange_cell_candidates` | `list_size_cell_candidates.1` (188), `list_insert_buffer_candidates.1` (185), `list_exchange_cell_candidates.1` (183) |
| `atcs_point` | `report_timing -to <endpoint> -delay_type max\|min -path_type summary` per endpoint (GBA, no PBA option), captured by `redirect -variable`; rows `{endpoint, scenario, slack}` (#66 D3) | not yet cross-checked against a man page or `command_surface.tsv`: the atcs-v16 qualification confirms it on real XTop |
| `atcs_size_cell` | `size_cell` | `size_cell.1` (301) |
| `atcs_exchange_cell` | `exchange_cell` with domain partner instances | `exchange_cell.1` (106) |
| `atcs_insert_buffer` | `insert_buffer`; several lib cells make a chain | `insert_buffer.1` (177) |
| `atcs_insert_dummy` | `insert_dummy_cell` | `insert_dummy_cell.1` (178) |
| `atcs_split_load` | `split_load -pin_group ...` | `split_load.1` (304) |
| `atcs_split_net` | `split_net -rule wire_length\|cap -segment 2..16` | `split_net.1` (305) |
| `atcs_move_cell` | `move_cell -to {(x,y)}` in microns, inside an `editDomain.regions` box (µm); XTop legalizes the point to a nearby site (origin vs centre unsettled; within about half a cell) | `move_cell.1` (201) |
| `atcs_remove_buffer` | `remove_buffer`, every net of the buffer in the domain | `remove_buffer.1` (225) |
| `atcs_fix_hold_pins` | `fix_hold_gba_violations ... -only_pins` | `fix_hold_gba_violations.1` (112) |
| `atcs_fix_setup_pins` | `fix_setup_gba_violations ... -only_pins` | `fix_setup_gba_violations.1` (114) |
| `atcs_undo` | `undo` until `count_eco_actions` is back at the edit's start | `undo.1` (327, man-only), `count_eco_actions.1` (38) |

- Issue #64 (2026-09-28): the agreed spec, its Further Notes on the serial rounds, and the user's
  amendment of 2026-09-28 (the merge is a ranked recipe, never worse than plain auto-fix).

## Applies when

- The plan Workshop clusters the blockers into slot work packages: `targetPins` (instance pins,
  `<instance path>/<pin>`, not primary ports), a disjoint `editDomain`, and a `scope` whose commands
  name the moves the cluster may need. `editDomain.nets` are XTop's names: a pin inside a module sits on
  its local net (`swerv_dbg/rst_l`), not PrimeTime's flattened one (`FE_OCPN9798_rst_l`; Task 7). The session
  widens it once to the targets' local topology, one hop; nets above 12 leaf pins stay out (`domain.json`, #66 D2).
- A research Workshop writes a slot's worker request, and the worker Team runs: the Researcher proposes
  ladder moves with falsifiers, the Reviewer sharpens the plan and sets the scope, the Operator runs the
  loop below in its `xtop-operator` session (its template condenses it; it cannot read this file).
- Not for clock ECO, useful skew, pin-rank commits, PBA path fixes or slack adjustment: outside Issue #64 and the toolkit.

## Changes this decision

The Operator is a trial-and-measure expert, not the executor of one pinned action; each trial is probabilistic.
Try freely inside your domain (manual ECO and targeted fixes), measure the gain, keep what helps, undo what
does not: there is no wrong attempt, only an unmeasured one (FABRIC G45, 2026-09-29). The merge ranks
sessions by value (blocker coverage, then XTop's best per-scenario gain on a violating target check) and
replays them before auto-finish; a plain auto-fix control arm guards the batch. XTop's prediction decides,
WNS first: control when merged is worse on setup or hold WNS (> 1e-4); merged when better on one WNS; with
both equal, merged only when no worse on setup and hold TNS (1e-3) and better on one, or all four tie. So a
short, clean kept log beats many marginal edits. XTop's gain screens trials; refreshed PrimeTime judges.

### The expert loop

1. `atcs_dump_cells before.dump`, then `atcs_ref` once: the setup and hold reference of every gain.
2. Diagnose first: `atcs_point` reads each target pin's slack; `atcs_paths` (check, topN; end points fail in PBA, G50)
   gives the paths and XTop's analysis; the request's evidence says why auto-fix left them; `atcs_candidates` the path
   cells' masters. XTop keeps no fail reasons before the first fix: read `atcs_fail_reasons` on the targets after it.
3. Choose one move from the failing check's ladder, steered by the fail-reason table. Change one
   principal variable per trial (method, master, margin or pin set), or the gain cannot be attributed.
4. Trial it; every mutation, `atcs_undo` too, ends in `planSha256`, the plan hash the Host checks. XTop
   commits a targeted fix ("The committed actions cannot be undone", Task 7): try `atcs_fix_hold_pins` or
   `atcs_fix_setup_pins` after the manual moves you can undo, and measure it the same way. One that may insert
   (hold unless `sizeCellOnly` without `useDummyCell`, setup `insert_buffer`/`split_net`) needs its pins' nets in the domain.
5. `atcs_point` on the targets, `atcs_gain` on the opposite check; `reads.jsonl` keeps every path, reason and point read.
6. Keep the trial only if the target slack improved and the opposite check did not break. Otherwise
   `atcs_undo` at once, then try the next rung (another master, method, margin or pin set): an undo is never
   a stop (#64 attempt 1: w03 undid its one size, rightly, then stopped with 13 of 15 mutations left).
7. Stop when the budget is spent (every mutation and every undo counts), when every rung the scope allows
   has been tried on the targets without gain, or when the blockers are clear. Then
   `atcs_dump_cells after.dump`, `atcs_export_changes` (its `limitations`, "" if none, one per line, reach the seal) and `atcs_close`.

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

The Reviewer sharpens the plan and records concerns; by default its scope is every candidate command and a
budget of 50 mutations: room for trials, one undo each, the next rungs and toolkit refusals.

### Hold ladder

1. Size down the driver or a path cell (a slower master or VT swap; it may release area):
   `atcs_size_cell` to a master from `atcs_candidates`, or `atcs_fix_hold_pins` with `sizeCellOnly 1`
   and effort `omit` (the serial flow's qualified `-size_cell_only -size_rule nominal_keywords`).
2. Dummy load for a very small violation: `atcs_insert_dummy`, or `useDummyCell 1`.
3. Delay or buffer chain at the sink: `atcs_insert_buffer` with several masters, or
   `maxDelayCellLength` 1..5 with a `delayCellList` that mixes delay and normal buffers.
4. Loader clustering when close loaders fail together: `maxClusterLoaderCount` 1..6 (the User Guide: try 4).
5. Timing window when `break_setup` dominates: `fixTimingWindow 1` at effort `low` only, never with
   `sizeCellOnly` (XTop documents both incompatibilities; the toolkit refuses them).

A residual after step 5 is a density or clock problem. Both are outside this upgrade: record it.

### Setup ladder

1. Remove buffer from a redundant chain: `atcs_remove_buffer` (its nets in the domain; a local session admits a
   buffer's input net, never a global one), or `atcs_fix_setup_pins` with `removeBufferOnly 1`, as its own pass.
2. Size up or VT-swap the weak stage: `atcs_size_cell`, `atcs_exchange_cell` (partner instances in
   the domain), or `methods size_cell`.
3. Buffer to raise drive or isolate a load: `atcs_insert_buffer`, `atcs_split_load`, or
   `methods insert_buffer`.
4. Split net for a long or multi-branch net: `atcs_split_net` (rule `wire_length` or `cap`,
   2..16 segments), or `methods split_net`.
5. Size down off-path cells that do not violate, to cut the load on the path: `sizeDownOnly 1`.

Setup fixes run at effort `medium` or `high`, on the slot's own pins only. Use `atcs_move_cell` inside
a region only when the analysis blames distance (net delay) and a region was planned.

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

- A blocker is an endpoint that XTop's auto-fix leaves violating, with a fail reason (`atcs_fail_reasons`,
  `summarize_gba_violations -with_fail_reason`): its reason is not "no violation left". The worst check of
  every required scenario is a blocker until it is repaired.
- The bulk is everything auto-fix clears by itself. It is not worker work. The batch's auto-finish runs the
  control arm's exact qualified plain auto-fix sequence (setup size, setup buffer, hold size-only, hold;
  `packs/xtop-timing-closure/flow/closure.py`) after the expert repairs, which are locked with
  `set_dont_touch` first, so the two arms differ only by the recipe. Both arms then read
  `summarize_gba_violations -exclude_path -with_top_n N -with_fail_reason` per check; the chosen arm's
  reasons reach the next plan through the residual cases. Auto-finish ends with a hold flow, so its setup
  reasons are unread: a setup worker reads them in its own session after its setup fix.
- Workers spend their budget on blockers only: fixing bulk endpoints takes area and routing from
  auto-finish and blurs a worker's own gain. Disjoint edit domains: no instance or net in two active slots.

## Counterexample

Global high effort before the blockers. Serial round 1 (Issue #64, Further Notes): global auto-fix took hold
violations from 7,430 to 148 (2,908 buffers inserted, 919 cells resized). Serial round 2 ran the global
fixes again at high effort with the blockers still in place and over-fixed: WNS stayed at -0.154 ns hold and
-0.0383 ns setup, and PrimeTime after the round-2 ECO measured hold -0.16 ns. Higher effort adds internal
pin groups and runtime, not a new mechanism for the endpoints that set WNS. The order that works: diagnose
the blockers, repair them with targeted moves, lock them, then auto-finish.

The loop has its own limit (strategy map, judgement 2): with many violations one GBA auto pass converges
faster than any expert loop. Use the loop on the residual, not on round 1.
