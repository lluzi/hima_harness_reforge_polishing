"""Record validation and ledger-coverage helpers for the mage-scribe-placement Pack.

`validate_record(kind, doc)` checks a record document against its frozen
JSON-Schema-subset shape (`flow/schemas/<kind>.json`, read through
`core.validate`). The schema file's `additionalProperties: false` is set
only at the top level per the task's instruction; nested structures (e.g. a
Finding's `numbers`, a Request's `requestedOutcome.limitsUm`) are left loose
there, validated in full only when checked directly against their own
top-level schema.

Two id conventions exist across the record kinds in this Pack (all of them
carry `schema`/`id`, matching the Pack-wide "every record is stamped"
convention, but not every `id` is a content digest):

- Per-round *delivery* documents (`placement-candidate`,
  `consumer-review`, `round-decision`, `placement-result`) are assembled
  once per round/cumulative snapshot and get the usual Pack-wide digest id
  (`core.stamp`/`core.digest`): `id` is the first 20 hex chars of the
  SHA-256 over the canonical body with `id` removed. `validate_record`
  recomputes and checks this for these kinds (`DIGEST_ID_KINDS`).
- Per-item records that are numbered within a containing document
  (`finding` -- `F-<consumer>-<n>` within one evaluator receipt/review;
  `request` -- `R-<consumer>-<round>-<n>`; `decision-request` --
  `D-<round>-<n>`; `ledger-entry` -- `L-<n>` / `L-<round>-<n>`, authored by
  the Engineer one per answered Request) carry a human-assigned sequence id
  instead, scoped by consumer (and, for a Request, by round) so neither one
  Run's four reviews nor the same consumer across rounds ever collide on a
  bare `F-<n>`/`R-<n>` (one carried-over Ledger entry could otherwise
  "answer" a Request it never saw). Their identity is "the nth item from
  this consumer this round", not a digest of their own content (a Finding's
  `id` is explicitly set by the evaluator before the content that depends on
  it, such as `evaluatorReceipt`, is even known; a Ledger entry's `id` is
  authored by the Engineer, not derived). `validate_record` does not attempt
  a digest check for these kinds, but it does enforce each one's `id` (and a
  Ledger entry's `request`) pattern via the schema.

`open_requests(reviews)` flattens every `mage.consumer-review/1`-shaped
dict's `requests` list, in review order. `ledger_covers(open_requests,
ledger_entries)` reports which open Request ids have a `mage.ledger-entry/1`
entry whose `answer` is one of `satisfied`/`alternative`/`declined` -- any
other answer value (or no entry at all) leaves that request `unanswered`.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import core


SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"

# Record kinds whose `id` is the ordinary Pack-wide content digest
# (`core.stamp`), checked by `validate_record` when the document carries an
# `id`. The remaining kinds (`finding`, `request`, `decision-request`) use a
# human-assigned sequence id instead and are never digest-checked here.
# `ledger-entry` is NOT here: its `id` is a human-authored sequence
# (`L-<n>`/`L-<round>-<n>`), never a content digest (see the module
# docstring and `acp.py`). It is still schema-validated (its `request` must
# match the round-scoped Request id pattern), just never digest-checked.
DIGEST_ID_KINDS = {
    "placement-candidate",
    "consumer-review",
    "round-decision",
    "placement-result",
}

ANSWERED_VALUES = {"satisfied", "alternative", "declined"}

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
    """Validate `doc` against `flow/schemas/<kind>.json`; return error strings (empty = valid).

    `kind` is the record's name without extension (e.g. `'finding'`,
    `'ledger-entry'`). Raises `MageError('missing-input', ...)` when no
    schema file exists for `kind`.
    """
    schema = _load_schema(kind)
    errors = core.validate(doc, schema)
    if kind in DIGEST_ID_KINDS and isinstance(doc, dict) and "id" in doc:
        body = {key: value for key, value in doc.items() if key != "id"}
        if doc["id"] != core.digest(body):
            errors.append(f"$: id does not match recomputed digest for kind {kind!r}")
    return errors


def open_requests(reviews):
    """Every `mage.request/1` dict from every review's `requests` list, in order."""
    requests = []
    for review in reviews:
        requests.extend(review.get("requests", []))
    return requests


def ledger_covers(open_requests, ledger_entries):
    """`{'answered': [...], 'unanswered': [...]}` request ids from `open_requests`.

    A request id is `answered` when some `ledger_entries` entry's `request`
    field matches it and its `answer` is in `ANSWERED_VALUES`; any other
    case (no matching entry, or an entry whose `answer` is not one of the
    three accepted values) leaves it `unanswered`. The last matching entry
    for a given request id wins when more than one is present.
    """
    answer_by_request = {}
    for entry in ledger_entries:
        answer_by_request[entry.get("request")] = entry.get("answer")

    answered, unanswered = [], []
    for request in open_requests:
        request_id = request["id"]
        if answer_by_request.get(request_id) in ANSWERED_VALUES:
            answered.append(request_id)
        else:
            unanswered.append(request_id)
    return {"answered": answered, "unanswered": unanswered}
