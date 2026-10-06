# Customer demo branch

Branch `customer-demo`, cut from `main` at `9c3a39c1` on 2026-10-03.

## Purpose

1. Show customers the current HimaHarness App running ATCS Fix Timing on the existing (pre-DBOS) Fabric,
   and a QuaLib Insight library analysis from prepared LibInsight data (no vendor API, no licence).
2. Collect what customers say and do during the demo, as input for desktop requirements after the
   DBOS migration (`codex/dbos-fabric-atcs-migration`, paused after U6).

This branch is not a release candidate and does not replace the migration plan.

## What may land here

- Wiring and small fixes that a demo path actually hits: a broken entry, a stall, a confusing label.
- Demo notes, the demo script and the feedback logs in `feedback/`.

What does not land here: Fabric/runtime redesign, new execution modes, Pack method changes beyond a
small fix, or anything the migration already owns. When a fix is needed in both places, record it in
the table below so it can be ported after the migration.

| Fix | Commit | Demo-only or port to migration | Notes |
| --- | --- | --- | --- |
| Resident handoff: artifact prefix in envelope and prompt; pre-write delivery refusal is `rejected`, not uncertain; native public reply reaches status and owner | `da9c859f` | Port to migration (U4/U6 resident adapter) | r7 stall; reviewed; Host 24/24, wrapper 33/33 |
| Resident engineering wrapper v2 installed beside v1 on linglong; Site/Permit point at v2 | `7582f7da`, `e9c9b9dc` | Demo Site config; migration needs the same wrapper | First live start refused until the Permit allowed the v2 wrapper |
| zh/en UI for Hima panels through the shell locale runtime | `de3560b9` | Port to migration (U7 faces) | Settings → Language switches live |
| Offline LibInsight demo Pack and local Site | `5f248092`, `ea726fce` | Demo-only | Tools ship under `flow/`; Pack 0.1.1 |
| QuaLib Insight tab (was Data Insight): analyse a library folder from the tab, open its report there | `aa2fd1e9~1` + review fixes | Port idea to migration (U7); replace draft save/restore with an explicit start route | Reviewed |
| SKY130 custom-cell Fmax demo Pack `custom-cell-fmax-sky130-demo` 0.1.0 and Site `linglong-sky130-cells` | `09239208`, `ce61d508` | Demo-only | Design: `docs/superpowers/specs/2026-10-04-custom-cell-fmax-sky130-demo-design.md`; deviations in the Pack `SPEC.md` |
| Engineer `precheck` (same validator as the delivery Reader, on the private workspace) | `ce61d508` | Demo-only (Pack) | A Reader refusal reaches only the Job log, not the owner or engineer (Harness gap, below) |
| No-entrypoint image `localhost/iic-osic-celluzi-hima:2026.06` for the resident sandbox | Site README | Demo Site config | The IIC-OSIC VNC entrypoint swallows the wrapper's command; no wrapper change |
| No-model Host dry path of the demo graph (group `cellfmax-dry`) | `63cbac16`, `2e0cfc26` | Demo-only test | Intermittent fork-round launch stall on the Mac (below) |
| Custom-cell Pack 0.4.0: mock layout (abstract LEF) and mock characterization (RC model anchored to foundry tables, no SPICE) | `2fecfda8` | Demo-only (Pack) | 227 cells in 3 s instead of 26 min; same round on real ORFS +0.58 % (SPICE-modelled +0.22 %); error in `flow/toolbox/char/mock-fit.json` |

## Build and launch

Node 24 and the locked pnpm version (see the repository `README.md`).

```sh
export PATH="/Users/lluzi/.local/node24/bin:$PATH"
pnpm install --frozen-lockfile --store-dir "$PWD/.hima-tmp/pnpm-store"
pnpm run build
```

Isolated demo Home, so the demo never touches development Homes:

```sh
DSH_HOME="$PWD/.hima-tmp/customer-demo/dsh" \
DSH_AGENTS_HOME="$PWD/.hima-tmp/customer-demo/agents" \
HIMA_USER_DATA="$PWD/.hima-tmp/customer-demo/electron" \
DSH_TELEMETRY_DISABLED=1 \
pnpm run desktop --site local
```

`--site local` is the controlled stand-in, not real EDA. A real ATCS run needs the XTop Site
(`sites/linglong-atcs28` or the Site used for the run being shown) and its licences.

## Demo storyline

1. **Start.** Open the App, pick the ATCS Pack, check the Site and inputs.
2. **Ask.** Tell the Guide the timing goal in plain words; confirm the proposed Campaign; a Run starts.
3. **Watch.** Run graph, current node, engineering progress, pause/continue.
4. **Results.** Switch to a Run that already finished: raw before/after Setup and Hold reports, best
   checkpoint, ECO, scripts and the residual explanation.

A full ATCS run takes hours. Finish one before the demo and show its results; start a fresh Run live
only to show how it begins.

## Recorded demo results (2026-10-04, App 0.3.0-trial.35/36)

ATCS, Run `run-d8122285`, one OpenCode resident round with the playbook on real XTop, about 56 min
end to end, ended by itself (`ended-goal-not-met`):

| Measured by the Pack Reader from raw XTop reports | Before (common R1) | After (selected checkpoint) |
| --- | --- | --- |
| Setup violations / WNS / TNS | 28 / -0.0380 ns / -0.2306 ns | 12 / -0.0064 ns / -0.0313 ns |
| Hold violations / WNS / TNS | 109 / -0.1523 ns / -4.7021 ns | 0 / 0 / 0 |

Hold goal PASS, setup goal FAIL, delivery ready PASS, four collateral checks UNKNOWN. The owner
repaired two rejected deliveries in the same native task without help; the Run then advanced through
Reader, judges and finish automatically. Comparison with serial AutoFix stays outside the product.

LibInsight, Run `run-39f7b4fb`: TSMC28 kit, 72 files, 258,485 findings, report of the 2,115 most
severe (`ended-goal-met`); about 25–30 min on a loaded Mac, N12 about 4 min. The report opens in
QuaLib Insight with corner/view/severity filters and provenance.

QuaLib Insight (App trial.37): the Data Insight tab is now QuaLib Insight. "Analyse a library
folder" started Run `run-2e884efe` (TSMC28, about 21 min, `ended-goal-met`) without any Campaign
screen, restored the person's Campaign draft, and opened the report in the tab when it ended. Asked
about one finding, the Guide explained it, separated what it does not mean, and proposed triage.

Recordings (`.hima-tmp/customer-demo-kit/recordings`): `01-atcs-setup-en`, `02-atcs-start-en`,
`03-atcs-results-en`, `04-atcs-zh`, `05-qualib-insight-zh`, `06-qualib-insight-en`. Screenshots:
`screenshots/{en,zh,prototype}` (prototype = lib_insight UI on the same results, shown as the
prototype).

Recordings and screenshots live outside git in `.hima-tmp/customer-demo-kit/{recordings,screenshots}`.

## Custom-cell Fmax on SKY130 (2026-10-04, App 0.3.0-trial.37, Pack 0.1.0 @ `2e0cfc26`)

The third demo: a resident OpenCode engineer designs custom standard cells for `aes` on open-source
SKY130; every round HimaHarness re-measures them independently with two matched ORFS arms (same
recipe and merged library, custom cells allowed versus forbidden). Design and deviations:
`docs/superpowers/specs/2026-10-04-custom-cell-fmax-sky130-demo-design.md`, Pack `SPEC.md`.

Lower gates before any GUI work (linglong, real bytes): the Pack's own baseline reproduced the frozen
golden exactly (WNS −0.249301 ns, TNS −1.91346 ns, 37,939 instances, route DRC 0) with the ORFS
checkout mounted read-only; a hand-built round with the July `NOR3_PU2` gave +3.96 % matched; the
`emap` window toolchain ran end to end (equivalence PASS) but its first window made timing worse;
the resident sandbox (v2 wrapper, no-entrypoint image) ran OpenCode and the EDA tools.

Live Campaign, Run `run-f42706a0-d392-44a5-8f54-085b2c95d2b1`, ended by itself `ended-goal-met`
in round 2 of 4 (200.8 of 300 min). Every number below is read by the Pack Readers from ORFS files:

| round | engineer's cells (new this round) | custom arm | control arm (= stock baseline) | matched gain | engineer's own claim |
| --- | --- | --- | --- | --- | --- |
| 1 | XNOR2_PU2, XOR2_PU2, XOR2_ND2, NOR3_PU2 | 270.33 MHz, 16 instances adopted | 259.79 MHz | +4.06 % | +4.06 % |
| 2 | + NOR3_ND2, MUX2I_PU2/ND2, O21AI_PU2/ND2, A21OI_PU2, A22OI_PU2, A221OI_PU2, O221AI_ND2, XNOR2_ND2 | 273.15 MHz (WNS −0.061 ns), 122 adopted (O21AI_PU2 59, A221OI_PU2 25, A21OI_PU2 19, NOR3_PU2 17, XNOR2_PU2 2) | 259.79 MHz (WNS −0.249 ns) | **+5.14 %** | +5.14 % |

Round 2 started from round 1's measured lesson (the remaining worst path needed about 0.033 ns and
ran through low-drive AOI/OAI and mux stages) and kept every round-1 cell byte-identical. Route DRC
0 in every arm; round 2 cost +0.66 % area and +0.40 % power. Layouts of the live Run's cells are
`abstract` (LibreCell layouts that were not taken through DRC/LVS); the earlier one-round wiring
Run `run-1a52e6fd-…` used DRC/LVS-clean `NOR2_PU2`/`NOR3_PU2` and reached +4.96 %.

Claim boundary (shown verbatim in the Run summary): custom-cell timing is modelled from foundry
tables with a stated derate per cell, not characterized; results are open-source ORFS timing on
SKY130 under these models; not signoff, not silicon.

Recordings (`.hima-tmp/customer-demo-kit/recordings`): `07-cellfmax-start-en` (request; stopped at a
screen lock), `08-cellfmax-confirm-en`, `09-cellfmax-live-graph-en` (two arms in parallel),
`10-cellfmax-round2-verdict-en` (verdicts and the owner's ending), `11-cellfmax-results-zh` (Guide
explains the results in Chinese). Screenshots: `screenshots/en/cellfmax-*`.

## Known limits to state honestly

- The handoff fix above removes the r7 stall on this branch; it is not yet on `main` or the
  migration branch.
- ATCS: setup not fully closed; collateral checks unknown; not physical signoff.
- LibInsight demo data was extracted earlier with the vendor API outside HimaHarness; the report is
  labelled native-qualified at the user's request.
- Some header buttons and graph markers remain English in the Chinese UI.
- Demo Pack report: every finding's provenance carries the same SHA-256 (a shared bundle hash), so
  the hash cannot tie a finding to its corner file; the Guide spotted this. Fix in `report.py`.
- QuaLib Insight progress line updates elapsed time only on Run events; the zh help sentence about
  "no Campaign wording" should be reworded for customers.
- QuaLib Insight starts its Run by saving and restoring the Campaign draft; the migration should give
  it an explicit start route instead.
- Earlier reference result `cf7a804c`: Setup 0 / Hold 0 versus strong serial AutoFix 24 / 82, one design.
  The Run's final label is "goal not met" and the collateral checks are UNKNOWN. It is a timing
  result, not full physical signoff.

- Custom-cell demo: the Campaign owner cannot sleep while a Job runs; its goal loop fired about 20
  rounds a minute (cap raised to 2000; about 100M+ cached tokens per Run). Host wake-ups alone drove
  the Run correctly after the cap ran out or the goal went inactive.
- Custom-cell demo: when the delivery Reader refuses a resident result, the reason reaches only the
  Job log, not the owner (the Pack's `precheck` lets the engineer catch it first).
- Custom-cell demo: on this Mac the no-model Host dry path (`cellfmax-dry`) intermittently stalls in
  a fork round with the next launch never recorded (2 of ~10 runs); not diagnosed; not seen on the
  SSH Site in either GUI Run.
- Custom-cell demo: Pack `INTENT.md` lacks the "Business" section the authoring check expects; the
  Guide asks to proceed.

## Preparing the demo again

Step-by-step preparation, commands, pitfalls and the post-migration checklist:
[HAPPY-PATH-GUIDE.md](HAPPY-PATH-GUIDE.md).

## Feedback

Copy `feedback/TEMPLATE.md` to `feedback/<YYYY-MM-DD>-<customer>.md` for each session. After the
session, turn each item worth acting on into a GitHub Issue in
`lluzi/hima_harness_reforge_polishing` labelled `needs-triage`, and link it back in the log.
