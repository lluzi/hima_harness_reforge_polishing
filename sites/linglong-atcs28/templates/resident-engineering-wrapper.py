#!/usr/bin/env python3
"""Task-local OpenCode ACP adapter for Hima resident engineering.

The Host owns business admission and the task envelope.  This process owns only
the native ACP session, immutable request/receipt plumbing, confinement, and
delivery-file identity.  stdout is never part of the Host protocol.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import fcntl
import os
from pathlib import Path, PurePosixPath
import queue
import re
import secrets
import signal
import stat
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit


PROTOCOL = "hima-resident-engineering/1"
CAPABILITY_SCHEMA = "hima-resident-engineering-capability/1"
REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$")
UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
HEX64 = re.compile(r"^[a-f0-9]{64}$")
DEEPSEEK_UPSTREAM = "https://api.deepseek.com"


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def reject_constant(value):
    raise ValueError(f"non-finite JSON number: {value}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path):
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError(f"JSON file exceeds 8 MiB: {path}")
    data = path.read_bytes()
    return json.loads(data.decode("utf-8"), parse_constant=reject_constant, object_pairs_hook=unique_object)


def canonical(value):
    def finite(item):
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("canonical JSON refuses non-finite numbers")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str):
                    raise ValueError("canonical JSON object keys are strings")
                finite(child)
        elif isinstance(item, list):
            for child in item:
                finite(child)
    finite(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest_body(value):
    body = dict(value)
    body.pop("sha256", None)
    return sha256(canonical(body)).hexdigest()


def validate_signed_subset(value):
    """Keep Host-signed frames identical across JS and Python without claiming RFC 8785."""
    if value is None or isinstance(value, (str, bool)):
        return
    if isinstance(value, (int, float)):
        raise ValueError("signed request frames do not admit JSON numbers")
    if isinstance(value, list):
        for item in value:
            validate_signed_subset(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if any(ord(character) > 0xFFFF for character in key):
                raise ValueError("signed request object keys do not admit non-BMP characters")
            validate_signed_subset(item)
        return
    raise ValueError("unsupported signed request JSON value")


def atomic_create(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    payload = canonical(value)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        remaining = memoryview(payload)
        while remaining:
            remaining = remaining[os.write(fd, remaining):]
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        os.link(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_replace(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        remaining = memoryview(canonical(value))
        while remaining:
            remaining = remaining[os.write(fd, remaining):]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary, path)
    fsync_directory(path.parent)


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def file_digest(path):
    digest = sha256()
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)


def process_identity(pid):
    stat_path = Path(f"/proc/{pid}/stat")
    try:
        raw = stat_path.read_text()
        fields = raw[raw.rfind(")") + 2:].split()
        if len(fields) > 19:
            return f"proc-start-ticks:{fields[19]}"
    except (FileNotFoundError, PermissionError, ValueError):
        pass
    try:
        return subprocess.check_output(
            ["ps", "-o", "lstart=", "-p", str(pid)], text=True, stderr=subprocess.DEVNULL,
        ).strip() or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def descendant_pids(root_pid):
    try:
        rows = subprocess.check_output(["ps", "-axo", "pid=,ppid="], text=True).splitlines()
    except Exception:
        return set()
    children = {}
    for row in rows:
        try:
            pid, parent = map(int, row.split())
        except ValueError:
            continue
        children.setdefault(parent, set()).add(pid)
    owned = set()
    frontier = [root_pid]
    while frontier:
        parent = frontier.pop()
        for child in children.get(parent, set()):
            if child not in owned:
                owned.add(child)
                frontier.append(child)
    return owned


def framed(body):
    return {**body, "sha256": sha256(canonical(body)).hexdigest()}


def plain_file(path):
    mode = path.lstat().st_mode
    if not stat.S_ISREG(mode) or path.is_symlink():
        raise ValueError(f"not a plain file: {path}")


@contextmanager
def confined_file(root, relative):
    """Open a workspace-relative plain file without following any path component."""
    parts = tuple(relative.parts)
    if not parts or relative.is_absolute() or ".." in parts:
        raise ValueError("path is not workspace-relative")
    opened = []
    try:
        current = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        opened.append(current)
        for index, part in enumerate(parts):
            final = index == len(parts) - 1
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            if not final:
                flags |= getattr(os, "O_DIRECTORY", 0)
            current = os.open(part, flags, dir_fd=current)
            opened.append(current)
        state = os.fstat(current)
        if not stat.S_ISREG(state.st_mode) or state.st_nlink != 1:
            raise ValueError(f"workspace artifact is not a single-link plain file: {relative}")
        yield current
    except OSError as error:
        raise ValueError(f"workspace path contains a symlink, missing component, or non-plain file: {relative}: {error}") from error
    finally:
        for fd in reversed(opened):
            os.close(fd)


def read_confined(root, relative, maximum=8 * 1024 * 1024):
    with confined_file(root, relative) as fd:
        state = os.fstat(fd)
        if state.st_size > maximum:
            raise ValueError(f"workspace JSON file exceeds {maximum} bytes: {relative}")
        chunks = []
        while True:
            chunk = os.read(fd, min(1024 * 1024, maximum + 1 - sum(map(len, chunks))))
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
            if sum(map(len, chunks)) > maximum:
                raise ValueError(f"workspace JSON file exceeds {maximum} bytes: {relative}")


def confined_digest(root, relative):
    digest = sha256()
    with confined_file(root, relative) as fd:
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)


def copy_confined(root, relative, destination):
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with confined_file(root, relative) as source_fd:
        target_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o400)
        try:
            while True:
                chunk = os.read(source_fd, 1024 * 1024)
                if not chunk:
                    break
                remaining = memoryview(chunk)
                while remaining:
                    remaining = remaining[os.write(target_fd, remaining):]
            os.fsync(target_fd)
        finally:
            os.close(target_fd)
    fsync_directory(destination.parent)


class ProviderBroker:
    """Task-lifetime DeepSeek forwarder; the real account key never enters the native sandbox."""

    def __init__(self, auth_path, task_home, upstream=DEEPSEEK_UPSTREAM):
        self.auth_path = Path(auth_path)
        self.task_home = Path(task_home)
        self.upstream = urlsplit(upstream)
        self.token = secrets.token_urlsafe(32)
        self.server = None
        self.thread = None
        self.connections = set()
        self.connection_lock = threading.Lock()
        self.handler_threads = set()

    def _account_key(self):
        plain_file(self.auth_path)
        auth = load_json(self.auth_path)
        record = auth.get("deepseek") if isinstance(auth, dict) else None
        if not isinstance(record, dict) or record.get("type") != "api" or not isinstance(record.get("key"), str) or not record["key"]:
            raise ValueError("native DeepSeek API authentication is unavailable")
        return record["key"]

    def _prepare_sanitized_home(self, base_url):
        config = self.task_home / ".config" / "opencode" / "opencode.json"
        auth = self.task_home / ".local" / "share" / "opencode" / "auth.json"
        atomic_create(config, {
            "model": "deepseek/deepseek-flash",
            "small_model": "deepseek/deepseek-flash",
            "enabled_providers": ["deepseek"],
            "provider": {"deepseek": {"options": {"baseURL": base_url}}},
        })
        atomic_create(auth, {"deepseek": {"type": "api", "key": self.token}})

    def start(self):
        account_key = self._account_key()
        broker = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"

            def log_message(self, _format, *_args):
                return

            def handle(self):
                current = threading.current_thread()
                with broker.connection_lock:
                    broker.handler_threads.add(current)
                try:
                    return super().handle()
                finally:
                    with broker.connection_lock:
                        broker.handler_threads.discard(current)

            def _deny(self, status, message):
                body = json.dumps({"error": message}, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                if self.path != "/deepseek/chat/completions":
                    self._deny(404, "provider route is not allowed")
                    return
                if self.headers.get("Authorization") != f"Bearer {broker.token}":
                    self._deny(401, "task provider token is invalid")
                    return
                try:
                    length = int(self.headers.get("Content-Length", ""))
                except ValueError:
                    length = -1
                if length < 0 or length > 128 * 1024 * 1024:
                    self._deny(413, "provider request size is invalid")
                    return
                body = self.rfile.read(length)
                try:
                    request = json.loads(body.decode("utf-8"), parse_constant=reject_constant, object_pairs_hook=unique_object)
                except Exception:
                    self._deny(400, "provider request is not valid JSON")
                    return
                if not isinstance(request, dict) or request.get("model") != "deepseek-flash":
                    self._deny(403, "provider model is outside this task capability")
                    return
                connection_class = http.client.HTTPSConnection if broker.upstream.scheme == "https" else http.client.HTTPConnection
                port = broker.upstream.port or (443 if broker.upstream.scheme == "https" else 80)
                connection = connection_class(broker.upstream.hostname, port, timeout=300)
                with broker.connection_lock:
                    broker.connections.add(connection)
                try:
                    prefix = broker.upstream.path.rstrip("/")
                    connection.request("POST", f"{prefix}/chat/completions", body=body, headers={
                        "Authorization": f"Bearer {account_key}",
                        "Content-Type": "application/json",
                        "Accept": self.headers.get("Accept", "application/json"),
                    })
                    response = connection.getresponse()
                    self.send_response(response.status)
                    for name in ("Content-Type", "Content-Encoding", "Cache-Control"):
                        value = response.getheader(name)
                        if value:
                            self.send_header(name, value)
                    self.end_headers()
                    while True:
                        chunk = response.read1(64 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except Exception:
                    self._deny(502, "upstream provider request failed")
                finally:
                    connection.close()
                    with broker.connection_lock:
                        broker.connections.discard(connection)

            def do_GET(self):
                self._deny(405, "provider method is not allowed")

        ThreadingHTTPServer.daemon_threads = True
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, name="resident-provider-broker", daemon=True)
        self.thread.start()
        port = self.server.server_address[1]
        base_url = f"http://127.0.0.1:{port}/deepseek"
        self._prepare_sanitized_home(base_url)
        return base_url

    def stop(self):
        with self.connection_lock:
            connections = list(self.connections)
        for connection in connections:
            try:
                if connection.sock is not None:
                    connection.sock.shutdown(2)
                connection.close()
            except Exception:
                pass
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
        if self.thread is not None:
            self.thread.join(timeout=5)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with self.connection_lock:
                alive = [thread for thread in self.handler_threads if thread.is_alive()]
            if not alive:
                break
            time.sleep(.02)
        if alive:
            raise RuntimeError("task provider broker requests did not quiesce")
        self.server = None
        self.thread = None


class ACP:
    def __init__(self, argv, cwd, env, trace, stderr_log):
        self.trace = trace
        self.write_lock = threading.Lock()
        self.pending = {}
        self.pending_lock = threading.Lock()
        self.next_id = 1
        self.closed = threading.Event()
        self.process = subprocess.Popen(
            argv, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, bufsize=1, start_new_session=True,
        )
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._drain_stderr, args=(stderr_log,), daemon=True).start()

    def _record(self, direction, message):
        self.trace.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        line = canonical({"at": now(), "direction": direction, "message": message}) + b"\n"
        with self.write_lock:
            with self.trace.open("ab") as output:
                output.write(line)

    def _drain_stderr(self, stderr_log):
        stderr_log.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with stderr_log.open("a", encoding="utf-8") as output:
            for line in self.process.stderr:
                output.write(line)
                output.flush()

    def _read(self):
        try:
            for line in self.process.stdout:
                message = json.loads(line, parse_constant=reject_constant, object_pairs_hook=unique_object)
                self._record("native-to-wrapper", message)
                if "method" in message:
                    incoming.put(message)
                    continue
                key = message.get("id")
                with self.pending_lock:
                    waiter = self.pending.get(key)
                if waiter is not None:
                    waiter.put(message)
        finally:
            self.closed.set()
            with self.pending_lock:
                waiters = list(self.pending.values())
            for waiter in waiters:
                waiter.put({"error": {"message": "ACP process closed"}})

    def send(self, message):
        self._record("wrapper-to-native", message)
        data = json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self.write_lock:
            if self.process.stdin is None or self.process.poll() is not None:
                raise RuntimeError("ACP process is not running")
            self.process.stdin.write(data)
            self.process.stdin.flush()

    def request(self, method, params, timeout=120):
        with self.pending_lock:
            request_id = self.next_id
            self.next_id += 1
            waiter = queue.Queue(maxsize=1)
            self.pending[request_id] = waiter
        try:
            self.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            response = waiter.get(timeout=timeout)
            if "error" in response:
                raise RuntimeError(f"ACP {method} failed: {response['error']}")
            return response.get("result", {})
        finally:
            with self.pending_lock:
                self.pending.pop(request_id, None)

    def notify(self, method, params):
        self.send({"jsonrpc": "2.0", "method": method, "params": params})


incoming = queue.Queue()


class Wrapper:
    def __init__(self, task_dir, capability_path, reconcile_only=False):
        self.reconcile_only = reconcile_only
        self.task_dir = task_dir.resolve()
        self.capability_path = capability_path.resolve()
        plain_file(self.capability_path)
        plain_file(self.task_dir / "task.json")
        self.capability = load_json(self.capability_path)
        self.task = load_json(self.task_dir / "task.json")
        if self.task.get("sha256") != digest_body(self.task):
            raise ValueError("task envelope digest mismatch")
        validate_signed_subset(self.task)
        self.validate_configuration()
        workspace_leaf = self.task_dir / self.capability["sandbox"]["privateWorkspace"]
        home_leaf = self.task_dir / self.capability["sandbox"]["privateHome"]
        for leaf in (workspace_leaf, home_leaf):
            if leaf.exists() or leaf.is_symlink():
                mode = leaf.lstat().st_mode
                if leaf.is_symlink() or not stat.S_ISDIR(mode):
                    raise ValueError(f"task-private directory is not a plain directory: {leaf}")
            else:
                leaf.mkdir(mode=0o700)
        self.workspace = workspace_leaf.resolve()
        self.home = home_leaf.resolve()
        self.receipts = self.task_dir / "receipts"
        self.events = self.task_dir / "events"
        self.native_dir = self.task_dir / "native"
        self.native_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.container_cid = self.native_dir / "container.cid"
        self.owned_file = self.native_dir / "owned.json"
        self.recovered_owned = load_json(self.owned_file) if self.owned_file.exists() else None
        self.stop_event = threading.Event()
        self.cancelled = threading.Event()
        self.rpc = None
        self.provider_broker = None
        self.session_id = None
        self.event_seq = max(
            [int(path.stem) for path in self.events.glob("*.json") if path.stem.isdigit()] or [0]
        )
        self.prompt_threads = set()
        self.inflight = set()
        self.prompt_lock = threading.Lock()
        self.runtime = self.task_dir / "runtime.json"
        self.resumed = self.runtime.exists()
        if self.resumed:
            runtime = load_json(self.runtime)
            if (runtime.get("schema") != "hima-resident-engineering-runtime/1"
                    or runtime.get("taskId") != self.task["taskId"]
                    or runtime.get("sha256") != digest_body(runtime)):
                raise ValueError("retained runtime identity is invalid")
        elif not self.reconcile_only:
            atomic_create(self.runtime, framed({
                "schema": "hima-resident-engineering-runtime/1", "taskId": self.task["taskId"], "createdAt": now(),
            }))
        if self.recovered_owned is not None:
            if (self.recovered_owned.get("schema") != "hima-resident-engineering-owned/1"
                    or self.recovered_owned.get("taskId") != self.task["taskId"]
                    or self.recovered_owned.get("sha256") != digest_body(self.recovered_owned)):
                raise ValueError("retained native ownership identity is invalid")

    def validate_configuration(self):
        required = {"schema", "protocol", "wrapper", "native", "sandbox", "environment", "permissions", "delivery", "stopGraceSeconds"}
        if set(self.capability) != required:
            raise ValueError(f"capability fields differ: {sorted(set(self.capability) ^ required)}")
        if self.capability["schema"] != CAPABILITY_SCHEMA or self.capability["protocol"] != PROTOCOL:
            raise ValueError("unsupported resident engineering capability")
        nested = {
            "wrapper": {"argv"},
            "native": {"executable", "version", "argv", "model", "protocolVersion"},
            "environment": {"inherit", "set", "toolPaths", "credentialReadPaths"},
            "permissions": {"autoApprove", "denyUnknown"},
            "delivery": {"candidate"},
        }
        for name, fields in nested.items():
            if not isinstance(self.capability[name], dict) or set(self.capability[name]) != fields:
                raise ValueError(f"invalid {name} capability fields")
        wrapper_argv = self.capability["wrapper"]["argv"]
        if (not isinstance(wrapper_argv, list) or len(wrapper_argv) != 3
                or not all(isinstance(item, str) and item for item in wrapper_argv)
                or not Path(wrapper_argv[0]).is_absolute()
                or wrapper_argv[1] != "--capability"
                or Path(wrapper_argv[2]).resolve() != self.capability_path):
            raise ValueError("wrapper argv must be absolute-wrapper --capability exact-config")
        sandbox = self.capability["sandbox"]
        sandbox_fields = ({"kind", "testOnly", "privateWorkspace", "privateHome"}
                          if sandbox.get("kind") == "none" else
                          {"kind", "executable", "image", "readOnlyRoots", "privateWorkspace", "privateHome", "network"})
        if set(sandbox) != sandbox_fields:
            raise ValueError("invalid sandbox capability fields")
        paths = [self.capability["native"]["executable"], *self.capability["environment"]["toolPaths"],
                 *self.capability["environment"]["credentialReadPaths"]]
        if sandbox.get("kind") == "podman":
            paths.extend([sandbox["executable"], *sandbox["readOnlyRoots"]])
        if not all(isinstance(value, str) and Path(value).is_absolute() for value in paths):
            raise ValueError("capability executable, tool, credential and read-root paths must be absolute")
        for field in ("privateWorkspace", "privateHome"):
            part = PurePosixPath(sandbox[field])
            if part.is_absolute() or ".." in part.parts or len(part.parts) != 1:
                raise ValueError(f"sandbox {field} must be one relative directory")
        if not isinstance(self.capability["stopGraceSeconds"], (int, float)) or self.capability["stopGraceSeconds"] <= 0:
            raise ValueError("stopGraceSeconds must be positive")
        if self.capability["permissions"].get("denyUnknown") is not True:
            raise ValueError("unknown native permissions must fail closed")
        if sandbox.get("kind") == "podman":
            if len(self.capability["environment"]["credentialReadPaths"]) != 1:
                raise ValueError("production capability needs one wrapper-host auth file")
            campaign = Path(self.task.get("campaignWorkspace", ""))
            if (not campaign.is_absolute() or campaign.resolve() != self.task_dir.parent.parent
                    or self.task_dir.parent.name != ".hima-engineering"):
                raise ValueError("task directory is not scoped beneath its declared campaign workspace")
        if self.task.get("schema") != PROTOCOL:
            raise ValueError("unsupported task envelope")
        expected_workspace = (self.task_dir / self.capability["sandbox"]["privateWorkspace"]).resolve()
        if Path(self.task.get("workspace", "")).resolve() != expected_workspace:
            raise ValueError("task workspace differs from the capability-private workspace")
        native = self.capability["native"]
        if native.get("protocolVersion") != 1 or native.get("model") != "deepseek/deepseek-flash":
            raise ValueError("native ACP protocol/model mismatch")
        if not self.reconcile_only:
            version = subprocess.run([native["executable"], "--version"], capture_output=True, text=True, timeout=10)
            observed = (version.stdout or version.stderr).strip()
            if version.returncode != 0 or observed != native["version"]:
                raise ValueError(f"native executable version mismatch: expected {native['version']}, observed {observed or version.returncode}")
        if sandbox.get("kind") == "none":
            if not sandbox.get("testOnly") or os.environ.get("HIMA_RESIDENT_TESTING") != "1":
                raise ValueError("an unsandboxed resident session is test-only")
        elif sandbox.get("kind") != "podman":
            raise ValueError("production resident sessions require the declared Podman sandbox")

    def state(self, phase, active=None, detail=None):
        body = {
            "schema": PROTOCOL, "taskId": self.task["taskId"],
            **({"sessionId": self.session_id} if self.session_id else {}),
            "phase": phase,
            **({"activeRequestId": active} if active else {}),
            **({"detail": detail} if detail else {}),
            "updatedAt": now(),
        }
        atomic_replace(self.task_dir / "state.json", framed(body))

    def receipt(self, request, status, result=None, error=None):
        body = {
            "schema": PROTOCOL, "taskId": self.task["taskId"], "requestId": request["requestId"],
            "requestSha256": request["sha256"],
            **({"sessionId": self.session_id} if self.session_id else {}),
            "status": status,
            **({"result": result} if result is not None else {}),
            **({"error": error} if error is not None else {}),
        }
        try:
            atomic_create(self.receipts / f"{request['requestId']}.json", framed(body))
        except FileExistsError:
            pass

    def event(self, kind, payload):
        self.event_seq += 1
        body = {"schema": PROTOCOL, "taskId": self.task["taskId"], "seq": f"{self.event_seq:08d}", "kind": kind, **payload, "createdAt": now()}
        atomic_create(self.events / f"{self.event_seq:08d}.json", framed(body))

    def reconcile_queued_messages(self):
        completed = set()
        for path in self.events.glob("*.json"):
            try:
                value = load_json(path)
            except Exception:
                continue
            if value.get("kind") == "input" and isinstance(value.get("requestId"), str):
                completed.add(value["requestId"])
        messages = self.native_dir / "messages"
        for path in sorted(messages.glob("*.queued.json")) if messages.exists() else []:
            queued = load_json(path)
            request_id = queued.get("requestId")
            if request_id in completed:
                continue
            self.event("input", {
                "sessionId": queued.get("sessionId"), "requestId": request_id,
                "requestSha256": queued.get("requestSha256"), "status": "unknown",
                "error": "wrapper restarted before native message completion was confirmed; message was not replayed",
            })

    def native_argv(self):
        native = self.capability["native"]
        sandbox = self.capability["sandbox"]
        if sandbox["kind"] == "none":
            return [native["executable"], *native["argv"]]
        try:
            native_relative = Path(native["executable"]).relative_to("/home/luzi")
        except ValueError:
            native_relative = None
        if native_relative is not None:
            native_target = self.home / native_relative
            native_target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if not native_target.exists():
                native_target.touch(mode=0o500)
        argv = [
            sandbox["executable"], "run", "--rm", "-i", "--read-only", "--network", sandbox["network"],
            "--userns", "keep-id", "--security-opt=no-new-privileges", "--cap-drop=all", "--pids-limit", "4096",
            "--init", "--cidfile", str(self.container_cid), "--stop-timeout", str(self.capability["stopGraceSeconds"]),
            "--user", f"{os.getuid()}:{os.getgid()}", "--shm-size", "16g",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=4g", "--ulimit", "stack=-1:-1",
            "--ulimit", "nofile=1048576:1048576", "--workdir", str(self.workspace),
        ]
        for root in sandbox["readOnlyRoots"]:
            argv.extend(["--mount", f"type=bind,src={root},dst={root},ro=true"])
        campaign = Path(self.task["campaignWorkspace"]).resolve()
        argv.extend(["--mount", f"type=bind,src={campaign},dst={campaign},ro=true"])
        private_root = self.task_dir.parent
        argv.extend(["--tmpfs", f"{private_root}:rw,nosuid,nodev,noexec"])
        argv.extend(["--mount", f"type=bind,src={self.task_dir},dst={self.task_dir},ro=true"])
        argv.extend(["--mount", f"type=bind,src={self.home},dst=/home/luzi,rw=true"])
        argv.extend([
            "--mount", f"type=bind,src={native['executable']},dst={native['executable']},ro=true",
            "--mount", f"type=bind,src={self.workspace},dst={self.workspace},rw=true",
        ])
        for name in self.capability["environment"]["inherit"]:
            if name in os.environ:
                argv.extend(["--env", name])
        for name, value in self.capability["environment"]["set"].items():
            argv.extend(["--env", f"{name}={value}"])
        argv.extend([
            "--env", "HOME=/home/luzi", sandbox["image"],
            "/bin/bash", "--noprofile", "--norc", "-c",
            'if [ -n "${EDA_INIT:-}" ] && [ -r "$EDA_INIT" ]; then . "$EDA_INIT" >&2; fi; '
            'test "${EMPYREAN_LICENSE_MODE:-}" = old; exec "$@"',
            "hima-native", native["executable"], *native["argv"],
        ])
        return argv

    def native_env(self):
        config = self.capability["environment"]
        env = {name: os.environ[name] for name in config["inherit"] if name in os.environ}
        env.update(config["set"])
        if self.capability["sandbox"]["kind"] == "none":
            env["HOME"] = str(self.home)
        path = os.pathsep.join(config["toolPaths"])
        if path:
            env["PATH"] = path
        return env

    def launch(self):
        self.state("starting")
        try:
            if self.capability["sandbox"]["kind"] == "podman":
                auth_file = self.capability["environment"]["credentialReadPaths"][0]
                self.provider_broker = ProviderBroker(auth_file, self.home)
                self.provider_broker.start()
            self.rpc = ACP(self.native_argv(), str(self.workspace), self.native_env(), self.native_dir / "session-events.jsonl", self.native_dir / "stderr.log")
            self.record_owned(False)
            initialized = self.rpc.request("initialize", {
                "protocolVersion": self.capability["native"]["protocolVersion"],
                "clientCapabilities": {},
                "clientInfo": {"name": "Hima resident engineering adapter", "version": "1"},
            }, timeout=30)
            info = initialized.get("agentInfo", {})
            if info.get("version") != self.capability["native"]["version"]:
                raise RuntimeError(f"ACP agent version mismatch: {info.get('version')}")
            session = self.rpc.request("session/new", {"cwd": str(self.workspace), "mcpServers": []}, timeout=30)
            self.session_id = session["sessionId"]
            self.rpc.request("session/set_config_option", {
                "sessionId": self.session_id, "configId": "model", "value": self.capability["native"]["model"],
            }, timeout=30)
        except Exception:
            if self.rpc is not None:
                try:
                    self.shutdown_native(graceful=False)
                except Exception:
                    pass
            elif self.provider_broker is not None:
                self.provider_broker.stop()
                self.provider_broker = None
            raise

    def stop_provider_broker(self):
        if self.provider_broker is not None:
            self.provider_broker.stop()
            self.provider_broker = None

    def prompt_text(self, payload, initial=False):
        if initial:
            return canonical({
                "identity": {key: self.task[key] for key in (
                    "taskId", "runId", "executionId", "nodeId", "actor", "ownerEpoch",
                    "controlRevision", "site", "campaignWorkspace",
                ) if key in self.task},
                "task": self.task.get("task", {}),
                "goal": self.task["goal"],
                "constraints": self.task["constraints"],
                "inputs": self.task["inputs"],
                "knowledge": self.task["knowledge"],
                **({"context": self.task["context"]} if "context" in self.task else {}),
                "workspace": str(self.workspace),
                "delivery": {
                    "candidate": self.capability["delivery"]["candidate"],
                    "schema": "hima-resident-engineering-candidate/1",
                    "outcomes": ["completed", "best-effort", "blocked", "cancelled"],
                    "requiredResultArtifactKind": "result",
                    "artifactPaths": "workspace-relative plain files with sha256",
                },
            }).decode("utf-8")
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("message payload needs non-empty text")
        return text

    def run_prompt(self, request, initial=False):
        self.inflight.add(request["requestId"])
        def worker():
            try:
                with self.prompt_lock:
                    if self.cancelled.is_set():
                        if not initial:
                            self.event("input", {
                                "sessionId": self.session_id, "requestId": request["requestId"],
                                "requestSha256": request["sha256"], "status": "unknown",
                                "error": "task was cancelled before message delivery was confirmed",
                            })
                        return
                    self.state("running", request["requestId"])
                    params = {
                        "sessionId": self.session_id,
                        "prompt": [{"type": "text", "text": self.prompt_text(request["payload"], initial)}],
                    }
                    if UUID.fullmatch(request["requestId"]):
                        params["messageId"] = request["requestId"]
                    result = self.rpc.request("session/prompt", params, timeout=24 * 60 * 60)
                    if not self.cancelled.is_set():
                        detail = {"stopReason": result.get("stopReason")}
                        if not initial:
                            detail["completedRequestId"] = request["requestId"]
                        self.state("waiting", detail=detail)
                        if not initial:
                            self.event("input", {
                                "sessionId": self.session_id, "requestId": request["requestId"],
                                "requestSha256": request["sha256"], "status": "completed",
                                "stopReason": result.get("stopReason"),
                            })
            except Exception as error:
                if not self.cancelled.is_set():
                    self.state("failed", request["requestId"], {"error": str(error)})
                    if not initial:
                        self.event("input", {
                            "sessionId": self.session_id, "requestId": request["requestId"],
                            "requestSha256": request["sha256"], "status": "unknown", "error": str(error),
                        })
            finally:
                self.prompt_threads.discard(threading.current_thread())
                self.inflight.discard(request["requestId"])
        thread = threading.Thread(target=worker, daemon=True)
        self.prompt_threads.add(thread)
        thread.start()

    def validate_request(self, path):
        plain_file(path)
        request = load_json(path)
        expected = {"schema", "taskId", "requestId", "operation", "payload", "sha256"}
        if set(request) != expected or request.get("schema") != PROTOCOL or request.get("taskId") != self.task["taskId"]:
            raise ValueError("request envelope mismatch")
        if not isinstance(request["requestId"], str) or not REQUEST_ID.fullmatch(request["requestId"]) or path.stem != request["requestId"]:
            raise ValueError("request identity mismatch")
        validate_signed_subset(request)
        if request["sha256"] != digest_body(request):
            raise ValueError("request digest mismatch")
        return request

    def handle_native(self):
        while True:
            try:
                message = incoming.get_nowait()
            except queue.Empty:
                return
            method = message.get("method")
            if method == "session/update":
                continue
            if method != "session/request_permission" or "id" not in message:
                if "id" in message:
                    self.rpc.send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "unsupported client method"}})
                continue
            tool = message.get("params", {}).get("toolCall", {})
            kind = tool.get("kind", "other")
            approve = kind in self.capability["permissions"]["autoApprove"]
            options = message.get("params", {}).get("options", [])
            desired = "once" if approve else "reject"
            selected = next((item["optionId"] for item in options if item.get("optionId") == desired), None)
            if selected is None:
                selected = next((item["optionId"] for item in options if item.get("kind") == ("allow_once" if approve else "reject_once")), None)
            if selected is None:
                approve = False
                selected = next((item["optionId"] for item in options if item.get("kind", "").startswith("reject")), None)
            self.event("permission", {"sessionId": self.session_id, "toolCall": tool, "decision": "allow_once" if approve else "reject"})
            result = {"outcome": {"outcome": "selected", "optionId": selected}} if selected else {"outcome": {"outcome": "cancelled"}}
            self.rpc.send({"jsonrpc": "2.0", "id": message["id"], "result": result})

    def collect_delivery(self, request):
        if any(thread.is_alive() for thread in self.prompt_threads):
            raise ValueError("native prompt is still running")
        relative = PurePosixPath(self.capability["delivery"]["candidate"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("invalid delivery candidate path")
        candidate_bytes = read_confined(self.workspace, relative)
        candidate = json.loads(candidate_bytes.decode("utf-8"), parse_constant=reject_constant, object_pairs_hook=unique_object)
        if set(candidate) != {"schema", "outcome", "summary", "stopReason", "artifacts"} or candidate["schema"] != "hima-resident-engineering-candidate/1":
            raise ValueError("invalid delivery candidate")
        if candidate["outcome"] not in {"completed", "best-effort", "blocked", "cancelled"}:
            raise ValueError("invalid delivery outcome")
        if not isinstance(candidate["summary"], str) or not isinstance(candidate["stopReason"], str):
            raise ValueError("delivery summary and stopReason must be strings")
        artifacts = []
        result_count = 0
        if not isinstance(candidate["artifacts"], list) or len(candidate["artifacts"]) > 512:
            raise ValueError("delivery artifacts must be a bounded list")
        for artifact in candidate["artifacts"]:
            if set(artifact) != {"path", "sha256", "kind"} or not HEX64.fullmatch(artifact.get("sha256", "")):
                raise ValueError("invalid delivery artifact record")
            rel = PurePosixPath(artifact["path"])
            if rel.is_absolute() or ".." in rel.parts or not rel.parts:
                raise ValueError("delivery artifact escapes workspace")
            observed = confined_digest(self.workspace, rel)
            if observed != artifact["sha256"]:
                raise ValueError(f"delivery artifact digest mismatch: {artifact['path']}")
            result_count += artifact["kind"] == "result"
            artifacts.append(artifact)
        if result_count != 1:
            raise ValueError("delivery needs exactly one result artifact")
        candidate_digest = sha256(candidate_bytes).hexdigest()
        latest = self.task_dir / "delivery" / "manifest.json"
        if latest.exists():
            previous = load_json(latest)
            if (previous.get("candidate") == {"path": str(relative), "sha256": candidate_digest}
                    and previous.get("artifacts") == artifacts
                    and previous.get("outcome") == candidate["outcome"]
                    and previous.get("summary") == candidate["summary"]
                    and previous.get("stopReason") == candidate["stopReason"]):
                self.state("delivered", request["requestId"], {"deliverySha256": previous["sha256"], "unchanged": True})
                return previous
        artifact_root = PurePosixPath("delivery") / "artifacts" / request["requestId"]
        snapshot_root = self.task_dir.joinpath(*artifact_root.parts)
        for artifact in artifacts:
            rel = PurePosixPath(artifact["path"])
            destination = snapshot_root.joinpath(*rel.parts)
            copy_confined(self.workspace, rel, destination)
            if file_digest(destination) != artifact["sha256"]:
                raise ValueError(f"retained delivery artifact digest mismatch: {artifact['path']}")
        body = {
            "schema": "hima-resident-engineering-delivery/1",
            "taskId": self.task["taskId"], "runId": self.task["runId"], "executionId": self.task["executionId"],
            "nodeId": self.task["nodeId"], "sessionId": self.session_id,
            "outcome": candidate["outcome"], "summary": candidate["summary"], "stopReason": candidate["stopReason"],
            "candidate": {"path": str(relative), "sha256": candidate_digest},
            "artifactRoot": artifact_root.as_posix(), "artifacts": artifacts, "createdAt": now(),
        }
        manifest = framed(body)
        atomic_create(self.task_dir / "delivery" / "manifests" / f"{request['requestId']}.json", manifest)
        atomic_replace(latest, manifest)
        self.state("delivered", request["requestId"], {"deliverySha256": manifest["sha256"]})
        return manifest

    def record_owned(self, quiescent, detail=None):
        if self.rpc is None and self.recovered_owned is None:
            return
        previous = self.recovered_owned or {}
        pid = self.rpc.process.pid if self.rpc is not None else previous.get("processPid")
        identity = previous.get("processIdentity")
        process_group = previous.get("processGroupId")
        container_id = previous.get("containerId")
        if not quiescent and self.rpc is not None:
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if self.rpc.process.poll() is not None:
                    break
                identity = process_identity(pid)
                try:
                    process_group = os.getpgid(pid)
                except ProcessLookupError:
                    process_group = None
                if identity and process_group == pid:
                    break
                time.sleep(.02)
            if not identity or process_group != pid:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                raise RuntimeError("native process identity/PGID was not observable after launch")
            if self.capability["sandbox"]["kind"] == "podman":
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    if self.container_cid.exists():
                        container_id = self.container_cid.read_text().strip()
                        if HEX64.fullmatch(container_id):
                            break
                    time.sleep(.02)
                if not isinstance(container_id, str) or not HEX64.fullmatch(container_id):
                    try:
                        os.killpg(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    raise RuntimeError("native Podman container identity was not observable after launch")
        body = {
            "schema": "hima-resident-engineering-owned/1", "taskId": self.task["taskId"],
            "sandbox": self.capability["sandbox"]["kind"], "processPid": pid,
            "processIdentity": identity, "processGroupId": process_group,
            "containerCidFile": str(self.container_cid), "quiescent": quiescent,
            **({"containerId": container_id} if container_id else {}),
            **({"descendants": previous["descendants"]} if previous.get("descendants") else {}),
            "updatedAt": now(), **({"detail": detail} if detail else {}),
        }
        atomic_replace(self.owned_file, framed(body))
        self.recovered_owned = body

    @contextmanager
    def ownership_lock(self):
        lock_path = self.native_dir / "ownership.lock"
        fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def retain_descendant_identities(self, pids):
        facts = []
        for pid in sorted(pids):
            identity = process_identity(pid)
            if identity:
                facts.append({"pid": pid, "processIdentity": identity})
        if not facts or self.recovered_owned is None:
            return
        body = {key: value for key, value in self.recovered_owned.items() if key != "sha256"}
        body.update(descendants=facts, updatedAt=now())
        atomic_replace(self.owned_file, framed(body))
        self.recovered_owned = body

    def stop_container(self, grace):
        if self.capability["sandbox"]["kind"] != "podman":
            return
        if not self.container_cid.exists():
            raise RuntimeError("owned Podman container identity is missing; quiescence is unknown")
        container = self.container_cid.read_text().strip()
        if not container:
            raise RuntimeError("owned Podman container identity is empty; quiescence is unknown")
        expected = (self.recovered_owned or {}).get("containerId")
        if not isinstance(expected, str) or container != expected:
            raise RuntimeError("owned Podman container identity changed; quiescence is unknown")
        executable = self.capability["sandbox"]["executable"]
        subprocess.run([executable, "stop", "--time", str(grace), container],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=grace + 5, check=False)
        subprocess.run([executable, "rm", "--force", container],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=grace + 5, check=False)
        exists = subprocess.run([executable, "container", "exists", container],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if exists.returncode == 0:
            raise RuntimeError(f"owned container remains alive: {container}")

    def shutdown_native(self, graceful=True):
        with self.ownership_lock():
            return self._shutdown_native(graceful)

    def _shutdown_native(self, graceful=True):
        if self.rpc is None:
            return
        process = self.rpc.process
        running = process.poll() is None
        owned = descendant_pids(process.pid) if running else set()
        self.retain_descendant_identities(owned)
        if running and graceful and self.session_id:
            try:
                self.rpc.request("session/close", {"sessionId": self.session_id}, timeout=2)
            except Exception:
                pass
        if running:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            for pid in owned:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        grace = self.capability["stopGraceSeconds"]
        self.stop_container(grace)
        if running:
            try:
                process.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                for pid in owned:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.wait(timeout=grace)
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline and any(process_alive(pid) for pid in owned):
            time.sleep(.02)
        alive = [pid for pid in owned if process_alive(pid)]
        if alive:
            raise RuntimeError(f"owned descendants remain alive: {alive}")
        self.record_owned(True, {"reason": "native shutdown confirmed"})
        self.stop_provider_broker()

    def shutdown_recovered(self):
        with self.ownership_lock():
            return self._shutdown_recovered()

    def _shutdown_recovered(self):
        owned = self.recovered_owned
        if owned is None:
            raise RuntimeError("prior native ownership has no retained identity; quiescence is unknown")
        if owned.get("quiescent") is True:
            return
        pid = owned.get("processPid")
        identity = owned.get("processIdentity")
        if not isinstance(pid, int) or not isinstance(identity, str) or not identity:
            raise RuntimeError("prior native process identity is incomplete")
        current = process_identity(pid)
        descendants = descendant_pids(pid) if current == identity else set()
        retained_descendants = owned.get("descendants") if isinstance(owned.get("descendants"), list) else []
        for fact in retained_descendants:
            child = fact.get("pid") if isinstance(fact, dict) else None
            child_identity = fact.get("processIdentity") if isinstance(fact, dict) else None
            if isinstance(child, int) and isinstance(child_identity, str) and process_identity(child) == child_identity:
                descendants.add(child)
        if current == identity:
            group = owned.get("processGroupId")
            if isinstance(group, int):
                try:
                    os.killpg(group, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            for child in descendants:
                try:
                    os.kill(child, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        grace = self.capability["stopGraceSeconds"]
        self.stop_container(grace)
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline and process_identity(pid) == identity:
            time.sleep(.02)
        if process_identity(pid) == identity:
            group = owned.get("processGroupId")
            if isinstance(group, int):
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            for child in descendants:
                try:
                    os.kill(child, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + grace
        def retained_child_alive(child):
            fact = next((item for item in retained_descendants if isinstance(item, dict) and item.get("pid") == child), None)
            return process_identity(child) == fact.get("processIdentity") if fact else process_alive(child)

        while time.monotonic() < deadline and (process_identity(pid) == identity or any(retained_child_alive(child) for child in descendants)):
            time.sleep(.02)
        if process_identity(pid) == identity or any(retained_child_alive(child) for child in descendants):
            raise RuntimeError("prior owned native process tree remains alive")
        self.record_owned(True, {"reason": "recovered native shutdown confirmed"})

    def reconcile_once(self):
        """Stop exactly the retained native owner; never start ACP or consume business requests."""
        if not self.resumed:
            if self.owned_file.exists() or self.container_cid.exists():
                raise RuntimeError("runtime is absent but partial native ownership exists; quiescence is unknown")
            atomic_create(self.owned_file, framed({
                "schema": "hima-resident-engineering-owned/1", "taskId": self.task["taskId"],
                "sandbox": self.capability["sandbox"]["kind"], "quiescent": True,
                "detail": {"reason": "never-started"}, "updatedAt": now(),
            }))
            self.state("stopped", detail={"reason": "recovery", "quiescent": True, "native": "never-started"})
            return
        try:
            self.shutdown_recovered()
            owned = load_json(self.owned_file)
            if owned.get("sha256") != digest_body(owned) or owned.get("quiescent") is not True:
                raise RuntimeError("reconciled ownership fact is not signed quiescent state")
            self.state("stopped", detail={"reason": "recovery", "quiescent": True})
            state = load_json(self.task_dir / "state.json")
            if state.get("sha256") != digest_body(state) or state.get("phase") != "stopped":
                raise RuntimeError("reconciliation did not publish stopped state")
        except Exception as error:
            self.state("failed", detail={"reason": "recovery", "quiescent": False, "error": str(error)})
            raise

    def handle(self, request):
        operation = request["operation"]
        if operation == "start":
            if self.rpc is not None:
                self.receipt(request, "rejected", error="task already started")
                return
            self.launch()
            self.receipt(request, "accepted", result={"phase": "running"})
            self.run_prompt(request, initial=True)
        elif operation == "message":
            if self.rpc is None or self.session_id is None:
                self.receipt(request, "rejected", error="task has no native session")
            else:
                # Validate before acknowledging, then persist queue admission before the immutable
                # receipt. Completion is a later input event/state fact and never mutates this ack.
                self.prompt_text(request["payload"], initial=False)
                queued = framed({
                    "schema": PROTOCOL, "taskId": self.task["taskId"], "sessionId": self.session_id,
                    "requestId": request["requestId"], "requestSha256": request["sha256"],
                    "status": "queued", "queuedAt": now(),
                })
                atomic_create(self.native_dir / "messages" / f"{request['requestId']}.queued.json", queued)
                self.receipt(request, "accepted", result={"queued": True})
                self.run_prompt(request)
        elif operation == "status":
            state_path = self.task_dir / "state.json"
            self.receipt(request, "completed", result=load_json(state_path) if state_path.exists() else {"phase": "starting"})
        elif operation == "cancel":
            if self.rpc is None and self.recovered_owned is None:
                self.receipt(request, "rejected", error="task has no native session")
                return
            self.cancelled.set()
            self.state("cancelling", request["requestId"])
            try:
                if self.rpc is not None:
                    self.rpc.notify("session/cancel", {"sessionId": self.session_id})
            except Exception:
                pass
            try:
                if self.rpc is not None:
                    self.shutdown_native(graceful=False)
                else:
                    self.shutdown_recovered()
                self.state("stopped", request["requestId"], {"quiescent": True})
                self.receipt(request, "completed", result={"quiescent": True})
            except Exception as error:
                self.stop_provider_broker()
                self.state("failed", request["requestId"], {"quiescent": False, "error": str(error)})
                self.receipt(request, "unknown", error=f"native quiescence unconfirmed: {error}")
        elif operation == "delivery":
            try:
                manifest = self.collect_delivery(request)
                self.receipt(request, "completed", result={"deliverySha256": manifest["sha256"]})
            except Exception as error:
                self.receipt(request, "rejected", error=str(error))
        elif operation == "release":
            state = load_json(self.task_dir / "state.json")
            if state.get("phase") == "delivered":
                manifest = load_json(self.task_dir / "delivery" / "manifest.json")
                if request["payload"].get("deliverySha256") != manifest.get("sha256"):
                    self.receipt(request, "rejected", error="release delivery digest mismatch")
                    return
            elif state.get("phase") not in {"stopped", "failed"}:
                self.receipt(request, "rejected", error="task is not terminal")
                return
            try:
                if self.rpc is not None:
                    self.shutdown_native(graceful=True)
                else:
                    self.shutdown_recovered()
                self.state("released", request["requestId"], {"artifactsPreserved": True, "quiescent": True})
                self.receipt(request, "completed", result={"artifactsPreserved": True, "quiescent": True})
                self.stop_event.set()
            except Exception as error:
                self.stop_provider_broker()
                self.state("failed", request["requestId"], {"nativeQuiescence": "unconfirmed", "error": str(error)})
                self.receipt(request, "unknown", error=f"release cannot confirm native quiescence: {error}")
        else:
            self.receipt(request, "rejected", error=f"unsupported operation: {operation}")

    def run(self):
        if self.resumed:
            quiescence = "confirmed" if self.recovered_owned is not None and self.recovered_owned.get("quiescent") is True else "unconfirmed"
            self.state("failed", detail={"error": "wrapper restarted; unreceipted requests are unknown and are not replayed",
                                         "nativeQuiescence": quiescence})
            self.reconcile_queued_messages()
            for path in sorted((self.task_dir / "requests").glob("*.json")):
                if not (self.receipts / path.name).exists():
                    try:
                        request = self.validate_request(path)
                        self.receipt(request, "unknown", error="wrapper restarted before receipt; operation was not replayed")
                    except Exception:
                        continue
            # The pre-existing ambiguous operations stay unknown. New status/release requests are
            # safe to process; operations needing a lost native session fail closed.
            self.resumed = False
        else:
            self.state("starting")
        while not self.stop_event.is_set():
            self.handle_native()
            requests = self.task_dir / "requests"
            if requests.exists():
                for path in sorted(requests.glob("*.json")):
                    if (self.receipts / path.name).exists():
                        continue
                    if path.stem in self.inflight:
                        continue
                    try:
                        request = self.validate_request(path)
                        self.handle(request)
                    except Exception as error:
                        try:
                            request = load_json(path)
                            if isinstance(request, dict) and "requestId" in request and "sha256" in request:
                                self.receipt(request, "rejected", error=str(error))
                        except Exception:
                            pass
            time.sleep(.02)


def process_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-dir", required=True, type=Path)
    parser.add_argument("--capability", required=True, type=Path)
    parser.add_argument("--reconcile", action="store_true")
    args = parser.parse_args()
    wrapper = Wrapper(args.task_dir, args.capability, reconcile_only=args.reconcile)

    if args.reconcile:
        wrapper.reconcile_once()
        return

    def stop(_signum, _frame):
        wrapper.cancelled.set()
        had_owner = wrapper.rpc is not None or wrapper.recovered_owned is not None
        try:
            if wrapper.rpc is not None:
                wrapper.shutdown_native(graceful=False)
            elif wrapper.resumed:
                wrapper.shutdown_recovered()
        except Exception as error:
            wrapper.state("failed", detail={"reason": "signal-recovery", "quiescent": False, "error": str(error)})
        else:
            if had_owner:
                wrapper.state("stopped", detail={"reason": "signal", "signal": str(_signum), "quiescent": True})
        finally:
            wrapper.stop_provider_broker()
            wrapper.stop_event.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    wrapper.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"resident-engineering-wrapper: {error}", file=sys.stderr)
        raise SystemExit(1)
