"""Refresh ledger: an append-only record of completed full physical refreshes.

Task-13-review producer (controller decision): `SPEC.md`'s Semantics table
defines `tc_refresh_count` as "已完成的实际完整物理刷新次数" (the count of
*completed actual full physical refreshes*), explicitly "分开记账"
(kept separate) from research/generation counts and from `atcs.adoption`'s
own `working`/`best`/`delivery` pointer decisions. A pointers-document
`history` entry (`atcs.adoption`) records an *accepted publish* — a business
decision about which candidate a pointer should protect — which is not the
same fact as "a real Innovus+StarRC+PT cycle actually completed": a publish
can be refused, replayed idempotently, or decided without ever re-running
the physical tools, and a physical refresh completes well before any
`publish` call (which needs the resulting `evaluation` already assembled
from real receipts). This module is therefore this Pack's single source of
truth for `tc_refresh_count`, independent of `atcs.adoption`'s pointers.

`record_refresh(path, merge_commit_id, design_state_id, sta_sources)` is
called once a merge commit's implementation, extraction and *every* required
STA scenario (`atcs.verification.REQUIRED_SCENARIOS`) have actually
completed — T12 (`atcs.adapters`) calls it at that point, never earlier and
never speculatively. It appends one entry
`{"mergeCommitId", "designStateId", "sources"}` to a single ``refresh-
ledger`` artifact (schema ``"atcs.refresh-ledger/1"``, one field ``entries``,
stamped/written exactly like every other artifact in this Pack via
`core.stamp`/`core.write_artifact`).

Idempotent vs. append-only (controller decision, binding for this module)
----------------------------------------------------------------------------

A second call naming the same `merge_commit_id`:

- with the **same** `design_state_id` and the same `sta_sources` is a no-op
  (returns the ledger unchanged, no new entry, no write) — a caller that
  re-observes "this merge commit's refresh is complete" after a restart or
  a retried Job must never see that as a second refresh.
- with a **different** `design_state_id` or `sta_sources` raises
  `AtcsError("immutable-entry", merge_commit_id)` — a refresh, once
  recorded, is never silently rewritten with a different claimed identity;
  a genuinely different physical refresh needs its own merge commit and
  its own entry.

`sta_sources` must name a `{"path", "sha256"}` reference for *every* scenario
in `atcs.verification.REQUIRED_SCENARIOS` — "every required STA done" is a
checked invariant here, not merely a comment describing when a caller should
call this function: a partial STA set is `AtcsError("missing-input", ...)`,
never silently accepted as a completed refresh.

`load_ledger(path)` returns a fresh, stamped, empty ledger
(`{"entries": []}`) when `path` does not exist yet — "no ledger yet" is not
a data problem, the same convention `atcs.experience.record`/
`atcs.adoption.load_pointers` already use for their own append-only stores.
"""
from __future__ import annotations

from pathlib import Path

from . import core
from . import verification


def load_ledger(path):
    """The ``refresh-ledger`` artifact at `path`, or a fresh empty one if absent."""
    target = Path(path)
    if not target.exists():
        return core.stamp("refresh-ledger", {"entries": []})
    return core.read_artifact(target, "refresh-ledger")


def _validate_sta_sources(sta_sources):
    if not isinstance(sta_sources, dict):
        raise core.AtcsError("missing-input", "sta_sources must be an object keyed by scenario name")
    missing = [scenario for scenario in verification.REQUIRED_SCENARIOS if scenario not in sta_sources]
    if missing:
        raise core.AtcsError(
            "missing-input",
            f"sta_sources is missing required scenario(s): {', '.join(missing)}",
        )
    for scenario, ref in sta_sources.items():
        if not isinstance(ref, dict) or "path" not in ref or "sha256" not in ref:
            raise core.AtcsError("missing-input", f"sta_sources.{scenario} must be {{path, sha256}}")


def record_refresh(path, merge_commit_id, design_state_id, sta_sources):
    """Append one completed-physical-refresh entry to the ledger at `path`.

    Idempotent when `merge_commit_id` already names an entry with the exact
    same `design_state_id`/`sta_sources`; raises
    `AtcsError("immutable-entry", merge_commit_id)` when it names one that
    disagrees. See the module docstring for the full contract.
    """
    if not isinstance(merge_commit_id, str) or not merge_commit_id:
        raise core.AtcsError("missing-input", "merge_commit_id must be a non-empty string")
    if not isinstance(design_state_id, str) or not design_state_id:
        raise core.AtcsError("missing-input", "design_state_id must be a non-empty string")
    _validate_sta_sources(sta_sources)

    ledger = load_ledger(path)
    entries = list(ledger.get("entries", []))

    new_entry = {"mergeCommitId": merge_commit_id, "designStateId": design_state_id, "sources": sta_sources}
    for entry in entries:
        if entry.get("mergeCommitId") != merge_commit_id:
            continue
        if entry.get("designStateId") == design_state_id and entry.get("sources") == sta_sources:
            return ledger  # idempotent re-submission of the same completed refresh
        raise core.AtcsError("immutable-entry", merge_commit_id)

    entries.append(new_entry)
    stamped = core.stamp("refresh-ledger", {"entries": entries})
    core.write_artifact(path, stamped)
    return stamped
