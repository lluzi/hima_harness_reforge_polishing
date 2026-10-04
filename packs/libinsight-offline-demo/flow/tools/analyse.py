#!/usr/bin/env python3
"""Offline LibInsight analysis of a prepared store, into the Campaign workspace.

Demo scope only. This tool runs `python3 -m libinsight.batch analyse` against an already-prepared
LibInsight store and Kit Release. It reads no vendor Liberty runtime and needs no vendor seat; the
only step it ever invokes is the offline `analyse` subcommand. The LibInsight repository is a
read-only input; every output is written under the Campaign workspace (never into the repository's
own data/derived). See INTENT.md and knowledge/analysis-method.md for the full safety boundary.

argv: analyse.py <WORKSPACE> <LIBINSIGHT_ROOT> <KIT>
"""
import json
import os
import subprocess
import sys
import time


def fail(message):
    print("libinsight-offline-demo analyse: " + message, file=sys.stderr)
    raise SystemExit(2)


def main(argv):
    if len(argv) != 4:
        fail("usage: analyse.py <WORKSPACE> <LIBINSIGHT_ROOT> <KIT>")
    workspace = os.path.abspath(argv[1])
    root = os.path.abspath(argv[2])
    kit = argv[3]

    # A kit name is a plain token: it names a manifest file and an output directory, nothing else.
    if not kit or any(ch in kit for ch in "/\\.") or not all(c.isalnum() or c == "-" for c in kit):
        fail("kit %r is not a plain kit token" % kit)

    manifest_path = os.path.join(root, "kits", kit + ".json")
    store_root = os.path.join(root, "data", "store")
    if not os.path.isfile(manifest_path):
        fail("the LibInsight root has no kits/%s.json (looked at %s)" % (kit, manifest_path))
    if not os.path.isdir(store_root):
        fail("the LibInsight root has no data/store (looked at %s)" % store_root)

    # Refuse before launching if the Kit references store files that are not present. We read the
    # manifest's own variant/file declarations rather than importing libinsight, so this validation
    # pulls in no analysis dependency.
    try:
        manifest = json.load(open(manifest_path))
    except (OSError, ValueError) as error:
        fail("kits/%s.json is not readable JSON: %s" % (kit, error))
    refs = []
    for variant in manifest.get("variants", []):
        for ref in variant.get("files", []):
            refs.append(ref.get("store"))
    if not refs:
        fail("kits/%s.json declares no variant files" % kit)
    missing = []
    for store in refs:
        if not store or not os.path.isdir(os.path.join(store_root, store)) \
                or not os.path.isfile(os.path.join(store_root, store, "lib.json")):
            missing.append(store)
    if missing:
        fail("the Kit references %d store file(s) missing from data/store, e.g. %s"
             % (len(missing), ", ".join(filter(None, missing[:3]))))

    out = os.path.join(workspace, "derived", kit)
    os.makedirs(out, exist_ok=True)

    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"      # never leave .pyc bytecode inside the read-only root
    env["PYTHONPATH"] = root + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")

    t0 = time.time()
    analysis = subprocess.run(
        [sys.executable, "-m", "libinsight.batch", "analyse",
         "--kit", os.path.join("kits", kit + ".json"),
         "--store", os.path.join("data", "store"),
         "--out", out, "--jobs", "6"],
        cwd=root, env=env, capture_output=True, text=True)
    runtime_seconds = round(time.time() - t0, 1)
    sys.stderr.write(analysis.stderr)
    if analysis.returncode != 0:
        fail("libinsight.batch analyse exited %d" % analysis.returncode)

    kit_json_path = os.path.join(out, "kit.json")
    if not os.path.isfile(kit_json_path):
        fail("analysis produced no kit.json at %s" % kit_json_path)
    info = json.load(open(kit_json_path))
    files = info.get("files", [])
    files_analysed = sum(1 for f in files if f.get("status") == "ok")
    findings_total = int(info.get("run", {}).get("findings", 0))

    # Copy the pre-existing reliability calibration (a read-only input produced earlier by a step
    # this demo never runs) into the workspace output so the report and the prototype UI can show
    # reliability. Reads from data/derived; writes only to the workspace.
    source_derived = os.path.join(root, "data", "derived", kit)
    copied_calibration = []
    cal_json = os.path.join(source_derived, "calibration.json")
    if os.path.isfile(cal_json):
        _copy_file(cal_json, os.path.join(out, "calibration.json"))
        copied_calibration.append("calibration.json")
    cal_dir = os.path.join(source_derived, "calibration")
    if os.path.isdir(cal_dir):
        _copy_tree(cal_dir, os.path.join(out, "calibration"))
        copied_calibration.append("calibration/")

    manifest_out = {
        "schema": "hima-libinsight-offline-run/1",
        "kit": kit,
        "libInsightRoot": root,
        "libInsightCommit": _commit(root),
        "outDir": out,
        "filesDeclared": len(refs),
        "files_analysed": files_analysed,
        "findingsTotal": findings_total,
        "causesTotal": int(info.get("run", {}).get("causes", 0)),
        "signaturesTotal": int(info.get("run", {}).get("signatures", 0)),
        "runtimeSeconds": runtime_seconds,
        "libInsightVersion": info.get("run", {}).get("version"),
        "python": info.get("run", {}).get("python"),
        "numpy": info.get("run", {}).get("numpy"),
        "calibrationCopied": copied_calibration,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "note": "Offline demo analysis over a prepared store; only the offline analyse step was run.",
    }
    manifest_target = os.path.join(workspace, "derived", "run-manifest.json")
    with open(manifest_target, "w") as stream:
        json.dump(manifest_out, stream, indent=1)
    print(json.dumps({"kit": kit, "files_analysed": files_analysed, "findingsTotal": findings_total,
                      "runtimeSeconds": runtime_seconds, "out": out}))


def _copy_file(source, target):
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(source, "rb") as src, open(target, "wb") as dst:
        dst.write(src.read())


def _copy_tree(source, target):
    os.makedirs(target, exist_ok=True)
    for name in os.listdir(source):
        s = os.path.join(source, name)
        t = os.path.join(target, name)
        if os.path.isdir(s):
            _copy_tree(s, t)
        else:
            _copy_file(s, t)


def _commit(root):
    """The LibInsight commit, read without writing into the root: git when it answers, else .git/HEAD."""
    try:
        result = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"],
                                capture_output=True, text=True, timeout=10)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    head = os.path.join(root, ".git", "HEAD")
    try:
        text = open(head).read().strip()
    except OSError:
        return None
    if text.startswith("ref:"):
        ref = text.split(":", 1)[1].strip()
        try:
            return open(os.path.join(root, ".git", ref)).read().strip()
        except OSError:
            packed = os.path.join(root, ".git", "packed-refs")
            try:
                for line in open(packed):
                    line = line.strip()
                    if line and not line.startswith("#") and line.endswith(" " + ref):
                        return line.split(" ", 1)[0]
            except OSError:
                return None
        return None
    return text


if __name__ == "__main__":
    try:
        main(sys.argv)
    except SystemExit:
        raise
    except Exception as error:  # surfaced, never swallowed into a silent partial output
        print("libinsight-offline-demo analyse: %s: %s" % (type(error).__name__, error), file=sys.stderr)
        raise SystemExit(2)
