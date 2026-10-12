# Evidence and claims

**A result is what the Site's tools measured on a design the Pack accepted.** Every VBG, current,
temperature coefficient, phase margin, start-up time, PSRR, Monte Carlo spread, DRC count and LVS
verdict a person sees comes from `simulate-pvt`, `monte-carlo`, `layout`, `simulate-post` or
`record-round`. They run the PDK's measuring simulator (Cadence Spectre or ngspice, named in every
measurement) and the Site's layout tool (Magic, KLayout and netgen with the PDK's own decks) on the
accepted design file, with the bound PDK's model files (their SHA-256 are in `state/inputs.json`).
Every measurement carries the SHA-256 of the design it measured; the round record refuses one that
is not of the accepted design, and a post-layout result of another layout.

**A claim is what an agent says.** The summary, the reason and the analysis are the agent's words.
Numbers the agent's own `sim` printed are evidence of its loop, not results: the Pack measures the
delivered file again. A design file cannot carry a performance number: its fields and its `intent`
are design choices only, and the sizes must follow the intent.

**Unknown is not zero and not a pass.** A measurement the simulator did not produce at some corner
is unknown; the judge treats an unknown line as not met. A loop with no unity-gain crossing, or a
copy that did not start, is a miss.

## The claim boundary

Every number is the Site simulator's on the stated PDK's models at the stated corners, temperatures
and supplies, with an ideal bias current source. Monte Carlo covers the PDK's device mismatch at tt,
27 C, the higher supply (the high-resistance poly has no mismatch model). The layout is checked with
the open PDK's own DRC and LVS decks; die-level density rules need fill and are reported, not
judged; post-layout results use the stated extraction. Not silicon, no package stress, no trimming.

The synthetic test PDK (`synth180`) is made up for testing the Pack itself; results on it describe
no real process.
