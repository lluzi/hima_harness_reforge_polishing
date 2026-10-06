"""Cheap falsifiers for the stand-in before a full Host starts."""
import json
import os
import sys
import tempfile
import shutil
import importlib.util
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import prepare
from atcs import business_tasks, core, contributions
from test_engineering_result import reader
wrapper_path=prepare.REPO/'sites/linglong-atcs28/templates/resident-engineering-wrapper.py'
spec=importlib.util.spec_from_file_location('resident_dry_wrapper',wrapper_path)
wrapper=importlib.util.module_from_spec(spec);spec.loader.exec_module(wrapper)
import atcs_cli
import acp

class ResidentDryFixtureTest(unittest.TestCase):
    def test_actual_preparation_and_reopened_r1_two_selected_states(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); inputs=prepare.prepare(root/'inputs'); campaign=root/'campaign';campaign.mkdir()
            self.assertFalse((campaign/'state/baseline.json').exists())
            self.assertFalse((campaign/'state/common-stage.json').exists())
            request={'DESIGN_STATE_MANIFEST':str(inputs/'manifest.json'),'SITE_CAPABILITIES':str(inputs/'site.json'),'NATIVE_TIMING_CONTEXT':str(inputs/'native.json')}
            business_tasks.execute('prepare-inputs',campaign,request,atcs_cli)
            business_tasks.execute('prepare-baseline',campaign,{**request,'NATIVE_REPORT_PATHS':10000},atcs_cli)
            common=json.loads((campaign/'state/common-stage.json').read_text())
            self.assertEqual(common['measurements']['after']['setup']['wnsNs'],-0.02)
            self.assertEqual(common['measurements']['after']['hold']['wnsNs'],-0.07)
            previous=Path.cwd(); prior={key:os.environ.get(key) for key in ['ATCS_DRY_CASE','ATCS_DRY_GATE','HIMA_RESIDENT_TESTING']}
            os.environ['HIMA_RESIDENT_TESTING']='1'
            try:
                for mode in ['clear','residual']:
                    native=campaign/'.hima-engineering'/mode/'workspace';native.mkdir(parents=True)
                    (native.parent/'task.json').write_text(json.dumps(wrapper.framed(dict(schema='hima-resident-engineering/1',workspace=str(native),taskId=mode,runId='fixture',executionId='fixture',nodeId='fix-timing',campaignWorkspace=str(campaign)))))
                    gate=root/(mode+'-gate');gate.touch();os.environ.update(ATCS_DRY_CASE=mode,ATCS_DRY_GATE=str(gate));os.chdir(native)
                    acp.engineer()
                    result=json.loads((native/'result.json').read_text())
                    proof=json.loads(gate.with_suffix('.ready').read_text())
                    self.assertEqual(proof['loadedCellStateDigest'],common['cellStateDigest'])
                    selected=(native/'engineering/best-workspace/design.data').read_text().split()
                    selected=dict(zip(selected[::2],selected[1::2]))
                    self.assertEqual(selected['U9'],'DFFX2' if mode=='clear' else 'DFFX1')
                    self.assertEqual(result['measurements']['after']['setup']['wnsNs'],0 if mode=='clear' else -0.02)
                    self.assertIn('open_workspace',(native/'engineering/vendor-calls.txt').read_text())
                    self.assertTrue(any(ref['path']=='engineering/vendor-calls.txt' for ref in result['artifacts']['nativeTrace']))
                    self.assertEqual(result['remaining'],[],'counterexample deliberately omits model remaining lists')
                    candidate=json.loads((native/'resident-delivery.json').read_text())
                    for artifact in candidate['artifacts']:
                        self.assertEqual(core.file_sha256(native/artifact['path']),artifact['sha256'])
                        if artifact['kind']!='result': self.assertTrue(artifact['path'].startswith('engineering/'))
                    self.assertFalse((campaign/'state/autofix-reference.json').exists())
                    # Actual wrapper collection validates each candidate file, retains a snapshot
                    # and frames the delivery. Materialize its verified files for the cheap Reader seam.
                    capability=root/(mode+'-capability.json')
                    capability.write_text(json.dumps({'schema':'hima-resident-engineering-capability/1','protocol':'hima-resident-engineering/1',
                        'wrapper':{'argv':[str(wrapper_path),'--capability',str(capability)]},
                        'native':{'executable':str(Path(acp.__file__).resolve()),'version':'1.18.34','argv':[],'model':'deepseek/deepseek-flash','protocolVersion':1},
                        'sandbox':{'kind':'none','testOnly':True,'privateWorkspace':'workspace','privateHome':'home'},
                        'environment':{'inherit':[],'set':{},'toolPaths':[],'credentialReadPaths':[]},
                        'delivery':{'candidate':'resident-delivery.json'},'stopGraceSeconds':1}))
                    signed=wrapper.Wrapper(native.parent,capability);signed.session_id='native-fixture-session'
                    manifest=signed.collect_delivery({'requestId':'delivery-'+mode})
                    self.assertEqual(manifest['sha256'],wrapper.digest_body(manifest))
                    if (campaign/'state/engineering-result.json').exists(): (campaign/'state/engineering-result.json').unlink()
                    if (campaign/'engineering').exists(): shutil.rmtree(campaign/'engineering')
                    for artifact in manifest['artifacts']:
                        source=native.parent/manifest['artifactRoot']/artifact['path']
                        self.assertEqual(core.file_sha256(source),artifact['sha256'])
                        target=campaign/('state/engineering-result.json' if artifact['kind']=='result' else artifact['path'])
                        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
                    report=campaign/'state/engineering-result.json'
                    values={row['type']:row['value'] for row in reader.read('engineering-result',report,campaign)}
                    self.assertEqual(values['tc_engineering_result_error_count'],0)
                    self.assertEqual(values['tc_engineering_collateral_unknown_count'],4)
                    self.assertEqual(values['tc_engineering_timing_remaining_violation_count'],0 if mode=='clear' else 2)

            finally:
                os.chdir(previous)
                for key,value in prior.items():
                    if value is None: os.environ.pop(key,None)
                    else: os.environ[key]=value
def load_tests(loader,standard,pattern):
    return loader.loadTestsFromTestCase(ResidentDryFixtureTest)
if __name__=='__main__':unittest.main()
