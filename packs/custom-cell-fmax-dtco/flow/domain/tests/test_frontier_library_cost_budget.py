import re
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[3]


def _frontier_budget_expression(stages_path):
    text = stages_path.read_text()
    match = re.search(
        r'"max_new_library_cells":\s*([^,]+),\s*\n\s*"max_generation_units":\s*([^,]+),',
        text,
    )
    assert match, "no frontier budgets.max_new_library_cells assignment found in %s" % stages_path
    return match.group(1).strip(), match.group(2).strip()


def test_frontier_library_cost_budget_matches_drive_expanded_pool():
    # stage_design_mapping_timing's frontier_request carries a per-round
    # library_cost of {new_library_cells, generation_units} = len(candidate_cells)
    # -- the SAME drive-expanded physical-cell pool (one entry per
    # (candidate, drive) pair, see test_design_mapping_candidate_cell_budget.py)
    # -- accumulated across every round of the Campaign
    # (cumulative_cost in evaluate_frontier, library_richness.py). The budgets
    # it is checked against, max_new_library_cells/max_generation_units, were
    # left as the raw MAX_CELLS value (a per-topology cumulative Library cap,
    # matching the sibling check at stages.py's MAX_CELLS guard four lines
    # above the candidate_cells computation). Left unscaled, a second full
    # generation's cumulative drive-expanded cost silently exceeds a topology-
    # scale cap that the Library's actual topology count is nowhere near --
    # evaluate_frontier's own top-level status stays "succeeded" so this never
    # raises, but it marks the affected round "rejected" and excludes it from
    # frontier membership, which resurfaces later as an unexplained
    # portfolio-gate FAIL/next-research loop with no direct evidence pointing
    # back to this unit mismatch.
    for candidate in ("flow/stages.py", "tools/stages.py"):
        cells_expr, units_expr = _frontier_budget_expression(PACK_ROOT / candidate)
        assert "DRIVE_FAMILY_ORDER" in cells_expr, (
            "%s's frontier budgets.max_new_library_cells is %r, which does not "
            "scale with the drive-expanded library_cost.new_library_cells it is "
            "checked against" % (candidate, cells_expr)
        )
        assert "DRIVE_FAMILY_ORDER" in units_expr, (
            "%s's frontier budgets.max_generation_units is %r, which does not "
            "scale with the drive-expanded library_cost.generation_units it is "
            "checked against" % (candidate, units_expr)
        )
