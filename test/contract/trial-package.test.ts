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
    const complete = check();
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /checked custom-cell-fmax-dtco, xtop-timing-closure, opene902-timing-probe and agentic-timing-closure-system assets/);
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
const bundledPackIds = ['custom-cell-fmax-dtco', 'xtop-timing-closure', 'opene902-timing-probe', 'agentic-timing-closure-system'];

test('the trial App stages the ATCS Pack at its exact source digest and its verifier refuses a changed byte', async () => {
  const { packDigestOf } = await import('../../packages/harness/lib/pack-folder.js');
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-atcs-bundle-'));
  const app = path.join(output, 'HimaHarness.app');
  const resource = path.join(app, 'Contents/Resources/app');
  try {
    const staged = packagerRun('--stage-packs', path.join(repoRoot, 'packs'), resource);
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
    await writeFile(path.join(output, 'trial-manifest.json'), JSON.stringify({ format: 2,
      status: 'structurally-verified trial candidate',
      runtimeInputs: { packs: identities.packs, atcsBinding: 'none, kit installs it' } }));
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
    assert.match(refused.stderr, /bundled Pack agentic-timing-closure-system identity differs from the manifest/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('the manifest ATCS stage follows its release seal and the ATCS Site identity is recorded exactly', async () => {
  const { snapshotPackFolder, packDigestExcludes } = await import('../../packages/harness/lib/pack-folder.js');
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
    const unsealed = packagerRun('--check-pack-assets', packs, '--site', site);
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
    const pinned = identitiesFrom(packagerRun('--check-pack-assets', packs, '--site', site).stdout);
    assert.deepEqual(pinned.atcsSite.wrapperPins, pins);

    const run = 'run-00000000-0000-4000-8000-000000000009';
    await writeFile(path.join(atcs, 'TEST.md'), `## Run\n\nrun: ${run}\n`);
    const folder = snapshotPackFolder(atcs);
    const methodDigest = folder.digest(packDigestExcludes);
    const version = /^version:\s*["']?([^"'\s]+)["']?/m.exec(await readFile(path.join(atcs, 'contract.yml'), 'utf8'))![1];
    await writeFile(path.join(atcs, 'VERSION.yml'), [
      'pack: agentic-timing-closure-system', `version: "${version}"`, `methodDigest: ${methodDigest}`,
      'released: "2026-09-28T00:00:00.000Z"', 'test:', '  record: TEST.md', `  run: ${run}`, 'files:',
      ...folder.sealFiles().map(([file, digest]: [string, string]) => `  '${file}': '${digest}'`), '',
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

test('each interactive binding is checked against its own Pack and an ATCS binding carries the ATCS identity', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-atcs-binding-'));
  try {
    const { snapshotPackFolder, packDigestExcludes } = await import('../../packages/harness/lib/pack-folder.js');
    const { loadPackFrom } = await import('../../packages/harness/lib/packs.js');
    const { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest } = await import('../../packages/harness/lib/interactive-binding.js');
    const sha = 'a'.repeat(64);
    const rowFor = async (packId: string, toolId: string, site: string, environmentId: string, id?: string) => {
      const folder = snapshotPackFolder(path.join(repoRoot, 'packs', packId));
      const tool = loadPackFrom(folder).contract.tools.find((tool: { id: string }) => tool.id === toolId)!;
      const digest = folder.digest(packDigestExcludes);
      const commandsDigest = interactiveCommandsDigest(tool);
      const environment = {
        schema: 'hima-interactive-environment/1', site, toolId, pack: { id: packId, digest },
        adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST }, commandsDigest,
        wrapper: { path: tool.interactive!.argv[0], sha256: sha }, image: { reference: 'fixture', digest: `sha256:${sha}` },
        sourceTemplate: { path: 'flow/templates/xtop-operator.tcl', sha256: createHash('sha256').update(
          await readFile(path.join(repoRoot, 'packs', packId, 'flow/templates/xtop-operator.tcl'))).digest('hex') },
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
    const both = packagerRun('--check-interactive-bindings', file);
    assert.equal(both.status, 0, both.stderr);
    assert.deepEqual(JSON.parse(both.stdout).bindings.map((binding: { id: string; pack: string }) => [binding.id, binding.pack]),
      [['fixture-qualified', 'xtop-timing-closure'], [atcs.row.id, 'agentic-timing-closure-system']]);

    const atcsFile = path.join(output, 'atcs-bindings.json');
    await write(atcsFile, [atcs.row]);
    const atcsOnly = packagerRun('--check-atcs-binding', atcsFile);
    assert.equal(atcsOnly.status, 0, atcsOnly.stderr);
    assert.equal(JSON.parse(atcsOnly.stdout).bindings[0].packDigest, atcs.digest);

    // An ATCS row that names the timing Pack's digest is judged against the ATCS Pack, and refused.
    const foreignDigest = { ...atcs.environment, pack: { ...atcs.environment.pack, digest: xtop.digest } };
    const foreignBytes = JSON.stringify(foreignDigest);
    await writeFile(atcs.environmentFile, foreignBytes);
    await write(atcsFile, [{ ...atcs.row, packDigest: xtop.digest, environment: { ...atcs.row.environment,
      sha256: createHash('sha256').update(foreignBytes).digest('hex') } }]);
    const wrongPack = packagerRun('--check-atcs-binding', atcsFile);
    assert.equal(wrongPack.status, 1);
    assert.match(wrongPack.stderr, /qualification differs from the agentic-timing-closure-system Pack/);
    await writeFile(atcs.environmentFile, JSON.stringify(atcs.environment));

    await write(atcsFile, [{ ...atcs.row, id: 'linglong-atcs28:xtop-operator-v9:0000000000000000' }]);
    const wrongId = packagerRun('--check-atcs-binding', atcsFile);
    assert.equal(wrongId.status, 1);
    assert.match(wrongId.stderr, /ATCS binding .* id is not linglong-atcs28:xtop-operator-v9:[0-9a-f]{16}/);
    await write(atcsFile, [xtop.row]);
    const notAtcs = packagerRun('--check-atcs-binding', atcsFile);
    assert.equal(notAtcs.status, 1);
    assert.match(notAtcs.stderr, /--atcs-binding carries only agentic-timing-closure-system bindings for Site linglong-atcs28/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});
