"""One-writer MAGE round driver.

A round is: fill this Pack's Tcl templates (`open-build`, `replay-pla`,
optionally an Engineer-authored `experiment`, optionally the Pack's own
`fill-autorefine`, then `verify-all` and `export`) with the case's paths,
wrap them in a single `catch { ... } message options` block with a stage
variable (the pattern verified in
`mage_smart_conflict_resolver/product/src/mage_assist/native.py` `_PROBE`),
write the result as `<round_dir>/round.tcl`, and run `<executable> round.tcl
-noterm` once with `cwd=round_dir`. Exactly one role per Pack run —
`engineer` — may run a round whose script is `mutating()`; every other role
asking for one is refused before anything is written or executed, so a
consumer role can never become a second writer against the licensed tool.

The verified native route is the Site's own proven kit route: open and
build the Frame (no Auto-Refine disable), replay the candidate PLA, run the
three native checks `frbCheckOverlap`/`frbCheckSpace`/`frbCheckBoundary`,
and export. The driver captures the round's stdout and writes each check's
own `out/verify-<TYPE>.txt` report from the `MAGE_VERIFY_*` markers the
`verify-all` template prints — it does not trust any Tcl-side `-save`.

Completion is judged by the `MAGE_ROUND_END code 0` marker and the files,
never by the process return code alone: the Site's vendor launcher
(`bin/mage-frb`) is a bash wrapper that runs the real binary and then
unconditionally `exit 0`, so a licence-checkout failure or a mid-script
error can still return 0. `run_round` sets `result["completed"]` only when
the return code is 0, the round did not time out, and the end marker is
present in the captured stdout.

Every round, successful or not, appends one line to the session's JSONL
log (`log_path`) recording what ran and what it returned — a failed,
timed-out or incomplete round is data for the next round's decision, never
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

NATIVE_COMMANDS = {
    "OVERLAP": "frbCheckOverlap",
    "SPACE": "frbCheckSpace",
    "BOUNDARY": "frbCheckBoundary",
}

TEMPLATE_FILES = (
    "open-build.tcl", "replay-pla.tcl", "fill-autorefine.tcl", "verify-all.tcl", "export.tcl",
)

MUTATING_MARKERS = (
    "source ", "-addInstFit", "-addInstFix", "-addGroup", "frbMove", "frbOps",
    "frbAlign", "frbGuidedMove", "-placeDropInstFit", "-refine", "-autoRefine",
    "-setAutoRefine -arEnabled 1",
)

ENGINEER_ROLE = "engineer"

END_MARKER = "MAGE_ROUND_END code 0"

# A native check's own `-print` summary line, e.g. `0 overlapped instance(s)`
# or `3 spacing overlapped instance(s)`: the leading integer is MAGE's own
# instance count for that check.
_INSTANCE_RE = re.compile(r"^(\d+) .* instance\(s\)$")

# Word-boundary guards so `experiment.tcl` content that *contains* a forbidden
# word only as a substring of a longer identifier is not falsely refused.
_EXPERIMENT_FORBIDDEN = (re.compile(r"\bexit\b"), re.compile(r"\bfrbOpen\b"))


def mutating(script_text):
    """True when `script_text` contains any marker that changes placement state."""
    return any(marker in script_text for marker in MUTATING_MARKERS)


def slice_verify(stdout_text):
    """Parse the `MAGE_VERIFY_*` markers in one round's stdout.

    Returns `{TYPE: {"code": int|None, "instances": int|None, "lines": [str]}}`
    for every `MAGE_VERIFY_BEGIN <TYPE>` block. `lines` are the raw command
    output lines between the BEGIN marker and that type's `MAGE_VERIFY_CODE`
    line (the check's own `-print` output); `code` is the integer from the
    `MAGE_VERIFY_CODE <TYPE> <0|1>` line; `instances` is the leading integer
    of the first `lines` entry matching `<N> ... instance(s)`.
    """
    blocks = {}
    current = None
    for raw_line in stdout_text.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("MAGE_VERIFY_BEGIN "):
            current = stripped[len("MAGE_VERIFY_BEGIN "):].strip()
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

    for block in blocks.values():
        for line in block["lines"]:
            match = _INSTANCE_RE.match(line.strip())
            if match:
                block["instances"] = int(match.group(1))
                break
    return blocks


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


def _converge_lines(auto_refine_converge):
    """The `@CONVERGE@` substitution for `fill-autorefine.tcl`.

    Two `smPFlow -setAutoRefineSimpleConverge` lines (VERT then HORZ) when
    the case manifest names `autoRefineConverge {VERT, HORZ}`, otherwise a
    single comment line. The substituted text never contains an `@NAME@`
    token, so `tcl.fill` accepts it under the `{"CONVERGE": ...}` mapping.
    """
    if not auto_refine_converge:
        return "# no autoRefineConverge in the case manifest"
    vert = int(auto_refine_converge["VERT"])
    horz = int(auto_refine_converge["HORZ"])
    return "\n".join([
        f"smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum {vert}",
        f"smPFlow -setAutoRefineSimpleConverge -arSLType HORZ -arConvergeNum {horz}",
    ])


class MageSession:
    """Drives one Site's MAGE binary, one round at a time."""

    def __init__(self, executable, env, workdir, log_path, templates_dir, case):
        self.executable = executable
        self.env = env
        self.workdir = workdir
        self.log_path = log_path
        self.templates_dir = templates_dir
        self.case = case

    def _read_template(self, name):
        return (Path(self.templates_dir) / name).read_text(encoding="utf-8")

    def _resolve_round_dir(self, round_dir):
        path = Path(round_dir)
        if not path.is_absolute() and self.workdir:
            path = Path(self.workdir) / path
        return path

    def _build_script(self, candidate_pla, out_dir, fill, experiment_path):
        frb_path = self.case["frb"]
        open_build = tcl.fill(self._read_template("open-build.tcl"), {"FRB": _unbraced(frb_path)})
        replay = tcl.fill(self._read_template("replay-pla.tcl"), {"PLA": _unbraced(candidate_pla)})
        out_value = _unbraced(str(out_dir))
        verify = tcl.fill(self._read_template("verify-all.tcl"), {})
        export = tcl.fill(self._read_template("export.tcl"), {"OUT": out_value})

        stages = [
            'set mage_round_stage "open-build"',
            open_build.rstrip("\n"),
            'set mage_round_stage "replay-pla"',
            replay.rstrip("\n"),
        ]
        if experiment_path is not None:
            stages.append('set mage_round_stage "experiment"')
            stages.append("source " + tcl.quote(str(experiment_path)))
        if fill:
            converge = _converge_lines(self.case.get("autoRefineConverge"))
            fill_text = tcl.fill(self._read_template("fill-autorefine.tcl"), {"CONVERGE": converge})
            stages.append('set mage_round_stage "fill"')
            stages.append(fill_text.rstrip("\n"))
        stages.extend([
            'set mage_round_stage "verify-all"',
            verify.rstrip("\n"),
            'set mage_round_stage "export"',
            export.rstrip("\n"),
        ])
        body = "\n".join(stages)
        return (
            "set mage_round_code [catch {\n"
            + body
            + "\n} mage_round_message mage_round_options]\n"
            "if {$mage_round_code} {\n"
            "    puts stderr [list MAGE_ROUND_ERROR stage $mage_round_stage message $mage_round_message]\n"
            "    exit 2\n"
            "}\n"
            "exit 0\n"
        )

    def _append_log(self, entry):
        log_path = Path(self.log_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")

    def run_round(self, round_dir, candidate_pla, role, timeout_s=1800, fill=False, experiment_tcl=None):
        """Run one MAGE round and return its export/verify/log summary.

        `fill=True` appends this Pack's `fill-autorefine` stage after the
        replay (and after any experiment). `experiment_tcl`, when given, is
        a path to an Engineer-authored Tcl file sourced after the replay;
        its bytes are copied verbatim to `round_dir/experiment.tcl` and its
        sha256 recorded in the result, round log and (via `candidate`) the
        delivery. An experiment containing the word `exit` or `frbOpen` is
        refused with `core.MageError("experiment", ...)` before `round_dir`
        is created.

        Refuses with `core.MageError("writer", ...)` when `role` is not
        `"engineer"` but the assembled round script is `mutating()` —
        checked before anything is written or executed, so a refused role
        leaves no trace. Refuses with `core.MageError("round-exists", ...)`
        when `round_dir` already contains a `round.tcl` from an earlier
        round.
        """
        round_dir = self._resolve_round_dir(round_dir)
        round_tcl_path = round_dir / "round.tcl"
        if round_tcl_path.exists():
            raise core.MageError("round-exists", f"{round_tcl_path} already has a round.tcl")

        experiment_dest = round_dir / "experiment.tcl" if experiment_tcl is not None else None
        experiment_bytes = None
        if experiment_tcl is not None:
            experiment_bytes = Path(experiment_tcl).read_bytes()
            experiment_text = experiment_bytes.decode("utf-8", errors="replace")
            for pattern in _EXPERIMENT_FORBIDDEN:
                if pattern.search(experiment_text):
                    raise core.MageError(
                        "experiment",
                        f"experiment Tcl contains forbidden command {pattern.pattern!r}",
                    )

        out_dir = round_dir / "out"
        script = self._build_script(candidate_pla, out_dir, fill, experiment_dest)
        is_mutating = mutating(script)
        if role != ENGINEER_ROLE and is_mutating:
            raise core.MageError("writer", f"role {role!r} may not run a mutating MAGE round")

        round_dir.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        experiment_sha256 = None
        if experiment_bytes is not None:
            experiment_dest.write_bytes(experiment_bytes)
            experiment_sha256 = core.file_sha256(experiment_dest)
        round_tcl_path.write_text(script, encoding="utf-8")
        script_sha256 = core.file_sha256(round_tcl_path)

        stdout_path = out_dir / "stdout.log"
        stderr_path = out_dir / "stderr.log"
        executable_prefix = self.executable if isinstance(self.executable, list) else [self.executable]
        argv = list(executable_prefix) + [str(round_tcl_path), "-noterm"]

        started_at = _iso_now()
        timed_out = False
        with open(stdout_path, "wb") as out_handle, open(stderr_path, "wb") as err_handle:
            process = subprocess.Popen(
                argv, cwd=str(round_dir), env=self.env,
                stdout=out_handle, stderr=err_handle, start_new_session=True,
            )
            try:
                returncode = process.wait(timeout=timeout_s)
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError):
                    process.kill()
                process.wait()
                returncode = -9
        ended_at = _iso_now()

        stdout_text = stdout_path.read_text(encoding="utf-8") if stdout_path.exists() else ""
        end_marker_present = any(line.strip() == END_MARKER for line in stdout_text.splitlines())
        completed = (returncode == 0) and (not timed_out) and end_marker_present

        verify_files = write_verify_files(stdout_path, out_dir)

        def _existing(path):
            return str(path) if path.exists() else None

        result = {
            "exportPla": _existing(out_dir / "export.pla"),
            "verifyFiles": verify_files,
            "summary": _existing(out_dir / "summary.txt"),
            "stdout": str(stdout_path),
            "returncode": returncode,
            "scriptSha256": script_sha256,
            "timedOut": timed_out,
            "completed": completed,
            "fill": bool(fill),
            "experimentTcl": str(experiment_dest) if experiment_dest is not None else None,
            "experimentSha256": experiment_sha256,
        }

        self._append_log({
            "roundDir": str(round_dir),
            "role": role,
            "scriptSha256": script_sha256,
            "mutating": is_mutating,
            "returncode": returncode,
            "timedOut": timed_out,
            "completed": completed,
            "fill": bool(fill),
            "experimentSha256": experiment_sha256,
            "startedAt": started_at,
            "endedAt": ended_at,
        })

        return result
