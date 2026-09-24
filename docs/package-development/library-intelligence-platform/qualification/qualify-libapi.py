#!/usr/bin/env python3
"""One-source, bounded QuaLib 2026 API read/query/copy/re-read qualification."""
import hashlib
import json
import math
import os
import sys
import time
import traceback

import tmlib


def digest(path):
    value = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def snapshot(lib):
    name = lib.name()
    units = {}
    for key, method in [('time_s', 'getTimeUnit'), ('cap_F', 'getCapUnit'), ('voltage_V', 'getVoltageUnit')]:
        value = float(getattr(lib, method)())
        if not math.isfinite(value) or value <= 0:
            raise RuntimeError('invalid ' + key + ' from native API')
        units[key] = value
    cells = lib.getLibertyCells()
    count = cells.size()
    if count <= 0:
        raise RuntimeError('native API returned no Cells')
    for index in range(count):
        cell = cells[index]
        for pin in cell.getAllLibertyPins():
            if pin.isPgPin():
                continue
            timing = pin.getTimingGroups(False)
            for arc_index in range(timing.size()):
                arc = timing[arc_index]
                data = arc.getDataGroups()
                for table_index in range(data.size()):
                    table = data[table_index]
                    if table.isCcsModel() or table.isVectorModel():
                        continue
                    values = table.getValues()
                    if values.size() == 0:
                        continue
                    first = float(values[0])
                    if not math.isfinite(first):
                        raise RuntimeError('native API returned nonfinite table value')
                    return {'library': name, 'units': units, 'cell_count': count,
                            'sample': {'cell': cell.name(), 'area': float(cell.getArea()),
                                       'pin': pin.name(), 'direction': pin.getDirectionStr(),
                                       'related_pin': arc.getRelatedPinName(),
                                       'timing_type': arc.getTimingTypeStr(),
                                       'table_type': table.getTypeStr(), 'table_size': values.size(),
                                       'first_value': first}}
    raise RuntimeError('native API exposed no representative NLDM timing table')


def same(before, after):
    if before['library'] != after['library'] or before['units'] != after['units']:
        return False
    if before['cell_count'] != after['cell_count']:
        return False
    a, b = before['sample'], after['sample']
    for key in ('cell', 'pin', 'direction', 'related_pin', 'timing_type', 'table_type', 'table_size'):
        if a[key] != b[key]:
            return False
    for key in ('area', 'first_value'):
        if not math.isclose(a[key], b[key], rel_tol=1e-5, abs_tol=1e-12):
            return False
    return True


def main(source, destination):
    source = os.path.realpath(source)
    destination = os.path.realpath(destination)
    if not os.path.isfile(source) or os.path.islink(source) or os.path.dirname(source) == destination:
        raise RuntimeError('source must be a plain file outside the qualification output')
    os.makedirs(destination, exist_ok=True)
    copied = os.path.join(destination, 'copy.lib')
    if os.path.exists(copied):
        raise RuntimeError('refusing to overwrite a previous qualification copy')
    started = time.time()
    source_sha = digest(source)
    first_handle = None
    second_handle = None
    try:
        first_handle = tmlib.readTmlib(source, os.path.join(destination, 'source.parser.log'))
        if first_handle.isNull():
            raise RuntimeError('readTmlib returned a null source handle')
        original = snapshot(first_handle)
        if not first_handle.outputLib(copied):
            raise RuntimeError('outputLib failed to write an independent copy')
        tmlib.releaseTmlib(first_handle)
        first_handle = None
        second_handle = tmlib.readTmlib(copied, os.path.join(destination, 'copy.parser.log'))
        if second_handle.isNull():
            raise RuntimeError('readTmlib returned a null copy handle')
        reread = snapshot(second_handle)
        if not same(original, reread) or digest(source) != source_sha:
            raise RuntimeError('copy re-read invariants or original SHA differ')
        tmlib.releaseTmlib(second_handle)
        second_handle = None
        result = {'status': 'qualified', 'source_sha256': source_sha,
                  'source_bytes': os.path.getsize(source), 'copy_sha256': digest(copied),
                  'copy_bytes': os.path.getsize(copied), 'facts': original,
                  'elapsed_s': round(time.time() - started, 3)}
        with open(os.path.join(destination, 'qualification.json'), 'w') as output:
            json.dump(result, output, sort_keys=True)
        print(json.dumps({'status': result['status'], 'source_sha256': source_sha,
                          'copy_sha256': result['copy_sha256'], 'cell_count': original['cell_count'],
                          'sample': original['sample'], 'elapsed_s': result['elapsed_s']}, sort_keys=True))
    finally:
        if first_handle is not None:
            tmlib.releaseTmlib(first_handle)
        if second_handle is not None:
            tmlib.releaseTmlib(second_handle)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: qualify-libapi.py SOURCE OUTDIR')
    try:
        main(sys.argv[1], sys.argv[2])
    except Exception:
        traceback.print_exc()
        raise SystemExit(4)
