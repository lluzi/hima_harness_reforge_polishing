// @hima-seam agent wrapped
// @hima-seam tools direct
// An isolated native Researcher qualification: r6 supplies only read-only source bytes; the
// current bundle creates one fresh local Host/Run and serves its current input envelope.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadPack, packDigestExcludes, retainRunMaterial } from '@hima/harness';
import { bootInProcess, createRootAgent, saidByModel, toolCalls, toolResults } from '../test/contract/support/boot-inprocess.ts';
import { repoRoot } from '../test/contract/support/dsh-home.ts';
import { localHome } from '../test/contract/support/fabric.ts';
import { timingProbePackId } from '../test/contract/support/pack.ts';

const PACK_ID = 'xtop-timing-closure';
const RETAINED_RUN = 'run-08161316-d1c4-4214-9ced-c35ab5bb5689';
const RETAINED_HOME = '/private/tmp/hima-l4-ic8Tpi/hima-home-0dXckX';
const SOURCE = { closureState: `${RETAINED_RUN}#000050`, closureExperience: `${RETAINED_RUN}#000073` } as const;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const args = process.argv.slice(2); const index = args.indexOf('--out'); const target = index < 0 ? undefined : args[index + 1];
if (!target || args.length !== 2) throw new Error('usage: node scripts/qualify-xtop-researcher.ts --out <fresh-directory>');
const out = path.resolve(target); if (existsSync(out)) throw new Error(`evidence directory already exists: ${out}`); mkdirSync(out, { recursive: true });
if (!existsSync(RETAINED_HOME)) throw new Error(`retained r6 Home is unavailable: ${RETAINED_HOME}`);
const secret = process.env.DEEPSEEK_API_KEY;
const receipt: Record<string, unknown> = { check: 'qualify-xtop-researcher', startedAt: now(), retained: { home: RETAINED_HOME, runId: RETAINED_RUN,
  access: 'read-only source bytes and ledger provenance; no original Home, Run, or child is booted, resumed, or written' } };
const writeReceipt = () => writeFileSync(path.join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);

type Source = { name: keyof typeof SOURCE; id: string; contentSha256: string; bytes: number; reader: unknown; values: unknown; bytesValue: Buffer };
const sources = (): readonly Source[] => {
  const ledger = JSON.parse(readFileSync(path.join(RETAINED_HOME, 'storages/hima_ledger.json'), 'utf8')) as { tables: { records: Record<string, any> } };
  return (Object.entries(SOURCE) as readonly [keyof typeof SOURCE, string][]).map(([name, id]) => {
    const record = ledger.tables.records[id]; assert.equal(record?.type, 'observation'); assert.equal(record.runId, RETAINED_RUN);
    const bytesValue = readFileSync(path.join(RETAINED_HOME, 'hima/packs', PACK_ID, 'run-assets/.evidence', RETAINED_RUN, `${record.contentSha256}.dat`));
    assert.equal(bytesValue.length, record.bytes); assert.equal(sha256(bytesValue), record.contentSha256);
    return { name, id, contentSha256: record.contentSha256, bytes: record.bytes, reader: record.reader, values: record.values, bytesValue };
  });
};
const responseText = (result: { isError?: boolean; content?: readonly { type: string; text?: string }[] }) => {
  assert.equal(result.isError, false, JSON.stringify(result)); return result.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? '';
};
const candidateOf = (text: string, schemaId: string) => {
  const candidate = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(candidate).sort(), ['evidenceRefs', 'hypotheses', 'limitations', 'schema']); assert.equal(candidate.schema, schemaId);
  for (const key of ['hypotheses', 'evidenceRefs', 'limitations']) assert.ok(Array.isArray(candidate[key]), `${key} must be an array`);
  assert.ok((candidate.hypotheses as readonly unknown[]).length <= 3); assert.ok(text.length <= 2000); return candidate;
};

const previous = { nodeTest: process.env.NODE_TEST_CONTEXT, silent: process.env.HIMA_TEST_SILENT_AGENT };
let runId: string | undefined; let host: Awaited<ReturnType<typeof bootInProcess>> | undefined; let home: Awaited<ReturnType<typeof localHome>> | undefined;
try {
  const retained = sources();
  receipt.retainedSource = retained.map(item => ({ name: item.name, historicalRecordId: item.id, contentSha256: item.contentSha256, bytes: item.bytes, sourceBytesSha256: sha256(item.bytesValue) }));
  const pack = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
  const researcher = pack.contract.agentTeams.find(team => team.id === 'timing-eco-team')?.members.find(member => member.id === 'researcher');
  assert.ok(researcher); assert.equal(researcher.budgetShare.maxTokensPerTurn, 5000);
  receipt.pack = { id: PACK_ID, version: pack.contract.version, digest: pack.folder.digest(packDigestExcludes), taskTemplateSha256: sha256(researcher.taskTemplate), effectiveMaxTokensPerTurn: 5000 };

  process.env.NODE_TEST_CONTEXT = '1'; process.env.HIMA_TEST_SILENT_AGENT = '1';
  home = await localHome({ skip: (reason: string) => { throw new Error(`local fixture unavailable: ${reason}`); } } as never, { sleepSeconds: 0 }); assert.ok(home);
  receipt.isolatedHome = { home: home.h.home, workspace: home.h.workspace };
  host = await bootInProcess(home.h); const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
  assert.equal(owner.options.model, 'deepseek-flash');
  const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor, timeBoxMs: 120_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('fresh local Run was not admitted'); runId = started.run.id;
  const observations = new Map<string, any>();
  for (const item of retained) {
    const retainedPath = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir: path.join(home.h.home, 'hima/packs') }, runId, item.bytesValue, item.contentSha256); assert.ok(retainedPath);
    observations.set(item.name, await host.ctx.hima.ledger.appendObservation(runId, { path: item.name === 'closureState' ? 'flow/state/current.json' : 'flow/evidence/experience.jsonl', contentSha256: item.contentSha256,
      retainedPath, bytes: item.bytes, reader: item.reader as any, values: item.values as any }));
  }
  const control = host.ctx.hima.executionContext(runId).run.control!;
  const probe = await host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'current-projection-probe', expectedEpoch: control.epoch, expectedRevision: control.revision,
    contract: { delegationId: 'current-projection-probe', role: 'researcher', task: 'Read no inputs; this child authenticates one current input projection.', inputRefs: [...observations.values()].map(value => value.id),
      allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 5_000, maxFollowups: 0 }, dependencyIds: [], recipient: { kind: 'run-owner', sessionId: actor } } } as any) as any;
  assert.equal(probe.status, 'created', JSON.stringify(probe)); const probeAgent = host.ctx.get('agents')?.get(probe.receipt.childSessionId as never); assert.ok(probeAgent);
  const projections: Record<string, any> = {};
  for (const [name, observation] of observations) {
    const result = await host.ctx.tools.execute({ callId: `projection-${name}` as never, name: 'hima_delegation_input', arguments: { runId, recordId: observation.id }, agent: probeAgent, signal: AbortSignal.timeout(30_000) });
    const rendered = responseText(result); assert.equal(rendered.includes('Full formatted result stored at:'), false); projections[name] = JSON.parse(rendered);
    assert.equal(projections[name].kind, 'record-fact'); assert.equal(projections[name].payload.contentSha256, observation.contentSha256); assert.equal(projections[name].payload.bytes, observation.bytes); assert.deepEqual(projections[name].payload.values, observation.values);
  }
  const state = projections.closureState; assert.equal(state.payload.material.truncated, true); assert.equal(state.payload.material.returnedBytes, 0); assert.equal('value' in state.payload.material, false);
  receipt.currentProjection = { freshRunId: runId, sourceObservationIds: Object.fromEntries([...observations].map(([name, value]) => [name, value.id])), closureState: { contentSha256: state.payload.contentSha256, bytes: state.payload.bytes, values: state.payload.values, material: state.payload.material },
    closureExperience: { contentSha256: projections.closureExperience.payload.contentSha256, bytes: projections.closureExperience.payload.bytes, material: projections.closureExperience.payload.material } };

  process.env.HIMA_TEST_SILENT_AGENT = '0';
  const current = host.ctx.hima.executionContext(runId).run.control!;
  const resultFormat = `Result contract from Pack: schema must equal ${JSON.stringify(researcher.resultSchema.id)}; required top-level fields: ${researcher.resultSchema.required.join(', ')}.`;
  const task = `${researcher.taskTemplate}\n\n${resultFormat}\nThis is an isolated qualification. Use hima_delegation_input exactly once for each granted input. The closure-state material may be wholly omitted; use only delivered typed values and identity, state that limit, and never claim endpoint facts not delivered. Return only raw JSON with exactly schema, hypotheses, evidenceRefs, limitations; the latter three are arrays; at most three hypotheses; no Markdown.`;
  assert.ok(task.includes(resultFormat));
  receipt.flashOperation = { status: 'creating-one-child', model: owner.options.model, at: now() }; writeReceipt();
  const qualified = await host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'current-projection-researcher', expectedEpoch: current.epoch, expectedRevision: current.revision,
    contract: { delegationId: 'current-projection-researcher', role: 'researcher', task, inputRefs: [...observations.values()].map(value => value.id), allowedTools: ['hima_delegation_input'],
      budgetShare: { maxElapsedMs: 90_000, maxFollowups: 0, maxTokensPerTurn: 5000 }, dependencyIds: [], recipient: { kind: 'run-owner', sessionId: actor } } } as any) as any;
  assert.equal(qualified.status, 'created', JSON.stringify(qualified)); const child = host.ctx.get('agents')?.get(qualified.receipt.childSessionId as never); assert.ok(child);
  receipt.flashOperation = { status: 'one-child-created', childSessionId: child.id, model: child.options.model, at: now() }; writeReceipt();
  const deadline = Date.now() + 90_000;
  while (!child.session.snapshotEvents().some(event => event.type === 'turn/end')) {
    if (Date.now() >= deadline) throw new Error('Flash qualification exceeded 90 seconds');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await child.whenIdle();
  writeFileSync(path.join(out, 'child-events.json'), `${JSON.stringify(child.session.snapshotEvents(), null, 2)}\n`);
  const ends = child.session.snapshotEvents().filter(event => event.type === 'turn/end'); assert.equal(ends.length, 1); assert.equal((ends[0]!.data as any).reason?.kind, 'completed');
  const calls = toolCalls(child); assert.equal(calls.length, 2); assert.ok(calls.every(call => call.name === 'hima_delegation_input'));
  const inputs = toolResults(child).map(item => JSON.parse(item.text) as any); assert.equal(inputs.length, 2); assert.equal(inputs.find(item => item.recordId === observations.get('closureState')!.id)?.payload.material.truncated, true);
  const answers = saidByModel(child); assert.equal(answers.length, 1); const raw = answers[0]!;
  if (secret && raw.includes(secret)) throw new Error('candidate contains an API credential'); writeFileSync(path.join(out, 'candidate.json'), `${raw}\n`);
  receipt.native = { provider: child.options.provider, model: child.options.model, maxTokens: 5000, turns: 1, toolCalls: 2, terminalReason: 'completed', candidateSha256: sha256(raw), candidateCharacters: raw.length };
  writeReceipt(); const candidate = candidateOf(raw, researcher.resultSchema.id);
  receipt.candidate = candidate; receipt.verdict = 'PASS'; receipt.finishedAt = now(); writeReceipt(); process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, evidence: out, freshRunId: runId }, null, 2)}\n`);
} catch (error) {
  receipt.verdict = 'FAIL'; receipt.finishedAt = now(); receipt.error = String(error).split(secret ?? '').join(secret ? '[REDACTED]' : ''); writeReceipt(); process.stderr.write(`${JSON.stringify({ verdict: 'FAIL', evidence: out, error: receipt.error }, null, 2)}\n`); process.exitCode = 1;
} finally {
  // Keep this isolated Run, Home and transcript on every outcome, including setup refusal.
  if (host) await host.dispose();
  if (previous.nodeTest === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = previous.nodeTest;
  if (previous.silent === undefined) delete process.env.HIMA_TEST_SILENT_AGENT; else process.env.HIMA_TEST_SILENT_AGENT = previous.silent;
}
