## Site

Site `linglong-swerv28`. The Golden Flow this Run was checked against is the one `INTENT.md` names in its `Golden Flow` section: the verified SWERV28 Foundation Flow, described in `knowledge/source-flow.md` and hash-bound by `knowledge/source-manifest.txt` — the `swerv_wrapper` flow on TSMC 28 nm HPC+ that proved two full PT, XTop, Innovus, StarRC, PT rounds over the four scenarios `func_ssg_rcworst_m40`, `func_ssg_rcworst_125`, `func_ffg_cbest_m40` and `func_ffg_cbest_125`. That flow is method evidence, not a customer result template.

## Run

run: run-2306b485-ccae-4cca-9b56-4ba2c618ac88

Pack `xtop-timing-closure@1.0.16`, method digest `5cab1ddba6d2b6d35f27e2c5a1ddc05a8cd1b8758d1330c9c6c569dfd0cd78b1`, purpose `test`. Goal as asked and as recorded: `target_setup_wns_ns` = 0 and `target_hold_wns_ns` = 0, the values `SPEC.md`'s `Goal template` states for both parameters. Initial Strategy `strategyRevision` = 0, the pack's own declared default and the revision the Run recorded first. Budget: `generationLimit` 1, Site job cap 1, one licence each for Innovus, StarRC, PrimeTime and XTop. One generation was run and it was the whole authorised study budget; 26 Jobs were launched, never more than one at a time.

## Ending

status: ended-budget-exhausted

`SPEC.md`'s `Endings` declares this ending — "budget-exhausted at the declared wall/generation bound" — and the Run's own meters record `endedBy: generation-limit` at `generationLimit` 1, so the declared and the recorded ending agree, and no disagreement is raised about the ending itself. It is not the clean ending: the same gate recorded `xtop-setup-clean` FAIL and `xtop-hold-clean` FAIL, and the recorded decision was the next strategy (`strategyRevision` 1), which was proposed and never executed. No timing-closure or signoff claim is made; the unresolved boundary is retained together with the best database.

## Generations

- Generation 1 asked for strategy revision 0 at goal setup and hold WNS of at least 0 ns, and applied the owner-authored single high-effort `hold-buffer` action (`holdTargetNs` 0.0, `setupMarginNs` 0.02); it measured a baseline at iteration 0 (observation `#000050`) of setup WNS/TNS/violations `-0.04 ns / -0.12 ns / 12` and hold `-0.16 ns / -8.86 ns / 221`, closure score `243.58`, 3 unconstrained endpoints, which reproduces the Golden Flow's recorded post-round-2 state exactly; and a refreshed post-ECO state at iteration 1 (observation `#000151`) of setup `-0.04 ns / -0.12 ns / 12` and hold `-0.15 ns / -8.34 ns / 196`, closure score `217.96`, 3 unconstrained endpoints, with XTop-side estimates only (hold endpoints 89 to 68, worst `-0.1543 ns` to `-0.1533 ns`, TNS `-3.9058 ns` to `-3.6871 ns`, verify re-read `-0.1539 ns / -3.9584 ns`) that were not used as the verdict; its verdicts were PASS `xtop-iteration-evidence-valid` (`#000163`), FAIL `xtop-setup-clean` (`#000164`) and FAIL `xtop-hold-clean` (`#000165`).

## Code

- `run-2306b485-ccae-4cca-9b56-4ba2c618ac88#000058`, sha256 `26c7f35445e8ae7ce741a148613a3bc3574d3fef6716edbba9887c2836e403d2`: path `/data/eda/project/hima_harness/xtop-timing-closure-runs/xtop-timing-closure-20260927-125801-5802/research/timing-closure/.executions/execution-9fa8978d-eef3-4da6-bd74-65738c49df88/entry.py`, python, 8940 bytes, written at node `plan-fix`, generation 1, attempt 1.

## Refusals

none

## Disagreements

- Physical-evidence strength. The Golden Flow records its own boundary as full-chip DRC 72,799 and connectivity "1,000 VDD special-wire open" inside the report cap (source-flow.md sections 2.4 and 10). This pack's `SPEC.md` requires comparable, complete full-chip DRC and connectivity from the same database state under explicit 1,000,000 bounds, and declares a connectivity report capped at its default 1,000 problems `unknown`, which cannot authorise a best database. The Run recorded the stricter rule rather than the flow's capped number: its Innovus stage declares `drcLimit` 1000000 and `connectivityLimit` 1000000 over `flow/iterations/g001/INNOVUS/RPT/verify_drc.rpt` and `flow/iterations/g001/INNOVUS/RPT/verify_connectivity.rpt`, and both were retained as boundaries rather than reported as clean signoff.
- Terminal ending. The Golden Flow declares no wall-clock or generation bound: source-flow.md section 12.2 recovers round by round on user request through `ROUND2` and `ROUND3` evidence directories, so it never reaches a budget-exhausted conclusion. This pack declares `budget-exhausted`, and the Run ended there at `generationLimit` 1 — a bound narrower than the pack's own reference method, which `SPEC.md`'s `Choosers` caps at 12 generations. The ending this Run reached is declared by the pack and is not an ending the flow itself reaches.
- Fix scope per generation. The Golden Flow's verified fix is a four-call sequence per round (`fix_setup_gba_violations` with `size_cell` then with `insert_buffer`, then `fix_hold_gba_violations` size-only then at high effort, source-flow.md section 7.3), whereas this pack narrows each generation to exactly one owner-adopted action chosen from its four declared kinds. The Run applied only the last of those calls, so one generation cannot reproduce the flow's cumulative fix order; that is consistent with hold moving only from `-0.16 ns / 221` to `-0.15 ns / 196` while both goal rules stayed FAIL.
