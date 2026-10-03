# Endpoint resolution

## Source

- `tools/read-atcs.py` of this Pack: `resolve_endpoints` and the `resolve-instances` command,
  beside the netlist parser the campaign-plan and worker-request Readers admit instances with.
  Its tests are `flow/tests/test_endpoint_resolution.py`.
- Failure catalogue C22 (Issue #63), ported to Pack 0.2.0 for Issue #64. Fresh03, PR02 and PR03 each
  wrote their own resolver in Workshop code and lost 2-4 attempts to the same shapes: flattened versus
  hierarchical names, bus spellings, net versus pin versus port, instantiations spanning lines, and a
  400k-line read cap. Probe run 2 passed whole check keys and resolved nothing.

## Applies when

- The plan Workshop or a worker Workshop turns PrimeTime endpoints (from `currentObservations`,
  `residualCases` or a report) into `editDomain.instances` or `targetPins`.

## Changes this decision

Do not parse the netlist in your own code. Run the Pack's resolver from your `entry.py`. The
Harness ships the Pack's Reader into every Run's workspace when the Run's first reader runs, so it
is present before any Workshop:

```python
import json, subprocess, sys
from pathlib import Path

workspace = Path(sys.argv[1])
resolver = workspace / "hima-readers" / "atcs-readiness" / "read-atcs.py"
here = Path(sys.argv[2])
(here / "endpoints.json").write_text(json.dumps(endpoints))   # a list of endpoint names
subprocess.run([sys.executable, str(resolver), "resolve-instances", str(workspace),
                str(here / "endpoints.json"), str(here / "resolved.json")], check=True)
answer = json.loads((here / "resolved.json").read_text())
```

What to pass: the endpoint, not the check key. A check key is
`<scenario>|<setup|hold>|<endpoint>`, and a reserved PrimeTime path group is folded into the endpoint
as `@**<group>**`: pass the part after the last `|` without that suffix. From attempt 1's key
`func_ffg_cbest_125|hold|swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_@**async_default**` pass
`swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_`; from `func_ssg_rcworst_m40|setup|dec_tlu_perfcnt0[0]`
pass `dec_tlu_perfcnt0[0]` (a net: the answer is its driver). PT's raw endpoint (`checks[key].endpoint`
in `state/observation.json`) is already that part. The resolver also takes a whole key by its endpoint
part and reports it as `endpointPart`, but pass the endpoint.

The resolver reads the netlist of `state/working-state.json`, whose sha256 it verifies, and walks the
design from its `top`. Each endpoint may be an instance, `instance/pin`, a net or a port, written
hierarchically from `top`. The result has two lists:

- `answer["resolved"]` rows: `{endpoint, instance, cell, pin, via}`. `instance` is the leaf cell's
  full path, in the form the Readers admit, so copy it into `editDomain.instances` unchanged, and
  `instance + "/" + pin` into `targetPins`. A name holding `/` (a flattened escaped instance) comes
  back as `\u_a/u_b/reg_0_ `, with its escape and its trailing space. `cell` is its master. `via` is
  `instance` (the endpoint named the cell), `pin` (a pin of the cell) or `net-driver` (a net,
  resolved to its one driving cell through port connections).
- `answer["unresolved"]` rows: `{endpoint, unresolved}`. The reason says why, for example "primary
  port", "module instance, not a leaf cell", "not an instance ... under any spelling" or "has N
  drivers". Drop these rows, or choose another endpoint. Never guess a name. A check ending at a
  top-level port is named by its check key in `targets`; its cells come from the path's launch or
  capture cell, which you resolve by name.

When no endpoint of a cluster resolves to a leaf cell, take the next worst checks for that slot; never
write a name the resolver did not return. Bus bits match under each of the `x[0]`, `x_0_` and `x_0`
spellings. An instantiation may span lines, and every line of the netlist is read, with no cap. A net's
driver is found only through a cell pin named like an output (`Z`, `ZN`, `Q`, `QN`, `Y`, `CO`, `S`,
`SO`, `O`, `OUT`, optionally followed by digits); any other net is reported unresolved.

## Counterexample

A PR02 resolver that read only the first 400k lines found 0 of the w01 edit-domain cells. This
resolver reads every line: on a 410,000-instance test netlist it resolves the last instance
(`LargeNetlistTest.test_7_an_instance_past_line_400k_resolves`). Live02's plan named the module
instance `swerv_dma_ctrl` as an edit-domain cell; the Readers now write such a name (and a bare leaf, a
port or an absent path) as advice naming the resolver, and the Operator's XTop finds no such cell.
