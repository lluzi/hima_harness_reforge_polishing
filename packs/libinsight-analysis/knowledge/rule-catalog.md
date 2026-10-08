# Insight rule catalogue

Four example rules ship with the Pack as tested Python under `flow/libinsight_analysis/rules/`.
Each is a complete rule: it reads the data, finds the flagged items, writes the rule JSON
(`insight-rule-shape.md`) and the page draws it. When a request matches one of them, run it; when
it asks for something else, write a new rule on the same pattern (`insight-playbook.md`).

| Rule id | Kind | Score part | One-sentence rule | It reads | Example request |
| --- | --- | --- | --- | --- | --- |
| `vmin_bottleneck` | vmin | Robustness | Flag a cell when its delay grows more than the reference inverter's (by more than the watch level, default 5 %) as the supply drops from the higher to the lower voltage at the slow corner, at each temperature. | facts at two voltages × the temperatures, every variant; cell netlists for the brief (optional) | "Which cells limit my Vmin?" · "Which cells slow down more than the inverter at 0.72 V?" |
| `size_coverage_gaps` | gaps | PPA | Flag a function when two neighbouring drive strengths of one variant are more than the gap ratio apart (default 1.9×), so the optimiser has no size in between. | facts at one corner, every variant | "Where are drive strengths missing?" · "Which functions have size gaps?" |
| `critical_path_faster_cells` | path | none (design-specific) | For each cell on the worst failing paths, list the equivalent cells (same function, same track, any VT) that are faster at that instance's own slew and load; slower ones are don't-use candidates. | the design's timing report (and netlist), facts at the report's corner for the variants in use | "Which cells on my critical paths have faster drop-ins?" · "Make me a don't-use list for the setup repair." |
| `table_spikes_kinks` | spike | Quality | Flag a table point that sits further from the chord between its two neighbours (at their real slew and load values) than the tolerance, where its sibling tables stay smooth. | facts at the characterised corners, every variant | "Are there characterisation glitches in the tables?" · "Which tables have spikes?" |

The commands and their arguments are in `insight-playbook.md` §3.

## Words for the Guide

- "Vmin", "low voltage", "slows down more than the inverter", "ring oscillator does not see it" →
  `vmin_bottleneck`.
- "missing size", "gap in drive strength", "between D1 and D4", "over-sizing" → `size_coverage_gaps`.
- "critical path", "failing paths", "faster equivalent", "don't-use", "swap to LVT" →
  `critical_path_faster_cells`.
- "spike", "kink", "glitch", "not smooth", "re-characterise" → `table_spikes_kinks`.
- Anything else about library quality is a new rule: give it an id and one sentence saying what is
  flagged against what reference, and confirm that sentence with the person before starting.

Settings the person can change in words: the watch level, the voltages and temperatures, the
variants, the gap ratio, the number of paths, the tolerance. Put the agreed values in the question.
