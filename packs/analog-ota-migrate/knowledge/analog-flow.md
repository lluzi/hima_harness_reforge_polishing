# The OTA sizing and migration flow

A Campaign of this Pack takes a spec sheet (the Goal: DC gain, unity-gain frequency, phase margin,
power; the strategy: load capacitance and input common mode) and two PDKs. It delivers a two-stage
Miller OTA sized in the source PDK, the same OTA ported to the target PDK, and the simulator's
evidence that both meet the spec at their worst corner.

## The circuit

Two-stage Miller OTA, eight transistors:

| device | role | type | nets (drain gate source bulk) |
| --- | --- | --- | --- |
| M1, M2 | input pair (M2 non-inverting) | nmos | x inn tail 0 / y inp tail 0 |
| M3, M4 | mirror load (M3 diode) | pmos | x x vdd vdd / y x vdd vdd |
| M5 | tail current source | nmos | tail nbias 0 0 |
| M6 | second stage, common source | pmos | out y vdd vdd |
| M7 | second-stage current sink | nmos | out nbias 0 0 |
| M8 | bias diode (takes the bias current) | nmos | nbias nbias 0 0 |

Cc (with the nulling resistor Rz in series when Rz > 0) runs from y to out; the load CL sits on out.
The bias current, Cc, Rz and CL are ideal elements: the claim is schematic level.

## The testbench

`ota_cli.py` writes one netlist per corner in the measuring simulator's language (Cadence Spectre
where the PDK's decks read in Spectre, ngspice otherwise; `state/inputs.json` says which). The Pack
computes every measurement from the simulator's raw operating point and AC response, with the same
arithmetic for both simulators. The output drives the inverting input through a 1 GH
inductor (DC unity feedback sets the operating point) and a 1 F capacitor grounds that input for AC,
so the AC analysis sees the open loop. The non-inverting input sits at the input common mode
(`inputCmPct` percent of the PDK's supply) with an AC source of 1 V. Measurements:

- DC gain: the gain at 0.1 Hz, dB. The response must be flat there (the first two points within
  0.1 dB) and in phase (within 5 deg of 0): otherwise the gain and the phase margin are unknown. A
  dominant pole below about 0.1 Hz (a very high gain with a very low bandwidth) therefore reads
  unknown, never a shifted number. The sweep does not start lower because the testbench's DC
  feedback starts to close the loop there.
- Unity-gain frequency: where the gain crosses 0 dB, MHz (the GBW of a dominant-pole OTA).
- Phase margin: 180 degrees plus the phase at the unity-gain frequency (unwrapped from 0.1 Hz).
- Power: supply voltage times supply current at the operating point, bias branch included.
- Saturation: every device with |Vds| at least |Vdsat| + 50 mV.

The worst corner is the lowest gain, GBW and phase margin and the highest power over the PDK's
corners (tt, ss, ff and whatever else its card lists). A spec line is met when the worst corner meets
it. A measurement the simulator did not produce (no 0 dB crossing, a failed operating point) is
unknown; an unknown never meets a line.

## Steps

| step | who | what it does |
| --- | --- | --- |
| `bind-inputs` | Pack | simulator versions, both PDK cards and their measuring simulator, SHA-256 of every model file |
| `characterize` | Pack | DC sweeps: gm/Id, current density Id/W, gm/gds, fT per device type and length, both PDKs |
| `size-agent` | AI agent | delivers the source design (sizes, bias, Cc, Rz, the gm/Id intent) |
| `simulate-source` | Pack | the testbench at every source corner |
| `check-source` | judge | the source worst corner meets every line with every device saturated (`simulate-source` is given the spec sheet and states `meets_spec`) |
| `migrate-agent` | AI agent | delivers the target design, citing the accepted source design |
| `simulate-target` | Pack | the same testbench at every target corner |
| `record-round` | Pack | both designs against the spec, the target's worst margin, how the port moved from the source (gm/Id, L, currents), which devices left saturation at which corner, lessons |
| `judge-round` | judge | the round is valid and the migrated OTA meets every line |
| `next-round` | owner | goal met, or another round for the agents with the lessons |

When the source misses the spec, the round skips the migration and the record says so; the next
round starts at the sizing agent again. When the source met the spec, the sizing agent may carry it
into the next round unchanged with `draft keep`.

## Commands an agent runs

```
python3 <campaign>/flow/ota_cli.py draft <campaign> intent spec.json > intent.json   # first cut from the spec
python3 <campaign>/flow/ota_cli.py draft <campaign> size intent.json > design.json   # sizes from the gm/Id tables
python3 <campaign>/flow/ota_cli.py draft <campaign> migrate [intent.json] > design.json   # the port
python3 <campaign>/flow/ota_cli.py draft <campaign> keep > design.json               # last round's source design
OTA_SIM=ngspice OTA_PDK_ROOT=<pdk root> python3 <campaign>/flow/ota_cli.py sim <campaign> <stage> design.json <loadPf> <cmPct> ./sim
python3 <campaign>/flow/ota_cli.py precheck <campaign> <stage> design.json
```

`sim` is the Pack's own testbench and measurement code on your draft, run with the ngspice in your
sandbox. On the same device decks ngspice and Spectre agreed within 0.1 dB, 1 % and 0.5 deg on every
design checked, so the numbers it prints are what `simulate-source` / `simulate-target` will
measure, to that closeness. They are for your loop only;
the delivery carries sizes, never numbers.

## What the results mean

- `gain_db`, `gbw_mhz`, `pm_deg`, `power_uw` are the worst corner's; the Results table shows the
  source design (Source PDK column) and the migrated design (Target PDK column) side by side.
- `target_margin_pct` is the migrated OTA's worst normalized margin over the four lines: +5 % means
  every line is met with at least 5 % to spare; -12 % means some line is 12 % short.
- Goal met means: a valid round in which the migrated OTA meets every line at its worst corner.
