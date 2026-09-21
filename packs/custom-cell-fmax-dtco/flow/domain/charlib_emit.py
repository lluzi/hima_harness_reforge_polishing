#!/usr/bin/env python3
"""Emit a Liberty LIBRARY for generated cells using the LEARNED characterisation model.

The library, not the cell, is the unit of value: synthesis picks from a set, so every mined
candidate gets characterised and offered, and the tool decides what it wants. Layout is then only
needed for what actually gets adopted -- which decouples the PPA question (answerable now) from the
lclayout device-envelope work (research).

NDA. Nothing in this file is a measured property of the reference library it is characterised
against. Its axes, its table templates, its units and its rail names are READ AT RUN TIME from the
Liberty named by --base, which is a site input; the numbers quoted below are errors and outputs of
OUR model, not figures from theirs.

Per cell:
  timing  -- charmodel/predict.py: topology -> NLDM scalars -> tables rebuilt on the axes read from
             --base, so every generated table lands on the same grid the reference tables use.
             Held-out per-entry error is ~10%, against ~127% for the hand-rolled RC mock it
             replaces.
  power   -- charmodel/model_power.json: internal_power on every arc AND every input pin, plus a
             real leakage_power. Held out by function family and scored at the TABLE level
             (validate_power.py): rise_power 10.2%, fall_power 17.2%, leakage 5.4% -- against 64%,
             176% and 73% for the flat library-median a cell would otherwise get. THIS MATTERS FOR
             MORE THAN ACCURACY: with no internal_power group at all, Innovus scores a generated
             cell at ~0 internal power, so any power comparison against foundry cells is biased in
             the generated library's favour by construction.
             The arc tables are the state MEAN, not the worst state, because they are published as
             ONE UNCONDITIONAL group that Innovus then applies in every state; and they are
             rebuilt from the 6-coefficient slew-quadratic fit (predict.rebuild_power_lsq6), which
             is what took fall_power from 33.5% to 17.2%.

FAIRNESS IS PART OF CORRECTNESS HERE. This library is compared against a foundry library in a PPA
run, so a limit that is looser on a generated cell than on a foundry cell is a defect even when it
is not an inaccuracy. Both such limits are now derived from the cell's own tables rather than
hardcoded -- see max_transition and max_capacitance below.
  area    -- charmodel/area_model.json, a linear fit (area = a*devices + b, ~11% median error).
             It OVER-predicts small cells -- a small generated cell is assigned more area than the
             equivalent reference master occupies -- so small generated cells are penalised, not
             flattered. That is the conservative direction and it is deliberate.
  pins    -- from the netlist itself, never cloned from a base cell.
  header  -- lu_table_templates, units, thresholds and voltage_map are taken verbatim from the
             .lib named by --base, so every table reference resolves. Library Compiler is the gate:
             `lc_shell` type-checks every cell on the way to .db, and it is what caught an earlier
             emitter referencing a template name from a different technology. The base library's
             IDENTITY is not copied: its filename banner, statement of use, `date`, `revision` and
             copyright `comment` describe ITS characterisation run, not this one, and leaving them
             in a generated file mislabels the provenance of every number in it.

Usage:
  charlib_emit.py --netlist-dir DIR --base <foundry.lib> \
    --timing-model <model.json> --power-model <power.json> \
    --area-model <area.json> \
    --library-name xspace_current_process -o out.lib
"""

import argparse
import glob
import json
import os
import re
import statistics
import subprocess
import sys
import time

C = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, C)
import sys
# Site-bound helper modules (estimate_lib / mock_char / charmodel). The authoritative copy
# is unresolved -- see authoring/flow-map.json OQ-2 -- so this package refuses to choose one
# and binds the directory through the typed input CCFMAX_CHARMODEL_HELPER_DIR instead of
# carrying a site path.
import os as _os
for _p in _os.environ.get("CCFMAX_CHARMODEL_HELPER_DIR", "").split(":"):
    if _p:
        sys.path.insert(0, _p)
import estimate_lib as EL  # noqa: E402
import mock_char as MC    # noqa: E402  parse_netlist, for the ports the model produces no arc for
from cell_need_miner.liberty_timing import derive_timing_sense  # noqa: E402
from mock_liberty_calibration import (  # noqa: E402
    build_reference_depth_anchors,
    calibrated_max_capacitance,
    calibrate_prediction,
    demand_result,
    load_policy,
    validate_electrical_families,
)

# .subckt ports that are supply nets, not signal pins. bool2cmos writes `vdd`/`gnd`; the wider set
# is here so a netlist from another generator does not silently get its rails declared as pins.
RAILS = {"vdd", "vss", "gnd", "vcc", "vpwr", "vgnd", "vnb", "vpb", "vbn", "vbp"}


def clean_header(header, library_name):
    """The base header with its lu_table_templates and units intact and its IDENTITY removed.

    Everything before `library (` is the base library's own filename/copyright banner and describes
    a different file; the `date`, `revision`, `comment` and `library head` attributes inside the
    group describe ITS characterisation run, not ours. Keeping them made a generated library claim
    to be somebody else's signed-off release, under their copyright and their date -- which is both
    wrong and the sort of wrong that survives into a report.
    """
    m = re.search(r"^\s*library\s*\(", header, re.M)
    if not m:
        sys.exit("could not find the `library (` group in the base header")
    body = header[m.start():]
    body = re.sub(r'(library\s*\(\s*)"?[A-Za-z0-9_]+"?(\s*\))', r"\1%s\2" % library_name,
                  body, count=1)
    body = re.sub(r"/\*\s*library head:[^*]*\*/",
                  "/*  generated library -- units, thresholds, voltage_map and every\n"
                  "        lu_table_template below are lifted verbatim from the foundry\n"
                  "        sign-off library named by --base; the CELLS are model output. */",
                  body, count=1)
    body = re.sub(r'(\bdate\s*:\s*)"[^"]*"', r'\1"generated by charmodel/charlib_emit.py"',
                  body, count=1)
    body = re.sub(r'(\bcomment\s*:\s*)"[^"]*"',
                  r'\1"MODELLED, NOT MEASURED -- see the banner below"', body, count=1)
    body = re.sub(r"(\brevision\s*:\s*)[0-9.]+", r"\g<1>1", body, count=1)
    return ("/* %s -- generated standard-cell library.\n"
            " * NOT a foundry library and not derived from foundry cell data: the header's units,\n"
            " * thresholds and table templates come from the foundry .lib so that the tables\n"
            " * resolve, and everything else is produced by charmodel's learned model.\n"
            " */\n" % library_name) + body


def cell_function(path):
    """bool2cmos writes `* function : ZN = <expr>` (one line per output) into the netlist header."""
    out = {}
    for line in open(path):
        m = re.match(r"\*\s*functions?\s*:\s*(\w+)\s*=\s*(.+?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2)
        m = re.match(r"\*\s*outputs\s*:\s*(.+)$", line)
        if m:                                   # multi-output header: "Y0 = ..., Y1 = ..."
            for part in m.group(1).split(","):
                if "=" in part:
                    k, v = part.split("=", 1)
                    out[k.strip()] = v.strip()
        if not line.startswith("*") and line.strip():
            break
    return out


def power_templates(base_cell):
    """(2-D template, 1-D passive template) names, READ FROM THE BASE CELL, never hardcoded.

    The delay path already learned this lesson the hard way: an emitter that hardcoded a template
    name from a different technology made Library Compiler reject every generated cell with
    LBDB-259. Power has two more template names to get wrong, so they are discovered the same way.
    """
    seven = passive = None
    for pb in EL._groups(base_cell, "pin"):
        for g in EL._groups(pb, "internal_power"):
            m = re.search(r"rise_power\s*\(\s*([A-Za-z0-9_]+)\s*\)", g)
            if not m:
                continue
            if re.search(r"related_pin\s*:", g):
                seven = seven or m.group(1)
            else:
                passive = passive or m.group(1)
    return seven, passive


def reference_timing_axes(base_cell):
    """Return the timing grid carried by the selected reference cell.

    The bound Liberty is already the authority for the generated library's
    units and table templates. Reading the matching axes from the same cell
    keeps one source of truth; a second site JSON can drift while remaining
    perfectly readable.
    """
    for timing in EL._groups(base_cell, "timing"):
        index_1 = re.search(r'\bindex_1\s*\(\s*"([^"]+)"\s*\)', timing)
        index_2 = re.search(r'\bindex_2\s*\(\s*"([^"]+)"\s*\)', timing)
        if not (index_1 and index_2):
            continue
        try:
            slew = [float(value.strip()) for value in index_1.group(1).split(",")]
            load = [float(value.strip()) for value in index_2.group(1).split(",")]
        except ValueError:
            continue
        if slew and load:
            return slew, load
    sys.exit(
        "could not read timing index_1/index_2 from the site-bound reference "
        "Liberty anchor cell"
    )


def emit_passive(kind, tmpl, idx1, vals):
    """A 1-D internal_power table (input pin): one index, one row of values."""
    return ('                %s (%s) {\n'
            '                    index_1("%s");\n'
            '                    values("%s");\n'
            '                }\n'
            % (kind, tmpl, ", ".join("%.6f" % x for x in idx1),
               ", ".join("%.7f" % v for v in vals)))


def emit_table(kind, tmpl, idx1, idx2, grid, prec="%.6f"):
    rows = (", \\\n" + " " * 24).join('"%s"' % ", ".join(prec % v for v in r) for r in grid)
    return ('                %s (%s) {\n'
            '                    index_1("%s");\n'
            '                    index_2("%s");\n'
            '                    values(%s);\n'
            '                }\n'
            % (kind, tmpl, ", ".join("%.6f" % x for x in idx1),
               ", ".join("%.6f" % x for x in idx2), rows))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--netlist-dir", required=True)
    ap.add_argument("--base", required=True,
                    help="site-bound reference .lib for header + table templates")
    ap.add_argument("--library-name", default="xspace_current_process")
    # NO DEFAULT. A rail name is a property of the library being characterised against, so this
    # package cannot hold one; and a wrong-but-plausible default is worse than none, because the
    # pg_pin groups are lifted verbatim from --base and would then declare supplies that the
    # per-pin related_power_pin / related_ground_pin references never match.
    ap.add_argument("--power-pin", required=True, help="power rail name; a site input")
    ap.add_argument("--ground-pin", required=True, help="ground rail name; a site input")
    ap.add_argument("--which", default="hgb", choices=["hgb", "ridge"])
    ap.add_argument("--timing-model", required=True, help="site-bound learned timing model")
    ap.add_argument("--power-model", required=True,
                    help="site-bound learned power model; --no-power disables power emission")
    ap.add_argument("--area-model", required=True, help="site-bound learned area model")
    ap.add_argument("--foundry-cdl", required=True,
                    help="site-bound foundry CDL used only for topology-depth anchors")
    ap.add_argument("--calibration-policy", required=True,
                    help="Pack-owned global Mock Liberty calibration policy")
    ap.add_argument("--cell-demands", required=True,
                    help="hash-retained Cell Demand ledger from AI research")
    ap.add_argument("--calibration-report", required=True,
                    help="output report for anchors, drive envelopes and demand checks")
    ap.add_argument("--prediction-dir", required=True,
                    help="Campaign-private directory for one prediction and log per cell")
    ap.add_argument("--prediction-executions", required=True,
                    help="Campaign-private manifest of nested predictor executions")
    ap.add_argument("--no-power", action="store_true",
                    help="emit no internal_power/leakage (the pre-power behaviour -- note that "
                         "this makes any power comparison against foundry cells meaningless)")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()

    lib = open(a.base, errors="replace").read()
    header = clean_header(EL.library_header(lib), a.library_name)
    _anchor = os.environ.get("CCFMAX_POWER_TEMPLATE_BASE_CELL", "")
    if not _anchor:
        sys.exit("CCFMAX_POWER_TEMPLATE_BASE_CELL is not bound: the power template anchor cell must come from the site input binding, never from this package")
    _basecell = EL._cell_block(lib, _anchor) or ""
    tmpl = EL._tmpl_name(_basecell)
    slew_axis, load_base = reference_timing_axes(_basecell)
    axes_json = json.dumps(
        {"slew": slew_axis, "load_base": load_base},
        separators=(",", ":"),
    )
    ptmpl7, ptmpl1 = power_templates(_basecell)
    do_power = not a.no_power and os.path.exists(a.power_model)
    if do_power and not (ptmpl7 and ptmpl1):
        sys.exit("could not find the power_lut_template names in the base cell")
    if not do_power:
        print("WARNING: emitting NO power data -- Innovus will score these cells at ~0 internal "
              "power, which biases any power comparison in their favour.")
    PG_BLOCK = "".join("        " + ln.strip() + "\n" if ln.strip() in ("}",) else
                       "        " + ln.strip() + "\n"
                       for grp in EL._groups(_basecell, "pg_pin") for ln in grp.splitlines())
    if "voltage_name" not in PG_BLOCK:
        sys.exit("could not lift pg_pin groups from the base cell")
    am = json.load(open(a.area_model))
    policy = load_policy(a.calibration_policy)
    reference = build_reference_depth_anchors(
        a.foundry_cdl, a.base, policy, reference_drive_cell=_anchor)
    demand_document = json.load(open(a.cell_demands))
    if (demand_document.get("schema") != "hima.cell-demand-ledger/1"
            or not isinstance(demand_document.get("demands"), list)):
        sys.exit("Cell Demand ledger has an unsupported schema")
    demands_by_cell = {}
    for demand in demand_document["demands"]:
        for cell in demand.get("physical_cells") or []:
            if cell in demands_by_cell:
                sys.exit("Cell Demand ledger repeats physical Cell %s" % cell)
            demands_by_cell[cell] = demand

    prediction_dir = os.path.abspath(a.prediction_dir)
    os.makedirs(prediction_dir, exist_ok=False)
    prediction_rows = []
    blocks, ok, bad = [], [], []
    n_leak_default = 0
    n_undeclared = 0
    cells_undeclared = []
    leaks = []
    d1_cache = {}
    calibration_rows = []
    demand_rows = []
    for sp in sorted(glob.glob(os.path.join(a.netlist_dir, "*.sp"))):
        name = os.path.basename(sp)[:-3]
        fns = cell_function(sp)
        prediction_path = os.path.join(prediction_dir, name + ".json")
        log_path = os.path.join(prediction_dir, name + ".log")
        try:
            cmd = [sys.executable, C + "/predict.py", "--netlist", sp,
                   "--model", a.timing_model,
                   "--which", a.which, "--tables", "--axes-json", axes_json,
                   "--json", prediction_path]
            if do_power:
                cmd += ["--power", a.power_model]
            started = time.time()
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            with open(log_path, "w") as handle:
                handle.write((r.stdout or "") + (r.stderr or ""))
            prediction_rows.append({"cell": name, "argv": cmd, "exitCode": r.returncode,
                                    "elapsedSeconds": time.time() - started,
                                    "log": log_path, "prediction": prediction_path})
            if r.returncode:
                bad.append((name, (r.stderr or r.stdout).strip().splitlines()[-1][:70])); continue
            pred = json.load(open(prediction_path))
            pred, family, drive, drive_factor = calibrate_prediction(
                pred, sp, policy, reference, d1_cache)
            with open(prediction_path, "w") as handle:
                json.dump(pred, handle, indent=2, sort_keys=True)
                handle.write("\n")
        except Exception as exc:                                  # noqa: BLE001
            bad.append((name, str(exc)[:70])); continue

        arcs = pred.get("arcs", [])
        if not arcs:
            bad.append((name, "model produced no timing arcs")); continue
        ndev = sum(1 for ln in open(sp) if ln[:1] in "mM")
        area = (am["slope"] * ndev + am["intercept"]) * drive_factor
        demand = demands_by_cell.get(name)
        if demand is None:
            raise ValueError("generated Cell %s is absent from the Cell Demand ledger" % name)
        demand_rows.append(demand_result(
            name, pred, float(demand["required_delay_ns"]),
            slew_ns=policy["reference_slew_ns"],
            load_pf=policy["reference_load_pf"]))

        # capacitance per pin is the MEAN over that pin's arcs, not whichever arc happened to be
        # first: a pin that drives two outputs gets two independent predictions of the same
        # physical gate capacitance, and picking one at random is a coin flip, not a choice.
        caps, outs = {}, {}
        for arc in arcs:
            caps.setdefault(arc["in_pin"], []).append(arc["scalars"].get("cap", 0.002))
            outs.setdefault(arc["out_pin"], []).append(arc)
        calibration_rows.append({
            "cell": name, "family": family, "drive": drive,
            "drive_scale": drive_factor, "area_um2": area,
            "input_capacitance_pf": {
                pin: statistics.fmean(values) for pin, values in caps.items()
            },
            "max_load_pf": {
                pin: calibrated_max_capacitance(pred, rows) for pin, rows in outs.items()
            },
            "output_resistance_ns_per_pf": pred["mock_calibration"].get(
                "output_resistance_ns_per_pf", {}),
            "topology": pred["mock_calibration"],
        })

        # The top of the characterised slew axis, taken from THIS cell's own tables. Every
        # generated pin declares max_transition here and not at the constant this emitter used to
        # hardcode. That constant sat well past the last row of every table and well past the
        # header's own default_max_transition, so Innovus (a) evaluated the power and delay
        # surfaces by extrapolation past the last row -- where the L6 rebuild is quadratic in slew
        # and the corner term is steepest -- and (b) did not fix slew on a generated cell in cases
        # where it would have fixed it on a reference-library cell, which means fewer buffers and
        # less switching power for the generated arms of a PPA comparison.
        #
        # FAIRNESS, restated as an invariant: a pin here is held to the top of its own
        # characterised axis, which is exactly the discipline the reference library applies to its
        # own pins. Deriving it per cell means the limit tracks the tables instead of licensing
        # extrapolation, and the emitter never has to carry the reference library's value.
        slew_top = max(arc["index_1"][-1] for arc in arcs)

        pin_txt = ""
        for p in caps:
            cap = statistics.fmean(caps[p])
            ip = ""
            pd = pred.get("pins", {}).get(p) if do_power else None
            if pd and pd.get("passive"):
                body = "".join(
                    emit_passive(k, ptmpl1, pd["index_1"], pd["passive"][k])
                    for k in ("rise_power", "fall_power") if pd["passive"].get(k))
                if body:
                    ip = ('            internal_power () {\n'
                          '                related_pg_pin : "%s";\n'
                          '%s'
                          '            }\n' % (a.power_pin, body))
            pin_txt += ('        pin ("%s") {\n'
                        '            capacitance : %.7f;\n'
                        '            direction : "input";\n'
                        '            max_transition : %.10f;\n'
                        '            related_ground_pin : "%s";\n'
                        '            related_power_pin : "%s";\n'
                        '%s'
                        '        }\n' % (p, cap, slew_top, a.ground_pin, a.power_pin, ip))

        # PINS THE MODEL PRODUCES NO ARC FOR. These netlists are per-output slices of a
        # multi-output cell, so a slice keeps the parent's whole port list and some of those
        # ports reach no transistor in this slice. They exist in the LEF and in the SPICE, and
        # building the Liberty pin list from timing arcs alone left 21 of 64 cells declaring
        # fewer pins than their own LEF -- a mismatch a placer resolves by ignoring the pin.
        # They are declared here so the three views agree.
        #   capacitance: the mean of this cell's real input pins. The pin is a physical shape
        #     with real capacitance and the model has no target for a gateless one; 0 would be
        #     the self-serving direction (a free load for whatever drives it), so it is not used.
        #   no internal_power: the passive group is gate-charge attribution, and there is no
        #     gate on the other side of this pin to charge.
        try:
            _nm, ports, _dv = MC.parse_netlist(sp)
        except SystemExit:
            ports = []
        undeclared = [p for p in ports
                      if p.lower() not in RAILS and p not in caps and p not in outs
                      and p not in fns]
        if undeclared:
            n_undeclared += len(undeclared)
            cells_undeclared.append((name, undeclared))
            fill = statistics.fmean([statistics.fmean(v) for v in caps.values()])
            for p in undeclared:
                pin_txt += ('        pin ("%s") {\n'
                            '            capacitance : %.7f;\n'
                            '            direction : "input";\n'
                            '            max_transition : %.10f;\n'
                            '            related_ground_pin : "%s";\n'
                            '            related_power_pin : "%s";\n'
                            '        }\n'
                            % (p, fill, slew_top, a.ground_pin, a.power_pin))

        out_txt = ""
        for o, oarcs in outs.items():
            # The top of THIS pin's own load axis, not a hardcoded 0.1 pF. index_2 is regenerated
            # per arc from the predicted k_load, so the generated axis tops span 0.0967 to 0.1787
            # across the library: the old constant licensed the small cells 3.4% past the last
            # column of their own table and capped the large ones at 56% of theirs. Where a pin's
            # arcs disagree, the SMALLEST top wins -- beyond it at least one arc is extrapolating.
            max_cap = calibrated_max_capacitance(pred, oarcs)
            timings = ""
            for arc in oarcs:
                t = arc.get("tables", {})
                body = "".join(emit_table(k, tmpl, arc["index_1"], arc["index_2"], t[k])
                               for k in ("cell_fall", "cell_rise", "fall_transition",
                                         "rise_transition") if k in t)
                if not body:
                    continue
                if not fns.get(o):
                    raise ValueError(
                        "%s/%s has timing arc %s without an output Boolean function"
                        % (name, o, arc["in_pin"])
                    )
                sense = derive_timing_sense(
                    fns[o], arc["in_pin"], sorted(caps)
                )
                timings += ('            timing () {\n'
                            '                related_pin : "%s";\n'
                            '                timing_sense : %s;\n'
                            '%s'
                            '            }\n' % (arc["in_pin"], sense, body))
                pt = arc.get("power_tables") or {}
                # %.9f, not %.6f: these entries are ~1e-3 pJ and the passive ones ~1e-4, so the
                # delay format would round the small end of every table to zero.
                pbody = "".join(
                    emit_table(k, ptmpl7, arc["index_1"], arc["index_2"], pt[k], "%.9f")
                    for k in ("rise_power", "fall_power") if pt.get(k))
                if pbody:
                    timings += ('            internal_power () {\n'
                                '                related_pin : "%s";\n'
                                '                related_pg_pin : "%s";\n'
                                '%s'
                                '            }\n' % (arc["in_pin"], a.power_pin, pbody))
            out_txt += ('        pin ("%s") {\n'
                        '            direction : "output";\n'
                        '            function : "%s";\n'
                        '            power_down_function : "(!%s) + (%s)";\n'
                        '            related_ground_pin : "%s";\n'
                        '            related_power_pin : "%s";\n'
                        '            max_capacitance : %.10f;\n'
                        '%s'
                        '        }\n' % (o, fns.get(o, ""), a.power_pin, a.ground_pin,
                                         a.ground_pin, a.power_pin, max_cap, timings))

        # Copy the base cell's pg_pin groups VERBATIM, which is why PG_BLOCK is lifted from the
        # site-bound Liberty at run time and no rail name is written in this file. Hand-writing a
        # pg_pin with `voltage_name` set to the PIN name fails Library Compiler with
        # LBDB-848/LBDB-27: voltage_name must reference a name declared in the library's own
        # voltage_map, and those names are a property of that library, not of its pins. Lifting
        # the groups gets the right names by construction; lc_shell is the gate that catches it
        # when something else does not.
        pg = PG_BLOCK
        # Leakage is emitted as leakage_power() groups and no cell_leakage_power scalar, which is
        # the shape the base library uses; see the lk_attr note below for why the two cannot both
        # be present.
        #
        # ONE UNCONDITIONAL GROUP, NOT 2^n STATE GROUPS -- a deliberate decision, and the reasons
        # are measurements rather than convenience. State-conditioned leakage is the norm in a
        # characterised library and Innovus does apply the weighting, so not emitting it needs a
        # justification:
        #   1. Where an unconditional default and a set of state groups both exist, the default is
        #      the arithmetic mean of the states, so at the 0.5 static state probability this flow
        #      runs with, the weighted answer and the declared default agree to well inside the
        #      model's own error -- checked against the instance Innovus itself named as the
        #      highest-leakage one in the run this was measured on. The generated cells are a low
        #      single-digit percentage of design leakage and a negligible fraction of total power,
        #      so the residual cannot move a power comparison.
        #   2. charmodel predicts leak_default and leak_max and nothing per state. Enumerating the
        #      `when` groups this library would need is trivial (every cell has an evaluable
        #      function); FILLING them is not, and interpolating hundreds of numbers out of two
        #      predictions would put structure in the library that the model does not have. A
        #      reader auditing a state-conditioned table is entitled to assume it was characterised
        #      per state.
        # If leakage-driven optimisation or a low-activity corner enters scope, the missing piece
        # is a per-state target in power_labels.py, not emitter code.
        leak = (pred.get("leakage") or {}).get("leak_default") if do_power else None
        if do_power and (leak is None or not (leak == leak) or leak <= 0):
            # Previously this fell back to a fixed 0.005 nW, which is more than an order of
            # magnitude below the smallest leakage this model predicts for any cell it emits.
            # A cell that reads as leakage-free is worse than a cell that is missing: it silently
            # wins the leakage comparison. Skip it and say so.
            bad.append((name, "leakage prediction failed (%r) -- cell dropped" % (leak,)))
            n_leak_default += 1
            continue
        leak_txt = ('        leakage_power () {\n'
                    '            value : %.6f;\n'
                    '            related_pg_pin : "%s";\n'
                    '        }\n' % (leak, a.power_pin)) if do_power else ""
        if do_power:
            leaks.append(leak)
        # cell_leakage_power ONLY when there is no leakage_power() group: with a group
        # present Library Compiler calls the scalar redundant and ignores it (LBDB-644). The base
        # library carries the group and no scalar, so this matches the reference shape.
        lk_attr = "" if leak_txt else '        cell_leakage_power : %.6f;\n' % leak
        blocks.append('    cell ("%s") {\n        area : %g;\n%s%s%s%s%s    }\n'
                      % (name, area, lk_attr, pg, leak_txt, pin_txt, out_txt))
        ok.append((name, ndev, len(outs), sum(len(v) for v in outs.values()), area))

    note = ("LEARNED-MODEL PREDICTION: %d cells. Timing, area%s are model outputs, not measured "
            "characterization. This stage does not establish model accuracy or PPA benefit."
            % (len(ok), ", internal power and leakage" if do_power else ""))
    # default_cell_leakage_power applies only to a cell with no leakage information. No cell here
    # can be one -- a failed leakage prediction now drops the cell -- but the header is inherited
    # from --base and whatever value it carries was chosen for a different library. A header
    # attribute that could silently declare a cell leakage-free is the kind of landmine that goes
    # off years later, so it is rewritten to this library's own median.
    if do_power and leaks:
        header = re.sub(r"(\bdefault_cell_leakage_power\s*:\s*)[0-9.eE+-]+",
                        r"\g<1>%.6f" % statistics.median(leaks), header, count=1)
    open(a.out, "w").write(header + EL.BANNER % note + "".join(blocks) + "\n}\n")
    print("%-34s %5s %5s %5s %8s" % ("CELL", "devs", "outs", "arcs", "area"))
    for n, d, o, ar, area in ok:
        print("%-34s %5d %5d %5d %8.3f" % (n, d, o, ar, area))
    for n, why in bad:
        print("  SKIP %-30s %s" % (n, why))
    with open(a.prediction_executions, "w") as handle:
        json.dump(prediction_rows, handle, indent=2, sort_keys=True)
        handle.write("\n")
    demand_by_id = {}
    for demand in demand_document["demands"]:
        rows = [row for row in demand_rows if row["cell"] in demand["physical_cells"]]
        demand_by_id[demand["demand_id"]] = {
            "required_delay_ns": demand["required_delay_ns"],
            "physical_cells": rows,
            "met_by_any_drive": any(row["meets"] for row in rows),
        }
    electrical_families = validate_electrical_families(calibration_rows)
    report = {
        "schema": "hima.mock-liberty-calibration/1",
        "status": "accepted" if demand_by_id and all(
            row["met_by_any_drive"] for row in demand_by_id.values()) else "rejected",
        "policy": policy,
        "reference": reference,
        "drive_variants": calibration_rows,
        "electrical_families": electrical_families,
        "cell_demands": demand_by_id,
        "claim_limits": {"measured_characterization": False,
                         "commercial_qor_prediction": False},
    }
    with open(a.calibration_report, "w") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    if report["status"] != "accepted":
        print(
            "CALIBRATION REJECTED: Mock Liberty calibration does not meet every Cell Demand; "
            "the complete report is retained for the Pack's calibration gate",
            file=sys.stderr,
        )
    print("\n%d cells -> %s   (%d skipped)" % (len(ok), a.out, len(bad)))
    if do_power and n_leak_default:
        print("ERROR: %d cells DROPPED because their leakage prediction failed" % n_leak_default)
    if cells_undeclared:
        print("\n%d pins on %d cells exist in the netlist (and the LEF) but drive nothing in "
              "this slice; declared as input pins so Liberty/LEF/SPICE agree:"
              % (n_undeclared, len(cells_undeclared)))
        for n, ps in cells_undeclared:
            print("    %-34s %s" % (n, ",".join(ps)))
    if not ok:
        if bad:
            reason_counts = {}
            for _name, reason in bad:
                reason_counts[reason] = reason_counts.get(reason, 0) + 1
            common_reason, common_count = max(
                reason_counts.items(), key=lambda item: item[1]
            )
            print(
                "ERROR: common skip cause (%d of %d candidates): %s"
                % (common_count, len(bad), common_reason)
            )
        sys.exit(
            "ERROR: characterisation produced an empty generated library; no candidate "
            "has a usable timing and power model. Inspect the SKIP lines above."
        )


if __name__ == "__main__":
    main()
