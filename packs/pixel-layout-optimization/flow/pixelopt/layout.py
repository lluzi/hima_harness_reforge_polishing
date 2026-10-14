"""Pixel layouts: GDS in and out by the case manifest's layer map, tiles, and the small geometric
clean-ups the compactor relies on. Numeric module (numpy, shapely, gdstk)."""
from __future__ import annotations

import os

import numpy as np
import gdstk
from shapely.geometry import Polygon
from shapely.ops import unary_union

from .core import PixelError

ROUND = 4  # decimals kept on every coordinate (0.1 nm); the edit grid is the manifest's gridUm


class Layout:
    """`polys`: layer name -> list of (n, 2) float arrays, closed implicitly (no repeated last point).
    `labels`: list of (text, gds_layer, x, y)."""

    def __init__(self, polys=None, labels=None):
        self.polys = polys if polys is not None else {}
        self.labels = labels if labels is not None else []
        self.dropped = {}  # (layer, datatype) -> count of shapes on layers the manifest does not name

    def copy(self):
        out = Layout({k: [p.copy() for p in v] for k, v in self.polys.items()}, list(self.labels))
        out.dropped = dict(self.dropped)
        return out

    def outline(self, case):
        names = case.layers_with("outline")
        if not names or not self.polys.get(names[0]):
            raise PixelError("missing-input", "the layout has no shape on the outline layer")
        pts = np.vstack(self.polys[names[0]])
        lo, hi = pts.min(0), pts.max(0)
        return (float(lo[0]), float(lo[1])), (float(hi[0]), float(hi[1]))

    def pitch(self, case):
        (x0, y0), (x1, y1) = self.outline(case)
        return round(x1 - x0, 6), round(y1 - y0, 6)

    def geom(self, name):
        ps = [Polygon(p).buffer(0) for p in self.polys.get(name, []) if len(p) >= 3]
        return unary_union(ps) if ps else Polygon()


def load_gds(path, case, top=None):
    """Flattened polygons of the top cell (or `top`), by the manifest's GDS layer/datatype map."""
    lib = gdstk.read_gds(path)
    cells = {c.name: c for c in lib.cells}
    if top is not None:
        if top not in cells:
            raise PixelError("missing-input", "top cell %r not in %s" % (top, path))
        cell = cells[top]
    else:
        tops = lib.top_level()
        if len(tops) != 1:
            raise PixelError("missing-input", "%s has %d top cells; name one" % (path, len(tops)))
        cell = tops[0]
    gmap = case.gds_map()
    lay = Layout()
    for p in cell.get_polygons(apply_repetitions=True, include_paths=True):
        key = (int(p.layer), int(p.datatype))
        name = gmap.get(key)
        if name is None:
            lay.dropped[key] = lay.dropped.get(key, 0) + 1
            continue
        pts = np.round(np.array(p.points, dtype=float), ROUND)
        lay.polys.setdefault(name, []).append(pts)
    for lb in cell.get_labels(apply_repetitions=True, depth=None):
        lay.labels.append((str(lb.text), int(lb.layer), round(float(lb.origin[0]), ROUND), round(float(lb.origin[1]), ROUND)))
    return lay


def _cell(lay, case, name):
    c = gdstk.Cell(name)
    for n, ps in lay.polys.items():
        layer, datatype = case.layer(n)["gds"]
        for p in ps:
            c.add(gdstk.Polygon(p, layer=int(layer), datatype=int(datatype)))
    for t, ln, x, y in lay.labels:
        c.add(gdstk.Label(t, (x, y), layer=int(ln), texttype=0))
    return c


def save_gds(lay, path, case, top, tiles=None):
    """Write `lay` as cell `top`; with tiles=(nx, ny) the file's top is `<top><nx>x<ny>`, an array of
    `top` at the outline pitch."""
    lib = gdstk.Library(unit=1e-6, precision=1e-9)
    c = _cell(lay, case, top)
    lib.add(c)
    name = top
    if tiles:
        w, h = lay.pitch(case)
        nx, ny = tiles
        name = "%s%dx%d" % (top, nx, ny)
        t = gdstk.Cell(name)
        t.add(gdstk.Reference(c, (0, 0), columns=nx, rows=ny, spacing=(w, h)))
        lib.add(t)
    lib.write_gds(path)
    return name


def write_set(lay, directory, case):
    """pixel.gds, pixel2x2.gds, pixel3x3.gds in `directory`; returns {"1x1": [path, top], ...}."""
    os.makedirs(directory, exist_ok=True)
    top = case.raw["candidateTopCell"]
    out = {}
    for tag, fname, tiles in (("1x1", "pixel.gds", None), ("2x2", "pixel2x2.gds", (2, 2)), ("3x3", "pixel3x3.gds", (3, 3))):
        path = os.path.join(directory, fname)
        out[tag] = [path, save_gds(lay, path, case, top, tiles)]
    return out


def transpose(lay):
    out = Layout({n: [p[:, ::-1].copy() for p in ps] for n, ps in lay.polys.items()},
                 [(t, l, y, x) for t, l, x, y in lay.labels])
    out.dropped = dict(lay.dropped)
    return out


def _drop_collinear(pts):
    keep = []
    n = len(pts)
    for i in range(n):
        a, b, d = pts[i - 1], pts[i], pts[(i + 1) % n]
        if abs((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])) > 1e-9:
            keep.append(b)
    return keep


def merge_layers(lay, layers):
    """Merge overlapping or abutting polygons of each named layer into one outline per shape.
    A merged shape with a hole cannot be represented here and is refused."""
    out = lay.copy()
    for n in layers:
        g = unary_union([Polygon(p).buffer(0) for p in out.polys.get(n, []) if len(p) >= 3])
        parts = list(g.geoms) if hasattr(g, "geoms") else ([g] if not g.is_empty else [])
        new = []
        for q in parts:
            if q.area < 1e-6:
                continue
            if len(q.interiors):
                raise PixelError("schema", "%s: merged shape has a hole; keep its polygons separate" % n)
            keep = _drop_collinear(np.array(q.exterior.coords[:-1]))
            new.append(np.round(np.array(keep), ROUND))
        out.polys[n] = new
    return out


def clean(lay):
    """Drop repeated and collinear vertices; round to ROUND decimals."""
    out = lay.copy()
    for n in out.polys:
        new = []
        for p in out.polys[n]:
            keep = [p[i] for i in range(len(p)) if np.abs(p[i] - p[i - 1]).max() > 1e-9]
            if len(keep) < 3:
                continue
            q = _drop_collinear(keep)
            if len(q) >= 3:
                new.append(np.round(np.array(q), ROUND))
        out.polys[n] = new
    return out


def add_jogs(lay, axis, levels, layers):
    """Insert a potential jog (two coincident vertices) where an edge parallel to the motion's normal
    crosses a level: for an x pass, vertical edges are split at the y values in `levels`; for a y
    pass, horizontal edges at the x values."""
    k = 1 if axis == "x" else 0
    o = 1 - k
    out = lay.copy()
    for n in layers:
        new = []
        for p in out.polys.get(n, []):
            pts = []
            m = len(p)
            for i in range(m):
                a, b = p[i], p[(i + 1) % m]
                pts.append(a)
                if abs(a[o] - b[o]) < 1e-9:
                    lo, hi = sorted((a[k], b[k]))
                    for t in sorted(levels, reverse=b[k] < a[k]):
                        if lo + 0.2 < t < hi - 0.2:
                            q = a.copy()
                            q[k] = t
                            pts.append(q.copy())
                            pts.append(q.copy())
            new.append(np.array(pts))
        out.polys[n] = new
    return out


def sync_outline_copies(lay, case):
    """Layers with role `outline-copy` that the layout draws are redrawn as the outline polygon."""
    names = case.layers_with("outline")
    if not names:
        return lay
    out = lay.copy()
    for n in case.layers_with("outline-copy"):
        if n in lay.polys:
            out.polys[n] = [q.copy() for q in out.polys.get(names[0], [])]
    return out


def snap(lay, grid):
    """Every vertex onto the manifest grid."""
    out = lay.copy()
    for n in out.polys:
        out.polys[n] = [np.round(np.round(p / grid) * grid, ROUND) for p in out.polys[n]]
    out.labels = [(t, l, round(round(x / grid) * grid, ROUND), round(round(y / grid) * grid, ROUND)) for t, l, x, y in out.labels]
    return out
