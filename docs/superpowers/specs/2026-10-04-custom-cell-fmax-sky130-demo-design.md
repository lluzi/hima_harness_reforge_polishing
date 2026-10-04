# Custom-cell Fmax demo on open-source SKY130 — design

Date: 2026-10-04. Branch: `customer-demo` (worktree
`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/worktrees/customer-demo`, HEAD at time of
writing `cd89a585`). Status: approved design, not yet implemented. Written for a fresh implementation
session; everything a builder needs that is not in the repo is recorded here.

## 1. Goal

A third customer demo for HimaHarness, after ATCS Fix Timing and QuaLib Insight
(`docs/product-demo/customer-demo/README.md`):

> The person asks HimaHarness for a faster design. One Campaign runs a baseline RTL-to-GDS flow, then a
> resident OpenCode agent digs into the result, proposes new standard cells (single-output and
> multi-output), builds them, re-maps or ECOs the design, and the measured Fmax goes up. The agent
> keeps pushing Fmax for several rounds and learns from each measured success and failure.

The selling point is the learning loop: a resident agent that proposes, a Harness that measures
honestly, and lessons that change the next proposal.

### Decisions already made with the user (do not re-open)

| Topic | Decision |
| --- | --- |
| Tool path | **Open-source SKY130** (IIC-OSIC-TOOLS container on linglong), not TSMC28 commercial |
| New-cell timing | **Modelled Liberty + control arm.** Real layout; Liberty estimated from foundry tables with a stated per-cell physical derate; every round runs a matched control arm with custom cells forbidden. Label: "custom-cell timing modelled, not characterized" |
| Multi-output | **Both**: single-output cells carry the happy path; multi-output cells are attempted through `emap` (mockturtle) local remapping of critical cones. If it works it is the headline |
| Shape | **Approach A**: thin demo Pack; one resident OpenCode engineering task per round; two measured ORFS arms in parallel; Reader + judges; loop |
| Loop | Keep pushing Fmax; agent learns from measured lessons; **up to 4 rounds, ~5 h wall clock; stop after 2 consecutive non-improving rounds**; Goal ≥ 5 % Fmax over the stock baseline, measured at the same clock as the stock reference (§5) |
| Agent model | `deepseek/deepseek-flash` through OpenCode (same as ATCS demo) |
| Delivery | Demo-only Pack and Site on `customer-demo`; recordings and screenshots in zh and en like the other demos |

### Non-goals

- No signoff claim, no silicon claim, no SPICE characterization of new cells in this demo.
- No TSMC28 / Design Compiler / Innovus in this demo. The existing `packs/custom-cell-fmax-dtco`
  (TSMC28, 5.2.23) is not modified.
- No Fabric/runtime redesign. If a Harness change is unavoidable, it must be the smallest fix at an
  existing seam and must be recorded in the README fix table as "port to migration".
- No comparison with other products or with "a no-brainer flow" inside the App.

## 2. Evidence the design rests on (read before building)

All on linglong, `/data/eda/project/celluzi/` (the user's earlier SKY130 custom-cell project;
**treat as read-only**, never write into it):

- `README.md`, `STATUS.md`: milestones, how tools run (`scripts/osic.sh`), ORFS runner
  (`scripts/run_orfs.sh`), determinism ledger `env/tool-versions.lock`.
- `docs/METHODOLOGY.md` (377 lines). Key lessons that become the agent's playbook:
  - Cross-library comparisons are invalid: synthesis is deterministic but library-sensitive, so
    adding cells (even dont_use) changes the netlist. Measure with matched arms that differ only in
    whether custom cells may be used.
  - The zero-delay bound (`set_timing_derate -late -cell_delay 0.0` on the custom cells) bounds what
    the cells can contribute.
  - Commercial flow bug found there: post-route optimisation was missing; always end with post-route
    repair. (ORFS does this; keep it on.)
  - Final July conclusion: on aes/sky130hd/3.6 ns, 15 real DRC/LVS-clean cells, 52 adopted, gave ~0
    gain versus a control arm. Custom cells pay off only near closure with a few dominant cones.
- `docs/NOR3_PU2_ADOPTION_RESULT.md`: the one positive, **modelled** result. Real DRC/LVS-clean
  rise-skewed NOR3 (`NOR3_PU2`, doubled pull-up), Liberty from foundry nor3_1 tables with rise ×0.6
  (`scripts/estimate_lib.py enhance`, banner "MODELED TIMING — NOT MEASURED"), LEF normalised by
  `scripts/fix_lef_sky130hd.py`, injected by `generate/run_orfs_est.sh`. OpenROAD's resizer adopted 14
  instances voluntarily; WNS −0.37 → −0.13 ns, TNS −3.95 → −2.04 ns at **global route**, versus a valid
  control (ctrl2) identical to golden. Derate sweep: adoption starts at ~2.5 % modelled advantage;
  the resizer takes the weakest cell that fixes each path. ORFS is σ = 0 deterministic.
  - The **invalid control** lesson: `DONT_USE_CELLS=X` on the make command line wipes the
    platform's own dont-use list (36 lpflow/probe cells). The control must pass the full resolved
    platform list plus the custom cells.
  - LEF power pins must match the Liberty `pg_pin`s (VPWR/VGND/VPB/VNB) or the cell is never used.
- Golden baseline: `data/golden/aes_golden_metrics.json` (clk 3.6 ns, finish setup WNS −0.249 ns,
  TNS −1.913, die 225,806 µm², 37,939 instances, power 0.548 W, DRC 0).
- Tools present: `scripts/` (estimate_lib.py, fix_lef_sky130hd.py, fix_lef_obs.py, merge_lib.py,
  skew_lib.py, model_fused_cell.py, compose_netlist.py, defuse_netlist.py, swap_pairs.py,
  mine_pairs.py, collect_metrics.py, librecell_sky130_tech.py, patch_lclayout_*.py, patch_welltap.py,
  postprocess_cell.py, mock_char.py, osic.sh, run_orfs.sh, …); `generate/` (run_drc_cell.sh,
  extract_pipeline.sh, lvs_src/, lvs_ref/, render_gds.py, run_orfs_est.sh, lclayout_cells/*.sp for
  FUSE_* and NOR3_PU2 …); `detect/` (critical-path fusion detector, `run_critpath.py`,
  `data/runs/candidates.json`); LibreCell venv `tools/librecell_venv`.
- Other: `/data/eda/project/bool2cmos` (Boolean function → transistor SPICE).

Container facts (verified 2026-10-04): image `localhost/iic-osic-celluzi:2026.06` (base
`docker.io/hpretl/iic-osic-tools:2026.06` + python3-dev for lclayout). Inside: Ubuntu 24.04, Yosys
0.66, OpenROAD 26Q2-2270-g4c26918f5, OpenSTA, KLayout, Magic, Netgen, ngspice, g++ 13.3, cmake, git.
`lclayout` is not on PATH (it lives in the celluzi venv). The image entrypoint is a VNC UI: always run
with `--entrypoint /bin/bash` (see `scripts/osic.sh`). Run rootless with `--userns=keep-id`.

ORFS: `/data/eda/project/celluzi/OpenROAD-flow-scripts` at `a15fd190c9ba…` (patched by
`scripts/patch_orfs.py`, cosmetic). Design config `flow/designs/sky130hd/aes/config.mk`
(`CORE_UTILIZATION 35`, `PLACE_DENSITY_LB_ADDON 0.2`, `OPENROAD_HIERARCHICAL 1`,
`REMOVE_ABC_BUFFERS 1`), SDC `constraint.sdc` (`clk_period 3.6`, io 20 %). `SYNTH_NETLIST_FILES` is
supported (skip synthesis, use a given netlist). Baseline flow ≈ 17–20 min on this box.

Server: `luzi@192.168.50.41` (hostname linglong), 32 threads, ~117 GiB RAM, shared with other users.
No outbound internet: anything from GitHub must be fetched on the Mac and copied over.

External references (for the playbook and the demo narrative, not dependencies):

- A. Tempia Calvino, G. De Micheli, "Technology Mapping Using Multi-output Library Cells" (EPFL;
  mockturtle `emap`). Global mapping with multi-output cells; gains are mainly area (−7.5 %), delay
  −0.5 %; random-logic-compression multi-output cells do not help global mapping, and the authors
  recommend local remapping of small windows for them. URL
  `https://infoscience.epfl.ch/server/api/core/bitstreams/0f84d4b9-a2a7-4fe5-b636-cf0a3d3f9713/content`.
- ckchengucsd (UCSD, C.-K. Cheng): SMTCell 2.0 (CP-SAT + KLayout layout generator, PROBE3 3 nm
  FinFET/CFET only, BSD-3), SO3-Cell (ICCAD 2025; multi-output HA/FA/2-bit FF libraries; +0.3–2.2 %
  frequency, mostly power/area gains; needs Gurobi and Cadence signoff), L2L (DAC 2026), Free-Topology
  TNS (ICCAD 2026, 22-transistor full adder). None targets SKY130; use them in the narrative only.

## 3. Architecture

```
bind-inputs → baseline (ORFS aes, stock sky130hd, clock P0) → read-baseline
   ↓
engineer  (resident OpenCode task, round k)  ◀───────────────────────┐
   ↓ result: state/round-recipe.json (+ cells/r<k>/… support files)    │
   ├─ arm-custom   (ORFS with recipe, custom cells allowed)            │  parallel
   └─ arm-control  (ORFS with recipe, custom cells forbidden)          │
   ↓ (each arm → its own reader)                                       │
arms-joined (judge: both arms finished with readable metrics)          │
   ↓                                                                   │
compare-round (tool: round record + lessons.json + best library)       │
   ↓                                                                   │
read-round (Reader) → judge-round (rules) → next-round (explore) ──────┘ revisit while
   └─ goal met / converged (2 non-improving) / round limit 4 → finish    rounds remain
```

Units and responsibilities:

| Unit | Kind | Owns | Must not |
| --- | --- | --- | --- |
| `bind-inputs` | Pack tool | Verify Site bindings: image digest, ORFS commit, design config, PDK, celluzi toolbox files; write `state/inputs.json` with SHA-256 of each | Run EDA |
| `baseline` | Pack tool | ORFS full flow (synth→finish) with stock lib at P0 into `runs/baseline/` (WORK_HOME); write `state/baseline.json` | Touch celluzi tree |
| `read-baseline` | Reader | Facts: `baseline_fmax_mhz`, `baseline_wns_ns`, `baseline_drc`, `baseline_valid` | |
| `engineer` | Pack tool with `outsourcing:` (resident OpenCode) | Dig, propose, build cells, choose recipe; deliver `state/round-recipe.json` + support artifacts under `cells/r<k>/` | Run the measured arms, change the Goal, write lessons or judge facts |
| `arm-custom`, `arm-control` | Pack tools (same script, `--arm`) | Run ORFS with the recipe into `runs/r<k>/<arm>/`; write `state/arm-<arm>.json` | Interpret results |
| `read-arm-*` | Readers | Arm facts (finished, Fmax, WNS, DRC, custom instance count) | |
| `arms-joined` | Judge | Both arms produced metrics (join point) | |
| `compare-round` | Pack tool | Deterministic round record, append `state/lessons.json`, update `state/best.json`, write `derived/round-<k>.md` and cell images | Use model text as a fact |
| `read-round` | Reader | Round facts (below) | |
| `judge-round` | Judge | Rules below | |
| `next-round` | Explore + chooser | Goal met → finish; else revisit `engineer` until limit/convergence | |
| `finish` / `blocked` | Explore / wait | Final summary; hard blocker only for a broken Site | |

### 3.1 Pack

New Pack `packs/custom-cell-fmax-sky130-demo/` (id `custom-cell-fmax-sky130-demo`, version `0.1.0`,
`status: development`). Use `packs/libinsight-offline-demo/` as the structural template and
`packs/agentic-timing-closure-system/` for the `outsourcing:` block. Files:

```
contract.yml graph.yml semantics.yml INTENT.md SPEC.md FABRIC.md TEST.md
flow/cellfmax_cli.py            # one CLI: bind | baseline | arm | compare | finish (python3, stdlib only)
flow/orfs_arm.sh                # container launcher (see 3.3)
flow/toolbox/                   # copied celluzi tools + new emap driver sources (see 3.4)
tools/read-baseline.py tools/read-arm.py tools/read-round.py   # Reader scripts (must live in tools/)
readers/*.yml rules/*.yml choosers/*.yml
knowledge/cell-playbook.md knowledge/toolbox.md knowledge/evidence-and-claims.md
```

Hard-won Pack-loading facts from the LibInsight demo (do not rediscover):

- Tool scripts referenced by `tools[].file` must live under `flow/` and be listed in
  `workspace: {source: pack, copy: [...]}` relative to `flow/` (LibInsight 0.1.0 failed with
  "does not hold the declared flow entry"). Reader scripts stay under `tools/`.
- Installing the same Pack id+version again is refused ("export destination already exists"); every
  reinstall needs a new version. Upgrading a tested release needs the UI flow; keep the old install
  in the kit `backup/` if you must move it.
- The Permit hash is part of `siteDigest`; changing the Permit invalidates running Runs (cancel via
  owner chat and start a fresh Campaign).

`contract.yml` essentials:

- `inputs`: `orfsRoot` (read-only ORFS checkout), `celluziRoot` (read-only toolbox source),
  `designConfig` (`designs/sky130hd/aes/config.mk` relative to ORFS flow), `containerImage`
  (image id/digest), `bool2cmosRoot`, `workspaceRoot`.
- `goal`: `target_fmax_gain_pct` {number, unit %, min 0.1, max 50, default 5}.
- `strategy`: `baselinePeriodNs` {number, ns, default 3.6}; `roundLimit` {count, default 4};
  `armTimeoutMin` {min, default 60}.
- `budget`: `timeBoxMs: 18000000` (5 h), `closingReserveMs: 900000`.
- `environment.wrappers`: `[/usr/bin/python3]` (and whatever wrapper path the arm launcher needs;
  must also be in the Permit `allowedWrappers`).
- `outputs` (paths in the Campaign workspace): `inputsState` `state/inputs.json`; `baselineState`
  `state/baseline.json` (reader `cellfmax-baseline`); `roundRecipe` `state/round-recipe.json`
  (produced by `engineer`); `armCustom` `state/arm-custom.json`, `armControl`
  `state/arm-control.json` (reader `cellfmax-arm`); `roundRecord` `state/round.json` (reader
  `cellfmax-round`); `lessons` `state/lessons.json`; `best` `state/best.json`; `summary`
  `derived/summary.md`.
- `engineer` tool `outsourcing:` block:

  ```yaml
  outsourcing:
    role: resident-engineering-agent
    reads: [inputsState, baselineState, lessons, best]
    knowledge: [cell-playbook.md, toolbox.md, evidence-and-claims.md]
    artifactPrefix: cells
    produces: roundRecipe
  ```

  Its `argv` is the deterministic validator that runs after delivery (pattern of ATCS
  `engineering-result`): `python3 ${WORKSPACE}/flow/cellfmax_cli.py recipe ${WORKSPACE}` — checks
  the recipe schema, that every referenced file exists under `cells/r<k>/` with the stated SHA-256,
  that every new cell has `.lib`, `.lef`, `.sp` (and `.gds` when claimed), that Liberty and LEF pin
  sets match (incl. VPWR/VGND/VPB/VNB), and that the cumulative library contains every cell of
  `best.json` byte-for-byte.
- Its `description` is the agent's standing instruction (see §4 for content).

### 3.2 Round recipe (`hima-cellfmax-round-recipe/1`)

Written by the agent as its single `result` artifact. Support artifacts are new paths under
`cells/r<k>/` every round: the resident materializer refuses a support path that already holds
different bytes ("use a fresh revisioned artifact path"), while the result path may be overwritten.

```json
{
  "schema": "hima-cellfmax-round-recipe/1",
  "round": 2,
  "periodNs": 3.6,
  "synthesis": { "method": "orfs-abc" }
               | { "method": "emap-window", "netlist": "cells/r2/aes.emap.v",
                   "controlNetlist": "cells/r2/aes.emap-stock.v",
                   "equivalence": "cells/r2/equiv.log" },
  "library": {
    "lib": "cells/r2/custom.lib",          // custom cells only, merged by the arm launcher
    "lef": "cells/r2/custom.lef",
    "cells": [
      { "name": "NOR3_PU2", "outputs": ["Y"], "origin": "r1",
        "function": "Y=!(A|B|C)", "layout": "drc-lvs-clean" | "abstract",
        "timingModel": { "method": "estimate_lib", "base": "sky130_fd_sc_hd__nor3_1",
                          "derate": { "rise": 0.6 }, "reason": "two parallel PMOS fingers in pull-up" },
        "files": { "sp": "...", "gds": "...", "lef": "...", "lib": "..." }, "sha256": { ... } }
    ]
  },
  "hypothesis": "short text: what this round expects and why",
  "evidence": ["cells/r2/notes.md", "cells/r2/top-paths.txt"]
}
```

`origin` names the round that first built the cell; old cells must be byte-identical to `best.json`.
Up to 10 new cells per round (keep the demo legible). A multi-output cell lists several outputs and
must come with `emap-window` synthesis and an equivalence log.

### 3.3 Measured arms

One launcher, two arms, same recipe. `flow/cellfmax_cli.py arm <WORKSPACE> <custom|control>` writes
an `orfs_arm.sh` invocation:

```
podman run --rm --entrypoint /bin/bash --userns=keep-id --cpus=8 \
  -v <orfsRoot>:<orfsRoot>:ro -v <campaign>/runs/r<k>/<arm>:/work:rw -v <campaign>/cells:/cells:ro \
  <image> -lc 'cd <orfsRoot>/flow && make DESIGN_CONFIG=./designs/sky130hd/aes/config.mk \
     WORK_HOME=/work FLOW_VARIANT=<arm> OPENROAD_EXE=/foss/tools/bin/openroad \
     OPENSTA_EXE=/foss/tools/bin/sta YOSYS_EXE=/foss/tools/bin/yosys KLAYOUT_CMD=/foss/tools/klayout/klayout \
     LIB_FILES=<merged lib> ADDITIONAL_LEFS=<custom lef> DONT_USE_CELLS="<platform list> [+ custom cells]" \
     [SYNTH_NETLIST_FILES=<netlist>] [clock override] finish'
```

Requirements:

- **Never write into the ORFS checkout or celluzi.** All outputs go to `WORK_HOME` in the Campaign.
  Verify with a dry run that ORFS writes nothing under `<orfsRoot>` with `WORK_HOME` set; if it
  does, copy `flow/` (without `results/logs/objects`) into the Campaign once at `bind-inputs`.
- **Merged lib**: platform sky130hd lib + custom cells (use `merge_lib.py`). Both arms load the
  same merged lib and LEF; they differ only in `DONT_USE_CELLS`.
- **Control dont-use**: resolve the platform's full dont-use list (from the platform `config.mk`) and
  append all custom cell names. Assert after the run: control arm final netlist has 0 custom
  instances and 0 lpflow/probe cells; custom arm has 0 lpflow/probe cells.
- **Clock**: write a per-round SDC copy with `clk_period = periodNs` and pass `SDC_FILE`; both arms
  share it. The baseline uses 3.6 ns.
- **emap rounds**: custom arm uses `SYNTH_NETLIST_FILES=<netlist>`; control arm uses
  `<controlNetlist>` (same window remapped by `emap` with custom cells removed from the genlib).
  That keeps the comparison "same mapper, with vs without custom cells".
- Arms run in parallel (two Jobs). Timeout `armTimeoutMin`. On failure, write the arm JSON with
  `finished: false` and the tail of the ORFS log; do not throw.
- Arm JSON (`hima-cellfmax-arm/1`): `arm`, `round`, `periodNs`, `finished`, `wnsNs`, `tnsNs`,
  `fmaxMhz = 1000 / (periodNs − wnsNs)` (WNS ≤ 0 or > 0 alike; worst setup slack of all paths in the
  finish report), `areaUm2`, `powerW`, `routeDrc`, `instances`, `customInstances` (per cell, counted
  in the **final routed netlist** `6_final.v`), `forbiddenInstances` (lpflow/probe), top 20 setup
  paths with custom cells marked, and SHA-256 of every source file read.

### 3.4 Agent sandbox and toolbox

- New capability file `sites/linglong-sky130-cells/engineering-capabilities-sky130.json`, copied
  from `sites/linglong-atcs28/engineering-capabilities-v2.json` (schema
  `hima-resident-engineering-capability/1`). Change: `sandbox.image` = image id of
  `localhost/iic-osic-celluzi:2026.06` (resolve with `podman image inspect --format '{{.Id}}'`);
  `readOnlyRoots` = celluzi root, bool2cmos root, ORFS root, the installed toolbox dir; remove the
  TSMC28/Empyrean roots and licence env; keep `native` (OpenCode 1.18.34, `acp --pure`,
  `deepseek/deepseek-flash`), keep `wrapper.argv` pointing at the **installed v2 wrapper**
  `/data/eda/project/hima_harness/operator-admin/resident-engineering-v2/resident-engineering-wrapper.py`
  with `--capability <this file>`. Install the capability file next to it on the server
  (`operator-admin/resident-engineering-v2/engineering-capabilities-sky130.json`), never edit the v2
  ATCS capability.
- Check first that the OpenCode binary (`/home/luzi/.opencode/bin/opencode`, bind-mounted read-only by
  the wrapper) runs inside the Ubuntu 24.04 image, and that the image's entrypoint does not break the
  wrapper's `podman run` (the wrapper passes its own command; if the VNC entrypoint interferes, the
  wrapper or capability must allow an entrypoint override — this would be a small wrapper change: add
  an optional `sandbox.entrypoint` field, test it in `sites/linglong-atcs28/test_resident_engineering_wrapper.py`,
  and install as v3 beside v2).
- The wrapper's sandbox is `--read-only` with a private workspace and home. ORFS trial runs by the
  agent must use `WORK_HOME` inside its private workspace.
- Toolbox (`flow/toolbox/`, copied into the Campaign by `workspace.copy`; document each in
  `knowledge/toolbox.md` with exact command lines):
  - From celluzi (copy the files into the Pack; record source path and SHA-256 in
    `flow/toolbox/SOURCES.json`): `estimate_lib.py`, `skew_lib.py`, `model_fused_cell.py`,
    `fix_lef_sky130hd.py`, `fix_lef_obs.py`, `merge_lib.py`, `compose_netlist.py`,
    `collect_metrics.py`, `render_gds.py`, `run_drc_cell.sh`, the LVS scripts, the critical-path
    detector (`detect/`), LibreCell tech `librecell_sky130_tech.py` and its `patch_lclayout_*.py`
    usage notes. LibreCell itself runs from `celluzi/tools/librecell_venv` (read-only root).
  - `bool2cmos` from `/data/eda/project/bool2cmos` (read-only root).
  - **New `emap` driver** (`flow/toolbox/emap/`): build mockturtle (github.com/lsils/mockturtle,
    pin a commit; fetch on the Mac, copy the source into the Pack or the Site install dir; the
    server has no internet). A small C++17 driver `emap_window`: read an AIGER (written by Yosys for
    the selected window), a genlib built from the merged Liberty (multi-output cells expressed as
    repeated GATE entries with the same cell name, one per output pin — check mockturtle's genlib
    multi-output convention in its `emap` docs/tests), run `emap` delay-oriented with multi-output
    enabled, write a mapped Verilog. A Yosys script cuts the window from the mapped netlist
    (`select` the cone cells → `submod`/`extract`), and stitches the remapped module back. An
    equivalence check of the stitched netlist against the original is mandatory (Yosys
    `equiv_make/equiv_simple/equiv_induct` or ABC `cec` on the window); its log is a recipe file.
    Note: sky130hd already has `fa_*`, `ha_*`, `maj3_*`; `emap` may use those even without custom
    cells, which is why the control arm uses the same `emap` pass with custom cells removed.
  - `hima-mo-resynth` from `packs/custom-cell-fmax-dtco/flow/domain/multi_output_resynth/`
    (3-input/2-output window discovery with exhaustive proof + Yosys equivalence) as an alternative
    window finder.

### 3.5 Site and Permit

`sites/linglong-sky130-cells/{site.yml,permit.yml,README.md}`:

- `kind: ssh`, `ssh.destination: luzi@192.168.50.41`, `workspaceRoot:
  /data/eda/project/hima_harness/cellfmax-runs` (create it), `permit: ./permit.yml`.
- `bindings`: `orfsRoot`, `celluziRoot` (`/data/eda/project/celluzi`), `designConfig`,
  `containerImage`, `bool2cmosRoot`, `engineeringCapabilities` (the new file), `workspaceRoot`.
- `capacity`: `cores: 24`, `memoryGiB: 64`, `parallelJobs: 3`, no licences.
- `permit.yml`: `allowedReadRoots` = celluzi, bool2cmos, ORFS root, operator-admin
  resident-engineering-v2 (and v3 if built), cellfmax-runs; `allowedWriteRoots` = cellfmax-runs;
  `allowedWrappers` = the resident wrapper path, `/usr/bin/python3`, `python3`; `forbidden` as in
  `sites/linglong-atcs28/permit.yml`.
- The installed copy in a Home needs the same file-name convention as the ATCS demo (Site file plus
  `permit.yml` next to it; see the kit Home prep script in §7).

## 4. The agent's task and playbook

`engineer` tool `description` (standing instruction; keep it concrete):

> Own one round of custom-cell work on aes/sky130hd. Read the baseline facts, `lessons.json` (every
> earlier round's measured result, with adopted cells, gains, failures and remaining top paths) and
> `best.json` (the best cumulative library so far). Find where the critical paths spend time; propose
> up to 10 new cells that could shorten them (skewed or upsized variants, fused single-output cells,
> multi-output cells for shared-input cones); build each one (bool2cmos SPICE → LibreCell layout →
> DRC/LVS where possible → LEF normalised to sky130hd → modelled Liberty with a stated physical
> reason for every derate); optionally remap critical windows with `emap` (multi-output cells only
> enter this way, with a passing equivalence check); choose the clock period for this round (tighten
> it when the last round met timing). You may run quick trial ORFS runs in your private workspace to
> check adoption. Deliver one `hima-cellfmax-round-recipe/1` with every file under `cells/r<k>/`. Do
> not run the measured arms, change the Goal, claim measured cell timing, invent metrics, or drop a
> cell from the best library.

`knowledge/cell-playbook.md` (≤ 2 pages) — condensed rules from §2: matched arms only; cells pay off
on a few dominant cones near closure; the resizer satisfices; adoption needs a real modelled
advantage (~2.5 % threshold seen) and correct pg_pins; area cost matters (NOR3_PU2 was 2.3× nor3_1);
derates must follow topology (doubled pull-up → faster rise, not "5 % faster everywhere"; drive is
load-dependent); multi-output: global mapping helps area not delay, use local windows on critical
cones, prove equivalence; read the lessons ledger first and do not repeat a failed idea without a new
reason; tighten the clock when timing is met.

`knowledge/evidence-and-claims.md`: what is real (layout, DRC/LVS, adoption, ORFS timing given the
models, matched control), what is modelled (custom-cell Liberty), what is never claimed (signoff,
silicon, characterised timing).

`knowledge/toolbox.md`: each tool, exact command, inputs/outputs, run time, known failure modes
(e.g. lclayout needs the derived image; CharLib is not used in this demo).

## 5. Readers, rules, chooser

Reader outputs follow the LibInsight pattern (`argv: [/usr/bin/python3, '${READER}', '${REPORT}',
'${OUT}']`, `emits: [...]`). Facts:

- `cellfmax-baseline`: `baseline_valid` (1 when finished and DRC 0), `baseline_fmax_mhz`.
- `cellfmax-arm`: `arm_finished`, `arm_fmax_mhz`, `arm_route_drc`, `arm_custom_instances`,
  `arm_forbidden_instances`.
- `cellfmax-round` (from `compare-round`'s `state/round.json`): `comparison_valid` (same period,
  same recipe hash, both finished, both DRC 0, control custom = 0, forbidden = 0 in both),
  `round_gain_pct` = 100 × (custom Fmax / control Fmax − 1) for this round, `best_gain_pct` = the
  largest `round_gain_pct` over valid rounds, `round_improved` (`comparison_valid` and custom Fmax
  above the best valid custom Fmax so far), `custom_adopted` (total custom instances in the custom
  arm's final netlist). Informational only (shown, never judged): `fmax_vs_original_baseline_pct`
  = custom Fmax vs the 3.6 ns baseline.

  **Why the Goal is judged against the round's own control arm.** The control arm is the stock
  reference at the same clock and with the same flow: it loads the same merged lib with every custom
  cell in dont-use. At 3.6 ns with `orfs-abc` it must reproduce the stock baseline exactly (ORFS is
  σ = 0 deterministic). Dry-run step 7.2b checks this, and `compare-round` records it as
  `control_matches_baseline`. When the agent tightens the clock, the stock side is re-measured at
  the new clock, so a gain that only comes from a harder clock target is never credited to the
  cells. `fmax-goal` therefore reads `best_gain_pct`. This is the "≥ 5 % over the stock baseline"
  the user approved, measured at matched conditions.

Rules (`rules/*.yml`, LibInsight syntax): `comparison-valid` (eq 1), `round-improved` (eq 1),
`cells-adopted` (gte 1), `fmax-goal` (`best_gain_pct` gte `target_fmax_gain_pct`).

`judge-round` uses `[comparison-valid, cells-adopted, round-improved, fmax-goal]` and every outcome
goes to `next-round`. `next-round` (explore) chooser `cellfmax-next`: goal PASS → `goalMet`; else next
round. Use `converge` with `generations: 2` and `generationLimit: roundLimit` (pattern:
`packs/custom-cell-fmax-dtco/graph.yml` `next-research` + `choosers/research-next.yml`); verify the
exact chooser/converge semantics in the Harness code before relying on them. `next-round` revisits
`engineer` (`revisit: true`), not the baseline.

`compare-round` keeps the best library: if `round_improved`, `best.json` ← this round's library and
recipe; otherwise `best.json` is unchanged and the round's cells are recorded in `lessons.json` as
tried (with the reason: not adopted / adopted but slower / invalid comparison / build failure).

`finish` writes `derived/summary.md` and `derived/summary.json`: per round Fmax (custom, control),
gain, adopted cells with counts, cell images (`render_gds.py` → PNG for each adopted cell with a GDS),
lessons, final verdict, and the claim boundary text verbatim:

> Custom-cell timing is modelled from foundry tables (estimate_lib, derate stated per cell), not
> characterized. Layouts marked drc-lvs-clean passed KLayout DRC and Netgen LVS. Results are
> open-source ORFS timing on SKY130 under these models; not signoff, not silicon.

## 6. Harness facts the builder must verify early (risk list)

1. **Revisiting an `outsourcing` tool node.** `engineeringTaskId(run.id, execution.id)`
   (`packages/harness/src/engineering-executor.ts:211`) gives each execution a new task, so each
   round is a new OpenCode session; learning is carried by `reads: [lessons, best]`. Confirm that a
   revisit creates a new execution and that `reads` are re-snapshotted per execution.
2. **Support-artifact paths**: per-round `cells/r<k>/` paths; old paths with identical bytes are
   accepted, different bytes refused (`engineering-executor.ts:515-518`). The result path
   (`state/round-recipe.json`) may be overwritten.
3. **Parallel arms + join**: two `act` nodes from `engineer`, each to its reader, both into the
   `arms-joined` judge (pattern: six branches into `merge-join` in `custom-cell-fmax-dtco`).
   Confirm the judge waits for both branches.
4. **Autopilot across the loop**: add `autopilot` ranges (ATCS `graph.yml` lines 5-7 pattern) so no
   owner/human confirmation is needed between rounds; the #39 attempt-10 stall was an owner that
   never continued. Confirm autopilot covers explore decisions and revisits; if not, the owner
   briefing must say to continue.
5. **Resident handoff**: the `customer-demo` handoff fix (`da9c859f`: artifactPrefix in envelope and
   prompt, pre-write refusal is `rejected`, native reply reaches status) is required. Do not base on
   `main`.
6. **Explore `converge`/`generationLimit`** semantics and how a round limit maps to Run endings
   (`ended-goal-met`, `ended-converged`, `ended-budget-exhausted`).

If any item fails, fix at the smallest layer (Pack → Site → existing seam → Harness core), with a RED
test first, and record it in the README fix table.

## 7. Test and delivery ladder

Follow `docs/agents/fast-convergence-testing.md` and the tester skill
`himaharness-human-like-tester-and-bug-fixer` (cycle folder `.hima-tmp/hltbf/<cycle>/`, loop.py,
watch.py). Order:

1. **Local contract tests** `test/contract/custom-cell-fmax-sky130-demo.test.ts` (register in
   `test/contract-groups.json`): Pack loads and fits the Site; every `${NAME}` bound; workspace copy
   entries exist under `flow/`; readers emit declared facts on fixture JSON (valid, invalid
   comparison, control with custom instances, failed arm, period change); recipe validator refuses
   missing files, pin mismatch, mutated old cell, support file outside `cells/r<k>/`; Fmax formula.
   Python unit tests for `cellfmax_cli.py` next to it.
2. **Server dry run, lowest seam first** (real bytes, in a scratch dir under `cellfmax-runs/`):
   a. `baseline` → expect ≈ golden (finish WNS ≈ −0.249 at 3.6 ns, DRC 0). Record runtime.
   b. Hand-built round-1 recipe using the existing `NOR3_PU2` files (celluzi `lib/tlo/_nor3_pu2/`,
      `lib/tlo/_est_nor3_pu2/`) → both arms in parallel → `compare-round`. Expect custom adoption
      > 0, control custom = 0, a positive round gain (July: −0.37 → −0.13 at global route; measure
      at finish). This is the happy-path proof before any agent runs.
   c. `emap` driver on one small critical window: equivalence passes, stitched netlist runs through
      ORFS `SYNTH_NETLIST_FILES`.
   d. Resident sandbox smoke: capability + image + OpenCode start, a trivial task that runs
      `yosys -V` and `openroad -version` and delivers a minimal recipe.
3. **Kit and GUI** (pattern of the ATCS/QuaLib kit, `.hima-tmp/customer-demo-kit/`):
   - Bump `packages/desktop/package.json` to the next trial (currently `0.3.0-trial.37`), commit,
     `node scripts/package-trial.mjs --output <kit dir>` (needs a clean tree).
   - Build first: `pnpm install --frozen-lockfile --store-dir <repo>/.hima-tmp/pnpm-store` (with
     `CI=true` to avoid `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`), then `pnpm run build`.
   - Fresh Home via the scratch Home-prep script pattern (copy Site + Permit into `hima/sites/`, copy
     the `DEEPSEEK_API_KEY` credential natively from a prior Home, never print it).
   - Launch with `nohup perl -MPOSIX -e 'setsid(); exec @ARGV'`, unset `ELECTRON_RUN_AS_NODE` and all
     `DSH_*`. GUI only on the Catsights display (ffmpeg "Capture screen 2", 1920×1200; global AX
     x −1920..0, y 134..1334). One HimaHarness instance at a time.
   - Install the Pack through the UI (fill the "Installed Pack" id field, then Review).
   - One quick GUI round (`roundLimit 1`) to prove wiring, then the 4-round live run.
4. **Recording**: raw segments like the earlier demos (`recordings/07-…`), zh and en: setup, start,
   live graph during a round (two arms in parallel), owner conversation where the agent explains its
   cells, round verdicts, final summary with cell images. Screenshots `screenshots/{en,zh}/cellfmax-*`.
5. **Docs**: README fix table row(s), recorded results section, known limits; Pack `TEST.md` with Run
   ids; commit + push + verify remote SHA after every commit (AGENTS.md).

Done = a finished Run with an honest ending (goal met, converged, or budget), the summary showing
per-round matched Fmax, at least one recording per language, README updated and pushed.

## 8. Standing constraints

- Repo rules: `AGENTS.md`, `docs/agents/polishing-discipline.md`, `docs/agents/model-policy.md`,
  `docs/agents/fast-convergence-testing.md`. Read-only: `/Users/lluzi/code/hima_harness_reforge_claude`,
  `/Users/lluzi/code/himaharness`.
- Server: never kill remote processes; never write into `/data/eda/project/celluzi` or other users'
  projects; be a good tenant (`--cpus` on containers, ≤ 3 concurrent ORFS runs); no licences needed.
- GUI: Catsights only, one HimaHarness instance; operate the product only through its UI and chat
  during the live run.
- Honesty: never present modelled cell timing as measured; keep failed rounds visible; the Reader,
  not the model, produces every number shown as a result.
- Branch: `customer-demo` only; this is demo work, not the DBOS migration.
