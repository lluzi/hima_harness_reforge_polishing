"""M8: append-only, condition-scoped experience ledger.

This module owns the single M8 producer named in this Pack's task brief
(``.superpowers/sdd/task-10-brief.md``) and the ``experience`` row of
``.superpowers/sdd/global-context.md``'s "Shared data model" table:

- `record(path, lineage, decision, outcome)` -> ``experience`` — appends one
  new entry to the ledger artifact stored at `path` (creating it on first
  use) and returns the updated, re-stamped artifact.
- `applicable(exp, conditions)` -> `list` of entries from an already-loaded
  ``experience`` artifact whose recorded conditions match `conditions`.

Per ``knowledge/experience-transfer.md``'s "经验条目必须绑定条件" rule, a
recorded outcome is never trusted outside the exact `stage`/`scenario`/
`precision`/`toolVersion` combination it was observed under — a hold-buffer
action that failed at one stage/corner/precision/tool-version combination
must not be silently generalized to "hold-buffer actions never work".

Ledger persistence and append-only enforcement
-----------------------------------------------

The ledger is a single ``experience`` artifact (schema
``"atcs.experience/1"``) whose only field is ``entries``, a list of entry
dicts. `record` reads the current entries at `path` (an empty list if
`path` does not exist yet — "no ledger yet" is not a data problem), checks
that `lineage["decisionId"]` is not already present among them, appends the
new entry, re-stamps the *whole* artifact (so its `id` always reflects the
current full entry list) and writes it back via `core.write_artifact`.

Append-only means exactly that: a `decisionId` already present in the
ledger can never be recorded again, identical content or not.  Re-recording
it — whether to "correct" a prior entry or simply because a caller replayed
the same decision — raises ``AtcsError("immutable-entry", <decisionId>)``.
A decision whose outcome needs to be re-learned needs a new `decisionId`
that carries whatever changed (different attempt number, new conditions,
etc.), so the old entry is never silently overwritten or lost.

`lineage` shape (binding for `record`)
-----------------------------------------

::

    {
        "decisionId": "<stable id for this decision — e.g. a contribution's
                        <id>:<revision>, or a next-decision's own id>",
        "conditions": {
            "stage": "postroute" | "route" | "cts" | "place" | "init",
            "scenario": "<scenario name> | \"*\"",
            "precision": "gba" | "pba",
            "toolVersion": "<tool version string>",
        },
    }

`conditions["scenario"] == "*"` marks an entry as scenario-generic (see
`applicable` below) — this is a property of the *recorded* entry, set by
whoever calls `record` when a decision's outcome is known not to depend on
the specific scenario (e.g. a purely structural refusal). `record` itself
never infers or defaults this; a caller that wants an exact-scenario entry
must pass the real scenario name.

`decision` shape (binding for `record`)
-------------------------------------------

::

    {
        "hypothesis": "<free-text: why this action was expected to change the outcome>",
        "action": "<one of atcs.workspaces.ACTION_KINDS, or a descriptive string>",
        "predicted": <Measure>,   # the forecasted effect of this decision on
                                  # its target metric (e.g. a predicted slack
                                  # delta in ns; positive = predicted
                                  # improvement), attributed to this decision
                                  # alone
    }

`outcome` shape (binding for `record`)
-------------------------------------------

::

    {
        "measured": <Measure>,   # the actual, re-observed effect of the
                                  # same metric after the decision was
                                  # integrated and re-verified; `unknown`
                                  # when no re-observation was ever taken
    }

`predicted` and `measured` are stored on the entry exactly as given — never
averaged, rounded toward each other, or otherwise collapsed — so a later
Chooser can read the *difference* between what was forecast and what
actually happened (``knowledge/experience-transfer.md``: "预测与实测的差异
是学习对象，不是噪音").

`verdict` (`helped` | `hurt` | `neutral` | `unknown`)
----------------------------------------------------------

`verdict` is `"unknown"` unless *both* `predicted` and `measured` are known
Measures — an entry can never claim a definite verdict from an incomplete
pair, however confident the hypothesis was. When both are known, the
ground-truth `measured` value alone decides the verdict (`predicted` is
still required and still stored, since a verdict computed without ever
having predicted anything is not evidence of a *tested* hypothesis, but the
classification itself trusts the real, re-observed outcome over the
forecast that led to the decision):

- `measured` value `> 0` (a real, re-observed improvement on the target
  metric) -> `"helped"`.
- `measured` value `< 0` (a real, re-observed regression) -> `"hurt"`.
- `measured` value `== 0` exactly (re-observed, no change) -> `"neutral"`.
  No epsilon tolerance is applied: every Measure in this Pack is an exact
  digit-for-digit report value, not an accumulated floating computation
  (same convention as `atcs.state.compare_checks`'s exact sign comparison).

`applicable(exp, conditions)`
--------------------------------

Filters `exp["entries"]` to those whose recorded `conditions` match the
query `conditions` dict (same four keys as above): `stage`, `precision` and
`toolVersion` must match *exactly*; `scenario` matches when the entry's
recorded scenario equals the query's scenario, or when the entry's recorded
scenario is the wildcard `"*"` (query-side wildcards are not supported —
only a *recorded* entry can declare itself scenario-generic).
"""
from __future__ import annotations

from pathlib import Path

from . import core


CONDITION_KEYS = ("stage", "scenario", "precision", "toolVersion")


def _require(mapping, key, label):
    """Return `mapping[key]`, or raise `AtcsError("missing-input", ...)` if absent."""
    if key not in mapping:
        raise core.AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def _read_conditions(mapping, label):
    conditions_in = _require(mapping, "conditions", label)
    return {key: _require(conditions_in, key, f"{label}.conditions") for key in CONDITION_KEYS}


def _load_entries(path):
    target = Path(path)
    if not target.exists():
        return []
    artifact = core.read_artifact(target, "experience")
    return list(artifact.get("entries", []))


def _verdict(predicted, measured):
    if not (core.is_known(predicted) and core.is_known(measured)):
        return "unknown"
    value = core.value_of(measured)
    if value > 0:
        return "helped"
    if value < 0:
        return "hurt"
    return "neutral"


def record(path, lineage, decision, outcome):
    """Append one new entry (built from `lineage`/`decision`/`outcome`) to the
    ``experience`` ledger artifact at `path`; return the updated artifact.

    Raises `AtcsError("immutable-entry", decisionId)` when
    `lineage["decisionId"]` already names an entry in the ledger — see the
    module docstring's "Ledger persistence and append-only enforcement".
    """
    decision_id = _require(lineage, "decisionId", "lineage")
    conditions = _read_conditions(lineage, "lineage")

    hypothesis = _require(decision, "hypothesis", "decision")
    action = _require(decision, "action", "decision")
    predicted = _require(decision, "predicted", "decision")

    measured = _require(outcome, "measured", "outcome")

    entries = _load_entries(path)
    if any(entry.get("decisionId") == decision_id for entry in entries):
        raise core.AtcsError("immutable-entry", decision_id)

    entries.append({
        "decisionId": decision_id,
        "hypothesis": hypothesis,
        "action": action,
        "conditions": conditions,
        "predicted": predicted,
        "measured": measured,
        "verdict": _verdict(predicted, measured),
    })

    stamped = core.stamp("experience", {"entries": entries})
    core.write_artifact(path, stamped)
    return stamped


def applicable(exp, conditions):
    """Entries of `exp` whose recorded conditions match `conditions` (see module docstring)."""
    stage = _require(conditions, "stage", "conditions")
    scenario = _require(conditions, "scenario", "conditions")
    precision = _require(conditions, "precision", "conditions")
    tool_version = _require(conditions, "toolVersion", "conditions")

    matches = []
    for entry in exp.get("entries", []):
        entry_conditions = entry.get("conditions", {})
        if entry_conditions.get("stage") != stage:
            continue
        if entry_conditions.get("precision") != precision:
            continue
        if entry_conditions.get("toolVersion") != tool_version:
            continue
        entry_scenario = entry_conditions.get("scenario")
        if entry_scenario != scenario and entry_scenario != "*":
            continue
        matches.append(entry)
    return matches
