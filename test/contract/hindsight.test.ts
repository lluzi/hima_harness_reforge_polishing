// Hand-authored Hindsight 0.10.3 network substitute; no native extraction acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { retainExperience, readRetentionStatus, reconcileRetention, recallExperience } = await import(pathToFileURL(path.resolve('packages/harness/lib/hindsight.js')).href);
const connection = { origin: 'http://fixture.invalid:8888', apiKey: 'private-fixture-key', generation: 'g1' };
const input = { bankId: 'private-bank', operationId: '550e8400-e29b-41d4-a716-446655440000', documentId: 'hima-memory-m1-v2', memoryId: 'm1', version: 2, text: 'SRAM 访问上限 37 ns', contentSha256: 'a'.repeat(64) };
const metadata = { hima_memory_id: 'm1', hima_memory_version: '2', hima_content_sha256: 'a'.repeat(64), hima_operation_id: input.operationId };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'unexpected network request');
    return next;
  };
  return { fetch, calls };
}
const status = (value: string) => json({ operation_id: input.operationId, status: value, operation_type: 'batch_retain' });
const document = (changes = {}) => json({ id: input.documentId, bank_id: input.bankId, original_text: input.text, document_metadata: metadata, content_hash: 'native-hash', memory_unit_count: 1, ...changes });

test('one async retain sends explicit UUID, immutable document and string Host metadata', async () => {
  const f = fixture([json({ success: true, async: true, operation_id: input.operationId })]);
  assert.deepEqual(await retainExperience(connection, input, f), { operationId: input.operationId, status: 'submitted' });
  assert.equal(f.calls[0]!.url, `${connection.origin}/v1/default/banks/private-bank/memories`);
  assert.equal(f.calls[0]!.init.method, 'POST');
  assert.equal(new Headers(f.calls[0]!.init.headers).get('authorization'), `Bearer ${connection.apiKey}`);
  assert.deepEqual(JSON.parse(String(f.calls[0]!.init.body)), { async: true, operation_id: input.operationId, items: [{ content: input.text, document_id: input.documentId, update_mode: 'replace', metadata }] });
  assert.ok(f.calls[0]!.init.signal instanceof AbortSignal);
});

test('lost ACK resubmits identical payload with same UUID; failed parent is not silently retried', async () => {
  const f = fixture([new Error(`${connection.origin} ${connection.apiKey} ${input.bankId}`), json({ success: true, async: true, operation_id: input.operationId }), status('failed')]);
  await assert.rejects(retainExperience(connection, input, f), /^Error: Hindsight request failed$/);
  await retainExperience(connection, input, f);
  assert.equal(f.calls[0]!.init.body, f.calls[1]!.init.body);
  assert.equal(await readRetentionStatus(connection, input.bankId, input.operationId, f), 'failed');
  assert.equal(f.calls.length, 3);
});

test('native statuses are preserved; both absent response and 404 mean not_found', async () => {
  for (const value of ['pending', 'processing', 'completed', 'failed', 'cancelled', 'not_found']) {
    const f = fixture([status(value)]);
    assert.equal(await readRetentionStatus(connection, input.bankId, input.operationId, f), value);
    assert.equal(f.calls[0]!.init.method, 'GET');
    assert.equal(f.calls[0]!.url, `${connection.origin}/v1/default/banks/private-bank/operations/${input.operationId}`);
  }
  assert.equal(await readRetentionStatus(connection, input.bankId, input.operationId, fixture([json({}, 404)])), 'not_found');
});

test('confirmation requires completed parent and exact original text, identity and metadata', async () => {
  assert.deepEqual(await reconcileRetention(connection, input, fixture([status('completed'), document()])), { state: 'confirmed', nativeStatus: 'completed', nativeDocumentHash: 'native-hash' });
  for (const changes of [{ original_text: null }, { original_text: 'SRAM 23 ns' }, { id: 'wrong' }, { bank_id: 'wrong' }, { document_metadata: { ...metadata, hima_memory_version: '1' } }, { document_metadata: { ...metadata, hima_operation_id: 'wrong' } }, { document_metadata: { ...metadata, hima_content_sha256: 'wrong' } }, { document_metadata: { ...metadata, extra: 'unbound' } }]) {
    assert.equal((await reconcileRetention(connection, input, fixture([status('completed'), document(changes)]))).state, 'unknown');
  }
  assert.equal((await reconcileRetention(connection, input, fixture([status('completed'), json({}, 404)]))).state, 'unknown');
  for (const value of ['not_found', 'pending', 'processing']) {
    assert.equal((await reconcileRetention(connection, input, fixture([status(value), document()]))).state, 'unknown');
  }
  assert.deepEqual(await reconcileRetention(connection, input, fixture([status('failed')])), { state: 'failed', nativeStatus: 'failed' });
  assert.deepEqual(await reconcileRetention(connection, input, fixture([status('cancelled')])), { state: 'failed', nativeStatus: 'cancelled' });
});

test('recall requests and returns linked world/experience only', async () => {
  const f = fixture([json({ results: [{ document_id: input.documentId, text: '37 ns', type: 'world' }, { document_id: 'd2', text: 'lesson', type: 'experience' }, { document_id: 'd3', text: 'derived', type: 'observation' }, { text: 'unlinked', type: 'world' }, { document_id: 'd4', text: 'unknown', type: 'other' }] })]);
  assert.deepEqual(await recallExperience(connection, { bankId: input.bankId, query: 'SRAM 延迟', maxTokens: 321 }, f), [{ documentId: input.documentId, text: '37 ns', memoryType: 'world' }, { documentId: 'd2', text: 'lesson', memoryType: 'experience' }]);
  assert.equal(f.calls[0]!.url, `${connection.origin}/v1/default/banks/private-bank/memories/recall`);
  assert.deepEqual(JSON.parse(String(f.calls[0]!.init.body)), { query: 'SRAM 延迟', types: ['world', 'experience'], max_tokens: 321 });
});

test('service errors and malformed responses never expose key, origin, bank or server body', async () => {
  for (const response of [json({ detail: `${connection.apiKey} ${connection.origin} ${input.bankId}` }, 500), new Response('secret not JSON'), status('invented'), json({ operation_id: input.operationId, status: 'completed', operation_type: 'refresh_mental_model' }), json({ operation_id: 'wrong', status: 'completed' })]) {
    await assert.rejects(readRetentionStatus(connection, input.bankId, input.operationId, fixture([response])), /^Error: Hindsight request failed$/);
  }
  await assert.rejects(retainExperience(connection, input, fixture([json({ success: true, async: true, operation_id: 'wrong' })])), /^Error: Hindsight request failed$/);
});


test('resubmission is allowed only for an absent parent and absent document', async () => {
  const absent = fixture([status('not_found'), json({}, 404)]);
  assert.deepEqual(await reconcileRetention(connection, input, absent), { state: 'unknown', nativeStatus: 'not_found', resubmitAllowed: true });
  assert.equal(absent.calls.length, 2, 'reconciliation does not submit automatically');
  for (const response of [document(), document({ original_text: 'conflicting bytes' })]) {
    assert.deepEqual(await reconcileRetention(connection, input, fixture([status('not_found'), response])), { state: 'unknown', nativeStatus: 'not_found' });
  }
  for (const value of ['pending', 'processing', 'completed']) {
    assert.equal((await reconcileRetention(connection, input, fixture([status(value), json({}, 404)]))).resubmitAllowed, undefined);
  }
  await assert.rejects(reconcileRetention(connection, input, fixture([status('not_found'), json({}, 503)])), /^Error: Hindsight request failed$/);
});
