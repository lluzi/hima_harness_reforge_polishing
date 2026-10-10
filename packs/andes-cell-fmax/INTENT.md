## Business

A chip designer wants `aes_cipher_top` (28 nm, stock library `std9t_svt`, 1.000 ns clock) to run
faster without touching the RTL or the clock, by adding custom standard cells to the library. The
delivery is a new cell library and the evidence that it raises Fmax: a before/after table of the
new-library build against the reference build.

## Golden Flow

Start from an RTL2GDS flow (Synthesis and APR), post route, load the design into HimaTime. One
resident agent of HimaTime analyses the design's Fmax and, at the same time, a Qualib resident agent
analyses the cell library and the design's critical-path information. These two branches propose
standard-cell customization requirements, fed to AndesCell for generation. After generation the new
cells go to a Qualib cell screen and are then verified by HimaTime. The delivered new library is fed
to the RTL2GDS flow and yields better Fmax. Loop rounds until the target.

## Answers

- Tools on screen: AndesCell (cell generation), HimaTime (STA), Synthesis and APR (synthesis + APR),
  Qualib (library analysis, cell screen), XTop (timing ECO; installed on the Site, not a step).
- The tools run on the demo Site `eda_cluster_ctu_01` (user, 2026-10-10: a real App run with real
  agents and fast demo tools, several rounds in about an hour). The claim boundary in every round
  record and in the Report states that the EDA results are mock results.
- The AI agents are real OpenCode resident agents; they run the tools themselves in their sandbox.
- Goal: Fmax gain over the reference build of at least 5 % (default).

## Ambiguities resolved

- "Better Fmax" is 1000 / (1.000 ns − worst slack) of the new-library build against the reference
  build of the same design at the same clock; rounds accumulate cells, so each round's build has
  every earlier round's accepted cells.
- AndesCell builds at most two families per round and ranks the requested families by HimaTime's
  estimated recovery; a family that is on no worst path gains nothing, so the agents' analysis
  decides the result.
- Cells that fail the Qualib screen never enter a build (dont-use).

## Knowledge applied

- From the SKY130 custom-cell demo (2026-10-06): where the critical-path time goes (one XNOR3 stage
  on most worst paths, 3–7 buffers per path, slow rising edges through stacked AOI/OAI inputs), and
  that adding every candidate cell can make a design slower; only cells on the worst paths help.
- Requirements are claims until AndesCell, the Qualib screen, HimaHarness's own verify step and the
  rebuild measure them; the Reader, not the agent, produces every result number.
