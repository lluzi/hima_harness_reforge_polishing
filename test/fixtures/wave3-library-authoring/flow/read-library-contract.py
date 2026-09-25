import json
import re
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    value = json.load(handle)

valid = (
    isinstance(value, dict)
    and value.get('schema') == 'hima-library-insight-report/1'
    and value.get('qualification') == 'authoring-qualification'
    and isinstance(value.get('sourceSha256'), str)
    and re.fullmatch(r'[0-9a-f]{64}', value['sourceSha256'])
    and isinstance(value.get('provenance'), str) and value['provenance'].strip()
    and isinstance(value.get('unknowns'), list)
    and bool(value['unknowns'])
    and all(isinstance(item, str) and item.strip() for item in value['unknowns'])
)
if not valid:
    raise SystemExit('invalid local Library authoring-qualification result')

with open(sys.argv[2], 'w', encoding='utf-8') as handle:
    json.dump({'values': [{'type': 'library_contract_ready', 'unit': 'count', 'value': 1}]}, handle)
    handle.write('\n')
