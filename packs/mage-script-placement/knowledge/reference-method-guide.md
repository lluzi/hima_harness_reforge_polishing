# Reference method guide

## Source

Spec §5.3 (Site documents), §6 (fixed boundary); `flow/mage_placement/tasks.py` (`_load_case`'s
digest verification of `referenceMethod`/`referenceFiles`/`referenceNotes`); `state/case-readiness.json`'s
`reference` block.

## Applies when

Reading the Site's own reference material before planning a round, or before writing an
observation that cites it.

## What `case-readiness.reference.referenceMethod` is

The reference method's own entry script, kept on the Site, read-only, named in the manifest as a
digest-verified file reference. `prepare-case` re-verifies its sha256 every run, which is what
proves the copy you are reading is the frozen customer script and not something edited since —
never assume it is current without that check having run. You read this file; the Pack never
sources it, and you never source it either. It is evidence about what the customer's method does,
not a candidate.

## What `referenceFiles` holds

An array of further digest-verified files alongside the entry script: the target CSV the entry
script reads, the request files it generates or consumes, and the saved per-side placement files it
produces at each stage. Each carries its own `path`/`sha256`; treat them exactly as you treat the
entry script — readable history, never replayable as a result.

## What `referenceNotes` are

Optional Site-local documents — observations from earlier sessions and probes on this case and this
MAGE build. They are facts about what failed where (a boundary, a native message, a build date),
never instructions to follow blindly. A note saying "compaction failed on this build" is evidence to
weigh against your own stage-report rows, not a command telling you to skip trying compaction this
round.

## How to read the entry script

Read it in stage order — priority placement, compaction, freeze, fill — the same four stages
`script-method-playbook.md` names. Map each of its stages to the `hima_snapshot` boundary you would
take at the equivalent point in your own stage script: its point-placement loop corresponds to your
`priority-start` boundary, its compaction call to the boundary right before your own `-autoRefine`
in converge mode, and so on. This mapping is what lets you cite "the entry script's compaction call,
line N" against a specific boundary in your own stage-report, instead of a vague paraphrase.

## Verified history versus unreproduced on this build

The entry script's point-placement stage is verified history: it completed, and the customer's
retained historical artifact's figures (18 ordinary drops / 52,453 µm, plus one dropped priority
Group of 616 µm) came from a run that included it. Its compaction stage is **not** reproduced on
this build — the two known failure signatures in `script-method-playbook.md` §6 happen precisely in
that stage. Reading the entry script tells you what the customer's compaction was trying to do; it
does not tell you that compaction currently works here. Never present the retained figures as
something this build's compaction has achieved.

## Three rules

1. **Never source a reference artifact as a candidate.** The entry script and every file in
   `referenceFiles` are read-only Site material; `source`-ing one of them inside a stage would make
   your candidate a replay of someone else's run, not your own round's work, and the Reader's
   session-log audit would not bind it to anything you actually ran.
2. **Never copy a reference number into a journal observation without re-measuring it with
   `stage-report`.** The retained 52,453 µm figure is a fact about a different run on different
   software state; your own round's drop length comes only from your own stage's boundary rows.
3. **Cite the reference file path and line when a stage reproduces one of its steps.** When your
   stage's compaction call mirrors the entry script's own compaction block, name the file and the
   line range in your journal's `observations` — this is what lets the next round's Engineer, and
   anyone reading the delivered report, tell a genuine reproduction from a coincidental similarity.
