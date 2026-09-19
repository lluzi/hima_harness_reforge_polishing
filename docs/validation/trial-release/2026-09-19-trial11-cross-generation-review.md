# Trial.11 cross-generation review

Run: `run-05a770f3-ebbd-4c3e-8c13-8ceb7c571571`

Pack: `custom-cell-fmax-dtco@5.1.6`

## Confirmed progress

Generation 2 read the 2,309,732-byte generation-1 research document, formed
reader observation `#000434` and entered `merge`. The history-read repair and
the goal-miss revisit therefore worked in a real Campaign. The reader reported
`onsite_inspiration_selected_count = 1`.

Generation 2 later stopped at `design-mapping-timing-evaluation`. Four physical
Cell names were shared by the generation-1 and generation-2 deltas even though
their SPICE hashes and Liberty properties differed. Miner candidate ids are
round-local labels, but the generator derived physical names directly from
those labels. Concatenating the shards therefore created an ambiguous Library.

The maintenance fix assigns the next immutable shard namespace before any Cell
is materialized. For example, the same local label becomes `..._G0001` in the
first shard and `..._G0002` in the second. A same-shard label collision receives
the existing function-digest suffix. Manifest and assembled-Liberty checks still
reject any remaining physical-name collision before mapping.

## Did generation 2 autonomously innovate?

There was a material change in the explored design space:

| Observation | Generation 1 | Generation 2 |
| --- | ---: | ---: |
| Proposals | 40 | 40 |
| Proposal-key overlap | \- | 0 |
| Function-digest overlap | \- | 0 |
| Candidate-id overlap | \- | 4 |
| Multi-output proposals | 0 | 27 |
| `cluster_compose` | 2 | 10 |
| `boolean_synthesis` | 38 | 3 |
| Candidate-program bytes | 778 | 4,261 |

Generation 2 also introduced factor calculations for path-family coverage,
dominator coverage, non-overlapping support, level/node removal, repeat support,
cut width and reconvergence. Its program SHA differed from generation 1 and the
source similarity ratio was about 0.195.

That evidence does **not** yet establish a genuinely autonomous onsite strategy:

1. both programs still selected the first 40 entries from the hash-bound pool;
   generation 2 used its scores to label proposals, not to rank or choose them;
2. the generation-2 program did not consume the commercial response fields when
   selecting candidates; those facts appeared in the lens question only;
3. no candidate satisfied its `combined >= 3` onsite criterion, so the program
   relabelled the first proposal as `onsite-inspiration` merely to avoid a zero
   count; its rationale remained `structure-compaction`;
4. the large change toward multi-output candidates may therefore reflect the
   new deterministic candidate pool and current design state more than an AI
   decision learned from the prior E0 response.

The honest conclusion is: generation 2 performed new analysis over a genuinely
different candidate pool, but the evidence-backed feedback-to-selection step is
still superficial. A future Pack change should remove forced onsite relabelling
and require an onsite proposal to name the commercial-response factors that
changed its score, selection or exclusion. Zero onsite proposals must remain a
valid, explained result.

## Verification boundary

The naming fix is covered by a red/green stage-level reproduction and the full
Pack domain suite. It has not yet completed a real second-generation E0. The
next Campaign must prove that different shard namespaces survive generation,
layout, characterization and cumulative mapping, then observe whether a later
commercial response actually changes candidate selection.
