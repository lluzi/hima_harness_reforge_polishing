// Ticket #62, final review: a placeholder is bound by a value the caller's map holds as its own
// property, and by nothing it merely inherits.
//
// At the module's seam on purpose. `substitute` is the one pure function every command line this
// harness launches passes through, and its fail-closed rule — a placeholder nothing bound throws,
// never resolves — is what the loader's own check rests on; the host's faces cannot reach the case,
// because a tool whose `inputs` name a value the node does not bind is refused before a Run exists.
// What was found: `values[name]` read through the prototype chain, so `${toString}` resolved to the
// text of `Object.prototype.toString` instead of throwing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolArgv, type PackTool } from '@hima/harness';

const tool = (argv: readonly string[]): PackTool => ({ id: 'probe', file: 'tools/probe.sh', description: '', inputs: ['toString', 'WORKSPACE'], licences: {}, argv: [...argv] });

test('a placeholder naming a property the values map only inherits is one nothing bound, and substitution throws saying so', () => {
  assert.throws(() => toolArgv(tool(['sh', '${toString}']), { WORKSPACE: '/w' }), /references \$\{toString\}, which nothing bound/);
  assert.throws(() => toolArgv(tool(['sh', '${constructor}']), { WORKSPACE: '/w' }), /references \$\{constructor\}, which nothing bound/);
});

test('a placeholder the values map binds as its own property resolves, whatever its name', () => {
  assert.deepEqual(toolArgv(tool(['sh', '${toString}', '${WORKSPACE}']), { toString: 'own', WORKSPACE: '/w' }), ['sh', 'own', '/w']);
});

test('dynamic tool operands stay literal, including make values and paths containing spaces', () => {
  for (const value of ['$(shell touch escape)', '$HOME', '`touch escape`', 'a\nb', 'a\rb', 'a\0b']) {
    assert.throws(() => toolArgv(tool(['make', 'DESIGN=${DESIGN}']), { DESIGN: value }), /literal|dynamic|expansion/);
  }
  assert.deepEqual(toolArgv(tool(['make', 'DESIGN=${DESIGN}', '${WORKSPACE}']), { DESIGN: 'chip rev A', WORKSPACE: '/work/has spaces' }), ['make', 'DESIGN=chip rev A', '/work/has spaces']);
});

test('Goal and Strategy values preserve decimal meaning and enforce the same declared precision', async () => {
  const { goalFrom, strategyFrom } = await import('@hima/harness');
  const parameter = { type: 'number' as const, unit: '%', min: 0, max: 100, default: 5, precision: 2 };
  for (const value of ['1.001', '2.00000000000000001', '1e-999', '', '0x10', Infinity, NaN, 101, -1]) {
    assert.ok('error' in goalFrom({ improvement_pct: parameter }, { improvement_pct: value }), String(value));
    assert.ok('error' in strategyFrom({ improve: parameter }, { improve: value }), String(value));
  }
  for (const value of ['0', '1e2', '2.30', 0.01, 100]) {
    assert.ok('goal' in goalFrom({ improvement_pct: parameter }, { improvement_pct: value }), String(value));
  }
  assert.deepEqual(goalFrom({ improvement_pct: parameter }, { improvement_pct: '2.30' }), { goal: { improvement_pct: 2.3 } });
  assert.ok('error' in goalFrom({ improvement_pct: parameter }, {}));
});


test('output paths remain inside the Campaign and preserve legitimate spaces', async () => {
  const { outputPath } = await import('@hima/harness');
  const output = { name: 'report', path: 'flow/results/${design}/report.txt', description: '' };
  assert.equal(outputPath(output, { design: 'chip rev A' }), 'flow/results/chip rev A/report.txt');
  assert.throws(() => outputPath(output, { design: '../../../escape' }), /relative|Campaign|path/);
  assert.throws(() => outputPath({ ...output, path: '/tmp/report' }, {}), /relative|Campaign|path/);
});
