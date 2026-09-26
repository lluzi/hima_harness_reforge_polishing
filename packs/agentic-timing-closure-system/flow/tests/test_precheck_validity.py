"""Tests for `atcs.verification` — M6's check planning, PT pre-check
("presta") qualification, DRC/connectivity report parsing, and final
evaluation assembly.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_precheck_validity.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import verification  # noqa: E402

import fixtures  # noqa: E402


def _observation(scenario, setup_wns, hold_wns, complete_setup=True, complete_hold=True, checks=None):
    """A minimal `observation-set`-shaped dict scoped to a single scenario."""
    return {
        "designStateId": "ds-candidate",
        "precision": "pba",
        "scenarios": {
            scenario: {
                "setup": {"wns": setup_wns, "tns": core.known(0.0), "violations": core.known(0)},
                "hold": {"wns": hold_wns, "tns": core.known(0.0), "violations": core.known(0)},
                "unconstrained": core.known(0),
                "complete": {"setup": complete_setup, "hold": complete_hold},
            },
        },
        "checks": checks or {},
        "missingScenarios": [],
        "coverage": {"complete": complete_setup and complete_hold, "reasons": []},
        "sources": [],
    }


NETLIST_SHA = "n" * 64
DEF_SHA = "d" * 64
SPEF_A_SHA = "a" * 64
SPEF_B_SHA = "b" * 64

SCENARIO_WNS = {
    "func_ssg_rcworst_m40": (-0.100, -0.010),
    "func_ssg_rcworst_125": (-0.050, -0.020),
    "func_ffg_cbest_m40": (-0.200, -0.005),
    "func_ffg_cbest_125": (-0.030, -0.015),
}


# Every base-fixture scenario is pinned to this one corner, and the base plan's
# `scenarioCorners` map agrees — the identity chain is fully walkable and clean.
BASE_CORNER = "corner_a"


def _base_receipts():
    """Fully consistent receipts covering all four required scenarios, all on
    `BASE_CORNER` (matching `_base_plan`'s `scenarioCorners`)."""
    spef = {
        "corner_a": {"path": "a.spef", "sha256": SPEF_A_SHA, "inputDefSha256": DEF_SHA},
        "corner_b": {"path": "b.spef", "sha256": SPEF_B_SHA, "inputDefSha256": DEF_SHA},
    }
    sta = {}
    for scenario, (setup_wns, hold_wns) in SCENARIO_WNS.items():
        sta[scenario] = {
            "corner": BASE_CORNER,
            "inputs": {"netlistSha256": NETLIST_SHA, "spefSha256": SPEF_A_SHA},
            "observation": _observation(scenario, core.known(setup_wns), core.known(hold_wns)),
        }
    return {
        "database": {"path": "design.enc", "sha256": "e" * 64},
        "netlist": {"path": "design.v", "sha256": NETLIST_SHA},
        "def": {"path": "design.def", "sha256": DEF_SHA},
        "spef": spef,
        "sta": sta,
        "physical": {
            "drc": fixtures.drc_report([]),
            "connectivity": fixtures.connectivity_report([]),
        },
    }


def _base_plan():
    scenario_corners = {scenario: BASE_CORNER for scenario in SCENARIO_WNS}
    return verification.plan_checks(
        {"id": "mc-1", "operations": [{"op": "size_cell"}]},
        {"scenarioCorners": scenario_corners},
    )


class PlanChecksTest(unittest.TestCase):
    def test_sizing_only_commit_has_no_functional_entry(self):
        merge_commit = {"id": "mc-1", "operations": [{"op": "size_cell", "instance": "U1",
                                                        "fromMaster": "BUFX1", "toMaster": "BUFX2"}]}
        plan = verification.plan_checks(merge_commit, {})
        self.assertEqual(plan["functional"], [])
        self.assertEqual(plan["pg"], [])
        self.assertEqual(plan["schema"], "atcs.check-plan/1")
        self.assertEqual(set(plan["requiredScenarios"]), set(SCENARIO_WNS))

    def test_pg_local_adjust_commit_includes_pg(self):
        merge_commit = {"id": "mc-2", "operations": [{"op": "pg_local_adjust", "region": [0, 0, 1, 1],
                                                        "action": "widen", "detail": "strap"}]}
        plan = verification.plan_checks(merge_commit, {})
        self.assertIn("pg", plan["pg"])

    def test_insert_buffer_commit_adds_functional_entry(self):
        merge_commit = {"id": "mc-3", "operations": [{"op": "insert_buffer", "net": "n1", "loadPins": [],
                                                        "newInstance": "buf1", "newNet": "n1_buf",
                                                        "master": "BUFX1", "location": None}]}
        plan = verification.plan_checks(merge_commit, {})
        self.assertEqual(plan["functional"], ["connectivity"])

    def test_carries_merge_commit_id(self):
        plan = verification.plan_checks({"id": "mc-4", "operations": []}, {})
        self.assertEqual(plan["mergeCommitId"], "mc-4")

    def test_scenario_corners_copied_from_policy(self):
        scenario_corners = {"func_ssg_rcworst_m40": "rcworst_m40"}
        plan = verification.plan_checks({"id": "mc-5", "operations": []},
                                         {"scenarioCorners": scenario_corners})
        self.assertEqual(plan["scenarioCorners"], scenario_corners)

    def test_scenario_corners_defaults_to_empty_when_policy_omits_it(self):
        plan = verification.plan_checks({"id": "mc-6", "operations": []}, {})
        self.assertEqual(plan["scenarioCorners"], {})


class PrestaQualificationTest(unittest.TestCase):
    def test_new_nets_absent_from_spef_are_all_unqualified(self):
        result = verification.presta_qualification(["n1", "n2", "n3"], {"existing_net"})
        self.assertEqual(result["unqualified"], ["n1", "n2", "n3"])
        self.assertEqual(result["count"], core.known(3))

    def test_new_nets_present_in_spef_are_qualified(self):
        result = verification.presta_qualification(["n1", "n2"], {"n1", "n2", "other"})
        self.assertEqual(result["unqualified"], [])
        self.assertEqual(result["count"], core.known(0))

    def test_unreadable_spef_net_list_is_unknown(self):
        result = verification.presta_qualification(["n1", "n2"], None)
        self.assertEqual(result["unqualified"], ["n1", "n2"])
        self.assertTrue(core.is_known(core.known(0)))  # sanity on helper
        self.assertEqual(result["count"], core.unknown("unreadable-spef-net-list"))

    def test_no_new_nets_is_known_zero_even_if_spef_unreadable(self):
        result = verification.presta_qualification([], None)
        self.assertEqual(result["count"], core.known(0))


class DrcConnectivitySummaryParseTest(unittest.TestCase):
    def test_well_formed_drc_report_lists_identities(self):
        text = fixtures.drc_report([("SPACING: Special Wire of Net VDD on M4", (0.0, 0.0, 0.1, 0.1))])
        result = verification.parse_drc_summary(text)
        self.assertFalse(result["truncated"])
        self.assertEqual(core.value_of(result["total"]), 1)
        self.assertEqual(len(result["identities"]), 1)
        self.assertIn("M4", result["identities"][0])

    def test_drc_report_at_its_limit_is_truncated(self):
        text = fixtures.drc_report(
            [("SPACING: Special Wire of Net VDD", (float(i), 0.0, float(i) + 0.1, 0.1)) for i in range(2)],
            limit=2,
        )
        result = verification.parse_drc_summary(text)
        self.assertTrue(result["truncated"])
        self.assertIsNone(result["identities"])
        self.assertFalse(core.is_known(result["total"]))

    def test_well_formed_connectivity_report_lists_net_identities(self):
        text = fixtures.connectivity_report(["VDD", "VSS"])
        result = verification.parse_connectivity_summary(text)
        self.assertFalse(result["truncated"])
        self.assertEqual(core.value_of(result["total"]), 2)
        self.assertEqual(result["identities"], ["VDD", "VSS"])

    def test_connectivity_report_at_its_limit_is_truncated(self):
        text = fixtures.connectivity_report(["VDD", "VSS"], limit=2)
        result = verification.parse_connectivity_summary(text)
        self.assertTrue(result["truncated"])
        self.assertIsNone(result["identities"])
        self.assertFalse(core.is_known(result["total"]))

    def test_explicit_truncation_marker_forces_unknown(self):
        text = fixtures.drc_report([]) + "\nfirst 100 violations shown\n"
        result = verification.parse_drc_summary(text)
        self.assertTrue(result["truncated"])


class AssembleTest(unittest.TestCase):
    def setUp(self):
        self.plan = _base_plan()
        self.prior_observation = {"checks": {}}
        self.baseline_physical = {"drc": fixtures.drc_report([]), "connectivity": fixtures.connectivity_report([])}

    def test_all_consistent_gives_zero_identity_errors_and_min_wns(self):
        receipts = _base_receipts()
        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertEqual(evaluation["schema"], "atcs.evaluation/1")
        self.assertEqual(evaluation["candidateId"], "mc-1")
        self.assertEqual(evaluation["finalIdentityErrorCount"], core.known(0))
        self.assertEqual(evaluation["missingRequiredCheckCount"], core.known(0))
        expected_setup = min(v[0] for v in SCENARIO_WNS.values())
        expected_hold = min(v[1] for v in SCENARIO_WNS.values())
        self.assertEqual(evaluation["finalSetupWns"], core.known(expected_setup))
        self.assertEqual(evaluation["finalHoldWns"], core.known(expected_hold))
        self.assertEqual(evaluation["constraintFailureCount"], core.known(0))
        self.assertEqual(evaluation["constraintUnknownCount"], core.known(0))

    def test_one_missing_required_scenario_blocks_coverage_and_final_setup_wns(self):
        receipts = _base_receipts()
        del receipts["sta"]["func_ffg_cbest_125"]

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertEqual(evaluation["missingRequiredCheckCount"], core.known(1))
        self.assertFalse(core.is_known(evaluation["finalSetupWns"]))
        self.assertFalse(core.is_known(evaluation["finalHoldWns"]))

    def test_sta_input_spef_sha_mismatch_raises_identity_error(self):
        receipts = _base_receipts()
        receipts["sta"]["func_ssg_rcworst_m40"]["inputs"]["spefSha256"] = "f" * 64

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertGreaterEqual(core.value_of(evaluation["finalIdentityErrorCount"]), 1)

    def test_connectivity_report_truncated_gives_unknown_not_zero_failures(self):
        receipts = _base_receipts()
        receipts["physical"]["connectivity"] = fixtures.connectivity_report(["VDD", "VSS"], limit=2)

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertGreaterEqual(core.value_of(evaluation["constraintUnknownCount"]), 1)
        self.assertEqual(evaluation["constraintFailureCount"], core.known(0))

    def test_new_drc_identities_beyond_baseline_count_as_failures(self):
        baseline_physical = {
            "drc": fixtures.drc_report([("SPACING: Special Wire of Net VDD", (0.0, 0.0, 0.1, 0.1))]),
            "connectivity": fixtures.connectivity_report([]),
        }
        receipts = _base_receipts()
        receipts["physical"]["drc"] = fixtures.drc_report([
            ("SPACING: Special Wire of Net VDD", (0.0, 0.0, 0.1, 0.1)),
            ("SPACING: Special Wire of Net VSS", (5.0, 5.0, 5.1, 5.1)),
        ])

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, baseline_physical)

        self.assertEqual(evaluation["constraintFailureCount"], core.known(1))
        self.assertEqual(evaluation["constraintUnknownCount"], core.known(0))

    def test_estimated_spef_refuses_final_evaluation(self):
        receipts = _base_receipts()
        receipts["spef"]["corner_a"]["estimated"] = True

        with self.assertRaises(core.AtcsError) as ctx:
            verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)
        self.assertEqual(ctx.exception.code, "estimated-rc")

    def test_fixed_and_missing_prior_check_counts_come_from_compare_checks(self):
        receipts = _base_receipts()
        checks = {
            core.check_key("func_ssg_rcworst_m40", "setup", "EP1"): {
                "slack": core.known(0.05), "startpoint": "SP1", "pathGroup": "core_clock",
            },
        }
        receipts["sta"]["func_ssg_rcworst_m40"]["observation"] = _observation(
            "func_ssg_rcworst_m40", core.known(-0.100), core.known(-0.010), checks=checks
        )
        prior_observation = {
            "checks": {
                core.check_key("func_ssg_rcworst_m40", "setup", "EP1"): {
                    "slack": core.known(-0.02), "startpoint": "SP1", "pathGroup": "core_clock",
                },
            }
        }

        evaluation = verification.assemble(self.plan, receipts, prior_observation, self.baseline_physical)

        self.assertEqual(evaluation["fixedCheckCount"], core.known(1))
        self.assertEqual(evaluation["missingPriorCheckCount"], core.known(0))
        self.assertEqual(evaluation["comparison"]["fixed"], [core.check_key("func_ssg_rcworst_m40", "setup", "EP1")])


# A realistic corner-per-scenario mapping: ssg scenarios need the worst-case RC
# ("rcworst") SPEF, ffg scenarios need the best-case RC ("cbest") SPEF, each at
# its own temperature corner. Used only by the per-scenario corner identity tests
# below — `_base_plan`/`_base_receipts` above deliberately keep a single shared
# corner for every other test's simplicity.
FOUR_CORNERS = ("rcworst_m40", "rcworst_125", "cbest_m40", "cbest_125")
CORRECT_SCENARIO_CORNERS = {
    "func_ssg_rcworst_m40": "rcworst_m40",
    "func_ssg_rcworst_125": "rcworst_125",
    "func_ffg_cbest_m40": "cbest_m40",
    "func_ffg_cbest_125": "cbest_125",
}


def _spef_for_corners(corners):
    return {corner: {"path": f"{corner}.spef", "sha256": f"sha-{corner}", "inputDefSha256": DEF_SHA}
            for corner in corners}


def _sta_with_corners(receipt_corner_by_scenario):
    """Each scenario's STA receipt claims `receipt_corner_by_scenario[scenario]` as its
    corner, self-consistently (its `inputs.spefSha256` really is that corner's sha) —
    any identity error introduced by a test must come from a *wrong* corner claim, not
    from an internally-inconsistent one."""
    sta = {}
    for scenario, corner in receipt_corner_by_scenario.items():
        setup_wns, hold_wns = SCENARIO_WNS[scenario]
        sta[scenario] = {
            "corner": corner,
            "inputs": {"netlistSha256": NETLIST_SHA, "spefSha256": f"sha-{corner}"},
            "observation": _observation(scenario, core.known(setup_wns), core.known(hold_wns)),
        }
    return sta


def _corner_receipts(receipt_corner_by_scenario):
    return {
        "database": {"path": "design.enc", "sha256": "e" * 64},
        "netlist": {"path": "design.v", "sha256": NETLIST_SHA},
        "def": {"path": "design.def", "sha256": DEF_SHA},
        "spef": _spef_for_corners(FOUR_CORNERS),
        "sta": _sta_with_corners(receipt_corner_by_scenario),
        "physical": {"drc": fixtures.drc_report([]), "connectivity": fixtures.connectivity_report([])},
    }


class PerScenarioCornerIdentityTest(unittest.TestCase):
    def setUp(self):
        self.plan = verification.plan_checks(
            {"id": "mc-corners", "operations": []}, {"scenarioCorners": CORRECT_SCENARIO_CORNERS}
        )
        self.prior_observation = {"checks": {}}
        self.baseline_physical = {"drc": fixtures.drc_report([]), "connectivity": fixtures.connectivity_report([])}

    def test_correct_mapping_gives_zero_identity_errors(self):
        receipts = _corner_receipts(CORRECT_SCENARIO_CORNERS)

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertEqual(evaluation["finalIdentityErrorCount"], core.known(0))

    def test_all_four_scenarios_on_one_corner_counts_errors(self):
        # Every scenario's STA receipt claims "rcworst_m40" — correct only for
        # func_ssg_rcworst_m40 itself; the other three are on the wrong corner.
        wrong_map = {scenario: "rcworst_m40" for scenario in CORRECT_SCENARIO_CORNERS}
        receipts = _corner_receipts(wrong_map)

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertEqual(core.value_of(evaluation["finalIdentityErrorCount"]), 3)

    def test_ssg_scenario_pointing_at_cbest_spef_is_an_error(self):
        receipt_corners = dict(CORRECT_SCENARIO_CORNERS)
        receipt_corners["func_ssg_rcworst_m40"] = "cbest_m40"
        receipts = _corner_receipts(receipt_corners)

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertEqual(core.value_of(evaluation["finalIdentityErrorCount"]), 1)


class MissingIdentityLegTest(unittest.TestCase):
    def setUp(self):
        self.plan = _base_plan()
        self.prior_observation = {"checks": {}}
        self.baseline_physical = {"drc": fixtures.drc_report([]), "connectivity": fixtures.connectivity_report([])}

    def test_def_none_makes_identity_count_unknown(self):
        receipts = _base_receipts()
        receipts["def"] = None

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertFalse(core.is_known(evaluation["finalIdentityErrorCount"]))

    def test_missing_spef_input_def_sha_makes_identity_count_unknown(self):
        receipts = _base_receipts()
        del receipts["spef"]["corner_a"]["inputDefSha256"]

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertFalse(core.is_known(evaluation["finalIdentityErrorCount"]))

    def test_missing_netlist_sha_makes_identity_count_unknown(self):
        receipts = _base_receipts()
        del receipts["netlist"]["sha256"]

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertFalse(core.is_known(evaluation["finalIdentityErrorCount"]))

    def test_missing_database_sha_makes_identity_count_unknown(self):
        receipts = _base_receipts()
        del receipts["database"]["sha256"]

        evaluation = verification.assemble(self.plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertFalse(core.is_known(evaluation["finalIdentityErrorCount"]))

    def test_scenario_corners_map_absent_makes_identity_count_unknown(self):
        # A plan built without any scenarioCorners policy at all.
        plan = verification.plan_checks({"id": "mc-7", "operations": []}, {})
        receipts = _base_receipts()

        evaluation = verification.assemble(plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertFalse(core.is_known(evaluation["finalIdentityErrorCount"]))

    def test_scenario_corners_map_missing_a_required_scenario_makes_identity_count_unknown(self):
        scenario_corners = {scenario: BASE_CORNER for scenario in SCENARIO_WNS}
        del scenario_corners["func_ffg_cbest_125"]
        plan = verification.plan_checks({"id": "mc-8", "operations": []},
                                         {"scenarioCorners": scenario_corners})
        receipts = _base_receipts()

        evaluation = verification.assemble(plan, receipts, self.prior_observation, self.baseline_physical)

        self.assertFalse(core.is_known(evaluation["finalIdentityErrorCount"]))


if __name__ == "__main__":
    unittest.main()
