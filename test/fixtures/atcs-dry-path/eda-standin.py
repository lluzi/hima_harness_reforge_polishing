#!/usr/bin/env python3
"""A local stand-in for the Site's `edaShell` in the ATCS dry path (Issues #63, #64). No EDA runs here.

The Pack launches every Innovus, StarRC, PrimeTime and XTop batch through
`site_profile["edaShell"] + [<one shell line>]` (`flow/atcs/adapters.py` `run_tool`). This script
is that prefix: `python3 eda-standin.py --config <json> '<shell line>'`. It reads the compiled task
file the Pack wrote, writes the report files that tool would have written at the paths the Pack
will read back, and appends one JSON line per invocation to the log the config names.

Report text comes from the Pack's own synthetic generators (`flow/tests/fixtures.py`), in the
grammar `atcs.reports`/`atcs.verification`/`atcs.adapters` parse. Nothing here is a timing,
extraction or physical result: the numbers are fixed by which netlist a task reads.

The design has six blocks u_a..u_f, each with leaf cells reg0 and reg1 (design/top.v). The stand-in
"database" (`*.enc`) is the netlist text itself, so an Innovus ECO restores it, applies every
`ecoChangeCell` of the ECO it sources, and saves it. Timing (the same model as xtop-standin.tcl):
the setup endpoint u_X/reg0/I of func_ssg_rcworst fails by 0.0500 ns while u_X/reg0 is BUFFD1BWP,
0.0300 ns at BUFFD2BWP, 0.0100 ns at BUFFD4BWP and 0.0050 ns at BUFFD8BWP; nothing else fails.

An XTop batch (the recipe replay, one process per arm) is the Pack's own rendered `xtop-replay.tcl`
run by `tclsh` over the in-memory XTop of xtop-standin.tcl, so the replayed kept commands, the
auto-finish lines and the exported ECO pair are the Pack's real Tcl over a stand-in design.
"""
import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

SETUP_SCENARIO = "func_ssg_rcworst"
SLACK_BY_MASTER = {"BUFFD1BWP": -0.0500, "BUFFD2BWP": -0.0300, "BUFFD4BWP": -0.0100, "BUFFD8BWP": -0.0050}
XTOP_STANDIN = Path(__file__).resolve().parent / "xtop-standin.tcl"


def tcl_env(task_text):
    """`set env(NAME) "value"` lines of a compiled task, unescaped (`adapters.tcl_quote`)."""
    env = {}
    for match in re.finditer(r'(?m)^set env\((\w+)\) "((?:[^"\\]|\\.)*)"$', task_text):
        env[match.group(1)] = re.sub(r"\\(.)", r"\1", match.group(2))
    return env


def netlist_cells(netlist_text):
    """Flattened `[(instance path, master)]` from a structural netlist, walked from `top`."""
    modules, current = {}, None
    for line in netlist_text.splitlines():
        stripped = line.strip()
        head = re.match(r"module\s+(\w+)", stripped)
        if head:
            current = modules.setdefault(head.group(1), [])
            continue
        if stripped.startswith("endmodule"):
            current = None
            continue
        inst = re.match(r"(\w+)\s+(\w+)\s*\(", stripped)
        if current is not None and inst and inst.group(1) not in ("input", "output", "wire", "inout"):
            current.append((inst.group(2), inst.group(1)))

    def walk(module, prefix):
        for name, master in modules.get(module, []):
            if master in modules:
                yield from walk(master, f"{prefix}{name}/")
            else:
                yield f"{prefix}{name}", master
    return list(walk("top", ""))


def _leaf(netlist_text, instance_path):
    """`(start, end, master)` of the master token of the leaf cell `instance_path`, walked from `top`."""
    def block(module):
        return re.search(rf"(?ms)^module\s+{re.escape(module)}\b.*?^endmodule", netlist_text)
    *parents, leaf = instance_path.split("/")
    module = "top"
    for name in parents:
        module = re.search(rf"(?m)^\s*(\w+)\s+{re.escape(name)}\s*\(", block(module).group(0)).group(1)
    found = block(module)
    cell = re.search(rf"(?m)^\s*(\w+)\s+{re.escape(leaf)}\s*\(", found.group(0))
    if cell is None:
        raise SystemExit(f"stand-in cannot find {instance_path!r}")
    return found.start() + cell.start(1), found.start() + cell.end(1), cell.group(1)


def set_master(netlist_text, instance_path, master):
    """The netlist with the leaf `instance_path` resized to `master`."""
    start, end, _ = _leaf(netlist_text, instance_path)
    return netlist_text[:start] + master + netlist_text[end:]


def endpoint_slacks(netlist_path):
    """`{endpoint: slack}` of every failing setup endpoint of the netlist, worst first."""
    cells = dict(netlist_cells(Path(netlist_path).read_text(encoding="utf-8")))
    slacks = {f"{inst}/I": SLACK_BY_MASTER.get(master, -0.0500)
              for inst, master in cells.items() if re.fullmatch(r"u_[a-z]+/reg0", inst)}
    return dict(sorted(slacks.items(), key=lambda item: (item[1], item[0])))


def _ns(value):
    return f"{value:.4f}"


def pt_scenario(env, fixtures):
    scenario = env["SCENARIO"]
    out = Path(env["REPORT_ROOT"]) / scenario
    out.mkdir(parents=True, exist_ok=True)
    if scenario == SETUP_SCENARIO:
        slacks = endpoint_slacks(env["NETLIST"])
        glob = fixtures.global_report(_ns(min(slacks.values())), _ns(sum(slacks.values())), str(len(slacks)),
                                      "0.00", "0.00", "0")
        setup = fixtures.path_report([(endpoint, _ns(slack)) for endpoint, slack in slacks.items()], "setup")
    else:
        glob = fixtures.global_report("0.00", "0.00", "0", "0.00", "0.00", "0")
        setup = fixtures.path_report([], "setup")
    (out / "global_timing.rpt").write_text(glob, encoding="utf-8")
    (out / "setup.rpt").write_text(setup, encoding="utf-8")
    (out / "hold.rpt").write_text(fixtures.path_report([], "hold"), encoding="utf-8")
    (out / "check_timing.rpt").write_text(fixtures.check_timing_report(0), encoding="utf-8")
    if env.get("STA_DATA"):
        data = Path(env["STA_DATA"])
        data.mkdir(parents=True, exist_ok=True)
        (data / f"{scenario}_data_finish").write_text("stand-in timing data\n", encoding="utf-8")


def pt_query(env, task_text, fixtures):
    targets = re.search(r"(?m)^set ::ATCS_QUERY_TARGETS \{(.*)\}$", task_text)
    out = Path(env["REPORT_ROOT"])
    out.mkdir(parents=True, exist_ok=True)
    slacks = endpoint_slacks(env["NETLIST"])
    for startpoint, endpoint, mode, name in re.findall(r"\{(\S+) (\S+) (\S+) (\S+)\}", targets.group(1)):
        cell = endpoint.rsplit("/", 1)[0]
        detail = fixtures.path_detail_report([
            (endpoint, f"{cell}/Z", "BUFFD1BWP", 0.0100, 0.0050, 0.0120, 0.0400, "n1", 1, 0.0010),
        ])
        slack = slacks.get(endpoint, 0.0100)
        verdict = "VIOLATED" if slack < 0 else "MET"
        (out / f"{name}.rpt").write_text(
            f"  Startpoint: {startpoint}\n  Endpoint: {endpoint}\n  Path Type: {'max' if mode == 'setup' else 'min'}\n"
            f"{detail}  slack ({verdict})   {_ns(slack)}\n", encoding="utf-8")


def pt_presta(env, fixtures):
    out = Path(env["REPORT_ROOT"]) / env["SCENARIO"]
    out.mkdir(parents=True, exist_ok=True)
    slacks = endpoint_slacks(env["NETLIST"]) if env["SCENARIO"] == SETUP_SCENARIO else {}
    wns = _ns(min(slacks.values())) if slacks else "0.00"
    tns = _ns(sum(slacks.values())) if slacks else "0.00"
    (out / "global_timing.rpt").write_text(fixtures.global_report(wns, tns, str(len(slacks)), "0.00", "0.00", "0"),
                                           encoding="utf-8")


def innovus(env, task_name, fixtures):
    root = Path(env["OUTPUT_ROOT"])
    design = Path(env["CURRENT_DB"]).read_text(encoding="utf-8")
    # A recipe batch's pair task (innovus-eco-pair.tcl, written as innovus-eco.tcl) sources NETLIST_ECO.
    eco = env.get("NETLIST_ECO") or env.get("ECO_TCL")
    if task_name in ("innovus-eco.tcl", "innovus-eco-pair.tcl"):
        for instance, master in re.findall(r"ecoChangeCell -inst \{?([^\s{}]+)\}? -cell \{?([^\s{}]+)\}?",
                                           Path(eco).read_text(encoding="utf-8")):
            design = set_master(design, instance, master)
    for sub in ("RPT", "EXPORT", "DBS"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    (root / "RPT" / "verify_drc.rpt").write_text(fixtures.drc_report([]), encoding="utf-8")
    (root / "RPT" / "verify_connectivity.rpt").write_text(fixtures.connectivity_report([]), encoding="utf-8")
    (root / "EXPORT" / "design.v").write_text(design, encoding="utf-8")
    (root / "EXPORT" / "design.def").write_text(
        "VERSION 5.8 ;\nDESIGN top ;\n# stand-in DEF of the netlist beside it\nEND DESIGN\n", encoding="utf-8")
    if task_name in ("innovus-eco.tcl", "innovus-eco-pair.tcl"):
        enc = root / "DBS" / f"{env['DESIGN']}.enc"
        enc.write_text(design, encoding="utf-8")
        dat = root / "DBS" / f"{env['DESIGN']}.enc.dat"
        dat.mkdir(exist_ok=True)
        (dat / "stand-in.txt").write_text("stand-in Innovus database directory\n", encoding="utf-8")


def starxtract(cmd_path, fixtures):
    text = Path(cmd_path).read_text(encoding="utf-8")
    spef = Path(re.search(r"(?m)^NETLIST_FILE:\s*(\S+)", text).group(1))
    def_file = re.search(r"(?m)^TOP_DEF_FILE:\s*(\S+)", text).group(1)
    spef.parent.mkdir(parents=True, exist_ok=True)
    spef.write_text("*SPEF \"IEEE 1481-1999\"\n*DESIGN \"top\"\n"
                    f"// stand-in extraction of {def_file}\n"
                    + fixtures.spef_net_name_map_and_d_nets({1: "in_a", 2: "n_q"}, [(1, "0.0010"), (2, "0.0020")]),
                    encoding="utf-8")


def xtop_replay(task, log_path):
    """One replay arm: `tclsh` on the stand-in XTop, then the Pack's rendered replay Tcl, in the arm root."""
    script = task.parent / "xtop-standin-run.tcl"
    script.write_text(f"source {{{XTOP_STANDIN}}}\n" + task.read_text(encoding="utf-8"), encoding="utf-8")
    env = tcl_env(task.read_text(encoding="utf-8"))
    with open(Path(env["RUN_ROOT"]) / "xtop_log_1.txt", "a", encoding="utf-8") as transcript:
        result = subprocess.run(["tclsh", str(script)], cwd=env["RUN_ROOT"], stdout=transcript,
                                stderr=subprocess.STDOUT)
    if result.returncode != 0:
        raise SystemExit(f"stand-in xtop replay exited {result.returncode}; see {env['RUN_ROOT']}/xtop_log_1.txt")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("line")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    sys.path.insert(0, config["fixturesDir"])
    import fixtures  # noqa: E402 -- the Pack's own synthetic report generators

    words = shlex.split(args.line)
    while words and re.match(r"^[A-Z_]+=", words[0]):
        words.pop(0)
    tool = words[0]
    if tool == "pt_shell":
        task = Path(words[2])
    elif tool == "innovus":
        task = Path(words[words.index("-files") + 1])
    elif tool in ("StarXtract", "xtop"):
        task = Path(words[-1])
    else:
        raise SystemExit(f"stand-in answers innovus, StarXtract, pt_shell and xtop only, not {tool!r}")
    with open(config["log"], "a", encoding="utf-8") as log:
        log.write(json.dumps({"tool": tool, "task": task.name, "path": str(task)}) + "\n")

    if tool == "StarXtract":
        starxtract(task, fixtures)
    else:
        text = task.read_text(encoding="utf-8")
        env = tcl_env(text)
        if tool == "innovus":
            innovus(env, task.name, fixtures)
        elif tool == "xtop":
            xtop_replay(task, config["log"])
        elif task.name == "pt-scenario.tcl":
            pt_scenario(env, fixtures)
        elif task.name == "pt-query.tcl":
            pt_query(env, text, fixtures)
        elif task.name == "pt-presta.tcl":
            pt_presta(env, fixtures)
        else:
            raise SystemExit(f"stand-in has no PrimeTime answer for {task.name}")
    print(f"stand-in {tool} {task.name}: done")


if __name__ == "__main__":
    main()
