# HimaHarness 0.3.0-trial.16 build receipt

- Source commit: `766bbc94980977159ba5b3f2e0b236e99b2dd06a`
- Runtime fix: `67fa9ae8a9911bb4c43a48002d1eebffc9b947ce`
- Pack bundled: `custom-cell-fmax-dtco@5.2.10`, method digest `e60bbfb6e3466872ff24e590adb31aab62f4232b5eb9c9db71db9c75dddb629c`
- Signing: ad-hoc; not notarized

## User-visible correction

A Workshop program materialized from an earlier generation remains visible as editable context, but it can no longer be launched as the current generation's research result. The Campaign Agent must author the entry in the current generation. A revision explicitly approved in the current generation remains directly executable.

## Validation

- Exact red/green regression: an earlier-generation materialized entry was accepted before the fix and is refused after it, with no Job launch.
- Same-generation approved revision rerun remains supported.
- Related Host subset: 24/24 pass across Workshop generation freshness, revisions, Agent execution and two-generation research.
- Full build and TypeScript typecheck: pass.
- Packaging verification: App integrity, version-isolated home smoke and relocated Host smoke pass.
- Trial.24 remains immutable with verdict `LOOP_WORKS_TARGET_MISS`; its Pack 5.2.10 byte-limit fix passed across eight generations. The only completed matched commercial result was generation 7 at -2.93%; generation 8 ended on the 720-minute budget during host I/O contention.
