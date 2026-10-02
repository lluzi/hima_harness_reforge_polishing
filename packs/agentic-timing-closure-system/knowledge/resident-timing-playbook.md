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
