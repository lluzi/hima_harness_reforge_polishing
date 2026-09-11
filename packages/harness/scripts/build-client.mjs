// Build the Hima browser bundle into the client-module envelope the web shell loads.
//
// The envelope is dsh's own: executing a bundle only REGISTERS a factory with
// `window.__ModuleLoader__.load({ id, factory })`, and the factory receives the shell's synchronous
// `require`, which answers the frozen baseline module table (React, Cordis, the static UI
// libraries) and the graph rows this package declares. React must therefore never be bundled: the
// shell owns exactly one copy. `packages/client/tsdown.client.ts` in the dsh repository is the
// in-tree equivalent of this file; an out-of-tree bundle reproduces its externals list here.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The browser module id: the package name, which is what the host's client-module graph keys by. */
const MODULE_ID = '@hima/harness';

/**
 * The shell's frozen module table, verified against the served web frontend's own seed. Every one
 * of these resolves through `require` at materialization; bundling any of them would ship a private
 * copy of a platform singleton.
 */
const BASELINE_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

const result = await build({
  absWorkingDir: packageDir,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: BASELINE_MODULES,
  legalComments: 'none',
  sourcemap: false,
  metafile: true,
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      `\tid: ${JSON.stringify(MODULE_ID)},`,
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: ['\t\treturn module.exports;', '\t}', '});', ''].join('\n') },
});

// A baseline module that reached the bundle would be a second React in the page: fail the build.
for (const input of Object.keys(result.metafile.outputs['lib/client.js'].inputs)) {
  if (input.includes('node_modules')) throw new Error(`client bundle pulled in ${input}; baseline modules must stay external`);
}
console.log(`client: lib/client.js (${String(result.metafile.outputs['lib/client.js'].bytes)} bytes)`);
