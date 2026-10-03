// L1: one data contract, independent of the command/model/engineering adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTaskResult, validateTaskInput, taskIdentity, taskInputBinding, taskOutputBinding,
  taskProjectionState, taskProjection, taskContract, TaskContractError,
} from '@hima/harness';

const digest = 'a'.repeat(64);
const identity = {
  runId: 'run-1', taskId: 'fix-timing/0', effectId: 'effect-1', inputSha256: digest,
  packSha256: digest, irSha256: digest, applicationVersion: 'hima-dbos/1', adapterVersion: 'fixture/1',
};
const draft = 'https://json-schema.org/draft/2020-12/schema';
const contract = {
  input: { version: 'input/1', schema: { $schema: draft, type: 'object', properties: { design: { type: 'string' } }, required: ['design'], additionalProperties: false } },
  output: { version: 'result/1', schema: { $schema: draft, type: 'object', properties: {
    goalMet: { type: 'boolean' }, evidence: { enum: ['PASS', 'FAIL', 'UNKNOWN'] }, remaining: { type: 'number' },
  }, required: ['goalMet', 'evidence', 'remaining'], additionalProperties: false } },
};
const artifact = { runId: identity.runId, taskId: identity.taskId, effectId: identity.effectId,
  name: 'checkpoint', path: 'engineering/best.checkpoint', sha256: digest };
const output = { schemaVersion: 'result/1', value: { goalMet: true, evidence: 'PASS', remaining: 0 },
  artifacts: [artifact], diagnostics: [{ code: 'timing', message: 'Raw timing verified', source: 'reader:timing/1' }] };

function rejected(action: () => unknown, code: string, correction: RegExp) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof TaskContractError);
    assert.equal(error.code, code);
    assert.match(error.message, correction);
    assert.ok(error.issues.length);
    return true;
  });
}

test('different producer data use one protocol while Host fills the identity envelope', () => {
  // These are data examples, not adapter integration coverage (which belongs to U4).
  const examples = [
    { ...output, value: { goalMet: true, evidence: 'PASS', remaining: 0 } },
    { ...output, value: { goalMet: false, evidence: 'FAIL', remaining: 24 } },
    { ...output, value: { goalMet: false, evidence: 'UNKNOWN', remaining: 18 } },
  ];
  for (const example of examples) {
    const result = createTaskResult(identity, contract, example);
    assert.equal(result.schema, 'hima-task-result/1');
    assert.deepEqual(result.identity, identity);
    assert.equal(result.outputSchemaVersion, 'result/1');
    assert.deepEqual(result.value, example.value);
    assert.deepEqual(result.artifacts, [artifact]);
    assert.deepEqual(result.diagnostics, output.diagnostics);
    assert.equal(Object.hasOwn(result, 'state'), false, 'data validation alone cannot claim execution completion');
  }
});

test('required output has an actionable failure and complete positive path', () => {
  rejected(() => createTaskResult(identity, contract, { ...output, value: { goalMet: false } }), 'output-schema', /evidence|remaining/);
  assert.equal(createTaskResult(identity, contract, output).outputSchemaVersion, 'result/1');
});

test('wrong output version and schema draft are rejected before handoff', () => {
  rejected(() => createTaskResult(identity, contract, { ...output, schemaVersion: 'result/2' }), 'schema-version', /result\/1/);
  rejected(() => createTaskResult(identity, { ...contract, output: { ...contract.output, schema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' } } }, output), 'schema-definition', /2020-12/);
});

test('produced artifacts are bound to Host run/task/effect identity', () => {
  for (const field of ['runId', 'taskId', 'effectId'] as const) {
    rejected(() => createTaskResult(identity, contract, { ...output, artifacts: [{ ...artifact, [field]: 'other' }] }), 'artifact-identity', new RegExp(field));
  }
  assert.deepEqual(createTaskResult(identity, contract, output).artifacts[0], artifact);
});

test('false Goal and UNKNOWN remain valid business output without fabricated Goal met', () => {
  const value = { goalMet: false, evidence: 'UNKNOWN', remaining: 18 };
  const result = createTaskResult(identity, contract, { ...output, value });
  assert.deepEqual(result.value, value);
  assert.equal((result.value as typeof value).goalMet, false);
});

test('input validation preserves facts and rejects missing inputs or coercion', () => {
  assert.deepEqual(validateTaskInput(contract.input, { design: 'swerv_wrapper' }), { design: 'swerv_wrapper' });
  rejected(() => validateTaskInput(contract.input, {}), 'input-schema', /design/);
  rejected(() => validateTaskInput(contract.input, { design: 123 }), 'input-schema', /string/);
  const schema = { version: 'input/2', schema: { $schema: draft, type: 'object', properties: { design: { type: 'string', default: 'invented' } }, required: ['design'] } };
  const input = {};
  rejected(() => validateTaskInput(schema, input), 'input-schema', /design/);
  assert.deepEqual(input, {}, 'default values never fill facts');
});

test('local schema references and JSON2020-12 prefixItems work, remote or missing refs fail', () => {
  const schema = { version: 'tuple/1', schema: { $schema: draft, type: 'array', prefixItems: [{ $ref: 'schemas/name.json' }], items: false, minItems: 1 } };
  const schemas = { 'schemas/name.json': { $schema: draft, type: 'string' } };
  assert.deepEqual(validateTaskInput(schema, ['design'], schemas), ['design']);
  rejected(() => validateTaskInput(schema, [12], schemas), 'input-schema', /string/);
  rejected(() => validateTaskInput(schema, ['design']), 'schema-definition', /schemas\/name\.json/);
  rejected(() => validateTaskInput({ ...schema, schema: { $schema: draft, $ref: 'https://example.com/schema.json' } }, []), 'schema-definition', /Pack-local/);
  rejected(() => validateTaskInput({ ...schema, schema: { $schema: draft, $ref: '../outside.json' } }, []), 'schema-definition', /Pack-local/);
  rejected(() => validateTaskInput({ ...schema, schema: { $schema: draft, type: 'object', customExecution: true } }, {}), 'schema-definition', /customExecution/);
});

test('synchronous handoff rejects async schemas rather than accepting an unresolved Promise', () => {
  for (const marker of ['yes', 1]) {
    const asynchronous = { ...contract.input, schema: { ...contract.input.schema, $async: marker } };
    rejected(() => validateTaskInput(asynchronous, { design: 'design' }), 'schema-definition', /synchronous|async/);
  }
  assert.deepEqual(validateTaskInput({ ...contract.input, schema: { ...contract.input.schema, $async: false } }, { design: 'design' }), { design: 'design' });
  const asyncOutput = { ...contract, output: { ...contract.output, schema: { ...contract.output.schema, $async: true } } };
  rejected(() => createTaskResult(identity, asyncOutput, { ...output, value: { goalMet: false } }), 'schema-definition', /synchronous|async/);
  const schema = { version: 'async-local/1', schema: { $schema: draft, $ref: 'schemas/name.json' } };
  rejected(() => validateTaskInput(schema, 12, { 'schemas/name.json': { $schema: draft, $async: true, type: 'string' } }), 'schema-definition', /synchronous|async/);
  assert.deepEqual(createTaskResult(identity, contract, output).value, output.value);
});

test('platform fields are not accepted from producers; values must be JSON-compatible', () => {
  rejected(() => createTaskResult(identity, contract, { ...output, identity: { ...identity, runId: 'forged' } }), 'output-envelope', /identity/);
  rejected(() => createTaskResult(identity, contract, { ...output, value: { ...output.value, remaining: NaN } }), 'output-envelope', /JSON|remaining/);
  rejected(() => createTaskResult(identity, contract, { ...output, value: { ...output.value, hidden: undefined } }), 'output-envelope', /JSON|hidden/);
  rejected(() => createTaskResult(identity, contract, { ...output, value: new Date() }), 'output-envelope', /JSON/);
});

test('accepted handoff is a detached immutable snapshot', () => {
  const source = structuredClone(output);
  const result = createTaskResult(identity, contract, source);
  source.value.remaining = 19;
  source.artifacts[0]!.path = 'changed';
  assert.equal((result.value as typeof output.value).remaining, 0);
  assert.equal(result.artifacts[0]!.path, artifact.path);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.identity));
  assert.ok(Object.isFrozen(result.value));
  assert.ok(Object.isFrozen(result.artifacts));
});

test('six execution projection states, structured waits, and business outcomes stay separate', () => {
  for (const state of ['pending', 'running', 'waiting', 'succeeded', 'failed', 'cancelled']) assert.equal(taskProjectionState.parse(state), state);
  assert.equal(taskProjectionState.safeParse('goal-met').success, false);
  assert.equal(taskProjection.safeParse({ state: 'waiting' }).success, false);
  assert.deepEqual(taskProjection.parse({ state: 'waiting', reason: { code: 'missing-input', message: 'Prepare design input', source: 'binding:design' } }),
    { state: 'waiting', reason: { code: 'missing-input', message: 'Prepare design input', source: 'binding:design' } });
});

test('binding and identity formats are serializable shared contracts', () => {
  const bindings = [
    { source: 'literal', value: { count: 1 } }, { source: 'runInput', path: ['design'] },
    { source: 'goal', path: [] }, { source: 'strategy', path: ['effort'] },
    { source: 'committedOutput', taskId: 'prepare', path: ['design', 'name'] },
    { source: 'artifactRef', taskId: 'prepare', name: 'checkpoint' },
  ];
  for (const binding of bindings) assert.deepEqual(taskInputBinding.parse(JSON.parse(JSON.stringify(binding))), binding);
  assert.deepEqual(taskOutputBinding.parse({ taskId: 'deliver', path: [] }), { taskId: 'deliver', path: [] });
  assert.deepEqual(taskIdentity.parse(identity), identity);
  assert.deepEqual(taskContract.parse(contract), contract);
  assert.equal(taskInputBinding.safeParse({ source: 'expression', expression: 'x + 1' }).success, false);
  assert.equal(taskIdentity.safeParse({ ...identity, inputSha256: 'wrong' }).success, false);
});
