# Installed authoring L4 timeout diagnosis

Source: `40f5afa3fe792622f52eff21bad3e85809b32780`; original [failed attempt](live-authoring-1/evidence.json). Read-only independent diagnosis; no additional model requests or product edits.

| Phase (user-message/checkpoint boundaries) | Seconds |
| --- | ---: |
| Host/session preparation | 2.667 |
| Grill, answers and confirmation | 159.955 |
| Spec | 79.827 |
| Fabric first turn | 228.002 |
| Script approval and compiled record | 57.920 |
| Test until deadline | 66.658 |
| Cleanup | 1.437 |

The test stage began 528.371 seconds after start; overall recorded elapsed596.466s and outer process598.067s. 34 model request steps and7 user messages were below160/24 limits. Nineteen file reads succeeded; model-visible read output95174 characters, authored file writes44625 characters, assistant prose18618 characters. These are character counts, not tokens or billable requests.

The installed skills required the anatomy, six knowledge files and reference Pack. Retained skill/anatomy bytes matched this checkout. The first Pack check returned fit with no faults; it awaited the author approval/FABRIC record. One root glob returned100 paths/truncated10816 characters, and extra chooser/reader lookups cost time, but there was no source-code read or missing-schema repair loop. No evidence justifies a product/skill change solely to meet the original10-minute checker bound.

The sole test Run was created19:17:03.920Z, context returned19:17:18.133Z, and its last accepted tool began prepare at19:17:24.308Z. At timeout it had no Job/code/measurement/Judge/TEST/release. These missing stages remain unverified by this attempt.

Its fixed five-minute Run budget expired19:22:03.920Z. Downtime does not extend that budget, so resuming the same native session cannot complete the original test. Altering that stored budget would invalidate the check. Adding checker checkpoint/resumption would require restoring home, guards, counters, session and lifecycle and still would not repair the expired Run.

Smallest next check: a fresh home and fresh evidence, pipeline-only total maximum20minutes, test Run8minutes; keep single owner, single Run, immutable method, real script/Job/reader/Judge, independent sum/hash, release and160steps/24turns assertions. The expanded budget is an estimate based on observed authoring cost plus remaining execution/release, not a promise or passed result. Workshop checker retains its10-minute maximum. No EDA/SSH is required.
