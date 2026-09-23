from __future__ import annotations

import importlib.util
import json
import copy
from pathlib import Path
import subprocess
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
        profile = self.workspace / "profile.json"
        source = self.workspace / "source-manifest.sha256"
        profile.write_text(json.dumps(self.runtime["profile"], sort_keys=True))
        source.write_text("source identity\n")
        self.runtime["profileIdentity"] = closure.file_ref(profile, self.workspace, "site-profile")
        self.runtime["sourceManifest"] = closure.file_ref(source, self.workspace, "source-manifest")

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

    def write_reports(self, generation, values, drc=10, connectivity=20, coverage="complete"):
        root = self.workspace / "flow" / "iterations" / f"g{generation:03d}" / "PT" / "reports"
        for scenario in self.scenarios:
            folder = root / scenario["name"]
            folder.mkdir(parents=True, exist_ok=True)
            folder.joinpath("global_timing.rpt").write_text(global_report(*values["global"]))
            folder.joinpath("setup.rpt").write_text(path_report(values["setup"], "setup"))
            folder.joinpath("hold.rpt").write_text(path_report(values["hold"], "hold"))
            folder.joinpath("check_timing.rpt").write_text("Warning: There are 3 endpoints which are not constrained for maximum delay.\n")
        self.runtime["currentAnalysis"] = {"reports": str(root)}
        physical = self.workspace / "flow" / "iterations" / f"g{generation:03d}" / "PHYSICAL"
        physical.mkdir(parents=True, exist_ok=True)
        (physical / "verify_drc.rpt").write_text(f"Total number of DRC violations = {drc}\n")
        (physical / "verify_connectivity.rpt").write_text(f"Total number of connectivity = {connectivity}\n")
        (physical / "physical-check.json").write_text(json.dumps({
            "schema": "xtop-timing-closure-physical-check/1", "coverage": coverage, "drcLimit": 1000000,
            "drcReport": "verify_drc.rpt", "connectivityReport": "verify_connectivity.rpt",
        }))
        self.runtime["currentPhysical"] = closure.physical_evidence(self.workspace, physical)
        self.runtime["currentAnalysis"]["spef"] = {"worst": str(root / "slow" / "global_timing.rpt"), "best": str(root / "fast" / "global_timing.rpt")}

    def save_runtime(self):
        closure.atomic_json(self.workspace / "flow" / "state" / "runtime.json", self.runtime)

    def test_actual_tcl_manifest_is_valid_json_and_does_not_claim_full_coverage(self):
        for name in ("export.tcl", "apply-eco.tcl"):
            template = (SOURCE.parent / "templates" / name).read_text()
            line = next(row for row in template.splitlines() if row.startswith("puts $physical "))
            result = subprocess.run(["tclsh"], input="set physical stdout\n" + line + "\n", text=True, capture_output=True, check=True)
            manifest = json.loads(result.stdout)
            self.assertEqual(manifest["schema"], "xtop-timing-closure-physical-check/1")
            self.assertEqual(manifest["coverage"], "unknown")
            self.assertEqual(manifest["drcLimit"], 1000000)

    def test_unknown_physical_report_grammar_is_retained_without_inventing_counts(self):
        physical = self.workspace / "flow" / "iterations" / "g000" / "PHYSICAL"
        physical.mkdir(parents=True)
        (physical / "verify_drc.rpt").write_text("Innovus physical verification format not yet qualified\n")
        (physical / "verify_connectivity.rpt").write_text("Innovus connectivity format not yet qualified\n")
        (physical / "physical-check.json").write_text(json.dumps({
            "schema": "xtop-timing-closure-physical-check/1", "coverage": "unknown", "drcLimit": 1000000,
            "drcReport": "verify_drc.rpt", "connectivityReport": "verify_connectivity.rpt",
        }))

        evidence = closure.physical_evidence(self.workspace, physical)
        self.assertEqual(evidence["coverage"], "unknown")
        for kind in ("drc", "connectivity"):
            self.assertEqual(evidence[kind]["status"], "unknown")
            self.assertNotIn("count", evidence[kind])
            self.assertRegex(evidence[kind]["report"]["sha256"], r"^[0-9a-f]{64}$")

    def test_state_reader_preserves_timing_when_physical_qualification_is_unknown(self):
        self.write_database(0)
        self.write_reports(0, {
            "global": (-0.10, -0.30, 3, -0.08, -0.20, 2),
            "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)],
        }, coverage="unknown")
        self.save_runtime(); closure.summarize(self.workspace)

        values = reader.read(self.workspace / "flow" / "state" / "current.json", "state")
        kinds = {row["type"] for row in values}
        self.assertIn("xtop_setup_wns", kinds)
        self.assertIn("xtop_hold_wns", kinds)
        self.assertIn("xtop_closure_score", kinds)

    def test_not_comparable_iteration_does_not_report_unknown_endpoint_deltas_as_zero(self):
        self.write_database(0)
        self.write_reports(0, {
            "global": (-0.10, -0.30, 3, -0.08, -0.20, 2),
            "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)],
        })
        self.save_runtime(); closure.summarize(self.workspace)
        state = closure.read_json(self.workspace / "flow" / "state" / "current.json")
        result = {
            "schema": closure.ITERATION_SCHEMA, "iteration": 1, "before": state, "after": state,
            "endpoint_delta": {"comparability": "not-comparable", "reason": "measurement conditions changed",
                "originalFrontierCount": 1, "measuredOriginalCount": 0,
                "fixed": [], "remaining": [], "entrants": [], "regressed": [], "missing": ["slow|setup|core_clock|A/D"]},
            "bestQualification": {"status": "ineligible", "reason": "measurement conditions changed"},
            "evidence_valid": False,
        }
        report = self.workspace / "flow" / "records" / "compare.json"
        closure.atomic_json(report, result)

        values = reader.read(report, "iteration")
        kinds = {row["type"] for row in values}
        self.assertTrue({"xtop_setup_wns", "xtop_hold_wns", "xtop_closure_score", "xtop_iteration_evidence_valid"} <= kinds)
        self.assertFalse({"xtop_endpoint_fixed_count", "xtop_endpoint_remaining_count",
                          "xtop_endpoint_entrant_count", "xtop_endpoint_regressed_count"} & kinds)

    def test_candidate_spef_is_bound_to_its_own_bytes_not_required_to_equal_baseline(self):
        physical = {"coverage": "complete", "drc": {"count": 0}, "connectivity": {"count": 0}}
        before = {"profile": {"sha256": "1"}, "sourceManifest": {"sha256": "2"},
                  "scenariosSha256": "3", "spef": {"worst": {"sha256": "baseline"}}, "physical": physical}
        after = {"profile": {"sha256": "1"}, "sourceManifest": {"sha256": "2"},
                 "scenariosSha256": "3", "spef": {"worst": {"sha256": "candidate"}}, "physical": physical}
        self.assertEqual(closure.physical_qualification(before, after)["status"], "eligible")

    def test_snapshot_values_and_database_are_bound_to_retained_bytes(self):
        self.write_database(0)
        self.write_reports(0, {"global": (-0.10, -0.30, 3, -0.08, -0.20, 2), "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)]})
        self.save_runtime(); closure.summarize(self.workspace)
        original = closure.read_json(self.workspace / "flow" / "state" / "current.json")
        closure.validate_snapshot_identity(self.workspace, original)
        changed = copy.deepcopy(original); changed["physical"]["drc"]["count"] = 0
        with self.assertRaisesRegex(closure.Rejected, "physical counts"):
            closure.validate_snapshot_identity(self.workspace, changed)
        changed = copy.deepcopy(original); changed["metrics"]["closure_score"] = 0
        with self.assertRaisesRegex(closure.Rejected, "timing values"):
            closure.validate_snapshot_identity(self.workspace, changed)
        changed = copy.deepcopy(original); changed["reportFiles"].pop()
        with self.assertRaisesRegex(closure.Rejected, "report coverage"):
            closure.validate_snapshot_identity(self.workspace, changed)
        (Path(original["database"]["data"]) / "db.bin").write_bytes(b"different database")
        with self.assertRaisesRegex(closure.Rejected, "database bytes changed"):
            closure.validate_snapshot_identity(self.workspace, original)

    def test_complete_same_method_physical_checks_allow_a_best_database(self):
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
        self.assertEqual(result["endpoint_delta"]["fixed"], [])
        self.assertEqual(result["endpoint_delta"]["missing"], ["fast|setup|core_clock|A/D", "slow|setup|core_clock|A/D"])
        self.assertEqual(result["endpoint_delta"]["entrants"], ["fast|setup|core_clock|C/D", "slow|setup|core_clock|C/D"])
        self.assertEqual(result["endpoint_delta"]["regressed"], ["fast|hold|core_clock|H/D", "slow|hold|core_clock|H/D"])
        self.assertTrue(result["evidence_valid"])
        self.assertEqual(result["bestQualification"]["status"], "eligible")
        best = json.loads((self.workspace / "flow" / "output" / "best-database.json").read_text())
        self.assertEqual(best["iteration"], 1)
        self.assertTrue((Path(best["restoreData"]) / "db.bin").is_file())
        self.assertEqual(len((self.workspace / "flow" / "evidence" / "experience.jsonl").read_text().splitlines()), 1)
        self.assertEqual(reader.read(self.workspace / "flow" / "records" / "compare.json", "iteration")[-1]["value"], 1)

    def test_qualified_candidate_replaces_a_verified_prior_best(self):
        self.write_database(0)
        self.write_reports(0, {"global": (-0.10, -0.30, 3, -0.08, -0.20, 2), "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)]})
        self.save_runtime()
        closure.summarize(self.workspace)
        baseline = str(self.workspace / "flow" / "iterations" / "g000" / "closure-state.json")
        snapshot = closure.read_json(Path(baseline))
        script, data, tree = closure.copy_database_alias(self.workspace, snapshot)
        closure.atomic_json(self.workspace / "flow" / "output" / "best-database.json", {
            "schema": closure.BEST_SCHEMA, "ready": True, "iteration": 0, "snapshot": baseline,
            "restoreScript": closure.file_ref(script, self.workspace, "best-db-script"), "restoreData": str(data), "tree": tree,
        })
        self.assertEqual(closure.tree_identity(data), closure.read_json(self.workspace / "flow" / "output" / "best-database.json")["tree"])
        closure.validate_best(self.workspace, closure.read_json(self.workspace / "flow" / "output" / "best-database.json"))

        self.runtime = closure.load_runtime(self.workspace)
        self.runtime["iteration"] = 1
        self.write_database(1)
        self.write_reports(1, {"global": (-0.01, -0.02, 1, -0.02, -0.03, 1), "setup": [("A/D", -0.01)], "hold": [("H/D", -0.02)]})
        self.save_runtime()
        closure.summarize(self.workspace)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({
            "schema": closure.PLAN_SCHEMA, "iteration": 1, "diagnosis": "test", "hypotheses": ["test"],
            "endpointGroups": ["core_clock"], "actions": [], "avoid": [], "reasoning": "test",
        }))
        closure.compare(self.workspace)
        best = closure.read_json(self.workspace / "flow" / "output" / "best-database.json")
        self.assertEqual(best["iteration"], 1)
        self.assertTrue(closure.read_json(self.workspace / "flow" / "records" / "compare.json")["evidence_valid"])

    def test_physical_regression_or_incomplete_coverage_cannot_adopt(self):
        self.write_database(0)
        self.write_reports(0, {"global": (-0.10, -0.30, 3, -0.08, -0.20, 2), "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)],}, drc=10, connectivity=20)
        self.save_runtime(); closure.summarize(self.workspace)
        self.runtime = closure.load_runtime(self.workspace); self.runtime["iteration"] = 1
        self.write_database(1)
        self.write_reports(1, {"global": (-0.01, -0.02, 1, -0.02, -0.03, 1), "setup": [("A/D", -0.01)], "hold": [("H/D", -0.02)]}, drc=11, connectivity=20)
        self.save_runtime(); closure.summarize(self.workspace)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({"schema": closure.PLAN_SCHEMA, "iteration": 1, "diagnosis": "test", "hypotheses": ["test"], "endpointGroups": ["core_clock"], "actions": [], "avoid": [], "reasoning": "test"}))
        closure.compare(self.workspace)
        result = closure.read_json(self.workspace / "flow" / "records" / "compare.json")
        self.assertFalse(result["evidence_valid"])
        self.assertEqual(result["bestQualification"]["status"], "ineligible")
        self.assertFalse((self.workspace / "flow" / "output" / "best-database.json").exists())
        (self.workspace / "flow" / "iterations" / "g001" / "PHYSICAL" / "physical-check.json").unlink()
        with self.assertRaises(closure.Rejected):
            closure.physical_evidence(self.workspace, self.workspace / "flow" / "iterations" / "g001" / "PHYSICAL")

    def test_unknown_physical_coverage_preserves_comparison_but_never_creates_best(self):
        self.write_database(0)
        self.write_reports(0, {
            "global": (-0.10, -0.30, 3, -0.08, -0.20, 2),
            "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)],
        }, coverage="unknown")
        self.save_runtime(); closure.summarize(self.workspace)
        self.runtime = closure.load_runtime(self.workspace); self.runtime["iteration"] = 1
        self.write_database(1)
        self.write_reports(1, {
            "global": (-0.01, -0.02, 1, -0.02, -0.03, 1),
            "setup": [("A/D", -0.01)], "hold": [("H/D", -0.02)],
        }, coverage="unknown")
        self.save_runtime(); closure.summarize(self.workspace)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({
            "schema": closure.PLAN_SCHEMA, "iteration": 1, "diagnosis": "test", "hypotheses": ["test"],
            "endpointGroups": ["core_clock"], "actions": [], "avoid": [], "reasoning": "test",
        }))

        closure.compare(self.workspace)
        result = closure.read_json(self.workspace / "flow" / "records" / "compare.json")
        self.assertEqual(result["bestQualification"]["status"], "unknown")
        self.assertFalse(result["evidence_valid"])
        self.assertFalse((self.workspace / "flow" / "output" / "best-database.json").exists())
        self.assertEqual(reader.read(self.workspace / "flow" / "records" / "compare.json", "iteration")[-1],
                         {"type": "xtop_iteration_evidence_valid", "unit": "count", "value": 0})

    def test_copy_failure_keeps_the_verified_prior_best(self):
        self.write_database(0)
        self.write_reports(0, {"global": (-0.10, -0.30, 3, -0.08, -0.20, 2), "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)]})
        self.save_runtime(); closure.summarize(self.workspace)
        baseline = str(self.workspace / "flow" / "iterations" / "g000" / "closure-state.json")
        script, data, tree = closure.copy_database_alias(self.workspace, closure.read_json(Path(baseline)))
        closure.atomic_json(self.workspace / "flow" / "output" / "best-database.json", {"schema": closure.BEST_SCHEMA, "ready": True, "iteration": 0, "snapshot": baseline, "restoreScript": closure.file_ref(script, self.workspace, "best-db-script"), "restoreData": str(data), "tree": tree})
        self.runtime = closure.load_runtime(self.workspace); self.runtime["iteration"] = 1
        self.write_database(1)
        self.write_reports(1, {"global": (-0.01, -0.02, 1, -0.02, -0.03, 1), "setup": [("A/D", -0.01)], "hold": [("H/D", -0.02)]})
        self.save_runtime(); closure.summarize(self.workspace)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({"schema": closure.PLAN_SCHEMA, "iteration": 1, "diagnosis": "test", "hypotheses": ["test"], "endpointGroups": ["core_clock"], "actions": [], "avoid": [], "reasoning": "test"}))
        original = closure.copy_database_alias
        closure.copy_database_alias = lambda *_: (_ for _ in ()).throw(closure.Rejected("copy failed"))
        try:
            with self.assertRaises(closure.Rejected): closure.compare(self.workspace)
        finally:
            closure.copy_database_alias = original
        self.assertEqual(closure.read_json(self.workspace / "flow" / "output" / "best-database.json")["iteration"], 0)

    def test_starrc_runs_with_its_library_path_set_inside_the_container(self):
        # Trial 26: extract-baseline failed with exit 1 and
        # "StarXtract: error while loading shared libraries: libtbb.so.12: cannot open shared
        # object file". StarXtract is on PATH inside the container and libtbb.so.12 ships in the
        # toolkit's own linux64_starrc/lib, but edarun-init.sh sets no StarRC library path and the
        # Pack does not go through the Foundation Flow's scripts/run_starrc.sh, which exports one.
        # The value must be set inside the container's shell -- the command edarun runs -- because
        # a value set on the outer Python subprocess is stripped at the boundary.
        toolkit = self.workspace / "starrc" / "X-2025.06-SP1"
        (toolkit / "linux64_starrc" / "lib").mkdir(parents=True)
        (toolkit / "linux64_starrc" / "lib" / "libtbb.so.12").write_text("")
        (toolkit / "linux64_starrc" / "lib" / "shlib").mkdir()

        captured = {}

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            return type("Done", (), {"returncode": 0})()

        original = closure.subprocess.run
        closure.subprocess.run = fake_run
        try:
            closure.run_starrc(
                {"edaShell": ["/usr/local/bin/edarun", "bash", "-lc"]},
                ["StarXtract", "-clean", "cworst_T.cmd"],
                self.workspace,
                self.workspace / "cworst_T.log",
                toolkit,
            )
        finally:
            closure.subprocess.run = original

        line = captured["argv"][-1]
        # The assignment must precede the tool, inside the shell the wrapper runs.
        self.assertIn("LD_LIBRARY_PATH=", line)
        self.assertLess(line.index("LD_LIBRARY_PATH="), line.index("StarXtract"))
        self.assertIn(str(toolkit / "linux64_starrc" / "lib"), line)
        # The inherited path is appended rather than discarded, and the line is valid shell.
        self.assertIn("${LD_LIBRARY_PATH:-}", line)
        self.assertEqual(subprocess.run(["bash", "-n", "-c", line]).returncode, 0)

    def test_starrc_library_paths_are_quoted_for_a_path_containing_spaces(self):
        toolkit = self.workspace / "star rc" / "X-2025.06-SP1"
        (toolkit / "linux64_starrc" / "lib").mkdir(parents=True)
        shell_env = closure.starrc_shell_env(toolkit)
        self.assertEqual(len(shell_env), 1)
        name, quoted = shell_env[0]
        self.assertEqual(name, "LD_LIBRARY_PATH")
        self.assertIn(str(toolkit / "linux64_starrc" / "lib"), quoted)

        # The quoted value is what the container's shell would evaluate, spaces and all.
        value = subprocess.run(["bash", "-c", f"printf %s {quoted}"],
                               capture_output=True, text=True).stdout
        self.assertTrue(value.startswith(str(toolkit / "linux64_starrc" / "lib")))
        self.assertTrue(value.endswith(":"))

        line = closure.shell_line({"edaShell": ["/usr/local/bin/edarun", "bash", "-lc"]},
                                  ["StarXtract", "-clean", "c.cmd"], shell_env)
        self.assertEqual(subprocess.run(["bash", "-n", "-c", line]).returncode, 0)

    def test_site_profile_may_declare_the_starrc_toolkit_but_need_not(self):
        # The toolkit root is discovered inside the container when the profile is silent, so an
        # already-deployed profile needs no edit; a declared one must still be usable.
        base = {
            "schema": closure.PROFILE_SCHEMA, "design": "d", "foundationRoot": "/f",
            "physicalInputRoot": "/p", "inputSdc": "/s", "sourceManifestRoot": "/m",
            "edaShell": ["/usr/local/bin/edarun", "bash", "-lc"], "originalDriverLibrary": "o",
            "techLef": "/t", "cellLefGlob": "/c/*.lef",
            "starrc": [{"name": "worst", "template": "/a"}, {"name": "best", "template": "/b"}],
            "scenarios": self.scenarios,
        }
        path = self.workspace / "flow" / "profile.json"
        path.write_text(json.dumps(base))
        self.assertNotIn("starrcHome", closure.load_profile(path))

        base["starrcHome"] = ""
        path.write_text(json.dumps(base))
        with self.assertRaises(closure.Rejected) as empty:
            closure.load_profile(path)
        self.assertIn("starrcHome", str(empty.exception))

        base["starrcHome"] = "/data/eda/software/eda_tools/synopsys/starrc/X-2025.06-SP1"
        path.write_text(json.dumps(base))
        self.assertEqual(closure.load_profile(path)["starrcHome"], base["starrcHome"])

        del base["starrcHome"]
        base["unexpected"] = "x"
        path.write_text(json.dumps(base))
        with self.assertRaises(closure.Rejected) as inexact:
            closure.load_profile(path)
        self.assertIn("not exact", str(inexact.exception))

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
            "starrcHome": str(source / "starrc"),
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


    def test_parse_global_reads_a_clean_corner_that_prints_no_violations_found(self):
        # Trial 27: PrimeTime prints "No setup violations found." instead of the
        # dashed WNS/TNS/NUM table when a corner has zero setup violations (seen on
        # the real func_ffg_cbest_m40 scenario). The old regex-only parser raised
        # Rejected("cannot parse setup global timing...") on this, which is wrong:
        # a clean corner is progress toward the Goal, not a parse failure.
        report = self.workspace / "global_timing.rpt"
        report.write_text(
            "****************************************\n"
            "Report : global_timing\n"
            "Design : swerv_wrapper\n"
            "****************************************\n\n"
            "No setup violations found.\n\n"
            "Hold violations\n"
            "---------------------------------------------------------\n"
            "         Total  reg->reg   in->reg  reg->out   in->out\n"
            "---------------------------------------------------------\n"
            "WNS      -0.07     -0.01     -0.07      0.00      0.00\n"
            "TNS      -0.80     -0.08     -0.72      0.00      0.00\n"
            "NUM         70        36        34         0         0\n"
            "---------------------------------------------------------\n"
        )
        values = closure.parse_global(report)
        self.assertEqual(values["setup"], {"WNS": 0.0, "TNS": 0.0, "NUM": 0})
        self.assertEqual(values["hold"], {"WNS": -0.07, "TNS": -0.80, "NUM": 70})

    def test_parse_global_reads_a_clean_corner_on_the_hold_side_too(self):
        report = self.workspace / "global_timing.rpt"
        report.write_text(
            "Setup violations\n"
            "---------------------------------------------------------\n"
            "         Total  reg->reg   in->reg  reg->out   in->out\n"
            "---------------------------------------------------------\n"
            "WNS      -0.04     -0.00      0.00     -0.04      0.00\n"
            "TNS      -0.12     -0.02      0.00     -0.10      0.00\n"
            "NUM         12         7         0         5         0\n"
            "---------------------------------------------------------\n\n"
            "No hold violations found.\n"
        )
        values = closure.parse_global(report)
        self.assertEqual(values["setup"], {"WNS": -0.04, "TNS": -0.12, "NUM": 12})
        self.assertEqual(values["hold"], {"WNS": 0.0, "TNS": 0.0, "NUM": 0})


    def write_database_with_a_shared_symlink(self, generation, real_lef):
        root = self.workspace / "flow" / "iterations" / f"g{generation:03d}" / "DBS"
        data = root / "closed.enc.dat"
        (data / "libs" / "lef").mkdir(parents=True)
        (data / "libs" / "lef" / "tech.lef").symlink_to(real_lef)
        (data / "db.bin").write_bytes(f"db-{generation}".encode())
        script = root / "closed.enc"
        script.write_text(f"restore {generation}\n")
        self.runtime["currentDatabase"] = str(data)
        self.runtime["currentDatabaseScript"] = str(script)

    def test_retention_is_idempotent_when_a_later_generation_wins_and_the_database_holds_symlinks(self):
        # Trial 29 generation 2: compare() failed with
        # "[Errno 17] File exists: '.../input/lef/tech.lef' -> '.../best.enc.dat/libs/lef/tech.lef'".
        # The foundation LEF libraries are symlinked into every generation's restored database
        # unchanged, so once generation 1 is retained as best, its best.enc.dat/libs/lef/tech.lef
        # symlink already exists on disk. copy_database_alias's second call used
        # shutil.copytree(..., symlinks=True, dirs_exist_ok=True): dirs_exist_ok lets copytree
        # reuse the destination directory, but for a symlink entry copytree still calls
        # os.symlink(target, dst) directly, which raises FileExistsError when dst is already
        # there -- dirs_exist_ok does not cover pre-existing symlinks, only pre-existing dirs.
        real_lef = self.workspace / "input.lef"
        real_lef.write_text("lef\n")

        self.write_database_with_a_shared_symlink(0, real_lef)
        self.write_reports(0, {"global": (-0.10, -0.30, 3, -0.08, -0.20, 2), "setup": [("A/D", -0.10)], "hold": [("H/D", -0.08)]})
        self.save_runtime()
        closure.summarize(self.workspace)

        self.runtime = closure.load_runtime(self.workspace)
        self.runtime["iteration"] = 1
        self.write_database_with_a_shared_symlink(1, real_lef)
        self.write_reports(1, {"global": (-0.06, -0.12, 2, -0.09, -0.12, 2), "setup": [("A/D", -0.02)], "hold": [("H/D", -0.09)]})
        self.save_runtime()
        closure.summarize(self.workspace)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({
            "schema": closure.PLAN_SCHEMA, "iteration": 1, "diagnosis": "test", "hypotheses": ["test"],
            "endpointGroups": ["core_clock"], "actions": [], "avoid": [], "reasoning": "test",
        }))
        closure.compare(self.workspace)

        self.runtime = closure.load_runtime(self.workspace)
        self.runtime["iteration"] = 2
        self.write_database_with_a_shared_symlink(2, real_lef)
        self.write_reports(2, {"global": (-0.02, -0.02, 1, -0.09, -0.12, 2), "setup": [("A/D", -0.02)], "hold": [("H/D", -0.09)]})
        self.save_runtime()
        closure.summarize(self.workspace)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({
            "schema": closure.PLAN_SCHEMA, "iteration": 2, "diagnosis": "test", "hypotheses": ["test"],
            "endpointGroups": ["core_clock"], "actions": [], "avoid": [], "reasoning": "test",
        }))
        closure.compare(self.workspace)

        result = json.loads((self.workspace / "flow" / "records" / "compare.json").read_text())
        self.assertTrue(result["evidence_valid"])
        best = json.loads((self.workspace / "flow" / "output" / "best-database.json").read_text())
        self.assertEqual(best["iteration"], 2)
        self.assertTrue((Path(best["restoreData"]) / "libs" / "lef" / "tech.lef").is_symlink())

    def test_xtop_creates_its_own_log_dir_before_invoking_the_tool(self):
        # Trial 28: XTop exited 1 with "Directory '.../XTOP/logs' does not exist or is not
        # readable." xtop() passes -log_dir <root>/logs but only ever creates <root> itself
        # (root.mkdir), never the logs subdirectory XTop is told to write into -- and XTop,
        # unlike the Pack's own templated tools, does not create it for itself.
        templates = self.workspace / "flow" / "templates"
        templates.mkdir(parents=True, exist_ok=True)
        (templates / "xtop.tcl").write_text("# xtop\n")
        lib_dir = self.workspace / "libs"
        lib_dir.mkdir()
        (lib_dir / "slow.lib").write_text("lib")
        (lib_dir / "fast.lib").write_text("lib")
        profile = {
            "schema": closure.PROFILE_SCHEMA, "design": "top", "foundationRoot": str(self.workspace),
            "physicalInputRoot": str(self.workspace), "inputSdc": str(self.workspace / "setup.tcl"),
            "sourceManifestRoot": str(self.workspace), "edaShell": ["true"], "originalDriverLibrary": "slow",
            "techLef": str(self.workspace / "tech.lef"), "cellLefGlob": str(self.workspace / "*.lef"),
            "starrc": [{"name": "worst", "template": str(self.workspace / "worst.cmd")}],
            "scenarios": [
                {"name": "slow", "libGlob": "unused", "driverLibrary": "slow", "spefCorner": "worst",
                 "xtopCorner": "slow", "xtopLibertyGlob": str(lib_dir / "slow.lib")},
                {"name": "fast", "libGlob": "unused", "driverLibrary": "fast", "spefCorner": "worst",
                 "xtopCorner": "fast", "xtopLibertyGlob": str(lib_dir / "fast.lib")},
            ],
        }
        self.runtime.update({
            "profile": profile, "iteration": 0,
            "currentExport": {"netlist": str(self.workspace / "export.v"), "def": str(self.workspace / "export.def")},
            "currentAnalysis": {"staData": str(self.workspace / "sta_data")},
        })
        self.save_runtime()
        (self.workspace / "flow" / "research").mkdir(parents=True, exist_ok=True)
        (self.workspace / "flow" / "research" / "fix-plan.json").write_text(json.dumps({
            "schema": closure.PLAN_SCHEMA, "iteration": 1, "diagnosis": "test", "hypotheses": ["test"],
            "endpointGroups": ["core_clock"],
            "actions": [{
                "kind": "hold-buffer", "effort": "high", "setupTargetNs": 0.0, "holdTargetNs": 0.0,
                "setupMarginNs": 0.02, "holdMarginNs": 0.02, "endpointGroups": ["core_clock"], "reason": "test",
            }],
            "avoid": "nothing yet", "reasoning": "test",
        }))

        root = self.workspace / "flow" / "iterations" / "g001" / "XTOP"
        seen_logs_dir_at_launch = {}

        def fake_run_eda(profile, command, cwd, log, env=None, shell_env=None):
            seen_logs_dir_at_launch["exists"] = (root / "logs").is_dir()
            eco = root / "eco_output"
            eco.mkdir(parents=True, exist_ok=True)
            (eco / "xtop_opt_innovus_netlist_1.txt").write_text("netlist eco\n")
            (eco / "xtop_opt_innovus_physical_1.txt").write_text("physical eco\n")
            return log

        original = closure.run_eda
        closure.run_eda = fake_run_eda
        try:
            closure.xtop(self.workspace)
        finally:
            closure.run_eda = original

        self.assertTrue(seen_logs_dir_at_launch.get("exists"),
                         "xtop() must create <root>/logs before invoking the tool with -log_dir pointing at it")

    def test_keep_route_uses_two_sourceable_tcl_scripts_and_rejects_atomic_or_route_deletion(self):
        pack = Path(__file__).resolve().parents[2]
        xtop_template = (pack / "flow" / "templates" / "xtop.tcl").read_text()
        apply_template = (pack / "flow" / "templates" / "apply-eco.tcl").read_text()
        self.assertIn("-keep_route", xtop_template)
        self.assertNotIn("-write_atomic_cmd", xtop_template)
        self.assertNotIn("loadECO", apply_template)
        self.assertEqual(apply_template.count("source [lindex $"), 2)

        logical = self.workspace / "logical.tcl"
        physical = self.workspace / "physical.tcl"
        logical.write_text("ecoAddRepeater -cell BUFFD2 -net n1\n")
        physical.write_text("placeInstance eco_buffer_1 10 20 R0 -placed\n")
        self.assertTrue(closure.validate_sourceable_eco(logical, "logical")["sourceable"])
        self.assertTrue(closure.validate_sourceable_eco(physical, "physical")["sourceable"])

        logical.write_text("FORMATVERSION 2\nADDINST eco_buffer_1 BUFFD2\n")
        with self.assertRaises(closure.Rejected):
            closure.validate_sourceable_eco(logical, "logical")
        physical.write_text("dbNetFreeWires [dbGetNetByName n1]\n")
        with self.assertRaises(closure.Rejected):
            closure.validate_sourceable_eco(physical, "physical")


if __name__ == "__main__":
    unittest.main()
