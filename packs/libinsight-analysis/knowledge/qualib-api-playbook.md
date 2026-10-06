# QuaLib API and facts-mode playbook (linglong)

You answer one custom library-analysis question by writing and running code on linglong, then
deliver one `hima-libinsight-analysis/1` result (see `custom-analysis-contract.md`). This file
says where you run, which two runtimes exist, the exact commands that were verified, and what you
must never do. Everything here comes from the qualified QuaLib probes (`qualify-libapi.py`, the
library-intelligence `libapi_worker.py`), LibInsight's extractor `libapi_extract.py` /
`run_extract.sh`, and the 2026-10-05 runs recorded below.

## 1. Where you are

- You run inside a task-local Podman container (image `localhost/edarunner:alma8`, AlmaLinux 8).
  Your current directory is your **private workspace** (read-write). Put every script under
  `analysis/` there; it is the Pack artifact prefix that the Host copies back.
- The Campaign workspace (`identity.campaignWorkspace` in your task) is mounted **read-only**. It
  holds `state/prepared-request.json` (your sources, their sha256, the facts corpus listing, the
  admitted-analysis catalog) and `flow/libinsight_cli.py` (the delivery self-check).
- Read-only roots: `/data/eda/env`, `/data/eda/software/eda_tools/empyrean`,
  `/data/eda/venvs/qualib-libapi-2026-py37`, `/data/eda/pdk/saed14`, `/data/eda/project/techlib/tsmc28`,
  the facts corpus, `libinsight-runs/library` and `libinsight-runs/requests`. Nothing else on the
  Site is visible. `/tmp` is a small tmpfs.
- The container entry sourced `EDA_INIT` (`/data/eda/env/eda_tools_2025_env.sh`), which reads the
  Site's Empyrean licence mode from `/data/eda/env/empyrean-license-mode` and sets
  `EMPYREAN_LICENSE_MODE`, `QUALIB_HOME` and `EMPYREAN_LICENSE_FILE` from it (section 3). Those
  values are a snapshot of the moment your container started.
- `edarun` and `podman` do not exist inside the container. Never try to call them; you are already
  inside the EDA image.
- Python: `/usr/bin/python3` is **3.6.8**; the vendor runtime is 3.7.12. Neither has numpy.
  Write Python 3.6-compatible code (f-strings are fine; no walrus `:=`, no `dataclasses`, no
  `from __future__ import annotations`, no `Path.is_relative_to`). LibInsight's own engine needs
  numpy, so do not import it here; read facts files with `gzip` + `json` instead.

## 2. Choose the mode

| Mode | Use when | Runtime | Licence |
| --- | --- | --- | --- |
| **Facts** (default) | The question can be answered from Liberty data already extracted by QuaLib: cells, pins, areas, leakage, NLDM timing/power tables, templates, units | `/usr/bin/python3` over `lib-insight-facts/1` `.json.gz` files | none |
| **Live QuaLib** | You need the vendor API itself: a `.lib` that has no facts file, an attribute the extractor did not keep, or a QuaLib-only operation | vendor Python 3.7 + `tmlib` | Site licence mode `new` (QuaLib 2026 service on port 59099) |

Prefer facts mode. The prepared request lists every facts file in the corpus with the path and
sha256 of the Liberty source it was extracted from (`factsCorpus.files[].liberty`). A request
source that is a `.json.gz` is a facts source; a `.lib` source is a Liberty source. When the user
named a `.lib` and the corpus has a facts file whose `liberty.sha256` equals that source's sha256,
the facts file is the same library: you may add it as an additional `facts` source (section 7).

## 3. Licence rules (read before any live QuaLib call)

- `tmlib.readTmlib` checks out feature `Qualib_Liberty_API`. Only the QuaLib 2026 licence service
  serves it: licence file `license/qualib-2026.06.linglong.dat`, whose `SERVER` line names port
  **59099**. The Empyrean 2025 service (`license/license.dat`, port 59001, used by XTop) rejects
  it with FlexNet `-8,544` "Invalid (inconsistent) license key".
- linglong runs one of the two services at a time. The operator switches between them with
  `empyrean-license new` (QuaLib work) and `empyrean-license old` (XTop work); it needs sudo, and it
  refuses while an Empyrean client runs or a licence is checked out. The current mode is the one
  word in `/data/eda/env/empyrean-license-mode`. In mode `new`, sourcing `EDA_INIT` sets
  `QUALIB_HOME=.../qualib-2026.06.sp1` and `EMPYREAN_LICENSE_FILE=59099@localhost`; in mode `old` it
  sets `59001@localhost`.
- `prepared-request.json` records the mode at preparation in `licence` (`mode`,
  `liveQualibAvailable`, `liveQualibRequiredFor`) and, for each `.lib` source, the corpus facts files
  of the same Liberty bytes in `factsAlternatives`.
- **Check the mode before any live QuaLib call:** `cat /data/eda/env/empyrean-license-mode`. If it
  is not `new`, do not call QuaLib. Answer in facts mode if the facts exist, otherwise deliver a
  blocked status analysis (section 8) whose `stopReason` and `limits` say exactly:
  "linglong's Empyrean licence is in XTop mode; the operator switches it with `empyrean-license new`
  (and back with `empyrean-license old` before XTop work)". prepare-request already refuses a
  request whose `.lib` source has no facts file while the mode is not `new`.
- Take the licence from the environment script: source `EDA_INIT` in the QuaLib command (section 4)
  so it reflects the current mode; do not hard-code a port.
- **Never** run `empyrean-license`, `sudo`, `lmgrd`, `lmutil` or anything that starts, stops or
  switches a licence service; never edit the mode file or any file under `/data/eda/env`; never set
  `EMPYREAN_LICENSE_MODE` or `EMPYREAN_LICENSE_FILE_OVERRIDE`; never read or print licence files.
- A **null handle** from `readTmlib` means the licence checkout (or the parse) failed. FlexNet
  `-15,570` "Cannot connect to license server" (nothing listens on 59099) or `-8,544` both mean
  the QuaLib licence service is unavailable. Do not retry in a loop or try other ports; deliver
  blocked as above.
- The Site grants one `QuaLib-2026-new-59099` seat to this whole task: run **at most one QuaLib
  process at a time**, never in parallel, never in the background after you deliver.

## 4. Live QuaLib runtime

One Liberty source per process, from your private workspace:

```sh
test "$(cat /data/eda/env/empyrean-license-mode)" = new || { echo "licence mode is not new"; exit 3; }
bash --noprofile --norc -c '. "$EDA_INIT" >/dev/null 2>&1
  API=/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API
  exec env LIBERTY_API_HOME=$API PYTHONPATH=$API LD_LIBRARY_PATH=$API/lib \
    timeout 600 /data/eda/venvs/qualib-libapi-2026-py37/bin/python -X faulthandler \
    analysis/qualib_inv_tables.py /data/eda/pdk/saed14/stdcell_rvt/db_nldm/saed14rvt_tt0p8v25c.lib analysis/out "^SAEDRVT14_INV_"'
```

`analysis/qualib_inv_tables.py` is the complete live child in Appendix A: it reads one `.lib`,
writes `<OUT_DIR>/tables.json` with the cell_rise/cell_fall tables of the matching cells, and exits
3 on a null handle. Give it an `OUT_DIR` under `analysis/` (for example `analysis/out`) so the
intermediate JSON can be delivered as a code file. `analysis/live_inv_delivery.py` (Appendix B) is
the plain `python3` second step that turns that JSON into the delivery.

Verification record (2026-10-05, inside the edarunner image with your sandbox's read-only mounts,
one QuaLib process at a time, source sha256 `49962e1b…2571` unchanged every time):

- **Licence mode `new`, successful handle.** The command above (container entry sourced `EDA_INIT`:
  `EMPYREAN_LICENSE_MODE=new`, `EMPYREAN_LICENSE_FILE=59099@localhost`; no override) read
  `saed14rvt_tt0p8v25c` in 0.79 s and exited 0 with the 45 cells matching `^SAEDRVT14_INV_`
  (`INV`, `INV_S`, `INV_ECO`, `INV_PECO`). All 92 cell_rise/cell_fall tables it returned equal, value for value and index for
  index, the same tables in the corpus facts file `saed14rvt_tt0p8v25c.json.gz` (extracted
  2026-09-23). The second step `analysis/live_inv_delivery.py` (Appendix B) built a
  `usedQualib: true` delivery (46 arcs, 2 plots) that passed `check-delivery` inside the sandbox
  image and the Pack Reader on the host. prepare-request had recorded
  `licence: {mode: new, liveQualibAvailable: true, liveQualibRequiredFor: [the .lib]}`.
- **Licence mode `old`, null handle.** Before the switch, the same child with
  `EMPYREAN_LICENSE_FILE=59099@localhost` forced on the command got a null handle, FlexNet
  `-15,570` (nothing listening on 59099), wrote `status: null-handle` and exited **3** without a
  segfault. Through `edarun` with only the 2025 service up, the probe got FlexNet `-8,544`.

Rules for every live child process:

- `-X faulthandler` prints a native stack if the vendor library crashes; exit 139 is a SIGSEGV.
- Use a `timeout`: the qualification used 30 s for the vendor fixture and 180 s for a
  representative library; corpus extraction used 1800 s for the largest files.
- Check `handle.isNull()` immediately after `readTmlib(path, parser_log)`. Calling `name()` or
  anything else on a null handle dereferences it and segfaults.
- Release every non-null handle with `tmlib.releaseTmlib(handle)` in a `finally`.
- Never write beside the source: refuse when the output directory equals the source's directory.
  The parser log path is yours to choose; keep it in the private workspace.
- `outputLib(copy_path)` writes a full Liberty copy; only use it on a path in your private workspace
  and never deliver Liberty text.
- Exit codes (extractor convention): 0 ok, 2 usage/refused, 3 null handle, 4 extraction error,
  5 round-trip mismatch; `timeout` gives 124.
- Let the vendor child write plain JSON numbers; do the analysis and the delivery in a second plain
  `python3` step, so a native crash cannot leave a half-written delivery.

## 5. Liberty API names that the verified scripts use

Only these calls appear in the qualified probes and the LibInsight extractor. Anything else may
exist in `tmlib.py` but is unverified; read `$API/tmlib.py` before relying on it.

- Module: `tmlib.readTmlib(path, parser_log_path)`, `tmlib.releaseTmlib(handle)`.
- Library handle: `isNull()`, `name()`, `getTimeUnit()`, `getCapUnit()`, `getVoltageUnit()`,
  `getResUnit()`, `getCurrentUnit()`, `getLeakagePowerUnit()`, `getDynamicPowerUnit()` (SI scale of
  one library unit, e.g. `1e-09` for ns), `getAllAttributes()`, `getAllSubGroups()`,
  `getLibertyCells()`, `outputLib(path)`.
- Sub-group: `groupType()` (e.g. `operating_conditions`, `lu_table_template`, `ff`), `name()`,
  `convertToTemplateGroup()` → `getDimension()`, `getVariableStr(i)`, `getIndex(i)`;
  `convertToCommonGroup().names()` for `ff`/`latch` groups.
- Cell: `name()`, `getArea()`, `getFootPrint()`, `isDff()`, `isLatch()`, `isClockGating()`,
  `isIntegratedClockGatingCell()`, `isMemory()`, `getAllAttributes()`, `getLeakagePowers()` (each:
  `getWhen()`, `getValue()`, `getRelatedPGName()`), `getAllLibertyPins()`, `getAllSubGroups()`.
- Pin: `name()`, `isPgPin()`, `convertToPgPin().getPgTypeStr()`, `getDirectionStr()`,
  `isClockPin()`, `isBusPin()`, `isBusBitPin()`, `getPinCap()`, `getTimingGroups(False)`,
  `getPowerGroups(False)`, `getCapacitanceGroups()`, `getAllSubGroups()`.
- Timing group: `getRelatedPinName()`, `getTimingTypeStr()`, `getTimingSenseStr()`, `getWhen()`,
  `getSDFCondition()`, `getDataGroups()`, `getCCSDataGroups()`.
- Power group: `getRelatedPinName()`, `getRelatedPGName()`, `getWhen()`, `getDataGroups()`.
- Table (data group): `isNull()`, `isCcsModel()`, `isVectorModel()` (skip both: NLDM only),
  `getTypeStr()` (`cell_rise`, `rise_transition`, `rise_power`, ...), `getSigmaTypeStr()`,
  `getTemplate()` (`isNull()`, `name()`, `getVariableStr(d)`), `getDimension()`, `getDimSize(d)`,
  `getIndexData(d)`, `getValues()`.
- Attribute: `getAttrTypeStr()`, `isNull()`, `isComplex()`, `getAttrValueSize()`, `getValue()` /
  `getValue(i)` returning a tuple whose first two items are `(ok, value)`.
- SWIG containers (`DoubleVector`, `CStringVector`, cell/pin vectors) support `size()`, `[i]`,
  `len()` and iteration; convert with `list(...)`/`float(...)` before JSON.

Units: values are in library units; multiply by the matching SI scale. A table's unit follows its
kind: delays/transitions/constraints in time units, `*_power` (internal power) is energy in
`cap × voltage²`, capacitance kinds in cap units. Index units follow the template variable:
`input_net_transition`/`input_transition_time`/`related_pin_transition` → time,
`total_output_net_capacitance` → cap. Values are row-major over `index_1` then `index_2`.
Liberty area is unitless.

## 6. Facts-mode runtime (verified end to end)

```sh
python3 analysis/<your_script>.py --prepared <campaignWorkspace>/state/prepared-request.json \
    --facts <facts .json.gz> --out analysis-result.json --candidate resident-delivery.json
```

Verified 2026-10-05: `example-custom-analysis.md` ran this with `/usr/bin/python3` 3.12.3 on
linglong (1.46 s) and with `python3` 3.6.8 inside the edarunner image with the sandbox mount
shape (1.72 s) on the 20 MB SAED14 facts file; both deliveries passed `check-delivery`, and the
host delivery then passed the Pack Reader, `admit-analysis` and `deliver`. Facts layout:
`facts-schema.md`.

## 7. Hashing and sources

- Hash every file you read with SHA-256 **before** and **after** the run, from your script, and
  compare the before hash with `prepared-request.json`. Record each in `sources[]` with
  `sha256Before`/`sha256After`; a facts source also carries `libertySha256` = its embedded
  `source.sha256`.
- Answer every prepared source: list it, or for a `.lib` list a facts file from its
  `factsAlternatives` (a facts entry whose `libertySha256` is that `.lib`'s sha256).
- A source not in the prepared request is allowed only under the prepared `readRoots`, when both
  hashes are equal and the file still hashes the same when the Reader re-hashes it on the Site.

## 8. Delivering

1. Write `analysis-result.json` (the result) and keep every script under `analysis/`.
2. Run the self-check from your private workspace and fix every line it prints:
   `python3 <campaignWorkspace>/flow/libinsight_cli.py check-delivery . analysis-result.json`
3. Write `resident-delivery.json`: `{schema: "hima-resident-engineering-candidate/1", outcome,
   summary, stopReason, artifacts: [{path, sha256, kind}]}` with exactly one `kind: "result"`
   (`analysis-result.json`) and every `analysis/...` file as `kind: "support"`.
4. Blocked (licence unavailable, a source unreadable): deliver a valid status analysis — a `status`
   dataset recording what you tried and observed (command, exit code, FlexNet code, source hashes), a
   `table` plot, the reason in `summary` and `limits` — from a status script that exits 0, and set the
   candidate `outcome: "blocked"` with the reason in `stopReason`. It is shown to the user and is
   **not** admitted into the library. Never present guessed numbers as results.

## 9. Never

- No licence changes of any kind (section 3); no network access; no package installs.
- No writes outside your private workspace; never beside a source; never into the library (only
  `admit-analysis` writes there).
- No more than one QuaLib process at a time; no background processes left running.
- No Liberty text, licence text, credentials or tokens in the delivery, the summary or logs you
  deliver. Cell names and numbers are fine.

## Appendix A. `analysis/qualib_inv_tables.py` (live QuaLib child)

Copy it to `analysis/` and adapt the cell pattern and the tables you keep. It needs the vendor
runtime of section 4.

<!-- BEGIN qualib_inv_tables.py -->
```python
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
```
<!-- END qualib_inv_tables.py -->

## Appendix B. `analysis/live_inv_delivery.py` (plain python3 second step)

Run it after the live child, from your private workspace, with `--command` set to the exact live
command. It lists the child script and the intermediate JSON in `code.files`.

<!-- BEGIN live_inv_delivery.py -->
```python
#!/usr/bin/env python3
"""Plain-python3 second step of a live QuaLib analysis: turn the vendor child's out/tables.json into a
hima-libinsight-analysis/1 result (mid-grid cell_rise/cell_fall per matching cell).

  python3 analysis/live_inv_delivery.py --prepared <campaign>/state/prepared-request.json \
      --tables out/tables.json --command "<the exact live command>" --out analysis-result.json
"""
import argparse
import hashlib
import json
import os


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepared", required=True)
    parser.add_argument("--tables", required=True)
    parser.add_argument("--command", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--id", default="saed14-inv-live-tables")
    args = parser.parse_args()
    prepared = json.load(open(args.prepared))
    live = json.load(open(args.tables))
    if live["status"] != "ok":
        raise SystemExit("live child did not succeed: %s" % live.get("failure"))
    source = live["source"]
    bound = [s for s in prepared["sources"] if s["path"] == source["path"]]
    if len(bound) != 1 or bound[0]["sha256"] != source["sha256"]:
        raise SystemExit("the live source is not the prepared source bytes")
    to_ns, to_ff = live["units"]["time_s"] / 1e-9, live["units"]["cap_F"] / 1e-15
    rows = []
    for cell in live["cells"]:
        for pin in cell["pins"]:
            for arc in pin["arcs"]:
                kinds = dict((t["kind"], t) for t in arc["tables"])
                if "cell_rise" not in kinds or "cell_fall" not in kinds:
                    continue
                rise, fall = kinds["cell_rise"], kinds["cell_fall"]
                i, j = len(rise["index"][0]) // 2, len(rise["index"][1]) // 2
                at = i * len(rise["index"][1]) + j
                rows.append([cell["name"], pin["name"], arc["related_pin"], cell["area"],
                             rise["index"][0][i] * to_ns, rise["index"][1][j] * to_ff,
                             rise["values"][at] * to_ns, fall["values"][at] * to_ns])
    rows.sort()
    script = os.path.abspath(__file__)
    text = open(script, "rb").read().decode("utf-8")
    tables_path = os.path.relpath(os.path.abspath(args.tables), os.getcwd()).replace(os.sep, "/")
    result = {
        "schema": "hima-libinsight-analysis/1", "id": args.id, "version": 1,
        "question": prepared["request"]["question"],
        "summary": "%d combinational arcs of %d cells read live through the QuaLib 2026 Liberty API from %s; "
                   "mid-grid cell_rise ranges %.4g-%.4g ns." % (len(rows), len(live["cells"]), live["library"],
                                                                min(r[6] for r in rows), max(r[6] for r in rows)),
        "sources": [{"path": source["path"], "kind": "liberty", "sha256Before": source["sha256"],
                     "sha256After": source["sha256After"]}],
        "datasets": {"live_mid_grid": {"columns": [
            {"name": "cell", "type": "string"}, {"name": "pin", "type": "string"}, {"name": "related_pin", "type": "string"},
            {"name": "area", "type": "number", "unit": "library area"}, {"name": "slew_ns", "type": "number", "unit": "ns"},
            {"name": "load_fF", "type": "number", "unit": "fF"}, {"name": "cell_rise_ns", "type": "number", "unit": "ns"},
            {"name": "cell_fall_ns", "type": "number", "unit": "ns"}], "rows": rows}},
        "plots": [{"id": "live-rise-by-cell", "title": "Mid-grid cell_rise by cell (live QuaLib)", "kind": "bar",
                   "dataset": "live_mid_grid", "x": {"column": "cell"}, "y": {"column": "cell_rise_ns", "label": "cell_rise (ns)"}},
                  {"id": "live-table", "title": "Live QuaLib mid-grid tables", "kind": "table", "dataset": "live_mid_grid"}],
        "code": {"main": {"path": os.path.relpath(script, os.getcwd()).replace(os.sep, "/"),
                          "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "text": text},
                 "files": [{"path": "analysis/qualib_inv_tables.py", "sha256": hashlib.sha256(open("analysis/qualib_inv_tables.py", "rb").read()).hexdigest()},
                           {"path": tables_path, "sha256": hashlib.sha256(open(args.tables, "rb").read()).hexdigest()}]},
        "run": {"command": args.command, "exitCode": 0, "elapsedSeconds": live["elapsedSeconds"], "usedQualib": True},
        "assumptions": ["Mid grid is the middle index of each table axis; the grids are not normalized across cells."],
        "limits": ["One TT corner; values are read at one table point, not interpolated."],
    }
    with open(args.out, "w") as stream:
        json.dump(result, stream, sort_keys=True, allow_nan=False)
    print(json.dumps({"out": args.out, "rows": len(rows)}))


if __name__ == "__main__":
    main()
```
<!-- END live_inv_delivery.py -->
