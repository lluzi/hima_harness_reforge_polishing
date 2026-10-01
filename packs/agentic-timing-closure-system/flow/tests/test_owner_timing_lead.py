"""Issue #66's three cheap admission checks. No model, SSH or commercial EDA.
Synthetic XTop only proves wiring; live common-state matching and QoR remain L4/experiment evidence.
"""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

TESTS = Path(__file__).resolve().parent
FLOW = TESTS.parent
ROOT = FLOW.parents[2]
sys.path[:0] = [str(FLOW), str(TESTS)]
import atcs_cli as cli
from atcs import adapters, core, workspaces
from test_cli_state import _make_baseline_manifest, _write_json, _write_xtop_context, _xtop_site_config
from test_worker_slots import _active
from test_xtop_toolkit import STUB_XTOP, TCLSH, PLAN
from test_batch_contribution import _seal
import session_fixtures as sf


class OwnerTimingLeadChecks(unittest.TestCase):
    def setUp(self):
        self.ws = Path(tempfile.mkdtemp(prefix="atcs-owner-lead-"))
        self.addCleanup(shutil.rmtree, self.ws, ignore_errors=True)
        manifest = _make_baseline_manifest(self.ws)
        (self.ws / "tech.lef").write_text("stub")
        (self.ws / "cells.lef").write_text("stub")
        (self.ws / "design.def").write_text("VERSION 5.8 ;\nEND DESIGN\n")
        manifest["def"] = "design.def"
        path = self.ws / "manifest.json"
        _write_json(path, manifest)
        self.assertEqual(cli.main(["baseline", str(self.ws), str(path)]), 0)
        self.base = cli._read_plain(self.ws / "state/working-state.json")
        site = _write_xtop_context(self.ws, self.base["id"], ("synthetic",))
        self.site = {**site, "design": "top", "techLef": str(self.ws / "tech.lef"),
                     "cellLefGlob": str(self.ws / "cells.lef"), "edaShell": ["never-called"]}
        self.site_path = self.ws / "site.json"
        _write_json(self.site_path, self.site)
        seed = self.ws / "research/observe/common-r1/r1-workspace"
        seed.mkdir(parents=True)
        (seed / "design.data").write_text("synthetic R1 state")
        self.common = {"parentStateId": self.base["id"], "stateId": "r1-semantic",
            "worklistId": "r1-residual", "seed": {"path": str(seed.relative_to(self.ws)), "digest": core.tree_digest(seed)},
            "cellStateDigest": core.digest({"U1": "BUFX1", "U2": "INVX1", "U3": "BUFX2", "UOUT": "BUFX1", "U9": "DFFX1"}),
            "summaries": {"setup": "native setup", "hold": "native hold"}, "endpoints": {"setup": [], "hold": ["U9/D"]},
            "analysisBoard": "research/observe/common-r1/residual-analysis", "experimentDeadline": 9999999999}
        _write_json(self.ws / "state/common-stage.json", self.common)
        self.packages = {slot: _active(slot, self.base["id"]) for slot in workspaces.TASK_IDS}
        for p in self.packages.values():
            instance = p["editDomain"]["instances"][0]
            p["editDomain"]["regions"] = [[0, 0, 100, 100]]
            p["targets"] = [f"synthetic|hold|{instance}/A"]
            p["targetPins"] = [f"{instance}/A"]
        campaign = self.ws / "research/requests/campaign-plan.json"
        _write_json(campaign, {"candidate": {"workPackages": self.packages}})
        out, workers = cli._cmd_prepare_workers(self.ws, [str(self.ws / "state/working-state.json"),
            str(self.site_path), str(self.site_path), str(campaign)])
        _write_json(out, workers)
        _write_json(self.ws / "state/worker-slots.json", {"workerSlots": 6})
        report = self.ws / "research/fix-strategy-risk.md"
        report.write_text("# Residual hold cluster\nTrial size U1; preserve setup. Lead rebase then size U3.\n")

    def stub_native_tool(self, site, command, cwd, log_path, **kwargs):
        # Execute the emitted production Tcl, replacing only the vendor's native commands.
        tcl = Path(command[-1])
        script = Path(cwd) / "vendor-fixture.tcl"
        text = 'set env(STUB_CALLS) "' + str(Path(cwd) / "vendor-calls.txt") + '"\n' + STUB_XTOP
        text += r"""
foreach name {create_corner create_scenario link_timing_library create_mode} { proc $name {args} {} }
rename redirect fixture_redirect
proc redirect {args} {
    if {[lindex $args 0] eq "-file"} {
        fixture_redirect -variable fixture_capture [lindex $args end]
        set fh [open [lindex $args 1] w]
        puts $fh $::fixture_capture
        close $fh
    } else { uplevel 1 [list fixture_redirect {*}$args] }
}
proc open_workspace {path} { stub_record open_workspace $path }
proc save_workspace {args} {
    stub_record save_workspace {*}$args
    set path [lindex $args [expr {[lsearch -exact $args -as] + 1}]]
    file mkdir $path
    set fh [open [file join $path design.data] w]
    puts $fh [array get ::cells]
    close $fh
}
proc get_setup_gba_violated_pins {args} { return {pin:U9/D} }
proc get_hold_gba_violated_pins {args} { return {pin:U9/D} }
array set ::stub_timing {U9/D,min {synthetic -0.07} U9/D,max {synthetic -0.02}}
proc write_design_changes {args} {
    set directory [lindex $args [expr {[lsearch -exact $args -output_dir] + 1}]]
    set prefix [lindex $args [expr {[lsearch -exact $args -eco_file_prefix] + 1}]]
    foreach role {netlist physical} {
        set fh [open [file join $directory ${prefix}_${role}_${::design}.txt] w]
        puts $fh [array get ::cells]
        close $fh
    }
}
"""
        if "xtop-repeat-control" in tcl.read_text() or "set stopped deadline" in tcl.read_text():
            text += r"""
set ::fixture_fix_count 0
proc fixture_default {name args} {
    stub_record $name {*}$args
    if {$::fixture_fix_count < 4} { stub_act {U1} }
    incr ::fixture_fix_count
}
proc fix_setup_gba_violations {args} { fixture_default fix_setup_gba_violations {*}$args }
proc fix_hold_gba_violations {args} { fixture_default fix_hold_gba_violations {*}$args }
"""
        script.write_text(text + "\n" + tcl.read_text())
        ran = subprocess.run([TCLSH, str(script)], capture_output=True, text=True)
        Path(log_path).write_text(ran.stdout + ran.stderr)
        self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)

    def test_all_six_manifests_seed_same_r1(self):
        workers = cli._read_plain(self.ws / "state/workers.json")
        self.assertEqual(workers["requiredSlots"], list(workspaces.TASK_IDS))
        for slot in workspaces.TASK_IDS:
            entry = workers["workers"][slot]
            seed = entry["workspaceManifest"]["xtopSeed"]
            self.assertEqual((seed["stateId"], seed["worklistId"], seed["digest"]),
                             ("r1-semantic", "r1-residual", self.common["seed"]["digest"]))
            text = (self.ws / entry["root"] / "operator.tcl").read_text()
            self.assertIn(str(self.ws / self.common["seed"]["path"]), text)
        # Execute the common native analysis/initial-fix/residual/save path before checking new seeds.
        (self.ws / "state/common-stage.json").unlink()
        shutil.rmtree(self.ws / "research/observe/common-r1")
        with patch.object(adapters, "run_tool", side_effect=self.stub_native_tool):
            out, common = cli._cmd_common_autofix(self.ws, [str(self.site_path)])
        _write_json(out, common)
        self.assertIn("synthetic|hold|U9/D", common["nativeChecks"])
        calls = (self.ws / "research/observe/common-r1/vendor-calls.txt").read_text().splitlines()
        analyzed = [i for i, line in enumerate(calls) if line.startswith("analyze_")]
        fixed = [i for i, line in enumerate(calls) if line.startswith("fix_")]
        self.assertEqual(len(fixed), 4)
        self.assertLess(analyzed[1], fixed[0]); self.assertLess(fixed[-1], analyzed[2])
        self.assertTrue(any(line.startswith("save_workspace") for line in calls))
        with patch.object(adapters, "run_tool", side_effect=AssertionError("must reuse completed common R1")):
            _, same = cli._cmd_common_autofix(self.ws, [str(self.site_path)])
        self.assertEqual(same["stateId"], common["stateId"])
        campaign = self.ws / "research/requests/campaign-plan.json"
        _, workers = cli._cmd_prepare_workers(self.ws, [str(self.ws / "state/working-state.json"),
            str(self.site_path), str(self.site_path), str(campaign)])
        _write_json(self.ws / "state/workers.json", workers)
        for entry in workers["workers"].values():
            self.assertEqual(entry["workspaceManifest"]["xtopSeed"]["stateId"], common["stateId"])
            self.assertEqual(entry["workspaceManifest"]["revision"], 2)
        # Live v27 w01 wrote before.dump only after its 14 edits. Execute the
        # same ordering through the emitted Operator, then seal the real slot.
        entry = workers["workers"]["w01"]
        root = self.ws / entry["root"]
        counter = root / "late-before-counter.tcl"
        counter.write_text(Path(entry["sessionTcl"]).read_text() + f'''
set baseline_at_ready [file exists [file join $::operator_root before.dump]]
atcs_size_cell U1 BUFX2 {PLAN}
atcs_dump_cells before.dump
set baseline_path [file join $::operator_root before.dump]
file copy $baseline_path [file join $::operator_root retained-before-fixture.dump]
file delete $baseline_path
set missing_refused [catch {{atcs_dump_cells before.dump}}]
set missing_recreated [file exists $baseline_path]
file rename [file join $::operator_root retained-before-fixture.dump] $baseline_path
set proof [open [file join $::operator_root missing-before-proof.txt] w]
puts $proof "$missing_refused $missing_recreated"
close $proof
atcs_dump_cells after.dump
atcs_export_changes "late before.dump counter"
atcs_close
set fh [open [file join $::operator_root baseline-at-ready.txt] w]
puts $fh $baseline_at_ready
close $fh
''')
        self.stub_native_tool(self.site, ["fixture", str(counter)], root, root / "xtop_log_fixture.txt")
        before = cli.contributions.parse_cell_dump((root / "before.dump").read_text())
        after = cli.contributions.parse_cell_dump((root / "after.dump").read_text())
        self.assertEqual(core.digest(before), common["cellStateDigest"])
        self.assertEqual((before["U1"], after["U1"]), ("BUFX1", "BUFX2"))
        self.assertEqual((root / "baseline-at-ready.txt").read_text().strip(), "1")
        self.assertEqual((root / "missing-before-proof.txt").read_text().strip(), "1 0")
        self.assertEqual(cli.main(["capture-contribution", str(self.ws), "w01"]), 0)
        seed_path = self.ws / common["seed"]["path"] / "design.data"
        seed_path.write_text("wrong R1")
        with self.assertRaisesRegex(core.AtcsError, "saved common R1 bytes changed"):
            cli._verified_xtop_context(self.ws, self.base["id"], self.site)

    @unittest.skipUnless(TCLSH, "tclsh required")
    def test_lead_replay_own_mutation_final_eco_is_implement_input(self):
        workers = cli._read_plain(self.ws / "state/workers.json")
        entry = workers["workers"]["w01"]
        ref = {"stateId": self.base["id"], "workspaceManifest": entry["workspaceManifest"], "workPackage": entry["workPackage"]}
        initial = {"U1": "BUFX1", "U2": "INVX1", "U3": "BUFX2", "UOUT": "BUFX1", "U9": "DFFX1"}
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(((-.02,-.1),(-.02,-.1)), ((-.07,-1.2),(-.06,-1.0))))
        contribution = _seal(log, {**initial, "U1": "BUFX2"}, before=initial, domain=None, base_ref=ref, required=())
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        # Real v25 L4: derived get_attribute bus-net names carry Tcl brace quoting. They
        # remain in the sealed evidence, but cannot become a strictly validated lead target.
        contribution = core.stamp("contribution", {**{k: v for k, v in contribution.items() if k not in ("schema", "id")},
            "effectiveDomain": {"instances": ["U1"], "nets": ["N1", "{swerv_dma_ctrl/dma_axi_wstrb[1]}"],
                                "targetPins": ["U1/A"], "regions": [[0, 0, 100, 100]]}})
        _write_json(self.ws / "state/contributions-collected.json", {"contributions": [contribution]})
        plan = {"batchId": "owner-lead-test", "baseStateId": self.base["id"], "select": [contribution["id"]],
                "resolutions": [], "deferred": [], "reason": "Merge and add measured U3 trial", "autoFinish": False}
        _write_json(self.ws / "research/requests/integration-plan.json", {"plan": plan})
        out, brief = cli._cmd_prepare_lead(self.ws, [str(self.site_path)])
        _write_json(out, brief)
        self.assertEqual(brief["planSha256"], core.file_sha256(self.ws / "research/requests/integration-plan.json"))
        self.assertEqual(brief["namePrefix"], "atcs_lead_r1_")
        self.assertEqual(brief["scope"]["maxMutations"], workspaces.SCOPE_MAX_MUTATIONS)
        self.assertIn("{swerv_dma_ctrl/dma_axi_wstrb[1]}", brief["derivedDomainDropped"]["nets"])
        root = self.ws / brief["leadRoot"]
        self.assertEqual(workers["requiredSlots"], list(workspaces.TASK_IDS))
        # Same Tcl process performs R1 clone, worker replay, then one integrator mutation and close.
        script = self.ws / "session.tcl"
        text = 'set env(STUB_CALLS) "' + str(self.ws / "calls.txt") + '"\n' + STUB_XTOP
        text += '\nproc open_workspace {path} { stub_record open_workspace $path }\n'
        text += r"""
proc write_design_changes {args} {
    stub_record write_design_changes {*}$args
    set directory [lindex $args [expr {[lsearch -exact $args -output_dir] + 1}]]
    set prefix [lindex $args [expr {[lsearch -exact $args -eco_file_prefix] + 1}]]
    foreach kind {netlist physical} {
        set out [open [file join $directory ${prefix}_${kind}_${::design}.txt] w]
        puts $out [array get ::cells]
        close $out
    }
}
"""
        text += (root / "xtop-analysis-manual.tcl").read_text()
        text += f'\natcs_size_cell U3 BUFX4 {PLAN}\natcs_gain hold 10\natcs_export_changes "synthetic lead final"\natcs_close\n'
        script.write_text(text)
        ran = subprocess.run([TCLSH, str(script)], capture_output=True, text=True)
        (root / "xtop_log_fixture.txt").write_text(ran.stdout + ran.stderr)
        self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)
        ops = [json.loads(l) for l in (root / "ops.jsonl").read_text().splitlines()]
        self.assertEqual([op["args"].get("instance") for op in ops if op["status"] == "kept"], ["U1", "U3"])
        self.assertEqual(sum('open_workspace' in l for l in (self.ws / "calls.txt").read_text().splitlines()), 1)
        out, final = cli._cmd_finalize_lead(self.ws, [])
        _write_json(out, final)
        merge = cli._read_plain(self.ws / "state/merge-commit.json")
        self.assertFalse(merge["autoFinish"])
        self.assertIn(contribution["id"], [c["id"] for c in merge["contributions"]])
        self.assertIsNotNone(merge["leadContributionId"])
        captured = []
        def implement_tool(site, command, cwd, log_path, **kwargs):
            # Fixture only replaces commercial Innovus; real adapter performs copies/hash verification.
            captured.extend((Path(cwd) / "eco").glob("*.tcl"))
            task = adapters.compile_innovus_eco_task(merge, self.ws / self.base["database"]["path"], "top", cwd, self.ws)
            for name, file in task["outputs"].items():
                file = Path(file); file.parent.mkdir(parents=True, exist_ok=True); file.write_text("synthetic " + name)
                if name == "database":
                    dat = Path(str(file) + ".dat"); dat.mkdir(); (dat / "data").write_text("synthetic database")
        with patch.object(adapters, "run_tool", side_effect=implement_tool):
            _, implemented = cli._cmd_implement(self.ws, [str(self.ws / "state/working-state.json"), str(self.site_path)])
        self.assertEqual(implemented["mergeCommitId"], merge["id"])
        for ref in final["eco"].values():
            self.assertIn(ref["sha256"], [core.file_sha256(file) for file in captured])
        source = self.ws / final["eco"]["netlist"]["path"]
        self.assertIn("U1 BUFX2", source.read_text())
        self.assertIn("U3 BUFX4", source.read_text())
        source.write_text(source.read_text() + "changed")
        # Remove the simulated prior marker so this tests the changed source, not write-once.
        (self.ws / "implementations" / merge["id"] / "merge-commit.json").unlink()
        with self.assertRaises(core.AtcsError):
            cli._cmd_implement(self.ws, [str(self.ws / "state/working-state.json"), str(self.site_path)])

    def test_graph_contract_smoke(self):
        node = "/Users/lluzi/.local/node24/bin/node"
        script = """
import assert from 'node:assert/strict';
import { loadPack } from '@hima/harness';
const pack = loadPack('packs', 'agentic-timing-closure-system');
assert.equal(pack.contract.version, '0.2.6');
const edges=pack.graph.edges;
const to=id=>edges.filter(e=>e.from===id).map(e=>e.to);
assert.deepEqual(to('common-autofix'), ['read-refresh-budget']);
assert.deepEqual(to('compose'), ['prepare-lead']);
assert.deepEqual(to('prepare-lead'), ['timing-lead']);
assert.deepEqual(to('timing-lead'), ['finalize-lead']);
assert.deepEqual(to('finalize-lead'), ['implement']);
assert.deepEqual(to('implement'), ['extract']);
assert.deepEqual(to('extract'), ['sta']);
assert.equal(edges.some(e=>['presta','replay-prepare','reconcile'].includes(e.to)),false);
assert.equal(pack.contract.strategy.autoFinish.max,0);
assert.equal(pack.contract.agentTeams.length,6);
console.log('graph/contract PASS: six fork branches, owner lead, direct physical referee');
"""
        ran = subprocess.run([node, "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)
        import datetime, re
        from zoneinfo import ZoneInfo
        wrapper = (ROOT / "sites/linglong-atcs28/atcs-xtop-operator-v26.sh").read_text()
        zone = re.search(r"(?m)^\s+-e TZ=([A-Za-z_/]+)\s+\\$", wrapper)
        self.assertIsNotNone(zone, "private saved R1 must recover in the batch Site's timezone")
        # Source: current v24 lead L4 library-identity.json, tech LEF unchanged mtime epoch.
        epoch, saved = 1736302054, "2025-01-07T18:07:34"
        observed = datetime.datetime.fromtimestamp(epoch, ZoneInfo(zone.group(1))).strftime("%Y-%m-%dT%H:%M:%S")
        self.assertEqual(observed, saved)
        self.assertNotEqual(datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"), saved)
        _write_json(self.ws / "state/worker-slots.json", {"workerSlots": 0})
        _write_json(self.ws / "state/contributions-collected.json", {"contributions": []})
        _write_json(self.ws / "research/requests/integration-plan.json", {"plan": {
            "batchId": "strong-control", "baseStateId": self.base["id"], "select": [],
            "resolutions": [], "deferred": [], "reason": "fresh strong control"}})
        with patch.object(adapters, "run_tool", side_effect=self.stub_native_tool):
            out, brief = cli._cmd_prepare_lead(self.ws, [str(self.site_path)])
        _write_json(out, brief)
        result = cli._read_plain(self.ws / brief["controlRoot"] / "control-result.json")
        self.assertEqual(result["stopped"], "no-change")
        self.assertEqual(len(result["rounds"]), 2)
        self.assertEqual(sum(len(r["commands"]) for r in result["rounds"]), 8)
        with patch.object(adapters, "run_tool", side_effect=AssertionError("must not repeat completed C0")):
            _, same = cli._cmd_prepare_lead(self.ws, [str(self.site_path)])
        self.assertEqual(same, brief)
        _, final = cli._cmd_finalize_lead(self.ws, [])
        self.assertTrue(final["control"])
        self.assertFalse(final["finalAutoFinish"])

if __name__ == '__main__':
    unittest.main()
