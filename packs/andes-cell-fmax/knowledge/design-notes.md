# aes_cipher_top: design notes for the Fmax question

What a designer asks before a Campaign: where the timing bottleneck is, whether the flow or the
cells are to blame, and what the library offers. Every number here was printed by the Site's own
tools (Synthesis and APR, HimaTime, Qualib, AndesCell) for the reference build: the stock library
`std9t_svt`, corner tt0p90v25c, clock `clk` at 0.500 ns (2 GHz). A Campaign's first step rebuilds
this reference and measures it again; quote the Campaign's numbers once it has them.

## Charts to show

Four charts in this Pack draw these numbers from the same tools. Show them with `hima_chart`
(`{ pack: "andes-cell-fmax", file: "charts/<name>" }`): when you summarize the RTL2GDS baseline,
show `charts/reference-summary.chart.json` (Fmax, worst slack, TNS, violating endpoints, area,
instances, utilization, route DRC and flow runtime of the reference build); when you explain the bottleneck, show
`charts/stage-breakdown.chart.json` (where the worst path's delay goes) and
`charts/worst-paths.chart.json` (slack of the 8 worst paths); when you explain the library, show
`charts/library-fo4.chart.json` (stock FO4 of the critical families against the AndesCell target).

## The timing at 2 GHz

- Fmax 1951.60 MHz; worst slack −0.0124 ns (−12.4 ps); TNS −0.596 ns over 74 violating endpoints.
- Cell area 41 200 µm², 18 400 instances, utilization 70.0 %, route DRC 0; the flow (synthesis,
  floorplan, placement, CTS, route, post-route opt) takes 80 s (1.33 min) on the Site.
- Through the flow (`flow_summary.rpt`) the worst slack goes +9.6 ps after synthesis (wire-load
  estimates), −16.0 after placement, −20.6 after CTS, −27.0 after routing and −12.4 ps after
  post-route optimization: the real wires cost the slack, and optimization wins part of it back.
- The worst path has 23 levels of logic and is 0.512 ns long (`report_qor.rpt`). Every path must
  arrive within 480 ps of the launch edge: the 500 ps clock less 12 ps setup and 8 ps uncertainty.
- Fmax = 1000 / (0.500 ns − worst slack): 1000 / 0.5124 = 1951.60 MHz.
- The worst paths come in two groups: **S-box / MixColumns** (round data path) and **key expansion**.

| Path | Group | Start → end | Slack (ns) |
| --- | --- | --- | --- |
| A1 | S-box / MixColumns | sa12_reg_3_ → sa21_reg_6_ | −0.0124 |
| A2 | S-box / MixColumns | sa03_reg_5_ → sa30_reg_1_ | −0.0118 |
| A3 | S-box / MixColumns | sa21_reg_0_ → sa12_reg_7_ | −0.0110 |
| A4 | S-box / MixColumns | sa30_reg_2_ → sa03_reg_4_ | −0.0101 |
| A5 | S-box / MixColumns | sa11_reg_6_ → sa22_reg_3_ | −0.0093 |
| B1 | key expansion | u0/w_reg_3__17_ → u0/w_reg_0__17_ | −0.0090 |

## Where the delay goes (HimaTime stage breakdown, 20 worst paths)

A logic stage is 10–30 ps of cell delay plus 2–5 ps of net; the flop's clock-to-Q is 34 ps. Net
delay is 17.1 % of path delay; the rest is cell delay. By cell type:

| Cell type | Stages on the 20 paths | ps per stage | Share of the worst path (A1) | A1 slack back if 5–10 % faster (ps) | HimaTime's estimated slack back (ns) |
| --- | --- | --- | --- | --- | --- |
| XNOR3 | 26 | 28.0 | 16.39 % | 8.40 | 0.302 |
| BUF | 45 | 17.0 | 13.27 % | 5.44 | 0.191 |
| XOR2 / XNOR2 | 37 | 21.0 | 8.20 % | 3.36 | 0.171 |
| AOI21 | 61 | 16.0 | 9.37 % | 3.36 | 0.140 |
| MUX2I | 30 | 19.0 | 3.71 % | 1.33 | 0.104 |
| NAND2 | 94 | 12.0 | 9.37 % | 2.40 | 0.101 |
| INV | 98 | 10.0 | 11.71 % | 2.40 | 0.077 |
| DFF (clock-to-Q) | 20 | 34.0 | 6.64 % | 1.70 | 0.071 |

Read it as: no single cell is slow; the worst path is 23 ordinary stages. The S-box XNOR3 trees
(3 stages, 84 ps on A1) and the buffers between them (4 stages, 68 ps) are the slowest stages and
carry close to a third of the worst path, so a cell 10 % faster there gives back the most ps.

## Can the flow do better?

The flow already runs at its highest settings (`report_qor.rpt`): synthesis high (timing-driven,
ultra mapping), placement high (timing-driven), clock tree high, routing high (timing-driven,
SI-aware). The RTL and the 0.500 ns clock are fixed for this block. What is left is the speed of
the cells on those paths.

## What the stock library offers (Qualib)

| Cell | Area (µm²) | Input cap (fF) | Leakage (nW) | Rise / fall FO4 (ps) |
| --- | --- | --- | --- | --- |
| XNOR3_X1 | 3.780 | 1.620 | 5.90 | 32.3 / 23.7 |
| XNOR3_X2 | 5.216 | 2.511 | 11.80 | 27.8 / 20.4 |
| BUF_X2 | 3.133 | 1.333 | 4.20 | 14.9 / 14.3 |
| BUF_X4 | 4.653 | 2.279 | 8.40 | 13.5 / 13.0 |
| BUF_X8 | 7.491 | 4.171 | 16.80 | 12.5 / 12.0 |
| XOR2_X1 | 2.770 | 1.480 | 4.20 | 23.1 / 18.9 |
| XOR2_X2 | 3.823 | 2.294 | 8.40 | 19.8 / 16.3 |
| MUX2I_X1 | 3.020 | 1.210 | 3.60 | 20.6 / 17.4 |

- XNOR3 has only X1 and X2, with a slow rising edge (rise is about 36 % slower than fall).
- There is no faster or low-depth XNOR3 variant.
- The buffers gain little from X4 to X8 (13.5 → 12.5 ps rise).

## The idea: custom cells

AndesCell has templates for 17 cell families and builds at most two new families per round. Its
typical cell-level FO4 gains over the stock cells are 4–10 %:

| Family | Typical FO4 gain |
| --- | --- |
| XNOR3 | −10 % |
| BUF | −8 % |
| XOR2 | −8 % |
| MUX2I | −7 % |
| AOI21 | −7 % |
| OAI21 | −6 % |
| NAND2, NOR2, DFF | −5 % |

HimaTime's what-if for the two families it ranks first (`himatime estimate --families XNOR3,BUF`):
WNS −0.0048 ns, Fmax 1980.98 MHz, +1.51 % over the reference build. The S-box paths then meet
timing and the key-expansion path B1 sets Fmax.

A Campaign with this Pack works in rounds:
1. The HimaTime agent and the Qualib agent each propose cell requirements.
2. The AndesCell agent chooses the cells to build, and AndesCell generates them.
3. The HimaTime agent confirms a local gain on the worst paths, and the Qualib agent screens the
   cells.
4. Synthesis and APR rebuilds the design with the new cells.

The default Goal is +1 % Fmax over the reference build. One round is expected to reach it; the
Campaign allows a second round as a safety margin.
