// @hima-seam llm-replay direct
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm, symlink, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stringify } from 'yaml';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, createPresetRootAgent, createChildAgent, sayAsUser } from './support/boot-inprocess.ts';
import { writeMomentFixture } from './support/moments.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';

test('PG Campaign ownership fences uncontracted descendants at actual tool and model entrances', { timeout: 60000 }, async () => {
  const home = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  try {
    if(process.env.HIMA_DBOS_TEST_PACKAGE){
      const link=path.join(home.profileDir,'node_modules/@hima/harness');
      await rm(link,{recursive:true,force:true});
      await symlink(process.env.HIMA_DBOS_TEST_PACKAGE,link,'dir');
    }
    const replay = await writeMomentFixture(home, 'one-turn');
    await writeReplayOverlay(home.home, { file: replay.file, overrideFile: replay.override });
    host = await bootInProcess(home);
    const owner = await createRootAgent(host.ctx, home.workspace);
    const sideTalk = await createRootAgent(host.ctx, home.workspace);
    // Native lineage can predate Campaign adoption and survive reopening. It must not imply a grant.
    const child = await createChildAgent(host.ctx, owner, home.workspace);
    const grandchild = await createChildAgent(host.ctx, child, home.workspace);
    const { durable, ledger } = host.ctx.hima;
    const run = await durable.store.createRun({ runId: 'authority-fixture', owner: String(owner.id),
      inputSha256: 'a'.repeat(64), applicationVersion: durable.applicationVersion,
      deadlineAt: new Date(Date.now() + 45000).toISOString(), data: {} });
    assert.equal(ledger.run(run.runId), undefined);
    const marker = path.join(home.workspace, 'uncontracted-write');
    const execute = async (agent: typeof owner, name: string, args: Record<string, unknown>) => {
      try { return JSON.stringify(await host!.ctx.tools.execute({ agent, name, arguments: args,
        callId: `guard-${name}-${agent.id}` as never, signal: AbortSignal.timeout(3000) })); }
      catch (error) { return String(error); }
    };
    const denied = /recorded.*(task|delegation)|uncontracted|retained Campaign/i;
    assert.match(await execute(grandchild, 'bash', {
      command: `printf unauthorized > ${JSON.stringify(marker)}`, description: 'Test-owned authorization counterexample',
    }), denied);
    await assert.rejects(access(marker), /ENOENT/);
    for (const agent of [owner, child, grandchild]) {
      for (const name of ['subagent', 'subagent_fork']) assert.match(await execute(agent, name, {}), denied);
    }
    for (const agent of [child, grandchild]) {
      await sayAsUser(agent, 'Answer the bounded test prompt.');
      const query = host.ctx.get('sessionQuery' as never) as unknown as { readSession(id: string): Promise<{ events: { type: string }[] }> };
      assert.equal((await query.readSession(String(agent.id))).events.filter(event => event.type === 'request/header').length, 0);
    }
    const nextOwner=await createRootAgent(host.ctx,home.workspace);
    for(const action of ['pause','handoff','cancel'] as const){
      const current=await durable.store.run(run.runId);
      await durable.store.command({runId:run.runId,commandId:`authority-${action}`,action,owner:current.owner,epoch:current.epoch,revision:current.revision,...(action==='handoff'?{nextOwner:String(nextOwner.id)}:{})});
      for(const agent of [owner,grandchild,...(action==='pause'?[]:[nextOwner])])assert.match(await execute(agent,'subagent',{}),denied);
      assert.match(await execute(grandchild,'bash',{command:`printf unauthorized > ${JSON.stringify(marker)}`,description:'Held and cancelled ancestry stays fenced'}),denied);
      await assert.rejects(access(marker),/ENOENT/);
    }
    const ordinary = await execute(sideTalk, 'bash', {
      command: `printf ordinary > ${JSON.stringify(marker)}`, description: 'Independent Side Talk positive control',
    });
    assert.equal(await readFile(marker, 'utf8'), 'ordinary', ordinary);
  } finally { await host?.dispose(); await home.dispose(); }
});

test('one failed conversation restoration does not block another Run or its physical cancellation', { timeout: 60000 }, async () => {
  const home=await createHimaHome();let host:Awaited<ReturnType<typeof bootInProcess>>|undefined;
  try{
    if(process.env.HIMA_DBOS_TEST_PACKAGE){const link=path.join(home.profileDir,'node_modules/@hima/harness');await rm(link,{recursive:true,force:true});await symlink(process.env.HIMA_DBOS_TEST_PACKAGE,link,'dir');}
    const replay=await writeMomentFixture(home,'one-turn');await writeReplayOverlay(home.home,{file:replay.file,overrideFile:replay.override});
    host=await bootInProcess(home,{withWebApp:true});
    const bad=await createPresetRootAgent(host.ctx,home.workspace,'standard'),good=await createPresetRootAgent(host.ctx,home.workspace,'standard');
    const badId=String(bad.id),goodId=String(good.id);
    for(const [runId,owner] of [['unavailable-parent',badId],['available-parent',goodId]])await host.ctx.hima.durable.store.createRun({runId:runId!,owner:owner!,inputSha256:'b'.repeat(64),applicationVersion:host.ctx.hima.durable.applicationVersion,deadlineAt:new Date(Date.now()+60000).toISOString(),data:{product:{parentSessionId:owner!}}});
    await host.dispose();host=undefined;
    const fault=path.join(home.home,'recovery-fault.mjs'),attempts=path.join(home.home,'recovery-attempts');
    // A startup dependency fault, before Hima's normal owner recovery, without a product test hook.
    await writeFile(fault,`import {appendFileSync} from 'node:fs';\nexport const name='recovery-fault';export const inject=['sessionPersistence'];\nexport function apply(ctx){ctx.effect(()=>{const service=ctx.get('sessionPersistence'),original=service.stat;service.stat=async function(id){appendFileSync(${JSON.stringify(attempts)},String(id)+'\\n');if(String(id)===${JSON.stringify(badId)})throw new Error('injected one-session restoration failure');return original.call(this,id);};return ()=>{service.stat=original;};});}\n`);
    await appendFile(path.join(home.profileDir,'cordis.patch.yml'),stringify([{insert:[{id:'recovery-fault',name:fault}]}]));
    host=await bootInProcess(home,{withWebApp:true});
    const waitFor=async(label:string,condition:()=>Promise<boolean>)=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,25));}assert.fail(`${label}; bad=${badId}; attempted=${await readFile(attempts,'utf8').catch(()=>'(none)')}`);};
    await waitFor('unrelated retained owner must restore despite the first failure',async()=>!!host!.ctx.get('agents')?.get(goodId as never));
    assert.match(await readFile(attempts,'utf8'),new RegExp(badId));
    assert.equal(host.ctx.get('agents')?.get(badId as never),undefined);
    const packs=path.join(home.home,'hima/packs'),pack=path.join(packs,'recovery-command'),sites=path.join(home.home,'hima/sites');
    await mkdir(path.join(pack,'flow'),{recursive:true});await mkdir(sites,{recursive:true});
    await writeFile(path.join(pack,'flow/work.py'),"import pathlib,sys,time\npathlib.Path(sys.argv[1]).joinpath('started').write_text('original')\ntime.sleep(30)\n");
    await writeFile(path.join(pack,'contract.yml'),stringify({id:'recovery-command',version:'1',title:'Recovery isolation',words:{periodNs:{label:'Period',unit:'ns'}},inputs:[{name:'workspaceRoot'}],outputs:[],goal:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:1}},strategy:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:2}},tools:[{id:'work',file:'flow/work.py',inputs:['FLOW','WORKSPACE'],argv:['/usr/bin/python3','${FLOW}/work.py','${WORKSPACE}']}],environment:{wrappers:['/usr/bin/python3']},workspace:{source:'pack',copy:['work.py']}}));
    const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}};
    await writeFile(path.join(pack,'graph.yml'),stringify({schema:'hima-flow/1',id:'recovery-command',version:'1',flow:{kind:'task',id:'work',tool:'work',inputs:{},contract:{input:schema,output:schema}}}));
    await writeFile(path.join(sites,'local.permit.yml'),stringify({allowedReadRoots:[home.workspace,pack],allowedWriteRoots:[home.workspace],allowedWrappers:['/usr/bin/python3','sh'],forbidden:['services','licences','network','deletions','downloads']}));
    await writeFile(path.join(sites,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:home.workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:home.workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{}}}));
    const accepted=await host.ctx.hima.startRun({pack:'recovery-command',site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:goodId});
    assert.ok('run' in accepted,JSON.stringify(accepted));if(!('run' in accepted))return;
    const id=accepted.run.id;
    assert.ok('workspace' in accepted&&typeof accepted.workspace==='string',JSON.stringify(accepted));
    if(!('workspace' in accepted)||typeof accepted.workspace!=='string')return;
    const started=path.join(accepted.workspace,'started');
    await waitFor('unrelated command must start',async()=>await readFile(started,'utf8').then(value=>value==='original',()=>false));
    const current=await host.ctx.hima.readExecutionContext(id);
    const cancelled=await host.ctx.hima.executionAction({runId:id,requestId:'cancel-isolated-command',action:'cancel',actor:goodId,expectedEpoch:current.run.control!.epoch,expectedRevision:current.run.control!.revision});
    assert.equal(cancelled.kind,'accepted');
    await waitFor('original command resources must close',async()=>{const c=await host!.ctx.hima.readExecutionContext(id);return (c.run as {stopState?:{closed:boolean}}).stopState?.closed===true;});
    const {DBOS}=createRequire(new URL('../../packages/harness/package.json',import.meta.url))('@dbos-inc/dbos-sdk');
    const failures=await DBOS.listWorkflows({status:'ERROR'});
    assert.deepEqual(failures.map((item:{workflowID:string;error?:unknown})=>({id:item.workflowID,error:String(item.error)})),[], 'Physical closure must not conceal workflow identity failures');
  }finally{await host?.dispose();await home.dispose();}
});
