#!/usr/bin/env python3
"""Manual bounded E1 probe source; the default Pack has no launch tool."""
import hashlib
import json
import math
import os
import stat
import subprocess
import sys
import time

SCHEMA = "hima-library-qualification/1"
ROLES = ("vendor-fixture", "saed14", "tsmc28")
PHASES = ("permit", "runtime", "source-hash", "read", "query", "copy", "re-read",
          "compare", "source-after-hash")
WRAPPER = "/usr/local/bin/edarun"


def sha256(path):
    result = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def plain(path):
    if not isinstance(path, str) or not os.path.isabs(path):
        raise ValueError("path is not absolute")
    if os.path.realpath(path) != os.path.abspath(path):
        raise ValueError("path contains a symlink")
    if not stat.S_ISREG(os.lstat(path).st_mode):
        raise ValueError("path is not a plain file")
    return path


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key " + key)
        result[key] = value
    return result


def read_json(path):
    with open(plain(path), "r") as stream:
        return json.load(stream, object_pairs_hook=unique)


def inside(path, roots):
    target = os.path.realpath(path)
    return any(target == root or target.startswith(root.rstrip(os.sep) + os.sep)
               for root in roots)


def permit_lists(path, expected):
    if sha256(plain(path)) != expected:
        raise ValueError("Permit SHA-256 mismatch")
    # The Site's simple block-list Permit form. Refuse unfamiliar YAML syntax instead
    # of interpreting a broader language differently from the Host.
    values = {"allowedReadRoots": [], "allowedWriteRoots": [],
              "allowedWrappers": []}
    active = None
    for raw in open(path, "r"):
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith((" ", "\t")):
            key, sep, rest = line.partition(":")
            if not sep or rest.strip():
                raise ValueError("unsupported Permit YAML")
            active = key if key in values else None
            continue
        if active is None:
            continue
        stripped = line.strip()
        if not stripped.startswith("- ") or not stripped[2:].strip():
            raise ValueError("unsupported Permit list")
        value = stripped[2:].strip().strip("'\"")
        values[active].append(value)
    for key in ("allowedReadRoots", "allowedWriteRoots"):
        if not values[key] or any(not os.path.isabs(v) for v in values[key]):
            raise ValueError("Permit has no absolute " + key)
    return values


def write_json_once(path, value):
    encoded = (json.dumps(value, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())


def step_map():
    return {name: "not-run" for name in PHASES}


def result(role, source, expected):
    return {"role": role, "source": source, "expectedSha256": expected,
            "sourceSha256": None, "sourceAfterSha256": None, "status": "blocked",
            "reason": "hima/library-not-run", "steps": step_map(),
            "exitCode": None, "signal": None, "logSha256": None,
            "progressSha256": None, "copySha256": None, "childSha256": None,
            "queryEvidence": None}


def snapshot(lib):
    name = lib.name()
    units = {}
    for key, method in (("time_s", "getTimeUnit"), ("cap_F", "getCapUnit"),
                        ("voltage_V", "getVoltageUnit")):
        value = float(getattr(lib, method)())
        if not math.isfinite(value) or value <= 0:
            raise ValueError("invalid native unit " + key)
        units[key] = value
    cells = lib.getLibertyCells()
    count = cells.size()
    if not isinstance(name, str) or not name or count <= 0:
        raise ValueError("missing native library name or Cells")
    for index in range(count):
        cell = cells[index]
        for pin in cell.getAllLibertyPins():
            if pin.isPgPin():
                continue
            arcs = pin.getTimingGroups(False)
            for arc_index in range(arcs.size()):
                arc = arcs[arc_index]
                tables = arc.getDataGroups()
                for table_index in range(tables.size()):
                    table = tables[table_index]
                    if table.isCcsModel() or table.isVectorModel():
                        continue
                    values = table.getValues()
                    if values.size() == 0:
                        continue
                    first = float(values[0])
                    if not math.isfinite(first):
                        raise ValueError("nonfinite native timing value")
                    area = float(cell.getArea())
                    if not math.isfinite(area):
                        raise ValueError("nonfinite native Cell area")
                    sample = {"cell": cell.name(), "area": area,
                              "pin": pin.name(), "direction": pin.getDirectionStr(),
                              "relatedPin": arc.getRelatedPinName(),
                              "timingType": arc.getTimingTypeStr(),
                              "tableType": table.getTypeStr(),
                              "tableSize": values.size(), "firstValue": first}
                    if any(not isinstance(sample[key], str) or not sample[key]
                           for key in ("cell", "pin", "direction", "relatedPin",
                                       "timingType", "tableType")):
                        raise ValueError("native Cell/pin/arc/table identity is incomplete")
                    return {"library": name, "units": units, "cellCount": count,
                            "sample": sample}
    raise ValueError("no representative finite NLDM table")


def same(before, after):
    if before["library"] != after["library"] or before["units"] != after["units"]:
        return False
    if before["cellCount"] != after["cellCount"]:
        return False
    a, b = before["sample"], after["sample"]
    for key in ("cell", "pin", "direction", "relatedPin", "timingType", "tableType",
                "tableSize"):
        if a[key] != b[key]:
            return False
    return all(math.isclose(a[key], b[key], rel_tol=1e-5, abs_tol=1e-12)
               for key in ("area", "firstValue"))


def child(source, output):
    import tmlib  # Native objects never leave this process.
    progress = os.path.join(output, "progress.txt")
    def mark(phase):
        with open(progress, "a") as stream:
            stream.write(phase + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    first = None
    second = None
    try:
        first = tmlib.readTmlib(source, os.path.join(output, "source.parser.log"))
        if first.isNull():
            raise ValueError("null source handle")
        mark("read")
        before = snapshot(first)
        mark("query")
        copy = os.path.join(output, "copy.lib")
        if os.path.exists(copy) or not first.outputLib(copy):
            raise ValueError("copy write failed or target already exists")
        mark("copy")
        tmlib.releaseTmlib(first)
        first = None
        second = tmlib.readTmlib(copy, os.path.join(output, "copy.parser.log"))
        if second.isNull():
            raise ValueError("null copy handle")
        mark("re-read")
        after = snapshot(second)
        if not same(before, after):
            raise ValueError("copy query invariants differ")
        mark("compare")
        write_json_once(os.path.join(output, "child.json"),
                        {"copySha256": sha256(copy), "copyBytes": os.path.getsize(copy),
                         "query": before})
    finally:
        if first is not None:
            tmlib.releaseTmlib(first)
        if second is not None:
            tmlib.releaseTmlib(second)


def validate_manifest(value):
    if not isinstance(value, dict) or set(value) != {"schema", "runtime", "permit", "license", "sources"}:
        raise ValueError("qualification manifest keys differ")
    if value["schema"] != "hima-library-qualification-input/1":
        raise ValueError("qualification manifest schema differs")
    runtime, permit, sources = value["runtime"], value["permit"], value["sources"]
    if not isinstance(runtime, dict) or set(runtime) != {
        "wrapper", "wrapperRealpath", "wrapperSha256",
        "python", "pythonSha256", "pythonVersion", "apiRoot", "apiBuild",
        "apiMarker", "apiMarkerSha256", "nativeModule",
        "nativeModuleSha256", "parserLibrarySha256", "adapterSha256"}:
        raise ValueError("runtime identity is incomplete")
    if not isinstance(permit, dict) or set(permit) != {"path", "sha256"}:
        raise ValueError("Permit identity is incomplete")
    license_selection = value["license"]
    if license_selection != {"product": "QuaLib", "release": "2026",
                             "selection": "new", "port": 59099,
                             "claim": "QuaLib-2026-new-59099",
                             "excludesClaim": "XTop"}:
        raise ValueError("QuaLib 2026 new/59099 selection is not exact")
    if not isinstance(sources, list) or len(sources) != 3:
        raise ValueError("exactly three representative sources are required")
    if [item.get("role") for item in sources if isinstance(item, dict)] != list(ROLES):
        raise ValueError("representative source order differs")
    for item in sources:
        if set(item) != {"role", "path", "sha256"}:
            raise ValueError("source identity is incomplete")
        if not isinstance(item["sha256"], str) or len(item["sha256"]) != 64:
            raise ValueError("source SHA-256 is invalid")
    return runtime, permit, license_selection, sources


def host_attestation(workspace, manifest_path, manifest_sha, runtime, permit,
                     license_selection):
    path = plain(os.path.join(workspace, "hima-library-host-attestation.json"))
    value = read_json(path)
    launch = value.get("launch")
    if (not isinstance(launch, dict)
            or set(launch) != {"runId", "nodeId", "attempt", "jobSession"}
            or not isinstance(launch["runId"], str) or not launch["runId"]
            or launch["nodeId"] != "qualify-api"
            or not isinstance(launch["attempt"], int) or isinstance(launch["attempt"], bool)
            or launch["attempt"] <= 0
            or not isinstance(launch["jobSession"], str) or not launch["jobSession"]):
        raise ValueError("Host launch identity is incomplete")
    expected = {"schema": "hima-library-host-attestation/1",
                "siteId": value.get("siteId"),
                "manifestPath": manifest_path, "manifestSha256": manifest_sha,
                "permitPath": permit["path"], "permitSha256": permit["sha256"],
                "workspace": workspace, "wrapper": runtime["wrapper"],
                "wrapperRealpath": runtime["wrapperRealpath"],
                "wrapperSha256": runtime["wrapperSha256"],
                "license": license_selection,
                "licenseClaims": {"QuaLib-2026-new-59099": 1},
                "launch": launch}
    if not isinstance(value.get("siteId"), str) or not value["siteId"] or value != expected:
        raise ValueError("Host prelaunch attestation differs")
    return path, sha256(path), launch


def permit_preflight(runtime, permit, sources, workspace, manifest_path):
    rules = permit_lists(permit["path"], permit["sha256"])
    if runtime["wrapper"] != WRAPPER or WRAPPER not in rules["allowedWrappers"]:
        raise ValueError("wrapper is not allowed by Site Permit")
    read_roots = [os.path.realpath(root) for root in rules["allowedReadRoots"]]
    write_roots = [os.path.realpath(root) for root in rules["allowedWriteRoots"]]
    if not inside(workspace, read_roots) or not inside(workspace, write_roots):
        raise ValueError("workspace is outside Site Permit roots")
    if not inside(permit["path"], read_roots):
        raise ValueError("Permit file is outside allowed read roots")
    if not inside(plain(manifest_path), read_roots):
        raise ValueError("manifest is outside Site Permit read roots")
    for source in sources:
        if not inside(plain(source["path"]), read_roots):
            raise ValueError("source is outside Site Permit read roots")
    return read_roots


def runtime_preflight(runtime, read_roots, worker):
    api_root = runtime["apiRoot"]
    if (not isinstance(api_root, str) or not os.path.isabs(api_root)
            or os.path.realpath(api_root) != os.path.abspath(api_root)):
        raise ValueError("API root is not a plain absolute directory")
    if runtime["apiMarker"] != "tmlib.py" or runtime["nativeModule"] != "_tmlib.so":
        raise ValueError("API module filenames differ from qualified QuaLib layout")
    marker = os.path.join(api_root, runtime["apiMarker"])
    native_module = os.path.join(api_root, runtime["nativeModule"])
    parser_library = os.path.join(api_root, "lib", "libparser_wrapper.so")
    if (not inside(plain(marker), read_roots)
            or not inside(plain(native_module), read_roots)
            or not inside(plain(parser_library), read_roots)
            or not inside(runtime["python"], read_roots)):
        raise ValueError("runtime is outside Site Permit read roots")
    if runtime["pythonVersion"] != ".".join(map(str, sys.version_info[:2])):
        raise ValueError("Python version differs")
    if os.path.realpath(runtime["python"]) != os.path.realpath(sys.executable):
        raise ValueError("Python executable differs")
    if sha256(runtime["python"]) != runtime["pythonSha256"]:
        raise ValueError("Python executable SHA-256 differs")
    if sha256(marker) != runtime["apiMarkerSha256"]:
        raise ValueError("API marker SHA-256 differs")
    if sha256(native_module) != runtime["nativeModuleSha256"]:
        raise ValueError("native module SHA-256 differs")
    if sha256(parser_library) != runtime["parserLibrarySha256"]:
        raise ValueError("parser wrapper SHA-256 differs")
    if not isinstance(runtime["apiBuild"], str) or not runtime["apiBuild"]:
        raise ValueError("API build is absent")
    if sha256(worker) != runtime["adapterSha256"]:
        raise ValueError("worker SHA-256 differs")
def run(manifest_path, workspace):
    if os.path.realpath(workspace) != os.path.abspath(workspace):
        raise ValueError("Campaign workspace contains a symlink")
    workspace = os.path.realpath(workspace)
    if not os.path.isdir(workspace):
        raise ValueError("Campaign workspace is absent")
    flow = os.path.join(workspace, "flow")
    if os.path.realpath(flow) != os.path.abspath(flow) or not os.path.isdir(flow):
        raise ValueError("Campaign flow folder is absent or linked")
    output = os.path.join(workspace, "flow", "qualification")
    if os.path.exists(output):
        raise ValueError("qualification output already exists; refusing overwrite")
    value = read_json(manifest_path)
    runtime, permit, license_selection, sources = validate_manifest(value)
    records = [result(item["role"], item["path"], item["sha256"]) for item in sources]
    manifest_sha = sha256(manifest_path)
    attestation_path, attestation_sha, launch_identity = host_attestation(
        workspace, manifest_path, manifest_sha, runtime, permit, license_selection)
    # Even a preflight refusal has a typed receipt, with all native steps not-run.
    os.makedirs(output)
    receipt = {"schema": SCHEMA, "status": "blocked", "nativeStatus": "not-run",
               "reason": None, "manifestPath": manifest_path,
               "manifestSha256": manifest_sha,
               "producer": {"apiBuild": runtime["apiBuild"],
                            "python": runtime["python"],
                            "pythonSha256": runtime["pythonSha256"],
                            "nativeModuleSha256": runtime["nativeModuleSha256"],
                            "parserLibrarySha256": runtime["parserLibrarySha256"],
                            "adapterSha256": runtime["adapterSha256"],
                            "wrapper": runtime["wrapper"],
                            "wrapperRealpath": runtime["wrapperRealpath"],
                            "wrapperSha256": runtime["wrapperSha256"]},
               "permitPath": permit["path"], "permitSha256": permit["sha256"],
               "permitAttestation": "host-prelaunch",
               "hostAttestationPath": attestation_path,
               "hostAttestationSha256": attestation_sha,
               "launch": launch_identity,
               "results": records, "facts": None}
    try:
        read_roots = permit_preflight(runtime, permit, sources, workspace, manifest_path)
    except (OSError, ValueError, TypeError) as error:
        receipt["reason"] = "hima/library-preflight-refused"
        receipt["nativeStatus"] = "blocked"
        records[0]["reason"] = receipt["reason"]
        records[0]["steps"]["permit"] = "blocked"
        write_json_once(os.path.join(output, "receipt.json"), receipt)
        print(str(error), file=sys.stderr)
        return
    for record in records:
        record["steps"]["permit"] = "passed"
    try:
        runtime_preflight(runtime, read_roots, os.path.abspath(__file__))
    except (OSError, ValueError, TypeError) as error:
        receipt["reason"] = "hima/library-runtime-identity"
        receipt["nativeStatus"] = "blocked"
        records[0]["reason"] = receipt["reason"]
        records[0]["steps"]["runtime"] = "blocked"
        write_json_once(os.path.join(output, "receipt.json"), receipt)
        print(str(error), file=sys.stderr)
        return
    for record in records:
        record["steps"]["runtime"] = "passed"
    # Hash every declared source before starting any native worker.
    source_error = None
    for record in records:
        try:
            record["sourceSha256"] = sha256(plain(record["source"]))
            if record["sourceSha256"] != record["expectedSha256"]:
                raise ValueError("source SHA-256 differs before native launch")
            record["steps"]["source-hash"] = "passed"
        except (OSError, ValueError) as error:
            record["steps"]["source-hash"] = "blocked"
            record["reason"] = "hima/library-source-identity"
            source_error = error
            break
    if source_error is not None:
        receipt["reason"] = "hima/library-source-identity"
        receipt["nativeStatus"] = "blocked"
        write_json_once(os.path.join(output, "receipt.json"), receipt)
        print(str(source_error), file=sys.stderr)
        return
    env = os.environ.copy()
    env["LIBERTY_API_HOME"] = runtime["apiRoot"]
    env["PYTHONPATH"] = runtime["apiRoot"]
    env["LD_LIBRARY_PATH"] = os.path.join(runtime["apiRoot"], "lib")
    env.pop("EMPYREAN_LICENSE_FILE", None)
    for index, record in enumerate(records):
        source = record["source"]
        one = os.path.join(output, record["role"])
        os.mkdir(one)
        log_path = os.path.join(one, "worker.log")
        timeout = 30 if index == 0 else 180
        with open(log_path, "wb") as log:
            try:
                completed = subprocess.run(
                    [sys.executable, os.path.abspath(__file__), "--child", source, one],
                    stdout=log, stderr=subprocess.STDOUT, env=env, timeout=timeout,
                    check=False)
                code = completed.returncode
            except subprocess.TimeoutExpired:
                code = 124
        record["exitCode"] = code if code >= 0 else None
        record["signal"] = -code if code < 0 else (11 if code == 139 else None)
        record["logSha256"] = sha256(log_path)
        progress = os.path.join(one, "progress.txt")
        completed_phases = []
        if os.path.isfile(progress):
            with open(progress) as stream:
                completed_phases = [line.strip() for line in stream]
            record["progressSha256"] = sha256(progress)
        for phase in completed_phases:
            if phase in ("read", "query", "copy", "re-read", "compare"):
                record["steps"][phase] = "passed"
        try:
            record["sourceAfterSha256"] = sha256(plain(source))
            if record["sourceAfterSha256"] != record["expectedSha256"]:
                raise ValueError("original source SHA-256 changed")
            record["steps"]["source-after-hash"] = "passed"
        except (OSError, ValueError):
            record["steps"]["source-after-hash"] = "blocked"
            record["reason"] = "hima/library-source-mutated"
            receipt["reason"] = record["reason"]
            break
        if code != 0:
            for phase in ("read", "query", "copy", "re-read", "compare"):
                if record["steps"][phase] != "passed":
                    record["steps"][phase] = "blocked"
                    break
            record["reason"] = "hima/library-worker-crashed" if record["signal"] else "hima/library-worker-failed"
            receipt["reason"] = record["reason"]
            break
        try:
            child_record = read_json(os.path.join(one, "child.json"))
            copied = plain(os.path.join(one, "copy.lib"))
            if (set(child_record) != {"copySha256", "copyBytes", "query"}
                    or child_record["copySha256"] != sha256(copied)
                    or child_record["copyBytes"] != os.path.getsize(copied)
                    or any(record["steps"][phase] != "passed"
                           for phase in ("read", "query", "copy", "re-read", "compare"))):
                raise ValueError("child result is partial or copy identity differs")
            record["copySha256"] = child_record["copySha256"]
            record["childSha256"] = sha256(os.path.join(one, "child.json"))
            record["queryEvidence"] = child_record["query"]
        except (OSError, ValueError, TypeError) as error:
            record["steps"]["compare"] = "blocked"
            record["reason"] = "hima/library-partial-result"
            receipt["reason"] = record["reason"]
            print(str(error), file=sys.stderr)
            break
        record["status"] = "passed"
        record["reason"] = None
    if all(record["status"] == "passed" for record in records):
        receipt["nativeStatus"] = "passed"
        receipt["status"] = "passed"
        receipt["reason"] = None
    else:
        receipt["nativeStatus"] = "blocked"
    write_json_once(os.path.join(output, "receipt.json"), receipt)


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--child":
        child(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3:
        run(sys.argv[1], sys.argv[2])
    else:
        raise SystemExit("usage: libapi_worker.py MANIFEST WORKSPACE")
