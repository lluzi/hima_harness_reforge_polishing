// @hima-seam agent wrapped
// @hima-seam tools direct
import assert from 'node:assert/strict';
import { copyFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  currentRecordsIn,
  loadPack,
  listInteractiveSessions,
  packDigestExcludes,
  packStage,
  runDelegations,
  type JobRecord,
  type NodeRecord,
  type ObservationRecord,
  type RunRecord,
} from '@hima/harness';
import { bootInProcess, resumeTestAgent } from '../test/contract/support/boot-inprocess.ts';
import { repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';

const NAME = 'resume-xtop-native-test';
const PACK_ID = 'xtop-timing-closure';
const args = process.argv.slice(2);
const reportOnlyAt=args.indexOf('--report-only');
const reportOnly=reportOnlyAt>=0;
if(reportOnly)args.splice(reportOnlyAt,1);
const take = (flag: string): string => {
  const at = args.indexOf(flag); const value = at < 0 ? undefined : args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing ${flag}`);
  args.splice(at, 2); return value;
};
const homeRoot = realpathSync(take('--home'));
const runId = take('--run-id');
const bindingFile = realpathSync(take('--binding-file'));
assert.ok(lstatSync(bindingFile).isFile() && !lstatSync(bindingFile).isSymbolicLink());
process.argv = [process.argv[0]!, process.argv[1]!, ...args];

const installedPackDirectory = path.join(homeRoot, 'hima/packs', PACK_ID);
const sourcePackDirectory = path.join(repoRoot, 'packs', PACK_ID);
const home: HimaHome = {
  home: homeRoot,
  profileDir: path.join(homeRoot, 'profiles/hima'),
  workspace: path.join(homeRoot, 'workspace'),
  env: { ...process.env, DSH_HOME: homeRoot, DSH_AGENTS_HOME: path.join(homeRoot, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
  dispose: async () => undefined,
};
const terminal = (run: RunRecord | undefined): boolean => run?.status?.startsWith('ended-') === true || run?.status === 'cancelled';

await runLive(NAME, 16, async (check: LiveCheck) => {
  const host = await bootInProcess(home); check.attach(host); await host.ctx.hima.reconciled;
  const bundle = realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness'));
  guardInstalled(check, host, [bundle, path.join(homeRoot, 'hima/packs'), home.workspace], installedPackDirectory, check.temporary);
  host.ctx.tools.guard((execution) => {
    if (['bash', 'terminal'].includes(execution.name)) return 'native TEST recovery uses only Hima tools and the qualified interactive binding';
    if (execution.name === 'hima_author') return 'native TEST recovery does not author the method';
    return undefined;
  });
  const initial = host.ctx.hima.ledger.run(runId); assert.ok(initial?.control && initial.packId === PACK_ID);
  const ownerId = initial.control.owner;
  const owner = check.trackResumed((await resumeTestAgent(host.ctx, ownerId, { provider: 'deepseek-official', model: 'deepseek-flash' })).agent);
  check.observed.recovered = { runId, ownerId, home: homeRoot, bindingFile: { path: bindingFile, sha256: sha256(readFileSync(bindingFile)) } };
  if(reportOnly) {
    const source=loadPack(path.join(repoRoot,'packs'),PACK_ID);
    assert.ok(initial.purpose==='test'&&initial.status?.startsWith('ended-'), 'report-only requires an already ended native TEST');
    assert.equal(initial.packDigest,source.folder.digest(packDigestExcludes));
    assert.equal(loadPack(path.join(homeRoot,'hima/packs'),PACK_ID).folder.digest(packDigestExcludes),initial.packDigest);
    const beforeRun=JSON.stringify(initial);
    const before=host.ctx.hima.ledger.records({runId});
    const jobs=before.filter((record):record is JobRecord=>record.type==='job'&&record.event==='launched'&&record.nodeId==='run-xtop-fix');
    assert.equal(jobs.length,1);
    assert.ok(before.some(record=>record.type==='job'&&record.event==='finished'&&record.exitCode===0&&record.job.session===jobs[0]!.job.session));
    assert.equal(listInteractiveSessions(host.ctx.hima.ledger,runId).find(session=>session.toolSessionId===jobs[0]!.job.session)?.status,'closed');
    assert.ok(currentRecordsIn(before).some(record=>record.type==='node'&&record.nodeId==='read-xtop'&&record.state==='done'));
    host.ctx.tools.guard(execution=>['hima_execute','hima_interactive','hima_delegate','hima_run','hima_prepare'].includes(execution.name)
      ?'Report-only finalization cannot execute, resume or create a Run, Job, child or interactive operation.':undefined);
    check.observed.reportOnly={runId,status:initial.status,recordCount:before.length,control:initial.control};
    for(const stage of ['tested','released'] as const) {
      const instruction=stage==='tested'
        ?`/hima-test Reporting only for the already ended native test Run ${runId}. Do not resume the Run or create anything. Read its retained records and write TEST.md through the native test path. Preserve method bytes and report the exact ${initial.status} ending.`
        :`/hima-release ${PACK_ID}. Seal only the tested method using hima_pack_release; never handwrite VERSION.yml.`;
      for(let attempt=0;attempt<3&&packStage(installedPackDirectory).stage!==stage;attempt++)await check.say(owner,instruction);
      check.require(`report-only native pipeline reaches ${stage}`,packStage(installedPackDirectory).stage===stage,packStage(installedPackDirectory));
    }
    assert.equal(JSON.stringify(host.ctx.hima.ledger.run(runId)),beforeRun,'report-only changed the ended Run');
    assert.deepEqual(host.ctx.hima.ledger.records({runId}).map(record=>record.id),before.map(record=>record.id),'report-only changed Run evidence');
    copyFileSync(path.join(installedPackDirectory,'TEST.md'),path.join(sourcePackDirectory,'TEST.md'));
    copyFileSync(path.join(installedPackDirectory,'VERSION.yml'),path.join(sourcePackDirectory,'VERSION.yml'));
    check.observed.release={runId,packDigest:initial.packDigest,testSha256:sha256(readFileSync(path.join(sourcePackDirectory,'TEST.md'))),versionSha256:sha256(readFileSync(path.join(sourcePackDirectory,'VERSION.yml')))};
    return;
  }
  check.beforeDispose(async () => {
    const run = host.ctx.hima.ledger.run(runId);
    if (run?.status === 'running') {
      const working = Object.values(run.control?.executions ?? {}).some(execution => execution.phase === 'working');
      check.observed.cleanup = working ? await host.ctx.hima.cancelRun(runId)
        : { kind: 'preserved', runId, status: run.status, revision: run.control?.revision };
    }
  });

  const delegate = async (body: Record<string, unknown>) => {
    const control = host.ctx.hima.executionContext(runId).run.control!;
    return host.ctx.hima.delegate({ runId, actor: ownerId, expectedEpoch: control.epoch,
      expectedRevision: control.revision, ...body } as never, AbortSignal.timeout(90_000)) as Promise<Record<string, any>>;
  };
  const waitForResult = async (delegationId: string, requestId: string, maxMs: number) => {
    const deadline = Date.now() + maxMs;
    let latest: Record<string, any> = { status: 'unavailable' };
    while (Date.now() < deadline) {
      latest = await delegate({ action: 'result', requestId, delegationId });
      if (['candidate', 'duplicate', 'refused'].includes(latest.status)) return latest;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return latest;
  };
  const execution = host.ctx.hima.executionContext(runId).executions.find(item => item.nodeId === 'run-xtop-fix' && item.phase === 'begun');
  assert.ok(execution, 'the retained test Run is not at the begun XTop execution');
  const materialize = (memberId: string, requestId: string) => delegate({ action: 'create', requestId,
    recipe: { teamId: 'timing-eco-team', version: '1', memberId, executionId: execution.id } });

  const researcher = await materialize('researcher', 'wave1-create-researcher');
  check.require('recovery reuses the one Researcher child', ['created', 'duplicate'].includes(researcher.status), researcher);
  const researcherResult = await waitForResult(researcher.effectiveContract.delegationId, 'wave1-result-researcher', 60_000);
  check.require('the recovered Researcher has one durable candidate', ['candidate', 'duplicate'].includes(researcherResult.status), researcherResult);

  const reviewer = await materialize('reviewer', 'wave1-create-reviewer');
  check.require('recovery materializes one dependent Reviewer', ['created', 'duplicate'].includes(reviewer.status), reviewer);
  const reviewerResult = await waitForResult(reviewer.effectiveContract.delegationId, 'wave1-result-reviewer', 5 * 60_000);
  check.require('the Reviewer returns one durable candidate', ['candidate', 'duplicate'].includes(reviewerResult.status), reviewerResult);
  let reviewerRow = runDelegations((host.ctx.hima as unknown as { deps(): any }).deps(), runId).find(row => row.delegationId === reviewer.effectiveContract.delegationId);
  assert.ok(reviewerRow?.resultRecordId);
  const reviewerAdopted = reviewerRow.adoptedRecordId ? { status: 'duplicate', adoptedRecordId: reviewerRow.adoptedRecordId }
    : await delegate({ action: 'adopt', requestId: 'wave1-adopt-reviewer', delegationId: reviewer.effectiveContract.delegationId,
      resultRecordId: reviewerRow.resultRecordId });
  check.require('owner adopts the exact Reviewer candidate', ['accepted', 'duplicate'].includes(reviewerAdopted.status), reviewerAdopted);

  const operator = await materialize('operator', 'wave1-create-operator');
  check.require('recovery materializes exactly one qualified Operator', ['created', 'duplicate'].includes(operator.status)
    && operator.effectiveContract?.tools?.length === 1 && operator.effectiveContract.tools[0] === 'hima_interactive', operator);
  let operatorResult = await waitForResult(operator.effectiveContract.delegationId, 'wave1-result-operator-1', 20 * 60_000);
  const operatorReady = () => host.ctx.hima.executionContext(runId).executions.find(item => item.id === execution.id)?.phase === 'ready';
  if (operatorResult.status === 'refused' || !operatorReady()) {
    const follow = await delegate({ action: 'followup', requestId: 'wave1-finish-operator', delegationId: operator.effectiveContract.delegationId,
      text: 'The prior open attempts were deterministic pre-session authorization refusals and produced no XTop Job or mutation. Reuse this same child and exact immutable reviewed action. Open the qualified session with a fresh request id, run the typed validate/mutate/verify/save/close sequence once, then return exactly one JSON object matching xtop-operator-receipts/1.' });
    assert.equal(follow.status, 'accepted', JSON.stringify({ operatorResult, follow }));
    operatorResult = await waitForResult(operator.effectiveContract.delegationId, 'wave1-result-operator-2', 20 * 60_000);
  }
  check.require('the Operator returns one durable candidate', ['candidate', 'duplicate'].includes(operatorResult.status), operatorResult);
  await check.until('the typed Operator finalizer makes the execution ready', () =>
    operatorReady(), 20 * 60_000);
  const operatorRow = runDelegations((host.ctx.hima as unknown as { deps(): any }).deps(), runId).find(row => row.delegationId === operator.effectiveContract.delegationId); assert.ok(operatorRow?.resultRecordId);
  const operatorAdopted = operatorRow.adoptedRecordId ? { status: 'duplicate', adoptedRecordId: operatorRow.adoptedRecordId }
    : await delegate({ action: 'adopt', requestId: 'wave1-adopt-operator-recovery', delegationId: operator.effectiveContract.delegationId,
      resultRecordId: operatorRow.resultRecordId });
  check.require('owner adopts the exact Operator candidate', ['accepted', 'duplicate'].includes(operatorAdopted.status), operatorAdopted);
  let control = host.ctx.hima.executionContext(runId).run.control!;
  const complete = await host.ctx.hima.executionAction({ runId, actor: ownerId, origin: 'agent', action: 'complete',
    nodeId: 'run-xtop-fix', executionId: execution.id, requestId: 'wave1-complete-operator-node',
    expectedEpoch: control.epoch, expectedRevision: control.revision });
  check.require('owner completes run-xtop-fix only from finalized evidence', complete.kind === 'accepted' || complete.kind === 'duplicate', complete);
  control = host.ctx.hima.executionContext(runId).run.control!;
  const readBegin = await host.ctx.hima.executionAction({ runId, actor: ownerId, origin: 'agent', action: 'begin', nodeId: 'read-xtop',
    requestId: 'wave1-begin-read-xtop', expectedEpoch: control.epoch, expectedRevision: control.revision }); assert.equal(readBegin.kind, 'accepted');
  const readerExecutionId = readBegin.receipt?.executionId; assert.ok(readerExecutionId);
  control = host.ctx.hima.executionContext(runId).run.control!;
  const readWork = await host.ctx.hima.executionAction({ runId, actor: ownerId, origin: 'agent', action: 'work', executionId: readerExecutionId,
    requestId: 'wave1-work-read-xtop', expectedEpoch: control.epoch, expectedRevision: control.revision }); assert.equal(readWork.kind, 'accepted');
  await check.until('read-xtop settles', () => host.ctx.hima.executionContext(runId).executions.find(item => item.id === readerExecutionId)?.phase === 'ready', 120_000);
  control = host.ctx.hima.executionContext(runId).run.control!;
  const readDone = await host.ctx.hima.executionAction({ runId, actor: ownerId, origin: 'agent', action: 'complete', nodeId: 'read-xtop', executionId: readerExecutionId,
    requestId: 'wave1-complete-read-xtop', expectedEpoch: control.epoch, expectedRevision: control.revision }); assert.equal(readDone.kind, 'accepted');

  for (let cycle = 0; cycle < 20 && !terminal(host.ctx.hima.ledger.run(runId)); cycle += 1) {
    await check.say(owner, `Continue only the recovered test Run ${runId} from current hima_context through downstream Innovus, fresh StarRC and PrimeTime, comparison, evidence gate and the declared one-generation ending. Do not create another Run, child or XTop mutation.`);
    const run = host.ctx.hima.ledger.run(runId); if (!run) throw new Error('recovered Run disappeared');
    const working = host.ctx.hima.executionContext(runId).executions.find(item => item.phase === 'working');
    if (working) await check.until(`downstream execution ${working.id} settles`, () =>
      host.ctx.hima.executionContext(runId).executions.find(item => item.id === working.id)?.phase !== 'working', 30 * 60_000);
  }
  const finalRun = host.ctx.hima.ledger.run(runId)!;
  check.require('the recovered native test Run ends at its one-generation boundary', finalRun.status === 'ended-budget-exhausted', finalRun);

  const finishStage = async (stage: 'tested' | 'released', instruction: string) => {
    for (let attempt = 0; attempt < 3 && packStage(installedPackDirectory).stage !== stage; attempt += 1) await check.say(owner, instruction);
    check.require(`the recovered native Pack pipeline reaches ${stage}`, packStage(installedPackDirectory).stage === stage, packStage(installedPackDirectory));
  };
  await finishStage('tested', `/hima-test Resume only the existing ended test Run ${runId}. Do not start another Run. Read hima_status, write TEST.md from its retained records, and check the Pack.`);
  await finishStage('released', `/hima-release ${PACK_ID}. Seal only through hima_pack_release; do not handwrite VERSION.yml.`);
  copyFileSync(path.join(installedPackDirectory, 'TEST.md'), path.join(sourcePackDirectory, 'TEST.md'));
  copyFileSync(path.join(installedPackDirectory, 'VERSION.yml'), path.join(sourcePackDirectory, 'VERSION.yml'));
  const sourcePack = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
  check.require('the recovered native TEST and seal preserve the method digest', packStage(sourcePackDirectory).stage === 'released'
    && sourcePack.folder.digest(packDigestExcludes) === initial.packDigest, packStage(sourcePackDirectory));
  const records = host.ctx.hima.ledger.records({ runId });
  const observation = currentRecordsIn(records).findLast((record): record is ObservationRecord => record.type === 'observation' && record.reader.id === 'xtop-iteration-result');
  const launched = records.filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
  const completed = new Set(currentRecordsIn(records).filter((record): record is NodeRecord => record.type === 'node' && record.state === 'done').map(record => record.nodeId));
  check.observed.release = { runId, packDigest: initial.packDigest, testSha256: sha256(readFileSync(path.join(sourcePackDirectory, 'TEST.md'))),
    versionSha256: sha256(readFileSync(path.join(sourcePackDirectory, 'VERSION.yml'))), observation: observation?.id,
    jobsLaunched: launched.length, completedNodes: [...completed] };
});
