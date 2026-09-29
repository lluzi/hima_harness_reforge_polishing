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

`probe-reviewer-answer.json` is copied unchanged from main's `flow/tests/probe_fixtures/reviewer-answer-attempt-1.json`
(the #63 real-model probe, run `notes/model-probe-run1`, Pack 0.1.10): a Team reviewer's admitted answer
with nested `evidenceRefs` and long `limitations`, the shape that broke inside arrays in 2 of 5 answers.
Its `review/1` fields differ from this Pack's `review/2`, but the two format caps it breaks are the same.

## Treatment attempt 1 fixtures (Issue #64, `run-9a5f197a`, Pack 0.2.0 `ea5d0356`)

Copied from that Run's assets (`.hima-tmp/atcs64-t01-12950dac/T01 Data/.../run-assets/.evidence/<run>/`).
Its working state and worker-slots record are byte-identical to `live02-working-state.json`
(`d0c9c5bf...`) and `live02-worker-slots.json` (`53ebcf98...`), so the tests reuse those files.

| File | Source contentSha256 | Bytes |
|------|----------------------|-------|
| `t01-worker-request-w01.json` | `649ca0d5a31842d3953ee61375bbe4ba8f2822147afa212ece61cfad83c2a0e8` | verbatim: w01's admitted request (Ledger `#000144`) |
| `t01-worker-request-w03.json` | `0a434f5f1950e19d40f3e24a288cc512bfbdb48e9d9a96c7866cfe1f23ed2eb0` | verbatim: w03's admitted request (Ledger `#000254`) |
| `t01-campaign-plan.json` | `b09ca014cdd5327a99806d62216106c44f62986922a0efeb7dfa2cc3759a513b` | verbatim: the plan admitted at 0 (Ledger `#000117`, PASS `#000119`): 3 active slots, 3 parked |
| `t01-policy.json` | `213425acb8b8ca9ddada5482595a09ba7d1597fe70b4ac4652c15df0132253e4` | verbatim |
| `t01-w02-stale-locks-list.txt` | `af8ce7def900d9639733f8d81fa1447a737d8954dcae2797f1c6c38f7095ae92` | verbatim: the cycle folder's `evidence/w02-stale-locks-list.txt`, the 44 multiply linked files in `workspaces/w02/r1` (used by `sites/linglong-atcs28/test_verify_worker_startup.py`) |
| `t01-w03-team-results.json` | Ledger `#000258`, `#000271`, `#000321` | extracted: w03's Researcher, Reviewer and Operator replies as the Ledger holds them |
| `t01-observation-top.json` | from `b56d01a2933fedabd43008a12688ae56dd1d2de031db082e2f35f30d581607f0` | reduced: the eight worst violating checks of each scenario and mode (48 of the 2016), re-stamped; `composition.worst_checks` are unchanged |

`flow/tests/test_t01_regressions.py` writes a stand-in netlist and Liberty file for them;
`test_request_problems.live02_workspace` writes a stand-in netlist for the live02 plan and lists
which masters are proven by the Run and which are assumed.
