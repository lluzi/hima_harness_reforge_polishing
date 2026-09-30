// #64 T05 w03 (ATCS-09 V): a delegated child reads a large exact input in bounded windows.
//
// T05's slot w03 request, the Reader observation its Operator works from, is 83 034 bytes. The Host's
// hima_delegation_input view is bounded at 40 000 bytes, and a whole read of a larger JSON document
// delivers only the Reader's typed values. The same tool now takes a selection: `path` (a dotted field
// path, or a JSON pointer, into the record's JSON document), and `offset`/`limit` (items of an array,
// entries of an object, characters of a string). Each answer is one bounded envelope under the same
// record identity, content hash and grant checks, stating the path and the window it returned.
// The fixture is the real T05 w03 request (copied read-only from the Site's T05 workspace).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { retainRunMaterial } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const W03 = path.join(repoRoot, 'packs/agentic-timing-closure-system/flow/tests/live_fixtures/t05-worker-request-w03.json');
const VIEW_LIMIT = 40_000;

test('a large exact input is read through bounded path/offset/limit selections; a whole read, a missing path and changed bytes are refused', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.home);
    const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 },
      ownerSessionId: actor, timeBoxMs: 3_600_000 });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return;
    runId = started.run.id;

    const bytes = await readFile(W03);
    assert.ok(bytes.byteLength >= 83_034, `the fixture is T05 w03's size: ${bytes.byteLength}`);
    const request = JSON.parse(bytes.toString('utf8'));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const packsDir = path.join(home.h.home, 'hima/packs');
    const retainedPath = await retainRunMaterial({ ledger: host.ctx.hima.ledger, packsDir }, runId, bytes, digest);
    assert.ok(retainedPath);
    const reader = { id: 'atcs-worker-request-03', version: '1', reportKind: 'worker-request', emits: ['tc_request_invalid_count'] };
    const values = [{ type: 'tc_request_invalid_count', unit: 'count', value: 0 }];
    const observation = await host.ctx.hima.ledger.appendObservation(runId, { path: 'research/requests/worker-request-w03.json',
      contentSha256: digest, retainedPath, bytes: bytes.byteLength, reader, values });
    const child = await host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: 'bounded-input-child',
      expectedEpoch: 1, expectedRevision: 0, contract: {
        delegationId: 'bounded-input-child', role: 'researcher', task: 'Read the exact worker request in bounded windows.',
        inputRefs: [observation.id], allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 300_000, maxFollowups: 0 },
        dependencyIds: [], recipient: { kind: 'run-owner', sessionId: actor } } }) as any;
    assert.equal(child.status, 'created', JSON.stringify(child));
    const agent = host.ctx.get('agents')?.get(child.receipt.childSessionId as never);
    assert.ok(agent);
    let call = 0;
    // The registered native tool takes the new arguments (its first call, below); the child's session
    // then ends its (model-less) turn, so the remaining reads call the same Host operation the tool calls.
    const viaTool = async (args: Record<string, unknown>) => {
      const result = await host.ctx.tools.execute({ callId: `bounded-${++call}` as never, name: 'hima_delegation_input',
        arguments: { runId, recordId: observation.id, ...args }, agent, signal: AbortSignal.timeout(30_000) });
      return { isError: result.isError === true, text: result.content.filter((block) => block.type === 'text').map((block) => block.text).join('') };
    };
    const read = async (args: Record<string, unknown>) => {
      let answer: { isError: boolean; text: string };
      if (call === 0) answer = await viaTool(args);
      else {
        call++;
        try { answer = { isError: false, text: JSON.stringify(await host.ctx.hima.delegationInput(child.receipt.childSessionId, { runId: runId!, recordId: observation.id, ...args } as never)) }; }
        catch (error) { answer = { isError: true, text: String((error as Error).message) }; }
      }
      if (!answer.isError) assert.ok(Buffer.byteLength(answer.text) <= VIEW_LIMIT, `one bounded envelope: ${Buffer.byteLength(answer.text)} bytes`);
      return { ...answer, value: answer.isError ? undefined : JSON.parse(answer.text) as any };
    };
    /** Every item (or character) of one selection, paged by the window each answer states. */
    const all = async (selection: string, limit?: number) => {
      const items: unknown[] = []; let text = ''; let offset = 0;
      for (let page = 0; page < 100; page++) {
        const answer = await read({ path: selection, offset, ...(limit === undefined ? {} : { limit }) });
        assert.equal(answer.isError, false, answer.text.slice(0, 400));
        const envelope = answer.value;
        assert.equal(envelope.kind, 'selection');
        assert.equal(envelope.recordId, observation.id);
        assert.equal(envelope.contentSha256, digest, 'the plan hash the Host binds is the content hash every answer states');
        assert.equal(envelope.path, selection);
        assert.equal(envelope.window.offset, offset);
        if (envelope.window.unit === 'chars') text += envelope.value; else if (Array.isArray(envelope.value)) items.push(...envelope.value);
        else return envelope.value;
        if (envelope.window.next === null) { assert.equal(offset + envelope.window.returned, envelope.window.total); return envelope.window.unit === 'chars' ? text : items; }
        assert.ok(envelope.window.returned > 0, 'a window that is not the last returns something');
        offset = envelope.window.next;
      }
      assert.fail(`${selection} did not end`);
    };

    const first = await read({ path: 'candidate.cluster.key' });
    assert.equal(first.isError, false, `the native tool takes path: ${first.text.slice(0, 400)}`);
    assert.equal(first.value.value, request.candidate.cluster.key);
    // A whole read of the 83 kB request stays refused, and says how to read it in bounded parts.
    const whole = await read({});
    assert.equal(whole.isError, false);
    assert.equal(whole.value.payload.material.truncated, true);
    assert.equal(whole.value.payload.material.returnedBytes, 0);
    assert.match(whole.value.payload.material.reason, /path/);
    assert.match(whole.value.payload.material.reason, /offset/);
    assert.match(whole.value.payload.material.reason, /limit/);

    // Every field the Operator works from is retrievable, exactly, in bounded calls.
    const c = request.candidate;
    assert.deepEqual(await all('candidate.targets', 50), c.targets);
    assert.deepEqual(await all('candidate.targets'), c.targets, 'without a limit, as many items as the view holds');
    assert.deepEqual(await all('candidate.cluster.checks'), c.cluster.checks);
    assert.deepEqual(await all('candidate.targetPins'), c.targetPins);
    assert.deepEqual(await all('candidate.editDomain.instances', 20), c.editDomain.instances);
    assert.deepEqual(await all('candidate.editDomain.nets'), c.editDomain.nets);
    assert.deepEqual(await all('candidate.editDomain.regions'), c.editDomain.regions);
    assert.deepEqual(await all('candidate.scope'), c.scope);
    assert.deepEqual(await all('sessionPlan'), request.sessionPlan);
    assert.equal(await all('candidate.cluster.cause'), c.cluster.cause);
    assert.equal(await all('candidate.cluster.key'), c.cluster.key);
    assert.equal(await all('candidate.baseStateId'), c.baseStateId);
    assert.equal(await all('noSafeAction', 4_000), request.noSafeAction, 'a long string pages by characters');
    assert.deepEqual(await all('/candidate/editDomain/instances'), c.editDomain.instances, 'a JSON pointer names the same field');
    assert.equal(await all('candidate.targets.3'), c.targets[3], 'an array index is a path segment');
    // An object too large for one view pages by entries; the candidate itself is one.
    const candidate = await read({ path: 'candidate' });
    assert.equal(candidate.value.window.unit, 'entries');
    assert.ok(candidate.value.window.total === Object.keys(c).length);

    // A path outside the record, and a malformed window, are refused.
    for (const args of [{ path: 'candidate.nothing' }, { path: '../baseState' }, { path: 'candidate.targets.9999' },
      { path: 'candidate.targets', offset: -1 }, { path: 'candidate.targets', limit: 0 }, { path: 'candidate.targets', offset: 1.5 }]) {
      const refused = await read(args);
      assert.equal(refused.isError, true, `${JSON.stringify(args)}: ${refused.text.slice(0, 300)}`);
    }
    // Another record's identity is refused as before.
    assert.equal((await read({ recordId: `${runId}#999999`, path: 'candidate.targets' })).isError, true);

    // Changed retained bytes are refused: nothing of the document is delivered.
    const evidence = path.isAbsolute(retainedPath) ? retainedPath : path.join(packsDir, timingProbePackId, 'run-assets', retainedPath);
    const tampered = bytes.toString('utf8').replace(c.targets[0], c.targets[0].replace('hold', 'setp'));
    await writeFile(evidence, tampered);
    const changed = await read({ path: 'candidate.targets', limit: 5 });
    assert.ok(changed.isError || changed.value.kind === 'unavailable', changed.text.slice(0, 400));
    assert.doesNotMatch(changed.text, /"value"/);
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined);
    await host.dispose();
  }
});
