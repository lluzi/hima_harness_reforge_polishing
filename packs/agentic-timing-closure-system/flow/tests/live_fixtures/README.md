# Live02 fixtures (Issue #64 Track B)

Retained evidence of the live02 Campaign (`run-6de8b715`, Pack 0.2.0 `c48c3d85`), copied from its
Run assets (`run-assets/.evidence/<run>/<contentSha256>.dat`) so a live failure stays a cheap
regression:

| File | Source contentSha256 | Bytes |
|------|----------------------|-------|
| `live02-campaign-plan.json` | `4f60f78d9b4d2d4f7ddf26465e68cbfce80b371235004b0e0ac171632073a772` | verbatim: the plan the Reader counted at 41 problems (Ledger `#000124`, refused `#000126`) |
| `live02-working-state.json` | `d0c9c5bf8618bea6597048a9a8839788d477d90eadaaa0167631fdf69629fe9a` | verbatim: the working design-state |
| `live02-policy.json` | `182fcf2479d596002b29f04b2d5395a3b5eea5b2272d9559c722cc91a997be86` | verbatim |
| `live02-worker-slots.json` | `53ebcf9836df2642e4b270bb14e1eeeb176b964dda7e7121364fe1f0f1f7f44a` | verbatim |
| `live02-observation-worst.json` | from `a2a84ea0a8c4f2416bec7fe1653d5de166d165df8399ed8447c335c16e9be4f2` | reduced: only the six worst checks (one per required scenario and mode, `composition.worst_checks`) of the 2016, re-stamped; the blockers the plan Reader reads are unchanged |

The design files the working state references (netlist, DEF, SPEF) stayed on the Site, so a test
that reads these stubs `read-atcs.py`'s `_verify_design_state_refs` (the file re-hash) and nothing else.
