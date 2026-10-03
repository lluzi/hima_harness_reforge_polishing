# Issue 63 — ATCS 0.1.2 Bounded Successor Campaign Report (cycle hima-issue63-atcs07-3)

## Verdict: BLOCKED — a genuine, deterministic evidence-contract defect, upstream of the Researcher fix under test

This cycle's own Researcher recipe fix (`atcs-worker-01@2`, 8000-token cap) was never reached.
The Run advanced cleanly and honestly through the entire M1 baseline chain — including a real
PrimeTime `observe-baseline` — and then hit a genuine, deterministic dead end at
`revisit-next-decision`, one step before the Researcher/Reviewer/Operator path this manual asked
to be validated. The blocker is structural (a citation requirement that cannot be satisfied by any
record this generation actually produced), not a transient or data-dependent failure. No design
mutation occurred; the Run is now globally held with all evidence preserved.

## Identity gate (all verified before any product action)

- Cycle main `994747762c7bfab4ef48128f511899a99f4ecb9e` — verified equal to `origin/main`.
- Tester branch remote `92b61dae2b98f2a160d75c94fd46dd84001fbdfc` — verified matching.
- Fix source `f95c1309222f72e57a790821079db17b42d5fee5` — confirmed via
  `docs/assessment/2026-09-27/atcs-researcher-budget-fix.md`.
- Pack `agentic-timing-closure-system@0.1.2`, digest
  `7eefda6192db49be9d15cc31773372c0765cc6c3804684cf4f7c63ab7691b4d3` — independently
  recomputed via the App's own `loadPack()`, exact match.
- Launcher `launch-research012-trial.command` SHA
  `c5d49c2bc633fc6ebdcfac9474705e06564f69ca9ba99edb156227765304523a` — exact match.
- Binding SHA `52aad71627279d1d414b1c43b191d7e05e3060d6610b22db04a6712a4e2bfed4`, environment SHA
  `b52ca592b5fdb76f9f18545764a107f2566cce0daf677589af04e70d8329d262`, home config SHA
  `f38d5956d3bd9c456f0128a36cd32432895133d60d00dfd14f362012719094f7` — all exact matches.
- Same trial.33 App artifact, no rebuild. `DEEPSEEK_API_KEY` already natively provisioned; not
  reprovisioned or printed.

## What was genuinely exercised (verified, not assumed)

1. **Preserved prior Runs, no unrelated process terminated**: both older App instances (holding
   `run-f82fb77f…` revision 97, and `run-87defa35…` revision 35) were left running untouched for
   this entire cycle. The new Research012 window was identified by its distinct, fresh content
   before any interaction.
2. **Guide inventory, Site rediscovery, one Campaign/Run/owner**: identical pattern to the prior
   two cycles. Guide gave an honest inventory and flagged two proactive caveats unprompted (Run
   `purpose: "test"` not `"campaign"`; the saved Site draft still declares 16 cores/64 GiB though
   discovery observed 32 cores/117.6 GiB — the save kept the smaller declared capacity). It then
   verified the `campaign.yml` budget schema against the **authoritative Pack contract source**
   (explicitly distinguishing this from a sibling workspace's non-authoritative artifact), applied
   the fixed budget (180 min / 30 min reserve / 4 generations / 1 retry / job cap 1,
   `applied: true, source: "file"` for all three overridable keys), and confirmed exactly one new
   Campaign/Run/owner (`run-c0793069-3efa-442d-831b-047c5c5ad577`).
3. **Full M1 baseline chain, real Job evidence, exit 0**: `bind-inputs`, `read-readiness`,
   `check-inputs`, `baseline`, `observe-baseline` (real PrimeTime observation) all completed
   cleanly. 9 `act` nodes plus 1 `judge PASS` and 1 `judge FAIL` are all retained in the Ledger,
   including the real baseline hold measurement (**−0.1551 ns**, scope `post-route-only`, 231
   remaining violations).

## The blocker: `revisit-next-decision` cannot satisfy its own citation contract

- **Node**: `revisit-next-decision` (Explore role), revision 40 at the time of the block.
- **Requirement**: the node's own completion contract demands citing *"this generation's
  observation + the required Judge ruling."*
- **What was tried**: 8 distinct citation permutations — observation `#000010`; rulings
  `#000012`/`#000013`/`#000070`/`#000071`/`#000072`; code record `#000058`; with and without a
  `strategy` binding — **all refused by the identical error sentence**. The owner explicitly
  concluded this was a real blocker, not a permutation it could keep guessing at.
- **Root cause** (verified by the owner's own direct Ledger inspection, not asserted): this
  generation's **only** Ledger record actually typed `observation` is `readiness.json`
  (`#000010`, 264 B). `observe-baseline`'s real PrimeTime observation set (62,948 B) and the risk
  atlas exist **only** as `Workshop-input-capture` records (`#000041`/`#000042`) — **no
  corresponding `observation`-typed Ledger record was ever produced for them.** The citation
  requirement is therefore structurally unsatisfiable for this generation: the record type the
  validator demands does not exist for the evidence that was actually gathered.

This is a genuine, deterministic evidence/contract defect in the `decide-next` /
`revisit-next-decision` node's own record-typing versus its own citation validator — not a
formatting mistake, not something fixable by trying another reference, and not caused by this
trial's own data (the baseline evidence itself is real and complete).

### Disposition at the blocker

The owner presented four options: (1) clarify the correct cite contract; (2) self-authorize a
read-only `hima_observe` backfill to register the missing observation record; (3) pause the
Campaign and preserve current state; (4) end the conversation without further Run advancement.
This tester selected **option 3** — pause and preserve — consistent with the manual's no-fix,
no-forced-action bounds (options 1 and 2 would each involve the owner taking further action to
route around an unresolved defect, which is out of this tester's authorized scope).

## Exact held state (verified directly in the GUI)

- Run **globally held**: `paused: ["*"]`, **revision 41**, `currentNode: revisit-next-decision`.
- All 8 Jobs launched this cycle have **finished** (`unsettledSessionIds` empty); no commercial EDA
  licence seat remains held (PrimeTime 104,941 ms + Innovus 188,070 ms total usage, both
  released).
- Evidence fully preserved: 9 `act` nodes, 1 `judge PASS`, 1 `judge FAIL`, all retained in the
  Ledger.
- The owner separately, honestly disclosed one already-identified but **not yet applied** minor
  defect in its own frozen draft output (`next-decision.json`'s `caseCount` field should be an
  integer count, not a violation list) — it correctly left the frozen version untouched rather than
  overwrite already-produced evidence, deferring any fix to a fresh attempt after a hold-lift.

## Ten-row-equivalent status against the manual's journey

| Step | Item | Result |
| --- | --- | --- |
| 1 | Guide inventory, no Run created | PASS |
| 1 | One confirmation / one Campaign / one Run / one owner, fixed budget | PASS |
| 2 | Baseline observation, physical baseline, policy/risk/residual facts | PASS through `observe-baseline`; the graph blocked before further M1 stages completed |
| — | **Researcher recipe2/8000-token contract validation (this cycle's primary purpose)** | **Not reached** — blocked upstream at `revisit-next-decision` |
| 3–4 | w01-only Workshop plan, Researcher, Reviewer, exact adoption | Not reached |
| 5 | One typed Operator, at most one mutation | Not reached |
| 6–7 | Contribution/collect/composition, joint physical refresh | Not reached |
| 8 | Recovery without duplicate effects | Not exercised (Run left held, not reopened) |
| — | Stop at first real blocker, preserve evidence, no forced action, no source/Pack fix | PASS — exactly this was done |

**Overall: BLOCKED.**

## Required non-claims

- No claim of `PACK_DELIVERABLE`, timing closure, or QoR.
- No claim that the 0.1.2 Researcher recipe fix is itself faulty — it was never reached or
  exercised in this cycle.
- No claim that the real baseline evidence (PrimeTime observation, hold −0.1551 ns) is invalid —
  it is genuine and complete; only its Ledger *record typing* is incompatible with the
  `revisit-next-decision` citation validator.
- No design database mutation, `atcs_size_cell` effect, or Contribution was ever produced in this
  cycle.

## Disposition

No workaround was used. No second Campaign, Run, or forced continuation was created by this
tester. The Run remains exactly where the blocker left it:
`run-c0793069-3efa-442d-831b-047c5c5ad577`, `revisit-next-decision`, **revision 41**,
`paused: ["*"]`, no in-flight Job, no design mutation. Historical evidence
(`run-9ee5225b…` revision 67, `run-c355dfb4…` revision 49, `run-87defa35…` revision 35,
`run-f82fb77f…` revision 97) all remain completely untouched throughout this cycle.

## Owning seam and cheapest next falsifying gate (superseded — see dated correction below)

- **Owning seam**: the `decide-next`/`revisit-next-decision` node's record-typing contract — the
  Ledger writer for `observe-baseline`/risk-atlas evidence produces `Workshop-input-capture`
  records, while the `revisit-next-decision` citation validator requires an `observation`-typed
  record for the same evidence. Either the writer must also emit an `observation` record, or the
  validator must accept the capture-record type it actually produces.
- **Cheapest next falsifying gate**: align the two — either have the baseline/risk stages also
  write a proper `observation` Ledger record for their own evidence, or relax
  `revisit-next-decision`'s citation contract to accept the `Workshop-input-capture` record type —
  then re-dispatch a bounded successor to verify `revisit-next-decision` can complete and the
  Researcher/Reviewer/Operator path (this cycle's actual target) can finally be reached.

---

## Dated correction (2026-09-27, later the same day) — the structural-citation-gap claim above is FALSE

An independent read-only audit of this Run's actual Ledger and the Pack's actual
`exploreRecommendation` source falsified the root-cause claim above. The corrected facts:

- **Observation `#000067` (the `read-next-decision` Reader output) genuinely exists** as a
  current-generation, properly typed `observation` record. It is not missing.
- **Judge verdicts `#000069`** (`request-admissible`, **FAIL**) **and `#000070`**
  (`request-checked`, **PASS**) **both exist and both cite `#000067`.** They are not invalidated.
- The Pack's own `exploreRecommendation` function for `revisit-next-decision`, called read-only,
  returns `ok: true` with the required cites in the **exact order** `[#000069, #000070, #000067]`
  and the chosen next strategy `{ maxPaths: 1000 }`.
- The eight citation permutations attempted in the original blocking turn simply **used the wrong
  record IDs** (`#000012`/`#000013`/`#000058`/`#000071`/`#000072`, and empty-object/omitted
  `strategy` values that the node's own validator separately refuses) — this was a targeting
  mistake, not evidence that the required record type was absent from the Ledger.

**The `revisit-next-decision` node is, and always was, completable with the correct exact-graph
values above.** The "evidence-contract defect" reported earlier in this file is withdrawn. The
original evidence section above is preserved unedited for the record, but its conclusion is
superseded by this correction.

## Final addendum (2026-09-27) — Verdict: BLOCKED on a UI control-plane reachability gap (distinct from the above)

### What actually blocks this Run now

The Run is held by a **global wildcard pause**, `paused: ["*"]`, set earlier via `hima_execute
pause` with a wildcard scope (the owner's own choice when this tester selected "pause and preserve"
at the original, since-corrected, blocking turn). Clearing a wildcard hold requires a **Run-level**
continue action, not a per-node one.

- The packaged trial.33 App's compiled client bundle (`@hima/harness/lib/client.js`) genuinely
  **does** contain this Run-level control: a `RunControls` component that maps
  `control.paused` and renders a `Continue Run` button (`onClick: acting.act("continue",
  undefined)`, no `nodeId`) whenever the scope is `"*"`. It renders inside a Hima Run tool-result
  card, directly below `StatusBanner`, within the owner's own chat transcript — **not** in the
  Campaign/Live graph panel, and **not** as a per-node popup. An earlier literal-string search for
  the exact text `"Continue Run"` failed to find this because the JSX renders the label from two
  separate children (`"Continue "` and `{scope}`), so the string never appears contiguously in the
  compiled bundle. **This tester's earlier claim that the packaged App lacks this control was
  itself incorrect** and is withdrawn here.
- Despite multiple genuine attempts — searching the Campaign panel's Live/Generations/Evidence/
  Report tabs, the node detail popup, the sidebar, the header, and the app's own repo and packaged
  source (several of these searches ran long, one exceeding 25 minutes on a single turn) — this
  tester **could not locate or expose the specific Hima Run tool-result card** carrying the live
  `Continue Run` button in the actual running session. The owner's own in-progress response also
  became unresponsive to the GUI's "Stop generating" control during this search.
- The **only** continuation action that actually took effect during this cycle was the per-node
  **"Continue this node"** control on `revisit-next-decision` itself. Its receipt was explicit:
  `scope: revisit-next-decision`, `clearedScopes: [revisit-next-decision]` — this does **not**
  clear a wildcard-scoped (`"*"`) entry, and it did not.

### Exact final state (unchanged from the original block, independently reverified)

- Run `run-c0793069-3efa-442d-831b-047c5c5ad577`: **revision 42**, epoch 1,
  `paused: ["*"]`, `currentNode: revisit-next-decision`, **no in-flight Job**.
- The graph-derived exact citation set `[#000069, #000070, #000067]` and strategy
  `{ maxPaths: 1000 }` (see correction above) were **never applied** to Explore, because the
  global pause was never lifted — Explore cannot be retried while a wildcard hold is in effect.
- No source, Pack, Runtime, or Site file was edited. No raw shell/Tcl business bypass or direct
  HTTP/Ledger write was used at any point. No successor Campaign or Run was created.

### Verdict: BLOCKED — UI control-plane reachability, not an evidence or Pack defect

This is now classified precisely as a **tooling/UI reachability blocker**: the correct recovery
control genuinely exists in the shipped App, but this tester was unable to reach it within the
authorized bounded attempts in this running session. It is **not** a claim that the control is
missing from the product, and **not** a claim that the underlying Explore evidence/citation
contract is broken (see the correction above — it is not).

### Owning seam and cheapest next falsifying gate (final)

- **Owning seam**: locating/exposing the existing Hima Run tool-result card (containing
  `RunControls`) in the live running session — a UI-navigation gap in this tester's own attempts,
  not a missing product feature.
- **Cheapest next falsifying gate**: have the owner render a fresh Run-status tool result (e.g. a
  plain `hima_context`/status call) in its own chat, then locate and click the `Continue Run`
  button inside that specific card's rendered output; verify the receipt clears `paused` to `[]`
  before retrying `revisit-next-decision` with the exact-graph refs
  `[#000069, #000070, #000067]` and `strategy: { maxPaths: 1000 }`.

### Disposition (final)

No further product action was taken after this blocker was identified. The Run remains exactly as
found: `run-c0793069-3efa-442d-831b-047c5c5ad577`, revision 42, `paused: ["*"]`,
`currentNode: revisit-next-decision`. All historical evidence across this program
(`#52` Runs `run-9ee5225b…` revision 67 and `run-c355dfb4…` revision 49; ATCS 0.1.0
`run-87defa35…` revision 35; ATCS 0.1.1 `run-f82fb77f…` revision 97) remains completely
untouched.

---

## Bug-triage addendum (2026-09-27, later still) — window contamination confirmed; all three App instances exited

Per explicit user correction, end-to-end acceptance was stopped and this turn was scoped to
bug-finding only: **no Continue/retry action, no EDA launch, no Run creation or mutation.**

### Window/Home inventory (read-only process metadata, no GUI click needed to establish this)

| PID | Started | `--user-data-dir` (Home) | Run | Revision |
| --- | --- | --- | --- | --- |
| 14055 | 11:46:33 | `.../atcs07-eb9d3234/Trial Data` | `run-87defa35…` (ATCS 0.1.0) | 35 |
| 31452 | 13:39:58 | `.../atcs07-eb9d3234/Reader011 Data` | `run-f82fb77f…` (ATCS 0.1.1) | 97 |
| 55518 | 15:12:30 | `.../atcs07-eb9d3234/Research012 Data` | `run-c0793069…` (ATCS 0.1.2, **the target**) | 42 |

### Contamination confirmed exactly as the user hypothesized

One **read-only** `app_screenshot` (no click) of the window the tooling resolved by bundle ID
showed it displaying **`Select option 3: leave this` / revision 35 / `read-next-decision`** — this
is the **stale ATCS 0.1.0 `Trial Workspace` window (pid 14055), not Research012**. The earlier
node-level "Continue this node" receipt reported in the prior addendum was obtained from a window
that could not be independently re-confirmed as the Research012 window at click-time; this
contamination risk is now directly evidenced, not merely hypothesized. No product click was made
on this window this turn — only the one diagnostic screenshot.

### Unresolved event: all three HimaHarness processes have since exited

After that one read-only screenshot, one **unverified** minimize-button click was attempted on the
same (already off-scope) stale window, followed by a live user correction that a subsequent
full-screen display check had targeted the wrong physical screen (an unrelated pre-existing Finder
window, not HimaHarness or Catsights) — that full-screen mode was released immediately with **no
click** made on it. Immediately afterward:

- `app_list_windows` for the HimaHarness bundle returns `[]` (no windows).
- `ps aux` shows **all three** previously-running HimaHarness main processes (14055, 31452, 55518)
  have exited, including the target Research012 process.

**No kill/quit command was issued by this tester at any point.** It is not established that the
single unverified minimize click on the unrelated stale window caused three independent processes
to exit — that would be an unusual failure mode — and the true cause is not determined from
available evidence. This is reported as an open, unresolved observation, not a confirmed root
cause.

### The underlying Run state is very likely intact

A read-only file `stat` (not opened, not queried) of Research012's own Ledger confirms
`Research012 Data/dsh/storages/hima_ledger.json` **persists on disk**, last modified after the
revision-42 state was recorded. HimaHarness's Ledger is file-based, not memory-only, so the Run's
actual state should survive the App process exiting — this could not be independently
re-verified through the GUI this turn, since no App window exists to inspect it, and this tester
was instructed not to relaunch anything unilaterally.

### Verdict for this turn: no acceptance verdict — bug-triage report only

- No Continue/retry was sent. No EDA was launched. No Run was created or mutated.
- Two distinct, real findings are reported: **(1)** confirmed same-bundle-ID window
  misidentification risk (the tooling resolved the wrong Home's window without any explicit
  disambiguation available), and **(2)** an unresolved loss of all three running HimaHarness App
  processes, cause undetermined, occurring during read-only inspection and one ambiguous-result
  minimize click.
- Historical Ledger data for all four Runs across this program was not opened, queried, or
  mutated by this tester at any point.

### Next step (for the coordinator, not this tester)

Determine why all three App processes exited, and whether relaunching Research012 against its
existing Home (`Research012 Data/dsh`) safely reconnects to the persisted `run-c0793069…` Ledger
at revision 42 without creating a new Run. This tester takes no further product action pending
that decision.
