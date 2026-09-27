# Issue #52 Agent Team recipe implementation handoff

Date: 2026-09-27. Status: **LOCAL/HOST PASS; L4/L5 NOT RUN**.

## Preserved authority

Attempt 4 remains unchanged at Run `run-c355dfb4-9380-4d0c-8548-3e3380e050a1`, revision 49,
paused at `run-xtop-fix`. No hold was cleared, child resumed, Ledger/evidence edited, new HimaHarness
Campaign created, Desktop launched or commercial EDA started. The prior native validation driver was
stopped without cancelling its retained Run.

## Root cause and implemented result

The existing delegation Runtime already owns real child sessions, role tool ceilings, shared budget,
exact Run inputs, dependencies, durable candidate results, explicit owner adoption, idempotent
requests and qualified interactive authority. Attempt 4 failed because the Pack did not declare how
to compose its team, so the owner invented task text, inputs, dependencies and recovery.

`xtop-timing-closure@1.0.16` now declares `agentTeams.timing-eco-team` in `contract.yml`, with human
method explanation in `SPEC.md` and `knowledge/agent-team.md`. Each Researcher, Reviewer and Operator
member declares role/task, Pack output inputs, tools, scope policy, budget share, dependencies, result
schema, recipient, owner-adoption rule, one-child-per-role/per-execution identity, follow-up/reuse,
cancellation, terminal and refusal conditions. Dynamic Run, execution, Ledger, path and binding facts
are Runtime-owned and absent from Pack bytes.

`hima_delegate create` accepts either a legacy contract or a recipe selector. Recipe materialization:

1. loads the Run's retained Pack snapshot;
2. resolves current observations by declared output reader, generation and exact output path;
3. derives Pack task, role, tools, input refs, budget, dependencies and recipient;
4. derives stable child identity from team/member/execution;
5. validates recipe JSON result envelopes before recording a candidate;
6. requires exact result-record identity for recipe adoption;
7. admits Operator only after exact Reviewer-result adoption;
8. validates the action against hash-verified retained plan bytes;
9. injects the adopted plan hash into the typed mutation and refuses a live-plan mismatch;
10. refuses a second Operator delegation for the same Run/node/execution.

There is no automatic dependency dispatch, scheduler, Team database, second graph executor or
Pack-specific Runtime branch. Each child creation, result read and adoption stays an explicit owner
action. Manual recipe provenance is refused; a node declaring an Operator recipe cannot use the
legacy manual shortcut. Packs/nodes without a recipe remain compatible.

## Operator transaction

The mutation is one `hima_apply_action(...)`, not a full plan portfolio:

`reviewed action -> mutation -> selected-action receipt -> save -> unique ECO pair -> finalizer -> DONE`.

Save is unavailable before successful mutation. Partial/failed mutation becomes `uncertain`, cannot
replay or save, and creates no ECO pair. `selected-action.json` is create-exclusive, may not be a
symlink/residue, is validated against the retained plan, and is hash-bound into the XTop stage beside
the unique logical/physical ECO files. Empty failed-save residue may be removed; nonempty evidence is
preserved. Site wrapper v5 is a new immutable candidate path; Permit retains v4 for historical Runs.

## Red/green evidence

The first focused run correctly failed on stale seal/wrapper/no-arg assumptions. Current results:

- `pnpm run build`: PASS.
- Pack Python contract: 37/37 PASS.
- focused local/Host tests (`xtop-timing-closure`, `interactive-eda.host`, `delegation-run.host`,
  `delegation.host`): 13/13 PASS; 11 in-process Hosts, 0 Electron, 0 SSH.
- `check:node`, `check:seams`, `check:boundary`: PASS.
- full repository `typecheck`: NOT PASS only on existing `TS1294 erasableSyntaxOnly` errors in
  untouched `channel.ts`, `errors.ts`, `guide-context.ts`, `guide-sessions.ts`, `workspace.ts`.

Tests cover recipe/checkPack and old-Pack compatibility; Pack-derived contracts; Researcher candidate
to Reviewer candidate to exact adoption ordering; pre-child refusal for missing evidence/dependency/
adoption; manual Operator bypass refusal; retained-plan membership and plan-hash TOCTOU guard;
mutation/save/finalizer ordering and unique pair; duplicate/retry identity; and non-floating adoption
after follow-up.

## Exact remaining acceptance

Before another GUI trial:

1. deploy v5 at its new administrator path without replacing v4;
2. run one bounded direct XTop L4 qualification and retain transcript, selected-action, logical ECO
   and physical ECO hashes;
3. generate the administrator binding for the resulting Pack digest;
4. update TEST via the native path, seal/release 1.0.16 and package the next isolated App;
5. prepare a no-commercial preflight and GUI manual requiring visible Researcher -> Reviewer -> exact
   owner adoption -> Operator recipe use;
6. only then dispatch one fresh Claude Computer Use Campaign. Attempt 4 stays parked.

GUI PASS must show one Campaign/Run/owner, one child per role/execution, exact reviewed action/hash,
one Operator transaction, explicit Operator-result adoption, no duplicate effect, refreshed
Innovus/StarRC/PrimeTime evidence, Data Insight/Guide agreement and a truthful bounded ending.

## Risks and non-claims

- Result schemas enforce schema id and required top-level fields; richer arbitrary JSON Schema is not
  claimed. Typed command bounds, plan membership and retained identities are the hard action gates.
- Generic output matching still accepts the exact declared relative path or an absolute path ending
  in that relative path; a future Ledger schema can carry output name/workspace identity directly.
- Pack selected-action and Host Reviewer/adoption provenance are joined through retained identities;
  one self-contained remote receipt containing Host ids is not claimed.
- A plan-hash mismatch guarantees zero mutation but is detected after XTop startup, so it can still
  spend one bounded startup/licence interval.
- v5 real XTop qualification and full three-role real-model behavior are not yet proven.
- 1.0.16 remains development: no TEST/seal/release/App/GUI Campaign exists.
- No timing improvement, closure, clean signoff, PPA, ROI, labor saving or DTCO benefit is claimed.

Rollback is the parent of the implementation commit. All historical Campaign evidence and v4 remain
readable.
