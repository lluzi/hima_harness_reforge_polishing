"""Liberty timing data for the license-free mapping proxy.

The existing miner still uses :func:`parse_relative_delay_model` to rank cells
in dimensionless delay units. The strict API added here serves the richer
proxy-STA path: it preserves pin-to-pin arcs, NLDM axes and tables, evaluates
them at a requested input slew/output load, and refuses to invent data when a
Library is incomplete or ambiguous.

This is deliberately a Liberty/arc module. Netlist traversal remains owned by
the mapped-netlist graph code; callers can use :func:`propagate_reg2reg_path`
as the deterministic path primitive while that graph supplies ordered stages.
All values stay in the units declared by the Library.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
import re
import statistics


CELL_RE = re.compile(r"^\s*cell\s*\(\s*\"?([^\")]+)\"?\s*\)\s*\{")
TABLE_RE = re.compile(r"\bcell_(?:rise|fall)\s*\([^)]*\)\s*\{")
NUMBER_RE = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")

_TABLE_NAMES = ("cell_rise", "cell_fall", "rise_transition", "fall_transition")
_SENSES = {"positive_unate", "negative_unate", "non_unate"}
_SLEW_VARIABLES = {"input_net_transition", "related_pin_transition"}
_LOAD_VARIABLES = {"total_output_net_capacitance", "output_net_capacitance"}


class LibertyTimingError(ValueError):
    """The requested proxy timing value cannot be established from evidence."""


@dataclass(frozen=True)
class InterpolationResult:
    value: float
    requested_slew: float
    requested_load: float
    used_slew: float
    used_load: float
    clamped_slew: str | None
    clamped_load: str | None

    @property
    def clamped(self):
        return self.clamped_slew is not None or self.clamped_load is not None

    def as_dict(self):
        return {
            "value": self.value,
            "requested_slew": self.requested_slew,
            "requested_load": self.requested_load,
            "used_slew": self.used_slew,
            "used_load": self.used_load,
            "clamped_slew": self.clamped_slew,
            "clamped_load": self.clamped_load,
            "interpolation": "bounded_bilinear",
            "extrapolated": False,
        }


@dataclass(frozen=True)
class NldmTable:
    name: str
    variable_1: str
    variable_2: str
    index_1: tuple[float, ...]
    index_2: tuple[float, ...]
    values: tuple[tuple[float, ...], ...]

    def interpolate(self, input_slew, output_load):
        coordinates = {"slew": float(input_slew), "load": float(output_load)}
        if any(not math.isfinite(value) or value < 0.0 for value in coordinates.values()):
            raise LibertyTimingError("NLDM slew/load coordinates must be finite and non-negative")
        axis_kinds = (_axis_kind(self.variable_1), _axis_kind(self.variable_2))
        if set(axis_kinds) != {"slew", "load"}:
            raise LibertyTimingError(
                "%s has unsupported/ambiguous NLDM variables %r, %r"
                % (self.name, self.variable_1, self.variable_2)
            )
        x_requested = coordinates[axis_kinds[0]]
        y_requested = coordinates[axis_kinds[1]]
        x, x_clamp = _bounded(x_requested, self.index_1)
        y, y_clamp = _bounded(y_requested, self.index_2)
        value = _bilinear(self.index_1, self.index_2, self.values, x, y)
        clamps = {axis_kinds[0]: x_clamp, axis_kinds[1]: y_clamp}
        used = {axis_kinds[0]: x, axis_kinds[1]: y}
        return InterpolationResult(
            value=value,
            requested_slew=float(input_slew),
            requested_load=float(output_load),
            used_slew=used["slew"],
            used_load=used["load"],
            clamped_slew=clamps["slew"],
            clamped_load=clamps["load"],
        )


@dataclass(frozen=True)
class TimingArc:
    related_pin: str
    to_pin: str
    timing_sense: str
    timing_sense_source: str
    condition: str | None
    tables: dict[str, NldmTable]


@dataclass(frozen=True)
class TimingCell:
    name: str
    pin_directions: dict[str, str]
    pin_capacitance: dict[str, float]
    arcs: tuple[TimingArc, ...]
    sequential: bool
    sequential_kind: str | None
    data_pin: str | None
    clock_pin: str | None
    clock_polarity: str | None
    sequential_outputs: tuple[str, ...]


@dataclass(frozen=True)
class LibertyTimingModel:
    cells: dict[str, TimingCell]
    liberty_sha256: str
    time_unit: str | None
    capacitive_load_unit: str | None

    def cell(self, name):
        try:
            return self.cells[name]
        except KeyError as exc:
            raise LibertyTimingError("Library has no timing data for cell %s" % name) from exc

    def arc(self, cell_name, related_pin, to_pin):
        matches = self.arcs(cell_name, related_pin, to_pin)
        if len(matches) != 1:
            raise LibertyTimingError(
                "Library timing arc %s:%s->%s is ambiguous (%d matches)"
                % (cell_name, related_pin, to_pin, len(matches))
            )
        return matches[0]

    def arcs(self, cell_name, related_pin, to_pin):
        cell = self.cell(cell_name)
        matches = [
            arc for arc in cell.arcs
            if arc.related_pin == related_pin and arc.to_pin == to_pin
        ]
        if not matches:
            raise LibertyTimingError(
                "Library has no timing arc %s:%s->%s"
                % (cell_name, related_pin, to_pin)
            )
        return tuple(matches)

    def input_capacitance(self, cell_name, pin):
        cell = self.cell(cell_name)
        if pin not in cell.pin_capacitance:
            raise LibertyTimingError(
                "Library has no input capacitance for %s:%s" % (cell_name, pin)
            )
        return cell.pin_capacitance[pin]


@dataclass(frozen=True)
class ArcEvaluation:
    cell: str
    related_pin: str
    to_pin: str
    timing_sense: str
    timing_sense_source: str
    input_transition: str
    output_transition: str
    condition: str | None
    conditional_policy: str | None
    alternative_conditions: tuple[str | None, ...]
    delay: InterpolationResult
    output_slew: InterpolationResult

    def as_dict(self):
        result = {
            "cell": self.cell,
            "related_pin": self.related_pin,
            "to_pin": self.to_pin,
            "timing_sense": self.timing_sense,
            "timing_sense_source": self.timing_sense_source,
            "input_transition": self.input_transition,
            "output_transition": self.output_transition,
            "delay": self.delay.as_dict(),
            "output_slew": self.output_slew.as_dict(),
        }
        if self.conditional_policy is not None:
            result.update({
                "condition": self.condition,
                "conditional_policy": self.conditional_policy,
                "alternative_conditions": list(self.alternative_conditions),
            })
        return result


@dataclass
class _Node:
    kind: str
    args: tuple[str, ...]
    attrs: dict[str, list[tuple[str, ...]]]
    children: list["_Node"]


def _tokens(text):
    token_re = re.compile(
        r'/\*.*?\*/|//[^\n]*|"(?:\\.|[^"\\])*"|[(){}:;,]|[^\s(){}:;,]+',
        re.DOTALL,
    )
    for match in token_re.finditer(text):
        value = match.group(0)
        if value.startswith("/*") or value.startswith("//"):
            continue
        if value.startswith('"'):
            value = value[1:-1].replace('\\"', '"').replace('\\\\', '\\')
        yield value


class _TokenStream:
    def __init__(self, tokens):
        self._tokens = iter(tokens)
        self._buffered = False
        self._value = None

    def peek(self):
        if not self._buffered:
            try:
                self._value = next(self._tokens)
            except StopIteration:
                self._value = None
            self._buffered = True
        return self._value

    def pop(self):
        value = self.peek()
        self._buffered = False
        self._value = None
        return value


def _split_args(tokens):
    args = []
    current = []
    depth = 0
    for token in tokens:
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
        if token == "," and depth == 0:
            args.append("".join(current).strip())
            current = []
        else:
            current.append(token)
    if current or tokens:
        args.append("".join(current).strip())
    return tuple(args)


def _parse_nodes(tokens, required_cells=None):
    stream = _TokenStream(tokens)
    required = None if required_cells is None else set(required_cells)

    def skip_group():
        """Skip one already-opened group without materializing its contents."""
        depth = 1
        while stream.peek() is not None and depth:
            token = stream.pop()
            if token == "{":
                depth += 1
            elif token == "}":
                depth -= 1
        if depth:
            raise LibertyTimingError("unterminated skipped Liberty group")

    def sequence(stop=None):
        nodes = []
        attrs = {}
        while stream.peek() is not None and stream.peek() != stop:
            name = stream.pop()
            if stream.peek() is None:
                break
            if stream.peek() == ":":
                stream.pop()
                value = []
                while stream.peek() is not None and stream.peek() != ";":
                    value.append(stream.pop())
                if stream.peek() is None:
                    raise LibertyTimingError("unterminated Liberty attribute %s" % name)
                stream.pop()
                attrs.setdefault(name, []).append(tuple(value))
                continue
            if stream.peek() != "(":
                while stream.peek() is not None and stream.peek() not in (";", stop):
                    stream.pop()
                if stream.peek() == ";":
                    stream.pop()
                continue
            stream.pop()
            arguments = []
            depth = 1
            while stream.peek() is not None and depth:
                token = stream.pop()
                if token == "(":
                    depth += 1
                elif token == ")":
                    depth -= 1
                    if depth == 0:
                        break
                arguments.append(token)
            if depth:
                raise LibertyTimingError("unterminated Liberty arguments for %s" % name)
            args = _split_args(arguments)
            if stream.peek() == "{":
                stream.pop()
                if (name == "cell" and required is not None
                        and (len(args) != 1 or args[0] not in required)):
                    skip_group()
                    continue
                child_nodes, child_attrs = sequence("}")
                if stream.peek() != "}":
                    raise LibertyTimingError("unterminated Liberty group %s" % name)
                stream.pop()
                nodes.append(_Node(name, args, child_attrs, child_nodes))
            else:
                # Liberty complex attributes legally occur both with and
                # without a trailing semicolon (for example fanout_length()).
                # A following ``{`` was handled above, so this cannot turn a
                # group into an attribute.
                if stream.peek() == ";":
                    stream.pop()
                attrs.setdefault(name, []).append(args)
        return nodes, attrs

    nodes, attrs = sequence()
    if stream.peek() is not None:
        raise LibertyTimingError("unexpected unmatched Liberty group terminator")
    return _Node("__root__", (), attrs, nodes)


def _one_attr(node, name, required=False):
    values = node.attrs.get(name, [])
    if len(values) > 1:
        raise LibertyTimingError("%s has ambiguous %s attributes" % (node.kind, name))
    if not values:
        if required:
            raise LibertyTimingError("%s is missing %s" % (node.kind, name))
        return None
    return "".join(values[0]).strip()


def _numbers(value, label):
    values = tuple(float(number) for number in NUMBER_RE.findall(value or ""))
    if not values or not all(math.isfinite(item) for item in values):
        raise LibertyTimingError("%s has no finite numeric values" % label)
    return values


def _strict_axis(values, label):
    if any(second <= first for first, second in zip(values, values[1:])):
        raise LibertyTimingError("%s must be strictly increasing" % label)


def _template_map(library):
    result = {}
    for node in library.children:
        if node.kind not in ("lu_table_template", "power_lut_template"):
            continue
        if len(node.args) != 1 or not node.args[0]:
            raise LibertyTimingError("Liberty table template has no unique name")
        name = node.args[0]
        if name in result:
            raise LibertyTimingError("duplicate Liberty table template %s" % name)
        variable_1 = _one_attr(node, "variable_1", required=True)
        variable_2 = _one_attr(node, "variable_2")
        index_1 = _numbers(_one_attr(node, "index_1", required=True), name + ".index_1")
        raw_index_2 = _one_attr(node, "index_2")
        index_2 = _numbers(raw_index_2, name + ".index_2") if raw_index_2 else ()
        _strict_axis(index_1, name + ".index_1")
        if index_2:
            _strict_axis(index_2, name + ".index_2")
        if (variable_2 is None) != (not index_2):
            raise LibertyTimingError(
                "%s must declare variable_2 and index_2 together" % name
            )
        result[name] = (variable_1, variable_2, index_1, index_2)
    return result


def _parse_table(node, templates, context):
    template_name = node.args[0] if node.args else None
    template = templates.get(template_name) if template_name else None
    if template_name and template is None:
        raise LibertyTimingError("%s references unknown template %s" % (context, template_name))
    variable_1 = _one_attr(node, "variable_1") or (template[0] if template else None)
    variable_2 = _one_attr(node, "variable_2") or (template[1] if template else None)
    if not variable_1 or not variable_2:
        raise LibertyTimingError("%s has no two-dimensional variable declaration" % context)
    local_1 = _one_attr(node, "index_1")
    local_2 = _one_attr(node, "index_2")
    index_1 = _numbers(local_1, context + ".index_1") if local_1 else (template[2] if template else ())
    index_2 = _numbers(local_2, context + ".index_2") if local_2 else (template[3] if template else ())
    if not index_1 or not index_2:
        raise LibertyTimingError("%s has no complete NLDM axes" % context)
    _strict_axis(index_1, context + ".index_1")
    _strict_axis(index_2, context + ".index_2")
    rows = node.attrs.get("values", [])
    if len(rows) != 1:
        raise LibertyTimingError("%s must contain exactly one values() attribute" % context)
    row_values = tuple(_numbers(row, context + ".values") for row in rows[0])
    if len(row_values) != len(index_1):
        raise LibertyTimingError(
            "%s has %d rows for %d index_1 points"
            % (context, len(row_values), len(index_1))
        )
    if any(len(row) != len(index_2) for row in row_values):
        raise LibertyTimingError(
            "%s row width does not match %d index_2 points" % (context, len(index_2))
        )
    return NldmTable(
        node.kind, variable_1, variable_2, tuple(index_1), tuple(index_2), row_values
    )


def _sequential_pin(expression, label):
    """Read one pin and its polarity from a simple ff/latch expression."""
    compact = re.sub(r"\s+", "", expression or "")
    match = re.fullmatch(r"(!)?\(?([A-Za-z_][A-Za-z0-9_$]*)\)?(')?", compact)
    if not match:
        raise LibertyTimingError(
            "%s must identify exactly one pin; complex sequential expressions are unsupported"
            % label
        )
    inverted = bool(match.group(1) or match.group(3))
    return match.group(2), ("negative" if inverted else "positive")


_BOOLEAN_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|[()!'^+|*&]|[01]")


def _boolean_variables(ast):
    operation = ast[0]
    if operation == "var":
        return {ast[1]}
    if operation == "const":
        return set()
    if operation == "not":
        return _boolean_variables(ast[1])
    if operation in ("and", "or", "xor"):
        return _boolean_variables(ast[1]) | _boolean_variables(ast[2])
    raise LibertyTimingError("unsupported Boolean AST operation %r" % operation)


def _derived_timing_sense(expression, related_pin, input_pins, context):
    """Derive exact unateness by exhaustive cofactors of the output function."""
    if expression is None:
        raise LibertyTimingError(
            "%s has no timing_sense and output function is absent" % context
        )
    tokens = _BOOLEAN_TOKEN_RE.findall(expression)
    if not tokens or "".join(tokens) != re.sub(r"\s+", "", expression):
        raise LibertyTimingError(
            "%s has unsupported output function syntax %r" % (context, expression)
        )
    depth = 0
    for token in tokens:
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
            if depth < 0:
                break
    if depth != 0:
        raise LibertyTimingError(
            "%s has unbalanced output function %r" % (context, expression)
        )
    try:
        try:
            from .liberty import parse_function
            from .generator_contract import timing_sense, truth_table
        except ImportError:
            from liberty import parse_function
            from generator_contract import timing_sense, truth_table
        ast = parse_function(expression)
        variables = _boolean_variables(ast)
    except (IndexError, KeyError, TypeError, ValueError) as exc:
        raise LibertyTimingError(
            "%s output function cannot be evaluated exactly: %s" % (context, exc)
        ) from exc
    unknown = sorted(variables - set(input_pins))
    if unknown:
        raise LibertyTimingError(
            "%s output function references non-input pins %s"
            % (context, ", ".join(unknown))
        )
    if related_pin not in variables:
        raise LibertyTimingError(
            "%s output function is independent of related pin %s"
            % (context, related_pin)
        )
    input_order = sorted(variables)
    if len(input_order) > 12:
        raise LibertyTimingError(
            "%s output function has %d inputs; exhaustive derivation is bounded at 12"
            % (context, len(input_order))
        )
    table = truth_table(ast, input_order)
    sense = timing_sense(table, len(input_order), input_order.index(related_pin))
    if sense not in _SENSES:
        raise LibertyTimingError(
            "%s output function is independent of related pin %s"
            % (context, related_pin)
        )
    return sense


def derive_timing_sense(expression, related_pin, input_pins):
    """Derive one Liberty timing sense exactly from an output function string."""
    return _derived_timing_sense(
        expression, related_pin, input_pins, "output function"
    )


def _sequential_descriptor(cell_node, pin_directions, pin_functions, name):
    groups = [
        child for child in cell_node.children
        if child.kind in ("ff", "ff_bank", "latch", "latch_bank")
    ]
    if not groups:
        return None, None, None, None, ()
    if len(groups) != 1:
        raise LibertyTimingError("%s has ambiguous sequential groups" % name)
    group = groups[0]
    kind = "ff" if group.kind.startswith("ff") else "latch"
    data_attribute = "next_state" if kind == "ff" else "data_in"
    clock_attribute = "clocked_on" if kind == "ff" else "enable"
    data_pin, _data_polarity = _sequential_pin(
        _one_attr(group, data_attribute, required=True),
        "%s.%s" % (name, data_attribute),
    )
    clock_pin, clock_polarity = _sequential_pin(
        _one_attr(group, clock_attribute, required=True),
        "%s.%s" % (name, clock_attribute),
    )
    for pin, role in ((data_pin, "data"), (clock_pin, "clock")):
        if pin_directions.get(pin) != "input":
            raise LibertyTimingError(
                "%s sequential %s pin %s is not a declared input" % (name, role, pin)
            )
    internal_outputs = set(group.args)
    outputs = []
    for pin, direction in pin_directions.items():
        if direction != "output":
            continue
        function = pin_functions.get(pin)
        if function is None:
            continue
        symbol, _polarity = _sequential_pin(function, "%s:%s.function" % (name, pin))
        if symbol in internal_outputs:
            outputs.append(pin)
    if not outputs:
        raise LibertyTimingError(
            "%s has no output pin whose function names ff/latch state %s"
            % (name, sorted(internal_outputs))
        )
    return kind, data_pin, clock_pin, clock_polarity, tuple(sorted(outputs))


def parse_liberty_timing(path, required_cells=None):
    """Parse complete, unconditional combinational NLDM timing evidence."""
    with open(path, "rb") as handle:
        raw = handle.read()
    liberty_sha256 = "sha256:" + hashlib.sha256(raw).hexdigest()
    text = raw.decode("utf-8", errors="replace")
    del raw
    required = set(required_cells) if required_cells is not None else None
    root = _parse_nodes(
        _tokens(text), required_cells=required
    )
    del text
    libraries = [node for node in root.children if node.kind == "library"]
    if len(libraries) != 1:
        raise LibertyTimingError("expected exactly one library() group, found %d" % len(libraries))
    library = libraries[0]
    templates = _template_map(library)
    cells = {}
    for cell_node in library.children:
        if cell_node.kind != "cell":
            continue
        if len(cell_node.args) != 1 or not cell_node.args[0]:
            raise LibertyTimingError("cell group has no unique name")
        name = cell_node.args[0]
        if required is not None and name not in required:
            continue
        if name in cells:
            raise LibertyTimingError("duplicate Liberty cell %s" % name)
        pin_nodes = [child for child in cell_node.children if child.kind == "pin"]
        pin_directions = {}
        pin_functions = {}
        capacitance = {}
        for pin_node in pin_nodes:
            if len(pin_node.args) != 1 or not pin_node.args[0]:
                raise LibertyTimingError("%s has a pin without a unique name" % name)
            pin = pin_node.args[0]
            if pin in pin_directions:
                raise LibertyTimingError("%s has duplicate pin %s" % (name, pin))
            direction = _one_attr(pin_node, "direction", required=True)
            if direction not in ("input", "output"):
                raise LibertyTimingError(
                    "%s:%s has unsupported direction %s" % (name, pin, direction)
                )
            pin_directions[pin] = direction
            function = _one_attr(pin_node, "function")
            if function is not None:
                pin_functions[pin] = function
            if direction == "input":
                value = _one_attr(pin_node, "capacitance", required=True)
                numbers = _numbers(value, "%s:%s.capacitance" % (name, pin))
                if len(numbers) != 1 or numbers[0] < 0.0:
                    raise LibertyTimingError("%s:%s has invalid capacitance" % (name, pin))
                capacitance[pin] = numbers[0]
        (sequential_kind, data_pin, clock_pin, clock_polarity,
         sequential_outputs) = _sequential_descriptor(
            cell_node, pin_directions, pin_functions, name
        )
        sequential = sequential_kind is not None
        arcs = []
        for pin_node in pin_nodes:
            pin = pin_node.args[0]
            direction = pin_directions[pin]
            if direction != "output":
                continue
            for timing in (child for child in pin_node.children if child.kind == "timing"):
                timing_type = _one_attr(timing, "timing_type")
                if timing_type not in (None, "combinational", "combinational_rise", "combinational_fall"):
                    # Sequential clock-to-Q and asynchronous control arcs define
                    # a launch boundary; they are not interior combinational arcs.
                    if sequential:
                        continue
                    raise LibertyTimingError(
                        "%s:%s contains unsupported timing_type %s"
                        % (name, pin, timing_type)
                    )
                condition = _one_attr(timing, "when")
                related = _one_attr(timing, "related_pin", required=True)
                if len(related.split()) != 1:
                    raise LibertyTimingError(
                        "%s:%s has ambiguous related_pin %r" % (name, pin, related)
                    )
                sense = _one_attr(timing, "timing_sense")
                sense_source = "declared"
                if sense is None:
                    sense = _derived_timing_sense(
                        pin_functions.get(pin),
                        related,
                        capacitance,
                        "%s:%s->%s" % (name, related, pin),
                    )
                    sense_source = "derived_from_output_function"
                if sense not in _SENSES:
                    raise LibertyTimingError(
                        "%s:%s->%s has unsupported timing_sense %r"
                        % (name, related, pin, sense)
                    )
                tables = {}
                for table_node in timing.children:
                    if table_node.kind not in _TABLE_NAMES:
                        continue
                    if table_node.kind in tables:
                        raise LibertyTimingError(
                            "%s:%s->%s has duplicate %s"
                            % (name, related, pin, table_node.kind)
                        )
                    tables[table_node.kind] = _parse_table(
                        table_node, templates,
                        "%s:%s->%s.%s" % (name, related, pin, table_node.kind),
                    )
                missing = sorted(set(_TABLE_NAMES) - set(tables))
                if missing:
                    raise LibertyTimingError(
                        "%s:%s->%s is missing %s"
                        % (name, related, pin, ", ".join(missing))
                    )
                arcs.append(TimingArc(
                    related, pin, sense, sense_source, condition, tables
                ))
        identities = [(arc.related_pin, arc.to_pin, arc.condition) for arc in arcs]
        duplicates = sorted(
            {identity for identity in identities if identities.count(identity) > 1},
            key=lambda identity: (identity[0], identity[1], identity[2] or ""),
        )
        if duplicates:
            raise LibertyTimingError("%s has ambiguous timing arcs %r" % (name, duplicates))
        unknown_related = sorted({arc.related_pin for arc in arcs} - set(capacitance))
        if unknown_related:
            raise LibertyTimingError(
                "%s timing arcs reference pins without input capacitance: %s"
                % (name, ", ".join(unknown_related))
            )
        cells[name] = TimingCell(
            name,
            dict(sorted(pin_directions.items())),
            dict(sorted(capacitance.items())),
            tuple(sorted(
                arcs,
                key=lambda arc: (arc.related_pin, arc.to_pin, arc.condition or ""),
            )),
            sequential,
            sequential_kind,
            data_pin,
            clock_pin,
            clock_polarity,
            sequential_outputs,
        )
    if required is not None:
        missing = sorted(required - set(cells))
        if missing:
            raise LibertyTimingError("required Liberty cells are missing: %s" % ", ".join(missing))
    time_unit = _one_attr(library, "time_unit", required=True)
    capacitance_unit = _one_attr(library, "capacitive_load_unit", required=True)
    return LibertyTimingModel(
        dict(sorted(cells.items())),
        liberty_sha256,
        time_unit,
        capacitance_unit,
    )


def _axis_kind(variable):
    if variable in _SLEW_VARIABLES:
        return "slew"
    if variable in _LOAD_VARIABLES:
        return "load"
    return "unsupported:" + str(variable)


def _bounded(value, axis):
    if not math.isfinite(value):
        raise LibertyTimingError("NLDM interpolation coordinate must be finite")
    if value < axis[0]:
        return axis[0], "low"
    if value > axis[-1]:
        return axis[-1], "high"
    return value, None


def _bracket(axis, value):
    if len(axis) == 1:
        return 0, 0, 0.0
    for upper in range(1, len(axis)):
        if value <= axis[upper]:
            lower = upper - 1
            width = axis[upper] - axis[lower]
            return lower, upper, (value - axis[lower]) / width
    return len(axis) - 2, len(axis) - 1, 1.0


def _bilinear(index_1, index_2, values, x, y):
    x0, x1, tx = _bracket(index_1, x)
    y0, y1, ty = _bracket(index_2, y)
    low = values[x0][y0] * (1.0 - ty) + values[x0][y1] * ty
    high = values[x1][y0] * (1.0 - ty) + values[x1][y1] * ty
    return float(low * (1.0 - tx) + high * tx)


def _compatible_output_transitions(sense, input_transition):
    if input_transition not in ("rise", "fall"):
        raise LibertyTimingError("input transition must be 'rise' or 'fall'")
    if sense == "positive_unate":
        return (input_transition,)
    if sense == "negative_unate":
        return ("fall" if input_transition == "rise" else "rise",)
    if sense == "non_unate":
        return ("rise", "fall")
    raise LibertyTimingError("unsupported timing sense %r" % sense)


def evaluate_timing_arc_transitions(model, cell_name, related_pin, to_pin,
                                    input_transition, input_slew, output_load):
    """Evaluate each output transition under a conservative condition policy.

    Conditional arcs are not claimed to be sensitized. For every output
    transition, all condition variants compatible with the input transition
    are evaluated and the largest delay is retained as an upper bound.
    """
    arcs = model.arcs(cell_name, related_pin, to_pin)
    conditional = len(arcs) > 1 or any(arc.condition is not None for arc in arcs)
    raw = []
    for arc in arcs:
        for output_transition in _compatible_output_transitions(
            arc.timing_sense, input_transition
        ):
            delay_name = "cell_rise" if output_transition == "rise" else "cell_fall"
            slew_name = "rise_transition" if output_transition == "rise" else "fall_transition"
            raw.append((
                arc,
                output_transition,
                arc.tables[delay_name].interpolate(input_slew, output_load),
                arc.tables[slew_name].interpolate(input_slew, output_load),
            ))
    evaluations = []
    for output_transition in sorted({item[1] for item in raw}):
        variants = [item for item in raw if item[1] == output_transition]
        selected = max(
            variants,
            key=lambda item: (item[2].value, item[0].condition or ""),
        )
        alternatives = tuple(sorted(
            {item[0].condition for item in variants},
            key=lambda condition: (condition is not None, condition or ""),
        )) if conditional else ()
        arc, _transition, delay, slew = selected
        evaluations.append(ArcEvaluation(
            cell_name, related_pin, to_pin, arc.timing_sense, arc.timing_sense_source,
            input_transition, output_transition,
            arc.condition,
            "worst_case_over_conditions" if conditional else None,
            alternatives,
            delay, slew,
        ))
    return tuple(evaluations)


def evaluate_timing_arc(model, cell_name, related_pin, to_pin, input_transition,
                        input_slew, output_load):
    """Evaluate the worst compatible max-delay transition for one arc."""
    evaluations = evaluate_timing_arc_transitions(
        model, cell_name, related_pin, to_pin,
        input_transition, input_slew, output_load,
    )
    return max(evaluations, key=lambda item: (item.delay.value, item.output_transition))


def pin_load(model, sink_pins, wire_capacitance=0.0):
    """Return summed sink pin capacitance plus an explicit wire estimate."""
    total = float(wire_capacitance)
    if not math.isfinite(total) or total < 0.0:
        raise LibertyTimingError("wire capacitance must be finite and non-negative")
    for cell_name, pin in sink_pins:
        total += model.input_capacitance(cell_name, pin)
    return total


def propagate_reg2reg_path(model, stages, *, initial_transition, initial_slew,
                           required_time, launch_clock, capture_clock,
                           uncertainty=0.0, endpoint_family=None):
    """Propagate one ordered combinational reg-to-reg path.

    The graph owner supplies ``stages`` with ``instance``, ``cell``,
    ``related_pin``, ``to_pin`` and ``output_load``. This primitive supplies
    repeatable NLDM evaluation and refuses clock ambiguity. It intentionally
    does not infer clocks or loads from names.
    """
    if not launch_clock or not capture_clock:
        raise LibertyTimingError("reg2reg propagation requires launch and capture clocks")
    if launch_clock != capture_clock:
        raise LibertyTimingError(
            "multi-clock reg2reg propagation is ambiguous: %s -> %s"
            % (launch_clock, capture_clock)
        )
    required = float(required_time) - float(uncertainty)
    slew = float(initial_slew)
    if not all(math.isfinite(value) for value in (required, slew)):
        raise LibertyTimingError("reg2reg timing inputs must be finite")
    if float(uncertainty) < 0.0 or slew < 0.0:
        raise LibertyTimingError("reg2reg uncertainty and initial slew must be non-negative")
    transition = initial_transition
    arrival = 0.0
    path = []
    for index, stage in enumerate(stages):
        missing = sorted(
            {"instance", "cell", "related_pin", "to_pin", "output_load"} - set(stage)
        )
        if missing:
            raise LibertyTimingError(
                "reg2reg stage %d is missing %s" % (index, ", ".join(missing))
            )
        if model.cell(stage["cell"]).sequential:
            raise LibertyTimingError(
                "sequential cell %s cannot be an interior reg2reg stage" % stage["cell"]
            )
        evaluated = evaluate_timing_arc(
            model, stage["cell"], stage["related_pin"], stage["to_pin"],
            transition, slew, stage["output_load"],
        )
        arrival += evaluated.delay.value
        slew = evaluated.output_slew.value
        transition = evaluated.output_transition
        path.append({
            "instance": stage["instance"],
            "arrival": arrival,
            **evaluated.as_dict(),
        })
    return {
        "scope": "reg2reg",
        "launch_clock": launch_clock,
        "capture_clock": capture_clock,
        "endpoint_family": endpoint_family,
        "arrival": arrival,
        "required": required,
        "slack": required - arrival,
        "output_slew": slew,
        "output_transition": transition,
        "path": path,
    }


def _combinational_order(instances, graph, model):
    combinational = {
        instance.name: instance for instance in instances
        if not model.cell(instance.cell_type).sequential
    }
    predecessors = {name: set() for name in combinational}
    successors = {name: set() for name in combinational}
    for net, driver in graph.drivers.items():
        if driver.instance not in combinational:
            continue
        for sink in graph.sinks.get(net, ()):
            if sink.instance not in combinational:
                continue
            successors[driver.instance].add(sink.instance)
            predecessors[sink.instance].add(driver.instance)
    ready = sorted(name for name, incoming in predecessors.items() if not incoming)
    order = []
    while ready:
        name = ready.pop(0)
        order.append(name)
        for successor in sorted(successors[name]):
            predecessors[successor].remove(name)
            if not predecessors[successor]:
                ready.append(successor)
        ready.sort()
    if len(order) != len(combinational):
        cyclic = sorted(set(combinational) - set(order))
        raise LibertyTimingError(
            "mapped netlist contains a combinational loop involving %s"
            % ", ".join(cyclic)
        )
    return order


def _net_output_load(model, graph, net, wire_capacitance):
    sinks = graph.sinks.get(net, ())
    return pin_load(
        model,
        [(sink.cell_type, sink.pin) for sink in sinks],
        wire_capacitance,
    )


def analyze_mapped_netlist_reg2reg(model, verilog_text, top, *, clock_period,
                                   uncertainty=0.0, initial_slew=0.01,
                                   wire_capacitance=0.0):
    """Run bounded max-delay STA on one flat, named-connection mapped module.

    Launch clock-to-Q and setup time are intentionally outside this proxy's
    current claim: sequential outputs launch at arrival zero with an explicit
    initial slew, and capture required time is ``period - uncertainty``.
    Every interior delay and slew comes from the same strict Liberty model.
    """
    from verilog_netlist import (  # Imported here to keep the Liberty parser standalone.
        VerilogNetlistError,
        build_named_net_graph,
        top_assign_aliases,
        top_instances,
    )

    try:
        instances = top_instances(verilog_text, top)
        graph = build_named_net_graph(
            instances,
            {name: cell.pin_directions for name, cell in model.cells.items()},
            top_assign_aliases(verilog_text, top),
        )
    except VerilogNetlistError as exc:
        raise LibertyTimingError(str(exc)) from exc
    instances = list(graph.instances.values())
    sequential = [
        instance for instance in instances if model.cell(instance.cell_type).sequential
    ]
    if not sequential:
        raise LibertyTimingError("mapped top %s has no sequential boundaries" % top)
    latch_types = sorted({
        instance.cell_type for instance in sequential
        if model.cell(instance.cell_type).sequential_kind == "latch"
    })
    if latch_types:
        raise LibertyTimingError(
            "latch time borrowing is not modeled for %s" % ", ".join(latch_types)
        )
    clock_bindings = []
    for instance in sequential:
        cell = model.cell(instance.cell_type)
        if not cell.clock_pin or cell.clock_pin not in instance.conns:
            raise LibertyTimingError(
                "sequential instance %s has no explicit clock connection" % instance.name
            )
        clock_bindings.append((instance.conns[cell.clock_pin], cell.clock_polarity))
    clock_nets = sorted({binding[0] for binding in clock_bindings})
    if len(clock_nets) != 1:
        raise LibertyTimingError(
            "mapped reg2reg proxy requires one explicit clock net, found %s"
            % clock_nets
        )
    polarities = sorted({binding[1] for binding in clock_bindings})
    if len(polarities) != 1:
        raise LibertyTimingError(
            "mapped reg2reg proxy has mixed clock polarities on %s" % clock_nets[0]
        )
    required = float(clock_period) - float(uncertainty)
    if (not math.isfinite(required) or required <= 0.0
            or not math.isfinite(float(initial_slew)) or float(initial_slew) < 0.0):
        raise LibertyTimingError("clock period, uncertainty and initial slew are invalid")
    if not math.isfinite(float(wire_capacitance)) or float(wire_capacitance) < 0.0:
        raise LibertyTimingError("wire capacitance must be finite and non-negative")

    order = _combinational_order(instances, graph, model)
    by_name = graph.instances
    # net -> transition -> path state. The state with maximum arrival wins;
    # lexical path identity breaks exact ties deterministically.
    states = {}
    for instance in sorted(sequential, key=lambda item: item.name):
        cell = model.cell(instance.cell_type)
        for pin in cell.sequential_outputs:
            net = instance.conns.get(pin)
            if not net:
                continue
            states.setdefault(net, {})
            for transition in ("fall", "rise"):
                candidate = {
                    "arrival": 0.0,
                    "slew": float(initial_slew),
                    "transition": transition,
                    "launch_instance": instance.name,
                    "launch_pin": pin,
                    "stages": [],
                }
                previous = states[net].get(transition)
                if previous is not None and (
                    previous["launch_instance"], previous["launch_pin"]
                ) != (instance.name, pin):
                    raise LibertyTimingError("net %s has ambiguous sequential launch states" % net)
                states[net][transition] = candidate

    for instance_name in order:
        instance = by_name[instance_name]
        cell = model.cell(instance.cell_type)
        driven_outputs = {
            pin for pin, direction in cell.pin_directions.items()
            if direction == "output" and graph.sinks.get(instance.conns.get(pin, ""))
        }
        arc_outputs = {arc.to_pin for arc in cell.arcs}
        missing_arcs = sorted(driven_outputs - arc_outputs)
        if missing_arcs:
            raise LibertyTimingError(
                "combinational instance %s has driven outputs without timing arcs: %s"
                % (instance.name, ", ".join(missing_arcs))
            )
        for arc in cell.arcs:
            input_net = instance.conns[arc.related_pin]
            output_net = instance.conns.get(arc.to_pin)
            if not output_net:
                continue
            if input_net not in states:
                continue
            output_load = _net_output_load(
                model, graph, output_net, float(wire_capacitance)
            )
            for input_transition, state in sorted(states[input_net].items()):
                for evaluated in evaluate_timing_arc_transitions(
                    model, instance.cell_type, arc.related_pin, arc.to_pin,
                    input_transition, state["slew"], output_load,
                ):
                    candidate = {
                        "arrival": state["arrival"] + evaluated.delay.value,
                        "slew": evaluated.output_slew.value,
                        "transition": evaluated.output_transition,
                        "launch_instance": state["launch_instance"],
                        "launch_pin": state["launch_pin"],
                        "stages": state["stages"] + [{
                            "instance": instance.name,
                            "input_net": input_net,
                            "output_net": output_net,
                            "output_load": output_load,
                            **evaluated.as_dict(),
                        }],
                    }
                    output_states = states.setdefault(output_net, {})
                    previous = output_states.get(evaluated.output_transition)
                    candidate_key = (
                        candidate["arrival"],
                        candidate["launch_instance"],
                        candidate["launch_pin"],
                        tuple(stage["instance"] for stage in candidate["stages"]),
                    )
                    previous_key = None if previous is None else (
                        previous["arrival"],
                        previous["launch_instance"],
                        previous["launch_pin"],
                        tuple(stage["instance"] for stage in previous["stages"]),
                    )
                    if previous_key is None or candidate_key > previous_key:
                        output_states[evaluated.output_transition] = candidate

    paths = []
    for instance in sorted(sequential, key=lambda item: item.name):
        cell = model.cell(instance.cell_type)
        data_net = instance.conns.get(cell.data_pin)
        if data_net not in states:
            continue
        state = max(
            states[data_net].values(),
            key=lambda item: (item["arrival"], item["transition"]),
        )
        endpoint = "%s/%s" % (instance.name, cell.data_pin)
        paths.append({
            "launchpoint": "%s/%s" % (state["launch_instance"], state["launch_pin"]),
            "endpoint": endpoint,
            "endpoint_family": endpoint,
            "transition": state["transition"],
            "delay": state["arrival"],
            "required": required,
            "slack": required - state["arrival"],
            "output_slew": state["slew"],
            "stages": state["stages"],
        })
    if not paths:
        raise LibertyTimingError(
            "mapped top %s has no complete sequential-output to sequential-data path" % top
        )
    paths.sort(key=lambda row: (-row["delay"], row["endpoint"], row["launchpoint"]))
    family_slack = {}
    for path in paths:
        family = path["endpoint_family"]
        family_slack[family] = min(family_slack.get(family, math.inf), path["slack"])
    return {
        "scope": "reg2reg",
        "top": top,
        "net_aliases": [list(alias) for alias in graph.aliases],
        "clock_net": clock_nets[0],
        "clock_polarity": polarities[0],
        "clock_period": float(clock_period),
        "uncertainty": float(uncertainty),
        "required": required,
        "time_unit": model.time_unit,
        "capacitive_load_unit": model.capacitive_load_unit,
        "path_count": len(paths),
        "worst_delay": paths[0]["delay"],
        "worst_slack": min(path["slack"] for path in paths),
        "negative_slack_mass": sum(max(0.0, -slack) for slack in family_slack.values()),
        "endpoint_family_count": len(family_slack),
        "negative_slack_by_endpoint_family": {
            family: max(0.0, -slack)
            for family, slack in sorted(family_slack.items())
        },
        "paths": paths,
    }


def _median(values):
    return float(statistics.median(values)) if values else None


def parse_relative_delay_model(path, required_cells):
    """Compatibility model used by the current critical-subgraph miner."""
    required = set(required_cells)
    digest = hashlib.sha256()
    depth = 0
    cell = None
    cell_depth = None
    table_depth = None
    table_values = []
    table_seen_values = False
    arc_medians = {}

    with open(path, "rb") as raw_file:
        for raw in raw_file:
            digest.update(raw)
            line = raw.decode("utf-8", errors="replace")
            before = depth
            after = before + line.count("{") - line.count("}")

            if cell is None:
                match = CELL_RE.match(line)
                if match:
                    cell = match.group(1).strip()
                    cell_depth = after
                    if cell in required:
                        arc_medians[cell] = []
            elif cell in required:
                if table_depth is None and TABLE_RE.search(line):
                    table_depth = before + 1
                    table_values = []
                    table_seen_values = "values" in line
                    if table_seen_values:
                        for quoted in re.findall(r'"([^"]*)"', line):
                            table_values.extend(
                                float(value) for value in NUMBER_RE.findall(quoted)
                            )
                    if after < table_depth:
                        value = _median(table_values)
                        if value is not None and value >= 0.0:
                            arc_medians[cell].append(value)
                        table_depth = None
                        table_values = []
                        table_seen_values = False
                elif table_depth is not None:
                    if "values" in line:
                        table_seen_values = True
                    if table_seen_values:
                        for quoted in re.findall(r'"([^"]*)"', line):
                            table_values.extend(float(value) for value in NUMBER_RE.findall(quoted))
                    if after < table_depth:
                        value = _median(table_values)
                        if value is not None and value >= 0.0:
                            arc_medians[cell].append(value)
                        table_depth = None
                        table_values = []
                        table_seen_values = False

            depth = after
            if cell is not None and cell_depth is not None and depth < cell_depth:
                cell = None
                cell_depth = None
                table_depth = None
                table_values = []
                table_seen_values = False

    raw_delays = {
        name: _median(values)
        for name, values in arc_medians.items()
        if values and _median(values) is not None
    }
    positive = [value for value in raw_delays.values() if value > 0.0]
    reference = _median(positive) or 1.0
    normalised = {
        name: (value / reference if value > 0.0 else 1.0)
        for name, value in raw_delays.items()
    }
    missing = sorted(required - set(normalised))
    for name in missing:
        normalised[name] = 1.0
    return {
        "delay_units": normalised,
        "liberty_sha256": "sha256:" + digest.hexdigest(),
        "parsed_cell_count": len(raw_delays),
        "required_cell_count": len(required),
        "fallback_cell_count": len(missing),
        "normalisation": "median parsed cell delay = 1.0 DU",
        "model_scope": "relative_nldm_delay_proxy",
    }
