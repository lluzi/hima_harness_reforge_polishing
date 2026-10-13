"""One agent-authored MAGE stage driver.

A stage is one call to `MageSession.run_stage`: the resident Engineer
authors a Tcl "stage script", and this driver wraps it between the
Pack-owned `prelude.tcl` and `epilogue.tcl` (filled with the case's paths),
inside a single `catch { ... } message options` block with a boundary
variable, writes the result as `<stage_dir>/stage.tcl`, and runs
`<executable> stage.tcl -noterm` once with `cwd=stage_dir`.

The prelude is the only way a stage may open the case (`hima_open_build`),
take a boundary snapshot (`hima_snapshot`), or run the three native checks
mid-script (`hima_check`); the epilogue is the only final native check,
export and completion marker. Before anything is written, the agent's own
text runs a refusal gate (`FORBIDDEN_PATTERNS`): a stage that tries to
`exit`, call `frbOpen`, redefine the `hima_*` procs, forge a `MAGE_*`
marker, or re-emit a `hima:` fence is refused with
`core.MageError("experiment", ...)` and leaves no trace. Exactly one role
— `engineer` — may run a stage; every other role is refused with
`core.MageError("writer", ...)` before any write.

Completion is judged by the `MAGE_ROUND_END code 0` marker in the captured
stdout, never by the process return code alone: the Site's vendor launcher
(`bin/mage-frb`) is a bash wrapper that runs the real binary and then
unconditionally `exit 0`, so a licence-checkout failure or a mid-script
error can still return 0. `run_stage` sets `result["completed"]` only when
the return code is 0, the stage did not time out, and the end marker is
present in the captured stdout.

Every stage, successful or not, appends one line to the session's JSONL
log (`log_path`) recording what ran and what it returned — a failed,
timed-out or incomplete stage is data for the next stage's decision, never
swallowed.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .. import core
from . import tcl


NATIVE_TYPES = ("OVERLAP", "SPACE", "BOUNDARY")
NATIVE_COMMANDS = {"OVERLAP": "frbCheckOverlap", "SPACE": "frbCheckSpace", "BOUNDARY": "frbCheckBoundary"}
ENGINEER_ROLE = "engineer"
END_MARKER = "MAGE_ROUND_END code 0"
AGENT_BEGIN = "# hima:agent-begin"
AGENT_END = "# hima:agent-end"
FORBIDDEN_PATTERNS = tuple(re.compile(p) for p in (
    r"\bexit\b", r"\bfrbOpen\b", r"MAGE_VERIFY", r"MAGE_ROUND_END", r"MAGE_SNAPSHOT",
    r"MAGE_STAGE_ERROR", r"MAGE_CHECK", r"hima:(prelude|agent)-(begin|end)",
    # Finding 4: redefining or aliasing any Pack-owned proc, or a check/marker
    # command, slips the boundary trace and the native-count binding. `rename`
    # and `interp alias` are refused outright (they can rebind puts/flush/catch
    # or a hima_* proc without the word `proc`); the `proc` pattern refuses a
    # (brace/quote-wrapped, optionally `::`-qualified) redefinition of any
    # hima_*, frbCheck*, smPInstMgr, smPFlow, puts, flush or catch command.
    r"\brename\b", r"\binterp\s+alias\b",
    r'\bproc\s+[{"]?(::)*(hima_|frbCheck|smPInstMgr|smPFlow|puts\b|flush\b|catch\b)',
))
_PRELUDE = Path(__file__).resolve().parent / "prelude.tcl"
_EPILOGUE = Path(__file__).resolve().parent / "epilogue.tcl"
_SNAPSHOT_RE = re.compile(r"^MAGE_SNAPSHOT (\d+) (\S+)$")
_STAGE_ERROR_RE = re.compile(r"^MAGE_STAGE_ERROR boundary (\S+) message (.*)$")
MIN_TIMEOUT_S, MAX_TIMEOUT_S = 60, 14400

# A native check's own `-print` summary line, e.g. `0 overlapped instance(s)`
# or `3 spacing overlapped instance(s)`: the leading integer is MAGE's own
# instance count for that check.
_INSTANCE_RE = re.compile(r"^(\d+) .* instance\(s\)$")


def refuse_forbidden(script_text):
    for pattern in FORBIDDEN_PATTERNS:
        if pattern.search(script_text):
            raise core.MageError("experiment", f"stage script contains forbidden text {pattern.pattern!r}")


def refuse_unbalanced_braces(script_text):
    """Finding 6: refuse a stage whose `{`/`}` do not balance.

    An unbalanced agent script would otherwise be wrapped verbatim inside the
    driver's own `catch { ... }` block, so a stray brace in agent text would
    swallow or truncate the epilogue (or never close the catch), corrupting
    the assembled `stage.tcl` rather than failing the agent's own script. The
    count ignores full-line `#` comments and backslash-escaped braces (`\\{`,
    `\\}`), so the playbook's brace-escaped `regexp` patterns are not flagged.
    """
    depth = 0
    for line in script_text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        i = 0
        while i < len(line):
            char = line[i]
            if char == "\\":
                i += 2
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            i += 1
    if depth != 0:
        raise core.MageError("experiment", f"stage script has unbalanced braces (depth {depth})")


def slice_verify(stdout_text):
    """Parse the `MAGE_VERIFY_*` markers in one stage's stdout.

    Returns `{TYPE: {"code": int|None, "instances": int|None, "lines": [str]}}`
    for every `MAGE_VERIFY_BEGIN <TYPE>` block. `lines` are the raw command
    output lines between the BEGIN marker and that type's `MAGE_VERIFY_CODE`
    line (the check's own `-print` output); `code` is the integer from the
    `MAGE_VERIFY_CODE <TYPE> <0|1>` line; `instances` is the leading integer
    of the first `lines` entry matching `<N> ... instance(s)`.
    """
    blocks = {}
    begin_count = {}
    current = None
    for raw_line in stdout_text.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("MAGE_VERIFY_BEGIN "):
            current = stripped[len("MAGE_VERIFY_BEGIN "):].strip()
            begin_count[current] = begin_count.get(current, 0) + 1
            blocks.setdefault(current, {"code": None, "instances": None, "lines": []})
        elif stripped.startswith("MAGE_VERIFY_CODE "):
            parts = stripped[len("MAGE_VERIFY_CODE "):].split()
            if len(parts) >= 2 and parts[0] in blocks:
                try:
                    blocks[parts[0]]["code"] = int(parts[1])
                except ValueError:
                    blocks[parts[0]]["code"] = None
        elif stripped.startswith("MAGE_VERIFY_END "):
            current = None
        elif current is not None and current in blocks:
            blocks[current]["lines"].append(raw_line)

    for type_name, block in blocks.items():
        if begin_count.get(type_name, 0) > 1:
            # I1: a type whose BEGIN marker appears more than once is
            # refused as unknown -- an experiment (or any earlier stage)
            # that printed a second fake `MAGE_VERIFY_BEGIN <TYPE>` block
            # must never let a planted count override MAGE's real one. The
            # type reads unknown (no verify file written), never the first
            # or a fabricated count.
            block["code"] = None
            block["instances"] = None
            block["duplicate"] = True
            continue
        for line in block["lines"]:
            match = _INSTANCE_RE.match(line.strip())
            if match:
                block["instances"] = int(match.group(1))
                break
    return blocks


def slice_checks(stdout_text):
    """`{str(snap_index): {TYPE: {"code", "instances"}}}` from the prelude's MAGE_CHECK_* blocks."""
    blocks, current = {}, None
    for raw in stdout_text.splitlines():
        s = raw.strip()
        if s.startswith("MAGE_CHECK_BEGIN "):
            if len(s.split()) != 3:   # T4 (finding 12): a malformed BEGIN line is ignored, never unpacked
                continue
            _, idx, t = s.split(" ", 2); current = (idx, t)
            blocks.setdefault(idx, {})[t] = {"code": None, "instances": None, "lines": []}
        elif s.startswith("MAGE_CHECK_CODE "):
            parts = s.split()
            if len(parts) == 4 and parts[1] in blocks and parts[2] in blocks[parts[1]]:
                blocks[parts[1]][parts[2]]["code"] = int(parts[3]) if parts[3].isdigit() else None
        elif s.startswith("MAGE_CHECK_END "):
            current = None
        elif current is not None:
            blocks[current[0]][current[1]]["lines"].append(raw)
    for idx in blocks:
        for t, block in blocks[idx].items():
            for line in block["lines"]:
                m = _INSTANCE_RE.match(line.strip())
                if m:
                    block["instances"] = int(m.group(1)); break
            del block["lines"]
    return blocks


def snapshots_from_stdout(stdout_text, out_dir):
    found = []
    for raw in stdout_text.splitlines():
        m = _SNAPSHOT_RE.match(raw.strip())
        if not m:
            continue
        index, name = int(m.group(1)), m.group(2)
        d = Path(out_dir) / ("snap-%02d-%s" % (index, name))
        if (d / "placement.pla").is_file():
            found.append({"index": index, "name": name, "pla": str(d / "placement.pla"),
                          "summary": str(d / "summary.txt") if (d / "summary.txt").is_file() else None})
    return found


def write_verify_files(stdout_path, out_dir):
    """Write each native check's `out/verify-<TYPE>.txt` from captured stdout.

    Only a check whose `code == 0` and whose instance count was found is
    written; a failed catch or a missing count leaves no file (so the fact
    stays unknown downstream, never a bare `0`). Each file's first line is
    the canonical header `# mage-verify/1 type=<T> command=<cmd>
    instances=<N>`, followed by the check's own raw output lines.
    """
    out_dir = Path(out_dir)
    text = Path(stdout_path).read_text(encoding="utf-8") if Path(stdout_path).exists() else ""
    blocks = slice_verify(text)
    written = {}
    for type_name in NATIVE_TYPES:
        block = blocks.get(type_name)
        if block is None or block["code"] != 0 or block["instances"] is None:
            continue
        header = (
            f"# mage-verify/1 type={type_name} command={NATIVE_COMMANDS[type_name]} "
            f"instances={block['instances']}"
        )
        body = "\n".join(block["lines"])
        content = header + "\n" + (body + "\n" if body else "")
        target = out_dir / f"verify-{type_name}.txt"
        target.write_text(content, encoding="utf-8")
        written[type_name] = str(target)
    return written


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def _unbraced(value):
    """`tcl.quote(value)` with its outer braces stripped (the templates supply their own)."""
    return tcl.quote(value)[1:-1]


class MageSession:
    """Drives one Site's MAGE binary, one agent-authored stage at a time."""

    def __init__(self, executable, env, workdir, log_path, case):
        self.executable, self.env, self.workdir, self.log_path, self.case = executable, env, workdir, log_path, case

    def _resolve(self, path):
        p = Path(path)
        return p if p.is_absolute() or not self.workdir else Path(self.workdir) / p

    def _assemble(self, agent_text, out_dir):
        prelude = tcl.fill(_PRELUDE.read_text(encoding="utf-8"), {
            "FRB": _unbraced(self.case["frb"]), "CASE_DIR": _unbraced(self.case["caseDir"]),
            "START_PLA": _unbraced(self.case["startPla"]), "OUT": _unbraced(str(out_dir)),
        })
        epilogue = tcl.fill(_EPILOGUE.read_text(encoding="utf-8"), {"OUT": _unbraced(str(out_dir))})
        body = "\n".join([prelude.rstrip("\n"), AGENT_BEGIN, agent_text.rstrip("\n"), AGENT_END,
                          'set hima_stage_boundary "epilogue"', epilogue.rstrip("\n")])
        return ("set mage_stage_code [catch {\n" + body + "\n} mage_stage_message mage_stage_options]\n"
                "if {$mage_stage_code} {\n"
                "    puts stderr [list MAGE_STAGE_ERROR boundary $hima_stage_boundary message $mage_stage_message]\n"
                "    exit 2\n}\nexit 0\n")

    def _append_log(self, entry):
        Path(self.log_path).parent.mkdir(parents=True, exist_ok=True)
        with open(self.log_path, "a", encoding="utf-8") as h:
            h.write(json.dumps(entry, sort_keys=True) + "\n")

    def run_stage(self, stage_dir, script_path, role, timeout_s=1800):
        if not (MIN_TIMEOUT_S <= int(timeout_s) <= MAX_TIMEOUT_S):
            raise core.MageError("timeout", f"timeout_s must be within {MIN_TIMEOUT_S}..{MAX_TIMEOUT_S}")
        stage_dir = self._resolve(stage_dir)
        if (stage_dir / "stage.tcl").exists():
            raise core.MageError("stage-exists", f"{stage_dir} already holds a stage.tcl")
        agent_bytes = Path(script_path).read_bytes()
        agent_text = agent_bytes.decode("utf-8", errors="replace")
        refuse_forbidden(agent_text)
        refuse_unbalanced_braces(agent_text)
        if role != ENGINEER_ROLE:
            raise core.MageError("writer", f"role {role!r} may not run a MAGE stage")

        out_dir = stage_dir / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        script_copy = stage_dir / "script.tcl"; script_copy.write_bytes(agent_bytes)
        stage_tcl = stage_dir / "stage.tcl"; stage_tcl.write_text(self._assemble(agent_text, out_dir), encoding="utf-8")
        script_sha, stage_sha = core.file_sha256(script_copy), core.file_sha256(stage_tcl)

        stdout_path, stderr_path = out_dir / "stdout.log", out_dir / "stderr.log"
        prefix = self.executable if isinstance(self.executable, list) else [self.executable]
        started = _iso_now(); timed_out = False
        with open(stdout_path, "wb") as o, open(stderr_path, "wb") as e:
            proc = subprocess.Popen(list(prefix) + [str(stage_tcl), "-noterm"], cwd=str(stage_dir), env=self.env,
                                    stdin=subprocess.DEVNULL, stdout=o, stderr=e, start_new_session=True)
            try:
                rc = proc.wait(timeout=int(timeout_s))
            except subprocess.TimeoutExpired:
                timed_out = True
                try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError): proc.kill()
                proc.wait(); rc = -9
        ended = _iso_now()

        stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
        stderr_text = stderr_path.read_text(encoding="utf-8", errors="replace")
        completed = rc == 0 and not timed_out and any(l.strip() == END_MARKER for l in stdout_text.splitlines())
        stage_error, last_boundary = None, None
        for line in stderr_text.splitlines():
            m = _STAGE_ERROR_RE.match(line.strip())
            if m:
                stage_error, last_boundary = line.strip(), m.group(1); break
        snapshots = snapshots_from_stdout(stdout_text, out_dir)
        for s in snapshots:
            s["sha256"] = core.file_sha256(s["pla"])
        if last_boundary is None and snapshots:
            last_boundary = snapshots[-1]["name"]
        if timed_out and stage_error is None:
            stage_error = f"timeout after {int(timeout_s)} s"
        verify_files = write_verify_files(stdout_path, out_dir)
        export = out_dir / "export.pla"
        result = {
            "stageDir": str(stage_dir), "scriptTcl": str(script_copy), "scriptSha256": script_sha,
            "stageTcl": str(stage_tcl), "stageSha256": stage_sha, "returncode": rc, "timedOut": timed_out,
            "completed": completed, "lastBoundary": last_boundary, "stageError": stage_error,
            "exportPla": str(export) if export.is_file() else None,
            "exportSha256": core.file_sha256(export) if export.is_file() else None,
            "summary": str(out_dir / "summary.txt") if (out_dir / "summary.txt").is_file() else None,
            "stdout": str(stdout_path), "stdoutSha256": core.file_sha256(stdout_path),
            "verifyFiles": verify_files, "snapshots": snapshots, "checks": slice_checks(stdout_text),
            "startedAt": started, "endedAt": ended,
        }
        self._append_log({"stageDir": str(stage_dir), "role": role, "scriptSha256": script_sha, "stageSha256": stage_sha,
                          "mutating": True, "returncode": rc, "timedOut": timed_out, "completed": completed,
                          "exportSha256": result["exportSha256"], "stdoutSha256": result["stdoutSha256"],
                          "startedAt": started, "endedAt": ended})
        return result
