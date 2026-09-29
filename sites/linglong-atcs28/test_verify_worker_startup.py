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

class _VerifierFixture(unittest.TestCase):
    """A prepared Campaign workspace and slot w01, and the verifier run against them."""

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
        library = self.library = context_root / "library.tcl"
        library.write_text(compiled["libraryTcl"])
        timing = self.timing = context_root / "sta_data"
        timing.mkdir()
        (timing / "slow_data_finish").write_text("synthetic timing\n")
        self.context = core.stamp("xtop-context", {"designStateId": self.base["id"], "requiredScenarios": ["slow"],
            "libraryTcl": {"path": str(library.relative_to(self.w)), "sha256": core.file_sha256(library)},
            "staData": {"path": str(timing.relative_to(self.w)), "digest": core.tree_digest(timing)},
            "libraryFiles": compiled["libraryFiles"], "siteMap": compiled["siteMap"],
            "removableFillers": compiled["removableFillers"], "ecoParameters": compiled["ecoParameters"]})
        core.write_artifact(self.w / "state/xtop-context.json", self.context)
        self.prepare_slot("w01")

    def prepare_slot(self, slot, parked=False):
        """Prepare one slot exactly as `prepare-workers` does (Issue #64: w01..w06, expert fields)."""
        if parked:
            raw = {"taskId": slot, "baseStateId": self.base["id"], "parked": True, "problem": "no blocker"}
        else:
            raw = {"taskId": slot, "baseStateId": self.base["id"],
                "problem": "synthetic", "targets": [], "editDomain": {"instances": ["U1"], "nets": ["n1"],
                "regions": [[0, 0, 10.5, 20]]}, "protected": {"instances": [], "nets": []}, "mayAffect": [],
                "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
                "targetPins": ["U2/D"], "scope": {"commands": list(workspaces.MUTATE_COMMANDS),
                "maxMutations": workspaces.SCOPE_MAX_MUTATIONS}, "observe": "full"}
        package = workspaces.validate_work_package(raw, self.base, self.profile)
        manifest = workspaces.prepare(package, str(self.w), self.base)
        self.slot = self.w / manifest["root"]
        entry = {"workspaceManifest": manifest, "workPackage": package, "workPackageId": package["id"],
            "manifestId": manifest["id"], "root": manifest["root"], "namePrefix": manifest["namePrefix"]}
        if parked:
            entry["parked"] = True
        else:
            runtime_context = dict(self.context)
            runtime_context["libraryTcl"] = {**self.context["libraryTcl"], "path": str(self.library)}
            runtime_context["staData"] = {**self.context["staData"], "path": str(self.timing)}
            operator = adapters.compile_xtop_operator_task(manifest, "top", self.profile["techLef"],
                self.profile["cellLefGlob"], str(self.w / "net.v"), str(self.w / "design.def"), str(self.slot),
                runtime_context)
            (self.slot / "operator.tcl").write_text(operator["tcl"])
            # The same call `prepare-workers` makes (atcs_cli._cmd_prepare_workers).
            manual = adapters.compile_xtop_analysis_manual_task(manifest, package["editDomain"],
                self.slot / "operator.tcl", self.slot / "ops.jsonl", target_pins=package.get("targetPins"),
                max_mutations=package["scope"].get("maxMutations"), observe=package.get("observe"))
            self.manual = self.slot / "xtop-analysis-manual.tcl"
            self.manual.write_text(manual["tcl"])
            entry.update(sessionTcl=str(self.manual), sessionTclSha256=core.file_sha256(self.manual),
                         opsLog=str(self.slot / "ops.jsonl"))
        self.index = getattr(self, "index", {"workers": {}})
        self.index["workers"][slot] = entry
        self.index_path = self.w / "state/workers.json"
        self.index_path.write_text(json.dumps(self.index))

    def run_verifier(self, slot="w01"):
        return subprocess.run([sys.executable, "-I", str(VERIFIER), "--workspace", str(self.w), "--slot", slot,
            "--flow", self.expected_flow, "--profile", str(self.profile_path),
            "--profile-hash", core.file_sha256(self.profile_path), "--admin-root", str(self.admin)],
            capture_output=True, text=True)


class VerifierTest(_VerifierFixture):
    def test_untouched_fixture_produces_readonly_admin_startup_and_slot_identity(self):
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertTrue(Path(receipt["startup"]).is_relative_to(self.admin))
        self.assertEqual(receipt["slotRoot"], str(self.slot))

    def test_expert_session_fields_are_regenerated_identically(self):
        # Issue #64 Task 4: the session Tcl bakes targetPins, scope.maxMutations and observe.
        text = self.manual.read_text()
        self.assertIn("set ::EDIT_DOMAIN_PINS {U2/D}", text)
        self.assertIn("set ::ATCS_MAX_MUTATIONS {120}", text)
        self.assertIn("set ::ATCS_OBSERVE {full}", text)
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stderr)
        startup = Path(json.loads(result.stdout)["startup"]).read_text()
        for line in ("set ::EDIT_DOMAIN_PINS {U2/D}", "set ::ATCS_MAX_MUTATIONS {120}", "set ::ATCS_OBSERVE {full}"):
            self.assertIn(line, startup)

    def test_sixth_slot_is_verified(self):
        self.prepare_slot("w06")
        result = self.run_verifier("w06")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["slotRoot"], str(self.slot))

    def test_seventh_slot_is_refused(self):
        result = self.run_verifier("w07")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown slot", result.stderr)

    def test_parked_slot_is_refused(self):
        self.prepare_slot("w04", parked=True)
        result = self.run_verifier("w04")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("parked", result.stderr)

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
        wrapper = Path(__file__).with_name("atcs-xtop-operator-v4.sh").read_text()
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

    def test_vendor_database_link_must_resolve_to_qualified_readonly_data(self):
        database = self.w / "db.enc.dat"
        link = database / "technology.lef"
        link.symlink_to(self.lib / "tech.lef")
        verify_module.verify_database_tree(database, self.w, self.slot, [self.lib])
        link.unlink()
        secret = self.root / "outside-qualified-roots"
        secret.write_text("outside\n")
        link.symlink_to(secret)
        with self.assertRaisesRegex(ValueError, "escapes"):
            verify_module.verify_database_tree(database, self.w, self.slot, [self.lib])

    def test_database_link_into_writable_slot_is_refused(self):
        target = self.slot / "mutable-data"
        target.write_text("mutable\n")
        (self.w / "db.enc.dat/escape").symlink_to(target)
        with self.assertRaisesRegex(ValueError, "escapes"):
            verify_module.verify_database_tree(self.w / "db.enc.dat", self.w, self.slot, [self.lib])

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


FRESH = Path(__file__).with_name("fresh-worker-slot.py")
WRAPPER_V13 = Path(__file__).with_name("atcs-xtop-operator-v13.sh")
WRAPPER_V14 = Path(__file__).with_name("atcs-xtop-operator-v14.sh")
# #64 treatment attempt 1, slot w02: the 44 multiply linked files attempt 1's orphaned XTop left in
# workspaces/w02/r1 (the retained `find -links +1` listing, one "<links> <inode> <path>" row each).
STALE_LOCKS = REPO / "packs/agentic-timing-closure-system/flow/tests/live_fixtures/t01-w02-stale-locks-list.txt"


class RetrySlotTest(_VerifierFixture):
    """Every Operator attempt starts in a slot holding no earlier attempt (#64 treatment attempt 1, w02).

    `prepare-workers` picks `workspaces/<slot>/r<N>` once per plan and the Harness retries the operate
    node with the same argv, so attempt 2 met attempt 1's XTop workspaces and hard-linked locks: the
    verifier refused it, and after a person cleared the locks attempt 4's XTop stopped at
    `save_workspace` ("Directory exists"). The v13 wrapper runs `fresh-worker-slot.py` first."""

    def leave_attempt_one(self):
        """The shapes attempt 1 left in the slot: its XTop workspaces with the retained hard-linked
        lock pairs, its session outputs and its private home."""
        rows = [line.split() for line in STALE_LOCKS.read_text().splitlines() if line.strip()]
        self.assertEqual(len(rows), 44)
        by_inode = {}
        for _links, inode, rel in rows:
            by_inode.setdefault(inode, []).append(rel)
        for first, *others in by_inode.values():
            target = self.slot / first
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("lock\n")
            for other in others:
                os.link(target, self.slot / other)
        (self.slot / "swerv_wrapper_operator_baseline").mkdir()
        (self.slot / "swerv_wrapper_operator_baseline" / "workspace.db").write_text("baseline\n")
        for name in ("ops.jsonl", "before.dump", "xtop_log_1.txt"):
            (self.slot / name).write_text("attempt 1\n")
        (self.slot / ".operator-home-2343326").mkdir()
        return len(by_inode)

    def run_fresh(self, slot="w01"):
        return subprocess.run([sys.executable, "-I", str(FRESH), "--workspace", str(self.w), "--slot", slot],
                              capture_output=True, text=True)

    def test_the_retry_lands_in_the_same_round_directory_and_the_verifier_refuses_it(self):
        pairs = self.leave_attempt_one()
        self.assertEqual(pairs, 22)
        package = self.index["workers"]["w01"]["workPackage"]
        again = workspaces.prepare(package, str(self.w), self.base)
        self.assertEqual(self.w / again["root"], self.slot, "prepare-workers returns the same r<N> for the retry")
        result = self.run_verifier()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("multiply linked", result.stderr)

    def test_a_retry_starts_in_a_slot_holding_only_its_prepared_files(self):
        self.leave_attempt_one()
        result = self.run_fresh()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(sorted(path.name for path in self.slot.iterdir()),
                         ["manifest.json", "operator.tcl", "xtop-analysis-manual.tcl"])
        retired = Path(receipt["retired"])
        self.assertEqual(retired, self.slot.with_name(self.slot.name + ".attempt-1"))
        self.assertEqual(len([path for path in retired.rglob("*.exclusive.cdslck*")]), 44, "nothing is deleted")
        self.assertIn("swerv_wrapper_operator_baseline", receipt["moved"])
        verified = self.run_verifier()
        self.assertEqual(verified.returncode, 0, verified.stderr)
        self.assertEqual(json.loads(verified.stdout)["slotRoot"], str(self.slot))

    def test_each_further_attempt_is_retired_beside_the_last(self):
        self.leave_attempt_one()
        self.assertEqual(self.run_fresh().returncode, 0)
        (self.slot / "ops.jsonl").write_text("attempt 2\n")
        second = json.loads(self.run_fresh().stdout)
        self.assertEqual(Path(second["retired"]).name, self.slot.name + ".attempt-2")
        self.assertEqual(second["moved"], ["ops.jsonl"])

    def test_a_first_attempt_is_left_alone(self):
        result = self.run_fresh()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["retired"], None)
        self.assertFalse(self.slot.with_name(self.slot.name + ".attempt-1").exists())

    def test_a_parked_slot_is_refused(self):
        self.prepare_slot("w02", parked=True)
        result = self.run_fresh("w02")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("parked", result.stderr)

    def test_the_v13_wrapper_runs_the_step_pinned_before_the_verifier(self):
        text = WRAPPER_V13.read_text()
        self.assertIn("fresh_slot=/data/eda/project/hima_harness/operator-admin/atcs-v13/fresh-worker-slot.py", text)
        self.assertIn("fresh_slot_sha256=", text)
        self.assertLess(text.index('python3 -I "$fresh_slot"'), text.index('python3 -I "$verifier"'))
        self.assertIn("operator-admin/atcs-v13/verify-worker-startup.py", text)



class WrapperCloseV14Test(unittest.TestCase):
    """#64 treatment attempt 2 (D-T02-2): v13 ran podman in the foreground, so its HUP/TERM trap fired only after
    podman returned, and every Harness close left the container and its XTop running. v14 is v13 with the
    container in the background and one close path for HUP, TERM, INT and EOF on stdin. The behaviour is
    qualified on the Site (README); these pin the shape of the template that was installed."""

    def setUp(self):
        self.v13 = WRAPPER_V13.read_text()
        self.v14 = WRAPPER_V14.read_text()

    def test_every_close_is_trapped_before_the_container_starts_and_the_wrapper_waits_on_it(self):
        launch = self.v14.index("podman run --rm -it")
        for trap in ("trap leave EXIT", "trap 'close_session hangup' HUP", "trap 'close_session terminate' TERM",
                     "trap 'close_session interrupt' INT"):
            self.assertLess(self.v14.index(trap), launch, trap)
        self.assertIn("""' -- "$session_tcl" 0<&0 &\npodman_pid=$!\n""", self.v14)
        self.assertIn('wait -n -p ended "$podman_pid" "$stdin_pid"', self.v14)
        self.assertIn("close_session stdin-eof", self.v14)
        self.assertIn("poller.register(0, 0)", self.v14, "stdin is watched for hang-up without being read")

    def test_a_close_stops_the_container_in_its_own_session_and_checks_nothing_remains(self):
        self.assertIn('setsid --wait podman stop -t 20 -- "$container_name"', self.v14)
        close = self.v14[self.v14.index("close_session() {"):self.v14.index("leave() {")]
        self.assertLess(close.index("trap '' HUP INT TERM"), close.index("stop_container"))
        self.assertLess(close.index("stop_container"), close.index("container_processes"))
        self.assertLess(close.index("exit 5"), close.index("exit 0"))

    def test_the_container_name_and_xtop_pid_are_written_to_the_slot(self):
        self.assertIn('session_record="$slot_root/session.json"', self.v14)
        self.assertIn('"container": name, "xtopPid"', self.v14)

    def test_the_launch_and_every_pin_are_v13_s(self):
        def launch(text):
            return text[text.index("podman run --rm -it"):text.index("' -- \"$session_tcl\"")]
        self.assertEqual(launch(self.v14), launch(self.v13))
        pins = [line for line in self.v13.splitlines() if line.startswith(("image=", "adapter_sha256=", "flow_digest=",
                "verifier_sha256=", "fresh_slot_sha256=", "site_profile=", "site_profile_sha256="))]
        self.assertEqual(len(pins), 7)
        for line in pins:
            self.assertIn(line + "\n", self.v14)
        self.assertLess(self.v14.index('python3 -I "$fresh_slot"'), self.v14.index('python3 -I "$verifier"'))
        self.assertNotIn("atcs-v13", self.v14)
        self.assertEqual(self.v14.count("operator-admin/atcs-v14/"), 4)


if __name__ == "__main__":
    unittest.main()
