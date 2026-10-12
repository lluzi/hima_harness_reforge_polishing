# Evidence and claims

**A result is what the Site's simulator measured on a design the Pack accepted.** Every gain, GBW,
phase margin, power, saturation and margin a person sees comes from `simulate-source`,
`simulate-target` or `record-round`, which run the PDK's measuring simulator (Cadence Spectre or
ngspice, named in every measurement) on the accepted design file with the bound PDK's model files
(their SHA-256 are in `state/inputs.json`).

**A claim is what an agent says.** The summary, the reason and the analysis are the agents' words.
Numbers an agent's own `sim` printed are evidence of its loop, not results: the Pack measures the
delivered file again. A design file cannot carry a performance number at all: its fields and its
`intent` are design choices only, and the devices must follow the intent.

**Unknown is not zero and not a pass.** A measurement the simulator did not produce at some corner
is unknown; the judge treats an unknown line as not met.

## The claim boundary

Every number is the Site simulator's (Spectre or ngspice, as each measurement states) on the stated PDK models at the stated corners,
schematic level with an ideal bias current, Cc, Rz and load; no layout parasitics, mismatch or Monte
Carlo; not silicon. A migrated design that meets the spec here is a schematic-level port: layout,
extraction and post-layout simulation are the next steps, not part of this Pack.

Synthetic test PDKs (`synth180`, `synth130`) are made-up models for testing the Pack itself; results
on them describe no real process.
