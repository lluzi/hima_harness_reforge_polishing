"""Shared core helpers for the agentic-timing-closure-system Pack.

This module owns the primitives every other `atcs` module and every later
task (M2-M8, Readers) builds on:

- `AtcsError` — the single refusal type used across the Pack. `code` is a
  kebab-case string (e.g. ``"missing-input"``, ``"schema-mismatch"``,
  ``"duplicate-check"``); `detail` is a free-form human string.
- Canonical JSON + digests — `canonical()`/`digest()` implement the artifact
  id rule from ``.superpowers/sdd/global-context.md`` ("Shared data model"):
  an artifact's `id` is the first 20 hex characters of the SHA-256 over the
  canonical JSON encoding (``json.dumps(sort_keys=True,
  separators=(",", ":"), ensure_ascii=False)``, UTF-8) of the artifact
  *without* its own `id` field.
- File/tree hashing — `file_sha256()` is a plain SHA-256 over a file's bytes
  (64 hex chars); `tree_digest()` is a SHA-256 (64 hex chars) over the
  canonical JSON of a directory's sorted `{relative path, size, sha256}`
  triples, so it changes if any file's content, size, path or presence
  changes.
- Artifact I/O — `stamp()` adds `schema`/`id` to a plain field dict;
  `write_artifact()` writes it atomically and returns the sha256 of the
  bytes written; `read_artifact()` reads it back and enforces both the
  expected `schema` prefix and (defensively) that the stored `id` still
  matches the recomputed digest, raising `AtcsError("schema-mismatch", ...)`
  or `AtcsError("identity-mismatch", ...)` otherwise.
- Measure — every numeric fact in this Pack is `{"value": x}` or
  `{"unknown": "<reason>"}`, never a bare number, so that "we didn't measure
  this" can never be confused with "the measured value is zero". `known()`,
  `unknown()`, `is_known()` and `value_of()` are the only way code should
  construct or unwrap one.
- `check_key()` — the canonical `"<scenario>|<mode>|<endpoint>"` string used
  everywhere a specific timing check needs to be named. Note this key does
  **not** include the path group: two path-report rows for the same
  scenario/mode/endpoint but different path groups collide on purpose (see
  `atcs.reports.parse_path_report`, which refuses such reports as
  `AtcsError("duplicate-check", ...)` rather than silently keeping one).

Fail-closed is the rule for every helper here: a missing, truncated,
duplicated, non-finite or identity-mismatched input yields `unknown` with a
reason, or an `AtcsError` refusal — never a bare `0` and never a silent
best-effort guess.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import time


ARTIFACT_ID_LENGTH = 20


class AtcsError(Exception):
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
    `AtcsError("missing-input", ...)` when `dir_path` does not exist or is
    not a directory — callers (e.g. `atcs.state.design_state`) should let
    this propagate rather than substituting a placeholder digest.
    """
    root = Path(dir_path)
    if not root.is_dir():
        raise AtcsError("missing-input", f"not a directory: {root}")
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

    `schema` becomes `"atcs.<kind>/1"`. `id` is `digest()` of the resulting
    object with its own `id` field removed first (so `id` never depends on
    itself).
    """
    body = dict(obj)
    body["schema"] = f"atcs.{kind}/1"
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

    Raises `AtcsError("schema-mismatch", ...)` when the stored `schema` is
    not `"atcs.<kind>/1"`, and `AtcsError("identity-mismatch", ...)` when
    the stored `id` no longer matches the recomputed digest (tampering or
    hand-edited file).
    """
    target = Path(path)
    try:
        obj = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise AtcsError("missing-input", f"cannot read artifact {target}: {exc}") from exc
    expected_schema = f"atcs.{kind}/1"
    actual_schema = obj.get("schema")
    if actual_schema != expected_schema:
        raise AtcsError("schema-mismatch", f"expected {expected_schema}, got {actual_schema!r} at {target}")
    stored_id = obj.get("id")
    body = dict(obj)
    body.pop("id", None)
    if stored_id != digest(body):
        raise AtcsError("identity-mismatch", f"stored id does not match recomputed digest at {target}")
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
    """Unwrap a known Measure's value; raises `AtcsError("unknown-value", ...)` otherwise."""
    if is_known(measure):
        return measure["value"]
    reason = measure.get("unknown", "") if isinstance(measure, dict) else ""
    raise AtcsError("unknown-value", reason)


def check_key(scenario, mode, endpoint):
    """The canonical `"<scenario>|<mode>|<endpoint>"` check identity string."""
    return f"{scenario}|{mode}|{endpoint}"
