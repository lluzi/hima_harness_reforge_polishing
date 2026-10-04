# Evidence and claims

## Real in this demo

- The cell layouts you build with LibreCell, and their KLayout DRC and Netgen LVS results.
- Whether OpenROAD's resizer (or an `emap` remap) actually uses your cells: instance counts in the
  final routed netlist `6_final.v`.
- ORFS timing, area, power and route DRC of both arms, read by the Pack Readers from ORFS files.
- The matched control: same recipe, same merged library, your cells forbidden.

## Modelled

- The Liberty timing of every custom cell. It is estimated from foundry `sky130_fd_sc_hd` tables
  (`estimate_lib.py`, `skew_lib.py`, `model_fused_cell.py`) with a stated derate and a physical
  reason per cell. Its magnitude drives the measured gain: a less optimistic derate gives a smaller
  win. Label: "custom-cell timing modelled, not characterized".
- Any `emap` window without an equivalence log is "function not verified".

## Never claimed

- Signoff, silicon, or characterized (SPICE-measured) cell timing.
- Your own trial numbers as results. They are `agentClaim`, shown next to the Harness number.
- A gain from a cross-library or cross-clock comparison. Only the round's own control arm counts.

## Claim boundary (shown verbatim in the summary)

> Custom-cell timing is modelled from foundry tables (estimate_lib, derate stated per cell), not
> characterized. Layouts marked drc-lvs-clean passed KLayout DRC and Netgen LVS. Results are
> open-source ORFS timing on SKY130 under these models; not signoff, not silicon.
