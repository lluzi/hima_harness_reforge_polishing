import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { flowProcess } from './support/flow-workflow-worker.ts';
import { dbosHome, cleanDbosHome } from './support/dbos-process.ts';
test('real DBOS executes sequence/choice/parallel/repeat/fragment with committed named returns',{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'flows');
  try {let result;const scenarios=[];do{result=await host.next();if(result.stage==='scenario')scenarios.push(result.scenario);}while(!result.ok);assert.equal(scenarios.length,7);}finally{await host.close();await cleanDbosHome(home);}
});
test('revising one actual input reruns its consumers while active sibling retains one original Job and deadline',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'revise');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('original closing reserve blocks new business Jobs',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'deadline');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('declared closing delivery consumes committed values inside the reserve without a fresh work attempt',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'closing-budget');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('closing-task admission still refuses submit after the original hard deadline',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'closing-hard');try{assert.equal((await host.next()).stage,'cached-admission');assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
for(const scenario of ['choice','repeat','extension'])test(`${scenario} commit survives Host kill and selects the same original child`,{timeout:90000},async()=>{
  const home=await dbosHome();let host=flowProcess(home,`crash-${scenario}`);
  try{assert.equal((await host.next()).stage,'committed-decision');await host.kill();host=flowProcess(home,`recover-${scenario}`);assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
for(const mode of ['attempts','fragment-revise'])test(`original ${mode} authority includes dependent child effects`,{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,mode);try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('selected repeat invocation revision preserves prior Jobs and current carry plus independent sibling',{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'frontier');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('known running Job/Reader collection remains running without false rejection or repeated state churn',{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'reader-pending');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('capacity greater than one cannot bypass unknown original revision closure; genuine stop unblocks stage/send',{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'revision-hold');try{assert.equal((await host.next()).stage,'held-replacement');assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
for(const mode of ['optional-failed','optional-abandoned','optional-cancelled'])test(`${mode} preserves negative outcome and returns to original parent continuation`,{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,mode);try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
for(const mode of ['pending-ready','watch-lifecycle','failed-revise','multi-fields'])test(`${mode} uses original scoped facts and finite interpreter`,{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,mode);try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('independent original hard deadline closes Job while main submit receipt is blocked',{timeout:90000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'hard-blocked');try{assert.equal((await host.next()).stage,'main-submit-blocked');assert.equal((await host.next()).stage,'hard-closed');assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});

for(const mode of ['materialization','materialization-cleanup'])test(`${mode} restores original adapter without duplicating admitted Job or deadline`,{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,mode);try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('held two-hour Run bounds durable receipts and resumes original deadline after Host restart',{timeout:60000},async()=>{
  const home=await dbosHome();let host=flowProcess(home,'idle-receipts');
  try{const before=await host.next();assert.equal(before.stage,'idle-sample');console.info('Idle durable receipt sample',before);assert.equal((await host.next()).stage,'idle-bounded');await host.kill();host=flowProcess(home,'idle-recover');const reopened=await host.next();assert.equal(reopened.stage,'idle-reopened');console.info('Idle Host recovery sample',reopened);const after=await host.next();assert.equal(after.ok,true);assert.equal(after.deadline,before.deadline);console.info('Idle task continuation sample',{continueWakeMs:after.continueWakeMs});}finally{await host.close();await cleanDbosHome(home);}
});

test('materialization diagnostic replays after Host kill and binding restore without resending original Job',{timeout:60000},async()=>{
  const home=await dbosHome();let host=flowProcess(home,'materialization-kill');
  try{const before=await host.next();assert.equal(before.stage,'materialization-held');await host.kill();await unlink(path.join(home,'materialization-unavailable'));host=flowProcess(home,'materialization-recover');const after=await host.next();assert.equal(after.ok,true);assert.equal(after.effectId,before.effectId);assert.equal(after.deadline,before.deadline);}finally{await host.close();await cleanDbosHome(home);}
});

test('retained materialization freezes once with compact repeated receipts and honest unavailable producer',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'retained-fact');try{const result=await host.next();assert.equal(result.ok,true);console.info('Retained materialization receipts',result.receipts);}finally{await host.close();await cleanDbosHome(home);}
});
test('frozen materialization replays after Host kill while original source is unreadable',{timeout:60000},async()=>{
  const home=await dbosHome();let host=flowProcess(home,'retained-fact-kill');
  try{const before=await host.next();assert.equal(before.stage,'retained-fact-seeded');await host.kill();await unlink(path.join(home,'retained-source.json'));host=flowProcess(home,'retained-fact-recover');const after=await host.next();assert.equal(after.ok,true);assert.deepEqual(after.metadata,before.metadata);console.info('Retained materialization cold replay',after);}finally{await host.close();await cleanDbosHome(home);}
});
