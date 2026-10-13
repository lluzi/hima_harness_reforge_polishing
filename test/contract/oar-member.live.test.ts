// #101 L4: trusted native OAR/Pi/OpenCode, same real Host/PG/DBOS, separate cwd/config.
// This is functional qualification, not installation/Linux/distribution acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { bootInProcess,createRootAgent } from './support/boot-inprocess.ts';
import { localHome,waitUntil } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';
import type { TeamDefinition } from '@hima/harness';
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
const key=process.env.DEEPSEEK_API_KEY,piOnly=process.env.HIMA_OAR_LIVE_CASE==='pi-only';
test(piOnly?'OAR real Pi completes, retains artifacts and stops':'OAR real Pi/OpenCode complete, coexist and stop with scoped Host access and retained artifacts',{
  timeout:540000,skip:!key?'Requires authorized shared DeepSeek credential':false,
},async t=>{
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);const host=await bootInProcess(home.h);
  const evidence=path.join(process.env.HIMA_TEAM_EVIDENCE??path.resolve('.scratch/himateam-issue97/issue101-live'),new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(evidence,{recursive:true});const tasks:any[]=[];let sessionId='';
  const reports:unknown[]=[];
  reports.push({modelSelection:host.ctx.get('agentDefaultModel')?.currentSelection(),scope:'Trusted native process; no OS/network isolation qualification'});
  try {
    const guide=await createRootAgent(host.ctx,home.h.workspace);sessionId=String(guide.id);
    const definition:TeamDefinition={...teamFixture,members:[
      {...teamFixture.members[0]!,id:'pi-member',runtime:'pi',modelRef:'default'},
      {...teamFixture.members[0]!,id:'oc-member',runtime:'opencode',modelRef:'default'},
    ],leaderMemberId:'pi-member'};
    const first=await host.ctx.hima.teamOperation(sessionId,{action:'save',definition,expectedVersion:null}) as any;
    const second=await host.ctx.hima.teamOperation(sessionId,{action:'save',teamId:first.teamId,definition:{...definition,leaderMemberId:'oc-member'},expectedVersion:first.version}) as any;
    const open=async(version:number,id:string,goal:string)=>{
      const value=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:first.teamId,request:{requestId:id,teamId:first.teamId,expectedVersion:version,goal,input:{marker:id},deadlineAt:new Date(Date.now()+230000).toISOString(),closure:'Return the schema-valid sourced result or stop and close every owned resource.'}}) as any;
      tasks.push(value);return value;
    };
    const read=async(task:any)=>host.ctx.hima.teamOperation(sessionId,{action:'readTask',teamId:first.teamId,taskId:task.taskId}) as Promise<any>;
    const nativeRows=async(task:any)=>{
      const invocations=await host.ctx.hima.durable.store.flowInvocations(task.currentRunId);
      const view=await read(task);if(view.execution?.state==='failed')throw new Error(view.execution.reason??'Real native task failed.');
      return (await Promise.all(invocations.map(async row=>Object.values(await host.ctx.hima.durable.store.listExternalEffectFacts(row.identity,'oar:observation:')).map(value=>value as any)))).flat();
    };
    const busyGoal=`Use your native bash tool now to run ${JSON.stringify(process.execPath)} -e "setTimeout(()=>{},120000)". Do not return a result before it finishes. This is an intentional stop test. Keep the native task active.`;
    const completeGoal=(marker:string)=>`Invoke the native member_context tool with action readTask and request {}. Use its artifactIdentity fields exactly for the artifact. Then use native bash to execute ${JSON.stringify(process.execPath)} to write proof.txt containing exactly ${JSON.stringify(marker)}. Compute its SHA256 from the actual bytes. Return ONLY the declared TaskToolOutput JSON envelope. value must be {"answer":${JSON.stringify(marker)}}. Include proof.txt as artifact named proof with the exact task identity from your prompt and its measured SHA256. Do not put markdown around the final JSON.`;
    const ocComplete=piOnly?undefined:await open(second.version,'opencode-complete-proof',completeGoal('opencode-native-proof'));
    const awaitResult=async(task:any,marker:string)=>{
      await waitUntil('real runtime commits only after closure',async()=>{const view=await read(task);if(view.execution?.state==='failed'||view.execution?.reason==='Member artifact belongs to another task effect.')throw new Error(view.execution.reason??'Real native task failed.');return !!view.execution?.tasks.some((row:any)=>row.result);},180000,250);
      const view=await read(task),result=view.execution.tasks.find((row:any)=>row.result).result;
      assert.deepEqual(result.value,{answer:marker});assert.equal(view.execution.resourceState,'closed');
      const received=(await nativeRows(task)).filter(row=>row.kind==='received');assert.ok(received.length,'native receive evidence required');
      const artifact=await host.ctx.hima.teamOperation(sessionId,{action:'read-task-artifact',teamId:first.teamId,taskId:task.taskId,request:{effectId:result.identity.effectId,name:'proof'}},'human') as any;
      const bytes=Buffer.from(artifact.contentBase64,'base64');assert.equal(bytes.toString(),marker);assert.equal(createHash('sha256').update(bytes).digest('hex'),result.artifacts[0].sha256);
      const replies=await host.ctx.hima.durable.store.listExternalEffectFacts(result.identity,'oar:tool-reply:');
      assert.ok(Object.values(replies).some((row:any)=>row.ok===true&&row.value?.actor?.kind==='member'),'real MCP bridge resolves the Host member actor');
      const work=await host.ctx.hima.teamOperation(sessionId,{action:'read-member-work',teamId:first.teamId,taskId:task.taskId,request:{memberId:view.team.version===first.version?'pi-member':'oc-member',page:{limit:20}}}) as any;
      assert.equal(work.trace.state,'retained');assert.equal(work.connection,'disconnected');assert.ok(work.records.some((row:any)=>row.kind==='transcript'));
      reports.push({taskId:task.taskId,runId:task.currentRunId,result,received,artifact:artifact.asset,mcpReplies:Object.keys(replies),workTrace:work.trace});return result;
    };
    if(ocComplete)await awaitResult(ocComplete,'opencode-native-proof');
    const stop=async(task:any,id:string)=>{
      const view=await read(task);await host.ctx.hima.teamOperation(sessionId,{action:'control',teamId:first.teamId,taskId:task.taskId,request:{requestId:id,action:'cancel',expectedEpoch:view.execution.epoch,expectedRevision:view.execution.revision}},'human');
      await waitUntil('cancelled runtime exact resource closure',async()=>(await read(task)).execution?.resourceState==='closed',30000,200);
      const stopped=await read(task);assert.equal(stopped.execution.state,'cancelled');assert.ok(stopped.execution.tasks.every((row:any)=>!row.result));
      reports.push({taskId:task.taskId,stop:stopped.execution});
    };
    const piBusy=await open(first.version,'pi-stop-proof',busyGoal);
    await waitUntil('actual Pi native tool is running',async()=>(await nativeRows(piBusy)).some(row=>row.kind==='event'&&row.payload?.kind==='tool_call_started'),180000,250);
    const ocBusy=piOnly?undefined:await open(second.version,'oc-stop-proof',busyGoal);
    if(ocBusy){
    await waitUntil('actual OpenCode native tool is running',async()=>(await nativeRows(ocBusy)).some(row=>row.kind==='event'&&row.payload?.kind==='tool_call_started'),120000,250);
    await waitUntil('two native members coexist with distinct process and directory identities',async()=>{
      const leases=(await Promise.all([piBusy,ocBusy].map(async task=>{
        const invocations=await host.ctx.hima.durable.store.flowInvocations(task.currentRunId);
        return (await Promise.all(invocations.map(async row=>Object.values(await host.ctx.hima.durable.store.listExternalEffectFacts(row.identity,'oar:local-birth:'))))).flat();
      }))).flat() as {pid:number;processGroup:number;controlDirectory:string;workDirectory:string}[];
      return new Set(leases.map(row=>row.pid)).size>=2&&new Set(leases.map(row=>row.processGroup)).size>=2
        &&new Set(leases.map(row=>row.controlDirectory)).size>=2&&new Set(leases.map(row=>row.workDirectory)).size>=2;
    },120000,250);
    }
    await stop(piBusy,'pi-cancel-native');
    if(ocBusy)await stop(ocBusy,'oc-cancel-native');
    const piComplete=await open(first.version,'pi-complete-proof',completeGoal('pi-native-proof'));await awaitResult(piComplete,'pi-native-proof');
  }finally{
    if(sessionId)for(const task of tasks) {
      try {
        const view=await host.ctx.hima.teamOperation(sessionId,{action:'readTask',teamId:task.team.teamId,taskId:task.taskId}) as any;
        const invocations=await host.ctx.hima.durable.store.flowInvocations(task.currentRunId);
        reports.push({terminalView:view,native:await Promise.all(invocations.map(async row=>({identity:row.identity,facts:await host.ctx.hima.durable.store.listExternalEffectFacts(row.identity,'oar:')})))});
        if(view.execution.resourceState!=='closed')await host.ctx.hima.teamOperation(sessionId,{action:'control',teamId:task.team.teamId,taskId:task.taskId,request:{requestId:'terminal-cleanup-'+task.taskId.slice(-30),action:'cancel',expectedEpoch:view.execution.epoch,expectedRevision:view.execution.revision}},'human');
      }catch(error){reports.push({cleanupFailure:error instanceof Error?error.message:String(error)});}
    }
    await writeFile(path.join(evidence,'functional-results.json'),JSON.stringify({reports,selectedCase:piOnly?'pi-only':'both-runtimes',scope:'Trusted native functional only; no OS isolation or Linux/distribution qualification'},null,2));
    await host.dispose();await home.h.dispose();
  }
});
