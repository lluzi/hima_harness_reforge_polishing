# FACTORY "-m1" LibreCell profiles (strict-m1, relaxed-m1): appended by factory.py after the base
# tech (and, for relaxed-m1, after tech_relaxed_overrides.py). LibreCell routes inside the cell in
# li1 and met1 only, like sky130_fd_sc_hd, so met2 stays free above the met1 pins.
# Why: OpenROAD reaches a met1 pin of a standard cell from met2 (a via1 on the pin). LibreCell's
# met2 wires run between the gate columns, 0.03-0.07 um from the neighbouring pins, and the met1
# pins of adjacent inputs sit 0.21 um apart on the same track, so the router found no access point
# for 90 of 149 factory-clean cells of the 2026-10-04 library (DRT-0073 at global route).
routing_layers = {k: v for k, v in routing_layers.items() if k is not l_metal3}
