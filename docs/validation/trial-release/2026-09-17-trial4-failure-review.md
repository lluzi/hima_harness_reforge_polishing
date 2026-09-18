# HimaHarness trial.4 failure review

Date: 2026-09-17

Run: `run-7be09524-96a7-4e38-8690-bdc1dbf127f5`

Pack: `custom-cell-fmax-dtco@5.0.1`

Verdict: the Campaign infrastructure reached the first creative Workshop, but no complete research
generation or commercial E0 comparison ran. This was an authoring-path failure, not a negative Fmax
result.

## What actually happened

The Run completed baseline evaluation and all six free mining/read routes. At
`research-candidates`, attempt 1 called `work` before an `entry.py` had been written and correctly
failed. Attempts 2–5 wrote real Campaign-owned Python but met a succession of hidden syntax-policy
rules in `ai_research_runner.py`: imports/helpers, variable arithmetic, non-`range` iteration and the
aggregate loop bound. Every failure became a Hard blocker because Campaign retry allowance was one,
so four ordinary code revisions required four human clearances. No commercial EDA Job was launched.

The trial report's Issue #42 diagnosis is not sufficient evidence for a Harness error in
`recommend`. Durable requests show that successful `recommend` calls used a newly begun Workshop
execution. The first durable failure was `begin -> work` without `recommend/write`. A rejected call
made with a prior or non-Workshop execution would truthfully report that that execution has no
Workshop capability. The useful product fix is to make the next Workshop action explicit in the
`begin` result and to keep authored-code failures in the coding loop; changing the capability check
from the issue text would treat the symptom.

## Root causes and existing-module fixes

| Finding | Existing owner | Fix |
| --- | --- | --- |
| Six independent, licence-free mining routes were serialized | Pack `graph.yml` | Existing Fabric fork/join: six branches after `read-evaluation-baseline`, one `merge-join` |
| Even a fork would be limited to one Job | `sites.ts` discovery capacity | Read existing `getconf`/`meminfo` facts; cap free parallel Jobs at five; licence seats still bound commercial EDA |
| Normal Workshop coding failures consumed mechanical retry allowance | `node-turns.ts` | For Agent-owned Workshops, a non-zero authored program records `retrying`, remains available and is bounded by existing research-write/attempt/time budgets |
| Candidate sandbox rules were difficult to author against | Pack runner/template/knowledge | Permit ordinary variable arithmetic, raise aggregate static loop allowance to 512, return rule-and-line diagnostics, and provide a valid editable skeleton |
| Trial App carried unrelated historical Packs | `scripts/package-trial.mjs` | Bundle only the current Reference Pack; installation remains explicit |
| Previous remote workspaces were searchable | Site workspace hygiene | Move old results outside the permitted next-Campaign root, preserving an archive manifest |

## Test-result isolation

No historical result was deleted. Generated local evidence was moved to:

`/Users/lluzi/Documents/HimaHarness Trial Archive/2026-09-17-pre-next-trial`

The 153 prior remote workspaces were atomically moved to:

`/data/eda/project/hima_harness/test-archives/pre-next-harness-trial-20260918T0254Z`

`/data/eda/project/hima_harness/polishing-runs` is empty for the next Campaign. The trial.4 release
folder retains its signed application and release archives, but its live `Trial Data`, `Trial
Workspace` and completed report were moved to the local archive and replaced by a blank report.

## Acceptance boundary for the next trial

The next run must show all six free mining branches available after the baseline and may have up to
five licence-free Jobs active. A Workshop program rejection must expose a specific diagnostic and
allow the Campaign Agent to open a revised attempt without human clearance. Human intervention
remains required for Site/Permit authority, an uncertain Job, a true Hard blocker or a business
decision. A successful infrastructure check requires at least one accepted research selection and
progress beyond `read-research-selection`; it does not require or imply positive commercial QoR.
