# The pixel's design space: what makes the ratio, what moves it, what it costs

This file explains, symbolically, where the coupling ratio of an OLED pixel comes from and which
changes can lower it. Every number you act on comes from the Run's own card, model and receipts,
never from this file.

## The quantities

- **Storage node** (the manifest's `nets.storageNode`): the gate of the drive transistor, held by
  the storage capacitor between frames. Charge coupled onto it from switching lines shifts the
  drive current: that is what the ratio measures.
- **Cs**: extracted coupling between the storage node and the storage net (`nets.storageNet`).
  Most of it is the storage capacitor's device (plates inside the capacitor marker, which LVS
  measures), plus parasitic overlap of the same two nets outside the marker. The receipt reports
  both parts separately; the `extraCsOverlap` knob says whether the outside part counts.
- **Ct**: the sum of the extracted couplings between the storage node and the aggressor nets the
  judged definition lists (`ratioDefinitions.narrow` or `.broad`). The broad list adds the scan line
  and the anode, which are usually the two largest terms.
- **Ratio** = Ct / Cs, in percent.

## Where Ct comes from

The card ranks **coupling sites**: a shape of the storage node on one layer facing a shape of an
aggressor on another (or the same) layer, with no conductor of a third net between them, and its
estimated share of the coupling. In a pixel of this kind the sites fall into three groups:

1. **The storage-node link under the anode.** The conductor that joins the capacitor plate to the
   drive transistor's gate often runs under the anode, inside the emission opening. It faces the
   anode across the planarisation layer. Its area (width × length) is the lever.
2. **The storage-node link crossing the scan line.** Where the link crosses or runs beside the scan
   line, the crossing area and the fringe along it couple the two. Crossing width is free to shrink
   down to the rule minimum; crossing count is topology.
3. **Couplings built into the frozen transistors.** The gate edge of the drive transistor and its
   neighbours couples to their own source and drain nets. These terms barely move when anything
   else moves; they set the **coupling floor**. Do not spend rounds on them.

Read the card's sites before choosing a lever: a lever on a site that holds a small share of Ct
cannot move the ratio much, however clean the move.

## Levers and what each costs

| Lever | How it acts | Its cost, which a load or limit rule will see |
|---|---|---|
| Narrow or shorten a non-device conductor of the storage node | Less facing area | Rule minimum width; contact enclosure; often a small Cs loss |
| Move apart | Less fringe | Area, and couplings elsewhere |
| Cover the storage node with a plate on a fixed-potential net (`shield`) | Screens the aggressor; a supply plate over the storage node also adds Cs | Coupling between the plate's net and the aggressor. Over the scan line this adds scan-line load that is typically several times the coupling it removes from the storage node: the load rule refuses it unless the Goal's allowance is wide. The plate must be tied to its net: a floating plate passes the coupling on in series and fails `no-new-floating-net` |
| Stretch the storage capacitor (`cst-stretch`) | Larger Cs | Height; a declared schematic change; Ct rises slightly with the larger plate. Only with `cst_ceiling_ff` above 0 |
| Move the emission opening (`opening-shift`) | Less anode over the storage node | PDL symmetry and emission area |
| Trim an opaque band (`band-trim`) | Transmittance into its window | Line resistance and load; width rule |
| Move a contact or reorder lines (`contact-move`) | Unblocks a binding pitch chain | Topology; only with `topologyMoves: allowed` |

Continuous levers are already variables of the compactor: each edge class has a gradient from the
model, so the LP moves them for you when a front point asks for a lower ratio. Only the discrete
operators need a plan entry.

## Bounds

- **Minimum legal pitch** for the current topology, per axis: the LP with the pitch as objective.
  Its duals name the binding chain of shapes. A target outline below it cannot be reached by moving
  edges; it needs a topology change or a relaxed rule, which is the person's decision.
- **Coupling floor**: the frozen-transistor terms plus the least the model allows for the movable
  terms under the rules.
- **Front**: for each load allowance and outline, the best ratio judged so far.

When a target lies beyond a bound, say so with the bound; a candidate that crosses it by breaking a
hard limit is evidence for the trade-off table, never a result.

## Two traps

- **A ratio bought with scan-line load.** A shield over the scan line lowers the ratio while the
  load it adds is invisible to DRC and LVS. The `loads-within-allowance` rule exists for this.
- **A ratio bought with a floating plate.** A plate on no net seems to cut the storage node's
  coupling to the scan line, but extraction reports it as an unconnected node that couples to
  both, so the coupling still reaches the storage node in series and the scan line carries the
  plate's load. No net-pair value shows it; the `no-new-floating-net` rule does.
- **A ratio bought with an undeclared capacitor.** Enlarging the capacitor raises Cs, but with the
  schematic unchanged LVS fails on its capacitance tolerance, and the ratio must not be credited.
