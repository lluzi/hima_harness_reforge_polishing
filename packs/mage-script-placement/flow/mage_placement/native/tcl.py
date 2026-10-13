"""Minimal, refusal-safe Tcl text helpers for the round-script templates.

Only two operations are needed: turning a plain path/value into a brace-
quoted Tcl literal (`quote`), and filling a template's `@NAME@` placeholders
with such literals (`fill`). Both fail closed via `core.MageError("tcl",
...)` rather than silently emitting a script MAGE could misparse.
"""
from __future__ import annotations

import re

from .. import core


_FORBIDDEN_CHARS = ("{", "}", "\n", "[", "$", "\\")
_PLACEHOLDER_RE = re.compile(r"@([A-Z0-9_]+)@")


def quote(value):
    """Return `value` as a Tcl brace-quoted literal: `{<value>}`.

    Refuses (`core.MageError("tcl", ...)`) when `value` contains a brace,
    a newline, `[`, `$`, or a backslash — any of which would change how
    MAGE's Tcl interpreter parses the surrounding script.
    """
    text = str(value)
    for char in _FORBIDDEN_CHARS:
        if char in text:
            raise core.MageError("tcl", f"value contains forbidden character {char!r}: {text!r}")
    return "{" + text + "}"


def fill(template_text, mapping):
    """Substitute every `@NAME@` placeholder in `template_text` from `mapping`.

    Refuses (`core.MageError("tcl", ...)`) when the template's placeholder
    set and `mapping`'s key set are not exactly equal — a placeholder with
    no supplied value, or a supplied value with no placeholder to fill,
    both indicate a template/driver mismatch rather than something to
    paper over.
    """
    placeholders = set(_PLACEHOLDER_RE.findall(template_text))
    keys = set(mapping.keys())
    missing = placeholders - keys
    unused = keys - placeholders
    if missing or unused:
        detail = f"missing={sorted(missing)} unused={sorted(unused)}"
        raise core.MageError("tcl", f"template/mapping mismatch: {detail}")

    def _replace(match):
        return str(mapping[match.group(1)])

    return _PLACEHOLDER_RE.sub(_replace, template_text)
