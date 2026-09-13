// @hima-seam tools direct
// Close a proved research Run without rerunning the model to satisfy an over-specific logging check.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packDigestOf, packStage } from '@hima/harness';
import { bootInProcess, resumeTestAgent, toolCalls } from '../test/contract/support/boot-inprocess.ts';
import type { HimaHome } from '../test/contract/support/dsh-home.ts';
import { sha256 } from './live-check-workshop.ts';

const [from, out] = process.argv.slice(2);
assert.ok(from && out && !existsSync(out), 'supply retained evidence and a fresh output directory');
const rawBytes = readFileSync(from);
const raw = JSON.parse(rawBytes.toString());
assert.equal(raw.status, 'failed');
assert.deepEqual(raw.checks.filter((c: { passed: boolean }) => !c.passed).map((c: { claim: string }) => c.claim), ['knowledge was actually read and recorded']);
const original = raw.runs[0].run;
assert.equal(original.packId, 'aes-timing-research');
assert.equal(original.status, 'ended-goal-met');
const folder = raw.observed.packFolder as string;
const homePath = path.resolve(folder, '../../..');
const owner = raw.observed.owner as string;
const agentOptions = raw.agents.find((a: { id: string }) => a.id === owner).options;
const h: HimaHome = { home: homePath, profileDir: path.join(homePath, 'profiles/hima'), workspace: path.join(homePath, 'workspace'),
  env: { ...process.env, DSH_HOME: homePath, DSH_AGENTS_HOME: path.join(homePath, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
  dispose: async () => undefined };
delete process.env.DEEPSEEK_API_KEY;
process.env.HIMA_TEST_SILENT_AGENT = '1';
mkdirSync(out, { recursive: true });
const host = await bootInProcess(h);
let requests = 0;
host.ctx.on('agent/request', () => { requests++; throw new Error('finalization forbids model requests'); });
const handle = await resumeTestAgent(host.ctx, owner, agentOptions);
try {
  const run = host.ctx.hima.ledger.run(original.id)!;
  assert.ok(isDeepStrictEqual(run, original), 'fresh Host agrees with the completed Run');
  const records = host.ctx.hima.ledger.records({ runId: run.id });
  assert.equal(run.control?.owner, String(handle.agent.id));
  assert.equal(run.goal?.minimum_score, 21);
  assert.equal(run.generation, 2);
  assert.equal(packDigestOf(folder), raw.observed.methodBeforeTest);
  assert.equal(packStage(folder).stage, 'tested');
  const knowledgeFile = path.join(folder, 'knowledge/selection-method.md');
  const knowledge = readFileSync(knowledgeFile, 'utf8');
  const read = raw.toolSequence.find((r: any) => r.name === 'read' && r.agent === owner
    && r.args.file_path === knowledgeFile && r.result.isError === false);
  assert.ok(read, 'actual successful native file read exists in the original session');
  assert.ok(toolCalls(handle.agent).some(call => call.name === 'read' && JSON.stringify(call.args).includes(knowledgeFile)));
  const returned = read.result.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  knowledge.trimEnd().split('\n').forEach((line, i) => {
    assert.ok(returned.split('\n').includes(String(i + 1) + ': ' + line), 'native read returned the complete knowledge line ' + (i + 1));
  });
  const codes = records.filter(r => r.type === 'code');
  assert.ok(codes.length >= 2);
  assert.ok(Date.parse(read.at) < Date.parse(codes[0]!.at), 'knowledge was read before code authoring');
  assert.equal(records.filter(r => r.type === 'knowledge').length, 0, 'no node-level knowledge record is invented');
  assert.equal(records.filter(r => r.type === 'session').length, 0, 'no hidden model moment');
  const workspace = records.find(r => r.type === 'workspace' && r.event === 'prepared');
  assert.ok(workspace?.type === 'workspace');
  assert.equal(sha256(readFileSync(path.join(workspace.workspace, 'sample.json'))), raw.observed.sample.sha256);
  const codeFiles = Object.values(run.control!.executions).flatMap(execution => {
    const entry = execution.intent?.workshop?.entry;
    if (!entry || execution.phase !== 'completed') return [];
    const record = codes.find(c => c.path === entry.path && c.sha256 === entry.sha256 && c.generation === execution.generation);
    assert.ok(record, 'launched code is an actual recorded version');
    const bytes = readFileSync(record.path);
    assert.equal(sha256(bytes), record.sha256);
    writeFileSync(path.join(out, 'generation-' + record.generation + '.py'), bytes);
    return [{ record: record.id, generation: record.generation, path: record.path, sha256: record.sha256, execution: execution.id }];
  });
  assert.equal(codeFiles.length, 2);
  assert.equal(codeFiles.find(c => c.generation === 1)?.sha256, sha256(readFileSync(path.join(workspace.workspace, 'baseline.py'))));
  const beforeScience = structuredClone({ run, records });
  const released = await host.ctx.tools.execute({ name: 'hima_pack_release', arguments: { pack: 'aes-timing-research' },
    agent: handle.agent, callId: 'research-native-finalization' as never, signal: AbortSignal.timeout(30_000) });
  assert.equal(released.isError, false, JSON.stringify(released));
  assert.equal(packStage(folder).stage, 'released');
  assert.ok(isDeepStrictEqual(beforeScience, { run: host.ctx.hima.ledger.run(run.id), records: host.ctx.hima.ledger.records({ runId: run.id }) }));
  assert.equal(requests, 0);
  assert.deepEqual(readFileSync(from), rawBytes, 'the original failed check remains byte-identical');
  const result = { status: 'passed', passed: true, check: 'independent research closure and native mechanical release',
    from: { path: path.resolve(from), sha256: sha256(rawBytes), rawStatus: 'failed' },
    limitation: 'Knowledge is proved by the original successful session read before code; no node-level knowledge read record exists. No research was rerun and no record was backfilled.',
    modelRequests: requests, newEdaJobs: 0, newResearchJobs: 0, hosts: 1,
    observed: { ...raw.observed, runId: run.id, workspace: workspace.workspace, codeFiles,
      knowledgeAttribution: { kind: 'session-read-before-code', callId: read.callId, at: read.at, session: owner, file: knowledgeFile, sha256: sha256(knowledge), nodeRecord: false },
      methodDigest: packDigestOf(folder), release: released },
    runs: [{ run, records }] };
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write('research closure PASS; 0 model requests, 0 new research/EDA Jobs\n');
} finally { await handle.dispose(); await host.dispose(); }
