## Business

A chip designer wants `openc910` (the OpenC910 dual-core RISC-V CPU, 7 nm-class stock libraries,
0.500 ns clock) to close timing better without touching the netlist or the clock, by adding custom
standard cells to the library. The delivery is a custom-cell library and the evidence that it
improves timing at the end of route: a before/after table of the custom-cell build against the
reference build.

## Golden Flow

Start from an RTL2GDS flow (placement, CTS and route), load the design into HimaTime. One resident
agent of HimaTime analyses the design's high-value cells and ranks their arcs by what-if gain and,
at the same time, a Qualib resident agent analyses the stock libraries for those cells. These two
branches propose customization requirements and merge into an AndesCell resident agent, which plans
the arcs to generate; AndesCell generates them. The new cells go back to the HimaTime agent, which
keeps the cells with a positive cell-level gain, and to the Qualib agent, which screens each kept
cell. The cells that pass are fed back to the RTL2GDS flow and yield better timing. Loop rounds
until the target.

Version 0.2 (user, 2026-10-10, the strip demo): "The flow starts with a baseline RTL2GDS flow, then
HimaTime agent and Qualib agent two branches split, merged to AndesCell agent, fed back to HimaTime
agent and Qualib agent with a measured local positive gain, then fed back to the RTL2GDS flow." The
App draws it as four stations in a phone-width strip; every step leaves its tool reports where the
App's Reports tab reads them.

Version 0.3.1 (user, 2026-10-10): "we need some data and chart and metric on the RTL2GDS flow, a
initial summary and ending with a comparison."

Version 0.4.0 (user, 2026-10-10): the demo runs on real DTCO data of OpenC910 that the user
supplied, replayed by the Site's tools; every number the App shows comes from that data, and the
displayed data and reports match each other exactly. Amendment (user, 2026-10-10): the comparison is
at the end of route (prePlace → place_opt → CTS → route), path group reg2reg; the measure is the
worst-slack gain as a share of the clock period; show off the real data (path groups, clock tree,
the high-value funnel, real cell names, the kept cells). No Fmax.

## Answers

- Tools on screen: AndesCell (cell generation), HimaTime (STA, high-value cells, cell what-if,
  cell-level check), Synthesis and APR (placement, CTS, route), Qualib (library analysis, cell
  screen), XTop (timing ECO; installed on the Site, not a step).
- The tools run on the demo Site `eda_cluster_ctu_01` and replay the design data installed there.
  The claim boundary in every round record and in the Report states the Site's basis; nothing on
  screen says "mock" or "model".
- The AI agents are real OpenCode resident agents; they run the tools themselves in their sandbox
  and draft their deliveries from the tools' own output. Five resident steps a round: HimaTime and
  Qualib propose, AndesCell plans, HimaTime and Qualib verify. At most two run at once.
- Reports: each node's human-readable tool reports and each agent's analysis live at
  `reports/<node id>/r<k>/` in the Campaign workspace.
- Goal: worst-slack gain at route of at least 1 % of the clock period (default); one round is
  expected to reach it, and the Campaign allows two.

## Ambiguities resolved

- "Better timing" is the reg2reg worst slack at the end of route of the custom-cell build against
  the reference build of the same design at the same clock, as a share of the clock period; TNS and
  violating paths are shown beside it.
- Agents deal in arcs (cell, from pin, to pin, edge): AndesCell builds one custom cell per arc.
  HimaTime's arcs are its merged what-if list; Qualib's are the cells the stock libraries cannot make
  faster; the plan is the arcs both allow.
- "Local positive gain" is HimaTime's cell-level check: a generated cell is kept when its arc beats
  the stock cell's. At least one cell must be kept, and at least one kept cell must pass the Qualib
  screen, before the rebuild.
- Cells that are not kept or fail the screen never enter a build.

## Knowledge applied

- From the SKY130 custom-cell demo (2026-10-06): where the critical-path time goes (one XNOR3 stage
  on most worst paths, 3–7 buffers per path, slow rising edges through stacked AOI/OAI inputs), and
  that adding every candidate cell can make a design slower; only cells on the worst paths help.
- Requirements are claims until AndesCell, the Qualib screen, HimaTime's verification and the
  rebuild measure them; the Reader, not the agent, produces every result number and every chart. For the verify
  deliveries the Reader asks HimaTime and Qualib again and refuses numbers that disagree.
- Verify outside, equip inside (Hima as an agent OS, 2026-10-05): the agents run the tools and
  decide; the Pack's prechecks, Readers and judges hold their deliveries to the tools' own answers.
