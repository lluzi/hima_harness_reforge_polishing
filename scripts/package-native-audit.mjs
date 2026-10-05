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

// Compare only the already admitted ad-hoc route: body and signing policy, not
// incidental signature bytes. No codesign invocation or artifact mutation.
function adHocBody(file) {
  const bytes = Buffer.from(readFileSync(file));
  if (bytes.readUInt32LE(0) !== 0xfeedfacf) fail(`evidence bridge needs a thin Mach-O: ${file}`);
  let command = 32; let signature;
  for (let index = 0; index < bytes.readUInt32LE(16); index++) {
    const size = bytes.readUInt32LE(command + 4);
    if (size < 8 || command + size > bytes.length) fail('invalid Mach-O evidence command');
    if (bytes.readUInt32LE(command) === 0x1d) {
      signature = { offset: bytes.readUInt32LE(command + 8), size: bytes.readUInt32LE(command + 12) };
      bytes.fill(0, command + 8, command + 16);
    }
    command += size;
  }
  if (!signature || signature.offset + signature.size !== bytes.length) fail('evidence bridge requires a trailing ad-hoc signature');
  const signed = bytes.subarray(signature.offset);
  if (signed.readUInt32BE(0) !== 0xfade0cc0) fail('unsupported signature evidence');
  let flags; let entitlements = false;
  for (let index = 0; index < signed.readUInt32BE(8); index++) {
    const type = signed.readUInt32BE(12 + index * 8); const offset = signed.readUInt32BE(16 + index * 8);
    if (type === 0) flags = signed.readUInt32BE(offset + 12);
    if (type === 5 || type === 7) entitlements = true;
  }
  if (flags !== 2 || entitlements) fail('evidence bridge signing policy is not the admitted ad-hoc route');
  return { sha256: createHash('sha256').update(bytes.subarray(0, signature.offset)).digest('hex'), bytes: signature.offset,
    signatureBytes: signature.size, flags, entitlements };
}

/** Bind admitted, available reconstruction records to an already verified final inventory.
 * actualFiles comes from the packager's full read-only collect(), after final signing.
 * This report never changes the embedded raw SBOM or grants legal clearance.
 */
export function finalizeNativeObligations({ app, manifestFile, actualFiles, evidenceFile }) {
  const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
  const manifest = readJson(manifestFile);
  const digest = files => createHash('sha256').update(JSON.stringify(files)).digest('hex');
  if (manifest.status === 'building' || JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)
      || digest(actualFiles) !== manifest.artifactDigest) fail('final artifact inventory or digest differs from manifest');
  const layout = nativeLayout(manifest.platform); const resource = layout.resource;
  const proofIdentities = [];
  const reference = (ref, role) => {
    if (!ref?.file || !/^[a-f0-9]{64}$/.test(ref.sha256) || !existsSync(ref.file) || hashFile(ref.file) !== ref.sha256)
      fail(`actual ${role} evidence missing or bytes differ: ${ref?.file ?? 'no file'}`);
    proofIdentities.push({role, file: ref.file, sha256: ref.sha256});
    return ref.file;
  };
  const bundled = (file, sha256, role) => {
    const relative = `${resource}/${file}`;
    if (actualFiles[relative] !== sha256 || hashFile(path.join(app, relative)) !== sha256) fail(`${role} bytes differ from final inventory: ${relative}`);
    return path.join(app, relative);
  };
  const sbomRef = manifest.runtimeInputs?.sbom;
  const sbomFile = bundled(sbomRef?.file, sbomRef?.sha256, 'raw SBOM'); const sbom = readJson(sbomFile);
  if (sbom.platform !== layout.platform) fail('raw SBOM platform differs from final artifact');
  const packet = readJson(evidenceFile);
  if (packet.format !== 'hima-native-replacement-evidence/1' || packet.platform !== layout.platform
      || !Array.isArray(packet.components) || packet.components.length !== 2
      || !['ffmpeg', 'sharp-libvips'].every(name => packet.components.filter(row => row.component === name).length === 1))
    fail('actual build/interface/runtime replacement evidence required for FFmpeg and sharp-libvips');
  proofIdentities.push({role: 'admitted evidence bindings', file: evidenceFile, sha256: hashFile(evidenceFile)});
  const sourceRef = manifest.runtimeInputs?.correspondingSource;
  const sourceFile = bundled(sourceRef?.file, sourceRef?.sha256, 'corresponding source'); const source = readJson(sourceFile);
  const rightsFile = bundled('third-party/RIGHTS.md', packet.rightsSha256, 'recipient RIGHTS');
  if (packet.sourceSha256 !== sourceRef.sha256 || source.format !== 'hima-corresponding-source/1'
      || source.components?.electron !== sbom.electron?.version
      || sbom.npm.some(row => row.name.startsWith('@img/sharp-libvips-') && row.version !== source.components?.sharpLibvips)
      || !Array.isArray(source.files) || !source.files.length) fail('source identities do not cover final native components');
  for (const entry of source.files) bundled(`third-party/corresponding-source/${entry.file}`, entry.sha256, 'source material');
  const noticeFile = reference(packet.noticeMaterials, 'notice materials'); const notices = readJson(noticeFile);
  if (notices.format !== 'hima-notice-materials/1' || packet.noticeMaterials.sha256 !== sbom.noticeMaterialsSha256) fail('notice input differs from raw SBOM');
  let stagedNotices = 0;
  for (const row of sbom.npm) {
    const supplemental = notices.packages.find(entry => entry.name === row.name && entry.version === row.version);
    if (!supplemental) continue;
    if (supplemental.npmIntegrity !== row.source?.integrity) fail(`notice package integrity differs: ${row.name}`);
    for (const entry of supplemental.files) {
      const relative = `third-party/upstream/${row.name.replace(/[^a-zA-Z0-9.-]/g, '_')}-${row.version}/${entry.file}`;
      if (!row.supplementalLicenseFiles?.some(item => item.file === relative && item.sha256 === entry.sha256)) fail(`raw SBOM omits applicable notice: ${relative}`);
      reference({file: path.resolve(path.dirname(noticeFile), entry.file), sha256: entry.sha256}, 'upstream notice input');
      bundled(relative, entry.sha256, 'applicable staged notice'); stagedNotices++;
    }
  }
  const testedFile = reference(packet.testedManifest, 'tested artifact manifest'); const tested = readJson(testedFile);
  if (tested.platform !== layout.platform || digest(tested.files) !== tested.artifactDigest) fail('tested artifact manifest identity differs');
  const runtimeFile = reference(packet.runtime, 'actual replacement runtime'); const runtime = readJson(runtimeFile);
  const mac = layout.platform === 'darwin-arm64';
  if ((mac ? runtime.canonicalArtifactDigest : runtime.sourceArtifactDigest) !== tested.artifactDigest) fail('runtime proof identifies another tested artifact');
  const host = mac ? runtime : runtime.headlessHost;
  const image = mac ? runtime.bundledSharpImageOperation : host?.sharpImage;
  if (runtime.status !== 'pass' || host?.actualHostMappedModifiedVips !== true || image?.format !== 'png' || image.width !== 8 || image.height !== 8
      || (mac ? runtime.actualAppMappedReplacement !== true || runtime.appExit !== 0 || runtime.ownedHomeTeardownPass !== true
        : runtime.actualElectronLoaderMappedReplacement !== true || host.status !== 'pass' || host.hostExit !== 0 || host.stopReceiptConfirmed !== true)
      || !Array.isArray(runtime.remainingOwnedProcesses) || runtime.remainingOwnedProcesses.length) fail('actual replacement mapping/operation/teardown proof is incomplete');
  const bridge = [];
  for (const native of sbom.nativeLinks) {
    const original = tested.files[native.file]; const final = actualFiles[native.file];
    if (!original || !final) fail(`evidence bridge native inventory missing: ${native.file}`);
    if (original === final) bridge.push({file: native.file, testedSha256: original, finalSha256: final, equivalence: 'identical bytes'});
    else if (mac && native.file === layout.executable) {
      const prior = reference({file: path.join(packet.testedApp ?? '', native.file), sha256: original}, 'tested outer executable');
      const oldBody = adHocBody(prior); const finalBody = adHocBody(path.join(app, native.file));
      if (JSON.stringify(oldBody) !== JSON.stringify(finalBody)) fail(`evidence bridge body/signing differs: ${native.file}`);
      bridge.push({file: native.file, testedSha256: original, finalSha256: final, equivalence: 'identical Mach-O body and ad-hoc policy', body: finalBody});
    } else fail(`evidence bridge native/consumer bytes differ: ${native.file}`);
  }
  if (!sbom.nativeLinks.some(row => row.file === layout.executable)
      || !sbom.nativeLinks.some(row => /node\/bin\/node$/.test(row.file)) && actualFiles[`${resource}/node/bin/node`]
      || !sbom.nativeLinks.some(row => /sharp.*\.node$/.test(row.file)) && Object.keys(actualFiles).some(file => /sharp.*\.node$/.test(file)))
    fail('evidence bridge omits actual native consumers');
  const signing = mac ? readJson(reference(packet.signatures, 'ad-hoc modified-library signatures')) : undefined;
  if (mac && signing.signaturePass !== true) fail('modified-library ad-hoc signing not verified');
  const evaluated = [];
  for (const row of packet.components) {
    if (!sbom.nativeLinks.some(entry => entry.file === row.library) || !tested.files[row.library]) fail(`covered native library absent: ${row.library}`);
    const build = readJson(reference(row.build, `${row.component} whole-source build`));
    const abi = readJson(reference(row.interface, `${row.component} consumer interface`));
    const preSign = reference(row.rebuiltLibrary, `${row.component} actual rebuilt library`);
    if (hashFile(preSign) !== build.sha256) fail(`${row.component} build result differs from actual compiled library`);
    const ffmpeg = row.component === 'ffmpeg';
    const marker = ffmpeg ? build.av_version_info : build.modifiedSymbol;
    if (typeof marker !== 'string' || !marker.includes('hima-u9-source-modified')
        || (ffmpeg ? build.status !== 'source-rebuild-pass' || !build.sourceModification || !(build.sourceCount > 0) || !build.sourceRevision : build.wholeLibrarySourceRebuild !== true))
      fail(`${row.component} actual modified whole-source build evidence incomplete`);
    if (build.sha256 === tested.files[row.library] || !readFileSync(preSign).includes(Buffer.from(marker)))
      fail(`${row.component} actual rebuilt library does not contain the source-change marker`);
    const patch = source.files.find(entry => entry.file === row.sourceChange?.file && entry.sha256 === row.sourceChange?.sha256);
    if (!patch || !/source-modification\.patch$/.test(patch.file)
        || !readFileSync(path.join(app, resource, 'third-party/corresponding-source', patch.file), 'utf8').includes('hima-u9-source-modified'))
      fail(`${row.component} actual source-change bytes absent from source material`);
    if (mac ? abi.status !== 'pass' || !(abi.consumerRequiredCount > 0) || abi.consumerRequiredMissing?.length !== 0
      : ffmpeg ? abi.interfaceStaticStatus !== 'pass' || abi.allActualConsumerInterfaceImportsPresent !== true || !(abi.consumerRequired > 0) || abi.consumerRequiredMissing?.length !== 0
        : abi.interfaceStatus !== 'pass' || !(abi.consumerRequired > 0) || abi.consumerMissingFromDependencyClosure?.length !== 0) fail(`${row.component} actual consumer interface compatibility not established`);
    if ((abi.wholeLibrarySourceRebuildSha256 ?? abi.sha256 ?? build.sha256) !== build.sha256) fail(`${row.component} interface evidence uses another rebuild`);
    const runtimeMarker = mac ? ffmpeg ? runtime.modifiedSymbol : runtime.modifiedVipsSymbol : ffmpeg ? runtime.ffmpegSourceMarker : runtime.vipsSourceMarker;
    const replacementHash = mac ? ffmpeg ? runtime.scratchLibrarySha256 : runtime.vipsSha256 : build.sha256;
    if (runtimeMarker !== marker || mac && (ffmpeg ? signing.ffmpegSha256 : signing.libvipsSha256) !== replacementHash) fail(`${row.component} runtime source/signing stages differ`);
    reference({file: path.join(packet.replacementApp, row.library), sha256: replacementHash}, `${row.component} actual runtime replacement library`);
    evaluated.push({id: `${layout.platform}:${row.component}:source-notice-replacement`, component: row.component,
      nativeFile: row.library, originalSha256: tested.files[row.library], finalSha256: actualFiles[row.library],
      rebuiltPreSignSha256: build.sha256, runtimeReplacementSha256: replacementHash, sourceChange: patch,
      buildStatus: build.status, interfaceStatus: mac ? abi.status : ffmpeg ? abi.interfaceStaticStatus : abi.interfaceStatus,
      historicalStrictExportEquality: abi.ownOriginalExportEquality ?? abi.strictOriginalExportEquality ?? null,
      sourceMarker: marker});
  }
  const resolvedRaw = sbom.unresolved.filter(finding => sbom.npm.some(row => row.name.startsWith('@img/sharp-libvips-')
    && finding === `${row.name}@${row.version} at ${row.path}/lib: LGPL native binary and embedded libraries require exact upstream license/copyright disclosures, corresponding-source/build material, and verified library replacement or relinking terms before commercial distribution`));
  const effectiveUnresolved = sbom.unresolved.filter(finding => !resolvedRaw.includes(finding));
  return {format: 'hima-final-native-obligations/1', platform: layout.platform,
    qualification: effectiveUnresolved.length ? 'unresolved obligations remain' : 'technical-obligations-qualified-for-stated-scope',
    identities: {artifactDigest: manifest.artifactDigest, manifestSha256: hashFile(manifestFile), sourceSha: manifest.source?.sha ?? null,
      sbomSha256: hashFile(sbomFile), sourceSha256: hashFile(sourceFile), noticeMaterialsSha256: hashFile(noticeFile), rightsSha256: hashFile(rightsFile)},
    rawUnresolved: sbom.unresolved, resolvedRawFindings: resolvedRaw, resolvedObligationIds: evaluated.map(row => row.id), effectiveUnresolved,
    evaluatedObligations: evaluated, proofIdentities, applicableStagedNotices: stagedNotices, sourceFiles: source.files.length,
    evidenceBridge: {testedArtifactDigest: tested.artifactDigest, testedManifestSha256: packet.testedManifest.sha256, finalArtifactDigest: manifest.artifactDigest, nativeObjects: bridge},
    replacementRuntime: {proofSha256: packet.runtime.sha256, testedArtifactDigest: tested.artifactDigest,
      actualElectronMappedReplacement: mac ? runtime.actualAppMappedReplacement : runtime.actualElectronLoaderMappedReplacement,
      actualHostMappedModifiedVips: host.actualHostMappedModifiedVips, imageOperation: image,
      hostOrAppExit: mac ? runtime.appExit : host.hostExit, remainingOwnedProcesses: runtime.remainingOwnedProcesses,
      ...(mac ? {adHocSignaturePass: signing.signaturePass, ownedHomeTeardownPass: runtime.ownedHomeTeardownPass}
        : {stopReceiptConfirmed: host.stopReceiptConfirmed, desktopVisualQualification: runtime.desktopVisualQualification ?? 'not qualified'})},
    legalClearance: 'not claimed', commercialSigning: 'not qualified', originalDeliveryQualification: manifest.commercialDistribution ?? manifest.qualification ?? null,
    originalSourceQualification: source.qualification ?? null, originalSigning: manifest.signing ?? layout.signing,
    limits: ['Technical closure applies only to enumerated source/notice/interface/replacement obligations and exact bound bytes.',
      'No patent/codec clearance, zero legal risk, future contract or commercial signing approval.',
      'No fresh macOS non-administrator installation, Linux native hardware/Desktop or human final acceptance.',
      ...(mac ? ['Replacement runtime proof used an earlier candidate and local ad-hoc signing; final native body/policy equivalence recorded.']
        : ['Runtime proof used emulated Ubuntu 22.04 and headless Host; ordinary Desktop blocked by absent X server/DISPLAY.'])]};
}
