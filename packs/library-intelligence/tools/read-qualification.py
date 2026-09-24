#!/usr/bin/env python3
"""Independently verify E1 receipt identity before any indicator enters a Reading."""
import hashlib
import json
import math
import os
import stat
import sys

ROLES = ("vendor-fixture", "saed14", "tsmc28")
PHASES = ("permit", "runtime", "source-hash", "read", "query", "copy",
          "re-read", "compare", "source-after-hash")


def refuse(reason):
    raise SystemExit("Library qualification reader refused: " + reason)


def plain(path):
    if os.path.realpath(path) != os.path.abspath(path):
        refuse("linked evidence path")
    try:
        if not stat.S_ISREG(os.lstat(path).st_mode):
            refuse("evidence is not a plain file")
    except OSError:
        refuse("evidence file is absent")
    return path


def sha256(path):
    digest = hashlib.sha256()
    with open(plain(path), "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            refuse("duplicate JSON key " + key)
        result[key] = value
    return result


def load(path):
    try:
        with open(plain(path)) as stream:
            return json.load(stream, object_pairs_hook=unique)
    except (OSError, UnicodeError, ValueError) as error:
        refuse("invalid JSON: " + str(error))


def read_roots(permit_path):
    roots = []
    active = False
    with open(plain(permit_path)) as stream:
        for line in stream:
            value = line.split("#", 1)[0].rstrip()
            if not value.strip():
                continue
            if not value.startswith((" ", "\t")):
                active = value == "allowedReadRoots:"
                continue
            if active:
                item = value.strip()
                if not item.startswith("- "):
                    refuse("unsupported Permit read-root list")
                root = item[2:].strip().strip("'\"")
                if not os.path.isabs(root):
                    refuse("Permit read root is not absolute")
                roots.append(os.path.realpath(root))
    return roots


def inside(path, roots):
    target = os.path.realpath(path)
    return any(target == root or target.startswith(root.rstrip(os.sep) + os.sep)
               for root in roots)


def finite_positive(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value > 0)


def query_complete(value):
    if not isinstance(value, dict) or set(value) != {"library", "units", "cellCount", "sample"}:
        return False
    if not isinstance(value["library"], str) or not value["library"]:
        return False
    units = value["units"]
    if not isinstance(units, dict) or set(units) != {"time_s", "cap_F", "voltage_V"}:
        return False
    if any(not finite_positive(number) for number in units.values()):
        return False
    if not isinstance(value["cellCount"], int) or value["cellCount"] <= 0:
        return False
    sample = value["sample"]
    if not isinstance(sample, dict) or set(sample) != {
        "cell", "area", "pin", "direction", "relatedPin",
        "timingType", "tableType", "tableSize", "firstValue"}:
        return False
    if any(not isinstance(sample[key], str) or not sample[key]
           for key in ("cell", "pin", "direction", "relatedPin",
                       "timingType", "tableType")):
        return False
    return (finite_positive(sample["tableSize"])
            and isinstance(sample["area"], (int, float))
            and not isinstance(sample["area"], bool) and math.isfinite(sample["area"])
            and isinstance(sample["firstValue"], (int, float))
            and not isinstance(sample["firstValue"], bool)
            and math.isfinite(sample["firstValue"]))


def validate(report):
    receipt = load(report)
    if receipt.get("schema") != "hima-library-qualification/1":
        refuse("receipt schema differs")
    if receipt.get("facts", "unexpected") is not None:
        refuse("E1 receipt includes facts")
    if receipt.get("permitAttestation") != "host-prelaunch":
        refuse("Permit attestation is not Host prelaunch evidence")
    manifest_path = receipt.get("manifestPath")
    permit_path = receipt.get("permitPath")
    if not isinstance(manifest_path, str) or not isinstance(permit_path, str):
        refuse("manifest or Permit identity is absent")
    if sha256(manifest_path) != receipt.get("manifestSha256"):
        refuse("manifest bytes changed")
    if sha256(permit_path) != receipt.get("permitSha256"):
        refuse("Permit bytes changed")
    roots = read_roots(permit_path)
    manifest = load(manifest_path)
    if manifest.get("schema") != "hima-library-qualification-input/1":
        refuse("manifest schema differs")
    if manifest.get("permit") != {"path": permit_path, "sha256": receipt["permitSha256"]}:
        refuse("Permit does not match bound manifest")
    license_selection = {"product": "QuaLib", "release": "2026", "selection": "new",
                         "port": 59099, "claim": "QuaLib-2026-new-59099",
                         "excludesClaim": "XTop"}
    if manifest.get("license") != license_selection:
        refuse("QuaLib 2026 new/59099 selection differs")
    runtime = manifest.get("runtime")
    producer = receipt.get("producer")
    if not isinstance(runtime, dict) or not isinstance(producer, dict):
        refuse("producer identity is absent")
    if producer != {key: runtime.get(key) for key in
                    ("apiBuild", "python", "pythonSha256",
                     "nativeModuleSha256", "parserLibrarySha256",
                     "adapterSha256", "wrapper", "wrapperRealpath",
                     "wrapperSha256")}:
        refuse("producer identity differs from manifest")
    workspace = os.path.dirname(os.path.dirname(os.path.dirname(report)))
    expected_attestation_path = os.path.join(workspace, "hima-library-host-attestation.json")
    attestation_path = receipt.get("hostAttestationPath")
    if attestation_path != expected_attestation_path:
        refuse("Host attestation is outside the exact Campaign workspace location")
    if sha256(attestation_path) != receipt.get("hostAttestationSha256"):
        refuse("Host prelaunch attestation bytes differ")
    attestation = load(attestation_path)
    launch = receipt.get("launch")
    if (not isinstance(launch, dict)
            or set(launch) != {"runId", "nodeId", "attempt", "jobSession"}
            or not isinstance(launch.get("runId"), str) or not launch["runId"]
            or launch.get("nodeId") != "qualify-api"
            or not isinstance(launch.get("attempt"), int)
            or isinstance(launch.get("attempt"), bool) or launch["attempt"] <= 0
            or not isinstance(launch.get("jobSession"), str) or not launch["jobSession"]):
        refuse("receipt launch identity is incomplete")
    if attestation.get("launch") != launch:
        refuse("receipt launch identity differs from Host attestation")
    expected_attestation = {
        "schema": "hima-library-host-attestation/1", "siteId": attestation.get("siteId"),
        "manifestPath": manifest_path, "manifestSha256": receipt["manifestSha256"],
        "permitPath": permit_path, "permitSha256": receipt["permitSha256"],
        "workspace": workspace,
        "wrapper": runtime.get("wrapper"), "wrapperRealpath": runtime.get("wrapperRealpath"),
        "wrapperSha256": runtime.get("wrapperSha256"), "license": license_selection,
        "licenseClaims": {"QuaLib-2026-new-59099": 1}, "launch": launch}
    if (not isinstance(attestation.get("siteId"), str) or not attestation["siteId"]
            or attestation != expected_attestation):
        refuse("Host prelaunch attestation content differs")
    worker = os.path.join(os.path.dirname(os.path.dirname(report)), "tools", "libapi_worker.py")
    if sha256(worker) != runtime.get("adapterSha256"):
        refuse("worker bytes differ from receipt")
    sources = manifest.get("sources")
    results = receipt.get("results")
    if not isinstance(sources, list) or not isinstance(results, list):
        refuse("source accounting is absent")
    if len(sources) != 3 or len(results) != 3:
        refuse("source accounting is incomplete")
    if [item.get("role") for item in sources] != list(ROLES):
        refuse("representative source roles differ")
    if [item.get("role") for item in results] != list(ROLES):
        refuse("result roles differ")
    native_pass = True
    preflight_refused = receipt.get("reason") == "hima/library-preflight-refused"
    if any(item.get("status") == "passed" for item in results):
        api = runtime.get("apiRoot")
        if not isinstance(api, str):
            refuse("API root is absent")
        dependencies = [
            (os.path.join(api, "tmlib.py"), runtime.get("apiMarkerSha256")),
            (os.path.join(api, "_tmlib.so"), runtime.get("nativeModuleSha256")),
            (os.path.join(api, "lib", "libparser_wrapper.so"),
             runtime.get("parserLibrarySha256")),
        ]
        for dep, expected in dependencies:
            if not inside(dep, roots) or sha256(dep) != expected:
                refuse("native API dependency bytes changed")
        python = runtime.get("python")
        if not isinstance(python, str) or not inside(python, roots):
            refuse("Python executable is outside Permit read roots")
        python_hash = hashlib.sha256()
        with open(python, "rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                python_hash.update(block)
        if python_hash.hexdigest() != runtime.get("pythonSha256"):
            refuse("Python executable bytes changed")
    for source, item in zip(sources, results):
        if (item.get("source") != source.get("path")
                or item.get("expectedSha256") != source.get("sha256")):
            refuse("result source identity differs")
        if not preflight_refused:
            if not inside(source["path"], roots):
                refuse("reader source is outside Permit read roots")
            current_sha = sha256(source["path"])
            recorded_sha = item.get("sourceAfterSha256") or item.get("sourceSha256")
            if recorded_sha is not None and current_sha != recorded_sha:
                refuse("original source changed after receipt")
        steps = item.get("steps")
        if not isinstance(steps, dict) or set(steps) != set(PHASES):
            refuse("step accounting is incomplete")
        if any(value not in ("passed", "blocked", "not-run") for value in steps.values()):
            refuse("invalid step state")
        if item.get("status") == "passed":
            if preflight_refused:
                refuse("preflight refusal cannot contain a passed input")
            if current_sha != source["sha256"]:
                refuse("passed input original source bytes changed")
            if any(value != "passed" for value in steps.values()):
                refuse("passed input has incomplete steps")
            if item.get("sourceSha256") != source["sha256"] or item.get("sourceAfterSha256") != source["sha256"]:
                refuse("passed input source hash differs")
            if item.get("exitCode") != 0 or item.get("signal") is not None or item.get("reason") is not None:
                refuse("passed input has worker failure")
            if not query_complete(item.get("queryEvidence")):
                refuse("passed input lacks complete native query evidence")
            one = os.path.join(workspace, "flow", "qualification", item["role"])
            if sha256(os.path.join(one, "worker.log")) != item.get("logSha256"):
                refuse("worker log bytes differ")
            if sha256(os.path.join(one, "progress.txt")) != item.get("progressSha256"):
                refuse("worker progress bytes differ")
            if sha256(os.path.join(one, "copy.lib")) != item.get("copySha256"):
                refuse("workspace copy bytes differ")
            child_path = os.path.join(one, "child.json")
            if sha256(child_path) != item.get("childSha256"):
                refuse("child result bytes differ")
            child = load(child_path)
            if (not isinstance(child, dict)
                    or set(child) != {"copySha256", "copyBytes", "query"}
                    or child["copySha256"] != item.get("copySha256")
                    or child["copyBytes"] != os.path.getsize(os.path.join(one, "copy.lib"))
                    or child["query"] != item["queryEvidence"]):
                refuse("query evidence differs from hashed child result")
        elif item.get("status") == "blocked":
            native_pass = False
            if item.get("reason") is None:
                refuse("blocked input lacks reason")
            if item.get("queryEvidence") is not None:
                refuse("blocked input exposes partial query")
            if item.get("logSha256") is not None:
                one = os.path.join(workspace, "flow", "qualification", item["role"])
                if sha256(os.path.join(one, "worker.log")) != item["logSha256"]:
                    refuse("failed worker log bytes differ")
                if item.get("progressSha256") is not None and sha256(
                        os.path.join(one, "progress.txt")) != item["progressSha256"]:
                    refuse("failed worker progress bytes differ")
            if item.get("copySha256") is not None:
                refuse("blocked input exposes partial copy")
            if item.get("childSha256") is not None:
                refuse("blocked input exposes partial child result")
        else:
            refuse("unknown input status")
    if receipt.get("nativeStatus") != ("passed" if native_pass else "blocked"):
        refuse("native status differs from per-input results")
    if native_pass and (receipt.get("status") != "passed" or receipt.get("reason") is not None):
        refuse("complete native pass is not admitted")
    if not native_pass and not isinstance(receipt.get("reason"), str):
        refuse("blocked qualification lacks reason")
    if not native_pass and receipt.get("status") != "blocked":
        refuse("blocked native result has a non-blocked status")
    return {"values": [{"type": "library_qualification_ok", "unit": "count",
                        "value": 1 if native_pass else 0}]}


def main():
    if len(sys.argv) != 3:
        refuse("usage: read-qualification.py REPORT OUT")
    value = validate(os.path.abspath(sys.argv[1]))
    output = sys.argv[2]
    with open(output, "x") as stream:
        json.dump(value, stream, sort_keys=True)
        stream.write("\n")


if __name__ == "__main__":
    main()
