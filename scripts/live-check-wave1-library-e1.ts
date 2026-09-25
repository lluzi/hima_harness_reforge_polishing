// @hima-seam agent wrapped
// @hima-seam tools direct
// Wave 1 lane B: actual library-intelligence Pack -> Host -> SSH Job -> Reader/Judge.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import {
  discoverSshSite, installPackMethod, loadPack, loadSite, packDigestOf, saveDiscoveredSite,
  type ExecutionActionRequest, type JobRecord, type Permit,
} from '@hima/harness';
import { homePatchFile } from '../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { waitUntil } from '../test/contract/support/fabric.ts';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
if (outAt < 0 || !args[outAt + 1] || args.length !== 2) throw new Error('usage: node scripts/live-check-wave1-library-e1.ts --out <fresh-directory>');
const out = path.resolve(args[outAt + 1]!);
if (existsSync(out)) throw new Error('evidence directory already exists');
mkdirSync(out, { recursive: true });

const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const destination = 'luzi@192.168.50.41';
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlPath=none', destination];
const remote = (command: string): string => execFileSync('ssh', [...ssh.slice(0, -1), destination, command], {
  encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
});
const upload = (target: string, bytes: string): void => {
  const result = spawnSync('ssh', [...ssh.slice(0, -1), destination, 'tee', '--', target], {
    input: bytes, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`upload failed for ${target}: ${result.stderr}`);
};

const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
const remoteRoot = `/data/eda/project/hima_harness/wave1-library-e1-${stamp}`;
remote(`test ! -e '${remoteRoot}' && mkdir -p '${remoteRoot}'`);

const permit: Permit = {
  allowedReadRoots: [
    '/data/eda/project',
    '/data/eda/pdk/saed14',
    '/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API',
    '/data/eda/venvs/qualib-libapi-2026-py37/bin',
    '/data/eda/container/podman/bin',
  ],
  allowedWriteRoots: [remoteRoot],
  allowedWrappers: ['/usr/local/bin/edarun', '/data/eda/container/podman/bin/edarun', '/usr/bin/python3'],
  forbidden: ['deletions'],
};
const permitBytes = stringify(permit);
const remotePermit = `${remoteRoot}/permit.yml`;
upload(remotePermit, permitBytes);

const worker = path.join(repoRoot, 'packs/library-intelligence/tools/libapi_worker.py');
const manifest = {
  schema: 'hima-library-qualification-input/1',
  runtime: {
    wrapper: '/usr/local/bin/edarun', wrapperRealpath: '/data/eda/container/podman/bin/edarun',
    wrapperSha256: '14ca5925cd7c27fda7a001857e9007681ff225efa4ad5b45469e9dc00384649f',
    python: '/data/eda/venvs/qualib-libapi-2026-py37/bin/python3.7',
    pythonSha256: 'f44e090f34d65e4cce10fc545f4b00c65959a92333a6d1e2f8e1b8c3ec6dde45', pythonVersion: '3.7',
    apiRoot: '/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API', apiBuild: '2026.master.c68db94',
    apiMarker: 'tmlib.py', apiMarkerSha256: '8e4cc6a0085cda7e2d36808cdab28c1784d08118fd184ed924e57bd71528a55f',
    nativeModule: '_tmlib.so', nativeModuleSha256: '11b9eec8af31f9c19cd52999e7caffc4899c73a878fcd6b7c8e75831eaa24f56',
    parserLibrarySha256: '4918f49c4921c6b43f1dca1e8e5428f3476e1b631cfebae3b1e3feeea09031d5',
    adapterSha256: sha(readFileSync(worker)),
  },
  permit: { path: remotePermit, sha256: sha(permitBytes) },
  license: { product: 'QuaLib', release: '2026', selection: 'new', port: 59099,
    claim: 'QuaLib-2026-new-59099', excludesClaim: 'XTop' },
  sources: [
    { role: 'vendor-fixture', path: '/data/eda/project/hima_harness/library-intelligence-prototypes/codex-q2026-20260924-01/vendor-fixture/testParser.lib', sha256: '0f72cff56a3ccb7e1bfeff4234c44bb85c42524d31eed18df7a59c40b4f47877' },
    { role: 'saed14', path: '/data/eda/pdk/saed14/stdcell_rvt/db_nldm/saed14rvt_tt0p8v25c.lib', sha256: '49962e1b61d08eae063633ba32ab76fc002c405d40e391e181e92ff445442571' },
    { role: 'tsmc28', path: '/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/tcbn28hpcplusbwp40p140tt0p9v25c.lib', sha256: 'a07fbf556c5aed51e08cbf19d916371dbb1b631ca926e46893ac8781fcb707b5' },
  ],
};
const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
const remoteManifest = `${remoteRoot}/qualification-manifest.json`;
upload(remoteManifest, manifestBytes);

const processState = (): string => remote("/usr/local/bin/empyrean-license status; ps -eo pid,args | grep -E '(icexplorer-xtop_exe|qualib_exe)' | grep -v grep || true").trim();
const before = processState();
assert.match(before, /selected=new old=inactive new=active/);
assert.doesNotMatch(before, /icexplorer-xtop_exe|qualib_exe/);
const sourcesBefore = remote(`sha256sum -- ${manifest.sources.map((source) => `'${source.path}'`).join(' ')}`).trim();

const home = await createHimaHome();
let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
let runId: string | undefined;
try {
  const installed = path.join(packsDirOf(home), 'library-intelligence');
  const installedReceipt = installPackMethod({ from: path.join(repoRoot, 'packs/library-intelligence'), to: installed });
  appendFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');
  const sitesDir = path.join(home.home, 'hima/sites');
  const discovery = await discoverSshSite({ name: 'wave1-library-e1', ssh: { destination, jumps: [], controlPersistSeconds: 60 }, hints: {
    workspaceRoot: remoteRoot, allowedReadRoots: permit.allowedReadRoots, allowedWriteRoots: permit.allowedWriteRoots,
    allowedWrappers: permit.allowedWrappers, toolCommands: ['edarun'],
  } });
  assert.deepEqual(discovery.unknowns, []); assert.deepEqual(discovery.conflicts, []);
  saveDiscoveredSite(sitesDir, { ...discovery, permit, site: { ...discovery.site, workspaceRoot: remoteRoot,
    bindings: { qualificationManifest: remoteManifest, qualificationPython: manifest.runtime.python, workspaceRoot: remoteRoot },
    capacity: { ...discovery.site.capacity, parallelJobs: 1, licences: { 'QuaLib-2026-new-59099': 1 } },
  } });
  const loadedSite = loadSite(sitesDir, 'wave1-library-e1');
  assert.equal(loadedSite.permitSha256, manifest.permit.sha256);

  host = await bootInProcess(home);
  const owner = await createRootAgent(host.ctx, home.workspace);
  const started = await host.ctx.hima.startRun({ pack: 'library-intelligence', site: loadedSite.name,
    goal: { qualification_required: 1 }, strategy: { qualificationRevision: 0 }, ownerSessionId: String(owner.id),
    timeBoxMs: 20 * 60_000, generationLimit: 1, retryAllowance: 1 });
  assert.equal(started.kind, 'ran', JSON.stringify(started));
  if (started.kind !== 'ran') throw new Error('Library E1 Run did not start');
  runId = started.run.id;
  let sequence = 0;
  const context = () => host!.ctx.hima.executionContext(runId!);
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
    const control = context().run.control!;
    return host!.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), origin: 'agent', action,
      expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `wave1-e1-${++sequence}`, ...fields });
  };
  const complete = async (nodeId: string, timeoutMs: number) => {
    assert.ok(context().available.includes(nodeId), `${nodeId} is not available: ${JSON.stringify(context())}`);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', begin.reason);
    const executionId = begin.receipt?.executionId; assert.ok(executionId);
    const work = await act('work', { executionId }); assert.equal(work.kind, 'accepted', work.reason);
    await waitUntil(`${nodeId} settles`, () => context().executions.some((entry) => entry.id === executionId && ['ready', 'failed'].includes(entry.phase)), timeoutMs, 250);
    const settled = context().executions.find((entry) => entry.id === executionId)!;
    assert.equal(settled.phase, 'ready', JSON.stringify(settled));
    const done = await act('complete', { nodeId, executionId }); assert.equal(done.kind, 'accepted', done.reason);
  };
  await complete('qualify-api', 15 * 60_000);
  await complete('read-qualification', 60_000);
  await complete('qualification-gate', 60_000);

  const records = host.ctx.hima.ledger.records({ runId });
  const jobs = records.filter((record): record is JobRecord => record.type === 'job');
  const launched = jobs.find((record) => record.event === 'launched' && record.nodeId === 'qualify-api');
  const finished = launched && jobs.find((record) => record.event === 'finished' && record.job.session === launched.job.session);
  assert.ok(launched); assert.equal(finished?.exitCode, 0);
  const observation = records.findLast((record) => record.type === 'observation');
  assert.ok(observation?.type === 'observation');
  assert.equal(observation.values.find((value) => value.type === 'library_qualification_ok')?.value, 1);
  const verdict = records.findLast((record) => record.type === 'verdict');
  assert.equal(verdict?.type === 'verdict' ? verdict.outcome : undefined, 'PASS');
  const receiptText = remote(`sed -n '1,1200p' '${started.workspace}/flow/qualification/receipt.json'`);
  const receipt = JSON.parse(receiptText) as Record<string, unknown>;
  const sourcesAfter = remote(`sha256sum -- ${manifest.sources.map((source) => `'${source.path}'`).join(' ')}`).trim();
  assert.equal(sourcesAfter, sourcesBefore);
  const after = processState();
  assert.match(after, /selected=new old=inactive new=active/); assert.doesNotMatch(after, /icexplorer-xtop_exe|qualib_exe/);
  const evidence = { schema: 'hima.wave1-library-e1/1', recordedAt: new Date().toISOString(), sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    pack: { id: 'library-intelligence', version: loadPack(path.join(repoRoot, 'packs'), 'library-intelligence').contract.version,
      sourceDigest: packDigestOf(path.join(repoRoot, 'packs/library-intelligence')), installedDigest: installedReceipt.digest },
    site: { name: loadedSite.name, permitSha256: loadedSite.permitSha256, remoteRoot, manifestPath: remoteManifest,
      manifestSha256: sha(manifestBytes), selected: 'new', port: 59099 },
    run: context().run, workspace: started.workspace, jobs, observation, verdict, receipt,
    sourceHashesBefore: sourcesBefore.split('\n'), sourceHashesAfter: sourcesAfter.split('\n'), environmentBefore: before, environmentAfter: after,
    claims: { e1: 'PASS', e2ToE4: 'not evaluated', corpus: 'not scanned', xTop: 'not started' } };
  writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(path.join(out, 'receipt.json'), receiptText);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', runId, workspace: started.workspace, evidence: path.join(out, 'evidence.json') }, null, 2)}\n`);
} finally {
  if (host && runId && !host.ctx.hima.ledger.run(runId)?.status?.startsWith('ended-')) await host.ctx.hima.cancelRun(runId);
  await host?.dispose();
  await home.dispose();
}
