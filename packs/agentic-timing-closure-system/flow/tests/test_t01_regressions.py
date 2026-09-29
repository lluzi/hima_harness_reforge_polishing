"""Regressions from the #64 treatment attempt 1 (run-9a5f197a, Pack 0.2.0 at 12950dac).

The retained Run documents are in `live_fixtures/` (see its README): each test reads them as the
Run wrote them and changes only what the case names. The Site's design files stayed on the Site, so
the tests stub `read-atcs.py`'s design-file re-hash (`_verify_design_state_refs`) and nothing else,
and write a stand-in netlist and Liberty file at the paths the retained working state and a sealed
XTop context name. Stand-in masters: `SDFCNQARD1BWP35P140` of
`swerv_ifu/mem_ctl/miss_state_ff_dffs_dout_reg_2_` is proven by w03's session (it sized it to
`SDFCNQD2BWP35P140` and undid it); the other masters are assumed and follow the Site's sizing pattern
`D([0-9]+)BWP`.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_t01_regressions.py -v
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from test_readers import _make_workspace, _prepare_slot, _write, read_atcs  # noqa: E402

LIVE = TESTS_DIR / "live_fixtures"
CONTRACT = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
SLOTS = ("01", "02", "03", "04", "05", "06")

# The retained bytes (Ledger observation records #144 and #254).
T01_W01_SHA256 = "649ca0d5a31842d3953ee61375bbe4ba8f2822147afa212ece61cfad83c2a0e8"
T01_W03_SHA256 = "0a434f5f1950e19d40f3e24a288cc512bfbdb48e9d9a96c7866cfe1f23ed2eb0"

W01_REG = "swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_"
W02_REG = "swerv_ifu/mem_ctl/miss_state_ff_dffs_dout_reg_0_"
W03_REG = "swerv_ifu/mem_ctl/miss_state_ff_dffs_dout_reg_2_"

# The Site's ecoParameters (sites/linglong-atcs28/inputs/siteCapabilities-v4.json).
SITE_ECO = {
    "bufferListForHold": ["DEL025D1BWP30P140", "BUFFD2BWP30P140"], "bufferListForSetup": ["BUFFD2BWP30P140"],
    "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
    "cellNominalSwapKeywords": ["ULVT", "LVT", "", "HVT"], "cellNominalSizingPattern": "D([0-9]+)BWP",
    "gainThreshold": 0.001,
}
LIBRARY = ("SDFCNQD1BWP35P140", "SDFCNQD2BWP35P140", "SDFCNQD4BWP35P140", "SDFCNQARD1BWP35P140",
           "SDFCNQARD2BWP35P140", "SDFCNQARD4BWP35P140", "SDFCNQARD2BWP35P140LVT", "BUFFD2BWP30P140")
MASTERS = {W01_REG: "SDFCNQD1BWP35P140", W02_REG: "SDFCNQARD1BWP35P140", W03_REG: "SDFCNQARD1BWP35P140"}


def standin_netlist(top, leaves):
    """A structural netlist under `top` holding each `{path: master}` leaf, one module per level."""
    modules = {top: {}}
    for path, master in leaves.items():
        parts = path.split("/")
        module = top
        for depth, part in enumerate(parts[:-1]):
            child = "m_" + "_".join(parts[:depth + 1])
            modules[module][part] = child
            modules.setdefault(child, {})
            module = child
        modules[module][parts[-1]] = master
    text = []
    for name, instances in modules.items():
        text.append(f"module {name} (clk);")
        text += [f"  {kind} {instance} (.CP(clk));" for instance, kind in instances.items()]
        text.append("endmodule")
    return "\n".join(text) + "\n"


def t01_workspace(root, leaves=None, library=LIBRARY):
    """A Campaign workspace holding attempt 1's working state, a stand-in netlist at its path and a
    sealed XTop context over a stand-in Liberty file."""
    workspace = _make_workspace(root)
    working = json.loads((LIVE / "live02-working-state.json").read_text())
    _write(workspace / "state" / "working-state.json", (LIVE / "live02-working-state.json").read_text())
    _write(workspace / working["netlist"]["path"], standin_netlist(working["top"], leaves or MASTERS))
    liberty = _write(Path(root) / "libs" / "tcbn28_ssg.lib",
                     "library(standin) {\n" + "".join(f"  cell ({name}) {{}}\n" for name in library) + "}\n")
    files = [{"path": str(liberty), "sha256": core.file_sha256(liberty)}]
    context = core.stamp("xtop-context", {
        "designStateId": working["id"], "requiredScenarios": working["scenarios"],
        "libraryFiles": {scenario: files for scenario in working["scenarios"]},
        "ecoParameters": dict(SITE_ECO), "siteMap": ["unit", "core"], "removableFillers": ["FILL*"],
    })
    core.write_artifact(workspace / "state" / "xtop-context.json", context)
    return workspace, working


class T01Workspace(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace, self.working = t01_workspace(self.tmp.name)
        patcher = mock.patch.object(read_atcs, "_verify_design_state_refs", lambda *args, **kwargs: None)
        patcher.start()
        self.addCleanup(patcher.stop)
        read_atcs._netlist_hierarchy_cache.clear()

    def request(self, slot):
        document = json.loads((LIVE / f"t01-worker-request-w{slot}.json").read_text())
        _prepare_slot(self.workspace, document["candidate"])
        return document

    def problems(self, slot, document):
        report = _write(self.workspace / "research" / "requests" / f"worker-request-w{slot}.json", json.dumps(document))
        found = read_atcs.problems("worker-request", report, self.workspace, f"w{slot}")
        (value,) = read_atcs.read("worker-request", report, self.workspace, [f"w{slot}"])
        self.assertEqual(value["value"], len(found), found)
        return found


def size_entry(document):
    (index,) = [i for i, entry in enumerate(document["sessionPlan"]) if entry["command"] == "atcs_size_cell"]
    return index, document["sessionPlan"][index]


class SizeMoveMasterTest(T01Workspace):
    """C13 (#63) on the six-slot 0.2.0 request, from attempt 1's w01 and w03.

    w01's Operator sized its register to 'SDGCNQOPTMC D12BWP30P140', two columns of atcs_candidates
    joined, and XTop refused it twice as an invalid library cell (two approved mutations spent). w03
    sized SDFCNQARD1BWP35P140 to SDFCNQD2BWP35P140, which drops the asynchronous reset, and undid it.
    Both requests' size entries named no master: the Reader admitted them at 0 (Ledger #144, #254).
    RED on 12950dac: every counted case below read 0.
    """

    def test_the_fixtures_are_the_retained_requests(self):
        for slot, digest in (("01", T01_W01_SHA256), ("03", T01_W03_SHA256)):
            self.assertEqual(hashlib.sha256((LIVE / f"t01-worker-request-w{slot}.json").read_bytes()).hexdigest(), digest)

    def test_a_size_entry_without_its_master_is_counted_and_told_where_masters_come_from(self):
        for slot, reg in (("01", W01_REG), ("03", W03_REG)):
            with self.subTest(slot=slot):
                index, _entry = size_entry(self.request(slot))
                (line,) = self.problems(slot, self.request(slot))
                self.assertTrue(line.startswith(f"sessionPlan[{index}].toMaster (slot w{slot}): missing"), line)
                self.assertIn(reg, line)
                for source in ("libraryFiles", "cellNominalSizingPattern", "no cell table", "read-atcs.py masters"):
                    self.assertIn(source, line)

    def test_the_joined_columns_w01_sent_are_counted(self):
        document = self.request("01")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDGCNQOPTMC D12BWP30P140"
        (line,) = self.problems("01", document)
        self.assertRegex(line, rf"^sessionPlan\[{index}\]\.toMaster \(slot w01\): 'SDGCNQOPTMC D12BWP30P140' is not one "
                               "plain cell name")

    def test_a_master_outside_the_libraries_is_counted(self):
        document = self.request("01")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDGCNQOPTMCD12BWP30P140"
        (line,) = self.problems("01", document)
        self.assertIn(f"sessionPlan[{index}].toMaster (slot w01): 'SDGCNQOPTMCD12BWP30P140' is not a cell of this "
                      "design's libraries", line)

    def test_the_flop_swap_w03_tried_changes_the_function(self):
        document = self.request("03")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDFCNQD2BWP35P140"
        (line,) = self.problems("03", document)
        self.assertIn(f"sessionPlan[{index}].toMaster (slot w03): 'SDFCNQD2BWP35P140' changes the cell function "
                      "'SDFCNQARD'", line)

    def test_a_same_function_resize_or_vt_swap_is_admitted(self):
        for master in ("SDFCNQARD2BWP35P140", "SDFCNQARD2BWP35P140LVT"):
            with self.subTest(master=master):
                document = self.request("03")
                size_entry(document)[1]["toMaster"] = master
                self.assertEqual(self.problems("03", document), [])

    def test_the_current_master_is_counted(self):
        document = self.request("03")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDFCNQARD1BWP35P140"
        (line,) = self.problems("03", document)
        self.assertIn("is already the master of", line)

    def test_a_size_entry_outside_the_edit_domain_is_counted(self):
        document = self.request("03")
        index, entry = size_entry(document)
        entry.update(object=W02_REG, toMaster="SDFCNQARD2BWP35P140")
        (line,) = self.problems("03", document)
        self.assertTrue(line.startswith(f"sessionPlan[{index}].object (slot w03): "), line)

    def test_a_context_for_another_state_is_one_problem(self):
        path = self.workspace / "state" / "xtop-context.json"
        body = {k: v for k, v in json.loads(path.read_text()).items() if k not in ("schema", "id")}
        body["designStateId"] = "0" * 20
        core.write_artifact(path, core.stamp("xtop-context", body))
        document = self.request("03")
        size_entry(document)[1]["toMaster"] = "SDFCNQARD2BWP35P140"
        (line,) = self.problems("03", document)
        self.assertIn("no toMaster can be checked", line)
        self.assertIn("observe first", line)

    def test_the_masters_command_lists_the_same_function_only(self):
        instances = _write(self.workspace / "research" / "worker-03" / "instances.json", json.dumps([W03_REG, "swerv_ifu"]))
        out = self.workspace / "research" / "worker-03" / "masters.json"
        with mock.patch.object(sys, "argv", ["read-atcs.py", "masters", str(self.workspace), str(instances), str(out)]):
            with mock.patch.object(read_atcs, "_require_file", lambda *args, **kwargs: None):
                read_atcs.main()
        answer = json.loads(out.read_text())
        (row,) = answer["masters"]
        self.assertEqual((row["instance"], row["master"], row["function"]), (W03_REG, "SDFCNQARD1BWP35P140", "SDFCNQARD"))
        self.assertEqual(row["toMasters"], ["SDFCNQARD2BWP35P140", "SDFCNQARD2BWP35P140LVT", "SDFCNQARD4BWP35P140"])
        (unresolved,) = answer["unresolved"]
        self.assertIn("module instance", unresolved["unresolved"])


class SizeMoveGuidanceTest(unittest.TestCase):
    """#63 live finding #250: the researcher looked for the cell table in xtop-context.json. The
    Workshop, the knowledge and the Operator say where a master comes from and in what form."""

    def test_each_research_workshop_says_where_the_masters_come_from(self):
        for slot in SLOTS:
            block = CONTRACT.split(f"  - id: research-worker-{slot}\n", 1)[1].split("\n  - id: ", 1)[0]
            with self.subTest(slot=slot):
                for words in ("toMaster", "libraryFiles", "cell (NAME)", "cellNominalSizingPattern", "no cell table",
                              "hima-readers/atcs-readiness/read-atcs.py masters"):
                    self.assertIn(words, block)

    def test_the_example_size_entry_names_its_master(self):
        text = (PACK_DIR / "knowledge" / "example-worker-request.md").read_text()
        self.assertIn('"toMaster"', text)
        self.assertIn("cellNominalSizingPattern", text)

    def test_each_operator_types_one_library_cell_name(self):
        for slot in SLOTS:
            team = CONTRACT.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("\n  - id: atcs-worker-", 1)[0]
            operator = team.split("      - id: operator\n", 1)[1]
            with self.subTest(slot=slot):
                self.assertIn("toMaster", operator)
                self.assertIn("never join two columns", operator)
                self.assertIn("invalid library cell", operator)


if __name__ == "__main__":
    unittest.main()
