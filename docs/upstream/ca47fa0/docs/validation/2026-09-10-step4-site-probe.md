# Step-4 prefactor: read-only probe of what the legacy AES on TSMC28 flow left on the reference Site (#56)

**Date:** 2026-09-10, 19:14–19:29 PDT. **Site:** `linglong` (`luzi@192.168.50.41`), from the main checkout on this Mac. **Who:** the controller (the Site is out of bounds for task agents). **Companion:** [`2026-09-10-step4-site-probe-transcript.txt`](2026-09-10-step4-site-probe-transcript.txt) holds every command sent and its answer, phases A–F, with licence-file contents and licence variables filtered at the source.

**Nothing was written under the Site's project tree.** Every command is a listing, a `stat`, a `grep`, a `find`, a `cat`, a `podman` query, a `--help`, a version print, or an `lmstat` query — with the eight paths the next sentence names, every one of them created under `/tmp` and none of them under the Site's project tree: the seven probe scripts, written there so each phase ran as one file, and the scratch directory `mktemp -d` made. Two things were left on the Site, both under `/tmp`: the seven probe scripts (`/tmp/hima-probe56-phase{A,B,C,C2,D,E,F}.sh`) and one empty scratch directory (`/tmp/hima-probe56-Ci5aCp`) that the version prints ran in — they wrote no file there (phase B, `ls -la` of the directory after the prints). The legacy wall-time and memory figures below come from the reference archive read **on this Mac** (`/Users/lluzi/code/hima-reference-archive-2026-09-08/hima-reference-2026-09-08.tar`), not from the Site.

## 1. Untouched check (acceptance criterion 5)

`stat` before (phase A) and after (phase C) the probe, and a `find -newermt` over the two trees at the end:

| Path | mtime before | mtime after |
|---|---|---|
| `/data/eda/project/design_zoo` | 2026-09-06 03:09:36 | 2026-09-06 03:09:36 |
| `/data/eda/project/hima_harness/archive` | 2026-09-08 21:01:44 | 2026-09-08 21:01:44 |
| `…/archive/hima-reference-2026-09-08.tar` | 2026-09-08 21:01:43 | 2026-09-08 21:01:43 |
| `…/hima_harness/opene902-timing-probe-20260909-194716-c76d` (step 2) | 2026-09-09 12:47:18 | same |
| `…/hima_harness/opene902-timing-probe-20260909-195006-2dea` (step 2) | 2026-09-09 12:52:57 | same |
| `…/hima_harness/opene902-timing-probe-20260910-221158-96d7` (step 3) | 2026-09-10 15:27:16 | same |

`find /data/eda/project/design_zoo /data/eda/project/hima_harness -newermt "2026-09-10 19:14:00"` answered nothing (phase C). The Design Zoo, the archive and the step-2 and step-3 workspaces are untouched. The two step-3 containers (`hima-opene902-timing-probe-20260909-195006-2dea`, `…-20260910-221158-96d7`) are still up, as D45 left them — the owner's call.

## 2. Where the legacy flow's pieces sit (criteria 2 and 3)

The legacy run bound its inputs through one env file, and that file is still on the Site: `/data/eda/project/hima_harness/hima-cell-mining/binding/inputs/xspace_cell_aes_tsmc28.inputs.env` (run tag `hhw-20260908093918`, phase B — printed with licence lines filtered). Every path it names was `stat`ed in phase D; **all 25 are present**. The ones a step-4 pack must bind:

| What | Where | Size / mtime |
|---|---|---|
| **AES RTL** (`DESIGN_TOP=aes_cipher_top`) | `/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes/*.v` — `aes_cipher_top.v`, `aes_inv_cipher_top.v`, `aes_inv_sbox.v`, `aes_key_expand_128.v`, `aes_rcon.v`, `aes_sbox.v`, `timescale.v` (+ `BUILD`, `LICENSE`, `README.md`) | dir 2026-07-08 |
| AES RTL, the legacy's packaged copy | `/data/eda/project/hima_harness/verification_packages/luzi/HimaHarness-Xspace-AES-TSMC28-Validation-gr_20260816_060117_938542/source/rtl/aes_cipher_top.v` | 10,139 B, 2026-07-08 |
| SDC | `/data/eda/project/celluzi/commercial/aes_tsmc28/scripts/constraint_tsmc28.sdc` | 1,584 B, 2026-08-03 |
| **TSMC28 Liberty** (tt 0.9 V 25 °C, NLDM) | `/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/tcbn28hpcplusbwp40p140tt0p9v25c.lib` | 87.3 MB |
| TSMC28 `.db` (same corner) | same tree, `…tt0p9v25c.db` | 20.1 MB |
| TSMC28 cell LEF | `…/Back_End/lef/tcbn28hpcplusbwp40p140_110a/lef/tcbn28hpcplusbwp40p140.lef` | 9.2 MB |
| **Tech LEF, regenerated at the site** | `/data/eda/project/tsmc28_prtf/gen_p140/tsmcn28_10lm5X2Y2ZRDL.tlef` | 166 KB, 2026-08-03 |
| QRC tech | `/data/eda/project/techlib/tsmc28/TF/qrcTechFile` | 99.8 MB |
| CDL / GDS | `…/Back_End/spice/…/tcbn28hpcplusbwp40p140_110a.spi`, `…/Back_End/gds/…/tcbn28hpcplusbwp40p140.gds` | 1.9 MB / 14.2 MB |
| Liberty skeleton | `/data/eda/project/tsmc28_work/xspace/tsmc28_skeleton.lib` | 313 KB, 2026-08-03 |
| Abstract-layout technology (librecell) | `/data/eda/project/tsmc28_work/librecell_tsmc28_tech_900.py` | 11 KB, 2026-08-04 |
| Learned timing / power / area models | `/data/eda/project/tsmc28_work/charmodel/{model.json, model_power.json, area_model.json}` | 17.9 MB / 7.2 MB / 149 B |
| Geometry rule deck | `/data/eda/project/hima_harness/site_inputs/xspace_cell_aes_tsmc28/geometry_rule_deck.json` | 646 B |
| GDS map | `/data/eda/project/celluzi/commercial/aes_tsmc28/scripts/streamOut_tsmc28.map` | 3.5 KB |

`PDK_ROOT=/data/eda/project/techlib/tsmc28` (`TSMC28` is a symlink to it; top level `EFUSE IO Memory PDK TF logic General_AppNotes_PR_Constraint_File`, mtime 2024-12-11: staged, untouched by any flow). **AES/TSMC28 is still not a Design Zoo combination**; the legacy ran from `/data/eda/project/hima_harness/workspaces/luzi/phase2-current/xspace_cell_aes_tsmc28*` (dirs present: `xspace_cell_aes_tsmc28`, `…_autonomous_fmax`, `…_phase4_final_campaign_runs`, `…_phase4_fmax_runs`, `xspace_cell_aes_sky130_open_source`, `cool3d_open_source_3dic_dse`, `phase3_qualification`; `workspaces/luzi/runs` is empty).

**The legacy flow tree** on the Site: `/data/eda/project/hima_harness/hima-cell-mining/` (2026-09-08; `flow/{bin,scripts,generated,config,inputs}`, `pack/` with its own tests, `harness/` with the reforge's bind/instantiate/harvest scripts, `binding/inputs/`), and the same `flow/bin` and `flow/scripts` inside the archived run (`server/gr_20260821_020514_327246/flow/`). `flow/bin` holds the stage scripts named in the ground study (`mine_patterns.py`, `run_mining_strategy.py`, `merge_mining_strategies.py`, `run_bool2cmos.py`, `run_abstract_layout.py`, `run_charmodel.py`, `build_lc_script.py`, `render_dc_entrypoint.py`, `build_arm_scripts.py`, `build_checker_session.py`, `attribute_violations.py`, `build_frequency_probe_scripts.py`, `autonomous_fmax.py`, …); `flow/scripts` holds `dc_syn_tsmc28.tcl`, `constraint_tsmc28.sdc`, `init_tsmc28.tcl.tmpl`, `pnr_tsmc28.tcl.tmpl`, `mmmc_tsmc28.tcl.tmpl`, `checker_session.tcl.tmpl`.

**bool2cmos** — located: `/data/eda/project/bool2cmos` (pure Python 3, no dependencies; `pyproject.toml` name `bool2cmos` 0.1.0, script entry `bool2cmos = bool2cmos.cli:main`; package dir `bool2cmos/` with `api.py bdd.py bridge.py cell.py cli.py … synth.py verify.py`). The legacy invocation form, from the inputs env and `flow/bin/run_bool2cmos.py`: `BOOL2CMOS_CMD='python3 -m bool2cmos.cli'` run with `cwd=BOOL2CMOS_CWD=/data/eda/project/bool2cmos` and the device profile `--pdk /data/eda/project/bool2cmos/profiles/tsmc28_lclayout.json` (`BOOL2CMOS_PDK_PROFILE`), one call per accepted candidate: `--function <Liberty expr> --inputs A,B,… --output ZN --cell-name <name> --out <netlist.sp>` (phase D printed `python3 -m bool2cmos.cli --help` on the host: `--function/-f` repeatable for multi-output, `--inputs/-i`, `--output/-o`, `--pdk` (sky130, tsmc28 or a JSON profile path), `--cell-name/-n`, `--max-series-n/-p`, `--order-limit`, `--out`, `--meta`, `--print-meta`, `--quiet`, `--version`). It runs on the **host** Python (3.12.3 at `/usr/bin/python3`), not in the EDA container. It is not on any PATH (`which bool2cmos` answers nothing, phase A): a pack invokes it as the module.

**celluzi** — located, and it is not one tool: `/data/eda/project/celluzi` is the SKY130 custom-cell project (README: detect → generate → integrate → evaluate on IIC-OSIC-TOOLS), of which the legacy AES/TSMC28 flow used four things: (1) the **abstract-layout step** through the `localhost/iic-osic-celluzi:2026.06` Podman image (18.8 GB, entrypoint `/dockerstartup/scripts/ui_startup.sh --wait`, workdir `/foss/designs`), mounting `XS28_CONTAINER_HOST_ROOT=/data/eda/project` at `XS28_CONTAINER_MOUNT_POINT=/foss/designs` and activating `XS28_LCLAYOUT_ACTIVATE=/foss/designs/celluzi/tools/librecell_venv/bin/activate` (host path `/data/eda/project/celluzi/tools/librecell_venv/bin/activate`, present; a sibling `librecell_hima_venv` was the run's `HIMA_CELLUZI_LCLAYOUT_BIN=…/librecell_hima_venv/bin/lclayout`), driven by `flow/bin/run_abstract_layout.py --cell-dir cells --tech $LIBRECELL_TECH_PY --rule-deck $GEOMETRY_RULE_DECK --timeout $ABSTRACT_TIMEOUT_SEC` which calls `abstract_cell.py --netlist … --tech … --rule-deck … --power-pin VDD --ground-pin VSS -o …` per cell; (2) the **charmodel helpers** on `XS28_CHARMODEL_HELPER_DIR=/data/eda/project/celluzi/scripts:/data/eda/project/tsmc28_work/charmodel`; (3) the AES SDC and GDS map under `celluzi/commercial/aes_tsmc28/scripts/`; (4) `celluzi/tools/cell_need_miner` (the miner package the archived `flow/bin/cell_need_miner/` mirrors). `podman ps -a` shows a stopped `cool_hoover` container of that image and a stopped `goofy_heyrovsky` of `docker.io/hpretl/iic-osic-tools:2026.06`.

**The three site launchers the inputs env names** (`site_inputs/xspace_cell_aes_tsmc28/bin/`, phase D): `xs28-dc-shell` = `exec /usr/local/bin/edarun dc_shell "$@"`, `xs28-lc-shell` = `exec /usr/local/bin/edarun lc_shell "$@"`, `xs28-innovus` = requires `DISPLAY` and `XAUTHORITY`, `exec /usr/local/bin/edarun /data/eda/container/podman/bin/innovus-safe "$@"` (the env set `DISPLAY=:1002`, `XAUTHORITY=/home/luzi/hima_xauth_hima_eda_shared_luzi`). The Permit allows `/usr/local/bin/eda` and `make`; `edarun` sits beside `eda` under `/data/eda/container/podman/bin/` and is the same runner (site guide §7). The step-4 pack's contract names `/usr/local/bin/eda` as the Permit does; whether Innovus needs the X display route (`innovus-safe`) on the 2025 tools is for the pack's test stage.

## 3. What starts under the 2025 tools (criterion 4, first half)

Inside the EDA container (`/usr/local/bin/eda bash -lc …`, phase B): `dc_shell` → `/data/eda/software/eda_tools/synopsys/syn/X-2025.06-SP3/amd64/syn/bin/dc_shell`; `lc_shell` → `/data/eda/software/eda_tools/synopsys/lc/X-2025.06/bin/lc_shell`; `pt_shell` → `…/prime/X-2025.06/bin/pt_shell`; `innovus` → `…/cadence/DDI231_ISR4/INNOVUS231/bin/innovus`; `genus` → `…/DDI231_ISR4/GENUS231/bin/genus`; `python3` inside the container is **3.8.16** (Calibre's; the host has 3.12.3); `lmutil` and `lmstat` are on the container PATH. `SYNOPSYS=…/syn/X-2025.06-SP3`. Version prints, run in an empty `/tmp` scratch directory that stayed empty:

| Tool | Command | Answer |
|---|---|---|
| Design Compiler | `dc_shell -V` | `dc_shell version - X-2025.06-SP3`, build Oct 16 2025 |
| Library Compiler | `lc_shell -V` | **refused**: `Error: Unexpected argument '-V'`, usage of `…/lc/X-2025.06/linux64/lc/bin/lc2_shell_exec -r <root> -f <file>`. `lc_shell` is now a symlink to `snps_shell` (the container-style Synopsys launcher, `bin/snps_shell`, `snps_container`), and the install carries both `lc_shell_exec` and `lc2_shell_exec` plus two documentation sets, `doc/lc` and `doc/LC2`. The version is the install's, `X-2025.06`; the site guide's smoke test of 2026-08-31 reports `lc_shell` PASS. |
| Innovus | `innovus -version` | `Innovus v23.14-s088_1 (64bit) 02/28/2025`, NanoRoute 23.14-s088_1, AAE 23.14-s018, CTE 23.14-s036_1 — the install directory is `DDI231_ISR4`. |
| Genus | `genus -version` | starts (falls back to shell mode without a DISPLAY); no version line printed before the cut. |

Licence daemons `eda-synopsys-2025-lmgrd` and `eda-cadence-lmgrd` are `active` (phase A).

## 4. The licence features Design Compiler and Library Compiler take (criterion 4, second half)

Two read-only sources. **Observed checkouts** in the daemons' own logs since the 2025 licence went in (`/data/eda/logs/license_servers/`, phase B): Synopsys — `Design-Compiler` ×16, `HDL-Compiler` ×15, `DesignWare` ×15 (the step-2/3 opene902 runs); no `Library-Compiler` checkout is in the log — nothing has run Library Compiler on the 2025 tools yet. Cadence — `Innovus_Impl_System` ×21, `Innovus_Hier_Opt` ×2, `Genus_Synthesis`/`genus_synthesis` ×10 each, `Genus_Low_Power_Opt`/`genus_low_power_opt`. **Seats** (`lmutil lmstat -c … -f <feature>`, phase F): `Design-Compiler`, `HDL-Compiler`, `DesignWare`, `Library-Compiler`, `DC-Ultra-Opt`, `PrimeTime` each `99 issued, 0 in use`; the Synopsys key is a full-feature key (every feature 99 seats, phase B). The Cadence `lmstat` gets `No socket connection to license server manager` for every feature (the daemon logs checkouts, so Cadence here is answered by its log, consistent with the site's `Innovus_Impl_System: 0` in `sites/linglong/site.yml`). So a step-4 contract may declare `Design-Compiler: 1` and `Library-Compiler: 1` against the Site's capacity as the reference pack does; the first Library Compiler run on X-2025.06 will be the first checkout of that feature on this Site.

## 5. Which legacy commands changed on the 2025 tools (criterion 4)

The legacy scripts' commands (from the archived `dc_syn_tsmc28.tcl`, `build_lc_script.py`, and the Innovus `init`/`pnr`/`mmmc`/`checker` templates, read on this Mac) were checked against the reference pages the 2025 installs ship (`doc/syn/man/cat2`, `doc/lc/man/cat2` and `doc/LC2/man/cat2`, `share/innovus/man/man1` (legacy names) and `share/innovus/stylus/man/man1` (common UI), phases C2 and E; the versions the legacy ran on were DC T-2022.03-SP2, LC T-2022.03, Innovus 23.1 — the archive README).

- **Design Compiler X-2025.06-SP3**: every command the legacy script used has its page — `analyze elaborate link current_design define_design_lib set_app_var compile_ultra change_names write write_sdc report_timing redirect report_qor report_area report_power report_reference check_design check_timing get_lib_cells set_dont_use create_clock set_clock_uncertainty set_max_delay uniquify`. `compile_ultra`'s page mentions obsolete options twice (the pack's test stage reads which). Nothing renamed.
- **Library Compiler X-2025.06**: `read_lib write_lib check_library report_lib remove_lib read_db` present in both the classic `lc` and the `LC2` sets; no page for `set_app_var` or `write_db` in either. What changed is the **launcher**: `lc_shell` is `snps_shell`, which refuses `-V`; `-f <script>` (the form `build_lc_script.py` used, `lc_shell -f <lc.tcl>`) is what the usage line documents. The pack's test stage must confirm `lc_shell -f` under `snps_shell` and which of `lc_shell_exec`/`lc2_shell_exec` it dispatches to.
- **Innovus 23.14**: the templates' commands have their legacy pages except two: **`verifyGeometry` — no page anywhere in the 23.14 install** (legacy or Stylus; a `find` over the install for `verifyGeometry*` answers nothing), and **`setMaxRouteLayer` — no page** (`setNanoRouteMode` is present; its `-routeTopRoutingLayer` is the documented form). `verify_drc` and `set_verify_drc_mode` are present (legacy set), `check_drc` is the Stylus form. This matters: the legacy verification gate ran **three sessions per arm** — one `verify_drc` with `set_verify_drc_mode -check_only cell`, one `verifyGeometry -reportAllCell -error 500000`, one info session (`checker_session.tcl.tmpl`, `build_checker_session.py`) — and the second of the three has no documented command on the 2025 release. The step-4 pack's verification tool cannot copy the legacy checker; its test stage decides whether `verify_drc` with the raised `-limit` covers what `verifyGeometry -reportAllCell` reported, and the knowledge file on the verification gate says so.
- The 2022-era tools the legacy ran on are **retired**, not installed: `/data/eda/software/_retired_20260831/{cadence, synopsys, mentor, license, env_shell_legacy}`; the only Cadence DDI under `eda_tools` is `DDI231_ISR4`.

## 6. What the legacy records say a foundry-only synthesis and a post-route arm cost

From the finalized autonomous-Fmax run `gr_20260821_020514_327246` in the archive (`xspace_cell_aes_tsmc28_autonomous_fmax`, `SUCCEEDED`; DC T-2022.03-SP2 / Innovus 23.1; `MULTI_CPU=8`; `TARGET_CLOCK_NS=0.50`): the channel's 38 command records span **7,456 s (2 h 04 min)** for the whole run, of which 5,590 s are the thirteen commands over a minute. The run's own tool logs give the session figures:

| Stage (legacy name) | Wall time | Memory | Source |
|---|---|---|---|
| Foundry-only DC synthesis, `--arm base` (initial) | 106 s (command) | — | channel `cmd_…020537` |
| Foundry-only DC synthesis, `--arm base` (after the pressure correction) | 239 s (command); DC session 238 s | 639 MB | channel `cmd_…021830`; `logs/dc_base.log` |
| Innovus frequency probe (init + route), pass 0 | 597 s | — | channel `cmd_…020825` |
| Innovus frequency probe, corrected | 61 s + 815 s | — | channels `cmd_…022237`, `cmd_…022340` |
| Abstract layout (lclayout in the celluzi container) | 667 s | — | channel `cmd_…024303` |
| DC synthesis with the generated library, `--arm custom` | 207 s; DC session 206 s | 638 MB | `cmd_…025542`; `logs/dc_custom.log` |
| Strategy evaluation (six routes, each LC + DC) | 1,356 s; one DC session 202 s / 640 MB | — | `cmd_…025952`; `logs/strategy_evaluation.log` |
| Library Compiler (generated library) | LC session 11 s | 124 MB | `logs/lc.log` |
| DC synthesis `--arm compact` | 188 s | — | `cmd_…032509` |
| **Post-route arm, foundry** (init + place + CTS + route) | 579 s | init peak res 2.0 GB; pnr peak res **3.78 GB**, current mem up to **5.31 GB** | `cmd_…033155`; `logs/init_foundry.log`, `logs/pnr_foundry.log` |
| Verification (three checker sessions), foundry | 108 s | — | `cmd_…034151` |
| **Post-route arm, generated** | 559 s | pnr peak res 3.78 GB, current mem up to 5.30 GB | `cmd_…034604`; `logs/pnr_generated.log` |
| Verification, generated | 108 s | — | `cmd_…035558` |

So on the 2022 tools a foundry-only synthesis of `aes_cipher_top` on TSMC28 cost 2–4 minutes and ~640 MB; a post-route arm cost ~10 minutes and ~3.8 GB resident (5.3 GB current at peak); the Site's cap of one Job (D33) and 117 GiB are not the bound. The step-3 opene902 synthesis on the 2025 tools ran ~150 s per generation (D45) for comparison. These are the legacy's numbers on the retired tools: the pack's test stage measures the 2025 ones.

## 7. What this record does not answer

- Whether `lc_shell -f` through `snps_shell` behaves as the legacy `lc_shell -f` did, and which executable it dispatches to (a tool start; the pack's test stage).
- Whether Innovus 23.14 accepts `setMaxRouteLayer` and `verifyGeometry` as undocumented legacy aliases (only a session can say; the pack's test stage, with `verify_drc` and `setNanoRouteMode -routeTopRoutingLayer` as the documented forms).
- Genus's version string (the print fell to shell mode before printing).
- Peak memory of the 2025 tools on this design (D33's open measurement).

## Site leftovers

`/tmp/hima-probe56-phase{A,B,C,C2,D,E,F}.sh` (this probe's scripts, 2–4 KB each) and the empty `/tmp/hima-probe56-Ci5aCp`. Nothing else.
