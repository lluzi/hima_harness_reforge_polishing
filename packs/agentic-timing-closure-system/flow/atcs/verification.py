"""M6: check planning, PT pre-check qualification, and final evaluation assembly.

This module owns the four M6 producers named in this Pack's task brief
(``.superpowers/sdd/task-8-brief.md``) and the ``check-plan``/``evaluation``
rows of ``.superpowers/sdd/global-context.md``'s "Shared data model" table:

- `plan_checks(merge_commit, policy)` -> ``check-plan`` — which checks a
  merge commit's candidate must carry before it can be evaluated.
- `presta_qualification(new_nets, spef_net_names)` — whether a PT pre-check
  ("presta") over a candidate's newly-introduced nets is backed by real
  parasitics, per ``knowledge/cheap-verification.md``'s rule that a PT
  pre-check over nets without valid RC modeling is `unknown`, never a
  silent pass.
- `parse_drc_summary(text)` / `parse_connectivity_summary(text)` — fail-closed
  parsers for Innovus ``verify_drc``/``verifyConnectivity`` report text, in
  the grammar cross-checked against the frozen old Pack's reader
  (``packs/xtop-timing-closure/tools/read-output.py:67-96``, read-only
  reference, never imported) and its test fixtures
  (``packs/xtop-timing-closure/flow/tests/test_closure.py:111-121``).
- `assemble(plan, receipts, prior_observation, baseline_physical)` ->
  ``evaluation`` — the final judged evaluation of a merge commit's
  candidate, per this Pack's ``SPEC.md`` "Semantics" table
  (`tc_final_setup_wns_ns`, `tc_missing_required_check_count`,
  `tc_final_identity_error_count`, `tc_applicable_constraint_failure_count`,
  `tc_applicable_constraint_unknown_count`, `tc_fixed_check_count`,
  `tc_missing_prior_check_count`) and "Judge rules" (`final-evidence-ready`,
  `required-constraints-pass`).

Fail-closed is the rule for every function here, same as `atcs.core` and
`atcs.state`: a missing, truncated, duplicated or identity-mismatched input
yields `unknown` with a reason, or an `AtcsError` refusal — never a bare `0`
and never a silently-assumed PASS.

``receipts`` shape (binding for `assemble`)
--------------------------------------------

::

    {
        "database": {"path": "<path>", "sha256": "<64 hex>"},
        "netlist": {"path": "<path>", "sha256": "<64 hex>"},
        "def": {"path": "<path>", "sha256": "<64 hex>"} | None,
        "spef": {
            "<corner>": {
                "path": "<path>", "sha256": "<64 hex>",
                "inputDefSha256": "<64 hex>",
                "estimated": True | False,   # optional, default False
            }, ...
        },
        "sta": {
            "<scenario>": {
                "corner": "<corner name — a key of receipts[\"spef\"]>",
                "inputs": {"netlistSha256": "<64 hex>", "spefSha256": "<64 hex>"},
                "observation": <observation-set-shaped dict>,
            }, ...
        },
        "physical": {"drc": "<verify_drc.rpt text>", "connectivity": "<verifyConnectivity.rpt text>"},
    }

T12 (`atcs.adapters`) is the producer that must assemble receipts in exactly
this shape from the actual Innovus/StarRC/PrimeTime tool outputs it
collects — in particular, every `receipts["sta"][scenario]` entry now
carries its own `"corner"` (the SPEF corner that STA run actually used),
not just its input hashes; T12 must record that corner alongside the
hashes it already has to hand, not infer or omit it.

`baseline_physical` is `{"drc": "<text>", "connectivity": "<text>"}` in the
same report grammar — the pre-implementation (or control-arm) physical
report a candidate is diffed against (see
``knowledge/state-and-evidence.md``'s "control arm" counterexample: a
candidate's physical evidence and its baseline must come from comparable,
un-truncated reports, never a different denominator silently substituted).

``receipts["spef"][corner]["estimated"] == True`` means that corner's SPEF
is a non-final, estimated extraction (e.g. a pre-route/pre-ECO placeholder).
`assemble` refuses to build a final evaluation from estimated RC at all:
`AtcsError("estimated-rc", corner)`, raised before any other computation —
a final Goal judgement must never rest on modeled-not-measured parasitics.

`plan_checks(merge_commit, policy)`
--------------------------------------

`requiredScenarios` is always the Pack-wide fixed set
(`REQUIRED_SCENARIOS`, matching ``.superpowers/sdd/global-context.md``'s
"Required scenarios" — this Pack does not let a merge commit or policy grow
or shrink it). `extraction` and `sta` are always the literal string
`"full"` (no partial/incremental extraction or STA scope exists in this
Pack). `physical` defaults to `["drc", "connectivity"]` — the fixed
drc/connectivity pair `assemble` always evaluates as part of the
`evaluation` artifact's own schema — but `policy` may override it via
`policy["physical"]`; `plan.physical` is read by the *implementation* step
(T11/T12) as the literal list of physical-check jobs it must actually run
to produce `receipts["physical"]`, not by `assemble` itself.

`scenarioCorners` is copied verbatim from `policy["scenarioCorners"]` (a
`{scenario: corner}` map the upstream analysis contract supplies — which
SPEF corner each required scenario's STA is expected to use); when
`policy` carries no such key the plan's `scenarioCorners` is `{}`.
`assemble` reads this map to check that each scenario's STA receipt used
the corner the plan actually requires for it (see `assemble`'s Identity
step below) — `plan_checks` itself does not validate or complete this map,
it only carries it through.

`functional` and `pg` are conditional on the merge commit's own
`operations[]` (the shared `operation` records named in global-context's
`ACTION_KINDS`), not on `policy`: a merge commit whose operations are all
`size_cell` does not change netlist topology or PG structures, so
`functional` and `pg` both stay empty. Any `insert_buffer`/`delete_buffer`
operation (it changes net topology) adds `"connectivity"` to `functional`
— the newly-touched nets need a functional/topology-equivalence recheck
beyond the always-required physical connectivity check. Any
`pg_local_adjust` operation adds `"pg"` to `pg`.

`mergeCommitId` is carried through from `merge_commit.get("id")` (the
merge-commit artifact's own stamped id, when the caller passes a stamped
artifact) purely so a later `assemble` call over the same plan can label
its `evaluation.candidateId` — `check-plan` itself does not otherwise
reference a "candidate", since a merge commit is already the sealed
candidate this plan is for.

`presta_qualification(new_nets, spef_net_names)`
----------------------------------------------------

A PT pre-check ("presta") over a candidate that introduces new nets is only
as good as the RC model behind those nets (``knowledge/cheap-verification.md``:
"RC 建模无效时，预演结果是 unknown，不是'未测出问题所以算过'"). This
function does not run any PT query itself — it only decides which of
`new_nets` lack a qualifying entry in `spef_net_names`, the set of net
names the candidate's SPEF actually models.

`spef_net_names` is `None` when the SPEF's net-name list itself could not
be read (a distinct, worse case than "read successfully but the net is
absent"): `count` is then `unknown("unreadable-spef-net-list")` and, since
nothing can be proven qualified without evidence, `unqualified` fail-closed
lists every requested net. When `new_nets` is empty there is nothing to
qualify regardless of `spef_net_names`'s readability: `count` is
`known(0)`. Otherwise `unqualified` is the sorted list of `new_nets` absent
from `spef_net_names`, and `count` is `known(len(unqualified))` — always
decidable once the net-name list itself was read successfully.

`parse_drc_summary(text)` / `parse_connectivity_summary(text)`
--------------------------------------------------------------

Both parse the Innovus report grammar produced by the fixed check template
this Pack requires (``verify_drc -limit <N> -report ...`` /
``verifyConnectivity -noAntenna -error <N> -report ...``, `N` defaulting to
`DEFAULT_PHYSICAL_LIMIT` when the command line itself cannot be read) and
return ``{"total": Measure, "identities": [...] | None, "truncated": bool}``.

A report is `truncated` (identities `None`, total `unknown`) when: an
explicit truncation phrase appears anywhere in the text ("truncated",
"limit reached", "first N errors/violations" — the same marker vocabulary
as the old Pack's `physical_count`,
``packs/xtop-timing-closure/flow/closure.py:556``); the report's own
declared total summary line is missing or internally inconsistent (DRC: no
single `Total Violations : N Viols.` line; connectivity: not exactly one
`Begin Summary`/`End Summary` block, or its `Problem(s)` categories do not
sum to its `total info(s) created.` line); the declared total reaches the
check's own `-limit`/`-error` value (the tool's own cap was hit); or the
number of individually-listed violation/`Net` identities does not match
the declared total (some were elided, so the identity set cannot be
trusted as complete). Only when none of these hold is `identities` the
full, trustworthy set of violation identities and `total` `known`.

A DRC violation's identity is its rule/type line (the line immediately
above its `Bounds :` line) plus any metal-layer token found in that line
(e.g. `M4`) plus its bounding box, joined so two violations of a different
type, layer or location never collide; a connectivity violation's identity
is simply its net name (``knowledge/cheap-verification.md``'s "type + layer
+ bbox or net" rule, from this task's brief). `assemble` diffs these
identity sets against `baseline_physical`'s to find "new identities beyond
baseline" — see below.

`assemble(plan, receipts, prior_observation, baseline_physical)`
--------------------------------------------------------------------

Builds the final `evaluation` artifact. Order of operations:

1. **Refuse estimated RC outright** — any `receipts["spef"][corner]["estimated"]
   == True` raises `AtcsError("estimated-rc", corner)` before anything else
   is computed.
2. **Coverage** (`missingRequiredCheckCount`) — a required scenario (from
   `plan["requiredScenarios"]`) is "missing" when `receipts["sta"]` has no
   entry for it, or that entry has no `observation`, or the observation's
   own `scenarios` mapping has no entry for that scenario name.
   `missingRequiredCheckCount` is `known(len(missing))`.
3. **Final WNS** (`finalSetupWns`/`finalHoldWns`, one Measure per mode,
   independently) — per this task's Decisions: the minimum over all
   required scenarios' `<mode>.wns` Measure, but only when *every* required
   scenario has a present, non-missing observation whose
   `complete.<mode>` is `True` and whose `<mode>.wns` is itself a known
   Measure. Any one required scenario failing any of those three
   conditions makes the whole mode's final WNS `unknown`, naming every
   contributing scenario/reason — never a partial minimum over whichever
   scenarios happened to be available.
4. **Identity** (`finalIdentityErrorCount`) — the chain DB -> netlist/DEF
   -> SPEF -> STA is checked *per scenario*, and is fail-closed at the leg
   level: `finalIdentityErrorCount` is only ever a known count when every
   leg below was actually present to check. If any leg is missing —
   `receipts["database"]["sha256"]` or `receipts["netlist"]["sha256"]`
   absent, `receipts["def"]` is `None` (or its `sha256` absent), any
   `receipts["spef"][corner]` lacks `inputDefSha256`, or `plan["scenarioCorners"]`
   is absent/empty or lacks an entry for one of `plan["requiredScenarios"]`
   — the whole count is `unknown`, naming every missing leg (never a
   partial known count computed only over the legs that happened to be
   present: a chain that cannot be fully walked cannot certify a `0`).
   Only once every leg is present does `assemble` count actual mismatches,
   one per violation, across all of `receipts["sta"]`'s scenarios:
   (a) every `receipts["spef"][corner]["inputDefSha256"]` must equal
   `receipts["def"]["sha256"]` (the extraction ran on the actual final
   DEF, not a stale one); (b) each scenario's own `receipts["sta"][scenario]["corner"]`
   must name a key of `receipts["spef"]`, and that scenario's
   `inputs.spefSha256` must equal `receipts["spef"][that corner]["sha256"]`
   exactly (an `spefSha256`/corner that don't agree with any real
   extraction output is exactly the "STA input SPEF sha ≠ extraction
   output sha" case this task's brief names); (c) that same
   `receipts["sta"][scenario]["corner"]` must equal
   `plan["scenarioCorners"][scenario]` — the corner the upstream analysis
   contract actually required for this scenario (an `ssg`/`rcworst`
   scenario silently reading a `cbest` SPEF is a real identity error even
   when that SPEF's own hash matches perfectly); (d) `inputs.netlistSha256`
   must equal `receipts["netlist"]["sha256"]`. This is independent of
   coverage: a scenario can be identity-mismatched and still contribute a
   (untrustworthy but present) WNS value — `final-evidence-ready`'s two
   Judge nodes (`-coverage` then `-identity`) gate on these two counts
   separately, in sequence, per `SPEC.md`.
5. **Physical constraints** (`constraintFailureCount`,
   `constraintUnknownCount`, and the `physical` field) — for each of
   `"drc"`/`"connectivity"`, both `receipts["physical"][kind]` (the
   candidate) and `baseline_physical[kind]` are parsed. If either is
   truncated, that kind's comparison is `unknown`
   (`constraintUnknownCount` += 1, contributing nothing to
   `constraintFailureCount` — a truncated report is evidence gap, not a
   proven-clean or proven-failing result). Otherwise "new identities beyond
   baseline" = the candidate's identity set minus the baseline's;
   `constraintFailureCount` += that count. The two kinds are independent:
   a truncated connectivity report does not suppress a counted DRC
   failure, and vice versa.
6. **Prior comparison** (`fixedCheckCount`, `missingPriorCheckCount`,
   `comparison`) — every scenario's `observation` in `receipts["sta"]` is
   merged into one combined `{"checks", "scenarios"}` dict (later entries
   do not collide: this Pack's check keys already namespace by scenario)
   and diffed against `prior_observation` via `atcs.state.compare_checks`
   (no supplemental recheck data — `assemble` has none to offer, so `{}`
   is passed, per `compare_checks`'s own contract for "no supplemental
   data was gathered"). `comparison` is the full `check-comparison` dict;
   `fixedCheckCount`/`missingPriorCheckCount` are `known(len(...))` of its
   `fixed`/`missingPrior` lists.

`candidateId` is `plan.get("mergeCommitId")` (see `plan_checks` above) —
`assemble` never re-derives an id from `receipts` itself, since receipts
are per-domain evidence bundles, not an artifact with its own identity.
"""
from __future__ import annotations

import re

from . import core
from . import state


REQUIRED_SCENARIOS = (
    "func_ssg_rcworst_m40",
    "func_ssg_rcworst_125",
    "func_ffg_cbest_m40",
    "func_ffg_cbest_125",
)

DEFAULT_PHYSICAL_CHECKS = ("drc", "connectivity")

_TOPOLOGY_OPS = ("insert_buffer", "delete_buffer")

DEFAULT_PHYSICAL_LIMIT = 1_000_000

_TRUNCATION_MARKER_RE = re.compile(r"(?i)\b(?:truncated|limit reached|first\s+\d+\s+(?:errors|violations))\b")

_DRC_COMMAND_LIMIT_RE = re.compile(r"(?im)^#\s*Command:\s*verify_drc\s+-limit\s+(\d+)\b")
_DRC_TOTAL_RE = re.compile(r"(?im)^\s*Total Violations\s*:\s*(\d+)\s+Viols\.\s*$")
_DRC_VIOLATION_RE = re.compile(
    r"(?m)^(?P<type>.+)\n\s*Bounds\s*:\s*\(\s*(?P<x1>[-\d.]+)\s*,\s*(?P<y1>[-\d.]+)\s*\)"
    r"\s*\(\s*(?P<x2>[-\d.]+)\s*,\s*(?P<y2>[-\d.]+)\s*\)"
)
_LAYER_TOKEN_RE = re.compile(r"\b([A-Z]{1,3}\d{1,2})\b")

_CONN_COMMAND_LIMIT_RE = re.compile(r"(?im)^#\s*Command:\s*verifyConnectivity\b.*?-error\s+(\d+)\b")
_CONN_SUMMARY_RE = re.compile(r"(?ims)^\s*Begin Summary\s*\n(.*?)^\s*End Summary\s*$")
_CONN_TOTAL_RE = re.compile(r"(?im)^\s*(\d+) total info\(s\) created\.\s*$")
_CONN_PROBLEM_RE = re.compile(r"(?im)^\s*(\d+) Problem\(s\) \([^\n]*\):[^\n]*$")
_CONN_NET_RE = re.compile(r"(?m)^Net\s+(\S+?):")


def plan_checks(merge_commit, policy):
    """Build a ``check-plan`` for `merge_commit` (see module docstring)."""
    policy = policy or {}
    operations = merge_commit.get("operations", [])
    op_kinds = {operation.get("op") for operation in operations}

    functional = ["connectivity"] if op_kinds & set(_TOPOLOGY_OPS) else []
    pg = ["pg"] if "pg_local_adjust" in op_kinds else []
    # `assemble` always evaluates the fixed drc/connectivity pair the `evaluation`
    # schema declares; `plan.physical` is what the implementation step (T11/T12)
    # must actually run to produce `receipts["physical"]`, not a knob `assemble` reads.
    physical = list(policy.get("physical", DEFAULT_PHYSICAL_CHECKS))

    body = {
        "requiredScenarios": list(REQUIRED_SCENARIOS),
        "extraction": "full",
        "sta": "full",
        "physical": physical,
        "functional": functional,
        "pg": pg,
        "scenarioCorners": dict(policy.get("scenarioCorners") or {}),
        "mergeCommitId": merge_commit.get("id"),
    }
    return core.stamp("check-plan", body)


def presta_qualification(new_nets, spef_net_names):
    """Which of `new_nets` lack a qualifying SPEF entry (see module docstring)."""
    new_nets = list(new_nets)
    if not new_nets:
        return {"unqualified": [], "count": core.known(0)}
    if spef_net_names is None:
        return {"unqualified": sorted(new_nets), "count": core.unknown("unreadable-spef-net-list")}
    available = set(spef_net_names)
    unqualified = sorted(net for net in new_nets if net not in available)
    return {"unqualified": unqualified, "count": core.known(len(unqualified))}


def parse_drc_summary(text):
    """Parse a ``verify_drc`` report into ``{"total", "identities", "truncated"}``."""
    if _TRUNCATION_MARKER_RE.search(text):
        return {"total": core.unknown("drc-truncation-marker"), "identities": None, "truncated": True}

    limit_match = _DRC_COMMAND_LIMIT_RE.search(text)
    limit = int(limit_match.group(1)) if limit_match else DEFAULT_PHYSICAL_LIMIT

    total_match = _DRC_TOTAL_RE.search(text)
    if not total_match:
        return {"total": core.unknown("missing-drc-total-line"), "identities": None, "truncated": True}
    total = int(total_match.group(1))

    identities = []
    for match in _DRC_VIOLATION_RE.finditer(text):
        type_line = match.group("type").strip()
        bbox = (match.group("x1"), match.group("y1"), match.group("x2"), match.group("y2"))
        layer_match = _LAYER_TOKEN_RE.search(type_line)
        layer = layer_match.group(1) if layer_match else ""
        identities.append(f"{type_line}|{layer}|{bbox}")

    if total >= limit:
        return {"total": core.unknown("drc-limit-reached"), "identities": None, "truncated": True}
    if len(identities) != total:
        return {"total": core.unknown("drc-listed-count-mismatch"), "identities": None, "truncated": True}
    return {"total": core.known(total), "identities": sorted(identities), "truncated": False}


def parse_connectivity_summary(text):
    """Parse a ``verifyConnectivity`` report into ``{"total", "identities", "truncated"}``."""
    if _TRUNCATION_MARKER_RE.search(text):
        return {"total": core.unknown("connectivity-truncation-marker"), "identities": None, "truncated": True}

    limit_match = _CONN_COMMAND_LIMIT_RE.search(text)
    limit = int(limit_match.group(1)) if limit_match else DEFAULT_PHYSICAL_LIMIT

    summary_match = _CONN_SUMMARY_RE.search(text)
    if not summary_match:
        return {"total": core.unknown("missing-connectivity-summary"), "identities": None, "truncated": True}
    summary_body = summary_match.group(1)

    totals = _CONN_TOTAL_RE.findall(summary_body)
    problems = [int(value) for value in _CONN_PROBLEM_RE.findall(summary_body)]
    if len(totals) != 1 or not problems or sum(problems) != int(totals[0]):
        return {"total": core.unknown("connectivity-summary-mismatch"), "identities": None, "truncated": True}
    total = int(totals[0])

    nets = _CONN_NET_RE.findall(text)
    if total >= limit:
        return {"total": core.unknown("connectivity-limit-reached"), "identities": None, "truncated": True}
    if len(nets) != total:
        return {"total": core.unknown("connectivity-listed-count-mismatch"), "identities": None, "truncated": True}
    return {"total": core.known(total), "identities": sorted(set(nets)), "truncated": False}


def _scenario_observation(receipts, scenario):
    entry = receipts.get("sta", {}).get(scenario)
    if not entry:
        return None
    observation = entry.get("observation")
    if not observation:
        return None
    return observation.get("scenarios", {}).get(scenario)


def _missing_required_scenarios(plan, receipts):
    return [scenario for scenario in plan["requiredScenarios"] if _scenario_observation(receipts, scenario) is None]


def _final_wns(plan, receipts, mode):
    values = []
    problems = []
    for scenario in plan["requiredScenarios"]:
        scenario_obs = _scenario_observation(receipts, scenario)
        if scenario_obs is None:
            problems.append(f"{scenario}: missing observation")
            continue
        if not scenario_obs.get("complete", {}).get(mode, False):
            problems.append(f"{scenario}: {mode} coverage incomplete")
            continue
        wns_measure = scenario_obs.get(mode, {}).get("wns")
        if not core.is_known(wns_measure):
            problems.append(f"{scenario}: {mode} wns unknown")
            continue
        values.append(core.value_of(wns_measure))
    if problems:
        return core.unknown("; ".join(problems))
    return core.known(min(values))


def _missing_identity_legs(plan, receipts):
    """Name every leg of the DB -> netlist/DEF -> SPEF -> STA chain that is not
    even present to check. Non-empty means `_identity_errors` cannot run at all —
    the chain must be fully walkable to certify a known error count, even `0`."""
    missing = []

    if not (receipts.get("database") or {}).get("sha256"):
        missing.append("missing database sha256")
    if not (receipts.get("netlist") or {}).get("sha256"):
        missing.append("missing netlist sha256")

    def_entry = receipts.get("def")
    if def_entry is None:
        missing.append("def is None")
    elif not def_entry.get("sha256"):
        missing.append("missing def sha256")

    for corner, entry in receipts.get("spef", {}).items():
        if not entry.get("inputDefSha256"):
            missing.append(f"spef {corner} missing inputDefSha256")

    scenario_corners = plan.get("scenarioCorners") or {}
    if not scenario_corners:
        missing.append("missing scenarioCorners map")
    else:
        for scenario in plan["requiredScenarios"]:
            if scenario not in scenario_corners:
                missing.append(f"scenarioCorners missing {scenario}")

    return missing


def _identity_errors(plan, receipts):
    """Count actual identity mismatches. Only called once `_missing_identity_legs`
    is empty — every leg it checks is guaranteed present here."""
    netlist_sha = receipts["netlist"]["sha256"]
    def_sha = receipts["def"]["sha256"]
    spef = receipts.get("spef", {})
    scenario_corners = plan["scenarioCorners"]

    errors = []
    for corner, entry in spef.items():
        if entry["inputDefSha256"] != def_sha:
            errors.append(f"spef {corner} was extracted from a different DEF")

    for scenario, entry in receipts.get("sta", {}).items():
        inputs = entry.get("inputs", {})
        if inputs.get("netlistSha256") != netlist_sha:
            errors.append(f"sta {scenario} used a different netlist")

        receipt_corner = entry.get("corner")
        if receipt_corner is None or receipt_corner not in spef:
            errors.append(f"sta {scenario} does not name a valid spef corner")
            continue
        if inputs.get("spefSha256") != spef[receipt_corner]["sha256"]:
            errors.append(f"sta {scenario} spef sha does not match corner {receipt_corner}'s extraction output")

        expected_corner = scenario_corners.get(scenario)
        if expected_corner is not None and expected_corner != receipt_corner:
            errors.append(
                f"sta {scenario} used corner {receipt_corner!r} but the plan requires {expected_corner!r}"
            )
    return errors


def _final_identity_error_count(plan, receipts):
    missing_legs = _missing_identity_legs(plan, receipts)
    if missing_legs:
        return core.unknown("; ".join(missing_legs))
    return core.known(len(_identity_errors(plan, receipts)))


def _combine_sta_observations(sta_receipts):
    checks = {}
    scenarios = {}
    for entry in sta_receipts.values():
        observation = entry.get("observation")
        if not observation:
            continue
        checks.update(observation.get("checks", {}))
        scenarios.update(observation.get("scenarios", {}))
    return {"checks": checks, "scenarios": scenarios}


def _physical_comparison(kind, parse_fn, receipts, baseline_physical):
    candidate_text = receipts.get("physical", {}).get(kind, "")
    baseline_text = baseline_physical.get(kind, "")
    candidate = parse_fn(candidate_text)
    baseline = parse_fn(baseline_text)

    if candidate["truncated"] or baseline["truncated"]:
        side = "candidate" if candidate["truncated"] else "baseline"
        return candidate["total"], core.unknown(f"{kind}-{side}-report-truncated"), 0, 1

    new_identities = set(candidate["identities"]) - set(baseline["identities"])
    return candidate["total"], core.known(len(new_identities)), len(new_identities), 0


def assemble(plan, receipts, prior_observation, baseline_physical):
    """Assemble the final ``evaluation`` for `plan`'s candidate (see module docstring)."""
    for corner, entry in receipts.get("spef", {}).items():
        if entry.get("estimated") is True:
            raise core.AtcsError("estimated-rc", corner)

    missing_scenarios = _missing_required_scenarios(plan, receipts)
    missing_required_check_count = core.known(len(missing_scenarios))

    final_setup_wns = _final_wns(plan, receipts, "setup")
    final_hold_wns = _final_wns(plan, receipts, "hold")

    final_identity_error_count = _final_identity_error_count(plan, receipts)

    physical_out = {}
    failure_count = 0
    unknown_count = 0
    for kind, parse_fn in (("drc", parse_drc_summary), ("connectivity", parse_connectivity_summary)):
        total_measure, new_identity_measure, failures, unknowns = _physical_comparison(
            kind, parse_fn, receipts, baseline_physical
        )
        physical_out[kind] = {"total": total_measure, "newIdentityCount": new_identity_measure}
        failure_count += failures
        unknown_count += unknowns

    current_observation = _combine_sta_observations(receipts.get("sta", {}))
    comparison = state.compare_checks(prior_observation, current_observation, {})

    body = {
        "candidateId": plan.get("mergeCommitId"),
        "finalSetupWns": final_setup_wns,
        "finalHoldWns": final_hold_wns,
        "missingRequiredCheckCount": missing_required_check_count,
        "finalIdentityErrorCount": final_identity_error_count,
        "constraintFailureCount": core.known(failure_count),
        "constraintUnknownCount": core.known(unknown_count),
        "fixedCheckCount": core.known(len(comparison["fixed"])),
        "missingPriorCheckCount": core.known(len(comparison["missingPrior"])),
        "comparison": comparison,
        "physical": physical_out,
    }
    return core.stamp("evaluation", body)
