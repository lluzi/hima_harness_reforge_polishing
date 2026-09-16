# LFR-FW-08 standalone Framework assessment

Date: 2026-09-15

Decision: **approve Phase 2 HimaPack integration** for the assessed source/evidence tree.

This decision says that the standalone evaluation and optimization Framework deserves integration
into the existing Pack. It does not claim commercial Fmax gain, cross-design universality, signoff,
Pack test completion or release readiness.

## Exit criteria

| Phase 1 criterion | Decision evidence | Result |
| --- | --- | --- |
| Stable identity | RTL, tools, Libraries, mapping outputs, portfolio, round, frontier, model context and candidate-pool evidence are SHA-bound | pass |
| Reproducible reference/augmented mapping | Fixed Yosys/ABC profile; real FW-T2 and AES/held-out replays; script-difference audit | pass |
| Explainable proxy limits | Strict Liberty/STA, conditional worst-case policy, F0/F1/F2/F3 labels and fail-closed unsupported structures | pass |
| Commercial relationship boundary | AES retained F4 observations are condition-specific relationships, not prediction targets | pass |
| Held-out frontier progress | Real mapped netlist produced two foundry-absent Boolean candidates; selected Cell was adopted and evaluated | pass |
| Monotonic Library | Immutable shards, disk rehash, delta-only Jobs, physical Cell-name uniqueness and rejection history | pass |
| Second-tier AI research | DeepSeek-V4.1-Flash selected a source-bound `proposal_key`; runner attached the immutable request and executed bounded code | pass |
| Honest convergence | Non-adopted second round is rejected before frontier/plateau/parent accounting | pass |
| Independent review | FW-05 production seams, FW-07 security and final Phase-1 criteria reviewed by separate Agents | pass |

## Final held-out interpretation

The final same-design causal chain is recorded in
[FW-07 held-out evidence](fw-07-heldout-and-model.md). Round 1 improved F1 local structure and F2
mapping and adopted the new Cell, but one optimistic F3 delay indicator regressed by about 1.1623
ps. The round remains useful research evidence, while the commercial-observation gate stays closed.
Round 2 added a different mined function; zero mapper adoption caused it to be rejected before it
could become a frontier member, lineage parent, plateau event or commercial-gate input.

This behavior is the intended methodology: the open-source system grades and organizes structural
experiments; it does not forecast commercial benefit. A future Pack Campaign may choose another
frontier member for a matched commercial observation only when its declared gates pass.

## Verification summary

- Framework/domain Python suite: 50/50 passed;
- strict Liberty/proxy-STA suite: 18/18 passed;
- corpus/relationship evaluator suite: 14/14 passed;
- targeted local LFR contracts: 15/15 passed with 0 Electron and 0 SSH subprocess attempts;
- existing custom-cell Pack contract: 25/25 passed after FW-07 changes;
- TypeScript typecheck, Python compilation, source-identity audit and `git diff --check`: passed;
- real local Yosys/ABC held-out rounds: passed;
- real DeepSeek-V4.1-Flash candidate-pool selection and bounded execution: passed.

No commercial LC/DC/Innovus Job or Desktop test was needed for Phase 1. Raw foundry and commercial
evidence remains ignored/Site-local; only hashes, compact facts and sanitized projections are in
Git.

## Phase 2 boundary

The next task is **LFR-PACK-01**. Phase 2 must wrap the exact Framework implementation and must not
recreate it inside stages, Readers or Agent prompts. `graph.yml`, `contract.yml`, Readers, semantics,
rules, knowledge, test Campaign and release seal remain unfinished until the LFR-PACK tasks pass.
No issue closure or trial release is authorized by this assessment alone.
