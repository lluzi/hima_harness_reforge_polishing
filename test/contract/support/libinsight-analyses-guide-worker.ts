// @hima-seam agent wrapped
// Custom library analyses from the Guide conversation (ADR-0021) end to end: the Guide's
// hima_insight_analysis tool proposes (writing the request onto the Site and preparing), confirms once as
// a Guide-confirmed durable Run and reads the admitted result; the analysis page shows the same bytes.
// Only the native ACP engineer is a stand-in (the Pack's verified example script); no model is called.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,realpath,cp,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {bootInProcess,createRootAgent} from './boot-inprocess.ts';
import type {StartRunResult} from '@hima/harness';
import {prepareHimaHome,himaHomeSources} from '../../../packages/desktop/src/hima-home.ts';
import {repoRoot} from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify}=require('yaml');
const home=await realpath(process.argv[2]!),mode='clean';
const startedAt=Date.now(),packId='libinsight-analysis';
const fixture=path.join(repoRoot,'test/fixtures/libinsight-resident-dry');
const packTests=path.join(repoRoot,'packs',packId,'flow/tests');
const packageDir=path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {createDurableViewReaders}=await load('durable-views');
const workspace=path.join(home,'workspace'),packsDir=path.join(home,'hima/packs'),sitesDir=path.join(home,'hima/sites');
const admin=path.join(workspace,'admin'),requests=path.join(workspace,'requests'),library=path.join(workspace,'library');
const corpus=path.join(workspace,'corpus'),modeFile=path.join(admin,'empyrean-license-mode');
const evidence=path.join(repoRoot,'.hima-tmp/libinsight-r2');
for(const dir of [workspace,admin,requests,path.join(corpus,'saed14'),sitesDir,evidence])await mkdir(dir,{recursive:true});
await cp(path.join(repoRoot,'packs',packId),path.join(packsDir,packId),{recursive:true,filter:p=>!p.includes('__pycache__')});
// Synthetic facts in the extractor's exact shape; facts mode needs no licence, so the mode stays XTop.
const facts=path.join(corpus,'saed14','synthetic_saed14rvt_tt.json.gz');
const made=spawnSync('python3',['-c',`import sys;sys.path.insert(0,${JSON.stringify(packTests)});import synthetic;synthetic.write_facts(${JSON.stringify(facts)})`],{encoding:'utf8'});
assert.equal(made.status,0,made.stderr);
await writeFile(modeFile,'old\n');
const question='How does SAED14 inverter cell_rise delay scale with drive strength at one fixed load?';
const wrapper=path.join(repoRoot,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const native=path.join(fixture,'acp.py'),capability=path.join(admin,'capability.json'),prompts=path.join(admin,'prompts.jsonl');
await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.18.34',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},
 environment:{inherit:[],set:{LIA_DRY_CASE:mode,LIA_DRY_PROMPTS:prompts},toolPaths:[],credentialReadPaths:[]},
 delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,path.join(repoRoot,'sites/linglong-atcs28/templates'),fixture],allowedWriteRoots:[workspace],
 allowedWrappers:['python3','/usr/bin/python3',wrapper],forbidden:['services','network','downloads','deletions','licences']}));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:path.join(workspace,'campaigns'),permit:'./local.permit.yml',
 bindings:{workspaceRoot:path.join(workspace,'campaigns'),analysisRequest:path.join(requests,'unset.json'),analysisRequests:requests,analysisLibrary:library,
  factsCorpus:corpus,engineeringCapabilities:capability,licenceModeFile:modeFile,sourceReadRoots:workspace},
 capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{'QuaLib-2026-new-59099':1}}}));
process.env.HIMA_LIBINSIGHT_ANALYSIS_SITE='local';process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';process.env.HIMA_RESIDENT_TESTING='1';
const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const prepared=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:prepared.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any,runId:string|undefined,lastListed:any;
try {
 host=await bounded('boot Host',bootInProcess(h,{withWebApp:true}),45000);const service=host.ctx.hima,runtime=service.durable;
 const readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()});
 const guide=await createRootAgent(host.ctx,workspace),sessionId=String(guide.id);
 const base=`http://127.0.0.1:${host.ctx.webServer.port}`;
 const auth=await bounded('HTTP authentication',fetch(host.ctx.connection.authenticatedUrl(base),{redirect:'manual'})),cookie=auth.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 const call=async(method:'GET'|'POST',body?:object,query=''):Promise<{status:number;json:any}>=>{
  const answer=await bounded<Response>(`HTTP ${method} analyses`,fetch(new URL(`/hima/api/libinsight/analyses${query}`,base),{method,headers:{cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:answer.status,json:await answer.json()};
 };
 const page=async(at:string,withCookie=true):Promise<{status:number;html:string}>=>{
  const answer=await bounded<Response>('analysis page',fetch(new URL(at,base),{headers:withCookie?{cookie}:{}}));
  return {status:answer.status,html:await answer.text()};
 };
 // The Guide's own tool, called as the conversation's Agent calls it (ADR-0021).
 const tool=async(agent:any,args:object):Promise<{isError:boolean;json:any;text:string}>=>{
  const answer=await bounded<any>('hima_insight_analysis',host.ctx.tools.execute({name:'hima_insight_analysis',callId:`analysis-${crypto.randomUUID()}` as never,arguments:args,agent,signal:AbortSignal.timeout(20_000)}));
  const text=answer.content?.find((item:any)=>item.type==='text')?.text??'';
  let json:any;try{json=JSON.parse(text);}catch{json=undefined;}
  return {isError:answer.isError===true,json,text};
 };
 // A conversation that is not live on this Host sees nothing; no browser route starts an analysis.
 assert.equal((await call('GET',undefined,'?sessionId=not-a-session')).status,403);
 assert.equal((await call('POST',{sessionId,action:'propose',question:'x'})).status,405);
 const empty=await tool(guide,{action:'list'});
 assert.equal(empty.isError,false,empty.text);
 assert.equal(empty.json.status.available,true,JSON.stringify(empty.json.status));assert.deepEqual(empty.json.analyses,[]);
 // A bad request is refused before anything reaches the Site.
 const climbing=await tool(guide,{action:'propose',question:'q',sources:['/tmp/../etc/passwd']});
 assert.equal(climbing.isError,true,climbing.text);assert.deepEqual(await readdir(requests),[]);
 const proposed=await tool(guide,{action:'propose',question,sources:[facts]});
 assert.equal(proposed.isError,false,proposed.text);
 const proposal=proposed.json;
 assert.equal(proposal.action,'propose');assert.equal(proposal.ready,true,JSON.stringify(proposal));assert.equal(proposal.question,question);assert.equal(proposal.pack.id,packId);assert.equal(proposal.site,'local');
 assert.match(proposal.requestId,/^req-[0-9]{14}-[a-z0-9]{6}$/);assert.match(proposal.next,/only after they explicitly agree/);
 const written=JSON.parse(await readFile(path.join(requests,`${proposal.requestId}.json`),'utf8'));
 assert.deepEqual({schema:written.schema,requestId:written.requestId,question:written.question,sources:written.sources,buildsOn:written.buildsOn},{schema:'hima-libinsight-request/1',requestId:proposal.requestId,question,sources:[facts],buildsOn:[]});
 // Another conversation cannot confirm this proposal.
 const other=await createRootAgent(host.ctx,workspace);
 assert.equal((await tool(other,{action:'confirm',proposalId:proposal.proposalId})).isError,true);
 const confirmed=await tool(guide,{action:'confirm',proposalId:proposal.proposalId});
 assert.equal(confirmed.isError,false,confirmed.text);runId=confirmed.json.runId;assert.ok(runId);
 assert.equal(confirmed.json.page,`/hima/analysis/${encodeURIComponent(runId!)}?session=${encodeURIComponent(sessionId)}`);
 // A confirmation is used once.
 assert.equal((await tool(guide,{action:'confirm',proposalId:proposal.proposalId})).isError,true);
 // The page exists from the start, behind the browser fence and a live conversation, and refreshes itself while running.
 assert.equal((await page(confirmed.json.page,false)).status,401);
 assert.equal((await page(`/hima/analysis/${encodeURIComponent(runId!)}?session=not-a-session`)).status,403);
 const early=await page(confirmed.json.page);
 assert.equal(early.status,200,early.html.slice(0,400));assert.ok(early.html.includes(question.slice(0,40)));
 let listed:any;
 await until('the admitted analysis is listed',async()=>{listed=(await tool(guide,{action:'list'})).json;lastListed=listed;return listed?.analyses?.[0]?.analysis?.admitted===true;});
 const entry=listed.analyses[0];
 assert.equal(entry.runId,runId);assert.equal(entry.question,question);assert.equal(entry.task.state,'succeeded');assert.equal(entry.page,confirmed.json.page);
 assert.equal(entry.result,undefined,'the list carries summaries, never whole results');
 assert.deepEqual({id:entry.analysis.id,version:entry.analysis.version,plotCount:entry.analysis.plotCount,admitted:entry.analysis.admitted},{id:'saed14-inv-drive-delay',version:1,plotCount:5,admitted:true});
 const answered=await tool(guide,{action:'result',runId});
 assert.equal(answered.isError,false,answered.text);
 assert.deepEqual(answered.json.admission,{admitted:true});assert.equal(answered.json.analysis,'saed14-inv-drive-delay@1');assert.equal(answered.json.plots.length,5);
 assert.equal(answered.json.page,confirmed.json.page);assert.ok(answered.json.summary.length>0);
 for(const data of Object.values<any>(answered.json.datasets))assert.ok(data.rows.length<=40&&data.rowCount>=data.rows.length);
 const detail=(await call('GET',undefined,`?sessionId=${encodeURIComponent(sessionId)}&runId=${encodeURIComponent(runId!)}`)).json;
 assert.deepEqual(detail.admission,{admitted:true});
 assert.equal(detail.result.schema,'hima-libinsight-analysis/1');assert.equal(detail.result.plots.length,5);
 const observation=(await readers.readRunView(runId)).tasks.find((task:any)=>task.taskId==='custom-analysis'&&task.result).result.value.observations.find((record:any)=>record.outputName==='analysisResult');
 assert.equal(entry.analysis.resultSha256,observation.contentSha256);
 assert.deepEqual(detail.result,JSON.parse(await readFile(observation.retainedPath,'utf8')),'the detail is exactly the Reader-accepted bytes the Host retained');
 assert.deepEqual(await readFile(path.join(library,'saed14-inv-drive-delay','v1','analysis-result.json')),await readFile(observation.retainedPath),'and those are the bytes admitted into the Site library');
 assert.equal((await call('GET',undefined,`?sessionId=not-a-session&runId=${encodeURIComponent(runId!)}`)).status,403);
 await until('Run ended',async()=>String((await readers.readRunView(runId))?.run.status).startsWith('ended'));
 // The finished page draws every plot from those bytes and no longer refreshes.
 const done=await page(confirmed.json.page);
 assert.equal(done.status,200);assert.ok(done.html.includes('saed14-inv-drive-delay@1'),'the page names the admitted analysis');
 for(const plot of detail.result.plots)assert.ok(done.html.includes(plot.title.replace(/&/g,'&amp;').replace(/</g,'&lt;')),`the page shows ${plot.title}`);
 assert.equal(/http-equiv="refresh"/i.test(done.html),false);assert.equal(/<script/i.test(done.html),false);
 await writeFile(path.join(evidence,'analysis-page.html'),done.html);
 assert.equal((await page(`/hima/analysis/run-not-a-run?session=${encodeURIComponent(sessionId)}`)).status,404);
 const proof={ok:true,runId,requestId:proposal.requestId,plots:detail.result.plots.length,elapsedMs:Date.now()-startedAt};
 await writeFile(path.join(evidence,'guide-proof.json'),JSON.stringify(proof,null,2));
 process.send?.(proof);
} catch(error){
 const proof:any={ok:false,runId,lastListed,view:runId&&host?await createDurableViewReaders({ledger:host.ctx.hima.ledger,judge:host.ctx.hima.judge,sitesDir,packsDir,host:host.ctx,durable:host.ctx.hima.durable,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()}).readRunView(runId).then((v:any)=>({status:v?.run.status,tasks:v?.tasks?.map((t:any)=>({id:t.taskId,p:t.projection}))})).catch((e:any)=>String(e)):undefined,error:String(error),stack:(error as Error).stack,elapsedMs:Date.now()-startedAt};
 await writeFile(path.join(evidence,'guide-failure.json'),JSON.stringify(proof,null,2).replace(/([?&]token=)[^\s&]+/g,'$1[redacted]'));
 process.send?.(proof);process.exitCode=1;
}
finally{if(runId)await host?.ctx.hima.cancelRun(runId).catch(()=>{});await host?.dispose();}
async function until(label:string,probe:()=>Promise<boolean>){
 const end=Math.min(Date.now()+70000,startedAt+85000);
 while(Date.now()<end){if(await bounded(label,probe(),Math.min(5000,Math.max(1,end-Date.now())))) return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error(`Proof deadline: ${label}`);
}
async function bounded<T>(label:string,read:Promise<T>,milliseconds=15000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {return await Promise.race([read,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Await exceeded ${milliseconds}ms: ${label}`)),milliseconds);})]);}
 finally{if(timer)clearTimeout(timer);}
}
