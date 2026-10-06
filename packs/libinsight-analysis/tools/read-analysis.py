#!/usr/bin/env python3
"""Fail-closed Reader for `hima-libinsight-analysis/1` deliveries (reader id `libinsight-analysis`).

argv (readers/libinsight-analysis.yml): [/usr/bin/python3, READER, REPORT, OUT, WORKSPACE]

The Host ships only this file into `<WORKSPACE>/hima-readers/<effect>/`, so the shared contract is
imported from the Campaign's deployed `<WORKSPACE>/flow/libinsight_analysis` package, which is the
same code the resident's `check-delivery` self-check and `admit-analysis` run. REPORT is the Host's
retained copy of the materialized delivery; `code.*.path` files are resolved under WORKSPACE, where
the Host materialized the delivered `analysis/` tree before this Reader runs, and every source is
re-hashed on the Site.

On acceptance OUT receives `{"values": [...]}` with li_analysis_error_count 0. On any problem this
script writes no OUT, writes the problems beside REPORT and to WORKSPACE/state/analysis-result.problems.txt,
prints them on stderr and exits 1: a non-zero Reader becomes the same-task repair message.
"""
import json
import os
import sys


def _write(path, text):
    try:
        parent = os.path.dirname(path)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent)
        with open(path, "w", encoding="utf-8") as stream:
            stream.write(text)
    except OSError:
        pass


def main(argv):
    if len(argv) != 4:
        sys.stderr.write("usage: read-analysis.py REPORT OUT WORKSPACE\n")
        return 2
    report, out, workspace = argv[1], argv[2], os.path.abspath(argv[3])
    flow = os.path.join(workspace, "flow")
    sys.path.insert(0, flow)
    from libinsight_analysis import common, delivery

    problems_file = os.path.join(workspace, common.PROBLEMS_PATH)
    try:
        prepared = common.read_json_file(os.path.join(workspace, common.PREPARED_PATH), "prepared request")
        if prepared.get("schema") != common.PREPARED_SCHEMA:
            raise common.LiaError("invalid-input", "prepared request has schema %r" % prepared.get("schema"))
        doc, data = delivery.load_result(os.path.abspath(report))
        found = delivery.problems(doc, workspace, prepared, len(data))
        digest = common.sha256_bytes(data)
    except common.LiaError as error:
        found, digest = [error.detail], None
    if found:
        text = "REJECTED delivery %s\n%s\n" % (digest or "(unreadable)", "\n".join("- " + line for line in found))
        _write(report + ".problems.txt", text)
        _write(problems_file, text)
        sys.stderr.write("libinsight-analysis Reader rejected the delivery (%d problems; also in %s):\n%s" % (
            len(found), problems_file, text))
        return 1
    counts = delivery.measures(doc)
    values = [
        {"type": "li_analysis_error_count", "unit": "count", "value": 0},
        {"type": "li_analysis_plot_count", "unit": "count", "value": counts["plots"]},
        {"type": "li_analysis_dataset_count", "unit": "count", "value": counts["datasets"]},
        {"type": "li_analysis_row_count", "unit": "count", "value": counts["rows"]},
    ]
    _write(problems_file, "ACCEPTED delivery %s\n" % digest)
    with open(out, "w", encoding="utf-8") as stream:
        stream.write(json.dumps({"values": values}, sort_keys=True, allow_nan=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
