// Contract-test support: **what the readers this bundle ships actually read each value type in**,
// stated here once and independently of the harness's own files (#61).
//
// One table, and three suites hold different ends of it against each other, which is what makes any
// of them mean anything:
//
// - `observe-readers.test.ts` and `dc-reader.test.ts` read **real opene902 reports** through the
//   bundled readers and hold every value that comes back against this table — the unit it was read
//   in, and the qualifiers it carries;
// - `pack.test.ts` holds this table against `packages/harness/semantics.yml`, in both directions.
//
// So the file the bundle ships is held to what its readers really produce, without either suite
// asserting the harness against itself: a reader that started reading a slack in picoseconds, or a
// `semantics.yml` edited to say so, each break one of the two halves. Restating the table here is
// the whole point — a test that read the unit out of the same file it is checking would pass on any
// pair of wrong answers that agreed.
import assert from 'node:assert/strict';

/** What one value type is read in: its unit, and the qualifier words a value of it may carry.
 *  An absent `mode` or `scope` means a value of this type carries none at all. */
export interface ReadAs {
  readonly unit: string;
  readonly mode?: readonly string[];
  readonly scope?: readonly string[];
}

/**
 * Every value type the bundled readers emit, and what they emit it in.
 *
 * The four slacks carry both qualifiers because a slack is a statement about one analysis pass over
 * one path group, and a number that forgot which is a number nobody can compare. The other four are
 * facts about a whole design and are narrowed by neither.
 */
export const bundledReaderValues: Readonly<Record<string, ReadAs>> = {
  setup_wns: { unit: 'ns', mode: ['setup'], scope: ['all', 'reg2reg'] },
  setup_tns: { unit: 'ns', mode: ['setup'], scope: ['all', 'reg2reg'] },
  hold_wns: { unit: 'ns', mode: ['hold'], scope: ['all', 'reg2reg'] },
  hold_tns: { unit: 'ns', mode: ['hold'], scope: ['all', 'reg2reg'] },
  clock_period: { unit: 'ns' },
  placement_density: { unit: 'percent' },
  drc_violation_count: { unit: 'count' },
  cell_area: { unit: 'um2' },
};

/** One value as a reader produced it, as a suite reads it back off a record or a route. */
interface ValueAsRead {
  readonly type: string;
  readonly unit: string;
  readonly mode?: string;
  readonly scope?: string;
}

/**
 * Hold every value a real report produced against the table above: the unit it is measured in, and
 * the qualifiers carried exactly where the type has any and drawn from the words it allows.
 *
 * @param values - what a bundled reader emitted for one report.
 */
export function assertReadAsDeclared(values: readonly ValueAsRead[]): void {
  for (const v of values) {
    const read = bundledReaderValues[v.type];
    assert.ok(read, `"${v.type}" is a value type the bundled readers are known to emit`);
    assert.equal(v.unit, read.unit, `${v.type} must be read in ${read.unit}`);
    if (read.mode === undefined) assert.equal(v.mode, undefined, `${v.type} is narrowed by no analysis pass, so a value of it carries none`);
    else assert.ok(v.mode !== undefined && read.mode.includes(v.mode), `${v.type} carries one of ${read.mode.join(', ')}, not ${String(v.mode)}`);
    if (read.scope === undefined) assert.equal(v.scope, undefined, `${v.type} is narrowed by no path group, so a value of it carries none`);
    else assert.ok(v.scope !== undefined && read.scope.includes(v.scope), `${v.type} carries one of ${read.scope.join(', ')}, not ${String(v.scope)}`);
  }
}
