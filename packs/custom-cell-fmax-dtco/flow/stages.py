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
import shutil
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
DOMAIN = HERE / "domain"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(DOMAIN))

from cell_need_miner.generator_contract import validate_generation_request  # noqa: E402
from _cell_adoption_projection import project_attributed_texts  # noqa: E402
from _generation_projection import (  # noqa: E402
    DRIVE_FAMILY_ORDER,
    IDENTIFIER,
    advance_function_state,
    append_cumulative_shard,
    empty_cumulative_manifest,
    expected_delta_generation_jobs,
    expected_generation_jobs,
    function_identity,
    retained_candidate_ids,
    spice_netlist_is_structural,
    validate_cumulative_manifest,
)
from cell_need_miner.liberty import parse_skeleton  # noqa: E402
from cell_need_miner.liberty_timing import (  # noqa: E402
    analyze_mapped_netlist_reg2reg,
    parse_liberty_timing,
)
from proxy_mapping import map_reference_and_augmented  # noqa: E402
from mine_patterns import (  # noqa: E402
    portfolio_candidate_from_generation_request,
    select_candidate_portfolio,
)
import library_richness as lfr  # noqa: E402
from mining_strategy_contract import STRATEGIES  # noqa: E402
from innovus_timing_facts import build_active_frontier, parse_timing_report  # noqa: E402
from drive_family import drive_scale, scale_spice_drive  # noqa: E402


SCHEMA = "custom-cell-fmax-stage/1"
ROUTES = tuple(STRATEGIES)
STAGES = (
    "evaluate-library-richness", "freeze-cumulative-library",
    "mine", "merge", "generate", "layout", "characterize", "compile",
    "foundry-synth", "custom-synth", "adoption", "pnr-foundry",
    "pnr-generated", "verify", "compare",
)
BUILDABLE_ROUTES = {"fusion", "cluster_compose", "boolean_synthesis", "multi_output_resynthesis"}


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
    if phase not in ("init", "place", "postroute"):
        raise Rejected("checkpoint phase must be init, place or postroute")
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


def write_cumulative_gain_artifacts(run_dir, request):
    """Write v3 free-loop evidence through the existing stage workspace."""
    result = lfr.evaluate_cumulative_gain(request)
    if result.get("status") != "succeeded":
        raise Rejected("cumulative-gain evaluation failed")
    root = Path(run_dir)
    root.mkdir(parents=True, exist_ok=True)
    documents = {
        "endpoint-frontier.json": result["design_state"],
        "opportunities.json": {
            "schema": "hima.lfr-opportunities/1",
            "actions": result["evaluated_actions"],
        },
        "action-portfolio.json": result["action_portfolio"],
        "cell-demand.json": result["cell_demand"],
        "gain-evaluation.json": result,
    }
    paths = {}
    for name, document in documents.items():
        path = root / name
        atomic_json(path, document)
        paths[name] = path
    return paths


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


def canonical_sha(value):
    return sha_bytes(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                allow_nan=False).encode())


def canonical_json_sha(value):
    """SHA used by the residual runner's newline-terminated canonical JSON."""
    return sha_bytes((json.dumps(value, sort_keys=True, separators=(",", ":"),
                                  ensure_ascii=False, allow_nan=False) + "\n").encode())


def lfr_new_cell_budget(ctx):
    value = ctx.inputs_doc.get("MAX_NEW_CELLS")
    if value is None and ctx.evidence_class == "synthetic-fixture":
        value = ctx.inputs_doc.get("MAX_CELLS")
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 50:
        raise Rejected("MAX_NEW_CELLS must be within 1..50")
    return value


def lfr_tool_identity(ctx):
    return {
        "container_digest": str(ctx.binding("LFR_PROXY_CONTAINER_DIGEST")),
        "timeout_seconds": int(ctx.binding("LFR_PROXY_TIMEOUT_SEC")),
        "yosys": {
            "path": str(ctx.binding("LFR_YOSYS_BIN")),
            "sha256": str(ctx.binding("LFR_YOSYS_SHA256")),
            "commit": str(ctx.binding("LFR_YOSYS_COMMIT")),
            "build_flags": list(ctx.binding("LFR_YOSYS_BUILD_FLAGS")),
        },
        "abc": {
            "path": str(ctx.binding("LFR_ABC_BIN")),
            "sha256": str(ctx.binding("LFR_ABC_SHA256")),
            "commit": str(ctx.binding("LFR_ABC_COMMIT")),
            "build_flags": list(ctx.binding("LFR_ABC_BUILD_FLAGS")),
        },
    }


def lfr_rtl_files(ctx):
    design_root = Path(str(ctx.binding("designRoot"))).resolve()
    files = sorted(Path(value).resolve() for value in glob.glob(str(ctx.binding("rtlGlob"))))
    if (not files or any(not path.is_file() or path.is_symlink()
                         or not path.is_relative_to(design_root) for path in files)):
        raise Rejected("validated RTL binding no longer resolves inside designRoot")
    ctx.inputs.extend(file_ref(path, ctx.workspace, "lfr_rtl:" + path.name, "site-input")
                      for path in files)
    return files


def _proxy_axes(model, required_cells):
    slews, loads, input_caps = [], [], []
    for name in sorted(required_cells):
        cell = model.cell(name)
        input_caps.extend(value for value in cell.pin_capacitance.values() if value > 0)
        for arc in cell.arcs:
            for table in arc.tables.values():
                dimensions = ((table.variable_1, table.index_1),
                              (table.variable_2, table.index_2))
                for variable, values in dimensions:
                    if variable in ("input_net_transition", "related_pin_transition"):
                        slews.extend(values)
                    elif variable in ("total_output_net_capacitance", "output_net_capacitance"):
                        loads.extend(values)
    if not slews or not loads or not input_caps:
        raise Rejected("foundry Liberty cannot derive a bounded proxy slew/load profile")
    slews, loads, input_caps = sorted(slews), sorted(loads), sorted(input_caps)
    median = lambda values: values[len(values) // 2]
    return {
        "driving_cell": sorted(
            name for name in required_cells
            if (not model.cell(name).sequential and len(model.cell(name).pin_capacitance) == 1
                and any(arc.timing_sense == "positive_unate" for arc in model.cell(name).arcs))
        )[0],
        "output_load": median(input_caps),
        "scenarios": {
            "optimistic": {"initial_slew_ps": min(slews) * lfr._time_unit_ps(model.time_unit),
                           "wire_capacitance_in_library_units": 0.0},
            "nominal": {"initial_slew_ps": median(slews) * lfr._time_unit_ps(model.time_unit),
                        "wire_capacitance_in_library_units": median(loads)},
            "conservative": {"initial_slew_ps": max(slews) * lfr._time_unit_ps(model.time_unit),
                             "wire_capacitance_in_library_units": max(loads)},
        },
    }


def lfr_mapping_request(ctx, output_dir, reference_liberty=None, augmented_liberty=None):
    rtl = lfr_rtl_files(ctx)
    foundry = ctx.file_binding("FOUNDRY_LIB")
    cells = parse_skeleton(foundry)
    buffers = sorted(name for name, cell in cells.items()
                     if not cell.is_seq and len(cell.inputs) == 1 and len(cell.outputs) == 1
                     and next(iter(cell.outputs.values())) == ("var", cell.inputs[0]))
    if not buffers:
        raise Rejected("foundry Liberty has no non-inverting buffer for ABC constraints")
    strict = parse_liberty_timing(foundry, {buffers[0]})
    profile = _proxy_axes(strict, {buffers[0]})
    constraints = ctx.file_binding("CONSTRAINTS_FILE")
    reference = {"mapping": str(reference_liberty or foundry), "support": [], "drive_variants": {}}
    augmented = reference if augmented_liberty is None else {
        "mapping": str(augmented_liberty), "support": [], "drive_variants": {},
    }
    request = {
        "schema": "lfr-proxy-mapping/1", "top": str(ctx.binding("DESIGN_TOP")),
        "rtl_files": [str(path) for path in rtl], "output_dir": str(output_dir),
        "tools": lfr_tool_identity(ctx),
        "libraries": {"reference": reference, "augmented": augmented},
        "constraints": {
            "delay_target_ps": float(ctx.binding("CLOCK_NS")) * 1000.0,
            "output_load": profile["output_load"], "driving_cell": buffers[0],
            "sdc_files": [str(constraints)],
        },
    }
    return request, profile


def _mapping_artifact(mapping, arm, role):
    hits = [row for row in mapping["arms"][arm]["artifacts"] if row.get("role") == role]
    if len(hits) != 1:
        raise Rejected("LFR mapping arm %s has no unique %s" % (arm, role))
    path = Path(hits[0]["path"]).resolve()
    if not path.is_file() or sha_file(path) != hits[0]["sha256"]:
        raise Rejected("LFR mapping artifact identity changed: %s" % path)
    return path


def _record_mapping(ctx, mapping):
    for arm, result in sorted(mapping.get("arms", {}).items()):
        ctx.executions.append({
            "argv": result.get("command"), "cwd": str((ctx.run_dir / "mapping" / arm).resolve()),
            "exitCode": result.get("return_code"), "elapsedSeconds": None,
            "log": file_ref(_mapping_artifact(mapping, arm, "yosys_log"), ctx.workspace,
                            "lfr_%s_yosys_log" % arm, "tool-log"),
        })


def _baseline_metrics(mapping, profile, ctx):
    netlist = _mapping_artifact(mapping, "reference", "mapped_netlist")
    augmented_netlist = _mapping_artifact(mapping, "augmented", "mapped_netlist")
    libraries = mapping.get("inputs", {}).get("libraries", {})
    if (sha_file(netlist) != sha_file(augmented_netlist)
            or libraries.get("reference") != libraries.get("augmented")
            or mapping["arms"]["reference"].get("adoption")
            != mapping["arms"]["augmented"].get("adoption")):
        raise Rejected(
            "baseline self-comparison arms have different netlist, Library, or adoption identities"
        )
    foundry = ctx.file_binding("FOUNDRY_LIB")
    census = mapping["arms"]["reference"]["adoption"]["cell_census"]
    model = parse_liberty_timing(foundry, set(census))
    text = netlist.read_text(errors="replace")
    unit_ps = lfr._time_unit_ps(model.time_unit)
    timing = {}
    scenarios = {}
    for name, assumptions in profile["scenarios"].items():
        raw = analyze_mapped_netlist_reg2reg(
            model, text, str(ctx.binding("DESIGN_TOP")),
            clock_period=float(ctx.binding("CLOCK_NS")) * 1000.0 / unit_ps,
            uncertainty=0.0,
            initial_slew=float(assumptions["initial_slew_ps"]) / unit_ps,
            wire_capacitance=float(assumptions["wire_capacitance_in_library_units"]),
        )
        timing[name] = raw
        structural = lfr._structural_metrics(
            model, text, str(ctx.binding("DESIGN_TOP")),
            float(assumptions["wire_capacitance_in_library_units"]),
        )
        f3 = {
            "indicator_only": True,
            "path_count": raw["path_count"],
            "worst_delay_indicator_ps": raw["worst_delay"] * unit_ps,
            "worst_slack_indicator_ps": raw["worst_slack"] * unit_ps,
            "negative_slack_mass_indicator_ps": raw["negative_slack_mass"] * unit_ps,
            "path_family_coverage": raw["endpoint_family_count"],
            "path_families": sorted(raw["negative_slack_by_endpoint_family"]),
            "worst_path": lfr._worst_path(raw),
        }
        metrics = {"F0": {"candidate_cells_declared": 0, "candidate_cells_adopted": 0},
                   "F1": {}, "F2": structural, "F3": f3}
        scenarios[name] = {
            "status": "succeeded", "assumptions": assumptions,
            "reference": metrics, "augmented": json.loads(json.dumps(metrics)),
            "changes": {"F2.mapped_instance_count": 0.0,
                        "F3.worst_delay_indicator_ps": 0.0,
                        "F3.negative_slack_mass_indicator_ps": 0.0},
            "pairwise_relation": {"relation": "equal", "comparisons": []},
            "path_migration": lfr._migration(metrics, metrics),
        }
    result = {
        "schema": "lfr-baseline-evaluation/1", "status": "succeeded",
        "evidence_class": "license-free-evaluation-agent",
        "claim_limits": {"commercial_qor_predicted": False, "fmax_predicted": False,
                         "commercial_eda_executed": False},
        "mapping": mapping, "scenarios": scenarios,
        "pairwise_relation": {"relation": "equal", "comparisons": []},
        "metric_completeness": {"complete": True},
    }
    # All Library-richness payload identities use the newline-terminated
    # canonical JSON contract independently recomputed by read-stage.py.
    result["evaluation_payload_sha256"] = canonical_json_sha(result)
    return result, timing, netlist


def stage_evaluation_baseline(ctx):
    request, profile = lfr_mapping_request(ctx, ctx.run_dir / "mapping")
    request_path = ctx.run_dir / "baseline-request.json"
    atomic_json(request_path, request)
    ctx.inputs.append(file_ref(request_path, ctx.workspace, "lfr_baseline_request",
                               "pack-derived-proxy-request"))
    mapping = map_reference_and_augmented(request)
    if mapping.get("status") != "succeeded":
        error = mapping.get("error") or {}
        if error.get("code") in {"mapping-timeout", "mapping-tool-failed", "mapping-artifact-missing"}:
            raise ToolFailure("license-free baseline mapping failed: %s" % error.get("message"))
        raise Rejected("license-free baseline mapping rejected: %s" % error.get("message"))
    _record_mapping(ctx, mapping)
    evaluation, timing, netlist = _baseline_metrics(mapping, profile, ctx)
    evaluation_path = ctx.run_dir / "evaluation.json"
    atomic_json(evaluation_path, evaluation)
    nominal = timing["nominal"]
    timing_document = {
        "schema": "hima.lfr-proxy-reg2reg/1", "status": "succeeded",
        "design": str(ctx.binding("DESIGN_TOP")), "path_group": "reg2reg",
        "source": "license-free-mapped-netlist-proxy-sta",
        "time_unit_ns": lfr._time_unit_ps(nominal["time_unit"]) / 1000.0,
        "timing": nominal,
        "claim_limits": {"commercial_sta": False, "commercial_qor_predicted": False},
    }
    timing_path = ctx.run_dir / "proxy-reg2reg.json"
    atomic_json(timing_path, timing_document)
    ctx.add_artifact(evaluation_path, "library_richness_evaluation",
                     "license-free-layered-evaluation")
    ctx.add_artifact(netlist, "baseline_mapped_netlist", "license-free-mapping-output")
    ctx.add_artifact(timing_path, "baseline_proxy_reg2reg", "license-free-proxy-sta")
    library_root = ctx.flow / "library"
    manifest_path = (ctx.flow / "library" / "cumulative-manifest.json").resolve()
    if manifest_path != (library_root / "cumulative-manifest.json").resolve():
        raise Rejected("cumulative Library manifest binding differs from the Pack-owned path")
    if manifest_path.exists():
        manifest = read_json(manifest_path)
        validate_cumulative_manifest(manifest)
    else:
        foundry = ctx.file_binding("FOUNDRY_LIB")
        manifest = empty_cumulative_manifest({
            "source": str(foundry), "bytes": foundry.stat().st_size, "sha256": sha_file(foundry),
        })
        atomic_json(manifest_path, manifest)
    baseline_copy = library_root / "baseline-reference.json"
    if not baseline_copy.exists():
        atomic_json(baseline_copy, manifest["baselineReference"])
    ctx.inputs.append(file_ref(manifest_path, ctx.workspace, "cumulative_library_manifest",
                               "campaign-library-state"))
    ctx.facts.update({
        "evaluationPhase": "baseline", "commercialEdaExecuted": False,
        "mappedNetlistSha256": sha_file(netlist), "proxyTimingSha256": sha_file(timing_path),
        "cumulativeLibraryCellCount": len(manifest["functions"]),
    })


def _deduplicated_mined_requests(route_requests):
    rows = []
    for route, requests in route_requests:
        for rank, item in enumerate(requests, 1):
            rows.append({"route": route, "rank": rank,
                         "request": json.loads(json.dumps(item))})
    deduplicated = {}
    members = {}
    for row in rows:
        request = row["request"]
        errors = validate_generation_request(request)
        if errors:
            raise Rejected("candidate pool contains an invalid request: " + "; ".join(errors))
        try:
            key = function_identity(request)["key"]
        except ValueError as exc:
            raise Rejected(str(exc)) from exc
        members.setdefault(key, []).append({
            "route": row["route"], "rank": row["rank"],
            "candidateId": request.get("candidate_id"),
        })
        current = deduplicated.get(key)
        if current is None or candidate_rank(request) < candidate_rank(current):
            deduplicated[key] = request
    result, used = [], set()
    for key in sorted(deduplicated):
        request = deduplicated[key]
        request["candidate_id"] = collision_safe_candidate_id(
            request["candidate_id"], key, used)
        used.add(request["candidate_id"])
        evidence = request.setdefault("discovery_evidence", {})
        evidence["strategy_ids"] = sorted(
            {row["route"] for row in members[key]}, key=ROUTES.index)
        evidence["strategy_rankings"] = method_rankings(members[key])
        result.append(request)
    return result


def _all_mined_requests(ctx):
    route_requests = []
    for route in ROUTES:
        record = prior(ctx, "mine-" + route)
        raw = artifact(record, ctx.workspace, "mining_raw")
        document = read_json(raw)
        if (document.get("report_schema") != "xspace_cell-pattern-search/v2"
                or document.get("strategy_id") != route
                or not isinstance(document.get("generation_requests"), list)):
            raise Rejected("mining candidate pool has invalid route %s" % route)
        ctx.inputs.append(file_ref(raw, ctx.workspace, "candidate_pool:" + route,
                                   "algorithm-output"))
        route_requests.append((route, document["generation_requests"]))
    return _deduplicated_mined_requests(route_requests)


def _baseline_family_slacks(timing_document):
    unit_ps = float(timing_document["time_unit_ns"]) * 1000.0
    rows = {}
    for path in timing_document["timing"]["paths"]:
        family = str(path["endpoint_family"])
        slack = float(path["slack"]) * unit_ps
        rows[family] = min(rows.get(family, math.inf), slack)
    if not rows:
        raise Rejected("baseline proxy timing has no endpoint-family slack")
    return dict(sorted(rows.items()))


def current_commercial_response(ctx, manifest_path):
    """Use prior commercial feedback only while its latest compare and inputs still match."""
    root = ctx.flow / "library-richness"
    marker_path = root / "commercial-response-current.json"
    if not marker_path.is_file() or marker_path.is_symlink():
        return None
    marker = read_json(marker_path)
    if marker.get("schema") != "lfr-current-commercial-response/1":
        raise Rejected("current commercial response marker has the wrong schema")
    if marker.get("status") == "unavailable":
        return None
    if marker.get("status") != "available":
        raise Rejected("current commercial response marker has an invalid status")
    if (marker.get("inputsSha256") != sha_file(ctx.flow / "inputs.json")
            or marker.get("manifestSha256") != sha_file(manifest_path)):
        return None
    try:
        comparison_record = prior(ctx, "compare")
        comparison_path = artifact(comparison_record, ctx.workspace, "comparison")
        historical_path = artifact(comparison_record, ctx.workspace, "v5_frontier_response")
        source_refs = comparison_record.get("inputs")
        if not isinstance(source_refs, list) or not source_refs:
            return None
        for source_ref in source_refs:
            checked_ref(source_ref, ctx.workspace)
    except Rejected:
        return None
    persistent = root / "commercial-response.json"
    if not persistent.is_file() or persistent.is_symlink():
        return None
    comparison_bytes = comparison_path.read_bytes()
    response_bytes = persistent.read_bytes()
    if (marker.get("comparisonSha256") != sha_bytes(comparison_bytes)
            or marker.get("responseSha256") != sha_bytes(response_bytes)
            or marker.get("responseSha256") != sha_file(historical_path)
            or marker.get("compareRunDir") != str(comparison_path.parent.relative_to(ctx.flow))):
        return None
    try:
        comparison = json.loads(comparison_bytes, object_pairs_hook=unique)
        response = json.loads(response_bytes, object_pairs_hook=unique)
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(comparison, dict) or not isinstance(response, dict):
        return None
    payload = dict(response)
    payload_sha = payload.pop("response_sha256", None)
    if (payload_sha != canonical_json_sha(payload)
            or marker.get("responsePayloadSha256") != payload_sha
            or comparison.get("v5_frontier_response_sha256") != payload_sha
            or comparison_record.get("facts", {}).get("v5_frontier_response_sha256") != payload_sha
            or comparison.get("matched_conditions") is not True
            or comparison_record.get("facts", {}).get("matched_conditions") is not True
            or marker.get("analysisViews") != comparison.get("analysisViews")
            or comparison_record.get("facts", {}).get("analysisViews") != comparison.get("analysisViews")):
        return None
    return response


def stage_function_local(ctx):
    baseline_record = prior(ctx, "evaluation-baseline")
    baseline_eval = artifact(baseline_record, ctx.workspace, "library_richness_evaluation")
    baseline_timing = artifact(baseline_record, ctx.workspace, "baseline_proxy_reg2reg")
    timing_document = read_json(baseline_timing)
    manifest_path = Path(str(ctx.binding("LFR_CUMULATIVE_LIBRARY_MANIFEST"))).resolve()
    manifest = read_json(manifest_path)
    validate_cumulative_manifest(manifest)
    attempted_function_keys = {row["functionKey"] for row in manifest["functions"]}
    candidates = []
    by_id = {}
    for request in _all_mined_requests(ctx):
        if function_identity(request)["key"] in attempted_function_keys:
            continue
        try:
            candidate = portfolio_candidate_from_generation_request(
                request, stage="pre_mapping")
        except ValueError as exc:
            raise Rejected("cannot project function/local candidate: %s" % exc) from exc
        candidates.append(candidate)
        by_id[candidate["candidate_id"]] = request
    baseline = _baseline_family_slacks(timing_document)
    portfolio = select_candidate_portfolio(
        candidates, lfr_new_cell_budget(ctx), stage="pre_mapping",
        design_proxy_evidence={
            "evidence_id": sha_file(baseline_timing),
            "baseline_slack_by_endpoint_family_ps": baseline,
            "paired_delta_by_endpoint_family_ps": {key: 0.0 for key in baseline},
        },
    )
    selected_ids = [row["candidate_id"] for row in portfolio["selected"]]
    if not selected_ids:
        raise Rejected("function/local evaluation found no generator-ready candidate")
    permitted_ranking_reasons = {"portfolio_budget_reached", "not_selected_from_pareto_front"}
    eligible_ids = [
        row["candidate_id"] for row in portfolio["candidate_evaluations"]
        if set(row.get("rejection_reasons") or ()) <= permitted_ranking_reasons
    ]
    exposed_ids = list(dict.fromkeys([*selected_ids, *eligible_ids]))[:128]
    pool = {
        "report_schema": "xspace_cell-pattern-search/v2",
        "strategy_id": "library_richness_function_local_portfolio",
        "source_graph": "license-free-baseline-mapped",
        "search_bound": {"max_candidates": 128,
                         "proposal_budget": lfr_new_cell_budget(ctx),
                         "total_verified_candidates": len(eligible_ids),
                         "exposed_candidates": len(exposed_ids),
                         "truncated_candidates": max(0, len(eligible_ids) - len(exposed_ids))},
        "generation_requests": [by_id[value] for value in exposed_ids],
        "limitations": [
            "F0/F1 portfolio evidence only; mapping adoption and commercial QoR remain unobserved.",
            "Candidate identities bind measured source requests and are not assigned by the model.",
        ],
    }
    portfolio_path = Path(str(ctx.binding("LFR_LOCAL_PORTFOLIO"))).resolve()
    pool_path = Path(str(ctx.binding("LFR_CANDIDATE_POOL"))).resolve()
    expected_root = (ctx.flow / "library-richness").resolve()
    if portfolio_path.parent != expected_root or pool_path.parent != expected_root:
        raise Rejected("LFR portfolio/candidate-pool binding differs from the Pack-owned path")
    atomic_json(portfolio_path, portfolio)
    atomic_json(pool_path, pool)
    cold_frontier = {
        "schema": "lfr-frontier-evaluation/1", "status": "succeeded",
        "claim_limits": {"commercial_qor_predicted": False, "fmax_predicted": False,
                         "commercial_eda_executed": False},
        "objectives": [], "members": [], "frontier_member_ids": [],
        "library_cost": {"new_library_cells": 0, "generation_units": 0},
        "next_residual_question": {
            "id": "cold-start-function-richness",
            "prompt": "Select evidence-bound functions that can improve F0/F1 structure before paired mapping.",
        },
        "e0_library_validation_candidate": {
            "value": False, "unit_of_analysis": "candidate-library-round",
            "validation_layer": "E0",
            "meaning": "no expensive commercial observation before paired Library evaluation"},
    }
    frontier_path = expected_root / "frontier.json"
    rounds_root = expected_root / "rounds"
    history_paths = sorted(rounds_root.glob("*.json")) if rounds_root.is_dir() else []
    if history_paths and frontier_path.is_file():
        frontier = read_json(frontier_path)
        if (frontier.get("schema") != "lfr-frontier-evaluation/1"
                or frontier.get("status") != "succeeded"
                or not isinstance(frontier.get("next_residual_question"), dict)):
            raise Rejected("prior frontier has no usable residual question")
    else:
        frontier = cold_frontier
        atomic_json(frontier_path, frontier)
    commercial_response_path = expected_root / "commercial-response.json"
    commercial_response = current_commercial_response(ctx, manifest_path)
    if commercial_response is not None:
        if (commercial_response.get("schema")
                != "hima.lfr-v5-commercial-frontier-response/1"
                or commercial_response.get("status") != "observed"
                or not isinstance(commercial_response.get("next_residual_question"), str)):
            raise Rejected("prior commercial frontier response is invalid")
        frontier = dict(frontier)
        frontier["next_residual_question"] = {
            "id": "commercial-frontier-" + str(len(history_paths) + 1),
            "prompt": commercial_response["next_residual_question"],
        }
        atomic_json(frontier_path, frontier)
    elif frontier.get("next_residual_question", {}).get("id", "").startswith("commercial-frontier-"):
        frontier = dict(frontier)
        frontier["next_residual_question"] = cold_frontier["next_residual_question"]
        atomic_json(frontier_path, frontier)
    evaluation_copy = expected_root / "evaluation.json"
    manifest_copy = expected_root / "manifest.json"
    if not history_paths or not evaluation_copy.is_file():
        evaluation_copy.write_bytes(baseline_eval.read_bytes())
    manifest_copy.write_bytes(manifest_path.read_bytes())
    ref = lambda path: {"path": path.name, "sha256": sha_file(path)}
    history_refs = [{"path": str(path.relative_to(expected_root)), "sha256": sha_file(path)}
                    for path in history_paths]
    context_inputs = {
        "schema": "lfr-ai-residual-request/1",
        "round_id": "round-%04d" % (len(history_paths) + 1),
        "evaluation": ref(evaluation_copy),
        "frontier": ref(frontier_path),
        "manifest": ref(manifest_copy),
        "candidate_pool": ref(pool_path),
        "history": history_refs,
        "next_residual_question": frontier["next_residual_question"]["prompt"],
        "budgets": {"max_research_lenses": 12,
                    "max_candidate_proposals": lfr_new_cell_budget(ctx),
                    "max_onsite_inspiration_proposals": min(10, lfr_new_cell_budget(ctx)),
                    "max_candidate_code_bytes": 65536},
    }
    if commercial_response is not None:
        context_inputs["commercial_response"] = ref(commercial_response_path)
    context_inputs_path = expected_root / "research-context.json"
    atomic_json(context_inputs_path, context_inputs)
    ctx.inputs.extend([
        file_ref(baseline_eval, ctx.workspace, "baseline_evaluation", "prior-stage-evidence"),
        file_ref(baseline_timing, ctx.workspace, "baseline_proxy_reg2reg", "prior-stage-evidence"),
        file_ref(manifest_path, ctx.workspace, "cumulative_library_manifest", "campaign-library-state"),
    ])
    ctx.add_artifact(portfolio_path, "function_local_evaluation", "license-free-F0-F1-evaluation")
    ctx.add_artifact(pool_path, "candidate_pool", "source-bound-candidate-pool")
    ctx.add_artifact(frontier_path, "portfolio_frontier", "license-free-cold-start-frontier")
    ctx.add_artifact(context_inputs_path, "research_context_inputs", "hash-bound-context-inputs")
    if commercial_response is not None:
        ctx.add_artifact(commercial_response_path, "v5_commercial_frontier_response",
                         "prior-commercial-feedback")
    ctx.facts.update({"evaluationPhase": "function-local", "candidatePoolCount": len(exposed_ids),
                      "candidatePoolTotal": len(eligible_ids),
                      "candidatePoolTruncated": max(0, len(eligible_ids) - len(exposed_ids)),
                      "commercialEdaExecuted": False, "researchContextReady": True,
                      "priorCommercialFeedbackAvailable": commercial_response is not None})


_LIBERTY_CELL_NAME = re.compile(r'^\s*cell\s*\(\s*"?(?P<name>[^)"]+)"?\s*\)')


def _liberty_cell_blocks(text):
    blocks = []
    start_re = re.compile(r"(?m)^\s*cell\s*\(")
    cursor = 0
    while True:
        match = start_re.search(text, cursor)
        if match is None:
            break
        brace = text.find("{", match.end())
        if brace < 0:
            raise Rejected("generated Liberty has an unterminated Cell declaration")
        depth, index, quote, escaped = 0, brace, None, False
        while index < len(text):
            character = text[index]
            if quote is not None:
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == quote:
                    quote = None
            elif character in ('"', "'"):
                quote = character
            elif character == "{":
                depth += 1
            elif character == "}":
                depth -= 1
                if depth == 0:
                    blocks.append(text[match.start():index + 1])
                    cursor = index + 1
                    break
            index += 1
        else:
            raise Rejected("generated Liberty Cell block is not balanced")
    if not blocks:
        raise Rejected("generated Liberty contains no Cell blocks")
    return blocks


def _mapping_library(ctx, name, generated_libraries):
    foundry = ctx.file_binding("FOUNDRY_LIB")
    text = foundry.read_text(errors="replace")
    closing = text.rfind("}")
    if closing < 0:
        raise Rejected("foundry Liberty has no closing library group")
    blocks = []
    seen_cell_names = {}
    for library in generated_libraries:
        ctx.inputs.append(file_ref(library, ctx.workspace, "mapping_library_delta:" + library.name,
                                   "learned-model-prediction"))
        library_blocks = _liberty_cell_blocks(library.read_text(errors="replace"))
        for block in library_blocks:
            match = _LIBERTY_CELL_NAME.match(block)
            cell_name = match.group("name") if match else None
            if cell_name is not None:
                if cell_name in seen_cell_names:
                    raise Rejected(
                        "augmented mapping Library has Cell %r in both %s and %s; "
                        "candidate ids are per-round labels, not globally unique, "
                        "so two generations produced different Cells under the "
                        "same physical name" % (
                            cell_name, seen_cell_names[cell_name], library.name))
                seen_cell_names[cell_name] = library.name
        blocks.extend(library_blocks)
    target = ctx.run_dir / name
    target.write_text(text[:closing] + "\n/* Hima cumulative custom Cell delta. */\n"
                      + "\n".join(blocks) + "\n" + text[closing:])
    parse_skeleton(target)
    return target


def _custom_library(ctx, name, generated_libraries):
    if not generated_libraries:
        raise Rejected("cumulative custom Library has no shard Liberty")
    template = generated_libraries[-1].read_text(errors="replace")
    first_cell = re.search(r"(?m)^\s*cell\s*\(", template)
    closing = template.rfind("}")
    if first_cell is None or closing < first_cell.start():
        raise Rejected("custom Liberty template has no complete library group")
    blocks = []
    for library in generated_libraries:
        blocks.extend(_liberty_cell_blocks(library.read_text(errors="replace")))
    target = ctx.run_dir / name
    target.write_text(template[:first_cell.start()] + "\n" + "\n".join(blocks)
                      + "\n" + template[closing:])
    parse_skeleton(target)
    return target


def _retained_shard_libraries(ctx, manifest):
    root = ctx.flow / "library" / "shards"
    libraries = []
    active_keys = {row["functionKey"] for row in manifest["functions"]
                   if row["state"] != "proxy-rejected"}
    for shard in manifest["shards"]:
        if not active_keys.intersection(shard["functionKeys"]):
            continue
        directory = root / shard["id"]
        shard_doc = read_json(directory / "manifest.json")
        for ref in shard_doc.get("artifacts", []):
            if str(ref.get("path", "")).endswith(".lib"):
                at = directory / ref["path"]
                if sha_file(at) != ref.get("sha256"):
                    raise Rejected("retained cumulative Liberty hash changed")
                libraries.append(at)
    return libraries


def _filtered_portfolio(portfolio, admitted_requests):
    """Rebuild the strict F0/F1 gate with materialized shard identities.

    Candidate ids are route-local research labels.  ``stage_merge`` gives every
    materialized request a physical shard namespace so cumulative Libraries
    cannot alias Cells across generations.  The immutable Boolean/interface
    identity, rather than the renamed label, therefore joins the Workshop
    delta back to the function/local portfolio.
    """
    if not isinstance(admitted_requests, list) or not admitted_requests:
        raise Rejected("materialized delta has no generation requests")
    available = {}
    for index, row in enumerate(portfolio.get("candidate_evaluations", [])):
        candidate = row.get("candidate") if isinstance(row, dict) else None
        source = candidate.get("source_generation_request") if isinstance(candidate, dict) else None
        if not isinstance(source, dict):
            raise Rejected("function/local portfolio candidate %d is malformed" % index)
        try:
            key = function_identity(source)["key"]
        except ValueError as exc:
            raise Rejected(str(exc)) from exc
        if key in available:
            raise Rejected("function/local portfolio repeats a Boolean/interface identity")
        available[key] = candidate
    evaluations = []
    admitted_ids = set()
    for index, request in enumerate(admitted_requests):
        if not isinstance(request, dict):
            raise Rejected("materialized generation request %d is malformed" % index)
        candidate_id = request.get("candidate_id")
        if not isinstance(candidate_id, str) or candidate_id in admitted_ids:
            raise Rejected("materialized delta repeats or omits a candidate id")
        try:
            key = function_identity(request)["key"]
        except ValueError as exc:
            raise Rejected(str(exc)) from exc
        if key not in available:
            raise Rejected("no function/local portfolio candidate survived materialization")
        try:
            evaluations.append(portfolio_candidate_from_generation_request(
                request, stage="pre_mapping"))
        except ValueError as exc:
            raise Rejected("cannot project materialized function/local candidate: %s" % exc) from exc
        admitted_ids.add(candidate_id)
    filtered = select_candidate_portfolio(
        evaluations, len(evaluations), stage="pre_mapping",
        design_proxy_evidence=portfolio["design_proxy_evidence"],
    )
    selected = {row["candidate_id"] for row in filtered["selected"]}
    if selected != set(admitted_ids):
        raise Rejected("materialized delta and function/local portfolio selection differ")
    return filtered


def _frontier_rounds(ctx):
    rounds = []
    root = ctx.flow / "library-richness" / "rounds"
    if not root.is_dir():
        return rounds
    for path in sorted(root.glob("*.json")):
        document = read_json(path)
        if document.get("schema") != "hima.library-richness.round-history/1":
            raise Rejected("LFR round history schema is unsupported")
        rounds.append(document["frontier_round"])
        ctx.inputs.append(file_ref(path, ctx.workspace, "lfr_round_history:" + path.stem,
                                   "prior-license-free-evaluation"))
    return rounds


def stage_design_mapping_timing(ctx):
    characterize = prior(ctx, "characterize")
    generated = artifact(characterize, ctx.workspace, "generated_liberty")
    patterns = artifact(characterize, ctx.workspace, "characterized_patterns")
    current_patterns = read_json(patterns)
    all_requests = current_patterns.get("generation_requests")
    if not isinstance(all_requests, list) or not all_requests:
        raise Rejected("characterized patterns contain no current Library delta")
    manifest_path = Path(str(ctx.binding("LFR_CUMULATIVE_LIBRARY_MANIFEST"))).resolve()
    manifest = read_json(manifest_path)
    validate_cumulative_manifest(manifest)
    portfolio = read_json(Path(str(ctx.binding("LFR_LOCAL_PORTFOLIO"))))
    portfolio = _filtered_portfolio(portfolio, all_requests)
    selected_ids = {row["candidate_id"] for row in portfolio["selected"]}
    requests = [request for request in all_requests if request["candidate_id"] in selected_ids]
    if len(manifest["functions"]) + len(requests) > int(ctx.binding("MAX_CELLS")):
        raise Rejected("current delta would exceed the MAX_CELLS cumulative Library cap")
    current_patterns = json.loads(json.dumps(current_patterns))
    current_patterns["generation_requests"] = requests
    candidate_cells = sorted({job["cell_name"] for job in expected_generation_jobs(current_patterns)})
    admitted_ids = selected_ids
    previous_libraries = _retained_shard_libraries(ctx, manifest)
    reference = (_mapping_library(ctx, "reference-cumulative.lib", previous_libraries)
                 if previous_libraries else ctx.file_binding("FOUNDRY_LIB"))
    augmented = _mapping_library(ctx, "augmented-cumulative.lib", [*previous_libraries, generated])
    portfolio_path = ctx.run_dir / "design-local-portfolio.json"
    atomic_json(portfolio_path, portfolio)
    mapping, profile = lfr_mapping_request(
        ctx, ctx.run_dir / "mapping", reference_liberty=reference,
        augmented_liberty=augmented)
    input_hashes = {str(path): sha_file(path) for path in lfr.required_mapping_input_paths(mapping)}
    selected_identity = {row["candidate_id"]: row["identity"] for row in portfolio["selected"]}
    baseline_record = prior(ctx, "evaluation-baseline")
    baseline_mapping = read_json(artifact(
        baseline_record, ctx.workspace, "library_richness_evaluation"))["mapping"]
    baseline_instances = sum(baseline_mapping["arms"]["reference"]["adoption"]["cell_census"].values())
    request = {
        "schema": "lfr-round/3", "mapping": mapping, "input_hashes": input_hashes,
        "candidate_cells": candidate_cells,
        "candidate_functions": [{
            "candidate_id": candidate_id,
            "candidate_cells": sorted(job["cell_name"] for job in expected_generation_jobs({
                "generation_requests": [next(row for row in requests if row["candidate_id"] == candidate_id)]
            })),
            "identity": selected_identity[candidate_id], "selected": True,
        } for candidate_id in sorted(admitted_ids)],
        "local_portfolio": {"path": str(portfolio_path), "sha256": sha_file(portfolio_path)},
        "timing": {"clock_period_ps": float(ctx.binding("CLOCK_NS")) * 1000.0,
                   "uncertainty_ps": 0.0},
        "scenarios": profile["scenarios"],
        "metric_policy": {
            "objectives": [
                {"metric": "F0.candidate_adoption_fraction", "direction": "maximize"},
                {"metric": "F1.levels_removed", "direction": "maximize"},
                {"metric": "F2.mapped_instance_count", "direction": "minimize"},
                {"metric": "F2.buffer_inverter_pressure_ratio", "direction": "minimize"},
                {"metric": "F3.worst_delay_indicator_ps", "direction": "minimize"},
                {"metric": "F3.negative_slack_mass_indicator_ps", "direction": "minimize"},
            ],
            "required_metrics": [
                "F0.candidate_adoption_fraction", "F0.known_cell_fraction",
                "F2.mapped_instance_count", "F2.max_logic_level", "F2.mean_fanout",
                "F2.mean_load_indicator", "F2.buffer_inverter_pressure_ratio",
                "F2.mean_path_stage_count", "F3.worst_delay_indicator_ps",
                "F3.negative_slack_mass_indicator_ps", "F3.path_family_coverage",
            ],
        },
        "budgets": {"max_candidate_cells": lfr_new_cell_budget(ctx) * len(DRIVE_FAMILY_ORDER),
                    "max_augmented_mapped_instances": max(1, baseline_instances * 2)},
    }
    request_path = ctx.run_dir / "round-request.json"
    atomic_json(request_path, request)
    evaluation = lfr.evaluate_round(request)
    if evaluation.get("status") != "succeeded":
        error = evaluation.get("error") or {}
        if error.get("code") == "incomparable-clock-identity":
            raise Rejected(
                "license-free round has incomparable clock identities: %s"
                % error.get("message")
            )
        raise ToolFailure("license-free round evaluation failed at %s: %s" % (
            evaluation.get("stage"), error.get("message")))
    _record_mapping(ctx, evaluation["mapping"])
    evaluation_path = ctx.run_dir / "evaluation.json"
    atomic_json(evaluation_path, evaluation)
    projected_root = ctx.run_dir / "projected-library"
    if manifest["shards"]:
        shutil.copytree(ctx.flow / "library" / "shards", projected_root / "shards")
    layout = prior(ctx, "layout")
    shard_artifacts = [generated, patterns]
    shard_artifacts.extend(checked_ref(ref, ctx.workspace) for ref in layout.get("artifacts", [])
                           if str(ref.get("role", "")).startswith("abstract_lef:"))
    projected = append_cumulative_shard(
        projected_root, manifest, "%04d" % (len(manifest["shards"]) + 1), requests,
        artifacts=shard_artifacts)
    function_keys = [function_identity(request)["key"] for request in requests]
    for key in function_keys:
        projected = advance_function_state(projected, key, "proxy-mapped")
    rounds = _frontier_rounds(ctx)
    round_id = "%04d" % (len(rounds) + 1)
    current_round = {
        "round_id": round_id,
        "research_question": {"id": "round-" + round_id + "-structure",
                              "prompt": "Does this cumulative Library delta advance F0-F3 indicators?"},
        "function_keys": function_keys,
        "library_cost": {"new_library_cells": len(candidate_cells),
                         "generation_units": len(candidate_cells)},
        "evaluation": evaluation,
    }
    frontier_request = {
        "schema": "lfr-frontier-request/1", "library_manifest": projected,
        "library_manifest_sha256": canonical_json_sha(projected),
        "budgets": {"max_rounds": 4,
                    "max_new_library_cells": int(ctx.binding("MAX_CELLS")) * len(DRIVE_FAMILY_ORDER),
                    "max_generation_units": float(ctx.binding("MAX_CELLS")) * len(DRIVE_FAMILY_ORDER),
                    "plateau_rounds": 2},
        "rounds": [*rounds, current_round],
        "next_residual_question": {
            "id": "round-" + round_id + "-residual",
            "prompt": "Find a new source-bound function that preserves F0/F1/F2 gains while resolving the current F3 or adoption blockers.",
        },
    }
    frontier = lfr.evaluate_frontier(frontier_request)
    if frontier.get("status") != "succeeded":
        raise Rejected("portfolio frontier rejected: %s" % (frontier.get("error") or {}).get("message"))
    frontier_request_path = ctx.run_dir / "frontier-request.json"
    frontier_path = ctx.run_dir / "frontier.json"
    atomic_json(frontier_request_path, frontier_request)
    atomic_json(frontier_path, frontier)
    persistent_root = ctx.flow / "library-richness"
    persistent_root.mkdir(parents=True, exist_ok=True)
    (persistent_root / "evaluation.json").write_bytes(evaluation_path.read_bytes())
    (persistent_root / "frontier.json").write_bytes(frontier_path.read_bytes())
    rounds_root = persistent_root / "rounds"
    rounds_root.mkdir(parents=True, exist_ok=True)
    history_path = rounds_root / (round_id + ".json")
    if history_path.exists():
        raise Rejected("Library richness round history already exists: " + round_id)
    blockers = list(frontier["e0_library_validation_candidate"].get("blocking_reasons") or [])
    history = {
        "schema": "hima.library-richness.round-history/1",
        "round_id": round_id, "status": "screened", "failures": blockers,
        "stop_reason": ("commercial validation admitted" if
                        frontier["e0_library_validation_candidate"]["value"] else
                        "residual structural or timing indicator work remains"),
        "evaluation_payload_sha256": evaluation["evaluation_payload_sha256"],
        "frontier_round": current_round,
        "frontier_payload_sha256": frontier["frontier_payload_sha256"],
    }
    atomic_json(history_path, history)
    shard_id = "%04d" % (len(manifest["shards"]) + 1)
    target_shard = ctx.flow / "library" / "shards" / shard_id
    if target_shard.exists():
        raise Rejected("cumulative Library shard already exists: " + shard_id)
    target_shard.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(projected_root / "shards" / shard_id, target_shard)
    persisted = projected
    if frontier["e0_library_validation_candidate"]["value"] is not True:
        failure = "; ".join(blockers) or "not admitted by the cross-round portfolio gate"
        for key in function_keys:
            persisted = advance_function_state(persisted, key, "proxy-rejected", failure=failure)
    atomic_json(manifest_path, persisted)
    ctx.inputs.extend([
        file_ref(patterns, ctx.workspace, "characterized_patterns", "layout-admitted-algorithm-output"),
        file_ref(portfolio_path, ctx.workspace, "local_portfolio", "F0-F1-evaluation"),
        file_ref(manifest_path, ctx.workspace, "cumulative_library_manifest", "campaign-library-state"),
        file_ref(request_path, ctx.workspace, "lfr_round_request", "pack-derived-proxy-request"),
    ])
    ctx.add_artifact(evaluation_path, "library_richness_evaluation",
                     "license-free-layered-evaluation")
    ctx.add_artifact(frontier_request_path, "portfolio_frontier_request",
                     "license-free-frontier-request")
    ctx.add_artifact(frontier_path, "portfolio_frontier", "license-free-cross-round-frontier")
    ctx.facts.update({
        "evaluationPhase": "design-mapping-timing", "commercialEdaExecuted": False,
        "metricVectorComplete": evaluation["metric_completeness"]["complete"],
        "pairwiseRelation": evaluation["pairwise_relation"]["relation"],
        "portfolioFrontierMember": round_id in frontier["frontier_member_ids"],
        "e0LibraryValidationCandidate": frontier["e0_library_validation_candidate"]["value"],
        "roundId": round_id,
    })


def stage_freeze_cumulative_library(ctx):
    evaluation_record = prior(ctx, "design-mapping-timing-evaluation")
    frontier = read_json(artifact(evaluation_record, ctx.workspace, "portfolio_frontier"))
    if frontier.get("e0_library_validation_candidate", {}).get("value") is not True:
        raise Rejected("frontier does not admit the candidate Library to E0")
    characterize = prior(ctx, "characterize")
    patterns = artifact(characterize, ctx.workspace, "characterized_patterns")
    generated = artifact(characterize, ctx.workspace, "generated_liberty")
    requests = read_json(patterns).get("generation_requests")
    if not isinstance(requests, list) or not requests:
        raise Rejected("freeze has no characterized Library delta")
    manifest_path = Path(str(ctx.binding("LFR_CUMULATIVE_LIBRARY_MANIFEST"))).resolve()
    manifest = read_json(manifest_path)
    validate_cumulative_manifest(manifest)
    updated = manifest
    for request in requests:
        key = function_identity(request)["key"]
        matches = [row for row in updated["functions"] if row["functionKey"] == key]
        if len(matches) != 1 or matches[0]["state"] != "proxy-mapped":
            raise Rejected("freeze candidate is absent from the admitted proxy-mapped shard")
        for state in ("materialized", "predicted", "cumulative"):
            updated = advance_function_state(updated, key, state)
    atomic_json(manifest_path, updated)
    cumulative_libraries = _retained_shard_libraries(ctx, updated)
    cumulative_liberty = _custom_library(ctx, "cumulative-custom.lib", cumulative_libraries)
    published_liberty = ctx.flow / "library" / "cumulative-custom.lib"
    published_liberty.write_bytes(cumulative_liberty.read_bytes())
    cumulative_requests, cumulative_lefs = [], []
    active_keys = {row["functionKey"] for row in updated["functions"]
                   if row["state"] != "proxy-rejected"}
    for shard in updated["shards"]:
        if not active_keys.intersection(shard["functionKeys"]):
            continue
        directory = ctx.flow / "library" / "shards" / shard["id"]
        shard_doc = read_json(directory / "manifest.json")
        for ref in shard_doc["artifacts"]:
            at = directory / ref["path"]
            if ref["path"].endswith("characterized-patterns.json"):
                cumulative_requests.extend(read_json(at)["generation_requests"])
            elif ref["path"].endswith(".lef"):
                cumulative_lefs.append(at)
    cumulative_patterns = ctx.flow / "library" / "cumulative-patterns.json"
    atomic_json(cumulative_patterns, {
        "report_schema": "xspace_cell-pattern-search/v2",
        "strategy_id": "cumulative_library", "source_graph": "append-only-shards",
        "generation_requests": cumulative_requests,
    })
    cumulative_lef = ctx.flow / "library" / "cumulative-custom.lef"
    bodies = []
    for lef in cumulative_lefs:
        body, keep = [], False
        for line in lef.read_text(errors="replace").splitlines():
            if line.startswith("MACRO"):
                keep = True
            if line.startswith("END LIBRARY"):
                keep = False
                continue
            if keep:
                body.append(line)
        if body:
            bodies.append("\n".join(body))
    if not bodies:
        raise Rejected("cumulative Library has no abstract LEF macros")
    cumulative_lef.write_text("VERSION 5.7 ;\n" + "\n".join(bodies) + "\nEND LIBRARY\n")
    round_id = str(evaluation_record.get("facts", {}).get("roundId") or "")
    history_path = ctx.flow / "library-richness" / "rounds" / (round_id + ".json")
    if not history_path.is_file():
        raise Rejected("admitted round history is absent: " + round_id)
    ctx.inputs.extend([
        file_ref(patterns, ctx.workspace, "characterized_patterns", "layout-admitted-algorithm-output"),
        file_ref(generated, ctx.workspace, "generated_liberty", "learned-model-prediction"),
    ])
    ctx.add_artifact(manifest_path, "cumulative_library_manifest", "campaign-library-state")
    ctx.add_artifact(published_liberty, "cumulative_custom_liberty", "cumulative-custom-library")
    ctx.add_artifact(cumulative_lef, "cumulative_custom_lef", "cumulative-custom-library")
    ctx.add_artifact(cumulative_patterns, "cumulative_patterns", "cumulative-custom-library")
    ctx.add_artifact(history_path, "library_richness_round_history", "license-free-round-history")
    ctx.facts.update({"cumulativeLibraryCellCount": len(updated["functions"]),
                      "cumulativeLibraryShardCount": len(updated["shards"]),
                      "newLibraryCellCount": len(expected_generation_jobs({"generation_requests": requests})),
                      "roundId": round_id})


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


def route_args(ctx, route, output, netlist, skeleton, liberty, timing_report):
    spec = STRATEGIES[route]
    skeletons = list(skeleton) if isinstance(skeleton, (list, tuple)) else [skeleton]
    common = [
        "--netlist", str(netlist),
        *(value for path in skeletons for value in ("--liberty-skeleton", str(path))),
        "--output", str(output), "--strategy-id", route,
        "--objective", spec["objective"], "--top", str(int(ctx.binding("MAX_ROUTE_CANDIDATES"))),
        "--process-family", str(ctx.binding("PROCESS_FAMILY")),
        "--cell-architecture-ref", str(ctx.binding("CELL_ARCHITECTURE_REF")),
        "--characterization-profile-ref", str(ctx.binding("CHARACTERIZATION_PROFILE_REF")),
        *(value for drive in ("D1", "D2", "D4", "D6", "D8")
          for value in ("--drive-strength", drive)),
        "--vt-class", str(ctx.binding("VT_CLASS")),
    ]
    if spec["engine"] == "timing":
        return ["/usr/bin/python3", str(DOMAIN / "mine_timing_route.py"), *common,
                "--full-liberty", str(liberty), "--timing-report", str(timing_report),
                "--expected-top", str(ctx.binding("DESIGN_TOP")),
                "--generated-cell-pattern", str(ctx.binding("GENERATED_LIB_CELL_PATTERN"))]
    return ["/usr/bin/python3", str(DOMAIN / "mine_patterns.py"), *common,
            "--source-graph", "mapped"]


def mining_source(ctx):
    """Use the latest valid generated post-route graph, else the initial DC probe."""
    pnr_path = ctx.flow / "records" / "pnr-generated.json"
    compare_path = ctx.flow / "records" / "compare.json"
    if pnr_path.is_file() and compare_path.is_file():
        pnr = prior(ctx, "pnr-generated")
        compare = prior(ctx, "compare")
        if compare.get("facts", {}).get("comparison_valid") is True:
            netlist = artifact(pnr, ctx.workspace, "postroute_netlist")
            compressed = artifact(pnr, ctx.workspace, "postroute_timing_paths")
            generated_refs = [row for group in ("inputs", "artifacts")
                              for row in pnr.get(group, []) if row.get("role") == "generated_liberty"]
            if len(generated_refs) != 1:
                raise Rejected("prior generated P&R record has no unique generated Liberty input")
            generated_liberty = checked_ref(generated_refs[0], ctx.workspace, "generated_liberty")
            timing = ctx.run_dir / "postroute-timing.rpt"
            try:
                with gzip.open(compressed, "rb") as source:
                    timing.write_bytes(source.read())
            except (OSError, EOFError) as exc:
                raise Rejected("generated post-route timing paths are not readable gzip: %s" % exc) from exc
            if not timing.read_bytes():
                raise Rejected("generated post-route timing paths are empty")
            ctx.inputs.extend([
                file_ref(pnr_path, ctx.workspace, "postroute_source_record", "prior-stage-record"),
                file_ref(compare_path, ctx.workspace, "postroute_comparison_record", "prior-stage-record"),
                file_ref(netlist, ctx.workspace, "postroute_source_netlist", "innovus-output"),
                file_ref(compressed, ctx.workspace, "postroute_source_timing_gzip", "innovus-output"),
                file_ref(generated_liberty, ctx.workspace, "postroute_generated_liberty", "learned-model-prediction"),
            ])
            ctx.add_artifact(timing, "postroute_source_timing", "decompressed-innovus-output")
            return netlist, timing, "generated-postroute", generated_liberty
    baseline_path = ctx.flow / "records" / "evaluation-baseline.json"
    if baseline_path.is_file():
        baseline = prior(ctx, "evaluation-baseline")
        netlist = artifact(baseline, ctx.workspace, "baseline_mapped_netlist")
        timing = artifact(baseline, ctx.workspace, "baseline_proxy_reg2reg")
        ctx.inputs.extend([
            file_ref(baseline_path, ctx.workspace, "license_free_baseline_record",
                     "prior-stage-record"),
            file_ref(netlist, ctx.workspace, "license_free_baseline_netlist",
                     "license-free-mapping-output"),
            file_ref(timing, ctx.workspace, "license_free_baseline_reg2reg",
                     "license-free-proxy-sta"),
        ])
        return netlist, timing, "license-free-baseline", None
    probe_path = ctx.flow / "probe.json"
    probe = read_json(probe_path)
    if probe.get("format") != "custom-cell-fmax-probe/2" or probe.get("toolExit") != 0:
        raise Rejected("flow/probe.json is not a successful immutable custom Cell Fmax probe")
    evidence = probe.get("evidence") or {}
    net_ref = evidence.get("netlist.v")
    timing_ref = evidence.get("timing.rpt")
    if not isinstance(net_ref, dict) or not isinstance(timing_ref, dict):
        raise Rejected("probe has no netlist.v or timing.rpt evidence")
    relative = Path(str(net_ref.get("path") or ""))
    timing_relative = Path(str(timing_ref.get("path") or ""))
    if relative.is_absolute() or ".." in relative.parts or timing_relative.is_absolute() or ".." in timing_relative.parts:
        raise Rejected("probe mining source escapes flow")
    netlist = (ctx.flow / relative).resolve()
    timing = (ctx.flow / timing_relative).resolve()
    if (not netlist.is_relative_to(ctx.flow.resolve()) or netlist.is_symlink() or not netlist.is_file()
            or not timing.is_relative_to(ctx.flow.resolve()) or timing.is_symlink() or not timing.is_file()):
        raise Rejected("probe mining source is missing or escapes flow")
    require_hash(netlist, net_ref.get("sha256"), "probe netlist")
    require_hash(timing, timing_ref.get("sha256"), "probe timing report")
    ctx.inputs.extend([
        file_ref(probe_path, ctx.workspace, "probe_record", "real-tool-record"),
        file_ref(netlist, ctx.workspace, "probe_netlist", "real-tool-output"),
        file_ref(timing, ctx.workspace, "probe_reg2reg_timing", "real-tool-output"),
    ])
    return netlist, timing, "dc-probe", None


def stage_mine(ctx, route):
    if route not in ROUTES:
        raise Rejected("mine route must be one of: " + ",".join(ROUTES))
    netlist, timing_report, source_phase, generated_liberty = mining_source(ctx)
    skeleton = ctx.file_binding("LIBERTY_SKELETON")
    liberty = ctx.file_binding("FOUNDRY_LIB")
    if generated_liberty is not None:
        skeleton = [skeleton, generated_liberty]
    target = ctx.run_dir / "raw.json"
    code_hash = mining_sources_hash()
    log = ctx.run(route_args(ctx, route, target, netlist, skeleton, liberty, timing_report), tag="mine-" + route)
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
    raw.setdefault("search_definition", {})["source_phase"] = source_phase
    atomic_json(target, raw)
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
        "sourceTimingSha256": sha_file(timing_report), "designTop": str(ctx.binding("DESIGN_TOP")),
        "sourceLibrarySha256": sha_bytes("".join(
            sha_file(path) for path in ([*skeleton, liberty] if isinstance(skeleton, list)
                                        else [skeleton, liberty])).encode()),
        "pathGroup": "reg2reg", "sourcePhase": source_phase,
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
                "reg2reg_path_hits", "reg2reg_increment_ns", "reg2reg_cone_delay_upper_ns",
                "reg2reg_path_family_count",
                "reg2reg_path_family_ids", "reg2reg_path_family_support",
                "reg2reg_worst_path_slack_ns",
                "search_objective", "discovery_algorithm", "library_function_match", "ppa_status",
            )},
        })
    return {"schema": "custom-cell-fmax-mining-research-view/1", "sourceSha256": sha_file(raw_path),
            "minerCodeSha256": code_hash, "route": raw["strategy_id"], "candidates": candidates,
            "sourcePhase": (raw.get("search_definition") or {}).get("source_phase"),
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


def collision_safe_candidate_id(candidate_id, equivalence_digest, used):
    """Disambiguate route-local ids without introducing illegal punctuation."""
    if candidate_id not in used:
        return candidate_id
    suffix = re.sub(r"[^A-Za-z0-9_$]", "_", str(equivalence_digest)).upper()[:12]
    if not suffix:
        raise Rejected("candidate id collision has no usable equivalence digest")
    return "%s_%s" % (candidate_id, suffix)


def namespace_generation_requests(requests, shard_id):
    """Give every newly materialized request an immutable shard namespace.

    Miner candidate ids are deliberately local ranking labels and may repeat in
    a later round.  Physical Cell names are derived from those ids, so the
    append-only Library must add the next shard id before generation.  Exact
    function reuse is filtered separately by ``function_identity``; a repeated
    label for a different function is disambiguated inside the same shard by
    the existing digest rule.
    """
    if not isinstance(shard_id, str) or not re.fullmatch(r"[0-9]{4}", shard_id):
        raise Rejected("generation request namespace needs a four-digit shard id")
    if not isinstance(requests, list):
        raise Rejected("generation requests must be an array before namespacing")
    result, used = [], set()
    for index, request in enumerate(requests):
        if not isinstance(request, dict):
            raise Rejected("generation request %d is not an object" % index)
        row = json.loads(json.dumps(request))
        candidate_id = row.get("candidate_id")
        if not isinstance(candidate_id, str) or not IDENTIFIER.fullmatch(candidate_id):
            raise Rejected("generation request %d has an invalid candidate id" % index)
        try:
            key = function_identity(row)["key"]
        except ValueError as exc:
            raise Rejected(str(exc)) from exc
        scoped = "%s_G%s" % (candidate_id, shard_id)
        row["candidate_id"] = collision_safe_candidate_id(scoped, key, used)
        used.add(row["candidate_id"])
        result.append(row)
    expected_generation_jobs({"generation_requests": result})
    return result


def method_rankings(rows):
    result = {}
    for row in rows:
        current = result.get(row["route"])
        if current is None or row["rank"] < current["local_rank"]:
            result[row["route"]] = {
                "candidate_id": row["candidateId"], "local_rank": row["rank"],
                "search_objective": STRATEGIES[row["route"]]["objective"],
            }
    return result


def retained_prior_requests(ctx, budget):
    adoption_path = ctx.flow / "records" / "adoption.json"
    characterize_path = ctx.flow / "records" / "characterize.json"
    if not adoption_path.is_file() or not characterize_path.is_file():
        return []
    adoption = prior(ctx, "adoption")
    characterize = prior(ctx, "characterize")
    patterns_path = artifact(characterize, ctx.workspace, "characterized_patterns")
    patterns = read_json(patterns_path)
    requests = patterns.get("generation_requests")
    candidate_rows = (adoption.get("facts") or {}).get("candidate_rows")
    if not isinstance(requests, list):
        raise Rejected("prior characterized patterns have no generation requests")
    retained_ids = retained_candidate_ids(candidate_rows, budget)
    by_id = {row.get("candidate_id"): row for row in requests if isinstance(row, dict)}
    if len(by_id) != len(requests) or any(candidate not in by_id for candidate in retained_ids):
        raise Rejected("prior adopted candidates differ from characterized patterns")
    ctx.inputs.extend([
        file_ref(adoption_path, ctx.workspace, "prior_adoption_record", "prior-stage-record"),
        file_ref(characterize_path, ctx.workspace, "prior_characterize_record", "prior-stage-record"),
        file_ref(patterns_path, ctx.workspace, "prior_characterized_patterns", "layout-admitted-algorithm-output"),
    ])
    return [json.loads(json.dumps(by_id[candidate])) for candidate in retained_ids]


def stage_merge(ctx):
    budget = lfr_new_cell_budget(ctx)
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 50:
        raise Rejected("MAX_NEW_CELLS must be within 1..50")
    manifest_path = (ctx.flow / "library" / "cumulative-manifest.json").resolve()
    manifest = read_json(manifest_path)
    validate_cumulative_manifest(manifest)
    shard_id = "%04d" % (len(manifest["shards"]) + 1)
    ctx.inputs.append(file_ref(manifest_path, ctx.workspace, "cumulative_library_manifest",
                               "campaign-library-state"))
    research_path = ctx.flow / "research" / "research.json"
    if not research_path.is_file() or research_path.is_symlink():
        raise Rejected("AI research report is absent before merge")
    research = read_json(research_path)
    if research.get("schema") == "lfr-ai-residual-research/1":
        proposals = research.get("candidate_proposals")
        if not isinstance(proposals, list) or not 1 <= len(proposals) <= budget:
            raise Rejected("residual research candidate_proposals exceed MAX_NEW_CELLS or are empty")
        pool_path = Path(str(ctx.binding("LFR_CANDIDATE_POOL"))).resolve()
        pool = read_json(pool_path)
        pool_requests = pool.get("generation_requests")
        if not isinstance(pool_requests, list):
            raise Rejected("function/local candidate pool has no generation requests")
        allowed = {canonical_json_sha(request): request for request in pool_requests}
        selected = []
        selected_demands = []
        proposal_keys = set()
        for index, proposal in enumerate(proposals):
            if not isinstance(proposal, dict):
                raise Rejected("residual research proposal %d is not an object" % index)
            transformation = proposal.get("transformation")
            key = (transformation.get("proposal_key")
                   if isinstance(transformation, dict) else None)
            request = proposal.get("generation_request")
            expected = proposal.get("generation_request_sha256")
            observed = canonical_json_sha(request) if isinstance(request, dict) else None
            if (not isinstance(key, str) or not key or key in proposal_keys
                    or observed != expected or observed not in allowed):
                raise Rejected("residual research proposal identity is not bound to the candidate pool")
            proposal_keys.add(key)
            errors = validate_generation_request(request)
            if errors or (request.get("implementation_plan") or {}).get("route") not in BUILDABLE_ROUTES:
                raise Rejected("residual research selected an invalid/unbuildable generation request")
            if ((request.get("generator_contract") or {}).get("implementation_request") or {}).get(
                    "drive_strengths") != ["D1", "D2", "D4", "D6", "D8"]:
                raise Rejected("residual research must request the complete D1/D2/D4/D6/D8 family")
            demand = proposal.get("cell_demand")
            if (not isinstance(demand, dict) or demand.get("schema") != "hima.cell-demand/1"
                    or not isinstance(demand.get("required_delay_ns"), (int, float))
                    or isinstance(demand.get("required_delay_ns"), bool)
                    or float(demand["required_delay_ns"]) <= 0):
                raise Rejected("residual research proposal has no valid Cell Demand")
            selected.append(json.loads(json.dumps(request)))
            selected_demands.append(json.loads(json.dumps(demand)))
        identities = [function_identity(request)["key"] for request in selected]
        if len(identities) != len(set(identities)):
            raise Rejected("residual research selected a duplicate function identity")
        selected = namespace_generation_requests(selected, shard_id)
        for request, demand in zip(selected, selected_demands):
            demand["candidate_id"] = request["candidate_id"]
            demand["physical_cells"] = [job["cell_name"] for job in expected_generation_jobs({
                "generation_requests": [request],
            })]
        demand_document = {
            "schema": "hima.cell-demand-ledger/1", "status": "declared",
            "shard_id": shard_id, "demand_count": len(selected_demands),
            "demands": selected_demands,
            "research_sha256": sha_file(research_path),
        }
        merged = {
            "report_schema": "xspace_cell-pattern-search/v2",
            "strategy_id": "residual_research_delta", "source_graph": "license-free-baseline-mapped",
            "search_bound": {"global_cell_budget": budget, "validation_flow_count": 1,
                             "selection_authority": "bounded-residual-research"},
            "generation_requests": selected,
            "candidate_set_accounting": {"selected_candidate_count": len(selected),
                                         "new_candidate_count": len(selected),
                                         "retained_candidate_count": 0},
            "provenance": {"researchSha256": sha_file(research_path),
                           "candidatePoolSha256": sha_file(pool_path),
                           "proposalKeys": sorted(proposal_keys),
                           "physicalCellNamespace": "G" + shard_id},
            "limitations": ["This is one cumulative-Library delta, not a commercial QoR prediction."],
        }
        held = ctx.run_dir / "merged.json"
        atomic_json(held, merged)
        target = ctx.flow / "mining" / "merged.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(held.read_bytes())
        demand_path = ctx.run_dir / "cell-demands.json"
        atomic_json(demand_path, demand_document)
        published_demands = ctx.flow / "mining" / "cell-demands.json"
        published_demands.write_bytes(demand_path.read_bytes())
        ctx.inputs.extend([
            file_ref(research_path, ctx.workspace, "ai_residual_research", "agent-research"),
            file_ref(pool_path, ctx.workspace, "candidate_pool", "source-bound-candidate-pool"),
        ])
        ctx.add_artifact(held, "merged_patterns", "algorithm-output")
        ctx.add_artifact(demand_path, "cell_demands", "agent-demand-contract")
        ctx.facts.update({"candidate_count": len(selected), "retained_candidate_count": 0,
                          "research_schema": research["schema"],
                          "cell_demand_count": len(selected_demands)})
        return
    if (research.get("schema") != "custom-cell-fmax-ai-research/1"
            or not isinstance(research.get("selected"), list)
            or not isinstance(research.get("hypotheses"), list)
            or not 3 <= len(research["hypotheses"]) <= 12):
        raise Rejected("AI research report identity/hypotheses are invalid")
    retained = retained_prior_requests(ctx, budget) if ctx.evidence_class == "synthetic-fixture" else []
    retained_ids = [row["candidate_id"] for row in retained]
    report_retained = research.get("retainedCandidates")
    if (not isinstance(report_retained, list)
            or [row.get("candidate_id") for row in report_retained if isinstance(row, dict)] != retained_ids):
        raise Rejected("AI research retained-candidate set differs from cumulative/fixture evidence")
    research_ids = {route: [] for route in ROUTES}
    for row in research["selected"]:
        if (not isinstance(row, dict) or row.get("route") not in ROUTES
                or not isinstance(row.get("candidate_id"), str)):
            raise Rejected("AI research selection is malformed")
        research_ids[row["route"]].append(row["candidate_id"])
    ctx.inputs.append(file_ref(research_path, ctx.workspace, "ai_research_selection", "agent-research"))
    reports = {}
    all_reports = {}
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
        if (not isinstance(ids, list) or len(ids) > budget or len(ids) != len(set(ids))
                or any(not isinstance(x, str) for x in ids)):
            raise Rejected("%s selected candidate ids must be a unique array" % route)
        if ids != research_ids[route]:
            raise Rejected("%s selected ids differ from the AI research report" % route)
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
        all_reports[route] = all_requests
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
        for rank, request in enumerate(all_reports[route], 1):
            if (request.get("implementation_plan") or {}).get("route") not in BUILDABLE_ROUTES:
                continue
            key = candidate_key(request)
            if not key[0]:
                raise Rejected("candidate has no equivalence digest")
            members.setdefault(key, []).append({"route": route, "rank": rank,
                                                 "candidateId": request.get("candidate_id")})
            if key not in grouped or candidate_rank(request) < candidate_rank(grouped[key]):
                grouped[key] = json.loads(json.dumps(request))
    retained_keys = {candidate_key(request) for request in retained}
    grouped = {key: request for key, request in grouped.items() if key not in retained_keys}
    for key, winner in grouped.items():
        evidence = winner.setdefault("discovery_evidence", {})
        evidence["strategy_ids"] = sorted({row["route"] for row in members[key]}, key=ROUTES.index)
        evidence["strategy_rankings"] = method_rankings(members[key])
    identities = {
        (route, request.get("candidate_id")): request
        for route in ROUTES for request in all_reports[route]
        if isinstance(request, dict)
    }
    selected = [json.loads(json.dumps(request)) for request in retained]
    seen = set()
    seen.update(retained_keys)
    used_candidate_ids = set(retained_ids)
    for choice in research["selected"]:
        identity = (choice["route"], choice["candidate_id"])
        request = identities.get(identity)
        if request is None:
            raise Rejected("AI research selected a candidate outside the measured method pools")
        key = candidate_key(request)
        if key in seen:
            raise Rejected("AI research selected the same Boolean/interface candidate twice")
        seen.add(key)
        row = json.loads(json.dumps(request))
        row["candidate_id"] = collision_safe_candidate_id(
            row.get("candidate_id"), key[0], used_candidate_ids)
        used_candidate_ids.add(row["candidate_id"])
        evidence = row.setdefault("discovery_evidence", {})
        evidence["strategy_ids"] = sorted({member["route"] for member in members[key]}, key=ROUTES.index)
        evidence["strategy_rankings"] = method_rankings(members[key])
        evidence["research_hypothesis"] = choice["hypothesis"]
        evidence["research_rationale"] = choice["rationale"]
        selected.append(row)
    if len(selected) != len(retained) + min(budget - len(retained), len(grouped)):
        raise Rejected("AI research did not fill the one unified Cell screen")
    selected[len(retained):] = namespace_generation_requests(
        selected[len(retained):], shard_id)
    selected_ids = [row.get("candidate_id") for row in selected]
    if len(selected_ids) != len(set(selected_ids)):
        raise Rejected("distinct Boolean equivalence classes collide on candidate_id")
    duplicates = []
    for key, rows in members.items():
        if key not in grouped:
            continue
        winner = grouped[key]["candidate_id"]
        duplicates.extend({"kept": winner, "duplicate": row["candidateId"], "strategy_id": row["route"],
                           "equivalence_digest": key[0]} for row in rows if row["candidateId"] != winner)
    merged = {
        "report_schema": "xspace_cell-pattern-search/v2",
        "strategy_id": "collaborative_method_union", "source_graph": "mapped",
        "search_bound": {"strategy_count": 6, "strategies": list(ROUTES), "global_cell_budget": budget,
                         "selection_authority": "ai-authored-unified-cell-ranking",
                         "validation_flow_count": 1,
                         "retained_adopted_candidate_count": len(retained)},
        "generation_requests": selected,
        "candidate_set_accounting": {
            "selected_candidate_count": len(selected), "unique_buildable_pool_count": len(grouped),
            "retained_candidate_count": len(retained),
            "new_candidate_count": len(selected) - len(retained),
            "source_candidate_count": sum(len(rows) for rows in all_reports.values()),
            "equivalent_duplicate_count": len(duplicates),
            "route_selected_counts": {route: len(reports[route]) for route in ROUTES},
            "method_contribution_counts": {
                route: sum(1 for request in selected
                           if route in set((request.get("discovery_evidence") or {}).get("strategy_ids") or []))
                for route in ROUTES
            },
        },
        "deduplication": duplicates, "provenance": route_provenance,
        "limitations": ["All methods contribute evidence to one de-duplicated Cell set; method rows are not separate EDA trials.",
                        "No adoption or PPA benefit is implied by the AI-authored generation order."],
    }
    held = ctx.run_dir / "merged.json"
    atomic_json(held, merged)
    target = ctx.flow / "mining" / "merged.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(held.read_bytes())
    ctx.add_artifact(held, "merged_patterns", "algorithm-output")
    ctx.facts.update({"candidate_count": len(selected), "unique_pool_count": len(grouped),
                      "duplicate_count": len(duplicates), "route_count": 6,
                      "research_hypothesis_count": len(research["hypotheses"]),
                      "research_algorithm_sha256": (research.get("algorithm") or {}).get("entrySha256")})


def stage_generate(ctx):
    merged_record = prior(ctx, "merge")
    patterns = artifact(merged_record, ctx.workspace, "merged_patterns")
    ctx.inputs.append(file_ref(patterns, ctx.workspace, "merged_patterns", "algorithm-output"))
    manifest_path = Path(str(ctx.binding("LFR_CUMULATIVE_LIBRARY_MANIFEST"))).resolve()
    manifest = read_json(manifest_path)
    validate_cumulative_manifest(manifest)
    jobs = expected_delta_generation_jobs(read_json(patterns), manifest)
    if not jobs:
        raise Rejected("merged candidate set is empty")
    if len({job["candidate_id"] for job in jobs}) > lfr_new_cell_budget(ctx):
        raise Rejected("new candidate delta exceeds MAX_NEW_CELLS")
    ctx.inputs.append(file_ref(manifest_path, ctx.workspace, "cumulative_library_manifest",
                               "campaign-library-state"))
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
        argv = list(command)
        for output in job["outputs"]:
            argv.extend(["--function", output["liberty_function"],
                         "--output", output["output_name"]])
        argv.extend(["--inputs", ",".join(job["inputs"]), "--pdk", str(pdk),
                     "--cell-name", job["cell_name"], "--out", str(target), "--quiet"])
        try:
            ctx.run(argv, cwd=cwd, timeout=int(ctx.binding("GENERATION_TIMEOUT_SEC")),
                    tag="bool2cmos-%02d" % index)
            code = 0
        except ToolFailure:
            code = ctx.executions[-1]["exitCode"]
        if code == 0 and target.is_file():
            target.write_text(scale_spice_drive(
                target.read_text(errors="replace"), source_cell=job["cell_name"],
                target_cell=job["cell_name"], drive=job["drive"]))
        structural = target.is_file() and spice_netlist_is_structural(target.read_text(errors="replace"), job["cell_name"])
        attempts.append({"candidate_id": job["candidate_id"], "cell_name": job["cell_name"],
                         "drive": job["drive"], "returncode": code,
                         "structural": structural})
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
    abstract_timeout = int(ctx.binding("ABSTRACT_TIMEOUT_SEC"))
    placement_timeout = max(1, min(120, abstract_timeout - 10))
    manifest_rows = []
    family_names = set()
    for cell in cells:
        drive_match = re.search(r"_(D1|D2|D4|D6|D8)$", cell.stem)
        if drive_match is None:
            raise Rejected("generated Cell has no physical drive suffix: " + cell.stem)
        drive = drive_match.group(1)
        family = cell.stem[:drive_match.start()]
        family_names.add(family)
        manifest_rows.append({
            "cell": cell.stem, "drive": drive, "drive_scale": drive_scale(drive),
            "family": family, "netlist": str(cell), "out": str(ctx.run_dir / cell.stem),
        })
    manifest_path = ctx.run_dir / "layout-family-manifest.json"
    atomic_json(manifest_path, manifest_rows)
    result_path = ctx.run_dir / "layout-family-results.json"
    workers = max(1, min(5, int(ctx.binding("MULTI_CPU")), len(family_names)))
    argv = ["/usr/bin/python3", str(DOMAIN / "layout_family_batch.py"),
            "--manifest", str(manifest_path), "--result", str(result_path),
            "--abstract-cell", str(DOMAIN / "abstract_cell.py"),
            "--tech", str(tech), "--rule-deck", str(rules),
            "--power-pin", power, "--ground-pin", ground,
            "--placement-timeout", str(placement_timeout),
            "--cell-timeout", str(abstract_timeout), "--workers", str(workers)]
    ctx.run(argv, env=env, timeout=abstract_timeout, tag="layout-family-batch")
    batch_execution = ctx.executions.pop()
    batch_log = dict(batch_execution["log"])
    batch_log["role"] = "layout_family_batch_log"
    ctx.artifacts.append(batch_log)
    result = read_json(result_path)
    rows = result.get("results") if isinstance(result, dict) else None
    if (not isinstance(result, dict) or result.get("schema") != "hima.layout-family-batch/1"
            or not isinstance(rows, list) or len(rows) != len(cells)):
        raise ToolFailure("layout family batch emitted no complete result manifest")
    ctx.add_artifact(manifest_path, "layout_family_manifest", "generated-tool-input")
    ctx.add_artifact(result_path, "layout_family_results", "nested-tool-evidence")
    built, attempts = [], []
    for row in rows:
        log = Path(str(row.get("log") or ""))
        ctx.executions.append({
            "argv": row.get("argv") or ["layout-family-refused"],
            "cwd": str(ctx.run_dir), "exitCode": int(row.get("returncode")),
            "elapsedSeconds": float(row.get("elapsed_seconds") or 0.0),
            "log": file_ref(log, ctx.workspace, "layout:%s_log" % row.get("cell_name"),
                            "tool-log") if log.is_file() else batch_log,
        })
        lef, meta = Path(str(row.get("lef"))), Path(str(row.get("meta")))
        complete = row.get("complete") is True and lef.is_file() and meta.is_file()
        diagnostic = row.get("diagnostic")
        if row.get("returncode") == 0 and not complete:
            diagnostic = "abstract generator returned success without LEF and metadata"
        attempts.append({"cell_name": row.get("cell_name"),
                         "exit_code": int(row.get("returncode")),
                         "admitted": complete, "diagnostic": diagnostic})
        if complete:
            built.append((lef, meta))
    attempt_path = ctx.run_dir / "layout-attempts.json"
    atomic_json(attempt_path, attempts)
    ctx.add_artifact(attempt_path, "layout_attempts", "tool-evidence")
    for lef, meta in built:
        ctx.add_artifact(lef, "abstract_lef:" + lef.stem, "generated-abstract")
        ctx.add_artifact(meta, "abstract_metadata:" + lef.stem, "generated-abstract-metadata")
    refused = [row for row in attempts if not row["admitted"]]
    ctx.facts.update({"layout_attempt_count": len(attempts), "abstract_cell_count": len(built),
                      "layout_refused_count": len(refused), "layout_refusals": refused,
                      "layout_family_count": len(family_names), "layout_workers": workers,
                      "placement_solver_runs": len(family_names),
                      "placement_reuse_count": len(cells) - len(family_names)})
    if not built:
        raise ToolFailure("no candidate produced a complete abstract LEF/metadata pair")


def admitted_patterns(patterns, cell_names):
    jobs = expected_generation_jobs(patterns)
    names_by_candidate = {}
    for job in jobs:
        names_by_candidate.setdefault(job["candidate_id"], set()).add(job["cell_name"])
    admitted = {candidate for candidate, names in names_by_candidate.items() if names <= set(cell_names)}
    document = json.loads(json.dumps(patterns))
    document["generation_requests"] = [request for request in patterns["generation_requests"]
                                       if request.get("candidate_id") in admitted]
    accounting = document.setdefault("candidate_set_accounting", {})
    accounting["layout_admitted_candidate_count"] = len(document["generation_requests"])
    accounting["layout_refused_candidate_count"] = len(patterns["generation_requests"]) - len(document["generation_requests"])
    return document


def stage_characterize(ctx):
    _record, generated_cells = generated_spice(ctx)
    layout = prior(ctx, "layout")
    layout_cells = {str(ref.get("role")).split(":", 1)[1]: checked_ref(ref, ctx.workspace)
                    for ref in layout.get("artifacts", [])
                    if str(ref.get("role", "")).startswith("abstract_lef:")}
    generated_by_name = {cell.stem: cell for cell in generated_cells}
    if not layout_cells or not set(layout_cells) <= set(generated_by_name):
        raise Rejected("layout evidence names no valid generated Cell subset")
    merged = artifact(prior(ctx, "merge"), ctx.workspace, "merged_patterns")
    patterns = admitted_patterns(read_json(merged), set(layout_cells))
    cells = [generated_by_name[job["cell_name"]] for job in expected_generation_jobs(patterns)]
    if not cells:
        raise Rejected("no complete candidate remains after abstract-layout admission")
    admitted_dir = ctx.run_dir / "admitted-cells"
    admitted_dir.mkdir()
    admitted_cells = []
    for cell in cells:
        target = admitted_dir / cell.name
        target.write_bytes(cell.read_bytes())
        admitted_cells.append(target)
    admitted_path = ctx.run_dir / "characterized-patterns.json"
    atomic_json(admitted_path, patterns)
    ctx.inputs.append(file_ref(merged, ctx.workspace, "merged_patterns", "algorithm-output"))
    ctx.add_artifact(admitted_path, "characterized_patterns", "layout-admitted-algorithm-output")
    base = ctx.file_binding("FOUNDRY_LIB")
    foundry_cdl = ctx.file_binding("FOUNDRY_CDL", "foundry-cdl-topology-reference")
    timing = ctx.file_binding("CHARMODEL_TIMING_MODEL", "learned-model")
    power = ctx.file_binding("CHARMODEL_POWER_MODEL", "learned-model")
    area = ctx.file_binding("CHARMODEL_AREA_MODEL", "learned-model")
    out = ctx.run_dir / "generated.lib"
    calibration_report = ctx.run_dir / "mock-liberty-calibration.json"
    demand_path = artifact(prior(ctx, "merge"), ctx.workspace, "cell_demands")
    calibration_policy = DOMAIN / "mock_liberty_policy.json"
    ctx.inputs.extend([
        file_ref(foundry_cdl, ctx.workspace, "FOUNDRY_CDL", "site-input"),
        file_ref(demand_path, ctx.workspace, "cell_demands", "agent-demand-contract"),
        file_ref(calibration_policy, ctx.workspace, "mock_liberty_policy", "pack-method"),
    ])
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
    argv = ["/usr/bin/python3", str(DOMAIN / "charlib_emit.py"), "--netlist-dir", str(admitted_dir),
            "--base", str(base), "--timing-model", str(timing), "--power-model", str(power),
            "--area-model", str(area), "--power-pin", env["CCFMAX_POWER_PIN"],
            "--ground-pin", env["CCFMAX_GROUND_PIN"], "--library-name", str(ctx.binding("GENERATED_LIBRARY_NAME")),
            "--foundry-cdl", str(foundry_cdl), "--calibration-policy", str(calibration_policy),
            "--cell-demands", str(demand_path), "--calibration-report", str(calibration_report),
            "--prediction-dir", str(prediction_dir), "--prediction-executions", str(prediction_manifest),
            "-o", str(out)]
    ctx.run(argv, env=env, timeout=int(ctx.binding("CHARACTERIZE_TIMEOUT_SEC")), tag="charmodel")
    if not out.is_file() or not out.read_text(errors="replace").lstrip().startswith("/*"):
        raise ToolFailure("learned-model characterization emitted no Liberty")
    predicted_names = set(re.findall(r"(?m)^\s*cell\s*\(\s*\"?([A-Za-z_][A-Za-z0-9_$]*)", out.read_text(errors="replace")))
    if predicted_names != {cell.stem for cell in admitted_cells}:
        raise ToolFailure("learned-model Liberty does not exactly cover the generated Cell set")
    ctx.add_artifact(out, "generated_liberty", "learned-model-prediction")
    calibration = read_json(calibration_report)
    demands = calibration.get("cell_demands") if isinstance(calibration, dict) else None
    if (calibration.get("schema") != "hima.mock-liberty-calibration/1"
            or calibration.get("status") not in {"accepted", "rejected"}
            or not isinstance(demands, dict) or not demands):
        raise ToolFailure("Mock Liberty calibration emitted no complete, routable Cell Demand report")
    ctx.add_artifact(calibration_report, "mock_liberty_calibration",
                     "topology-anchored-mock-evidence")
    ctx.add_artifact(prediction_manifest, "prediction_executions", "nested-tool-evidence")
    nested = read_json(prediction_manifest)
    if not isinstance(nested, list) or len(nested) != len(admitted_cells):
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
    met_demand_count = sum(row.get("met_by_any_drive") is True for row in demands.values())
    ctx.facts.update({"predicted_cell_count": len(predicted_names), "characterization_type": "learned-model-prediction",
                      "measured_characterization": False,
                      "mock_liberty_calibration_status": calibration["status"],
                      "mock_liberty_calibration_accepted": int(calibration["status"] == "accepted"),
                      "cell_demand_count": len(demands),
                      "cell_demand_met_count": met_demand_count,
                      "cell_demand_unmet_count": len(demands) - met_demand_count,
                      "cell_demand_coverage_pct": 100.0 * met_demand_count / len(demands),
                      "drive_family": ["D1", "D2", "D4", "D6", "D8"]})


def stage_compile(ctx):
    frozen_path = ctx.flow / "records" / "freeze-cumulative-library.json"
    if frozen_path.is_file():
        liberty = artifact(prior(ctx, "freeze-cumulative-library"), ctx.workspace,
                           "cumulative_custom_liberty")
        role, source = "cumulative_custom_liberty", "cumulative-custom-library"
    elif ctx.evidence_class == "synthetic-fixture":
        liberty = artifact(prior(ctx, "characterize"), ctx.workspace, "generated_liberty")
        role, source = "generated_liberty", "learned-model-prediction"
    else:
        raise Rejected("cumulative Library must be frozen before compile")
    ctx.inputs.append(file_ref(liberty, ctx.workspace, role, source))
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


def synthesis_period(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise Rejected("synthesis period must be a finite number")
    if not math.isfinite(parsed) or parsed < 0.1 or parsed > 5:
        raise Rejected("synthesis period must be within [0.1, 5] ns")
    return parsed


def dc_cell_area(path):
    text = Path(path).read_text(errors="replace")
    values = [float(value) for value in re.findall(r"^Total cell area:\s*([0-9.eE+-]+)\s*$", text, re.M)]
    if len(values) != 1 or not math.isfinite(values[0]) or values[0] <= 0:
        raise Rejected("Design Compiler area report has no unique positive total cell area")
    return values[0]


def dc_target_pressure(path, expected_top):
    text = Path(path).read_text(errors="replace")
    designs = re.findall(r"(?m)^Design\s*:\s*(\S+)\s*$", text)
    groups = re.findall(r"(?m)^\s*Path Group:\s*(\S+)\s*$", text)
    starts = re.findall(r"(?m)^\s*Startpoint:\s*(.+)$", text)
    ends = re.findall(r"(?m)^\s*Endpoint:\s*(.+)$", text)
    slacks = [float(value) for value in re.findall(
        r"(?m)^\s*slack \([^)]*\)\s+(-?[0-9.eE+-]+)\s*$", text)]
    if designs != [expected_top]:
        raise Rejected("DC target pressure report has the wrong top")
    if not groups or len(groups) != len(slacks) or set(groups) != {"reg2reg"}:
        raise Rejected("DC target pressure report is not exclusively reg2reg")
    if len(starts) != len(groups) or len(ends) != len(groups):
        raise Rejected("DC target pressure report has incomplete path endpoints")
    if not all(math.isfinite(value) for value in slacks):
        raise Rejected("DC target pressure report has nonfinite slack")
    return {"top": expected_top, "pathGroup": "reg2reg", "pathCount": len(groups),
            "worstSlackNs": min(slacks)}


def stage_synth(ctx, custom, period=None):
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
    clock_ns = synthesis_period(ctx.binding("CLOCK_NS") if period is None else period)
    values = {
        "DESIGN_TOP": ctx.binding("DESIGN_TOP"), "DESIGN_RTL_GLOB": rtl_glob,
        "FOUNDRY_DB": foundry, "CLK_NS": clock_ns, "CCFMAX_ARM": arm,
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
    target_timing = ctx.run_dir / "reports" / ("timing_reg2reg_" + arm + ".rpt")
    area_report = ctx.run_dir / "reports" / ("area_" + arm + ".rpt")
    for at, role in ((netlist, "synthesis_netlist"), (sdc, "synthesis_sdc"),
                     (refs, "reference_report"), (timing, "synthesis_timing_report"),
                     (target_timing, "synthesis_reg2reg_timing_report"),
                     (area_report, "synthesis_area_report")):
        ctx.add_artifact(at, role, "design-compiler-output")
    dc_uncertainty = re.findall(r"=== CUSTOM_CELL_FMAX DC_UNCERTAINTY_NS ([0-9.eE+-]+) ===", text)
    route_uncertainty = re.findall(r"=== CUSTOM_CELL_FMAX ROUTE_UNCERTAINTY_NS ([0-9.eE+-]+) ===", text)
    if len(dc_uncertainty) != 1 or len(route_uncertainty) != 1:
        raise ToolFailure("DC log lacks the fixed optimization-pressure markers")
    dc_uncertainty_ns, route_uncertainty_ns = float(dc_uncertainty[0]), float(route_uncertainty[0])
    if (not math.isclose(dc_uncertainty_ns, clock_ns * 0.50, abs_tol=1e-12)
            or not math.isclose(route_uncertainty_ns, clock_ns * 0.25 + 0.050, abs_tol=1e-12)):
        raise Rejected("DC and route uncertainty do not match the fixed 50% DC / 25%+50ps APR method")
    target_pressure = dc_target_pressure(target_timing, str(ctx.binding("DESIGN_TOP")))
    if not custom and target_pressure["worstSlackNs"] >= 0:
        raise Rejected("foundry synthesis has no negative reg2reg optimization pressure")
    publish_condition_identity(ctx, {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "synthesis",
        "commonInputs": held_identities(ctx.inputs,
            exact=("FOUNDRY_DB", "shared_synth_template", "shared_synth_constraints", "EDA_WRAPPER"),
            prefixes=("rtl:",)),
        "entryContractSha256": sha_bytes(normalized_synth_entry(entry.read_text()).encode()),
        "tool": version,
        "clockNs": clock_ns,
        "dcUncertaintyNs": dc_uncertainty_ns,
        "routeUncertaintyNs": route_uncertainty_ns,
        "armSpecificExclusions": ["CCFMAX_ARM", "CCFMAX_CUSTOM_DB", "generated_db"],
    })
    ctx.facts.update({
        "arm": "generated" if custom else "foundry", "library_visible": visible,
        "design_top": str(ctx.binding("DESIGN_TOP")),
        "clock_ns": clock_ns,
        "dc_uncertainty_ns": dc_uncertainty_ns,
        "route_uncertainty_ns": route_uncertainty_ns,
        "synthesis_cell_area_um2": dc_cell_area(area_report),
        "reg2reg_path_count": target_pressure["pathCount"],
        "reg2reg_wns_ns": target_pressure["worstSlackNs"],
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
    frozen_path = ctx.flow / "records" / "freeze-cumulative-library.json"
    if frozen_path.is_file():
        frozen = prior(ctx, "freeze-cumulative-library")
        liberty = artifact(frozen, ctx.workspace, "cumulative_custom_liberty")
        patterns = artifact(frozen, ctx.workspace, "cumulative_patterns")
        pattern_document = read_json(patterns)
        characterize_path = ctx.flow / "records" / "characterize.json"
        if characterize_path.is_file():
            characterize = prior(ctx, "characterize")
            current_patterns = artifact(
                characterize, ctx.workspace, "characterized_patterns")
            pattern_document = _overlay_current_method_provenance(
                pattern_document, read_json(current_patterns))
            ctx.inputs.append(file_ref(
                current_patterns, ctx.workspace, "current_characterized_patterns",
                "layout-admitted-algorithm-output"))
    elif ctx.evidence_class == "synthetic-fixture":
        characterize = prior(ctx, "characterize")
        liberty = artifact(characterize, ctx.workspace, "generated_liberty")
        patterns = artifact(characterize, ctx.workspace, "characterized_patterns")
        pattern_document = read_json(patterns)
    else:
        raise Rejected("cumulative Library must be frozen before adoption")
    synth_log = execution_log(synth, ctx.workspace, "custom-dc_log")
    projection = project_attributed_texts(netlist.read_text(errors="replace"), liberty.read_text(errors="replace"),
                                          pattern_document)
    evidence = ctx.run_dir / "adoption.json"
    atomic_json(evidence, projection)
    ctx.add_artifact(evidence, "adoption_projection", "derived-from-netlist-master-relation")
    ctx.inputs.extend([file_ref(netlist, ctx.workspace, "custom_netlist", "design-compiler-output"),
                       file_ref(liberty, ctx.workspace, "offered_library", "learned-model-prediction"),
                       file_ref(patterns, ctx.workspace, "characterized_patterns", "layout-admitted-algorithm-output"),
                       file_ref(synth_log, ctx.workspace, "custom_synth_log", "tool-log")])
    ctx.facts.update({"library_visible": visible, **projection})


def _overlay_current_method_provenance(frozen_patterns, current_patterns):
    """Enrich frozen function identities without changing Library authority."""
    frozen_requests = frozen_patterns.get("generation_requests") if isinstance(frozen_patterns, dict) else None
    current_requests = current_patterns.get("generation_requests") if isinstance(current_patterns, dict) else None
    if not isinstance(frozen_requests, list) or not isinstance(current_requests, list):
        raise Rejected("method provenance overlay requires two generation request arrays")
    current_by_key = {}
    for request in current_requests:
        try:
            key = function_identity(request)["key"]
        except (TypeError, ValueError) as exc:
            raise Rejected("current characterized pattern identity is invalid: %s" % exc) from exc
        if key in current_by_key:
            raise Rejected("current characterized patterns repeat one function identity")
        current_by_key[key] = request
    result = json.loads(json.dumps(frozen_patterns))
    for request in result["generation_requests"]:
        try:
            key = function_identity(request)["key"]
        except (TypeError, ValueError) as exc:
            raise Rejected("frozen cumulative pattern identity is invalid: %s" % exc) from exc
        evidence = request.setdefault("discovery_evidence", {})
        methods = evidence.get("strategy_ids")
        rankings = evidence.get("strategy_rankings")
        if (isinstance(methods, list) and methods and isinstance(rankings, dict)
                and set(rankings) == set(methods)):
            continue
        current = current_by_key.get(key)
        current_evidence = (current or {}).get("discovery_evidence") or {}
        methods = current_evidence.get("strategy_ids")
        rankings = current_evidence.get("strategy_rankings")
        if (not isinstance(methods, list) or not methods
                or len(methods) != len(set(methods))
                or not isinstance(rankings, dict) or set(rankings) != set(methods)):
            raise Rejected("current matching function has no exact contributing-method provenance")
        evidence["strategy_ids"] = json.loads(json.dumps(methods))
        evidence["strategy_rankings"] = json.loads(json.dumps(rankings))
    return result


def fill_template(path, mapping):
    text = path.read_text()
    for key, value in mapping.items():
        text = text.replace("@@%s@@" % key, str(value))
    leftover = sorted(set(re.findall(r"@@([A-Z_]+)@@", text)))
    if leftover:
        raise Rejected("unfilled %s template fields: %s" % (path.name, ",".join(leftover)))
    return text


def checkpoint_allowed_links(inputs, workspace, init_script, mmmc_script, arm, phase):
    if phase not in ("init", "place", "postroute"):
        raise Rejected("checkpoint link phase must be init, place or postroute")
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
        # Innovus retains the source SDC link in the init checkpoint. After
        # placement it serializes the active constraints into the database and
        # deliberately drops that external link; requiring it at place made a
        # valid vendor checkpoint look incomplete.
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


def merged_lef(ctx, layout, allowed_cells):
    lefs = {str(ref.get("role")).split(":", 1)[1]: checked_ref(ref, ctx.workspace)
            for ref in layout.get("artifacts", []) if str(ref.get("role", "")).startswith("abstract_lef:")}
    if not allowed_cells or not set(allowed_cells) <= set(lefs):
        raise Rejected("layout stage lacks a characterized Cell LEF")
    out = ctx.run_dir / "generated.lef"
    bodies = []
    for name in sorted(allowed_cells):
        lef = lefs[name]
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
    text = "\n".join(line for line in text.splitlines()
                     if not re.match(r"^\s*(?:floorPlan|loadFPlan|saveFPlan|loadIoFile|saveIoFile|setPlaceMode -place_global_place_io_pins)\b", line))
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


FLOORPLAN_AREA_EXPANSION = 2.0


def expanded_floorplan_utilization(value):
    """Convert the reviewed strategy utilization into a core with twice the area."""
    requested = float(floorplan_utilization(value))
    return "%.6f" % (requested / FLOORPLAN_AREA_EXPANSION)


def innovus_route_layer_index(value):
    """Normalize the Site's M7-style layer name to Innovus's integer route level."""
    if isinstance(value, bool):
        raise Rejected("Innovus maximum routing layer must be a positive integer or M<number>")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        match = re.fullmatch(r"M?([1-9][0-9]*)", value.strip(), re.IGNORECASE)
        if match is None:
            raise Rejected("Innovus maximum routing layer must be a positive integer or M<number>")
        parsed = int(match.group(1))
    else:
        raise Rejected("Innovus maximum routing layer must be a positive integer or M<number>")
    if parsed <= 0:
        raise Rejected("Innovus maximum routing layer must be a positive integer or M<number>")
    return parsed


def innovus_batch_wrapper(directory, script, tag):
    """Wrap an Innovus Tcl file so a script error exits instead of opening an idle prompt."""
    source = Path(script).resolve()
    if "}" in str(source) or not source.is_file() or source.is_symlink():
        raise Rejected("Innovus batch source must be one plain brace-safe Tcl file")
    if not isinstance(tag, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", tag):
        raise Rejected("Innovus batch wrapper tag is invalid")
    wrapper = Path(directory).resolve() / ("batch-" + tag + ".tcl")
    wrapper.write_text(
        "if {[catch {source {%s}} hima_error hima_options]} {\n"
        "  puts stderr \"HIMA_BATCH_ERROR: $hima_error\"\n"
        "  if {[dict exists $hima_options -errorinfo]} { puts stderr [dict get $hima_options -errorinfo] }\n"
        "  exit 1\n"
        "}\n"
        "exit 0\n" % source
    )
    return wrapper


def pnr_density_markers(text, arm):
    """Read bounded physical-failure facts from the Innovus log, including failed runs."""
    labels = {
        "LOGIC OCCUPANCY": "logic_occupancy",
        "PLANNED OCCUPANCY": "planned_occupancy",
        "FIXED CELL AREA": "fixed_cell_area_um2",
        "EFFECTIVE OCCUPANCY": "placed_effective_occupancy",
        "POST-CTS EFFECTIVE OCCUPANCY": "post_cts_effective_occupancy",
        "FINAL EFFECTIVE OCCUPANCY": "final_effective_occupancy",
    }
    result = {}
    for label, key in labels.items():
        rows = re.findall(
            r"(?m)^=== CCFMAX V5 %s %s ([0-9.eE+-]+) ===$" %
            (re.escape(label), re.escape(arm)), text)
        if len(rows) > 1:
            raise Rejected("Innovus log repeats density marker " + label)
        if rows:
            value = float(rows[0])
            if not math.isfinite(value):
                raise Rejected("Innovus density marker is not finite: " + label)
            result[key] = value
    drc_rows = re.findall(r"(?m)^(\d+) geometry drc markers are saved\s*$", text)
    if len(drc_rows) > 1:
        raise Rejected("Innovus log repeats the saved DRC marker total")
    if drc_rows:
        result["route_drc_violations"] = int(drc_rows[0])
    result["innovus_process_exit_code"] = 0
    result["innovus_batch_error_count"] = text.count("HIMA_BATCH_ERROR:")
    classes = []
    if re.search(r"IMPSP-(?:2002|2021|9022)", text):
        classes.append("placement-legalization")
    if "VERIFY DRC did not complete" in text or drc_rows:
        classes.append("route-drc-overflow")
    if classes:
        result["innovus_failure_class"] = "+".join(classes)
    return result


def clock_tree_identity(netlist, buffer_cells, inverter_cells):
    """Audit CCOpt-inserted clock instances in the saved routed netlist."""
    buffers = str(buffer_cells).split()
    inverters = str(inverter_cells).split()
    allowed = set(buffers + inverters)
    rows = re.findall(
        r"(?m)^\s*([A-Za-z_][A-Za-z0-9_$]*)\s+(CTS_[A-Za-z0-9_$]+)\s*\(",
        Path(netlist).read_text(errors="replace"),
    )
    if not rows:
        raise Rejected("routed netlist contains no auditable CTS_ clock-tree instance")
    illegal = sorted({master for master, _instance in rows if master not in allowed})
    if illegal:
        raise Rejected("clock tree uses non-declared or non-DCCK Cells: " + ",".join(illegal))
    return {
        "clock_tree_cell_count": len(rows),
        "clock_tree_buffer_cells": buffers,
        "clock_tree_inverter_cells": inverters,
        "clock_tree_used_cells": sorted({master for master, _instance in rows}),
    }


def core_box_from_log(path):
    text = Path(path).read_text(errors="replace")
    rows = re.findall(r"=== core area:\s*\{\s*([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s*\}\s*===", text)
    if len(rows) != 1:
        raise Rejected("Innovus init log has no unique core-area marker")
    box = [float(value) for value in rows[0]]
    if not all(math.isfinite(value) for value in box) or box[2] <= box[0] or box[3] <= box[1]:
        raise Rejected("Innovus init core area is invalid")
    return box


def pin_plan_identity(path):
    text = Path(path).read_text(errors="replace")
    side = None
    pins = []
    for line in text.splitlines():
        section = re.match(r"\s*\((top|bottom|left|right)\s*$", line)
        if section:
            side = section.group(1)
            continue
        pin = re.match(r'\s*\(pin\s+name="([^"]+)"\s+(.*?)\)\s*$', line)
        if pin:
            if side is None:
                raise Rejected("IO plan pin has no side")
            attributes = " ".join(pin.group(2).split())
            pins.append((pin.group(1), side, attributes))
    if not pins or len({name for name, _side, _attrs in pins}) != len(pins):
        raise Rejected("IO plan has no unique complete pin set")
    canonical = "\n".join("|".join(row) for row in sorted(pins)) + "\n"
    return {"sha256": sha_bytes(canonical.encode()), "pinCount": len(pins),
            "canonicalization": "pin name, side and normalized saveIoFile -locations attributes"}


def physical_plan_identity(physical_facts):
    """Validate and identify the V5 PG/no-DCAP/effective-density contract."""
    facts = {}
    lines = Path(physical_facts).read_text(errors="replace").splitlines()
    if not lines or lines[0] != "metric\tvalue\tunit":
        raise Rejected("physical facts lack their exact header")
    for line in lines[1:]:
        fields = line.split("\t")
        if len(fields) == 3:
            facts[fields[0]] = {"value": float(fields[1]), "unit": fields[2]}
    required = {"occupied_standard_cell_area", "core_area", "effective_site_occupancy",
                "dcap_count", "pg_special_wire_count"}
    if required - set(facts):
        raise Rejected("physical facts are incomplete")
    occupancy = facts["effective_site_occupancy"]["value"]
    if not 0.0 < occupancy <= 1.0:
        raise Rejected("effective site occupancy is outside (0, 1]")
    if int(facts["dcap_count"]["value"]) != 0:
        raise Rejected("V5.1 physical facts prove unexpected DCAP insertion")
    if facts["pg_special_wire_count"]["value"] <= 0:
        raise Rejected("physical facts prove no PG special wires")
    return {"dcapPolicy": "disabled", "dcapCount": 0,
            "effectiveSiteOccupancy": occupancy,
            "pgSpecialWireCount": int(facts["pg_special_wire_count"]["value"])}


def build_arm_files(ctx, utilization, fixed_pin_plan=None, fixed_core_box=None, fixed_floorplan=None):
    foundry_synth, custom_synth = prior(ctx, "foundry-synth"), prior(ctx, "custom-synth")
    frozen_path = ctx.flow / "records" / "freeze-cumulative-library.json"
    if frozen_path.is_file():
        frozen = prior(ctx, "freeze-cumulative-library")
        generated_lib = artifact(frozen, ctx.workspace, "cumulative_custom_liberty")
        generated_lef = artifact(frozen, ctx.workspace, "cumulative_custom_lef")
        characterized_patterns = artifact(frozen, ctx.workspace, "cumulative_patterns")
    elif ctx.evidence_class == "synthetic-fixture":
        layout, char = prior(ctx, "layout"), prior(ctx, "characterize")
        generated_lib = artifact(char, ctx.workspace, "generated_liberty")
        characterized_patterns = artifact(char, ctx.workspace, "characterized_patterns")
        characterized_cells = {job["cell_name"] for job in expected_generation_jobs(read_json(characterized_patterns))}
        generated_lef = merged_lef(ctx, layout, characterized_cells)
    else:
        raise Rejected("cumulative Library must be frozen before P&R")
    characterized_cells = {job["cell_name"] for job in expected_generation_jobs(read_json(characterized_patterns))}
    if not characterized_cells:
        raise Rejected("cumulative Library has no characterized Cell identities")
    ctx.inputs.append(file_ref(characterized_patterns, ctx.workspace, "characterized_patterns",
                               "layout-admitted-algorithm-output"))
    site = {name: ctx.file_binding(name) for name in
            ("TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH", "FOUNDRY_GDS", "CCFMAX_GDS_MAP")}
    route_layer_index = innovus_route_layer_index(ctx.binding("CCFMAX_MAX_ROUTE_LAYER"))
    ctx.facts["innovus_route_top_layer_index"] = route_layer_index
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
        place_site = str(ctx.binding("PLACE_SITE"))
        floorplan = ctx.run_dir / ("floorplan_" + arm + ".fp")
        if arm == "generated" and fixed_floorplan is not None:
            floorplan_command = "loadFPlan {%s}" % fixed_floorplan
        else:
            floorplan_command = "floorPlan -site %s -r 1.0 %s 2.0 2.0 2.0 2.0" % (place_site, utilization)
        floorplan_capture = "saveFPlan {%s}" % floorplan
        init = fill_template(DOMAIN / "init.tcl.tmpl", {
            "LEF_LIST": " ".join(map(str, lefs)), "NETLIST": netlist,
            "DESIGN_TOP": ctx.binding("DESIGN_TOP"),
            "MMMC_FILE": mmmc_path, "PWR_NET": ctx.binding("CCFMAX_POWER_PIN"),
            "GND_NET": ctx.binding("CCFMAX_GROUND_PIN"), "PROCESS_NODE": ctx.binding("CCFMAX_PROCESS_NODE"),
            "MAX_ROUTE_LAYER": route_layer_index, "INIT_DB": init_db,
            "GENERATED_LIB_CELL_PATTERN": ctx.binding("GENERATED_LIB_CELL_PATTERN"), "ARM": arm,
            "PLACE_SITE": place_site,
            "FLOORPLAN_COMMAND": floorplan_command,
            "FLOORPLAN_CAPTURE": floorplan_capture,
        })
        rpt = ctx.run_dir / ("rpt_" + arm)
        final_db = ctx.run_dir / ("DBS_" + arm) / "postroute.enc"
        place_db = ctx.run_dir / ("DBS_" + arm) / "place.enc"
        gds = ctx.run_dir / (arm + ".gds")
        postroute_sdc = rpt / "postroute-active.sdc"
        postroute_netlist = rpt / "postroute-netlist.v"
        endpoint_index = rpt / "setup-endpoints.tsv"
        endpoint_report = rpt / "endpoint-worst-setup.rpt"
        pin_plan = ctx.run_dir / ("pins_" + arm + ".io")
        if arm == "generated" and fixed_pin_plan is not None:
            pin_setup = "loadIoFile {%s}\nsetPlaceMode -place_global_place_io_pins false" % fixed_pin_plan
        else:
            pin_setup = "setPlaceMode -place_global_place_io_pins true"
        pin_capture = "saveIoFile -locations {%s}\nsetPlaceMode -place_global_place_io_pins false" % pin_plan
        pnr = fill_template(DOMAIN / "pnr.tcl.tmpl", {
            "INIT_DB": str(init_db) + ".dat", "DESIGN_TOP": ctx.binding("DESIGN_TOP"),
            "PLACE_DB": place_db,
            "MULTI_CPU": ctx.binding("MULTI_CPU"), "TAP_CELL": ctx.binding("CCFMAX_TAP_CELL"),
            "TAP_INTERVAL": ctx.binding("CCFMAX_TAP_INTERVAL"),
            "PWR_NET": ctx.binding("CCFMAX_POWER_PIN"), "GND_NET": ctx.binding("CCFMAX_GROUND_PIN"),
            "PHYSICAL_FACTS": ctx.run_dir / ("rpt_" + arm) / "physical-facts.tsv",
            "DENSITY_REPORT": ctx.run_dir / ("rpt_" + arm) / "density-map.rpt",
            "FLOORPLAN_UTILIZATION": utilization,
            "MAX_EFFECTIVE_DENSITY": ctx.binding("CCFMAX_MAX_EFFECTIVE_DENSITY"),
            "PG_HORIZONTAL_LAYER": ctx.binding("CCFMAX_PG_HORIZONTAL_LAYER"),
            "PG_VERTICAL_LAYER": ctx.binding("CCFMAX_PG_VERTICAL_LAYER"),
            "PG_RING_WIDTH_UM": ctx.binding("CCFMAX_PG_RING_WIDTH_UM"),
            "PG_RING_SPACING_UM": ctx.binding("CCFMAX_PG_RING_SPACING_UM"),
            "PG_STRIPE_WIDTH_UM": ctx.binding("CCFMAX_PG_STRIPE_WIDTH_UM"),
            "PG_STRIPE_SPACING_UM": ctx.binding("CCFMAX_PG_STRIPE_SPACING_UM"),
            "PG_STRIPE_SET_DISTANCE_UM": ctx.binding("CCFMAX_PG_STRIPE_SET_DISTANCE_UM"),
            "PG_STRIPE_START_OFFSET_UM": ctx.binding("CCFMAX_PG_STRIPE_START_OFFSET_UM"),
            "RPT_DIR": rpt, "FINAL_DB": final_db, "GDS_OUT": gds,
            "GDS_MAP": site["CCFMAX_GDS_MAP"], "MERGE_GDS": site["FOUNDRY_GDS"],
            "SWITCHING_ACTIVITY": ctx.binding("CCFMAX_SWITCHING_ACTIVITY"), "ARM": arm,
            "CLOCK_BUFFER_CELLS": ctx.binding("CCFMAX_CLOCK_BUFFER_CELLS"),
            "CLOCK_INVERTER_CELLS": ctx.binding("CCFMAX_CLOCK_INVERTER_CELLS"),
            "POSTROUTE_SDC": postroute_sdc,
            "POSTROUTE_NETLIST": postroute_netlist,
            "ENDPOINT_INDEX": endpoint_index,
            "ENDPOINT_REPORT": endpoint_report,
            "PIN_SETUP": pin_setup, "PIN_CAPTURE": pin_capture,
        })
        init_path, pnr_path = ctx.run_dir / ("init_" + arm + ".tcl"), ctx.run_dir / ("pnr_" + arm + ".tcl")
        init_path.write_text(init); pnr_path.write_text(pnr)
        texts[arm] = {"init": init, "pnr": pnr}
        outputs[arm] = {"mmmc": mmmc_path, "init": init_path, "pnr": pnr_path,
                        "init_checkpoint_base": init_db, "final_checkpoint_base": final_db,
                        "place_checkpoint_base": place_db,
                        "gds": gds, "postroute_sdc": postroute_sdc,
                        "postroute_netlist": postroute_netlist,
                        "endpoint_index": endpoint_index,
                        "endpoint_report": endpoint_report,
                        "pin_plan": pin_plan,
                        "physical_facts": ctx.run_dir / ("rpt_" + arm) / "physical-facts.tsv",
                        "density_report": ctx.run_dir / ("rpt_" + arm) / "density-map.rpt",
                        "floorplan": floorplan,
                        "input_sdc": sdc, "input_netlist": netlist}
    arm_only_paths = (str(generated_lib), str(generated_lef))
    matched = all(
        normalized_arm_script(texts["foundry"][kind], arm_only_paths)
        == normalized_arm_script(texts["generated"][kind], arm_only_paths)
        for kind in ("init", "pnr"))
    if not matched:
        differences = []
        for kind in ("init", "pnr"):
            differences.extend(difflib.unified_diff(
                normalized_arm_script(texts["foundry"][kind], arm_only_paths).splitlines(),
                normalized_arm_script(texts["generated"][kind], arm_only_paths).splitlines(), lineterm=""))
        raise Rejected("paired P&R scripts differ outside the declared arm inputs: "
                       + " | ".join(differences[:8]))
    return outputs, generated_lef, generated_lib


def stage_pnr(ctx, arm, utilization="0.60"):
    requested_utilization = floorplan_utilization(utilization)
    utilization = expanded_floorplan_utilization(requested_utilization)
    fixed_pin_plan = None
    fixed_core_box = None
    fixed_floorplan = None
    if arm == "generated":
        foundry_record = prior(ctx, "pnr-foundry")
        fixed_pin_plan = artifact(foundry_record, ctx.workspace, "fixed_pin_plan")
        fixed_floorplan = artifact(foundry_record, ctx.workspace, "fixed_floorplan")
        fixed_core_box = foundry_record.get("facts", {}).get("floorplan_core_box")
        if (not isinstance(fixed_core_box, list) or len(fixed_core_box) != 4
                or not all(isinstance(value, (int, float)) for value in fixed_core_box)):
            raise Rejected("foundry arm has no reusable fixed core box")
        ctx.inputs.append(file_ref(fixed_pin_plan, ctx.workspace, "fixed_pin_plan", "innovus-output"))
        ctx.inputs.append(file_ref(fixed_floorplan, ctx.workspace, "fixed_floorplan", "innovus-output"))
    outputs, generated_lef, generated_lib = build_arm_files(
        ctx, utilization, fixed_pin_plan, fixed_core_box, fixed_floorplan)
    ctx.facts["floorplan_requested_utilization"] = float(requested_utilization)
    ctx.facts["floorplan_utilization"] = float(utilization)
    ctx.facts["floorplan_area_expansion"] = FLOORPLAN_AREA_EXPANSION
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
    init_batch = innovus_batch_wrapper(ctx.run_dir, chosen["init"], "init-" + arm)
    ctx.add_artifact(init_batch, "innovus_batch_wrapper:init:" + arm, "generated-tool-input")
    init_log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(init_batch)], cwd=ctx.run_dir,
                       timeout=int(ctx.binding("PNR_TIMEOUT_SEC")), tag="init-" + arm)
    text = init_log.read_text(errors="replace")
    if tool_error_lines(text):
        raise ToolFailure("Innovus init error in %s: %s" % (init_log, " | ".join(tool_error_lines(text)[:8])))
    init_version = innovus_version(text)
    core_box = core_box_from_log(init_log)
    if fixed_core_box is not None and core_box != [float(value) for value in fixed_core_box]:
        raise Rejected("generated arm core box differs from the frozen foundry floorplan")
    floorplan = chosen["floorplan"]
    if not floorplan.is_file() or floorplan.is_symlink():
        raise ToolFailure("Innovus init did not save the active floorplan")
    ctx.add_artifact(floorplan, "fixed_floorplan" if arm == "foundry" else "applied_floorplan",
                     "innovus-floorplan")
    floorplan_spr = Path(str(floorplan) + ".spr")
    if floorplan_spr.is_file() and not floorplan_spr.is_symlink():
        ctx.add_artifact(floorplan_spr, "fixed_floorplan_special_routes" if arm == "foundry"
                         else "applied_floorplan_special_routes", "innovus-floorplan")
    visible_hits = re.findall(r"=== CCFMAX GENERATED_LIB_CELLS_AFTER_RESTORE (\d+) ===", text)
    visible = int(visible_hits[0]) if len(visible_hits) == 1 else None
    if arm == "generated" and (visible is None or visible <= 0):
        raise Rejected("generated library visibility was not proved after Innovus restore")
    init_restore = publish_checkpoint(ctx, chosen["init_checkpoint_base"],
                                      "init_checkpoint", init_links, "init")
    if str(init_restore) not in chosen["pnr"].read_text(errors="replace"):
        raise Rejected("PnR script does not restore the validated init checkpoint directory")
    pnr_batch = innovus_batch_wrapper(ctx.run_dir, chosen["pnr"], "pnr-" + arm)
    ctx.add_artifact(pnr_batch, "innovus_batch_wrapper:pnr:" + arm, "generated-tool-input")
    pnr_log = ctx.run([wrapper, "innovus", "-no_gui", "-files", str(pnr_batch)], cwd=ctx.run_dir,
                      timeout=int(ctx.binding("PNR_TIMEOUT_SEC")), tag="pnr-" + arm)
    pnr_text = pnr_log.read_text(errors="replace")
    density_markers = pnr_density_markers(pnr_text, arm)
    ctx.facts.update(density_markers)
    if tool_error_lines(pnr_text):
        raise ToolFailure("Innovus P&R error in %s; density context %s: %s" % (
            pnr_log, json.dumps(density_markers, sort_keys=True),
            " | ".join(tool_error_lines(pnr_text)[:8])))
    route_version = innovus_version(pnr_text)
    if init_version != route_version:
        raise Rejected("Innovus init and route tool versions differ")
    if ("=== CCFMAX PNR DONE %s (GDS written) ===" % arm) not in pnr_text:
        raise ToolFailure("Innovus P&R log lacks the completion marker for " + arm)
    place_marker = "=== CCFMAX PLACE CHECKPOINT %s %s ===" % (
        arm, chosen["place_checkpoint_base"])
    if place_marker not in pnr_text:
        raise ToolFailure("Innovus P&R log lacks the placed-checkpoint marker")
    place_links = checkpoint_allowed_links(
        ctx.inputs, ctx.workspace, chosen["init"], chosen["mmmc"], arm, "place")
    publish_checkpoint(ctx, chosen["place_checkpoint_base"],
                       "place_checkpoint", place_links, "place")
    if not chosen["postroute_netlist"].is_file() or chosen["postroute_netlist"].is_symlink():
        raise ToolFailure("Innovus P&R did not save the routed logical netlist")
    clock_tree = clock_tree_identity(
        chosen["postroute_netlist"],
        ctx.binding("CCFMAX_CLOCK_BUFFER_CELLS"),
        ctx.binding("CCFMAX_CLOCK_INVERTER_CELLS"),
    )
    plan_identity = pin_plan_identity(chosen["pin_plan"])
    if fixed_pin_plan is not None and plan_identity != pin_plan_identity(fixed_pin_plan):
        raise Rejected("generated arm pin locations differ from the frozen foundry pin plan")
    physical_identity = physical_plan_identity(chosen["physical_facts"])
    if arm == "generated":
        reference_physical = foundry_record.get("facts", {}).get("v5_physical_identity")
        if not isinstance(reference_physical, dict):
            raise Rejected("foundry arm has no V5 physical identity")
        if physical_identity["dcapPolicy"] != reference_physical.get("dcapPolicy"):
            raise Rejected("generated arm DCAP policy differs from the foundry arm")
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
    endpoint_timing, endpoint_clocks = parse_timing_report(
        chosen["endpoint_report"], 100000, 1, 10.0, chosen["endpoint_index"])
    period_ns = parse_sdc_period(chosen["postroute_sdc"])
    frozen_q_target = None
    if arm == "generated":
        frozen_q_target = (foundry_record.get("facts", {})
                           .get("v5_active_frontier", {}).get("q_target_ns"))
        if not isinstance(frozen_q_target, (int, float)):
            raise Rejected("foundry arm has no frozen V5 q target")
    frontier = build_active_frontier(
        endpoint_timing, period_ns, 0.05, 0.0, frozen_q_target)
    endpoint_timing["active_frontier"] = frontier
    timing_facts_path = ctx.run_dir / ("rpt_" + arm) / "timing-facts.json"
    clock_facts_path = ctx.run_dir / ("rpt_" + arm) / "clock-facts.json"
    frontier_path = ctx.run_dir / ("rpt_" + arm) / "active-frontier.json"
    atomic_json(timing_facts_path, endpoint_timing)
    atomic_json(clock_facts_path, endpoint_clocks)
    atomic_json(frontier_path, frontier)
    route_drc = ctx.run_dir / ("rpt_" + arm) / "route.drc.rpt"
    connectivity = ctx.run_dir / ("rpt_" + arm) / "connectivity.rpt"
    power_report = ctx.run_dir / ("rpt_" + arm) / "power.rpt"
    gatecount_report = ctx.run_dir / ("rpt_" + arm) / "gatecount.rpt"
    route_summary = ctx.run_dir / ("rpt_" + arm) / "summary.rpt"
    route_drc_count = parse_drc(route_drc, 100000)
    connectivity_count = parse_connectivity(connectivity)
    secondary = parse_secondary_pnr(power_report, gatecount_report, route_summary)
    for at, role in ((chosen["gds"], "postroute_gds"),
                     (chosen["pin_plan"], "fixed_pin_plan" if arm == "foundry" else "applied_pin_plan"),
                     (chosen["physical_facts"], "v5_physical_facts"),
                     (chosen["density_report"], "v5_density_map"),
                     (timing_summary, "postroute_timing_summary"),
                     (timing_paths, "postroute_timing_paths"),
                     (hold_summary, "postroute_hold_summary"),
                     (hold_paths, "postroute_hold_paths"),
                     (route_drc, "route_drc_report"),
                     (connectivity, "connectivity_report"),
                     (power_report, "postroute_power_report"),
                     (gatecount_report, "postroute_gatecount_report"),
                     (route_summary, "postroute_summary_report"),
                     (chosen["postroute_netlist"], "postroute_netlist"),
                     (chosen["postroute_sdc"], "postroute_sdc")):
        ctx.add_artifact(at, role, "innovus-output")
    for at, role in ((chosen["endpoint_index"], "v5_setup_endpoint_index"),
                     (chosen["endpoint_report"], "v5_endpoint_worst_setup_report"),
                     (timing_facts_path, "v5_timing_facts"),
                     (clock_facts_path, "v5_clock_facts"),
                     (frontier_path, "v5_active_frontier")):
        ctx.add_artifact(at, role, "innovus-endpoint-complete-evidence")
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
        "floorplanUtilization": float(ctx.facts["floorplan_requested_utilization"]),
        "floorplanEffectiveUtilization": float(utilization),
        "floorplanAreaExpansion": float(ctx.facts["floorplan_area_expansion"]),
        "floorplanCoreBox": core_box,
        "pinPlan": plan_identity,
        "placeSite": str(ctx.binding("PLACE_SITE")),
        "armSpecificExclusions": ["generated_db", "generated_liberty", "generated_lef"],
    })
    ctx.facts.update({"arm": arm, "design_top": str(ctx.binding("DESIGN_TOP")),
                      "pnr_completed": 1, "library_visible": visible,
                      "hold_wns_ns": hold["setupWnsNs"], "hold_violating_paths": hold["setupViolatingPaths"],
                      "route_drc_violations": route_drc_count, "connectivity_violations": connectivity_count,
                      **secondary, "congestion_overflow": None,
                      "congestion_unknown_reason": "current Innovus summary has no verified congestion-overflow metric",
                      "toolVersion": init_version,
                      "place_site": str(ctx.binding("PLACE_SITE")),
                      "floorplan_core_box": core_box,
                      "floorplan_core_area_um2": (core_box[2] - core_box[0]) * (core_box[3] - core_box[1]),
                      "pin_plan_identity": plan_identity,
                      "v5_physical_identity": physical_identity,
                      "v5_active_frontier": {
                          "endpoint_count": frontier["endpoint_count"],
                          "active_endpoint_count": frontier["active_endpoint_count"],
                          "q0_ns": frontier["q0_ns"],
                          "q_target_ns": frontier["q_target_ns"],
                          "required_gain_ns": frontier["required_gain_ns"],
                          "q_target_source": frontier["q_target_source"],
                      },
                      **clock_tree,
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
    clean = bool(re.search(
        r"(?:no connectivity violations|0\s+connectivity violations|Found no problems or warnings\.)",
        text, re.I))
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
            "timeDesign -postRoute -outDir {%s} -prefix final -numPaths 100 -expandReg2Reg -pathreports\nset_verify_drc_mode -check_only cell -limit %d\n"
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
    ctx.facts.update({"verification_error_count": 0,
                      "cell_checker_diagnostic_count": total,
                      "cell_checker_diagnostics_by_arm": per_arm,
                      "final_database": final_db,
                      "verification_method": "restored final database timing and instance census; Innovus cell-only counts are diagnostic because the foundry-only arm also flags abstract-library geometry"})


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
    # Innovus 23.14 emits both `= Slack Time` and `Slack Time` across designs while
    # preserving the same Path 1/report contract. Accept that optional marker only;
    # the summary WNS equality below remains the independent numeric gate.
    path_one = re.search(r"^Path 1:.*?^=?\s*Slack Time\s+([0-9.eE+-]+)\s*$", path_text, re.M | re.S)
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
    facts = record.get("facts", {})
    clock = facts.get("clock_ns")
    dc_uncertainty = facts.get("dc_uncertainty_ns")
    route_uncertainty = facts.get("route_uncertainty_ns")
    if (not all(isinstance(value, (int, float)) and math.isfinite(value)
                for value in (clock, dc_uncertainty, route_uncertainty))
            or not math.isclose(dc_uncertainty, clock * 0.50, abs_tol=1e-12)
            or not math.isclose(route_uncertainty, clock * 0.25 + 0.050, abs_tol=1e-12)):
        raise Rejected("synthesis record lacks the fixed 50% DC / 25%+50ps APR pressure identity")
    return {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "synthesis",
        "commonInputs": held_identities(record.get("inputs", []),
            exact=("FOUNDRY_DB", "shared_synth_template", "shared_synth_constraints", "EDA_WRAPPER"),
            prefixes=("rtl:",)),
        "entryContractSha256": sha_bytes(normalized_synth_entry(entry.read_text()).encode()),
        "tool": dc_version(log.read_text(errors="replace")),
        "clockNs": clock,
        "dcUncertaintyNs": dc_uncertainty,
        "routeUncertaintyNs": route_uncertainty,
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
    facts = record.get("facts", {})
    utilization = facts.get("floorplan_utilization")
    requested_utilization = facts.get("floorplan_requested_utilization")
    area_expansion = facts.get("floorplan_area_expansion")
    core_box = facts.get("floorplan_core_box")
    pin_plan = facts.get("pin_plan_identity")
    if (not isinstance(requested_utilization, (int, float)) or not 0.2 <= float(requested_utilization) <= 0.8
            or not isinstance(area_expansion, (int, float)) or float(area_expansion) < 1.0
            or not isinstance(utilization, (int, float)) or not 0.0 < float(utilization) <= float(requested_utilization)
            or not math.isclose(float(utilization), float(requested_utilization) / float(area_expansion), rel_tol=0, abs_tol=1e-6)
            or not isinstance(core_box, list) or len(core_box) != 4
            or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in core_box)
            or core_box[2] <= core_box[0] or core_box[3] <= core_box[1]
            or not isinstance(pin_plan, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(pin_plan.get("sha256") or ""))
            or not isinstance(pin_plan.get("pinCount"), int) or pin_plan["pinCount"] <= 0):
        raise Rejected("PnR record lacks one frozen floorplan and pin-plan identity")
    init_text = scripts["init"].read_text(errors="replace")
    place_site = facts.get("place_site")
    place_sites = re.findall(r"(?m)^\s*floorPlan\s+-site\s+(\S+)", init_text)
    loaded_floorplans = re.findall(r"(?m)^\s*loadFPlan\s+\{([^}]+)\}", init_text)
    if (not isinstance(place_site, str) or not place_site
            or (arm == "foundry" and place_sites != [place_site])
            or (arm == "generated" and (place_sites or len(loaded_floorplans) != 1))):
        raise Rejected("PnR init script/facts lack one arm-appropriate place Site and floorplan source")
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
        "floorplanUtilization": float(requested_utilization),
        "floorplanEffectiveUtilization": float(utilization),
        "floorplanAreaExpansion": float(area_expansion),
        "floorplanCoreBox": core_box,
        "pinPlan": pin_plan,
        "placeSite": place_site,
        "armSpecificExclusions": ["generated_db", "generated_liberty", "generated_lef"],
    }


def validate_condition_artifact(record, workspace, derived):
    published = read_json(artifact(record, workspace, "common_condition_identity"))
    if published != derived:
        raise Rejected("published common-condition identity disagrees with held inputs/scripts/logs")
    return derived


def compare_v5_frontiers(reference_timing, generated_timing, reference_frontier,
                         generated_frontier):
    """Build the compact commercial response that drives the next research generation."""
    for name, timing in (("reference", reference_timing), ("generated", generated_timing)):
        if (timing.get("schema") != "hima.innovus-timing-facts/1"
                or timing.get("completeness") != "complete"):
            raise Rejected("%s V5 timing facts are not endpoint-complete" % name)
    q_target = reference_frontier.get("q_target_ns")
    if (not isinstance(q_target, (int, float))
            or generated_frontier.get("q_target_ns") != q_target
            or generated_frontier.get("q_target_source") != "frozen-baseline-target"):
        raise Rejected("generated V5 frontier does not use the frozen reference q target")
    def endpoint_rows(document):
        return {row["endpoint"]: float(row["worst_slack_ns"])
                for row in document.get("endpoint_alternatives", [])}
    left, right = endpoint_rows(reference_timing), endpoint_rows(generated_timing)
    if not left or set(left) != set(right):
        raise Rejected("V5 endpoint identities differ between comparison arms")
    period = float(reference_frontier["period_ns"])
    rows = [{"endpoint": endpoint, "reference_slack_ns": left[endpoint],
             "generated_slack_ns": right[endpoint],
             "delta_slack_ns": right[endpoint] - left[endpoint],
             "reference_q_ns": period - left[endpoint],
             "generated_q_ns": period - right[endpoint]}
            for endpoint in sorted(left)]
    reference_active = {row["endpoint"] for row in rows
                        if row["reference_q_ns"] >= q_target - 1e-15}
    generated_active = {row["endpoint"] for row in rows
                        if row["generated_q_ns"] >= q_target - 1e-15}
    remaining = sorted((row for row in rows if row["endpoint"] in generated_active),
                       key=lambda row: (-row["generated_q_ns"], row["endpoint"]))
    response = {
        "schema": "hima.lfr-v5-commercial-frontier-response/1", "status": "observed",
        "endpoint_count": len(rows), "period_ns": period,
        "q_target_ns": float(q_target),
        "reference_active_count": len(reference_active),
        "generated_active_count": len(generated_active),
        "resolved_reference_endpoints": sorted(reference_active - generated_active),
        "new_frontier_entrants": sorted(generated_active - reference_active),
        "remaining_frontier": remaining,
        "improved_endpoint_count": sum(row["delta_slack_ns"] > 1e-12 for row in rows),
        "worsened_endpoint_count": sum(row["delta_slack_ns"] < -1e-12 for row in rows),
        "unchanged_endpoint_count": sum(abs(row["delta_slack_ns"]) <= 1e-12 for row in rows),
        "violations_fixed": sum(left[row["endpoint"]] < 0 <= right[row["endpoint"]] for row in rows),
        "new_violations": sum(right[row["endpoint"]] < 0 <= left[row["endpoint"]] for row in rows),
        "largest_frontier_regressions": sorted(
            (row for row in rows if row["endpoint"] in generated_active),
            key=lambda row: (row["delta_slack_ns"], row["endpoint"]))[:32],
        "largest_frontier_improvements": sorted(
            (row for row in rows if row["endpoint"] in reference_active),
            key=lambda row: (-row["delta_slack_ns"], row["endpoint"]))[:32],
        "next_residual_question": (
            "Find non-conflicting single-output, multi-output, drive-family, transistor-tuning or "
            "physical-fusion actions that jointly reduce every remaining frozen-frontier alternative; "
            "explain each proposal from complete endpoint influence and preserve prior non-frontier PPA gains."),
        "claim_limits": {"per_action_causality": False, "commercial_qor_prediction": False,
                         "single_pair_no_statistics": True},
    }
    response["response_sha256"] = canonical_json_sha(response)
    return response


def publish_commercial_response(ctx, comparison, observations, frontier_response, unknown_reasons):
    """Publish one current pointer after retaining this compare's immutable evidence."""
    commercial_root = ctx.flow / "library-richness"
    marker_path = commercial_root / "commercial-response-current.json"
    manifest_sha = None
    manifest_reason = None
    named_manifest = ctx.inputs_doc.get("LFR_CUMULATIVE_LIBRARY_MANIFEST")
    if named_manifest in (None, ""):
        manifest_reason = "no validated cumulative Library manifest was bound to this comparison"
    else:
        declared = Path(str(named_manifest))
        expected = ctx.flow / "library" / "cumulative-manifest.json"
        if not declared.is_absolute() or declared.is_symlink() or declared.resolve() != expected.resolve():
            manifest_reason = "the cumulative Library manifest binding is not the Pack-owned file"
        elif not declared.is_file():
            manifest_reason = "the bound cumulative Library manifest is unavailable"
        else:
            try:
                validate_cumulative_manifest(read_json(declared))
                manifest_sha = sha_file(declared)
            except (Rejected, OSError, ValueError, TypeError) as error:
                manifest_reason = "the bound cumulative Library manifest is invalid: %s" % error
    if frontier_response is not None:
        response_path = ctx.run_dir / "frontier-response.json"
        atomic_json(response_path, frontier_response)
        ctx.add_artifact(response_path, "v5_frontier_response",
                         "derived-from-endpoint-complete-commercial-evidence")
        if observations.get("matched_conditions") is True and manifest_sha is not None:
            persistent = commercial_root / "commercial-response.json"
            atomic_json(persistent, frontier_response)
            atomic_json(marker_path, {
                "schema": "lfr-current-commercial-response/1", "status": "available",
                "compareRunDir": str(ctx.run_dir.relative_to(ctx.flow)),
                "inputsSha256": sha_file(ctx.flow / "inputs.json"),
                "manifestSha256": manifest_sha,
                "comparisonSha256": sha_file(comparison), "responseSha256": sha_file(persistent),
                "responsePayloadSha256": frontier_response["response_sha256"],
                "analysisViews": observations["analysisViews"],
            })
    if frontier_response is None or observations.get("matched_conditions") is not True or manifest_sha is None:
        atomic_json(marker_path, {
            "schema": "lfr-current-commercial-response/1", "status": "unavailable",
            "compareRunDir": str(ctx.run_dir.relative_to(ctx.flow)),
            "comparisonSha256": sha_file(comparison),
            "reason": [*unknown_reasons, *([manifest_reason] if manifest_reason else [])]
                      or ["commercial comparison conditions did not match"],
        })


def stage_compare(ctx):
    atomic_json(ctx.flow / "library-richness" / "commercial-response-current.json", {
        "schema": "lfr-current-commercial-response/1", "status": "unavailable",
        "compareRunDir": str(ctx.run_dir.relative_to(ctx.flow)),
        "reason": ["a new comparison is in progress"],
    })
    unknown_reasons = []
    observations = {}
    frontier_response = None
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

        cell_checker_diagnostics = 0
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
            cell_checker_diagnostics += parse_drc(report, int(limits[0]))
        verification_errors = verify.get("facts", {}).get("verification_error_count")
        if verification_errors != 0:
            raise Rejected("final database identity/timing verification did not complete cleanly")

        generated_wns = right["timing"]["setupWnsNs"]
        foundry_wns = left["timing"]["setupWnsNs"]
        matched = synth_method_matched and pnr_method_matched
        library_visible = pnr_visible is not None and pnr_visible > 0 and verify_visible is not None and verify_visible > 0
        comparison_valid = matched and library_visible and final_adopted > 0 and verification_errors == 0
        setup_open = generated_wns < 0 or right["timing"]["setupViolatingPaths"] > 0
        foundry_closed_period = requested_clock - foundry_wns
        generated_closed_period = requested_clock - generated_wns
        if foundry_closed_period <= 0 or generated_closed_period <= 0:
            raise Rejected("post-route slack implies a nonpositive closed period")
        foundry_fmax_mhz = 1000.0 / foundry_closed_period
        generated_fmax_mhz = 1000.0 / generated_closed_period
        fmax_delta_mhz = generated_fmax_mhz - foundry_fmax_mhz
        fmax_improvement_pct = fmax_delta_mhz / foundry_fmax_mhz * 100.0
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
            "cell_checker_diagnostic_count": cell_checker_diagnostics,
            "comparison_valid": comparison_valid,
            "foundry_fmax_mhz": foundry_fmax_mhz,
            "generated_fmax_mhz": generated_fmax_mhz,
            "fmax_delta_mhz": fmax_delta_mhz,
            "fmax_improvement_pct": fmax_improvement_pct,
            "fmax_improved": fmax_improved,
            "full_constraint_failures": failures,
            "unknownReason": None,
            "analysisViews": {arm: pnr_rows[arm]["timing"]["analysisView"] for arm in pnr_rows},
            "measurementScope": "same requested period; setup slack and custom-instance census are re-read after restoring each final route database",
        })
        reference_timing_path = artifact(foundry_pnr, ctx.workspace, "v5_timing_facts")
        generated_timing_path = artifact(generated_pnr, ctx.workspace, "v5_timing_facts")
        reference_frontier_path = artifact(foundry_pnr, ctx.workspace, "v5_active_frontier")
        generated_frontier_path = artifact(generated_pnr, ctx.workspace, "v5_active_frontier")
        frontier_response = compare_v5_frontiers(
            read_json(reference_timing_path), read_json(generated_timing_path),
            read_json(reference_frontier_path), read_json(generated_frontier_path))
        ctx.inputs.extend([
            file_ref(reference_timing_path, ctx.workspace, "foundry_v5_timing_facts", "innovus-endpoint-complete-evidence"),
            file_ref(generated_timing_path, ctx.workspace, "generated_v5_timing_facts", "innovus-endpoint-complete-evidence"),
            file_ref(reference_frontier_path, ctx.workspace, "foundry_v5_active_frontier", "derived-frontier"),
            file_ref(generated_frontier_path, ctx.workspace, "generated_v5_active_frontier", "derived-frontier"),
        ])
        observations.update({
            "v5_frontier_reference_count": frontier_response["reference_active_count"],
            "v5_frontier_generated_count": frontier_response["generated_active_count"],
            "v5_frontier_resolved_count": len(frontier_response["resolved_reference_endpoints"]),
            "v5_frontier_entrant_count": len(frontier_response["new_frontier_entrants"]),
            "v5_frontier_remaining_count": len(frontier_response["remaining_frontier"]),
            "v5_frontier_response_sha256": frontier_response["response_sha256"],
        })
    except (Rejected, ValueError, KeyError, IndexError, TypeError) as exc:
        unknown_reasons.append(str(exc))
        observations.update({"clock_period": None, "setup_wns": None, "foundry_setup_wns": None,
                             "setup_wns_delta": None, "matched_conditions": None,
                             "library_visible": None, "adopted_instance_count": None,
                             "foundry_fmax_mhz": None, "generated_fmax_mhz": None,
                             "fmax_delta_mhz": None, "fmax_improvement_pct": None, "fmax_improved": None,
                             "verification_error_count": None, "cell_checker_diagnostic_count": None,
                             "comparison_valid": None, "full_constraint_failures": None,
                             "unknownReason": unknown_reasons,
                             "measurementScope": "post-route comparison unavailable; synthesis timing is not substituted"})
    comparison = ctx.run_dir / "comparison.json"
    atomic_json(comparison, observations)
    ctx.add_artifact(comparison, "comparison", "derived-from-held-postroute-evidence")
    publish_commercial_response(ctx, comparison, observations, frontier_response, unknown_reasons)
    ctx.facts.update(observations)


def dispatch(ctx, stage, route):
    if stage == "evaluate-library-richness":
        if route == "baseline":
            stage_evaluation_baseline(ctx)
        elif route == "function-local":
            stage_function_local(ctx)
        elif route == "design-mapping-timing":
            stage_design_mapping_timing(ctx)
        else:
            raise Rejected("evaluation phase must be baseline, function-local or design-mapping-timing")
    elif stage == "freeze-cumulative-library":
        stage_freeze_cumulative_library(ctx)
    elif stage == "mine":
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
        stage_synth(ctx, False, route)
    elif stage == "custom-synth":
        stage_synth(ctx, True, route)
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
    else:
        raise Rejected("stage must be one of: " + ",".join(STAGES))


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) not in (2, 3):
        print("usage: stages.py STAGE WORKSPACE [evaluation phase, mine route, period or utilization]", file=sys.stderr)
        return 2
    stage, workspace = args[:2]
    route = args[2] if len(args) == 3 else None
    evaluation_records = {
        "baseline": "evaluation-baseline",
        "function-local": "function-local-evaluation",
        "design-mapping-timing": "design-mapping-timing-evaluation",
    }
    record_stage = (("mine-" + route) if stage == "mine" and route else
                    evaluation_records.get(route, "evaluate-library-richness-invalid") if stage == "evaluate-library-richness" else stage)
    ctx = None
    try:
        if stage not in ("evaluate-library-richness", "mine", "foundry-synth", "custom-synth",
                         "pnr-foundry", "pnr-generated") and route is not None:
            raise Rejected("third argument is accepted only for evaluation phase, mine, synthesis period or P&R utilization")
        if stage == "mine" and route is None:
            raise Rejected("mine requires ROUTE")
        if stage == "evaluate-library-richness" and route is None:
            raise Rejected("evaluate-library-richness requires EVALUATION_PHASE")
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
