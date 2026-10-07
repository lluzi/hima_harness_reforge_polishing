# Post-DBOS main regression qualification

Task: [#95](https://github.com/lluzi/hima_harness_reforge_polishing/issues/95).
Base: `b372e0e5970e3e676e26ff7168551ba7060e56aa`. Scope: usable Mac main and applicable
regressions after retiring the old Fabric engine. Linux delivery is outside this task.

## Changes

- The waiting attention strip reads the current DBOS task's sourced failure/wait reason. Graph
  state and the reason share invocation selection; superseded work, older loop iterations and
  ended Runs cannot supply the current reason. Historical blockers remain readable.
- Reader, Judge, Permit, project-scoped HTTP, Pack admission/release, archive integrity and terminal
  authority tests use their current public interfaces. Meaningful positive and negative checks remain.
- Native desktop fixtures use actual PG ownership and control identities, scoped live conversations,
  current Run projections, and real resource closure. A former owner submits current control metadata
  and the test checks its actual native tool refusal rather than a scripted reply.
- Historical Code/Knowledge material reads, retained original bytes, delayed A-to-B-to-A exclusion
  and the native `hima_context` card are preserved with an ended Ledger fixture.

Retired checks target the removed standalone observe/job-launch command syntax, deleted `/hima/`
page, owner-driven growth executor, and old 132-node ATCS graph. The obsolete Workshop execution
setup is replaced by historical material fixtures. Current large-graph geometry, DBOS extensions,
ATCS 0.4 and native authoring still have applicable tests. The exact returned legacy growth-branch
desktop assertion is retired with its executor; this record does not claim its replacement.

## Verification

Node `24.20.0`, macOS arm64, pinned local PostgreSQL `16.15`. Build, typecheck, seams, boundary,
inventory and diff whitespace checks are recorded separately. Test resources use private Homes,
lineage directories, ports and tmux sockets; desktop windows use Catsights.

| Command / evidence | Pass | Fail | Skip | Seconds |
| --- | ---: | ---: | ---: | ---: |
| Full `local`, `local-full.log` | 765 | 0 | 4 | 1512.688 |
| Current backup + final display/stand-in checks, `final-mechanism-backup.log` | 26 | 0 | 1 | 54.592 |
| Final `atcs-dry`, `atcs-dry-final.log` | 6 | 0 | 0 | 74.507 |
| Final complete `desktop`, `desktop-green.log` | 40 | 0 | 0 | 271.082 |

The default local run's four skips are explicit backup qualifications requiring fixture environment
variables. Three were subsequently enabled against the current compiled Harness and passed. The
remaining cold-cut/native-distribution case requires a frozen App distribution; it is not counted
as a pass by these source checks. Rows overlap and are not summed as unique coverage.

ATCS/LibInsight dry checks execute real local PG/DBOS/Jobs and declared producer/tool stand-ins.
Desktop checks execute the native Electron App and actual Host/control/material APIs with replayed
dialogue. This task makes no new real-model, commercial EDA, physical-signoff or Linux claim.

Logs and screenshots are retained under `.hima-tmp/main-green-20261006/`. The initial wrong PostgreSQL
directory failure is retained separately; a correct-runtime focused baseline reproduced 73 failures
in 18 files. The retired growth test also failed before fixture cleanup; its exact owned Node/PG
processes were stopped and its failure preserved. No other App or user's Home was stopped or removed.

## Review and delivery

Three simplification lenses ran once: no reuse change, one unnecessary test wrapper removed, and
waiting-reason tasks grouped once per render. Independent Codex Sol high correctness and adversarial
review completed: `/tmp/compound-engineering-502/ce-code-review/20261006-170908-7e0be88c/review.json`.
Its original three findings and `Not ready` verdict remain intact. All three findings are applied
and verified. `review-followup.json` in the same directory records zero remaining findings and no
unjustified weakening. The final complete desktop run subsequently passed all 40 cases.

Implementation used Sol medium workers; review used Sol high. No external Claude review/operator
was used. Product-model calls and SSH attempts in this task's selected groups are zero; developer
model request/token billing was not measured.

Pre-existing `.lstack/` and `docs/product-review/` work is excluded. Delivery requires the reviewed
code commit and immediate remote synchronization, followed by integration and SHA verification on main.
