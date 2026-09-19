## Goal template

The primary Goal is a matched E0 design-QoR result for the Site-bound design. Parameter
`target_fmax_improvement_pct` is a number in percent, minimum 0.1, maximum 25, default 5. Parameter
`target_period_ns` is a number in ns, minimum 0.1, maximum 5, default 0.5; it identifies the common
requested clock and bounds `clock-period-at-most`. Goal met requires, on the same admitted cumulative
Library and matched final-database comparison, `comparison-evidence-valid`,
`fmax-improvement-at-least-target`, `fmax-improved` and `clock-period-at-most` all PASS.

F0-F3 do not predict that Goal. F0 is the function/interface/generator feasibility prerequisite.
F1 local structure, F2 design mapping and F3 timing are parallel free factors, not sequential
confidence levels. They describe which candidate Library deserves a bounded E0 observation. The
open-source optimization objective is a Pareto frontier over their complete vectors, with no fitted
route delta, expected Fmax gain or cross-design prediction target.

Knowledge shaping this section: `over-constrain-and-read-the-violation.md` makes the common requested
clock and its pressure explicit; `end-honestly-in-more-than-one-way.md` prevents the research gate
from becoming a second definition of Goal met.

## Constraints

Every evaluation is hash-bound to one RTL list, elaboration top, constraint summary, foundry Library,
cumulative custom-Library manifest, candidate delta and tool/profile identity. Reference `L(k)` and
augmented `L(k) union delta(k)` use the same Yosys/ABC script, top, constraints, driving Cell, load,
delay target, proxy-STA assumptions and deterministic settings. Unsupported constraint content is an
explicit unknown; mapping failure, missing timing arcs, combinational loops, unknown sequential Cells
or multi-clock ambiguity fail closed.

F0 must establish Boolean/interface identity and generator feasibility. F1 preserves levels,
nodes/edges, cut width, reconvergence, domination, repeated non-overlapping support and overlap. F2
requires an actual open-source mapped netlist and reports adoption, instance/depth distribution,
buffer/inverter pressure and fanout/load. F3 reports proxy-STA frontier, endpoint-family-deduplicated
negative-slack mass, path-family coverage and migration under the same assumptions. F3 is an
indicator, not commercial timing. A `pairwise_relation` belongs only to this two-arm evaluation; it
cannot assert FW-07 portfolio-frontier membership.

An E0 observation judges one candidate Library, never one Cell in isolation. Admission requires
complete and recomputable evidence, valid F0 identity/feasibility, handled overlap and membership in
the independently recomputed Library frontier. F1, F2 and F3 are classified independently as
positive, neutral, mixed or explicitly negative. The free-factor condition passes unless all three
parallel factors are explicitly negative. A negative F3 alone, zero open-source adoption in F2, or a
negative F1 alone remains evidence but cannot veto the Library. Admission means “worth observing”,
never “expected to gain”. Missing evidence still fails closed because it is not a factor result.

The function-local Judge records whether the full free metric vector is complete, but both PASS and
FAIL enter the one `research-candidates` Workshop. This is not admission to generation or E0: it lets
the Agent see which candidates lack a closed break-even window and select a different evidence-bound
subset. Deterministic merge, generator contract, Boolean proof, conflict, budget and later Portfolio
gates still fail closed. A free proxy result therefore cannot suppress research or silently become a
commercial decision.

E0 holds RTL, constraints, tool/core count, once-expanded core, frozen IO pins, PG mesh,
no-DCAP policy, placement/optimization density target no greater than 85%, physical
inputs, route settings and analysis view fixed. Tap Cells count against occupancy; DCAP and
ordinary filler are omitted in this setup-only Campaign. Both DC arms use 50% clock uncertainty and
explicit high-weight reg2reg pressure. Both route arms use 25% uncertainty plus 50 ps. Both clock
trees use only Site-declared DCCK buffer/inverter families. The cumulative custom Library Portfolio
is the declared logical arm difference. Generated masters must be adopted in synthesis and retained
in the final route database. Unknowns cannot pass; rejected generated databases cannot run downstream.

Each P&R arm enumerates one worst setup path for every register data endpoint. The reference freezes
`Q_target` from `q_e = period - slack`; the generated arm uses that same target. `compare` writes a
hash-bound frontier response with resolved endpoints, new entrants, remaining frontier, regressions,
improvements and violation migration. It does not assign per-Action causality.

Knowledge shaping this section: `assert-the-checker-options.md`, `one-checker-per-session.md`,
`attribute-by-database-relation.md`, `over-constrain-and-read-the-violation.md`,
`knowledge/full-mining-method.md` and `knowledge/site-profile.md`.

## Run contract

The Site binds a read-only design root, an explicit RTL file selection, elaboration top, constraints,
foundry Liberty plus its optional separate compiled DB, physical inputs, tool stack and writable Campaign workspace. HimaGuide may discover
and construct these bindings; users do not write Pack YAML. No Pack-owned top, design, process path,
customer command or precomputed candidate is allowed.

The license-free Framework is invoked through `/usr/bin/python3` and the single deep interface in
`flow/library_richness.py`: a hash-bound request produces a hash-bound evaluation. It wraps pinned
Yosys/ABC and the Pack proxy-STA implementation, retaining commands, scripts, logs, mapped netlists,
cell census, return codes, unsupported constraints and all source/tool/Library hashes. The Framework
never invokes LC, DC or Innovus. The existing `flow/stages.py` adapters invoke generator, layout and
characterization for the current delta only, and invoke Library Compiler, Design Compiler and Innovus
only after the commercial-validation gate through Site-declared wrappers and licences.

The workspace holds `flow/library/baseline-reference.json`, immutable
`flow/library/shards/NNNN/` directories and `flow/library/cumulative-manifest.json`. The transition is
`L(k+1) = L(k) union delta(k)`. Old shard bytes and deliverables are verified and reused; commercial
exit deterministically assembles the cumulative Liberty/LEF once when a downstream tool requires a
single file. Before materialization, every new candidate id receives the next immutable shard
namespace (`G0001`, `G0002`, ...); physical Liberty/SPICE/LEF Cell names therefore cannot alias a
different Cell from an earlier generation. Exact function reuse remains governed by the full
function identity, while cumulative-manifest and assembled-Liberty collision checks fail closed as
independent defenses. At the pre-mapping gate, the materialized shard identity rejoins its original
function/local portfolio by immutable Boolean/interface identity. The gate rebuilds the candidate
DTO with the namespaced request and independently recomputes the strict F0/F1 portfolio over the
actual Library delta. A route-local candidate label is never used as the cross-stage identity, and
the Workshop can choose another eligible portfolio without bypassing equivalence,
generation-feasibility or local-structure checks. `MAX_NEW_CELLS` is 1..50 per research round. It does not change the meaning of the old
`MAX_CELLS`; a separate measured cumulative cap limits storage and mapping cost. Because the Library
is append-only and the reference graph permits eight generations, Campaign Preparation requires
`MAX_CELLS >= 8 × MAX_NEW_CELLS` (400 at the reference 50-Cell round budget). An insufficient Site
profile is rejected before a Campaign starts rather than becoming a deterministic late-generation
Hard blocker. The 12-hour
Campaign time box, 480 infrastructure act-attempt ceiling, final 15-minute closing reserve and Site
Job cap of at most five remain explicit; they do not authorize 480 commercial routes. Commercial
validation has a default two-exit Campaign budget, not a Runtime constant. A frozen E0 baseline may be
reused only while every input and method identity remains unchanged.

Required Framework outputs include one complete evaluation record, reference/augmented mapped
netlists, F0-F3 raw vectors and pairwise relation, residual graph, cumulative manifest, failure
reasons and deterministic recomputation facts. The FW-07 portfolio separately writes cross-candidate
and cross-round frontier identity. Existing generation, compile, adoption, route, verification and
compare records remain the E0 evidence chain. Immutable attempts and their artifacts remain under
`flow/artifacts/STAGE/run-UUID`; a reader verifies referenced bytes before admitting observations.

Knowledge shaping this section: `what-a-golden-flow-is.md` keeps the Framework as the authored method
rather than a customer prerequisite; `assert-the-checker-options.md` and `one-checker-per-session.md`
bind each output to its engine and options; `knowledge/site-profile.md` defines Site-owned inputs.

## Semantics

The evaluation Reader emits only facts it can independently recompute. F0 values are
`proxy_boolean_equivalent`, `proxy_interface_compatible` and `proxy_generator_feasible`, each count
0 or 1, plus `proxy_break_even_local_bound` in ns as a local Cell-delay bound, not expected route gain.
F1 values are `proxy_local_level_delta` in count, `proxy_removed_node_count` in count,
`proxy_cut_width` in count and `proxy_reconvergence_coverage` in percent. The delta convention is
augmented minus reference and is stated on the observation.

F2 values are `proxy_mapped_instance_delta` in count, `proxy_logic_depth_p95_delta` in count,
`proxy_buffer_inverter_pressure_delta` in count and `proxy_fanout_load_delta` in index units, together
with `proxy_adopted_candidate_count` in count. F3 values are
`proxy_worst_reg2reg_delay_indicator` in ns and `proxy_negative_slack_mass_indicator` in ns, plus
source-linked path-family coverage and migration in the evaluation record. These are open-source
indicators and never commercial Fmax facts.

Library values are `new_library_cell_count` and `cumulative_library_cell_count`, both count.
Decision-support values are `proxy_metric_vector_complete`, `portfolio_frontier_membership` and
`e0_library_validation_candidate`, each count 0 or 1. `proxy_pairwise_relation` is a declared
categorical relation over the current reference/augmented vectors; it never denotes a cross-round
frontier. The FW-07 portfolio is the sole producer of `portfolio_frontier_membership`.

E0 retains the existing independently read `comparison_valid`, `matched_conditions`,
`foundry_setup_wns`, `setup_wns_delta`, `foundry_fmax_mhz`, `generated_fmax_mhz`, `fmax_delta_mhz`,
`fmax_improvement_pct`, `fmax_improved`, adoption, route-retention and verification values. Fmax is
derived only from each restored final database's common requested clock and setup slack. Area, power,
congestion, hold, DRC and connectivity remain labelled secondary observations. Post-route hold is
reported but never repaired by `optDesign -postRoute -hold`, because this Campaign spends physical
optimization effort on the primary Fmax/setup objective. Every absent value is
null with an `unknownReason`; no zero stands in for missing evidence.

Workshop-selection values remain `research_hypothesis_count` and `selected_count`, both count. They
state what the bounded research program proposed, not that a proposal is good, adopted or beneficial.

Knowledge shaping this section: `attribute-by-database-relation.md` separates offer, adoption and
route retention; `one-checker-per-session.md` preserves engine attribution; `knowledge/full-mining-method.md`
keeps predicted/indicator/commercial evidence classes distinct.

## Judge rules

`proxy-evidence-complete` checks identities, supported-scope F0-F3 values, unknown reasons and raw
vector recomputability. `proxy-pairwise-relation-known` checks that the two arms are comparable and
that the full current relation was retained; it does not require every metric to improve and does not
assert benefit. `portfolio-frontier-member` accepts only the FW-07 portfolio's independently
recomputed cross-Library, cross-round membership. `e0-library-validation-candidate` requires complete
evidence, F0 validity, handled overlap, current Library frontier membership and verifies that F1, F2
and F3 are not all explicitly negative. Its PASS authorizes one scarce E0 observation; it is not a
gain prediction and does not state that any individual Cell passed.

The commercial adoption gate still requires at least one generated master in the custom synthesis
netlist. The final Judge applies `fmax-improvement-at-least-target` first because the current Harness
uses the first rule as the node's routing outcome, followed by `comparison-evidence-valid`,
`fmax-improved` and `clock-period-at-most`. A target miss therefore reaches `next-research`; a missing
mandatory fact remains UNDETERMINED. Only all four PASS on the same matched E0 record can support Goal met. Each verdict cites the exact evaluation,
manifest, mapped netlist or restored final database/report bytes from which it was read. A missing
mandatory fact is UNDETERMINED and routes to the blocker; no inner evaluation PASS can replace E0.

Knowledge shaping this section: `attribute-by-database-relation.md`,
`assert-the-checker-options.md`, `end-honestly-in-more-than-one-way.md` and
`knowledge/full-mining-method.md`.

## Choosers

`research-next` reads the current residual graph, complete F0-F3 vector, pairwise relation, FW-07
frontier, cumulative manifest, failures, round budget and any condition-matched E0 observation. On a
failed or dominated license-free candidate it may change research lenses, K-cut bounds,
dominator/reconvergence/repetition analysis, overlap handling, portfolio composition or next search
region. It records which residual structure the change is meant to affect and advances
`algorithmRevision` only with current evidence. It cannot change the Goal, delete or rewrite a shard,
silently retry a failed identity, write a metric/Judge fact, reinterpret E0 as a prediction target or
start commercial tools.

On a frontier candidate, `research-next` chooses commercial validation only after
`e0-library-validation-candidate` PASS and only while the explicit commercial budget remains. On a
sub-target E0 observation it returns to residual research with the observed condition and unexplained
relationship; it does not fit a numeric correction or rerun the same cumulative Library. It declares
Goal met only after the final commercial Judge PASS. Its converge block watches the recomputed
multi-index frontier across consecutive rounds and stops only when no evidence-backed new direction
or material frontier movement remains within the stated tolerance; missing evidence is a blocker,
not convergence.

After a sub-target E0, the revisit to `evaluation-baseline` retains the same persistent Run and
cumulative Library. The next Workshop receives the hash-bound commercial frontier response and must
answer its new residual question with several grounded hypotheses before selecting one bounded
candidate program. It may investigate alternative-path coverage, dominators/reconvergence,
single/multi-output simplification, drive families, transistor tuning, physical fusion and guarded
non-frontier area recovery; the actual evidence decides which apply.

Knowledge shaping this section: `end-honestly-in-more-than-one-way.md` defines reachable stopping
choices; `knowledge/full-mining-method.md` bounds AI revision and preserves the fixed reference graph.

## Endings

Goal met is reached only when `research-next` receives all four fresh final commercial Judge PASS
verdicts for one matched cumulative Library, including the bound Fmax-improvement target. Research
converged is reached through `research-next`'s converge block after independently recomputed
multi-index frontier stability and no remaining evidence-backed residual hypothesis; it is not an E0
success claim.

Budget exhausted is reached when the time, round, new-Cell, infrastructure-attempt, Site-resource or
commercial-observation budget prevents the next admitted action. It retains all completed vectors,
shards, failures and unknowns. Valid negative commercial observation is reached when E0 completed
under matched conditions but did not meet the Goal and no commercial budget or evidence-backed new
license-free direction remains; it remains a design-conditioned negative result. Hard blocker is
reached when a mandatory input/tool/reader is absent or fails, a Library is refused, identity cannot
be established, an invalid old shard is detected or a mandatory Judge is UNDETERMINED. The blocked
wait retains the exact cause and continuation context.

No function-, local-, mapping- or proxy-STA success can terminate the Campaign as Goal met. A
cancelled or partial commercial attempt cannot support either a positive or valid negative design
conclusion.

Knowledge shaping this section: `end-honestly-in-more-than-one-way.md` and
`attribute-by-database-relation.md`.

## Workshops

One `research-candidates` Workshop uses the existing owned Coding interface after deterministic
mining/evaluation has produced a compact, hash-bound residual context. It receives the residual logic
and timing graph, raw F0-F3 vector, current pairwise relation, FW-07 portfolio frontier, cumulative
manifest, prior candidate identities and failures, remaining budgets and condition-labelled E0
observations. It reads detailed sources by their retained hashes when a hypothesis needs them.

The Campaign Agent implements only the bounded research function in `research-template.py`.
`ai_research_runner.py` owns I/O, membership, Boolean/interface identity, source and code hashes,
schema, timeout and budget. The Workshop includes the sequential `onsite-inspiration` lens as a
seventh strategy above the six fixed miners. It reads their combined evidence and, after the first
E0, must cite the current commercial frontier response. It may contribute at most ten proposals to
the same 50-Cell round Portfolio and never creates another commercial arm. The Workshop forms evidence-linked research lenses,
explains which structural indices each should change, and produces exact source-linked candidate
identities. Its Reader emits `research_hypothesis_count`, `selected_count` and
`onsite_inspiration_selected_count`; later deterministic
evaluation, not the Workshop, emits all F0-F3/E0 facts.

The Workshop may write candidate/portfolio code and suggest the next search region. It may not embed
candidate ids as fixed Pack answers, forge an observation, delete assets, edit the Goal, alter the
fixed graph, launch LC/DC/Innovus or create a hidden execution Agent. Second-tier models are supported
by keeping the context compact and the tool/interface mechanics outside authored code.

Knowledge shaping this section: `knowledge/full-mining-method.md`,
`assert-the-checker-options.md` and `one-checker-per-session.md`.

## Knowledge

`knowledge/full-mining-method.md` is the method document to update for F0-F3/E0 evaluation, pairwise
versus FW-07 portfolio authority, residual AI research, immutable delta Library growth, scarce E0
observation and honest stopping. `knowledge/custom-cell-fmax-probe-method.md` remains the commercial
pressure and matched-reading reference; it must not describe the probe as the license-free search
front end. `knowledge/site-profile.md` remains the portable design/process/tool binding reference and
must add license-free tool identity and resource expectations without fixing a customer path or tool
year.

The Pack preserves Framework evaluations, mappings, research code, manifests, commercial records and
negative findings as Campaign assets with provenance. Runtime results do not automatically modify
these Pack knowledge files. A Pack owner must review a method change and publish a new fixed Pack
version.

Knowledge shaping this section: `what-a-golden-flow-is.md` separates calibration references from
customer requirements; `knowledge/full-mining-method.md` and `knowledge/site-profile.md` define the
existing Pack knowledge boundary.
