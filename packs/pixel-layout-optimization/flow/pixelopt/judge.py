"""Judge a candidate layout with the commercial EDA tools (stdlib only).

Every candidate is judged the same way, each tool in its own directory under
``<candidate>/out/`` with its own report (``one-checker-per-session.md``):

* **DRC** authority and reference decks x 1x1/2x2/3x3 tiles, each rule file built
  by :func:`pixelopt.rules.make_rule_file` with the Site's ``drcStripFunctions``.
  A stripped rule whose id has no manifest ``interactRules`` entry of the same id
  is refused (``PixelError('schema')``): the geometry check that must replace it
  is missing.
* **LVS** from the manifest's deck template (``@LAYOUT@`` the candidate's
  ``pixel.gds``, ``@SOURCE@`` the declared schematic; a declared Cst change writes
  the ``cst.schematicTemplate`` with ``@CST_FF@`` filled from the candidate's
  ``geometry.json`` ``declaredChanges.cstFf``).
* **Extraction**: a FRESH OA library per candidate holding only the two tech
  files (``techLibOalib`` -> ``<lib>/<libName>/.oalib``, ``techLibTechDb`` ->
  ``<lib>/<libName>/tech.db``), a ``lib.defs``, ``gdsIn`` of the candidate GDS,
  then ``RCExplorer`` with the manifest's Tcl template (``@D@`` the rce dir).

Launching. When ``siteCapabilities.launcher.argv`` is non-empty and the
environment variable ``PIXELOPT_DIRECT`` is not ``"1"``, each candidate's whole
judgement is run as ONE launcher subprocess
``launcher.argv + [python, <workspace>/flow/pixel_cli.py, "num-judge-one",
<workspace>, <candidate>, <mode>]`` (with ``launcher.env`` merged); the launched
process re-enters :func:`judge_one` through :func:`judge_one_main`. Otherwise
each candidate is judged in-process. Up to ``siteCapabilities.parallelJobs``
candidates run at once.

Each candidate's ``receipt.json`` (``pixel.receipt/1``) records every report's
path (relative to the workspace), sha256 and rc, the measurement options (deck /
schematic / extraction sha256s, the rule-file records, tool versions),
``freshLibrary``, the ``declaredChanges`` read from ``geometry.json`` and the
elapsed seconds.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

from . import core, manifest as manifest_mod, reports, rules
from .core import PixelError

__all__ = ["judge", "judge_one", "judge_one_main"]

_TILES = [
    ("1x1", "pixel.gds", ""),
    ("2x2", "pixel2x2.gds", "2x2"),
    ("3x3", "pixel3x3.gds", "3x3"),
]
_DECKS = ["authority", "reference"]

_DEFAULT_TIMEOUTS = {"drc": 300, "lvs": 300, "gdsIn": 300, "rce": 900}


# --------------------------------------------------------------------------- #
# Environment
# --------------------------------------------------------------------------- #

def _source_env(sitecaps):
    """Merge ``os.environ``, each ``envScripts`` entry's env and ``sitecaps.env``.

    Each script is sourced once in a fresh ``bash`` and its null-delimited ``env``
    captured; a script that cannot be sourced is skipped.
    """
    env = dict(os.environ)
    for script in sitecaps.get("envScripts", []) or []:
        try:
            out = subprocess.run(
                ["bash", "-c", 'source "$1" >/dev/null 2>&1; env -0', "_", script],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
        except (OSError, ValueError):
            continue
        if out.returncode != 0 or not out.stdout:
            continue
        for chunk in out.stdout.split(b"\x00"):
            if not chunk:
                continue
            k, _, v = chunk.decode("utf-8", "replace").partition("=")
            if k:
                env[k] = v
    for k, v in (sitecaps.get("env", {}) or {}).items():
        env[str(k)] = str(v)
    return env


_VAR_RE = re.compile(r"\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)")


def _expandvars(text, env):
    """Expand ``$VAR`` / ``${VAR}`` from ``env`` (unknown vars drop to empty)."""
    def repl(m):
        name = m.group(1) or m.group(2)
        return env.get(name, "")
    return _VAR_RE.sub(repl, text or "")


# --------------------------------------------------------------------------- #
# Running one tool
# --------------------------------------------------------------------------- #

def _run(argv, cwd, env, timeout, log_path):
    """Run ``argv`` in ``cwd`` with ``env``, logging to ``log_path``; return rc.

    A timeout yields rc 124 (as the shell ``timeout`` would); a missing
    executable yields rc 127. The tool's own non-zero exit is returned, not
    raised: a failed tool is recorded in the receipt, not a crash.
    """
    argv = [str(a) for a in argv]
    env = {str(k): str(v) for k, v in env.items()}
    try:
        with open(log_path, "wb") as log:
            proc = subprocess.run(argv, cwd=cwd, env=env, stdout=log,
                                  stderr=subprocess.STDOUT, timeout=timeout)
        return proc.returncode
    except subprocess.TimeoutExpired:
        with open(log_path, "ab") as log:
            log.write(b"\n[reaper] timeout\n")
        return 124
    except OSError as exc:
        with open(log_path, "ab") as log:
            log.write(("\n[reaper] cannot exec: %s\n" % exc).encode())
        return 127


def _sha_or_none(path):
    if os.path.exists(path):
        return core.sha256_file(path)
    return None


def _rel(path, workspace):
    return os.path.relpath(os.path.abspath(path), os.path.abspath(workspace))


def _timeout(sitecaps, key):
    t = (sitecaps.get("timeoutsS") or {})
    return t.get(key, _DEFAULT_TIMEOUTS.get(key, 300))


# --------------------------------------------------------------------------- #
# geometry.json helpers
# --------------------------------------------------------------------------- #

def _read_geometry(candidate_dir):
    """Read ``<candidate>/geometry.json`` if present, else ``None``."""
    path = os.path.join(candidate_dir, "geometry.json")
    if not os.path.exists(path):
        return None
    return core.read_json(path)


def _declared_changes(geometry):
    if isinstance(geometry, dict):
        dc = geometry.get("declaredChanges")
        if isinstance(dc, dict):
            return dc
    return {}


# --------------------------------------------------------------------------- #
# DRC
# --------------------------------------------------------------------------- #

def _strip_allowed(case):
    ids = set()
    for entry in case.raw.get("interactRules", []) or []:
        if isinstance(entry, dict) and "id" in entry:
            ids.add(entry["id"])
    return ids


def _judge_drc(candidate_dir, out_dir, case, sitecaps, env, workspace):
    """Run both decks on all three tiles; return (reports, options_decks, records)."""
    strip = tuple(sitecaps.get("drcStripFunctions", []) or [])
    allowed = _strip_allowed(case)
    deck_text = {}
    deck_sha = {}
    for deck in _DECKS:
        ref = case.raw["decks"][deck]
        path = case.file(ref)
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            deck_text[deck] = fh.read()
        deck_sha[deck] = ref["sha256"]

    top1x1 = case.candidate_top_cell
    results = []
    records = {}
    timeout = _timeout(sitecaps, "drc")
    for deck in _DECKS:
        for tile, gds_name, suffix in _TILES:
            d = os.path.join(out_dir, "drc_%s_%s" % (deck, tile))
            os.makedirs(d, exist_ok=True)
            gds_path = os.path.join(candidate_dir, gds_name)
            top = top1x1 + suffix
            text, record = rules.make_rule_file(deck_text[deck], gds_path, top, strip)
            bad = [rid for rid in record["stripped"] if rid not in allowed]
            if bad:
                raise PixelError(
                    "schema",
                    "deck '%s' strips rule(s) %s with no interactRules entry"
                    % (deck, ", ".join(sorted(bad))))
            records[deck] = record
            with open(os.path.join(d, "rule"), "w", encoding="utf-8") as fh:
                fh.write(text)
            rc = _run(list(sitecaps["tools"]["argus"]) + ["rule"], d, env,
                      timeout, os.path.join(d, "argus.log"))
            with open(os.path.join(d, "rc"), "w") as fh:
                fh.write(str(rc))
            sum_path = os.path.join(d, "argus_drc.sum")
            results.append({
                "kind": "drc", "deck": deck, "tile": tile,
                "path": _rel(sum_path, workspace),
                "sha256": _sha_or_none(sum_path), "rc": rc,
            })
    return results, {"authority": deck_sha["authority"],
                     "reference": deck_sha["reference"]}, records


# --------------------------------------------------------------------------- #
# LVS
# --------------------------------------------------------------------------- #

def _judge_lvs(candidate_dir, out_dir, case, sitecaps, env, workspace, declared):
    """Run LVS; return (report, schematic_sha, cst_template_sha)."""
    lvs = case.raw["lvs"]
    tmpl_ref = lvs["deckTemplate"]
    with open(case.file(tmpl_ref), "r", encoding="utf-8", errors="replace") as fh:
        template = fh.read()

    d = os.path.join(out_dir, "lvs")
    os.makedirs(d, exist_ok=True)

    base_schematic_ref = lvs["schematic"]
    schematic_sha = base_schematic_ref["sha256"]
    cst_tmpl_sha = None

    cst_ff = declared.get("cstFf")
    if cst_ff is not None and case.raw.get("cst", {}).get("schematicTemplate"):
        cst_ref = case.raw["cst"]["schematicTemplate"]
        cst_tmpl_sha = cst_ref["sha256"]
        with open(case.file(cst_ref), "r", encoding="utf-8", errors="replace") as fh:
            cst_text = fh.read()
        source_path = os.path.join(d, "source_cst.sp")
        with open(source_path, "w", encoding="utf-8") as fh:
            fh.write(cst_text.replace("@CST_FF@", repr(float(cst_ff))))
    else:
        source_path = case.file(base_schematic_ref)

    gds_path = os.path.join(candidate_dir, "pixel.gds")
    runset = template.replace("@LAYOUT@", gds_path).replace("@SOURCE@", source_path)
    with open(os.path.join(d, "rules.svrf"), "w", encoding="utf-8") as fh:
        fh.write(runset)

    rc = _run(list(sitecaps["tools"]["calibre"]) + ["rules.svrf"], d, env,
              _timeout(sitecaps, "lvs"), os.path.join(d, "cal.log"))
    with open(os.path.join(d, "rc"), "w") as fh:
        fh.write(str(rc))
    rep_path = os.path.join(d, "lvs.rep")
    report = {"kind": "lvs", "deck": None, "tile": None,
              "path": _rel(rep_path, workspace),
              "sha256": _sha_or_none(rep_path), "rc": rc}
    return report, schematic_sha, cst_tmpl_sha


# --------------------------------------------------------------------------- #
# Extraction (gdsIn into a fresh library, then RCExplorer)
# --------------------------------------------------------------------------- #

def _judge_extraction(candidate_dir, out_dir, case, sitecaps, env, workspace):
    """Run gdsIn + RCExplorer; return (reports, extraction_sha, freshLibrary)."""
    ext = case.raw["extraction"]
    lib_name = ext["libName"]
    cell = case.candidate_top_cell
    rce = os.path.join(out_dir, "rce")
    lib_root = os.path.join(rce, "lib")
    lib_dir = os.path.join(lib_root, lib_name)

    was_fresh = not os.path.exists(lib_dir)
    os.makedirs(lib_dir, exist_ok=True)
    shutil.copyfile(case.file(ext["techLibOalib"]), os.path.join(lib_dir, ".oalib"))
    shutil.copyfile(case.file(ext["techLibTechDb"]), os.path.join(lib_dir, "tech.db"))
    only_two = sorted(os.listdir(lib_dir)) == [".oalib", "tech.db"]
    fresh_library = bool(was_fresh and only_two)

    with open(os.path.join(lib_root, "lib.defs"), "w", encoding="utf-8") as fh:
        fh.write("DEFINE %s %s\nASSIGN %s libMode shared\n"
                 % (lib_name, lib_dir, lib_name))

    layer_map_src = case.file(ext["layerMap"])
    layer_map_name = os.path.basename(layer_map_src)
    shutil.copyfile(layer_map_src, os.path.join(lib_root, layer_map_name))

    gds_path = os.path.join(candidate_dir, "pixel.gds")
    gds_env = dict(env)
    lib_path = _expandvars(sitecaps.get("gdsInLibraryPath", "") or "", env)
    if lib_path:
        existing = gds_env.get("LD_LIBRARY_PATH", "")
        gds_env["LD_LIBRARY_PATH"] = lib_path + ((":" + existing) if existing else "")

    gdsin_argv = list(sitecaps["tools"]["gdsIn"]) + [
        "-lib", lib_name, "-gds", gds_path, "-cell", cell,
        "-layerMap", layer_map_name, "-overwrite"]
    gdsin_rc = _run(gdsin_argv, lib_root, gds_env, _timeout(sitecaps, "gdsIn"),
                    os.path.join(lib_root, "gdsin.log"))
    with open(os.path.join(lib_root, "gdsin.rc"), "w") as fh:
        fh.write(str(gdsin_rc))

    results = [{
        "kind": "gdsin", "deck": None, "tile": None,
        "path": _rel(os.path.join(lib_root, "gdsin.log"), workspace),
        "sha256": _sha_or_none(os.path.join(lib_root, "gdsin.log")), "rc": gdsin_rc,
    }]

    layout_oa = os.path.join(lib_dir, cell, "layout", "layout.oa")
    rce_rc = None
    if gdsin_rc == 0 and os.path.exists(layout_oa):
        with open(case.file(ext["tclTemplate"]), "r", encoding="utf-8",
                  errors="replace") as fh:
            tcl = fh.read()
        tcl = tcl.replace("@D@", rce)
        tcl_path = os.path.join(rce, "RCEInput.tcl")
        with open(tcl_path, "w", encoding="utf-8") as fh:
            fh.write(tcl)
        for key in ("etf", "layerMapBool"):
            src = case.file(ext[key])
            shutil.copyfile(src, os.path.join(rce, os.path.basename(src)))
        rce_rc = _run(list(sitecaps["tools"]["rcexplorer"]) + [tcl_path], lib_root,
                      env, _timeout(sitecaps, "rce"),
                      os.path.join(lib_root, "rce.log"))
        with open(os.path.join(lib_root, "rce.rc"), "w") as fh:
            fh.write(str(rce_rc))

    sp_path = os.path.join(rce, "RCEResult.sp")
    results.append({
        "kind": "rce", "deck": None, "tile": None,
        "path": _rel(sp_path, workspace),
        "sha256": _sha_or_none(sp_path), "rc": rce_rc,
    })
    extraction_sha = {}
    for key in ("techLibOalib", "techLibTechDb", "layerMap", "etf",
                "layerMapBool", "tclTemplate"):
        if key in ext and isinstance(ext[key], dict):
            extraction_sha[key] = ext[key].get("sha256")
    return results, extraction_sha, fresh_library


# --------------------------------------------------------------------------- #
# One candidate
# --------------------------------------------------------------------------- #

def _collect_versions(out_dir, mode):
    """Scrape tool versions from the logs written this judgement."""
    versions = {}
    logs = [os.path.join(out_dir, "drc_authority_1x1", "argus.log")]
    if mode == "full":
        logs += [os.path.join(out_dir, "lvs", "cal.log"),
                 os.path.join(out_dir, "rce", "lib", "gdsin.log"),
                 os.path.join(out_dir, "rce", "lib", "rce.log")]
    for log in logs:
        if os.path.exists(log):
            with open(log, "r", encoding="utf-8", errors="replace") as fh:
                versions.update(reports.tool_versions(fh.read()))
    return versions


def judge_one(candidate_dir, workspace, case, sitecaps, mode="full"):
    """Judge one candidate in-process; write and return its ``receipt.json``.

    This is the in-container worker: it runs the tools directly, never through
    the launcher. ``candidate_dir`` holds ``pixel.gds`` / ``pixel2x2.gds`` /
    ``pixel3x3.gds`` and ``geometry.json``; all reports and ``receipt.json`` are
    written under it.
    """
    candidate_dir = os.path.abspath(candidate_dir)
    workspace = os.path.abspath(workspace)
    if mode not in ("full", "drc"):
        raise PixelError("schema", "unknown judge mode %r" % (mode,))

    out_dir = os.path.join(candidate_dir, "out")
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)

    env = _source_env(sitecaps)
    geometry = _read_geometry(candidate_dir)
    declared = _declared_changes(geometry)

    start = time.time()
    report_list = []

    drc_reports, deck_shas, records = _judge_drc(
        candidate_dir, out_dir, case, sitecaps, env, workspace)
    report_list.extend(drc_reports)

    options = {
        "decks": deck_shas,
        "dbPrecision": True,
        "ruleRecords": records,
        "lvsDeck": None,
        "schematic": None,
        "cstSchematicTemplate": None,
        "extraction": {},
    }
    fresh_library = False

    if mode == "full":
        lvs_report, schematic_sha, cst_tmpl_sha = _judge_lvs(
            candidate_dir, out_dir, case, sitecaps, env, workspace, declared)
        report_list.append(lvs_report)
        options["lvsDeck"] = case.raw["lvs"]["deckTemplate"]["sha256"]
        options["schematic"] = schematic_sha
        options["cstSchematicTemplate"] = cst_tmpl_sha

        ext_reports, extraction_sha, fresh_library = _judge_extraction(
            candidate_dir, out_dir, case, sitecaps, env, workspace)
        report_list.extend(ext_reports)
        options["extraction"] = extraction_sha
    else:
        # drc mode records the extraction option digests without running tools,
        # so the Reader can still assert them against case readiness.
        ext = case.raw.get("extraction", {})
        options["lvsDeck"] = case.raw.get("lvs", {}).get("deckTemplate", {}).get("sha256")
        options["schematic"] = case.raw.get("lvs", {}).get("schematic", {}).get("sha256")
        extraction_sha = {}
        for key in ("techLibOalib", "techLibTechDb", "layerMap", "etf",
                    "layerMapBool", "tclTemplate"):
            if isinstance(ext.get(key), dict):
                extraction_sha[key] = ext[key].get("sha256")
        options["extraction"] = extraction_sha

    options["versions"] = _collect_versions(out_dir, mode)

    geom_path = os.path.join(candidate_dir, "geometry.json")
    if os.path.exists(geom_path):
        report_list.append({
            "kind": "geometry", "deck": None, "tile": None,
            "path": _rel(geom_path, workspace),
            "sha256": core.sha256_file(geom_path), "rc": None})

    receipt = {
        "schema": "pixel.receipt/1",
        "candidate": os.path.basename(candidate_dir.rstrip(os.sep)),
        "mode": mode,
        "reports": report_list,
        "options": options,
        "freshLibrary": fresh_library,
        "declaredChanges": declared,
        "seconds": round(time.time() - start, 3),
    }
    core.check(receipt, "receipt")
    receipt_path = os.path.join(candidate_dir, "receipt.json")
    core.write_json(receipt_path, receipt)
    with open(os.path.join(out_dir, "seconds"), "w") as fh:
        fh.write(str(receipt["seconds"]))
    with open(os.path.join(out_dir, "DONE"), "w") as fh:
        fh.write("")
    return receipt


# --------------------------------------------------------------------------- #
# Many candidates
# --------------------------------------------------------------------------- #

def _launcher_active(sitecaps):
    launcher = sitecaps.get("launcher", {}) or {}
    argv = launcher.get("argv", []) or []
    return bool(argv) and os.environ.get("PIXELOPT_DIRECT") != "1"


def _write_context(workspace, readiness):
    """Record the manifest / sitecaps paths a launched worker reloads."""
    paths = (readiness or {}).get("paths", {})
    manifest_path = paths.get("manifest")
    sitecaps_path = paths.get("sitecaps")
    if not manifest_path or not sitecaps_path:
        raise PixelError(
            "schema",
            "launcher mode needs readiness['paths'] with 'manifest' and 'sitecaps'")
    ctx = {"manifestPath": os.path.abspath(manifest_path),
           "sitecapsPath": os.path.abspath(sitecaps_path)}
    core.write_json(os.path.join(workspace, "state", "judge-context.json"), ctx)


def _judge_via_launcher(cand_dir, workspace, sitecaps, mode):
    launcher = sitecaps.get("launcher", {}) or {}
    cli = os.path.join(workspace, "flow", "pixel_cli.py")
    argv = list(launcher.get("argv", [])) + [
        sitecaps["python"], cli, "num-judge-one", workspace, cand_dir, mode]
    env = _source_env(sitecaps)
    for k, v in (launcher.get("env", {}) or {}).items():
        env[str(k)] = str(v)
    _run(argv, workspace, env, _timeout(sitecaps, "rce") + 1800,
         os.path.join(cand_dir, "launcher.log"))
    return core.read_json(os.path.join(cand_dir, "receipt.json"))


def judge(cands, workspace, case, sitecaps, readiness, mode="full"):
    """Judge every candidate (up to ``parallelJobs`` at once); return receipts.

    ``cands`` is ``[{"id", "dir"}, ...]``. ``readiness`` is the case-readiness
    dict; it is read only to carry ``paths`` (manifest / sitecaps) through to a
    launched worker, and otherwise unused by the judge itself.
    """
    workspace = os.path.abspath(workspace)
    use_launcher = _launcher_active(sitecaps)
    if use_launcher:
        _write_context(workspace, readiness)

    def one(cand):
        cand_dir = os.path.abspath(cand["dir"])
        if use_launcher:
            return _judge_via_launcher(cand_dir, workspace, sitecaps, mode)
        return judge_one(cand_dir, workspace, case, sitecaps, mode)

    jobs = max(1, int(sitecaps.get("parallelJobs", 1) or 1))
    receipts = [None] * len(cands)
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(one, c): i for i, c in enumerate(cands)}
        for fut in futures:
            idx = futures[fut]
            receipts[idx] = fut.result()
    return receipts


def judge_one_main(argv):
    """CLI entry for ``num-judge-one <workspace> <candidate> <mode>``.

    Reloads the case and site-capabilities from the context file
    ``<workspace>/state/judge-context.json`` (written by :func:`judge` before
    launching) and judges the one candidate in-process. Returns a process code
    (0 on success).
    """
    if len(argv) < 3:
        raise PixelError("schema",
                         "num-judge-one needs <workspace> <candidate> <mode>")
    workspace, candidate_dir, mode = argv[0], argv[1], argv[2]
    ctx = core.read_json(os.path.join(workspace, "state", "judge-context.json"))
    case = manifest_mod.load_case(ctx["manifestPath"], verify=False)
    sitecaps = manifest_mod.load_sitecaps(ctx["sitecapsPath"])
    judge_one(candidate_dir, workspace, case, sitecaps, mode)
    return 0
