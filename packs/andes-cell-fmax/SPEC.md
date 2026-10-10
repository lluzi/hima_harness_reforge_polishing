## Goal template

A Campaign of this Pack asks for new standard cells that make `aes_cipher_top` faster than its
reference build. Goal parameter `target_fmax_gain_pct` (percent, 0.1–30, default 1): the best valid
round's Fmax gain over the reference build must reach it. Strategy: `buildTimeoutMin` (min, default
20, per Synthesis and APR run) and `roundRevision` (count, the round counter the chooser advances).

## Constraints

- Site `eda_cluster_ctu_01` (or a Site binding `edaRoot`, `designRoot`, `stockLibrary`,
  `engineeringCapabilities`): the toolchain and design are read-only; Campaigns write only under
  `workspaceRoot`; at most three Site jobs at once (two resident agents and one Reader fit).
- Reports (`contract.reports.dir: reports`): every step writes its human-readable reports to
  `reports/<node id>/r<k>/`; a resident agent's `artifactPrefix` is `reports/<its node id>`, so its
  delivered reports land in the same place. Charts (`hima-chart/1`, `<name>.chart.json`) sit beside
  them, written by the Pack's steps and by the Readers that accept agent deliveries from the tools'
  own output; three knowledge charts for the Guide are in `knowledge/charts/`
  (`flow/knowledge_charts.py` writes them from the Site's tools).
- Clock fixed at 0.500 ns (2 GHz); RTL and flow settings fixed; only new cells change the build.
- At most two new families per round (AndesCell); one round is expected, at most 2 (`generationLimit`).

## Run contract

Entry `bind-inputs` → `reference-build` → `read-reference` → `check-reference` (`reference-valid`)
→ `load-timing` → `read-timing` → propose fork {`himatime-agent` ∥ `qualib-agent`} (resident
OpenCode tasks; each `produces` its requirements file, Reader `andes-requirements`) →
`requirements-joined` (`requirements-valid`, per branch) → `andescell-agent` (resident; `produces`
the generation plan, Reader `andes-plan`) → `generate-cells` (AndesCell, exactly the plan's
families) → verify fork {`himatime-verify` ∥ `qualib-screen`} (resident; `produces` the cell timing
and the cell screen, Reader `andes-verify`) → `cells-verified` (`local-gain-positive`,
`cells-screened`, per branch) → `new-library-build` → `compare-round` → `read-round` →
`check-round` (`cells-used`, `round-improved`) → `read-round-goal` → `judge-round` (`round-valid`,
`fmax-goal`) → `next-round` (explore, chooser `andes-next`, revisit `load-timing`). Autopilot
segments: bind→read-timing (which opens the propose fork), `requirements-joined` (until
`andescell-agent`), `generate-cells` (which opens the verify fork), `cells-verified`→`judge-round`.
The owner drives the five resident nodes (begin, `engineering start`, delivery, release, complete)
and decides `next-round`. FAIL or UNDETERMINED at any join or at `check-reference` goes to `blocked`.
Budget: time box 3 h with a 10 min closing reserve; `generationLimit: 2`; converge on
`best_fmax_mhz` (band 0.001 MHz, 2 generations).

The strip (`graph.yml view`): `rtl2gds` (row 0; bind through read-timing, `cells-verified`, the
rebuild through `next-round`), `himatime` and `qualib` (row 1; propose and verify), `andescell`
(row 2; `requirements-joined`, `andescell-agent`, `generate-cells`); `blocked` hidden.

Charts (`hima-chart/1`), one per step beside its reports:

| Step | File under `reports/<step>/r<k>/` | Written by | Shows |
| --- | --- | --- | --- |
| `reference-build` | `timing.chart.json` | `andes_cli.py reference` (`himatime report --json`) | slack of the 8 worst paths |
| `load-timing` | `stage-breakdown.chart.json` | `andes_cli.py timing` | share of the worst path's delay by cell family |
| `himatime-agent` | `proposal.chart.json` | Reader `andes-requirements` on acceptance | "Why these cells: timing": worst-path share (%) and slack back (ps) per requested family |
| `qualib-agent` | `proposal.chart.json` | Reader `andes-requirements` on acceptance (`qualib list --json`) | "Why these cells: library FO4 ...": stock FO4 against the AndesCell target (ps) |
| `generate-cells` | `generation.chart.json` | `andes_cli.py generate` | each new cell's FO4 against its stock cell |
| `himatime-verify` | `local-gain.chart.json` | Reader `andes-verify` on acceptance (`himatime verify --json`) | worst-path slack before and with the new cells |
| `qualib-screen` | `screen.chart.json` | Reader `andes-verify` on acceptance (`qualib screen --json`) | area, input cap and leakage as a share of each screen limit |
| `compare-round` | `before-after.chart.json` | `andes_cli.py compare` | Fmax, worst slack and TNS, reference against new library |

Knowledge charts (`knowledge/charts/`): `stage-breakdown`, `worst-paths`, `library-fo4`. A chart
carries no timestamp: the same tool output always gives the same bytes.

## Semantics

`design_fmax_mhz` = 1000 / (0.500 − WNS) from the sapr post-route summary (reference build via
`andes-reference`, new-library build via `andes-round`). `fmax_gain_pct` = new-library Fmax /
reference Fmax − 1; `best_gain_pct` = best valid round's; `best_fmax_mhz` monotone. `round_valid`:
the build finished at the reference clock, route DRC 0, only screened and verified new cells used.
`round_improved`: valid and faster than every earlier build. `new_cell_instances`: AndesCell cell
instances in the routed netlist. `local_gain_ps` = HimaTime's delay of the worst path of the build
the round started from, before minus after the new cells (`himatime verify --paths 8`), and
`cells_passed_screen` = cells that pass `qualib screen`; both are the tools' numbers, stated by the
Reader on either verify branch. `plan_valid`, `verify_delivery_valid`: a delivery passed its check.

## Judge rules

- `reference-valid`: `reference_valid` = 1.
- `requirements-valid` (join, per branch): `requirements_valid` = 1.
- `local-gain-positive` (join, per branch): `local_gain_ps` > 0 ps. `cells-screened`:
  `cells_passed_screen` ≥ 1.
- `cells-used`: `new_cell_instances` ≥ 1. `round-improved`: `round_improved` = 1.
- `round-valid` (constraint): `round_valid` = 1. `fmax-goal` (Goal): `best_gain_pct` ≥ target.

## Choosers

`andes-next` at `next-round`: constraint PASS and Goal PASS → goal met (expected after round 1);
otherwise `next: {roundRevision: roundStep}` (another round, at most one more). Reads `best_fmax_mhz` for convergence; changes
only the round counter.

## Endings

`ended-goal-met` (owner accepts goal-met), `ended-converged` (best Fmax flat over two rounds),
`ended-budget-exhausted` (round limit or time box), `ended-goal-not-met` (owner ends early);
`blocked` (wait) when the reference build, a delivery join or the local-gain check fails.

## Workshops

Five resident engineering Workshops per round, at most two at once: `himatime-agent` and
`qualib-agent` in parallel (requirements, `hima-andes-requirements/1`), then `andescell-agent`
(generation plan, `hima-andes-plan/1`), then `himatime-verify` and `qualib-screen` in parallel (cell
timing `hima-andes-cell-timing/1`, cell screen `hima-andes-cell-screen/1`). Each reads the state it
needs (`inputsState`, `timingState`, `lessons`, `library`, and the requirements or `generation`),
uses its playbook with `andes-flow.md`, `requirements-format.md` and `evidence-and-claims.md`,
prechecks with `andes_cli.py precheck`, and delivers one result with its reports under
`reports/<node id>/r<k>/`. A refused delivery is repaired in the same task.

## Knowledge

- `knowledge/andes-flow.md`
- `knowledge/andescell-playbook.md`
- `knowledge/design-notes.md` (the Guide's first conversation: bottleneck, cell-type delay, flow and library)
- `knowledge/evidence-and-claims.md`
- `knowledge/himatime-playbook.md`
- `knowledge/qualib-playbook.md`
- `knowledge/requirements-format.md`
