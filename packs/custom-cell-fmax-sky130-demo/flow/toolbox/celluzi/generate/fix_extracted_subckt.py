#!/usr/bin/env python3
# Turn a Magic-extracted cell subckt into a CharLib-ready cell:
#   - expose the output node + the well/bulk nodes as ports
#   - give power/ground/wells the standard CharLib names (VPWR/VGND/VPB/VNB)
# The nfet/pfet bulk node names (VSUBS, w_nn_nn#) are auto-detected from the device lines so this
# works run-to-run. Usage: fix_extracted_subckt.py <in.spice> <out.spice> "<.subckt PORT LINE>"
import sys
inp, outp, subckt_line = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(inp).read().splitlines()

nfet_bulk = pfet_bulk = None
for ln in lines:
    t = ln.split()
    if len(t) > 5 and t[0][:1] in "xX":          # device: X<n> d g s b model ...
        if "nfet" in t[5]: nfet_bulk = t[4]
        elif "pfet" in t[5]: pfet_bulk = t[4]
ren = {"GND": "VGND", "VDD": "VPWR"}
if nfet_bulk: ren[nfet_bulk] = "VNB"
if pfet_bulk: ren[pfet_bulk] = "VPB"

out = []
for ln in lines:
    s = ln.strip().lower()
    if s.startswith(".subckt"):
        out.append(subckt_line)
    else:
        out.append(" ".join(ren.get(tok, tok) for tok in ln.split()))
open(outp, "w").write("\n".join(out) + "\n")
print("bulks detected: nfet=%s->VNB  pfet=%s->VPB" % (nfet_bulk, pfet_bulk))
print("wrote", outp)
