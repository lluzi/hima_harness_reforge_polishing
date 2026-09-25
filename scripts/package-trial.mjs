// Build a bounded, unsigned macOS arm64 trial app. This intentionally produces no
// archive or network release: GitHub publication happens only after acceptance.
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node24 = '/Users/lluzi/.local/node24/bin/node';
const trialVersion = JSON.parse(readFileSync(path.join(root, 'packages/desktop/package.json'), 'utf8')).version;
const macVersion = trialVersion.split('-')[0];
const trialPackId = 'custom-cell-fmax-dtco';
const trialPackRelative = path.join('packs', trialPackId);
const timingPackId = 'xtop-timing-closure';
const timingPackRelative = path.join('packs', timingPackId);
const demoPackId = 'opene902-timing-probe';
const demoPackRelative = path.join('packs', demoPackId);
const args = process.argv.slice(2);
const value = (flag) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const fail = (message) => { throw new Error(`package-trial: ${message}`); };
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} failed\n${result.stderr || result.stdout}`);
  return result.stdout;
};
const relative = (base, file) => path.relative(base, file).split(path.sep).join('/');
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceState = () => {
  const sha = run('git', ['rev-parse', 'HEAD']).trim();
  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).trim() !== '';
  const diffSha256 = createHash('sha256').update(run('git', ['diff', '--binary', 'HEAD'])).digest('hex');
  return { sha, dirty, diffSha256 };
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

function assertTimingPackAssets(packsRoot) {
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

function verify(app, allowPending = false) {
  const manifestAt = path.join(path.dirname(app), 'trial-manifest.json');
  if (!existsSync(manifestAt)) fail(`manifest missing: ${manifestAt}`);
  const manifest = JSON.parse(readFileSync(manifestAt, 'utf8'));
  if (!allowPending && manifest.status === 'building') fail('candidate validation has not finished');
  const resource = path.join(app, 'Contents/Resources/app');
  const actual = collect(app);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) fail('manifest hashes or release file list do not match');
  if (manifest.artifactDigest !== undefined
      && manifest.artifactDigest !== createHash('sha256').update(JSON.stringify(actual)).digest('hex')) {
    fail('artifact digest does not match the signed App file inventory');
  }
  for (const required of ['Contents/MacOS/HimaHarness', 'Contents/Resources/app/lib/main.js', 'Contents/Resources/app/node/bin/node', 'Contents/Resources/app/profiles/hima/package.json', `Contents/Resources/app/${trialPackRelative}/contract.yml`, `Contents/Resources/app/${trialPackRelative}/graph.yml`, `Contents/Resources/app/${trialPackRelative}/knowledge/manifest.yml`, `Contents/Resources/app/${timingPackRelative}/contract.yml`, `Contents/Resources/app/${timingPackRelative}/graph.yml`, `Contents/Resources/app/${demoPackRelative}/contract.yml`, `Contents/Resources/app/${demoPackRelative}/graph.yml`]) {
    if (!existsSync(path.join(app, required))) fail(`required release file missing: ${required}`);
  }
  const trialPack = assertTrialPackAssets(path.join(resource, 'packs'));
  if (manifest.runtimeInputs?.trialPack?.id !== trialPackId
      || manifest.runtimeInputs?.trialPack?.version !== trialPack.version
      || manifest.runtimeInputs?.trialPack?.methodDigest !== trialPack.methodDigest
      || manifest.runtimeInputs?.trialPack?.testRun !== trialPack.testRun) {
    fail('manifest trial Pack identity differs from the bundled native release seal');
  }
  assertTimingPackAssets(path.join(resource, 'packs'));
  assertDemoPackAssets(path.join(resource, 'packs'));
  const architecture = run('file', [path.join(app, 'Contents/MacOS/HimaHarness')]);
  if (!architecture.includes('arm64')) fail(`launcher is not arm64: ${architecture.trim()}`);
  const nodeVersion = run(path.join(resource, 'node/bin/node'), ['--version']).trim();
  if (!/^v24\./.test(nodeVersion)) fail(`bundled Node is not Node 24: ${nodeVersion}`);
  const dylibs = run('otool', ['-L', path.join(resource, 'node/bin/node')]);
  if (/\/(opt\/homebrew|usr\/local)\//.test(dylibs)) fail(`bundled Node links a local dylib:\n${dylibs}`);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const qualificationModule = pathToFileURL(path.join(resource, 'node_modules/@hima/harness/lib/interactive-binding.js')).href;
  const testFlag = run(path.join(resource, 'node/bin/node'), ['--input-type=module', '--eval',
    `import { testFixtureCanRunHere } from ${JSON.stringify(qualificationModule)}; process.stdout.write(String(testFixtureCanRunHere()));`], {
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8', HIMA_TEST_INTERACTIVE_BINDING_ID: 'forged-fixture' },
  }).trim();
  if (testFlag !== 'false') fail('a packaged Host accepted an environment-forged interactive test qualification');
  const runtimeData = mkdtempSync(path.join(path.dirname(app), '.runtime-info-'));
  try {
    const runtime = JSON.parse(run(path.join(app, 'Contents/MacOS/HimaHarness'), ['--runtime-info'], {
      env: { ...process.env, HIMA_USER_DATA: runtimeData, HIMA_NODE: '', npm_node_execpath: '' },
    }));
    if (runtime.isPackaged !== true || runtime.node?.source !== 'bundled-node24' || runtime.node?.available !== true) {
      fail('native application does not select its own packaged Node 24');
    }
  } finally { rmSync(runtimeData, { recursive: true, force: true }); }
  process.stdout.write(`package-trial: verified ${app}\n`);
}

function writeComputerUseLauncher(output) {
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
  writeFileSync(path.join(output, 'COMPUTER-USE-START.md'), `# Start HimaHarness with Claude Code Computer Use

The App is ad-hoc signed because this machine has no Apple Developer ID identity. Start the downloaded
trial from a shell so the kit can remove only macOS download quarantine, verify the unchanged bundle,
create isolated Trial Data and place the window on Catsights:

\`\`\`bash
cd "/path/to/extracted/HimaHarness-${trialVersion}"
zsh ./launch-hima-trial.command
\`\`\`

Keep that shell running. When the window title is \`HimaHarness\`, bind Claude Code Computer Use to
that app and follow the operation manual supplied for your assigned trial. Do not open the inner \`.app\` directly through
Finder or LaunchServices; Gatekeeper will reject this non-notarized trial.
`);
}

function smokeRelocatedHost(app) {
  const resource = path.join(app, 'Contents/Resources/app');
  const pdfFixture = readFileSync(path.join(root, 'test/fixtures/knowledge/eda-clock-guide.pdf')).toString('base64');
  const home = mkdtempSync(path.join(path.dirname(app), '.host-smoke-'));
  try {
    const homeModule = pathToFileURL(path.join(resource, 'lib/hima-home.js')).href;
    const hostModule = pathToFileURL(path.join(resource, 'lib/host-launch.js')).href;
    const smoke = `
      import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
      import { himaHomeSources, prepareHimaHome } from ${JSON.stringify(homeModule)};
      import { launchHimaHost, stopChild } from ${JSON.stringify(hostModule)};
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
      } finally { await stopChild(host.child); }
    `;
    run(path.join(resource, 'node/bin/node'), ['--input-type=module', '--eval', smoke], { env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: path.join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1' } });
    process.stdout.write('package-trial: relocated Host smoke passed\n');
  } finally { rmSync(home, { recursive: true, force: true }); }
}

async function smokeVersionIsolatedTrialHome(app) {
  const userData = mkdtempSync(path.join(path.dirname(app), '.versioned-home-smoke-'));
  const staleHome = path.join(userData, 'trial-dsh');
  const staleLedger = path.join(staleHome, 'storages/hima_ledger.json');
  const workspace = path.join(userData, 'workspace');
  const stale = `${JSON.stringify({ unit: { name: 'hima_ledger', version: 26 }, global: null,
    tables: { runs: {}, records: {} } }, null, 2)}\n`;
  const bootVersionedWindow = (site) => new Promise((resolve, reject) => {
    const child = spawn(path.join(app, 'Contents/MacOS/HimaHarness'), ['--driver', ...(site ? ['--site', site] : [])], {
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
      const child = spawn(path.join(app, 'Contents/MacOS/HimaHarness'), ['--driver'], {
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

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write('usage: node scripts/package-trial.mjs [--output <directory>] | --verify <HimaHarness.app>\n');
} else if (args[0] === '--check-pack-assets') {
  const packs = value('--check-pack-assets');
  if (!packs) fail('--check-pack-assets needs a packs directory');
  assertTrialPackAssets(path.resolve(packs));
  assertTimingPackAssets(path.resolve(packs));
  assertDemoPackAssets(path.resolve(packs));
  process.stdout.write(`package-trial: checked ${trialPackId}, ${timingPackId} and ${demoPackId} assets\n`);
} else if (args[0] === '--verify') {
  const app = value('--verify');
  if (!app) fail('--verify needs an app path');
  verify(path.resolve(app));
} else {
  const output = path.resolve(value('--output') ?? path.join(root, '.hima-tmp/pilot-release'));
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('this builder must run on macOS arm64');
  if (!existsSync(node24)) fail(`Node 24 is unavailable at ${node24}`);
  if (['HimaHarness.app', 'trial-manifest.json', 'launch-hima-trial.command', 'COMPUTER-USE-START.md']
      .some(name => existsSync(path.join(output, name)))) fail(`refusing to overwrite an existing trial artifact in ${output}`);
  for (const built of ['packages/desktop/lib/main.js', 'packages/harness/lib/index.js', 'packages/harness/lib/client.js']) {
    if (!existsSync(path.join(root, built))) fail(`release inputs are not built: ${built} (run pnpm run build once before packaging)`);
  }
  const untrackedInputs = run('git', ['ls-files', '--others', '--exclude-standard', '--',
    'packages', 'packs', 'profiles']).trim();
  if (untrackedInputs) fail(`untracked product inputs must be committed before packaging: ${untrackedInputs}`);
  const ignoredInputs = run('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--',
    'packs', 'profiles']).split('\n').filter(Boolean).filter(file => !(file.startsWith('packs/')
      && file.split('/').some(part => part.startsWith('.') || part === 'run-assets')));
  if (ignoredInputs.length) fail(`ignored resource inputs are not approved release assets: ${ignoredInputs.join(', ')}`);
  const source = sourceState();
  if (source.dirty) fail('commit tracked product changes before building a release candidate');
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
    const electronApp = path.join(root, 'node_modules/.pnpm/electron@44.2.0/node_modules/electron/dist/Electron.app');
    if (!existsSync(electronApp)) fail('Electron 44.2 app template is absent from deployed dependencies');
    const app = path.join(output, 'HimaHarness.app');
    cpSync(electronApp, app, { recursive: true, dereference: false, verbatimSymlinks: true });
    // Electron uses its executable name to distinguish a packaged app from its SDK.
    renameSync(path.join(app, 'Contents/MacOS/Electron'), path.join(app, 'Contents/MacOS/HimaHarness'));
    const resource = path.join(app, 'Contents/Resources/app');
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
    const trialPack = assertTrialPackAssets(path.join(root, 'packs'));
    assertTimingPackAssets(path.join(root, 'packs'));
    assertDemoPackAssets(path.join(root, 'packs'));
    cpSync(path.join(root, 'profiles'), path.join(resource, 'profiles'), { recursive: true });
    mkdirSync(path.join(resource, 'packs'), { recursive: true });
    cpSync(path.join(root, trialPackRelative), path.join(resource, trialPackRelative), { recursive: true, filter: (source) => {
      const name = path.basename(source);
      return !name.startsWith('.') && name !== 'run-assets' && name !== '.evidence';
    } });
    cpSync(path.join(root, timingPackRelative), path.join(resource, timingPackRelative), { recursive: true, filter: (source) => {
      const name = path.basename(source);
      return !name.startsWith('.') && name !== 'run-assets' && name !== '.evidence';
    } });
    cpSync(path.join(root, demoPackRelative), path.join(resource, demoPackRelative), { recursive: true });
    mkdirSync(path.join(resource, 'packages'), { recursive: true });
    symlinkSync('../node_modules/@hima/harness', path.join(resource, 'packages/harness'));
    mkdirSync(path.join(resource, 'node/bin'), { recursive: true });
    cpSync(node24, path.join(resource, 'node/bin/node'));
    if (JSON.stringify(sourceState()) !== JSON.stringify(source)) fail('source changed while release files were staged');
    const info = path.join(app, 'Contents/Info.plist');
    const plist = readFileSync(info, 'utf8')
      .replace(/<key>CFBundleExecutable<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleExecutable</key><string>HimaHarness</string>')
      .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleDisplayName</key><string>HimaHarness</string>')
      .replace(/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleIdentifier</key><string>com.hima.harness.trial</string>')
      .replace(/<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleName</key><string>HimaHarness</string>')
      .replace(/<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleShortVersionString</key><string>${macVersion}</string>`)
      .replace(/<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleVersion</key><string>1</string>');
    writeFileSync(info, plist);
    // Branding changes invalidate the template signature. Ad-hoc signing keeps the bundle
    // structurally verifiable; it is not commercial signing or notarization. The checksum
    // manifest is external so signing and manifest creation do not invalidate each other.
    run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none',
      '--preserve-metadata=entitlements,flags', app]);
    const files = collect(app);
    const runtimeLedger = await import(pathToFileURL(path.join(resource, 'node_modules/@hima/harness/lib/ledger.js')).href);
    const manifest = { format: 2, version: trialVersion, appVersion: trialVersion,
      artifactDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
      platform: 'macos-arm64', signing: 'ad-hoc, not notarized',
      runtimeInputs: { node: '24', ledgerSchema: runtimeLedger.ledgerSpec.version,
        bundledPacks: [trialPackId, timingPackId, demoPackId],
        trialPack: { id: trialPackId, version: trialPack.version, methodDigest: trialPack.methodDigest,
          testRun: trialPack.testRun } },
      compatibility: { home: 'version-isolated; no automatic migration', oldLedger: 'explicit offline import only' },
      impactedChecks: ['local contracts', 'isolated Desktop workbench', 'packaged Host and Pack-read smoke'],
      rollbackRef: 'v0.3.0-trial.18', status: 'building',
      source, files };
    writeFileSync(path.join(output, 'trial-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    verify(app, true);
    await smokeVersionIsolatedTrialHome(app);
    smokeRelocatedHost(app);
    writeComputerUseLauncher(output);
    if (JSON.stringify(sourceState()) !== JSON.stringify(source)) fail('source changed before candidate publication');
    // Only the completed kit may carry this label. Publishing the same file
    // inventory by rename keeps a failed smoke from looking like acceptance.
    const accepted = path.join(stage, 'accepted-manifest.json');
    writeFileSync(accepted, `${JSON.stringify({ ...manifest, status: 'structurally-verified trial candidate' }, null, 2)}\n`);
    renameSync(accepted, path.join(output, 'trial-manifest.json'));
    verify(app);
  } catch (error) {
    // These names were absent at admission, so only this attempt can own them.
    // A failed smoke must never leave a signed App beside a verified label.
    for (const name of ['HimaHarness.app', 'trial-manifest.json', 'launch-hima-trial.command', 'COMPUTER-USE-START.md']) {
      rmSync(path.join(output, name), { recursive: true, force: true });
    }
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
