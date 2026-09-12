# Native resume selection and cleanup correction

The first continuation was a driver failure: [outer result](../../live-continuation-1/outer-result.json) records exit 1 after 4.894 seconds, one `agent/request` event, **zero provider requests**, zero new tools and zero Runs. The original method files and original `evidence.json` remain unchanged. That JSON still says `in-progress` because cleanup crashed before final publication; the separate outer result states the actual failure.

## Cause and smallest correction

[The original session's public snapshot](original-native-ending.json), read from a private copy without starting a turn, records turn 6 ending at seq 234 with `has no provider/model`. The live resumed Agent had `{}` options. In the locked `@deepseek-ai/dsh-agent-loop@0.1.5-alpha.1`, `resumeWith` passes `options.agentOptions ?? {}` into `setupAndPublish`; it does not restore the live model selection from durable history. The request path rejects missing provider/model immediately after the `agent/request` waterfall and before `llm.prepareCall`/request context/provider invocation. The failed turn contains no request context, assistant attempt, assistant message or tool result.

`whenIdle()` correctly returned after that failed turn settled; `kick()` contains the error and records the native ending. There was no evidence for adding a wait. The driver now validates the original author options in parent evidence and supplies that exact provider/model to native resume. The original values are `deepseek-official` / `deepseek-v4-flash`. `LiveCheck.say` reads the public durable turn ending so a native error is reported directly before method assertions run.

Cleanup had an independent ordering defect: the script disposed the resumed handle in its own `finally`, then `LiveCheck.finish` attempted to cancel an Agent whose inbox projection had already been removed. The owning Host now retains that handle until after cancellation/snapshot. `stopAgents` also checks the native registry and never cancels an already disposed entry; an unexpected cleanup error is recorded without preventing final snapshot and secret scanning.

## Deterministic regression and preserved failures

The minimized native repro creates a real conversation under deterministic replay, persists it, disposes the Host, boots a new Host, resumes the same id and asks it to use the actual `write` tool. Before the fix, [all three lifecycle assertions failed](regression-red.tap): no tool output after resume, a native turn error was silently treated as return, and cleanup crashed on the disposed projection.

[The final targeted command](regression-green.tap) passed **8/8 tests in 12.458 seconds**, with six real Host boots, zero Electron launches, zero SSH attempts and zero real provider calls:

```sh
pnpm run test:local --files \
  test/contract/checkpoint-resume.host.test.ts \
  test/contract/pipeline-checkpoint.test.ts
```

The successful lifecycle test observes the real tool-written file before `say` returns, then runs normal `LiveCheck.finish` and verifies a passed final snapshot and clean scan. The failure test checks the native error directly. The disposed-handle test verifies final failed status and scans a synthetic non-secret sentinel in the retained home outside the new temporary directory; the sentinel is redacted. No real credential is used by these tests.

The first expanded test incorrectly accessed the registry through an already disposed Host after cleanup itself passed; [that failure is preserved](expanded-regression-first.tap). Its corrected assertion checks the public service is gone. The [first typecheck](typecheck-first.log) found a branded `SessionSeq`/`SessionLogOffset` mismatch in the provenance inspection; using the already-read immutable event snapshot removed the invalid conversion. [Final full typecheck passed](typecheck.log).

Two minimal replay reproductions, four three-case lifecycle runs and three read-only copied-home inspections were used during diagnosis: 31 Host boots total (28 replay Hosts plus three copied-home inspections), zero real provider requests. No full suite, desktop, EDA, actual Pack correction or new Run was performed.

## Retry admission

[Final copied-home preflight](retry-preflight.json) verifies the original model selection is explicitly restored, original files are unchanged, the ledger has no Runs, and the exact failed native turn matches [the immutable prior evidence](../../live-continuation-1/evidence.json), SHA-256 `85e52e9aa0c218f9b095f9efe2421fb68a4fb67b1b68eb737a48055d5bde360a`.

A retry requires `--prior-attempt` alongside `--parent`. The driver acknowledges the additional failed native turn separately from the still-identical original skill/tool history. It accepts only this diagnosed pre-provider failure: one extra turn, no new tools/Run, unchanged authored/protected files and the exact missing-model ending. Parent, failed attempt and new continuation costs remain separate before aggregation; `modelRequestSteps` is the legacy field for `agent/request` events and does not by itself count provider calls.

The actual reader defect remains to be corrected by the original model during the separately authorized live continuation. The method mutation/Run/release gates and 12-minute / 12-turn / 100-event limits are unchanged.
