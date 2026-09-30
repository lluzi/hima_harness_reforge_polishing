// @hima-seam agent wrapped
// @hima-seam tools direct
// L4 real-model qualification (#64, spec #66): an Operator-path child on the product route
// (deepseek-flash), composed as in the App (`agentPreset: standard`), goes through a REAL context
// compaction and must continue from its checkpoint.
//
// What is real: the in-process Host composed WITH the web-app layer (the App's composition: every
// model-facing row, compaction-basic and the tool-result pruner included, lives on the `standard`
// agent preset, not on the host plane), a Run owner created through dsh's session controller with
// the `standard` preset, Hima's Run delegation seam (`hima.delegate` → createDelegation → dsh
// continuable spawn child → `composeFrom` its parent's preset), `hima_delegation_input`, the `read`
// tool, the token meter, pruner and compaction engine of dsh 0.1.5, the model, and the real T05 w03
// worker request (83 034 bytes). No EDA, no Site, no server: the Run is the local stand-in.
//
// What is changed, and only for this process: the `standard` realm's compaction-basic policy object.
// Production is 80 % of the routed window with a 16 % verbatim tail; for deepseek-flash (1 000 000
// tokens) that is 800 000 / 160 000, which no T05 Operator child approached (largest request ~83k).
// The shipped preset cannot be patched (built-in ids win, no patch layer), so the test replaces the
// realm engine's resolved `config` with the SAME 0.80/0.16 shape over a simulated window of
// `SIMULATED_WINDOW` tokens and restores it afterwards. Pruner budgets (8192/4096/1024), the
// summarizer's maxTokens and route are untouched.
//
// The key: DEEPSEEK_API_KEY from the environment the group is launched with, never printed and never
// written. Without one the test skips with that reason; a skip is not a pass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { retainRunMaterial } from '@hima/harness';
import { bootInProcess, createPresetRootAgent } from './support/boot-inprocess.ts';
import { freePort } from './support/boot-host.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { homePatchFile } from '../../packages/desktop/src/hima-home.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const KEY_VARIABLE = 'DEEPSEEK_API_KEY';
const PRESET = 'standard';
/** The simulated context window; threshold and tail keep production's 0.80 / 0.16 of it. */
const SIMULATED_WINDOW = 11_000;
const PRODUCT_WINDOW = 1_000_000;
const THRESHOLD_RATIO = (0.8 * SIMULATED_WINDOW) / PRODUCT_WINDOW;
const RETAIN_RATIO = (0.16 * SIMULATED_WINDOW) / PRODUCT_WINDOW;
/** A Pack Agent Team member's default per-request budget (packs.ts recipe default). */
const RECIPE_MAX_TOKENS_PER_TURN = 16_000;
const TURN_TIMEOUT_MS = 12 * 60_000;
/** The real T05 w03 worker request, byte copy of atcs09/V's live fixture (sha256 a20d1612…). */
const W03_REQUEST = path.join(repoRoot, 'test/fixtures/atcs/t05-worker-request-w03.json');
const W03_SHA256 = 'a20d161297ecd2e587132e47cdd3372943104e629c93fffa34da82e0c48c71f0';

type Event = { readonly seq: number; readonly type: string; readonly time?: number; readonly data?: any };

/** Deterministic pseudo-random numbers, so every run's inputs are byte-identical. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** One large read-only input: well over the pruner's 8192 chars, well under the 40 000-byte child view. */
function largeInput(schema: string, seed: number, rows: number, row: (r: () => number, i: number) => object): string {
  const r = lcg(seed);
  return JSON.stringify({ schema, rows: Array.from({ length: rows }, (_, i) => row(r, i)) });
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
  const sum: Record<string, number> = {};
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

/** Locate a persisted dsh file or directory named `name` under `root`. */
async function findUnder(root: string, name: string): Promise<string | undefined> {
  if (!existsSync(root)) return undefined;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const at = path.join(root, entry.name);
    if (entry.name === name) return at;
    if (entry.isDirectory()) { const nested = await findUnder(at, name); if (nested) return nested; }
  }
  return undefined;
}

test('an Operator-path standard-preset child crosses a real compaction on deepseek-flash and continues from its checkpoint', { timeout: 40 * 60_000 }, async (t) => {
  const key = process.env[KEY_VARIABLE];
  if (key === undefined || key.trim() === '') {
    t.skip(`no ${KEY_VARIABLE} in the launching environment: this L4 qualification needs the owner's DeepSeek key and was not run`);
    return;
  }
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home, 'the local stand-in home is required');
  await appendFile(homePatchFile(home.h.home), QUIET_TITLE_ROW);
  const host = await bootInProcess(home.h, { withWebApp: true, webPort: await freePort() });
  const ctx = host.ctx as any;
  let runId: string | undefined;
  let releaseGuard: (() => void) | undefined;
  let restoreEngine: (() => void) | undefined;
  let childId: string | undefined;
  const started = Date.now();
  const evidence: Record<string, unknown> = {
    composition: 'in-process Host with the web-app layer (the App composition)', preset: PRESET,
    simulatedWindow: SIMULATED_WINDOW, thresholdRatio: THRESHOLD_RATIO, retainRatio: RETAIN_RATIO,
    override: 'standard realm compaction-basic engine.config replaced for this process, restored after',
    pruner: { thresholdChars: 8192, headChars: 4096, tailChars: 1024, source: 'standard preset row, unchanged' },
  };
  const out = process.env.HIMA_LIVE_EVIDENCE_DIR;
  const scrub = (text: string) => text.split(key).join('[REDACTED]');
  try {
    assert.equal(ctx.get('compaction'), undefined, 'the App composition keeps compaction off the host plane');
    const selection = ctx.get('agentDefaultModel').currentSelection();
    assert.equal(selection.model, 'deepseek-flash', 'the product route is deepseek-flash');
    const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model);
    assert.equal(info.context.contextWindow, PRODUCT_WINDOW, 'the ratios are scaled against the routed window');
    evidence.route = selection;
    evidence.thresholdTokens = Math.floor(PRODUCT_WINDOW * THRESHOLD_RATIO);
    evidence.retainTokens = Math.floor(PRODUCT_WINDOW * RETAIN_RATIO);

    const owner = await createPresetRootAgent(ctx, home.h.workspace, PRESET);
    const actor = String(owner.id);
    assert.equal(owner.session.header.agentPreset, PRESET, 'the Run owner is composed from the standard preset');
    // The standard realm's compaction engine, shared by every session composed from it.
    // Preset services sit behind `isolate` realms; dsh's own read path for one agent's instance.
    const presets = ctx.get('agentPresets');
    const serviceOf = (agent: any, name: string) => presets.serviceFor(agent, name);
    const engine = serviceOf(owner, 'compaction');
    assert.ok(engine && typeof engine.compactIfNeeded === 'function', 'the standard preset mounts the compaction engine');
    assert.ok(serviceOf(owner, 'toolResultPruner'), 'the standard preset mounts the tool-result pruner');
    const original = engine.config;
    evidence.productionPolicy = { thresholdRatio: original.thresholdRatio, retainRatio: original.retainRatio, maxTokens: original.maxTokens, auto: original.auto };
    assert.deepEqual([original.thresholdRatio, original.retainRatio, original.auto], [0.8, 0.16, true], 'production policy is 80/16, automatic');
    engine.config = Object.freeze({ ...original, thresholdRatio: THRESHOLD_RATIO, retainRatio: RETAIN_RATIO });
    restoreEngine = () => { engine.config = original; };
    assert.equal(serviceOf(owner, 'compaction').config.thresholdRatio, THRESHOLD_RATIO, 'the realm engine carries the test policy');
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
    const observe = async (file: string, bytes: Buffer, value: number) => {
      const digest = sha256(bytes);
      const retainedPath = await retainRunMaterial({ ledger: ctx.hima.ledger, packsDir: path.join(home.h.home, 'hima/packs') }, runId!, bytes, digest);
      assert.ok(retainedPath);
      return ctx.hima.ledger.appendObservation(runId!, { path: file, contentSha256: digest, retainedPath, bytes: bytes.byteLength,
        reader, values: [{ type: 'xtop_hold_wns', unit: 'ns', value }] });
    };
    const requestBytes = await readFile(W03_REQUEST);
    assert.equal(requestBytes.byteLength, 83_034, 'the real T05 w03 request');
    assert.equal(sha256(requestBytes), W03_SHA256);
    const requestDoc = JSON.parse(requestBytes.toString('utf8'));
    const inst = (r: () => number, i: number) => `u_core/u_blk${String(i % 17).padStart(2, '0')}/g${Math.floor(r() * 90000)}`;
    const inputs = {
      timing: largeInput('pt-timing-summary/1', 23, 170, (r, i) => ({ path: `${inst(r, i)}/Q->${inst(r, i + 1)}/D`, corner: i % 2 ? 'ss0p72v125c' : 'ff0p88vm40c', slackNs: Math.round((r() - 0.7) * 400) / 1000, skewNs: Math.round(r() * 60) / 1000 })),
      library: largeInput('lib-cells/1', 37, 170, (r, i) => ({ cell: `BUF_X${1 + (i % 8)}_${i}`, areaUm2: Math.round(r() * 5000) / 1000, delayPs: Math.round(r() * 900) / 10, leakageNw: Math.round(r() * 400) / 10 })),
      domain: largeInput('edit-domain/1', 41, 170, (r, i) => ({ region: `R${i % 9}`, instance: inst(r, i), fanout: 1 + Math.floor(r() * 12), locked: r() < 0.1 })),
      history: largeInput('ops-history/1', 53, 170, (r, i) => ({ op: i % 2 ? 'resize' : 'insert_buffer', instance: inst(r, i), gainPs: Math.round((r() - 0.3) * 300) / 10, undone: r() < 0.05 })),
    };
    for (const [name, text] of Object.entries(inputs)) {
      assert.ok(text.length > 8192 && Buffer.byteLength(text) < 30_000, `${name} input is ${text.length} chars`);
      for (const identity of [TASK, SLOT, PLAN_SHA]) assert.ok(!text.includes(identity), `${name} carries no identity`);
    }
    const request = await observe('research/requests/worker-request-w03.json', requestBytes, -0.071);
    const reads: Record<string, any> = {};
    for (const [name, text] of Object.entries(inputs)) reads[name] = await observe(`flow/state/${name}.json`, Buffer.from(text), -0.05);
    const REQUEST_ID = request.id as string;
    const opsDir = path.join(home.h.workspace, 'operator-w03');
    await mkdir(opsDir, { recursive: true });
    const REGION = 'core_R7_north';
    await writeFile(path.join(opsDir, 'ops.jsonl'), '');
    await writeFile(path.join(opsDir, 'reads.jsonl'), '');
    await writeFile(path.join(opsDir, 'gain.json'), `${JSON.stringify({ measuredGainPs: 0, basis: 'none yet' })}\n`);
    await writeFile(path.join(opsDir, 'domain.json'), `${JSON.stringify({ region: REGION, fanoutMax: 12, locked: false })}\n`);

    // Does the reader seam take bounded field/offset reads yet (atcs09/V)? Read off the registered schema.
    const inputSchema = ctx.tools.schemas().find((s: any) => s.name === 'hima_delegation_input');
    const boundedReads = JSON.stringify(inputSchema?.parameters ?? {}).includes('"path"');
    evidence.boundedReaderSchema = boundedReads ? 'present' : 'absent (pending atcs09/V)';

    // ---- One bounded operating policy: identities plus where the facts live, never an inventory. ----
    const order = [REQUEST_ID, reads.timing.id, reads.library.id, reads.domain.id, reads.history.id];
    const policy = [
      'Bounded operating policy for this Operator child (qualification run; no EDA tool is available).',
      'Stable identities — keep them exactly, they are needed later:',
      `- task identity: ${TASK}`,
      `- slot: ${SLOT}`,
      `- request record id (requestRef): ${REQUEST_ID}`,
      `- plan hash (planSha256): ${PLAN_SHA}`,
      'Where the facts live (do not copy them into the conversation):',
      `- the authoritative request is Ledger record ${REQUEST_ID}; read it on demand with hima_delegation_input${boundedReads ? ' (it is larger than one read: request one field path at a time)' : ''};`,
      `- operating files live in ${opsDir}: ops.jsonl (actions), reads.jsonl (reads), gain.json (measured gain), domain.json (edit domain).`,
      'Steps, one tool call per step:',
      `1. Call hima_delegation_input once for each of these records, in this order: ${order.join(', ')}. Do not summarize or restate their contents.`,
      '2. Then, before any further tool call, write exactly one line, filled from what your context holds:',
      '   RESTATE task=<task identity> slot=<slot> request=<request record id> plan=<plan hash>',
      boundedReads
        ? '3. Fetch the request again with hima_delegation_input using bounded reads only: path candidate.taskId; then page path candidate.targets with offset/limit (limit 64) until window.next is null; then page path candidate.editDomain.instances the same way. Note contentSha256, the targets total and the instances total.'
        : '3. Fetch the authoritative request again with hima_delegation_input and note its contentSha256.',
      '4. Read domain.json from the operating directory with the read tool (read-only).',
      `5. Finish with one JSON object and nothing after it: {"task":…,"slot":…,"request":…,"plan":…,"requestSha256":<contentSha256 of the request>,${boundedReads ? '"requestTaskId":<candidate.taskId>,"targetsTotal":<number>,"instancesTotal":<number>,' : ''}"domainRegion":<region field of domain.json>}`,
    ].join('\n');
    const created = await ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'qual-create', expectedEpoch: 1, expectedRevision: 0,
      contract: { delegationId: 'qual-operator-w03', role: 'researcher', task: policy, inputRefs: order,
        allowedTools: ['hima_delegation_input', 'read'], readScope: { root: opsDir },
        budgetShare: { maxElapsedMs: 25 * 60_000, maxFollowups: 1, maxTokensPerTurn: RECIPE_MAX_TOKENS_PER_TURN }, dependencyIds: [],
        recipient: { kind: 'run-owner', sessionId: actor } } }, AbortSignal.timeout(60_000));
    assert.equal(created.status, 'created', JSON.stringify(created));
    const CHILD = created.receipt.childSessionId as string;
    childId = CHILD;
    evidence.identities = { task: TASK, slot: SLOT, requestRecordId: REQUEST_ID, planSha256: PLAN_SHA, requestSha256: W03_SHA256,
      childSessionId: CHILD, ownerSessionId: actor, runId };
    const liveChild = ctx.get('agents').get(CHILD);
    assert.ok(liveChild, 'the delegation owns a live native child');
    assert.equal(liveChild.session.header.agentPreset, PRESET, 'the child joined its parent\'s standard preset');
    assert.equal(serviceOf(liveChild, 'compaction')?.config?.thresholdRatio, THRESHOLD_RATIO, 'the child is served by the standard realm\'s (overridden) compaction engine');

    // ---- One turn: large reads, a real compaction, then continuation from the checkpoint. ----
    await waitForTurnEnds(ctx, CHILD, 1, 'the operating turn');
    const turn = await logOf(ctx, CHILD);
    const all = turn.events;
    evidence.turnWallMs = Date.now() - started;
    const turnEnd = all.filter((e) => e.type === 'turn/end').at(0)!;
    evidence.turnEnd = turnEnd.data;
    const taskMessage = all.find((e) => e.type === 'user/message' && textOf(e.data).includes(PLAN_SHA));
    assert.ok(taskMessage, 'the delegated task message is in the child log');
    const starts = all.filter((e) => e.type === 'compaction/start');
    const summaries = all.filter((e) => e.type === 'compaction/summary');
    const ends = all.filter((e) => e.type === 'compaction/end');
    const prunes = all.filter((e) => e.type === 'compaction/prune');
    evidence.counts = { starts: starts.length, summaries: summaries.length, ends: ends.length, prunes: prunes.length };
    assert.ok(starts.length >= 1, `a real compaction started: ${JSON.stringify(evidence.counts)}`);
    // Every attempt is closed. A committed one is start < summary < end with no error; an attempt the
    // engine abandoned (compaction-basic closes it with `error` and the turn continues) has no summary.
    const attempts = starts.map((s) => {
      const id = s.data.compactionId;
      const summary = summaries.find((e) => e.data.compactionId === id);
      const end = ends.find((e) => e.data.compactionId === id);
      assert.ok(end && s.seq < end.seq, `compaction ${id} is closed by its end`);
      if (summary) {
        assert.ok(s.seq < summary.seq && summary.seq < end.seq, `compaction ${id} is a closed start/summary/end sequence`);
        assert.equal(end.data.error, undefined, `committed compaction ${id} ended without error`);
      } else assert.ok(typeof end.data.error === 'string' && end.data.error !== '', `abandoned compaction ${id} records why`);
      return { compactionId: id, startSeq: s.seq, summarySeq: summary?.seq, endSeq: end.seq, committed: summary !== undefined,
        ...(end.data.error === undefined ? {} : { error: end.data.error }) };
    });
    evidence.attempts = attempts;
    const shadowing = summaries.find((e) => e.data.shadowedSeqs.includes(taskMessage.seq));
    assert.ok(shadowing, 'a committed compaction shadowed the original task message');
    evidence.compactions = summaries.map((e) => ({ compactionId: e.data.compactionId, seq: e.seq, shadowedRange: e.data.shadowedRange,
      shadowedSeqs: e.data.shadowedSeqs.length, shadowedTokenCount: e.data.shadowedTokenCount, provider: e.data.provider, model: e.data.model,
      maxTokens: e.data.maxTokens, usage: e.data.usage, summary: e.data.summary.map((b: any) => b.text ?? '').join('') }));
    evidence.prunes = prunes.map((e) => ({ seq: e.seq, shadowedSeqs: e.data.shadowedSeqs, shadowedTokenCount: e.data.shadowedTokenCount }));
    const checkpoints = evidence.compactions as { summary: string }[];
    evidence.checkpointCarries = Object.fromEntries(Object.entries({ task: TASK, slot: SLOT, request: REQUEST_ID, plan: PLAN_SHA, opsDir })
      .map(([k, v]) => [k, checkpoints.some((c) => c.summary.includes(v))]));
    // Raw recoverability: every shadowed or pruned original is still in the append-only log, whole.
    for (const e of [...summaries, ...prunes]) for (const seq of e.data.shadowedSeqs) assert.ok(all.some((o) => o.seq === seq), `original seq ${seq} is recoverable`);
    assert.ok(all.some((e) => e.seq === taskMessage.seq && textOf(e.data).includes(PLAN_SHA)), 'the original task message is recoverable verbatim');
    if (turn.live) assert.ok(!turn.live.session.surface.nodes.includes(taskMessage.seq), 'the task message left the model-visible surface');

    // After the checkpoint: the identities, restated from context before any further tool call.
    const assistant = all.filter((e) => e.type === 'assistant/message');
    const restated = assistant.find((e) => /RESTATE\s/.test(textOf(e.data.message)));
    assert.ok(restated, `the child restated its identities: ${assistant.map((e) => textOf(e.data.message)).filter(Boolean).join(' | ')}`);
    assert.ok(restated.seq > shadowing.seq, 'the restatement came after the checkpoint replaced the task message');
    const surfaceCompactions = summaries.filter((e) => e.seq < restated.seq);
    evidence.compactionsBeforeRestatement = surfaceCompactions.length;
    const line = textOf(restated.data.message).replace(/[`*<>]/g, '').match(/RESTATE\s+task=(\S+)\s+slot=(\S+)\s+request=(\S+)\s+plan=(\S+)/);
    assert.ok(line, 'the RESTATE line has the four fields');
    const said = { task: line[1], slot: line[2], request: line[3], plan: line[4] };
    const wanted = { task: TASK, slot: SLOT, request: REQUEST_ID, plan: PLAN_SHA };
    evidence.restated = { said, correct: Object.fromEntries(Object.entries(wanted).map(([k, v]) => [k, (said as any)[k] === v])) };
    assert.deepEqual(said, wanted, 'every identity was restated exactly');

    const calls = all.filter((e) => e.type === 'tool/call');
    const results = all.filter((e) => e.type === 'tool/result');
    const resultOf = (call: Event) => results.find((r) => r.data.message.content[0].toolCallId === call.data.callId);
    const after = calls.filter((c) => c.seq > restated.seq);
    evidence.callsAfterRestatement = after.map((c) => ({ seq: c.seq, name: c.data.name, arguments: c.data.arguments,
      error: resultOf(c)?.data.message.content[0].isError === true ? textOf({ content: resultOf(c)?.data.message.content[0].content }) : undefined }));
    const fetches = after.filter((c) => c.data.name === 'hima_delegation_input' && JSON.parse(c.data.arguments).recordId === REQUEST_ID);
    assert.ok(fetches.length >= 1, `the child fetched the exact request ${REQUEST_ID} after the checkpoint`);
    for (const f of fetches) {
      const r = resultOf(f);
      assert.ok(r && r.data.message.content[0].isError !== true, `request fetch ${f.data.arguments} succeeded`);
      assert.ok(JSON.stringify(r.data).includes(W03_SHA256), 'the fetch names the exact retained request bytes');
      assert.ok(JSON.stringify(r.data.message).length < 60_000, 'the fetch stayed a bounded view');
    }
    const readCall = after.find((c) => c.data.name === 'read' && String(JSON.parse(c.data.arguments).file_path ?? '').endsWith('domain.json'));
    assert.ok(readCall, 'the child issued one safe read action after the checkpoint');
    const readResult = resultOf(readCall);
    assert.ok(readResult && readResult.data.message.content[0].isError !== true, 'the read succeeded');
    const final = textOf(assistant.at(-1)!.data.message);
    const json = JSON.parse(final.slice(final.indexOf('{'), final.lastIndexOf('}') + 1));
    evidence.final = json;
    assert.deepEqual({ task: json.task, slot: json.slot, request: json.request, plan: json.plan }, wanted, 'the final answer keeps the identities');
    assert.equal(json.requestSha256, W03_SHA256, 'the final answer names the exact request bytes');
    assert.equal(json.domainRegion, REGION);

    await t.test('bounded field reads of the real w03 request through hima_delegation_input', {
      todo: boundedReads ? false : 'pending atcs09/V: hima_delegation_input has no path/offset schema yet; whole-document reads above 40 000 bytes are refused',
    }, () => {
      const args = (c: Event) => JSON.parse(c.data.arguments) as { path?: string; offset?: number; limit?: number };
      const selection = (c: Event) => JSON.parse(textOf({ content: resultOf(c)!.data.message.content[0].content }));
      const bounded = fetches.filter((f) => typeof args(f).path === 'string');
      evidence.boundedReads = bounded.map((f) => ({ ...args(f), window: selection(f).window }));
      const taskIdRead = bounded.find((f) => ['candidate.taskId', '/candidate/taskId'].includes(args(f).path!));
      assert.ok(taskIdRead, 'the child read candidate.taskId by path');
      assert.equal(selection(taskIdRead).value, requestDoc.candidate.taskId);
      for (const [field, total] of [['targets', requestDoc.candidate.targets.length], ['editDomain.instances', requestDoc.candidate.editDomain.instances.length]] as const) {
        const pages = bounded.filter((f) => [`candidate.${field}`, `/candidate/${field.replace('.', '/')}`].includes(args(f).path!));
        assert.ok(pages.length >= 1, `the child paged candidate.${field}`);
        for (const page of pages) {
          const answer = selection(page);
          assert.equal(answer.kind, 'selection');
          assert.equal(answer.contentSha256, W03_SHA256);
          assert.ok(JSON.stringify(answer).length <= 40_000, 'every page stays one bounded view');
        }
        const covered = new Set(pages.flatMap((f) => { const w = selection(f).window; return Array.from({ length: w.returned }, (_, i) => w.offset + i); }));
        assert.equal(covered.size, total, `the pages of candidate.${field} cover all ${total} items`);
      }
      assert.equal(json.requestTaskId, requestDoc.candidate.taskId);
      assert.equal(json.targetsTotal, requestDoc.candidate.targets.length);
      assert.equal(json.instancesTotal, requestDoc.candidate.editDomain.instances.length);
    });

    // The child's turn becomes a durable Ledger handoff through the same seam an owner uses.
    const latest = ctx.hima.executionContext(runId).run.control;
    const result = await ctx.hima.delegate({ runId, actor, action: 'result', delegationId: 'qual-operator-w03', requestId: 'qual-result',
      expectedEpoch: latest.epoch, expectedRevision: latest.revision });
    evidence.ledgerResult = { status: result.status, source: result.source, completedTurn: result.completedTurn };
    assert.equal(result.status, 'candidate', JSON.stringify(result).slice(0, 400));

    // ---- The retained projection and the raw events, as the App keeps them. ----
    const resident = ctx.get('agents').get(CHILD);
    if (resident) await ctx.get('sessions')?.flush?.(resident.session);
    const persisted = await ctx.get('sessionQuery').readSession(CHILD);
    assert.equal(persisted.session.agentPreset, PRESET, 'the retained session header records agentPreset=standard');
    const persistedTypes = persisted.events.map((e: Event) => e.type);
    for (const type of ['compaction/start', 'compaction/summary', 'compaction/end']) assert.ok(persistedTypes.includes(type), `persisted ${type}`);
    for (const seq of shadowing.data.shadowedSeqs) assert.ok(persisted.events.some((e: Event) => e.seq === seq), `persisted original ${seq}`);
    const projection = await findUnder(path.join(home.h.home, 'storages'), `${CHILD}.json`);
    if (projection) {
      // dsh's session projection cache: `record.rows.agentPreset = { ver, seq, val }` (as in T05's retained Home).
      const projected = JSON.parse(await readFile(projection, 'utf8'));
      const recorded = projected?.record?.rows?.agentPreset?.val;
      evidence.projection = { file: path.relative(home.h.home, projection), agentPreset: recorded };
      assert.equal(recorded, PRESET, 'the retained session projection records agentPreset=standard');
    }
    const store = await findUnder(path.join(home.h.home, 'sessions'), CHILD);
    evidence.rawEventSources = {
      dshSessionStore: store ? path.relative(home.h.home, store) : 'not found',
      sessionQuery: `readSession(${CHILD}): ${persisted.events.length} events`,
      ledger: `run ${runId}: ${ctx.hima.ledger.records({ runId }).length} records (observations carry contentSha256 + retainedPath)`,
    };

    // ---- Non-blocking: the recipe follow-up path on the same child (cold resume). ----
    const control = ctx.hima.executionContext(runId).run.control;
    const followup = await ctx.hima.delegate({ runId, actor, action: 'followup', delegationId: 'qual-operator-w03', requestId: 'qual-followup',
      expectedEpoch: control.epoch, expectedRevision: control.revision,
      text: 'Follow-up: read gain.json from your operating directory with the read tool, then reply with exactly GAIN=<measuredGainPs>.' }, AbortSignal.timeout(60_000));
    evidence.followup = { status: followup.status };
    if (followup.status === 'accepted') {
      await waitForTurnEnds(ctx, CHILD, 2, 'follow-up');
      const next = (await logOf(ctx, CHILD)).events.filter((e) => e.seq > turnEnd.seq);
      const readGain = next.find((e) => e.type === 'tool/call' && e.data.name === 'read');
      const gainResult = readGain && next.find((e) => e.type === 'tool/result' && e.data.message.content[0].toolCallId === readGain.data.callId);
      const refused = gainResult?.data.message.content[0].isError === true ? textOf({ content: gainResult.data.message.content[0].content }) : undefined;
      evidence.followup = { status: followup.status, coldResume: next.some((e) => e.type === 'session/end-seed'), readIssued: !!readGain, refused,
        reply: textOf(next.filter((e) => e.type === 'assistant/message').at(-1)?.data.message) };
      await t.test('recipe follow-up on the cold-resumed child keeps its tools', {
        todo: 'known defect: dsh cold resume drops maxTokens by design; Hima\'s tool guard then refuses every tool as "changed its token limit"',
      }, () => { assert.ok(readGain && !refused, `follow-up read refused: ${refused}`); });
    }

    evidence.wallMs = Date.now() - started;
    const finalEvents = (await logOf(ctx, CHILD)).events;
    evidence.usage = { child: usageOf(finalEvents), owner: usageOf(eventsOf(owner)) };
    t.diagnostic(JSON.stringify({ restated: evidence.restated, counts: evidence.counts, usage: evidence.usage, wallMs: evidence.wallMs, followup: evidence.followup }));

    if (out) {
      await mkdir(path.join(out, 'inputs'), { recursive: true });
      await writeFile(path.join(out, 'child-events.jsonl'), scrub(finalEvents.map((e) => JSON.stringify(e)).join('\n') + '\n'));
      await writeFile(path.join(out, 'child-persisted-readSession.json'), scrub(JSON.stringify(await ctx.get('sessionQuery').readSession(CHILD), null, 1)));
      await writeFile(path.join(out, 'owner-events.jsonl'), scrub(eventsOf(owner).map((e) => JSON.stringify(e)).join('\n') + '\n'));
      await writeFile(path.join(out, 'ledger-records.json'), scrub(JSON.stringify(ctx.hima.ledger.records({ runId }), null, 1)));
      await copyFile(W03_REQUEST, path.join(out, 'inputs', 'worker-request-w03.json'));
      for (const [name, text] of Object.entries({ ...inputs, plan })) await writeFile(path.join(out, 'inputs', `${name}.json`), text);
      if (store) {
        await mkdir(path.join(out, 'dsh-session-store'), { recursive: true });
        for (const file of await readdir(store)) if ((await stat(path.join(store, file))).isFile()) await copyFile(path.join(store, file), path.join(out, 'dsh-session-store', file));
      }
      if (projection) await copyFile(projection, path.join(out, 'session-projection.json'));
      await writeFile(path.join(out, 'summary.json'), scrub(JSON.stringify(evidence, null, 1)));
    }
  } finally {
    if (out) {
      // Whatever happened, keep the raw logs: a failed qualification needs them most.
      await mkdir(out, { recursive: true });
      await writeFile(path.join(out, 'summary.partial.json'), scrub(JSON.stringify(evidence, null, 1)));
      if (childId) {
        const log = await logOf(ctx, childId).catch(() => undefined);
        if (log) await writeFile(path.join(out, 'child-events.final.jsonl'), scrub(log.events.map((e) => JSON.stringify(e)).join('\n') + '\n'));
      }
      if (runId) await writeFile(path.join(out, 'ledger-records.final.json'), scrub(JSON.stringify(ctx.hima.ledger.records({ runId }), null, 1)));
    }
    restoreEngine?.();
    releaseGuard?.();
    if (runId) await ctx.hima.cancelRun(runId).catch(() => undefined);
    await host.dispose();
    await home.h.dispose();
  }
});
