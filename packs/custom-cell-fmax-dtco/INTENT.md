## Business

This Pack gives an engineer and the owning Campaign Agent a portable method for improving the
function richness of a cumulative custom standard-cell Library for one Site-bound design. The Pack
starts from the design's RTL, constraints and foundry Library. It does not carry a fixed design,
process, PDK path, customer flow, candidate list or expected benefit.

The license-free loop explores which new Boolean functions can change important reg2reg logic. It
measures a layered evaluation vector rather than predicting a commercial result: F0 function and
interface feasibility; F1 local levels, nodes, edges, cut width, reconvergence, domination and
overlap; F2 whole-design mapper adoption, depth, instances, buffer/inverter pressure and fanout/load;
and F3 proxy-STA frontier, negative-slack mass, path-family coverage and path migration. One
reference/augmented evaluation may state only their pairwise relation. Cross-candidate and
cross-round Pareto-frontier membership comes only from the independently recomputed FW-07
portfolio.

The Library grows monotonically as `L(k+1) = L(k) union delta(k)`. Old shards and their generated
Cell deliverables are reused byte for byte; only the new delta is generated, laid out and
characterized. AI studies the current residual graph, complete metric vector, frontier, cumulative
manifest and retained failures, then writes a bounded research algorithm for the next delta. The
deterministic Framework owns identity, Boolean checks, metrics, budgets, artifact hashes and
independent rereading.

Matched Design Compiler and Innovus results are F4 design-QoR observations. They are run only for a
Pareto candidate admitted by the explicit commercial-validation gate. F4 is compared with F0-F3
under the stated design and flow conditions to learn which indicators were useful in this case. It
is never a target for proxy prediction accuracy, a fitted correction, an expected gain or a
cross-design threshold. The current Campaign's business Goal remains at least 5% matched post-route
Fmax improvement with the cumulative Library as the only arm variable.

The Campaign ends honestly with Goal met, research convergence, budget exhaustion, a valid negative
commercial observation, or a hard blocker. A person must never have to guess which evidence layer a
claim belongs to, whether an unknown was represented as zero, whether a Cell was merely feasible or
physically adopted, whether a relation is pairwise or portfolio-wide, whether an old Cell was
regenerated, or whether a commercial result was turned into a predictor.

## Golden Flow

The independently assessed Framework entry and its hash-bound request/evaluation boundary are at
`flow/library_richness.py`

The mapping, graph, portfolio, cumulative-Library and proxy-STA implementations it composes are at
`flow/domain/`

The Pack's existing generation, physical implementation, comparison and retained-evidence adapters
are at
`flow/stages.py`

Read those files for the real executable interfaces, failure records and output identities. Read
`flow/README.md` for the developer entrypoints. The HimaFabric graph may wrap these entrypoints in
Phase 2, but it does not copy or reimplement the Framework.

## Answers

1. What business is delivered? — A Campaign that uses an open-source model, HimaHarness and this
   Pack to build a cumulative custom-cell Library and pursue a real matched post-route Fmax result
   for the user's own design.
2. What can vary between customers? — Design, top, RTL, constraints, foundry Library, physical
   inputs, Site paths and compatible tool versions. The method and evidence meanings remain stable;
   retained calibration-design and process identities remain external evidence, not Pack invariants.
3. What is optimized before commercial EDA? — A multi-index F0-F3 structural evaluation and its
   Pareto frontier. Prediction accuracy, expected commercial gain and a universal score are not
   objectives.
4. What is F4? — The matched commercial design-QoR observation for this design and these conditions.
   It can explain or challenge the indicators, but it cannot train a cross-design benefit forecast.
5. How do pairwise and portfolio evidence differ? — One evaluation reports the reference/augmented
   pairwise relation. Only the FW-07 portfolio can compute frontier membership across alternatives
   and rounds from their preserved raw vectors.
6. How does the Library evolve? — Each admitted round appends an immutable delta shard. Existing
   Cells and deliverables remain assets and are not regenerated; rejected identities and reasons
   remain available to prevent repeated trials.
7. What does AI control? — The research lens, bounded candidate/portfolio code and the next search
   area, based on the actual residual problem. It cannot change the Goal, forge a measurement,
   delete an asset, write a Judge fact or start a commercial flow by itself.
8. What is the Cell budget? — Up to 50 new Cells may be proposed in one round, ordered by the actual
   research evidence. This is `MAX_NEW_CELLS`, not a reinterpretation of the old `MAX_CELLS` and not
   the cumulative Library capacity.
9. What is the commercial budget? — Commercial validation is a scarce, explicit Campaign budget,
   with two exits by default rather than a Runtime constant. One frozen matched baseline is reused
   while its input and method identity remain unchanged; each admitted cumulative Library gets at
   most one corresponding custom-arm observation.
10. What remains controlled in F4? — RTL, constraints, tool and core count, the once-expanded 25%
    target-utilization floorplan, frozen IO-pin plan, physical inputs, route settings and analysis
    view. Both synthesis arms use the same 50% clock uncertainty and reg2reg priority; both route
    arms use the same 25% uncertainty plus 50 ps; DCCK buffer/inverter lists build both clock trees.
    The cumulative custom Library is the only arm variable.
11. What constitutes success? — Generated masters must first be adopted by logic synthesis and be
    present in the final routed database. Only a complete matched F4 comparison showing at least the
    bound Fmax gain, with no known invalidating fault, reaches Goal met.
12. How are failures used? — Function, local-structure, whole-design mapping, proxy-STA, generation,
    commercial adoption and post-route failures remain distinct, hash-bound assets. They direct the
    next residual study or support an honest ending; they never become a fabricated zero or a claim
    of generalized failure.

## Ambiguities resolved

- The earlier method used “proxy improvement” and a numeric proxy/commercial error band as if the
  open-source layer predicted route delta. The author resolved this: F0-F3 form an evaluation agent;
  F4 is an observed matched result, and prediction accuracy is not an objective.
- The earlier method could read a pairwise reference/augmented result as a portfolio decision. The
  author resolved this: pairwise relation belongs to one evaluation; only FW-07 may compute a
  cross-candidate, cross-round Pareto frontier.
- Proxy STA sounds like a timing predictor. It is resolved as the F3 timing-indicator layer, useful
  for detecting frontier movement, slack mass, coverage and migration; it does not forecast
  commercial Fmax.
- “Prediction” in Cell characterization names the provenance of an estimated Liberty model. It does
  not authorize prediction of commercial QoR or benefit.
- The old 50-Cell active-Library wording encouraged rebuilding retained Cells. It is resolved as up
  to 50 new Cells per round plus a separately bounded cumulative Library of immutable shards.
- The former flow put a commercial synthesis probe before mining and repeated DC/APR during search.
  It is resolved as license-free evaluation first, followed only by bounded F4 observation of an
  admitted cumulative Library.
- Post-route evidence can sharpen a later residual graph but is not a first-use input requirement.
  RTL, constraints and foundry Library are sufficient to build the initial open-source graph.
- A custom Cell's adoption count, one timing path, a zero-delay cone upper bound or one composite
  score cannot establish benefit. The complete layered vector, overlap, path migration and final F4
  evidence remain separate.
- The 5% target is a Campaign-level commercial Goal for the current design, not a proxy threshold or
  a promise that transfers to another design.

## Knowledge applied

- `over-constrain-and-read-the-violation.md` — keeps the commercial observation under explicit
  reg2reg pressure and records the options under which timing was measured.
- `end-honestly-in-more-than-one-way.md` — preserves Goal met, convergence, budget, negative-result
  and blocker endings without relabelling one as another.
- `assert-the-checker-options.md` — makes design, Library, constraints, tool profile and analysis
  options part of every evaluation and F4 identity.
- `one-checker-per-session.md` — keeps each metric or QoR fact attributable to one declared engine
  and option set before comparisons are formed.
- `attribute-by-database-relation.md` — requires adoption and route retention to be read from the
  actual mapped netlist or final database rather than inferred from offer or visibility.
- `what-a-golden-flow-is.md` — treats the executable Framework and physical adapters as calibration
  references, not customer inputs or a fixed customer design.
- `knowledge/full-mining-method.md` — supplies the AI research, controlled physical comparison and
  evidence-retention boundaries that this Framework deepens.
- `knowledge/site-profile.md` — keeps design, process, physical and tool specifics in Site binding
  rather than embedding them in the Pack method.
