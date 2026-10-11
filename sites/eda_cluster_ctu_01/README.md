# eda_cluster_ctu_01

Demo Site for the `andes-cell-fmax` Pack: the linglong server (the `ssh.destination` of
`site.yml`), shown in the App as `eda_cluster_ctu_01`. Every EDA tool here is a **mock**: fast
Python 3 command-line tools that print believable logs and reports from one calibrated design
model. Every EDA result on this Site comes from mock tools (mock EDA); not signoff, not silicon.

## Paths on the server

| Path | What | Access |
| --- | --- | --- |
| `/data/eda/project/hima_harness/ctu01-eda` | the toolchain (`bin/`, `lib/ctu_mock/`, `share/`), copied from `mock-eda/` here | read-only for Campaigns and agents |
| `/data/eda/project/hima_harness/ctu-runs` | Campaign workspaces | the only write root |
| `/data/eda/project/hima_harness/operator-admin/resident-engineering-ctu01` | the resident wrapper copy and `engineering-capabilities-ctu01.json` | read-only |

## Tools (`mock-eda/bin`, python3 stdlib only)

| Command | Tool | Typical time |
| --- | --- | --- |
| `sapr run` | Synthesis and APR: RTL to routed design, post-route summary and reports (openc910: see below) | 75-95 s |
| `himatime load / report / estimate / verify` | HimaTime STA; `verify` re-times the worst paths with new cells (local gain in ps, FO4 per cell) | 14 s / instant / instant / 8 s (`--json` alone: instant) |
| `qualib analyze / screen / list` | Qualib library analysis and cell screen | 9 s / 9 s (`--json` alone: instant) / instant |
| `andescell generate / families` | AndesCell cell generation (at most 2 families a run; `--families A,B` builds exactly a plan's choice) | 30-40 s; `--dry-run` instant |
| `xtop -version` | XTop timing ECO; installed, not a step of the flow | instant |

`CTU_MOCK_TIME_SCALE` scales every wait (0 = none; the resident capability sets 0.25 so the agents'
own runs are quick). The model (`lib/ctu_mock/model.py`) holds the 20 worst path groups of
`aes_cipher_top` (28 nm, `std9t_svt`, clock 0.500 ns, a ~2 GHz block): 22-28 logic levels a path,
10-30 ps of cell and 2-5 ps of net delay a stage, DFF clock-to-Q 34 ps. Reference WNS −0.0124 ns,
Fmax 1951.60 MHz, TNS −0.596 ns over 74 violating endpoints, 41 200 µm², 18 400 instances. A
generated cell family speeds up only the cell delay of its own stages, by 5-10 %. Calibration
(`mock-eda/tests/test_mock_eda.py`, the math is in the model's docstring): XNOR3+BUF take 13.84 ps
off the worst path A1 (16.88 ps with the extra-fast variants), the key-expansion path B1 then limits
Fmax at 1980.98 MHz, +1.51 % over the reference build, so the default +1 % Goal is met in one round;
a family on no worst path gains nothing. Every `sapr run` also reports the QoR at the end of each flow stage
(synthesis, floorplan, placement, CTS, route, post-route opt) in `sapr_summary.json` `stages` and
`reports/flow_summary.rpt`. `python3 -m ctu_mock.libraries` (from `lib/`) regenerates
`share/libs/std9t_svt`.

## Design openc910 (data replay)

`sapr run --design openc910` selects the **openc910 mode** of the same binaries: the tools replay a
measured data set of the OpenC910 CPU core instead of computing the `aes_cipher_top` model. The
data set is installed per Site in `mock-eda/share/designs/openc910/` (git-ignored, never part of
this repository; `CTU_OPENC910_DATA` overrides the path, the tests point it at the synthetic
fixture `mock-eda/tests/fixtures/openc910-mini/`). Without it every openc910 command stops with
"design data openc910 is not installed on this Site". `lib/ctu_mock/openc910.py` loads the data
and reshapes it; it adds no numbers of its own. A sapr output directory whose
`sapr_summary.json` says `design: openc910` puts HimaTime and Qualib in openc910 mode.

| Command (openc910) | What it replays | Typical time |
| --- | --- | --- |
| `sapr run --design openc910 --out DIR [--extra-lib DIR]...` | the full flow prePlace → place_opt → CTS → route; the result is at route, path group reg2reg; no `--extra-lib` = the reference build, the kept AndesCell delivery = the custom build (any other cell set is refused; `--dont-use` is not supported) | 80-100 s |
| `himatime load / report --db SAPR_DIR` | the 8 worst reg2reg route paths and where the worst one's arrival goes (launch clock network, SRAM access, cell families, nets) | 14 s / instant |
| `himatime highvalue --db SAPR_DIR [--out DIR] [--json]` | the high-value cell analysis | 10 s with `--out` |
| `himatime whatif --db SAPR_DIR --scale S [--sort KEY]... [--top N] [--out DIR] [--json]` | the cell what-if rankings and their merged arc list (only the recorded scale and top N exist) | 14 s with `--out` |
| `qualib list --cells C[,C] \| --arcs FILE`, `qualib analyze --db SAPR_DIR --arcs FILE --out DIR` | stock arc facts per Vt flavour; the library view of a requested arc list | instant / 9 s |
| `andescell generate --arcs FILE --round K --iterations N --scale S --out DIR` | the arc-level generation: requested, generated, failed; one `cells/<arc>.lib` stub per generated cell with data | 30-40 s |
| `himatime verify --cells ANDESCELL_DIR --db SAPR_DIR --out DIR` | the cell-level check; `DIR/kept/` holds the kept cells (the rebuild's `--extra-lib`) | 8 s |
| `qualib screen --cells DIR` | per cell: area ratio (≤ 1.0, same footprint), input-cap ratio (≤ 1.30×), LVS | 9 s |

Site notes (the data's basis; not shown in reports): the reference build is measured at every
stage. The custom build's prePlace and place_opt stages are measured; its CTS and route timing
carries the measured placement-stage change forward (the data set's `custom_model`, whose `basis`
text is copied into `sapr_summary.json` `basis`), while its density, power, custom-cell usage, DRV
and clock tree are measured. For those two stages sapr renders the summary reports in the
reference report's layout and a short route/CTS timing report (path, slack, begin and end point,
path group).

### Interface notes (openc910)

- `sapr_summary.json` (`ctu-sapr-summary/2`) is at route: `stage: "route"`, reg2reg `wnsNs`,
  `tnsNs`, `nvp`, `allPaths`; `groups` (by name) and `pathGroups` (list in report order, each with
  `group`); `stages` has four entries `{stage: prePlace|place_opt|cts|route, label: prePlace|
  place_opt|CTS|route, wnsNs, tnsNs, nvp}` (reg2reg); `clockTree {buffers, inverters, icgs, sinks,
  clockWireUm}`; `worstPaths` `{rank, slackNs, group, begin, end, beginShort, endShort,
  referenceSlackNs?}`; `basis` (null for the reference build); plus `build`, `clock`, `libraries`.
  `overflowPct` is null when the stage has none. `clockPeriodNs` is derived from the data
  (required + setup + uncertainty of the ideal-clock placement path).
- Short labels (`beginShort`, `endShort`) are the instance name before the pin.
- HimaTime `timing_summary.json` (`ctu-himatime-timing/2`) is at route. Each path's parts are
  arrival increments (arrival minus the previous stage's arrival), so `clockNs + sramNs + cellNs +
  netNs` equals the arrival; `breakdown` adds a "clock network" part (launch clock latency) when it
  is not zero and lists only parts above 0 besides "nets". Custom-build paths have no stage
  detail: summary rows only, `breakdown` empty.
- Cell family = the cell name before its last drive token `D<n>` (`ND2D2X` → `ND2`).
- `himatime highvalue` returns `families` as `[{family, count}]` (top 10, `--top-families N`),
  `family_count`, and the full `cells` list.
- `himatime whatif`: `--top` defaults to the recorded top N; `--sort` takes keys repeatedly or
  comma-separated; `merged` rows also carry `rankedBy` (the rankings that name the arc, in the
  order the rankings are read: the recorded key order).
- An arc FILE is `{"arcs": [...]}`; a what-if result's `merged` list or a bare list also works.
- `qualib analyze` writes `library_analysis.json` (`ctu-qualib-analysis/2`) with `arcs` and `cells`
  as counts, `vt`, `families [{family, arcs, cells}]`, `constraints`, and per-arc `arcRows`.
  `qualib list --json` prints `{arcs: [{arc, cell, from, to, edge, family, fastestVt, ulvt, lvt,
  svt}], vt}` (delays in ps).
- `andescell generate`: `--iterations` and `--scale` default to the recorded ones; `arcs` lists the
  generated arcs that have version data (failed arcs are in `failedKnown` only); a request of
  every arc returns the recorded generated/failed counts, a subset returns requested minus the
  known failures.
- `himatime verify`: `generated` comes from the AndesCell directory's `generation.json` (or the
  number of stubs); `cells` rows are in stub-file order and add `inputCapChangePct`; `--out`
  also writes `kept/cells/<arc>.lib` and `kept/delivery.json`. The result file is `verify.json`.
- `qualib screen` (`ctu-qualib-screen/2`): `passed`/`failed` are counts; a cell without a
  characterized library view fails ("no characterized library view for this cell").

## Resident agents

`engineering-capabilities-ctu01.json`: OpenCode 1.18.34 (`acp --pure`, `deepseek/deepseek-flash`)
in the podman sandbox image `c8e8a7a4…` (the same as `linglong-sky130-cells`), with the toolchain
mounted read-only and its `bin/` first on PATH. The wrapper is a copy of
`sites/linglong-atcs28/templates/resident-engineering-wrapper.py` in
`operator-admin/resident-engineering-ctu01/`; the capability's `wrapper.argv[0]` names it, so a
redeployed wrapper only replaces that file. `EMPYREAN_LICENSE_MODE=old` is set only because the
wrapper's launch line tests it; no licence is used.

## Install in a Home

Copy `site.yml` to `hima/sites/eda_cluster_ctu_01.yml` and `permit.yml` beside it. Deploy the
toolchain with `rsync -a --delete mock-eda/ <server>:/data/eda/project/hima_harness/ctu01-eda/`
(excluding `tests/`), and the capability JSON plus the wrapper into
`operator-admin/resident-engineering-ctu01/`.
