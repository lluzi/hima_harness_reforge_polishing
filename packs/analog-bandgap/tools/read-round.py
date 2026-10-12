#!/usr/bin/env python3
"""Read the round record (hima-bandgap-round/1) written by record-round.

argv: read-round.py <REPORT> <OUT>. The judged values are round_valid (the constraint: every
measurement this round is of the accepted design and the corners were measured) and signed_off (the
Goal: every line at every corner, Monte Carlo in band, a clean layout and every line at every corner
after layout). worst_margin_pct is the latest measured stage's worst margin; the converge read
best_margin_pct is the best of the valid rounds so far, -100 before the first.
"""
import json
import sys


def main(report_path, out_path):
    r = json.load(open(report_path))
    if r.get("schema") != "hima-bandgap-round/1":
        raise ValueError("not a hima-bandgap-round/1 record")
    problems = "; ".join(r.get("problems") or []) or "no corner measurement of the accepted design this round"
    margin = r.get("worstMarginPct")
    values = [
        {"type": "round_valid", "unit": "count", "value": 1 if r.get("roundValid") is True else 0},
        {"type": "signed_off", "unit": "count", "value": 1 if r.get("signedOff") is True else 0},
        {"type": "worst_margin_pct", "unit": "percent", "value": margin,
         **({} if margin is not None else {"unknownReason": problems})},
        {"type": "best_margin_pct", "unit": "percent", "value": r["bestMarginPct"]},
        {"type": "round_improved", "unit": "count", "value": 1 if r.get("roundImproved") is True else 0},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
