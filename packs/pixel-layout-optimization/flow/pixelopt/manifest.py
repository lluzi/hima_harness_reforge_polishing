"""Case manifest and site-capabilities readers (stdlib only).

``load_case`` schema-checks a ``pixel.case-manifest/1`` and re-verifies the
SHA-256 of *every* ``{path, sha256}`` file reference anywhere in the manifest,
naming the offending field on mismatch. Relative paths resolve from the
manifest's own directory.
"""
from __future__ import annotations

import os

from . import core
from .core import PixelError


class Case(object):
    """A thin read-only wrapper over a ``pixel.case-manifest/1`` dict."""

    def __init__(self, raw, root):
        self.raw = raw
        self.root = root

    # -- file references ---------------------------------------------------- #
    def file(self, ref):
        """Absolute path of a ``{path, sha256}`` file reference."""
        path = ref["path"]
        if os.path.isabs(path):
            return path
        return os.path.normpath(os.path.join(self.root, path))

    # -- layers ------------------------------------------------------------- #
    def layer(self, name):
        return self.raw["layers"][name]

    def layers_with(self, role):
        """Layer names (in manifest order) whose ``roles`` include ``role``."""
        out = []
        for name, spec in self.raw["layers"].items():
            if role in spec.get("roles", []):
                out.append(name)
        return out

    def gds_map(self):
        """``(layer, datatype) -> name`` from each layer's ``gds`` pair."""
        out = {}
        for name, spec in self.raw["layers"].items():
            gds = spec.get("gds")
            if isinstance(gds, (list, tuple)) and len(gds) == 2:
                out[(int(gds[0]), int(gds[1]))] = name
        return out

    # -- convenience -------------------------------------------------------- #
    @property
    def case_id(self):
        return self.raw.get("caseId")

    @property
    def grid_um(self):
        return self.raw.get("gridUm")

    @property
    def candidate_top_cell(self):
        return self.raw.get("candidateTopCell")


def _walk_refs(node, breadcrumb):
    """Yield ``(field_path, ref_dict)`` for every file reference in ``node``."""
    results = []
    if isinstance(node, dict):
        if isinstance(node.get("path"), str) and isinstance(node.get("sha256"), str):
            results.append((breadcrumb or "$", node))
            return results
        for key, value in node.items():
            child = (breadcrumb + "." + key) if breadcrumb else key
            results.extend(_walk_refs(value, child))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            results.extend(_walk_refs(value, "%s[%d]" % (breadcrumb, i)))
    return results


def load_case(path, verify=True):
    """Load, schema-check and (by default) digest-verify a case manifest."""
    raw = core.read_json(path)
    core.check(raw, "case-manifest")
    root = os.path.dirname(os.path.abspath(path))
    case = Case(raw, root)
    if verify:
        for field, ref in _walk_refs(raw, ""):
            abspath = case.file(ref)
            try:
                actual = core.sha256_file(abspath)
            except OSError:
                raise PixelError("digest-mismatch",
                                 "%s: file missing (%s)" % (field, abspath))
            if actual != ref["sha256"]:
                raise PixelError(
                    "digest-mismatch",
                    "%s: expected %s, found %s" % (field, ref["sha256"], actual))
    return case


def load_sitecaps(path):
    """Load and schema-check a ``pixel.site-capabilities/1`` document."""
    raw = core.read_json(path)
    core.check(raw, "site-capabilities")
    return raw
