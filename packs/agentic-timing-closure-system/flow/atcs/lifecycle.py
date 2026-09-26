"""T11: residual-driven APR stage intervention and stage task.

This module owns the two producers named in this Pack's task brief
(``.superpowers/sdd/task-11-brief.md``):

- `compile_intervention(residual_cases, stage, readiness)` -> a bounded
  Innovus stage intervention: ``{"stage", "hookTcl", "readbackTcl",
  "expected", "outputs"}``. `outputs` lists every workspace-relative path
  (relative to the eventual `apr/<stage>/<id>/` output directory, e.g.
  ``"./RPT/fplan_<name>.tcl"``) that the compiled hook/readback itself
  writes beyond the two `stage_task` always declares (the new checkpoint
  and the shared `readback.rpt`) — currently only the placement-blockage
  kind's `writeFPlanScript` dump. `stage_task` uses this list directly
  (prefixing each entry with the workspace root and output directory) —
  it never re-derives these paths by scanning `readbackTcl` text.
- `stage_task(stage, readiness, intervention, workspace_root)` -> a single
  APR stage Harness task: ``{"tcl", "inputs[]", "outputs[]"}``.

Neither return shape is a row of ``.superpowers/sdd/global-context.md``'s
"Shared data model" table (that table has no `apr-intervention`/`apr-stage-
task` kind); both are plain dicts, not `core.stamp`-ed artifacts.

Full-flow only
---------------

Per ``knowledge/lifecycle-and-input-modes.md`` ("post-route-only 出现无法
本地解决的 Residual Case 时...不能在该 Run 中偷偷转 APR"), both producers
refuse outright, with `AtcsError("lifecycle-unavailable", ...)`, whenever
``readiness["scope"] != "full-flow"`` — for *any* requested `stage`, even
one that would otherwise be a name recognized by `STAGE_ORDER`. This module
never reconstructs an unprovided early state and never partially opens
lifecycle intervention because a single checkpoint happens to be present;
`readiness["scope"]` (`atcs.state.input_readiness`'s own binding judgment)
is the only switch consulted.

Stage order and refusal
-------------------------

`STAGE_ORDER = ("init", "place", "cts", "route", "postroute")`. Running
stage S restores the checkpoint of the stage immediately before S in this
order (`place` restores `init`'s checkpoint, `cts` restores `place`'s,
etc.) — never any other stage's checkpoint, and never an assembled/guessed
state. `init` cannot be re-run by this module (there is no stage before it
to restore from), so both producers raise `AtcsError("unsupported-stage",
stage)` for `stage == "init"` and for any `stage` name outside
`STAGE_ORDER` — this is the "stage not in the verified lifecycle" refusal.
The scope check always runs first: a `post-route-only` readiness yields
`lifecycle-unavailable` even for a nonsense `stage` value, never
`unsupported-stage` for that call.

Evidence -> intervention-kind mapping (`compile_intervention`)
------------------------------------------------------------------

Per this task's Decisions, the compiler maps each `residual-case`'s
`evidence` (`atcs.residual`'s five fields: `cellDelay`, `netDelay`, `slew`,
`fanout`, `location`) to *at most* the three intervention kinds this task
is scoped to — never `setAttribute -weight`, which
``knowledge/innovus-stage-interventions.md`` documents as internally
contradictory in the vendor's own text and therefore excluded outright:

- **Path-group effort** (`setPathGroupOptions`) — `netDelay` and
  `cellDelay` both known and `netDelay > cellDelay`: the same
  interconnect-dominated signal `atcs.residual._suggested_stage` uses to
  suggest an earlier restart at `"route"`. This module does not carry a
  path-group *name* forward from observation into `residual-case` (that
  shape has no such field), so it targets Innovus's own default `"reg2reg"`
  path group — the standard register-to-register group `createBasicPathGroups`
  establishes in a stock Innovus flow (confirmed via
  `reportPathGroupOptions`'s own vendor-doc example) — rather than
  fabricating a per-check group name it was never given. This is a
  disclosed, generic target, not a "default setting" in the sense this
  task's Decisions forbid: whether to intervene *at all* still depends
  entirely on known evidence; only the group name choice, once evidence
  justifies intervening, is a documented convention.
- **Useful skew** (`setUsefulSkewMode`, `set_ccopt_property`) — `slew` and
  `cellDelay` both known, and the path-group condition above does *not*
  already hold (net-delay-dominated and cell/transition-dominated are
  treated as distinct, non-overlapping mechanisms for a single case, so a
  case never gets contradictory recommendations). Both commands reuse the
  case's own observed `slew` value (ns) as the numeric bound/target — the
  only ns-scaled evidence this task has for the mechanism it addresses —
  rather than an invented constant.
- **Cell padding / placement blockage** (`createPlaceBlockage`) — `fanout`
  and `location` both known, and `location`'s value is a non-empty plain
  string (an instance name, per `atcs.residual`'s own documented "e.g. an
  instance name" shape for this Measure). A `location` value of any other
  shape (a coordinate object, for instance) contributes no setting for this
  kind: this module cannot safely turn an arbitrary `location` shape into
  `createPlaceBlockage -inst` input, and does not guess. `specifyCellPad`
  (the other command named for this intervention kind) needs a *leaf cell
  (library master) name*, which no evidence field here carries, so this
  module never emits it — only `createPlaceBlockage -inst ... -type
  partial` (the least aggressive blockage type, matching the source
  playbook's own "partial blockage" wording for this stage).

Whenever a needed evidence field is `unknown`, the corresponding kind
contributes *no* setting at all for that case — never a default or
fallback setting (this task's Decisions, and the fail-closed rule general
to this Pack). If, across every case, not a single kind ever contributes a
setting, `compile_intervention` raises `AtcsError("no-intervention")`
rather than returning an empty-but-successful result.

Injection safety (`_validate_token`)
---------------------------------------

Every individual leaf value this module plugs into a generated Tcl line —
an evidence-derived string (e.g. `location`), a formatted number, a stage
name, a workspace-relative path — passes through `_validate_token`, which
rejects a newline, `;`, `[`, `]`, or an empty string with
`AtcsError("invalid-value", ...)`. `residual-case` evidence is Site/tool
output this module does not otherwise trust, so an instance name that
happens to look like `"U_DRV; exec rm -rf /"` is refused outright rather
than spliced into a generated command.

This module's *own* authored constants — `PATH_GROUP_NAME`,
`PATH_GROUP_EFFORT`, `BLOCKAGE_TYPE`, the entries of `STAGE_COMMANDS` —
are literal Python string constants this module defines, not data read
from a `residual-case` or any other external input, so they are not passed
through `_validate_token`: there is no untrusted value there to validate,
only source code a reviewer can already read. `_validate_token` exists
specifically to gate values that arrived from outside this module's own
source (evidence fields, `stage`/`workspace_root` parameters, and the
derived paths built from them).

The two *composed* multi-line blocks this module builds from those already
-validated leaves — `hookTcl` and `readbackTcl` — are true multi-statement
Tcl content by construction (that is their entire purpose) and are
therefore not themselves re-checked against the single-line rule when
`stage_task` embeds them in the ``apr-stage.tcl`` template: every character
in them was already vetted at the leaf level, and the command text around
those leaves is authored by this module, not by data.

Restore/run/readback mechanics (`stage_task`)
------------------------------------------------

Confirmed read-only against the Foundation Flow reference this task names
(`FF/INNOVUS/run_{place,cts,route}.tcl`, `script/pre_{place,cts,route}.tcl`
on the linglong server): a stage job restores its predecessor's checkpoint
with `restoreDesign <session>` (the `<design>` argument `restoreDesign`'s
own vendor page marks optional), then runs one stage-defining command
(`place_opt_design` for `place`, `clock_opt_design` for `cts`, `routeDesign`
for `route`; `optDesign -postRoute -setup -hold` for `postroute`, per this
Pack's `OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md` §8 access-point
table), and saves a new checkpoint. `stage_task` mirrors that shape but
never touches the Foundation workspace directly: every path in the
generated Tcl is relative to wherever the job actually runs (this task's
`workspace_root`), and the very first thing the template does after
restoring is `file mkdir`+`cd` into `apr/<stage>/<id>/` (deterministic,
`core.digest`-derived `<id>`) so every subsequent relative path in the
compiled hook/readback (`./RPT/...`, `./DBS/...`) lands under that bounded
output tree, never inside the shared workspace's own top-level `DBS/`/`RPT/`.
`workspace_root` must itself be a relative (campaign-relative) path —
`AtcsError("absolute-workspace-root", ...)` otherwise — so neither the
returned `tcl` nor `inputs`/`outputs` can ever carry an absolute Foundation
path.
"""
from __future__ import annotations

from pathlib import Path
from string import Template

from . import core


STAGE_ORDER = ("init", "place", "cts", "route", "postroute")
RUNNABLE_STAGES = STAGE_ORDER[1:]

PATH_GROUP_NAME = "reg2reg"
PATH_GROUP_EFFORT = "high"
BLOCKAGE_TYPE = "partial"

STAGE_COMMANDS = {
    "place": "place_opt_design -out_dir ./RPT -prefix place -expanded_views",
    "cts": "clock_opt_design -out_dir ./RPT -prefix cts -expandedViews",
    "route": "routeDesign",
    "postroute": "optDesign -postRoute -setup -hold",
}

_TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "templates" / "apr-stage.tcl"

_INVALID_TOKEN_CHARS = ("\n", ";", "[", "]")


def _require(mapping, key, label):
    if key not in mapping:
        raise core.AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def _validate_token(value):
    """Return `value` unchanged if it is a safe single-line Tcl token, else refuse.

    Rejects an empty string and any of `_INVALID_TOKEN_CHARS`
    (`AtcsError("invalid-value", ...)`) — see module docstring "Injection
    safety".
    """
    text = str(value)
    if not text:
        raise core.AtcsError("invalid-value", "empty token")
    for bad in _INVALID_TOKEN_CHARS:
        if bad in text:
            raise core.AtcsError("invalid-value", f"{value!r} contains {bad!r}")
    return text


def _slug(text):
    return "".join(ch if (ch.isalnum() or ch in "_.-") else "_" for ch in str(text))


def _format_ns(value):
    return _validate_token(f"{value:.6f}")


def _check_scope(readiness):
    scope = _require(readiness, "scope", "readiness")
    if scope != "full-flow":
        raise core.AtcsError("lifecycle-unavailable", f"scope={scope!r}")


def _check_stage(stage):
    if stage not in RUNNABLE_STAGES:
        raise core.AtcsError("unsupported-stage", str(stage))


def _detect_path_group(check_key, evidence):
    net_delay = evidence["netDelay"]
    cell_delay = evidence["cellDelay"]
    if not (core.is_known(net_delay) and core.is_known(cell_delay)):
        return None
    if not (core.value_of(net_delay) > core.value_of(cell_delay)):
        return None

    group = _validate_token(PATH_GROUP_NAME)
    hook = f"setPathGroupOptions {group} -effortLevel {PATH_GROUP_EFFORT}"
    readback = "reportPathGroupOptions"
    expected = (
        f"{check_key}: net-delay-dominated (netDelay>cellDelay) -> raised {group} "
        f"path-group effort to {PATH_GROUP_EFFORT}; expect improved priority for "
        f"interconnect-heavy paths in this group"
    )
    return {"hook": hook, "readback": readback, "expected": expected}


def _detect_useful_skew(check_key, evidence):
    slew = evidence["slew"]
    cell_delay = evidence["cellDelay"]
    if not (core.is_known(slew) and core.is_known(cell_delay)):
        return None

    net_delay = evidence["netDelay"]
    if core.is_known(net_delay) and core.value_of(net_delay) > core.value_of(cell_delay):
        # Net-delay-dominated: the path-group mechanism already claims this
        # case; do not also assert a contradictory cell/transition mechanism.
        return None

    slew_ns = _format_ns(core.value_of(slew))
    hook = (
        f"setUsefulSkewMode -opt_skew_max_allowed_delay {slew_ns}\n"
        f"set_ccopt_property target_skew {slew_ns}"
    )
    readback = (
        "getUsefulSkewMode -opt_skew_max_allowed_delay\n"
        "get_ccopt_property target_skew"
    )
    expected = (
        f"{check_key}: cell/transition-dominated (slew={slew_ns}ns) -> bounded "
        f"useful-skew borrow and ccopt target_skew to {slew_ns}ns; expect reduced "
        f"setup/hold pressure at this endpoint"
    )
    return {"hook": hook, "readback": readback, "expected": expected}


def _detect_blockage(check_key, evidence, stage):
    fanout = evidence["fanout"]
    location = evidence["location"]
    if not (core.is_known(fanout) and core.is_known(location)):
        return None

    loc_value = core.value_of(location)
    if not isinstance(loc_value, str) or not loc_value:
        # Not a plain instance-name shape this module can safely turn into
        # `createPlaceBlockage -inst` input — no setting, never a guess.
        return None

    inst = _validate_token(loc_value)
    name = _validate_token(f"atcs_{_slug(stage)}_{_slug(check_key)}")
    hook = f"createPlaceBlockage -inst {inst} -type {BLOCKAGE_TYPE} -name {name}"
    fplan_path = f"./RPT/fplan_{name}.tcl"
    readback = f"writeFPlanScript -fileName {fplan_path} -sections {{placeBlockages}}"
    expected = (
        f"{check_key}: fanout={core.value_of(fanout)} at known location {inst} -> "
        f"{BLOCKAGE_TYPE} placement blockage named {name}; expect eased local "
        f"placement/routing resource around this instance"
    )
    return {"hook": hook, "readback": readback, "expected": expected, "output": fplan_path}


def compile_intervention(residual_cases, stage, readiness):
    """Compile `residual_cases` into a bounded stage intervention (see module docstring)."""
    _check_scope(readiness)
    _check_stage(stage)

    settings = []
    seen_hooks = set()
    for case in residual_cases:
        evidence = _require(case, "evidence", "residual-case")
        checks = _require(case, "checks", "residual-case")
        check_key = checks[0] if checks else "<unknown>"

        candidates = [
            _detect_path_group(check_key, evidence),
            _detect_useful_skew(check_key, evidence),
            _detect_blockage(check_key, evidence, stage),
        ]
        for setting in candidates:
            if setting is None:
                continue
            if setting["hook"] in seen_hooks:
                continue
            seen_hooks.add(setting["hook"])
            settings.append(setting)

    if not settings:
        raise core.AtcsError("no-intervention")

    hook_tcl = "\n".join(setting["hook"] for setting in settings) + "\n"
    readback_tcl = "\n".join(setting["readback"] for setting in settings) + "\n"
    expected = [setting["expected"] for setting in settings]
    outputs = [setting["output"] for setting in settings if setting.get("output")]

    return {
        "stage": stage,
        "hookTcl": hook_tcl,
        "readbackTcl": readback_tcl,
        "expected": expected,
        "outputs": outputs,
    }


def stage_task(stage, readiness, intervention, workspace_root):
    """Build a single APR stage task that restores `stage`'s predecessor checkpoint.

    See module docstring "Restore/run/readback mechanics".
    """
    _check_scope(readiness)
    _check_stage(stage)

    intervention_stage = _require(intervention, "stage", "intervention")
    if intervention_stage != stage:
        raise core.AtcsError("stage-mismatch", f"intervention is for {intervention_stage!r}, task is for {stage!r}")
    hook_tcl = _require(intervention, "hookTcl", "intervention")
    readback_tcl = _require(intervention, "readbackTcl", "intervention")
    declared_outputs = _require(intervention, "outputs", "intervention")

    workspace_root = str(workspace_root)
    if not workspace_root or workspace_root.startswith("/"):
        raise core.AtcsError("absolute-workspace-root", workspace_root)
    workspace_root = _validate_token(workspace_root)

    prev_stage = STAGE_ORDER[STAGE_ORDER.index(stage) - 1]
    checkpoint = _validate_token(f"./DBS/{prev_stage}.enc.dat")

    task_id = core.digest({"stage": stage, "hookTcl": hook_tcl, "readbackTcl": readback_tcl})
    output_rel = _validate_token(f"apr/{stage}/{task_id}")
    stage_command = _validate_token(STAGE_COMMANDS[stage])

    template_text = _TEMPLATE_PATH.read_text(encoding="utf-8")
    tcl = Template(template_text).substitute(
        PREV_STAGE=_validate_token(prev_stage),
        STAGE=_validate_token(stage),
        CHECKPOINT=checkpoint,
        OUTPUT_DIR=output_rel,
        STAGE_COMMAND=stage_command,
        HOOK_TCL=hook_tcl,
        READBACK_TCL=readback_tcl,
    )

    inputs = [f"{workspace_root}/DBS/{prev_stage}.enc.dat"]
    outputs = [
        f"{workspace_root}/{output_rel}/DBS/{stage}.enc.dat",
        f"{workspace_root}/{output_rel}/RPT/readback.rpt",
    ]
    for declared in declared_outputs:
        rel = declared[2:] if declared.startswith("./") else declared
        outputs.append(f"{workspace_root}/{output_rel}/{rel}")

    return {"tcl": tcl, "inputs": inputs, "outputs": outputs}
