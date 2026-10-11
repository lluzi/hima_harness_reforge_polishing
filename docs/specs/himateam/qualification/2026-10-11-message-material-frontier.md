# Directed messages and authorized task materials

Scope: #102 persistent Host communication and task/member UI; #103 native DSH intake, retained originals/parser evidence, task links and authorized streams. #100 C7/C8 service/Settings changes are a reviewed partial, with full installation still open. Baseline `40590a3e8fc571b238ea31baff4252d664127d63` is remotely verified and includes approved documents and inherited LibInsight commits.

## Implemented behavior

Host resolves Human, Guide and member provenance. PostgreSQL transactions recheck persisted project/task/run/effect/member/generation/capability/expiry/revocation. One transaction admits message request/digest, pending recipients and authorized material links. Native dispatch intents are persisted as unknown before external calls; concurrent claims have one winner, lost responses require native observation, and stale callbacks cannot overwrite current evidence. Production native transport remains unavailable until #101. No independent scheduler, broker or IM was added.

Task/member pages use bounded retained facts. Draft editing and navigation never send execution controls. Native receive evidence is separate from business completion; missing transcripts remain missing. Explicit member question/handoff/review facts form pending human requests and exact replies clear them; automatically approved ACP events do not fabricate pending approvals.

Native DSH uploads retain exact byte authority independent of live Agent-scoped receipts. A task stage stores the original/hash before parsing; corrupt/no-text/partial/unsupported statuses retain the original. Message send grants task links; draft removal preserves sent versions. Authorized Host/native streams use durable file references, never absolute host paths as cross-sandbox authority. The existing Workshop knowledge behavior remains covered.

## Evidence and limits

Workers used GPT-6.1 Sol/medium, fresh isolated worktrees, no recursive delegation or commits. Integrator and reviewers use Sol/high. Product model/EDA/SSH calls are zero in this qualification; development usage was not measured.

Actual Playwright Electron scenarios passed 2/2, zero skips (16.008 seconds, two independent Electron/Host lifetimes). File input/upload, parsing and unsupported states, same-hash original streams and excerpts, message send links, same-name revision/removal, reload rediscovery, draft navigation, pending receipts and missing native trace were observed. Own Home/database/ports/userData/PIDs were isolated and closed; no exclusive display was used.

Real Host/PG/native DSH/script-process evidence is retained in `.scratch/himateam-issue97/evidence/frontier-host-final.log` and `frontier-workspace-final.log`. Initial combined run: 16 pass, 1 fail, zero skips; the failed assertion expected 404 for an unauthorized foreign member, while Host correctly returned 403. The expectation was corrected without changing production authorization, and the affected workspace subset was rerun. Final counts and mandatory push evidence are tracked by the short development baton.

The script receiver initially used JSON property order in its receipt filename. Actual PG JSONB roundtrip disproved that assumption; canonical identity tuples corrected the test receiver. Actual run epoch/hold/cancellation evidence excluded a production fence defect. Original failures are retained.

This proves mechanism/UI contracts, not Pi/OpenCode mixed-runtime effectiveness. #105 owns real runtime messaging/busy/recovery composition; #107 owns combined material concurrency and actual mixed-runtime use; #109 owns final platform/business acceptance. #100 still needs production engine/namespace integration, full immutable cohort/rights closure and native Linux x64/clean-install qualification. No ticket closure or release is claimed before synchronized acceptance.

## Review corrections

Independent Standards found disconnected-stream cleanup and unmarked truncation; Spec reproduced an old invocation relabeled as a current generation and unredacted work input. The actual slow-reader/disconnect counterexample kept its original file descriptor open before the fix. The actual pause/continue counterexample retained generation 0 but fabricated a target at epoch 2 before the fix.

Claims now require the observed admitted generation and the existing effect-currentness checks, including revision, branch/extension controls and closing admission. Unknown current binding remains pending. Member work is limited to the member capability's own context; Human/Guide project views redact credential/local-path fields and mark truncated input/result excerpts. Retained committed results keep their original effect/hash. HTTP closure aborts native streams and removes all paired backpressure listeners.

Affected actual Host/PG/script/native-file-descriptor subset passed 12/12, no skips. The first client rebuild failed on a JSX delimiter introduced in the correction; it was corrected and final server/client/test typechecking and full build passed before current App requalification. No failed client build is claimed as App evidence. Prior backend tests consumed emitted backend bytes; the same backend source is retained in the final successful build. Full mandatory regression remains the pre-push gate.

Final affected review receipts: Standards accepted the fix delta; Spec accepted generation/currentness and then the inline path correction. Direct and embedded POSIX/drive/UNC path tokens and credential fields are redacted before bounded input/result serialization. Final affected Host subset: 3/3, zero skips (15.989 seconds); final actual Playwright Electron member-work scenario: 1/1, zero skips (9.197 seconds), including inline-path and credential omission/truncation warnings. The unchanged client bundle was reused while the server was rebuilt. The material App scenario remains qualified by the preceding 2/2 current-client run. Source release/remote completion remains the mandatory pre-push gate.
