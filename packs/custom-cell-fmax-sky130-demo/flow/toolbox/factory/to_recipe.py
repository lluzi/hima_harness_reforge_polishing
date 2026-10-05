#!/usr/bin/env python3
"""Turn a cell-factory run into round-recipe library entries (hima-cellfmax-round-recipe/1).

  python3 to_recipe.py <factory_out> <spec.json> <round> <workspace> [--out cells.json]

Copies every `clean` cell's source SPICE, GDS, LEF and Magic-extracted netlist into
<workspace>/cells/r<round>/lib/, writes <workspace>/cells/r<round>/library.lef (all clean macros)
and <workspace>/cells/r<round>/library.md (one row per spec cell with its factory outcome), and
prints (or writes) the recipe `library` object: {"lef": ..., "cells": [...]} with SHA-256 per file.
Spec cells may carry `compareTo` (nearest foundry cell; default derived from the name family is not
guessed: it is required) and an optional `footprint` (family footprint for non-drop-in cells).
Cells that are not clean are listed in library.md and left out of the recipe.
"""
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main(argv):
    if len(argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    factory, spec_path, k, ws = Path(argv[1]), Path(argv[2]), int(argv[3]), Path(argv[4])
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    spec = json.loads(spec_path.read_text())
    manifest = json.loads((factory / "manifest.json").read_text())
    state = {c["name"]: c for c in manifest["cells"]}
    lib_dir = ws / "cells" / ("r%d" % k) / "lib"
    lib_dir.mkdir(parents=True, exist_ok=True)
    cells, rows, macros, header = [], [], [], None
    for raw in spec["cells"]:
        name = raw["name"]
        st = state.get(name, {})
        outputs = raw["outputs"]
        inputs = raw.get("inputs") or sorted({v for f in outputs.values() for v in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", f)})
        rows.append("| %s | %s | %s | %s | %s |" % (
            name, "; ".join("%s=%s" % kv for kv in outputs.items()), raw.get("compareTo", "-"),
            st.get("state", "missing"), st.get("failure") or raw.get("notes") or ""))
        if st.get("state") != "clean":
            continue
        if not raw.get("compareTo"):
            raise SystemExit("spec cell %s needs compareTo (the nearest foundry cell)" % name)
        src = factory / name
        files = {}
        for key, suffix in (("sp", ".sp"), ("gds", ".gds"), ("lef", ".lef"), ("ext", ".ext.spice")):
            path = src / (name + suffix)
            if not path.is_file():
                raise SystemExit("clean cell %s has no %s" % (name, path))
            dest = lib_dir / path.name
            shutil.copyfile(path, dest)
            files[key] = os.path.relpath(dest, ws)
        lef_text = (src / (name + ".lef")).read_text()
        first = re.search(r"(?m)^\s*MACRO\s", lef_text)
        if header is None and first:
            header = lef_text[:first.start()]
        macro = re.search(r"(?ms)^\s*MACRO\s+%s\s*$.*?^\s*END\s+%s\s*$" % (re.escape(name), re.escape(name)), lef_text)
        macros.append(macro.group(0).strip("\n"))
        cell = {"name": name, "origin": "r%d" % k, "inputs": inputs, "outputs": list(outputs),
                "functions": outputs, "compareTo": raw["compareTo"], "layout": "drc-lvs-clean",
                "files": files, "sha256": {key: sha(ws / rel) for key, rel in files.items()}}
        if raw.get("footprint"):
            cell["footprint"] = raw["footprint"]
        cells.append(cell)
    lef_path = ws / "cells" / ("r%d" % k) / "library.lef"
    lef_path.write_text((header or "VERSION 5.7 ;\n").rstrip() + "\n\n" + "\n\n".join(macros) + "\n\nEND LIBRARY\n")
    (ws / "cells" / ("r%d" % k) / "library.md").write_text(
        "| cell | function | competes with | factory | note |\n| --- | --- | --- | --- | --- |\n" + "\n".join(rows) + "\n")
    library = {"lef": os.path.relpath(lef_path, ws), "cells": cells}
    text = json.dumps(library, indent=1)
    if out:
        Path(out).write_text(text)
    else:
        print(text)
    print("%d clean of %d spec cells -> %s" % (len(cells), len(spec["cells"]), lef_path), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
