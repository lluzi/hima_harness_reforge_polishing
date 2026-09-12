# PLS-19 bounded Workshop feedback checker

This slice changes the opt-in Workshop checker and its private numeric Pack only. It does **not** change product execution, `endRun`, or the authoring pipeline's default `numericHome` behavior. Base: `40f5afa3fe792622f52eff21bad3e85809b32780`. The earlier live run is preserved separately at `../live-workshop-1`: its graph ended at Judge, so a valid PASS verdict did not establish an explicit Explore success decision. Its actual `ended-goal-not-met` must not be relabelled as Goal success.

## Scenario and acceptance

`live-numeric@2` uses the existing grammar: prepare → analyze → read-analysis → Judge → next-cutoff (Explore), with one declared `revisit: true` edge back to analyze. Judge lists the positive-sum constraint first and the minimum-sum Goal second. The chooser reads `numeric_sum` in `count`, binds its declared `fallbackCutoff` parameter to `0`, and recommends `next: { limit: fallbackCutoff }` after constraint PASS / Goal FAIL. Advice does not complete Explore: the owner must submit its own decision, rationale and current observation/verdict citations.

The Workshop-only input mode keeps twelve positive integers and guarantees at least one number below or equal to the first cutoff, while `39` stays above it. Goal is the full input sum and remains fixed. The checker requires this actual sequence:

1. Generation 1 reader measures the sum strictly above the initial cutoff; positive-sum PASS, minimum-sum FAIL.
2. During the first real 60-second Job, a source-user steer asks the same conversational owner to pause. Pause acceptance, Job still active, mechanical Job completion and no successor admission are checked separately.
3. After explicit continuation, the owner cites the first reading and both verdicts and chooses a valid lower cutoff. The continuation message does not prescribe the candidate value.
4. The declared revisit preserves prepare and reruns analyze in a new execution directory. The same owner reads inputs/knowledge and writes the actual executable. Both Jobs retain the declared 60-second wait.
5. Generation 2 reader measures the full sum; both rules PASS. A current-evidence, owner-authored `goal-met` decision must produce exactly `ended-goal-met`.

One Run, one owner, original Goal/method/budget, cumulative Job accounting, two distinct executable directories and no hidden model moment are checked. Maximum two generations; requested Run time box is nine minutes inside the existing hard ten-minute checker bound. Existing CLI bounds still cap messages and model request steps. Follow-up prompts wait for already admitted asynchronous work to settle; waiting does not complete a node or select a successor. The pipeline imports `numericHome(check)` without feedback mode and keeps its prior input distribution, minimum=1 and one-generation test scope.

## Validation boundary

The corrected L2 probe passed in 133.57 seconds (Node runner elapsed), with one Host, five actual local Jobs, zero model requests, and no skipped cases. Build, repository typecheck, probe typecheck, seam check and no-key CLI checks passed.

No real model, credential, SSH, EDA or Electron was used in this slice. No L4 PASS is claimed here. A later opt-in model run must independently pass the strengthened checker.

- `build.log`: fresh build from this worktree.
- `typecheck.log`: complete repository typecheck after the checker edit.
- `cli-help.log`: help exits 0 without credentials.
- `cli-no-key.log`: absent key exits 2 before preparing its requested output path or starting a Host/model.
- `verify-host.ts`: reproducible L2 protocol probe against the exact generated v2 Pack, actual Host, actual local Jobs, reader and Judge. It deliberately uses deterministic owner calls and a handwritten **test** executable; these are not model-generated code or real-model research evidence.
- `host-evidence.json` / `host.log`: actual L2 result, records, requests and costs. Model requests are forbidden by an explicit Host hook and the Node test runner with `HIMA_TEST_SILENT_AGENT=1`; the one root Agent receives no model turn. The probe uses the Host default time box and two-generation budget; the live checker separately verifies its explicit nine-minute admission.

Run the probe after a fresh build with Node 24 and no key:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH env -u DEEPSEEK_API_KEY \
  node --test docs/assessment/2026-09-12/pls-19/live-decision-harness/verify-host.ts
```

The probe retains its private home for inspection and terminates only its private tmux server. It verifies false Goal success and stale citation refusal as well as the valid feedback path. Its result is mechanism evidence only, not an inference of model reasoning quality, EDA quality, or full PLS-19/L5 acceptance.

Rollback: revert this slice's checker/evidence commit; no product source or persistent user home migration is involved.

The first protocol probe is preserved in `first-host-evidence.json` / `first-host.log`. It reached the complete feedback path but failed its own incorrect Job-count expectation (three; actual five includes two reader Jobs). Its standalone invocation also lacked Node test context, so silent notification mode did not apply: nine Agent request events were rejected by the hook before any provider call. The corrected probe uses `node --test`, expects all five Jobs and still requires zero request events. These were probe defects; no product behavior was changed to fix them.
