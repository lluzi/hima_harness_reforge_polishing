# Issue 63 — ATCS 0.1.1 Bounded Successor Campaign Report (cycle hima-issue63-atcs07-2)

## Verdict: BLOCKED — a genuine, deterministic Pack-configuration defect; no design mutation ever occurred

The 0.1.1 fix is confirmed working: `read-next-decision` — the exact node that crashed
deterministically in the prior cycle (`run-87defa35…`, revision 35) — completed cleanly this cycle
with no `str`/`str` `TypeError`. The single-worker w01 path then progressed correctly through
Researcher, Reviewer, and the human-control-plane gate for the one authorized production Operator
mutation. That Operator attempt then hit a second, independent, genuine deterministic blocker
rooted in the Pack's own recipe budget configuration — not the reader fix, and not this trial's
data. No design database mutation was ever performed in this entire cycle.

## Identity gate (all verified before any product action)

- Cycle main `5609ba16a326543756cb61098033bdc46aa9e9e6` — verified equal to `origin/main`.
- Tester branch remote `d40c30ad8dc81fc7bbda03bd672c25782fdf677e` — verified matching.
- Source fix `2e65bc8bc653eef3059ad5b2cab1b253c4a9e61a` — confirmed via
  `docs/assessment/2026-09-27/atcs-reader-cli-fix.md`.
- Pack `agentic-timing-closure-system@0.1.1`, digest
  `3a52984082f4b07d6615ade2a1c2b1975852f2ac6e748c015a3806c59d8485c9` — independently
  recomputed via the App's own `loadPack()`, exact match.
- Launcher `launch-reader011-trial.command` SHA
  `322fe38010fce783a490078f69f2854567689a73e62578223206cddb82616ad5` — exact match, no
  `--site` flag.
- Binding SHA `05f4060f735d12fa310039558b374dba38ce9ec428e03228992f2eb9a6e79a40`, environment SHA
  `6b747400003c65aa773dbf071223cdce4cfe8522ec37a931d91e91add7c526a1`, home config SHA
  `f7ee902999c9139606cc5b4ad23e84254224288664af4b48019e12cd4002fc99` — all exact matches.
- Reused trial.33 App artifact digest and manifest — exact matches, no rebuild.
- `DEEPSEEK_API_KEY` already natively provisioned in the successor Home; not reprovisioned.

## What was genuinely exercised (verified, not assumed)

1. **Same-bundle-ID window hazard, correctly handled without terminating any process**: per this
   manual's explicit instruction not to terminate unrelated App processes, the old failed-Run App
   instance (`run-87defa35…`, revision 35) was left running untouched throughout. The new
   Reader011 window was correctly identified and operated by visually confirming its distinct
   content (a fresh "No sessions yet" window) before any interaction, and by dragging the older
   window aside by its title bar (no content/button interaction) whenever it was accidentally
   brought to front.
2. **Guide inventory, Site rediscovery, one Campaign/Run/owner**: identical pattern to the prior
   cycle — Guide gave an honest inventory, the one genuine human-only action (Settings →
   HimaHarness → Sites → Rediscover, `luzi@192.168.50.41`) changed `linglong-atcs28` from
   `needs discovery` to `ready`, and exactly one successor Campaign/Run/owner was confirmed with
   the fixed budget (180 min, 30 min closing reserve, generation limit 4, retry allowance 1, job
   cap 1).
3. **Full M1 baseline chain**, all real Job evidence, exit 0: `bind-inputs`, `read-readiness`,
   `check-inputs` (PASS), `baseline`, `observe-baseline` (real PrimeTime), `policy`,
   `physical-baseline` (real Innovus export), `risk-baseline`, `residual-baseline`.
4. **`decide-next` → `read-next-decision`: PASS, the exact fixed gate.** Directly confirmed in the
   Run's own node ledger: *"`read-next-decision` · completed · generation 1 · attempt 1"* — no
   crash, no `str`/`str` `TypeError`. This is the primary confirmation this successor cycle was
   dispatched to obtain.
5. **w01-only Workshop plan**: three disjoint work packages authored (w01: 41 checks, w02: 132
   checks parked, w03: 54 checks parked — w02/w03 correctly never launched any Team or Job), judged
   `request-admissible: PASS` by the Pack's own validator (`tc_request_invalid_count = 0`).
6. **Researcher → Reviewer, generation 1**: `research-worker-01` completed (after self-corrected
   retries within the declared retry allowance — the owner transparently disclosed and fixed two
   of its own planning-level mistakes via proper bounded plan revisions, not silent workarounds).
   `check-worker-request-01` judged the plan `PASS`.
7. **Human-control-plane gate at `operate-worker-01`** (the one authorized production Operator/
   real-XTop-mutation node): the Fabric correctly paused it and refused both the Agent's own
   direct-work attempt and its own attempt to clear the pause, requiring genuine human action. This
   tester cleared it through the actual Run-view GUI control (Campaign panel → Live graph → node
   detail → **Continue this node** → **Confirm continue**) — a chat confirmation alone was
   explicitly insufficient, confirmed by the owner re-reading the ledger afterward:
   `paused: []`, revision 95.

## The blocker: `operate-worker-01` cannot reach its own Operator child

With the pause cleared, `operate-worker-01` began a fresh execution (attempt 2,
`execution-e8790b85…`) — and hit a genuine, deterministic dead end, confirmed directly in the
visible product:

- **Exact state**: `operate-worker-01`, attempt 2, revision 97, **not paused, no design mutation
  performed, no Job in flight**.
- **What happened**: the recipe member `researcher` materialized correctly and ran, but ran out of
  room before finishing — its closing message carried 8 hypotheses (H1–H8) but no completed
  boundary.
- `hima_delegate result` → **unavailable**: *"The latest native child turn has no explicit
  completed boundary; candidate completion remains unknown."*
- `hima_delegate create memberId: reviewer` → **refused**: *"Recipe dependency `researcher` has no
  exact observed candidate result."*
- The dependency chain is hard: without an adopted researcher candidate, the reviewer cannot exist,
  so the Operator — the only context permitted to drive `hima_interactive` — can never be reached.
  The owner explicitly stated it did not attempt any workaround around this dependency.

### Root cause (owner's own direct source citation, verified)

The Pack's own recipe (`atcs-worker-01` v1) declares the researcher's `budgetShare`:
`{maxElapsedMs: 600000, maxFollowups: 0, maxTokensPerTurn: 5000}`. One turn of 5,000 tokens is not
enough to emit the required `atcs-worker-research/1` schema over this task's actual scale (a
41-target, 12-instance request), and `maxFollowups: 0` forbids any continuation turn. This is a
**Pack-authoring property**, not something editable from inside a Run.

The owner (correctly, per its own operating bounds) presented three options rather than acting
unilaterally: (1) raise the researcher's `budgetShare` and re-run — requires a new Pack version;
(2) revise the slot-1 request first (folding in the researcher's own genuine partial findings,
H4/H5/H6/H8, about real mechanism/coverage gaps) and re-run with a fresh team — still at risk of
the same truncation while the Pack budget stands; (3) cancel the Run. This tester selected **none**
of the three — per this manual, no Pack/code fix and no further mutation attempt are authorized
from the tester side; the first actionable execution blocker was reached and is reported here.

## Ten-row-equivalent status against the manual's journey

| Step | Item | Result |
| --- | --- | --- |
| 1 | Guide inventory, no Run created | PASS |
| 1 | One confirmation / one Campaign / one Run / one owner, fixed budget | PASS |
| 2 | Baseline observation, physical baseline, policy/risk/residual facts | PASS — real Job evidence throughout |
| 3–4 | w01-only Workshop plan admission, Researcher/Reviewer, exact adoption (generation 1) | PASS |
| — | **`read-next-decision` fixed-gate validation (this cycle's primary purpose)** | **PASS — completed cleanly, 0.1.1 fix confirmed** |
| 5 | Exactly one production Operator child, typed `atcs_*` commands, at most one `atcs_size_cell` effect | **BLOCKED** — Operator child never reachable; researcher dependency truncated before a candidate result existed |
| 6–7 | Contribution/collect/composition, joint physical refresh | Not reached |
| 8 | Recovery without duplicate effects | Not exercised (Run left exactly as blocked) |
| — | Stop at first deterministic defect, no source/Pack patch, no unauthorized second mutation attempt | PASS — exactly this was done |

**Overall: BLOCKED.**

## Required non-claims

- No claim of `PACK_DELIVERABLE`, timing closure, or QoR.
- No claim that the researcher's partial findings (H1–H8) constitute a completed or adopted
  research result — they are explicitly disclosed as an incomplete, non-adoptable turn.
- No claim that this blocker is related to the reader fix under test — `read-next-decision` itself
  is confirmed working; this is an independent, second defect in a different part of the Pack
  (the researcher recipe's turn-budget sizing).
- No design database mutation, `atcs_size_cell` effect, or Contribution was ever produced in this
  cycle.

## Disposition

No workaround was used. No second Campaign, Run, or Operator attempt was created by this tester.
The Run remains exactly where the blocker left it:
`run-f82fb77f-856a-4f0c-a8cc-1555795…`, `operate-worker-01`, attempt 2, revision 97, **not
paused**, no in-flight Job, no design mutation. Historical `#52` evidence
(`run-9ee5225b…` revision 67, `run-c355dfb4…` revision 49) and the prior ATCS 0.1.0 failed Run
(`run-87defa35…` revision 35) all remain completely untouched throughout this cycle.

## Owning seam and cheapest next falsifying gate

- **Owning seam**: the Pack's `atcs-worker-01` v1 recipe budget declaration
  (`researcher.budgetShare.maxTokensPerTurn: 5000`, `maxFollowups: 0`), sized too small for the
  actual 41-target/12-instance request schema this Campaign's admitted plan produced.
- **Cheapest next falsifying gate**: raise the researcher's `maxTokensPerTurn` (or permit at least
  one `maxFollowups`) in a new Pack version sized to comfortably emit the
  `atcs-worker-research/1` schema for a request of this scale, then re-dispatch a bounded
  successor to this same Run/Campaign (or an authorized fresh one) to verify the Operator path can
  now be reached.
