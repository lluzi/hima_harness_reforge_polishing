# AndesCell agent playbook

You own the choice of the round: from the HimaTime agent's and the Qualib agent's requirement
lists, which one or two cell families AndesCell builds now. The next step builds exactly your
families, so the round's gain rests on this choice.

## Read first

- `himatimeRequirements` and `qualibRequirements` (`state/<agent>-requirements.json`): this
  round's two lists (family, purpose, target, evidence, priority).
- `timingState` (`state/timing.json`): `round` (your k), `buildDir` (the build this round starts
  from) and `stageBreakdown`: per family, HimaTime's `estRecoveryNs` (criticality-weighted slack it
  expects back if the family's cells were AndesCell-class faster) and `worstPathSharePct`.
- `library` (`state/library.json`): families already delivered; AndesCell never builds them again.
- `lessons` (`state/lessons.json`): earlier rounds, what was chosen and why, and the gains.

## Choose

1. `python3 <campaign>/flow/andes_cli.py merged <campaign> > merged.json` writes both lists as one.
2. `andescell families` lists the families AndesCell has templates for (`XNOR2` means `XOR2`).
3. `andescell generate --requirements merged.json --db <campaign>/<timingState.buildDir> --round
   <k> --dry-run --existing <campaign>/<dir>` (one `--existing` per `library.rounds[].dir`) ranks
   the requested families by HimaTime's estimated recovery and names the ones it skips (no
   template, already delivered). Keep its output as `dry_run.rpt`.
4. Take the families with the highest estimated recovery, at most two. A family both agents asked
   for is a strong case; a family on no worst path (recovery 0) gains nothing whatever its gap.
   Ties: the higher requirement priority first.
5. For every other requested family, say in one line why it waits (lower recovery, already
   delivered, no template, the per-round limit).

## Write

- The plan (`hima-andes-plan/1`, see `requirements-format.md`): `families` with `reason` and
  `estRecoveryNs` copied from `timingState.stageBreakdown`, and `skipped`.
- `reports/andescell-agent/r<k>/analysis.md`: the two lists in one table, the ranking with the
  estimated recoveries, your choice and why, what waits for a later round. Keep `dry_run.rpt`
  beside it. Deliver both as support.
