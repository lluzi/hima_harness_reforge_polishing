// Pack-declared business data crosses every adapter through this leaf contract. Accepting data
// here does not prove a durable commit, resource release, or the Campaign's business Goal.
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { z } from 'zod';

export const taskResultProtocol = 'hima-task-result/1' as const;
export const taskSchemaDraft = 'https://json-schema.org/draft/2020-12/schema' as const;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index) && isJsonValue(value[index], ancestors)).every(Boolean)
    : Object.values(value).every((child) => isJsonValue(child, ancestors));
  ancestors.delete(value);
  return valid;
}

export const taskJsonValue = z.custom<JsonValue>((value) => isJsonValue(value), 'must be JSON-compatible (finite numbers, plain objects, no undefined or cycles)');
const name = z.string().min(1);
const digest = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA256 digest');
const fieldPath = z.array(z.string());
const packRelativePath = z.string().min(1).refine((value) => !value.startsWith('/') && !value.includes('\\')
  && !value.includes(':') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
'must be a normalized Pack/workspace-relative path');

/** Logical invocation identity is supplied and frozen by Runtime, never by a producer/model. */
export const taskIdentity = z.strictObject({
  runId: name, taskId: name, effectId: name, inputSha256: digest, packSha256: digest, irSha256: digest,
  applicationVersion: name, adapterVersion: name,
});
export type TaskIdentity = z.infer<typeof taskIdentity>;

/** Empty path selects the whole value; path components are exact keys, never expressions. */
export const taskOutputBinding = z.strictObject({ taskId: name, path: fieldPath });
export type TaskOutputBinding = z.infer<typeof taskOutputBinding>;
export const taskInputBinding = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal('literal'), value: taskJsonValue }),
  z.strictObject({ source: z.literal('runInput'), path: fieldPath }),
  z.strictObject({ source: z.literal('goal'), path: fieldPath }),
  z.strictObject({ source: z.literal('strategy'), path: fieldPath }),
  z.strictObject({ source: z.literal('carry'), path: fieldPath }),
  z.strictObject({ source: z.literal('committedOutput'), ...taskOutputBinding.shape }),
  z.strictObject({ source: z.literal('artifactRef'), taskId: name, name }),
  z.strictObject({ source: z.literal('extensionResult'), slotId: name, path: fieldPath }),
]);
export type TaskInputBinding = z.infer<typeof taskInputBinding>;

export const taskSchema = z.strictObject({ version: name, schema: z.record(z.string(), taskJsonValue) });
export type TaskSchema = z.infer<typeof taskSchema>;
export const taskContract = z.strictObject({ input: taskSchema, output: taskSchema });
export type TaskContract = z.infer<typeof taskContract>;
/** Registry keys are Pack-relative schema filenames, with the bytes resolved by the Pack loader. */
export type TaskLocalSchemas = Readonly<Record<string, Record<string, JsonValue>>>;

export const taskArtifact = z.strictObject({
  runId: name, taskId: name, effectId: name, name, path: packRelativePath, sha256: digest,
  mediaType: name.optional(),
});
export type TaskArtifact = z.infer<typeof taskArtifact>;
export const taskDiagnostic = z.strictObject({ code: name, message: name, source: name });
export type TaskDiagnostic = z.infer<typeof taskDiagnostic>;

export const taskProjectionState = z.enum(['pending', 'running', 'waiting', 'succeeded', 'failed', 'cancelled']);
export type TaskProjectionState = z.infer<typeof taskProjectionState>;
export const taskProjection = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending') }),
  z.strictObject({ state: z.literal('running') }),
  z.strictObject({ state: z.literal('waiting'), reason: taskDiagnostic }),
  z.strictObject({ state: z.literal('succeeded') }),
  z.strictObject({ state: z.literal('failed'), reason: taskDiagnostic }),
  z.strictObject({ state: z.literal('cancelled') }),
]);
export type TaskProjection = z.infer<typeof taskProjection>;

/** Producers return business values and artifact metadata, without a second platform identity. */
export const taskToolOutput = z.strictObject({
  schemaVersion: name, value: taskJsonValue, artifacts: z.array(taskArtifact), diagnostics: z.array(taskDiagnostic),
});
export type TaskToolOutput = z.infer<typeof taskToolOutput>;
export const taskResult = z.strictObject({
  schema: z.literal(taskResultProtocol), identity: taskIdentity, outputSchemaVersion: name,
  value: taskJsonValue, artifacts: z.array(taskArtifact), diagnostics: z.array(taskDiagnostic),
});
export type TaskResult = Readonly<z.infer<typeof taskResult>>;

export type TaskContractErrorCode = 'identity' | 'schema-definition' | 'schema-version' | 'input-schema'
  | 'output-envelope' | 'output-schema' | 'artifact-identity';
export interface TaskContractIssue { readonly path: string; readonly message: string }
export class TaskContractError extends Error {
  readonly code: TaskContractErrorCode;
  readonly issues: readonly TaskContractIssue[];
  constructor(code: TaskContractErrorCode, summary: string, issues: readonly TaskContractIssue[]) {
    super(`${summary}: ${issues.map((issue) => `${issue.path || '/'} ${issue.message}`).join('; ')}`);
    this.name = 'TaskContractError';
    this.code = code;
    this.issues = issues;
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown, code: TaskContractErrorCode, summary: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TaskContractError(code, summary, result.error.issues.map((issue) => ({
    path: `/${issue.path.map(String).join('/')}`, message: issue.message,
  })));
  return result.data;
}

// Visit schema positions only: a business const/example may itself contain arbitrary '$ref' data.
const schemaMaps = ['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'] as const;
const schemaSingles = ['items', 'contains', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames', 'not', 'if', 'then', 'else'] as const;
const schemaLists = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
function checkSchemaReferences(schema: unknown): void {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return;
  const object = schema as Record<string, unknown>;
  if (Object.hasOwn(object, '$async') && object.$async !== false) {
    throw new TaskContractError('schema-definition', 'Use a synchronous task schema', [{ path: '$async', message: 'remove $async or set it to false; task data validation is synchronous and cannot consume an unresolved Promise' }]);
  }
  for (const keyword of ['$ref', '$dynamicRef']) {
    const ref = object[keyword];
    if (typeof ref === 'string' && !ref.startsWith('#') && !packRelativePath.safeParse(ref.split('#')[0]).success) {
      throw new TaskContractError('schema-definition', 'Use a Pack-local schema reference', [{ path: keyword, message: `Pack-local references only; replace ${ref} with a local schema file or fragment` }]);
    }
  }
  for (const key of schemaMaps) {
    const map = object[key];
    if (map && typeof map === 'object' && !Array.isArray(map)) Object.values(map).forEach(checkSchemaReferences);
  }
  schemaSingles.forEach((key) => checkSchemaReferences(object[key]));
  schemaLists.forEach((key) => { if (Array.isArray(object[key])) object[key].forEach(checkSchemaReferences); });
}

/** One synchronous schema-admission path for Pack compilation and task handoff. Each declaration
 * owns its Ajv registry, so identical inline $id documents can be reused across task contracts. */
export function compileTaskSchema(declaration: unknown, locals: TaskLocalSchemas = {}): ValidateFunction {
  const declared = parse(taskSchema, declaration, 'schema-definition', 'Correct the task schema declaration');
  if (declared.schema.$schema !== taskSchemaDraft) {
    throw new TaskContractError('schema-definition', 'Declare JSON Schema 2020-12', [{ path: '$schema', message: `set $schema to ${taskSchemaDraft}` }]);
  }
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  let validate;
  try {
    checkSchemaReferences(declared.schema);
    for (const [file, schema] of Object.entries(locals)) {
      if (!packRelativePath.safeParse(file).success) throw new Error(`schema registry key ${file} must be Pack-local`);
      const document = parse(taskSchema.shape.schema, schema, 'schema-definition', `Correct local schema ${file}`);
      if (document.$schema !== taskSchemaDraft) throw new Error(`local schema ${file} must declare JSON Schema 2020-12`);
      checkSchemaReferences(document);
      ajv.addSchema(document, file);
    }
    validate = ajv.compile(declared.schema);
  } catch (error) {
    if (error instanceof TaskContractError) throw error;
    throw new TaskContractError('schema-definition', 'Correct the Pack schema or provide its local referenced schema', [{ path: '/schema', message: error instanceof Error ? error.message : String(error) }]);
  }
  return validate;
}

function validateValue(declaration: TaskSchema, value: JsonValue, locals: TaskLocalSchemas, code: 'input-schema' | 'output-schema'): void {
  const validate = compileTaskSchema(declaration, locals);
  if (!validate(value)) {
    throw new TaskContractError(code, `Correct the task ${code === 'input-schema' ? 'input' : 'output'} to match ${declaration.version}`, (validate.errors ?? []).map((issue) => ({
      path: issue.instancePath, message: `${issue.message ?? issue.keyword} (${JSON.stringify(issue.params)})`,
    })));
  }
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

/** Validate without coercing, adding defaults, dropping fields, or mutating caller-owned data. */
export function validateTaskInput(schema: unknown, value: unknown, locals: TaskLocalSchemas = {}): JsonValue {
  const input = parse(taskJsonValue, value, 'input-schema', 'Supply JSON-compatible task input');
  validateValue(parse(taskSchema, schema, 'schema-definition', 'Correct the task schema declaration'), input, locals, 'input-schema');
  return immutable(structuredClone(input));
}

/** Host fills the envelope after adapters/Readers provide validated business data. */
export function createTaskResult(identity: unknown, contract: unknown, output: unknown, locals: TaskLocalSchemas = {}): TaskResult {
  const fixedIdentity = parse(taskIdentity, identity, 'identity', 'Supply the Runtime-frozen task identity');
  const declared = parse(taskContract, contract, 'schema-definition', 'Correct the task input/output contract');
  const produced = parse(taskToolOutput, output, 'output-envelope', 'Return only schemaVersion, business value, artifacts and sourced diagnostics');
  if (produced.schemaVersion !== declared.output.version) {
    throw new TaskContractError('schema-version', 'Return the declared output schema version', [{ path: '/schemaVersion', message: `expected ${declared.output.version}, received ${produced.schemaVersion}` }]);
  }
  for (const artifact of produced.artifacts) {
    for (const field of ['runId', 'taskId', 'effectId'] as const) {
      if (artifact[field] !== fixedIdentity[field]) {
        throw new TaskContractError('artifact-identity', 'Collect the artifact from this task invocation', [{ path: `/artifacts/${artifact.name}/${field}`, message: `expected ${fixedIdentity[field]}, received ${artifact[field]}; recheck the original task artifact` }]);
      }
    }
  }
  validateValue(declared.output, produced.value, locals, 'output-schema');
  return immutable(structuredClone({ schema: taskResultProtocol, identity: fixedIdentity,
    outputSchemaVersion: declared.output.version, value: produced.value,
    artifacts: produced.artifacts, diagnostics: produced.diagnostics }));
}
