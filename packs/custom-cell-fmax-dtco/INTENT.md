## Business

This Pack gives an engineer and the Campaign Agent a portable method to discover,
build, characterize, adopt, and evaluate custom standard-cell candidates for a
Site-bound design. It has no fixed design, process, PDK path, customer flow, or
precomputed candidate.

## Evidence boundary

Candidate methods consume the current probe netlist, explicit reg2reg timing report, and Site library.
Equivalent proposals are folded into one source-attributed pool. The AI orders up to 50 unique Cells;
all are built into one library and pass through one common DC-to-APR validation flow. Adoption records
show which Cells were used and credit every contributing method without treating methods as competitors. A result is
credible only after a generated library is visible, used by more than zero instances,
and reaches a completed final route database that is the direct source of timing.

The baseline and generated arms share RTL, constraints, a once-expanded 25% target-utilization
floorplan, the baseline arm's frozen IO-pin plan, physical inputs, tool entry points, and route
settings. The probe and both syntheses use 50% clock uncertainty and an explicit high-weight reg2reg
path group. The probe must retain at least `-0.1 ns` reg2reg WNS rather than relax toward closure, and
both route arms use 25% clock uncertainty. I/O violations never substitute for Fmax pressure. The only permitted
arm difference is generated Cell/library content. Area, power, congestion, and physical observations are retained
when available, and explicitly unknown when not measured; they do not decide Fmax.

## Endings

Failure, missing coverage, unknown measurements, rejected libraries, and tool faults
remain distinct findings. A positive final result requires matched conditions, no known
invalidating fault, route completion, positive adoption, and higher Fmax calculated from
the final generated-arm timing report. The Pack never promotes Campaign results into its
method knowledge automatically.
