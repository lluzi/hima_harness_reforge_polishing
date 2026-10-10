## Files written

- `contract.yml`, `graph.yml`, `semantics.yml`; `flow/andes_cli.py` (every tool step and the
  requirements validator); `tools/read-{reference,timing,requirements,round}.py` with
  `readers/*.yml`; `rules/*.yml` (six); `choosers/andes-next.yml`; `knowledge/*.md` (five).
- Outside the Pack: `sites/eda_cluster_ctu_01/` (Site, Permit, capability, mock toolchain and its
  tests) and `test/contract/andes-cell-fmax*.ts`.

### Site

`eda_cluster_ctu_01` (ssh to linglong; `workspaceRoot` `/data/eda/project/hima_harness/ctu-runs`,
`parallelJobs: 3`), toolchain `/data/eda/project/hima_harness/ctu01-eda`, resident capability
`operator-admin/resident-engineering-ctu01/engineering-capabilities-ctu01.json`.

### How the two agents run at once

The fork at `read-timing` has two outsourced act nodes as branches. The autopilot does not drive
resident tasks, so the fork is not declared as an autopilot fork: the head segment stops when
`read-timing` opens the fork and hands back to the owner. The owner then begins `himatime-agent`
and `qualib-agent` (both are available), starts a resident task on each (`engineering start`; two
wrapper Jobs, inside the Site's three slots), collects each delivery (its Reader runs on that
branch), releases and completes each node in any order. The last completion closes the fork; the
join `requirements-joined` judges each branch's reading and the second segment drives the rest.

### Smoke on the Site (2026-10-10, time scale 1)

Toolchain deployed to `/data/eda/project/hima_harness/ctu01-eda`; wrapper copy (template
`fb4739c2`) and capability (`b8e76e1d`) in `operator-admin/resident-engineering-ctu01/`. Every CLI
answers `-version`. One reference build and one round with hand-written requirements in
`ctu-runs/smoke-20261010/` (log `smoke.log`), host python3 3.12:

| step | time |
| --- | --- |
| bind-inputs | 0.4 s |
| reference-build (sapr) | 80.1 s |
| load-timing (himatime load) | 12.2 s |
| requirements check, each | 0.1 s |
| generate-cells (andescell, 2 families, 6 cells) | 29.2 s |
| screen-cells (qualib) | 7.9 s |
| verify-cells (himatime) | 15.7 s |
| new-library-build (sapr) | 84.2 s |
| compare-round | 0.1 s |

Round 1 (XNOR3+BUF requested by HimaTime, XNOR3+XOR2 by Qualib): AndesCell picked XNOR3 and BUF,
4 of 6 cells passed the screen, Fmax 957.67 → 981.64 MHz (+2.50 %), 474 new-cell instances. In the
podman sandbox image (`c8e8a7a4…`, python3 3.12, toolchain read-only, CTU_MOCK_TIME_SCALE 0.25):
`himatime load` 3.1 s, `qualib analyze` 2.3 s, `himatime report/estimate`, `andescell --dry-run`
and the Pack precheck instant.

## Gaps

- The mock is a calibrated path model, not a timer: one design, one corner, one clock.
- The cell targets in requirements are recorded (met / not met) but do not change the cells.

## Reviews

- Pack load and semantics: `test/contract/andes-cell-fmax.test.ts` (6 tests), including the mock
  toolchain unit suite.
- Host dry path (`andes-dry` group): both resident agents at once through the stand-in, generate /
  screen / verify / rebuild, three rounds to goal-met.
- Site smoke on linglong (2026-10-10): every CLI and one reference build plus one round, timings above.
