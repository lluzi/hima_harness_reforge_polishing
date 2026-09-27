// L0/L2 release seam: inspect the product artifact without opening an Electron window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
    const { snapshotPackFolder, packDigestExcludes } = await import('../../packages/harness/lib/pack-folder.js');
    const { loadPackFrom } = await import('../../packages/harness/lib/packs.js');
    const { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest } = await import('../../packages/harness/lib/interactive-binding.js');
    const folder = snapshotPackFolder(path.join(repoRoot, 'packs/xtop-timing-closure'));
    const tool = loadPackFrom(folder).contract.tools.find(tool => tool.id === 'run-xtop-fix')!;
    const digest = folder.digest(packDigestExcludes);
    const commandsDigest = interactiveCommandsDigest(tool);
    const sha = 'a'.repeat(64);
    const environment = {
      schema: 'hima-interactive-environment/1', site: 'fixture-site', toolId: 'run-xtop-fix',
      pack: { id: 'xtop-timing-closure', digest },
      adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST }, commandsDigest,
      wrapper: { path: tool.interactive!.argv[0], sha256: sha }, image: { reference: 'fixture', digest: `sha256:${sha}` },
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
    const { snapshotPackFolder, packDigestExcludes } = await import('../../packages/harness/lib/pack-folder.js');
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
    const complete = check();
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /checked custom-cell-fmax-dtco, xtop-timing-closure and opene902-timing-probe assets/);
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
