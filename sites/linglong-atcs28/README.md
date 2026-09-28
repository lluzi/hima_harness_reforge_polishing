# linglong-atcs28 Site administration

Current candidate (Issue 63, Pack 0.1.6): `atcs-xtop-operator-v8.sh` (v7 plus the Pack 0.1.6 PT path-group and
capped-list WNS fix identities, under `operator-admin/atcs-v8/`). Previous candidate (Pack 0.1.4):
`atcs-xtop-operator-v7.sh` under `operator-admin/atcs-v7/`. Previous candidate (Pack 0.1.3): `atcs-xtop-operator-v6.sh` and
`xtop-operator-environment-v6.template.json` under `operator-admin/atcs-v6/`. v6 is the qualified v5
wrapper with only the `atcs-v6` paths and the new pinned `atcs_cli.py`/flow identities (honest no-fix
capture); the verifier and Site profile bytes are unchanged. The Permit now reads `atcs-v8` only.

Previous qualification candidate: `atcs-xtop-operator-v5.sh`, administrator-owned
`verify-worker-startup.py`, and `xtop-operator-environment-v5.template.json`. v1–v4 remain historical
unqualified candidates. v5 pins the verifier and a Site profile outside the Campaign, hashes source
before importing it, independently regenerates both Tcl files in a read-only administrator snapshot,
and mounts only the selected slot writable with a fresh HOME and no shell startup profiles.
Install the verifier and bootstrap directory under `operator-admin/atcs-v5/`, pin their exact
identities and the profile hash in the v5 wrapper, and pass the local falsifiers in
`test_verify_worker_startup.py` before real qualification. The older v2 instructions below are
retained for source history; they do not authorize a v2 production binding.

`linglong-atcs28` hosts the `agentic-timing-closure-system` Pack (`packs/agentic-timing-closure-system/`)
against the same Foundation reference used by the frozen `linglong-swerv28` Site
(`/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation`), read-only. Nothing in this
directory is installed on the server by writing these files to the repository: `site.yml`/`permit.yml`
are the policy this Site's administrator publishes into a Harness home's `hima/sites/` as
`linglong-atcs28.yml` (with `permit.yml` beside it). `atcs-xtop-operator.sh` is the imported v1
template; `atcs-xtop-operator-v2.sh` is the ATCS-04 candidate the administrator reviews, completes
and installs as a new path after local and L4 qualification (see below).

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
  contract is satisfied, and this task does not assert that. **Final review:** when a manifest DOES
  declare `lifecycle`, `baseline` stages every listed stage's own checkpoint (`.enc` script + `.enc.dat`
  directory) into the Campaign workspace's own `DBS/<stage>.enc(.dat)`, the fixed location `apr-run`'s
  own stage-restore step reads from -- this Site's own manifest declares none (post-route-only scope),
  so nothing here changes for it.
- `inputs/siteCapabilities.json` — `edaShell`, `design`, `techLef`, `cellLefGlob`, `pgVerification:
  false` (this Site declares no PG-local-adjust capability, so `pg_local_adjust` stays inadmissible in
  every work package this Campaign plans), plus `xtopContext`. The latter binds the four scenario
  names to XTop Liberty globs and declares the shared site map, removable fillers and ECO parameters.
  `observe` hashes those libraries, exports current-state PT timing data and writes one
  `state/xtop-context.json`; worker and replay re-hash the same receipt immediately before XTop.
- `inputs/analysisContract/` — a read-only directory, one JSON document per concern, at these fixed
  names (**final review**: every file the Pack actually reads at run time, listed here in full):
  - `policy.json` — the static acceptance terms only: `allowDegradedWorking` (bool), `degradeLimitNs`
    (number), `maxNewConstraintFailures` (int). It must never set `goal`, `baselineStateId`,
    `baselineMinWns` or `campaignRoot` — `atcs_cli.py`'s `policy` subcommand refuses any static file
    that tries (`AtcsError("invalid-policy", ...)`). It also must never set a `scenarioCorners`/
    `requiredScenarios` that *disagrees* with the value `scenarios.json` derives (see below) — it may
    omit both entirely (the common case) or carry them for documentation as long as they agree.
  - `scenarios.json` — **(C4, final review)** the single source of both a scenario's RC corner and its
    PT library identity, replacing the old bare `scenario-corners.json`:
    `[{name, corner, libGlob, driverLibrary, originalDriverLibrary}]`, one entry per required scenario
    (`func_ssg_rcworst_m40`, `func_ssg_rcworst_125`, `func_ffg_cbest_m40`, `func_ffg_cbest_125` —
    exactly these four, no more, no fewer). This Site's own copy is populated verbatim from
    `sites/linglong-swerv28/swerv28-site-profile.json`'s own `scenarios[]` (`spefCorner` → `corner`,
    `libGlob`/`driverLibrary` unchanged, `originalDriverLibrary` from that profile's own top-level
    field, the same value for every scenario). `observe`/`sta`/`residual`/`presta` all read it directly;
    `policy` derives `scenarioCorners`/`requiredScenarios` from it.
  - `corners.json` — **(I1, final review)** `{"corners": {corner: templatePath}}`: each RC corner's own
    Site-provided StarRC command-file template, hashed by `extract` and threaded into the compiled
    `.cmd` it actually runs. This Site's own copy points at the same `SIGNOFF/STARRC/cworst_T.cmd`/
    `cbest.cmd` Foundation paths the frozen `linglong-swerv28` Site profile already names.
  - `query-spec.json` — the final PBA/coverage query the `observe-baseline` graph node's `observe` tool
    reads: `{"precision": "gba"|"pba", "requiredScenarios": [...], "nworst": <int>?}`. `maxPaths` is
    never set here — it comes from the Run's own `maxPaths` Strategy knob instead, which caps whatever
    an admitted observation request separately asks for. **This Site's own copy sets `"precision":
    "gba"` for the first campaign** (final fix batch C, Minor): `pt-scenario.tcl`'s `-slack_lesser_than
    0.0` filter selects which paths `setup.rpt`/`hold.rpt` report based on the path's ordinary
    (GBA-computed) slack; PT's own `-pba_mode path` mode then reruns PBA only over that already-selected
    set (see `knowledge/observation-strategy.md`'s own PBA note), and a path whose more-accurate PBA
    slack turns out non-negative reports as `slack (MET)`, not `(VIOLATED)`. `atcs.reports.
    parse_path_report` never expects a `(MET)` row from this Pack's own report generation (its own
    module docstring: a real `setup.rpt`/`hold.rpt` this Pack generates never contains one, confirmed
    against the real B_lazy corpus generated with the same flag) — a non-trailing `(MET)` block raises
    `AtcsError("malformed-report", ...)`, refusing the WHOLE report rather than just that one path. This
    is a real, unverified-against-a-live-PT-session risk specific to PBA mode (GBA mode has no such
    reanalysis step, so it cannot produce this mismatch); `gba` avoids it entirely for this Site's first
    campaign. Switching to `pba` here is safe only once this specific PBA/`-slack_lesser_than`
    interaction is confirmed against a real PT session (or `parse_path_report` is taught to treat a
    `(MET)` row as "this path is no longer violating" instead of refusing).
  - `recheck.json` — the `risk` tool's own optional supplemental-recheck-data argument
    (`atcs.state.compare_checks`'s `recheck` parameter). This Site declares no recheck data of its own:
    `{}` (an empty JSON object) is the correct, complete value here — `compare_checks` treats an empty
    `recheck` exactly like "no supplemental data was gathered", never a refusal.
  - **Gone (final review):** `sdc.json` and `scenario-inputs.json` no longer exist at all — this Pack
    now reads the SDC and every per-scenario PT input (netlist, SPEF, and, since C4, the library
    triple) from the design-state itself, never a separate static copy that could silently diverge from
    it. `baseline-verify-drc.rpt`/`baseline-verify-connectivity.rpt` are likewise gone (**I13, final
    review**): the Campaign baseline's own DRC/connectivity reports are no longer a Site-authored
    document at all — `physical-baseline` now runs this Pack's own Innovus export against the staged
    baseline database, with the same limits a candidate's own `implement`/`apr-run` is held to.

## Known gaps (read before using this Site for a real Run)

- **Closed (final review): `techLef`/`cellLefGlob`'s own read root.** The real tech LEF and cell LEF
  glob for this design live under
  `/data/eda/project/design_zoo/flows/swerv_wrapper_tsmc28/input/` (confirmed present on the server;
  `techlib/tsmc28`'s own tree does not hold this design's staged tech/cell LEFs, confirmed absent by a
  deep read-only search). `permit.yml`'s `allowedReadRoots` now names it. This was never a container
  *access* gap in the strict sense — the XTop wrapper mounts the whole of `/data/eda` read-only
  into the container regardless of `allowedReadRoots` (see "Wrapper safety checks" below), so the tool
  could always physically reach the path; `allowedReadRoots` is instead the Harness-level
  least-privilege/audit declaration of which paths this Site's own tooling is *permitted* to name, and
  it previously understated that scope for a path this Pack genuinely, routinely needs.
- **The v2 wrapper template's three placeholders are unfilled.** `atcs-xtop-operator-v2.sh` ships with
  image, dispatcher SHA-256 and complete flow-digest placeholders literally in
  it. No qualification of this Pack's XTop Operator tool against this Site has happened yet, so no real
  hash exists to fill in — do not invent one. Follow "Installing the wrapper" below.
- **The binding generator entry exists, but final contract integration is intentionally pending.**
  `scripts/generate-xtop-operator-binding.mjs` now recognizes `linglong-atcs28` / `xtop-operator` and
  `xtop-operator-environment-v2.template.json` supplies its evidence shape. The current Pack contract
  still names the imported v1 wrapper; ATCS-03 is the sole owner that may switch the shared contract
  to v2. Until that integration and a fresh L4 qualification are complete, no binding may be generated
  or treated as active.
- Nothing under `/data/eda/project/hima_harness/atcs-inputs`, `atcs-runs` or the candidate
  `operator-admin/atcs-v2` path is installed by this code-only slice; the
  administrator creates all three, the last two outside any path this repository's automated checks
  touch.

## Installing the wrapper

`atcs-xtop-operator-v2.sh` is a **template**, not the production artifact. Before installing it:

1. **Confirm the licence mode.** `cat /data/eda/env/empyrean-license-mode` on the server must read
   exactly `old` before any of the steps below are exercised for real — the wrapper itself refuses to
   launch XTop otherwise (see "Wrapper safety checks" below), and this Permit forbids touching
   `licence-servers` at all, so the administrator confirms this out-of-band, read-only, never changes it
   from this Site's own tooling.
2. Build this repository (`pnpm run build`) so `packs/agentic-timing-closure-system/flow/atcs_cli.py`
   is the exact reviewed bytes this Pack ships, then compute
   `sha256sum packs/agentic-timing-closure-system/flow/atcs_cli.py` and put that hash in the wrapper's
   `adapter_sha256` placeholder. `atcs_cli.py` is deployed verbatim into every Campaign workspace at
   `<workspace>/flow/atcs_cli.py` (`contract.yml`'s `workspace.source: pack`,
   `workspace.copy: [atcs_cli.py, atcs, templates]`), so this one hash is stable for the whole Pack
   release, exactly like the frozen `xtop-timing-closure` wrapper pins `closure.py`. **I8 (final
   review):** `adapter_sha256` alone only pins the dispatcher file -- a modified helper module
   (`flow/atcs/*.py`) or template (`flow/templates/*.tcl`) is just as real a compromise of the
   deployed Pack, and this one hash would miss it entirely. Also run
   `python3 packs/agentic-timing-closure-system/flow/atcs_cli.py flow-digest
   packs/agentic-timing-closure-system/flow` (no workspace argument -- this is a Site-admin
   diagnostic, not a Campaign subcommand) and record the printed 64-hex-char digest alongside
   `adapter_sha256` as this release's pinned **flow digest**; recompute and compare it against a
   deployed Campaign workspace's own `<workspace>/flow` directory (same command, that path instead)
   before trusting any real Run, and again whenever `interactive-bindings.json` or the qualified
   image changes. Put that value in v2's `flow_digest` placeholder; the wrapper asserts it before
   reading `state/workers.json` or launching XTop.
3. Confirm (or build) the qualified `edarunner` container image this server already uses for the
   frozen `xtop-timing-closure-v1` wrapper, or a fresh qualified image for this Pack, and put its
   `sha256:...` digest in the `image` placeholder.
4. Copy the completed script to
   `/data/eda/project/hima_harness/operator-admin/atcs-v2/atcs-xtop-operator-v2.sh`, outside the Permit's
   write root (`atcs-runs`), mode `0755`.
5. Run a bounded real XTop qualification session under a fresh child of
   `/data/eda/project/hima_harness/atcs-runs` (never inside `xtop-timing-closure-runs`, the frozen
   Pack's own root) that exercises `atcs_query_paths`/`atcs_query_cells` (read), `atcs_size_cell`
   (mutate), `atcs_dump_cells`/`atcs_export_changes` (save) and `atcs_close`, confirming source/exec
   writes stay denied and the session exits normally.
6. After ATCS-03 changes the Pack contract to the v2 wrapper path, fill
   `xtop-operator-environment-v2.template.json` from the exact qualification, then use
   `scripts/generate-xtop-operator-binding.mjs` to generate the Host's `interactive-bindings.json`.
   Configure `interactiveBindingsFile` to point at it. At every open and
   dispatch the Host re-reads the binding, the retained Pack digest and the remote wrapper's own bytes;
   a changed byte, a symlinked wrapper, a Permit/root mismatch, a Pack digest change or a command
   classification change revokes confinement.

## Wrapper safety checks (preserved from the frozen `xtop-timing-closure-v1` wrapper)

`atcs-xtop-operator-v2.sh` follows this Pack's own call shape,
`<wrapper> <workspace> <slot>` (`contract.yml`'s `xtop-operator` tool `argv`/`interactive.argv`), which
resolves the slot's session Tcl from `state/workers.json` rather than taking an adapter/template path
as a separate argument (see the script's own header comment for why the shapes differ). It keeps every
safety property the frozen wrapper has:

- realpath-resolves and confines the workspace to the Site's own `allowed_root`
  (`/data/eda/project/hima_harness/atcs-runs`); refuses a symlinked workspace, adapter or session Tcl.
- Pins the deployed Pack adapter and complete deployed flow tree before ever reading
  `state/workers.json`, then verifies that slot's exact session Tcl hash from the same record.
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
