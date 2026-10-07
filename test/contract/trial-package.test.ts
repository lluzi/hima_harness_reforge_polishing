// L0/L2 release seam: inspect the product artifact without opening an Electron window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { repoRoot } from './support/dsh-home.ts';

test('the generated Computer Use start guide does not point at an undelivered trial manual', async () => {
  const packager = await readFile(path.join(repoRoot, 'scripts/package-trial.mjs'), 'utf8');
  assert.equal(packager.includes('follow \\`Agent Trial Instructions.md\\`'), false,
    'the release kit does not ship that file, so the generated guide must not tell a new tester to open it');
  assert.match(packager, /follow the operation manual supplied for your assigned trial/);
});

test('trial packager help is inert and its public verifier fails closed for an incomplete app', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-trial-'));
  try {
    const app = path.join(output, 'HimaHarness.app');
    await writeFile(path.join(output, 'note'), 'fixture');
    const help = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--help'], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /usage:/);
    const verified = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--verify', app], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /manifest missing/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('an unfinished candidate manifest cannot be verified or mistaken for a releasable App', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-incomplete-candidate-'));
  try {
    const app = path.join(output, 'HimaHarness.app');
    await writeFile(path.join(output, 'trial-manifest.json'), JSON.stringify({ format: 2, status: 'building', files: {} }));
    const checked = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--verify', app], {
      cwd: repoRoot, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /candidate validation has not finished/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('administrator binding packaging checks exact environment and current method without provisioning a Home', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-binding-package-'));
  const file = path.join(output, 'bindings.json');
  const environmentFile = path.join(output, 'environment.json');
  const check = () => spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'),
    '--check-interactive-bindings', file], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
  try {
    const { snapshotPackFolder, packDigestExcludes } = await import('@hima/harness');
    const { loadPack } = await import('@hima/harness');
    const { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest } = await import('@hima/harness');
    const folder = snapshotPackFolder(path.join(repoRoot, 'packs/xtop-timing-closure'));
    const tool = loadPack(path.join(repoRoot, 'packs'), 'xtop-timing-closure').contract.tools.find(tool => tool.id === 'run-xtop-fix')!;
    const digest = folder.digest(packDigestExcludes);
    const commandsDigest = interactiveCommandsDigest(tool);
    const sha = 'a'.repeat(64);
    const environment = {
      schema: 'hima-interactive-environment/1', site: 'fixture-site', toolId: 'run-xtop-fix',
      pack: { id: 'xtop-timing-closure', digest },
      adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST }, commandsDigest,
      wrapper: { path: tool.interactive!.argv![0], sha256: sha }, image: { reference: 'fixture', digest: `sha256:${sha}` },
      sourceTemplate: { path: 'flow/templates/xtop-operator.tcl', sha256: createHash('sha256').update(
        await readFile(path.join(repoRoot, 'packs/xtop-timing-closure/flow/templates/xtop-operator.tcl'))).digest('hex') },
      confinement: { rootFilesystem: 'read-only', dataRoot: '/fixture/data', dataMount: 'read-only',
        privateWriteRoot: '/fixture/write', network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
      qualification: { status: 'passed', transcriptSha256: sha, logicalEcoSha256: sha, physicalEcoSha256: sha,
        xtopReady: true, identityQuery: true, mutation: true, save: true, sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
    };
    const bytes = JSON.stringify(environment);
    await writeFile(environmentFile, bytes);
    const row = { id: 'fixture-qualified', site: 'fixture-site', packDigest: digest, toolId: 'run-xtop-fix',
      adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest,
      environment: { id: 'fixture-environment', file: environmentFile,
        sha256: createHash('sha256').update(bytes).digest('hex') }, mutation: 'qualified' };
    const writeBindings = async (overrides = {}) => writeFile(file, JSON.stringify({
      schema: 'hima-interactive-bindings/1', bindings: [{ ...row, ...overrides }],
    }));
    await writeBindings();
    const valid = check();
    assert.equal(valid.status, 0, valid.stderr);
    const metadata = JSON.parse(valid.stdout);
    assert.equal(metadata.file, 'operator-qualification/interactive-bindings.json');
    assert.equal(metadata.bindings[0].environment.file, environmentFile);
    assert.equal(metadata.bindings[0].environment.sha256, row.environment.sha256);
    assert.match(metadata.installation, /administrator config required.*not portable/);
    const wrongWrapperBytes = JSON.stringify({ ...environment, wrapper: { ...environment.wrapper, path: '/fixture/wrong-wrapper' } });
    await writeFile(environmentFile, wrongWrapperBytes);
    await writeBindings({ environment: { ...row.environment,
      sha256: createHash('sha256').update(wrongWrapperBytes).digest('hex') } });
    const wrongWrapper = check();
    assert.equal(wrongWrapper.status, 1);
    assert.match(wrongWrapper.stderr, /qualification differs/);
    await writeFile(environmentFile, bytes);
    await writeBindings({ packDigest: 'b'.repeat(64) });
    const wrongPack = check();
    assert.equal(wrongPack.status, 1);
    assert.match(wrongPack.stderr, /qualification differs/);
    await writeBindings({ mutation: 'unavailable' });
    assert.equal(check().status, 1);
    await writeBindings();
    await writeFile(environmentFile, `${bytes}\n`);
    const changedEnvironment = check();
    assert.equal(changedEnvironment.status, 1);
    assert.match(changedEnvironment.stderr, /environment bytes differ/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('trial packager refuses a candidate Pack with no contract or a manifest whose knowledge is absent', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-trial-pack-'));
  const packs = path.join(output, 'packs');
  const pack = path.join(packs, 'custom-cell-fmax-dtco');
  const check = () => spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--check-pack-assets', packs], {
    cwd: repoRoot, encoding: 'utf8', timeout: 10_000,
  });
  try {
    await mkdir(pack, { recursive: true });
    const missingContract = check();
    assert.equal(missingContract.status, 1);
    assert.match(missingContract.stderr, /missing required asset contract\.yml/);

    await mkdir(path.join(pack, 'knowledge'), { recursive: true });
    await writeFile(path.join(pack, 'contract.yml'), 'id: custom-cell-fmax-dtco\nversion: "1"\nknowledgeManifest: knowledge/manifest.yml\n');
    await writeFile(path.join(pack, 'graph.yml'), 'id: custom-cell-fmax-dtco\nentry: bind-inputs\n');
    await writeFile(path.join(pack, 'knowledge/manifest.yml'), [
      'schema: hima-pack-knowledge/1',
      'documents:',
      '  - id: portable-method',
      '    file: portable-method.md',
      '',
    ].join('\n'));
    await writeFile(path.join(pack, 'TEST.md'), '# test receipt\n');
    const writeSeal = async () => {
      const sealed = ['TEST.md', 'contract.yml', 'graph.yml', 'knowledge/manifest.yml',
        ...(existsSync(path.join(pack, 'knowledge/portable-method.md')) ? ['knowledge/portable-method.md'] : [])];
      const hashes = Object.fromEntries(await Promise.all(sealed.map(async file => [file,
        createHash('sha256').update(await readFile(path.join(pack, file))).digest('hex')])));
      await writeFile(path.join(pack, 'VERSION.yml'), [
        'pack: custom-cell-fmax-dtco',
        'version: "1"',
        `methodDigest: ${'a'.repeat(64)}`,
        'released: "2026-09-25T00:00:00.000Z"',
        'test:',
        '  record: TEST.md',
        '  run: run-fixture',
        'files:',
        ...sealed.map(file => `  '${file}': '${hashes[file]}'`),
        '',
      ].join('\n'));
    };
    await writeSeal();
    const missingKnowledge = check();
    assert.equal(missingKnowledge.status, 1);
    assert.match(missingKnowledge.stderr, /names missing document portable-method\.md/);

    await writeFile(path.join(pack, 'knowledge/portable-method.md'), '# portable method\n');
    await writeSeal();
    const missingTiming = check();
    assert.equal(missingTiming.status, 1);
    assert.match(missingTiming.stderr, /timing Pack xtop-timing-closure is missing contract\.yml/);
    const timing = path.join(packs, 'xtop-timing-closure');
    for (const file of ['contract.yml', 'graph.yml', 'knowledge/manifest.yml',
      'flow/closure.py', 'flow/templates/apply-eco.tcl', 'tools/read-output.py']) {
      await mkdir(path.dirname(path.join(timing, file)), { recursive: true });
      await writeFile(path.join(timing, file), file === 'contract.yml'
        ? 'id: xtop-timing-closure\nversion: "1.0.7"\n'
        : file === 'graph.yml' ? 'id: xtop-timing-closure\nversion: "1.0.7"\nentry: export\n' : '# fixture\n');
    }
    await writeFile(path.join(timing, 'graph.yml'), 'id: xtop-timing-closure\nversion: "1.0.6"\nentry: export\n');
    const wrongVersion = check();
    assert.equal(wrongVersion.status, 1);
    assert.match(wrongVersion.stderr, /versions differ/);
    await writeFile(path.join(timing, 'graph.yml'), 'id: xtop-timing-closure\nversion: "1.0.7"\nentry: export\n');
    const missingTest = check();
    assert.equal(missingTest.status, 1);
    assert.match(missingTest.stderr, /timing Pack.*missing TEST\.md/);
    const timingRun = 'run-00000000-0000-4000-8000-000000000001';
    await writeFile(path.join(timing, 'TEST.md'), `## Run\n\nrun: ${timingRun}\n`);
    const missingSeal = check();
    assert.equal(missingSeal.status, 1);
    assert.match(missingSeal.stderr, /timing Pack.*missing VERSION\.yml/);
    const { snapshotPackFolder, packDigestExcludes } = await import('@hima/harness');
    const writeTimingSeal = async (run = timingRun, methodDigest?: string) => {
      const folder = snapshotPackFolder(timing);
      await writeFile(path.join(timing, 'VERSION.yml'), [
        'pack: xtop-timing-closure',
        'version: "1.0.7"',
        `methodDigest: ${methodDigest ?? folder.digest(packDigestExcludes)}`,
        'released: "2026-09-27T00:00:00.000Z"',
        'test:',
        '  record: TEST.md',
        `  run: ${run}`,
        'files:',
        ...folder.sealFiles().map(([file, sha]) => `  '${file}': '${sha}'`),
        '',
      ].join('\n'));
    };
    await writeTimingSeal();
    const missingDemo = check();
    assert.equal(missingDemo.status, 1);
    assert.match(missingDemo.stderr, /local demo Pack opene902-timing-probe is missing contract\.yml/);
    const demo = path.join(packs, 'opene902-timing-probe');
    await mkdir(path.join(demo, 'tools'), { recursive: true });
    await writeFile(path.join(demo, 'contract.yml'), 'id: opene902-timing-probe\n');
    await writeFile(path.join(demo, 'graph.yml'), 'id: opene902-timing-probe\n');
    await writeFile(path.join(demo, 'tools/synth.sh'), '# local demo fixture\n');
    await writeFile(path.join(demo, 'contract.yml'), 'id: unrelated-probe\nversion: "2"\n');
    await writeFile(path.join(demo, 'graph.yml'), 'id: unrelated-probe\nversion: "2"\n');
    const wrongDemo = check();
    assert.equal(wrongDemo.status, 1);
    assert.match(wrongDemo.stderr, /local demo Pack contract\/graph identity differs/);
    await writeFile(path.join(demo, 'contract.yml'), 'id: opene902-timing-probe\nversion: "2"\n');
    await writeFile(path.join(demo, 'graph.yml'), 'id: opene902-timing-probe\nversion: "2"\n');
    const missingAtcs = check();
    assert.equal(missingAtcs.status, 1);
    assert.match(missingAtcs.stderr, /ATCS Pack agentic-timing-closure-system is missing contract\.yml/);
    const atcs = path.join(packs, 'agentic-timing-closure-system');
    await mkdir(path.join(atcs, 'flow'), { recursive: true });
    await writeFile(path.join(atcs, 'contract.yml'), 'id: agentic-timing-closure-system\nversion: "0.1.10"\nstatus: development\n');
    await writeFile(path.join(atcs, 'graph.yml'), 'id: agentic-timing-closure-system\nversion: "0.1.10"\n');
    const missingFlow = check();
    assert.equal(missingFlow.status, 1);
    assert.match(missingFlow.stderr, /ATCS Pack agentic-timing-closure-system is missing flow\/atcs_cli\.py/);
    await writeFile(path.join(atcs, 'flow/atcs_cli.py'), '# fixture\n');
    const missingAnalysis = check();
    assert.equal(missingAnalysis.status, 1);
    assert.match(missingAnalysis.stderr, /analysis Pack libinsight-analysis is missing contract\.yml/);
    const analysis = path.join(packs, 'libinsight-analysis');
    await mkdir(path.join(analysis, 'tools'), { recursive: true }); await mkdir(path.join(analysis, 'flow'), { recursive: true });
    await writeFile(path.join(analysis, 'contract.yml'), 'id: libinsight-analysis\nversion: "0.1.0"\nstatus: development\n');
    await writeFile(path.join(analysis, 'graph.yml'), 'id: libinsight-analysis\nversion: "0.1.0"\n');
    await writeFile(path.join(analysis, 'tools/read-analysis.py'), '# fixture\n'); await writeFile(path.join(analysis, 'flow/libinsight_cli.py'), '# fixture\n');
    const complete = check();
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /checked custom-cell-fmax-dtco, xtop-timing-closure, opene902-timing-probe, agentic-timing-closure-system and libinsight-analysis assets/);
    await writeTimingSeal('run-00000000-0000-4000-8000-000000000002');
    const wrongTimingRun = check();
    assert.equal(wrongTimingRun.status, 1);
    assert.match(wrongTimingRun.stderr, /TEST\.md names run/);
    await writeTimingSeal(timingRun, 'a'.repeat(64));
    const wrongTimingDigest = check();
    assert.equal(wrongTimingDigest.status, 1);
    assert.match(wrongTimingDigest.stderr, /methodDigest.*does not match/);
    await writeTimingSeal();
    await writeFile(path.join(timing, 'flow/closure.py'), '# changed after release\n');
    const changedTiming = check();
    assert.equal(changedTiming.status, 1);
    assert.match(changedTiming.stderr, /flow\/closure\.py no longer hashes/);
    await writeTimingSeal();
    await writeFile(path.join(pack, 'TEST.md'), '# changed after release\n');
    const changedAfterRelease = check();
    assert.equal(changedAfterRelease.status, 1);
    assert.match(changedAfterRelease.stderr, /seal hash differs for TEST\.md/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

const packager = path.join(repoRoot, 'scripts/package-trial.mjs');
const packagerRun = (...args: string[]) => spawnSync(process.execPath, [packager, ...args],
  { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 });
/** --check-pack-assets prints one line of text, then the Pack identities as JSON. */
const identitiesFrom = (stdout: string) => JSON.parse(stdout.slice(stdout.indexOf('\n') + 1));
const bundledPackIds = ['custom-cell-fmax-dtco', 'xtop-timing-closure', 'opene902-timing-probe', 'agentic-timing-closure-system', 'libinsight-analysis'];

test('the trial App stages the ATCS Pack at its exact source digest and its verifier refuses a changed byte', async () => {
  const { packDigestOf } = await import('@hima/harness');
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-atcs-bundle-'));
  const app = path.join(output, 'HimaHarness.app');
  const resource = path.join(app, 'Contents/Resources/app');
  try {
    const staged = packagerRun('--stage-packs', path.join(repoRoot, 'packs'), resource, '--internal-candidate');
    assert.equal(staged.status, 0, staged.stderr);
    const identities = JSON.parse(staged.stdout);
    assert.deepEqual(identities.packs.map((pack: { id: string }) => pack.id), bundledPackIds);
    const atcs = identities.packs.find((pack: { id: string }) => pack.id === 'agentic-timing-closure-system');
    const source = path.join(repoRoot, 'packs/agentic-timing-closure-system');
    assert.equal(atcs.packDigest, packDigestOf(source));
    assert.equal(atcs.packDigest, packDigestOf(path.join(resource, 'packs/agentic-timing-closure-system')));
    assert.match(atcs.version, /^\d+\.\d+\.\d+$/);
    const sealed = existsSync(path.join(source, 'VERSION.yml'));
    assert.equal(atcs.stage === 'released', sealed, 'stage says released exactly when the source carries a release seal');
    assert.equal(typeof atcs.methodDigest === 'string', sealed);
    for (const pack of identities.packs) assert.equal(pack.packDigest, packDigestOf(path.join(repoRoot, 'packs', pack.id)));
    const postgresBytes = JSON.stringify({ version: '16.15', platform: 'darwin-arm64' });
    await mkdir(path.join(resource, 'postgres'));
    await writeFile(path.join(resource, 'postgres/postgres-runtime.json'), postgresBytes);
    const postgresHash = createHash('sha256').update(postgresBytes).digest('hex');
    await writeFile(path.join(output, 'trial-manifest.json'), JSON.stringify({ format: 2,
      status: 'structurally-verified internal candidate', purpose: 'internal-u10-candidate', platform: 'darwin-arm64',
      runtimeInputs: { packs: identities.packs, atcsBinding: 'none, kit installs it', postgres: { manifestSha256: postgresHash } } }));
    const verified = packagerRun('--check-bundle-identity', app);
    assert.equal(verified.status, 0, verified.stderr);
    for (const pack of identities.packs) {
      assert.match(verified.stdout, new RegExp(`pack ${pack.id} ${pack.version.replaceAll('.', '\\.')} stage=${pack.stage} packDigest=${pack.packDigest}`));
    }
    assert.match(verified.stdout, /atcs binding: none, kit installs it/);
    const changed = path.join(resource, 'packs/agentic-timing-closure-system/flow/atcs_cli.py');
    const bytes = await readFile(changed);
    bytes[0] = bytes[0]! ^ 1;
    await writeFile(changed, bytes);
    const refused = packagerRun('--check-bundle-identity', app);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, sealed
      ? /ATCS Pack agentic-timing-closure-system native release seal: .*flow\/atcs_cli\.py no longer hashes/
      : /bundled Pack agentic-timing-closure-system identity differs from the manifest/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('the manifest ATCS stage follows its release seal and the ATCS Site identity is recorded exactly', async () => {
  const { snapshotPackFolder, packDigestExcludes } = await import('@hima/harness');
  const { cp, rm, unlink } = await import('node:fs/promises');
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-atcs-stage-'));
  const packs = path.join(output, 'packs');
  const site = path.join(output, 'site');
  const atcs = path.join(packs, 'agentic-timing-closure-system');
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  try {
    for (const id of bundledPackIds) await cp(path.join(repoRoot, 'packs', id), path.join(packs, id), { recursive: true });
    await rm(path.join(atcs, 'TEST.md'), { force: true });
    await rm(path.join(atcs, 'VERSION.yml'), { force: true });
    await mkdir(site, { recursive: true });
    await writeFile(path.join(site, 'site.yml'), 'id: linglong-atcs28\n');
    await writeFile(path.join(site, 'permit.yml'), 'site: linglong-atcs28\n');
    const unsealed = packagerRun('--check-pack-assets', packs, '--site', site, '--internal-candidate');
    assert.equal(unsealed.status, 0, unsealed.stderr);
    const before = identitiesFrom(unsealed.stdout);
    const developing = before.packs.find((pack: { id: string }) => pack.id === 'agentic-timing-closure-system');
    assert.notEqual(developing.stage, 'released');
    assert.equal(developing.status, 'development');
    assert.equal(developing.methodDigest, undefined);
    assert.deepEqual(before.atcsSite, { id: 'linglong-atcs28', siteSha256: sha('id: linglong-atcs28\n'),
      permitSha256: sha('site: linglong-atcs28\n'), wrapperPins: 'absent: wrapper-pins.json' });
    const pins = { wrapper: { version: 'atcs-v9', path: '/fixture/atcs-xtop-operator-v9.sh', sha256: 'c'.repeat(64) },
      adapterSha256: 'd'.repeat(64), flowDigest: 'e'.repeat(64) };
    await writeFile(path.join(site, 'wrapper-pins.json'), JSON.stringify(pins));
    const pinned = identitiesFrom(packagerRun('--check-pack-assets', packs, '--site', site, '--internal-candidate').stdout);
    assert.deepEqual(pinned.atcsSite.wrapperPins, pins);

    const run = 'run-00000000-0000-4000-8000-000000000009';
    await writeFile(path.join(atcs, 'TEST.md'), `## Run\n\nrun: ${run}\n`);
    const folder = snapshotPackFolder(atcs);
    const methodDigest = folder.digest(packDigestExcludes);
    const version = /^version:\s*["']?([^"'\s]+)["']?/m.exec(await readFile(path.join(atcs, 'contract.yml'), 'utf8'))![1];
    await writeFile(path.join(atcs, 'VERSION.yml'), [
      'pack: agentic-timing-closure-system', `version: "${version}"`, `methodDigest: ${methodDigest}`,
      'released: "2026-09-28T00:00:00.000Z"', 'test:', '  record: TEST.md', `  run: ${run}`, 'files:',
      ...folder.sealFiles().map(([file, digest]) => `  '${file}': '${digest}'`), '',
    ].join('\n'));
    const sealed = packagerRun('--check-pack-assets', packs, '--site', site);
    assert.equal(sealed.status, 0, sealed.stderr);
    const released = identitiesFrom(sealed.stdout).packs.find((pack: { id: string }) => pack.id === 'agentic-timing-closure-system');
    assert.equal(released.stage, 'released');
    assert.equal(released.methodDigest, methodDigest);
    assert.equal(released.testRun, run);

    await writeFile(path.join(atcs, 'flow/atcs_cli.py'), '# changed after release\n');
    const drifted = packagerRun('--check-pack-assets', packs, '--site', site);
    assert.equal(drifted.status, 1);
    assert.match(drifted.stderr, /ATCS Pack agentic-timing-closure-system native release seal: .*flow\/atcs_cli\.py no longer hashes/);
    await unlink(path.join(atcs, 'TEST.md'));
    const halfSealed = packagerRun('--check-pack-assets', packs, '--site', site);
    assert.equal(halfSealed.status, 1);
    assert.match(halfSealed.stderr, /ATCS Pack agentic-timing-closure-system carries only one of TEST\.md and VERSION\.yml/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('legacy interactive bindings retain their own Pack identities and current resident ATCS refuses them', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-atcs-binding-'));
  try {
    const { snapshotPackFolder, packDigestExcludes } = await import('@hima/harness');
    const { loadPack } = await import('@hima/harness');
    const { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest } = await import('@hima/harness');
    // Run the unchanged packager in an isolated historical collection. The main-only v9 identity
    // checks remain meaningful for their complete archived Pack; 0.3 owns outsourced engineering.
    const { cp, symlink } = await import('node:fs/promises');
    const historicalRoot = path.join(output, 'historical-root');
    const sourcePacksDir = path.join(historicalRoot, 'packs');
    await mkdir(path.join(historicalRoot, 'scripts'), { recursive: true });
    await cp(packager, path.join(historicalRoot, 'scripts/package-trial.mjs'));
    for (const helper of ['package-postgres.mjs', 'package-native-audit.mjs']) await cp(path.join(repoRoot, 'scripts', helper), path.join(historicalRoot, 'scripts', helper));
    await symlink(path.join(repoRoot, 'packages'), path.join(historicalRoot, 'packages'), 'dir');
    await symlink(path.join(repoRoot, 'node_modules'), path.join(historicalRoot, 'node_modules'), 'dir');
    await cp(path.join(repoRoot, 'packs/xtop-timing-closure'), path.join(sourcePacksDir, 'xtop-timing-closure'), { recursive: true });
    await cp(path.join(repoRoot, 'packs/agentic-timing-closure-system/legacy/0.1.10'),
      path.join(sourcePacksDir, 'agentic-timing-closure-system'), { recursive: true });
    const legacyPackagerRun = (...args: string[]) => spawnSync(process.execPath,
      [path.join(historicalRoot, 'scripts/package-trial.mjs'), ...args],
      { cwd: historicalRoot, encoding: 'utf8', timeout: 60_000 });
    const sha = 'a'.repeat(64);
    const rowFor = async (packId: string, toolId: string, site: string, environmentId: string, id?: string) => {
      const folder = snapshotPackFolder(path.join(sourcePacksDir, packId));
      const tool = loadPack(sourcePacksDir, packId).contract.tools.find((tool: { id: string }) => tool.id === toolId)!;
      const digest = folder.digest(packDigestExcludes);
      const commandsDigest = interactiveCommandsDigest(tool);
      const environment = {
        schema: 'hima-interactive-environment/1', site, toolId, pack: { id: packId, digest },
        adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST }, commandsDigest,
        wrapper: { path: tool.interactive!.argv![0], sha256: sha }, image: { reference: 'fixture', digest: `sha256:${sha}` },
        sourceTemplate: { path: 'flow/templates/xtop-operator.tcl', sha256: createHash('sha256').update(
          await readFile(path.join(sourcePacksDir, packId, 'flow/templates/xtop-operator.tcl'))).digest('hex') },
        confinement: { rootFilesystem: 'read-only', dataRoot: '/fixture/data', dataMount: 'read-only',
          privateWriteRoot: '/fixture/write', network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
        qualification: { status: 'passed', transcriptSha256: sha, logicalEcoSha256: sha, physicalEcoSha256: sha,
          xtopReady: true, identityQuery: true, mutation: true, save: true, sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
      };
      const bytes = JSON.stringify(environment);
      const environmentFile = path.join(output, `${packId}-environment.json`);
      await writeFile(environmentFile, bytes);
      return { digest, environment, environmentFile, row: { id: id ?? `${environmentId}:${digest.slice(0, 16)}`, site, packDigest: digest, toolId,
        adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest,
        environment: { id: environmentId, file: environmentFile, sha256: createHash('sha256').update(bytes).digest('hex') },
        mutation: 'qualified' } };
    };
    const xtop = await rowFor('xtop-timing-closure', 'run-xtop-fix', 'fixture-site', 'fixture-environment', 'fixture-qualified');
    const atcs = await rowFor('agentic-timing-closure-system', 'xtop-operator', 'linglong-atcs28', 'linglong-atcs28:xtop-operator-v9');
    assert.equal(atcs.row.id, `linglong-atcs28:xtop-operator-v9:${atcs.digest.slice(0, 16)}`);
    const file = path.join(output, 'bindings.json');
    const write = (at: string, rows: object[]) => writeFile(at, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: rows }));
    await write(file, [xtop.row, atcs.row]);
    const both = legacyPackagerRun('--check-interactive-bindings', file);
    assert.equal(both.status, 0, both.stderr);
    assert.deepEqual(JSON.parse(both.stdout).bindings.map((binding: { id: string; pack: string }) => [binding.id, binding.pack]),
      [['fixture-qualified', 'xtop-timing-closure'], [atcs.row.id, 'agentic-timing-closure-system']]);

    const atcsFile = path.join(output, 'atcs-bindings.json');
    await write(atcsFile, [atcs.row]);
    const atcsOnly = legacyPackagerRun('--check-atcs-binding', atcsFile);
    assert.equal(atcsOnly.status, 0, atcsOnly.stderr);
    assert.equal(JSON.parse(atcsOnly.stdout).bindings[0].packDigest, atcs.digest);

    // An ATCS row that names the timing Pack's digest is judged against the ATCS Pack, and refused.
    const foreignDigest = { ...atcs.environment, pack: { ...atcs.environment.pack, digest: xtop.digest } };
    const foreignBytes = JSON.stringify(foreignDigest);
    await writeFile(atcs.environmentFile, foreignBytes);
    await write(atcsFile, [{ ...atcs.row, packDigest: xtop.digest, environment: { ...atcs.row.environment,
      sha256: createHash('sha256').update(foreignBytes).digest('hex') } }]);
    const wrongPack = legacyPackagerRun('--check-atcs-binding', atcsFile);
    assert.equal(wrongPack.status, 1);
    assert.match(wrongPack.stderr, /qualification differs from the agentic-timing-closure-system Pack/);
    await writeFile(atcs.environmentFile, JSON.stringify(atcs.environment));

    await write(atcsFile, [{ ...atcs.row, id: 'linglong-atcs28:xtop-operator-v9:0000000000000000' }]);
    const wrongId = legacyPackagerRun('--check-atcs-binding', atcsFile);
    assert.equal(wrongId.status, 1);
    assert.match(wrongId.stderr, /ATCS binding .* id is not linglong-atcs28:xtop-operator-v9:[0-9a-f]{16}/);
    await write(atcsFile, [xtop.row]);
    const notAtcs = legacyPackagerRun('--check-atcs-binding', atcsFile);
    assert.equal(notAtcs.status, 1);
    assert.match(notAtcs.stderr, /--atcs-binding carries only agentic-timing-closure-system bindings for Site linglong-atcs28/);
    await write(atcsFile, [atcs.row]);
    const obsolete = packagerRun('--check-atcs-binding', atcsFile);
    assert.equal(obsolete.status, 1, 'the current resident method does not admit an archived Operator binding');
    assert.match(obsolete.stderr, /qualification differs from the agentic-timing-closure-system Pack/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});


test('native candidate layout admits only the two declared targets without touching files', () => {
  for (const [platform, resource, executable] of [
    ['darwin-arm64', 'Contents/Resources/app', 'Contents/MacOS/HimaHarness'],
    ['linux-x64', 'resources/app', 'HimaHarness'],
  ] as const) {
    const checked = packagerRun('--check-platform-layout', platform);
    assert.equal(checked.status, 0, checked.stderr);
    const layout = JSON.parse(checked.stdout);
    assert.equal(layout.resource, resource);
    assert.equal(layout.executable, executable);
  }
  const unsupported = packagerRun('--check-platform-layout', 'linux-arm64');
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /unsupported native target/);
});


test('development ATCS is admitted only as an explicit internal candidate and keeps its unreleased identity', async () => {
  const { rm } = await import('node:fs/promises');
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-development-atcs-'));
  const packs = path.join(output, 'packs');
  try {
    for (const id of bundledPackIds) await cp(path.join(repoRoot, 'packs', id), path.join(packs, id), { recursive: true });
    const atcs = path.join(packs, 'agentic-timing-closure-system');
    // Exercise an explicitly unfinished candidate even when the repository Pack is released.
    await rm(path.join(atcs, 'VERSION.yml'), { force: true });
    await writeFile(path.join(atcs, 'TEST.md'), 'Unfinished internal candidate test record\n');
    const normal = packagerRun('--check-pack-assets', packs);
    assert.equal(normal.status, 1);
    assert.match(normal.stderr, /carries only one of TEST.md and VERSION.yml/);
    const checked = packagerRun('--check-pack-assets', packs, '--internal-candidate');
    assert.equal(checked.status, 0, checked.stderr);
    const pack = identitiesFrom(checked.stdout).packs.find((row: { id: string }) => row.id === 'agentic-timing-closure-system');
    assert.equal(pack.version, '0.4.0');
    assert.equal(pack.stage, 'development');
    assert.equal(pack.status, 'development');
    assert.equal(pack.methodDigest, undefined);
    assert.equal(pack.testRun, undefined);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('Linux bundle identity uses native resources and refuses mismatched PostgreSQL platform', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-linux-layout-'));
  try {
    const app = path.join(output, 'HimaHarness');
    const resource = path.join(app, 'resources/app');
    const staged = packagerRun('--stage-packs', path.join(repoRoot, 'packs'), resource, '--internal-candidate');
    assert.equal(staged.status, 0, staged.stderr);
    const packs = JSON.parse(staged.stdout).packs;
    await mkdir(path.join(resource, 'postgres'));
    const manifestFile = path.join(resource, 'postgres/postgres-runtime.json');
    const write = async (platform: string) => {
      const bytes = JSON.stringify({ version: '16.15', platform });
      await writeFile(manifestFile, bytes);
      await writeFile(path.join(output, 'trial-manifest.json'), JSON.stringify({ format: 2, platform: 'linux-x64',
        purpose: 'internal-u10-candidate', status: 'structurally-verified internal candidate',
        runtimeInputs: { packs, atcsBinding: 'none, kit installs it', postgres: { manifestSha256: createHash('sha256').update(bytes).digest('hex') } } }));
    };
    await write('linux-x64');
    const valid = packagerRun('--check-bundle-identity', app);
    assert.equal(valid.status, 0, valid.stderr);
    for (const pack of packs) {
      assert.match(valid.stdout, new RegExp(`pack ${pack.id} ${pack.version.replaceAll('.', '\\.')} stage=${pack.stage} packDigest=${pack.packDigest}`));
    }
    await write('darwin-arm64');
    const wrong = packagerRun('--check-bundle-identity', app);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /version\/platform is incompatible/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});


test('deployed dependency audit inventories exact licenses and names missing distribution material', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-native-notices-'));
  try {
    const resource = path.join(output, 'app/resources/app');
    const dependency = path.join(resource, 'node_modules/example-component');
    await mkdir(dependency, { recursive: true });
    await writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: 'example-component', version: '1.2.3', license: 'MIT' }));
    await writeFile(path.join(dependency, 'LICENSE'), 'Example component copyright and MIT permission\n');
    const lockfile = path.join(output, 'pnpm-lock.yaml');
    await writeFile(lockfile, 'packages:\n  example-component@1.2.3:\n    resolution:\n      integrity: sha512-pinned-source-fixture\n');
    const audit = (noticeMaterials?: string) => spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { auditDistribution } from ${JSON.stringify(new URL('../../scripts/package-native-audit.mjs', import.meta.url).href)};
      console.log(JSON.stringify(auditDistribution(${JSON.stringify({ app: path.join(output, 'app'), resource, lockfile, electronVersion: '44.2.0', ...(noticeMaterials ? { noticeMaterials } : {}) })})));
    `], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    // Apple otool treats a trailing parenthesis as an archive member, even with exact argv.
    if (process.platform === 'darwin') await cp(process.execPath, path.join(resource, 'Helper (GPU)'));
    const good = audit();
    assert.equal(good.status, 0, good.stderr);
    const inventory = JSON.parse(await readFile(path.join(resource, 'third-party/SBOM.json'), 'utf8'));
    if (process.platform === 'darwin') assert.ok(inventory.nativeLinks.some((item: { file: string }) => item.file.endsWith('Helper (GPU)')));
    assert.equal(inventory.npm.length, 1);
    assert.equal(inventory.npm[0].name, 'example-component');
    assert.equal(inventory.npm[0].license, 'MIT');
    assert.equal(inventory.npm[0].licenseFiles[0].file, 'node_modules/example-component/LICENSE');
    assert.equal(inventory.npm[0].source.integrity, 'sha512-pinned-source-fixture');
    assert.deepEqual(inventory.unresolved, []);
    await (await import('node:fs/promises')).rm(path.join(dependency, 'LICENSE'));
    const absent = audit();
    assert.equal(absent.status, 0, absent.stderr);
    assert.match(JSON.parse(absent.stdout).unresolved[0], /example-component@1.2.3 at .*: no standalone license\/notice file/);
    const notice = path.join(output, 'upstream-LICENSE');
    const noticeBytes = 'Example copyright and retained MIT license text\n';
    await writeFile(notice, noticeBytes);
    const materials = path.join(output, 'notice-materials.json');
    const upstream = { format: 'hima-notice-materials/1', packages: [{ name: 'example-component', version: '1.2.3',
      npmIntegrity: 'sha512-pinned-source-fixture', files: [{ file: 'upstream-LICENSE',
        sha256: createHash('sha256').update(noticeBytes).digest('hex'), url: 'https://github.com/example/component/raw/frozen/LICENSE' }] }] };
    await writeFile(materials, JSON.stringify(upstream));
    const supplied = audit(materials);
    assert.equal(supplied.status, 0, supplied.stderr);
    assert.deepEqual(JSON.parse(supplied.stdout).unresolved, []);
    const copied = JSON.parse(await readFile(path.join(resource, 'third-party/SBOM.json'), 'utf8')).npm[0].supplementalLicenseFiles[0];
    assert.equal(await readFile(path.join(resource, copied.file), 'utf8'), noticeBytes);
    upstream.packages[0]!.npmIntegrity = 'sha512-other-package';
    await writeFile(materials, JSON.stringify(upstream));
    const foreign = audit(materials);
    assert.equal(foreign.status, 1);
    assert.match(foreign.stderr, /supplemental notices do not match actual npm source/);

  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('supplemental notices preserve distinct same-basename bytes and refuse invalid source material', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hima-supplemental-notices-'));
  try {
    const app = path.join(directory, 'app');
    const resource = path.join(app, 'resources/app');
    const dependency = path.join(resource, 'node_modules/example-component');
    await mkdir(dependency, { recursive: true });
    await writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: 'example-component', version: '1.2.3', license: 'MIT' }));
    const lockfile = path.join(directory, 'pnpm-lock.yaml');
    await writeFile(lockfile, 'packages:\n  example-component@1.2.3:\n    resolution:\n      integrity: sha512-pinned-source-fixture\n');
    const originals = [
      { file: 'dependency-a/LICENSE', bytes: 'Dependency A copyright and MIT license\n' },
      { file: 'dependency-b/LICENSE', bytes: 'Dependency B copyright and MIT license\n' },
    ];
    for (const entry of originals) {
      await mkdir(path.dirname(path.join(directory, entry.file)), { recursive: true });
      await writeFile(path.join(directory, entry.file), entry.bytes);
    }
    const supplemental = { name: 'example-component', version: '1.2.3', npmIntegrity: 'sha512-pinned-source-fixture',
      files: originals.map(entry => ({ file: entry.file, sha256: createHash('sha256').update(entry.bytes).digest('hex'),
        url: 'https://github.com/example/component/raw/frozen/' + entry.file })) };
    const noticeMaterials = path.join(directory, 'notice-materials.json');
    const audit = async () => {
      await writeFile(noticeMaterials, JSON.stringify({ format: 'hima-notice-materials/1', packages: [supplemental] }));
      return spawnSync(process.execPath, ['--input-type=module', '--eval', `
        import { auditDistribution } from ${JSON.stringify(new URL('../../scripts/package-native-audit.mjs', import.meta.url).href)};
        console.log(JSON.stringify(auditDistribution(${JSON.stringify({ app, resource, lockfile, electronVersion: '44.2.0', noticeMaterials })})));
      `], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    };
    const valid = await audit();
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout).unresolved, []);
    const inventory = JSON.parse(await readFile(path.join(resource, 'third-party/SBOM.json'), 'utf8'));
    const records = inventory.npm[0].supplementalLicenseFiles;
    assert.equal(records.length, originals.length);
    assert.equal(new Set(records.map((entry: { file: string }) => entry.file)).size, originals.length,
      'each distinct notice must survive at a distinct delivered path');
    for (const [index, original] of originals.entries()) {
      const record = records[index];
      assert.equal(record.file, 'third-party/upstream/example-component-1.2.3/' + original.file);
      const staged = await readFile(path.join(resource, record.file));
      assert.equal(staged.toString('utf8'), original.bytes);
      assert.equal(createHash('sha256').update(staged).digest('hex'), record.sha256,
        'each final SBOM notice hash must describe the final staged bytes');
      assert.equal(record.sha256, supplemental.files[index]!.sha256);
    }
    await writeFile(path.join(directory, originals[0]!.file), 'changed upstream notice');
    const changed = await audit();
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /upstream notice bytes differ/);
    await writeFile(path.join(directory, originals[0]!.file), originals[0]!.bytes);
    supplemental.npmIntegrity = 'sha512-other-source';
    const foreign = await audit();
    assert.equal(foreign.status, 1);
    assert.match(foreign.stderr, /supplemental notices do not match actual npm source/);
    supplemental.npmIntegrity = 'sha512-pinned-source-fixture';
    const first = supplemental.files[0]!;
    for (const invalid of ['../outside/LICENSE', path.join(directory, originals[0]!.file)]) {
      first.file = invalid;
      const refused = await audit();
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /invalid upstream notice reference/);
    }
    const { symlink } = await import('node:fs/promises');
    // The package tree is still inside this temporary directory; use a separate materials root
    // to exercise a link that escapes the admitted upstream-material directory.
    const narrowMaterials = path.join(directory, 'dependency-a/notice-materials.json');
    await symlink(path.join(directory, 'dependency-b/LICENSE'), path.join(directory, 'dependency-a/linked-LICENSE'));
    first.file = 'linked-LICENSE';
    first.sha256 = supplemental.files[1]!.sha256;
    await writeFile(narrowMaterials, JSON.stringify({ format: 'hima-notice-materials/1', packages: [supplemental] }));
    const escaped = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import { auditDistribution } from ${JSON.stringify(new URL('../../scripts/package-native-audit.mjs', import.meta.url).href)};
      auditDistribution(${JSON.stringify({ app, resource, lockfile, electronVersion: '44.2.0', noticeMaterials: narrowMaterials })});
    `], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    assert.equal(escaped.status, 1);
    assert.match(escaped.stderr, /upstream notice bytes differ/);
  } finally { await (await import('node:fs/promises')).rm(directory, { recursive: true, force: true }); }
});

test('corresponding source retains exact bytes and refuses changed or foreign material', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'hima-source-materials-'));
  try {
    const resource=path.join(directory,'app');await mkdir(path.join(resource,'third-party'),{recursive:true});
    await writeFile(path.join(resource,'third-party/SBOM.json'),JSON.stringify({electron:{version:'44.2.0'},npm:[{name:'@img/sharp-libvips-darwin-arm64',version:'1.3.3'}]}));
    const source='retained upstream source and its original notices\n';
    await writeFile(path.join(directory,'source.tar'),source);
    const manifest={format:'hima-corresponding-source/1',components:{electron:'44.2.0',sharpLibvips:'1.3.3'},files:[{file:'source.tar',sha256:createHash('sha256').update(source).digest('hex')}]};
    const input=path.join(directory,'input.json');await writeFile(input,JSON.stringify(manifest));
    const stage=()=>spawnSync(process.execPath,['--input-type=module','--eval',`
      import {stageCorrespondingSource} from ${JSON.stringify(new URL('../../scripts/package-native-audit.mjs',import.meta.url).href)};
      console.log(JSON.stringify(stageCorrespondingSource(${JSON.stringify({resource,sourceMaterials:input})})));
    `],{encoding:'utf8'});
    const good=stage();assert.equal(good.status,0,good.stderr);
    assert.equal(await readFile(path.join(resource,'third-party/corresponding-source/source.tar'),'utf8'),source);
    await writeFile(path.join(directory,'source.tar'),'changed source');
    const changed=stage();assert.notEqual(changed.status,0);assert.match(changed.stderr,/source bytes differ/);
    assert.equal(await readFile(path.join(resource,'third-party/corresponding-source/source.tar'),'utf8'),source);
    await writeFile(path.join(directory,'source.tar'),source);
    manifest.components.electron='44.1.0';await writeFile(input,JSON.stringify(manifest));
    assert.match(stage().stderr,/actual native components/);
    manifest.components.electron='44.2.0';manifest.files[0]!.file='../foreign-source.tar';await writeFile(input,JSON.stringify(manifest));
    assert.match(stage().stderr,/invalid corresponding source inventory/);
  } finally { await (await import('node:fs/promises')).rm(directory,{recursive:true,force:true}); }
});

test('native inventory hashing matches SHA256 across empty, binary and multiple chunks', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'hima-hash-'));
  try {
    for(const bytes of [Buffer.alloc(0),Buffer.from('原始材料\n'),Buffer.alloc(131073,0xab)]) {
      const file=path.join(directory,'material');await writeFile(file,bytes);
      const result=spawnSync(process.execPath,['--input-type=module','--eval',`
        import {hashFile} from ${JSON.stringify(new URL('../../scripts/package-native-audit.mjs',import.meta.url).href)};
        console.log(hashFile(${JSON.stringify(file)}));
      `],{encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout.trim(),createHash('sha256').update(bytes).digest('hex'));
    }
  } finally { await (await import('node:fs/promises')).rm(directory,{recursive:true,force:true}); }
});

test('packaged Mac and Linux modules reject forged interactive fixture authorization, and every layout refuses a Home with an active legacy Run', async () => {
  const {symlink,rm,readdir}=await import('node:fs/promises');
  const {pathToFileURL}=await import('node:url');
  const directory=await mkdtemp(path.join(os.tmpdir(),'hima-fixture-layout-'));
  const packageRoot=path.join(repoRoot,'packages/harness');
  const inspect=(root:string,home:string)=>spawnSync(process.execPath,['--input-type=module','--eval',`
    import {testFixtureCanRunHere} from ${JSON.stringify(pathToFileURL(path.join(root,'lib/interactive-binding.js')).href)};
    import {assertHomeExecutionAllowed} from ${JSON.stringify(pathToFileURL(path.join(root,'lib/local-database.js')).href)};
    let error;try{await assertHomeExecutionAllowed({home:${JSON.stringify(home)}});}catch(value){error=String(value);}
    console.log(JSON.stringify({interactive:testFixtureCanRunHere(),activeAllowed:!error,error}));
  `],{encoding:'utf8',timeout:10000,env:{...process.env,DSH_HOME:home,NODE_TEST_CONTEXT:'forged',HIMA_TEST_INTERACTIVE_BINDING_ID:'forged-fixture'}});
  const ledgerBytes=JSON.stringify({unit:{name:'hima_ledger',version:34},tables:{runs:{original:{id:'original',status:'waiting',currentNode:'engineering'}}}});
  const oldHome=async(name:string)=>{
    const home=path.join(directory,name);await mkdir(path.join(home,'storages'),{recursive:true});
    await writeFile(path.join(home,'storages/hima_ledger.json'),ledgerBytes);return home;
  };
  const preserved=async(home:string)=>{
    assert.equal(await readFile(path.join(home,'storages/hima_ledger.json'),'utf8'),ledgerBytes);
    assert.deepEqual(await readdir(home),['storages']);
  };
  try {
    const sourceHome=await oldHome('source-home');const source=inspect(packageRoot,sourceHome);
    assert.equal(source.status,0,source.stderr);
    const fromSource=JSON.parse(source.stdout);
    assert.equal(fromSource.interactive,true,'the source tree keeps its trusted interactive test fixture');
    assert.equal(fromSource.activeAllowed,false,'no test context bypasses the cutover gate');
    assert.match(fromSource.error,/Active legacy Run original prevents DBOS cutover/);await preserved(sourceHome);
    for(const [name,layout] of [['mac','HimaHarness.app/Contents/Resources/app'],['linux','HimaHarness/resources/app']] as const) {
      const root=path.join(directory,layout,'node_modules/@hima/harness');
      await cp(packageRoot,root,{recursive:true,filter:file=>!file.startsWith(path.join(packageRoot,'node_modules'))});
      await symlink(path.join(packageRoot,'node_modules'),path.join(root,'node_modules'),'dir');
      const home=await oldHome(name+'-home');const packaged=inspect(root,home);assert.equal(packaged.status,0,packaged.stderr);
      const result=JSON.parse(packaged.stdout);
      assert.equal(result.interactive,false,`interactive fixture authority must be unavailable in ${layout}`);
      assert.equal(result.activeAllowed,false,`active legacy history must prevent cutover in ${layout}`);
      assert.match(result.error,/Active legacy Run original prevents DBOS cutover/);await preserved(home);
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});


test('final technical-obligation report binds real evidence to immutable artifact bytes', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-final-obligations-'));
  const app = path.join(output, 'HimaHarness');
  const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
  const files: Record<string, string> = {};
  const put = async (file: string, data: unknown, bundled = false) => {
    const bytes = typeof data === 'string' ? data : JSON.stringify(data);
    const at = path.join(bundled ? app : output, file);
    await mkdir(path.dirname(at), {recursive: true}); await writeFile(at, bytes);
    if (bundled) files[file] = sha(bytes);
    return {file: at, sha256: sha(bytes)};
  };
  const resource = 'resources/app';
  const finding = '@img/sharp-libvips-linux-x64@1.3.3 at node_modules/vips/lib: LGPL native binary and embedded libraries require exact upstream license/copyright disclosures, corresponding-source/build material, and verified library replacement or relinking terms before commercial distribution';
  const run = (report = path.join(output, 'final-native-obligations.json')) => spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'),
    '--finalize-native-obligations', app, '--native-evidence', path.join(output, 'evidence.json'),
    '--report', report], {cwd: repoRoot, encoding: 'utf8', timeout: 10000});
  try {
    await put('HimaHarness', 'actual-consumer', true);
    await put('libffmpeg.so', 'original ffmpeg', true);
    await put(`${resource}/node_modules/vips/lib/libvips-cpp.so.8.18.6`, 'original vips', true);
    const patches = [];
    for (const name of ['ffmpeg', 'vips']) {
      const file = `reconstruction/${name}-u9-source-modification.patch`;
      const ref = await put(`${resource}/third-party/corresponding-source/${file}`, `diff: ${name}-hima-u9-source-modified`, true);
      patches.push({file, sha256: ref.sha256});
    }
    const source = await put(`${resource}/third-party/corresponding-source/manifest.json`, {
      format: 'hima-corresponding-source/1', components: {electron: '44.2.0', sharpLibvips: '1.3.3'}, files: patches,
      qualification: 'declaration must not close replacement obligations'}, true);
    const rights = await put(`${resource}/third-party/RIGHTS.md`, 'Recipients may modify and replace libraries and reverse engineer for debugging; source available.', true);
    const license = await put('vips-LICENSE', 'LGPL upstream license and original copyrights');
    await put(`${resource}/third-party/upstream/_img_sharp-libvips-linux-x64-1.3.3/vips-LICENSE`, 'LGPL upstream license and original copyrights', true);
    const notice = await put('notices.json', {format: 'hima-notice-materials/1', packages: [{name: '@img/sharp-libvips-linux-x64', version: '1.3.3', npmIntegrity: 'pinned', files: [{file: 'vips-LICENSE', sha256: license.sha256}]}]});
    const sbom = await put(`${resource}/third-party/SBOM.json`, {format: 'hima-distribution-sbom/1', platform: 'linux-x64', noticeMaterialsSha256: notice.sha256,
      electron: {version: '44.2.0'}, npm: [{name: '@img/sharp-libvips-linux-x64', version: '1.3.3', path: 'node_modules/vips', source: {integrity: 'pinned'}, supplementalLicenseFiles: [{file: 'third-party/upstream/_img_sharp-libvips-linux-x64-1.3.3/vips-LICENSE', sha256: license.sha256}]}],
      nativeLinks: [{file: 'HimaHarness'}, {file: 'libffmpeg.so'}, {file: `${resource}/node_modules/vips/lib/libvips-cpp.so.8.18.6`}], unresolved: [finding]}, true);
    const ordered = Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const file of Object.keys(files)) delete files[file];
    Object.assign(files, Object.fromEntries(ordered));
    const digest = () => sha(JSON.stringify(files));
    const tested = await put('tested-manifest.json', {platform: 'linux-x64', files: {...files}, artifactDigest: digest()});
    const runtime = await put('runtime.json', {sourceArtifactDigest: digest(), status: 'pass', ffmpegSourceMarker: 'ffmpeg-hima-u9-source-modified',
      vipsSourceMarker: 'vips-hima-u9-source-modified', actualElectronLoaderMappedReplacement: true,
      headlessHost: {status: 'pass', actualHostMappedModifiedVips: true, sharpImage: {width: 8, height: 8, format: 'png'}, hostExit: 0, stopReceiptConfirmed: true}, remainingOwnedProcesses: []});
    const components = [];
    for (const [component, library] of [['ffmpeg', 'libffmpeg.so'], ['sharp-libvips', `${resource}/node_modules/vips/lib/libvips-cpp.so.8.18.6`]]) {
      const marker = `${component === 'ffmpeg' ? 'ffmpeg' : 'vips'}-hima-u9-source-modified`;
      const rebuilt = await put(`rebuilt-${component}`, `source compiled ${marker}`);
      await put(`replacement/${library}`, `source compiled ${marker}`);
      const build = await put(`build-${component}.json`, {status: 'source-rebuild-pass', wholeLibrarySourceRebuild: true, sourceCount: 314,
        sourceRevision: 'pinned-revision', sourceModification: 'diagnostic C source change', sha256: rebuilt.sha256, av_version_info: marker, modifiedSymbol: marker});
      const abi = await put(`abi-${component}.json`, {interfaceStatus: 'pass', interfaceStaticStatus: 'pass', allActualConsumerInterfaceImportsPresent: true,
        consumerRequired: 45, consumerRequiredMissing: [], consumerMissingFromDependencyClosure: [], sha256: rebuilt.sha256});
      components.push({component, library, build, interface: abi, rebuiltLibrary: rebuilt,
        sourceChange: patches[component === 'ffmpeg' ? 0 : 1]});
    }
    const packet = {format: 'hima-native-replacement-evidence/1', platform: 'linux-x64', testedManifest: tested,
      replacementApp: path.join(output, 'replacement'), runtime, sourceSha256: source.sha256, rightsSha256: rights.sha256,
      noticeMaterials: notice, components};
    await put('evidence.json', packet);
    const seal = async () => put('trial-manifest.json', {format: 2, status: 'structurally-verified trial candidate', platform: 'linux-x64', files, artifactDigest: digest(),
      runtimeInputs: {sbom: {file: 'third-party/SBOM.json', sha256: sbom.sha256}, correspondingSource: {file: 'third-party/corresponding-source/manifest.json', sha256: source.sha256}}});
    await seal();
    const before = JSON.stringify(files);
    const good = run(); assert.equal(good.status, 0, good.stderr);
    const report = JSON.parse(await readFile(path.join(output, 'final-native-obligations.json'), 'utf8'));
    assert.equal(report.qualification, 'technical-obligations-qualified-for-stated-scope');
    assert.deepEqual(report.rawUnresolved, [finding]); assert.deepEqual(report.effectiveUnresolved, []);
    assert.equal(report.resolvedObligationIds.length, 2); assert.equal(report.legalClearance, 'not claimed');
    assert.equal(report.identities.artifactDigest, digest());
    assert.equal(JSON.stringify(files), before);
    for (const [file, hash] of Object.entries(files)) assert.equal(sha(await readFile(path.join(app, file), 'utf8')), hash, file);
    assert.equal(report.applicableStagedNotices, 1);
    const existingReport = await readFile(path.join(output, 'final-native-obligations.json'), 'utf8');
    const repeat = run(); assert.notEqual(repeat.status, 0); assert.match(repeat.stderr, /EEXIST/);
    assert.equal(await readFile(path.join(output, 'final-native-obligations.json'), 'utf8'), existingReport);
    const manifestBytes = await readFile(path.join(output, 'trial-manifest.json'), 'utf8');
    const aliases = await import('node:fs/promises');
    const outputSymlink = path.join(output, 'source-output-alias.json');
    await aliases.symlink(source.file, outputSymlink);
    const outputHardlink = path.join(output, 'manifest-output-alias.json');
    await aliases.link(path.join(output, 'trial-manifest.json'), outputHardlink);
    for (const alias of [outputSymlink, outputHardlink]) {
      const refused = run(alias); assert.notEqual(refused.status, 0); assert.match(refused.stderr, /EEXIST/);
    }
    assert.equal(await readFile(path.join(output, 'trial-manifest.json'), 'utf8'), manifestBytes);
    const parentAlias = path.join(output, 'artifact-parent-alias');
    await (await import('node:fs/promises')).symlink(app, parentAlias, 'dir');
    const aliased = run(path.join(parentAlias, 'sidecar.json'));
    assert.notEqual(aliased.status, 0, 'an external-looking parent must not write into the frozen artifact');
    assert.match(aliased.stderr, /report.*external/);
    assert.equal(existsSync(path.join(app, 'sidecar.json')), false);
    for (const [file, hash] of Object.entries(files)) assert.equal(sha(await readFile(path.join(app, file), 'utf8')), hash, file);

    for (const file of ['libffmpeg.so', 'HimaHarness']) {
      const prior = await readFile(path.join(app, file), 'utf8');
      await put(file, 'changed covered native or consumer', true); await seal();
      const bad = run(); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /evidence bridge.*differ/);
      await put(file, prior, true); await seal();
    }
    await put('evidence.json', {...packet, runtime: undefined});
    const missing = run(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /actual replacement runtime evidence missing/);
    await put('evidence.json', {...packet, components: []});
    const declared = run(); assert.notEqual(declared.status, 0); assert.match(declared.stderr, /actual build.*replacement evidence/);
  } finally { await (await import('node:fs/promises')).rm(output, {recursive: true, force: true}); }
});
