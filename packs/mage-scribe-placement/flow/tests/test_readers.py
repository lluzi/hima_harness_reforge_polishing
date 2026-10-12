"""Focused negative tests for `tools/read-mage.py`, run as a subprocess
exactly as the Harness would invoke it (argv `<kind> <report> <out>
<workspace>`). Each test builds the smallest workspace state the handler
needs, tampers with exactly one thing, and asserts the Reader fails
closed: `mage_candidate_error_count`/`mage_review_error_count` becomes `1`
and every other declared fact in that call becomes `unknown`.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core  # noqa: E402

from tests import fixtures  # noqa: E402


FLOW_DIR = Path(__file__).resolve().parents[1]
CLI = FLOW_DIR / "mage_placement_cli.py"
READER = FLOW_DIR.parent / "tools" / "read-mage.py"
READERS_DIR = FLOW_DIR.parent / "readers"
STANDIN = FLOW_DIR / "tests" / "standin_mage.py"


def _load_read_mage_module():
    """Import `tools/read-mage.py` (a hyphenated filename) as a plain
    module, the way `_mage_modules` in that same script imports
    `mage_placement.*` -- by path, not by package name."""
    spec = importlib.util.spec_from_file_location("read_mage", READER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _reader_yaml_emits(reader_id):
    """The `emits:` list from `readers/<reader_id>.yml`, in file order, read
    with a tiny line-based parser (no YAML library in this Pack's own
    runtime, per the global constraints) -- good enough for this flat
    `key: value` / `  - item` shape."""
    text = (READERS_DIR / f"{reader_id}.yml").read_text(encoding="utf-8")
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "emits:")
    emits = []
    for line in lines[start + 1:]:
        stripped = line.strip()
        if not stripped.startswith("- "):
            break
        emits.append(stripped[2:].strip())
    return emits


def _run(args, env=None):
    result = subprocess.run([sys.executable, str(CLI)] + [str(a) for a in args], capture_output=True, text=True, env=env)
    assert result.returncode == 0, f"{args} failed: {result.stderr}\n{result.stdout}"
    return result


def _run_reader(kind, report, out, workspace):
    result = subprocess.run(
        [sys.executable, str(READER), kind, str(report), str(out), str(workspace)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"reader failed: {result.stderr}\n{result.stdout}"
    return json.loads(Path(out).read_text(encoding="utf-8"))["values"]


def _run_reader_refused(kind, report, out, workspace):
    """C1: a fail-closed refusal exits non-zero and leaves OUT unwritten.

    Returns the parsed `{"code","detail"}` the Reader printed to stderr.
    """
    result = subprocess.run(
        [sys.executable, str(READER), kind, str(report), str(out), str(workspace)],
        capture_output=True, text=True,
    )
    assert result.returncode != 0, f"reader should have refused but exited 0: {result.stdout}"
    assert not Path(out).is_file(), "a refused Reader must not write OUT"
    return json.loads(result.stderr.strip().splitlines()[-1])


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


def _assert_all_unknown_except(values, known_type):
    for value in values:
        if value["type"] == known_type:
            continue
        assert value["value"] is None, f"{value['type']} should be unknown, got {value['value']}"
        assert "unknownReason" in value


class ReaderNegativeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        os.symlink(FLOW_DIR, self.workspace / "flow")

        self.case = fixtures.make_case(self.root, mage_executable=[sys.executable, str(STANDIN)])
        self.site_caps = fixtures.make_site_capabilities(self.root, [sys.executable, str(STANDIN)])

        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 1}
        task_input = _write_json(self.root / "prepare-input.json", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            **goal,
        })
        task_output = self.root / "prepare-output.json"
        _run(["task-prepare-case", self.workspace, task_input, task_output])

        pla_path = self.root / "round1.pla"
        pla_path.write_text(Path(self.case["files"]["startState"]).read_text(encoding="utf-8"), encoding="utf-8")
        self.round_dir = self.workspace / "placement" / "round-01"
        env = dict(os.environ)
        env["MAGE_STANDIN_ROWS"] = "{}"
        _run([
            "mage-round", self.workspace, "--round", "1", "--pla", pla_path,
            "--role", "engineer", "--out-dir", self.round_dir,
        ], env=env)

        ledger_path = _write_json(self.root / "ledger.json", [])
        self.candidate_path = self.root / "candidate.json"
        _run([
            "candidate", self.workspace, "--round", "1", "--round-dir", self.round_dir,
            "--ledger", ledger_path, "--out", self.candidate_path,
        ])
        self.live_candidate_path = self.workspace / "state" / "round" / "placement-candidate.json"
        self.live_candidate_path.parent.mkdir(parents=True, exist_ok=True)
        self.live_candidate_path.write_text(self.candidate_path.read_text(encoding="utf-8"), encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def test_candidate_reader_emits_declared_set_in_declared_order(self):
        # CANDIDATE_EMITS (the script's own source of truth) must agree
        # exactly and in order with readers/mage-placement-candidate.yml's
        # `emits:` list, and the live reader run must emit exactly that
        # set -- including the two new ordinary-drop facts right after
        # mage_dropped_length_um.
        module = _load_read_mage_module()
        yaml_emits = _reader_yaml_emits("mage-placement-candidate")
        self.assertEqual(module.CANDIDATE_EMITS, yaml_emits)
        self.assertEqual(
            module.CANDIDATE_EMITS[4:6],
            ["mage_dropped_ordinary_count", "mage_dropped_ordinary_length_um"],
        )

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out-emits.json", self.workspace)
        self.assertEqual([v["type"] for v in values], module.CANDIDATE_EMITS)
        ordinary_count = next(v for v in values if v["type"] == "mage_dropped_ordinary_count")
        ordinary_length = next(v for v in values if v["type"] == "mage_dropped_ordinary_length_um")
        total_count = next(v for v in values if v["type"] == "mage_dropped_count")
        total_length = next(v for v in values if v["type"] == "mage_dropped_length_um")
        # The synthetic fixture's one drop (KEY_V) has an empty inGroup --
        # ordinary count/length equal the totals exactly.
        self.assertEqual(ordinary_count["value"], total_count["value"])
        self.assertEqual(ordinary_length["value"], total_length["value"])
        self.assertEqual(ordinary_count["unit"], "count")
        self.assertEqual(ordinary_length["unit"], "um")

    def test_tampered_pla_is_refused(self):
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        pla_ref_path = Path(doc["files"]["pla"]["path"])
        full = self.workspace / pla_ref_path
        full.write_text(full.read_text(encoding="utf-8") + "\n# tampered\n", encoding="utf-8")

        error = _run_reader_refused("placement-candidate", self.live_candidate_path, self.root / "out1.json", self.workspace)
        self.assertEqual(error["code"], "identity-mismatch")

    def test_missing_verify_file_marks_that_type_and_total_unknown_but_not_an_error(self):
        # The Engineer legitimately never reported an OVERLAP check this
        # round (e.g. a native tool that does not support it) -- the
        # candidate simply never names that type under `files.verify`.
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        doc["files"]["verify"].pop("OVERLAP", None)
        doc["id"] = core.digest({k: v for k, v in doc.items() if k != "id"})
        self.live_candidate_path.write_text(json.dumps(doc), encoding="utf-8")

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out2.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 0)
        total = next(v for v in values if v["type"] == "mage_native_violation_total")
        self.assertIsNone(total["value"])
        overlap = next(v for v in values if v["type"] == "mage_native_overlap_rows")
        self.assertIsNone(overlap["value"])
        space = next(v for v in values if v["type"] == "mage_native_space_rows")
        self.assertIsNotNone(space["value"])

    def test_unanswered_open_request_from_previous_round_is_reflected(self):
        request = {
            "schema": "mage.request/1", "id": "R-1", "fromFinding": "F-1", "consumer": "litho-pie",
            "snapshotSha256": doc_sha(self.live_candidate_path), "requestedOutcome": {
                "kind": "move", "targets": ["x"], "limitsUm": {}, "text": "test",
            }, "acceptableAlternatives": [], "strength": "hard",
        }
        previous_decision = core.read_artifact(self.workspace / "state" / "round-decision.json", "round-decision")
        body = {k: v for k, v in previous_decision.items() if k not in ("schema", "id")}
        body["openRequests"] = [request]
        core.write_artifact(self.workspace / "state" / "round-decision.json", core.stamp("round-decision", body))

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out3.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 0)
        open_count = next(v for v in values if v["type"] == "mage_open_request_count")
        self.assertEqual(open_count["value"], 1)

    def test_session_log_mutation_under_wrong_role_is_refused(self):
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        log_path = self.workspace / doc["files"]["sessionLog"]["path"]
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"roundDir": "x", "role": "metrology", "scriptSha256": "a" * 64,
                                      "mutating": True, "returncode": 0, "startedAt": "t", "endedAt": "t"}) + "\n")

        error = _run_reader_refused("placement-candidate", self.live_candidate_path, self.root / "out4.json", self.workspace)
        self.assertIn(error["code"], ("writer", "identity-mismatch"))


    def test_missing_session_log_is_refused_not_skipped(self):
        """A candidate that omits `files.sessionLog` entirely must still be
        refused -- the one-writer audit may never be silently skipped."""
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        del doc["files"]["sessionLog"]
        doc["id"] = core.digest({k: v for k, v in doc.items() if k != "id"})
        self.live_candidate_path.write_text(json.dumps(doc), encoding="utf-8")

        error = _run_reader_refused("placement-candidate", self.live_candidate_path, self.root / "out7.json", self.workspace)
        self.assertIn(error["code"], ("schema", "missing-input"))

    def test_session_log_outside_round_prefix_is_refused(self):
        """Even a genuine, correctly-hashed session log is refused when its
        declared path sits outside this round's own `placement/round-NN/`
        artifact prefix: a resident's support files only reach the
        Campaign workspace under their own `artifactPrefix`, so a path
        outside it could never really have been published this way."""
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        real_path = self.workspace / doc["files"]["sessionLog"]["path"]
        outside_path = self.workspace / "state" / "escaped-session.jsonl"
        outside_path.parent.mkdir(parents=True, exist_ok=True)
        outside_path.write_text(real_path.read_text(encoding="utf-8"), encoding="utf-8")
        doc["files"]["sessionLog"] = {"path": "state/escaped-session.jsonl", "sha256": core.file_sha256(outside_path)}
        doc["id"] = core.digest({k: v for k, v in doc.items() if k != "id"})
        self.live_candidate_path.write_text(json.dumps(doc), encoding="utf-8")

        error = _run_reader_refused("placement-candidate", self.live_candidate_path, self.root / "out5.json", self.workspace)
        self.assertEqual(error["code"], "identity-mismatch")

    def test_session_log_inside_round_prefix_is_accepted(self):
        """The ordinary, untampered case: the session log sits at
        `placement/round-NN/session.jsonl`, inside the Engineer's own
        artifact prefix, and the Reader accepts it without error."""
        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out6.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 0)
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        self.assertTrue(doc["files"]["sessionLog"]["path"].startswith("placement/round-01/"))

    def test_tampered_script_is_refused(self):
        # I1: the Reader re-hashes every files.scripts[] entry.
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        round_tcl = self.workspace / doc["files"]["scripts"][0]["path"]
        round_tcl.write_text(round_tcl.read_text(encoding="utf-8") + "\n# tampered\n", encoding="utf-8")
        error = _run_reader_refused("placement-candidate", self.live_candidate_path, self.root / "out8.json", self.workspace)
        self.assertEqual(error["code"], "identity-mismatch")

    def test_blocked_candidate_reads_all_unknown_without_error(self):
        # I1: a candidate that did not complete claims no metric -- every
        # fact unknown, error_count 0, never a measured state.
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        doc["outcome"] = "blocked"
        doc["id"] = core.digest({k: v for k, v in doc.items() if k != "id"})
        self.live_candidate_path.write_text(json.dumps(doc), encoding="utf-8")
        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out9.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 0)
        _assert_all_unknown_except(values, "mage_candidate_error_count")

    @staticmethod
    def _fit(fit_id, base, group=""):
        return {"id": fit_id, "base": base, "inGroup": group}

    def test_inventory_refuses_a_vanished_priority_structure(self):
        # C4/N2 (unit): a Group that lost a priority instance in the export
        # (neither placed nor dropped) is a fail-closed refusal.
        from mage_placement import snapshot as snapshot_mod
        start = {
            "fixed": [{"id": "F.F", "base": "F"}],
            "fits": [self._fit("A.A_1", "A", "G1"), self._fit("A.A_2", "A", "G1")],
            "pending": [], "groups": [{"pinstGroup": "G1"}],
        }
        candidate = {"fixed": [{"id": "F.F", "base": "F"}],
                     "fits": [self._fit("A.A_1", "A", "G1")], "pending": [],
                     "groups": [{"pinstGroup": "G1"}]}
        with self.assertRaises(core.MageError) as ctx:
            snapshot_mod.check_inventory_conservation(start, candidate)
        self.assertEqual(ctx.exception.code, "inventory")

    def test_inventory_allows_a_dropped_priority_structure(self):
        # A priority instance moved to drops (same Group) conserves the
        # Group's count -- admitted.
        from mage_placement import snapshot as snapshot_mod
        start = {"fixed": [], "fits": [self._fit("A.A_1", "A", "G1")], "pending": [],
                 "groups": [{"pinstGroup": "G1"}]}
        candidate = {"fixed": [], "fits": [],
                     "pending": [{"id": "A.A_1", "base": "A", "inGroup": "G1", "placedFlag": 0}],
                     "groups": [{"pinstGroup": "G1"}]}
        snapshot_mod.check_inventory_conservation(start, candidate)  # no raise

    def test_inventory_admits_a_resuffixed_or_remastered_instance(self):
        # N2: MAGE re-suffixes (even re-masters) an in-group priority instance
        # during refine while keeping it in the same Group -- conservation by
        # Group admits it; an id-exact or per-base check wrongly refuses a real
        # MAGE result (verified against the customer post-refine incumbent).
        from mage_placement import snapshot as snapshot_mod
        start = {"fixed": [], "fits": [self._fit("OVL.OVL_1", "OVL", "G1")], "pending": [],
                 "groups": [{"pinstGroup": "G1"}]}
        candidate = {"fixed": [], "fits": [self._fit("CLUSTER.OVL_7", "CLUSTER", "G1")],
                     "pending": [], "groups": [{"pinstGroup": "G1"}]}
        snapshot_mod.check_inventory_conservation(start, candidate)  # no raise

    def test_inventory_tolerates_ordinary_fill(self):
        # Ordinary (non-group) fill added by auto-refine is fluid and is not
        # conserved by count.
        from mage_placement import snapshot as snapshot_mod
        start = {"fixed": [], "fits": [self._fit("OVL.OVL_1", "OVL", "G1")], "pending": [],
                 "groups": [{"pinstGroup": "G1"}]}
        candidate = {"fixed": [],
                     "fits": [self._fit("OVL.OVL_1", "OVL", "G1"),
                              self._fit("FILL.FILL_1", "FILL"), self._fit("FILL.FILL_2", "FILL")],
                     "pending": [], "groups": [{"pinstGroup": "G1"}]}
        snapshot_mod.check_inventory_conservation(start, candidate)  # no raise

    def test_inventory_refuses_an_extra_priority_instance(self):
        # N2: an export that invented an extra priority instance in a Group
        # (count rises) is refused -- conservation catches a fabricated
        # structure, not only a deleted one.
        from mage_placement import snapshot as snapshot_mod
        start = {"fixed": [], "fits": [self._fit("OVL.OVL_1", "OVL", "G1")], "pending": [],
                 "groups": [{"pinstGroup": "G1"}]}
        candidate = {"fixed": [],
                     "fits": [self._fit("OVL.OVL_1", "OVL", "G1"), self._fit("OVL.OVL_2", "OVL", "G1")],
                     "pending": [], "groups": [{"pinstGroup": "G1"}]}
        with self.assertRaises(core.MageError) as ctx:
            snapshot_mod.check_inventory_conservation(start, candidate)
        self.assertEqual(ctx.exception.code, "inventory")


def doc_sha(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))["snapshotSha256"]


if __name__ == "__main__":
    unittest.main()
