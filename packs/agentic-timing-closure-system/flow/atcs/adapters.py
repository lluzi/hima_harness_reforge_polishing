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
  the sourced ECO stays inspectable as its own file. A recipe batch
  (Issue #64 Task 6) instead names its chosen `write_design_changes` pair;
  the pair is copied to ``<output_root>/eco/{netlist,physical}.tcl`` and
  sourced from there (`innovus-eco-pair.tcl`).

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

import glob as glob_module
import json
import math
import re
import shlex
import subprocess
from pathlib import Path

from . import core
from . import contributions as contributions_module
from . import integration as integration_module
from . import workspaces as workspaces_module


TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

DEFAULT_NWORST = 20

_UNSAFE_TCL_CHARS = core.UNSAFE_TCL_CHARS


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


def tcl_safe(value, label, allow_brackets=False):
    r"""Return `value` unchanged, or raise `AtcsError("unsafe-name", ...)`.

    Same rule as `atcs.integration._validate_tcl_value`: a non-empty string
    with no whitespace, no control character and none of ``;[]{}$"\`` (backslash
    included, final review: mechanical dedupe onto the one shared
    `core.UNSAFE_TCL_CHARS`) or a newline. Re-checked here (rather than trusted
    from an already-validated `operation`) because these values are about to be
    embedded literally in Tcl this module generates for a template.

    I7 (final review, bus-bit-safe names): `allow_brackets=True` admits `[`/`]`
    (see `core.UNSAFE_TCL_CHARS_IN_BRACES`'s own docstring) -- pass it only when
    the caller is about to wrap the returned value in a literal Tcl brace group
    (`tcl_list_literal`, or an equivalent `"{" + value + "}"`), never for a value
    substituted bare or inside a double-quoted Tcl string.
    """
    if not isinstance(value, str) or value == "":
        raise core.AtcsError("unsafe-name", f"{label} must be a non-empty string, got {value!r}")
    if core.is_tcl_unsafe(value, allow_brackets=allow_brackets):
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
    """A Tcl list literal (``{a b c}``) of `values`, each checked via `tcl_safe`.

    I7 (final review): the whole list is one brace-quoted group, so each entry is
    checked with `allow_brackets=True` -- a bus-bit name (`bus[3]`) is admitted.
    """
    safe_values = [
        "{}" if value == "" else tcl_safe(value, f"{label} entry", allow_brackets=True)
        for value in values
    ]
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


def shell_env_value(value) -> str:
    """One assignment's right-hand side, quoted so the container's shell evaluates it as written
    (same convention as `closure.py`'s `shell_env_value`).

    Double quotes preserve an inner `${...}` expansion, which is how an inherited value is kept;
    `shlex.join`/single-quoting would instead freeze that expansion as literal text.
    """
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def discover_starrc_toolkit(site_profile):
    """The StarRC toolkit root, asked of the container that will run StarXtract.

    Resolved by walking up from the binary to the directory that actually holds
    `linux64_starrc`, rather than by counting levels: the toolkit root is the one a given
    install puts its platform directory under, and a fixed count would silently pick the
    wrong directory when it differs. Asked inside the container (through the Site's own
    `edaShell`) because that is where the tool resolves; a path computed on the host says
    nothing about what the tool's own environment will look like. Returns `None` when
    `site_profile` has no usable `edaShell`, or when the probe fails or finds nothing --
    never raises, so callers can fail closed with their own message.
    """
    eda_shell = site_profile.get("edaShell") if isinstance(site_profile, dict) else None
    if not isinstance(eda_shell, list) or not eda_shell or not all(isinstance(x, str) and x for x in eda_shell):
        return None
    probe = ('b=$(command -v StarXtract) || exit 1; d=$(dirname "$b"); '
             'while [ "$d" != / ]; do [ -d "$d/linux64_starrc/lib" ] && { echo "$d"; exit 0; }; '
             'd=$(dirname "$d"); done; exit 1')
    try:
        proc = subprocess.run(eda_shell + [probe], stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    found = proc.stdout.decode("utf-8", "replace").strip().splitlines()
    return Path(found[-1]) if proc.returncode == 0 and found else None


def starrc_shell_env(toolkit):
    """The in-container environment StarXtract needs, as `shell_line`-ready assignment pairs.

    StarXtract resolves `libtbb.so.12` only when the toolkit's own library directories are on
    the loader search path (Issue 63: the Site's `edarun` wrapper forwards no such value on its
    own). The inherited value is appended in the same shell, preserving whatever the
    container's own EDA init put there. Returns `[]` when `toolkit` is falsy or neither library
    directory actually exists, so a caller can fail closed instead of running StarXtract with an
    empty prefix.
    """
    if not toolkit:
        return []
    toolkit = Path(toolkit)
    roots = [candidate for candidate in (toolkit / "linux64_starrc" / "lib",
                                        toolkit / "linux64_starrc" / "lib" / "shlib")
             if candidate.is_dir()]
    if not roots:
        return []
    entries = ":".join(str(root) for root in roots) + ":${LD_LIBRARY_PATH:-}"
    return [("LD_LIBRARY_PATH", shell_env_value(entries))]


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


def hash_library_glob(lib_glob, label="libGlob"):
    """The sorted `[{"path","sha256"}]` of every file `lib_glob` matches, hashed now.

    C4 (final review, per-scenario library identity): the same glob PT's own
    `lsort [glob -nocomplain $env(LIB_GLOB)]` will match inside
    `pt-scenario.tcl`/`pt-presta.tcl`, computed here in Python *before* PT
    ever launches, so a Site whose configured `libGlob` matches nothing is
    caught fail-closed, with an informative error, rather than surfacing only
    as PT's own opaque Tcl `error`. The result is recorded verbatim into a
    scenario's own `sta_receipts[...]["inputs"]["libraries"]` (`_cmd_sta`),
    so a real library-set identity -- not just a corner name -- is part of
    what a later `evaluate` can inspect. Raises `AtcsError("missing-input",
    ...)` when nothing matches.
    """
    matches = sorted(glob_module.glob(lib_glob))
    if not matches:
        raise core.AtcsError("missing-input", f"no files matched {label} {lib_glob!r}")
    return [{"path": path, "sha256": core.file_sha256(Path(path))} for path in matches]


_XTOP_ECO_FIELDS = {
    "bufferListForHold", "bufferListForSetup", "cellClassifyRule", "cellMatchAttribute",
    "cellNominalSwapKeywords", "cellNominalSizingPattern", "gainThreshold",
}


def compile_xtop_site_context(site_profile, required_scenarios):
    """Validate the Site-owned XTop legality/timing configuration.

    Returns ``None`` only when the Site declares no ``xtopContext`` at all. That keeps ordinary PT
    observation usable, while worker/replay preparation still fails closed because no verified
    ``state/xtop-context.json`` can exist. A declared context must be complete and must name exactly
    the admitted analysis-contract scenarios.
    """
    config = (site_profile or {}).get("xtopContext")
    if config is None:
        return None
    if not isinstance(config, dict):
        raise core.AtcsError("invalid-input", "siteProfile.xtopContext must be an object")
    required = core.required_scenarios(list(required_scenarios))
    site_map = config.get("siteMap")
    fillers = config.get("removableFillers")
    scenarios = config.get("scenarios")
    eco = config.get("ecoParameters")
    if not isinstance(site_map, list) or not site_map or not all(isinstance(x, str) and x for x in site_map):
        raise core.AtcsError("missing-input", "xtopContext.siteMap must be a non-empty string list")
    if not isinstance(fillers, list) or not fillers or not all(isinstance(x, str) and x for x in fillers):
        raise core.AtcsError("missing-input", "xtopContext.removableFillers must be a non-empty string list")
    if not isinstance(scenarios, list) or not scenarios:
        raise core.AtcsError("missing-input", "xtopContext.scenarios must be a non-empty list")
    if not isinstance(eco, dict) or set(eco) != _XTOP_ECO_FIELDS:
        raise core.AtcsError("missing-input", f"xtopContext.ecoParameters must have exactly {sorted(_XTOP_ECO_FIELDS)}")

    scenario_map = {}
    library_files = {}
    lines = []
    corners = []
    for row in scenarios:
        if not isinstance(row, dict) or set(row) != {"name", "corner", "libertyGlob"}:
            raise core.AtcsError("invalid-input", "each xtopContext.scenarios entry must have name, corner, libertyGlob")
        if not all(isinstance(row[key], str) and row[key] for key in row):
            raise core.AtcsError("invalid-input", "XTop scenario fields must be non-empty strings")
        name = row["name"]
        if name in scenario_map:
            raise core.AtcsError("invalid-input", f"duplicate XTop scenario {name!r}")
        scenario_map[name] = row
        library_files[name] = hash_library_glob(row["libertyGlob"], label=f"XTop scenario {name} libertyGlob")
        corner = row["corner"]
        if corner not in corners:
            corners.append(corner)
            liberty_glob = tcl_quote(row["libertyGlob"])
            lines.extend([
                f"create_corner {tcl_safe(corner, 'XTop corner')}",
                f"set libs [lsort [glob -nocomplain \"{liberty_glob}\"]]",
                f"if {{[llength $libs] == 0}} {{ error \"no Liberty for {tcl_quote(corner)}\" }}",
                f"link_timing_library -corner {tcl_safe(corner, 'XTop corner')} -search_type min_max $libs",
            ])
    if set(scenario_map) != set(required):
        raise core.AtcsError(
            "invalid-input",
            f"xtopContext scenario mismatch; required={list(required)}, configured={list(scenario_map)}",
        )
    lines.append("create_mode func")
    for name in required:
        corner = scenario_map[name]["corner"]
        lines.append(
            f"create_scenario -corner {tcl_safe(corner, 'XTop corner')} -mode func {tcl_safe(name, 'XTop scenario')}"
        )

    list_fields = ("bufferListForHold", "bufferListForSetup", "cellNominalSwapKeywords")
    for field in list_fields:
        value = eco.get(field)
        if not isinstance(value, list) or not value or not all(isinstance(x, str) for x in value):
            raise core.AtcsError("invalid-input", f"xtopContext.ecoParameters.{field} must be a non-empty string list")
    for field in ("cellClassifyRule", "cellMatchAttribute", "cellNominalSizingPattern"):
        if not isinstance(eco.get(field), str) or not eco[field]:
            raise core.AtcsError("invalid-input", f"xtopContext.ecoParameters.{field} must be a non-empty string")
    if isinstance(eco.get("gainThreshold"), bool) or not isinstance(eco.get("gainThreshold"), (int, float)):
        raise core.AtcsError("invalid-input", "xtopContext.ecoParameters.gainThreshold must be numeric")
    return {
        "libraryTcl": "\n".join(lines) + "\n", "libraryFiles": library_files,
        "siteMap": list(site_map), "removableFillers": list(fillers), "ecoParameters": dict(eco),
    }


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
    if inputs.get("staData"):
        env["STA_DATA"] = inputs["staData"]

    tcl = compile_task("pt-scenario.tcl", env=env)
    reports = {name: str(report_dir / name) for name in
               ("global_timing.rpt", "setup.rpt", "hold.rpt", "check_timing.rpt")}
    return {
        "scenario": scenario, "tcl": tcl, "env": env, "reportDir": str(report_dir), "reports": reports,
        "command": ["pt_shell", "-f"],
    }


def compile_pt_scenario_tasks(query_spec, scenario_inputs, report_root):
    """Compile exactly the scenario set declared by ``query_spec``."""
    required = core.required_scenarios((query_spec or {}).get("requiredScenarios"))
    if not isinstance(scenario_inputs, dict):
        raise core.AtcsError("missing-input", "scenario_inputs must be an object keyed by scenario")
    missing = [scenario for scenario in required if scenario not in scenario_inputs]
    extra = sorted(set(scenario_inputs) - set(required))
    if missing or extra:
        raise core.AtcsError(
            "missing-input", f"scenario input mismatch; missing={missing}, extra={extra}",
        )
    tasks = {}
    for scenario in required:
        tasks[scenario] = compile_pt_scenario_task(scenario, scenario_inputs[scenario], report_root, query_spec)
    return tasks


# ---------------------------------------------------------------------------
# PrimeTime: targeted recheck / residual-evidence query (`risk`/`residual`)
# ---------------------------------------------------------------------------


_QUERY_TARGET_MODES = ("setup", "hold")


def compile_pt_query_task(inputs, report_root, targets, pba=False):
    """One `pt-query.tcl` task querying every `{"checkKey","startpoint","endpoint","mode"}`
    in `targets`.

    C4 (final review): `inputs` gains the same optional
    `libGlob`/`driverLibrary`/`originalDriverLibrary` triple
    `compile_pt_scenario_task`/`compile_pt_presta_task` accept -- confirmed by
    reading `pt-query.tcl`'s pre-fix body directly, it never set
    `target_library`/`link_path` either, so its own `link_design` (used by
    both `residual` and `sta`'s bounded parent-violator recheck) had no cell
    library to resolve references against for a real netlist.

    N4 (final fix batch C): every target now carries its own `"mode"`
    (`"setup"` or `"hold"`) -- `pt-query.tcl` emits `-delay_type max` for a
    setup target and `min` for a hold one, so a hold check's own targeted
    query never silently reports its setup-side slack instead (PT's own
    `-delay_type` default is `max`). `pba` (default `False`, matching this
    Pack's own `precision: gba` default) sets `PBA_MODE` the same way
    `compile_pt_scenario_task`'s own `query_spec["precision"]` does, so a
    caller observing at PBA precision re-queries at that same precision
    here too.
    """
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
        mode = target.get("mode")
        if mode not in _QUERY_TARGET_MODES:
            raise core.AtcsError(
                "missing-input",
                f"pt-query target for {target.get('checkKey')!r} must carry mode in "
                f"{_QUERY_TARGET_MODES}, got {mode!r}",
            )
        # I7 (final review): each target is one nested brace group inside the outer
        # ATCS_QUERY_TARGETS list below, so a bus-bit startpoint/endpoint (`bus[3]`)
        # is safe here (`allow_brackets=True`).
        startpoint = tcl_safe(target["startpoint"], "startpoint", allow_brackets=True)
        endpoint = tcl_safe(target["endpoint"], "endpoint", allow_brackets=True)
        tcl_targets.append("{" + f"{startpoint} {endpoint} {mode} {name}" + "}")

    env = {
        "DESIGN": inputs["design"], "NETLIST": inputs["netlist"], "INPUT_SDC": inputs["sdc"],
        "SPEF": inputs["spef"], "REPORT_ROOT": str(report_root), "PBA_MODE": "1" if pba else "0",
    }
    if inputs.get("libGlob"):
        env["LIB_GLOB"] = inputs["libGlob"]
    if inputs.get("driverLibrary") and inputs.get("originalDriverLibrary"):
        env["DRIVER_LIBRARY"] = inputs["driverLibrary"]
        env["ORIGINAL_DRIVER_LIBRARY"] = inputs["originalDriverLibrary"]
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


_QUERY_SLACK_RE = re.compile(
    r"(?m)^\s*slack\s*\((?P<verdict>MET|VIOLATED)(?P<annotation>[^)]*)\)\s+(?P<value>-?[0-9.eE+]+)"
)


def parse_query_slack(text):
    """The single targeted path's own slack Measure from a `pt-query.tcl` `report_timing`
    report (I5, final review: fixed count via a bounded parent-violator recheck).

    `atcs_cli._cmd_sta`'s bounded recheck feeds this straight into `atcs.state.
    compare_checks`'s own `recheck` parameter -- a plain `{checkKey: Measure}` map
    (slack sign only, no separate `violated` fact of its own, per `compare_checks`'s
    own docstring). Unlike `atcs.reports.parse_path_report` (which, via `-slack_lesser_
    than 0.0`, only ever sees rows PT itself already classified `VIOLATED`), this
    template's own single targeted-path query has no such filter and may report either
    verdict: `MET` (a check that is now genuinely fixed) or `VIOLATED` (still failing).
    A precision-limited row (PT's own "increase significant digits" annotation, either
    verdict) leaves the displayed number untrustworthy at this precision -- `unknown`,
    never guessed from the sign alone, the same rule `parse_path_report` already
    applies to a violated path's own slack. Returns `unknown` when no slack line could
    be parsed at all (a malformed or empty report).
    """
    match = _QUERY_SLACK_RE.search(text)
    if not match:
        return core.unknown("no slack line parsed")
    if match.group("annotation"):
        return core.unknown("precision-limited: re-query with more significant digits")
    try:
        value = float(match.group("value"))
    except ValueError:
        return core.unknown(f"unparsable-value: {match.group('value')!r}")
    if math.isnan(value) or math.isinf(value):
        return core.unknown(f"non-finite-value: {match.group('value')!r}")
    return core.known(value)


# ---------------------------------------------------------------------------
# PrimeTime: presta pre-check (`presta`)
# ---------------------------------------------------------------------------


def compile_pt_presta_task(scenario, inputs, report_root):
    """One `pt-presta.tcl` task -- see module docstring and `pt-presta.tcl` for scope.

    C4 (final review, per-scenario library identity): `inputs` gains the same
    optional `libGlob`/`driverLibrary`/`originalDriverLibrary` triple
    `compile_pt_scenario_task` accepts. `pt-presta.tcl` never actually set
    `target_library`/`link_path` before this fix -- a real PT session's own
    `link_design` for the not-yet-implemented candidate netlist would have
    had no cell library to resolve references against at all (confirmed by
    reading the template's own pre-fix body, which jumps straight from
    `read_verilog`/`current_design` to `link_design` with no
    `target_library`/`link_path` in between). When `inputs` carries the
    library triple, it is filled the same way `pt-scenario.tcl` fills it.
    """
    validate_path_segment(scenario, "scenario")
    for key in ("design", "netlist", "sdc", "spef"):
        if not inputs.get(key):
            raise core.AtcsError("missing-input", f"presta inputs for {scenario!r} are missing {key!r}")
    validate_path_segment(inputs["design"], "design")
    env = {
        "DESIGN": inputs["design"], "NETLIST": inputs["netlist"], "INPUT_SDC": inputs["sdc"],
        "SPEF": inputs["spef"], "SCENARIO": scenario, "REPORT_ROOT": str(report_root),
    }
    if inputs.get("libGlob"):
        env["LIB_GLOB"] = inputs["libGlob"]
    if inputs.get("driverLibrary") and inputs.get("originalDriverLibrary"):
        env["DRIVER_LIBRARY"] = inputs["driverLibrary"]
        env["ORIGINAL_DRIVER_LIBRARY"] = inputs["originalDriverLibrary"]
    tcl = compile_task("pt-presta.tcl", env=env)
    return {"tcl": tcl, "env": env, "globalTiming": str(Path(report_root) / scenario / "global_timing.rpt")}


_SPEF_NAME_MAP_SECTION_RE = re.compile(r"(?ms)^\*NAME_MAP\s*\n(.*?)(?=^\*[A-Za-z_]|\Z)")
_SPEF_NAME_MAP_ENTRY_RE = re.compile(r"^\*(\d+)\s+(\S+)", re.MULTILINE)
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

    Entries are read only from inside the actual ``*NAME_MAP`` section (up
    to the next top-level, letter-led ``*SECTION`` header, e.g. ``*PORTS``
    or ``*D_NET``), never from the whole file — a real SPEF's ``*PORTS``
    section reuses the identical ``*<index> <token>`` line shape for a
    completely different purpose (``*<index> I``/``O``/``B`` for a port's
    direction, not a name), confirmed by streaming a real, *unfiltered*
    ~200,000-line prefix of a real Foundation SPEF directly into an earlier,
    whole-file version of this parser: it collided a `*NAME_MAP` entry
    (``*98784 clk``) with a same-indexed ``*PORTS`` direction line
    (``*98784 I``) as though they were the same declaration
    (``docs/assessment/2026-09-26/atcs-qualification/corpus-preflight.md``
    records this real-corpus find). Scoping the scan to the bounded
    ``*NAME_MAP`` section is what makes the conflict check below sound —
    without it, every real SPEF's own `*PORTS` section would spuriously
    "conflict" with `*NAME_MAP` for every port.

    Two ``*NAME_MAP`` lines (within that bounded section) for the *same*
    index that name two *different* nets are a genuine identity conflict
    (the alias no longer refers to one net) and raise
    ``AtcsError("spef-name-map-conflict", ...)`` — never silently resolved
    by "last one wins". The same index repeated with the *identical* name
    (a harmless, redundant line) is tolerated.
    """
    if text is None:
        return None
    name_map = {}
    for section_match in _SPEF_NAME_MAP_SECTION_RE.finditer(text):
        for index, name in _SPEF_NAME_MAP_ENTRY_RE.findall(section_match.group(1)):
            key = f"*{index}"
            existing = name_map.get(key)
            if existing is not None and existing != name:
                raise core.AtcsError(
                    "spef-name-map-conflict",
                    f"NAME_MAP index {key} maps to both {existing!r} and {name!r}",
                )
            name_map[key] = name
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


def compile_innovus_eco_task(merge_commit, current_db_path, design, output_root, eco_root=None):
    """One Innovus ECO task: restore, apply the batch's ECO, `ecoRoute`, export under `output_root`.

    A recipe batch's merge commit carries ``eco``: the chosen `write_design_changes -keep_route`
    pair ``{"netlist"|"physical": {"path", "sha256"}}`` (paths relative to `eco_root`, the
    campaign workspace). Then the task is `innovus-eco-pair.tcl` -- `source` the netlist file,
    `source` the physical file, the frozen serial flow's `setNanoRouteMode -routeWithEco true ...`
    and `ecoRoute` (`packs/xtop-timing-closure/flow/templates/apply-eco.tcl`) -- and it returns
    ``ecoCopies``: the caller copies each file into ``<output_root>/eco/`` after checking its
    sha256, so Innovus sources the exact bytes the batch sealed.

    Without ``eco``, the task is today's: `innovus-eco.tcl` sources `merge_commit["innovusEcoTcl"]`
    written to ``<output_root>/eco.tcl`` (byte-identical output). Raises `AtcsError("missing-input",
    ...)` when the merge commit carries neither. `output_root` is expected to be
    ``implementations/<mergeId>/`` (architecture Sec.13.4) -- every output path this function
    returns is computed under it, never elsewhere.
    """
    validate_path_segment(design, "design")
    if merge_commit.get("eco") is not None:
        return _compile_innovus_eco_pair_task(merge_commit["eco"], current_db_path, design, output_root, eco_root)
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


def _innovus_outputs(output_root, design):
    return {
        "database": str(output_root / "DBS" / f"{design}.enc"),
        "def": str(output_root / "EXPORT" / "design.def"),
        "netlist": str(output_root / "EXPORT" / "design.v"),
        "drc": str(output_root / "RPT" / "verify_drc.rpt"),
        "connectivity": str(output_root / "RPT" / "verify_connectivity.rpt"),
    }


def _compile_innovus_eco_pair_task(eco, current_db_path, design, output_root, eco_root):
    output_root = Path(output_root)
    copies = []
    for role in ("netlist", "physical"):
        ref = eco.get(role) if isinstance(eco, dict) else None
        if (not isinstance(ref, dict) or not isinstance(ref.get("path"), str) or not ref["path"]
                or not isinstance(ref.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", ref["sha256"])):
            raise core.AtcsError("missing-input", f"merge commit eco.{role} must be {{path, sha256}}")
        source = Path(ref["path"])
        if not source.is_absolute():
            if eco_root is None:
                raise core.AtcsError("missing-input", f"eco.{role} path is relative and no eco_root was given")
            source = Path(eco_root) / source
        copies.append({"role": role, "from": str(source), "to": str(output_root / "eco" / f"{role}.tcl"),
                       "sha256": ref["sha256"]})
    env = {
        "CURRENT_DB": str(current_db_path), "DESIGN": design,
        "NETLIST_ECO": copies[0]["to"], "PHYSICAL_ECO": copies[1]["to"], "OUTPUT_ROOT": str(output_root),
    }
    tcl = compile_task("innovus-eco-pair.tcl", env=env)
    return {
        "tcl": tcl, "env": env, "ecoCopies": copies, "outputs": _innovus_outputs(output_root, design),
        "command": ["innovus", "-batch", "-files"],
    }


# ---------------------------------------------------------------------------
# XTop: typed Operator session (worker manual analysis) and deterministic replay
# ---------------------------------------------------------------------------


def _xtop_task_context(xtop_context):
    """Return the shared worker/replay env and globals from one verified receipt."""
    context = xtop_context if isinstance(xtop_context, dict) else {}
    library = context.get("libraryTcl") or {}
    timing = context.get("staData") or {}
    eco = context.get("ecoParameters") or {}
    for label, ref in (("libraryTcl", library), ("staData", timing)):
        if not isinstance(ref, dict) or not isinstance(ref.get("path"), str) or not ref["path"]:
            raise core.AtcsError("missing-input", f"xtop context {label}.path")
    site_map = context.get("siteMap")
    fillers = context.get("removableFillers")
    if not isinstance(site_map, list) or not site_map:
        raise core.AtcsError("missing-input", "xtop context siteMap")
    if not isinstance(fillers, list) or not fillers:
        raise core.AtcsError("missing-input", "xtop context removableFillers")
    if set(eco) != _XTOP_ECO_FIELDS:
        raise core.AtcsError("missing-input", "xtop context ecoParameters")
    env = {
        "LIBRARY_TCL": library["path"], "STA_DATA": timing["path"],
        "ECO_CELL_CLASSIFY_RULE": eco["cellClassifyRule"],
        "ECO_CELL_MATCH_ATTRIBUTE": eco["cellMatchAttribute"],
        "ECO_CELL_NOMINAL_SIZING_PATTERN": eco["cellNominalSizingPattern"],
        "ECO_GAIN_THRESHOLD": str(eco["gainThreshold"]),
    }
    globals_ = {
        "XTOP_SITE_MAP": site_map, "XTOP_REMOVABLE_FILLERS": fillers,
        "XTOP_ECO_BUFFER_LIST_FOR_HOLD": eco["bufferListForHold"],
        "XTOP_ECO_BUFFER_LIST_FOR_SETUP": eco["bufferListForSetup"],
        "XTOP_ECO_CELL_NOMINAL_SWAP_KEYWORDS": eco["cellNominalSwapKeywords"],
    }
    return env, globals_


def compile_xtop_operator_task(workspace_manifest, design, tech_lef, cell_lef_glob, netlist, def_path,
                                output_root, xtop_context):
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
    context_env, context_globals = _xtop_task_context(xtop_context)
    env.update(context_env)
    tcl_path = output_root / "operator.tcl"
    tcl = compile_task("xtop-operator.tcl", env=env, globals_=context_globals)
    argv = ["xtop", "-f", str(tcl_path), name_prefix]
    return {"tcl": tcl, "env": env, "tclPath": str(tcl_path), "argv": argv, "ecoPrefix": eco_prefix}


def _operator_regions(edit_domain):
    """`editDomain.regions` (``[[x1, y1, x2, y2], ...]``, `core.region_box`) or refuse."""
    regions = []
    for region in (edit_domain or {}).get("regions") or []:
        if core.region_box(region) is None:
            raise core.AtcsError("invalid-input", f"editDomain region must be [x1, y1, x2, y2] with x1<=x2, y1<=y2: "
                                                  f"{region!r}")
        regions.append(list(region))
    return regions


REGION_MARGIN_ROWS = 4
"""A derived edit region reaches this many placement rows around a plan instance's origin (#64 attempt 5)."""

_REGION_FALLBACK_MARGIN_UM = 2.5


def _def_statements(handle):
    """Yield each `;`-terminated DEF statement's tokens, from the start up to `END COMPONENTS`."""
    tokens = []
    for line in handle:
        stripped = line.strip()
        if stripped.startswith("END COMPONENTS"):
            return
        if not stripped or stripped.startswith("#"):
            continue
        for token in stripped.split():
            if token == ";":
                yield tokens
                tokens = []
            elif token.endswith(";"):
                tokens.append(token[:-1])
                yield tokens
                tokens = []
            else:
                tokens.append(token)


def def_instance_regions(def_path, instances, margin_rows=REGION_MARGIN_ROWS):
    """One ``[x1, y1, x2, y2]`` box (microns) per placed instance of `instances`, in their order.

    #64 attempt 5: a plan that gives an active slot no `editDomain.regions` gets one box around each
    of its plan instances' origins in the base DEF, `margin_rows` placement rows (the smallest
    distance between two ROW origins) on every side, so `atcs_move_cell` and `atcs_insert_dummy` can
    act locally. Names compare with DEF escapes removed (``reg\\[3\\]`` is ``reg[3]``). An instance
    the DEF does not place gets no box. Reads the DEF once and stops at ``END COMPONENTS``.
    """
    wanted = {name.replace("\\", ""): name for name in instances if isinstance(name, str)}
    units, rows, placed = None, set(), {}
    in_components = False
    with open(def_path, "r", encoding="utf-8", errors="replace") as handle:
        for tokens in _def_statements(handle):
            if not tokens:
                continue
            head = tokens[0]
            if head == "UNITS" and len(tokens) >= 4 and tokens[1] == "DISTANCE":
                units = float(tokens[3])
            elif head == "ROW" and len(tokens) >= 6:
                try:
                    rows.add(float(tokens[4]))
                except ValueError:
                    pass
            elif head == "COMPONENTS":
                in_components = True
            elif in_components and head == "-" and len(tokens) >= 2:
                name = tokens[1].replace("\\", "")
                if name not in wanted:
                    continue
                for index, token in enumerate(tokens):
                    if token in ("PLACED", "FIXED", "COVER") and index + 4 < len(tokens) and tokens[index + 1] == "(":
                        try:
                            placed[name] = (float(tokens[index + 2]), float(tokens[index + 3]))
                        except ValueError:
                            pass
                        break
    if not units or units <= 0:
        return []
    ys = sorted(rows)
    pitches = [b - a for a, b in zip(ys, ys[1:]) if b > a]
    margin = (min(pitches) / units) * margin_rows if pitches else _REGION_FALLBACK_MARGIN_UM
    boxes = []
    for name in wanted:
        if name in placed:
            x, y = placed[name][0] / units, placed[name][1] / units
            boxes.append([round(x - margin, 4), round(y - margin, 4), round(x + margin, 4), round(y + margin, 4)])
    return boxes


LOCAL_FANOUT_MAX = 12
"""A net with more leaf pins than this is global (clock, reset, scan enable): the local-topology
domain (#64 attempt 5) never takes it, nor the cells on it."""


def compile_xtop_analysis_manual_task(workspace_manifest, edit_domain, operator_tcl_path, ops_log_path,
                                      target_pins=None, *, max_mutations, observe=None, local_topology=False,
                                      fanout_max=LOCAL_FANOUT_MAX):
    """One `xtop-analysis-manual.tcl` task binding one worker's edit domain and budget for its whole session.

    `edit_domain`: ``{"instances", "nets", "regions"}`` (a work package's own
    `editDomain`); regions bound `atcs_move_cell` targets. `target_pins`: the
    work package's `targetPins` -- with the pins of domain instances, the only
    pins `atcs_fix_*_pins` may name in `-only_pins`. `max_mutations`: the work
    package's `scope.maxMutations` (1..`workspaces.SCOPE_MAX_MUTATIONS`), the
    Tcl-side mutation budget that backs the Host's scope count. `observe`: ``"fast"`` (default; XTop ECO
    bookkeeping plus the domain's own objects) or ``"full"`` (adds whole-design
    cell and net snapshots per mutation, for cross-checking the fast path). All
    are baked as Tcl list literals (`::EDIT_DOMAIN_*`, `::ATCS_MAX_MUTATIONS`,
    `::ATCS_OBSERVE`) above the template text and are never re-read or widened
    mid-session.

    `local_topology` (#64 attempt 5; `prepare-workers` sets it for every active slot): the session
    widens the domain once, before its ready line, to its blockers' local topology -- the nets of
    the target pins and of every pin of the plan's instances, and the leaf cells on those nets, one
    hop, leaving out a net with more than `fanout_max` leaf pins -- and writes it to `domain.json`
    beside the ops log (`xtop-operator.tcl`, `atcs_derive_local_domain`).
    """
    name_prefix = workspace_manifest.get("namePrefix")
    if not name_prefix:
        raise core.AtcsError("missing-input", "workspace manifest has no namePrefix")
    cap = workspaces_module.SCOPE_MAX_MUTATIONS
    if isinstance(max_mutations, bool) or not isinstance(max_mutations, int) or not 1 <= max_mutations <= cap:
        raise core.AtcsError("invalid-input", f"maxMutations must be an integer 1..{cap}, got {max_mutations!r}")
    if observe is None:
        observe = "fast"
    if observe not in workspaces_module.OBSERVE_MODES:
        raise core.AtcsError("invalid-input",
                             f"observe must be one of {workspaces_module.OBSERVE_MODES}, got {observe!r}")
    instances = list((edit_domain or {}).get("instances") or [])
    nets = list((edit_domain or {}).get("nets") or [])
    regions = _operator_regions(edit_domain)
    pins = list(target_pins or [])
    globals_ = {
        "EDIT_DOMAIN_INSTANCES": instances, "EDIT_DOMAIN_NETS": nets, "EDIT_DOMAIN_PINS": pins,
        "EDIT_DOMAIN_REGIONS": [repr(v) if isinstance(v, float) else str(v) for region in regions for v in region],
        "ATCS_MAX_MUTATIONS": [str(max_mutations)], "ATCS_OBSERVE": [observe],
    }
    if local_topology:
        if isinstance(fanout_max, bool) or not isinstance(fanout_max, int) or fanout_max < 2:
            raise core.AtcsError("invalid-input", f"fanout_max must be an integer >= 2, got {fanout_max!r}")
        globals_.update({"EDIT_DOMAIN_LOCAL": ["1"], "ATCS_LOCAL_FANOUT_MAX": [str(fanout_max)]})
    env = {"OPERATOR_TCL": str(operator_tcl_path), "OPS_LOG": str(ops_log_path), "NAME_PREFIX": name_prefix}
    tcl = compile_task("xtop-analysis-manual.tcl", env=env, globals_=globals_)
    return {
        "tcl": tcl, "env": env, "editDomain": {"instances": instances, "nets": nets, "regions": regions},
        "targetPins": pins, "maxMutations": max_mutations, "observe": observe, "localTopology": bool(local_topology),
    }


def compile_xtop_replay_task(design, tech_lef, cell_lef_glob, netlist, def_path, steps, output_root,
                             xtop_context):
    """One legacy `xtop-replay-steps.tcl` batch-replay task for `steps` (a `replay-request.steps` list).

    I3 (final review, XTop replay source): builds its own fresh XTop workspace
    from the batch's own base-state LEF/netlist/DEF -- `create_workspace` +
    `link_reference_library` + `create_design_definition` + `import_designs`,
    the same shape `compile_xtop_operator_task` uses for a worker session --
    never `open_workspace` on an Innovus `.enc` restore script (confirmed by
    reading the pre-fix template directly: `open_workspace` opens a
    previously-*saved XTop* workspace, not an Innovus checkpoint, so the old
    call could never actually have opened anything real). No STA data or
    timing library is needed here: replay only ever performs structural
    edits (`size_cell`/`insert_buffer`/`delete_buffer`) and reads back plain
    cell/master names, never a timing query.

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
        "DESIGN": design, "TECH_LEF": tech_lef, "CELL_LEF_GLOB": cell_lef_glob,
        "NETLIST": netlist, "DEF": def_path if def_path else "",
        "STEPS_TCL": str(steps_path), "DUMP_DIR": str(dump_dir), "RECEIPTS_LOG": str(receipts_log),
    }
    context_env, context_globals = _xtop_task_context(xtop_context)
    env.update(context_env)
    tcl = compile_task("xtop-replay-steps.tcl", env=env, globals_=context_globals)
    return {
        "tcl": tcl, "env": env, "stepsPath": str(steps_path), "stepsText": steps_text,
        "dumpDir": str(dump_dir), "receiptsLog": str(receipts_log),
    }


def read_replay_receipts(receipts_log_path):
    """Turn `xtop-replay-steps.tcl`'s `receipts.jsonl` into `atcs.integration.reconcile`'s `receipts` shape.

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
# XTop: the generation's one recipe replay, two arms (Issue #64 Task 6)
# ---------------------------------------------------------------------------


REPLAY_ARMS = integration_module.ARMS


def _recipe_tcl(request):
    """The merged arm's RECIPE_TCL: per ranked session, enter its own domain and prefix, run
    its commands, then dump."""
    lines = []
    for session in request.get("sessions") or []:
        slot = tcl_safe(session["slot"], "recipe slot")
        prefix = tcl_safe(session["namePrefix"], "session namePrefix")
        domain = session.get("domain") or {}
        regions = [repr(v) if isinstance(v, float) else str(v)
                   for region in _operator_regions({"regions": domain.get("regions") or []}) for v in region]
        lines.append(
            f"atcs_replay_session {{{slot}}} {{{prefix}}} "
            f"{tcl_list_literal(domain.get('instances') or [], 'session instances')} "
            f"{tcl_list_literal(domain.get('nets') or [], 'session nets')} "
            f"{tcl_list_literal(domain.get('pins') or [], 'session pins')} "
            f"{tcl_list_literal(regions, 'session regions')}\n"
        )
        for step in request.get("steps") or []:
            if step["slot"] != session["slot"]:
                continue
            step_id = tcl_safe(step["stepId"], "stepId")
            if step.get("skip") is not None or not step.get("tcl"):
                lines.append(f"atcs_replay_step {{{step_id}}} 1 {{}}\n")
            else:
                lines.append(f"atcs_replay_step {{{step_id}}} 0 {{{step['tcl']}}}\n")
        lines.append(f"atcs_replay_session_end {int(session['dumpIndex'])}\n")
    return "".join(lines)


def compile_recipe_replay_task(design, tech_lef, cell_lef_glob, netlist, def_path, request, output_root,
                               xtop_context):
    """Both arms of one recipe `replay-request` (`atcs.integration.prepare_recipe_replay`).

    Each arm is ``<output_root>/<arm>/``: `xtop-replay.tcl` (the worker session's own
    `xtop-operator.tcl` setup and toolkit, then `templates/xtop-replay.tcl`), `recipe.tcl`,
    `auto-fix.tcl`, and after the run `receipts.jsonl`, `ops.jsonl`/`gain.jsonl` (merged),
    `dumps/`, `predict/`, `arm-result.json` and the ECO pair under `eco/` (merged) or
    `eco-control/` (control). In the merged arm each session's commands run inside that
    session's own edit domain (set per session by `atcs_replay_session`), with a budget of one
    mutation per sendable command; the control arm has an empty recipe and domain. Nothing
    here launches XTop.
    """
    validate_path_segment(design, "design")
    if request.get("mode") != "recipe":
        raise core.AtcsError("identity-mismatch", "compile_recipe_replay_task needs a recipe replay-request")
    output_root = Path(output_root)
    context_env, context_globals = _xtop_task_context(xtop_context)
    sendable = sum(1 for step in request.get("steps") or [] if step.get("skip") is None and step.get("tcl"))
    auto_prefix = tcl_safe(request.get("autoPrefix"), "autoPrefix")
    arms = {}
    for arm in REPLAY_ARMS:
        root = output_root / arm
        globals_ = {"EDIT_DOMAIN_INSTANCES": [], "EDIT_DOMAIN_NETS": [], "EDIT_DOMAIN_PINS": [],
                    "EDIT_DOMAIN_REGIONS": []}
        if arm == "merged":
            globals_["ATCS_MAX_MUTATIONS"] = [str(max(1, sendable))]
            recipe_text = _recipe_tcl(request)
            auto_lines = list(request.get("autoFinishTcl") or [])
        else:
            globals_["ATCS_MAX_MUTATIONS"] = ["1"]
            recipe_text = ""
            auto_lines = list(request.get("controlTcl") or [])
        globals_.update({"ATCS_OBSERVE": ["fast"], "ATCS_ARM": [arm]})
        globals_.update(context_globals)
        paths = {
            "tclPath": root / "xtop-replay.tcl", "recipePath": root / "recipe.tcl",
            "autoFixPath": root / "auto-fix.tcl", "receiptsLog": root / "receipts.jsonl",
            "dumpDir": root / "dumps", "predictDir": root / "predict", "armResult": root / "arm-result.json",
            "ecoDir": root / integration_module.ECO_DIRS[arm], "logPath": root / "xtop-replay.log",
        }
        env = {
            "DESIGN": design, "TECH_LEF": tech_lef, "CELL_LEF_GLOB": cell_lef_glob,
            "NETLIST": netlist, "DEF": def_path if def_path else "", "RUN_ROOT": str(root),
            "ECO_PREFIX": f"{auto_prefix}eco", "NAME_PREFIX": auto_prefix, "OPS_LOG": str(root / "ops.jsonl"),
            "RECIPE_TCL": str(paths["recipePath"]), "AUTO_FIX_TCL": str(paths["autoFixPath"]),
            "AUTO_PREFIX": auto_prefix, "RECEIPTS_LOG": str(paths["receiptsLog"]),
            "DUMP_DIR": str(paths["dumpDir"]), "PREDICT_DIR": str(paths["predictDir"]),
            "ARM_RESULT": str(paths["armResult"]),
            "FAIL_REASON_TOP_N": str(request.get("failReasonTopN") or integration_module.FAIL_REASON_TOP_N),
        }
        env.update(context_env)
        tcl = compile_task("xtop-operator.tcl", env=env, globals_=globals_) + "\n" + load_template("xtop-replay.tcl")
        arm_task = {key: str(value) for key, value in paths.items()}
        arm_task.update({
            "root": str(root), "tcl": tcl, "env": env, "recipeText": recipe_text,
            "autoFixText": "".join(line + "\n" for line in auto_lines),
            "argv": ["xtop", "-f", str(paths["tclPath"])],
        })
        arms[arm] = arm_task
    return {"arms": arms}


def _read_dump(path):
    path = Path(path)
    if not path.is_file():
        return None
    return contributions_module.parse_cell_dump(path.read_text(encoding="utf-8"))


def read_replay_arm(arm_root, arm, request, workspace=None):
    """Read one finished (or failed) arm back for `atcs.integration.reconcile_recipe`.

    Returns ``{arm, result, receipts, badReceiptLines, sessionDeltas, autoDelta, totalDelta,
    predictText, failReasonText, eco, keptInstanceNets}`` (``failReasonText``: the
    ``predict/<check>-fail-reasons.rpt`` texts) (``keptInstanceNets``: each instance a kept merged-arm
    toolkit line created, with the nets that line created -- its logged ``newNets`` and requested
    ``args.newNets``; an empty list when it recorded none). Dump deltas come from the real cell dumps
    (`atcs.contributions.actual_delta`); ``eco`` lists every ``atcs_batch_netlist_*`` /
    ``atcs_batch_physical_*`` file with its path (relative to `workspace` when given), sha256
    and text. Anything absent reads as ``None``/empty -- `reconcile_recipe` decides what that
    means; this function never raises for missing evidence.
    """
    root = Path(arm_root)

    def rel(path):
        return _relative_to(path, workspace)

    result = None
    result_path = root / "arm-result.json"
    if result_path.is_file():
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
        except ValueError:
            result = None
    receipts, bad_lines = [], 0
    receipts_path = root / "receipts.jsonl"
    if receipts_path.is_file():
        for raw_line in receipts_path.read_text(encoding="utf-8").splitlines():
            if not raw_line.strip():
                continue
            try:
                row = json.loads(raw_line)
            except ValueError:
                bad_lines += 1
                continue
            if isinstance(row, dict):
                receipts.append(row)
            else:
                bad_lines += 1

    dump_dir = root / "dumps"
    base = _read_dump(dump_dir / "000.dump")
    previous = base
    session_deltas = {}
    for session in request.get("sessions") or [] if arm == "merged" else []:
        current = _read_dump(dump_dir / f"{int(session['dumpIndex']):03d}.dump")
        session_deltas[session["slot"]] = (
            contributions_module.actual_delta(previous, current) if previous is not None and current is not None
            else None
        )
        previous = current
    final = _read_dump(dump_dir / "auto.dump")
    auto_delta = contributions_module.actual_delta(previous, final) if previous is not None and final else None
    total_delta = contributions_module.actual_delta(base, final) if base is not None and final else None

    instance_nets = {}
    ops_path = root / "ops.jsonl"
    if arm == "merged" and ops_path.is_file():
        for raw_line in ops_path.read_text(encoding="utf-8").splitlines():
            try:
                line = json.loads(raw_line) if raw_line.strip() else None
            except ValueError:
                continue
            if not isinstance(line, dict) or line.get("status") != "kept" or line.get("cmd") == "undo":
                continue
            args = line.get("args") if isinstance(line.get("args"), dict) else {}
            nets = sorted({net for net in list(line.get("newNets") or []) + list(args.get("newNets") or [])
                           if isinstance(net, str) and net})
            before = ((line.get("before") or {}).get("instances") or {})
            after = ((line.get("after") or {}).get("instances") or {})
            for name, master in after.items():
                if master is not None and before.get(name, None) is None and name in before:
                    instance_nets[name] = sorted(set(instance_nets.get(name, [])) | set(nets))

    predict_text, fail_reason_text = {}, {}
    for check in ("setup", "hold"):
        path = root / "predict" / f"{check}.rpt"
        predict_text[check] = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else None
        path = root / "predict" / f"{check}-fail-reasons.rpt"
        fail_reason_text[check] = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else None

    eco_dir = root / integration_module.ECO_DIRS[arm]
    eco = {}
    for role in ("netlist", "physical"):
        eco[role] = []
        pattern = f"{integration_module.ECO_PREFIX}_{role}_*"
        for path in sorted(eco_dir.glob(pattern)) if eco_dir.is_dir() else []:
            if path.is_symlink() or not path.is_file():
                continue
            eco[role].append({"path": rel(path), "sha256": core.file_sha256(path),
                              "text": path.read_text(encoding="utf-8", errors="replace")})
    return {
        "arm": arm, "root": rel(root), "result": result, "receipts": receipts, "badReceiptLines": bad_lines,
        "sessionDeltas": session_deltas, "autoDelta": auto_delta, "totalDelta": total_delta,
        "predictText": predict_text, "failReasonText": fail_reason_text, "eco": eco,
        "keptInstanceNets": instance_nets,
    }


def _relative_to(path, workspace):
    if workspace is None:
        return str(path)
    try:
        return str(Path(path).resolve().relative_to(Path(workspace).resolve()))
    except ValueError:
        return str(path)


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
