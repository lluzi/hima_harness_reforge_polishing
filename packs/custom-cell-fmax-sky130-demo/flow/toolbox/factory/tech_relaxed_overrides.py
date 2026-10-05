# FACTORY "relaxed" LibreCell profile: appended by factory.py to librecell_sky130_tech.py (lclayout
# loads tech files without __file__, so the combined file is written to <out>/.factory/).
# The contact enclosures go back to the celluzi values (li1 over licon 0, met1 over mcon 30, met1/met2
# over via 55). lclayout's router keeps metal clear of a via by the x enclosure in every direction, so
# the strict (80, 0) li1 pads make dense cells (xor2, xnor2, mux2i, ...) unroutable; here the router
# gets the old room and postprocess_cell.py adds li.5 / m1.5 / via.5a / m2.5 pads where they fit.
minimum_enclosure.update({
    (l_metal1, l_ndiff_contact): 0,
    (l_metal1, l_pdiff_contact): 0,
    (l_metal1, l_poly_contact): 0,
    (l_metal2, l_via1): 30,
    (l_metal2, l_via2): 55,
    (l_metal3, l_via2): 55,
})
