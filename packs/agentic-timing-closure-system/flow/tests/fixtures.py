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


def path_report(rows, mode, groups=None, slack_annotations=None):
    """A `setup.rpt`/`hold.rpt`-shaped report for `rows = [(endpoint, slack), ...]`.

    Repeating the same `endpoint` across several `rows` (with distinct
    per-row `U_START_<index>` startpoints, as a real report's own
    `-nworst`-driven listing does) reproduces the real Foundation/B_lazy
    corpus's "several worst paths converge on one endpoint" grammar that
    `atcs.reports.parse_path_report` collapses to the worst slack. `groups`,
    when given, is a list of per-row path-group names parallel to `rows`
    (defaults to `"core_clock"` for every row) — pass distinct groups for a
    repeated endpoint to instead reproduce the genuinely-ambiguous case
    `parse_path_report` still refuses. `slack_annotations`, when given, is a
    list of per-row suffix strings appended inside the slack line's
    `(VIOLATED...)` parenthetical (default `""`) -- pass
    `": increase significant digits"` to reproduce the real PT annotation
    `parse_path_report` must tolerate (confirmed against the real
    Foundation/B_lazy corpus).
    """
    delay = "max" if mode == "setup" else "min"
    groups = groups if groups is not None else ["core_clock"] * len(rows)
    slack_annotations = slack_annotations if slack_annotations is not None else [""] * len(rows)
    return "\n".join(
        f"""  Startpoint: U_START_{index}
  Endpoint: {endpoint}
  Path Group: {groups[index]}
  Path Type: {delay}
  slack (VIOLATED{slack_annotations[index]}) {slack}

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


def path_detail_report(stages, tail_net_fanout=None):
    """A single-path ``report_timing -path_type full_clock_expanded
    -input_pins -nets -transition_time -capacitance``-shaped report, in the
    grammar `atcs.adapters.parse_path_detail` parses (Task 16 real-corpus
    preflight): long instance/pin names wrap onto their own line with the
    numeric columns on the next line, a stray ``&`` annotation token sits
    between each arc's Incr and Path values, and a net's own line only ever
    carries `Fanout` and (except a path's final, off-chip net) `Cap` --
    never Incr/Path. Cross-checked against a real Foundation ROUND3
    ``setup.rpt`` sample (``docs/assessment/2026-09-26/atcs-qualification/
    corpus-preflight.md``); no customer, PDK or library report content is
    used here -- every cell/instance/net name below is invented.

    ``stages`` is ``[(in_pin, out_pin, cell, in_trans, in_incr, out_trans,
    out_incr, net_name, fanout, cap), ...]``, one tuple per logic stage: a
    net-delay arc into a cell's input pin, that same cell's own delay out
    its output pin, then the net its output drives -- the repeating unit a
    real full_clock_expanded report under ``-nets`` uses. `tail_net_fanout`,
    when given, appends one more net line with only a fanout (no cap) after
    the last stage, the shape a real path's very last net (beyond an output
    port) has.
    """
    lines = [
        "  Point                       Fanout    Cap      Trans       Incr       Path",
        "  -----------------------------------------------------------------------------",
        "  clock core_clock (rise edge)                               0.00       0.00",
    ]
    path = 0.0
    for in_pin, out_pin, cell, in_trans, in_incr, out_trans, out_incr, net_name, fanout, cap in stages:
        path += in_incr
        lines.append(f"  {in_pin} ({cell})")
        lines.append(f"                    {in_trans}       {in_incr} &     {path} r")
        path += out_incr
        lines.append(f"  {out_pin} ({cell})")
        lines.append(f"                    {out_trans}       {out_incr} &     {path} r")
        lines.append(f"  {net_name} (net)")
        lines.append(f"                    {fanout}     {cap}")
    if tail_net_fanout is not None:
        lines.append("  tail_net (net)")
        lines.append(f"                    {tail_net_fanout}")
    lines.append(f"  data arrival time                                                     {path}")
    return "\n".join(lines) + "\n"


def spef_net_name_map_and_d_nets(name_map, d_nets):
    """A ``*NAME_MAP``/``*D_NET``-shaped SPEF excerpt, in the grammar
    `atcs.adapters.parse_spef_net_names` parses (Task 16 real-corpus
    preflight): a real SPEF does not write net names literally on its
    ``*D_NET`` lines -- they are index-substituted through a ``*NAME_MAP``
    block (``*<index> <name>``), and ``*D_NET`` then references a net by
    its ``*<index>`` alias plus a total-capacitance value. Cross-checked
    against a real Foundation ROUND3 StarRC ``.spef`` sample; every index
    and name below is invented.

    ``name_map`` is ``{index: name}``; ``d_nets`` is ``[(index_or_literal,
    total_cap), ...]`` -- pass an `int` to reference a `name_map` index via
    alias, or a plain string to instead cover a ``*D_NET`` line that names
    its net literally (no index substitution at all).
    """
    lines = ["*NAME_MAP"]
    for index, name in name_map.items():
        lines.append(f"*{index} {name}")
    for token, cap in d_nets:
        ref = f"*{token}" if isinstance(token, int) else token
        lines.append(f"*D_NET {ref} {cap}")
    return "\n".join(lines) + "\n"
