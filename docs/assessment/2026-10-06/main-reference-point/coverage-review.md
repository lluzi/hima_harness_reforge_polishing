# Review: test deletions in the pre-DBOS engine retirement (af90e37d..1fc59b5a)

This was a read-only review: nothing was edited, built or run. Tags: [R] = verified by reading code, [I] = inferred.
Four parallel reviewers classified the cases per file (sections Part 1–4 below). I reviewed the source diff myself and spot-checked their highest-impact claims.

## Totals (per part, before de-duplication)

| part | removed cases | A dead | B covered | C uncovered |
|---|---|---|---|---|
| owner-protocol host tests | 73 | 27 | 32 (~9 weak) | 14 |
| delegation / interactive / jobs | 65 | 26 | 21 (4 weak) | 18 |
| desktop + host faces | 74 | 17 | 34 (8 weak) | 23 |
| fabric / experience / AES / ATCS | 79 | 37 | 31 (~12 weak) | 11 |
| **total** | **291** | **107** | **118** | **66** (about 55 distinct after overlaps) |

Parameterised groups count once. Some C items appear in more than one part, for example Workshop confinement, the out-of-scope Operator command and the Reader value gate.

## Clear violations of the deletion rule (mixed cases deleted whole) [R]

- **custom-cell-fmax-pack.test.ts**: the removed case held 9 engine-free `spawnSync` checks of `flow/bind-inputs.py` refusals: TAP interval, clock buffer, MAX_CELLS capacity, CDL SHA, Liberty given as the DB, proxy identity, ambiguous DB, lib-only, legacy. Only its tail used `begin`. Restore the spawnSync part as it was.
- **skills.test.ts**: "installed authoring compiles a Workshop…" was deleted whole. Only its last step (`/hima run`) was legacy. The installed-bundle skill paths, knowledge files, the dev-checkout refusal and the `/hima-fabric` compile were all live. Restore it, replacing `/hima run` with `startRun`/confirm.

## Tests left broken or hollow (no longer real coverage)

- **[R] durable-views.host is broken by this refactor.** `test/contract/support/durable-views-worker.ts:487` does `const {runPage}=await load('workbench')`. 4dee99f0 deleted `runPage`, and `lib/workbench.js` no longer exports it, so the `else` path at line 422 throws a TypeError. The typecheck cannot catch it because the import is dynamic. Fix: delete that assertion; durable-ui-display.test covers "Goal unknown" in the native UI.
- [R] `dc-reader.test.ts`: all 13 dc-qor-report parser cases go through `/hima observe`, which always refuses now. They fail in the integrate run log, and also failed at base with the flag off. The bundled dc-qor-report Reader is live on DBOS (`durable-task-adapters.ts:207-213`). Fix: call `readerNamed('dc-qor-report').read(bytes)` directly.
- [R/I] Other tests still reach dead paths, so they are not coverage:
  - `unified-workbench.test`: two cases POST `/hima/api/observe` with no session, get 403, and stop before their start-form assertions.
  - `observe-ledger` "one gate refuses…" goes through `/hima observe`.
  - `growth-assets.desktop` goes through `support/growth.ts:36-44`, which drives begin/work/complete.
  - `resident-engineering.live` drives `begin` and skips.
  - `pipeline-stages.test.ts` is now comments only but is still listed in the desktop group.
- [I] `atcs-resident-durable` writes under `.hima-tmp/dbos-migration/u8/dry/` without creating it. The fault predates this work, but that file now carries the clear and residual ATCS cases alone.

## Source behaviour review (packages/)

- [R] The DBOS core files are byte-identical to base: flow-workflow, task-effects, task-interactive, native-task-adapters, durable-fabric, run-store and durable-views. The durable branches of `executionAction` (fabric.ts:814), `cancelRun` (recovery.ts:30), `resumeRun` (fabric.ts:496), `Host.interactive` (index.ts:1105) and `Host.delegationInput` (index.ts:1120) are unchanged. Boot recovery (index.ts:838) is unchanged.
- [R] The faces lost only their `legacyAutomaticAllowed()` branches:
  - In remote.ts, every route now always requires a session, and the audit routes always answer 403.
  - commands.ts refuses `/hima observe|run|job launch`.
  - Production behaviour is the same as base.
- [R] The `hima_run` "restoration" (tools.ts:766-811) matches base production:
  - an undeclared `test` is passed through;
  - a confirmed proposal refuses `timeBox`/`retries`/`generations`;
  - the Budget comes only from Campaign-file overrides.
  - The one difference: a bad numeric is no longer checked by `toolNumber`. It is refused anyway before any start, so the difference is moot.
- [R] Answers for historical Runs (all unreachable for active Runs, because `legacyCutoverReceipt` refuses a Home with an active legacy Run):
  - `executionAction`, `resumeRun` and `cancelRun` are now refusals or read-only.
  - `cancelRun` answers `ended` for a ledger Run whose status is still `running`/`waiting`. The wording is wrong, but the case can only arise behind the gate.
- **[R] 641587f2 changes live DBOS Reader behaviour.**
  - `${REPORT}` now points at the live contract path (durable-task-adapters.ts:221), and collection refuses a report that changed while it was read (:236).
  - (a) Nothing tests the refusal.
  - (b) Sibling evidence that Readers now read (probe-inputs.json, metrics.tsv, sample.json) is not hashed or retained. The observation identity covers only the report, so values derived from siblings are unprovenanced. This matches the old legacy route.
  - (c) `taskEffectAdapterVersion` is still `hima-task-effect/1`, although Reader argv and collection changed. ADR-0018 says an upgrade must not hide a changed call order under the same execution version.
  - (d) `commandTaskAdapter.submit` launches with the current `options.argv`, not the prepared one. A Reader effect prepared before an upgrade but submitted after it runs with a different argv. [I] Low risk.
- [R] Dead code and stale text left behind:
  - The progress-coalescing branch of `deps().notify` (index.ts:1545-1555, `detail===undefined`) has no caller now; only fabric.ts:476 calls notify, always with detail.
  - The free-session probe loop at jobs.ts:204-208 is dead.
  - Comments still name deleted symbols: claimSlotAndLaunch, stillDriving, cancelStopped, nextMomentAttempt.
  - The guard message at index.ts:835 tells owners to "Use hima_delegate", which now always refuses. Agents on DBOS Runs are stopped earlier by the durable guard; a former owner of a historical Run sees the message.
  - Two docs still name atcs-dry-path.host: `IMPLEMENTATION-MAP.md:75` and `sites/linglong-atcs28/README.md:509`.
- [R] **Pre-existing product gap, now with no code at all:** library-intelligence `libapi_worker.py` and `read-qualification.py` require `hima-library-host-attestation.json`. The only writer was `adapters/library-qualification.ts`, called only from the legacy act node at base and now deleted. E1 qualification therefore cannot pass on DBOS. This is not a regression from base production (DBOS never wrote the file), but the implementation is gone.
- [R/I] Other DBOS semantics the fabric part found (they predate this refactor):
  - A Run that hits its time box stays `waiting`, never reaches `ended-budget-exhausted`, and gets no report.
  - `retryAllowance` is accepted but command Jobs are never retried.
  - The Workshop retry brief (previous failure and log tail) is never set.
  - `/hima status` describes DBOS Runs only from the Ledger projection, so it shows no meters and no report files.


# Part 1 — owner-protocol host tests

Worktree `.hima-tmp/integrate-refactor` HEAD 1fc59b5a vs base af90e37d. Read-only review.
Removed cases were found by comparing `test(` names at base and at head. The commit body was not used as the source. In the modified (M) files, no assertion was removed from any kept case. The one exception is experience-files "an ended Run without a workspace…", which lost the `/hima/?run=` page assertion; that page is retired, so the loss is A.
`conversation-execution.host.test.ts` is byte-identical (empty `git diff`).

Legend: A = dead protocol only; B = live behaviour still covered (test named); C = live behaviour now uncovered.
A* = the mechanism is dead, but the business rule has no DBOS equivalent. This is a product gap, not a test gap.
V = verified by reading; I = inferred (from a name, a partial read, or code that was not executed).

Key current code paths cited below:
- DBOS facade `executionAction`: packages/harness/src/fabric.ts:814-848 (accepts only pause/continue/cancel/handoff/revise/grow/respond/engineering-message/measure-value).
- Owner/Guide boundary notices on DBOS: `deliverDurableBoundaries` packages/harness/src/index.ts:1216-1249, started at index.ts:854. `deps.notify` is now called only from fabric.ts:476 (open). Its progress-coalescing branch (index.ts:1545-1553) has no caller, and `notifyGuideBoundary` (index.ts:1252) reads `ledger.run().control`, which a DBOS projection never has, so it is dead for DBOS Runs.
- Resident delivery materialization: `materializeEngineeringResult` engineering-executor.ts:369-435, called on DBOS at task-effects.ts:414.

## side-talk.host (deleted, 1 case)
| case | class | evidence |
|---|---|---|
| a Side Talk can read and code during one owner Run, but only a safe handoff changes its owner epoch | B (split) | Side Talk `hima_context` read doesn't rebind owner + non-owner action refused + ordinary coding: conversation-execution.host "controlled tools derive ownership…" (`hima_context` from `other`, `denied.kind==='refused'`, `write` by guide) (V). Ordinary Side Talk bash while owner Run held: dbos-host-authority.host "PG Campaign ownership fences…" (V). Human pause from non-owner keeps owner/epoch, paused ['*']: conversation-execution.host "native preparation validates…" (Guide `/control` pause) (V). Handoff changes owner, fences old owner, idempotent, conflicting content refused: agent-controls.host "durable handoff refuses old-owner sends…" (flow-workflow-worker mode `handoff`) (V); Host-facade handoff accepted: knowledge-documents.test (V). **Gap:** the Host-side wake-up of the *new* owner after handoff (old test asserted notify detail "handed to this conversation…") is now `deliverDurableBoundaries` control-fact notice — uncovered, see C-1. `begin` refusal part = A. |

## notification-coalescing.host (deleted, 2 cases)
| case | class | evidence |
|---|---|---|
| execution facts coalesce to one queued wake-up while human controls stay immediate | A + C-1 | Progress coalescing via `deps.notify(detail undefined)` + `inbox.replace` has no caller (index.ts:1545) (V). DBOS sends no per-execution progress notices. Human control → owner notice now = control fact in `deliverDurableBoundaries` (index.ts:1226,1235) — no test of a non-terminal control notice to the owner (V by grep: only terminal notices tested in durable-views worker:490-507 and guide-sessions.host "a terminal Campaign boundary reaches its original Guide once"). |
| a human clearing a blocked node queues a wake-up turn for the idle owner without any person message | C-1 | Same path: human `continue` on DBOS → control fact → owner followup (index.ts:1226-1246). Uncovered (V). |

## knowledge-reuse.host (deleted, 2 cases)
| case | class | evidence |
|---|---|---|
| recommend returns and records the matching negative archive before code, while mismatches and corrupt sources never auto-inject | A* + C-2 | `recommend` is 'unsupported' on DBOS (fabric.ts:817). No DBOS Workshop calls `listRunKnowledge` (V by grep), so automatic measured-negative history injection into Workshop inputs has no DBOS equivalent. The production feature was already unreachable at base. **Live remainder:** `listRunKnowledge` candidate filtering (wrong Pack/Site excluded, corrupt archive → `unavailable`, author-test purpose never automatic, changed captured input bytes never automatic, project identity required) still serves `experienceCandidates` (index.ts:1089-1094 → POST /hima/api/experience/candidates remote.ts:1766). No real-Host test covers it: remaining-ui.desktop stubs the response with `fulfill` (V). |
| recommend does not auto-inject history when one declared Workshop input is unavailable | A | The `unavailableInputs` argument is passed only by the retired recommend action; `experienceCandidates` always passes `[]` (index.ts:1091) (V). |

## research-analysis.host (deleted, 1 case)
| case | class | evidence |
|---|---|---|
| only the actual owner can record source-linked research analysis; retries and false numeric claims preserve facts | A* (record) / B (report) | `analyze` is unsupported on DBOS and `ledger.appendAnalysis` is deleted, so no current path records an analysis. This is a product gap: the report still renders a "Research interpretation" section (experience-report.ts:275), but only from historical analyses (V). Report-side validation of invented citations, false numbers and revision-invalidated citations (`analysisProblems`, experience-report.ts:253) is covered by experience-report.test (lines 72, 87) (V). |

## agent-execution.host (deleted, 7 cases incl. 2 parameterised)
| case | class | evidence |
|---|---|---|
| a conversational owner prepares a Run without executing its first business node | A | DBOS deliberately executes automatically (ADR-0018). |
| the same Agent launches one node, pauses during its Job, validates completion and explicitly chooses the next node | A / B | begin/work/complete dead. Pause during Job, sibling continues, dependent fenced, continue resumes: agent-controls.host `durable pause control…` (worker mode `pause`) (V). |
| pause and an explicit handoff fence old owners without changing Goal or budget | B (partial) | agent-controls handoff (V); knowledge-documents Host handoff (V). Deadline invariance asserted for revise/closing, not for handoff (I: weak). Invalid revise refusal on DBOS: not seen asserted (I). |
| node admission is owned, versioned and idempotent before any Job exists | A / B | begin dead. Control idempotency/conflict: conversation-execution.host (`repeated.kind==='duplicate'`, changed content refused) (V). |
| an owned Run refuses separate model moments while waiting, cancelled or budget-ended before opening any session | B | conversation-execution.host "native preparation…" and "a prepared DBOS product Run refuses standalone moments…" (409 /controlled by its conversation Agent/, no session record) (V). |
| a delayed actual ${Site probe / intent persistence} that crosses the Campaign deadline dispatches no Job… | B | dbos-flow.host "closing-task admission still refuses submit after the original hard deadline", "independent original hard deadline closes Job while main submit receipt is blocked" (worker modes closing-hard, hard-blocked) (V). |
| production refuses a standalone moment on a historical ${waiting/cancelled} Run before any session is composed | C-9 (minor) | `momentOnCurrentNode` moments.ts:372-380 still serves non-DBOS Runs (index.ts:1300-1307); the "standalone historical model moments are unavailable" refusal and the owned-historical branch have no test (V by grep). |

## agent-graph.host (deleted, 10 cases)
| case | class | evidence |
|---|---|---|
| fork exploration uses a fresh unbranched observation and Judge, never the last branch success | B | fork-join-judge-durable.host "DBOS fork Explore: …" (consolidated observation unbranched, fresh Judge, decision cites consolidated not branch) (V). |
| fork consolidation cannot bypass its fresh Judge on a revisit | B | Pack validation packs.ts:2758; fork-join.test.ts:246 asserts the same "has explore node … downstream of …" refusal (V). |
| explore rejects invented success and invalid strategy, then follows the owner choice and actual goal evidence | A / B | Owner Explore decisions are dead. The DBOS chooser bound: input-admission.host "a chooser candidate outside Strategy bounds cannot start a second generation or change the Goal" (I by name). |
| a valid next-strategy request at the generation budget records an honest ending without another Job | B (partial) | fork-join-judge-durable generation-limit scenario: `outcome==='generation-limit'`, `ended-goal-not-met`. The status differs from the legacy `ended-budget-exhausted`/`endedBy`, which is DBOS's own semantics (V). |
| fork branches require explicit work, node pause fences dependents only, and join uses each branch evidence | A / B | Explicit work is dead. Scoped pause fences dependents only: agent-controls `pause` (V). Per-branch Judge: fork-join-judge-durable (verdicts per branch) (V). |
| a declared nested Loop exposes entry and each inner generation without helper-driven Jobs | A / B | Owner-exposed loop entry is dead. DBOS repeat: dbos-flow.host "real DBOS executes sequence/choice/parallel/repeat/fragment…", "${repeat} commit survives Host kill…" (I by name). |
| an invalid fixed chooser recommendation does not veto a valid owner strategy | A | Owner strategy override has no DBOS equivalent (the chooser decides). |
| Pack wait needs a human clearance followed by explicit Agent completion | B | agent-controls `human` (respond) and `human-hold` (agent continue rejected /human/) (V). |
| the owner reads the exact evidence ids an Explore must cite, and a wrong citation names them | A | Owner Explore completion is dead. `exploreCitation` survives only in the historical `executionContext`. |
| an Explore node's context names the exact cite ids, and they survive 130 later knowledge records | A | Same. |

## agent-workshop.host (deleted, 6 cases; the last is parameterised over tamperHelper)
| case | class | evidence |
|---|---|---|
| an Agent-owned Workshop code failure stays in the coding loop without human clearance | B | branch-autopilot.host "normal Workshop automatic repair: program-corrected/…" (I by name + scenario list). |
| recommend distinguishes an unbegun execution from a begun act with no Workshop | A | recommend dead. |
| a closing reserve stays inside the hard box and admits analysis while refusing new node work | B + C-8 | DBOS closing reserve: dbos-flow.host "original closing reserve blocks new business Jobs", "declared closing delivery…" (V). **Uncovered:** the pure `budgetStandingAt` phase boundaries (active/closing/exhausted), budget.ts:71, which DBOS context reports (durable-fabric.ts:255). Only `phase==='active'` is asserted anywhere (knowledge-documents:111) (V). |
| research writer charges rewrites and refused calls before Site effects across the whole Run | B | DBOS `reserveExternalResearchWrite` (run-store.ts:711-736), task-effects-worker:76-82,204-214 (exact-byte boundary, denial, idempotent receipts, conflicting reuse refused) (V). |
| the actual conversational owner reads inputs and knowledge, writes a version and launches it without a hidden model session | A / B-weak | Owner read/write/knowledge actions are dead. The DBOS native Workshop is covered by native-task-effects.host (I by name). Historical `readMaterial` negative guards (cross-Run id → none, Permit refusal → unreadable, tampered retained bytes → changed; experience.ts:623-655) are not directly tested; only positive retained and offline reads are (experience-files "an ended Run archives byte-identified code…", "the same Ledger reads exact migrated Run assets…") (V). See C-10. `executionText` render compaction (tools.ts:179) is only weakly covered: conversation-execution parses rendered hima_execute kind/context/receipt (V). |
| a begun Workshop draft retains its original author's code across handoff${…} | A | Owner write plus mid-execution handoff is dead. |

## workshop-recovery.host (deleted, 6 cases)
| case | class | evidence |
|---|---|---|
| a Workshop Job that exits 0 without writing its declared output is a failed attempt the owner can retry | B | node-turns.ts:141; branch-autopilot "missing-output-refused" (I by name); durable-task-adapters-worker:129-130 (stale output) (V). |
| the owner is told plainly that a Workshop entry is its one result and must write the declared output | A | Recommend advice text. |
| continuing an upstream Workshop clears the downstream Reader it supersedes and starts new work there | B (analogue) | DBOS revise reruns consumers: dbos-flow.host "revising one actual input reruns its consumers…" (V by worker mode `revise`). Only a human may restart after failure: worker `failed-revise` (agent continue rejected /human/) (V). |
| a Workshop output left by earlier work is not the result of this execution | B | node-turns.ts:148; durable-task-adapters-worker:129-130 asserts /older than its entry/ (V). |
| a person pausing and continuing a passed node only lifts that pause; nothing is restarted | B | worker `human-hold-recover` (unscoped human continue does not advance; scoped continue required) (V). |
| clear the Reader first, then continue the producer: new work still starts at the producer | A | Ledger restart/supersession semantics. |

## agent-desktop-replay.host (deleted, 1 case)
| case | class | evidence |
|---|---|---|
| replay uses real conversational tool results for dynamic execution identities and normal user steering | A | Replayed owner begin/complete through hima_execute. |

## agent-recovery.host (M; kept: "production preparation refuses an unowned Run…")
| case | class | evidence |
|---|---|---|
| a historical waiting Run observes its existing Job after restart… | A | Non-DBOS Runs are read-only and reconcileRuns is gone. The cutover gate refuses a Home with an active legacy Run (dbos-migration.host) (I). |
| an interrupted completion remains fenced even when its prior Job has a successful exit | A | same |
| adoption refuses missing method identity, changed input metadata… | A | `adopt` is refused for non-DBOS Runs (fabric.ts:844-847); adopt is refused at the tool level in conversation-execution (V). |
| adoption carries an open historical human wait once… | A | same |
| historical Runs keep their node boundary on restart and explicit adoption verifies v19 metadata… | A | same |
| an interrupted admitted request stays uncertain after restart and does not free its Site or replay | A | same |
| a restarted Host observes the exact Job after its launch receipt was lost… | A | same |
| restart repairs an owed report of an ended ${owned/historical} Run after a real Site write fault… | A | Boot only runs `reconcilePublishedLegacyArchive` (index.ts:838-843, same at base) (V). That path is covered by experience-files "legacy startup skips an unpublished archive reservation…" and "restart completes an exact reserved directory…" (V). |

## resident-engineering.host (M; kept 3 declaration/protocol cases)
| case | class | evidence |
|---|---|---|
| public Host wakes the owner when a resident turn waits without a status poll or human prompt | C-1 | The DBOS owner notice for waiting task codes (index.ts:1223-1224) is uncovered (V). |
| Host recovery reattaches resident lifecycle observation without replaying the task | B | task-effects.host "DBOS SIGKILL after ${prepared/submitted} fact resumes stable operation order and one original Job" (I by name). |
| resident owner notification survives Reader-rejected native delivery and same-task repair | B + C-1 | Repair: task-effects-worker:183-185 (reader-rejected, then repaired at the same boundary) (V). The notification part is C-1. |
| ended resident Run assets expose verified files and checkpoint bytes without changing its archive or verdict | B (DBOS) + C-4 (historical) | DBOS task artifacts after the Run ends: durable-views worker `readTaskArtifact` (V). **Historical** `readEngineeringAsset` (fabric.ts:886-892 → `readRetainedEngineeringAsset` engineering-executor.ts:511-620, route remote.ts:1840-1842) has no remaining test. The lost checks include checkpoint tree reads, "tree differs", intermediate symlink, file/byte limit, escaping reference, cross-project 403 and binary download (V by grep). |
| public Host keeps one resident task through start, message, Reader-verified delivery and release | B | task-effects.host "real resident wrapper/ACP Job auto-hands-off Reader result…"; atcs-resident-durable / libinsight-resident-durable (I by name). |
| delivery preflight cannot overwrite Campaign authority outside the Pack artifact prefix | **C-3** | engineering-executor.ts:392-393, live via task-effects.ts:414. No test (V by grep for the messages). |
| repair must use a fresh revisioned support path instead of mutating a published tree member | **C-3** | engineering-executor.ts:404-408 (V). |
| artifact prefix must be a plain directory and cannot resolve through a Campaign symlink | **C-3** | engineering-executor.ts:355-363,383-384,416-420 (V). |
| paused execution still reports and actually cancels the same resident native process tree | B-weak | task-effects-worker:186-193 (pause fences send); cancel closure in agent-controls `cancel` (V). Resident-specific cancel while paused is not seen (I). |
| Run cancel confirms cleanup or keeps resources fenced without replay when ownership retention races | B | dbos-control.host "concurrent main/control cleanup retains one original stop proof…" (I by name). |
| best-effort resident delivery is saved and Reader-verified without claiming the Pack Goal | B | atcs-resident-durable "residual" mode: delivered with goalState not-met (V). |
| an at-cap start writes no task, then a fresh request launches once with the tool licence after the slot frees | B | task-effects-worker:180 (site-capacity, competitor not launched), :269 (licence reusable after closure) (V). |
| Reader rejection is repaired in the same native session and release binds the latest verified manifest | B | task-effects-worker:183-185; task-effects "resident ${retained/changed} result keeps exact validated bytes…" (I). |
| public status reconciles a crashed wrapper orphan without replay and release keeps the stopped task fenced | B | task-effects "known resident failure closes original ${live/gone} wrapper resources…" (I by name). |
| paused verified delivery and release retain facts without recommending completion | A | "recommending completion" is part of the owner protocol. |
| crash cleanup preserves Reader-verified ready delivery through status, release and completion | B-weak | task-effects "resident running accepted message defers the original release receipt…" (I). |
| Run cancel after wrapper crash reconciles the retained native tree before ending and launches no retry | B-weak | task-effects known-failure modes (I). |
| Host restart fences a finished resident wrapper instead of settling it as ordinary tool work | B-weak | task-effects SIGKILL modes (I). |
| missing retained owner identity returns unknown, keeps the orphan fenced, and never replays business work | B-weak | agent-controls `unknown` (unknown closure retained) (V, generic only). |
| pre-receipt Host crash retains task identity so restart can clean the same native task without replay | B | task-effects "DBOS SIGKILL after prepared fact…" / "prepared-intent crash preserves human pause…" (I). |

## experience-files (M)
| case | class | evidence |
|---|---|---|
| a newer human hold survives Host restart, keeps saved memory stale, and starts no work | **C-5** | Work-memory staleness checks `ledger.run().control.revision`/paused (experience.ts:258-262, 204-206). DBOS projections carry no `control` (durable-views worker asserts `ledger.run(runId).control===undefined`). A human hold on a DBOS Run therefore marks memory stale only if the hold is projected as a new ledger record or row change (I). Untested (V). |
| two actual observations of an overwritten report retain both byte versions for final archive | B-weak | observe retention at observe.ts:111-124 (V). DBOS revision keeps old hashes: durable-views "completed DBOS revision serves its new report while preserving old hashes" (I by name). The same-path-overwritten-twice-into-archive case is not directly tested. |
| Host candidate refresh and restart retain disabled identity, reject another workspace, and permit evidence-backed re-adoption | **C-2** | `experienceCandidates` / `correctExperience` / `workMemory({runId})` project scoping (index.ts:962-995,1089), with restart retention of a disable and "disabled is not automatic after restart". Only the ledger-level `recordExperienceAdoption` is tested ("experience adoption is append-only…"). No test asserts "not linked to the current project" (V by grep). |
| (kept case) removed `/hima/?run=` not-written page assertion | A | Server page retired. |

## xtop-timing-closure (M)
| case | class | evidence |
|---|---|---|
| a real Host reads XTop physical evidence through its Pack observation node | **C-6** | The Pack Reader packs/xtop-timing-closure/readers/xtop-closure-state.yml (physical DRC/connectivity manifest → `xtop_setup_wns` etc.) runs on DBOS via the frozen Reader adapter. No remaining test mentions `xtop-closure-state` or `xtop_setup_wns` (V by grep). |

## custom-cell-fmax-pack (M)
| case | class | evidence |
|---|---|---|
| a real Pack-sourced TSMC28 L4 profile materializes declared Site inputs without a Golden Flow or legacy object | **C-7** | About 75% of this case was `spawnSync` against packs/custom-cell-fmax-dtco/{flow,tools}/bind-inputs.py and needed no engine. It covered rejection of a missing CCFMAX_TAP_INTERVAL, a non-DCCK clock buffer, MAX_CELLS < 320, a FOUNDRY_CDL_SHA256 mismatch (both copies), Liberty given as FOUNDRY_DB_FILE (both copies), an LFR_ABC_SHA256 mismatch, the FOUNDRY_DB redefinition, and Liberty-only without a compiled DB, plus legacy single-library acceptance. None of these messages appears in any remaining test (V by grep). The Host part covered the 12 h time box, `bind-inputs` as the entry, the materialized inputs.json mapping, the timeout floors and `stages.py` staging; it is also uncovered and needs the DBOS route. |

## library-intelligence-pack (M)
| case | class | evidence |
|---|---|---|
| Host prelaunch attests Permit, nested roots, pinned edarun, exact QuaLib claim and one-Job XTop exclusion | A* (HIGH product gap) | adapters/library-qualification.ts is deleted, and it only ever ran in the legacy act node. The Pack worker still *requires* `hima-library-host-attestation.json` (packs/library-intelligence/tools/libapi_worker.py:284-308,377), and its Reader requires it too (read-qualification.py:145,176-179). No current code writes it (V by grep of packages/harness/src). Inferred consequence: library-intelligence E1 cannot qualify on DBOS. This predates the refactor. |
| real Host vetoes a Site-bound Python that differs from the manifest before recording a Job | A* | Same adapter. |
| one-Job Site cap excludes Hima-managed Library and XTop jobs in both launch orders | B (partial) | DBOS capacity: task-effects-worker:180 (site-capacity), :201 (no licence overlap) (V). The mixed-licence parallelJobs=1 pairing is not specifically tested (I). |
| real local Host refuses a self-consistent positive receipt with no matching qualification Job | A* | The "no matching launched … Host Job record" check lived only in the deleted adapter (base adapters/library-qualification.ts:233) (V). |

## conversation-execution.host
Unchanged (empty diff), so it has no removed cases. It is cited above as coverage.

## Totals (each case counted once, under its most severe class)
73 removed cases: A 27 (5 of them A*, i.e. product gaps), B 32 (about 9 of them weak or partial), C 14.

## C list (suggested DBOS-route tests)
- C-1 Non-terminal owner and Guide boundary notices: a control fact (human pause, continue or handoff → new owner) and blocker codes reach the current owner once (index.ts:1216-1249). Test: bootInProcess with HIMA_TEST_SILENT_AGENT=0, a DBOS Run, and `agent.followup` stubbed as in durable-views-worker:493. Issue a human pause and assert one owner notice; repeat it and assert no new notice. Hand off and assert the notice goes to the new owner only. Add a waiting `human-response` task and assert the owner plus Guide notice.
- C-2 `experienceCandidates`, `correctExperience` and `workMemory({runId})` project scoping and restart retention; the `listRunKnowledge` filters (wrong Pack/Site, corrupt archive, test purpose, changed input bytes). Test: two DBOS Runs that have both ended and been archived, the candidate route, a foreign-workspace session refused, disable → restart → still disabled and `automatic=false`.
- C-3 Resident delivery preflight in `materializeEngineeringResult` (engineering-executor.ts:392-420): a path outside the prefix, an existing support path with different bytes, and a symlinked prefix. Test: the task-effects-worker resident fixture with three delivery variants, asserting the refusal reason and that nothing was written. A direct unit call with a local Site would also work.
- C-4 Historical `readEngineeringAsset` and `readRetainedEngineeringAsset` (fabric.ts:886; engineering-executor.ts:511-620; route remote.ts:1840). Test: a ledger fixture with a historical engineering delivery record, then a tree read, tamper, symlink, oversize, cross-project 403 and binary download.
- C-5 Work memory saved on a DBOS Run must become stale after a later human hold (experience.ts:258-262). The checks depend on ledger `control`, which DBOS projections lack, so this may be a real bug.
- C-6 The XTop `xtop-closure-state` Reader: run the Pack reader on the fixture closure state, or start a DBOS Run with the observation-node graph variant.
- C-7 custom-cell-fmax `bind-inputs.py` rejections. Restore them verbatim as `spawnSync` cases, since they need no engine. Port the inputs.json materialization and the 12 h time box to a DBOS Run that stops after bind-inputs.
- C-8 `budgetStandingAt` phase boundaries (budget.ts:71): a pure unit test.
- C-9 `momentOnCurrentNode` refusals for historical Runs (moments.ts:372-380): POST /moment on a ledger-only Run.
- C-10 Negative guards in historical `readMaterial` (experience.ts:623-655): another Run's record id, a Permit-refused path, tampered retained bytes. Extend experience-files.

# Part 2 — delegation / interactive / jobs

Worktree `.hima-tmp/integrate-refactor` @ 1fc59b5a, base af90e37d. Read-only review.

Legend. A = dead protocol only (Ledger RunControl / legacy driver / job-cap / timer controller /
notifier). **A\*** = the business rule itself was deleted with the legacy runtime and has *no*
DBOS implementation (not a coverage gap, a product-rule drop that should be a conscious decision).
B = live on DBOS and covered elsewhere (file + test named). C = live on DBOS (code reachable from
a DBOS task) and now uncovered. [R] verified by reading code/test; [I] inferred.

Kept cases in the four M files (interactive-runtime projection, jobs channel x2, fabric-licences
"declares none", recipe-budget H1) are byte-identical to base [R]; no assertion was removed from them.

Answer to the key question [R]: Teams and interactive EDA *do* exist on the DBOS path.
`durable-task-adapters.ts:137` routes a node with a Pack `agentTeams[].triggerNode` to
`aggregateTeamAdapter` (:523) which materializes members in dependency layers (`orderedMemberLayers`
:446), builds each `DelegationContract` incl. reviewed action/scope checks (`memberMaterialization`
:458-521), and runs each through `teamTaskAdapter` (`native-task-adapters.ts:461`) ->
`createDelegation`/`followupDelegation`/`readDelegationResult` (`delegation.ts:506/581/756`).
Operators get `taskInteractiveDelegationGrant` and drive `operateTaskInteractive`
(`task-interactive.ts`), which uses the shared `interactive-job.ts` (open/send/observe/close,
process-group stop, close grace, errorTail). `hima_delegation_input` for native children is
`index.ts:1120` (selection via `selectDelegationInput`). Tool/token guard for native children is
`registerAsyncDelegationGuard` + `delegationToolDenial` (`delegation.ts:828-903`). What does NOT
exist on DBOS: Run-level child-share admission ("Child shares exceed", lane accounting), the
32-live/128-lifetime child caps, owner result/adopt/followup actions (`Host.delegate` refuses),
Ledger execution settlement, timer controller, durable log tail on retry records, the Python
compile check is still live.

## delegation-run.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| two independent native children share one Run budget and retain separate results | A\* (+B for separate results) | "Child shares exceed" was `delegation-runtime.ts:267@af90e37d`; current `delegation-runtime.ts` is read-only (101 lines) and DBOS `teamAuthority.admitCreation` (`native-task-adapters.ts:430-453`) only clamps each child's deadline to `min(run.deadlineAt, now+share)`, no aggregate charge [R]. Separate per-member results: `branch-autopilot.host` "native stop closes original resources; Team dependencies…" asserts `members.one/two` with distinct `factId`s [R]. |
| delegated structured observations compact JSON without discarding endpoint evidence | A\* | Legacy `record-fact` with `material.encoding:'json'` rendering is gone; DBOS `delegationInput` returns raw PG `fact.payload`, >40 kB -> `unavailable` + "select with path/offset/limit" (`index.ts:1139-1143`) [R]. |
| real Run delegation recovers a cold completed result, gates dependencies, keeps lifecycle/tool authority truthful | B (Ledger result/adopt protocol A) | DBOS equivalents: `native-task-effects.host` "native Workshop code -> … continuable Team share PG effect handoff" (5 follow-up rounds on the same child, lost inbox ACK, older completed turn not selected, `nativeMessagesCompletedThrough`) [R]; `branch-autopilot.host` (layered dependencies; reviewer `dependencyIds.length==2`, inputRefs include dependency facts) [R]; `delegation.host` "native bounded delegation creates, edits, follows up…" (held parent keeps reads/freezes writes, follow-up cap, cancel fences reads, restart no respawn) [R]. |
| six parallel Teams of three fit two generations in a 180-minute box on six Site lanes | A\* | Lane x time-box accounting removed; no DBOS counterpart [R]. |
| ended children are charged only the time they held | A\* | same [R]. |
| runaway delegation refused: 32 live, 128 per Run | A\* | Caps removed (`delegation-runtime.ts:257/302@af90e37d`). DBOS bound is only "members declared per Team per task invocation"; ATCS fork x generation x revise has no Run-wide child cap [R/I]. |

## delegation-followup-tools.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| a finished recipe-budgeted child keeps its tools on a follow-up after dsh cold-resumes it | C | Live: `delegationToolDenial` token check + `effectiveTokenLimit` (request-header fallback) `delegation.ts:845,861-866`; DBOS re-apply `registerAsyncDelegationGuard` `agent/request` `delegation.ts:895-901`; Team follow-up `native-task-adapters.ts:570-600`. Only partial coverage: `native-task-effects.host` asserts every child request header carries `maxTokens 16000` across follow-ups, but never that a follow-up tool call succeeds (replay text is returned regardless) [R]. Suggest: in `native-task-effects.host`, after a follow-up round assert the `hima_delegation_input` tool/result in that turn has `isError!==true`, and add a unit assertion of `delegationToolDenial` with an agent lacking `options.maxTokens` but whose `requestHeader()` carries the limit (pass) / a different limit (deny). |

## delegation-input-bounded.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| large exact input read through bounded path/offset/limit; whole read, missing path, changed bytes refused | C (changed-bytes part A) | Live: `selectDelegationInput`/`delegationInputSelected` `delegation.ts:255-324`, called from DBOS native branch `index.ts:1134-1138`; ATCS Operators request `hima_delegation_input` (`packs.ts:2245-2259`). Current tests only use `path:'/value'` (no offset/limit, no refusals) in `native-task-effects.host`/`branch-autopilot.host`; paging is exercised only by `child-compaction.live` (live-model group, skips without key) [R]. Changed retained bytes: DBOS reads the PG fact, no retained-file path -> A. Suggest: pure unit test of `selectDelegationInput` over the existing fixture `packs/agentic-timing-closure-system/flow/tests/live_fixtures/t05-worker-request-w03.json` (dotted path, JSON pointer, array index, entries/chars windows, `next` chaining, refusals for missing path/`../`/offset -1/limit 0/offset 1.5), plus one `Host.delegationInput` call on a native grant asserting the 40 kB envelope bound. |

## delegation-input-native.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| native delegated input rendering never labels omitted structured evidence complete | C (payload shape A) | Live rule: oversize whole read returns `kind:'unavailable', truncated:true, viewLimitBytes` and never a truncated fragment; byte (not char) bound via `Buffer.byteLength` (`index.ts:1131-1143`) [R]. No current test hits the `unavailable` branch [R]. Suggest: in the native Team fixture, grant a >40 kB fact and assert the native tool result is `unavailable/truncated:true` with no `value`, and a small multibyte fact is returned whole. |

## delegation-team-settlement.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| Team execution whose required member ended without a result settles failed and a fresh attempt begins | A | Ledger execution phase/retry/blocker settlement (`settleStrandedTeamExecutions` deleted). DBOS analogue: member `failed` -> `aggregate-terminal` (`durable-task-adapters.ts:551,580`); only the schema-terminal route is tested (below); member cancelled/expired -> aggregate failed is untested [I]. |
| a Team Reviewer may approve an Operator scope: typed mutations within commands, plan hash and budget | C (Operator enforcement part B) | (1) Pack-load checks "not a mutation", missing hash argument, cap 0, scope field not in Reviewer schema: `packs.ts:2301-2330` live via `loadPack`; only cap 601 covered (`delegation-recipe-budget.host` H1) [R]. (2) Reviewer scope validation at materialization `reviewedScopeProblem` (`delegation.ts:82-95`) and scope-vs-typed-hash-bearing check (`durable-task-adapters.ts:477-481`): uncovered [R]. (3) Operator enforcement (wrong plan hash refused, allocation exhausted, survives PG reopen): B `task-interactive.host` "PG Operator retains Tcl identity, mutation scope…" (`wrong-plan`, `scope-exhausted`) [R]; "outside its owner-adopted reviewed scope" (`task-interactive.ts:109`) untested [R]. Suggest: extend `durable-task-adapters.host` Team fixture with a `mode:'scope'` Reviewer returning over-cap / outside-recipe scope and assert the member is repaired/refused and no Operator child is created; add the four load-time refusals to H1. |
| an Agent Team result with {missing fields, number, boolean, string, null, array} is refused naming the schema and missing fields (x6) | B (weak) | Refusal path live: `durable-task-adapters.ts:530` + `automaticNativeRepair` schema repair/terminal (:671-760). `branch-autopilot.host` asserts repeated invalid schema -> failed `/one schema repair|allowance/` and `aggregate-terminal` [R]. Not asserted: message names schema id and fields; DBOS message lists *all* required fields, not the missing ones, and non-object JSON says "Business input must be one JSON object" (`:45`) [R]. |
| an adopted reviewed action whose argument value is not in the plan is refused naming the value | C | Live: `durable-task-adapters.ts:485` "Reviewed action is not one action in the exact Reader-backed plan" - **does not name `value=99`** (Gap 5 fix not carried to DBOS) [R]. Untested. Suggest: Team fixture with `reviewedAction` mode action, Reviewer returns value absent from plan; assert refusal and (after fixing) that the reason names the offending argument=value. |

## fork-interactive-team.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| two fork branches each hold an interactive Job driven by their own Team at once; join waits for both | B (weak) | Concurrent Operator sessions + capacity: `task-interactive.host` (two grants, capacity refusal then open) [R]; ungranted/foreign operator refused (`model-without-grant`) [R]; fork Team siblings `branch-autopilot.host` sibling occurrence [R]. No DBOS test runs two interactive Team branches into one join [I]. |
| an Operator that asks the Harness to close its own session settles ready, never failed (close command first) | C | `close-command-required` rule `task-interactive.ts:350-353` (refuse transport close until the declared close-effect command completed; exempt hostStop/hold/cancel/past deadline) untested on DBOS [R]. Suggest: Tcl fixture with a `close` effect command having arguments; close before it -> refused naming `close-command-required`; after it completes -> `closed`; `hostStop:'recovery'` closes without it. |
| under a Site cap of one, second branch's interactive open refused while first holds the slot, opens once free | B | `task-interactive.host` `capacityRequest` -> `/capacity/`, then `capacityOpen` opened after close [R]. |
| two parallel Teams whose shares exceed the time box are admitted on two lanes | A\* | Lane accounting gone (see delegation-run) [R]. |
| owner advancing one branch leaves the other branch's Operator authority valid | B | `branch-autopilot.host`: revise sibling `other-work` -> `nativeDelegationPolicy(...).writesAllowed===true`, admitted revision 0, real `hima_delegation_input` still succeeds [R]. |
| a pause on one branch's node holds only that branch | B (weak) | Task-scoped pause/continue: `support/flow-workflow-worker.ts:356-386` (via `dbos-flow.host`) [R]; not exercised with a Team member adoption [I]. |
| Operator open waiting for ready line and owner batch work both answer (deadlock) | A | Ledger admission-queue vs slot-claim deadlock; DBOS uses PG reservations [R]. |
| open in flight not marked cut off by restart reconcile | A | `reconcileInteractiveState` deleted [R]. |
| after Host restart, sessions re-attached, undrivable ones closed once, owner told once | A (B weak for close-on-stop) | Timer controller/notifier deleted. DBOS: `closeTaskInteractiveSessions`, hostStop recovery and Team stop closing Operator Jobs covered in `task-interactive.host` and `branch-autopilot.host` "native stop closes original resources" [R]. |

## interactive-eda.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| real Host owns one qualified interactive Job from begin through typed Tcl save and exit | C (for C33 errorTail; rest A/B) | Ledger recipe gating/adoption, manual Operator 1-follow-up/5000-token default, C10 batch-work refusal on RunControl: A. Typed commands, qualification gating, held mutation/allowed read, save, close, identity conflicts: B `task-interactive.host` + `interactive-binding.test` [R]. **C33 errorTail** on `command-failed` (send path and observe path) `interactive-job.ts:407,485-487` reached via `task-interactive.ts:340-347`: no test asserts it (only `test/fixtures/interactive-job/repl.tcl` mentions it) [R]. Suggest: in `task-interactive.host` send a failing typed command and a slow-failing one observed later; assert the PG `interactive:record` `command-failed` carries an errorTail without `HIMA:` markers. |

## node-jobs.host.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| a durable launch intent must succeed before an actual Job can start | B | `jobs.ts:224-229` `beforeLaunch` -> `LaunchNotDispatchedError`; `task-effects.host` "DBOS SIGKILL after {prepared,submitted} fact resumes stable operation order and one original Job" [R]. |
| nonblocking capacity admission returns once and never launches when a slot later frees | A | node-turns nonblocking tool API [R]. |
| a nonblocking tool returns its real session; stopping the Host observer leaves that Job running | A | same; DBOS analogue covered by the SIGKILL case [R]. |
| conversational Agent writes isolated Workshop versions; launch verifies every recorded file | C (part) | `writeIntoWorkshop`/`readForWorkshop` confinement (path `../escape.sh` refused, undeclared output read refused) `workshop.ts:438+` reached via `native-task-adapters.ts:233` `workshopTools(scope)`: no current test [R]. Per-execution source dirs on DBOS: `.executions/<sha>` (`durable-task-adapters.ts` priorWorkshopSources) [I]. Suggest: native Workshop fixture replaying `hima_workshop_write {path:'../x'}` and `hima_workshop_read` of an undeclared output; assert tool errors and no code fact. |
| a killed Host at {window} reconciles the exact durable intent without relaunch | B | `task-effects.host` SIGKILL prepared/submitted [R]. |
| a nonblocking Pack reader returns its Job; only read-back settles | A | [R]. |
| the Pack chooser is readonly advice | A | owner recommend API gone; DBOS chooser in `durable-task-adapters.host` "legacy declarations use frozen Reader/Judge/chooser…" [R]. |
| an unresolved launch intent vetoes another Run inside the Site capacity claim | B | `support/task-effects-worker.ts:174-180` unknown release blocks competing licence (`site-capacity`) [R]. |
| C33: failed tool Job with retries left records its log tail on the retrying node record | A\* | DBOS command failure stores `executor-failure` with exitCode only (`task-effects.ts:113-118,251`); tail is read live on demand `index.ts:1487-1500` (untested on the DBOS branch) [R]. |
| C21: Python Workshop entry that does not compile refused when interpreters match, warned otherwise | C | `workshop.ts` `pythonSyntaxProblem` (~:422) in `writeIntoWorkshop` :438, live for DBOS native Workshops (`native-task-adapters.ts:233`) [R]; no current test (aes-*-durable never write bad Python) [R]. Suggest: DBOS native Workshop fixture with `entry.py`; replay `hima_workshop_write` of `def f(:`; assert refusal text "does not compile", no code fact; plus a mismatched-interpreter Site warns and writes. |
| C33: Agent-owned Workshop Job that fails records its log tail | B | `durable-task-adapters.ts:751` repair feedback with `retainedJobTail`; `branch-autopilot.host` "normal Workshop automatic repair: …" asserts `/ORIGINAL_PROGRAM_ERROR/` in the plan [R]. |

## jobs-unreadable.test.ts (deleted)

| case | class | evidence |
|---|---|---|
| a poll that cannot ask the site writes nothing and keeps asking | C (low) | DBOS: `retainedJobState` -> `jobState`/`sessionThere` (`jobs.ts:159-183,288-292`) throws `SiteUnreadableError`; `executeTaskEffect` maps it to waiting `effect-unknown` (`task-effects.ts:115-116`) [R]. Classification untested [R]. |
| a socket directory that cannot be entered is a cannot-tell | C (low) | same `sessionProbe` Permission-denied branch [R]. |
| a probe the site could never run is a cannot-tell | C (low) | same, non 0/1 exit [R]. Suggest one `jobs.test` unit over a stub Channel for the three `sessionProbe` answers plus `retainedJobState` with exit file present + `no-socket`. |
| a run whose site cannot be asked is reported site-unreadable at a restart | A | `reconcileRuns` deleted [R]. |
| a time box that runs out while the site cannot be asked writes the kill-did-not-take blocker | A | Ledger blocker [R]. |
| a run resumed while the site cannot be asked keeps asking | A | resumeRun gone [R]. |
| a first launch onto a site whose slots cannot be counted is asked again | A | job-cap `claimSlot` deleted [R]. |
| a launch that was sent and never answered is not sent again | B | `support/task-effects-worker.ts:222` unknown launch: three waits, no calls file [R]. |
| a launch that crossed a cancel and cannot be asked to stop blocks its node | A | Ledger node blocker; DBOS cleanup in `dbos-control.host` [R]. |
| a job that wrote its exit file settles from it even when the socket is gone for good | C (low) | `jobState` asks the exit file first (`jobs.ts:288-292`), used by `commandTaskAdapter.reconcile` (`task-effects.ts:250-251`) and `retainedJobResourcesClosed` (`jobs.ts:266-272`) [R]; untested. |
| a socket directory where tmux has never run is a free session name | A | DBOS always passes a retained session (`launchRetainedJob` `jobs.ts:248-253`), so the probe loop `jobs.ts:204-208` is unreachable dead code [R]. |

## interactive-runtime.test.ts (M; 1 case kept unchanged)

| case | class | evidence |
|---|---|---|
| agent transport close honors the {zero-argument, named-argument, legacy positional, host deadline, host recovery, pending/failed/other-session close receipt} contract (x8) | C | Same rule now at `task-interactive.ts:350-353` (finalizers = close commands *with* `arguments`; exemptions hostStop/hold/cancelled/deadline; only a completed close command on the same session counts) [R]; untested on DBOS [R]. Suggest the 8 scenarios as a table over `operateTaskInteractive` in `task-interactive.host`. |
| interactive runtime derives authority from Run/Ledger, single-writer, refuses spoofed completion | B (Ledger authority A) | `interactive-job.test` "one durable tmux Job preserves REPL state, single-writer receipts…" (token-bound completion) [R]; identity/actor/command conflicts, held mutation, stale owner in `task-interactive.host` [R]; confinement refusals `interactive-binding.test` "production evidence is enforced only after…" [I]. |
| a deadline that has fired is not fired again when re-projected | A | timer controller deleted; DBOS checks deadlines per call [R]. |
| an idle deadline moved later by completed commands is the one that fires | B | `task-interactive.host` idle recovery ("Newest retained activity must admit input after recovery", expired idle refused) [R]. |
| interactive close waits for the wrapper's own shutdown; a surviving tool is recorded and refused by the retry | C | `closeInteractiveJob` process-survived path `interactive-job.ts:717-768` via `task-interactive.ts:354`; survivor keeps the PG resource reservation (`recordJobStop` only releases on observedGone, `task-interactive.ts:292-296`) [R]. `interactive-job.test` covers only the probe/zombie helpers [R]. Suggest: Tcl fixture ignoring HUP/TERM with small `closeGraceMs`; assert `process-survived` with pid, resource not released, second open refused. |
| a survivor's process group is asked through the Site channel (silent tmux run-shell) | B (weak) | `interactive-job.test` "the process probe reads only 'no such process' as gone…", "a process group holding only zombies…" [R]. |
| a close waits through the declared close grace (30 s TERM shutdown) | C | `interactiveCloseGrace(derived.binding.limits.closeGraceMs)` `task-interactive.ts:305,354`, `interactive-job.ts:560-575` [R]; untested. |
| an input without waitMs records a completion within the call wait; held lease names the command to observe | C | Default `waitMs = callWaitMaxMs` `task-interactive.ts:302` untested [R]; DBOS lease refusal "observe its completion" (`task-interactive.ts:256`) **does not name the commandId** (review I1 text existed at `interactive-runtime.ts:465@af90e37d`) [R]. |

## delegation-recipe-budget.host.test.ts (M; H1 kept unchanged)

| case | class | evidence |
|---|---|---|
| H2a: a recipe-materialized Operator gets its Team member share, held only to the Run time box | C | Live: contract `budgetShare: member.budgetShare` (`durable-task-adapters.ts:513`), deadline `min(run.deadlineAt, now+maxElapsedMs)` (`native-task-adapters.ts:446`), request-scope `inlinePayload.scope` from the plan (`durable-task-adapters.ts:471-474`) [R]. `durable-task-adapters.host` "Workshop explicit observe…" uses request-scope but asserts only inputRefs/grant/done; per-turn token cap on the wire covered in `native-task-effects.host` [R]. Suggest: assert `member-options:operator` contract budgetShare equals the member share and `inlinePayload.scope` equals the plan scope, and a short-time-box Run's `child:<id>:intent.deadlineAt` equals the Run deadline. |

## jobs.test.ts (M; 2 channel cases kept unchanged)

| case | class | evidence |
|---|---|---|
| a local job is launched detached, runs, and its exit code comes back from the exit file | B | `task-effects.host` command protocol cases (successful Jobs collected) [R]. |
| a job that exits three records exit code three | B (weak) | `task-effects-worker.ts:218-219` `exit 2` -> failed, released; exitCode value not asserted [R]. |
| two launches of one job name keep their own log and exit code | A | DBOS session is per effect identity; logPath keyed on session (`jobs.ts:60`) [R]. |
| killing a running job leaves no session and records the stop | B | `task-effects.host` "known resident failure closes original {live,gone} wrapper resources…", `dbos-control.host` cleanup [R]. |
| a launch into a workspace outside the permit's write roots is refused before any command | B (weak) | Static: `pack.test` "a campaign whose workspace root is outside the permit's write roots…" [R]; runtime `launchRetainedJob` permit refusal `jobs.ts:250` untested [R]. |
| a launch whose first word is not an allowed wrapper is refused | B (weak) | Static wrapper fit `pack.test.ts:269`, `workshop.host.test.ts:49`, `pack-readers.host.test.ts:38` [R]. |
| a job name that would climb out of the workspace is made safe | A | names on DBOS come from Pack ids; files keyed on session [R]. |
| status on a session the run never launched answers gone | A | Ledger `jobStatus` face [R]. |

## fabric-licences.test.ts (M; "declares none" kept unchanged)

| case | class | evidence |
|---|---|---|
| a licence bounds a launch like the job cap: second run waits for the one seat | B | `task-effects-worker.ts:180` competitor waits `site-capacity`; `:201` two workflows never overlap physical Jobs holding the same licence [R]. |
| a pack whose tool holds an undeclared licence is unfit; the run is refused before launch | B | Same `packs.ts:3502` check via `workshop.host` "workshop-check-licence"; unfit refusal at `fabric.ts:368` precedes DBOS open [R]; run-refusal half not re-asserted [I]. |
| the shipped pack declares its Design Compiler seat and the local site declares one | A (static half B) | Legacy `/hima run` status text and Ledger meters; static fit `pack.test.ts:185` [R]. |

## Totals (parametrized groups counted once; 65 entries)

A 26 (of which A\* rule-drops 7), B 21, C 18.

# Part 3 — desktop + host faces

Classes: **A** dead protocol only · **B** live, still covered (named test) · **C** live, now uncovered.
Evidence tags: [R] verified by reading the current tree · [I] inferred.
I worked out the removed cases myself by comparing test names at base and head (74 cases across 23 files). Totals: **A 17 · B 34 · C 23**.

## Cross-cutting findings (affect several B claims)

- **Hollow B source: unified-workbench.test.ts.**
  - `preparation retries preserve drafts…` posts `POST /hima/api/observe` with no `sessionId` at line 373, then asserts `probe.run?.id`.
  - Since e23990e2, `observeOperation` (remote.ts:1171-1174) answers 403 without a live session. The test therefore fails before any of its Configuration or confirm assertions run [R].
  - `a Pack under authoring…` makes the same call at line 491, after its pack-option and material assertions. Its later assertions are unreachable [R].
- **Broken kept test: growth-assets.desktop.test.ts.** It drives a DBOS Run (startRun) through `support/growth.ts`:
  - It reads `executionContext(runId).run.control!`. That is the synchronous Ledger reader, and a DBOS projection row has no control [R].
  - It calls the actions `begin`/`work`/`complete`. fabric.ts:816 answers `unsupported` for these on a DBOS Run [R].
  - It cannot pass, so it is not coverage for revision assets.
- **Broken kept test: observe-ledger.test.ts** `the one gate refuses a bundled reader's value…`. It still opens its Run with `/hima observe`, which commands.ts:471 now always refuses. Its claimed bundled-reader gate coverage never runs [R].
- **Product gap: `/hima status` on a DBOS Run.** The command reads only the Ledger projection (commands.ts:518-523 → describeRun at 238).
  - A DBOS Run's Ledger row has no status, meters, node records, observations, loop or fork (ledger.ts:1972-1995).
  - So every status line that the removed `/hima status` cases asserted (meters, latest reading, loop, fork, knobs, generation) cannot appear for a new Run [R].
  - The cases were rightly classified A as legacy. The command itself is live and now says almost nothing about DBOS Runs.
- **Empty test file still in a group:** pipeline-stages.test.ts is now 38 lines of comments with no test, and is still listed in the desktop group [R].
- **Possible further broken test (not in my scope; checked only by grep):** campaign-graph.desktop.test.ts replays `hima_execute action:'begin'`.

## pack-readers.test.ts (deleted, 5)
| case | class | evidence |
|---|---|---|
| pack script shipped+launched under permit, values validated, card names reader/file/hash | B (weak) | [R] input-admission.host `reader and tool paths preserve spaces…` runs installPackReader `count-candidates` through DBOS (durable-task-adapters.ts:216-238) and asserts the observation exists. durable-task-adapters.host (worker l.27-56) runs a frozen Pack Reader script. **Not asserted anywhere:** the reader record `file`/`sha256` on DBOS, and the qualifier values. The card line `read by …` (HimaRunCard.tsx:632) has no test. |
| adds undeclared type / misses declared type / drops qualifier → refusal | **C** | [R] Live: durable-task-adapters.ts:190 → observe.ts:71 → semantics.ts:344-351 (emits checks) and 339-342 (qualifiers). No test at any level. Only validateReading null-without-reason is tested (observe-ledger l.146). Suggest a host test: installPackReader variants + `confirmAdmission`; assert the observe task ends failed/waiting with the validator sentence and readRunRecords holds no observation. |
| unknown key / string number refused by the one gate | **C** | [R] Same path: observe.ts:72-73 (`semanticValue` strict parse). The only remaining test is observe-ledger l.334, which is broken (see above). Same suggested test. |
| reader exit non-zero → failed attempt, retry, blocker | **C** (retry/blocker part A) | [R] For the explicit observe node, `builtin/observe` → readerAdapter → commandTaskAdapter failed (task-effects.ts:251) → flow-workflow.ts:256-258 failed outcome. Nothing tests this. The resident collectReader path is covered (durable-task-adapters worker l.177-191 `reader-rejected`). Suggest: the same host test with a script that runs `exit 2`; assert the failed task reason and that the retained log holds the script's stderr. |
| bundled reader held against the Pack's own unit | **C** | [R] durable-task-adapters.ts:207-213 bundled branch + `semanticsOf(m.pack)` at :190. No test. Suggest a host test with installPackReader `emits cell_area` redeclared in `count`; expect the "measured in" refusal. |

## revision-assets.desktop.test.ts (deleted, 1)
| case | class | evidence |
|---|---|---|
| superseded Workshop version readable beside current revision + archived report in native workbench | **C** | [R] The DBOS view (durable-views.ts:49-110, 147-153) projects no `revision` records, so `view.revisions` is never set. As a result, `run-revisions` (HimaRunCard.tsx:798) and the material "superseded" label (:704) cannot render for a DBOS Run; only the task-level "superseded revision" text (:454) can. `archive-verify` / `archive-content` (:756) have no test anywhere. growth-assets.desktop is broken (see above). revision.host checks flow semantics only. Suggest: a host test that revises a DBOS Workshop task (as revision.host does), then reads `/runs/<id>` plus the material and archive routes for old and new code. Add a desktop test only for the Evidence view. |

## start-form-window.test.ts (deleted, 2)
| case | class | evidence |
|---|---|---|
| rapid Pack selections, out-of-order responses keep latest strategy and typed inputs | **C** | [R] The server form is dead. The native ConfigurationPage.tsx (save queue and server snapshot, l.271-360) has no race test. A desktop test is appropriate (a real response race in the window). |
| rejected form retains input, permits correction, one Campaign despite repeated submit | **C (hollow B)** | [R] This would be covered by unified-workbench `preparation retries…` (failed save keeps input, Confirm disabled, one Campaign on a double click), but that test fails at its observe probe, line 373, before reaching these assertions. Host-level validator refusal: start-form.test `stale preparation and changed Strategy or Budget are refused` (B). Fix: drop or session-bind the probe. |

## driver.test.ts (deleted, 2)
| case | class | evidence |
|---|---|---|
| shell driver mode: card regions off the /hima/ page agree with the route | A | [R] The server page was removed (4dee99f0). |
| audit routes report the commands sent to the Site | A | [R] `/hima/api/audit` always answers 403 (e23990e2). |

## honest-standin.test.ts (deleted, 1)
| case | class | evidence |
|---|---|---|
| timing-push loosens by guard band to the limit; over-constraining converges below; goal-met at generation 2 | **C** | [R] The chooser trajectories and the convergence ending run through choosers.ts:328-456 and durable-task-adapters.ts:317-319. No unit test of `choose`/convergence, no DBOS run of timing-push, and no `ended-converged` on any DBOS route (grep). Goal-met at generation 2 is B (aes-research-durable.host). Suggest a host test: a DBOS timingProbe generation-limit 6 Run and an installLegacyTimingPush Run, asserting periods per generation and the ending. |

## honest-standin-window.test.ts (deleted, 1)
| case | class | evidence |
|---|---|---|
| start form opens converged Run; window shows decision | A | [R] Server start form. The native decision display falls under the generations-table C (loop.test). |

## experience.test.ts (deleted, 1)
| case | class | evidence |
|---|---|---|
| goal-met Campaign leaves both report files with hashes on record, numbers as on the card | B | [R] durable-views.host `DBOS automatically delivers generic reports and binary archives across restart`, `completed DBOS revision serves its new report while preserving old hashes`. Report content: experience-report.test. Weak point: "every card number in the json" is not cross-checked. |

## ledger-version.test.ts (deleted, 1)
| case | class | evidence |
|---|---|---|
| older-version HimaLedger refused at next open, untouched | B | [R] ledger-import.test `opening the original v19 home still fails the version gate without rewriting it`, at host level. The desktop shell's own wording "The hima profile did not start" is no longer asserted (weak). |

## moment.test.ts (deleted, 1)
| case | class | evidence |
|---|---|---|
| key in launching env reaches no file under home | **C** | [I+R] The standalone moment is dead, but the property is live for every DBOS native session (Workshop or Guide). The local groups have no scanForSecret over a home after a native model turn: moment.host keeps only the scan-helper cases, and child-compaction is live-model only. Suggest: native-task-effects.host style with `DEEPSEEK_API_KEY=hima-fake-<uuid>` and replay, then `scanForSecret([home], key)`. |

## workshop.test.ts (deleted, 8)
| case | class | evidence |
|---|---|---|
| workshop moment with three tools writes a script; Fabric runs it; next node observes | B | [R] native-task-effects.host `native Workshop code -> retained program -> existing Reader…`; aes-research-durable.host. |
| replayed write leaving the workshop dir refused, recorded, good write lands | **C** | [R] workshop.ts:465/489 (`is outside the workshop directory`). No DBOS-scope test (grep). Suggest: native-task-effects style, `hima_workshop_write {path:'../x'}` and a symlink target. |
| second write = second version; both records; Job runs later bytes | B | [R] native-task-effects.host l.60-81 (multiple versions; latest runs; changed replay refused). The card count of versions is not asserted (weak). |
| script exits non-zero spends allowance, blocks with tail, resume opens fresh moment | B | [R] branch-autopilot.host `normal Workshop automatic repair: allowance-refused`/`fallback-*`. Resume is A. |
| host taken away while moment open | B (weak) | [R] native-task-effects (cold Host reopen during revisions); task-effects.host `DBOS SIGKILL after … fact`. |
| host taken away while Job runs: no second moment/code | B | [R] task-effects.host `DBOS SIGKILL after ${phase} fact resumes … one original Job`. |
| workshop dir resolving elsewhere blocks node, opens no moment | **C** | [R] durable-task-adapters.ts:437 (`Workshop directory aliases protected`). No test. |
| gap between launch record and node record settles same attempt | A | [R] Ledger record ordering of the retired driver. |

## budget.test.ts (M, 5 removed)
| case | class | evidence |
|---|---|---|
| time box spent in generation 2 kills Job, ends naming box | B | [R] dbos-flow.host `independent original hard deadline closes Job…`, `held two-hour Run bounds durable receipts…`. The "names the box" wording is weak. |
| retry allowance spent blocks; resume gives a fresh one | A (+B) | [R] Per-node allowance with resume is legacy. DBOS repair: view-run `a known failed and physically closed task is repaired … original budget`. |
| licence bounds launch; second Campaign waits for the seat | B | [R] task-effects.host `declared Pack command protocol…` (worker l.174-180 competitor `site-capacity`); `undeclared inherited licence properties…`. |
| card meters region shows every meter of a running Campaign | **C** | [R] HimaRunCard.tsx:143-158 (`meterRows`) over the DBOS view (durable-views.ts:150-152, records without node or blocker rows). Only the bundle-string test remains (budget.test l.18). Suggest: a host test reading `/runs/<id>` meters/budget of a running DBOS Run plus a pure `meterRows` check; desktop only for rendering. |
| `/hima status` prints meters | A | [R] Ledger-only. See the status gap above. |

## desktop.test.ts (M)
| case | class | evidence |
|---|---|---|
| explicit Desktop Quit keep-jobs/stop-jobs preserves Campaign and reports Job disposition (x2) | B | [R] host-lifecycle.host `Keep jobs exit and reopen retain…`, `Stop jobs closes the original durable process without cancelling the Run…`, `a delayed App stop worker respects ${disposition}`. Weak: no real-Electron `d.quit('keep-jobs'/'stop-jobs')`; only `drain` (agent-execution.desktop). |
| (removed assertion) fresh home run-list read | A | Server page. |

## drill-down.test.ts (M, 4 removed + 1 assertion block)
| case | class | evidence |
|---|---|---|
| explore opens own loop, converges, outer takes labelled edge | **C** | [R] flow-compiler.ts:376-384 and durable-task-adapters.ts:272-279. Only compile tests exist (flow-compiler.test `legacy finite matrix…`, `legacy opened loop Judge…`). Suggest: a host DBOS Run of `installDrillDown`. |
| inner loop runs out of generation limit, outer takes that edge | **C** | [R] As above. |
| cancel inside inner loop ends whole Run, loop record intact | **C** | [R] As above. Generic cancel is covered (agent-controls.host), but not inside an opened loop. |
| host taken away inside inner loop | B (weak) | [I] Generic DBOS restart (dbos-flow.host, task-effects.host); nothing loop-specific. |
| (kept case) `/hima status` says which loop | A | [R] Ledger-only status. |

## fork-join.test.ts (M, 8 removed)
| case | class | evidence |
|---|---|---|
| fork under cap 2 runs both at once; join judges each branch | B | [R] fork-join-judge-durable.host (per-branch verdicts, consolidated Judge); dbos-flow.host `…parallel…`. "At once" is not asserted (weak). |
| cap 1 runs serially; says which waited for a slot | B (weak) | [R] task-effects worker `site-capacity`. No fork-specific display. |
| branch spends allowance, blocks only itself; resume re-enters | A | Legacy resume. |
| cancel while both branches hold Jobs stops both | B | [R] agent-controls.host `durable cancel control retains actual branch/resource/business facts`. |
| host taken away while both hold Jobs | B (weak) | [I] Generic DBOS restart. |
| site unreadable inside fork leaves run as is | A | Legacy driver polling. |
| two blocked branches take two resumes | A | Legacy resume. |
| `/hima status` lists fork branches | A | Ledger-only status. |

## loop.test.ts (M, 10 removed + 2 assertion blocks)
| case | class | evidence |
|---|---|---|
| reachable goal: revisit, goal met at generation 2, records carry generation | B | [R] aes-research-durable.host `DBOS two-generation research Workshop…` (verdicts by generation, ended-goal-met). |
| unreachable goal ends converged naming rule | **C** | [R] choosers.ts:414-456; no test (see honest-standin). |
| move of exactly the band keeps exploring | **C** | [R] choosers.ts:447 (strict `>=`); no unit or DBOS test. A pure `choose()` test is enough. |
| generation limit runs out, untried strategy on record | B | [R] view-run `the run view carries the whole path…` (`outcome generation-limit`, `chosen.strategy 2.15`). |
| explore leads nowhere: one generation, goal not met with next strategy | B (weak) | [I] durable-task-adapters.ts:317-319; same view-run shape. |
| host taken away mid-generation 3 | B (weak) | [R] dbos-flow.host `held two-hour Run … resumes … after Host restart` (not multi-generation). |
| cancel mid-generation 3 stops Job, all generations on record | B (weak) | [R] view-run `current human pause and continue… cancellation physically stops its sleeping Job` (one generation). |
| generations table one row per generation (converged) | **C** | [R] HimaRunCard.tsx:928 `run-generations` via generationsOf over DBOS records (durable-views.ts:150), which hold no node or decision rows. No test of DBOS `view.generations`; only the bundle string. Suggest a host test asserting `/runs/<id>.generations` for a multi-generation DBOS Run. |
| goal-met Campaign shows a row per generation | **C** | [R] Same. |
| banner says goal/strategy in the Pack's words with units | B (weak) | [R] historical-words.host (historical); unified-workbench `a native declared improvement Goal shows its units…` (DBOS). |
| (kept) `/hima status` generation; `/hima run` paragraph | A | Ledger-only and retired. |

## strategy.test.ts (M, 3 removed + 1 assertion block)
| case | class | evidence |
|---|---|---|
| two knobs on start form carried by name through row, decision, card, report | B (weak) | [R] view-run and input-admission carry a one-knob strategy. Two-knob, report or card carry is not asserted. |
| out-of-bounds knob refused in validator words, no Run | B | [R] start-form.test `stale preparation and changed Strategy or Budget are refused…`; input-admission `a chooser candidate outside Strategy bounds…`. |
| `/hima run --set` + `/hima status` knobs | A | Retired face and Ledger-only status. |
| (kept case) startRun refuses a words-failing Pack before any Run row | B (weak) | [I] The startRun → checkPack gate is generic (input-admission `unfit`). Nothing checks the words gate at start. |

## window.test.ts (M, 7 removed + 1 assertion block)
| case | class | evidence |
|---|---|---|
| fill start form, Run carries form Goal and Budget, card opens | B | [R] campaign-graph.desktop `…confirms one proposal, sees the complete graph…`; unified-workbench `a native declared improvement Goal…starts with the exact value`. |
| knob/time box refused in validator words | B | [R] start-form.test (as above); unified-workbench l.532 (precision loss). |
| cancel while Job sleeps → cancelled, observed stop, tmux gone | B | [R] Host level: view-run `…cancellation physically stops its sleeping Job…`. The desktop path is hollow (unified-workbench probe). |
| hard-blocked Run shows blocker + failed Job log tail; resume carries on | B | [R] view-run `a known failed and physically closed task is repaired…` (log-tail route shows the failure text). The desktop path is hollow. |
| refusal leaves its words on card, control still clickable | **C** (low) | [I] No native card test of a refused control's message and a retry. Only durable-ui-display `a later control epoch…` (pure). |
| one token sheet, dark palette, no colour outside | B | [R] client-style.test (token sheet, no inline styles). |
| 900 px window: nothing wider than the window | **C** (low) | [R] No overflow or width test for the native workspace (grep scrollWidth: none). |
| (kept fence case) run-list read | A | Server page. |

## pipeline-stages.test.ts (M → empty, 4 removed)
| case | class | evidence |
|---|---|---|
| form offers released Pack plain and authoring Pack marked; run = campaign vs test | B | [R] unified-workbench `a Pack under authoring…` (option `test pack (intent)`, purpose `test`; asserted before the broken probe). |
| one unreadable folder marked with path, unchoosable; readable starts | B | [R] Same test (broken-pack disabled, `unreadable`). |
| every folder unreadable: offered, unchoosable, start starts nothing | **C** (low) | [R] No all-unreadable Configuration test. campaign-workspace state 1 covers only the empty home. |
| whole pipeline grill→release, produced Pack runs from form | B (weak) | [R] skills.test (grill/spec), pipeline-stages.host (fabric), pack-test-admission.host (DBOS TEST, release), report-only-seal.host. No single end-to-end run. |

## moment.host.test.ts (M, 5 removed)
| case | class | evidence |
|---|---|---|
| moment on stand-in node brackets pair | A | Standalone moments are refused on DBOS (conversation-execution.host `a prepared DBOS product Run refuses standalone moments…`). |
| moment on ended Run leaves generation rows | A | Same. |
| host taken away mid-moment, closed interrupted once | A | Same. |
| moment route refusals (404/400/405) | A | [R] The DBOS refusal is B via conversation-execution.host. The legacy error shapes are dead. |
| refusing model → moment closes failed | A | Same. |

## pack-readers.host.test.ts (M, 1 removed)
| case | class | evidence |
|---|---|---|
| `/hima status` names reader of latest reading | A | [R] commands.ts:331-332 reads Ledger observations, which DBOS Runs never have (status gap). The card counterpart (HimaRunCard.tsx:632) is untested; see pack-readers case 1. |

## site-surface.host.test.ts (M, 1 removed)
| case | class | evidence |
|---|---|---|
| Case 4 log-tail route for running node; empty for node with no Job | B (weak) | [R] The DBOS branch is index.ts:1487-1500. Covered by view-run l.263 (failed Job tail through the route) and durable-views-worker l.343 (finished-Job session). Not covered on DBOS: a *running* node tail, a node with no Job → empty, 404 for an unknown Run, 400 for lines>100. FabricNode.tsx:175 polls this route live. |

## skills.test.ts (M, 1 removed)
| case | class | evidence |
|---|---|---|
| installed authoring compiles a Workshop whose real local Job computes the output and reader records it | **C** | [R] The whole case was deleted although only its final `/hima run` was legacy. Now uncovered: `prepareHimaHome({bundleMode:'installed'})` with skills resolved from the installed package and no `src`; `/hima-fabric` in installed mode; pack check refusing a removed reader or an undeclared wrapper; an authored Workshop Pack producing `scaled_sum 42`, a code record and a PASS verdict; and no TEST.md or VERSION.yml fabricated (grep `bundleMode`: none). Suggest restoring it with `startRun`/`confirmAdmission` in place of `/hima run`. |

## pipeline-stages.host.test.ts (M, 1 removed)
| case | class | evidence |
|---|---|---|
| /hima-test runs Pack as test Run, writes record; /hima-release seals; changes refused | B | [R] pack-test-admission.host `Pack check reads a normally ended DBOS TEST Run and refuses a false Ending before sealing`; report-only-seal.host; pack-method-assets `…tested, released and re-released…`; trial-package (`no longer hashes`). Weak: the `/hima-test` skill is not driven by replay against a DBOS Run. |

# Part 4 — fabric / experience / AES / ATCS

Classes: A = dead protocol only; B = live and covered elsewhere; C = live and uncovered; GAP = the behaviour the old test asserted is not produced for DBOS Runs at all (product question, not just coverage).
Evidence tags: [R] verified by reading; [I] inferred.

Key DBOS facts used throughout (all [R]):
- A failed command Job is not retried. `flow-workflow.ts:257` returns `failed`. `retryAllowance` only feeds the Workshop brief (`durable-task-adapters.ts:402`).
- A Job that is gone without an exit file becomes `effect-unknown`, the Run waits, and nothing is relaunched (`jobs.ts:288-293`, `task-effects.ts:264`).
- When the deadline passes, the Run's Jobs are closed and the outcome is `waiting` (`flow-workflow.ts:265-272`). A DBOS Run status is never `ended-budget-exhausted` (`durable-fabric.ts:56-57`).
- The report is finalised only for `succeeded` and `cancelled` outcomes (`flow-workflow.ts:484`).
- Every DBOS Run has `control`, so `/hima cancel` (`commands.ts:538`), `hima_cancel` (`tools.ts:1004`) and `POST …/cancel` (`remote.ts:1471`) all refuse it. The live cancel path is `executionAction` cancel (`fabric.ts:836-840`).
- `resumeRun` always answers `unresumable` (`fabric.ts:496-501`).

## fabric.test.ts (deleted, 14)
| case | class | evidence |
|---|---|---|
| one generation launch/read/judge/decide, generation limit ends with next strategy | B | fork-join-judge-durable.host "DBOS fork Explore: a failing consolidated reading is not rescued…" (strategy 2.25, generation-limit, ended-goal-not-met); durable-task-adapters.host "legacy declarations use frozen Reader/Judge/chooser…" (periodNs 1.75, generation-limit) [R] |
| generation meets goal → goal-met, no next strategy | B (weak: absence of a next strategy not asserted) | fork-join-judge-durable "…passing consolidated reading ends goal-met" [R] |
| spent time box kills running Job, no tmux, ends budget-exhausted naming meter | C + GAP | Job closure at the hard deadline is covered only at flow level: dbos-flow.host "independent original hard deadline closes Job…" [I]. No Host-level DBOS Run ever reaches its time box. "budget-exhausted" is unproducible and no report is written (`durable-fabric.ts:56`, `flow-workflow.ts:484`) [R]. Suggest: startRun with a 60 s box and a sleeping tool; assert the session is gone, the Run's terminal state, and whether a report is delivered |
| chooser this harness does not ship → refused before Campaign | B | pack.test "a pack naming a chooser that does not exist fails the check" (same checkPack gate `fabric.ts:353,370`) [I] |
| act node asking for an absent Goal → refused before Run/Job | C | live at `packs.ts:2020` (loadPack) → `fabric.ts:342-345`; no test contains "undeclared Goal parameter" [R]. Suggest a pack variant `{from: goal, name: no_such}` → startRun throws naming it; no PG Run, no Job |
| fault thrown mid-drive → blocked node carrying the message | B (weak) | DBOS adapter error → task failed with its reason (`flow-workflow.ts:243-247`); dbos-flow.host 'flows'/required → failed (worker:255); task-effects matrix known-failure [R]. Not asserted that the Host view carries the message |
| POST /hima/api/runs answers mid-drive fault as hima/internal | A | start returns before execution; nothing is driven in the request |
| waiting backs off; launch still in channel audit | A (audit route removed) / backoff B | dbos-flow "held two-hour Run bounds durable receipts…" [R] |
| hima_run tool starts the same run as the command | A | `/hima run` is a refusal (e23990e2) |
| command and tool faces refuse a number in the same words | A (command face) | tool refusal: input-admission.host "confirmed tool inputs reject invalid Goal values…" [I] |
| --time-box that converts to an out-of-schema ms value is refused on every face | C | live `fabric.ts:386-388`, Campaign file `index.ts:1636-1638`; no test references the bound [R]. Suggest campaign-file.host with timeBoxMinutes 1e15 and 0.000005: refused naming the ms, no Run, Home reopens |
| POST /hima/api/runs behind session fence; view carries status/goal/…/decision | B (weak) | durable-views.host "ordinary Host HTTP reads PG Campaign facts…"; guide-context.host route fence [I] |
| /hima status reports status, node, node states, meters, decision | B (weak) | historical-words.host and guide-context.host:277 (success only) [R]; DBOS node states not asserted |
| records and run state read back unchanged after a Host restart | B | durable-views "DBOS automatically delivers generic reports… across restart" (delivery-restart, same shas); dbos-runtime "interrupted PostgreSQL…" [R] |

## fabric-restart.test.ts (deleted, 20 including the reader ×2)
| case | class | evidence |
|---|---|---|
| Host disposed while Job sleeps; new Host finds the same Job; nothing launched twice | B | task-effects.host "DBOS SIGKILL after submitted fact resumes stable operation order and one original Job" (calls-crash == once) [R]; host-lifecycle "Keep jobs exit and reopen…" [I] |
| Job finished while Host down, read from exit file | B | same SIGKILL test (the Job ends while the worker is dead) [I]; durable-views "known command exit survives durable Job projection" [R] |
| Job gone without exit file → failed attempt, Run waits naming it | B (weak, new semantics) | DBOS: `effect-unknown`, waiting, no relaunch. task-effects matrix 'unknown' (fixture flag, not a real vanished session) [R] |
| Host boots onto vanished Job and retries under allowance | A | no retry in DBOS |
| cancel during reconciliation keeps the person's ending | A | reconcileRuns deleted |
| /hima cancel stops sleeping Job, records request and stop | A (face refuses) / physical B | dbos-host-authority.host "one failed conversation restoration does not block … its physical cancellation" (stopState.closed); agent-controls.host "durable cancel control…" [R]. `/hima cancel` refusal text untested |
| cancel while /hima resume waits | A | |
| hima_cancel stops the same Job | A | refusal covered by conversation-execution.host:168 [R] |
| cancel during launch leaves nothing running | B | dbos-control.host "concurrent valid main/control closure…" and "concurrent main/control cleanup…"; task-effects "prepared-intent crash preserves human pause…" [I] |
| cancel after ledger settled the Job writes one blocker | A | blocker records are legacy |
| launch accounted but still on Site is stopped by cancel | B | agent-controls 'cancel' (cleanup closed, leases released, worker:360-366) [R] |
| cancel of an already-ended Run answers its status and writes nothing | C | live `recovery.ts:33-34` and the control path `fabric.ts:836-840` on an ended Run; no test [I]. Suggest: let the Run end, then executionAction cancel and Host.cancelRun; assert the answer, no new control fact, unchanged outcome/report |
| POST …/cancel stops a Job a new Host picked up, behind the fence | A | `remote.ts:1471` refuses controlled Runs |
| workspace-prep fault recorded against the Run | C (low) | DBOS preparation workflow `durable-fabric.ts:140-150`. durable-fabric.host covers only occupied and interrupted preparation, not a copy fault (unreadable source) surfacing as the Run reason with no Job [I] |
| missing workspace permission refused before a Run | B | pack.test:1423 "a campaign whose workspace root is outside the permit's write roots is refused before anything is created" (`packs.ts:3120`) [I]; reopen half is A |
| Run with no fabric state picked up by next Host | A | |
| restarted Reader keeps its launch declaration (unchanged source) | B (weak) | frozen method: durable-task-adapters.host "bridge hydrates its frozen method after actual process kill with the current folder unavailable" [I]; Reader version/emits not asserted |
| restarted Reader refuses a rewritten report | C | `durable-task-adapters.ts:234-236` ("changed while it was read"). Untested anywhere, and since 641587f2 the Reader reads the live `${REPORT}` [R]. Suggest a Reader that appends to `${REPORT}` (or a test that rewrites it mid-read) → task failed matching /changed while it was read/, no observation |
| observe node launched with no recorded reading | A | |
| cancel that never saw the Reader's Job, between polls | A (poll protocol) | analogue: dbos-control "concurrent valid main/control closure retains first proof, one release and verified delivery" [R] |

## fabric-retry.test.ts (deleted, 13)
| case | class | evidence |
|---|---|---|
| fail twice, third succeeds under allowance | A | no command retry in DBOS. NOTE: `retryAllowance` is still stored on the Budget (`fabric.ts:364`) and accepted from the Campaign file and the UI, but it does nothing for tool Jobs: a vestigial knob |
| exceed allowance → blocker with last exit and log tail; resume | A | DBOS failure carries the exit: task-effects matrix known-failure (exit 2 → failed, lease released) [R]; the log tail is not carried in DBOS |
| resume answers clearly and writes nothing on ended/running | B (weak) | conversation-execution.host:174-175 hima_resume → unresumable [R]; "writes nothing" not asserted |
| hima_resume clears the same blocker | A | |
| POST …/resume clears a blocker behind the fence | A | |
| Site Job cap across Runs; second waits for a slot | B | task-effects matrix 'competing' → site-capacity, then succeeded after release (licence slot) [R] |
| attempts survive a Host restart | A | attempt budget analogue: dbos-flow "original attempts authority includes dependent child effects" [I] |
| tmux session vanishes → retried at once | A | DBOS: unknown/waiting (see restart row 3) |
| two Runs at the same instant vs a cap of one | B (store level) | task-effects matrix "Two actual workflows cannot overlap physical Jobs holding the same licence"; raw leases "share the ordinary actual Site Job cap" [R] |
| resumed after the time box still gets its generation | A | |
| Job launched by hand holds the only slot | A | `/hima job launch` refused |
| case-variant Site name refused as unknown | A | face removed |
| waiting Run with spent box refused resume in same words | A | |

## experience.host.test.ts (deleted, 9)
| case | class | evidence |
|---|---|---|
| goal met: both report files, hashes on Ledger, numbers in JSON | B | durable-views "DBOS automatically recovers report interruption after Markdown before JSON" (markdownSha/jsonSha on record) and "…delivers generic reports…" [R]; "every number the card showed" not asserted |
| stopped learning → convergence rule as reason | B (weak) | live (`durable-fabric.ts:57`, `experience-report.ts:399,487`); unit only: experience-report.test status loop [R]; no DBOS converged Run end-to-end |
| Budget meter ending names that meter | A / GAP | unproducible on DBOS (see time-box row) |
| person cancelled → report written at the cancel, observed stop as reason | C | live `flow-workflow.ts:484` (cancelled is finalised). Unit only: experience-report.test "cancelled durable report preserves its ending…" [R]. No Host test delivers a report for a cancelled DBOS Run. Suggest: start, cancel through executionAction, wait for readExperience 'read' with ending cancelled and the stop sentence |
| second Host re-serves, does not rewrite | B | durable-views delivery-restart (same reportSha, worker:205-208) [R] |
| served as markdown to a session; refused without one; refused when changed; Site fault when gone | B (weak) | guide-context.host:195-196 (fenced routes), durable-views-worker:300-301 (served) [R]; tamper and gone covered only for historical Runs (experience-files "offline report request … still refuses changed bytes") [I] |
| ending stood while Site refused the report → next Host writes it | B | durable-views "DBOS resumes generated no-artifact archive rename with Site report refused"; durable-finalization-retry "original Host finalizer … retries a one-time … failure" [I] |
| /hima status names the report's two files | GAP / C | `commands.ts:397` reads Ledger `experience` records. DBOS deliveries are PG flow facts (`durable-views.ts:201-227`) that reach the Ledger only as `interactive` records (`ledger.ts:1973-1977`), so the lines never print for a DBOS Run [I] |
| stopped while waiting carries Hard blocker and log tail into report | A | blocker records are legacy; a DBOS Run with a failed task stays `waiting` with no report until cancelled |

## workshop.host.test.ts (M: 4 removed; the kept case is byte-identical [R])
| case | class | evidence |
|---|---|---|
| landed write the Ledger would not record named in answer/log/node | A | Ledger Workshop path |
| Host log throws where the landed byte is reported | A | |
| Job launch record names its attempt (ledger object) | A | |
| retry moment given the previous failure and log tail | A + dead code | `workshop.ts:749,780` `previous` is never set in production; the DBOS brief at `durable-task-adapters.ts:403` omits it [R] |

## aes-full-graph.host / aes-probe (M) / aes-timing-research-reader (M) (from the AES sub-review, [R] unless noted)
| case | class | evidence |
|---|---|---|
| full AES graph, native owner, evidence-review branch | B with C sub-gaps | aes-full-graph-durable.host "DBOS drives the complete AES graph…" (probe goal-met, 6 merge-join PASS, final-judge, 6 code shas, goal-met). C: Workshop `read` contents never asserted (`workshop.ts:320-341`); the judge-bearing growth fragment (`fabric.ts:839` → `durable-fabric.ts:367-377`) is never executed on DBOS. Dropped: `HIMA_AES_CAPTURE_OUT` evidence, which orphans `scripts/finalize-aes-full-method.ts`. Weak: jobs-launched > 6 |
| released v2 probe × goal-met / goal-missed / missing-measurement | B | aes-probe-durable.host: verdicts citing the reading, values [0.5,0,1024], next periodNs 0.49. goal-missed now asserts generation-limit / ended-goal-not-met, not budget-exhausted. Kept cases unchanged |
| two-generation research Workshop FAIL→PASS | B (weak) | aes-research-durable.host: gen1 [FAIL,PASS] → gen2 [PASS,PASS], 2 code shas, knowledge read. Weak: baselineCode read result unused; chooser `algorithmRevision 1` unasserted. Kept cases unchanged |

## ATCS files (from the ATCS sub-review, [R] unless noted). Current Pack is 0.4.0: five tasks; no fork, Team, analysisContract, refresh gate or generation limit
| case | class | evidence |
|---|---|---|
| dry-path 0.2.0 six branches, two refreshes, generation limit, seal | A (seal generic: pack-test-admission.host) | legacy 0.2.10 snapshot + autopilot |
| dry-path 0.2.0 generation limit 3 at refresh gate | A | no such node in 0.4 |
| dry-path 0.2.0 timing-only analysisContract override | A for ATCS | the generic input override is live (`fabric.ts:324` → `durable-fabric.ts:86`), but nothing asserts it reaches argv [I] |
| dry-path 0.3 production adapter, Goal false | A (owner protocol) / B (weak) | atcs-resident-durable "…honest residual timing…" |
| 0.3.3 ending: clear / residual / known-collateral | B (weak) | atcs-resident-durable clear & residual; atcs-known-collateral-durable |
| expert Operator through the Team seam | A for ATCS; generic B (weak) + C | task-interactive.host "PG Operator retains Tcl identity, mutation scope…" (3 admitted, 4th refused) writes the grant directly, not through a Team. C: refusal of an out-of-scope command (`task-interactive.ts:109`) is unasserted |
| L4 Operator qualification (live) | A | No live ATCS qualification is valid any more. resident-engineering(.release).live still drive `begin`, which DBOS refuses; both stay green because they skip |
| six self-driving worker branches (agentic-timing-closure-system) | A | kept cases unchanged |

## Other files
- ledger-import.test.ts (M): no case removed. The fixture uses `Host.observe` instead of `/hima observe` [R].
- trial-package.test.ts (M): no case removed. One case is renamed, and its `legacy:true` assertion is replaced by a stronger one (the source tree also refuses an active legacy Home) [R].
- support/node-launch-crash.ts: A. Only node-jobs.host used it, through the deleted `launchJob` [R].
- test/contract-groups.json: each of the 36 removed entries is a deleted file. No existing contract test is ungrouped and no group entry is missing. The new files are placed correctly: aes-*-durable and fork-join-judge-durable in `local`; atcs-known-collateral-durable and atcs-resident-durable in `atcs-dry` [R].

## Replacement-test defects
1. atcs-resident-durable and its worker write into repo-root `.hima-tmp/dbos-migration/u8/dry/` without creating it (test:34; worker:94,115,140). The test fails on a fresh clone ("child exited without result"). This predates the refactor, but the file now carries the clear and residual cases alone.
2. ATCS workers send hard-coded `productModelCalls:0`, `sshCalls:0` and `edaCalls:0`, which the tests then assert: a tautology. The old Job command-line scan for pt_shell/innovus/starrc is gone.
3. atcs-resident-durable accepts any status starting with `ended`; atcs-known-collateral asserts only that `experience.kind` is `read` (the old case checked research.conclusion and the report text). Inferred: a 0.4 DBOS Run has no verdicts, so the report conclusion is `insufficient-evidence` even when the Goal is met.
4. AES ports: the Workshop read contents, the chooser revision value, the judge growth fragment and the Reader-mutation guard are all unasserted (see the AES rows).
5. Stale: test/contract/support/growth.ts:36-44 still drives begin/work/complete, so growth-assets.desktop is stale [I, sub-review]. Docs still cite atcs-dry-path in docs/specs/resident-engineering-agent/IMPLEMENTATION-MAP.md:75 and sites/linglong-atcs28/README.md:509.
