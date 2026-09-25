import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  BUILTIN_TCL_ADAPTER_DIGEST, batchToolRefusal, createInteractiveBindingBridge,
  installPackMethod, interactiveCommandsDigest, loadPack, loadSite, packDigestExcludes, toolArgv,
} from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { installPack, timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

const interactiveBlock = `    interactive:
      mode: interactive-only
      adapter: hima-tcl-line-v1
      commands:
        read: [get_value]
        mutate: [set_value]
        save: [save_state]
    argv:`;

test('interactive resolution uses only inputs declared by the retained Pack', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const installed = await installPack(home);
  const packId = 'xtop-timing-closure';
  installPackMethod({ from: path.join(repoRoot, 'packs', packId), to: path.join(installed.packsDir, packId) });
  const pack = loadPack(installed.packsDir, packId);
  const packDigest = pack.folder.digest(packDigestExcludes);
  const tool = pack.contract.tools.find((candidate) => candidate.id === 'run-xtop-fix')!;
  const bindings = {
    inputInnovusDatabase: '/site/input.enc.dat',
    siteProfile: '/site/profile.json',
    sourceManifest: '/site/source.sha256',
    workspaceRoot: home.workspace,
  };
  const wrapper = tool.interactive!.argv![0]!;
  const siteInfo = await writeLocalSite(home, {
    allowedReadRoots: [home.workspace, '/site', '/data/eda/project/hima_harness/operator-admin'],
    allowedWriteRoots: [home.workspace], allowedWrappers: ['/usr/bin/python3', wrapper],
    bindings, licences: { Innovus: 1, StarRC: 1, PrimeTime: 1, XTop: 1 },
  });
  const site = loadSite(siteInfo.sitesDir, siteInfo.name);
  const adminDir = path.join(home.home, 'admin'); await mkdir(adminDir);
  const environmentFile = path.join(adminDir, 'environment.json');
  const environmentBytes = '{"qualification":"resolver-only"}\n';
  await writeFile(environmentFile, environmentBytes);
  const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const configFile = path.join(adminDir, 'interactive-bindings.json');
  const row = { id: 'xtop-resolver', site: 'local', packDigest, toolId: tool.id, adapter: 'hima-tcl-line-v1',
    adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(tool),
    environment: { id: 'resolver-only', file: environmentFile, sha256: hash(environmentBytes) }, mutation: 'qualified' };
  await writeFile(configFile, `${JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [row] }, null, 2)}\n`);
  const bridge = createInteractiveBindingBridge({ packsDir: installed.packsDir, sitesDir: siteInfo.sitesDir,
    interactiveBindingsFile: configFile });
  const run = { id: 'run-xtop', campaignId: 'campaign-xtop', siteId: 'local', packId, packDigest,
    createdAt: new Date().toISOString(), nextSeq: 1, status: 'running', strategy: { strategyRevision: 0 }, generation: 1 };
  const execution = { id: 'execution-xtop', nodeId: 'run-xtop-fix', kind: 'act', generation: 1, attempt: 1,
    methodDigest: packDigest, inputDigest: 'd'.repeat(64), phase: 'ready' };

  const resolved = await bridge.resolve({ pack, run: run as never, execution: execution as never, site,
    workspace: home.workspace });

  assert.ok(resolved);
  assert.deepEqual(resolved.argv, [wrapper, home.workspace, `${home.workspace}/flow/closure.py`,
    `${home.workspace}/flow/templates/xtop-operator.tcl`]);
});

test('production binding resolves retained Pack/Site facts, pins admin evidence, and encodes only classified literal Tcl', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const installed = await installPack(home);
  const packId = 'interactive-binding-fixture';
  await writePackVariant(installed.packsDir, packId, [['    argv:', interactiveBlock]]);
  const pack = loadPack(installed.packsDir, packId);
  const packDigest = pack.folder.digest(packDigestExcludes);
  const tool = pack.contract.tools.find((candidate) => candidate.id === 'synth')!;
  assert.equal(batchToolRefusal(tool)?.includes('interactive-only'), true);
  const hybrid = { ...tool, interactive: { ...tool.interactive!, mode: 'hybrid' as const } };
  assert.equal(batchToolRefusal(hybrid), undefined, 'hybrid preserves only the original batch argv path');
  assert.deepEqual(toolArgv(hybrid, { WORKSPACE: '/w', FLOW_ROOT: '/f', DESIGN: 'd', PERIOD_NS: '2.5', CAMPAIGN: 'c' }),
    toolArgv(tool, { WORKSPACE: '/w', FLOW_ROOT: '/f', DESIGN: 'd', PERIOD_NS: '2.5', CAMPAIGN: 'c' }));

  const siteInfo = await writeLocalSite(home, { allowedReadRoots: [home.workspace], allowedWriteRoots: [home.workspace],
    allowedWrappers: ['make'], bindings: { flowRoot: pack.dir, design: 'opene902', workspaceRoot: home.workspace }, licences: { 'Design-Compiler': 1 } });
  const site = loadSite(siteInfo.sitesDir, siteInfo.name);
  const adminDir = path.join(home.home, 'admin'); await mkdir(adminDir);
  const environmentFile = path.join(adminDir, 'environment.json');
  const environmentBytes = '{"tool":"fixture-tcl","version":"1","confinement":"workspace"}\n';
  await writeFile(environmentFile, environmentBytes);
  const environmentDigest = (await import('node:crypto')).createHash('sha256').update(environmentBytes).digest('hex');
  const configFile = path.join(adminDir, 'interactive-bindings.json');
  const row = { id: 'fixture-binding', site: 'local', packDigest, toolId: 'synth', adapter: 'hima-tcl-line-v1',
    adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(tool),
    environment: { id: 'fixture-env', file: environmentFile, sha256: environmentDigest }, mutation: 'qualified' };
  await writeFile(configFile, `${JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [row] }, null, 2)}\n`);

  const bridge = createInteractiveBindingBridge({ packsDir: installed.packsDir, sitesDir: siteInfo.sitesDir, interactiveBindingsFile: configFile });
  const run = { id: 'run-fixture', campaignId: 'campaign-fixture', siteId: 'local', packId, packDigest,
    createdAt: new Date().toISOString(), nextSeq: 1, status: 'running', strategy: { periodNs: 2.5 }, generation: 1 };
  const execution = { id: 'execution-fixture', nodeId: 'synthesize', kind: 'act', generation: 1, attempt: 1,
    methodDigest: packDigest, inputDigest: 'd'.repeat(64), phase: 'ready' };
  const resolved = await bridge.resolve({ pack, run: run as never, execution: execution as never, site, workspace: home.workspace });
  assert.ok(resolved); assert.deepEqual(resolved.argv.slice(0, 4), ['make', '-C', `${home.workspace}/flow`, 'DESIGN=opene902']);
  assert.equal(resolved.binding.limits.startupWaitMs, 60_000);
  assert.deepEqual(resolved.licences, { 'Design-Compiler': 1 });
  assert.equal(resolved.binding.mutation, 'qualified');
  const verified = await bridge.verifyAdminBinding(resolved.binding);
  assert.equal(verified.environmentDigest, environmentDigest);
  assert.equal(verified.confinement, 'unqualified', 'hash evidence alone never claims production confinement');

  const hostile = '$danger;[set ::pwned 1]}; set ::pwned 1; #';
  const read = await bridge.encodeCommand(resolved.binding, { commandId: 'read-1', protocolToken: 'N'.repeat(32),
    name: 'get_value', args: { arguments: [hostile, true, 3.5] } });
  assert.equal(read.effect, 'read'); assert.equal(read.submit, true);
  assert.match(read.text, /set __hima_command \[list get_value /);
  assert.doesNotMatch(read.text, /eval|source|uplevel/);
  const tcl = spawnSync('/usr/bin/tclsh', [], { input: `set ::pwned 0\nproc get_value {args} { puts "ARG:[lindex $args 0]"; return ok }\n${read.text}\nputs "PWNED:$::pwned"\n`, encoding: 'utf8' });
  assert.equal(tcl.status, 0, tcl.stderr); assert.match(tcl.stdout, /HIMA:N{32}:DONE/);
  assert.match(tcl.stdout, /PWNED:0/); assert.ok(tcl.stdout.includes(`ARG:${hostile}`), `literal Tcl argument changed: ${tcl.stdout}`);
  const failing = await bridge.encodeCommand(resolved.binding, { commandId: 'mutate-fail', protocolToken: 'F'.repeat(32),
    name: 'set_value', args: { arguments: ['missing-command'] } });
  const failedTcl = spawnSync('/usr/bin/tclsh', [], { input: failing.text, encoding: 'utf8' });
  assert.match(failedTcl.stdout, /HIMA:F{32}:FAIL/); assert.doesNotMatch(failedTcl.stdout, /HIMA:F{32}:DONE/);
  await assert.rejects(() => bridge.encodeCommand(resolved.binding, { commandId: 'bad', protocolToken: 'B'.repeat(32),
    name: 'source', args: { arguments: ['/tmp/untrusted.tcl'] } }), /not classified/);

  await writeFile(environmentFile, `${environmentBytes}changed\n`);
  await assert.rejects(() => bridge.verifyAdminBinding(resolved.binding), /environment evidence changed/);
  await writeFile(environmentFile, environmentBytes);

  const insideConfig = path.join(home.workspace, 'interactive-bindings.json');
  await writeFile(insideConfig, `${JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [row] })}\n`);
  const insideBridge = createInteractiveBindingBridge({ packsDir: installed.packsDir, sitesDir: siteInfo.sitesDir, interactiveBindingsFile: insideConfig });
  const inside = await insideBridge.resolve({ pack, run: run as never, execution: execution as never, site, workspace: home.workspace }); assert.ok(inside);
  await assert.rejects(() => insideBridge.verifyAdminBinding(inside.binding), /task-writable Permit root/);

  const missing = createInteractiveBindingBridge({ packsDir: installed.packsDir, sitesDir: siteInfo.sitesDir });
  assert.equal(await missing.resolve({ pack, run: run as never, execution: execution as never, site, workspace: home.workspace }), undefined,
    'an omitted Host binding file does not silently qualify mutation or invent an adapter');
});

test('Pack schema refuses duplicate effects and Tcl execution primitives classified as read-only', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const installed = await installPack(home);
  await writePackVariant(installed.packsDir, 'interactive-read-source', [['    argv:', `    interactive:
      mode: interactive-only
      adapter: hima-tcl-line-v1
      commands:
        read: [source]
        mutate: []
        save: []
    argv:`]]);
  assert.throws(() => loadPack(installed.packsDir, 'interactive-read-source'), /cannot be classified read-only/);

  await writePackVariant(installed.packsDir, 'interactive-duplicate-command', [['    argv:', `    interactive:
      mode: interactive-only
      adapter: hima-tcl-line-v1
      commands:
        read: [get_value]
        mutate: [get_value]
        save: []
    argv:`]]);
  assert.throws(() => loadPack(installed.packsDir, 'interactive-duplicate-command'), /classified as both read and mutate/);
  assert.notEqual(timingProbePackId, '', 'fixture varies the shipped Pack rather than a synthetic parser-only object');
});

test('production evidence is enforced only after the Site wrapper, Permit roots and retained Pack source match', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const installed = await installPack(home);
  const packId = 'interactive-production-fixture';
  const adminDir = path.join(home.home, 'admin'); await mkdir(adminDir);
  const wrapper = path.join(adminDir, 'qualified-wrapper');
  const wrapperBytes = '#!/bin/sh\nexec /usr/bin/tclsh "$2"\n';
  await writeFile(wrapper, wrapperBytes);
  await writePackVariant(installed.packsDir, packId, [
    ['  wrappers:\n    - make', `  wrappers:\n    - make\n    - ${wrapper}`],
    ['    argv:', `    interactive:
      mode: hybrid
      adapter: hima-tcl-line-v1
      argv: [${JSON.stringify(wrapper)}, '\${WORKSPACE}', '\${WORKSPACE}/flow/fixture.tcl']
      commands:
        read: [get_value]
        mutate: [set_value]
        save: [save_state]
        close: [close_session]
    argv:`],
    ['    - sources/\${design}', '    - sources/${design}\n    - fixture.tcl'],
  ], [], timingProbePackId, { 'fixture.tcl': 'puts fixture\n' });
  const pack = loadPack(installed.packsDir, packId);
  const packDigest = pack.folder.digest(packDigestExcludes);
  const tool = pack.contract.tools.find((candidate) => candidate.id === 'synth')!;
  const sourceBytes = pack.folder.text('fixture.tcl')!;
  const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const siteInfo = await writeLocalSite(home, {
    allowedReadRoots: [home.home, home.workspace], allowedWriteRoots: [home.workspace],
    allowedWrappers: ['make', wrapper],
    bindings: { flowRoot: pack.dir, design: 'opene902', workspaceRoot: home.workspace }, licences: { 'Design-Compiler': 1 },
  });
  const site = loadSite(siteInfo.sitesDir, siteInfo.name);
  const environmentFile = path.join(adminDir, 'environment.json');
  const environment = {
    schema: 'hima-interactive-environment/1', site: 'local', toolId: 'synth',
    pack: { id: packId, digest: packDigest },
    adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST },
    commandsDigest: interactiveCommandsDigest(tool),
    wrapper: { path: wrapper, sha256: hash(wrapperBytes) },
    image: { reference: 'localhost/fixture', digest: `sha256:${'a'.repeat(64)}` },
    sourceTemplate: { path: 'fixture.tcl', sha256: hash(sourceBytes) },
    confinement: { rootFilesystem: 'read-only', dataRoot: home.home, dataMount: 'read-only',
      privateWriteRoot: home.workspace, network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: 'b'.repeat(64), logicalEcoSha256: 'c'.repeat(64),
      physicalEcoSha256: 'd'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  } as const;
  const environmentBytes = `${JSON.stringify(environment, null, 2)}\n`;
  await writeFile(environmentFile, environmentBytes);
  const configFile = path.join(adminDir, 'interactive-bindings.json');
  const row = { id: 'production-binding', site: 'local', packDigest, toolId: 'synth', adapter: 'hima-tcl-line-v1',
    adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(tool),
    environment: { id: 'fixture-production-env', file: environmentFile, sha256: hash(environmentBytes) }, mutation: 'qualified' };
  await writeFile(configFile, `${JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [row] }, null, 2)}\n`);
  const bridge = createInteractiveBindingBridge({ packsDir: installed.packsDir, sitesDir: siteInfo.sitesDir, interactiveBindingsFile: configFile });
  const run = { id: 'run-production', campaignId: 'campaign-production', siteId: 'local', packId, packDigest,
    createdAt: new Date().toISOString(), nextSeq: 1, status: 'running', strategy: { periodNs: 2.5 }, generation: 1 };
  const execution = { id: 'execution-production', nodeId: 'synthesize', kind: 'act', generation: 1, attempt: 1,
    methodDigest: packDigest, inputDigest: 'd'.repeat(64), phase: 'ready' };
  const resolved = await bridge.resolve({ pack, run: run as never, execution: execution as never, site, workspace: home.workspace });
  assert.ok(resolved);
  assert.deepEqual(resolved.argv, [wrapper, home.workspace, `${home.workspace}/flow/fixture.tcl`]);
  const verified = await bridge.verifyAdminBinding(resolved.binding);
  assert.equal(verified.confinement, 'enforced');
  assert.equal(verified.writableRoot, home.workspace);

  await writeFile(wrapper, `${wrapperBytes}# drift\n`);
  await assert.rejects(() => bridge.verifyAdminBinding(resolved.binding), /wrapper.*changed|digest/i,
    'a remote-like wrapper byte drift must revoke production qualification');
  await writeFile(wrapper, wrapperBytes);

  const permitBytes = await readFile(siteInfo.permitPath, 'utf8');
  await writeFile(siteInfo.permitPath, permitBytes.replace(`allowedWriteRoots:\n  - ${home.workspace}`,
    `allowedWriteRoots:\n  - ${home.workspace}\n  - ${wrapper}`));
  const writableBridge = createInteractiveBindingBridge({ packsDir: installed.packsDir, sitesDir: siteInfo.sitesDir, interactiveBindingsFile: configFile });
  const writableResolved = await writableBridge.resolve({ pack, run: run as never, execution: execution as never, site, workspace: home.workspace });
  assert.ok(writableResolved);
  await assert.rejects(() => writableBridge.verifyAdminBinding(writableResolved.binding), /wrapper.*writable|task-writable Permit root/i);

  assert.equal((await readFile(wrapper, 'utf8')), wrapperBytes, 'negative verification does not mutate Site-owned wrapper bytes');
});
