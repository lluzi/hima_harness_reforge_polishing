# Sizing a Kuijk bandgap from a spec sheet

The method is code (`flow/bg_cli.py`); run it, never retype its numbers. You choose an intent; the
Pack drafts the sizes, simulates every process corner (tt, ss, ff, sf, fs), temperature (-40, 27,
125 C; the DC sweep covers -40 to 125 C in 5 C steps) and supply (2.0 and 3.3 V), then runs Monte
Carlo mismatch (tt, 27 C, 3.3 V, N = 100). Every spec line is judged at its worst corner.

## The method

1. **First cut:** `draft intent <spec sheet>`.
   - Core current per branch from the IQ budget: 80 % of the IQ line, less the reference, the tail and
     the start-up, shared by two branches at the hot, low-resistance corner.
   - R1 = VT ln n / I at 27 C.
   - R2/R1 = -(dVBE/dT + (k/q)(1 - T TCR)) / ((k/q) ln n), with dVBE/dT measured on the PNP at that
     current: dVBG/dT = 0 at 27 C.
   - The input pair and the load from the Pelgrom area at which 3 sigma(VBG) takes `mcBandSharePct`
     of the VBG band, with sigma(VBG) = (1 + R2/R1) sigma(Vos) and
     sigma(Vos)^2 = 2 sigma(Vth,pair)^2 + 2 sigma(Vth,load)^2 (gm_load/gm_pair)^2.
2. **Choices, not numbers:** put choices in the sheet's `choices` (n, a group's gm/Id or L, CC, the
   tail current, ...) and draft again. The method re-derives what depends on them.
3. **Monte Carlo:** `draft mc` scales the pair's and load's gate area by
   (sigma measured / sigma wanted)^2 and picks the length (or, at the PDK's width limit, the gm/Id)
   that reaches it.
4. Your own loop: `sim <campaign> design.json tt|pvt|mc:<N> <spec sheet>` prints every measurement and
   the failing lines; it is never a delivery.

## Reading the measurements

- `g` is the output device's gate at 27 C; `tail` the pair's source. In `kuijk-p5t` the OTA's output
  is `g`: it must stay above the load's saturation (about 0.3 V) and below `tail` less about 0.25 V.
- `loop.dcGainDb` is the loop gain at 0.1 Hz. PSRR at 1 kHz tracks it: about one dB of PSRR per dB of
  loop gain while the loop's dominant pole is above 1 kHz.
- A loop with no unity crossing (gain below 1: an amplifier device out of saturation), or a copy that
  does not settle within 1 % of its DC solution, fails its line; it is never "unknown".

## Lessons (gf180mcuD, Spectre 23.1, 2026-10-12)

### `kuijk-p5t`: the spec's template cannot meet the sheet at 2.0 V and 3.3 V

- The first cut failed VBG, TC, PM and PSRR, and Monte Carlo too: mean 1.2148 V, sigma 4.61 mV,
  mean + 3 sigma 1.2287 V against 1.224 V.
- At 2.0 V and 125 C the output device needs |VGS| = 1.86 V, so its gate (the OTA's output) falls to
  0.12 to 0.19 V. The load leaves saturation and the loop dies: VBG 1.004 V at fs.
- At 3.3 V the same gate must sit 1.3 V higher, plus the device's temperature drift (0.35 V). Fast
  PMOS (ff, sf) leaves the pair 0.07 to 0.1 V of drain-source voltage, and the loop gain falls to
  11 to 20 dB.
- Shifting the gate up (output device gm/Id 2.14 to 2.4, round 2) moved the failure to 3.3 V:
  VBG 1.279 V at sf 3.3 V.
- Raising the OTA gain (round 3: pair gm/Id 18 at L 10, load gm/Id 6, 24:1 PNPs) gave PSRR 40.7 to
  44.9 dB at tt, ss and fs at 3.3 V. The load's larger Vdsat killed 2.0 V: VBG 0.954 V at fs 2.0 V.
- In rounds 1 and 2, PSRR stayed below 40 dB at every corner (38.6 dB at best). PSRR here is about
  A_OTA / (1 + R2/R1): the ground-referenced gate must move with vdd, and the OTA's input moves
  1/A_OTA of that.
- The window, in one line: tail(2.0 V, -40 C) has to be at least g(2.0 V, 125 C) + 1.55 V, which
  needs about 1.85 V, and at most 2.0 V - Vdsat(MT), about 1.9 V. That is 0.05 V at a typical
  corner, and the PMOS corners move the tail and the gate by about 0.1 V in opposite directions.

### `kuijk-p5t-mirror`: the output device driven by a current mirror meets every line

- The same OTA drives the NMOS M5 into the PMOS diode M6, and MO mirrors M6 four to one.
  - The gate sits at vdd - |VGS(M6)| at any supply.
  - The OTA's output sits at about one NMOS VGS (about 0.8 V).
  - The second stage adds about 15 dB of loop gain: 51 to 58 dB at 0.1 Hz.
- The first cut met every line at every corner, and Monte Carlo too:
  - VBG 1.2022 to 1.2105 V; TC 19.6 ppm/C worst;
  - PM 77.5 deg; start-up 70.8 us; PSRR 55.8 dB;
  - IQ 7.61 uA (the tightest line, at ff 2.0 V);
  - Monte Carlo mean 1.2053 V, sigma 4.75 mV.
- Sigma was above the 4.0 mV that 50 % of the band allows. `draft mc` asked for 1.41 times the area:
  - the pair at L 10 um and the widest device, gm/Id 18.41;
  - the load at gm/Id 11.33.

  Sigma fell to 3.63 mV, mean + 3 sigma 1.2161 V. PM fell to 73.5 deg and PSRR to 48.2 dB. Every
  line still met.

### General

- The start-up path must not release in the near-zero state. With a 1 x 1 um sense device, the
  power-up from vdd = 0 at -40 C sat at VBG 0.56 V for 270 us, with a = b and no current in R1. A
  0.5 x 20 um sense device releases only once VBG is well up.
- The enable needs the load's foot switch (MEN3). Without it, the gate pulled to vdd drains back
  through the pair into the load: 30 uA in shutdown.
- Spectre on the lab server:
  - it crashed after freshly compiling the poly resistor's AHDL code; the Pack reuses the compiled
    code;
  - it crashed in transients holding several copies of the cell, and on nodes with almost no
    capacitance; the Pack runs one copy per netlist with a 10 fF node floor;
  - a crashed run is retried, and the record counts the attempts.
