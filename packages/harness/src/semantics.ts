// The base timing vocabulary: the typed values a HimaGadget reader emits into an observation
// record's `values`. Deliberately small — only what the current readers (innovus-timing-summary,
// innovus-verify-drc, dc-qor-report) produce; HimaJudge (#6) rules on these, so names and units
// are load-bearing.
import { z } from 'zod';

/** Which analysis pass a timing value came from. */
export const analysisMode = z.enum(['setup', 'hold']);
export type AnalysisMode = z.infer<typeof analysisMode>;

/** Which path group a timing value covers. */
export const pathScope = z.enum(['all', 'reg2reg']);
export type PathScope = z.infer<typeof pathScope>;

/**
 * The kinds of typed value the base vocabulary knows about.
 *
 * `setup_wns`, `setup_tns`, `hold_wns` and `hold_tns` are *slacks*: negative when the requirement is
 * missed, and a rule reads them that way (`hold-wns-all-nonnegative` passes at `>= 0`). A tool that
 * prints a violation as a positive magnitude — Design Compiler's `Worst Hold Violation` is the one
 * such report a shipped reader reads — has that magnitude turned into the slack it stands for by the
 * reader, so that every value of one type here means the same thing whichever tool produced it.
 */
export const semanticValueType = z.enum([
  'setup_wns',
  'setup_tns',
  'hold_wns',
  'hold_tns',
  'clock_period',
  'placement_density',
  'drc_violation_count',
  'cell_area',
]);
export type SemanticValueType = z.infer<typeof semanticValueType>;

export const semanticUnit = z.enum(['ns', 'percent', 'count', 'um2']);
export type SemanticUnit = z.infer<typeof semanticUnit>;

/**
 * The one unit each value type is measured in. A value type and its unit are not two independent
 * facts a reader chooses between: setup slack is nanoseconds and nothing else, a DRC violation count
 * is a count and nothing else. Binding them here means a rule's threshold, a verdict's value, and a
 * reader's emission all speak of the same quantity, and that `unitFor` is the single place the
 * answer lives.
 */
export const unitFor: Readonly<Record<SemanticValueType, SemanticUnit>> = {
  setup_wns: 'ns',
  setup_tns: 'ns',
  hold_wns: 'ns',
  hold_tns: 'ns',
  clock_period: 'ns',
  placement_density: 'percent',
  drc_violation_count: 'count',
  cell_area: 'um2',
};

/**
 * One typed value an observation carries. `value` is `null` exactly when the reader could not find
 * it in the report; then `unknownReason` says why. A reader never substitutes zero or another
 * default for a value it could not find. `mode` and `scope` apply only to the timing WNS/TNS types.
 * The unit is not free: it must be the one `unitFor` binds to the type, so a DRC count declared in
 * ns fails validation instead of reaching the ledger and being compared against a slack threshold.
 *
 * `group` names the tool's own path group this value was read out of, when one group is its source.
 * A timing report states several, and which one a number came from is part of what the number means:
 * a setup slack from a synthesis tool's built-in group and a clock period from the design's clock
 * group are both true and are not about the same paths. A value folded over every group (a sum) or
 * stated outside them all (an area) names none. It is deliberately a free string, the tool's own
 * name for the group, because a reader reports what a report says rather than translating it.
 */
export const semanticValue = z
  .object({
    type: semanticValueType,
    value: z.number().nullable(),
    unit: semanticUnit,
    mode: analysisMode.optional(),
    scope: pathScope.optional(),
    group: z.string().optional(),
    unknownReason: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.value === null && !v.unknownReason) {
      ctx.addIssue({ code: 'custom', message: 'unknownReason is required when value is null', path: ['unknownReason'] });
    }
    if (v.unit !== unitFor[v.type]) {
      ctx.addIssue({ code: 'custom', message: `${v.type} is measured in ${unitFor[v.type]}, not ${v.unit}`, path: ['unit'] });
    }
  });
export type SemanticValue = z.infer<typeof semanticValue>;
