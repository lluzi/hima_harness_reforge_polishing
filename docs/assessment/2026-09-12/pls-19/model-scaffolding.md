# PLS-19: controlled execution guidance and retry-aware L4 checks

2026-09-12. Base: `59f15f3cfcd778d798055e8adbecc509501ddc40`; independent branch
`codex/pls19-model-scaffolding`. Product changes are descriptions in
`packages/harness/src/tools.ts` only. No execution semantics, skill, component or model was changed.

## Retained failure and root cause

The final [Workshop-2 evidence](live-workshop-2/evidence.json) is **failed**, not partial acceptance.
Its SHA-256 is `32dc5dff23f46160bde1b881c801f6639573df7ee5841f99fcc62af58e11e13c`.
It records 60 model request steps, 3 user messages, 1 Host, 1 native/model session and 0 Electron.
The model completed generation 1 with a valid positive measurement that missed the fixed full-sum
Goal, then explicitly selected cutoff 0 from actual feedback. Generation 2 did not finish.

| Recorded fact | UTC time / result |
| --- | --- |
| Run `run-a5cc7e1b-666c-48eb-9434-1e746138b33d` created | 19:36:28.307 |
| First analyze attempt wrote `research/analysis/analyze.sh` | 19:38:17.899 |
| First attempt could not find its declared entry | 19:38:31.180; node record `#000007`, `retrying` |
| Second attempt's real Workshop Job launched | 19:40:29.114 |
| First generation's Workshop Job finished | 19:41:31.948 |
| Explore `work` carried `next-strategy`; `complete` omitted it | 19:43:45.997 / 19:43:49.899; completion refused |
| Corrected Explore completion accepted | 19:44:05.753 |
| Generation 2 Workshop Job launched | 19:44:55.615 |
| Fixed 9-minute Run budget stopped that Job | 19:45:28.460; `ended-budget-exhausted` |
| Checker finished after its own deadline | 19:46:13.185; failed |

The first failed attempt launched no Workshop Job: its node reason was
`no recorded analyze.sh in workshop "analyze" for this execution`. The write base is the admitted
execution's private `workshop.directory`; prepending the Campaign-relative directory nested the
file beneath the wrong path. The tool schema described only a "Controlled node file path" and did
not explain the `recommend` scope or where an Explore decision is committed. The model's later
attempts to modify that failed version were correctly refused; its next admitted attempt retained
the original code history. All four actual Job launches and five act attempts remain counted.

## Changes

Tool descriptions now direct the owner to obtain the Workshop scope with `recommend`, use its
returned relative `entry` for the executable, and use the same private base for helper files.
They explain that Explore decision, strategy, rationale and citations are submitted together on
`complete`. Current context returned by `hima_run`/`hima_execute` supplies the next epoch/revision;
an extra `hima_context` call is for asynchronous updates or missing/stale facts.

The Workshop checker accepts an explicit `--timeout-ms 900000` for a fresh run, while its default
remains 600000 and the pipeline maximum remains 1200000. Its newly requested Run has a fixed
13-minute budget. These are **estimates**, based on the second Job starting 507 seconds into the
failed Run and still needing its 60-second work, reader, Judge, owner decision and evidence
collection. They are not measured passing durations. They do not extend the expired Run.

The oracle requires exactly one **completed** Workshop execution in each generation, while allowing
the declared two-attempt allowance and retaining failed attempts. Completed executions must match
actual Job identities and distinct private executable directories. Every code record, including a
failed attempt's code, must retain its actual hash and owner. Actual Job counts and elapsed time are
checked against retained meters and the fixed budget. Full-sum Goal, both Judge rules, current
citations, explicit decisions, pause/continue, immutable method and same-owner checks remain.

## Validation and limits

- L0: Node gate, seams, boundary, fresh independent build, typecheck and `git diff --check` passed.
- Existing Host/schema subset: `conversation-execution.host.test.ts`,
  `agent-workshop.host.test.ts`, `agent-graph.host.test.ts`: **12 passed, 0 failed, 0 skipped**,
  67.447 seconds; 1 subprocess Host, 11 in-process Hosts, 0 Electron and 0 SSH attempts.
- After wording review distinguished an Explore strategy decision from a Loop entry, the fresh
  build/typecheck and `conversation-execution.host.test.ts` were repeated: **3 passed, 0 failed,
  0 skipped**, 19.163 seconds; 1 subprocess Host, 2 in-process Hosts, 0 Electron and 0 SSH attempts.
- The [retained deterministic probe](model-scaffolding-oracle.mjs) evaluates the actual old/new
  checker expressions with explicitly synthetic execution/record inputs. The old expression rejects
  one permitted failed attempt followed by two completed generations. All 10 new probe cases pass:
  clean success and permitted retry accepted; missing generation, duplicate completion, exceeded
  retry allowance, missing entry code, altered historical hash, wrong historical owner, exceeded
  wall-time budget and orphan Workshop launch rejected.
- The same probe strips only `description` properties from the TypeScript AST and verifies the
  remaining `tools.ts` is identical to the base revision. Run from the repository root with
  `node docs/assessment/2026-09-12/pls-19/model-scaffolding-oracle.mjs` after dependency preparation.

No real model, Electron or full suite ran in this followup. The descriptions' effect on real-model
behavior and the revised budgets still require a new bounded L4. The retained failed Run cannot
resume productive work: its original wall-clock budget has expired, and context restoration does
not reset it. Rollback is the single change commit; no stored Run or historical evidence was edited.
