## Business

An analog designer wants a bandgap voltage reference sized from a spec sheet (VBG and its tolerance
at two supplies, quiescent and shutdown current, temperature coefficient, loop phase margin,
start-up time, PSRR) and verified the way a sign-off review would: at every process corner,
temperature and supply, in Monte Carlo with the PDK's mismatch, after layout with the PDK's own DRC
and LVS decks, and re-simulated from the extracted layout. The user asked to beat a competitor's
analog agent demo (2026-10-12: "we need to beat this!"): that agent sized a bandgap at one corner,
graded itself, and laid out a different cell. Here an agent proposes sizes and the Pack's own steps
measure, judge and lay out, with the designer's method shipped as tested code.

## Golden Flow

Characterize the PDK on the Site's SPICE simulator: gm/Id tables of both transistor types, the
PNP's VBE against current and temperature, the poly resistor against width and temperature, at every
corner. A design agent turns the spec sheet into a first cut with the Pack's method (R2/R1 from the
PNP's measured dVBE/dT, the core current from the IQ budget, the amplifier in gm/Id form, the input
pair's area from the Monte Carlo band by Pelgrom), simulates its own drafts and refines. The Pack
simulates the delivered design at every corner; if every line is met, Monte Carlo; if in band, the
Site's layout tool draws it and checks DRC and LVS; if clean, the extracted layout is simulated at
every corner again. The round record says what was met where; the owner ends at the Goal or gives the
agent another round with the lessons.

## Answers

- Template (main agent, 2026-10-12, on measured evidence): Kuijk core with n:1 vertical PNPs, a
  PMOS-input five-transistor OTA, a mirror stage (M5 into the diode M6) driving the output device 4:1,
  start-up and enable. The direct-drive template the first spec named (`kuijk-p5t`) cannot meet the
  sheet at both supplies on GF180MCU; it stays in the CLI as the recorded negative result.
- Simulator: Cadence Spectre on the Site (user, 2026-10-12: "Spectre and open PDK"); the agent
  iterates with ngspice in its sandbox through the Pack's `sim`; one piece of Pack arithmetic computes
  every measurement from either simulator's raw output. Monte Carlo runs on the measuring simulator
  (Spectre `montecarlo`, or ngspice re-drawing the PDK's `agauss` mismatch per seeded run; on
  GF180MCU the two sigmas agree within 1 %).
- PDK: GF180MCU 3.3 V devices (open), supplies 2.0 and 3.3 V. Tests use a synthetic process
  (`synth180` with a made-up PNP and poly resistor) committed as fixtures.
- Spec (defaults mirror the competitor's sheet): VBG 1.2 V +/- 2 %, IQ < 8 uA, ISD <= 2 nA at 27 C,
  TC < 100 ppm/C (box, -40 to 125 C), loop PM > 60 deg, start-up < 100 us, PSRR at 1 kHz > 40 dB;
  Monte Carlo mean +/- 3 sigma inside the band.
- Layout: the Site's tool (open Magic, KLayout and netgen with the PDK's decks); the PDK ships no
  Cadence PVS or Quantus decks.

## Ambiguities resolved

- "Meets the spec" is the worst value over every process corner, temperature and supply meeting
  every line; an unknown never meets a line; a loop without a unity-gain crossing or a copy that did
  not start is a miss.
- "Signed off" is: every line at every corner, Monte Carlo in band, zero DRC errors on both decks
  outside the PDK's own PNP cells, both LVS checks matching, and every line at every corner again on
  the extracted layout. Die-level density rules need fill and are reported, not judged.
- Monte Carlo covers device mismatch at tt, 27 C, the higher supply; the PDK's high-resistance poly
  has no mismatch model.

## Knowledge applied

- Bandgap design (Kuijk 1973; Brokaw 1974): VBG = VBE + (R2/R1) VT ln n, with the ratio set from the
  PNP's measured slope so dVBG/dT = 0 at 27 C.
- gm/Id sizing (Silveira, Flandre and Jespers 1996; Jespers and Murmann 2017).
- Pelgrom mismatch (Pelgrom, Duinmaijer and Welbers 1989): sigma(Vth) = A_VT / sqrt(WL); VBG carries
  the amplifier offset times (1 + R2/R1).
- HimaHarness: verify outside, equip inside; executable method over prose; agents never type numbers.
