"""#66 D4 (ticket #71): the batch Contribution an expert session seals.

A seat works point to point through its cluster: it measures each trial, undoes the unsafe ones
and keeps a batch. `contributions.seal_session` seals that batch with per-command and aggregate
evidence read from the files the toolkit writes beside ``ops.jsonl`` (``gain.jsonl``,
``reads.jsonl``, ``domain.json``), checks its domain against the session's effective (derived)
domain, and records its value findings on the batch's net effect as advisories (replay is an
aggregator: only corrupt data or an out-of-scope edit refuses a batch).

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

No EDA: the logs are synthesized by `session_fixtures` in the shapes the toolkit writes
(ticket A's report: `domain.json` schema atcs-local-domain/1, `reads.jsonl` lines).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import contributions  # noqa: E402
from atcs import core  # noqa: E402
from atcs import workspaces  # noqa: E402
import session_fixtures as sf  # noqa: E402

CLI_PATH = FLOW_DIR / "atcs_cli.py"
# U7 is outside the plan's editDomain (U1, U2, U3) but on a target pin's net: the session derived it.
BEFORE = {"U1": "BUFX1", "U2": "BUFX1", "U3": "INVX1", "U7": "BUFX1", "FILL1": "FILLER4"}
TARGETS = ["func_ss|hold|U1/D", "func_ss|hold|U2/D", "func_ss|hold|U3/Z"]
SETUP_FLAT = ((-0.020, -0.100), (-0.020, -0.100))
DOMAIN = sf.domain_record(plan_instances=["U1", "U2", "U3"], instances=["U1", "U2", "U3", "U7"],
                          nets=["N1", "N7"], target_pins=["U1/D", "U2/D"], plan_nets=["N1"],
                          global_nets=[("CLK", 4000)], unresolved=["U9"], regions=[(0, 0, 100, 100)])


def _hold(current):
    return (-0.070, -1.200), current


def _seal(log, after, before=None, domain=DOMAIN, base_ref=None, required=("func_ss",), limitations=None,
          with_reads=True):
    with tempfile.TemporaryDirectory() as tmp:
        before_path = Path(tmp) / "before.dump"
        after_path = Path(tmp) / "after.dump"
        before_path.write_text(sf.dump_text(before if before is not None else BEFORE), encoding="utf-8")
        after_path.write_text(sf.dump_text(after), encoding="utf-8")
        result_refs = {
            "beforeDump": str(before_path), "afterDump": str(after_path),
            "evidence": {"taintedJson": None, "transcriptTaint": "clean", "ecoOutput": True},
            "fillerPatterns": [], "requiredScenarios": list(required),
            "domainText": json.dumps(domain) if domain is not None else None,
            "operatorLimitations": list(limitations or []),
        }
        return contributions.seal_session(
            base_ref or sf.make_base_ref(targets=TARGETS, target_pins=["U1/D", "U2/D"]), result_refs,
            log.ops_text(), log.gain_text(), log.reads_text() if with_reads else None)


def _codes(contribution):
    return sorted({refusal["code"] for refusal in contribution["refusals"]})


def _advisories(contribution):
    return sorted({advisory["code"] for advisory in contribution["advisories"]})


def _batch():
    """A seat's batch: a derived-instance size kept, a trial that broke setup undone, an insert and a
    move kept; point reads after each step and a final probe with fail reasons."""
    log = sf.SessionLog()
    log.point("hold", [("U1/D", "func_ss", -0.070), ("U2/D", "func_ss", -0.050)])
    log.read("atcs_paths", {"check": "hold", "topN": 5, "endPoints": ["U1/D"]}, ["path U1/D", "slack -0.0700"])
    sized = log.size("U7", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
    log.point("hold", [("U1/D", "func_ss", -0.060), ("U2/D", "func_ss", -0.050)])
    trial = log.size("U3", "INVX1", "INVX2", gain=(((-0.020, -0.100), (-0.040, -0.300)), _hold((-0.055, -0.900))))
    log.point("hold", [("U1/D", "func_ss", -0.055), ("U2/D", "func_ss", -0.048)])
    log.undo(trial, gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
    inserted = log.insert("N1", ["U2/D"], ["DELAY1"], ["atcs_w01_r1_b1"], ["atcs_w01_r1_n1"],
                          gain=(SETUP_FLAT, _hold((-0.058, -0.800))))
    log.point("hold", [("U1/D", "func_ss", -0.058), ("U2/D", "func_ss", -0.045)])
    moved = log.move("U1", "BUFX1", 10.0, 20.0, gain=(SETUP_FLAT, _hold((-0.058, -0.800))))
    log.probe("hold", _hold((-0.058, -0.800)),
              [(-0.058, "func_ss", "U1/D", "legal_fail_density:100%"), (-0.045, "func_ss", "U2/D", "break_setup:100%")],
              fail_reasons=True)
    after = {**BEFORE, "U7": "BUFX2", "atcs_w01_r1_b1": "DELAY1"}
    return log, after, {"sized": sized, "trial": trial, "inserted": inserted, "moved": moved}


class BatchFieldsTest(unittest.TestCase):
    """Every #66 D4 field is sealed, beside the existing ones."""

    @classmethod
    def setUpClass(cls):
        log, after, cls.seqs = _batch()
        cls.contribution = _seal(log, after, limitations=["U3/Z has no path in the session"])

    def test_the_batch_is_admitted_as_an_xtop_session(self):
        self.assertTrue(self.contribution["admissible"], self.contribution["refusals"])
        self.assertEqual(self.contribution["kind"], "xtop-session")
        self.assertEqual([command["seq"] for command in self.contribution["commands"]],
                         [self.seqs["sized"], self.seqs["inserted"], self.seqs["moved"]])

    def test_the_effective_domain_is_the_domain_record(self):
        self.assertEqual(self.contribution["effectiveDomain"], DOMAIN)

    def test_each_command_carries_its_own_measured_step_gain(self):
        sized, inserted, moved = self.contribution["commands"]
        self.assertEqual(sized["gain"]["seq"], self.seqs["sized"])
        self.assertEqual(sized["gain"]["fromSeq"], 0)
        hold = sized["gain"]["target"]["hold"]["func_ss"]
        self.assertAlmostEqual(hold["wns"], -0.060)
        self.assertAlmostEqual(hold["tns"], -1.000)
        self.assertAlmostEqual(hold["wnsGain"], 0.010)
        self.assertAlmostEqual(hold["tnsGain"], 0.200)
        self.assertAlmostEqual(sized["gain"]["opposite"]["setup"]["func_ss"]["wnsGain"], 0.0)
        # The insert is measured against the state the undo restored (the undo's own reading).
        self.assertEqual(inserted["gain"]["fromSeq"], self.seqs["trial"] + 1)
        self.assertAlmostEqual(inserted["gain"]["target"]["hold"]["func_ss"]["wnsGain"], 0.002)
        self.assertAlmostEqual(inserted["gain"]["target"]["hold"]["func_ss"]["tnsGain"], 0.200)
        self.assertAlmostEqual(moved["gain"]["target"]["hold"]["func_ss"]["wnsGain"], 0.0)

    def test_each_command_names_the_blockers_whose_point_slack_improved(self):
        sized, inserted, moved = self.contribution["commands"]
        self.assertEqual(sized["blockers"], ["func_ss|hold|U1/D"])
        # Before the insert the design is the post-undo state; its latest reading is the one after the size.
        self.assertEqual(inserted["blockers"], ["func_ss|hold|U1/D", "func_ss|hold|U2/D"])
        # The probe after the move reads the same slacks: nothing improved.
        self.assertEqual(moved["blockers"], [])

    def test_attempted_is_every_target_read_at_least_once(self):
        self.assertEqual(self.contribution["attempted"], ["func_ss|hold|U1/D", "func_ss|hold|U2/D"])

    def test_aggregate_gain_and_opposite_effects_are_the_net_batch_per_required_scenario(self):
        hold = self.contribution["aggregateGain"]["hold"]["func_ss"]
        self.assertAlmostEqual(hold["wnsGain"], 0.012)
        self.assertAlmostEqual(hold["tnsGain"], 0.400)
        self.assertEqual(set(self.contribution["aggregateGain"]), {"hold"})
        setup = self.contribution["oppositeEffects"]["setup"]["func_ss"]
        self.assertAlmostEqual(setup["wnsGain"], 0.0)
        self.assertEqual(set(self.contribution["oppositeEffects"]), {"setup"})

    def test_physical_risk_counts_the_kept_batch(self):
        self.assertEqual(self.contribution["physicalRisk"],
                         {"legalFailures": 1, "newCells": 1, "newNets": 1, "moves": 1, "tainted": False})

    def test_undone_counts_the_undone_trials_with_their_commands(self):
        undone = self.contribution["undone"]
        self.assertEqual(undone["count"], 1)
        self.assertEqual([(c["seq"], c["proc"], c["args"]["instance"]) for c in undone["commands"]],
                         [(self.seqs["trial"], "atcs_size_cell", "U3")])
        self.assertAlmostEqual(undone["commands"][0]["gain"]["opposite"]["setup"]["func_ss"]["wnsGain"], -0.020)

    def test_reads_summarize_the_read_log(self):
        reads = self.contribution["reads"]
        self.assertTrue(reads["present"])
        self.assertEqual(reads["lines"], 5)
        self.assertEqual(reads["afterMutation"], 3)
        self.assertEqual(reads["byProc"], {"atcs_paths": 1, "atcs_point": 4})
        first = reads["entries"][0]
        self.assertEqual((first["seq"], first["proc"], first["rows"]), (0, "atcs_point", 2))
        self.assertEqual(first["args"], {"check": "hold", "endPoints": ["U1/D", "U2/D"]})
        self.assertEqual(first["rowsDigest"], sf.rows_digest([
            {"endpoint": "U1/D", "scenario": "func_ss", "slack": -0.070},
            {"endpoint": "U2/D", "scenario": "func_ss", "slack": -0.050}]))

    def test_limitations_carry_the_operators_then_the_seals(self):
        limitations = self.contribution["limitations"]
        self.assertEqual(limitations[0], "operator: U3/Z has no path in the session")
        self.assertIn("seal: 1 of 3 target checks never read: ['func_ss|hold|U3/Z']", limitations)

    def test_the_existing_fields_are_kept(self):
        for key in ("delta", "touches", "predicted", "reference", "gainSummary", "failReasons", "value",
                    "valueDetail", "targets", "targetPins", "session", "admissible", "refusals", "outOfScope"):
            self.assertIn(key, self.contribution)
        self.assertEqual(self.contribution["failReasons"], {"hold": {"break_setup": 1, "legal_fail_density": 1}})


class EffectiveDomainTest(unittest.TestCase):
    """The seal's domain check reads the effective domain, falling back to the plan's."""

    def _derived_edit(self):
        log = sf.SessionLog()
        log.size("U7", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        return log, {**BEFORE, "U7": "BUFX2"}

    def test_a_kept_edit_on_a_derived_instance_is_admitted(self):
        log, after = self._derived_edit()
        contribution = _seal(log, after)
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["outOfScope"], [])
        self.assertEqual(contribution["session"]["domainSource"], "domain.json")

    def test_without_domain_json_the_plan_domain_is_checked(self):
        log, after = self._derived_edit()
        contribution = _seal(log, after, domain=None)
        self.assertEqual(_codes(contribution), ["out-of-scope"])
        self.assertEqual(contribution["outOfScope"], ["U7"])
        self.assertIsNone(contribution["effectiveDomain"])
        self.assertEqual(contribution["session"]["domainSource"], "plan")
        self.assertTrue(any("domain.json absent" in text for text in contribution["limitations"]))

    def test_an_instance_outside_the_effective_domain_is_still_refused(self):
        log = sf.SessionLog()
        log.size("X9", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        contribution = _seal(log, {**BEFORE, "X9": "BUFX2"}, before={**BEFORE, "X9": "BUFX1"})
        self.assertEqual(_codes(contribution), ["out-of-scope"])
        self.assertEqual(contribution["outOfScope"], ["X9"])

    def test_session_created_instances_stay_in_domain(self):
        log = sf.SessionLog()
        log.insert("N7", ["U7/A"], ["DELAY1"], ["atcs_w01_r1_b1"], ["atcs_w01_r1_n1"],
                   gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        contribution = _seal(log, {**BEFORE, "atcs_w01_r1_b1": "DELAY1"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])

    def test_an_unreadable_domain_record_falls_back_to_the_plan_domain(self):
        log, after = self._derived_edit()
        for domain in ({"schema": "something-else/1", "instances": ["U7"]}, {"schema": "atcs-local-domain/1",
                                                                            "instances": "U7"}):
            contribution = _seal(log, after, domain=domain)
            self.assertEqual(contribution["outOfScope"], ["U7"])
            self.assertIsNone(contribution["effectiveDomain"])
            self.assertTrue(any("domain.json unreadable" in text for text in contribution["limitations"]))

    def test_a_failed_derivation_is_sealed_with_its_error_as_a_limitation(self):
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        failed = sf.domain_record(plan_instances=["U1", "U2", "U3"], instances=["U1", "U2", "U3"],
                                  error="get_nets failed")
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"}, domain=failed)
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["effectiveDomain"]["error"], "get_nets failed")
        self.assertIn("seal: the session's domain derivation failed (get_nets failed); the plan's domain held",
                      contribution["limitations"])


class BatchNetValueAdvisoryTest(unittest.TestCase):
    """The value findings read the batch's net effect (last reading against the reference), never a
    step, and are advisories: they never refuse a batch."""

    def test_a_mid_batch_regression_that_was_undone_does_not_refuse(self):
        log = sf.SessionLog()
        trial = log.size("U3", "INVX1", "INVX2", gain=(((-0.020, -0.100), (-0.090, -0.900)), _hold((-0.060, -1.0))))
        log.undo(trial, gain=(SETUP_FLAT, _hold((-0.070, -1.200))))
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["advisories"], [])
        self.assertEqual(contribution["undone"]["count"], 1)

    def test_a_kept_step_regression_the_batch_recovers_does_not_refuse(self):
        log = sf.SessionLog()
        log.size("U3", "INVX1", "INVX2", gain=(((-0.020, -0.100), (-0.050, -0.400)), _hold((-0.060, -1.0))))
        log.size("U1", "BUFX1", "BUFX2", gain=(((-0.020, -0.100), (-0.020, -0.150)), _hold((-0.050, -0.9))))
        contribution = _seal(log, {**BEFORE, "U3": "INVX2", "U1": "BUFX2"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        first = contribution["commands"][0]["gain"]["opposite"]["setup"]["func_ss"]
        self.assertAlmostEqual(first["wnsGain"], -0.030)

    def test_a_net_opposite_wns_loss_above_one_rounding_step_is_an_advisory_never_a_refusal(self):
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        log.size("U2", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.050, -0.800))))
        log.size("U3", "INVX1", "INVX2", gain=(((-0.020, -0.100), (-0.0202, -0.100)), _hold((-0.040, -0.600))))
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2", "U2": "BUFX2", "U3": "INVX2"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["refusals"], [])
        self.assertEqual(_advisories(contribution), ["breaks-opposite-check"])
        self.assertIn("setup", contribution["advisories"][0]["detail"])
        self.assertEqual(len(contribution["commands"]), 3)
        self.assertAlmostEqual(contribution["oppositeEffects"]["setup"]["func_ss"]["wnsGain"], -0.0002)

    def test_a_net_opposite_wns_within_one_rounding_step_is_admitted(self):
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(((-0.020, -0.100), (-0.0201, -0.101)), _hold((-0.060, -1.000))))
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["advisories"], [])

    def test_a_net_opposite_wns_loss_outside_the_required_scenarios_is_not_flagged(self):
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(((-0.020, -0.100), (-0.090, -0.900)), _hold((-0.060, -1.000))))
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"}, required=("func_other",))
        self.assertNotIn("breaks-opposite-check", [a["code"] for a in contribution["advisories"]
                                                   if "WNS got worse" in a["detail"]])
        self.assertIsNone(contribution["oppositeEffects"]["setup"]["func_other"])

    def test_no_gain_and_a_broken_target_check_are_advisories_too(self):
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.090, -1.500))))
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(_advisories(contribution), ["breaks-target-check", "no-predicted-gain"])

    def test_corrupt_data_still_refuses(self):
        """A log that does not explain the dumps (U2 changed with no command) is refused, and an
        unparseable ops log is unusable input."""
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2", "U2": "BUFX4"})
        self.assertFalse(contribution["admissible"])
        self.assertEqual(_codes(contribution), ["trace-mismatch"])
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.seal_session(sf.make_base_ref(targets=TARGETS), {}, "{not json\n", "")
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_the_seal_and_the_knowledge_state_the_gates_are_batch_net(self):
        self.assertIn("batch-net", " ".join(contributions.seal_session.__doc__.split()))
        text = " ".join((PACK_DIR / "knowledge" / "contribution-and-merge.md").read_text(encoding="utf-8").split())
        for words in ("batch-net", "effectiveDomain", "aggregateGain", "oppositeEffects", "physicalRisk"):
            self.assertIn(words, text)


class T06DummySealTest(unittest.TestCase):
    """D-T06-4(d) (#64 T06 w01 seq1): the one real insertion of the Run, `insert_dummy_cell` on the dmcontrol
    CDN pin, created swerv_dbg/atcs_w01_r1_dum0 (DEL025D1BWP30P140HVT) in its pin's module. The toolkit now
    logs it kept with that instance; the seal admits it and carries the command into the batch."""

    DUMMY = "swerv_dbg/atcs_w01_r1_dum0"

    def _log(self):
        log = sf.SessionLog()
        seq = log._line("insert_dummy_cell", "atcs_insert_dummy",
                        {"pin": "swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_/CDN",
                         "master": "DEL025D1BWP30P140HVT", "newInstance": "atcs_w01_r1_dum0"},
                        "kept", {self.DUMMY: None}, {self.DUMMY: "DEL025D1BWP30P140HVT"}, 1, matchesRequest=True)
        log.gain(seq, "mutation", SETUP_FLAT, _hold((-0.069, -1.190)))
        return log

    def test_the_kept_dummy_is_sealed_as_a_batch_command(self):
        contribution = _seal(self._log(), {**BEFORE, self.DUMMY: "DEL025D1BWP30P140HVT"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["kind"], "xtop-session")
        self.assertEqual([command["cmd"] for command in contribution["commands"]], ["insert_dummy_cell"])


class ReadLogShapeTest(unittest.TestCase):
    def test_no_read_log_is_sealed_as_absent_and_never_refuses(self):
        log = sf.SessionLog()
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"}, with_reads=False)
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["reads"], {"present": False, "lines": 0, "afterMutation": 0, "byProc": {},
                                                 "entries": [], "malformed": []})
        self.assertEqual(contribution["attempted"], [])
        self.assertEqual(contribution["commands"][0]["blockers"], [])

    def test_a_malformed_read_line_is_named_and_never_refuses(self):
        log = sf.SessionLog()
        log.point("hold", [("U1/D", "func_ss", -0.070)])
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        log.point("hold", [("U1/D", "func_ss", -0.060)])
        log.reads.insert(1, "not json")
        text = "".join((line if isinstance(line, str) else json.dumps(line)) + "\n" for line in log.reads)
        log.reads_text = lambda: text
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"})
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["reads"]["malformed"], [2])
        self.assertEqual(contribution["commands"][0]["blockers"], ["func_ss|hold|U1/D"])

    def test_a_null_scenario_point_row_reads_the_target_of_its_check(self):
        log = sf.SessionLog()
        log.point("hold", [("U1/D", None, -0.070)])
        log.size("U1", "BUFX1", "BUFX2", gain=(SETUP_FLAT, _hold((-0.060, -1.000))))
        log.point("hold", [("U1/D", None, -0.060)])
        log.point("setup", [("U2/D", None, -0.010)])
        contribution = _seal(log, {**BEFORE, "U1": "BUFX2"})
        self.assertEqual(contribution["commands"][0]["blockers"], ["func_ss|hold|U1/D"])
        # A setup read of U2/D does not attempt the hold check on U2/D.
        self.assertEqual(contribution["attempted"], ["func_ss|hold|U1/D"])


class CaptureBatchContributionTest(unittest.TestCase):
    """`capture-contribution` reads domain.json, reads.jsonl and summary.json beside ops.jsonl."""

    def setUp(self):
        self.workspace = Path(tempfile.mkdtemp(prefix="atcs-batch-capture-"))
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.base_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute", "database": {"path": "db.enc", "sha256": "a" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None, "spef": {}, "sdc": [],
            "tools": {}, "scenarios": ["func_ss"], "parentId": None,
        })

    def _seed(self):
        raw = {
            "taskId": "w01", "baseStateId": self.base_state["id"], "problem": "hold cluster",
            "targets": TARGETS, "targetPins": ["U1/D", "U2/D"],
            "editDomain": {"instances": ["U1", "U2", "U3"], "nets": ["N1"], "regions": [[0, 0, 100, 100]]},
            "protected": {"instances": [], "nets": []}, "mayAffect": [], "actions": ["size_cell"],
            "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
            "scope": {"commands": ["atcs_size_cell", "atcs_insert_buffer", "atcs_move_cell", "atcs_undo"],
                      "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
        }
        validated = workspaces.validate_work_package(raw, self.base_state, {"pgVerification": False})
        manifest = workspaces.prepare(validated, str(self.workspace), self.base_state)
        workers = {"w01": {
            "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
            "namePrefix": manifest["namePrefix"], "opsLog": str(Path(manifest["root"]) / "ops.jsonl"),
            "workPackage": validated, "workspaceManifest": manifest,
        }}
        (self.workspace / "state").mkdir(parents=True, exist_ok=True)
        (self.workspace / "state" / "workers.json").write_text(
            json.dumps({"workers": workers, "requiredSlots": ["w01"]}), encoding="utf-8")
        return self.workspace / manifest["root"], manifest["namePrefix"]

    def _capture(self):
        result = subprocess.run([sys.executable, str(CLI_PATH), "capture-contribution", str(self.workspace), "w01"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state" / "contribution-w01.json").read_text())

    def test_a_batch_on_a_derived_domain_is_captured_with_every_field(self):
        root, prefix = self._seed()
        self.assertEqual(prefix, "atcs_w01_r1_")
        log, after, _ = _batch()
        sf.write_session(root, log, BEFORE, after, domain=DOMAIN,
                         summary={"limitations": ["U3/Z has no path in the session"]})
        contribution = self._capture()
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["effectiveDomain"], DOMAIN)
        self.assertEqual(contribution["attempted"], ["func_ss|hold|U1/D", "func_ss|hold|U2/D"])
        self.assertEqual(contribution["reads"]["lines"], 5)
        self.assertEqual(contribution["undone"]["count"], 1)
        self.assertEqual(contribution["physicalRisk"]["newCells"], 1)
        self.assertEqual(contribution["limitations"][0], "operator: U3/Z has no path in the session")
        self.assertEqual([c["blockers"] for c in contribution["commands"]],
                         [["func_ss|hold|U1/D"], ["func_ss|hold|U1/D", "func_ss|hold|U2/D"], []])

    def test_without_domain_json_the_derived_edit_is_refused_out_of_scope(self):
        root, _ = self._seed()
        log, after, _ = _batch()
        sf.write_session(root, log, BEFORE, after)
        contribution = self._capture()
        self.assertFalse(contribution["admissible"])
        self.assertEqual(contribution["outOfScope"], ["U7"])
        self.assertEqual(contribution["session"]["domainSource"], "plan")


class WorkerResultDescriptionTest(unittest.TestCase):
    def test_each_worker_result_output_describes_the_batch_record(self):
        text = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
        for slot in range(1, 7):
            block = text.split(f"  - name: workerResult0{slot}\n", 1)[1].split("\n  - name: ", 1)[0]
            words = " ".join(block.split())
            for field in ("effectiveDomain", "attempted", "aggregateGain", "oppositeEffects", "physicalRisk",
                          "undone", "reads", "limitations", "batch-net", "advisories"):
                self.assertIn(field, words, f"workerResult0{slot}")

if __name__ == "__main__":
    unittest.main()
