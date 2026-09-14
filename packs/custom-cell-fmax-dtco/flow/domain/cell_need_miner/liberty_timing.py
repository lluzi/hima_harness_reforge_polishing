"""Extract a bounded relative delay model from a full NLDM Liberty file.

The opportunity search does not export foundry table contents.  It reads only
the cells present in the current mapped design, reduces every combinational
cell_rise/cell_fall table to its median arc delay, and normalises those medians
to dimensionless delay units (DU).  The result is an internal relative-STA
model: useful for ranking, never a signoff timing claim.
"""

from __future__ import annotations

import hashlib
import re
import statistics


CELL_RE = re.compile(r"^\s*cell\s*\(\s*\"?([^\")]+)\"?\s*\)\s*\{")
TABLE_RE = re.compile(r"\bcell_(?:rise|fall)\s*\([^)]*\)\s*\{")
NUMBER_RE = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")


def _median(values):
    return float(statistics.median(values)) if values else None


def parse_relative_delay_model(path, required_cells):
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
