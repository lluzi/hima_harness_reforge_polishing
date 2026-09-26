"""Synthesized PrimeTime report generators, in the grammar `atcs.reports` parses.

Ported (not imported) from
``packs/xtop-timing-closure/flow/tests/test_closure.py:26-58``
(``global_report``, ``path_report``); `check_timing_report` is new for this
Pack's `atcs.reports.parse_check_timing`. No customer, PDK or library report
content is used anywhere here — every string below is synthesized text in
the observed PT report grammar.
"""
from __future__ import annotations


def global_report(setup_wns, setup_tns, setup_num, hold_wns, hold_tns, hold_num):
    """A `global_timing.rpt`-shaped report with explicit WNS/TNS/NUM rows."""
    return f"""Setup violations
---------------------------------------------------------
         Total  reg->reg   in->reg  reg->out   in->out
---------------------------------------------------------
WNS      {setup_wns} 0.00 0.00 0.00 0.00
TNS      {setup_tns} 0.00 0.00 0.00 0.00
NUM      {setup_num} 0 0 0 0
---------------------------------------------------------

Hold violations
---------------------------------------------------------
         Total  reg->reg   in->reg  reg->out   in->out
---------------------------------------------------------
WNS      {hold_wns} 0.00 0.00 0.00 0.00
TNS      {hold_tns} 0.00 0.00 0.00 0.00
NUM      {hold_num} 0 0 0 0
---------------------------------------------------------
"""


def path_report(rows, mode):
    """A `setup.rpt`/`hold.rpt`-shaped report for `rows = [(endpoint, slack), ...]`."""
    delay = "max" if mode == "setup" else "min"
    return "\n".join(
        f"""  Startpoint: U_START_{index}
  Endpoint: {endpoint}
  Path Group: core_clock
  Path Type: {delay}
  slack (VIOLATED) {slack}

""" for index, (endpoint, slack) in enumerate(rows)
    )


def check_timing_report(unconstrained):
    """A `check_timing.rpt`-shaped report stating an explicit unconstrained-endpoint count."""
    return f"""****************************************
Report : check_timing
****************************************
There are {unconstrained} endpoints which are not constrained
"""


def drc_report(violations, report_path="/site/verify_drc.rpt", limit=1000000, total=None):
    """A `verify_drc.rpt`-shaped report, in the grammar `atcs.verification.parse_drc_summary`
    parses and cross-checked against the frozen old Pack's reader
    (`packs/xtop-timing-closure/tools/read-output.py:67-96`) and its test fixtures
    (`packs/xtop-timing-closure/flow/tests/test_closure.py:111-115`).

    `violations` is `[(type_line, (x1, y1, x2, y2)), ...]`, one entry per listed
    violation. `total` defaults to `len(violations)`; pass a different value
    (e.g. equal to `limit`, to simulate the check's own cap being reached, or
    otherwise different from `len(violations)`) to synthesize a report whose
    declared total does not match what was actually listed.
    """
    lines = [f"#  Command: verify_drc -limit {limit} -report {report_path}"]
    for type_line, bbox in violations:
        x1, y1, x2, y2 = bbox
        lines.append(type_line)
        lines.append(f"Bounds : ( {x1}, {y1} ) ( {x2}, {y2} )")
    total_value = len(violations) if total is None else total
    lines.append(f"  Total Violations : {total_value} Viols.")
    return "\n".join(lines) + "\n"


def connectivity_report(nets, report_path="/site/verify_connectivity.rpt", limit=1000000, total=None,
                         category="IMPVFC-200", category_label="Special Wires: Pieces are not connected."):
    """A `verify_connectivity.rpt`-shaped report, in the grammar
    `atcs.verification.parse_connectivity_summary` parses and cross-checked against the
    frozen old Pack's reader (`packs/xtop-timing-closure/tools/read-output.py:67-96`)
    and its test fixtures (`packs/xtop-timing-closure/flow/tests/test_closure.py:117-121`).

    `nets` is `[net_name, ...]`, one entry per listed `Net ...:` violation line.
    `total` defaults to `len(nets)`; pass a different value (e.g. equal to
    `limit`) to synthesize a report whose declared total does not match what
    was actually listed.
    """
    lines = [f"#  Command: verifyConnectivity -noAntenna -error {limit} -report {report_path}"]
    for net in nets:
        lines.append(f"Net {net}: has special routes with opens at (0.000, 0.000) (1.000, 1.000)")
    total_value = len(nets) if total is None else total
    lines.append("Begin Summary")
    lines.append(f"    {total_value} Problem(s) ({category}): {category_label}")
    lines.append(f"    {total_value} total info(s) created.")
    lines.append("End Summary")
    return "\n".join(lines) + "\n"
