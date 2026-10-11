#!/usr/bin/env python3
"""Write the Pack's knowledge charts (knowledge/charts/*.chart.json) from the Site's own tools.

  python3 flow/knowledge_charts.py <EDA_ROOT> [<OUT_DIR>]

Runs the reference build (sapr), loads it into HimaTime and reads the stock library with Qualib, in
a scratch directory, then writes with the same chart builders the Pack's steps use (andes_cli.py):

  stage-breakdown.chart.json   share of the worst path's delay by cell family (HimaTime)
  worst-paths.chart.json       slack of the 8 worst paths (HimaTime)
  library-fo4.chart.json       stock FO4 of the critical-path families against the AndesCell target (Qualib)
  reference-summary.chart.json the RTL2GDS reference build's metric table (Synthesis and APR)

The Guide shows them with hima_chart when it explains the design (design-notes.md). The Pack test
regenerates them and holds the committed files to the result, so they match the tools exactly.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import andes_cli as cli  # noqa: E402


def charts(eda_root):
    """The three knowledge charts, by file name, from the tools under eda_root."""
    eda = Path(eda_root)
    inputs = dict(tools={name: dict(path=str(eda / "bin" / name)) for name in cli.TOOLS}, library="std9t_svt")
    env = dict(os.environ, CTU_MOCK_TIME_SCALE="0")
    scratch = Path(tempfile.mkdtemp(prefix="andes-charts-"))
    try:
        for argv in ([str(eda / "bin" / "sapr"), "run", "--design", cli.DESIGN, "--out", str(scratch / "ref"), "--quiet"],
                     [str(eda / "bin" / "himatime"), "load", "--db", str(scratch / "ref"), "--out", str(scratch / "ht"), "--quiet"]):
            out = subprocess.run(argv, capture_output=True, text=True, env=env, timeout=300)
            if out.returncode != 0:
                raise cli.ToolError("%s failed: %s" % (" ".join(argv[:2]), out.stderr.strip()))
        summary = cli.read_json(scratch / "ht" / "timing_summary.json", "timing_summary.json")
        sapr = cli.read_json(scratch / "ref" / "sapr_summary.json", "sapr_summary.json")
        stock = cli.tool_query(inputs, "qualib", ["list", "--lib", "std9t_svt", "--json"])
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    version = cli._version(summary)
    stage = cli.stage_chart(summary, "HimaTime %s stage breakdown (stage_breakdown.rpt) of the reference build" % version,
                            "Reference build on the stock library: Fmax %.2f MHz at the 0.500 ns clock" % summary["fmaxMhz"])
    paths = cli.slack_chart(summary["paths"], "HimaTime %s report_timing of the reference build" % version,
                            "Reference build: WNS %.1f ps, TNS %.0f ps over %d endpoints"
                            % (1000.0 * summary["wnsNs"], 1000.0 * summary["tnsNs"], summary["violatingEndpoints"]))
    critical = [r["family"] for r in sorted(summary["stageBreakdown"], key=lambda r: -r["estRecoveryNs"]) if r["estRecoveryNs"] > 0]
    top = critical[:2]
    library = cli.library_chart(cli.fo4_rows(stock, critical), "The stock library against AndesCell: FO4 of the critical families",
                                "Qualib %s, stock library std9t_svt (qualib list); AndesCell typical speed-ups" % cli._version(stock),
                                "Families on the 20 worst paths, by HimaTime's estimated recovery", highlight=top)
    reference = cli.metrics_chart("RTL2GDS reference build: summary", [("Reference build", "baseline", sapr)],
                                  "Synthesis and APR %s, the reference build (sapr_summary.json, flow_summary.rpt)" % cli._version(sapr),
                                  subtitle="aes_cipher_top on the stock library std9t_svt at 0.500 ns (2 GHz)", caption=cli.SHOWN_BOUNDARY)
    return {"stage-breakdown.chart.json": stage, "worst-paths.chart.json": paths, "library-fo4.chart.json": library,
            "reference-summary.chart.json": reference}


def main(argv):
    if len(argv) not in (2, 3):
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    out = Path(argv[2]) if len(argv) == 3 else HERE.parent / "knowledge" / "charts"
    out.mkdir(parents=True, exist_ok=True)
    for name, doc in charts(argv[1]).items():
        cli.write_text(out / name, json.dumps(doc, indent=2, sort_keys=True) + "\n")
        print("wrote %s" % (out / name))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except cli.ToolError as error:
        print("knowledge_charts: %s" % error, file=sys.stderr)
        sys.exit(3)
