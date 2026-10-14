// L2 ordinary Node child fixture. No OAR/model/runtime qualification is claimed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function until(f: () => Promise<boolean>) { for (let i = 0; i < 100; i++) {
    if (await f())
        return;
    await pause(30);
} throw Error('fixture observation timeout'); }
async function fixture(t: any, key: string, deadlineMs = 20000, mode: 'complete'|'held'|'late'|'invalid'|'delivered-active'|'yield-abort' = 'complete') {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'hima-local-member-')), runner = path.join(root, 'runner.mjs');
    fs.writeFileSync(runner, `import {spawn} from 'node:child_process'; import fs from 'node:fs';
let config,descendant,activeInput;const mode=${JSON.stringify(mode)}; process.send({type:'ready'});
process.on('message',m=>{ if(m.type==='config'){config=m.config;descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});fs.writeFileSync(config.workDirectory+'/descendant.pid',String(descendant.pid));process.send({type:'created',payload:{runtime:config.prepared.runtime,nativeSession:'native-fixture'}});}
if(m.type==='input')activeInput=m.id;
if(m.type==='yield'&&mode==='yield-abort'){
 process.send({type:'terminal',payload:{inputId:activeInput,outcome:{kind:'interrupted',reason:'Actual physical yield shutdown abort'}}});return;
}
if(m.type==='input'&&mode==='delivered-active'&&!m.initial){process.send({type:'received',payload:{inputId:m.id,evidence:'actual-post-delivery-directed-input'}});return;}
if(m.type==='input'&&m.id==='disconnect'){process.disconnect();return;}
if(m.type==='input'&&(mode==='held'||mode==='late'||mode==='yield-abort')){
 const receipt=()=>process.send({type:'received',payload:{inputId:m.id,evidence:'actual-late-node-ipc'}});
 if(mode!=='late')receipt();
 const poll=setInterval(()=>{
  const flag=name=>config.workDirectory+'/'+name;
  if(fs.existsSync(flag('received.flag'))){fs.unlinkSync(flag('received.flag'));receipt();}
  if(fs.existsSync(flag('finish.flag'))){fs.unlinkSync(flag('finish.flag'));process.send({type:'raw',payload:{text:'exact native raw'}});process.send({type:'event',payload:{kind:'text',text:'exact native event'}});process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});process.send({type:'finished',inputId:m.id,text:'Ordinary accepted-wait prose'});}
  if(fs.existsSync(flag('failure.flag'))){clearInterval(poll);process.send({type:'failure',reason:'Actual pre-cleanup native failure'});}
 },10);return;
}
if(m.type==='input'&&mode==='invalid'){process.send({type:'received',payload:{inputId:m.id}});process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});process.send({type:'finished',inputId:m.id,text:'Invalid initial prose without accepted wait'});return;}
if(m.type==='input'){process.send({type:'received',payload:{inputId:m.id,evidence:'fixture'}});process.send({type:'terminal',payload:{inputId:m.id,outcome:{kind:'completed'}}});process.send({type:'finished',inputId:m.id,text:JSON.stringify({schemaVersion:'output/1',value:{answer:'measured'},artifacts:[],diagnostics:[]})});}
// Ignore stop to prove Host escalation closes both actual processes.
});setInterval(()=>{},1000);`);
    const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
    const assets = { oarModule: 'fixture-only', nodeExecutable: process.execPath, opencodeCommand: 'fixture-only', opencodeVersion: 'fixture-only' };
    const options = { home: root, nodeExecutable: process.execPath, runnerModule: runner, assets }, runtime = new OarLocalMemberRuntime(options);
    const prepared = { schema: 'hima-oar-task/1', identity: { runId: 'run', taskId: 'task', effectId: 'effect', inputSha256: 'a'.repeat(64), packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' }, projectId: 'project', memberId: 'member', runtime: 'pi', modelRef: 'default', generation: 1, sessionKey: key, inputId: 'initial', deadlineAt: new Date(Date.now() + deadlineMs).toISOString(), prompt: 'fixture' };
    const config = { prepared, model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture', apiKey: 'private-fixture-key' }, outputSchemaVersion: 'output/1' };
    const skills = [{ path: '/hima-home/skills/example/SKILL.md', bytes: Buffer.from('fixture Skill') }], lease = await runtime.stage(config, skills);
    t.after(async () => { await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, options, runtime, lease, config, skills, OarLocalMemberRuntime };
}
test('trusted Node member retains correlated IPC, protects config, and actually closes descendants', async (t) => {
    const f = await fixture(t, 'fixture-correlated');
    const oc = await f.runtime.stage({ ...f.config, prepared: { ...f.config.prepared, sessionKey: 'fixture-oc-skills', runtime: 'opencode' } }, f.skills);
    assert.equal(fs.readFileSync(path.join(oc.controlDirectory, 'native/.config/opencode/skills/example/SKILL.md'), 'utf8'), 'fixture Skill');
    await f.runtime.start(f.lease);
    const pid = f.lease.pid;
    await until(async () => (await f.runtime.read(f.lease)).journal.includes('"created"'));
    assert.equal((fs.statSync(path.join(f.lease.controlDirectory, 'config.json')).mode & 0o777), 0o600);
    assert.equal((fs.statSync(f.lease.controlDirectory).mode & 0o777), 0o700);
    assert.equal(fs.readFileSync(path.join(f.lease.controlDirectory, 'native/pi/skills/example/SKILL.md'), 'utf8'), 'fixture Skill');
    await f.runtime.authorize(f.lease, { sessionKey: f.lease.sessionKey, generation: 1, nativeSession: 'native-fixture', inputId: 'initial' });
    await until(async () => !!(await f.runtime.read(f.lease)).result);
    const observed = await f.runtime.read(f.lease);
    assert.ok(observed.journal.includes('"received"'));
    assert.ok(observed.journal.includes('"terminal"'));
    const forged = JSON.parse(observed.result);
    forged.output.value.answer = 'forged';
    fs.writeFileSync(path.join(f.lease.controlDirectory, 'result.json'), JSON.stringify(forged));
    assert.equal((await f.runtime.read(f.lease)).result, null);
    await f.runtime.start(await f.runtime.stage(f.config, f.skills));
    assert.equal(f.lease.pid, pid);
    await assert.rejects(f.runtime.stage({ ...f.config, model: { ...f.config.model, model: 'changed' } }, f.skills), /differs/);
    await assert.rejects(f.runtime.readArtifact(f.lease, 'descendant.pid', 999999), /bounded artifact/);
    const descendant = Number(fs.readFileSync(path.join(f.lease.workDirectory, 'descendant.pid'), 'utf8'));
    const closure = await f.runtime.close(f.lease);
    assert.equal(closure.closed, true);
    assert.equal(closure.proof.absent, true);
    assert.throws(() => process.kill(pid, 0));
    assert.throws(() => process.kill(descendant, 0));
    assert.equal(fs.readdirSync(f.lease.controlDirectory).some(n => n.endsWith('.tmp')), false);
});
test('lost creation ACK recovers original lease and does not spawn or resend input', async (t) => {
    const f = await fixture(t, 'fixture-lost-ack');
    await f.runtime.start(f.lease);
    await until(async () => (await f.runtime.read(f.lease)).journal.includes('"created"'));
    const replacement = new f.OarLocalMemberRuntime(f.options), recovered = await replacement.recover(f.lease.sessionKey);
    assert.equal(recovered.pid, f.lease.pid);
    await replacement.start(recovered);
    assert.equal(recovered.pid, f.lease.pid);
    await assert.rejects(replacement.authorize(recovered, { sessionKey: recovered.sessionKey, generation: 1, nativeSession: 'native-fixture', inputId: 'initial' }), /IPC unavailable/);
    assert.equal((await replacement.read(recovered)).journal.includes('"send_intent"'), false);
    assert.equal((await f.runtime.stopAll())[0].closed, true);
});
test('IPC loss terminates actual owned group and retained PID identity mismatch never signals it', async (t) => {
    const f = await fixture(t, 'fixture-ipc-loss');
    await f.runtime.start(f.lease);
    await until(async () => (await f.runtime.read(f.lease)).journal.includes('\"created\"'));
    const leasePath = path.join(f.root, 'hima/oar-members', f.lease.sessionKey, 'lease.json');
    const retained = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    retained.startIdentity = 'wrong birth identity';
    fs.writeFileSync(leasePath, JSON.stringify(retained));
    const replacement = new f.OarLocalMemberRuntime(f.options), recovered = await replacement.recover(f.lease.sessionKey);
    const refusal = await replacement.close(recovered);
    assert.equal(refusal.closed, false);
    assert.match(refusal.reason, /identity mismatch/);
    assert.doesNotThrow(() => process.kill(f.lease.pid, 0));
    await f.runtime.authorize(f.lease, { sessionKey: f.lease.sessionKey, generation: 1, nativeSession: 'native-fixture', inputId: 'initial' });
    await until(async () => !!(await f.runtime.read(f.lease)).result);
    const descendant = Number(fs.readFileSync(path.join(f.lease.workDirectory, 'descendant.pid'), 'utf8'));
    await f.runtime.sendInput(f.lease, 'disconnect', 'disconnect fixture');
    await until(async () => JSON.parse((await f.runtime.read(f.lease)).state).phase === 'closed');
    assert.equal(JSON.parse((await f.runtime.read(f.lease)).state).fatal, true);
    assert.match(JSON.parse((await f.runtime.read(f.lease)).state).failureReason, /IPC disconnected/);
    assert.throws(() => process.kill(f.lease.pid, 0));
    assert.throws(() => process.kill(descendant, 0));
});

test('native member preserves the frozen deadline beyond a test-only four minute start age', async (t) => {
    const f = await fixture(t, 'fixture-long-deadline', 300000);
    await f.runtime.start(f.lease);
    await until(async () => (await f.runtime.read(f.lease)).journal.includes('"created"'));
    const earlier = new Date(Date.now() - 241000);
    fs.utimesSync(path.join(f.lease.controlDirectory, 'start.claim'), earlier, earlier);
    await pause(650);
    const state = JSON.parse((await f.runtime.read(f.lease)).state);
    assert.equal(state.fatal, undefined);
    assert.equal(state.phase, 'running');
    assert.equal((await f.runtime.close(f.lease)).closed, true);
});

// These hooks gate the callback of an ACTUAL OS ps child. They never invent
// rows or replace physical cleanup tables. Restore before fixture cleanup.
async function gatedProcessTable(t: any, failFirst = false) {
    const { default: childProcess } = await import('node:child_process');
    const { syncBuiltinESMExports } = await import('node:module');
    const original = childProcess.execFile;
    let calls = 0, active = 0, maxActive = 0, gateNext = true, failNext = failFirst, restored = false;
    const held: Array<() => void> = [];
    childProcess.execFile = ((file: string, args: any, options: any, callback: any) => {
        calls++; active++; maxActive = Math.max(maxActive, active);
        const gated = gateNext, failing = failNext; gateNext = false; failNext = false;
        return original(failing ? '/hima-controlled-missing-ps-executable' : file, args, options, (error: any, stdout: any, stderr: any) => {
            const deliver = () => { active--; callback(error, stdout, stderr); };
            if (gated && !restored) held.push(deliver); else deliver();
        });
    }) as typeof original;
    syncBuiltinESMExports();
    const restore = () => { restored = true; childProcess.execFile = original; syncBuiltinESMExports(); while (held.length) held.shift()!(); };
    t.after(restore);
    return { restore, gate: () => { gateNext = true; }, gateError: () => { gateNext = true; failNext = true; }, release: () => { assert.ok(held.length); held.shift()!(); },
        get waiting() { return held.length; }, get calls() { return calls; }, get maxActive() { return maxActive; } };
}
async function monitorFamily(t: any, key: string, createdBeforeFamily = true, deadlineMs = 15000) {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-monitor-family-'));
    const runner = path.join(root, 'runner.mjs'), middle = path.join(root, 'middle.mjs');
    fs.writeFileSync(middle, `import {spawn} from 'node:child_process';import fs from 'node:fs';
const work=process.argv[2];const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});child.unref();
fs.writeFileSync(work+'/grandchild.pid',String(child.pid));
const timer=setInterval(()=>{if(fs.existsSync(work+'/reparent.flag')){clearInterval(timer);process.exit(0);}},10);`);
    fs.writeFileSync(runner, `import {spawn} from 'node:child_process';import fs from 'node:fs';
let config,started=false,created=false,frozen=false;process.send({type:'ready'});
const create=()=>{created=true;process.send({type:'created',payload:{runtime:config.prepared.runtime,nativeSession:'monitor-family-native'}});};
process.on('message',m=>{if(m.type==='config'){config=m.config;if(${createdBeforeFamily})create();}});
setInterval(()=>{if(!config||frozen)return;const work=config.workDirectory;
// Acknowledge freeze only after any already-started family reaches its PID files.
// Once acknowledged this runner cannot begin a new middle/grandchild spawn.
if(fs.existsSync(work+'/freeze.flag')){if(started&&!fs.existsSync(work+'/grandchild.pid'))return;
fs.writeFileSync(work+'/freeze.ack.tmp',JSON.stringify({started,middlePid:started?Number(fs.readFileSync(work+'/middle.pid','utf8')):null,grandchildPid:started?Number(fs.readFileSync(work+'/grandchild.pid','utf8')):null}));fs.renameSync(work+'/freeze.ack.tmp',work+'/freeze.ack');frozen=true;return;}
if(!started&&fs.existsSync(work+'/create.flag')){started=true;const child=spawn(process.execPath,[${JSON.stringify(middle)},work],{stdio:'ignore'});fs.writeFileSync(work+'/middle.pid',String(child.pid));}
if(started&&!created&&fs.existsSync(work+'/grandchild.pid'))create();},10);`);
    const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
    const assets = { oarModule: 'fixture-only', nodeExecutable: process.execPath, opencodeCommand: 'fixture-only', opencodeVersion: 'fixture-only' };
    const runtime = new OarLocalMemberRuntime({ home: root, nodeExecutable: process.execPath, runnerModule: runner, assets });
    const lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1', identity: { runId:'run',taskId:'task',effectId:'effect',
        inputSha256:'a'.repeat(64),packSha256:'b'.repeat(64),irSha256:'c'.repeat(64),applicationVersion:'fixture',adapterVersion:'fixture' },
        projectId:'project',memberId:'member',runtime:'pi',modelRef:'fixture',generation:1,sessionKey:key,inputId:'initial',
        deadlineAt:new Date(Date.now()+deadlineMs).toISOString(),prompt:'fixture' },
        model:{provider:'fixture',model:'fixture',baseUrl:'http://fixture.invalid',apiKey:'fixture'},outputSchemaVersion:'output/1' }, []);
    const { execFileSync } = await import('node:child_process');
    type Birth = Readonly<{ pid: number; group: number; parent: number; birth: string; command: string }>;
    // Immutable first genuine births, independently checked against actual OS
    // parent/command rows BEFORE any reparent flag or cleanup signal.
    const inventory = new Map<number, Birth>(), identities = new Map<string, number>();
    const table = (): Birth[] => execFileSync('ps', ['-axo', 'pid=,pgid=,ppid=,lstart=,command='],
        { encoding:'utf8',maxBuffer:4*1024*1024 }).split('\n').flatMap(line=>{
        const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(.+)$/);
        return m ? [{pid:Number(m[1]),group:Number(m[2]),parent:Number(m[3]),birth:m[4]!.split(/\s+/).join(' '),command:m[5]!}] : [];
    });
    const same = (a: Birth, b: Birth) => a.pid===b.pid && a.group===b.group && a.birth===b.birth && a.command===b.command;
    const capture = (name: string, actualPid: number, commandFragment: string, parentPid?: number) => {
        if(identities.has(name)) { assert.equal(actualPid,identities.get(name),'fixture PID file changed'); return; }
        assert.ok(Number.isSafeInteger(actualPid)&&actualPid>0,'bounded actual fixture PID');
        const rows=table(), row=rows.find(r=>r.pid===actualPid);
        assert.ok(row,'first genuine fixture birth must still be observable');
        assert.ok(row.command.includes(commandFragment),'actual command belongs to this spawned fixture');
        if(parentPid!==undefined) {
            const parent=inventory.get(parentPid),liveParent=rows.find(r=>r.pid===parentPid);
            assert.ok(parent&&liveParent&&same(parent,liveParent)&&row.parent===parentPid,'actual parent birth proves family');
        } else assert.equal(row.birth,lease.startIdentity.split(/\s+/).join(' '),'leader birth matches managed lease');
        if(inventory.has(actualPid))assert.ok(same(inventory.get(actualPid)!,row),'first birth never overwritten');
        else inventory.set(actualPid,Object.freeze({...row}));
        identities.set(name,actualPid);
    };
    const captureFamily = () => {
        const middleFile=path.join(lease.workDirectory,'middle.pid'),grandchildFile=path.join(lease.workDirectory,'grandchild.pid');
        if(fs.existsSync(middleFile))capture('middle.pid',Number(fs.readFileSync(middleFile,'utf8')),middle,lease.pid);
        if(fs.existsSync(grandchildFile))capture('grandchild.pid',Number(fs.readFileSync(grandchildFile,'utf8')),
            'setInterval(()=>{},1000)',identities.get('middle.pid'));
    };
    t.after(async () => {
        const problems:string[]=[];
        const requested=fs.existsSync(path.join(lease.workDirectory,'create.flag'));
        const complete=identities.has('middle.pid')&&identities.has('grandchild.pid');
        if(requested&&!complete) {
            try {
                // A failed assertion immediately after create.flag must not let
                // close race an in-flight detached spawn outside the inventory.
                fs.writeFileSync(path.join(lease.workDirectory,'freeze.flag'),'freeze');
                const ackFile=path.join(lease.workDirectory,'freeze.ack');
                await until(async()=>fs.existsSync(ackFile));
                const ack=JSON.parse(fs.readFileSync(ackFile,'utf8'));
                assert.equal(typeof ack.started,'boolean','actual fixture freeze ACK');
                if(ack.started){captureFamily();assert.equal(ack.middlePid,identities.get('middle.pid'));
                    assert.equal(ack.grandchildPid,identities.get('grandchild.pid'));
                    assert.ok(identities.has('middle.pid')&&identities.has('grandchild.pid'),'completed spawn births captured before close');}
                else {assert.equal(ack.middlePid,null);assert.equal(ack.grandchildPid,null);
                    assert.equal(fs.existsSync(path.join(lease.workDirectory,'middle.pid')),false);
                    assert.equal(fs.existsSync(path.join(lease.workDirectory,'grandchild.pid')),false);}
            }catch(error){problems.push('Fixture spawning freeze/inventory UNKNOWN: '+String(error));}
        }
        try{captureFamily();}catch(error){problems.push('Uncaptured family identity: '+String(error));}
        try{const closures=await runtime.stopAll();if(closures.some((c:any)=>!c.closed))problems.push('Runtime closure remains unconfirmed');}
        catch(error){problems.push('Runtime cleanup failed: '+String(error));}
        // Never signal from numeric .pid files. Each fallback signal rechecks the
        // immutable genuine birth AND command against a fresh actual OS table.
        for(const original of inventory.values()) {
            try {
                const current=table().find(r=>r.pid===original.pid);
                if(!current)continue;
                if(!same(original,current)){problems.push('PID identity changed; no signal sent: '+original.pid);continue;}
                try{process.kill(original.pid,'SIGKILL');}
                catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
                await until(async()=>!table().some(r=>same(original,r)));
            }catch(error){problems.push('Identity-checked cleanup unconfirmed for '+original.pid+': '+String(error));}
        }
        if(problems.length){fs.writeFileSync(path.join(root,'cleanup-unknown.json'),JSON.stringify({inventory:[...inventory.values()],problems},null,2));
            t.diagnostic('Fixture cleanup UNKNOWN; evidence retained at '+root);throw Error(problems.join('; '));}
        fs.rmSync(root,{recursive:true,force:true});
    });
    const owned = () => { captureFamily(); return JSON.parse(fs.readFileSync(path.join(lease.controlDirectory,'owned-pids.json'),'utf8')); };
    const flag = (name: string) => { if(name==='reparent.flag')captureFamily();fs.writeFileSync(path.join(lease.workDirectory,name),'go'); };
    const pid = (name: string) => { captureFamily(); assert.ok(identities.has(name),'fixture birth inventory available');return identities.get(name)!; };
    await runtime.start(lease);
    capture('leader',lease.pid,runner);
    return { runtime, lease, owned, flag, pid };
}
function retainedMonitorBytes(lease: any) {
    return ['owned-pids.json','state.json','journal.jsonl'].map(name => fs.readFileSync(path.join(lease.controlDirectory,name)).toString('base64'));
}
test('recurring monitor discovers an actual post-created detached grandchild and closes it after reparenting', { timeout:10000 }, async t => {
    const f = await monitorFamily(t,'monitor-post-created');
    await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
    f.flag('create.flag');
    await until(async()=>fs.existsSync(path.join(f.lease.workDirectory,'grandchild.pid')));
    const grandchild=f.pid('grandchild.pid'), middle=f.pid('middle.pid');
    await until(async()=>f.owned().some((r:any)=>r.pid===grandchild));
    assert.ok(f.owned().some((r:any)=>r.pid===middle));
    f.flag('reparent.flag');
    await until(async()=>{try{process.kill(middle,0);return false;}catch{return true;}});
    assert.doesNotThrow(()=>process.kill(grandchild,0));
    const closure=await f.runtime.close(f.lease);
    assert.equal(closure.closed,true);assert.ok(closure.proof.pids.includes(grandchild));
    assert.throws(()=>process.kill(grandchild,0));assert.throws(()=>process.kill(f.lease.pid,0));
    assert.ok(f.owned().some((r:any)=>r.pid===grandchild),'first-known identity remains retained');
});
test('actual delayed ps cannot overlap ticks or regress a newer created snapshot; close freezes late callbacks', { timeout:12000 }, async t => {
    const f=await monitorFamily(t,'monitor-created-race',false);
    const gate=await gatedProcessTable(t);
    await until(async()=>gate.waiting===1);
    let ticks=0;const timer=setInterval(()=>ticks++,20);
    try{await pause(1100);}finally{clearInterval(timer);}
    assert.equal(gate.calls,1,'500ms ticks do not queue ps while callback is held');assert.equal(gate.maxActive,1);
    assert.ok(ticks>=30,'Host timers service an actual ps callback wait');
    f.flag('create.flag');
    await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
    const grandchild=f.pid('grandchild.pid');assert.ok(f.owned().some((r:any)=>r.pid===grandchild));
    const createdOwned=fs.readFileSync(path.join(f.lease.controlDirectory,'owned-pids.json'),'utf8');
    gate.release();await new Promise<void>(r=>setImmediate(r));
    assert.equal(fs.readFileSync(path.join(f.lease.controlDirectory,'owned-pids.json'),'utf8'),createdOwned,'stale rows cannot publish over created');
    gate.gate();await until(async()=>gate.waiting===1);
    f.flag('reparent.flag');
    await until(async()=>{try{process.kill(f.pid('middle.pid'),0);return false;}catch{return true;}});
    const closure=await f.runtime.close(f.lease);
    assert.equal(closure.closed,true);assert.ok(closure.proof.pids.includes(grandchild));assert.throws(()=>process.kill(grandchild,0));
    const bytes=retainedMonitorBytes(f.lease),calls=gate.calls;
    gate.release();await pause(650);
    assert.deepEqual(retainedMonitorBytes(f.lease),bytes,'late actual callback cannot mutate closed ownership/state/journal');
    assert.equal(gate.calls,calls,'closed timer cannot start another ps');gate.restore();
});
test('stopAll freezes an actual in-flight process-table callback without waiting for its delivery', { timeout:10000 }, async t=>{
    const f=await monitorFamily(t,'monitor-stopall-race');
    await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
    const gate=await gatedProcessTable(t);await until(async()=>gate.waiting===1);
    assert.equal((await f.runtime.stopAll())[0].closed,true);assert.throws(()=>process.kill(f.lease.pid,0));
    const bytes=retainedMonitorBytes(f.lease),calls=gate.calls;gate.release();await pause(650);
    assert.deepEqual(retainedMonitorBytes(f.lease),bytes);assert.equal(gate.calls,calls);gate.restore();
});
test('retained deadline still closes actual ownership while a ps callback spans many ticks', { timeout:10000 }, async t=>{
    const f=await monitorFamily(t,'monitor-busy-deadline',true,2000);
    await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
    const gate=await gatedProcessTable(t);await until(async()=>gate.waiting===1);
    await until(async()=>JSON.parse((await f.runtime.read(f.lease)).state).fatal===true);
    const closure=await f.runtime.close(f.lease);assert.equal(closure.closed,true);
    assert.throws(()=>process.kill(f.lease.pid,0));
    assert.match(JSON.parse((await f.runtime.read(f.lease)).state).failureReason,/resource\/deadline/);
    const bytes=retainedMonitorBytes(f.lease);gate.release();await pause(50);
    assert.deepEqual(retainedMonitorBytes(f.lease),bytes);gate.restore();
});
test('actual async ps acquisition error is visible and physically closes the original family', { timeout:10000 }, async t=>{
    const f=await monitorFamily(t,'monitor-ps-error');
    await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
    const {default:childProcess}=await import('node:child_process');const {syncBuiltinESMExports}=await import('node:module');
    const original=childProcess.execFile;
    childProcess.execFile=((file:any,args:any,options:any,callback:any)=>original(path.join(f.lease.workDirectory,'missing-ps-executable'),args,options,callback)) as typeof original;
    syncBuiltinESMExports();const restore=()=>{childProcess.execFile=original;syncBuiltinESMExports();};t.after(restore);
    await until(async()=>JSON.parse((await f.runtime.read(f.lease)).state).fatal===true);
    const closure=await f.runtime.close(f.lease);assert.equal(closure.closed,true);assert.throws(()=>process.kill(f.lease.pid,0));
    assert.equal(JSON.parse((await f.runtime.read(f.lease)).state).failureReason,'Member process observations unavailable');restore();
});
test('known detached descendant wrong birth refuses signaling its actual live PID', { timeout:10000 }, async t=>{
    const f=await fixture(t,'monitor-descendant-birth');await f.runtime.start(f.lease);
    await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
    const target=Number(fs.readFileSync(path.join(f.lease.workDirectory,'descendant.pid'),'utf8'));
    const ownedFile=path.join(f.lease.controlDirectory,'owned-pids.json');
    const owned=JSON.parse(fs.readFileSync(ownedFile,'utf8'));owned.find((row:any)=>row.pid===target).birth='wrong descendant birth';
    fs.writeFileSync(ownedFile,JSON.stringify(owned));
    const replacement=new f.OarLocalMemberRuntime(f.options),recovered=await replacement.recover(f.lease.sessionKey);
    const refused=await replacement.close(recovered);assert.equal(refused.closed,false);assert.match(refused.reason,/Descendant PID identity mismatch/);
    assert.doesNotThrow(()=>process.kill(target,0));assert.doesNotThrow(()=>process.kill(f.lease.pid,0));
    assert.equal((await f.runtime.close(f.lease)).closed,true);assert.throws(()=>process.kill(target,0));
});

test('an actual ps error delivered after newer created or closed facts cannot become failure authority', { timeout:10000 }, async t=>{
    const f=await monitorFamily(t,'monitor-stale-error',false);
    const gate=await gatedProcessTable(t,true);await until(async()=>gate.waiting===1);
    f.flag('create.flag');await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
    f.owned(); // Capture genuine family births before either callback release or close.
    const owned=fs.readFileSync(path.join(f.lease.controlDirectory,'owned-pids.json'),'utf8');
    gate.release();await new Promise<void>(r=>setImmediate(r));
    assert.equal(JSON.parse((await f.runtime.read(f.lease)).state).fatal,undefined);
    assert.equal(fs.readFileSync(path.join(f.lease.controlDirectory,'owned-pids.json'),'utf8'),owned);
    gate.gateError();await until(async()=>gate.waiting===1);
    assert.equal((await f.runtime.close(f.lease)).closed,true);
    const bytes=retainedMonitorBytes(f.lease);gate.release();await pause(50);
    assert.deepEqual(retainedMonitorBytes(f.lease),bytes);gate.restore();
});


// Local admission tests supply an explicit Host-approved identity at this seam;
// real accepted-wait Store/PG authority is qualified in himateam-handoff.host.test.
async function readyAcceptedFixture(t:any,key:string,mode:'held'|'late'|'yield-abort'='held',deadlineMs=20000){
 const f=await fixture(t,key,deadlineMs,mode);await f.runtime.start(f.lease);
 await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
 await f.runtime.authorize(f.lease,{sessionKey:key,generation:1,nativeSession:'native-fixture',inputId:'initial'});
 if(mode!=='late')await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"received"'));
 const created=JSON.parse((await f.runtime.read(f.lease)).journal.trim().split('\n').find((line:string)=>JSON.parse(line).kind==='created')!);
 const admission={origin:{identity:f.config.prepared.identity,sessionKey:key,generation:1,memberId:'member',runtime:'pi' as const,nativeSession:'native-fixture',cwd:f.lease.workDirectory},
  streamGeneration:created.streamGeneration,inputId:'initial',requestId:'accepted-local-wait'};
 return {...f,admission,flag:(name:string)=>fs.writeFileSync(path.join(f.lease.workDirectory,name),'actual-node-ingress')};
}

test('accepted local wait retains genuine late original receipt exactly once and native completion evidence without result',async t=>{
 const f=await readyAcceptedFixture(t,'accepted-late-receipt','late');
 await assert.rejects(f.runtime.admitAcceptedWait(f.lease,{...f.admission,streamGeneration:'wrong-stream'}),/identity/);
 await assert.rejects(f.runtime.admitAcceptedWait({...f.lease,generation:2},f.admission),/lease/);
 await assert.rejects(f.runtime.admitAcceptedWait(f.lease,{...f.admission,inputId:'wrong-current-input'}),/active native input/);
 await assert.rejects(f.runtime.admitAcceptedWait(f.lease,{...f.admission,origin:{...f.admission.origin,identity:{...f.admission.origin.identity,effectId:'wrong-parent'}}}),/identity/);
 await f.runtime.admitAcceptedWait(f.lease,f.admission);
 await f.runtime.admitAcceptedWait(f.lease,f.admission);
 await assert.rejects(f.runtime.admitAcceptedWait(f.lease,{...f.admission,requestId:'reused-wait'}),/identity reused/);
 await assert.rejects(f.runtime.sendInput(f.lease,'new-engineering','cannot proceed'),/stopping/);
 let view=await f.runtime.read(f.lease);assert.equal(view.journal.includes('"kind":"received"'),false,'admission fabricates no receive ACK');
 f.flag('finish.flag');
 await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"finished"'));
 f.flag('received.flag');
 await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"received"'));
 view=await f.runtime.read(f.lease);assert.equal(view.result,null);assert.equal(JSON.parse(view.state).fatal,undefined);
 const rows=view.journal.trim().split('\n').map((line:string)=>JSON.parse(line));
 assert.equal(rows.filter((row:Record<string,any>)=>row.kind==='received').length,1);
 assert.equal(rows.filter((row:Record<string,any>)=>row.kind==='control'&&row.payload.action==='yield_intent').length,1);
 assert.equal(rows.find((row:Record<string,any>)=>row.kind==='raw').payload.text,'exact native raw');
 assert.equal(rows.find((row:Record<string,any>)=>row.kind==='event').payload.text,'exact native event');
 rows.forEach((row:Record<string,any>)=>{assert.equal(row.streamGeneration,f.admission.streamGeneration);assert.equal(row.nativeSession, row.kind==='control'&&!row.nativeSession?undefined:'native-fixture');});
 const closure=await f.runtime.close(f.lease,{yieldRequestId:f.admission.requestId});assert.equal(closure.closed,true);assert.throws(()=>process.kill(f.lease.pid,0));
 const before=(await f.runtime.read(f.lease)).journal;
 const recovered=new f.OarLocalMemberRuntime(f.options);await recovered.recover(f.lease.sessionKey);
 assert.equal((await recovered.read(f.lease)).journal,before,'cold read retains durable original yield and receipt without restart');
 await assert.rejects(recovered.start(f.lease),/yielded|recover|IPC/);
});

test('unadmitted malformed original still fails and ordinary stop cannot become accepted local wait',async t=>{
 const f=await fixture(t,'ordinary-invalid',20000,'invalid');await f.runtime.start(f.lease);
 await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"created"'));
 await f.runtime.authorize(f.lease,{sessionKey:f.lease.sessionKey,generation:1,nativeSession:'native-fixture',inputId:'initial'});
 await until(async()=> (await f.runtime.read(f.lease)).journal.includes('Invalid initial delivery JSON'));
 const closed=await f.runtime.close(f.lease);assert.equal(closed.closed,true);
 await assert.rejects(f.runtime.close(f.lease,{yieldRequestId:'too-late'}),/Ordinary close/);
 const recovered=new f.OarLocalMemberRuntime(f.options);await recovered.recover(f.lease.sessionKey);
 await assert.rejects(recovered.close(f.lease,{yieldRequestId:'too-late'}),/Ordinary close/);
});

test('accepted wait keeps original deadline enforced until real physical stop begins',{timeout:10000},async t=>{
 const f=await readyAcceptedFixture(t,'accepted-deadline','held',2000);
 await f.runtime.admitAcceptedWait(f.lease,f.admission);
 await until(async()=>JSON.parse((await f.runtime.read(f.lease)).state).fatal===true);
 const view=await f.runtime.read(f.lease);assert.match(JSON.parse(view.state).failureReason,/resource\/deadline/);
 assert.equal(view.result,null);const closed=await f.runtime.close(f.lease);assert.equal(closed.closed,true);assert.throws(()=>process.kill(f.lease.pid,0));
});

test('actual native fault after wait admission remains fatal before physical cleanup',async t=>{
 const f=await readyAcceptedFixture(t,'accepted-native-fault');await f.runtime.admitAcceptedWait(f.lease,f.admission);
 f.flag('failure.flag');await until(async()=>JSON.parse((await f.runtime.read(f.lease)).state).fatal===true);
 const view=await f.runtime.read(f.lease);assert.match(JSON.parse(view.state).failureReason,/Actual pre-cleanup native failure/);
 assert.equal(view.result,null);const closure=await f.runtime.close(f.lease);assert.equal(closure.closed,true);assert.throws(()=>process.kill(f.lease.pid,0));
});


test('failure winning actual yield journal fsync denies atomic successful reply publication',{timeout:10000},async t=>{
 const originalOpen=fs.promises.open;let held=false,release!:()=>void,reached!:()=>void;
 const gate=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{reached=r;});
 fs.promises.open=(async(...args:Parameters<typeof fs.promises.open>)=>{
  const fd=await originalOpen(...args);if(String(args[0]).endsWith('journal.jsonl')){
   const sync=fd.sync.bind(fd);fd.sync=async()=>{if(held){reached();await gate;}await sync();};
  }return fd;
 }) as typeof fs.promises.open;
 t.after(()=>{held=false;release();fs.promises.open=originalOpen;});
 const f=await readyAcceptedFixture(t,'accepted-sync-fault');held=true;
 const admitted=f.runtime.admitAcceptedWait(f.lease,f.admission);
 // Attach rejection handlers immediately: the product must deny both operations.
 const admissionResult=admitted.then(()=>({ok:true}),(error:unknown)=>({ok:false,error}));
 const replyId='a1111111-1111-4111-8111-111111111111';
 const published=f.runtime.reply(f.lease,replyId,JSON.stringify({ok:true,value:{state:'yield-accepted',waitId:'explicit-local-test-authority'}}));
 const replyResult=published.then(()=>({ok:true}),(error:unknown)=>({ok:false,error}));
 await entered;assert.equal(fs.existsSync(path.join(f.lease.controlDirectory,'replies',replyId+'.json')),false);
 f.flag('failure.flag');
 await until(async()=>JSON.parse(fs.readFileSync(path.join(f.lease.controlDirectory,'state.json'),'utf8')).fatal===true);
 held=false;release();
 assert.equal((await admissionResult).ok,false);assert.equal((await replyResult).ok,false);
 assert.equal(fs.existsSync(path.join(f.lease.controlDirectory,'replies',replyId+'.json')),false,'no success reply after native fault won durability window');
 assert.equal((await f.runtime.read(f.lease)).result,null);
 const closed=await f.runtime.close(f.lease);assert.equal(closed.closed,true);assert.throws(()=>process.kill(f.lease.pid,0));
 fs.promises.open=originalOpen;
});


test('actual yield-intent journal durability failure publishes no successful reply and retains unknown closure',{timeout:10000},async t=>{
 const originalOpen=fs.promises.open;let broken=false;
 fs.promises.open=(async(...args:Parameters<typeof fs.promises.open>)=>{
  const fd=await originalOpen(...args);if(String(args[0]).endsWith('journal.jsonl')){
   const sync=fd.sync.bind(fd);fd.sync=async()=>{if(broken)throw Error('Controlled accepted-wait journal sync failure');await sync();};
  }return fd;
 }) as typeof fs.promises.open;
 t.after(()=>{broken=false;fs.promises.open=originalOpen;});
 const f=await readyAcceptedFixture(t,'accepted-durability-fault');broken=true;
 await assert.rejects(f.runtime.admitAcceptedWait(f.lease,f.admission),/retention|durability|observation/);
 const replyId='b1111111-1111-4111-8111-111111111111';
 await assert.rejects(f.runtime.reply(f.lease,replyId,JSON.stringify({ok:true,value:{state:'yield-accepted'}})),/retention|durability|observation|Failed/);
 assert.equal(fs.existsSync(path.join(f.lease.controlDirectory,'replies',replyId+'.json')),false);
 const closure=await f.runtime.close(f.lease);assert.equal(closure.closed,false);assert.throws(()=>process.kill(f.lease.pid,0));
 await assert.rejects(f.runtime.read(f.lease),/retention|durability|observation/);
 await assert.rejects(f.runtime.captureClosedContext(f.lease,f.admission.requestId,{maxFiles:8,maxBytes:4096,maxFileBytes:2048}),/retention|durability|observation|closure/);
 broken=false;fs.promises.open=originalOpen;
});

for(const publication of ['before-reply','after-reply'] as const)test('cold durable accepted-wait replay keeps exact identity and never restarts: '+publication,async t=>{
 const f=await readyAcceptedFixture(t,'accepted-recover-'+publication);await f.runtime.admitAcceptedWait(f.lease,f.admission);
 const replyId='c1111111-1111-4111-8111-111111111111';
 if(publication==='after-reply')await f.runtime.reply(f.lease,replyId,JSON.stringify({ok:true,value:{state:'yield-accepted'}}));
 const before=(await f.runtime.read(f.lease)).journal;
 const recovered=new f.OarLocalMemberRuntime(f.options);assert.deepEqual(await recovered.recover(f.lease.sessionKey),f.lease);
 await recovered.admitAcceptedWait(f.lease,f.admission);
 await assert.rejects(recovered.admitAcceptedWait(f.lease,{...f.admission,inputId:'wrong-original-input'}),/identity reused/);
 await assert.rejects(recovered.start(f.lease),/yielded|recovery|IPC/);
 const view=await recovered.read(f.lease);assert.equal(view.journal,before);assert.equal(view.result,null);
 assert.equal(view.journal.trim().split('\n').map((line:string)=>JSON.parse(line)).filter((row:Record<string,any>)=>row.kind==='received').length,1,'only original actual receipt retained');
 assert.equal(fs.existsSync(path.join(f.lease.controlDirectory,'replies',replyId+'.json')),publication==='after-reply');
 const closed=await f.runtime.close(f.lease,{yieldRequestId:f.admission.requestId});assert.equal(closed.closed,true);
});

test('cold recovery before Local durable admission cannot guess active input or publish yield',async t=>{
 const f=await readyAcceptedFixture(t,'accepted-recover-before-intent');
 const recovered=new f.OarLocalMemberRuntime(f.options);await recovered.recover(f.lease.sessionKey);
 await assert.rejects(recovered.admitAcceptedWait(f.lease,f.admission),/original active native input/);
 assert.equal((await recovered.read(f.lease)).journal.includes('yield_intent'),false);
 const closed=await f.runtime.close(f.lease);assert.equal(closed.closed,true);
});


// Independent high review F1: engineering delivery already exists while a
// subsequent ordinary input is active. That later turn cannot reclassify it.
async function deliveredActiveFixture(t:any,key:string){
 const f=await fixture(t,key,20000,'delivered-active');await f.runtime.start(f.lease);
 await until(async()=> (await f.runtime.read(f.lease)).journal.includes('"kind":"created"'));
 await f.runtime.authorize(f.lease,{sessionKey:key,generation:1,nativeSession:'native-fixture',inputId:'initial'});
 await until(async()=>!!(await f.runtime.read(f.lease)).result);
 const delivery=JSON.parse((await f.runtime.read(f.lease)).result);assert.deepEqual(delivery.output.value,{answer:'measured'});
 await f.runtime.sendInput(f.lease,'post-delivery-active','ordinary directed native input after engineering delivery');
 await until(async()=> (await f.runtime.read(f.lease)).journal.trim().split('\n').map((line:string)=>JSON.parse(line)).some((row:Record<string,any>)=>row.kind==='received'&&row.payload.inputId==='post-delivery-active'));
 const view=await f.runtime.read(f.lease),created=view.journal.trim().split('\n').map((line:string)=>JSON.parse(line)).find((row:Record<string,any>)=>row.kind==='created');
 const admission={origin:{identity:f.config.prepared.identity,sessionKey:key,generation:1,memberId:'member',runtime:'pi' as const,nativeSession:'native-fixture',cwd:f.lease.workDirectory},
  streamGeneration:created.streamGeneration,inputId:'post-delivery-active',requestId:'cannot-yield-published-engineering'};
 return {...f,admission,delivery};
}

for(const boundary of ['admission','direct-close'] as const)test('published engineering delivery refuses yield with a later active native input: '+boundary,async t=>{
 const f=await deliveredActiveFixture(t,'published-delivery-'+boundary);
 if(boundary==='admission')await assert.rejects(f.runtime.admitAcceptedWait(f.lease,f.admission),/published|delivered|delivery|completed/i);
 else await assert.rejects(f.runtime.close(f.lease,{yieldRequestId:f.admission.requestId}),/published|delivered|delivery|completed/i);
 assert.doesNotThrow(()=>process.kill(f.lease.pid,0),'refusal does not begin physical yield');
 const view=await f.runtime.read(f.lease);assert.deepEqual(JSON.parse(view.result),f.delivery);
 assert.equal(view.journal.includes('yield_intent'),false,'published delivery cannot acquire a later admitted yield identity');
 assert.equal(view.journal.trim().split('\n').map((line:string)=>JSON.parse(line)).filter((row:Record<string,any>)=>row.kind==='received'&&row.payload.inputId==='post-delivery-active').length,1);
});

// Independent high review F2: a true shutdown abort after durable yield intent
// is not an earlier failure. Two recoveries reconcile the original physical lease.
test('genuine physical yield abort survives recovered close and a second exact recovery',{timeout:15000},async t=>{
 const f=await readyAcceptedFixture(t,'physical-yield-abort-recovery','yield-abort');
 await f.runtime.admitAcceptedWait(f.lease,f.admission);
 const firstClose=await f.runtime.close(f.lease,{yieldRequestId:f.admission.requestId});assert.equal(firstClose.closed,true);assert.equal(firstClose.proof.absent,true);
 assert.throws(()=>process.kill(f.lease.pid,0),'original is physically absent before recovery');
 const initialView=await f.runtime.read(f.lease),initialRows=initialView.journal.trim().split('\n').map((line:string)=>JSON.parse(line));
 const abort=initialRows.find((row:Record<string,any>)=>row.kind==='terminal'&&row.payload.outcome?.kind==='interrupted');assert.ok(abort,'actual Node acknowledged physical yield by sending shutdown terminal');
 const intent=initialRows.find((row:Record<string,any>)=>row.kind==='control'&&row.payload.action==='yield_intent');assert.ok(intent);assert.ok(intent.seq<abort.seq);
 assert.equal(JSON.parse(initialView.state).fatal,undefined,'physical yield abort is not a pre-stop native fault');
 const firstRecovery=new f.OarLocalMemberRuntime(f.options);assert.deepEqual(await firstRecovery.recover(f.lease.sessionKey),f.lease);
 const secondClose=await firstRecovery.close(f.lease,{yieldRequestId:f.admission.requestId});assert.equal(secondClose.closed,true);assert.equal(secondClose.proof.absent,true);
 const roundtripView=await firstRecovery.read(f.lease);
 const secondRecovery=new f.OarLocalMemberRuntime(f.options);assert.deepEqual(await secondRecovery.recover(f.lease.sessionKey),f.lease,'same durable admission remains recoverable after cleanup replay');
 const finalView=await secondRecovery.read(f.lease);assert.equal(finalView.journal,roundtripView.journal);assert.equal(finalView.result,null);
 assert.equal(JSON.parse(finalView.state).fatal,undefined);
 const rows=finalView.journal.trim().split('\n').map((line:string)=>JSON.parse(line));
 assert.equal(rows.filter((row:Record<string,any>)=>row.kind==='created').length,1,'no re-spawn/native identity invention');
 assert.equal(rows.filter((row:Record<string,any>)=>row.kind==='received').length,1,'only original actual receive retained');
 for(const row of rows.filter((row:Record<string,any>)=>row.kind==='control'&&row.payload.action==='yield_intent'))assert.equal(row.payload.requestId,f.admission.requestId);
 await assert.rejects(secondRecovery.start(f.lease),/yielded|recover|IPC/);
});

test('true pre-admission native failure remains ineligible for both wait admission and direct yield',async t=>{
 const f=await readyAcceptedFixture(t,'true-failure-before-admission');f.flag('failure.flag');
 await until(async()=>JSON.parse((await f.runtime.read(f.lease)).state).fatal===true);
 await assert.rejects(f.runtime.admitAcceptedWait(f.lease,f.admission),/failed|ordinary/i);
 await assert.rejects(f.runtime.close(f.lease,{yieldRequestId:f.admission.requestId}),/Ordinary close/);
 const view=await f.runtime.read(f.lease);assert.equal(view.journal.includes('yield_intent'),false);assert.equal(view.result,null);
 const closed=await f.runtime.close(f.lease);assert.equal(closed.closed,true);assert.throws(()=>process.kill(f.lease.pid,0));
 const recovered=new f.OarLocalMemberRuntime(f.options);assert.deepEqual(await recovered.recover(f.lease.sessionKey),f.lease);
 await assert.rejects(recovered.admitAcceptedWait(f.lease,f.admission),/failed|ordinary/i);
});
