#!/usr/bin/env python3
"""Accept or refuse the engineer's round recipe (hima-cellfmax-round-recipe/1) at delivery.

argv: read-recipe.py <REPORT> <OUT> <WORKSPACE>. The checks are the Pack's own validator in
<WORKSPACE>/flow/cellfmax_cli.py (one source for the delivery check and the arms). A refused recipe
exits non-zero with the exact change needed, so the same engineering task can repair it.
"""
import importlib.util
import json
import os
import sys


def main(report_path, out_path, workspace):
    cli_path = os.path.join(workspace, "flow", "cellfmax_cli.py")
    spec = importlib.util.spec_from_file_location("cellfmax_cli", cli_path)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    if os.path.realpath(report_path) != os.path.realpath(os.path.join(workspace, "state", "round-recipe.json")):
        raise ValueError("the recipe report is not the Campaign's state/round-recipe.json")
    try:
        recipe, _digest = cli.validate_recipe(workspace)
    except cli.ToolError as error:
        raise ValueError("round recipe refused: %s" % error)
    k = recipe["round"]
    cells = (recipe.get("library") or {}).get("cells") or []
    values = [
        {"type": "recipe_valid", "unit": "count", "value": 1},
        {"type": "recipe_new_cells", "unit": "count", "value": sum(1 for cell in cells if cell.get("origin") == "r%d" % k)},
        {"type": "recipe_period_ns", "unit": "ns", "value": float(recipe["periodNs"])},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
