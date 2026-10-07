# ATCS 0.4.4 run contract

## Goal template

The declared Goal is raw-verified setup/hold clearance under the unchanged input problem. Targets
are 0 ns setup WNS and 0 ns hold WNS with zero native violations. A complete best-effort delivery
can leave Goal false. Global transition/capacitance/fanout/legality and broader regression/adoption
remain separate facts. UNKNOWN stays unknown; known regression remains visible. Timing Goal success
is prediction-only and does not establish physical signoff or approve adoption.

## Constraints

The staged design, common R1, constraints, libraries and ordered scenarios stay fixed. Retained
nativeTimingContext supplies same-design timing data, source reports, SDC hashes, ordered scenarios
and producer provenance. Preparation launches no PrimeTime. Common R1 is produced by actual initial
AutoFix, with saved native state and before/after reports. NativeReportPaths controls evidence breadth
from 1,000 to 100,000 paths; it does not limit repair techniques or iterations.

An XTop-native designStateManifest (`inputKind: xtop-native`) is a netlist + DEF + retained native
STA dump with no Innovus database, SPEF or SDC; its nativeTimingContext then declares
`constraintsEmbeddedIn: staData` with no constraint files, and the dump's tree digest is the
constraint identity. XTop scenarios may name their mode (func/test MCMM designs).

The resident's `measurements.before` is always the verified R1. It opens verified R1 and may research, code, use ordinary AutoFix, resize/VT, buffering,
insert/split/remove, placement, routing/detour and supported combinations. It measures candidates,
undoes regressions and returns the best actual state under Runtime/Site budget. There is no fixed
seat plan, mutation count, model-step count or hard-coded design object list. When R1 itself is the
obstacle, the resident may peel R1's own common-stage cells or rebuild from the staged baseline R0 of
the same design, and must state the selected state's lineage (an R0-based ECO replaces R1's ECO). Full professional
method and admitted engineering document shape remain in resident-timing-playbook.md.

## Run contract

`graph.yml` declares one `hima-flow/1` sequence:

| Task | Input sources | Work and committed output |
| --- | --- | --- |
| prepare-inputs | Run designStateManifest, siteCapabilities, nativeTimingContext | Verify retained native identity and existing readiness; return the three input paths and readinessId. |
| prepare-baseline | Committed preparation paths; strategy nativeReportPaths | Stage/hash baseline, copy/re-hash retained native context, execute native common initial AutoFix and save R1; return baselineStateId, nativeContextId, commonStateId and worklistId. |
| fix-timing | Committed Site/native paths; Run setup/hold Goal | Existing task-scoped resident engineering adapter and task-local wrapper execute the whole repair method. Existing Pack Reader validates exactly one delivery; commit observations and engineering outcome/summary/stopReason plus domain-report artifact. |
| evaluate-timing | Committed Reader value; explicit domain-report artifactRef; Run Goal | Verify report/reading identity, consume raw setup/hold WNS/TNS/counts and before metrics, retain broader remaining/regression/UNKNOWN Measures; emit explicit goalMet. No additional Reader Job. |
| deliver | Committed evaluation; explicit domain-report artifactRef | Recheck retained evidence, package full checkpoint/support tree and all scripts/ECO/reproduction/native trace/raw reports, and emit Markdown/JSON reports with goalMet and engineering package references. |

The four program Tasks use existing TASK_INPUT/TASK_OUTPUT command ABI. Input is the bound JSON
business value; output is `{schemaVersion, value, artifacts, diagnostics}`. Artifact entries declare
name/path/mediaType only; Runtime supplies ownership IDs and hashes. All five input/output schemas
are JSON Schema 2020-12 declared through Pack-local `schemas/tasks.json` references. No author
supplies platform Run/effect metadata. The resident delivery's existing task identity remains the
Reader's technical evidence boundary.

The five Tasks share the original two-hour hard deadline and fifteen-minute closing reserve. The Pack declares `budget: closing` on evaluation and delivery so they can consume verified results during that reserve. New engineering work is refused at the work cutoff. Site permissions, human controls, resource closure and the original hard Run limit apply to every Task.

## Semantics

The existing Reader binds the engineering result to exactly one Host delivery manifest and current
task/run/execution/node identity. It re-hashes raw reports, recomputes WNS/TNS/counts, verifies the
common-R1 starting measurements and re-hashes scripts, logical/physical ECO, checkpoint,
reproduction and native trace. Missing/tampered identity or evidence refuses delivery. Empty model
remaining/regressed lists cannot erase measured failures.

Collateral fail-reason tables supply positive blocker lower bounds and witnessed regressions.
Their bounded timing-fix scope stays UNKNOWN for global transition/capacitance/fanout/legality,
including zero or unsupported formats. A global all-clear path still requires separately admitted
real native global reports and parsers. No synthetic/model-normalized document can create PASS.

## Judge rules

The existing Reader and rule files retain their technical meaning for compatibility. The new flow consumes committed Reader values in evaluate-timing and declares no separate Judge nodes.

## Choosers

The current sequence has no chooser or Explore step. Its final delivery value states goalMet explicitly; historical ending helpers retain their original meaning.

## Endings

A valid engineering delivery proceeds through evaluation and delivery even when Goal is false.
Final `goalMet` is explicit in committed delivery output. Missing inputs/evidence remain actionable
Task failures; cancellation/budget and durable recovery are Runtime responsibilities. A no-op remains
valid only with equal measured before/after metrics and hashed no-op scripts/ECO exports.

Legacy CLI handlers, legacy snapshots, historical endings and verdicts retain their prior meaning.
Compatibility Reader/rules remain available; Judge/Explore/checklist/Reader are not separate nodes
in this new five-Task route. Independent serial AutoFix comparisons are external evaluation only.

## Workshops

There is no fixed internal Workshop or seat plan. The resident task owns research and private engineering code within the supplied task and Site boundary.

## Knowledge

resident-timing-playbook.md carries the complete task and admitted delivery shape; xtop-capabilities.md describes native operations; state-and-evidence.md keeps source identity and adoption limits explicit.
