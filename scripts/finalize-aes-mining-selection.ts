// @hima-seam tools direct
// Audit completed six-route execution after the model's final-response wait exceeded its deadline.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';
import { packDigestOf } from '@hima/harness';
import { bootInProcess, resumeTestAgent } from '../test/contract/support/boot-inprocess.ts';
import type { HimaHome } from '../test/contract/support/dsh-home.ts';
import { sha256 } from './live-check-workshop.ts';

const [from, out] = process.argv.slice(2);
assert.ok(from && out && !existsSync(out), 'retained evidence and a fresh audit directory are required');
const originalBytes = readFileSync(from);
const raw = JSON.parse(originalBytes.toString());
assert.equal(raw.status, 'failed');
assert.match(raw.failure, /live-check deadline reached/);
const original = raw.runs[0].run;
assert.equal(original.packId, 'aes-mining-selection-check');
assert.equal(original.status, 'ended-goal-not-met');
const owner = original.control.owner;
const folder = raw.observed.packFolder as string;
const homePath = path.resolve(folder, '../../..');
delete process.env.DEEPSEEK_API_KEY;
process.env.HIMA_TEST_SILENT_AGENT = '1';
const home: HimaHome = { home: homePath, profileDir: path.join(homePath, 'profiles/hima'), workspace: path.join(homePath, 'workspace'),
  env: { ...process.env, DSH_HOME: homePath, DSH_AGENTS_HOME: path.join(homePath, 'agents'), DSH_TELEMETRY_DISABLED: '1' }, dispose: async () => undefined };
mkdirSync(out, { recursive: true });
const host = await bootInProcess(home);
let modelRequests = 0;
host.ctx.on('agent/request', () => { modelRequests++; throw new Error('audit forbids model requests'); });
const handle = await resumeTestAgent(host.ctx, owner, raw.agents.find((a: { id: string }) => a.id === owner).options);
try {
  const run = host.ctx.hima.ledger.run(original.id)!;
  assert.ok(isDeepStrictEqual(run, original), 'fresh Host agrees with the completed execution');
  assert.equal(run.control!.owner, String(handle.agent.id));
  assert.equal(packDigestOf(folder), raw.observed.sliceMethod);
  const records = host.ctx.hima.ledger.records({ runId: run.id });
  const selections = records.filter(r => r.type === 'observation' && r.reader.reportKind === 'aes-dtco-selection/1');
  assert.equal(selections.length, 6);
  assert.ok(selections.every(r => r.type === 'observation' && r.values.some(v => v.type === 'selected_count' && v.value === 2)));
  const verdicts = records.filter(r => r.type === 'verdict');
  assert.equal(verdicts.length, 12); assert.ok(verdicts.every(v => v.outcome === 'PASS'));
  const executions = Object.values(run.control!.executions).filter(e => e.intent?.workshop?.entry && e.phase === 'completed');
  assert.equal(executions.length, 6);
  const codes = records.filter(r => r.type === 'code');
  const written = new Set<string>();
  const codeFiles = [];
  for (const execution of executions) {
    const entry = execution.intent!.workshop!.entry;
    const code = codes.find(c => c.path === entry.path && c.sha256 === entry.sha256);
    assert.ok(code && code.sessionId === owner);
    const material = await host.ctx.hima.readMaterial(run.id, code.id);
    assert.equal(material.kind, 'read', JSON.stringify(material));
    if (material.kind !== 'read') throw new Error('recorded code not readable');
    assert.equal(sha256(material.text), code.sha256);
    const target = path.join(out, code.sha256 + '.py');
    if (!written.has(code.sha256)) { writeFileSync(target, material.text); written.add(code.sha256); }
    codeFiles.push({ node: execution.nodeId, record: code.id, execution: execution.id, path: code.path, sha256: code.sha256, export: path.basename(target) });
  }
  const template = path.join(folder, 'flow/selection-template.py');
  for (const hash of written) {
    const syntaxCheck: SpawnSyncReturns<string> = spawnSync('/usr/bin/python3', ['-c',
      'import ast,sys\ndef main(p):\n return ast.dump(next(n for n in ast.parse(open(p).read()).body if isinstance(n,ast.FunctionDef) and n.name=="main"))\nassert main(sys.argv[1])==main(sys.argv[2])\n',
      template, path.join(out, hash + '.py')], { encoding: 'utf8' });
    assert.equal(syntaxCheck.status, 0, 'executed code retains the scaffold I/O and validation: ' + syntaxCheck.stderr);
  }
  assert.ok(records.some(r => r.type === 'knowledge'), 'actual controlled knowledge reads are recorded');
  assert.equal(records.filter(r => r.type === 'session').length, 0);
  const workspace = records.find(r => r.type === 'workspace' && r.event === 'prepared'); assert.ok(workspace?.type === 'workspace');
  assert.equal(modelRequests, 0);
  assert.deepEqual(readFileSync(from), originalBytes);
  const evidence = { status: 'passed', passed: true, check: 'fresh Host audit of completed six-route V4 selection',
    from: { path: path.resolve(from), sha256: sha256(originalBytes), status: raw.status, failure: raw.failure },
    limitation: 'Original live check remains failed at its final-response deadline. This separate audit validates the already completed finite selection, not a full physical Campaign or PPA claim; no derived Pack release is performed.',
    hosts: 1, nativeSessionsResumed: 1, modelRequests, newResearchJobs: 0, newEdaJobs: 0,
    observed: { ...raw.observed, runId: run.id, workspace: workspace.workspace, codeFiles, templateMainPreserved: true },
    runs: [{ run, records }] };
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write('six-route selection audit PASS; no model or research/EDA Job rerun\n');
} finally { await handle.dispose(); await host.dispose(); }
