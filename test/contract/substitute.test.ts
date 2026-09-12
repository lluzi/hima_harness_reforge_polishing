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
