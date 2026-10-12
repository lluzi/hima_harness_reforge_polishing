"""End-to-end subprocess test of the whole CLI route: `task-prepare-case` ->
`task-measure-incumbent` -> two rounds (Engineer: `snapshot`/`mage-round`/
`candidate`; consumers: `evaluate`/`review`) -> `task-decide-round` (x2) ->
`task-evaluate-placement` -> `task-deliver`, on the synthetic 2x2 case from
`fixtures.make_case`, driven exactly as a Harness run would drive the
program tasks and resident tools, plus a direct call into `tools/read-
mage.py` standing in for the Harness Reader (this Pack-local unittest never
loads the Harness itself).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla  # noqa: E402

from tests import fixtures  # noqa: E402


FLOW_DIR = Path(__file__).resolve().parents[1]
CLI = FLOW_DIR / "mage_placement_cli.py"
READER = FLOW_DIR.parent / "tools" / "read-mage.py"
STANDIN = FLOW_DIR / "tests" / "standin_mage.py"


def _run(args, cwd=None, env=None):
    result = subprocess.run(
        [sys.executable, str(CLI)] + [str(a) for a in args],
        cwd=cwd, env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, f"{args} failed ({result.returncode}): {result.stderr}\n{result.stdout}"
    return result


def _run_reader(kind, report, out, workspace):
    result = subprocess.run(
        [sys.executable, str(READER), kind, str(report), str(out), str(workspace)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"reader {kind} failed: {result.stderr}\n{result.stdout}"
    return json.loads(Path(out).read_text(encoding="utf-8"))


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


def _resident_output(values, outcome="completed", summary="", stop_reason=""):
    return {
        "observations": [{"contentSha256": values["_contentSha256"], "values": values["values"]}],
        "engineering": {"outcome": outcome, "summary": summary, "stopReason": stop_reason},
    }


class CliRouteTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        os.symlink(FLOW_DIR, self.workspace / "flow")

        self.case = fixtures.make_case(self.root, mage_executable=[sys.executable, str(STANDIN)])
        self.site_caps = fixtures.make_site_capabilities(self.root, [sys.executable, str(STANDIN)])

    def tearDown(self):
        self._tmp.cleanup()

    def _task(self, name, input_obj):
        task_input = _write_json(self.root / f"{name}-input.json", input_obj)
        task_output = self.root / f"{name}-output.json"
        _run(["task-" + name, self.workspace, task_input, task_output])
        return json.loads(task_output.read_text(encoding="utf-8"))["value"]

    def _candidate_pla_text(self, dbu_per_um, ovl_b_on_target, place_key_v=False):
        """Build one round's candidate PLA text from the start state.

        `place_key_v=True` adds KEY_V as an actual Fit record inside the
        interior vertical scribe lane V:1 (cross range 1060-1120 um, the
        60 um scribe band between the two die columns), oriented along
        the lane (900 um along y, 60 um across x) with its bottom clear
        of both the lower (0-60 um) and the die-row (860-920 um) horizontal
        scribe bands -- y range 300-1200 um sits entirely inside V:1's own
        along range [0, 1780] and outside every H lane's cross range, so
        `lanes.assign_lane` resolves it to exactly `{"axis": "V", "track": 1}`.
        `place_key_v=False` keeps the old behaviour: KEY_V stays a dropped
        structure (`placedFlag: 0` in `drops`), never a Fit.
        """
        start_text = Path(self.case["files"]["startState"]).read_text(encoding="utf-8")
        doc = pla.read_pla(start_text, dbu_per_um)
        if ovl_b_on_target:
            for fit in doc["fits"]:
                if fit["base"] == "OVL_B":
                    l, b, r, t = fit["boxDbu"]
                    width = r - l
                    # Group G1_2's CT target is (1290, 30) um -> centre the box there.
                    new_centre_x = core.um_to_dbu("1290", dbu_per_um)
                    fit["boxDbu"] = [new_centre_x - width // 2, b, new_centre_x + width // 2, t]
        if place_key_v:
            doc["fits"].append({
                "id": "KEY_V.KEY_V_1", "base": "KEY_V", "inst": "KEY_V.KEY_V_1",
                "boxDbu": [
                    core.um_to_dbu("1060", dbu_per_um), core.um_to_dbu("300", dbu_per_um),
                    core.um_to_dbu("1120", dbu_per_um), core.um_to_dbu("1200", dbu_per_um),
                ],
                "extraRot": "NULL", "postfix": "", "inGroup": "",
            })
            doc["drops"] = []
        else:
            doc["drops"] = [{
                "id": "KEY_V.KEY_V", "base": "KEY_V", "inst": "KEY_V.KEY_V",
                "boxDbu": [0, 0, core.um_to_dbu("900", dbu_per_um), core.um_to_dbu("60", dbu_per_um)],
                "extraRot": "NULL", "placedFlag": 0, "postfix": "", "inGroup": "",
            }]
        return pla.write_pla(doc, dbu_per_um, units="um")

    def _build_candidate(self, round_no, ovl_b_on_target, ledger, place_key_v=False):
        """Run the Engineer's part of one round: `mage-round` + `candidate`.

        Returns `(round_dir, candidate_doc, candidate_resident_output,
        evals_by_role)` — `evals_by_role` lets the caller see each
        consumer's Findings (and their ids) before authoring that round's
        Request files, without running the round twice.
        """
        dbu_per_um = self.case["manifest"]["dbuPerUm"]
        pla_path = self.root / f"round{round_no}.pla"
        pla_path.write_text(
            self._candidate_pla_text(dbu_per_um, ovl_b_on_target, place_key_v=place_key_v), encoding="utf-8",
        )

        round_dir = self.workspace / "placement" / f"round-{round_no:02d}"
        env = dict(os.environ)
        env["MAGE_STANDIN_ROWS"] = "{}"
        result = subprocess.run(
            [sys.executable, str(CLI), "mage-round", str(self.workspace),
             "--round", str(round_no), "--pla", str(pla_path), "--role", "engineer",
             "--out-dir", str(round_dir)],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

        ledger_path = self.root / f"round{round_no}-ledger.json"
        _write_json(ledger_path, ledger)

        candidate_path = self.root / f"round{round_no}-candidate.json"
        _run([
            "candidate", self.workspace, "--round", str(round_no), "--round-dir", str(round_dir),
            "--ledger", str(ledger_path), "--out", str(candidate_path),
        ])
        candidate_doc = json.loads(candidate_path.read_text(encoding="utf-8"))

        live_candidate_path = self.workspace / "state" / "round" / "placement-candidate.json"
        live_candidate_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidate_path, live_candidate_path)

        candidate_values = _run_reader(
            "placement-candidate", live_candidate_path,
            self.root / f"r{round_no}-candidate-values.json", self.workspace,
        )
        candidate_resident_output = _resident_output(
            {"_contentSha256": core.file_sha256(live_candidate_path), "values": candidate_values["values"]},
        )

        evals_by_role = {}
        for role in ("litho-pie", "metrology", "alignment", "wat"):
            eval_result = json.loads(subprocess.run(
                [sys.executable, str(CLI), "evaluate", str(self.workspace), "--consumer", role,
                 "--candidate", str(round_dir / "out" / "snapshot.json"), "--out-dir", str(self.root / "eval" / role)],
                capture_output=True, text=True,
            ).stdout)
            evals_by_role[role] = eval_result

        return round_dir, candidate_doc, candidate_resident_output, evals_by_role

    def _build_reviews(self, round_no, evals_by_role, requests_by_role):
        """Assemble + validate each role's `mage.consumer-review/1`, copy it
        to the live `state/round/review-<role>.json`, and run its Reader.
        Returns `(review_docs, review_resident_outputs)`."""
        review_resident_outputs = {}
        review_docs = {}
        for role, eval_result in evals_by_role.items():
            findings_path = _write_json(self.root / f"round{round_no}-{role}-findings.json", eval_result)
            requests_path = _write_json(self.root / f"round{round_no}-{role}-requests.json", requests_by_role.get(role, []))
            review_path = self.root / f"round{round_no}-review-{role}.json"
            _run([
                "review", self.workspace, "--consumer", role, "--round", str(round_no),
                "--findings", findings_path, "--requests", requests_path, "--out", review_path,
            ])
            review_doc = json.loads(review_path.read_text(encoding="utf-8"))
            review_docs[role] = review_doc

            live_review_path = self.workspace / "state" / "round" / f"review-{role}.json"
            shutil.copyfile(review_path, live_review_path)
            review_values = _run_reader(
                "consumer-review", live_review_path,
                self.root / f"r{round_no}-{role}-values.json", self.workspace,
            )
            review_resident_outputs[role] = _resident_output(
                {"_contentSha256": core.file_sha256(live_review_path), "values": review_values["values"]},
            )

        return review_docs, review_resident_outputs

    def test_full_route_two_rounds(self):
        # MAX_ORDER_DEVIATION is 2, not the contract default of 1: this
        # fixture's own target table places G1 twice (OVL_A, OVL_B) either
        # side of G2's single AL_X, so the requested (CSV) order and the
        # placed order differ by exactly 2 positions regardless of where
        # OVL_B sits along its lane -- a structural property of this case,
        # not something either round's candidate changes. A real Goal
        # knob, not a rule change, is what accommodates it.
        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 2}

        prepare_value = self._task("prepare-case", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            **goal,
        })

        incumbent_value = self._task("measure-incumbent", {
            "CASE": prepare_value, "INCUMBENT_COMPARISON": "retained",
        })
        self.assertIn("snapshotSha256", incumbent_value)

        # Round 1: OVL_B is 150um off its CT target -> litho-pie hard-fails and
        # requests a move; WAT's KEY_V is (and stays) dropped -> WAT hard-fails
        # too and requests it be placed.
        round1_dir, candidate1, candidate1_ro, evals1 = self._build_candidate(
            1, ovl_b_on_target=False, ledger=[],
        )
        litho_findings1 = evals1["litho-pie"]["findings"]
        self.assertTrue(any(f["status"] == "fail" and f["severity"] == "hard" for f in litho_findings1))

        # Author the round-1 Requests now that we can see their Finding ids.
        litho_fail1 = next(f for f in litho_findings1 if f["status"] == "fail" and f["severity"] == "hard")
        wat_fail1 = next(f for f in evals1["wat"]["findings"] if f["status"] == "fail" and f["severity"] == "hard")
        requests_round1 = {
            "litho-pie": [{
                "fromFinding": litho_fail1["id"], "consumer": "litho-pie",
                "requestedOutcome": {"kind": "move", "targets": litho_fail1["targets"], "limitsUm": {}, "text": "move OVL_B onto its CT target"},
                "acceptableAlternatives": [], "strength": "hard",
            }],
            "wat": [{
                "fromFinding": wat_fail1["id"], "consumer": "wat",
                "requestedOutcome": {"kind": "place", "targets": wat_fail1["targets"], "limitsUm": {}, "text": "place KEY_V"},
                "acceptableAlternatives": [], "strength": "hard",
            }],
        }
        reviews1, review1_ro = self._build_reviews(1, evals1, requests_round1)
        litho_request1 = reviews1["litho-pie"]["requests"][0]
        wat_request1 = reviews1["wat"]["requests"][0]

        decision1 = self._task("decide-round", {
            "ROUND": 1, "CANDIDATE": candidate1_ro,
            "REVIEW_LITHO_PIE": review1_ro["litho-pie"], "REVIEW_METROLOGY": review1_ro["metrology"],
            "REVIEW_ALIGNMENT": review1_ro["alignment"], "REVIEW_WAT": review1_ro["wat"],
            **goal,
        })
        self.assertEqual(decision1["route"], "continue")
        self.assertEqual(decision1["openRequestCount"], 2)

        # Round 2: OVL_B is corrected onto its CT target AND KEY_V is placed
        # as a real Fit inside the interior vertical scribe lane V:1 (see
        # `_candidate_pla_text`'s docstring for the exact box) -- both of
        # round 1's Requests are genuinely resolved, litho-pie and WAT both
        # clear their hard fails, nobody files a new Request, and the
        # round legitimately stops under the spec's own "no hard-fail
        # Finding and no open Request" rule.
        ledger_round2 = [
            {"schema": "mage.ledger-entry/1", "id": "L-1", "request": litho_request1["id"], "answer": "satisfied",
             "answeredInSnapshot": "pending", "evidence": [], "note": "OVL_B moved onto its CT target"},
            {"schema": "mage.ledger-entry/1", "id": "L-2", "request": wat_request1["id"], "answer": "satisfied",
             "answeredInSnapshot": "pending", "evidence": [], "note": "KEY_V placed in scribe lane V:1"},
        ]
        round2_dir, candidate2, candidate2_ro, evals2 = self._build_candidate(
            2, ovl_b_on_target=True, ledger=ledger_round2, place_key_v=True,
        )
        self.assertEqual(candidate2["metrics"]["drops"]["count"], 0)
        self.assertFalse(any(f["status"] == "fail" and f["severity"] == "hard" for f in evals2["litho-pie"]["findings"]))
        self.assertFalse(any(f["status"] == "fail" and f["severity"] == "hard" for f in evals2["wat"]["findings"]))
        reviews2, review2_ro = self._build_reviews(2, evals2, {})

        decision2 = self._task("decide-round", {
            "ROUND": 2, "CANDIDATE": candidate2_ro,
            "REVIEW_LITHO_PIE": review2_ro["litho-pie"], "REVIEW_METROLOGY": review2_ro["metrology"],
            "REVIEW_ALIGNMENT": review2_ro["alignment"], "REVIEW_WAT": review2_ro["wat"],
            **goal,
        })
        self.assertEqual(decision2["route"], "stop")
        self.assertEqual(decision2["stopReason"], "no consumer hard failure and no open request")
        self.assertEqual(decision2["openRequestCount"], 0)

        evaluation = self._task("evaluate-placement", {
            "DECISION": decision2, "INCUMBENT": incumbent_value, **goal,
        })
        # All seven delivery rules PASS: KEY_V is placed (drops == 0), OVL_B
        # is on target, and the stand-in MAGE wrote zero rows for every
        # native verify type -> goalMet is true.
        self.assertEqual(evaluation["rules"], {
            "placement-delivery-ready": "PASS", "priority-all-placed": "PASS",
            "no-native-violation": "PASS", "drops-within-goal": "PASS",
            "target-limit-met": "PASS", "order-within-goal": "PASS", "no-open-requests": "PASS",
        })
        self.assertTrue(evaluation["goalMet"])

        report = self._task("deliver", {"EVALUATION": evaluation})
        self.assertEqual(report["goalMet"], True)

        package_path = self.workspace / "delivery" / "placement-artifacts.tar.gz"
        self.assertTrue(package_path.is_file())
        with tarfile.open(package_path) as archive:
            names = archive.getnames()
        self.assertTrue(any("round-01" in n for n in names))
        self.assertTrue(any("round-02" in n for n in names))

    def test_no_improvement_for_two_rounds_stops_with_a_decision_request(self):
        """KEY_V stays dropped every round (WAT keeps hard-failing and
        keeps filing a `place` Request on it); litho-pie, once its own
        OVL_B hard fail clears in round 2, files a `keep` preference
        Request on the very same target -- a genuine consumer conflict
        every round from round 2 on, so each of those rounds carries at
        least one Decision Request. Round 2 improves on round 1 (litho's
        hard fail clears); rounds 3 and 4 then repeat round 2's state
        exactly, so round 4 is the second round in a row with no
        improvement and stops under that rule (not the round-limit, which
        it also happens to hit) -- `goalMet` stays false the whole time
        because KEY_V is still dropped."""
        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 2}

        prepare_value = self._task("prepare-case", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            **goal,
        })
        incumbent_value = self._task("measure-incumbent", {
            "CASE": prepare_value, "INCUMBENT_COMPARISON": "retained",
        })

        # Round 1: baseline, exactly as in test_full_route_two_rounds.
        _d1, _c1, c1_ro, evals1 = self._build_candidate(1, ovl_b_on_target=False, ledger=[])
        litho_fail1 = next(f for f in evals1["litho-pie"]["findings"] if f["status"] == "fail" and f["severity"] == "hard")
        wat_fail1 = next(f for f in evals1["wat"]["findings"] if f["status"] == "fail" and f["severity"] == "hard")
        requests1 = {
            "litho-pie": [{
                "fromFinding": litho_fail1["id"], "consumer": "litho-pie",
                "requestedOutcome": {"kind": "move", "targets": litho_fail1["targets"], "limitsUm": {}, "text": "move OVL_B onto its CT target"},
                "acceptableAlternatives": [], "strength": "hard",
            }],
            "wat": [{
                "fromFinding": wat_fail1["id"], "consumer": "wat",
                "requestedOutcome": {"kind": "place", "targets": ["KEY_V.KEY_V"], "limitsUm": {}, "text": "place KEY_V"},
                "acceptableAlternatives": [], "strength": "hard",
            }],
        }
        reviews1, review1_ro = self._build_reviews(1, evals1, requests1)
        decision1 = self._task("decide-round", {
            "ROUND": 1, "CANDIDATE": c1_ro,
            "REVIEW_LITHO_PIE": review1_ro["litho-pie"], "REVIEW_METROLOGY": review1_ro["metrology"],
            "REVIEW_ALIGNMENT": review1_ro["alignment"], "REVIEW_WAT": review1_ro["wat"],
            **goal,
        })
        self.assertEqual(decision1["route"], "continue")

        previous_requests = {
            "litho-pie": reviews1["litho-pie"]["requests"][0], "wat": reviews1["wat"]["requests"][0],
        }

        # Rounds 2, 3 and 4 all carry the SAME state: OVL_B corrected
        # (litho-pie's hard fail cleared for good), KEY_V still dropped
        # (WAT's hard fail never clears). From round 2 on, litho-pie files
        # a `keep` preference on KEY_V's own target -- in real conflict
        # with WAT's `place` Request on that same target -- so every one
        # of these rounds' open Requests produces a Decision Request.
        decisions = {1: decision1}
        for round_no in (2, 3, 4):
            ledger = [
                {"schema": "mage.ledger-entry/1", "id": "L-litho", "request": previous_requests["litho-pie"]["id"],
                 "answer": "declined", "answeredInSnapshot": "pending", "evidence": [],
                 "note": "round %d: see this round's own findings" % (round_no - 1)},
                {"schema": "mage.ledger-entry/1", "id": "L-wat", "request": previous_requests["wat"]["id"],
                 "answer": "declined", "answeredInSnapshot": "pending", "evidence": [],
                 "note": "capacity-limited; KEY_V stays dropped"},
            ]
            _dir, candidate, candidate_ro, evals = self._build_candidate(
                round_no, ovl_b_on_target=True, ledger=ledger,
            )
            self.assertFalse(any(f["status"] == "fail" and f["severity"] == "hard" for f in evals["litho-pie"]["findings"]))
            wat_fail = next(f for f in evals["wat"]["findings"] if f["status"] == "fail" and f["severity"] == "hard")
            requests = {
                "litho-pie": [{
                    "fromFinding": evals["litho-pie"]["findings"][0]["id"], "consumer": "litho-pie",
                    "requestedOutcome": {"kind": "keep", "targets": ["KEY_V.KEY_V"], "limitsUm": {},
                                          "text": "keep the current layout; do not disturb it for KEY_V"},
                    "acceptableAlternatives": [], "strength": "preference",
                }],
                "wat": [{
                    "fromFinding": wat_fail["id"], "consumer": "wat",
                    "requestedOutcome": {"kind": "place", "targets": ["KEY_V.KEY_V"], "limitsUm": {}, "text": "place KEY_V"},
                    "acceptableAlternatives": [], "strength": "hard",
                }],
            }
            reviews, review_ro = self._build_reviews(round_no, evals, requests)
            decision = self._task("decide-round", {
                "ROUND": round_no, "CANDIDATE": candidate_ro,
                "REVIEW_LITHO_PIE": review_ro["litho-pie"], "REVIEW_METROLOGY": review_ro["metrology"],
                "REVIEW_ALIGNMENT": review_ro["alignment"], "REVIEW_WAT": review_ro["wat"],
                **goal,
            })
            decisions[round_no] = decision
            previous_requests = {"litho-pie": reviews["litho-pie"]["requests"][0], "wat": reviews["wat"]["requests"][0]}
            self.assertGreaterEqual(decision["decisionRequestCount"], 1)

        self.assertEqual(decisions[2]["route"], "continue")
        self.assertEqual(decisions[3]["route"], "continue")
        self.assertEqual(decisions[4]["route"], "stop")
        self.assertEqual(decisions[4]["stopReason"], "no improvement for two consecutive rounds")

        # decisions[4]["decisionRequestCount"] >= 1 (asserted above via the round loop) is only a
        # count; `evaluate-placement`/`deliver` must carry the actual Decision Request documents
        # through to the final report (its own `DECISION` input is this committed value, never the
        # on-disk `state/round-decision.json`), so a Host-level reader of the delivered report can
        # still see what the open conflict actually was.
        self.assertGreaterEqual(len(decisions[4]["decisionRequests"]), 1)

        evaluation = self._task("evaluate-placement", {
            "DECISION": decisions[4], "INCUMBENT": incumbent_value, **goal,
        })
        self.assertFalse(evaluation["goalMet"])
        self.assertEqual(evaluation["rules"]["drops-within-goal"], "FAIL")
        self.assertEqual(evaluation["decisionRequests"], decisions[4]["decisionRequests"])

    def test_fill_and_experiment_route(self):
        """Round 1 replays with `--fill` (the Pack's auto-refine stage,
        converge lines from the manifest); round 2 sources an
        Engineer-authored `--experiment` file. The candidate records the
        fill flag, the experiment sha256, and both scripts with real
        hashes, and the Reader reports the three native facts and a known
        violation total."""
        root = self.root / "fe"
        root.mkdir()
        workspace = root / "workspace"
        workspace.mkdir()
        os.symlink(FLOW_DIR, workspace / "flow")
        case = fixtures.make_case(
            root, mage_executable=[sys.executable, str(STANDIN)],
            auto_refine_converge={"VERT": 7, "HORZ": 5},
        )
        site_caps = fixtures.make_site_capabilities(root, [sys.executable, str(STANDIN)])
        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 2}

        task_input = _write_json(root / "fe-prepare-input.json", {
            "MAGE_CASE_MANIFEST": case["files"]["manifest"],
            "CONSUMER_CONTEXT": case["files"]["consumerContext"],
            "SITE_CAPABILITIES": site_caps,
            **goal,
        })
        _run(["task-prepare-case", workspace, task_input, root / "fe-prepare-output.json"])

        dbu_per_um = case["manifest"]["dbuPerUm"]
        start_text = Path(case["files"]["startState"]).read_text(encoding="utf-8")
        env = dict(os.environ)
        env["MAGE_STANDIN_ROWS"] = "{}"

        # Round 1 with --fill.
        pla1 = root / "fe-r1.pla"
        pla1.write_text(start_text, encoding="utf-8")
        round1_dir = workspace / "placement" / "round-01"
        result = subprocess.run(
            [sys.executable, str(CLI), "mage-round", str(workspace), "--round", "1",
             "--pla", str(pla1), "--role", "engineer", "--out-dir", str(round1_dir), "--fill"],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        round1_tcl = (round1_dir / "round.tcl").read_text(encoding="utf-8")
        self.assertIn("smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum 7", round1_tcl)

        candidate1_path = root / "fe-r1-candidate.json"
        _run(["candidate", workspace, "--round", "1", "--round-dir", str(round1_dir),
              "--ledger", _write_json(root / "fe-r1-ledger.json", []), "--out", candidate1_path])
        candidate1 = json.loads(candidate1_path.read_text(encoding="utf-8"))
        self.assertTrue(candidate1["reproduction"]["fill"])
        self.assertIsNone(candidate1["reproduction"]["experimentSha256"])
        self.assertEqual(candidate1["outcome"], "completed")
        self.assertEqual(len(candidate1["files"]["scripts"]), 1)

        live_candidate = workspace / "state" / "round" / "placement-candidate.json"
        live_candidate.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidate1_path, live_candidate)
        values1 = _run_reader("placement-candidate", live_candidate, root / "fe-r1-values.json", workspace)["values"]
        by_type = {v["type"]: v for v in values1}
        for fact in ("mage_native_overlap_rows", "mage_native_space_rows", "mage_native_boundary_rows"):
            self.assertIsNotNone(by_type[fact]["value"], fact)
        self.assertEqual(by_type["mage_native_violation_total"]["value"], 0)
        self.assertEqual(by_type["mage_candidate_error_count"]["value"], 0)

        # Round 2 with --experiment.
        experiment_src = root / "fe-experiment.tcl"
        experiment_src.write_text("smPFlow -autoRefine\n", encoding="utf-8")
        pla2 = root / "fe-r2.pla"
        pla2.write_text(start_text, encoding="utf-8")
        round2_dir = workspace / "placement" / "round-02"
        result2 = subprocess.run(
            [sys.executable, str(CLI), "mage-round", str(workspace), "--round", "2",
             "--pla", str(pla2), "--role", "engineer", "--out-dir", str(round2_dir),
             "--experiment", str(experiment_src)],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(result2.returncode, 0, result2.stderr)

        candidate2_path = root / "fe-r2-candidate.json"
        _run(["candidate", workspace, "--round", "2", "--round-dir", str(round2_dir),
              "--ledger", _write_json(root / "fe-r2-ledger.json", []), "--out", candidate2_path])
        candidate2 = json.loads(candidate2_path.read_text(encoding="utf-8"))
        self.assertFalse(candidate2["reproduction"]["fill"])
        self.assertEqual(
            candidate2["reproduction"]["experimentSha256"],
            core.file_sha256(round2_dir / "experiment.tcl"),
        )
        scripts = candidate2["files"]["scripts"]
        self.assertEqual(len(scripts), 2)
        script_names = {Path(s["path"]).name for s in scripts}
        self.assertEqual(script_names, {"round.tcl", "experiment.tcl"})
        for ref in scripts:
            self.assertEqual(core.file_sha256(workspace / ref["path"]), ref["sha256"])

    def test_round_without_end_marker_is_blocked(self):
        """The vendor launcher returns 0 even on failure; a round whose
        stdout never carries `MAGE_ROUND_END code 0` is `completed=False`,
        and `candidate` derives outcome `blocked` from it, not from the
        return code."""
        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 2}
        self._task("prepare-case", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            **goal,
        })
        pla_path = self.root / "noend.pla"
        pla_path.write_text(Path(self.case["files"]["startState"]).read_text(encoding="utf-8"), encoding="utf-8")
        round_dir = self.workspace / "placement" / "round-01"
        env = dict(os.environ)
        env["MAGE_STANDIN_NO_END"] = "1"
        result = subprocess.run(
            [sys.executable, str(CLI), "mage-round", str(self.workspace), "--round", "1",
             "--pla", str(pla_path), "--role", "engineer", "--out-dir", str(round_dir)],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads((round_dir / "round-summary.json").read_text(encoding="utf-8"))
        self.assertFalse(summary["completed"])

        candidate_path = self.root / "noend-candidate.json"
        _run(["candidate", self.workspace, "--round", "1", "--round-dir", str(round_dir),
              "--ledger", _write_json(self.root / "noend-ledger.json", []), "--out", candidate_path])
        candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        self.assertEqual(candidate["outcome"], "blocked")
        self.assertEqual(candidate["stopReason"], "native round did not reach MAGE_ROUND_END")

    def test_tampered_review_findings_refused_by_reader(self):
        """A review whose findings were edited after the evaluator receipt
        was written is refused by the consumer-review Reader."""
        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 1}
        self._task("prepare-case", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            **goal,
        })
        _round_dir, candidate1, candidate1_ro, evals1 = self._build_candidate(
            1, ovl_b_on_target=False, ledger=[],
        )
        reviews1, review1_ro = self._build_reviews(1, evals1, {})

        live_review_path = self.workspace / "state" / "round" / "review-litho-pie.json"
        doc = json.loads(live_review_path.read_text(encoding="utf-8"))
        # Tamper a finding's numbers after the evaluator receipt was written
        # -- guaranteed to differ from what `consumers.evaluate` reproduces,
        # regardless of which requirement happened to land at index 0.
        doc["findings"][0]["numbers"] = {"tampered": True}
        live_review_path.write_text(json.dumps(doc), encoding="utf-8")

        out_path = self.root / "tampered-values.json"
        result = subprocess.run(
            [sys.executable, str(READER), "consumer-review", str(live_review_path), str(out_path), str(self.workspace)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0)
        values = json.loads(out_path.read_text(encoding="utf-8"))["values"]
        error_value = next(v for v in values if v["type"] == "mage_review_error_count")
        self.assertEqual(error_value["value"], 1)
        for value in values:
            if value["type"] != "mage_review_error_count":
                self.assertIsNone(value["value"])
                self.assertIn("unknownReason", value)


if __name__ == "__main__":
    unittest.main()
