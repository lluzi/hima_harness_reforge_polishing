"""Fail-closed Yosys top-equivalence adapter."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from verilog_netlist import MODULE_RE, parse_modules


class ProofError(RuntimeError):
    pass


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


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
    used_types = set()
    for netlist in (original, rewritten):
        for instances in parse_modules(Path(netlist).read_text()).values():
            used_types.update(instance.cell_type for instance in instances)
    write_cell_models(
        {name: cells[name] for name in sorted(used_types) if name in cells},
        models,
    )
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
            "originalNetlistSha256": _sha256(original),
            "rewrittenNetlistSha256": _sha256(rewritten),
            "cellModelsSha256": _sha256(models),
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
        "originalNetlistSha256": _sha256(original),
        "rewrittenNetlistSha256": _sha256(rewritten),
        "cellModelsSha256": _sha256(models),
        "returnCode": proc.returncode,
        "status": "proved" if proc.returncode == 0 else "failed",
        "stdoutTail": proc.stdout[-8000:],
        "stderrTail": proc.stderr[-8000:],
    }
    (workdir / "equivalence.json").write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n")
    if proc.returncode != 0:
        raise ProofError("Yosys top equivalence failed")
    return proof


def _module_matches(text):
    result = {}
    for match in MODULE_RE.finditer(text):
        name = match.group(1)
        if name in result:
            raise ProofError("netlist repeats module %s" % name)
        result[name] = match
    return result


def _without_modules(text, names):
    matches = _module_matches(text)
    missing = sorted(set(names) - set(matches))
    if missing:
        raise ProofError("hierarchical proof is missing modules: %s" % ", ".join(missing))
    reduced = text
    for name in sorted(names, key=lambda item: matches[item].start(), reverse=True):
        match = matches[name]
        reduced = reduced[: match.start()] + reduced[match.end() :]
    return reduced, matches


def prove_hierarchical_equivalence(
    original, rewritten, proof_top, subject_modules, cells, workdir,
    yosys="yosys", timeout=120,
):
    """Compose exact combinational leaf proofs under an unchanged hierarchy."""
    modules = tuple(sorted(set(subject_modules)))
    if not modules or proof_top in modules:
        raise ProofError("hierarchical proof requires non-top subject modules")
    original_text = Path(original).read_text()
    rewritten_text = Path(rewritten).read_text()
    original_outside, original_matches = _without_modules(original_text, modules)
    rewritten_outside, rewritten_matches = _without_modules(rewritten_text, modules)
    if original_outside != rewritten_outside:
        raise ProofError("netlist outside the subject modules changed")
    parsed = parse_modules(original_text)
    rows = []
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    for module in modules:
        original_header = original_matches[module].group(0).split(";", 1)[0]
        rewritten_header = rewritten_matches[module].group(0).split(";", 1)[0]
        if original_header != rewritten_header:
            raise ProofError("module %s interface changed" % module)
        sequential = sorted({
            instance.cell_type
            for instance in parsed[module]
            if instance.cell_type in cells and cells[instance.cell_type].is_seq
        })
        if sequential:
            raise ProofError(
                "hierarchical subject module %s contains sequential cells: %s"
                % (module, ", ".join(sequential))
            )
        module_dir = workdir / ("module-" + module)
        row = prove_top_equivalence(
            original, rewritten, module, cells, module_dir,
            yosys=yosys, timeout=timeout,
        )
        proof_path = module_dir / "equivalence.json"
        rows.append({
            "module": module,
            "status": row["status"],
            "proofSha256": _sha256(proof_path),
            "originalNetlistSha256": row["originalNetlistSha256"],
            "rewrittenNetlistSha256": row["rewrittenNetlistSha256"],
            "cellModelsSha256": row["cellModelsSha256"],
        })
    outside_hash = hashlib.sha256(original_outside.encode("utf-8")).hexdigest()
    proof = {
        "schema": "hima.multi-output-equivalence-proof/1",
        "backend": "yosys-hierarchical-composition",
        "status": "proved",
        "proofTop": proof_top,
        "subjectModules": list(modules),
        "outsideSubjectsUnchangedSha256": outside_hash,
        "originalNetlistSha256": _sha256(original),
        "rewrittenNetlistSha256": _sha256(rewritten),
        "moduleProofs": rows,
        "claim": (
            "Each changed combinational leaf is Yosys-equivalent, its interface is unchanged, "
            "and every byte outside the changed module definitions is identical."
        ),
    }
    (workdir / "equivalence.json").write_text(
        json.dumps(proof, indent=2, sort_keys=True) + "\n"
    )
    return proof
