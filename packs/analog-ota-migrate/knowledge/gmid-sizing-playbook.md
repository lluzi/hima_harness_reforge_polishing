# Sizing playbook: a two-stage OTA from a spec sheet with gm/Id

The gm/Id method sizes a transistor by its inversion level instead of by square-law overdrive. For
each device you choose gm/Id (about 5 to 8 in strong inversion: fast, little gain per uA; 10 to 15
moderate; 18 and above weak inversion: most gm per uA, slow, needs wide devices) and a length L
(longer: more intrinsic gain gm/gds, slower). The PDK's gm/Id tables then give the current density
Id/W, so W = Id / (Id/W). The tables are measured on the Site's simulator (`characterize`), so the
same choices carry to another process: only the tables change.

## Start from the spec: the first cut

`draft intent spec.json` applies the textbook two-stage Miller procedure in gm/Id form:

1. **Compensation.** Cc = 0.3 x CL: the second pole gm6/CL must sit about 2.2 to 2.5 times above the
   GBW for about 60 degrees of phase margin.
2. **Input pair.** GBW = gm1 / (2 pi Cc), so gm1 = 2 pi GBW Cc (the draft adds 25 % headroom). At
   gm/Id 15 the pair current per side is gm1 / 15.
3. **Second stage.** gm6 = max(2.5 x 2 pi GBW CL, 10 gm1): the output pole past 2.5 GBW and the
   right-half-plane zero gm6/Cc ten times above GBW. At the load's gm/Id the second-stage current is
   gm6 / (gm/Id). Rz = 1/gm6 pushes the zero toward infinity.
4. **Mirrors.** M8, M5 and M7 share one gm/Id and L, so their currents follow their widths: M5
   carries 2 x the pair current, M7 the second-stage current. M3/M4 set M6: at balance |Vgs6| =
   |Vgs4|, so M6 takes the load's gm/Id and L and its width scales with its current (zero systematic
   offset).
5. **Lengths.** About three times the minimum length for gain; shorter for speed.

`draft size intent.json` turns the intent into W and L from the tables, on the PDK's grid.

## Close it against the simulator

Simulate your draft with `sim` and read every corner, not only tt. Typical moves:

| what the simulator shows | likely cause | move |
| --- | --- | --- |
| GBW short at ss | gm1 too low when the threshold rises | raise i1Ua (and power) or raise input gm/Id |
| phase margin short | second pole too close, or the zero | raise i6Ua (gm6), raise Cc a little, set Rz near 1/gm6 |
| gain short | gm/gds too low | longer L on the pair and the load (input and load lUm), or higher gm/Id |
| power over | currents too high | lower i6Ua first (it dominates), then i1Ua; check the bias branch |
| tail M5 out of saturation | input common mode minus Vgs1 leaves too little Vds | raise input gm/Id (lower Vgs1), raise sink gm/Id (lower Vdsat), or shorter input L |
| M6/M7 out of saturation | output not near mid-supply or Vdsat too high | raise the load and sink gm/Id |

Change one or two things per try and write each try in your analysis: the intent, the worst-corner
numbers `sim` printed, and what you concluded. Stop when every corner meets every line with every
device saturated; a small margin on each line is better than a large one on one line.

## Rules

- Your delivery carries sizes, bias, Cc and Rz. It never carries a performance number: the Pack
  simulates your delivery and the judges read only the simulator.
- Keep M1 = M2 and M3 = M4 (matched pairs), every W and L inside the PDK's limits and on its grid.
  `precheck` holds you to this.
- Do not change the spec, the load, the input common mode or the PDK. If the spec looks impossible,
  deliver your best design and say why in the summary and the analysis.
