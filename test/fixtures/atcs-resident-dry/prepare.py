#!/usr/bin/env python3
"""Initial declared inputs only. No Campaign state, baseline or common-stage writes."""
import json
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(REPO/'packs/agentic-timing-closure-system/flow/tests'), str(REPO/'packs/agentic-timing-closure-system/flow')]
from test_cli_state import _make_baseline_manifest, _xtop_site_config
from atcs import core

def prepare(root):
    root = Path(root).resolve(); root.mkdir(parents=True, exist_ok=True)
    manifest = _make_baseline_manifest(root)
    cells = {'U1':'BUFX1','U2':'INVX1','U3':'BUFX2','UOUT':'BUFX1','U9':'DFFX1'}
    (root/'netlist.v').write_text('module top();\n' + ''.join(f'  {cell} {name} (.A(a));\n' for name,cell in cells.items()) + 'endmodule\n')
    (root/'design.def').write_text('VERSION 5.8 ;\nEND DESIGN\n')
    manifest['def'] = 'design.def'
    corner = next(iter(manifest['spef']))
    manifest['scenarios'] = [{'name':'synthetic','corner':corner}]
    site = _xtop_site_config(root, ['synthetic'])
    for name in ['tech.lef','cells.lef']: (root/name).write_text('native vendor fixture\n')
    site.update(design='top',techLef=str(root/'tech.lef'),cellLefGlob=str(root/'cells.lef'),
                edaShell=[sys.executable,str(Path(__file__).with_name('native.py'))])
    manifest['libraries'] = [str(next(root.rglob('synthetic.lib')))]
    (root/'manifest.json').write_text(json.dumps(manifest))
    (root/'site.json').write_text(json.dumps(site))
    sta = root/'retained/sta-data'; sta.mkdir(parents=True)
    (sta/'timing_data_finish').write_text('retained native fixture timing bytes\n')
    source = root/'retained/source-report.rpt'; source.write_text('synthetic retained native source\n')
    native = {'schema':'atcs.native-timing-context/1','designStateManifestSha256':core.file_sha256(root/'manifest.json'),
              'requiredScenarios':['synthetic'],'staData':{'path':str(sta),'digest':core.tree_digest(sta)},
              'sourceReports':[{'path':str(source),'sha256':core.file_sha256(source)}],
              'constraints':[{'path':str(root/'constraints.sdc'),'sha256':core.file_sha256(root/'constraints.sdc')}],
              'producer':{'tool':'PrimeTime','version':'retained-fixture','command':'write_timing_data'}}
    (root/'native.json').write_text(json.dumps(native))
    assert not (root/'state').exists()
    return root
if __name__ == '__main__': prepare(sys.argv[1])
