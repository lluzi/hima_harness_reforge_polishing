#!/usr/bin/env python3
"""T12: the `atcs_cli.py <subcommand> <workspace> [args]` subcommand dispatcher.

This is the glue between the Harness graph (T14) and the M1-M8/M11 modules
under `flow/atcs/`: every subcommand reads its declared inputs from plain
JSON files under the Campaign `<workspace>`, calls exactly the module
functions named below, and writes **exactly one** declared output
(`core.write_artifact`, atomic). A subcommand that also launches EDA
compiles its task through `flow/atcs/adapters.py` and runs it via a
Site-supplied wrapper (`site_profile["edaShell"]`, read from a caller-given
JSON file -- never a hard-coded path); see `adapters.py`'s own module
docstring for that convention.

Exit codes (Phase B contract; no output file is written on any non-zero exit)
-------------------------------------------------------------------------------

- ``0`` -- success; the one declared output was written atomically.
- ``2`` -- a declared input file is missing, unreadable or malformed (wrong
  JSON, or the wrong `schema`/`id` for an artifact-shaped input). A plain
  ``{"code","detail"}`` JSON object on stderr.
- ``3`` -- an `atcs.core.AtcsError` refusal raised by a module function
  given otherwise well-formed inputs. ``{"code","detail"}`` JSON on stderr
  (`code` is the module's own kebab-case refusal code).
- ``4`` -- the launched EDA tool itself failed (nonzero exit, or an
  ``ERROR``/``Fatal`` line in its captured log). ``{"code":"tool-failed",
  "detail","log"}`` JSON on stderr, naming the captured log path.

Workspace layout (architecture Sec.13.4; binding, do not rename)
--------------------------------------------------------------------

``state/`` holds readiness, design states, observations, `pointers.json`
and `experience.json`; ``research/<dir>/`` holds raw PT evidence this Pack
generates (Workshop-authored plans/resolutions also live under
``research/``, supplied externally, not written by this module);
``workspaces/<task>/r<rev>/`` holds each worker's private write root
(``atcs.workspaces.prepare``'s own files); ``contributions/<id>.json``,
``integrations/<batchId>/`` and ``implementations/<mergeId>/`` are
content-addressed, Pack-internal stores this dispatcher reads/writes across
its own subcommand invocations; ``accepted/`` and ``apr/<stage>/<id>/`` hold
M7/M11 output. Because a Harness `outputs[]` entry must be one **fixed,
literal** path (`.superpowers/sdd/pack-mechanics.md` Sec.1.2 -- no
per-run/per-id templating), every subcommand's *declared* output (the one
Reader-facing file T14 lists in `contract.yml`) is instead a small, fixed
"latest" mirror under `state/`/`apr/<stage>/`; this dispatcher also writes
the full canonical, content-addressed artifact into the architecture's own
dynamic-path store when one is named above, purely for cross-subcommand and
provenance lookups -- that canonical copy is never itself "the declared
output" a Reader watches. This Pack processes one integration batch and one
implementation candidate at a time (single-writer, Sec. Global Constraints:
"Bounded worker slots... one Campaign Run keeps one owner"), so
`integrations/current/` and `implementations/current/` are reused across a
Run rather than a fresh `<batchId>`/`<mergeId>` directory appearing in every
declared path.

Subcommand table (path column is workspace-relative; "in" lists positional
args after `<workspace>`, in order; a name in *italics-by-convention*
`snake_case` names a fixed internal path this dispatcher reads by
convention, not a positional arg)
-------------------------------------------------------------------------------------------------------------

| # | Subcommand | Extra args | Calls | Declared output |
|---|---|---|---|---|
| 1 | `bind-inputs` | manifest, siteCapabilities | `state.input_readiness` | `state/readiness.json` |
| 2 | `baseline` | manifest | `state.design_state` | `state/baseline.json` |
| 3 | `observe` | sourceRefs, querySpec, siteProfile, scenarioInputs | `adapters.compile_pt_scenario_tasks` + `run_tool` (x4) then `state.capture` | `state/observation.json` |
| 4 | `risk` | priorObservation, currentObservation, recheck | `state.compare_checks` | `state/risk.json` |
| 5 | `prepare-workers` | baseState, siteCapabilities, edaProfile, wp01, wp02, wp03 | `workspaces.validate_work_package` + `workspaces.prepare` (x3) + `adapters.compile_xtop_operator_task`/`compile_xtop_analysis_manual_task` (x3, materialized into each worker's own root) | `state/workers.json` |
| 6 | `capture-contribution` | slot, baseRef, resultRefs, opsLog | `contributions.seal` | `state/contribution-<slot>.json` (one of 3 literal names) |
| 7 | `collect` | (none) | reads whichever `contribution-w0N.json` exist (`contribution-index` read envelope: `{"contributions","pending"}`) | `state/contributions-collected.json` |
| 8 | `compose-facts` | baseStateId, resolutions | `composition.analyze` | `state/composition-facts.json` |
| 9 | `replay-prepare` | baseState, plan, siteProfile | `integration.validate_plan` + `integration.prepare_replay` then `adapters.compile_xtop_replay_task` + `run_tool` (best-effort) | `state/replay-request.json` |
| 10 | `reconcile` | wp01, wp02, wp03 | `integration.reconcile` | `state/integration-state.json` |
| 11 | `presta` | baseState, scenarioCorners, siteProfile | `integration.seal_batch` (read-only re-derivation, for `newNets`) + `adapters.compile_pt_presta_task` + `run_tool`, `verification.precheck_evidence` | `state/presta.json` (the stamped `precheckEvidence` artifact) |
| 12 | `implement` | currentDesignState, siteProfile | `integration.seal_batch` then `adapters.compile_innovus_eco_task` + `run_tool` | `state/implement.json` |
| 13 | `extract` | corners, siteProfile | `adapters.compile_starrc_task` + `run_tool` (per corner) | `state/extract.json` |
| 14 | `sta` | querySpec, sdc, scenarioCorners, baseDesignState, siteProfile | `adapters.compile_pt_scenario_task` + `run_tool` (per scenario), `state.design_state`, `state.capture`, `refresh.record_refresh` (once, on completion) | `state/sta.json` (also appends `state/refresh-ledger.json`) |
| 15 | `physical` | drcReport, connectivityReport, mode(`baseline`\|`candidate`) | (I/O packaging only) | `state/baseline-physical.json` or `state/physical.json` |
| 16 | `evaluate` | policy | `verification.plan_checks` + `verification.assemble` | `state/evaluation.json` |
| 17 | `adopt` | expectedBaseId, policy | `adoption.publish` | `accepted/latest.json` (envelope: `{"acceptanceRecord","refreshLedger"}` paths) |
| 18 | `residual` | (none) | `residual.extract` | `state/residual-cases.json` |
| 19 | `apr-prepare` | stage(`place`\|`cts`\|`route`\|`postroute`) | `lifecycle.compile_intervention` + `lifecycle.stage_task` | `apr/<stage>/task.json` (4 literal paths) |
| 20 | `record-experience` | lineage, decision, outcome | `experience.record` | `state/experience.json` |

Gaps (reported per this task's brief; see also `adapters.py`'s own "Gaps")
-------------------------------------------------------------------------------

- `residual` does not itself launch `pt-query.tcl` to populate
  `observation["checkDetails"]` before calling `residual.extract` --
  `adapters.compile_pt_query_task`/`parse_path_detail` are ready building
  blocks for a follow-up task to wire in, but grouping "which scenario
  each remaining check's targeted query belongs to" needs a per-scenario
  input map this dispatcher does not yet receive. `residual.extract`
  itself is fail-closed for missing evidence (unknown, never fabricated),
  so this subcommand still returns honest, evidence-scoped residual cases.
- `presta` runs its cheap pre-check against the **base** state's own
  netlist/SPEF (not an intermediate, ECO-applied-but-not-yet-extracted
  netlist XTop would hold only inside a live session) -- this is the
  correctly-scoped, honest reading of `knowledge/cheap-verification.md`
  for this Pack's current artifact set: it demonstrates that a candidate's
  new nets are `unqualified` against RC modeling that predates them
  (`verification.presta_qualification`'s whole point), rather than
  fabricating a more precise predicted value this Pack cannot yet obtain
  without a full StarRC extraction.

`atcs.refresh` / `verification.precheck_evidence` wiring (Task 13 fix round)
--------------------------------------------------------------------------------

- `_cmd_sta` calls `refresh.record_refresh(state/refresh-ledger.json,
  mergeCommitId, designStateId, sta_sources)` exactly once, after the
  per-scenario STA loop and the new design-state are both built.
  `sta_sources` is `{scenario: {"path","sha256"}}` for every
  `verification.REQUIRED_SCENARIOS` entry -- the SPEF ref that scenario's
  STA actually read, matching `record_refresh`'s own validated shape
  (`atcs/refresh.py`'s module docstring: "must name a `{path, sha256}`
  reference for every scenario").
- `_cmd_presta` calls `integration.seal_batch` itself (read-only,
  side-effect-free re-derivation over the already-reconciled
  `integration-state`) purely to obtain `merge_commit["newNets"]` before
  `implement` has sealed one for real; writes the base SPEF's net names to
  `integrations/current/presta/spef-net-names.txt`, **one name per line**
  (matching `tools/read-atcs.py`'s `precheck-evidence` reader, which parses
  that source as plain text, never JSON), and calls
  `verification.precheck_evidence(merge_commit, spef_net_names_path)` for
  the declared output directly -- `precheck_evidence` never parses or
  embeds that source's content itself, only hashes it, so the Reader can
  independently re-parse and re-hash it.
- `_cmd_adopt`'s declared output is `{"acceptanceRecord","refreshLedger"}`,
  both workspace-relative paths (never embedded content), matching
  `tools/read-atcs.py`'s updated `acceptance-record` reader.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_FLOW_DIR = Path(__file__).resolve().parent
if str(_FLOW_DIR) not in sys.path:
    sys.path.insert(0, str(_FLOW_DIR))

from atcs import core  # noqa: E402
from atcs import state  # noqa: E402
from atcs import workspaces  # noqa: E402
from atcs import contributions  # noqa: E402
from atcs import composition  # noqa: E402
from atcs import integration  # noqa: E402
from atcs import verification  # noqa: E402
from atcs import adoption  # noqa: E402
from atcs import experience  # noqa: E402
from atcs import residual as residual_module  # noqa: E402
from atcs import lifecycle  # noqa: E402
from atcs import adapters  # noqa: E402


APR_STAGES = ("place", "cts", "route", "postroute")


class InputError(Exception):
    """A declared input file is missing, unreadable or malformed (exit code 2)."""

    def __init__(self, code, detail):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------------------
# Declared-input readers (exit code 2 on any failure)
# ---------------------------------------------------------------------------


def _read_plain(path):
    """Read one plain (non artifact-stamped) JSON input file."""
    target = Path(path)
    if not target.is_file():
        raise InputError("missing-input", f"declared input not found: {target}")
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError("invalid-input", f"cannot parse {target}: {exc}") from exc


def _read_json_or_default(path, default):
    """Like `_read_plain`, but a missing file is not an error (returns `default`)."""
    target = Path(path)
    if not target.is_file():
        return default
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError("invalid-input", f"cannot parse {target}: {exc}") from exc


def _read_declared(path, kind):
    """Read one `core.stamp`-ed artifact input, enforcing its `schema`/`id`."""
    obj = _read_plain(path)
    expected_schema = f"atcs.{kind}/1"
    if obj.get("schema") != expected_schema:
        raise InputError("invalid-input", f"expected schema {expected_schema} at {path}, got {obj.get('schema')!r}")
    stored_id = obj.get("id")
    body = dict(obj)
    body.pop("id", None)
    if stored_id != core.digest(body):
        raise InputError("invalid-input", f"identity mismatch at {path}")
    return obj


def _read_text(path):
    target = Path(path)
    if not target.is_file():
        raise InputError("missing-input", f"declared input not found: {target}")
    try:
        return target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise InputError("invalid-input", f"cannot read {target}: {exc}") from exc


def _relpath(path, workspace):
    return os.path.relpath(str(path), start=str(workspace))


def _canonical_write(path, obj):
    """Write a side (non-declared) artifact/record file -- best-effort provenance only."""
    core.write_artifact(path, obj)


# ---------------------------------------------------------------------------
# Fixed workspace paths (see module docstring's table)
# ---------------------------------------------------------------------------


def _paths(workspace):
    workspace = Path(workspace)
    state_dir = workspace / "state"
    return {
        "readiness": state_dir / "readiness.json",
        "baseline": state_dir / "baseline.json",
        "pointers": state_dir / "pointers.json",
        "observation": state_dir / "observation.json",
        "risk": state_dir / "risk.json",
        "experience": state_dir / "experience.json",
        "workers": state_dir / "workers.json",
        "contributions_collected": state_dir / "contributions-collected.json",
        "composition_facts": state_dir / "composition-facts.json",
        "replay_request": state_dir / "replay-request.json",
        "replay_receipts": state_dir / "replay-receipts.json",
        "integration_state": state_dir / "integration-state.json",
        "presta": state_dir / "presta.json",
        "merge_commit": state_dir / "merge-commit.json",
        "implement": state_dir / "implement.json",
        "extract": state_dir / "extract.json",
        "sta": state_dir / "sta.json",
        "physical": state_dir / "physical.json",
        "baseline_physical": state_dir / "baseline-physical.json",
        "evaluation": state_dir / "evaluation.json",
        "residual_cases": state_dir / "residual-cases.json",
        "refresh_ledger": state_dir / "refresh-ledger.json",
        "accepted": workspace / "accepted" / "latest.json",
    }


def _contribution_path(workspace, slot):
    return Path(workspace) / "state" / f"contribution-{slot}.json"


def _apr_task_path(workspace, stage):
    return Path(workspace) / "apr" / stage / "task.json"


# ---------------------------------------------------------------------------
# Subcommand handlers -- each returns (output_path, body_to_write)
# ---------------------------------------------------------------------------


def _cmd_bind_inputs(workspace, args):
    manifest_path, site_caps_path = args
    manifest = _read_plain(manifest_path)
    site_capabilities = _read_plain(site_caps_path)
    body = state.input_readiness(manifest, site_capabilities)
    return _paths(workspace)["readiness"], body


def _cmd_baseline(workspace, args):
    (manifest_path,) = args
    manifest = _read_plain(manifest_path)
    body = state.design_state(manifest)
    return _paths(workspace)["baseline"], body


def _cmd_observe(workspace, args):
    source_refs_path, query_spec_path, site_profile_path, scenario_inputs_path = args
    source_refs = _read_plain(source_refs_path)
    query_spec = _read_plain(query_spec_path)
    site_profile = _read_plain(site_profile_path)
    scenario_inputs = _read_plain(scenario_inputs_path)

    report_root = Path(workspace) / "research" / "observe"
    tasks = adapters.compile_pt_scenario_tasks(query_spec, scenario_inputs, str(report_root))
    for scenario, task in tasks.items():
        scenario_dir = report_root / scenario
        tcl_path = scenario_dir / "pt-scenario.tcl"
        tcl_path.parent.mkdir(parents=True, exist_ok=True)
        tcl_path.write_text(task["tcl"], encoding="utf-8")
        log_path = scenario_dir / "pt.log"
        adapters.run_tool(site_profile, task["command"] + [str(tcl_path)], cwd=scenario_dir, log_path=log_path)
        for name, report_path in task["reports"].items():
            if not Path(report_path).is_file():
                raise adapters.AdapterToolError(f"expected PT report missing: {report_path}", log_path)

    body = state.capture(source_refs, query_spec)
    return _paths(workspace)["observation"], body


def _cmd_risk(workspace, args):
    prior_path, current_path, recheck_path = args
    prior = _read_declared(prior_path, "observation-set")
    current = _read_declared(current_path, "observation-set")
    recheck = _read_plain(recheck_path)
    body = state.compare_checks(prior, current, recheck)
    return _paths(workspace)["risk"], body


def _cmd_prepare_workers(workspace, args):
    base_state_path, site_caps_path, eda_profile_path, wp01_path, wp02_path, wp03_path = args
    base_state = _read_declared(base_state_path, "design-state")
    site_capabilities = _read_plain(site_caps_path)
    eda_profile = _read_plain(eda_profile_path)
    for key in ("design", "techLef", "cellLefGlob"):
        if not eda_profile.get(key):
            raise InputError("invalid-input", f"eda profile is missing {key!r}")

    workspace = Path(workspace)
    netlist_path = workspace / base_state["netlist"]["path"]
    def_path = None
    if base_state.get("def"):
        def_path = workspace / base_state["def"]["path"]

    index = {}
    for slot, wp_path in zip(workspaces.TASK_IDS, (wp01_path, wp02_path, wp03_path)):
        raw = _read_plain(wp_path)
        validated = workspaces.validate_work_package(raw, base_state, site_capabilities)
        manifest = workspaces.prepare(validated, str(workspace), base_state)

        session_dir = Path(manifest["root"])
        ops_log_path = session_dir / "ops.jsonl"
        operator_task = adapters.compile_xtop_operator_task(
            manifest, eda_profile["design"], eda_profile["techLef"], eda_profile["cellLefGlob"],
            str(netlist_path), str(def_path) if def_path else "", str(session_dir),
        )
        operator_tcl_path = Path(operator_task["tclPath"])
        operator_tcl_path.parent.mkdir(parents=True, exist_ok=True)
        operator_tcl_path.write_text(operator_task["tcl"], encoding="utf-8")

        analysis_task = adapters.compile_xtop_analysis_manual_task(
            manifest, validated.get("editDomain", {}), operator_tcl_path, ops_log_path,
        )
        analysis_tcl_path = session_dir / "xtop-analysis-manual.tcl"
        analysis_tcl_path.write_text(analysis_task["tcl"], encoding="utf-8")

        index[slot] = {
            "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
            "namePrefix": manifest["namePrefix"], "sessionTcl": str(analysis_tcl_path), "opsLog": str(ops_log_path),
        }
    return _paths(workspace)["workers"], {"workers": index}


def _cmd_capture_contribution(workspace, args):
    slot, base_ref_path, result_refs_path, ops_log_path = args
    if slot not in workspaces.TASK_IDS:
        raise InputError("invalid-input", f"slot must be one of {workspaces.TASK_IDS}, got {slot!r}")
    base_ref = _read_plain(base_ref_path)
    result_refs = _read_plain(result_refs_path)
    operation_trace = _read_text(ops_log_path)
    body = contributions.seal(base_ref, result_refs, operation_trace)
    _canonical_write(Path(workspace) / "contributions" / f"{body['id']}.json", body)
    return _contribution_path(workspace, slot), body


def _cmd_collect(workspace, args):
    """Aggregate whichever worker slots have sealed a contribution so far.

    Output matches `tools/read-atcs.py`'s `contribution-index` read envelope
    exactly: ``{"contributions": [<full contribution artifact>, ...],
    "pending": [<slot>, ...]}``. A slot with no `state/contribution-<slot>.json`
    yet is not a missing-input refusal here -- it is meaningful data (that
    worker's research is still in progress), reported in `pending` for
    `tc_pending_research_count` rather than blocking `collect` outright.
    """
    del args
    collected = []
    pending = []
    for slot in workspaces.TASK_IDS:
        path = _contribution_path(workspace, slot)
        if path.is_file():
            collected.append(_read_declared(path, "contribution"))
        else:
            pending.append(slot)
    return _paths(workspace)["contributions_collected"], {"contributions": collected, "pending": pending}


def _cmd_compose_facts(workspace, args):
    base_state_id, resolutions_path = args
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    resolutions = _read_plain(resolutions_path).get("resolutions", [])
    body = composition.analyze(base_state_id, collected["contributions"], resolutions)
    return _paths(workspace)["composition_facts"], body


def _cmd_replay_prepare(workspace, args):
    base_state_path, plan_path, site_profile_path = args
    workspace = Path(workspace)
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    plan_raw = _read_plain(plan_path)
    site_profile = _read_plain(site_profile_path)
    base_state = _read_declared(base_state_path, "design-state")
    if base_state["id"] != facts.get("baseStateId"):
        raise core.AtcsError("stale-base", "base design-state does not match facts.baseStateId")

    validated_plan = integration.validate_plan(plan_raw, facts)
    request = integration.prepare_replay(validated_plan, facts, collected["contributions"])

    output_root = workspace / "integrations" / "current"
    current_db = workspace / base_state["database"]["path"]
    task = adapters.compile_xtop_replay_task(str(current_db), base_state["top"], request.get("steps", []), output_root)
    Path(task["stepsPath"]).parent.mkdir(parents=True, exist_ok=True)
    Path(task["stepsPath"]).write_text(task["stepsText"], encoding="utf-8")
    main_tcl_path = output_root / "xtop-replay.tcl"
    main_tcl_path.write_text(task["tcl"], encoding="utf-8")
    log_path = output_root / "xtop-replay.log"
    try:
        adapters.run_tool(site_profile, ["xtop", "-f", str(main_tcl_path)], cwd=output_root, log_path=log_path)
    except adapters.AdapterToolError:
        # A step failure stops the batch (architecture Sec.8.4): later steps
        # simply stay receipt-less (pending) -- `reconcile` reports that, it
        # is not a `replay-prepare` refusal in its own right.
        pass
    receipts = adapters.read_replay_receipts(task["receiptsLog"])
    _canonical_write(_paths(workspace)["replay_receipts"], {"receipts": receipts})
    return _paths(workspace)["replay_request"], request


def _cmd_reconcile(workspace, args):
    wp01_path, wp02_path, wp03_path = args
    workspace = Path(workspace)
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    receipts_doc = _read_plain(_paths(workspace)["replay_receipts"])
    collected = _read_plain(_paths(workspace)["contributions_collected"])

    work_packages_by_task = {}
    for wp_path in (wp01_path, wp02_path, wp03_path):
        wp = _read_plain(wp_path)
        work_packages_by_task[wp.get("taskId")] = wp

    edit_domains = {}
    for contribution in collected["contributions"]:
        work_package = work_packages_by_task.get(contribution.get("taskId"))
        if work_package is not None:
            edit_domains[contribution["id"]] = work_package.get("editDomain", {})

    body = integration.reconcile(request, receipts_doc.get("receipts", []), edit_domains)
    return _paths(workspace)["integration_state"], body


def _cmd_presta(workspace, args):
    """Cheap PT pre-check plus RC-qualification evidence for the not-yet-implemented batch.

    Calls `integration.seal_batch` itself (against the already-reconciled
    `integration-state`) purely to read the candidate `merge-commit`'s own
    `newNets` -- the same computation `implement` performs and persists for
    real; `presta` never writes `state/merge-commit.json` itself, so a
    second, real `seal_batch` call in `implement` is not a duplicate write,
    only a duplicate (pure, side-effect-free) computation.

    T13 fix-round interface (`verification.precheck_evidence(merge_commit,
    spef_net_names_path)`, per the controller's message -- not yet landed
    at the time this call site was written; see this task's report "Call
    sites pending reconciliation"). This subcommand writes the base SPEF's
    net names to `integrations/current/presta/spef-net-names.json` (a JSON
    array of strings) and passes *that path* as `spef_net_names_path`,
    since the presumed contract is a plain, pre-extracted list file rather
    than `precheck_evidence` itself parsing raw SPEF grammar.
    """
    base_state_path, scenario_corners_path, site_profile_path = args
    workspace = Path(workspace)
    base_state = _read_declared(base_state_path, "design-state")
    scenario_corners = _read_plain(scenario_corners_path)
    site_profile = _read_plain(site_profile_path)
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    integration_state = _read_declared(_paths(workspace)["integration_state"], "integration-state")
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    merge_commit = integration.seal_batch(integration_state, request, facts, collected["contributions"])

    scenario = adapters.REQUIRED_SCENARIOS[0]
    corner = scenario_corners.get(scenario)
    if not corner:
        raise InputError("invalid-input", f"scenario corners is missing {scenario!r}")
    spef_ref = base_state.get("spef", {}).get(corner)
    if not spef_ref:
        raise core.AtcsError("missing-input", f"base state has no SPEF for corner {corner!r}")

    inputs = {
        "design": base_state["top"], "netlist": str(workspace / base_state["netlist"]["path"]),
        "sdc": str(workspace / base_state["sdc"][0]["path"]) if base_state.get("sdc") else "",
        "spef": str(workspace / spef_ref["path"]),
    }
    report_root = workspace / "integrations" / "current" / "presta"
    task = adapters.compile_pt_presta_task(scenario, inputs, str(report_root))
    tcl_path = report_root / scenario / "pt-presta.tcl"
    tcl_path.parent.mkdir(parents=True, exist_ok=True)
    tcl_path.write_text(task["tcl"], encoding="utf-8")
    log_path = report_root / scenario / "pt.log"
    adapters.run_tool(site_profile, ["pt_shell", "-f", str(tcl_path)], cwd=tcl_path.parent, log_path=log_path)

    global_timing_path = Path(task["globalTiming"])
    if not global_timing_path.is_file():
        raise adapters.AdapterToolError("presta produced no global_timing.rpt", log_path)
    from atcs import reports  # local import: only presta needs the PT report parser
    predicted = reports.parse_global_timing(global_timing_path.read_text(encoding="utf-8"))

    # `tools/read-atcs.py`'s `precheck-evidence` reader parses this source
    # as plain text, one net name per line (`resolved.read_text(...)
    # .splitlines()`) -- never JSON. Written as an absolute-but-in-workspace
    # path: `verification.precheck_evidence` hashes whatever path string it
    # is given (no root-resolution of its own), so this must already be
    # openable regardless of this process's cwd; the Reader's own
    # `_safe_join` still accepts it (an absolute path already inside
    # `workspace` resolves and validates the same as a relative one).
    spef_net_names = adapters.parse_spef_net_names(_read_text(str(workspace / spef_ref["path"])))
    spef_net_names_path = report_root / "spef-net-names.txt"
    spef_net_names_path.parent.mkdir(parents=True, exist_ok=True)
    spef_net_names_path.write_text(
        "\n".join(sorted(spef_net_names)) + "\n" if spef_net_names else "", encoding="utf-8",
    )
    # `predicted` (the cheap PT-level WNS estimate) is not part of the
    # `precheck_evidence` artifact's own contract -- kept as a side file for
    # `evaluate`/debugging, never the declared output.
    _canonical_write(report_root / "predicted.json", {"scenario": scenario, "predicted": predicted})

    body = verification.precheck_evidence(merge_commit, str(spef_net_names_path))
    return _paths(workspace)["presta"], body


def _cmd_implement(workspace, args):
    current_state_path, site_profile_path = args
    workspace = Path(workspace)
    current_state = _read_declared(current_state_path, "design-state")
    site_profile = _read_plain(site_profile_path)
    integration_state = _read_declared(_paths(workspace)["integration_state"], "integration-state")
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])

    merge_commit = integration.seal_batch(integration_state, request, facts, collected["contributions"])
    _canonical_write(_paths(workspace)["merge_commit"], merge_commit)
    _canonical_write(workspace / "implementations" / "current" / "merge-commit.json", merge_commit)

    design = current_state["top"]
    current_db = workspace / current_state["database"]["path"]
    output_root = workspace / "implementations" / "current"
    task = adapters.compile_innovus_eco_task(merge_commit, str(current_db), design, str(output_root))

    eco_path = Path(task["ecoPath"])
    eco_path.parent.mkdir(parents=True, exist_ok=True)
    eco_path.write_text(task["ecoText"], encoding="utf-8")
    main_tcl_path = output_root / "innovus-eco.tcl"
    main_tcl_path.write_text(task["tcl"], encoding="utf-8")
    log_path = output_root / "innovus-eco.log"
    adapters.run_tool(
        site_profile, task["command"] + [str(main_tcl_path), "-log", str(log_path), "-overwrite", "-64", "-nowin"],
        cwd=output_root, log_path=log_path,
    )

    outputs = task["outputs"]
    for name, path in outputs.items():
        if not Path(path).is_file():
            raise adapters.AdapterToolError(f"expected Innovus ECO output missing: {name}={path}", log_path)

    database_ref = {
        "path": _relpath(outputs["database"], workspace), "sha256": core.file_sha256(outputs["database"]),
        "datDigest": core.tree_digest(outputs["database"] + ".dat"),
    }
    netlist_ref = {"path": _relpath(outputs["netlist"], workspace), "sha256": core.file_sha256(outputs["netlist"])}
    def_ref = {"path": _relpath(outputs["def"], workspace), "sha256": core.file_sha256(outputs["def"])}

    body = {
        "mergeCommitId": merge_commit["id"], "design": design,
        "database": database_ref, "netlist": netlist_ref, "def": def_ref,
        "drcReportPath": _relpath(outputs["drc"], workspace),
        "connectivityReportPath": _relpath(outputs["connectivity"], workspace),
    }
    return _paths(workspace)["implement"], body


def _cmd_extract(workspace, args):
    corners_path, site_profile_path = args
    workspace = Path(workspace)
    corners_doc = _read_plain(corners_path)
    corners = corners_doc.get("corners", [])
    if not corners:
        raise InputError("invalid-input", "corners must name at least one StarRC corner")
    site_profile = _read_plain(site_profile_path)
    implement = _read_plain(_paths(workspace)["implement"])

    def_path = workspace / implement["def"]["path"]
    output_root = workspace / "implementations" / "current"
    spef_out = {}
    for corner in corners:
        task = adapters.compile_starrc_task(implement["design"], corner, str(def_path), str(output_root))
        cmd_path = Path(task["cmdPath"])
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text(task["cmdText"], encoding="utf-8")
        Path(task["workDir"]).mkdir(parents=True, exist_ok=True)
        log_path = Path(task["cmdPath"]).with_suffix(".log")
        adapters.run_tool(site_profile, task["command"], cwd=cmd_path.parent, log_path=log_path)
        spef_path = Path(task["spefPath"])
        if not spef_path.is_file():
            raise adapters.AdapterToolError(f"StarRC produced no SPEF for corner {corner!r}", log_path)
        spef_out[corner] = {
            "path": _relpath(spef_path, workspace), "sha256": core.file_sha256(spef_path),
            "inputDefSha256": implement["def"]["sha256"], "estimated": False,
        }
    return _paths(workspace)["extract"], {"spef": spef_out}


def _cmd_sta(workspace, args):
    query_spec_path, sdc_path, scenario_corners_path, base_design_state_path, site_profile_path = args
    workspace = Path(workspace)
    query_spec = _read_plain(query_spec_path)
    sdc_doc = _read_plain(sdc_path)
    scenario_corners = _read_plain(scenario_corners_path)
    base_state = _read_declared(base_design_state_path, "design-state")
    site_profile = _read_plain(site_profile_path)
    implement = _read_plain(_paths(workspace)["implement"])
    extract = _read_plain(_paths(workspace)["extract"])

    for scenario in adapters.REQUIRED_SCENARIOS:
        if scenario not in scenario_corners:
            raise InputError("invalid-input", f"scenario corners is missing {scenario!r}")

    report_root = workspace / "implementations" / "current" / "sta"
    sta_receipts = {}
    sta_sources = {}
    for scenario in adapters.REQUIRED_SCENARIOS:
        corner = scenario_corners[scenario]
        spef_ref = extract["spef"].get(corner)
        if not spef_ref:
            raise InputError("invalid-input", f"extract has no SPEF for corner {corner!r}")
        sta_sources[scenario] = {"path": spef_ref["path"], "sha256": spef_ref["sha256"]}
        inputs = {
            "design": implement["design"], "netlist": str(workspace / implement["netlist"]["path"]),
            "sdc": str(workspace / sdc_doc["sdc"][0]), "spef": str(workspace / spef_ref["path"]),
        }
        task = adapters.compile_pt_scenario_task(scenario, inputs, str(report_root), query_spec)
        scenario_dir = report_root / scenario
        tcl_path = scenario_dir / "pt-scenario.tcl"
        tcl_path.parent.mkdir(parents=True, exist_ok=True)
        tcl_path.write_text(task["tcl"], encoding="utf-8")
        log_path = scenario_dir / "pt.log"
        adapters.run_tool(site_profile, task["command"] + [str(tcl_path)], cwd=scenario_dir, log_path=log_path)
        for name, report_path in task["reports"].items():
            if not Path(report_path).is_file():
                raise adapters.AdapterToolError(f"expected PT report missing: {report_path}", log_path)

        source_refs = {
            "designStateId": base_state["id"],
            "scenarios": {scenario: {
                "globalTiming": task["reports"]["global_timing.rpt"], "setupPaths": task["reports"]["setup.rpt"],
                "holdPaths": task["reports"]["hold.rpt"], "checkTiming": task["reports"]["check_timing.rpt"],
            }},
        }
        one_scenario_query_spec = dict(query_spec)
        one_scenario_query_spec["requiredScenarios"] = [scenario]
        observation = state.capture(source_refs, one_scenario_query_spec)
        sta_receipts[scenario] = {
            "corner": corner,
            "inputs": {"netlistSha256": implement["netlist"]["sha256"], "spefSha256": spef_ref["sha256"]},
            "observation": observation,
        }

    manifest = adapters.build_design_state_manifest(
        top=implement["design"], stage="postroute",
        database_enc=implement["database"]["path"], database_dat=implement["database"]["path"] + ".dat",
        netlist=implement["netlist"]["path"], def_path=implement["def"]["path"],
        spef_by_corner={corner: ref["path"] for corner, ref in extract["spef"].items()},
        sdc_list=sdc_doc["sdc"], scenario_corners=scenario_corners, tools=base_state.get("tools"),
        parent_id=base_state["id"], root=str(workspace),
    )
    design_state = state.design_state(manifest)
    _canonical_write(workspace / "implementations" / "current" / "design-state.json", design_state)

    # Called exactly once here: extraction (`extract.json`, already read
    # above) and all `REQUIRED_SCENARIOS`' STA (the loop above) have both
    # just completed for this implementation. `sta_sources` is one
    # `{"path","sha256"}` ref per required scenario -- the SPEF that
    # scenario's STA actually read (`atcs.refresh.record_refresh`'s own
    # binding shape: a dict keyed by `verification.REQUIRED_SCENARIOS`).
    merge_commit = _read_declared(_paths(workspace)["merge_commit"], "merge-commit")
    from atcs import refresh  # local import: keeps this dispatcher loadable if this module is ever absent
    refresh.record_refresh(str(_paths(workspace)["refresh_ledger"]), merge_commit["id"], design_state["id"], sta_sources)

    body = {
        "designStateId": design_state["id"], "database": design_state["database"], "sta": sta_receipts,
    }
    return _paths(workspace)["sta"], body


def _cmd_physical(workspace, args):
    drc_path, connectivity_path, mode = args
    if mode not in ("baseline", "candidate"):
        raise InputError("invalid-input", f"mode must be 'baseline' or 'candidate', got {mode!r}")
    drc_text = _read_text(drc_path)
    connectivity_text = _read_text(connectivity_path)
    body = {"drc": drc_text, "connectivity": connectivity_text}
    key = "baseline_physical" if mode == "baseline" else "physical"
    return _paths(workspace)[key], body


def _cmd_evaluate(workspace, args):
    (policy_path,) = args
    workspace = Path(workspace)
    policy = _read_plain(policy_path)
    merge_commit = _read_declared(_paths(workspace)["merge_commit"], "merge-commit")
    sta = _read_plain(_paths(workspace)["sta"])
    implement = _read_plain(_paths(workspace)["implement"])
    extract = _read_plain(_paths(workspace)["extract"])
    physical = _read_plain(_paths(workspace)["physical"])
    baseline_physical = _read_plain(_paths(workspace)["baseline_physical"])
    prior_observation = _read_declared(_paths(workspace)["observation"], "observation-set")

    plan = verification.plan_checks(merge_commit, policy)
    receipts = {
        "designStateId": sta["designStateId"], "database": sta["database"],
        "netlist": implement["netlist"], "def": implement["def"], "spef": extract["spef"],
        "sta": sta["sta"], "physical": physical,
    }
    body = verification.assemble(plan, receipts, prior_observation, baseline_physical)
    return _paths(workspace)["evaluation"], body


def _cmd_adopt(workspace, args):
    """Publish `evaluation` and return the `{acceptanceRecord, refreshLedger}` envelope.

    T13 fix-round interface (per the controller's message): the declared
    output is no longer the bare `acceptance-record` artifact but an
    envelope naming, by workspace-relative path, the acceptance-record this
    call just sealed (canonical store: `accepted/<id>.json`) and the
    refresh ledger `sta` maintains (`state/refresh-ledger.json`) -- both
    paths, never embedded content, so a Reader loads and independently
    schema/id-verifies each companion itself.
    """
    expected_base_id, policy_path = args
    workspace = Path(workspace)
    evaluation = _read_declared(_paths(workspace)["evaluation"], "evaluation")
    policy = _read_plain(policy_path)
    record = adoption.publish(evaluation, expected_base_id, str(_paths(workspace)["pointers"]), policy)
    acceptance_record_path = workspace / "accepted" / f"{record['id']}.json"
    _canonical_write(acceptance_record_path, record)
    envelope = {
        "acceptanceRecord": _relpath(acceptance_record_path, workspace),
        "refreshLedger": _relpath(_paths(workspace)["refresh_ledger"], workspace),
    }
    return _paths(workspace)["accepted"], envelope


def _cmd_residual(workspace, args):
    del args
    workspace = Path(workspace)
    evaluation = _read_declared(_paths(workspace)["evaluation"], "evaluation")
    readiness = _read_declared(_paths(workspace)["readiness"], "input-readiness")
    exp = _read_json_or_default(_paths(workspace)["experience"], {"schema": "atcs.experience/1", "entries": []})

    sta = _read_plain(_paths(workspace)["sta"])
    combined_checks = {}
    combined_scenarios = {}
    sources = []
    for scenario, entry in sta.get("sta", {}).items():
        observation = entry.get("observation", {})
        combined_checks.update(observation.get("checks", {}))
        combined_scenarios.update(observation.get("scenarios", {}))
        sources.extend(observation.get("sources", []))
    combined_observation = {
        "designStateId": sta.get("designStateId"), "precision": None,
        "scenarios": combined_scenarios, "checks": combined_checks,
        "missingScenarios": [], "coverage": {"complete": True, "reasons": []}, "sources": sources,
    }

    cases = residual_module.extract(evaluation, combined_observation, exp, readiness)
    return _paths(workspace)["residual_cases"], {"cases": cases}


def _cmd_apr_prepare(workspace, args):
    (stage,) = args
    if stage not in APR_STAGES:
        raise InputError("invalid-input", f"stage must be one of {APR_STAGES}, got {stage!r}")
    workspace = Path(workspace)
    residual_doc = _read_plain(_paths(workspace)["residual_cases"])
    readiness = _read_declared(_paths(workspace)["readiness"], "input-readiness")
    intervention = lifecycle.compile_intervention(residual_doc.get("cases", []), stage, readiness)
    task = lifecycle.stage_task(stage, readiness, intervention, ".")
    return _apr_task_path(workspace, stage), task


def _cmd_record_experience(workspace, args):
    lineage_path, decision_path, outcome_path = args
    lineage = _read_plain(lineage_path)
    decision = _read_plain(decision_path)
    outcome = _read_plain(outcome_path)
    body = experience.record(str(_paths(workspace)["experience"]), lineage, decision, outcome)
    return _paths(workspace)["experience"], body


SUBCOMMANDS = {
    "bind-inputs": _cmd_bind_inputs,
    "baseline": _cmd_baseline,
    "observe": _cmd_observe,
    "risk": _cmd_risk,
    "prepare-workers": _cmd_prepare_workers,
    "capture-contribution": _cmd_capture_contribution,
    "collect": _cmd_collect,
    "compose-facts": _cmd_compose_facts,
    "replay-prepare": _cmd_replay_prepare,
    "reconcile": _cmd_reconcile,
    "presta": _cmd_presta,
    "implement": _cmd_implement,
    "extract": _cmd_extract,
    "sta": _cmd_sta,
    "physical": _cmd_physical,
    "evaluate": _cmd_evaluate,
    "adopt": _cmd_adopt,
    "residual": _cmd_residual,
    "apr-prepare": _cmd_apr_prepare,
    "record-experience": _cmd_record_experience,
}


def _fail(code, detail, exit_code, extra=None):
    payload = {"code": code, "detail": detail}
    if extra:
        payload.update(extra)
    sys.stderr.write(json.dumps(payload, sort_keys=True) + "\n")
    return exit_code


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) < 2:
        return _fail("missing-input", "usage: atcs_cli.py <subcommand> <workspace> [args]", 2)
    subcommand, workspace, *rest = argv
    handler = SUBCOMMANDS.get(subcommand)
    if handler is None:
        return _fail("missing-input", f"unknown subcommand: {subcommand!r}", 2)

    try:
        output_path, body = handler(workspace, rest)
    except InputError as exc:
        return _fail(exc.code, exc.detail, 2)
    except core.AtcsError as exc:
        return _fail(exc.code, exc.detail, 3)
    except adapters.AdapterToolError as exc:
        return _fail("tool-failed", exc.detail, 4, extra={"log": exc.log_path})

    core.write_artifact(output_path, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
