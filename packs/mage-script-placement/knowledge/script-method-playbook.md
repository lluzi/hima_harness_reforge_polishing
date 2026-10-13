# Script-method playbook

## 1. Source

Spec §6 (the Engineer round protocol), §7 (the `mage-stage` driver), §10 (this knowledge's own
contents table); `flow/mage_placement_cli.py` (the real subcommands and flags); `native/prelude.tcl`
(the only procs a stage may call to open the case, snapshot, or check).

## 2. Workspace convention

Your task envelope names two different directories — do not confuse them. `workspace` is your own
private, writable task workspace; `identity.campaignWorkspace` is the Campaign workspace, mounted
read-only. Every CLI call's `WORKSPACE` positional argument is your private `workspace`, never
`identity.campaignWorkspace`. Before your first call, copy each file named in the envelope's
`inputs[]` from its Campaign-workspace path into your private workspace at the same
workspace-relative path (for example `state/case-readiness.json`, `state/start-snapshot.json`), and
verify each copy's sha256 against the envelope entry before trusting it — copy nothing else.
Invoke the CLI from the envelope's `task.flow` copy (the Campaign's read-only `flow/`), passing your
private workspace as `WORKSPACE`. Your result document's path and every support path in
`resident-delivery.json` are relative to that same private `WORKSPACE`; a support path must start
with `placement/` — that is exactly the path the Host gives it once copied into the Campaign
workspace, which is what the Reader sees.

## 3. Objective and the three proof stages

Each round you receive the best state so far, the frozen start snapshot, the measured incumbent and
every earlier round's journal (`state/round-decision.json`, `state/method-journal.json`). You
author and run Tcl, then deliver the round's best stage as a candidate. The outcome is read at
proof levels, from the weakest honest result to the strongest:

- **Reproduction** — the native fill from the frozen start reproduces the incumbent's ordinary
  dropped length (currently 27 ordinary drops / 135,113 µm on this build).
- **Improvement** — your round's ordinary dropped length is below the incumbent's, with every
  priority mark placed and inventory conserved.
- **Match/Surpass** — your round's ordinary dropped length reaches or beats
  `case-readiness.reference.referenceOrdinaryDropLengthUm` when the manifest names one (the
  customer's own retained result: 18 ordinary drops / 52,453 µm, plus one dropped priority Group of
  616 µm not counted in the ordinary figure). Absent that field, this level simply reads `n/a`.
- **Customer completion** — every one of the eight delivery rules PASSes and zero structures are
  dropped.

A round that cannot reach a better numeric result but writes a quantified failure analysis in its
journal entry — a named boundary, the native message, what was tried and why it did not work — is a
complete round. Silence or a vague "it didn't work" is not; a dead end you can name and evidence is
worth exactly as much as a numeric improvement to the next round's Engineer.

## 4. Fixed boundary

You never edit the rule file, the pblock/block files, the target table, the request order, the Goal
limits, or any other Site file. Within that boundary you may change *settings* through Tcl — a
documented compaction mode, an offset-range relaxation, a converge count — because a settings
choice is a method decision, not a change to what the case allows. A change to what placements are
legal is a rule edit and is prohibited even when it would "fix" a drop. The dividing example: relaxing
`-arOffsetRangeX`/`-arOffsetRangeY` from `0` to `-1.000000` through `smSLFit` is an allowed settings
choice (the method already uses it); editing `-setScribe`, `-setNum`, or `-setSpace` on a rule object
is a forbidden rule edit, because those calls change the lane/zone/clearance geometry the rule file
itself declares, not how MAGE searches within it.

## 5. The four stages of the reference method

The customer's own script runs four stages per build; the Engineer re-implements each with the
exact verified commands, never a paraphrase:

1. **Priority point placement.** For each request line, in the file's own order:
   `smPFlow -placeGroup -groupItem <G> -groupTargetPoint (<x>,<y>) -groupPlaceType CT`, where
   `CT = LOC + frame size / 2` — the CT point is the request's stated location offset by half the
   frame size, never the raw LOC value alone. The request order itself lives in files on the Site
   (the manifest's request-order file), never regenerated or reordered by the Pack. After placement,
   the customer's own order-deviation check runs per side (`TB-bottom`/`TB-top`/`LR-left`/
   `LR-right`; `IN` is reported but never checked) — the same per-side check `stage-report` reports
   back to you, with the empty-side sentinel below.
2. **Compaction.** For every item whose offsets are currently `0`:
   `smSLFit <item> -setAutoRefine -arOffsetRangeX -1.000000 -arOffsetRangeY -1.000000`. Then
   `g_params -set {smPFlow::s_ARTestConvergePrplaced true}`, the two converge lines taken from
   `case-readiness.manifest.mage.autoRefineConverge` (`smPFlow -setAutoRefineSimpleConverge
   -arSLType VERT -arConvergeNum <VERT>` and the matching `HORZ` line), then
   `frbGroupSetting -setObject -objectType {GROUP} -objectV {1}` and
   `frbGroupSetting -setObject -objectType {GROUP} -objectX {1}`, then `smPFlow -autoRefine`.
3. **Freeze.** Restore every offset the compaction stage relaxed back to the exact zero values the
   rule file states for those items, then `g_params -set {smPFlow::s_ARTestConvergePrplaced false}`.
4. **Fill.** `smPFlow -autoRefine` again, now in non-converge mode, so Auto Refine fills the
   remaining ordinary structures around the frozen priority placement.

## 6. The two known failure signatures on this build

Verbatim, from the handoff evidence: **a settings edit after point placement leaves 0 placed Fits
with every Group record intact** — the next boundary snapshot shows `inGroupFits: 0` while
`groups` stays at its full count, which is the invalidation signature, not a drop. Second:
compaction in converge mode fails with **`Sort sl <lane> preplaced fits failed`** followed by
**`Failed at auto refinement`**; the same sort line appears in the successful no-compaction fill,
where it is harmless — it is fatal only when converge mode (`s_ARTestConvergePrplaced true`) is
active at the time it runs.

The compatibility repairs that keep the reference text itself replayable, as exact Tcl: a Tcl
`regexp` call matching with a double-dash option-end marker and a brace-quoted pattern (so the
pattern text is never mistaken for a flag), with every literal closing brace inside that pattern
escaped (`\}`), never a bare `}`, because an unescaped brace inside a Tcl brace-quoted pattern
terminates the group early; `eval $line` to re-run a line read back from a saved script rather than re-typing it
(so quoting is preserved exactly as written); `-arOffsetRangeX -1.000000` passed as two bare
tokens, never wrapped in braces, since `smSLFit` parses each flag/value pair positionally; a clean
working directory for every stage (no stale `out/` files from a previous attempt visible to the
running process); and the export itself is a DBU-unit PLA whose Group target points are still in
micrometres — never convert the whole file as one unit.

## 7. Stage-boundary discipline

Call `hima_snapshot <name>` before and after every settings edit, every `-autoRefine`, and every
restore — a stage that changes state without a boundary on both sides of the change cannot be
diagnosed when it goes wrong. Call `hima_check` after every move set (every `-autoRefine`, every
explicit move sequence) so the stage's own native rows are tagged to that boundary. Run
`stage-report --stage-dir placement/round-NN/stage-K --out <file>` and read every row before drawing
a conclusion — never infer a cause from the final export alone when the boundary table can show
exactly where it happened. A boundary whose `inGroupFits` reads `0` while `groups` is intact is the
invalidation signature (§6). A boundary whose `inventory.status` is `fail` cannot be delivered as a
candidate — choose an earlier, conserved boundary as the stage's export instead.

## 8. Action order

Exactly in this order, each round:

1. Reproduce the baseline (round 1, fixed — §9 below).
2. Reproduce the compaction stage and isolate the two known failures at their exact boundaries.
3. Try documented native variants: offset ranges configured before build rather than after, different
   converge counts, the `frbGroupSetting` object settings, restore-after-settings-edit ordering.
4. Explicit compaction authored by you (§9 below — the agent computes and applies the moves itself).
5. Freeze and fill (stage 3 and 4 of §5) once a priority placement survives, whichever stage produced
   it.

## 9. Round 1 is fixed to the baseline reproduction script, verbatim

```
hima_open_build
source $hima_start_pla
hima_snapshot priority-start
hima_check
smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum <VERT>
smPFlow -setAutoRefineSimpleConverge -arSLType HORZ -arConvergeNum <HORZ>
g_params -set {smPFlow::s_ARTestConvergePrplaced false}
smPFlow -autoRefine
hima_snapshot filled
```

`<VERT>`/`<HORZ>` are filled from `case-readiness.manifest.mage.autoRefineConverge`. Nothing else is
attempted in round 1; its Reader values are the Reproduction level, and the next round's Engineer
reads this round's journal before trying anything new.

## 10. Explicit compaction by the agent

When the native compaction stage keeps failing at the boundary in §6, compute the moves yourself:
read a boundary snapshot (`snapshot --pla <boundary pla> --stage candidate --out <file>`), inspect
it with `lane-view` and, if useful, plan exact slots with `plan-slots`, then write a complete PLA —
keeping every Group's own target point untouched, respecting request order per side, and staying
within the movement budget `max_priority_move_um` measured from the *frozen start* snapshot, never
from an intermediate boundary. Write the PLA with a small helper Python file under
`placement/round-NN/tools/` (using `pla.write_pla`), replay it with `source <file>`, run
`hima_check`, then proceed to freeze and fill. Alternatively, for smaller, targeted corrections,
apply `frbSelect -type Sel -inst <FULLID>` followed by `frbMove -off (<dx>,<dy>)` per mark — this is
a D-status command pair here (never run in this Pack's own prelude/epilogue), so qualify it first
with one stage you expect to pass and one you expect to fail, and record both outcomes in the
journal before relying on it for a delivered candidate.

## 11. Two displacement metrics never mixed

**Distance from the CT target** (`targetDistances` in a `stage-report` row) is how far a priority
mark's current position sits from its own requested CT point — a fidelity measure, checked against
`max_target_distance_um`. **Movement from the frozen start** (`priorityMovement` in the same row) is
how far a priority mark has travelled from where it sat in the start snapshot, before any round ever
touched it — an optimization-budget measure, checked against `max_priority_move_um`. A mark can be
close to its target and still have moved a long way from the start (it started far off and you moved
it toward CT), or far from its target while having barely moved (it started far off and you have not
touched it yet). Report both; never rename one as the other, and never substitute one for the other
when checking a budget.

## 12. Journal discipline

Write one hypothesis per round, before running the first stage — the journal entry's `hypothesis`
field is not a summary written after the fact. List every stage you ran, in order, each with its
script sha, outcome, the boundary table it produced, and the native message (if any) at the boundary
where it stopped. Write a conclusion and a concrete next step. The next round's Engineer reads
`state/method-journal.json` first and must never repeat a hypothesis the journal already closed —
if round 2 isolated that converge-mode compaction fails at the `priority-start` boundary with the
`Sort sl` message, round 3 does not try the identical converge call again expecting a different
result; it tries the next item in the action order (§8).

## Delivery shape and prohibitions

Never fabricate a candidate — `candidate` assembles `mage.script-candidate/1` from an actual
`mage-stage` export and the journal entry you wrote; you never hand-build this document. Never
deliver a stage whose export lost inventory (fewer Fixed, fewer Groups, a shrunk ordinary population)
as though it were an improvement — a shorter dropped-length figure obtained by losing structures is
not a result, it is data corruption, and the Reader's inventory check will refuse it. Never run MAGE
outside `mage-stage` — it is the one path that ever opens the case, assembles the prelude/epilogue
around your text, and keeps the session log. Never edit the rule file (§4) under any pretext,
including "to test a hypothesis" — a hypothesis about settings is tested through Tcl inside a stage,
never by editing a Site file.
