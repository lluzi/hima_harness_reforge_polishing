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


# The Task 3 toolkit's mutations (contract.yml `xtop-operator.interactive.commands.mutate`).
EXPERT_COMMANDS = (
    "atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load",
    "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins",
    "atcs_undo",
)


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
        "targetPins": ["U1/reg/D"],
        "scope": {"commands": list(EXPERT_COMMANDS), "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
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

    def test_task_id_outside_w01_w06_rejected(self):
        package = make_work_package(task_id="w07", base_state_id=self.base_state["id"])
        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(ctx.exception.code, "invalid-work-package")
        self.assertGreaterEqual(
            workspaces.request_invalid_count(package, self.base_state, self.site_capabilities), 1
        )

    def test_mutation_domain_cannot_expand_through_a_wildcard(self):
        for name in ("*", "U?/BUF1"):
            package = make_work_package(base_state_id=self.base_state["id"], edit_instances=[name])
            with self.assertRaises(core.AtcsError):
                workspaces.validate_work_package(package, self.base_state, self.site_capabilities)

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

    def test_bus_bit_edit_domain_names_are_admitted(self):
        """I7 (final review): a Reader must never refuse a name the emitters
        (`atcs.integration.xtop_tcl`/`_innovus_eco_line`) would themselves admit --
        a real bus-bit signal name (`bus[3]`) is a legitimate `editDomain` entry."""
        package = make_work_package(
            base_state_id=self.base_state["id"], edit_instances=["U1/BUF1", "bus[3]"]
        )
        stamped = workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(stamped["editDomain"]["instances"], ["U1/BUF1", "bus[3]"])
        self.assertEqual(
            workspaces.request_invalid_count(package, self.base_state, self.site_capabilities), 0
        )

    def test_unsafe_edit_domain_instance_name_rejected(self):
        """A Reader now catches, up front, exactly the names the emitters would
        themselves refuse at replay/capture time (a semicolon, brace or backslash)
        -- never lets a work package through only to fail deep inside `replay-
        prepare`/`capture-contribution` later."""
        package = make_work_package(
            base_state_id=self.base_state["id"], edit_instances=["U1;rm -rf"]
        )
        with self.assertRaises(core.AtcsError) as ctx:
            workspaces.validate_work_package(package, self.base_state, self.site_capabilities)
        self.assertEqual(ctx.exception.code, "invalid-work-package")
        self.assertGreaterEqual(
            workspaces.request_invalid_count(package, self.base_state, self.site_capabilities), 1
        )


class ExpertScopeWorkPackageTest(unittest.TestCase):
    """Issue #64 Task 4: a work package carries the expert Operator's scope, target pins and
    observation mode, for six slots (w01..w06)."""

    def setUp(self):
        self.base_state = make_base_state()
        self.caps = {"pgVerification": False}

    def _package(self, **overrides):
        package = make_work_package(base_state_id=self.base_state["id"])
        package.update(overrides)
        return package

    def _problems(self, package):
        return workspaces.request_invalid_count(package, self.base_state, self.caps)

    def test_the_toolkit_surface_and_recipe_cap_are_pinned(self):
        self.assertEqual(workspaces.MUTATE_COMMANDS, EXPERT_COMMANDS)
        self.assertEqual(workspaces.SCOPE_MAX_MUTATIONS, 600)
        self.assertEqual(workspaces.OBSERVE_MODES, ("fast", "full"))
        self.assertEqual(workspaces.TASK_IDS, ("w01", "w02", "w03", "w04", "w05", "w06"))

    def test_the_session_adapter_admits_the_package_budget_and_modes(self):
        from atcs import adapters
        for observe in workspaces.OBSERVE_MODES:
            task = adapters.compile_xtop_analysis_manual_task(
                {"namePrefix": "atcs_w01_r1_"}, {"instances": [], "nets": []}, "/ws/operator.tcl", "/ws/ops.jsonl",
                max_mutations=workspaces.SCOPE_MAX_MUTATIONS, observe=observe)
            self.assertEqual((task["maxMutations"], task["observe"]), (workspaces.SCOPE_MAX_MUTATIONS, observe))

    def test_a_full_expert_package_is_stamped_with_its_scope(self):
        package = self._package(observe="full",
                                editDomain={"instances": ["U1/BUF1"], "nets": ["n1"], "regions": [[0, 0, 10.5, 20]]})
        stamped = workspaces.validate_work_package(package, self.base_state, self.caps)
        self.assertEqual(stamped["scope"], {"commands": list(EXPERT_COMMANDS), "maxMutations": 600})
        self.assertEqual(stamped["targetPins"], ["U1/reg/D"])
        self.assertEqual(stamped["observe"], "full")

    def test_scope_and_target_pins_are_required(self):
        for key in ("scope", "targetPins"):
            with self.subTest(key=key):
                package = self._package()
                del package[key]
                with self.assertRaisesRegex(core.AtcsError, f"missing field: {key}"):
                    workspaces.validate_work_package(package, self.base_state, self.caps)

    def test_a_scope_command_outside_the_toolkit_mutations_is_invalid(self):
        for command in ("atcs_ref", "atcs_dump_cells", "source", "fix_hold_gba_violations"):
            with self.subTest(command=command):
                scope = {"commands": ["atcs_size_cell", command, "atcs_undo"], "maxMutations": 120}
                self.assertGreaterEqual(self._problems(self._package(scope=scope)), 1)

    def test_a_scope_must_list_distinct_commands_and_keep_undo(self):
        for commands in ([], ["atcs_size_cell", "atcs_size_cell", "atcs_undo"], ["atcs_size_cell"], "atcs_undo"):
            with self.subTest(commands=commands):
                scope = {"commands": commands, "maxMutations": 120}
                self.assertGreaterEqual(self._problems(self._package(scope=scope)), 1)

    def test_the_request_budget_is_one_to_the_recipe_cap(self):
        # ADR-0016: the request's own scope is the one the Host binds, so a budget below the cap is
        # the request's to choose; outside 1..600 (#66 D7, the Harness ceiling since H1) or not an
        # integer it is refused.
        for budget in (0, 601, 1000, True, "600", 600.0):
            with self.subTest(budget=budget):
                scope = {"commands": ["atcs_size_cell", "atcs_undo"], "maxMutations": budget}
                self.assertGreaterEqual(self._problems(self._package(scope=scope)), 1)
        for budget in (1, 120, 599, 600):
            with self.subTest(budget=budget):
                scope = {"commands": ["atcs_size_cell", "atcs_undo"], "maxMutations": budget}
                self.assertEqual(self._problems(self._package(scope=scope)), 0)

    def test_a_scope_has_exactly_commands_and_max_mutations(self):
        for scope in ({"commands": ["atcs_undo"]}, {"commands": ["atcs_undo"], "maxMutations": 120, "effort": "high"},
                      ["atcs_undo"]):
            with self.subTest(scope=scope):
                self.assertGreaterEqual(self._problems(self._package(scope=scope)), 1)

    def test_target_pins_are_safe_distinct_pin_paths(self):
        for pins in (["U1"], ["U1/*"], ["U1/reg/D", "U1/reg/D"], ["U1/reg;D"], "U1/reg/D", [7]):
            with self.subTest(pins=pins):
                self.assertGreaterEqual(self._problems(self._package(targetPins=pins)), 1)
        self.assertEqual(self._problems(self._package(targetPins=[])), 0)
        self.assertEqual(self._problems(self._package(targetPins=["u_core/dout_reg[15]/D"])), 0)

    def test_observe_is_fast_or_full(self):
        self.assertEqual(self._problems(self._package(observe="fast")), 0)
        self.assertGreaterEqual(self._problems(self._package(observe="slow")), 1)

    def test_regions_are_boxes(self):
        for regions in ([[0, 0, 10]], [[10, 0, 0, 5]], [[0, 0, "10", 5]], [[0, 0, True, 5]], "0 0 1 1"):
            with self.subTest(regions=regions):
                domain = {"instances": ["U1/BUF1"], "nets": [], "regions": regions}
                self.assertGreaterEqual(self._problems(self._package(editDomain=domain)), 1)

    def test_slot_w06_is_prepared_and_w07_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            stamped = workspaces.validate_work_package(self._package(taskId="w06"), self.base_state, self.caps)
            manifest = workspaces.prepare(stamped, root, self.base_state)
            self.assertEqual(manifest["root"], "workspaces/w06/r1/")
            self.assertEqual(manifest["namePrefix"], "atcs_w06_r1_")
            self.assertGreaterEqual(self._problems(self._package(taskId="w07")), 1)
            forged = dict(stamped, taskId="w07")
            with self.assertRaises(core.AtcsError):
                workspaces.prepare(forged, root, self.base_state)
            self.assertFalse((Path(root) / "workspaces" / "w07").exists())


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
