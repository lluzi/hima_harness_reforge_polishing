// L0: production offline gate; no database, model, scheduler or desktop can start.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { assertHomeExecutionAllowed, recordHomeCutover } from '../../packages/harness/src/local-database.ts';

test('production refuses an active legacy Run before mutation and retains completed history', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-cutover-'));
  const ledger = path.join(home, 'storages/hima_ledger.json');
  const previous = process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  try {
    await mkdir(path.dirname(ledger));
    const snapshot = {unit:{name:'hima_ledger',version:34},global:null,tables:{runs:{original:{id:'original',packId:'old-pack',status:'waiting',currentNode:'engineering'}},records:{originalMethod:{methodDigest:'a'.repeat(64),retainedPackDir:'/retained/original'},originalReport:{sha256:'b'.repeat(64)}}}};
    const original = JSON.stringify(snapshot);
    await writeFile(ledger, original);
    await assert.rejects(assertHomeExecutionAllowed({home}), /active legacy.*original.*original App/i);
    assert.equal(await readFile(ledger, 'utf8'), original);
    await assert.rejects(access(path.join(home,'hima/database')), /ENOENT/);
    snapshot.tables.runs.original.status = 'ended-goal-met';
    const ended = JSON.stringify(snapshot);
    await writeFile(ledger, ended);
    await assertHomeExecutionAllowed({home});
    assert.equal(await readFile(ledger,'utf8'), ended);
    await assert.rejects(access(path.join(home,'hima')), /ENOENT/);
    await recordHomeCutover({home});
    assert.equal(await readFile(ledger,'utf8'), ended);
    const receipt = JSON.parse(await readFile(path.join(home,'hima/cutover.json'),'utf8'));
    assert.equal(receipt.format,'hima-dbos-cutover/1');
    assert.equal(receipt.runs[0].id,'original');
    assert.equal(receipt.runs[0].status,'ended-goal-met');
  } finally {
    if(previous===undefined)delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;else process.env.HIMA_TEST_LEGACY_AUTO_DRIVE=previous;
    await rm(home,{recursive:true,force:true});
  }
});

test('changed executable cannot open a pending checkpoint; original frozen executable resumes once', {timeout:60000}, async () => {
  const {dbosHome,dbosProcess,cleanDbosHome} = await import('./support/dbos-process.ts');
  const home = await dbosHome();
  let host:ReturnType<typeof dbosProcess>|undefined;
  try {
    host=dbosProcess(home,'cutover-version-original');
    const first=await host.next(); assert.equal(first.ok,true);
    await host.close(); host=undefined;
    const before=await readFile(path.join(home,'hima/database/credentials.json'));
    host=dbosProcess(home,'cutover-version-changed');
    const denied=await host.next(); assert.equal(denied.refused,true);
    await host.close(); host=undefined;
    assert.deepEqual(await readFile(path.join(home,'hima/database/credentials.json')),before);
    await assert.rejects(access(path.join(home,'business-calls')),/ENOENT/);
    host=dbosProcess(home,'cutover-version-resume');
    const resumed=await host.next();assert.equal(resumed.version,first.version);
    assert.equal(await readFile(path.join(home,'business-calls'),'utf8'),'completed\n');
  } finally { await host?.close(); await cleanDbosHome(home); }
});
