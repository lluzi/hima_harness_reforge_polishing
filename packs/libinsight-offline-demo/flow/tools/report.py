#!/usr/bin/env python3
"""Build a v1 Library Insight report, a summary.md and a prototype-app.json from offline results.

Demo scope only. This tool reads the derived LibInsight output already in the Campaign workspace
(kit.json, the findings shards, causes.json and the copied calibration) and produces:

  - derived/insight-report.json   a hima-library-insight-report/1 document, most severe first,
                                  capped at the schema limit (<=5000 findings) and well under 2 MiB,
                                  with an explicit note of the total finding count and the cap;
  - derived/summary.md            health per variant x corner, top issues by check, counts, and the
                                  prototype launch command;
  - derived/prototype-app.json    an absolute-path config that points the prototype UI at this run.

evidenceClass is "native-qualified" (an explicit demo decision: the numbers come from the qualified
LibInsight analysis engine over a prepared store). It reads the derived output directly rather than
importing the prototype server, so it can never write into the read-only LibInsight repository.

argv: report.py <WORKSPACE> <KIT>
"""
import gzip
import hashlib
import json
import os
import sys

MAX_FINDINGS = 5000
MAX_FINDINGS_BYTES = 1_800_000   # leaves headroom under the 2 MiB retained-report ceiling
SEVERITY_RANK = {"Error": 0, "Warning": 1, "Opportunity": 2}
LIBRARY_SEVERITY = {"Error": "critical", "Warning": "warning", "Opportunity": "info"}


def fail(message):
    print("libinsight-offline-demo report: " + message, file=sys.stderr)
    raise SystemExit(2)


def clip(text, limit=2000):
    text = "" if text is None else str(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and value == value and value not in (float("inf"), float("-inf"))


def load_findings(findings_dir):
    rows = []
    if not os.path.isdir(findings_dir):
        return rows
    for name in sorted(os.listdir(findings_dir)):
        if not name.endswith(".jsonl.gz"):
            continue
        shard = name[: -len(".jsonl.gz")]
        with gzip.open(os.path.join(findings_dir, name), "rt") as stream:
            for line in stream:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                row["_shard"] = shard
                rows.append(row)
    return rows


def build_report(kit_info, kit_json_sha, findings, calibration):
    kit = kit_info.get("kit", {})
    kit_id = kit.get("id", "library")
    family = clip(("%s %s" % (kit.get("kit", kit_id), kit.get("release", ""))).strip() or kit_id, 2000)

    ranked = sorted(
        findings,
        key=lambda f: (SEVERITY_RANK.get(f.get("severity"), 3), -(f.get("ratio") or 0.0)),
    )

    corners, views = [], []
    corner_set, view_set = set(), set()
    out_findings = []
    seen_ids = set()
    size = 0
    total = len(findings)
    for index, f in enumerate(ranked):
        if len(out_findings) >= MAX_FINDINGS:
            break
        corner = f.get("corner") or "kit-level"
        view = f.get("variant") or "kit"
        if corner not in corner_set and len(corner_set) >= 32:
            continue
        if view not in view_set and len(view_set) >= 32:
            continue
        severity = f.get("severity")
        values = []
        if finite(f.get("ratio")):
            values.append({"name": "severity ratio", "value": float(f["ratio"]), "unit": "ratio"})
        if finite(f.get("magnitude")):
            unit = clip(f.get("unit") or "magnitude", 2000)
            values.append({"name": "magnitude", "value": float(f["magnitude"]), "unit": unit})
        if not values:
            values.append({"name": "severity ratio", "value": None,
                           "unit": "ratio", "missingReason": "the analysis recorded no finite ratio for this finding"})

        base_id = clip("%s:%s/%s" % (f.get("expectation", "E"), view, corner), 1000)
        fid = base_id
        suffix = 0
        while fid in seen_ids:
            suffix += 1
            fid = "%s#%d" % (base_id, suffix)

        subject = f.get("subject") or f.get("detail") or f.get("expectation") or "finding"
        finding = {
            "id": fid,
            "title": clip("%s %s: %s" % (f.get("expectation", "E"), f.get("group", ""), subject)),
            "librarySeverity": LIBRARY_SEVERITY.get(severity, "info"),
            "designRelevance": "unknown",
            "corner": corner,
            "view": view,
            "values": values[:64],
            "provenance": [{
                "sourceRef": clip("libinsight://%s/%s/%s" % (kit_id, f.get("_shard", "findings"), f.get("expectation", "E")), 1024),
                "sha256": kit_json_sha,
                "status": "available",
            }],
            "unknowns": [],
            "rankingReason": clip("%s finding ranked by ratio %.3f. %s" % (
                severity or "Unclassified", f.get("ratio") or 0.0, f.get("detail") or f.get("expected") or "")),
        }
        chunk = len(json.dumps(finding, separators=(",", ":"))) + 1
        if out_findings and size + chunk > MAX_FINDINGS_BYTES:
            break
        size += chunk
        out_findings.append(finding)
        seen_ids.add(fid)
        if corner not in corner_set:
            corner_set.add(corner)
            corners.append(corner)
        if view not in view_set:
            view_set.add(view)
            views.append(view)

    if not out_findings:
        # Schema needs at least one corner and one view even when nothing was ranked.
        variants = kit.get("variants", [])
        corners = [variants[0]["corners"][0]] if variants and variants[0].get("corners") else ["kit-level"]
        views = [variants[0]["id"]] if variants else ["kit"]

    unknowns = [
        clip("This demo report carries the %d most severe of %d findings produced by the analysis; "
             "the cap is the report schema limit (<=5000 findings, <2 MiB). Lower-ratio findings are "
             "omitted from this document but remain in the workspace derived output and the prototype UI."
             % (len(out_findings), total)),
        "Design evidence was not supplied; design impact is unknown for every finding.",
        "Voltage sensitivity and drive/leakage Pareto tradeoffs are available in the interactive "
        "prototype UI; see summary.md for the launch command.",
    ]
    if calibration:
        audited = ", ".join(sorted(calibration.get("audit", {}).keys())) or "none"
        unknowns.append(clip("Reliability calibration is present (audited checks: %s). Estimated "
                             "quantities carry calibration/audit status rather than measured error." % audited))
    unknowns = unknowns[:32]

    unresolved = [f["id"] for f in out_findings[:100]]
    next_actions = [{
        "text": clip("Review the most severe findings first (critical before warning before info) in "
                     "the interactive prototype UI, then decide which checks warrant a library change."),
        "findingIds": unresolved[:100] or [out_findings[0]["id"]] if out_findings else [],
    }] if out_findings else []

    report = {
        "schema": "hima-library-insight-report/1",
        "evidenceClass": "native-qualified",
        "analysis": "library-health",
        "conditions": {
            "family": family,
            "corners": corners[:32],
            "views": views[:32],
            "unknowns": unknowns,
        },
        "findings": out_findings,
        "summary": {
            "best": [],
            "unresolved": unresolved,
            "nextActions": next_actions,
        },
    }
    return report, total


def write_summary(path, kit_info, manifest, findings, calibration, report, total, config_abs, root, kit):
    kit_meta = kit_info.get("kit", {})
    run = kit_info.get("run", {})
    counts = kit_info.get("counts", {})

    per_check = {}
    for f in findings:
        per_check[f.get("expectation", "?")] = per_check.get(f.get("expectation", "?"), 0) + 1

    lines = []
    lines.append("# Library insight (offline demo) — %s %s" % (kit_meta.get("kit", kit), kit_meta.get("release", "")))
    lines.append("")
    lines.append("Offline analysis of a prepared LibInsight store; only the offline analyse step was "
                 "run (no vendor runtime or seat). Evidence class is `native-qualified`.")
    lines.append("")
    lines.append("## Run")
    lines.append("")
    lines.append("| Fact | Value |")
    lines.append("| --- | --- |")
    lines.append("| Kit | `%s` (release `%s`) |" % (kit_meta.get("id", kit), kit_meta.get("release", "")))
    lines.append("| LibInsight commit | `%s` |" % (manifest.get("libInsightCommit") or "unknown"))
    lines.append("| Library files analysed | %s |" % manifest.get("files_analysed"))
    lines.append("| Findings (total) | %s |" % total)
    lines.append("| Findings (in report) | %s |" % len(report["findings"]))
    lines.append("| Causes | %s |" % run.get("causes"))
    lines.append("| Signatures | %s |" % run.get("signatures"))
    lines.append("| Analysis runtime | %ss (LibInsight %s, Python %s, numpy %s) |"
                 % (manifest.get("runtimeSeconds"), run.get("version"), run.get("python"), run.get("numpy")))
    lines.append("")

    lines.append("## Health per variant × corner")
    lines.append("")
    lines.append("Finding count and worst ratio of each analysed variant × corner (from the floor settings).")
    lines.append("")
    lines.append("| Variant | Corner | Findings | Worst ratio | Worst check |")
    lines.append("| --- | --- | --- | --- | --- |")
    rows = []
    for variant, by_corner in counts.items():
        for corner, by_check in by_corner.items():
            n = sum(cell.get("n", 0) for cell in by_check.values())
            worst_check, worst_ratio = "", 0.0
            for check, cell in by_check.items():
                if cell.get("ratio_max", 0.0) >= worst_ratio:
                    worst_ratio, worst_check = cell.get("ratio_max", 0.0), check
            rows.append((n, variant, corner, worst_ratio, worst_check))
    for n, variant, corner, worst_ratio, worst_check in sorted(rows, key=lambda r: -r[0])[:40]:
        lines.append("| %s | %s | %s | %.3f | %s |" % (variant, corner, n, worst_ratio, worst_check))
    lines.append("")

    lines.append("## Top issues by check")
    lines.append("")
    lines.append("| Check | Findings |")
    lines.append("| --- | --- |")
    for check, n in sorted(per_check.items(), key=lambda kv: -kv[1])[:20]:
        lines.append("| %s | %s |" % (check, n))
    lines.append("")

    lines.append("## Voltage sensitivity & Pareto")
    lines.append("")
    lines.append("Per-cell voltage sensitivity and drive/leakage Pareto tradeoffs are interactive and "
                 "are best explored in the prototype UI (`/api/voltage`, `/api/pareto`). This offline "
                 "report captures library-health findings; launch the UI below to inspect sensitivity "
                 "and Pareto for a chosen cell, corner and arc.")
    lines.append("")

    lines.append("## Reliability")
    lines.append("")
    if calibration:
        audited = ", ".join(sorted(calibration.get("audit", {}).keys())) or "none"
        lines.append("Calibration present (`calibration.json`). Audited checks: %s. Estimated "
                     "quantities carry audit status, not measured error." % audited)
    else:
        lines.append("No calibration was copied into this run; estimates carry no audited reliability status.")
    lines.append("")

    lines.append("## Launch the prototype UI (read-only)")
    lines.append("")
    lines.append("```")
    lines.append("cd %s" % root)
    lines.append("PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 app/server.py --config %s --port 8766" % config_abs)
    lines.append("# then open http://127.0.0.1:8766/  (GET-only; do not use the POST routes for the demo)")
    lines.append("```")
    lines.append("")

    with open(path, "w") as stream:
        stream.write("\n".join(lines) + "\n")


def main(argv):
    if len(argv) != 3:
        fail("usage: report.py <WORKSPACE> <KIT>")
    workspace = os.path.abspath(argv[1])
    kit = argv[2]
    derived = os.path.join(workspace, "derived")
    out = os.path.join(derived, kit)
    kit_json_path = os.path.join(out, "kit.json")
    if not os.path.isfile(kit_json_path):
        fail("no analysis output at %s; run the analyse tool first" % kit_json_path)

    manifest_path = os.path.join(derived, "run-manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.isfile(manifest_path) else {}
    root = manifest.get("libInsightRoot")

    with open(kit_json_path, "rb") as stream:
        kit_bytes = stream.read()
    kit_json_sha = hashlib.sha256(kit_bytes).hexdigest()
    kit_info = json.loads(kit_bytes)

    cal_path = os.path.join(out, "calibration.json")
    calibration = json.load(open(cal_path)) if os.path.isfile(cal_path) else None

    findings = load_findings(os.path.join(out, "findings"))
    report, total = build_report(kit_info, kit_json_sha, findings, calibration)

    report_path = os.path.join(derived, "insight-report.json")
    with open(report_path, "w") as stream:
        json.dump(report, stream, separators=(",", ":"))
    report_bytes = os.path.getsize(report_path)
    if report_bytes >= 2 * 1024 * 1024:
        fail("insight report is %d bytes, over the 2 MiB retained-report ceiling" % report_bytes)

    # An absolute-path config for the prototype UI. data_root points inside the workspace so even an
    # accidental POST writes here and never into the read-only LibInsight repository. manifest/store
    # are the repository's own read-only inputs; derived is this run's workspace output.
    config = {
        "data_root": derived,
        "kits": [{
            "manifest": os.path.join(root, "kits", kit + ".json") if root else os.path.join("kits", kit + ".json"),
            "store": os.path.join(root, "data", "store") if root else os.path.join("data", "store"),
            "derived": out,
        }],
    }
    config_path = os.path.join(derived, "prototype-app.json")
    with open(config_path, "w") as stream:
        json.dump(config, stream, indent=1)

    write_summary(os.path.join(derived, "summary.md"), kit_info, manifest, findings, calibration,
                  report, total, config_path, root or "<libInsightRoot>", kit)

    print(json.dumps({"findings_reported": len(report["findings"]), "findingsTotal": total,
                      "reportBytes": report_bytes, "report": report_path}))


if __name__ == "__main__":
    try:
        main(sys.argv)
    except SystemExit:
        raise
    except Exception as error:
        print("libinsight-offline-demo report: %s: %s" % (type(error).__name__, error), file=sys.stderr)
        raise SystemExit(2)
