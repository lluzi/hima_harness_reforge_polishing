// L0 packaging boundary: retained bytes, no service/model/EDA/VM operation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './support/dsh-home.ts';
const { packageTeamRuntime, verifyTeamRuntime } = await import(pathToFileURL(path.join(repoRoot, 'scripts/package-team-runtime.mjs')).href);
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const platform = `${process.platform}-${process.arch}`;
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hima-team-package-'));
  const prefix = path.join(directory, 'retained'); const pinFile = path.join(directory, 'pin.json');
  await mkdir(path.join(prefix, 'helpers'), { recursive: true });
  const files: Record<string,string> = {'helpers/service': sha('retained service'), 'NOTICE': sha('fixture notice')};
  await writeFile(path.join(prefix, 'helpers/service'), 'retained service'); await writeFile(path.join(prefix, 'NOTICE'), 'fixture notice');
  const component = {id:'hindsight',version:'0.10.3',source:'https://pypi.org/project/hindsight-api-slim/0.10.3/',license:'MIT',notices:['NOTICE'],requiredFiles:['helpers/service']};
  const services = [{id:'hindsight',executable:'helpers/service',argv:[] as string[],backupExecutable:'helpers/service',backupArgv:[] as string[],timeoutMs:1000,stopGraceMs:100}];
  const manifest = {format:'hima-team-runtime/1',platform,qualification:'asset-assembly-only',files,components:[component],services};
  const pin = {format:'hima-team-runtime/1',qualification:'retained-assets-partial',noImplicitDownloads:true,
    components:[{...component,platformAssets:{[platform]:{files}}}],platformAssets:{[platform]:{qualification:'asset-assembly-only',manifestSha256:'',inventorySha256:sha(JSON.stringify(files)),fileCount:2,requiredComponents:['hindsight'],services,releaseBlockers:['missing complete five-component cohort','missing transitive notices']}}};
  const seal = async () => {
    const bytes = JSON.stringify(manifest); await writeFile(path.join(prefix, 'team-runtime.json'), bytes);
    pin.platformAssets[platform]!.manifestSha256 = sha(bytes); await writeFile(pinFile, JSON.stringify(pin));
  };
  await seal();
  const assemble = (internalCandidate = true) => packageTeamRuntime({prefix,pinFile,output:path.join(directory,'assembled'),internalCandidate});
  return {directory,prefix,pinFile,manifest,pin,seal,assemble};
}

test('internal assembly preserves pinned bytes and exposes blockers; distribution refuses partial closure', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.assemble(false), /distribution is not qualified.*five-component.*notices/);
    assert.equal(existsSync(path.join(f.directory,'assembled')), false);
    const receipt = await f.assemble();
    assert.equal(receipt.manifestSha256, sha(await readFile(path.join(f.prefix,'team-runtime.json'))));
    assert.deepEqual(receipt.releaseBlockers, ['missing complete five-component cohort','missing transitive notices']);
    assert.equal(await readFile(path.join(f.directory,'assembled/helpers/service'),'utf8'), 'retained service');
    await verifyTeamRuntime(path.join(f.directory,'assembled'), receipt);
    await assert.rejects(f.assemble(), /destination already exists/);
    await writeFile(path.join(f.directory,'assembled/helpers/service'), 'changed');
    await assert.rejects(verifyTeamRuntime(path.join(f.directory,'assembled'),receipt), /bytes differ/);
  } finally { await rm(f.directory,{recursive:true,force:true}); }
});

test('wrong architecture, corrupt bytes, missing helpers and unpinned extras fail before output', async () => {
  for (const scenario of ['wrong-platform','wrong-native-arch','wrong-hash','missing-helper','extra-file','changed-manifest']) {
    const f = await fixture();
    try {
      let expected: RegExp;
      if (scenario === 'wrong-platform') { f.manifest.platform = 'unsupported-x64'; await f.seal(); expected = /platform\/architecture differs/; }
      else if (scenario === 'wrong-native-arch') {
        const foreign = Buffer.alloc(32);
        if (process.platform === 'darwin') { foreign.set([0x7f,0x45,0x4c,0x46]); foreign[5]=1;foreign.writeUInt16LE(62,18); }
        else { foreign.writeUInt32LE(0xfeedfacf,0);foreign.writeUInt32LE(0x100000c,4); }
        await writeFile(path.join(f.prefix,'helpers/service'),foreign);
        f.manifest.files['helpers/service']=sha(foreign);
        f.pin.platformAssets[platform]!.inventorySha256=sha(JSON.stringify(f.manifest.files));
        await f.seal(); expected=/another architecture/;
      }
      else if (scenario === 'wrong-hash') { await writeFile(path.join(f.prefix,'helpers/service'),'corrupt'); expected=/bytes differ/; }
      else if (scenario === 'missing-helper') { await unlink(path.join(f.prefix,'helpers/service'));expected=/pinned Team runtime file.*missing/; }
      else if (scenario === 'extra-file') { await writeFile(path.join(f.prefix,'untracked'),'must not ship');expected=/unpinned file/; }
      else { await writeFile(path.join(f.prefix,'team-runtime.json'),'{}');expected=/manifest hash differs/; }
      await assert.rejects(f.assemble(),expected);
      assert.equal(existsSync(path.join(f.directory,'assembled')), false, scenario);
    } finally { await rm(f.directory,{recursive:true,force:true}); }
  }
});

test('source-only catalogs and absent platform closure are actionable, with no assembly', async () => {
  const f=await fixture();
  try {
    f.pin.qualification='source-identities-only'; await writeFile(f.pinFile,JSON.stringify(f.pin));
    await assert.rejects(f.assemble(),/source-only catalog/);
    f.pin.qualification='retained-assets-partial'; delete f.pin.platformAssets[platform]; await writeFile(f.pinFile,JSON.stringify(f.pin));
    await assert.rejects(f.assemble(),/no fixed.*deployment closure/);
    assert.equal(existsSync(path.join(f.directory,'assembled')),false);
  } finally { await rm(f.directory,{recursive:true,force:true}); }
});

test('native audit retains Team blockers and binds staged component notices to assembly identity', async () => {
  const f=await fixture();
  try {
    const receipt=await f.assemble();
    const app=path.join(f.directory,'app');const resource=path.join(app,'resources');
    await mkdir(path.join(resource,'node_modules'),{recursive:true});
    const {cp}=await import('node:fs/promises');await cp(path.join(f.directory,'assembled'),path.join(resource,'team-runtime'),{recursive:true});
    const lockfile=path.join(f.directory,'lock.yaml');await writeFile(lockfile,'packages: {}\n');
    const {auditDistribution}=await import(pathToFileURL(path.join(repoRoot,'scripts/package-native-audit.mjs')).href);
    const inputs={app,resource,lockfile,electronVersion:'44.2.0',teamRuntimeIdentity:receipt};
    const audit=auditDistribution(inputs);
    assert.ok(audit.unresolved.includes('missing transitive notices'));
    const sbom=JSON.parse(await readFile(path.join(resource,'third-party/SBOM.json'),'utf8'));
    assert.equal(sbom.teamRuntime.manifestSha256,receipt.manifestSha256);
    assert.equal(sbom.teamComponents[0].id,'hindsight');
    assert.equal(sbom.teamComponents[0].notices[0].sha256,sha('fixture notice'));
    assert.throws(()=>auditDistribution({...inputs,teamRuntimeIdentity:{...receipt,manifestSha256:'0'.repeat(64)}}),/assembly identity differs/);
    await writeFile(path.join(resource,'team-runtime/NOTICE'),'changed');
    assert.throws(()=>auditDistribution(inputs),/notice bytes differ/);
  } finally {await rm(f.directory,{recursive:true,force:true});}
});

test('Team verification rejects a stale nested PostgreSQL symlink manifest before Host consumption', async () => {
  const f=await fixture();
  try {
    await mkdir(path.join(f.prefix,'postgres/lib'),{recursive:true});
    const inner={format:'hima-postgres-runtime/1',version:'16.15',platform,source:{sha256:'c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed'},files:{'lib/libpq.dylib':'symlink:libpq.5.dylib'}};
    await writeFile(path.join(f.prefix,'postgres/lib/libpq.dylib'),'flattened library');
    await writeFile(path.join(f.prefix,'postgres/postgres-runtime.json'),JSON.stringify(inner));
    Object.assign(f.manifest.files,{'postgres/lib/libpq.dylib':sha('flattened library'),'postgres/postgres-runtime.json':sha(JSON.stringify(inner))});
    f.manifest.components.push({id:'postgres',version:'16.15',source:'https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2',license:'PostgreSQL',requiredFiles:['postgres/postgres-runtime.json'],notices:['NOTICE']});
    await f.seal();
    await assert.rejects(verifyTeamRuntime(f.prefix),/PostgreSQL inner.*differs/);
    inner.files['lib/libpq.dylib']=sha('flattened library');
    await writeFile(path.join(f.prefix,'postgres/postgres-runtime.json'),JSON.stringify(inner));
    f.manifest.files['postgres/postgres-runtime.json']=sha(JSON.stringify(inner));await f.seal();
    await verifyTeamRuntime(f.prefix);
    await writeFile(path.join(f.prefix,'postgres/lib/added-helper'),'untracked inner helper');
    Object.assign(f.manifest.files,{'postgres/lib/added-helper':sha('untracked inner helper')});await f.seal();
    await assert.rejects(verifyTeamRuntime(f.prefix),/PostgreSQL inner.*missing/);
  } finally {await rm(f.directory,{recursive:true,force:true});}
});

test('native Python service and admin require explicit bytecode suppression before module execution', async () => {
  const f=await fixture();
  try {
    await mkdir(path.join(f.prefix,'python/bin'),{recursive:true});
    await writeFile(path.join(f.prefix,'python/bin/python3.12'),'fixture Python executable');
    f.manifest.files['python/bin/python3.12']=sha('fixture Python executable');
    const service=f.manifest.services[0]!;service.executable='python/bin/python3.12';service.backupExecutable=service.executable;
    service.argv=['-I','-m','hindsight_api.main'];service.backupArgv=['-I','-B','-m','hindsight_api.admin.cli'];await f.seal();
    await assert.rejects(verifyTeamRuntime(f.prefix),/Python.*-B/);
    service.argv=['-I','-B','-m','hindsight_api.main'];service.backupArgv=['-I','-m','hindsight_api.admin.cli'];await f.seal();
    await assert.rejects(verifyTeamRuntime(f.prefix),/Python.*-B/);
    service.backupArgv=['-I','-m','hindsight_api.admin.cli','-B'];await f.seal();
    await assert.rejects(verifyTeamRuntime(f.prefix),/Python.*-B/);
    service.backupArgv=['-I','-B','-m','hindsight_api.admin.cli'];await f.seal();
    await verifyTeamRuntime(f.prefix);
  } finally {await rm(f.directory,{recursive:true,force:true});}
});

const retained = process.env.HIMA_TEAM_RUNTIME_QUALIFICATION_PREFIX;
test('retained native qualification closure assembles with the product pin', {skip: !retained ? 'explicit retained qualification input not supplied' : false}, async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'hima-team-retained-'));
  try {
    const receipt=await packageTeamRuntime({prefix:retained,output:path.join(directory,'team-runtime'),pinFile:path.join(repoRoot,'packages/desktop/team-runtime.pin.json'),internalCandidate:true});
    assert.equal(receipt.platform,'darwin-arm64');assert.equal(receipt.fileCount,52535);
    const currentPin=JSON.parse(await readFile(path.join(repoRoot,'packages/desktop/team-runtime.pin.json'),'utf8')).platformAssets['darwin-arm64'];
    assert.equal(receipt.manifestSha256,currentPin.manifestSha256);
    assert.equal(receipt.inventorySha256,currentPin.inventorySha256);
    assert.ok(receipt.releaseBlockers.some((v:string)=>/sandbox/.test(v)));
  } finally {await rm(directory,{recursive:true,force:true});}
});
