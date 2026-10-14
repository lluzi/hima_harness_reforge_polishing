// L1: the Results face's before/after table reads a Pack's `contract.results` over a Run's own
// observations. A DBOS Run records no `generations` rows at all (`view.generations` is empty); the
// table must still open by the rounds its observations themselves carry.
//
// `results-view.ts` only re-exports `RunView`/`PackResults` as *types* from `../remote.js`/`../packs.js`
// (never a runtime import), but those two host modules each run-time import `errors.ts`, `channel.ts`
// and others that carry constructor parameter properties — ordinary TypeScript, fine for the harness
// package's own build, but refused by `erasableSyntaxOnly` the moment `test/tsconfig.json` has to pull
// them into its own program to resolve a *static* type reference. A dynamic import (the same dodge
// `insight-analysis-card.test.ts` and `generation-feedback-view.test.ts` already use for a `.js`
// specifier that is really a type-stripped `.ts` file) keeps this test's fixtures untyped against
// those host modules instead, so only `results-view.ts`'s own exported functions are ever resolved.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const subject = await import(`../../packages/harness/src/client/results-view.${'ts'}`);
const { bestHeadline, resultsRounds, resultsTable } = subject as {
  resultsRounds(view: unknown): readonly number[];
  resultsTable(results: unknown, view: unknown, round?: number): { readonly round: number; readonly rounds: readonly number[]; readonly columns: readonly string[]; readonly headline?: { readonly display: string }; readonly rows: readonly { readonly type: string; readonly cells: readonly { readonly display: string; readonly better?: true }[] }[] };
  bestHeadline(results: unknown, view: unknown): { readonly value: number; readonly display: string } | undefined;
};

const reader = (id: string) => ({ id, version: '1', reportKind: 'result', emits: [] });

function observation(generation: number, readerId: string, type: string, value: number | null, recordId: string) {
  return {
    generation, recordId, at: '2026-10-14T00:00:00.000Z', path: `reports/${readerId}/r${String(generation)}/out.json`,
    contentSha256: 'a'.repeat(64), bytes: 10, reader: reader(readerId),
    values: [{ type, value, unit: 'MHz' }],
  };
}

const results = {
  columns: [{ label: 'Reference', reader: 'reference-reader' }, { label: 'Round', reader: 'round-reader' }],
  rows: [{ type: 'fmax', label: 'Fmax', unit: 'MHz', better: 'higher' }],
  headline: { type: 'gain_pct', label: 'Gain', unit: '%', digits: 2 },
};

test('a DBOS Run with no generations rows still opens by its observations\' own generation numbers', () => {
  const view = {
    generations: [],
    observations: [
      observation(1, 'reference-reader', 'fmax', 1951.6, 'obs:1'),
      observation(1, 'round-reader', 'fmax', 1980.98, 'obs:2'),
      observation(2, 'round-reader', 'fmax', 2001.4, 'obs:3'),
    ],
  };
  assert.deepEqual(resultsRounds(view), [1, 2], 'the fallback to observation generations finds both rounds');
  const table = resultsTable(results, view);
  assert.equal(table.round, 2, 'the latest round the last column has read');
  assert.deepEqual(table.rounds, [1, 2]);
  assert.deepEqual(table.rows[0]!.cells.map((cell) => cell.display), ['1951.6', '2001.4']);
  assert.equal(table.rows[0]!.cells[1]!.better, true, 'the round beats the reference under fmax/higher');
});

test('the table for a chosen round earlier than the latest still reads back correctly', () => {
  const view = {
    generations: [],
    observations: [
      observation(1, 'reference-reader', 'fmax', 1951.6, 'obs:1'),
      observation(1, 'round-reader', 'fmax', 1980.98, 'obs:2'),
      observation(2, 'round-reader', 'fmax', 2001.4, 'obs:3'),
    ],
  };
  const table = resultsTable(results, view, 1);
  assert.equal(table.round, 1);
  assert.deepEqual(table.rows[0]!.cells.map((cell) => cell.display), ['1951.6', '1980.98']);
});

test('before any round has been read by the last column, the table shows the reference with no headline', () => {
  const view = { generations: [], observations: [observation(1, 'reference-reader', 'fmax', 1951.6, 'obs:1')] };
  const table = resultsTable(results, view);
  assert.equal(table.headline, undefined);
  assert.deepEqual(table.rows[0]!.cells.map((cell) => cell.display), ['1951.6', '—']);
});

test('the best headline over every round read so far, under the headline row\'s own better', () => {
  const view = {
    generations: [],
    observations: [
      observation(1, 'round-reader', 'gain_pct', 1.1, 'obs:1'),
      observation(2, 'round-reader', 'gain_pct', 2.5, 'obs:2'),
      observation(3, 'round-reader', 'gain_pct', 1.8, 'obs:3'),
    ],
  };
  const headline = bestHeadline(results, view);
  assert.deepEqual(headline, { value: 2.5, display: '+2.50 %' });
  assert.equal(bestHeadline(results, { generations: [], observations: [] }), undefined, 'absent until a round has been read');
});
