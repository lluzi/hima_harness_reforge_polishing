## Site

`eda_cluster_ctu_01` (ssh to linglong; `workspaceRoot` `/data/eda/project/hima_harness/ctu-runs`,
`parallelJobs: 3`), toolchain `/data/eda/project/hima_harness/ctu-mock-eda`, resident capability
`operator-admin/resident-engineering-ctu01/engineering-capabilities-ctu01.json`.

## Files written

- `contract.yml`, `graph.yml`, `semantics.yml`; `flow/andes_cli.py` (every tool step and the
  requirements validator); `tools/read-{reference,timing,requirements,round}.py` with
  `readers/*.yml`; `rules/*.yml` (six); `choosers/andes-next.yml`; `knowledge/*.md` (five).
- Outside the Pack: `sites/eda_cluster_ctu_01/` (Site, Permit, capability, mock toolchain and its
  tests) and `test/contract/andes-cell-fmax*.ts`.

## How the two agents run at once

The fork at `read-timing` has two outsourced act nodes as branches. The autopilot does not drive
resident tasks, so the fork is not declared as an autopilot fork: the head segment stops when
`read-timing` opens the fork and hands back to the owner. The owner then begins `himatime-agent`
and `qualib-agent` (both are available), starts a resident task on each (`engineering start`; two
wrapper Jobs, inside the Site's three slots), collects each delivery (its Reader runs on that
branch), releases and completes each node in any order. The last completion closes the fork; the
join `requirements-joined` judges each branch's reading and the second segment drives the rest.

## Gaps

- The mock is a calibrated path model, not a timer: one design, one corner, one clock.
- The cell targets in requirements are recorded (met / not met) but do not change the cells.
