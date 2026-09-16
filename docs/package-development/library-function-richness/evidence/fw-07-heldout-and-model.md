# LFR-FW-07 held-out frontier and second-tier-model evidence

Date: 2026-09-15

Commercial EDA jobs started: **0**

## Final causal closure

The authoritative FW-07 result uses `heldout_new_function.sv`. The actual run bound the compact
source bytes with SHA-256 `e5c1c8fd818231bf84af92149a374474547bb4386cab3960df24711e5b887d49`.
The committed review fixture is formatting-only expanded and has SHA-256
`6f05373c207ab3294f23fdbcad31e7336299c5879853cac8684b9ae22a0b1255`; their diff changes only the
module header and `always` statement whitespace. The complete chain is:

```text
real Yosys mapped netlist + reg2reg evidence
  -> production K-cut miner: two foundry-absent Boolean candidates
  -> hash-bound cold-start residual context
  -> DeepSeek selects proposal_key only
  -> deterministic runner attaches immutable generation request
  -> F1 portfolio + paired mapping/proxy evaluation
  -> cumulative Library lineage + cross-round frontier
```

The production mining report contained two buildable `boolean_synthesis` requests and has SHA-256
`d3ce61524cbcbb7af78ab8f06e4b2190df3ef25d187273039f8134ea8a310f36`. The pre-mapping F1
portfolio selected `CAND_HELDOUT_AI_RESIDUAL_A2_SINGLE_0001`; its report SHA-256 is
`f6e4431d0ccee56abd9a0c82378dc3a71d53a89644c320d083a18bdafd1c1853`.

The cold-start frontier had no adopted members and an explicit residual question. Its compact
context state was `cold-start-no-adopted-frontier`, context SHA-256
`f9bd72d636ea9a47cfc9c470dce8af9bb3d9a586cbea9d282b56987fcb6ed188`, and retained file SHA-256
`9712a1dd228b2e3af077183e1ea30f1a48a9ecc19bad6d5b6b93b22d288b83e7`.

DeepSeek-V4.1-Flash selected deterministic key
`proposal:39814e6bd0dc3c389790b5d1a642e64dca806f63f407d3acf0ca248b77e9ebad` without assigning a
candidate ID. The runner bound it to the immutable source request
`CAND_HELDOUT_AI_RESIDUAL_A2_SINGLE_0001`, request SHA-256
`6f4fbc3bed49192c97c3fb6352c34485d419b1aff14d32a6e5adb33e3b30a566`. The final model call used
3,781 prompt and 695 completion tokens; candidate-program SHA-256 was
`8e527c0b1c6bb272eb0fa3eb3485bad2b188235f88f02b60c37a219a6292fba5`. Proposal, response and bounded
execution files have SHA-256 values:

- proposal: `fdf23d246b4c30898c0efdfb915c1241cf69e89c5fdadae14501abb08dbf49e3`;
- API response: `35115004cf65508108485cf74ed99356f7787088c6e1220bd2e56b0f0ab1efb2`;
- execution: `22bc6a11544ad796a28d45ba692937c1c4e058faf6c852e4e7d689b1ec7e426a`;
- executed proposal output: `632aa919b3cb17e05b48f9e2b6fe3d7321bc1327c9223e18f6de2d11ed29429d`.

Round 1 materialized the selected function under deterministic Cell identity
`XS_HELDOUT_AI_RESIDUAL_A2_SINGLE_0001_Y`; Yosys/ABC adopted it once. The evaluation contains F0,
F1, F2 and F3 and has SHA-256
`6bf3756fe1c2f5c82c237267f4a160a05ab8971ac807119f9453ed13a898eb61`. It improved local levels,
nodes and mapped instances, while one optimistic F3 indicator regressed; this tradeoff correctly
blocks a commercial observation.

Round 2 added the second mined function through the cumulative Library lineage. It was not adopted;
its evaluation SHA-256 is `306c28050ea3715f969bb916a970ccc6ad1ba45cb2b1bbbdc2f4c9cc1f01b071`.
The final frontier retained round 1 and rejected round 2 before plateau/accounting. It stopped only
because there was no next residual question, and did **not** open the commercial-observation gate.
Final frontier SHA-256 is `b8f491c84af2d63850507fb128a12d4dd4c99c34675f5372eb6d4ab6126b0f21`.

This closes residual question → AI selection → new Boolean function → deterministic identity → F1/F2/F3
evaluation → cumulative lineage → frontier. It does not claim the new Cell improves commercial QoR.

## Earlier frontier infrastructure probe

The following earlier probe established mapping, scenario and frontier mechanics before the final
causal closure above. It is retained as engineering history and is not the FW-07 exit evidence.

The held-out input is a small pipelined three-input reconvergent function, structurally different
from AES. It is committed only as ordinary RTL and an SDC summary:

| Input | SHA-256 |
| --- | --- |
| `flow/domain/tests/fixtures/lfr-heldout/heldout_pipeline.sv` | `27f3852596f1283d92c9846b90b025802266cfe59011ebae2d4035e912ffc93e` |
| `flow/domain/tests/fixtures/lfr-heldout/heldout.sdc` | `ae1f38e0e348ce497b9b619eb6a38701030b87989eee431b3075fbfb6056dfaf` |

The real license-free run used the retained Yosys 0.69 / ABC 1.01 tool identities from FW-T2 and
the hash-bound foundry/47-Cell Libraries kept under ignored local evidence. No foundry or generated
Library bytes are committed here.

## Two Library rounds

Round 1 expressed one retained three-input custom function as ordinary RTL. Yosys/ABC changed the
mapping from seven instances to three, adopted
`XS_MAPPER_COMPATIBILITY_MAPPED_SINGLE_0005_Y` once, and reduced the maximum mapped logic level by
two. The augmented arm dominated the reference arm in all three local slew/load scenarios. The
worst-delay indicator changes (`augmented - reference`) were:

- optimistic: `-20.4947 ps`;
- nominal: `-153.6354 ps`;
- conservative: `-556.0529 ps`.

These are F3 indicators, not predicted route or Fmax benefit. The single round correctly retained
`portfolio-frontier-not-supplied` and could not become a commercial-observation candidate by
itself.

Round 2 appended one structurally unrelated four-input function to the cumulative Library. The
candidate was not adopted and every pairwise metric remained equal. This is a valid plateau
observation: Library growth occurred, but the design evaluation did not advance.

| Evidence | SHA-256 |
| --- | --- |
| Round 1 request | `8778580408a420197a17783ca6b2ebd8cd5f17b7da381a82078b44aeb683c44d` |
| Round 1 evaluation | `a2db8c851cc9beac6eceaa416f577853d5819bd3280dbcb8ae289315a14f8d10` |
| Round 2 request | `9409ebd9849e932d61404878a176441c9a09610a51c1ff0099ab4473b29d66cf` |
| Round 2 evaluation | `a618a8bd842d2a0b6e7e251a8d36b3e61d9129efda5bd3d51e9bea659e553d89` |

## Cross-round frontier and stopping

The verified frontier retained `heldout-r1`, rejected the non-adopted second round, and stopped for
both `pareto-frontier-plateau` and `no-new-residual-question`. Only after that cross-round decision
did the first round receive:

```text
worth one commercial QoR observation; never an expected-benefit claim
```

The one-round frontier, used before the second research turn, remained open and carried an explicit
next residual question. The final frontier result is hash-bound:

| Evidence | SHA-256 |
| --- | --- |
| Open frontier after round 1 | `efa9f55be2181bcb7b926298e5c78de90c020c32d57cd3fa98c475d7724ebad8` |
| Stopped frontier after round 2 | `5e9edb192cbfac30d55f589e5f7d2ae32bc46e694d2d546c998f16500cd155a2` |

## DeepSeek-V4.1-Flash residual task

The compact context contained only hash-bound F0/F2/F3 vectors, the verified open frontier,
cumulative Library state/cost, scope limits and this residual question:

> Find a structurally different function that advances an F1 or F2 metric without regressing F3
> indicators.

Context SHA-256 was
`1ff2fcc7d9811480690c5e808749f8ec60cce4536262d76de64d8074b5c68b85`; the retained pretty JSON
file SHA-256 was `003beffb8d34461f365ad882166618f5aee66f2530947fd329eb20c6fd38f350`.

The first API attempt used the model's default thinking mode and exhausted its 2,200 completion
token limit entirely in `reasoning_content`, producing no final JSON. It is retained as a failed
attempt, not a pass. After the executor security review, one non-thinking response was also rejected
because its code used `while` and `try/except`, outside the deterministic bounded subset. The final
request stated that subset explicitly. `deepseek-flash` returned four evidence-bound structural
research lenses and a pure `propose_candidates(residual, budget)` function. Deterministic validation
passed:

| Result | Value |
| --- | --- |
| Model returned | `deepseek-flash` |
| Prompt / completion / total tokens | `2794 / 1005 / 3799` |
| Research lenses | 4 |
| Candidate program SHA-256 | `86e5d0c696431beb73e15263c8c83f8b227b426ae71c493f318629ab940ab7b9` |
| Validated proposal file SHA-256 | `ad8f6b927fabeb488b895b23be0b19ee59ba5a3581d898e08c2d65bde5e9bf79` |
| Validation summary SHA-256 | `a19fe430a97fa953110b254d73ee955b9e4dc9fbe51f0290715b580b4e47c904` |

After validation, the candidate program ran through the bounded executor: isolated Python `-I -S`,
temporary working directory, minimal non-secret environment, five-second wall timeout, and available
CPU/file/core/file-descriptor limits. Linux also applies a 512 MiB address-space limit; macOS reports
that memory limit as unavailable instead of claiming it was enforced. A static bounded subset rejects
comprehensions, generators, exponentiation, dynamic sequence amplification, unbounded loops and
non-whitelisted calls on every platform. The final validator rechecked every proposal evidence hash
against the current compact context. The program then returned four identity-free research
proposals in 235.874 ms. Return code was 0, candidate-output SHA-256 was
`34809de0ad10e1539264254abe645f66ca3eb8d57633ff6fc1010c825187f361`, and the retained execution
record SHA-256 was `dcd6a68e07511eda87afcf7401b4a4954604ea8d7d088088a35ae0b6b0d002a0`.

The model and executed program did not assign final candidate identities, alter evidence or budget,
write Judge facts, launch commercial EDA, or claim commercial benefit. The API credential came from
the existing local secret file and was neither printed nor copied into evidence.

## Boundary

This closes the real-tool held-out, frontier, stopping and second-tier-model gates for FW-07. It
does not prove commercial QoR, generality beyond the tested structures, Pack integration or release.
FW-08 must still assess the complete standalone Framework and decide whether Phase 2 may begin.
