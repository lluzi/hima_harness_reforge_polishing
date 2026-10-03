"""#66 D6 (ticket #73): replay and reconcile enter the sealed effective domain.

- `replay-prepare` (`atcs_cli._recipe_sessions` -> `integration.prepare_recipe_replay`) takes each
  ranked session's domain from its Contribution's ``effectiveDomain`` (the worker session's
  ``domain.json``), falling back to ``state/workers.json`` only for a Contribution without one.
- `reconcile` (`integration.reconcile_recipe`) records out-of-domain replay changes against that
  domain as advice (never a refusal), so an edit on a derived instance is never flagged.
- `xtop-replay.tcl` enters the sealed domain and never derives or widens it; the protection block
  and the four auto-finish commands stay byte-for-byte the attempt-4 ones.
- `arm-result.json` carries ``appliedCommands``, ``skippedCommands`` and ``protectedCount``; replay is
  best effort, recording each skipped command with its reason and continuing; an XTop tie between the
  merged and control arms is recorded as ``manualValue: none``, overall and per session.

No test launches EDA: the CLI runs with a fake Site wrapper and the Tcl in `tclsh` over the
toolkit's stub XTop.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_effective_domain_replay.py -v
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import adapters  # noqa: E402
from atcs import core  # noqa: E402
from atcs import integration  # noqa: E402
from test_adapters import (  # noqa: E402
    REPLAY_STUB, TCLSH, _recipe_command, _recipe_request, _summary_table, _xtop_context, RECIPE_PLAN_A,
    RECIPE_PLAN_B, RECIPE_SCENARIOS,
)
from test_adapters import _tmp as _adapters_tmp  # noqa: E402
from test_cli_state import _run, _tmp, _write_json, _write_xtop_context, _xtop_site_config  # noqa: E402
import test_integration_recovery as tir  # noqa: E402

PLAN = "c" * 64

# The four auto-finish commands as the attempt-4 seal (a5ded4fc) rendered them at the default margins.
ATTEMPT4_AUTO_FINISH = [
    "fix_setup_gba_violations -methods size_cell -effort high -setup_target 0.0 -hold_margin 0.02",
    "fix_setup_gba_violations -methods insert_buffer -effort high -setup_target 0.0 -hold_margin 0.02",
    "fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target 0.0 -setup_margin 0.02",
    "fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin 0.02",
]

# The attempt-4 template's protection block and auto-finish loop, byte for byte (a5ded4fc
# `flow/templates/xtop-replay.tcl`).
ATTEMPT4_PROTECTION = r"""# Only instances that still exist are protected (a later command may have removed
# one); a missing name is recorded rather than failing the whole protection.
set protected {}
set protect_missing {}
set protect_code 0
set protect_result ""
if {$::ATCS_ARM eq "merged"} {
    foreach name [atcs_replay_protected] {
        if {[sizeof_collection [get_cells -quiet -exact $name]] == 1} {
            lappend protected $name
        } else {
            lappend protect_missing $name
        }
    }
    if {[llength $protected] > 0} {
        set protect_code [catch {set_dont_touch [get_cells -exact $protected] true} protect_result]
    }
}
"""
ATTEMPT4_PROTECTED_PROC = r"""proc atcs_replay_protected {} {
    set names {}
    foreach seq $::atcs_kept {
        dict for {name master} [dict get $::atcs_op($seq) after] {
            if {$master ne "" && [lsearch -exact $names $name] < 0} { lappend names $name }
        }
    }
    return [lsort $names]
}
"""
ATTEMPT4_AUTO_FINISH_LOOP = r"""# Auto-fix objects carry the batch's own prefix, never a worker's.
set ::env(NAME_PREFIX) $env(AUTO_PREFIX)
set_parameter eco_new_object_prefix "$env(AUTO_PREFIX)eco"
set auto_fix {}
foreach line [atcs_replay_read_lines $env(AUTO_FIX_TCL)] {
    set code [catch {uplevel #0 $line} result]
    lappend auto_fix [atcs_jobj [list command [atcs_js $line] code $code result [atcs_js [atcs_clip $result 2000]]]]
}
"""


def _domain_record(instances, nets, target_pins, regions=(), plan_instances=("U1",)):
    return {"schema": "atcs-local-domain/1", "fanoutMax": 12, "planInstances": list(plan_instances),
            "planNets": [], "targetPins": list(target_pins), "instances": list(instances), "nets": list(nets),
            "regions": [list(region) for region in regions], "globalNets": [{"net": "CLK", "pins": 4000}],
            "unresolved": []}


# ---------------------------------------------------------------------------
# replay-prepare and reconcile through the CLI (fake Site wrapper, no XTop)
# ---------------------------------------------------------------------------


class EffectiveDomainReplayCliTest(unittest.TestCase):
    """The plan admitted U1 only; the worker session derived U7 (and nets N1, N7) and sized U7."""

    EFFECTIVE = _domain_record(["U1", "U7"], ["N1", "N7"], ["U9/D"], regions=[[0, 0, 10.5, 10]])

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.base_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute",
            "database": {"path": "db.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None,
            "spef": {}, "sdc": [], "tools": {}, "scenarios": [], "parentId": None,
        })
        self.base_state_path = self.workspace / "base-state.json"
        _write_json(self.base_state_path, self.base_state)
        _write_xtop_context(self.workspace, self.base_state["id"], ("synthetic",))
        _write_json(self.workspace / "state" / "workers.json", {"workers": {"w01": {
            "namePrefix": "atcs_w01_r2_",
            "workPackage": {"editDomain": {"instances": ["U1"], "nets": [], "regions": []}, "targetPins": ["U9/D"]},
        }}, "requiredSlots": ["w01"]})

    def _write_batch(self, effective):
        body = {
            "taskId": "w01", "revision": 2, "baseStateId": self.base_state["id"], "kind": "xtop-session",
            "operations": [], "delta": {"mastersChanged": {"U7": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            "admissible": True, "refusals": [], "session": {"lines": 1},
        }
        if effective is not ...:
            body["effectiveDomain"] = effective
        contribution = core.stamp("contribution", body)
        self.contribution = contribution
        _write_json(self.workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        recipe = {"sessions": [{"rank": 1, "contribution": contribution["id"], "taskId": "w01", "commands": [
            {"seq": 1, "proc": "atcs_size_cell", "cmd": "size_cell", "instances": ["U7"], "skip": None,
             "args": {"instance": "U7", "toMaster": "BUFX2", "planSha256": PLAN}},
        ]}], "excluded": []}
        self.facts = core.stamp("composition-facts", {
            "baseStateId": self.base_state["id"], "considered": [contribution["id"]], "duplicates": [],
            "conflicts": [], "interactions": [], "staleBase": [], "order": [contribution["id"]],
            "unresolvedCount": 0, "unknownResolutions": [], "recipe": recipe,
        })
        _write_json(self.workspace / "state" / "composition-facts.json", self.facts)
        self.plan_path = self.workspace / "integration-plan.json"
        _write_json(self.plan_path, {"plan": {"batchId": "gen-1", "baseStateId": self.base_state["id"],
                                              "select": [contribution["id"]], "resolutions": [], "deferred": [],
                                              "reason": "ranked recipe"}, "facts": self.facts})

    def _prepare(self):
        wrapper = self.workspace / "wrapper.sh"
        wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        wrapper.chmod(0o755)
        site = self.workspace / "site-profile.json"
        _write_json(site, {
            "edaShell": [str(wrapper)], "design": "top",
            "techLef": str(self.workspace / "tech.lef"), "cellLefGlob": str(self.workspace / "cells" / "*.lef"),
            **_xtop_site_config(self.workspace, ("synthetic",)),
        })
        result = _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path, site)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state" / "replay-request.json").read_text())

    def _write_arm(self, arm, merged_after):
        """One finished arm: base U1/U7/U8 BUFX1; merged changes `merged_after`; equal predictions."""
        root = self.workspace / "integrations" / "gen-1" / arm
        (root / "dumps").mkdir(parents=True, exist_ok=True)
        base = {"U1": "BUFX1", "U7": "BUFX1", "U8": "BUFX1"}
        after = dict(base, **(merged_after if arm == "merged" else {}))
        dump = lambda cells: "".join(f"{name} {master}\n" for name, master in sorted(cells.items()))  # noqa: E731
        (root / "dumps" / "000.dump").write_text(dump(base), encoding="utf-8")
        if arm == "merged":
            (root / "dumps" / "001.dump").write_text(dump(after), encoding="utf-8")
        (root / "dumps" / "auto.dump").write_text(dump(after), encoding="utf-8")
        request = json.loads((self.workspace / "state" / "replay-request.json").read_text())
        if arm == "merged":
            (root / "receipts.jsonl").write_text(json.dumps({
                "stepId": request["steps"][0]["stepId"], "slot": "w01", "status": "applied", "attempted": True,
                "seq": 1}) + "\n", encoding="utf-8")
        (root / "predict").mkdir(exist_ok=True)
        for check, worst in (("setup", 0.0), ("hold", -0.02)):
            (root / "predict" / f"{check}.rpt").write_text(
                f"### {check} summary ###\nScenario                  Count      Worst        TNS\n"
                f"{'-' * 54}\ntotal                         1    {worst:.4f}    {worst:.4f}\n"
                f"  synthetic                   1    {worst:.4f}    {worst:.4f}\n", encoding="utf-8")
        eco = root / ("eco" if arm == "merged" else "eco-control")
        eco.mkdir(exist_ok=True)
        (eco / "atcs_batch_netlist_top.txt").write_text("ecoChangeCell -inst U7 -cell BUFX2\n", encoding="utf-8")
        (eco / "atcs_batch_physical_top.txt").write_text("placeInstance U7 1.0 2.0 R0\n", encoding="utf-8")
        (root / "arm-result.json").write_text(json.dumps({
            "arm": arm, "complete": True, "tainted": "", "protected": ["U7"] if arm == "merged" else [],
            "protectCode": 0, "protectResult": "", "autoFix": [], "predict": {"setup": 0, "hold": 0},
            "exportCode": 0, "exportResult": ""}), encoding="utf-8")

    def _reconcile(self):
        result = _run("reconcile", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state" / "integration-state.json").read_text())

    def test_the_replay_plan_enters_the_sealed_effective_domain(self):
        self._write_batch(self.EFFECTIVE)
        request = self._prepare()
        (session,) = request["sessions"]
        self.assertEqual(session["domain"], {"instances": ["U1", "U7"], "nets": ["N1", "N7"], "pins": ["U9/D"],
                                             "regions": [[0, 0, 10.5, 10]]})
        self.assertEqual(session["domainSource"], "effectiveDomain")
        recipe_text = (self.workspace / "integrations" / "gen-1" / "merged" / "recipe.tcl").read_text()
        self.assertIn("atcs_replay_session {w01} {atcs_w01_r2_} {U1 U7} {N1 N7} {U9/D} {0 0 10.5 10}\n", recipe_text)
        self.assertIn(f"atcs_size_cell {{U7}} {{BUFX2}} {{{PLAN}}}", recipe_text)

    def test_a_contribution_without_an_effective_domain_falls_back_to_the_admitted_work_package(self):
        for effective in (..., None):
            with self.subTest(effectiveDomain="absent" if effective is ... else effective):
                shutil.rmtree(self.workspace / "integrations", ignore_errors=True)
                self._write_batch(effective)
                (session,) = self._prepare()["sessions"]
                self.assertEqual(session["domain"], {"instances": ["U1"], "nets": [], "pins": ["U9/D"],
                                                     "regions": []})
                self.assertEqual(session["domainSource"], "workPackage")

    def test_reconcile_does_not_flag_a_change_inside_the_derived_domain(self):
        self._write_batch(self.EFFECTIVE)
        self._prepare()
        self._write_arm("merged", {"U7": "BUFX2"})
        self._write_arm("control", {})
        state = self._reconcile()
        self.assertTrue(state["arms"]["merged"]["safe"], state["arms"]["merged"]["problems"])
        self.assertEqual(state["chosen"]["arm"], "merged")

    def test_reconcile_records_a_change_outside_the_effective_domain_as_advice(self):
        self._write_batch(self.EFFECTIVE)
        self._prepare()
        self._write_arm("merged", {"U7": "BUFX2", "U8": "BUFX4"})
        self._write_arm("control", {})
        state = self._reconcile()
        self.assertTrue(state["arms"]["merged"]["safe"], state["arms"]["merged"]["problems"])
        (warning,) = [w for w in state["warnings"] if w["kind"] == "outOfDomain"]
        self.assertEqual(warning["instances"], ["U8"])
        self.assertIn("effectiveDomain", warning["detail"])
        self.assertEqual(state["chosen"]["arm"], "merged")


# ---------------------------------------------------------------------------
# prepare_recipe_replay: the domain source and names that cannot be one Tcl word
# ---------------------------------------------------------------------------


class PrepareEffectiveDomainTests(unittest.TestCase):
    def _sessions(self, **w01):
        sessions = tir.recipe_sessions()
        sessions["w01"].update(w01)
        return sessions

    def test_the_request_records_each_sessions_domain_source(self):
        sessions = self._sessions(domainSource="effectiveDomain")
        request = integration.prepare_recipe_replay(tir.recipe_plan(), tir.BASE_STATE_ID, tir.default_recipe(),
                                                    sessions)
        self.assertEqual([s.get("domainSource") for s in request["sessions"]], ["effectiveDomain", "workPackage"])

    def test_an_unsafe_derived_name_is_left_out_of_the_replay_domain_and_recorded(self):
        """A derived name that cannot be one literal Tcl word never refuses the whole batch: the
        replay domain omits it (a command on it is refused and recorded as skipped)."""
        domain = {"instances": ["U1", "U2", "u_esc\\/x"], "nets": ["N1", "n$bad"], "regions": [[0, 0, 10, 10]]}
        sessions = self._sessions(domainSource="effectiveDomain", editDomain=domain)
        request = integration.prepare_recipe_replay(tir.recipe_plan(), tir.BASE_STATE_ID, tir.default_recipe(),
                                                    sessions)
        w01 = request["sessions"][0]
        self.assertEqual(w01["domain"]["instances"], ["U1", "U2"])
        self.assertEqual(w01["domain"]["nets"], ["N1"])
        self.assertEqual(w01["domainDropped"], {"instances": ["u_esc\\/x"], "nets": ["n$bad"], "pins": []})

    def test_an_unsafe_name_in_an_admitted_work_package_still_refuses(self):
        domain = {"instances": ["U1", "n$bad"], "nets": [], "regions": []}
        sessions = self._sessions(domainSource="workPackage", editDomain=domain)
        with self.assertRaises(core.AtcsError):
            integration.prepare_recipe_replay(tir.recipe_plan(), tir.BASE_STATE_ID, tir.default_recipe(), sessions)


# ---------------------------------------------------------------------------
# The auto-finish and the protection stay the attempt-4 bytes
# ---------------------------------------------------------------------------


class AutoFinishUnchangedTests(unittest.TestCase):
    def test_the_four_auto_finish_commands_are_the_attempt4_strings(self):
        self.assertEqual(integration.auto_fix_tcl(0.02, 0.02), ATTEMPT4_AUTO_FINISH)
        request = tir.prepare_default()
        self.assertEqual(request["autoFinishTcl"], ATTEMPT4_AUTO_FINISH)
        self.assertEqual(request["controlTcl"], ATTEMPT4_AUTO_FINISH)
        self.assertEqual(tir.prepare_default(autoFinish=False)["controlTcl"], ATTEMPT4_AUTO_FINISH)

    def test_the_protection_block_and_auto_finish_loop_are_byte_for_byte_unchanged(self):
        text = adapters.load_template("xtop-replay.tcl")
        for block in (ATTEMPT4_PROTECTED_PROC, ATTEMPT4_PROTECTION, ATTEMPT4_AUTO_FINISH_LOOP):
            self.assertEqual(text.count(block), 1, block.splitlines()[0])
        self.assertLess(text.index(ATTEMPT4_PROTECTION), text.index(ATTEMPT4_AUTO_FINISH_LOOP))


# ---------------------------------------------------------------------------
# The replay Tcl in tclsh: the sealed domain, appliedCommands and protectedCount
# ---------------------------------------------------------------------------


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class ReplayTclshTest(unittest.TestCase):
    EVEN = ({"s1": (1, -0.02, -0.02), "s2": (0, 0.0, 0.0)}, {"s1": (0, 0.0, 0.0), "s2": (2, -0.05, -0.08)})

    def setUp(self):
        from test_xtop_toolkit import STUB_XTOP
        self.stub = STUB_XTOP + REPLAY_STUB
        self.tmp = _adapters_tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (self.tmp / name).write_text("stub", encoding="utf-8")

    def _compile(self, request):
        return adapters.compile_recipe_replay_task(
            "top", str(self.tmp / "tech.lef"), str(self.tmp / "cells.lef"), str(self.tmp / "netlist.v"),
            str(self.tmp / "design.def"), request, str(self.tmp / "integrations" / "b1"), _xtop_context(self.tmp))

    def _run_arm(self, task, arm, recipe_prefix=""):
        arm_task = task["arms"][arm]
        root = Path(arm_task["root"])
        root.mkdir(parents=True, exist_ok=True)
        Path(arm_task["recipePath"]).write_text(recipe_prefix + arm_task["recipeText"], encoding="utf-8")
        Path(arm_task["autoFixPath"]).write_text(arm_task["autoFixText"], encoding="utf-8")
        preamble = (f'set env(STUB_CALLS) "{root / "calls.txt"}"\n' + self.stub
                    + f"set ::stub_summary_setup {{{_summary_table('setup', self.EVEN[0])}}}\n"
                    + f"set ::stub_summary_hold {{{_summary_table('hold', self.EVEN[1])}}}\n"
                    + "set ::stub_fix_effect {UOUT BUFX4}\nset ::stub_fail {split_net}\n")
        script = root / "run.tcl"
        script.write_text(preamble + arm_task["tcl"], encoding="utf-8")
        result = subprocess.run([TCLSH, str(script)], capture_output=True, text=True, cwd=str(root))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipts = [json.loads(line) for line in (root / "receipts.jsonl").read_text().splitlines()] \
            if (root / "receipts.jsonl").is_file() else []
        return json.loads(Path(arm_task["armResult"]).read_text()), receipts, result.stdout

    def _derived_request(self, extra=()):
        """w01's plan named U1 only; its sealed domain added the derived U3 and net N1 (U3's input)."""
        recipe = {"sessions": [{"rank": 1, "contribution": "c1", "taskId": "w01", "commands": [
            _recipe_command(1, "atcs_size_cell", {"instance": "U3", "toMaster": "BUFX4", "planSha256": RECIPE_PLAN_A},
                            ["U3"]),
            *extra,
        ]}], "excluded": []}
        sessions = {"w01": {"contributionId": "c1", "revision": 1, "namePrefix": "atcs_w01_r1_",
                            "domainSource": "effectiveDomain",
                            "editDomain": {"instances": ["U1", "U3"], "nets": ["N1"], "regions": []},
                            "targetPins": ["U9/D"],
                            "delta": {"mastersChanged": {"U3": ["BUFX2", "BUFX4"]}, "added": {}, "removed": {}}}}
        plan = {"batchId": "b1", "baseStateId": "base-1", "reason": "derived"}
        return integration.prepare_recipe_replay(plan, "base-1", recipe, sessions,
                                                 required_scenarios=RECIPE_SCENARIOS, removable_fillers=["FILL*"])

    def test_a_command_on_a_derived_instance_is_applied_inside_the_sealed_domain(self):
        request = self._derived_request()
        task = self._compile(request)
        result, receipts, stdout = self._run_arm(task, "merged")
        self.assertEqual([r["status"] for r in receipts], ["applied"], receipts)
        self.assertIn("ATCS:replay-domain:w01:2 instances, 1 nets", stdout)
        self.assertEqual(result["protected"], ["U3"])

    def test_replay_applies_commands_from_the_common_base_without_worker_saved_databases(self):
        self.stub += '''
proc save_workspace {args} {
    if {[regexp {_operator_(baseline|candidate)$} [lindex $args end]]} {
        error "worker saved databases are unavailable"
    }
    stub_record save_workspace {*}$args
}
'''
        task = self._compile(self._derived_request())
        result, receipts, _ = self._run_arm(task, "merged")
        self.assertEqual([item["status"] for item in receipts], ["applied"], receipts)
        self.assertEqual(result["protected"], ["U3"])

    def test_the_replay_never_widens_the_sealed_domain(self):
        """Even with EDIT_DOMAIN_LOCAL set, a session entered from its sealed record never admits a
        buffer's input net the record lacks: remove_buffer on U1 (input N1, not sealed; output N2
        sealed) is refused instead of admitting N1 as a worker session would."""
        request = self._derived_request(extra=[_recipe_command(
            2, "atcs_remove_buffer", {"instance": "U1", "planSha256": RECIPE_PLAN_A}, ["U1"])])
        request["sessions"][0]["domain"]["nets"] = ["N2"]
        task = self._compile(request)
        _, receipts, _ = self._run_arm(task, "merged", recipe_prefix="set ::EDIT_DOMAIN_LOCAL 1\n")
        self.assertEqual(receipts[1]["status"], "skipped", receipts)
        self.assertIn("out-of-scope net: N1", receipts[1]["reason"])

    def test_arm_result_carries_applied_commands_and_protected_count(self):
        request = _recipe_request()
        task = self._compile(request)
        merged, receipts, _ = self._run_arm(task, "merged")
        self.assertEqual(merged["appliedCommands"], sum(1 for r in receipts if r["status"] == "applied"))
        self.assertEqual(merged["appliedCommands"], 2)
        self.assertEqual(merged["protectedCount"], len(merged["protected"]))
        self.assertEqual(merged["protectedCount"], 2)
        control, _, _ = self._run_arm(task, "control")
        self.assertEqual((control["appliedCommands"], control["protectedCount"]), (0, 0))

    def test_best_effort_replay_continues_past_skipped_commands_and_records_each_with_its_reason(self):
        """Replay is an aggregator: w01's second command is refused by the toolkit and its third
        errors in XTop, yet w02's insert after them is still applied; the arm-result counts applied
        and skipped, reconcile lists each skipped command with its reason, and the merged arm stays
        safe with the applied instances protected."""
        request = _recipe_request()
        task = self._compile(request)
        merged, receipts, _ = self._run_arm(task, "merged")
        self._run_arm(task, "control")
        self.assertEqual([(r["slot"], r["status"]) for r in receipts],
                         [("w01", "applied"), ("w01", "skipped"), ("w01", "skipped"), ("w02", "applied"),
                          ("w02", "skipped"), ("w02", "skipped")])
        self.assertEqual((merged["appliedCommands"], merged["skippedCommands"]), (2, 4))
        self.assertEqual(merged["protected"], ["U1", "atcs_w02_r1_b1"])

        arms = {arm: adapters.read_replay_arm(task["arms"][arm]["root"], arm, request) for arm in ("merged", "control")}
        state = integration.reconcile_recipe(request, arms)
        steps = request["steps"]
        self.assertTrue(state["arms"]["merged"]["safe"], state["arms"]["merged"]["problems"])
        self.assertEqual((state["arms"]["merged"]["appliedCommands"], state["arms"]["merged"]["skippedCommands"]),
                         (2, 4))
        self.assertEqual(state["sessions"]["w01"]["applied"], [steps[0]["stepId"]])
        self.assertEqual([(s["stepId"], s["reason"]) for s in state["sessions"]["w01"]["skipped"]],
                         [(steps[1]["stepId"], "instance U2 is already INVX1"),
                          (steps[2]["stepId"], "split_net failed (seq 2): XTop stub refused split_net")])
        self.assertEqual(state["sessions"]["w02"]["applied"], [steps[3]["stepId"]])
        self.assertEqual([(s["attempted"], s["reason"]) for s in state["sessions"]["w02"]["skipped"]],
                         [(False, "recipe:shared-instance"), (True, "out-of-scope instance: U2")])
        self.assertEqual(state["protected"], ["U1", "atcs_w02_r1_b1"])
        self.assertEqual(state["chosen"]["arm"], "merged")
        merge = integration.seal_batch(state, request, {"baseStateId": "base-1"},
                                       [{"id": "c1", "revision": 1}, {"id": "c2", "revision": 1}])
        self.assertEqual(merge["arms"]["merged"]["skippedCommands"], 4)
        self.assertEqual([entry["id"] for entry in merge["contributions"]], ["c1", "c2"])

    def test_the_auto_finish_runs_the_attempt4_strings_after_protection_in_both_arms(self):
        task = self._compile(_recipe_request())
        for arm in ("merged", "control"):
            result, _, _ = self._run_arm(task, arm)
            self.assertEqual([entry["command"] for entry in result["autoFix"]], ATTEMPT4_AUTO_FINISH, arm)


# ---------------------------------------------------------------------------
# reconcile_recipe: arm fields and the manual-value record
# ---------------------------------------------------------------------------


class ArmResultFieldsTests(unittest.TestCase):
    def test_the_arm_views_carry_applied_commands_and_protected_count(self):
        request = tir.prepare_default()
        merged = tir.arm_evidence("merged", receipts=tir.merged_receipts(request),
                                  session_deltas=tir.matching_session_deltas(), protected=["U1", "atcs_w02_r1_b1"])
        merged["result"].update(appliedCommands=2, protectedCount=2)
        control = tir.arm_evidence("control")
        control["result"].update(appliedCommands=0, protectedCount=0)
        state = integration.reconcile_recipe(request, {"merged": merged, "control": control})
        self.assertEqual((state["arms"]["merged"]["appliedCommands"], state["arms"]["merged"]["protectedCount"]),
                         (2, 2))
        self.assertEqual((state["arms"]["control"]["appliedCommands"], state["arms"]["control"]["protectedCount"]),
                         (0, 0))
        merge = integration.seal_batch(state, request, {"baseStateId": tir.BASE_STATE_ID},
                                       [{"id": "c1", "revision": 1}, {"id": "c2", "revision": 3}])
        self.assertEqual(merge["arms"]["merged"]["appliedCommands"], 2)
        self.assertEqual(merge["arms"]["merged"]["protectedCount"], 2)

    def test_an_arm_result_without_the_fields_is_read_from_its_receipts_and_protection(self):
        """Evidence written before #66 D6 (attempt 4) still reconciles: the counts come from the
        applied receipts and the protected list."""
        request = tir.prepare_default()
        _, state = tir.reconcile_default(request=request, merged_kw={"protected": ["U1"]})
        self.assertEqual(state["arms"]["merged"]["appliedCommands"], 2)
        self.assertEqual(state["arms"]["merged"]["protectedCount"], 1)
        self.assertEqual(state["arms"]["control"]["appliedCommands"], 0)


class ManualValueTests(unittest.TestCase):
    def test_an_xtop_tie_records_manual_value_none_overall_and_per_session(self):
        _, state = tir.reconcile_default()
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["manualValue"], "none")
        self.assertIn("tie", state["manualValueReason"])
        self.assertEqual({slot: account["manualValue"] for slot, account in state["sessions"].items()},
                         {"w01": "none", "w02": "none"})

    def test_a_better_merged_prediction_credits_only_sessions_that_applied_a_command(self):
        request = tir.prepare_default()
        receipts = tir.merged_receipts(request)
        receipts[2] = dict(receipts[2], status="skipped", attempted=True, reason="out-of-scope net: N3")
        deltas = tir.matching_session_deltas()
        deltas["w02"] = {"mastersChanged": {}, "added": {}, "removed": {}}
        _, state = tir.reconcile_default(request=request, merged_kw={
            "receipts": receipts, "session_deltas": deltas,
            "hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.01, -0.01)}})
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["manualValue"], "better")
        self.assertEqual(state["sessions"]["w01"]["manualValue"], "better")
        self.assertEqual(state["sessions"]["w02"]["manualValue"], "none")

    def test_a_merged_arm_that_applied_nothing_is_manual_value_none_whatever_xtop_says(self):
        request = tir.prepare_default()
        receipts = [dict(r, status="skipped", attempted=True, reason="no-change") if r["status"] == "applied" else r
                    for r in tir.merged_receipts(request)]
        empty = {"mastersChanged": {}, "added": {}, "removed": {}}
        _, state = tir.reconcile_default(request=request, merged_kw={
            "receipts": receipts, "session_deltas": {"w01": empty, "w02": empty},
            "hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.01, -0.01)}})
        self.assertEqual(state["manualValue"], "none")
        self.assertIn("applied no command", state["manualValueReason"])

    def test_retained_merged_prediction_is_still_reported_as_worse(self):
        _, state = tir.reconcile_default(control_kw={"hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.03, -0.03)}})
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["manualValue"], "worse")

    def test_without_a_comparison_the_manual_value_is_unknown(self):
        _, state = tir.reconcile_default(control_kw={"complete": False})
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["manualValue"], "unknown")

    def test_the_sealed_batch_carries_the_manual_value(self):
        request, state = tir.reconcile_default()
        merge = integration.seal_batch(state, request, {"baseStateId": tir.BASE_STATE_ID},
                                       [{"id": "c1", "revision": 1}, {"id": "c2", "revision": 3}])
        self.assertEqual(merge["manualValue"], "none")
        self.assertEqual(merge["sessions"]["w01"]["manualValue"], "none")


if __name__ == "__main__":
    unittest.main()
