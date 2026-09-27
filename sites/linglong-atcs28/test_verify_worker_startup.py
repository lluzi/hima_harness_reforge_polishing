"""Administrator-verifier falsifiers. Real Pack compilers, synthetic inputs, no EDA or SSH."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import os

REPO = Path(__file__).resolve().parents[2]
FLOW = REPO / "packs/agentic-timing-closure-system/flow"
sys.path.insert(0, str(FLOW))
from atcs import core, adapters, state, workspaces

VERIFIER = Path(__file__).with_name("verify-worker-startup.py")
spec = importlib.util.spec_from_file_location("admin_verifier", VERIFIER)
verify_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_module)

class VerifierTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.w = self.root / "workspace"
        self.w.mkdir()
        self.admin = self.root / "admin"
        self.admin.mkdir()
        shutil.copytree(FLOW, self.w / "flow", ignore=shutil.ignore_patterns("tests", "__pycache__", "*.pyc"))
        self.expected_flow = verify_module.flow_hash(self.w / "flow")
        for name in ("db.enc", "net.v", "design.def", "design.sdc", "rc.spef"):
            (self.w / name).write_text("synthetic input\n")
        (self.w / "db.enc.dat").mkdir()
        (self.w / "db.enc.dat/data").write_text("synthetic DB\n")
        self.base = state.design_state({"top": "top", "stage": "postroute", "root": str(self.w),
            "database": {"enc": "db.enc", "encDat": "db.enc.dat"}, "netlist": "net.v", "def": "design.def",
            "spef": {"rc": "rc.spef"}, "sdc": ["design.sdc"], "scenarios": [{"name": "slow", "corner": "rc"}]})
        core.write_artifact(self.w / "state/working-state.json", self.base)
        self.lib = self.root / "libraries"
        self.lib.mkdir()
        for name in ("tech.lef", "cells.lef", "cells.lib"):
            (self.lib / name).write_text("synthetic library\n")
        self.profile = {"design": "top", "techLef": str(self.lib / "tech.lef"),
            "cellLefGlob": str(self.lib / "cells.lef"), "qualifiedReadRoots": [str(self.lib)],
            "xtopContext": {"siteMap": ["unit", "core"], "removableFillers": ["FILL*"],
                "scenarios": [{"name": "slow", "corner": "slow", "libertyGlob": str(self.lib / "cells.lib")}],
                "ecoParameters": {"bufferListForHold": ["BUF1"], "bufferListForSetup": ["BUF2"],
                    "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
                    "cellNominalSwapKeywords": ["LVT", ""], "cellNominalSizingPattern": "D([0-9]+)BWP", "gainThreshold": 0.001}}}
        self.profile_path = self.root / "profile.json"
        self.profile_path.write_text(json.dumps(self.profile))
        compiled = adapters.compile_xtop_site_context(self.profile, ["slow"])
        context_root = self.w / "research/observe/g1"
        context_root.mkdir(parents=True)
        library = context_root / "library.tcl"
        library.write_text(compiled["libraryTcl"])
        timing = context_root / "sta_data"
        timing.mkdir()
        (timing / "slow_data_finish").write_text("synthetic timing\n")
        self.context = core.stamp("xtop-context", {"designStateId": self.base["id"], "requiredScenarios": ["slow"],
            "libraryTcl": {"path": str(library.relative_to(self.w)), "sha256": core.file_sha256(library)},
            "staData": {"path": str(timing.relative_to(self.w)), "digest": core.tree_digest(timing)},
            "libraryFiles": compiled["libraryFiles"], "siteMap": compiled["siteMap"],
            "removableFillers": compiled["removableFillers"], "ecoParameters": compiled["ecoParameters"]})
        core.write_artifact(self.w / "state/xtop-context.json", self.context)
        package = workspaces.validate_work_package({"taskId": "w01", "baseStateId": self.base["id"],
            "problem": "synthetic", "targets": [], "editDomain": {"instances": ["U1"], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [], "actions": ["size_cell"],
            "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1}}, self.base, self.profile)
        manifest = workspaces.prepare(package, str(self.w), self.base)
        self.slot = self.w / manifest["root"]
        runtime_context = dict(self.context)
        runtime_context["libraryTcl"] = {**self.context["libraryTcl"], "path": str(library)}
        runtime_context["staData"] = {**self.context["staData"], "path": str(timing)}
        operator = adapters.compile_xtop_operator_task(manifest, "top", self.profile["techLef"],
            self.profile["cellLefGlob"], str(self.w / "net.v"), str(self.w / "design.def"), str(self.slot), runtime_context)
        (self.slot / "operator.tcl").write_text(operator["tcl"])
        manual = adapters.compile_xtop_analysis_manual_task(manifest, package["editDomain"],
            self.slot / "operator.tcl", self.slot / "ops.jsonl")
        self.manual = self.slot / "xtop-analysis-manual.tcl"
        self.manual.write_text(manual["tcl"])
        self.index = {"workers": {"w01": {"workspaceManifest": manifest, "workPackage": package,
            "workPackageId": package["id"], "manifestId": manifest["id"],
            "root": manifest["root"], "namePrefix": manifest["namePrefix"], "sessionTcl": str(self.manual),
            "sessionTclSha256": core.file_sha256(self.manual), "opsLog": str(self.slot / "ops.jsonl")}}}
        self.index_path = self.w / "state/workers.json"
        self.index_path.write_text(json.dumps(self.index))

    def run_verifier(self):
        return subprocess.run([sys.executable, "-I", str(VERIFIER), "--workspace", str(self.w), "--slot", "w01",
            "--flow", self.expected_flow, "--profile", str(self.profile_path),
            "--profile-hash", core.file_sha256(self.profile_path), "--admin-root", str(self.admin)],
            capture_output=True, text=True)

    def test_untouched_fixture_produces_readonly_admin_startup_and_slot_identity(self):
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertTrue(Path(receipt["startup"]).is_relative_to(self.admin))
        self.assertEqual(receipt["slotRoot"], str(self.slot))

    def test_changed_helper_is_refused_without_executing_it(self):
        sentinel = self.root / "executed"
        (self.w / "flow/atcs/core.py").write_text(f"open({str(sentinel)!r}, 'w').write('executed')\n")
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(sentinel.exists())

    def test_manual_tcl_and_record_hash_changed_together_are_refused(self):
        self.manual.write_text("exec arbitrary-command\n")
        self.index["workers"]["w01"]["sessionTclSha256"] = core.file_sha256(self.manual)
        self.index_path.write_text(json.dumps(self.index))
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_operator_tcl_change_is_refused(self):
        (self.slot / "operator.tcl").write_text("exec arbitrary-command\n")
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_sibling_slot_manifest_is_refused(self):
        self.index["workers"]["w01"]["workspaceManifest"]["taskId"] = "w02"
        self.index_path.write_text(json.dumps(self.index))
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_revision_lookalike_path_is_refused(self):
        self.index["workers"]["w01"]["root"] = "workspaces/w01/r1evil/"
        self.index_path.write_text(json.dumps(self.index))
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_base_input_path_escape_is_refused(self):
        target = self.root / "external-netlist"
        target.write_text("synthetic outside input\n")
        base = {key: value for key, value in self.base.items() if key not in ("schema", "id")}
        base["netlist"] = {"path": str(target), "sha256": core.file_sha256(target)}
        core.write_artifact(self.w / "state/working-state.json", core.stamp("design-state", base))
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_wrapper_declares_campaign_readonly_and_only_selected_slot_writable(self):
        wrapper = Path(__file__).with_name("atcs-xtop-operator-v3.sh").read_text()
        self.assertIn('src="$workspace",dst="$workspace",ro=true', wrapper)
        self.assertIn('src="$slot_root",dst="$slot_root",rw=true', wrapper)
        self.assertNotIn('src="$workspace",dst="$workspace",rw=true', wrapper)
        self.assertIn('private_home="$slot_root/.operator-home-$$"', wrapper)
        self.assertIn('/bin/bash --noprofile --norc -c', wrapper)

    def test_slot_hardlink_cannot_modify_a_sibling(self):
        sibling = self.root / "sibling-sentinel"
        sibling.write_text("unchanged\n")
        os.link(sibling, self.slot / "ops.jsonl")
        self.assertNotEqual(self.run_verifier().returncode, 0)
        self.assertEqual(sibling.read_text(), "unchanged\n")

    def test_consistently_stamped_base_input_cannot_be_in_the_writable_slot(self):
        netlist = self.slot / "base.v"
        netlist.write_text("synthetic base\n")
        base_body = {key: value for key, value in self.base.items() if key not in ("schema", "id")}
        base_body["netlist"] = {"path": str(netlist.relative_to(self.w)), "sha256": core.file_sha256(netlist)}
        base = core.stamp("design-state", base_body)
        core.write_artifact(self.w / "state/working-state.json", base)
        entry = self.index["workers"]["w01"]
        package_body = {key: value for key, value in entry["workPackage"].items() if key not in ("schema", "id")}
        package_body["baseStateId"] = base["id"]
        package = core.stamp("work-package", package_body)
        manifest_body = {key: value for key, value in entry["workspaceManifest"].items() if key not in ("schema", "id")}
        manifest_body.update(baseStateId=base["id"], workPackageId=package["id"], readOnly=workspaces._base_sources(base))
        manifest = core.stamp("workspace-manifest", manifest_body)
        core.write_artifact(self.slot / "manifest.json", manifest)
        entry.update(workPackage=package, workPackageId=package["id"], workspaceManifest=manifest, manifestId=manifest["id"])
        self.index_path.write_text(json.dumps(self.index))
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("base input lies in the writable worker slot", result.stderr)

    def test_login_profile_is_not_executed_by_the_container_shell_shape(self):
        home = self.root / "login-home"
        home.mkdir()
        sentinel = self.root / "profile-executed"
        (home / ".bash_profile").write_text("touch " + str(sentinel) + "\n")
        result = subprocess.run(["bash", "--noprofile", "--norc", "-c", "true"],
                                env={**os.environ, "HOME": str(home)}, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(sentinel.exists())

    def test_state_index_symlink_is_refused(self):
        moved = self.root / "external-index.json"
        self.index_path.rename(moved)
        self.index_path.symlink_to(moved)
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_sta_tree_escape_is_refused(self):
        target = self.root / "external"
        target.write_text("external\n")
        (self.w / "research/observe/g1/sta_data/escape").symlink_to(target)
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_private_home_symlink_is_refused(self):
        (self.slot / ".operator-home").symlink_to(self.admin, target_is_directory=True)
        self.assertNotEqual(self.run_verifier().returncode, 0)

    def test_python_cache_is_not_consumed_or_part_of_identity(self):
        cache = self.w / "flow/atcs/__pycache__"
        cache.mkdir()
        (cache / "core.cpython-312.pyc").write_bytes(b"untrusted cache")
        self.assertEqual(self.run_verifier().returncode, 0)

if __name__ == "__main__":
    unittest.main()
