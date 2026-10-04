"""Committed Reader to final business Goal/report/package: no model or EDA."""
import copy
import json
import sys
import tarfile
import unittest
from unittest.mock import patch
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parents[1])]
import atcs_cli as cli
from atcs import business_tasks, core, adapters
from test_engineering_result import EngineeringResultReaderTest, reader
from test_resident_native_context import ResidentNativeContextTest


class BusinessDeliveryTest(EngineeringResultReaderTest):
    def _input(self, result):
        report = self._deliver(result)
        ref = {'runId':'run-1','taskId':'fix-timing','effectId':'effect-1','name':'domain-report',
               'path':'state/engineering-result.json','sha256':core.file_sha256(report)}
        return {'READER_VALUE':{'observations':[{'contentSha256':ref['sha256'],'values':reader.read('engineering-result', report, self.w)}],
                                'engineering':{'outcome':'best-effort','summary':'measured fixture','stopReason':result['stopReason']}},
                'DOMAIN_REPORT':ref, 'TARGET_SETUP_NS':0, 'TARGET_HOLD_NS':0}

    def test_final_goal_true_preserves_broader_unknown_and_real_support_tree_package(self):
        inputs = self._input(self._result())
        evaluation = business_tasks.execute('evaluate-timing', self.w, inputs, cli)
        self.assertTrue(evaluation['value']['goalMet'])
        self.assertEqual(evaluation['value']['collateral']['unknown'], {'value':4})
        delivery = business_tasks.execute('deliver', self.w, {'EVALUATION':evaluation['value'],'DOMAIN_REPORT':inputs['DOMAIN_REPORT']}, cli)
        self.assertTrue(delivery['value']['goalMet'])
        with tarfile.open(self.w / delivery['value']['engineeringPackagePath']) as archive:
            names = archive.getnames()
        self.assertIn('engineering/best-workspace/state', names)
        self.assertIn('engineering/fix.tcl', names)
        self.assertIn('raw/after-setup.rpt', names)
        self.assertIn('state/engineering-result.json', names)

    def test_best_effort_raw_residual_overrides_empty_model_lists(self):
        result = self._result(after=self._metrics('after', -0.02, -0.02, 1, 0.0, 0.0, 0))
        result['remaining'] = []
        result = core.stamp('engineering-result', {k:v for k,v in result.items() if k not in ('id','schema')})
        value = business_tasks.evaluate(self.w, self._input(result))
        self.assertFalse(value['goalMet'])
        self.assertEqual(value['timing']['setup']['violations'], {'value':1})
        self.assertEqual(value['timing']['setup']['wnsNs'], {'value':-0.02})

    def test_regression_measure_survives_empty_model_regressed_list(self):
        inputs = self._input(self._result(after=self._metrics('after', -0.20, -0.40, 2, 0.0, 0.0, 0)))
        value = business_tasks.evaluate(self.w, inputs)
        self.assertGreater(value['collateral']['regression']['value'], 0)
        self.assertFalse(value['goalMet'])

    def test_unknown_timing_is_not_goal_pass(self):
        inputs = self._input(self._result())
        for row in inputs['READER_VALUE']['observations'][0]['values']:
            if row['type'] == 'tc_engineering_hold_wns_ns':
                row.update(value=None, unknownReason='scenario missing')
        self.assertFalse(business_tasks.evaluate(self.w, inputs)['goalMet'])

    def test_changed_domain_report_refuses_evaluation_without_reader_relaunch(self):
        inputs = self._input(self._result())
        (self.w / inputs['DOMAIN_REPORT']['path']).write_text('{}')
        with self.assertRaisesRegex(core.AtcsError, 'domain-report'):
            business_tasks.evaluate(self.w, inputs)

    def test_changed_checkpoint_refuses_delivery(self):
        inputs = self._input(self._result())
        value = business_tasks.evaluate(self.w, inputs)
        (self.w / 'engineering/best-workspace/state').write_text('changed')
        with self.assertRaisesRegex(core.AtcsError, 'checkpoint/support tree'):
            business_tasks.execute('deliver', self.w, {'EVALUATION':value,'DOMAIN_REPORT':inputs['DOMAIN_REPORT']}, cli)

    def test_cli_writes_program_abi_envelope(self):
        inputs = self._input(self._result())
        request, output = self.w / 'task-input.json', self.w / 'task-output.json'
        request.write_text(json.dumps(inputs))
        self.assertEqual(cli.main(['task-evaluate-timing', str(self.w), str(request), str(output)]), 0)
        response = json.loads(output.read_text())
        self.assertEqual(response['schemaVersion'], '1')
        self.assertEqual(response['artifacts'][0]['name'], 'timing-evaluation')
        self.assertNotIn('runId', response)


class BusinessPreparationTest(ResidentNativeContextTest):
    def setUp(self):
        super().setUp()
        (self.w / 'design.def').write_text('VERSION 5.8 ;\nEND DESIGN\n')
        self.manifest['def'] = 'design.def'
        self.manifest['libraries'] = [str(next(self.w.rglob('synthetic.lib')))]
        self.manifest_path.write_text(json.dumps(self.manifest))
        self.native['designStateManifestSha256'] = core.file_sha256(self.manifest_path)
        self.native_path.write_text(json.dumps(self.native))

    def test_prepare_inputs_uses_actual_readiness_and_cli_abi(self):
        inputs = {'DESIGN_STATE_MANIFEST':str(self.manifest_path),'SITE_CAPABILITIES':str(self.site_path),'NATIVE_TIMING_CONTEXT':str(self.native_path)}
        response = business_tasks.execute('prepare-inputs', self.w, inputs, cli)
        self.assertEqual(response['value']['readinessId'], cli._read_declared(self.w/'state/readiness.json','input-readiness')['id'])
        self.assertEqual(response['artifacts'][0]['name'], 'input-readiness')

    def test_prepare_baseline_runs_existing_native_tcl_and_writes_all_intermediates(self):
        from test_owner_timing_lead import OwnerTimingLeadChecks
        self.native_metric_trajectory = None
        for filename in ['tech.lef', 'cells.lef']:
            (self.w / filename).write_text('native fixture')
        site = json.loads(self.site_path.read_text())
        site.update(design='top', techLef=str(self.w/'tech.lef'), cellLefGlob=str(self.w/'cells.lef'), edaShell=['fixture'])
        self.site_path.write_text(json.dumps(site))
        inputs = {'DESIGN_STATE_MANIFEST':str(self.manifest_path),'SITE_CAPABILITIES':str(self.site_path),'NATIVE_TIMING_CONTEXT':str(self.native_path),'NATIVE_REPORT_PATHS':10000}
        with patch.object(adapters, 'run_tool', side_effect=lambda *args, **kwargs: OwnerTimingLeadChecks.stub_native_tool(self, *args, **kwargs)):
            output = business_tasks.execute('prepare-baseline', self.w, inputs, cli)
        common = cli._read_declared(self.w/'state/common-stage.json', 'common-stage')
        self.assertEqual(output['value']['commonStateId'], common['stateId'])
        self.assertEqual(common['measurements']['after']['hold']['wnsNs'], -0.07)
        self.assertTrue((self.w/common['seed']['path']/'design.data').is_file())
        self.assertEqual(len(output['artifacts']), 3)

    def test_prepare_inputs_refuses_missing_manifest_file(self):
        (self.w / self.manifest['netlist']).unlink()
        inputs = {'DESIGN_STATE_MANIFEST':str(self.manifest_path),'SITE_CAPABILITIES':str(self.site_path),'NATIVE_TIMING_CONTEXT':str(self.native_path)}
        with self.assertRaisesRegex(core.AtcsError, 'readiness'):
            business_tasks.execute('prepare-inputs', self.w, inputs, cli)

def load_tests(loader, standard_tests, pattern):
    # Reuse fixture setup without rerunning inherited/imported regression classes.
    suite = unittest.TestSuite()
    for cls in (BusinessDeliveryTest, BusinessPreparationTest):
        for name in cls.__dict__:
            if name.startswith('test_'):
                suite.addTest(cls(name))
    return suite

if __name__ == '__main__':
    unittest.main()
