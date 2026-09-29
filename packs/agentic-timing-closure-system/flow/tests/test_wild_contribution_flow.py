"""The worker/aggregation principle (FABRIC G45, 2026-09-29), end to end without EDA.

The parallel worker stage is exploratory: a "wild" session, domain-clean but trialling a move that
hurt its target (undone) and keeping a master the plan never named (one of another function), is
captured, composed and replayed without an upstream refusal. Quality is guaranteed downstream:
composition states every session, its predicted gain and every conflict; the replay records a
session that did not reproduce (a skipped command, a `replayMismatch` warning) instead of hiding
it; the arm is chosen on XTop's prediction and only refreshed PrimeTime judges convergence. `flow/`
is unchanged (the wrapper's pinned digest): this file proves what it already does.

Known limit (flow code, not changed here): `capture-contribution`'s value gates
(`contributions._session_value`) still refuse a session whose kept commands show no predicted gain
on a target check or break a target or opposite check in some required scenario. A session that
keeps a move XTop measured as harmful is refused at capture, before composition.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_wild_contribution_flow.py -v
"""
from __future__ import annotations

import json
import shutil
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import workspaces  # noqa: E402
import session_fixtures as sf  # noqa: E402
from test_cli_state import _run, _tmp, _write_json, _write_xtop_context, _xtop_site_config  # noqa: E402

SCENARIO = sf.SCENARIO  # the scenario the session fixtures' gain readings name
BEFORE = {"U1": "BUFX1", "U2": "BUFX1", "U3": "BUFX1"}
WILD = "WILDFUNCX2"  # a master of another function the plan never named; XTop's session accepted it
TRIAL = "WILDTRYX4"
HURTS = (((-0.020, -0.100), (-0.020, -0.100)), ((-0.070, -1.200), (-0.090, -1.500)))
HELPS = (((-0.020, -0.100), (-0.020, -0.100)), ((-0.070, -1.200), (-0.040, -0.800)))


class WildContributionFlowTest(unittest.TestCase):
    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.base_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute",
            "database": {"path": "db.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None,
            "spef": {}, "sdc": [], "tools": {}, "scenarios": [SCENARIO], "parentId": None,
        })
        self.base_state_path = self.workspace / "state" / "working-state.json"
        _write_json(self.base_state_path, self.base_state)
        _write_xtop_context(self.workspace, self.base_state["id"], (SCENARIO,))
        self.workers = {}

    def seed(self, slot, instance, domain):
        raw = {
            "taskId": slot, "baseStateId": self.base_state["id"], "problem": f"hold blocker at {instance}/D",
            "targets": [f"{SCENARIO}|hold|{instance}/D"], "targetPins": [f"{instance}/D"],
            "editDomain": {"instances": list(domain), "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [], "actions": ["size_cell"],
            "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
            "scope": {"commands": list(workspaces.MUTATE_COMMANDS), "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
        }
        validated = workspaces.validate_work_package(raw, self.base_state, {"pgVerification": False})
        manifest = workspaces.prepare(validated, str(self.workspace), self.base_state)
        self.workers[slot] = {
            "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
            "namePrefix": manifest["namePrefix"], "opsLog": str(Path(manifest["root"]) / "ops.jsonl"),
            "workPackage": validated, "workspaceManifest": manifest,
        }
        _write_json(self.workspace / "state" / "workers.json",
                    {"workers": self.workers, "requiredSlots": sorted(self.workers)})
        return self.workspace / manifest["root"]

    def capture(self, slot):
        result = _run("capture-contribution", self.workspace, slot)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state" / f"contribution-{slot}.json").read_text())

    def sessions(self):
        """w01 is wild: a trial that hurt its target (undone), then a master of another function the plan
        never named, kept because XTop measured a gain. w02 is plain. Both stay in their own domains."""
        root = self.seed("w01", "U1", ["U1"])
        log = sf.SessionLog()
        trial = log.size("U1", "BUFX1", TRIAL, gain=HURTS)
        log.undo(trial, gain=(HURTS[0], (HURTS[1][0], HURTS[1][0])))
        log.size("U1", "BUFX1", WILD, gain=HELPS)
        sf.write_session(root, log, BEFORE, {**BEFORE, "U1": WILD})
        wild = self.capture("w01")
        root = self.seed("w02", "U2", ["U2"])
        log = sf.SessionLog()
        log.size("U2", "BUFX1", "BUFX2", gain=HELPS)
        sf.write_session(root, log, BEFORE, {**BEFORE, "U2": "BUFX2"})
        plain = self.capture("w02")
        _write_json(self.workspace / "state" / "observation.json", {"checks": {
            f"{SCENARIO}|hold|U1/D": {"slack": core.known(-0.070)},
            f"{SCENARIO}|hold|U2/D": {"slack": core.known(-0.050)},
        }})
        return wild, plain

    def compose(self, contributions):
        _write_json(self.workspace / "state" / "contributions-collected.json",
                    {"contributions": contributions, "pending": []})
        result = _run("compose-facts", self.workspace, self.workspace / "state" / "no-integration-plan.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state" / "composition-facts.json").read_text())

    def test_a_wild_domain_clean_session_is_captured_and_composed_without_a_refusal(self):
        wild, plain = self.sessions()
        for contribution in (wild, plain):
            self.assertTrue(contribution["admissible"], contribution["refusals"])
            self.assertEqual(contribution["kind"], "xtop-session")
            self.assertEqual(contribution["refusals"], [])
        self.assertEqual(wild["delta"]["mastersChanged"], {"U1": ["BUFX1", WILD]})
        facts = self.compose([wild, plain])
        self.assertEqual(sorted(facts["considered"]), sorted([wild["id"], plain["id"]]))
        sessions = {entry["taskId"]: entry for entry in facts["recipe"]["sessions"]}
        self.assertEqual(sorted(sessions), ["w01", "w02"], facts["recipe"])
        self.assertEqual([command["args"]["toMaster"] for command in sessions["w01"]["commands"]], [WILD])
        # The predicted-gain facts of both sessions reach the facts; the wild one is not dropped.
        self.assertIsNotNone(wild["predicted"].get("xtopHoldWns"))
        for slot in ("w01", "w02"):
            self.assertGreater(sessions[slot]["value"], 0, sessions[slot])
            self.assertIn("tnsGain", sessions[slot])
        self.assertEqual([command["args"]["toMaster"] for command in wild["commands"]], [WILD], "the undone trial is not kept")
        self.assertEqual(facts["unresolvedCount"], 0)

    def test_every_conflict_between_two_sessions_is_surfaced(self):
        wild, plain = self.sessions()
        root = self.seed("w03", "U1", ["U1"])
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX4", gain=HELPS)
        sf.write_session(root, log, BEFORE, {**BEFORE, "U1": "BUFX4"})
        rival = self.capture("w03")
        self.assertTrue(rival["admissible"], rival["refusals"])
        facts = self.compose([wild, plain, rival])
        # Sessions never refuse the batch: the lower-ranked session's command on the shared instance is
        # marked skipped, naming the session that holds it; every session stays in the recipe.
        sessions = {entry["taskId"]: entry for entry in facts["recipe"]["sessions"]}
        self.assertEqual(sorted(sessions), ["w01", "w02", "w03"])
        on_u1 = [(slot, command) for slot in ("w01", "w03") for command in sessions[slot]["commands"]
                 if "U1" in command["instances"]]
        skipped = [(slot, command) for slot, command in on_u1 if command["skip"] == "shared-instance"]
        self.assertEqual(len(skipped), 1, on_u1)
        holder = "w03" if skipped[0][0] == "w01" else "w01"
        self.assertEqual(skipped[0][1]["sharedWith"][0]["contribution"], sessions[holder]["contribution"])
        self.assertEqual(facts["recipe"]["skipCount"], 1)

    def site(self):
        wrapper = self.workspace / "wrapper.sh"
        wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        wrapper.chmod(0o755)
        path = self.workspace / "site-profile.json"
        _write_json(path, {"edaShell": [str(wrapper)], "design": "top", "techLef": str(self.workspace / "tech.lef"),
                           "cellLefGlob": str(self.workspace / "cells" / "*.lef"),
                           **_xtop_site_config(self.workspace, (SCENARIO,))})
        return path

    def write_arm(self, arm, request, hold_worst, dumps):
        root = self.workspace / "integrations" / request["batchId"] / arm
        (root / "dumps").mkdir(parents=True, exist_ok=True)
        text = {name: "".join(f"{inst} {master}\n" for inst, master in sorted(mapping.items()))
                for name, mapping in dumps.items()}
        for name, body in text.items():
            (root / "dumps" / name).write_text(body, encoding="utf-8")
        (root / "predict").mkdir(exist_ok=True)
        for check, worst in (("setup", 0.0), ("hold", hold_worst)):
            (root / "predict" / f"{check}.rpt").write_text(
                f"### {check} summary ###\nScenario                  Count      Worst        TNS\n"
                f"{'-' * 54}\ntotal                         1    {worst:.4f}    {worst:.4f}\n"
                f"  {SCENARIO}                   1    {worst:.4f}    {worst:.4f}\n", encoding="utf-8")
        eco = root / ("eco" if arm == "merged" else "eco-control")
        eco.mkdir(exist_ok=True)
        (eco / "atcs_batch_netlist_top.txt").write_text("ecoChangeCell -inst U2 -cell BUFX2\n", encoding="utf-8")
        (eco / "atcs_batch_physical_top.txt").write_text("placeInstance U2 1.0 2.0 R0\n", encoding="utf-8")
        (root / "arm-result.json").write_text(json.dumps({
            "arm": arm, "complete": True, "tainted": "", "protected": ["U2"] if arm == "merged" else [],
            "protectCode": 0, "protectResult": "", "autoFix": [], "predict": {"setup": 0, "hold": 0},
            "exportCode": 0, "exportResult": ""}), encoding="utf-8")
        return root

    def test_the_replay_records_a_session_that_did_not_reproduce_and_the_prediction_decides(self):
        wild, plain = self.sessions()
        facts = self.compose([wild, plain])
        plan_path = self.workspace / "research" / "requests" / "integration-plan.json"
        _write_json(plan_path, {"plan": {"batchId": "gen-2", "baseStateId": self.base_state["id"],
                                         "select": [wild["id"], plain["id"]], "resolutions": [], "deferred": [],
                                         "reason": "every session of the ranked recipe"}, "facts": facts})
        result = _run("replay-prepare", self.workspace, self.base_state_path, plan_path, self.site())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        request = json.loads((self.workspace / "state" / "replay-request.json").read_text())
        recipe = (self.workspace / "integrations" / "gen-2" / "merged" / "recipe.tcl").read_text()
        self.assertIn(f"atcs_size_cell {{U1}} {{{WILD}}}", recipe, "the wild command is replayed, not refused upstream")
        sessions = {session["slot"]: session for session in request["sessions"]}
        steps = {step["slot"]: step for step in request["steps"]}
        # Merged arm: XTop refuses the wild master (skipped, U1 unchanged); w02's size applies.
        dumps, state = {"000.dump": dict(BEFORE)}, dict(BEFORE)
        for slot in sorted(sessions, key=lambda s: sessions[s]["dumpIndex"]):
            if slot == "w02":
                state = {**state, "U2": "BUFX2"}
            dumps[f"{sessions[slot]['dumpIndex']:03d}.dump"] = dict(state)
        dumps["auto.dump"] = {**state, "U3": "BUFX4"}
        merged = self.write_arm("merged", request, -0.01, dumps)
        (merged / "receipts.jsonl").write_text(
            json.dumps({"stepId": steps["w01"]["stepId"], "slot": "w01", "status": "skipped", "attempted": True,
                        "reason": f"invalid library cell '{WILD}'", "seq": 1}) + "\n"
            + json.dumps({"stepId": steps["w02"]["stepId"], "slot": "w02", "status": "applied", "attempted": True,
                          "seq": 2}) + "\n", encoding="utf-8")
        self.write_arm("control", request, -0.03, {"000.dump": dict(BEFORE), "auto.dump": {**BEFORE, "U3": "BUFX4"}})
        result = _run("reconcile", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = json.loads((self.workspace / "state" / "integration-state.json").read_text())
        self.assertEqual(state["chosen"]["arm"], "merged", state["chosen"])
        w01 = state["sessions"]["w01"]
        self.assertFalse(w01["deltaMatches"])
        self.assertIn(WILD, json.dumps(w01["skipped"]))
        self.assertTrue(state["sessions"]["w02"]["deltaMatches"])
        mismatches = [w for w in state.get("warnings", []) if w.get("kind") == "replayMismatch"]
        self.assertEqual([w["slot"] for w in mismatches], ["w01"], state.get("warnings"))


if __name__ == "__main__":
    unittest.main()
