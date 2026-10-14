# AndesCell agent playbook

You own the plan of the round: which arcs AndesCell generates and with which settings. The next step
generates exactly your arcs, so the round rests on this plan.

## Read first

- `himatimeRequirements` (`state/himatime-requirements.json`): the arcs HimaTime ranks, each with the
  rankings that name it and its what-if TNS and WNS gain.
- `qualibRequirements` (`state/qualib-requirements.json`): the cells the stock libraries cannot make
  faster, and the custom-cell constraints (footprint, input capacitance, LVS).
- `timingState`, `lessons`, `library` (cells already delivered).

## Plan

1. `python3 <campaign>/flow/andes_cli.py draft <campaign> andescell > plan.json` lists the arcs both
   lists allow (HimaTime's arcs whose cell Qualib lists) and AndesCell's settings: `iterations` 50
   (design-space iterations per arc) and `scale` 0.9 (an arc delay target 10 % below the stock
   cell's). The Site's AndesCell data is for these settings; others are refused.
2. `andescell generate --arcs plan.json --round <k> --iterations 50 --scale 0.9 --dry-run` prints
   what the generation would give. Keep its output as `dry_run.rpt`.
3. Plan every arc both lists allow and never add one outside them: AndesCell explores each arc and
   HimaTime keeps a cell only on its measured cell-level gain, so nothing is dropped before
   generation. Say in `reason` which arcs you expect to matter most and why.
4. Write `summary` and `reason`: how many arcs both lists allow, how many you plan, the settings and
   why.

## Write

- The plan (`hima-andes-plan/2`, see `requirements-format.md`), checked with the precheck.
- `reports/andescell-agent/r<k>/analysis.md`: the two lists, what both allow, the plan, the settings
  and why. Keep `dry_run.rpt` beside it. Deliver both as support.
