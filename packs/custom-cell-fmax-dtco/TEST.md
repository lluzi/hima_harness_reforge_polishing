## Site

Real Site `wave3-dtco-lfr-test` (site digest bd4a30df90af04e3b8804459af7219a6d1e920dd161ae50f760afdbfdbc96953, bound in the Run's control state). This was a real Site run of the current method: the license-free Yosys/ABC baseline actually ran (`/data/eda/project/fabulous/oss-cad-suite/bin/yosys -Q -T`, reference and augmented arms, exit 0) and all six miners and their readers ran on the retained mapped netlist and the Site foundry Liberty. It is a negative calibration test, not a PPA search: no commercial EDA was executed, no commercial licence seat was ever held, and no commercial QoR, Fmax or PPA claim is made.

Golden Flow this was checked against, by the pointer `INTENT.md` gives: `flow/library_richness.py` is the Framework entry and its hash-bound request/evaluation boundary; the mapping, graph, portfolio, cumulative-Library and proxy-STA implementations it composes are at `flow/domain/`; the Pack's own generation, physical-implementation, comparison and retained-evidence adapters are at `flow/stages.py`. Method digest 7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff and all method bytes were left unchanged by this test.

## Run

run: run-a148dd0c-2d2d-42b0-8c32-5179d40ad254

The Harness loaded custom-cell-fmax-dtco@5.2.16 as a marked test Campaign (purpose `test`, generation 1) and bound it to method digest 7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff. Goal: `target_period_ns` 0.5 ns ("clock period at most") and `target_fmax_improvement_pct` 5 percent ("matched post-route Fmax improvement at least"). Initial Strategy: `floorplanUtilization` 0.25 fraction, `periodNs` 0.5 ns, `algorithmRevision` 0 count. Budget: timeBoxMs 7200000, closingReserveMs 900000, attemptLimit 480, generationLimit 1, jobCap 1; licences Design-Compiler 1, Library-Compiler 1, Innovus 1 (none held at any point). The Run launched 27 Jobs in 27 attempts and recorded 1 research write attempt of 9227 bytes; its meters carry `endedBy: generation-limit`.

## Ending

status: ended-budget-exhausted

`SPEC.md`'s `Endings` section declares budget exhaustion for exactly this kind of stop ("Budget exhausted is reached when the time, round, new-Cell, infrastructure-attempt, Site-resource or commercial-observation budget prevents the next admitted action"), so this ending is declared and no disagreement is recorded here. After `calibration-research` applied the Pack's own chooser `research-calibration-miss` (`chooserOrigin: pack`, decision record run-a148dd0c-2d2d-42b0-8c32-5179d40ad254#000173), the Run's `generationLimit: 1` prevented the next admitted action — the declared revisit from `calibration-research` back to `evaluation-baseline` — so the Run ended honestly instead of opening a second generation. The strict one-Demand guard failed closed: the guard-case qualification was met by no physical drive, and the Campaign returned to Research rather than to the commercial tail.

## Generations

- generation 1: asked for floorplanUtilization 0.25 fraction, periodNs 0.5 ns, algorithmRevision 0 count; measured the license-free Yosys/ABC baseline (proxy_worst_reg2reg_delay_indicator 2.0221165056933086 ns, proxy_negative_slack_mass_indicator 217.58312625779882 ns) and six-route mining over 104 candidate-pool rows, then merge/generate/layout/characterize of the one authored Cell Demand materialized as five D1/D2/D4/D6/D8 drives (`generated.lib` sha256 10ff98b37d48656e06f8040b7e87132f7aef1e87360893b2f0fecac063eb1926); the Mock Liberty calibration came back `rejected` with `cell_demand_coverage_pct` 0.0, `cell_demand_met_count` 0, `cell_demand_unmet_count` 1 and `mock_liberty_calibration_accepted` 0; verdicts: PASS route-candidate-pool-known ×6 at the merge join, FAIL proxy-metric-vector-complete, FAIL mock-liberty-calibration-accepted, PASS cell-demand-feedback-available; decision next strategy with algorithmRevision 1 count; wall time 17.5 min.

## Code

- sha256 bbfb58812c637e1b71bc079fc5ecb180758e8c35e16ebc571d3a24767e74cfc7 — record run-a148dd0c-2d2d-42b0-8c32-5179d40ad254#000119; path research/ai-discovery/.executions/execution-871b372e-8c89-4319-9d60-d5d3028fc7b8/entry.py; node research-candidates; attempt 1; 9227 bytes; language python; retained at run-assets/.evidence/run-a148dd0c-2d2d-42b0-8c32-5179d40ad254/bbfb58812c637e1b71bc079fc5ecb180758e8c35e16ebc571d3a24767e74cfc7.dat

## Refusals

none

## Disagreements

- `SPEC.md` says that "Characterization passes only when at least one drive meets each Demand; otherwise the Campaign returns to Research before LC/STA/P&R." The flow recorded the `characterize` stage as `status: passed` (observation run-a148dd0c-2d2d-42b0-8c32-5179d40ad254#000168, path flow/records/characterize.json, sha256 8e9195c74395e70deac9daca09629c6b18c44fe4c5dbfb18a649bfcd177c2feb) while the same record's Mock Liberty calibration is `status: rejected` with `cell_demand_coverage_pct` 0.0. The stage status therefore reports stage completion, not Demand satisfaction; the "return to Research" the spec describes was taken at the declared `calibration-gate` FAIL edge into `calibration-research`, not at the characterize stage itself.
- Otherwise none: the Run recorded no blocker, no refusal, no cancel and no resume, and no tool, stage, reader or Judge failure — every execution settled with tool exit code 0, and the only negative outcomes are the measured typed ones above (FAIL proxy-metric-vector-complete, FAIL mock-liberty-calibration-accepted, calibration `rejected`, Demand coverage 0.0 percent).
