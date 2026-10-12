#!/usr/bin/env python3
"""Negative LVS tests on a finished cell_layout.py run (in the tool image):

  negative_lvs.py <layout_out_dir> <cell> <device> <param>=<wrong value> [<model>=<wrong model>]

Writes a wrong reference (one device's parameter, or model, changed), then runs both LVS checks of
cell_layout.py against the unchanged layout: netgen on the Magic extraction (PNP names corrected as
in the run) and the PDK's KLayout deck. Both must report a mismatch. Results in
<layout_out_dir>/negative/<tag>/ and on stdout.
"""
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import cell_layout as cl  # noqa: E402


def main(argv):
    if len(argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    out, name, dev, change = Path(argv[1]).resolve(), argv[2], argv[3], argv[4:]
    tag = "%s-%s" % (dev, "-".join(c.replace("=", "") for c in change))
    d = out / "negative" / tag
    d.mkdir(parents=True, exist_ok=True)
    text = (out / ("%s_ref.spice" % name)).read_text().splitlines()
    hit = 0
    for i, line in enumerate(text):
        tok = line.split()
        if tok and tok[0] == dev:
            for c in change:
                k, v = c.split("=", 1)
                if k == "model":
                    model = [t for t in tok if "=" not in t][-1]
                    line = line.replace(" %s" % model, " %s" % v, 1)
                elif re.search(r"\b%s=\S+" % k, line):
                    line = re.sub(r"\b%s=\S+" % k, "%s=%s" % (k, v), line)
                else:
                    line += " %s=%s" % (k, v)
            text[i], hit = line, hit + 1
    if hit != 1:
        raise SystemExit("device %s found %d times" % (dev, hit))
    ref = d / ("%s_ref.spice" % name)
    ref.write_text("\n".join(text) + "\n")
    shutil.copy(out / ("%s_lvs.spice" % name), d / ("%s_lvs.spice" % name))
    shutil.copy(out / ("%s.gds" % name), d / ("%s.gds" % name))
    cl.lvs_reference(ref, name, d / ("%s_ref_netgen.spice" % name))
    rc, secs = cl.run(["netgen", "-batch", "lvs", "%s_lvs.spice %s" % (name, name), "%s_ref_netgen.spice %s" % (name, name), cl.NETGEN_SETUP,
                       "lvs.out", "-json"], d, d / "netgen.log")
    lvs = (d / "lvs.out").read_text()
    netgen_match = "Circuits match uniquely." in lvs and "Property errors were found" not in lvs and "do not match" not in lvs
    netgen_lines = sorted(set(re.findall(r"^(Final result:.*|Netlists do not match\.|.*Property errors.*|.*\(delta=.*|Circuits match uniquely\.)$", lvs, re.M)))
    k = cl.step_klayout_lvs(d, name, ref=ref)
    result = dict(change="%s %s" % (dev, " ".join(change)), netgenMatch=netgen_match, netgenLines=netgen_lines,
                  klayoutMatch=k["match"], klayoutLines=k["lines"], caught=not netgen_match and not k["match"])
    (d / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=1))
    return 0 if result["caught"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
