"""prepare-request, admit-analysis, deliver, the Reader script and the CLI on real small files."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common, library, request, tasks  # noqa: E402
import synthetic  # noqa: E402


class Route(unittest.TestCase):
    def setUp(self):
        self.base = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.base)
        self.corpus = os.path.join(self.base, "corpus", "saed14")
        os.makedirs(self.corpus)
        self.facts = synthetic.write_facts(os.path.join(self.corpus, "synthetic.json.gz"))
        self.lib = os.path.join(self.base, "pdk", "cells.lib")
        os.makedirs(os.path.dirname(self.lib))
        with open(self.lib, "w") as stream:
            stream.write("library (synthetic) { }\n")
        self.library = os.path.join(self.base, "library")
        self.workspace = synthetic.campaign(os.path.join(self.base, "campaign"))
        self.private = os.path.join(self.base, "private")
        os.makedirs(self.private)
        self.mode_file = os.path.join(self.base, "empyrean-license-mode")
        self.set_mode("new")

    def write_request(self, sources, builds=(), name="request.json"):
        path = os.path.join(self.base, name)
        with open(path, "w") as stream:
            json.dump(synthetic.request_doc(sources, builds), stream)
        return path

    def set_mode(self, word):
        with open(self.mode_file, "w") as stream:
            stream.write(word + "\n")

    def prepare(self, sources, builds=(), capability="", roots=None):
        return tasks.prepare_task(self.workspace, {
            "ANALYSIS_REQUEST": self.write_request(sources, builds), "ANALYSIS_LIBRARY": self.library,
            "FACTS_CORPUS": os.path.dirname(self.corpus), "ENGINEERING_CAPABILITIES": capability,
            "LICENCE_MODE_FILE": self.mode_file, "SOURCE_READ_ROOTS": self.base if roots is None else roots})

    def deliver_once(self, version=1, summary=None):
        """prepare -> real example script -> Host materialization -> Reader script; returns task inputs."""
        value, _ = self.prepare([self.facts])
        prepared_path = os.path.join(self.workspace, common.PREPARED_PATH)
        result, _ = synthetic.run_example(self.private, prepared_path, self.facts, version=version)
        if summary is not None:
            with open(result) as stream:
                doc = json.load(stream)
            doc["summary"] = summary
            with open(result, "w") as stream:
                json.dump(doc, stream)
        result = synthetic.materialize(self.private, self.workspace)
        os.makedirs(os.path.join(self.workspace, "hima-readers"), exist_ok=True)
        readers = tempfile.mkdtemp(dir=os.path.join(self.workspace, "hima-readers"))
        report = os.path.join(readers, "input-report")
        shutil.copyfile(result, report)
        out = os.path.join(readers, "values.json")
        completed = subprocess.run([sys.executable, synthetic.READER, report, out, self.workspace],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(completed.returncode, 0, completed.stderr.decode())
        with open(out) as stream:
            values = json.load(stream)["values"]
        digest = common.sha256_file(report)
        ref = {"runId": "run-test", "taskId": "custom-analysis", "effectId": "e", "name": "domain-report",
               "path": os.path.relpath(report, self.workspace), "sha256": digest}
        return {"READER_VALUE": {"observations": [{"id": "obs", "contentSha256": digest, "values": values}],
                                 "engineering": {"outcome": "completed", "summary": "done", "stopReason": "analysis complete"}},
                "DOMAIN_REPORT": ref, "PREPARED": value, "ANALYSIS_LIBRARY": self.library}

    # prepare-request -------------------------------------------------------------------------

    def test_prepare_hashes_sources_reads_facts_identity_and_lists_corpus(self):
        value, artifacts = self.prepare([self.lib, self.facts])
        self.assertEqual(value["requestId"], "req-20261005120000-test01")
        self.assertTrue(value["question"].startswith("How does"))
        self.assertEqual([s["kind"] for s in value["sources"]], ["liberty", "facts"])
        self.assertEqual(value["sources"][0]["sha256"], synthetic.sha256(self.lib))
        prepared = common.read_json_file(os.path.join(self.workspace, common.PREPARED_PATH), "prepared")
        self.assertEqual(value["preparedSha256"], common.sha256_file(os.path.join(self.workspace, common.PREPARED_PATH)))
        self.assertEqual(prepared["sources"][1]["liberty"], {"path": "/synthetic/saed14rvt_tt0p8v25c.lib", "sha256": "ab" * 32, "bytes": 1234})
        self.assertEqual([f["path"] for f in prepared["factsCorpus"]["files"]], [self.facts])
        self.assertEqual(prepared["library"]["analyses"], [])
        self.assertIn(value["question"], value["goal"])
        self.assertEqual(artifacts[0]["path"], common.PREPARED_PATH)

    def test_prepare_refuses_missing_symlinked_or_unknown_sources(self):
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([os.path.join(self.base, "absent.lib")])
        self.assertEqual(raised.exception.code, "missing-input")
        link = os.path.join(self.base, "link.lib")
        os.symlink(self.lib, link)
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([link])
        self.assertIn("symlink", raised.exception.detail)
        other = os.path.join(self.base, "notes.txt")
        open(other, "w").close()
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([other])
        self.assertIn("neither a Liberty", raised.exception.detail)
        bad = os.path.join(self.base, "bad.json.gz")
        with open(bad, "wb") as stream:
            stream.write(b"not gzip")
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([bad])
        self.assertIn("gzip", raised.exception.detail)

    def test_prepare_refuses_sources_outside_the_sandbox_roots(self):
        capability = os.path.join(self.base, "capability.json")
        with open(capability, "w") as stream:
            json.dump({"sandbox": {"kind": "podman", "readOnlyRoots": [self.corpus]}}, stream)
        self.prepare([self.facts], capability=capability)
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([self.lib], capability=capability)
        self.assertIn("outside the resident sandbox", raised.exception.detail)

    def test_live_qualib_needs_licence_mode_new(self):
        self.set_mode("old")
        self.prepare([self.facts])  # facts mode needs no licence
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([self.lib])
        self.assertEqual(raised.exception.code, "licence-mode")
        self.assertEqual(raised.exception.detail, request.XTOP_MODE_MESSAGE)
        self.assertEqual(raised.exception.detail,
                         "linglong's Empyrean licence is in XTop mode; the operator switches it with "
                         "`empyrean-license new` (and back with `empyrean-license old` before XTop work)")
        os.remove(self.mode_file)
        with self.assertRaises(common.LiaError):
            self.prepare([self.lib])
        # A .lib whose facts file is in the corpus is answerable in facts mode in either licence mode.
        synthetic.write_facts(os.path.join(self.corpus, "same-library.json.gz"), liberty_path=self.lib,
                              liberty_sha=synthetic.sha256(self.lib))
        self.set_mode("old")
        value, _ = self.prepare([self.lib])
        prepared = common.read_json_file(os.path.join(self.workspace, common.PREPARED_PATH), "prepared")
        self.assertEqual(prepared["sources"][0]["factsAlternatives"], [os.path.join(self.corpus, "same-library.json.gz")])
        self.assertEqual(prepared["licence"], {"modeFile": self.mode_file, "mode": "old", "liveQualibAvailable": False,
                                               "liveQualibRequiredFor": []})
        self.set_mode("new")
        os.remove(os.path.join(self.corpus, "same-library.json.gz"))
        self.prepare([self.lib])
        prepared = common.read_json_file(os.path.join(self.workspace, common.PREPARED_PATH), "prepared")
        self.assertEqual(prepared["licence"]["liveQualibRequiredFor"], [self.lib])

    def test_prepare_bounds_sources_to_the_site_read_roots_without_a_podman_capability(self):
        self.prepare([self.facts], roots=os.path.dirname(self.corpus) + ":/unused/root")
        prepared = common.read_json_file(os.path.join(self.workspace, common.PREPARED_PATH), "prepared")
        self.assertEqual(prepared["readRoots"], [os.path.dirname(self.corpus), "/unused/root"])
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([self.lib], roots=os.path.dirname(self.corpus))
        self.assertIn("outside the Site read roots", raised.exception.detail)
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([self.facts], roots=self.corpus + "-sibling")
        self.assertIn("outside the Site read roots", raised.exception.detail)
        for bad in ("", "relative/root", ":"):
            with self.assertRaises(common.LiaError) as raised:
                self.prepare([self.facts], roots=bad)
            self.assertIn("sourceReadRoots", raised.exception.detail)

    def test_prepare_refuses_malformed_requests(self):
        for change, fragment in ((lambda d: d.update(question=""), "question"),
                                 (lambda d: d.update(requestId="r1"), "requestId"),
                                 (lambda d: d.update(sources=["/a.lib"] * 2), "repeat"),
                                 (lambda d: d.update(buildsOn=["no-version"]), "buildsOn"),
                                 (lambda d: d.update(extra=True), "unexpected"),
                                 (lambda d: d.update(createdAt="yesterday"), "createdAt")):
            doc = synthetic.request_doc([self.facts])
            change(doc)
            with self.assertRaises(common.LiaError) as raised:
                request.validate_request(doc)
            self.assertIn(fragment, raised.exception.detail)

    def test_prepare_resolves_builds_on_or_refuses_unknown(self):
        with self.assertRaises(common.LiaError) as raised:
            self.prepare([self.facts], ["saed14-inv-drive-delay@1"])
        self.assertIn("not an admitted analysis", raised.exception.detail)
        library.admit_task(self.workspace, self.deliver_once())
        value, _ = self.prepare([self.facts], ["saed14-inv-drive-delay@1"])
        self.assertEqual(value["buildsOn"], ["saed14-inv-drive-delay@1"])
        prepared = common.read_json_file(os.path.join(self.workspace, common.PREPARED_PATH), "prepared")
        self.assertEqual(prepared["buildsOn"][0]["path"], os.path.join(self.library, "saed14-inv-drive-delay", "v1"))
        self.assertEqual(prepared["library"]["analyses"][0]["question"], synthetic.request_doc([])["question"])
        with self.assertRaises(common.LiaError):
            self.prepare([self.facts], ["saed14-inv-drive-delay@2"])

    # admit-analysis and deliver ----------------------------------------------------------------

    def test_admit_is_idempotent_and_refuses_a_conflicting_version(self):
        inputs = self.deliver_once()
        first = library.admit_task(self.workspace, inputs)
        self.assertTrue(first["admitted"])
        self.assertFalse(first["reused"])
        target = os.path.join(self.library, "saed14-inv-drive-delay", "v1")
        self.assertEqual(sorted(os.listdir(target)), ["admission.json", "analysis", "analysis-result.json"])
        self.assertEqual(first["resultSha256"], common.sha256_file(os.path.join(target, "analysis-result.json")))
        self.assertEqual(list(first["codeSha256s"]), ["analysis/inv_drive_delay.py"])
        again = library.admit_task(self.workspace, inputs)
        self.assertTrue(again["reused"])
        # A different delivery under the same id/version is refused; the admitted bytes stay.
        shutil.rmtree(os.path.join(self.workspace, "analysis"))
        os.makedirs(self.private + "2")
        self.private = self.private + "2"
        changed = self.deliver_once(version=1, summary="A different analysis under the same version.")
        with self.assertRaises(common.LiaError) as raised:
            library.admit_task(self.workspace, changed)
        self.assertEqual(raised.exception.code, "version-conflict")
        self.assertEqual(common.sha256_file(os.path.join(target, "analysis-result.json")), first["resultSha256"])

    def test_admit_refuses_unaccepted_or_changed_reports_and_skips_blocked(self):
        inputs = self.deliver_once()
        rejected = json.loads(json.dumps(inputs))
        rejected["READER_VALUE"]["observations"][0]["values"][0]["value"] = 1
        with self.assertRaises(common.LiaError):
            library.admit_task(self.workspace, rejected)
        blocked = json.loads(json.dumps(inputs))
        blocked["READER_VALUE"]["engineering"] = {"outcome": "blocked", "summary": "licence", "stopReason": "QuaLib licence service unavailable"}
        value = library.admit_task(self.workspace, blocked)
        self.assertFalse(value["admitted"])
        self.assertIn("licence service unavailable", value["reason"])
        self.assertFalse(os.path.exists(self.library))
        delivered, _ = tasks.deliver_task(self.workspace, {"ADMISSION": value, "PREPARED": inputs["PREPARED"], "TARGET_ADMITTED": 1})
        self.assertFalse(delivered["goalMet"])
        with open(os.path.join(self.workspace, inputs["DOMAIN_REPORT"]["path"]), "a") as stream:
            stream.write(" ")
        with self.assertRaises(common.LiaError):
            library.admit_task(self.workspace, inputs)

    def test_deliver_reports_the_admitted_analysis(self):
        inputs = self.deliver_once()
        admission = library.admit_task(self.workspace, inputs)
        value, artifacts = tasks.deliver_task(self.workspace, {"ADMISSION": admission, "PREPARED": inputs["PREPARED"], "TARGET_ADMITTED": 1})
        self.assertTrue(value["goalMet"])
        self.assertEqual(value["libraryPath"], admission["path"])
        self.assertEqual([a["name"] for a in artifacts], ["final-report-json", "final-report", "analysis-result"])
        with open(os.path.join(self.workspace, "delivery", "REPORT.md")) as stream:
            report = stream.read()
        self.assertIn("Admitted: saed14-inv-drive-delay@1", report)
        self.assertIn("heatmap plot `inv1-rise-grid`", report)

    # Reader script and CLI ---------------------------------------------------------------------

    def test_reader_rejects_with_a_stable_problems_file(self):
        self.prepare([self.facts])
        synthetic.run_example(self.private, os.path.join(self.workspace, common.PREPARED_PATH), self.facts)
        result = synthetic.materialize(self.private, self.workspace)
        with open(result) as stream:
            doc = json.load(stream)
        doc["code"]["main"]["sha256"] = "0" * 64
        report = os.path.join(self.workspace, "hima-readers", "r", "input-report")
        os.makedirs(os.path.dirname(report))
        with open(report, "w") as stream:
            json.dump(doc, stream)
        out = os.path.join(os.path.dirname(report), "values.json")
        completed = subprocess.run([sys.executable, synthetic.READER, report, out, self.workspace],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(completed.returncode, 1)
        self.assertFalse(os.path.exists(out))
        self.assertIn(b"is not sha256(code.main.text)", completed.stderr)
        with open(os.path.join(self.workspace, common.PROBLEMS_PATH)) as stream:
            self.assertTrue(stream.read().startswith("REJECTED delivery "))

    def test_cli_task_abi_and_check_delivery(self):
        task_input = os.path.join(self.base, "input.json")
        with open(task_input, "w") as stream:
            json.dump({"ANALYSIS_REQUEST": self.write_request([self.facts]), "ANALYSIS_LIBRARY": self.library,
                       "FACTS_CORPUS": os.path.dirname(self.corpus), "ENGINEERING_CAPABILITIES": "",
                       "LICENCE_MODE_FILE": self.mode_file, "SOURCE_READ_ROOTS": self.base}, stream)
        output = os.path.join(self.base, "output.json")
        cli = os.path.join(self.workspace, "flow", "libinsight_cli.py")
        completed = subprocess.run([sys.executable, cli, "task-prepare-request", self.workspace, task_input, output])
        self.assertEqual(completed.returncode, 0)
        with open(output) as stream:
            produced = json.load(stream)
        self.assertEqual(sorted(produced), ["artifacts", "diagnostics", "schemaVersion", "value"])
        synthetic.run_example(self.private, os.path.join(self.workspace, common.PREPARED_PATH), self.facts)
        check = subprocess.run([sys.executable, cli, "check-delivery", self.private], stdout=subprocess.PIPE)
        self.assertEqual(check.returncode, 0, check.stdout)
        self.assertTrue(check.stdout.startswith(b"accepted "))
        os.remove(os.path.join(self.private, "analysis", "inv_drive_delay.py"))
        check = subprocess.run([sys.executable, cli, "check-delivery", self.private], stdout=subprocess.PIPE)
        self.assertEqual(check.returncode, 1)
        self.assertIn(b"is not a delivered plain file", check.stdout)
        missing = subprocess.run([sys.executable, cli, "task-prepare-request", self.workspace,
                                  os.path.join(self.base, "absent.json"), output], stderr=subprocess.PIPE)
        self.assertEqual(missing.returncode, 2)


if __name__ == "__main__":
    unittest.main()
