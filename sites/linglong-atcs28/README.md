# linglong-atcs28 Site administration

`linglong-atcs28` hosts the `agentic-timing-closure-system` Pack (`packs/agentic-timing-closure-system/`)
against the same Foundation reference used by the frozen `linglong-swerv28` Site
(`/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation`), read-only. Nothing in this
directory is installed on the server by writing these files to the repository: `site.yml`/`permit.yml`
are the policy this Site's administrator publishes into a Harness home's `hima/sites/` as
`linglong-atcs28.yml` (with `permit.yml` beside it), and `atcs-xtop-operator.sh` is a wrapper
**template** the administrator reviews, completes and installs by hand (see below).

## Inputs this Site binds

The Pack declares four inputs (`contract.yml`); this Site's `bindings:` point them at plain files and
one directory under `/data/eda/project/hima_harness/atcs-inputs/`, which does not yet exist on the
server (confirmed by a read-only listing on 2026-09-26) — the administrator creates it and copies the
real documents into it. `sites/linglong-atcs28/inputs/` holds a template for each:

- `inputs/designStateManifest.json` — the Foundation round-3 post-route state (EDA guide §8's "第二轮
  XTop回灌及刷新" row): `DBS/xtop_round2_eco_route.enc(.dat)`,
  `EXPORT/swerv_wrapper.xtop_round2_eco_route.{v,def}`, `EXPORT/swerv_wrapper.input.sdc`, and the two
  ROUND3 StarRC SPEF corners (`cworst_T` for the `ssg` scenarios, `cbest` for the `ffg` scenarios), all
  confirmed present on the server by a read-only `ls` on 2026-09-26. It declares no `lifecycle` block
  (post-route-only scope): the EDA guide is explicit that the earlier `init/place/cts/.../postroute`
  checkpoints existing is file-existence evidence only, not proof this Pack's own full-flow lifecycle
  contract is satisfied, and this task does not assert that.
- `inputs/analysisContract/policy.json` — the static acceptance terms only (`allowDegradedWorking`,
  `degradeLimitNs`, `maxNewConstraintFailures`, `scenarioCorners`, `requiredScenarios`). It must never
  set `goal`, `baselineStateId`, `baselineMinWns` or `campaignRoot` — `atcs_cli.py`'s `policy`
  subcommand refuses any static file that tries (`AtcsError("invalid-policy", ...)`).
- `inputs/analysisContract/scenario-corners.json` — the same `{scenario: corner}` map, at the fixed
  name the `presta` and `sta` tools read directly from `${analysisContract}/scenario-corners.json`.
- `inputs/siteCapabilities.json` — `edaShell`, `design`, `techLef`, `cellLefGlob`, `pgVerification:
  false` (this Site declares no PG-local-adjust capability, so `pg_local_adjust` stays inadmissible in
  every work package this Campaign plans).

The full `analysisContract` directory the Pack actually reads at run time (`contract.yml`'s own
description) also needs `query-spec.json`, `corners.json`, `sdc.json`, `scenario-inputs.json`,
`recheck.json`, `baseline-verify-drc.rpt` and `baseline-verify-connectivity.rpt` — this task's brief
scoped the written templates to the four documents above; the administrator composes the rest from the
same Foundation evidence (the EDA guide's §8 "最快找到原始报告" paths) before a real Run.

## Known gaps (read before using this Site for a real Run)

- **`techLef`/`cellLefGlob` are outside this Site's declared read roots.** The real tech LEF and cell
  LEF glob for this design live under
  `/data/eda/project/design_zoo/flows/swerv_wrapper_tsmc28/input/lef/` (confirmed present on the
  server), which this task's controller-fixed Permit read-root list (Foundation root, techlib root,
  `atcs-inputs`, workspace root) does not include. `techlib/tsmc28`'s own tree does not hold this
  design's staged tech/cell LEFs (a deep read-only search found none). This is flagged, not silently
  fixed: either extend `permit.yml`'s `allowedReadRoots` with that flows/input path (or a narrower
  parent of it), or stage a copy of the needed LEF set under `atcs-inputs/` and point
  `siteCapabilities.json` there instead, before running `prepare-workers` or opening the XTop Operator
  for real.
- **The wrapper template's two placeholders are unfilled.** `atcs-xtop-operator.sh` ships with
  `<REPLACE-WITH-QUALIFIED-IMAGE-DIGEST>` and `<REPLACE-WITH-QUALIFIED-ATCS-CLI-SHA256>` literally in
  it. No qualification of this Pack's XTop Operator tool against this Site has happened yet, so no real
  hash exists to fill in — do not invent one. Follow "Installing the wrapper" below.
- **The admin binding generator does not yet accept this Site or Pack.**
  `scripts/generate-xtop-operator-binding.mjs` hard-refuses any `site`/`toolId` other than
  `linglong-swerv28` / `run-xtop-fix` (checked directly in its source, not assumed). Generating a real
  `interactive-bindings.json` entry for `linglong-atcs28` / `xtop-operator` needs that script extended
  first — a separate, controller-approved change outside `sites/**`, not part of this Site's own files.
  Until it lands, the `xtop-operator` tool has no Host binding at all and cannot open for real,
  batch or interactive.
- Nothing under `/data/eda/project/hima_harness/atcs-inputs`, `atcs-runs` or
  `operator-admin/atcs-v1` exists on the server yet (confirmed by a read-only `ls` on 2026-09-26); the
  administrator creates all three, the last two outside any path this repository's automated checks
  touch.

## Installing the wrapper

`atcs-xtop-operator.sh` is a **template**, not the production artifact. Before installing it:

1. Build this repository (`pnpm run build`) so `packs/agentic-timing-closure-system/flow/atcs_cli.py`
   is the exact reviewed bytes this Pack ships, then compute
   `sha256sum packs/agentic-timing-closure-system/flow/atcs_cli.py` and put that hash in the wrapper's
   `adapter_sha256` placeholder. `atcs_cli.py` is deployed verbatim into every Campaign workspace at
   `<workspace>/flow/atcs_cli.py` (`contract.yml`'s `workspace.source: pack`,
   `workspace.copy: [atcs_cli.py, atcs, templates]`), so this one hash is stable for the whole Pack
   release, exactly like the frozen `xtop-timing-closure` wrapper pins `closure.py`.
2. Confirm (or build) the qualified `edarunner` container image this server already uses for the
   frozen `xtop-timing-closure-v1` wrapper, or a fresh qualified image for this Pack, and put its
   `sha256:...` digest in the `image` placeholder.
3. Copy the completed script to
   `/data/eda/project/hima_harness/operator-admin/atcs-v1/atcs-xtop-operator.sh`, outside the Permit's
   write root (`atcs-runs`), mode `0755`.
4. Run a bounded real XTop qualification session under a fresh child of
   `/data/eda/project/hima_harness/atcs-runs` (never inside `xtop-timing-closure-runs`, the frozen
   Pack's own root) that exercises `atcs_query_paths`/`atcs_query_cells` (read), `atcs_size_cell`
   (mutate), `atcs_dump_cells`/`atcs_export_changes` (save) and `atcs_close`, confirming source/exec
   writes stay denied and the session exits normally.
5. Once `scripts/generate-xtop-operator-binding.mjs` (see "Known gaps" above) accepts
   `linglong-atcs28` / `xtop-operator`, generate the Host's `interactive-bindings.json` from that
   qualification evidence and configure `interactiveBindingsFile` to point at it. At every open and
   dispatch the Host re-reads the binding, the retained Pack digest and the remote wrapper's own bytes;
   a changed byte, a symlinked wrapper, a Permit/root mismatch, a Pack digest change or a command
   classification change revokes confinement.

## Wrapper safety checks (preserved from the frozen `xtop-timing-closure-v1` wrapper)

`atcs-xtop-operator.sh` follows this Pack's own call shape,
`<wrapper> <workspace> <slot>` (`contract.yml`'s `xtop-operator` tool `argv`/`interactive.argv`), which
resolves the slot's session Tcl from `state/workers.json` rather than taking an adapter/template path
as a separate argument (see the script's own header comment for why the shapes differ). It keeps every
safety property the frozen wrapper has:

- realpath-resolves and confines the workspace to the Site's own `allowed_root`
  (`/data/eda/project/hima_harness/atcs-runs`); refuses a symlinked workspace, adapter or session Tcl.
- Pins the deployed Pack adapter (`flow/atcs_cli.py`) to a fixed sha256 before ever reading
  `state/workers.json`.
- Resolves the slot's session Tcl only from the one fixed record `prepare-workers` writes, and refuses
  any path outside that slot's own generated `workspaces/<slot>/r<rev>/xtop-analysis-manual.tcl` tree.
- Requires the licence-mode file (`/data/eda/env/empyrean-license-mode`) to read exactly `old` before
  launching XTop — never bypassed, never overridden by an argument.
- Launches XTop inside the same confined `podman` container as the frozen wrapper: read-only root
  filesystem, `/data/eda` mounted read-only, only the one Campaign workspace mounted read-write, all
  capabilities dropped, `no-new-privileges`, host networking kept only for the local licence service,
  and the container is always removed on exit (`trap ... EXIT HUP INT TERM`).

There is no batch path for this tool (`contract.yml`'s `xtop-operator` tool is `interactive-only`); the
wrapper always launches one interactive XTop session per call and exits when that session closes.
