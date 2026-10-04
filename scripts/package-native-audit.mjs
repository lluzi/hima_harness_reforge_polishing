// Packaging-owned platform layout and inventory of the bytes actually shipped. No installer/runtime.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
export function hashFile(file) {
  const input = openSync(file, 'r');
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let length;
    while ((length = readSync(input, buffer, 0, buffer.length, null)) !== 0) digest.update(buffer.subarray(0, length));
    return digest.digest('hex');
  } finally { closeSync(input); }
}
function nativeHeader(file) {
  const input = openSync(file, 'r');
  const buffer = Buffer.alloc(4);
  try { const length = readSync(input, buffer, 0, 4, 0); return buffer.subarray(0, length).toString('hex'); }
  finally { closeSync(input); }
}

const fail = message => { throw new Error(`package-native: ${message}`); };
export function nativeLayout(platform) {
  if (platform === 'darwin-arm64' || platform === 'macos-arm64') return {
    platform: 'darwin-arm64', artifact: 'HimaHarness.app', resource: 'Contents/Resources/app', executable: 'Contents/MacOS/HimaHarness', signing: 'ad-hoc, not notarized',
    baseline: 'macOS arm64; current native PostgreSQL build host macOS 26.5.2; lower OS versions unqualified; actual install qualification separate',
  };
  if (platform === 'linux-x64') return {
    platform, artifact: 'HimaHarness', resource: 'resources/app', executable: 'HimaHarness', signing: 'unsigned native Linux directory',
    baseline: 'Ubuntu 22.04 x64, glibc 2.35; desktop display and Electron sandbox support required; actual install qualification separate',
  };
  fail(`unsupported native target ${platform}; use darwin-arm64 or linux-x64`);
}
function walk(base, action, current = base) {
  for (const name of readdirSync(current).sort()) {
    const file = path.join(current, name); const info = lstatSync(file);
    if (info.isDirectory()) walk(base, action, file);
    else if (info.isFile()) action(file, path.relative(base, file).split(path.sep).join('/'));
  }
}
// otool interprets a trailing "(name)" as an archive member even in an exact argv.
// A plain-name symlink lets it inspect the same original bytes without renaming the bundle.
function inspectMachO(file, flag) {
  if (!file.endsWith(')')) return spawnSync('otool', [flag, file], { encoding: 'utf8' });
  const directory = mkdtempSync(path.join(tmpdir(), 'hima-native-audit-'));
  const alias = path.join(directory, 'object');
  try {
    symlinkSync(realpathSync(file), alias);
    const result = spawnSync('otool', [flag, alias], { encoding: 'utf8' });
    return { ...result, stdout: (result.stdout ?? '').replaceAll(alias, file), stderr: (result.stderr ?? '').replaceAll(alias, file) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export function stageRuntimeNotices({ resource, electronDist, nodeBinary, nodeManifest, nodeArchive, electronManifest, electronArchive }) {
  const target = `${process.platform}-${process.arch}`;
  const nodeRoot = path.dirname(path.dirname(realpathSync(nodeBinary)));
  const node = JSON.parse(readFileSync(nodeManifest, 'utf8'));
  const actualVersion = spawnSync(nodeBinary, ['--version'], { encoding: 'utf8' });
  if (actualVersion.status !== 0 || actualVersion.stdout.trim() !== `v${node.version}` || !/^24\./.test(node.version)
    || !/^https:\/\/nodejs.org\/dist\/v24\.[^/]+\/node-v24\.[^/]+-(darwin-arm64\.tar\.gz|linux-x64\.tar\.xz)$/.test(node.source)
    || !node.source.endsWith(`-${target}.tar.${process.platform === 'darwin' ? 'gz' : 'xz'}`)
    || !/^[a-f0-9]{64}$/.test(node.sha256) || hashFile(nodeArchive) !== node.sha256) fail('Node archive/version/source identity differs from the fixed official distribution');
  // Bind selected binary and notice to the retained archive, not merely its version string.
  for (const relative of ['bin/node', 'LICENSE']) {
    const member = path.basename(node.source).replace(/\.tar\.(gz|xz)$/, '') + '/' + relative;
    const archived = spawnSync('tar', ['-xOf', nodeArchive, member], { maxBuffer: 256 * 1024 * 1024 });
    if (archived.status !== 0 || createHash('sha256').update(archived.stdout).digest('hex') !== hashFile(path.join(nodeRoot, relative))) fail(`Node ${relative} differs from its official archive`);
  }
  const electron = JSON.parse(readFileSync(electronManifest, 'utf8'));
  const expectedElectronUrl = `https://github.com/electron/electron/releases/download/v${electron.version}/electron-v${electron.version}-${target}.zip`;
  if (electron.version !== '44.2.0' || electron.source !== expectedElectronUrl || !/^[a-f0-9]{64}$/.test(electron.sha256) || hashFile(electronArchive) !== electron.sha256) fail('Electron archive/source identity differs from the pinned target distribution');
  const electronFiles = process.platform === 'darwin'
    ? ['Electron.app/Contents/MacOS/Electron', 'Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework', 'LICENSE', 'LICENSES.chromium.html']
    : ['electron', 'libffmpeg.so', 'LICENSE', 'LICENSES.chromium.html'];
  for (const member of electronFiles) {
    const archived = spawnSync('unzip', ['-p', electronArchive, member], { maxBuffer: 512 * 1024 * 1024 });
    if (archived.status !== 0 || createHash('sha256').update(archived.stdout).digest('hex') !== hashFile(path.join(electronDist, member))) fail(`Electron ${member} differs from its pinned upstream archive`);
  }
  const notices = path.join(resource, 'third-party'); mkdirSync(notices, { recursive: true });
  for (const [from, to] of [[path.join(nodeRoot, 'LICENSE'), 'NODE-LICENSE'],
    [path.join(electronDist, 'LICENSE'), 'ELECTRON-LICENSE'], [path.join(electronDist, 'LICENSES.chromium.html'), 'CHROMIUM-LICENSES.html']]) {
    if (!existsSync(from)) fail(`required upstream notice missing: ${from}`);
    cpSync(from, path.join(notices, to));
  }
  return { version: node.version, platform: `${process.platform}-${process.arch}`, binarySha256: hashFile(nodeBinary),
    source: { url: node.source, sha256: node.sha256 }, license: 'third-party/NODE-LICENSE', electron: { version: electron.version, source: { url: electron.source, sha256: electron.sha256 } } };
}
export function auditDistribution({ app, resource, lockfile, electronVersion, noticeMaterials }) {
  const npm = []; const links = []; const foreignNative = []; const unresolved = []; const packages = new Set();
  const material = noticeMaterials ? JSON.parse(readFileSync(noticeMaterials, 'utf8')) : undefined;
  if (material && (material.format !== 'hima-notice-materials/1' || !Array.isArray(material.packages))) fail('notice materials must use hima-notice-materials/1 with package-bound source integrity');
  const lock = parse(readFileSync(lockfile, 'utf8'));
  const lockPackages = lock.packages ?? {};
  const notices = path.join(resource, 'third-party'); mkdirSync(notices, { recursive: true });
  walk(path.join(resource, 'node_modules'), (file, relative) => {
    if (path.basename(file) !== 'package.json') return;
    const metadata = JSON.parse(readFileSync(file, 'utf8'));
    // Only npm package roots, not package.json fixtures/examples nested in a dependency.
    const folder = path.dirname(file);
    if (!/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/.test(folder.split(path.sep).join('/')) || !metadata.name || !metadata.version) return;
    const canonical = realpathSync(folder); if (packages.has(canonical)) return; packages.add(canonical);
    const licenseFiles = [];
    for (const name of readdirSync(folder).sort()) {
      const at = path.join(folder, name);
      if (lstatSync(at).isFile() && /^(?:licen[cs]e|copying|copyright|notice)(?:$|[._-])/i.test(name)) {
        licenseFiles.push({ file: path.relative(resource, at).split(path.sep).join('/'), sha256: hashFile(at) });
      }
    }
    if (!licenseFiles.length) {
      for (const name of readdirSync(folder).filter(name => /^readme(?:\.|$)/i.test(name))) {
        const file = path.join(folder, name); if (!lstatSync(file).isFile()) continue;
        const text = readFileSync(file, 'utf8');
        if (/copyright/i.test(text) && /permission is hereby granted/i.test(text) && /THE SOFTWARE IS PROVIDED/i.test(text) && /LIABILITY|LIABLE/i.test(text)) licenseFiles.push({ file: path.relative(resource, file).split(path.sep).join('/'), sha256: hashFile(file), role: 'full MIT copyright, grant and disclaimer embedded in shipped README' });
      }
    }
    const key = `${metadata.name}@${metadata.version}`;
    const resolution = lockPackages[key]?.resolution;
    const license = typeof metadata.license === 'string' ? metadata.license : metadata.license?.type ?? 'UNDECLARED';
    const row = { name: metadata.name, version: metadata.version, path: path.relative(resource, folder).split(path.sep).join('/'),
      packageJsonSha256: hashFile(file), license, licenseFiles, source: resolution ?? (metadata.name.startsWith('@hima/') ? { type: 'workspace', qualification: 'source SHA in candidate manifest' } : { qualification: 'UNRESOLVED lock resolution' }) };
    const supplemental = material?.packages.find(entry => entry.name === metadata.name && entry.version === metadata.version);
    if (supplemental) {
      if (supplemental.npmIntegrity !== resolution?.integrity || !Array.isArray(supplemental.files) || !supplemental.files.length) fail(`supplemental notices do not match actual npm source ${key}`);
      row.supplementalLicenseFiles = supplemental.files.map(entry => {
        if (typeof entry.file !== 'string' || path.isAbsolute(entry.file) || entry.file.split(/[\\/]/).includes('..') || !/^https:\/\//.test(entry.url ?? '')) fail(`invalid upstream notice reference for ${key}`);
        const input = path.resolve(path.dirname(noticeMaterials), entry.file);
        if (!realpathSync(input).startsWith(realpathSync(path.dirname(noticeMaterials)) + path.sep) || !lstatSync(input).isFile() || hashFile(input) !== entry.sha256) fail(`upstream notice bytes differ for ${key}: ${entry.file}`);
        const output = path.join(notices, 'upstream', metadata.name.replace(/[^a-zA-Z0-9.-]/g, '_') + '-' + metadata.version, entry.file);
        mkdirSync(path.dirname(output), { recursive: true }); cpSync(input, output);
        return { file: path.relative(resource, output).split(path.sep).join('/'), sha256: entry.sha256, source: entry.url, ...(entry.purpose ? { purpose: entry.purpose } : {}) };
      });
    }
    if (metadata.name.startsWith('@img/sharp-libvips-') && existsSync(path.join(folder, 'versions.json'))) {
      row.embeddedComponentVersions = JSON.parse(readFileSync(path.join(folder, 'versions.json'), 'utf8'));
      row.embeddedVersionFile = { file: path.relative(resource, path.join(folder, 'versions.json')).split(path.sep).join('/'), sha256: hashFile(path.join(folder, 'versions.json')) };
      unresolved.push(`${key} at ${row.path}/lib: LGPL native binary and embedded libraries require exact upstream license/copyright disclosures, corresponding-source/build material, and verified library replacement or relinking terms before commercial distribution`);
    }
    npm.push(row);
    if (!resolution?.integrity && !metadata.name.startsWith('@hima/')) unresolved.push(`${key} at ${row.path}/package.json: no pinned npm source integrity in lockfile`);
    if (((!licenseFiles.length && !row.supplementalLicenseFiles?.length) || license === 'UNDECLARED') && !metadata.name.startsWith('@hima/')) unresolved.push(`${key} at ${row.path}: ${!licenseFiles.length && !row.supplementalLicenseFiles?.length ? 'no standalone license/notice file; inspect upstream distribution terms' : 'license undeclared'}`);
  });
  walk(app, (file, relative) => {
    // Header inspection avoids reading an entire Electron executable just to recognize it.
    const header = nativeHeader(file);
    if (!['7f454c46', 'cffaedfe', 'feedfacf', 'cafebabe'].includes(header)) return;
    const architecture = spawnSync('file', ['-b', file], { encoding: 'utf8' });
    const formatMatches = process.platform === 'darwin' ? header !== '7f454c46' : header === '7f454c46';
    const targetMatches = (architecture.stdout ?? '').includes(process.arch === 'arm64' ? 'arm64' : 'x86-64');
    if (!formatMatches || !targetMatches) {
      foreignNative.push({ file: relative, architecture: (architecture.stdout ?? '').trim(), qualification: 'shipped upstream prebuild for another OS/architecture; not a target runtime dependency; dynamic links not audited here' });
      return;
    }
    if (process.platform === 'linux') {
      const elf = spawnSync('readelf', ['-d', '-l', file], {encoding:'utf8'});
      if (elf.status !== 0) fail(`ELF ABI inspection failed for ${relative}: ${elf.stderr ?? ''}`);
      const musl = /ld-musl|Shared library: \[(?:libc\.so|libc\.musl-[^\]]+)\]/.test(elf.stdout ?? '');
      if (musl) {
        foreignNative.push({file:relative,architecture:(architecture.stdout ?? '').trim(),abi:'musl',
          qualification:'upstream musl prebuild retained; Ubuntu glibc target selects its separate glibc binary; not a target runtime link qualification'});
        return;
      }
    }
    const tool = process.platform === 'darwin' ? 'otool' : 'ldd';
    const inspected = process.platform === 'darwin' ? inspectMachO(file, '-L') : spawnSync(tool, [file], { encoding: 'utf8' });
    const output = `${inspected.stdout ?? ''}${inspected.stderr ?? ''}`.trim();
    if (inspected.status !== 0 && !/not a dynamic executable|statically linked/.test(output)) fail(`native dependency audit failed for ${relative}: ${output}`);
    const ownIds = process.platform === 'darwin' ? (inspectMachO(file, '-D').stdout ?? '').split('\n').map(line => line.trim()).filter(line => line && !line.endsWith(':')) : [];
    const externalOutput = output.replaceAll(app, '<bundle>').split('\n').filter(line => !line.endsWith(':') && !ownIds.includes(line.trim().split(' (')[0])).join('\n');
    if (/not found|\/opt\/homebrew\/|\/usr\/local\/|\/Users\/|\/work\//.test(externalOutput)) fail(`native dependency escapes distribution or OS baseline: ${relative}: ${output}`);
    links.push({ file: relative, finalByteHash: 'candidate manifest files inventory (after signing)', tool, linked: output.split('\n'), ...(ownIds.length ? { machoInstallIds: ownIds } : {}), classification: 'bundled libraries and platform OS libraries; system libraries are not redistributed' });
  });
  // Check the final tree after every package has staged its notices: an earlier record
  // must never describe bytes subsequently replaced by another supplemental copy.
  for (const row of npm) {
    for (const entry of row.supplementalLicenseFiles ?? []) {
      const file = path.join(resource, entry.file);
      if (!lstatSync(file).isFile() || hashFile(file) !== entry.sha256) fail(`staged upstream notice bytes differ for ${row.name}@${row.version}: ${entry.file}`);
    }
  }
  const sbom = { format: 'hima-distribution-sbom/1', scope: 'actual deployed npm package roots, bundled Node/PostgreSQL/Electron notices, and native dynamic-link inventory; not source-only or external Site tools',
    platform: `${process.platform}-${process.arch}`, npmLockSha256: hashFile(lockfile), ...(noticeMaterials ? { noticeMaterialsSha256: hashFile(noticeMaterials) } : {}), npm: npm.sort((a, b) => a.path.localeCompare(b.path)), nativeLinks: links, foreignNative,
    electron: { version: electronVersion, source: `https://github.com/electron/electron/releases/tag/v${electronVersion}`, license: 'third-party/ELECTRON-LICENSE', chromium: 'third-party/CHROMIUM-LICENSES.html' },
    unresolved, qualification: unresolved.length ? 'distribution terms require review of enumerated missing notices; no legal clearance claim' : 'inventory complete for stated scope; no legal clearance claim' };
  writeFileSync(path.join(notices, 'SBOM.json'), `${JSON.stringify(sbom, null, 2)}\n`);
  writeFileSync(path.join(notices, 'THIRD_PARTY_NOTICES.md'), `# HimaHarness candidate dependency notices\n\nThis inventory covers the actual deployed bytes. Retain NODE-LICENSE (including Node bundled dependencies), ELECTRON-LICENSE, CHROMIUM-LICENSES.html, postgres/COPYRIGHT and the npm package notice files listed in SBOM.json.\n\nNpm components: ${npm.length}. Target native objects inspected: ${links.length}. Foreign upstream prebuilds inventoried without link qualification: ${foreignNative.length}.\n\n${npm.map(row => `- ${row.name}@${row.version}: ${row.license}; ${[...row.licenseFiles, ...(row.supplementalLicenseFiles ?? [])].map(file => file.file).join(', ') || 'notice review required'}`).join('\n')}\n\n## Unresolved distribution review\n\n${unresolved.join('\n') || 'No missing standalone npm notice detected. This is not legal clearance.'}\n`);
  return { file: 'third-party/SBOM.json', sha256: hashFile(path.join(notices, 'SBOM.json')), npmComponents: npm.length, nativeObjects: links.length, foreignNativeObjects: foreignNative.length, unresolved };
}

/** Retain license-required source/patch/build bytes beside the actual native distribution. */
export function stageCorrespondingSource({ resource, sourceMaterials }) {
  if (!sourceMaterials) return { status:'not supplied; corresponding-source obligations remain unqualified' };
  const base = realpathSync(path.dirname(sourceMaterials));
  const bytes = readFileSync(sourceMaterials);
  const manifest = JSON.parse(bytes);
  const inventory = JSON.parse(readFileSync(path.join(resource, 'third-party/SBOM.json'), 'utf8'));
  if (manifest.format !== 'hima-corresponding-source/1' || !Array.isArray(manifest.files) || !manifest.files.length
      || manifest.components?.electron !== inventory.electron.version
      || inventory.npm.some(component => component.name.startsWith('@img/sharp-libvips-') && component.version !== manifest.components?.sharpLibvips)) fail('corresponding source does not identify the actual native components');
  const target = path.join(resource, 'third-party/corresponding-source');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (typeof entry.file !== 'string' || !entry.file || path.isAbsolute(entry.file) || entry.file.split(/[\\/]/).includes('..')
        || seen.has(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('invalid corresponding source inventory');
    seen.add(entry.file);
    const input = path.resolve(base, entry.file);
    if (!realpathSync(input).startsWith(base + path.sep) || !lstatSync(input).isFile() || hashFile(input) !== entry.sha256) fail(`corresponding source bytes differ: ${entry.file}`);
    const output = path.join(target, entry.file);
    mkdirSync(path.dirname(output), { recursive:true }); cpSync(input, output);
  }
  writeFileSync(path.join(target, 'manifest.json'), bytes);
  return { status:'source materials retained; actual modified-library rebuild/replacement evidence remains separate',
    file:'third-party/corresponding-source/manifest.json', sha256:createHash('sha256').update(bytes).digest('hex'), files:manifest.files.length };
}
