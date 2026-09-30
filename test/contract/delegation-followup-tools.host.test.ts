// @hima-seam agent wrapped
// A finished recipe-budgeted child that receives a follow-up must still be able to use its tools (#64).
//
// Found live (child-compaction.live.test.ts, 2026-09-30): once a continuable child settles, dsh disposes
// it and cold-resumes it for the next message; dsh's durable descriptor deliberately does not restore
// the per-request `maxTokens`, so the resumed Agent's options no longer carry the recorded
// `maxTokensPerTurn`, and Hima's tool guard refused every tool as "changed its token limit". Every
// Pack Agent Team recipe budgets `maxTokensPerTurn`, so every recipe follow-up lost its tools.
// Keyless: dsh's replay adapter answers for the owner and the child.
import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { delegationRuntimePolicy, delegationToolDenial } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { appendReplaySession, writeMomentScenario } from './support/moments.ts';
import { timingProbePackId } from './support/pack.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const text = (value: string) => ({ kind: 'chunks' as const, chunks: [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
] });
const readCall = (file: string) => ({ kind: 'chunks' as const, chunks: [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-followup-read', name: 'read', arguments: JSON.stringify({ file_path: file }) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
] });

test('a finished recipe-budgeted child keeps its tools on a follow-up after dsh cold-resumes it', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  // dsh's replay adapter binds scripts to sessions in the order they first call the model, and a
  // cold-resumed session keeps its id and so its cursor: the child calls first (primary script), and
  // the owner, woken by dsh's settlement notices, takes the next.
  const base = await writeMomentScenario(home.h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  const scope = path.dirname(base.readyFile);
  const granted = path.join(scope, 'granted.txt');
  await writeFile(granted, 'FOLLOWUP_READ_SENTINEL\n');
  await writeFile(base.override, JSON.stringify([text('First result: nothing to change.'), readCall(granted), text('Read the granted file after the follow-up.')]));
  const replay = await appendReplaySession({ ...base, children: [] }, 'owner-wakes', [1, 2, 3, 4].map((n) => text(`Owner notice ${n} acknowledged.`)) as never);
  await writeReplayOverlay(home.h.home, { file: replay.file, overrideFile: replay.override, childFiles: replay.children });
  await appendFile(homePatchFile(home.h.home), QUIET_TITLE_ROW);
  const host = await bootInProcess(home.h);
  const ctx = host.ctx as any;
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(ctx, home.h.home);
    const actor = String(owner.id);
    const started = await ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor, timeBoxMs: 120_000 });
    assert.equal(started.kind, 'ran');
    runId = started.run.id as string;
    const created = await ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'followup-create', expectedEpoch: 1, expectedRevision: 0,
      contract: { delegationId: 'followup-child', role: 'researcher', task: 'Answer; later read the granted file when asked.', inputRefs: [],
        allowedTools: ['read'], readScope: { root: scope },
        // A recipe's per-request budget: the Pack default for Agent Team members.
        budgetShare: { maxElapsedMs: 60_000, maxFollowups: 1, maxTokensPerTurn: 16_000 }, dependencyIds: [],
        recipient: { kind: 'run-owner', sessionId: actor } } });
    assert.equal(created.status, 'created', JSON.stringify(created));
    const childId = created.receipt.childSessionId as string;
    const log = async () => (await ctx.get('sessionQuery').readSession(childId)).events as { seq: number; type: string; data?: any }[];
    await waitUntil('the child finishes its first turn', async () => (await log()).some((e) => e.type === 'turn/end'), 20_000, 50);
    await waitUntil('the finished child settles', () => ctx.get('agents').get(childId)?.status !== 'running', 20_000, 50);

    const control = ctx.hima.executionContext(runId).run.control;
    const follow = await ctx.hima.delegate({ runId, actor, action: 'followup', delegationId: 'followup-child', requestId: 'followup-read',
      text: 'Read the granted file now.', expectedEpoch: control.epoch, expectedRevision: control.revision });
    assert.equal(follow.status, 'accepted', JSON.stringify(follow));
    await waitUntil('the follow-up turn completes', async () => (await log()).filter((e) => e.type === 'turn/end').length >= 2, 20_000, 50);
    const events = await log();
    const firstEnd = events.find((e) => e.type === 'turn/end')!;
    const result = events.find((e) => e.seq > firstEnd.seq && e.type === 'tool/result');
    assert.ok(result, `the follow-up turn called a tool: ${JSON.stringify(events.filter((e) => e.seq > firstEnd.seq).map((e) => [e.type, JSON.stringify(e.data ?? '').slice(0, 160)]))}`);
    const block = result.data.message.content[0];
    const said = block.content.map((b: any) => b.text ?? '').join('');
    t.diagnostic(JSON.stringify({ coldResume: events.some((e) => e.type === 'session/end-seed'), isError: block.isError === true, said: said.slice(0, 200) }));
    assert.notEqual(block.isError, true, `the follow-up read was refused: ${said}`);
    assert.match(said, /FOLLOWUP_READ_SENTINEL/);
    // The re-applied limit is on the wire: the resumed child's request header carries the recorded budget.
    const headers = events.filter((e) => e.seq > firstEnd.seq && e.type === 'request/header');
    assert.ok(headers.length > 0 && headers.every((e) => e.data.header.config.maxTokens === 16_000),
      `resumed requests carry the recorded per-turn limit: ${JSON.stringify(headers.map((e) => e.data.header.config.maxTokens))}`);

    // The guard is not loosened: a genuinely different limit, or no limit on the wire, is still refused.
    const policy = (id: string) => delegationRuntimePolicy(ctx.hima.deps(), id);
    const agentWith = (maxTokens: number | undefined, sent: number | undefined) => ({ id: childId,
      options: { provider: created.effectiveContract.model.provider, model: created.effectiveContract.model.model, ...(maxTokens === undefined ? {} : { maxTokens }) },
      session: { requestHeader: () => (sent === undefined ? { config: {} } : { config: { maxTokens: sent } }) } });
    // The follow-up turn completed, so this Run's policy no longer grants tools at all; judge the token
    // rule on an accepted-state copy of the same effective contract.
    const accepted = (id: string) => { const p = policy(id); return p && { ...p, toolsAllowed: true, writesAllowed: true }; };
    const denyAccepted = (agent: object) => delegationToolDenial(accepted as never, { name: 'read', arguments: { file_path: granted }, agent } as never);
    assert.equal(denyAccepted(agentWith(16_000, 16_000)), undefined);
    assert.equal(denyAccepted(agentWith(undefined, 16_000)), undefined, 'a cold-resumed child whose requests carry the recorded limit is unchanged');
    assert.match(denyAccepted(agentWith(8_000, 8_000)) ?? '', /changed its token limit/);
    assert.match(denyAccepted(agentWith(undefined, undefined)) ?? '', /changed its token limit/);
    assert.match(denyAccepted(agentWith(undefined, 32_000)) ?? '', /changed its token limit/);
  } finally {
    if (runId) await ctx.hima.cancelRun(runId).catch(() => undefined);
    await host.dispose();
    await home.h.dispose();
  }
});
