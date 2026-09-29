"""C22 (failure catalogue): PT endpoints resolve to netlist instances deterministically.

Fresh03, PR02 and PR03 each rewrote an endpoint-to-instance resolver in model-authored
Workshop code and lost 2-4 attempts plus revisions to the same shapes. The endpoint
shapes that code got wrong were: flattened versus hierarchical names, bus spellings,
net versus pin versus port, instantiations spanning lines, and a 400k-line read cap.

The resolver is `resolve_endpoints` in `tools/read-atcs.py`, beside the netlist parser
the Readers use, so what it resolves is exactly what the Readers admit. It runs as
`read-atcs.py resolve-instances WORKSPACE ENDPOINTS OUT`. A Workshop reaches it through the
copy the Harness ships for the first reader of every Run
(`<workspace>/hima-readers/atcs-readiness/read-atcs.py`); see knowledge
endpoint-resolution.md.

The fixture netlist is cut to the retained shapes named in the catalogue. The real
netlist stays on the Site, so the cell and net names are the retained ones and the
module bodies are reduced to what each case needs.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_endpoint_resolution.py -v
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

from test_readers import READ_ATCS_PATH, _build_design_state, _make_workspace, _write, read_atcs  # noqa: E402

SWERV_NETLIST = (
    "// shapes retained from Fresh03, PR02 and PR03 (C22)\n"
    "module swerv_wrapper ( sb_x, clk, dout );\n"
    "  input sb_x;\n"
    "  input clk;\n"
    "  output dout;\n"
    "  wire [1:0] dec_tlu_perfcnt0;\n"
    "  dec_tlu swerv_dec_tlu ( .clk(clk), .perfcnt0(dec_tlu_perfcnt0) );\n"
    "  dbg swerv_dbg ( .clk(clk) );\n"
    "  pic u_pic ( .cnt(dec_tlu_perfcnt0), .sb(sb_x), .dout(dout) );\n"
    "endmodule\n"
    "module dec_tlu ( clk, perfcnt0 );\n"
    "  input clk;\n"
    "  output [1:0] perfcnt0;\n"
    "  wire n1, n2;\n"
    "  CKAN2D2BWP35P140HVT g96219 ( .A1(clk), .A2(n1), .Z(perfcnt0[0]) );\n"
    "  CKAN2D2BWP35P140HVT\n"
    "      g96216 ( .A1(clk),\n"
    "               .A2(n2),\n"
    "               .Z(perfcnt0[1]) );\n"
    "  DFQD1BWP35P140 \\dout_reg[15]  ( .D(n1), .CP(clk), .Q(q15) );\n"
    "  DFQD1BWP35P140 \\u_a/u_b/reg_0_  ( .D(n2), .CP(clk), .Q(q16) );\n"
    "  DFQD1BWP35P140 ifu_bp_reg_0_ ( .D(n1), .CP(clk), .Q(q0) );\n"
    "  DFQD1BWP35P140 ic_tag_1 ( .D(n2), .CP(clk), .Q(q1) );\n"
    "  /* a block comment\n"
    "     spanning lines */ BUFFD1BWP35P140 u_buf ( .I(q0), .Z(n1) );\n"
    "endmodule\n"
    "module dbg ( clk );\n"
    "  input clk;\n"
    "  DFQD1BWP35P140 r0 ( .D(clk), .CP(clk), .Q(q) );\n"
    "endmodule\n"
    "module pic ( cnt, sb, dout );\n"
    "  input [1:0] cnt;\n"
    "  input sb;\n"
    "  output dout;\n"
    "  CKAN2D2BWP35P140HVT g1 ( .A1(cnt[0]), .A2(sb), .Z(dout) );\n"
    "endmodule\n"
)


class _Fixture(unittest.TestCase):
    netlist = SWERV_NETLIST

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace, netlist_text=self.netlist)
        _write(self.workspace / "state" / "working-state.json", json.dumps(self.design))

    def _resolve(self, *endpoints):
        answer = read_atcs.resolve_endpoints(self.workspace, list(endpoints))
        return {row["endpoint"]: row for row in answer["resolved"] + answer["unresolved"]}


class EndpointResolutionTest(_Fixture):
    """The seven catalogued shapes, each resolved to a full hierarchical leaf instance the
    worker-request Reader admits, or named unresolved with its reason."""

    def setUp(self):
        super().setUp()
        # The fixture design's top is the wrapper, as on the real post-route netlist.
        from atcs import core
        body = {k: v for k, v in self.design.items() if k not in ("schema", "id")}
        body["top"] = "swerv_wrapper"
        self.design = core.stamp("design-state", body)
        _write(self.workspace / "state" / "working-state.json", json.dumps(self.design))

    def _admitted(self, instance):
        hierarchy = read_atcs._netlist_hierarchy(self.workspace / self.design["netlist"]["path"])
        self.assertTrue(read_atcs._is_hierarchical_instance(hierarchy, "swerv_wrapper", instance), instance)
        kind = read_atcs._instance_type(hierarchy, "swerv_wrapper", instance)
        self.assertNotIn(kind, hierarchy, f"{instance} is a leaf cell")

    def test_1_an_instantiation_spanning_lines_resolves(self):
        row = self._resolve("swerv_dec_tlu/g96216/Z")["swerv_dec_tlu/g96216/Z"]
        self.assertEqual((row["instance"], row["cell"], row["pin"]), ("swerv_dec_tlu/g96216", "CKAN2D2BWP35P140HVT", "Z"))
        self._admitted(row["instance"])
        row = self._resolve("swerv_dec_tlu/u_buf/I")["swerv_dec_tlu/u_buf/I"]
        self.assertEqual(row["instance"], "swerv_dec_tlu/u_buf", "an instance after a block comment")

    def test_2_escaped_identifiers_resolve_including_a_flattened_name(self):
        rows = self._resolve("swerv_dec_tlu/dout_reg[15]/D", "swerv_dec_tlu/u_a/u_b/reg_0_/CP")
        self.assertEqual(rows["swerv_dec_tlu/dout_reg[15]/D"]["instance"], "swerv_dec_tlu/dout_reg[15]")
        flattened = rows["swerv_dec_tlu/u_a/u_b/reg_0_/CP"]
        self.assertEqual(flattened["instance"], "swerv_dec_tlu/\\u_a/u_b/reg_0_ ")
        self.assertEqual(flattened["pin"], "CP")
        for row in rows.values():
            self._admitted(row["instance"])

    def test_3_bus_spellings_resolve_each_way(self):
        rows = self._resolve("swerv_dec_tlu/ifu_bp_reg[0]/CP", "swerv_dec_tlu/ic_tag[1]/D", "swerv_dec_tlu/dout_reg_15_/Q")
        self.assertEqual(rows["swerv_dec_tlu/ifu_bp_reg[0]/CP"]["instance"], "swerv_dec_tlu/ifu_bp_reg_0_")
        self.assertEqual(rows["swerv_dec_tlu/ic_tag[1]/D"]["instance"], "swerv_dec_tlu/ic_tag_1")
        self.assertEqual(rows["swerv_dec_tlu/dout_reg_15_/Q"]["instance"], "swerv_dec_tlu/dout_reg[15]")
        for row in rows.values():
            self._admitted(row["instance"])

    def test_4_a_net_endpoint_resolves_to_its_driver_through_the_port_connections(self):
        row = self._resolve("dec_tlu_perfcnt0[0]")["dec_tlu_perfcnt0[0]"]
        self.assertEqual((row["instance"], row["pin"], row["via"]), ("swerv_dec_tlu/g96219", "Z", "net-driver"))
        self._admitted(row["instance"])
        row = self._resolve("dec_tlu_perfcnt0[1]")["dec_tlu_perfcnt0[1]"]
        self.assertEqual(row["instance"], "swerv_dec_tlu/g96216")

    def test_5_a_top_port_is_unresolved_as_a_primary_port(self):
        row = self._resolve("sb_x")["sb_x"]
        self.assertIsNone(row.get("instance"))
        self.assertIn("primary port", row["unresolved"])

    def test_6_a_module_instance_is_unresolved_as_not_a_leaf(self):
        row = self._resolve("swerv_dbg")["swerv_dbg"]
        self.assertIsNone(row.get("instance"))
        self.assertIn("module instance, not a leaf cell", row["unresolved"])

    def test_an_absent_name_is_unresolved_and_says_where_it_looked(self):
        row = self._resolve("swerv_dec_tlu/no_such_reg/D")["swerv_dec_tlu/no_such_reg/D"]
        self.assertIn("no_such_reg", row["unresolved"])
        self.assertIn("dec_tlu", row["unresolved"])

    def test_the_command_writes_the_resolution_beside_the_design_state_it_used(self):
        endpoints = self.workspace / "research" / "plan" / "endpoints.json"
        _write(endpoints, json.dumps(["swerv_dec_tlu/g96216/Z", "sb_x"]))
        out = self.workspace / "research" / "plan" / "resolved.json"
        result = subprocess.run([sys.executable, str(READ_ATCS_PATH), "resolve-instances", str(self.workspace),
                                 str(endpoints), str(out)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        answer = json.loads(out.read_text())
        self.assertEqual(answer["designStateId"], self.design["id"])
        self.assertEqual(answer["netlist"], self.design["netlist"])
        self.assertEqual([row["instance"] for row in answer["resolved"]], ["swerv_dec_tlu/g96216"])
        self.assertEqual([row["endpoint"] for row in answer["unresolved"]], ["sb_x"])

    def test_a_changed_netlist_is_refused_by_the_command(self):
        (self.workspace / self.design["netlist"]["path"]).write_text("module swerv_wrapper; endmodule\n")
        out = self.workspace / "resolved.json"
        endpoints = _write(self.workspace / "endpoints.json", json.dumps(["sb_x"]))
        result = subprocess.run([sys.executable, str(READ_ATCS_PATH), "resolve-instances", str(self.workspace),
                                 str(endpoints), str(out)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sha256 mismatch", result.stderr)
        self.assertFalse(out.exists())


class ResolverReachesTheWorkshopTest(_Fixture):
    """The resolver is usable where it is needed: the Readers see the same instances, and the
    path the knowledge gives a Workshop is where the Harness ships this script."""

    PACK_DIR = TESTS_DIR.parent.parent

    def test_the_readers_hierarchy_is_the_resolvers(self):
        path = self.workspace / self.design["netlist"]["path"]
        fast = read_atcs._parse_netlist(path)
        full = read_atcs._parse_netlist(path, connections=True)
        self.assertEqual({m: v["instances"] for m, v in fast.items()}, {m: v["instances"] for m, v in full.items()})
        self.assertIn("g96216", fast["dec_tlu"]["instances"], "a multi-line instantiation is a Reader instance too")

    def test_the_documented_command_path_is_the_runs_first_reader(self):
        import re
        graph = (self.PACK_DIR / "graph.yml").read_text(encoding="utf-8")
        contract = (self.PACK_DIR / "contract.yml").read_text(encoding="utf-8")
        reader = (self.PACK_DIR / "readers" / "atcs-readiness.yml").read_text(encoding="utf-8")
        knowledge = (self.PACK_DIR / "knowledge" / "endpoint-resolution.md").read_text(encoding="utf-8")
        self.assertRegex(graph, r"(?m)^entry: bind-inputs$")
        self.assertIn("  - { from: bind-inputs, to: read-readiness }\n", graph)
        self.assertIn("  - id: read-readiness\n    kind: act\n    parameters: { observes: inputReadiness }\n", graph)
        self.assertRegex(contract, r"  - name: inputReadiness\n    path: [^\n]+\n    reader: atcs-readiness\n")
        self.assertIn("file: tools/read-atcs.py\n", reader)
        self.assertIn('workspace / "hima-readers" / "atcs-readiness" / "read-atcs.py"', knowledge)
        self.assertIn('"resolve-instances"', knowledge)

    def test_the_plan_and_worker_purposes_point_at_the_resolver(self):
        contract = (self.PACK_DIR / "contract.yml").read_text(encoding="utf-8")
        for workshop in ("plan-campaign", "research-worker-01", "research-worker-02", "research-worker-03"):
            body = contract.split(f"  - id: {workshop}\n", 1)[1].split("\n  - id: ", 1)[0]
            with self.subTest(workshop=workshop):
                self.assertIn("knowledge endpoint-resolution.md", " ".join(body.split()))
                self.assertIn("endpoint-resolution.md]", body)


class LargeNetlistTest(_Fixture):
    """7: PR02's model-written resolver capped its read at 400k lines and found 0 candidates."""

    COUNT = 410_000
    netlist = ("module top ( clk );\n  input clk;\n"
               + "".join(f"  DFQD1BWP35P140 r{i} ( .D(clk), .CP(clk), .Q(q{i}) );\n" for i in range(COUNT))
               + "endmodule\n")

    def test_7_an_instance_past_line_400k_resolves(self):
        last = f"r{self.COUNT - 1}"
        row = self._resolve(f"{last}/D")[f"{last}/D"]
        self.assertEqual(row["instance"], last)


if __name__ == "__main__":
    unittest.main()
