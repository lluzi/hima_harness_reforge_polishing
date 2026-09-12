# Released Pack: independent read-only audit

**PASS.** [The new audit evidence](evidence.json) validates the actual completed and released Pack without another model request or Run. [The original finalization evidence](../live-finalization-1/evidence.json) remains byte-for-byte unchanged and still reports its comparator failure.

The model had already repaired TEST, obtained the actual pack check, invoked native release and completed all five stage skills in the original conversation. The failed invariant compared `JSON.stringify` results. Cold Zod decoding changed property enumeration order while preserving every value. The complete Run/record structures are deeply equal and their serialized strings differ; the audit records both Run key orders. The checker now uses `isDeepStrictEqual` for the same Run/record invariant. No product parser or acceptance field was loosened.

The audit boots the actual upgraded installed runtime only on a private copy. It confirms the actual current Run and 22 records match continuation 2, then reuses the existing scientific checks: independently calculated 169, unchanged input/output/code/reader hashes, original owner/Goal/budget, current ordered Judge PASS and explicit Explore goal-met with cites. Public native session APIs confirm the original session's 104 tool calls, all five skills and persisted native release result.

The actual TEST has standalone exact `run:` and `status:` lines and changes only the two permitted separators. The native seal names Run `run-cbfcba3e-fc8d-459e-b6a6-304de9764a81`, method `51b975e734d107436fdd49d35335e886b2682b3334bc635cb09b8d16f9ef6e57`, and 14 files whose current hashes match. The stable tree reconstructed from runtime-upgrade `protectedAfter` plus `newHashes` changes only TEST.md and VERSION.yml. Input, workspace, other Pack files and installed runtime remain unchanged.

Native session logs/projection caches legitimately grew during the model's finalization. They are separated from the stable tree comparison. The scientific ledger file is checked independently: its bytes still hash to `4b259e4938dc1961eb0525c4cb1b3b7906f9b4482fbcca92800756b13b79c444`, exactly as before finalization. The entire original home's regular-file snapshot is unchanged across this audit. All earlier evidence and the runtime manifest retain their recorded hashes.

## Reproduction and validation

```sh
node scripts/audit-pipeline-finalization.ts \
  --from docs/assessment/2026-09-12/pls-22/live-finalization-1/evidence.json \
  --out .hima-tmp/post-finalization-audit-new
```

- [Regression RED](property-order-red.tap) then [GREEN](property-order-green.tap): reordered nested keys pass; changed budget, numeric observation or record order fail. Pure keyless check, no Host.
- [Full typecheck](typecheck.log), seam check, Pack boundary check and diff whitespace check passed. TAP artifact trailing whitespace is normalized; the original command outputs remain in `.hima-tmp/property-order-{red,green}.tap`.
- Actual audit: one copied Host, zero model/provider requests, zero Run executions and zero edits to the original home. No additional direct reader/Workshop execution was needed: current reader bytes match the already verified nine-case reader proof and actual Run observation.
- Costs remain linked to the four original live-check invocations: 72 `agent/request` events and ten user turns, with provider/API requests otherwise unmeasured. This audit adds one Host, yielding five in that linked chain; development tests and other earlier keyless preflights are outside that aggregate.

The original failed JSON is not relabelled PASS. This separate audit closes the missing structural comparison and remaining immutable-tree checks over the already completed model-produced release.
