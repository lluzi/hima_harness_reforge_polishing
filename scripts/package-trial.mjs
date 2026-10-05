// Build a bounded native macOS arm64 or Linux x64 trial distribution. This intentionally produces no
// archive or network release: GitHub publication happens only after acceptance.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { packagePostgres } from './package-postgres.mjs';
import { nativeLayout, stageRuntimeNotices, auditDistribution, stageCorrespondingSource, hashFile, finalizeNativeObligations } from './package-native-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node24 = process.env.HIMA_NODE || process.execPath;
const trialVersion = JSON.parse(readFileSync(path.join(root, 'packages/desktop/package.json'), 'utf8')).version;
const macVersion = trialVersion.split('-')[0];
const trialPackId = 'custom-cell-fmax-dtco';
const trialPackRelative = path.join('packs', trialPackId);
const timingPackId = 'xtop-timing-closure';
const timingPackRelative = path.join('packs', timingPackId);
const demoPackId = 'opene902-timing-probe';
const demoPackRelative = path.join('packs', demoPackId);
const atcsPackId = 'agentic-timing-closure-system';
const atcsPackRelative = path.join('packs', atcsPackId);
const atcsSiteId = 'linglong-atcs28';
const atcsSiteRelative = path.join('sites', atcsSiteId);
const bundledPackIds = [trialPackId, timingPackId, demoPackId, atcsPackId];
const atcsBindingNone = 'none, kit installs it';
const qualificationRelative = 'operator-qualification';
const bindingsRelative = `${qualificationRelative}/interactive-bindings.json`;
const args = process.argv.slice(2);
const value = (flag) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const internalCandidate = args.includes('--internal-candidate');
const layoutFor = manifest => nativeLayout(manifest.platform ?? 'darwin-arm64');
const resourceFor = (app, manifest = { platform: `${process.platform}-${process.arch}` }) => path.join(app, layoutFor(manifest).resource);
const executableFor = (app) => path.join(app, nativeLayout(`${process.platform}-${process.arch}`).executable);
const fail = (message) => { throw new Error(`package-trial: ${message}`); };
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
};
const relative = (base, file) => path.relative(base, file).split(path.sep).join('/');
const hash = hashFile;
const productSourcePaths = ['packages', 'packs', 'profiles', 'sites', 'scripts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'THIRD_PARTY_NOTICES.md', 'docs/operations'];
const sourceState = () => {
  const sha = run('git', ['rev-parse', 'HEAD']).trim();
  const scoped = internalCandidate ? ['--', ...productSourcePaths] : [];
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no', ...scoped]).trim() !== '';
  const diffSha256 = createHash('sha256').update(run('git', ['diff', '--binary', 'HEAD', ...scoped])).digest('hex');
  if (!internalCandidate) return { sha, dirty, diffSha256 };
  const files = {};
  for (const file of [...new Set(run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...productSourcePaths]).split('\n').filter(Boolean))].sort()) {
    const absolute = path.join(root, file);
    files[file] = !existsSync(absolute) ? 'deleted' : lstatSync(absolute).isSymbolicLink() ? `symlink:${readlinkSync(absolute)}:${hash(realpathSync(absolute))}` : hash(absolute);
  }
  return { sha, dirty, diffSha256, qualification: 'explicit internal candidate frozen by actual product source bytes; not a clean release snapshot', scope: productSourcePaths, files, productSourceDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
};

/**
 * The trial is only useful when it carries the portable DTCO method it claims to
 * demonstrate. Keep this check in the packager, beside the release manifest,
 * instead of silently accepting a copied `packs/` directory that happens to
 * omit a method file. This is deliberately a structural release check: the
 * normal Pack loader remains the authority for YAML semantics at Host startup.
 */
function assertTrialPackAssets(packsRoot) {
  const pack = path.join(packsRoot, trialPackId);
  const required = ['contract.yml', 'graph.yml', 'knowledge/manifest.yml', 'TEST.md', 'VERSION.yml'];
  for (const relativeFile of required) {
    const file = path.join(pack, relativeFile);
    if (!existsSync(file) || !lstatSync(file).isFile()) fail(`trial Pack ${trialPackId} is missing required asset ${relativeFile}`);
  }
  const contract = readFileSync(path.join(pack, 'contract.yml'), 'utf8');
  const graph = readFileSync(path.join(pack, 'graph.yml'), 'utf8');
  const manifest = readFileSync(path.join(pack, 'knowledge/manifest.yml'), 'utf8');
  if (!new RegExp(`^id: ${trialPackId}$`, 'm').test(contract)) fail(`trial Pack ${trialPackId} contract identity is missing`);
  if (!/^knowledgeManifest: knowledge\/manifest\.yml$/m.test(contract)) fail(`trial Pack ${trialPackId} contract does not declare its knowledge manifest`);
  if (!new RegExp(`^id: ${trialPackId}$`, 'm').test(graph) || !/^entry: \S+$/m.test(graph)) fail(`trial Pack ${trialPackId} graph identity or entry is missing`);
  if (!/^schema: hima-pack-knowledge\/1$/m.test(manifest)) fail(`trial Pack ${trialPackId} knowledge manifest schema is missing`);
  const version = /^version:\s*["']?([^"'\s]+)["']?/m.exec(contract)?.[1];
  const seal = parse(readFileSync(path.join(pack, 'VERSION.yml'), 'utf8'));
  if (!seal || seal.pack !== trialPackId || seal.version !== version
      || typeof seal.methodDigest !== 'string' || !/^[a-f0-9]{64}$/.test(seal.methodDigest)
      || seal.test?.record !== 'TEST.md' || typeof seal.test?.run !== 'string'
      || !seal.files || typeof seal.files !== 'object' || Array.isArray(seal.files)) {
    fail(`trial Pack ${trialPackId} has an invalid native release seal`);
  }
  const sealedFiles = Object.keys(seal.files).sort();
  const currentFiles = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.DS_Store' || name === 'VERSION.yml' || name === 'run-assets' || name.startsWith('.')) continue;
      const at = path.join(directory, name);
      const stat = lstatSync(at);
      if (stat.isDirectory()) walk(at);
      else if (stat.isFile()) currentFiles.push(relative(pack, at));
      else fail(`trial Pack ${trialPackId} contains an unsupported sealed asset ${relative(pack, at)}`);
    }
  };
  walk(pack);
  currentFiles.sort();
  if (JSON.stringify(currentFiles) !== JSON.stringify(sealedFiles)) {
    fail(`trial Pack ${trialPackId} method files differ from VERSION.yml`);
  }
  for (const file of sealedFiles) {
    if (hash(path.join(pack, file)) !== seal.files[file]) fail(`trial Pack ${trialPackId} seal hash differs for ${file}`);
  }
  const documents = [...manifest.matchAll(/^\s*-\s+file:\s+([^\s#]+)\s*$/gm), ...manifest.matchAll(/^\s+file:\s+([^\s#]+)\s*$/gm)]
    .map((match) => match[1])
    .filter((value, index, values) => values.indexOf(value) === index);
  if (documents.length === 0) fail(`trial Pack ${trialPackId} knowledge manifest declares no documents`);
  for (const document of documents) {
    const file = path.join(pack, 'knowledge', document);
    if (!existsSync(file) || !lstatSync(file).isFile()) fail(`trial Pack ${trialPackId} knowledge manifest names missing document ${document}`);
  }
  return { pack, documents, version, methodDigest: seal.methodDigest, testRun: seal.test.run };
}

async function assertTimingPackAssets(packsRoot) {
  const pack = path.join(packsRoot, timingPackId);
  for (const file of ['contract.yml', 'graph.yml', 'knowledge/manifest.yml',
    'flow/closure.py', 'flow/templates/apply-eco.tcl', 'tools/read-output.py']) {
    const at = path.join(pack, file);
    if (!existsSync(at) || !lstatSync(at).isFile()) fail(`timing Pack ${timingPackId} is missing ${file}`);
  }
  const contract = readFileSync(path.join(pack, 'contract.yml'), 'utf8');
  const graph = readFileSync(path.join(pack, 'graph.yml'), 'utf8');
  if (!new RegExp(`^id: ${timingPackId}$`, 'm').test(contract)
      || !new RegExp(`^id: ${timingPackId}$`, 'm').test(graph)) fail('timing Pack contract/graph identity differs');
  const version = /^version:\s*["']?([^"'\s]+)["']?/m.exec(contract)?.[1];
  const graphVersion = /^version:\s*["']?([^"'\s]+)["']?/m.exec(graph)?.[1];
  if (!version || version !== graphVersion) {
    fail('timing Pack contract/graph versions differ');
  }
  for (const file of ['TEST.md', 'VERSION.yml']) {
    if (!existsSync(path.join(pack, file)) || !lstatSync(path.join(pack, file)).isFile()) {
      fail(`timing Pack ${timingPackId} is missing ${file}`);
    }
  }
  // Reuse the native release authority for digest, inventory, hashes and TEST Run binding.
  const { snapshotPackFolder } = await import(pathToFileURL(path.join(root, 'packages/harness/lib/pack-folder.js')).href);
  const { releaseIssue } = await import(pathToFileURL(path.join(root, 'packages/harness/lib/release.js')).href);
  const issue = releaseIssue(snapshotPackFolder(pack), { id: timingPackId, version });
  if (issue) fail(`timing Pack ${timingPackId} native release seal: ${issue}`);
  const seal = parse(readFileSync(path.join(pack, 'VERSION.yml'), 'utf8'));
  if (!seal.methodDigest) fail(`timing Pack ${timingPackId} native release seal lacks methodDigest`);
  return { version, methodDigest: seal.methodDigest, testRun: seal.test.run };
}

const harness = async (module) => import(pathToFileURL(path.join(root, 'packages/harness/lib', module)).href);

/**
 * ATCS ships in development: a seal is optional, but when TEST.md and VERSION.yml are there the
 * native release authority must accept them, and a half seal is refused rather than guessed at.
 */
async function assertAtcsPackAssets(packsRoot, allowDevelopment = internalCandidate) {
  const pack = path.join(packsRoot, atcsPackId);
  for (const file of ['contract.yml', 'graph.yml', 'flow/atcs_cli.py']) {
    const at = path.join(pack, file);
    if (!existsSync(at) || !lstatSync(at).isFile()) fail(`ATCS Pack ${atcsPackId} is missing ${file}`);
  }
  const contract = readFileSync(path.join(pack, 'contract.yml'), 'utf8');
  const graph = readFileSync(path.join(pack, 'graph.yml'), 'utf8');
  if (!new RegExp(`^id: ${atcsPackId}$`, 'm').test(contract)
      || !new RegExp(`^id: ${atcsPackId}$`, 'm').test(graph)) fail('ATCS Pack contract/graph identity differs');
  const version = /^version:\s*["']?([^"'\s]+)["']?/m.exec(contract)?.[1];
  const graphVersion = /^version:\s*["']?([^"'\s]+)["']?/m.exec(graph)?.[1];
  if (!version || version !== graphVersion) fail('ATCS Pack contract/graph versions differ');
  const present = ['TEST.md', 'VERSION.yml'].filter(file => existsSync(path.join(pack, file)));
  if (present.length === 1 && allowDevelopment && present[0] === 'TEST.md' && parse(contract).status === 'development') return { version, development: true };
  if (present.length === 1) fail(`ATCS Pack ${atcsPackId} carries only one of TEST.md and VERSION.yml`);
  if (present.length === 0) return { version };
  const { snapshotPackFolder } = await harness('pack-folder.js');
  const { releaseIssue } = await harness('release.js');
  const issue = releaseIssue(snapshotPackFolder(pack), { id: atcsPackId, version });
  if (issue) fail(`ATCS Pack ${atcsPackId} native release seal: ${issue}`);
  const seal = parse(readFileSync(path.join(pack, 'VERSION.yml'), 'utf8'));
  if (!seal.methodDigest) fail(`ATCS Pack ${atcsPackId} native release seal lacks methodDigest`);
  return { version, methodDigest: seal.methodDigest, testRun: seal.test.run };
}

/**
 * The exact identity of each bundled Pack, in bundle order: its folder digest (the one a Run binds
 * to), its version, its contract status, and its stage — `released` only on an accepted native seal,
 * otherwise the native ladder's own rung.
 */
async function packIdentities(packsRoot, allowDevelopment = internalCandidate) {
  const trial = assertTrialPackAssets(packsRoot);
  const timing = await assertTimingPackAssets(packsRoot);
  assertDemoPackAssets(packsRoot);
  const atcs = await assertAtcsPackAssets(packsRoot, allowDevelopment);
  const { packDigestOf } = await harness('pack-folder.js');
  const { packStage } = await harness('packs.js');
  const seals = { [trialPackId]: trial, [timingPackId]: timing, [atcsPackId]: atcs };
  return bundledPackIds.map(id => {
    const dir = path.join(packsRoot, id);
    const contract = readFileSync(path.join(dir, 'contract.yml'), 'utf8');
    const version = /^version:\s*["']?([^"'\s]+)["']?/m.exec(contract)?.[1];
    const status = /^status:\s*["']?([^"'\s]+)["']?/m.exec(contract)?.[1] ?? 'unstated';
    const seal = seals[id];
    return { id, version, packDigest: packDigestOf(dir), status,
      stage: seal?.methodDigest ? 'released' : seal?.development ? 'development' : packStage(dir).stage,
      ...(seal?.methodDigest ? { methodDigest: seal.methodDigest, testRun: seal.testRun } : {}) };
  });
}

/** The ATCS Site the Pack's binding is qualified at, read from its administrator policy. */
function atcsSiteIdentity(site) {
  for (const file of ['site.yml', 'permit.yml']) {
    if (!existsSync(path.join(site, file)) || !lstatSync(path.join(site, file)).isFile()) fail(`ATCS Site ${atcsSiteId} is missing ${file}`);
  }
  const pins = path.join(site, 'wrapper-pins.json');
  return { id: atcsSiteId, siteSha256: hash(path.join(site, 'site.yml')), permitSha256: hash(path.join(site, 'permit.yml')),
    wrapperPins: existsSync(pins) ? JSON.parse(readFileSync(pins, 'utf8')) : 'absent: wrapper-pins.json' };
}

const copyMethod = (from, to) => cpSync(from, to, { recursive: true, filter: (source) => {
  const name = path.basename(source);
  return !name.startsWith('.') && name !== 'run-assets' && name !== '.evidence';
} });

/** Copy the four bundled Packs into an App's resource tree and prove each landed at its source digest. */
async function stageBundledPacks(fromPacks, resource) {
  if (existsSync(path.join(resource, 'packs'))) fail(`refusing to stage over existing Packs in ${resource}`);
  const source = await packIdentities(fromPacks);
  mkdirSync(path.join(resource, 'packs'), { recursive: true });
  copyMethod(path.join(fromPacks, trialPackId), path.join(resource, trialPackRelative));
  copyMethod(path.join(fromPacks, timingPackId), path.join(resource, timingPackRelative));
  cpSync(path.join(fromPacks, demoPackId), path.join(resource, demoPackRelative), { recursive: true });
  copyMethod(path.join(fromPacks, atcsPackId), path.join(resource, atcsPackRelative));
  const staged = await packIdentities(path.join(resource, 'packs'));
  if (JSON.stringify(staged) !== JSON.stringify(source)) fail('a bundled Pack differs from its source identity after staging');
  return staged;
}

/**
 * Copy the pinned LibInsight web app (ADR-0019) out of a LibInsight git checkout into the App: only the
 * pinned commit's `app/` and `libinsight/`, never the checkout's working tree or its git-ignored data.
 * The copy names its commit and its files' hashes, which the Host shows and --verify checks.
 */
const libInsightPinFile = path.join(root, 'packages/desktop/libinsight.pin.json');
function stageLibInsight(sourceCheckout, resource) {
  const pin = JSON.parse(readFileSync(libInsightPinFile, 'utf8'));
  if (pin.schema !== 'hima-libinsight-pin/1' || !/^[0-9a-f]{40}$/.test(pin.commit ?? '') || !Array.isArray(pin.paths) || !pin.paths.length) fail('packages/desktop/libinsight.pin.json is not a hima-libinsight-pin/1 with a full commit');
  const checkout = path.resolve(sourceCheckout);
  run('git', ['-C', checkout, 'cat-file', '-e', `${pin.commit}^{commit}`]);
  const tree = spawnSync('git', ['-C', checkout, 'archive', '--format=tar', pin.commit, '--', ...pin.paths], { maxBuffer: 256 * 1024 * 1024 });
  if (tree.status !== 0) fail(`git archive of LibInsight ${pin.commit} failed\n${tree.stderr}`);
  const target = path.join(resource, 'libinsight');
  if (existsSync(target)) fail(`refusing to stage LibInsight over ${target}`);
  mkdirSync(target, { recursive: true });
  const unpacked = spawnSync('tar', ['-x', '-C', target], { input: tree.stdout });
  if (unpacked.status !== 0) fail(`unpacking LibInsight failed\n${unpacked.stderr}`);
  if (!existsSync(path.join(target, 'app/server.py'))) fail(`LibInsight ${pin.commit} has no app/server.py`);
  const files = {};
  const walk = (folder) => { for (const name of readdirSync(folder).sort()) { const at = path.join(folder, name); const stat = lstatSync(at);
    if (stat.isSymbolicLink()) fail(`LibInsight ${relative(target, at)} is a symbolic link`);
    if (stat.isDirectory()) walk(at); else files[relative(target, at)] = hash(at); } };
  walk(target);
  writeFileSync(path.join(target, 'LIBINSIGHT-SOURCE.json'), `${JSON.stringify({ schema: 'hima-libinsight-source/1', source: pin.source, commit: pin.commit, paths: pin.paths, files }, null, 2)}\n`);
  return { source: pin.source, commit: pin.commit, fileCount: Object.keys(files).length, sourceSha256: hash(path.join(target, 'LIBINSIGHT-SOURCE.json')) };
}

/** --verify's half for the LibInsight copy: the recorded commit, and every copied file at its hash. */
function verifyLibInsight(resource, recorded) {
  const present = existsSync(path.join(resource, 'libinsight'));
  if (recorded === undefined || typeof recorded === 'string') {
    if (present) fail('the App carries LibInsight code its manifest does not record');
    return;
  }
  const at = path.join(resource, 'libinsight/LIBINSIGHT-SOURCE.json');
  if (!existsSync(at) || hash(at) !== recorded.sourceSha256) fail('bundled LibInsight identity differs from the release manifest');
  const source = JSON.parse(readFileSync(at, 'utf8'));
  if (source.commit !== recorded.commit) fail('bundled LibInsight commit differs from the release manifest');
  for (const [file, sha] of Object.entries(source.files)) {
    if (hash(path.join(resource, 'libinsight', file)) !== sha) fail(`bundled LibInsight file ${file} differs from its recorded hash`);
  }
  process.stdout.write(`package-trial: libinsight ${source.source} ${source.commit} (${Object.keys(source.files).length} files)\n`);
}

async function inspectInteractiveBindings(file, packsRoot, evidenceRoot, atcsOnly = false) {
  if (!path.isAbsolute(file) || !existsSync(file) || !lstatSync(file).isFile()) {
    fail('--interactive-bindings must name an absolute regular administrator file');
  }
  const authority = await harness('interactive-binding.js');
  const { snapshotPackFolder, packDigestExcludes } = await harness('pack-folder.js');
  const { loadPackFrom } = await harness('packs.js');
  // Each row is judged against the Pack its environment names, never against one assumed Pack.
  const interactivePacks = new Map();
  const packFor = (id) => {
    if (id !== timingPackId && id !== atcsPackId) return undefined;
    if (!interactivePacks.has(id)) {
      const folder = snapshotPackFolder(path.join(packsRoot, id));
      interactivePacks.set(id, { pack: loadPackFrom(folder), digest: folder.digest(packDigestExcludes) });
    }
    return interactivePacks.get(id);
  };
  const document = authority.interactiveBindingsDocument.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (document.bindings.length === 0) fail('interactive bindings document has no qualified binding');
  const ids = new Set();
  const bindings = document.bindings.map(row => {
    if (ids.has(row.id)) fail(`duplicate interactive binding ${row.id}`);
    ids.add(row.id);
    const bundledFile = `${qualificationRelative}/environment-${row.environment.sha256}.json`;
    const environmentFile = evidenceRoot ? path.join(evidenceRoot, bundledFile) : row.environment.file;
    if (!path.isAbsolute(row.environment.file) || !existsSync(environmentFile)
        || !lstatSync(environmentFile).isFile() || hash(environmentFile) !== row.environment.sha256) {
      fail(`interactive binding ${row.id} administrator environment bytes differ`);
    }
    if (evidenceRoot && (!existsSync(row.environment.file) || !lstatSync(row.environment.file).isFile()
        || hash(row.environment.file) !== row.environment.sha256)) {
      fail(`interactive binding ${row.id} station administrator environment bytes differ`);
    }
    const environment = authority.interactiveEnvironmentEvidence.parse(JSON.parse(readFileSync(environmentFile, 'utf8')));
    const packId = environment.pack.id;
    if (atcsOnly && (packId !== atcsPackId || row.site !== atcsSiteId)) {
      fail(`--atcs-binding carries only ${atcsPackId} bindings for Site ${atcsSiteId}; ${row.id} names ${packId} at ${row.site}`);
    }
    const bound = packFor(packId);
    if (!bound) fail(`interactive binding ${row.id} names Pack ${packId}, which this App bundles no interactive tool for`);
    const { pack, digest: packDigest } = bound;
    const tool = pack.contract.tools.find(tool => tool.id === row.toolId);
    const templateRoot = realpathSync(path.join(packsRoot, packId));
    const template = path.resolve(templateRoot, environment.sourceTemplate.path);
    const inside = path.relative(templateRoot, template);
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)
        || !existsSync(template) || !lstatSync(template).isFile()) {
      fail(`interactive binding ${row.id} source template is not a regular file inside the ${packId} Pack`);
    }
    const realInside = path.relative(templateRoot, realpathSync(template));
    if (realInside === '..' || realInside.startsWith(`..${path.sep}`) || path.isAbsolute(realInside)) {
      fail(`interactive binding ${row.id} source template escapes the ${packId} Pack`);
    }
    if (row.mutation !== 'qualified' || row.packDigest !== packDigest
        || row.adapterHash !== authority.BUILTIN_TCL_ADAPTER_DIGEST
        || !tool?.interactive || row.commandsDigest !== authority.interactiveCommandsDigest(tool)
        || environment.site !== row.site || environment.toolId !== row.toolId
        || environment.pack.digest !== row.packDigest
        || environment.adapter.id !== row.adapter || environment.adapter.digest !== row.adapterHash
        || environment.commandsDigest !== row.commandsDigest
        || environment.wrapper.path !== tool.interactive.argv[0]
        || hash(template) !== environment.sourceTemplate.sha256) {
      fail(`interactive binding ${row.id} qualification differs from the ${packId} Pack/tool/environment`);
    }
    if (packId === atcsPackId && row.id !== `${row.environment.id}:${row.packDigest.slice(0, 16)}`) {
      fail(`ATCS binding ${row.id} id is not ${row.environment.id}:${row.packDigest.slice(0, 16)}`);
    }
    return { id: row.id, pack: packId, site: row.site, toolId: row.toolId, packDigest: row.packDigest,
      environment: { ...row.environment, bundledFile }, wrapper: environment.wrapper,
      image: environment.image, sourceTemplate: environment.sourceTemplate };
  });
  return { file: bindingsRelative, sha256: hash(file), bindings,
    installation: 'administrator config required; station-scoped absolute environment paths; not portable' };
}

function assertDemoPackAssets(packsRoot) {
  const pack = path.join(packsRoot, demoPackId);
  for (const file of ['contract.yml', 'graph.yml', 'tools/synth.sh']) {
    if (!existsSync(path.join(pack, file)) || !lstatSync(path.join(pack, file)).isFile()) {
      fail(`local demo Pack ${demoPackId} is missing ${file}`);
    }
  }
  const contract = readFileSync(path.join(pack, 'contract.yml'), 'utf8');
  const graph = readFileSync(path.join(pack, 'graph.yml'), 'utf8');
  if (!new RegExp(`^id: ${demoPackId}$`, 'm').test(contract)
      || !new RegExp(`^id: ${demoPackId}$`, 'm').test(graph)) fail('local demo Pack contract/graph identity differs');
  const version = /^version:\s*["']?([^"'\s]+)["']?/m.exec(contract)?.[1];
  const graphVersion = /^version:\s*["']?([^"'\s]+)["']?/m.exec(graph)?.[1];
  if (!version || version !== graphVersion) fail('local demo Pack contract/graph versions differ');
}

function assertSourceTreeIsSafe(base, current = base) {
  for (const name of readdirSync(current)) {
    const at = path.join(current, name);
    const stat = lstatSync(at);
    if (stat.isSymbolicLink()) fail(`source symlink is not an approved release asset: ${relative(base, at)}`);
    if (stat.isDirectory()) assertSourceTreeIsSafe(base, at);
  }
}

function collect(base, current = base, files = {}) {
  for (const name of readdirSync(current).sort()) {
    const at = path.join(current, name);
    if (name === '.DS_Store') continue;
    const stat = lstatSync(at);
    const nameInManifest = relative(base, at);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(at);
      const inside = path.relative(base, target);
      if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) fail(`release symlink escapes bundle: ${nameInManifest} -> ${target}`);
      files[nameInManifest] = `symlink:${readlinkSync(at)}`;
    }
    else if (stat.isDirectory()) collect(base, at, files);
    else if (stat.isFile()) files[nameInManifest] = hash(at);
  }
  return files;
}

/**
 * The identity half of --verify: every bundled Pack and interactive binding against the manifest.
 * It reads only the App's resource tree, so it needs no signed launcher, bundled Node or Electron.
 */
async function verifyBundleIdentity(app, manifest) {
  const resource = resourceFor(app, manifest);
  const postgresManifest = path.join(resource, 'postgres/postgres-runtime.json');
  if (!existsSync(postgresManifest) || manifest.runtimeInputs?.postgres?.manifestSha256 !== hash(postgresManifest)) fail('bundled PostgreSQL identity differs from the release manifest');
  const postgres = JSON.parse(readFileSync(postgresManifest, 'utf8'));
  if (postgres.version !== '16.15' || postgres.platform !== layoutFor(manifest).platform) fail('bundled PostgreSQL version/platform is incompatible');
  if (manifest.runtimeInputs?.sbom && manifest.runtimeInputs.sbom.sha256 !== hash(path.join(resource, manifest.runtimeInputs.sbom.file))) fail('bundled SBOM identity differs from the release manifest');
  if (manifest.runtimeInputs?.node?.binarySha256 && manifest.runtimeInputs.node.binarySha256 !== hash(path.join(resource, 'node/bin/node'))) fail('bundled Node binary identity differs from the release manifest');
  verifyLibInsight(resource, manifest.runtimeInputs?.libinsight);
  const packsRoot = path.join(resource, 'packs');
  const recorded = manifest.runtimeInputs?.packs;
  if (!Array.isArray(recorded)) fail('manifest records no bundled Pack identities');
  const actual = await packIdentities(packsRoot, manifest.purpose === 'internal-u10-candidate');
  for (const pack of actual) {
    const expected = recorded.find(entry => entry?.id === pack.id);
    if (JSON.stringify(expected) !== JSON.stringify(pack)) {
      fail(`bundled Pack ${pack.id} identity differs from the manifest (bundled ${pack.packDigest}, manifest ${expected?.packDigest ?? 'none'})`);
    }
    process.stdout.write(`package-trial: pack ${pack.id} ${pack.version} stage=${pack.stage} packDigest=${pack.packDigest}${pack.methodDigest ? ` methodDigest=${pack.methodDigest}` : ''}\n`);
  }
  if (recorded.length !== actual.length) fail('manifest records a Pack this App does not bundle');
  const site = manifest.runtimeInputs?.atcsSite;
  if (site) {
    process.stdout.write(`package-trial: atcs site ${site.id} site.yml=${site.siteSha256} permit.yml=${site.permitSha256} wrapper-pins=${JSON.stringify(site.wrapperPins)}\n`);
  }
  const bundledBindings = path.join(resource, bindingsRelative);
  let atcsIds = [];
  if (manifest.runtimeInputs?.interactiveBindings || existsSync(bundledBindings)) {
    const bindings = await inspectInteractiveBindings(bundledBindings, packsRoot, resource);
    if (JSON.stringify(bindings) !== JSON.stringify(manifest.runtimeInputs?.interactiveBindings)) {
      fail('manifest interactive binding identity differs from the bundled qualification evidence');
    }
    for (const binding of bindings.bindings) process.stdout.write(`package-trial: binding ${binding.id} (${binding.pack}) packDigest=${binding.packDigest}\n`);
    atcsIds = bindings.bindings.filter(binding => binding.pack === atcsPackId).map(binding => binding.id);
  }
  const expectedAtcs = atcsIds.length ? atcsIds : atcsBindingNone;
  if (JSON.stringify(manifest.runtimeInputs?.atcsBinding) !== JSON.stringify(expectedAtcs)) {
    fail('manifest ATCS binding differs from the bundled qualification evidence');
  }
  process.stdout.write(`package-trial: atcs binding: ${atcsIds.length ? atcsIds.join(', ') : atcsBindingNone}\n`);
}

async function verify(app, allowPending = false) {
  const manifestAt = path.join(path.dirname(app), 'trial-manifest.json');
  if (!existsSync(manifestAt)) fail(`manifest missing: ${manifestAt}`);
  const manifest = JSON.parse(readFileSync(manifestAt, 'utf8'));
  if (!allowPending && manifest.status === 'building') fail('candidate validation has not finished');
  const resource = resourceFor(app, manifest);
  const actual = collect(app);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) fail('manifest hashes or release file list do not match');
  if (manifest.artifactDigest !== undefined
      && manifest.artifactDigest !== createHash('sha256').update(JSON.stringify(actual)).digest('hex')) {
    fail('artifact digest does not match the signed App file inventory');
  }
  const layout = layoutFor(manifest);
  if (layout.platform !== `${process.platform}-${process.arch}`) fail('native verification must run on the candidate target platform');
  for (const required of [layout.executable, ...['lib/main.js', 'node/bin/node', 'profiles/hima/package.json', 'postgres/postgres-runtime.json', 'third-party/SBOM.json', 'third-party/NODE-LICENSE', 'third-party/ELECTRON-LICENSE', 'third-party/CHROMIUM-LICENSES.html', `${trialPackRelative}/contract.yml`, `${trialPackRelative}/graph.yml`, `${trialPackRelative}/knowledge/manifest.yml`, `${timingPackRelative}/contract.yml`, `${timingPackRelative}/graph.yml`, `${demoPackRelative}/contract.yml`, `${demoPackRelative}/graph.yml`, `${atcsPackRelative}/contract.yml`, `${atcsPackRelative}/graph.yml`].map(file => `${layout.resource}/${file}`)]) {
    if (!existsSync(path.join(app, required))) fail(`required release file missing: ${required}`);
  }
  const trialPack = assertTrialPackAssets(path.join(resource, 'packs'));
  if (manifest.runtimeInputs?.trialPack?.id !== trialPackId
      || manifest.runtimeInputs?.trialPack?.version !== trialPack.version
      || manifest.runtimeInputs?.trialPack?.methodDigest !== trialPack.methodDigest
      || manifest.runtimeInputs?.trialPack?.testRun !== trialPack.testRun) {
    fail('manifest trial Pack identity differs from the bundled native release seal');
  }
  const timingPack = await assertTimingPackAssets(path.join(resource, 'packs'));
  if (manifest.runtimeInputs?.timingPack?.id !== timingPackId
      || manifest.runtimeInputs?.timingPack?.version !== timingPack.version
      || manifest.runtimeInputs?.timingPack?.methodDigest !== timingPack.methodDigest
      || manifest.runtimeInputs?.timingPack?.testRun !== timingPack.testRun) {
    fail('manifest timing Pack identity differs from the bundled native release seal');
  }
  await verifyBundleIdentity(app, manifest);
  const architecture = run('file', [path.join(app, layout.executable)]);
  if (!architecture.includes(layout.platform === 'darwin-arm64' ? 'arm64' : 'x86-64')) fail(`launcher architecture differs from ${layout.platform}: ${architecture.trim()}`);
  const nodeVersion = run(path.join(resource, 'node/bin/node'), ['--version']).trim();
  if (!/^v24\./.test(nodeVersion)) fail(`bundled Node is not Node 24: ${nodeVersion}`);
  const dylibs = run(process.platform === 'darwin' ? 'otool' : 'ldd', process.platform === 'darwin' ? ['-L', path.join(resource, 'node/bin/node')] : [path.join(resource, 'node/bin/node')]);
  if (/\/(opt\/homebrew|usr\/local)\//.test(dylibs)) fail(`bundled Node links a local dylib:\n${dylibs}`);
  if (process.platform === 'darwin') run('codesign', ['--verify', '--deep', '--strict', app]);
  const qualificationModule = pathToFileURL(path.join(resource, 'node_modules/@hima/harness/lib/interactive-binding.js')).href;
  const testFlag = run(path.join(resource, 'node/bin/node'), ['--input-type=module', '--eval',
    `import { testFixtureCanRunHere } from ${JSON.stringify(qualificationModule)}; process.stdout.write(String(testFixtureCanRunHere()));`], {
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8', HIMA_TEST_INTERACTIVE_BINDING_ID: 'forged-fixture' },
  }).trim();
  if (testFlag !== 'false') fail('a packaged Host accepted an environment-forged interactive test qualification');
  const runtimeData = mkdtempSync(path.join(path.dirname(app), '.runtime-info-'));
  try {
    const runtime = JSON.parse(run(executableFor(app), ['--runtime-info'], {
      env: { ...process.env, HIMA_USER_DATA: runtimeData, HIMA_NODE: '', npm_node_execpath: '' },
    }));
    if (runtime.isPackaged !== true || runtime.node?.source !== 'bundled-node24' || runtime.node?.available !== true) {
      fail('native application does not select its own packaged Node 24');
    }
  } finally { rmSync(runtimeData, { recursive: true, force: true }); }
  process.stdout.write(`package-trial: verified ${app}\n`);
}

function writeComputerUseLauncher(output) {
  if (process.platform === 'linux') {
    writeFileSync(path.join(output, 'launch-hima-trial.sh'), '#!/bin/sh\nset -eu\nkit_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$kit_dir/HimaHarness/HimaHarness" "$@"\n');
    chmodSync(path.join(output, 'launch-hima-trial.sh'), 0o755);
    writeFileSync(path.join(output, 'COMPUTER-USE-START.md'), '# Start the native Linux trial\n\nRun ./launch-hima-trial.sh from a non-root desktop session with a working Electron sandbox (unprivileged user namespaces). No Docker, global Node or PostgreSQL is required. Do not disable the sandbox. Follow the operation manual supplied for your assigned trial. Install/reopen qualification is recorded separately.\n');
    return;
  }
  const launcher = path.join(output, 'launch-hima-trial.command');
  writeFileSync(launcher, `#!/bin/zsh
set -euo pipefail

kit_dir="\${0:A:h}"
trial_data="$kit_dir/Trial Data"
trial_workspace="$kit_dir/Trial Workspace"
app="$kit_dir/HimaHarness.app"
log="$trial_data/launcher.log"

if [[ ! -d "$app" ]]; then
  print -u2 "HimaHarness.app is missing beside this launcher: $app"
  exit 1
fi

# GitHub/browser downloads attach quarantine metadata. This trial has no Apple Developer ID,
# so Finder/LaunchServices rejects the otherwise valid ad-hoc signature. Remove only quarantine;
# keep every file byte and verify the bundle signature before executing it.
/usr/bin/xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
/usr/bin/codesign --verify --deep --strict "$app"

mkdir -p "$trial_data/dsh" "$trial_workspace"
export HIMA_USER_DATA="$trial_data"
export DSH_HOME="$trial_data/dsh"
export DSH_AGENTS_HOME="$trial_data/dsh/agents"
export HIMA_WORKSPACE="$trial_workspace"
export HIMA_DRIVER_DISPLAY="Catsights"
export DSH_TELEMETRY_DISABLED="1"

{
  print "HimaHarness ${trialVersion} Computer Use launcher"
  print "App: $app"
  print "HIMA_USER_DATA: $HIMA_USER_DATA"
  print "DSH_HOME: $DSH_HOME"
  print "HIMA_WORKSPACE: $HIMA_WORKSPACE"
  print "Display: $HIMA_DRIVER_DISPLAY"
  print "Mode: ordinary GUI (no --driver)"
} | tee -a "$log"

exec "$app/Contents/MacOS/HimaHarness" "$@" > >(tee -a "$log") 2> >(tee -a "$log" >&2)
`);
  chmodSync(launcher, 0o755);
  writeFileSync(path.join(output, 'COMPUTER-USE-START.md'), `# Start HimaHarness for the assigned Computer Use trial

The App is ad-hoc signed because this machine has no Apple Developer ID identity. Start the downloaded
trial from a shell so the kit can remove only macOS download quarantine, verify the unchanged bundle,
create isolated Trial Data and place the window on Catsights:

\`\`\`bash
cd "/path/to/extracted/HimaHarness-${trialVersion}"
zsh ./launch-hima-trial.command
\`\`\`

Keep that shell running. When the window title is \`HimaHarness\`, bind the assigned Computer Use operator to
that app and follow the operation manual supplied for your assigned trial. Do not open the inner \`.app\` directly through
Finder or LaunchServices; Gatekeeper will reject this non-notarized trial.
`);
}

function smokeRelocatedHost(app) {
  const resource = resourceFor(app);
  const pdfFixture = readFileSync(path.join(root, 'test/fixtures/knowledge/eda-clock-guide.pdf')).toString('base64');
  const home = mkdtempSync(path.join(path.dirname(app), '.host-smoke-'));
  let passed = false;
  try {
    const homeModule = pathToFileURL(path.join(resource, 'lib/hima-home.js')).href;
    const hostModule = pathToFileURL(path.join(resource, 'lib/host-launch.js')).href;
    const smoke = `
      import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
      import { himaHomeSources, prepareHimaHome } from ${JSON.stringify(homeModule)};
      import { launchHimaHost } from ${JSON.stringify(hostModule)};
      const home = ${JSON.stringify(home)};
      const workspace = home + '/workspace';
      const bundledPack = ${JSON.stringify(path.join(resource, trialPackRelative))};
      const installedPack = home + '/hima/packs/${trialPackId}';
      const bundledTimingPack = ${JSON.stringify(path.join(resource, timingPackRelative))};
      const installedTimingPack = home + '/hima/packs/${timingPackId}';
      mkdirSync(workspace, { recursive: true });
      // Match ordinary Electron startup, including repairing the profile link on each boot.
      await prepareHimaHome({ home, sources: himaHomeSources(${JSON.stringify(resource)}) });
      // This is the same explicit install boundary a person uses, but its source
      // is inside the candidate's Resources directory. It proves the candidate
      // neither needs a developer checkout nor adopts a pre-existing user home.
      if (!existsSync(bundledPack)) throw new Error('candidate does not carry its DTCO Pack');
      if (!existsSync(bundledTimingPack)) throw new Error('candidate does not carry its timing Pack');
      const knowledgeRuntime = await import(${JSON.stringify(pathToFileURL(path.join(resource, 'node_modules/@hima/harness/lib/index.js')).href)});
      knowledgeRuntime.installPackMethod({ from: bundledPack, to: installedPack });
      knowledgeRuntime.installPackMethod({ from: bundledTimingPack, to: installedTimingPack });
      const pdf = home + '/runtime-knowledge.pdf';
      writeFileSync(pdf, Buffer.from(${JSON.stringify(pdfFixture)}, 'base64'));
      const indexed = await knowledgeRuntime.importCurrentKnowledge({ root: home + '/hima/current-knowledge', scope: 'relocated-smoke', file: pdf });
      const hits = await knowledgeRuntime.searchCurrentKnowledge(home + '/hima/current-knowledge', 'relocated-smoke', 'final routed database');
      if (!hits.length || hits[0].page !== 1) throw new Error('packaged PDF knowledge runtime did not return a page-cited hit');
      const excerpt = await knowledgeRuntime.readCurrentKnowledge(home + '/hima/current-knowledge', 'relocated-smoke', indexed.document.id, hits[0].id);
      if (!/routed database/i.test(excerpt.text)) throw new Error('packaged PDF knowledge runtime did not read the selected source excerpt');
      const host = await launchHimaHost({
        node: ${JSON.stringify(path.join(resource, 'node/bin/node'))},
        dshEntry: ${JSON.stringify(path.join(resource, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))},
        profile: 'hima', cwd: workspace, env: process.env,
      });
      try {
        const opened = await fetch(host.url, { redirect: 'manual' });
        const cookie = opened.headers.get('set-cookie')?.split(';')[0];
        if (opened.status !== 303 || !cookie) throw new Error('packaged Host did not authenticate its session');
        const unscoped = await fetch(new URL('/hima/api/runs', host.url), { headers: { cookie } });
        if (unscoped.status !== 403) throw new Error('packaged Host exposed unscoped Run inventory');
        const created = await fetch(new URL('/api/session/create', host.url), {
          method: 'POST', headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: 'relocated-smoke-session', method: 'session/create',
            payload: { args: { request: { cwd: workspace } } } }),
        });
        const native = await created.json();
        const sessionId = native.result?.value?.sessionId;
        if (native.result?.ok !== true || typeof sessionId !== 'string') throw new Error('packaged Host could not create a native project conversation');
        const response = await fetch(new URL('/hima/api/runs?sessionId=' + encodeURIComponent(sessionId), host.url), { headers: { cookie } });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('packaged Host did not serve its Hima API');
        }
        await response.json();
        const start = await fetch(new URL('/hima/api/start-options?pack=${trialPackId}', host.url), { headers: { cookie } });
        if (!start.ok) throw new Error('packaged Host did not read the bundled DTCO Pack');
        const choices = await start.json();
        if (!Array.isArray(choices.packs) || !choices.packs.includes('${trialPackId}')) throw new Error('cold candidate inventory omitted its installed DTCO Pack');
        if (!choices.packs.includes('${timingPackId}')) throw new Error('cold candidate inventory omitted its installed timing Pack');
        if (choices.proposal?.pack?.id !== '${trialPackId}' || choices.proposal?.knowledge?.ready !== true || choices.proposal?.referenceGraph?.nodes?.length < 1) {
          throw new Error('cold candidate did not expose Pack preparation and knowledge readiness');
        }
        if (choices.proposal?.ready !== false || !Array.isArray(choices.proposal?.unknowns) || !choices.proposal.unknowns.some((item) => /No Site is selected/.test(item))) {
          throw new Error('cold candidate claimed Campaign readiness without a Site');
        }
      } finally { await host.stop(); }
    `;
    run(path.join(resource, 'node/bin/node'), ['--input-type=module', '--eval', smoke], { env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: path.join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1', HIMA_POSTGRES_RUNTIME: path.join(resource, 'postgres') } });
    passed = true;
    process.stdout.write('package-trial: relocated Host smoke passed\n');
  } finally {
    if (passed) rmSync(home, { recursive: true, force: true });
    else process.stderr.write(`package-trial: failed relocated Host smoke retained Home ${home}; inspect resource ownership before cleanup\n`);
  }
}

async function smokeVersionIsolatedTrialHome(app) {
  const userData = mkdtempSync(path.join(path.dirname(app), '.versioned-home-smoke-'));
  const staleHome = path.join(userData, 'trial-dsh');
  const staleLedger = path.join(staleHome, 'storages/hima_ledger.json');
  const workspace = path.join(userData, 'workspace');
  const stale = `${JSON.stringify({ unit: { name: 'hima_ledger', version: 26 }, global: null,
    tables: { runs: {}, records: {} } }, null, 2)}\n`;
  const bootVersionedWindow = (site) => new Promise((resolve, reject) => {
    const child = spawn(executableFor(app), ['--driver', ...(site ? ['--site', site] : [])], {
      cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HIMA_USER_DATA: userData, HIMA_WORKSPACE: workspace, DSH_HOME: '', DSH_AGENTS_HOME: '',
        HIMA_DRIVER_DISPLAY: 'Catsights', DSH_TELEMETRY_DISABLED: '1' },
    });
    let stdout = '', stderr = '', answered = false;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('version-isolated trial home smoke timed out')); }, 60_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!answered && stdout.includes('"id":"host","ok":true')) {
        answered = true;
        child.stdin.write(`${JSON.stringify({ id: 'quit', op: 'quit' })}\n`);
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0 || !answered) reject(new Error(`version-isolated trial home did not boot\n${stderr || stdout}`));
      else resolve({ stdout, stderr });
    });
    child.stdin.write(`${JSON.stringify({ id: 'host', op: 'host' })}\n`);
  });
  try {
    mkdirSync(path.dirname(staleLedger), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(staleLedger, stale);
    const observed = await bootVersionedWindow();
    if (/stored version 26|expected 27/.test(`${observed.stdout}\n${observed.stderr}`)) {
      fail('the new trial adopted the prior trial ledger');
    }
    const versioned = path.join(userData, `trial-dsh-${trialVersion}`);
    if (!observed.stderr.includes(`DSH_HOME is ${versioned}`)
        || !existsSync(path.join(versioned, 'profiles/hima/package.json'))) {
      fail(`versioned trial home was not prepared at ${versioned}`);
    }
    if (readFileSync(staleLedger, 'utf8') !== stale) fail('the prior trial ledger was changed during isolated startup');
    const refusedOldHome = await new Promise((resolve, reject) => {
      const child = spawn(executableFor(app), ['--driver'], {
        cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HIMA_USER_DATA: userData, HIMA_WORKSPACE: workspace,
          DSH_HOME: staleHome, DSH_AGENTS_HOME: path.join(staleHome, 'agents'),
          HIMA_DRIVER_DISPLAY: 'Catsights', DSH_TELEMETRY_DISABLED: '1' },
      });
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('old-home refusal smoke timed out')); }, 30_000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    });
    if (refusedOldHome.code === 0 || !refusedOldHome.stderr.includes('needs Ledger schema')) {
      fail(`an explicit old Hima Home was not refused before mutation: ${refusedOldHome.stderr || refusedOldHome.stdout}`);
    }
    if (readFileSync(staleLedger, 'utf8') !== stale
        || JSON.stringify(readdirSync(staleHome).sort()) !== JSON.stringify(['storages'])) {
      fail('the explicit old Hima Home changed despite refusal');
    }
    const seeded = await bootVersionedWindow('local');
    const demo = path.join(versioned, 'hima/packs', demoPackId, 'contract.yml');
    const siteFile = path.join(versioned, 'hima/sites/local.yml');
    if (!seeded.stderr.includes(`local site: installed the shipped pack ${demoPackId}`)
        || !existsSync(demo) || !existsSync(siteFile)) fail('packaged --site local did not install the verified demo Pack and Site');
    const existingSite = readFileSync(siteFile);
    const existingDemo = readFileSync(demo);
    const reopened = await bootVersionedWindow('local');
    if (!reopened.stderr.includes('local site: preserved the existing Site')
        || !readFileSync(siteFile).equals(existingSite) || !readFileSync(demo).equals(existingDemo)) {
      fail('packaged --site local reopened by changing its existing Site or Pack method');
    }
    process.stdout.write(`package-trial: version-isolated home smoke passed (${path.basename(versioned)})\n`);
  } finally { rmSync(userData, { recursive: true, force: true }); }
}

if (args[0] === '--finalize-native-obligations') {
  const app = path.resolve(value('--finalize-native-obligations') ?? fail('finalization needs an artifact path'));
  const evidenceFile = value('--native-evidence'); const reportFile = value('--report');
  if (!evidenceFile || !reportFile) fail('finalization needs --native-evidence <support packet.json> and --report <new external sidecar.json>');
  const requestedReport = path.resolve(reportFile);
  const realApp = realpathSync(app);
  const manifestFile = path.join(path.dirname(app), 'trial-manifest.json');
  const reportAt = path.join(realpathSync(path.dirname(requestedReport)), path.basename(requestedReport));
  if (reportAt === realApp || reportAt.startsWith(realApp + path.sep) || reportAt === realpathSync(manifestFile)) fail('final report must be external to the immutable artifact and manifest');
  const report = finalizeNativeObligations({app, manifestFile, actualFiles: collect(app), evidenceFile: path.resolve(evidenceFile)});
  // A final report is a new sidecar. Existing files, symlinks and hardlinks must
  // never be overwritten after evidence verification, including support inputs.
  writeFileSync(reportAt, `${JSON.stringify(report, null, 2)}\n`, {flag: 'wx'});
  process.stdout.write(`package-trial: ${report.qualification}; final report ${reportAt}\n`);
} else if (args[0] === '--verify-desktop') {
  const app = value('--verify-desktop');
  if (!app) fail('--verify-desktop needs the frozen native artifact path');
  await verify(path.resolve(app));
  await smokeVersionIsolatedTrialHome(path.resolve(app));
} else if (args[0] === '--check-platform-layout') {
  process.stdout.write(`${JSON.stringify(nativeLayout(args[1]))}\n`);
} else if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write('usage: node scripts/package-trial.mjs [--output <directory>] --node-build-manifest <official archive identity.json> --node-archive <retained official archive> --electron-build-manifest <official zip identity.json> --electron-archive <retained zip> --postgres-prefix <16.15 install> --postgres-build-manifest <identity.json> [--internal-candidate] [--notice-materials <source-bound upstream notices.json>] [--source-materials <fixed source/patch/build inventory.json>] [--interactive-bindings <absolute administrator file>] [--atcs-binding <absolute administrator file>] [--libinsight-source <LibInsight git checkout>] | --finalize-native-obligations <native artifact> --native-evidence <support packet.json> --report <new external sidecar.json> | --verify <native artifact> | --verify-desktop <native artifact>\n');
} else if (args[0] === '--check-interactive-bindings') {
  const file = value('--check-interactive-bindings');
  if (!file) fail('--check-interactive-bindings needs an absolute administrator file');
  const bindings = await inspectInteractiveBindings(file, path.join(root, 'packs'));
  process.stdout.write(`${JSON.stringify(bindings, null, 2)}\n`);
} else if (args[0] === '--check-atcs-binding') {
  const file = value('--check-atcs-binding');
  if (!file) fail('--check-atcs-binding needs an absolute administrator file');
  const bindings = await inspectInteractiveBindings(file, path.join(root, 'packs'), undefined, true);
  process.stdout.write(`${JSON.stringify(bindings, null, 2)}\n`);
} else if (args[0] === '--check-pack-assets') {
  const packs = value('--check-pack-assets');
  if (!packs) fail('--check-pack-assets needs a packs directory');
  const site = value('--site');
  const identities = { packs: await packIdentities(path.resolve(packs)),
    ...(site ? { atcsSite: atcsSiteIdentity(path.resolve(site)) } : {}) };
  process.stdout.write(`package-trial: checked ${trialPackId}, ${timingPackId}, ${demoPackId} and ${atcsPackId} assets\n`);
  process.stdout.write(`${JSON.stringify(identities, null, 2)}\n`);
} else if (args[0] === '--stage-packs') {
  const [from, resource] = [args[1], args[2]];
  if (!from || !resource) fail('--stage-packs needs a packs directory and an App resource directory');
  const packs = await stageBundledPacks(path.resolve(from), path.resolve(resource));
  process.stdout.write(`${JSON.stringify({ packs }, null, 2)}\n`);
} else if (args[0] === '--check-bundle-identity') {
  const app = value('--check-bundle-identity');
  if (!app) fail('--check-bundle-identity needs an app path');
  const manifestAt = path.join(path.dirname(path.resolve(app)), 'trial-manifest.json');
  if (!existsSync(manifestAt)) fail(`manifest missing: ${manifestAt}`);
  const manifest = JSON.parse(readFileSync(manifestAt, 'utf8'));
  if (manifest.status === 'building') fail('candidate validation has not finished');
  await verifyBundleIdentity(path.resolve(app), manifest);
} else if (args[0] === '--verify') {
  const app = value('--verify');
  if (!app) fail('--verify needs an app path');
  await verify(path.resolve(app));
} else {
  const output = path.resolve(value('--output') ?? path.join(root, '.hima-tmp/pilot-release'));
  const layout = nativeLayout(`${process.platform}-${process.arch}`);
  if (!existsSync(node24)) fail(`Node 24 is unavailable at ${node24}`);
  if (!/^v24\./.test(run(node24, ['--version']).trim())) fail('packaging requires Node 24; invoke this script with Node 24 or select HIMA_NODE');
  const nodeBuildManifest = value('--node-build-manifest'); const nodeArchive = value('--node-archive');
  const electronBuildManifest = value('--electron-build-manifest'); const electronArchive = value('--electron-archive');
  if (!nodeBuildManifest || !nodeArchive || !electronBuildManifest || !electronArchive) fail('fixed native archive inputs required: --node-build-manifest, --node-archive, --electron-build-manifest, --electron-archive');
  const postgresPrefix = value('--postgres-prefix');
  const postgresBuildManifest = value('--postgres-build-manifest');
  if (!postgresPrefix || !postgresBuildManifest) fail('native PostgreSQL inputs required: --postgres-prefix <16.15 install> --postgres-build-manifest <pinned build identity.json>');
  if ([layout.artifact, 'trial-manifest.json', 'launch-hima-trial.command', 'launch-hima-trial.sh', 'COMPUTER-USE-START.md']
      .some(name => existsSync(path.join(output, name)))) fail(`refusing to overwrite an existing trial artifact in ${output}`);
  for (const built of ['packages/desktop/lib/main.js', 'packages/harness/lib/index.js', 'packages/harness/lib/client.js']) {
    if (!existsSync(path.join(root, built))) fail(`release inputs are not built: ${built} (run pnpm run build once before packaging)`);
  }
  const untrackedInputs = run('git', ['ls-files', '--others', '--exclude-standard', '--',
    'packages', 'packs', 'profiles', 'scripts', 'THIRD_PARTY_NOTICES.md']).trim();
  if (untrackedInputs && !internalCandidate) fail(`untracked product inputs must be committed before packaging: ${untrackedInputs}`);
  const ignoredInputs = run('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--',
    'packs', 'profiles']).split('\n').filter(Boolean).filter(file => !(file.startsWith('packs/')
      && file.split('/').some(part => part.startsWith('.') || part === 'run-assets')));
  if (ignoredInputs.length) fail(`ignored resource inputs are not approved release assets: ${ignoredInputs.join(', ')}`);
  const source = sourceState();
  if (source.dirty && !internalCandidate) fail('commit tracked product changes before building a release candidate');
  // Admission precedes build/deployment; an unsealed method cannot produce a candidate.
  const timingPack = await assertTimingPackAssets(path.join(root, 'packs'));
  const bindingFile = value('--interactive-bindings');
  if (args.includes('--interactive-bindings') && !bindingFile) fail('--interactive-bindings needs an absolute administrator file');
  const atcsBindingFile = value('--atcs-binding');
  if (args.includes('--atcs-binding') && !atcsBindingFile) fail('--atcs-binding needs an absolute administrator file');
  const bindingSources = [
    ...(bindingFile ? [await inspectInteractiveBindings(bindingFile, path.join(root, 'packs'))] : []),
    ...(atcsBindingFile ? [await inspectInteractiveBindings(atcsBindingFile, path.join(root, 'packs'), undefined, true)] : []),
  ];
  const sourceBindings = bindingSources.flatMap(source => source.bindings);
  const atcsSite = atcsSiteIdentity(path.join(root, atcsSiteRelative));
  // Rebuild the three shipped entry points from this source in this invocation.
  // Existing lib/ bytes are not evidence that they came from the source SHA.
  run(node24, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'packages/harness/tsconfig.json']);
  run(node24, ['scripts/build-client.mjs'], { cwd: path.join(root, 'packages/harness') });
  run(node24, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'packages/desktop/tsconfig.json']);
  if (JSON.stringify(sourceState()) !== JSON.stringify(source)) fail('source changed while the App was being built');
  mkdirSync(output, { recursive: true });
  const stage = mkdtempSync(path.join(output, '.stage-'));
  try {
    const deployed = path.join(stage, 'app');
    run('pnpm', ['--config.verifyDepsBeforeRun=false', '--filter', '@hima/desktop', '--prod', 'deploy', '--legacy', deployed], { env: { ...process.env, CI: 'true', PATH: `${path.dirname(node24)}:${process.env.PATH}` } });
    const electronDist = path.join(root, 'node_modules/.pnpm/electron@44.2.0/node_modules/electron/dist');
    const electronApp = process.platform === 'darwin' ? path.join(electronDist, 'Electron.app') : electronDist;
    if (!existsSync(electronApp)) fail('Electron 44.2 app template is absent from deployed dependencies');
    const app = path.join(output, layout.artifact);
    cpSync(electronApp, app, { recursive: true, dereference: false, verbatimSymlinks: true });
    // Electron uses its executable name to distinguish a packaged app from its SDK.
    renameSync(path.join(app, process.platform === 'darwin' ? 'Contents/MacOS/Electron' : 'electron'), executableFor(app));
    const resource = resourceFor(app);
    cpSync(deployed, resource, { recursive: true, dereference: false, verbatimSymlinks: true, filter: (source) => {
      const parts = relative(deployed, source).split('/');
      return !parts.some((part) => part === 'electron' || part.startsWith('electron@'))
        && !parts.join('/').includes('node_modules/.pnpm/node_modules/@hima/desktop');
    } });
    for (const [built, bundled] of [
      ['packages/desktop/lib/main.js', 'lib/main.js'],
      ['packages/harness/lib/index.js', 'node_modules/@hima/harness/lib/index.js'],
      ['packages/harness/lib/client.js', 'node_modules/@hima/harness/lib/client.js'],
    ]) {
      if (hash(path.join(root, built)) !== hash(path.join(resource, bundled))) {
        fail(`deployed ${bundled} differs from the just-built ${built}`);
      }
    }
    assertSourceTreeIsSafe(path.join(root, 'profiles'));
    assertSourceTreeIsSafe(path.join(root, trialPackRelative));
    assertSourceTreeIsSafe(path.join(root, timingPackRelative));
    assertSourceTreeIsSafe(path.join(root, demoPackRelative));
    assertSourceTreeIsSafe(path.join(root, atcsPackRelative));
    const trialPack = assertTrialPackAssets(path.join(root, 'packs'));
    await assertTimingPackAssets(path.join(root, 'packs'));
    cpSync(path.join(root, 'profiles'), path.join(resource, 'profiles'), { recursive: true });
    const packs = await stageBundledPacks(path.join(root, 'packs'), resource);
    let interactiveBindings;
    if (bindingSources.length) {
      // One bundled document carries the timing and the ATCS rows; each is re-judged against its own bundled Pack.
      const rows = [bindingFile, atcsBindingFile].filter(Boolean)
        .flatMap(file => JSON.parse(readFileSync(file, 'utf8')).bindings);
      mkdirSync(path.join(resource, qualificationRelative), { recursive: true });
      writeFileSync(path.join(resource, bindingsRelative), `${JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: rows }, null, 2)}\n`);
      for (const binding of sourceBindings) {
        cpSync(binding.environment.file, path.join(resource, binding.environment.bundledFile));
      }
      interactiveBindings = await inspectInteractiveBindings(path.join(resource, bindingsRelative), path.join(resource, 'packs'), resource);
      if (JSON.stringify(interactiveBindings.bindings) !== JSON.stringify(sourceBindings)) fail('administrator qualification changed during packaging');
    }
    const atcsBindingIds = (interactiveBindings?.bindings ?? []).filter(binding => binding.pack === atcsPackId).map(binding => binding.id);
    mkdirSync(path.join(resource, 'packages'), { recursive: true });
    symlinkSync('../node_modules/@hima/harness', path.join(resource, 'packages/harness'));
    mkdirSync(path.join(resource, 'node/bin'), { recursive: true });
    cpSync(node24, path.join(resource, 'node/bin/node'));
    const libInsightSource = value('--libinsight-source');
    if (args.includes('--libinsight-source') && !libInsightSource) fail('--libinsight-source needs a LibInsight git checkout');
    const libinsight = libInsightSource ? stageLibInsight(libInsightSource, resource) : 'absent: no --libinsight-source; Data Insight says LibInsight is not installed';
    const postgres = packagePostgres({ prefix: path.resolve(postgresPrefix), buildManifest: path.resolve(postgresBuildManifest), output: path.join(resource, 'postgres') });
    if (JSON.stringify(sourceState()) !== JSON.stringify(source)) fail('source changed while release files were staged');
    const nodeIdentity = stageRuntimeNotices({ resource, electronDist, nodeBinary: node24, nodeManifest: nodeBuildManifest, nodeArchive, electronManifest: electronBuildManifest, electronArchive });
    const sbom = auditDistribution({ app, resource, lockfile: path.join(root, 'pnpm-lock.yaml'), electronVersion: '44.2.0', noticeMaterials: value('--notice-materials') });
    const correspondingSource = stageCorrespondingSource({resource, sourceMaterials:value('--source-materials')});
    cpSync(path.join(root, 'docs/operations/third-party-rights.md'), path.join(resource, 'third-party/RIGHTS.md'));
    if (!internalCandidate && !value('--source-materials')) fail('native release requires its fixed corresponding-source materials');
    if (process.platform === 'darwin') {
    const info = path.join(app, 'Contents/Info.plist');
    const plist = readFileSync(info, 'utf8')
      .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleExecutable</key><string>HimaHarness</string>')
      .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleDisplayName</key><string>HimaHarness</string>')
      .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleIdentifier</key><string>com.hima.harness.trial</string>')
      .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleName</key><string>HimaHarness</string>')
      .replace(/<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleShortVersionString</key><string>${macVersion}</string>`)
      .replace(/<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleVersion</key><string>1</string>');
    writeFileSync(info, plist);
    // Official Electron bundles are linker-signed without resource seals. Sign its known child
    // bundles explicitly before the outer App; --deep would also rewrite pinned PostgreSQL bytes.
    for (const entry of readdirSync(path.join(app, 'Contents/Frameworks')).sort()) {
      if (entry.endsWith('.framework') || entry.endsWith('.app')) run('codesign', ['--force', '--sign', '-', '--timestamp=none', '--preserve-metadata=entitlements,flags', path.join(app, 'Contents/Frameworks', entry)]);
    }
    // This is structural ad-hoc signing, not commercial signing or notarization.
    // The final manifest inventories signed bytes; native inputs retain their upstream hashes.
    run('codesign', ['--force', '--sign', '-', '--timestamp=none',
      '--preserve-metadata=entitlements,flags', app]);
    }
    nodeIdentity.upstreamBinarySha256 = nodeIdentity.binarySha256;
    nodeIdentity.binarySha256 = hash(path.join(resource, 'node/bin/node'));
    const files = collect(app);
    const runtimeLedger = await import(pathToFileURL(path.join(resource, 'node_modules/@hima/harness/lib/ledger.js')).href);
    const manifest = { format: 2, version: trialVersion, appVersion: trialVersion,
      artifactDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
      platform: layout.platform, signing: layout.signing, osBaseline: layout.baseline, purpose: internalCandidate ? 'internal-u10-candidate' : 'trial-release', commercialDistribution: 'not qualified; source/license obligations and actual platform installation acceptance remain separate',
      runtimeInputs: { node: nodeIdentity, sbom, correspondingSource, harnessVersion: JSON.parse(readFileSync(path.join(resource, 'node_modules/@hima/harness/package.json'), 'utf8')).version, dbosVersion: JSON.parse(readFileSync(path.resolve(path.dirname(createRequire(realpathSync(path.join(resource, 'node_modules/@hima/harness/package.json'))).resolve('@dbos-inc/dbos-sdk')), '../../package.json'), 'utf8')).version, electron: nodeIdentity.electron, ledgerSchema: runtimeLedger.ledgerSpec.version,
        postgres: { version: postgres.version, platform: postgres.platform, source: postgres.source,
          manifestSha256: hash(path.join(resource, 'postgres/postgres-runtime.json')) },
        bundledPacks: bundledPackIds, packs, atcsSite, libinsight,
        atcsBinding: atcsBindingIds.length ? atcsBindingIds : atcsBindingNone,
        trialPack: { id: trialPackId, version: trialPack.version, methodDigest: trialPack.methodDigest,
          testRun: trialPack.testRun },
        timingPack: { id: timingPackId, version: timingPack.version, methodDigest: timingPack.methodDigest,
          testRun: timingPack.testRun },
        ...(interactiveBindings ? { interactiveBindings } : {}) },
      compatibility: { home: 'version-isolated; no automatic migration', oldLedger: 'explicit offline import only' },
      impactedChecks: ['local contracts', 'isolated Desktop workbench', 'packaged Host and Pack-read smoke'],
      rollbackRef: 'v0.3.0-trial.18', status: 'building',
      source, files };
    writeFileSync(path.join(output, 'trial-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await verify(app, true);
    // GUI cold-start/reopen belongs to the frozen-candidate operator, after lower gates.
    // The packager never opens a window or counts an unavailable display as PASS.
    smokeRelocatedHost(app);
    writeComputerUseLauncher(output);
    if (JSON.stringify(sourceState()) !== JSON.stringify(source)) fail('source changed before candidate publication');
    // Only the completed kit may carry this label. Publishing the same file
    // inventory by rename keeps a failed smoke from looking like acceptance.
    const accepted = path.join(stage, 'accepted-manifest.json');
    writeFileSync(accepted, `${JSON.stringify({ ...manifest, status: internalCandidate ? 'structurally-verified internal candidate; development Pack; not released or accepted' : 'structurally-verified trial candidate' }, null, 2)}\n`);
    renameSync(accepted, path.join(output, 'trial-manifest.json'));
    await verify(app);
  } catch (error) {
    // These names were absent at admission, so only this attempt can own them.
    // A failed smoke must never leave a signed App beside a verified label.
    for (const name of [layout.artifact, 'trial-manifest.json', 'launch-hima-trial.command', 'launch-hima-trial.sh', 'COMPUTER-USE-START.md']) {
      rmSync(path.join(output, name), { recursive: true, force: true });
    }
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
