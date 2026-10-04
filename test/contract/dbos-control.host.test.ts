import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowProcess } from './support/flow-workflow-worker.ts';
import { dbosHome, cleanDbosHome } from './support/dbos-process.ts';
test('Host killed after cached admission rechecks current pause before actual send and resumes original effect',{timeout:90000},async()=>{
  const home=await dbosHome();let host=flowProcess(home,'cached');
  try{
    const before=await host.next();assert.equal(before.stage,'cached-admission');host.send({action:'control',runId:'cached',operation:'pause'});assert.equal((await host.next()).stage,'control');await host.kill();
    host=flowProcess(home,'cached-recover');const reopened=await host.next();assert.equal(reopened.stage,'reopened');assert.equal(reopened.deadline,before.deadline);
    const held=await host.next();assert.equal(held.stage,'held');assert.equal(held.rows.length,0,'Paused recovery must send zero actual effects');
    host.send({action:'control',runId:'cached',operation:'continue'});assert.equal((await host.next()).stage,'control');
    let view;for(let attempt=0;attempt<60;attempt++){host.send({action:'status',runId:'cached'});view=await host.next();if(view.view.workflow?.status==='SUCCESS')break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.equal(view.view.workflow.status,'SUCCESS',JSON.stringify(view));assert.equal(view.rows.filter((row:any)=>row.phase==='start').length,1);
  }finally{await host.close();await cleanDbosHome(home);}
});
test('concurrent valid main/control closure retains first proof, one release and verified delivery',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'closure-race');try{assert.equal((await host.next()).stage,'before-main-release');host.send({action:'control',runId:'closure-race',operation:'cancel'});assert.equal((await host.next()).stage,'control');host.send({action:'gate'});assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});

test('concurrent main/control cleanup retains one original stop proof with zero failed workflows',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'cleanup-race');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
