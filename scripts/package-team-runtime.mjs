// Assemble already retained native Team assets. No network/package-manager/VM operations.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { readTeamRuntimeManifest } from '../packages/harness/src/team-service-runtime.ts';
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
    inventorySha256, fileCount: closure.fileCount, pinSha256: hashFile(pinFile), releaseBlockers,
    qualification: 'asset-assembly-only; actual native service/install qualification separate' };
}
