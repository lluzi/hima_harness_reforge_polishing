#!/usr/bin/env python3
"""Fit the mock characterizer's RC model to the foundry tt Liberty, and score it.

    python3 fit_mock.py --spice sky130_fd_sc_hd.spice --lib sky130_fd_sc_hd__tt_025C_1v80.lib \
        [--check-lib SPICE.lib --check-netlists DIR --check-recipe round-recipe.json] --out mock-fit.json

Training cells: every combinational foundry cell (no ff, latch or statetable group) whose schematic
has only nfet/pfet devices. Per quantity, weighted least squares on error relative to
max(reference, 20 ps), with the worst stage path re-chosen between passes; the grid over diffusion
and wire capacitance keeps the best worst-quantity p90. --check-* scores the mock (anchored where a
foundry arc corresponds, model-only otherwise) against another Liberty of real custom cells, for
example the SPICE pre-layout library of a past round. Pure stdlib.
"""
import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import charcore as cc  # noqa: E402
import mockcore as mc  # noqa: E402

SEQUENTIAL = re.compile(r"\b(ff|ff_bank|latch|statetable)\s*\(")
FLOOR_NS = 0.02


def solve(rows, targets, weights):
    """Weighted least squares through the normal equations (small, well-posed systems)."""
    n = len(rows[0])
    ata = [[0.0] * n for _ in range(n)]
    atb = [0.0] * n
    for row, y, w in zip(rows, targets, weights):
        w2 = w * w
        for i in range(n):
            atb[i] += w2 * row[i] * y
            for j in range(i, n):
                ata[i][j] += w2 * row[i] * row[j]
    for i in range(n):
        for j in range(i):
            ata[i][j] = ata[j][i]
        ata[i][i] += 1e-9
    m = [ata[i] + [atb[i]] for i in range(n)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c and m[c][c]:
                f = m[r][c] / m[c][c]
                m[r] = [a - f * b for a, b in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] if m[i][i] else 0.0 for i in range(n)]


def foundry_cells(spice_text, lib_text):
    """{name: {"stages", "liberty"}} for every usable combinational foundry cell."""
    cells = {}
    for name in re.findall(r"^\.subckt\s+(\S+)", spice_text, re.M):
        try:
            text = cc.find_cell_text(lib_text, name)
            if SEQUENTIAL.search(text):
                continue
            ref = cc.read_cell(lib_text, name)
            outputs = [p for p, v in ref["pins"].items() if v["direction"] == "output"]
            inputs = [p for p, v in ref["pins"].items() if v["direction"] == "input"]
            if not outputs or not inputs or any(not ref["pins"][o]["function"] for o in outputs):
                continue
            cells[name] = {"stages": mc.Stages(mc.parse_devices(spice_text, name), inputs, outputs), "liberty": ref}
        except (cc.CharError, KeyError, ValueError):
            continue
    return cells


def samples(cells, model):
    """[(quantity, [terms], slew, c_last, reference)] for every foundry table entry with a stage path."""
    out = []
    for name, cell in sorted(cells.items()):
        stages = cell["stages"]
        for arc in cell["liberty"]["arcs"]:
            if not arc.get("index_1") or arc["sense"] not in ("positive_unate", "negative_unate", "non_unate"):
                continue
            terms = mc.arc_terms(stages, arc["output"], arc["input"], arc["sense"], model)
            if terms is None:
                continue
            c_out = mc.out_cap(stages, arc["output"], model)
            for q in cc.QUANTITIES:
                rows = arc["tables"].get(q)
                edge = "rise" if "rise" in q else "fall"
                for i, slew in enumerate(arc["index_1"]):
                    for j, load in enumerate(arc["index_2"]):
                        out.append((q, terms[edge], slew, c_out + load / model["cgPfPerUm"], rows[i][j]))
    return out


def fit_caps(cells, model):
    rows, ys, ws = [], [], []
    for cell in cells.values():
        for pin in cell["stages"].inputs:
            c = cell["liberty"]["pins"][pin].get("capacitance")
            if c and cell["stages"].gates.get(pin):
                rows.append([cell["stages"].gates[pin], 1.0])
                ys.append(c)
                ws.append(1.0 / c)
    cg, c0 = solve(rows, ys, ws)
    model["cgPfPerUm"], model["c0Pf"] = cg, max(0.0, c0)


def fit_timing(cells, model, passes=3):
    data = samples(cells, model)
    for step in range(passes):
        by_q = {}
        for q, terms, slew, c_last, ref in data:
            term = terms[0] if step == 0 and len(terms) == 1 else max(terms, key=lambda t: mc.predict(model, q, t, slew, c_last))
            rows, ys, ws = by_q.setdefault(q, ([], [], []))
            rows.append(mc.features(term, slew, c_last))
            ys.append(ref)
            ws.append(1.0 / max(abs(ref), FLOOR_NS))
        model["coef"] = {q: [round(c, 8) for c in solve(*by_q[q])] for q in cc.QUANTITIES}
    ratios = {}
    for q, terms, slew, c_last, ref in data:
        value = max(mc.predict(model, q, t, slew, c_last) for t in terms)
        if value > 0 and ref > 0:
            ratios.setdefault(q, []).append(ref / value)
    model["bias"] = {q: round(cc.median(v), 4) for q, v in ratios.items()}
    return data


def error_stats(errors):
    return {"n": len(errors), "p50": round(cc.percentile(errors, 50), 4), "p90": round(cc.percentile(errors, 90), 4)}


def score_training(cells, model, data):
    errors = {}
    for q, terms, slew, c_last, ref in data:
        value = max(mc.predict(model, q, t, slew, c_last) for t in terms) * model["bias"][q]
        errors.setdefault(q, []).append(abs(value - ref) / max(abs(ref), FLOOR_NS))
    caps = []
    for cell in cells.values():
        for pin in cell["stages"].inputs:
            c = cell["liberty"]["pins"][pin].get("capacitance")
            if c:
                caps.append(abs((model["cgPfPerUm"] * cell["stages"].gates.get(pin, 0.0) + model["c0Pf"]) / c - 1.0))
    errors["capacitance"] = caps
    return {q: error_stats(v) for q, v in sorted(errors.items())}


def check(model, ref_cells, check_lib, netlists, recipe):
    """Score mock tables against another Liberty (e.g. SPICE pre-layout) for the cells of a recipe."""
    text = open(check_lib).read()
    library = recipe.get("library", recipe)
    entries = {c["name"]: c for c in (library.get("cells") if isinstance(library, dict) else library)}
    errors = {"anchored": {}, "model": {}}
    caps, cells_done, failures, signed = [], 0, {}, {}
    for name in re.findall(r'\bcell\s*\(\s*"([^"]+)"\s*\)', text):
        entry = entries.get(name)
        if not entry:
            continue
        try:
            truth = cc.read_cell(text, name)
            cell = cc.normalize_cell({"name": name, "pins": {"inputs": entry["inputs"], "outputs": entry["outputs"]},
                                      "functions": entry["functions"], "area_um2": 1.0})
            arc0 = truth["arcs"][0]
            index_2 = {o: next(a["index_2"] for a in truth["arcs"] if a["output"] == o) for o in cell["outputs"]}
            netlist = open(os.path.join(netlists, name + ".sp")).read()
            arcs, pins, basis = mc.mock_cell(cell, netlist, arc0["index_1"], index_2, ref_cells,
                                             mc.anchor_list(entry), model)
        except (cc.CharError, OSError, StopIteration, KeyError) as error:
            failures[name] = str(error)[:160]
            continue
        cells_done += 1
        anchored = {tag.split(" (")[0] for tag in basis["anchored"]}
        for arc in arcs:
            match = [a for a in truth["arcs"] if a["output"] == arc["output"] and a["input"] == arc["input"]
                     and a["sense"] == arc["sense"]]
            if not match:
                continue
            kind = "anchored" if "%s->%s %s" % (arc["input"], arc["output"], arc["sense"]) in anchored else "model"
            for q in cc.QUANTITIES:
                mid_i, mid_j = len(arc["tables"][q]) // 2, len(arc["tables"][q][0]) // 2
                true_mid = match[0]["tables"][q][mid_i][mid_j]
                if true_mid > 0:
                    signed.setdefault(q, []).append(arc["tables"][q][mid_i][mid_j] / true_mid - 1.0)
                for mine_row, true_row in zip(arc["tables"][q], match[0]["tables"][q]):
                    for mine, true in zip(mine_row, true_row):
                        errors[kind].setdefault(q, []).append(abs(mine - true) / max(abs(true), FLOOR_NS))
        for pin, c in pins.items():
            true = truth["pins"][pin].get("capacitance")
            if true:
                caps.append(abs(c["rise_capacitance"] / true - 1.0))
    return {"lib": os.path.abspath(check_lib), "cells": cells_done, "failures": failures,
            "anchored": {q: error_stats(v) for q, v in sorted(errors["anchored"].items())},
            "model": {q: error_stats(v) for q, v in sorted(errors["model"].items())},
            "capacitance": error_stats(caps) if caps else None,
            "midPointSigned": {q: {"median": round(cc.median(v), 4), "p10": round(cc.percentile(v, 10), 4),
                                   "p90": round(cc.percentile(v, 90), 4)} for q, v in sorted(signed.items())}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--spice", required=True)
    parser.add_argument("--lib", required=True)
    parser.add_argument("--check-lib")
    parser.add_argument("--check-netlists")
    parser.add_argument("--check-recipe")
    parser.add_argument("--check-label", help="what --check-lib is, recorded instead of its path")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    started = time.time()
    cells = foundry_cells(open(args.spice).read(), open(args.lib).read())
    best = None
    for diff in (0.5, 1.0, 1.5):
        for wire in (0.0, 1.0):
            model = json.loads(json.dumps(mc.MODEL))
            model.update(diffOverGate=diff, wirePerNode=wire)
            fit_caps(cells, model)
            data = fit_timing(cells, model)
            scores = score_training(cells, model, data)
            worst = max(v["p90"] for q, v in scores.items() if q != "capacitance")
            print("diffOverGate %.1f wirePerNode %.1f: worst p90 %.3f" % (diff, wire, worst), flush=True)
            if best is None or worst < best[0]:
                best = (worst, model, scores)
    _, model, training = best
    model["cgPfPerUm"], model["c0Pf"] = round(model["cgPfPerUm"], 8), round(model["c0Pf"], 8)
    result = {"schema": "hima-mockchar-fit/1", "model": model, "fingerprint": mc.model_fingerprint(model),
              "trainingSource": "%s + %s" % (os.path.basename(args.lib), os.path.basename(args.spice)),
              "errorMetric": "|mock - reference| / max(|reference|, %g ns); capacitance relative" % FLOOR_NS,
              "trainingCells": len(cells), "training": training}
    if args.check_lib and args.check_netlists and args.check_recipe:
        recipe = json.load(open(args.check_recipe))
        result["check"] = check(model, cells, args.check_lib, args.check_netlists, recipe)
        if args.check_label:
            result["check"]["lib"] = args.check_label
    result["wallSeconds"] = round(time.time() - started, 1)
    with open(args.out, "w") as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps({k: v for k, v in result.items() if k != "model"}, indent=1)[:4000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
