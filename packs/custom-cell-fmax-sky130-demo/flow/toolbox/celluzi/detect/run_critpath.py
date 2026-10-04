#!/usr/bin/env python3
"""Run Method A on an OpenSTA path report and emit ranked candidates.json.

Usage: python3 detect/run_critpath.py <aes_paths.raw> <outdir>
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from detect.methods.critpath import parse_report, CritPathDetector


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else 'data/runs/aes_paths.raw'
    outdir = sys.argv[2] if len(sys.argv) > 2 else 'data/runs'
    paths = parse_report(open(raw).read())
    det = CritPathDetector()
    opps = det.detect_from_paths(paths)
    os.makedirs(outdir, exist_ok=True)
    json.dump([o.to_dict() for o in opps], open(os.path.join(outdir, 'candidates.json'), 'w'), indent=2)

    nreg = sum(p.reg2reg for p in paths)
    print(f"parsed {len(paths)} paths ({nreg} reg2reg); WNS={min((p.slack for p in paths), default=0):.4f}")
    print(f"{len(opps)} candidates (ranked by criticality x occurrence):")
    print(f"  {'id':24s} {'occ':>5s} {'pairs':>6s} {'interbuf_ns':>11s} {'score':>8s}")
    for o in opps:
        g = o.estimated_gain
        print(f"  {o.id:24s} {g['occurrences']:5d} {g['unique_pairs']:6d} "
              f"{g['interbuf_delay_ns']:11.4f} {o.score:8.2f}")
    print(f"wrote {outdir}/candidates.json")


if __name__ == '__main__':
    main()
