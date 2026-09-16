# LFR Pack integration evidence

Date: 2026-09-15

Scope: LFR-PACK-01 through LFR-PACK-06 complete; LFR-PACK-07 local and real open-source
integration evidence complete. This is not a Harness-authored test Run and does not satisfy the
release seal gate.

## What changed

The existing `custom-cell-fmax-dtco` Pack now wraps the assessed Phase 1 Framework. Its fixed graph
starts with a license-free Yosys/ABC baseline, mines six source-linked structural views, builds the
F0/F1 portfolio and residual context, runs one AI Workshop, materializes one delta, and evaluates the
delta through F0-F3 before the preserved commercial DC/Innovus tail. F4 remains an observed matched
commercial result. No stage estimates a portable commercial benefit or optimizes prediction error.

The cumulative Library is append-only. Every evaluated delta receives an immutable shard and state.
A rejected round becomes `proxy-rejected` with retained reasons; later research reads its history and
cannot silently submit the same function again. Only an admitted `proxy-mapped` round can advance
through freeze into the commercial tail.

## Real license-free pilot

The pilot used the held-out `heldout_new_function` RTL, the retained foundry Liberty, local Yosys
0.69 and ABC 1.01 identities from FW-02, and the production Pack stage/Reader code. It executed:

1. baseline paired mapping and proxy reg-to-reg timing;
2. all six miners from the baseline mapped graph;
3. function/local portfolio and hash-bound residual context;
4. a deterministic Workshop substitute through the production residual runner;
5. proposal-key binding and delta merge;
6. two-Cell materialization with synthetic fixture boundaries;
7. a paired real Yosys/ABC F0-F3 design-mapping/timing evaluation;
8. the production Reader and portfolio gate.

The Workshop substitute verifies the Pack seam; the separately retained FW-07 evidence remains the
real DeepSeek-V4.1-Flash model check for the same runner contract. The two generated Cell timing
models in this integration pilot were reused Phase 1 model fixtures, so the pilot makes no new
characterization or physical claim.

Key retained hashes under `.hima-tmp/lfr-pack-pilot-20260915-v2`:

- baseline stage record: `1a56ae2f05e389d3d486df4fbd9b04e7b6c05caac1905af5b0555ec30748d81d`;
- function/local stage record: `e6f3aa9f161efd8ec29f20dea8459aa7b6feaa28190dff4ce6429cfd65142335`;
- first residual request: `7855eb2b3f317815f508cf12a0149b4980bbea1fc66c8421c90189b96a50a65b`;
- residual output: `f865e88da14982daf7188e67334c0c500467d273b6f79fdf636e8256e973241d`;
- residual Reader output: `7c7ef2046a4e5043c1347bf6426679073c44c9bd2f5af4d09ba6838310f9eb52`;
- merged two-function delta: `5e9292de54269f3f39b09b592f0e90ec226fb21b49459b0372ec1c8cf58f45fe`;
- final paired evaluation: `53df5b081c891381ba17c5a96eed60c578d8daf7d15dd0fab098c1128c9c8b5b`;
- final Reader values: `69f4262ed07e277c39c3c794b8b348ce7c6805e20d373f1e8a3ed755d408d1e1`;
- rejected cumulative manifest: `13bd4961ee3880deedb5afaa5d46a9bac3239b93595d29d60989e6b468633db5`;
- retained round history: `83320249c377d6e3e8a5a926d51b16109d9d353ce76bb5036788bcb371e6a9cc`.

## Observed result and gate

The augmented open-source mapping adopted one of the two proposed Cells. F2 mapping indicators and
the nominal/conservative F3 scenarios improved, while the optimistic scenario regressed on
`F3.worst_delay_indicator_ps`. The aggregate relation was `tradeoff`. The current round remained on
the Pareto frontier, but `commercial_validation_candidate` was false with the explicit blocker
`f3-regression:optimistic:F3.worst_delay_indicator_ps`.

The Pack therefore retained both attempted functions as `proxy-rejected`, recorded the failure and a
new residual question, and did not run Library Compiler, Design Compiler or Innovus. This is the
intended use of commercial tools as final observations instead of trial engines.

## Verification

- Framework/domain Python: 56/56 pass.
- LFR round/calibration contracts: 4/4 pass.
- Custom Cell Pack contract: 26/26 pass after integration.
- Real local baseline, six miners, residual context/runner/Reader/merge and paired Yosys/ABC
  evaluation: pass.
- `loadPack`, `checkPack`, TypeScript build/typecheck, Python compile, published-copy comparisons and
  `git diff --check`: pass at the recorded checkpoint.
- Desktop: not run; no user-facing Desktop path changed in this slice.
- SSH: not used by this Pack integration pilot.
- Commercial LC/DC/Innovus: not run because the gate was false.

## Remaining release gates

LFR-PACK-07 still needs one Harness-owned test Campaign with a Ledger Run id and CodeRecord/refusal
records. LFR-PACK-08 then requires a candidate that passes the portfolio gate, one necessary matched
commercial observation, a valid `TEST.md`, and a Harness-generated `VERSION.yml`. The umbrella Issue
must remain open until those facts exist.
