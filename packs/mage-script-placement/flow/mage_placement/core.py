"""Shared core helpers for the mage-script-placement Pack.

Forked verbatim from packs/mage-scribe-placement 0.2.0 (2026-10-12).

Ported from the ATCS Pack's `atcs/core.py` (`AtcsError` -> `MageError`, schema
prefix `atcs.` -> `mage.`), plus the unit-conversion and JSON-Schema-subset
helpers every later task in this Pack needs.

- `MageError` — the single refusal type used across this Pack. `code` is a
  kebab-case string (e.g. `"missing-input"`, `"schema-mismatch"`,
  `"identity-mismatch"`, `"units"`); `detail` is a free-form human string.
- Canonical JSON + digests — `canonical()`/`digest()` implement the artifact
  id rule: an artifact's `id` is the first 20 hex characters of the SHA-256
  over the canonical JSON encoding (`json.dumps(sort_keys=True,
  separators=(",", ":"), ensure_ascii=False)`, UTF-8) of the artifact
  *without* its own `id` field.
- File/tree hashing — `file_sha256()` is a plain SHA-256 over a file's bytes
  (64 hex chars); `tree_digest()` is a SHA-256 (64 hex chars) over the
  canonical JSON of a directory's sorted `{relative path, size, sha256}`
  triples.
- Artifact I/O — `stamp()` adds `schema`/`id` to a plain field dict;
  `write_artifact()` writes it atomically and returns the sha256 of the
  bytes written; `read_artifact()` reads it back and enforces both the
  expected `schema` prefix and that the stored `id` still matches the
  recomputed digest.
- Measure — every numeric fact in this Pack is `{"value": x}` or
  `{"unknown": "<reason>"}`, never a bare number. `known()`, `unknown()`,
  `is_known()` are the only way code should construct or unwrap one.
- Units — integer DBU inside the Pack, micrometres only at the boundaries
  (vendor PLA text, CSV, reports). `um_to_dbu()`/`dbu_to_um()` are the only
  conversion points and both fail closed on an inexact conversion.
- `validate()` — a small JSON-Schema subset used to check record documents
  against their frozen shapes without a third-party dependency.

Fail-closed is the rule for every helper here: a missing, truncated,
duplicated, non-finite or identity-mismatched input yields `unknown` with a
reason, or a `MageError` refusal — never a bare `0` and never a silent
best-effort guess.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path


ARTIFACT_ID_LENGTH = 20


class MageError(Exception):
    """The single refusal type for this Pack.

    `code` is a short kebab-case string every caller can branch on;
    `detail` is a free-form human-readable explanation.
    """

    def __init__(self, code, detail=""):
        message = f"{code}: {detail}" if detail else code
        super().__init__(message)
        self.code = code
        self.detail = detail


def canonical(obj):
    """Canonical JSON bytes: sorted keys, compact separators, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(obj):
    """First 20 hex chars of SHA-256 over `canonical(obj)` — the artifact id rule."""
    return hashlib.sha256(canonical(obj)).hexdigest()[:ARTIFACT_ID_LENGTH]


def file_sha256(path):
    """Full (64 hex char) SHA-256 of a file's bytes."""
    path = Path(path)
    sha = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def tree_digest(dir_path):
    """Full (64 hex char) SHA-256 over a directory's sorted contents.

    Walks `dir_path` and hashes the canonical JSON of the sorted list of
    `{"path": <posix-relative-path>, "size": <bytes>, "sha256": <64 hex>}`
    entries for every regular file underneath it. Raises
    `MageError("missing-input", ...)` when `dir_path` does not exist or is
    not a directory.
    """
    root = Path(dir_path)
    if not root.is_dir():
        raise MageError("missing-input", f"not a directory: {root}")
    entries = []
    for current, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            full = Path(current) / name
            rel = full.relative_to(root).as_posix()
            entries.append({"path": rel, "size": full.stat().st_size, "sha256": file_sha256(full)})
    entries.sort(key=lambda entry: entry["path"])
    return hashlib.sha256(canonical(entries)).hexdigest()


def stamp(kind, obj):
    """Return a copy of `obj` with `schema` and `id` set per the artifact rule.

    `schema` becomes `"mage.<kind>/1"`. `id` is `digest()` of the resulting
    object with its own `id` field removed first (so `id` never depends on
    itself).
    """
    body = dict(obj)
    body["schema"] = f"mage.{kind}/1"
    body.pop("id", None)
    body["id"] = digest(body)
    return body


def write_artifact(path, obj):
    """Atomically write `obj` as pretty JSON to `path`; return sha256 of the bytes written.

    Writes to a sibling temp file first and `os.replace()`s it into place,
    so a failure or crash mid-write never leaves `path` holding partial
    content — either the old content (if any) or nothing is observed at
    `path`, never a truncated file.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    tmp = target.with_name(f"{target.name}.tmp-{os.getpid()}-{int(time.time() * 1e6)}")
    with open(tmp, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(tmp, target)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise
    return hashlib.sha256(data).hexdigest()


def read_artifact(path, kind):
    """Read an artifact written by `write_artifact` and enforce its identity.

    Raises `MageError("schema-mismatch", ...)` when the stored `schema` is
    not `"mage.<kind>/1"`, and `MageError("identity-mismatch", ...)` when
    the stored `id` no longer matches the recomputed digest (tampering or
    hand-edited file).
    """
    target = Path(path)
    try:
        obj = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise MageError("missing-input", f"cannot read artifact {target}: {exc}") from exc
    expected_schema = f"mage.{kind}/1"
    actual_schema = obj.get("schema")
    if actual_schema != expected_schema:
        raise MageError("schema-mismatch", f"expected {expected_schema}, got {actual_schema!r} at {target}")
    stored_id = obj.get("id")
    body = dict(obj)
    body.pop("id", None)
    if stored_id != digest(body):
        raise MageError("identity-mismatch", f"stored id does not match recomputed digest at {target}")
    return obj


def known(value):
    """A Measure carrying an explicitly-known value."""
    return {"value": value}


def unknown(reason):
    """A Measure carrying no value, with a required human-readable reason."""
    return {"unknown": reason}


def is_known(measure):
    """True when `measure` is a known Measure (`{"value": ...}`)."""
    return isinstance(measure, dict) and "value" in measure


def value_of(measure):
    """Unwrap a known Measure's value; raises `MageError("unknown-value", ...)` otherwise."""
    if is_known(measure):
        return measure["value"]
    reason = measure.get("unknown", "") if isinstance(measure, dict) else ""
    raise MageError("unknown-value", reason)


def um_to_dbu(value, dbu_per_um):
    """Convert a micrometre quantity (str/Decimal/number) to an exact integer DBU count.

    Raises `MageError("units", ...)` when `value` is not a decimal
    micrometre quantity, or when the conversion is not exactly representable
    at `dbu_per_um` DBU/um (no silent rounding).
    """
    try:
        ticks = Decimal(str(value)) * dbu_per_um
    except InvalidOperation as exc:
        raise MageError("units", f"not a decimal micrometre quantity: {value!r}") from exc
    if not ticks.is_finite() or ticks != ticks.to_integral_value():
        raise MageError("units", f"{value!r} um is not exactly representable at {dbu_per_um} DBU/um")
    return int(ticks)


def dbu_to_um(value, dbu_per_um):
    """Convert an integer DBU count back to a decimal micrometre string, no trailing zeros."""
    text = format(Decimal(value) / dbu_per_um, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def validate(instance, schema, where="", root=None):
    """Small JSON-Schema subset (type, required, properties, additionalProperties, enum, const, items,
    minItems, maxItems, minLength, pattern, minimum, maximum, $ref '#/$defs/<name>'). Returns error strings."""
    root = schema if root is None else root
    errors = []
    if "$ref" in schema:
        target = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            target = target[part]
        return validate(instance, target, where, root)
    kind = schema.get("type")
    kinds = kind if isinstance(kind, list) else ([kind] if kind else [])
    checks = {"object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
              "string": lambda v: isinstance(v, str), "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
              "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
              "boolean": lambda v: isinstance(v, bool), "null": lambda v: v is None}
    if kinds and not any(checks[k](instance) for k in kinds):
        return [f"{where or '$'}: expected {kind}, got {type(instance).__name__}"]
    if "enum" in schema and instance not in schema["enum"]: errors.append(f"{where or '$'}: not one of {schema['enum']}")
    if "const" in schema and instance != schema["const"]: errors.append(f"{where or '$'}: must equal {schema['const']!r}")
    if isinstance(instance, str):
        if "minLength" in schema and len(instance) < schema["minLength"]: errors.append(f"{where}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], instance): errors.append(f"{where}: does not match {schema['pattern']}")
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]: errors.append(f"{where}: below {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]: errors.append(f"{where}: above {schema['maximum']}")
    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance: errors.append(f"{where or '$'}: missing required {key}")
        props = schema.get("properties", {})
        for key, value in instance.items():
            if key in props: errors.extend(validate(value, props[key], f"{where}/{key}", root))
            elif schema.get("additionalProperties") is False: errors.append(f"{where or '$'}: unexpected key {key}")
    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]: errors.append(f"{where}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(instance) > schema["maxItems"]: errors.append(f"{where}: more than {schema['maxItems']} items")
        if "items" in schema:
            for index, item in enumerate(instance): errors.extend(validate(item, schema["items"], f"{where}[{index}]", root))
    return errors
