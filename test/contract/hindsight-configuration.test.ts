// Pure private configuration fixtures: no Host, credential reader or model calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { resolveHindsightEnvironment, needsHindsightSharedConfiguration, resolveHindsightServiceEnvironment } = await import(pathToFileURL(path.resolve('packages/harness/lib/hindsight-configuration.js')).href);
const shared = { apiKey: 'fixture-shared-key', model: 'host-selected-model', baseUrl: 'https://api.deepseek.com/anthropic', provider: 'anthropic-messages' };

test('service wrapper hides route resolution and only reads credentials when necessary', async () => {
  const reads: boolean[] = [];
  const load = async (readCredential: boolean) => { reads.push(readCredential); return { ...shared, apiKey: readCredential ? shared.apiKey : undefined }; };
  const explicit = { HIMA_HINDSIGHT_LLM_PROVIDER: 'gemini', HIMA_HINDSIGHT_LLM_MODEL: 'own-model', HIMA_HINDSIGHT_LLM_API_KEY: 'own-key' };
  assert.equal((await resolveHindsightServiceEnvironment(explicit, {}, load)).HINDSIGHT_API_LLM_API_KEY, 'own-key');
  assert.deepEqual(reads, []);
  await assert.rejects(resolveHindsightServiceEnvironment({ HIMA_HINDSIGHT_LLM_MODEL: '' }, {}, load), /empty required field/);
  assert.deepEqual(reads, []);
  await assert.rejects(resolveHindsightServiceEnvironment({ HIMA_HINDSIGHT_LLM_PROVIDER: 'gemini' }, {}, load), /requires its own/);
  assert.deepEqual(reads, [false]);
  reads.length = 0;
  assert.equal((await resolveHindsightServiceEnvironment({}, {}, load)).HINDSIGHT_API_LLM_API_KEY, shared.apiKey);
  assert.deepEqual(reads, [true]);
  reads.length = 0;
  assert.equal((await resolveHindsightServiceEnvironment({ HIMA_HINDSIGHT_LLM_PROVIDER: 'anthropic' }, { DEEPSEEK_API_KEY: 'env-key' }, load)).HINDSIGHT_API_LLM_API_KEY, 'env-key');
  assert.deepEqual(reads, [false]);
});

test('credential-read decision is pure and refuses empty fields before shared lookup', () => {
  assert.equal(needsHindsightSharedConfiguration({}), true);
  assert.equal(needsHindsightSharedConfiguration({ HIMA_HINDSIGHT_LLM_PROVIDER: 'gemini', HIMA_HINDSIGHT_LLM_MODEL: 'own-model', HIMA_HINDSIGHT_LLM_API_KEY: 'own-key' }), false);
  assert.equal(needsHindsightSharedConfiguration({ HIMA_HINDSIGHT_LLM_PROVIDER: 'openai' }, shared), false);
  assert.equal(needsHindsightSharedConfiguration({ HIMA_HINDSIGHT_LLM_BASE_URL: 'https://other.example' }, shared), false);
  assert.equal(needsHindsightSharedConfiguration({ HIMA_HINDSIGHT_LLM_PROVIDER: 'anthropic' }, shared), true);
  assert.equal(needsHindsightSharedConfiguration({ HIMA_HINDSIGHT_LLM_PROVIDER: 'anthropic' }), false, 'unknown explicit route does not authorize credential lookup');
  assert.throws(() => needsHindsightSharedConfiguration({ HIMA_HINDSIGHT_LLM_MODEL: '' }), /empty required field/);
  assert.throws(() => needsHindsightSharedConfiguration({ HIMA_HINDSIGHT_LLM_BASE_URL: 'https://user:secret@own.example' }), /without credentials/);
});

test('partial Hindsight key and model overrides supply shared resolution without unnecessary Host secrets', async () => {
  const reads: boolean[] = [];
  const load = async (readCredential: boolean) => {
    reads.push(readCredential);
    assert.equal(readCredential, false, 'explicit service key requires no Host secret');
    return { ...shared, apiKey: undefined };
  };
  const keyOnly = await resolveHindsightServiceEnvironment({ HIMA_HINDSIGHT_LLM_API_KEY: 'own-key' }, {}, load);
  assert.deepEqual(reads, [false]);
  assert.equal(keyOnly.HINDSIGHT_API_LLM_API_KEY, 'own-key');
  assert.equal(keyOnly.HINDSIGHT_API_LLM_MODEL, 'host-selected-model');
  reads.length = 0;
  const loadWithoutModel = async (readCredential: boolean) => ({ ...await load(readCredential), model: undefined });
  const keyAndModel = await resolveHindsightServiceEnvironment({ HIMA_HINDSIGHT_LLM_MODEL: 'own-model', HIMA_HINDSIGHT_LLM_API_KEY: 'own-key' }, {}, loadWithoutModel);
  assert.deepEqual(reads, [false]);
  assert.deepEqual(keyAndModel, {
    HINDSIGHT_API_LLM_MODEL: 'own-model', HINDSIGHT_API_LLM_API_KEY: 'own-key',
    HINDSIGHT_API_LLM_PROVIDER: 'anthropic', HINDSIGHT_API_LLM_BASE_URL: 'https://api.deepseek.com/anthropic',
  });
  reads.length = 0;
  const compatible = await resolveHindsightServiceEnvironment({ HIMA_HINDSIGHT_LLM_PROVIDER: 'anthropic', HIMA_HINDSIGHT_LLM_MODEL: 'own-model' }, { DEEPSEEK_API_KEY: 'env-key' }, loadWithoutModel);
  assert.deepEqual(reads, [false]);
  assert.equal(compatible.HINDSIGHT_API_LLM_MODEL, 'own-model');
  assert.equal(compatible.HINDSIGHT_API_LLM_API_KEY, 'env-key');
});

test('Hindsight default reuses the shared Messages tuple with SDK-native base and preserves non-LLM overrides', () => {
  assert.deepEqual(resolveHindsightEnvironment({ HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL: '/fixture/embed', HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL: '/fixture/rerank', UNRELATED: 'ignored' }, shared), {
    HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL: '/fixture/embed', HINDSIGHT_API_RERANKER_LOCAL_MODEL: '/fixture/rerank',
    HINDSIGHT_API_LLM_PROVIDER: 'anthropic', HINDSIGHT_API_LLM_MODEL: 'host-selected-model', HINDSIGHT_API_LLM_API_KEY: 'fixture-shared-key', HINDSIGHT_API_LLM_BASE_URL: 'https://api.deepseek.com/anthropic',
  });
  assert.equal(resolveHindsightEnvironment({}, { ...shared, baseUrl: 'https://api.deepseek.com/anthropic/v1/' }).HINDSIGHT_API_LLM_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.deepEqual(resolveHindsightEnvironment({}, { ...shared, provider: 'openai-completions', baseUrl: 'https://api.deepseek.com/v1' }), {
    HINDSIGHT_API_LLM_PROVIDER: 'openai', HINDSIGHT_API_LLM_MODEL: 'host-selected-model', HINDSIGHT_API_LLM_API_KEY: 'fixture-shared-key', HINDSIGHT_API_LLM_BASE_URL: 'https://api.deepseek.com/v1',
  });
});

test('explicit own tuple needs no shared configuration and retains exact values', () => {
  const explicit = { HIMA_HINDSIGHT_LLM_PROVIDER: 'gemini', HIMA_HINDSIGHT_LLM_MODEL: 'explicit-model', HIMA_HINDSIGHT_LLM_API_KEY: 'fixture-own-key', HIMA_HINDSIGHT_LLM_BASE_URL: 'https://own.example/v1/' };
  const expected = { HINDSIGHT_API_LLM_PROVIDER: 'gemini', HINDSIGHT_API_LLM_MODEL: 'explicit-model', HINDSIGHT_API_LLM_API_KEY: 'fixture-own-key', HINDSIGHT_API_LLM_BASE_URL: 'https://own.example/v1/' };
  assert.deepEqual(resolveHindsightEnvironment(explicit), expected);
  assert.deepEqual(resolveHindsightEnvironment(explicit, shared), expected);
  const { HIMA_HINDSIGHT_LLM_BASE_URL: _, ...nativeDefault } = explicit;
  assert.equal(resolveHindsightEnvironment(nativeDefault, shared).HINDSIGHT_API_LLM_BASE_URL, undefined);
});

test('compatible explicit configuration overrides shared values without reading external state', () => {
  const input = Object.freeze({ HIMA_HINDSIGHT_LLM_PROVIDER: 'anthropic', HIMA_HINDSIGHT_LLM_MODEL: 'override-model', HIMA_HINDSIGHT_LLM_BASE_URL: 'https://api.deepseek.com/anthropic/' });
  const model = Object.freeze({ ...shared });
  assert.deepEqual(resolveHindsightEnvironment(input, model), {
    HINDSIGHT_API_LLM_PROVIDER: 'anthropic', HINDSIGHT_API_LLM_MODEL: 'override-model', HINDSIGHT_API_LLM_BASE_URL: 'https://api.deepseek.com/anthropic/', HINDSIGHT_API_LLM_API_KEY: 'fixture-shared-key',
  });
  assert.equal(resolveHindsightEnvironment({ HIMA_HINDSIGHT_LLM_API_KEY: 'fixture-own-key' }, model).HINDSIGHT_API_LLM_API_KEY, 'fixture-own-key');
});

test('unrelated providers and custom endpoints never inherit shared credentials or model', () => {
  for (const explicit of [
    { HIMA_HINDSIGHT_LLM_PROVIDER: 'openai' },
    { HIMA_HINDSIGHT_LLM_BASE_URL: 'https://other.example/anthropic' },
    { HIMA_HINDSIGHT_LLM_BASE_URL: 'https://api.deepseek.com/anthropic/v1' },
    { HIMA_HINDSIGHT_LLM_PROVIDER: 'anthropic', HIMA_HINDSIGHT_LLM_BASE_URL: 'https://api.deepseek.com/v1' },
  ]) assert.throws(() => resolveHindsightEnvironment(explicit, shared), /requires its own/);
  assert.throws(() => resolveHindsightEnvironment({}), /requires its own/);
  for (const missing of ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY']) {
    const explicit: Record<string, string> = { HIMA_HINDSIGHT_LLM_PROVIDER: 'openai', HIMA_HINDSIGHT_LLM_MODEL: 'own-model', HIMA_HINDSIGHT_LLM_API_KEY: 'own-key' };
    delete explicit['HIMA_HINDSIGHT_' + missing];
    assert.throws(() => resolveHindsightEnvironment(explicit), /requires its own/);
  }
});

test('explicit empty fields and unsafe URLs fail closed without exposing secret values', () => {
  for (const field of ['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_BASE_URL', 'RETAIN_LLM_API_KEY']) {
    for (const value of ['', '  ']) assert.throws(() => resolveHindsightEnvironment({ ['HIMA_HINDSIGHT_' + field]: value }, shared), /empty required field/);
  }
  for (const value of ['invalid', 'file:///fixture', 'https://user:fixture-secret@own.example', 'https://own.example?key=fixture-secret', 'https://own.example#fixture-secret']) {
    assert.throws(() => resolveHindsightEnvironment({ HIMA_HINDSIGHT_LLM_BASE_URL: value }, shared), (error: Error) => !error.message.includes('fixture-secret') && /endpoint/.test(error.message));
  }
});

test('operation route overrides cannot inherit primary credentials across provider or endpoint', () => {
  assert.throws(() => resolveHindsightEnvironment({ HIMA_HINDSIGHT_RETAIN_LLM_PROVIDER: 'openai' }, shared), /operation LLM route/);
  assert.throws(() => resolveHindsightEnvironment({ HIMA_HINDSIGHT_REFLECT_LLM_BASE_URL: 'https://other.example' }, shared), /operation LLM route/);
  const explicit = { HIMA_HINDSIGHT_RETAIN_LLM_PROVIDER: 'openai', HIMA_HINDSIGHT_RETAIN_LLM_MODEL: 'own-model', HIMA_HINDSIGHT_RETAIN_LLM_API_KEY: 'own-key', HIMA_HINDSIGHT_RETAIN_LLM_BASE_URL: 'https://other.example/v1' };
  assert.equal(resolveHindsightEnvironment(explicit, shared).HINDSIGHT_API_RETAIN_LLM_API_KEY, 'own-key');
  const { HIMA_HINDSIGHT_RETAIN_LLM_BASE_URL: _, ...withoutEndpoint } = explicit;
  assert.throws(() => resolveHindsightEnvironment(withoutEndpoint, shared), /inherited endpoint/);
  assert.equal(resolveHindsightEnvironment({ HIMA_HINDSIGHT_REFLECT_LLM_MODEL: 'reflect-model' }, shared).HINDSIGHT_API_REFLECT_LLM_MODEL, 'reflect-model');
});
