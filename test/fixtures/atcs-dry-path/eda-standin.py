#!/usr/bin/env python3
"""A local stand-in for the Site's `edaShell` in the ATCS dry path (Issue #63). No EDA runs here.

The Pack launches every Innovus, StarRC, PrimeTime and XTop batch through
`site_profile["edaShell"] + [<one shell line>]` (`flow/atcs/adapters.py` `run_tool`). This script
is that prefix: `python3 eda-standin.py --config <json> '<shell line>'`. It reads the compiled task
file the Pack wrote, writes the report files that tool would have written at the paths the Pack
will read back, and appends one JSON line per invocation to the log the config names.

Report text comes from the Pack's own synthetic generators (`flow/tests/fixtures.py`), in the
grammar `atcs.reports`/`atcs.verification`/`atcs.adapters` parse. Nothing here is a timing,
extraction or physical result: the numbers are fixed by which netlist a task reads.

The design has one leaf cell, `u_a/reg0`, under module `blk_a`. The stand-in "database" (`*.enc`)
is the netlist text itself, so an Innovus ECO restores it, applies `ecoChangeCell`, and saves it.
Timing: a netlist that still has `u_a/reg0` as `BUF1` (the baseline) fails setup by 0.0500 ns on the
setup scenario; once an ECO resized it, the refreshed STA still fails, by 0.0300 ns.
"""
import argparse
import json
import re
import shlex
import sys
from pathlib import Path

SETUP_SCENARIO = "func_ssg_rcworst"
ENDPOINT = "u_a/reg0/D"
STARTPOINT = "U_START_0"
BASELINE_SLACK = "-0.0500"
REFRESHED_SLACK = "-0.0300"


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


def set_master(netlist_text, instance_path, master):
    """The netlist with the leaf `instance_path` resized to `master` (single-level modules only)."""
    leaf = instance_path.rsplit("/", 1)[-1]
    updated, count = re.subn(rf"(?m)^(\s*)\w+(\s+{re.escape(leaf)}\s*\()", rf"\g<1>{master}\2", netlist_text)
    if count != 1:
        raise SystemExit(f"stand-in cannot resize {instance_path!r}")
    return updated


def slack_for(netlist_path):
    """The baseline slack while u_a/reg0 is still BUF1; the refreshed slack once an ECO resized it."""
    master = re.search(r"(?m)^\s*(\w+)\s+reg0\s*\(", Path(netlist_path).read_text(encoding="utf-8")).group(1)
    return BASELINE_SLACK if master == "BUF1" else REFRESHED_SLACK


def pt_scenario(env, fixtures):
    scenario = env["SCENARIO"]
    out = Path(env["REPORT_ROOT"]) / scenario
    out.mkdir(parents=True, exist_ok=True)
    if scenario == SETUP_SCENARIO:
        slack = slack_for(env["NETLIST"])
        glob = fixtures.global_report(slack, slack, "1", "0.00", "0.00", "0")
        setup = fixtures.path_report([(ENDPOINT, slack)], "setup")
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
    slack = slack_for(env["NETLIST"])
    for startpoint, endpoint, mode, name in re.findall(r"\{(\S+) (\S+) (\S+) (\S+)\}", targets.group(1)):
        detail = fixtures.path_detail_report([
            ("u_a/reg0/CP", "u_a/reg0/Q", "BUF1", 0.0100, 0.0050, 0.0120, 0.0400, "n_q", 1, 0.0010),
        ])
        verdict = "VIOLATED" if slack.startswith("-") else "MET"
        (out / f"{name}.rpt").write_text(
            f"  Startpoint: {startpoint}\n  Endpoint: {endpoint}\n  Path Type: {'max' if mode == 'setup' else 'min'}\n"
            f"{detail}  slack ({verdict})   {slack}\n", encoding="utf-8")


def pt_presta(env, fixtures):
    out = Path(env["REPORT_ROOT"]) / env["SCENARIO"]
    out.mkdir(parents=True, exist_ok=True)
    slack = slack_for(env["NETLIST"])
    (out / "global_timing.rpt").write_text(fixtures.global_report(slack, slack, "1", "0.00", "0.00", "0"), encoding="utf-8")


def innovus(env, task_name, fixtures):
    root = Path(env["OUTPUT_ROOT"])
    design = Path(env["CURRENT_DB"]).read_text(encoding="utf-8")
    if task_name == "innovus-eco.tcl":
        for instance, master in re.findall(r"ecoChangeCell -inst \{(\S+)\} -cell \{(\S+)\}",
                                           Path(env["ECO_TCL"]).read_text(encoding="utf-8")):
            design = set_master(design, instance, master)
    for sub in ("RPT", "EXPORT", "DBS"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    (root / "RPT" / "verify_drc.rpt").write_text(fixtures.drc_report([]), encoding="utf-8")
    (root / "RPT" / "verify_connectivity.rpt").write_text(fixtures.connectivity_report([]), encoding="utf-8")
    (root / "EXPORT" / "design.v").write_text(design, encoding="utf-8")
    (root / "EXPORT" / "design.def").write_text(
        "VERSION 5.8 ;\nDESIGN top ;\n# stand-in DEF of the netlist beside it\nEND DESIGN\n", encoding="utf-8")
    if task_name == "innovus-eco.tcl":
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


def xtop_replay(env):
    dump_dir = Path(env["DUMP_DIR"])
    dump_dir.mkdir(parents=True, exist_ok=True)
    cells = dict(netlist_cells(Path(env["NETLIST"]).read_text(encoding="utf-8")))

    def dump(index):
        path = dump_dir / f"{index:03d}.dump"
        path.write_text("".join(f"{inst} {master}\n" for inst, master in sorted(cells.items())), encoding="utf-8")
        return path

    dump(0)
    steps = Path(env["STEPS_TCL"]).read_text(encoding="utf-8")
    with open(env["RECEIPTS_LOG"], "a", encoding="utf-8") as receipts:
        for step_id, op, index in re.findall(r'(?m)^atcs_replay_step "([^"]+)" \{(.*)\} (\d+)$', steps):
            sized = re.fullmatch(r"size_cell \{(\S+)\} \{(\S+)\}", op)
            if not sized or sized.group(1) not in cells:
                receipts.write(json.dumps({"stepId": step_id, "status": "error", "error": f"stand-in cannot apply {op}"}) + "\n")
                raise SystemExit(f"replay stopped at step {step_id}")
            before = dump_dir / f"{int(index) - 1:03d}.dump"
            cells[sized.group(1)] = sized.group(2)
            after = dump(int(index))
            receipts.write(json.dumps({"stepId": step_id, "status": "ok",
                                       "beforeDump": str(before), "afterDump": str(after)}) + "\n")


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
            xtop_replay(env)
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
