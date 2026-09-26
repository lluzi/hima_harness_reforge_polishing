"""T12: tool adapters -- compile Tcl/StarRC task text and run it through a Site wrapper.

This module is the "glue" the task brief names: it never re-implements an
M1-M8/M11 producer's judgment, it only (a) turns an already-computed value
(a `query_spec`, a sealed `operation`, a `merge-commit`'s own
`innovusEcoTcl`, a `workspace-manifest`'s `namePrefix`) into real PT/StarRC/
Innovus/XTop command text using only the flags documented in
``knowledge/xtop-capabilities.md`` / ``knowledge/innovus-stage-
interventions.md``, and (b) launches that text through a Site-supplied
wrapper (`site_profile["edaShell"]`, an argv prefix -- e.g. an ssh+container
launch -- read from a caller-supplied JSON file, exactly the way
`packs/xtop-timing-closure/flow/closure.py`'s `run_eda`/`profile["edaShell"]`
does; read-only reference, never imported, never a hard-coded `/data/...`
path anywhere in this module or its templates).

Compile functions in this module are pure (no filesystem writes beyond an
explicit `write_task`/`run_tool` call) so `flow/tests/test_adapters.py` can
exercise every one of them without launching EDA or SSH, per this task's
Phase B rule.

Template env-var convention
----------------------------

Every template under ``flow/templates/`` reads plain `$env(NAME)` values
(or, where a value is itself a list -- an XTop edit-domain -- a plain Tcl
global `::NAME`); this module bakes both in as a literal preamble prepended
to the template's own text (`compile_task`), the same "bake values into the
script" pattern `closure.py`'s `copy_template` uses, and for the same
reason: the Site's container wrapper forwards only a fixed environment
allowlist, so a value must be embedded in the script text itself to reach
the commercial tool's process. Every substituted value passes through
`tcl_safe`/`tcl_quote` first (no substituted value may contain a Tcl
metacharacter or, for a scalar, embedded whitespace).

Per-subcommand file layout (documented here for T14 to copy into
`contract.yml`; see `flow/atcs_cli.py`'s own module docstring for the full
subcommand-to-path table -- this module only computes paths, it never owns
the workspace layout decision)
---------------------------------------------------------------------------

- PT scenario/query/presta tasks write their reports under a caller-given
  `report_root` (this module never picks that root itself).
- `compile_starrc_task` always allocates a **new** work directory
  (``<output_root>/starrc/<corner>/work``) distinct from the input DEF's own
  directory -- StarXtract's `STAR_DIRECTORY` output must never land beside
  a read-only input.
- `compile_innovus_eco_task` always writes the merge commit's own
  `innovusEcoTcl` text to ``<output_root>/eco.tcl`` and sources it from
  there; it never inlines that text into the compiled Tcl body itself, so
  the sourced ECO stays inspectable as its own file.

`parse_path_detail` real-corpus grammar (Task 16)
-----------------------------------------------------

`parse_path_detail` (residual-evidence `cellDelay`/`netDelay`/`slew`/
`fanout`/`location` extraction from a targeted `pt-query.tcl` report) was
originally written without a real report sample and has since been
re-verified against a real Foundation ROUND3 ``setup.rpt``/``hold.rpt``
corpus (``docs/assessment/2026-09-26/atcs-qualification/corpus-
preflight.md``) — this Pack's own `pt-query.tcl`/`pt-scenario.tcl` templates
request the exact same ``report_timing -path_type full_clock_expanded
-input_pins -nets -transition_time -capacitance`` flags the real corpus was
generated with, so that grammar is what production will actually feed this
function. Three things the original best-effort regex got wrong, all fixed
here:

- A real report wraps any instance/pin name too long to share its line
  with the value columns onto its own line, leaving the columns alone on
  the *next* physical line with no name prefix at all — the overwhelming
  common case for this design's deep hierarchical instance paths. The
  original single-line regex silently skipped every such arc.
- Every arc's Incr and Path values have a stray one-character annotation
  token (observed: ``&``) between them that the original regex's fixed
  "two trailing numbers only" tail did not tolerate, failing the match
  outright (so even *unwrapped* short lines like ``clk (in) ...`` never
  matched either).
- A net's own line never carries Incr/Path at all — only `Fanout` and
  (except a path's final, off-chip net) `Cap` — never the five-column
  `Fanout`/`Trans`/`Cap`/`Incr`/`Path` shape the old regex assumed; when
  such a two-number net line happened to slip past the old regex's anchored
  tail, the `Fanout` integer was silently misread as an `Incr` delay value
  in nanoseconds — a wrong *known* number, not a safe `unknown`. The
  correct column order is also `Fanout Cap Trans Incr Path` (`Cap` before
  `Trans`), not `Fanout Trans Cap Incr Path` as the old regex encoded it.

The rewritten parser classifies each arc's numeric tail by *shape* instead
of by a hand-guessed column layout: a lone bare integer (or an integer plus
one decimal) is a net's `Fanout`[`+Cap`]; three decimals are a pin/port
arc's `Trans`/`Incr`/`Path` (PT never prints `Fanout` with a decimal point
or `Trans`/`Incr`/`Path` without one, so the two shapes never collide).
This also makes an explicit per-name skip list unnecessary: every non-arc
report line (headers, dividers, `Startpoint:`/`Endpoint:` lines, the
clock-path/slack summary block) leaves behind a numeric-token shape that
never happens to match either recognized pattern, so it is dropped without
being named.

Whether an arc's `Incr` counts as net or cell delay is decided
structurally, not by guessing a pin's direction from its name (which is
cell-library-specific and unknowable in general): the report's own
recurring unit is *[net info line] -> [that net's receiving pin, net
delay] -> [that same instance's driving pin, cell delay] -> [next net info
line]*, so a pin arc immediately preceded by a net-info line (or by the
very start of the path) is net delay, and a pin arc immediately preceded by
another pin arc is cell delay. `location` is the last pin arc's own
instance path (everything before its final `/<pin>` segment — the earlier
version's `name.split("/")[0]` returned only the top-level block name for
any deep hierarchical path, which is nearly useless as "a value identifying
where on the floorplan"; the fix keeps the full instance path up to the
leaf).

Every field this parser cannot positively identify from a matching line is
still `unknown` with a reason, never guessed.
"""
from __future__ import annotations

import json
import re
import shlex
import subprocess
from pathlib import Path

from . import core
from . import contributions as contributions_module
from . import integration as integration_module


TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

REQUIRED_SCENARIOS = (
    "func_ssg_rcworst_m40",
    "func_ssg_rcworst_125",
    "func_ffg_cbest_m40",
    "func_ffg_cbest_125",
)

DEFAULT_NWORST = 20

_UNSAFE_TCL_CHARS = set(';[]{}$"\n')


class AdapterToolError(Exception):
    """An EDA/tool subprocess run through `run_tool` failed.

    `log_path` is where the tool's captured output was written -- the CLI
    dispatcher (`flow/atcs_cli.py`) reports this path on exit code 4.
    """

    def __init__(self, detail, log_path):
        super().__init__(detail)
        self.detail = detail
        self.log_path = str(log_path)


# ---------------------------------------------------------------------------
# Tcl safety and template rendering
# ---------------------------------------------------------------------------


def tcl_safe(value, label):
    """Return `value` unchanged, or raise `AtcsError("unsafe-name", ...)`.

    Same rule as `atcs.integration._validate_tcl_value`: a non-empty string
    with no whitespace and none of ``;[]{}$"`` or a newline. Re-checked here
    (rather than trusted from an already-validated `operation`) because
    these values are about to be embedded literally in Tcl this module
    generates for a template.
    """
    if not isinstance(value, str) or value == "":
        raise core.AtcsError("unsafe-name", f"{label} must be a non-empty string, got {value!r}")
    if any(ch.isspace() or ch in _UNSAFE_TCL_CHARS for ch in value):
        raise core.AtcsError("unsafe-name", f"{label} contains an unsafe character: {value!r}")
    return value


_PATH_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def validate_path_segment(value, label):
    """Return `value` unchanged, or raise `AtcsError("invalid-path-segment", ...)`.

    Every artifact-derived value this module or `atcs_cli.py` turns into a
    filesystem path *component* -- a corner, design, scenario or stage
    name, a merge/batch id -- passes through here first: non-empty,
    ``^[A-Za-z0-9_.-]+$``, and never exactly ``"."`` or ``".."`` (which
    `Path.__truediv__`/`os.path.join` would otherwise silently honor as
    "this directory"/"parent directory", letting a malformed or malicious
    value climb outside the intended output root, or a newline/`;`/etc.
    corrupt a generated Tcl/StarRC command file that later embeds the same
    path). These values are Site/tool/Workshop output this module does not
    otherwise trust -- fail-closed here, never sanitized-by-substitution.
    """
    if not isinstance(value, str) or value == "":
        raise core.AtcsError("invalid-path-segment", f"{label} must be a non-empty string, got {value!r}")
    if value in (".", ".."):
        raise core.AtcsError("invalid-path-segment", f"{label} must not be '.' or '..', got {value!r}")
    if not _PATH_SEGMENT_RE.match(value):
        raise core.AtcsError(
            "invalid-path-segment", f"{label} contains a character outside [A-Za-z0-9_.-]: {value!r}"
        )
    return value


def tcl_quote(value):
    """Escape `value` for embedding inside a double-quoted Tcl string literal."""
    text = str(value)
    for ch in ("\\", "\"", "[", "]", "$"):
        text = text.replace(ch, "\\" + ch)
    return text


def tcl_list_literal(values, label):
    """A Tcl list literal (``{a b c}``) of `values`, each checked via `tcl_safe`."""
    safe_values = [tcl_safe(value, f"{label} entry") for value in values]
    return "{" + " ".join(safe_values) + "}"


def load_template(name):
    """Read one file under `flow/templates/`; fail-closed if it is absent."""
    path = TEMPLATES_DIR / name
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise core.AtcsError("missing-input", f"template not found: {name}: {exc}") from exc


def env_preamble(env):
    """`{NAME: value}` -> one ``set env(NAME) "value"`` line per entry."""
    return "".join(f'set env({key}) "{tcl_quote(value)}"\n' for key, value in env.items())


def global_preamble(globals_):
    """`{NAME: [tokens]}` -> one ``set ::NAME {a b}`` line per entry."""
    return "".join(f"set ::{name} {tcl_list_literal(values, name)}\n" for name, values in globals_.items())


def compile_task(template_name, env=None, globals_=None, extra_preamble=""):
    """Render one template: baked globals, then baked env, then `extra_preamble`, then the template body."""
    text = load_template(template_name)
    preamble = ""
    if globals_:
        preamble += global_preamble(globals_)
    if env:
        preamble += env_preamble(env)
    preamble += extra_preamble
    return preamble + text


def write_task(target_path, template_name, env=None, globals_=None, extra_preamble=""):
    """`compile_task` and write the result to `target_path`; return the written `Path`."""
    text = compile_task(template_name, env=env, globals_=globals_, extra_preamble=extra_preamble)
    target = Path(target_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    return target


# ---------------------------------------------------------------------------
# Site wrapper execution
# ---------------------------------------------------------------------------


def shell_line(command, shell_env=None):
    """The single command text the Site wrapper's shell runs (see `closure.py`'s `shell_line`)."""
    prefix = "".join(f"{name}={value} " for name, value in (shell_env or []))
    return prefix + shlex.join([str(x) for x in command])


def run_tool(site_profile, command, cwd, log_path, shell_env=None):
    """Run one EDA command through the Site wrapper named in `site_profile["edaShell"]`.

    `site_profile` is a caller-supplied dict read from a declared,
    workspace-external JSON file -- this function never hard-codes a
    wrapper or a ``/data/...`` path. Raises `AtcsError("missing-input", ...)`
    when `site_profile` carries no usable `edaShell`, and
    `AdapterToolError` when the wrapped tool exits non-zero or its captured
    log reports an ``ERROR``/``Fatal`` line (same detection `closure.py`'s
    `run_eda` uses).
    """
    eda_shell = site_profile.get("edaShell") if isinstance(site_profile, dict) else None
    if not isinstance(eda_shell, list) or not eda_shell or not all(isinstance(x, str) and x for x in eda_shell):
        raise core.AtcsError("missing-input", "site profile edaShell must be a non-empty argv list")
    log = Path(log_path)
    log.parent.mkdir(parents=True, exist_ok=True)
    shell = list(eda_shell) + [shell_line(command, shell_env)]
    with open(log, "wb") as output:
        proc = subprocess.run(shell, cwd=str(cwd), stdout=output, stderr=subprocess.STDOUT)
    if proc.returncode != 0:
        raise AdapterToolError(f"tool exited {proc.returncode}", log)
    text = log.read_text(errors="replace")
    if re.search(r"(?m)^(?:\*\*)?(?:ERROR|Error|Fatal):", text):
        raise AdapterToolError("tool log reports an error", log)
    return log


# ---------------------------------------------------------------------------
# PrimeTime: scenario refresh (`observe`/`sta`)
# ---------------------------------------------------------------------------


def compile_pt_scenario_task(scenario, inputs, report_root, query_spec):
    """One `pt-scenario.tcl` task for `scenario`.

    `inputs`: ``{"design","netlist","sdc","spef", "libGlob"?, "driverLibrary"?,
    "originalDriverLibrary"?, "staData"?}``. `query_spec`:
    ``{"precision","requiredScenarios","maxPaths","nworst"?}`` (see
    `atcs.state.capture`'s own binding shape) -- `maxPaths`/`nworst`/
    `precision` are copied into the compiled Tcl's `MAX_PATHS`/`NWORST`/
    `PBA_MODE` env vars exactly, never defaulted silently except `nworst`,
    which falls back to `DEFAULT_NWORST` when `query_spec` omits it.
    """
    validate_path_segment(scenario, "scenario")
    for key in ("design", "netlist", "sdc", "spef"):
        if not inputs.get(key):
            raise core.AtcsError("missing-input", f"pt-scenario inputs for {scenario!r} are missing {key!r}")
    validate_path_segment(inputs["design"], "design")
    max_paths = query_spec.get("maxPaths")
    if isinstance(max_paths, bool) or not isinstance(max_paths, int) or max_paths <= 0:
        raise core.AtcsError("missing-input", "query_spec.maxPaths must be a positive int")
    nworst = query_spec.get("nworst", DEFAULT_NWORST)
    if isinstance(nworst, bool) or not isinstance(nworst, int) or nworst <= 0:
        raise core.AtcsError("missing-input", "query_spec.nworst must be a positive int")
    precision = query_spec.get("precision")
    if precision not in ("gba", "pba"):
        raise core.AtcsError("missing-input", "query_spec.precision must be 'gba' or 'pba'")
    pba_mode = 1 if precision == "pba" else 0

    report_dir = Path(report_root) / scenario
    env = {
        "DESIGN": inputs["design"], "NETLIST": inputs["netlist"], "INPUT_SDC": inputs["sdc"],
        "SPEF": inputs["spef"], "SCENARIO": scenario, "REPORT_ROOT": str(report_root),
        "MAX_PATHS": str(max_paths), "NWORST": str(nworst), "PBA_MODE": str(pba_mode),
    }
    if inputs.get("libGlob"):
        env["LIB_GLOB"] = inputs["libGlob"]
    if inputs.get("driverLibrary") and inputs.get("originalDriverLibrary"):
        env["DRIVER_LIBRARY"] = inputs["driverLibrary"]
        env["ORIGINAL_DRIVER_LIBRARY"] = inputs["originalDriverLibrary"]
    if pba_mode and inputs.get("staData"):
        env["STA_DATA"] = inputs["staData"]

    tcl = compile_task("pt-scenario.tcl", env=env)
    reports = {name: str(report_dir / name) for name in
               ("global_timing.rpt", "setup.rpt", "hold.rpt", "check_timing.rpt")}
    return {
        "scenario": scenario, "tcl": tcl, "env": env, "reportDir": str(report_dir), "reports": reports,
        "command": ["pt_shell", "-f"],
    }


def compile_pt_scenario_tasks(query_spec, scenario_inputs, report_root):
    """One `compile_pt_scenario_task` per `REQUIRED_SCENARIOS` name.

    Raises `AtcsError("missing-input", ...)` naming any required scenario
    absent from `scenario_inputs` -- this Pack never observes a subset of
    the four required scenarios silently.
    """
    tasks = {}
    for scenario in REQUIRED_SCENARIOS:
        if scenario not in scenario_inputs:
            raise core.AtcsError("missing-input", f"scenario inputs are missing required scenario {scenario!r}")
        tasks[scenario] = compile_pt_scenario_task(scenario, scenario_inputs[scenario], report_root, query_spec)
    return tasks


# ---------------------------------------------------------------------------
# PrimeTime: targeted recheck / residual-evidence query (`risk`/`residual`)
# ---------------------------------------------------------------------------


def compile_pt_query_task(inputs, report_root, targets):
    """One `pt-query.tcl` task querying every `{"checkKey","startpoint","endpoint"}` in `targets`."""
    for key in ("design", "netlist", "sdc", "spef"):
        if not inputs.get(key):
            raise core.AtcsError("missing-input", f"pt-query inputs are missing {key!r}")
    if not targets:
        raise core.AtcsError("missing-input", "pt-query needs at least one targeted check")

    report_names = {}
    tcl_targets = []
    for index, target in enumerate(targets):
        name = f"q{index:03d}"
        report_names[target["checkKey"]] = name
        startpoint = tcl_safe(target["startpoint"], "startpoint")
        endpoint = tcl_safe(target["endpoint"], "endpoint")
        tcl_targets.append("{" + f"{startpoint} {endpoint} {name}" + "}")

    env = {
        "DESIGN": inputs["design"], "NETLIST": inputs["netlist"], "INPUT_SDC": inputs["sdc"],
        "SPEF": inputs["spef"], "REPORT_ROOT": str(report_root),
    }
    extra_preamble = "set ::ATCS_QUERY_TARGETS {" + " ".join(tcl_targets) + "}\n"
    tcl = compile_task("pt-query.tcl", env=env, extra_preamble=extra_preamble)
    reports = {key: str(Path(report_root) / f"{name}.rpt") for key, name in report_names.items()}
    return {"tcl": tcl, "env": env, "reportNames": report_names, "reports": reports}


_ARC_NAME_LINE_RE = re.compile(r"^(?P<name>\S+)(?:\s+\((?P<paren>[^)]*)\))?\s*(?P<rest>.*)$")
_INT_TOKEN_RE = re.compile(r"^\d+$")
_FLOAT_TOKEN_RE = re.compile(r"^-?\d+\.\d+$")
_EDGE_FLAG_RE = re.compile(r"^[rf]$")
_HAS_WORD_CHAR_RE = re.compile(r"[A-Za-z0-9]")


def _classify_arc_values(token_text):
    """Classify a PT `report_timing -input_pins -nets -transition_time
    -capacitance` arc's value-column tail as a net row (bare `fanout`,
    optional `cap`) or a pin/port row (`trans`, `incr`, `path`) -- see
    module docstring. Returns `None` when the surviving numeric tokens
    match neither shape, which is how every non-arc line is safely ignored
    without a name-based skip list.
    """
    tokens = token_text.split()
    if tokens and _EDGE_FLAG_RE.match(tokens[-1]):
        tokens = tokens[:-1]
    numeric = [t for t in tokens if _INT_TOKEN_RE.match(t) or _FLOAT_TOKEN_RE.match(t)]
    if len(numeric) == 1 and _INT_TOKEN_RE.match(numeric[0]):
        return {"kind": "net", "fanout": int(numeric[0])}
    if len(numeric) == 2 and _INT_TOKEN_RE.match(numeric[0]) and _FLOAT_TOKEN_RE.match(numeric[1]):
        return {"kind": "net", "fanout": int(numeric[0])}
    if len(numeric) == 3 and all(_FLOAT_TOKEN_RE.match(t) for t in numeric):
        return {"kind": "pin", "trans": float(numeric[0]), "incr": float(numeric[1])}
    return None


def _iter_path_detail_arcs(text):
    """Yield `(name, classified)` for every arc line in `text`, resolving
    the "name wraps onto its own line, values follow on the next" shape a
    real report uses for long instance/pin names (see module docstring).
    """
    pending = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if pending is not None:
            name, _paren = pending
            pending = None
            classified = _classify_arc_values(line)
            if classified is not None:
                yield name, classified
                continue
            # `line` was not actually a values-continuation -- fall through
            # and re-parse it fresh below.
        match = _ARC_NAME_LINE_RE.match(line)
        if not match:
            continue
        name, paren, rest = match.group("name"), match.group("paren"), match.group("rest")
        if not rest:
            if _HAS_WORD_CHAR_RE.search(name):
                pending = (name, paren)
            continue
        classified = _classify_arc_values(rest)
        if classified is not None:
            yield name, classified


def parse_path_detail(text):
    """Per-arc breakdown of one targeted `report_timing` path (see module docstring).

    Returns ``{"cellDelay","netDelay","slew","fanout","location"}`` Measures.
    A field this parser cannot positively identify from a matching line is
    `unknown` with a reason -- never guessed from an unrelated line.
    """
    cell_total = 0.0
    net_total = 0.0
    have_cell = False
    have_net = False
    worst_trans = None
    worst_fanout = None
    last_location = None
    prior_was_pin = False

    for name, classified in _iter_path_detail_arcs(text):
        if classified["kind"] == "net":
            worst_fanout = max(worst_fanout or 0, classified["fanout"])
            prior_was_pin = False
            continue
        worst_trans = max(worst_trans or 0.0, classified["trans"])
        last_location = name.rsplit("/", 1)[0]
        if prior_was_pin:
            cell_total += classified["incr"]
            have_cell = True
        else:
            net_total += classified["incr"]
            have_net = True
        prior_was_pin = True

    return {
        "cellDelay": core.known(cell_total) if have_cell else core.unknown("no cell arc parsed"),
        "netDelay": core.known(net_total) if have_net else core.unknown("no net arc parsed"),
        "slew": core.known(worst_trans) if worst_trans is not None else core.unknown("no transition column parsed"),
        "fanout": core.known(worst_fanout) if worst_fanout is not None else core.unknown("no fanout column parsed"),
        "location": core.known(last_location) if last_location else core.unknown("no cell instance parsed"),
    }


# ---------------------------------------------------------------------------
# PrimeTime: presta pre-check (`presta`)
# ---------------------------------------------------------------------------


def compile_pt_presta_task(scenario, inputs, report_root):
    """One `pt-presta.tcl` task -- see module docstring and `pt-presta.tcl` for scope."""
    validate_path_segment(scenario, "scenario")
    for key in ("design", "netlist", "sdc", "spef"):
        if not inputs.get(key):
            raise core.AtcsError("missing-input", f"presta inputs for {scenario!r} are missing {key!r}")
    validate_path_segment(inputs["design"], "design")
    env = {
        "DESIGN": inputs["design"], "NETLIST": inputs["netlist"], "INPUT_SDC": inputs["sdc"],
        "SPEF": inputs["spef"], "SCENARIO": scenario, "REPORT_ROOT": str(report_root),
    }
    tcl = compile_task("pt-presta.tcl", env=env)
    return {"tcl": tcl, "env": env, "globalTiming": str(Path(report_root) / scenario / "global_timing.rpt")}


_SPEF_NAME_MAP_RE = re.compile(r"^\*(\d+)\s+(\S+)", re.MULTILINE)
_SPEF_NET_RE = re.compile(r"^\*D_NET\s+(\S+)", re.MULTILINE)
_SPEF_ALIAS_RE = re.compile(r"^\*\d+$")


def parse_spef_net_names(text):
    """Net names an SPEF text actually models, or `None` when unreadable.

    Feeds `atcs.verification.presta_qualification`'s `spef_net_names`
    argument directly (its own `None` case: "the SPEF's net-name list
    itself could not be read").

    A real SPEF (confirmed against a real Foundation ROUND3 StarRC
    ``.spef`` sample) almost always writes each ``*D_NET`` line against a
    ``*NAME_MAP`` index alias (``*D_NET *1424 13.6978``), never the literal
    net name directly, per the IEEE 1481 ``*NAME_MAP`` name-compression
    convention this Pack's own StarRC output actually uses — the alias
    token itself carries no information about the net's real name, so
    treating it as the name (as an earlier version of this function did)
    silently returned the wrong set entirely: every real net name came back
    as an opaque ``*<digits>`` alias no real `new_nets` request could ever
    match, making `presta_qualification` mark every real net as
    "unqualified" regardless of what the SPEF actually models. Every alias
    token is now resolved through the ``*NAME_MAP`` block (``*<index>
    <name>``) built from this same text first. A ``*D_NET`` line that names
    its net literally (no index substitution in play at all) is still
    supported directly. An alias with no matching ``*NAME_MAP`` entry is
    dropped, never guessed — `presta_qualification` already treats an
    absent net as fail-closed "not proven qualified", which is exactly the
    right outcome for a name this function could not actually resolve.
    """
    if text is None:
        return None
    name_map = {f"*{index}": name for index, name in _SPEF_NAME_MAP_RE.findall(text)}
    names = set()
    for token in _SPEF_NET_RE.findall(text):
        if _SPEF_ALIAS_RE.match(token):
            resolved = name_map.get(token)
            if resolved is not None:
                names.add(resolved)
        else:
            names.add(token)
    return names


# ---------------------------------------------------------------------------
# StarRC extraction (`extract`)
# ---------------------------------------------------------------------------


def _is_within(path, root):
    """True when `path` (already resolved) is `root` itself or nested under it."""
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def compile_starrc_task(design, corner, def_path, output_root, template_text=None):
    """One StarXtract command-file task for `corner`.

    Always allocates a fresh, private `STAR_DIRECTORY`
    (``<output_root>/starrc/<corner>/work``) -- raises
    `AtcsError("invalid-workspace", ...)` unless the *resolved* work
    directory is inside `output_root` and is not itself the input DEF's own
    directory or nested inside it, so a StarRC run can never write into a
    read-only input's directory (checked by actual containment, not just
    exact-path equality, so a work dir a few levels under the DEF's own
    directory is caught too). `template_text` is the Site-supplied base
    command file for this corner (see `starrc.cmd`'s own docstring); the
    Pack's shipped `starrc.cmd` is used as a fallback when omitted.

    `design` and `corner` are validated via `validate_path_segment` before
    either is used to build a filesystem path or a StarXtract output
    filename below.
    """
    validate_path_segment(design, "design")
    validate_path_segment(corner, "corner")
    output_root = Path(output_root)
    work_dir = output_root / "starrc" / corner / "work"
    cmd_path = output_root / "starrc" / corner / f"{corner}.cmd"
    spef_path = output_root / "starrc" / corner / f"{design}.{corner}.spef"
    def_path_obj = Path(def_path)

    output_root_resolved = output_root.resolve()
    work_dir_resolved = work_dir.resolve()
    def_dir_resolved = def_path_obj.parent.resolve()
    if not _is_within(work_dir_resolved, output_root_resolved):
        raise core.AtcsError("invalid-workspace", f"StarRC work dir must be inside output_root: {work_dir_resolved}")
    if _is_within(work_dir_resolved, def_dir_resolved):
        raise core.AtcsError(
            "invalid-workspace", "StarRC work dir may not be the input DEF's own directory, or nested inside it"
        )

    text = template_text if template_text is not None else load_template("starrc.cmd")
    changes = {
        r"(?m)^TOP_DEF_FILE:.*$": f"TOP_DEF_FILE: {def_path_obj}",
        r"(?m)^STAR_DIRECTORY:.*$": f"STAR_DIRECTORY: {work_dir}",
        r"(?m)^NETLIST_FILE:.*$": f"NETLIST_FILE: {spef_path}",
    }
    for pattern, replacement in changes.items():
        text, count = re.subn(pattern, replacement, text)
        if count != 1:
            raise core.AtcsError("malformed-template", f"StarRC template did not have exactly one {pattern}")

    return {
        "corner": corner, "cmdPath": str(cmd_path), "cmdText": text, "workDir": str(work_dir),
        "spefPath": str(spef_path), "command": ["StarXtract", "-clean", str(cmd_path)],
    }


def compile_starrc_tasks(design, corners, def_path, output_root, templates=None):
    """One `compile_starrc_task` per entry of `corners`; `templates` optionally maps corner -> base text."""
    templates = templates or {}
    return {corner: compile_starrc_task(design, corner, def_path, output_root, templates.get(corner))
            for corner in corners}


# ---------------------------------------------------------------------------
# Innovus: plain export (`baseline`/`physical` baseline mode) and ECO (`implement`)
# ---------------------------------------------------------------------------


def compile_innovus_export_task(current_db_path, design, output_root):
    """One `innovus-export.tcl` task: restore `current_db_path`, no ECO, export + physical evidence."""
    validate_path_segment(design, "design")
    output_root = Path(output_root)
    env = {"CURRENT_DB": str(current_db_path), "DESIGN": design, "OUTPUT_ROOT": str(output_root)}
    tcl = compile_task("innovus-export.tcl", env=env)
    outputs = {
        "def": str(output_root / "EXPORT" / "design.def"),
        "netlist": str(output_root / "EXPORT" / "design.v"),
        "drc": str(output_root / "RPT" / "verify_drc.rpt"),
        "connectivity": str(output_root / "RPT" / "verify_connectivity.rpt"),
    }
    return {"tcl": tcl, "env": env, "outputs": outputs, "command": ["innovus", "-batch", "-files"]}


def compile_innovus_eco_task(merge_commit, current_db_path, design, output_root):
    """One `innovus-eco.tcl` task: source `merge_commit["innovusEcoTcl"]`, route, export under `output_root`.

    Raises `AtcsError("missing-input", ...)` when the merge commit carries
    no `innovusEcoTcl` text. `output_root` is expected to be
    ``implementations/<mergeId>/`` (architecture Sec.13.4) -- every output
    path this function returns is computed under it, never elsewhere.
    """
    validate_path_segment(design, "design")
    eco_text = merge_commit.get("innovusEcoTcl")
    if not eco_text:
        raise core.AtcsError("missing-input", "merge commit has no innovusEcoTcl")
    output_root = Path(output_root)
    eco_path = output_root / "eco.tcl"
    env = {
        "CURRENT_DB": str(current_db_path), "DESIGN": design,
        "ECO_TCL": str(eco_path), "OUTPUT_ROOT": str(output_root),
    }
    tcl = compile_task("innovus-eco.tcl", env=env)
    outputs = {
        "database": str(output_root / "DBS" / f"{design}.enc"),
        "def": str(output_root / "EXPORT" / "design.def"),
        "netlist": str(output_root / "EXPORT" / "design.v"),
        "drc": str(output_root / "RPT" / "verify_drc.rpt"),
        "connectivity": str(output_root / "RPT" / "verify_connectivity.rpt"),
    }
    return {
        "tcl": tcl, "env": env, "ecoPath": str(eco_path), "ecoText": eco_text,
        "outputs": outputs, "command": ["innovus", "-batch", "-files"],
    }


# ---------------------------------------------------------------------------
# XTop: typed Operator session (worker manual analysis) and deterministic replay
# ---------------------------------------------------------------------------


def compile_xtop_operator_task(workspace_manifest, design, tech_lef, cell_lef_glob, netlist, def_path,
                                output_root, sta_data=None):
    """One `xtop-operator.tcl` typed-session startup task.

    `argv` always carries `workspace_manifest["namePrefix"]` (this task's
    Step-1 requirement) so the Site's PTY wrapper can bind the launched
    session to the worker slot it belongs to.
    """
    validate_path_segment(design, "design")
    name_prefix = workspace_manifest.get("namePrefix")
    if not name_prefix:
        raise core.AtcsError("missing-input", "workspace manifest has no namePrefix")
    output_root = Path(output_root)
    eco_prefix = f"{name_prefix}eco"
    env = {
        "DESIGN": design, "TECH_LEF": tech_lef, "CELL_LEF_GLOB": cell_lef_glob,
        "NETLIST": netlist, "DEF": def_path, "RUN_ROOT": str(output_root),
        "ECO_PREFIX": eco_prefix, "NAME_PREFIX": name_prefix,
    }
    if sta_data:
        env["STA_DATA"] = sta_data
    tcl_path = output_root / "operator.tcl"
    tcl = compile_task("xtop-operator.tcl", env=env)
    argv = ["xtop", "-f", str(tcl_path), name_prefix]
    return {"tcl": tcl, "env": env, "tclPath": str(tcl_path), "argv": argv, "ecoPrefix": eco_prefix}


def compile_xtop_analysis_manual_task(workspace_manifest, edit_domain, operator_tcl_path, ops_log_path):
    """One `xtop-analysis-manual.tcl` task binding `edit_domain` for this worker's whole session.

    `edit_domain`: ``{"instances": [...], "nets": [...]}`` (a work
    package's own `editDomain`, minus `regions` -- this task's typed
    procedures only gate instances and nets, matching `xtop-operator.tcl`'s
    `atcs_size_cell`/`atcs_insert_buffer`/`atcs_delete_buffer`).
    """
    name_prefix = workspace_manifest.get("namePrefix")
    if not name_prefix:
        raise core.AtcsError("missing-input", "workspace manifest has no namePrefix")
    instances = list((edit_domain or {}).get("instances") or [])
    nets = list((edit_domain or {}).get("nets") or [])
    globals_ = {"EDIT_DOMAIN_INSTANCES": instances, "EDIT_DOMAIN_NETS": nets}
    env = {"OPERATOR_TCL": str(operator_tcl_path), "OPS_LOG": str(ops_log_path), "NAME_PREFIX": name_prefix}
    tcl = compile_task("xtop-analysis-manual.tcl", env=env, globals_=globals_)
    return {"tcl": tcl, "env": env, "editDomain": {"instances": instances, "nets": nets}}


def compile_xtop_replay_task(current_db_path, design, steps, output_root):
    """One `xtop-replay.tcl` batch-replay task for `steps` (a `replay-request.steps` list).

    Each step's Tcl is `atcs.integration.xtop_tcl(op)` -- this function
    never re-derives XTop command text itself. Stops at the first failing
    step (later steps stay receipt-less, i.e. pending -- architecture
    Sec.8.4's recovery rule); `read_replay_receipts` turns the resulting
    `receipts.jsonl` + cell dumps into the `[{"stepId","status",
    "observedDelta"}]` shape `atcs.integration.reconcile` expects.
    """
    validate_path_segment(design, "design")
    output_root = Path(output_root)
    dump_dir = output_root / "dumps"
    receipts_log = output_root / "receipts.jsonl"
    steps_path = output_root / "steps.tcl"
    lines = []
    for index, step in enumerate(steps, start=1):
        step_id = tcl_safe(step["stepId"], "stepId")
        op_tcl = integration_module.xtop_tcl(step["op"])
        lines.append(f'atcs_replay_step "{step_id}" {{{op_tcl}}} {index}\n')
    steps_text = "".join(lines)
    env = {
        "CURRENT_DB": str(current_db_path), "DESIGN": design, "STEPS_TCL": str(steps_path),
        "DUMP_DIR": str(dump_dir), "RECEIPTS_LOG": str(receipts_log),
    }
    tcl = compile_task("xtop-replay.tcl", env=env)
    return {
        "tcl": tcl, "env": env, "stepsPath": str(steps_path), "stepsText": steps_text,
        "dumpDir": str(dump_dir), "receiptsLog": str(receipts_log),
    }


def read_replay_receipts(receipts_log_path):
    """Turn `xtop-replay.tcl`'s `receipts.jsonl` into `atcs.integration.reconcile`'s `receipts` shape.

    For an ``"ok"`` line, re-reads its `beforeDump`/`afterDump` cell dumps
    (`atcs.contributions.parse_cell_dump`) and computes `observedDelta` via
    `atcs.contributions.actual_delta` -- the real object-level diff, never
    a re-parse of the applied op's own declared effect.
    """
    path = Path(receipts_log_path)
    if not path.is_file():
        return []
    receipts = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        row = json.loads(line)
        if row.get("status") == "ok":
            before = contributions_module.parse_cell_dump(Path(row["beforeDump"]).read_text(encoding="utf-8"))
            after = contributions_module.parse_cell_dump(Path(row["afterDump"]).read_text(encoding="utf-8"))
            observed_delta = contributions_module.actual_delta(before, after)
            receipts.append({"stepId": row["stepId"], "status": "ok", "observedDelta": observed_delta})
        else:
            receipts.append({"stepId": row["stepId"], "status": "error"})
    return receipts


# ---------------------------------------------------------------------------
# design-state manifest convenience (used by `baseline`/`sta`)
# ---------------------------------------------------------------------------


def build_design_state_manifest(top, stage, database_enc, database_dat, netlist, def_path,
                                 spef_by_corner, sdc_list, scenario_corners, tools=None,
                                 parent_id=None, root=None):
    """Assemble an `atcs.state.design_state` manifest from already-resolved paths.

    Every path argument is used verbatim as the manifest's own field (so
    the caller decides campaign-relative vs. absolute; `atcs.state`'s own
    `_resolve` then joins it against `root` when given).
    """
    manifest = {
        "top": top,
        "stage": stage,
        "database": {"enc": str(database_enc), "encDat": str(database_dat)},
        "netlist": str(netlist),
        "spef": {corner: str(path) for corner, path in spef_by_corner.items()},
        "sdc": [str(path) for path in sdc_list],
        "scenarios": [{"name": name, "corner": corner} for name, corner in scenario_corners.items()],
        "tools": dict(tools or {}),
    }
    if def_path is not None:
        manifest["def"] = str(def_path)
    if parent_id is not None:
        manifest["parentId"] = parent_id
    if root is not None:
        manifest["root"] = str(root)
    return manifest
