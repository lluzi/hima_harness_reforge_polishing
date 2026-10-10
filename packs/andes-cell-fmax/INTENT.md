## Business

A chip designer wants `aes_cipher_top` (28 nm, stock library `std9t_svt`, 1.000 ns clock) to run
faster without touching the RTL or the clock, by adding custom standard cells to the library. The
delivery is a new cell library and the evidence that it raises Fmax: a before/after table of the
new-library build against the reference build.

## Golden Flow

Start from an RTL2GDS flow (Synthesis and APR), post route, load the design into HimaTime. One
resident agent of HimaTime analyses the design's Fmax and, at the same time, a Qualib resident agent
analyses the cell library and the design's critical-path information. These two branches propose
standard-cell customization requirements and merge into an AndesCell resident agent, which chooses
the cells to generate; AndesCell generates them. The new cells go back to the HimaTime agent, which
re-times the worst paths with them and must measure a positive local gain, and to the Qualib agent,
which screens each cell. The cells that pass are fed back to the RTL2GDS flow and yield better Fmax.
Loop rounds until the target.

Version 0.2 (user, 2026-10-10, the strip demo): "The flow starts with a baseline RTL2GDS flow, then
HimaTime agent and Qualib agent two branches split, merged to AndesCell agent, fed back to HimaTime
agent and Qualib agent with a measured local positive gain, then fed back to the RTL2GDS flow." The
App draws it as four stations in a phone-width strip; every step leaves its tool reports where the
App's Reports tab reads them.

## Answers

- Tools on screen: AndesCell (cell generation), HimaTime (STA), Synthesis and APR (synthesis + APR),
  Qualib (library analysis, cell screen), XTop (timing ECO; installed on the Site, not a step).
- The tools run on the demo Site `eda_cluster_ctu_01` (user, 2026-10-10: a real App run with real
  agents and fast demo tools, several rounds in about an hour). The claim boundary in every round
  record and in the Report states that the EDA results are mock results.
- The AI agents are real OpenCode resident agents; they run the tools themselves in their sandbox.
  Five resident steps a round: HimaTime and Qualib propose, AndesCell chooses, HimaTime and Qualib
  verify. At most two run at once, within the Site's three job slots.
- Reports: each node's human-readable tool reports and each agent's analysis live at
  `reports/<node id>/r<k>/` in the Campaign workspace; the App shows them in small type in the strip
  (user, 2026-10-10). Nothing on screen says "mock"; the claim boundary stays in the round records,
  the summary and the Report.
- Goal: Fmax gain over the reference build of at least 5 % (default).

## Ambiguities resolved

- "Better Fmax" is 1000 / (1.000 ns − worst slack) of the new-library build against the reference
  build of the same design at the same clock; rounds accumulate cells, so each round's build has
  every earlier round's accepted cells.
- AndesCell builds at most two families per round. The AndesCell agent chooses them from both
  lists by HimaTime's estimated recovery; a family that is on no worst path gains nothing, so the
  agents' analysis decides the result.
- "Local gain" is HimaTime's re-timing of the worst paths of the build the round started from with
  the new cells: the worst path's delay before minus after, in ps. It must be above 0 ps, and at
  least one cell must pass the Qualib screen, before the rebuild.
- Cells that fail the Qualib screen never enter a build (dont-use).

## Knowledge applied

- From the SKY130 custom-cell demo (2026-10-06): where the critical-path time goes (one XNOR3 stage
  on most worst paths, 3–7 buffers per path, slow rising edges through stacked AOI/OAI inputs), and
  that adding every candidate cell can make a design slower; only cells on the worst paths help.
- Requirements are claims until AndesCell, the Qualib screen, HimaTime's verification and the
  rebuild measure them; the Reader, not the agent, produces every result number. For the verify
  deliveries the Reader asks HimaTime and Qualib again and refuses numbers that disagree.
- Verify outside, equip inside (Hima as an agent OS, 2026-10-05): the agents run the tools and
  decide; the Pack's prechecks, Readers and judges hold their deliveries to the tools' own answers.
