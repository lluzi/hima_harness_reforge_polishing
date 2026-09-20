#!/usr/bin/env python3
"""Materialize and audit electrical drive intent for generated Cell families.

The Boolean generator owns topology.  This module owns the physical meaning of
D1/D2/D4/D6/D8: transistor widths are scaled in SPICE and the same scale is
later consumed by the Liberty calibration layer.  Names alone never constitute
a drive family.
"""
from __future__ import annotations

import math
import re


DRIVE_SCALE = {"D1": 1.0, "D2": 2.0, "D4": 4.0, "D6": 6.0, "D8": 8.0}
_WIDTH = re.compile(r"(?i)(\bw\s*=\s*)([0-9]+(?:\.[0-9]*)?|\.[0-9]+)([a-z]+)")


def drive_scale(drive):
    if drive not in DRIVE_SCALE:
        raise ValueError("unsupported drive intent %r" % (drive,))
    return DRIVE_SCALE[drive]


def scale_spice_drive(text, *, source_cell, target_cell, drive):
    """Rename one structural deck and scale every MOS width monotonically."""
    if not isinstance(text, str) or not text:
        raise ValueError("SPICE source is empty")
    factor = drive_scale(drive)
    subckt = re.compile(r"(?im)^(\s*\.subckt\s+)%s(\b)" % re.escape(source_cell))
    ends = re.compile(r"(?im)^(\s*\.ends\s+)%s(\b)" % re.escape(source_cell))
    if len(subckt.findall(text)) != 1 or len(ends.findall(text)) != 1:
        raise ValueError("SPICE does not contain exactly one named source subcircuit")
    scaled = subckt.sub(r"\1%s\2" % target_cell, text)
    scaled = ends.sub(r"\1%s\2" % target_cell, scaled)

    count = 0
    lines = []
    for line in scaled.splitlines(keepends=True):
        if line.lstrip()[:1].lower() == "m":
            def replace(match):
                nonlocal count
                value = float(match.group(2)) * factor
                if not math.isfinite(value) or value <= 0:
                    raise ValueError("scaled transistor width is invalid")
                count += 1
                return "%s%.9g%s" % (match.group(1), value, match.group(3))
            line = _WIDTH.sub(replace, line)
        lines.append(line)
    if count == 0:
        raise ValueError("SPICE contains no width-bearing MOS devices")
    banner = "* Hima drive intent: %s scale=%g source=%s\n" % (
        drive, factor, source_cell)
    return banner + "".join(lines)


def transistor_widths(text):
    return [float(match.group(2)) for line in text.splitlines()
            if line.lstrip()[:1].lower() == "m" for match in _WIDTH.finditer(line)]
