"""Shared, dependency-free helpers for the libinsight-analysis Pack.

Everything here runs on the Site's /usr/bin/python3 (3.12 on linglong), on a developer's macOS
python3 (3.9) and inside the resident sandbox's edarunner image (python3 3.6.8), so it avoids
newer syntax and standard-library additions (no walrus, no `Path.is_relative_to`, no
`from __future__ import annotations`).
"""
import gzip
import hashlib
import json
import math
import os
import re
import stat
import tempfile

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
REQUEST_ID = re.compile(r"^req-[0-9]{14}-[a-z0-9]{6}$")
ISO_TIME = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:?[0-9]{2})$")
BUILDS_ON = re.compile(r"^([a-z0-9][a-z0-9-]{1,62})@([1-9][0-9]{0,8})$")

REQUEST_SCHEMA = "hima-libinsight-request/1"
PREPARED_SCHEMA = "hima-libinsight-prepared-request/1"
ANALYSIS_SCHEMA = "hima-libinsight-analysis/1"
ADMISSION_SCHEMA = "hima-libinsight-admission/1"
FACTS_SCHEMA = "lib-insight-facts/1"

PREPARED_PATH = "state/prepared-request.json"
RESULT_PATH = "state/analysis-result.json"
ADMISSION_PATH = "state/admission.json"
PROBLEMS_PATH = "state/analysis-result.problems.txt"
ARTIFACT_PREFIX = "analysis"


class LiaError(Exception):
    """A refusal with a stable code and a sentence a person or the resident can act on."""

    def __init__(self, code, detail):
        Exception.__init__(self, detail)
        self.code = code
        self.detail = detail


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    value = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 22), b""):
            value.update(block)
    return value.hexdigest()


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: %s" % key)
        result[key] = value
    return result


def _reject_constant(name):
    raise ValueError("non-finite number %s is not JSON; write null with a nullMeans reason or a finite value" % name)


def loads_strict(text):
    """Parse JSON refusing duplicate keys and NaN/Infinity tokens."""
    return json.loads(text, object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)


def plain_file(path, label):
    """Return the absolute path of a readable plain (non-symlink) file, or raise LiaError."""
    if not isinstance(path, str) or not os.path.isabs(path):
        raise LiaError("invalid-input", "%s must be an absolute path: %r" % (label, path))
    if "/../" in path + "/" or "/./" in path + "/":
        raise LiaError("invalid-input", "%s must be a normalized path without . or .. segments: %s" % (label, path))
    try:
        info = os.lstat(path)
    except OSError as error:
        raise LiaError("missing-input", "%s does not exist or is unreadable: %s (%s)" % (label, path, error.strerror))
    if stat.S_ISLNK(info.st_mode):
        raise LiaError("invalid-input", "%s is a symlink; name the real file instead: %s" % (label, path))
    if not stat.S_ISREG(info.st_mode):
        raise LiaError("invalid-input", "%s is not a plain file: %s" % (label, path))
    if not os.access(path, os.R_OK):
        raise LiaError("missing-input", "%s is not readable by this process: %s" % (label, path))
    return path


def inside(path, roots):
    """True when `path` resolves to one of `roots` or beneath it (both sides resolved)."""
    real = os.path.realpath(path)
    for root in roots:
        base = os.path.realpath(root)
        if real == base or real.startswith(base.rstrip("/") + "/"):
            return True
    return False


def read_roots(value):
    """Parse the Site's `sourceReadRoots` binding: absolute directories separated by ':'."""
    roots = [part for part in (value or "").split(":") if part]
    if not roots or any(not os.path.isabs(root) for root in roots):
        raise LiaError("invalid-input", "sourceReadRoots must list the Site Permit read roots as absolute paths "
                       "separated by ':' (got %r)" % (value,))
    return roots


def read_json_file(path, label):
    plain_file(path, label)
    with open(path, "rb") as stream:
        data = stream.read()
    try:
        return loads_strict(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise LiaError("invalid-input", "%s is not strict UTF-8 JSON: %s" % (label, error))


def canonical_bytes(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")


def write_json(path, value):
    """Atomically replace `path` with canonical JSON."""
    parent = os.path.dirname(os.path.abspath(path))
    if not os.path.isdir(parent):
        os.makedirs(parent)
    handle, temporary = tempfile.mkstemp(prefix=".tmp-", dir=parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(canonical_bytes(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        if os.path.exists(temporary):
            os.unlink(temporary)
        raise


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def relative_path(value):
    """True for a normalized workspace-relative POSIX path."""
    return (isinstance(value, str) and value != "" and not value.startswith("/")
            and all(part not in ("", ".", "..") for part in value.split("/")))


def facts_header(path, limit=1 << 20):
    """Read the leading top-level fields of a `lib-insight-facts/1` .json.gz without parsing the library.

    The extractor writes `schema`, `source`, `producer`, `started`, `timing`, `status` before the
    large `library` member, so only the first decompressed megabyte is decoded. Returns
    {"schema", "status", "source": {"path", "sha256", ...}} or raises LiaError.
    """
    try:
        with gzip.open(path, "rb") as stream:
            head = stream.read(limit).decode("utf-8", "replace")
    except (OSError, EOFError) as error:
        raise LiaError("invalid-input", "facts file %s is not a readable gzip: %s" % (path, error))
    decoder = json.JSONDecoder(object_pairs_hook=_unique_pairs, parse_constant=_reject_constant)
    found = {}
    at = 0

    def skip(position):
        while position < len(head) and head[position] in " \t\r\n":
            position += 1
        return position

    at = skip(at)
    if not head.startswith("{", at):
        raise LiaError("invalid-input", "facts file %s does not hold a JSON object" % path)
    at += 1
    try:
        while True:
            at = skip(at)
            if head.startswith("}", at):
                break
            key, at = decoder.raw_decode(head, at)
            at = skip(at)
            if not head.startswith(":", at):
                raise ValueError("expected ':' after key %r" % key)
            at = skip(at + 1)
            if key == "library":
                break
            value, at = decoder.raw_decode(head, at)
            found[key] = value
            at = skip(at)
            if head.startswith(",", at):
                at += 1
            if all(name in found for name in ("schema", "source", "status")):
                break
    except ValueError as error:
        raise LiaError("invalid-input", "facts file %s header is not readable within %d bytes: %s" % (path, limit, error))
    if found.get("schema") != FACTS_SCHEMA:
        raise LiaError("invalid-input", "facts file %s has schema %r, expected %s" % (path, found.get("schema"), FACTS_SCHEMA))
    if found.get("status") != "ok":
        raise LiaError("invalid-input", "facts file %s has status %r; only status ok facts are analysable" % (path, found.get("status")))
    source = found.get("source")
    if (not isinstance(source, dict) or not isinstance(source.get("path"), str)
            or not isinstance(source.get("sha256"), str) or not HEX64.match(source["sha256"])):
        raise LiaError("invalid-input", "facts file %s has no source path/sha256 identity" % path)
    after = source.get("sha256_after")
    if after is not None and after != source["sha256"]:
        raise LiaError("invalid-input", "facts file %s records a Liberty source that changed during extraction" % path)
    return {"schema": found["schema"], "status": found["status"], "source": source}
