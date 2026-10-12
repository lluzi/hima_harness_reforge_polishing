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

    def _candidate_pla_text(self, dbu_per_um, ovl_b_on_target):
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
        doc["drops"] = [{
            "id": "KEY_V.KEY_V", "base": "KEY_V", "inst": "KEY_V.KEY_V",
            "boxDbu": [0, 0, core.um_to_dbu("900", dbu_per_um), core.um_to_dbu("60", dbu_per_um)],
            "extraRot": "NULL", "placedFlag": 0, "postfix": "", "inGroup": "",
        }]
        return pla.write_pla(doc, dbu_per_um, units="um")

    def _build_candidate(self, round_no, ovl_b_on_target, ledger):
        """Run the Engineer's part of one round: `mage-round` + `candidate`.

        Returns `(round_dir, candidate_doc, candidate_resident_output,
        evals_by_role)` — `evals_by_role` lets the caller see each
        consumer's Findings (and their ids) before authoring that round's
        Request files, without running the round twice.
        """
        dbu_per_um = self.case["manifest"]["dbuPerUm"]
        pla_path = self.root / f"round{round_no}.pla"
        pla_path.write_text(self._candidate_pla_text(dbu_per_um, ovl_b_on_target), encoding="utf-8")

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
        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 1}

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

        # Round 2: OVL_B corrected onto target; its previous Requests are
        # answered in the Ledger; no new Requests are authored (WAT's
        # Finding on KEY_V still fails mechanically -- it stays dropped --
        # but nothing changed worth re-asking).
        ledger_round2 = [
            {"schema": "mage.ledger-entry/1", "id": "L-1", "request": litho_request1["id"], "answer": "satisfied",
             "answeredInSnapshot": "pending", "evidence": [], "note": "OVL_B moved onto its CT target"},
            {"schema": "mage.ledger-entry/1", "id": "L-2", "request": wat_request1["id"], "answer": "declined",
             "answeredInSnapshot": "pending", "evidence": [], "note": "capacity-limited; KEY_V stays dropped this round"},
        ]
        round2_dir, candidate2, candidate2_ro, evals2 = self._build_candidate(
            2, ovl_b_on_target=True, ledger=ledger_round2,
        )
        self.assertFalse(any(f["status"] == "fail" and f["severity"] == "hard" for f in evals2["litho-pie"]["findings"]))
        reviews2, review2_ro = self._build_reviews(2, evals2, {})

        decision2 = self._task("decide-round", {
            "ROUND": 2, "CANDIDATE": candidate2_ro,
            "REVIEW_LITHO_PIE": review2_ro["litho-pie"], "REVIEW_METROLOGY": review2_ro["metrology"],
            "REVIEW_ALIGNMENT": review2_ro["alignment"], "REVIEW_WAT": review2_ro["wat"],
            **goal,
        })
        self.assertEqual(decision2["route"], "stop")
        self.assertEqual(decision2["openRequestCount"], 0)

        evaluation = self._task("evaluate-placement", {
            "DECISION": decision2, "INCUMBENT": incumbent_value, **goal,
        })
        self.assertFalse(evaluation["goalMet"])
        self.assertEqual(evaluation["rules"]["drops-within-goal"], "FAIL")
        self.assertEqual(evaluation["rules"]["placement-delivery-ready"], "PASS")
        self.assertEqual(evaluation["rules"]["priority-all-placed"], "PASS")
        self.assertEqual(evaluation["rules"]["no-native-violation"], "PASS")
        self.assertEqual(evaluation["rules"]["target-limit-met"], "PASS")
        self.assertEqual(evaluation["rules"]["no-open-requests"], "PASS")

        report = self._task("deliver", {"EVALUATION": evaluation})
        self.assertEqual(report["goalMet"], False)

        package_path = self.workspace / "delivery" / "placement-artifacts.tar.gz"
        self.assertTrue(package_path.is_file())
        with tarfile.open(package_path) as archive:
            names = archive.getnames()
        self.assertTrue(any("round-01" in n for n in names))
        self.assertTrue(any("round-02" in n for n in names))

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
