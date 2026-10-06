// Human control facts on the sole DBOS authority; public Guide control covered by growth's Host fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowProcess } from './support/flow-workflow-worker.ts';
import { dbosHome, cleanDbosHome } from './support/dbos-process.ts';
for(const mode of ['pause','cancel','unknown','human'])test(`durable ${mode} control retains actual branch/resource/business facts`,{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,mode);try{let result=await host.next();if(mode==='pause'){assert.equal(result.stage,'paused');result=await host.next();}assert.equal(result.ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('durable handoff refuses old-owner sends and conflicting command content; current owner stops original Job',{timeout:60000},async()=>{
  const home=await dbosHome(),host=flowProcess(home,'handoff');try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('human scoped pause survives restart and agent pause/continue; other-scope clearance cannot erase it',{timeout:90000},async()=>{
  const home=await dbosHome();let host=flowProcess(home,'human-hold');try{assert.equal((await host.next()).stage,'human-held');await host.kill();host=flowProcess(home,'human-hold-recover');assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
