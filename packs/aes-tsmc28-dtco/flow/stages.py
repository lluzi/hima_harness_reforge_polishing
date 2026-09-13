#!/usr/bin/env python3
"""Executable PLS-25 domain stages for one private AES/TSMC28 Campaign workspace.

Every stage reads Site-private ``flow/inputs.json`` and writes one evidence record.
The adapters invoke real dependency CLIs. Tests may bind explicit synthetic fixtures,
which remain labelled by the required ``evidenceClass`` input.
"""
from __future__ import annotations

import glob
import difflib
import hashlib
import json
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


SCHEMA = "aes-dtco-stage/1"
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
        if not isinstance(self.inputs_doc, dict) or not isinstance(self.inputs_doc.get("legacy"), dict):
            raise Rejected("flow/inputs.json must be an object with a legacy object")
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
            "DESIGN_TOP": "design", "DESIGN_RTL_GLOB": "rtlGlob",
            "FOUNDRY_DB": "foundryDb", "EDA_WRAPPER": "edaWrapper",
        }
        value = self.inputs_doc.get(aliases.get(name, ""))
        if value in (None, ""):
            value = self.inputs_doc["legacy"].get(name)
        if value in (None, ""):
            raise Rejected("missing Site input legacy.%s" % name)
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
            "scope": "AES/TSMC28 Pack domain evidence; no silicon or cross-design PPA claim",
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
    if probe.get("format") != "aes-probe/2" or probe.get("toolExit") != 0:
        raise Rejected("flow/probe.json is not a successful immutable AES probe")
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
    ctx.facts.update({
        "route": route, "candidate_count": len(requests),
        "codeSha256": code_hash, "sourceNetlistSha256": sha_file(netlist),
    })


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
        raise Rejected("legacy.MAX_CELLS must be the pilot value 1 or 2")
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
        raise Rejected("merged candidates exceed legacy.MAX_CELLS")
    pdk = ctx.file_binding("BOOL2CMOS_PDK_PROFILE")
    command = shlex.split(str(ctx.binding("BOOL2CMOS_CMD")))
    if not command:
        raise Rejected("legacy.BOOL2CMOS_CMD is empty")
    cwd = Path(str(ctx.binding("BOOL2CMOS_CWD"))).resolve()
    if not cwd.is_dir():
        raise Rejected("legacy.BOOL2CMOS_CWD is not a directory")
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
    helpers = str(ctx.binding("XS28_CHARMODEL_HELPER_DIR"))
    for item in helpers.split(":"):
        if not Path(item).is_dir():
            raise Rejected("legacy.XS28_CHARMODEL_HELPER_DIR contains missing directory: " + item)
    return {"XS28_CHARMODEL_HELPER_DIR": helpers}


def stage_layout(ctx):
    _record, cells = generated_spice(ctx)
    tech = ctx.file_binding("LIBRECELL_TECH_PY")
    rules = ctx.file_binding("GEOMETRY_RULE_DECK")
    env = helper_env(ctx)
    for name in ("XS28_CONTAINER_RUNTIME", "XS28_CONTAINER_IMAGE", "XS28_CONTAINER_HOST_ROOT",
                 "XS28_CONTAINER_MOUNT_POINT", "XS28_LCLAYOUT_ACTIVATE"):
        env[name] = str(ctx.binding(name))
    power, ground = str(ctx.binding("XS28_POWER_PIN")), str(ctx.binding("XS28_GROUND_PIN"))
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
        matches = [Path(folder) / module for folder in env["XS28_CHARMODEL_HELPER_DIR"].split(":")
                   if (Path(folder) / module).is_file()]
        if len(matches) != 1:
            raise Rejected("Site helper %s must resolve exactly once through helperDirs" % module)
        ctx.inputs.append(file_ref(matches[0], ctx.workspace, "charmodel_helper:" + module, "site-helper"))
    env.update({"XS28_POWER_TEMPLATE_BASE_CELL": str(ctx.binding("XS28_POWER_TEMPLATE_BASE_CELL")),
                "XS28_POWER_PIN": str(ctx.binding("XS28_POWER_PIN")),
                "XS28_GROUND_PIN": str(ctx.binding("XS28_GROUND_PIN"))})
    prediction_dir = ctx.run_dir / "predictions"
    prediction_manifest = ctx.run_dir / "prediction-executions.json"
    argv = ["/usr/bin/python3", str(DOMAIN / "charlib_emit.py"), "--netlist-dir", str(cells[0].parent),
            "--base", str(base), "--timing-model", str(timing), "--power-model", str(power),
            "--area-model", str(area), "--power-pin", env["XS28_POWER_PIN"],
            "--ground-pin", env["XS28_GROUND_PIN"], "--library-name", str(ctx.binding("GENERATED_LIBRARY_NAME")),
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
    script.write_text("read_lib {%s}\nputs \"=== AES_DTCO LC READ COMPLETE ===\"\n"
                      "check_library\nputs \"=== AES_DTCO LC CHECK COMPLETE ===\"\n"
                      "write_lib -format db %s -output {%s}\n"
                      "puts \"=== AES_DTCO LC WRITE COMPLETE ===\"\nexit\n" % (liberty, name, db))
    ctx.add_artifact(script, "lc_script", "generated-tool-input")
    wrapper = str(ctx.binding("EDA_WRAPPER"))
    log = ctx.run([wrapper, "lc_shell", "-f", str(script)], timeout=int(ctx.binding("LC_TIMEOUT_SEC")), tag="lc")
    text = log.read_text(errors="replace")
    markers = ("LC READ COMPLETE", "LC CHECK COMPLETE", "LC WRITE COMPLETE")
    tool_errors = re.findall(r"^(?:Error|Fatal):.*$", text, re.M | re.I)
    rejected_library = re.search(r"\b(?:library|cell)\b[^\n]*(?:rejected|failed validation|not accepted)", text, re.I)
    if (tool_errors or rejected_library
            or any(("=== AES_DTCO " + marker + " ===") not in text for marker in markers)
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
    ctx.inputs.extend([
        file_ref(DOMAIN / "shared_synth.tcl", ctx.workspace, "shared_synth_template", "pack-method"),
        file_ref(DOMAIN / "shared_constraints.sdc", ctx.workspace, "shared_synth_constraints", "pack-method"),
    ])
    custom_db = artifact(prior(ctx, "compile"), ctx.workspace, "generated_db") if custom else None
    if custom_db:
        ctx.inputs.append(file_ref(custom_db, ctx.workspace, "generated_db", "library-compiler-output"))
    arm = "custom" if custom else "base"
    for folder in (ctx.run_dir / "results", ctx.run_dir / "reports", ctx.run_dir / "work"):
        folder.mkdir()
    values = {
        "DESIGN_TOP": ctx.binding("DESIGN_TOP"), "DESIGN_RTL_GLOB": rtl_glob,
        "FOUNDRY_DB": foundry, "CLK_NS": ctx.binding("CLOCK_NS"), "XS28_ARM": arm,
        "XS28_SDC": DOMAIN / "shared_constraints.sdc",
        "XS28_GENERATED_LIB_CELL_PATTERN": ctx.binding("GENERATED_LIB_CELL_PATTERN"),
        "XS28_WORK_DIR": ctx.run_dir / "work", "XS28_REPORT_DIR": ctx.run_dir / "reports",
    }
    if custom_db:
        values["XS28_CUSTOM_DB"] = custom_db
    entry = ctx.run_dir / "entry.tcl"
    entry.write_text("\n".join("set ::env(%s) %s" % (key, tcl_string(value))
                               for key, value in sorted(values.items()))
                     + "\nsource %s\n" % tcl_string(DOMAIN / "shared_synth.tcl"))
    ctx.add_artifact(entry, "synthesis_entry", "generated-tool-input")
    wrapper = str(ctx.binding("EDA_WRAPPER"))
    log = ctx.run([wrapper, "dc_shell", "-f", str(entry)], cwd=ctx.run_dir,
                  timeout=int(ctx.binding("SYNTH_TIMEOUT_SEC")), tag=arm + "-dc")
    text = log.read_text(errors="replace")
    if tool_error_lines(text):
        raise ToolFailure("DC returned zero but emitted an error line")
    marker = re.findall(r"=== AES_DTCO LIBRARY_VISIBLE_COUNT (\d+) ===", text)
    if len(marker) != 1 or ("=== AES_DTCO SYNTHESIS_COMPLETE %s ===" % arm) not in text:
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
    ctx.facts.update({
        "arm": "generated" if custom else "foundry", "library_visible": visible,
        "clock_ns": float(ctx.binding("CLOCK_NS")),
        "templateSha256": sha_file(DOMAIN / "shared_synth.tcl"),
        "constraintsSha256": sha_file(DOMAIN / "shared_constraints.sdc"),
        "rtlSha256": [sha_file(at) for at in rtl],
        "librarySetSha256": [sha_file(foundry)] + ([sha_file(custom_db)] if custom_db else []),
        "wrapper": wrapper,
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


def normalized_arm_script(text):
    text = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    text = re.sub(r"\s+/[^\s{}\]]+/generated\.(?:lib|lef)", "", text)
    text = re.sub(r"/[^\s{}\]]+/flow/artifacts/pnr-(?:foundry|generated)/run-[0-9a-f]+", "@RUN@", text)
    text = re.sub(r"/[^\s{}\]]+/(?:base|custom)\.dc\.(?:v|sdc)", "@SYNTH@", text)
    text = re.sub(r"(?:foundry|generated)", "@ARM@", text)
    text = re.sub(r"DBS_@ARM@", "@DB@", text)
    return text


def build_arm_files(ctx):
    foundry_synth, custom_synth = prior(ctx, "foundry-synth"), prior(ctx, "custom-synth")
    layout, char = prior(ctx, "layout"), prior(ctx, "characterize")
    generated_lef = merged_lef(ctx, layout)
    generated_lib = artifact(char, ctx.workspace, "generated_liberty")
    site = {name: ctx.file_binding(name) for name in
            ("TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH", "FOUNDRY_GDS", "XS28_GDS_MAP")}
    texts = {}
    outputs = {}
    for arm, synth in (("foundry", foundry_synth), ("generated", custom_synth)):
        netlist, sdc = artifact(synth, ctx.workspace, "synthesis_netlist"), artifact(synth, ctx.workspace, "synthesis_sdc")
        libs = [site["FOUNDRY_LIB"]] + ([generated_lib] if arm == "generated" else [])
        lefs = [site["TECH_LEF"], site["FOUNDRY_LEF"]] + ([generated_lef] if arm == "generated" else [])
        mmmc = fill_template(DOMAIN / "mmmc.tcl.tmpl", {
            "ARM": arm, "LIBRARY_SET_TIMING": " ".join(map(str, libs)),
            "QRC_TECH_FILE": site["FOUNDRY_QRC_TECH"], "RC_TEMPERATURE": ctx.binding("XS28_RC_TEMPERATURE"),
            "SDC_FILE": sdc,
        })
        mmmc_path = ctx.run_dir / ("mmmc_" + arm + ".tcl")
        mmmc_path.write_text(mmmc)
        init_db = ctx.run_dir / ("DBS_" + arm) / "init.enc"
        init_db.parent.mkdir()
        init = fill_template(DOMAIN / "init.tcl.tmpl", {
            "LEF_LIST": " ".join(map(str, lefs)), "NETLIST": netlist,
            "DESIGN_TOP": ctx.binding("DESIGN_TOP"),
            "MMMC_FILE": mmmc_path, "PWR_NET": ctx.binding("XS28_POWER_PIN"),
            "GND_NET": ctx.binding("XS28_GROUND_PIN"), "PROCESS_NODE": ctx.binding("XS28_PROCESS_NODE"),
            "MAX_ROUTE_LAYER": ctx.binding("XS28_MAX_ROUTE_LAYER"), "INIT_DB": init_db,
            "GENERATED_LIB_CELL_PATTERN": ctx.binding("GENERATED_LIB_CELL_PATTERN"), "ARM": arm,
        })
        rpt = ctx.run_dir / ("rpt_" + arm)
        final_db = ctx.run_dir / ("DBS_" + arm) / "postroute.enc"
        gds = ctx.run_dir / (arm + ".gds")
        postroute_sdc = rpt / "postroute-active.sdc"
        pnr = fill_template(DOMAIN / "pnr.tcl.tmpl", {
            "INIT_DB": str(init_db) + ".dat", "DESIGN_TOP": ctx.binding("DESIGN_TOP"),
            "MULTI_CPU": ctx.binding("MULTI_CPU"), "TAP_CELL": ctx.binding("XS28_TAP_CELL"),
            "TAP_INTERVAL": ctx.binding("XS28_TAP_INTERVAL"), "FILLER_CELLS": ctx.binding("XS28_FILLER_CELLS"),
            "RPT_DIR": rpt, "FINAL_DB": final_db, "GDS_OUT": gds,
            "GDS_MAP": site["XS28_GDS_MAP"], "MERGE_GDS": site["FOUNDRY_GDS"],
            "SWITCHING_ACTIVITY": ctx.binding("XS28_SWITCHING_ACTIVITY"), "ARM": arm,
            "POSTROUTE_SDC": postroute_sdc,
        })
        init_path, pnr_path = ctx.run_dir / ("init_" + arm + ".tcl"), ctx.run_dir / ("pnr_" + arm + ".tcl")
        init_path.write_text(init); pnr_path.write_text(pnr)
        texts[arm] = {"init": init, "pnr": pnr}
        outputs[arm] = {"mmmc": mmmc_path, "init": init_path, "pnr": pnr_path,
                        "init_db": Path(str(init_db) + ".dat"), "final_db": Path(str(final_db) + ".dat"),
                        "gds": gds, "postroute_sdc": postroute_sdc}
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


def stage_pnr(ctx, arm):
    outputs, generated_lef, generated_lib = build_arm_files(ctx)
    chosen = outputs[arm]
    ctx.add_artifact(generated_lef, "generated_lef", "generated-abstract-collection")
    for other in ("foundry", "generated"):
        for kind in ("mmmc", "init", "pnr"):
            ctx.add_artifact(outputs[other][kind], "%s_script:%s" % (kind, other), "generated-tool-input")
    wrapper = str(ctx.binding("EDA_WRAPPER"))
    init_log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(chosen["init"])], cwd=ctx.run_dir,
                       timeout=int(ctx.binding("PNR_TIMEOUT_SEC")), tag="init-" + arm)
    pnr_log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(chosen["pnr"])], cwd=ctx.run_dir,
                      timeout=int(ctx.binding("PNR_TIMEOUT_SEC")), tag="pnr-" + arm)
    text = init_log.read_text(errors="replace")
    pnr_text = pnr_log.read_text(errors="replace")
    if tool_error_lines(text) or tool_error_lines(pnr_text):
        raise ToolFailure("Innovus returned zero but emitted an error line")
    visible_hits = re.findall(r"=== XS28 GENERATED_LIB_CELLS_AFTER_RESTORE (\d+) ===", text)
    visible = int(visible_hits[0]) if len(visible_hits) == 1 else None
    if arm == "generated" and (visible is None or visible <= 0):
        raise Rejected("generated library visibility was not proved after Innovus restore")
    if ("=== XS28 PNR DONE %s (GDS written) ===" % arm) not in pnr_text:
        raise ToolFailure("Innovus P&R log lacks the completion marker for " + arm)
    timing_summary = ctx.run_dir / ("rpt_" + arm) / "postopt" / "post.summary"
    for at, role in ((chosen["final_db"], "postroute_db"), (chosen["gds"], "postroute_gds"),
                     (timing_summary, "postroute_timing_summary"),
                     (chosen["postroute_sdc"], "postroute_sdc")):
        ctx.add_artifact(at, role, "innovus-output")
    ctx.inputs.extend([file_ref(generated_lib, ctx.workspace, "generated_liberty", "learned-model-prediction"),
                       file_ref(generated_lef, ctx.workspace, "generated_lef", "generated-abstract-collection")])
    ctx.facts.update({"arm": arm, "pnr_completed": 1, "library_visible": visible,
                      "arm_scripts_matched": True,
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


def stage_verify(ctx):
    total = 0
    per_arm = {}
    limit = int(ctx.binding("DRC_LIMIT"))
    wrapper = str(ctx.binding("EDA_WRAPPER"))
    for arm, stage in (("foundry", "pnr-foundry"), ("generated", "pnr-generated")):
        db = artifact(prior(ctx, stage), ctx.workspace, "postroute_db")
        report = ctx.run_dir / (arm + "_verify_drc.rpt")
        script = ctx.run_dir / (arm + "_verify.tcl")
        script.write_text(
            "restoreDesign {%s} {%s}\nset_verify_drc_mode -check_only cell -limit %d\n"
            "set _xs_libcells [get_lib_cells {%s} -quiet]\n"
            "puts \"=== AES_DTCO VERIFY_LIBRARY_VISIBLE [llength $_xs_libcells] ===\"\n"
            "verify_drc -limit %d -report {%s}\n"
            "puts \"=== AES_DTCO VERIFY_COMPLETE %s ===\"\nexit\n" %
            (db, ctx.binding("DESIGN_TOP"), limit, ctx.binding("GENERATED_LIB_CELL_PATTERN"),
             limit, report, arm))
        ctx.add_artifact(script, "verify_script:" + arm, "generated-tool-input")
        log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(script)], cwd=ctx.run_dir,
                      timeout=int(ctx.binding("VERIFY_TIMEOUT_SEC")), tag="verify-" + arm)
        log_text = log.read_text(errors="replace")
        if tool_error_lines(log_text):
            raise ToolFailure("verification returned zero but emitted an error line for " + arm)
        if ("=== AES_DTCO VERIFY_COMPLETE %s ===" % arm) not in log_text:
            raise ToolFailure("verify session did not reach completion for " + arm)
        if arm == "generated":
            hits = re.findall(r"=== AES_DTCO VERIFY_LIBRARY_VISIBLE (\d+) ===", log_text)
            if len(hits) != 1 or int(hits[0]) <= 0:
                raise Rejected("generated library was not visible in verification session")
        count = parse_drc(report, limit)
        ctx.add_artifact(report, "verify_drc_report:" + arm, "innovus-verification-report")
        per_arm[arm] = count
        total += count
    ctx.facts.update({"verification_error_count": total, "verification_errors_by_arm": per_arm,
                      "verification_method": "verify_drc with explicit cell-only mode and uncapped report"})


def parse_timing_summary(path):
    text = Path(path).read_text(errors="replace")
    header = None
    for line in text.splitlines():
        if "|" not in line:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[1] in ("all", "reg2reg", "default"):
            header = cells[1:]
            break
    if header is None or "all" not in header:
        raise Rejected("post-route timeDesign summary has no all-mode header")
    views = re.findall(r"Setup views included:\s*\n\s*([^\s]+)", text)
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
    if len(views) != 1:
        raise Rejected("post-route timeDesign summary has no unambiguous setup analysis view")
    return {"analysisView": views[0], "setupWnsNs": rows["WNS (ns)"]["all"], "rows": rows}


def parse_sdc_period(path):
    text = Path(path).read_text(errors="replace")
    periods = [float(value) for value in re.findall(r"\bcreate_clock\b[^\n]*\s-period\s+([0-9.eE+-]+)", text)]
    if not periods or any(not value > 0 for value in periods) or len(set(periods)) != 1:
        raise Rejected("PnR-bound SDC has no single positive clock period")
    return periods[0]


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

        # Common synthesis method and inputs are checked from held, hashed source references.
        fs_template = role_refs(foundry_synth, "shared_synth")
        cs_template = role_refs(custom_synth, "shared_synth")
        fs_rtl = role_refs(foundry_synth, "rtl:")
        cs_rtl = role_refs(custom_synth, "rtl:")
        if len(fs_template) != 2 or len(cs_template) != 2:
            raise Rejected("paired synthesis records lack shared template/constraint evidence")
        synth_method_matched = (
            [(x["role"], x["sha256"]) for x in fs_template]
            == [(x["role"], x["sha256"]) for x in cs_template]
            and [(x["role"], x["sha256"]) for x in fs_rtl]
            == [(x["role"], x["sha256"]) for x in cs_rtl]
            and foundry_synth["executions"][0]["argv"][:2]
            == custom_synth["executions"][0]["argv"][:2]
        )

        pnr_rows = {}
        for arm, record in (("foundry", foundry_pnr), ("generated", generated_pnr)):
            summary = artifact(record, ctx.workspace, "postroute_timing_summary")
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
            timing = parse_timing_summary(summary)
            if timing["analysisView"] != parsed_mmmc["view"] or parsed_mmmc["activeSetup"] != parsed_mmmc["view"]:
                raise Rejected("%s post-route report analysis view differs from its MMMC view" % arm)
            pnr_rows[arm] = {"timing": timing, "mmmc": parsed_mmmc, "clockNs": actual_clock,
                             "initText": init.read_text(errors="replace"),
                             "pnrText": pnr_script.read_text(errors="replace")}
            ctx.inputs.extend([file_ref(summary, ctx.workspace, arm + "_postroute_timing", "innovus-output"),
                               file_ref(mmmc, ctx.workspace, arm + "_mmmc", "generated-tool-input"),
                               file_ref(input_sdc, ctx.workspace, arm + "_pnr_sdc", "design-compiler-output"),
                               file_ref(actual_sdc, ctx.workspace, arm + "_postroute_sdc", "innovus-output"),
                               file_ref(init, ctx.workspace, arm + "_pnr_init_script", "generated-tool-input"),
                               file_ref(pnr_script, ctx.workspace, arm + "_pnr_route_script", "generated-tool-input")])

        left, right = pnr_rows["foundry"], pnr_rows["generated"]
        pnr_method_matched = (
            normalized_arm_script(left["initText"]) == normalized_arm_script(right["initText"])
            and normalized_arm_script(left["pnrText"]) == normalized_arm_script(right["pnrText"])
            and left["clockNs"] == right["clockNs"]
            and left["mmmc"]["qrc"] == right["mmmc"]["qrc"]
            and left["mmmc"]["temperature"] == right["mmmc"]["temperature"]
        )
        requested_clock = right["clockNs"]

        # PnR and verification session logs, not declaration fields, prove model liveness.
        init_log = execution_log(generated_pnr, ctx.workspace, "init-generated_log").read_text(errors="replace")
        visible_hits = re.findall(r"=== XS28 GENERATED_LIB_CELLS_AFTER_RESTORE (\d+) ===", init_log)
        pnr_visible = int(visible_hits[0]) if len(visible_hits) == 1 else None
        verify_log = execution_log(verify, ctx.workspace, "verify-generated_log").read_text(errors="replace")
        verify_visible_hits = re.findall(r"=== AES_DTCO VERIFY_LIBRARY_VISIBLE (\d+) ===", verify_log)
        verify_visible = int(verify_visible_hits[0]) if len(verify_visible_hits) == 1 else None

        custom_netlist = artifact(custom_synth, ctx.workspace, "synthesis_netlist")
        generated_lib = artifact(characterize, ctx.workspace, "generated_liberty")
        ctx.inputs.extend([
            file_ref(execution_log(generated_pnr, ctx.workspace, "init-generated_log"), ctx.workspace,
                     "generated_pnr_init_log", "tool-log"),
            file_ref(execution_log(verify, ctx.workspace, "verify-generated_log"), ctx.workspace,
                     "generated_verify_log", "tool-log"),
            file_ref(custom_netlist, ctx.workspace, "custom_netlist", "design-compiler-output"),
            file_ref(generated_lib, ctx.workspace, "offered_library", "learned-model-prediction"),
        ])
        adoption = project_texts(custom_netlist.read_text(errors="replace"), generated_lib.read_text(errors="replace"))

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
        failures = sum((not matched, generated_wns < 0, not library_visible,
                        adoption["adopted_instance_count"] <= 0, verification_errors != 0))
        observations.update({
            "clock_period": requested_clock,
            "setup_wns": generated_wns,
            "foundry_setup_wns": foundry_wns,
            "setup_wns_delta": generated_wns - foundry_wns,
            "matched_conditions": matched,
            "library_visible": library_visible,
            "adopted_instance_count": adoption["adopted_instance_count"],
            "verification_error_count": verification_errors,
            "full_constraint_failures": failures,
            "unknownReason": None,
            "analysisViews": {arm: pnr_rows[arm]["timing"]["analysisView"] for arm in pnr_rows},
            "measurementScope": "same requested period, post-route Innovus setup/all; delta is an observation, not Fmax benefit",
        })
    except (Rejected, ValueError, KeyError, IndexError, TypeError) as exc:
        unknown_reasons.append(str(exc))
        observations.update({"clock_period": None, "setup_wns": None, "foundry_setup_wns": None,
                             "setup_wns_delta": None, "matched_conditions": None,
                             "library_visible": None, "adopted_instance_count": None,
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
        stage_pnr(ctx, "foundry")
    elif stage == "pnr-generated":
        stage_pnr(ctx, "generated")
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
        if stage != "mine" and route is not None:
            raise Rejected("ROUTE is accepted only for mine")
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
