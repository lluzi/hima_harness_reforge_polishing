// Assemble already retained native Team assets. No network/package-manager/VM operations.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { readTeamRuntimeManifest } from '../packages/harness/lib/team-service-runtime.js';
import { hashFile } from './package-native-audit.mjs';
const fail = message => { throw new Error(`package-team-runtime: ${message}`); };
export async function verifyTeamRuntime(directory, expected) {
  const manifest = await readTeamRuntimeManifest(directory);
  for (const service of manifest.services) for (const [executable, argv] of [[service.executable, service.argv], [service.backupExecutable, service.backupArgv]]) {
    if (!executable || !/^python(?:\d+(?:\.\d+)*)?$/.test(path.basename(executable))) continue;
    const moduleIndex = (argv ?? []).indexOf('-m');
    if (moduleIndex < 0 || !(argv ?? []).slice(0, moduleIndex).includes('-I') || !(argv ?? []).slice(0, moduleIndex).includes('-B')) fail('Native Python service/admin must use explicit -I -B before -m; isolated Python ignores PYTHONDONTWRITEBYTECODE');
  }
  const postgres = manifest.components.find(component => component.id === 'postgres');
  if (postgres) {
    const inner = JSON.parse(readFileSync(path.join(directory, 'postgres/postgres-runtime.json'), 'utf8'));
    if (inner.format !== 'hima-postgres-runtime/1' || inner.version !== postgres.version || inner.platform !== manifest.platform || !inner.files) fail('PostgreSQL inner manifest identity differs from Team assets');
    for (const [file, expectedHash] of Object.entries(inner.files)) {
      if (path.isAbsolute(file) || file.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || manifest.files[`postgres/${file}`] !== expectedHash) fail(`PostgreSQL inner manifest bytes/layout differs: ${file}`);
    }
    for (const file of Object.keys(manifest.files)) if (file.startsWith('postgres/') && file !== 'postgres/postgres-runtime.json' && !inner.files[file.slice('postgres/'.length)]) fail(`PostgreSQL inner manifest is missing helper: ${file}`);
  }
  if (expected && (expected.platform !== manifest.platform || expected.manifestSha256 !== hashFile(path.join(directory, 'team-runtime.json')))) fail('Team runtime identity differs from the release manifest');
  return manifest;
}
export async function packageTeamRuntime({ prefix, output, pinFile, internalCandidate = false }) {
  const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
  if (pin.format !== 'hima-team-runtime/1' || pin.noImplicitDownloads !== true) fail('unsupported fixed asset catalog');
  if (!['fixed-deployment-assets', 'retained-assets-partial'].includes(pin.qualification)) fail('fixed deployment hashes/closure are unavailable in the source-only catalog; retain actual platform assets first');
  const platform = `${process.platform}-${process.arch}`;
  const closure = pin.platformAssets?.[platform];
  if (!closure?.manifestSha256 || closure.qualification !== 'asset-assembly-only') fail(`no fixed ${platform} deployment closure: ${(closure?.missing ?? ['retain and qualify matching native assets']).join('; ')}`);
  const releaseBlockers = closure.releaseBlockers ?? [];
  if (!internalCandidate && (pin.qualification !== 'fixed-deployment-assets' || releaseBlockers.length)) fail(`Team distribution is not qualified: ${releaseBlockers.join('; ') || 'complete and approve the five-component deployment cohort'}. Use --internal-candidate only for bounded asset qualification.`);
  const root = realpathSync(prefix);
  const destination = path.resolve(output);
  if (destination === root || destination.startsWith(root + path.sep)) fail('destination must be outside the source asset closure');
  if (existsSync(destination)) fail('destination already exists; use a new assembly directory');
  const manifestFile = path.join(root, 'team-runtime.json');
  if (!existsSync(manifestFile) || lstatSync(manifestFile).isSymbolicLink() || hashFile(manifestFile) !== closure.manifestSha256) fail('retained manifest hash differs from the fixed platform closure');
  const manifest = await verifyTeamRuntime(root);
  if (manifest.qualification !== 'asset-assembly-only') fail('test process assets cannot enter a product distribution');
  if (!Array.isArray(closure.requiredComponents) || !closure.requiredComponents.length || new Set(closure.requiredComponents).size !== closure.requiredComponents.length) fail('fixed platform component identities are missing or duplicate');
  const inventorySha256 = createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex');
  if (inventorySha256 !== closure.inventorySha256 || Object.keys(manifest.files).length !== closure.fileCount) fail('asset inventory differs from the fixed platform closure');
  if (!isDeepStrictEqual(manifest.engineeringEngine, closure.engineeringEngine)) fail('engineering engine metadata differs from fixed platform closure');
  if (!isDeepStrictEqual(manifest.services, closure.services)) fail('service entry points differ from the fixed platform closure');
  if (manifest.components.length !== closure.requiredComponents.length) fail('platform component cohort differs');
  for (const id of closure.requiredComponents) {
    const fixed = pin.components.find(c => c.id === id); const actual = manifest.components.find(c => c.id === id);
    if (!actual || !fixed || actual.version !== fixed.version || actual.source !== fixed.source || actual.license !== fixed.license) fail(`missing or unpinned ${id} deployment identity`);
    const pinnedFiles = fixed.platformAssets?.[platform]?.files;
    if (!pinnedFiles || !Object.keys(pinnedFiles).length) fail(`missing fixed ${id} platform hashes`);
    if (JSON.stringify(actual.requiredFiles) !== JSON.stringify(fixed.requiredFiles) || JSON.stringify(actual.notices) !== JSON.stringify(fixed.notices)) fail(`${id} helper/notice obligations differ`);
    for (const file of [...actual.requiredFiles, ...actual.notices]) if (!pinnedFiles[file] || manifest.files[file] !== pinnedFiles[file]) fail(`${id} deployed file is not bound to the fixed platform assets: ${file}`);
  }
  const inventory = new Set(Object.keys(manifest.files)); inventory.add('team-runtime.json');
  const inspect = directory => { for (const name of readdirSync(directory)) {
    const file = path.join(directory, name); const info = lstatSync(file);
    if (info.isSymbolicLink() || !realpathSync(file).startsWith(root + path.sep)) fail('asset closure contains a symlink/escape');
    if (info.isDirectory()) inspect(file);
    else if (!info.isFile() || !inventory.has(path.relative(root, file).split(path.sep).join('/'))) fail('asset closure contains an unpinned file');
  }};
  inspect(root);
  mkdirSync(path.dirname(destination), { recursive: true });
  try {
    cpSync(root, destination, { recursive: true, mode: constants.COPYFILE_FICLONE });
    await verifyTeamRuntime(destination, { platform, manifestSha256: closure.manifestSha256 });
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
  return { file: 'team-runtime/team-runtime.json', platform, manifestSha256: closure.manifestSha256,
    engineeringQualification: manifest.engineeringEngine?.image.qualification ?? 'not-installed',
    inventorySha256, fileCount: closure.fileCount, pinSha256: hashFile(pinFile), releaseBlockers,
    qualification: 'asset-assembly-only; actual native service/install qualification separate' };
}

/** Existing retained-asset seam: assemble a verified SDK OCI before sealing a new private closure.
 * Original prefix/pin are never modified. This is an internal candidate, not member readiness. */
export async function packageTeamMemberRuntime({prefix,output,pinFile,imageInputs,publishedPinFile,internalCandidate=false}) {
  if(!internalCandidate)fail('member SDK staging is internal-only until platform, source/NOTICE and isolation qualification');
  if(existsSync(publishedPinFile))fail('published pin already exists; preserve the previous identity');
  const pinDestination=path.resolve(publishedPinFile),rootDestination=path.resolve(output);
  const sourceRoot=realpathSync(prefix),pinActual=path.join(realpathSync(path.dirname(pinDestination)),path.basename(pinDestination));
  if(pinActual===sourceRoot||pinActual.startsWith(sourceRoot+path.sep))fail('published pin must not mutate the retained source prefix');
  if(pinDestination===rootDestination||pinDestination.startsWith(rootDestination+path.sep))fail('published pin must stay outside the immutable runtime closure');
  await packageTeamRuntime({prefix,output,pinFile,internalCandidate:true});
  const manifest=JSON.parse(readFileSync(path.join(output,'team-runtime.json'),'utf8'));
  if(!manifest.engineeringEngine)fail('member SDK requires the fixed private engine closure');
  const {assembleTeamMemberImage}=await import('./assemble-team-member-image.mjs');
  const imageFile='engine/member-sdk.oci.tar',receiptFile='engine/member-sdk-receipt.json',sourcesFile='engine/member-sdk-sources.json';
  const imageDestination=path.join(output,imageFile);
  const assemblyDestination=existsSync(imageDestination)?path.join(output,'engine/member-sdk.next.oci.tar'):imageDestination;
  const receipt=await assembleTeamMemberImage({...imageInputs,output:assemblyDestination,internalCandidate:true});
  if(receipt.memberReady!==false||receipt.platform.os!=='linux'||receipt.platform.architecture!==(manifest.engineeringEngine.guestPlatform==='linux-arm64'?'arm64':'amd64'))fail('SDK assembly target/readiness differs');
  const sourceBytes=readFileSync(imageInputs.sourceManifestFile);
  if(createHash('sha256').update(sourceBytes).digest('hex')!==receipt.sourceManifestSha256)fail('SDK source provenance changed before staging');
  const {writeFileSync}=await import('node:fs');
  writeFileSync(path.join(output,receiptFile),JSON.stringify(receipt));writeFileSync(path.join(output,sourcesFile),sourceBytes);
  const oldImage=manifest.engineeringEngine.image.file;
  if(oldImage!==imageFile){delete manifest.files[oldImage];rmSync(path.join(output,oldImage));}
  if(assemblyDestination!==imageDestination)renameSync(assemblyDestination,imageDestination);
  manifest.engineeringEngine.image={file:imageFile,sha256:receipt.archiveSha256,bytes:receipt.archiveSize,manifestSha256:receipt.manifestDigest.replace(/^sha256:/,''),configSha256:receipt.configDigest.replace(/^sha256:/,''),layers:receipt.layers.map(layer=>({sha256:layer.digest.replace(/^sha256:/,''),bytes:layer.size})),qualification:'trusted-fixture-only'};
  for(const file of [imageFile,receiptFile,sourcesFile])manifest.files[file]=hashFile(path.join(output,file));
  const engine=manifest.components.find(component=>component.id==='engineering-engine');
  engine.requiredFiles=[...new Set(engine.requiredFiles.filter(file=>![oldImage,imageFile,receiptFile,sourcesFile].includes(file)).concat(imageFile,receiptFile,sourcesFile))];
  const manifestBytes=JSON.stringify(manifest);writeFileSync(path.join(output,'team-runtime.json'),manifestBytes);
  const next=JSON.parse(readFileSync(pinFile,'utf8')),platform=manifest.platform,closure=next.platformAssets[platform];
  const fixed=next.components.find(component=>component.id==='engineering-engine');
  fixed.requiredFiles=engine.requiredFiles;fixed.platformAssets[platform].files=Object.fromEntries([...engine.requiredFiles,...engine.notices].map(file=>[file,manifest.files[file]]));
  Object.assign(closure,{engineeringEngine:manifest.engineeringEngine,manifestSha256:hashFile(path.join(output,'team-runtime.json')),inventorySha256:createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex'),fileCount:Object.keys(manifest.files).length});
  if(!closure.releaseBlockers?.length)fail('SDK asset assembly must retain installation/rights/isolation release blockers');
  await verifyTeamRuntime(output,{platform,manifestSha256:closure.manifestSha256});
  const declared=new Set([...Object.keys(manifest.files),'team-runtime.json']);
  const check=directory=>{for(const name of readdirSync(directory)){const file=path.join(directory,name),info=lstatSync(file);if(info.isSymbolicLink())fail('staged closure contains a symlink');if(info.isDirectory())check(file);else if(!info.isFile()||!declared.has(path.relative(output,file).split(path.sep).join('/')))fail('staged closure contains an unpinned file');}};check(output);
  writeFileSync(publishedPinFile,JSON.stringify(next,null,2)+'\n',{flag:'wx'});
  return {format:'hima-team-member-runtime-stage/1',memberReady:false,platform,manifestSha256:closure.manifestSha256,inventorySha256:closure.inventorySha256,fileCount:closure.fileCount,memberImage:receipt,releaseBlockers:closure.releaseBlockers};
}
