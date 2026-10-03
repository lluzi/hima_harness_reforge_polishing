import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { dbosHome,dbosProcess,cleanDbosHome,postgresRuntime } from './support/dbos-process.ts';

test('DBOS Run and control IDs retain original input and reject identity mismatch',{timeout:60000},async()=>{
  const home=await dbosHome();const host=dbosProcess(home,'idempotency');
  try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
test('datasource rollback leaves no partial result and independent Homes isolate facts and credentials',{timeout:60000},async()=>{
  const first=await dbosHome();const second=await dbosHome();const a=dbosProcess(first,'rollback');const b=dbosProcess(second,'rollback');
  try{const one=await a.next();const two=await b.next();assert.equal(one.ok,true);assert.equal(two.ok,true);
    assert.notEqual(one.identity,two.identity);assert.notEqual(one.port,two.port);assert.notEqual(one.credentialDigest,two.credentialDigest);
  }finally{await Promise.all([a.close(),b.close()]);await Promise.all([cleanDbosHome(first),cleanDbosHome(second)]);}
});
test('interrupted PostgreSQL stops admission fail closed and original version resumes after reopening',{timeout:90000},async()=>{
  const home=await dbosHome();let host=dbosProcess(home,'admission');
  try{
    const initial=await host.next();assert.equal(initial.stage,'before-interrupt');
    assert.ok(initial.workflow,'An in-flight DBOS workflow must exist before PG outage');
    assert.equal(initial.workflow.workflowID,'workflow-u3');assert.equal(initial.workflow.status,'PENDING');
    assert.deepEqual(initial.workflow.input,[{runId:'run-u3',outageGate:true}]);
    assert.equal(initial.workflow.applicationVersion,initial.version);
    const stopped=spawnSync(path.join(postgresRuntime!,'bin/pg_ctl'),['-D',path.join(home,'hima/database/data'),'-m','immediate','-w','stop'],{encoding:'utf8'});
    assert.equal(stopped.status,0,stopped.stderr);
    // The pinned datasource's private idle Pool has no public error-handler injection. Its
    // unexpected disconnect terminates this Host; that is a closed admission boundary.
    await Promise.race([host.ended,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Host did not fail closed after PG interruption')),5000);timer.unref();})]);
    assert.notEqual(host.child.exitCode,0);
    assert.match(host.stderr(),/terminating connection|Connection terminated|error event/i);
    const credentials=JSON.parse(await readFile(path.join(home,'hima/database/credentials.json'),'utf8'));
    assert.equal(host.stderr().includes(credentials.password),false,'Pinned PG error must not log credentials');
    assert.equal(await readFile(path.join(home,'admission-calls'),'utf8'),'admitted\n','No new Permit/effect callback runs during the outage');
    host=dbosProcess(home,'outage-recover');const reopened=await host.next();
    assert.equal(reopened.stage,'persisted-workflow-reopened');
    for(const key of ['workflowID','workflowName','input','applicationVersion','createdAt']) assert.deepEqual(reopened.workflow[key],initial.workflow[key]);
    assert.equal(reopened.workflow.status,'PENDING');
    const recovered=await host.next();assert.equal(recovered.ok,true);
    assert.equal(recovered.workflow.status,'SUCCESS');
    for(const key of ['workflowID','workflowName','input','applicationVersion','createdAt']) assert.deepEqual(recovered.workflow[key],initial.workflow[key]);
    assert.equal(recovered.facts.filter((fact:any)=>fact.kind==='task-result').length,1);
    assert.deepEqual(recovered.facts.find((fact:any)=>fact.kind==='task-result').payload.value,{answer:42});
    assert.equal(await readFile(path.join(home,'admission-calls'),'utf8'),'admitted\n');
  }finally{await host.close();await cleanDbosHome(home);}
});

test('invalid executable and inherited cloud configuration reject locally without stranding startup ownership',{timeout:60000},async()=>{
  const home=await dbosHome();const host=dbosProcess(home,'startup');
  try{assert.equal((await host.next()).ok,true);}finally{await host.close();await cleanDbosHome(home);}
});
