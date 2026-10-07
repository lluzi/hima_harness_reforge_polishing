# Whole-engineering XTop timing repair

## Objective and fixed boundary

Own the complete fix-timing engineering task. Start from the supplied common R1 measurement and make
the best actual native XTop state you can of the same design (see "Pick and prove the base"). The ambition is to clear every target setup and hold violation
without a required-constraint regression. Deliver the best actual state and explain residuals
and limits. A separate evaluator may assess its effect; benchmarking is not this engineering task.

The task envelope fixes the design state, common R1 state/worklist, constraints, libraries and
scenarios. Re-hash or query those identities before experimentation. Never change an SDC, scenario,
library set or starting state to improve the numbers. Discover real design objects from the native
reports and tool; no instance, pin, net, cell master or region is prescribed by this playbook.

This is an XTop engineering result. It remains prediction-only with respect to final physical
signoff. Do not populate or reinterpret tc_final_*, DB-to-SPEF PrimeTime acceptance, DRC or
connectivity facts.

## Timing result and broader limits

The declared Timing goal is the raw-verified setup/hold result against the requested targets. Required global collateral remains a separate recorded check: unknown
transition/capacitance/fanout/legality never becomes zero, and a known regression must be reported
and must prevent an unqualified adoption/signoff claim. A Timing goal can be met while broader
closure remains unknown or failed. Preserve those facts and the original input identities.

After Reader-verified delivery and release, the durable flow executes evaluate-timing and deliver.
The evaluation consumes that committed Reader result and records explicit goalMet from raw setup/hold
counts and WNS. Delivery preserves best effort, residuals, collateral UNKNOWN and known regressions
in reports and the engineering package. Do not rerun engineering merely to obtain a prettier ending.
This replaces the owner-driven finish-engineering Explore in the current Pack; historical endings
retain their original meaning.

## Working method

Use the normal private engineering workspace. Read the full raw common R1 reports, native context
and existing Pack knowledge before choosing a repair.

1. Reproduce the common R1 metrics and save an untouched starting checkpoint.
2. Map the current setup and hold residuals by scenario, endpoint, path/cone, fanout, transition,
   cell alternatives, placement and route context. State each root-cause hypothesis with the native
   observation that could falsify it.
3. Write analysis helpers when the reports are too large or relationships need computation. Retain
   those helpers as delivery scripts.
4. Try coherent repairs. Reasonable methods include native setup/hold AutoFix, cell size or VT
   changes, buffering, branch/load/net splits, buffer removal, cell movement, legalization-range
   changes, placement or routing detours and combinations. Use masters and objects discovered from
   the current tool state.
5. Measure setup and hold WNS, TNS and violation counts after every candidate. Check all required
   scenarios and constraints. Save a checkpoint when a candidate becomes the best actual state.
6. Undo a trial that is worse, mixed without a justified constraint trade, illegal or outside the
   fixed problem. Continue with another useful hypothesis while the Run and Site budget permit.
7. Use ordinary AutoFix when it is a useful repair tactic. No serial benchmark or comparison
   result is required to begin, deliver or finish this task.
8. Stop on full goal, native evidence that useful mechanisms no longer improve the result, a real
   tool/input/permission blocker, or the actual Runtime/Site closing boundary. There is no fixed
   mutation count or design-specific answer.

Keep the best measured state rather than the last attempted state. Explain trade-offs between
measured candidates and keep missing evidence unknown. A complete engineering delivery may be negative or
inconclusive and may leave the Campaign Goal false.

## Evidence-led Hold/Setup repair method

The mechanisms below come from two retained XTop engineering trails, not from a design-independent
guarantee. A user-supplied manual case moved Hold 109 / WNS -0.1523 ns / TNS -4.7021 ns to 0 / 0 / 0
and Setup 28 / -0.0380 / -0.2306 to 22 / -0.0380 / -0.1949. The Issue #82 Resident run started from
the same common-R1 family, compared against serial AutoFix Setup 24 / -0.0333 / -0.1568 and Hold
82 / -0.1523 / -4.5816, and delivered Setup 18 / -0.0237 / -0.0973 and Hold 0 / 0 / 0. The latter
beats the matched reference but remains best-effort because 18 Setup violations remain. Neither trail
establishes global transition/capacitance/fanout closure or physical signoff.

Treat these as hypotheses to test against the current design. Discover every endpoint, pin, net,
master, range and margin from the active state; never replay a historical object list or ECO.

### Keep one live XTop state

When loading is expensive, load the verified common R1 or a lineage-checked best checkpoint once
into one long-lived XTop process (on a small design, reproducible full-script reruns are fine, see
"Pick and prove the base"). Use that same process to inspect, source generated Tcl, mutate, measure, undo, checkpoint and
export. Strip standalone scripts' `open_workspace` and `exit` when sourcing only their operation body.
One writer owns mutable XTop state; collaborators may analyze reports or prepare scripts but do not
mutate concurrently. A command timeout means running/unknown, not permission to replay. Reopen only
once at the end when an independent persistence check of the saved best state is useful.

The Resident trail retained repeated request/response operations against one XTop PID while reducing
Hold through measured stages, then reopened the saved Hold-clean checkpoint once for final setup/hold,
legality and export verification. That is evidence for the interaction method, not a required count of
stages.

### Classify the residual before fixing it

Recompute setup and hold in every required scenario. Group residuals by shared launch/cone, data,
scan, async reset/set removal/recovery, fanout, placement and setup headroom. Inspect native failure
reasons and both min/max critical paths. Useful XTop observations include:

~~~tcl
summarize_gba_violations -exclude_path -hold -with_distribution -with_top_n 10000
summarize_gba_violations -exclude_path -setup -with_distribution -with_top_n 10000
get_critical_gba_path -to $endpoint -delay_type min -scenario $scenario
get_critical_gba_path -to $endpoint -delay_type max -scenario $scenario
~~~

An empty path collection is not proof of no violation. It can distinguish a removal/recovery-style
check from an ordinary data path only after pin function, launch, check type and native GBA evidence
agree.

### Use input-branch margin, not endpoint slack alone

For a data Hold endpoint, rank pins on the observed min paths by setup margin:

~~~tcl
set hp [get_paths -delay_type min -end_points [get_pins -quiet -exact $endpoint_name]]
if {[sizeof_collection $hp] > 0} {
    mark_hold_path_pin_rank -type margin $hp
    summarize_pin_rank -with_top_n 30
    set ranked [get_rank_pins -by order "(1,30)"]
}
~~~

Inspect each ranked pin's direction, full name, margin, cone and fanout. Reconvergence can give one
input branch useful Hold/setup headroom while another branch or the shared endpoint is setup-critical.
Delay or regenerate the isolated high-margin branch so a shared endpoint is not charged the same
delay. Historical margins are evidence only; the current report must justify the current branch.

### Distinguish buffer regeneration from deliberate delay

A dedicated delay cell can add useful fast-corner delay but excessive slow-corner setup/recovery
delay. A plain buffer may instead regenerate drive and improve electrical behavior with a smaller
slow-corner penalty. For isolated data branches with ample measured headroom, test an available delay
cell or buffer. For tight setup/recovery headroom, prefer a small plain buffer, a more isolated branch
or another coherent technique. Discover masters from the active library and remeasure all scenarios;
library family names from either retained case are not portable rules.

### Treat reset/IO removal as a port-net problem when evidence says so

Async clear/set residuals with no enumerated min paths may be removal checks launched from reset,
test or scan primary inputs. Confirm the pin function, launch, polarity, check type, fanout, recovery
constraints and critical GBA path. For a confirmed high-fanout reset/IO cluster, test regenerative
buffering or branching on the driving port/net rather than per-data-path delay insertion. Regenerate
the actual current net/load relation and choose strength, placement and branches from current evidence.
The manual case reduced Hold 93 to 37 with this class of repair while Setup stayed unchanged; its
buffer counts and nets are not a recipe.

### Legalize ECO cells without silently moving the design

When inserted cells require placement help, use an explicitly reviewed legalization/displacement
range, report the active constraint and inspect displacement and overlap:

~~~tcl
set_parameter placement_legalization_mode true
set_parameter placement_legalization_obligated false
set_placement_constraint -design $design -max_displacement $approved_range -readiness_check_level hard
report_placement_constraint -design $design
summarize_inst_displacement
check_placement_overlap
~~~

The approved range is design- and Site-specific. `obligated false` is a behavior setting, not proof
of legality. Preserve original placement when required and undo an illegal or unmeasured state.

### Use a coherent Hold-clean/setup-compensation sequence

Save a promising Hold-clean intermediate separately. If it worsens Setup, state a falsifiable setup
recovery hypothesis and measure the coupled result. One demonstrated recovery used native setup sizing
with an explicit hold margin, followed by small reset/removal buffering to close residual Hold reopened
by recovery. Use current Goal and margins rather than fixed constants. A temporarily worse checkpoint
is an experiment, not the accepted result; stop the compensation path if setup recovery or hold
protection does not materialize.

Retain each materially better checkpoint and return to the best measured coupled state. In the same
session, save the selected checkpoint and export logical/physical ECOs. One useful export shape is:

~~~tcl
write_design_changes -format INNOVUS -eco_file_prefix $prefix -output_dir $eco_dir -keep_route
save_workspace -as $selected_checkpoint
~~~

Report before/after metrics, mechanism, keep/undo decisions, selected-state identity, residuals and
scope limitations. Cumulative ECOs need their base/lineage stated.

### Provenance of this knowledge increment

The manual trail was read from the user-owned `manual-analysis/hold-eco-20261001-235447` evidence and
distilled without executing it. Key source SHA-256 values were: `SUMMARY.md`
`d7e9e5109d642bebac9b04c3121fa750a0f81554a030cc4852529e9f4b76fc9a`,
`manual-hold-eco.tcl` `25c1cf3637a1e78742c9d60d43733fb21df827c65d8b06e048d2ed97d23fc7b1`,
`fix_bigmargin.tcl` `c887bbed5eed948f2381323c6cd8c6130fcb5feaee02c4b291c64f9d2cc22655`,
`fix_reset.tcl` `ee82c773b60e81463246d1571850e2a7814503d0a9eb1c7b08e1833dc88b09ba`,
and `fix_converge.tcl` `ba51cbd8b638d0de49dabcadaccef14dd3d1db69079ef9e0dafd1ec59e9617ae`.
The Issue #82 Resident metrics and persistent-session facts come from retained Run
`run-2ab21055-e5ae-4e6b-b5b6-e2cdcd13d10e`; its original live Campaign Reader failure was a Host
materialization defect, not proof that every referenced artifact had been accepted into the Campaign.

## Full-closure ladder for multi-scenario GBA designs

Use this ladder when the Goal is zero setup and zero hold violations in every required scenario and
the residuals are large, mixed setup/hold, or AutoFix has stalled. Every step is a hypothesis: measure
setup, hold, transition and capacitance after it and keep a per-step table. No object name below is a
recipe; discover every pin, net, cell and master from the active state.

### Run the Pack's ladder first

The Pack ships this ladder as code: `xtop-closure-ladder.tcl.txt` in your knowledge folder. It is a
design-independent procedure library that discovers every object from the loaded state. It applies
sections 1–8 below:
- electrical first;
- GBA-targeted setup and hold ladders;
- port-net re-drive;
- sink-first structural skew for direct storage-to-storage walls;
- the tool's clock ECO;
- guarded per-flop useful skew;
- clean-up;
- a residual-hold pad;
- a final electrical pass under a timing margin.

Legalization is obligatory throughout, so an ECO that cannot be placed legally fails rather than
commits. The ladder reports non-fixed overlaps at the start and at the end.

Run it before anything else, from the staged baseline R0. On the XTop tutorial it took 16 s and
reached setup 0 / hold 0 with no new overlap. From R1 as supplied it left setup 13 / hold 64, because
R1's early hold padding is in the way.

1. Make a private root, for example `scratch/ladder-r0/`.
2. Build its load script from the Run's own `research/observe/common-r1/native-stage.tcl`:
   - keep every line before the first `file mkdir "…/initial-analysis"` line, which is the design
     load and ECO parameter setup;
   - set `env(RUN_ROOT)` to your private root;
   - copy the knowledge file to a `.tcl` file and append:

~~~tcl
source <your copy>/xtop-closure-ladder.tcl
set r [atcs_ladder_run {exclude {<patterns of protected structures, e.g. power-switch cells>}}]
puts "LADDER RESULT $r"
save_workspace -as <your private root>/ladder-best
~~~

3. Run it with `xtop -f <script> < /dev/null`. Every `@@` line is one measured step.
4. If `LADDER RESULT` reports `setup 0 hold 0` and `overlaps_after` ≤ `overlaps_before`, that state is
   your candidate:
   - rerun it once in a clean root to confirm it reproduces;
   - write the ECO exports from it;
   - report the per-step lines in REPRODUCE.md.
5. Otherwise, start from the ladder's saved state and work the residual with the sections below.
   Options such as `window`, `clock_delay`, `skew_max_cells` and `exclude` are listed at the top of the
   file.

Never switch legalization to non-obligatory to make a fix commit. An overlap that was not in the
starting state is a regression and must be undone.

### 0. Pick and prove the base

The supplied common R1 is the measured starting point, and `measurements.before` is always R1. Before
building on it, ask whether R1 itself is an obstacle. A plain AutoFix R1 often inserts thousands of
hold/delay cells before any electrical repair; once slews are fixed those cells over-delay paths and
occupy the rows later hold fixes need. Compare, by measurement:

- R1 as supplied;
- R1 with its own common-stage ECO cells removed (they carry the common-stage name prefix; list them
  with `get_cells -hier *<prefix>*` and `remove_buffer` each, counting refusals);
- the staged baseline R0 that R1 was built from (`baseline/` netlist and DEF, the copied native STA
  data and library Tcl in `research/native-input/`, opened exactly as the common-stage
  `native-stage.tcl` does).

All three are the same design under the same constraints, libraries and scenarios. Keep the base that
reaches the best measured result, and state its lineage in `remaining`/`unknown` facts and in
REPRODUCE.md: an ECO built from R0 is R0-relative and replaces R1's ECO rather than adding to it.
Never edit constraints, scenarios, libraries or the STA data to make any base look better.

On a small design a full load plus ladder takes seconds to minutes. Then prefer complete,
reproducible scripts rerun from the chosen base for every experiment over a long-lived session. Use
the long-lived session when loading is expensive.

### 1. Optimise against the measurement of record

The measurement of record is `summarize_gba_violations -exclude_path -setup|-hold` (pure GBA). XTop
fixers use retained path-based slack wherever a dumped path exists, so they stop when that path is
clean while the GBA endpoint is still negative. When the retained dump holds only a subset of paths,
run `purge_timing_paths` before fixing, and prove the `-exclude_path` numbers are bit-identical before
and after it. In one retained trail this alone cleared about 230 more endpoints. Expect some over-fix
against path-based analysis and say so.

### 2. Electrical first

Weak drivers on long wires make slews of around a nanosecond. GBA propagates the worst fan-in slew, so
a few of them cost nanoseconds of setup everywhere downstream, and sizing then reports `no_setup_gain`.
Repair data-path transition and capacitance first:

~~~tcl
set targets [get_transition_violated_pins -pin_type data]   ;# filter out excluded structures, see 7
fix_transition_violations $targets
~~~

Expect hold to get worse (paths got faster); that is cheap to repair later. Do not delete the only
buffers that re-drive a long wire to "remove delay": that makes setup worse and doubles hold. Remove
buffers only through `fix_setup_gba_violations -remove_buffer_only`, which checks the result.

### 3. Data-path setup, then data-path hold on min-only branches

Use the setup buffer family of the design's fastest VT. Then run, measuring after each:

~~~tcl
fix_setup_gba_violations -remove_buffer_only -setup_target $t -hold_margin 0.0
fix_setup_gba_violations -methods "size_cell" -effort extreme_high -setup_target $t -hold_margin 0.0
fix_setup_gba_violations -methods "insert_buffer split_net" -effort extreme_high -setup_target $t -hold_margin 0.0
fix_setup_gba_violations -effort extreme_high -setup_target $t -hold_margin 0.0
fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target $t -setup_margin 0.0
fix_hold_gba_violations -effort extreme_high -hold_target $t -setup_margin 0.0 -buffer_list $hold_cells -max_cluster_loader_count 4
~~~

`$t` is a small positive target (for example 0.005 ns) so a zero-WNS Goal holds after rounding. Give
the hold fixer the full set of plain buffers and delay cells the library offers (discover them from
`get_lib_cells`) and raise `eco_max_buffer_chain_length` when an input needs nanoseconds of delay.

### 4. Let fail reasons choose the next action

After every fixer, read `report_fail_reasons -stats -verbose -pins [get_<check>_gba_violated_pins
-exclude_path -endpoint_only]`:

| Dominant reason | Meaning | Next action |
| --- | --- | --- |
| `legal_fail_no_space_on_row` | the ECO cell has no legal site nearby | widen the ECO legalization window, e.g. `set_placement_constraint -max_displacement {300t 20t}` (allows small original-cell shifts); report displacement and overlap afterwards |
| `break_max_transition` on a hold sink | delay cannot sit after a bad slew | re-drive the net with a strong buffer at its source (port or driver), then rerun the hold fixer |
| `no_setup_gain` everywhere | the residual is structural | stop sizing; classify the endpoints (step 5) |
| `break_hold` / `no_hold_margin` while fixing setup | real setup/hold coupling | only now try a negative hold margin or the branch method below |
| `break_setup` while fixing hold | delay landed on a shared segment | move delay to the private min-only branch |

### 5. Classify residual endpoints by structure, not by slack

For each remaining endpoint, compare its critical max path (slow corner) with its critical min path
(fast corner) using `get_critical_gba_path -to <pin> -delay_type max|min -scenario <s>`:

- **Data path with logic and spare slack:** keep using data-path ECOs.
- **Both setup and hold violate:** find where the min path diverges from the max path. Delay the
  min-only branch. A candidate pin is feasible when its slow-corner setup slack is at least k × the
  fast-corner hold deficit, where k is the slow/fast delay ratio of the cell you insert. Measure k from
  candidate tables (`list_insert_buffer_candidates`); in one retained case plain buffers had k ≈ 2.1
  and HVT clock buffers k ≈ 2.7–3.5.
- **Direct Q→D with no logic, or a capture window shorter than the launching element's clock-to-Q**
  (macro pipelines, register files): no data-path ECO can fix it. Only clock skew can.
- **Hold on an input-port-to-macro net with no max (setup) constraint:** this is free delay. It is
  usually blocked only by the port slew rule: buffer at the port first, then let the hold fixer add a
  delay chain near the macro.

### 6. Clock skew for structural walls

Before any clock ECO, trace the leaf clock nets of the launch and capture elements:

- Never delay a clock net that also clocks the launching element of the same path. That is neutral at
  best.
- Never delay a net that feeds a clock-generation or divider flop: it creates new clock-path checks.
- Delay capture groups instead, with one clock-delay cell per group of capture clock pins.
- Solve a pipeline of skewed elements from the sink end backwards, or all stages together. A greedy
  per-endpoint pass with a launch-margin guard refuses the middle stage.

For high-k clock delay (HVT clock buffers), use the tool first and repair the hold it dents:

~~~tcl
fix_violations_by_clock_eco -setup -buffer $hvt_clock_buffer -count 2 -trace_level 6 -hold_wns_threshold -0.3 -auto_scan
~~~

For the remaining capture flops, use a per-flop useful-skew loop:
1. `insert_buffer [get_pins <capture CP>] $hvt_clock_buffer`, one cell at a time.
2. Stop when the D-pin setup slack reaches the target.
3. `undo` the last cell if the same flop's own launch (Q) setup slack falls below a guard.
4. Repair hold on min-only branches, then re-measure.

### 7. Protected structures

Keep generic fixers away from power-switch enable chains, always-on or isolation structures, and
dont_touch objects, especially when no power intent is loaded. Filter them out of the target pin lists
rather than letting `-force` buffer them. Report their pre-existing violations separately, item by
item against baseline.

### 7b. A few picoseconds is not a floor

When the Goal is total closure and only a handful of endpoints remain within a few tens of
picoseconds, keep working while the Run budget allows. Stopping 100 minutes early with one endpoint at
−1.5 ps is a missed Goal, not a floor. Before you claim one, measure each of these on the residual pins
(name them with `-only_pins` or the violations list):

1. Rerun the hold fixer with a slightly higher target, for example `-hold_target 0.01`, and the full
   delay-cell list.
2. Rerun the setup fixer with a positive `-hold_margin` on the coupled endpoints, to buy setup headroom
   for the hold fix.
3. Move the min-only delay one stage earlier or later on the branch, or split the load so the
   min-only branch is isolated.
4. Swap the VT or size of one cell on the min-only branch only (a slower variant), not on the shared
   segment.
5. Delay the launch clock of the short path instead of the capture clock, after checking that the
   launch element's own capture margin allows it.
6. Undo the last skew step on that endpoint and re-solve that endpoint with a different delay cell.

Record each attempt in the step table. Only when every applicable one is measured and none improves
the residual may the stop reason say "floor", with the evidence named.

### 7c. Use the time box; a confident "floor" is usually an untried tactic

The Pack's time box is 120 minutes with a 15-minute closing reserve, so the engineering task may work
until about 95 minutes after the task's `createdAt` (in `task.json`; compare with `date -u`). On a
small design a whole rebuild plus ladder takes about a minute, so this is dozens of experiments.

While the Goal is unmet, do not deliver before about 75 minutes have passed unless a real tool, input
or permission blocker stops you. In two retained App Runs on the XTop tutorial, the resident delivered
after 12–14 minutes claiming a floor:
- one stopped at hold 1 / −1.5 ps;
- one stopped at setup 48 on a macro pipeline;

Both residuals were closed by other Runs using tactics in this playbook. When you feel stuck:

1. Rebuild from the other base (R0 vs R1-without-common-cells), or reorder the ladder, and compare.
2. For each residual class, go through sections 5, 6 and 7b explicitly. Write a table of tactic → measured
   result in `engineering/REPRODUCE.md`.
3. Combine the partial wins of different experiments. Each experiment is a reproducible script, so
   take the hold-clean steps of one and the setup-clean steps of another, and re-measure.

### 7d. Pipeline skew, step by step

For a chain of storage elements A → B → C, where data goes Q→D with no logic between them (macro
pipelines, register-file read stages), and setup fails at B and C:

1. Measure each stage's setup deficit `dB`, `dC` (slow corner) and each capture pin's hold slack
   (fast corner).
2. Start at the **sink** C. Its capture clock needs `dC + dB`, because delaying B's clock also delays
   B's launch toward C. Insert a chain of delay cells in front of C's clock pin only:
   `insert_buffer [get_pins C/<clk pin>] {cell cell ...}`. Choose the chain length from the measured
   slow-corner delay of one cell, and re-measure.
3. Then delay B's clock by `dB`. Re-measure B/D, C/D, and the hold at B and C.
4. If B's capture clock shares a leaf net with its launch flops, or that net clocks a divider or
   clock-generation flop, isolate the pin first. `insert_buffer` on the pin itself splits it from the
   net.
5. Repair any hold dent on the min-only branches, then re-measure all four scenarios.

A per-endpoint greedy skew loop that delays B first will see C get worse and back off. That is not a
floor.

### 7e. Keep the delivery small

The Host materializes the whole `engineering/` tree into the Campaign workspace, file by file, before
the Reader runs. Thousands of files or hundreds of MB take a quarter of an hour. Keep scratch
workspaces, probes and superseded checkpoints **outside** `engineering/`, for example in `scratch/`
beside it. Put into `engineering/` only:
- the selected checkpoint;
- scripts;
- ECO exports;
- raw reports;
- logs;
- REPRODUCE.md;
- the result document.

### 8. Finish and prove

Run a clean-up loop of setup and hold fixers until nothing changes. Then run a last electrical pass
that may not dent timing: `fix_transition_violations -check_timing_margin <targets>`. Then:

- rerun the whole selected script from its base in a clean directory, and diff the per-step numbers;
- reopen the saved workspace in a new session and re-measure;
- scan the worst slacks;
- run `check_placement_overlap` and `summarize_inst_displacement`;
- compare `summarize_transition_violations` / `summarize_capacitance_violations` with baseline item
  by item.

State thin margins, clock-path delay cells and the absence of OCV derates as signoff risks.

### Provenance of this ladder

This ladder comes from an engineering feasibility study on 2026-10-07 on the ICExplorer-XTop 2025.09
vendor tutorial design (`cpu`, 4 scenarios). The study's own scripts are retained outside every
Campaign read root; this Pack carries only the generic lessons.
- Vendor scripts and stock AutoFix stalled at setup 605–618 / −1.83 to −1.96 ns and hold 372–391 /
  −3.06 ns.
- The ordered ladder reached 0/0 in all four scenarios from raw inputs. Transition went from 2663 to
  45, all pre-existing kinds, and capacitance from 100 to 1, identical to baseline.
- Building on the common R1 as supplied stalled at hold 115 / −0.90 ns. Removing R1's own cells first
  left hold 13 / −0.37 ns.

These are hypotheses for the next design, not a guaranteed sequence, and no endpoint, cell or ECO
from that study is to be replayed.

## Required delivery

Write exactly one atcs.engineering-result/1 JSON document as the delivery artifact of kind result.
Compute its id with the Pack's canonical atcs.core.digest over the full document with the id field
omitted.

The document must contain:

- task: non-empty taskId, runId, executionId, and nodeId fix-timing;
- inputIdentity: exactly the four keys baselineStateId, nativeContextId, commonStateId and
  worklistId, copied verbatim: `id` of state/baseline.json, `id` of state/xtop-context.json, and
  `stateId` and `worklistId` of state/common-stage.json. The Reader compares the whole object for
  equality, so any extra key (a hash, a lineage note, a target) is a rejection. Say that the selected
  state is R0-relative in stopReason instead;
- selected: a state identity and hashed selected checkpoint directory;
- actual measurements.before and measurements.after, each with setup/hold WNS, TNS, violation
  count and the hashed raw native report that carries those numbers;
- collateral with before and after, each containing exactly transition, capacitance, fanout and
  legality. Each check declares the state/scenario scope and a hashed raw XTop source report with
  tool/version/command, or an explicit unknown reason. Do not write a violation count: the Reader
  parses known native fail-reason tables and derives counts/regressions itself;
- artifacts: at least one generated script, logical ECO, physical ECO, reproduction file and at
  least one native trace, all by workspace-relative path and SHA-256;
- remaining, regressed, blocked and unknown fact arrays;
- non-empty stopReason, boolean bestEffort, and boolean noOp.

measurements.before must be the supplied common R1 measurement. The Reader independently verifies
before/after raw evidence and the selected state. It accepts a legitimate no-op when
that is the best result: set noOp true, keep before and after equal, and provide hashed empty
logical/physical ECO files plus a reproducible no-op script and real raw reports. Missing reports,
scripts, identity, measurement or export material is an incomplete delivery, not best effort.

remaining and regressed are explanatory lists only; they do not produce numeric facts. The Reader
derives those values from raw before/after reports. Put tool/input/permission blockers in blocked and
evidence gaps in unknown. A timing-fix fail-reason report proves only a positive blocker lower bound;
it remains unknown as a global transition/capacitance/fanout/legality check, and absence in that
limited scope cannot prove zero. Do not invent a normalized all-clear document.

## Admitted shape

The following is an admitted shape, with placeholder identities and paths only. Replace every value
with this task's actual facts and recompute all hashes and the canonical id.

~~~json
{
  "schema": "atcs.engineering-result/1",
  "id": "computed-by-atcs.core.digest",
  "kind": "result",
  "task": {
    "taskId": "task-from-host",
    "runId": "run-from-host",
    "executionId": "execution-from-host",
    "nodeId": "fix-timing"
  },
  "inputIdentity": {
    "baselineStateId": "baseline-id",
    "nativeContextId": "native-context-id",
    "commonStateId": "common-r1-state-id",
    "worklistId": "common-r1-worklist-id"
  },
  "selected": {
    "stateId": "selected-native-state-id",
    "checkpoint": {"path": "engineering/best-workspace", "digest": "sha256-tree-digest"}
  },
  "measurements": {
    "before": {
      "setup": {"wnsNs": -0.1, "tnsNs": -0.2, "violations": 1, "report": {"path": "engineering/raw/before-setup.rpt", "sha256": "sha256"}},
      "hold": {"wnsNs": 0.0, "tnsNs": 0.0, "violations": 0, "report": {"path": "engineering/raw/before-hold.rpt", "sha256": "sha256"}}
    },
    "after": {
      "setup": {"wnsNs": 0.0, "tnsNs": 0.0, "violations": 0, "report": {"path": "engineering/raw/after-setup.rpt", "sha256": "sha256"}},
      "hold": {"wnsNs": 0.0, "tnsNs": 0.0, "violations": 0, "report": {"path": "engineering/raw/after-hold.rpt", "sha256": "sha256"}}
    }
  },
  "collateral": {
    "before": {
      "transition": {"scope": "timing-fix-fail-reasons", "stateId": "common-r1-state-id", "requiredScenarios": ["scenario-name"], "source": {"path": "engineering/raw/before-transition.rpt", "sha256": "sha256", "tool": "XTop", "version": "actual-version", "command": "actual native command"}},
      "capacitance": {"unknown": "no admitted native report for this check"},
      "fanout": {"unknown": "no admitted native report for this check"},
      "legality": {"unknown": "no admitted native report for this check"}
    },
    "after": {
      "transition": {"scope": "timing-fix-fail-reasons", "stateId": "selected-native-state-id", "requiredScenarios": ["scenario-name"], "source": {"path": "engineering/raw/after-transition.rpt", "sha256": "sha256", "tool": "XTop", "version": "actual-version", "command": "actual native command"}},
      "capacitance": {"unknown": "no admitted native report for this check"},
      "fanout": {"unknown": "no admitted native report for this check"},
      "legality": {"unknown": "no admitted native report for this check"}
    }
  },
  "artifacts": {
    "scripts": [{"path": "engineering/scripts/fix.tcl", "sha256": "sha256"}],
    "logicalEco": {"path": "engineering/eco/final_netlist_eco.txt", "sha256": "sha256"},
    "physicalEco": {"path": "engineering/eco/final_physical_eco.txt", "sha256": "sha256"},
    "reproduction": {"path": "engineering/REPRODUCE.md", "sha256": "sha256"},
    "nativeTrace": [{"path": "engineering/native.log", "sha256": "sha256"}]
  },
  "remaining": [],
  "regressed": [],
  "blocked": [],
  "unknown": [{"check": "legality", "reason": "replace with actual native evidence"}],
  "stopReason": "all target native XTop violations cleared",
  "bestEffort": false,
  "noOp": false
}
~~~
