# Endpoint resolution

## Source

- `tools/read-atcs.py` of this Pack: `resolve_endpoints` and the `resolve-instances` command,
  beside the netlist parser the campaign-plan and worker-request Readers admit instances with.
  Its tests are `flow/tests/test_endpoint_resolution.py`.
- Failure catalogue C22 (Issue #63). Fresh03, PR02 and PR03 each wrote their own resolver in
  Workshop code. Each lost 2-4 attempts to the same shapes: flattened versus hierarchical names,
  bus spellings, net versus pin versus port, instantiations spanning lines, and a 400k-line read
  cap.

## Applies when

- A plan or worker Workshop turns PrimeTime endpoints (from `currentObservations` or a report)
  into `editDomain.instances` or worker `actions[].instance`.

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

The resolver reads the netlist of `state/working-state.json`, whose sha256 it verifies, and
walks the design from its `top`. Each endpoint may be an instance, `instance/pin`, a net or a
port, written hierarchically from `top`. The result has two lists:

- `answer["resolved"]` rows: `{endpoint, instance, cell, pin, via}`. `instance` is the leaf cell's
  full path, in the form the Readers admit, so copy it into `editDomain.instances` and `actions`
  unchanged. A name holding `/` (a flattened escaped instance) comes back as `\u_a/u_b/reg_0_ `,
  with its escape and its trailing space. `via` is one of:
  - `instance`: the endpoint named the cell;
  - `pin`: it named a pin of the cell;
  - `net-driver`: it named a net, resolved to that net's one driving cell through port
    connections.
- `answer["unresolved"]` rows: `{endpoint, unresolved}`. The reason says why, for example
  "primary port", "module instance, not a leaf cell", "not an instance ... under any spelling" or
  "has N drivers". Drop these rows, or choose another endpoint. Never guess a name.

Bus bits match under each of the `x[0]`, `x_0_` and `x_0` spellings. An instantiation may span
lines, and every line of the netlist is read, with no cap. A net's driver is found only through a
cell pin named like an output (`Z`, `ZN`, `Q`, `QN`, `Y`, `CO`, `S`, `SO`, `O`, `OUT`,
optionally followed by digits); any other net is reported unresolved rather than guessed.

## Counterexample

A PR02 resolver that read only the first 400k lines found 0 of the w01 edit-domain cells. This
resolver reads every line: on a 410,000-instance test netlist it resolves the last instance
(`LargeNetlistTest.test_7_an_instance_past_line_400k_resolves`).

The retained NET endpoint `dec_tlu_perfcnt0[0]` is a net, not an instance, so no cell has that
name. The resolver returns its driver, `swerv_dec_tlu/g96219`.
