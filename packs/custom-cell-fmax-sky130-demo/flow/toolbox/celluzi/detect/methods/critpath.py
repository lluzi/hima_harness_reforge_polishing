"""Method A - Critical-Path Fusion (heuristic).  Plan §7.1.

Parse OpenSTA `report_checks` full paths for the baseline, find short recurring gate
sequences on the worst reg2reg paths, and propose fusing each into one custom cell.
Rank by sum(slack-criticality x occurrence). Targets performance; cheapest; built first.
"""
from __future__ import annotations
import re, collections, statistics
from dataclasses import dataclass
from ..interface import CellOpportunity, OpportunityDetector

# A "driver" (cell output) line: leading fanout int, then cap slew delay time, edge, inst/pin (master)
DRIVER_RE = re.compile(
    r'^\s*(\d+)\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s+[\d.]+\s+[v^]\s+(\S+?)/(\w+)\s+\(sky130_fd_sc_hd__(\w+)\)')
SLACK_RE = re.compile(r'([-\d.]+)\s+slack \((VIOLATED|MET)\)')
BUFFERS = {'buf', 'clkbuf', 'inv', 'dlygate', 'conb', 'clkdlybuf4s50'}


def base_type(master: str) -> str:      # xnor3_2 -> xnor3
    return re.sub(r'_\d+$', '', master)


@dataclass
class Stage:
    inst: str
    ctype: str
    gate_delay: float
    is_buf: bool


@dataclass
class TPath:
    slack: float
    reg2reg: bool
    stages: list


def parse_report(text: str):
    paths = []
    for rec in text.split('Startpoint:')[1:]:
        ms = SLACK_RE.search(rec)
        if not ms:
            continue
        slack = float(ms.group(1))
        ep_line = rec.split('Endpoint:')[1].split('\n')[0] if 'Endpoint:' in rec else ''
        reg2reg = 'flip-flop' in ep_line
        stages = []
        for line in rec.splitlines():
            m = DRIVER_RE.match(line)
            if not m:
                continue
            _fanout, delay, inst, _pin, master = m.groups()
            ct = base_type(master)
            stages.append(Stage(inst, ct, float(delay), ct in BUFFERS))
        paths.append(TPath(slack, reg2reg, stages))
    return paths


class CritPathDetector(OpportunityDetector):
    name = "critpath"

    def __init__(self, window=0.5, worst_paths=150, min_occ=10, top=8):
        self.window = window            # ns below WNS still counted "critical"
        self.worst_paths = worst_paths
        self.min_occ = min_occ
        self.top = top

    def detect_from_paths(self, paths):
        r2r = sorted([p for p in paths if p.reg2reg], key=lambda p: p.slack)
        if not r2r:
            return []
        wns = r2r[0].slack
        crit_cut = wns + self.window
        worst = [p for p in r2r if p.slack <= crit_cut][:self.worst_paths]

        patt = collections.defaultdict(
            lambda: {'occ': 0, 'crit': 0.0, 'pairs': collections.Counter(), 'bufdelay': []})
        for p in worst:
            crit = max(0.0, crit_cut - p.slack)
            prev = None
            accbuf = 0.0
            for st in p.stages:
                if st.ctype.startswith('dfxtp') or st.ctype.startswith('clkbuf'):
                    prev, accbuf = None, 0.0
                    continue
                if st.is_buf:
                    accbuf += st.gate_delay
                    continue
                if prev is not None:
                    d = patt[(prev.ctype, st.ctype)]
                    d['occ'] += 1
                    d['crit'] += crit
                    d['pairs'][(prev.inst, st.inst)] += 1
                    d['bufdelay'].append(accbuf)
                prev, accbuf = st, 0.0

        ranked = sorted(patt.items(), key=lambda kv: kv[1]['crit'], reverse=True)
        opps = []
        for (t1, t2), d in ranked:
            if d['occ'] < self.min_occ:
                continue
            if len(opps) >= self.top:
                break
            avgbuf = statistics.mean(d['bufdelay']) if d['bufdelay'] else 0.0
            pairs = [f"{a}->{b}" for (a, b), _c in d['pairs'].most_common(50)]
            opps.append(CellOpportunity(
                id=f"cp_{t1}__{t2}",
                function=f"fuse({t1},{t2})",
                matched_instances=pairs,
                estimated_gain={'interbuf_delay_ns': round(avgbuf, 4),
                                'occurrences': d['occ'],
                                'unique_pairs': len(d['pairs']),
                                'criticality_sum': round(d['crit'], 3)},
                method=self.name,
                rationale=(f"{t1}->{t2} occurs {d['occ']}x ({len(d['pairs'])} unique instance pairs) on the "
                           f"worst {len(worst)} reg2reg paths (slack <= {crit_cut:.3f} ns). On average "
                           f"{avgbuf:.3f} ns of placement-buffer delay sits between the two gates; fusing "
                           f"them removes that internal net + its buffers."),
                spec={'fuse': [t1, t2], 'suggested_drive_strengths': [1, 2, 4]},
                score=round(d['crit'], 3),
            ))
        return opps

    def detect(self, ctx):
        return self.detect_from_paths(ctx.paths)
