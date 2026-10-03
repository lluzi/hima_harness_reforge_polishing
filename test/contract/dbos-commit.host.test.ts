import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbosHome,dbosProcess,cleanDbosHome } from './support/dbos-process.ts';

test('application commit before system checkpoint survives SIGKILL with one result, fact and business call',{timeout:90000},async()=>{
  const home=await dbosHome();let host=dbosProcess(home,'checkpoint-crash');
  try{
    assert.equal((await host.next()).stage,'application-committed-checkpoint-blocked');await host.kill();
    host=dbosProcess(home,'recover');const recovered=await host.next();assert.equal(recovered.ok,true);
    assert.equal(recovered.facts.filter((fact:any)=>fact.kind==='task-result').length,1);
  }finally{await host.close();await cleanDbosHome(home);}
});
test('history projection before ack survives SIGKILL without duplicate history or repeated business work',{timeout:90000},async()=>{
  const home=await dbosHome();let host=dbosProcess(home,'projection-crash');
  try{
    assert.equal((await host.next()).stage,'projection-written-before-ack');await host.kill();
    host=dbosProcess(home,'projection-recover');assert.equal((await host.next()).stage,'projection-recovered');
  }finally{await host.close();await cleanDbosHome(home);}
});
