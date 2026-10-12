"""Turn one or more `mage.slot-plan/1` plans into a candidate PLA.

`plan-slots` reasons on the *start* snapshot (the priority-only start
state) and emits a plan whose `moves` each name a movable item's id and its
new along-axis position. This module applies those moves to the start PLA's
own Fit boxes, producing a complete candidate `PlaDocument` the Engineer
can replay with `mage-round --fill` so MAGE places the ordinary structures
into the opened windows. It is the missing helper the first live rounds
needed: the Engineer had no way to turn a plan into a PLA short of editing
PLA text by hand.

What a move may touch, and what it may never touch:

- A move's `id` must resolve to a **Fit** in the PLA. A box is translated
  along the lane's own axis (`H:*` lanes move along x, `V:*` along y) so
  its along-start (left edge for an `H` lane, bottom edge for a `V` lane)
  equals the planned position; the cross-axis coordinates and the box size
  are kept exactly. Everything the plan does not move -- every other Fit,
  every `pinstGroupProperty` Group target point, every Fixed instance,
  every drop -- is left byte-for-byte equivalent (`pla.write_pla` re-emits
  the untouched rows verbatim).
- A move whose `id` is a **Fixed** instance, or names no Fit at all, is
  refused (`MageError("apply-plan", ...)`). Fixed instances, Group target
  points and drops are never repositioned by a plan.
- A move of a Fit with an **empty `inGroup`** (an ordinary, non-priority
  structure) is refused unless the plan was produced with the relaxation
  that makes ordinary fits movable: `plan-slots --movable-nonpriority`,
  which the CLI records as the `movableNonpriority` token in the plan's
  `model.relaxations`. That token is the exact field this module relies on
  to tell a legitimate ordinary-fit move from a bogus one. (A priority
  mark always carries a non-empty `inGroup`; see `snapshot.build_snapshot`,
  where `priority == bool(fit["inGroup"])`.)
- An **infeasible** plan (`feasible: false`) contributes no moves and is
  refused outright -- it opened no window, so there is nothing to apply.
- The same `id` moved by two plans (or twice within one plan) is refused:
  two planned positions for one structure is a contradiction, never a
  silent last-writer-wins.

`apply_plan(doc, plans, dbu_per_um)` returns `(candidate_doc, summary)`
without doing any I/O: the caller (`mage_placement_cli.py:_cmd_apply_plan`)
reads the PLA and the plans, writes the candidate PLA in micrometres, and
prints the summary. `summary` is `{"movedCount", "totalDisplacementUm",
"maxDisplacementUm", "lanes"}` (the CLI adds `"out"`); displacements are the
along-axis distance each moved Fit travelled from its PLA box, summed and
maxed over every move, as decimal-micrometre strings.
"""
from __future__ import annotations

import copy

from . import core


_REQUIRED_PLAN_KEYS = ("schema", "lane", "model", "feasible", "moves")


def _axis_for_lane(lane):
    """`"H"` or `"V"` from a plan's `lane` id (`H:0`, `V:1`, ...)."""
    if not isinstance(lane, str) or ":" not in lane:
        raise core.MageError("apply-plan", f"plan has no usable lane id: {lane!r}")
    axis = lane.split(":", 1)[0]
    if axis not in ("H", "V"):
        raise core.MageError("apply-plan", f"plan lane {lane!r} names neither an H nor a V axis")
    return axis


def _validate_plan_shape(plan):
    if not isinstance(plan, dict):
        raise core.MageError("apply-plan", "plan is not a JSON object")
    missing = [key for key in _REQUIRED_PLAN_KEYS if key not in plan]
    if missing:
        raise core.MageError("apply-plan", f"plan is missing field(s) {', '.join(missing)}")
    if plan["schema"] != "mage.slot-plan/1":
        raise core.MageError("apply-plan", f"not a mage.slot-plan/1 plan: schema {plan['schema']!r}")


def apply_plan(doc, plans, dbu_per_um):
    """Apply every `plans` move to a copy of `doc`; return `(candidate, summary)`.

    `doc` is a `pla.PlaDocument`; `plans` is a non-empty list of
    `mage.slot-plan/1` bodies (as written by `plan-slots`). Raises
    `MageError("apply-plan", ...)` on every refusal described in the module
    docstring. `doc` itself is never mutated.
    """
    if not plans:
        raise core.MageError("apply-plan", "no plan given; apply-plan needs at least one --plan")

    candidate = copy.deepcopy(doc)
    fits_by_id = {fit["id"]: fit for fit in candidate["fits"]}
    fixed_ids = {entry["id"] for entry in candidate["fixed"]}

    moved_ids = set()
    lanes_touched = []
    displacements_dbu = []

    for plan in plans:
        _validate_plan_shape(plan)
        if not plan["feasible"]:
            reason = plan.get("infeasibleReason") or "no feasible window"
            raise core.MageError(
                "apply-plan", f"plan for lane {plan['lane']!r} is infeasible: {reason}"
            )
        axis = _axis_for_lane(plan["lane"])
        relaxations = plan["model"].get("relaxations", [])
        movable_nonpriority = "movableNonpriority" in relaxations

        lane_had_move = False
        for move in plan["moves"]:
            move_id = move["id"]
            to_dbu = move["toDbu"]

            if move_id in moved_ids:
                raise core.MageError(
                    "apply-plan", f"two plans move the same id {move_id!r}"
                )
            if move_id in fixed_ids:
                raise core.MageError(
                    "apply-plan", f"plan moves a Fixed instance {move_id!r}; Fixed instances never move"
                )
            fit = fits_by_id.get(move_id)
            if fit is None:
                raise core.MageError(
                    "apply-plan", f"plan moves id {move_id!r}, which is not a Fit in the PLA"
                )
            if not fit.get("inGroup") and not movable_nonpriority:
                raise core.MageError(
                    "apply-plan",
                    f"plan moves non-priority (empty inGroup) fit {move_id!r} without the "
                    f"movableNonpriority relaxation (re-run plan-slots with --movable-nonpriority)",
                )

            left, bottom, right, top = fit["boxDbu"]
            if axis == "H":
                size = right - left
                old_along = left
                fit["boxDbu"] = [to_dbu, bottom, to_dbu + size, top]
            else:
                size = top - bottom
                old_along = bottom
                fit["boxDbu"] = [left, to_dbu, right, to_dbu + size]

            moved_ids.add(move_id)
            displacements_dbu.append(abs(to_dbu - old_along))
            lane_had_move = True

        if lane_had_move:
            lanes_touched.append(plan["lane"])

    total_dbu = sum(displacements_dbu)
    max_dbu = max(displacements_dbu) if displacements_dbu else 0
    summary = {
        "movedCount": len(moved_ids),
        "totalDisplacementUm": core.dbu_to_um(total_dbu, dbu_per_um),
        "maxDisplacementUm": core.dbu_to_um(max_dbu, dbu_per_um),
        "lanes": sorted(set(lanes_touched)),
    }
    return candidate, summary
