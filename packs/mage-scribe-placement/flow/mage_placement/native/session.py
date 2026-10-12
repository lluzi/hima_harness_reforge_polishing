"""One-writer MAGE round driver.

A round is: fill the four Tcl templates (`open-build`, `replay-pla`,
`verify-all`, `export`) with the case's paths, wrap them in a single
`catch { ... } message options` block with a stage variable (the pattern
verified in `mage_smart_conflict_resolver/product/src/mage_assist/native.py`
`_PROBE`), write the result as `<round_dir>/round.tcl`, and run
`<executable> round.tcl -noterm` once with `cwd=round_dir`. Exactly one role
per Pack run — `engineer` — may run a round whose script is `mutating()`;
every other role asking for one is refused before anything is written or
executed, so a consumer role can never become a second writer against the
licensed tool.

Every round, successful or not, appends one line to the session's JSONL
log (`log_path`) recording what ran and what it returned — a failed or
timed-out round is data for the next round's decision, never swallowed.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .. import core
from . import tcl


TEMPLATE_FILES = ("open-build.tcl", "replay-pla.tcl", "verify-all.tcl", "export.tcl")

NATIVE_TYPES = (
    "OVERLAP", "SPACE", "BOUNDARY", "CROSS", "OFFGRID",
    "DIECORNER", "PEPPER", "PADS", "LOCATION", "AUTOREFINE",
)

MUTATING_MARKERS = (
    "source ", "-addInstFit", "-addInstFix", "-addGroup", "frbMove", "frbOps",
    "frbAlign", "frbGuidedMove", "-placeDropInstFit", "-refine", "-autoRefine",
    "-setAutoRefine -arEnabled 1",
)

ENGINEER_ROLE = "engineer"


def mutating(script_text):
    """True when `script_text` contains any marker that changes placement state."""
    return any(marker in script_text for marker in MUTATING_MARKERS)


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def _unbraced(value):
    """`tcl.quote(value)` with its outer braces stripped (the templates supply their own)."""
    return tcl.quote(value)[1:-1]


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

    def _build_script(self, candidate_pla, out_dir):
        frb_path = self.case["frb"]
        open_build = tcl.fill(self._read_template("open-build.tcl"), {"FRB": _unbraced(frb_path)})
        replay = tcl.fill(self._read_template("replay-pla.tcl"), {"PLA": _unbraced(candidate_pla)})
        out_value = _unbraced(str(out_dir))
        verify = tcl.fill(self._read_template("verify-all.tcl"), {"OUT": out_value})
        export = tcl.fill(self._read_template("export.tcl"), {"OUT": out_value})
        body = "\n".join([
            'set mage_round_stage "open-build"',
            open_build.rstrip("\n"),
            'set mage_round_stage "replay-pla"',
            replay.rstrip("\n"),
            'set mage_round_stage "verify-all"',
            verify.rstrip("\n"),
            'set mage_round_stage "export"',
            export.rstrip("\n"),
        ])
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

    def run_round(self, round_dir, candidate_pla, role, timeout_s=1800):
        """Run one MAGE round and return its export/verify/log summary.

        Refuses with `core.MageError("writer", ...)` when `role` is not
        `"engineer"` but the assembled round script is `mutating()` —
        checked before `round_dir` is created or anything is written or
        executed, so a refused role leaves no trace.

        Refuses with `core.MageError("round-exists", ...)` when
        `round_dir` already contains a `round.tcl` from an earlier round.
        """
        round_dir = self._resolve_round_dir(round_dir)
        round_tcl_path = round_dir / "round.tcl"
        if round_tcl_path.exists():
            raise core.MageError("round-exists", f"{round_tcl_path} already has a round.tcl")

        out_dir = round_dir / "out"
        script = self._build_script(candidate_pla, out_dir)
        is_mutating = mutating(script)
        if role != ENGINEER_ROLE and is_mutating:
            raise core.MageError("writer", f"role {role!r} may not run a mutating MAGE round")

        round_dir.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)
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

        def _existing(path):
            return str(path) if path.exists() else None

        verify_files = {}
        for type_name in NATIVE_TYPES:
            candidate_path = out_dir / f"verify-{type_name}.txt"
            if candidate_path.exists():
                verify_files[type_name] = str(candidate_path)

        result = {
            "exportPla": _existing(out_dir / "export.pla"),
            "exportDbuPla": _existing(out_dir / "export-dbu.pla"),
            "verifyFiles": verify_files,
            "summary": _existing(out_dir / "summary.txt"),
            "stdout": str(stdout_path),
            "returncode": returncode,
            "scriptSha256": script_sha256,
            "timedOut": timed_out,
        }

        self._append_log({
            "roundDir": str(round_dir),
            "role": role,
            "scriptSha256": script_sha256,
            "mutating": is_mutating,
            "returncode": returncode,
            "timedOut": timed_out,
            "startedAt": started_at,
            "endedAt": ended_at,
        })

        return result
