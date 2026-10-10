# aes_cipher_top: design notes for the Fmax question

What a designer asks before a Campaign: where the timing bottleneck is, whether the flow or the
cells are to blame, and what the library offers. Every number here was printed by the Site's own
tools (Synthesis and APR, HimaTime, Qualib, AndesCell) for the reference build: the stock library
`std9t_svt`, corner tt0p90v25c, clock `clk` at 1.000 ns. A Campaign's first step rebuilds this
reference and measures it again; quote the Campaign's numbers once it has them.

## The timing at 1 GHz

- Fmax 957.67 MHz; worst slack −0.0442 ns (−44.2 ps); TNS −3.213 ns over 114 violating endpoints.
- Cell area 41 200 µm², 18 400 instances, route DRC 0.
- The worst paths come in two groups: **S-box / MixColumns** (round data path) and **key expansion**.

| Path | Group | Start → end | Slack (ns) |
| --- | --- | --- | --- |
| A1 | S-box / MixColumns | sa12_reg_3_ → sa21_reg_6_ | −0.0442 |
| B1 | key expansion | u0/w_reg_3__17_ → u0/w_reg_0__17_ | −0.0415 |
| A2 | S-box / MixColumns | sa03_reg_5_ → sa30_reg_1_ | −0.0410 |
| B3 | key expansion | u0/w_reg_3__26_ → u0/w_reg_2__26_ | −0.0399 |
| B2 | key expansion | u0/w_reg_3__9_ → u0/w_reg_1__9_ | −0.0391 |

## Where the delay goes (HimaTime stage breakdown, 20 worst paths)

Net delay is 23.1 % of path delay; the rest is cell delay. By cell type:

| Cell type | Share of the worst path (A1) | On how many of the 20 paths | HimaTime's estimated slack back if faster (ns) |
| --- | --- | --- | --- |
| XNOR3 | 25.7 % | 11 | 3.04 |
| BUF | 18.8 % | 20 | 2.09 |
| XOR2 / XNOR2 | 9.2 % | 12 | 1.97 |
| DFF (clock-to-Q) | 7.9 % | 20 | 0.46 |
| AOI21 | 5.4 % | 19 | 0.86 |
| NAND2 | 4.2 % | 19 | 0.35 |
| MUX2I | 3.8 % | 12 | 1.18 |

Read it as: the XOR trees of the S-box and MixColumns (XNOR3, XOR2) and the buffers between them
carry close to half of the worst path's delay.

## Can the flow do better?

The flow already runs at its highest settings (`report_qor.rpt`): synthesis high (timing-driven,
ultra mapping), placement high (timing-driven), clock tree high, routing high (timing-driven,
SI-aware). The RTL and the 1.000 ns clock are fixed for this block. What is left is the speed of
the cells on those paths.

## What the stock library offers (Qualib)

| Cell | Area (µm²) | Input cap (fF) | Leakage (nW) | Rise / fall FO4 (ps) |
| --- | --- | --- | --- | --- |
| XNOR3_X1 | 3.780 | 1.620 | 5.90 | 64.5 / 47.5 |
| XNOR3_X2 | 5.216 | 2.511 | 11.80 | 55.5 / 40.8 |
| BUF_X2 | 3.133 | 1.333 | 4.20 | 26.3 / 25.3 |
| BUF_X4 | 4.653 | 2.279 | 8.40 | 23.9 / 22.9 |
| BUF_X8 | 7.491 | 4.171 | 16.80 | 22.0 / 21.2 |
| XOR2_X1 | 2.770 | 1.480 | 4.20 | 41.8 / 34.2 |
| XOR2_X2 | 3.823 | 2.294 | 8.40 | 35.9 / 29.4 |
| MUX2I_X1 | 3.020 | 1.210 | 3.60 | 36.8 / 31.2 |

- XNOR3 has only X1 and X2, with a slow rising edge (rise is about 35 % slower than fall).
- There is no faster or low-depth XNOR3 variant.
- The buffers gain little from X4 to X8.

## The idea: custom cells

AndesCell has templates for 17 cell families and builds at most two new families per round. Its
typical FO4 gains over the stock cells are:

| Family | Typical FO4 gain |
| --- | --- |
| XNOR3 | −32 % |
| BUF | −28 % |
| XOR2 | −24 % |
| MUX2I | −24 % |
| AOI21 | −24 % |
| OAI21 | −22 % |

A Campaign with this Pack works in rounds:
1. The HimaTime agent and the Qualib agent each propose cell requirements.
2. The AndesCell agent chooses the cells to build, and AndesCell generates them.
3. The HimaTime agent confirms a local gain on the worst paths, and the Qualib agent screens the
   cells.
4. Synthesis and APR rebuilds the design with the new cells.

The default Goal is +5 % Fmax over the reference build, in at most 4 rounds.
