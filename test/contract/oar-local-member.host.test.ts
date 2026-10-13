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
async function fixture(t: any, key: string, deadlineMs = 20000) {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'hima-local-member-')), runner = path.join(root, 'runner.mjs');
    fs.writeFileSync(runner, `import {spawn} from 'node:child_process'; import fs from 'node:fs';
let config,descendant; process.send({type:'ready'});
process.on('message',m=>{ if(m.type==='config'){config=m.config;descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});fs.writeFileSync(config.workDirectory+'/descendant.pid',String(descendant.pid));process.send({type:'created',payload:{runtime:config.prepared.runtime,nativeSession:'native-fixture'}});}
if(m.type==='input'&&m.id==='disconnect'){process.disconnect();return;}
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
