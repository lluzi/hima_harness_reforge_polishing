# PLS-23 / PLS-08 probe handoff

This handoff is limited to the authored probe and a bounded analysis input. Complete cell mining,
physical validation, customer knowledge archival and L5 remain separate tasks.

## Actual probe and release

- Native author: `aes-author-1/evidence.json`; 63 model request-step events, one model session,
  no Site Jobs. The driver assertion failure and compiled checkpoint audit remain explicit.
- Validated execution: `aes-execute-2/evidence.json`, source `1a3a723`, same V4 Flash conversation
  owns every node. Run `run-3ef44159-1b5a-4baf-ab5c-107b8104fd98` ends `ended-budget-exhausted`.
  Two synthesis and two reader Jobs, 308811 ms Run elapsed, 61 model request-step events. Request
  events are not exact billable API requests; adapter retries and token use are unmeasured.
- Generation 1: asked/measured period 0.35 ns, setup slack -0.000969827 ns, area 8667.161987 um2.
  Generation 2: period 0.341 ns, slack -0.00422013 ns, area 9142.181989 um2. Both setup verdicts FAIL;
  both period-only Goal verdicts PASS. There is **no measured closed Fmax** from these two trials.
- `packs/aes-tsmc28-dtco/TEST.md` and `VERSION.yml` are the native test/release bytes. Method digest:
  `84cefd82286358ce2930a81ae37f03bd9358432ee91844cd85f9c4b9a3e7bd7f`. The current Pack stage verifies
  as `released`; release does not turn the valid negative result into performance success.
- The earlier failed Run has its own retained record and private artifacts; none are rewritten.
  Across both real execution attempts: 3 DC synthesis Jobs and 3 reader Jobs total.
- `aes-desktop-final.tap.gz`: one targeted L3 pass, about 12 s, same real Run shown beside native chat
  with its two-generation budget ending and unsent draft preserved. Original Ledger SHA unchanged.
  Earlier validation-driver failures are retained: DOM-node serialization, a deferred model-setup
  modal, then comparing a human label to the raw status enum. None required product changes.

## Executable analysis route

`scripts/aes-probe-handoff.py` consumes a real observed manifest and its hash-matched timing/netlist
files. It verifies every selected timing instance/master/pin against the structurally parsed netlist,
then emits bounded motifs with report line, path and instance provenance. The independent exhaustive
oracle is a verification artifact; keep it outside a research model's input roots.

The checked input is privately retained at `.hima-tmp/pls-frontier/research-input/sample.json`:
24 actual reported paths, 64 motifs, at most 2 selected motifs, with no shared physical cell.
SHA-256: `5503504b644d3bc19f5e9aeb87fb5813a00c0730fef3c503d637298080856a1b`.
The source observation is generation 1 of the validated Run. Input data and complete netlists are
not silently redistributed as Pack method files. `analysis-oracle.json` records 2080 enumerated
combinations and an optimum score of 21 under this finite heuristic objective.

A raw-frequency baseline picks two motifs sharing one physical cell and claims score 16; that
selection is invalid. A conflict-aware weighted greedy baseline happens to reach 21 on this sample.
Thus the useful counterexample is **raw frequency ignoring physical overlap**, not an unsupported
claim that weighted greedy fails here. PLS-09 must record the baseline honestly, generate/run a
revised algorithm, and verify it independently. A motif is not yet a Boolean-equivalent, buildable
custom Cell or a PPA benefit.

Public CLI example (replace the manifest with the generation-1 manifest named by the observation):

```sh
python3 scripts/aes-probe-handoff.py \
  --evidence docs/validation/pls-frontier/aes-execute-2/evidence.json \
  --manifest <local-copy-of-observed-trial-manifest.json> \
  --flow <hash-verified-local-flow-copy> \
  --sample-out <model-input-root>/sample.json \
  --oracle-out <separate-verification-root>/expected.json
```

`aes-analysis-local.tap.gz`: 1/1 fixture test, no Host/window/SSH, 0.751 s. It checks the known optimum
for six fixture cells, actual point-to-instance/pin matching, changed bytes and a nonexistent object.
The parser source is copied into this repository with its original hash; it has no runtime import
or shared writable dependency on the old checkout.

## Production interface inventory

| Capability | Current authority / consumer | Evidence and boundary |
| --- | --- | --- |
| Step 4 import | PLS-20 fixed ca47fa0 integration | `docs/assessment/2026-09-12/pls-20/README.md`; historical source, independently verified integration |
| Agent node ownership | `fabric.ts`, `node-turns.ts`, `tools.ts` (`hima_run`, `hima_context`, `hima_execute`) | PLS-19 evidence plus this actual probe; no autonomous graph drive in the main path |
| Native authoring | `authoring.ts/openAuthoringSession`, installed five skills | PLS-22 evidence and this Pack's actual author/test/release |
| Method/version identity | `pack-folder.ts/snapshotPackFolder`, `packDigestOf`; `release.ts` | PLS-13 protections; this native VERSION seal and original test digest |
| Domain tools/readers | `packs/aes-tsmc28-dtco/{contract.yml,graph.yml,flow,tools,readers,knowledge}` | Real Site precision/area correction, local negative cases, typed observations; no hidden EDA logic added to Harness |
| Finite research handoff | `scripts/aes-probe-handoff.py`, `aes_probe_netlist.py` | Source-held dataset and independent oracle; AI research itself remains PLS-09 |
| Code/knowledge display | PLS-24 branch through `0fa0060` | Independently reviewed L2/L3, pending main integration at this document checkpoint |

PLS-20/22/19/13 previous evidence is cited at its own SHA and is not relabeled as newly rerun.
No closure of this handoff implies completion of PLS-09, PLS-25, graph growth, archival, reuse or L5.
