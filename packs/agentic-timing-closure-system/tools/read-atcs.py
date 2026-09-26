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
#   contribution-index     {"contributions": [<full stamped "contribution" artifact>, ...],
#                            "pending": [<opaque pending-research id>, ...]}
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


def _read_observation_request(report, workspace, extra, mods):
    """A raw `observationRequest` candidate (diagnose-and-observe Workshop output), self-contained.

    No existing `atcs.*` module owns this shape's validation (only
    `capture`'s own `query_spec` binding, `atcs/state.py`'s module
    docstring), so this handler is this script's own structural check.
    """
    core = mods["core"]
    obj = _load_json(report)
    problems = []
    if not isinstance(obj, dict):
        problems.append("observation request must be a JSON object")
        obj = {}
    for key in ("designStateId", "precision", "requiredScenarios", "maxPaths"):
        if key not in obj:
            problems.append(f"missing field: {key}")
    if "precision" in obj and obj.get("precision") not in ("gba", "pba"):
        problems.append(f"precision must be 'gba' or 'pba', got {obj.get('precision')!r}")
    if "requiredScenarios" in obj:
        required = obj.get("requiredScenarios")
        if not isinstance(required, list) or not required or not all(isinstance(s, str) and s for s in required):
            problems.append("requiredScenarios must be a non-empty list of non-empty strings")
    if "maxPaths" in obj:
        max_paths = obj.get("maxPaths")
        if isinstance(max_paths, bool) or not isinstance(max_paths, int) or max_paths <= 0:
            problems.append("maxPaths must be a positive integer")
    if "designStateId" in obj:
        state_id = obj.get("designStateId")
        if not isinstance(state_id, str) or not re.fullmatch(r"[0-9a-f]{20}", state_id):
            problems.append("designStateId must be a 20-hex-char design-state id")
    return [_emit_count("tc_request_invalid_count", len(problems))]


def _read_request_envelope(report, workspace, expected_task_id, mods):
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
    request's `tc_request_invalid_count` to 0. `workspaces.request_invalid_
    count` (never `validate_work_package`, which raises) is the one helper
    this handler defers to for the actual count, per this task's brief.
    """
    core = mods["core"]
    workspaces_mod = mods["workspaces"]
    envelope = _load_json(report)
    if not isinstance(envelope, dict):
        raise ValueError("request envelope must be a JSON object")
    candidate = envelope.get("candidate")
    base_state = envelope.get("baseState")
    site_capabilities = envelope.get("siteCapabilities")
    if not isinstance(candidate, dict):
        raise ValueError("envelope.candidate must be a JSON object")
    if not isinstance(base_state, dict):
        raise ValueError("envelope.baseState must be a JSON object")
    if not isinstance(site_capabilities, dict):
        raise ValueError("envelope.siteCapabilities must be a JSON object")

    _verify_identity(base_state, "design-state", core)
    _verify_design_state_refs(base_state, workspace, core)

    if expected_task_id is not None and candidate.get("taskId") != expected_task_id:
        raise ValueError(f"candidate.taskId must be {expected_task_id!r}, got {candidate.get('taskId')!r}")

    count = workspaces_mod.request_invalid_count(candidate, base_state, site_capabilities)
    return [_emit_count("tc_request_invalid_count", count)]


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


def _read_integration_plan(report, workspace, extra, mods):
    """`integration-plan` reviewed against its `composition-facts`.

    Envelope::

        {"plan": {...unstamped or stamped "integration-plan" fields...},
         "facts": {...a stamped "composition-facts" artifact...}}

    `integration.plan_invalid_count(plan, facts)` is the exact helper this
    task's brief names; `facts` is schema/id-verified first.
    """
    core = mods["core"]
    integration_mod = mods["integration"]
    envelope = _load_json(report)
    if not isinstance(envelope, dict):
        raise ValueError("integration-plan review envelope must be a JSON object")
    plan = envelope.get("plan")
    facts = envelope.get("facts")
    if not isinstance(plan, dict):
        raise ValueError("envelope.plan must be a JSON object")
    if not isinstance(facts, dict):
        raise ValueError("envelope.facts must be a JSON object")

    _verify_identity(facts, "composition-facts", core)

    select = plan.get("select")
    if not isinstance(select, list):
        raise ValueError("integration-plan.select must be a list")

    count = integration_mod.plan_invalid_count(plan, facts)
    return [
        _emit_count("tc_request_invalid_count", count),
        _emit_count("tc_selected_contribution_count", len(select)),
    ]


def _read_integration_state(report, workspace, extra, mods):
    core = mods["core"]
    obj = _load_json(report)
    _verify_identity(obj, "integration-state", core)
    replay_mismatch = obj.get("replayMismatch")
    out_of_scope = obj.get("outOfScope")
    if not isinstance(replay_mismatch, list):
        raise ValueError("integration-state.replayMismatch must be a list")
    if not isinstance(out_of_scope, list):
        raise ValueError("integration-state.outOfScope must be a list")
    return [
        _emit_count("tc_replay_mismatch_count", len(replay_mismatch)),
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


_ACTION_CODES = {
    "observe": 1, "research": 2, "compose": 3, "revise": 4,
    "implement": 5, "earlier-apr": 6, "wait": 7, "goal-met": 8,
}
_NEXT_DECISION_REQUIRED_FIELDS = (
    "stateRef", "observationRef", "budgetRef", "question", "action",
    "targets", "reason", "falsifier", "costBasis", "requiredArtifacts",
)
_ID_SHAPE_RE = re.compile(r"^[0-9a-f]{20}$")


def _collect_next_decision_problems(obj, workspace):
    problems = []
    if not isinstance(obj, dict):
        return ["next-decision must be a JSON object"]
    for key in _NEXT_DECISION_REQUIRED_FIELDS:
        if key not in obj:
            problems.append(f"missing field: {key}")

    action = obj.get("action")
    if "action" in obj and action not in _ACTION_CODES:
        problems.append(f"action must be one of {sorted(_ACTION_CODES)}, got {action!r}")

    for ref_key in ("stateRef", "observationRef"):
        if ref_key not in obj:
            continue
        ref = obj.get(ref_key)
        if not isinstance(ref, str) or not _ID_SHAPE_RE.match(ref):
            problems.append(f"{ref_key} must be a 20-hex-char artifact id, got {ref!r}")
        elif _resolve_id_in_workspace(workspace, ref) is None:
            problems.append(f"{ref_key} {ref!r} does not resolve to any artifact in the workspace")

    if "budgetRef" in obj and (not isinstance(obj.get("budgetRef"), str) or not obj.get("budgetRef")):
        problems.append("budgetRef must be a non-empty string")
    if "targets" in obj and not isinstance(obj.get("targets"), list):
        problems.append("targets must be a list")
    if "requiredArtifacts" in obj and not isinstance(obj.get("requiredArtifacts"), list):
        problems.append("requiredArtifacts must be a list")

    return problems


def _read_next_decision(report, workspace, extra, mods):
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
    return values


_HANDLERS = {
    "readiness": lambda report, workspace, extra, mods: _read_readiness(report, workspace, extra, mods),
    "observation-request": lambda report, workspace, extra, mods: _read_observation_request(report, workspace, extra, mods),
    "work-package": lambda report, workspace, extra, mods: _read_request_envelope(report, workspace, None, mods),
    "worker-request": lambda report, workspace, extra, mods: _read_request_envelope(report, workspace, extra[0] if extra else None, mods),
    "worker-result": lambda report, workspace, extra, mods: _read_worker_result(report, workspace, extra[0] if extra else None, mods),
    "contribution-index": lambda report, workspace, extra, mods: _read_contribution_index(report, workspace, extra, mods),
    "composition-facts": lambda report, workspace, extra, mods: _read_composition_facts(report, workspace, extra, mods),
    "integration-plan": lambda report, workspace, extra, mods: _read_integration_plan(report, workspace, extra, mods),
    "integration-state": lambda report, workspace, extra, mods: _read_integration_state(report, workspace, extra, mods),
    "precheck-evidence": lambda report, workspace, extra, mods: _read_precheck_evidence(report, workspace, extra, mods),
    "evaluation": lambda report, workspace, extra, mods: _read_evaluation(report, workspace, extra, mods),
    "acceptance-record": lambda report, workspace, extra, mods: _read_acceptance_record(report, workspace, extra, mods),
    "next-decision": lambda report, workspace, extra, mods: _read_next_decision(report, workspace, extra, mods),
}


def read(kind, report, workspace, extra=None):
    """Read `report` (kind `kind`) into a list of Harness value dicts. Never writes anything."""
    extra = extra or []
    handler = _HANDLERS.get(kind)
    if handler is None:
        raise ValueError(f"unknown reader kind: {kind!r}; known kinds: {sorted(_HANDLERS)}")
    mods = _atcs_modules(workspace)
    return handler(report, workspace, extra, mods)


def main():
    if len(sys.argv) < 5:
        raise SystemExit("usage: read-atcs.py <kind> REPORT OUT WORKSPACE [extra...]")
    kind, report, out, workspace = sys.argv[1:5]
    extra = sys.argv[5:]
    values = read(kind, report, workspace, extra)
    document = json.dumps({"values": values}, sort_keys=True, allow_nan=False) + "\n"
    Path(out).write_text(document, encoding="utf-8")


if __name__ == "__main__":
    main()
