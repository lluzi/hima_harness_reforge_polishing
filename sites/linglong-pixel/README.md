# linglong-pixel

The Site for the `pixel-layout-optimization` Pack on linglong: one OLED pixel case judged with the
Empyrean FPD tools (Argus DRC, gdsIn, RCExplorer) and Calibre LVS.

**Customer data.** Everything under `pixel-inputs/` is the customer's case and stays on linglong.
This file names paths only; no layout, rule value or result of the case belongs in this repository.

| Item | Where on linglong |
| --- | --- |
| Case inputs (read-only, mode 0444) | `/data/eda/project/hima_harness/pixel-inputs/case-v1/` |
| Case manifest (`pixel.case-manifest/1`) | `case-v1/manifest.json` |
| Site capabilities (`pixel.site-capabilities/1`) | `case-v1/site-capabilities.json` |
| Numeric venv (Python 3.8.16, numpy 1.24.4, SciPy 1.10.1, Shapely 2.0.7, gdstk 0.9.52) | `/data/eda/project/hima_harness/pixel-runs/env38` |
| EDA container | `eda-runner-pixelpack` (image `localhost/edarunner:alma8`, `--init`, `--pids-limit=32768`) |
| Campaign workspaces | `/data/eda/project/hima_harness/pixel-pack-runs/` |
| Resident capability | `operator-admin/resident-engineering-hug/engineering-capabilities-pixel-v1.json` (copy of `engineering-capabilities-pixel-v1.json` here) |

## Case inputs

`case-v1/` holds copies of the customer case, each checked by sha256 in the manifest:

- `original/`: the designer's original layout.
- `decks/authority.rule`: the customer's newest Argus DRC deck (the authority);
  `decks/reference.rule`: the vendor prototype's deck, reported under its own name. Both are used
  unchanged; the Pack's rule-file generator substitutes the layout input and sets
  `layout_use_db_precision( yes )` in place of the deck's `precision(...)` line. The deck's
  `geom_interact` rules run in Argus (`drcStripFunctions: []`); the Pack also checks them in
  geometry from the manifest's `interactRules`.
- `lvs/argus_lvs.rule` and `lvs/schematic_argus.netlist`: the customer's own Argus LVS deck and
  netlist (engine `argus`), plus `schematic_argus_cst.netlist.tmpl` with `@CST_FF@` for a declared
  capacitor change. Validated 2026-10-13: passes the designer's original and the day-1 V1 shrink,
  fails the open-anode pixel (1 discrepancy) and the enlarged-capacitor layout (`c_cap` +6.4 %
  against the 2 % tolerance). The earlier Calibre translation (`lvs_calibre.svrf.tmpl`,
  `schematic.sp`, `schematic_cst.sp.tmpl`) stays in `lvs/` for a Site without Argus LVS.
- `extraction/`: the OA technology library files copied into a fresh library per candidate, the
  GDS layer map, the ETF, the boolean layer map and the RCExplorer Tcl template (`@D@`).

## Why these Site choices

- **Licence.** The FPD licence (`empyrean-license fpd`, port 59004). Since 2026-10-13 it issues
  `AR_ERC_FPD` and `AR_HERC_FPD` (needed by every Argus LVS and netlist run) and `AR_CD_FPD`
  (Argus `geom_interact`); before that, LVS ran through a Calibre translation and the interact
  rules only in geometry. FPD mode excludes the MAGE and XTop modes; the owner switches it (`sudo`).
- **gdsIn** mis-detects the 7.x kernel, so it runs under `setarch x86_64 --uname-2.6` with the OA
  library path the capabilities name. A candidate is always imported into a fresh library holding
  only the two technology files; an existing library would be extracted silently instead.
- **Container.** The general `edarun` containers run `sleep infinity` as PID 1, which never reaps,
  and cap processes at 2048: zombies filled them and more than 3 parallel extractions failed. The
  dedicated `eda-runner-pixelpack` container runs `podman-init` as PID 1 with a 32768 limit.
