# ATCS development history (2026-09-26)

How `agentic-timing-closure-system` was built, and why it looks the way it does. Read this before
reversing a design decision. The binding decisions below were made in review, and the per-task reports,
plan briefs and ledger that recorded them (`.superpowers/sdd/`) are gitignored scratch. This file is the
committed record of them.

## Process

- **Method:** subagent-driven development from the plan
  `docs/superpowers/plans/2026-09-26-agentic-timing-closure-system.md`.
  - Each task got a fresh implementer (TDD, stdlib `unittest`), then a task review with two verdicts
    (spec compliance and code quality), then fix rounds until approved.
  - Task 15 onward also ran the Harness contract test.
  - Every commit was pushed to `claude/himapack-development-c56369` and its SHA checked against the remote.
- **Models:** the user asked for Opus 5.5 (high effort, used sparingly), Sonnet 5 (medium) and Opus 4.8
  (medium). The session's Agent tool could reach only `sonnet` (Sonnet 5) and `opus` (Opus 5.5, effort
  not settable).
  - Sonnet 5 implemented every task except the graph compile, did the routine reviews, and did all fix
    rounds.
  - Opus 5.5 compiled the contract and graph (Task 14), reviewed the judgment-critical modules (M3–M5, M7,
    SPEC, graph), and ran the final whole-branch review and its re-reviews.
  - Tier agent definitions for a future session are in `~/.claude/agents/tier-*.md`.
- **Scope held:** Harness source unchanged. B_lazy (`packs/xtop-timing-closure`, `sites/linglong-swerv28`)
  frozen. The linglong server was used read-only only. No EDA job ran.

## Timeline

| Phase | Tasks | Result |
| --- | --- | --- |
| A — records | T1 INTENT/SPEC/B_lazy freeze; T2 knowledge | SPEC adapted from `HIMAPACK_SPEC.md` with compile decisions: 3 worker slots, `tc_next_action` codes 1–8, split rule ids. 10 knowledge files, with XTop/Innovus commands verified in the server man pages |
| B — modules | T3 M1; T4 M2; T5 M3; T6 M4; T7 M5; T8 M6; T9 M7; T10 M8 + residual; T11 lifecycle; T12 adapters/CLI; T13 Readers/semantics | All reviewed. M3, M5 and M7 each needed 2–4 Opus-reviewed fix rounds |
| C — compile | T14 contract/graph; T12b state-driven CLI; T12c admission fixes; T15 Site + contract test | loadPack OK; fit on local and `linglong-atcs28` |
| D (partial) | T16 real-report corpus preflight | 5 real parser defects found and fixed |
| Final review | Opus whole-branch review → fix batches A, A2, B, C, minors → 2 Opus re-reviews | "Ready (code side) for a bounded, GBA, post-route-only qualification" |
| Not started | T17 real-tool qualification; T18 Campaign, TEST, release | Held by the user on 2026-09-26 |

## Binding design decisions

Each decision was made to close a review finding. Reverse one only with new evidence.

**Identity and state**
- **State ids are M1 design-state ids everywhere.** This covers `baseStateId`, `parentStateId`,
  `expected_base`, pointers and `evaluation.stateId`. The merge-commit or APR-task id is provenance only.
  - `sta` builds the implemented DB's design state and labels its observations with it.
  - `evaluate` compares against the observation of the candidate's parent.
- **Adoption (M7).**
  - Compare-and-swap requires `parentStateId == expected_base`, and `expected_base` must match
    `working.stateId`, or `policy.baselineStateId` at bootstrap.
  - While `best` is unset, the degradation anchor is `policy.baselineMinWns`.
  - Known constraint failures count as bounded degradation, capped by `maxNewConstraintFailures`
    (default 0). Unknown constraint counts are refused for every pointer.
  - The tie-break is fewer failing timing checks. Missing comparison lists count as +∞.
  - Adoption is single-writer.
- **The baseline is staged into the workspace.** This follows the qualified old Pack. Every design-state
  path resolves against the Campaign workspace.
- **Write-once originals, fixed entry files.**
  - There are no mutable `current/` directories.
  - Entry files in `state/` reference originals by path and sha256.
  - Batch ids are unique.
  - An implement marker is written only after the outputs verify. A failed attempt is moved aside.

**Evidence and parsing**
- **Per-scenario identity is checked in full.**
  - Each STA receipt carries its corner, and the SPEF must be that corner's own.
  - Any missing identity leg (DB, netlist/DEF, SPEF, STA, `designStateId`) makes `finalIdentityErrorCount`
    unknown.
  - `baseline_physical` is always the campaign baseline's reports, produced by this Pack's own Innovus
    export.
- **Precision is never rounded in our favour.**
  - A path row carries PT's `violated` verdict. An annotated `(VIOLATED: increase significant digits)`
    row has unknown slack but stays violated.
  - WNS is unknown when it contradicts the violation count or shows a negative zero.
  - `report_timing` and `report_global_timing` both use `-significant_digits 4`.
  - The first tests use GBA, because PBA path mode may print `(MET)` rows that the parser refuses.
- **Residual evidence comes only from real PT path detail.** `parse_path_detail` was proven on 1168 real
  blocks. The queries run on the evaluated candidate's own state and carry `-delay_type` per mode. Unknown
  evidence produces no APR setting, which gives `no-intervention` rather than a guessed hook.

**Contributions and merging**
- **Contributions (M3).** A contribution is inadmissible if:
  - the trace disagrees with the native before/after delta;
  - an op's precondition fails against the running state;
  - an op falls outside `workPackage.actions`, `editDomain` or the PG region.

  Atomic groups merge explicit `group` ids with creator→dependent links (union-find). `beforeDumpSha256`
  and declared `dependencies` are recorded.
- **Composition (M4).** Cross-worker insertions sharing a load pin conflict (`same-load-pin`), and any two
  edits of one existing instance conflict (`shared-instance-edit`). `base-dump-mismatch` is keyed on the
  minority. Output is independent of input order.
- **Replay (M5).**
  - Resolutions work by conflict key, and conflicts are re-checked *after* revise substitution.
  - A revision must be re-sealed (M3) and re-analysed (M4). No loose objects are accepted.
  - Edit domains come from `state/workers.json`.
  - A selected fix that produces no step is refused.
  - Tcl values are brace-quoted, so bus bits are allowed and control characters, braces and backslashes
    are refused.
  - Innovus insertion is `ecoAddRepeater -term <loadPins> [-loc]`.

**Graph, CLI and Site**
- **One admitted document per Workshop output.**
  - The campaign plan is a single copy under `candidate.workPackages`.
  - There is one integration-plan path.
  - Composition facts are recomputed with the admitted plan.
  - PT inputs are built from the verified working state, never from a model-written file.
- **A fixed argv supplies no run-time ids.** Subcommands read run-time values from `state/*.json`.
  `policy` composes the acceptance policy from Site static terms, the Run's Goal and the baseline. The
  `maxPaths` Strategy knob is a cap, replacing `workerSlots`.
- **Graph shape follows Harness limits.**
  - Judges route on `rules[0]`, so there are chained Judges and one Explore per revisit target.
  - Every Explore is preceded by a Judge with ≥2 rules that cite the current Generation (`exploreEvidence`).
  - Goal-met re-reads the acceptance record and the evaluation.
  - An UNDETERMINED goal goes to `residual`.
  - A constraint-failures FAIL goes to `adopt`, where M7 keeps best and delivery barred.
- **Earlier APR is reachable from round 1.** `residual-baseline` runs before the first `decide-next`.
- **Site.** `scenarios.json` is the single source of corners and PT libraries. StarRC uses a per-corner
  template. Innovus restores `<db>.enc.dat <top>`; `FF/vars.tcl` is not needed post-route. The wrapper pins
  `atcs_cli.py`, and the admin records `flow-digest` for the whole `flow/` tree.

## Lessons for the next agent

- **Most serious defects surfaced only end to end.** The final review found:
  - a `-0.00` WNS passing the Goal;
  - a stale re-implement overwriting the adopted DB;
  - files resolved under the wrong root;
  - PT never linking a library;
  - Innovus restoring the `.enc` script.

  Every earlier unit test had used `root = workspace` and a no-op EDA wrapper. Test a new adaptation with
  an external manifest root and a fake wrapper that records its argv.
- **The real-report corpus pays for itself.**
  - The path-detail parser had never matched a real arc.
  - SPEF `*PORTS` lines collided with `*NAME_MAP`.
  - PT's slack annotation appeared in 44% of B_lazy's path blocks.

  Run the preflight whenever report sources change.
- **Opus review earned its cost** on M3/M5/M7, the graph and the final review, each finding Critical
  issues that Sonnet reviews did not. Sonnet implementers needed 1–4 review rounds.
- **Sonnet agents that background a command and wait on a notification stall.** Tell every implementer to
  run commands in the foreground.

## Deliverables index

- **Pack:** `packs/agentic-timing-closure-system/`, at stage `compiled`.
- **Site and test:** `sites/linglong-atcs28/` and `test/contract/agentic-timing-closure-system.test.ts`.
- **Evidence:**
  - `docs/assessment/2026-09-26/atcs-qualification/corpus-preflight.md`
  - `scripts/atcs-corpus-preflight.py`
  - `docs/package-development/agentic-timing-closure-system/b-lazy-freeze.md`
- **Plan:** `docs/superpowers/plans/2026-09-26-agentic-timing-closure-system.md`. Its task list is still
  valid, but its data-model rows were superseded by the decisions above and by module docstrings, which
  are the authority for artifact shapes.
- **Handoff:** [README.md](README.md).
