"""Public filesystem-protocol tests for the task-local OpenCode ACP wrapper."""

from hashlib import sha256
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


SITE = Path(__file__).resolve().parent
WRAPPER = SITE / "templates" / "resident-engineering-wrapper.py"
STANDIN = SITE / "tests" / "fixtures" / "acp-standin.py"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def framed(body):
    return {**body, "sha256": sha256(canonical(body)).hexdigest()}


def publish(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(canonical(value))
    os.replace(temporary, path)


def wait_json(path, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return json.loads(path.read_text())
        except FileNotFoundError:
            time.sleep(.02)
    raise AssertionError(f"timed out waiting for {path}")


class WrapperFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.task = self.root / "task"
        self.task.mkdir()
        (self.task / "workspace").mkdir()
        self.permission_response = self.root / "permission-response.json"
        self.descendant_pid = self.root / "descendant.pid"
        self.capability = self.root / "capability.json"
        self.capability.write_text(json.dumps({
            "schema": "hima-resident-engineering-capability/1",
            "protocol": "hima-resident-engineering/1",
            "wrapper": {"argv": [str(WRAPPER), "--capability", str(self.capability)]},
            "native": {
                "executable": str(STANDIN),
                "version": "1.18.34",
                "argv": [],
                "model": "deepseek/deepseek-flash",
                "protocolVersion": 1,
            },
            "sandbox": {"kind": "none", "testOnly": True, "privateWorkspace": "workspace", "privateHome": "home"},
            "environment": {
                "inherit": [],
                "set": {
                    "STANDIN_PERMISSION_RESPONSE": str(self.permission_response),
                    "STANDIN_DESCENDANT_PID": str(self.descendant_pid),
                },
                "toolPaths": [],
                "credentialReadPaths": [],
            },
            "permissions": {"autoApprove": ["read", "edit", "write", "bash"], "denyUnknown": True},
            "delivery": {"candidate": "resident-delivery.json"},
            "stopGraceSeconds": 1,
        }))
        self.task_record = {
            "schema": "hima-resident-engineering/1",
            "taskId": "task-1", "runId": "run-1", "executionId": "execution-1", "nodeId": "fix-timing",
            "actor": "agent-1", "ownerEpoch": "2", "controlRevision": "3", "site": "fixture",
            "workspace": str(self.task / "workspace"), "goal": "inspect and deliver", "constraints": ["preserve inputs"],
            "inputs": [], "knowledge": [], "delivery": {"manifest": "delivery/manifest.json"},
            "createdAt": "2026-10-02T00:00:00Z",
        }
        publish(self.task / "task.json", framed(self.task_record))
        self.process = None

    def start_wrapper(self):
        env = {**os.environ, "HIMA_RESIDENT_TESTING": "1"}
        self.process = subprocess.Popen(
            [sys.executable, str(WRAPPER), "--capability", str(self.capability), "--task-dir", str(self.task)],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.addCleanup(self.stop_wrapper)

    def stop_wrapper(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=3)
            self.process.communicate()

    def request(self, request_id, operation, payload=None):
        body = {
            "schema": "hima-resident-engineering/1", "taskId": "task-1", "requestId": request_id,
            "operation": operation, "payload": payload or {},
        }
        publish(self.task / "requests" / f"{request_id}.json", framed(body))
        receipt = self.task / "receipts" / f"{request_id}.json"
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if receipt.exists():
                return json.loads(receipt.read_text())
            if self.process.poll() is not None:
                stdout, stderr = self.process.communicate()
                self.fail(f"wrapper exited {self.process.returncode}: stdout={stdout!r} stderr={stderr!r}")
            time.sleep(.02)
        self.fail(f"timed out waiting for {receipt}")

    def use_production_scope_fixture(self, declared_campaign=None):
        campaign = self.root / "campaign"
        self.task = campaign / ".hima-engineering" / "task-1"
        (self.task / "workspace").mkdir(parents=True)
        read_root = self.root / "readonly-inputs"
        read_root.mkdir()
        capability = json.loads(self.capability.read_text())
        capability["sandbox"] = {
            "kind": "podman", "executable": "/usr/bin/false", "image": "fixture-image",
            "readOnlyRoots": [str(read_root)], "privateWorkspace": "workspace", "privateHome": "home",
            "network": "host",
        }
        self.capability.write_text(json.dumps(capability))
        self.task_record["campaignWorkspace"] = str(declared_campaign or campaign)
        self.task_record["workspace"] = str(self.task / "workspace")
        publish(self.task / "task.json", framed(self.task_record))


class ResidentEngineeringWrapperTest(WrapperFixture):
    def test_production_capability_pins_actual_native_and_scoped_podman(self):
        capability = json.loads((SITE / "engineering-capabilities-v1.json").read_text())
        self.assertEqual(capability["native"], {
            "executable": "/home/luzi/.opencode/bin/opencode", "version": "1.18.34",
            "argv": ["acp", "--pure"], "model": "deepseek/deepseek-flash", "protocolVersion": 1,
        })
        self.assertEqual(capability["sandbox"]["kind"], "podman")
        self.assertNotIn("/", capability["sandbox"]["readOnlyRoots"])
        self.assertNotIn("/home/luzi", capability["sandbox"]["readOnlyRoots"])
        self.assertNotIn("/data/eda/project/hima_harness/atcs-runs", capability["sandbox"]["readOnlyRoots"])
        self.assertTrue(capability["sandbox"]["image"].isalnum())

    def test_production_scope_mount_is_exact_declared_campaign_not_all_runs(self):
        self.use_production_scope_fixture()
        self.start_wrapper()
        status = self.request("scope:status", "status")
        self.assertEqual(status["status"], "completed")

    def test_production_scope_refuses_task_outside_declared_campaign(self):
        self.use_production_scope_fixture(self.root / "foreign-campaign")
        self.start_wrapper()
        self.assertNotEqual(self.process.wait(timeout=3), 0)
        _, stderr = self.process.communicate()
        self.assertIn("not scoped beneath its declared campaign workspace", stderr)

    def test_start_message_delivery_and_release_keep_one_native_session(self):
        self.start_wrapper()
        start = self.request("start-1", "start")
        self.assertEqual(start["status"], "accepted", start)
        self.assertEqual((start["status"], start["sessionId"]), ("accepted", "native-session-1"))
        deadline = time.monotonic() + 5
        while wait_json(self.task / "state.json")["phase"] == "running" and time.monotonic() < deadline:
            time.sleep(.02)

        message = self.request("message-1", "message", {"text": "continue from the same facts"})
        self.assertEqual((message["status"], message["sessionId"]), ("completed", "native-session-1"))

        artifact = self.task / "workspace" / "result.json"
        artifact.write_text('{"measured":true}\n')
        candidate = {
            "schema": "hima-resident-engineering-candidate/1", "outcome": "best-effort",
            "summary": "measured partial result", "stopReason": "residual remains",
            "artifacts": [{"path": "result.json", "sha256": sha256(artifact.read_bytes()).hexdigest(), "kind": "result"}],
        }
        publish(self.task / "workspace" / "resident-delivery.json", candidate)
        delivery = self.request("delivery-1", "delivery")
        self.assertEqual(delivery["status"], "completed")
        manifest = wait_json(self.task / "delivery" / "manifest.json")
        self.assertEqual((manifest["executionId"], manifest["outcome"]), ("execution-1", "best-effort"))
        self.assertEqual(manifest["artifacts"], candidate["artifacts"])
        retained_result = self.task.joinpath(manifest["artifactRoot"], "result.json")
        self.assertEqual(retained_result.read_bytes(), artifact.read_bytes())

        release = self.request("release-1", "release", {"deliverySha256": manifest["sha256"]})
        self.assertEqual(release["status"], "completed")
        self.assertEqual(wait_json(self.task / "state.json")["phase"], "released")
        self.assertEqual(self.process.wait(timeout=5), 0)
        self.assertTrue(artifact.exists(), "release preserves engineering artifacts")
        trace = [json.loads(line) for line in (self.task / "native" / "session-events.jsonl").read_text().splitlines()]
        prompts = [entry for entry in trace if entry["direction"] == "wrapper-to-native"
                   and entry["message"].get("method") == "session/prompt"]
        self.assertEqual(len(prompts), 2, "one initial prompt and one same-session message, without replay")

    def test_native_stand_in_produces_delivery_without_host_prewrite(self):
        self.task_record["goal"] = "DELIVER_RESULT"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start:native", "start")
        deadline = time.monotonic() + 5
        while not (self.task / "workspace" / "resident-delivery.json").exists() and time.monotonic() < deadline:
            time.sleep(.02)
        delivery = self.request("delivery:native", "delivery")
        self.assertEqual(delivery["status"], "completed", delivery)
        self.assertEqual((self.task / "workspace" / "result.json").read_bytes(), b'{"schema":"fixture-result/1","value":"native"}\n')
        manifest = wait_json(self.task / "delivery" / "manifest.json")
        self.assertEqual(manifest["artifacts"][0]["kind"], "result")

    def test_same_session_can_repair_a_rejected_result_and_publish_a_new_manifest(self):
        self.task_record["goal"] = "DELIVER_BAD_RESULT"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start:repair", "start")
        deadline = time.monotonic() + 5
        while not (self.task / "workspace" / "resident-delivery.json").exists() and time.monotonic() < deadline:
            time.sleep(.02)
        first = self.request("delivery:first", "delivery")
        first_manifest = wait_json(self.task / "delivery" / "manifest.json")
        self.assertEqual(first["result"]["deliverySha256"], first_manifest["sha256"])
        self.assertEqual((self.task / "workspace" / "result.json").read_bytes(), b'{"schema":"fixture-result/1","value":"bad"}\n')
        message = self.request("message:repair", "message", {"text": "FIX_DELIVERY"})
        self.assertEqual(message["sessionId"], "native-session-1")
        second = self.request("delivery:second", "delivery")
        second_manifest = wait_json(self.task / "delivery" / "manifest.json")
        self.assertNotEqual(second_manifest["sha256"], first_manifest["sha256"])
        self.assertEqual(second["result"]["deliverySha256"], second_manifest["sha256"])
        self.assertEqual((self.task / "workspace" / "result.json").read_bytes(), b'{"schema":"fixture-result/1","value":"native"}\n')
        retained = wait_json(self.task / "delivery" / "manifests" / "delivery:first.json")
        self.assertEqual(retained["sha256"], first_manifest["sha256"])
        self.assertEqual(self.task.joinpath(retained["artifactRoot"], "result.json").read_bytes(),
                         b'{"schema":"fixture-result/1","value":"bad"}\n')
        self.assertEqual(self.task.joinpath(second_manifest["artifactRoot"], "result.json").read_bytes(),
                         b'{"schema":"fixture-result/1","value":"native"}\n')
        self.assertTrue((self.task / "delivery" / "manifests" / "delivery:second.json").exists())
        released = self.request("release:repair", "release", {"deliverySha256": second_manifest["sha256"]})
        self.assertEqual(released["status"], "completed")

    def test_unknown_native_permission_is_rejected_and_retained_as_event(self):
        self.task_record["goal"] = "REQUEST_UNKNOWN_PERMISSION"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start-1", "start")
        deadline = time.monotonic() + 5
        while not self.permission_response.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        response = json.loads(self.permission_response.read_text())
        self.assertEqual(response, {"outcome": {"outcome": "selected", "optionId": "reject"}})
        events = list((self.task / "events").glob("*.json"))
        self.assertEqual(len(events), 1)
        self.assertEqual(json.loads(events[0].read_text())["kind"], "permission")

    def test_cancel_waits_for_detached_owned_descendant_to_die(self):
        self.task_record["goal"] = "SPAWN_DESCENDANT"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start-1", "start")
        pid = int(wait_json_text(self.descendant_pid))
        self.assertTrue(process_exists(pid))
        cancelled = self.request("cancel-1", "cancel")
        self.assertEqual(cancelled["status"], "completed")
        self.assertFalse(process_exists(pid), "cancel must quiesce an escaped owned descendant")
        self.assertEqual(wait_json(self.task / "state.json")["phase"], "stopped")

    def test_restart_marks_unreceipted_request_unknown_without_launching_native(self):
        (self.task / "runtime.json").write_text('{"schema":"hima-resident-engineering-runtime/1"}')
        body = {
            "schema": "hima-resident-engineering/1", "taskId": "task-1", "requestId": "message-lost",
            "operation": "message", "payload": {"text": "do not replay"},
        }
        publish(self.task / "requests" / "message-lost.json", framed(body))
        self.start_wrapper()
        receipt = wait_json(self.task / "receipts" / "message-lost.json")
        self.assertEqual(receipt["status"], "unknown")
        self.assertEqual(wait_json(self.task / "state.json")["phase"], "failed")
        released = self.request("release-after-unknown", "release")
        self.assertEqual(released["status"], "unknown")
        self.assertEqual(wait_json(self.task / "state.json")["phase"], "failed")

    def test_restart_reconciles_exact_live_owned_process_tree_before_release(self):
        self.task_record["goal"] = "SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start:crash", "start")
        descendant = int(wait_json_text(self.descendant_pid))
        owned = wait_json(self.task / "native" / "owned.json")
        native_pid = owned["processPid"]
        self.assertTrue(process_exists(native_pid))
        self.assertTrue(process_exists(descendant))
        os.kill(self.process.pid, signal.SIGKILL)
        self.process.wait(timeout=3)
        self.process.communicate()
        self.process = None
        self.start_wrapper()
        deadline = time.monotonic() + 5
        while wait_json(self.task / "state.json").get("detail", {}).get("nativeQuiescence") != "unconfirmed" and time.monotonic() < deadline:
            time.sleep(.02)
        released = self.request("release:recovered", "release")
        self.assertEqual(released["status"], "completed", released)
        self.assertFalse(process_exists(native_pid))
        self.assertFalse(process_exists(descendant))
        self.assertEqual(wait_json(self.task / "state.json")["phase"], "released")

    def test_request_id_matches_host_identity_including_colon_and_full_length(self):
        self.start_wrapper()
        request_id = "a:" + "x" * 158
        receipt = self.request(request_id, "status")
        self.assertEqual((len(request_id), receipt["requestId"], receipt["status"]), (160, request_id, "completed"))


def wait_json_text(path, timeout=8):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return path.read_text()
        except FileNotFoundError:
            time.sleep(.02)
    raise AssertionError(f"timed out waiting for {path}")


def process_exists(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


if __name__ == "__main__":
    unittest.main(verbosity=2)
