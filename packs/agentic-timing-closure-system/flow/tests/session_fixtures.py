"""Synthesized XTop expert-session outputs, in the shapes the Task 3 toolkit writes.

`ops.jsonl` and `gain.jsonl` lines follow `templates/xtop-operator.tcl`
(`atcs_mutate`, `atcs_undo`, `atcs_log_gain`) and
`notes/t3-toolkit-surface.md`; the field order and values mirror what
`flow/tests/test_xtop_toolkit.py` observes from the rendered session. The
`summarize_gba_violations` text follows the real layout pinned by
`xtop_summary_samples` (the old flow's server run).
"""
from __future__ import annotations

import hashlib
import json

from atcs import core

PLAN = "0123456789abcdef" * 4
BASE_STATE_ID = "base-0000000000000001"


def make_base_ref(slot="w01", revision=1, instances=("U1", "U2", "U3"), nets=("N1",), targets=None,
                  target_pins=None, may_affect=None):
    """A self-consistent `base_ref` whose work package carries the Task 4 fields."""
    work_package = core.stamp("work-package", {
        "taskId": slot, "baseStateId": BASE_STATE_ID, "problem": "hold blockers",
        "targets": list(targets if targets is not None else ["func_ss|hold|U1/D"]),
        "targetPins": list(target_pins if target_pins is not None else ["U1/D"]),
        "editDomain": {"instances": list(instances), "nets": list(nets), "regions": [[0, 0, 100, 100]]},
        "protected": {"instances": [], "nets": []}, "mayAffect": list(may_affect or []),
        "actions": ["size_cell", "insert_buffer", "delete_buffer"],
        "budget": {"xtopMinutes": 10, "queries": 10, "attempts": 3},
        "scope": {"commands": ["atcs_size_cell", "atcs_insert_buffer", "atcs_undo"], "maxMutations": 12},
        "observe": "fast",
    })
    manifest = core.stamp("workspace-manifest", {
        "workPackageId": work_package["id"], "taskId": slot, "revision": revision,
        "root": f"workspaces/{slot}/r{revision}/", "readOnly": [],
        "namePrefix": f"atcs_{slot}_r{revision}_", "recovery": {"checkpoint": None},
        "baseStateId": BASE_STATE_ID,
    })
    return {"stateId": BASE_STATE_ID, "workspaceManifest": manifest, "workPackage": work_package}


class SessionLog:
    """Builds `ops.jsonl` + `gain.jsonl` text the way one worker session writes them."""

    def __init__(self, reference=None):
        self.ops = []
        self.gains = []
        self.reads = []
        self.seq = 0
        reference = reference or {"setup": (-0.020, -0.100, 4), "hold": (-0.070, -1.200, 30)}
        self.gains.append({"seq": 0, "kind": "reference", "checks": {
            check: summary_entry(check, reference_text(check, *values), as_reference=True)
            for check, values in reference.items()}})

    def _line(self, cmd, proc, args, status, before, after, eco_actions, **extra):
        self.seq += 1
        line = {"seq": self.seq, "cmd": cmd, "proc": proc, "args": {**args, "planSha256": PLAN},
                "status": status, "observe": "fast", "ecoActions": eco_actions,
                "before": {"instances": dict(before)}, "after": {"instances": dict(after)}}
        new_nets = extra.pop("newNets", None)
        fillers = extra.pop("fillers", None)
        if new_nets:
            line["newNets"] = list(new_nets)
        if fillers:
            line["fillers"] = list(fillers)
        line["xtop"] = {"command": f"{cmd} _sel1 ...", "code": 0 if status != "error" else 1, "result": ""}
        line.update(extra)
        self.ops.append(line)
        return self.seq

    def gain(self, seq, kind, setup, hold, fail_reasons=None, top_n=None):
        """One gain line; `setup`/`hold` are `(ref, cur)` pairs of `(wns, tns)`."""
        entry = {"seq": seq, "kind": kind}
        if top_n is not None:
            entry["topN"] = top_n
        entry["checks"] = {
            "setup": summary_entry("setup", delta_text("setup", *setup, fail_reasons=(fail_reasons or {}).get("setup")),
                                   top_n=top_n, fail_reason=fail_reasons is not None),
            "hold": summary_entry("hold", delta_text("hold", *hold, fail_reasons=(fail_reasons or {}).get("hold")),
                                  top_n=top_n, fail_reason=fail_reasons is not None),
        }
        self.gains.append(entry)

    def size(self, instance, from_master, to_master, status="kept", gain=None):
        seq = self._line("size_cell", "atcs_size_cell", {"instance": instance, "toMaster": to_master}, status,
                         {instance: from_master} if status == "kept" else {},
                         {instance: to_master} if status == "kept" else {}, 1 if status == "kept" else 0)
        self._maybe_gain(seq, status, gain)
        return seq

    def insert(self, net, loads, masters, new_instances, new_nets, status="kept", gain=None, matches=True,
               fillers=None):
        before = {name: None for name in new_instances}
        after = dict(zip(new_instances, masters))
        seq = self._line("insert_buffer", "atcs_insert_buffer",
                         {"net": net, "loadPins": list(loads), "masters": list(masters),
                          "newInstances": list(new_instances), "newNets": list(new_nets)},
                         status, before if status == "kept" else {}, after if status == "kept" else {},
                         len(new_instances), newNets=list(new_nets) if status == "kept" else None,
                         fillers=fillers, matchesRequest=matches)
        self._maybe_gain(seq, status, gain)
        return seq

    def remove(self, instance, master, gain=None):
        seq = self._line("remove_buffer", "atcs_remove_buffer", {"instance": instance}, "kept",
                         {instance: master}, {instance: None}, 1, matchesRequest=True)
        self._maybe_gain(seq, "kept", gain)
        return seq

    def fix_hold(self, pins, before, after, gain=None, status="kept", eco_cells=None):
        extra = {}
        if eco_cells:
            extra = {"verified": "eco-actions", "ecoCells": list(eco_cells)}
        seq = self._line("fix_hold_gba_violations", "atcs_fix_hold_pins",
                         {"pins": list(pins), "effort": "medium", "holdTarget": 0.0, "setupMargin": 0.01,
                          "sizeCellOnly": False, "useDummyCell": False, "fixTimingWindow": False,
                          "maxClusterLoaderCount": 0, "maxDelayCellLength": -1, "delayCellList": []},
                         status, before, after, max(1, len(after)), **extra)
        self._maybe_gain(seq, status, gain)
        return seq

    def move(self, instance, master, x, y, gain=None):
        seq = self._line("move_cell", "atcs_move_cell", {"instance": instance, "x": x, "y": y}, "kept",
                         {instance: master}, {instance: master}, 1, verified="eco-actions")
        self._maybe_gain(seq, "kept", gain)
        return seq

    def no_change(self, cmd="fix_setup_gba_violations", proc="atcs_fix_setup_pins", checkpoint=False):
        return self._line(cmd, proc, {"pins": ["U1/D"]}, "no-change", {}, {}, 1 if checkpoint else 0)

    def undo(self, target, discards=(), gain=None, status="kept"):
        edit = next(line for line in self.ops if line["seq"] == target)
        before = dict(edit["after"]["instances"])
        after = dict(edit["before"]["instances"])
        seq = self._line("undo", "atcs_undo", {}, status, before, after, -1 - len(discards),
                         undoes=target, discards=list(discards), undoCalls=1 + len(discards),
                         undo=[{"command": "undo", "code": 0, "result": ""}])
        # `undoes`/`discards`/`undoCalls` sit before `args` in the real line; order is irrelevant to JSON.
        self._maybe_gain(seq, status, gain, kind="undo")
        return seq

    def uncertain(self, cmd="size_cell", proc="atcs_size_cell", args=None, error="unexpected Tcl error"):
        """The exact shape `atcs_fail_uncertain` logs: no before/after/ecoActions/xtop, and for an
        undo no undoes/discards (xtop-operator.tcl `atcs_fail_uncertain`)."""
        self.seq += 1
        args = {"instance": "U2", "toMaster": "BUFX4"} if args is None else args
        self.ops.append({"seq": self.seq, "cmd": cmd, "proc": proc, "args": {**args, "planSha256": PLAN},
                         "status": "uncertain", "observe": "fast", "error": error})
        return self.seq

    def _maybe_gain(self, seq, status, gain, kind="mutation"):
        if status == "kept" and gain is not None:
            self.gain(seq, kind, *gain)

    def read(self, proc, args, rows):
        """One ``reads.jsonl`` line at the current seq, as `atcs_log_read` writes it (#66 D3)."""
        self.reads.append({"seq": self.seq, "proc": proc, "args": dict(args), "rowsDigest": rows_digest(rows),
                           "rows": list(rows)})

    def point(self, check, rows):
        """One `atcs_point` read; ``rows`` are ``(endpoint, scenario, slack)`` triples."""
        names = []
        for endpoint, _, _ in rows:
            if endpoint not in names:
                names.append(endpoint)
        self.read("atcs_point", {"check": check, "endPoints": names},
                  [{"endpoint": endpoint, "scenario": scenario, "slack": slack} for endpoint, scenario, slack in rows])

    def probe(self, check, pair, endpoints, fail_reasons=False):
        """One `atcs_gain` probe line at the current seq: ``pair`` is ``(ref, cur)`` of ``(wns, tns)``;
        ``endpoints`` its top-N rows ``(slack, scenario, name[, reasons])`` in the real layout."""
        text = delta_text(check, *pair) + top_n_table(check, endpoints, fail_reasons)
        self.gains.append({"seq": self.seq, "kind": "probe", "topN": len(endpoints), "checks": {
            check: summary_entry(check, text, top_n=len(endpoints), fail_reason=fail_reasons)}})

    def ops_text(self):
        return "".join(json.dumps(line) + "\n" for line in self.ops)

    def reads_text(self):
        return "".join(json.dumps(line) + "\n" for line in self.reads)

    def gain_text(self):
        return "".join(json.dumps(line) + "\n" for line in self.gains)


def summary_entry(check, text, as_reference=False, top_n=None, fail_reason=False):
    if as_reference:
        options = "-as_reference"
    else:
        options = "-with_delta -with_reference"
        if top_n is not None:
            options += f" -with_top_n {top_n}"
            if fail_reason:
                options += " -with_fail_reason"
    return {"command": f"summarize_gba_violations {options} -{check}", "code": 0, "result": "", "text": text}


SCENARIO = "func_ss"
_RULE = "-" * 129


def reference_text(check, wns, tns, num):
    """`summarize_gba_violations -exclude_path -as_reference -<check>` in the real layout
    (`xtop_summary_samples.PRE_OPT_*`), for one scenario."""
    return (f"### {check} summary ###\n"
            f"Scenario                  Count      Worst        TNS\n"
            f"------------------------------------------------------\n"
            f"total                  {num:>6} {wns:>10.4f} {tns:>10.4f}\n"
            f"  {SCENARIO:<20} {num:>6} {wns:>10.4f} {tns:>10.4f}\n")


def delta_text(check, reference, current, fail_reasons=None):
    """`summarize_gba_violations -exclude_path -with_reference -with_delta -<check>` in the real
    layout (`xtop_summary_samples.POST_OPT_*`); `reference`/`current` are `(wns, tns)`."""
    (ref_wns, ref_tns), (cur_wns, cur_tns) = reference, current
    row = (f"{3:>6} {4:>9} {-1:>+10}    |    {cur_wns:>7.4f} {ref_wns:>10.4f} {cur_wns - ref_wns:>+10.4f}    |"
           f"    {cur_tns:>7.4f} {ref_tns:>10.4f} {cur_tns - ref_tns:>+10.4f}")
    text = (f"### {check} summary ###\n"
            "Scenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst"
            "             TNS       TNS0      D_TNS\n"
            f"{_RULE}\n"
            f"total                   {row}\n"
            f"  {SCENARIO:<20}  {row}\n")
    if fail_reasons is not None:
        # The probe's top-N table in the real layout (`live_session_samples.LIVE_PROBE_SETUP`): one
        # endpoint row per failing endpoint, its fail reason in the last column.
        rows = [reason for reason, count in fail_reasons.items() for _ in range(count)]
        text += (f"### {check} top {len(rows)} endpoints ###\n"
                 "  Slack    Scenario                Name       Fail Reason      \n"
                 f"{'-' * 60}\n")
        for index, reason in enumerate(rows):
            text += f"{cur_wns:>7.4f}    {SCENARIO:<20}    U{index}/D    {reason}:100%\n"
    return text


def rows_digest(rows):
    """``reads.jsonl`` ``rowsDigest``: sha256 of the rows' compact JSON (ticket A's contract)."""
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def top_n_table(check, endpoints, fail_reasons=False):
    """``### <check> top N endpoints ###`` in the real layout (`live_session_samples.LIVE_PROBE_HOLD`)."""
    header = "  Slack    Scenario                Name" + ("       Fail Reason      " if fail_reasons else "")
    text = f"### {check} top {len(endpoints)} endpoints ###\n{header}\n{'-' * 60}\n"
    for row in endpoints:
        slack, scenario, name = row[:3]
        reasons = f"    {row[3]}" if fail_reasons and len(row) > 3 else ""
        text += f"{slack:>7.4f}    {scenario:<20}    {name}{reasons}\n"
    return text


def domain_record(plan_instances, instances, nets=(), target_pins=(), plan_nets=(), global_nets=(), unresolved=(),
                  regions=(), error=None, fanout_max=12):
    """``domain.json`` in the shape `atcs_write_domain_record` writes (schema atcs-local-domain/1)."""
    record = {"schema": "atcs-local-domain/1", "fanoutMax": fanout_max, "planInstances": sorted(plan_instances),
              "planNets": sorted(plan_nets), "targetPins": sorted(target_pins), "instances": sorted(instances),
              "nets": sorted(nets), "regions": [list(box) for box in regions],
              "globalNets": [{"net": net, "pins": pins} for net, pins in global_nets],
              "unresolved": sorted(unresolved)}
    if error is not None:
        record["error"] = error
    return record


def dump_text(mapping):
    return "".join(f"{name} {master}\n" for name, master in mapping.items())


def write_session(root, log, before, after, tainted=None, transcript="ATCS:taint:clean", eco_output=True,
                  domain=None, summary=None):
    """Write one slot's Operator outputs under `root` (a `pathlib.Path`); ``reads.jsonl`` when the log
    has reads, ``domain.json`` when ``domain`` is given, ``summary.json`` when ``summary`` is given."""
    root.mkdir(parents=True, exist_ok=True)
    if log.reads:
        (root / "reads.jsonl").write_text(log.reads_text(), encoding="utf-8")
    if domain is not None:
        (root / "domain.json").write_text(json.dumps(domain) + "\n", encoding="utf-8")
    if summary is not None:
        (root / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    (root / "before.dump").write_text(dump_text(before), encoding="utf-8")
    (root / "after.dump").write_text(dump_text(after), encoding="utf-8")
    (root / "ops.jsonl").write_text(log.ops_text(), encoding="utf-8")
    (root / "gain.jsonl").write_text(log.gain_text(), encoding="utf-8")
    if tainted is not None:
        (root / "tainted.json").write_text(json.dumps(tainted), encoding="utf-8")
    if transcript is not None:
        (root / "xtop_log_1.txt").write_text(
            'xtop > puts "HIMA:z:ACK"; set __hima_command [list atcs_close]\n'
            f"{transcript}\nHIMA:z:DONE\n", encoding="utf-8")
    if eco_output:
        (root / "eco_output").mkdir(exist_ok=True)
        (root / "eco_output" / "atcs_w01_r1_eco_netlist.tcl").write_text("# eco\n", encoding="utf-8")
