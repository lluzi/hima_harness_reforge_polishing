"""
Real Liberty support: parse a standard-cell library's `function` attributes into
AIG builders, so the unmapper works on a REAL production netlist instead of a toy
library. Nothing here is specific to one library family, one track flavour or one
threshold-voltage flavour: the naming conventions those impose are DATA, read at
run time from the site-bound technology profile, never written into this package.

Input is a *skeleton* extracted from a (multi-GB CCS) .lib with:
    grep -E '^cell \\(|^  area :|^  pin\\(|^    direction :|^    function :|^  ff |^  latch '

Liberty function grammar (Synopsys), precedence low->high:
    OR   : '+' or '|'
    XOR  : '^'
    AND  : space (adjacency) or '*' or '&'
    NOT  : prefix '!'  or postfix "'"
    prim : identifier | 0 | 1 | ( expr )
"""
import re

# ---- skeleton parser -----------------------------------------------------

_CELL_RE = re.compile(r'^\s*cell\s*\(\s*"?(?P<name>[^)"]+)"?\s*\)')
_AREA_RE = re.compile(r"^\s*area :\s*([0-9.]+)")
_PIN_RE = re.compile(r'^\s*pin\s*\(\s*"?(?P<pin>[^)"]+)"?\s*\)')
_DIR_RE = re.compile(r'^\s*direction :\s*"?(?P<dir>\w+)"?')
_FUNC_RE = re.compile(r'^\s*function :\s*"(?P<f>.*)"')


class LibCell:
    __slots__ = ("name", "area", "inputs", "outputs", "is_seq")

    def __init__(self, name):
        self.name = name
        self.area = 0.0
        self.inputs = []            # ordered input pin names
        self.outputs = {}           # out pin -> AST
        self.is_seq = False


def parse_skeleton(path):
    if isinstance(path, (list, tuple)):
        cells = {}
        for item in path:
            cells.update(parse_skeleton(item))
        return cells
    cells = {}
    cur = None
    cur_pin = None
    cur_dir = None
    with open(path) as fh:
        for line in fh:
            m = _CELL_RE.match(line)
            if m:
                cur = LibCell(m.group("name"))
                cells[cur.name] = cur
                cur_pin = cur_dir = None
                continue
            if cur is None:
                continue
            if re.match(r"^\s*(?:ff|latch)\s*\(", line):
                cur.is_seq = True
                continue
            m = _AREA_RE.match(line)
            if m:
                cur.area = float(m.group(1))
                continue
            m = _PIN_RE.match(line)
            if m:
                cur_pin = m.group("pin")
                cur_dir = None
                continue
            m = _DIR_RE.match(line)
            if m and cur_pin is not None:
                cur_dir = m.group("dir")
                if cur_dir == "input":
                    cur.inputs.append(cur_pin)
                continue
            m = _FUNC_RE.match(line)
            if m and cur_pin is not None and cur_dir == "output":
                try:
                    cur.outputs[cur_pin] = parse_function(m.group("f"))
                except Exception:
                    cur.outputs[cur_pin] = None
                continue
    return cells


# ---- function expression -> AST -----------------------------------------

_TOK_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|[()!'^+|*&]|[01]")


def _tokenize(s):
    return _TOK_RE.findall(s)


class _P:
    def __init__(self, toks):
        self.t = toks
        self.i = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else None

    def next(self):
        tok = self.t[self.i]
        self.i += 1
        return tok

    def parse(self):
        ast = self._or()
        return ast

    def _or(self):
        a = self._xor()
        while self.peek() in ("+", "|"):
            self.next()
            a = ("or", a, self._xor())
        return a

    def _xor(self):
        a = self._and()
        while self.peek() == "^":
            self.next()
            a = ("xor", a, self._and())
        return a

    def _and(self):
        a = self._not()
        while True:
            p = self.peek()
            if p in ("*", "&"):
                self.next()
                a = ("and", a, self._not())
            elif p is not None and (p == "(" or p == "!" or re.match(r"[A-Za-z_01]", p)):
                # adjacency = implicit AND
                a = ("and", a, self._not())
            else:
                break
        return a

    def _not(self):
        if self.peek() == "!":
            self.next()
            return ("not", self._not())
        return self._postfix()

    def _postfix(self):
        a = self._prim()
        while self.peek() == "'":
            self.next()
            a = ("not", a)
        return a

    def _prim(self):
        p = self.next()
        if p == "(":
            a = self._or()
            if self.peek() == ")":
                self.next()
            return a
        if p in ("0", "1"):
            return ("const", int(p))
        return ("var", p)


def parse_function(expr):
    return _P(_tokenize(expr)).parse()


# ---- AST -> AIG literal --------------------------------------------------

def build_ast(ast, aig, env):
    """env: pin-name -> AIG literal. Returns the AIG literal for `ast`."""
    op = ast[0]
    if op == "var":
        return env[ast[1]]
    if op == "const":
        return 1 if ast[1] else 0
    if op == "not":
        return build_ast(ast[1], aig, env) ^ 1
    a = build_ast(ast[1], aig, env)
    b = build_ast(ast[2], aig, env)
    if op == "and":
        return aig.mk_and(a, b)
    if op == "or":
        return aig.mk_or(a, b)
    if op == "xor":
        return aig.mk_xor(a, b)
    raise ValueError("bad ast op %s" % op)


# ---- core-name mapping (strip the threshold-voltage suffix) --------------
#
# THE SUFFIX SET IS FOUNDRY DATA AND IS NOT WRITTEN HERE. A library's flavour
# suffixes, and which flavour an unsuffixed master means, are part of that
# library's naming convention; carrying them would carry the convention. Both
# functions therefore take the ordered suffix tuple from the caller, which reads
# it from the site-bound technology profile (`vt_suffixes`, `vt_default`).
#
# ORDER MATTERS AND IS THE CALLER'S RESPONSIBILITY: a longer suffix that ends
# with a shorter one must come first, or the shorter one strips a prefix of it
# and the base name is wrong. The profile's list is used exactly as given, so a
# mis-ordered profile is a visible site error rather than a silent mis-mapping.


def base_name(cell_type, vt_suffixes):
    """Strip a trailing threshold-voltage suffix, leaving the base master name.

    `vt_suffixes` is an ordered sequence, longest-first within a family. An empty
    sequence means the library has no flavour suffixes, and the name is returned
    unchanged - which is correct, not a fallback.
    """
    for suf in vt_suffixes:
        if suf and cell_type.endswith(suf):
            return cell_type[: -len(suf)]
    return cell_type


def vt_of(cell_type, vt_suffixes, vt_default=None):
    """The flavour a master name declares, or `vt_default` when it declares none.

    `vt_default` is the flavour an unsuffixed master means IN THIS LIBRARY. It is
    a naming-convention fact and therefore a site input; None is returned when the
    site did not state it, so an unstated convention cannot be mistaken for a
    stated one.
    """
    for suf in vt_suffixes:
        if suf and cell_type.endswith(suf):
            return suf
    return vt_default
