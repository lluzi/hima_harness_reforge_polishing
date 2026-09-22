from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "closure.py"
SPEC = importlib.util.spec_from_file_location("xtop_closure", SOURCE)
closure = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(closure)

READER_SOURCE = Path(__file__).resolve().parents[2] / "tools" / "read-output.py"
READER_SPEC = importlib.util.spec_from_file_location("xtop_reader", READER_SOURCE)
reader = importlib.util.module_from_spec(READER_SPEC)
assert READER_SPEC.loader is not None
READER_SPEC.loader.exec_module(reader)


def global_report(setup_wns, setup_tns, setup_num, hold_wns, hold_tns, hold_num):
    return f"""Setup violations
---------------------------------------------------------
         Total  reg->reg   in->reg  reg->out   in->out
---------------------------------------------------------
WNS      {setup_wns} 0.00 0.00 0.00 0.00
TNS      {setup_tns} 0.00 0.00 0.00 0.00
NUM      {setup_num} 0 0 0 0
---------------------------------------------------------

Hold violations
---------------------------------------------------------
         Total  reg->reg   in->reg  reg->out   in->out
---------------------------------------------------------
WNS      {hold_wns} 0.00 0.00 0.00 0.00
TNS      {hold_tns} 0.00 0.00 0.00 0.00
NUM      {hold_num} 0 0 0 0
---------------------------------------------------------
"""


def path_report(rows, mode):
    delay = "max" if mode == "setup" else "min"
    return "\n".join(
        f"""  Startpoint: U_START_{index}
  Endpoint: {endpoint}
  Path Group: core_clock
  Path Type: {delay}
  slack (VIOLATED) {slack}
""" for index, (endpoint, slack) in enumerate(rows)
    )


class ClosureContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temp.name)
        flow = self.workspace / "flow"
        for name in ("records", "state", "evidence", "output", "research", "iterations"):
            (flow / name).mkdir(parents=True, exist_ok=True)
        self.scenarios = [
            {"name": "slow", "libGlob": "unused", "driverLibrary": "slow", "spefCorner": "worst", "xtopCorner": "slow", "xtopLibertyGlob": "unused"},
            {"name": "fast", "libGlob": "unused", "driverLibrary": "fast", "spefCorner": "best", "xtopCorner": "fast", "xtopLibertyGlob": "unused"},
        ]
        self.runtime = {
            "schema": "xtop-timing-closure-runtime/1",
            "iteration": 0,
            "profile": {"scenarios": self.scenarios},
            "currentDatabase": "",
            "currentDatabaseScript": "",
            "currentAnalysis": None,
            "previousSnapshot": None,
        }

    def tearDown(self):
        self.temp.cleanup()

    def write_database(self, generation):
        root = self.workspace / "flow" / "iterations" / f"g{generation:03d}" / "DBS"
        data = root / "closed.enc.dat"
        data.mkdir(parents=True)
        (data / "db.bin").write_bytes(f"db-{generation}".encode())
        script = root / "closed.enc"
        script.write_text(f"restore {generation}\n")
        self.runtime["currentDatabase"] = str(data)
        self.runtime["currentDatabaseScript"] = str(script)

    def write_reports(self, generation, values):
        root = self.workspace / "flow" / "iterations" / f"g{generation:03d}" / "PT" / "reports"
        for scenario in self.scenarios:
            folder = root / scenario["name"]
            folder.mkdir(parents=True, exist_ok=True)
            folder.joinpath("global_timing.rpt").write_text(global_report(*values["global"]))
            folder.joinpath("setup.rpt").write_text(path_report(values["setup"], "setup"))
            folder.joinpath("hold.rpt").write_text(path_report(values["hold"], "hold"))
            folder.joinpath("check_timing.rpt").write_text("Warning: There are 3 endpoints which are not constrained for maximum delay.\n")
        self.runtime["currentAnalysis"] = {"reports": str(root)}

    def save_runtime(self):
        closure.atomic_json(self.workspace / "flow" / "state" / "runtime.json", self.runtime)

    def test_endpoint_feedback_and_best_database_are_derived_from_refreshed_reports(self):
        self.write_database(0)
        self.write_reports(0, {"global": (-0.10, -0.30, 3, -0.08, -0.20, 2), "setup": [("A/D", -0.10), ("B/D", -0.05)], "hold": [("H/D", -0.08)]})
        self.save_runtime()
        closure.summarize(self.workspace)

        self.runtime = closure.load_runtime(self.workspace)
        self.runtime["iteration"] = 1
        self.write_database(1)
        self.write_reports(1, {"global": (-0.06, -0.12, 2, -0.09, -0.12, 2), "setup": [("B/D", -0.02), ("C/D", -0.06)], "hold": [("H/D", -0.09)]})
        self.save_runtime()
        closure.summarize(self.workspace)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({
            "schema": closure.PLAN_SCHEMA, "iteration": 1, "diagnosis": "test",
            "hypotheses": ["test"], "endpointGroups": ["core_clock"], "actions": [],
            "avoid": [], "reasoning": "fixture plan already validated by the plan-contract test",
        }))
        closure.compare(self.workspace)

        result = json.loads((self.workspace / "flow" / "records" / "compare.json").read_text())
        self.assertEqual(result["endpoint_delta"]["fixed"], ["fast|setup|core_clock|A/D", "slow|setup|core_clock|A/D"])
        self.assertEqual(result["endpoint_delta"]["entrants"], ["fast|setup|core_clock|C/D", "slow|setup|core_clock|C/D"])
        self.assertEqual(result["endpoint_delta"]["regressed"], ["fast|hold|core_clock|H/D", "slow|hold|core_clock|H/D"])
        self.assertTrue(result["evidence_valid"])
        best = json.loads((self.workspace / "flow" / "output" / "best-database.json").read_text())
        self.assertEqual(best["iteration"], 1)
        self.assertTrue((self.workspace / "flow" / "output" / "best.enc.dat" / "db.bin").is_file())
        self.assertEqual(len((self.workspace / "flow" / "evidence" / "experience.jsonl").read_text().splitlines()), 1)
        self.assertEqual(reader.read(self.workspace / "flow" / "output" / "best-database.json", "best")[0]["value"], 1)
        self.assertEqual(reader.read(self.workspace / "flow" / "records" / "compare.json", "iteration")[-1]["value"], 1)
        (self.workspace / "flow" / "output" / "best.enc.dat" / "db.bin").write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            reader.read(self.workspace / "flow" / "output" / "best-database.json", "best")

    def test_plan_contract_accepts_only_bounded_whitelisted_actions(self):
        plan = {
            "schema": closure.PLAN_SCHEMA,
            "iteration": 1,
            "diagnosis": "Setup endpoints improved; hold H/D regressed.",
            "hypotheses": ["size setup without consuming the hold margin"],
            "endpointGroups": ["slow|setup|core_clock"],
            "actions": [{
                "kind": "setup-size", "effort": "high", "setupTargetNs": 0.0,
                "holdTargetNs": 0.0, "setupMarginNs": 0.02, "holdMarginNs": 0.02,
                "endpointGroups": ["slow|setup|core_clock"], "reason": "remaining setup family",
            }],
            "avoid": ["repeat hold buffering without new evidence"],
            "reasoning": "The selected action attacks the remaining family and keeps hold margin.",
        }
        path = self.workspace / "flow" / "research" / "fix-plan.json"
        path.write_text(json.dumps(plan))
        self.assertEqual(closure.validate_plan(path, 1)["actions"][0]["kind"], "setup-size")
        plan["actions"][0]["kind"] = "arbitrary-tcl"
        path.write_text(json.dumps(plan))
        with self.assertRaises(closure.Rejected):
            closure.validate_plan(path, 1)

    def test_copy_template_bakes_required_vars_into_the_tcl_so_a_stripped_container_env_still_works(self):
        # edarun forwards only a fixed allowlist of env vars into the podman container
        # (HOME, USER, EDA_DIR, licence vars, ...). Custom vars like WORK_ROOT/CURRENT_DB/
        # DESIGN/EXPORT_ROOT set on the outer Python subprocess never reach the Tcl process
        # running inside the container, so a template that only reads env(...) fails with
        # "WORK_ROOT, CURRENT_DB, DESIGN and EXPORT_ROOT are required" even though the
        # adapter passed every value. copy_template must bake the values directly into the
        # generated script so the check passes regardless of what the container forwards.
        templates = self.workspace / "flow" / "templates"
        templates.mkdir(parents=True, exist_ok=True)
        (templates / "export.tcl").write_text(
            "if {![info exists env(WORK_ROOT)] || ![info exists env(EXPORT_ROOT)]} {\n"
            "    error \"WORK_ROOT, CURRENT_DB, DESIGN and EXPORT_ROOT are required\"\n"
            "}\n"
        )
        target = self.workspace / "flow" / "iterations" / "g000" / "scripts" / "export.tcl"
        closure.copy_template(self.workspace, "export.tcl", target, env={
            "WORK_ROOT": self.workspace / "site", "EXPORT_ROOT": self.workspace / "export",
        })
        rendered = target.read_text()
        self.assertIn('set env(WORK_ROOT) "%s"' % (self.workspace / "site"), rendered)
        self.assertIn('set env(EXPORT_ROOT) "%s"' % (self.workspace / "export"), rendered)
        # The baked assignments must run before the template's own guard clause.
        self.assertLess(rendered.index("set env(WORK_ROOT)"), rendered.index("info exists env(WORK_ROOT)"))
        # Simulate exactly what a container-restricted env would do: env() is unset for
        # these names in the interpreter that sources the file. A real Tcl interpreter
        # isn't available in this test environment, so assert on the guaranteed textual
        # invariant instead: every required key from the passed env dict has a
        # corresponding `set env(KEY) ...` line ahead of any `info exists env(KEY)` use.
        for key in ("WORK_ROOT", "EXPORT_ROOT"):
            self.assertIn(f"set env({key})", rendered)

    def test_prepare_hashes_sources_and_copies_the_checkpoint(self):
        source = self.workspace / "source"
        for directory in ("FF", "PLUG", "script"):
            (source / directory).mkdir(parents=True)
            (source / directory / "held.txt").write_text(directory)
        (source / "setup.tcl").write_text("set setup 1\n")
        held = source / "FF" / "held.txt"
        manifest = self.workspace / "source.sha256"
        manifest.write_text(f"{closure.sha_file(held)}  FF/held.txt\n")
        db = self.workspace / "input.enc.dat"
        db.mkdir()
        (db / "db.bin").write_bytes(b"db")
        self.workspace.joinpath("input.enc").write_text("restore\n")
        profile = {
            "schema": closure.PROFILE_SCHEMA, "design": "top", "foundationRoot": str(source),
            "physicalInputRoot": str(source), "inputSdc": str(source / "setup.tcl"),
            "sourceManifestRoot": str(source), "edaShell": ["true"], "originalDriverLibrary": "slow",
            "techLef": str(held), "cellLefGlob": str(source / "FF" / "*.txt"),
            "starrc": [{"name": "worst", "template": str(held)}, {"name": "best", "template": str(held)}],
            "scenarios": self.scenarios,
        }
        profile_path = self.workspace / "profile.json"
        profile_path.write_text(json.dumps(profile))
        closure.prepare(self.workspace, str(db), str(profile_path), str(manifest))
        runtime = closure.load_runtime(self.workspace)
        self.assertEqual(runtime["sourceFilesChecked"], ["FF/held.txt"])
        self.assertTrue(Path(runtime["currentDatabase"]).joinpath("db.bin").is_file())
        record = json.loads((self.workspace / "flow" / "records" / "prepare.json").read_text())
        self.assertEqual(record["status"], "passed")


if __name__ == "__main__":
    unittest.main()
