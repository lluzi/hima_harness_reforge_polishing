# MAGE scribe-line placement 0.1.0

## Business

Test structures (overlay targets, CD-SEM targets, scanner alignment marks, WAT test keys, bonding
marks) must be placed in the scribe lanes of a reticle Frame. No single document captures every
downstream engineer's unwritten requirement ("keep my marks where my recipe expects them", "put
every key somewhere, in one straight row", "do not empty a field corner"), and these requirements
conflict over a few lanes of 60 µm. Today the customer runs a vendor script flow and accepts whatever
MAGE Auto Refine drops; on the reference frame case the vendor flow drops structures and leaves
some priority marks beyond their target distance limit.

This Pack gives several agents the roles a human placement team already plays: one MAGE Engineer
operates MAGE each round; four consumer agents (Litho/PIE, Overlay & CD metrology, Scanner
alignment, WAT) stand in for the downstream engineers, evaluate each candidate from their own
working perspective under a versioned consumer model, and file concrete Findings and Requests until
no issue remains or a genuine trade-off reaches a human as a Decision Request carrying every
consumer's own numbers.

The product claim this Pack delivers evidence for (not a claim this version itself proves against
real MAGE — see FABRIC.md): on the same frozen inputs, the team's placement should be at least as
good as the incumbent on completeness, fidelity and consumer rework, never worse on native legality,
and every delivery should be natively verified. A quantified trade-off request is a complete
engineering delivery with `goalMet` false — leaving residual drops or distance violations honestly
reported is not a failure of this Pack, only of the placement problem it was handed.

## Golden flow

One `hima-flow/1` sequence: `prepare-case` → `measure-incumbent` → a `repeat` of up to four placement
rounds (`engineer-place` → four `review-*` consumers → `decide-round`) → `evaluate-placement` →
`deliver`. Each round is single-threaded by construction: the Engineer reads the previous round's
open Requests and best state, delivers one new candidate and answers the Ledger; each consumer reads
only the current candidate; `decide-round` (program code, not a resident role) joins the four
reviews, updates the best measured state, and routes `continue` or `stop`. The round limit is fixed
at four in `graph.yml`'s `maxIterations`; strategy knobs cannot change it.

## Answers

Success is measured on four axes versus the modelled incumbent: completeness (fewer dropped
structures), fidelity (fewer priority marks beyond the target-distance limit, lower order
deviation), consumer rework (lower total modelled cost across the four active consumer models), and
native legality (zero new native violation rows). `goalMet` is explicit and may legitimately be
false on a complete, honestly reported best-effort delivery. Cost, round count, and session count
are not engineering victory conditions.

## Ambiguities resolved

- **Serial resident roles in a `repeat` block, not OpenCode subagents inside one Task.** The user's
  2026-10-12 steering asked for the existing, proven Harness shape (the ATCS Pack's resident-Task-
  in-a-sequence pattern), not the brief's own R1/R2 subagent design and not HimaTeam, which is not
  ready. Four consumer roles ship in 0.1.0; `role-bonding.md` and the bonding consumer-model template
  ship for a later version because the reference case carries no partner-wafer data — see
  `knowledge/role-bonding.md` for exactly what a later version would need to add.
- **Costs with sources, not an unwritten requirement guessed at.** Every consumer model names each
  requirement's `source` (`rule-file`, `customer`, `public-research`, or `assumption`) and
  `confidence`. A parameter the customer has not supplied is `unknown`, never a guessed default or a
  silent zero.
- **An exact grid DP for least displacement, not an LP.** `planner.py`'s `least_displacement` is
  exact on the placement grid and needs no numeric library — the Pack stays standard-library-only
  and 3.8-compatible (the Linglong resident container runs Python 3.8.16).
- **Batch-per-round MAGE scripts, not a long-lived session.** `mage-round` runs one
  `mage-frb <script> -noterm` invocation per round; this is the verified shape (replaying a complete
  PLA). A long-lived queue-fed session is an S2 optimisation, not qualified here.
- **No customer data in this repository.** Every fixture under `flow/tests/` is synthetic. The real
  frame-case package is evaluated only machine-locally
  (`/Users/lluzi/code/mage_smart_conflict_resolver/research/mage-resident-agent-20261012/pack-eval/`),
  outside this repo, by the planning session (Task 11), not by this Task.

## Knowledge applied

`placement-playbook.md` carries the Engineer's whole-round method: the observe/diagnose/plan/apply/
judge loop, the six diagnosis classes in their action order, the exact slot planner as the only
planning tool, the best-measured-state order, and the candidate delivery shape.
`mage-capabilities.md` separates the four templates this Pack has actually run (V) from every other
MAGE command, which is documented only (D) until a real licensed run qualifies it.
`state-and-evidence.md` keeps modelled, native, and (absent) device facts from being mixed, and names
the F8 cross-stage identity anomaly as its own `identity-unknown` diagnosis class. `review-protocol.md`
carries the four-step round protocol, every record's real JSON shape, and a worked two-round example.
Five `role-*.md` files give each resident its own complete brief, consistent with its
`contract.yml` tool description and the real CLI subcommands and flags it may call.
