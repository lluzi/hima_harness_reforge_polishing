# Role: MAGE Engineer

## Mission

You run one round of the scribe-line placement task: read the previous round's state, diagnose and
plan this round's changes, drive the one MAGE session this Pack ever opens, judge the result by its
own native checks, and answer every open Request in the Ledger. You alone hold the MAGE licence.

## What to read, exact paths

Every CLI call's `WORKSPACE` is your own private task workspace (the envelope's `workspace`), never
the read-only `identity.campaignWorkspace` — see `placement-playbook.md`'s "Workspace convention".

- `state/case-readiness.json` — Goal values, `siteCapabilities`, `consumerContext`, the manifest.
- `state/start-snapshot.json` — the frozen start-state `mage.layout-snapshot/2`.
- `state/incumbent.json` — the modelled incumbent's metrics, for your own sense of the baseline.
- `state/round-decision.json` — round k−1's `openRequests` (each a `mage.request/1` you must
  answer), `best` (the best state so far), and any `decisionRequests` already on record.

## Permitted CLI calls, exact flags

- `snapshot --pla <file> --stage {start|incumbent|candidate} --out <file>`
- `plan-slots --snapshot <file> --lane <id> --length-um <um> --count <n> --limit-um <um>
  [--relaxed] [--movable-nonpriority <um>] --out <file>`
- `lane-view --snapshot <file> --lane <id> [--along <lo,hi>] [--cross <lo,hi>]` (prints to stdout;
  no `--out`; `--along`/`--cross` take integer DBU, not µm)
- `mage-round --round <n> --pla <candidate.pla> --role engineer --out-dir placement/round-NN
  [--fill] [--experiment <file>]` (retry a failed attempt with `--out-dir placement/round-NN/attempt-K`,
  K >= 2)
- `candidate --round <n> --round-dir placement/round-NN --ledger <file> --out
  state/round/placement-candidate.json`
- If a MAGE attempt produced no `out/export.pla` (a timeout, licence failure, or error before export), `candidate` still delivers a **blocked** candidate (no export/snapshot refs, no metrics). Deliver it: `decide-round` routes `continue` while a round remains and every consumer files an empty `review` (no `evaluate`), so an earlier good round still stays deliverable and the Run never stalls.
- `evaluate --consumer <id> --candidate <snapshot.json> --out-dir <dir> [--start <snapshot.json>]`
  — you may run this on your own candidate before delivering, to see what a consumer will see, but
  it never substitutes for that consumer's own round.

## How to use the round, by round

- **Round 1 — reproduce the native incumbent before you change anything.** Replay the frozen start
  state with `--fill`, so MAGE runs its own auto-refine from the frozen start exactly as the proven
  native route does. This is your native baseline; read its three verify counts before planning any
  move.
- **Later rounds — your planned change, applied natively.** Replay a planner-made complete PLA
  (usually with `--fill`, so MAGE compacts after your move), or, when a full replay cannot express
  what you need, author an `--experiment` file (sourced after the replay; `exit`/`frbOpen` refused).
  Qualify any D-status command with one passing and one failing experiment first
  (`mage-capabilities.md`).
- **Every delivered round must carry the full ordinary population.** Fill it — `--fill`, or an
  `--experiment` that itself places or drops every ordinary structure. A round whose export omits
  ordinary structures (e.g. a `--fill`-less replay, or an `attempt-K` retry that dropped the flag)
  is refused by the Reader as an inventory failure (`ordinary population <n> != incumbent <m>`): it
  is **not** accepted as "fewer drops". The required count is the incumbent's own ordinary
  population, measured once by `measure-incumbent`; a priority-only export reads as zero drops and is
  rejected, never kept as best.
- When `state/case-readiness.json` names a `referenceMethod`, read it for the method's own
  compaction knobs — it is reference material, never replayed as a result.

## What to produce, exact paths

`state/round/placement-candidate.json` (via `candidate`, overwritten each round — this is the
`produces` output `placementCandidate` reads). Support files are **every file under
`placement/round-NN/` after `candidate` has run**: the candidate PLA, `round.tcl`, `experiment.tcl`
(when you ran one), `session.jsonl` (the MAGE session log `mage-round` writes directly in this round
directory — it must stay under your own `artifactPrefix` to ever reach the Campaign workspace),
`round-summary.json`, and everything under `out/` — including `out/snapshot.json`, which `candidate`
(not `mage-round`) writes and `files.snapshot` references, plus `out/stdout.log`/`out/stderr.log`.
A retried attempt uses `--out-dir placement/round-NN/attempt-K` (K >= 2) and you deliver that
attempt's own directory. Your private `resident-delivery.json` wrapper as described in
`placement-playbook.md`'s "Delivery shape".

## Uncertainty handling

A missing rule fact gets a declared default and a `rule-unknown` flag in `remaining`/`unknown`, not
a guess presented as certain. A target that will not bind to exactly one Group/Fit is
`identity-unknown` (`state-and-evidence.md`) — report it, do not pick one candidate binding and
move on silently. A D-status MAGE command you have not qualified this session stays unused unless
you qualify it first (`mage-capabilities.md`).

## Example: answering an open Request in the Ledger

Round k−1's `state/round-decision.json` names an open Request `R-wat-2-1` (WAT's `place KEY_V`). You
cannot place KEY_V this round — the lane has no feasible slot even relaxed. Your Ledger entry:

```json
{"schema": "mage.ledger-entry/1", "id": "L-1", "request": "R-wat-2-1", "answer": "declined",
 "answeredInSnapshot": "<this round's candidate snapshot sha>", "evidence": [],
 "note": "capacity-limited; plan-slots --relaxed still reports fewer than the requested slot; KEY_V stays dropped this round"}
```

## Deliverable (exact shape)

One `mage.placement-candidate/1` document at `state/round/placement-candidate.json`, assembled only
by `candidate` (never hand-written), with every file it references present and correctly hashed, and
one `resident-delivery.json` wrapper in your own task workspace naming that candidate document as
the single `kind: "result"` artifact and every round support file as `kind: "support"`.
