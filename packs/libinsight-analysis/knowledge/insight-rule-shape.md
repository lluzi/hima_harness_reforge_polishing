# Insight rule shape (`insight` block)

An insight rule is one JSON object. The resident writes it as the `insight` block of its
`hima-libinsight-analysis/1` delivery. The Pack's fixed page template draws it, and the Host shows
it on the analysis page next to the other accepted rules of the project. You write data only.
Never write HTML, SVG or chart code: the template draws every chart, so every page looks the same.

`check-delivery` (and the Reader) run `insight_page.check_rule` on the block, and a problem returns
to you like any other delivery problem.

Units: delay and slew ps, load and capacitance fF, area µm², voltage V, temperature °C. Leakage is
nW where the rule says so; otherwise it is the library's own unit, and the rule's `facts` must say
which. Every number is finite: use `null` for unknown, never `NaN`, and never 0 in place of
missing.

## Common fields (every kind)

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `^[a-z][a-z0-9_]{2,47}$` | the rule's name, e.g. `vmin_bottleneck` |
| `kind` | `vmin` \| `gaps` \| `path` \| `spike` | which page layout draws it |
| `title` | string ≤ 80 | short human title |
| `summary` | string ≤ 200 | what the rule looks for, one sentence (card text) |
| `result` | string ≤ 120 | the headline result, e.g. `815 cells flagged · worst +16.0%` (shown red on the card) |
| `rule` | string ≤ 400 | the rule sentence: what is flagged and against what reference |
| `library` | string ≤ 160 | the header line, e.g. `Demo library · 3 variants · 4 corners · 120 cells` |
| `facts` | `[[label, value]]`, ≤ 12 | library-level key figures; values are strings or numbers |
| `score` | `{dimension, affected, checked, weight}` | `dimension` ∈ `quality`, `ppa`, `robustness`, `none`; `affected` ≤ `checked`, both integers ≥ 0; `weight` 0–30 |
| `impact` | `[[label, text]]`, 1–5 | "Impact on your design" (e.g. `["Timing", "Up to +16% more delay at 0.72 V than ..."]`) |
| `todo` | `[{who, text}]`, 1–5 | "What to do", in order; `who` ∈ `chip_designer`, `cell_designer`, `library_provider`, `note` |
| `hint` | string ≤ 300, optional | caption under the library overview |
| `items` | list, ≥ 0 | the flagged things, worst first (kind-specific shape below); ≤ 400 |

Every item has `label` (how the page names it, ≤ 60) and `focus` (≤ 400): one plain sentence for
the right column that says what is wrong with this item, with its numbers.

## `vmin`

| Field | Meaning |
| --- | --- |
| `hi`, `lo` | the two supply voltages compared (V), `hi` > `lo` |
| `temps` | the temperatures as strings, e.g. `["-40", "125"]` |
| `watch` | the flag threshold, % extra slowdown versus the reference inverter |
| `rows` | per variant `{v, b: box, n: flagged count, dots: [extra %]}` |
| `fan` | `{"<variant>\|<temp>": {volts: [V...], inv: [ratio per volt], boxes: [box per volt]}}` |
| `clsbox` | `{"<variant>\|<temp>\|<class>": {n, boxes: [box per volt]}}` |

`box` = `{p5, p25, p50, p75, p95, mn, mx, n}`.
Item: `{name, label, v, t, x, cls, extra: {"<temp>": %}, fan: {"<temp>": [delay ratio per volt]}, focus, brief?}`.
`x` is the item's worst extra % and `t` the temperature where it is worst.

The `.sdc` file is `set_timing_derate -late <1 + x/100, 2 decimals> [get_lib_cells */<name>]` per
flagged cell (the variant filter applies), with a header comment that names the rule and says
"use for runs below <hi> V".

`brief` is the `redesign_cell` design brief for the cell designer, for one cell and one arc:

| Field | Meaning |
| --- | --- |
| `cell`, `arc` | the cell and the arc, e.g. `A2→ZN fall` |
| `symptom` | what is wrong, in words |
| `now`, `target`, `unit` | the number now and the target, e.g. `16.0`, `5.0`, `% extra slowdown` |
| `compare` | what it is compared with (the reference inverter, the class box, sibling sizes) |
| `where` | where in the circuit, from the cell's transistor netlist; `null` when there is no netlist |
| `levers` | `[{change, effect}]`, 1–4: a concrete change and its expected effect (`effect` is `qualitative` when not computed) |
| `cost` | `[[label, value]]`: area, input capacitance and leakage change estimated from sibling sizes |
| `check` | how to check the fix: which arc and corners to re-characterise, which rule to re-run, the pass level |

The template renders it as `redesign_<cell>.md` with five parts in this order: What is wrong ·
Where in the circuit (without a netlist it says so and the brief stays at arc level) · What to
change · What it costs · How to check it.

## `gaps`

| Field | Meaning |
| --- | --- |
| `matrix` | `{tracks: [..], vts: [..], counts: [[count or null per vt] per track]}` |

Item: `{label, cls, v, ratio, vts, i, cells: [{name, s, drive, area, leak, d4, d16}], lo, hi, miss: {drive, area}, pen_area, pen_leak, weak, focus}`.
`cells` is the whole ladder of one function in one variant by drive, weakest first; `i` indexes
the lower cell of the gap; `lo`/`hi` are the cells on each side (copies of ladder entries);
`ratio` the drive jump `hi.drive / lo.drive`; `vts` how many VTs share the same gap; `d4`/`d16`
the delay at 4× and 16× the cell's own input capacitance; `pen_*` and `weak` in %.

The `.csv` file (`roadmap_gaps.csv`) has the header `function,variant,below,above,jump,suggested_drive,suggested_area`.

## `path`

| Field | Meaning |
| --- | --- |
| `design` | `{name, lib, flow, corner, fail, wns}`: design, library, flow stage, the report's corner, failing paths, worst slack ps |
| `paths` | `[{slack, start, end, total, gain, rows: [stage]}]`, worst first |

Stage: `{inst, cell, s, arc, d, cls, op: {slew, load, from}, nfast, best, eq: [{name, s, vt, d, a, l}], focus}`.
`d` is the stage delay from the report; `op` is the instance's own operating point (input slew ps,
output load fF) and `from` is `report` or `fo4` (the labelled fallback: 4× the cell's own input
capacitance). `eq` lists the equivalent cells (same function, same track, any VT; flops by
functional signature), each with its delay `d` **at this stage's operating point**, area `a` and
leakage `l`; the cell in use is among them. `nfast` counts the faster ones, `best` is the fastest
delay. `gain` per path is the delay saved if every stage took its fastest equivalent.

The `.tcl` file (`dont_use_critical.tcl`) is `set_dont_use [get_lib_cells */<cell>]` per cell the
user marks on the page, grouped by class with a comment, under a header comment that names the
rule, the design and the scope (the setup-repair step only, then reset).

## `spike`

| Field | Meaning |
| --- | --- |
| `by_variant`, `by_kind`, `by_family` | `[[label, count]]` |

Item: `{name, label, v, ratio, corner, corners, kind, arc, when, pos: [i, j], label_pos, xname, axes: [slew ps[], load fF[]], vals: [[..]], res: [[..]], tol, slice: {x, y, k, at, others: [{label, y}]}, observed, expected, tolx, verdict, focus}`.
`res` is the roughness: the distance from the chord between the two neighbours at their real axis
values, in tolerance units. `ratio` is the worst roughness over the tolerance.

The `.csv` file (`recharacterise.csv`) has the header `variant,corner,cell,arc,when,table,point`.

## Score

The page computes the library score from every shown rule's `score`:

- per rule: `points = weight × min(1, (affected / checked) / 0.05)`; `checked = 0` costs nothing;
- Quality, PPA and Robustness each = 100 − the sum of their rules' points (floor 0); a part with
  no rule reads "not scored";
- overall = 50 % Quality + 30 % PPA + 20 % Robustness over the scored parts (weights renormalised);
- `dimension: none` (design-specific rules) never changes the score.

Default weights: 6 for a rule that finds real problems, 4 for an opportunity.
