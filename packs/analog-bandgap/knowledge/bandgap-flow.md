# The bandgap flow

The Campaign sizes one bandgap reference in one PDK and signs it off in four stages. Every stage is
the Pack's own command on the Site; you (the design agent) propose sizes, and the stages measure.

| Step | Command | Writes | Judged by |
| --- | --- | --- | --- |
| Check simulator and PDK | `bg_cli.py bind <ws> <simulators> <pdkRoot> <pdk> kuijk-p5t-mirror` | `state/inputs.json` | (fails the Campaign if a file is missing) |
| Device tables | `bg_cli.py characterize <ws>` | `state/tables*.json`, `state/devices.json` | `tables-valid` |
| Design (you) | `draft`, `sim`, `precheck`, then delivery | `state/design.json` | `bg-design` Reader at delivery |
| Every corner | `bg_cli.py simulate <ws> schematic <8 spec numbers>` | `state/measure-schematic.json` | `meets-spec` |
| Monte Carlo | `bg_cli.py mc <ws> <N> <vbg> <tol%>` | `state/mc.json` | `mc-in-band` |
| Layout, DRC, LVS | `bg_cli.py layout <ws> <layoutTool> <c|rc>` | `state/layout.json`, `state/cell-post.spice` | `layout-clean` |
| After layout | `bg_cli.py simulate <ws> post <8 spec numbers>` | `state/measure-post.json` | `meets-spec` |
| Round record | `bg_cli.py record <ws> <8 spec numbers>` | `state/round.json`, `state/lessons.json`, `derived/` | `round-valid`, `signed-off` |

A stage that fails skips the later stages that round; the record says which line failed at which
corner (`pvtWhere`, `postWhere`), and the next round starts with you again, with the lessons.

## What each stage measures

- **Corners:** process tt, ss, ff, sf, fs (the PDK's MOS sections; the PNP and resistor follow the
  process corner) x temperature -40, 27, 125 C x supply 2.0 and 3.3 V. VBG at both supplies, the
  supply current enabled (IQ) and disabled (ISD, judged at 27 C), the box TC over a 5 C sweep, the
  loop gain broken between `go` and `g` (phase margin over every unity crossing; none is a miss),
  start-up from power-up and for two enable ramps (1 us, 50 us) until VBG enters +/- 2 % of its final
  value and stays, PSRR at 1 kHz.
- **Monte Carlo:** N runs on Spectre with the PDK's mismatch models at tt, 27 C, 3.3 V: mean, sigma,
  mean +/- 3 sigma against the band, with the Pelgrom estimate beside it.
- **Layout:** the Site's tool draws the netlist the Pack simulates (`bandgap_lb`), checks DRC with the
  PDK's Magic and KLayout decks and LVS with netgen and the PDK's KLayout deck, and extracts it
  (`c`: capacitance; `rc`: resistance and capacitance).
- **After layout:** the same benches on the extracted cell.

## Your own loop

`OTA_SIM=ngspice OTA_PDK_ROOT=<your PDK root> python3 <campaign>/flow/bg_cli.py sim <campaign>
design.json <tt|pvt|corner> spec.json ./sim` runs the same benches on your draft and prints the worst
values as JSON (`mc:<N>` needs Spectre). Use one corner while you iterate and `pvt` before you
deliver; your numbers are evidence of your loop, the Pack measures the delivery again.
