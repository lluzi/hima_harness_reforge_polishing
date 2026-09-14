// Build a bounded, unsigned macOS arm64 trial app. This intentionally produces no
// archive or network release: GitHub publication happens only after acceptance.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node24 = '/Users/lluzi/.local/node24/bin/node';
const trialVersion = '0.2.0-trial.1';
const macVersion = '0.2.0';
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

function verify(app) {
  const manifestAt = path.join(path.dirname(app), 'trial-manifest.json');
  if (!existsSync(manifestAt)) fail(`manifest missing: ${manifestAt}`);
  const manifest = JSON.parse(readFileSync(manifestAt, 'utf8'));
  const resource = path.join(app, 'Contents/Resources/app');
  const actual = collect(app);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) fail('manifest hashes or release file list do not match');
  for (const required of ['Contents/MacOS/HimaHarness', 'Contents/Resources/app/lib/main.js', 'Contents/Resources/app/node/bin/node', 'Contents/Resources/app/profiles/hima/package.json', 'Contents/Resources/app/packs/aes-tsmc28-dtco/graph.yml']) {
    if (!existsSync(path.join(app, required))) fail(`required release file missing: ${required}`);
  }
  const architecture = run('file', [path.join(app, 'Contents/MacOS/HimaHarness')]);
  if (!architecture.includes('arm64')) fail(`launcher is not arm64: ${architecture.trim()}`);
  const nodeVersion = run(path.join(resource, 'node/bin/node'), ['--version']).trim();
  if (!/^v24\./.test(nodeVersion)) fail(`bundled Node is not Node 24: ${nodeVersion}`);
  const dylibs = run('otool', ['-L', path.join(resource, 'node/bin/node')]);
  if (/\/(opt\/homebrew|usr\/local)\//.test(dylibs)) fail(`bundled Node links a local dylib:\n${dylibs}`);
  run('codesign', ['--verify', '--deep', '--strict', app]);
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

function smokeRelocatedHost(app) {
  const resource = path.join(app, 'Contents/Resources/app');
  const home = mkdtempSync(path.join(path.dirname(app), '.host-smoke-'));
  try {
    const homeModule = pathToFileURL(path.join(resource, 'lib/hima-home.js')).href;
    const hostModule = pathToFileURL(path.join(resource, 'lib/host-launch.js')).href;
    const smoke = `
      import { mkdirSync } from 'node:fs';
      import { himaHomeSources, prepareHimaHome } from ${JSON.stringify(homeModule)};
      import { launchHimaHost, stopChild } from ${JSON.stringify(hostModule)};
      const home = ${JSON.stringify(home)};
      const workspace = home + '/workspace';
      mkdirSync(workspace, { recursive: true });
      // Match ordinary Electron startup, including repairing the profile link on each boot.
      await prepareHimaHome({ home, sources: himaHomeSources(${JSON.stringify(resource)}) });
      const host = await launchHimaHost({
        node: ${JSON.stringify(path.join(resource, 'node/bin/node'))},
        dshEntry: ${JSON.stringify(path.join(resource, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))},
        profile: 'hima', cwd: workspace, env: process.env,
      });
      try {
        const opened = await fetch(host.url, { redirect: 'manual' });
        const cookie = opened.headers.get('set-cookie')?.split(';')[0];
        if (opened.status !== 303 || !cookie) throw new Error('packaged Host did not authenticate its session');
        const response = await fetch(new URL('/hima/api/runs', host.url), { headers: { cookie } });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('packaged Host did not serve its Hima API');
        }
        await response.json();
      } finally { await stopChild(host.child); }
    `;
    run(path.join(resource, 'node/bin/node'), ['--input-type=module', '--eval', smoke], { env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: path.join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1' } });
    process.stdout.write('package-trial: relocated Host smoke passed\n');
  } finally { rmSync(home, { recursive: true, force: true }); }
}

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write('usage: node scripts/package-trial.mjs [--output <directory>] | --verify <HimaHarness.app>\n');
} else if (args[0] === '--verify') {
  const app = value('--verify');
  if (!app) fail('--verify needs an app path');
  verify(path.resolve(app));
} else {
  const output = path.resolve(value('--output') ?? path.join(root, '.hima-tmp/pilot-release'));
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('this builder must run on macOS arm64');
  if (!existsSync(node24)) fail(`Node 24 is unavailable at ${node24}`);
  if (existsSync(path.join(output, 'HimaHarness.app')) || existsSync(path.join(output, 'trial-manifest.json'))) fail(`refusing to overwrite an existing trial artifact in ${output}`);
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
    assertSourceTreeIsSafe(path.join(root, 'profiles'));
    assertSourceTreeIsSafe(path.join(root, 'packs'));
    cpSync(path.join(root, 'profiles'), path.join(resource, 'profiles'), { recursive: true });
    cpSync(path.join(root, 'packs'), path.join(resource, 'packs'), { recursive: true, filter: (source) => {
      const name = path.basename(source);
      return !name.startsWith('.') && name !== 'run-assets' && name !== '.evidence';
    } });
    mkdirSync(path.join(resource, 'packages'), { recursive: true });
    symlinkSync('../node_modules/@hima/harness', path.join(resource, 'packages/harness'));
    mkdirSync(path.join(resource, 'node/bin'), { recursive: true });
    cpSync(node24, path.join(resource, 'node/bin/node'));
    const sourceSha = run('git', ['rev-parse', 'HEAD']).trim();
    const dirty = run('git', ['status', '--porcelain']).trim() !== '';
    const diffSha256 = createHash('sha256').update(run('git', ['diff', '--binary', 'HEAD'])).digest('hex');
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
    const manifest = { format: 2, version: trialVersion, signing: 'ad-hoc, not notarized',
      source: { sha: sourceSha, dirty, diffSha256 }, files: collect(app) };
    writeFileSync(path.join(output, 'trial-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    verify(app);
    smokeRelocatedHost(app);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
