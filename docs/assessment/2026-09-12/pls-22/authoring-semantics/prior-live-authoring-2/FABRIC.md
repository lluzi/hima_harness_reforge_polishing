# authored-numeric — Fabric Record

## Files written

- `contract.yml`
- `graph.yml`
- `semantics.yml`
- `rules/options-asserted.yml`
- `rules/sum-correct.yml`
- `rules/acceptance-bound.yml`
- `readers/analysis-result.yml`
- `tools/prepare.sh`
- `tools/read-analysis-result.sh`
- `knowledge/analysis.md`

## Gaps

- `options.txt` is a contract output the spec does not name in its `Run contract`. The spec demands
  `options_asserted` be a typed value and not a comment, but the reader is launched with only
  `${REPORT}` and `${OUT}` — no argument carries the LIMIT, and a `result.txt` holding the integer
  alone carries no options. The option record written by the authored script beside its result, per
  `knowledge/analysis.md`, is the only in-band channel for that assertion. The author approved this
  mechanism under review; it is recorded here because it is not yet in `SPEC.md`'s own words.
- No explore node and no `choosers/<id>.yml` are written. The spec's `Choosers` section declares one
  generation, no chooser and no revisit; `Endings` declares convergence unreachable. A chooser here
  would be a move and a stage the author did not ask for, so none is written.

## Reviews

- `tools/prepare.sh` — "I approve the generated numeric prepare and reader scripts described above
  if their effects stay in the private Campaign workspace and implement the approved contract."
- `tools/read-analysis-result.sh` — "I approve the generated numeric prepare and reader scripts
  described above if their effects stay in the private Campaign workspace and implement the approved
  contract."
