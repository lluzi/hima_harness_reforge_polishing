# PLS-19 conversation integration checkpoint

Baseline `4615bdd`; branch `codex/pls19-conversation`. This is the conversation surface checkpoint against the first Fabric admission implementation. It does not claim full PLS-19 completion.

The real calling tool Agent supplies Run ownership. `hima_run` prepares and returns context; `hima_context` reads reference/execution facts plus the existing Run view; `hima_execute` sends one versioned request to Fabric. Actor and origin cannot be supplied by the model. Legacy observation, cancellation, resume, judgment and direct Job commands refuse mutation of an Agent-owned Run where applicable.

Native start sends the selected session to the Host, which validates it against the live registry. The returned Run is selected and an explicit native conversation message is sent to that same session. Run selection does not change owner. Human pause/continue/cancel requests carry current epoch/revision; the accepted request is reported to the owning conversation. Native send preserves the composer draft. Failed delivery leaves a visible prepared Run/control fact and an error. Node execution identity and phase, owner and pause scopes are rendered from Ledger facts. The completion notification uses only an already-live owner Agent and is disabled when the plugin disposes. Node-test silence is accepted only when both `NODE_TEST_CONTEXT` exists and `HIMA_TEST_SILENT_AGENT=1`.

PLS-22 authoring tool/card and ordinary Coding remain available. `hima-test` now follows explicit context/begin/work/complete steps in its owning conversation.

## Verification

- Initial actual Host tool counterexample failed because Run owner was undefined: `prepare-red.log`.
- The first expanded test attempt passed the two tool cases; the HTTP case failed because the in-process helper does not compose the CLI web startup services. No production change was made for that fixture failure. The HTTP case was moved to the existing real subprocess launcher; retained failure in `first-green-attempt.log`.
- Latest build, complete static typecheck, seam and Pack boundary checks passed. `source-hashes.json` fixes the changed source identity.
- Three focused L2 cases pass: actual caller prepare with zero Jobs/sessions; foreign/forged actor refusal, duplicate begin, read without ownership change, legacy bypass refusal and ordinary Coding; native HTTP preparation rejecting absent/forged session and rejecting direct human node work. Each test has a private home. Two in-process Host boots and one subprocess Host; zero Electron and zero SSH attempts. Latest fixed-source run is in `local.log`.
- Catalog expectations were updated for the new context/execution tool cards. Their full older suites were not run here.
- Pause/work/complete/Job notification behavior is awaiting the root Fabric/Jobs implementation and its integrated L2/L3 run. No mock was added to make those behaviors pass. No real model, EDA, or pilot test ran. The UI and changed instructions have not yet received their L3/L4 acceptance.

## Rollback

Revert this checkpoint before integrating later conversation changes. It changes existing entry surfaces and the small agreed Fabric request/result and notification interface blocks; it adds no controller, graph engine or parallel state store. Existing baseline evidence and PLS-22 source remain in history.
