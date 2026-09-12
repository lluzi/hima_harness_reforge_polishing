# Ordered chooser equivalence — pipeline-3 checkpoint

2026-09-12. Checker base 17c431ca9eb46a5a41de68b730a54a2fff5e341c. Only the checker predicate changes; product and skills are unchanged.

Pipeline-3 at source 572621663a3fa857dc58c5e1af88db45bfbbe74e stopped before creating a Run because the checker demanded `goal: FAIL` on the second clause. The actual model-authored chooser has first `{constraint: PASS, goal: PASS} -> goalMet`, followed by `{constraint: PASS} -> next limit=fallbackLimit`, with fallbackLimit bound to0. `original-failure.json` preserves the failed check and source identity; `model-authored-checkpoint/` is a byte-for-byte archival copy of the thirteen compiled author files, not a replacement method. All original file hashes were rechecked unchanged. The original private home, session and zero-Run checkpoint were not modified.

Actual semantics: `choose` takes the first matching clause. For a finite nonnegative numeric_sum in count and a finite bound minimum in the approved domain, the actual Judge yields constraint PASS and Goal either PASS or FAIL. Goal PASS is already consumed by the first clause. Consequently the remaining constraint-PASS clause selects exactly the same limit0 fallback whether its Goal FAIL condition is explicit or omitted. This is a scoped equivalence, not a claim about arbitrary partial evidence.

`probe.mjs` copies that authored checkpoint into one disposable real Host, writes synthetic numeric observations, applies its actual two rules through HimaJudge, and calls the real exported choose function. Six bound-domain points (zero bound, below/at/above minimum, below/at maximum bound) produce identical decisions for the two chooser forms. Independent expectations are goalMet on PASS and strategy limit0 on FAIL. Two deterministic counterexamples detect unsafe weakening: moving the broad fallback first hides Goal completion, and dropping Goal from the first success clause falsely claims an unmet Goal. An unknown reading is refused. With the Goal parameter missing, Judge gives UNDETERMINED and the chooser forms differ; that case lies outside the verified bound domain and the pipeline's final bound-Goal/current-PASS checks remain mandatory.

The fix permits only the equivalent omission on the second clause. The ordered first PASS/PASS goalMet clause, constraint-PASS fallback, bound0, and every current observation/verdict/decision/Goal-met/method/budget check remain unchanged.

Validation: the semantic probe passed twice, with the final body completing in 3.590s (cleanup follows); one private Host, zero Agents, zero Jobs, zero model/EDA/SSH work. `semantic-results.json` retains all eight input cases and both counterexample decisions. The first setup error (`probe-setup-first.log`) correctly refused a diagnostic Run without its method digest; the fixture was corrected to record the actual copied method digest, never to bypass that guard. The final checker typecheck and `git diff --check` pass. No full suite or live model was run.

Reproduce from the checkout with Node24:

```sh
node --import ./test/contract/support/no-ssh.mjs docs/assessment/2026-09-12/pls-22/chooser-equivalence/probe.mjs
```

The real authoring test/release remains pending. Since the preserved checkpoint has no Run, continuing it can create its first test Run with the original authorized budget; this correction neither creates nor resets one.
