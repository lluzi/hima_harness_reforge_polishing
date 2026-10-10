"""Stock library facts, generated (AndesCell) libraries, and their Liberty/LEF text."""
import json
from pathlib import Path

from . import model
from .common import SHARE, ToolError, read_json, sha256_file

DRIVE_DELAY = {1: 1.0, 2: 0.86, 4: 0.78, 8: 0.72}
DRIVE_AREA = {1: 1.0, 2: 1.38, 4: 2.05, 8: 3.3}
ROW_HEIGHT_UM = 0.90
SITE_WIDTH_UM = 0.10

# Electrical character of the stock std9t_svt cells per family: input cap per X1 (fF), leakage per
# X1 (nW), rise/fall ratio of the worst arc, and what Qualib reports as the library gap.
STOCK = {
    "DFF":   dict(cap=0.92, leak=6.8, rf=1.08, gap="clock-to-Q 82 ps at FO4; no fast-Q (low-clock-to-Q) flop in the library"),
    "BUF":   dict(cap=0.86, leak=2.1, rf=1.04, gap="drive steps X2 -> X4 -> X8 too coarse for fanout 6-12 nets; no balanced-skew mid-drive buffer"),
    "INV":   dict(cap=0.84, leak=1.2, rf=1.06, gap="complete drive range X1-X4; little headroom"),
    "XNOR3": dict(cap=1.62, leak=5.9, rf=1.36, gap="only X1/X2; rise 36 % slower than fall; no XNOR3 with a fast late-arriving A3 pin"),
    "XOR2":  dict(cap=1.48, leak=4.2, rf=1.22, gap="XOR2/XNOR2 rise 22 % slower than fall; X1 input cap high for S-box fanout"),
    "MUX2I": dict(cap=1.21, leak=3.6, rf=1.18, gap="select (S) arc 40 % slower than the data arcs; no X4"),
    "MUX2":  dict(cap=1.10, leak=3.9, rf=1.10, gap="adequate for its (non-critical) use"),
    "AOI21": dict(cap=1.18, leak=2.9, rf=1.30, gap="B-input rise 30 % slower than fall; no X4"),
    "OAI21": dict(cap=1.16, leak=2.8, rf=1.28, gap="B-input fall 28 % slower than rise; no X4"),
    "AOI22": dict(cap=1.20, leak=3.4, rf=1.24, gap="only X1"),
    "OAI22": dict(cap=1.20, leak=3.3, rf=1.22, gap="only X1"),
    "NAND2": dict(cap=0.98, leak=1.9, rf=1.08, gap="complete drive range X1-X4; little headroom"),
    "NOR2":  dict(cap=1.02, leak=2.0, rf=1.14, gap="rise 14 % slower than fall; X1/X2 only"),
    "NAND3": dict(cap=1.04, leak=2.4, rf=1.12, gap="only X1"),
    "NOR3":  dict(cap=1.08, leak=2.5, rf=1.20, gap="only X1"),
    "AND2":  dict(cap=0.96, leak=2.6, rf=1.06, gap="X1/X2; two-stage delay"),
    "OR2":   dict(cap=0.98, leak=2.7, rf=1.10, gap="only X1; two-stage delay"),
}


def drive_of(cell):
    tail = cell.rsplit("_X", 1)[-1]
    return int(tail) if tail.isdigit() else 1


def stock_cells():
    """Every stock cell with its electrical facts, derived from the model."""
    out = []
    for family, info in model.FAMILIES.items():
        for cell in info["cells"]:
            d = drive_of(cell)
            s = STOCK[family]
            fo4 = info["typPs"] * DRIVE_DELAY[d]
            out.append(dict(name=cell, family=family, drive=d, areaUm2=round(info["areaUm2"] * DRIVE_AREA[d], 3),
                            inputCapFf=round(s["cap"] * (1 + 0.55 * (d - 1)), 3), leakageNw=round(s["leak"] * d, 2),
                            fo4DelayPs=round(fo4, 1), riseFo4Ps=round(fo4 * s["rf"] / ((1 + s["rf"]) / 2), 1),
                            fallFo4Ps=round(fo4 / ((1 + s["rf"]) / 2), 1), function=info["function"],
                            inputs=info["inputs"], output=info["out"]))
    return out


def stock_cell(family, drive):
    cells = [c for c in stock_cells() if c["family"] == family]
    best = min(cells, key=lambda c: abs(c["drive"] - drive))
    return best


def stock_manifest():
    return dict(schema="ctu-library/1", name=model.STOCK_LIBRARY, corner=model.CORNER, cells=stock_cells())


def load_extra(directory):
    """One AndesCell output directory: its manifest (andes_r<k>.json) and file digests."""
    d = Path(directory)
    manifests = sorted(d.glob("andes_r*.json"))
    if not manifests:
        raise ToolError("no AndesCell library manifest (andes_r<k>.json) in %s" % d)
    doc = read_json(manifests[0], "AndesCell library manifest")
    if doc.get("schema") != "ctu-andescell-library/1":
        raise ToolError("%s is not an AndesCell library manifest" % manifests[0])
    files = {}
    for kind in ("liberty", "lef"):
        rel = (doc.get("files") or {}).get(kind)
        if not rel or not (d / rel).is_file():
            raise ToolError("AndesCell library %s is missing its %s file" % (doc.get("name"), kind))
        files[kind] = dict(path=str(d / rel), sha256=sha256_file(d / rel))
    doc["_dir"] = str(d)
    doc["_files"] = files
    doc["_manifestSha256"] = sha256_file(manifests[0])
    return doc


def speed_of(extra_libs, dont_use=()):
    """Family speed map and usable new cells per family, from loaded AndesCell libraries."""
    speed, usable = {}, {}
    for lib in extra_libs:
        for cell in lib["cells"]:
            if cell["name"] in dont_use:
                continue
            fam = cell["family"]
            speed[fam] = max(speed.get(fam, 0.0), cell["speedupPct"] / 100.0)
            usable.setdefault(fam, []).append(cell["name"])
    # A family's best cell sets its stage delays; capped at the model's achievable speed-up unless a
    # cell faster than that was allowed (an unscreened variant).
    return speed, usable


def _table(base, slope_in, slope_load, label):
    slews = [0.008, 0.020, 0.050, 0.120, 0.300]
    loads = [0.0010, 0.0035, 0.0080, 0.0180, 0.0400]
    rows = []
    for s in slews:
        rows.append(", ".join("%.4f" % (base + slope_in * s + slope_load * c) for c in loads))
    return ('        %s (delay_5x5) {\n          index_1 ("%s");\n          index_2 ("%s");\n          values ( \\\n            "%s" );\n        }\n'
            % (label, ", ".join("%.3f" % s for s in slews), ", ".join("%.4f" % c for c in loads), '", \\\n            "'.join(rows)))


def liberty_text(name, cells, banner_lines):
    head = [
        "/* %s */" % line for line in banner_lines
    ] + [
        "library (%s) {" % name,
        '  delay_model : table_lookup;',
        '  time_unit : "1ns";', '  voltage_unit : "1V";', '  current_unit : "1mA";',
        '  capacitive_load_unit (1, pf);', '  leakage_power_unit : "1nW";',
        '  nom_process : 1; nom_voltage : 0.90; nom_temperature : 25;',
        '  operating_conditions (%s) { process : 1; voltage : 0.90; temperature : 25; }' % model.CORNER,
        '  default_operating_conditions : %s;' % model.CORNER,
        '  lu_table_template (delay_5x5) { variable_1 : input_net_transition; variable_2 : total_output_net_capacitance; '
        'index_1 ("0.008, 0.020, 0.050, 0.120, 0.300"); index_2 ("0.0010, 0.0035, 0.0080, 0.0180, 0.0400"); }',
        "",
    ]
    body = []
    for c in cells:
        rise = c["riseFo4Ps"] / 1000.0
        fall = c["fallFo4Ps"] / 1000.0
        drive = c.get("drive", 1)
        k_load = 2.6 / drive
        lines = ["  cell (%s) {" % c["name"], "    area : %.3f;" % c["areaUm2"],
                 "    cell_leakage_power : %.2f;" % c["leakageNw"]]
        if c.get("origin"):
            lines.append('    cell_footprint : "%s";' % c["family"].lower())
            lines.append('    /* %s */' % c["origin"])
        for pin in c["inputs"]:
            lines.append('    pin (%s) { direction : input; capacitance : %.5f; }' % (pin, c["inputCapFf"] / 1000.0))
        lines.append('    pin (%s) {' % c["output"])
        lines.append('      direction : output;')
        if c["family"] == "DFF":
            lines.append('      function : "IQ";')
        else:
            lines.append('      function : "%s";' % c["function"])
        related = ["CK"] if c["family"] == "DFF" else c["inputs"][:1]
        for pin in related:
            lines.append('      timing () {')
            lines.append('        related_pin : "%s";' % pin)
            lines.append(_table(rise * 0.62, 0.18, k_load, "cell_rise").rstrip("\n"))
            lines.append(_table(fall * 0.62, 0.16, k_load * 0.9, "cell_fall").rstrip("\n"))
            lines.append('      }')
        lines.append('    }')
        lines.append("  }")
        body.extend(lines)
    return "\n".join(head + body + ["}", ""])


def lef_text(cells, banner_lines):
    out = ["# %s" % line for line in banner_lines] + ["VERSION 5.8 ;", "BUSBITCHARS \"[]\" ;", "DIVIDERCHAR \"/\" ;", ""]
    for c in cells:
        width = max(SITE_WIDTH_UM * 3, round(c["areaUm2"] / ROW_HEIGHT_UM / SITE_WIDTH_UM) * SITE_WIDTH_UM)
        out += ["MACRO %s" % c["name"], "  CLASS CORE ;", "  ORIGIN 0 0 ;", "  SIZE %.3f BY %.3f ;" % (width, ROW_HEIGHT_UM),
                "  SYMMETRY X Y ;", "  SITE core9t ;"]
        for pin in c["inputs"] + [c["output"]]:
            direction = "OUTPUT" if pin == c["output"] else "INPUT"
            out += ["  PIN %s" % pin, "    DIRECTION %s ;" % direction, "    USE SIGNAL ;", "  END %s" % pin]
        out += ["  PIN VDD", "    DIRECTION INOUT ;", "    USE POWER ;", "  END VDD",
                "  PIN VSS", "    DIRECTION INOUT ;", "    USE GROUND ;", "  END VSS", "END %s" % c["name"], ""]
    out.append("END LIBRARY")
    return "\n".join(out) + "\n"


def write_share():
    """Regenerate share/libs/std9t_svt (stock Liberty, LEF, manifest). Deterministic."""
    d = SHARE / "libs" / model.STOCK_LIBRARY
    d.mkdir(parents=True, exist_ok=True)
    banner = ["std9t_svt standard-cell library, %s, 9-track SVT" % model.CORNER,
              "Characterized at %s." % model.CORNER]
    cells = stock_cells()
    (d / ("%s_%s.lib" % (model.STOCK_LIBRARY, model.CORNER))).write_text(liberty_text(model.STOCK_LIBRARY, cells, banner))
    (d / ("%s.lef" % model.STOCK_LIBRARY)).write_text(lef_text(cells, banner))
    (d / "library.json").write_text(json.dumps(stock_manifest(), indent=2, sort_keys=True) + "\n")
    return d


if __name__ == "__main__":
    print(write_share())
