"""Record validation for the mage-script-placement Pack.

`validate_record(kind, doc)` checks a document against `flow/schemas/<kind>.json`
through `core.validate`. Kinds in `DIGEST_ID_KINDS` are stamped with
`core.stamp` and their `id` is re-derived here; `journal-entry` is authored by
the Engineer and is schema-checked only.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import core


SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"
DIGEST_ID_KINDS = {
    "stage-summary", "stage-report", "script-candidate", "round-decision", "script-result", "method-journal",
}
_SCHEMA_CACHE = {}


def _load_schema(kind):
    if kind not in _SCHEMA_CACHE:
        path = SCHEMAS_DIR / f"{kind}.json"
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise core.MageError("missing-input", f"no schema for record kind {kind!r}: {exc}") from exc
        _SCHEMA_CACHE[kind] = json.loads(text)
    return _SCHEMA_CACHE[kind]


def validate_record(kind, doc):
    """Validate `doc` against `flow/schemas/<kind>.json`; return error strings (empty = valid)."""
    schema = _load_schema(kind)
    errors = core.validate(doc, schema)
    if kind in DIGEST_ID_KINDS and isinstance(doc, dict) and "id" in doc:
        body = {key: value for key, value in doc.items() if key != "id"}
        if doc["id"] != core.digest(body):
            errors.append(f"$: id does not match recomputed digest for kind {kind!r}")
    return errors
