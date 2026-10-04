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

Recordings and screenshots live outside git in `.hima-tmp/customer-demo-kit/{recordings,screenshots}`.

## Known limits to state honestly

- The handoff fix above removes the r7 stall on this branch; it is not yet on `main` or the
  migration branch.
- ATCS: setup not fully closed; collateral checks unknown; not physical signoff.
- LibInsight demo data was extracted earlier with the vendor API outside HimaHarness; the report is
  labelled native-qualified at the user's request.
- Some header buttons and graph markers remain English in the Chinese UI.
- Earlier reference result `cf7a804c`: Setup 0 / Hold 0 versus strong serial AutoFix 24 / 82, one design.
  The Run's final label is "goal not met" and the collateral checks are UNKNOWN. It is a timing
  result, not full physical signoff.

## Feedback

Copy `feedback/TEMPLATE.md` to `feedback/<YYYY-MM-DD>-<customer>.md` for each session. After the
session, turn each item worth acting on into a GitHub Issue in
`lluzi/hima_harness_reforge_polishing` labelled `needs-triage`, and link it back in the log.
