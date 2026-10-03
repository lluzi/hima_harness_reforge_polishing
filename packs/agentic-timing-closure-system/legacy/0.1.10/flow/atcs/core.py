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
  everywhere a specific timing check needs to be named. A check is
  identified by *(endpoint, path group)*: `atcs.reports.parse_path_report`
  folds a reserved PT path group (``**async_default**`` and friends) into
  its returned ``"endpoint"`` as ``"<endpoint>@<path group>"``, so a
  removal/recovery check and a data setup/hold check on one register never
  collide, and the key never depends on report order.

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


def require(mapping, key, label):
    """Return `mapping[key]`, or raise `AtcsError("missing-input", ...)` if absent.

    Final review (mechanical dedupe): every `atcs` module used to define its own
    private, byte-identical copy of this helper (`contributions.py`,
    `experience.py`, `lifecycle.py`, `residual.py`, `state.py`, `workspaces.py`)
    -- this is the one shared source every one of them now imports instead.
    `label` is the mapping's own name (e.g. `"work_package"`, `"workspaceManifest"`),
    used to compose the error detail as `"<label>.<key>"`; every caller passes it
    explicitly, since a single Pack-wide default could not describe every mapping's
    meaning. `mapping` must be a `dict` -- a non-dict is treated exactly like a
    missing key, since these are Site/Workshop-supplied external inputs, not
    caller-guaranteed internal structures, and a raw `KeyError`/`TypeError` must
    never escape.
    """
    if not isinstance(mapping, dict) or key not in mapping:
        raise AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def required_scenarios(value, label="requiredScenarios"):
    """Validate one ordered, non-empty list of scenario names.

    Scenario identity comes from the admitted analysis contract or its derived policy. Pack code
    never supplies a design-specific default, and malformed or duplicate names fail before tool
    compilation, evaluation or refresh accounting.
    """
    if not isinstance(value, list) or not value:
        raise AtcsError("missing-input", f"{label} must be a non-empty list")
    if not all(isinstance(name, str) and name for name in value):
        raise AtcsError("invalid-input", f"{label} must contain non-empty strings")
    if len(set(value)) != len(value):
        raise AtcsError("invalid-input", f"{label} contains duplicate scenario names")
    return tuple(value)

UNSAFE_TCL_CHARS = set(';[]{}$"\n\\')
"""Characters (plus a backslash, so a value can never begin a Tcl-level escape sequence) that make
a string unsafe to embed literally in generated Tcl. Final review (mechanical dedupe):
`atcs.adapters._UNSAFE_TCL_CHARS` (without the backslash) and `atcs.integration._UNSAFE_TCL_CHARS`
(with it) used to each define their own copy -- both now re-export this one, backslash included."""

UNSAFE_TCL_CHARS_IN_BRACES = set(';{}$"\\')
"""I7 (final review, bus-bit-safe names): the characters still unsafe for a value that a caller
is about to embed inside a literal Tcl brace group (`{...}`, e.g. via `adapters.tcl_list_literal`
or `integration._tcl_list`) -- `[`/`]` are dropped relative to `UNSAFE_TCL_CHARS` because Tcl's
brace quoting disables every substitution of the group's own contents, so a real bus-bit signal
or pin name (`bus[3]`, `U/A[2]`) is safe there without being refused. A backslash, `{`/`}` (would
break the enclosing brace's own balance), `$`/`"`/`;` (kept refused defensively, even though brace
quoting alone would already neutralize them, since this task's brief scopes the relaxation to
bus-bit brackets specifically) remain unsafe, as do whitespace and any other control character
(both checked separately by `is_tcl_unsafe`, never folded into this set, since they are refused
in every context regardless of bracing). Every caller of a check that consults this set MUST
actually wrap the checked value in `{...}` (or an `adapters.tcl_list_literal`/`integration._tcl_list`
call) at its own use site -- this set is deliberately never used for a value substituted bare or
inside a double-quoted Tcl string, where `[`/`]` would still trigger real command/array
substitution."""


def is_tcl_unsafe(value, allow_brackets=False):
    """True when `value` contains a character unsafe to embed literally in generated Tcl.

    Shared by `adapters.tcl_safe`/`integration._validate_tcl_value` (the emitters) and
    `workspaces._collect_problems` (final review, I7: a work package's `editDomain`
    instance/net names are now pre-flighted against the exact same rule the emitters
    apply at replay/capture time, so a name a tool would refuse is never admitted by
    the Reader/validator first) -- one shared rule, so "a Reader never admits what a
    tool refuses" by construction, not by keeping two independently-maintained copies
    in sync by hand. Every control character (checked by codepoint, not just the
    common whitespace ones `str.isspace()` already covers) is always unsafe,
    regardless of `allow_brackets`; see `UNSAFE_TCL_CHARS_IN_BRACES`'s own docstring
    for what `allow_brackets=True` additionally admits and why.
    """
    charset = UNSAFE_TCL_CHARS_IN_BRACES if allow_brackets else UNSAFE_TCL_CHARS
    return any(ch.isspace() or ord(ch) < 0x20 or ord(ch) == 0x7F or ch in charset for ch in value)
