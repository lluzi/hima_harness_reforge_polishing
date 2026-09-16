# LFR-FW-05/06 multi-index and cumulative-Library evidence

Date: 2026-09-15

Commercial EDA jobs started: **0**

## Result

FW-05 and FW-06 are complete at the standalone deterministic layer.

FW-05 now evaluates candidate functions with separate evidence layers instead of a predicted QoR:

- local structural levels, nodes, edges, cut width, reconvergence and domination;
- globally qualified cone overlap and deterministic non-overlap lower bounds;
- whole-design mapper adoption from a hash-verified paired mapping result;
- proxy-STA frontier and slack-mass values explicitly labelled as open-source indicators;
- Library cost and generation work;
- deterministic Pareto selection over raw metrics, with no commercial-QoR claim.

Counterfactuals collapse the complete candidate cone, re-toposort and repropagate the full graph.
They do not copy one seed node's result or assume a zero-delay Cell. Path migration therefore names
the candidate transformation that caused it.

FW-06 now provides:

- stable function/interface/drive identity across rounds;
- immutable numbered shards with manifest and artifact hashes;
- re-verification of every retained shard before append;
- delta-only request and Job projection;
- shard-scoped candidate labels and globally unique function identity;
- monotonic evidence state and retained proxy-rejection reason;
- proof that round two leaves round-one bytes unchanged and creates no old-function Job.

## Production-seam evidence

The tests exercise the actual route-request producer, canonical portfolio adapter and selection
path. Two distinct functions with overlapping discovery cones both enter pre-mapping evaluation;
overlap is advisory and the one augmented mapper decides actual use. Post-mapping adoption cannot be
asserted by the caller: it comes from a result file whose bytes, schema, status, both-arm censuses,
request/tool/plan/netlist hashes and reference leakage are checked.

A sanitized identity/adoption projection of retained AES mapping evidence is stored at
`flow/domain/tests/fixtures/lfr-proxy-mapping-result.real-projection.json`. It contains no netlist or
Site path. Its SHA-256 is
`7f22712b792c97388dcc3c2b723c0f4acdf4826afea6230a851a2a68f315100e`.

## Verification

- FW-05 domain tests: 15/15 passed;
- LFR mapping/STA/round/cumulative local contracts: 13/13 passed;
- existing `custom-cell-fmax-pack` contract: 25/25 passed;
- TypeScript typecheck: passed after restoring locked development dependencies;
- Python compilation, source-identity audit and `git diff --check`: passed;
- Electron launches: 0; SSH attempts: 0 for the local suites.

## Limits and next frontier

The sanitized mapping fixture does not independently reproduce its upstream raw evidence. The real
Yosys/ABC run is retained separately under ignored `.hima-tmp` evidence and documented by FW-T2.
The single-round interface reports only a two-arm `pairwise_relation`. It cannot prove membership in
a cross-candidate, cross-round Pareto frontier and therefore blocks commercial validation with
`portfolio-frontier-not-supplied`.

LFR-FW-07 must connect these deterministic layers to the compact AI residual-research context,
maintain the portfolio frontier across rounds, and demonstrate one held-out real-tool replay plus a
second-tier-model research task.
