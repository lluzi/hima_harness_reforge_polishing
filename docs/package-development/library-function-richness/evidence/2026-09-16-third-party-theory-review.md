# Third-party Library Richness theory review

Date: 2026-09-16

## Decision

The supplied report strengthens the next-round priority on drive/electrical richness and bounded
multi-output mapping. It does not justify abandoning all design-specific functions, enumerating all
P-equivalence classes, or treating mockturtle plus percy as an already integrated ASIC solution.

## Verified statements

- Direct enumeration confirms 256 three-input truth tables, 80 P-equivalence classes and 14 NPN
  classes. Restricting to functions that depend on all three variables leaves 218 functions, 68 P
  classes and 10 NPN classes.
- Beeftink et al. study discrete gate-size selection for primitive gates and explicitly motivate a
  small, well-selected set of sizes instead of an impractically large size set.
- EPFL's Three-Input Gates work studies the ten fully-dependent three-input NPN classes and reports
  that their expressive power differs. This supports selective topology choice.
- ICCAD 2023 presents a scalable whole-network mapper for multi-output library cells. On its ASAP7
  HA/FA experiments it reports 7.48% average area improvement over default ABC when mapping for
  minimum delay, about 5% over the cited Yosys white-box flow, and about 8% average runtime increase.
- Current mockturtle documentation exposes that work through `emap`, returns a multi-output-capable
  `block_network`, and reports `multioutput_gates`.
- percy represents and exactly synthesizes multi-output Boolean chains. It is a topology synthesis
  building block, not by itself a standard-cell technology mapper.

## Claims not accepted as sourced facts

- The Beeftink ICCAD 1998 paper does not establish the supplied report's “less than 20% logic gate
  types”, “below 1–3%” and “multiple-times synthesis runtime” claims. Those numbers need another
  primary source.
- “Industry abandoned functional richness” is too broad. A 2022 essential-library study reports a
  very small near-baseline library for one process/library/benchmark scope, while design-specific
  library extension and three-input primitive research show that selected functions can still help.
- A universal 20–30% transistor saving for multi-output Cells is not accepted without a cell- and
  topology-specific source.
- Generic mockturtle views and percy exact synthesis do not alone prove arbitrary multi-output ASIC
  mapping. The relevant baseline is mockturtle `emap` plus explicit Library elaboration,
  equivalence, mapped-netlist census and physical-locality evaluation.

## Effect on Hima methodology v2

1. Implement D1–D4 physical variants before expanding function count.
2. Use phase-sensitive identity as a diagnostic for design-observed gaps; require actual mapper
   adoption and level reduction, and never enumerate all 80 P classes.
3. Replace the planned local multi-output replacement POC with pinned mockturtle `emap`
   whole-network mapping, using ABC as the reference arm.
4. Add OpenROAD sink-divergence and pin-access evidence before any multi-output candidate can reach
   commercial E0.
5. Keep percy optional for bounded exact multi-output topology generation after a mapper-visible
   opportunity exists.

## Primary references

- Beeftink et al., “Gate-Size Selection for Standard Cell Libraries,” ICCAD 1998:
  https://www.cecs.uci.edu/~papers/compendium94-03/papers/1998/iccad98/pdffiles/10a_2.pdf
- Marakkalage et al., “Three-Input Gates for Logic Synthesis,” IEEE TCAD 2021:
  https://si2.epfl.ch/demichel/publications/archive/2021/3Input.pdf
- Tempia Calvino and De Micheli, “Technology Mapping Using Multi-output Library Cells,” ICCAD 2023:
  https://si2.epfl.ch/demichel/publications/archive/2023/ICCAD23A.pdf
- mockturtle `emap` documentation:
  https://mockturtle.readthedocs.io/en/latest/algorithms/mapper.html
- percy exact-synthesis documentation:
  https://percy.readthedocs.io/en/latest/introduction.html
- “Essential Standard Cell Library Composition,” DCAS 2022:
  https://doi.org/10.1109/DCAS53974.2022.9845567

