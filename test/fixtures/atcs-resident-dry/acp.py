#!/usr/bin/env python3
"""ACP v1 synthetic engineer. Reads actual saved R1; emits original support files.

Metrics are an explicit two-state synthetic model, not commercial timing evidence.
The gate delays the first prompt only, to exercise public business-message identity.
"""
import json
import os
from pathlib import Path
import sys
import threading
import time
REPO = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(REPO/'packs/agentic-timing-closure-system/flow/tests'),str(REPO/'packs/agentic-timing-closure-system/flow'),str(Path(__file__).parent)]
from atcs import core, contributions
from test_engineering_result import EngineeringResultReaderTest
from native import run
lock = threading.Lock(); first = True

def send(value):
    with lock: print(json.dumps(value),flush=True)

def engineer():
    native = Path.cwd(); task=json.loads((native.parent/'task.json').read_text()); w=Path(task['campaignWorkspace'])
    baseline=json.loads((w/'state/baseline.json').read_text()); context=json.loads((w/'state/xtop-context.json').read_text()); common=json.loads((w/'state/common-stage.json').read_text())
    assert common['measurements']['after']['setup']['wnsNs']==-0.02
    assert common['measurements']['after']['hold']['wnsNs']==-0.07
    seed=w/common['seed']['path']; assert core.tree_digest(seed)==common['seed']['digest']
    root=native/'engineering'; root.mkdir()
    # Production dump procedure from the common Tcl is used unchanged to inspect the reopened R1.
    common_tcl=(w/'research/observe/common-r1/task.tcl')
    if not common_tcl.exists():
        common_tcl=next((w/'research/observe/common-r1').glob('*.tcl'))
    text=common_tcl.read_text(); start=text.index('proc atcs_write_cell_dump ')
    end=text.index('\n}',start)+2
    procedure=text[start:end]
    reopen=root/'reopen.tcl'; dump=root/'loaded-r1.dump'
    mode=os.environ['ATCS_DRY_CASE']; clear=mode=='clear'
    checkpoint=root/'best-workspace'
    edit='size_cell U9 DFFX2\n' if clear else ''
    reopen.write_text(procedure+'\nset ::design top\nopen_workspace {'+str(seed)+'}\natcs_write_cell_dump {'+str(dump)+'}\n'+edit+'save_workspace -as {'+str(checkpoint)+'}\nwrite_design_changes -output_dir {'+str(root)+'} -eco_file_prefix final\nexit 0\n')
    run(reopen,root,root/'native.log')
    loaded=contributions.parse_cell_dump(dump.read_text())
    assert core.digest(loaded)==common['cellStateDigest'], (loaded,common['cellStateDigest'])
    assert loaded['U1']['cell']=='BUFX2' if isinstance(loaded['U1'],dict) else loaded['U1']=='BUFX2'
    selected_words=checkpoint.joinpath('design.data').read_text().split()
    selected_cells=dict(zip(selected_words[::2],selected_words[1::2]))
    clear=selected_cells['U9']=='DFFX2'
    assert selected_cells['U9'] in ('DFFX1','DFFX2')
    # The selected synthetic model is clear at zero slack or retains the actual common residual.
    helper=EngineeringResultReaderTest(); helper.w=native
    original_file=helper._file
    helper._file=lambda relative,text: original_file(relative.replace('raw/../',''),text)
    after=helper._metrics('../engineering/selected',0 if clear else -0.02,0 if clear else -0.02,0 if clear else 1,
                          0 if clear else -0.07,0 if clear else -0.07,0 if clear else 1)
    identity={'baselineStateId':baseline['id'],'nativeContextId':context['id'],'commonStateId':common['stateId'],'worklistId':common['worklistId']}
    result={'kind':'result','task':{key:task[key] for key in ('taskId','runId','executionId','nodeId')},
            'inputIdentity':identity,'selected':{'stateId':'synthetic-selected-'+mode,'checkpoint':{'path':'engineering/best-workspace','digest':core.tree_digest(checkpoint)}},
            'measurements':{'before':common['measurements']['after'],'after':after},
            'collateral':{phase:{check:{'unknown':'synthetic fixture has no physical collateral evidence'} for check in ('transition','capacitance','fanout','legality')} for phase in ('before','after')},
            'artifacts':{'scripts':[helper._file('engineering/fix.tcl',reopen.read_text())],
                         'logicalEco':{'path':'engineering/final_netlist_top.txt','sha256':core.file_sha256(root/'final_netlist_top.txt')},
                         'physicalEco':{'path':'engineering/final_physical_top.txt','sha256':core.file_sha256(root/'final_physical_top.txt')},
                         'reproduction':helper._file('engineering/REPRODUCE.md','Reopen common R1 with fix.tcl. Synthetic metrics; no physical signoff.\n'),
                         'nativeTrace':[{'path':'engineering/'+name,'sha256':core.file_sha256(root/name)} for name in ('native.log','vendor-calls.txt','loaded-r1.dump')]},
            'remaining':[],'regressed':[],'blocked':[],'unknown':[],
            'stopReason':'synthetic measured clear state' if clear else 'synthetic common residual remains',
            'bestEffort':not clear,'noOp':not clear}
    # before refs are already actual Pack files; after/support paths live in the native workspace.
    core.write_artifact(native/'result.json',core.stamp('engineering-result',result))
    candidate={'schema':'hima-resident-engineering-candidate/1','outcome':'completed' if clear else 'best-effort',
               'summary':result['stopReason'],'stopReason':result['stopReason'],
               'artifacts':[{'path':p.relative_to(native).as_posix(),'sha256':core.file_sha256(p),'kind':'result' if p.name=='result.json' else 'support'}
                            for p in sorted(native.rglob('*')) if p.is_file() and (p.name=='result.json' or p.is_relative_to(root) or p.is_relative_to(native/'raw'))]}
    (native/'resident-delivery.json').write_text(json.dumps(candidate))
    gate=Path(os.environ['ATCS_DRY_GATE']); gate.with_suffix('.ready').write_text(json.dumps({'task':task,'loadedCellStateDigest':core.digest(loaded),'commonCellStateDigest':common['cellStateDigest']}))
    until=time.monotonic()+45
    while not gate.exists():
        if time.monotonic()>until: raise TimeoutError('initial prompt gate was not released')
        time.sleep(.025)

def prompt(request_id,text,initial):
    try:
        with Path(os.environ['ATCS_DRY_PROMPTS']).open('a') as stream: stream.write(json.dumps({'initial':initial,'text':text})+'\n')
        if initial: engineer()
        send({'jsonrpc':'2.0','id':request_id,'result':{'stopReason':'end_turn'}})
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        send({'jsonrpc':'2.0','id':request_id,'error':{'code':-32000,'message':str(error)}})

if sys.argv[1:]==['--version']: print('1.18.34'); sys.exit(0)
for line in sys.stdin:
    message=json.loads(line); method=message.get('method'); rid=message.get('id')
    if method=='initialize': send({'jsonrpc':'2.0','id':rid,'result':{'protocolVersion':1,'agentCapabilities':{'sessionCapabilities':{'close':{}}},'agentInfo':{'name':'synthetic resident engineer','version':'1.18.34'}}})
    elif method=='session/new': send({'jsonrpc':'2.0','id':rid,'result':{'sessionId':'native-session-1','configOptions':[]}})
    elif method=='session/set_config_option': send({'jsonrpc':'2.0','id':rid,'result':{'configOptions':[]}})
    elif method=='session/prompt':
        initial=first; first=False
        threading.Thread(target=prompt,args=(rid,'\n'.join(p.get('text','') for p in message['params']['prompt']),initial),daemon=True).start()
    elif method=='session/close': send({'jsonrpc':'2.0','id':rid,'result':{}})
    elif method=='session/cancel': pass
    elif rid is not None: send({'jsonrpc':'2.0','id':rid,'error':{'code':-32601,'message':'unsupported'}})
