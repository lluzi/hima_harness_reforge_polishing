## Business

This Pack gives an engineer and the Campaign Agent a portable method to discover,
build, characterize, adopt, and evaluate custom standard-cell candidates for a
Site-bound design. It has no fixed design, process, PDK path, customer flow, or
precomputed candidate.

## Evidence boundary

Candidate routes consume the current probe netlist, timing report, and Site library.
Selection programs record the source candidate identifiers they choose. A result is
credible only after a generated library is visible, used by more than zero instances,
and reaches a completed final route database that is the direct source of timing.

The baseline and generated arms share RTL, constraints, floorplan, physical inputs,
tool entry points, and route settings. The only permitted arm difference is generated
Cell/library content. Area, power, congestion, and physical observations are retained
when available, and explicitly unknown when not measured; they do not decide Fmax.

## Endings

Failure, missing coverage, unknown measurements, rejected libraries, and tool faults
remain distinct findings. A positive final result requires matched conditions, no known
invalidating fault, route completion, positive adoption, and higher Fmax calculated from
the final generated-arm timing report. The Pack never promotes Campaign results into its
method knowledge automatically.
