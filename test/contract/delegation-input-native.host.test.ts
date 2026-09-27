import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { retainRunMaterial } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('native delegated input rendering never labels omitted structured evidence complete', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.home);
    const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({
      pack: timingProbePackId,
      site: 'local',
      goal: { target_period_ns: 2 },
      ownerSessionId: actor,
      timeBoxMs: 60_000,
    });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;

    // This is a compact JSON report that fits the delegation reader's 64 KiB typed-input
    // envelope, but not the native DSH tool-result renderer's 50,000-byte inline ceiling.
    // The sentinel is the final endpoint fact; long source provenance follows it, placing the
    // evidence outside both ends of the renderer's head/tail preview.
    const endpointSentinel = 'scenario|hold|endpoint/ENDPOINT_SENTINEL';
    const observationValue = {
      schema: 'xtop-timing-closure-state/1',
      sourceHeader: 'h'.repeat(28_000),
      endpointSlackNs: { [endpointSentinel]: -0.314159 },
      sourceProvenance: 'p'.repeat(28_000),
    };
    const retainedText = JSON.stringify(observationValue);
    const digest = createHash('sha256').update(retainedText).digest('hex');
    assert.ok(Buffer.byteLength(retainedText) > 50_000);
    assert.ok(Buffer.byteLength(retainedText) < 65_536);
    const retainedPath = await retainRunMaterial(
      { ledger: host.ctx.hima.ledger, packsDir: path.join(home.h.home, 'hima/packs') },
      runId,
      Buffer.from(retainedText),
      digest,
    );
    assert.ok(retainedPath);
    const reader = {
      id: 'xtop-closure-state',
      version: '1',
      reportKind: 'xtop-timing-closure-state/1',
      emits: ['xtop_hold_wns'],
    };
    const values = [{ type: 'xtop_hold_wns', unit: 'ns', value: -0.314159 }];
    const observation = await host.ctx.hima.ledger.appendObservation(runId, {
      path: 'flow/state/current.json',
      contentSha256: digest,
      retainedPath,
      bytes: Buffer.byteLength(retainedText),
      reader,
      values,
    });
    const child = await host.ctx.hima.delegate({
      runId,
      actor,
      action: 'create',
      requestId: 'native-input-child',
      expectedEpoch: 1,
      expectedRevision: 0,
      contract: {
        delegationId: 'native-input-child',
        role: 'researcher',
        task: 'Read the exact structured observation.',
        inputRefs: [observation.id],
        allowedTools: ['hima_delegation_input'],
        budgetShare: { maxElapsedMs: 5_000, maxFollowups: 0 },
        dependencyIds: [],
        recipient: { kind: 'run-owner', sessionId: actor },
      },
    }) as any;
    assert.equal(child.status, 'created', JSON.stringify(child));
    const childAgent = host.ctx.get('agents')?.get(child.receipt.childSessionId as never);
    assert.ok(childAgent, 'the recorded delegation owns a real native child Agent');

    const result = await host.ctx.tools.execute({
      callId: 'call-native-delegation-input' as never,
      name: 'hima_delegation_input',
      arguments: { runId, recordId: observation.id },
      agent: childAgent,
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const rendered = result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const sentinelLost = !rendered.includes(endpointSentinel);
    const claimsComplete = rendered.includes('"truncated":false');
    const spilled = rendered.includes('Full formatted result stored at:');
    t.diagnostic(JSON.stringify({
      retainedBytes: Buffer.byteLength(retainedText),
      renderedBytes: Buffer.byteLength(rendered),
      sentinelLost,
      claimsComplete,
      spilled,
    }));
    if (sentinelLost && claimsComplete) {
      assert.fail('native hima_delegation_input omitted the endpoint sentinel while material.truncated remained false');
    }

    // Oversized material must remain one valid, bounded tool envelope. The exact retained source
    // identity and typed reader facts survive; the material is omitted as a whole instead of
    // exposing a syntactically truncated JSON fragment that calls itself complete.
    assert.equal(spilled, false, 'the Hima tool owns a bounded semantic result before generic native spilling');
    const envelope = JSON.parse(rendered) as any;
    assert.equal(envelope.kind, 'record-fact');
    assert.deepEqual(envelope.payload.reader, reader);
    assert.equal(envelope.payload.contentSha256, digest);
    assert.equal(envelope.payload.bytes, Buffer.byteLength(retainedText));
    assert.deepEqual(envelope.payload.values, values);
    assert.equal(envelope.payload.material.encoding, 'json');
    assert.equal(envelope.payload.material.truncated, true);
    assert.equal(envelope.payload.material.returnedBytes, 0);
    assert.equal('value' in envelope.payload.material, false);
    assert.match(envelope.payload.material.reason, /bounded|limit|size/i);

    // Byte bounding must not turn into character counting or pessimistically omit a small source.
    // Quotes, slashes and a newline grow when JSON-stringified; CJK and emoji use multiple UTF-8
    // bytes. The registered native tool still returns every exact retained byte below the cap.
    const smallValue = { note: '雪🙂 says "hold"\\path\nEND_INPUT_SENTINEL' };
    const smallText = JSON.stringify(smallValue);
    const smallDigest = createHash('sha256').update(smallText).digest('hex');
    assert.ok(Buffer.byteLength(smallText, 'utf8') > smallText.length);
    const smallRetainedPath = await retainRunMaterial(
      { ledger: host.ctx.hima.ledger, packsDir: path.join(home.h.home, 'hima/packs') },
      runId,
      Buffer.from(smallText),
      smallDigest,
    );
    assert.ok(smallRetainedPath);
    const smallObservation = await host.ctx.hima.ledger.appendObservation(runId, {
      path: 'flow/state/small-current.json',
      contentSha256: smallDigest,
      retainedPath: smallRetainedPath,
      bytes: Buffer.byteLength(smallText),
      reader,
      values,
    });
    const control = host.ctx.hima.executionContext(runId).run.control!;
    const smallChild = await host.ctx.hima.delegate({
      runId,
      actor,
      action: 'create',
      requestId: 'native-small-input-child',
      expectedEpoch: control.epoch,
      expectedRevision: control.revision,
      contract: {
        delegationId: 'native-small-input-child',
        role: 'researcher',
        task: 'Read the exact small structured observation.',
        inputRefs: [smallObservation.id],
        allowedTools: ['hima_delegation_input'],
        budgetShare: { maxElapsedMs: 5_000, maxFollowups: 0 },
        dependencyIds: [],
        recipient: { kind: 'run-owner', sessionId: actor },
      },
    }) as any;
    assert.equal(smallChild.status, 'created', JSON.stringify(smallChild));
    const smallChildAgent = host.ctx.get('agents')?.get(smallChild.receipt.childSessionId as never);
    assert.ok(smallChildAgent);
    const smallResult = await host.ctx.tools.execute({
      callId: 'call-native-small-delegation-input' as never,
      name: 'hima_delegation_input',
      arguments: { runId, recordId: smallObservation.id },
      agent: smallChildAgent,
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(smallResult.isError, false, JSON.stringify(smallResult));
    const smallRendered = smallResult.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    assert.doesNotMatch(smallRendered, /Full formatted result stored at:/);
    const smallEnvelope = JSON.parse(smallRendered) as any;
    assert.equal(smallEnvelope.kind, 'record-fact');
    assert.equal(smallEnvelope.payload.contentSha256, smallDigest);
    assert.equal(smallEnvelope.payload.bytes, Buffer.byteLength(smallText));
    assert.deepEqual(smallEnvelope.payload.reader, reader);
    assert.deepEqual(smallEnvelope.payload.values, values);
    assert.equal(smallEnvelope.payload.material.text, smallText);
    assert.equal(smallEnvelope.payload.material.returnedBytes, Buffer.byteLength(smallText));
    assert.equal(smallEnvelope.payload.material.truncated, false);
    assert.deepEqual(JSON.parse(smallEnvelope.payload.material.text), smallValue);
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose();
    await home.h.dispose();
  }
});
