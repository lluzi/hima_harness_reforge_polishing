#!/usr/bin/env python3
"""Live QuaLib 2026 child: read ONE Liberty file with the vendor Liberty API and write the
combinational cell_rise/cell_fall tables of cells whose name matches a pattern as plain JSON.

Runs only under the vendor runtime (Python 3.7.12 + tmlib), one source per process, with the
licence selected by the Site's EDA environment script (licence mode `new`):

  bash --noprofile --norc -c '. "$EDA_INIT" >/dev/null 2>&1
    API=/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API
    exec env LIBERTY_API_HOME=$API PYTHONPATH=$API LD_LIBRARY_PATH=$API/lib \
      timeout 600 /data/eda/venvs/qualib-libapi-2026-py37/bin/python -X faulthandler \
      analysis/qualib_inv_tables.py SOURCE.lib OUT_DIR "^SAEDRVT14_INV_"'

OUT_DIR/tables.json receives {status, source{path, bytes, sha256, sha256After}, units, cells[...]}.
Exit codes: 0 ok | 2 usage/refused | 3 readTmlib returned a null handle (licence or parse) | 4 error.
A null handle is never dereferenced: calling name() on it is a SIGSEGV (exit 139).
"""
import hashlib
import json
import math
import os
import re
import sys
import time
import traceback


def sha256_file(path):
    value = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 22), b""):
            value.update(block)
    return value.hexdigest()


def write(out_dir, record):
    with open(os.path.join(out_dir, "tables.json"), "w") as stream:
        json.dump(record, stream, sort_keys=True, allow_nan=False)


def table_record(table):
    template = table.getTemplate()
    dimension = int(table.getDimension())
    values = [float(v) for v in table.getValues()]
    if any(not math.isfinite(v) for v in values):
        raise ValueError("non-finite table value")
    return {"kind": table.getTypeStr(),
            "template": None if template.isNull() else template.name(),
            "variables": [] if template.isNull() else [template.getVariableStr(d) for d in range(dimension)],
            "index": [[float(v) for v in table.getIndexData(d)] for d in range(dimension)],
            "values": values}


def main(argv):
    if len(argv) != 4:
        sys.stderr.write("usage: qualib_inv_tables.py SOURCE.lib OUT_DIR CELL_REGEX\n")
        return 2
    source, out_dir, pattern = os.path.abspath(argv[1]), os.path.abspath(argv[2]), re.compile(argv[3])
    if os.path.islink(source) or not os.path.isfile(source):
        sys.stderr.write("source must be a plain file\n")
        return 2
    if os.path.dirname(source) == out_dir:
        sys.stderr.write("refusing to write next to the source\n")
        return 2
    os.makedirs(out_dir, exist_ok=True)
    started = time.time()
    record = {"source": {"path": source, "bytes": os.path.getsize(source), "sha256": sha256_file(source)}}
    import tmlib  # the vendor module; only importable with PYTHONPATH/LD_LIBRARY_PATH set
    handle = None
    code = 0
    try:
        handle = tmlib.readTmlib(source, os.path.join(out_dir, "source.parser.log"))
        if handle.isNull():
            record["status"] = "null-handle"
            record["failure"] = ("readTmlib returned a null handle: licence checkout (feature Qualib_Liberty_API "
                                 "on the QuaLib 2026 service) or parse failure; see source.parser.log and stderr")
            code = 3
        else:
            units = {"time_s": float(handle.getTimeUnit()), "cap_F": float(handle.getCapUnit()),
                     "voltage_V": float(handle.getVoltageUnit()), "leakage_W": float(handle.getLeakagePowerUnit())}
            cells = []
            for cell in handle.getLibertyCells():
                if not pattern.search(cell.name()):
                    continue
                pins = []
                for pin in cell.getAllLibertyPins():
                    if pin.isPgPin():
                        continue
                    arcs = []
                    for arc in pin.getTimingGroups(False):
                        if arc.getTimingTypeStr() != "combinational":
                            continue
                        tables = [table_record(t) for t in arc.getDataGroups()
                                  if not t.isNull() and not t.isCcsModel() and not t.isVectorModel()
                                  and t.getTypeStr() in ("cell_rise", "cell_fall")]
                        arcs.append({"related_pin": arc.getRelatedPinName(), "tables": tables})
                    pins.append({"name": pin.name(), "direction": pin.getDirectionStr(),
                                 "cap": float(pin.getPinCap()), "arcs": arcs})
                cells.append({"name": cell.name(), "area": float(cell.getArea()), "pins": pins})
            record.update(status="ok", library=handle.name(), units=units, cells=cells)
    except Exception:
        record["status"] = "failed"
        record["failure"] = traceback.format_exc()
        code = 4
    finally:
        if handle is not None and not handle.isNull():
            tmlib.releaseTmlib(handle)
    record["source"]["sha256After"] = sha256_file(source)
    if record["source"]["sha256After"] != record["source"]["sha256"]:
        record["status"], code = "source-changed", 4
    record["elapsedSeconds"] = round(time.time() - started, 3)
    write(out_dir, record)
    print(json.dumps({"status": record["status"], "cells": len(record.get("cells", [])), "exit": code}))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
