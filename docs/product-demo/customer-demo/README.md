# Customer demo branch

Branch `customer-demo`, cut from `main` at `9c3a39c1` on 2026-10-03.

## Purpose

1. Show customers the current HimaHarness App running ATCS Fix Timing on the existing (pre-DBOS) Fabric.
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
| _none yet_ | | | |

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

## Known limits to state honestly

- On this code base the engineering Agent's final reply can fail to reach the Campaign owner, which
  then asks for more work instead of moving on. Do not wait on stage for a live Run to finish.
- Reference result `cf7a804c`: Setup 0 / Hold 0 versus strong serial AutoFix 24 / 82, one design.
  The Run's final label is "goal not met" and the collateral checks are UNKNOWN. It is a timing
  result, not full physical signoff.

## Feedback

Copy `feedback/TEMPLATE.md` to `feedback/<YYYY-MM-DD>-<customer>.md` for each session. After the
session, turn each item worth acting on into a GitHub Issue in
`lluzi/hima_harness_reforge_polishing` labelled `needs-triage`, and link it back in the log.
