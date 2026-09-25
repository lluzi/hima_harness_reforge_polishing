// @hima-seam agent wrapped
// @hima-seam tools direct
// Wave 2: one real Pack/Host/QuaLib path plus durable memory/restart acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import {
  discoverSshSite, installPackMethod, loadPack, loadSite, nativeSessionMemoryEvidence,
  packDigestOf, readGuideContext, readNativeSessionContext, readReportMaterial,
  readRunAssets, saveDiscoveredSite, writeRunAssets,
  type DelegationRecord, type ExecutionActionRequest, type JobRecord, type Permit,
} from '@hima/harness';
import { homePatchFile } from '../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent, resumeTestAgent, saidByModel, sayAsUser, toolCalls } from '../test/contract/support/boot-inprocess.ts';
import { himaCommand } from '../test/contract/support/command.ts';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { waitUntil } from '../test/contract/support/fabric.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
if (outAt < 0 || !args[outAt + 1] || args.length !== 2) throw new Error('usage: node scripts/live-check-wave2-library.ts --out <fresh-directory>');
if (!(process.env.DEEPSEEK_API_KEY ?? '').trim()) throw new Error('DEEPSEEK_API_KEY is required for the bounded native Session/child acceptance');
const out = path.resolve(args[outAt + 1]!);
if (existsSync(out)) throw new Error('evidence directory already exists');
mkdirSync(out, { recursive: true });

const sha = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const destination = 'luzi@192.168.50.41';
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlPath=none', destination];
const remote = (command: string): string => execFileSync('ssh', [...ssh.slice(0, -1), destination, command], {
  encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
});
const upload = (target: string, bytes: string): void => {
  const result = spawnSync('ssh', [...ssh.slice(0, -1), destination, 'tee', '--', target], {
    input: bytes, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`upload failed for ${target}: ${result.stderr}`);
};
const processState = (): string => remote("/usr/local/bin/empyrean-license status; ps -eo pid,args | grep -E '(icexplorer-xtop_exe|qualib_exe)' | grep -v grep || true").trim();

const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
const remoteRoot = `/data/eda/project/hima_harness/wave2-library-${stamp}`;
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const failureAt = path.join(out, 'failure.json');
let failureContext: Record<string, unknown> = { schema: 'hima.wave2-library-failure/1', sourceSha, remoteRoot };

const permit: Permit = {
  allowedReadRoots: [
    '/data/eda/project', '/data/eda/pdk/saed14',
    '/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API',
    '/data/eda/venvs/qualib-libapi-2026-py37/bin', '/data/eda/container/podman/bin', '/usr/bin',
  ],
  allowedWriteRoots: [remoteRoot],
  allowedWrappers: ['/usr/local/bin/edarun', '/data/eda/container/podman/bin/edarun', '/usr/bin/python3'],
  forbidden: ['deletions'],
};
const permitBytes = stringify(permit);
const remotePermit = `${remoteRoot}/permit.yml`;
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

const home = await createHimaHome();
let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
let runId: string | undefined;
let childId: string | undefined;
let ownerResume: Awaited<ReturnType<typeof resumeTestAgent>> | undefined;
let childResume: Awaited<ReturnType<typeof resumeTestAgent>> | undefined;
try {
  remote(`test ! -e '${remoteRoot}' && mkdir -p '${remoteRoot}'`);
  upload(remotePermit, permitBytes);
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const remoteManifest = `${remoteRoot}/qualification-manifest.json`;
  upload(remoteManifest, manifestBytes);
  const before = processState();
  assert.match(before, /selected=new old=inactive new=active/);
  assert.doesNotMatch(before, /icexplorer-xtop_exe|qualib_exe/);
  const sourceHashesBefore = remote(`sha256sum -- ${manifest.sources.map(source => `'${source.path}'`).join(' ')}`).trim();

  const installed = path.join(packsDirOf(home), 'library-intelligence');
  const installedReceipt = installPackMethod({ from: path.join(repoRoot, 'packs/library-intelligence'), to: installed });
  appendFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');
  const sitesDir = path.join(home.home, 'hima/sites');
  const discovery = await discoverSshSite({ name: 'wave2-library', ssh: { destination, jumps: [], controlPersistSeconds: 60 }, hints: {
    workspaceRoot: remoteRoot, allowedReadRoots: permit.allowedReadRoots, allowedWriteRoots: permit.allowedWriteRoots,
    allowedWrappers: permit.allowedWrappers, toolCommands: ['edarun', 'python3'],
  } });
  assert.deepEqual(discovery.unknowns, []); assert.deepEqual(discovery.conflicts, []);
  saveDiscoveredSite(sitesDir, { ...discovery, permit, site: { ...discovery.site, workspaceRoot: remoteRoot,
    bindings: { qualificationManifest: remoteManifest, qualificationPython: manifest.runtime.python, workspaceRoot: remoteRoot },
    capacity: { ...discovery.site.capacity, parallelJobs: 1, licences: { 'QuaLib-2026-new-59099': 1 } },
  } });
  const site = loadSite(sitesDir, 'wave2-library');
  assert.equal(site.permitSha256, manifest.permit.sha256);

  host = await bootInProcess(home);
  let modelRequestSteps = 0;
  host.ctx.on('agent/request', async (_request, next) => { modelRequestSteps += 1; return next(); });
  const owner = await createRootAgent(host.ctx, home.workspace); const ownerId = String(owner.id);
  assert.equal(owner.options.model, 'deepseek-flash');
  const started = await host.ctx.hima.startRun({ pack: 'library-intelligence', site: site.name, test: true,
    goal: { qualification_required: 1 }, strategy: { qualificationRevision: 0 }, ownerSessionId: ownerId,
    timeBoxMs: 20 * 60_000, generationLimit: 1, retryAllowance: 1 });
  assert.equal(started.kind, 'ran', JSON.stringify(started));
  if (started.kind !== 'ran') throw new Error('Wave 2 Run did not start');
  runId = started.run.id;
  failureContext = { ...failureContext, runId, workspace: started.workspace };

  await sayAsUser(owner, `This is a bounded memory-carrier check for Library Run ${runId}. Do not call tools or change the Run. Reply with one short note that current Run, Job, report, hold and budget facts must be re-read before action. Context padding: ${'The saved summary is not control authority. '.repeat(350)}`);
  const ownerSaid = saidByModel(owner);
  assert.ok(ownerSaid.length > 0);
  const nativeBeforeCompact = await nativeSessionMemoryEvidence(host.ctx, { sessionId: ownerId, workspaceRef: home.workspace });
  const sessionSources = await host.ctx.hima.workMemory(ownerId, { action: 'sources' }) as any;
  const savedSession = await host.ctx.hima.workMemory(ownerId, { action: 'save', summary: {
    subject: 'Wave 2 Library task native checkpoint', decisions: [ownerSaid.at(-1)!.slice(0, 1000)], openQuestions: [],
    todo: ['Re-read current authority before action.'], references: [], sources: [], nativeSources: sessionSources.nativeSources,
  } }) as any;
  assert.equal(savedSession.kind, 'current'); assert.equal(savedSession.summary.modelGenerated, false);
  const compact = await himaCommand(host, home.workspace, '/compact', undefined, owner);
  assert.equal(compact.kind, 'success', compact.text);
  const preservedPrefix = await nativeSessionMemoryEvidence(host.ctx, { sessionId: ownerId, workspaceRef: home.workspace,
    throughSeq: nativeBeforeCompact.capturedThroughSeq });
  assert.equal(preservedPrefix.transcriptIdentity, nativeBeforeCompact.transcriptIdentity);
  const compactedContext = await readNativeSessionContext(host.ctx, { sessionId: ownerId, targetSessionId: ownerId });
  assert.match(JSON.stringify(compactedContext.context), /compacted-summary/);
  const staleSession = await host.ctx.hima.workMemory(ownerId, { action: 'read' }) as any;
  assert.equal(staleSession.kind, 'stale'); assert.match(staleSession.reason, /newer events/);

  const initialSources = await host.ctx.hima.workMemory(ownerId, { action: 'sources', runId }) as any;
  const initialMemory = await host.ctx.hima.workMemory(ownerId, { action: 'save', runId, summary: {
    subject: 'Wave 2 before the qualification Job', decisions: ['Do not repeat a completed Job from this summary.'], openQuestions: [],
    todo: ['Re-read current Job facts.'], references: initialSources.references, sources: initialSources.sources, nativeSources: [],
  } }) as any;
  assert.equal(initialMemory.kind, 'current');

  let sequence = 0;
  const context = () => host!.ctx.hima.executionContext(runId!);
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}, origin: 'agent' | 'human' = 'agent') => {
    const control = context().run.control!;
    return host!.ctx.hima.executionAction({ runId: runId!, actor: ownerId!, origin, action,
      expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `wave2-library-${++sequence}`, ...fields });
  };
  const complete = async (nodeId: string, timeoutMs = 120_000) => {
    assert.ok(context().available.includes(nodeId), `${nodeId} unavailable: ${JSON.stringify(context())}`);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', begin.reason);
    const executionId = begin.receipt?.executionId; assert.ok(executionId);
    const work = await act('work', { executionId }); assert.equal(work.kind, 'accepted', work.reason);
    await waitUntil(`${nodeId} settles`, () => context().executions.some(entry => entry.id === executionId && ['ready', 'failed'].includes(entry.phase)), timeoutMs, 200);
    const settled = context().executions.find(entry => entry.id === executionId)!;
    assert.equal(settled.phase, 'ready', JSON.stringify(settled));
    const done = await act('complete', { nodeId, executionId }); assert.equal(done.kind, 'accepted', done.reason);
  };

  await complete('qualify-api', 15 * 60_000);
  const jobStale = await host.ctx.hima.workMemory(ownerId, { action: 'read', runId }) as any;
  assert.equal(jobStale.kind, 'stale');
  assert.equal(jobStale.authority[0].jobs.filter((job: any) => job.nodeId === 'qualify-api' && job.event === 'finished').length, 1);
  assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter(record => record.type === 'job' && record.event === 'launched' && record.nodeId === 'qualify-api').length, 1);
  await complete('read-qualification');
  await complete('qualification-gate');

  const beforeHold = await host.ctx.hima.workMemory(ownerId, { action: 'sources', runId }) as any;
  await host.ctx.hima.workMemory(ownerId, { action: 'save', runId, summary: {
    subject: 'Wave 2 after E1', decisions: ['E1 passed; E2 still requires current authorization.'], openQuestions: [],
    todo: ['Re-read human holds.'], references: beforeHold.references, sources: beforeHold.sources, nativeSources: [],
  } });
  const pause = await act('pause', {}, 'human'); assert.equal(pause.kind, 'accepted', pause.reason);
  const holdStale = await host.ctx.hima.workMemory(ownerId, { action: 'read', runId }) as any;
  assert.equal(holdStale.kind, 'stale'); assert.match(holdStale.reason, /control changed/); assert.deepEqual(holdStale.authority[0].holds, ['*']);
  const heldBegin = await act('begin', { nodeId: 'index-baseline' }); assert.equal(heldBegin.kind, 'refused');
  const continued = await act('continue', {}, 'human'); assert.equal(continued.kind, 'accepted', continued.reason);

  for (const node of ['index-baseline', 'read-baseline-facts', 'index-candidate', 'read-candidate-facts', 'semantic-delta',
    'read-library-delta', 'library-insight', 'read-library-insight']) await complete(node);

  const reportRecord = host.ctx.hima.ledger.records({ runId, type: 'observation' })
    .findLast(record => record.type === 'observation' && record.reader.id === 'library-insight');
  assert.ok(reportRecord?.type === 'observation');
  if (reportRecord?.type !== 'observation') throw new Error('Library Insight observation is absent');
  const guideDeps = { ctx: host.ctx, ledger: host.ctx.hima.ledger,
    executionContext: (id: string) => host!.ctx.hima.executionContext(id), readExperience: (id: string) => host!.ctx.hima.readExperience(id),
    readReportMaterial: (id: string, ref: string) => readReportMaterial({ ledger: host!.ctx.hima.ledger, sitesDir, packsDir: packsDirOf(home) }, id, ref) };
  const reportTarget = { kind: 'report' as const, reportRef: reportRecord.id, version: String(reportRecord.seq), sha256: reportRecord.contentSha256 };
  const reportView = await readGuideContext(guideDeps, { sessionId: ownerId, requestId: 'wave2-native-report', target: reportTarget });
  assert.ok(reportView.facts && 'evidenceClass' in reportView.facts && reportView.facts.evidenceClass === 'native-qualified');
  assert.deepEqual(reportView.missing, []);

  const control = context().run.control!;
  const child = await host.ctx.hima.delegate({ runId, actor: ownerId, action: 'create', requestId: 'wave2-memory-child',
    expectedEpoch: control.epoch, expectedRevision: control.revision, contract: { delegationId: 'library-memory-handoff', role: 'researcher',
      task: `Read exact report record ${reportRecord.id}. Return a concise candidate handoff that preserves the same-source zero-delta limit and unknown design impact.`,
      inputRefs: [reportRecord.id], allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 45_000, maxFollowups: 1, maxTokensPerTurn: 1800 },
      dependencyIds: [], recipient: { kind: 'run-owner', sessionId: ownerId } } } as never, AbortSignal.timeout(60_000)) as any;
  assert.equal(child.status, 'created', JSON.stringify(child)); childId = child.receipt.childSessionId;
  assert.equal(typeof childId, 'string'); const childSessionId = childId!;
  const childAgent = host.ctx.get('agents')!.get(childSessionId as never)!;
  await childAgent.whenIdle();
  const observeChild = async (requestId: string) => {
    const current = context().run.control!;
    return host!.ctx.hima.delegate({ runId: runId!, actor: ownerId!, action: 'result', delegationId: 'library-memory-handoff', requestId,
      expectedEpoch: current.epoch, expectedRevision: current.revision } as never) as Promise<any>;
  };
  let childResult = await observeChild('wave2-observe-child-1');
  if (childResult.status !== 'candidate') {
    const current = context().run.control!;
    const follow = await host.ctx.hima.delegate({ runId, actor: ownerId, action: 'followup', delegationId: 'library-memory-handoff', requestId: 'wave2-finish-child',
      text: 'Return one concise final answer now from the exact report input and keep every limitation explicit.', expectedEpoch: current.epoch, expectedRevision: current.revision } as never);
    assert.equal((follow as any).status, 'accepted'); await host.ctx.get('agents')!.get(childSessionId as never)!.whenIdle();
    childResult = await observeChild('wave2-observe-child-2');
  }
  assert.equal(childResult.status, 'candidate', JSON.stringify(childResult));
  const childRecord = host.ctx.hima.ledger.records({ runId, type: 'delegation' })
    .findLast((record): record is DelegationRecord => record.type === 'delegation' && record.delegationId === 'library-memory-handoff' && record.event === 'result-observed');
  assert.ok(childRecord);
  const handoff = (childRecord!.payload as any).handoff;
  assert.match(handoff.outputIdentity, /^[a-f0-9]{64}$/); assert.equal('nativeMessages' in handoff, false);
  const childSources = await host.ctx.hima.workMemory(childSessionId, { action: 'sources' }) as any;
  const childMemory = await host.ctx.hima.workMemory(childSessionId, { action: 'save', summary: { subject: 'Library child handoff',
    decisions: ['Candidate only; preserve report identity and unknowns.'], openQuestions: [], todo: ['Parent decides whether to adopt.'],
    references: [], sources: [], nativeSources: childSources.nativeSources } }) as any;
  assert.equal(childMemory.kind, 'current');

  const postReport = await host.ctx.hima.workMemory(ownerId, { action: 'sources', runId }) as any;
  await host.ctx.hima.workMemory(ownerId, { action: 'save', runId, summary: { subject: 'Wave 2 report produced',
    decisions: ['Native-qualified report is read-only and bounded to the same-source control.'], openQuestions: ['Need an independent candidate Library.'],
    todo: ['Re-read final result and proposal.'], references: postReport.references, sources: postReport.sources, nativeSources: [] } });

  for (const node of ['evaluate-library-rule', 'read-library-rule-result', 'propose-library-rule', 'read-library-proposal']) await complete(node);
  const ended = context().run; assert.ok(ended.status?.startsWith('ended-'), JSON.stringify(ended));
  const sourceHashesAfter = remote(`sha256sum -- ${manifest.sources.map(source => `'${source.path}'`).join(' ')}`).trim();
  assert.equal(sourceHashesAfter, sourceHashesBefore);
  const after = processState(); assert.match(after, /selected=new old=inactive new=active/); assert.doesNotMatch(after, /icexplorer-xtop_exe|qualib_exe/);

  const archiveDeps = { ledger: host.ctx.hima.ledger, sitesDir, packsDir: packsDirOf(home), projectOfRun: async () => home.workspace };
  await writeRunAssets(archiveDeps, runId);
  const archive = await readRunAssets(archiveDeps, runId); assert.equal(archive.kind, 'read', JSON.stringify(archive));
  if (archive.kind !== 'read') throw new Error('Wave 2 archive is unavailable');
  const experienceMaterial = archive.manifest.materials.find(material => material.path === 'experience.json'); assert.ok(experienceMaterial);
  const completion = host.ctx.hima.ledger.records({ runId, type: 'archive' }).findLast(record => record.type === 'archive' && record.delivery === 'complete');
  assert.ok(completion?.type === 'archive' && completion.manifestSha256);
  if (completion?.type !== 'archive' || !completion.manifestSha256 || !experienceMaterial) throw new Error('Wave 2 archive identity is incomplete');
  const correctionFile = `${started.workspace}/wave2-experience-correction.txt`;
  upload(correctionFile, 'Do not generalize a same-source zero delta into revision equivalence.\n');
  const correctionEvidence = await host.ctx.hima.observe({ site: site.name, run: runId, path: correctionFile, reader: 'raw' });
  assert.equal(correctionEvidence.kind, 'observed'); if (correctionEvidence.kind !== 'observed') throw new Error('correction evidence was not observed');
  const disabled = await host.ctx.hima.correctExperience(ownerId, { runId, requestId: 'wave2-disable-overgeneralization', event: 'disabled',
    reason: 'The same-source control cannot be reused as evidence of a candidate Library revision.',
    candidate: { sourceRun: runId, sourceManifestSha256: completion.manifestSha256, sourceMaterialPath: 'experience.json', sourceMaterialSha256: experienceMaterial.sha256 },
    evidenceRefs: [correctionEvidence.record.id] });
  assert.equal(disabled.event, 'disabled');

  const foreignWorkspace = path.join(home.home, 'foreign-workspace'); mkdirSync(foreignWorkspace);
  const foreign = await createRootAgent(host.ctx, foreignWorkspace);
  await assert.rejects(host.ctx.hima.workMemory(String(foreign.id), { action: 'read', runId }), /not linked to the current project/i);

  const recordsBeforeRestart = host.ctx.hima.ledger.records({ runId });
  const launchedBeforeRestart = recordsBeforeRestart.filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
  const ownerModel = { provider: owner.options.provider!, model: owner.options.model! };
  await host.dispose(); host = await bootInProcess(home); await host.ctx.hima.reconciled;
  ownerResume = await resumeTestAgent(host.ctx, ownerId, ownerModel);
  childResume = await resumeTestAgent(host.ctx, childSessionId);
  const campaignAfterRestart = await host.ctx.hima.workMemory(ownerId, { action: 'read', runId }) as any;
  assert.equal(campaignAfterRestart.kind, 'stale'); assert.ok(campaignAfterRestart.authority[0].status.startsWith('ended-'));
  assert.ok(campaignAfterRestart.authority[0].reportRefs.includes(reportRecord.id));
  const childAfterRestart = await host.ctx.hima.workMemory(childSessionId, { action: 'read' }) as any;
  assert.ok(['current', 'stale'].includes(childAfterRestart.kind), JSON.stringify(childAfterRestart));
  const resumedOwnerContext = await readNativeSessionContext(host.ctx, { sessionId: ownerId, targetSessionId: ownerId });
  assert.match(JSON.stringify(resumedOwnerContext.context), /compacted-summary/);
  const resumedChildContext = await readNativeSessionContext(host.ctx, { sessionId: ownerId, targetSessionId: childSessionId, parentSessionId: ownerId }, host.ctx.hima.ledger);
  assert.ok(resumedChildContext.events.length > 0);
  const retainedChildRecord = host.ctx.hima.ledger.record(childRecord!.id); assert.ok(retainedChildRecord?.type === 'delegation');
  assert.equal((retainedChildRecord as DelegationRecord).payload && ((retainedChildRecord as DelegationRecord).payload as any).handoff.outputIdentity, handoff.outputIdentity);
  const retainedDisable = host.ctx.hima.ledger.records({ runId, type: 'experience-adoption' }).find(record => record.type === 'experience-adoption' && record.id === disabled.id);
  assert.equal(retainedDisable?.type === 'experience-adoption' ? retainedDisable.event : undefined, 'disabled');
  const launchedAfterRestart = host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
  assert.equal(launchedAfterRestart.length, launchedBeforeRestart.length, 'restart does not replay a completed Job');
  assert.equal(launchedAfterRestart.filter(record => record.nodeId === 'qualify-api').length, 1);

  const fileNames = ['baseline-facts.json', 'candidate-facts.json', 'delta.json', 'insight-report.json', 'rule-result.json', 'proposal.json'];
  const artifacts = Object.fromEntries(fileNames.map(name => {
    const text = remote(`cat '${started.workspace}/flow/library/${name}'`); writeFileSync(path.join(out, name), `${text.trim()}\n`);
    return [name, { sha256: sha(`${text.trim()}\n`), bytes: Buffer.byteLength(`${text.trim()}\n`) }];
  }));
  const finalRecords = host.ctx.hima.ledger.records({ runId });
  const evidence = { schema: 'hima.wave2-library/1', recordedAt: new Date().toISOString(), sourceSha,
    pack: { id: 'library-intelligence', version: loadPack(path.join(repoRoot, 'packs'), 'library-intelligence').contract.version,
      sourceDigest: packDigestOf(path.join(repoRoot, 'packs/library-intelligence')), installedDigest: installedReceipt.digest },
    site: { name: site.name, permitSha256: site.permitSha256, remoteRoot, manifestPath: remoteManifest, manifestSha256: sha(manifestBytes) },
    run: host.ctx.hima.ledger.run(runId), workspace: started.workspace,
    records: finalRecords, reportTarget, reportView, artifacts, sourceHashesBefore: sourceHashesBefore.split('\n'), sourceHashesAfter: sourceHashesAfter.split('\n'),
    environmentBefore: before, environmentAfter: after,
    memory: { initialMemory, jobStale, holdStale, staleSession, campaignAfterRestart, childAfterRestart,
      compact: { kind: compact.kind, prefixIdentity: preservedPrefix.transcriptIdentity, contextAvailability: (resumedOwnerContext.context as { availability?: unknown }).availability },
      child: { sessionId: childSessionId, resultRecordId: childRecord!.id, outputIdentity: handoff.outputIdentity, persistedEvents: resumedChildContext.events.length },
      correction: { recordId: disabled.id, event: disabled.event }, crossWorkspace: 'refused' },
    model: { provider: owner.options.provider, model: owner.options.model, requestSteps: modelRequestSteps,
      ownerTurns: ownerSaid.map(text => ({ bytes: Buffer.byteLength(text), sha256: sha(text) })), apiRequests: 'unmeasured', tokens: 'unmeasured' },
    claims: { e1: 'PASS', e2: 'PASS representative facts and exact same-source zero control', e3: 'PASS versioned native-qualified retained report and Host view',
      e4: 'PASS typed no-mutation result and versioned proposal', memory: 'PASS bounded recovery matrix',
      limits: ['one representative Cell/table sample, not full corpus', 'same source baseline/candidate, not a revision comparison', 'no design evidence or design-impact conclusion', 'no Library mutation or release approval', 'no L5 value claim'] } };
  writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const secret = process.env.DEEPSEEK_API_KEY!;
  for (const name of ['evidence.json', ...fileNames]) assert.equal(readFileSync(path.join(out, name)).includes(secret), false, `retained ${name} contains no API key`);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', runId, packDigest: evidence.pack.sourceDigest, evidence: path.join(out, 'evidence.json') }, null, 2)}\n`);
} catch (error) {
  writeFileSync(failureAt, `${JSON.stringify({ ...failureContext, at: new Date().toISOString(), error: String(error), stack: error instanceof Error ? error.stack : undefined }, null, 2)}\n`);
  throw error;
} finally {
  await childResume?.dispose(); await ownerResume?.dispose();
  if (host && runId && ['running', 'waiting'].includes(host.ctx.hima.ledger.run(runId)?.status ?? '')) await host.ctx.hima.cancelRun(runId);
  await host?.dispose(); await home.dispose();
}
