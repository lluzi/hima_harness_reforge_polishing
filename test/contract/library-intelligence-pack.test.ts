import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkPack, loadPack, loadSite } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { installPack } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { waitUntil } from './support/fabric.ts';

const packDir = path.join(repoRoot, 'packs/library-intelligence');
const worker = path.join(packDir, 'tools/libapi_worker.py');
const reader = path.join(packDir, 'tools/read-qualification.py');
const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

const stub = `
import os, signal, shutil
class Array(list):
    def size(self): return len(self)
class Values(Array): pass
class Table:
    def isCcsModel(self): return False
    def isVectorModel(self): return False
    def getValues(self): return Values([0.125] * 49)
    def getTypeStr(self): return "cell_rise"
class Arc:
    def getDataGroups(self): return Array([Table()])
    def getRelatedPinName(self): return "A"
    def getTimingTypeStr(self): return "combinational"
class Pin:
    def isPgPin(self): return False
    def getTimingGroups(self, _): return Array([Arc()])
    def name(self): return "Z"
    def getDirectionStr(self): return "output"
class Cell:
    def getAllLibertyPins(self): return Array([Pin()])
    def name(self): return "AN2"
    def getArea(self): return 1.25
class Lib:
    def __init__(self, source): self.source = source
    def isNull(self): return False
    def name(self):
        if "CRASH" in open(self.source).read():
            os.kill(os.getpid(), signal.SIGSEGV)
        return "synthetic"
    def getTimeUnit(self): return 1e-9
    def getCapUnit(self): return 1e-12
    def getVoltageUnit(self): return 1.0
    def getLibertyCells(self): return Array([Cell()])
    def outputLib(self, copy):
        shutil.copyfile(self.source, copy)
        if "MUTATE" in open(self.source).read():
            open(self.source, "a").write("changed after copy\\n")
        return True
def readTmlib(source, log):
    open(log, "w").write("stub parser only\\n")
    return Lib(source)
def releaseTmlib(_): pass
`;

interface Fixture {
  root: string;
  workspace: string;
  manifest: string;
  permit: string;
  python: string;
  sources: string[];
  run(): { status: number | null; stderr: string };
  receipt(): Promise<any>;
  read(): { status: number | null; stderr: string; output: string };
  dispose(): Promise<void>;
}

async function fixture(additionalRoot?: string): Promise<Fixture> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hima-library-e1-')));
  const workspace = path.join(root, 'workspace');
  const flow = path.join(workspace, 'flow');
  const api = path.join(root, 'api');
  const site = path.join(root, 'sites');
  await Promise.all([mkdir(path.join(flow, 'tools'), { recursive: true }),
    mkdir(path.join(api, 'lib'), { recursive: true }), mkdir(site)]);
  await cp(worker, path.join(flow, 'tools/libapi_worker.py'));
  await cp(reader, path.join(flow, 'tools/read-qualification.py'));
  await writeFile(path.join(api, 'tmlib.py'), stub);
  await writeFile(path.join(api, '_tmlib.so'), 'synthetic native marker only\n');
  await writeFile(path.join(api, 'lib/libparser_wrapper.so'), 'synthetic parser marker only\n');
  const py = spawnSync('python3', ['-c', 'import sys; print(sys.executable); print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const [python, pythonVersion] = py.stdout.trim().split('\n');
  assert.ok(python && pythonVersion);
  const sources = await Promise.all(['vendor-fixture', 'saed14', 'tsmc28'].map(async (role) => {
    const target = path.join(root, role + '.lib');
    await writeFile(target, 'SYNTHETIC LIBERTY ' + role + '\n');
    return target;
  }));
  const permit = path.join(site, 'local.permit.yml');
  const permitText = [
    'allowedReadRoots:', `  - ${root}`, `  - ${path.dirname(await realpath(python))}`,
    ...(additionalRoot ? [`  - ${additionalRoot}`] : []),
    'allowedWriteRoots:', `  - ${root}`,
    ...(additionalRoot ? [`  - ${additionalRoot}`] : []),
    'allowedWrappers:', '  - /usr/local/bin/edarun', '  - /usr/bin/python3',
    'forbidden:', '  - deletions', '',
  ].join('\n');
  await writeFile(permit, permitText);
  const manifest = path.join(root, 'qualification.json');
  const manifestValue = {
    schema: 'hima-library-qualification-input/1',
    runtime: { wrapper: '/usr/local/bin/edarun', python,
      pythonSha256: sha(await readFile(python)), pythonVersion,
      apiRoot: api, apiBuild: 'synthetic-test-only',
      apiMarker: 'tmlib.py', apiMarkerSha256: sha(stub),
      nativeModule: '_tmlib.so', nativeModuleSha256: sha('synthetic native marker only\n'),
      parserLibrarySha256: sha('synthetic parser marker only\n'),
      adapterSha256: sha(await readFile(worker)) },
    permit: { path: permit, sha256: sha(permitText) },
    sources: await Promise.all(sources.map(async (source, index) => ({
      role: ['vendor-fixture', 'saed14', 'tsmc28'][index],
      path: source, sha256: sha(await readFile(source)),
    }))),
  };
  await writeFile(manifest, JSON.stringify(manifestValue));
  await writeFile(path.join(site, 'local.yml'), [
    'name: local', 'kind: local', `workspaceRoot: ${workspace}`,
    'permit: ./local.permit.yml', 'bindings:',
    `  qualificationManifest: ${manifest}`,
    `  workspaceRoot: ${workspace}`,
    'capacity: { cores: 2, memoryGiB: 2, parallelJobs: 1, licences: {} }', '',
  ].join('\n'));
  return {
    root, workspace, manifest, permit, python, sources,
    run() {
      const run = spawnSync(python, [path.join(flow, 'tools/libapi_worker.py'), manifest, workspace], { encoding: 'utf8' });
      return { status: run.status, stderr: run.stderr };
    },
    async receipt() {
      return JSON.parse(await readFile(path.join(flow, 'qualification/receipt.json'), 'utf8'));
    },
    read() {
      const output = path.join(root, 'reading.json');
      const run = spawnSync(python, [path.join(flow, 'tools/read-qualification.py'),
        path.join(flow, 'qualification/receipt.json'), output], { encoding: 'utf8' });
      return { status: run.status, stderr: run.stderr, output };
    },
    async dispose() { await rm(root, { recursive: true, force: true }); },
  };
}

test('development Pack loads and actual checkPack refuses a missing Reader wrapper', async () => {
  const f = await fixture();
  try {
    const pack = loadPack(path.join(repoRoot, 'packs'), 'library-intelligence');
    assert.equal(pack.contract.tools.length, 0, 'development Pack must expose no native launch tool');
    assert.equal(pack.graph.entry, 'blocked', 'default graph must enter the hard wait');
    assert.ok(pack.graph.nodes.every((node) => node.kind !== 'act' || node.parameters.tool === undefined));
    const site = loadSite(path.join(f.root, 'sites'), 'local');
    const fit = checkPack(pack, site);
    assert.equal(fit.fit, true, fit.errors.join('\n'));
    const permitText = (await readFile(f.permit, 'utf8')).replace('  - /usr/bin/python3\n', '');
    await writeFile(f.permit, permitText);
    const refused = checkPack(pack, loadSite(path.join(f.root, 'sites'), 'local'));
    assert.equal(refused.fit, false);
    assert.match(refused.errors.join('\n'), /reader.*\/usr\/bin\/python3.*not an allowed wrapper/);
  } finally { await f.dispose(); }
});

test('isolated synthetic API probes yield three native passes but no product qualification without Host Permit attestation', async () => {
  const f = await fixture();
  try {
    const original = await Promise.all(f.sources.map((source) => readFile(source)));
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.nativeStatus, 'passed');
    assert.equal(receipt.status, 'blocked');
    assert.equal(receipt.reason, 'hima/library-permit-unattested');
    assert.equal(receipt.permitAttestation, 'unverified-site-binding');
    assert.equal(receipt.facts, null);
    assert.deepEqual(receipt.results.map((item: any) => item.status), ['passed', 'passed', 'passed']);
    for (const [index, item] of receipt.results.entries()) {
      assert.equal(item.sourceSha256, sha(original[index]!));
      assert.equal(item.sourceAfterSha256, sha(original[index]!));
      assert.equal(item.exitCode, 0);
      assert.equal(item.queryEvidence.library, 'synthetic');
      assert.equal(item.queryEvidence.sample.tableSize, 49);
      assert.ok(Object.values(item.steps).every((status) => status === 'passed'));
      assert.deepEqual(await readFile(f.sources[index]!), original[index]);
    }
    const reading = f.read();
    assert.equal(reading.status, 0, reading.stderr);
    assert.deepEqual(JSON.parse(await readFile(reading.output, 'utf8')),
      { values: [{ type: 'library_qualification_ok', unit: 'count', value: 0 }] });
  } finally { await f.dispose(); }
});

test('SIGSEGV in one synthetic child blocks later input with signal and log hash, no partial facts', async () => {
  const f = await fixture();
  try {
    await writeFile(f.sources[1]!, 'CRASH\n');
    const value = JSON.parse(await readFile(f.manifest, 'utf8'));
    value.sources[1].sha256 = sha('CRASH\n');
    await writeFile(f.manifest, JSON.stringify(value));
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.nativeStatus, 'blocked');
    assert.equal(receipt.status, 'blocked');
    assert.equal(receipt.facts, null);
    assert.deepEqual(receipt.results.map((item: any) => item.status), ['passed', 'blocked', 'blocked']);
    assert.equal(receipt.results[1].reason, 'hima/library-worker-crashed');
    assert.ok(receipt.results[1].signal === 11);
    assert.match(receipt.results[1].logSha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.results[2].reason, 'hima/library-not-run');
    assert.equal(receipt.results[2].logSha256, null);
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }
});

test('source hash mismatch and Site-root refusal stop before any native child starts', async () => {
  const f = await fixture();
  try {
    await writeFile(f.sources[0]!, 'CHANGED\n');
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.reason, 'hima/library-source-identity');
    assert.ok(receipt.results.every((item: any) => item.logSha256 === null));
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }

  const g = await fixture();
  try {
    const permitText = (await readFile(g.permit, 'utf8')).replace(`  - ${g.root}\n`, '');
    await writeFile(g.permit, permitText);
    const value = JSON.parse(await readFile(g.manifest, 'utf8'));
    value.permit.sha256 = sha(permitText);
    await writeFile(g.manifest, JSON.stringify(value));
    const run = g.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await g.receipt();
    assert.equal(receipt.reason, 'hima/library-preflight-refused');
    assert.ok(receipt.results.every((item: any) => item.logSha256 === null));
    assert.equal(g.read().status, 0, 'a preflight refusal remains a readable blocked receipt');
  } finally { await g.dispose(); }
});

test('changed native binary blocks at runtime identity before any parser child', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, 'api/_tmlib.so'), 'changed native marker\n');
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.reason, 'hima/library-runtime-identity');
    assert.equal(receipt.results[0].steps.permit, 'passed');
    assert.equal(receipt.results[0].steps.runtime, 'blocked');
    assert.ok(receipt.results.every((item: any) => item.logSha256 === null));
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }
});

test('source mutation during a synthetic native call blocks the receipt and keeps the changed hash', async () => {
  const f = await fixture();
  try {
    await writeFile(f.sources[2]!, 'MUTATE\n');
    const value = JSON.parse(await readFile(f.manifest, 'utf8'));
    value.sources[2].sha256 = sha('MUTATE\n');
    await writeFile(f.manifest, JSON.stringify(value));
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const receipt = await f.receipt();
    assert.equal(receipt.reason, 'hima/library-source-mutated');
    assert.equal(receipt.nativeStatus, 'blocked');
    assert.deepEqual(receipt.results.map((item: any) => item.status), ['passed', 'passed', 'blocked']);
    assert.notEqual(receipt.results[2].sourceAfterSha256, receipt.results[2].expectedSha256);
    assert.equal(receipt.results[2].steps['source-after-hash'], 'blocked');
    assert.equal(receipt.results[2].queryEvidence, null);
    assert.equal(f.read().status, 0);
  } finally { await f.dispose(); }
});

test('Reader refuses a changed worker log even when the receipt says native probes passed', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    await writeFile(path.join(f.workspace, 'flow/qualification/vendor-fixture/worker.log'), 'tampered\n');
    const reading = f.read();
    assert.notEqual(reading.status, 0);
    assert.match(reading.stderr, /worker log bytes differ/);
  } finally { await f.dispose(); }
});

test('Reader refuses queryEvidence edited without changing the hashed child result', async () => {
  const f = await fixture();
  try {
    assert.equal(f.run().status, 0);
    const receiptPath = path.join(f.workspace, 'flow/qualification/receipt.json');
    const receipt = await f.receipt();
    receipt.results[0].queryEvidence.sample.firstValue = 0.875;
    await writeFile(receiptPath, JSON.stringify(receipt));
    const reading = f.read();
    assert.notEqual(reading.status, 0);
    assert.match(reading.stderr, /query evidence differs from hashed child result/);
  } finally { await f.dispose(); }
});

test('default real Host Run stays at blocked wait and cannot launch native tool from a forged manifest', async () => {
  const h = await createHimaHome();
  const f = await fixture(h.workspace);
  let runId: string | undefined;
  try {
    await installPack(h, 'library-intelligence');
    await writeFile(f.manifest, JSON.stringify({ forged: true,
      allowedReadRoots: ['/'], allowedWriteRoots: ['/'], wrapper: '/usr/local/bin/edarun' }));
    await writeLocalSite(h, {
      bindings: { qualificationManifest: f.manifest, workspaceRoot: h.workspace },
      allowedReadRoots: [h.workspace, f.root], allowedWriteRoots: [h.workspace],
      allowedWrappers: ['/usr/bin/python3'],
    });
    const host = await bootInProcess(h);
    try {
      const owner = await createRootAgent(host.ctx, h.workspace);
      const started = await host.ctx.hima.startRun({
        pack: 'library-intelligence', site: 'local', goal: { qualification_required: 1 },
        strategy: { qualificationRevision: 0 }, ownerSessionId: String(owner.id),
      });
      assert.equal(started.kind, 'ran', JSON.stringify(started));
      if (started.kind !== 'ran') return;
      runId = started.run.id;
      assert.equal(started.run.currentNode, 'blocked');
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0);
      const refused = await host.ctx.hima.executionAction({
        runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0,
        requestId: 'forged-native-launch', action: 'begin', nodeId: 'qualify-api',
      });
      assert.equal(refused.kind, 'refused');
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0);
    } finally {
      if (runId) await host.ctx.hima.cancelRun(runId);
      await host.dispose();
    }
  } finally { await f.dispose(); await h.dispose(); }
});

test('real local Host materializes the blocked Pack Reader as zero and never reaches a PASS verdict', async () => {
  const h = await createHimaHome();
  const f = await fixture(h.workspace);
  let runId: string | undefined;
  try {
    const installed = await installPack(h, 'library-intelligence');
    const graphPath = path.join(installed.dir, 'graph.yml');
    const graph = await readFile(graphPath, 'utf8');
    await writeFile(graphPath, graph.replace('entry: blocked', 'entry: read-qualification'));
    await writeLocalSite(h, {
      bindings: { qualificationManifest: f.manifest, workspaceRoot: h.workspace },
      allowedReadRoots: [h.workspace, f.root],
      allowedWriteRoots: [h.workspace],
      allowedWrappers: ['/usr/local/bin/edarun', '/usr/bin/python3'],
    });
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const host = await bootInProcess(h);
    try {
      const owner = await createRootAgent(host.ctx, h.workspace);
      const started = await host.ctx.hima.startRun({
        pack: 'library-intelligence', site: 'local', goal: { qualification_required: 1 },
        strategy: { qualificationRevision: 0 }, ownerSessionId: String(owner.id),
      });
      assert.equal(started.kind, 'ran', JSON.stringify(started));
      if (started.kind !== 'ran') return;
      runId = started.run.id;
      assert.equal(started.run.currentNode, 'read-qualification');
      await mkdir(path.join(started.workspace, 'flow/tools'), { recursive: true });
      await cp(worker, path.join(started.workspace, 'flow/tools/libapi_worker.py'));
      await cp(path.join(f.workspace, 'flow/qualification'),
        path.join(started.workspace, 'flow/qualification'), { recursive: true });
      const act = (action: 'begin' | 'work' | 'complete', executionId?: string, nodeId?: string) => {
        const control = host.ctx.hima.ledger.run(runId!)!.control!;
        return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id),
          expectedEpoch: control.epoch, expectedRevision: control.revision,
          requestId: `e1-${action}-${control.revision}`, action, executionId, nodeId });
      };
      const begin = await act('begin', undefined, 'read-qualification');
      const id = begin.receipt?.executionId;
      assert.ok(id);
      assert.equal((await act('work', id)).kind, 'accepted');
      await waitUntil('Library Reader Job settles', () =>
        host.ctx.hima.executionContext(runId!).executions.some((item) => item.id === id && item.phase === 'ready'));
      assert.equal((await act('complete', id)).kind, 'accepted');
      const observations = host.ctx.hima.ledger.records({ runId, type: 'observation' });
      assert.equal(observations.length, 1);
      const observation = observations[0]!;
      assert.equal(observation.type, 'observation');
      if (observation.type === 'observation') {
        assert.deepEqual(observation.values, [{ type: 'library_qualification_ok', unit: 'count', value: 0 }]);
        assert.equal(observation.reader.id, 'library-qualification');
      }
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'verdict' })
        .filter((item) => item.type === 'verdict' && item.outcome === 'PASS').length, 0);
    } finally {
      if (runId) await host.ctx.hima.cancelRun(runId);
      await host.dispose();
    }
  } finally { await f.dispose(); await h.dispose(); }
});
