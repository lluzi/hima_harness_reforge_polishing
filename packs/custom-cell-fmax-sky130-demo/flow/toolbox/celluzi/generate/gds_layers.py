import pya
try: _p = gds          # injected via `-rd gds=...`
except NameError:
    import sys; _p = sys.argv[1]
ly = pya.Layout(); ly.read(_p); top = ly.top_cell()
b = top.bbox()
print("cell %s  bbox_um=(%.2f,%.2f)-(%.2f,%.2f)" % (top.name, b.left/1000., b.bottom/1000., b.right/1000., b.top/1000.))
names = {(64,20):'nwell',(65,20):'diff',(65,44):'tap',(93,44):'nsdm',(94,20):'psdm',
         (66,20):'poly',(66,44):'licon',(95,20):'npc',(67,20):'li1',(67,44):'mcon',
         (68,20):'met1',(255,0):'pwell_scratch'}
for li in ly.layer_indexes():
    info = ly.get_info(li); key = (info.layer, info.datatype)
    r = pya.Region(top.begin_shapes_rec(li))
    if not r.is_empty():
        bb = r.bbox()
        print("  %-9s %-13s y=[%.2f..%.2f]  x=[%.2f..%.2f]" % (
            str(key), names.get(key,'?'),
            bb.bottom/1000., bb.top/1000., bb.left/1000., bb.right/1000.))
