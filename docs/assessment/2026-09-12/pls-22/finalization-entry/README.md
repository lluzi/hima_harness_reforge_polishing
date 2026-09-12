# Finalization of the completed numeric Run

The model has now completed TEST repair and native release. The finalization run hit an order-sensitive comparison defect after its seal checks passed; [the separate read-only audit](../post-finalization-audit/README.md) confirms the actual released result and preserves that original failed evidence. The preparation-stage record below remains as recorded.

The new opt-in [finalizer](../../../../../scripts/live-check-pipeline-finalize.ts) performs only TEST formatting/check and native release. It does not create or execute any Run, change the method, or reset a budget. The source is [continuation 2](../live-continuation-2/evidence.json): the original author fixed the reader, passed nine direct reader cases, completed Run `run-cbfcba3e-fc8d-459e-b6a6-304de9764a81` as `ended-goal-met`, and wrote TEST.md before the driver timed out.

## Diagnosis

[Public native session events](native-tail.json), read from a private copy with zero model requests, show the TEST write's successful `tool/result` at seq 437, 21:45:28.986 UTC. Step 29 starts at seq 439, 21:45:28.999 and remains unfinished until cleanup at 21:51:43. There is no subsequent tool call/result, so the evidence does not show a pending tool permission. `whenIdle()` was waiting for an active step. The last recorded assistant attempt belongs to an earlier step 1 TRANSPORT error; that step recovered before the successful Run. No settled attempt is recorded for the final step. These durable events cannot distinguish request preparation from a pending adapter stream; they do not establish a specific provider or wait-helper bug.

Full copied-home startup first exposed a separate persisted-record defect: workspace record `#000001` has no `design`, while the installed schema requires a string. Native-only diagnosis therefore disabled Hima solely in the disposable copy. This was not a successful full-Host reload. The coordinator owns the product correction and explicit installed-runtime upgrade; no Ledger, Pack, Run or original evidence is edited by this entry.

The two TEST key lines contain inline explanations. The existing skill says “one line, exactly …, and beside it …”; moving that explanation to a following paragraph is the narrow correction. The parser stays strict. The model must read and edit the actual TEST file, preserve every factual/prose token, obtain the actual pack check and invoke `hima_pack_release` itself.

## Admission and boundaries

The finalizer links the original authoring evidence, the diagnosed first failed attempt, continuation 2 and the explicit runtime upgrade manifest by hash. It verifies current Pack/input hashes against continuation 2, loads the actual ledger on the installed runtime, and requires its Run/records to match the completed checkpoint. The numeric validation is extracted unchanged from the checkpoint script: independent strict-bound sum, actual input/output/code/reader hashes, original owner, ordered current Judge PASS verdicts, explicit current Explore goal-met decision/cites, original Goal and budget.

Only the two TEST key-line separators may move; every other report byte stays unchanged. The final text must have standalone exact `run:` and `status:` lines. Changes to factual/prose tokens are refused. Run creation/execution, method changes and handwritten VERSION files are refused. Native release must seal the exact existing Run/method/files. Final assertions require unchanged scientific records and exactly the TEST/VERSION file delta. The same original Agent receives all messages. Prior and new costs remain separate before aggregation; the first failed attempt had one request event and zero provider calls.

The overall cap is five minutes, four user turns and 30 `agent/request` events. This is a finalization budget; the completed Run retains its original eight-minute, one-generation, two-retry budget.

## Runtime manifest

`--runtime-manifest` names JSON with these fields:

```json
{
  "kind": "hima-installed-runtime-upgrade",
  "sourceSha": "<fixed runtime source commit>",
  "bundle": "<original installed bundle path>",
  "backupBundle": "<preserved full old bundle copy>",
  "oldHashes": { "<relative file>": "<sha256>" },
  "newHashes": { "<relative file>": "<sha256>" },
  "protectedRoots": ["<home>/hima", "<home>/sessions", "<home>/storages", "<home>/workspace", "<home>/numeric-flow"],
  "protectedBefore": { "<absolute file>": "<sha256>" },
  "protectedAfter": { "<absolute file>": "<sha256>" }
}
```

Bundle manifests use existing `digestTrees`, excluding each bundle's `node_modules`. The old copy must match both `oldHashes` and continuation 2's installed-build hashes. The new installation must match `newHashes`. All five protected roots are required; their before/after/current file maps must agree. The upgrade is acknowledged as a runtime change; the finalizer does not relabel the old installed proof as a new-runtime run.

## Commands and validation

First validate using a copied home, no key or model:

```sh
node scripts/live-check-pipeline-finalize.ts \
  --from docs/assessment/2026-09-12/pls-22/live-continuation-2/evidence.json \
  --runtime-manifest docs/assessment/2026-09-12/pls-22/runtime-upgrade/manifest.json \
  --out .hima-tmp/finalize-preflight-new --preflight-only
```

For the separately authorized live finalization, use the same inputs, a fresh evidence directory, and `--timeout-ms 300000 --max-turns 4 --max-steps 30`; the key is inherited, never a command argument.

- [Targeted checks](targeted-final.tap): 11/11 PASS in 11.878 seconds, seven Host boots, zero Electron/SSH/real provider calls. They include native actual-tool denial of Run/method/VERSION mutations, allowed TEST edit, factual-token protection, runtime-manifest tamper rejection and prior native resume/cleanup regressions.
- [Full typecheck](typecheck-final.log): PASS. The [first check](typecheck-first.log) identified the tools guard's `unknown` argument type; the guard now validates structured arguments explicitly.
- The [first actual-edit test](targeted-first.tap) correctly encountered native `FS_NOT_OBSERVED`; the test now reads TEST through the native read tool before editing it, as the live prompt already instructs. No file-policy bypass was added. Only trailing whitespace in that TAP artifact was normalized for Git; the original output remains in `.hima-tmp/finalize-targeted-first.tap`.
- The [upgraded-home preflight](upgraded-home-preflight/evidence.json) PASSed on a disposable copy using the actual installed runtime from source `9316146796e4714c07a54190dcbd40c7b036ee7d`. All actual Run/record, independent sum, input/output/code/reader, owner, Goal/budget, Judge/Explore and stage/tool-history checks passed, together with nine direct reader cases. One Host, zero model/provider requests and zero Run execution. The manifest's 61 protected files were rechecked unchanged afterwards.
- The final scope refinement also passed [three focused guard tests](guard-final.tap) in 3.049 seconds; edits outside the two key separators are rejected.
- Real model TEST repair and release remain for the coordinator's authorized finalization. No original Pack/session/method file was changed by this implementation or diagnosis.
