# Whole-engineering XTop timing repair

## Objective and fixed boundary

Own the complete fix-timing engineering task. Start from the supplied common R1 and make the best
actual native XTop state you can. The ambition is to clear every target setup and hold violation
without a required-constraint regression and to beat the matched ordinary AutoFix reference on
repair effect.

The task envelope fixes the design state, common R1 state/worklist, constraints, libraries and
scenarios. Re-hash or query those identities before experimentation. Never change an SDC, scenario,
library set or starting state to improve the numbers. Discover real design objects from the native
reports and tool; no instance, pin, net, cell master or region is prescribed by this playbook.

This is an XTop engineering result. It remains prediction-only with respect to final physical
signoff. Do not populate or reinterpret tc_final_*, DB-to-SPEF PrimeTime acceptance, DRC or
connectivity facts.

## Working method

Use the normal private engineering workspace. Read the full raw common R1 reports, native context,
matched AutoFix reference and existing Pack knowledge before choosing a repair.

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
7. Ordinary AutoFix may be part of the engineering strategy, but the supplied autoFixReference is
   the comparison authority. Do not rerun a weaker one-round control or use speed, cost, calls or
   step count as a tie-break.
8. Stop on full goal, native evidence that useful mechanisms no longer improve the result, a real
   tool/input/permission blocker, or the actual Runtime/Site closing boundary. There is no fixed
   mutation count or design-specific answer.

Keep the best measured state rather than the last attempted state. A tie is a tie. Mixed effects or
missing comparable evidence are unknown. A complete engineering delivery may be negative or
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

Load the verified common R1 or a lineage-checked best checkpoint once into one long-lived XTop
process. Use that same process to inspect, source generated Tcl, mutate, measure, undo, checkpoint and
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

## Required delivery

Write exactly one atcs.engineering-result/1 JSON document as the delivery artifact of kind result.
Compute its id with the Pack's canonical atcs.core.digest over the full document with the id field
omitted.

The document must contain:

- task: non-empty taskId, runId, executionId, and nodeId fix-timing;
- inputIdentity: exact baseline, native context, common R1 state and worklist identities;
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

measurements.before must be the supplied common R1 measurement. The Reader independently compares
measurements.after with the supplied ordinary AutoFix reference. It accepts a legitimate no-op when
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
