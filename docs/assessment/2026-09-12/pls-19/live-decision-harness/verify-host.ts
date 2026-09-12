// L2 protocol check only. Calls and executable below are deterministic fixtures, never model evidence.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack, type ExecutionActionRequest } from '@hima/harness';
import { installNumericPack, sha256 } from '../../../../../scripts/live-check-workshop.ts';
import { createHimaHome } from '../../../../../test/contract/support/dsh-home.ts';
import { bootInProcess, createRootAgent } from '../../../../../test/contract/support/boot-inprocess.ts';
import { packsDirOf } from '../../../../../test/contract/support/pack.ts';
import { writeLocalSite } from '../../../../../test/contract/support/site.ts';
import { homePatchFile } from '../../../../../packages/desktop/src/hima-home.ts';
import { tmuxHasSession } from '../../../../../test/contract/support/tmux.ts';

// A private tmux server and an explicit model-request rejection protect unrelated user work.
delete process.env.DEEPSEEK_API_KEY;
delete process.env.TMUX;
delete process.env.SSH_AUTH_SOCK;
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
const temporary = realpathSync(mkdtempSync('/tmp/hima-l2-fb-'));
process.env.TMPDIR = temporary;
process.env.TMUX_TMPDIR = temporary;
const evidence = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const h = await createHimaHome();
const flow = path.join(h.home, 'numeric-flow'); mkdirSync(flow);
writeFileSync(path.join(flow, 'numbers.txt'), '4\n9\n17\n39\n');
writeFileSync(path.join(flow, 'prepare.sh'), '#!/bin/sh\nset -eu\ncd "$1"\ncp numbers.txt measured.txt\n');
writeFileSync(path.join(flow, 'README.md'), 'L2 controlled positive numeric input. No model research claim.\n');
writeFileSync(homePatchFile(h.home), '- id: session-title-llm\n  disabled: true\n');
await writeLocalSite(h, { allowedReadRoots: [flow, h.workspace], allowedWriteRoots: [h.workspace], allowedWrappers: ['sh'], licences: {}, bindings: { flowRoot: flow, design: 'numeric', workspaceRoot: h.workspace } });
const pack = path.join(packsDirOf(h), 'live-numeric'); installNumericPack(pack);
loadPack(packsDirOf(h), 'live-numeric');
const host = await bootInProcess(h);
let modelRequests = 0;
host.ctx.on('agent/request', () => { modelRequests++; throw new Error('L2 forbids model requests'); });
let runId: string | undefined;
let failure: string | undefined;
const checks: string[] = [];
const actions: unknown[] = [];
try {
  const owner = await createRootAgent(host.ctx, h.workspace);
  const result = await host.ctx.hima.startRun({ pack: 'live-numeric', site: 'local', ownerSessionId: String(owner.id), goal: { minimum: 69 }, strategy: { limit: 10 }, generationLimit: 2 });
  assert.equal(result.kind, 'ran', JSON.stringify(result));
  if (result.kind !== 'ran') throw new Error('Run admission failed');
  runId = result.run.id;
  const initialRun = structuredClone(result.run);
  const context = () => host.ctx.hima.executionContext(runId!);
  const records = () => host.ctx.hima.ledger.records({ runId: runId! });
  let request = 0;
  const call = async (fields: Pick<ExecutionActionRequest, 'action'> & Partial<ExecutionActionRequest>, expected = 'accepted') => {
    const control = context().run.control!;
    const answer = await host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `feedback-${++request}`, ...fields });
    actions.push({ fields, answer });
    assert.equal(answer.kind, expected, JSON.stringify(answer));
    return answer;
  };
  const waitReady = async (id: string) => {
    const deadline = Date.now() + 75_000;
    while (context().executions.find((e) => e.id === id)?.phase !== 'ready') {
      assert.ok(Date.now() < deadline, JSON.stringify(context()));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  const begin = async (nodeId: string) => {
    const response = await call({ action: 'begin', nodeId });
    assert.ok(response.receipt?.executionId);
    return response.receipt.executionId;
  };
  const ready = async (nodeId: string) => {
    const executionId = await begin(nodeId);
    await call({ action: 'work', executionId }); await waitReady(executionId);
    return executionId;
  };
  const node = async (nodeId: string) => call({ action: 'complete', executionId: await ready(nodeId) });
  const cites = (generation: number) => records().filter((r) => (r.type === 'observation' || r.type === 'verdict') && r.generation === generation).map((r) => r.id);
  const code = '#!/bin/sh\nset -eu\nsleep 60\nawk -v limit="$2" \'$1 > limit { sum += $1 } END { print sum + 0 }\' "$1/flow/measured.txt" > "$1/result.txt"\n';
  const analyze = async (generation: number) => {
    const executionId = await begin('analyze');
    await call({ action: 'recommend', executionId });
    await call({ action: 'read', executionId, output: 'measured' });
    await call({ action: 'knowledge', executionId, file: 'sum.md' });
    await call({ action: 'write', executionId, path: 'analyze.sh', content: code });
    await call({ action: 'work', executionId });
    if (generation === 1) {
      const job = records().filter((r) => r.type === 'job').findLast((r) => r.event === 'launched');
      assert.ok(job && tmuxHasSession(job.job.session));
      await call({ action: 'pause' });
      assert.ok(tmuxHasSession(job.job.session), 'pause does not claim Job termination');
      await waitReady(executionId);
      assert.deepEqual(context().available, []);
      assert.equal(context().run.currentNode, 'analyze');
      checks.push('active first Job survived pause; mechanical completion did not start a successor');
      await call({ action: 'continue' });
    } else await waitReady(executionId);
    await call({ action: 'complete', executionId });
    await node('read-analysis'); await node('judge');
    return executionId;
  };
  await node('prepare');
  const first = await analyze(1);
  assert.ok(records().some((r) => r.type === 'observation' && r.generation === 1 && r.values.some((v) => v.type === 'numeric_sum' && v.value === 56)));
  assert.ok(records().some((r) => r.type === 'verdict' && r.generation === 1 && r.ruleId === 'minimum-sum' && r.outcome === 'FAIL'));
  assert.ok(records().some((r) => r.type === 'verdict' && r.generation === 1 && r.ruleId === 'positive-sum' && r.outcome === 'PASS'));
  checks.push('generation 1 measured 56 with cutoff 10; constraint PASS and full-sum Goal FAIL');
  const firstExplore = await ready('next-cutoff');
  await call({ action: 'complete', executionId: firstExplore, decision: 'goal-met', rationale: 'Deliberate invalid claim to verify refusal.', cites: cites(1) }, 'refused');
  await call({ action: 'complete', executionId: firstExplore, decision: 'next-strategy', strategy: { limit: 0 }, rationale: 'L2 deterministic choice: the input values 4 and 9 were excluded by cutoff 10; include them.', cites: cites(1) });
  assert.deepEqual(context().available, ['analyze']);
  assert.equal(context().run.generation, 2);
  checks.push('false success refused; explicit owner next-strategy revisited analyze with cutoff 0');
  const second = await analyze(2);
  assert.ok(records().some((r) => r.type === 'observation' && r.generation === 2 && r.values.some((v) => v.type === 'numeric_sum' && v.value === 69)));
  const secondVerdicts = records().filter((r) => r.type === 'verdict' && r.generation === 2);
  assert.equal(secondVerdicts.length, 2);
  assert.ok(secondVerdicts.every((r) => r.type === 'verdict' && r.outcome === 'PASS'));
  const secondExplore = await ready('next-cutoff');
  await call({ action: 'complete', executionId: secondExplore, decision: 'goal-met', rationale: 'Deliberately stale citations.', cites: cites(1) }, 'refused');
  await call({ action: 'complete', executionId: secondExplore, decision: 'goal-met', rationale: 'L2: actual full sum 69 and both current verdicts PASS.', cites: cites(2) });
  checks.push('generation 2 measured 69; both rules PASS; stale citations refused; current evidence accepted');
  const final = context();
  assert.equal(final.run.status, 'ended-goal-met');
  assert.equal(final.run.control?.owner, String(owner.id));
  assert.equal(final.run.generation, 2);
  assert.deepEqual(final.run.budget, initialRun.budget);
  assert.deepEqual(final.run.goal, initialRun.goal);
  assert.equal(final.run.createdAt, initialRun.createdAt);
  assert.equal(final.run.packDigest, initialRun.packDigest);
  assert.equal(final.executions.filter((e) => e.nodeId === 'prepare').length, 1);
  assert.equal(final.run.meters?.jobsLaunched, 5);
  const codes = records().filter((r) => r.type === 'code');
  assert.equal(codes.length, 2);
  for (const id of [first, second]) assert.ok(codes.some((r) => r.path.includes(`/.executions/${id}/`) && r.sessionId === String(owner.id) && sha256(readFileSync(r.path)) === r.sha256));
  assert.equal(modelRequests, 0);
  assert.equal(records().filter((r) => r.type === 'session').length, 0);
  checks.push('same owner, one Run, two distinct executable directories, original budget/Goal/method, five cumulative Jobs, zero model requests');
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  const run = runId ? host.ctx.hima.ledger.run(runId) : undefined;
  const records = runId ? host.ctx.hima.ledger.records({ runId }) : [];
  writeFileSync(path.join(evidence, 'host-evidence.json'), JSON.stringify({ level: 'L2 mechanism only; deterministic calls and handwritten test executable', sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), passed: !failure, failure: failure ?? null, elapsedMs: Date.now() - started, costs: { hosts: 1, modelRequests, electron: 0, ssh: 0, eda: 0 }, privateRoot: temporary, checks, run, records, actions }, null, 2) + '\n');
  if (runId && run?.status === 'running') await host.ctx.hima.cancelRun(runId);
  spawnSync('tmux', ['-S', path.join(temporary, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore', timeout: 2000 });
  await host.dispose();
  console.log(JSON.stringify({ passed: !failure, failure: failure ?? null, checks, modelRequests, elapsedMs: Date.now() - started }));
}
