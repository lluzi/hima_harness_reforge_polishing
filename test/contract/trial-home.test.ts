import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { packagedTrialDshHome } from '../../packages/desktop/src/hima-home.ts';
import { mkdtemp, mkdir, rm, writeFile, lstat, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';

test('a new Home establishes the private retained-material root before any artifact exists', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-108-empty-material-'));
  const foreign = await mkdtemp(path.join(tmpdir(), 'hima-108-foreign-material-'));
  try {
    const { pathToFileURL } = await import('node:url');
    const database = await import(pathToFileURL(path.resolve('packages/harness/lib/local-database.js')).href);
    const retained = await database.resolveRetainedMaterialsDirectory({ home });
    assert.equal(retained, path.join(await realpath(home), 'hima/run-assets/dbos'));
    assert.equal((await lstat(retained)).isDirectory(), true, 'a genuinely empty new Home must still be cold-backup complete');
    assert.equal((await lstat(retained)).mode & 0o077, 0);
    await rm(path.join(home, 'hima/run-assets'), { recursive: true });
    await symlink(foreign, path.join(home, 'hima/run-assets'), 'dir');
    await assert.rejects(database.resolveRetainedMaterialsDirectory({ home }), /private directory|symlink|owned/i);
    assert.equal((await lstat(path.join(home, 'hima/run-assets'))).isSymbolicLink(), true,
      'Refusal must not replace an unrelated path');
  } finally { await rm(home, { recursive: true, force: true }); await rm(foreign, { recursive: true, force: true }); }
});

test('a packaged trial version gets a fresh default DSH home without adopting the prior trial ledger', () => {
  const userData = path.resolve('/tmp/hima-user-data');
  assert.equal(packagedTrialDshHome(userData, '0.3.0-trial.3'),
    path.join(userData, 'trial-dsh-0.3.0-trial.3'));
  assert.notEqual(packagedTrialDshHome(userData, '0.3.0-trial.3'), path.join(userData, 'trial-dsh'));
  assert.throws(() => packagedTrialDshHome(userData, '../other-home'), /application version/);
});

test('versioned trial maintenance refuses a live owner even when Home is held before preparation',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hima-108-trial-'));
  try {
    const home=packagedTrialDshHome(root,'0.3.0-trial.47');await mkdir(path.join(home,'hima/database/host-owner'),{recursive:true});
    await writeFile(path.join(home,'hima/restore-hold.json'),'{}');
    await writeFile(path.join(home,'hima/database/host-owner/owner.json'),JSON.stringify({pid:process.pid}));
    const {pathToFileURL}=await import('node:url');
    const module=await import(pathToFileURL(path.join(process.env.HIMA_108_DESKTOP_LIB??path.resolve('packages/desktop/lib'),'data-maintenance.js')).href);
    const result=await module.runColdMaintenance({home,action:'inspect',assertHostStopped:async()=>{},
      backupOptions:async()=>{throw new Error('must not prepare');},loadApi:async()=>{throw new Error('must not import');},
      dialog:{showOpenDialog:async()=>{throw new Error('must not select');},showSaveDialog:async()=>{throw new Error('must not select');},showMessageBox:async()=>({response:0})}});
    assert.equal(result.state,'failed');assert.match(result.message,/live Host/);
  }finally{await rm(root,{recursive:true,force:true});}
});
