# MAGE scribe-line placement 0.2.0 test record

## L1 — Pack-local unittest on synthetic fixtures

`/usr/bin/python3 -m unittest discover -s flow/tests -t flow` (run from the Pack root)

184 tests pass as of Task 14 (2026-10-12): Python 3.9.6 (Mac, `/usr/bin/python3`) --

```
Ran 184 tests in 9.650s

OK
```

-- and, confirming the same suite on the Linglong resident container's own interpreter (rsync to
`luzi@192.168.50.41:/home/luzi/tmp/mage-pack-flow-check/`, then `podman run ... edarunner:alma8`
per Task 14's brief), Python 3.8.16 (Linglong resident container) --

```
Python 3.8.16
Ran 184 tests in 15.274s

OK
```

-- with no Python-version-specific skips or `--pattern` narrowing on either side: both runs
discover and execute the identical `flow/tests/` tree. (174 tests were recorded here as of Task 13;
184 covers Task 13's own additions plus Task 14's ordinary/grouped drop split, `referenceMethod`,
and the native-DBU-export correction below.)

### Fix round 1 (Task 14 review findings, 2026-10-12)

187 tests pass after the fix-round additions: Python 3.9.6 (Mac, `/usr/bin/python3`) --

```
Ran 187 tests in 9.909s

OK
```

The three new tests, confirmed to fail against the pre-fix code before the fix landed: two in
`flow/tests/test_pla.py` (`test_native_dbu_pla_group_points_stay_um_not_dbu`,
`test_write_pla_dbu_emits_group_points_in_um_not_dbu`) pin the "Group target points are always
micrometres, even in a DBU PLA" rule that previously had no test asserting it either way; one in
`flow/tests/test_cli_tasks.py`
(`test_relative_out_dir_and_pla_resolve_against_workspace_not_cwd`) pins `mage-round`/`candidate`
resolving a relative `--out-dir`/`--pla`/`--round-dir` against `WORKSPACE`, not the process cwd.

Task 14 also fixed a real export-shape bug surfaced mid-task by a verified reading of a real MAGE
export on the Oct-12 build (the Site's native baseline PLA): `-savePlaDBU` is a DBU-header line a
saved PLA itself carries, not a second export command with its own output path; `-saveMark`'s own
DBU shape braces the header (`smPInstMgr -savePlaDBU {10000}`), uses `-box` (not `-umBox`) in the
three replay `foreach` forms, and keeps `pinstGroupProperty` Group target points in micrometres
even though the box coordinates are integer DBU. `flow/mage_placement/pla.py` (`_detect_units`,
`_read_groups`, `write_pla`'s `units="dbu"` path), `flow/templates/export.tcl` (dropped the fake
`-savePlaDBU {path}` catch), `flow/mage_placement/native/session.py` (dropped `exportDbuPla` from
`run_round`'s result), and `flow/tests/standin_mage.py` (the stand-in's own `-saveMark` now emits
the real DBU shape by round-tripping the µm candidate through `pla.read_pla`/`write_pla`) were all
updated and are covered by `test_pla.py`'s new native-DBU-shape tests and
`test_native_session.py`'s updated export assertion. Export shape verified against a real native
export on 2026-10-12.

### Fix round 2 (final whole-branch review findings, 2026-10-12)

209 tests pass after the final-review fixes (C1-C4, I1-I6), on both interpreters with no skips or
`--pattern` narrowing — Python 3.9.6 (Mac, `/usr/bin/python3`):

```
Ran 209 tests in 11.086s

OK
```

— and the identical `flow/tests/` tree on the Linglong resident container (rsync to
`luzi@192.168.50.41:/home/luzi/tmp/mage-pack-flow-check/`, then `podman run ... edarunner:alma8`),
Python 3.8.16:

```
Python 3.8.16
Ran 209 tests in 17.223s

OK
```

The 209 covers Fix round 1's 187 plus the final-review additions: per-consumer Finding/Request id
patterns and cross-consumer Ledger coverage (`test_records.py`); round-limit-first routing, the
first round counting as improved, ranking by Reader values, a blocked candidate never becoming
best, and a mis-bound review being skipped (`test_rounds.py`); unbound-target and all-unbound-side
unknowns (`test_metrics.py`); the fail-closed Reader, script re-hash, inventory conservation and
blocked-candidate reading (`test_readers.py`); the experiment forbidden-marker and duplicate-verify
refusals (`test_native_session.py`); the candidate inventory refusal, the no-export blocked candidate and delivered-state
`no-open-requests` (`test_cli_tasks.py`).

### Fix round 2 — second final-review round (N1–N6, 2026-10-12)

218 tests pass on both interpreters (Python 3.9.6 Mac `/usr/bin/python3`: `Ran 218 tests in
13.710s / OK`; the identical `flow/tests/` tree on the Linglong resident container, Python 3.8.16:
`Ran 218 tests in 21.599s / OK`). The 218 adds, on top of the 217 the first final-review round
produced:

- **N1 (blocked candidate → empty review):** a non-completed candidate carries no `files.snapshot`;
  the review Reader accepts an empty review (`candidateOutcome: blocked`, zero Findings/Requests)
  bound to the candidate id without reading a snapshot, `decide` routes `continue` while a round
  remains, and a later completed round is delivered — `test_cli_tasks.py::test_blocked_round1_then_completed_round2_delivers`,
  `test_readers.py::test_blocked_candidate_reads_all_unknown_without_error`.
- **N2 (inventory conservation by Group):** `snapshot.check_inventory_conservation` (shared by the
  candidate assembler and the Reader) conserves the Fixed id set, the Group-label set, and the
  per-Group in-group instance count — admitting a re-suffixed/re-mastered priority instance and
  ordinary fill, refusing a deleted or extra priority instance —
  `test_readers.py::test_inventory_*`. Verified on the real staged frame case (Linglong 3.8
  container): the vendor start vs the customer post-refine incumbent is **admitted**, and the same
  export with one priority Fit row deleted is **refused**.
- **N3 (skipped review is not clean):** a wrong-snapshot or wrong-slot review blocks the clean stop
  and FAILs `no-open-requests`/`goalMet`; the review Reader refuses a review whose `consumer` ≠ its
  delivery slot — `test_rounds.py::test_review_bound_to_wrong_snapshot_is_skipped_and_recorded`
  (now asserts `continue`), `test_cli_tasks.py::test_review_delivered_into_wrong_slot_is_refused_by_reader`.
- **N4 (round-scoped ids + Ledger validation):** Request ids are `R-<consumer>-<round>-<n>`, and
  `ledger-entry.request` is pattern-checked — `test_records.py` covers the schema and id patterns.
  The candidate assembler's and the Reader's own re-validation of every Ledger entry (a mis-scoped
  Request id refused on each side) is covered by
  `test_cli_tasks.py::test_candidate_refuses_an_invalid_ledger_entry` and
  `::test_reader_refuses_an_invalid_ledger_entry` (added in fix round 3; `test_records.py` tests only
  the schema, not the two route-side validation loops).
- **N5 (dropped target excluded, not unknown):** a target whose Fit is a known drop is reported in
  `droppedTargets` and excluded, so one dropped priority mark keeps target/order facts known;
  unknown only when a Fit appears nowhere — `test_metrics.py::DroppedTargetKnownTest`.

Metrics remain self-reported by the candidate and Reader-recomputed only for the emitted facts
(N6); the authoritative delivered numbers come from the external evaluation in the live-proof
procedure (kit `tools/evaluate.py` + cold replay), not this suite. Residual R1: the session log now
records `exportSha256`/`stdoutSha256` binding the export to the logged run; the Reader does not yet
re-derive the verify headers from `out/stdout.log` (the Task 16 cold replay covers this).

### Fix round 3 — third final-review round (N7 + I-1 + m1 tests, 2026-10-12)

230 tests pass on both interpreters (Python 3.9.6 Mac `/usr/bin/python3` and the Linglong resident
container Python 3.8.16). The 230 adds, on top of the 218:

- **N7 (ordinary population conserved by count):** `measure-incumbent` records the incumbent export's
  ordinary (non-group) population as `ordinaryPopulation` in `state/incumbent.json`;
  `snapshot.check_inventory_conservation` gains a required `ordinary_population` argument, and both
  the candidate assembler and the Reader read it from `state/incumbent.json` and refuse an export
  whose ordinary Fits + ordinary drops do not equal it (`ordinary population <n> != incumbent <m>`),
  never the start's rule-derived pending count. A no-fill export, an export missing one ordinary drop
  and an export with one extra ordinary instance are refused; a filled export with the same
  population is admitted — `test_readers.py::test_inventory_refuses_a_no_fill_export`,
  `::test_inventory_refuses_an_export_missing_one_ordinary_drop`,
  `::test_inventory_refuses_an_extra_ordinary_instance`,
  `::test_inventory_admits_a_filled_export_with_the_same_population`, and end-to-end
  `test_cli_tasks.py::test_no_fill_round_refused_for_missing_ordinary_population`.
- **m1 test gaps closed:** the Reader's blocked-candidate review refusals (non-empty findings, wrong
  candidateId, wrong round — `test_cli_tasks.py::test_blocked_review_refusals_by_reader`); the
  `evaluate_placement` skipped-review FAIL (`EvaluatePlacementSkippedReviewTest`); the candidate and
  Reader Ledger-validation loops (the two `*_invalid_ledger_entry` tests above); and the
  `check_inventory_conservation` Fixed-set and Group-label clauses
  (`test_readers.py::test_inventory_refuses_a_dropped_fixed_id`,
  `::test_inventory_refuses_a_renamed_group_label`).

The `candidate` assembler now evaluates the round's own `completed` flag before parsing the export or
checking inventory, so a non-completed round yields a blocked candidate even if a partial export
exists (m4). The I-1 regression (real-case counts re-entered `SPEC.md`/`snapshot.py`) is scrubbed to
neutral wording.

round-trip writing (`test_pla.py`); rule facts (`test_rules.py`); target binding and TB/LR/IN
partition (`test_targets.py`); snapshot round trip and sha (`test_snapshot.py`); the exact slot
planner against a brute-force oracle (`test_planner.py`); metrics against hand-computed values
(`test_metrics.py`); the consumer evaluator's `unknown` behaviour on missing parameters
(`test_consumers.py`); record/schema validation (`test_schemas.py`, `test_records.py`); the
decide-round best-state order and stop rule (`test_rounds.py`); the stand-in MAGE session driver,
one-writer enforcement, round-exists refusal, the fill stage (manifest converge lines) and Engineer
`--experiment` (byte-copy, sha256, `exit`/`frbOpen` refusal, consumer refusal), the three native
checks sliced from stdout markers, and completion judged by the `MAGE_ROUND_END` marker rather than
the vendor launcher's unconditional exit 0 (`test_native_session.py`); the two Readers'
negatives — tampered PLA, untagged mutation, unanswered Request, fabricated review number, wrong
snapshot binding (`test_readers.py`); the end-to-end two-round CLI route exercising every program
task and every resident subcommand in sequence, plus the `--fill`/`--experiment` route and the
blocked-outcome path (`test_cli_tasks.py`); and this Task's own
`flow/tests/test_knowledge.py` (every `contract.yml`-named knowledge file exists, is flat-named, has
no placeholder text, and each resident's own knowledge set stays under 12,000 words; every CLI
subcommand/flag a playbook names is real; every `state/...` path a playbook names is a declared
output or a documented support-path pattern).

The native route under test is the Site's proven one: exactly three native checks — `OVERLAP`
(`frbCheckOverlap`), `SPACE` (`frbCheckSpace`), `BOUNDARY` (`frbCheckBoundary`) — each report
sliced from MAGE's own `MAGE_VERIFY_*` stdout markers and counted by the `instances=<N>` header a
SPACE row being one offending instance, not a pair. The old ten-way `smVerify -checkType` family is
D-status only (unqualified) and this Pack no longer runs it.

## L0/L2 — Host contract test

`pnpm run build && pnpm run test:local -- --files test/contract/mage-scribe-placement.test.ts`

`test/contract/mage-scribe-placement.test.ts` (registered in `test/contract-groups.json`'s `local`
group) checks `loadPack`'s structure — the entry sequence, the one `repeat` block with its
`carry`/`stop`/`maxIterations`, the five resident tools with their `outsourcing` blocks and
licences, the Goal/strategy knobs, the absence of `agentTeams`/Workshops — and `checkPack` against a
synthetic local Site declaring `licences: {mage: 1}`, confirming Reader argv and emitted facts line
up with the rules' own `requires`.

## L2 dry route — passes on the real Host

`export HIMA_POSTGRES_RUNTIME=.../.hima-tmp/dbos-migration/u2/runtime-final CI=true
PATH="$HOME/.local/node24/bin:$PATH"; pnpm run build && node scripts/run-contract-tests.mjs
atcs-dry --files test/contract/mage-scribe-placement-durable.host.test.ts`

Task 10 built `test/fixtures/mage-resident-dry/{prepare.py,acp.py}` (an ACP v1 stand-in Engineer
and the four stand-in consumers, driving the real, deployed `mage_placement_cli.py` through the
exact `snapshot`/`mage-round`/`candidate` and `evaluate`/`review` sequences
`flow/tests/test_cli_tasks.py` already proves) and `test/contract/support/mage-resident-durable-
worker.ts` / `test/contract/mage-scribe-placement-durable.host.test.ts` (registered under
`test/contract-groups.json`'s `atcs-dry` group), booting the real Host in-process against a
genuine private-resident-workspace-vs-Campaign-workspace layout (never the Pack-local test's
single shared workspace): `sandbox.kind: none, testOnly: true`, `HIMA_RESIDENT_TESTING=1`, the real
`sites/linglong-atcs28/templates/resident-engineering-wrapper.py`, the real
`tools/read-mage.py`/`readers/*.yml` Readers, zero model calls, zero commercial EDA.

Both scripted scenarios ran their full round sequence and committed through evaluation and
delivery:

(Run ids below vary per run; the structural facts — task/round/Job counts, route, goalState,
failing rules — are stable and are what this section records. Latest fix-round-2 dry route:
converge `run-b0e2e51f…`, conflict `run-eed2a6bb…`.)

- **converge**: round 1 continues (`openRequestCount: 2`), round 2 stops —
  `"no consumer hard failure and no open request"`. 16 task executions (`2 + 2×6 + 2`), 10
  `engineering-*` Jobs and 10 `reader-mage-*` Jobs launched (one of each per resident task
  execution), `productModelCalls: 0`, `goalState: "met"`, `deliver.value.goalMet === true`, all
  seven delivery rules PASS, `openRequests: 0`, `decisionRequests: 0`.
- **conflict**: KEY_V never gets placed; WAT keeps filing a `place` Request on
  it, litho-pie's own hard fail clears in round 2 (a genuine improvement) then it files a `keep`
  Request on the very same target from round 2 on — a real cross-consumer conflict every round
  after. Round 2 continues (improved), round 3 continues (no change from round 2, not improved
  alone), and round 4 stops on the **round limit** — with C2's round-limit-first route order the
  stop reason is `"round limit reached"`, reached before the two-consecutive-stalls rule it would
  otherwise have matched. 28 task executions (`2 + 4×6 + 2`), 20 `engineering-*` and 20
  `reader-mage-*` Jobs, `productModelCalls: 0`, `goalState: "not-met"`, `goalMet: false`,
  `openRequests: 2`, `decisionRequests: 1`. Two rules FAIL: `drops-within-goal` (KEY_V stays
  dropped) and `no-open-requests` (the delivered state still carries open Requests and a Decision
  Request — I3/N3's composite, no longer a silent PASS); every other rule PASSes. This matches the
  Pack's own `decide()` math for this request/ledger shape
  (`flow/tests/test_cli_tasks.py:test_standing_conflict_runs_to_the_round_limit_with_a_decision_request`).

Getting here surfaced two real integration gaps the Pack-local single-workspace test could not
have caught, both now fixed:

1. **Session-log delivery path** (fixed in `89c17979`): `mage-round`/`candidate` now write/record
   the MAGE session log at `placement/round-NN/session.jsonl` (inside the Engineer's own
   `artifactPrefix`) instead of a cumulative `state/session.jsonl` the resident delivery mechanism
   could never actually publish into the Campaign workspace — the `placement-candidate` Reader
   failed every round with `mage_candidate_error_count: 1` until this landed. (This Pack change
   also needed `chmod +x` on the stand-in ACP/`prepare.py` scripts — the wrapper execs
   `native.executable` directly, and without the bit the ACP process never started, with no
   diagnostic beyond the task sitting `"waiting"` forever.)
2. **`decisionRequests` dropped from the committed decide-round output** (fixed in `b6f40829`):
   `task-decide-round`'s own `TASK_OUTPUT` value carried `decisionRequestCount` (a number) but not
   the actual `decisionRequests` list; `evaluate_placement` reads `decision.get("decisionRequests",
   [])` from that same committed value (never the on-disk `state/round-decision.json`), so it
   always silently defaulted to empty — the delivered report never carried a real Decision Request
   even when one was genuinely open. `test_cli_tasks.py`'s own conflict test never asserted
   `evaluation["decisionRequests"]`, only `goalMet`/`rules`; this dry route's own
   `decisionRequests.length >= 1` assertion on the conflict scenario is what caught it. Full
   diagnosis of both gaps is in `.superpowers/sdd/task-10-report.md`.

Also needed: Site `capacity.parallelJobs: 2`, not 1 (the dispatch's own first guess) — each
resident task's retained engineering Job holds one job slot until its own `release()` runs right
after its result is collected, but collecting that result launches a second, concurrent Job (its
own Reader); with `parallelJobs: 1` every resident task after the first permanently refuses with
reason `site-capacity` and the whole repeat stalls on round 1 forever (confirmed by inspecting
`task.projection.reason` on a live, unmolested run before raising it to 2).

## L1 machine-local — not run from this repository

The real frame-case package evaluation (start/incumbent snapshot reproduction, full target binding,
the beyond-limit and drop counts, the two-slot V-lane planner result) is Task 11's work, run by
the planning session under
`/Users/lluzi/code/mage_smart_conflict_resolver/research/mage-resident-agent-20261012/pack-eval/`,
outside this repository. No customer data and no result from that evaluation appear here.

## L4 (S2) — native qualification

Not started. Needs a user-opened MAGE licence window and Site `linglong-mage` work agreed with the
user (capability JSON, licence-mode guard, display, case copy) before any D-status command in
`knowledge/mage-capabilities.md` can move from documented to qualified.

## No model, no EDA

Every test above runs with `/usr/bin/python3` 3.9.6 against synthetic fixtures and (for native-round
behaviour) `flow/tests/standin_mage.py`. No DeepSeek/OpenCode session, no licensed MAGE binary, and
no GUI ran anything recorded in this document.
