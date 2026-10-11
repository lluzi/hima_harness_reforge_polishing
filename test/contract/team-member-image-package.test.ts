import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
function tar(entries: { path: string; bytes?: Buffer; target?: string }[]) {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const b = e.bytes ?? Buffer.alloc(0), h = Buffer.alloc(512);
    h.write(e.path); h.write('0000755\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(b.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
    h.fill(32, 148, 156); h.write(e.target ? '2' : '0', 156); if (e.target) h.write(e.target, 157);
    h.write('ustar\0', 257); h.write('00', 263);
    h.write([...h].reduce((a, n) => a + n, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, b, Buffer.alloc((512 - b.length % 512) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}
async function fixture(variant = "", architecture = "arm64") {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-member-image-'));
  const source = path.join(root, 'source'); await mkdir(source); const releases = path.join(root, 'releases'); await mkdir(releases); const archives: any[] = [];
  const elf = Buffer.alloc(64); elf.write('\x7fELF', 0, 'binary'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(architecture === "arm64" ? 183 : 62, 18);
  const layer = gzipSync(tar([{ path: variant === 'nested-path' ? '../outside' : 'usr/local/bin/node', bytes: elf }, { path: `usr/lib/${architecture === 'arm64' ? 'aarch64' : 'x86_64'}-linux-gnu/libxcb.so.1`, bytes: elf }]));
  const config = Buffer.from(JSON.stringify({ os: 'linux', architecture, config: { Env: ['NODE_VERSION=24.20.0', 'PATH=/usr/local/bin:/usr/bin:/bin'] }, rootfs: { type: 'layers', diff_ids: ['sha256:' + (variant === 'diff-id' ? '0'.repeat(64) : hash(gunzipSync(layer)))] } }));
  const descriptor = (b: Buffer, mediaType: string) => ({ digest: 'sha256:' + hash(b), size: b.length, mediaType });
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, config: descriptor(config, 'application/vnd.oci.image.config.v1+json'), layers: [descriptor(layer, 'application/vnd.oci.image.layer.v1.tar+gzip')] }));
  const index = Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [{ ...descriptor(manifest, 'application/vnd.oci.image.manifest.v1+json'), platform: { os: 'linux', architecture } }] }));
  const archive = tar([{ path: 'oci-layout', bytes: Buffer.from('{"imageLayoutVersion":"1.0.0"}') }, { path: 'index.json', bytes: index }, ...[manifest, config, layer].map(bytes => ({ path: 'blobs/sha256/' + hash(bytes), bytes }))]);
  const baseArchive = path.join(root, 'base.tar'); await writeFile(baseArchive, archive);
  const files: any[] = [];
  const components: any[] = [];
  for (const [id, version] of Object.entries({ opencode: '1.18.34', rg: '15.2.0', fd: '10.5.0', pi: '1.1.0', oar: '0.46.0' })) {
    const imagePath = id === 'pi' || id === 'oar' ? `opt/hima/member/node_modules/${id}/package.json` : `opt/hima/member/bin/${id}`;
    const bytes = id === 'pi' || id === 'oar' ? Buffer.from(JSON.stringify({ name: id, version, type: 'module' })) : elf;
    await writeFile(path.join(source, id), bytes); await chmod(path.join(source, id), 0o755);
    await writeFile(path.join(source, id + '-license'), 'license');
    if (['opencode', 'rg', 'fd'].includes(id)) { const a = gzipSync(tar([{ path: id, bytes }])); await writeFile(path.join(releases, id + '.tar.gz'), a); archives.push({ id, root: 'releases', path: id + '.tar.gz', sha256: hash(a), size: a.length, source: 'https://example.test/' + id, executablePath: id }); }
    files.push({ root: 'sdk', path: id, imagePath, sha256: hash(bytes), size: bytes.length, mode: 0o755 });
    files.push({ root: 'sdk', path: id + '-license', imagePath: `opt/hima/member/notices/${id}`, sha256: hash('license'), size: 7, mode: 0o644 });
    if (id === 'pi' || id === 'oar') { const code = Buffer.from('export const ready = true;'); await writeFile(path.join(source, id + '-module'), code); files.push({ root: 'sdk', path: id + '-module', imagePath: `opt/hima/member/node_modules/${id}/index.js`, sha256: hash(code), size: code.length, mode: 0o644 }); }
    components.push({ ...(['opencode', 'rg', 'fd'].includes(id) ? { archive: id } : {}), ...(id === 'pi' || id === 'oar' ? { packageJson: imagePath, entryPoint: `opt/hima/member/node_modules/${id}/index.js` } : {}), id, version, source: `https://example.test/${id}`, license: 'MIT', requiredFiles: [imagePath], notices: [`opt/hima/member/notices/${id}`] });
  }
  const nativePath = `opt/hima/member/node_modules/pi-tui/native/linux/prebuilds/linux-${architecture === 'arm64' ? 'arm64' : 'x64'}/linux-platform-x11.node`; await writeFile(path.join(source, 'pi-native'), elf); files.push({ root: 'sdk', path: 'pi-native', imagePath: nativePath, sha256: hash(elf), size: elf.length, mode: 0o644 }); components.find(c => c.id === 'pi').nativeFiles = [nativePath];
  const sourceManifestFile = path.join(root, 'source.json');
  const sourceManifest = { format: 'hima-team-member-sources/1', platform: { os: 'linux', architecture }, components, files, symlinks: [], archives };
  const freeze = async () => { const b = JSON.stringify(sourceManifest); await writeFile(sourceManifestFile, b); return hash(b); };
  return { root, source, sourceManifest, freeze, options: { baseArchive, baseIdentity: { sha256: hash(archive), size: archive.length, manifestDigest: 'sha256:' + hash(manifest), configDigest: 'sha256:' + hash(config), platform: { os: 'linux', architecture }, layers: [descriptor(layer, 'application/vnd.oci.image.layer.v1.tar+gzip')] }, sourceRoots: { sdk: source, releases }, sourceManifestFile, output: path.join(root, 'out.tar'), internalCandidate: true } };
}
const load = () => import(new URL('../../scripts/assemble-team-member-image.mjs', import.meta.url).href);
test('offline producer preserves base, emits deterministic complete cohort and no source paths', async () => {
  const f = await fixture();
  try {
    const { assembleTeamMemberImage } = await load(); const sourceManifestSha256 = await f.freeze();
    const first = await assembleTeamMemberImage({ ...f.options, sourceManifestSha256 });
    await assert.rejects(readFile(`${f.options.output}.layer.gz`), /ENOENT/, 'successful producer leaves only the declared immutable archive');
    const second = await assembleTeamMemberImage({ ...f.options, sourceManifestSha256, output: path.join(f.root, 'second.tar') });
    assert.equal(first.archiveSha256, second.archiveSha256); assert.equal(first.memberReady, false);
    assert.equal(first.layers.length, 2); assert.equal(first.layers[0]!.digest, f.options.baseIdentity.layers[0]!.digest);
    assert.notEqual(first.addedLayer.digest, first.addedLayer.diffId);
    assert.equal(JSON.stringify(first).includes(f.root), false);
    assert.match((await readFile(f.options.output)).toString('latin1'), /oci-layout/);
    await assert.rejects(assembleTeamMemberImage({ ...f.options, sourceManifestSha256, output: path.join(f.root, 'formal.tar'), internalCandidate: false }), /distribution.*unqualified/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
for (const mutation of ['hash', 'architecture', 'missing-sdk', 'mode', 'escape', 'unlisted', 'original-archive', 'native-architecture'] as const) test(`offline producer rejects ${mutation} before output`, async () => {
  const f = await fixture();
  try {
    if (mutation === 'hash') f.options.baseIdentity.sha256 = '0'.repeat(64);
    if (mutation === 'architecture') f.options.baseIdentity.platform.architecture = 'amd64';
    if (mutation === 'missing-sdk') f.sourceManifest.components.pop();
    if (mutation === 'mode') f.sourceManifest.files[0].mode = 0o644;
    if (mutation === 'escape') { await symlink('../../outside', path.join(f.source, 'bad')); (f.sourceManifest.symlinks as any[]).push({ root: 'sdk', path: 'bad', imagePath: 'opt/hima/member/bad', target: '../../outside', mode: 0o777 }); }
    if (mutation === 'native-architecture') { const r = f.sourceManifest.files.find(r => r.path === 'pi-native'); const b = await readFile(path.join(f.source, r.path)); b.writeUInt16LE(62, 18); await writeFile(path.join(f.source, r.path), b); r.sha256 = hash(b); }
    if (mutation === 'original-archive') f.sourceManifest.archives[0].sha256 = '0'.repeat(64);
    if (mutation === 'unlisted') await writeFile(path.join(f.source, 'secret'), 'must not ship');
    const { assembleTeamMemberImage } = await load();
    await assert.rejects(assembleTeamMemberImage({ ...f.options, sourceManifestSha256: await f.freeze() }));
    await assert.rejects(readFile(f.options.output), /ENOENT/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

for (const variant of ['diff-id', 'nested-path']) test(`offline producer rejects pinned but unsafe ${variant} base`, async () => {
  const f = await fixture(variant);
  try { const { assembleTeamMemberImage } = await load(); await assert.rejects(assembleTeamMemberImage({ ...f.options, sourceManifestSha256: await f.freeze() })); await assert.rejects(readFile(f.options.output), /ENOENT/); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});
test('offline producer rejects a declared SDK module absent from pinned files', async () => {
  const f = await fixture();
  try { f.sourceManifest.components[4].requiredFiles.push('opt/hima/member/node_modules/oar/dist/index.js'); const { assembleTeamMemberImage } = await load(); await assert.rejects(assembleTeamMemberImage({ ...f.options, sourceManifestSha256: await f.freeze() }), /module\/notice missing/); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});
test('offline producer rejects host metadata unless original and relocated identities are frozen', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from(JSON.stringify({ storeDir: f.source + '/store' }));
    await mkdir(path.join(f.source, 'node_modules')); await writeFile(path.join(f.source, 'node_modules/.modules.yaml'), bytes);
    const row: any = { root: 'sdk', path: 'node_modules/.modules.yaml', imagePath: 'opt/hima/member/node_modules/.modules.yaml', size: bytes.length, sha256: hash(bytes), mode: 0o644 };
    f.sourceManifest.files.push(row);
    const { assembleTeamMemberImage } = await load();
    await assert.rejects(assembleTeamMemberImage({ ...f.options, sourceManifestSha256: await f.freeze() }), /host path/);
    row.rewrite = 'pnpm-store-location'; const deployed = Buffer.from(JSON.stringify({ storeDir: '/opt/hima/member/.pnpm-store' }, null, 2) + '\n'); row.deployedSha256 = hash(deployed); row.deployedSize = deployed.length;
    const receipt = await assembleTeamMemberImage({ ...f.options, sourceManifestSha256: await f.freeze() }); assert.equal(receipt.memberReady, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('generated pnpm shim relocation keeps the original bytes bound and removes private roots', async () => {
  const f = await fixture();
  try {
    const origin = await realpath(f.source); const text = `#!/bin/sh\nexport NODE_PATH="${origin}/node_modules"\n# cmd-shim-target=${origin}/node_modules/pi/index.js\n`;
    const bytes = Buffer.from(text), relocated = Buffer.from(text.replaceAll(origin + '/', '/opt/hima/member/'));
    await mkdir(path.join(f.source, 'node_modules/.bin'), { recursive: true }); await writeFile(path.join(f.source, 'node_modules/.bin/pi'), bytes, { mode: 0o755 });
    f.sourceManifest.files.push({ root: 'sdk', path: 'node_modules/.bin/pi', imagePath: 'opt/hima/member/node_modules/.bin/pi', mode: 0o755, sha256: hash(bytes), size: bytes.length, rewrite: 'pnpm-shim-location', deployedSha256: hash(relocated), deployedSize: relocated.length });
    const { assembleTeamMemberImage } = await load(); const receipt = await assembleTeamMemberImage({ ...f.options, sourceManifestSha256: await f.freeze() });
    assert.equal(receipt.metadataRewrites.length, 1); assert.equal(receipt.metadataRewrites[0].originalSha256, hash(bytes)); assert.equal(receipt.metadataRewrites[0].deployedSha256, hash(relocated)); assert.equal(JSON.stringify(receipt).includes(origin), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

// L0 public packaging round trip: retained fixtures only, no native service/VM.
test('SDK staging publishes a closure reusable by the existing packager and preserves its source', async () => {
  const architecture = process.platform === 'darwin' ? 'arm64' : 'amd64';
  const f = await fixture('', architecture);
  try {
    const { packageTeamMemberRuntime, packageTeamRuntime } = await import(new URL('../../scripts/package-team-runtime.mjs', import.meta.url).href);
    const platform = `${process.platform}-${process.arch}`, prefix = path.join(f.root, 'retained');
    await mkdir(path.join(prefix, 'engine'), { recursive: true });
    const files: Record<string, string> = {};
    for (const [file, bytes] of [['engine/base.tar', await readFile(f.options.baseArchive)], ['engine/helper', Buffer.from('process substitute only')], ['engine/NOTICE', Buffer.from('fixture notice')], ['engine/machine.zst', Buffer.from('fixture machine')]] as const) {
      await writeFile(path.join(prefix, file), bytes); files[file] = hash(bytes);
    }
    const base = f.options.baseIdentity;
    const engine = { kind: 'podman', version: '6.1.3', provider: process.platform === 'darwin' ? 'applehv' : 'rootless', guestPlatform: process.platform === 'darwin' ? 'linux-arm64' : 'linux-x64', executable: 'engine/helper', helpers: ['engine/helper'], guestInventory: {}, ...(process.platform === 'darwin' ? { machineImage: { file: 'engine/machine.zst', sha256: files['engine/machine.zst'], bytes: 15, compression: 'zstd' } } : {}), image: { file: 'engine/base.tar', sha256: base.sha256, bytes: base.size, manifestSha256: base.manifestDigest.slice(7), configSha256: base.configDigest.slice(7), layers: base.layers.map(layer => ({ sha256: layer.digest.slice(7), bytes: layer.size })), qualification: 'trusted-fixture-only' } };
    const component = { id: 'engineering-engine', version: '6.1.3', source: 'https://example.test/engine', license: 'fixture', notices: ['engine/NOTICE'], requiredFiles: ['engine/helper', 'engine/base.tar', 'engine/machine.zst'] };
    const manifest = { format: 'hima-team-runtime/1', platform, qualification: 'asset-assembly-only', files, components: [component], services: [], engineeringEngine: engine };
    const original = JSON.stringify(manifest); await writeFile(path.join(prefix, 'team-runtime.json'), original);
    const pinFile = path.join(f.root, 'pin.json'), publishedPinFile = path.join(f.root, 'sdk-pin.json');
    const pin = { format: 'hima-team-runtime/1', qualification: 'retained-assets-partial', noImplicitDownloads: true, components: [{ ...component, platformAssets: { [platform]: { files } } }], platformAssets: { [platform]: { qualification: 'asset-assembly-only', manifestSha256: hash(original), inventorySha256: hash(JSON.stringify(files)), fileCount: Object.keys(files).length, requiredComponents: ['engineering-engine'], services: [], engineeringEngine: engine, releaseBlockers: ['fixture only; rights/native qualification missing'] } } };
    const originalPin = JSON.stringify(pin); await writeFile(pinFile, originalPin);
    const output = path.join(f.root, 'staged');
    const result = await packageTeamMemberRuntime({ prefix, output, pinFile, publishedPinFile, internalCandidate: true, imageInputs: { ...f.options, sourceManifestSha256: await f.freeze() } });
    const repackaged = await packageTeamRuntime({ prefix: output, output: path.join(f.root, 'repackaged'), pinFile: publishedPinFile, internalCandidate: true });
    assert.equal(repackaged.manifestSha256, result.manifestSha256); assert.equal(repackaged.inventorySha256, result.inventorySha256);
    assert.equal(await readFile(path.join(prefix, 'team-runtime.json'), 'utf8'), original); assert.equal(await readFile(pinFile, 'utf8'), originalPin);
    await assert.rejects(readFile(path.join(output, 'engine/member-sdk.oci.tar.layer.gz')), /ENOENT/);
    assert.equal(result.memberReady, false); await assert.rejects(packageTeamRuntime({ prefix: output, output: path.join(f.root, 'formal'), pinFile: publishedPinFile }), /distribution is not qualified/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
