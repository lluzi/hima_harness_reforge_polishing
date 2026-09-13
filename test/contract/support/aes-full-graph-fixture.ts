/** PLS-25-only synthetic mine and learned-model boundaries for the full Host composition test. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const syntheticStageAdapter = String.raw`#!/usr/bin/env python3
"""Test-only mine and characterized-Liberty producer; every other stage is production code."""
import hashlib,importlib.util,json,pathlib,sys,uuid

HERE=pathlib.Path(__file__).resolve().parent
PRODUCTION=HERE/'domain'/'production_stages.py'
ROUTES={
 'timing_criticality':(('critical_subgraph','critical_k_input_cone','multi_output_shared_logic'),'critical_impact','CRITICAL_K_INPUT_CONE'),
 'timing_context':(('critical_subgraph','critical_k_input_cone','multi_output_shared_logic'),'critical_context_pareto','CRITICAL_K_INPUT_CONE'),
 'structure_frequency':(('repeated_cluster','multi_output_shared_logic'),'nonoverlap_frequency','REPEATED_CLUSTER'),
 'structure_compaction':(('repeated_cluster','multi_output_shared_logic'),'covered_cell_compaction','REPEATED_CLUSTER'),
 'mapper_compatibility':(('repeated_cluster','multi_output_shared_logic'),'single_output_mapper_fit','REPEATED_CLUSTER'),
 'functional_diversity':(('repeated_cluster','multi_output_shared_logic'),'boundary_function_diversity','REPEATED_CLUSTER'),
}

def digest(raw): return hashlib.sha256(raw).hexdigest()
def ref(at,workspace,role,source):
 raw=at.read_bytes()
 try: named=str(at.relative_to(workspace))
 except ValueError: named=str(at)
 return {'role':role,'path':named,'sha256':digest(raw),'bytes':len(raw),'sourceType':source}
def write_json(at,value):
 at.parent.mkdir(parents=True,exist_ok=True)
 at.write_text(json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n')
def load_production():
 spec=importlib.util.spec_from_file_location('pls25_production_stages',PRODUCTION)
 module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
 return module
def method():
 raw=pathlib.Path(__file__).read_bytes()
 return {'fixture':True,'syntheticProducer':{'path':'stages.py','sha256':digest(raw),'bytes':len(raw)},
         'basis':'production-valid repeated two-chain Boolean contract; route identities are fixture projections'}
def base_record(stage,workspace,artifacts,facts,inputs=()):
 return {'schema':'aes-dtco-stage/1','stage':stage,'status':'passed','evidenceClass':'synthetic-fixture',
         'inputs':list(inputs),'artifacts':list(artifacts),'executions':[],'facts':facts,'method':method(),
         'scope':'synthetic fixture boundary only; no production mining, learned-model execution, AES PPA, or EDA claim'}
def publish_record(flow,stage,run,record):
 write_json(run/'record.json',record); write_json(flow/'records'/(stage+'.json'),record)
 print(json.dumps({'stage':stage,'status':'passed','record':str(flow/'records'/(stage+'.json'))}))

def candidate(route,objective,algorithm):
 candidate_id='CAND_'+route.upper()+'_MAPPED_SINGLE_0001'
 return {
  'schema_version':'standard-cell-generation-request/v2','candidate_id':candidate_id,
  'generator_contract':{
   'cell_kind':'combinational',
   'target_library_profile':{'process_family':'SYNTHETIC','cell_architecture_ref':'fixture://cell-architecture'},
   'interface':{'inputs':[{'name':'I0','direction':'input'},{'name':'I1','direction':'input'},{'name':'I2','direction':'input'}],
                'outputs':[{'name':'Y','direction':'output','liberty_function':'(!I2 | (I0 & I1))'}],
                'pg_pins_from_library_profile':True},
   'equivalence_reference':{'input_order':['I0','I1','I2'],'output_order':['Y'],
      'truth_table_indexing':'vector_index=sum(input_order[i]*2^i); bit0_is_vector0',
      'output_truth_tables_hex':{'Y':'0x8f'},
      'digest':'sha256:96d701727d1c1ea7beb57cce5a9e9e173a4b87050fdf68a3f6a1520a41fa59ac'},
   'truth_table':{'columns':['I0','I1','I2','Y'],'rows':[[0,0,0,1],[1,0,0,1],[0,1,0,1],[1,1,0,1],
                                                        [0,0,1,0],[1,0,1,0],[0,1,1,0],[1,1,1,1]]},
   'implementation_request':{'mode':'synthesize_transistor_topology','drive_strengths':['fixture'],'vt_classes':['fixture']},
   'characterization_request':{'profile_ref':'fixture://characterization','model_types':['NLDM'],'timing_arcs':[
      {'related_pin':'I0','to_pin':'Y','timing_sense':'positive_unate'},
      {'related_pin':'I1','to_pin':'Y','timing_sense':'positive_unate'},
      {'related_pin':'I2','to_pin':'Y','timing_sense':'negative_unate'}]},
   'deliverables':['SPICE','GDS','LEF','LIBERTY','VERILOG']},
  'discovery_evidence':{'discovery_algorithm':algorithm,'strategy_id':route,'search_objective':objective,
    'source_graph':'mapped','replacement_key':'NP:k3:m1:[0x8f]','library_equivalence_key':'NPN:k3:0x7',
    'library_function_match':'ABSENT_UNDER_NPN_OR_NPNP_EQUIVALENCE','raw_support':2,'non_overlapping_support':2,
    'non_overlapping_support_method':'synthetic_fixture_projection','occurrences_by_module':{'aes_cipher_top':2},
    'equivalence_status':'EXACT_TRUTH_TABLE_FROM_COMPOSED_LIBERTY_FUNCTIONS','ppa_status':'UNPROVEN',
    'representative_occurrence':{'module':'aes_cipher_top','instances':['U0','U1'],
      'cell_types':['NAND2_X1','NAND2_X1'],'pin_mapping':{'I0':'a','I1':'b','I2':'c','Y':'z1'},'internal_nets':1}},
  'gate_evidence':{'G0_discovery':{'status':'SYNTHETIC','evidence':'two copied independent chains in the fixture'},
                   'G2_function':{'status':'PASS','evidence':'production-valid exact truth-table contract'},
                   'G4_circuit_feasibility':{'status':'READY','evidence':'fusion','reasons':[]}},
  'implementation_plan':{'route':'fusion','fusion_spec':{'name':candidate_id,'cell1':'NAND2_X1','c1_out':'ZN',
    'cell2':'NAND2_X1','c2_in':'A','output':'Y','pins':{'I0':['cell1','A'],'I1':['cell1','B'],'I2':['cell2','B']},
    'function':'(!I2 | (I0 & I1))'}},
  'advisories':[{'severity':'warning','code':'SYNTHETIC_FIXTURE','message':'This route report was projected by the test fixture; no production route algorithm ran.'}]
 }

def mine(workspace,route):
 if route not in ROUTES: raise ValueError('unknown fixture route: '+str(route))
 flow=workspace/'flow'; algorithms,objective,algorithm=ROUTES[route]
 probe=json.loads((flow/'probe.json').read_text()); netref=probe['evidence']['netlist.v']; net=flow/netref['path']
 if digest(net.read_bytes()) != netref['sha256']: raise ValueError('fixture probe netlist hash mismatch')
 run=flow/'artifacts'/('mine-'+route)/('run-'+uuid.uuid4().hex); run.mkdir(parents=True)
 request=candidate(route,objective,algorithm)
 raw={'report_schema':'xspace_cell-pattern-search/v2','strategy_id':route,'source_graph':'mapped',
      'algorithms':list(algorithms),'inputs':{'netlist':str(net),'fixture':'synthetic repeated two-chain projection'},
      'search_definition':{'route':route,'objective':objective,'custom_cell_budget':1},
      'statistics':{'synthetic_candidate_count':1},'generation_requests':[request],
      'limitations':['Synthetic fixture projection; this did not execute a production mining route.',
                     'The Boolean contract is production-validator compatible; PPA remains unproven.']}
 held=run/'raw.json'; write_json(held,raw)
 published=flow/'mining'/route/'raw.json'; published.parent.mkdir(parents=True,exist_ok=True); published.write_bytes(held.read_bytes())
 code=digest(pathlib.Path(__file__).read_bytes()); production=load_production()
 view=run/'research.json'; write_json(view,production.mining_research_view(held,code))
 (published.parent/'research.json').write_bytes(view.read_bytes())
 inputs=[ref(flow/'inputs.json',workspace,'inputs_json','campaign-binding'),
         ref(flow/'probe.json',workspace,'probe_record','synthetic-fixture-artifact'),
         ref(net,workspace,'probe_netlist','synthetic-fixture-artifact')]
 artifacts=[ref(held,workspace,'mining_raw','synthetic-fixture-artifact'),
            ref(view,workspace,'mining_research_view','source-linked-projection')]
 record=base_record('mine-'+route,workspace,artifacts,
   {'route':route,'candidate_count':1,'codeSha256':code,'sourceNetlistSha256':digest(net.read_bytes())},inputs)
 publish_record(flow,'mine-'+route,run,record)

def characterize(workspace):
 flow=workspace/'flow'; generated=json.loads((flow/'records'/'generate.json').read_text())
 layout=json.loads((flow/'records'/'layout.json').read_text())
 cells=sorted(row['role'].split(':',1)[1] for row in generated['artifacts'] if row['role'].startswith('generated_spice:'))
 if not cells: raise ValueError('fixture characterization has no generated cells')
 layout_cells=sorted(row['role'].split(':',1)[1] for row in layout['artifacts'] if row['role'].startswith('abstract_lef:'))
 if layout_cells != cells: raise ValueError('fixture characterization lacks exact layout coverage')
 run=flow/'artifacts'/'characterize'/('run-'+uuid.uuid4().hex); run.mkdir(parents=True)
 body=['/* MODELLED, NOT MEASURED -- PLS-25 synthetic fixture boundary */','library (synthetic_generated) {']
 for cell in cells:
  body += ['  cell (%s) {' % cell,'    area : 1.0;','    pin (I0) { direction : input; }',
           '    pin (I1) { direction : input; }','    pin (I2) { direction : input; }',
           '    pin (Y) { direction : output; function : "(!I2 | (I0 & I1))"; }','  }']
 body += ['}','']; liberty=run/'generated.lib'; liberty.write_text('\n'.join(body))
 inputs=[ref(flow/'inputs.json',workspace,'inputs_json','campaign-binding'),
         ref(flow/'records'/'generate.json',workspace,'source_stage_record:generate','stage-record'),
         ref(flow/'records'/'layout.json',workspace,'source_stage_record:layout','stage-record')]
 record=base_record('characterize',workspace,[ref(liberty,workspace,'generated_liberty','synthetic-modeled-liberty')],
   {'predicted_cell_count':len(cells),'characterization_type':'synthetic-modeled-liberty','measured_characterization':False},inputs)
 publish_record(flow,'characterize',run,record)

def main():
 args=sys.argv[1:]
 if len(args) not in (2,3): raise SystemExit('usage: stages.py STAGE WORKSPACE [ROUTE for mine]')
 stage,workspace=args[:2]; workspace=pathlib.Path(workspace).resolve()
 if stage=='mine': mine(workspace,args[2] if len(args)==3 else None); return 0
 if stage=='characterize' and len(args)==2: characterize(workspace); return 0
 return load_production().main(args)
if __name__=='__main__': raise SystemExit(main())
`;

export async function installAesFullGraphFixture(workspace: string, productionStagesPath: string,
  edaWrapper: string): Promise<void> {
  const flow = path.join(workspace, 'flow');
  const production = await readFile(productionStagesPath, 'utf8');
  const marker = 'HERE = Path(__file__).resolve().parent\n';
  if (!production.includes(marker)) throw new Error('production stages.py location marker changed');
  await writeFile(path.join(flow, 'domain/production_stages.py'), production.replace(marker,
    'HERE = Path(__file__).resolve().parents[1]\n'));
  await writeFile(path.join(flow, 'stages.py'), syntheticStageAdapter);

  let tool = await readFile(edaWrapper, 'utf8');
  const importMarker = 'import gzip, pathlib, re, sys';
  const masterMarker = "    master = 'XS_FIX_ZN' if arm == 'custom' else 'NAND2_X1'";
  if (!tool.includes(importMarker) || !tool.includes(masterMarker)) throw new Error('synthetic EDA fixture shape changed');
  tool = tool.replace(importMarker, 'import gzip, json, pathlib, re, sys').replace(masterMarker, String.raw`    master = 'NAND2_X1'
    if arm == 'custom':
        workspace = next(parent for parent in script.parents if (parent / 'flow' / 'inputs.json').is_file())
        char = json.loads((workspace / 'flow' / 'records' / 'characterize.json').read_text())
        liberty_ref = next(ref for ref in char['artifacts'] if ref['role'] == 'generated_liberty')
        liberty_path = pathlib.Path(liberty_ref['path'])
        if not liberty_path.is_absolute(): liberty_path = workspace / liberty_path
        master = re.search(r'(?m)^\s*cell\s*\(\s*"?([A-Za-z_][A-Za-z0-9_$]*)', liberty_path.read_text()).group(1)`);
  await writeFile(edaWrapper, tool);
}
