// @hima-seam agent wrapped
// @hima-seam tools direct
// L4 real-model qualification (#64, spec #66): one delegated child on the product route
// (deepseek-flash) goes through a REAL context compaction and must resume from its checkpoint.
//
// What is real: the in-process Host (dsh-base + the Hima bundle + the profile overlay), the Run and
// its Ledger, Hima's delegation seam (`hima.delegate` create/followup/result), dsh's continuable spawn
// child, `hima_delegation_input`, the `read` tool, dsh-base 0.1.5's token meter, tool-result pruner
// and compaction-basic engine, and the model. No EDA, no Site, no server: the Run is the local
// stand-in and the child's inputs are retained Ledger observations written here.
//
// What is changed, and only in this test's own Home: the compaction-basic row's threshold. The
// production policy is 80 % of the routed model's context window with a 16 % verbatim tail; for
// deepseek-flash (1 000 000 tokens) that is 800 000 / 160 000, which no Operator child has reached
// (T05's largest child request was ~83k tokens). This file writes `$DSH_HOME/cordis.patch.yml` — the
// Home-level patch layer, never the profile or a preset — so the SAME engine and the SAME 80/16 shape
// apply to a simulated window of `SIMULATED_WINDOW` tokens. The pruner keeps its production 8192/
// 4096/1024 budgets, and the summarizer keeps its production maxTokens and model route.
//
// The key: DEEPSEEK_API_KEY from the environment the group is launched with, never printed and never
// written. Without one the test skips with that reason; a skip is not a pass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { retainRunMaterial } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { homePatchFile } from '../../packages/desktop/src/hima-home.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const KEY_VARIABLE = 'DEEPSEEK_API_KEY';
/** The simulated context window; threshold and tail keep production's 0.80 / 0.16 of it. */
const SIMULATED_WINDOW = 11_000;
const PRODUCT_WINDOW = 1_000_000;
const THRESHOLD_RATIO = (0.8 * SIMULATED_WINDOW) / PRODUCT_WINDOW;
const RETAIN_RATIO = (0.16 * SIMULATED_WINDOW) / PRODUCT_WINDOW;
const TURN_TIMEOUT_MS = 10 * 60_000;

type Event = { readonly seq: number; readonly type: string; readonly time?: number; readonly data?: any };

/** Deterministic pseudo-random numbers, so every run's inputs are byte-identical. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** One large read-only input: well over the pruner's 8192 chars, well under the 40 000-byte child view. */
function largeInput(schema: string, seed: number, rows: number, row: (r: () => number, i: number) => object, extra: object = {}): string {
  const r = lcg(seed);
  return JSON.stringify({ schema, ...extra, rows: Array.from({ length: rows }, (_, i) => row(r, i)) });
}

const eventsOf = (agent: any): Event[] => agent.session.snapshotEvents() as Event[];

/** The child's whole log: the live session when resident, else dsh's persisted log (a dormant child). */
async function logOf(ctx: any, id: string): Promise<{ live: any; events: Event[] }> {
  const live = ctx.get('agents').get(id);
  if (live) return { live, events: eventsOf(live) };
  return { live: undefined, events: (await ctx.get('sessionQuery').readSession(id)).events as Event[] };
}

async function waitForTurnEnds(ctx: any, id: string, count: number, what: string): Promise<void> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  for (;;) {
    const { live, events } = await logOf(ctx, id);
    const ends = events.filter((e) => e.type === 'turn/end').length;
    if (ends >= count && (live === undefined || live.status === 'idle')) return;
    if (Date.now() > deadline) throw new Error(`${what}: no completed turn ${count} within ${TURN_TIMEOUT_MS} ms`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function usageOf(events: readonly Event[]): Record<string, number> {
  const sum: Record<string, number> = { requests: 0 };
  let requests = 0;
  for (const event of events) {
    const usage = event.data?.usage;
    if ((event.type !== 'assistant/message' && event.type !== 'compaction/summary') || !usage) continue;
    requests += 1; sum.requests = requests;
    for (const [k, v] of Object.entries(usage)) if (typeof v === 'number') sum[k] = (sum[k] ?? 0) + v;
  }
  return sum;
}

const textOf = (message: any): string => (message?.content ?? [])
  .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');

/** Locate a persisted dsh session log by its id under the Home's session store. */
async function sessionDir(root: string, id: string): Promise<string | undefined> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const at = path.join(root, entry.name);
    if (entry.name === id) return at;
    const nested = await sessionDir(at, id);
    if (nested) return nested;
  }
  return undefined;
}

test('a delegated child survives a real compaction on the product route and resumes from its checkpoint', { timeout: 30 * 60_000 }, async (t) => {
  const key = process.env[KEY_VARIABLE];
  if (key === undefined || key.trim() === '') {
    t.skip(`no ${KEY_VARIABLE} in the launching environment: this L4 qualification needs the owner's DeepSeek key and was not run`);
    return;
  }
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home, 'the local stand-in home is required');
  // The isolated low-threshold fixture: this Home's own patch layer, nothing shipped.
  await appendFile(homePatchFile(home.h.home), [
    '# child-compaction.live.test.ts: production 0.80/0.16 shape over a simulated window, this Home only.',
    '- id: compaction-basic',
    '  config:',
    `    thresholdRatio: ${THRESHOLD_RATIO}`,
    `    retainRatio: ${RETAIN_RATIO}`,
    QUIET_TITLE_ROW,
  ].join('\n'));
  const host = await bootInProcess(home.h);
  const ctx = host.ctx as any;
  let runId: string | undefined;
  let releaseGuard: (() => void) | undefined;
  const started = Date.now();
  const evidence: Record<string, unknown> = {
    simulatedWindow: SIMULATED_WINDOW, thresholdRatio: THRESHOLD_RATIO, retainRatio: RETAIN_RATIO,
    pruner: { thresholdChars: 8192, headChars: 4096, tailChars: 1024, source: 'dsh-base 0.1.5 row, unchanged' },
  };
  try {
    const selection = ctx.get('agentDefaultModel').currentSelection();
    assert.equal(selection.model, 'deepseek-flash', 'the product route is deepseek-flash');
    const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model);
    assert.equal(info.context.contextWindow, PRODUCT_WINDOW, 'the ratios are scaled against the routed window');
    evidence.route = selection;
    evidence.thresholdTokens = Math.floor(PRODUCT_WINDOW * THRESHOLD_RATIO);
    evidence.retainTokens = Math.floor(PRODUCT_WINDOW * RETAIN_RATIO);

    const owner = await createRootAgent(ctx, home.h.workspace);
    const actor = String(owner.id);
    // The owner is identity only: dsh wakes a parent with a settlement notice, and that turn must
    // not act. Every tool call it makes is refused; its model usage is still counted below.
    releaseGuard = ctx.tools.guard((execution: any) => (String(execution.agent?.id) === actor
      ? 'the Run owner is identity only in this qualification' : undefined));
    const run = await ctx.hima.startRun({
      pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor, timeBoxMs: 40 * 60_000,
    });
    assert.equal(run.kind, 'ran');
    runId = run.run.id as string;

    // ---- The facts, where an Operator keeps them: the Ledger and private operating files. ----
    const TASK = 'atcs-qual-operator-w03-g2';
    const SLOT = 'w03';
    const plan = JSON.stringify({ schema: 'atcs-plan/1', generation: 2, seats: ['w01', 'w02', SLOT], seed: 90417 });
    const PLAN_SHA = sha256(plan);
    const reader = { id: 'qualification-fixture', version: '1', reportKind: 'atcs-qualification/1', emits: ['xtop_hold_wns'] };
    const observe = async (file: string, text: string, value: number) => {
      const digest = sha256(text);
      const retainedPath = await retainRunMaterial({ ledger: ctx.hima.ledger, packsDir: path.join(home.h.home, 'hima/packs') }, runId!, Buffer.from(text), digest);
      assert.ok(retainedPath);
      return ctx.hima.ledger.appendObservation(runId!, { path: file, contentSha256: digest, retainedPath, bytes: Buffer.byteLength(text),
        reader, values: [{ type: 'xtop_hold_wns', unit: 'ns', value }] });
    };
    const inst = (r: () => number, i: number) => `u_core/u_blk${String(i % 17).padStart(2, '0')}/g${Math.floor(r() * 90000)}`;
    const requestText = largeInput('atcs-worker-request/1', 11, 150, (r, i) => ({ endpoint: `${inst(r, i)}/D`,
      slackNs: -Math.round(r() * 90) / 1000, mode: i % 3 === 0 ? 'hold' : 'setup', cell: `DFFR_X${1 + (i % 4)}` }),
    { slot: SLOT, taskIdentity: TASK, planSha256: PLAN_SHA, command: 'eco_resize_cells', maxMutations: 40 });
    const inputs = {
      timing: largeInput('pt-timing-summary/1', 23, 170, (r, i) => ({ path: `${inst(r, i)}/Q->${inst(r, i + 1)}/D`, corner: i % 2 ? 'ss0p72v125c' : 'ff0p88vm40c', slackNs: Math.round((r() - 0.7) * 400) / 1000, skewNs: Math.round(r() * 60) / 1000 })),
      library: largeInput('lib-cells/1', 37, 170, (r, i) => ({ cell: `BUF_X${1 + (i % 8)}_${i}`, areaUm2: Math.round(r() * 5000) / 1000, delayPs: Math.round(r() * 900) / 10, leakageNw: Math.round(r() * 400) / 10 })),
      domain: largeInput('edit-domain/1', 41, 170, (r, i) => ({ region: `R${i % 9}`, instance: inst(r, i), fanout: 1 + Math.floor(r() * 12), locked: r() < 0.1 })),
      history: largeInput('ops-history/1', 53, 170, (r, i) => ({ op: i % 2 ? 'resize' : 'insert_buffer', instance: inst(r, i), gainPs: Math.round((r() - 0.3) * 300) / 10, undone: r() < 0.05 })),
    };
    for (const [name, text] of Object.entries({ request: requestText, ...inputs })) {
      assert.ok(text.length > 8192 && Buffer.byteLength(text) < 30_000, `${name} input is ${text.length} chars`);
      if (name !== 'request') for (const identity of [TASK, SLOT, PLAN_SHA]) assert.ok(!text.includes(identity), `${name} carries no identity`);
    }
    const request = await observe('flow/state/worker-request-w03.json', requestText, -0.071);
    const reads: Record<string, any> = {};
    for (const [name, text] of Object.entries(inputs)) reads[name] = await observe(`flow/state/${name}.json`, text, -0.05);
    const REQUEST_ID = request.id as string;
    const opsDir = path.join(home.h.workspace, 'operator-w03');
    await mkdir(opsDir, { recursive: true });
    const REGION = 'core_R7_north';
    await writeFile(path.join(opsDir, 'ops.jsonl'), '');
    await writeFile(path.join(opsDir, 'reads.jsonl'), '');
    await writeFile(path.join(opsDir, 'gain.json'), `${JSON.stringify({ measuredGainPs: 0, basis: 'none yet' })}\n`);
    await writeFile(path.join(opsDir, 'domain.json'), `${JSON.stringify({ region: REGION, fanoutMax: 12, locked: false })}\n`);

    // ---- One bounded operating policy: identities plus where the facts live, never an inventory. ----
    const order = [REQUEST_ID, reads.timing.id, reads.library.id, reads.domain.id, reads.history.id];
    const policy = [
      'Bounded operating policy for this Operator child (qualification run; no EDA tool is available).',
      'Stable identities — keep them exactly, they are needed later:',
      `- task identity: ${TASK}`,
      `- slot: ${SLOT}`,
      `- request record id (inputRef): ${REQUEST_ID}`,
      `- plan hash (planSha256): ${PLAN_SHA}`,
      'Where the facts live (do not copy them into the conversation):',
      `- the authoritative request is Ledger record ${REQUEST_ID}; read it on demand with hima_delegation_input;`,
      `- operating files live in ${opsDir}: ops.jsonl (actions), reads.jsonl (reads), gain.json (measured gain), domain.json (edit domain).`,
      `Phase 1 (this turn): call hima_delegation_input once for each of these records, one call per step, in this order: ${order.join(', ')}.`,
      'Do not summarize or restate their contents. After the last read, reply with exactly: PHASE1-DONE',
      'Later phases arrive as follow-up messages.',
    ].join('\n');
    const created = await ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'qual-create', expectedEpoch: 1, expectedRevision: 0,
      contract: { delegationId: 'qual-operator-w03', role: 'researcher', task: policy, inputRefs: order,
        allowedTools: ['hima_delegation_input', 'read'], readScope: { root: opsDir },
        budgetShare: { maxElapsedMs: 25 * 60_000, maxFollowups: 1, maxTokensPerTurn: 16_384 }, dependencyIds: [],
        recipient: { kind: 'run-owner', sessionId: actor } } }, AbortSignal.timeout(60_000));
    assert.equal(created.status, 'created', JSON.stringify(created));
    const CHILD = created.receipt.childSessionId as string;
    evidence.identities = { task: TASK, slot: SLOT, requestRecordId: REQUEST_ID, planSha256: PLAN_SHA, childSessionId: CHILD, ownerSessionId: actor, runId };

    // ---- Phase 1: large reads; the automatic pressure path must prune and compact. ----
    await waitForTurnEnds(ctx, CHILD, 1, 'phase 1');
    const phase1 = await logOf(ctx, CHILD);
    const afterPhase1 = phase1.events;
    const turn1End = afterPhase1.filter((e) => e.type === 'turn/end').at(-1)!;
    const taskMessage = afterPhase1.find((e) => e.type === 'user/message' && textOf(e.data).includes(PLAN_SHA));
    assert.ok(taskMessage, 'the delegated task message is in the child log');
    const starts = afterPhase1.filter((e) => e.type === 'compaction/start');
    const summaries = afterPhase1.filter((e) => e.type === 'compaction/summary');
    const ends = afterPhase1.filter((e) => e.type === 'compaction/end');
    const prunes = afterPhase1.filter((e) => e.type === 'compaction/prune');
    evidence.phase1 = { turnEnd: turn1End.data, starts: starts.length, summaries: summaries.length, ends: ends.length, prunes: prunes.length,
      wallMs: Date.now() - started };
    assert.ok(starts.length >= 1, `a real compaction started: ${JSON.stringify(evidence.phase1)}`);
    assert.ok(prunes.length >= 1, 'oversized tool results were pruned under pressure');
    for (const s of starts) {
      const id = s.data.compactionId;
      const summary = summaries.find((e) => e.data.compactionId === id);
      const end = ends.find((e) => e.data.compactionId === id);
      assert.ok(summary && end && s.seq < summary.seq && summary.seq < end.seq, `compaction ${id} is a closed start/summary/end sequence`);
      assert.equal(end.data.error, undefined, `compaction ${id} ended without error`);
    }
    const first = summaries[0]!;
    assert.ok(first.data.shadowedSeqs.includes(taskMessage.seq), 'the first compaction shadowed the original task message');
    const replaced = afterPhase1.find((e) => e.type === 'user/message' && e.seq > first.seq);
    evidence.checkpointMessageSeq = replaced?.seq;
    if (phase1.live) assert.ok(!phase1.live.session.surface.nodes.includes(taskMessage.seq), 'the task message left the model-visible surface');
    // Raw recoverability: every shadowed or pruned original is still in the append-only log, whole.
    for (const e of [...summaries, ...prunes]) for (const seq of e.data.shadowedSeqs) assert.ok(afterPhase1.some((o) => o.seq === seq), `original seq ${seq} is recoverable`);
    const originalResults = afterPhase1.filter((e) => e.type === 'tool/result' && JSON.stringify(e.data).length > 8192);
    assert.ok(originalResults.length >= 1, 'the unpruned tool-result originals remain in the log');
    evidence.compactions = summaries.map((e) => ({ compactionId: e.data.compactionId, seq: e.seq, shadowedRange: e.data.shadowedRange,
      shadowedSeqs: e.data.shadowedSeqs.length, shadowedTokenCount: e.data.shadowedTokenCount, provider: e.data.provider, model: e.data.model,
      maxTokens: e.data.maxTokens, usage: e.data.usage, summary: e.data.summary.map((b: any) => b.text ?? '').join('') }));
    evidence.prunes = prunes.map((e) => ({ seq: e.seq, shadowedSeqs: e.data.shadowedSeqs, shadowedTokenCount: e.data.shadowedTokenCount }));
    const checkpointText = evidence.compactions as { summary: string }[];
    evidence.checkpointCarries = Object.fromEntries(Object.entries({ task: TASK, slot: SLOT, request: REQUEST_ID, plan: PLAN_SHA, opsDir })
      .map(([k, v]) => [k, checkpointText.some((c) => c.summary.includes(v))]));

    // ---- Phase 2: the same child, resumed from its checkpoint. ----
    const control = ctx.hima.executionContext(runId).run.control;
    const followup = await ctx.hima.delegate({ runId, actor, action: 'followup', delegationId: 'qual-operator-w03', requestId: 'qual-phase2',
      expectedEpoch: control.epoch, expectedRevision: control.revision, text: [
        'Phase 2.',
        'Step 1 — before calling any tool, write exactly one line in this form, filled only from what your context already holds:',
        'RESTATE task=<task identity> slot=<slot> request=<request record id> plan=<plan hash>',
        'Step 2 — fetch the authoritative request record again with hima_delegation_input.',
        'Step 3 — read domain.json from your operating directory with the read tool (read-only).',
        'Step 4 — finish with one JSON object and nothing after it: {"task":…,"slot":…,"request":…,"plan":…,"requestSchema":<schema field of the request you fetched>,"domainRegion":<region field of domain.json>}',
      ].join('\n') }, AbortSignal.timeout(60_000));
    assert.equal(followup.status, 'accepted', JSON.stringify(followup));
    await waitForTurnEnds(ctx, CHILD, 2, 'phase 2');
    const phase2 = await logOf(ctx, CHILD);
    const all = phase2.events;
    evidence.phase2Source = phase2.live ? 'live session' : 'persisted session (dormant child)';
    for (const e of afterPhase1) assert.ok(all.some((o) => o.seq === e.seq && o.type === e.type), 'phase 2 continued the same session log');
    const turn2 = all.filter((e) => e.seq > turn1End.seq);
    const assistant2 = turn2.filter((e) => e.type === 'assistant/message');
    const restated = assistant2.find((e) => /RESTATE\s/.test(textOf(e.data.message)));
    assert.ok(restated, `the child restated its identities: ${assistant2.map((e) => textOf(e.data.message)).join(' | ')}`);
    const firstCall = turn2.find((e) => e.type === 'tool/call');
    assert.ok(!firstCall || firstCall.seq > restated.seq, 'the restatement came from context, before any tool call');
    const line = textOf(restated.data.message).replace(/[`*<>]/g, '').match(/RESTATE\s+task=(\S+)\s+slot=(\S+)\s+request=(\S+)\s+plan=(\S+)/);
    assert.ok(line, 'the RESTATE line has the four fields');
    const said = { task: line[1], slot: line[2], request: line[3], plan: line[4] };
    const wanted = { task: TASK, slot: SLOT, request: REQUEST_ID, plan: PLAN_SHA };
    evidence.restated = { said, correct: Object.fromEntries(Object.entries(wanted).map(([k, v]) => [k, (said as any)[k] === v])) };
    assert.deepEqual(said, wanted, 'every identity was restated exactly');

    const calls = turn2.filter((e) => e.type === 'tool/call');
    const results = turn2.filter((e) => e.type === 'tool/result');
    const resultOf = (call: Event) => results.find((r) => r.data.message.content[0].toolCallId === call.data.callId);
    const fetch = calls.find((c) => c.data.name === 'hima_delegation_input' && JSON.parse(c.data.arguments).recordId === REQUEST_ID);
    assert.ok(fetch, `the child fetched the exact request ${REQUEST_ID}: ${calls.map((c) => `${c.data.name} ${c.data.arguments}`).join(' | ')}`);
    const fetched = resultOf(fetch);
    assert.ok(fetched && fetched.data.message.content[0].isError !== true, 'the request fetch succeeded');
    assert.ok(JSON.stringify(fetched.data).includes(sha256(requestText)), 'the fetch returned the exact retained request');
    const readCall = calls.find((c) => c.data.name === 'read' && String(JSON.parse(c.data.arguments).file_path ?? '').endsWith('domain.json'));
    assert.ok(readCall, 'the child issued one safe read action');
    const readResult = resultOf(readCall);
    assert.ok(readResult && readResult.data.message.content[0].isError !== true, 'the read succeeded');
    const final = textOf(assistant2.at(-1)!.data.message);
    const json = JSON.parse(final.slice(final.indexOf('{'), final.lastIndexOf('}') + 1));
    evidence.final = json;
    assert.deepEqual({ task: json.task, slot: json.slot, request: json.request, plan: json.plan }, wanted, 'the final answer keeps the identities');
    assert.equal(json.requestSchema, 'atcs-worker-request/1');
    assert.equal(json.domainRegion, REGION);

    // The child's turn becomes a durable Ledger handoff through the same seam an owner uses.
    const latest = ctx.hima.executionContext(runId).run.control;
    const result = await ctx.hima.delegate({ runId, actor, action: 'result', delegationId: 'qual-operator-w03', requestId: 'qual-result',
      expectedEpoch: latest.epoch, expectedRevision: latest.revision });
    evidence.ledgerResult = { status: result.status, source: result.source, completedTurn: result.completedTurn };
    assert.equal(result.status, 'candidate', JSON.stringify(result).slice(0, 400));

    // ---- Cost, and the durable raw events. ----
    evidence.wallMs = Date.now() - started;
    evidence.usage = { child: usageOf(all), owner: usageOf(eventsOf(owner)) };
    const sessions = ctx.get('sessions');
    const resident = ctx.get('agents').get(CHILD);
    if (resident) await sessions?.flush?.(resident.session);
    const persisted = await ctx.get('sessionQuery').readSession(CHILD);
    const persistedTypes = persisted.events.map((e: Event) => e.type);
    assert.ok(['compaction/start', 'compaction/summary', 'compaction/end', 'compaction/prune'].every((type) => persistedTypes.includes(type)),
      'the persisted session log carries the compaction lifecycle');
    for (const seq of first.data.shadowedSeqs) assert.ok(persisted.events.some((e: Event) => e.seq === seq), `persisted original ${seq}`);
    const store = await sessionDir(path.join(home.h.home, 'sessions'), CHILD);
    evidence.rawEventSources = {
      dshSessionStore: store ? path.relative(home.h.home, store) : 'not found',
      sessionQuery: `readSession(${CHILD}): ${persisted.events.length} events`,
      ledger: `run ${runId}: ${ctx.hima.ledger.records({ runId }).length} records (observations carry contentSha256 + retainedPath)`,
    };
    t.diagnostic(JSON.stringify({ restated: evidence.restated, usage: evidence.usage, wallMs: evidence.wallMs, compactions: summaries.length, prunes: prunes.length }));

    const out = process.env.HIMA_LIVE_EVIDENCE_DIR;
    if (out) {
      await mkdir(path.join(out, 'inputs'), { recursive: true });
      const scrub = (text: string) => text.split(key).join('[REDACTED]');
      await writeFile(path.join(out, 'child-events.jsonl'), scrub(all.map((e) => JSON.stringify(e)).join('\n') + '\n'));
      await writeFile(path.join(out, 'child-persisted-readSession.json'), scrub(JSON.stringify(persisted, null, 1)));
      await writeFile(path.join(out, 'owner-events.jsonl'), scrub(eventsOf(owner).map((e) => JSON.stringify(e)).join('\n') + '\n'));
      await writeFile(path.join(out, 'ledger-records.json'), scrub(JSON.stringify(ctx.hima.ledger.records({ runId }), null, 1)));
      for (const [name, text] of Object.entries({ request: requestText, ...inputs, plan })) await writeFile(path.join(out, 'inputs', `${name}.json`), text);
      if (store) {
        await mkdir(path.join(out, 'dsh-session-store'), { recursive: true });
        for (const file of await readdir(store)) if ((await stat(path.join(store, file))).isFile()) await copyFile(path.join(store, file), path.join(out, 'dsh-session-store', file));
      }
      await writeFile(path.join(out, 'summary.json'), scrub(JSON.stringify(evidence, null, 1)));
    }
  } finally {
    const out = process.env.HIMA_LIVE_EVIDENCE_DIR;
    if (out) { await mkdir(out, { recursive: true }); await writeFile(path.join(out, 'summary.partial.json'), JSON.stringify(evidence, null, 1).split(key).join('[REDACTED]')); }
    releaseGuard?.();
    if (runId) await ctx.hima.cancelRun(runId).catch(() => undefined);
    await host.dispose();
    await home.h.dispose();
  }
});
