"""CLI tests for Issue #64 Task 4: `capture-contribution` on a Task 3 expert session, and
`compose-facts` turning admitted sessions into a ranked recipe.

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

No EDA, no SSH: each slot's Operator outputs (`before.dump`, `after.dump`, `ops.jsonl`,
`gain.jsonl`, the XTop transcript and `eco_output/`) are synthesized by
`session_fixtures` in the shapes the toolkit writes.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import workspaces  # noqa: E402
import session_fixtures as sf  # noqa: E402

CLI_PATH = FLOW_DIR / "atcs_cli.py"
BEFORE = {"U1": "BUFX1", "U2": "BUFX1", "FILL1": "FILLER4"}
GAIN = (((-0.020, -0.100), (-0.020, -0.100)), ((-0.070, -1.200), (-0.050, -0.900)))


def _run(subcommand, workspace, *args):
    return subprocess.run([sys.executable, str(CLI_PATH), subcommand, str(workspace), *[str(a) for a in args]],
                          capture_output=True, text=True)


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


class SessionCaptureTest(unittest.TestCase):
    def setUp(self):
        self.workspace = Path(tempfile.mkdtemp(prefix="atcs-session-capture-"))
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.base_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute", "database": {"path": "db.enc", "sha256": "a" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None, "spef": {}, "sdc": [],
            "tools": {}, "scenarios": ["func_ss"], "parentId": None,
        })
        self.workers = {}

    def _seed(self, slot):
        raw = {
            "taskId": slot, "baseStateId": self.base_state["id"], "problem": "hold blockers",
            "targets": [f"func_ss|hold|{'U1' if slot == 'w01' else 'U2'}/D"],
            "targetPins": ["U1/D" if slot == "w01" else "U2/D"],
            "editDomain": {"instances": ["U1", "U2"], "nets": ["N1"], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [], "actions": ["size_cell"],
            "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
            "scope": {"commands": ["atcs_size_cell", "atcs_insert_buffer", "atcs_undo"],
                      "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
        }
        validated = workspaces.validate_work_package(raw, self.base_state, {"pgVerification": False})
        manifest = workspaces.prepare(validated, str(self.workspace), self.base_state)
        self.workers[slot] = {
            "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
            "namePrefix": manifest["namePrefix"], "opsLog": str(Path(manifest["root"]) / "ops.jsonl"),
            "workPackage": validated, "workspaceManifest": manifest,
        }
        _write_json(self.workspace / "state" / "workers.json", {"workers": self.workers, "requiredSlots": ["w01"]})
        return self.workspace / manifest["root"]

    def _capture(self, slot):
        result = _run("capture-contribution", self.workspace, slot)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state" / f"contribution-{slot}.json").read_text())

    def test_a_clean_session_is_captured_as_an_admissible_xtop_session(self):
        root = self._seed("w01")
        log = sf.SessionLog()
        inserted = log.insert("N1", ["U2/A"], ["DELAY1"], ["atcs_w01_r1_b1"], ["atcs_w01_r1_n1"], gain=GAIN)
        log.undo(inserted, gain=(GAIN[0], ((-0.070, -1.200), (-0.070, -1.200))))
        log.size("U1", "BUFX1", "BUFX2", gain=GAIN)
        sf.write_session(root, log, BEFORE, {**BEFORE, "U1": "BUFX2"})

        contribution = self._capture("w01")
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["kind"], "xtop-session")
        self.assertEqual([command["proc"] for command in contribution["commands"]], ["atcs_size_cell"])
        self.assertAlmostEqual(core.value_of(contribution["predicted"]["xtopHoldWns"]), -0.050)
        self.assertTrue((self.workspace / "contributions" / f"{contribution['id']}.json").is_file())

    def test_a_slot_with_tainted_json_is_refused(self):
        root = self._seed("w01")
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=GAIN)
        sf.write_session(root, log, BEFORE, {**BEFORE, "U1": "BUFX2"}, tainted={"reason": "x", "seq": 1})
        contribution = self._capture("w01")
        self.assertFalse(contribution["admissible"])
        self.assertIn("tainted", [refusal["code"] for refusal in contribution["refusals"]])

    def test_a_transcript_without_a_clean_taint_line_is_refused(self):
        root = self._seed("w01")
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=GAIN)
        sf.write_session(root, log, BEFORE, {**BEFORE, "U1": "BUFX2"}, transcript="some other output")
        contribution = self._capture("w01")
        self.assertEqual([refusal["code"] for refusal in contribution["refusals"]], ["tainted"])

    def test_any_non_clean_taint_line_in_any_transcript_is_refused(self):
        root = self._seed("w01")
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=GAIN)
        sf.write_session(root, log, BEFORE, {**BEFORE, "U1": "BUFX2"})
        # A later-sorting transcript says clean; an earlier one recorded a taint.
        (root / "xtop_log_0.txt").write_text("ATCS:taint:tainted:undo did not restore\n", encoding="utf-8")
        (root / "xtop_log_9.txt").write_text("ATCS:taint:clean\n", encoding="utf-8")
        contribution = self._capture("w01")
        self.assertEqual([refusal["code"] for refusal in contribution["refusals"]], ["tainted"])
        self.assertIn("undo did not restore", contribution["refusals"][0]["detail"])

    def test_a_real_uncertain_line_is_captured_as_a_tainted_refusal_not_a_crash(self):
        root = self._seed("w01")
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=GAIN)
        log.uncertain()
        sf.write_session(root, log, BEFORE, {**BEFORE, "U1": "BUFX2"},
                         transcript="ATCS:taint:tainted:atcs_size_cell: unexpected Tcl error")
        contribution = self._capture("w01")
        self.assertFalse(contribution["admissible"])
        self.assertEqual({refusal["code"] for refusal in contribution["refusals"]}, {"tainted"})

    def test_site_filler_patterns_come_from_the_bound_xtop_context(self):
        root = self._seed("w01")
        _write_json(self.workspace / "state" / "xtop-context.json", core.stamp("xtop-context", {
            "designStateId": self.base_state["id"], "removableFillers": ["FILLER*"]}))
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=GAIN)
        after = {"U1": "BUFX2", "U2": "BUFX1"}  # FILL1 removed by legalization
        sf.write_session(root, log, BEFORE, after)
        contribution = self._capture("w01")
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["fillerChanges"], ["FILL1"])

    def test_compose_facts_ranks_sessions_blocker_first_into_a_recipe(self):
        _write_json(self.workspace / "state" / "working-state.json", self.base_state)
        collected = []
        for slot, instance, gain in (("w01", "U1", 0.005), ("w02", "U2", 0.030)):
            root = self._seed(slot)
            log = sf.SessionLog()
            log.size(instance, "BUFX1", "BUFX2", gain=(GAIN[0], ((-0.070, -1.200), (-0.070 + gain, -1.100))))
            sf.write_session(root, log, BEFORE, {**BEFORE, instance: "BUFX2"})
            collected.append(self._capture(slot))
        _write_json(self.workspace / "state" / "contributions-collected.json",
                    {"contributions": collected, "pending": []})
        _write_json(self.workspace / "state" / "observation.json", {"checks": {
            "func_ss|hold|U1/D": {"slack": core.known(-0.070)},
            "func_ss|hold|U2/D": {"slack": core.known(-0.030)},
        }})

        result = _run("compose-facts", self.workspace, self.workspace / "no-plan-yet.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts = json.loads((self.workspace / "state" / "composition-facts.json").read_text())
        recipe = facts["recipe"]
        self.assertEqual(recipe["worstChecks"], ["func_ss|hold|U1/D"])
        self.assertEqual([entry["taskId"] for entry in recipe["sessions"]], ["w01", "w02"])
        self.assertEqual(facts["unresolvedCount"], 0)


if __name__ == "__main__":
    unittest.main()
