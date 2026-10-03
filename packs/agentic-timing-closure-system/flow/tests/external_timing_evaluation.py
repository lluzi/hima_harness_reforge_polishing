"""External evaluator only: never imported by a production Reader or Campaign.

Compare independently retained product and serial-reference evidence without writing either.
Execution fairness/strategy strength is a separate evaluator responsibility; this helper verifies
fixed input identity and raw measurements and reports only their timing effect.
"""
from pathlib import Path
import math
from atcs import core, contributions

def timing_effect(candidate, reference, goal, core):
    """Goal-aware effect: satisfying margin is expendable; unsatisfied residuals cannot be hidden."""
    signs = set()
    epsilon = 1e-9
    for mode in ("setup", "hold"):
        target = goal[f"{mode}WnsNs"]
        current, control = candidate[mode], reference[mode]
        current_ok = current["violations"] == 0 and current["wnsNs"] >= target
        control_ok = control["violations"] == 0 and control["wnsNs"] >= target
        if current_ok or control_ok:
            signs.add(0 if current_ok and control_ok else 1 if current_ok else -1)
            continue
        deltas = (
            control["violations"] - current["violations"],
            current["wnsNs"] - control["wnsNs"],
            current["tnsNs"] - control["tnsNs"],
        )
        metric_signs = {1 if delta > epsilon else -1 if delta < -epsilon else 0 for delta in deltas}
        if 1 in metric_signs and -1 in metric_signs:
            return core.unknown(f"resident and ordinary AutoFix {mode} residual effects are mixed")
        signs.add(1 if 1 in metric_signs else -1 if -1 in metric_signs else 0)
    if signs <= {0}:
        return core.known(0)
    if signs <= {0, 1}:
        return core.known(1)
    if signs <= {-1, 0}:
        return core.known(-1)
    return core.unknown("resident and ordinary AutoFix Goal/residual effects are mixed; neither dominates")



def evaluate(reader, result_path, product_workspace, reference_path, reference_workspace, goal):
    reader.read("engineering-result", result_path, product_workspace)
    result = reader._load_json(result_path)
    control = reader._load_json(reference_path)
    reader._verify_identity(control, "autofix-reference", core)
    if (not isinstance(goal, dict) or set(goal) != {"setupWnsNs", "holdWnsNs"}
            or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in goal.values())):
        raise ValueError("external evaluation requires finite setup/hold targets")
    if goal != {"setupWnsNs": 0, "holdWnsNs": 0}:
        raise ValueError("external evaluation target differs from this product method's fixed 0 ns targets")
    if control.get("goal") != goal:
        raise ValueError("external reference target differs from evaluation target")
    if control.get("inputIdentity") != result["inputIdentity"]:
        raise ValueError("external reference does not use the product's exact input/R1 identity")
    before = reader._engineering_metrics(result["measurements"]["before"], "product.before")
    after = reader._engineering_metrics(result["measurements"]["after"], "product.after")
    reference = {}
    for phase in ("before", "after"):
        raw = control.get("measurements", {}).get(phase)
        reference[phase] = reader._engineering_metrics(raw, f"external reference.{phase}")
        reader._verify_engineering_metric_reports(raw, reference[phase], Path(reference_workspace), core,
                                                  contributions, f"external reference.{phase}")
    if reference["before"] != before:
        raise ValueError("external reference did not start from the same measured R1")
    return {"effect": reader._emit("external_timing_effect", "count", timing_effect(after, reference["after"], goal, core)),
            "before": before, "selected": after, "reference": reference["after"],
            "scope": "raw timing effect; serial strategy/trace fairness is assessed externally"}
