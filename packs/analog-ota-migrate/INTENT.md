## Business

An analog designer wants a two-stage Miller OTA that meets a spec sheet (DC gain, unity-gain
frequency, phase margin, power, at a stated load and input common mode) in one process, and the same
OTA ported to a second process where it meets the same spec at the new supply. The delivery is both
sized netlists and the simulator's evidence at every corner of both PDKs: a before-and-after table
against the spec. This is the first slice of "can HimaHarness do analog": spec-driven sizing,
migration and closed-loop optimization, with the designer's method shipped as code and playbooks.

## Golden Flow

Characterize both PDKs' core transistors on the Site's SPICE simulator (gm/Id, current density,
intrinsic gain, fT against gm/Id per length). A sizing agent turns the spec sheet into a first cut
with the textbook two-stage procedure in gm/Id form, simulates its own drafts and refines until every
corner meets every line. The Pack simulates the delivered design itself and the spec judge decides.
A migration agent ports the accepted design with the gm/Id-preserving method (same inversion levels
and currents, lengths at the same multiple of the minimum, widths from the target's tables), then
re-biases for the target's supply and devices against the simulator. The Pack simulates the port at
every target corner, records both designs against the spec, and the owner ends at the Goal or gives
the agents another round with the lessons.

## Answers

- Topology: two-stage Miller OTA, NMOS input, eight transistors, Miller Cc with nulling Rz (ideal
  passives and bias source). One topology in 0.1; others are later cards of the same method.
- Simulator (user, 2026-10-12: "use commercial tools, we have the Cadence analog toolchain"): the
  Site measures with Cadence Spectre wherever the PDK's decks read in Spectre (GF180MCU and the test
  PDKs do; SKY130 and IHP SG13G2 decks are ngspice-only and are measured with ngspice). The agents
  iterate with open ngspice in their sandbox through the Pack's own `sim` command; on the same BSIM4
  decks it agrees with Spectre to the reported digit (GF180MCU and the test PDKs, 2026-10-12). One
  piece of Pack arithmetic computes every measurement from either simulator's raw output.
- PDKs: GF180MCU 3.3 V (open, measured by Spectre) is the source; the target is open (IHP SG13G2
  1.2 V measured by ngspice is the proposal, pending the user's choice) or a customer's own Spectre
  PDK at their Site. Tests use two synthetic BSIM4 processes (`synth180`, `synth130`) committed as
  fixtures.
- Spec: Goal `min_gain_db` 60, `min_gbw_mhz` 10, `min_pm_deg` 60, `max_power_uw` 200 by default;
  strategy `loadPf` 2, `inputCmPct` 60. Judged at the worst corner of each PDK.
- Agents: two resident engineering agents (sizing, migration). They deliver sizes; the Pack measures.

## Ambiguities resolved

- "Meets the spec" is the worst corner over the PDK card's corners meeting every line, with every
  transistor saturated (|Vds| >= |Vdsat| + 50 mV). An unknown measurement never meets a line.
- "Migration" is a schematic-level port to the target's core devices; layout migration is out of
  scope for 0.1.
- The input common mode is a spec-sheet condition (percent of each PDK's supply), not a design knob.
- Adaptive optimization is the agents' own simulate-and-refine loop inside their task plus the
  round loop over verified results; the Pack ships no black-box optimizer in 0.1.

## Knowledge applied

- gm/Id sizing (Silveira, Flandre and Jespers 1996; Jespers and Murmann 2017): inversion level is
  the process-independent design variable, lookup tables carry the process.
- Two-stage Miller compensation (Cc against CL, gm6 against GBW and the RHP zero, Rz = 1/gm6) and the
  zero systematic-offset condition for M6.
- Migration practice from vendor and academic sources: reuse the sizing procedure and the testbench,
  not the sized netlist; re-bias and re-verify across corners.
- HimaHarness: verify outside, equip inside; executable method over prose; agents never type
  numbers.
