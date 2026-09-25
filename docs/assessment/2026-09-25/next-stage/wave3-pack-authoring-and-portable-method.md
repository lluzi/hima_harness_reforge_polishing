# Wave 3 — independent Pack authoring and portable DTCO seal

Date: 2026-09-25. Terminal dispositions: **#60 PASS**, **#38 PASS**,
**#40 TERMINAL_NEGATIVE**.

## Lane A — #60 independent Pack authoring: PASS

A second native author received a hash-bound Guide handoff of a new Library SOP, qualification
requirements and report requirements. The source package is not the manually assembled Wave 2
`library-intelligence` directory. The author independently invoked grill, spec, fabric, test and
release and produced `library-authoring-qualification@1`.

Fixed terminal identities:

- method digest `9eb6e342080f3244fef842844afe640e277c96b50d910524e443fd09278bc6ee`;
- TEST Run `run-15366ac9-b5d3-419a-bef4-6d22c99c0401`, purpose `test`, status
  `ended-goal-met`;
- two local Jobs launched and two finished with exit 0; 22 Run records;
- TEST SHA-256 `d5a22f915b1f36510435dd52b0620c5dcf5bac99cfdf0621479c04a744a3448c`;
- native VERSION seal SHA-256
  `b03b037749abce6ff685c7d1cedf6781bca377f318937643a06fccdf872e495a`.

The method has one bounded input strategy, a real Workshop, a Reader, ordered constraint/Goal
rules and an explicit PASS/PASS `goalMet` Explore decision. The author-generated Reader returns a
typed unknown on malformed input rather than a successful zero. Exact install and idempotent
upgrade passed; a stale reviewed transfer was refused before destination creation; a forced
interrupted upgrade rolled back to the original digest while preserving the customer asset bytes.

The raw attempt-10 live runner retains a post-release false-negative: it searched all contract prose
for the word `QuaLib`, including the correct statement that QuaLib was out of scope. The retained
sealed Pack and terminal Run were re-read without a model; the execution-facing scope and remaining
transfer/recovery gates passed in
[verification.json](wave3-authoring-attempt10/verification.json). The raw evidence was not rewritten.

Attempts 1-9 remain retained. None is counted as PASS:

1. missing isolated packs directory before any model request;
2. unresolved second-round grill decision, correctly refused before Pack files;
3. operator duplicate-launch mistake, stopped at specified;
4. PID-audit/operator mistake, stopped before Pack files;
5. real confirmed-test admission defect, before any Run;
6. infrastructure deadline during fabric;
7. non-terminal TEST correctly refused by release;
8. acceptance-script cross-file assertion false-negative;
9. incomplete Strategy contract correctly refused by Pack check.

Attempt 10 is terminal. Its raw runner retains a separate post-release scope-check false-negative;
the zero-model verification re-used the exact sealed Pack and Run rather than starting attempt 11.
The admission repair now permits an exact confirmed proposal to create a test-purpose Run only for
an unreleased Pack; direct Fabric, `hima_run` and HTTP tests keep released product Packs refused.

Across the authoring attempts, the product used 413 model request steps. Provider API requests,
tokens and spend were unavailable and are unmeasured. The terminal attempt used two native model
sessions and 95 request steps. It launched no QuaLib, `edarun`, commercial EDA or production
Library analysis. This proves authoring/release behavior, not a new #49 E1-E4 qualification.

## Lane B — #38 portable DTCO method: PASS

`custom-cell-fmax-dtco@5.2.16` is sealed at method digest
`7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff`.
Its Site-bound contract admits two design bindings and contains no AES top, fixed process path or
customer Golden Flow invariant. Current tests carry source → proposal/algorithm → Cell Demand →
generated physical Cell → synthesis adoption → routed final database/report traceability.

The current real-model runner identity matches the retained two-turn DeepSeek feedback A/B. That
A/B demonstrates executable algorithm variation only; it is explicitly non-causal and makes no PPA
claim. Current native test Run `run-a148dd0c-2d2d-42b0-8c32-5179d40ad254` executed the real
Yosys/ABC baseline, six miners/readers, a real DeepSeek Workshop, generation/layout/characterize and
typed calibration feedback. All 27 Jobs exited 0. Its deliberately strict one-Demand guard produced
calibration FAIL plus feedback PASS and ended by the declared generation limit before any commercial
tail. Native `TEST.md` and `VERSION.yml` bind that exact Run and digest.

Full evidence and claim limits are in
[wave3-dtco-lfr-method-assessment.md](wave3-dtco-lfr-method-assessment.md).

## Lane B — #40 LFR assessment: TERMINAL_NEGATIVE

The bounded residual-frontier assessment retained the two relevant valid commercial observations:
V5 matched Fmax changed 0.000%, and trial.24 generation 7 changed -2.93% with 374 adopted synthesis
instances. Endpoint, Cell-delay, Cell Demand and cross-generation program differences do not
support another bounded portfolio strongly enough to justify extending #40. Candidate count,
smaller fully covered Demand sets and changed program prose are not treated as progress.

The Framework integration, current real-model seam, current real Site test and release seal are
complete, but no positive method result or 5% claim is established. #40 therefore closes
TERMINAL_NEGATIVE. Future method research needs a new Issue, budget and success criterion. #39 owns
the separate held-out matched value attempt and may still finish positive or negative without
rewriting this study result.

## Verification and delivery

- Build and typecheck passed.
- Lane A focused Host/release suite: 37/37 passed; zero Electron and zero SSH attempts.
- Lane B focused Pack/feedback suite: 29/29 passed; the Pack subset passed 26/26 after runtime
  assets were archived out of the source folder.
- Seam check, Pack boundary check and `git diff --check` passed.
- Lane B commit `c19f1c18be6f897ec7c1a35f689d76040ff354ed` is synchronized to
  `origin/main`. The final integration identity is recorded in the GitHub closure comments after
  synchronization.
- Lane A's retained live Home/Pack remains under the exact `/private/tmp/...` path named by its raw
  evidence. Its mechanical-finalizer copies and Lane B runtime archives remain under `.hima-tmp`.
  User-owned `tmp/` was not touched.

Rollback is by reverting the two Wave 3 delivery commits. That removes the new admission rule,
acceptance fixtures/scripts, current DTCO TEST/seal and status receipts. It does not delete retained
Runs, failed attempts, remote Site workspaces, archived runtime assets or user-owned `tmp/`.
