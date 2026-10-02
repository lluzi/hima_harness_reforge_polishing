"""Public filesystem-protocol tests for the task-local OpenCode ACP wrapper."""

from hashlib import sha256
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest


SITE = Path(__file__).resolve().parent
WRAPPER = SITE / "templates" / "resident-engineering-wrapper.py"
STANDIN = SITE / "tests" / "fixtures" / "acp-standin.py"


def load_wrapper_module():
    spec = importlib.util.spec_from_file_location("resident_engineering_wrapper", WRAPPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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

    def run_reconcile(self):
        env = {**os.environ, "HIMA_RESIDENT_TESTING": "1"}
        return subprocess.run(
            [sys.executable, str(WRAPPER), "--capability", str(self.capability),
             "--task-dir", str(self.task), "--reconcile"],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=8,
        )

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
        protected_auth = self.root / "protected-auth.json"
        protected_auth.write_text(json.dumps({"deepseek": {"type": "api", "key": "DUMMY-ACCOUNT-KEY-MUST-NOT-LEAK"}}))
        capability = json.loads(self.capability.read_text())
        capability["sandbox"] = {
            "kind": "podman", "executable": "/usr/bin/false", "image": "fixture-image",
            "readOnlyRoots": [str(read_root)], "privateWorkspace": "workspace", "privateHome": "home",
            "network": "host",
        }
        capability["environment"]["credentialReadPaths"] = [str(protected_auth)]
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
        self.assertEqual(capability["environment"]["credentialReadPaths"],
                         ["/home/luzi/.local/share/opencode/auth.json"])
        self.assertNotIn("/", capability["sandbox"]["readOnlyRoots"])
        self.assertNotIn("/home/luzi", capability["sandbox"]["readOnlyRoots"])
        self.assertNotIn("/data/eda/project/hima_harness/atcs-runs", capability["sandbox"]["readOnlyRoots"])
        self.assertIn("/data/eda/software/eda_tools/empyrean", capability["sandbox"]["readOnlyRoots"])
        self.assertNotIn("/data/eda/software/eda_tools", capability["sandbox"]["readOnlyRoots"])
        permit = (SITE / "permit.yml").read_text()
        self.assertIn("  - /data/eda/software/eda_tools/empyrean\n", permit)
        self.assertNotIn("  - /data/eda/software/eda_tools\n", permit)
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

    def test_task_provider_broker_forwards_selected_model_without_exposing_account_key(self):
        received = {}

        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, _format, *_args):
                return

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                request = json.loads(body)
                received.update(path=self.path, authorization=self.headers.get("Authorization"), body=request)
                if request.get("stream") is True:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    self.wfile.write(b"data: first\n\n")
                    self.wfile.flush()
                    time.sleep(.75)
                    self.wfile.write(b"data: second\n\n")
                    self.wfile.flush()
                    return
                output = b'{"id":"fixture","choices":[]}\n'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(output)))
                self.end_headers()
                self.wfile.write(output)

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        thread.start()
        protected = self.root / "outside-native-sandbox" / "auth.json"
        protected.parent.mkdir()
        account_key = "DUMMY-ACCOUNT-KEY-MUST-NOT-LEAK"
        protected.write_text(json.dumps({"deepseek": {"type": "api", "key": account_key}}))
        task_home = self.root / "sanitized-home"
        task_home.mkdir()
        module = load_wrapper_module()
        broker = module.ProviderBroker(protected, task_home, f"http://127.0.0.1:{upstream.server_address[1]}")
        sibling_home = self.root / "sibling-sanitized-home"
        sibling_home.mkdir()
        sibling_broker = module.ProviderBroker(protected, sibling_home, f"http://127.0.0.1:{upstream.server_address[1]}")
        try:
            base_url = broker.start()
            sibling_url = sibling_broker.start()
            self.assertNotEqual(broker.token, sibling_broker.token)
            endpoint = base_url.removeprefix("http://")
            host, route = endpoint.split("/", 1)
            connection = http.client.HTTPConnection(host, timeout=5)
            body = json.dumps({"model": "deepseek-flash", "messages": [{"role": "user", "content": "fixture"}]})
            connection.request("POST", f"/{route}/chat/completions", body=body,
                               headers={"Authorization": f"Bearer {broker.token}", "Content-Type": "application/json"})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
            connection.close()
            self.assertEqual(received["path"], "/chat/completions")
            self.assertEqual(received["authorization"], f"Bearer {account_key}")
            self.assertEqual(received["body"]["model"], "deepseek-flash")
            sanitized_config = json.loads((task_home / ".config/opencode/opencode.json").read_text())
            sanitized_auth = json.loads((task_home / ".local/share/opencode/auth.json").read_text())
            self.assertEqual(sanitized_config["model"], "deepseek/deepseek-flash")
            self.assertEqual(sanitized_config["small_model"], "deepseek/deepseek-flash")
            self.assertEqual(sanitized_config["enabled_providers"], ["deepseek"])
            self.assertEqual(sanitized_config["provider"]["deepseek"]["options"]["baseURL"], base_url)
            self.assertEqual(sanitized_auth, {"deepseek": {"type": "api", "key": broker.token}})
            visible = b"".join(path.read_bytes() for path in task_home.rglob("*") if path.is_file())
            self.assertNotIn(account_key.encode(), visible, "native shell-visible home contains no account credential")
            self.assertIn(broker.token.encode(), visible, "native receives only a task-lifetime route token")
            shell_probe = subprocess.run(
                ["/bin/sh", "-c", f'if grep -R -F {account_key!r} "$HOME" >/dev/null 2>&1; then exit 91; fi'],
                env={"HOME": str(task_home), "PATH": "/usr/bin:/bin"},
                check=False,
            )
            self.assertEqual(shell_probe.returncode, 0, "native shell can read only sanitized task-home credentials")
            connection = http.client.HTTPConnection(host, timeout=5)
            wrong = json.dumps({"model": "another-model", "messages": []})
            connection.request("POST", f"/{route}/chat/completions", body=wrong,
                               headers={"Authorization": f"Bearer {broker.token}", "Content-Type": "application/json"})
            self.assertEqual(connection.getresponse().status, 403)
            connection.close()
            connection = http.client.HTTPConnection(host, timeout=5)
            streamed = json.dumps({"model": "deepseek-flash", "messages": [], "stream": True})
            started = time.monotonic()
            connection.request("POST", f"/{route}/chat/completions", body=streamed,
                               headers={"Authorization": f"Bearer {broker.token}", "Content-Type": "application/json"})
            response = connection.getresponse()
            first = response.read1(64 * 1024)
            self.assertIn(b"data: first", first)
            self.assertLess(time.monotonic() - started, .5, "broker forwards the first SSE chunk before upstream completion")
            self.assertIn(b"data: second", response.read())
            connection.close()
            sibling_endpoint = sibling_url.removeprefix("http://")
            sibling_host, sibling_route = sibling_endpoint.split("/", 1)
            connection = http.client.HTTPConnection(sibling_host, timeout=5)
            connection.request("POST", f"/{sibling_route}/chat/completions", body=body,
                               headers={"Authorization": f"Bearer {broker.token}", "Content-Type": "application/json"})
            self.assertEqual(connection.getresponse().status, 401, "one task token cannot call a sibling broker")
            connection.close()
            connection = http.client.HTTPConnection(sibling_host, timeout=5)
            connection.request("POST", f"/{sibling_route}/chat/completions", body=body,
                               headers={"Authorization": f"Bearer {sibling_broker.token}", "Content-Type": "application/json"})
            sibling_response = connection.getresponse()
            self.assertEqual(sibling_response.status, 200, "the sibling broker accepts only its own task token")
            sibling_response.read()
            connection.close()
        finally:
            sibling_broker.stop()
            broker.stop()
            upstream.shutdown()
            upstream.server_close()
            thread.join(timeout=3)

    def test_production_native_argv_never_mounts_wrapper_host_auth(self):
        self.use_production_scope_fixture()
        module = load_wrapper_module()
        wrapper = module.Wrapper(self.task, self.capability)
        auth_path = wrapper.capability["environment"]["credentialReadPaths"][0]
        self.assertNotIn(auth_path, "\n".join(wrapper.native_argv()))

    def test_production_shell_keeps_eda_init_banner_off_acp_stdout(self):
        self.use_production_scope_fixture()
        module = load_wrapper_module()
        wrapper = module.Wrapper(self.task, self.capability)
        argv = wrapper.native_argv()
        shell_at = argv.index("/bin/bash")
        shell = argv[shell_at:shell_at + 5]
        init = self.root / "eda-init.sh"
        init.write_text('printf "EDA environment loaded\\n"\n')
        native = 'printf \'{"jsonrpc":"2.0","id":1,"result":{}}\\n\''
        completed = subprocess.run(
            [*shell, "hima-native", "/bin/sh", "-c", native],
            env={"EDA_INIT": str(init), "EMPYREAN_LICENSE_MODE": "old", "PATH": "/usr/bin:/bin"},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, '{"jsonrpc":"2.0","id":1,"result":{}}\n')
        self.assertEqual(completed.stderr, "EDA environment loaded\n")

    def test_production_namespace_masks_sibling_task_home_and_rebinds_only_own_task(self):
        self.use_production_scope_fixture()
        business_output = self.task.parent.parent / "flow/results/current-output.json"
        business_output.parent.mkdir(parents=True)
        business_output.write_text('{"current":true}\n')
        method_file = self.task / "method/task.md"
        method_file.parent.mkdir()
        method_file.write_text("own declared method\n")
        sibling = self.task.parent / "sibling-task"
        sibling_auth = sibling / "home/.local/share/opencode/auth.json"
        sibling_auth.parent.mkdir(parents=True)
        sibling_auth.write_text('{"deepseek":{"type":"api","key":"SIBLING-TASK-TOKEN"}}')
        module = load_wrapper_module()
        wrapper = module.Wrapper(self.task, self.capability)
        argv = wrapper.native_argv()
        masked = f"{wrapper.task_dir.parent}:rw,nosuid,nodev,noexec"
        self.assertIn(masked, argv, "the shared .hima-engineering subtree is masked inside the container")
        mounts = [argv[index + 1] for index, value in enumerate(argv[:-1]) if value == "--mount"]
        campaign = wrapper.task_dir.parent.parent
        self.assertIn(f"type=bind,src={campaign},dst={campaign},ro=true", mounts,
                      "declared current Campaign outputs remain readable")
        self.assertTrue(any(f"type=bind,src={wrapper.task_dir},dst={wrapper.task_dir},ro=true" == mount for mount in mounts))
        self.assertFalse(any(str(sibling) in mount for mount in mounts), "no sibling task path is rebound through the mask")

    def test_start_message_delivery_and_release_keep_one_native_session(self):
        self.start_wrapper()
        start = self.request("start-1", "start")
        self.assertEqual(start["status"], "accepted", start)
        self.assertEqual((start["status"], start["sessionId"]), ("accepted", "native-session-1"))
        owned = wait_json(self.task / "native" / "owned.json")
        self.assertIsInstance(owned["processIdentity"], str)
        self.assertTrue(owned["processIdentity"])
        self.assertEqual(owned["processGroupId"], owned["processPid"])
        deadline = time.monotonic() + 5
        while wait_json(self.task / "state.json")["phase"] == "running" and time.monotonic() < deadline:
            time.sleep(.02)

        message = self.request("message-1", "message", {"text": "continue from the same facts"})
        self.assertEqual((message["status"], message["sessionId"]), ("accepted", "native-session-1"))
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = wait_json(self.task / "state.json")
            if state.get("phase") == "waiting" and state.get("detail", {}).get("completedRequestId") == "message-1":
                break
            time.sleep(.02)
        self.assertEqual(state.get("detail", {}).get("completedRequestId"), "message-1")

        artifact = self.task / "workspace" / "nested" / "result.json"
        artifact.parent.mkdir()
        artifact.write_text('{"measured":true}\n')
        candidate = {
            "schema": "hima-resident-engineering-candidate/1", "outcome": "best-effort",
            "summary": "measured partial result", "stopReason": "residual remains",
            "artifacts": [{"path": "nested/result.json", "sha256": sha256(artifact.read_bytes()).hexdigest(), "kind": "result"}],
        }
        publish(self.task / "workspace" / "resident-delivery.json", candidate)
        delivery = self.request("delivery-1", "delivery")
        self.assertEqual(delivery["status"], "completed")
        manifest = wait_json(self.task / "delivery" / "manifest.json")
        self.assertEqual((manifest["executionId"], manifest["outcome"]), ("execution-1", "best-effort"))
        self.assertEqual(manifest["artifacts"], candidate["artifacts"])
        retained_result = self.task.joinpath(manifest["artifactRoot"], "nested/result.json")
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
        self.assertNotIn("messageId", prompts[1]["message"]["params"], "non-UUID request ID is omitted, not sent as null")

    def test_slow_message_ack_is_immediate_and_completion_is_a_later_retained_fact(self):
        self.start_wrapper()
        self.request("start:slow", "start")
        deadline = time.monotonic() + 5
        while wait_json(self.task / "state.json")["phase"] == "running" and time.monotonic() < deadline:
            time.sleep(.02)
        started = time.monotonic()
        receipt = self.request("message:slow", "message", {"text": "LONG_MESSAGE"})
        elapsed = time.monotonic() - started
        self.assertEqual(receipt["status"], "accepted", receipt)
        self.assertEqual(receipt["result"], {"queued": True})
        self.assertLess(elapsed, 1.0, "receipt acknowledges durable queue admission, not prompt completion")
        queued = wait_json(self.task / "native" / "messages" / "message:slow.queued.json")
        self.assertEqual((queued["status"], queued["requestSha256"]), ("queued", receipt["requestSha256"]))
        deadline = time.monotonic() + 8
        completed = None
        while time.monotonic() < deadline:
            for event in (self.task / "events").glob("*.json"):
                value = json.loads(event.read_text())
                if value.get("kind") == "input" and value.get("requestId") == "message:slow":
                    completed = value
                    break
            if completed is not None:
                break
            time.sleep(.02)
        self.assertIsNotNone(completed)
        self.assertEqual(completed["status"], "completed")
        state = wait_json(self.task / "state.json")
        self.assertEqual((state["phase"], state["detail"]["completedRequestId"]), ("waiting", "message:slow"))

    def test_uuid_message_id_is_forwarded_while_non_uuid_ids_are_omitted(self):
        self.start_wrapper()
        self.request("start:uuid", "start")
        deadline = time.monotonic() + 5
        while wait_json(self.task / "state.json")["phase"] == "running" and time.monotonic() < deadline:
            time.sleep(.02)
        request_id = "123e4567-e89b-42d3-a456-426614174000"
        self.assertEqual(self.request(request_id, "message", {"text": "uuid message"})["status"], "accepted")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = wait_json(self.task / "state.json")
            if state.get("detail", {}).get("completedRequestId") == request_id:
                break
            time.sleep(.02)
        trace = [json.loads(line) for line in (self.task / "native/session-events.jsonl").read_text().splitlines()]
        prompt = next(entry for entry in trace if entry["direction"] == "wrapper-to-native"
                      and entry["message"].get("method") == "session/prompt"
                      and entry["message"]["params"].get("messageId") == request_id)
        self.assertEqual(prompt["message"]["params"]["messageId"], request_id)

    def test_restart_marks_accepted_but_unfinished_message_unknown_without_replay(self):
        self.start_wrapper()
        self.request("start:queued-crash", "start")
        deadline = time.monotonic() + 5
        while wait_json(self.task / "state.json")["phase"] == "running" and time.monotonic() < deadline:
            time.sleep(.02)
        receipt = self.request("message:queued-crash", "message", {"text": "LONG_MESSAGE"})
        self.assertEqual(receipt["status"], "accepted")
        os.kill(self.process.pid, signal.SIGKILL)
        self.process.wait(timeout=3)
        self.process.communicate()
        self.process = None
        self.start_wrapper()
        deadline = time.monotonic() + 5
        unknown = None
        while time.monotonic() < deadline:
            for event in (self.task / "events").glob("*.json"):
                value = json.loads(event.read_text())
                if value.get("requestId") == "message:queued-crash":
                    unknown = value
                    break
            if unknown is not None:
                break
            time.sleep(.02)
        self.assertIsNotNone(unknown)
        self.assertEqual(unknown["status"], "unknown")
        trace = [json.loads(line) for line in (self.task / "native" / "session-events.jsonl").read_text().splitlines()]
        prompts = [entry for entry in trace if entry["direction"] == "wrapper-to-native"
                   and entry["message"].get("method") == "session/prompt"]
        self.assertEqual(len(prompts), 2, "restart did not replay the accepted but unfinished message")

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

    def test_delivery_rejects_symlinked_parent_escape_to_protected_auth(self):
        protected = self.root / "protected" / "auth.json"
        protected.parent.mkdir()
        protected.write_text('{"key":"DUMMY-ACCOUNT-KEY-MUST-NOT-LEAK"}\n')
        (self.task / "workspace" / "linked-parent").symlink_to(protected.parent, target_is_directory=True)
        candidate = {
            "schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
            "summary": "attempted escape", "stopReason": "fixture",
            "artifacts": [{"path": "linked-parent/auth.json", "sha256": sha256(protected.read_bytes()).hexdigest(), "kind": "result"}],
        }
        publish(self.task / "workspace" / "resident-delivery.json", candidate)
        self.start_wrapper()
        self.request("start:symlink-parent", "start")
        deadline = time.monotonic() + 5
        while wait_json(self.task / "state.json")["phase"] == "running" and time.monotonic() < deadline:
            time.sleep(.02)
        delivery = self.request("delivery:symlink-parent", "delivery")
        self.assertEqual(delivery["status"], "rejected", delivery)
        self.assertRegex(delivery["error"], r"symlink|workspace|plain")
        self.assertFalse((self.task / "delivery" / "manifest.json").exists())
        self.assertEqual(protected.read_text(), '{"key":"DUMMY-ACCOUNT-KEY-MUST-NOT-LEAK"}\n')

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
        self.assertEqual(message["status"], "accepted")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = wait_json(self.task / "state.json")
            if state.get("phase") == "waiting" and state.get("detail", {}).get("completedRequestId") == "message:repair":
                break
            time.sleep(.02)
        self.assertEqual(state.get("detail", {}).get("completedRequestId"), "message:repair")
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
        publish(self.task / "runtime.json", framed({
            "schema": "hima-resident-engineering-runtime/1", "taskId": "task-1", "createdAt": "2026-10-02T00:00:00Z",
        }))
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

    def test_fixed_reconcile_mode_stops_retained_owner_without_replaying_business_work(self):
        self.task_record["goal"] = "SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start:fixed-reconcile", "start")
        descendant = int(wait_json_text(self.descendant_pid))
        owned = wait_json(self.task / "native" / "owned.json")
        native_pid = owned["processPid"]
        os.kill(self.process.pid, signal.SIGKILL)
        self.process.wait(timeout=3)
        self.process.communicate()
        self.process = None
        result = self.run_reconcile()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(process_exists(native_pid))
        self.assertFalse(process_exists(descendant))
        reconciled = wait_json(self.task / "native" / "owned.json")
        state = wait_json(self.task / "state.json")
        self.assertTrue(reconciled["quiescent"])
        self.assertEqual((state["phase"], state["detail"]["reason"]), ("stopped", "recovery"))
        trace = [json.loads(line) for line in (self.task / "native" / "session-events.jsonl").read_text().splitlines()]
        prompts = [entry for entry in trace if entry["direction"] == "wrapper-to-native"
                   and entry["message"].get("method") == "session/prompt"]
        self.assertEqual(len(prompts), 1, "reconcile did not restart ACP or replay the initial prompt")

    def test_fixed_reconcile_does_not_require_current_native_executable(self):
        self.task_record["goal"] = "SPAWN_DESCENDANT SURVIVE_WRAPPER_CRASH"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start:reconcile-no-cli", "start")
        descendant = int(wait_json_text(self.descendant_pid))
        os.kill(self.process.pid, signal.SIGKILL)
        self.process.wait(timeout=3)
        self.process.communicate()
        self.process = None
        capability = json.loads(self.capability.read_text())
        capability["native"]["executable"] = "/definitely-missing-opencode"
        capability["native"]["version"] = "removed-after-crash"
        self.capability.write_text(json.dumps(capability))
        result = self.run_reconcile()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(process_exists(descendant))
        self.assertTrue(wait_json(self.task / "native" / "owned.json")["quiescent"])

    def test_hup_cleanup_and_fixed_reconcile_serialize_on_same_owned_tree(self):
        self.task_record["goal"] = "SPAWN_DESCENDANT"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start:hup-reconcile", "start")
        descendant = int(wait_json_text(self.descendant_pid))
        self.process.send_signal(signal.SIGHUP)
        reconciled = self.run_reconcile()
        self.assertEqual(reconciled.returncode, 0, reconciled.stderr)
        self.process.wait(timeout=5)
        self.process.communicate()
        self.process = None
        self.assertFalse(process_exists(descendant))
        owned = wait_json(self.task / "native" / "owned.json")
        state = wait_json(self.task / "state.json")
        self.assertTrue(owned["quiescent"])
        self.assertEqual(state["phase"], "stopped")

    def test_successful_hup_cleanup_publishes_signed_stopped_state(self):
        self.task_record["goal"] = "SPAWN_DESCENDANT"
        publish(self.task / "task.json", framed(self.task_record))
        self.start_wrapper()
        self.request("start:hup-state", "start")
        descendant = int(wait_json_text(self.descendant_pid))
        self.process.send_signal(signal.SIGHUP)
        self.assertEqual(self.process.wait(timeout=5), 0)
        self.process.communicate()
        self.process = None
        self.assertFalse(process_exists(descendant))
        owned = wait_json(self.task / "native" / "owned.json")
        state = wait_json(self.task / "state.json")
        self.assertTrue(owned["quiescent"])
        self.assertEqual((state["phase"], state["detail"]["reason"]), ("stopped", "signal"))

    def test_fixed_reconcile_mode_refuses_missing_owned_identity(self):
        publish(self.task / "runtime.json", framed({
            "schema": "hima-resident-engineering-runtime/1", "taskId": "task-1", "createdAt": "2026-10-02T00:00:00Z",
        }))
        result = self.run_reconcile()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(wait_json(self.task / "state.json")["phase"], "failed")

    def test_fixed_reconcile_confirms_never_started_when_all_native_identity_is_absent(self):
        self.assertFalse((self.task / "runtime.json").exists())
        result = self.run_reconcile()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.task / "runtime.json").exists())
        owned = wait_json(self.task / "native" / "owned.json")
        state = wait_json(self.task / "state.json")
        self.assertTrue(owned["quiescent"])
        self.assertEqual(owned["detail"]["reason"], "never-started")
        self.assertEqual((state["phase"], state["detail"]["native"]), ("stopped", "never-started"))

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
