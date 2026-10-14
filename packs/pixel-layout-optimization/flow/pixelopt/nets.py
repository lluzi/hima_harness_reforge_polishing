"""Net extraction by the manifest's declared connectivity (numeric module).

Generalises the day-1 LVS-connectivity method (``.scratch/pixel-agent/tools/nets.py``)
through the case roles, so no layer or net name is hard-coded:

* The conductor pieces that take part in connectivity are the manifest's
  ``connectivity.topConductor`` and every layer named in
  ``connectivity.landingOrder``. The derived name ``PolySD`` is the
  poly-outside-gate region (``devices.polyLayer`` minus ``devices.gateLayer``)
  and is reported under the layer name ``"PolySD"``.
* A contact (``connectivity.contactLayer``) joins the ``topConductor`` pieces it
  overlaps to the first *present* ``landingOrder`` layer under it (the landing
  order is a priority list; the first layer that a contact actually overlaps is
  the one it lands on).
* ``connectivity.anodeVia`` (optional) joins the pieces of its ``joins`` layers
  that meet inside one of its via shapes. Its join layers and the manifest's
  ``nets.anodeLayers`` that are not already conductor pieces are added so the
  anode net carries its anode-layer shapes.
* Names come from labels: a label on GDS layer ``n`` names the shape of
  ``connectivity.labelLayers[str(n)]`` that contains it; a label whose target is
  the poly layer names the ``PolySD`` piece under it. A component with several
  labels is named by the sorted label texts joined with ``/``.

Channels are ``devices.polyLayer`` intersected with ``devices.gateLayer``.
"""
from __future__ import annotations

from shapely.geometry import Point
from shapely.ops import unary_union

_AREA_EPS = 1e-9


def _parts(g):
    """Flatten a (possibly multi-part / empty) geometry into a list of polygons."""
    if g is None or g.is_empty:
        return []
    return list(g.geoms) if hasattr(g, "geoms") else [g]


class _DSU(object):
    """Tiny union-find over shape indices."""

    def __init__(self, n):
        self.parent = list(range(n))

    def find(self, i):
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, i, j):
        self.parent[self.find(i)] = self.find(j)


def extract(lay, case):
    """Extract nets, channels and unnamed component ids from a layout.

    Returns ``{"nets": {name: [(layer, geom)]}, "channels": [geom], "unnamed": [id]}``.
    ``unnamed`` lists the synthetic ids (``net<root>``) of components that no
    label named; those components are also present in ``nets`` under the same id.
    """
    conn = case.raw["connectivity"]
    devices = case.raw["devices"]
    poly_layer = devices["polyLayer"]
    gate_layer = devices["gateLayer"]
    top_conductor = conn["topConductor"]
    contact_layer = conn["contactLayer"]
    landing_order = list(conn["landingOrder"])

    poly_g = lay.geom(poly_layer)
    gate_g = lay.geom(gate_layer)
    psd_g = poly_g.difference(gate_g)

    channels = [p for p in _parts(poly_g.intersection(gate_g)) if p.area > _AREA_EPS]

    # ---- the conductor pieces -------------------------------------------- #
    shapes = []  # [display_layer, geom]

    def disp_of(name):
        return "PolySD" if name == "PolySD" else name

    def add_pieces(disp, geom):
        for p in _parts(geom):
            if p.area > _AREA_EPS:
                shapes.append([disp, p])

    add_pieces(top_conductor, lay.geom(top_conductor))
    for name in landing_order:
        if name == "PolySD":
            add_pieces("PolySD", psd_g)
        else:
            add_pieces(name, lay.geom(name))

    anode_via = conn.get("anodeVia")
    extra = []
    if anode_via:
        extra.extend(anode_via.get("joins", []))
    extra.extend(case.raw.get("nets", {}).get("anodeLayers", []))
    present = set(s[0] for s in shapes)
    for name in extra:
        if name != "PolySD" and name not in present:
            add_pieces(name, lay.geom(name))
            present.add(name)

    dsu = _DSU(len(shapes))

    # ---- contacts: topConductor to the first present landing layer -------- #
    for c in _parts(lay.geom(contact_layer)):
        tops = [i for i, (n, g) in enumerate(shapes)
                if n == top_conductor and g.intersection(c).area > _AREA_EPS]
        landed = []
        for name in landing_order:
            d = disp_of(name)
            hits = [i for i, (n, g) in enumerate(shapes)
                    if n == d and g.intersection(c).area > _AREA_EPS]
            if hits:
                landed = hits
                break
        group = tops + landed
        for i in group[1:]:
            dsu.union(i, group[0])

    # ---- anode via: join its layers inside each via shape ----------------- #
    if anode_via:
        joins = set(anode_via.get("joins", []))
        for c in _parts(lay.geom(anode_via["layer"])):
            hits = [i for i, (n, g) in enumerate(shapes)
                    if n in joins and g.intersection(c).area > _AREA_EPS]
            for i in hits[1:]:
                dsu.union(i, hits[0])

    # ---- names from labels ------------------------------------------------ #
    label_layers = conn.get("labelLayers", {})
    names = {}  # root -> set(text)
    for text, ln, x, y in lay.labels:
        key = str(int(ln))
        target = label_layers.get(key)
        if target is None:
            continue
        d = disp_of("PolySD" if target == poly_layer else target)
        pt = Point(x, y)
        for i, (n, g) in enumerate(shapes):
            if n == d and (not g.is_empty) and g.buffer(1e-4).contains(pt):
                names.setdefault(dsu.find(i), set()).add(str(text))

    nets = {}
    unnamed = []
    for i, (n, g) in enumerate(shapes):
        r = dsu.find(i)
        if r in names:
            nm = "/".join(sorted(names[r]))
        else:
            nm = "net%d" % r
            if nm not in unnamed:
                unnamed.append(nm)
        nets.setdefault(nm, []).append((n, g))

    return {"nets": nets, "channels": channels, "unnamed": unnamed}
