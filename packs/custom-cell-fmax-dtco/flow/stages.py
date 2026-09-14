#!/usr/bin/env python3
"""Executable PLS-25 domain stages for one private custom Cell Fmax Campaign workspace.

Every stage reads Site-private ``flow/inputs.json`` and writes one evidence record.
The adapters invoke real dependency CLIs. Tests may bind explicit synthetic fixtures,
which remain labelled by the required ``evidenceClass`` input.
"""
from __future__ import annotations

import glob
import difflib
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
DOMAIN = HERE / "domain"
sys.path.insert(0, str(DOMAIN))

from cell_need_miner.generator_contract import validate_generation_request  # noqa: E402
from _cell_adoption_projection import project_texts  # noqa: E402
from _generation_projection import (  # noqa: E402
    expected_generation_jobs,
    spice_netlist_is_structural,
)
from mining_strategy_contract import STRATEGIES  # noqa: E402


SCHEMA = "custom-cell-fmax-stage/1"
ROUTES = tuple(STRATEGIES)
STAGES = (
    "mine", "merge", "generate", "layout", "characterize", "compile",
    "foundry-synth", "custom-synth", "adoption", "pnr-foundry",
    "pnr-generated", "verify", "compare",
)
BUILDABLE_ROUTES = {"fusion", "cluster_compose", "boolean_synthesis"}


class Rejected(RuntimeError):
    pass


class ToolFailure(RuntimeError):
    pass


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: " + key)
        result[key] = value
    return result


def read_json(path):
    try:
        return json.loads(Path(path).read_text(), object_pairs_hook=unique)
    except (OSError, ValueError) as exc:
        raise Rejected("cannot read %s: %s" % (path, exc)) from exc


def sha_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def sha_file(path):
    return sha_bytes(Path(path).read_bytes())


def file_ref(path, workspace, role, source_type):
    at = Path(path).resolve()
    if not at.is_file() or at.is_symlink():
        raise Rejected("%s is missing or is a symlink: %s" % (role, at))
    raw = at.read_bytes()
    try:
        named = str(at.relative_to(workspace))
    except ValueError:
        named = str(at)
    return {
        "role": role,
        "path": named,
        "sha256": sha_bytes(raw),
        "bytes": len(raw),
        "sourceType": source_type,
    }


def checked_ref(ref, workspace, role=None):
    if not isinstance(ref, dict) or (role is not None and ref.get("role") != role):
        raise Rejected("missing artifact reference%s" % (" " + role if role else ""))
    raw_path = ref.get("path")
    if not isinstance(raw_path, str) or not raw_path:
        raise Rejected("artifact has no path")
    path = Path(raw_path)
    at = (workspace / path).resolve() if not path.is_absolute() else path.resolve()
    if not at.is_file() or at.is_symlink():
        raise Rejected("artifact is missing or is a symlink: %s" % at)
    raw = at.read_bytes()
    if sha_bytes(raw) != ref.get("sha256") or len(raw) != ref.get("bytes"):
        raise Rejected("artifact identity mismatch: %s" % at)
    return at


def checkpoint_path(workspace, value, what):
    raw = Path(value)
    candidate = raw if raw.is_absolute() else workspace / raw
    lexical = Path(os.path.abspath(candidate))
    if not lexical.is_relative_to(workspace):
        raise Rejected("%s escapes workspace" % what)
    cursor = workspace
    for part in lexical.relative_to(workspace).parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise Rejected("%s contains a symlink: %s" % (what, cursor))
    resolved = lexical.resolve()
    if not resolved.is_relative_to(workspace):
        raise Rejected("%s resolves outside workspace" % what)
    return resolved


def checkpoint_snapshot(base_path, workspace, allowed_links, phase):
    if phase not in ("init", "postroute"):
        raise Rejected("checkpoint phase must be init or postroute")
    script = checkpoint_path(workspace, base_path, "checkpoint script")
    root = checkpoint_path(workspace, str(base_path) + ".dat", "checkpoint directory")
    if not script.is_file() or script.stat().st_size == 0:
        raise Rejected("checkpoint restore script is absent or empty: %s" % script)
    if not root.is_dir():
        raise Rejected("checkpoint data directory is absent: %s" % root)
    directories, files, links = [], [], []
    for entry in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        relative = entry.relative_to(root).as_posix()
        if entry.is_symlink():
            expected = allowed_links.get(relative)
            if expected is None:
                raise Rejected("checkpoint tree contains an undeclared symlink: %s" % relative)
            link_text = os.readlink(entry)
            raw_target = Path(link_text) if Path(link_text).is_absolute() else entry.parent / link_text
            if raw_target.is_symlink():
                raise Rejected("checkpoint link points through another symlink: %s" % relative)
            target = raw_target.resolve(strict=True)
            if target.is_dir() or not target.is_file():
                raise Rejected("checkpoint link target is not one regular file: %s" % relative)
            if target != expected["resolvedPath"]:
                raise Rejected("checkpoint link was retargeted: %s" % relative)
            raw = target.read_bytes()
            if sha_bytes(raw) != expected["sha256"] or len(raw) != expected["bytes"]:
                raise Rejected("checkpoint link target identity changed: %s" % relative)
            links.append({"path": relative, "linkText": link_text,
                          "target": {key: expected[key] for key in
                                     ("role", "path", "sha256", "bytes", "sourceType")}})
            continue
        if entry.is_dir():
            directories.append(relative)
        elif entry.is_file():
            raw = entry.read_bytes()
            files.append({"path": relative, "sha256": sha_bytes(raw), "bytes": len(raw)})
        else:
            raise Rejected("checkpoint tree contains an unsupported member: %s" % relative)
    if not files:
        raise Rejected("checkpoint data directory contains no files")
    if {row["path"] for row in links} != set(allowed_links):
        raise Rejected("checkpoint tree is missing one or more declared vendor links")
    script_raw = script.read_bytes()
    body = {
        "phase": phase,
        "script": {"path": str(script.relative_to(workspace)),
                   "sha256": sha_bytes(script_raw), "bytes": len(script_raw)},
        "restorePath": str(root.relative_to(workspace)),
        "directories": directories, "files": files, "links": links,
    }
    tree_hash = sha_bytes(json.dumps(body, sort_keys=True, separators=(",", ":")).encode())
    return {"schema": "custom-cell-fmax-innovus-checkpoint/1", **body, "treeSha256": tree_hash}


def publish_checkpoint(ctx, base_path, role, allowed_links, phase):
    snapshot = checkpoint_snapshot(base_path, ctx.workspace, allowed_links, phase)
    target = ctx.run_dir / (role + ".json")
    atomic_json(target, snapshot)
    ctx.add_artifact(target, role, "innovus-checkpoint-manifest")
    return checkpoint_path(ctx.workspace, snapshot["restorePath"], "checkpoint restore path")


def validate_checkpoint(manifest_path, workspace, allowed_links, phase):
    document = read_json(manifest_path)
    if set(document) != {"schema", "phase", "script", "restorePath", "directories", "files", "links", "treeSha256"}:
        raise Rejected("checkpoint manifest has unexpected fields")
    if document.get("schema") != "custom-cell-fmax-innovus-checkpoint/1":
        raise Rejected("checkpoint manifest schema is unsupported")
    if document.get("phase") != phase:
        raise Rejected("checkpoint manifest has the wrong phase")
    script = document.get("script")
    if not isinstance(script, dict) or set(script) != {"path", "sha256", "bytes"}:
        raise Rejected("checkpoint manifest has no exact restore-script identity")
    rebuilt = checkpoint_snapshot(checkpoint_path(workspace, script["path"], "checkpoint script"),
                                  workspace, allowed_links, phase)
    if rebuilt != document:
        raise Rejected("checkpoint manifest differs from the complete current tree")
    return checkpoint_path(workspace, document["restorePath"], "checkpoint restore path")


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")
    temp.replace(path)


def method_identity():
    rows = []
    for at in sorted(DOMAIN.rglob("*")):
        if (at.is_file() and not at.is_symlink() and "__pycache__" not in at.parts
                and at.suffix not in (".pyc", ".pyo")):
            rows.append({"path": str(at.relative_to(HERE)), "sha256": sha_file(at), "bytes": at.stat().st_size})
    adapter = {"path": "stages.py", "sha256": sha_file(Path(__file__)), "bytes": Path(__file__).stat().st_size}
    digest = sha_bytes("".join(row["path"] + ":" + row["sha256"] + "\n" for row in [adapter] + rows).encode())
    return {"codeSha256": digest, "stageAdapter": adapter, "domainSources": rows}


class Context:
    def __init__(self, stage, workspace):
        self.stage = stage
        self.workspace = Path(workspace).resolve()
        if not self.workspace.is_dir():
            raise Rejected("workspace is not a directory: %s" % self.workspace)
        self.flow = self.workspace / "flow"
        self.record_path = self.flow / "records" / (stage + ".json")
        self.inputs_doc = read_json(self.flow / "inputs.json")
        if not isinstance(self.inputs_doc, dict):
            raise Rejected("flow/inputs.json must be one object materialized from Campaign inputs")
        self.evidence_class = self.inputs_doc.get("evidenceClass")
        if self.evidence_class not in ("site-run", "synthetic-fixture"):
            raise Rejected("inputs.json evidenceClass must be site-run or synthetic-fixture")
        self.inputs = [file_ref(self.flow / "inputs.json", self.workspace, "inputs_json", "campaign-binding")]
        self.artifacts = []
        self.executions = []
        self.facts = {}
        self.run_dir = self.flow / "artifacts" / stage / ("run-" + uuid.uuid4().hex)
        self.run_dir.mkdir(parents=True, exist_ok=False)

    def binding(self, name):
        aliases = {
            "DESIGN_TOP": "designTop", "DESIGN_RTL_GLOB": "rtlGlob",
            "FOUNDRY_DB": "foundryDb", "EDA_WRAPPER": "edaWrapper",
        }
        value = self.inputs_doc.get(name)
        if value in (None, "") and name in aliases:
            value = self.inputs_doc.get(aliases[name])
        if value in (None, ""):
            raise Rejected("missing validated Site binding %s" % name)
        return value

    def file_binding(self, name, source_type="site-input"):
        at = Path(str(self.binding(name))).resolve()
        self.inputs.append(file_ref(at, self.workspace, name, source_type))
        return at

    def add_artifact(self, path, role, source_type="tool-output"):
        ref = file_ref(path, self.workspace, role, source_type)
        self.artifacts.append(ref)
        return ref

    def run(self, argv, cwd=None, timeout=900, env=None, tag="tool"):
        if not isinstance(argv, list) or not argv or any(not isinstance(x, str) or not x for x in argv):
            raise Rejected("invalid tool argv")
        log = self.run_dir / (tag + ".log")
        started = time.time()
        actual_env = dict(os.environ)
        if env:
            actual_env.update({str(k): str(v) for k, v in env.items()})
        try:
            with log.open("wb") as out:
                result = subprocess.run(argv, cwd=cwd or self.run_dir, stdout=out,
                                        stderr=subprocess.STDOUT, timeout=timeout, env=actual_env)
            code = result.returncode
        except subprocess.TimeoutExpired:
            with log.open("ab") as out:
                out.write(("\nTIMEOUT after %ss\n" % timeout).encode())
            code = 124
        except FileNotFoundError as exc:
            log.write_text(str(exc) + "\n")
            code = 127
        entry = {
            "argv": argv, "cwd": str(Path(cwd or self.run_dir).resolve()),
            "exitCode": code, "elapsedSeconds": time.time() - started,
            "log": file_ref(log, self.workspace, tag + "_log", "tool-log"),
        }
        self.executions.append(entry)
        if code != 0:
            raise ToolFailure("tool exited %d; inspect %s" % (code, log))
        return log

    def write(self, status, reason=None):
        facts = dict(self.facts)
        if reason is not None:
            facts[("rejected_reason" if status == "rejected" else "tool_failure_reason")] = reason
        record = {
            "schema": SCHEMA, "stage": self.stage, "status": status,
            "evidenceClass": self.evidence_class,
            "inputs": self.inputs, "artifacts": self.artifacts,
            "executions": self.executions, "facts": facts,
            "method": method_identity(),
            "scope": "custom Cell Fmax Pack domain evidence; no silicon or cross-design PPA claim",
        }
        immutable = self.run_dir / "record.json"
        atomic_json(immutable, record)
        atomic_json(self.record_path, record)
        return record


def prior(ctx, stage):
    record = read_json(ctx.flow / "records" / (stage + ".json"))
    if record.get("schema") != SCHEMA or record.get("stage") != stage:
        raise Rejected("invalid %s stage record" % stage)
    if record.get("status") != "passed":
        raise Rejected("%s prerequisite is %s" % (stage, record.get("status")))
    if record.get("evidenceClass") != ctx.evidence_class:
        raise Rejected("%s evidence class differs from current inputs" % stage)
    return record


def artifact(record, workspace, role):
    hits = [row for row in record.get("artifacts", []) if row.get("role") == role]
    if len(hits) != 1:
        raise Rejected("record must contain exactly one %s artifact" % role)
    return checked_ref(hits[0], workspace, role)


def require_hash(path, expected, what):
    if sha_file(path) != expected:
        raise Rejected("%s hash mismatch" % what)


def tool_error_lines(text):
    return re.findall(r"^(?:\*\*ERROR|ERROR|Error|Fatal):.*$", text, re.M)


def dc_version(text):
    hits = re.findall(
        r"^[ \t]*Version[ \t]+(\S+)[ \t]+for[ \t]+(\S+)[ \t]+-[ \t]+(.+?)[ \t]*$",
        text, re.M)
    if len(hits) != 1:
        raise Rejected("DC log has no unambiguous supported Version <version> for <platform> header")
    return {"version": hits[0][0], "platform": hits[0][1], "build": hits[0][2]}


def innovus_version(text):
    hits = re.findall(r"^Version:\s*(v[^,\s]+),\s+built\s+(.+?)\s*$", text, re.M)
    if len(hits) != 1:
        raise Rejected("Innovus log has no unambiguous supported version header")
    return {"version": hits[0][0], "build": hits[0][1]}


def held_identities(refs, exact=(), prefixes=()):
    selected = [ref for ref in refs if ref.get("role") in exact
                or any(str(ref.get("role", "")).startswith(prefix) for prefix in prefixes)]
    roles = [ref.get("role") for ref in selected]
    if len(roles) != len(set(roles)):
        raise Rejected("common-condition input roles are not unique")
    missing = sorted(set(exact) - set(roles))
    if missing:
        raise Rejected("common-condition identity lacks: " + ",".join(missing))
    return [{key: ref[key] for key in ("role", "sha256", "bytes", "sourceType")}
            for ref in sorted(selected, key=lambda row: row["role"])]


def referenced_paths(refs, workspace, roles):
    paths = []
    for ref in refs:
        if ref.get("role") not in roles:
            continue
        path = Path(ref["path"])
        paths.append(str((workspace / path).resolve() if not path.is_absolute() else path.resolve()))
    return paths


def normalized_synth_entry(text):
    lines = []
    for line in text.splitlines():
        if "::env(CCFMAX_CUSTOM_DB)" in line or "::env(CCFMAX_ARM)" in line:
            continue
        line = re.sub(r"/[^\s\"]+/flow/artifacts/(?:foundry|custom)-synth/run-[0-9a-f]+", "@RUN@", line)
        lines.append(line)
    return "\n".join(lines)


def publish_condition_identity(ctx, identity):
    target = ctx.run_dir / "common-condition-identity.json"
    atomic_json(target, identity)
    ctx.add_artifact(target, "common_condition_identity", "derived-from-held-condition-evidence")
    ctx.facts["commonConditionIdentitySha256"] = sha_file(target)


def mining_sources_hash():
    names = [
        "mining_strategy_contract.py", "mine_patterns.py", "mine_timing_route.py",
        "verilog_netlist.py", "cell_need_miner/aig.py", "cell_need_miner/cuts.py",
        "cell_need_miner/generator_contract.py", "cell_need_miner/liberty.py",
        "cell_need_miner/liberty_timing.py", "cell_need_miner/npn.py",
    ]
    return sha_bytes("".join(name + ":" + sha_file(DOMAIN / name) + "\n" for name in names).encode())


def route_args(ctx, route, output, netlist, skeleton, liberty):
    spec = STRATEGIES[route]
    common = [
        "--netlist", str(netlist), "--liberty-skeleton", str(skeleton),
        "--output", str(output), "--strategy-id", route,
        "--objective", spec["objective"], "--top", str(int(ctx.binding("MAX_ROUTE_CANDIDATES"))),
        "--process-family", str(ctx.binding("PROCESS_FAMILY")),
        "--cell-architecture-ref", str(ctx.binding("CELL_ARCHITECTURE_REF")),
        "--characterization-profile-ref", str(ctx.binding("CHARACTERIZATION_PROFILE_REF")),
        "--drive-strength", str(ctx.binding("DRIVE_STRENGTH")),
        "--vt-class", str(ctx.binding("VT_CLASS")),
    ]
    if spec["engine"] == "timing":
        return ["/usr/bin/python3", str(DOMAIN / "mine_timing_route.py"), *common,
                "--full-liberty", str(liberty)]
    return ["/usr/bin/python3", str(DOMAIN / "mine_patterns.py"), *common,
            "--source-graph", "mapped"]


def stage_mine(ctx, route):
    if route not in ROUTES:
        raise Rejected("mine route must be one of: " + ",".join(ROUTES))
    probe_path = ctx.flow / "probe.json"
    probe = read_json(probe_path)
    if probe.get("format") != "custom-cell-fmax-probe/2" or probe.get("toolExit") != 0:
        raise Rejected("flow/probe.json is not a successful immutable custom Cell Fmax probe")
    evidence = probe.get("evidence") or {}
    net_ref = evidence.get("netlist.v")
    if not isinstance(net_ref, dict):
        raise Rejected("probe has no netlist.v evidence")
    relative = Path(str(net_ref.get("path") or ""))
    if relative.is_absolute() or ".." in relative.parts:
        raise Rejected("probe netlist path escapes flow")
    netlist = (ctx.flow / relative).resolve()
    if not netlist.is_relative_to(ctx.flow.resolve()) or netlist.is_symlink() or not netlist.is_file():
        raise Rejected("probe netlist is missing or escapes flow")
    require_hash(netlist, net_ref.get("sha256"), "probe netlist")
    ctx.inputs.extend([
        file_ref(probe_path, ctx.workspace, "probe_record", "real-tool-record"),
        file_ref(netlist, ctx.workspace, "probe_netlist", "real-tool-output"),
    ])
    skeleton = ctx.file_binding("LIBERTY_SKELETON")
    liberty = ctx.file_binding("FOUNDRY_LIB")
    target = ctx.run_dir / "raw.json"
    code_hash = mining_sources_hash()
    log = ctx.run(route_args(ctx, route, target, netlist, skeleton, liberty), tag="mine-" + route)
    raw = read_json(target)
    requests = raw.get("generation_requests")
    if (raw.get("report_schema") != "xspace_cell-pattern-search/v2"
            or raw.get("strategy_id") != route or not isinstance(requests, list)
            or set(raw.get("algorithms") or ()) != set(STRATEGIES[route]["algorithms"])):
        raise Rejected("mining output violates the route contract")
    for request in requests:
        errors = validate_generation_request(request)
        if errors:
            raise Rejected("invalid generation request %s: %s" %
                           (request.get("candidate_id"), "; ".join(errors)))
    published = ctx.flow / "mining" / route / "raw.json"
    published.parent.mkdir(parents=True, exist_ok=True)
    published.write_bytes(target.read_bytes())
    ctx.add_artifact(target, "mining_raw", "algorithm-output")
    view = ctx.run_dir / "research.json"
    atomic_json(view, mining_research_view(target, code_hash))
    (published.parent / "research.json").write_bytes(view.read_bytes())
    ctx.add_artifact(view, "mining_research_view", "source-linked-projection")
    ctx.facts.update({
        "route": route, "candidate_count": len(requests),
        "codeSha256": code_hash, "sourceNetlistSha256": sha_file(netlist),
    })


def mining_research_view(raw_path, code_hash):
    """A finite model-facing projection; the executable and reader still use the full raw file."""
    raw = read_json(raw_path)
    candidates = []
    for request in raw["generation_requests"]:
        evidence = request.get("discovery_evidence") or {}
        contract = request.get("generator_contract") or {}
        candidates.append({
            "candidate_id": request["candidate_id"],
            "implementation_route": (request.get("implementation_plan") or {}).get("route"),
            "interface": contract.get("interface"),
            "equivalence_digest": (contract.get("equivalence_reference") or {}).get("digest"),
            "evidence": {key: evidence.get(key) for key in (
                "raw_support", "non_overlapping_support", "non_overlapping_support_method",
                "critical_impact_du", "critical_root_rank", "input_count", "output_count",
                "search_objective", "discovery_algorithm", "library_function_match", "ppa_status",
            )},
        })
    return {"schema": "custom-cell-fmax-mining-research-view/1", "sourceSha256": sha_file(raw_path),
            "minerCodeSha256": code_hash, "route": raw["strategy_id"], "candidates": candidates,
            "limitations": ["A projection of every emitted candidate, not the full occurrence/equivalence proof.",
                            "Null means absent in the source, not zero. Inspect the full raw file in your program.",
                            "Timing delay units are proxies; neither support nor Boolean equivalence proves PPA."]}


def candidate_key(request):
    contract = request.get("generator_contract") or {}
    reference = contract.get("equivalence_reference") or {}
    profile = contract.get("target_library_profile") or {}
    return (reference.get("digest"), tuple(reference.get("output_order") or ()),
            json.dumps(profile, sort_keys=True, separators=(",", ":")))


def candidate_rank(request):
    evidence = request.get("discovery_evidence") or {}
    return (-int(evidence.get("non_overlapping_support") or 0),
            -int((evidence.get("representative_occurrence") or {}).get("internal_nets") or 0),
            request.get("candidate_id") or "")


def stage_merge(ctx):
    budget = ctx.binding("MAX_CELLS")
    if isinstance(budget, bool) or not isinstance(budget, int) or budget not in (1, 2):
        raise Rejected("MAX_CELLS must be the bounded-pilot value 1 or 2")
    reports = {}
    route_provenance = {}
    missing = []
    for route in ROUTES:
        raw_path = ctx.flow / "mining" / route / "raw.json"
        selected_path = ctx.flow / "mining" / route / "selected.json"
        if not raw_path.is_file() or not selected_path.is_file():
            missing.append(route)
            continue
        mine_record = read_json(ctx.flow / "records" / ("mine-" + route + ".json"))
        if (mine_record.get("schema") != SCHEMA or mine_record.get("stage") != "mine-" + route
                or mine_record.get("status") != "passed"):
            raise Rejected("mine record is absent or rejected for route %s" % route)
        raw = read_json(raw_path)
        selected = read_json(selected_path)
        held_raw = artifact(mine_record, ctx.workspace, "mining_raw")
        if sha_file(held_raw) != sha_file(raw_path):
            raise Rejected("%s current raw.json differs from its mine record" % route)
        if set(selected) != {"sourceSha256", "selected", "codeSha256"}:
            raise Rejected("%s selected.json has unexpected fields" % route)
        if selected["sourceSha256"] != sha_file(raw_path):
            raise Rejected("%s selected source hash does not match raw.json" % route)
        if selected["codeSha256"] != mine_record.get("facts", {}).get("codeSha256"):
            raise Rejected("%s selected code hash does not match executed miner" % route)
        ids = selected["selected"]
        if (not isinstance(ids, list) or len(ids) > 2 or len(ids) != len(set(ids))
                or any(not isinstance(x, str) for x in ids)):
            raise Rejected("%s selected candidate ids must be a unique array" % route)
        all_requests = raw.get("generation_requests")
        if (raw.get("report_schema") != "xspace_cell-pattern-search/v2"
                or raw.get("strategy_id") != route or not isinstance(all_requests, list)):
            raise Rejected("%s raw route report has the wrong identity" % route)
        by_id = {row.get("candidate_id"): row for row in all_requests if isinstance(row, dict)}
        if len(by_id) != len(all_requests) or any(name not in by_id for name in ids):
            raise Rejected("%s selected ids are not an exact subset of raw candidates" % route)
        chosen = [by_id[name] for name in ids]
        for request in chosen:
            errors = validate_generation_request(request)
            if errors:
                raise Rejected("%s selected an invalid generation request: %s" % (route, "; ".join(errors)))
            if (request.get("implementation_plan") or {}).get("route") not in BUILDABLE_ROUTES:
                raise Rejected("%s selected an unbuildable candidate" % route)
        reports[route] = chosen
        route_provenance[route] = {
            "rawSha256": sha_file(raw_path), "selectionSha256": sha_file(selected_path),
            "codeSha256": selected["codeSha256"], "selectedCandidateIds": ids,
        }
        raw_snapshot = ctx.run_dir / (route + "-raw.json")
        selection_snapshot = ctx.run_dir / (route + "-selected.json")
        raw_snapshot.write_bytes(raw_path.read_bytes())
        selection_snapshot.write_bytes(selected_path.read_bytes())
        ctx.inputs.extend([
            file_ref(raw_snapshot, ctx.workspace, route + "_raw", "algorithm-output"),
            file_ref(selection_snapshot, ctx.workspace, route + "_selection", "agent-selection"),
        ])
    if missing:
        raise Rejected("six route evidence set is incomplete; missing raw/selected for: " + ",".join(missing))

    grouped = {}
    members = {}
    for route in ROUTES:
        for rank, request in enumerate(reports[route], 1):
            key = candidate_key(request)
            if not key[0]:
                raise Rejected("candidate has no equivalence digest")
            members.setdefault(key, []).append({"route": route, "rank": rank,
                                                 "candidateId": request.get("candidate_id")})
            if key not in grouped or candidate_rank(request) < candidate_rank(grouped[key]):
                grouped[key] = json.loads(json.dumps(request))
    for key, winner in grouped.items():
        evidence = winner.setdefault("discovery_evidence", {})
        evidence["strategy_ids"] = sorted({row["route"] for row in members[key]})
        evidence["strategy_rankings"] = {
            row["route"]: {"candidate_id": row["candidateId"], "local_rank": row["rank"],
                           "search_objective": STRATEGIES[row["route"]]["objective"]}
            for row in members[key]
        }
    queues = {route: sorted((row for key, row in grouped.items()
                             if route in {m["route"] for m in members[key]}), key=candidate_rank)
              for route in ROUTES}
    selected = []
    seen = set()
    while len(selected) < budget and any(queues.values()):
        for route in ROUTES:
            while queues[route] and candidate_key(queues[route][0]) in seen:
                queues[route].pop(0)
            if queues[route] and len(selected) < budget:
                row = queues[route].pop(0)
                selected.append(row)
                seen.add(candidate_key(row))
    selected_ids = [row.get("candidate_id") for row in selected]
    if len(selected_ids) != len(set(selected_ids)):
        raise Rejected("distinct Boolean equivalence classes collide on candidate_id")
    duplicates = []
    for key, rows in members.items():
        winner = grouped[key]["candidate_id"]
        duplicates.extend({"kept": winner, "duplicate": row["candidateId"], "strategy_id": row["route"],
                           "equivalence_digest": key[0]} for row in rows if row["candidateId"] != winner)
    merged = {
        "report_schema": "xspace_cell-pattern-search/v2",
        "strategy_id": "parallel_strategy_union", "source_graph": "mapped",
        "search_bound": {"strategy_count": 6, "strategies": list(ROUTES), "global_cell_budget": budget},
        "generation_requests": selected,
        "candidate_set_accounting": {
            "selected_candidate_count": len(selected), "unique_buildable_pool_count": len(grouped),
            "equivalent_duplicate_count": len(duplicates),
            "route_selected_counts": {route: len(reports[route]) for route in ROUTES},
        },
        "deduplication": duplicates, "provenance": route_provenance,
        "limitations": ["Agent selections are bounded and hash-bound to six route outputs.",
                        "No adoption or PPA benefit is implied by selection."],
    }
    held = ctx.run_dir / "merged.json"
    atomic_json(held, merged)
    target = ctx.flow / "mining" / "merged.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(held.read_bytes())
    ctx.add_artifact(held, "merged_patterns", "algorithm-output")
    ctx.facts.update({"candidate_count": len(selected), "unique_pool_count": len(grouped),
                      "duplicate_count": len(duplicates), "route_count": 6})


def stage_generate(ctx):
    merged_record = prior(ctx, "merge")
    patterns = artifact(merged_record, ctx.workspace, "merged_patterns")
    ctx.inputs.append(file_ref(patterns, ctx.workspace, "merged_patterns", "algorithm-output"))
    jobs = expected_generation_jobs(read_json(patterns))
    if not jobs:
        raise Rejected("merged candidate set is empty")
    if len({job["candidate_id"] for job in jobs}) > int(ctx.binding("MAX_CELLS")):
        raise Rejected("merged candidates exceed MAX_CELLS")
    pdk = ctx.file_binding("BOOL2CMOS_PDK_PROFILE")
    command = shlex.split(str(ctx.binding("BOOL2CMOS_CMD")))
    if not command:
        raise Rejected("BOOL2CMOS_CMD is empty")
    cwd = Path(str(ctx.binding("BOOL2CMOS_CWD"))).resolve()
    if not cwd.is_dir():
        raise Rejected("BOOL2CMOS_CWD is not a directory")
    attempts = []
    cells = ctx.run_dir / "cells"
    cells.mkdir()
    for index, job in enumerate(jobs):
        target = cells / (job["cell_name"] + ".sp")
        argv = command + ["--function", job["liberty_function"], "--inputs", ",".join(job["inputs"]),
                          "--output", job["output_name"], "--pdk", str(pdk),
                          "--cell-name", job["cell_name"], "--out", str(target), "--quiet"]
        try:
            ctx.run(argv, cwd=cwd, timeout=int(ctx.binding("GENERATION_TIMEOUT_SEC")),
                    tag="bool2cmos-%02d" % index)
            code = 0
        except ToolFailure:
            code = ctx.executions[-1]["exitCode"]
        structural = target.is_file() and spice_netlist_is_structural(target.read_text(errors="replace"), job["cell_name"])
        attempts.append({"candidate_id": job["candidate_id"], "cell_name": job["cell_name"],
                         "returncode": code, "structural": structural})
    attempts_path = ctx.run_dir / "attempts.json"
    atomic_json(attempts_path, attempts)
    ctx.add_artifact(attempts_path, "generation_attempts", "tool-evidence")
    for row in attempts:
        target = cells / (row["cell_name"] + ".sp")
        if target.is_file():
            ctx.add_artifact(target, "generated_spice:" + row["cell_name"], "generated-netlist")
    generated = sum(1 for row in attempts if row["returncode"] == 0 and row["structural"])
    ctx.facts.update({"candidate_count": len({job["candidate_id"] for job in jobs}),
                      "generation_job_count": len(jobs), "generated_cell_count": generated})
    if generated != len(jobs):
        raise ToolFailure("bool2cmos did not produce every structural generation job")


def generated_spice(ctx):
    record = prior(ctx, "generate")
    paths = []
    for ref in record.get("artifacts", []):
        if str(ref.get("role", "")).startswith("generated_spice:"):
            paths.append(checked_ref(ref, ctx.workspace))
    if not paths:
        raise Rejected("generate record has no generated SPICE")
    return record, sorted(paths)


def helper_env(ctx):
    helpers = str(ctx.binding("CCFMAX_CHARMODEL_HELPER_DIR"))
    for item in helpers.split(":"):
        if not Path(item).is_dir():
            raise Rejected("CCFMAX_CHARMODEL_HELPER_DIR contains missing directory: " + item)
    return {"CCFMAX_CHARMODEL_HELPER_DIR": helpers}


def stage_layout(ctx):
    _record, cells = generated_spice(ctx)
    tech = ctx.file_binding("LIBRECELL_TECH_PY")
    rules = ctx.file_binding("GEOMETRY_RULE_DECK")
    env = helper_env(ctx)
    for name in ("CCFMAX_CONTAINER_RUNTIME", "CCFMAX_CONTAINER_IMAGE", "CCFMAX_CONTAINER_HOST_ROOT",
                 "CCFMAX_CONTAINER_MOUNT_POINT", "CCFMAX_LCLAYOUT_ACTIVATE"):
        env[name] = str(ctx.binding(name))
    power, ground = str(ctx.binding("CCFMAX_POWER_PIN")), str(ctx.binding("CCFMAX_GROUND_PIN"))
    built = []
    for index, cell in enumerate(cells):
        out = ctx.run_dir / cell.stem
        argv = ["/usr/bin/python3", str(DOMAIN / "abstract_cell.py"), "--netlist", str(cell),
                "--tech", str(tech), "--rule-deck", str(rules), "--power-pin", power,
                "--ground-pin", ground, "-o", str(out)]
        ctx.run(argv, env=env, timeout=int(ctx.binding("ABSTRACT_TIMEOUT_SEC")), tag="layout-%02d" % index)
        lef, meta = out / (cell.stem + ".lef"), out / (cell.stem + ".abstract.json")
        if not lef.is_file() or not meta.is_file():
            raise ToolFailure("abstract generator returned success without LEF and metadata")
        built.append((lef, meta))
    for lef, meta in built:
        ctx.add_artifact(lef, "abstract_lef:" + lef.stem, "generated-abstract")
        ctx.add_artifact(meta, "abstract_metadata:" + lef.stem, "generated-abstract-metadata")
    ctx.facts["abstract_cell_count"] = len(built)


def stage_characterize(ctx):
    _record, cells = generated_spice(ctx)
    layout = prior(ctx, "layout")
    abstract_dirs = {checked_ref(ref, ctx.workspace).parent for ref in layout.get("artifacts", [])
                     if str(ref.get("role", "")).startswith("abstract_lef:")}
    if len(abstract_dirs) != len(cells):
        raise Rejected("layout evidence does not exactly cover generated cells")
    base = ctx.file_binding("FOUNDRY_LIB")
    timing = ctx.file_binding("CHARMODEL_TIMING_MODEL", "learned-model")
    power = ctx.file_binding("CHARMODEL_POWER_MODEL", "learned-model")
    area = ctx.file_binding("CHARMODEL_AREA_MODEL", "learned-model")
    out = ctx.run_dir / "generated.lib"
    env = helper_env(ctx)
    for module in ("estimate_lib.py", "mock_char.py"):
        matches = [Path(folder) / module for folder in env["CCFMAX_CHARMODEL_HELPER_DIR"].split(":")
                   if (Path(folder) / module).is_file()]
        if len(matches) != 1:
            raise Rejected("Site helper %s must resolve exactly once through helperDirs" % module)
        ctx.inputs.append(file_ref(matches[0], ctx.workspace, "charmodel_helper:" + module, "site-helper"))
    env.update({"CCFMAX_POWER_TEMPLATE_BASE_CELL": str(ctx.binding("CCFMAX_POWER_TEMPLATE_BASE_CELL")),
                "CCFMAX_POWER_PIN": str(ctx.binding("CCFMAX_POWER_PIN")),
                "CCFMAX_GROUND_PIN": str(ctx.binding("CCFMAX_GROUND_PIN"))})
    prediction_dir = ctx.run_dir / "predictions"
    prediction_manifest = ctx.run_dir / "prediction-executions.json"
    argv = ["/usr/bin/python3", str(DOMAIN / "charlib_emit.py"), "--netlist-dir", str(cells[0].parent),
            "--base", str(base), "--timing-model", str(timing), "--power-model", str(power),
            "--area-model", str(area), "--power-pin", env["CCFMAX_POWER_PIN"],
            "--ground-pin", env["CCFMAX_GROUND_PIN"], "--library-name", str(ctx.binding("GENERATED_LIBRARY_NAME")),
            "--prediction-dir", str(prediction_dir), "--prediction-executions", str(prediction_manifest),
            "-o", str(out)]
    ctx.run(argv, env=env, timeout=int(ctx.binding("CHARACTERIZE_TIMEOUT_SEC")), tag="charmodel")
    if not out.is_file() or not out.read_text(errors="replace").lstrip().startswith("/*"):
        raise ToolFailure("learned-model characterization emitted no Liberty")
    predicted_names = set(re.findall(r"(?m)^\s*cell\s*\(\s*\"?([A-Za-z_][A-Za-z0-9_$]*)", out.read_text(errors="replace")))
    if predicted_names != {cell.stem for cell in cells}:
        raise ToolFailure("learned-model Liberty does not exactly cover the generated Cell set")
    ctx.add_artifact(out, "generated_liberty", "learned-model-prediction")
    ctx.add_artifact(prediction_manifest, "prediction_executions", "nested-tool-evidence")
    nested = read_json(prediction_manifest)
    if not isinstance(nested, list) or len(nested) != len(cells):
        raise ToolFailure("predictor execution manifest does not cover every generated cell")
    for index, row in enumerate(nested):
        log = Path(str(row.get("log") or ""))
        prediction = Path(str(row.get("prediction") or ""))
        entry = {"argv": row.get("argv"), "cwd": str(ctx.run_dir),
                 "exitCode": row.get("exitCode"), "elapsedSeconds": row.get("elapsedSeconds"),
                 "log": file_ref(log, ctx.workspace, "predict-%02d_log" % index, "tool-log")}
        if entry["exitCode"] != 0:
            raise ToolFailure("nested learned-model predictor failed")
        ctx.executions.append(entry)
        ctx.add_artifact(prediction, "prediction:" + str(row.get("cell")), "learned-model-prediction")
    ctx.facts.update({"predicted_cell_count": len(predicted_names), "characterization_type": "learned-model-prediction",
                      "measured_characterization": False})


def stage_compile(ctx):
    liberty = artifact(prior(ctx, "characterize"), ctx.workspace, "generated_liberty")
    ctx.inputs.append(file_ref(liberty, ctx.workspace, "generated_liberty", "learned-model-prediction"))
    name = str(ctx.binding("GENERATED_LIBRARY_NAME"))
    db = ctx.run_dir / (name + ".db")
    script = ctx.run_dir / "compile.tcl"
    script.write_text("read_lib {%s}\nputs \"=== CUSTOM_CELL_FMAX LC READ COMPLETE ===\"\n"
                      "check_library\nputs \"=== CUSTOM_CELL_FMAX LC CHECK COMPLETE ===\"\n"
                      "write_lib -format db %s -output {%s}\n"
                      "puts \"=== CUSTOM_CELL_FMAX LC WRITE COMPLETE ===\"\nexit\n" % (liberty, name, db))
    ctx.add_artifact(script, "lc_script", "generated-tool-input")
    wrapper = str(ctx.binding("EDA_WRAPPER"))
    log = ctx.run([wrapper, "lc_shell", "-f", str(script)], timeout=int(ctx.binding("LC_TIMEOUT_SEC")), tag="lc")
    text = log.read_text(errors="replace")
    markers = ("LC READ COMPLETE", "LC CHECK COMPLETE", "LC WRITE COMPLETE")
    tool_errors = re.findall(r"^(?:Error|Fatal):.*$", text, re.M | re.I)
    rejected_library = re.search(r"\b(?:library|cell)\b[^\n]*(?:rejected|failed validation|not accepted)", text, re.I)
    if (tool_errors or rejected_library
            or any(("=== CUSTOM_CELL_FMAX " + marker + " ===") not in text for marker in markers)
            or not db.is_file() or db.stat().st_size == 0):
        raise ToolFailure("Library Compiler did not prove read/check/write completion and a nonempty DB")
    ctx.add_artifact(db, "generated_db", "library-compiler-output")
    ctx.facts["lc_accepted"] = 1


def tcl_string(value):
    value = str(value)
    if "\n" in value or "\r" in value:
        raise Rejected("multiline Tcl input refused")
    return '"' + re.sub(r'([\\"$\[\]])', r'\\\1', value) + '"'


def stage_synth(ctx, custom):
    rtl_glob = str(ctx.binding("DESIGN_RTL_GLOB"))
    rtl = sorted(Path(p).resolve() for p in glob.glob(rtl_glob))
    if not rtl or any(not p.is_file() for p in rtl):
        raise Rejected("DESIGN_RTL_GLOB resolves to no complete RTL set")
    for at in rtl:
        ctx.inputs.append(file_ref(at, ctx.workspace, "rtl:" + at.name, "design-input"))
    foundry = ctx.file_binding("FOUNDRY_DB")
    constraints = ctx.file_binding("CONSTRAINTS_FILE")
    ctx.inputs.extend([
        file_ref(DOMAIN / "shared_synth.tcl", ctx.workspace, "shared_synth_template", "pack-method"),
        file_ref(constraints, ctx.workspace, "shared_synth_constraints", "site-input"),
    ])
    custom_db = artifact(prior(ctx, "compile"), ctx.workspace, "generated_db") if custom else None
    if custom_db:
        ctx.inputs.append(file_ref(custom_db, ctx.workspace, "generated_db", "library-compiler-output"))
    arm = "custom" if custom else "base"
    for folder in (ctx.run_dir / "results", ctx.run_dir / "reports", ctx.run_dir / "work"):
        folder.mkdir()
    values = {
        "DESIGN_TOP": ctx.binding("DESIGN_TOP"), "DESIGN_RTL_GLOB": rtl_glob,
        "FOUNDRY_DB": foundry, "CLK_NS": ctx.binding("CLOCK_NS"), "CCFMAX_ARM": arm,
        "CCFMAX_SDC": constraints,
        "CCFMAX_GENERATED_LIB_CELL_PATTERN": ctx.binding("GENERATED_LIB_CELL_PATTERN"),
        "CCFMAX_WORK_DIR": ctx.run_dir / "work", "CCFMAX_REPORT_DIR": ctx.run_dir / "reports",
    }
    if custom_db:
        values["CCFMAX_CUSTOM_DB"] = custom_db
    entry = ctx.run_dir / "entry.tcl"
    entry.write_text("\n".join("set ::env(%s) %s" % (key, tcl_string(value))
                               for key, value in sorted(values.items()))
                     + "\nsource %s\n" % tcl_string(DOMAIN / "shared_synth.tcl"))
    ctx.add_artifact(entry, "synthesis_entry", "generated-tool-input")
    wrapper = str(ctx.file_binding("EDA_WRAPPER", "tool-wrapper"))
    log = ctx.run([wrapper, "dc_shell", "-f", str(entry)], cwd=ctx.run_dir,
                  timeout=int(ctx.binding("SYNTH_TIMEOUT_SEC")), tag=arm + "-dc")
    text = log.read_text(errors="replace")
    if tool_error_lines(text):
        raise ToolFailure("DC returned zero but emitted an error line")
    version = dc_version(text)
    marker = re.findall(r"=== CUSTOM_CELL_FMAX LIBRARY_VISIBLE_COUNT (\d+) ===", text)
    if len(marker) != 1 or ("=== CUSTOM_CELL_FMAX SYNTHESIS_COMPLETE %s ===" % arm) not in text:
        raise ToolFailure("DC log lacks unambiguous library visibility/completion evidence")
    visible = int(marker[0])
    if custom and visible <= 0:
        raise Rejected("generated library is absent from the DC session")
    netlist = ctx.run_dir / "results" / (arm + ".dc.v")
    sdc = ctx.run_dir / "results" / (arm + ".dc.sdc")
    refs = ctx.run_dir / "reports" / ("refs_" + arm + ".rpt")
    timing = ctx.run_dir / "reports" / ("timing_" + arm + ".rpt")
    for at, role in ((netlist, "synthesis_netlist"), (sdc, "synthesis_sdc"),
                     (refs, "reference_report"), (timing, "synthesis_timing_report")):
        ctx.add_artifact(at, role, "design-compiler-output")
    publish_condition_identity(ctx, {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "synthesis",
        "commonInputs": held_identities(ctx.inputs,
            exact=("FOUNDRY_DB", "shared_synth_template", "shared_synth_constraints", "EDA_WRAPPER"),
            prefixes=("rtl:",)),
        "entryContractSha256": sha_bytes(normalized_synth_entry(entry.read_text()).encode()),
        "tool": version,
        "armSpecificExclusions": ["CCFMAX_ARM", "CCFMAX_CUSTOM_DB", "generated_db"],
    })
    ctx.facts.update({
        "arm": "generated" if custom else "foundry", "library_visible": visible,
        "clock_ns": float(ctx.binding("CLOCK_NS")),
        "templateSha256": sha_file(DOMAIN / "shared_synth.tcl"),
        "constraintsSha256": sha_file(constraints),
        "rtlSha256": [sha_file(at) for at in rtl],
        "librarySetSha256": [sha_file(foundry)] + ([sha_file(custom_db)] if custom_db else []),
        "wrapper": wrapper, "toolVersion": version,
    })


def stage_adoption(ctx):
    synth = prior(ctx, "custom-synth")
    visible = synth.get("facts", {}).get("library_visible")
    if not isinstance(visible, int) or visible <= 0:
        raise Rejected("custom synthesis did not prove the generated library visible")
    netlist = artifact(synth, ctx.workspace, "synthesis_netlist")
    liberty = artifact(prior(ctx, "characterize"), ctx.workspace, "generated_liberty")
    synth_log = execution_log(synth, ctx.workspace, "custom-dc_log")
    projection = project_texts(netlist.read_text(errors="replace"), liberty.read_text(errors="replace"))
    evidence = ctx.run_dir / "adoption.json"
    atomic_json(evidence, projection)
    ctx.add_artifact(evidence, "adoption_projection", "derived-from-netlist-master-relation")
    ctx.inputs.extend([file_ref(netlist, ctx.workspace, "custom_netlist", "design-compiler-output"),
                       file_ref(liberty, ctx.workspace, "offered_library", "learned-model-prediction"),
                       file_ref(synth_log, ctx.workspace, "custom_synth_log", "tool-log")])
    ctx.facts.update({"library_visible": visible, **projection})


def fill_template(path, mapping):
    text = path.read_text()
    for key, value in mapping.items():
        text = text.replace("@@%s@@" % key, str(value))
    leftover = sorted(set(re.findall(r"@@([A-Z_]+)@@", text)))
    if leftover:
        raise Rejected("unfilled %s template fields: %s" % (path.name, ",".join(leftover)))
    return text


def checkpoint_allowed_links(inputs, workspace, init_script, mmmc_script, arm, phase):
    if phase not in ("init", "postroute"):
        raise Rejected("checkpoint link phase must be init or postroute")
    target_roles = {"TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH",
                    "generated_liberty", "generated_lef", "pnr_input_sdc",
                    "postroute_rc_model"}
    held = {}
    for ref in inputs:
        if ref.get("role") not in target_roles:
            continue
        raw = Path(ref["path"])
        resolved = (workspace / raw).resolve() if not raw.is_absolute() else raw.resolve()
        if resolved in held:
            raise Rejected("checkpoint link targets repeat a held path: %s" % resolved)
        held[resolved] = {**ref, "resolvedPath": resolved}
    init_text = Path(init_script).read_text(errors="replace")
    lef_rows = re.findall(r"^set init_lef_file\s+\[list\s+([^\]]+)\]\s*$", init_text, re.M)
    if len(lef_rows) != 1:
        raise Rejected("init script has no unambiguous LEF contract")
    mmmc = parse_mmmc(mmmc_script)
    categories = [
        (lef_rows[0].split(), "libs/lef"),
        (list(mmmc["libraries"]) + ([mmmc["sdc"]] if phase == "init" else []), "libs/mmmc"),
        ([mmmc["qrc"]], "libs/mmmc/rc_" + arm),
    ]
    if phase == "postroute":
        rc_models = [row for row in held.values() if row["role"] == "postroute_rc_model"]
        if len(rc_models) != 1:
            raise Rejected("postroute checkpoint requires one hash-held RC model")
        categories.append(([str(rc_models[0]["resolvedPath"])], "libs/misc"))
    allowed = {}
    for paths, folder in categories:
        for value in paths:
            target = Path(value).resolve()
            expected = held.get(target)
            if expected is None:
                raise Rejected("checkpoint script target is not a hash-held arm input: %s" % target)
            relative = folder + "/" + target.name
            if relative in allowed:
                raise Rejected("checkpoint link path collision: %s" % relative)
            allowed[relative] = expected
    return allowed


def pnr_record_allowed_links(record, workspace, arm, phase):
    refs = list(record.get("inputs", []))
    if phase == "postroute":
        rc_refs = [row for row in record.get("artifacts", []) if row.get("role") == "postroute_rc_model"]
        if len(rc_refs) != 1:
            raise Rejected("PnR record has no unique postroute RC model artifact")
        checked_ref(rc_refs[0], workspace, "postroute_rc_model")
        refs.extend(rc_refs)
    return checkpoint_allowed_links(
        refs, workspace,
        artifact(record, workspace, "init_script:" + arm),
        artifact(record, workspace, "mmmc_script:" + arm), arm, phase)


def merged_lef(ctx, layout):
    lefs = [checked_ref(ref, ctx.workspace) for ref in layout.get("artifacts", [])
            if str(ref.get("role", "")).startswith("abstract_lef:")]
    if not lefs:
        raise Rejected("layout stage has no abstract LEFs")
    out = ctx.run_dir / "generated.lef"
    bodies = []
    for lef in sorted(lefs):
        body, keep = [], False
        for line in lef.read_text(errors="replace").splitlines():
            if line.startswith("MACRO"):
                keep = True
            if line.startswith("END LIBRARY"):
                keep = False
                continue
            if keep:
                body.append(line)
        bodies.append("\n".join(body))
    out.write_text("VERSION 5.7 ;\n" + "\n".join(bodies) + "\nEND LIBRARY\n")
    return out


def normalized_arm_script(text, excluded_paths=()):
    text = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    for path in sorted(excluded_paths, key=len, reverse=True):
        text = text.replace(" " + path, "")
    text = re.sub(r"\s+/[^\s{}\]]+/generated\.(?:lib|lef)", "", text)
    text = re.sub(r"/[^\s{}\]]+/flow/artifacts/pnr-(?:foundry|generated)/run-[0-9a-f]+", "@RUN@", text)
    text = re.sub(r"/[^\s{}\]]+/(?:base|custom)\.dc\.(?:v|sdc)", "@SYNTH@", text)
    text = re.sub(r"(?:foundry|generated)", "@ARM@", text)
    text = re.sub(r"DBS_@ARM@", "@DB@", text)
    return text


def floorplan_utilization(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise Rejected("floorplan utilization must be a finite fraction")
    if not math.isfinite(parsed) or parsed < 0.2 or parsed > 0.8:
        raise Rejected("floorplan utilization must be within [0.2, 0.8]")
    return "%.3f" % parsed


def build_arm_files(ctx, utilization):
    foundry_synth, custom_synth = prior(ctx, "foundry-synth"), prior(ctx, "custom-synth")
    layout, char = prior(ctx, "layout"), prior(ctx, "characterize")
    generated_lef = merged_lef(ctx, layout)
    generated_lib = artifact(char, ctx.workspace, "generated_liberty")
    site = {name: ctx.file_binding(name) for name in
            ("TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH", "FOUNDRY_GDS", "CCFMAX_GDS_MAP")}
    texts = {}
    outputs = {}
    for arm, synth in (("foundry", foundry_synth), ("generated", custom_synth)):
        netlist, sdc = artifact(synth, ctx.workspace, "synthesis_netlist"), artifact(synth, ctx.workspace, "synthesis_sdc")
        libs = [site["FOUNDRY_LIB"]] + ([generated_lib] if arm == "generated" else [])
        lefs = [site["TECH_LEF"], site["FOUNDRY_LEF"]] + ([generated_lef] if arm == "generated" else [])
        mmmc = fill_template(DOMAIN / "mmmc.tcl.tmpl", {
            "ARM": arm, "LIBRARY_SET_TIMING": " ".join(map(str, libs)),
            "QRC_TECH_FILE": site["FOUNDRY_QRC_TECH"], "RC_TEMPERATURE": ctx.binding("CCFMAX_RC_TEMPERATURE"),
            "SDC_FILE": sdc,
        })
        mmmc_path = ctx.run_dir / ("mmmc_" + arm + ".tcl")
        mmmc_path.write_text(mmmc)
        init_db = ctx.run_dir / ("DBS_" + arm) / "init.enc"
        init_db.parent.mkdir()
        init = fill_template(DOMAIN / "init.tcl.tmpl", {
            "LEF_LIST": " ".join(map(str, lefs)), "NETLIST": netlist,
            "DESIGN_TOP": ctx.binding("DESIGN_TOP"),
            "MMMC_FILE": mmmc_path, "PWR_NET": ctx.binding("CCFMAX_POWER_PIN"),
            "GND_NET": ctx.binding("CCFMAX_GROUND_PIN"), "PROCESS_NODE": ctx.binding("CCFMAX_PROCESS_NODE"),
            "MAX_ROUTE_LAYER": ctx.binding("CCFMAX_MAX_ROUTE_LAYER"), "INIT_DB": init_db,
            "GENERATED_LIB_CELL_PATTERN": ctx.binding("GENERATED_LIB_CELL_PATTERN"), "ARM": arm,
            "PLACE_SITE": ctx.binding("PLACE_SITE"),
            "FLOORPLAN_UTILIZATION": utilization,
        })
        rpt = ctx.run_dir / ("rpt_" + arm)
        final_db = ctx.run_dir / ("DBS_" + arm) / "postroute.enc"
        gds = ctx.run_dir / (arm + ".gds")
        postroute_sdc = rpt / "postroute-active.sdc"
        pnr = fill_template(DOMAIN / "pnr.tcl.tmpl", {
            "INIT_DB": str(init_db) + ".dat", "DESIGN_TOP": ctx.binding("DESIGN_TOP"),
            "MULTI_CPU": ctx.binding("MULTI_CPU"), "TAP_CELL": ctx.binding("CCFMAX_TAP_CELL"),
            "TAP_INTERVAL": ctx.binding("CCFMAX_TAP_INTERVAL"), "FILLER_CELLS": ctx.binding("CCFMAX_FILLER_CELLS"),
            "RPT_DIR": rpt, "FINAL_DB": final_db, "GDS_OUT": gds,
            "GDS_MAP": site["CCFMAX_GDS_MAP"], "MERGE_GDS": site["FOUNDRY_GDS"],
            "SWITCHING_ACTIVITY": ctx.binding("CCFMAX_SWITCHING_ACTIVITY"), "ARM": arm,
            "POSTROUTE_SDC": postroute_sdc,
        })
        init_path, pnr_path = ctx.run_dir / ("init_" + arm + ".tcl"), ctx.run_dir / ("pnr_" + arm + ".tcl")
        init_path.write_text(init); pnr_path.write_text(pnr)
        texts[arm] = {"init": init, "pnr": pnr}
        outputs[arm] = {"mmmc": mmmc_path, "init": init_path, "pnr": pnr_path,
                        "init_checkpoint_base": init_db, "final_checkpoint_base": final_db,
                        "gds": gds, "postroute_sdc": postroute_sdc,
                        "input_sdc": sdc, "input_netlist": netlist}
    matched = all(normalized_arm_script(texts["foundry"][kind]) == normalized_arm_script(texts["generated"][kind])
                  for kind in ("init", "pnr"))
    if not matched:
        differences = []
        for kind in ("init", "pnr"):
            differences.extend(difflib.unified_diff(
                normalized_arm_script(texts["foundry"][kind]).splitlines(),
                normalized_arm_script(texts["generated"][kind]).splitlines(), lineterm=""))
        raise Rejected("paired P&R scripts differ outside the declared arm inputs: "
                       + " | ".join(differences[:8]))
    return outputs, generated_lef, generated_lib


def stage_pnr(ctx, arm, utilization="0.60"):
    utilization = floorplan_utilization(utilization)
    outputs, generated_lef, generated_lib = build_arm_files(ctx, utilization)
    ctx.facts["floorplan_utilization"] = float(utilization)
    chosen = outputs[arm]
    ctx.inputs.extend([
        file_ref(chosen["input_sdc"], ctx.workspace, "pnr_input_sdc", "design-compiler-output"),
        file_ref(chosen["input_netlist"], ctx.workspace, "pnr_input_netlist", "design-compiler-output"),
        file_ref(generated_lib, ctx.workspace, "generated_liberty", "learned-model-prediction"),
        file_ref(generated_lef, ctx.workspace, "generated_lef", "generated-abstract-collection"),
    ])
    ctx.inputs.extend([
        file_ref(DOMAIN / name, ctx.workspace, "pnr_method_template:" + name, "pack-method")
        for name in ("init.tcl.tmpl", "mmmc.tcl.tmpl", "pnr.tcl.tmpl")
    ])
    ctx.add_artifact(generated_lef, "generated_lef", "generated-abstract-collection")
    for other in ("foundry", "generated"):
        for kind in ("mmmc", "init", "pnr"):
            ctx.add_artifact(outputs[other][kind], "%s_script:%s" % (kind, other), "generated-tool-input")
    wrapper = str(ctx.file_binding("EDA_WRAPPER", "tool-wrapper"))
    init_links = checkpoint_allowed_links(ctx.inputs, ctx.workspace,
                                          chosen["init"], chosen["mmmc"], arm, "init")
    init_log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(chosen["init"])], cwd=ctx.run_dir,
                       timeout=int(ctx.binding("PNR_TIMEOUT_SEC")), tag="init-" + arm)
    text = init_log.read_text(errors="replace")
    if tool_error_lines(text):
        raise ToolFailure("Innovus init error in %s: %s" % (init_log, " | ".join(tool_error_lines(text)[:8])))
    init_version = innovus_version(text)
    visible_hits = re.findall(r"=== CCFMAX GENERATED_LIB_CELLS_AFTER_RESTORE (\d+) ===", text)
    visible = int(visible_hits[0]) if len(visible_hits) == 1 else None
    if arm == "generated" and (visible is None or visible <= 0):
        raise Rejected("generated library visibility was not proved after Innovus restore")
    init_restore = publish_checkpoint(ctx, chosen["init_checkpoint_base"],
                                      "init_checkpoint", init_links, "init")
    if str(init_restore) not in chosen["pnr"].read_text(errors="replace"):
        raise Rejected("PnR script does not restore the validated init checkpoint directory")
    pnr_log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(chosen["pnr"])], cwd=ctx.run_dir,
                      timeout=int(ctx.binding("PNR_TIMEOUT_SEC")), tag="pnr-" + arm)
    pnr_text = pnr_log.read_text(errors="replace")
    if tool_error_lines(pnr_text):
        raise ToolFailure("Innovus P&R error in %s: %s" % (pnr_log, " | ".join(tool_error_lines(pnr_text)[:8])))
    route_version = innovus_version(pnr_text)
    if init_version != route_version:
        raise Rejected("Innovus init and route tool versions differ")
    if ("=== CCFMAX PNR DONE %s (GDS written) ===" % arm) not in pnr_text:
        raise ToolFailure("Innovus P&R log lacks the completion marker for " + arm)
    rc_model = ctx.add_artifact(ctx.run_dir / "rc_model.bin", "postroute_rc_model",
                                "innovus-output")
    postroute_links = checkpoint_allowed_links(
        [*ctx.inputs, rc_model], ctx.workspace, chosen["init"], chosen["mmmc"],
        arm, "postroute")
    publish_checkpoint(ctx, chosen["final_checkpoint_base"],
                       "postroute_checkpoint", postroute_links, "postroute")
    timing_summary = ctx.run_dir / ("rpt_" + arm) / "postopt" / "post.summary.gz"
    timing_paths = ctx.run_dir / ("rpt_" + arm) / "postopt" / "post_all.tarpt.gz"
    timing = parse_timing_summary(timing_summary, timing_paths)
    if timing["analysisView"] != "view_" + arm:
        raise Rejected("post-route timing companion names the wrong analysis view")
    # Innovus 23.14 appends `_hold` to the prefix for hold-mode files.
    hold_summary = ctx.run_dir / ("rpt_" + arm) / "posthold" / "hold_hold.summary.gz"
    hold_paths = ctx.run_dir / ("rpt_" + arm) / "posthold" / "hold_all_hold.tarpt.gz"
    hold = parse_timing_summary(hold_summary, hold_paths, mode="Hold")
    route_drc = ctx.run_dir / ("rpt_" + arm) / "route.drc.rpt"
    connectivity = ctx.run_dir / ("rpt_" + arm) / "connectivity.rpt"
    power_report = ctx.run_dir / ("rpt_" + arm) / "power.rpt"
    gatecount_report = ctx.run_dir / ("rpt_" + arm) / "gatecount.rpt"
    route_summary = ctx.run_dir / ("rpt_" + arm) / "summary.rpt"
    route_drc_count = parse_drc(route_drc, 100000)
    connectivity_count = parse_connectivity(connectivity)
    secondary = parse_secondary_pnr(power_report, gatecount_report, route_summary)
    for at, role in ((chosen["gds"], "postroute_gds"),
                     (timing_summary, "postroute_timing_summary"),
                     (timing_paths, "postroute_timing_paths"),
                     (hold_summary, "postroute_hold_summary"),
                     (hold_paths, "postroute_hold_paths"),
                     (route_drc, "route_drc_report"),
                     (connectivity, "connectivity_report"),
                     (power_report, "postroute_power_report"),
                     (gatecount_report, "postroute_gatecount_report"),
                     (route_summary, "postroute_summary_report"),
                     (chosen["postroute_sdc"], "postroute_sdc")):
        ctx.add_artifact(at, role, "innovus-output")
    publish_condition_identity(ctx, {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "place-and-route",
        "commonInputs": held_identities(ctx.inputs, exact=(
            "TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH",
            "FOUNDRY_GDS", "CCFMAX_GDS_MAP", "EDA_WRAPPER",
            "pnr_method_template:init.tcl.tmpl", "pnr_method_template:mmmc.tcl.tmpl",
            "pnr_method_template:pnr.tcl.tmpl")),
        "scriptContractSha256": sha_bytes("\n".join(
            normalized_arm_script(chosen[kind].read_text(), referenced_paths(
                ctx.inputs, ctx.workspace, {"generated_liberty", "generated_lef"}))
            for kind in ("mmmc", "init", "pnr")
        ).encode()),
        "tool": init_version,
        "floorplanUtilization": float(utilization),
        "placeSite": str(ctx.binding("PLACE_SITE")),
        "armSpecificExclusions": ["generated_db", "generated_liberty", "generated_lef"],
    })
    ctx.facts.update({"arm": arm, "pnr_completed": 1, "library_visible": visible,
                      "hold_wns_ns": hold["setupWnsNs"], "hold_violating_paths": hold["setupViolatingPaths"],
                      "route_drc_violations": route_drc_count, "connectivity_violations": connectivity_count,
                      **secondary, "congestion_overflow": None,
                      "congestion_unknown_reason": "current Innovus summary has no verified congestion-overflow metric",
                      "arm_scripts_matched": True, "toolVersion": init_version,
                      "templateSha256": {name: sha_file(DOMAIN / name) for name in
                                         ("init.tcl.tmpl", "mmmc.tcl.tmpl", "pnr.tcl.tmpl")}})


def parse_drc(path, limit):
    text = Path(path).read_text(errors="replace")
    commands = re.findall(r"^#\s*Command:\s*verify_drc\s+([^\n]+)$", text, re.M)
    if len(commands) != 1 or not re.search(r"(?:^|\s)-limit\s+%d(?:\s|$)" % limit, commands[0]):
        raise Rejected("verify_drc report lacks the expected command/limit echo")
    totals = re.findall(r"Total Violations\s*:\s*(\d+)", text, re.I)
    clean = bool(re.search(r"No DRC violations were found", text, re.I))
    if clean and totals:
        raise Rejected("verify_drc report carries conflicting clean/count evidence")
    if not clean and len(totals) != 1:
        raise Rejected("verify_drc report has no unambiguous violation total")
    count = 0 if clean else int(totals[0])
    if count >= limit or re.search(r"truncat|maximum number", text, re.I):
        raise Rejected("verify_drc report is capped or truncated")
    return count


def parse_connectivity(path):
    text = Path(path).read_text(errors="replace")
    counts = [int(value) for value in re.findall(
        r"(?:Total(?: number of)? (?:connectivity )?violations|Total Violations)\s*[:=]\s*(\d+)", text, re.I)]
    counts.extend(int(value) for value in re.findall(r"^\s*(\d+)\s+Problem\(s\)", text, re.I | re.M))
    clean = bool(re.search(r"(?:no connectivity violations|0\s+connectivity violations)", text, re.I))
    if counts and len(set(counts)) != 1:
        raise Rejected("connectivity report carries conflicting violation totals")
    if counts:
        return counts[0]
    if clean:
        return 0
    raise Rejected("connectivity report has no unambiguous violation total")


def parse_secondary_pnr(power_path, gatecount_path, summary_path):
    power = Path(power_path).read_text(errors="replace")
    gatecount = Path(gatecount_path).read_text(errors="replace")
    summary = Path(summary_path).read_text(errors="replace")
    if len(re.findall(r"Power Units\s*=\s*1mW", power)) != 1:
        raise Rejected("post-route power report does not declare one 1mW unit")
    totals = re.findall(r"^Total Power:\s*([0-9.eE+-]+)\s*$", power, re.M)
    gates = re.findall(r"^\[0\]\s+\S+\s+Gates=(\d+)\s+Cells=(\d+)\s+Area=([0-9.eE+-]+)\s+um\^2\s*$", gatecount, re.M)
    instances = re.findall(r"^# Instances:\s*(\d+)\s*$", summary, re.M)
    density = re.findall(r"^% Pure Gate Density #6 .*:\s*([0-9.eE+-]+)%\s*$", summary, re.M)
    if len(totals) != 1 or len(gates) != 1 or len(instances) != 1 or len(density) != 1:
        raise Rejected("post-route power, gate-count or density report has no unambiguous summary")
    values = [float(totals[0]), float(gates[0][2]), float(density[0])]
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise Rejected("post-route power, area or density is not a finite nonnegative value")
    return {"postroute_power_mw": values[0], "gate_count": int(gates[0][0]),
            "cell_count": int(gates[0][1]), "postroute_cell_area_um2": values[1],
            "route_instance_count": int(instances[0]), "route_density_pct": values[2]}


def stage_verify(ctx):
    total = 0
    per_arm = {}
    final_db = {}
    limit = int(ctx.binding("DRC_LIMIT"))
    wrapper = str(ctx.binding("EDA_WRAPPER"))
    for arm, stage in (("foundry", "pnr-foundry"), ("generated", "pnr-generated")):
        pnr_record = prior(ctx, stage)
        links = pnr_record_allowed_links(pnr_record, ctx.workspace, arm, "postroute")
        db = validate_checkpoint(artifact(pnr_record, ctx.workspace, "postroute_checkpoint"),
                                 ctx.workspace, links, "postroute")
        report = ctx.run_dir / (arm + "_verify_drc.rpt")
        timing_dir = ctx.run_dir / (arm + "_final_db_timing")
        script = ctx.run_dir / (arm + "_verify.tcl")
        script.write_text(
            "restoreDesign {%s} {%s}\nfile mkdir {%s}\nsetAnalysisMode -analysisType onChipVariation -cppr both\n"
            "timeDesign -postRoute -outDir {%s} -prefix final\nset_verify_drc_mode -check_only cell -limit %d\n"
            "set _xs_libcells [get_lib_cells -quiet \"*/%s\"]\n"
            "puts \"=== CUSTOM_CELL_FMAX VERIFY_LIBRARY_VISIBLE [sizeof_collection $_xs_libcells] ===\"\n"
            "set _xs_insts [dbGet -e top.insts.cell.name %s -p2]\n"
            "puts \"=== CUSTOM_CELL_FMAX FINAL_DB_INSTANCE_COUNT [llength $_xs_insts] ===\"\n"
            "verify_drc -limit %d -report {%s}\n"
            "puts \"=== CUSTOM_CELL_FMAX VERIFY_COMPLETE %s ===\"\nexit\n" %
            (db, ctx.binding("DESIGN_TOP"), timing_dir, timing_dir, limit, ctx.binding("GENERATED_LIB_CELL_PATTERN"),
             ctx.binding("GENERATED_LIB_CELL_PATTERN"),
             limit, report, arm))
        ctx.add_artifact(script, "verify_script:" + arm, "generated-tool-input")
        log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(script)], cwd=ctx.run_dir,
                      timeout=int(ctx.binding("VERIFY_TIMEOUT_SEC")), tag="verify-" + arm)
        log_text = log.read_text(errors="replace")
        if tool_error_lines(log_text):
            raise ToolFailure("verification returned zero but emitted an error line for " + arm)
        if ("=== CUSTOM_CELL_FMAX VERIFY_COMPLETE %s ===" % arm) not in log_text:
            raise ToolFailure("verify session did not reach completion for " + arm)
        if arm == "generated":
            hits = re.findall(r"=== CUSTOM_CELL_FMAX VERIFY_LIBRARY_VISIBLE (\d+) ===", log_text)
            if len(hits) != 1 or int(hits[0]) <= 0:
                raise Rejected("generated library was not visible in verification session")
        instance_hits = re.findall(r"=== CUSTOM_CELL_FMAX FINAL_DB_INSTANCE_COUNT (\d+) ===", log_text)
        if len(instance_hits) != 1:
            raise Rejected("final route database instance census is missing or ambiguous for " + arm)
        final_instances = int(instance_hits[0])
        final_summary = timing_dir / "final.summary.gz"
        final_paths = timing_dir / "final_all.tarpt.gz"
        final_timing = parse_timing_summary(final_summary, final_paths)
        count = parse_drc(report, limit)
        ctx.add_artifact(report, "verify_drc_report:" + arm, "innovus-verification-report")
        ctx.add_artifact(final_summary, "final_db_timing_summary:" + arm, "innovus-restored-database-report")
        ctx.add_artifact(final_paths, "final_db_timing_paths:" + arm, "innovus-restored-database-report")
        per_arm[arm] = count
        final_db[arm] = {"customInstances": final_instances, "timing": final_timing}
        total += count
    ctx.facts.update({"verification_error_count": total, "verification_errors_by_arm": per_arm,
                      "final_database": final_db,
                      "verification_method": "restored final database timing, instance census and verify_drc with explicit cell-only mode"})


def report_text(path):
    path = Path(path)
    try:
        raw = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
        return raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise Rejected("cannot decode complete timing report %s: %s" % (path, exc)) from exc


def parse_timing_summary(path, companion, mode="Setup"):
    text = report_text(path)
    path_text = report_text(companion)
    summary_commands = re.findall(r"^#\s+Command:\s+(.+?)\s*$", text, re.M)
    path_commands = re.findall(r"^#\s+Command:\s+(.+?)\s*$", path_text, re.M)
    if len(summary_commands) != 1 or summary_commands != path_commands:
        raise Rejected("timing summary and path report lack one identical timeDesign command")
    header = None
    for line in text.splitlines():
        if "|" not in line:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[0] == mode + " mode" and cells[1] == "all":
            header = cells[1:]
            break
    if header is None or "all" not in header:
        raise Rejected("post-route timeDesign summary has no %s all-mode header" % mode.lower())
    views = set(re.findall(r"^Analysis View:\s*(\S+)\s*$", path_text, re.M))
    rows = {}
    for line in text.splitlines():
        if "|" not in line or ":" not in line:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        label = cells[0].rstrip(":").strip()
        if label not in ("WNS (ns)", "TNS (ns)", "Violating Paths", "All Paths"):
            continue
        values = {}
        for index, column in enumerate(header):
            raw = cells[index + 1] if index + 1 < len(cells) else ""
            values[column] = None if raw in ("", "-", "N/A") else float(raw)
        rows[label] = values
    if "WNS (ns)" not in rows or rows["WNS (ns)"].get("all") is None:
        raise Rejected("post-route timeDesign summary has no observed all-mode WNS")
    violating = (rows.get("Violating Paths") or {}).get("all")
    if (not isinstance(violating, (int, float)) or not math.isfinite(violating)
            or violating < 0 or not float(violating).is_integer()):
        raise Rejected("post-route timeDesign summary has no finite nonnegative integer setup/all violating-path count")
    if len(views) != 1:
        raise Rejected("post-route path report has no unambiguous setup analysis view")
    path_one = re.search(r"^Path 1:.*?^= Slack Time\s+([0-9.eE+-]+)\s*$", path_text, re.M | re.S)
    if path_one is None or not math.isfinite(float(path_one.group(1))):
        raise Rejected("post-route path report has no finite Path 1 setup slack")
    wns = rows["WNS (ns)"]["all"]
    if wns != float(path_one.group(1)):
        raise Rejected("post-route summary WNS differs from Path 1 slack")
    return {"analysisView": next(iter(views)), "setupWnsNs": wns,
            "setupViolatingPaths": int(violating),
            "command": summary_commands[0], "rows": rows}


def parse_sdc_period(path):
    text = Path(path).read_text(errors="replace")
    periods = [float(value) for value in re.findall(r"\bcreate_clock\b[^\n]*\s-period\s+([0-9.eE+-]+)", text)]
    if not periods or any(not value > 0 for value in periods) or len(set(periods)) != 1:
        raise Rejected("PnR-bound SDC has no single positive clock period")
    return periods[0]


def pnr_input_sdc_identity(path):
    text = Path(path).read_text()
    header = re.compile(r"^# Created by write_sdc on [^\r\n]+$", re.M)
    if len(header.findall(text)) != 1:
        raise Rejected("PnR-input SDC lacks one recognized volatile write_sdc header")
    stable = header.sub("# Created by write_sdc on <volatile>", text, count=1)
    raw = stable.encode()
    return {"sha256": sha_bytes(raw), "bytes": len(raw),
            "canonicalization": "one write_sdc creation-time comment"}


def parse_mmmc(path):
    text = Path(path).read_text(errors="replace")
    mode = re.findall(r"create_constraint_mode\s+-name\s+(\S+)\s+-sdc_files\s+\[list\s+([^\]]+)\]", text)
    view = re.findall(r"create_analysis_view\s+-name\s+(\S+)\s+-constraint_mode\s+(\S+)\s+-delay_corner\s+(\S+)", text)
    active = re.findall(r"set_analysis_view\s+-setup\s+\{([^}]+)\}\s+-hold\s+\{([^}]+)\}", text)
    qrc = re.findall(r"create_rc_corner\b[^\n]*-qx_tech_file\s+(\S+)\s+-temperature\s+(\S+)", text)
    libraries = re.findall(r"create_library_set\s+-name\s+(\S+)\s+-timing\s+\[list\s+([^\]]+)\]", text)
    if not all(len(rows) == 1 for rows in (mode, view, active, qrc, libraries)):
        raise Rejected("MMMC script does not declare one complete analysis view")
    return {"constraintMode": mode[0][0], "sdc": mode[0][1].strip(), "view": view[0][0],
            "delayCorner": view[0][2], "activeSetup": active[0][0], "activeHold": active[0][1],
            "qrc": qrc[0][0], "temperature": qrc[0][1], "librarySet": libraries[0][0],
            "libraries": libraries[0][1].split()}


def execution_log(record, workspace, role):
    hits = [row.get("log") for row in record.get("executions", [])
            if isinstance(row.get("log"), dict) and row["log"].get("role") == role]
    if len(hits) != 1:
        raise Rejected("record must contain exactly one execution log %s" % role)
    return checked_ref(hits[0], workspace, role)


def role_refs(record, prefix):
    return [ref for ref in record.get("inputs", []) if str(ref.get("role", "")).startswith(prefix)]


def derived_synth_condition(record, workspace, arm):
    entry = artifact(record, workspace, "synthesis_entry")
    log = execution_log(record, workspace, arm + "-dc_log")
    return {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "synthesis",
        "commonInputs": held_identities(record.get("inputs", []),
            exact=("FOUNDRY_DB", "shared_synth_template", "shared_synth_constraints", "EDA_WRAPPER"),
            prefixes=("rtl:",)),
        "entryContractSha256": sha_bytes(normalized_synth_entry(entry.read_text()).encode()),
        "tool": dc_version(log.read_text(errors="replace")),
        "armSpecificExclusions": ["CCFMAX_ARM", "CCFMAX_CUSTOM_DB", "generated_db"],
    }


def derived_pnr_condition(record, workspace, arm):
    scripts = {kind: artifact(record, workspace, "%s_script:%s" % (kind, arm))
               for kind in ("mmmc", "init", "pnr")}
    init_tool = innovus_version(execution_log(record, workspace, "init-" + arm + "_log").read_text(errors="replace"))
    route_tool = innovus_version(execution_log(record, workspace, "pnr-" + arm + "_log").read_text(errors="replace"))
    if init_tool != route_tool:
        raise Rejected("Innovus init and route tool versions differ in held evidence")
    excluded = referenced_paths(record.get("inputs", []), workspace,
                                {"generated_liberty", "generated_lef"})
    floorplan = re.findall(r"(?m)^\s*floorPlan\s+-site\s+(\S+)\s+-r\s+1\.0\s+([0-9.]+)\s+2\.0\s+2\.0\s+2\.0\s+2\.0\s*$", scripts["init"].read_text(errors="replace"))
    if len(floorplan) != 1 or not (0.2 <= float(floorplan[0][1]) <= 0.8):
        raise Rejected("PnR init script lacks one declared Site/place utilization")
    place_site, utilization = floorplan[0]
    published = record.get("facts", {}).get("floorplan_utilization")
    if not isinstance(published, (int, float)) or float(published) != float(utilization):
        raise Rejected("PnR record utilization disagrees with generated init script")
    return {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "place-and-route",
        "commonInputs": held_identities(record.get("inputs", []), exact=(
            "TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH",
            "FOUNDRY_GDS", "CCFMAX_GDS_MAP", "EDA_WRAPPER",
            "pnr_method_template:init.tcl.tmpl", "pnr_method_template:mmmc.tcl.tmpl",
            "pnr_method_template:pnr.tcl.tmpl")),
        "scriptContractSha256": sha_bytes("\n".join(
            normalized_arm_script(scripts[kind].read_text(), excluded) for kind in ("mmmc", "init", "pnr")
        ).encode()),
        "tool": init_tool,
        "floorplanUtilization": float(utilization),
        "placeSite": place_site,
        "armSpecificExclusions": ["generated_db", "generated_liberty", "generated_lef"],
    }


def validate_condition_artifact(record, workspace, derived):
    published = read_json(artifact(record, workspace, "common_condition_identity"))
    if published != derived:
        raise Rejected("published common-condition identity disagrees with held inputs/scripts/logs")
    return derived


def stage_compare(ctx):
    unknown_reasons = []
    observations = {}
    try:
        foundry_synth = prior(ctx, "foundry-synth")
        custom_synth = prior(ctx, "custom-synth")
        foundry_pnr = prior(ctx, "pnr-foundry")
        generated_pnr = prior(ctx, "pnr-generated")
        verify = prior(ctx, "verify")
        characterize = prior(ctx, "characterize")
        for name in ("foundry-synth", "custom-synth", "pnr-foundry", "pnr-generated", "verify", "characterize"):
            source_record = ctx.flow / "records" / (name + ".json")
            snapshot = ctx.run_dir / ("source-" + name + "-record.json")
            snapshot.write_bytes(source_record.read_bytes())
            ctx.inputs.append(file_ref(snapshot, ctx.workspace,
                                       "source_stage_record:" + name, "stage-record"))

        # Re-derive common identities from held files and raw tool logs. The published identity is
        # only an audit artifact and must agree; it is never trusted as the source of the match.
        foundry_synth_condition = validate_condition_artifact(
            foundry_synth, ctx.workspace, derived_synth_condition(foundry_synth, ctx.workspace, "base"))
        custom_synth_condition = validate_condition_artifact(
            custom_synth, ctx.workspace, derived_synth_condition(custom_synth, ctx.workspace, "custom"))
        synth_method_matched = foundry_synth_condition == custom_synth_condition

        pnr_rows = {}
        for arm, record in (("foundry", foundry_pnr), ("generated", generated_pnr)):
            init_links = pnr_record_allowed_links(record, ctx.workspace, arm, "init")
            postroute_links = pnr_record_allowed_links(record, ctx.workspace, arm, "postroute")
            validate_checkpoint(artifact(record, ctx.workspace, "init_checkpoint"),
                                ctx.workspace, init_links, "init")
            validate_checkpoint(artifact(record, ctx.workspace, "postroute_checkpoint"),
                                ctx.workspace, postroute_links, "postroute")
            summary = artifact(verify, ctx.workspace, "final_db_timing_summary:" + arm)
            timing_paths = artifact(verify, ctx.workspace, "final_db_timing_paths:" + arm)
            mmmc = artifact(record, ctx.workspace, "mmmc_script:" + arm)
            init = artifact(record, ctx.workspace, "init_script:" + arm)
            pnr_script = artifact(record, ctx.workspace, "pnr_script:" + arm)
            parsed_mmmc = parse_mmmc(mmmc)
            input_sdc = Path(parsed_mmmc["sdc"]).resolve()
            actual_sdc = artifact(record, ctx.workspace, "postroute_sdc")
            if not input_sdc.is_file() or input_sdc.is_symlink():
                raise Rejected("%s PnR-bound SDC is absent" % arm)
            input_clock = parse_sdc_period(input_sdc)
            actual_clock = parse_sdc_period(actual_sdc)
            if actual_clock != input_clock:
                raise Rejected("%s actual post-route clock differs from the PnR input SDC" % arm)
            timing = parse_timing_summary(summary, timing_paths)
            if timing["analysisView"] != parsed_mmmc["view"] or parsed_mmmc["activeSetup"] != parsed_mmmc["view"]:
                raise Rejected("%s post-route report analysis view differs from its MMMC view" % arm)
            hold = parse_timing_summary(artifact(record, ctx.workspace, "postroute_hold_summary"),
                                        artifact(record, ctx.workspace, "postroute_hold_paths"), mode="Hold")
            route_drc = parse_drc(artifact(record, ctx.workspace, "route_drc_report"), 100000)
            connectivity = parse_connectivity(artifact(record, ctx.workspace, "connectivity_report"))
            physical = {"hold_wns_ns": hold["setupWnsNs"], "hold_violating_paths": hold["setupViolatingPaths"],
                        "route_drc_violations": route_drc, "connectivity_violations": connectivity}
            for key, actual in physical.items():
                if record.get("facts", {}).get(key) != actual:
                    raise Rejected("%s PnR physical fact disagrees with retained report: %s" % (arm, key))
            pnr_rows[arm] = {"timing": timing, "physical": physical, "mmmc": parsed_mmmc, "clockNs": actual_clock,
                             "inputSdcIdentity": pnr_input_sdc_identity(input_sdc),
                             "initText": init.read_text(errors="replace"),
                             "pnrText": pnr_script.read_text(errors="replace")}
            ctx.inputs.extend([file_ref(summary, ctx.workspace, arm + "_final_db_timing", "innovus-restored-database-report"),
                               file_ref(timing_paths, ctx.workspace, arm + "_final_db_timing_paths", "innovus-restored-database-report"),
                               file_ref(mmmc, ctx.workspace, arm + "_mmmc", "generated-tool-input"),
                               file_ref(input_sdc, ctx.workspace, arm + "_pnr_sdc", "design-compiler-output"),
                               file_ref(actual_sdc, ctx.workspace, arm + "_postroute_sdc", "innovus-output"),
                               file_ref(init, ctx.workspace, arm + "_pnr_init_script", "generated-tool-input"),
                               file_ref(pnr_script, ctx.workspace, arm + "_pnr_route_script", "generated-tool-input")])
            for source_role, compare_role in (("postroute_hold_summary", arm + "_hold_summary"),
                                               ("postroute_hold_paths", arm + "_hold_paths"),
                                               ("route_drc_report", arm + "_route_drc"),
                                               ("connectivity_report", arm + "_connectivity"),
                                               ("postroute_power_report", arm + "_power"),
                                               ("postroute_gatecount_report", arm + "_gatecount"),
                                               ("postroute_summary_report", arm + "_route_summary")):
                ctx.inputs.append(file_ref(artifact(record, ctx.workspace, source_role), ctx.workspace,
                                           compare_role, "innovus-output"))

        left, right = pnr_rows["foundry"], pnr_rows["generated"]
        foundry_pnr_condition = validate_condition_artifact(
            foundry_pnr, ctx.workspace, derived_pnr_condition(foundry_pnr, ctx.workspace, "foundry"))
        generated_pnr_condition = validate_condition_artifact(
            generated_pnr, ctx.workspace, derived_pnr_condition(generated_pnr, ctx.workspace, "generated"))
        pnr_method_matched = (
            foundry_pnr_condition == generated_pnr_condition
            and left["clockNs"] == right["clockNs"]
            and left["inputSdcIdentity"] == right["inputSdcIdentity"]
            and left["mmmc"]["qrc"] == right["mmmc"]["qrc"]
            and left["mmmc"]["temperature"] == right["mmmc"]["temperature"]
        )
        requested_clock = right["clockNs"]

        # PnR and verification session logs, not declaration fields, prove model liveness.
        init_log = execution_log(generated_pnr, ctx.workspace, "init-generated_log").read_text(errors="replace")
        visible_hits = re.findall(r"=== CCFMAX GENERATED_LIB_CELLS_AFTER_RESTORE (\d+) ===", init_log)
        pnr_visible = int(visible_hits[0]) if len(visible_hits) == 1 else None
        verify_log = execution_log(verify, ctx.workspace, "verify-generated_log").read_text(errors="replace")
        verify_visible_hits = re.findall(r"=== CUSTOM_CELL_FMAX VERIFY_LIBRARY_VISIBLE (\d+) ===", verify_log)
        verify_visible = int(verify_visible_hits[0]) if len(verify_visible_hits) == 1 else None

        generated_lib = artifact(characterize, ctx.workspace, "generated_liberty")
        ctx.inputs.extend([
            file_ref(execution_log(generated_pnr, ctx.workspace, "init-generated_log"), ctx.workspace,
                     "generated_pnr_init_log", "tool-log"),
            file_ref(execution_log(verify, ctx.workspace, "verify-generated_log"), ctx.workspace,
                     "generated_verify_log", "tool-log"),
            file_ref(generated_lib, ctx.workspace, "offered_library", "learned-model-prediction"),
        ])
        final_database = verify.get("facts", {}).get("final_database", {})
        generated_final = final_database.get("generated") if isinstance(final_database, dict) else None
        final_adopted = generated_final.get("customInstances") if isinstance(generated_final, dict) else None
        if not isinstance(final_adopted, int) or final_adopted < 0:
            raise Rejected("final route database has no verified custom Cell instance census")

        verification_errors = 0
        for arm in ("foundry", "generated"):
            report = artifact(verify, ctx.workspace, "verify_drc_report:" + arm)
            script = artifact(verify, ctx.workspace, "verify_script:" + arm)
            ctx.inputs.extend([
                file_ref(report, ctx.workspace, arm + "_verify_drc", "innovus-verification-report"),
                file_ref(script, ctx.workspace, arm + "_verify_script", "generated-tool-input"),
            ])
            script_text = script.read_text(errors="replace")
            limits = re.findall(r"verify_drc\s+-limit\s+(\d+)", script_text)
            modes = re.findall(r"set_verify_drc_mode\s+-check_only\s+(\S+)", script_text)
            if len(limits) != 1 or modes != ["cell"]:
                raise Rejected("%s verification did not use one explicit cell-only checker" % arm)
            verification_errors += parse_drc(report, int(limits[0]))

        generated_wns = right["timing"]["setupWnsNs"]
        foundry_wns = left["timing"]["setupWnsNs"]
        matched = synth_method_matched and pnr_method_matched
        library_visible = pnr_visible is not None and pnr_visible > 0 and verify_visible is not None and verify_visible > 0
        setup_open = generated_wns < 0 or right["timing"]["setupViolatingPaths"] > 0
        foundry_closed_period = requested_clock - foundry_wns
        generated_closed_period = requested_clock - generated_wns
        if foundry_closed_period <= 0 or generated_closed_period <= 0:
            raise Rejected("post-route slack implies a nonpositive closed period")
        foundry_fmax_mhz = 1000.0 / foundry_closed_period
        generated_fmax_mhz = 1000.0 / generated_closed_period
        fmax_delta_mhz = generated_fmax_mhz - foundry_fmax_mhz
        fmax_improved = fmax_delta_mhz > 0
        physical_failures = 0
        for arm in ("foundry", "generated"):
            physical = pnr_rows[arm]["physical"]
            physical_failures += int(physical["route_drc_violations"])
            physical_failures += int(physical["connectivity_violations"])
            physical_failures += int(physical["hold_violating_paths"])
            if float(physical["hold_wns_ns"]) < 0:
                physical_failures += 1
        failures = sum((not matched, setup_open, not library_visible,
                        final_adopted <= 0, verification_errors != 0, not fmax_improved)) + physical_failures
        observations.update({
            "clock_period": requested_clock,
            "setup_wns": generated_wns,
            "foundry_setup_wns": foundry_wns,
            "setup_wns_delta": generated_wns - foundry_wns,
            "matched_conditions": matched,
            "library_visible": library_visible,
            "adopted_instance_count": final_adopted,
            "verification_error_count": verification_errors,
            "foundry_fmax_mhz": foundry_fmax_mhz,
            "generated_fmax_mhz": generated_fmax_mhz,
            "fmax_delta_mhz": fmax_delta_mhz,
            "fmax_improved": fmax_improved,
            "full_constraint_failures": failures,
            "unknownReason": None,
            "analysisViews": {arm: pnr_rows[arm]["timing"]["analysisView"] for arm in pnr_rows},
            "measurementScope": "same requested period; setup slack and custom-instance census are re-read after restoring each final route database",
        })
    except (Rejected, ValueError, KeyError, IndexError, TypeError) as exc:
        unknown_reasons.append(str(exc))
        observations.update({"clock_period": None, "setup_wns": None, "foundry_setup_wns": None,
                             "setup_wns_delta": None, "matched_conditions": None,
                             "library_visible": None, "adopted_instance_count": None,
                             "foundry_fmax_mhz": None, "generated_fmax_mhz": None,
                             "fmax_delta_mhz": None, "fmax_improved": None,
                             "verification_error_count": None, "full_constraint_failures": None,
                             "unknownReason": unknown_reasons,
                             "measurementScope": "post-route comparison unavailable; synthesis timing is not substituted"})
    comparison = ctx.run_dir / "comparison.json"
    atomic_json(comparison, observations)
    ctx.add_artifact(comparison, "comparison", "derived-from-held-postroute-evidence")
    ctx.facts.update(observations)


def dispatch(ctx, stage, route):
    if stage == "mine":
        stage_mine(ctx, route)
    elif stage == "merge":
        stage_merge(ctx)
    elif stage == "generate":
        stage_generate(ctx)
    elif stage == "layout":
        stage_layout(ctx)
    elif stage == "characterize":
        stage_characterize(ctx)
    elif stage == "compile":
        stage_compile(ctx)
    elif stage == "foundry-synth":
        stage_synth(ctx, False)
    elif stage == "custom-synth":
        stage_synth(ctx, True)
    elif stage == "adoption":
        stage_adoption(ctx)
    elif stage == "pnr-foundry":
        stage_pnr(ctx, "foundry", route or "0.60")
    elif stage == "pnr-generated":
        stage_pnr(ctx, "generated", route or "0.60")
    elif stage == "verify":
        stage_verify(ctx)
    elif stage == "compare":
        stage_compare(ctx)
    elif stage == "compare":
        stage_compare(ctx)
    else:
        raise Rejected("stage must be one of: " + ",".join(STAGES))


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) not in (2, 3):
        print("usage: stages.py STAGE WORKSPACE [ROUTE for mine]", file=sys.stderr)
        return 2
    stage, workspace = args[:2]
    route = args[2] if len(args) == 3 else None
    record_stage = "mine-" + route if stage == "mine" and route else stage
    ctx = None
    try:
        if stage not in ("mine", "pnr-foundry", "pnr-generated") and route is not None:
            raise Rejected("third argument is accepted only for mine or P&R utilization")
        if stage == "mine" and route is None:
            raise Rejected("mine requires ROUTE")
        ctx = Context(record_stage, workspace)
        dispatch(ctx, stage, route)
        ctx.write("passed")
        print(json.dumps({"stage": record_stage, "status": "passed", "record": str(ctx.record_path)}))
        return 0
    except Rejected as exc:
        if ctx is None:
            try:
                ctx = Context(record_stage, workspace)
            except Exception:
                print("REJECTED: " + str(exc), file=sys.stderr)
                return 2
        ctx.write("rejected", str(exc))
        print("REJECTED: " + str(exc), file=sys.stderr)
        return 2
    except ToolFailure as exc:
        if ctx is not None:
            ctx.write("tool-failure", str(exc))
        print("TOOL FAILURE: " + str(exc), file=sys.stderr)
        return 3
    except Exception as exc:
        if ctx is not None:
            ctx.write("rejected", "%s: %s" % (type(exc).__name__, exc))
        print("REJECTED: %s: %s" % (type(exc).__name__, exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
