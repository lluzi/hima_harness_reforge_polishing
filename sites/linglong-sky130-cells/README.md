# linglong-sky130-cells

Demo Site for `custom-cell-fmax-sky130-demo` on linglong (`luzi@192.168.50.41`), open-source SKY130.

- Campaign workspaces: `/data/eda/project/hima_harness/cellfmax-runs` (the only write root).
- Read-only: the celluzi project and its ORFS checkout (`a15fd190`, patched by celluzi), bool2cmos,
  the installed resident wrapper v2 and the `cellfmax-toolbox` (mockturtle and `emap_window`).
- Image `localhost/iic-osic-celluzi-hima:2026.06` (`c8e8a7a4…`): `localhost/iic-osic-celluzi:2026.06`
  with `ENTRYPOINT []` and `CMD []` (Containerfile in
  `/data/eda/project/hima_harness/operator-admin/cellfmax-image/`). The base image's VNC entrypoint
  would swallow the resident wrapper's command and write to `/etc/passwd` under `--read-only`.
- `engineering-capabilities-sky130.json` is installed next to the v2 wrapper as
  `operator-admin/resident-engineering-v2/engineering-capabilities-sky130.json`; the ATCS v2
  capability is untouched. It sets `EMPYREAN_LICENSE_MODE=old` only because the v2 wrapper's
  launch line tests it; no licence is used.
- In a Home, copy `site.yml` to `hima/sites/linglong-sky130-cells.yml` and `permit.yml` beside it.
