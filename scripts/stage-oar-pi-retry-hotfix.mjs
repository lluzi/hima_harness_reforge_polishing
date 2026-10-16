// Offline development-asset hotfix for the fixed OAR 0.46.0 Pi projection.
// This does not qualify or package the Team distribution (#110 remains HOLD).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const command = promisify(execFile);
const baseSha256 = 'b7ed927881029226f47c6d992043d5d76e368b9885bfc2fc1d8c5af53a5b8acc';
const projectionSha256 = '2dbb2ea0e1722ba3f7d3858e7983f78d38c858990a0d4120c8222ca9871cbcb1';
const patchSha256 = 'f2e4d53d7e5515163d5fcd5bef49878536fbdd4bf7dbb6dbc51d7c51e4d41469';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => file.startsWith(root + path.sep);
async function retained(root, expected) {
  const module = await fs.realpath(path.join(root, 'node_modules/@botiverse/oar/dist/index.js'));
  if (!inside(root, module)) throw Error('OAR entry must resolve inside its retained npm closure');
  const packageRoot = path.dirname(path.dirname(module));
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (metadata.name !== '@botiverse/oar' || metadata.version !== '0.46.0') throw Error('Expected fixed @botiverse/oar 0.46.0');
  const projection = await fs.realpath(path.join(packageRoot, 'dist/runtimes/pi/projection.js'));
  if (!inside(root, projection) || hash(await fs.readFile(projection)) !== expected) throw Error('Fixed OAR projection SHA256 differs');
  return { module, packageRoot, projection };
}
export async function stageOarPiRetryHotfix({ source, target }) {
  if (!path.isAbsolute(source) || !path.isAbsolute(target)) throw Error('Use absolute retained source and fresh target paths');
  const root = await fs.realpath(source);
  // Resolve the existing parent before touching anything, including symlink aliases.
  const parent = await fs.realpath(path.dirname(target)), destination = path.join(parent, path.basename(target));
  if (destination === root || inside(root, destination) || inside(destination, root)) throw Error('Target must be outside the source closure');
  try { await fs.lstat(destination); throw Error('Target already exists; choose a fresh asset directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const original = await retained(root, baseSha256);
  const patchFile = fileURLToPath(new URL('../patches/oar-0.46.0-pi-retry.patch', import.meta.url));
  if (hash(await fs.readFile(patchFile)) !== patchSha256) throw Error('Hotfix patch SHA256 differs');
  await fs.mkdir(destination, { mode: 0o700 }); // Exclusive reservation; never copy into another writer's target.
  // Preserve the complete pnpm-relative dependency closure without installs or downloads.
  await command('/bin/cp', [process.platform === 'darwin' ? '-cR' : '-R', root + '/.', destination]);
  const copy = await retained(destination, baseSha256);
  await command('/usr/bin/patch', ['--batch', '--forward', '-p1', '-d', copy.packageRoot, '-i', patchFile]);
  const patched = await retained(destination, projectionSha256);
  await retained(root, baseSha256); // The retained original must remain unchanged.
  const receipt = { schema: 'hima.oar-pi-retry-hotfix/1', qualification: 'development-asset-hotfix-only',
    baseVersion: '0.46.0', source: root, sourceModule: original.module, target: destination,
    module: patched.module, baseProjectionSha256: baseSha256, patchSha256, projectionSha256,
    projection: patched.projection, createdAt: new Date().toISOString() };
  await fs.writeFile(path.join(destination, 'hima-oar-pi-retry-hotfix.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, target, ...extra] = process.argv.slice(2);
  if (!source || !target || extra.length) throw Error('Usage: node scripts/stage-oar-pi-retry-hotfix.mjs ABS_RETAINED_NPM ABS_FRESH_TARGET');
  console.log(JSON.stringify(await stageOarPiRetryHotfix({ source, target })));
}
