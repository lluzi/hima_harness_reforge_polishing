# Factory sources

Files copied from the read-only celluzi project (`$CELLUZI_ROOT` = `/data/eda/project/celluzi`),
SHA-256 of the source at copy time (2026-10-04), and what the factory changed.

| Factory file | Source (relative to `$CELLUZI_ROOT`) | Source SHA-256 | Change |
| --- | --- | --- | --- |
| `fix_lef_obs.py` | `scripts/fix_lef_obs.py` | `fca3eee921a7b0d504bf7a014b7c786b62a1dc2b91d21a5096f583c3a09cbcde` | none (verbatim) |
| `fix_lef_sky130hd.py` | `scripts/fix_lef_sky130hd.py` | `e5f935897583f92a9bdc9f74b0ace3d07addbef396b399d7e7cb62b7fc31f559` | `--output` takes a comma list (multi-output cells); rail pin names matched case-insensitively (lclayout writes `vdd`/`gnd`) |
| `postprocess_cell.py` | `generate/postprocess_cell.py` | `602104f6d9daa2386f403f18c0ba998b9e1da53cc71044d697112a600009242f` | sections 1-3 unchanged (gate jogs, nsdm/psdm/hvtp implants, label strip); added, marked FACTORY: 0 site snap, 3b pin-label filter, 4a contact-enclosure pads, 4a2 same-net gap fill, 4b via-pad overhang trim, 4 min-area growth, JSON report |
| `librecell_sky130_tech.py` (+ `tech_relaxed_overrides.py`, appended for the relaxed profile) | `pdk/librecell_sky130_tech.py` | `c0fc5e429fa5118bc2fe61519a59ed3d42ced9bdf7179a54673ac6c7358e2079` | gate pitch `unit_cell_width` 460 -> 500; directional (x, y) contact enclosures for li.5 / m1.5 / via.5a / m2.5; `transistor_offset_y` 260 -> 255 and `gate_extension_channel` 280 -> 285 (licon.14). The relaxed profile appends `tech_relaxed_overrides.py` (celluzi enclosures) |

Re-implemented inside `factory.py` (no copy; same commands, paths parameterized):

| Logic | Source | Source SHA-256 |
| --- | --- | --- |
| Magic extraction (`gds read`, `port makeall`, `ext2spice lvs`, `cthresh 0` / `infinite`) | `generate/extract_cell.sh` | `5f4ba33bf1ec5c528d12acef79b18dda4fa13e7b9293e89407dc9e07a45d25a9` |
| Netgen LVS with `permute` of symmetric pins | `generate/run_lvs.sh` | `6793791728c31acc364b20aaf3cf6bd002f391cea017b4cee60ec665de26c39f` |
| KLayout DRC call | `generate/run_drc_cell.sh` | `7bdd07be31b1bd13447f2ecc575e1cb14e6dc194e7df1c24160856807d5a7188` |
| Bulk-node detection for the characterizer netlist | `generate/fix_extracted_subckt.py` | `72077c0fbdaedf873a05ad24033687b6cdde0b2ea1617f4fdd1518746307973c` |

The tools themselves are used in place, read-only: LibreCell venv
`$CELLUZI_ROOT/tools/librecell_venv` (already patched by celluzi), bool2cmos at
`/data/eda/project/bool2cmos`, and the PDK decks under `$PDK_ROOT/sky130A/libs.tech`.
