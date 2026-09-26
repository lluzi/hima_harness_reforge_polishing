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
  that both exist and are **hash-bound** (actually read, not just
  stat-checked — see `_hash_bind`), and ``manifest["lifecycle"]`` must also
  carry a `flowConfig` key. Each absent/non-existent piece adds one string
  to `lifecycleMissing` (e.g. ``"cts checkpoint missing"``,
  ``"flowConfig missing"``) and forces `lifecycleAvailable = known(0)` —
  there is no partial/partial-stage scope; `scope` stays
  `"post-route-only"` (never a third "resume from stage X" scope, per
  SPEC's Run contract "Auto 输入判定").
- If a checkpoint/script file exists but cannot be *read* (e.g. a
  permission error during hashing), that single fact makes the whole
  lifecycle verification inconclusive: `lifecycleAvailable =
  unknown("lifecycle checkpoint/script unreadable: <detail>")`,
  `lifecycleMissing` records the same reason, and `scope` still falls back
  to `"post-route-only"` (an unknown never promotes to `"full-flow"`).
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
endpoint)`; `atcs.reports.parse_path_report` already refuses duplicate
endpoints within a single report, so no further dedup is needed here.
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
negative — not interesting). If neither `current` nor `recheck` can
resolve the key, it goes to `missingPrior` — this is deliberately not the
same as `fixed`: a check that merely disappeared from a truncated report
was never re-observed, positively or negatively.

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


def _hash_bind_file(path):
    """Return the sha256 of `path`, or raise on any read/stat failure."""
    return core.file_sha256(path)


def design_state(manifest):
    root = manifest.get("root")

    database = manifest["database"]
    enc_path = _resolve(root, database["enc"])
    enc_dat_path = _resolve(root, database["encDat"])
    database_out = {
        "path": database["enc"],
        "sha256": _hash_bind_file(enc_path),
        "datDigest": core.tree_digest(enc_dat_path),
    }

    netlist_path = _resolve(root, manifest["netlist"])
    netlist_out = {"path": manifest["netlist"], "sha256": _hash_bind_file(netlist_path)}

    if manifest.get("def") is not None:
        def_path = _resolve(root, manifest["def"])
        def_out = {"path": manifest["def"], "sha256": _hash_bind_file(def_path)}
    else:
        def_out = None

    spef_out = {}
    for corner, rel_path in manifest.get("spef", {}).items():
        resolved = _resolve(root, rel_path)
        spef_out[corner] = {"path": rel_path, "sha256": _hash_bind_file(resolved)}

    sdc_out = []
    for rel_path in manifest.get("sdc", []):
        resolved = _resolve(root, rel_path)
        sdc_out.append({"path": rel_path, "sha256": _hash_bind_file(resolved)})

    scenario_names = [scenario["name"] for scenario in manifest.get("scenarios", [])]

    body = {
        "top": manifest["top"],
        "stage": manifest["stage"],
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
    return sorted({scenario["corner"] for scenario in manifest.get("scenarios", [])})


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
    unreadable_reason = None
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
                _hash_bind_file(resolved)
            except OSError as exc:
                unreadable_reason = f"{stage} {piece} unreadable: {exc}"
                missing.append(unreadable_reason)

    if "flowConfig" not in lifecycle:
        missing.append("flowConfig missing")

    if unreadable_reason is not None:
        return core.unknown(unreadable_reason), missing, False
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
        global_text = Path(refs["globalTiming"]).read_text(encoding="utf-8", errors="replace")
        sources.append({"path": refs["globalTiming"], "sha256": core.file_sha256(refs["globalTiming"])})

        setup_text = Path(refs["setupPaths"]).read_text(encoding="utf-8", errors="replace")
        sources.append({"path": refs["setupPaths"], "sha256": core.file_sha256(refs["setupPaths"])})

        hold_text = Path(refs["holdPaths"]).read_text(encoding="utf-8", errors="replace")
        sources.append({"path": refs["holdPaths"], "sha256": core.file_sha256(refs["holdPaths"])})

        check_text = Path(refs["checkTiming"]).read_text(encoding="utf-8", errors="replace")
        sources.append({"path": refs["checkTiming"], "sha256": core.file_sha256(refs["checkTiming"])})

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
            # Vanished from both the current report and any supplemental
            # recheck — ambiguous either way, never counted as `fixed`.
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
