import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readGuideContext } from '@hima/harness';

// L1 formatter fixtures only: the controlled artifact delivery does not qualify Host/PG,
// archive/hash enforcement, project authorization or retained-vs-committed lookup.
function fixture(text?: string | Buffer, extraRef: Record<string, unknown> = {}, previewBytes?: number) {
  const bytes = text === undefined ? Buffer.from([0, 255, 128]) : typeof text === 'string' ? Buffer.from(text) : text;
  const suppliedBytes = previewBytes === undefined ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  const suppliedText = text === undefined ? undefined : previewBytes === undefined
    ? typeof text === 'string' ? text : bytes.toString('utf8') : bytes.toString('utf8', 0, previewBytes);
  const ref = { id: 'result', kind: 'file' as const, path: 'state/result.json', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), ...extraRef };
  const target = { kind: 'task-artifact' as const, runId: 'run-original', effectId: 'effect-original', name: 'result' };
  const unexpected = (): never => { throw new Error('Unexpected formatter dependency'); };
  const deps = {
    ctx: { get: (key: string) => key === 'agents' ? { get: (id: string) => id === 'viewer'
      ? { session: { header: { cwd: process.cwd() } } } : undefined } : undefined },
    ledger: { run: unexpected },
    readRun: async (id: string) => { assert.equal(id, target.runId); return { id, control: { owner: 'viewer' } }; },
    readTaskArtifact: async (runId: string, effectId: string, name: string) => {
      assert.deepEqual([runId, effectId, name], [target.runId, target.effectId, target.name]);
      return { kind: 'file' as const, ref, bytes: suppliedBytes, text: suppliedText,
        truncated: previewBytes !== undefined && bytes.length > previewBytes, references: [] };
    },
    executionContext: unexpected, readExperience: unexpected,
  };
  const read = async (selector: Record<string, unknown> = {}) => {
    const view = await readGuideContext(deps as never, { sessionId: 'viewer', requestId: 'formatter-fixture', target: { ...target, ...selector } });
    const serialized = JSON.stringify(view);
    assert.ok(Buffer.byteLength(serialized, 'utf8') <= 40_000, 'the complete outer JSON including refs and nextRequest fits');
    const parsed = JSON.parse(serialized);
    assert.deepEqual(parsed.facts.ref, ref);
    assert.deepEqual(parsed.sources, [target.runId, target.effectId, ref.sha256]);
    return parsed;
  };
  return { read, ref, target };
}

test('Guide artifact high-cardinality default directory pages the complete four-million-item original', async () => {
  // Same input as the retained 515 MiB heap OOM counterexample. Construct one compact byte
  // sequence, not a four-million-element JS fixture array, and reuse it for every request.
  const bytes = Buffer.alloc(8_000_001, ',0');
  bytes[0] = 91; bytes[bytes.length - 1] = 93;
  const f = fixture(bytes, {}, 1024 * 1024);
  assert.equal(f.ref.sha256, 'fa420a0f441dc4f744d511ed7d5b5fcb29e0849ff6408e7854e744a51f316e14');
  const overview = await f.read();
  const directory = overview.facts.content;
  assert.equal(directory.kind, 'overview');
  assert.equal(directory.nodeType, 'array');
  assert.equal(directory.window.unit, 'entries');
  assert.equal(directory.window.total, 4_000_000);
  assert.equal(directory.window.offset, 0);
  assert.ok(directory.window.returned > 0);
  assert.equal(directory.fields.length, directory.window.returned);
  assert.equal(directory.fields[0].path, '/0');
  assert.equal(directory.fields.at(-1).path, `/${directory.window.returned - 1}`);
  assert.ok(directory.fields.every((field: { nodeType: string }) => field.nodeType === 'number'));
  assert.equal(directory.window.next, directory.window.returned);
  assert.deepEqual(directory.nextRequest, { ...f.target, path: '', offset: directory.window.next });
  // Existing continuation selectors can return an item selection rather than another directory.
  const next = (await f.read(directory.nextRequest)).facts.content;
  assert.equal(next.kind, 'selection');
  assert.equal(next.window.unit, 'items');
  assert.equal(next.window.total, 4_000_000);
  assert.equal(next.window.offset, directory.window.next);
  assert.ok(next.window.returned > 0);
  assert.equal(next.value.length, next.window.returned);
  assert.ok(next.value.every((value: unknown) => value === 0));
  assert.equal(next.window.next, next.window.offset + next.window.returned);
  const selected = (await f.read({ path: '', limit: 32 })).facts.content;
  assert.equal(selected.kind, 'selection');
  assert.deepEqual(selected.value, Array(32).fill(0));
  assert.equal(selected.window.total, 4_000_000);
  assert.equal(selected.window.returned, 32);
  assert.equal(selected.window.next, 32);
});

test('Guide artifact JSON descent uses full verified Uint8Array bytes after a 1 MiB Reader preview', async () => {
  // Static SPEC-1 counterexample added before the fix; execution/RED remains UNRUN.
  // The real Reader returns complete bytes with only the first MiB in text and truncated:true.
  const previewBytes = 1024 * 1024;
  const text = JSON.stringify({ padding: 'x'.repeat(previewBytes), round: 17 });
  assert.ok(Buffer.byteLength(text) > previewBytes);
  const f = fixture(text, {}, previewBytes);
  const overview = await f.read();
  assert.equal(overview.facts.truncated, true);
  assert.equal(overview.facts.content.kind, 'overview');
  assert.ok(overview.facts.content.fields.some((field: { path: string }) => field.path === '/round'));
  assert.equal((await f.read({ path: '/round' })).facts.content.value, 17);
});

test('Guide artifact text windows continue beyond a truncated 1 MiB Reader preview', async () => {
  const previewBytes = 1024 * 1024;
  const tail = 'TAIL:中文"\\ finish';
  const text = 'x'.repeat(previewBytes) + tail;
  const f = fixture(text, {}, previewBytes);
  const first = await f.read();
  assert.equal(first.facts.truncated, true);
  assert.equal(first.facts.content.window.total, text.length);
  const crossing = await f.read({ offset: previewBytes - 3, limit: 6 });
  assert.equal(crossing.facts.content.value, 'xxxTAI');
  assert.equal(crossing.facts.content.window.next, previewBytes + 3);
  const rest = await f.read(crossing.facts.content.nextRequest);
  assert.equal(rest.facts.content.value, tail.slice(3, 9));
  const last = await f.read({ offset: previewBytes });
  assert.equal(last.facts.content.value, tail);
  assert.equal(last.facts.content.window.next, null);
});

test('Guide artifact formatter exposes the two retained counterexample shapes and exact historical fields', async () => {
  // Shaped after the retained placement-result/round-decision counterexamples, not native Reader results.
  const detail = 'candidate detail '.repeat(16_000);
  for (const document of [
    { best: { round: 1, detail }, nativeAnchor: { round: 0 }, rounds: [{ round: 1, detail }] },
    { best: { round: 1, detail }, nextRound: { round: 2, detail } },
  ]) {
    const f = fixture(JSON.stringify(document));
    const overview = await f.read();
    assert.equal(overview.facts.kind, 'task-artifact');
    assert.equal(overview.facts.truncated, true);
    assert.equal(overview.facts.content.kind, 'overview');
    assert.ok(overview.facts.content.fields.some((field: { path: string }) => field.path === '/best'));
    const follow = await f.read(overview.facts.content.nextRequest);
    assert.ok(follow.facts.content, 'the supplied nextRequest is executable');
    assert.equal((await f.read({ path: '/best/round' })).facts.content.value, 1);
    if ('nextRound' in document) assert.equal((await f.read({ path: '/nextRound/round' })).facts.content.value, 2);
  }
});

test('Guide artifact character windows preserve Chinese, escaping and complete JSON across advancing pages', async () => {
  const text = '中文"\\\n😀'.repeat(8_000);
  for (const [material, selector] of [[text, {}], [JSON.stringify({ text }), { path: '/text' }]] as const) {
    const f = fixture(material);
    let view = await f.read(selector);
    let reconstructed = '';
    let previous = -1;
    for (let pages = 0; pages < 100; pages++) {
      const content = view.facts.content;
      assert.equal(content.kind, 'selection');
      assert.equal(content.window.unit, 'chars');
      assert.ok(content.window.offset > previous);
      assert.ok(content.window.returned > 0);
      previous = content.window.offset;
      reconstructed += content.value;
      if (content.window.next === null) break;
      assert.equal(content.nextRequest.offset, content.window.next);
      view = await f.read(content.nextRequest);
    }
    assert.equal(reconstructed, text);
  }
});

test('Guide artifact oversized first entries offer usable descent rather than a zero-progress window', async () => {
  const f = fixture(JSON.stringify({ best: { giant: 'x'.repeat(100_000), round: 1 }, final: 2 }));
  const view = await f.read({ path: '', limit: 1 });
  assert.equal(view.facts.content.kind, 'overview');
  assert.equal(view.facts.content.window.returned, 1);
  assert.equal(view.facts.content.window.next, 1);
  assert.equal((await f.read(view.facts.content.nextRequest)).facts.content.value.final, 2);
  const nested = await f.read({ path: '/best', limit: 1 });
  assert.equal(nested.facts.content.kind, 'overview');
  const giant = await f.read({ path: nested.facts.content.fields[0].path, limit: 50 });
  assert.equal(giant.facts.content.value, 'x'.repeat(50));
  assert.equal(giant.facts.content.window.next, 50);
  assert.equal((await f.read({ path: '/best/round' })).facts.content.value, 1);
  const array = fixture(JSON.stringify([{ giant: 'x'.repeat(100_000), round: 1 }, { round: 2 }]));
  const arrayView = await array.read({ path: '', limit: 1 });
  assert.equal(arrayView.facts.content.kind, 'overview');
  assert.equal(arrayView.facts.content.fields[0].path, '/0');
  assert.equal((await array.read({ path: '/0/round' })).facts.content.value, 1);
});

test('Guide artifact directory and selection cursors advance to total and preserve pointer escapes', async () => {
  const document = Object.fromEntries(Array.from({ length: 1_200 }, (_, index) => [`field/${index}~`, { huge: 'x'.repeat(100), round: index }]));
  const f = fixture(JSON.stringify(document));
  let view = await f.read();
  assert.equal(view.facts.content.kind, 'overview');
  assert.equal(view.facts.content.fields[0].path, '/field~10~0');
  assert.equal((await f.read({ path: '/field~10~0/round' })).facts.content.value, 0);
  let previous = -1;
  let reached = 0;
  const discovered: string[] = [];
  for (let pages = 0; pages < 100; pages++) {
    const content = view.facts.content;
    assert.ok(content.window.offset > previous);
    assert.ok(content.window.returned > 0);
    assert.equal(content.path, '');
    // A directory continuation can return a fitting selection; its entry cursor still addresses
    // the same original object. Account for both forms and detect any omitted or repeated key.
    discovered.push(...(content.kind === 'overview'
      ? content.fields.map((field: { path: string }) => field.path.slice(1).replaceAll('~1', '/').replaceAll('~0', '~'))
      : Object.keys(content.value)));
    previous = content.window.offset;
    reached = content.window.offset + content.window.returned;
    if (content.window.next === null) break;
    view = await f.read(content.nextRequest);
  }
  assert.equal(reached, 1_200);
  assert.deepEqual(discovered, Object.keys(document));
});

test('Guide artifact small text and binary retain their existing material semantics', async () => {
  for (const text of ['small text 中文', '{"small":true}', '']) {
    const view = await fixture(text).read();
    assert.equal(view.facts.text, text);
    assert.equal(view.facts.truncated, false);
    assert.equal(view.facts.content, undefined);
    assert.deepEqual(view.missing, []);
  }
  const binary = fixture();
  const view = await binary.read();
  assert.equal(view.facts.text, undefined);
  assert.equal(view.facts.truncated, false);
  assert.match(view.missing[0], /Binary artifact.*download/);
  await assert.rejects(binary.read({ path: '' }), { code: 'hima/invalid-view-address' });
});

test('Guide artifact selectors and unrepresentable metadata are refused explicitly', async () => {
  const f = fixture('{"known":[1,2],"text":"ok","bad~2":42}');
  for (const selector of [{ path: '/absent' }, { path: '/known/~2' }, { path: 'known..bad' },
    { offset: -1 }, { offset: 0.5 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { limit: 0 }, { limit: -1 },
    { limit: 1.5 }, { path: '/known', offset: 3 }, { path: '/text', offset: 3 }, { path: '/bad~2' }]) {
    await assert.rejects(f.read(selector), { code: 'hima/invalid-view-address' });
  }
  await assert.rejects(fixture('small', { path: 'x'.repeat(40_000) }).read(), { code: 'hima/invalid-view-address' });
  await assert.rejects(fixture(JSON.stringify({ ['x'.repeat(1_025)]: 'x'.repeat(50_000) })).read(), { code: 'hima/invalid-view-address' });
  await assert.rejects(fixture(JSON.stringify({ ['~'.repeat(700)]: 'x'.repeat(50_000) })).read({ path: '~'.repeat(700) }), { code: 'hima/invalid-view-address' });
});
