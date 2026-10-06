# abstract: cells in volume with a mock layout

`abstract_cells.py` turns cell specs into sized SKY130 netlists and abstract LEFs in seconds, and
emits the round-recipe `library` entries (`layout: abstract`, plus `layoutFrom` when the spec gave
one). The abstract LEF is the demo's MOCK layout: it stands in for LibreCell layout. The factory
(`../factory`) builds real layouts in minutes per batch, with DRC/LVS-clean yield losses; the demo
does not use it.

```sh
python3 abstract_cells.py spec.json <round> <workspace> [--jobs 16] [--out cells.json]
  [--platform-lef <sky130_fd_sc_hd_merged.lef>]   # default: $ORFS_ROOT/flow/platforms/..., else state/inputs.json
  [--pdk-spice <sky130_fd_sc_hd.spice>]           # default: the PDK in the IIC-OSIC-TOOLS image
```

Run it in the IIC-OSIC-TOOLS container (bool2cmos and the PDK SPICE). The spec format is the
factory's (`../factory/README.md`): name, outputs, inputs, variant, notes. Additionally:

| key | meaning |
| --- | --- |
| `compareTo` | required: the foundry cell this cell competes with |
| `layoutFrom` | optional: `[{"cell": "<foundry cell>", "pins": {"<foundry pin>": "<cell pin>" or null}}, ...]`, placed left to right; default `compareTo` with identical pins |
| `footprint` | optional: resizer family for non-drop-in cells |

## Per cell

- **Netlist** (`cells/r<k>/lib/<name>.sp`): bool2cmos → switch-level check → the factory's sizing
  variant (`factory.apply_sizing`: parallel fingers) → switch-level check. Ports
  `<inputs> <outputs> VGND VNB VPB VPWR`.
- **Abstract LEF** (`cells/r<k>/lib/<name>.lef`, all of them in `cells/r<k>/library.lef`): the
  `layoutFrom` foundry macros' pin, rail and obstruction geometry, shifted side by side and renamed;
  a shared input gets one PORT per source (the same pin, reachable in either half); a `null` pin's
  shapes become obstruction. The cell is widened by whole 0.46 um sites to
  `ceil(source sites × cell device width / source device width)`, never narrower than its sources,
  and the VPWR/VGND rails are stretched to the new width. Antenna properties are dropped.
- **Recipe entry** with SHA-256 of both files, and a `library.md` row (size, devices, device width
  against the sources, notes, or the failure).

Pins keep the foundry cells' router access, so global and detailed route treat an abstract cell like
its foundry source; area follows the transistors. There is no GDS and no internal wiring: an
abstract cell is a placement, routing and timing model, not a tape-out cell. HimaHarness gives it
MOCK timing from the netlist (`../char/README.md`, mock characterization), anchored to the foundry
tables of its `compareTo` cell and of its recorded `layoutFrom` sources, and the arms set
`GDS_ALLOW_EMPTY` for it.

Unit tests (no bool2cmos needed): `python3 -m unittest test/contract/support/cellfmax_abstract_test.py`.

## Runtime (linglong, 2026-10-05)

236 cells (233 drop-in skew variants of 19 foundry gates, 3 multi-output: NAND2+NOR2, XOR2+XNOR2,
AND2+OR2): 236 built in 3.6 s with `--jobs 16`; HimaHarness modelled all 236 with pre-layout SPICE
in 260 s (Pack 0.3.0). Pack 0.4.0 mock-characterizes 227 round-1 cells in 3 s.
