"""Parser for the Argus FPD DRC deck dialect (stdlib only).

The dialect (learned from the reference Site's ``drc_case.base``, never copied):

* ``var( name value )`` numeric variables.
* ``layer( Name n )`` / ``layer ( Name n )`` layer declarations; layer names are
  case-insensitive.
* ``rule ID { ; comment\\n <body> }`` rule blocks. A ``;`` begins a comment to
  end of line; a whole ``//`` line is a comment. A commented-out rule disappears.
* derived layers ``X = geom_and( A B )`` / ``geom_not( A B )`` / nested /
  ``geom_get_boundaries( A )``.
* checks ``width( L < v ... )``, ``space( L < v ... )``,
  ``space( La Lb < v ... )`` (two-layer) and ``enc( inner outer < v ... )``,
  where ``v`` is a literal, ``$var`` or a bare var name.

The value Argus applies is the literal/variable *in the check*; the ``;`` comment
(which may name a different ``$var``) is ignored. A derived layer used in a check
resolves to its first base operand for compaction (conservative). Any other
construct (``geom_interact``, unknown functions, ``check_original_layer``) is
``kind: "other"``, ``modelled: false`` and listed in ``unmodelled``.
"""
from __future__ import annotations

import re

from .core import PixelError

_MODELLED_FUNCS = ("width", "space", "enc")

_VAR_RE = re.compile(r'\bvar\(\s*([A-Za-z_]\w*)\s+(-?\d+(?:\.\d+)?)\s*\)')
_LAYER_RE = re.compile(r'\blayer\s*\(\s*([A-Za-z_]\w*)\s+(\d+)\s*\)')
_RULE_RE = re.compile(r'\brule\s+(\S+)\s*\{(.*?)\}', re.DOTALL)
_ASSIGN_RE = re.compile(r'^\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s*$', re.MULTILINE)
_DBPREC_RE = re.compile(r'layout_use_db_precision\(\s*yes\s*\)')
_PREC_RE = re.compile(r'(?<![A-Za-z_])precision\(\s*(\d+)\s*\)')
_TOL_RE = re.compile(r'drc_tolerance\(\s*distance\s+(-?\d+(?:\.\d+)?)\s*\)')
_PATH_RE = re.compile(r'layout_input\(\s*path\s+"[^"]*"\s*\)')


def _strip_comments(text):
    """Drop ``//`` and ``;`` comments (each to end of line), per line."""
    out = []
    for line in text.splitlines():
        cut = len(line)
        i = line.find("//")
        if i != -1:
            cut = min(cut, i)
        j = line.find(";")
        if j != -1:
            cut = min(cut, j)
        out.append(line[:cut])
    return "\n".join(out)


def _split_top(args):
    """Split ``args`` on whitespace at paren depth 0, keeping nested calls whole."""
    tokens = []
    depth = 0
    buf = []
    for ch in args:
        if ch == "(":
            depth += 1
            buf.append(ch)
        elif ch == ")":
            depth -= 1
            buf.append(ch)
        elif ch.isspace() and depth == 0:
            if buf:
                tokens.append("".join(buf))
                buf = []
        else:
            buf.append(ch)
    if buf:
        tokens.append("".join(buf))
    return tokens


def _first_base(expr, derived):
    """Resolve a (possibly derived/nested) layer expression to its first base name."""
    seen = set()
    cur = expr.strip()
    while True:
        m = re.match(r'^([A-Za-z_]\w*)\s*\((.*)\)\s*$', cur)
        if m:
            inner = m.group(2)
            toks = _split_top(inner)
            if not toks:
                return cur
            cur = toks[0].strip()
            continue
        if cur in derived and cur not in seen:
            seen.add(cur)
            cur = derived[cur].strip()
            continue
        return cur


def _resolve_value(token, vars_):
    token = token.strip()
    if token.startswith("$"):
        name = token[1:]
        return vars_.get(name)
    try:
        return float(token)
    except ValueError:
        if token in vars_:
            return vars_[token]
        return None


def _call_args(body, func):
    """Return the argument string of the first ``func( ... )`` call in ``body``."""
    m = re.search(r'\b' + re.escape(func) + r'\s*\(', body)
    if not m:
        return None
    start = m.end()
    depth = 1
    i = start
    while i < len(body) and depth > 0:
        if body[i] == "(":
            depth += 1
        elif body[i] == ")":
            depth -= 1
        i += 1
    return body[start:i - 1]


def _parse_check(rule_id, body, vars_, derived, unmodelled):
    """Parse a single rule body into a check descriptor."""
    func = None
    for cand in _MODELLED_FUNCS:
        if re.search(r'\b' + cand + r'\s*\(', body):
            func = cand
            break

    if func is None:
        # geom_interact / check_original_layer / unknown -> unmodelled "other"
        reason = "unmodelled"
        for other in ("geom_interact", "check_original_layer"):
            if other in body:
                reason = other
                break
        unmodelled.append("%s: %s" % (rule_id, reason))
        return {"rule": rule_id, "kind": "other", "layers": [], "value": None,
                "modelled": False, "derivedFrom": None, "text": body.strip()}

    args = _call_args(body, func)
    before, _, after = args.partition("<")
    layer_tokens = _split_top(before)
    value_token = _split_top(after)
    value = _resolve_value(value_token[0], vars_) if value_token else None

    if func == "width":
        kind = "width"
    elif func == "enc":
        kind = "enc"
    else:  # space
        kind = "space2" if len(layer_tokens) >= 2 else "space"

    derived_from = {}
    for name in layer_tokens:
        if name in derived:
            derived_from[name] = derived[name]
    return {
        "rule": rule_id,
        "kind": kind,
        "layers": layer_tokens,
        "value": value,
        "modelled": True,
        "derivedFrom": derived_from or None,
        "text": ("%s( %s )" % (func, args)).strip(),
    }


def parse_deck(text):
    """Parse an Argus DRC deck into vars, layers, derived layers, checks and options."""
    clean = _strip_comments(text)

    vars_ = {}
    for m in _VAR_RE.finditer(clean):
        vars_[m.group(1)] = float(m.group(2))

    layers = {}
    for m in _LAYER_RE.finditer(clean):
        layers[m.group(1)] = int(m.group(2))

    def assignments(text):
        out = {}
        for m in _ASSIGN_RE.finditer(text):
            rhs = m.group(2).strip()
            if rhs.startswith("geom_") or re.match(r'^[A-Za-z_]\w*\s*\(', rhs):
                out[m.group(1)] = rhs
        return out

    # Global derived layers are those assigned outside every rule block; an assignment inside a
    # rule body is local to that rule (decks reuse names such as X in many rules).
    derived = assignments(_RULE_RE.sub("", clean))

    checks = []
    unmodelled = []
    for m in _RULE_RE.finditer(clean):
        rule_id = m.group(1)
        body = m.group(2)
        scope = dict(derived)
        scope.update(assignments(body))
        chk = _parse_check(rule_id, body, vars_, scope, unmodelled)
        if chk.get("derivedFrom"):
            # keep the whole chain this check needs, so resolution never consults another rule's names
            chain = {}
            todo = list(chk["derivedFrom"])
            while todo:
                name = todo.pop()
                if name in scope and name not in chain:
                    chain[name] = scope[name]
                    todo.extend(re.findall(r'[A-Za-z_]\w*', scope[name]))
            chk["derivedFrom"] = chain
        checks.append(chk)

    options = {
        "db_precision": bool(_DBPREC_RE.search(clean)),
        "tolerance": None,
    }
    tol = _TOL_RE.search(clean)
    if tol:
        options["tolerance"] = float(tol.group(1))

    return {"vars": vars_, "layers": layers, "derived": derived,
            "checks": checks, "unmodelled": unmodelled, "options": options}


def compaction_table(parsed, case):
    """Fold a parsed deck's modelled checks into per-layer/-pair constraints.

    ``{"width": {L: v}, "space": {L: v}, "xspace": [[La, Lb, v]],
       "enc": [[outer, inner, v]], "unmodelled": [...]}``

    Layer names are canonicalised (case-insensitively) to the manifest's names;
    a derived layer resolves to its first base operand.
    """
    canon = {}
    if case is not None:
        for name in case.raw.get("layers", {}):
            canon[name.lower()] = name
    derived = parsed.get("derived", {})

    def resolve_layer(token, chk=None):
        scope = dict(derived)
        if chk and chk.get("derivedFrom"):
            scope.update(chk["derivedFrom"])
        base = _first_base(token, scope)
        return canon.get(base.lower(), base)

    width = {}
    space = {}
    xspace = []
    enc = []
    for chk in parsed["checks"]:
        if not chk["modelled"] or chk["value"] is None:
            continue
        kind = chk["kind"]
        layers = chk["layers"]
        value = chk["value"]
        if kind == "width" and layers:
            layer = resolve_layer(layers[0], chk)
            width[layer] = max(value, width.get(layer, value))
        elif kind == "space" and layers:
            layer = resolve_layer(layers[0], chk)
            space[layer] = max(value, space.get(layer, value))
        elif kind == "space2" and len(layers) >= 2:
            xspace.append([resolve_layer(layers[0], chk), resolve_layer(layers[1], chk), value])
        elif kind == "enc" and len(layers) >= 2:
            inner = resolve_layer(layers[0], chk)
            outer = resolve_layer(layers[1], chk)
            enc.append([outer, inner, value])

    return {"width": width, "space": space, "xspace": xspace, "enc": enc,
            "unmodelled": list(parsed.get("unmodelled", []))}


def _strip_rules(text, funcs):
    """Remove whole ``rule ID { ... }`` blocks whose body uses any of ``funcs``."""
    stripped = []
    patterns = [re.compile(r'~?\b' + re.escape(f) + r'\b') for f in funcs]

    def repl(m):
        body = m.group(2)
        for pat in patterns:
            if pat.search(body):
                stripped.append(m.group(1))
                return ""
        return m.group(0)

    out = _RULE_RE.sub(repl, text)
    return out, stripped


def make_rule_file(deck_text, gds_path, top_cell, strip_functions=()):
    """Specialise a deck for one candidate GDS; returns ``(rule_text, record)``.

    Substitutes the layout input path/top-cell, forces the DRC result/summary
    names, ensures exactly one ``layout_use_db_precision( yes )`` (replacing a
    ``precision( N )`` line or inserting one), and removes any rule block that
    uses a function the Site licence cannot run. Raises ``PixelError('schema')``
    only when the deck has no ``layout_input( path ... )`` line or no rule blocks.
    """
    if not _PATH_RE.search(deck_text):
        raise PixelError("schema", "deck has no layout_input( path ... ) line")
    if not _RULE_RE.search(deck_text):
        raise PixelError("schema", "deck has no rule blocks")

    record = {"precision": None, "stripped": []}
    text = deck_text

    text = _PATH_RE.sub(lambda m: 'layout_input( path "%s" )' % gds_path, text)
    text = re.sub(r'layout_input\(\s*top_cell\s+"[^"]*"\s*\)',
                  lambda m: 'layout_input( top_cell "%s" )' % top_cell, text)
    text = re.sub(r'drc_result\(\s*db\s+"[^"]*"\s*\)',
                  lambda m: 'drc_result( db "argus_drc.db" )', text)
    text = re.sub(r'drc_summary\(\s*"[^"]*"\s*\)',
                  lambda m: 'drc_summary( "argus_drc.sum" )', text)

    if _DBPREC_RE.search(text):
        record["precision"] = "present"
    else:
        mprec = _PREC_RE.search(text)
        if mprec:
            text = text[:mprec.start()] + "layout_use_db_precision( yes )" + text[mprec.end():]
            record["precision"] = "replaced precision( %s )" % mprec.group(1)
        else:
            text = _PATH_RE.sub(
                lambda m: m.group(0) + "\nlayout_use_db_precision( yes )", text, count=1)
            record["precision"] = "inserted"

    if strip_functions:
        text, stripped = _strip_rules(text, tuple(strip_functions))
        record["stripped"] = stripped

    return text, record
