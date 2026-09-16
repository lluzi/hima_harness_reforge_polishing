#!/usr/bin/env python3
"""Deterministic, provenance-bound Yosys/ABC technology-mapping adapter.

This module deliberately stops at mapper evidence.  It records how one fixed
Yosys/ABC profile implements the same RTL with a reference and an augmented
Library; it does not predict timing or post-route Fmax.

The public seam is :func:`map_reference_and_augmented`.  Callers provide one
JSON-compatible request and receive one JSON-compatible result.  Validation,
tool identity, script construction, execution, artifact hashing, Cell census,
and structured failure all remain behind that interface.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence


SCHEMA = "lfr-proxy-mapping/1"
RESULT_SCHEMA = "lfr-proxy-mapping-result/1"
PROFILE = "lfr-yosys-abc-deterministic/1"
_SIMPLE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
_SDC_COMMAND = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\b")


class RequestError(ValueError):
    """A request cannot be executed without guessing or losing provenance."""


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _require_mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RequestError(f"{name} must be an object")
    return value


def _require_string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RequestError(f"{name} must be a non-empty string")
    return value


def _path(value: object, name: str, *, executable: bool = False) -> Path:
    text = _require_string(value, name)
    if any(character in text for character in ("\x00", "\n", "\r", "{" , "}")):
        raise RequestError(f"{name} contains characters unsafe for a Yosys script")
    path = Path(text).expanduser().resolve()
    if not path.is_file():
        raise RequestError(f"{name} does not name a regular file: {path}")
    if executable and not os.access(path, os.X_OK):
        raise RequestError(f"{name} is not executable: {path}")
    return path


def _string_list(value: object, name: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise RequestError(f"{name} must be a non-empty array")
    return [_require_string(item, f"{name}[{index}]") for index, item in enumerate(value)]


def _number(value: object, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RequestError(f"{name} must be a number")
    result = float(value)
    if not (result == result and abs(result) != float("inf")):
        raise RequestError(f"{name} must be finite")
    if positive and result <= 0:
        raise RequestError(f"{name} must be greater than zero")
    return result


def _tool(tool: object, name: str) -> dict[str, object]:
    source = _require_mapping(tool, f"tools.{name}")
    path = _path(source.get("path"), f"tools.{name}.path", executable=True)
    expected = _require_string(source.get("sha256"), f"tools.{name}.sha256").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise RequestError(f"tools.{name}.sha256 must be a lowercase SHA-256 digest")
    actual = _sha256_file(path)
    if actual != expected:
        raise RequestError(
            f"tools.{name} hash mismatch: expected {expected}, observed {actual}"
        )
    return {
        "path": str(path),
        "sha256": actual,
        "commit": _require_string(source.get("commit"), f"tools.{name}.commit"),
        "build_flags": _string_list(source.get("build_flags"), f"tools.{name}.build_flags"),
    }


def _library_arm(value: object, name: str) -> dict[str, object]:
    source = _require_mapping(value, f"libraries.{name}")
    mapping = _path(source.get("mapping"), f"libraries.{name}.mapping")
    support_values = source.get("support", [])
    if not isinstance(support_values, list):
        raise RequestError(f"libraries.{name}.support must be an array")
    support = [_path(item, f"libraries.{name}.support[{index}]") for index, item in enumerate(support_values)]
    all_paths = [mapping, *support]
    if len(set(all_paths)) != len(all_paths):
        raise RequestError(f"libraries.{name} repeats a Liberty file")
    variants = source.get("drive_variants", {})
    if not isinstance(variants, Mapping) or any(
        not isinstance(cell, str) or not isinstance(drive, str) or not drive
        for cell, drive in variants.items()
    ):
        raise RequestError(f"libraries.{name}.drive_variants must map Cell names to strings")
    try:
        directory = str(Path(__file__).resolve().parent)
        if directory not in sys.path:
            sys.path.insert(0, directory)
        from cell_need_miner.liberty import parse_skeleton  # type: ignore
        cells = parse_skeleton(mapping)
    except (OSError, ValueError, TypeError) as error:
        raise RequestError(f"libraries.{name}.mapping cannot be parsed: {error}") from error
    buffers = sorted(
        cell_name for cell_name, cell in cells.items()
        if (not cell.is_seq and len(cell.inputs) == 1 and len(cell.outputs) == 1
            and next(iter(cell.outputs.values())) == ("var", cell.inputs[0]))
    )
    if not buffers:
        raise RequestError(
            f"libraries.{name}.mapping has no one-input non-inverting buffer; "
            "ABC requires a baseline buffer"
        )
    return {
        "mapping": mapping,
        "support": support,
        "files": [
            {"path": str(path), "sha256": _sha256_file(path)} for path in all_paths
        ],
        "drive_variants": dict(sorted(variants.items())),
        "baseline_buffers": buffers,
    }


def _sdc_statements(path: Path) -> list[tuple[int, str]]:
    statements: list[tuple[int, str]] = []
    pending = ""
    start_line = 0
    for number, raw in enumerate(path.read_text(errors="replace").splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not pending:
            start_line = number
        continued = stripped.endswith("\\")
        pending += stripped[:-1].rstrip() + " " if continued else stripped
        if not continued:
            statements.append((start_line, pending.strip()))
            pending = ""
    if pending:
        statements.append((start_line, pending.strip()))
    return statements


def _constraint_summary(source: Mapping[str, Any]) -> dict[str, object]:
    delay = _number(source.get("delay_target_ps"), "constraints.delay_target_ps", positive=True)
    load = _number(source.get("output_load"), "constraints.output_load", positive=True)
    driver = _require_string(source.get("driving_cell"), "constraints.driving_cell")
    if not _SIMPLE_IDENTIFIER.fullmatch(driver):
        raise RequestError("constraints.driving_cell must be a simple Liberty Cell name")
    raw_sdc = source.get("sdc_files", [])
    if not isinstance(raw_sdc, list):
        raise RequestError("constraints.sdc_files must be an array")
    sdc_files = [_path(item, f"constraints.sdc_files[{index}]") for index, item in enumerate(raw_sdc)]
    unsupported: list[dict[str, object]] = []
    observed: list[dict[str, object]] = []
    for path in sdc_files:
        for line, statement in _sdc_statements(path):
            match = _SDC_COMMAND.match(statement)
            command = match.group(1) if match else "unparsed"
            item = {"path": str(path), "line": line, "command": command, "text": statement}
            represented = False
            reason = "the proxy does not model this SDC command"
            if command == "set_load":
                value = re.match(r"^\s*set_load\s+([-+0-9.eE]+)\b", statement)
                if value:
                    try:
                        represented = math.isclose(float(value.group(1)), load, rel_tol=0.0, abs_tol=1e-12)
                        reason = "SDC load disagrees with constraints.output_load"
                    except ValueError:
                        represented = False
                        reason = "SDC load is not numeric"
                else:
                    reason = "set_load syntax is not represented by the proxy"
            elif command == "set_driving_cell":
                value = re.match(
                    r"^\s*(?:-lib_cell\s+)?([A-Za-z_][A-Za-z0-9_$]*)\b",
                    statement[len("set_driving_cell"):],
                )
                if value:
                    represented = value.group(1) == driver
                    reason = "SDC driving Cell disagrees with constraints.driving_cell"
                else:
                    reason = "set_driving_cell syntax is not represented by the proxy"
            elif command == "create_clock":
                reason = (
                    "clock period is recorded but is not silently equated to the independent "
                    "ABC delay target"
                )
            if represented:
                observed.append(item)
            else:
                unsupported.append({**item, "reason": reason})
    return {
        "delay_target_ps": delay,
        "output_load": load,
        "driving_cell": driver,
        "sdc_files": [{"path": str(path), "sha256": _sha256_file(path)} for path in sdc_files],
        "represented_sdc": observed,
        "unsupported_constraints": unsupported,
        "sdc_coverage_complete": not unsupported,
    }


def _validated_request(request: Mapping[str, object]) -> dict[str, object]:
    if request.get("schema") != SCHEMA:
        raise RequestError(f"schema must be {SCHEMA!r}")
    top = _require_string(request.get("top"), "top")
    if not _SIMPLE_IDENTIFIER.fullmatch(top):
        raise RequestError("top must be a simple Verilog identifier")
    rtl = [_path(item, f"rtl_files[{index}]") for index, item in enumerate(_string_list(request.get("rtl_files"), "rtl_files"))]
    if len(set(rtl)) != len(rtl):
        raise RequestError("rtl_files contains duplicates")
    output_dir_text = _require_string(request.get("output_dir"), "output_dir")
    if any(character in output_dir_text for character in ("\x00", "\n", "\r", "{", "}")):
        raise RequestError("output_dir contains characters unsafe for a Yosys script")
    output_dir = Path(output_dir_text).expanduser().resolve()
    tools = _require_mapping(request.get("tools"), "tools")
    libraries = _require_mapping(request.get("libraries"), "libraries")
    constraints = _constraint_summary(_require_mapping(request.get("constraints"), "constraints"))
    container_digest = _require_string(tools.get("container_digest"), "tools.container_digest")
    if not (container_digest.startswith("sha256:") or container_digest.startswith("host:")):
        raise RequestError("tools.container_digest must start with 'sha256:' or 'host:'")
    return {
        "schema": SCHEMA,
        "top": top,
        "rtl": [{"path": str(path), "sha256": _sha256_file(path)} for path in rtl],
        "output_dir": output_dir,
        "tools": {
            "yosys": _tool(tools.get("yosys"), "yosys"),
            "abc": _tool(tools.get("abc"), "abc"),
            "container_digest": container_digest,
            "timeout_seconds": _number(
                tools.get("timeout_seconds"), "tools.timeout_seconds", positive=True
            ),
        },
        "libraries": {
            "reference": _library_arm(libraries.get("reference"), "reference"),
            "augmented": _library_arm(libraries.get("augmented"), "augmented"),
        },
        "constraints": constraints,
    }


def _tcl(path: object) -> str:
    # Yosys command files do not implement Tcl brace grouping: ``{path}``
    # reaches read_liberty as a literal filename.  Its lexer does accept
    # double-quoted strings and backslash escapes, which JSON string encoding
    # supplies deterministically for whitespace and other path characters.
    return json.dumps(str(path), ensure_ascii=False)


def _abc_script() -> str:
    return "\n".join(("strash", "ifraig", "scorr", "dc2", "dretime", "strash", "dch -f", "map", ""))


def _normalized_script(path: Path, library: Mapping[str, object], directory: Path) -> str:
    """Remove the two allowed arm differences from an actual generated script.

    The audit hashes implementation output rather than a parallel command list,
    so a later edit cannot silently change one arm while leaving an aspirational
    plan unchanged.
    """
    normalized: list[str] = []
    saw_library_set = False
    library_paths = [str(item["path"]) for item in library["files"]]  # type: ignore[index]
    for source_line in path.read_text().splitlines():
        if source_line.startswith("read_liberty -lib "):
            if not saw_library_set:
                normalized.append("read_liberty -lib {<LIBRARY_SET>}")
                saw_library_set = True
            continue
        line = source_line.replace(str(directory), "<OUTPUT_DIR>")
        for library_path in library_paths:
            line = line.replace(library_path, "<MAPPING_LIBRARY>")
        normalized.append(line)
    return "\n".join(normalized) + "\n"


def _write_arm_inputs(validated: Mapping[str, object], arm: str, directory: Path) -> dict[str, Path]:
    directory.mkdir(parents=True, exist_ok=False)
    library = validated["libraries"][arm]  # type: ignore[index]
    constraints = validated["constraints"]  # type: ignore[assignment]
    abc_script = directory / "abc.script"
    abc_constraints = directory / "abc.constraints"
    yosys_script = directory / "mapping.ys"
    mapped = directory / "mapped.v"
    stat_text = directory / "stat.txt"
    stat_json = directory / "stat.json"
    abc_script.write_text(_abc_script())
    abc_constraints.write_text(
        f"set_driving_cell {constraints['driving_cell']}\nset_load {constraints['output_load']:.12g}\n"
    )
    lines: list[str] = []
    for item in library["files"]:  # type: ignore[index]
        lines.append(f"read_liberty -lib {_tcl(item['path'])}")
    for item in validated["rtl"]:  # type: ignore[index]
        lines.append(f"read_verilog -sv {_tcl(item['path'])}")
    mapping_liberty = library["mapping"]  # type: ignore[index]
    abc = validated["tools"]["abc"]["path"]  # type: ignore[index]
    lines.extend((
        f"hierarchy -check -top {validated['top']}",
        "proc",
        "flatten",
        "opt_clean -purge",
        "memory_dff",
        "memory_map",
        "opt_clean -purge",
        "techmap",
        "opt_clean -purge",
        f"dfflibmap -liberty {_tcl(mapping_liberty)}",
        "abc "
        f"-exe {_tcl(abc)} -liberty {_tcl(mapping_liberty)} "
        f"-constr {_tcl(abc_constraints)} -D {constraints['delay_target_ps']:.12g} "
        f"-script {_tcl(abc_script)}",
        "clean -purge",
        f"tee -o {_tcl(stat_text)} stat -liberty {_tcl(mapping_liberty)}",
        f"tee -o {_tcl(stat_json)} stat -json -liberty {_tcl(mapping_liberty)}",
        f"write_verilog -noattr -noexpr -simple-lhs {_tcl(mapped)}",
    ))
    yosys_script.write_text("\n".join(lines) + "\n")
    return {
        "abc_script": abc_script,
        "abc_constraints": abc_constraints,
        "yosys_script": yosys_script,
        "mapped_netlist": mapped,
        "stat_text": stat_text,
        "stat_json": stat_json,
        "log": directory / "yosys.log",
    }


def _probe_tool(path: str, arguments: Sequence[str]) -> dict[str, object]:
    try:
        completed = subprocess.run(
            [path, *arguments], capture_output=True, text=True, timeout=15, check=False
        )
        combined = (completed.stdout + completed.stderr)[:8192]
        return {"command": [path, *arguments], "return_code": completed.returncode, "output": combined}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": [path, *arguments], "return_code": None, "output": str(error)}


def _load_domain_helpers():
    directory = str(Path(__file__).resolve().parent)
    if directory not in sys.path:
        sys.path.insert(0, directory)
    from cell_need_miner.liberty import parse_skeleton  # type: ignore
    from cell_need_miner.npn import npn_canonical, reduce_support  # type: ignore
    from verilog_netlist import cell_type_census, parse_modules  # type: ignore
    return parse_skeleton, npn_canonical, reduce_support, cell_type_census, parse_modules


def _eval_ast(ast: tuple, assignment: Mapping[str, int]) -> int:
    operation = ast[0]
    if operation == "var":
        return assignment[ast[1]]
    if operation == "const":
        return int(ast[1])
    if operation == "not":
        return 1 ^ _eval_ast(ast[1], assignment)
    left = _eval_ast(ast[1], assignment)
    right = _eval_ast(ast[2], assignment)
    if operation == "and":
        return left & right
    if operation == "or":
        return left | right
    if operation == "xor":
        return left ^ right
    raise ValueError(f"unsupported Liberty AST operation: {operation}")


def _function_identity(cell: object, npn_canonical, reduce_support) -> list[str]:
    if cell.is_seq:
        return ["sequential"]
    identities: list[str] = []
    inputs = list(cell.inputs)
    for output, ast in sorted(cell.outputs.items()):
        if ast is None or len(inputs) > 6:
            identities.append(f"{output}:unknown")
            continue
        truth = 0
        for vector in range(1 << len(inputs)):
            assignment = {pin: (vector >> index) & 1 for index, pin in enumerate(inputs)}
            if _eval_ast(ast, assignment):
                truth |= 1 << vector
        reduced, width = reduce_support(truth, len(inputs))
        canonical, _ = npn_canonical(reduced, width)
        digits = max(1, (1 << width) // 4)
        identities.append(f"{output}:npn:{width}:{canonical:0{digits}x}")
    return identities or ["combinational:unknown"]


def _adoption(mapped: Path, library: Mapping[str, object]) -> dict[str, object]:
    parse_skeleton, npn_canonical, reduce_support, cell_type_census, parse_modules = _load_domain_helpers()
    modules = parse_modules(mapped.read_text(errors="replace"))
    census = cell_type_census(modules)
    cells: dict[str, object] = {}
    for item in library["files"]:  # type: ignore[index]
        cells.update(parse_skeleton(item["path"]))
    function_census: dict[str, int] = {}
    interface_census: dict[str, int] = {}
    drive_census: dict[str, int] = {}
    details: list[dict[str, object]] = []
    unknown: list[str] = []
    variants = library["drive_variants"]
    for cell_name, instances in sorted(census.items()):
        cell = cells.get(cell_name)
        if cell is None:
            functions = ["unknown"]
            interface = "unknown"
            unknown.append(cell_name)
        else:
            functions = _function_identity(cell, npn_canonical, reduce_support)
            interface = json.dumps(
                {"inputs": sorted(cell.inputs), "outputs": sorted(cell.outputs)},
                sort_keys=True,
                separators=(",", ":"),
            )
        drive = variants.get(cell_name, "unspecified")
        for function in functions:
            function_census[function] = function_census.get(function, 0) + instances
        interface_census[interface] = interface_census.get(interface, 0) + instances
        drive_census[drive] = drive_census.get(drive, 0) + instances
        details.append({
            "cell": cell_name,
            "instances": instances,
            "function_classes": functions,
            "pin_interface": json.loads(interface) if interface != "unknown" else "unknown",
            "drive_variant": drive,
        })
    return {
        "cell_census": census,
        "cells": details,
        "function_class_census": dict(sorted(function_census.items())),
        "pin_interface_census": dict(sorted(interface_census.items())),
        "drive_variant_census": dict(sorted(drive_census.items())),
        "unknown_cells": unknown,
    }


def _artifact(path: Path, role: str) -> dict[str, object]:
    return {"role": role, "path": str(path), "sha256": _sha256_file(path), "bytes": path.stat().st_size}


def _run_arm(validated: Mapping[str, object], arm: str, directory: Path) -> dict[str, object]:
    paths = _write_arm_inputs(validated, arm, directory)
    yosys = validated["tools"]["yosys"]["path"]  # type: ignore[index]
    command = [yosys, "-Q", "-T", "-l", str(paths["log"]), "-s", str(paths["yosys_script"])]
    timed_out = False
    try:
        process = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(
                timeout=float(validated["tools"]["timeout_seconds"])  # type: ignore[index]
            )
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
            stderr = (stderr or "") + "\nmapping exceeded tools.timeout_seconds"
        return_code: int | None = process.returncode
    except OSError as error:
        return_code = None
        stderr = str(error)
        stdout = ""
    if not paths["log"].exists():
        paths["log"].write_text(stdout + stderr)
    required = ("mapped_netlist", "stat_text", "stat_json")
    missing = [name for name in required if not paths[name].is_file() or paths[name].stat().st_size == 0]
    base = {
        "arm": arm,
        "command": command,
        "return_code": return_code,
        "stdout": stdout[-8192:],
        "stderr": stderr[-8192:],
        "plan_sha256": _sha256_bytes(
            _normalized_script(paths["yosys_script"], validated["libraries"][arm], directory).encode()  # type: ignore[index]
        ),
        "artifacts": [
            _artifact(paths["abc_script"], "abc_script"),
            _artifact(paths["abc_constraints"], "abc_constraints"),
            _artifact(paths["yosys_script"], "yosys_script"),
            _artifact(paths["log"], "yosys_log"),
        ],
    }
    if timed_out or return_code != 0 or missing:
        return {
            **base,
            "status": "failed",
            "error": {
                "code": (
                    "mapping-timeout" if timed_out else
                    "mapping-tool-failed" if return_code != 0 else
                    "mapping-artifact-missing"
                ),
                "message": f"{arm} mapping did not produce complete evidence",
                "missing_artifacts": missing,
            },
        }
    try:
        json.loads(paths["stat_json"].read_text())
        adoption = _adoption(paths["mapped_netlist"], validated["libraries"][arm])  # type: ignore[index]
    except (OSError, ValueError, KeyError, TypeError) as error:
        return {
            **base,
            "status": "failed",
            "error": {"code": "mapping-artifact-invalid", "message": str(error)},
        }
    return {
        **base,
        "status": "succeeded",
        "artifacts": [
            *base["artifacts"],
            _artifact(paths["mapped_netlist"], "mapped_netlist"),
            _artifact(paths["stat_text"], "stat_text"),
            _artifact(paths["stat_json"], "stat_json"),
        ],
        "adoption": adoption,
    }


def map_reference_and_augmented(request: Mapping[str, object]) -> dict[str, object]:
    """Map both Library arms or return one hash-bound structured failure.

    The augmented arm is not executed after a reference failure.  That preserves
    the reference failure as the earliest causal fact and avoids producing an
    incomparable one-arm result.
    """
    request_sha256 = _sha256_bytes(_canonical_json(request))
    try:
        validated = _validated_request(request)
    except (RequestError, OSError) as error:
        return {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "request_sha256": request_sha256,
            "error": {"code": "invalid-request", "message": str(error)},
        }
    output_dir: Path = validated["output_dir"]  # type: ignore[assignment]
    if output_dir.exists():
        return {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "request_sha256": request_sha256,
            "error": {"code": "output-exists", "message": f"output_dir already exists: {output_dir}"},
        }
    output_dir.mkdir(parents=True)
    identity = {
        "profile": PROFILE,
        "container_digest": validated["tools"]["container_digest"],  # type: ignore[index]
        "yosys": {
            **validated["tools"]["yosys"],  # type: ignore[index]
            "version_probe": _probe_tool(validated["tools"]["yosys"]["path"], ["-V"]),  # type: ignore[index]
        },
        "abc": {
            **validated["tools"]["abc"],  # type: ignore[index]
            "version_probe": _probe_tool(validated["tools"]["abc"]["path"], ["-h"]),  # type: ignore[index]
        },
    }
    reference = _run_arm(validated, "reference", output_dir / "reference")
    common = {
        "schema": RESULT_SCHEMA,
        "request_sha256": request_sha256,
        "profile": PROFILE,
        "tool_identity": identity,
        "inputs": {
            "top": validated["top"],
            "rtl": validated["rtl"],
            "libraries": {
                arm: {
                    "files": validated["libraries"][arm]["files"],
                    "baseline_buffers": validated["libraries"][arm]["baseline_buffers"],
                } for arm in ("reference", "augmented")  # type: ignore[index]
            },
        },
        "constraints": validated["constraints"],
    }
    if reference["status"] != "succeeded":
        return {
            **common,
            "status": "failed",
            "failure_arm": "reference",
            "arms": {"reference": reference},
            "error": reference["error"],
        }
    augmented = _run_arm(validated, "augmented", output_dir / "augmented")
    arms = {"reference": reference, "augmented": augmented}
    if augmented["status"] != "succeeded":
        return {
            **common,
            "status": "failed",
            "failure_arm": "augmented",
            "arms": arms,
            "error": augmented["error"],
        }
    if reference["plan_sha256"] != augmented["plan_sha256"]:
        return {
            **common,
            "status": "failed",
            "failure_arm": "audit",
            "arms": arms,
            "error": {
                "code": "mapping-plan-drift",
                "message": "reference and augmented mappings do not share one invariant command plan",
            },
        }
    return {
        **common,
        "status": "succeeded",
        "arms": arms,
        "script_audit": {
            "invariant_plan_sha256": reference["plan_sha256"],
            "allowed_differences": ["library_set", "output_paths"],
            "constraint_drift": False,
            "top_drift": False,
            "rtl_drift": False,
            "profile_drift": False,
        },
    }


def _main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, help="JSON request path")
    parser.add_argument("--output", required=True, help="JSON result path")
    arguments = parser.parse_args(argv)
    request = json.loads(Path(arguments.request).read_text())
    result = map_reference_and_augmented(request)
    Path(arguments.output).write_bytes(_canonical_json(result))
    return 0 if result["status"] == "succeeded" else 2


if __name__ == "__main__":
    raise SystemExit(_main())
