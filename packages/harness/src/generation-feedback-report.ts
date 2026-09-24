import { z } from 'zod';

const id = z.string().min(1).max(2048);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const source = z.strictObject({ id, sha256, path: id.optional() });
const coverage = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('measured'), coveredIds: z.array(id), missingIds: z.array(id) }),
  z.strictObject({ status: z.literal('unknown'), coveredIds: z.array(id), missingIds: z.array(id), reason: id }),
]);
const category = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('measured'), ids: z.array(id) }),
  z.strictObject({ status: z.literal('unknown'), ids: z.array(id).length(0), reason: id }),
]);
const knownMethod = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), method: id }),
  z.strictObject({ status: z.literal('unknown'), reason: id }),
]);
const knownStop = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), text: id }),
  z.strictObject({ status: z.literal('unknown'), reason: id }),
]);
const demand = z.strictObject({
  inputPins: z.array(id),
  outputs: z.array(z.strictObject({ name: id, function: id.nullable() })),
  truthTable: z.strictObject({
    inputOrder: z.array(id), outputOrder: z.array(id),
    outputTruthTablesHex: z.record(z.string(), id),
  }),
  timingArcs: z.array(z.record(z.string(), z.unknown())),
  conditionalDelayTarget: z.strictObject({
    requiredDelayNs: z.number().finite().positive(), targetEndpoints: z.array(id),
    slewNs: z.number().finite().nullable(), loadPf: z.number().finite().nullable(),
    corner: id.nullable(), unknowns: z.array(id),
  }),
  implementation: z.record(z.string(), z.unknown()),
});
const nextItem = z.strictObject({
  id, targetIds: z.array(id), change: id, expectedEffect: id,
  validation: knownMethod, stopCondition: knownStop, sourceIds: z.array(id).min(1),
  demand: demand.optional(),
});

export const generationFeedbackReport = z.strictObject({
  schema: z.literal('hima-generation-feedback/1'),
  generation: z.union([z.number().int().nonnegative(), id]),
  subject: z.enum(['timing-endpoint', 'cell-demand']),
  sources: z.array(source).min(1),
  denominator: z.strictObject({
    kind: z.enum(['endpoint', 'cell-demand']), originalIds: z.array(id),
    originalCount: z.number().int().nonnegative(),
  }),
  coverage: z.strictObject({ before: coverage, after: coverage }),
  comparability: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('comparable'), reasons: z.array(id).length(0) }),
    z.strictObject({ status: z.enum(['not-comparable', 'unknown']), reasons: z.array(id).min(1) }),
  ]),
  endpointChanges: z.strictObject({
    fixed: category, remaining: category, entrant: category, regressed: category, missing: category,
  }),
  next: z.strictObject({
    kind: z.enum(['action', 'cell-demand', 'stop']),
    status: z.enum(['available', 'unknown', 'stop']), items: z.array(nextItem), reason: id,
  }),
  unknowns: z.array(id),
}).superRefine((report, ctx) => {
  const unique = (values: readonly string[]) => new Set(values).size === values.length;
  if (report.denominator.originalCount !== report.denominator.originalIds.length
      || !unique(report.denominator.originalIds)) {
    ctx.addIssue({ code: 'custom', path: ['denominator'], message: 'original denominator count and unique identities must agree' });
  }
  const originals = new Set(report.denominator.originalIds);
  for (const side of ['before', 'after'] as const) {
    const snapshot = report.coverage[side];
    const rows = [...snapshot.coveredIds, ...snapshot.missingIds];
    if (!unique(rows) || rows.length !== originals.size || rows.some(value => !originals.has(value))) {
      ctx.addIssue({ code: 'custom', path: ['coverage', side], message: 'coverage must partition the original denominator exactly' });
    }
  }
  const sourceIds = new Set(report.sources.map(row => row.id));
  if (sourceIds.size !== report.sources.length) {
    ctx.addIssue({ code: 'custom', path: ['sources'], message: 'source identities must be unique' });
  }
  for (const [index, item] of report.next.items.entries()) {
    for (const sourceId of item.sourceIds) if (!sourceIds.has(sourceId)) {
      ctx.addIssue({ code: 'custom', path: ['next', 'items', index, 'sourceIds'], message: `next item cites unknown source ${sourceId}` });
    }
    if (report.next.kind === 'cell-demand' && !item.demand) {
      ctx.addIssue({ code: 'custom', path: ['next', 'items', index], message: 'cell-demand item must retain its typed demand identity' });
    }
  }
});

export type GenerationFeedbackReport = z.infer<typeof generationFeedbackReport>;
export type GenerationFeedbackCategory = keyof GenerationFeedbackReport['endpointChanges'];

/** Parse either the report itself or the verified Pack report that contains it. */
export function readGenerationFeedback(value: unknown): GenerationFeedbackReport {
  const candidate = value && typeof value === 'object' && 'generation_feedback' in value
    ? (value as { generation_feedback: unknown }).generation_feedback : value;
  return generationFeedbackReport.parse(candidate);
}

/** Unknown categories remain absent; callers must never render them as zero. */
export function generationFeedbackCategoryCount(
  report: GenerationFeedbackReport, categoryName: GenerationFeedbackCategory,
): number | undefined {
  const row = report.endpointChanges[categoryName];
  return row.status === 'measured' ? row.ids.length : undefined;
}
