"""M2: work-package validation and private, idempotent worker workspaces.

This module owns the two M2 producers named in
``.superpowers/sdd/global-context.md``'s "Shared data model" table:
`validate_work_package` (stamps a caller-supplied plan into a
``work-package`` artifact, or refuses it) and `prepare` (allocates a
private, per-revision write root for a research worker and stamps a
``workspace-manifest`` artifact describing it). `request_invalid_count`
is a non-raising sibling of `validate_work_package` for the
`tc_request_invalid_count` typed value.

`ACTION_KINDS` — the closed set of operation kinds a work package's
``actions`` list may draw from — is defined here (this is its producing
module per the task brief) and re-used by later modules (M3's
``operation``/``contribution`` artifacts).

Work-package validation
------------------------

`validate_work_package(obj, base_state, site_capabilities)` checks `obj`
(a plain dict shaped like the ``work-package`` row of the shared data
model) against `base_state` (a ``design-state``-shaped dict — only its
`id` is used) and `site_capabilities` (a plain dict; only the boolean
`pgVerification` key matters here, defaulting to `False` when absent).
Every problem found is collected — never just the first — and reported at
once as a single `AtcsError("invalid-work-package", "<problem 1>; <problem
2>; ...")`; a package with no problems is stamped (`core.stamp`) and
returned as a ``work-package`` artifact body. Checks performed:

- `taskId` must be one of `TASK_IDS` (`"w01"` .. `"w06"` — the six
  bounded worker slots, Issue #64).
- `baseStateId` must equal `base_state["id"]`.
- Every entry of `actions` must be one of `ACTION_KINDS`.
- `"pg_local_adjust"` in `actions` is only admissible when
  `site_capabilities.get("pgVerification", False)` is true.
- No `editDomain` instance or net may also appear in `protected` (a worker
  is never allowed to plan edits against something the package itself
  declares off-limits).
- `problem`, `targets`, `editDomain`, `protected`, `mayAffect`, `actions`,
  `budget`, `targetPins` and `scope` must all be present (a missing key is
  `"missing field: <key>"`, not a raw `KeyError`, per this Pack's
  fail-closed rule for Site/plan-supplied evidence).

Expert Operator fields (Issue #64 Task 4)
-----------------------------------------

The slot's XTop expert Operator session (`flow/templates/xtop-operator.tcl`)
is bound by four more fields, all baked into the session Tcl by
`prepare-workers` (`adapters.compile_xtop_analysis_manual_task`):

- `scope` is exactly ``{"commands": [...], "maxMutations": n}``. `commands`
  is a non-empty list of distinct names from `MUTATE_COMMANDS` (the Task 3
  toolkit's mutations, the same list as `contract.yml`
  `xtop-operator.interactive.commands.mutate`) and must keep `atcs_undo`,
  because the expert loop undoes every trial XTop's gain does not support.
  It is the widest set the slot's Reviewer should approve from.
  `maxMutations` must equal `SCOPE_MAX_MUTATIONS`, the worker Teams' recipe
  cap: it becomes the session's Tcl-side budget (`::ATCS_MAX_MUTATIONS`),
  which only backs the Host. The budget that binds is the Reviewer's approved
  `scope.maxMutations` (1..recipe cap), which the Host counts per approved
  execution; a Tcl budget below it would refuse mutations the Reviewer
  approved, one above it could never be reached.
- `targetPins` is a list of distinct full hierarchical pin paths
  (``<instance path>/<pin>``, no wildcard, Tcl-safe): the blockers' endpoint
  pins, the only pins besides domain-instance pins a targeted fix may name.
  The worker-request Reader resolves each owner against the base netlist.
- `observe` is optional, one of `OBSERVE_MODES` (default `fast`).
- `editDomain.regions` is a list of ``[x1, y1, x2, y2]`` boxes of finite
  numbers with ``x1 <= x2`` and ``y1 <= y2``: the only targets of
  `atcs_move_cell`.

`request_invalid_count(obj, base_state, site_capabilities)` runs the exact
same checks and returns how many problems were found (`0` only when
validation completed and found none). It never raises for invalid
*content* — only `validate_work_package` turns problems into a refusal —
so a Reader can report `tc_request_invalid_count` without a try/except.

Worker workspaces
------------------

`prepare(work_package, campaign_root, base_state)` allocates a private
write root for one research worker under
``<campaign_root>/workspaces/<taskId>/r<revision>/`` and writes a
``workspace-manifest`` artifact to ``manifest.json`` inside it (also
returning the same dict). `work_package` is expected to already be the
stamped output of `validate_work_package` (only its `id`, `taskId` and
`baseStateId` fields are read here; the rest of `validate_work_package`'s
checks are not repeated). `base_state` supplies the read-only base sources
recorded in the manifest — `prepare` never copies or symlinks any base
file into the write root, it only records each source's campaign-relative
`path` and `sha256` (from `base_state`'s `database`, `netlist`, `def`,
`spef` and `sdc` entries) so a worker's tools can be pointed at the shared
read-only base state directly.

Revision allocation is idempotent and race-safe:

- `taskId` is restricted to `TASK_IDS` *before* any path is built, so a
  hostile or malformed `taskId` (e.g. containing `".."`) can never make the
  computed root escape `campaign_root` — the only paths ever constructed
  are `<campaign_root>/workspaces/w0{1..6}/r<int>/`.
- Revisions are allocated by trying `r1`, `r2`, ... in order and creating
  each candidate directory with a bare `Path.mkdir()` (no `exist_ok`),
  which is an atomic, OS-level create: if two threads race for the same
  revision, exactly one `mkdir()` succeeds and the other raises
  `FileExistsError`, so two callers can never receive the same revision
  for the same `taskId`.
- When `mkdir()` loses that race (or the revision was already prepared in
  an earlier call), the existing directory's `manifest.json` is read back.
  If its `workPackageId` matches the package being prepared, that manifest
  is returned as-is — no new directory is created, and repeated `prepare`
  calls for the same work package are therefore idempotent recovery, not
  duplication. If it belongs to a different work package, the next
  revision is tried instead.

`namePrefix` (`atcs_<taskId>_r<revision>_`) is the prefix a worker must use
for every name it introduces (new instances, new nets) so that two
concurrent workers' contributions can never collide by name even before
M3 reconciles them.
"""
from __future__ import annotations

import math
import time
from pathlib import Path

from . import core


ACTION_KINDS = ("size_cell", "insert_buffer", "delete_buffer", "pg_local_adjust")

TASK_IDS = ("w01", "w02", "w03", "w04", "w05", "w06")

MUTATE_COMMANDS = (
    "atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load",
    "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins",
    "atcs_undo",
)
"""The Task 3 toolkit's mutation procedures, in `contract.yml` order."""

SCOPE_MAX_MUTATIONS = 120
"""The worker Teams' recipe cap (`reviewedAction.maxMutations`) and every session's Tcl-side budget.

An expert loop needs dozens of trials and each `atcs_undo` counts, so 120
leaves room for about 60 trials each followed by its undo; it stays below
the Harness ceiling of 200 so a runaway loop still stops.
"""

OBSERVE_MODES = ("fast", "full")

_MANIFEST_WAIT_ATTEMPTS = 50
_MANIFEST_WAIT_INTERVAL_SECONDS = 0.01

_REQUIRED_WORK_PACKAGE_FIELDS = (
    "problem",
    "targets",
    "editDomain",
    "protected",
    "mayAffect",
    "actions",
    "budget",
    "targetPins",
    "scope",
)


def _is_safe_name(name):
    return (isinstance(name, str) and bool(name) and not core.is_tcl_unsafe(name, allow_brackets=True)
            and "*" not in name and "?" not in name)


def _expert_problems(obj):
    """Problems in the expert Operator fields `scope`, `targetPins`, `observe` and `editDomain.regions`."""
    problems = []
    if "scope" in obj:
        scope = obj["scope"]
        if not isinstance(scope, dict) or set(scope) != {"commands", "maxMutations"}:
            problems.append("scope must be an object with exactly commands and maxMutations")
        else:
            commands = scope["commands"]
            if not isinstance(commands, list) or not commands:
                problems.append("scope.commands must be a non-empty list")
            else:
                for command in commands:
                    if command not in MUTATE_COMMANDS:
                        problems.append(f"scope command {command!r} is not a toolkit mutation {MUTATE_COMMANDS}")
                if len(set(map(repr, commands))) != len(commands):
                    problems.append("scope.commands names a command more than once")
                if "atcs_undo" not in commands:
                    problems.append("scope.commands must keep atcs_undo: the expert loop undoes every trial without gain")
            budget = scope["maxMutations"]
            if isinstance(budget, bool) or not isinstance(budget, int) or budget != SCOPE_MAX_MUTATIONS:
                problems.append(
                    f"scope.maxMutations must be the recipe cap {SCOPE_MAX_MUTATIONS} (the Reviewer's budget binds), "
                    f"got {budget!r}"
                )
    if "targetPins" in obj:
        pins = obj["targetPins"]
        if not isinstance(pins, list):
            problems.append("targetPins must be a list")
        else:
            for pin in pins:
                if not _is_safe_name(pin) or "/" not in pin or pin.startswith("/") or pin.endswith("/"):
                    problems.append(f"targetPin {pin!r} is not a safe <instance path>/<pin> name")
            if len(set(map(repr, pins))) != len(pins):
                problems.append("targetPins names a pin more than once")
    if "observe" in obj and obj["observe"] not in OBSERVE_MODES:
        problems.append(f"observe must be one of {OBSERVE_MODES}, got {obj['observe']!r}")
    edit_domain = obj.get("editDomain")
    if isinstance(edit_domain, dict) and "regions" in edit_domain:
        regions = edit_domain["regions"]
        if not isinstance(regions, list):
            problems.append("editDomain.regions must be a list of [x1, y1, x2, y2] boxes")
        else:
            for region in regions:
                if (not isinstance(region, list) or len(region) != 4
                        or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                               for v in region)
                        or region[0] > region[2] or region[1] > region[3]):
                    problems.append(f"editDomain region {region!r} is not [x1, y1, x2, y2] with x1<=x2, y1<=y2")
    return problems


def _collect_problems(obj, base_state, site_capabilities):
    """Return every `work-package` validation problem found in `obj` (never raises)."""
    problems = []
    obj = obj if isinstance(obj, dict) else {}
    site_capabilities = site_capabilities if isinstance(site_capabilities, dict) else {}
    pg_verification = bool(site_capabilities.get("pgVerification", False))

    for key in _REQUIRED_WORK_PACKAGE_FIELDS:
        if key not in obj:
            problems.append(f"missing field: {key}")

    task_id = obj.get("taskId")
    if task_id not in TASK_IDS:
        problems.append(f"taskId must be one of {TASK_IDS}, got {task_id!r}")

    if "baseStateId" not in obj:
        problems.append("missing field: baseStateId")
    else:
        base_state_id = base_state.get("id") if isinstance(base_state, dict) else None
        work_base_state_id = obj["baseStateId"]
        if work_base_state_id != base_state_id:
            problems.append(
                f"baseStateId {work_base_state_id!r} does not match base state id {base_state_id!r}"
            )

    edit_domain = obj.get("editDomain") if isinstance(obj.get("editDomain"), dict) else {}
    protected = obj.get("protected") if isinstance(obj.get("protected"), dict) else {}
    edit_instances = set(edit_domain.get("instances") or [])
    edit_nets = set(edit_domain.get("nets") or [])
    protected_instances = set(protected.get("instances") or [])
    protected_nets = set(protected.get("nets") or [])

    for instance in sorted(edit_instances & protected_instances):
        problems.append(f"editDomain instance {instance!r} is protected")
    for net in sorted(edit_nets & protected_nets):
        problems.append(f"editDomain net {net!r} is protected")

    # I7 (final review): a Reader must never admit a name the emitters
    # (`atcs.integration.xtop_tcl`/`_innovus_eco_line`, `atcs.adapters.tcl_safe`)
    # would themselves refuse at replay/capture time -- checked here with the
    # exact same rule those emitters apply once a value is wrapped in a Tcl
    # brace group (`allow_brackets=True`; a bus-bit name like `bus[3]` is fine),
    # so a work package this call admits can never later fail deep in `replay-
    # prepare`/`capture-contribution` on a name shape this Reader should have
    # caught up front.
    for kind, names in (("instance", edit_instances), ("net", edit_nets)):
        for name in sorted(names):
            if (not isinstance(name, str) or not name or core.is_tcl_unsafe(name, allow_brackets=True)
                    or "*" in name or "?" in name):
                problems.append(f"editDomain {kind} {name!r} is not a safe Tcl name")

    actions = obj.get("actions") if isinstance(obj.get("actions"), list) else []
    for action in actions:
        if action not in ACTION_KINDS:
            problems.append(f"action {action!r} is not one of ACTION_KINDS {ACTION_KINDS}")
    if "pg_local_adjust" in actions and not pg_verification:
        problems.append("action pg_local_adjust requires siteCapabilities.pgVerification")

    problems.extend(_expert_problems(obj))
    return problems


def validate_work_package(obj, base_state, site_capabilities):
    """Validate `obj` as a `work-package`; stamp and return it, or refuse it.

    Raises `AtcsError("invalid-work-package", "<problem>; <problem>; ...")`
    listing every problem found (see module docstring for the full list of
    checks). Returns `core.stamp("work-package", obj)` when there are none.
    """
    problems = _collect_problems(obj, base_state, site_capabilities)
    if problems:
        raise core.AtcsError("invalid-work-package", "; ".join(problems))
    return core.stamp("work-package", obj)


def request_invalid_count(obj, base_state, site_capabilities):
    """Count of `validate_work_package` problems in `obj`; never raises for invalid content."""
    return len(_collect_problems(obj, base_state, site_capabilities))


def _base_sources(base_state):
    """Flatten a `design-state`-shaped `base_state` into a list of `{"path","sha256"}` sources.

    Only records references (campaign-relative path + sha256 already bound
    by M1) — never reads or copies the underlying files.
    """
    base_state = base_state if isinstance(base_state, dict) else {}
    sources = []

    database = base_state.get("database") or {}
    if database.get("path") is not None:
        sources.append({"path": database["path"], "sha256": database.get("sha256")})

    netlist = base_state.get("netlist") or {}
    if netlist.get("path") is not None:
        sources.append({"path": netlist["path"], "sha256": netlist.get("sha256")})

    def_entry = base_state.get("def")
    if def_entry:
        sources.append({"path": def_entry["path"], "sha256": def_entry.get("sha256")})

    for _corner, entry in sorted((base_state.get("spef") or {}).items()):
        sources.append({"path": entry["path"], "sha256": entry.get("sha256")})

    for entry in base_state.get("sdc") or []:
        sources.append({"path": entry["path"], "sha256": entry.get("sha256")})

    return sources


def _read_manifest_if_matching(manifest_path, work_package_id):
    """Read `manifest_path` (waiting briefly for a concurrent writer to finish it).

    Returns the manifest dict when it belongs to `work_package_id`, `None`
    when it belongs to a different work package. Returns `None` (rather
    than raising) if the file never appears within the wait budget, so the
    caller falls through to trying the next revision.
    """
    for _attempt in range(_MANIFEST_WAIT_ATTEMPTS):
        if manifest_path.exists():
            manifest = core.read_artifact(manifest_path, "workspace-manifest")
            return manifest if manifest.get("workPackageId") == work_package_id else None
        time.sleep(_MANIFEST_WAIT_INTERVAL_SECONDS)
    return None


def prepare(work_package, campaign_root, base_state):
    """Allocate (or recover) this work package's private workspace; return its manifest.

    See module docstring for the full idempotency/concurrency contract.
    """
    task_id = core.require(work_package, "taskId", "work_package")
    work_package_id = core.require(work_package, "id", "work_package")
    base_state_id = core.require(work_package, "baseStateId", "work_package")

    if task_id not in TASK_IDS:
        # TASK_IDS is checked before any path is built: this is what keeps a
        # hostile taskId (e.g. containing "..") from ever making the
        # computed root escape campaign_root below.
        raise core.AtcsError(
            "invalid-work-package", f"taskId must be one of {TASK_IDS}, got {task_id!r}"
        )

    campaign_root_path = Path(campaign_root).resolve()
    task_dir = campaign_root_path / "workspaces" / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    revision = 1
    while True:
        candidate_root = task_dir / f"r{revision}"
        try:
            candidate_root.mkdir()
        except FileExistsError:
            existing = _read_manifest_if_matching(candidate_root / "manifest.json", work_package_id)
            if existing is not None:
                return existing
            revision += 1
            continue
        break

    manifest_body = {
        "workPackageId": work_package_id,
        "taskId": task_id,
        "revision": revision,
        "root": f"workspaces/{task_id}/r{revision}/",
        "readOnly": _base_sources(base_state),
        "namePrefix": f"atcs_{task_id}_r{revision}_",
        "recovery": {"checkpoint": None},
        "baseStateId": base_state_id,
    }
    manifest = core.stamp("workspace-manifest", manifest_body)
    core.write_artifact(candidate_root / "manifest.json", manifest)
    return manifest
