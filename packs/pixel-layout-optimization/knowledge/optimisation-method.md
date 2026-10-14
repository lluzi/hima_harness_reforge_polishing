# The optimisation method: one LP for size and every metric, judged by the real tools

The Pack's program tasks solve, judge and decide. You choose what they solve. This file explains
what a front point asks the solver to do, so that your plan asks for something it can do.

## The compactor

One pass moves edges along one axis; passes alternate (y then x, unless the plan says otherwise).

- **Variables:** one displacement per edge class (vertices tied by an edge across the motion, or
  rigidly by a slanted edge, move together), plus the pitch.
- **Constraints, from the authority deck's parsed rule table:** the order of crossings on every
  scanline (topology, overlaps and connectivity are kept); width and space per layer; two-layer
  space; enclosure; vertex-to-edge (Euclidean) distances at corners; three periodic copies so that a
  line crossing the cell edge stays continuous with its neighbour; every transistor channel and the
  storage capacitor rigid; channels inside the cell; and any exact pair constraints the plan adds.
- **Rules it does not model** (listed in `state/rules.json` under `unmodelled`) are still judged by
  Argus. Their markers come back as the `model-gap` class.

Each constraint carries a tag naming the rule, the layers and the place. When a solve is
infeasible, or when the pitch is the objective, the tags with non-zero dual values are the
**binding chain**: the shapes that hold the pitch where it is.

## Objectives (a front point's `objective`)

- **`legalise`:** pitch fixed at the base layout's; every pair that violates its rule in the base is
  held at the full rule distance; minimum total movement. Use it first when the base is not clean
  on the authority deck. What it cannot reach (it reports infeasible, with the binding tags) is left
  for bounded edits.
- **`min-pitch`:** smallest pitch at the requested outline or below; minimum movement as tie-break.
  Ask for the Goal's outline first; infeasibility at the target is a measured shortfall, read from
  the binding chain, and a relaxed outline is a new front point, not a reinterpretation of the
  target.
- **`min-ratio`:** at a fixed outline, minimise the ratio. The ratio is not linear, so the solver
  uses the Dinkelbach form: for a trial value r it requires `Ct(x) − r·Cs(x) ≤ 0` and bisects on r.
  Ct and Cs are linear rows built from the model's gradient per edge class.

Every point also carries the hard-limit rows: each `loadLimitedLines` total within its allowance
(the front point's `loadAllowancePct`, default the Goal's), each `couplingLimits` pair within its
limit, transmittance inside the window, and the capacitor marker area inside its tolerance (or the
declared ceiling). A point whose allowances exceed the Goal's is **exploratory**: it is judged and
recorded for the trade-off table and can never be the delivered layout.

## The model, and why the tools still decide

The capacitance model is linear in geometric features: for each net pair and layer pair, the
visible overlap area (with conductors of other nets between the two layers subtracted) and two
fringe bands around the shapes. Coefficients are fitted by non-negative least squares on every
extraction of the Run, and the model card reports the leave-one-out error per pair. Some pairs fit
well; others (typically the storage node to the anode) fit worse. The trust region absorbs that:

- Each solve may move a gradient-bearing edge by at most the trust radius.
- After judgement, `decide-round` compares the measured gain with the predicted one. At least half
  of it: the radius doubles. Less: the radius halves, and the new extractions refit the model.

The ratio you are judged on is always the extracted one. A predicted value is a reason to try a
point, never a result.

## Reading a shortfall

- **Infeasible at the target outline:** the binding chain names what holds it. Options: a topology
  operator (if allowed), a relaxed outline as a new front point, or stop: the bound is the finding.
- **Ratio stuck above the target:** compare with the floor. If the target is below the floor at the
  current Cs, only a declared capacitor change or a broken limit reaches it. Show that with one
  exploratory point, so the trade-off table has evidence, then stop pursuing it.
- **Residual DRC markers:** see the marker classes in `plan-and-repair-playbook.md`.
