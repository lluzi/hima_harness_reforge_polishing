# Issue 52 — trial.33 bounded GUI acceptance

This is an explicitly user-authorized successor trial, cycle `hima-issue52-final-3`.
Read this manual and activate `/himaharness-human-like-tester` in the existing tester
session. Claude alone operates HimaHarness through Computer Use on Catsights.

## Fixed identities and first gate

- App source/main: `b2759b0a3a7cc6ba889fa81f523b274fc5a0fbf7`.
- Kit: `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/issue52-app-trial33`.
- App: `HimaHarness.app`, version `0.3.0-trial.33`.
- App artifact digest: `1d264f164b8b14381d18d81db50422ecd14c600a17809cd4a03ccadb79e71609`.
- Manifest SHA-256: `64e22e3242f50c9f802bd091bb7e8574340d79844a3d5f342b0a44ca625042f9`.
- Pack: `xtop-timing-closure@1.0.16`.
- Method digest: `5cab1ddba6d2b6d35f27e2c5a1ddc05a8cd1b8758d1330c9c6c569dfd0cd78b1`.
- Native TEST: `run-2306b485-ccae-4cca-9b56-4ba2c618ac88` (reference only, never resume).
- TEST SHA: `63c0755313f77d623615fb9d15b7823401807026c9daf1b629efbfab9b71f901`.
- VERSION SHA: `02327a2f68f8587a870d1c7a24de043978c86dedfcf995902408db9bb3ecd33b`.
- Pack release: https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/xtop-timing-closure-v1.0.16
- Home: `<kit>/Trial Data/dsh`; workspace: `<kit>/Trial Workspace`.
- Home config SHA: `44f94aac4ccfceebf30425f1a484dc1716b315b4cbccb01601490233a57737b7`.
- Site: `linglong-swerv28`, installed Site SHA `03ba5dde4d92279e0f89632ca0c0f0e8b255a07f4211f0fd6f19a0d369f105b8`.
- Permit SHA: `895a6cd8ac679a3cd4ebe1e45085a69c14dd83f20ff44b4053bb74e9801fd165`.
- Binding id: `linglong-swerv28:xtop-operator-v5:5cab1ddba6d2b6d3`.
- Bundled binding: `<App>/Contents/Resources/app/operator-qualification/interactive-bindings.json`.
- Binding SHA: `77c6022957c03a777de0481bbe9dc06c753be258b26e204ba23d3009a2977dfa`.
- Administrator environment SHA: `32bef2cc363de6bebacf41c4d26f6243d8cb1a8870f58b1e96509bec3a351ae8`.
- Full Phase A receipt: `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/issue52-phase-a-v5/app-preflight.json` (PASS).
- Report: `/Users/lluzi/code/hima_harness_agent_issue52_acceptance/Issue 52 Trial 33 GUI Acceptance Report.md`.
- Tester worktree/branch: `/Users/lluzi/code/hima_harness_agent_issue52_acceptance`, `agent/hima-issue52-acceptance`.

Before GUI/model/EDA spend, verify the receipt, manifest, installed identities and skill
checkpoint. Ordinary local file reads/hashes and writing the report/checkpoint are allowed.
Do not build or substitute a Pack/App from the tester checkout. If identities differ, stop.
Launch only `<kit>/launch-hima-trial.command` through Computer Use, from the normal user
Terminal shell (the approved DeepSeek environment is already configured). Do not launch
the old trial.32 App. An existing old window may remain parked; never operate its Run.

## One journey and limits

Use Sonnet 5 / Medium for the tester; the Hima business agents use their qualified
DeepSeek Flash baseline. One Campaign, one persistent Run, one generation, at most one
Job at a time, one licence per named tool; 180-minute wall budget with 30-minute reserve.
Stop on the first deterministic defect. Never clear a hold to blindly retry or create a
second Operator for an execution. No second Campaign or generation is authorized.

1. Ask Guide to explain actual inventory, Pack/Site, inputs, Goal and next action.
2. Complete Preparation without creating a Run; confirm once to create one Campaign,
   persistent Run and owner distinct from Guide. Fixed Goal: setup/hold WNS targets 0.
3. Inspect Live Run graph, two node details and current evidence. At a no-Job boundary,
   perform one visible pause/continue and verify the authoritative receipt.
4. Tell the owner the acceptance boundary before execution: baseline only to produce
   current evidence and plan; one adopted high-effort hold-buffer action if evidence
   supports it; stop immediately after `read-xtop`, no downstream execution.
5. Observe Pack-derived Researcher candidate, then dependent Reviewer candidate and
   exact owner adoption. Input material omission must be disclosed, not invented away.
6. Owner materializes exactly one Operator for the begun execution. Inspect its effective
   contract: only `hima_interactive`, exact inline action and plan hash, correct identities.
7. Verify one validate/mutate/verify/save/finalize/close transaction, exactly one logical/
   physical ECO pair, normal process closure, and exact Operator-result owner adoption.
8. Complete `run-xtop-fix` and reader-backed `read-xtop`. Stop there. At a no-Job boundary,
   use the visible human pause if needed to prevent downstream work; preserve the Run.
9. Switch sessions/reopen the same UI as appropriate to prove recovery without a duplicate
   Run/Job/child/mutation. Inspect child transcript, XTop report/source, one Data Insight
   loaded-data view, and Guide's explanation; all must agree with Runtime facts.
10. Write report/checkpoint/handoff and end. Reuse closed J3 downstream evidence only as
    reference; do not execute apply-eco, StarRC, PrimeTime, compare/retain or a second iteration.

## Prohibited actions and ending

Historical Attempt 4 is permanently parked: `run-c355dfb4-9380-4d0c-8548-3e3380e050a1`,
revision 49. All prior Campaigns, native TEST Runs/Homes and trial.32 evidence are immutable;
never resume/cancel/edit/reuse them as GUI PASS. No source/Pack/Runtime/Permit hot patch,
raw shell/Tcl, hidden `hima_execute`, direct HTTP/Ledger writes, headless live runner, or
competing HimaHarness operator is permitted. Use ordinary visible Guide/owner conversations
and GUI controls. Computer Use may launch the approved App and manage evidence files, not
bypass its business controls. No timing/PPA/ROI improvement is graded or claimed.

Verdict: `PASS | FAIL | BLOCKED`. PASS requires every journey item and exact identity,
including no duplicate effect and truthful stopped/paused status; a model claim is not proof.
On a defect, preserve the first failing Run/child/receipt and stop all further product action.
Report exact steps, expected/actual result, owning seam if known and the lowest next gate.
Do not implement a fix. Write the durable tester handoff using the installed coordination
script, then send `CODEX_HANDOFF_READY: <absolute report path>` in this same Claude chat.
Use event-driven checkpoint/handoff signalling, not a 15-minute reminder.
