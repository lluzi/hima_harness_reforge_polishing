## Goal template

A Campaign of this Pack asks for custom standard cells that make `openc910` (the OpenC910 dual-core
RISC-V CPU) faster than its reference build at the end of route. Goal parameter
`target_timing_gain_pct` (percent of the clock period, 0.1–30, default 1): the best valid round's
reg2reg worst-slack gain at route over the reference build must reach it. Strategy:
`buildTimeoutMin` (min, default 20, per Synthesis and APR run) and `roundRevision` (count, the round
counter the chooser advances).

## Constraints

- Site `eda_cluster_ctu_01` (or a Site binding `edaRoot`, `designRoot` = the Site's openc910 design
  data, `stockLibrary` = a label such as `n7-ulvt`, `engineeringCapabilities`): the toolchain and the
  design data are read-only; Campaigns write only under `workspaceRoot`; at most three Site jobs at
  once (two resident agents and one Reader fit).
- Reports (`contract.reports.dir: reports`): every step writes its human-readable reports to
  `reports/<node id>/r<k>/`; a resident agent's `artifactPrefix` is `reports/<its node id>`.
  Charts (`hima-chart/1`, `<name>.chart.json`) sit beside them, written by the Pack's steps and by
  the Readers that accept agent deliveries from the tools' own output.
- Generated knowledge: `knowledge/design-notes.md` and `knowledge/charts/*.chart.json` are written
  per Site by `python3 flow/knowledge_charts.py <EDA_ROOT>` from the Site's tools (template
  `knowledge/design-notes.template.md`) and are not in git; install them before the Pack is used.
- Clock fixed at 0.500 ns (2 GHz); netlist and flow settings fixed; only new cells change the build.
- The measure is the reg2reg worst slack at the end of route; no Fmax.
- AndesCell settings fixed by the Site's data: 50 iterations per arc, arc delay target ×0.9. The
  Site has build data for one custom-cell set: one round is the data's round; `generationLimit: 2`.

## Run contract

Entry `bind-inputs` → `reference-build` → `read-reference` → `check-reference` (`reference-valid`)
→ `load-timing` → `read-timing` → propose fork {`himatime-agent` ∥ `qualib-agent`} (resident
OpenCode tasks; each `produces` its requirements file, Reader `andes-requirements`) →
`requirements-joined` (`requirements-valid`, per branch) → `andescell-agent` (resident; `produces`
the generation plan, Reader `andes-plan`) → `generate-cells` (AndesCell, exactly the plan's arcs) →
verify fork {`himatime-verify` ∥ `qualib-screen`} (resident; `produces` the cell-level check and the
cell screen, Reader `andes-verify`) → `cells-verified` (`cells-gain-positive`, `cells-screened`,
per branch) → `new-library-build` → `compare-round` → `read-round` → `check-round` (`cells-used`,
`round-improved`) → `read-round-goal` → `judge-round` (`round-valid`, `timing-goal`) → `next-round`
(explore, chooser `andes-next`, revisit `load-timing`). Autopilot segments: bind→read-timing (which
opens the propose fork), `requirements-joined` (until `andescell-agent`), `generate-cells` (which
opens the verify fork), `cells-verified`→`judge-round`. The owner drives the five resident nodes
(begin, `engineering start`, delivery, release, complete) and decides `next-round`. FAIL or
UNDETERMINED at any join or at `check-reference` goes to `blocked`. Budget: time box 3 h with a 10
min closing reserve; `generationLimit: 2`; converge on `best_wns_ps` (band 0.5 ps, 2 generations).

The strip (`graph.yml view`): `rtl2gds` (row 0; bind through read-timing, `cells-verified`, the
rebuild through `next-round`), `himatime` and `qualib` (row 1; propose and verify), `andescell`
(row 2; `requirements-joined`, `andescell-agent`, `generate-cells`); `blocked` hidden.

Charts (`hima-chart/1`), one or more per step beside its reports (`knowledge/andes-flow.md` lists
what each shows):

| Step | File under `reports/<step>/r<k>/` | Written by |
| --- | --- | --- |
| `reference-build` | `summary` (metrics), `path-groups` (metrics), `flow-stages`, `timing` | `andes_cli.py reference` (sapr summary, `himatime report --json`) |
| `load-timing` | `stage-breakdown` | `andes_cli.py timing` (HimaTime's worst-path breakdown) |
| `himatime-agent` | `funnel` (metrics), `proposal` | Reader `andes-requirements` on acceptance (`himatime whatif --json`, the high-value summary) |
| `qualib-agent` | `proposal` | Reader `andes-requirements` on acceptance (`qualib list --arcs --json`) |
| `generate-cells` | `generation` (metrics) | `andes_cli.py generate` (AndesCell's generation.json) |
| `himatime-verify` | `cell-check`, `top-cells` (metrics) | Reader `andes-verify` on acceptance (`himatime verify --json`, `qualib screen --json`) |
| `qualib-screen` | `screen` (metrics) | Reader `andes-verify` on acceptance (`qualib screen --json` of the kept cells) |
| `compare-round` | `comparison` (metrics), `flow-stages`, `path-groups` (metrics), `worst-paths` | `andes_cli.py compare` (both sapr summaries) |

Knowledge charts (generated, `knowledge/charts/`): `reference-summary`, `path-groups`,
`flow-stages`, `worst-paths`, `stage-breakdown`, `library-vt`, `high-value-families`. A chart
carries no timestamp: the same tool output always gives the same bytes.

## Semantics

`design_wns_ps`, `design_tns_ns`, `design_nvp` (reg2reg at route), `design_density_pct`,
`new_cell_instances`, `new_cell_pct` from the sapr summary (reference build via `andes-reference`,
custom-cell build via `andes-round`). `reference_valid` = 1 when the reference build finished the
flow through route with a summary. `timing_wns_ps`, `timing_high_value_cells` (`andes-timing`).
`requirements_valid`, `requirements_count` (arcs for HimaTime, cells for Qualib). `plan_valid`,
`plan_arcs`. `verify_delivery_valid`, `cells_kept` (HimaTime's cell-level check),
`cells_passed_screen` (Qualib's screen of the kept cells), the tools' numbers on either verify
branch. `timing_gain_pct` = 100 × (WNS_new − WNS_ref) / clock period at route; `best_gain_pct` = the
best valid round's; `best_wns_ps` monotone. `round_valid`: the build finished at the reference
clock and stage with only kept-and-screened cells. `round_improved`: valid and its worst slack
better than every earlier build's by more than 0.5 ps.

## Judge rules

- `reference-valid`: `reference_valid` = 1.
- `requirements-valid` (join, per branch): `requirements_valid` = 1.
- `cells-gain-positive` (join, per branch): `cells_kept` ≥ 1. `cells-screened`: `cells_passed_screen` ≥ 1.
- `cells-used`: `new_cell_instances` ≥ 1. `round-improved`: `round_improved` = 1.
- `round-valid` (constraint): `round_valid` = 1. `timing-goal` (Goal): `best_gain_pct` ≥ target.

## Choosers

`andes-next` at `next-round`: constraint PASS and Goal PASS → goal met (expected after round 1);
otherwise `next: {roundRevision: roundStep}` (another round, at most one more; the Site refuses a
second custom-cell set, so a second round ends blocked at its rebuild). Reads `best_wns_ps` for
convergence; changes only the round counter.

## Endings

`ended-goal-met` (owner accepts goal-met), `ended-converged` (best worst slack flat over two rounds),
`ended-budget-exhausted` (round limit or time box), `ended-goal-not-met` (owner ends early);
`blocked` (wait) when the reference build, a delivery join or the cell-level check fails.

## Workshops

Five resident engineering Workshops per round, at most two at once: `himatime-agent` and
`qualib-agent` in parallel (requirements, `hima-andes-requirements/2`: arcs, or cells with
constraints), then `andescell-agent` (generation plan, `hima-andes-plan/2`), then `himatime-verify`
and `qualib-screen` in parallel (cell-level check `hima-andes-cell-check/1`, cell screen
`hima-andes-cell-screen/2`). Each reads the state it needs, uses its playbook with `andes-flow.md`,
`requirements-format.md` and `evidence-and-claims.md`, drafts its delivery from the tool's own
output with `andes_cli.py draft`, prechecks with `andes_cli.py precheck`, and delivers one result
with its reports under `reports/<node id>/r<k>/`. A refused delivery is repaired in the same task.

## Knowledge

- `knowledge/andes-flow.md`
- `knowledge/andescell-playbook.md`
- `knowledge/design-notes.md` (generated per Site: the Guide's first conversation)
- `knowledge/evidence-and-claims.md`
- `knowledge/himatime-playbook.md`
- `knowledge/qualib-playbook.md`
- `knowledge/requirements-format.md`
