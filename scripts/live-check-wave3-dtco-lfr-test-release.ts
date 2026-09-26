// @hima-seam agent wrapped
// @hima-seam tools direct
// Wave 3 lane B: current-method real-model negative calibration test and native Pack seal.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  discoverSshSite, loadSite, packDigestOf, packStage, saveDiscoveredSite,
  type LedgerRecord, type Permit,
} from '@hima/harness';
import { homePatchFile } from '../packages/desktop/src/hima-home.ts';
import {
  bootInProcess, createRootAgent, sayAsUser,
} from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
if (outAt < 0 || !args[outAt + 1] || args.length !== 2) {
  throw new Error('usage: node scripts/live-check-wave3-dtco-lfr-test-release.ts --out <fresh-directory>');
}
const out = path.resolve(args[outAt + 1]!);
if (existsSync(out)) throw new Error('evidence directory already exists');
mkdirSync(out, { recursive: true });

const packId = 'custom-cell-fmax-dtco';
const packDir = path.join(repoRoot, 'packs', packId);
for (const sideEffect of ['.hima-method-history', 'hima', 'run-assets']) {
  assert.equal(
    existsSync(path.join(packDir, sideEffect)), false,
    `source Pack contains local test side effect ${sideEffect}; archive it before qualification`,
  );
}
const runner = path.join(packDir, 'flow/ai_research_runner.py');
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const destination = 'luzi@192.168.50.41';
const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlPath=none', destination];
const remote = (command: string, timeout = 60_000): string => execFileSync(
  'ssh', [...sshArgs, command], { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 },
);
const processState = (): string => remote(
  "/usr/local/bin/empyrean-license status; ps -eo pid,args | grep -E '(icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell|innovus)' | grep -v grep | grep -v '<defunct>' || true",
).trim();

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const digest = packDigestOf(packDir);
const runnerSha256 = sha256(readFileSync(runner));
const before = processState();
assert.match(before, /selected=new old=inactive new=active/);
assert.doesNotMatch(before, /icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell|innovus/);

const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
const remoteRoot = `/data/eda/project/hima_harness/wave3-dtco-lfr-test-${stamp}`;
remote(`test ! -e '${remoteRoot}' && mkdir -p '${remoteRoot}'`);
const permit: Permit = {
  allowedReadRoots: ['/data/eda/project', '/data/eda/software', '/data/eda/env', '/usr/local/bin', '/usr/bin'],
  allowedWriteRoots: [remoteRoot],
  allowedWrappers: ['/usr/bin/python3', '/usr/local/bin/eda'],
  forbidden: ['deletions'],
};
const foundryLib = '/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/tcbn28hpcplusbwp40p140tt0p9v25c.lib';
const basePhysicalInputs = '/data/eda/project/hima_harness/issue52-dc-qualification-20260924/physical-inputs.json';
const physicalInputs = `${remoteRoot}/physical-inputs.json`;
const toolStack = '/data/eda/project/hima_harness/site_inputs/xspace_cell_aes_tsmc28/tool-stack.json';
const foundryCdl = '/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Back_End/spice/tcbn28hpcplusbwp40p140_110a/tcbn28hpcplusbwp40p140_110a.spi';
const foundryCdlSha256 = remote(`sha256sum -- '${foundryCdl}'`).trim().split(/\s+/)[0]!;
remote(`python3 -c 'import json; source=${JSON.stringify(basePhysicalInputs)}; target=${JSON.stringify(physicalInputs)}; value=json.load(open(source)); value["FOUNDRY_CDL_VERSION"]="tsmc28-hpcplus-110a"; value["FOUNDRY_CDL_SHA256"]=${JSON.stringify(foundryCdlSha256)}; open(target,"x").write(json.dumps(value,sort_keys=True,indent=2)+"\\n")'`);
const sourceHashesBefore = remote(`sha256sum -- '${foundryLib}' '${physicalInputs}' '${toolStack}'`).trim();

const home = await createHimaHome();
let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
let runId: string | undefined;
let ownerId: string | undefined;
let workspace: string | undefined;
let failure: string | undefined;
const progress: unknown[] = [];
const snapshot = (status: 'in-progress' | 'failed' | 'passed', extra: Record<string, unknown> = {}) => {
  const run = host && runId ? host.ctx.hima.ledger.run(runId) : undefined;
  const records = host && runId ? host.ctx.hima.ledger.records({ runId }) : undefined;
  writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify({
    schema: 'hima.wave3-dtco-lfr-test-release/1',
    recordedAt: new Date().toISOString(), status, sourceSha,
    pack: { id: packId, version: '5.2.17', digest, runnerSha256 },
    site: { destination, remoteRoot, foundryLib, physicalInputs, toolStack, foundryCdlSha256 },
    environmentBefore: before, runId, ownerId, workspace, progress,
    ...(run ? { run } : {}), ...(records ? { records } : {}),
    ...(failure ? { failure } : {}), ...extra,
  }, null, 2)}\n`);
};
snapshot('in-progress');

try {
  appendFileSync(homePatchFile(home.home), [
    '- id: session-title-llm',
    '  disabled: true',
    '- id: hima',
    '  config:',
    `    sitesDir: ${JSON.stringify(path.join(home.home, 'hima/sites'))}`,
    `    packsDir: ${JSON.stringify(path.join(repoRoot, 'packs'))}`,
    `    knowledgeDir: ${JSON.stringify(path.join(home.home, 'hima/knowledge/current'))}`,
    `    interactiveBindingsFile: ${JSON.stringify(path.join(home.home, 'hima/interactive-bindings.json'))}`,
    '',
  ].join('\n'));
  const sitesDir = path.join(home.home, 'hima/sites');
  const discovery = await discoverSshSite({
    name: 'wave3-dtco-lfr-test',
    ssh: { destination, jumps: [], controlPersistSeconds: 60 },
    hints: {
      workspaceRoot: remoteRoot,
      allowedReadRoots: permit.allowedReadRoots,
      allowedWriteRoots: permit.allowedWriteRoots,
      allowedWrappers: permit.allowedWrappers,
      toolCommands: ['python3', 'eda'],
    },
  });
  assert.deepEqual(discovery.unknowns, []);
  assert.deepEqual(discovery.conflicts, []);
  saveDiscoveredSite(sitesDir, {
    ...discovery, permit,
    site: {
      ...discovery.site,
      workspaceRoot: remoteRoot,
      bindings: {
        designRoot: '/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes',
        rtlGlob: '/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes/*.v',
        designTop: 'aes_cipher_top',
        constraints: '/data/eda/project/celluzi/commercial/aes_tsmc28/scripts/constraint_tsmc28.sdc',
        foundryLibrary: foundryLib, physicalInputs, toolStack, workspaceRoot: remoteRoot,
      },
      capacity: {
        ...discovery.site.capacity, parallelJobs: 1,
        licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
      },
    },
  });
  const site = loadSite(sitesDir, 'wave3-dtco-lfr-test');
  host = await bootInProcess(home);
  const owner = await createRootAgent(host.ctx, packDir);
  ownerId = String(owner.id);
  assert.equal(owner.options.provider, 'deepseek-official');
  assert.equal(owner.options.model, 'deepseek-flash');

  const started = await host.ctx.hima.startRun({
    pack: packId, site: site.name, test: true,
    goal: { target_period_ns: 0.5, target_fmax_improvement_pct: 5 },
    strategy: { periodNs: 0.5, algorithmRevision: 0, floorplanUtilization: 0.25 },
    ownerSessionId: ownerId, timeBoxMs: 2 * 60 * 60_000,
    generationLimit: 1, retryAllowance: 1,
  });
  assert.equal(started.kind, 'ran', JSON.stringify(started));
  if (started.kind !== 'ran') throw new Error('Wave 3 test Run did not start');
  runId = started.run.id;
  workspace = started.workspace;
  assert.equal(started.run.packDigest, digest);
  assert.equal(started.run.purpose, 'test');
  snapshot('in-progress');

  const prompt = [
    `Continue only existing Pack test Run ${runId}; do not create or hand off another Run.`,
    'You are its sole visible Campaign owner. Use only hima_context and hima_execute for business work.',
    'This is the current custom-cell-fmax-dtco@5.2.17 negative calibration qualification, not a PPA search.',
    'Execute bind-inputs, the real license-free Yosys/ABC baseline, all six miners/readers, their join, function-local evaluation and Judge exactly as the current graph declares.',
    'At research-candidates, read the current declared inputs and all three Pack knowledge files. Author a fresh data-dependent candidate_program from the current candidate_pool; never embed a proposal_key or candidate id. Rank current rows from their actual evidence and select exactly one best available proposal.',
    'For that one proposal declare required_delay_ns=0.000001 and a real target_endpoints value read from current evidence. This intentionally strict Cell Demand is the negative test stimulus. Keep the intervention evidence-appropriate and state that this is a guard-case qualification, not an expected implementation result.',
    'Run the exact authored bytes through the Workshop. Continue through merge, generate, layout, characterize, Reader and calibration Judge. Preserve every refusal/failure and do not reinterpret missing evidence as zero.',
    'Expected valid outcome: no physical drive can meet the 0.000001 ns Demand, the calibration Judge reports FAIL with typed feedback, then calibration-research uses the Pack recommendation. With generationLimit=1 the revisit must end ended-budget-exhausted by generation-limit.',
    'Do not begin compile, Design Compiler, Innovus, P&R or compare. If the calibration unexpectedly passes or the graph offers the commercial tail, stop and report the unexpected result without launching it.',
    'Do not write notes, history, run-assets or any other file into the source Pack folder; research code and evidence belong only to this Run private workspace. TEST.md is finalized separately after the Run ends.',
    'When the Run is terminal, do not edit TEST.md yet. Report the terminal status, CodeRecord hash, calibration observation/verdict ids, ending meter and limits.',
  ].join('\n');

  let prior = '';
  let unchanged = 0;
  for (let turn = 0; turn < 80; turn += 1) {
    const run = host.ctx.hima.ledger.run(runId);
    if (!run || run.status?.startsWith('ended-')) break;
    await owner.whenIdle();
    const current = host.ctx.hima.executionContext(runId);
    if (current.executions.some((entry) => entry.phase === 'working')) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    const state = JSON.stringify({
      status: current.run.status, node: current.run.currentNode,
      generation: current.run.generation, available: current.available,
      executions: current.executions.map((entry) => ({ id: entry.id, nodeId: entry.nodeId, phase: entry.phase })),
    });
    unchanged = state === prior ? unchanged + 1 : 0;
    prior = state;
    if (unchanged >= 4) throw new Error(`real owner stalled without progress: ${state}`);
    progress.push({ turn: turn + 1, node: current.run.currentNode, available: current.available, at: new Date().toISOString() });
    snapshot('in-progress');
    await sayAsUser(owner, turn === 0 ? prompt : [
      `Continue the same Pack test Run ${runId} from current facts.`,
      'Use hima_context; complete only ready work and preserve the strict one-Demand negative calibration scope.',
      'Do not create another Run and do not launch compile, DC, Innovus or P&R. If a Job is still working, end this response and await its notification.',
      'After calibration FAIL, apply the Pack recommendation so generationLimit=1 records the terminal ending.',
    ].join('\n'));
  }
  await owner.whenIdle();
  const terminal = host.ctx.hima.ledger.run(runId);
  assert.equal(terminal?.status, 'ended-budget-exhausted', JSON.stringify(terminal));
  assert.equal(terminal?.meters?.endedBy, 'generation-limit', JSON.stringify(terminal?.meters));
  const records = host.ctx.hima.ledger.records({ runId });
  const codes = records.filter((record) => record.type === 'code');
  assert.ok(codes.length >= 1, 'the current-method test must retain its real Workshop CodeRecord');
  assert.ok(records.some((record) => record.type === 'verdict' && record.ruleId === 'mock-liberty-calibration-accepted' && record.outcome === 'FAIL'),
    'the strict Cell Demand must reach the typed calibration-negative Judge');
  assert.equal(records.some((record) => record.type === 'job'
    && ['compile', 'foundry-synth', 'custom-synth', 'pnr-foundry', 'pnr-generated', 'verify', 'compare'].includes(record.nodeId ?? '')), false,
  'the negative calibration test must not launch the commercial tail');

  snapshot('in-progress', { terminal: true });
  await sayAsUser(owner, [
    `/hima-test FINALIZATION ONLY for existing terminal Run ${runId}; create or execute no Run.`,
    'Write TEST.md from hima_status and the actual current ledger records, with exactly the required seven sections and exact standalone run/status lines.',
    'Include every CodeRecord SHA and every refusal id, or the exact word none when there were none.',
    'State that this was a real Site/current-method negative calibration test: Yosys/ABC baseline and mining ran, the strict one-Demand guard failed closed, generation-limit ended the Run, and no commercial EDA/PPA claim is made.',
    'Keep the portable TEST record free of specific design top names and absolute process/path strings, including aes_cipher_top and tsmc28; describe them generically as the Site-bound design and foundry inputs while retaining the hash-bound Run evidence.',
    `Preserve method digest ${digest} and all method bytes. After writing TEST.md call hima_pack_check for ${packId}. Do not release yet.`,
  ].join('\n'));
  await owner.whenIdle();
  assert.equal(packStage(packDir).stage, 'tested', JSON.stringify(packStage(packDir)));
  assert.equal(packDigestOf(packDir), digest, 'the test must not mutate method bytes before release');
  assert.equal(existsSync(path.join(packDir, 'hima')), false, 'the test must not write source-Pack notes');
  assert.doesNotMatch(
    readFileSync(path.join(packDir, 'TEST.md'), 'utf8'),
    /aes_cipher_top|\/[^\s"']*tsmc28/i,
    'the portable TEST record must not bind the method to the qualification design or process path',
  );

  const release = await host.ctx.tools.execute({
    name: 'hima_pack_release', arguments: { pack: packId }, agent: owner,
    callId: 'wave3-dtco-native-release' as never,
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(release.isError, false, JSON.stringify(release));
  assert.equal(packStage(packDir).stage, 'released', JSON.stringify(packStage(packDir)));
  const version = readFileSync(path.join(packDir, 'VERSION.yml'));
  const test = readFileSync(path.join(packDir, 'TEST.md'));
  assert.match(test.toString('utf8'), new RegExp(`^run: ${runId}$`, 'm'));
  assert.match(test.toString('utf8'), /^status: ended-budget-exhausted$/m);

  const sourceHashesAfter = remote(`sha256sum -- '${foundryLib}' '${physicalInputs}' '${toolStack}'`).trim();
  assert.equal(sourceHashesAfter, sourceHashesBefore);
  const after = processState();
  assert.match(after, /selected=new old=inactive new=active/);
  assert.doesNotMatch(after, /icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell|innovus/);
  snapshot('passed', {
    sourceHashesBefore: sourceHashesBefore.split('\n'), sourceHashesAfter: sourceHashesAfter.split('\n'),
    environmentAfter: after,
    terminalRun: terminal,
    codeRecords: codes,
    testSha256: sha256(test), versionSha256: sha256(version),
    releaseStage: packStage(packDir), nativeRelease: release,
    claims: {
      currentMethodTest: 'PASS',
      businessVerdict: 'TERMINAL_NEGATIVE candidate subject to retained residual-frontier assessment',
      commercialEdaExecuted: false, ppaClaimed: false,
    },
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', runId, digest, evidence: path.join(out, 'evidence.json') }, null, 2)}\n`);
} catch (error) {
  failure = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  snapshot('failed');
  throw error;
} finally {
  if (host && runId && !host.ctx.hima.ledger.run(runId)?.status?.startsWith('ended-')) {
    await host.ctx.hima.cancelRun(runId);
  }
  await host?.dispose();
  await home.dispose();
}
