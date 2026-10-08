# Insight playbook: from a request to a rule page

A library-quality request ends on a three-column Library Insight page: left Data insight (the
library score, the rules checked, the selected rule's library overview), middle Cell insight (the
flagged items, worst first), right Impact & action (what it costs, what to do, and a file to run).
Your job is the data. The Pack's fixed template draws the page, so you write one rule JSON and
never HTML, SVG or chart code.

## 1. Request → rule

1. Read the question in the prepared request. The Guide puts the rule first: an id and one
   sentence saying what is flagged against what reference, then the person's words and settings.
2. If the id is one of the four in `rule-catalog.md`, run that rule (§3) with the settings asked
   for. Do not rewrite it.
3. Otherwise write a new rule (§5): an id (`^[a-z][a-z0-9_]{2,47}$`) and one sentence. Keep the
   sentence the Guide proposed; if the data forces a change, say so in `limits`.

## 2. Which data, in this order

1. **The facts corpus** (`factsCorpus` in the prepared request): QuaLib-extracted
   `lib-insight-facts/1` files, no licence needed. Find the variants and corners by file name and
   by `library.operating_conditions`. Load one file at a time.
2. **Live QuaLib extraction** only when a needed Liberty file has no facts file and the licence
   mode is `new` (`qualib-api-playbook.md` §2–§4).
3. **Design and cell inputs** under `/data/eda/project/hima_harness/libinsight-runs/inputs/`: a
   design's timing report and netlist (for path rules) and cell transistor netlists (for the
   `redesign_cell` brief).

Hash every file you read before and after (`qualib-api-playbook.md` §7), and list it in
`sources`. Missing data stops the rule with an honest `blocked` delivery, never a partial page
shown as clean.

## 3. Run a rule

First read `/data/eda/project/hima_harness/libinsight-runs/inputs/KITS.md` on the Site: for each
kit it names the variants with their facts-file globs, the corners on file, the naming profile and
the design inputs. Then, from your private workspace (`CW` is the Campaign workspace):

```sh
python3 $CW/flow/libinsight_cli.py insight-delivery --rule vmin_bottleneck -- \
    --facts 9T-SVT='<corpus>/<variant glob>*ssg*' --facts 9T-HVT='...' ... \
    --hi 0.81 --lo 0.72 --temps=-40,125 --watch 5 --naming dnum \
    --netlist <inputs>/<cell netlists>.spi --library '<kit line>'

python3 $CW/flow/libinsight_cli.py insight-delivery --rule size_coverage_gaps -- \
    --facts <VARIANT>=<one corner file per variant> ... --naming dnum --library '<kit line>'

python3 $CW/flow/libinsight_cli.py insight-delivery --rule critical_path_faster_cells -- \
    --report <inputs>/<design>/<report>.tarpt.gz --netlist <inputs>/<design>/<netlist>.v \
    --facts <VARIANT>=<the report's corner file> ... --naming dnum --library '<kit line>'

python3 $CW/flow/libinsight_cli.py insight-delivery --rule table_spikes_kinks -- \
    --facts <VARIANT>=<corner glob> ... --naming dnum --library '<kit line>'
```

Write `--temps=` with `=`; its value starts with a minus sign. Each rule prints its headline, and
`--help` on a rule module lists every setting (`python3 -m libinsight_analysis.rules.<rule> --help`
from `$CW/flow`). A delivery names at most 64 sources, so give a rule only the files it needs.

One command runs the rule, writes
`analysis-result.json` with the rule as its `insight` block (plus a table of the flagged items, the
sources, the code that ran and the command), writes `resident-delivery.json`, and runs the
delivery check. Read its output: `accepted …` or one problem per line.

## 4. Writing rules (every string on the page)

- Plain English for a library user: cell, arc, corner, derate, slew, load, drive, variant. No
  internal names, field names, check numbers or code identifiers in `summary`, `result`, `rule`,
  `facts`, `impact`, `todo`, `hint`, `focus` or the brief.
- Numbers carry units and a sign where it matters (`+16.0%`, `−8 ps`, `0.72 V`, `−40 °C`).
- `result` is the headline: a count and the worst case (`815 cells flagged · worst +16.0%`).
- `focus` is one sentence per item: what is wrong with it, with its numbers, and the simplest fix.
- `impact` says what it does to a design (timing, area, power, monitors); `todo` says who does
  what, in order (chip designer, cell designer, library provider), with one `note` at most.
- Never present an unknown as zero. Say what was not checked in `limits`.

## 5. A new rule

Copy the closest example module from `flow/libinsight_analysis/rules/` into `analysis/` under a
new name, keep its `run(...)` signature and helpers, change only the finding, and return a rule of
one of the four kinds (`vmin`, `gaps`, `path`, `spike`). Pick the kind whose layout fits:

| The question compares … | Kind |
| --- | --- |
| each cell against a reference across a condition (voltage, temperature) | `vmin` |
| sizes within a function family | `gaps` |
| cells in use in a design against their equivalents | `path` |
| points inside one table against their neighbours | `spike` |

Run it with the same command and `--module analysis/<file>.py`.

## 6. Colour roles (the template applies them; use the matching fields)

Red = a problem (flagged items, `result`), dark ring = the selected item, dashed dark = the
reference (the inverter, the cell in use), green = a candidate or better choice, grey =
everything else. Order `items` worst first.

## 7. Score

`score = {dimension, affected, checked, weight}`. A rule costs
`weight × min(1, (affected / checked) / 0.05)` points from its part (Quality, PPA or Robustness),
so it costs its full weight once 5 % of the checked subjects are flagged. Use weight 6 for real
problems and 4 for opportunities; a design-specific rule has `dimension: none` and never changes
the score. `checked` is what you actually checked (cells, function sets, tables), not the library
size.

## 8. Action files (the template generates them from your data)

| Kind | File | Line per target |
| --- | --- | --- |
| vmin | `derate_low_voltage.sdc` | `set_timing_derate -late <1 + extra/100> [get_lib_cells */<cell>]`, for runs below the higher voltage |
| vmin | `redesign_<cell>.md` | the `redesign_cell` brief (below) |
| gaps | `roadmap_gaps.csv` | `function,variant,below,above,jump,suggested_drive,suggested_area` |
| path | `dont_use_critical.tcl` | `set_dont_use [get_lib_cells */<cell>]` for every cell the user marks; scope: the setup-repair step only, then reset |
| spike | `recharacterise.csv` | `variant,corner,cell,arc,when,table,point` |

The `redesign_cell` brief is for the cell designer, one cell and one arc, five parts:

1. **What is wrong:** the arc, the symptom, the number now and the target, and what it is compared
   with.
2. **Where in the circuit:** from the cell's transistor netlist, the devices the arc's input
   drives, their place in the stack counted from the output, W/L and fingers, and the same devices
   in the sibling sizes. Without a netlist the brief says so and stays at arc level.
3. **What to change:** one to four levers, each with its expected effect (`qualitative` when not
   computed). For a Vmin bottleneck: widen the deepest series stack on the arc's path; reorder the
   stack so the late input sits next to the output; split a deep stack into two stages.
4. **What it costs:** area, input capacitance and leakage change, estimated from sibling sizes.
5. **How to check it:** re-characterise the arc at the named corners, re-run the rule, pass when
   the number is within the target.
