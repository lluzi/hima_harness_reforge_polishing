"""Fail-closed Yosys top-equivalence adapter."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path


class ProofError(RuntimeError):
    pass


def _expr(ast):
    op = ast[0]
    if op == "var":
        return ast[1]
    if op == "const":
        return "1'b%d" % ast[1]
    if op == "not":
        return "~(%s)" % _expr(ast[1])
    symbol = {"and": "&", "or": "|", "xor": "^"}.get(op)
    if symbol is None:
        raise ProofError("cannot emit Boolean operator %s" % op)
    return "(%s %s %s)" % (_expr(ast[1]), symbol, _expr(ast[2]))


def write_cell_models(cells, path):
    lines = ["// generated from the request-bound Liberty functions"]
    for name in sorted(cells):
        cell = cells[name]
        if not cell.output_pins:
            continue
        ports = list(cell.inputs) + list(cell.output_pins)
        prefix = "(* blackbox *) " if cell.is_seq else ""
        lines.append("%smodule %s(%s);" % (prefix, name, ", ".join(ports)))
        if cell.inputs:
            lines.append("  input %s;" % ", ".join(cell.inputs))
        lines.append("  output %s;" % ", ".join(cell.output_pins))
        if cell.is_seq:
            lines.append("endmodule")
            continue
        for pin, ast in sorted(cell.outputs.items()):
            if ast is None:
                raise ProofError("cell %s output %s has no parseable function" % (name, pin))
            lines.append("  assign %s = %s;" % (pin, _expr(ast)))
        missing = sorted(set(cell.output_pins) - set(cell.outputs))
        if missing:
            raise ProofError("cell %s outputs have no parseable functions: %s" % (name, ", ".join(missing)))
        lines.append("endmodule")
    Path(path).write_text("\n".join(lines) + "\n")


def _q(path):
    value = str(Path(path).resolve())
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def prove_top_equivalence(original, rewritten, top, cells, workdir, yosys="yosys", timeout=120):
    executable = shutil.which(yosys) if "/" not in yosys else yosys
    if not executable or not Path(executable).exists():
        raise ProofError("Yosys top-equivalence backend is unavailable")
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    models = workdir / "cell-models.v"
    script = workdir / "equivalence.ys"
    write_cell_models(cells, models)
    script.write_text("\n".join([
        "read_verilog -sv %s" % _q(models),
        "read_verilog -sv %s" % _q(original),
        "hierarchy -check -top %s" % top,
        "proc; flatten; opt_clean",
        "rename %s gold" % top,
        "design -stash gold_design",
        "design -reset",
        "read_verilog -sv %s" % _q(models),
        "read_verilog -sv %s" % _q(rewritten),
        "hierarchy -check -top %s" % top,
        "proc; flatten; opt_clean",
        "rename %s gate" % top,
        "design -stash gate_design",
        "design -reset",
        "design -copy-from gold_design -as gold gold",
        "design -copy-from gate_design -as gate gate",
        "equiv_make gold gate equiv",
        "hierarchy -top equiv",
        "equiv_simple",
        "equiv_status -assert",
    ]) + "\n")
    version = subprocess.run(
        [executable, "-V"], text=True, capture_output=True, timeout=15, check=False
    )
    try:
        proc = subprocess.run(
            [executable, "-q", "-s", str(script)], text=True, capture_output=True,
            timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired as error:
        proof = {
            "schema": "hima.multi-output-equivalence-proof/1",
            "backend": "yosys-equiv",
            "tool": (version.stdout or version.stderr).strip(),
            "scriptSha256": hashlib.sha256(script.read_bytes()).hexdigest(),
            "returnCode": None,
            "status": "timeout",
            "stdoutTail": (error.stdout or "")[-8000:],
            "stderrTail": (error.stderr or "")[-8000:],
        }
        (workdir / "equivalence.json").write_text(
            json.dumps(proof, indent=2, sort_keys=True) + "\n"
        )
        raise ProofError("Yosys top equivalence timed out") from error
    proof = {
        "schema": "hima.multi-output-equivalence-proof/1",
        "backend": "yosys-equiv",
        "tool": (version.stdout or version.stderr).strip(),
        "scriptSha256": hashlib.sha256(script.read_bytes()).hexdigest(),
        "returnCode": proc.returncode,
        "status": "proved" if proc.returncode == 0 else "failed",
        "stdoutTail": proc.stdout[-8000:],
        "stderrTail": proc.stderr[-8000:],
    }
    (workdir / "equivalence.json").write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n")
    if proc.returncode != 0:
        raise ProofError("Yosys top equivalence failed")
    return proof
