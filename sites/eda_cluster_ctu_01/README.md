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
| `sapr run` | Synthesis and APR: RTL to routed design, post-route summary and reports | 75-95 s |
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
