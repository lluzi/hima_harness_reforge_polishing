import re
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[3]


def _budget_expression(stages_path):
    text = stages_path.read_text()
    match = re.search(
        r'"budgets":\s*\{"max_candidate_cells":\s*([^,]+),', text
    )
    assert match, "no design-mapping budgets.max_candidate_cells assignment found in %s" % stages_path
    return match.group(1).strip()


def test_design_mapping_candidate_cell_budget_matches_drive_expanded_pool():
    # stage_design_mapping_timing (flow/stages.py, tools/stages.py) computes
    # candidate_cells as one distinct cell_name PER (candidate, drive) pair via
    # expected_generation_jobs -- a pool of up to
    # len(requests) * len(DRIVE_FAMILY_ORDER) physical Cells (50 demands * 5
    # drives = 250 in a full-drive-family generation). The budget it is
    # checked against must be expressed in that same drive-expanded unit,
    # otherwise a Run with every demand accepted by calibration (the intended
    # happy path) is wrongly rejected as "candidate_cells exceeds
    # budgets.max_candidate_cells" the first time it reaches mapping, with no
    # FAIL edge to route through -- a permanent dead-end for a genuinely
    # healthy Run. lfr_new_cell_budget(ctx) alone (bound to MAX_NEW_CELLS,
    # 1..50) is the raw per-topology count, not the drive-expanded count.
    for candidate in ("flow/stages.py", "tools/stages.py"):
        expression = _budget_expression(PACK_ROOT / candidate)
        assert "DRIVE_FAMILY_ORDER" in expression, (
            "%s's design-mapping budgets.max_candidate_cells is %r, which does not "
            "scale with the drive-expanded candidate_cells pool it is checked "
            "against" % (candidate, expression)
        )
