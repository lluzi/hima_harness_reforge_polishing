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


def _orientation_of(base, rule_facts):
    """`"V"`/`"H"`/`"ANY"` for a reserve key, from its rule fact's `scribeInc`.

    Matches the reference method (`ceiling4.py`): only a lane-exclusive
    `["VERT"]`/`["HORIZ"]` fact fixes a key to one axis; every other value
    (`["ALL"]`, an interior/edge variant, empty, or a missing rule fact)
    leaves it unconstrained (`ANY`) and so reservable into neither stage.
    """
    fact = rule_facts.get(base.split(".")[0]) or {}
    inc = fact.get("scribeInc") or []
    if inc == ["VERT"]:
        return "V"
    if inc == ["HORIZ"]:
        return "H"
    return "ANY"


def _reserve_key(drop, orientation):
    """One normalised reserve key (a Fit-shaped dict) from an incumbent drop.

    A VERT-only key whose incumbent box is wider than tall is transposed to a
    lane-direction (tall) box, exactly as the reference method does for a
    `V` block; the `placedFlag` a drop carries is dropped so the key writes
    back as an ordinary Fit row.
    """
    key = {k: v for k, v in drop.items() if k != "placedFlag"}
    l, b, r, t = key["boxDbu"]
    w, h = r - l, t - b
    if orientation == "V" and w > h:
        key["boxDbu"] = [l, b, l + h, b + w]
    return key


def _collect_reserve_keys(reserve_drops, reserve_length_dbu, rule_facts):
    """Classify the incumbent's long dropped structures by lane orientation.

    Returns `{"V": [...], "H": [...], "ANY": [...]}` of Fit-shaped keys whose
    longest side is at least `reserve_length_dbu`; `ANY` keys (no
    lane-exclusive `scribeInc`) are reservable into neither stage, matching
    the reference method.
    """
    buckets = {"V": [], "H": [], "ANY": []}
    for drop in reserve_drops:
        l, b, r, t = drop["boxDbu"]
        if max(r - l, t - b) < reserve_length_dbu:
            continue
        orientation = _orientation_of(drop["base"], rule_facts)
        buckets[orientation].append(_reserve_key(drop, orientation))
    return buckets


def _follow_groups(candidate, moved_fits):
    """Move each moved Fit's Group target point by that Fit's own delta.

    MAGE's compaction rewrites a Group's target point when it moves the
    Group, so a candidate that shifts a priority mark must shift its Group
    target point the same way or the two disagree after the fill. Returns the
    number of Group target points shifted.
    """
    groups_by_label = {}
    for group in candidate["groups"]:
        groups_by_label.setdefault(group["pinstGroup"], []).append(group)
    shifted = 0
    for fit, dx, dy in moved_fits:
        label = fit.get("inGroup")
        if not label:
            continue
        for group in groups_by_label.get(label, []):
            x, y = group["targetPointDbu"]
            group["targetPointDbu"] = [x + dx, y + dy]
            shifted += 1
    return shifted


def _reserve(candidate, plans_in_order, buckets, dbu_per_um):
    """Place reserved keys into the plans' slot starts, by lane orientation.

    `plans_in_order` is the list of `(plan, axis)` this apply-plan is
    realising, all sharing one axis (the caller refuses a mixed-axis reserve).
    Keys of that axis (`V`/`H`) are placed into the plans' `slotStarts` with
    1 um clearance and a lane-direction box whose cross extent is exactly the
    plan lane's cross band; plans are filled most-slots-first, as the
    reference method does. Returns `(reserved_by_axis, unreserved)`.
    """
    clearance = core.um_to_dbu("1", dbu_per_um)
    stage_axis = plans_in_order[0][1]
    stage_keys = list(buckets[stage_axis])
    reserved = {"V": 0, "H": 0}
    cursor = 0
    for plan, axis in sorted(plans_in_order, key=lambda pa: -pa[0]["maxSlots"]):
        lo, _hi = plan["_crossRangeDbu"]
        for start in plan["slotStarts"]:
            if cursor >= len(stage_keys):
                break
            key = stage_keys[cursor]
            cursor += 1
            l, b, r, t = key["boxDbu"]
            w, h = r - l, t - b
            if axis == "H":
                key["boxDbu"] = [start + clearance, lo, start + clearance + w, lo + h]
            else:
                key["boxDbu"] = [lo, start + clearance, lo + w, start + clearance + h]
            candidate["fits"].append(key)
            reserved[axis] += 1

    unreserved = []
    for axis in ("V", "H"):
        left = buckets[axis][reserved[axis]:] if axis == stage_axis else buckets[axis]
        for key in left:
            unreserved.append(key["id"])
    unreserved.extend(key["id"] for key in buckets["ANY"])
    return reserved, sorted(unreserved)


def _axis_of_box(box):
    """`"H"` when a box is at least as wide as it is tall, else `"V"`."""
    l, b, r, t = box
    return "H" if (r - l) >= (t - b) else "V"


def _straddle_guard(candidate, start_fits, start_groups, lanes, frame, limit_dbu, dbu_per_um):
    """Keep every moved priority mark clear of a lane crossing band.

    A moved mark that straddles a crossing band is overlapped by MAGE's fill;
    this post-pass nudges each straddler clear within its own CT window
    (`limit_dbu`), inside the frame, without touching a lane neighbour (1 um
    gap). When no nudge is possible the mark is reverted to its frozen-start
    box and any reserved key that then collides with it is removed. Ports
    `ceiling4.py:fix_straddlers`. Returns `{"nudged", "reverted", "keysRemoved"}`.
    """
    gap = core.um_to_dbu("1", dbu_per_um)
    width_dbu, height_dbu = frame["widthDbu"], frame["heightDbu"]
    start_by_id = {fit["id"]: fit for fit in start_fits}
    start_ids = set(start_by_id)
    ct_by_group = {}
    for group in start_groups:
        ct_by_group[group["pinstGroup"]] = list(group["targetPointDbu"])
    v_bands = sorted({tuple(l["crossRangeDbu"]) for l in lanes if l["axis"] == "V"})
    h_bands = sorted({tuple(l["crossRangeDbu"]) for l in lanes if l["axis"] == "H"})

    def bands_hit(box):
        l, b, r, t = box
        if _axis_of_box(box) == "H":
            return [(x0, x1) for x0, x1 in v_bands if l < x1 and r > x0]
        return [(y0, y1) for y0, y1 in h_bands if b < y1 and t > y0]

    def lane_mates(fit):
        axis = _axis_of_box(fit["boxDbu"])
        fb = fit["boxDbu"]
        mates = []
        others = [o for o in candidate["fits"] if o["id"] != fit["id"]]
        others += [{"id": x["id"], "boxDbu": x["boxDbu"]} for x in candidate["fixed"]]
        for o in others:
            ob = o["boxDbu"]
            if axis == "H" and ob[1] < fb[3] and ob[3] > fb[1]:
                mates.append(o)
            elif axis == "V" and ob[0] < fb[2] and ob[2] > fb[0]:
                mates.append(o)
        return mates

    def clear(fit, box):
        axis = _axis_of_box(box)
        lo, hi = (box[0], box[2]) if axis == "H" else (box[1], box[3])
        for o in lane_mates(fit):
            ob = o["boxDbu"]
            olo, ohi = (ob[0], ob[2]) if axis == "H" else (ob[1], ob[3])
            if olo < hi + gap and ohi > lo - gap:
                return False
        return True

    def shift_group(label, dx, dy, base_point):
        for group in candidate["groups"]:
            if group["pinstGroup"] == label:
                group["targetPointDbu"] = [base_point[0] + dx, base_point[1] + dy]

    nudged = reverted = keys_removed = 0
    for fit in candidate["fits"]:
        start = start_by_id.get(fit["id"])
        if start is None or start["boxDbu"] == fit["boxDbu"] or not fit.get("inGroup"):
            continue
        hits = bands_hit(fit["boxDbu"])
        if not hits:
            continue
        box = fit["boxDbu"]
        axis = _axis_of_box(box)
        length = (box[2] - box[0]) if axis == "H" else (box[3] - box[1])
        target = ct_by_group.get(fit["inGroup"])
        fixed = False
        for (b0, b1) in hits:
            for new_start in (b1 + gap, b0 - gap - length):
                if axis == "H":
                    candidate_box = [new_start, box[1], new_start + length, box[3]]
                    centre = (candidate_box[0] + candidate_box[2]) / 2
                    target_coord = target[0] if target else None
                else:
                    candidate_box = [box[0], new_start, box[2], new_start + length]
                    centre = (candidate_box[1] + candidate_box[3]) / 2
                    target_coord = target[1] if target else None
                if target_coord is not None and abs(centre - target_coord) > limit_dbu:
                    continue
                if candidate_box[0] < 0 or candidate_box[1] < 0 \
                        or candidate_box[2] > width_dbu or candidate_box[3] > height_dbu:
                    continue
                if bands_hit(candidate_box):
                    continue
                if clear(fit, candidate_box):
                    fit["boxDbu"] = candidate_box
                    fixed = True
                    break
            if fixed:
                break
        if fixed:
            nudged += 1
            dx = fit["boxDbu"][0] - start["boxDbu"][0]
            dy = fit["boxDbu"][1] - start["boxDbu"][1]
            if fit["inGroup"] in ct_by_group:
                shift_group(fit["inGroup"], dx, dy, ct_by_group[fit["inGroup"]])
            continue
        # No nudge works: revert the mark and remove the keys it now blocks.
        fit["boxDbu"] = list(start["boxDbu"])
        reverted += 1
        if fit["inGroup"] in ct_by_group:
            shift_group(fit["inGroup"], 0, 0, ct_by_group[fit["inGroup"]])
        keep = []
        for o in candidate["fits"]:
            if o["id"] in start_ids or o is fit:
                keep.append(o)
                continue
            ob, fb = o["boxDbu"], fit["boxDbu"]
            if ob[0] < fb[2] and ob[2] > fb[0] and ob[1] < fb[3] and ob[3] > fb[1]:
                keys_removed += 1
                continue
            keep.append(o)
        candidate["fits"] = keep
    return {"nudged": nudged, "reverted": reverted, "keysRemoved": keys_removed}


def apply_plan(doc, plans, dbu_per_um, *, follow_groups=True, reserve=None,
               reserve_length_dbu=None, rule_facts=None, straddle_guard=False,
               start_fits=None, start_groups=None, lanes=None, frame=None,
               limit_dbu=None):
    """Apply every `plans` move to a copy of `doc`; return `(candidate, summary)`.

    `doc` is a `pla.PlaDocument`; `plans` is a non-empty list of
    `mage.slot-plan/1` bodies (as written by `plan-slots`). Raises
    `MageError("apply-plan", ...)` on every refusal described in the module
    docstring. `doc` itself is never mutated.

    Three optional post-passes realise the reserve-first method on top of the
    plain move (each reported in `summary`):

    - `follow_groups` (default on): after the moves, shift each moved Fit's
      Group target point (`pinstGroupProperty`) by the Fit's own delta, so a
      candidate never disagrees with MAGE's own Group-point rewrite.
    - `reserve` (a list of incumbent drop dicts, with `reserve_length_dbu`
      and `rule_facts`): place every long dropped structure of the stage's
      lane orientation into the plans' `slotStarts` as an ordinary Fit (1 um
      clearance, lane-direction box). Needs every plan to carry
      `_crossRangeDbu`; refuses a mixed-axis reserve.
    - `straddle_guard` (needs `start_fits`/`start_groups`/`lanes`/`frame`/
      `limit_dbu`): nudge or revert every moved priority mark that straddles a
      lane crossing band (`_straddle_guard`).
    """
    if not plans:
        raise core.MageError("apply-plan", "no plan given; apply-plan needs at least one --plan")

    candidate = copy.deepcopy(doc)
    fits_by_id = {fit["id"]: fit for fit in candidate["fits"]}
    fixed_ids = {entry["id"] for entry in candidate["fixed"]}

    moved_ids = set()
    moved_fits = []
    lanes_touched = []
    displacements_dbu = []
    plans_in_order = []

    for plan in plans:
        _validate_plan_shape(plan)
        if not plan["feasible"]:
            reason = plan.get("infeasibleReason") or "no feasible window"
            raise core.MageError(
                "apply-plan", f"plan for lane {plan['lane']!r} is infeasible: {reason}"
            )
        axis = _axis_for_lane(plan["lane"])
        plans_in_order.append((plan, axis))
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
                moved_fits.append((fit, to_dbu - old_along, 0))
            else:
                size = top - bottom
                old_along = bottom
                fit["boxDbu"] = [left, to_dbu, right, to_dbu + size]
                moved_fits.append((fit, 0, to_dbu - old_along))

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

    summary["groupPointsShifted"] = _follow_groups(candidate, moved_fits) if follow_groups else 0

    if reserve is not None:
        axes = {axis for _plan, axis in plans_in_order}
        if len(axes) > 1:
            raise core.MageError(
                "apply-plan",
                f"--reserve needs every --plan on one lane axis; a key's lane-direction box "
                f"and cross band are per-axis, but these plans span {sorted(axes)}",
            )
        buckets = _collect_reserve_keys(reserve, reserve_length_dbu, rule_facts or {})
        reserved, unreserved = _reserve(candidate, plans_in_order, buckets, dbu_per_um)
        summary["reserved"] = reserved
        summary["unreserved"] = unreserved

    if straddle_guard and start_fits is not None:
        summary["straddle"] = _straddle_guard(
            candidate, start_fits, start_groups or [], lanes or [], frame or {},
            limit_dbu, dbu_per_um,
        )

    return candidate, summary
