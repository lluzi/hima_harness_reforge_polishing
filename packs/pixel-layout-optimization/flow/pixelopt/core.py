"""Errors, JSON I/O and a JSON-Schema subset validator (stdlib only).

This module runs on the Site host's ``python3`` (3.8+); it imports nothing
outside the standard library, not even lazily.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile

__all__ = [
    "PixelError",
    "sha256_file",
    "read_json",
    "write_json",
    "validate",
    "load_schema",
    "check",
    "snap",
    "EDIT_BOUND_UM",
]

# The most one bounded edit may move a vertex or an edge (um). The designer-style repairs that made
# the first real case clean moved vertices by up to 1.45 um (squaring a 45-degree jog).
EDIT_BOUND_UM = 1.5


class PixelError(Exception):
    """A business error with a kebab-case ``code`` and a human ``detail``.

    Codes are a closed vocabulary (see the plan's ground rules): ``missing-input``,
    ``digest-mismatch``, ``schema``, ``unresolved-goal``, ``infeasible``,
    ``tool-failed``, ``identity-mismatch``, ``bad-plan``.
    """

    def __init__(self, code, detail):
        super(PixelError, self).__init__("%s: %s" % (code, detail))
        self.code = code
        self.detail = detail


# --------------------------------------------------------------------------- #
# Files
# --------------------------------------------------------------------------- #

def sha256_file(path):
    """Hex SHA-256 of a file's bytes."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    """Parse a JSON file; ``PixelError('missing-input')`` when absent/unparseable."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as exc:
        raise PixelError("missing-input", "%s: %s" % (path, exc))


def write_json(path, doc):
    """Atomically write ``doc`` as JSON (sorted keys, indent 1). Returns its SHA-256.

    Writes to a temp file in the destination directory and ``os.replace``s it, so
    a reader never sees a half-written file.
    """
    data = json.dumps(doc, sort_keys=True, indent=1).encode("utf-8")
    directory = os.path.dirname(os.path.abspath(path))
    if not os.path.isdir(directory):
        os.makedirs(directory)
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------- #
# Schema validation (a small, explicit subset of JSON Schema 2020-12)
# --------------------------------------------------------------------------- #

def _typename(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _type_ok(value, t):
    if t == "object":
        return isinstance(value, dict)
    if t == "array":
        return isinstance(value, list)
    if t == "string":
        return isinstance(value, str)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "null":
        return value is None
    return True


def _resolve_ref(ref, root):
    if not isinstance(ref, str) or not ref.startswith("#/"):
        return None
    node = root
    for part in ref[2:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


def _collect(doc, schema, root, path):
    errs = []
    _validate_node(doc, schema, root, path, errs)
    return errs


def _validate_node(doc, schema, root, path, errs):
    if schema is True or schema == {}:
        return
    if schema is False:
        errs.append("%s: schema forbids any value" % path)
        return
    if not isinstance(schema, dict):
        return

    if "$ref" in schema:
        target = _resolve_ref(schema["$ref"], root)
        if target is None:
            errs.append("%s: cannot resolve $ref %s" % (path, schema["$ref"]))
        else:
            _validate_node(doc, target, root, path, errs)

    if "type" in schema:
        types = schema["type"]
        if isinstance(types, str):
            types = [types]
        if not any(_type_ok(doc, t) for t in types):
            errs.append("%s: expected type %s, got %s"
                        % (path, "/".join(types), _typename(doc)))

    if "const" in schema and doc != schema["const"]:
        errs.append("%s: const mismatch, expected %r got %r"
                    % (path, schema["const"], doc))

    if "enum" in schema and doc not in schema["enum"]:
        errs.append("%s: %r not in enum %r" % (path, doc, schema["enum"]))

    if "anyOf" in schema:
        if all(_collect(doc, sub, root, path) for sub in schema["anyOf"]):
            errs.append("%s: does not match anyOf" % path)

    if "oneOf" in schema:
        matched = sum(1 for sub in schema["oneOf"]
                      if not _collect(doc, sub, root, path))
        if matched != 1:
            errs.append("%s: matches %d of oneOf (need exactly 1)" % (path, matched))

    if isinstance(doc, bool):
        pass  # bools are not numbers here
    elif isinstance(doc, (int, float)):
        if "minimum" in schema and doc < schema["minimum"]:
            errs.append("%s: %s < minimum %s" % (path, doc, schema["minimum"]))
        if "maximum" in schema and doc > schema["maximum"]:
            errs.append("%s: %s > maximum %s" % (path, doc, schema["maximum"]))

    if isinstance(doc, str) and "minLength" in schema:
        if len(doc) < schema["minLength"]:
            errs.append("%s: string length %d < minLength %d"
                        % (path, len(doc), schema["minLength"]))

    if isinstance(doc, dict):
        for req in schema.get("required", []):
            if req not in doc:
                errs.append("%s: missing required property '%s'" % (path, req))
        props = schema.get("properties", {})
        for key, sub in props.items():
            if key in doc:
                _validate_node(doc[key], sub, root, path + "." + key, errs)
        ap = schema.get("additionalProperties", True)
        if ap is not True:
            extra = [k for k in doc if k not in props]
            if ap is False:
                for key in extra:
                    errs.append("%s: additional property '%s' not allowed"
                                % (path, key))
            elif isinstance(ap, dict):
                for key in extra:
                    _validate_node(doc[key], ap, root, path + "." + key, errs)

    if isinstance(doc, list):
        if "minItems" in schema and len(doc) < schema["minItems"]:
            errs.append("%s: %d items < minItems %d"
                        % (path, len(doc), schema["minItems"]))
        if "maxItems" in schema and len(doc) > schema["maxItems"]:
            errs.append("%s: %d items > maxItems %d"
                        % (path, len(doc), schema["maxItems"]))
        if "items" in schema:
            for i, item in enumerate(doc):
                _validate_node(item, schema["items"], root, "%s[%d]" % (path, i), errs)


def validate(doc, schema):
    """Return a list of error strings; empty means ``doc`` conforms to ``schema``."""
    errs = []
    _validate_node(doc, schema, schema, "$", errs)
    return errs


_SCHEMA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "schemas")


def load_schema(name):
    """Load ``flow/schemas/<name>.json``."""
    return read_json(os.path.join(_SCHEMA_DIR, name + ".json"))


def check(doc, name):
    """Validate ``doc`` against ``load_schema(name)``; raise ``PixelError('schema')``."""
    errs = validate(doc, load_schema(name))
    if errs:
        raise PixelError("schema", "%s: %s" % (name, "; ".join(errs)))


# --------------------------------------------------------------------------- #
# Grid
# --------------------------------------------------------------------------- #

def snap(value, grid):
    """Round ``value`` to the nearest multiple of ``grid``, then to 6 decimals."""
    if grid <= 0:
        raise PixelError("schema", "grid must be positive, got %r" % (grid,))
    return round(round(value / grid) * grid, 6)
