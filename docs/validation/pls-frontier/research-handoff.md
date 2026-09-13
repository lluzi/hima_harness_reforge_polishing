# PLS-09: actual AES motif research

The companion business Pack `packs/aes-timing-research` consumes the formally validated AES probe
handoff. It is an ordinary Pack on existing Host/Workshop interfaces, with a research Goal distinct
from Fmax; PLS-25 will incorporate research into the full AES flow. No Harness component was added.
The engineering-authored method is not presented as V4-generated methodology.

## Executed result

V4 Flash Run `run-a01dfd81-1ca6-45d1-9f0e-8f47a554a961` used the same native conversation owner for
all nodes, with fixed Goal `minimum_score=21`. It took 210236 ms and five local Python Jobs, with
no EDA or SSH. Two code versions are bound to the actual launch intents and retained in
`aes-research-closure/generation-1.py` and `generation-2.py`.

- Generation 1 executed the exact staged raw-frequency reference. It claimed score 16 but reused
  one physical cell; its constraint FAIL is an invalid selection, not a usable score improvement.
  Copying that reference is not credited as AI innovation.
- Generation 2 was written by V4 Flash from the actual sample and feedback. It uses disjoint set
  selection, deterministic greedy starts/local exchanges, and bounded branch-and-bound. The actual
  reader derives score 21, zero conflicts; both required verdicts PASS and the owner explicitly ends
  Goal met. The program contains no baked sample ids or scores.
- `aes-research-closure/holdout.json`: the unchanged executed program ran over a 63-candidate subset
  withholding an originally selected object. Its independently read score again equals the exhaustive
  oracle (21), with zero conflict. Original input/result/code bytes stayed unchanged. This involved
  one local program and one reader invocation, zero model/EDA requests.

This proves a bounded data-dependent algorithm over actual source-held timing motifs. It does not
prove Boolean-equivalent Cell buildability, universal optimization, Fmax improvement, or full DTCO.
The generated program has a search-node cap; optimality is established only for the independently
checked original and held-out cases.

## Honest provenance and retained failures

`aes-research-live-1/evidence.json` failed before creating any Run because an extra SPEC heading
prevented `compiled`. The local entry now checks Pack stage before spending a model request, and
L2 starts an actual test-purpose Run. No fake TEST record was created.

`aes-research-live-2/evidence.json` retains its original **failed** driver result. All recorded
scientific checks passed, but an extra driver assertion required a Ledger knowledge-read row.
The model instead used the native ordinary file reader before writing code. PLS-09 requires actual
provenance, not that particular logging route. `finalize-aes-research.ts` reopened the original native
session and matched its full successful knowledge read to the unchanged Pack file before code
creation. It explicitly reports **session-level read, no node-level knowledge row**. Nothing was
backfilled or relabeled as a node citation.

`aes-research-closure/evidence.json` is a separate independent closure: it rechecks the fresh Host,
unchanged Run/Goal/records, actual code launch hashes, input bytes, copied reference, and native TEST.
It then invokes the native release verb through the restored owner handle, with no model turn or
new research Job. The original failed evidence bytes remain unchanged.

The source run used 71 model request-step events; the earlier no-Run attempt used 21. These are not
exact billable API requests, and token use/adapter retries remain unmeasured. The closure used one
Host and zero model/research/EDA requests. Raw library/netlists and the standalone customer sample stay out of the distributed Pack method.
The retained validation session contains the finite sample text actually inspected by the model;
it is evidence, not a claim that all customer data was excluded from validation transcripts.

## Implementation and testing

The Pack declares controlled `sample` and `baselineCode` inputs and workspace-root `selection.json`.
Reader scores come from the input, not model fields. Duplicate JSON keys/ids, unknown or excessive
selections, sample hash changes, malformed input, wrong indexed path slices and false provenance are
refused before they become observations. Distinct physical cells may share the same master.

`research-provenance-red.tap.gz`, `research-provenance-green.tap.gz` and
`research-test-run-local.tap.gz` retain the strict-indexing/repeated-master regression and final
8/8 local result (one Host, no Electron/SSH, 6.450 s). Existing PLS-19 owned Workshop, refusal,
failed-tool, cancellation/recovery and replay coverage stays at its established seams; it is not
relabelled as new research or duplicated into a second execution engine. Full local regression runs
once at the end of this implementation batch.

Independent review found invalid master uniqueness/provenance assumptions and insufficient baseline
identity proof. Real-sample preflight and explicit launch-hash comparison now cover those findings.
The native release is method digest
`3a03125aefe61f4b33041f145dfa4fffdadce6e34ff6ccd349ec929d284b5503`.
