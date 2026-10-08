"""Insight rules: the structural check of one `insight` block and the fixed page builder.

The shape is knowledge/insight-rule-shape.md. `check_rule` returns plain problem sentences (an
empty list is the only acceptance); every sentence names the field so a delivery problem can go
straight back to the resident. `build_page` fills the Pack's fixed template (page/insight-page.html)
the same way the Host's `insightPage` does: the rules go into the inert JSON data element at the one
`/*INSIGHT-DATA*/` marker, escaped so no string can close the element, and the template's one bare
`<script>` stays byte-identical on every page so a CSP can allow it by its hash.

Python 3.6+, standard library only.
"""
import base64
import hashlib
import json
import math
import os
import re
import sys

MARKER = "/*INSIGHT-DATA*/"
SCRIPT = re.compile(r"<script>([\s\S]*?)</script>")
TEMPLATE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                        "page", "insight-page.html")

ID = re.compile(r"^[a-z][a-z0-9_]{2,47}$")
KINDS = ("vmin", "gaps", "path", "spike")
DIMENSIONS = ("quality", "ppa", "robustness", "none")
WHO = ("chip_designer", "cell_designer", "library_provider", "note")
OP_FROM = ("report", "fo4")
MAX_ITEMS = 400
MAX_STAGES = 400
MAX_PROBLEMS = 40

COMMON = ("id", "kind", "title", "summary", "result", "rule", "library", "facts", "score", "impact", "todo",
          "items")
OPTIONAL = ("hint",)
KIND_FIELDS = {
    "vmin": ("hi", "lo", "temps", "watch", "rows", "fan", "clsbox"),
    "gaps": ("matrix",),
    "path": ("design", "paths"),
    "spike": ("by_variant", "by_kind", "by_family"),
}
BOX = ("p5", "p25", "p50", "p75", "p95", "mn", "mx", "n")
BRIEF = ("cell", "arc", "symptom", "now", "target", "unit", "compare", "where", "levers", "cost", "check")


class _Check(object):
    """Collects problem sentences; each helper returns whether the value passed."""

    def __init__(self):
        self.out = []

    def bad(self, at, sentence):
        self.out.append("%s %s" % (at, sentence))
        return False

    def text(self, at, value, high, low=1):
        if isinstance(value, str) and low <= len(value) <= high and (low == 0 or value.strip()):
            return True
        if low == 0:
            return self.bad(at, "must be a string of at most %d characters" % high)
        return self.bad(at, "must be a non-empty string of at most %d characters" % high)

    def number(self, at, value, null=False, low=None, high=None):
        if value is None and null:
            return True
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            return self.bad(at, "must be a finite number%s, not %s" % (" or null" if null else "", _show(value)))
        if low is not None and value < low:
            return self.bad(at, "must be at least %s, not %s" % (low, value))
        if high is not None and value > high:
            return self.bad(at, "must be at most %s, not %s" % (high, value))
        return True

    def integer(self, at, value, low=0, high=None):
        if isinstance(value, bool) or not isinstance(value, int):
            return self.bad(at, "must be a whole number, not %s" % _show(value))
        if value < low or (high is not None and value > high):
            return self.bad(at, "must be between %d and %s, not %d" % (low, "any" if high is None else high, value))
        return True

    def array(self, at, value, low, high):
        if not isinstance(value, list):
            return self.bad(at, "must be a list of %d to %d entries" % (low, high))
        if not low <= len(value) <= high:
            return self.bad(at, "has %d entries; it takes %d to %d" % (len(value), low, high))
        return True

    def obj(self, at, value, keys):
        if not isinstance(value, dict):
            return self.bad(at, "must be an object with %s" % ", ".join(keys))
        missing = [key for key in keys if key not in value]
        if missing:
            return self.bad(at, "is missing %s" % ", ".join(missing))
        return True

    def numbers(self, at, value, low, high, null=False, length=None):
        if not self.array(at, value, low, high):
            return False
        if length is not None and len(value) != length:
            return self.bad(at, "has %d entries; it must have %d" % (len(value), length))
        ok = True
        for index, item in enumerate(value):
            ok = self.number("%s[%d]" % (at, index), item, null=null) and ok
        return ok

    def pairs(self, at, value, low, high, label, text_high, numbers=False):
        if not self.array(at, value, low, high):
            return
        for index, pair in enumerate(value):
            where = "%s[%d]" % (at, index)
            if not isinstance(pair, list) or len(pair) != 2:
                self.bad(where, "must be a [label, value] pair")
                continue
            self.text(where + "[0]", pair[0], label)
            if numbers == "count":
                self.integer(where + "[1]", pair[1])
            elif isinstance(pair[1], (int, float)) and not isinstance(pair[1], bool):
                self.number(where + "[1]", pair[1])
            elif numbers and not isinstance(pair[1], str):
                self.bad(where + "[1]", "must be a string or a finite number")
            else:
                self.text(where + "[1]", pair[1], text_high)


def _show(value):
    if isinstance(value, float):
        return repr(value)
    return json.dumps(value)[:40] if not isinstance(value, (dict, list)) else type(value).__name__


def _non_finite(value, at, out):
    """Every float anywhere must be finite (Python callers can hold NaN even when JSON cannot)."""
    if isinstance(value, float) and not math.isfinite(value):
        out.append("%s must be a finite number (use null for unknown), not %r" % (at, value))
    elif isinstance(value, dict):
        for key in value:
            _non_finite(value[key], "%s.%s" % (at, key), out)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _non_finite(item, "%s[%d]" % (at, index), out)


def _box(c, at, value, null=False):
    if value is None and null:
        return
    if not c.obj(at, value, BOX):
        return
    for key in BOX[:-1]:
        c.number("%s.%s" % (at, key), value[key])
    c.integer(at + ".n", value["n"])


def _boxes(c, at, value, length=None):
    if not c.array(at, value, 1, 32):
        return
    if length is not None and len(value) != length:
        c.bad(at, "has %d boxes; it must have one per voltage (%d)" % (len(value), length))
    for index, box in enumerate(value):
        _box(c, "%s[%d]" % (at, index), box, null=True)


def _brief(c, at, brief):
    if not isinstance(brief, dict):
        c.bad(at, "must be an object with %s" % ", ".join(BRIEF))
        return
    keys = set(brief)
    if keys != set(BRIEF):
        c.bad(at, "fields: missing %s; unexpected %s; a brief has exactly %s" % (
            sorted(set(BRIEF) - keys), sorted(keys - set(BRIEF)), ", ".join(BRIEF)))
        return
    c.text(at + ".cell", brief["cell"], 120)
    c.text(at + ".arc", brief["arc"], 60)
    c.text(at + ".symptom", brief["symptom"], 400)
    c.number(at + ".now", brief["now"])
    c.number(at + ".target", brief["target"])
    c.text(at + ".unit", brief["unit"], 40)
    c.text(at + ".compare", brief["compare"], 400)
    if brief["where"] is not None:
        c.text(at + ".where", brief["where"], 600)
    if c.array(at + ".levers", brief["levers"], 1, 4):
        for index, lever in enumerate(brief["levers"]):
            where = "%s.levers[%d]" % (at, index)
            if c.obj(where, lever, ("change", "effect")):
                c.text(where + ".change", lever["change"], 300)
                c.text(where + ".effect", lever["effect"], 300)
    c.pairs(at + ".cost", brief["cost"], 0, 6, 40, 80, numbers=True)
    c.text(at + ".check", brief["check"], 400)


def _vmin(c, rule):
    temps = rule["temps"]
    if (c.number("hi", rule["hi"]) & c.number("lo", rule["lo"])) and rule["hi"] <= rule["lo"]:
        c.bad("hi", "(%s V) must be above lo (%s V)" % (rule["hi"], rule["lo"]))
    if c.array("temps", temps, 1, 4):
        for index, temp in enumerate(temps):
            c.text("temps[%d]" % index, temp, 12)
    else:
        temps = []
    c.number("watch", rule["watch"], low=0)
    if c.array("rows", rule["rows"], 1, 32):
        for index, row in enumerate(rule["rows"]):
            at = "rows[%d]" % index
            if c.obj(at, row, ("v", "b", "n", "dots")):
                c.text(at + ".v", row["v"], 60)
                _box(c, at + ".b", row["b"])
                c.integer(at + ".n", row["n"])
                c.numbers(at + ".dots", row["dots"], 0, MAX_ITEMS)
    volts = {}
    if not isinstance(rule["fan"], dict) or len(rule["fan"]) > 128:
        c.bad("fan", "must be an object of at most 128 \"<variant>|<temp>\" entries")
    else:
        for key in sorted(rule["fan"]):
            at = "fan[%s]" % json.dumps(key)
            fan = rule["fan"][key]
            if c.obj(at, fan, ("volts", "inv", "boxes")) and c.numbers(at + ".volts", fan["volts"], 2, 12):
                volts[key] = len(fan["volts"])
                c.numbers(at + ".inv", fan["inv"], 2, 12, length=len(fan["volts"]))
                _boxes(c, at + ".boxes", fan["boxes"], len(fan["volts"]))
    if not isinstance(rule["clsbox"], dict) or len(rule["clsbox"]) > 800:
        c.bad("clsbox", "must be an object of at most 800 \"<variant>|<temp>|<class>\" entries")
    else:
        for key in sorted(rule["clsbox"]):
            at = "clsbox[%s]" % json.dumps(key)
            box = rule["clsbox"][key]
            if c.obj(at, box, ("n", "boxes")):
                c.integer(at + ".n", box["n"])
                _boxes(c, at + ".boxes", box["boxes"])
    for index, item in enumerate(rule["items"] if isinstance(rule["items"], list) else []):
        at = "items[%d]" % index
        if not c.obj(at, item, ("name", "label", "v", "t", "x", "cls", "extra", "fan", "focus")):
            continue
        c.text(at + ".name", item["name"], 120)
        c.text(at + ".v", item["v"], 60)
        c.text(at + ".cls", item["cls"], 60)
        c.number(at + ".x", item["x"])
        if temps and item["t"] not in temps:
            c.bad(at + ".t", "%s must be one of temps %s" % (_show(item["t"]), temps))
        for field in ("extra", "fan"):
            value = item[field]
            if not isinstance(value, dict) or (temps and set(value) - set(temps)):
                c.bad("%s.%s" % (at, field), "must be an object keyed by the temps %s" % temps)
                continue
            for temp in sorted(value):
                where = "%s.%s[%s]" % (at, field, json.dumps(temp))
                if field == "extra":
                    c.number(where, value[temp], null=True)
                else:
                    length = volts.get("%s|%s" % (item["v"], temp))
                    c.numbers(where, value[temp], 2, 12, null=True, length=length)
        if item.get("brief") is not None:
            _brief(c, at + ".brief", item["brief"])


def _gaps(c, rule):
    matrix = rule["matrix"]
    vts = 0
    if c.obj("matrix", matrix, ("tracks", "vts", "counts")):
        ok = c.array("matrix.tracks", matrix["tracks"], 1, 8) and c.array("matrix.vts", matrix["vts"], 1, 8)
        if ok:
            for name in ("tracks", "vts"):
                for index, label in enumerate(matrix[name]):
                    c.text("matrix.%s[%d]" % (name, index), label, 20)
            vts = len(matrix["vts"])
            counts = matrix["counts"]
            if not isinstance(counts, list) or len(counts) != len(matrix["tracks"]):
                c.bad("matrix.counts", "must hold one row per track (%d)" % len(matrix["tracks"]))
            else:
                for index, row in enumerate(counts):
                    if not isinstance(row, list) or len(row) != vts:
                        c.bad("matrix.counts[%d]" % index, "must hold one count or null per VT (%d)" % vts)
                        continue
                    for column, count in enumerate(row):
                        if count is not None:
                            c.integer("matrix.counts[%d][%d]" % (index, column), count)
    for index, item in enumerate(rule["items"] if isinstance(rule["items"], list) else []):
        at = "items[%d]" % index
        if not c.obj(at, item, ("label", "cls", "v", "ratio", "vts", "i", "cells", "lo", "hi", "miss", "pen_area",
                                "pen_leak", "weak", "focus")):
            continue
        c.text(at + ".cls", item["cls"], 60)
        c.text(at + ".v", item["v"], 60)
        c.number(at + ".ratio", item["ratio"], low=1)
        c.integer(at + ".vts", item["vts"], 1, vts or None)
        for field in ("pen_area", "pen_leak", "weak"):
            c.number("%s.%s" % (at, field), item[field])
        cells = item["cells"]
        if c.array(at + ".cells", cells, 2, 64):
            for position, cell in enumerate(cells):
                where = "%s.cells[%d]" % (at, position)
                if c.obj(where, cell, ("name", "s", "drive", "area", "leak", "d4", "d16")):
                    c.text(where + ".name", cell["name"], 120)
                    c.text(where + ".s", cell["s"], 60)
                    if c.number(where + ".drive", cell["drive"]) and cell["drive"] <= 0:
                        c.bad(where + ".drive", "must be above 0 (drive is drawn on a log axis)")
                    c.number(where + ".area", cell["area"], low=0)
                    for field in ("leak", "d4", "d16"):
                        c.number("%s.%s" % (where, field), cell[field], null=True)
            if c.integer(at + ".i", item["i"]) and item["i"] > len(cells) - 2:
                c.bad(at + ".i", "must index the lower cell of the gap (0 to %d)" % (len(cells) - 2))
        for side in ("lo", "hi"):
            where = "%s.%s" % (at, side)
            if c.obj(where, item[side], ("name", "s", "drive", "area")):
                c.text(where + ".name", item[side]["name"], 120)
                c.text(where + ".s", item[side]["s"], 60)
                c.number(where + ".drive", item[side]["drive"], low=0)
                c.number(where + ".area", item[side]["area"], low=0)
        if c.obj(at + ".miss", item["miss"], ("drive", "area")):
            c.number(at + ".miss.drive", item["miss"]["drive"], low=0)
            c.number(at + ".miss.area", item["miss"]["area"], low=0)


def _path(c, rule):
    design = rule["design"]
    if c.obj("design", design, ("name", "lib", "flow", "corner", "fail", "wns")):
        for field in ("name", "lib", "flow", "corner"):
            c.text("design." + field, design[field], 120)
        c.integer("design.fail", design["fail"])
        c.number("design.wns", design["wns"])
    if not c.array("paths", rule["paths"], 1, 50):
        return
    stages = 0
    for index, path in enumerate(rule["paths"]):
        at = "paths[%d]" % index
        if not c.obj(at, path, ("slack", "start", "end", "total", "gain", "rows")):
            continue
        for field in ("slack", "total", "gain"):
            c.number("%s.%s" % (at, field), path[field])
        c.text(at + ".start", path["start"], 200)
        c.text(at + ".end", path["end"], 200)
        if not c.array(at + ".rows", path["rows"], 1, 100):
            continue
        stages += len(path["rows"])
        for position, row in enumerate(path["rows"]):
            where = "%s.rows[%d]" % (at, position)
            if not c.obj(where, row, ("inst", "cell", "s", "arc", "d", "cls", "op", "nfast", "best", "eq", "focus")):
                continue
            c.text(where + ".inst", row["inst"], 200)
            c.text(where + ".cell", row["cell"], 120)
            c.text(where + ".s", row["s"], 60)
            c.text(where + ".arc", row["arc"], 60)
            c.text(where + ".cls", row["cls"], 60)
            c.text(where + ".focus", row["focus"], 400)
            c.number(where + ".d", row["d"])
            c.number(where + ".best", row["best"])
            c.integer(where + ".nfast", row["nfast"])
            op = row["op"]
            if c.obj(where + ".op", op, ("slew", "load", "from")):
                c.number(where + ".op.slew", op["slew"], low=0)
                c.number(where + ".op.load", op["load"], low=0)
                if op["from"] not in OP_FROM:
                    c.bad(where + ".op.from", "must be report or fo4 (4x the cell's own input capacitance), not %s" % (
                        _show(op["from"]),))
            if not c.array(where + ".eq", row["eq"], 1, 200):
                continue
            names = []
            for number, eq in enumerate(row["eq"]):
                there = "%s.eq[%d]" % (where, number)
                if c.obj(there, eq, ("name", "s", "vt", "d", "a", "l")):
                    names.append(eq["name"])
                    c.text(there + ".name", eq["name"], 120)
                    c.text(there + ".s", eq["s"], 60)
                    c.text(there + ".vt", eq["vt"], 20)
                    c.number(there + ".d", eq["d"])
                    c.number(there + ".a", eq["a"], low=0)
                    c.number(there + ".l", eq["l"], null=True)
            if isinstance(row["cell"], str) and row["cell"] not in names:
                c.bad(where + ".eq", "must include the cell in use %s" % row["cell"])
    if stages > MAX_STAGES:
        c.bad("paths", "hold %d stages in all; a rule shows at most %d" % (stages, MAX_STAGES))


def _spike(c, rule):
    for field in ("by_variant", "by_kind", "by_family"):
        c.pairs(field, rule[field], 0, 40, 60, 0, numbers="count")
    for index, item in enumerate(rule["items"] if isinstance(rule["items"], list) else []):
        at = "items[%d]" % index
        if not c.obj(at, item, ("name", "v", "ratio", "corner", "corners", "kind", "arc", "when", "pos", "label_pos",
                                "xname", "axes", "vals", "res", "tol", "slice", "observed", "expected", "tolx",
                                "verdict")):
            continue
        c.text(at + ".name", item["name"], 120)
        for field, high in (("v", 60), ("corner", 80), ("corners", 120), ("kind", 60), ("arc", 60),
                            ("label_pos", 80), ("xname", 60), ("verdict", 200)):
            c.text("%s.%s" % (at, field), item[field], high)
        c.text(at + ".when", item["when"], 200, low=0)
        for field in ("ratio", "tol", "observed", "expected", "tolx"):
            c.number("%s.%s" % (at, field), item[field])
        axes = item["axes"]
        shape = None
        if isinstance(axes, list) and len(axes) == 2:
            if c.numbers(at + ".axes[0]", axes[0], 2, 16) and c.numbers(at + ".axes[1]", axes[1], 2, 16):
                shape = (len(axes[0]), len(axes[1]))
        else:
            c.bad(at + ".axes", "must be [slew ps list, load fF list]")
        if shape:
            for field, null in (("vals", False), ("res", True)):
                grid = item[field]
                if not isinstance(grid, list) or len(grid) != shape[0]:
                    c.bad("%s.%s" % (at, field), "must hold one row per slew (%d)" % shape[0])
                    continue
                for row, values in enumerate(grid):
                    c.numbers("%s.%s[%d]" % (at, field, row), values, shape[1], shape[1], null=null)
            pos = item["pos"]
            if (not isinstance(pos, list) or len(pos) != 2 or not all(
                    isinstance(p, int) and not isinstance(p, bool) for p in pos)
                    or not (0 <= pos[0] < shape[0] and 0 <= pos[1] < shape[1])):
                c.bad(at + ".pos", "must be [i, j] inside the %dx%d table" % shape)
        cut = item["slice"]
        if c.obj(at + ".slice", cut, ("x", "y", "k", "at", "others")):
            if c.numbers(at + ".slice.x", cut["x"], 2, 16):
                if any(isinstance(v, (int, float)) and v <= 0 for v in cut["x"]):
                    c.bad(at + ".slice.x", "values must be above 0 (they are drawn on a log axis)")
                length = len(cut["x"])
                c.numbers(at + ".slice.y", cut["y"], 2, 16, length=length)
                if c.integer(at + ".slice.k", cut["k"]) and cut["k"] >= length:
                    c.bad(at + ".slice.k", "must index a point of the slice (0 to %d)" % (length - 1))
                if c.array(at + ".slice.others", cut["others"], 0, 12):
                    for number, other in enumerate(cut["others"]):
                        there = "%s.slice.others[%d]" % (at, number)
                        if c.obj(there, other, ("label", "y")):
                            c.text(there + ".label", other["label"], 60)
                            c.numbers(there + ".y", other["y"], 2, 16, length=length)
            c.text(at + ".slice.at", cut["at"], 80)


def check_rule(rule):
    """Plain problem sentences for every way `rule` breaks knowledge/insight-rule-shape.md."""
    c = _Check()
    if not isinstance(rule, dict):
        return ["the insight rule must be one JSON object"]
    kind = rule.get("kind")
    if kind not in KINDS:
        return ["kind must be one of %s, not %s" % (", ".join(KINDS), _show(kind))]
    wanted = set(COMMON) | set(KIND_FIELDS[kind])
    keys = set(rule)
    if not wanted <= keys or keys - wanted - set(OPTIONAL):
        return ["fields: missing %s; unexpected %s; a %s rule has %s (optional: hint)" % (
            sorted(wanted - keys), sorted(keys - wanted - set(OPTIONAL)), kind, ", ".join(COMMON + KIND_FIELDS[kind]))]
    _non_finite(rule, "rule", c.out)
    if not isinstance(rule["id"], str) or not ID.match(rule["id"]):
        c.bad("id", "%s must match ^[a-z][a-z0-9_]{2,47}$ (for example vmin_bottleneck)" % _show(rule["id"]))
    for field, high in (("title", 80), ("summary", 200), ("result", 120), ("rule", 400), ("library", 160)):
        c.text(field, rule[field], high)
    if "hint" in rule:
        c.text("hint", rule["hint"], 300)
    c.pairs("facts", rule["facts"], 0, 12, 60, 80, numbers=True)
    score = rule["score"]
    if not isinstance(score, dict) or set(score) != {"dimension", "affected", "checked", "weight"}:
        c.bad("score", "must be exactly {dimension, affected, checked, weight}")
    else:
        if score["dimension"] not in DIMENSIONS:
            c.bad("score.dimension", "must be one of %s, not %s" % (", ".join(DIMENSIONS), _show(score["dimension"])))
        counts = c.integer("score.affected", score["affected"]) & c.integer("score.checked", score["checked"])
        if counts and score["affected"] > score["checked"]:
            c.bad("score.affected", "(%d) must not exceed score.checked (%d)" % (score["affected"], score["checked"]))
        c.number("score.weight", score["weight"], low=0, high=30)
    c.pairs("impact", rule["impact"], 1, 5, 40, 300)
    if c.array("todo", rule["todo"], 1, 5):
        for index, step in enumerate(rule["todo"]):
            at = "todo[%d]" % index
            if c.obj(at, step, ("who", "text")):
                if step["who"] not in WHO:
                    c.bad(at + ".who", "must be one of %s, not %s" % (", ".join(WHO), _show(step["who"])))
                c.text(at + ".text", step["text"], 300)
    items = rule["items"]
    if c.array("items", items, 0, MAX_ITEMS):
        for index, item in enumerate(items):
            at = "items[%d]" % index
            if c.obj(at, item, ("label", "focus")):
                c.text(at + ".label", item["label"], 60)
                c.text(at + ".focus", item["focus"], 400)
    for field in KIND_FIELDS[kind]:
        if rule[field] is None:
            c.bad(field, "is required for a %s rule" % kind)
    if not any(rule[field] is None for field in KIND_FIELDS[kind]):
        {"vmin": _vmin, "gaps": _gaps, "path": _path, "spike": _spike}[kind](c, rule)
    found = list(dict.fromkeys(c.out))
    if len(found) > MAX_PROBLEMS:
        found = found[:MAX_PROBLEMS] + ["further problems omitted (%d in all)" % len(found)]
    return found


def _js_numbers(value):
    """Whole floats as integers, so the JSON reads as the Host's JSON.stringify writes it (7.0 -> 7)."""
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e21:
        return int(value)
    if isinstance(value, dict):
        return dict((key, _js_numbers(item)) for key, item in value.items())
    if isinstance(value, list):
        return [_js_numbers(item) for item in value]
    return value


def _data_json(rules, selected):
    text = json.dumps({"rules": _js_numbers(rules), "selected": selected}, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":"))
    for char in ("<", ">", "&", " ", " "):
        text = text.replace(char, "\\u%04x" % ord(char))
    return text


def build_page(template_text, rules, selected=0):
    """The template with `rules` in its data element. Refuses a bad template or any bad rule."""
    if template_text.count(MARKER) != 1:
        raise ValueError("the insight page template must hold exactly one %s marker" % MARKER)
    if len(SCRIPT.findall(template_text)) != 1:
        raise ValueError("the insight page template must hold exactly one executable <script>")
    if not isinstance(rules, list) or not rules:
        raise ValueError("an insight page needs at least one rule")
    problems = []
    ids = set()
    for index, rule in enumerate(rules):
        problems.extend("rule %d: %s" % (index, line) for line in check_rule(rule))
        if isinstance(rule, dict):
            if rule.get("id") in ids:
                problems.append("rule %d: id %s repeats an earlier rule" % (index, rule.get("id")))
            ids.add(rule.get("id"))
    if isinstance(selected, bool) or not isinstance(selected, int) or not 0 <= selected < len(rules):
        problems.append("selected must index one of the %d rules, not %s" % (len(rules), _show(selected)))
    if problems:
        raise ValueError("; ".join(problems))
    head, tail = template_text.split(MARKER)
    return head + _data_json(rules, selected) + tail


def template_script_sha256(template_text):
    """`sha256-<base64>` of the template's one bare <script>, the CSP source that allows it."""
    scripts = SCRIPT.findall(template_text)
    if len(scripts) != 1:
        raise ValueError("the insight page template must hold exactly one executable <script>")
    digest = hashlib.sha256(scripts[0].encode("utf-8")).digest()
    return "sha256-" + base64.b64encode(digest).decode("ascii")


def _rule_of(path):
    from . import common
    doc = common.read_json_file(path, "insight rule")
    if isinstance(doc, dict) and doc.get("schema") == common.ANALYSIS_SCHEMA:
        if "insight" not in doc:
            raise ValueError("%s is a delivery without an insight block" % path)
        return doc["insight"]
    return doc


def main(argv):
    """build-page OUT.html RULE.json... [--selected N]; a delivery file is read for its insight block."""
    args = list(argv)
    if args and args[0] == "build-page":
        args = args[1:]
    selected = 0
    if "--selected" in args:
        at = args.index("--selected")
        try:
            selected = int(args[at + 1])
        except (IndexError, ValueError):
            sys.stderr.write("usage: build-page OUT.html RULE.json... [--selected N]\n")
            return 2
        del args[at:at + 2]
    if len(args) < 2:
        sys.stderr.write("usage: build-page OUT.html RULE.json... [--selected N]\n")
        return 2
    out, sources = args[0], args[1:]
    try:
        with open(TEMPLATE, encoding="utf-8") as stream:
            template = stream.read()
        rules = [_rule_of(os.path.abspath(path)) for path in sources]
        html = build_page(template, rules, selected)
    except Exception as error:  # every refusal goes back as one line
        sys.stderr.write("%s\n" % getattr(error, "detail", error))
        return 1
    parent = os.path.dirname(os.path.abspath(out))
    if not os.path.isdir(parent):
        os.makedirs(parent)
    temporary = os.path.abspath(out) + ".tmp"
    with open(temporary, "w", encoding="utf-8") as stream:
        stream.write(html)
    os.replace(temporary, os.path.abspath(out))
    print(json.dumps({"page": os.path.abspath(out), "rules": len(rules), "selected": selected,
                      "scriptSha256": template_script_sha256(template)}, sort_keys=True))
    return 0
