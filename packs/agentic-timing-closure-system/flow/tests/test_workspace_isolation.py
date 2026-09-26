"""Tests for `atcs.workspaces` — M2's work-package validation and private,
idempotent worker workspaces.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_workspace_isolation.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import copy
import sys
import tempfile
import threading
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import workspaces  # noqa: E402


def make_base_state(state_id_seed="base-state"):
    body = {
        "top": "swerv",
        "stage": "postroute",
        "database": {"path": "design.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
        "netlist": {"path": "design.v", "sha256": "c" * 64},
        "def": None,
        "spef": {"cbest": {"path": "cbest.spef", "sha256": "d" * 64}},
        "sdc": [{"path": "constraints.sdc", "sha256": "e" * 64}],
        "tools": {},
        "scenarios": ["func_ssg_rcworst_m40"],
        "parentId": None,
        "_seed": state_id_seed,
    }
    stamped = core.stamp("design-state", body)
    stamped.pop("_seed", None)
    return stamped


def make_work_package(
    task_id="w01",
    base_state_id=None,
    actions=None,
    edit_instances=None,
    protected_instances=None,
    problem="hold violation cluster near U1",
):
    return {
        "taskId": task_id,
        "baseStateId": base_state_id,
        "problem": problem,
        "targets": ["func_ssg_rcworst_m40|hold|U1/reg"],
        "editDomain": {
            "instances": edit_instances if edit_instances is not None else ["U1/BUF1"],
            "nets": [],
            "regions": [],
        },
        "protected": {
            "instances": protected_instances if protected_instances is not None else [],
            "nets": [],
        },
        "mayAffect": ["func_ssg_rcworst_m40|hold|U1/reg"],
        "actions": actions if actions is not None else ["insert_buffer"],
        "budget": {"xtopMinutes": 10, "queries": 5, "attempts": 3},
    }


class ValidateWorkPackageTest(unittest.TestCase):
    def setUp(self):
        self.base_state = make_base_state()
        self.site_capabilities = {"pgVerification": False}

    def test_valid_package_passes(self):
        package = make_work_package(base_state_id=self.base_state["id"])
        stamped = workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(stamped["schema"], "atcs.work-package/1")
        self.assertEqual(stamped["taskId"], "w01")
        self.assertEqual(
            workspaces.request_invalid_count(package, self.base_state, self.site_capabilities), 0
        )

    def test_task_id_outside_w01_w03_rejected(self):
        package = make_work_package(task_id="w04", base_state_id=self.base_state["id"])
        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(ctx.exception.code, "invalid-work-package")
        self.assertGreaterEqual(
            workspaces.request_invalid_count(package, self.base_state, self.site_capabilities), 1
        )

    def test_action_swap_rtl_rejected(self):
        package = make_work_package(base_state_id=self.base_state["id"], actions=["swap_rtl"])
        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(ctx.exception.code, "invalid-work-package")
        self.assertGreaterEqual(
            workspaces.request_invalid_count(package, self.base_state, self.site_capabilities), 1
        )

    def test_pg_local_adjust_rejected_when_capability_false(self):
        package = make_work_package(
            base_state_id=self.base_state["id"], actions=["pg_local_adjust"]
        )
        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.validate_work_package(package, self.base_state, {"pgVerification": False})
        self.assertEqual(ctx.exception.code, "invalid-work-package")

    def test_pg_local_adjust_permitted_when_capability_true(self):
        package = make_work_package(
            base_state_id=self.base_state["id"], actions=["pg_local_adjust"]
        )
        stamped = workspaces.validate_work_package(
            package, self.base_state, {"pgVerification": True}
        )
        self.assertEqual(stamped["actions"], ["pg_local_adjust"])

    def test_base_state_id_mismatch_rejected(self):
        package = make_work_package(base_state_id="not-the-base-state-id")
        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(ctx.exception.code, "invalid-work-package")

    def test_target_in_protected_rejected(self):
        package = make_work_package(
            base_state_id=self.base_state["id"],
            edit_instances=["U1/BUF1"],
            protected_instances=["U1/BUF1"],
        )
        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(ctx.exception.code, "invalid-work-package")

    def test_request_invalid_count_never_raises_on_invalid_content(self):
        package = make_work_package(task_id="bogus", actions=["swap_rtl", "pg_local_adjust"])
        # Should not raise, and should report more than one problem.
        count = workspaces.request_invalid_count(package, self.base_state, self.site_capabilities)
        self.assertGreater(count, 1)

    def test_missing_fields_are_each_reported(self):
        package = make_work_package(base_state_id=self.base_state["id"])
        del package["budget"]
        del package["mayAffect"]
        count = workspaces.request_invalid_count(package, self.base_state, self.site_capabilities)
        self.assertGreaterEqual(count, 2)


class PrepareWorkspaceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.campaign_root = self.temp.name
        self.base_state = make_base_state()

    def _prepared_package(self, **kwargs):
        kwargs.setdefault("base_state_id", self.base_state["id"])
        package = make_work_package(**kwargs)
        return workspaces.validate_work_package(package, self.base_state, {"pgVerification": False})

    def test_prepare_writes_manifest_and_directory(self):
        work_package = self._prepared_package()
        manifest = workspaces.prepare(work_package, self.campaign_root, self.base_state)

        self.assertEqual(manifest["schema"], "atcs.workspace-manifest/1")
        self.assertEqual(manifest["workPackageId"], work_package["id"])
        self.assertEqual(manifest["taskId"], "w01")
        self.assertEqual(manifest["revision"], 1)
        self.assertEqual(manifest["root"], "workspaces/w01/r1/")
        self.assertEqual(manifest["namePrefix"], "atcs_w01_r1_")
        self.assertEqual(manifest["baseStateId"], self.base_state["id"])

        manifest_path = Path(self.campaign_root) / "workspaces" / "w01" / "r1" / "manifest.json"
        self.assertTrue(manifest_path.is_file())
        on_disk = core.read_artifact(manifest_path, "workspace-manifest")
        self.assertEqual(on_disk, manifest)

    def test_manifest_lists_base_sources_read_only_without_copying(self):
        work_package = self._prepared_package()
        manifest = workspaces.prepare(work_package, self.campaign_root, self.base_state)

        expected_paths = {"design.enc", "design.v", "cbest.spef", "constraints.sdc"}
        actual_paths = {entry["path"] for entry in manifest["readOnly"]}
        self.assertEqual(actual_paths, expected_paths)
        for entry in manifest["readOnly"]:
            self.assertIn("sha256", entry)

        workspace_root = Path(self.campaign_root) / "workspaces" / "w01" / "r1"
        on_disk_names = {p.name for p in workspace_root.iterdir()}
        self.assertEqual(on_disk_names, {"manifest.json"})

    def test_prepare_is_idempotent_for_the_same_package(self):
        work_package = self._prepared_package()
        first = workspaces.prepare(work_package, self.campaign_root, self.base_state)
        second = workspaces.prepare(work_package, self.campaign_root, self.base_state)

        self.assertEqual(first, second)
        task_dir = Path(self.campaign_root) / "workspaces" / "w01"
        self.assertEqual([p.name for p in task_dir.iterdir()], ["r1"])

    def test_second_revision_of_same_task_gets_r2_and_new_prefix(self):
        first_package = self._prepared_package(problem="first attempt")
        second_package = self._prepared_package(problem="second attempt, revised plan")
        self.assertNotEqual(first_package["id"], second_package["id"])

        first_manifest = workspaces.prepare(first_package, self.campaign_root, self.base_state)
        second_manifest = workspaces.prepare(second_package, self.campaign_root, self.base_state)

        self.assertEqual(first_manifest["revision"], 1)
        self.assertEqual(second_manifest["revision"], 2)
        self.assertEqual(second_manifest["root"], "workspaces/w01/r2/")
        self.assertEqual(second_manifest["namePrefix"], "atcs_w01_r2_")
        self.assertNotEqual(first_manifest["namePrefix"], second_manifest["namePrefix"])

    def test_concurrent_prepare_of_two_packages_gets_disjoint_roots(self):
        first_package = self._prepared_package(problem="concurrent attempt A")
        second_package = self._prepared_package(problem="concurrent attempt B")

        results = {}
        errors = []

        def run(name, package):
            try:
                results[name] = workspaces.prepare(package, self.campaign_root, self.base_state)
            except Exception as exc:  # noqa: BLE001 - surfaced via `errors` below
                errors.append(exc)

        threads = [
            threading.Thread(target=run, args=("a", first_package)),
            threading.Thread(target=run, args=("b", second_package)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertNotEqual(results["a"]["root"], results["b"]["root"])
        self.assertEqual({results["a"]["revision"], results["b"]["revision"]}, {1, 2})

        task_dir = Path(self.campaign_root) / "workspaces" / "w01"
        self.assertEqual(sorted(p.name for p in task_dir.iterdir()), ["r1", "r2"])

    def test_computed_root_escaping_campaign_root_is_refused(self):
        work_package = copy.deepcopy(self._prepared_package())
        # Bypass validate_work_package's own taskId check to exercise
        # prepare()'s independent defense against a path-escaping taskId.
        work_package["taskId"] = "../../etc"

        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.prepare(work_package, self.campaign_root, self.base_state)
        self.assertEqual(ctx.exception.code, "invalid-work-package")

        # Nothing should have been created outside the campaign root.
        parent_of_campaign_root = Path(self.campaign_root).parent
        stray = parent_of_campaign_root / "etc"
        self.assertFalse(stray.exists())


if __name__ == "__main__":
    unittest.main()
