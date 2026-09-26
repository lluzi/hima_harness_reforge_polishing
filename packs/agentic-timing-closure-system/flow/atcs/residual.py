"""Residual Case extraction: turn unclosed checks into evidence-backed cases.

This module owns the single producer named in this Pack's task brief
(``.superpowers/sdd/task-10-brief.md``) and the ``residual-case`` row of
``.superpowers/sdd/global-context.md``'s "Shared data model" table:

- `extract(evaluation, observation, exp, readiness)` -> `list` of
  ``residual-case`` artifacts, one per check that a Plan-fix attempt failed
  to close.

A Residual Case is built only for a check that is confirmed, by the most
recent re-observation, to still be a violation after this candidate's
Compose/Implement cycle — i.e. a check key present in
`evaluation["comparison"]["remaining"]` (produced by
`atcs.state.compare_checks` / `atcs.verification.assemble`: negative before,
still negative now) *and* whose slack in `observation["checks"]` is a known
(not `unknown`) Measure. A `remaining` key whose current slack cannot
actually be confirmed known is a coverage problem (we do not really know
this check is still violating), never fabricated into a residual case —
per this task's Decisions: "a check with only unknown slack produces no
residual (it is a coverage problem, not a residual)". Checks in
`evaluation["comparison"]`'s other buckets (`fixed`, `entrant`, `regressed`,
`missingPrior`) are out of scope for this extraction: `fixed` needs no
case, and `entrant`/`regressed`/`missingPrior` are new or lost information
about *this* candidate, not evidence that this specific pre-existing
violation could not be closed.

This task builds exactly one ``residual-case`` per qualifying check key
(`"checks": [checkKey]`); it does not group checks sharing a root cause
into a single case (``knowledge/mechanisms-and-falsifiers.md``: "先按根因
和影响关系分组，不按 worst slack 排队"). That grouping needs shared-driver/
shared-clock/topology analysis this module's inputs do not carry, and is
left to a later task/Workshop that can read the design's connectivity —
this task only guarantees each unclosed check gets an honest, individually
evidence-backed case, never a fabricated cross-check merge.

``observation["checkDetails"]`` shape (binding for `extract`)
-------------------------------------------------------------

Per this task's Decisions, residual evidence comes from an **optional**
per-check detail map the PT query adapter may add to an ``observation-set``
alongside its required `checks`/`scenarios` fields::

    observation["checkDetails"] = {
        "<checkKey>": {
            "cellDelay": <Measure>,   # total cell (gate) delay along the path, ns
            "netDelay": <Measure>,    # total net/interconnect delay along the path, ns
            "slew": <Measure>,        # worst transition time observed on the path, ns
            "fanout": <Measure>,      # driver fanout at the path's dominant net
            "location": <Measure>,    # a value identifying where on the floorplan
                                      # this path's evidence was taken (e.g. an
                                      # instance name or {"x":.., "y":..} — this
                                      # Pack does not constrain the value's shape
                                      # beyond it being a Measure), for later
                                      # spatial/density analysis
        },
        ...
    }

`checkDetails` itself may be absent entirely, or present but missing an
entry for a particular check key, or present with an entry missing one of
the five fields above — every one of those is treated identically: the
missing evidence field(s) become `core.unknown("no path detail observed")`,
**never** guessed from the check's slack or from any other check's detail.
`EVIDENCE_FIELDS` lists the five field names this module reads.

`suggestedStage` / `requiredInputs`
------------------------------------

Per this task's Decisions and ``knowledge/lifecycle-and-input-modes.md``
("post-route-only 出现无法本地解决的 Residual Case 时...不能在该 Run 中偷偷
转 APR"):

- `readiness["scope"] == "post-route-only"` -> `suggestedStage` is always
  `None`, and `requiredInputs` is `readiness["lifecycleMissing"]` verbatim
  — naming exactly the lifecycle items that would need to become available
  before an earlier-APR suggestion could even be considered. No earlier
  stage is ever suggested outside `"full-flow"`, regardless of how
  compelling a case's evidence looks.
- `readiness["scope"] == "full-flow"` -> `requiredInputs` is `[]` (the
  lifecycle is already available), and `suggestedStage` is one of
  `"route"` or `"postroute"` (`"cts"`/`"place"` are valid values of this
  field per the Pack's data model, but this task's evidence set —
  `cellDelay`/`netDelay`/`slew`/`fanout`/`location` — only supports a
  defensible signal for one specific, named mechanism:
  net-delay-dominated failures, which `lifecycle-and-input-modes.md` maps
  to "routing 层/绕行问题优先从 pre-route/CTS 状态重启". A clock-structure
  or placement/density mechanism would need clock-topology or
  density/capacity evidence this module is not given, so this task never
  guesses `"cts"`/`"place"` from evidence it does not have):

  - `netDelay` and `cellDelay` both known and `netDelay > cellDelay` (the
    path's delay is dominated by interconnect/routing, not gate drive) ->
    `"route"`.
  - Otherwise -> `"postroute"` (not enough mechanism evidence to justify an
    earlier restart than the current post-route stage; the case still
    stands, but as a local, current-stage residual rather than an
    earlier-APR candidate).

`attempts` / `limits`
------------------------

`attempts` lists the `decisionId`s of `exp`'s recorded experience entries
that share this check's scenario (parsed from the check key's own
`"<scenario>|<mode>|<endpoint>"` structure via `core.check_key`'s inverse)
and `observation["precision"]` — i.e. "what has already been tried under
directly comparable conditions". This module does not have access to a
design-state, so it cannot narrow by `stage`/`toolVersion` the way
`atcs.experience.applicable` does; this is a deliberate, narrower match
than `applicable`'s four-key exact match, not a relaxation of it (a future
caller with a design-state in hand should re-filter `attempts` through
`atcs.experience.applicable` for the full four-key match before treating
them as truly comparable).

`limits` lists one human-readable string per evidence field that came back
`unknown` (`"<field> unknown: <reason>"`) — an honest statement of what is
missing, never a claim that the mechanism space has been exhausted
(``knowledge/mechanisms-and-falsifiers.md``: "不能证明'无论如何都无法
fix'，只能证明'当前动作、状态和预算范围内不再有值得支付成本的修复路径'").
"""
from __future__ import annotations

from . import core


EVIDENCE_FIELDS = ("cellDelay", "netDelay", "slew", "fanout", "location")
NO_DETAIL_REASON = "no path detail observed"


def _require(mapping, key, label):
    """Return `mapping[key]`, or raise `AtcsError("missing-input", ...)` if absent."""
    if key not in mapping:
        raise core.AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def _evidence_for(check_detail):
    detail = check_detail or {}
    return {
        field: detail[field] if field in detail else core.unknown(NO_DETAIL_REASON)
        for field in EVIDENCE_FIELDS
    }


def _suggested_stage(evidence):
    net_delay = evidence["netDelay"]
    cell_delay = evidence["cellDelay"]
    if core.is_known(net_delay) and core.is_known(cell_delay):
        if core.value_of(net_delay) > core.value_of(cell_delay):
            return "route"
    return "postroute"


def _attempts_for(key, precision, exp):
    scenario = key.split("|", 2)[0]
    attempts = []
    for entry in exp.get("entries", []):
        conditions = entry.get("conditions", {})
        if conditions.get("precision") != precision:
            continue
        entry_scenario = conditions.get("scenario")
        if entry_scenario != scenario and entry_scenario != "*":
            continue
        attempts.append(entry.get("decisionId"))
    return attempts


def _limits_for(evidence):
    limits = []
    for field in EVIDENCE_FIELDS:
        measure = evidence[field]
        if not core.is_known(measure):
            reason = measure.get("unknown", "") if isinstance(measure, dict) else ""
            limits.append(f"{field} unknown: {reason}")
    return limits


def extract(evaluation, observation, exp, readiness):
    """Build one ``residual-case`` per still-unclosed check (see module docstring)."""
    comparison = _require(evaluation, "comparison", "evaluation")
    remaining_keys = _require(comparison, "remaining", "evaluation.comparison")

    checks = _require(observation, "checks", "observation")
    precision = _require(observation, "precision", "observation")
    check_details = observation.get("checkDetails", {})

    scope = _require(readiness, "scope", "readiness")
    lifecycle_missing = readiness.get("lifecycleMissing", [])

    cases = []
    for key in remaining_keys:
        check_entry = checks.get(key)
        if check_entry is None:
            # `remaining` named a check the current observation cannot even
            # locate: a coverage gap, not a confirmed still-open violation.
            continue
        slack = check_entry.get("slack")
        if not core.is_known(slack):
            # Slack could not actually be re-confirmed: a coverage problem,
            # not a residual (see this task's Decisions).
            continue

        evidence = _evidence_for(check_details.get(key))

        if scope == "post-route-only":
            suggested_stage = None
            required_inputs = list(lifecycle_missing)
        else:
            suggested_stage = _suggested_stage(evidence)
            required_inputs = []

        case = {
            "checks": [key],
            "evidence": evidence,
            "attempts": _attempts_for(key, precision, exp),
            "limits": _limits_for(evidence),
            "suggestedStage": suggested_stage,
            "requiredInputs": required_inputs,
        }
        cases.append(core.stamp("residual-case", case))

    return cases
