# Trial.7 failure review

Date: 2026-09-18

Run: `run-b8bddd3f-f41a-45ef-a448-4972e029026b`

Verdict: `PARTIAL`. Pack 5.1.2 passed bind, free research, LC, both DC arms and adoption. It did not
produce a matched post-route result because `pnr-foundry` accumulated more than 100% placement
density during clock/timing optimization.

## Root-cause evidence

The original 0.25-utilization core had area 34,573.392 um2. After `place_opt_design`, effective
occupancy was 71.884%, then monolithic `clock_opt_design` drove internal density through 95% and
eventually 103%–104%. Innovus reported `IMPSP-2002` and thousands of unlegalized instances.

The trial Agent's branch `b84684a` added useful pre-placement accounting, but its own report correctly
said it had not proved the fix. The original failure would pass that guard because 71.884% is below
85%. It was therefore integrated as a safety check and then corrected rather than accepted as the
root-cause fix.

## Final method decision

Per the user's final direction:

- double the density-failure floorplan area for both arms (`effective utilization = requested / 2`);
- keep placement and optimization max density at 0.85;
- do not impose a residual/local density model;
- retain planned, post-CTS and final occupancy evidence, rejecting only physically impossible values
  above 100%;
- split CTS construction from post-CTS setup optimization using Innovus 23.14's documented
  `clock_opt_design -cts` followed by `optDesign -postCTS -setup`.

Two intermediate real probes were stopped after they falsified a 1.5x area/residual-cap approach.
The user then explicitly ended further live validation for this change; no complete P&R is claimed.

## Other product defects fixed

- Rediscovery now preserves the saved Site bindings rather than saving `bindings: {}`.
- Successful PnR readers expose requested/effective utilization, area expansion and route-layer index.
- A failed node's blocker tail now retains a bounded `HIMA_STAGE_DIAGNOSTIC` projection from the
  Pack's structured stage record, including facts, execution identity and artifact references.
