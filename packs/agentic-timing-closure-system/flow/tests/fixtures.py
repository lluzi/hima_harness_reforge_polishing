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
