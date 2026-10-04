import { test } from 'node:test';
import assert from 'node:assert/strict';
import {rename} from 'node:fs/promises';
import { dbosHome, cleanDbosHome } from './support/dbos-process.ts';
import { facadeProcess } from './support/facade-process.ts';
test('Host death after persisted preparation intent reopens the same paused Run; explicit continue alone permits original writes',{timeout:90000},async()=>{
  const home=await dbosHome();let host=facadeProcess(home,'intent');try{assert.equal((await host.next()).stage,'persisted-intent');await host.kill();host=facadeProcess(home,'pause-offline');assert.equal((await host.next()).stage,'paused-offline');await host.close();host=facadeProcess(home,'recover-held-stage');assert.equal((await host.next()).stage,'held-recovered');await host.kill();host=facadeProcess(home,'recover-paused');const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));}finally{await host.close();await cleanDbosHome(home);}
});

test('cancel after occupied preparation closes without changing the existing workspace',{timeout:30000},async()=>{
  const home=await dbosHome(),host=facadeProcess(home,'occupied-cancel');
  try{const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.closed,true);assert.equal(result.customerFilePreserved,true);}finally{await host.close();await cleanDbosHome(home);}
});

test('cancel after interrupted preparation preserves partial writes and unknown closure',{timeout:30000},async()=>{
  const home=await dbosHome(),host=facadeProcess(home,'partial-preparation-cancel');
  try{const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.closed,false);assert.equal(result.partialWorkPreserved,true);}finally{await host.close();await cleanDbosHome(home);}
});

test('accepted revision closes original work and recovers the same shared writer after Site materialization returns',{timeout:60000},async()=>{
 const home=await dbosHome(),host=facadeProcess(home,'shared-preparation-recovery');try{const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));}finally{await host.close();await cleanDbosHome(home);}
});

test('Host death after preparation write preserves its original unknown closure after replay and cancel',{timeout:60000},async()=>{
 const home=await dbosHome();let host=facadeProcess(home,'partial-preparation-intent');try{assert.equal((await host.next()).stage,'partial-written');await host.kill();host=facadeProcess(home,'recover-partial-cancel');const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.closed,false);}finally{await host.close();await cleanDbosHome(home);}
});

test('accepted unavailable revision replays after actual Host death with the same command and one shared writer',{timeout:90000},async()=>{
 const home=await dbosHome();let host=facadeProcess(home,'shared-revision-crash');try{const checkpoint=await host.next();assert.equal(checkpoint.stage,'accepted-revision-unavailable',JSON.stringify(checkpoint));await host.kill();await rename(checkpoint.hiddenSite,checkpoint.siteFile);host=facadeProcess(home,'recover-revision-crash');const result=await host.next();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.runId,checkpoint.runId);assert.equal(result.workflowId,checkpoint.workflowId);assert.equal(result.applicationVersion,checkpoint.applicationVersion);assert.equal(result.commandCount,1);assert.equal(result.readyCount,1);assert.equal(result.workspaceWriters,1);assert.equal(result.sourceWrites,1);assert.equal(result.errorWorkflows,0);}finally{await host.close();await cleanDbosHome(home);}
});
