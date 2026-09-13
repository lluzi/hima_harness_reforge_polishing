# PLS-14 L4 live archive evidence

Status: passed on 2026-09-13. This bounded probe used one actual existing Site artifact. It did not
run a model, EDA wrapper or Job, and did not write to the Site.

The actual owned Run was `run-29d86f2a-950c-48aa-aa7d-1faadece4704` on the isolated installed Site
name `pls14-linglong-archive`. Preparation intentionally selected a workspace root outside the
actual Permit’s write root, so the real Fabric returned `unprepared` and then the same Fabric
cancelled the Run. The no-workspace ending still published Pack-local assets.

| Fact | Value |
| --- | --- |
| Source | `/data/eda/project/hima_harness/polishing-runs/dtco-phases-1789296501383130000/flow/artifacts/compare/run-895f86e48c2b46ed88a12b432028844f/comparison.json` |
| Source inventory | `docs/validation/pls-frontier/pls25-physical-site/index.json` |
| Source / local archive SHA-256 | `2f056da01b925908c1fab767e89a5af8c367acef339a77750ccb563e284bee4b` |
| Bytes | 500 |
| Archive manifest SHA-256 | `8cb008e7364506c92ed7ae3246b18fafc57fce00eee088493c6d62d77a0a0dcc` |
| Run start / observation / cancellation | 207 ms / 136 ms / 277 ms |
| Final archive read | 8 ms; Hima Channel command count remained 9 → 9 |

The complete script is [live-check-pls14-site-archive.ts](../../../../scripts/live-check-pls14-site-archive.ts).
It records the exact Hima Channel argv and wire representation in its generated `evidence.json`.
The final command, its exit status and wall time are retained in [final-command.log](final-command.log).
The source is read once to observe and once during archival integrity verification; the final
archive read is local and does not contact SSH.

Limits: this evidence proves a raw-file copy and local retrieval for this one Site path. It does not
prove that an act node reached the output (the Run intentionally has no workspace), Site-wide
readiness, a research conclusion, Fmax change or a complete Campaign.
