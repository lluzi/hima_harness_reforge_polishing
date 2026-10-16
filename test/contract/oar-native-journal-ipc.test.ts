// L2 real Node IPC and managed process fixture, zero SDK/product model/PG.
// Run only with Root-admitted fresh lib. Numeric responsiveness + exact durability
// assertions exercise the public APIs and actual child.on('message') ingress.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const observations = 3482;
const snapshotText = (index: number) => String(index).padStart(5, '0') + 'x'.repeat(64000);
const reasoningText = (index: number) => `reasoning-${index}:` + 'r'.repeat(800);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

test('actual IPC persists a compressible-but-large raw burst when sync is slower than individual frames', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-journal-batch-'));
  const runner = path.join(root, 'runner.mjs'), originalOpen = fs.promises.open;
  const count = 800;
  fs.writeFileSync(runner, `
import { randomBytes } from 'node:crypto';
process.send({type:'ready'});
process.on('message', message => {
  if (message.type === 'config') process.send({type:'created',payload:{runtime:'pi',nativeSession:'batch-native'}});
  if (message.type !== 'input') return;
  process.send({type:'received',payload:{inputId:message.id}});
  let n=0;
  const timer=setInterval(() => {
    process.send({type:'raw',payload:{index:n,kind:'frame',body:{text:randomBytes(24000).toString('base64')}}});
    if (++n === ${count}) {clearInterval(timer);
      process.send({type:'terminal',payload:{inputId:message.id,outcome:{kind:'completed'}}});
      process.send({type:'finished',inputId:message.id,text:JSON.stringify({schemaVersion:'output/1',value:{count:n},artifacts:[],diagnostics:[]})});
    }
  },1);
});

setInterval(()=>{},1000);
`);
  // The real FileHandle still writes and fsyncs; only latency is controlled so
  // the burst deterministically distinguishes 256 KiB from amortized batches.
  fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
    const fd = await originalOpen(...args);
    if (String(args[0]).endsWith('journal.jsonl')) {
      const sync = fd.sync.bind(fd);
      fd.sync = async () => { await pause(20); await sync(); };
    }
    return fd;
  }) as typeof fs.promises.open;
  const { OarLocalMemberRuntime, decodeOarRawObservationPayload } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const runtime = new OarLocalMemberRuntime({ home: root, nodeExecutable: process.execPath, runnerModule: runner,
    assets: { oarModule: 'controlled-node-fixture', nodeExecutable: process.execPath,
      opencodeCommand: 'fixture', opencodeVersion: 'fixture' } });
  t.after(async () => { fs.promises.open = originalOpen; await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1',
    identity: { runId: 'burst-run', taskId: 'burst-task', effectId: 'burst-effect', inputSha256: 'a'.repeat(64),
      packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' },
    projectId: 'project', memberId: 'member', runtime: 'pi', modelRef: 'fixture', generation: 1,
    sessionKey: 'controlled-ipc-burst', inputId: 'initial', deadlineAt: new Date(Date.now() + 25000).toISOString(), prompt: 'burst' },
    model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' }, outputSchemaVersion: 'output/1' }, []);
  await runtime.start(lease);
  const deadline = Date.now() + 20000;
  let created = false;
  while (Date.now() < deadline) {
    if ((await runtime.read(lease, { summaryOnly: true })).evidence.some((row: any) => row.kind === 'created')) { created = true; break; }
    await pause(20);
  }
  assert.ok(created);
  await runtime.authorize(lease, { sessionKey: lease.sessionKey, generation: lease.generation,
    nativeSession: 'batch-native', inputId: 'initial' });
  let delivered: any;
  while (Date.now() < deadline) {
    delivered = await runtime.read(lease, { summaryOnly: true });
    if (delivered.result) break;
    await pause(50);
  }
  assert.ok(delivered?.result, 'every burst observation must be durable before terminal result');
  assert.equal(JSON.parse(delivered.result).output.value.count, count);
  assert.equal((await runtime.close(lease)).closed, true);
  const journal = fs.readFileSync(path.join(lease.controlDirectory, 'journal.jsonl'), 'utf8');
  const rows = journal.trim().split('\n').map(line => JSON.parse(line));
  const raw = rows.filter((row: any) => row.kind === 'raw');
  assert.equal(raw.length, count);
  rows.forEach((row: any, index: number) => assert.equal(row.seq, index));
  raw.forEach((row: any, index: number) => {
    const payload = decodeOarRawObservationPayload(row.payload) as any;
    assert.equal(payload.index, index);
    assert.equal(Buffer.from(payload.body.text, 'base64').byteLength, 24000);
  });
});

test('SDK raw producer waits for Host durable ACK while small text deltas continue', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-sdk-raw-credit-'));
  const sdk = path.join(root, 'fake-oar.mjs'), originalOpen = fs.promises.open, count = 600;
  fs.writeFileSync(sdk, `
import { randomBytes } from 'node:crypto';
export async function piSession(){
  const raw=[],rawObservers=[],eventObservers=[];let timer;
  const emit=(body,event)=>{const record={sessionId:'credit-native',agentPath:[],seq:raw.length,receivedAt:Date.now(),kind:'frame',body};
    raw.push(record);for(const observer of rawObservers)observer(record);
    if(event)for(const observer of eventObservers)observer({...event,sessionId:'credit-native',agentPath:[],seq:record.seq,receivedAt:record.receivedAt});};
  return {id:'credit-native',records:()=>raw,rawEvents:(observer)=>{rawObservers.push(observer);return()=>{}},
    events:(observer)=>{eventObservers.push(observer);return()=>{}},
    async prompt(){let n=0;timer=setInterval(()=>{
      emit({type:'message_update',text:randomBytes(24000).toString('base64')},{kind:'text_delta',text:'x'});
      if(++n===${count}){clearInterval(timer);
        emit({type:'tool_call_started'},{kind:'tool_call_started',tool:'fixture'});
        emit({type:'message_update'}, {kind:'text_delta',text:JSON.stringify({schemaVersion:'output/1',value:{count:n},artifacts:[],diagnostics:[]})});
        emit({type:'turn_ended'}, {kind:'turn_ended',outcome:{kind:'completed'}});
      }
    },1);return{kind:'accepted'};},async abort(){clearInterval(timer);return{kind:'accepted'}},async dispose(){clearInterval(timer)}};
}
`);
  fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
    const fd = await originalOpen(...args);
    if (String(args[0]).endsWith('journal.jsonl')) { const sync = fd.sync.bind(fd);
      fd.sync = async () => { await pause(20); await sync(); }; }
    return fd;
  }) as typeof fs.promises.open;
  const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets = { oarModule: sdk, nodeExecutable: process.execPath, opencodeCommand: '/usr/bin/false', opencodeVersion: 'fixture' };
  const options = { home: root, nodeExecutable: process.execPath,
    runnerModule: path.resolve('packages/harness/lib/oar-member-runner.js'), assets };
  const runtime = new OarLocalMemberRuntime(options);
  t.after(async () => { fs.promises.open = originalOpen; await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1',
    identity: { runId: 'credit-run', taskId: 'credit-task', effectId: 'credit-effect', inputSha256: 'a'.repeat(64),
      packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' },
    projectId: 'project', memberId: 'member', runtime: 'pi', modelRef: 'fixture', generation: 1,
    sessionKey: 'credit-member', inputId: 'initial', deadlineAt: new Date(Date.now() + 25000).toISOString(), prompt: 'credit' },
    model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' },
    outputSchemaVersion: 'output/1', assets }, []);
  await runtime.start(lease);
  const deadline = Date.now() + 20000;
  let created = false;
  while (Date.now() < deadline) {
    if ((await runtime.read(lease, { summaryOnly: true })).evidence.some((row: any) => row.kind === 'created')) { created = true; break; }
    await pause(20);
  }
  assert.ok(created);
  await runtime.authorize(lease, { sessionKey: lease.sessionKey, generation: lease.generation,
    nativeSession: 'credit-native', inputId: 'initial' });
  let result: any;
  while (Date.now() < deadline) {
    result = await runtime.read(lease, { summaryOnly: true });
    if (result.result) break;
    await pause(50);
  }
  assert.ok(result?.result, 'native result waits for all original raw frames to reach Host durability');
  assert.equal(JSON.parse(result.result).output.value.count, count);
  assert.equal((await runtime.close(lease)).closed, true);
  const rows = fs.readFileSync(path.join(lease.controlDirectory, 'journal.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.filter((row: any) => row.kind === 'raw').length, count + 3);
  assert.ok(rows.findIndex((row: any) => row.kind === 'terminal') > rows.findLastIndex((row: any) => row.kind === 'raw'));
  const recovered = new OarLocalMemberRuntime(options);
  assert.deepEqual(await recovered.recover(lease.sessionKey), lease);
  assert.equal((await recovered.close(lease)).closed, true, 'A durable final cursor survives a fresh runtime');
  const journalFile = path.join(lease.controlDirectory, 'journal.jsonl');
  const retained = fs.readFileSync(journalFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const final = retained.find((row: any) => row.kind === 'control' && row.payload?.action === 'raw_final');
  assert.ok(final, 'The original final cursor was durably recorded');
  const stateFile = path.join(lease.controlDirectory, 'state.json'), validState = fs.readFileSync(stateFile);
  final.payload.lastSeq++;
  fs.writeFileSync(journalFile, retained.map(row => JSON.stringify(row)).join('\n') + '\n');
  const wrong = new OarLocalMemberRuntime(options);
  assert.deepEqual(await wrong.recover(lease.sessionKey), lease);
  assert.equal((await wrong.close(lease)).closed, false, 'A mismatched retained final cursor cannot prove closure');
  fs.writeFileSync(stateFile, validState);
  final.payload.lastSeq--;
  final.payload.action = 'raw_missing';
  fs.writeFileSync(journalFile, retained.map(row => JSON.stringify(row)).join('\n') + '\n');
  const missing = new OarLocalMemberRuntime(options);
  assert.deepEqual(await missing.recover(lease.sessionKey), lease);
  assert.equal((await missing.close(lease)).closed, false, 'Fresh recovery must not turn a valid raw prefix into final closure');
  await assert.rejects(missing.captureClosedContext(lease, 'missing-final-after-recover', { maxFiles: 8, maxBytes: 4096, maxFileBytes: 2048 }), /final cursor|retention|durab|clos/);
});

test('SDK raw credit respects Host pending-row bound while the first burst fsync is held', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-sdk-row-credit-'));
  const sdk = path.join(root, 'fake-oar.mjs'), originalOpen = fs.promises.open, count = 5000;
  fs.writeFileSync(sdk, `
import fs from 'node:fs';import path from 'node:path';
export async function piSession(_available,options){const records=[],rawObservers=[],eventObservers=[];let timer;
  const emit=(body,event)=>{const row={sessionId:'row-native',agentPath:[],seq:records.length,receivedAt:Date.now(),kind:'frame',body};
    records.push(row);for(const observer of rawObservers)observer(row);
    if(event)for(const observer of eventObservers)observer({...event,sessionId:'row-native',agentPath:[],seq:row.seq,receivedAt:row.receivedAt});};
  return{id:'row-native',records:()=>records,rawEvents:(observer)=>{rawObservers.push(observer);return()=>{}},
    events:(observer)=>{eventObservers.push(observer);return()=>{}},
    async prompt(){timer=setInterval(()=>{if(!fs.existsSync(path.join(options.cwd,'burst.flag')))return;clearInterval(timer);
      for(let n=0;n<${count};n++)emit({type:'ping',n},{kind:'text_delta',text:'x'});
      emit({type:'tool_call_started'},{kind:'tool_call_started',tool:'fixture'});
      emit({type:'message_update'},{kind:'text_delta',text:JSON.stringify({schemaVersion:'output/1',value:{count:${count}},artifacts:[],diagnostics:[]})});
      emit({type:'turn_ended'},{kind:'turn_ended',outcome:{kind:'completed'}});
    },5);return{kind:'accepted'};},async abort(){clearInterval(timer);return{kind:'accepted'}},async dispose(){clearInterval(timer)}};
}
`);
  let arm = false, gated = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
    const fd = await originalOpen(...args);
    if (String(args[0]).endsWith('journal.jsonl')) { const sync = fd.sync.bind(fd);
      fd.sync = async () => { if (arm && !gated) { gated = true; await gate; } await sync(); }; }
    return fd;
  }) as typeof fs.promises.open;
  const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets = { oarModule: sdk, nodeExecutable: process.execPath, opencodeCommand: '/usr/bin/false', opencodeVersion: 'fixture' };
  const runtime = new OarLocalMemberRuntime({ home: root, nodeExecutable: process.execPath,
    runnerModule: path.resolve('packages/harness/lib/oar-member-runner.js'), assets });
  t.after(async () => { release(); fs.promises.open = originalOpen; await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1',
    identity: { runId: 'row-run', taskId: 'row-task', effectId: 'row-effect', inputSha256: 'a'.repeat(64),
      packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' },
    projectId: 'project', memberId: 'member', runtime: 'pi', modelRef: 'fixture', generation: 1,
    sessionKey: 'row-credit', inputId: 'initial', deadlineAt: new Date(Date.now() + 25000).toISOString(), prompt: 'row credit' },
    model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' },
    outputSchemaVersion: 'output/1', assets }, []);
  await runtime.start(lease);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && !(await runtime.read(lease, { summaryOnly: true })).evidence.some((row: any) => row.kind === 'created')) await pause(20);
  await runtime.authorize(lease, { sessionKey: lease.sessionKey, generation: lease.generation, nativeSession: 'row-native', inputId: 'initial' });
  while (Date.now() < deadline && !(await runtime.read(lease, { summaryOnly: true })).evidence.some((row: any) => row.kind === 'received')) await pause(20);
  arm = true; fs.writeFileSync(path.join(lease.workDirectory, 'burst.flag'), 'go');
  while (Date.now() < deadline && !gated) await pause(10);
  assert.equal(gated, true, 'The real first burst fsync must be held before credit can return');
  await pause(300); release();
  let view: any;
  while (Date.now() < deadline) { view = await runtime.read(lease, { summaryOnly: true }); if (view.result) break; await pause(50); }
  assert.ok(view?.result, 'all 5000 native records survive the held ACK without overflowing rows');
  assert.equal(JSON.parse(view.result).output.value.count, count);
  assert.equal((await runtime.close(lease)).closed, true);
  const journal = fs.readFileSync(path.join(lease.controlDirectory, 'journal.jsonl'), 'utf8');
  const rows = journal.trim().split('\n').map(line => JSON.parse(line));
  const raw = rows.filter((row: any) => row.kind === 'raw');
  assert.equal(raw.length, count + 3);
  assert.equal(rows.filter((row: any) => row.kind === 'event' && row.payload.kind === 'text_delta').length, count + 1);
  raw.forEach((row: any, index: number) => assert.equal(row.payload.seq, index));
});

test('ordinary stop cannot certify complete closure while pre-stop SDK raw records await credit', { timeout: 20000 }, async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-sdk-stop-credit-'));
  const sdk = path.join(root, 'fake-oar.mjs'), originalOpen = fs.promises.open, count = 400;
  fs.writeFileSync(sdk, `
import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';
export async function piSession(_available,options){const records=[],observers=[];let timer;
  return{id:'stop-credit-native',records:()=>records,rawEvents:(observer)=>{observers.push(observer);return()=>{}},
    events:()=>()=>{},async prompt(){timer=setInterval(()=>{if(!fs.existsSync(path.join(options.cwd,'burst.flag')))return;
      clearInterval(timer);for(let n=0;n<${count};n++){const row={sessionId:'stop-credit-native',agentPath:[],seq:n,
        receivedAt:Date.now(),kind:'frame',body:{type:'message_update',text:randomBytes(24000).toString('base64')}};
        records.push(row);for(const observer of observers)observer(row);}
      fs.writeFileSync(path.join(options.cwd,'emitted.json'),JSON.stringify({count:records.length}));
    },5);return{kind:'accepted'};},async abort(){clearInterval(timer);return{kind:'accepted'}},async dispose(){clearInterval(timer)}};
}
`);
  fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
    const fd = await originalOpen(...args);
    if (String(args[0]).endsWith('journal.jsonl')) { const sync = fd.sync.bind(fd);
      fd.sync = async () => { await pause(100); await sync(); }; }
    return fd;
  }) as typeof fs.promises.open;
  const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets = { oarModule: sdk, nodeExecutable: process.execPath, opencodeCommand: '/usr/bin/false', opencodeVersion: 'fixture' };
  const runtime = new OarLocalMemberRuntime({ home: root, nodeExecutable: process.execPath,
    runnerModule: path.resolve('packages/harness/lib/oar-member-runner.js'), assets });
  t.after(async () => { fs.promises.open = originalOpen; await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1',
    identity: { runId: 'stop-run', taskId: 'stop-task', effectId: 'stop-effect', inputSha256: 'a'.repeat(64),
      packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' },
    projectId: 'project', memberId: 'member', runtime: 'pi', modelRef: 'fixture', generation: 1,
    sessionKey: 'stop-credit', inputId: 'initial', deadlineAt: new Date(Date.now() + 15000).toISOString(), prompt: 'stop' },
    model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' },
    outputSchemaVersion: 'output/1', assets }, []);
  await runtime.start(lease);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && !(await runtime.read(lease, { summaryOnly: true })).evidence.some((row: any) => row.kind === 'created')) await pause(20);
  await runtime.authorize(lease, { sessionKey: lease.sessionKey, generation: lease.generation,
    nativeSession: 'stop-credit-native', inputId: 'initial' });
  while (Date.now() < deadline && !(await runtime.read(lease, { summaryOnly: true })).evidence.some((row: any) => row.kind === 'received')) await pause(20);
  fs.writeFileSync(path.join(lease.workDirectory, 'burst.flag'), 'go');
  while (Date.now() < deadline && !fs.existsSync(path.join(lease.workDirectory, 'emitted.json'))) await pause(10);
  assert.equal(JSON.parse(fs.readFileSync(path.join(lease.workDirectory, 'emitted.json'), 'utf8')).count, count);
  const closure = await runtime.close(lease);
  assert.throws(() => process.kill(lease.pid!, 0), 'Original owned process is physically absent');
  const rows = fs.readFileSync(path.join(lease.controlDirectory, 'journal.jsonl'), 'utf8').trim().split('\n')
    .filter(Boolean).map(line => JSON.parse(line));
  const raw = rows.filter((row: any) => row.kind === 'raw');
  const final = rows.find((row: any) => row.kind === 'control' && row.payload?.action === 'raw_final');
  assert.ok(raw.length <= count);
  if (closure.closed) {
    assert.equal(raw.length, count, 'Normal closure requires every pre-stop raw record');
    assert.ok(final, 'Normal closure requires its final durable cursor');
  } else {
    assert.equal(closure.closed, false, 'Missing pre-stop raw facts or final cursor make combined closure unproved');
    await assert.rejects(runtime.captureClosedContext(lease, 'no-missing-raw-checkpoint', { maxFiles: 8, maxBytes: 4096, maxFileBytes: 2048 }), /retention|durab|clos|final cursor/);
  }
});

test('normalized event high water emits one raw failure and cannot keep admitting a synchronous tail', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-sdk-event-highwater-'));
  const sdk = path.join(root, 'fake-oar.mjs');
  fs.writeFileSync(sdk, `
import fs from 'node:fs';import path from 'node:path';
export async function piSession(_available,options){const records=[],rawObservers=[],eventObservers=[];
  const originalSend=process.send.bind(process);let failures=0;
  process.send=(message,...args)=>{if(message?.type==='raw_failure')failures++;return originalSend(message,...args);};
  return{id:'highwater-native',records:()=>records,rawEvents:(observer)=>{rawObservers.push(observer);return()=>{}},
    events:(observer)=>{eventObservers.push(observer);return()=>{}},async prompt(){
      for(let n=0;n<9000;n++){const row={sessionId:'highwater-native',agentPath:[],seq:n,receivedAt:Date.now(),kind:'frame',body:{type:'ping'}};
        records.push(row);for(const observer of rawObservers)observer(row);
        for(const observer of eventObservers)observer({kind:'text_delta',text:'x',sessionId:'highwater-native',agentPath:[],seq:n,receivedAt:row.receivedAt});}
      fs.writeFileSync(path.join(options.cwd,'highwater.json'),JSON.stringify({produced:records.length,failures}));
      return{kind:'accepted'};},async abort(){return{kind:'accepted'}},async dispose(){}};
}
`);
  const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets = { oarModule: sdk, nodeExecutable: process.execPath, opencodeCommand: '/usr/bin/false', opencodeVersion: 'fixture' };
  const runtime = new OarLocalMemberRuntime({ home: root, nodeExecutable: process.execPath,
    runnerModule: path.resolve('packages/harness/lib/oar-member-runner.js'), assets });
  t.after(async () => { await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1',
    identity: { runId: 'water-run', taskId: 'water-task', effectId: 'water-effect', inputSha256: 'a'.repeat(64),
      packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' },
    projectId: 'project', memberId: 'member', runtime: 'pi', modelRef: 'fixture', generation: 1,
    sessionKey: 'water-member', inputId: 'initial', deadlineAt: new Date(Date.now() + 10000).toISOString(), prompt: 'water' },
    model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' },
    outputSchemaVersion: 'output/1', assets }, []);
  await runtime.start(lease);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !(await runtime.read(lease, { summaryOnly: true })).evidence.some((row: any) => row.kind === 'created')) await pause(20);
  await runtime.authorize(lease, { sessionKey: lease.sessionKey, generation: lease.generation,
    nativeSession: 'highwater-native', inputId: 'initial' });
  const metricsFile = path.join(lease.workDirectory, 'highwater.json');
  while (Date.now() < deadline && !fs.existsSync(metricsFile)) await pause(20);
  assert.ok(fs.existsSync(metricsFile), 'The controlled SDK completed its synchronous tail');
  const metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
  assert.equal(metrics.produced, 9000);
  assert.equal(metrics.failures, 1, 'Once the bounded transfer fails it must not publish repeated failures');
  const closure = await runtime.close(lease);
  assert.equal(closure.closed, false);
  assert.throws(() => process.kill(lease.pid!, 0));
  await assert.rejects(runtime.captureClosedContext(lease, 'highwater-cannot-capture', { maxFiles: 8, maxBytes: 4096, maxFileBytes: 2048 }), /retention|durab|clos|cursor|bounded/);
});

test('actual Node IPC raw/reasoning flood stays responsive and retains every accepted row through physical close and recovery', { timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-journal-ipc-'));
  const runner = path.join(root, 'runner.mjs');
  // Every raw row carries a repeated >32KiB cumulative snapshot, exercising
  // lossless retention and fsync throughput under a bounded native flood.
  fs.writeFileSync(runner, `
let config, timer, index = 0;
const observations = ${observations};
const snapshotText = ${snapshotText.toString()};
const reasoningText = ${reasoningText.toString()};
process.send({ type: 'ready' });
function finish(id, initial) {
  process.send({ type: 'terminal', payload: { inputId: id, outcome: { kind: 'completed' } } });
  process.send({ type: 'finished', inputId: id, text: initial ? JSON.stringify({ schemaVersion: 'output/1',
    value: { observations }, artifacts: [], diagnostics: [] }) : 'ordinary followup completion' });
}
process.on('message', message => {
  if (message.type === 'config') {
    config = message.config;
    process.send({ type: 'created', payload: { runtime: config.prepared.runtime, nativeSession: 'ipc-flood-native' } });
  }
  if (message.type === 'input') {
    process.send({ type: 'received', payload: { inputId: message.id } });
    if (!message.initial) { finish(message.id, false); return; }
    timer = setInterval(() => {
      const receivedAt = new Date().toISOString();
      if (index % 2 === 0) process.send({ type: 'raw', payload: { index, receivedAt,
        event: { type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: snapshotText(index) }] } } } });
      else process.send({ type: 'event', payload: { kind: 'reasoning', index, receivedAt, text: reasoningText(index) } });
      if (++index === observations) { clearInterval(timer); finish(message.id, true); }
    }, 4); // 250 observation rows/sec; IPC send callback is never a durability ACK.
  }
  // Ignore stop to prove the existing Host physical escalation and PID identity.
});
setInterval(() => {}, 1000);
`);
  const { OarLocalMemberRuntime, decodeOarRawObservationPayload } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets = { oarModule: 'controlled-node-fixture', nodeExecutable: process.execPath,
    opencodeCommand: 'controlled-node-fixture', opencodeVersion: 'controlled-node-fixture' };
  const options = { home: root, nodeExecutable: process.execPath, runnerModule: runner, assets };
  const runtime = new OarLocalMemberRuntime(options);
  let timer: ReturnType<typeof setInterval> | undefined;
  let lease: any;
  t.after(async () => { if (timer) clearInterval(timer); await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const began = performance.now();
  lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1',
    identity: { runId: 'fixture-run', taskId: 'fixture-task', effectId: 'fixture-effect', inputSha256: 'a'.repeat(64),
      packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' },
    projectId: 'fixture-project', memberId: 'fixture-member', runtime: 'pi', modelRef: 'fixture', generation: 1,
    sessionKey: 'controlled-ipc-flood', inputId: 'original-input', deadlineAt: new Date(Date.now() + 35000).toISOString(), prompt: 'controlled flood' },
    model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' }, outputSchemaVersion: 'output/1' }, []);
  await runtime.start(lease);
  assert.ok(Number.isInteger(lease.pid) && lease.startIdentity && Number.isInteger(lease.processGroup), 'actual managed birth identity retained');
  const deadline = Date.now() + 30000;
  let created = false;
  while (Date.now() < deadline) { if ((await runtime.read(lease)).journal.includes('"kind":"created"')) { created = true; break; } await pause(20); }
  assert.ok(created, 'actual created IPC arrived');
  let last = performance.now(), maxTimerDelayMs = 0, timerTicks = 0;
  timer = setInterval(() => { const now = performance.now(); maxTimerDelayMs = Math.max(maxTimerDelayMs, now - last - 20); last = now; timerTicks++; }, 20);
  await runtime.authorize(lease, { sessionKey: lease.sessionKey, generation: lease.generation, nativeSession: 'ipc-flood-native', inputId: 'original-input' });
  await runtime.sendInput(lease, 'busy-followup', 'Do not overtake the original terminal');
  let delivered: any;
  while (Date.now() < deadline) { const view = await runtime.read(lease); if (view.result) { delivered = view; break; } await pause(200); }
  assert.ok(delivered, 'original public result appears only after durable correlated completion');
  clearInterval(timer); timer = undefined;
  const output = JSON.parse(delivered.result);
  assert.equal(output.output.value.observations, observations);
  // Finish the queued ordinary followup before closure, so both its intention
  // and completion are retained. Reading remains the full public contract.
  let beforeClose: any;
  while (Date.now() < deadline) {
    beforeClose = await runtime.read(lease);
    if (beforeClose.journal.includes('"kind":"finished","payload":{"inputId":"busy-followup"')) break;
    await pause(20);
  }
  assert.ok(beforeClose.journal.includes('"kind":"finished","payload":{"inputId":"busy-followup"'));
  const closure = await runtime.close(lease);
  assert.equal(closure.closed, true); assert.equal(closure.proof?.absent, true);
  assert.throws(() => process.kill(lease.pid, 0), 'original managed process is physically absent');
  const closedView = await runtime.read(lease);
  const rows = closedView.journal.trim().split('\n').map((line: string) => JSON.parse(line));
  let cursor = -1, streamGeneration: string | undefined;
  const batches: string[] = [];
  for (;;) {
    const batch = await runtime.read(lease, { afterSeq: cursor, streamGeneration, maxRows: 256 });
    const selected = batch.journal.trim().split('\n').filter(Boolean).map((line: string) => JSON.parse(line));
    assert.ok(selected.length <= 256 && selected.length > 0, 'one bounded batch advances the original journal cursor');
    selected.forEach((row: any, index: number) => assert.equal(row.seq, cursor + index + 1));
    cursor = selected.at(-1).seq; streamGeneration = batch.streamGeneration;
    batches.push(batch.journal);
    if (!batch.more) break;
  }
  assert.equal(batches.join(''), closedView.journal, 'bounded polls retain every original journal byte and order');
  const summary = await runtime.read(lease, { summaryOnly: true });
  assert.equal(summary.journal, '');
  assert.ok(summary.evidence.some((row: any) => row.kind === 'received')
    && summary.evidence.some((row: any) => row.kind === 'terminal'), 'summary retains physical input and terminal evidence');
  rows.forEach((row: any, seq: number) => assert.equal(row.seq, seq));
  const observed = rows.filter((row: any) => row.kind === 'raw' || row.kind === 'event');
  assert.equal(observed.length, observations);
  const encoded = observed.filter((row: any) => row.kind === 'raw' && row.payload?.schema === 'hima-oar-raw-gzip/1');
  assert.ok(encoded.length > 0, 'large native frames retain a compressed, reconstructable original');
  assert.throws(() => decodeOarRawObservationPayload({ ...encoded[0]!.payload, sha256: '0'.repeat(64) }), /differs/);
  let maxSdkToHostMs = 0;
  observed.forEach((row: any, index: number) => {
    const payload = row.kind === 'raw' ? decodeOarRawObservationPayload(row.payload) as any : row.payload;
    assert.equal(payload.index, index); assert.equal(row.kind, index % 2 ? 'event' : 'raw');
    const text = index % 2 ? payload.text : payload.event.message.content[0].text;
    assert.equal(hash(text), hash(index % 2 ? reasoningText(index) : snapshotText(index)), `exact payload hash at ${index}`);
    maxSdkToHostMs = Math.max(maxSdkToHostMs, Date.parse(row.time) - Date.parse(payload.receivedAt));
  });
  const originalFinish = rows.findIndex((row: any) => row.kind === 'finished' && row.payload.inputId === 'original-input');
  const followupIntent = rows.findIndex((row: any) => row.kind === 'control' && row.payload.action === 'send_intent' && row.payload.inputId === 'busy-followup');
  assert.ok(originalFinish >= 0 && followupIntent > originalFinish, 'busy input never precedes durable original terminal/finish');
  const recovered = new OarLocalMemberRuntime(options);
  assert.deepEqual(await recovered.recover(lease.sessionKey), lease);
  assert.equal((await recovered.read(lease)).journal, closedView.journal);
  const recoveredBatch = await recovered.read(lease, { afterSeq: -1, maxRows: 256 });
  assert.equal(recoveredBatch.more, true);
  assert.equal(JSON.parse(recoveredBatch.journal.split('\n')[0]!).seq, 0);
  t.diagnostic(JSON.stringify({ observations: observed.length, journalRows: rows.length, journalBytes: Buffer.byteLength(closedView.journal),
    timerTicks, maxTimerDelayMs: Number(maxTimerDelayMs.toFixed(3)), maxSdkToHostMs, elapsedMs: Number((performance.now() - began).toFixed(3)), physicalClosed: closure.closed }));
  // A threshold violation falsifies responsiveness; Root retains the old-source
  // RED and calibrates from its actual machine, never from mocked fs latency.
  assert.ok(timerTicks > 100, 'Host timers were serviced throughout native ingress');
  assert.ok(maxTimerDelayMs < 100, `Host timer delay ${maxTimerDelayMs.toFixed(1)}ms`);
  assert.ok(maxSdkToHostMs < 500, `SDK-to-Host observation backlog ${maxSdkToHostMs}ms`);
});

test('actual managed Node is physically closed on journal sync failure while combined closure and capture remain unknown', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-journal-ipc-fault-'));
  const runner = path.join(root, 'runner.mjs'), originalOpen = fs.promises.open;
  fs.writeFileSync(runner, `process.send({type:'ready'}); process.on('message',m=>{
    if(m.type==='config') process.send({type:'created',payload:{runtime:m.config.prepared.runtime,nativeSession:'fault-native'}});
    // Retain the process until actual Host escalation, independent of journaling.
  }); setInterval(()=>{},1000);`);
  const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets = { oarModule: 'controlled-node-fixture', nodeExecutable: process.execPath, opencodeCommand: 'fixture', opencodeVersion: 'fixture' };
  const options = { home: root, nodeExecutable: process.execPath, runnerModule: runner, assets }, runtime = new OarLocalMemberRuntime(options);
  t.after(async () => { fs.promises.open = originalOpen; await runtime.stopAll(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
    const fd = await originalOpen(...args);
    if (String(args[0]).endsWith('journal.jsonl')) fd.sync = async () => { throw Error('Controlled managed-IPC journal sync failure'); };
    return fd;
  }) as typeof fs.promises.open;
  const lease = await runtime.stage({ prepared: { schema: 'hima-oar-task/1',
    identity: { runId: 'fault-run', taskId: 'fault-task', effectId: 'fault-effect', inputSha256: 'a'.repeat(64), packSha256: 'b'.repeat(64),
      irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' }, projectId: 'project', memberId: 'member',
    runtime: 'pi', modelRef: 'fixture', generation: 1, sessionKey: 'controlled-ipc-fault', inputId: 'initial',
    deadlineAt: new Date(Date.now() + 8000).toISOString(), prompt: 'fixture' },
    model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' }, outputSchemaVersion: 'output/1' }, []);
  await runtime.start(lease);
  let failed = false;
  for (let n = 0; n < 150; n++) {
    const state = JSON.parse(fs.readFileSync(path.join(lease.controlDirectory, 'state.json'), 'utf8'));
    if (state.journalFailureReason) { failed = true; break; }
    await pause(20);
  }
  assert.ok(failed, 'real IPC journal failure must remain observable');
  const closure = await runtime.close(lease);
  assert.equal(closure.closed, false); assert.match(closure.reason, /retention|durability|closure observation unavailable/);
  assert.throws(() => process.kill(lease.pid, 0), 'actual owned PID is absent despite unknown evidence closure');
  await assert.rejects(runtime.read(lease), /retention|durability/);
  await assert.rejects(runtime.captureClosedContext(lease, 'no-fake-checkpoint', { maxFiles: 8, maxBytes: 4096, maxFileBytes: 2048 }), /retention|durability|closure/);
  assert.equal(fs.existsSync(path.join(lease.controlDirectory, 'checkpoints')), false);
  assert.ok(fs.existsSync(lease.controlDirectory), 'original Home remains available');
  fs.promises.open = originalOpen;
  const recovered = new OarLocalMemberRuntime(options); await recovered.recover(lease.sessionKey);
  await assert.rejects(recovered.read(lease), /retention|durability/);
  assert.equal((await recovered.close(lease)).closed, false);
  t.diagnostic(JSON.stringify({ physicalPidAbsent: true, combinedClosed: closure.closed, captureAccepted: false, homeRetained: true }));
});

// Public executor cleanup over an actual owned Node runtime. Store fixture only
// and beforeCleanup callback are explicit stand-ins for Store/admission facts;
// this proves executor IO routing, not an actual Host/PG/grant claim.
async function executorCleanupFixture(t: any, mode: 'stall' | 'error' | 'parent-wait', control: 'cancel' | 'hold' | 'exit' | 'revoke' | 'deadline' = 'cancel') {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'hima-executor-cleanup-'));
  const runner = path.join(root, 'runner.mjs'), originalOpen = fs.promises.open;
  fs.writeFileSync(runner, `process.send({type:'ready'});process.on('message',m=>{
    if(m.type==='config')process.send({type:'created',payload:{runtime:m.config.prepared.runtime,nativeSession:'executor-native'}});
    if(m.type==='input')process.send({type:'received',payload:{inputId:m.id}}); // Keep a real original turn busy without terminal.
  });setInterval(()=>{},1000);`);
  const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const { createOarMemberExecutor } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-member-process.js')).href);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
  if (mode !== 'parent-wait') fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
    const fd = await originalOpen(...args);
    if (String(args[0]).endsWith('journal.jsonl')) {
      const sync = fd.sync.bind(fd);
      fd.sync = async () => { entered(); if (mode === 'error') throw Error('Controlled executor fsync failure'); await gate; await sync(); };
    }
    return fd;
  }) as typeof fs.promises.open;
  const assets = { oarModule: 'controlled-node-fixture', nodeExecutable: process.execPath, opencodeCommand: 'fixture', opencodeVersion: 'fixture' };
  const runtime = new OarLocalMemberRuntime({ home: root, nodeExecutable: process.execPath, runnerModule: runner, assets });
  const prepared = { schema: 'hima-oar-task/1' as const, identity: { runId: 'cleanup-run', taskId: 'cleanup-task', effectId: 'cleanup-effect',
    inputSha256: 'a'.repeat(64), packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'fixture', adapterVersion: 'fixture' },
    projectId: 'project', memberId: 'member', runtime: 'pi' as const, modelRef: 'fixture', generation: 1,
    sessionKey: 'executor-cleanup-'+mode, inputId: 'initial', deadlineAt: new Date(Date.now()+(control==='deadline'?-1000:12000)).toISOString(), prompt: 'fixture' };
  const lease = await runtime.stage({ prepared, model: { provider: 'fixture', model: 'fixture', baseUrl: 'http://fixture.invalid', apiKey: 'fixture-key' }, outputSchemaVersion: 'output/1' }, []);
  const facts = new Map<string, unknown>([['oar:local-lease', lease]]);
  const store = {
    externalEffectFact: async (identity: unknown, key: string) => { assert.deepEqual(identity, prepared.identity); return facts.get(key); },
    recordExternalEffectFact: async (identity: unknown, key: string, value: unknown) => { assert.deepEqual(identity, prepared.identity); facts.set(key, value); },
    readTeamExecutionBinding: async () => ({ deadlineAt: prepared.deadlineAt }),
    readTeamEffectHead: async () => mode === 'parent-wait' ? { state: 'waiting', wait: { parentIdentity: prepared.identity, waitId: 'parent-wait', requestId: 'parent-request' } } : { state: 'active' },
    run: async () => ({ runId: prepared.identity.runId, epoch: prepared.generation, cancelled: mode !== 'parent-wait' && control==='cancel', hold: mode !== 'parent-wait' && control==='hold' }),
    effect: async () => ({ identity: prepared.identity }), hostExit: async () => mode !== 'parent-wait' && control==='exit', teamEffectOperatorRevoked: async (identity: unknown) => { assert.deepEqual(identity,prepared.identity); return mode !== 'parent-wait' && control==='revoke'; },
    listExternalEffectFacts: async () => ({}), effectDispatchExists: async () => false, revokeTeamGrant: async () => { },
  };
  const executor = createOarMemberExecutor({ home: root, retainedMaterialsDir: path.join(root,'materials'), localRuntime: runtime,
    services: {} as any, store: store as any, privatePorts: () => [], sharedDeepSeekModel: async () => ({ model: 'unused' }), memberContext: async () => ({}) });
  t.after(async () => { release(); fs.promises.open = originalOpen; await executor.dispose(); fs.rmSync(root,{recursive:true,force:true}); });
  await runtime.start(lease);
  if (mode !== 'parent-wait') await Promise.race([reached,pause(2000).then(()=>{throw Error('Actual executor journal sync gate not reached');})]);
  else {
    let created = false;
    for (let n = 0; n < 100; n++) { if ((await runtime.read(lease)).journal.includes('"kind":"created"')) { created = true; break; } await pause(20); }
    assert.ok(created,'parent-wait fixture receives actual native identity');
    await runtime.authorize(lease,{sessionKey:prepared.sessionKey,generation:prepared.generation,nativeSession:'executor-native',inputId:prepared.inputId});
    let received = false;
    for (let n = 0; n < 100; n++) {
      const view = await runtime.read(lease);
      if(view.journal.includes('"kind":"received"')) { received = true; assert.equal(JSON.parse(view.state!).phase,'running'); break; }
      await pause(20);
    }
    assert.ok(received,'ordinary active-input refusal is grounded in real received IPC without terminal');
  }
  return { runtime, executor, prepared, lease, release, facts };
}

test('public executor close reaches owned cleanup despite stalled fsync and retains unknown evidence', { timeout: 25000 }, async t => {
  for (const control of ['cancel','hold','exit','revoke','deadline'] as const) {
  const f = await executorCleanupFixture(t,'stall',control);
  let admitted = 0;
  const closing = f.executor.port.close(f.prepared,undefined,async()=>{admitted++;return true;});
  try {
    await pause(200);
    await assert.rejects(f.runtime.sendInput(f.lease,'late','No input may escape admitted stop'),/stopping rejects input/);
    assert.equal(admitted,1,'existing cleanup callback stand-in reached before journal durability');
    const closure = await Promise.race([closing,pause(3000).then(()=>{throw Error('Executor close blocked before bounded local cleanup');})]);
    assert.equal(closure.closed,false); assert.match(closure.reason??'',/retention|durability|Process closure observation unavailable/);
    assert.throws(()=>process.kill(f.lease.pid!,0),'actual original PID is absent despite combined unknown');
    assert.equal(f.facts.has('oar:closed'),false,'unknown cleanup cannot publish a fabricated normal proof');
    assert.ok(fs.existsSync(f.lease.controlDirectory));
    await assert.rejects(f.runtime.captureClosedContext(f.lease,'no-stall-capture',{maxFiles:8,maxBytes:4096,maxFileBytes:2048}),/retention|durability|closure/);
  } finally { f.release(); await closing.catch(()=>{}); }
  }
});

test('public executor close reconciles the original owned lease after known journal failure', { timeout: 10000 }, async t => {
  const f = await executorCleanupFixture(t,'error');
  const observed = await f.executor.port.observe(f.prepared);
  assert.equal(observed.state, 'failed', 'fatal local observation failure must terminate business waiting');
  assert.match(observed.reason ?? '', /retention|durability/);
  let admitted = 0;
  const closure = await f.executor.port.close(f.prepared,undefined,async()=>{admitted++;return true;});
  assert.equal(admitted,1); assert.equal(closure.closed,false); assert.match(closure.reason??'',/retention|durability/);
  assert.throws(()=>process.kill(f.lease.pid!,0));
  assert.equal(f.facts.has('oar:closed'),false);
  await assert.rejects(f.runtime.read(f.lease),/retention|durability/);
  await assert.rejects(f.runtime.captureClosedContext(f.lease,'known-error-capture',{maxFiles:8,maxBytes:4096,maxFileBytes:2048}),/retention|durability|closure/);
  assert.ok(fs.existsSync(f.lease.controlDirectory));
});

test('accepted parent wait alone preserves ordinary active-input refusal and never admits own cleanup', { timeout: 10000 }, async t => {
  const f = await executorCleanupFixture(t,'parent-wait');
  let admitted = 0;
  const closure = await f.executor.port.close(f.prepared,undefined,async()=>{admitted++;return true;});
  assert.equal(closure.closed,false); assert.match(closure.reason??'',/active|unconfirmed/);
  assert.equal(admitted,0); assert.doesNotThrow(()=>process.kill(f.lease.pid!,0),'parent wait does not authorize an own-process stop');
});

test('cold journal recovery preserves exact valid UTF-8 across stream boundary and rejects malformed bytes', async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'hima-journal-utf8-'));
  const { OarLocalMemberRuntime } = await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets = { oarModule: 'unused', nodeExecutable: 'unused', opencodeCommand: 'unused', opencodeVersion: 'unused' };
  const options = { home: root, nodeExecutable: 'unused', runnerModule: 'unused', assets };
  const original = new OarLocalMemberRuntime(options);
  t.after(async()=>{await original.stopAll();fs.rmSync(root,{recursive:true,force:true});});
  for (const malformed of [false,true,'truncated'] as const) {
    const lease = await original.stage({prepared:{schema:'hima-oar-task/1',identity:{runId:'utf8-run',taskId:'utf8-task',effectId:'utf8-effect',
      inputSha256:'a'.repeat(64),packSha256:'b'.repeat(64),irSha256:'c'.repeat(64),applicationVersion:'fixture',adapterVersion:'fixture'},
      projectId:'project',memberId:'member',runtime:'pi',modelRef:'fixture',generation:1,sessionKey:malformed==='truncated'?'truncated-codepoint':malformed?'malformed-bytes':'unicode-split',
      inputId:'initial',deadlineAt:new Date(Date.now()+10000).toISOString(),prompt:'fixture'},
      model:{provider:'fixture',model:'fixture',baseUrl:'http://fixture.invalid',apiKey:'fixture-key'},outputSchemaVersion:'output/1'},[]);
    const row = {schema:'hima-oar-observation/1',sessionKey:lease.sessionKey,generation:lease.generation,memberId:lease.memberId,
      nativeSession:'unicode-native',streamGeneration:'unicode-stream',seq:0,time:new Date().toISOString(),kind:'created',
      payload:{runtime:'pi',nativeSession:'unicode-native',text:'MARKER'}};
    const template = JSON.stringify(row), marker = template.indexOf('MARKER');
    // U+1F310 is four UTF-8 bytes, beginning at byte65535 so read-stream's 64KiB
    // first chunk ends mid-codepoint. The decoder must retain it without repair.
    row.payload.text = 'x'.repeat(65535-Buffer.byteLength(template.slice(0,marker)))+'🌐 exact multilingual λ 汉字';
    let bytes = Buffer.from(JSON.stringify(row)+'\n');
    if(malformed==='truncated')bytes=bytes.subarray(0,65537);
    else if(malformed)bytes[65535]=0xff; // old encoding:'utf8' silently substitutes U+FFFD inside valid JSON.
    fs.writeFileSync(path.join(lease.controlDirectory,'journal.jsonl'),bytes);
    const recovered = new OarLocalMemberRuntime(options);
    if(malformed)await assert.rejects(recovered.recover(lease.sessionKey),/UTF-8/);
    else {
      assert.deepEqual(await recovered.recover(lease.sessionKey),lease);
      assert.deepEqual(Buffer.from((await recovered.read(lease)).journal),bytes,'cached public transcript must equal original accepted bytes');
      await recovered.close(lease);
    }
  }
});

// Retained business1 failed natively with Request timed out, then raw-final was
// unconfirmed. Substitute only the SDK failure/tail; real runner, IPC and fsync remain.
test('native business failure flushes abort/dispose raw tail without accepting a successful result', {timeout:15000},async t=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()),'hima-failed-raw-tail-'));
  const sdk=path.join(root,'failed-sdk.mjs');
  fs.writeFileSync(sdk,`
export async function piSession(){
 const raw=[],rawObservers=[],eventObservers=[];
 const emit=(body,event)=>{const record={sessionId:'failed-tail-native',agentPath:[],seq:raw.length,receivedAt:Date.now(),kind:'frame',body};raw.push(record);for(const f of rawObservers)f(record);if(event)for(const f of eventObservers)f({...event,sessionId:'failed-tail-native',agentPath:[],seq:record.seq,receivedAt:record.receivedAt});};
 return{id:'failed-tail-native',records:()=>raw,rawEvents:f=>{rawObservers.push(f);return()=>{}},events:f=>{eventObservers.push(f);return()=>{}},
  async prompt(){setTimeout(()=>emit({type:'turn_ended'},{kind:'turn_ended',outcome:{kind:'failed',reason:'Request timed out.',failure:'unknown'}}),20);return{kind:'accepted'}},
  async abort(){emit({type:'abort-tail',text:'original abort observation'});return{kind:'accepted'}},
  async dispose(){emit({type:'dispose-tail',text:'original dispose observation'});}}
}
`);
  const {OarLocalMemberRuntime}=await import(pathToFileURL(path.resolve('packages/harness/lib/oar-local-member.js')).href);
  const assets={oarModule:sdk,nodeExecutable:process.execPath,opencodeCommand:'/usr/bin/false',opencodeVersion:'fixture'};
  const runtime=new OarLocalMemberRuntime({home:root,nodeExecutable:process.execPath,runnerModule:path.resolve('packages/harness/lib/oar-member-runner.js'),assets});
  t.after(async()=>{await runtime.stopAll();fs.rmSync(root,{recursive:true,force:true});});
  const lease=await runtime.stage({prepared:{schema:'hima-oar-task/1',identity:{runId:'failed-tail-run',taskId:'failed-tail-task',effectId:'failed-tail-effect',inputSha256:'a'.repeat(64),packSha256:'b'.repeat(64),irSha256:'c'.repeat(64),applicationVersion:'fixture',adapterVersion:'fixture'},
    projectId:'project',memberId:'member',runtime:'pi',modelRef:'fixture',generation:1,sessionKey:'failed-tail-member',inputId:'initial',deadlineAt:new Date(Date.now()+12000).toISOString(),prompt:'Fail with the native timeout and retain its observations'},
    model:{provider:'fixture',model:'fixture',baseUrl:'http://fixture.invalid',apiKey:'fixture-only'},outputSchemaVersion:'output/1',assets},[]);
  await runtime.start(lease);
  const until=Date.now()+7000;
  for(;;){const view=await runtime.read(lease,{summaryOnly:true});if(view.evidence.some((row:any)=>row.kind==='created'))break;assert.ok(Date.now()<until,'SDK creation');await pause(10);}
  await runtime.authorize(lease,{sessionKey:lease.sessionKey,generation:lease.generation,nativeSession:'failed-tail-native',inputId:'initial'});
  const stateFile=path.join(lease.controlDirectory,'state.json');
  let state:any;
  do{state=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(['closed','unknown'].includes(state.phase))break;await pause(10);}while(Date.now()<until);
  const closed=await runtime.close(lease);
  assert.equal(closed.closed,true,'Ordinary failed business must not prevent durable observation/resource closure: '+closed.reason);
  const rows=fs.readFileSync(path.join(lease.controlDirectory,'journal.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const raw=rows.filter((row:any)=>row.kind==='raw'&&Number.isSafeInteger(row.payload?.seq));
  assert.deepEqual(raw.map((row:any)=>row.payload.seq),[0,1,2]);
  assert.deepEqual(raw.map((row:any)=>row.payload.body.type),['turn_ended','abort-tail','dispose-tail']);
  const final=rows.find((row:any)=>row.kind==='control'&&row.payload?.action==='raw_final');assert.ok(final);assert.equal(final.payload.lastSeq,2);
  assert.ok(rows.some((row:any)=>row.kind==='terminal'&&row.payload?.outcome?.kind==='failed'&&row.payload.outcome.reason==='Request timed out.'),'Original business failure remains explicit');
  assert.equal(rows.some((row:any)=>row.kind==='finished'),false);
  assert.equal((await runtime.read(lease,{summaryOnly:true})).result,null,'No failed business result is adopted');
  const recovered=new OarLocalMemberRuntime({home:root,nodeExecutable:process.execPath,runnerModule:path.resolve('packages/harness/lib/oar-member-runner.js'),assets});
  await recovered.recover(lease.sessionKey);assert.equal((await recovered.close(lease)).closed,true,'Cold read retains complete failed-turn observations and original physical absence');
});
