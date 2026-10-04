#!/usr/bin/env python3
"""Read the deterministic round record (hima-cellfmax-round/1) written by compare-round.

argv: read-round.py <REPORT> <OUT>. The judged values are comparison_valid, best_gain_pct,
custom_adopted and round_improved; the converge read is best_custom_fmax_mhz. The informational
values are shown and never judged. A value the record could not compute is stated unknown.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-cellfmax-round/1":
        raise ValueError("not a hima-cellfmax-round/1 record")
    valid = record.get("comparisonValid") is True
    best_custom = record.get("bestCustomFmaxMhz")
    if best_custom is None:
        raise ValueError("the round record states no best custom Fmax")

    def value(kind, unit, number, reason):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = reason
        return item

    invalid = "the comparison is not valid: %s" % "; ".join(record.get("problems") or ["unknown"])
    flag = lambda b: None if b is None else (1 if b else 0)
    values = [
        {"type": "comparison_valid", "unit": "count", "value": 1 if valid else 0},
        value("round_gain_pct", "percent", record.get("roundGainPct"), invalid),
        value("best_gain_pct", "percent", record.get("bestGainPct"), "no valid round has been measured yet"),
        {"type": "round_improved", "unit": "count", "value": 1 if record.get("roundImproved") is True else 0},
        {"type": "custom_adopted", "unit": "count", "value": int(record.get("customAdopted") or 0)},
        {"type": "best_custom_fmax_mhz", "unit": "mhz", "value": best_custom},
        value("fmax_vs_original_baseline_pct", "percent", record.get("fmaxVsOriginalBaselinePct"), "the custom arm did not finish"),
        {"type": "function_verified", "unit": "count", "value": int(record.get("functionVerified") or 0)},
        value("agent_claim_gain_pct", "percent", record.get("agentClaimGainPct"), "the engineer made no trial claim this round"),
        value("claim_delta_pct", "percent", record.get("claimDeltaPct"), "no claim or no valid Harness gain to compare"),
        value("control_matches_baseline", "count", flag(record.get("controlMatchesBaseline")),
              "not applicable: the round changed the clock or the synthesis method"),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
