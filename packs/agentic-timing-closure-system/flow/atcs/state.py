"""M1: design state, input readiness, observation capture, check comparison.

This module owns the four M1 producers named in
``.superpowers/sdd/global-context.md``'s "Shared data model" table:
`design_state` (``design-state``), `input_readiness` (``input-readiness``),
`capture` (``observation-set``) and `compare_checks` (``check-comparison``).
Each returns a plain dict stamped with `atcs.core.stamp` (so it carries
`schema`/`id`); writing it to disk is a caller's job via
`atcs.core.write_artifact`, not this module's.

Manifest shape (binding for `design_state` and `input_readiness`)
-------------------------------------------------------------------

Both functions take the same ``manifest`` shape::

    {
        "top": "<module name>",
        "stage": "postroute" | "route" | "cts" | "place" | "init",
        "root": "<optional base dir for relative paths>",
        "database": {"enc": "<path>", "encDat": "<dir path>"},
        "netlist": "<path>",
        "def": "<path> | omitted",
        "spef": {"<corner>": "<path>", ...},
        "sdc": ["<path>", ...],
        "libraries": ["<path>", ...],
        "scenarios": [{"name": "<scenario name>", "corner": "<spef corner>"}, ...],
        "tools": {"<tool name>": "<version>"},        # optional, default {}
        "parentId": "<prior design-state id> | omitted",   # optional, default None
        "lifecycle": {                                  # optional
            "stages": {
                "init" | "place" | "cts" | "route" | "postroute": {
                    "checkpoint": "<path>",
                    "script": "<path>",
                },
                ...
            },
            "flowConfig": [...],
        },
    }

Path resolution: every path value above is either absolute, or resolved
relative to ``manifest["root"]`` (via `os.path.join`) when present; when a
path is relative and no ``root`` is given, it is resolved relative to the
current working directory (`os.path.join(".", path)`), matching plain
`open()`/`os.path` semantics — callers that care about determinism should
always set `root` to an absolute directory (tests do, via
`tempfile.TemporaryDirectory()`).

`scenarios` entries are `{"name", "corner"}` objects (not bare strings) so
that `input_readiness` can compute, without any outside knowledge base,
which SPEF corners the declared scenarios actually need. `design_state`'s
own `scenarios` output field is the plain list of scenario names.

The manifest is Site-supplied evidence, not an internal contract a caller
already validated — a missing required key (`top`, `stage`, `database`,
`database.enc`, `database.encDat`, `netlist`, a scenario's `name`/`corner`)
therefore raises `AtcsError("missing-input", "<dotted key path>")` from
`design_state`/`input_readiness`, never a bare `KeyError`, via the shared
`_require` helper below.

`design_state(manifest)`
-------------------------

Builds a ``design-state`` artifact body (`top`, `stage`, `database`,
`netlist`, `def`, `spef`, `sdc`, `tools`, `scenarios`, `parentId`) by
hash-binding every referenced file: `database.enc` via `core.file_sha256`,
`database.encDat` via `core.tree_digest` (raising
`AtcsError("missing-input", ...)` — left to propagate — when that directory
is absent, per the task brief), and `netlist`/`def`/each `spef` corner/each
`sdc` entry via `core.file_sha256`. `def` is `None` in the output when the
manifest omits it.

`input_readiness(manifest, site_capabilities)`
------------------------------------------------

Computes ``missing[]``/``missingCount`` (existence-only check, not
hash-bound) over the post-route minimum input set: `database.enc`,
`database.encDat` (as a directory), `netlist`, one `spef` entry per corner
referenced by `scenarios`, every `sdc` entry, every `libraries` entry, and
`scenarios` itself being non-empty. Each missing item is recorded as a
short descriptive string (e.g. ``"spef:<corner>"``, ``"sdc:<path>"``).
`missingCount` is always a known Measure (existence checks never leave this
ambiguous — a stat failure due to a permission error on a *containing*
directory is treated the same as non-existence, since we still learned a
definite fact: this path is not usable).

`site_capabilities` is accepted for interface symmetry with the SPEC's Run
contract input of the same name (which qualifies tools/operators/budget)
but is not consulted by the current minimum-input check; a future task may
extend the minimum-input set based on it.

Lifecycle availability (`lifecycleAvailable`, `lifecycleMissing`, `scope`):

- No ``manifest["lifecycle"]`` at all -> `lifecycleAvailable = known(0)`,
  `lifecycleMissing = ["lifecycle not provided"]`, `scope =
  "post-route-only"`.
- Otherwise, every stage in `REQUIRED_LIFECYCLE_STAGES` (`init`, `place`,
  `cts`, `route`, `postroute`) must appear in
  ``manifest["lifecycle"]["stages"]`` with a `checkpoint` and a `script`
  that both exist and are **hash-bound** (actually read via
  `core.file_sha256`, not just stat-checked), and ``manifest["lifecycle"]``
  must also carry a `flowConfig` key. Each absent/non-existent piece adds
  one string to `lifecycleMissing` (e.g. ``"cts checkpoint missing"``,
  ``"flowConfig missing"``) and forces `lifecycleAvailable = known(0)` —
  there is no partial/partial-stage scope; `scope` stays
  `"post-route-only"` (never a third "resume from stage X" scope, per
  SPEC's Run contract "Auto 输入判定").
- If one or more checkpoint/script files exist but cannot be *read* (e.g. a
  permission error during hashing), that fact makes the whole lifecycle
  verification inconclusive: `lifecycleAvailable =
  unknown("<stage> <piece> unreadable: <detail>; ...")` — every unreadable
  piece is named, not just the last one seen — `lifecycleMissing` records
  the same reasons, and `scope` still falls back to `"post-route-only"`
  (an unknown never promotes to `"full-flow"`).
- Only when every stage's checkpoint+script hash-binds successfully **and**
  `flowConfig` is present is `lifecycleAvailable = known(1)` and `scope =
  "full-flow"`.

`capture(source_refs, query_spec)`
------------------------------------

``source_refs`` shape::

    {
        "designStateId": "<design-state id this observation is bound to>",
        "scenarios": {
            "<scenario name>": {
                "globalTiming": "<path to global_timing.rpt>",
                "setupPaths": "<path to setup.rpt>",
                "holdPaths": "<path to hold.rpt>",
                "checkTiming": "<path to check_timing.rpt>",
            },
            ...
        },
    }

``query_spec`` shape::

    {
        "precision": "gba" | "pba",
        "requiredScenarios": ["<scenario name>", ...],
        "maxPaths": <int, forwarded to atcs.reports.parse_path_report>,
    }

Builds an ``observation-set`` artifact body. For every scenario present in
``source_refs["scenarios"]``, reads and parses its four report files
(`atcs.reports.parse_global_timing`, `parse_path_report` x2,
`parse_check_timing`); a scenario named in `requiredScenarios` but absent
from `source_refs["scenarios"]` is recorded in `missingScenarios` instead
of being parsed. Every path row from every parsed setup/hold report becomes
one `checks[<checkKey>]` entry keyed by `core.check_key(scenario, mode,
endpoint)`; `atcs.reports.parse_path_report` already collapses duplicate
endpoints within a single report to their worst slack (or refuses the
report outright when the duplicates disagree on path group), so no further
dedup is needed here.
`coverage.complete` is `True` only when `missingScenarios` is empty and
every parsed scenario's setup and hold path reports were both `complete`;
`coverage.reasons` lists every contributing gap. `sources[]` lists every
report file actually read, each hash-bound via `core.file_sha256`.

`compare_checks(prior, current, recheck)`
--------------------------------------------

`prior` and `current` are ``observation-set``-shaped dicts (only their
`checks` mapping is used). `recheck` is a plain
``{checkKey: Measure}`` mapping of supplemental, targeted re-observations
(e.g. a follow-up PT query run specifically to resolve an ambiguous check)
that take priority over "absent from `current`" when both are available;
pass `{}` when no supplemental data was gathered.

For every check key known to `prior` (skipping any whose prior slack is
itself `unknown` — there is nothing to compare against): if `current` (or,
failing that, `recheck`) has a known slack for the same key, the pair of
signs (negative counts as "in violation") decides `fixed` (was negative,
now not), `remaining` (negative, still negative), `regressed` (was not
negative, now negative), or no bucket at all (was not negative, still not
negative — not interesting).

When neither `current` nor `recheck` can resolve the key (it is simply
absent from both), what happens depends on the check's *prior* sign and on
whether `current`'s coverage for that check's scenario/mode was complete
(via `current["scenarios"][<scenario>]["complete"][<mode>]`, read from the
check key's own `"<scenario>|<mode>|<endpoint>"` — a scenario absent from
`current["scenarios"]` entirely counts as incomplete):

- Prior **negative** (it was a violation): always `missingPrior`,
  regardless of `current`'s coverage — a real violation that can no longer
  be located is never silently dropped, and is deliberately not the same
  as `fixed`: disappearing from a truncated report was never a positive
  re-observation.
- Prior **non-negative** (it was clean): `missingPrior` only when
  `current`'s coverage for that scenario/mode was itself incomplete
  (truncated or the scenario is missing) — the absence might just be
  under-reporting, not evidence either way. When `current`'s coverage for
  that scenario/mode was complete, an absent previously-clean check is not
  listed in *any* category: a complete report that simply stopped
  reporting a check that was never violating means it did not become a
  violator, which is not comparison-worthy on its own.

Every key present in `current` but absent from `prior` with a known
negative slack is a `entrant` (newly-observed violation); a new key with a
known non-negative slack is not reported anywhere (not a violation, not
interesting to the comparison).
"""
from __future__ import annotations

import os
from pathlib import Path

from . import core
from . import reports


REQUIRED_LIFECYCLE_STAGES = ("init", "place", "cts", "route", "postroute")


def _resolve(root, path):
    if root and not os.path.isabs(path):
        return str(Path(root) / path)
    return path


def _require(mapping, key, label="manifest"):
    """Return `mapping[key]`, or raise `AtcsError("missing-input", ...)` if absent.

    The manifest is Site-supplied evidence, not a caller-validated internal
    contract, so a missing required key must never surface as a raw
    `KeyError`.
    """
    if key not in mapping:
        raise core.AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def _scenario_name(scenario):
    return _require(scenario, "name", "scenario")


def _scenario_corner(scenario):
    return _require(scenario, "corner", "scenario")


def design_state(manifest):
    root = manifest.get("root")

    top = _require(manifest, "top")
    stage = _require(manifest, "stage")
    database = _require(manifest, "database")
    enc_rel = _require(database, "enc", "manifest.database")
    enc_dat_rel = _require(database, "encDat", "manifest.database")
    netlist_rel = _require(manifest, "netlist")

    enc_path = _resolve(root, enc_rel)
    enc_dat_path = _resolve(root, enc_dat_rel)
    database_out = {
        "path": enc_rel,
        "sha256": core.file_sha256(enc_path),
        "datDigest": core.tree_digest(enc_dat_path),
    }

    netlist_path = _resolve(root, netlist_rel)
    netlist_out = {"path": netlist_rel, "sha256": core.file_sha256(netlist_path)}

    if manifest.get("def") is not None:
        def_path = _resolve(root, manifest["def"])
        def_out = {"path": manifest["def"], "sha256": core.file_sha256(def_path)}
    else:
        def_out = None

    spef_out = {}
    for corner, rel_path in manifest.get("spef", {}).items():
        resolved = _resolve(root, rel_path)
        spef_out[corner] = {"path": rel_path, "sha256": core.file_sha256(resolved)}

    sdc_out = []
    for rel_path in manifest.get("sdc", []):
        resolved = _resolve(root, rel_path)
        sdc_out.append({"path": rel_path, "sha256": core.file_sha256(resolved)})

    scenario_names = [_scenario_name(scenario) for scenario in manifest.get("scenarios", [])]

    body = {
        "top": top,
        "stage": stage,
        "database": database_out,
        "netlist": netlist_out,
        "def": def_out,
        "spef": spef_out,
        "sdc": sdc_out,
        "tools": dict(manifest.get("tools", {})),
        "scenarios": scenario_names,
        "parentId": manifest.get("parentId"),
    }
    return core.stamp("design-state", body)


def _exists(path):
    try:
        return os.path.exists(path)
    except OSError:
        return False


def _required_corners(manifest):
    return sorted({_scenario_corner(scenario) for scenario in manifest.get("scenarios", [])})


def _check_minimum_inputs(manifest, root):
    missing = []

    database = manifest.get("database", {})
    enc = database.get("enc")
    if not enc or not _exists(_resolve(root, enc)):
        missing.append("database.enc")
    enc_dat = database.get("encDat")
    if not enc_dat or not os.path.isdir(_resolve(root, enc_dat)):
        missing.append("database.encDat")

    netlist = manifest.get("netlist")
    if not netlist or not _exists(_resolve(root, netlist)):
        missing.append("netlist")

    spef = manifest.get("spef", {})
    for corner in _required_corners(manifest):
        path = spef.get(corner)
        if not path or not _exists(_resolve(root, path)):
            missing.append(f"spef:{corner}")

    sdc_list = manifest.get("sdc", [])
    if not sdc_list:
        missing.append("sdc")
    else:
        for path in sdc_list:
            if not _exists(_resolve(root, path)):
                missing.append(f"sdc:{path}")

    libraries = manifest.get("libraries", [])
    if not libraries:
        missing.append("libraries")
    else:
        for path in libraries:
            if not _exists(_resolve(root, path)):
                missing.append(f"libraries:{path}")

    if not manifest.get("scenarios"):
        missing.append("scenarios")

    return missing


def _check_lifecycle(manifest, root):
    """Verify the full lifecycle stage set. Only called when `manifest["lifecycle"]` is present —
    the "lifecycle not provided at all" case is handled directly in `input_readiness`."""
    lifecycle = manifest["lifecycle"]
    missing = []
    unreadable_reasons = []
    stages = lifecycle.get("stages", {})
    for stage in REQUIRED_LIFECYCLE_STAGES:
        stage_entry = stages.get(stage)
        if not stage_entry:
            missing.append(f"{stage} stage missing")
            continue
        for piece in ("checkpoint", "script"):
            path = stage_entry.get(piece)
            if not path:
                missing.append(f"{stage} {piece} missing")
                continue
            resolved = _resolve(root, path)
            if not _exists(resolved):
                missing.append(f"{stage} {piece} missing")
                continue
            try:
                core.file_sha256(resolved)
            except OSError as exc:
                reason = f"{stage} {piece} unreadable: {exc}"
                unreadable_reasons.append(reason)
                missing.append(reason)

    if "flowConfig" not in lifecycle:
        missing.append("flowConfig missing")

    if unreadable_reasons:
        return core.unknown("; ".join(unreadable_reasons)), missing, False
    if missing:
        return core.known(0), missing, False
    return core.known(1), [], True


def input_readiness(manifest, site_capabilities):
    root = manifest.get("root")

    missing = _check_minimum_inputs(manifest, root)
    missing_count = core.known(len(missing))

    if manifest.get("lifecycle") is None:
        lifecycle_available = core.known(0)
        lifecycle_missing = ["lifecycle not provided"]
        scope = "post-route-only"
    else:
        lifecycle_available, lifecycle_missing, full_flow = _check_lifecycle(manifest, root)
        scope = "full-flow" if full_flow else "post-route-only"

    return core.stamp("input-readiness", {
        "missing": missing,
        "missingCount": missing_count,
        "lifecycleAvailable": lifecycle_available,
        "lifecycleMissing": lifecycle_missing,
        "scope": scope,
    })


def _read_and_track_source(path, sources):
    """Read `path` as text, append its `{"path", "sha256"}` to `sources`, return the text."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    sources.append({"path": path, "sha256": core.file_sha256(path)})
    return text


def capture(source_refs, query_spec):
    max_paths = query_spec["maxPaths"]
    required_scenarios = query_spec.get("requiredScenarios", [])
    available = source_refs.get("scenarios", {})

    missing_scenarios = [name for name in required_scenarios if name not in available]

    scenarios_out = {}
    checks_out = {}
    sources = []
    reasons = []
    all_complete = True

    for name, refs in available.items():
        global_text = _read_and_track_source(refs["globalTiming"], sources)
        setup_text = _read_and_track_source(refs["setupPaths"], sources)
        hold_text = _read_and_track_source(refs["holdPaths"], sources)
        check_text = _read_and_track_source(refs["checkTiming"], sources)

        global_timing = reports.parse_global_timing(global_text)
        check_timing = reports.parse_check_timing(check_text)
        setup_result = reports.parse_path_report(setup_text, "setup", max_paths)
        hold_result = reports.parse_path_report(hold_text, "hold", max_paths)

        for row in setup_result["paths"]:
            key = core.check_key(name, "setup", row["endpoint"])
            checks_out[key] = {
                "slack": core.known(row["slack"]),
                "startpoint": row["startpoint"],
                "pathGroup": row["pathGroup"],
            }
        for row in hold_result["paths"]:
            key = core.check_key(name, "hold", row["endpoint"])
            checks_out[key] = {
                "slack": core.known(row["slack"]),
                "startpoint": row["startpoint"],
                "pathGroup": row["pathGroup"],
            }

        scenarios_out[name] = {
            "setup": global_timing["setup"],
            "hold": global_timing["hold"],
            "unconstrained": check_timing["unconstrainedEndpoints"],
            "complete": {"setup": setup_result["complete"], "hold": hold_result["complete"]},
        }

        if not setup_result["complete"]:
            all_complete = False
            reasons.append(f"scenario {name} setup paths incomplete")
        if not hold_result["complete"]:
            all_complete = False
            reasons.append(f"scenario {name} hold paths incomplete")

    if missing_scenarios:
        all_complete = False
        reasons.extend(f"missing scenario: {name}" for name in missing_scenarios)

    return core.stamp("observation-set", {
        "designStateId": source_refs["designStateId"],
        "precision": query_spec["precision"],
        "scenarios": scenarios_out,
        "checks": checks_out,
        "missingScenarios": missing_scenarios,
        "coverage": {"complete": all_complete, "reasons": reasons},
        "sources": sources,
    })


def _resolved_slack(key, current_checks, recheck):
    if key in current_checks and core.is_known(current_checks[key]["slack"]):
        return core.value_of(current_checks[key]["slack"])
    if recheck and key in recheck and core.is_known(recheck[key]):
        return core.value_of(recheck[key])
    return None


def _current_coverage_complete(current, scenario, mode):
    """True only if `current` positively confirms complete coverage for `scenario`/`mode`.

    A scenario absent from `current["scenarios"]` entirely (e.g. it was a
    `missingScenario`) counts as incomplete, same as an explicit
    `complete[mode] = False`.
    """
    scenario_entry = current.get("scenarios", {}).get(scenario)
    if scenario_entry is None:
        return False
    return bool(scenario_entry.get("complete", {}).get(mode, False))


def compare_checks(prior, current, recheck):
    recheck = recheck or {}
    prior_checks = prior.get("checks", {})
    current_checks = current.get("checks", {})

    fixed, remaining, regressed, missing_prior = [], [], [], []

    for key, prior_entry in prior_checks.items():
        prior_slack_measure = prior_entry["slack"]
        if not core.is_known(prior_slack_measure):
            continue
        prior_negative = core.value_of(prior_slack_measure) < 0

        resolved = _resolved_slack(key, current_checks, recheck)
        if resolved is None:
            if prior_negative:
                # A real violation that can no longer be located is never
                # silently dropped, whatever current's coverage looks like.
                missing_prior.append(key)
            else:
                # It was clean before; only flag its disappearance as
                # ambiguous if current's coverage for this scenario/mode was
                # itself incomplete. A complete report that stopped
                # reporting a check that was never violating is not
                # comparison-worthy — it did not become a violator.
                scenario, mode, _endpoint = key.split("|", 2)
                if not _current_coverage_complete(current, scenario, mode):
                    missing_prior.append(key)
            continue

        current_negative = resolved < 0
        if prior_negative and not current_negative:
            fixed.append(key)
        elif prior_negative and current_negative:
            remaining.append(key)
        elif not prior_negative and current_negative:
            regressed.append(key)
        # else: non-negative in both — not tracked in any bucket.

    entrant = []
    for key, current_entry in current_checks.items():
        if key in prior_checks:
            continue
        slack_measure = current_entry["slack"]
        if core.is_known(slack_measure) and core.value_of(slack_measure) < 0:
            entrant.append(key)

    return {
        "fixed": sorted(fixed),
        "remaining": sorted(remaining),
        "entrant": sorted(entrant),
        "regressed": sorted(regressed),
        "missingPrior": sorted(missing_prior),
    }
