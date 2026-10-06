"""admit-analysis: copy one Reader-accepted delivery into the persistent Site analysis library."""
import os
import shutil

from . import common, delivery
from .common import LiaError


def _observation(reader_value, report_ref):
    observations = reader_value.get("observations") if isinstance(reader_value, dict) else None
    if not isinstance(observations, list) or len(observations) != 1:
        raise LiaError("identity-mismatch", "custom-analysis committed no single Reader observation")
    observation = observations[0]
    if observation.get("contentSha256") != report_ref.get("sha256"):
        raise LiaError("identity-mismatch", "committed Reader observation differs from the retained domain-report")
    values = dict((row.get("type"), row) for row in observation.get("values", []))
    errors = values.get("li_analysis_error_count", {}).get("value")
    if errors != 0:
        raise LiaError("invalid-result", "the libinsight-analysis Reader did not accept this delivery (error count %r)" % (errors,))
    return observation


def _report(workspace, ref):
    if not isinstance(ref, dict) or not common.relative_path(ref.get("path")):
        raise LiaError("invalid-input", "domain-report reference is not a workspace-relative artifact")
    path = os.path.join(workspace, ref["path"])
    common.plain_file(path, "retained domain-report")
    if common.sha256_file(path) != ref.get("sha256"):
        raise LiaError("identity-mismatch", "retained domain-report bytes changed since the Reader read them")
    return path


def planned_files(workspace, doc, result_bytes):
    """{library-relative path: bytes} for the result and every declared code file."""
    files = {"analysis-result.json": result_bytes}
    for item in [doc["code"]["main"]] + list(doc["code"]["files"]):
        source = os.path.join(workspace, item["path"])
        common.plain_file(source, "delivered code file")
        with open(source, "rb") as stream:
            data = stream.read()
        if common.sha256_bytes(data) != item["sha256"]:
            raise LiaError("identity-mismatch", "delivered code file %s changed after the Reader accepted it" % item["path"])
        files[item["path"]] = data
    return files


def admission_document(doc, target, files):
    return {
        "schema": common.ADMISSION_SCHEMA,
        "id": doc["id"],
        "version": doc["version"],
        "path": target,
        "question": doc["question"],
        "resultSha256": common.sha256_bytes(files["analysis-result.json"]),
        "codeSha256s": dict((path, common.sha256_bytes(data)) for path, data in sorted(files.items())
                            if path != "analysis-result.json"),
    }


def _existing(target):
    found = {}
    for directory, folders, names in os.walk(target):
        for name in folders:
            if os.path.islink(os.path.join(directory, name)):
                raise LiaError("invalid-state", "admitted analysis %s contains a symlink" % target)
        for name in names:
            at = os.path.join(directory, name)
            if os.path.islink(at) or not os.path.isfile(at):
                raise LiaError("invalid-state", "admitted analysis %s contains a non-plain file %s" % (target, at))
            found[os.path.relpath(at, target).replace(os.sep, "/")] = common.sha256_file(at)
    return found


def _write_tree(stage, files):
    for relative, data in sorted(files.items()):
        at = os.path.join(stage, *relative.split("/"))
        parent = os.path.dirname(at)
        if not os.path.isdir(parent):
            os.makedirs(parent)
        with open(at, "xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(at, 0o444)


def admit(workspace, library, doc, result_bytes):
    """Place the delivery at <library>/<id>/v<version>/. Returns (admission, reused)."""
    target = os.path.join(library, doc["id"], "v%d" % doc["version"])
    files = planned_files(workspace, doc, result_bytes)
    admission = admission_document(doc, target, files)
    files_with_admission = dict(files)
    files_with_admission["admission.json"] = common.canonical_bytes(admission)
    wanted = dict((path, common.sha256_bytes(data)) for path, data in files_with_admission.items())
    if os.path.lexists(target):
        if os.path.islink(target) or not os.path.isdir(target):
            raise LiaError("invalid-state", "library entry %s is not a plain directory" % target)
        if _existing(target) != wanted:
            raise LiaError("version-conflict", "analysis %s version %d is already admitted at %s with different content; "
                           "deliver a new version instead of replacing an admitted one" % (doc["id"], doc["version"], target))
        return admission, True
    parent = os.path.dirname(target)
    if not os.path.isdir(parent):
        os.makedirs(parent)
    stage = os.path.join(parent, ".staging-v%d-%d" % (doc["version"], os.getpid()))
    if os.path.lexists(stage):
        raise LiaError("invalid-state", "a staging directory %s already exists; another admission is in progress" % stage)
    os.mkdir(stage)
    try:
        _write_tree(stage, files_with_admission)
        os.rename(stage, target)
    except OSError:
        shutil.rmtree(stage, ignore_errors=True)
        if os.path.isdir(target) and _existing(target) == wanted:
            return admission, True
        raise
    return admission, False


def admit_task(workspace, inputs):
    report_ref = inputs["DOMAIN_REPORT"]
    reader_value = inputs["READER_VALUE"]
    prepared_value = inputs["PREPARED"]
    library = inputs["ANALYSIS_LIBRARY"]
    if not isinstance(library, str) or not os.path.isabs(library):
        raise LiaError("invalid-input", "analysisLibrary must be an absolute Site directory")
    engineering = reader_value.get("engineering", {}) if isinstance(reader_value, dict) else {}
    observation = _observation(reader_value, report_ref)
    report = _report(workspace, report_ref)
    prepared_path = os.path.join(workspace, common.PREPARED_PATH)
    if common.sha256_file(prepared_path) != prepared_value.get("preparedSha256"):
        raise LiaError("identity-mismatch", "prepared request changed after prepare-request committed it")
    prepared = common.read_json_file(prepared_path, "prepared request")
    doc, data = delivery.load_result(report)
    found = delivery.problems(doc, workspace, prepared, len(data))
    if found:
        raise LiaError("invalid-result", "admission re-check refused the accepted delivery: " + "; ".join(found[:5]))
    base = {"requestId": prepared["request"]["requestId"], "outcome": engineering.get("outcome"),
            "stopReason": engineering.get("stopReason"), "summary": doc["summary"],
            "domainReport": report_ref, "readerObservation": observation.get("id")}
    if engineering.get("outcome") in ("blocked", "cancelled"):
        value = dict(base, admitted=False, reason="the resident reported outcome %s: %s" % (
            engineering.get("outcome"), engineering.get("stopReason") or engineering.get("summary")),
            id=doc["id"], version=doc["version"])
        common.write_json(os.path.join(workspace, common.ADMISSION_PATH), value)
        return value
    admission, reused = admit(workspace, library, doc, data)
    value = dict(base, admitted=True, reused=reused, **admission)
    common.write_json(os.path.join(workspace, common.ADMISSION_PATH), value)
    return value
