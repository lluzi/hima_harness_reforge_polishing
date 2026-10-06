"""Small synthetic stand-ins for the Pack tests and the Host durable fixture.

`write_facts` writes a lib-insight-facts/1 .json.gz shaped exactly like the QuaLib extractor's
output (see knowledge/facts-schema.md) for a few SAED14-named inverters, so the real example
script and the real Reader run on it. The numbers are synthetic, not library evidence.
"""
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
FLOW = os.path.dirname(TESTS)
PACK = os.path.dirname(FLOW)
FIXTURE = os.path.join(TESTS, "fixtures", "saed14-inv-drive-delay")
EXAMPLE_SCRIPT = os.path.join(FIXTURE, "analysis", "inv_drive_delay.py")
READER = os.path.join(PACK, "tools", "read-analysis.py")
CLI = os.path.join(FLOW, "libinsight_cli.py")

SLEWS = [0.003, 0.0053, 0.0136, 0.0292, 0.0536, 0.0879, 0.133]
BASE_LOADS = [0.15, 0.501, 1.734, 4.087, 7.754, 12.9, 19.67]


def _cell(name, drive):
    loads = [BASE_LOADS[0]] + [load * drive / 0.5 for load in BASE_LOADS[1:]]

    def table(kind, scale):
        values = [round(0.002 + scale * (slew * 0.3 + load * 0.004 / drive), 6) for slew in SLEWS for load in loads]
        return {"kind": kind, "sigma": "early_and_late", "template": "logic_tmg_ntin_oload_7x7",
                "index": [list(SLEWS), loads], "values": values}

    return {"name": name, "area": round(0.1776 * (1 + drive / 4.0), 6), "footprint": "INV",
            "flags": {"dff": False, "latch": False, "clock_gating": False, "icg": False, "memory": False},
            "attrs": {"cell_leakage_power": round(101.0 * drive, 3), "cell_footprint": "INV"},
            "leakage": [{"when": "", "value": round(101.0 * drive, 3), "related_pg_pin": "VDD"}],
            "pg_pins": [{"name": "VDD", "pg_type": "primary_power", "attrs": {"voltage_name": "VDD"}}],
            "pins": [
                {"name": "A", "direction": "input", "is_clock": False, "is_bus": False, "is_bus_bit": False,
                 "cap": round(0.38 * drive, 4), "attrs": {}, "timing": [], "internal_power": []},
                {"name": "X", "direction": "output", "is_clock": False, "is_bus": False, "is_bus_bit": False,
                 "cap": 0.0, "attrs": {"function": "!A"}, "internal_power": [],
                 "timing": [{"related_pin": "A", "timing_type": "combinational", "timing_sense": "negative_unate",
                             "when": "", "sdf_cond": "", "tables": [table("cell_rise", 1.0), table("cell_fall", 0.9)]}]}],
            "sequential": []}


def write_facts(path, liberty_path="/synthetic/saed14rvt_tt0p8v25c.lib", liberty_sha="ab" * 32):
    cells = [_cell("SAEDRVT14_INV_0P5", 0.5), _cell("SAEDRVT14_INV_1", 1.0), _cell("SAEDRVT14_INV_4", 4.0),
             _cell("SAEDRVT14_INV_S_2", 2.0), _cell("SAEDRVT14_AN2_1", 1.0)]
    cells[-1]["pins"] = cells[-1]["pins"][:1]
    record = {
        "schema": "lib-insight-facts/1",
        "source": {"path": liberty_path, "bytes": 1234, "sha256": liberty_sha},
        "producer": {"api": "synthetic-test", "schema": "lib-insight-facts/1"},
        "started": "2026-10-05T12:00:00+0000",
        "timing": {"counts": {"cells": len(cells)}},
        "status": "ok",
        "library": {
            "name": "synthetic_saed14rvt_tt", "attrs": {"time_unit": "1ns", "capacitive_load_unit": [1, "ff"], "leakage_power_unit": "1pW"},
            "units": {"time_s": 1e-09, "cap_F": 1e-15, "res_ohm": 1000.0, "voltage_V": 1.0, "current_A": 1e-06,
                      "leakage_W": 1e-12, "dynamic_W": 1e-15},
            "operating_conditions": [{"name": "tt0p8v25c", "attrs": {"voltage": 0.8, "temperature": 25, "process": 1}}],
            "templates": [{"type": "lu_table_template", "name": "logic_tmg_ntin_oload_7x7",
                           "variables": ["input_net_transition", "total_output_net_capacitance"],
                           "index": [[True, [1.0] * 7], [True, [1.0] * 7]]}],
            "other_groups": {}, "cells": cells},
        "finished": "2026-10-05T12:00:01+0000",
    }
    with gzip.open(path, "wt") as stream:
        json.dump(record, stream, separators=(",", ":"))
    return path


def sha256(path):
    with open(path, "rb") as stream:
        return hashlib.sha256(stream.read()).hexdigest()


def request_doc(sources, builds=(), request_id="req-20261005120000-test01", question=None):
    return {"schema": "hima-libinsight-request/1", "requestId": request_id,
            "question": question or "How does inverter delay scale with drive strength at a fixed load?",
            "sources": list(sources), "buildsOn": list(builds), "createdAt": "2026-10-05T12:00:00Z"}


def campaign(root):
    """A Campaign-shaped workspace whose flow/ is this Pack's deployed copy."""
    os.makedirs(os.path.join(root, "state"))
    flow = os.path.join(root, "flow")
    os.makedirs(flow)
    shutil.copy(CLI, flow)
    shutil.copytree(os.path.join(FLOW, "libinsight_analysis"), os.path.join(flow, "libinsight_analysis"),
                    ignore=shutil.ignore_patterns("__pycache__"))
    return root


def run_example(private, prepared, facts, analysis_id="saed14-inv-drive-delay", version=1):
    """Run the real example script in `private` and return (result path, candidate path)."""
    os.makedirs(os.path.join(private, "analysis"), exist_ok=True)
    shutil.copy(EXAMPLE_SCRIPT, os.path.join(private, "analysis", "inv_drive_delay.py"))
    completed = subprocess.run(
        [sys.executable, "analysis/inv_drive_delay.py", "--prepared", prepared, "--facts", facts,
         "--out", "analysis-result.json", "--candidate", "resident-delivery.json", "--id", analysis_id,
         "--version", str(version)], cwd=private, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        raise AssertionError(completed.stderr.decode("utf-8", "replace"))
    return os.path.join(private, "analysis-result.json"), os.path.join(private, "resident-delivery.json")


def materialize(private, workspace):
    """Do what the Host does with a delivery candidate: support files under analysis/, the result at state/."""
    with open(os.path.join(private, "resident-delivery.json")) as stream:
        candidate = json.load(stream)
    for artifact in candidate["artifacts"]:
        source = os.path.join(private, artifact["path"])
        target = (os.path.join(workspace, "state", "analysis-result.json") if artifact["kind"] == "result"
                  else os.path.join(workspace, artifact["path"]))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copyfile(source, target)
    return os.path.join(workspace, "state", "analysis-result.json")
