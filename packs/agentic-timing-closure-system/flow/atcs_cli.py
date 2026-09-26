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
output" a Reader watches -- **never** a mutable directory named `current`:
the architecture requires every implementation/integration artifact to live
under its own real, content-addressed `implementations/<mergeId>/` /
`integrations/<batchId>/` (a controller decision explicit about this: a
mutable `current` directory would make history un-interpretable -- two
generations' raw evidence could otherwise silently overwrite each other at
the same path, and a failed EDA run's partial output could get mistaken for
a different generation's). `<mergeId>` is `merge_commit["id"]`
(`integration.seal_batch`'s own stamped id -- `implement` computes it before
choosing any output path, and `presta`/`extract`/`sta` all read it back off
an already-written declared output rather than recomputing it, except
`presta`, which calls `seal_batch` itself, read-only, before one exists for
real). `<batchId>` is `replay-request["batchId"]` (`prepare_replay`'s own
`plan.batchId` passthrough). Both are validated via
`adapters.validate_path_segment` before use (see Global Constraints below).
A failed EDA run therefore only ever leaves partial files under that one
real id's own directory -- never under a shared, generation-ambiguous path,
and never as a declared output (exit 4 leaves no output file at all, per
the exit-code contract above).

Subcommand table (path column is workspace-relative; "in" lists positional
args after `<workspace>`, in order; a name in *italics-by-convention*
`snake_case` names a fixed internal path this dispatcher reads by
convention, not a positional arg)
-------------------------------------------------------------------------------------------------------------

Task 12b (state-driven CLI inputs) changed the rule for every subcommand
below: argv carries only the workspace, fixed Site-bound input paths, slot
numbers, and Goal/Strategy values -- every run-time id or per-id path is
read from a fixed `state/*.json` entry file a predecessor subcommand wrote
(see "Gaps closed by Task 12b" below for the G-numbers this closes).

| # | Subcommand | Extra args | Calls | Declared output |
|---|---|---|---|---|
| 1 | `bind-inputs` | manifest, siteCapabilities | `state.input_readiness` | `state/readiness.json` |
| 2 | `baseline` | manifest | `state.design_state` | `state/baseline.json` (also seeds `state/working-state.json`) |
| 3 | `policy` | analysisContractDir, targetSetupNs(`{from: goal}`), targetHoldNs(`{from: goal}`) | reads `<analysisContractDir>/policy.json` + `state/baseline.json` + `state/observation.json` | `state/policy.json` (stamped) |
| 4 | `observe` | querySpec, siteProfile, scenarioInputs, maxPaths(`{from: strategy}`) | `adapters.compile_pt_scenario_tasks` + `run_tool` (x4) then `state.capture` | `state/observation.json` (also `state/observation-prev.json` and `observations/<id>.json`) |
| 5 | `risk` | priorObservation(`state/observation-prev.json`), currentObservation(`state/observation.json`), recheck | `state.compare_checks` (self-compares on the campaign's first observation, when `priorObservation` does not exist yet) | `state/risk.json` |
| 6 | `prepare-workers` | baseState(`state/working-state.json`), siteCapabilities, edaProfile, wp01, wp02, wp03 | `workspaces.validate_work_package` + `workspaces.prepare` (x3) + `adapters.compile_xtop_operator_task`/`compile_xtop_analysis_manual_task` (x3, materialized into each worker's own root) | `state/workers.json` (now embeds each slot's full `workPackage`/`workspaceManifest`) |
| 7 | `capture-contribution` | slot | `contributions.seal` (base_ref/result_refs composed from `state/workers.json[slot]` and the slot's own workspace root -- see `_cmd_capture_contribution`'s docstring for the exact `before.dump`/`after.dump`/`ops.jsonl`/`summary.json` file names) | `state/contribution-<slot>.json` (one of 3 literal names) |
| 8 | `collect` | (none) | reads whichever `contribution-w0N.json` exist (`contribution-index` read envelope: `{"contributions","pending"}`) | `state/contributions-collected.json` |
| 9 | `compose-facts` | resolutions | `composition.analyze` (`baseStateId` from `state/working-state.json`) | `state/composition-facts.json` |
| 10 | `replay-prepare` | baseState(`state/working-state.json`), plan, siteProfile | `integration.validate_plan` + `integration.prepare_replay` then `adapters.compile_xtop_replay_task` + `run_tool` (best-effort) | `state/replay-request.json` |
| 11 | `reconcile` | wp01, wp02, wp03 | `integration.reconcile` | `state/integration-state.json` |
| 12 | `presta` | baseState(`state/working-state.json`), scenarioCorners, siteProfile | `integration.seal_batch` (read-only re-derivation, for `newNets`) + `adapters.compile_pt_presta_task` + `run_tool`, `verification.precheck_evidence` | `state/presta.json` (the stamped `precheckEvidence` artifact) |
| 13 | `implement` | currentDesignState(`state/working-state.json`), siteProfile | `integration.seal_batch` then `adapters.compile_innovus_eco_task` + `run_tool` | `state/implement.json` |
| 14 | `extract` | corners, siteProfile | `adapters.compile_starrc_task` + `run_tool` (per corner) | `state/extract.json` |
| 15 | `sta` | querySpec, sdc, scenarioCorners, baseDesignState(`state/working-state.json`), siteProfile | `adapters.compile_pt_scenario_task` + `run_tool` (per scenario), `state.design_state`, `state.capture`, `refresh.record_refresh` (once, on completion) | `state/sta.json` (also appends `state/refresh-ledger.json`) |
| 16 | `physical` | (candidate) mode only; (baseline) drcReport, connectivityReport, mode | (I/O packaging only; candidate mode reads+re-hashes `state/implement.json`'s `drcReport`/`connectivityReport`) | `state/baseline-physical.json` or `state/physical.json` |
| 17 | `evaluate` | policy(`state/policy.json`) | `verification.plan_checks` + `verification.assemble` | `state/evaluation.json` |
| 18 | `adopt` | policy(`state/policy.json`) | `adoption.publish` (`expectedBase` from `state/working-state.json`; rewrites `state/working-state.json` whenever `working` moves) | `accepted/latest.json` (envelope: `{"acceptanceRecord","refreshLedger"}` paths) |
| 19 | `residual` | (none) | `residual.extract` | `state/residual-cases.json` |
| 20 | `apr-prepare` | stage(`place`\|`cts`\|`route`\|`postroute`) | `lifecycle.compile_intervention` + `lifecycle.stage_task` | `apr/<stage>/task.json` (4 literal paths; now also carries `taskId`) |
| 21 | `apr-run` | stage(`place`\|`cts`\|`route`\|`postroute`), siteProfile | reads `apr/<stage>/task.json` then `run_tool` (stage batch) + `adapters.compile_innovus_export_task` + `run_tool` (export batch) | `state/implement.json` (same shape `implement` writes) |
| 22 | `record-experience` | reasonSource(an `integration-plan` or `next-decision`, for its `.reason` field) | `experience.record` (lineage/decision/outcome composed from `state/working-state.json`, `state/implement.json`, `state/evaluation.json`, `state/contributions-collected.json`, `state/sta.json`) | `state/experience.json` |

Gaps closed by Task 12b (G1-G7, G11, G19, G24 per `FABRIC.md`)
-------------------------------------------------------------------

- G1/G7: `compose-facts`/`adopt` no longer take a literal state-id argv arg;
  every subcommand that used to base itself on `state/baseline.json` now
  bases itself on `state/working-state.json`, which `baseline` seeds and
  `adopt` rewrites whenever the `working` pointer moves (`_cmd_baseline`/
  `_cmd_adopt`) -- a second implementation round re-bases on the *adopted*
  state, not the original baseline.
- G2: `capture-contribution <slot>` composes `base_ref`/`result_refs` itself
  from `state/workers.json[slot]` and the slot's own workspace root; no
  `research/requests/capture-*` inputs (`_cmd_capture_contribution`).
- G3: `physical` (candidate mode) reads the DRC/connectivity report
  identity from `state/implement.json`'s own `drcReport`/`connectivityReport`
  (`{"path","sha256"}`, re-hashed), not fixed `state/candidate-*.rpt` paths
  (`_cmd_physical`).
- G4: the new `policy` subcommand composes the run-time acceptance policy;
  `evaluate`/`adopt` read it at `state/policy.json` (`_cmd_policy`).
- G5: `record-experience` composes lineage/decision/outcome from state
  files; no `research/requests/experience-*` inputs (`_cmd_record_experience`).
- G6: `observe` composes its own PT source refs from the PT it just ran and
  `state/working-state.json`'s own id; no `${analysisContract}/baseline-
  source-refs.json` (`_cmd_observe`, serves both "observe-baseline" and
  "observe-query" graph roles).
- G11: the Strategy knob (`maxPaths`) is threaded into `observe`'s
  `query_spec` via a plain argv value (`_cmd_observe`).
- G19: `observe` preserves the prior `state/observation.json` at
  `state/observation-prev.json` and writes its immutable original to
  `observations/<id>.json`; `risk` self-compares on the campaign's first
  observation (`_cmd_observe`/`_cmd_risk`).
- G24: `next-decision` gains a required `stage` field when
  `action == "earlier-apr"` -- **`tools/read-atcs.py`'s
  `_collect_next_decision_problems` (around the existing `action must be
  one of ...` check) must also require and validate that field** when
  `action == "earlier-apr"` (one of `place`/`cts`/`route`/`postroute`,
  matching `atcs_cli.APR_STAGES`); this dispatcher's own CLI-side
  validation for `stage` is `apr-prepare`/`apr-run`'s existing
  `stage not in APR_STAGES` check. The new `apr-run` subcommand actually
  executes the prepared stage task and writes an `implement`-shaped
  candidate (`_cmd_apr_run`), so `extract`/`sta`/`physical`/`evaluate`/
  `adopt`/`record-experience` all follow unchanged.

Known gaps still open (see also `adapters.py`'s own "Gaps")
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
- Direct consequence of the above (controller-flagged, for T14's
  `FABRIC.md` Gaps, not a code fix): because `presta` always compares a
  batch's `newNets` against the **base** SPEF's own net names, and the base
  SPEF by definition never models a net that batch itself is about to
  create, `tc_unqualified_rc_net_count` is >0 for **every** batch that
  contains an `insert_buffer` op, with no exception. Whatever Judge rule
  this Pack wires on top of `precheck-evidence` (a "presta-model-qualified"
  gate) will therefore always route an insertion-containing batch to its
  next-decision/escalation path rather than ever accepting presta's own
  predicted WNS for such a batch, until a real in-session RC source (a
  live XTop incremental extraction, or a genuine post-implement StarRC
  refresh) exists for T12 to point `precheck_evidence` at instead of the
  base SPEF. This is a real, structural limitation of what evidence this
  Pack's current artifact set makes available at `presta` time, not a bug
  in the qualification check itself.

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
  `integrations/<batchId>/presta/spef-net-names.txt`, **one name per line**
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
        "working_state": state_dir / "working-state.json",
        "policy": state_dir / "policy.json",
        "pointers": state_dir / "pointers.json",
        "observation": state_dir / "observation.json",
        "observation_prev": state_dir / "observation-prev.json",
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
    """Build the baseline `design-state` and seed `state/working-state.json` from it verbatim.

    `state/working-state.json` is the one fixed, literal-path entry file
    every later subcommand that used to take `state/baseline.json` as its
    base (`prepare-workers`, `compose-facts`, `replay-prepare`, `presta`,
    `implement`, `sta`, `adopt`) reads instead (G1/G7) -- `adopt` rewrites it
    with the adopted candidate's own design-state whenever the `working`
    pointer moves (see `_cmd_adopt`), so a second implementation round
    re-bases on the *adopted* state, never the original baseline again.
    """
    (manifest_path,) = args
    manifest = _read_plain(manifest_path)
    body = state.design_state(manifest)
    _canonical_write(_paths(workspace)["working_state"], body)
    return _paths(workspace)["baseline"], body


def _cmd_observe(workspace, args):
    """Run PT for every required scenario and compose the `observation-set` from what this call itself produced.

    G6/G19: `sourceRefs` is no longer an argv-bound Site/Workshop document
    (there is no static file that could know this campaign's own working
    design-state id or the workspace-relative report paths this same call
    is about to create) -- `designStateId` comes from `state/working-state.json`
    and every scenario's report paths come straight from the PT task this
    call just ran, never a second, separately-authored copy of the same
    paths. Serves both the "observe-baseline" and "observe-query" graph
    roles identically. `maxPaths` (G11's Strategy knob, `--max-paths`)
    arrives as a plain argv value, merged into `query_spec` here rather than
    baked into a Workshop/Site-authored `query_spec` file.

    G19: before overwriting the declared `state/observation.json`, the
    *previous* current observation (if any) is preserved verbatim at
    `state/observation-prev.json`, and this call's own new observation is
    also stored, immutably, at `observations/<id>.json`.
    """
    query_spec_path, site_profile_path, scenario_inputs_path, max_paths_raw = args
    query_spec = dict(_read_plain(query_spec_path))
    site_profile = _read_plain(site_profile_path)
    scenario_inputs = _read_plain(scenario_inputs_path)
    try:
        max_paths = int(max_paths_raw)
    except (TypeError, ValueError):
        raise InputError("invalid-input", f"maxPaths must be an integer, got {max_paths_raw!r}")
    if isinstance(max_paths, bool) or max_paths <= 0:
        raise InputError("invalid-input", f"maxPaths must be a positive int, got {max_paths_raw!r}")
    query_spec["maxPaths"] = max_paths

    workspace = Path(workspace)
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")

    report_root = workspace / "research" / "observe"
    tasks = adapters.compile_pt_scenario_tasks(query_spec, scenario_inputs, str(report_root))
    scenario_source_refs = {}
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
        scenario_source_refs[scenario] = {
            "globalTiming": task["reports"]["global_timing.rpt"], "setupPaths": task["reports"]["setup.rpt"],
            "holdPaths": task["reports"]["hold.rpt"], "checkTiming": task["reports"]["check_timing.rpt"],
        }

    source_refs = {"designStateId": working_state["id"], "scenarios": scenario_source_refs}
    body = state.capture(source_refs, query_spec)

    observation_path = _paths(workspace)["observation"]
    if observation_path.is_file():
        _canonical_write(_paths(workspace)["observation_prev"], _read_plain(observation_path))
    _canonical_write(workspace / "observations" / f"{body['id']}.json", body)
    return observation_path, body


def _cmd_risk(workspace, args):
    """Compare the previous observation against the current one (G19).

    `prior_path` is expected to be `state/observation-prev.json` -- a fixed
    literal path `observe` only ever writes *after* a first observation
    already exists (see `_cmd_observe`). On this campaign's very first
    observation there is nothing to compare against yet; per this task's
    brief, that first call compares `current` against itself (documented
    here, not a missing-input refusal) rather than requiring a predecessor
    that cannot yet exist.
    """
    prior_path, current_path, recheck_path = args
    current = _read_declared(current_path, "observation-set")
    prior = _read_declared(prior_path, "observation-set") if Path(prior_path).is_file() else current
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

        # `manifest["root"]` is workspace-relative (`atcs.workspaces.prepare`'s own
        # convention: "workspaces/<taskId>/r<rev>/"); join it against `workspace`
        # before writing anything, or this dispatcher's own subprocess cwd (never
        # guaranteed to be the campaign workspace) silently decides where these
        # session files land instead (pre-existing Task 12 bug, fixed here).
        session_dir = workspace / manifest["root"]
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
            # G2: the full stamped artifacts, not just their ids -- `capture-contribution
            # <slot>` composes `base_ref` from these directly, so it needs no argv path
            # of its own beyond the slot name.
            "workPackage": validated, "workspaceManifest": manifest,
        }
    return _paths(workspace)["workers"], {"workers": index}


def _cmd_capture_contribution(workspace, args):
    """Compose `base_ref`/`result_refs` from `state/workers.json` and the slot's own workspace (G2).

    `<slot>` is the only argv arg beyond `<workspace>` -- no
    `research/requests/capture-*` files exist any more. `base_ref` comes
    straight from `state/workers.json[slot]`'s own `workspaceManifest`/
    `workPackage` (full stamped artifacts, per `_cmd_prepare_workers`'s own
    change). `result_refs` is composed from the Operator's outputs inside
    the slot's own workspace root (`state/workers.json[slot]["root"]`):

    - ``before.dump`` / ``after.dump`` -- cell dumps the Operator must write
      (via the session's own ``atcs_dump_cells`` typed procedure, already
      defined by ``xtop-operator.tcl``) immediately before and after its
      edits, at exactly these two fixed names.
    - ``ops.jsonl`` -- the same typed-procedure trace path already recorded
      as `state/workers.json[slot]["opsLog"]`.
    - ``summary.json`` (optional) -- ``{"xtopSetupWns", "xtopHoldWns",
      "diagnosis", "cones", "dependencies"}``, all optional; a numeric
      ``xtopSetupWns``/``xtopHoldWns`` becomes a known Measure, anything
      absent stays `unknown` (`contributions._predicted_measures`'s own
      default). ``diagnosis`` is required content (not a file name) for a
      `no-fix` slot -- `contributions.seal` refuses one without it.

    All three required files missing is `missing-input` (exit 2), matching
    "no subcommand reads files that no subcommand writes": every one of
    them is written by the Operator session `prepare-workers` itself set up
    for this exact slot and root.
    """
    (slot,) = args
    if slot not in workspaces.TASK_IDS:
        raise InputError("invalid-input", f"slot must be one of {workspaces.TASK_IDS}, got {slot!r}")
    workspace = Path(workspace)
    workers_doc = _read_plain(_paths(workspace)["workers"])
    entry = workers_doc.get("workers", {}).get(slot)
    if not entry:
        raise InputError("missing-input", f"state/workers.json has no entry for slot {slot!r}")
    workspace_manifest = entry.get("workspaceManifest")
    work_package = entry.get("workPackage")
    if not workspace_manifest or not work_package:
        raise InputError(
            "invalid-input", f"state/workers.json entry for slot {slot!r} is missing workspaceManifest/workPackage"
        )
    base_ref = {
        "stateId": workspace_manifest.get("baseStateId"),
        "workspaceManifest": workspace_manifest,
        "workPackage": work_package,
    }

    root = Path(entry["root"])
    if not root.is_absolute():
        root = workspace / root
    ops_log_path = Path(entry["opsLog"])
    if not ops_log_path.is_absolute():
        ops_log_path = workspace / ops_log_path
    before_dump = root / "before.dump"
    after_dump = root / "after.dump"
    for required_path, label in ((before_dump, "before.dump"), (after_dump, "after.dump"), (ops_log_path, "ops.jsonl")):
        if not required_path.is_file():
            raise InputError("missing-input", f"Operator output not found for slot {slot!r}: {label} at {required_path}")

    summary = _read_json_or_default(root / "summary.json", {})
    predicted = {}
    for key in ("xtopSetupWns", "xtopHoldWns"):
        value = summary.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            predicted[key] = core.known(value)

    result_refs = {
        "beforeDump": str(before_dump), "afterDump": str(after_dump), "script": None,
        "predicted": predicted, "diagnosis": summary.get("diagnosis"),
        "cones": summary.get("cones", []), "dependencies": summary.get("dependencies", []),
    }
    operation_trace = _read_text(str(ops_log_path))
    body = contributions.seal(base_ref, result_refs, operation_trace)
    _canonical_write(workspace / "contributions" / f"{body['id']}.json", body)
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
    """`baseStateId` comes from `state/working-state.json`'s own `id`, not a literal argv id (G1)."""
    (resolutions_path,) = args
    workspace = Path(workspace)
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    resolutions = _read_plain(resolutions_path).get("resolutions", [])
    body = composition.analyze(working_state["id"], collected["contributions"], resolutions)
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

    batch_id = adapters.validate_path_segment(request.get("batchId"), "replay-request.batchId")
    output_root = workspace / "integrations" / batch_id
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
    only a duplicate (pure, side-effect-free) computation. Its own id is
    used as the `integrations/<batchId>/presta/` directory name (never a
    mutable `current` directory, per architecture Sec.13.4).

    Writes the base SPEF's net names to
    `integrations/<batchId>/presta/spef-net-names.txt`, **plain text, one
    name per line** (matching `tools/read-atcs.py`'s `precheck-evidence`
    reader, which parses that source with `.splitlines()`, never JSON), and
    passes that path to `verification.precheck_evidence(merge_commit,
    spef_net_names_path)` -- which only hashes it, never parses or embeds
    its content, so the Reader independently re-parses and re-hashes it.
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
    batch_id = adapters.validate_path_segment(request.get("batchId"), "replay-request.batchId")
    report_root = workspace / "integrations" / batch_id / "presta"
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
    merge_id = adapters.validate_path_segment(merge_commit["id"], "merge-commit.id")
    _canonical_write(_paths(workspace)["merge_commit"], merge_commit)
    _canonical_write(workspace / "implementations" / merge_id / "merge-commit.json", merge_commit)

    design = current_state["top"]
    current_db = workspace / current_state["database"]["path"]
    output_root = workspace / "implementations" / merge_id
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
        "mergeCommitId": merge_commit["id"], "design": design, "parentStateId": merge_commit.get("parentStateId"),
        "database": database_ref, "netlist": netlist_ref, "def": def_ref,
        "drcReport": {"path": _relpath(outputs["drc"], workspace), "sha256": core.file_sha256(outputs["drc"])},
        "connectivityReport": {
            "path": _relpath(outputs["connectivity"], workspace), "sha256": core.file_sha256(outputs["connectivity"]),
        },
    }
    return _paths(workspace)["implement"], body


def _cmd_extract(workspace, args):
    corners_path, site_profile_path = args
    workspace = Path(workspace)
    corners_doc = _read_plain(corners_path)
    corners = corners_doc.get("corners", [])
    if not corners:
        raise InputError("invalid-input", "corners must name at least one StarRC corner")
    for corner in corners:
        adapters.validate_path_segment(corner, "corners entry")
    site_profile = _read_plain(site_profile_path)
    implement = _read_plain(_paths(workspace)["implement"])
    merge_id = adapters.validate_path_segment(implement.get("mergeCommitId"), "implement.mergeCommitId")

    def_path = workspace / implement["def"]["path"]
    output_root = workspace / "implementations" / merge_id
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


def _load_merge_commit_like(workspace, implement):
    """Return the sealed `merge-commit` `implement` was built from, or a synthetic stand-in for an APR-run candidate.

    `_cmd_implement` always writes `state/merge-commit.json` as a side
    effect. `_cmd_apr_run` never does -- a pure APR stage intervention has
    no Integration Fix Session batch behind it -- so `sta`/`evaluate`, which
    both need only `merge_commit["id"]`/`["parentStateId"]`/`.get("operations")`,
    fall back to `implement`'s own `mergeCommitId`/`parentStateId` fields
    (both `_cmd_implement` and `_cmd_apr_run` write them) with `operations: []`
    (an APR stage intervention never changes netlist topology or PG
    structures, so `verification.plan_checks` adds no extra functional/pg
    checks for it, correctly).
    """
    merge_commit_path = _paths(workspace)["merge_commit"]
    if merge_commit_path.is_file():
        return _read_declared(merge_commit_path, "merge-commit")
    if not implement.get("parentStateId"):
        raise InputError("missing-input", f"declared input not found: {merge_commit_path}")
    return {"id": implement.get("mergeCommitId"), "parentStateId": implement["parentStateId"], "operations": []}


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
    merge_id = adapters.validate_path_segment(implement.get("mergeCommitId"), "implement.mergeCommitId")

    for scenario in adapters.REQUIRED_SCENARIOS:
        if scenario not in scenario_corners:
            raise InputError("invalid-input", f"scenario corners is missing {scenario!r}")

    report_root = workspace / "implementations" / merge_id / "sta"
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
    _canonical_write(workspace / "implementations" / merge_id / "design-state.json", design_state)

    # Called exactly once here: extraction (`extract.json`, already read
    # above) and all `REQUIRED_SCENARIOS`' STA (the loop above) have both
    # just completed for this implementation. `sta_sources` is one
    # `{"path","sha256"}` ref per required scenario -- the SPEF that
    # scenario's STA actually read (`atcs.refresh.record_refresh`'s own
    # binding shape: a dict keyed by `verification.REQUIRED_SCENARIOS`).
    merge_commit = _load_merge_commit_like(workspace, implement)
    from atcs import refresh  # local import: keeps this dispatcher loadable if this module is ever absent
    refresh.record_refresh(str(_paths(workspace)["refresh_ledger"]), merge_commit["id"], design_state["id"], sta_sources)

    body = {
        "designStateId": design_state["id"], "database": design_state["database"], "sta": sta_receipts,
    }
    return _paths(workspace)["sta"], body


def _cmd_physical(workspace, args):
    """Baseline mode takes report paths via argv; candidate mode reads them from `state/implement.json` (G3).

    There is no fixed, literal `state/candidate-verify-drc.rpt`/
    `...-connectivity.rpt` path a Harness output could ever bind (each
    implementation writes its reports under its own `implementations/<mergeId>/`
    or `apr/<stage>/<taskId>/` directory) -- `mode == "candidate"` therefore
    takes only `<mode>` and resolves+re-hashes `state/implement.json`'s own
    `drcReport`/`connectivityReport` `{"path","sha256"}` refs instead
    (`implement`/`apr-run` both write that shape). `mode == "baseline"`
    is unchanged: the campaign baseline's own physical export has no such
    per-id state file to read from, so its two report paths stay argv-bound.
    """
    workspace = Path(workspace)
    if len(args) == 1:
        (mode,) = args
        if mode != "candidate":
            raise InputError("invalid-input", f"a single-argument physical call must be mode 'candidate', got {mode!r}")
        implement = _read_plain(_paths(workspace)["implement"])
        drc_ref = implement.get("drcReport")
        connectivity_ref = implement.get("connectivityReport")
        if not drc_ref or not connectivity_ref:
            raise InputError("invalid-input", "state/implement.json is missing drcReport/connectivityReport")
        drc_path = workspace / drc_ref["path"]
        connectivity_path = workspace / connectivity_ref["path"]
        if core.file_sha256(drc_path) != drc_ref.get("sha256"):
            raise core.AtcsError("identity-mismatch", f"drc report sha256 mismatch at {drc_path}")
        if core.file_sha256(connectivity_path) != connectivity_ref.get("sha256"):
            raise core.AtcsError("identity-mismatch", f"connectivity report sha256 mismatch at {connectivity_path}")
    else:
        drc_path, connectivity_path, mode = args
        if mode != "baseline":
            raise InputError("invalid-input", f"a three-argument physical call must be mode 'baseline', got {mode!r}")
    drc_text = _read_text(drc_path)
    connectivity_text = _read_text(connectivity_path)
    body = {"drc": drc_text, "connectivity": connectivity_text}
    key = "baseline_physical" if mode == "baseline" else "physical"
    return _paths(workspace)[key], body


def _cmd_evaluate(workspace, args):
    """`policy` is now the stamped `state/policy.json` `_cmd_policy` writes (G4)."""
    (policy_path,) = args
    workspace = Path(workspace)
    policy = _read_declared(policy_path, "policy")
    sta = _read_plain(_paths(workspace)["sta"])
    implement = _read_plain(_paths(workspace)["implement"])
    merge_commit = _load_merge_commit_like(workspace, implement)
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

    G1/G4/G7: `expected_base` comes from `state/working-state.json`'s own
    `id`, not a literal argv id; `policy` is the stamped `state/policy.json`.
    Whenever `adoption.publish`'s own `decision` is not `"refused"` -- i.e.
    the `working` pointer really did move (`adoption.py`'s own docstring:
    every refusal path returns `"refused"` instead) -- `state/working-state.json`
    is rewritten with the adopted candidate's own design-state, copied
    verbatim from the immutable `implementations/<candidateId>/design-state.json`
    `sta` already wrote, and re-verified (schema + digest) on the way in.
    """
    (policy_path,) = args
    workspace = Path(workspace)
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    evaluation = _read_declared(_paths(workspace)["evaluation"], "evaluation")
    policy = _read_declared(policy_path, "policy")
    record = adoption.publish(evaluation, working_state["id"], str(_paths(workspace)["pointers"]), policy)
    acceptance_record_path = workspace / "accepted" / f"{record['id']}.json"
    _canonical_write(acceptance_record_path, record)

    if record.get("decision") != "refused":
        working_pointer = (record.get("pointersAfter") or {}).get("working") or {}
        candidate_id = working_pointer.get("candidateId")
        if candidate_id:
            candidate_id = adapters.validate_path_segment(candidate_id, "pointersAfter.working.candidateId")
            candidate_state_path = workspace / "implementations" / candidate_id / "design-state.json"
            if candidate_state_path.is_file():
                candidate_design_state = _read_declared(candidate_state_path, "design-state")
                _canonical_write(_paths(workspace)["working_state"], candidate_design_state)

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
    """Compile a bounded APR stage intervention/task (full-flow only, via `lifecycle`).

    Adds a `taskId` field (recomputed identically to `lifecycle.stage_task`'s
    own internal digest -- `core.digest({"stage","hookTcl","readbackTcl"})`,
    the same value baked into `task["outputs"]`' own `apr/<stage>/<id>/`
    paths) onto the returned body: `apr-run` (G24) needs this stable id to
    build the output directory it will run the stage task in and to stamp
    as the resulting candidate's own `mergeCommitId` -- `lifecycle.stage_task`
    itself returns only `{"tcl","inputs","outputs"}` (M11's own module
    docstring: neither shape is a stamped artifact), so this is computed
    here rather than by changing that module's public return shape.
    """
    (stage,) = args
    if stage not in APR_STAGES:
        raise InputError("invalid-input", f"stage must be one of {APR_STAGES}, got {stage!r}")
    adapters.validate_path_segment(stage, "stage")  # whitelisted above; validated too, for defense in depth
    workspace = Path(workspace)
    residual_doc = _read_plain(_paths(workspace)["residual_cases"])
    readiness = _read_declared(_paths(workspace)["readiness"], "input-readiness")
    intervention = lifecycle.compile_intervention(residual_doc.get("cases", []), stage, readiness)
    task = lifecycle.stage_task(stage, readiness, intervention, ".")
    task_id = core.digest({"stage": stage, "hookTcl": intervention["hookTcl"], "readbackTcl": intervention["readbackTcl"]})
    body = dict(task)
    body["taskId"] = task_id
    return _apr_task_path(workspace, stage), body


def _cmd_record_experience(workspace, args):
    """Compose lineage/decision/outcome from state files -- no `research/requests/experience-*` inputs (G5).

    `<reasonSource>` is the one Workshop-authored document naming *why*
    this candidate was pursued -- either the compose Workshop's own
    `integration-plan` (a composed batch) or the next-investment Workshop's
    `next-decision` (an `implement`/`earlier-apr` decision that never went
    through composition); both schemas carry a `reason` field (see
    `.superpowers/sdd/global-context.md`'s "Shared data model"), and this
    dispatcher never needs to know which one it was handed, only `.reason`.

    `decisionId` is the accepted candidate's own resulting design-state id
    (`evaluation["stateId"]`) -- unique per accepted candidate, so a replay
    of the same accepted evaluation can never silently re-record. `action`
    is `state/implement.json`'s own `mergeCommitId` (the merge commit, or
    the APR task id for an `apr-run` candidate -- see `_cmd_apr_run`).
    `predicted`/`measured` are both `min(setup, hold)` WNS Measures:
    `predicted` is the best known xtop/presta prediction among this batch's
    own admissible `fix` contributions (`state/contributions-collected.json`);
    `measured` is `state/evaluation.json`'s own final WNS. Neither producer
    defines a "delta" shape for a whole merged batch, so this is a
    documented, deterministic, state-derived judgment call -- see this
    task's report.
    """
    (reason_source_path,) = args
    workspace = Path(workspace)
    reason_doc = _read_plain(reason_source_path)
    hypothesis = reason_doc.get("reason", "")

    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    implement = _read_plain(_paths(workspace)["implement"])
    evaluation = _read_declared(_paths(workspace)["evaluation"], "evaluation")
    collected = _read_json_or_default(_paths(workspace)["contributions_collected"], {"contributions": []})
    sta = _read_json_or_default(_paths(workspace)["sta"], {})

    precision = None
    for entry in sta.get("sta", {}).values():
        precision = entry.get("observation", {}).get("precision")
        if precision is not None:
            break

    predicted_values = []
    for contribution in collected.get("contributions", []):
        if contribution.get("kind") != "fix" or not contribution.get("admissible"):
            continue
        predicted = contribution.get("predicted", {})
        for key in ("prestaSetupWns", "prestaHoldWns", "xtopSetupWns", "xtopHoldWns"):
            measure = predicted.get(key)
            if core.is_known(measure):
                predicted_values.append(core.value_of(measure))
    predicted_measure = (
        core.known(min(predicted_values)) if predicted_values
        else core.unknown("no admissible contribution reported a predicted WNS")
    )

    setup_wns = evaluation.get("finalSetupWns")
    hold_wns = evaluation.get("finalHoldWns")
    if core.is_known(setup_wns) and core.is_known(hold_wns):
        measured_measure = core.known(min(core.value_of(setup_wns), core.value_of(hold_wns)))
    else:
        measured_measure = core.unknown("evaluation final WNS not fully known")

    lineage = {
        "decisionId": evaluation.get("stateId") or working_state["id"],
        "conditions": {
            "stage": working_state.get("stage"), "scenario": "*", "precision": precision,
            "toolVersion": core.canonical(working_state.get("tools", {})).decode("utf-8"),
        },
    }
    decision = {"hypothesis": hypothesis, "action": implement.get("mergeCommitId"), "predicted": predicted_measure}
    outcome = {"measured": measured_measure}

    body = experience.record(str(_paths(workspace)["experience"]), lineage, decision, outcome)
    return _paths(workspace)["experience"], body


def _baseline_min_wns(observation):
    """`min(setup, hold)` WNS across every `adapters.REQUIRED_SCENARIOS` entry, or `None` if incomplete.

    Mirrors `verification.assemble`'s own fail-closed "final WNS" rule
    (module docstring step 3) at the *baseline*, before any candidate
    exists -- every required scenario must be present, `complete` for both
    modes, and carry a known `wns` Measure, or the whole thing is
    incomplete (`None`), never a partial minimum.
    """
    scenarios = observation.get("scenarios", {})
    missing = set(observation.get("missingScenarios", []))
    values = []
    for scenario in adapters.REQUIRED_SCENARIOS:
        if scenario in missing or scenario not in scenarios:
            return None
        entry = scenarios[scenario]
        complete = entry.get("complete", {})
        for mode in ("setup", "hold"):
            if not complete.get(mode):
                return None
            wns = entry.get(mode, {}).get("wns")
            if not core.is_known(wns):
                return None
            values.append(core.value_of(wns))
    return min(values) if values else None


def _cmd_policy(workspace, args):
    """Compose the run-time acceptance policy (G4): static Site fields + Goal + campaign run-time facts.

    `<analysisContractDir>` is a fixed Site-bound directory; only its
    `policy.json`'s static fields (`allowDegradedWorking`, `degradeLimitNs`,
    `maxNewConstraintFailures`, `scenarioCorners`, `requiredScenarios`) are
    copied through -- a static Site document refusing to set any run-time or
    Goal field (`goal`, `baselineStateId`, `baselineMinWns`, `campaignRoot`)
    is `AtcsError("invalid-policy", ...)`, since letting it set its own
    acceptance bar/permissions is exactly what the SPEC forbids (M7's own
    guard order already refuses a `publish` whose policy tries to relax a
    check; this refuses the attempt at the source instead). `<targetSetupNs>`/
    `<targetHoldNs>` are this Pack's two Goal parameters (`{from: goal}`),
    forming `goal = {"setup", "hold"}`. `baselineStateId`/`baselineMinWns`
    are read back from the *original* `state/baseline.json` and its own
    baseline `state/observation.json` (never `state/working-state.json`,
    which `adopt` may since have rewritten) -- exactly the fixed anchor
    `adoption.publish`'s degraded-working gate needs for the whole campaign.
    `evaluate`/`adopt` read the result at the fixed path `state/policy.json`.
    """
    analysis_contract_dir, target_setup_raw, target_hold_raw = args
    workspace = Path(workspace)
    static_policy = _read_plain(Path(analysis_contract_dir) / "policy.json")

    run_time_keys = ("goal", "baselineStateId", "baselineMinWns", "campaignRoot")
    forbidden = sorted(key for key in run_time_keys if key in static_policy)
    if forbidden:
        raise core.AtcsError("invalid-policy", f"static policy file may not set {forbidden}")

    try:
        target_setup = float(target_setup_raw)
        target_hold = float(target_hold_raw)
    except (TypeError, ValueError):
        raise InputError("invalid-input", "targetSetupNs/targetHoldNs must be numbers")

    baseline = _read_declared(_paths(workspace)["baseline"], "design-state")
    baseline_observation = _read_declared(_paths(workspace)["observation"], "observation-set")
    if baseline_observation.get("designStateId") != baseline["id"]:
        raise core.AtcsError("stale-base", "baseline observation is not bound to the baseline design-state")
    baseline_min_wns = _baseline_min_wns(baseline_observation)
    if baseline_min_wns is None:
        raise core.AtcsError(
            "missing-input", "baseline observation does not cover every required scenario's setup/hold WNS"
        )

    body = {
        "allowDegradedWorking": bool(static_policy.get("allowDegradedWorking", False)),
        "degradeLimitNs": static_policy.get("degradeLimitNs", 0.0),
        "maxNewConstraintFailures": static_policy.get("maxNewConstraintFailures", 0),
        "scenarioCorners": static_policy.get("scenarioCorners", {}),
        "requiredScenarios": static_policy.get("requiredScenarios", list(adapters.REQUIRED_SCENARIOS)),
        "goal": {"setup": target_setup, "hold": target_hold},
        "baselineStateId": baseline["id"],
        "baselineMinWns": baseline_min_wns,
        "campaignRoot": str(workspace),
    }
    return _paths(workspace)["policy"], core.stamp("policy", body)


def _cmd_apr_run(workspace, args):
    """Run a prepared APR stage task through the Innovus wrapper and seal an `implement`-shaped candidate (G24).

    Reads the fixed `apr/<stage>/task.json` `apr-prepare` already wrote
    (including the `taskId` field it stamps). Runs `task["tcl"]` -- which
    only restores the predecessor checkpoint, applies the compiled
    intervention, runs the stage command and saves `./DBS/<stage>.enc`
    under `apr/<stage>/<taskId>/` (see `flow/templates/apr-stage.tcl`,
    frozen: it never exports DEF/netlist or runs verify_drc/
    verifyConnectivity itself) -- through the Site's Innovus wrapper with
    `cwd=<workspace>` (matching `lifecycle.stage_task`'s own baked-in
    `workspace_root="."` convention), then a second, non-ECO Innovus
    export/physical-evidence batch (`adapters.compile_innovus_export_task`)
    over the stage's own freshly saved database, into the *same*
    `apr/<stage>/<taskId>/` directory.

    Writes `state/implement.json` in the exact shape `_cmd_implement`
    writes: `mergeCommitId` is the APR task's own id (no real Integration
    Fix Session merge commit exists for a pure stage intervention) and
    `parentStateId` is `state/working-state.json`'s own id -- so
    `extract`/`sta`/`physical`(candidate)/`evaluate`/`adopt`/
    `record-experience` all follow unchanged (`evaluate`/`sta` read the
    missing `state/merge-commit.json` back via `_load_merge_commit_like`).
    """
    stage, site_profile_path = args
    if stage not in APR_STAGES:
        raise InputError("invalid-input", f"stage must be one of {APR_STAGES}, got {stage!r}")
    workspace = Path(workspace)
    site_profile = _read_plain(site_profile_path)
    task = _read_plain(_apr_task_path(workspace, stage))
    for key in ("tcl", "taskId"):
        if not task.get(key):
            raise InputError("invalid-input", f"apr task is missing {key!r}")
    task_id = adapters.validate_path_segment(task["taskId"], "apr task.taskId")
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")

    output_root = workspace / "apr" / stage / task_id
    output_root.mkdir(parents=True, exist_ok=True)
    stage_tcl_path = output_root / "apr-stage.tcl"
    stage_tcl_path.write_text(task["tcl"], encoding="utf-8")
    stage_log_path = output_root / "apr-stage.log"
    adapters.run_tool(
        site_profile,
        ["innovus", "-batch", "-files", str(stage_tcl_path), "-log", str(stage_log_path),
         "-overwrite", "-64", "-nowin"],
        cwd=workspace, log_path=stage_log_path,
    )

    stage_db = output_root / "DBS" / f"{stage}.enc"
    if not stage_db.is_file():
        raise adapters.AdapterToolError(f"APR stage produced no database: {stage_db}", stage_log_path)

    export_task = adapters.compile_innovus_export_task(str(stage_db), working_state["top"], str(output_root))
    export_tcl_path = output_root / "innovus-export.tcl"
    export_tcl_path.write_text(export_task["tcl"], encoding="utf-8")
    export_log_path = output_root / "innovus-export.log"
    adapters.run_tool(
        site_profile,
        export_task["command"] + [str(export_tcl_path), "-log", str(export_log_path), "-overwrite", "-64", "-nowin"],
        cwd=output_root, log_path=export_log_path,
    )
    for name, path in export_task["outputs"].items():
        if not Path(path).is_file():
            raise adapters.AdapterToolError(f"expected APR export output missing: {name}={path}", export_log_path)

    database_ref = {
        "path": _relpath(stage_db, workspace), "sha256": core.file_sha256(stage_db),
        "datDigest": core.tree_digest(str(stage_db) + ".dat"),
    }
    netlist_ref = {
        "path": _relpath(export_task["outputs"]["netlist"], workspace),
        "sha256": core.file_sha256(export_task["outputs"]["netlist"]),
    }
    def_ref = {
        "path": _relpath(export_task["outputs"]["def"], workspace),
        "sha256": core.file_sha256(export_task["outputs"]["def"]),
    }
    body = {
        "mergeCommitId": task_id, "design": working_state["top"], "parentStateId": working_state["id"],
        "database": database_ref, "netlist": netlist_ref, "def": def_ref,
        "drcReport": {
            "path": _relpath(export_task["outputs"]["drc"], workspace),
            "sha256": core.file_sha256(export_task["outputs"]["drc"]),
        },
        "connectivityReport": {
            "path": _relpath(export_task["outputs"]["connectivity"], workspace),
            "sha256": core.file_sha256(export_task["outputs"]["connectivity"]),
        },
    }
    return _paths(workspace)["implement"], body


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
    "apr-run": _cmd_apr_run,
    "record-experience": _cmd_record_experience,
    "policy": _cmd_policy,
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
