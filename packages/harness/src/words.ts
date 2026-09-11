// The words a count is said in, wherever this harness says one. One reason to change: how a number
// and its noun are spelled in the sentences a person reads.
//
// A leaf module with no imports of its own, for the reason `errors.ts` and `run-arguments.ts` are
// leaves: every layer says these sentences — a node record's reason, a command face's refusal, a
// blocker a person reads off `/hima status`, the meters on a Run's card — and a pluralizer that
// pulled a module's Node builtins behind it could not be used by all of them, `card-labels.ts`
// least of all, which the browser bundle reads. Stated once because it had already been stated three times, identically: in the
// fabric, in the plugin entry, and in the words the two Run cards share. Three copies of one
// sentence are three products the moment one of them learns a noun the others do not.

/**
 * A count with its noun made plural when it needs to be: `1 tool`, `2 rules`, `2 branches`.
 *
 * `-es` after a sibilant — `branch`, `wish`, `box`, `gas`, `buzz` — and `-s` otherwise, which covers
 * every noun this harness counts. English has irregular plurals and this knows none of them; a noun
 * that needs one is a noun to spell out at the call site rather than a rule to add here, because a
 * pluralizer that tried to be complete would be a dictionary with a bug in it.
 */
export const counted = (n: number, noun: string): string =>
  `${String(n)} ${noun}${n === 1 ? '' : /(?:s|x|z|ch|sh)$/.test(noun) ? 'es' : 's'}`;
