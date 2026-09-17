#!/usr/bin/env python3
"""Focused Pack Reader contracts for LFR F0/F1 and cumulative-Library evidence."""
from __future__ import annotations
import hashlib, json, shutil, subprocess, tempfile, unittest
from pathlib import Path

FLOW = Path(__file__).resolve().parents[2]
READER = FLOW / "read-stage.py"
PORTFOLIO = Path(__file__).resolve().parent / "fixtures" / "lfr-pre-mapping-portfolio.production.json"

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

class LfrPackReaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lfr-pack-reader-")
        self.workspace = Path(self.tmp.name)
        (self.workspace / "flow/records").mkdir(parents=True)
        shutil.copytree(FLOW / "domain", self.workspace / "flow/domain")
    def tearDown(self): self.tmp.cleanup()
    def record(self, stage, role, artifact):
        target = self.workspace / "flow/records" / (stage + ".json")
        target.write_text(json.dumps({"schema":"custom-cell-fmax-stage/1","stage":stage,
          "status":"passed","inputs":[],"artifacts":[{"role":role,
          "path":str(artifact.relative_to(self.workspace)),"sha256":sha(artifact),
          "bytes":artifact.stat().st_size,"sourceType":"synthetic-reader-fixture"}],
          "executions":[],"facts":{}},sort_keys=True)+"\n")
        return target
    def run_reader(self, record, stage):
        out = self.workspace / (stage + "-reading.json")
        return subprocess.run(["/usr/bin/python3",str(READER),str(record),str(out),stage],
                              text=True,capture_output=True), out
    def test_function_local_reader_recomputes_portfolio_and_rejects_rehashed_tamper(self):
        artifact = self.workspace / "flow/local-portfolio.json"
        artifact.write_bytes(PORTFOLIO.read_bytes())
        record = self.record("function-local-evaluation","function_local_evaluation",artifact)
        ran,out = self.run_reader(record,"function-local-evaluation")
        self.assertEqual(0,ran.returncode,ran.stderr)
        values={row["type"]:row for row in json.loads(out.read_text())["values"]}
        self.assertEqual(1,values["proxy_metric_vector_complete"]["value"])
        self.assertEqual(1,values["function_local_structure_effective"]["value"])
        tampered=json.loads(artifact.read_text())
        tampered["selected"][0]["pareto_axes"]["structural.levels_removed"] += 1
        artifact.write_text(json.dumps(tampered,sort_keys=True)+"\n")
        record=self.record("function-local-evaluation","function_local_evaluation",artifact)
        ran,_=self.run_reader(record,"function-local-evaluation")
        self.assertNotEqual(0,ran.returncode)
        self.assertIn("independent recomputation",ran.stderr)
    def test_cumulative_reader_counts_current_shard_from_validated_manifest(self):
        key="sha256:"+"1"*64
        manifest={"schema":"custom-cell-cumulative-library/1",
          "baselineReference":{"sha256":"a"*64,"bytes":1,"source":"foundry.lib"},
          "shards":[{"id":"0001","manifestSha256":"b"*64,"functionKeys":[key]}],
          "functions":[{"functionKey":key,"candidateId":"CAND_ONE","shardId":"0001",
            "state":"cumulative","stateHistory":["discovered","proxy-mapped","materialized","predicted","cumulative"],
            "knownFailures":[],"physicalCellNames":["XS_ONE"],"identity":{}}]}
        artifact=self.workspace/"flow/cumulative-manifest.json"
        artifact.write_text(json.dumps(manifest,sort_keys=True)+"\n")
        record=self.record("freeze-cumulative-library","cumulative_library_manifest",artifact)
        ran,out=self.run_reader(record,"freeze-cumulative-library")
        self.assertEqual(0,ran.returncode,ran.stderr)
        values={row["type"]:row["value"] for row in json.loads(out.read_text())["values"]}
        self.assertEqual({"new_library_cell_count":1,"cumulative_library_cell_count":1},values)
    def test_mining_research_reader_accepts_license_free_baseline_source(self):
        folder=self.workspace/"flow/mining/timing_criticality"; folder.mkdir(parents=True)
        raw=folder/"raw.json"; raw.write_text('{"generation_requests":[]}\n')
        code="c"*64
        view={"schema":"custom-cell-fmax-mining-research-view/1",
              "sourceSha256":sha(raw),"minerCodeSha256":code,
              "route":"timing_criticality","candidates":[],
              "sourcePhase":"license-free-baseline","limitations":["fixture"]}
        report=folder/"research.json"; report.write_text(json.dumps(view,sort_keys=True)+"\n")
        record=self.workspace/"flow/records/mine-timing_criticality.json"
        record.write_text(json.dumps({"schema":"custom-cell-fmax-stage/1",
          "stage":"mine-timing_criticality","status":"passed","inputs":[],
          "artifacts":[{"role":"mining_research_view",
            "path":str(report.relative_to(self.workspace)),"sha256":sha(report),
            "bytes":report.stat().st_size,"sourceType":"synthetic-reader-fixture"}],
          "executions":[],"facts":{"codeSha256":code}},sort_keys=True)+"\n")
        ran,out=self.run_reader(report,"research-route-timing-criticality")
        self.assertEqual(0,ran.returncode,ran.stderr)
        self.assertEqual(0,json.loads(out.read_text())["values"][0]["value"])
