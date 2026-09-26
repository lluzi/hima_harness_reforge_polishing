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

Gaps (fail-closed, reported per this task's brief)
-----------------------------------------------------

`parse_path_detail` (residual-evidence `cellDelay`/`netDelay`/`slew`/
`fanout`/`location` extraction from a targeted `pt-query.tcl` report) is a
best-effort parser of the standard PrimeTime ``report_timing -input_pins
-nets -transition_time -capacitance`` column layout. Unlike
`atcs.reports`'s parsers (ported from the old Pack's own tested fixtures),
no real report sample or upstream test fixture for this specific per-arc
breakdown was available to this task; every field this parser cannot
positively identify from a matching line is `unknown` with a reason, never
guessed, and this should be re-verified against a real report before this
Pack relies on it for a production residual case.
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
    for key in ("design", "netlist", "sdc", "spef"):
        if not inputs.get(key):
            raise core.AtcsError("missing-input", f"pt-scenario inputs for {scenario!r} are missing {key!r}")
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


_ARC_LINE_RE = re.compile(
    r"^(?P<name>\S+)(?:\s+\((?P<paren>[^)]*)\))?\s+"
    r"(?:(?P<fanout>\d+)\s+(?P<trans>[\d.]+)\s+(?P<cap>[\d.]+)\s+)?"
    r"(?P<incr>-?[\d.]+)\s+(?P<path>-?[\d.]+)\s*[rf]?\s*$"
)
_SKIP_NAMES = ("clock", "data", "input", "output")


def parse_path_detail(text):
    """Best-effort per-arc breakdown of one targeted `report_timing` path (see module docstring "Gaps").

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
    last_cell_name = None
    for raw_line in text.splitlines():
        match = _ARC_LINE_RE.match(raw_line.strip())
        if not match:
            continue
        name = match.group("name")
        if name.split("/")[0] in _SKIP_NAMES:
            continue
        is_net = match.group("paren") == "net"
        incr = float(match.group("incr"))
        if is_net:
            net_total += incr
            have_net = True
        else:
            cell_total += incr
            have_cell = True
            last_cell_name = name.split("/")[0]
        if match.group("trans"):
            worst_trans = max(worst_trans or 0.0, float(match.group("trans")))
        if match.group("fanout"):
            worst_fanout = max(worst_fanout or 0, int(match.group("fanout")))
    return {
        "cellDelay": core.known(cell_total) if have_cell else core.unknown("no cell arc parsed"),
        "netDelay": core.known(net_total) if have_net else core.unknown("no net arc parsed"),
        "slew": core.known(worst_trans) if worst_trans is not None else core.unknown("no transition column parsed"),
        "fanout": core.known(worst_fanout) if worst_fanout is not None else core.unknown("no fanout column parsed"),
        "location": core.known(last_cell_name) if last_cell_name else core.unknown("no cell instance parsed"),
    }


# ---------------------------------------------------------------------------
# PrimeTime: presta pre-check (`presta`)
# ---------------------------------------------------------------------------


def compile_pt_presta_task(scenario, inputs, report_root):
    """One `pt-presta.tcl` task -- see module docstring and `pt-presta.tcl` for scope."""
    for key in ("design", "netlist", "sdc", "spef"):
        if not inputs.get(key):
            raise core.AtcsError("missing-input", f"presta inputs for {scenario!r} are missing {key!r}")
    env = {
        "DESIGN": inputs["design"], "NETLIST": inputs["netlist"], "INPUT_SDC": inputs["sdc"],
        "SPEF": inputs["spef"], "SCENARIO": scenario, "REPORT_ROOT": str(report_root),
    }
    tcl = compile_task("pt-presta.tcl", env=env)
    return {"tcl": tcl, "env": env, "globalTiming": str(Path(report_root) / scenario / "global_timing.rpt")}


_SPEF_NET_RE = re.compile(r"^\*D_NET\s+(\S+)", re.MULTILINE)


def parse_spef_net_names(text):
    """Net names an SPEF text actually models, or `None` when unreadable.

    Feeds `atcs.verification.presta_qualification`'s `spef_net_names`
    argument directly (its own `None` case: "the SPEF's net-name list
    itself could not be read").
    """
    if text is None:
        return None
    return set(_SPEF_NET_RE.findall(text))


# ---------------------------------------------------------------------------
# StarRC extraction (`extract`)
# ---------------------------------------------------------------------------


def compile_starrc_task(design, corner, def_path, output_root, template_text=None):
    """One StarXtract command-file task for `corner`.

    Always allocates a fresh, private `STAR_DIRECTORY`
    (``<output_root>/starrc/<corner>/work``) -- raises
    `AtcsError("invalid-workspace", ...)` if that would coincide with the
    input DEF's own directory, so a StarRC run can never write into a
    read-only input's directory. `template_text` is the Site-supplied base
    command file for this corner (see `starrc.cmd`'s own docstring); the
    Pack's shipped `starrc.cmd` is used as a fallback when omitted.
    """
    output_root = Path(output_root)
    work_dir = output_root / "starrc" / corner / "work"
    cmd_path = output_root / "starrc" / corner / f"{corner}.cmd"
    spef_path = output_root / "starrc" / corner / f"{design}.{corner}.spef"
    def_path_obj = Path(def_path)
    if def_path_obj.parent.resolve() == work_dir.resolve():
        raise core.AtcsError("invalid-workspace", "StarRC work dir may not be the input DEF's own directory")

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
