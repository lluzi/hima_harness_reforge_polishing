# Library richness evaluation and residual research

This Pack treats Yosys, ABC and the local proxy STA as a license-free **evaluation agent**. They do
not predict commercial QoR, Fmax gain or the error of a future DC/Innovus result. Their job is to make
many cheap, reproducible observations about how an additive custom Cell Library changes logic before
the Campaign spends a commercial-tool trial.

## Free factors and expensive observation

F means license-free evidence. E means an expensive observation. F0 is the feasibility prerequisite;
F1, F2 and F3 are parallel factors over one candidate Library:

- **F0 function and feasibility** checks the exact Boolean/interface identity, foundry absence,
  generator contract and whether the mapping flow can see the proposed Cell.
- **F1 local structure** records levels and nodes removed, cut width, reconvergence and domination,
  overlap, non-overlapping support, path-family coverage and Library cost.
- **F2 design mapping** records actual whole-design adoption by the open-source mapper, mapped
  instances and depth, buffer/inverter pressure and fanout/load indicators.
- **F3 timing indicators** record scenario-specific proxy delay, negative-slack mass, path-family
  coverage and path migration. These are indicators from a declared model, not routed timing.
- **E0 commercial QoR** is one matched DC/Innovus observation under the Campaign's controlled
  conditions. It is evidence for this design and flow only.

Never fit F0-F3 to produce a portable benefit prediction. Compare each condition-labelled E0 outcome
with the retained factor vector to learn which F1/F2/F3 axes have positive association with expensive
commercial benefit. Future free factors may be added as F4, F5 and beyond. This is factor discovery,
similar to retaining research factors in quantitative analysis; it is not permission to turn one
design into a universal threshold or expected-gain model.

## One cumulative Library and delta-only work

The foundry Library reference is immutable. Every accepted function enters one cumulative custom
Library through an immutable shard. A round generates only its new delta; it does not rebuild or
re-characterize prior accepted functions. The manifest binds each stable function identity,
physical Cell name, shard hash, state and known failure. `MAX_NEW_CELLS` limits one round and
`MAX_CELLS` limits the cumulative Library.

Each open-source design-mapping comparison uses the same RTL, top, constraints, tool identities and
mapping plan for its reference and augmented arms. The judgment object is the whole candidate
Library round, never an individual Cell. The
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

Missing hashes, incomplete metric vectors, failed mapping, budget overshoot or an unreproducible
frontier cannot pass because they are not valid factor observations. With valid F0 and a current
Library frontier member, F1/F2/F3 are classified independently as positive, neutral, mixed or
explicitly negative. The free-factor gate rejects on direction only when all three are explicitly
negative. One negative factor cannot veto the other two. Passing authorizes E0 once; it does not mean
the Library is expected to improve.

If no candidate passes, retain the negative result, the failed hypotheses and the next residual
question. If the budget or plateau condition ends the loop, stop honestly. If a candidate passes,
freeze the cumulative manifest and run the existing matched commercial tail once. Only the resulting
E0 evidence may support a design-specific Fmax claim.
