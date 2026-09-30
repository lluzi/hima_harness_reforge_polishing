"""#66 D1: `read-atcs.py seat-clusters` partitions the violating checks into ordered blocker clusters.

Attempt 4 (#64) gave each of six expert seats one endpoint and an instance-only domain; four seats
never produced a request and the merged arm tied auto-finish alone. Manual ECO is bottleneck removal:
each seat owns a coherent blocker cluster (a shared startpoint such as a clock enable, a hierarchy, a
fail-reason pattern), hardest check first. `seat-clusters WORKSPACE OUT [--slots N]` proposes that
partition as a candidate `workPackages` block the plan Workshop may adopt or edit: at most N disjoint
clusters (no two share an endpoint cell), ordered by worst slack, each package's `targets` its
`cluster.checks` hardest first, its `targetPins` the endpoint pins of leaf cells and never a port (a
port check's driver cell joins the edit domain instead).

The fixture is small but shaped like the real Run's evidence: observation checks keyed
`<scenario>|<mode>|<endpoint>` with endpoint, startpoint, slack, pathGroup and violated;
`state/residual-cases.json` with `cases[].checks`, `failReasons` and `evidence`, and the evaluated
batch's `batchFailReasons`. Nothing here launches EDA.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_seat_clusters.py -v
"""
from __future__ import annotations

import json
import re
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
import atcs_cli  # noqa: E402
from test_readers import READ_ATCS_PATH, _build_design_state, _make_workspace, _write, read_atcs  # noqa: E402

S = "func_ssg_rcworst_m40"
T = "func_ffg_cbest_125"
X = "func_tt_typical_25"  # not a required scenario

NETLIST = """module top ( dma_bus_clk_en, clk, lsu_axi_arvalid );
  input dma_bus_clk_en;
  input clk;
  output lsu_axi_arvalid;
  dma u_dma ( .clk(clk), .en(dma_bus_clk_en) );
  lsu u_lsu ( .clk(clk), .arvalid(lsu_axi_arvalid) );
  ifu u_ifu ( .clk(clk) );
  dec u_dec ( .clk(clk) );
  exu u_exu ( .clk(clk) );
  dbg u_dbg ( .clk(clk) );
  SDFQD1BWP35P140 top_reg_0_ ( .D(n1), .CP(clk), .Q(n2) );
endmodule
module dma ( clk, en );
  input clk;
  input en;
  SDFCNQD1BWP35P140 fifo_0_reg ( .D(en), .CP(clk), .Q(q0) );
  SDFCNQD1BWP35P140 fifo_1_reg ( .D(en), .CP(clk), .Q(q1) );
  SDFCNQD1BWP35P140 fifo_2_reg ( .D(en), .CP(clk), .Q(q2) );
endmodule
module lsu ( clk, arvalid );
  input clk;
  output arvalid;
  SDFQD1BWP35P140 data_reg_3_ ( .D(n4410), .CP(clk), .Q(n5) );
  SDFQD1BWP35P140 addr_reg_0_ ( .D(n4411), .CP(clk), .Q(n6) );
  BUFFD2BWP35P140 U_arv ( .I(n6), .Z(arvalid) );
endmodule
module ifu ( clk );
  input clk;
  SDFQD1BWP35P140 pc_reg_1_ ( .D(n212), .CP(clk), .Q(q1) );
  SDFQD1BWP35P140 pc_reg_2_ ( .D(n213), .CP(clk), .Q(q2) );
endmodule
module dec ( clk );
  input clk;
  SDFQD1BWP35P140 ins_reg_7_ ( .D(n98), .CP(clk), .Q(q) );
endmodule
module exu ( clk );
  input clk;
  SDFQD1BWP35P140 mul_reg_2_ ( .D(n5), .CP(clk), .Q(q) );
  SDFQD1BWP35P140 add_reg_0_ ( .D(n6), .CP(clk), .Q(q2) );
endmodule
module dbg ( clk );
  input clk;
  SDFQD1BWP35P140 dmactive_reg_0_ ( .D(n9), .CP(clk), .Q(q) );
endmodule
"""

# (key, slack, startpoint, pathGroup): the required scenarios' violating checks, one ignored scenario,
# one met check and one endpoint the netlist does not hold. Only the dma FIFO checks share a startpoint
# (the clock-enable port); every other check has its own launch register.
CHECKS = (
    (f"{S}|setup|u_lsu/data_reg_3_/D", -0.20, "u_src/launch_1_reg/CP", "core_clock"),
    (f"{S}|hold|u_dma/fifo_0_reg/D", -0.15, "dma_bus_clk_en", "core_clock"),
    (f"{S}|hold|u_dma/fifo_1_reg/D", -0.14, "dma_bus_clk_en", "core_clock"),
    (f"{S}|setup|u_ifu/pc_reg_1_/D", -0.12, "u_src/launch_2_reg/CP", "core_clock"),
    (f"{S}|setup|u_dec/ins_reg_7_/D", -0.10, "u_src/launch_3_reg/CP", "core_clock"),
    (f"{T}|setup|u_lsu/data_reg_3_/D", -0.09, "u_src/launch_4_reg/CP", "core_clock"),
    (f"{S}|hold|u_exu/mul_reg_2_/D", -0.08, "u_src/launch_5_reg/CP", "core_clock"),
    (f"{T}|hold|u_dma/fifo_2_reg/D", -0.07, "dma_bus_clk_en", "core_clock"),
    (f"{S}|hold|u_dbg/dmactive_reg_0_/D@**async_default**", -0.06, "rst_l", "**async_default**"),
    (f"{S}|hold|u_lsu/addr_reg_0_/D", -0.05, "u_src/launch_6_reg/CP", "core_clock"),
    (f"{S}|setup|lsu_axi_arvalid", -0.04, "u_src/launch_7_reg/CP", "core_clock"),
    (f"{S}|hold|u_ifu/pc_reg_2_/D", -0.03, "u_src/launch_8_reg/CP", "core_clock"),
    (f"{S}|setup|u_ifu/pc_reg_2_/D", -0.03, "u_src/launch_9_reg/CP", "core_clock"),
    (f"{S}|hold|top_reg_0_/D", -0.02, "u_src/launch_10_reg/CP", "core_clock"),
    (f"{S}|setup|u_ghost/reg_0_/D", -0.01, "u_src/launch_11_reg/CP", "core_clock"),
    (f"{X}|setup|u_dec/ins_reg_7_/D", -0.50, "u_src/launch_12_reg/CP", "core_clock"),
    (f"{S}|setup|u_exu/add_reg_0_/D", 0.01, "u_src/launch_13_reg/CP", "core_clock"),
)
BATCH_FAIL_REASONS = {"setup": {"no_candidate": 5, "max_tran": 3}, "hold": {"break_setup": 66, "port_net": 16}}
# One residual case whose own fail reasons differ from the batch's (the case, when there is one, wins).
CASE_FAIL_REASONS = {f"{S}|hold|u_dbg/dmactive_reg_0_/D@**async_default**": {"port_net": 9}}


def seat_workspace(root, slots=6):
    """A Campaign workspace with the fixture netlist, working state, policy, observation, residual cases
    and the `workerSlots` knob bound."""
    workspace = _make_workspace(root)
    design = _build_design_state(workspace, netlist_text=NETLIST)
    core.write_artifact(workspace / "state" / "working-state.json", design)
    core.write_artifact(workspace / "state" / "policy.json", core.stamp(
        "policy", {"requiredScenarios": [S, T], "baselineStateId": design["id"]}))
    checks = {}
    for key, slack, startpoint, group in CHECKS:
        endpoint = key.split("|", 2)[2].split("@", 1)[0]
        checks[key] = {"endpoint": endpoint, "startpoint": startpoint, "pathGroup": group,
                       "slack": core.known(slack), "violated": slack < 0}
    core.write_artifact(workspace / "state" / "observation.json", core.stamp("observation-set", {
        "designStateId": design["id"], "precision": "gba", "scenarios": {}, "checks": checks,
        "missingScenarios": [], "coverage": {"complete": True, "reasons": []}, "sources": [],
    }))
    cases = []
    for key, _slack, _start, _group in CHECKS:
        if key.startswith(X) or key.endswith("add_reg_0_/D"):
            continue
        mode = key.split("|", 2)[1]
        cases.append(core.stamp("residual-case", {
            "checks": [key], "attempts": [], "limits": [], "suggestedStage": None, "requiredInputs": [],
            "evidence": {"fanout": core.known(4), "location": core.unknown("no path detail observed")},
            "failReasons": CASE_FAIL_REASONS.get(key, BATCH_FAIL_REASONS[mode]),
        }))
    _write(workspace / "state" / "residual-cases.json", json.dumps({
        "cases": cases, "queryNotes": [],
        "batchFailReasons": {"mergeCommitId": "0" * 20, "arm": "merged", **BATCH_FAIL_REASONS}}))
    assert atcs_cli.main(["worker-slots", str(workspace), str(slots)]) == 0
    return workspace, design


class SeatClustersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace, self.design = seat_workspace(self.tmp.name)

    def seat(self, slots=None):
        return read_atcs.seat_clusters(self.workspace, slots)

    def active(self, answer):
        return {slot: package for slot, package in answer["workPackages"].items() if not workspaces.is_parked(package)}

    def test_six_seats_partition_every_violating_check_into_ordered_disjoint_clusters(self):
        answer = self.seat()
        self.assertEqual(list(answer["workPackages"]), list(workspaces.TASK_IDS))
        clusters = [(package["cluster"]["cause"], package["cluster"]["key"], package["cluster"]["checks"])
                    for package in self.active(answer).values()]
        self.assertEqual(clusters, [
            ("hierarchy", "u_lsu", [f"{S}|setup|u_lsu/data_reg_3_/D", f"{T}|setup|u_lsu/data_reg_3_/D",
                                    f"{S}|hold|u_lsu/addr_reg_0_/D", f"{S}|setup|lsu_axi_arvalid"]),
            ("clock-enable", "dma_bus_clk_en", [f"{S}|hold|u_dma/fifo_0_reg/D", f"{S}|hold|u_dma/fifo_1_reg/D",
                                                f"{T}|hold|u_dma/fifo_2_reg/D"]),
            # Equal slack: the hold check, with the harder fail reasons (82 against 8), comes first.
            ("hierarchy", "u_ifu", [f"{S}|setup|u_ifu/pc_reg_1_/D", f"{S}|hold|u_ifu/pc_reg_2_/D",
                                    f"{S}|setup|u_ifu/pc_reg_2_/D"]),
            ("hierarchy", "u_dec", [f"{S}|setup|u_dec/ins_reg_7_/D"]),
            ("fail-reason", "hold:break_setup", [f"{S}|hold|u_exu/mul_reg_2_/D", f"{S}|hold|top_reg_0_/D"]),
            ("hierarchy", "u_dbg", [f"{S}|hold|u_dbg/dmactive_reg_0_/D@**async_default**"]),
        ])
        self.assertEqual(answer["uncovered"], [])
        (unresolved,) = answer["unresolved"]
        self.assertEqual(unresolved["check"], f"{S}|setup|u_ghost/reg_0_/D")

    def test_targets_are_the_cluster_checks_and_ports_resolve_to_their_driver_cell(self):
        w01 = self.seat()["workPackages"]["w01"]
        self.assertEqual(w01["targets"], w01["cluster"]["checks"])
        self.assertEqual(w01["editDomain"]["instances"],
                         ["u_lsu/data_reg_3_", "u_lsu/addr_reg_0_", "u_lsu/U_arv"])
        self.assertEqual(w01["targetPins"], ["u_lsu/data_reg_3_/D", "u_lsu/addr_reg_0_/D"])
        for package in self.active(self.seat()).values():
            self.assertFalse([pin for pin in package["targetPins"] if "/" not in pin or pin == "lsu_axi_arvalid"])

    def test_no_two_seats_share_an_endpoint_cell_and_each_package_is_valid(self):
        answer = self.seat()
        seen = {}
        for slot, package in answer["workPackages"].items():
            self.assertEqual(workspaces.request_invalid_count(package, self.design, {"pgVerification": False}), 0,
                             workspaces._collect_problems(package, self.design, {}))
            if workspaces.is_parked(package):
                continue
            self.assertEqual(package["scope"], {"commands": list(workspaces.MUTATE_COMMANDS),
                                                "maxMutations": workspaces.SCOPE_MAX_MUTATIONS})
            for cell in package["editDomain"]["instances"]:
                self.assertNotIn(cell, seen, f"{cell} is claimed by {seen.get(cell)} and {slot}")
                seen[cell] = slot

    def test_the_plan_reader_admits_the_proposed_packages_with_no_advice(self):
        answer = self.seat()
        plan = {"candidate": {"workPackages": answer["workPackages"], "reason": "seat-clusters, adopted unchanged"},
                "baseState": self.design, "siteCapabilities": {"pgVerification": False}}
        report = _write(self.workspace / "research" / "requests" / "campaign-plan.json", json.dumps(plan))
        self.assertEqual(read_atcs.problems("campaign-plan", report, self.workspace), [])
        self.assertEqual(read_atcs.advice("campaign-plan", report, self.workspace), [])

    def test_at_most_n_clusters_and_the_rest_is_named_uncovered(self):
        answer = self.seat(3)
        self.assertEqual(answer["workerSlots"], 3)
        active = self.active(answer)
        self.assertEqual(list(active), ["w01", "w02", "w03"])
        self.assertEqual([package["cluster"]["key"] for package in active.values()],
                         ["u_lsu", "dma_bus_clk_en", "u_ifu"])
        for slot in ("w04", "w05", "w06"):
            self.assertTrue(workspaces.is_parked(answer["workPackages"][slot]))
        # The unseated checks, hardest first: seats take the worst clusters, the rest are named.
        self.assertEqual([row["check"] for row in answer["uncovered"]], [
            f"{S}|setup|u_dec/ins_reg_7_/D", f"{S}|hold|u_exu/mul_reg_2_/D",
            f"{S}|hold|u_dbg/dmactive_reg_0_/D@**async_default**", f"{S}|hold|top_reg_0_/D"])

    def test_zero_slots_seats_nothing(self):
        answer = self.seat(0)
        self.assertTrue(all(workspaces.is_parked(package) for package in answer["workPackages"].values()))
        self.assertEqual(len(answer["uncovered"]), 14)

    def test_the_knob_is_the_default_bound(self):
        self.assertEqual(atcs_cli.main(["worker-slots", str(self.workspace), "2"]), 0)
        answer = self.seat()
        self.assertEqual([slot for slot in answer["workPackages"] if slot in self.active(answer)], ["w01", "w02"])

    def test_the_command_writes_the_answer(self):
        out = Path(self.tmp.name) / "clusters.json"
        result = subprocess.run([sys.executable, str(READ_ATCS_PATH), "seat-clusters", str(self.workspace), str(out),
                                 "--slots", "4"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        answer = json.loads(out.read_text())
        self.assertEqual(answer["schema"], "atcs-seat-clusters/1")
        self.assertEqual(answer["designStateId"], self.design["id"])
        self.assertEqual(len(self.active(answer)), 4)
        result = subprocess.run([sys.executable, str(READ_ATCS_PATH), "seat-clusters", str(self.workspace), str(out),
                                 "--slots", "7"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)

    def test_an_observation_of_another_state_is_refused(self):
        path = self.workspace / "state" / "observation.json"
        body = {k: v for k, v in json.loads(path.read_text()).items() if k not in ("schema", "id")}
        body["designStateId"] = "0" * 20
        core.write_artifact(path, core.stamp("observation-set", body))
        with self.assertRaisesRegex(ValueError, "observe the working state"):
            self.seat()

    def test_without_residual_cases_the_observation_alone_is_partitioned(self):
        (self.workspace / "state" / "residual-cases.json").unlink()
        answer = self.seat()
        checks = [key for package in self.active(answer).values() for key in package["cluster"]["checks"]]
        self.assertEqual(len(checks) + len(answer["uncovered"]), 14)
        self.assertEqual(len(set(checks)), len(checks))


class SeatClustersKnowledgeTest(unittest.TestCase):
    """The plan Workshop reaches the helper through knowledge example-campaign-plan.md's snippet, from the
    copy of this script the Harness ships for the Run's first reader."""

    def test_the_example_snippet_proposes_packages_the_plan_reader_admits(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        workspace, design = seat_workspace(tmp.name)
        shipped = workspace / "hima-readers" / "atcs-readiness" / "read-atcs.py"
        shipped.parent.mkdir(parents=True)
        shipped.write_bytes(READ_ATCS_PATH.read_bytes())
        text = (FLOW_DIR.parent / "knowledge" / "example-campaign-plan.md").read_text(encoding="utf-8")
        (code,) = re.findall(r"```python\n(.*?)\n```", text, re.S)
        here = workspace / "research" / "plan"
        here.mkdir(parents=True)
        names, saved = {}, list(sys.argv)
        sys.argv = ["entry.py", str(workspace), str(here)]
        try:
            exec(compile(code, "<example-campaign-plan.md>", "exec"), names)
        finally:
            sys.argv = saved
        plan = {"candidate": {"workPackages": names["packages"], "reason": "the Pack's clusters, worst first"},
                "baseState": design, "siteCapabilities": {"pgVerification": False}}
        report = _write(workspace / "research" / "requests" / "campaign-plan.json", json.dumps(plan))
        self.assertEqual(read_atcs.problems("campaign-plan", report, workspace), [])
        self.assertEqual(read_atcs.advice("campaign-plan", report, workspace), [])


if __name__ == "__main__":
    unittest.main()
