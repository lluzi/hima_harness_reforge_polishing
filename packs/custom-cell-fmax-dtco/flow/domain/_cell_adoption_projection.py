"""Shared, deployable projection of generated-cell adoption evidence.

This module lives inside ``flow/`` because that is the exact Package asset tree
materialized on the EDA server.  Both the Runtime evidence parser and the
remote strategy report consume this implementation, so the commercial path
cannot pass local tests by importing a parser directory that is absent from the
remote run workspace.
"""
from __future__ import annotations

import hashlib
import re

from _generation_projection import expected_generation_jobs


class AdoptionProjectionError(ValueError):
    """The captured netlist or Liberty cannot support an adoption projection."""


_LIB_NAME_RE = re.compile(r"\blibrary\s*\(\s*([^)\s]+)\s*\)")
# Liberty permits both ``cell (NAME)`` and ``cell ("NAME")``.  The quotes are
# syntax, not part of the identifier.  Keeping them in the captured name turns
# an exact instance-to-library join into a guaranteed miss for generated
# libraries emitted with quoted identifiers.
_CELL_OPEN_RE = re.compile(
    r'\bcell\s*\(\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))\s*\)\s*\{'
)
_SOURCE_KEYS = {
    "path", "sha256", "bytes", "line_count", "text", "text_is_complete", "missing",
}
_SOURCE_NAMES = {"synthesis_netlist", "generated_liberty"}
_VERILOG_KEYWORDS = {
    "module", "endmodule", "input", "output", "inout", "wire", "wand", "wor",
    "tri", "tri0", "tri1", "supply0", "supply1", "reg", "integer", "real",
    "time", "genvar", "parameter", "localparam", "defparam", "assign",
    "always", "initial", "begin", "end", "if", "else", "case", "casex",
    "casez", "endcase", "for", "while", "repeat", "forever", "function",
    "endfunction", "task", "endtask", "generate", "endgenerate", "specify",
    "endspecify", "specparam", "table", "endtable", "primitive", "endprimitive",
    "posedge", "negedge", "and", "or", "not", "nand", "nor", "xor", "xnor",
    "buf", "bufif0", "bufif1", "notif0", "notif1", "pullup", "pulldown",
}
_INSTANCE_RE = re.compile(
    r"(?m)^[ \t]*([A-Za-z_][A-Za-z0-9_$]*)[ \t]+"
    r"(\\\S+|[A-Za-z_][A-Za-z0-9_$]*(?:\s*\[[^\]]*\])?)[ \t]*\("
)


def _complete_source_text(record, name):
    reports = record.get("reports")
    if not isinstance(reports, dict) or name not in reports:
        raise AdoptionProjectionError("adoption record is missing report source %s" % name)
    if set(reports) != _SOURCE_NAMES:
        raise AdoptionProjectionError(
            "adoption record report sources must be exactly %s"
            % ", ".join(sorted(_SOURCE_NAMES))
        )
    source = reports[name]
    if not isinstance(source, dict):
        raise AdoptionProjectionError("report source %s must be an object" % name)
    missing_keys = sorted(_SOURCE_KEYS - set(source))
    unknown_keys = sorted(set(source) - _SOURCE_KEYS)
    if missing_keys:
        raise AdoptionProjectionError(
            "report source %s missing keys: %s" % (name, ", ".join(missing_keys))
        )
    if unknown_keys:
        raise AdoptionProjectionError(
            "report source %s carries undeclared keys: %s"
            % (name, ", ".join(unknown_keys))
        )
    if source.get("missing") is not False:
        raise AdoptionProjectionError("report source %s is missing" % name)
    text = source.get("text")
    if not isinstance(text, str):
        raise AdoptionProjectionError("report source %s has no captured text" % name)
    if source.get("text_is_complete") is not True:
        raise AdoptionProjectionError("report source %s capture is partial" % name)
    declared_digest = source.get("sha256")
    actual_digest = "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()
    if declared_digest is not None and declared_digest != actual_digest:
        raise AdoptionProjectionError(
            "report source %s capture does not match its declared sha256" % name
        )
    declared_bytes = source.get("bytes")
    actual_bytes = len(text.encode("utf-8"))
    if declared_bytes is not None and declared_bytes != actual_bytes:
        raise AdoptionProjectionError(
            "report source %s capture is %d bytes but declares %d"
            % (name, actual_bytes, declared_bytes)
        )
    return text


def _liberty_cell_names(text):
    stripped = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    if not _LIB_NAME_RE.search(stripped):
        raise AdoptionProjectionError(
            "no library (...) declaration found; unsupported Liberty shape"
        )
    names = []
    for match in _CELL_OPEN_RE.finditer(stripped):
        name = match.group(1) or match.group(2)
        depth = 0
        index = match.end() - 1
        while index < len(stripped):
            if stripped[index] == "{":
                depth += 1
            elif stripped[index] == "}":
                depth -= 1
                if depth == 0:
                    break
            index += 1
        if depth != 0:
            raise AdoptionProjectionError(
                "cell %s is not closed; the Liberty is truncated" % name
            )
        names.append(name)
    if len(set(names)) != len(names):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        raise AdoptionProjectionError(
            "Liberty declares duplicate cells: %s" % ", ".join(duplicates)
        )
    return names


def _verilog_instance_references(text):
    body = re.sub(r"//[^\n]*", "", text)
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    if "module" not in body:
        raise AdoptionProjectionError(
            "no module declaration found; unsupported netlist shape"
        )
    references = {}
    total = 0
    for reference, _instance in _INSTANCE_RE.findall(body):
        if reference in _VERILOG_KEYWORDS:
            continue
        references[reference] = references.get(reference, 0) + 1
        total += 1
    if total == 0:
        raise AdoptionProjectionError(
            "no cell instantiations found; unsupported netlist shape"
        )
    return references, total


def project_record(record):
    """Derive adoption only from the record's complete captured reports."""
    netlist_text = _complete_source_text(record, "synthesis_netlist")
    liberty_text = _complete_source_text(record, "generated_liberty")
    return project_texts(netlist_text, liberty_text)


def project_texts(netlist_text, liberty_text):
    """Derive adoption from two already integrity-checked complete texts."""
    if not isinstance(netlist_text, str) or not isinstance(liberty_text, str):
        raise AdoptionProjectionError("adoption inputs must be complete text")
    references, instance_total = _verilog_instance_references(netlist_text)
    generated = set(_liberty_cell_names(liberty_text))
    hits = {name: count for name, count in references.items() if name in generated}
    return {
        "netlist_instance_total": instance_total,
        "netlist_distinct_reference_count": len(references),
        "generated_library_cell_count": len(generated),
        "adopted_instance_count": sum(hits.values()),
        "distinct_master_count": len(hits),
        "master_rows": [
            {"master": name, "instance_count": count}
            for name, count in sorted(hits.items(), key=lambda item: (-item[1], item[0]))
        ],
        "generated_masters_not_instantiated": sorted(generated - set(references)),
    }


def project_attributed_texts(netlist_text, liberty_text, patterns):
    """Attribute one shared synthesis screen back to every contributing method.

    Shared candidates credit each method that proposed the same Boolean/interface
    Cell. Method totals are therefore explanatory and intentionally non-additive.
    """
    projection = project_texts(netlist_text, liberty_text)
    master_hits = {row["master"]: row["instance_count"] for row in projection["master_rows"]}
    requests = patterns.get("generation_requests") if isinstance(patterns, dict) else None
    if not isinstance(requests, list):
        raise AdoptionProjectionError("merged patterns have no generation_requests array")
    jobs = expected_generation_jobs(patterns)
    masters_by_candidate = {}
    for job in jobs:
        masters_by_candidate.setdefault(job["candidate_id"], []).append(job["cell_name"])
    candidate_rows = []
    method_totals = {}
    for order, request in enumerate(requests, 1):
        candidate_id = request.get("candidate_id") if isinstance(request, dict) else None
        if candidate_id not in masters_by_candidate:
            raise AdoptionProjectionError("merged candidate is absent from generation jobs")
        evidence = request.get("discovery_evidence") or {}
        methods = evidence.get("strategy_ids")
        rankings = evidence.get("strategy_rankings")
        if (not isinstance(methods, list) or not methods
                or len(methods) != len(set(methods))
                or any(not isinstance(method, str) or not method for method in methods)
                or not isinstance(rankings, dict) or set(rankings) != set(methods)):
            raise AdoptionProjectionError("candidate has no exact contributing-method provenance")
        offered = sorted(masters_by_candidate[candidate_id])
        adopted = [{"master": master, "instance_count": master_hits[master]}
                   for master in offered if master in master_hits]
        instances = sum(row["instance_count"] for row in adopted)
        row = {
            "generation_rank": order,
            "candidate_id": candidate_id,
            "source_methods": methods,
            "method_rankings": rankings,
            "offered_masters": offered,
            "adopted_masters": adopted,
            "adopted_instance_count": instances,
        }
        candidate_rows.append(row)
        for method in methods:
            total = method_totals.setdefault(method, {
                "method": method, "offered_candidate_count": 0,
                "adopted_candidate_count": 0, "adopted_master_count": 0,
                "adopted_instance_count": 0, "exclusive_adopted_candidate_count": 0,
                "shared_adopted_candidate_count": 0,
            })
            total["offered_candidate_count"] += 1
            if adopted:
                total["adopted_candidate_count"] += 1
                total["adopted_master_count"] += len(adopted)
                total["adopted_instance_count"] += instances
                key = "exclusive_adopted_candidate_count" if len(methods) == 1 else "shared_adopted_candidate_count"
                total[key] += 1
    projection.update({
        "adopted_candidate_count": sum(1 for row in candidate_rows if row["adopted_instance_count"] > 0),
        "candidate_rows": candidate_rows,
        "method_rows": sorted(method_totals.values(), key=lambda row: (-row["adopted_instance_count"], row["method"])),
        "attribution_policy": "shared candidates credit every source method; method rows are non-additive",
    })
    return projection
