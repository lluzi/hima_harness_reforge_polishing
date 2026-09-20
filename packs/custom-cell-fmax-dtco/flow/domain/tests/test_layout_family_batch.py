#!/usr/bin/env python3
"""Drive-family layout reuse and bounded cross-family concurrency."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


DOMAIN = Path(__file__).resolve().parents[1]


class LayoutFamilyBatchTests(unittest.TestCase):
    def test_one_placement_per_family_and_five_drive_outputs(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fake = root / "fake_abstract.py"
            trace = root / "trace.log"
            fake.write_text('''#!/usr/bin/env python3
import argparse,json,time,os
from pathlib import Path
p=argparse.ArgumentParser()
for name in ("netlist","tech","rule-deck","power-pin","ground-pin","drive-scale","placement-timeout"):
 p.add_argument("--"+name, required=True)
p.add_argument("-o","--out",required=True);p.add_argument("--placement-columns");p.add_argument("--placement-source-cell")
a=p.parse_args(); cell=Path(a.netlist).stem; out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
if a.placement_columns is None:
 with open(os.environ["LAYOUT_TRACE"],"a") as h: h.write("start %s %.9f\\n"%(cell,time.time()))
 time.sleep(0.4)
 with open(os.environ["LAYOUT_TRACE"],"a") as h: h.write("end %s %.9f\\n"%(cell,time.time()))
(out/(cell+".lef")).write_text("MACRO "+cell+"\\nEND "+cell+"\\n")
(out/(cell+".abstract.json")).write_text(json.dumps({"cell":cell,"columns":7,"drive_scale":float(a.drive_scale),"placement_columns":a.placement_columns,"placement_source_cell":a.placement_source_cell}))
''')
            rows = []
            for family in ("XS_A", "XS_B"):
                for drive, scale in (("D1", 1), ("D2", 2), ("D4", 4), ("D6", 6), ("D8", 8)):
                    cell = family + "_" + drive
                    netlist = root / (cell + ".sp")
                    netlist.write_text(".subckt %s A Y vdd gnd\\n.ends %s\\n" % (cell, cell))
                    rows.append({"cell": cell, "drive": drive, "drive_scale": scale,
                                 "family": family, "netlist": str(netlist),
                                 "out": str(root / "out" / cell)})
            manifest, result = root / "manifest.json", root / "result.json"
            manifest.write_text(json.dumps(rows))
            environment = dict(os.environ, LAYOUT_TRACE=str(trace))
            completed = subprocess.run([
                "/usr/bin/python3", str(DOMAIN / "layout_family_batch.py"),
                "--manifest", str(manifest), "--result", str(result),
                "--abstract-cell", str(fake), "--tech", "fixture-tech",
                "--rule-deck", "fixture-rules", "--power-pin", "vdd",
                "--ground-pin", "gnd", "--placement-timeout", "10",
                "--cell-timeout", "10", "--workers", "2",
            ], capture_output=True, text=True, env=environment)
            self.assertEqual(0, completed.returncode, completed.stderr)
            document = json.loads(result.read_text())
            self.assertEqual(2, document["family_count"])
            self.assertEqual(10, document["cell_count"])
            self.assertEqual(2, document["workers"])
            self.assertTrue(all(row["complete"] for row in document["results"]))
            for family in ("XS_A", "XS_B"):
                d1 = json.loads((root / "out" / (family + "_D1") /
                                 (family + "_D1.abstract.json")).read_text())
                self.assertIsNone(d1["placement_columns"])
                for drive in ("D2", "D4", "D6", "D8"):
                    meta = json.loads((root / "out" / (family + "_" + drive) /
                                       (family + "_" + drive + ".abstract.json")).read_text())
                    self.assertEqual("7", meta["placement_columns"])
                    self.assertEqual(family + "_D1", meta["placement_source_cell"])
            intervals = {}
            for line in trace.read_text().splitlines():
                kind, cell, stamp = line.split()
                intervals.setdefault(cell, {})[kind] = float(stamp)
            left, right = intervals["XS_A_D1"], intervals["XS_B_D1"]
            self.assertLess(max(left["start"], right["start"]),
                            min(left["end"], right["end"]),
                            "two D1 placements did not execute concurrently")


if __name__ == "__main__":
    unittest.main()
