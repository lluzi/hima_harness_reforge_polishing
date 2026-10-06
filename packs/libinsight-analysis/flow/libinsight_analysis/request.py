"""prepare-request: validate the Host-written request and bind every source and library identity."""
import os

from . import common
from .common import LiaError

REQUEST_KEYS = {"schema", "requestId", "question", "sources", "buildsOn", "createdAt"}
MAX_SOURCES = 32
MAX_BUILDS_ON = 8
MAX_CORPUS_ENTRIES = 500


def validate_request(value):
    if not isinstance(value, dict):
        raise LiaError("invalid-input", "analysis request must be a JSON object")
    if set(value) != REQUEST_KEYS:
        raise LiaError("invalid-input", "analysis request fields: missing %s; unexpected %s; expected exactly %s" % (
            sorted(REQUEST_KEYS - set(value)), sorted(set(value) - REQUEST_KEYS), sorted(REQUEST_KEYS)))
    if value["schema"] != common.REQUEST_SCHEMA:
        raise LiaError("invalid-input", "analysis request schema is %r, expected %s" % (value["schema"], common.REQUEST_SCHEMA))
    if not isinstance(value["requestId"], str) or not common.REQUEST_ID.match(value["requestId"]):
        raise LiaError("invalid-input", "requestId %r must match ^req-[0-9]{14}-[a-z0-9]{6}$" % (value["requestId"],))
    question = value["question"]
    if not isinstance(question, str) or not question.strip() or len(question) > 4000:
        raise LiaError("invalid-input", "question must be a non-empty string of at most 4000 characters")
    sources = value["sources"]
    if not isinstance(sources, list) or len(sources) > MAX_SOURCES:
        raise LiaError("invalid-input", "sources must be a list of at most %d absolute Site paths" % MAX_SOURCES)
    if len(set(map(str, sources))) != len(sources):
        raise LiaError("invalid-input", "sources must not repeat a path")
    builds = value["buildsOn"]
    if not isinstance(builds, list) or len(builds) > MAX_BUILDS_ON:
        raise LiaError("invalid-input", "buildsOn must be a list of at most %d id@version references" % MAX_BUILDS_ON)
    for item in builds:
        if not isinstance(item, str) or not common.BUILDS_ON.match(item):
            raise LiaError("invalid-input", "buildsOn entry %r must be <id>@<version>, e.g. saed14-inv-drive-delay@1" % (item,))
    if len(set(builds)) != len(builds):
        raise LiaError("invalid-input", "buildsOn must not repeat a reference")
    if not isinstance(value["createdAt"], str) or not common.ISO_TIME.match(value["createdAt"]):
        raise LiaError("invalid-input", "createdAt must be an ISO-8601 timestamp with a zone, e.g. 2026-10-05T12:00:00Z")
    return value


def source_kind(path):
    if path.endswith(".json.gz"):
        return "facts"
    if path.endswith(".lib"):
        return "liberty"
    raise LiaError("invalid-input", "source %s is neither a Liberty .lib file nor a lib-insight-facts/1 .json.gz file" % path)


def describe_source(path, readable_roots=None, site_roots=None):
    """{path, kind, sha256, bytes[, liberty]} for one plain source file."""
    common.plain_file(path, "source")
    kind = source_kind(path)
    if site_roots is not None and not common.inside(path, site_roots):
        raise LiaError("invalid-input", "source %s is outside the Site read roots %s; name a file the Site "
                       "Permit lets this Site read" % (path, site_roots))
    if readable_roots is not None and not common.inside(path, readable_roots):
        raise LiaError("invalid-input", "source %s is outside the resident sandbox read-only roots %s; "
                       "the resident could not read it" % (path, readable_roots))
    described = {"path": path, "kind": kind, "sha256": common.sha256_file(path), "bytes": os.path.getsize(path)}
    if kind == "facts":
        header = common.facts_header(path)
        liberty = {"path": header["source"]["path"], "sha256": header["source"]["sha256"]}
        if isinstance(header["source"].get("bytes"), int):
            liberty["bytes"] = header["source"]["bytes"]
        described["liberty"] = liberty
    return described


def library_catalog(library):
    """Admitted analyses under `<library>/<id>/v<version>/admission.json`; unreadable entries are listed as invalid."""
    analyses, invalid = [], []
    if not os.path.isdir(library):
        return analyses, invalid
    for name in sorted(os.listdir(library)):
        folder = os.path.join(library, name)
        if not common.SLUG.match(name) or os.path.islink(folder) or not os.path.isdir(folder):
            continue
        for entry in sorted(os.listdir(folder)):
            if not entry.startswith("v") or not entry[1:].isdigit():
                continue
            target = os.path.join(folder, entry)
            admission = os.path.join(target, "admission.json")
            try:
                document = common.read_json_file(admission, "admission")
                if (document.get("schema") != common.ADMISSION_SCHEMA or document.get("id") != name
                        or document.get("version") != int(entry[1:]) or document.get("path") != target):
                    raise LiaError("invalid-input", "admission identity differs from its library location")
                analyses.append({"id": name, "version": document["version"], "question": document.get("question", ""),
                                 "path": target, "resultSha256": document.get("resultSha256")})
            except LiaError as error:
                invalid.append({"path": target, "reason": error.detail})
    analyses.sort(key=lambda item: (item["id"], item["version"]))
    return analyses, invalid


def facts_corpus(root):
    """List facts files (path, bytes, Liberty identity) under a read-only corpus, two levels deep."""
    listed = []
    if not root or not os.path.isdir(root):
        return listed
    candidates = []
    for name in sorted(os.listdir(root)):
        at = os.path.join(root, name)
        if os.path.isdir(at) and not os.path.islink(at):
            candidates.extend(os.path.join(at, child) for child in sorted(os.listdir(at)))
        else:
            candidates.append(at)
    for at in candidates:
        if not at.endswith(".json.gz") or os.path.islink(at) or not os.path.isfile(at):
            continue
        if len(listed) >= MAX_CORPUS_ENTRIES:
            break
        entry = {"path": at, "bytes": os.path.getsize(at)}
        try:
            header = common.facts_header(at)
            entry["liberty"] = {"path": header["source"]["path"], "sha256": header["source"]["sha256"]}
        except LiaError as error:
            entry["unusable"] = error.detail
        listed.append(entry)
    return listed


def readable_roots(capability_path):
    """The sandbox read-only roots of the Site's engineering capability; None for a test-only sandbox."""
    if not capability_path:
        return None
    capability = common.read_json_file(capability_path, "engineering capability")
    sandbox = capability.get("sandbox") if isinstance(capability, dict) else None
    if not isinstance(sandbox, dict) or sandbox.get("kind") != "podman":
        return None
    roots = sandbox.get("readOnlyRoots")
    if not isinstance(roots, list) or not all(isinstance(root, str) for root in roots):
        raise LiaError("invalid-input", "engineering capability has no readOnlyRoots list")
    return roots


def goal_text(request, prepared_path):
    return ("Answer this LibInsight custom-analysis question for request %s by writing and running code on this "
            "Site, then deliver one hima-libinsight-analysis/1 result. Question: %s\n\nThe prepared request "
            "(sources with sha256, facts corpus, admitted analyses library, buildsOn) is %s. Follow the knowledge "
            "files: custom-analysis-contract.md for the exact delivery, qualib-api-playbook.md for live QuaLib "
            "and facts-mode runtimes, facts-schema.md, analysis-library.md and example-custom-analysis.md. Check "
            "the result with `python3 <campaignWorkspace>/flow/libinsight_cli.py check-delivery` before "
            "writing the delivery candidate." % (request["requestId"], request["question"], prepared_path))


XTOP_MODE_MESSAGE = ("linglong's Empyrean licence is in XTop mode; the operator switches it with "
                     "`empyrean-license new` (and back with `empyrean-license old` before XTop work)")


def licence_mode(path):
    """The one word of the Site's Empyrean licence mode file, or None when it cannot be read."""
    if not path:
        return None
    try:
        with open(path, "r") as stream:
            words = stream.read().split()
    except (IOError, OSError):
        return None
    return words[0] if words else None


def prepare(workspace, request_path, library, corpus, capability_path, mode_file="", source_roots=None):
    request = validate_request(common.read_json_file(request_path, "analysis request"))
    site_roots = common.read_roots(source_roots)
    roots = readable_roots(capability_path)
    sources = [describe_source(path, roots, site_roots) for path in request["sources"]]
    corpus_files = facts_corpus(corpus)
    by_liberty = {}
    for entry in corpus_files:
        if "liberty" in entry:
            by_liberty.setdefault(entry["liberty"]["sha256"], []).append(entry["path"])
    live_needed = []
    for source in sources:
        if source["kind"] == "liberty":
            source["factsAlternatives"] = by_liberty.get(source["sha256"], [])
            if not source["factsAlternatives"]:
                live_needed.append(source["path"])
    mode = licence_mode(mode_file)
    if live_needed and mode != "new":
        raise LiaError("licence-mode", XTOP_MODE_MESSAGE)
    licence = {"modeFile": mode_file or None, "mode": mode, "liveQualibAvailable": mode == "new",
               "liveQualibRequiredFor": live_needed}
    analyses, invalid = library_catalog(library)
    catalog = dict(((item["id"], item["version"]), item) for item in analyses)
    builds = []
    for reference in request["buildsOn"]:
        found = common.BUILDS_ON.match(reference)
        key = (found.group(1), int(found.group(2)))
        if key not in catalog:
            raise LiaError("missing-input", "buildsOn %s is not an admitted analysis in %s; admitted: %s" % (
                reference, library, ", ".join("%s@%d" % k for k in sorted(catalog)) or "none"))
        builds.append({"ref": reference, "id": key[0], "version": key[1], "path": catalog[key]["path"],
                       "resultSha256": catalog[key]["resultSha256"]})
    prepared = {
        "schema": common.PREPARED_SCHEMA,
        "request": request,
        "requestSha256": common.sha256_file(request_path),
        "requestPath": request_path,
        "sources": sources,
        "buildsOn": builds,
        "library": {"path": library, "analyses": analyses, "invalid": invalid},
        "factsCorpus": {"path": corpus, "files": corpus_files},
        "licence": licence,
        "readRoots": site_roots,
        "sandboxReadOnlyRoots": roots,
    }
    target = os.path.join(workspace, common.PREPARED_PATH)
    common.write_json(target, prepared)
    return prepared, target
