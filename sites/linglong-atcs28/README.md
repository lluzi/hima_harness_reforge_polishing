# linglong-atcs28 Site administration

Current candidate (Issue 64 / ATCS-09 spec #66, before treatment T05, Pack 0.2.0): `atcs-xtop-operator-v16.sh` under
`operator-admin/atcs-v16/` (wrapper sha `7bd590dda9ecbcd3...`, installed 2026-09-30, mode 0555). v16 is v15 with the
atcs-v16 paths and one pin changed: `flow_digest` `476ebdb793ba1a09...`, the Pack flow whose sessions derive their cluster's
local-topology edit domain, read single endpoints (atcs_point), log their reads, seal batch Contributions, and whose
replay enters the sealed effective domain (tickets #67–#75). Beside it are the same verifier (`014fcfa5...`) and slot step
(`293b2a3f...`) bytes as v13–v15's, and bootstrap root `operator-admin/atcs-v16/bootstraps/`. The Pack's `xtop-operator`
binding names v16 and the Permit reads `atcs-v16`. The template `atcs-xtop-operator-v16.sh` with its placeholders filled is
byte-identical to the installed v16 (`derive-v16.py`, count-asserted hunks).

Previous candidate (before treatment attempt 4): `atcs-xtop-operator-v15.sh` under `operator-admin/atcs-v15/`
(wrapper sha `60d951f3a95cdfa4...`, installed 2026-09-30, mode 0555), flow pin `31fbee294260...`.

Previous candidate (before treatment attempt 3): `atcs-xtop-operator-v14.sh` under `operator-admin/atcs-v14/`
(wrapper sha `2f4ced1aa18d76d3...`, installed 2026-09-29, mode 0555), flow pin `a47368518262...`.

Why: in treatment attempt 2 every Harness close left the podman container and its XTop running (FABRIC G51).
The Harness closes a Job by hanging it up, then sends TERM to its process group after 15 s. v13 ran
`podman run` in the foreground, so its HUP/TERM trap could fire only after podman returned. XTop is the
container's PID 1 and ignores TERM, so podman never returned. w01 and w02 became `process-survived` blockers,
and a person had to `podman stop` them; SIGKILL came after the 20 s grace.

v14 runs the container in the background (`0<&0 &`) and waits on it (`wait -n`), so a close reaches the wrapper
at once. HUP, TERM, INT and EOF on stdin all run one close:
- `podman stop -t 20`, which escalates to SIGKILL itself. It runs under `setsid`, so the Harness's group TERM
  cannot cut it short.
- `podman rm` if the container is still there.
- A check that no process of the container's pid namespace and not the recorded XTop pid remains.
- Only then exit 0, or exit 5 with the names if something remains.

A stdin watcher polls fd 0 for hang-up without reading it. The container name and XTop pid go to
`<slot>/session.json`. The next attempt's slot step retires that file with the rest of the slot. A session XTop
ends itself (`exit`) returns XTop's status, as before.

Derivation (`qual-tools/derive-v14.sh` and `derive-v14.py`): v14 was derived on the server from the
*installed* v13 bytes (sha `9f54c9cd...`, checked first). The transform makes these changes, each with a
count assertion:
- the header comment;
- the `atcs-v14` paths (4) and the wrapper name (2);
- v13's `cleanup_container` trap replaced by the close functions and traps, placed before the launch;
- the foreground launch replaced by the background launch, session record, stdin watcher and wait.

The image, adapter (`2b001eda...`), flow (`a4736851...`), verifier, slot-step and Site-profile pins, and every
`podman run` option, are v13's byte for byte. `diff` against installed v13 shows exactly those hunks. The same
transform applied to v13's template here gives `atcs-xtop-operator-v14.sh`. With its six placeholders filled
from the pins, that template is byte-identical to the installed file. `grep REPLACE` hits one comment line.

Qualification (2026-09-29, on `atcs-runs/qual-atcs13-20260929`, the v13 qualification's workspace on this
branch's flow; slots w02 and w03, so v13's w01 evidence stays in place):
- **Own preflight** (`qual-tools/v14-preflight.sh`, the installed wrapper's lines up to the licence check):
  - OK for w02 and w03.
  - Refused for parked w04 (exit 3) and for w07 (exit 2).
  - Refused for the older `e6ccfabc...` flow at the adapter check (exit 3, `qual-atcs13neg-20260929`).
- **Close by stdin EOF, w02** (`qual-tools/v14-drive.py`: the wrapper leads a fresh pty with SIGHUP ignored,
  so only its stdin path can act). READY, then `QUAL:identity:INVD12BWP30P140ULVT`. The driver then closed the
  pty master. The wrapper logged `close (stdin-eof)` and exited 0 20.8 s later. Afterwards there was no XTop
  process (`ps`, `icexplorer-xtop` included), no `hima-atcs-xtop-operator` container, and the recorded XTop
  pid was gone.
- **Close by SIGTERM, w03** (TERM to the wrapper's process group, stdin still open). READY, then the identity
  query. The wrapper logged `close (terminate)` and exited 0 20.6 s later, again with no process and no
  container left.
- **Normal exit, w02** (v13's session command list through v14, under `script`):
  - READY; one kept `atcs_size_cell` (BUFFD1 to BUFFD2), and the identity query answered BUFFD2.
  - Source and exec writes were denied.
  - Export succeeded, with `save_workspace` and no "Directory exists".
  - `ATCS:taint:clean`, then `exit`: exit 0 in 40 s, with no SyntaxWarning, no process and no container left.
  - The transcript sha is `5139eaae...`.
- **Slot hygiene:** each killed XTop left the attempt-1 shape (44 hard-linked `.exclusive.cdslck*` files).
  The v14 preflight moved each session's leftovers, `session.json` included, to `r1.attempt-<k>/` by rename:
  the inode/path listings match, and nothing was deleted.
- **The Harness's own close, zero EDA:** `qual-tools/v14-tmux-close.sh` starts a stand-in the way
  `interactive-job.ts` starts a Job. The stand-in is v14's own launch-and-close block with `exec xtop` replaced
  by `exec cat`, which is also PID 1 and also ignores TERM. The script then respawns the pane with the Harness's
  close watcher, byte for byte (hangup 15 s, TERM 10 s). The receipt read `gone terminate` at 20.6 s, inside the
  25 s window. The same replay on a stand-in built from v13's bytes read `survived`, which reproduces D-T02-2.

The licence status stayed `selected=old` throughout. v13 is retired for new kits. It stays installed as
evidence, and the Permit keeps it in `allowedWrappers` for retained Runs.

Previous candidate (Issue 64, before treatment attempt 2, Pack 0.2.0): `atcs-xtop-operator-v13.sh` under
`operator-admin/atcs-v13/` (wrapper sha `9f54c9cd...`, installed 2026-09-29, mode 0555), with the six-slot
verifier copied beside it (`verify-worker-startup.py`, sha `014fcfa5...`, the same bytes as v10-v12's), the
slot step `fresh-worker-slot.py` (sha `293b2a3f...`, the bytes in this directory) and bootstrap root
`operator-admin/atcs-v13/bootstraps/`. The Pack's `xtop-operator` binding names v13 and the Permit reads
`atcs-v13` until v14.

Why: `prepare-workers` picks a slot's round directory `workspaces/<slot>/r<N>` once per plan, and the Harness
retries the operate node with the same argv. So every attempt of one plan lands in the same `r<N>`. In
treatment attempt 1, slot w02's retries met attempt 1's XTop workspaces and 44 hard-linked
`.exclusive.cdslck*` files. The verifier refused attempts 2 and 5 ("writable slot contains a multiply linked
file"), and attempt 4's XTop stopped at `save_workspace` ("Directory exists"). Before the verifier, v13 runs
the pinned slot step. It moves every entry of `r<N>` except `manifest.json`, `operator.tcl` and
`xtop-analysis-manual.tcl` into `workspaces/<slot>/r<N>.attempt-<k>/`. Nothing is deleted, and a first
attempt is left alone (`test_verify_worker_startup.RetrySlotTest`). It never ends a process: a close the
Harness records as `process-survived` still needs a person to end that wrapper's container before the retry.
This is a v12 and v13 limitation.

Derivation (`qual-tools/derive-v13.sh`): v13 was derived on the server from the *installed* v12 bytes (sha
`6656badf...`, checked first). Only the template's v12 to v13 change was applied: the `atcs-v13` paths, the
usage name, the header comment, the `fresh_slot`/`fresh_slot_sha256` pins, and the slot step before the
verifier. The image, adapter (`2b001eda...`), flow (`a4736851...`), verifier and Site-profile pins are
v12's, unchanged. Two checks confirm the derivation:
- `diff` against installed v12 shows exactly those hunks.
- `atcs-xtop-operator-v13.sh` in this directory, with its six placeholders filled from those pins, is
  byte-identical to the installed file.

`grep REPLACE` hits one comment line. The kit's `wrapper-pins-pack-flow` check passes against the
installed v13.

Qualification (2026-09-29, `atcs-runs/qual-atcs13-20260929`: a native baseline, plan and
`prepare-workers` on this branch's flow, digest `a4736851...`):
- **Own preflight** (`qual-tools/v13-preflight.sh`, the installed wrapper's lines up to the container
  launch):
  - OK for w01..w03.
  - Refused for parked w04..w06 (exit 3, by the slot step) and for w07 (exit 2).
  - Refused for the older `e6ccfabc...` flow at the adapter check (exit 3,
    `qual-atcs13neg-20260929`).
  - Refused with a slot-step pin changed by one digit (exit 3, "administrator slot step identity
    changed").
- **Retry slot, w02:** the retained attempt-1 shape was planted (22 hard-linked lock pairs, the XTop
  workspace directories, session outputs and a private home).
  - The verifier alone refused it ("multiply linked file").
  - v13 moved all of it to `r1.attempt-1/` with the same inodes and paths (nothing deleted or copied),
    then passed.
  - A second leftover went to `r1.attempt-2/`.
- **Real session, w01:** one real wrapper-launched XTop session on a retried slot. The planted attempt-1
  shape, including an old `swerv_wrapper_operator_candidate/`, moved to `r1.attempt-1/`, and XTop then:
  - reached READY and answered the identity query;
  - kept one size mutation;
  - was denied source and exec writes;
  - exported, with `save_workspace` succeeding and no "Directory exists";
  - closed clean with exit 0 and no SyntaxWarning, in 38 s.
  
  Afterwards no XTop process and no `hima-atcs-xtop-operator` container remained. The licence status
  stayed `selected=old` throughout. The transcript sha is `3bbd8820...`.

v12 is retired for new kits. It stays installed as evidence, and the Permit keeps it in `allowedWrappers` for
retained Runs.

Previous candidate (Issue 64 Task 7 fix round 2, Pack 0.2.0): `atcs-xtop-operator-v12.sh` under
`operator-admin/atcs-v12/` (wrapper sha `6656badf...`, installed mode 0555), with the six-slot
administrator verifier copied beside it (`verify-worker-startup.py`, sha `014fcfa5...`, the same bytes as
v10's, v11's and this directory's) and bootstrap root `operator-admin/atcs-v12/bootstraps/`. It was
derived on the server from the *installed* v11 bytes with only these changes: the `atcs-v12` paths, the
verifier path, the pinned flow digest (`a4736851...`; `atcs_cli.py` `2b001eda...` is unchanged from v11)
and the header comment. Qualified by its own preflight (`qual-tools/v12-preflight.sh`, the wrapper's
lines up to the container launch): OK for w01..w03 on a native `prepare-workers` of the final flow,
refused for parked w04..w06 and for w07, refused for the v11 flow by the verifier's flow digest ("flow
bytes differ from the qualified source", since its `atcs_cli.py` is byte-identical) and for the v10 and
0.1.8 flows at the adapter check; and by a real wrapper-launched XTop session (READY, identity query,
one kept mutation, source and exec writes denied, export, clean close, no SyntaxWarning). The Permit
read `atcs-v12` only until v13. Capacity is `parallelJobs: 6` and `xtop: 6` for the six parallel worker branches;
Innovus, StarRC and PrimeTime stay 1 (the refresh is serial).

Previous candidate (Issue 64 Task 7 fix round 1): `atcs-xtop-operator-v11.sh` under
`operator-admin/atcs-v11/` (sha `1d99681a...`), derived from the installed v10 with the `atcs-v11` paths
and the fix-round-1 identities (`atcs_cli.py` `2b001eda...`, flow `ea4556ca...`).

Previous candidate (Issue 64, Pack 0.2.0 before fix round 1): `atcs-xtop-operator-v10.sh` with its own
verifier under `operator-admin/atcs-v10/` (wrapper sha `3f2979ba...`), derived from the installed v9 with
the `atcs-v10` paths, slots `w01`..`w06`, the six-slot verifier (the installed v8/v9 verifier refuses
every 0.2.0 active slot, "generated Tcl differs") and the 0.2.0 identities.

Like every wrapper file here, `atcs-xtop-operator-v12.sh` is a template: it equals the installed v12
except that its pinned image, adapter, flow, verifier and Site-profile values are `<REPLACE-...>`
placeholders. Install a new version by editing the *installed* previous wrapper, never by copying a
template, and check that no `<REPLACE-...>` value remains outside comments.

Previous candidate (Issue 63, Pack 0.1.8): `atcs-xtop-operator-v9.sh` under `operator-admin/atcs-v9/`, installed
sha `259c67b3...`. Retired: `atcs-v8` was installed from this template with its placeholders
unfilled, so every operator session refused at the adapter check (Run 789b90d8); it stays on the Site as
evidence and no Permit or contract names it. Previous candidate (Pack 0.1.4):
`atcs-xtop-operator-v7.sh` under `operator-admin/atcs-v7/`. Previous candidate (Pack 0.1.3): `atcs-xtop-operator-v6.sh` and
`xtop-operator-environment-v6.template.json` under `operator-admin/atcs-v6/`. v6 is the qualified v5
wrapper with only the `atcs-v6` paths and the new pinned `atcs_cli.py`/flow identities (honest no-fix
capture); the verifier and Site profile bytes are unchanged.

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

### Timing-only analysis contract (#64 treatment attempt 3, 2026-09-29)

The user decided the ATCS comparison is timing only: DRC/connectivity deltas are recorded but must not
stop the treatment Run. `inputs/analysisContract-timing-only/` is installed on the server at
`/data/eda/project/hima_harness/atcs-inputs/analysisContract-timing-only` (files mode 0444). A Campaign
selects it through its Campaign file (`inputs.analysisContract`); the Site's own binding is unchanged.
- It is byte-identical to `analysisContract/` except `policy.json` (sha256 `e2b9cd9e...`):
  `allowDegradedWorking` true and `maxNewConstraintFailures` 1000000 (the `verify_drc -limit` /
  `verifyConnectivity -error` bound), with `degradeLimitNs` still 0.0.
- Effect in the Pack, with no Pack byte changed: a refreshed candidate whose only fault is new DRC or
  connectivity identities moves the `working` pointer, so the next generation builds on it. Any WNS
  regression against the anchor is still refused. A truncated physical report is still an evidence gap.
  `best`, `delivery` and the goal-met gate still require zero new physical identities, and the evaluation
  still records every delta.
- Proof, with no EDA and no SSH: `python3 sites/linglong-atcs28/test_timing_only_contract.py -v`. The
  Host side is the dry path's "timing-only contract" test in `test/contract/atcs-dry-path.host.test.ts`.

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
   Pack's own root) that exercises the XTop expert toolkit's reads (`atcs_ref`, `atcs_gain`,
   `atcs_paths`, `atcs_fail_reasons`, `atcs_candidates`), at least `atcs_size_cell` and `atcs_undo`
   (mutate), `atcs_dump_cells`/`atcs_export_changes` (save) and `atcs_close`, confirming source/exec
   writes stay denied and the session exits normally. The #64 upgrade replaced the earlier
   `atcs_query_paths`/`atcs_query_cells`/`atcs_delete_buffer` procedures; the command classification
   (and so `commandsDigest`) changed with it.
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

This wrapper has no batch path. Since Issue #64 Task 5 the `xtop-operator` tool is `hybrid`, but its
batch path is the Pack's own `python3 flow/atcs_cli.py operate-parked` no-op for a parked or skipped
slot, which never calls this wrapper or XTop; the wrapper always launches one interactive XTop session
per call and exits when that session closes.
