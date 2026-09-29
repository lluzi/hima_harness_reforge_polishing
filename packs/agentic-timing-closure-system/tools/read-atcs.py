#!/usr/bin/env python3
"""Fail-closed Reader for the agentic-timing-closure-system Pack's artifacts.

One script backs every `readers/*.yml` declaration in this Pack (the same
"one script, many thin reader declarations" shape as the frozen old Pack's
`packs/xtop-timing-closure/tools/read-output.py`, read-only reference). Each
reader's own `argv` (see `readers/*.yml`) is::

    [/usr/bin/python3, '${READER}', '<kind>', '${REPORT}', '${OUT}', '${WORKSPACE}', ...]

so this script's own `sys.argv` is
``[read-atcs.py, <kind>, <report path>, <out path>, <workspace path>, <extra...>]``
— `<kind>` selects which artifact shape below is read; a worker-slot reader
appends one literal `w01`/`w02`/`w03` as `<extra[0]>` to cross-check the
artifact's own `taskId` against the slot the reader declaration is bound to.

Harness contract (`.superpowers/sdd/pack-mechanics.md` §1.13,
`packages/harness/src/semantics.ts:319-353` `validateReading`): this script
writes ``{"values": [{"type", "unit", "value": number|null, "mode"?,
"scope"?, "unknownReason"?}, ...]}`` to `<out path>`; `value: null` always
carries `unknownReason` (never a substituted zero), and the *set* of types
actually written must equal the reader's own declared `emits` exactly, in
both directions — every handler below unconditionally emits its reader's
whole declared set on every call, using `unknown()` as the value wherever a
fact could not be established.

Deployment: this script is shipped alone (`packReaderFilePath`/
`runPackReader`, `packages/harness/src/node-turns.ts:1424-1441` — only this
one file's bytes are copied into the Campaign workspace's
``hima-readers/<reader-id>/`` directory, never a sibling `flow/` tree
alongside it), so it cannot import this Pack's own `flow/atcs` package via a
path relative to itself. `workspace.source: pack` deploys this Pack's whole
`flow/` copy (`workspace.copy` in `contract.yml`, T14) into
``<workspace>/flow/`` once per Campaign — the *fourth* reader placeholder,
`${WORKSPACE}`, is exactly how this script locates that copy at read time:
`_atcs_modules()` below inserts ``<workspace>/flow`` onto `sys.path` and
imports `atcs.core`/`atcs.workspaces`/`atcs.integration`/`atcs.verification`
as top-level packages, the same way `flow/tests/test_core.py` imports them
for testing (`sys.path.insert(0, str(FLOW_DIR)); from atcs import core`).

Fail-closed identity (binding for every kind below, per this task's brief):
`_load_json` refuses a symlinked/missing report and any duplicate JSON key;
`_verify_identity` re-derives `atcs.core.digest` over the artifact's own body
(schema *and* id, never trusting either) exactly as `atcs.core.read_artifact`
does; `_require_file`/`_require_tree` re-hash (`core.file_sha256`) or
re-digest (`core.tree_digest`) every `{"path", "sha256"[, "datDigest"]}`
reference this script can resolve inside the workspace, refusing on any
mismatch. Any exception raised by any handler aborts `main()` before the
`<out>` file is ever written — a fail-closed reader never leaves a stale or
partial reading behind (see `main()`).

Itemized problems (Issue #63): a request-shaped kind (a document a Workshop's
model wrote: observation request, campaign plan, work package / worker
request, integration plan, next-decision) is read by one function returning
`(values, problems)`, and its `tc_request_invalid_count` is `len(problems)`.
`main()` writes that list beside the document as `<document>.problems.txt`
(or, when the document is refused outright, the refusal's reason) — the one
file this script writes besides `<out>`. Each producing Workshop declares it
as the readable output `<output>Problems` (`contract.yml`), so the owner
revising a refused document reads every problem, not only a count. This
script cannot share that list with Workshop code any other way: it is shipped
alone into `hima-readers/<id>/`, and a Workshop sees only the `flow/` copy.

Cross-artifact references some of this Pack's artifacts carry
(`work-package.baseStateId`, `integration-plan` against its `composition-
facts`, `acceptance-record` against its `refresh-ledger`) are not resolved
by scanning the workspace for a same-content file: this script instead
defines a small **read envelope** for exactly those kinds — see the "Read
envelopes" comment block immediately below for the exact required keys of
every one, and each handler's own docstring for the reasoning. Whichever
Tool/Workshop this Pack's `contract.yml` (T14) ultimately binds to each such
reader's output must write its `REPORT` in that envelope shape; see this
task's report (`.superpowers/sdd/task-13-report.md`) for the full table.
`next-decision` is the one request-shaped kind resolved by workspace scan
instead (`_resolve_id_in_workspace`) because SPEC.md's Semantics section
explicitly describes checking that its `stateRef`/`observationRef` are
themselves resolvable inside the Campaign, not against one specific
companion. `precheck-evidence` needs **no** envelope at all as of this
task's review round: `atcs.verification.precheck_evidence` now stamps it as
a real artifact this script reads and identity-checks directly, exactly
like `evaluation` or `composition-facts`.
"""
from __future__ import annotations

import importlib
import json
import math
import os
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Read envelopes — the exact REPORT shape each envelope-based kind expects
# ---------------------------------------------------------------------------
#
# Most kinds below read one stamped `atcs.<kind>/1` artifact directly (no
# envelope at all): `readiness`, `composition-facts`, `integration-state`,
# `evaluation`, `worker-result`, and, as of this task's review round,
# `precheck-evidence` (now a real stamped artifact produced by
# `atcs.verification.precheck_evidence` — see its handler below). The kinds
# below still need a companion artifact/path this script has no Harness
# placeholder to fetch on its own (only `READER`/`REPORT`/`OUT`/`WORKSPACE`
# exist), so this script defines a small envelope JSON shape for each; the
# `contract.yml` (T14) Tool/Workshop that produces that kind's REPORT file
# must write exactly this shape. Every embedded/referenced companion artifact
# is itself schema/id- and, where applicable, source-verified before use.
#
#   observation-request   — no envelope: the raw candidate document itself
#                            (self-contained structural check only).
#
#   work-package           {"candidate": {...unstamped work-package fields...},
#   worker-request          "baseState": {...a stamped "design-state" artifact...},
#                            "siteCapabilities": {"pgVerification": bool, ...}}
#
#   campaign-plan           {"candidate": {"workPackages": {"w01": {...}, "w02": {...},
#                             "w03": {...}}, "reason": "<str>"},
#                            "baseState": {...a stamped "design-state" artifact...},
#                            "siteCapabilities": {"pgVerification": bool, ...}}
#                           (Task 12c item 4a: the plan Workshop's ONE campaign-plan
#                            document, holding all three work packages -- replaces the
#                            old "work-package" reader binding for `campaignPlan`, which
#                            only ever saw slot w01's own package.)
#
#   contribution-index     {"contributions": [<full stamped "contribution" artifact>, ...],
#                            "pending": [<opaque pending-research id>, ...]}
#                           (as of Task 12c, a pending entry the CLI's own `collect` writes
#                            is `{"slot","reason"}`, not a bare string -- either shape is
#                            accepted here, since only `len(pending)` is ever read.)
#
#   integration-plan        {"plan": {...unstamped or stamped "integration-plan" fields...},
#                            "facts": {...a stamped "composition-facts" artifact...}}
#
#   acceptance-record       {"acceptanceRecord": "<workspace-relative path to a stamped
#                             'acceptance-record' artifact>",
#                            "refreshLedger": "<workspace-relative path to a stamped
#                             'refresh-ledger' artifact (atcs.refresh)>"}
#                           Both are paths, not embedded objects (controller decision,
#                           Task 13 review round 1) — `acceptanceRecord` must resolve;
#                           `refreshLedger` may legitimately not exist yet (no physical
#                           refresh has completed), in which case `tc_refresh_count` is
#                           `unknown`, never a guessed `0`.
#
#   refresh-budget          no envelope: the stamped `design-state` at state/working-state.json
#                           is the anchor REPORT (it exists from `baseline` on); the count itself
#                           is read from the fixed workspace path state/refresh-ledger.json, which
#                           does not exist before the first refresh -- see the handler.
#
#   next-decision           no envelope: the raw candidate document itself.
#                           `stateRef`/`observationRef` are instead resolved by a
#                           bounded workspace scan (`_resolve_id_in_workspace`) —
#                           SPEC.md's Semantics section frames these as references
#                           this Reader checks generically, not against one fixed
#                           companion artifact.


# ---------------------------------------------------------------------------
# Loading and identity
# ---------------------------------------------------------------------------

def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _load_json(path):
    """Load `path` as JSON, refusing a symlink, a missing file or duplicate keys."""
    target = Path(path)
    if target.is_symlink() or not target.is_file():
        raise ValueError(f"cannot read {target}: missing or a symlink")
    return json.loads(target.read_text(encoding="utf-8"), object_pairs_hook=_unique_pairs)


_ATCS_MODULE_NAMES = (
    "core", "state", "workspaces", "contributions", "composition",
    "integration", "verification", "adoption", "experience", "residual", "refresh",
)
_atcs_cache = None


def _atcs_modules(workspace):
    """Import this Pack's own `flow.atcs` package from `<workspace>/flow`.

    Memoized process-wide: every reader invocation is its own short-lived
    process in the real Harness, so this only matters for this script's own
    test suite, which calls this function repeatedly (always against the
    same real `atcs` source, reached through however many workspace
    directories a test symlinks it under).
    """
    global _atcs_cache
    if _atcs_cache is not None:
        return _atcs_cache
    flow_dir = str((Path(workspace) / "flow").resolve())
    if flow_dir not in sys.path:
        sys.path.insert(0, flow_dir)
    modules = {name: importlib.import_module(f"atcs.{name}") for name in _ATCS_MODULE_NAMES}
    _atcs_cache = modules
    return modules


def _verify_identity(obj, kind, core):
    """Re-derive `obj`'s `schema`/`id` exactly as `atcs.core.read_artifact` does."""
    if not isinstance(obj, dict):
        raise ValueError(f"{kind} artifact must be a JSON object")
    expected_schema = f"atcs.{kind}/1"
    if obj.get("schema") != expected_schema:
        raise ValueError(f"expected schema {expected_schema!r}, got {obj.get('schema')!r}")
    stored_id = obj.get("id")
    body = dict(obj)
    body.pop("id", None)
    if stored_id != core.digest(body):
        raise ValueError(f"id mismatch for {kind} artifact: stored id does not match recomputed digest")
    return obj


def _safe_join(workspace, rel_path, label):
    root = Path(workspace).resolve()
    if not isinstance(rel_path, str) or not rel_path:
        raise ValueError(f"{label}: path must be a non-empty string")
    candidate = (root / rel_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise ValueError(f"{label}: path escapes workspace: {rel_path}") from None
    return candidate


def _require_file(workspace, rel_path, expected_sha256, core, label):
    resolved = _safe_join(workspace, rel_path, label)
    if resolved.is_symlink() or not resolved.is_file():
        raise ValueError(f"{label}: file not found in workspace: {rel_path}")
    if core.file_sha256(resolved) != expected_sha256:
        raise ValueError(f"{label}: sha256 mismatch for {rel_path}")


def _require_tree(workspace, rel_path, expected_digest, core, label):
    resolved = _safe_join(workspace, rel_path, label)
    if resolved.is_symlink() or not resolved.is_dir():
        raise ValueError(f"{label}: directory not found in workspace: {rel_path}")
    if core.tree_digest(resolved) != expected_digest:
        raise ValueError(f"{label}: tree digest mismatch for {rel_path}")


def _has_keys(obj, keys):
    return isinstance(obj, dict) and set(keys) <= set(obj)


def _verify_design_state_refs(design_state, workspace, core):
    """Re-hash every file/tree a `design-state` artifact's own fields reference.

    Mirrors `atcs.state.design_state`'s own binding: `database.path`
    (`core.file_sha256`) plus `<database.path>.dat` (`core.tree_digest`, the
    ".enc.dat directory beside it" convention `atcs.verification`'s module
    docstring names verbatim), `netlist`, `def` (when not `None`), every
    `spef` corner and every `sdc` entry (`core.file_sha256` each).
    """
    database = design_state.get("database")
    if not _has_keys(database, ("path", "sha256", "datDigest")):
        raise ValueError("design-state.database must be {path, sha256, datDigest}")
    _require_file(workspace, database["path"], database["sha256"], core, "design-state.database")
    _require_tree(workspace, database["path"] + ".dat", database["datDigest"], core, "design-state.database.datDigest")

    netlist = design_state.get("netlist")
    if not _has_keys(netlist, ("path", "sha256")):
        raise ValueError("design-state.netlist must be {path, sha256}")
    _require_file(workspace, netlist["path"], netlist["sha256"], core, "design-state.netlist")

    def_entry = design_state.get("def")
    if def_entry is not None:
        if not _has_keys(def_entry, ("path", "sha256")):
            raise ValueError("design-state.def must be {path, sha256} or null")
        _require_file(workspace, def_entry["path"], def_entry["sha256"], core, "design-state.def")

    spef = design_state.get("spef")
    if not isinstance(spef, dict):
        raise ValueError("design-state.spef must be an object")
    for corner, entry in spef.items():
        if not _has_keys(entry, ("path", "sha256")):
            raise ValueError(f"design-state.spef.{corner} must be {{path, sha256}}")
        _require_file(workspace, entry["path"], entry["sha256"], core, f"design-state.spef.{corner}")

    sdc = design_state.get("sdc")
    if not isinstance(sdc, list):
        raise ValueError("design-state.sdc must be a list")
    for entry in sdc:
        if not _has_keys(entry, ("path", "sha256")):
            raise ValueError("design-state.sdc entries must be {path, sha256}")
        _require_file(workspace, entry["path"], entry["sha256"], core, "design-state.sdc")


_NETLIST_KEYWORDS = {
    "input", "output", "inout", "wire", "reg", "assign", "supply0", "supply1",
    "tri", "tri0", "tri1", "triand", "trior", "trireg", "wand", "wor",
    "parameter", "localparam", "specparam", "specify", "endspecify",
    "genvar", "defparam", "function", "endfunction", "task", "endtask",
    "initial", "always", "always_comb", "always_ff", "always_latch",
    "generate", "endgenerate", "module", "endmodule", "typedef", "logic",
    "integer", "real", "time", "event", "package", "endpackage",
    "interface", "endinterface", "class", "endclass", "macromodule",
}
# One Verilog token: an escaped identifier (to the next whitespace), a plain identifier, a
# sized or plain number, a string, or one punctuation character.
_NETLIST_TOKEN_RE = re.compile(
    r"\\\S+|[A-Za-z_$][A-Za-z0-9_$]*|\d+\s*'[sS]?[bBoOdDhH]\s*[0-9a-fA-FxXzZ_?]+|\d+|\"[^\"]*\"|\S"
)
# The common one-line instantiation `TYPE NAME ( ... );`, taken without tokenizing when only the
# hierarchy is wanted (a 650k-line netlist is read on every plan and worker-request reading).
_ONE_LINE_INSTANCE_RE = re.compile(
    r"^\s*(\\\S+|[A-Za-z_$][A-Za-z0-9_$]*)\s+(\\\S+|[A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;]*\)\s*;\s*$"
)
_netlist_hierarchy_cache = {}
_netlist_index_cache = {}


def _strip_verilog_escape(name):
    return name[1:] if name.startswith("\\") else name


def _netlist_statements(netlist_path, one_line_instances=False):
    """Yield each statement of a structural Verilog netlist as its token list.

    A statement ends at `;`, and `endmodule` is a statement of its own, so an instantiation
    or a declaration may span any number of lines (C22). `//` and `/* ... */` comments and
    compiler directives are dropped. Every line is read: there is no line cap. With
    `one_line_instances`, a complete one-line instantiation outside any pending statement is
    yielded as `["#instance", TYPE, NAME]` without tokenizing its connections.
    """
    tokens = []
    in_block_comment = False
    with open(netlist_path, "r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if in_block_comment:
                end = line.find("*/")
                if end < 0:
                    continue
                line = line[end + 2:]
                in_block_comment = False
            if "/*" in line or "//" in line:
                kept = []
                index = 0
                while index < len(line):
                    if line.startswith("//", index):
                        break
                    if line.startswith("/*", index):
                        end = line.find("*/", index + 2)
                        if end < 0:
                            in_block_comment = True
                            break
                        index = end + 2
                        kept.append(" ")
                        continue
                    if line[index] == "\\":  # an escaped identifier may hold `/`
                        end = index
                        while end < len(line) and not line[end].isspace():
                            end += 1
                        kept.append(line[index:end])
                        index = end
                        continue
                    kept.append(line[index])
                    index += 1
                line = "".join(kept)
            stripped = line.lstrip()
            if not stripped or stripped.startswith("`"):
                continue
            if one_line_instances and not tokens and not in_block_comment:
                match = _ONE_LINE_INSTANCE_RE.match(line)
                if match and _strip_verilog_escape(match.group(1)) not in _NETLIST_KEYWORDS \
                        and match.group(2) not in _NETLIST_KEYWORDS:
                    yield ["#instance", match.group(1), match.group(2)]
                    continue
            for token in _NETLIST_TOKEN_RE.findall(line):
                if token == ";":
                    if tokens:
                        yield tokens
                    tokens = []
                elif token == "endmodule":
                    if tokens:
                        yield tokens
                    yield ["endmodule"]
                    tokens = []
                else:
                    tokens.append(token)
    if tokens:
        yield tokens


def _net_expression(tokens):
    """A connection's net as one normalized name (`n1`, `bus[3]`, `bus`), or None when it
    is a concatenation, a constant, a part-select or empty."""
    if not tokens or tokens[0] in ("{", "'") or tokens[0][0].isdigit():
        return None
    name = _strip_verilog_escape(tokens[0])
    if len(tokens) == 1:
        return name
    if len(tokens) == 4 and tokens[1] == "[" and tokens[2].isdigit() and tokens[3] == "]":
        return f"{name}[{tokens[2]}]"
    return None


def _group(tokens, start):
    """The tokens inside the parenthesized group opening at `tokens[start]`, and the index after it."""
    depth = 0
    for index in range(start, len(tokens)):
        if tokens[index] == "(":
            depth += 1
        elif tokens[index] == ")":
            depth -= 1
            if depth == 0:
                return tokens[start + 1:index], index + 1
    return tokens[start + 1:], len(tokens)


def _parse_netlist(netlist_path, connections=False):
    """One pass over a structural Verilog netlist (possibly ~650k lines, never capped).

    Returns ``{module: {"instances": {name: type}, "ports": {name: direction}, "conns":
    {instance: {pin: net}}, "assigns": {lhs: rhs}}}``; `conns` and `assigns` are filled
    only when `connections` is true (the endpoint resolver; the Readers need only the
    hierarchy). Instance and type names have their Verilog escape stripped.
    """
    modules = {}
    current = None
    for statement in _netlist_statements(netlist_path, one_line_instances=not connections):
        head = statement[0]
        if head == "#instance":
            if current is not None:
                current["instances"][_strip_verilog_escape(statement[2])] = _strip_verilog_escape(statement[1])
            continue
        if head in ("module", "macromodule"):
            name = _strip_verilog_escape(statement[1]) if len(statement) > 1 else ""
            current = modules.setdefault(name, {"instances": {}, "ports": {}, "conns": {}, "assigns": {}})
            direction = None
            if len(statement) > 2 and "(" in statement[2:]:
                inside, _ = _group(statement, statement.index("(", 2))
                depth = 0
                for token in inside:
                    if token == "[":
                        depth += 1
                    elif token == "]":
                        depth -= 1
                    elif depth == 0 and token in ("input", "output", "inout"):
                        direction = token
                    elif depth == 0 and token not in _NETLIST_KEYWORDS and token not in (",", "(", ")") \
                            and (token[0].isalpha() or token[0] in "_\\$"):
                        current["ports"][_strip_verilog_escape(token)] = direction
            continue
        if head == "endmodule":
            current = None
            continue
        if current is None:
            continue
        if head in ("input", "output", "inout"):
            depth = 0
            for token in statement[1:]:
                if token == "[":
                    depth += 1
                elif token == "]":
                    depth -= 1
                elif depth == 0 and token not in _NETLIST_KEYWORDS and token != "," \
                        and (token[0].isalpha() or token[0] in "_\\$"):
                    current["ports"][_strip_verilog_escape(token)] = head
            continue
        if head == "assign":
            if connections and "=" in statement:
                split = statement.index("=")
                lhs, rhs = _net_expression(statement[1:split]), _net_expression(statement[split + 1:])
                if lhs is not None and rhs is not None:
                    current["assigns"][lhs] = rhs
            continue
        if _strip_verilog_escape(head) in _NETLIST_KEYWORDS or not (head[0].isalpha() or head[0] in "_\\$"):
            continue
        # An instantiation: TYPE [#( params )] NAME [ [range] ] ( connections ) [, NAME (...)]...
        index = 1
        if index < len(statement) and statement[index] == "#":
            _, index = _group(statement, index + 1) if index + 1 < len(statement) and statement[index + 1] == "(" \
                else (None, index + 1)
        cell = _strip_verilog_escape(head)
        while index < len(statement):
            instance = statement[index]
            if instance == ",":
                index += 1
                continue
            if not (instance[0].isalpha() or instance[0] in "_\\$"):
                break
            index += 1
            if index < len(statement) and statement[index] == "[":
                while index < len(statement) and statement[index] != "]":
                    index += 1
                index += 1
            if index >= len(statement) or statement[index] != "(":
                break
            inside, index = _group(statement, index)
            name = _strip_verilog_escape(instance)
            current["instances"][name] = cell
            if connections:
                pins = {}
                position = 0
                while position < len(inside):
                    if inside[position] == "." and position + 1 < len(inside):
                        pin = _strip_verilog_escape(inside[position + 1])
                        if position + 2 < len(inside) and inside[position + 2] == "(":
                            net_tokens, position = _group(inside, position + 2)
                            pins[pin] = _net_expression(net_tokens)
                            continue
                    position += 1
                current["conns"][name] = pins
    return modules


def _parse_netlist_hierarchy(netlist_path):
    """``{module_name: {instance_name: instance_type}}`` of every module of the netlist.

    Only used to answer "is this a real hierarchical instance path" and "is it a leaf cell",
    never to interpret the design otherwise.
    """
    return {name: module["instances"] for name, module in _parse_netlist(netlist_path).items()}


def _netlist_hierarchy(netlist_path):
    """Memoized per resolved netlist path within this process (module docstring)."""
    key = str(Path(netlist_path).resolve())
    if key not in _netlist_hierarchy_cache:
        _netlist_hierarchy_cache[key] = _parse_netlist_hierarchy(key)
    return _netlist_hierarchy_cache[key]


def _split_instance_path(instance_path):
    """Split on unescaped `/` and strip each segment's Verilog escape, symmetric with the parser.

    A segment starting with `\\` is an escaped identifier that runs to the next whitespace, so a
    `/` inside it is literal (`\\u_a/u_b/reg_0_ ` is one instance); the whitespace must then be
    followed by `/` or the end. Returns None for a malformed path.
    """
    segments, index, length = [], 0, len(instance_path)
    while index <= length:
        if index < length and instance_path[index] == "\\":
            end = index + 1
            while end < length and not instance_path[end].isspace():
                end += 1
            segments.append(instance_path[index + 1:end])
            while end < length and instance_path[end].isspace():
                end += 1
            if end < length and instance_path[end] != "/":
                return None
            index = end + 1
            if end >= length:
                break
            continue
        end = instance_path.find("/", index)
        if end < 0:
            segments.append(instance_path[index:])
            break
        segments.append(instance_path[index:end])
        index = end + 1
    return segments


def _instance_type(hierarchy, top, instance_path):
    """The declared type of the instance `instance_path` names under `top`, or None.

    The same walk as `_is_hierarchical_instance`: every non-final segment must be a
    user-module instance, the final one any instance of the module reached.
    """
    if not isinstance(instance_path, str) or not instance_path:
        return None
    segments = _split_instance_path(instance_path)
    if segments is None or any(segment == "" for segment in segments):
        return None
    current_module = top
    for index, segment in enumerate(segments):
        instances = hierarchy.get(current_module)
        if instances is None or segment not in instances:
            return None
        if index == len(segments) - 1:
            return instances[segment]
        current_module = instances[segment]
    return None


def _edit_domain_problems(package, base_state, workspace, where):
    """C23 (failure catalogue): an active slot's editDomain must name something XTop can edit.

    Every 0.1.10 slot is an active worker, so its `editDomain` names at least one instance or
    net, and every instance is a leaf cell of the sha-verified base netlist written as its full
    `/`-separated path from `top` -- never empty, a port or net name, a module instance, a bare
    leaf or a path absent from the netlist. `where` is `(field prefix, slot suffix)`.
    """
    prefix, slot = where
    domain = package.get("editDomain") if isinstance(package, dict) else None
    if not isinstance(domain, dict):
        return []  # `workspaces._collect_problems` already names a missing editDomain
    instances = domain.get("instances") or []
    nets = domain.get("nets") or []
    field = f"{prefix}.editDomain"
    if not instances and not nets:
        return [f"{field}{slot}: names no instance or net; an active slot edits at least one leaf cell, "
                "written as its full path from top such as u_a/reg0"]
    if not isinstance(instances, list):
        return []
    netlist = base_state.get("netlist") if isinstance(base_state, dict) else None
    if not isinstance(netlist, dict):
        return []
    hierarchy = _netlist_hierarchy(_safe_join(workspace, netlist.get("path"), "design-state.netlist"))
    top = base_state.get("top")
    found = []
    for name in instances:
        if not isinstance(name, str) or not name:
            continue  # `workspaces._collect_problems` names an unsafe or empty name
        kind = _instance_type(hierarchy, top, name)
        if kind is None:
            found.append(f"{field}.instances{slot}: {name!r} is not an instance under top {top!r} in the base "
                         "netlist; write each leaf cell's full path from top such as u_a/reg0 (never a port, "
                         "a net or a bare leaf name)")
        elif kind in hierarchy:
            found.append(f"{field}.instances{slot}: {name!r} is a module instance (of {kind!r}), not a leaf "
                         "cell; name the leaf cells inside it by full path")
    return found


def _is_hierarchical_instance(hierarchy, top, instance_path):
    """True when `instance_path` walks real instances from `top` in `hierarchy`.

    Every non-final `/`-separated segment must be an instance of a *user
    module* (its declared type is itself a key of `hierarchy`) so the walk
    can continue into that module's own instances; the final segment may be
    any instance declared in the last module reached (a leaf cell or a
    module instantiation).
    """
    if not isinstance(instance_path, str) or not instance_path:
        return False
    segments = _split_instance_path(instance_path)
    if segments is None or any(segment == "" for segment in segments):
        return False
    current_module = top
    for index, segment in enumerate(segments):
        instances = hierarchy.get(current_module)
        if instances is None or segment not in instances:
            return False
        if index == len(segments) - 1:
            return True
        instance_type = instances[segment]
        if instance_type not in hierarchy:
            return False
        current_module = instance_type
    return True


def _resolve_id_in_workspace(workspace, artifact_id, exclude_dirnames=("hima-readers",)):
    """Best-effort: find a JSON file under `workspace` whose own `id` matches.

    Used only for `next-decision`'s `stateRef`/`observationRef` (SPEC.md's
    Semantics section calls these out by name as references the Reader
    itself must find "resolvable"), never for kinds this script instead
    binds through an explicit read envelope (see module docstring). Symlinked
    directories are never followed (`followlinks=False`), so this can never
    loop through this same script's own `hima-readers/<id>/` shipping
    directory or a test's `flow/atcs` symlink.
    """
    root = Path(workspace)
    if not root.is_dir():
        return None
    for current, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [name for name in dirnames if name not in exclude_dirnames]
        for name in filenames:
            if not name.endswith(".json"):
                continue
            try:
                candidate = _load_json(Path(current) / name)
            except (ValueError, OSError):
                continue
            if isinstance(candidate, dict) and candidate.get("id") == artifact_id:
                return candidate
    return None


# ---------------------------------------------------------------------------
# Value construction — the one gate every emitted value passes through
# ---------------------------------------------------------------------------

def _emit(type_name, unit, measure, mode=None, scope=None):
    entry = {"type": type_name, "unit": unit}
    if mode is not None:
        entry["mode"] = mode
    if scope is not None:
        entry["scope"] = scope
    if isinstance(measure, dict) and "value" in measure and "unknown" not in measure:
        value = measure["value"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            entry["value"] = None
            entry["unknownReason"] = f"{type_name} is not a finite number: {value!r}"
        else:
            entry["value"] = value
    elif isinstance(measure, dict) and "unknown" in measure:
        reason = measure["unknown"]
        entry["value"] = None
        entry["unknownReason"] = str(reason) if reason else "unknown"
    else:
        raise ValueError(f"{type_name}: not a Measure ({{'value': ...}} or {{'unknown': ...}}): {measure!r}")
    return entry


def _emit_count(type_name, count):
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise ValueError(f"{type_name}: count must be a non-negative int, got {count!r}")
    return _emit(type_name, "count", {"value": count})


# ---------------------------------------------------------------------------
# Per-kind handlers
# ---------------------------------------------------------------------------

def _read_readiness(report, workspace, extra, mods):
    """`input-readiness` artifact, self-contained (no envelope)."""
    core = mods["core"]
    obj = _load_json(report)
    _verify_identity(obj, "input-readiness", core)

    missing = obj.get("missing")
    if not isinstance(missing, list):
        raise ValueError("input-readiness.missing must be a list")
    missing_count = obj.get("missingCount")
    if core.is_known(missing_count) and core.value_of(missing_count) != len(missing):
        raise ValueError("input-readiness.missingCount disagrees with len(missing)")

    lifecycle_available = obj.get("lifecycleAvailable")
    lifecycle_missing = obj.get("lifecycleMissing")
    scope = obj.get("scope")
    if scope not in ("full-flow", "post-route-only"):
        raise ValueError(f"input-readiness.scope must be 'full-flow' or 'post-route-only', got {scope!r}")
    if not isinstance(lifecycle_missing, list):
        raise ValueError("input-readiness.lifecycleMissing must be a list")
    if core.is_known(lifecycle_available):
        available_value = core.value_of(lifecycle_available)
        if available_value == 1 and (lifecycle_missing or scope != "full-flow"):
            raise ValueError("input-readiness claims lifecycleAvailable=1 but scope/lifecycleMissing disagree")
        if available_value == 0 and scope != "post-route-only":
            raise ValueError("input-readiness claims lifecycleAvailable=0 but scope is not post-route-only")

    return [
        _emit("tc_required_input_missing_count", "count", missing_count),
        _emit("tc_lifecycle_available", "count", lifecycle_available),
    ]


# ---------------------------------------------------------------------------
# Request kinds: one itemized problem list, counted and delivered (Issue #63)
# ---------------------------------------------------------------------------
#
# Every request-shaped kind (a document a Workshop's model wrote) is read by one
# function that returns `(values, problems)`: `problems` is a list of strings,
# each starting with the JSON path of the field it is about (and `(slot w0N)` for
# a slot-scoped document), and the kind's `tc_request_invalid_count` is always
# `len(problems)` -- the count and the text come from one source. `read()`
# returns the values; `problems()` returns the list; `main()` also writes the
# list beside the document as `<document>.problems.txt`, which the producing
# Workshop declares as a readable output (`contract.yml`, `<output>Problems`), so
# after a refusal the owner reads each problem instead of a bare count.

# What a missing or wrong work-package field must look like (knowledge
# example-campaign-plan.md holds one admitted document).
_WORK_PACKAGE_FORMATS = {
    "taskId": "the slot's own id, w01, w02 or w03",
    "baseStateId": "the id of baseState, which is state/working-state.json copied unchanged",
    "problem": "a one-line string naming the timing problem",
    "targets": 'a list of "<scenario>|<setup|hold>|<endpoint>" check keys',
    "editDomain": '{"instances": [full hierarchical paths such as "u_a/reg0"], "nets": [], "regions": []}',
    "protected": '{"instances": [...], "nets": [...]}',
    "mayAffect": "a list of check keys, [] when none",
    "actions": "a list drawn from size_cell, insert_buffer, delete_buffer, pg_local_adjust",
    "budget": '{"xtopMinutes": 30, "queries": 5, "attempts": 3}',
}

_WORK_PACKAGE_FIELD_OF = (
    (re.compile(r"^missing field: (\w+)"), None),
    (re.compile(r"^taskId\b"), "taskId"),
    (re.compile(r"^baseStateId\b"), "baseStateId"),
    (re.compile(r"^editDomain\b"), "editDomain"),
    (re.compile(r"^action\b"), "actions"),
)


def _work_package_problems(package, base_state, site_capabilities, workspaces_mod, path):
    """`workspaces._collect_problems` (the one work-package validator), each named by field."""
    found = []
    for message in workspaces_mod._collect_problems(package, base_state, site_capabilities):
        field = None
        for pattern, name in _WORK_PACKAGE_FIELD_OF:
            match = pattern.match(message)
            if match:
                field = name or match.group(1)
                break
        where = f"{path[0]}.{field}{path[1]}" if field else f"{path[0]}{path[1]}"
        hint = _WORK_PACKAGE_FORMATS.get(field)
        found.append(f"{where}: {message}" + (f"; required format: {hint}" if hint else ""))
    return found


def _problems_file(report):
    """`<dir>/<name>.json` -> `<dir>/<name>.problems.txt`, beside the document."""
    report = Path(report)
    stem = report.name[: -len(".json")] if report.name.endswith(".json") else report.name
    return report.with_name(stem + ".problems.txt")


def _write_problems_file(report, found, refused=None):
    """Best effort: the count in OUT is the verdict's evidence; this file is its explanation."""
    name = Path(report).name
    if refused is not None:
        text = (f"{name} was refused before its problems could be counted: {refused}\n"
                "Fix that and write the whole document again.\n")
    elif not found:
        text = f"0 problems in {name}: the Reader admits it (tc_request_invalid_count = 0).\n"
    else:
        noun = "problem" if len(found) == 1 else "problems"
        lines = [f"{len(found)} {noun} in {name} (tc_request_invalid_count = {len(found)}); "
                 "fix every line and write the whole document again:"]
        lines += ["- " + " ".join(str(item).split()) for item in found]
        text = "\n".join(lines) + "\n"
    try:
        _problems_file(report).write_text(text, encoding="utf-8")
    except OSError:
        pass


_SHAPE_FORMATS = {
    "candidate": "an object holding the unstamped fields, as in the knowledge example",
    "baseState": "the stamped design-state object, state/working-state.json copied unchanged",
    "siteCapabilities": 'an object such as {"pgVerification": false}',
    "plan": "an object {batchId, baseStateId, select, resolutions, deferred, reason}",
    "facts": "the stamped composition-facts object, state/composition-facts.json copied unchanged",
}


def _shape_problems(envelope, keys, slot=""):
    """Issue #63 gap 2: a document of the wrong shape is a counted problem the owner can
    revise -- never a Reader exception that re-reads the same bytes until a Hard blocker
    parks the Run. Empty when every key of `keys` holds an object."""
    if not isinstance(envelope, dict):
        return [f"document{slot}: must be one JSON object {{{', '.join(keys)}}}"]
    found = []
    for key in keys:
        value = envelope.get(key)
        if key != "actions" and not isinstance(value, dict):
            state = "missing" if key not in envelope else f"a {type(value).__name__}"
            found.append(f"{key}{slot}: must be {_SHAPE_FORMATS[key]}; it is {state}")
    return found


def _observation_request(report, workspace, slot, mods):
    """A raw `observationRequest` candidate (diagnose-and-observe Workshop output), self-contained.

    No existing `atcs.*` module owns this shape's validation (only
    `capture`'s own `query_spec` binding, `atcs/state.py`'s module
    docstring), so this handler is this script's own structural check.
    """
    obj = _load_json(report)
    found = []
    if not isinstance(obj, dict):
        found.append("document: must be one JSON object {designStateId, precision, requiredScenarios, maxPaths, nworst}")
        obj = {}
    formats = {
        "designStateId": "the 20-hex-char id of state/working-state.json",
        "precision": "'gba' or 'pba'",
        "requiredScenarios": 'a non-empty list of scenario names such as ["func_ssg_rcworst_m40"]',
        "maxPaths": "a positive integer",
    }
    for key, fmt in formats.items():
        if key not in obj:
            found.append(f"{key}: missing field; required format: {fmt}")
    if "precision" in obj and obj.get("precision") not in ("gba", "pba"):
        found.append(f"precision: must be 'gba' or 'pba', got {obj.get('precision')!r}")
    if "requiredScenarios" in obj:
        required = obj.get("requiredScenarios")
        if not isinstance(required, list) or not required or not all(isinstance(s, str) and s for s in required):
            found.append(f"requiredScenarios: must be a non-empty list of non-empty scenario names, got {required!r}")
    if "maxPaths" in obj:
        max_paths = obj.get("maxPaths")
        if isinstance(max_paths, bool) or not isinstance(max_paths, int) or max_paths <= 0:
            found.append(f"maxPaths: must be a positive integer, got {max_paths!r}")
    if "designStateId" in obj:
        state_id = obj.get("designStateId")
        if not isinstance(state_id, str) or not re.fullmatch(r"[0-9a-f]{20}", state_id):
            found.append(f"designStateId: must be the 20-hex-char id of state/working-state.json, got {state_id!r}")
    return [_emit_count("tc_request_invalid_count", len(found))], found


def _request_envelope(report, workspace, expected_task_id, mods):
    """Shared handler for `work-package`/`worker-request` kinds.

    **Read envelope** (this script's own contract for whichever Tool/Workshop
    T14 binds to this reader's output)::

        {
          "candidate": {...unstamped work-package-shaped fields...},
          "baseState": {...a stamped "design-state" artifact...},
          "siteCapabilities": {"pgVerification": bool, ...}
        }

    `baseState` is schema/id- and source-verified in full
    (`_verify_design_state_refs`) before `candidate` is ever validated
    against it, so a tampered or stale companion state can never launder a
    request's `tc_request_invalid_count` to 0. `workspaces._collect_problems`
    (never `validate_work_package`, which raises) is the one validator this
    handler defers to for the candidate's own problems.
    """
    core = mods["core"]
    workspaces_mod = mods["workspaces"]
    slot = f" (slot {expected_task_id})" if expected_task_id else ""
    envelope = _load_json(report)
    keys = ("candidate", "baseState", "siteCapabilities") + (("actions",) if expected_task_id == "w01" else ())
    found = _shape_problems(envelope, keys, slot)
    if found:
        return [_emit_count("tc_request_invalid_count", len(found))], found
    candidate = envelope["candidate"]
    base_state = envelope["baseState"]
    site_capabilities = envelope["siteCapabilities"]

    # Fail-closed identity stays an exception: a baseState whose id or source files do not
    # verify is not a request problem to count but a companion that cannot be trusted.
    _verify_identity(base_state, "design-state", core)
    _verify_design_state_refs(base_state, workspace, core)

    if expected_task_id is not None and candidate.get("taskId") != expected_task_id:
        found.append(f"candidate.taskId{slot}: must be {expected_task_id!r} for this slot, got {candidate.get('taskId')!r}")
    found += _work_package_problems(candidate, base_state, site_capabilities, workspaces_mod, ("candidate", slot))
    found += _edit_domain_problems(candidate, base_state, workspace, ("candidate", slot))
    if expected_task_id == "w01":
        found += _worker_action_problems(envelope.get("actions"), candidate, base_state, workspace, core, slot)
    return [_emit_count("tc_request_invalid_count", len(found))], found


_LIBERTY_CELL_RE = re.compile(rb'^\s*cell\s*\(\s*"?([^"\s)]+)"?\s*\)')
_library_cache = {}


def _library_cells(files, core):
    """Every `cell (NAME)` of the Liberty `files` ([{path, sha256}]), each re-hashed as read.

    One streaming pass per file both hashes it and collects its cell names, so a file that
    changed since `observe` sealed it is refused, not trusted. Memoized per file list.
    """
    key = tuple((ref.get("path"), ref.get("sha256")) for ref in files)
    if key in _library_cache:
        return _library_cache[key]
    import hashlib
    cells = set()
    for path, expected in key:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for line in handle:
                digest.update(line)
                match = _LIBERTY_CELL_RE.match(line)
                if match:
                    cells.add(match.group(1).decode("latin-1"))
        if digest.hexdigest() != expected:
            raise ValueError(f"Liberty file {path} changed since state/xtop-context.json sealed it")
    _library_cache[key] = cells
    return cells


def _library_context(workspace, base_state, core):
    """`(cells, ecoParameters, None)` from the sealed `state/xtop-context.json`, or `(None, None, why)`.

    C13 (failure catalogue): the Site's XTop library context is the one declared, Pack-sealed
    source of this design's cells. `observe` stamps it from the Site's `xtopContext` (each
    scenario's Liberty files, hashed) and `prepare-workers`/`replay-prepare` re-verify it before
    XTop starts (`atcs_cli._verified_xtop_context`). The worker request's own `siteCapabilities`
    is model-written and is never read for this.
    """
    try:
        context = _load_json(Path(workspace) / "state" / "xtop-context.json")
        _verify_identity(context, "xtop-context", core)
    except (ValueError, OSError) as error:
        return None, None, f"state/xtop-context.json (the Site's sealed XTop library context) cannot be read: {error}"
    if context.get("designStateId") != base_state.get("id"):
        return None, None, ("state/xtop-context.json was sealed for another design state "
                            f"{context.get('designStateId')!r}, not baseState {base_state.get('id')!r}")
    library_files = context.get("libraryFiles")
    eco = context.get("ecoParameters")
    if not isinstance(library_files, dict) or not library_files or not isinstance(eco, dict):
        return None, None, "state/xtop-context.json declares no libraryFiles or ecoParameters"
    scenario = sorted(library_files)[0]
    try:
        cells = _library_cells(library_files[scenario], core)
    except (ValueError, OSError, TypeError, AttributeError) as error:
        return None, None, f"the Liberty files of scenario {scenario!r} in state/xtop-context.json cannot be read: {error}"
    if not cells:
        return None, None, f"the Liberty files of scenario {scenario!r} declare no cell"
    return cells, eco, None


def _sizing_family(master, eco):
    """`(function, VT)` of `master` under the Site's sizing rule, or None when it does not apply.

    `cellNominalSizingPattern` (for example `D([0-9]+)BWP`) marks the drive strength: the text
    before it is the cell function. `cellNominalSwapKeywords` lists the VT suffixes (the empty
    keyword is the standard VT); the longest one the name ends with is its VT.
    """
    try:
        match = re.search(eco.get("cellNominalSizingPattern") or "", master)
    except re.error:
        return None
    if match is None or match.start() == 0 or not eco.get("cellNominalSizingPattern"):
        return None
    tail = master[match.end():]
    keywords = sorted((k for k in eco.get("cellNominalSwapKeywords") or [] if isinstance(k, str) and k),
                      key=len, reverse=True)
    vt = next((k for k in keywords if tail.endswith(k)), "")
    return master[:match.start()], vt


def _master_problems(actions, hierarchy, top, base_state, workspace, core, slot):
    """C13: each well-formed action's toMaster resizes its cell within the design's libraries."""
    checkable = [(i, a) for i, a in enumerate(actions)
                 if isinstance(a, dict) and set(a) == {"instance", "toMaster"}
                 and isinstance(a["toMaster"], str) and a["toMaster"]
                 and not core.is_tcl_unsafe(a["toMaster"]) and "*" not in a["toMaster"] and "?" not in a["toMaster"]]
    if not checkable:
        return []
    cells, eco, why = _library_context(workspace, base_state, core)
    if why is not None:
        return [f"actions{slot}: no toMaster can be checked against this design's libraries: {why}"]
    found = []
    for index, action in checkable:
        where = f"actions[{index}].toMaster{slot}"
        master = action["toMaster"]
        if master not in cells:
            found.append(f"{where}: {master!r} is not a cell of this design's libraries "
                         "(the Liberty files sealed in state/xtop-context.json)")
            continue
        current = _instance_type(hierarchy, top, action["instance"]) if isinstance(action["instance"], str) else None
        if current is None or current in hierarchy:
            continue  # the instance itself is already named as a problem
        if master == current:
            found.append(f"{where}: {master!r} is already the master of {action['instance']!r}; a size_cell "
                         "action must change the drive strength")
            continue
        want, got = _sizing_family(current, eco), _sizing_family(master, eco)
        if want is None or got is None:
            found.append(f"{where}: {master!r} or the current master {current!r} does not follow the Site's sizing "
                         f"pattern {eco.get('cellNominalSizingPattern')!r}, so the resize cannot be shown to keep "
                         "the cell function")
        elif got[0] != want[0]:
            found.append(f"{where}: {master!r} changes cell function {want[0]!r} of {action['instance']!r} "
                         f"({current}) to {got[0]!r}; size_cell keeps the function and changes only the drive "
                         "strength")
        elif got[1] != want[1]:
            found.append(f"{where}: {master!r} changes VT {want[1] or 'standard'!r} of {action['instance']!r} "
                         f"({current}) to {got[1] or 'standard'!r}; size_cell keeps the VT")
    return found


def _worker_action_problems(actions, candidate, base_state, workspace, core, slot):
    """Slot w01's `actions`: one to three `{instance, toMaster}` size_cell candidates.

    T63 real-run failure: a worker action naming a bare LEAF instance name (no
    hierarchy) is not resolvable against the actual post-route netlist, whose leaf
    cells live inside deeply nested modules (the real `g96219` example). Every
    action instance must be a full `/`-separated hierarchical path from
    `base_state["top"]`, walked directly against the sha-verified base netlist
    (never trusted from the candidate).
    """
    if not isinstance(actions, list) or not 1 <= len(actions) <= 3:
        got = f"{len(actions)} entries" if isinstance(actions, list) else ("missing" if actions is None else type(actions).__name__)
        return [f"actions{slot}: must be a list of one to three {{instance, toMaster}} size_cell candidates, "
                f"each instance in candidate.editDomain.instances; got {got}"]
    editable = candidate.get("editDomain")
    domain = (editable.get("instances") if isinstance(editable, dict) else None) or []
    top = base_state.get("top")
    hierarchy = None
    found = []
    for index, action in enumerate(actions):
        where = f"actions[{index}]"
        if not isinstance(action, dict) or set(action) != {"instance", "toMaster"}:
            keys = sorted(action) if isinstance(action, dict) else type(action).__name__
            found.append(f"{where}{slot}: must be exactly {{instance, toMaster}}, got {keys}")
            continue
        instance, master = action["instance"], action["toMaster"]
        if not isinstance(instance, str) or not instance:
            found.append(f"{where}.instance{slot}: must be a full hierarchical instance path string "
                         f"such as u_a/reg0, got {instance!r}")
        else:
            if instance not in domain:
                found.append(f"{where}.instance{slot}: {instance!r} is not in candidate.editDomain.instances")
            if hierarchy is None:
                netlist_path = _safe_join(workspace, base_state["netlist"]["path"], "worker-request.netlist")
                hierarchy = _netlist_hierarchy(netlist_path)
            if not _is_hierarchical_instance(hierarchy, top, instance):
                found.append(f"{where}.instance{slot}: {instance!r} is not a hierarchical instance under top "
                             f"{top!r} in the base netlist; write the full path from top such as u_a/reg0, "
                             "never a bare leaf name")
        if (not isinstance(master, str) or not master or core.is_tcl_unsafe(master)
                or "*" in master or "?" in master):
            found.append(f"{where}.toMaster{slot}: {master!r} is not a plain cell name "
                         "(no Tcl metacharacters, * or ?)")
    if hierarchy is None:
        netlist_path = _safe_join(workspace, base_state["netlist"]["path"], "worker-request.netlist")
        hierarchy = _netlist_hierarchy(netlist_path)
    return found + _master_problems(actions, hierarchy, top, base_state, workspace, core, slot)


def _campaign_plan(report, workspace, extra, mods):
    """The plan Workshop's ONE campaign-plan document, holding all three work packages (Task 12c item 4a).

    Envelope (this script's own contract; see module docstring)::

        {"candidate": {"workPackages": {"w01": {...}, "w02": {...}, "w03": {...}},
                        "reason": "<str>"},
         "baseState": {...a stamped "design-state" artifact...},
         "siteCapabilities": {"pgVerification": bool, ...}}

    `baseState` is schema/id- and source-verified in full
    (`_verify_design_state_refs`) before any package is validated against
    it, exactly like `_request_envelope`. The problems are every
    `workspaces._collect_problems` problem of each of `w01`/`w02`/`w03`,
    plus one structural problem for each of: a missing/non-dict
    `workPackages` object, a missing or non-dict entry for any of the three
    slots, and a missing or blank `reason` string -- so a Reader-visible
    problem exists for every way the *shape* itself (not just one slot's
    own content) can be wrong.

    Fix round 2 item 3 (Minor) adds two more Reader-visible problems, both
    counted even though `prepare-workers` (`atcs_cli.py`) independently
    refuses the same conditions outright -- a Judge should see a nonzero
    `tc_request_invalid_count` for these before that Tool ever runs, not
    only discover them as a Tool-side exit-3 refusal:

    - a top-level `workPackages` key on the envelope itself (a second,
      unenforced copy of the same data `candidate.workPackages` already
      carries -- `prepare-workers` refuses this as `ambiguous-plan`
      regardless of whether the two copies happen to agree);
    - `envelope.baseState`'s own `id` disagreeing with the id currently
      recorded in `state/working-state.json` (read from `workspace`, the
      same Campaign root this handler already resolves every other
      workspace-relative reference against) -- a stale `baseState` snapshot
      from an earlier round admitted against a base this campaign has since
      moved on from. When `state/working-state.json` itself cannot be read
      or identity-verified, that is counted as a problem too (an "unknown"
      current state can never be treated as "matches").
    """
    core = mods["core"]
    workspaces_mod = mods["workspaces"]
    envelope = _load_json(report)
    found = _shape_problems(envelope, ("candidate", "baseState", "siteCapabilities"))
    if found:
        return [_emit_count("tc_request_invalid_count", len(found))], found
    candidate = envelope["candidate"]
    base_state = envelope["baseState"]
    site_capabilities = envelope["siteCapabilities"]

    _verify_identity(base_state, "design-state", core)
    _verify_design_state_refs(base_state, workspace, core)

    if "workPackages" in envelope:
        # A second, top-level copy -- `prepare-workers` refuses this outright
        # (ambiguous-plan); the Reader must not report zero problems for it.
        found.append("workPackages: a top-level copy is forbidden; keep exactly one copy, under candidate.workPackages")

    working_state_id = None
    try:
        working_state = _load_json(Path(workspace) / "state" / "working-state.json")
        _verify_identity(working_state, "design-state", core)
        working_state_id = working_state.get("id")
    except (ValueError, OSError):
        working_state_id = None
    if working_state_id is None:
        found.append("baseState: state/working-state.json is missing or unreadable, so baseState cannot be shown current")
    elif base_state.get("id") != working_state_id:
        found.append(f"baseState: id {base_state.get('id')!r} is not the id {working_state_id!r} of "
                     "state/working-state.json; copy the current state/working-state.json unchanged")

    work_packages = candidate.get("workPackages")
    if not isinstance(work_packages, dict):
        found.append(f"candidate.workPackages: must be an object {{w01, w02, w03}}, got {type(work_packages).__name__}")
        work_packages = {}
    for task_id in ("w01", "w02", "w03"):
        package = work_packages.get(task_id)
        where = f"candidate.workPackages.{task_id}"
        if not isinstance(package, dict):
            found.append(f"{where}: missing work package; required format: one object per slot w01, w02 and w03, "
                         "as in knowledge example-campaign-plan.md")
            continue
        found += _work_package_problems(package, base_state, site_capabilities, workspaces_mod, (where, ""))
        found += _edit_domain_problems(package, base_state, workspace, (where, ""))

    reason = candidate.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        found.append(f"candidate.reason: must be a non-empty string, got {reason!r}")

    return [_emit_count("tc_request_invalid_count", len(found))], found


_PLAN_FIELD_OF = (
    (re.compile(r"^plan must be"), None),
    (re.compile(r"^plan\.baseStateId\b"), "baseStateId"),
    (re.compile(r"^batchId\b"), "batchId"),
    (re.compile(r"^reason\b"), "reason"),
    (re.compile(r"^select\b"), "select"),
    (re.compile(r"^deferred\b"), "deferred"),
    (re.compile(r"^plan leaves a conflict"), "select"),
    (re.compile(r"^(resolution|revise|revisedContribution|contribution|conflictKey)\b"), "resolutions"),
)


def _integration_plan(report, workspace, extra, mods):
    """`integration-plan` reviewed against its `composition-facts`.

    Envelope::

        {"plan": {...unstamped or stamped "integration-plan" fields...},
         "facts": {...a stamped "composition-facts" artifact...}}

    `integration._collect_plan_problems(plan, facts)` is the one validator
    (`plan_invalid_count` is its length); `facts` is schema/id-verified first.
    """
    core = mods["core"]
    integration_mod = mods["integration"]
    envelope = _load_json(report)
    found = _shape_problems(envelope, ("plan", "facts"))
    if found:
        return [
            _emit_count("tc_request_invalid_count", len(found)),
            _emit("tc_selected_contribution_count", "count", core.unknown("the integration-plan document has no plan object")),
        ], found
    plan = envelope["plan"]
    facts = envelope["facts"]

    _verify_identity(facts, "composition-facts", core)

    select = plan.get("select")
    for message in integration_mod._collect_plan_problems(plan, facts):
        field = "plan"
        for pattern, name in _PLAN_FIELD_OF:
            if pattern.match(message):
                field = f"plan.{name}" if name else "plan"
                break
        hint = "; copy facts.baseStateId" if field == "plan.baseStateId" else ""
        found.append(f"{field}: {message}{hint}")
    selected = (_emit_count("tc_selected_contribution_count", len(select)) if isinstance(select, list)
                else _emit("tc_selected_contribution_count", "count", core.unknown("plan.select is not a list")))
    return [_emit_count("tc_request_invalid_count", len(found)), selected], found


def _read_worker_result(report, workspace, expected_task_id, mods):
    """A sealed `contribution` artifact (one worker slot's research result)."""
    core = mods["core"]
    obj = _load_json(report)
    _verify_identity(obj, "contribution", core)
    if expected_task_id is not None and obj.get("taskId") != expected_task_id:
        raise ValueError(f"contribution.taskId must be {expected_task_id!r}, got {obj.get('taskId')!r}")

    script = obj.get("script")
    if script is not None:
        if not _has_keys(script, ("path", "sha256")):
            raise ValueError("contribution.script must be {path, sha256} or null")
        _require_file(workspace, script["path"], script["sha256"], core, "contribution.script")

    predicted = obj.get("predicted")
    predicted = predicted if isinstance(predicted, dict) else {}
    missing = core.unknown("not reported in predicted")
    return [
        _emit("tc_xtop_setup_wns_ns", "ns", predicted.get("xtopSetupWns", missing), mode="setup"),
        _emit("tc_xtop_hold_wns_ns", "ns", predicted.get("xtopHoldWns", missing), mode="hold"),
        _emit("tc_presta_setup_wns_ns", "ns", predicted.get("prestaSetupWns", missing), mode="setup"),
        _emit("tc_presta_hold_wns_ns", "ns", predicted.get("prestaHoldWns", missing), mode="hold"),
    ]


def _read_contribution_index(report, workspace, extra, mods):
    """The collect tool's aggregation of every sealed Contribution + pending research.

    Envelope (no existing `atcs.*` "contributionIndex" kind owns this shape)::

        {"contributions": [<full "contribution" artifact>, ...], "pending": [<opaque id>, ...]}

    Every embedded contribution is independently schema/id-checked here — an
    aggregator that quietly re-packaged a tampered contribution is caught the
    same as a directly-tampered single artifact.
    """
    core = mods["core"]
    envelope = _load_json(report)
    if not isinstance(envelope, dict):
        raise ValueError("contribution-index must be a JSON object")
    contributions = envelope.get("contributions")
    pending = envelope.get("pending")
    if not isinstance(contributions, list):
        raise ValueError("contribution-index.contributions must be a list")
    if not isinstance(pending, list):
        raise ValueError("contribution-index.pending must be a list")

    ready = 0
    for entry in contributions:
        _verify_identity(entry, "contribution", core)
        if entry.get("admissible") is True and entry.get("kind") != "no-fix":
            ready += 1

    return [
        _emit_count("tc_ready_contribution_count", ready),
        _emit_count("tc_pending_research_count", len(pending)),
    ]


def _read_composition_facts(report, workspace, extra, mods):
    core = mods["core"]
    obj = _load_json(report)
    _verify_identity(obj, "composition-facts", core)
    conflicts = obj.get("conflicts")
    if not isinstance(conflicts, list):
        raise ValueError("composition-facts.conflicts must be a list")
    count = obj.get("unresolvedCount")
    if isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise ValueError("composition-facts.unresolvedCount must be a non-negative integer")
    if count > len(conflicts):
        raise ValueError("composition-facts.unresolvedCount exceeds len(conflicts)")
    return [_emit_count("tc_unresolved_conflict_count", count)]


def _read_integration_state(report, workspace, extra, mods):
    """I3 (final review): `tc_replay_mismatch_count` is only ever a known count when
    every one of this batch's steps was actually verified against its expected delta
    -- a `pending` step (never replayed at all, e.g. the run stopped at an earlier
    failure), a `failed` step (its own replay errored) or an `unknownReceipts` entry
    (a receipt this Reader cannot even attribute to a real step) each mean at least
    one step's true mismatch status was never established. Reporting a known count
    while any of those is non-empty would silently claim more was verified than
    actually was."""
    core = mods["core"]
    obj = _load_json(report)
    _verify_identity(obj, "integration-state", core)
    replay_mismatch = obj.get("replayMismatch")
    out_of_scope = obj.get("outOfScope")
    pending = obj.get("pending")
    failed = obj.get("failed")
    unknown_receipts = obj.get("unknownReceipts")
    if not isinstance(replay_mismatch, list):
        raise ValueError("integration-state.replayMismatch must be a list")
    if not isinstance(out_of_scope, list):
        raise ValueError("integration-state.outOfScope must be a list")
    if not isinstance(pending, list):
        raise ValueError("integration-state.pending must be a list")
    if not isinstance(failed, list):
        raise ValueError("integration-state.failed must be a list")
    if not isinstance(unknown_receipts, list):
        raise ValueError("integration-state.unknownReceipts must be a list")

    if pending or failed or unknown_receipts:
        replay_mismatch_value = _emit(
            "tc_replay_mismatch_count", "count",
            core.unknown(
                f"{len(pending)} pending, {len(failed)} failed, {len(unknown_receipts)} unknown-receipt "
                "step(s) were never verified against their expected delta"
            ),
        )
    else:
        replay_mismatch_value = _emit_count("tc_replay_mismatch_count", len(replay_mismatch))
    return [
        replay_mismatch_value,
        _emit_count("tc_out_of_scope_edit_count", len(out_of_scope)),
    ]


def _read_precheck_evidence(report, workspace, extra, mods):
    """A stamped `atcs.precheck-evidence/1` artifact
    (`atcs.verification.precheck_evidence(merge_commit, spef_net_names_path)`):
    `{"mergeCommitId", "newNets": [...], "spefNetNames": {"path", "sha256"}}`.
    No envelope — this is a real stamped artifact as of this task's review
    round, schema/id-checked like any other.

    The SPEF net-name source is re-hashed here and re-parsed independently;
    a *present-but-changed* source is a hard failure (never silently treated
    as "unreadable" — that would let a tampered source quietly relax the
    qualification it was supposed to prove). A genuinely *missing* source
    file is `presta_qualification`'s own "the net-name list could not be
    read" case (`spef_net_names=None`, an `unknown` count) — a materially
    different fact from a present file whose hash no longer matches.
    """
    core = mods["core"]
    verification_mod = mods["verification"]
    obj = _load_json(report)
    _verify_identity(obj, "precheck-evidence", core)

    new_nets = obj.get("newNets")
    if not isinstance(new_nets, list) or not all(isinstance(net, str) for net in new_nets):
        raise ValueError("precheck-evidence.newNets must be a list of strings")

    source = obj.get("spefNetNames")
    if not _has_keys(source, ("path", "sha256")):
        raise ValueError("precheck-evidence.spefNetNames must be {path, sha256}")

    resolved = _safe_join(workspace, source["path"], "precheck-evidence.spefNetNames")
    if resolved.is_symlink() or not resolved.is_file():
        spef_net_names = None  # presta_qualification's own "could not be read" case
    else:
        if core.file_sha256(resolved) != source["sha256"]:
            raise ValueError("precheck-evidence.spefNetNames source sha256 mismatch")
        spef_net_names = [
            line.strip() for line in resolved.read_text(encoding="utf-8").splitlines() if line.strip()
        ]

    result = verification_mod.presta_qualification(new_nets, spef_net_names)
    return [_emit("tc_unqualified_rc_net_count", "count", result["count"])]


_EVALUATION_FIELDS = (
    ("tc_final_setup_wns_ns", "finalSetupWns", "ns", "setup"),
    ("tc_final_hold_wns_ns", "finalHoldWns", "ns", "hold"),
    ("tc_missing_required_check_count", "missingRequiredCheckCount", "count", None),
    ("tc_final_identity_error_count", "finalIdentityErrorCount", "count", None),
    ("tc_applicable_constraint_failure_count", "constraintFailureCount", "count", None),
    ("tc_applicable_constraint_unknown_count", "constraintUnknownCount", "count", None),
    ("tc_fixed_check_count", "fixedCheckCount", "count", None),
    ("tc_missing_prior_check_count", "missingPriorCheckCount", "count", None),
)


def _read_evaluation(report, workspace, extra, mods):
    core = mods["core"]
    obj = _load_json(report)
    _verify_identity(obj, "evaluation", core)
    missing = core.unknown("missing from evaluation artifact")
    values = []
    for type_name, field, unit, mode in _EVALUATION_FIELDS:
        values.append(_emit(type_name, unit, obj.get(field, missing), mode=mode))
    return values


def _read_acceptance_record(report, workspace, extra, mods):
    """Envelope: `{"acceptanceRecord": "<workspace-relative path>",
    "refreshLedger": "<workspace-relative path>"}` (controller decision,
    Task 13 review round 1 — both are paths, not embedded objects, and
    `tc_refresh_count` is read from `atcs.refresh`'s own ledger, never from
    `atcs.adoption`'s pointers `history`, which counts accepted publishes,
    not completed physical refreshes; see `atcs/refresh.py`'s module
    docstring).

    `acceptanceRecord` must resolve to a real, identity-verified
    `acceptance-record` artifact — this reader has nothing to report
    without it. `refreshLedger` may legitimately not exist yet (no physical
    refresh has completed for this Campaign), in which case
    `tc_refresh_count` is `unknown`; when it does exist it is identity-
    verified and `tc_refresh_count` is `known(0)` only for a verified,
    genuinely empty ledger.
    """
    core = mods["core"]
    envelope = _load_json(report)
    if not isinstance(envelope, dict):
        raise ValueError("acceptance-record envelope must be a JSON object")

    acceptance_rel = envelope.get("acceptanceRecord")
    ledger_rel = envelope.get("refreshLedger")
    if not isinstance(acceptance_rel, str) or not acceptance_rel:
        raise ValueError("envelope.acceptanceRecord must be a non-empty workspace-relative path")
    if not isinstance(ledger_rel, str) or not ledger_rel:
        raise ValueError("envelope.refreshLedger must be a non-empty workspace-relative path")

    acceptance_path = _safe_join(workspace, acceptance_rel, "envelope.acceptanceRecord")
    obj = _load_json(acceptance_path)
    _verify_identity(obj, "acceptance-record", core)
    ready = obj.get("acceptedArtifactReady", core.unknown("missing from acceptance-record artifact"))

    ledger_path = _safe_join(workspace, ledger_rel, "envelope.refreshLedger")
    if ledger_path.is_symlink() or not ledger_path.is_file():
        refresh_value = _emit("tc_refresh_count", "count", core.unknown("refresh ledger not found in workspace"))
    else:
        ledger = _load_json(ledger_path)
        _verify_identity(ledger, "refresh-ledger", core)
        entries = ledger.get("entries")
        if not isinstance(entries, list):
            raise ValueError("refresh-ledger.entries must be a list")
        refresh_value = _emit_count("tc_refresh_count", len(entries))

    return [_emit("tc_accepted_artifact_ready", "count", ready), refresh_value]


_REFRESH_LEDGER_REL = "state/refresh-ledger.json"
_STA_RECEIPT_REL = "state/sta.json"
_STA_ARCHIVE_GLOB = "implementations/*/sta.json"


def _refresh_ledger_entry_count(ledger_path, core):
    """Entry count of the identity-verified ledger at `ledger_path`, or the reason it is not one."""
    try:
        ledger = _load_json(ledger_path)
        _verify_identity(ledger, "refresh-ledger", core)
    except (OSError, ValueError) as exc:
        return None, f"refresh ledger {_REFRESH_LEDGER_REL} cannot be verified: {exc}"
    entries = ledger.get("entries")
    if not isinstance(entries, list):
        return None, f"refresh ledger {_REFRESH_LEDGER_REL}: entries is not a list"
    merge_ids = []
    for entry in entries:
        if not isinstance(entry, dict):
            return None, f"refresh ledger {_REFRESH_LEDGER_REL}: an entry is not an object"
        for key in ("mergeCommitId", "designStateId"):
            if not isinstance(entry.get(key), str) or not entry[key]:
                return None, f"refresh ledger {_REFRESH_LEDGER_REL}: an entry has no {key}"
        merge_ids.append(entry["mergeCommitId"])
    if len(set(merge_ids)) != len(merge_ids):
        return None, f"refresh ledger {_REFRESH_LEDGER_REL}: a merge commit is recorded twice"
    return len(entries), None


def _read_refresh_budget(report, workspace, extra, mods):
    """`tc_refreshes_completed`: completed full physical refreshes, read right before one more.

    Issue #63: every Explore revisit consumes a Harness generation whether or not it refreshes
    anything, so the Pack caps Innovus/StarRC/PrimeTime refreshes itself -- the `refresh-budget`
    rule holds this count below the Run's Goal value `max_physical_refreshes` at the Judges
    `check-refresh-budget` (before `implement`) and `check-refresh-budget-apr` (before
    `apr-prepare`). The graph reads this afresh right before each of them, because a Judge takes a
    type's latest reading Run-wide and `sta` can record a refresh with no later reading of it.

    REPORT is the stamped `design-state` at state/working-state.json, identity-checked (never its
    file references: this reading does not use them). It is only the anchor: the Harness refuses a
    missing report, and `refreshLedger` (state/refresh-ledger.json) does not exist before the first
    refresh, so it cannot be the report. The count comes from that ledger at its fixed workspace
    path (`atcs_cli._paths`), through the same `_load_json`/`_verify_identity` checks the
    acceptance-record reader applies to it:

    - ledger absent, no STA receipt (state/sta.json, nor its archive
      implementations/<mergeId>/sta.json): `known(0)` -- `atcs.refresh.load_ledger`'s own reading
      of a ledger never written. `sta` records the ledger entry before its receipt and archive are
      written, so no receipt means no refresh completed. An `unknown` here would stop the Run
      before its first refresh.
    - ledger absent beside an STA receipt or archive: `unknown` (the ledger was lost, not never
      written).
    - ledger present: `known(n)` for an identity-verified ledger of `n` well-formed entries with
      distinct merge commits; `unknown` for a corrupt, tampered, malformed or symlinked one. Fail
      closed: the Judge is UNDETERMINED and the Run waits for a person, never a guessed count.

    Why a new type and not `tc_refresh_count`: the acceptance-record reader reports a missing
    ledger as `unknown` unconditionally and refuses a tampered one outright; this reader must
    report `known(0)` for a ledger never written and `unknown` for a tampered one. Two readers
    with different absence rules under one type name would let whichever read last decide.
    """
    core = mods["core"]
    refresh_mod = mods["refresh"]
    anchor = _load_json(report)
    _verify_identity(anchor, "design-state", core)

    root = Path(workspace)
    ledger_path = root / _REFRESH_LEDGER_REL
    if ledger_path.is_symlink():
        measure = core.unknown(f"refresh ledger {_REFRESH_LEDGER_REL} is a symlink")
    elif not ledger_path.exists():
        receipts = [_STA_RECEIPT_REL] if (root / _STA_RECEIPT_REL).exists() else []
        receipts += sorted(str(p.relative_to(root)) for p in root.glob(_STA_ARCHIVE_GLOB))
        if receipts:
            measure = core.unknown(
                f"refresh ledger {_REFRESH_LEDGER_REL} is missing although {receipts[0]} records a completed STA"
            )
        else:
            measure = core.known(len(refresh_mod.load_ledger(ledger_path)["entries"]))
    else:
        count, reason = _refresh_ledger_entry_count(ledger_path, core)
        measure = core.unknown(reason) if reason is not None else core.known(count)
    return [_emit("tc_refreshes_completed", "count", measure)]


_ACTION_CODES = {
    "observe": 1, "research": 2, "compose": 3, "revise": 4,
    "implement": 5, "earlier-apr": 6, "wait": 7, "goal-met": 8,
}
_NEXT_DECISION_REQUIRED_FIELDS = (
    "stateRef", "observationRef", "budgetRef", "question", "action",
    "targets", "reason", "falsifier", "costBasis", "requiredArtifacts",
)
_ID_SHAPE_RE = re.compile(r"^[0-9a-f]{20}$")
_APR_STAGES = ("place", "cts", "route", "postroute")


def _implement_batch_ready(workspace, mods):
    """True when a reconciled, unimplemented batch based on the CURRENT working state
    exists in `workspace`'s own state files (C2, final review): choosing `action ==
    "implement"` is only a real, actionable request when there is something left for
    `implement` to actually do.

    "Exists" is defined entirely from state files already on disk, mirroring
    the exact computation `atcs_cli._cmd_implement` itself performs before
    sealing a candidate:

    - `state/working-state.json`, `state/integration-state.json`, `state/
      replay-request.json`, `state/composition-facts.json` and `state/
      contributions-collected.json` must all exist and parse.
    - `composition-facts.json`'s and `replay-request.json`'s own
      `baseStateId` must both equal `working-state.json`'s own current `id`
      -- a reconciled batch built against an EARLIER working state (the
      campaign has since moved on, e.g. via `adopt`) is not a batch
      `implement` can honestly act on now.
    - The batch's own merge commit is re-derived, read-only, via
      `integration.seal_batch` (the exact pure computation `implement`
      itself performs) over those same files; any failure to do so (a
      malformed/inconsistent reconciliation) means no ready batch exists.
    - That merge commit must not already be the one recorded in `state/
      implement.json` (compared by id) -- a batch that was already
      implemented is not "unimplemented" any more, even though every file
      above still exists.

    Returns `False` (never raises) for any missing file, parse failure, or
    re-derivation failure -- this function only ever answers "is there
    real, current, unimplemented work for `implement`", never partial
    credit for a batch this Reader cannot fully verify.
    """
    workspace = Path(workspace)
    paths = {
        "working_state": workspace / "state" / "working-state.json",
        "integration_state": workspace / "state" / "integration-state.json",
        "replay_request": workspace / "state" / "replay-request.json",
        "facts": workspace / "state" / "composition-facts.json",
        "collected": workspace / "state" / "contributions-collected.json",
    }
    if not all(path.is_file() for path in paths.values()):
        return False
    try:
        working_state = _load_json(paths["working_state"])
        integration_state = _load_json(paths["integration_state"])
        replay_request = _load_json(paths["replay_request"])
        facts = _load_json(paths["facts"])
        collected = _load_json(paths["collected"])
    except ValueError:
        return False

    working_state_id = working_state.get("id") if isinstance(working_state, dict) else None
    if not working_state_id:
        return False
    if not isinstance(facts, dict) or facts.get("baseStateId") != working_state_id:
        return False
    if not isinstance(replay_request, dict) or replay_request.get("baseStateId") != working_state_id:
        return False

    contributions = collected.get("contributions") if isinstance(collected, dict) else None
    if not isinstance(contributions, list):
        return False

    try:
        merge_commit = mods["integration"].seal_batch(integration_state, replay_request, facts, contributions)
    except Exception:  # noqa: BLE001 -- any re-derivation failure means "no ready batch", fail-closed
        return False

    implement_path = workspace / "state" / "implement.json"
    if implement_path.is_file():
        try:
            implement = _load_json(implement_path)
        except ValueError:
            implement = {}
        if isinstance(implement, dict) and implement.get("mergeCommitId") == merge_commit.get("id"):
            return False  # already implemented -- not "unimplemented" any more

    return True


# Actions whose route reaches prepare-workers (research) or replay-prepare (compose, revise), both
# of which refuse an XTop context not bound to the current working state (stale-base).
_BATCH_ACTIONS = ("research", "compose", "revise")


def _stale_xtop_context_problems(workspace, action):
    """Dry path (slice 4): after a physical refresh is adopted, `state/xtop-context.json` still
    names the state `observe` last bound it to, and only `observe` rebinds it. A batch action
    on that context ends in prepare-workers or replay-prepare exiting 3 stale-base, so it is
    counted here with the way out. No context at all is left to those tools: a Site that
    declares no `xtopContext` cannot run a worker whatever is decided."""
    path = Path(workspace) / "state" / "xtop-context.json"
    if not path.exists():
        return []
    core = _atcs_modules(workspace)["core"]
    try:
        context = _load_json(path)
        _verify_identity(context, "xtop-context", core)
    except (ValueError, OSError) as error:
        return [f"action: {action} needs state/xtop-context.json bound to the working state, and it does "
                f"not verify ({error}); observe first"]
    try:
        working = _load_json(Path(workspace) / "state" / "working-state.json")
    except (ValueError, OSError):
        return []  # the stateRef check names an unreadable working state
    bound, current = context.get("designStateId"), working.get("id") if isinstance(working, dict) else None
    if current is None or bound == current:
        return []
    return [f"action: observe first: the XTop context is bound to {bound!r}, the working state is {current!r}; "
            f"{action} needs a context bound to the working state, which only observe writes"]


def _collect_next_decision_problems(obj, workspace):
    workspace = Path(workspace)
    problems = []
    if not isinstance(obj, dict):
        return ["next-decision must be a JSON object"]
    for key in _NEXT_DECISION_REQUIRED_FIELDS:
        if key not in obj:
            problems.append(f"missing field: {key}")

    action = obj.get("action")
    if "action" in obj and action not in _ACTION_CODES:
        problems.append(f"action must be one of {sorted(_ACTION_CODES)}, got {action!r}")
    if action == "earlier-apr":
        # Only this action needs a stage, so it is not in `_NEXT_DECISION_REQUIRED_FIELDS`. It must be
        # one `atcs_cli.APR_STAGES` knows: `apr-prepare` reads it from this same document.
        stage = obj.get("stage")
        if stage not in _APR_STAGES:
            problems.append(f"stage must be one of {list(_APR_STAGES)} when action is 'earlier-apr', got {stage!r}")
    if action == "implement" and not _implement_batch_ready(workspace, _atcs_modules(workspace)):
        problems.append(
            "action is 'implement' but no reconciled, unimplemented batch based on the current "
            "working state exists in workspace state files"
        )

    for ref_key in ("stateRef", "observationRef"):
        if ref_key not in obj:
            continue
        ref = obj.get(ref_key)
        if not isinstance(ref, str) or not _ID_SHAPE_RE.match(ref):
            problems.append(f"{ref_key} must be a 20-hex-char artifact id, got {ref!r}")
        elif _resolve_id_in_workspace(workspace, ref) is None:
            problems.append(f"{ref_key} {ref!r} does not resolve to any artifact in the workspace")
        elif ref_key == "stateRef":
            # Minor (final review): resolving to *some* artifact in the workspace was
            # never enough on its own -- a `stateRef` naming a stale, resolvable
            # artifact (an old baseline, a superseded candidate's own design-state)
            # used to pass this check just as well as one naming the actual current
            # working state. `next-decision`'s whole point is a decision about the
            # CURRENT campaign state, so `stateRef` must equal `state/working-
            # state.json`'s own current id, not merely resolve to *a* real id.
            try:
                working_state = _load_json(workspace / "state" / "working-state.json")
            except ValueError:
                working_state = None
            working_state_id = working_state.get("id") if isinstance(working_state, dict) else None
            if not working_state_id:
                problems.append("stateRef cannot be verified: state/working-state.json is missing or unreadable")
            elif ref != working_state_id:
                problems.append(
                    f"stateRef {ref!r} does not match state/working-state.json's own current id "
                    f"{working_state_id!r}"
                )

    if action in _BATCH_ACTIONS:
        problems += _stale_xtop_context_problems(workspace, action)

    if "budgetRef" in obj and (not isinstance(obj.get("budgetRef"), str) or not obj.get("budgetRef")):
        problems.append("budgetRef must be a non-empty string")
    if "targets" in obj and not isinstance(obj.get("targets"), list):
        problems.append("targets must be a list")
    if "requiredArtifacts" in obj and not isinstance(obj.get("requiredArtifacts"), list):
        problems.append("requiredArtifacts must be a list")

    return problems


def _next_decision(report, workspace, extra, mods):
    """`next-decision`, self-contained: reference resolvability is a workspace scan.

    `tc_next_action`/`tc_stop_required` are both derived from the *same*
    schema-valid `action` string, so `tc_next_action == 7` and
    `tc_stop_required == 1` are true together by construction (SPEC.md's
    Semantics section's consistency rule) — never computed on two
    independent paths that could disagree.
    """
    core = mods["core"]
    obj = _load_json(report)
    problems = _collect_next_decision_problems(obj, workspace)
    values = [_emit_count("tc_request_invalid_count", len(problems))]

    if problems:
        reason = "next-decision failed structural validation: " + "; ".join(problems)
        values.append(_emit("tc_next_action", "count", core.unknown(reason)))
        values.append(_emit("tc_stop_required", "count", core.unknown(reason)))
    else:
        code = _ACTION_CODES[obj["action"]]
        values.append(_emit_count("tc_next_action", code))
        values.append(_emit_count("tc_stop_required", 1 if code == _ACTION_CODES["wait"] else 0))
    return values, problems


_HANDLERS = {
    "readiness": lambda report, workspace, extra, mods: _read_readiness(report, workspace, extra, mods),
    "worker-result": lambda report, workspace, extra, mods: _read_worker_result(report, workspace, extra[0] if extra else None, mods),
    "contribution-index": lambda report, workspace, extra, mods: _read_contribution_index(report, workspace, extra, mods),
    "composition-facts": lambda report, workspace, extra, mods: _read_composition_facts(report, workspace, extra, mods),
    "integration-state": lambda report, workspace, extra, mods: _read_integration_state(report, workspace, extra, mods),
    "precheck-evidence": lambda report, workspace, extra, mods: _read_precheck_evidence(report, workspace, extra, mods),
    "evaluation": lambda report, workspace, extra, mods: _read_evaluation(report, workspace, extra, mods),
    "acceptance-record": lambda report, workspace, extra, mods: _read_acceptance_record(report, workspace, extra, mods),
    "refresh-budget": lambda report, workspace, extra, mods: _read_refresh_budget(report, workspace, extra, mods),
}

# Request kinds: each returns `(values, problems)`, its count being `len(problems)`.
_REQUEST_HANDLERS = {
    "observation-request": lambda report, workspace, extra, mods: _observation_request(report, workspace, extra, mods),
    "work-package": lambda report, workspace, extra, mods: _request_envelope(report, workspace, None, mods),
    "campaign-plan": lambda report, workspace, extra, mods: _campaign_plan(report, workspace, extra, mods),
    "worker-request": lambda report, workspace, extra, mods: _request_envelope(report, workspace, extra[0] if extra else None, mods),
    "integration-plan": lambda report, workspace, extra, mods: _integration_plan(report, workspace, extra, mods),
    "next-decision": lambda report, workspace, extra, mods: _next_decision(report, workspace, extra, mods),
}


def _read(kind, report, workspace, extra):
    """`(values, problems)`; `problems` is None for a kind that is not a request."""
    extra = extra or []
    mods = _atcs_modules(workspace) if kind in _HANDLERS or kind in _REQUEST_HANDLERS else None
    if kind in _REQUEST_HANDLERS:
        return _REQUEST_HANDLERS[kind](report, workspace, extra, mods)
    if kind in _HANDLERS:
        return _HANDLERS[kind](report, workspace, extra, mods), None
    raise ValueError(f"unknown reader kind: {kind!r}; known kinds: {sorted(set(_HANDLERS) | set(_REQUEST_HANDLERS))}")


def read(kind, report, workspace, extra=None):
    """Read `report` (kind `kind`) into a list of Harness value dicts. Never writes anything."""
    return _read(kind, report, workspace, extra)[0]


def problems(kind, report, workspace, slot=None):
    """Every problem the Reader finds in the request document `report`, one string each.

    The same list whose length is the kind's `tc_request_invalid_count`; each
    string starts with the field it is about. Never writes anything.
    """
    if kind not in _REQUEST_HANDLERS:
        raise ValueError(f"{kind!r} is not a request kind; request kinds: {sorted(_REQUEST_HANDLERS)}")
    return _read(kind, report, workspace, [slot] if slot else [])[1]


# ---------------------------------------------------------------------------
# Endpoint resolution (C22): `read-atcs.py resolve-instances WORKSPACE ENDPOINTS OUT`
# ---------------------------------------------------------------------------
#
# Every post-route Campaign rewrote this in model-authored Workshop code and got the same shapes
# wrong (failure catalogue C22). It lives here, beside the parser the Readers admit instances with,
# because this is the one Pack file the Harness ships to the Site (`hima-readers/<id>/`); a
# Workshop runs it from the copy shipped for the Run's first reader,
# `<workspace>/hima-readers/atcs-readiness/read-atcs.py` (knowledge endpoint-resolution.md).

# Leaf-cell output pins by name. A Liberty file would say it exactly; the resolver reads only the
# netlist, so a net whose driver pin is not named like this is reported unresolved, never guessed.
_OUTPUT_PIN_RE = re.compile(r"^(Z|ZN|Q|QN|Y|YN|CO|CON|S|SN|SO|O|OUT)\d*$")
_BIT_RE = re.compile(r"^(.*)\[(\d+)\]$")


def _spellings(name):
    """`name` first, then its other bus-bit spellings: `x[0]`, `x_0_` and `x_0` name one bit."""
    found = []
    for candidate in (
        name,
        re.sub(r"\[(\d+)\]", r"_\1_", name),
        re.sub(r"\[(\d+)\]$", r"_\1", re.sub(r"\[(\d+)\](?!$)", r"_\1_", name)),
        re.sub(r"_(\d+)_", r"[\1]", name),
        re.sub(r"_(\d+)$", r"[\1]", name),
    ):
        if candidate not in found:
            found.append(candidate)
    return found


def _path_segment(name):
    """One instance name as a path segment the Readers admit: escaped when it holds `/`."""
    return f"\\{name} " if "/" in name else name


def _net_driver(modules, module_name, net, prefix, depth=0):
    """The leaf cell pin driving `net` inside `module_name`, followed through output ports."""
    module = modules[module_name]
    where = "/".join(prefix) or module_name
    if depth > 64:
        return None, f"net {net!r} is driven through more than 64 module levels"
    if net in module["assigns"]:
        return _net_driver(modules, module_name, module["assigns"][net], prefix, depth + 1)
    bit = _BIT_RE.match(net)
    base, index = (bit.group(1), bit.group(2)) if bit else (net, None)
    drivers = []
    for instance, pins in module["conns"].items():
        kind = module["instances"].get(instance)
        for pin, expression in pins.items():
            if expression is None:
                continue
            if expression == net:
                inner = pin
            elif index is not None and expression == base:
                inner = f"{pin}[{index}]"  # a whole bus connected to a bus port
            else:
                continue
            if kind in modules:
                if modules[kind]["ports"].get(pin) == "output":
                    drivers.append((instance, kind, inner, True))
            elif _OUTPUT_PIN_RE.match(pin):
                drivers.append((instance, kind, pin, False))
    if not drivers:
        if module["ports"].get(base) == "input":
            if not prefix:
                return None, f"{net!r} is a primary port of top {module_name!r}; a port is not a cell to edit"
            return None, f"net {net!r} of {where} enters through an input port; it is driven outside {where}"
        return None, (f"net {net!r} of {where} has no driving cell pin named like an output "
                      f"({_OUTPUT_PIN_RE.pattern}); resolve it from the timing report's driver instead")
    if len(drivers) > 1:
        named = ", ".join(sorted(f"{instance}/{pin}" for instance, _, pin, _ in drivers))
        return None, f"net {net!r} of {where} has {len(drivers)} drivers ({named})"
    instance, kind, pin, through = drivers[0]
    path = prefix + [_path_segment(instance)]
    if through:
        return _net_driver(modules, kind, pin, path, depth + 1)
    return {"instance": "/".join(path), "cell": kind, "pin": pin, "via": "net-driver"}, None


def _walk_endpoint(modules, module_name, segments, prefix):
    module = modules.get(module_name)
    if module is None:
        return None, f"module {module_name!r} is not defined in the netlist"
    instances = module["instances"]
    for count in range(len(segments), 0, -1):  # longest first: a flattened `\u_a/u_b/reg_0_ ` is one name
        joined = "/".join(segments[:count])
        for spelling in _spellings(joined):
            if spelling not in instances:
                continue
            kind = instances[spelling]
            path = prefix + [_path_segment(spelling)]
            rest = segments[count:]
            if kind in modules:
                if not rest:
                    return None, f"{'/'.join(path)} is a module instance, not a leaf cell (module {kind!r})"
                if len(rest) == 1 and rest[0] not in modules[kind]["instances"]:
                    return _net_driver(modules, kind, rest[0], path)  # a hierarchical pin or a net
                return _walk_endpoint(modules, kind, rest, path)
            if not rest:
                return {"instance": "/".join(path), "cell": kind, "pin": None, "via": "instance"}, None
            if len(rest) == 1:
                return {"instance": "/".join(path), "cell": kind, "pin": rest[0], "via": "pin"}, None
            return None, f"{'/'.join(path)} is a leaf cell ({kind}); {'/'.join(rest)!r} below it is not one pin"
    name = segments[0]
    if len(segments) == 1:
        bit = _BIT_RE.match(name)
        base = bit.group(1) if bit else name
        if not prefix and base in module["ports"]:
            return None, f"{name!r} is a primary port of top {module_name!r}; a port is not a cell to edit"
        return _net_driver(modules, module_name, name, prefix)
    where = "/".join(prefix) or "top"
    return None, (f"{name!r} is not an instance of module {module_name!r} ({where}) under any spelling "
                  f"{_spellings(name)}")


def resolve_endpoints(workspace, endpoints):
    """Resolve PT endpoint names against the working design state's sha-verified netlist.

    Each endpoint (an instance, `instance/pin`, a net, or a port, hierarchical from top) becomes
    a leaf cell by full path -- the form the plan and worker-request Readers admit -- or is
    reported unresolved with its reason. Bus bits match under the `x[0]`, `x_0_` and `x_0`
    spellings; a flattened escaped name matches as one segment; a net resolves to its one
    driving cell pin through port connections. Never writes anything.
    """
    core = _atcs_modules(workspace)["core"]
    working_state = _load_json(Path(workspace) / "state" / "working-state.json")
    _verify_identity(working_state, "design-state", core)
    netlist = working_state.get("netlist")
    if not _has_keys(netlist, ("path", "sha256")):
        raise ValueError("design-state.netlist must be {path, sha256}")
    _require_file(workspace, netlist["path"], netlist["sha256"], core, "design-state.netlist")
    netlist_path = str(_safe_join(workspace, netlist["path"], "design-state.netlist"))
    if netlist_path not in _netlist_index_cache:
        _netlist_index_cache[netlist_path] = _parse_netlist(netlist_path, connections=True)
    modules = _netlist_index_cache[netlist_path]
    top = working_state.get("top")
    resolved, unresolved = [], []
    for endpoint in endpoints:
        if not isinstance(endpoint, str) or not endpoint.strip():
            unresolved.append({"endpoint": endpoint, "unresolved": "an endpoint must be a non-empty string"})
            continue
        name = endpoint.strip()
        segments = _split_instance_path(name)
        if segments is None or any(segment == "" for segment in segments):
            segments = [segment for segment in name.split("/") if segment]
        row, why = _walk_endpoint(modules, top, segments, [])
        if row is None:
            unresolved.append({"endpoint": endpoint, "unresolved": why})
        else:
            resolved.append(dict(row, endpoint=endpoint))
    return {"designStateId": working_state.get("id"), "top": top,
            "netlist": {"path": netlist["path"], "sha256": netlist["sha256"]},
            "resolved": resolved, "unresolved": unresolved}


def _resolve_instances_main(argv):
    if len(argv) != 3:
        raise SystemExit("usage: read-atcs.py resolve-instances WORKSPACE ENDPOINTS_JSON OUT_JSON")
    workspace, endpoints_path, out = argv
    endpoints = _load_json(endpoints_path)
    if isinstance(endpoints, dict):
        endpoints = endpoints.get("endpoints")
    if not isinstance(endpoints, list):
        raise ValueError("ENDPOINTS_JSON must be a list of endpoint names or {\"endpoints\": [...]}")
    answer = resolve_endpoints(workspace, endpoints)
    Path(out).write_text(json.dumps(answer, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "resolve-instances":
        _resolve_instances_main(sys.argv[2:])
        return
    if len(sys.argv) < 5:
        raise SystemExit("usage: read-atcs.py <kind> REPORT OUT WORKSPACE [extra...]")
    kind, report, out, workspace = sys.argv[1:5]
    extra = sys.argv[5:]
    try:
        values, found = _read(kind, report, workspace, extra)
    except Exception as error:
        if kind in _REQUEST_HANDLERS:
            _write_problems_file(report, [], refused=f"{type(error).__name__}: {error}")
        raise
    if found is not None:
        # Beside the document, before OUT: the Judge that reads OUT's count finds the
        # owner's explanation of it already in place (`<output>Problems`, contract.yml).
        _write_problems_file(report, found)
    document = json.dumps({"values": values}, sort_keys=True, allow_nan=False) + "\n"
    Path(out).write_text(document, encoding="utf-8")


if __name__ == "__main__":
    main()
