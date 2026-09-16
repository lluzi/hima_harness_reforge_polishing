# Library richness evaluation and residual research

This Pack treats Yosys, ABC and the local proxy STA as a license-free **evaluation agent**. They do
not predict commercial QoR, Fmax gain or the error of a future DC/Innovus result. Their job is to make
many cheap, reproducible observations about how an additive custom Cell Library changes logic before
the Campaign spends a commercial-tool trial.

## Evidence layers

The evaluation uses four license-free layers and one observed commercial layer:

- **F0 function and feasibility** checks the exact Boolean/interface identity, foundry absence,
  generator contract and whether the mapping flow can see the proposed Cell.
- **F1 local structure** records levels and nodes removed, cut width, reconvergence and domination,
  overlap, non-overlapping support, path-family coverage and Library cost.
- **F2 design mapping** records actual whole-design adoption by the open-source mapper, mapped
  instances and depth, buffer/inverter pressure and fanout/load indicators.
- **F3 timing indicators** record scenario-specific proxy delay, negative-slack mass, path-family
  coverage and path migration. These are indicators from a declared model, not routed timing.
- **F4 commercial QoR** is one matched DC/Innovus observation under the Campaign's controlled
  conditions. It is evidence for this design and flow only.

Never fit F0-F3 to produce a portable benefit prediction. Compare F4 observations with the retained
F0-F3 vectors to learn which indicators were useful under the named design and flow. A disagreement
is evidence, not an invitation to invent a correction factor.

## One cumulative Library and delta-only work

The foundry Library reference is immutable. Every accepted function enters one cumulative custom
Library through an immutable shard. A round generates only its new delta; it does not rebuild or
re-characterize prior accepted functions. The manifest binds each stable function identity,
physical Cell name, shard hash, state and known failure. `MAX_NEW_CELLS` limits one round and
`MAX_CELLS` limits the cumulative Library.

Each open-source design-mapping comparison uses the same RTL, top, constraints, tool identities and
mapping plan for its reference and augmented arms. A candidate is useful only if the evidence shows
an effective transformation on at least one declared metric without hiding regressions or cost. The
single-round `pairwise_relation` describes only that reference/augmented pair. Cross-round selection
comes from the independently recomputed Pareto frontier; the two are never interchangeable.

## AI residual research

The Workshop receives a compact, hash-bound context containing the current F0-F3 vectors, the
recomputed Pareto frontier, cumulative Library and cost, candidate pool, known failures and one
explicit residual question. The Agent writes a bounded pure Python proposal function. It selects only
immutable `proposal_key` values supplied by the runner; it cannot assign candidate identity, change
the Goal, launch commercial EDA or write Judge facts.

Research should attack the remaining structural weakness rather than repeat a fixed ranking. It may
combine timing-family, graph-influence, mapping-pressure and function-diversity lenses. The runner
executes the proposed function once inside its resource limits, validates every returned proposal and
binds the selected generation request deterministically. Invalid or incomplete model output is a
rejection with retained evidence.

Run results remain Campaign assets. They are never copied into this Pack knowledge automatically.
An AE, PE or methodology owner may later review evidence and deliberately publish a new Pack version;
that authoring action is separate from Campaign execution.

## Gates and endings

Missing hashes, incomplete metric vectors, failed mapping, hidden scenario regressions, budget
exhaustion or an unreproducible frontier cannot pass. A portfolio member becomes a commercial
validation candidate only when the declared gate says one matched observation is justified. That
decision means “worth measuring once”; it does not mean “expected to improve.”

If no candidate passes, retain the negative result, the failed hypotheses and the next residual
question. If the budget or plateau condition ends the loop, stop honestly. If a candidate passes,
freeze the cumulative manifest and run the existing matched commercial tail once. Only the resulting
F4 evidence may support a design-specific Fmax claim.
