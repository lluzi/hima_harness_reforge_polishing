#!/bin/sh
set -eu
input=$1
output=$2
python3 - "$input" "$output" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    value = json.load(handle)

if (not isinstance(value, dict)
    or not isinstance(value.get('sourceSha256'), str)
    or not re.fullmatch(r'[0-9a-f]{64}', value['sourceSha256'])
    or value.get('qualification') != 'authoring-qualification'
    or value.get('reportSchema') != 'hima-library-insight-report/1'
    or not isinstance(value.get('provenance'), str) or not value['provenance'].strip()
    or not isinstance(value.get('unknowns'), list)
    or not value['unknowns']
    or not all(isinstance(item, str) and item.strip() for item in value['unknowns'])):
    raise SystemExit('invalid local Library authoring-qualification input')

with open(sys.argv[2], 'w', encoding='utf-8') as handle:
    json.dump({
        'schema': value['reportSchema'],
        'qualification': value['qualification'],
        'sourceSha256': value['sourceSha256'],
        'provenance': value['provenance'],
        'unknowns': value['unknowns'],
    }, handle, sort_keys=True)
    handle.write('\n')
PY
