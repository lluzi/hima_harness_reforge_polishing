// Private package-team-runtime producer. Fixed local bytes only; no runtime or downloader.
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, readFile, readdir, readlink, realpath, open, statfs, unlink } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const fail = message => { throw new Error(`assemble-team-member-image: ${message}`); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = bytes => `sha256:${sha(bytes)}`;
const prefix = 'opt/hima/member';
const versions = { opencode: '1.18.34', rg: '15.2.0', fd: '10.5.0', pi: '1.1.0', oar: '0.46.0' };
const json = value => Buffer.from(JSON.stringify(value));
async function assertNoHostPaths(file, bytes, imagePath, privatePrefixes) {
  let previous = Buffer.alloc(0);
  for await (const chunk of bytes ? Readable.from([bytes]) : createReadStream(file)) {
    const window = Buffer.concat([previous, chunk]);
    if (privatePrefixes.some(p => window.includes(Buffer.from(p)))) fail(`host path embedded in SDK file: ${imagePath}`);
    previous = window.subarray(Math.max(0, window.length - Math.max(...privatePrefixes.map(p => Buffer.byteLength(p)))));
  }
}

function safePath(name, rootEntry = false) {
  if (typeof name !== 'string' || name.includes('\\') || name.includes('\0') || name.startsWith('/')) fail(`unsafe archive/source path: ${name}`);
  name = name.replace(/^\.\//, '').replace(/\/$/, '');
  if (rootEntry && (name === '.' || name === '')) return '';
  if (!name || name.split('/').some(p => !p || p === '.' || p === '..')) fail(`unsafe archive/source path: ${name}`);
  return name;
}
function linkTarget(name, target, absolute = false) {
  if (typeof target !== 'string' || !target || target.includes('\\') || target.includes('\0') || (!absolute && target.startsWith('/'))) fail(`unsafe link: ${name}`);
  const parts = target.startsWith('/') ? [] : path.posix.dirname(name).split('/').filter(p => p !== '.');
  for (const p of target.split('/')) { if (p === '..') { if (!parts.length) fail(`escaping link: ${name}`); parts.pop(); } else if (p && p !== '.') parts.push(p); }
  return parts.join('/');
}
async function fileIdentity(file) { const h = createHash('sha256'); let size = 0; for await (const chunk of createReadStream(file)) { size += chunk.length; h.update(chunk); } return { sha256: h.digest('hex'), size }; }
function identity(actual, expected, label) { if (!expected || !/^[a-f0-9]{64}$/.test(expected.sha256) || actual.sha256 !== expected.sha256 || actual.size !== expected.size) fail(`${label} hash/size differs from fixed identity`); }
// Streaming tar reader: validate headers and extended paths before any extraction/copy.
async function scanTar(stream, visit) {
  try {
  const iterator = stream[Symbol.asyncIterator](); let pending = Buffer.alloc(0), offset = 0, ended = false;
  async function take(n, eof = false) { while (pending.length < n) { const next = await iterator.next(); if (next.done) { if (eof && !pending.length) return null; fail('truncated tar'); } pending = Buffer.concat([pending, next.value]); } const b = pending.subarray(0, n); pending = pending.subarray(n); offset += n; return b; }
  let pax = {}, longName, longLink; const entries = new Map();
  for (;;) {
    const header = await take(512, true); if (!header) { if (!ended) fail('tar end marker missing'); break; }
    if (header.every(b => b === 0)) { ended = true; continue; }
    if (ended) fail('tar data after end marker');
    const text = (a, n) => header.subarray(a, a + n).toString().split('\0')[0];
    const number = (a, n) => { const raw = text(a, n).trim(); if (!/^[0-7]+$/.test(raw)) fail('unsupported tar numeric header'); const value = parseInt(raw, 8); if (!Number.isSafeInteger(value)) fail('oversized tar entry'); return value; };
    const check = Buffer.from(header); check.fill(32, 148, 156);
    if ([...check].reduce((a, b) => a + b, 0) !== number(148, 8)) fail('tar checksum mismatch');
    const size = number(124, 12), type = text(156, 1) || '0';
    let name = text(0, 100), target = text(157, 100); const pre = text(345, 155); if (pre) name = `${pre}/${name}`;
    const bodyOffset = offset; const hash = createHash('sha256'); const captured = []; let remaining = size; const headerBytes = []; let headerRemaining = 0;
    const extended = ['x', 'g', 'L', 'K'].includes(type);
    if (extended && size > 1024 * 1024) fail('oversized tar metadata');
    if (!extended) {
      name = safePath(pax.path ?? longName ?? name, true); target = pax.linkpath ?? longLink ?? target;
      if (!['0', '5', '2', '1'].includes(type)) fail(`unsupported tar entry ${type}: ${name}`);
      if ((type === '2' || type === '1') && size !== 0) fail('link tar entry has content');
      if (entries.has(name)) fail(`duplicate tar entry: ${name}`);
      headerRemaining = visit?.captureHeader?.(name) ? 20 : 0;
    }
    while (remaining) { const b = await take(Math.min(remaining, 64 * 1024)); remaining -= b.length; hash.update(b); if (headerRemaining) { const head = b.subarray(0, headerRemaining); headerBytes.push(head); headerRemaining -= head.length; } if (extended || (visit?.capture?.(name) && size <= 16 * 1024 * 1024)) captured.push(b); }
    await take((512 - size % 512) % 512);
    if (extended) {
      const bytes = Buffer.concat(captured);
      if (type === 'g') fail('global PAX metadata unsupported');
      if (type === 'L') longName = bytes.toString().replace(/\0.*$/s, '').replace(/\n$/, '');
      else if (type === 'K') longLink = bytes.toString().replace(/\0.*$/s, '').replace(/\n$/, '');
      else { let cursor = 0; pax = {}; while (cursor < bytes.length) { const space = bytes.indexOf(32, cursor); const len = Number(bytes.subarray(cursor, space)); if (!Number.isInteger(len) || len <= space - cursor || cursor + len > bytes.length) fail('invalid PAX record'); const record = bytes.subarray(space + 1, cursor + len - 1).toString(); const eq = record.indexOf('='); if (eq < 1) fail('invalid PAX key'); const key = record.slice(0, eq); if (['path', 'linkpath'].includes(key)) pax[key] = record.slice(eq + 1); else if (!['mtime', 'atime', 'ctime', 'SCHILY.fflags'].includes(key)) fail(`unsupported PAX key: ${key}`); cursor += len; } }
      continue;
    }
    const entry = { path: name, type, target, size, mode: number(100, 8), sha256: hash.digest('hex'), offset: bodyOffset, bytes: Buffer.concat(captured), headerBytes: Buffer.concat(headerBytes) };
    entries.set(name, entry); await visit?.entry?.(entry); pax = {}; longName = longLink = undefined;
  }
  return entries;
  } finally { stream.destroy?.(); }
}
function tarHeader(name, size, mode, type = '0', target = '') {
  const h = Buffer.alloc(512); h.write(name, 0, 100); h.write(mode.toString(8).padStart(7, '0') + '\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.fill(32, 148, 156); h.write(type, 156); h.write(target, 157, 100); h.write('ustar\0', 257); h.write('00', 263);
  h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148); return h;
}
function paxRecord(key, value) { const body = `${key}=${value}\n`; let n = Buffer.byteLength(body) + 2; for (;;) { const m = Buffer.byteLength(body) + String(n).length + 1; if (m === n) return Buffer.from(`${n} ${body}`); n = m; } }
async function* tarBytes(entries) {
  let index = 0;
  for (const e of entries) {
    let extra = Buffer.alloc(0); if (Buffer.byteLength(e.path) > 100) extra = Buffer.concat([extra, paxRecord('path', e.path)]); if (Buffer.byteLength(e.target ?? '') > 100) extra = Buffer.concat([extra, paxRecord('linkpath', e.target)]);
    if (extra.length) { yield tarHeader(`PaxHeaders/${index}`, extra.length, 0o644, 'x'); yield extra; yield Buffer.alloc((512 - extra.length % 512) % 512); }
    yield tarHeader(Buffer.byteLength(e.path) > 100 ? `entry-${index}` : e.path, e.size, e.mode ?? 0o644, e.type ?? '0', Buffer.byteLength(e.target ?? '') > 100 ? '' : (e.target ?? ''));
    if (e.bytes) yield e.bytes; else if (e.file && e.size) { const h = createHash('sha256'); let size = 0; for await (const b of createReadStream(e.file, e.range ?? {})) { size += b.length; h.update(b); yield b; } if (size !== e.size || (e.sha256 && h.digest('hex') !== e.sha256)) fail(`input mutated during assembly: ${e.path}`); }
    yield Buffer.alloc((512 - e.size % 512) % 512); index++;
  }
  yield Buffer.alloc(1024);
}
function parse(entry, label) { if (!entry || entry.type !== '0' || !entry.bytes.length) fail(`${label} missing`); try { return JSON.parse(entry.bytes.toString()); } catch { fail(`${label} invalid JSON`); } }
function blobPath(d) { if (!/^sha256:[a-f0-9]{64}$/.test(d)) fail('invalid OCI digest'); return `blobs/sha256/${d.slice(7)}`; }
function resolveImage(name, links) { let seen = new Set(); for (let i = 0; i < 64; i++) { const parts = name.split('/'); let changed = false; for (let j = 1; j <= parts.length; j++) { const head = parts.slice(0, j).join('/'); if (links.has(head)) { if (seen.has(head)) fail(`cyclic image link: ${head}`); seen.add(head); name = linkTarget(head, links.get(head), true) + (j < parts.length ? '/' + parts.slice(j).join('/') : ''); changed = true; break; } } if (!changed) return name; } fail('image link depth exceeded'); }
export async function assembleTeamMemberImage({ baseArchive, baseIdentity, sourceRoots, sourceManifestFile, sourceManifestSha256, output, internalCandidate = false }) {
  if (!internalCandidate) fail('distribution is unqualified: Linux/NOTICE/isolation/installer acceptance remains required');
  try { await lstat(output); fail('output exists; use a new owned candidate path'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const manifestBytes = await readFile(sourceManifestFile); if (sha(manifestBytes) !== sourceManifestSha256) fail('source manifest hash differs');
  const sources = JSON.parse(manifestBytes);
  const architecture = sources.platform?.architecture;
  if (sources.format !== 'hima-team-member-sources/1' || sources.platform?.os !== 'linux' || !['arm64', 'amd64'].includes(architecture) || baseIdentity.platform?.os !== 'linux' || baseIdentity.platform?.architecture !== architecture) fail('unqualified or mismatched architecture');
  const elfMachine = architecture === 'arm64' ? 183 : 62, piArchitecture = architecture === 'arm64' ? 'arm64' : 'x64';
  const matchesElf = b => b.length >= 20 && b.toString('latin1', 0, 4) === '\x7fELF' && b[4] === 2 && b[5] === 1 && b.readUInt16LE(18) === elfMachine;
  identity(await fileIdentity(baseArchive), baseIdentity, 'base archive');
  const outer = await scanTar(createReadStream(baseArchive), { capture: name => name === 'index.json' || name === 'oci-layout' || name === blobPath(baseIdentity.manifestDigest) || name === blobPath(baseIdentity.configDigest) });
  for (const e of outer.values()) if (e.path && e.type !== '5' && (e.type !== '0' || !/^(oci-layout|index\.json|blobs\/sha256\/[a-f0-9]{64})$/.test(e.path))) fail('OCI archive contains unsupported path/link');
  if (parse(outer.get('oci-layout'), 'OCI layout').imageLayoutVersion !== '1.0.0') fail('OCI layout version differs');
  const baseIndex = parse(outer.get('index.json'), 'base index');
  if (baseIndex.schemaVersion !== 2 || baseIndex.manifests?.length !== 1 || baseIndex.manifests[0].digest !== baseIdentity.manifestDigest || baseIndex.manifests[0].platform?.architecture !== architecture || baseIndex.manifests[0].platform?.os !== 'linux') fail('base index identity/platform differs');
  const verifyDescriptor = d => { const e = outer.get(blobPath(d.digest)); identity(e, { sha256: d.digest.slice(7), size: d.size }, 'OCI blob'); return e; };
  verifyDescriptor(baseIndex.manifests[0]);
  const baseManifest = parse(outer.get(blobPath(baseIdentity.manifestDigest)), 'base manifest');
  if (baseManifest.schemaVersion !== 2 || baseManifest.config.digest !== baseIdentity.configDigest || JSON.stringify(baseManifest.layers) !== JSON.stringify(baseIdentity.layers)) fail('base pinned layer/config identity differs');
  verifyDescriptor(baseManifest.config);
  const config = parse(outer.get(blobPath(baseIdentity.configDigest)), 'base config');
  if (config.os !== 'linux' || config.architecture !== architecture || config.rootfs?.type !== 'layers' || config.rootfs.diff_ids?.length !== baseManifest.layers.length || !config.config?.Env?.includes('NODE_VERSION=24.20.0')) fail('base Node/config identity differs');
  const basePaths = new Map(), links = new Map();
  for (let i = 0; i < baseManifest.layers.length; i++) {
    const d = baseManifest.layers[i], e = verifyDescriptor(d); if (d.mediaType !== 'application/vnd.oci.image.layer.v1.tar+gzip') fail('base layer encoding unsupported');
    const uncompressed = createReadStream(baseArchive, { start: e.offset, end: e.offset + e.size - 1 }).pipe(createGunzip()); const h = createHash('sha256'); uncompressed.on('data', b => h.update(b));
    await scanTar(uncompressed, { captureHeader: name => name === 'usr/local/bin/node', entry: entry => { if (!entry.path) return; if (entry.path.split('/').some(p => p.startsWith('.wh.'))) fail('base whiteouts unsupported'); resolveImage(entry.path, links); if (entry.type === '2') { linkTarget(entry.path, entry.target, true); links.set(entry.path, entry.target); } else { links.delete(entry.path); if (entry.type === '1') safePath(entry.target); } basePaths.set(entry.path, entry); } });
    if (`sha256:${h.digest('hex')}` !== config.rootfs.diff_ids[i]) fail('base uncompressed diff_id differs');
  }
  for (const name of links.keys()) resolveImage(name, links);
  const node = basePaths.get('usr/local/bin/node'); if (!node || node.type !== '0' || !(node.mode & 0o111)) fail('base Node executable missing');
  if (!matchesElf(node.headerBytes)) fail('base Node executable architecture differs');
  if (!Array.isArray(sources.components) || sources.components.length !== 5 || new Set(sources.components.map(c => c.id)).size !== 5) fail('SDK cohort missing/duplicate');
  const rows = [...(sources.files ?? []), ...(sources.symlinks ?? [])], image = new Map(), inventory = new Map(), rootNames = new Set();
  for (const row of rows) {
    safePath(row.imagePath); if (!row.imagePath.startsWith(prefix + '/') || row.imagePath.split('/').some(p => p.startsWith('.wh.'))) fail('SDK path outside fixed prefix/whiteout');
    if (row.imagePath === `${prefix}/cohort.json`) fail('SDK cohort receipt path is reserved');
    if (image.has(row.imagePath)) fail('duplicate SDK image path');
    if (!Number.isInteger(row.mode) || row.mode < 0 || row.mode > 0o777) fail('invalid SDK mode');
    image.set(row.imagePath, row);
    if (row.root !== undefined) { if (!sourceRoots[row.root]) fail('source root missing'); safePath(row.path); const key = `${row.root}/${row.path}`; if (inventory.has(key)) fail('duplicate SDK source'); inventory.set(key, row); rootNames.add(row.root); }
  }
  for (const [id, version] of Object.entries(versions)) {
    const c = sources.components.find(c => c.id === id); if (!c || c.version !== version || !/^https:\/\//.test(c.source) || !c.license || !c.requiredFiles?.length || !c.notices?.length) fail(`SDK ${id} fixed identity/license missing`);
    for (const name of [...c.requiredFiles, ...c.notices]) if (!image.has(name) || !image.get(name).sha256) fail(`SDK ${id} module/notice missing`);
  }
  for (const omitted of Object.values(sources.excludedSourceDirectories ?? {}).flat()) if (!['private-home', 'private-workspace'].includes(omitted)) fail('unsupported source omission');
  const realRoots = {};
  for (const name of rootNames) {
    realRoots[name] = await realpath(sourceRoots[name]);
    async function walk(dir, rel = '') { for (const item of await readdir(dir)) { if (!rel && ['private-home', 'private-workspace'].includes(item) && (sources.excludedSourceDirectories?.[name] ?? []).includes(item)) continue; const file = path.join(dir, item), relative = rel ? `${rel}/${item}` : item, info = await lstat(file); if (info.isDirectory()) await walk(file, relative); else if (!inventory.has(`${name}/${relative}`)) fail(`unlisted source file: ${name}/${relative}`); } }
    await walk(realRoots[name]);
  }
  const layerEntries = []; const sdkLinks = new Map();
  for (const ancestor of ['opt', 'opt/hima', prefix]) if (links.has(ancestor) || (basePaths.has(ancestor) && basePaths.get(ancestor).type !== '5')) fail('base SDK prefix has a conflicting file/link');
  for (const row of rows) {
    if (row.target !== undefined) {
      const resolved = linkTarget(row.imagePath, row.target); if (!resolved.startsWith(prefix + '/')) fail('SDK link escapes image prefix'); sdkLinks.set(row.imagePath, row.target);
      if (row.root !== undefined) { const file = path.join(realRoots[row.root], row.path); if (!(await lstat(file)).isSymbolicLink() || await readlink(file) !== row.target) fail('source link identity differs'); const real = await realpath(file); if (!real.startsWith(realRoots[row.root] + path.sep)) fail('source link escapes/missing'); }
      layerEntries.push({ path: row.imagePath, mode: row.mode, type: '2', target: row.target, size: 0 });
    } else {
      if (!row.root) fail('SDK file source missing'); const file = path.join(realRoots[row.root], row.path), info = await lstat(file);
      if (!info.isFile() || (info.mode & 0o777) !== row.mode || !(await realpath(file)).startsWith(realRoots[row.root] + path.sep)) fail('source type/mode/containment differs');
      identity(await fileIdentity(file), row, 'SDK file');
      let deployed;
      if (row.rewrite) {
        const allowed = { 'pnpm-store-location': 'node_modules/.modules.yaml', 'pnpm-workspace-location': 'node_modules/.pnpm-workspace-state-v1.json' };
        if (row.rewrite !== 'pnpm-shim-location' && row.path !== allowed[row.rewrite]) fail('unsupported deployment metadata rewrite');
        if (row.rewrite === 'pnpm-shim-location') {
          if (!row.path.split('/').includes('.bin')) fail('rewrite is not a generated pnpm bin shim');
          const original = await readFile(file, 'utf8');
          if (!original.startsWith('#!/bin/sh\n') || !original.includes('# cmd-shim-target=') || !original.includes(realRoots[row.root] + '/')) fail('pnpm generated shim identity differs');
          const relocated = original.replaceAll(realRoots[row.root] + '/', '/opt/hima/member/');
          for (const match of relocated.matchAll(/export NODE_PATH="([^"]+)"/g)) for (const item of match[1].split(':')) if (item.startsWith('/') && !item.startsWith('/opt/hima/member/')) fail('unmatched absolute shim NODE_PATH');
          deployed = Buffer.from(relocated);
        } else {
        const metadata = JSON.parse(await readFile(file, 'utf8'));
        if (row.rewrite === 'pnpm-store-location') { if (typeof metadata.storeDir !== 'string' || !path.isAbsolute(metadata.storeDir)) fail('pnpm store metadata differs'); metadata.storeDir = '/opt/hima/member/.pnpm-store'; }
        else { const keys = Object.keys(metadata.projects ?? {}); if (keys.length !== 1 || keys[0] !== realRoots[row.root]) fail('pnpm workspace metadata differs'); metadata.projects = { '/opt/hima/member': metadata.projects[keys[0]] }; }
        deployed = Buffer.from(JSON.stringify(metadata, null, 2) + '\n');
        }
        identity({ sha256: sha(deployed), size: deployed.length }, { sha256: row.deployedSha256, size: row.deployedSize }, 'relocated metadata');
      }
      // Original runtime and NOTICE bytes are never rewritten. Detect local paths without emitting their contents.
      await assertNoHostPaths(file, deployed, row.imagePath, [...Object.values(realRoots), ...Object.values(sourceRoots).map(r => path.resolve(r)), process.cwd(), os.homedir() + "/"]);

      if (['opencode', 'rg', 'fd'].some(id => sources.components.find(c => c.id === id).requiredFiles.includes(row.imagePath))) { const handle = await open(file); const b = Buffer.alloc(20); try { await handle.read(b, 0, 20, 0); } finally { await handle.close(); } if (!matchesElf(b) || !(row.mode & 0o111)) fail('SDK executable architecture/mode differs'); }
      layerEntries.push(deployed ? { path: row.imagePath, mode: row.mode, bytes: deployed, size: deployed.length } : { path: row.imagePath, mode: row.mode, file, sha256: row.sha256, size: row.size });
    }
  }
  for (const row of rows.filter(r => r.target === undefined)) if (resolveImage(row.imagePath, sdkLinks) !== row.imagePath) fail('SDK file beneath symlink');
  for (const name of sdkLinks.keys()) { const resolved = resolveImage(name, sdkLinks); if (!resolved.startsWith(prefix + '/') || ![...image.keys()].some(p => p === resolved || p.startsWith(resolved + '/'))) fail('SDK link target missing/escaping'); }
  const piNative = sources.components.find(c => c.id === 'pi').nativeFiles;
  if (!Array.isArray(piNative) || piNative.length !== 1 || !piNative[0].endsWith(`/native/linux/prebuilds/linux-${piArchitecture}/linux-platform-x11.node`)) fail('Pi matching native module identity missing');
  for (const name of piNative) { const r = image.get(name); if (!r?.root || !r.sha256) fail('Pi matching native module missing'); const handle = await open(path.join(realRoots[r.root], r.path)); const b = Buffer.alloc(20); try { await handle.read(b, 0, 20, 0); } finally { await handle.close(); } if (!matchesElf(b)) fail('Pi native module architecture differs'); }
  if (![...basePaths.keys()].some(p => p.endsWith('/libxcb.so.1'))) fail('Pi base libxcb dependency missing');
  for (const component of sources.components.filter(c => ['pi', 'oar'].includes(c.id))) { if (!component.packageJson || !component.entryPoint) fail('SDK import entry point identity missing'); const r = image.get(component.packageJson); if (!r || !image.has(component.entryPoint)) fail('SDK import module missing'); const pkg = JSON.parse(await readFile(path.join(realRoots[r.root], r.path), 'utf8')); if (pkg.version !== component.version || !pkg.type || pkg.type !== 'module') fail('SDK package module/version differs'); }
  if (sources.archives?.length !== 3 || ['opencode', 'rg', 'fd'].some(id => sources.components.find(c => c.id === id).archive !== id || sources.archives.filter(a => a.id === id).length !== 1)) fail('original SDK release archives missing/duplicate');
  for (const archive of sources.archives ?? []) { safePath(archive.path); if (!sourceRoots[archive.root]) fail('archive source root missing'); const file = path.join(sourceRoots[archive.root], archive.path); if (!(await lstat(file)).isFile() || !(await realpath(file)).startsWith(await realpath(sourceRoots[archive.root]) + path.sep)) fail('archive escapes source root'); identity(await fileIdentity(file), archive, 'original release archive');
    const archiveEntries = await scanTar(createReadStream(file).pipe(createGunzip()));
    for (const e of archiveEntries.values()) if (e.type === '2' || e.type === '1') linkTarget(e.path, e.target);
    const component = sources.components.find(c => c.archive === archive.id);
    if (!component || !archive.source?.startsWith('https://') || !archive.executablePath) fail('release archive provenance missing');
    const original = archiveEntries.get(archive.executablePath), installed = image.get(component.requiredFiles[0]);
    if (!original || original.type !== '0' || original.sha256 !== installed.sha256 || original.size !== installed.size) fail('release executable differs from original pinned archive');
  }
  const space = await statfs(path.dirname(output)); const needed = baseIdentity.size + rows.reduce((n, r) => n + (r.size ?? 0), 0) * 2 + 16 * 1024 * 1024; if (Number(space.bavail) * Number(space.bsize) < needed) fail('insufficient free disk for owned assembly');
  layerEntries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  // Generated receipts contain only fixed image/source identities, never local root paths.
  const cohort = [{ id: 'node', version: '24.20.0', source: baseIndex.manifests[0].annotations?.['org.opencontainers.image.source'] ?? 'https://github.com/nodejs/docker-node', manifestDigest: baseIdentity.manifestDigest, executable: 'usr/local/bin/node', sha256: node.sha256, license: 'MIT', noticeQualification: 'base transitive obligations unqualified' }, ...sources.components];
  const embedded = json({ format: 'hima-team-member-image-cohort/1', platform: sources.platform, sourceManifestSha256, baseManifestDigest: baseIdentity.manifestDigest, components: cohort, files: rows.map(({ root, ...row }) => row), memberReady: false });
  layerEntries.push({ path: `${prefix}/cohort.json`, bytes: embedded, size: embedded.length });
  const temporary = `${output}.layer.gz`; const diffHash = createHash('sha256'); const input = Readable.from(tarBytes(layerEntries)); input.on('data', b => diffHash.update(b));
  await pipeline(input, createGzip({ level: 9, mtime: 0 }), createWriteStream(temporary, { flags: 'wx' }));
  const layerIdentity = await fileIdentity(temporary); const addedLayer = { mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: `sha256:${layerIdentity.sha256}`, size: layerIdentity.size, diffId: `sha256:${diffHash.digest('hex')}` };
  config.rootfs.diff_ids.push(addedLayer.diffId); config.config.Env = config.config.Env.filter(e => !e.startsWith('PATH=') && !e.startsWith('PI_OFFLINE=')).concat(['PATH=/opt/hima/member/bin:/opt/hima/member/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'PI_OFFLINE=1']);
  config.history = [...(config.history ?? []), { created: '1970-01-01T00:00:00Z', created_by: 'hima fixed offline SDK append' }];
  const newConfig = json(config), descriptor = (b, mediaType) => ({ mediaType, digest: digest(b), size: b.length });
  const layers = [...baseManifest.layers, { mediaType: addedLayer.mediaType, digest: addedLayer.digest, size: addedLayer.size }];
  const manifest = json({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: descriptor(newConfig, 'application/vnd.oci.image.config.v1+json'), layers });
  const newIndex = json({ schemaVersion: 2, manifests: [{ ...descriptor(manifest, 'application/vnd.oci.image.manifest.v1+json'), platform: sources.platform }] });
  const outputEntries = [{ path: 'oci-layout', bytes: json({ imageLayoutVersion: '1.0.0' }) }, { path: 'index.json', bytes: newIndex }, { path: blobPath(digest(newConfig)), bytes: newConfig }, { path: blobPath(digest(manifest)), bytes: manifest }, { path: blobPath(addedLayer.digest), file: temporary, sha256: layerIdentity.sha256, size: layerIdentity.size }, ...baseManifest.layers.map(d => { const e = outer.get(blobPath(d.digest)); return { path: e.path, file: baseArchive, range: { start: e.offset, end: e.offset + e.size - 1 }, size: e.size, sha256: e.sha256 }; })];
  for (const e of outputEntries) if (e.bytes) e.size = e.bytes.length;
  await pipeline(Readable.from(tarBytes(outputEntries)), createWriteStream(output, { flags: 'wx' }));
  const archiveIdentity = await fileIdentity(output);
  // Successful layer bytes are already embedded/hash-bound in the OCI; failed intermediates remain for diagnosis.
  await unlink(temporary);
  return { format: 'hima-team-member-image-assembly/1', qualification: 'offline-asset-assembly-only', memberReady: false, platform: sources.platform, archiveSha256: archiveIdentity.sha256, archiveSize: archiveIdentity.size, manifestDigest: digest(manifest), configDigest: digest(newConfig), baseArchiveSha256: baseIdentity.sha256, sourceManifestSha256, layers, addedLayer, components: cohort, archives: (sources.archives ?? []).map(({ root, ...a }) => a), fileCount: sources.files.length, symlinkCount: sources.symlinks.length, metadataRewrites: sources.files.filter(r => r.rewrite).map(r => ({ imagePath: r.imagePath, kind: r.rewrite, originalSha256: r.sha256, deployedSha256: r.deployedSha256 })), nativeProbes: 'NOT RUN', releaseBlockers: ['native qualification', 'transitive source/NOTICE closure', 'production isolation', 'clean installer/business acceptance'] };
}
