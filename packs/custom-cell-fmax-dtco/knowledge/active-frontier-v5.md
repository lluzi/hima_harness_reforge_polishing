# Active Frontier v5: grounded innovation and commercial feedback

This Pack optimizes one Campaign, not one timing path and not one Cell. Its persistent control state is
an endpoint-complete timing graph, a cumulative custom Library, the evidence for every attempted Action,
and one frozen commercial target. The Campaign Agent uses that state to create new research algorithms;
it never repeats a fixed Cell ranking after the commercial design has answered.

## The controlled objective

For baseline period `T0` and endpoint setup slack `s_e`, use `q_e = T0 - s_e`. Freeze
`Q_target = max(q_e) / (1 + target_fmax_gain)` from the reference arm. Every endpoint at or beyond the
frozen target is part of the Active Frontier, and every endpoint remains a regression sentinel.
Improving one current WNS path is insufficient: another alternative can take over immediately.

The first-principles question is therefore:

> Which compatible set of logic, electrical and physical actions lowers every remaining frontier
> alternative enough to move the global maximum, without sacrificing previously obtained value?

A proposal must name the endpoint families or graph region it can influence, the mechanism that may
produce gain, its boundary risks and the observation that would falsify it. It may use a Cell only once
when that one use has enough influence. Reuse count is a cost signal, not a hard admission rule.

## Research lenses available to the Agent

These are starting points, not a fixed algorithm. The Agent should combine, reject or refine them from
actual graph and commercial response data.

1. **Alternative-path coverage.** Find the set of paths that can take over for every frontier endpoint.
   Prefer actions whose influence intersects several alternatives or several endpoints.
2. **Dominator and reconvergence structure.** Search for nodes or subgraphs that control many frontier
   cones. Distinguish a local depth reduction from a change that reaches the endpoint frontier.
3. **Logic simplification.** Use single-output or multi-output functions when they remove a full logic
   level, absorb polarity or preserve a shared expression. Multi-output value requires every output to
   be useful and its physical sharing claim to be explicit.
4. **Electrical families.** A useful Boolean function may still need D2/D4/D6/D8 variants. Long,
   high-load or slew-limited edges call for drive-family or transistor-tuning hypotheses rather than
   more functional enumeration.
5. **Physical fusion.** Nearby connected Cells may internalize a real net, via and RC. The certificate
   must include input-cap, bypass-sink, pin-access, displacement and sink-divergence penalties.
6. **Physical coherence.** Reject a logically attractive merge when its sinks pull in different
   directions or when full placement destroys its locality. Prefer bounded communities with logical,
   physical and timing cohesion.
7. **Non-frontier recovery.** Recover area, wire and power where slack guards prove the region cannot
   enter the frontier. Preserve these gains while the frontier line pursues Fmax.
8. **Commercial-response diagnosis.** Treat resolved endpoints, new entrants, remaining frontier,
   fixed violations and new violations as a state transition. Do not convert one Portfolio response
   into per-Action causality.

## Local evidence and break-even reasoning

Free tools and Mock Liberty report indicators and conditional envelopes. They do not decide E0 and do
not predict commercial MHz. A closed local window includes the source subgraph, upstream drivers,
bystander sinks, every boundary output, loads, local RC and endpoint influence. It reports the maximum
candidate arc delay and input capacitance compatible with the proposed local gain. An incomplete window
stays incomplete.

Before spending E0, the Agent should explain why the proposed Portfolio can cover more of the frozen
frontier than the previous one. The bounded graph evaluator applies the whole Portfolio, propagates all
endpoints and retains alternative-path takeover. Its result remains conditional evidence.

## Feedback after E0

The comparison stage writes one hash-bound commercial frontier response containing:

- reference and generated frontier counts under the same frozen `Q_target`;
- resolved reference endpoints and new entrants;
- the complete remaining frontier, ordered by generated `q_e`;
- largest frontier regressions and improvements;
- fixed and newly created violations;
- claim limits that forbid per-Action causality and portable QoR prediction.

When the Goal fails, the graph returns through `next-research` to the evaluation baseline. The next
Workshop receives this response with the cumulative Library, prior rounds, failures, metric vectors and
candidate pool. It must answer the new residual question. Repeating the same proposal, ignoring a new
bottleneck, changing the Goal, or hiding a negative result is not research progress.

A useful next generation normally presents several independent, evidence-linked hypotheses, such as:

- one Portfolio aimed at simultaneous frontier coverage;
- one electrical/drive-family response to a long or heavily loaded bottleneck;
- one physical-fusion or placement-coherence response;
- one explanation for preserving prior area/wire/power improvements.

The Agent selects a bounded candidate program from actual evidence. Deterministic code owns identity,
budgets, conflicts, proof, rollback and result hashes.

## Asset accumulation and stopping

The custom Library grows monotonically. Successful Cells, failed hypotheses, break-even envelopes,
commercial responses and generated research code remain knowledge assets. No generation deletes an old
node, shard or failure record.

Stop honestly when the Goal is met, the declared budget is exhausted, evidence converges without a new
bounded hypothesis, or a hard blocker prevents progress. A failed Fmax attempt that explains the
remaining frontier and changes the next experiment is a valid knowledge result; it is not Goal success.
