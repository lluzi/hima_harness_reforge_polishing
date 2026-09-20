# Trial.15 residual-research Reader contract review

Trial.15 used HimaHarness 0.3.0-trial.14's App with Pack 5.2.0 installed via
"Install tested method upgrade", on one new persistent `aes_cipher_top`
Campaign (`custom-cell-fmax-dtco-20260920-022601-0f33`, Run
`run-2402a349-3720-4ae1-baf6-cbe895731b73`). Pack seal, digest, Site rebind to
the v5.2.0 active profile, and the `bind-inputs` preflight (`MAX_NEW_CELLS=50`,
`MAX_CELLS=400`, `aes_cipher_top`, `FOUNDRY_CDL`/`FOUNDRY_LIB` under the same
foundry family) all passed. Generation 1 completed baseline, all six free
miners (40 candidates each), `merge-join`, and `function-local-evaluation`
cleanly. The `research-candidates` Workshop itself succeeded on its third
attempt with a real typed proposal set (50 proposals, six evidence-hash-bound
lenses including `onsite-inspiration`, direct indexing throughout, no
`dict.get` on candidate or commercial fields) and correctly recorded
`feedback_ab.performed: false` for generation 1's lack of prior commercial
response.

The Run is deterministically blocked one node later, at
`read-research-selection`. Root cause: `flow/ai_research_runner.py`
unconditionally writes `feedback_ab` into the published research document
(required for Step 3's typed feedback A/B mechanism), but both packaged
copies of the Reader (`flow/read-stage.py` and `tools/read-stage.py`) validate
the document against an exact 14-key required-field set that omits
`feedback_ab`. Every document the Runner can produce therefore fails the
Reader with `ValueError: residual AI research document has unexpected fields
or status`, and `merge` can never run -- so `flow/mining/cell-demands.json`
never publishes, and none of Step 4's electrical-family/calibration checks or
Step 5's matched P&R pair are reachable for any 5.2.0 Campaign. This is a
release-blocking regression, not a research conclusion or transient failure;
it reproduces deterministically against the pristine pre-fix Reader run
outside the Campaign. No test in the Pack exercised this Runner/Reader
boundary.

The Run was paused by its owner session at `read-research-selection`
(`paused: ["*"]`, ~60.6 of 720 declared minutes spent) rather than continued,
because hot-patching the installed, digest-sealed method mid-Run would have
silently changed a released method's identity -- exactly what digest pinning
exists to prevent. Its truthful trial verdict is therefore `BLOCKED`.

The fix is minimal and already committed and pushed to
`agent/hima-trial-bugfix-v15` (`origin` up to date, `main` untouched at
`9f121c5`): commit `921151dba4b88986f390a1a7f5757339e984e14b`, "fix(pack):
accept feedback_ab in the residual research Reader" -- adds `feedback_ab` to
the required field set in both packaged Reader copies, plus a new regression
test `flow/domain/tests/test_residual_research_document_contract.py` that (a)
asserts the Reader's required set equals the writer's emitted set, (b) still
rejects a document missing `feedback_ab`, and (c) confirms a correct document
reaches the deeper checks. 3/3 pass with the fix; the same assertion fails
against the pre-fix Reader; `test_ai_residual_research_context`,
`test_lfr_pack_reader`, `test_pack_lfr_stage_adapter` and
`test_abstract_cell_v5` remain green.

Requested next step: cut a Pack release from
`agent/hima-trial-bugfix-v15` (or cherry-pick `921151d` onto `main`) as the
next tested method upgrade, so a trial.16 Campaign can resume past
`read-research-selection` into `merge` and validate Step 4's five-drive
electrical/calibration gate and Step 5's matched P&R pair, which trial.15
never reached.

Evidence is retained in
`.hima-tmp/ui-trial-0.3.0-trial.14/Agent Trial Report v15.md` and on the Site
at
`/data/eda/project/hima_harness/polishing-runs/custom-cell-fmax-dtco-20260920-022601-0f33`.
trial.13's and trial.14's Runs were not touched.
