"""Structural Verilog ECO and reversible patch manifest.

This module parses instance statements before applying edits.  It never uses a
text search to infer connectivity or a replacement pin map; those facts are
supplied by the already-proved opportunity record.
"""

from __future__ import annotations

import hashlib

from verilog_netlist import CELL_INST_RE, MODULE_RE, parse_modules


class EcoError(ValueError):
    pass


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _top_body(text, top):
    hits = [match for match in MODULE_RE.finditer(text) if match.group(1) == top]
    if len(hits) != 1:
        raise EcoError("expected exactly one module %s" % top)
    match = hits[0]
    return match, match.group(2), match.start(2)


def _instance_spans(text, top):
    _match, body, offset = _top_body(text, top)
    spans = {}
    for match in CELL_INST_RE.finditer(body):
        name = match.group(2)
        if name in spans:
            raise EcoError("duplicate instance %s" % name)
        spans[name] = (offset + match.start(), offset + match.end())
    return spans


def _replacement_statement(row):
    pin_items = list(row["inputPinToNet"].items()) + list(
        row["outputPinToNet"].items()
    )
    connections = ", ".join(".%s(%s)" % item for item in pin_items)
    return "\n  %s %s (%s);" % (
        row["master"], row["replacementInstance"], connections
    )


def apply_replacements(text, top, replacements):
    """Apply disjoint instance replacements and return text plus rollback data."""
    spans = _instance_spans(text, top)
    occupied = set()
    edits = []
    for row in replacements:
        names = tuple(row["sourceInstances"])
        overlap = occupied.intersection(names)
        if overlap:
            raise EcoError("overlapping replacements use %s" % ", ".join(sorted(overlap)))
        occupied.update(names)
        missing = sorted(set(names) - set(spans))
        if missing:
            raise EcoError("replacement source instances are absent: %s" % ", ".join(missing))
        ordered = sorted((spans[name][0], name, spans[name]) for name in names)
        for index, (_position, name, (start, end)) in enumerate(ordered):
            edits.append({
                "originalStart": start,
                "originalEnd": end,
                "originalText": text[start:end],
                "replacementText": _replacement_statement(row) if index == 0 else "",
                "opportunityId": row["opportunityId"],
                "sourceInstance": name,
            })

    rewritten = text
    for edit in sorted(edits, key=lambda item: item["originalStart"], reverse=True):
        rewritten = (
            rewritten[: edit["originalStart"]]
            + edit["replacementText"]
            + rewritten[edit["originalEnd"] :]
        )

    delta = 0
    for edit in sorted(edits, key=lambda item: item["originalStart"]):
        edit["rewrittenStart"] = edit["originalStart"] + delta
        edit["rewrittenEnd"] = edit["rewrittenStart"] + len(edit["replacementText"])
        delta += len(edit["replacementText"]) - (
            edit["originalEnd"] - edit["originalStart"]
        )
    manifest = {
        "schema": "hima.multi-output-eco-patches/1",
        "top": top,
        "originalSha256": sha256_text(text),
        "rewrittenSha256": sha256_text(rewritten),
        "edits": sorted(edits, key=lambda item: item["originalStart"]),
    }
    return rewritten, manifest


def apply_replacement_groups(text, replacements):
    """Apply replacements in multiple modules with one reversible manifest."""
    by_module = {}
    for row in replacements:
        by_module.setdefault(row["module"], []).append(row)
    rewritten = text
    module_patches = []
    for module in sorted(by_module):
        rewritten, manifest = apply_replacements(
            rewritten, module, by_module[module]
        )
        module_patches.append(manifest)
    return rewritten, {
        "schema": "hima.multi-output-eco-patches/1",
        "top": None,
        "modules": sorted(by_module),
        "originalSha256": sha256_text(text),
        "rewrittenSha256": sha256_text(rewritten),
        "modulePatches": module_patches,
        "edits": [
            edit
            for manifest in module_patches
            for edit in manifest["edits"]
        ],
    }


def rollback_text(rewritten, manifest):
    if sha256_text(rewritten) != manifest["rewrittenSha256"]:
        raise EcoError("rewritten netlist hash drift")
    if "modulePatches" in manifest:
        restored = rewritten
        for module_patch in reversed(manifest["modulePatches"]):
            restored = rollback_text(restored, module_patch)
        if sha256_text(restored) != manifest["originalSha256"]:
            raise EcoError("multi-module rollback did not reconstruct the original netlist")
        return restored
    restored = rewritten
    for edit in sorted(manifest["edits"], key=lambda item: item["rewrittenStart"], reverse=True):
        start, end = edit["rewrittenStart"], edit["rewrittenEnd"]
        if restored[start:end] != edit["replacementText"]:
            raise EcoError("rewritten patch text drift at %d" % start)
        restored = restored[:start] + edit["originalText"] + restored[end:]
    if sha256_text(restored) != manifest["originalSha256"]:
        raise EcoError("rollback did not reconstruct the original netlist")
    return restored


def assert_only_allowed_masters(text, top, allowed, replacement_prefix="HIMA_MO_"):
    modules = parse_modules(text)
    for instance in modules.get(top, ()):
        if instance.name.startswith(replacement_prefix) and instance.cell_type not in allowed:
            raise EcoError("rewritten netlist instantiates disallowed master %s" % instance.cell_type)
