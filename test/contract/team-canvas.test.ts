// TeamCanvas drawing geometry: the pure functions that place stations in the two-column grid and
// turn measured boxes into edge paths. The functions carry no runtime imports once their types are
// stripped, so they are loaded from the built module; the types come from its declaration, which
// keeps `team-view.ts`'s whole type graph out of this project's `erasableSyntaxOnly` program.
import assert from 'node:assert/strict';
import test from 'node:test';

// A variable specifier keeps tsc from resolving the built `.js` (it has no sibling declaration); the
// annotation gives the real types from the declaration, and Node resolves the path at run time.
const builtTeamView = '../../packages/harness/lib/team-view.js';
const { teamEdgePath, teamGridArea, teamRowOrder }: typeof import('../../packages/harness/lib/types/team-view.js') =
  await import(builtTeamView);

type TeamBox = Parameters<typeof teamEdgePath>[1];
const box = (left: number, right: number, top: number, bottom: number): TeamBox => ({ left, right, top, bottom });

test('a station takes a grid column from its col/span: a lone station spans both, a pair one each', () => {
  const rows = [0, 1, 2];
  assert.deepEqual(teamGridArea({ row: 0, col: 0, span: 2 }, rows), { gridColumn: '1 / 3', gridRow: '1' });
  assert.deepEqual(teamGridArea({ row: 1, col: 0, span: 1 }, rows), { gridColumn: '1 / 2', gridRow: '2' });
  assert.deepEqual(teamGridArea({ row: 1, col: 1, span: 1 }, rows), { gridColumn: '2 / 3', gridRow: '2' });
  // A station without a row takes a column but no explicit grid row.
  assert.deepEqual(teamGridArea({ row: undefined, col: 0, span: 2 }, []), { gridColumn: '1 / 3' });
});

test('the row order dedupes and sorts the declared rows, ignoring stations without one', () => {
  assert.deepEqual(teamRowOrder([{ row: 2 }, { row: 0 }, { row: 1 }, { row: 1 }, { row: undefined }]), [0, 1, 2]);
});

test('a forward edge between boxes that overlap horizontally drops straight down the overlap', () => {
  const { d } = teamEdgePath({ back: false }, box(0, 100, 0, 40), box(20, 80, 80, 120), 400);
  assert.equal(d, 'M50 41V78');
  assert.ok(!d.includes('H'), 'a straight drop has no horizontal run');
});

test('a forward edge between boxes in different columns turns once — the fork/join elbow', () => {
  const { d } = teamEdgePath({ back: false }, box(0, 40, 0, 40), box(60, 100, 80, 120), 400);
  assert.match(d, /^M\d+ \d+V\d+H\d+V\d+$/, 'the elbow runs down, across, then down into the target');
  assert.equal(d, 'M20 41V60H80V78');
});

test('a back edge routes through the left gutter when the view is gridded, the right gutter otherwise', () => {
  const from = box(30, 70, 200, 240), to = box(30, 70, 0, 40);
  assert.ok(teamEdgePath({ back: true }, from, to, 400, 'left').d.includes('H14'), 'left gutter lane');
  assert.ok(teamEdgePath({ back: true }, from, to, 400, 'right').d.includes('H380'), 'right gutter at width − 20');
});
