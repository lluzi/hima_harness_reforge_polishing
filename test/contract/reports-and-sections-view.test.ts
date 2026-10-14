// L1: `groupReports` (`ReportsView.tsx`) and `sectionsFor` (`CampaignTab.tsx`) are pure logic inside
// components that also carry JSX, so Node's own type stripping cannot load the module directly (it
// strips types, not JSX syntax). esbuild — already a declared devDependency of `@hima/harness` for
// the browser bundle (`scripts/build-client.mjs`) — transforms and bundles each file into a plain ESM
// module in a temp file, external-izing react so no renderer is ever pulled in; nothing here renders
// a component, only the exported pure functions are called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
// Types come from the built `@hima/harness` package declarations, not the raw `packs.ts`/`remote.ts`
// sources: those two host modules run-time import `errors.ts`/`channel.ts`, which carry ordinary
// constructor parameter properties — fine for the harness package's own build, but refused the
// moment `test/tsconfig.json`'s `erasableSyntaxOnly` has to pull them into its own program.
import type { PackGraph, RunReportFile } from '@hima/harness';

// `esbuild` is a devDependency of `@hima/harness` (`scripts/build-client.mjs` already builds the
// browser bundle with it), not of the repo root; resolve it from there rather than assuming it is
// hoisted to the workspace root. Typed loosely (never `typeof import('esbuild')`): `esbuild`'s own
// type declarations are not reachable from `test/`'s own `node_modules` lookup, only from the
// harness package's — the same reason it is `require`d there instead of statically imported.
interface EsbuildLike { build(options: Record<string, unknown>): Promise<unknown> }
const harnessDir = path.resolve(import.meta.dirname, '../../packages/harness');
const { build } = createRequire(path.join(harnessDir, 'package.json'))('esbuild') as EsbuildLike;

/** Bundles a `.tsx` module (type-stripped but JSX-bearing, so Node's own loader cannot import it
 *  directly) into plain ESM and imports it, purely to call its exported pure functions — no
 *  component here is ever rendered. The bundle is written under `packages/harness` itself (never
 *  committed; cleaned up after the import) so the externalized `react`/`react-dom` bare imports
 *  resolve through that package's own `node_modules`, the way the real browser bundle does. The
 *  result is never statically typed against the `.tsx` source: that source has no `--jsx` config in
 *  `test/tsconfig.json`, so even a type-only reference to it would fail to resolve there. */
async function loadTsx(relativeToRepoRoot: string): Promise<Record<string, unknown>> {
  const entry = path.resolve(import.meta.dirname, '../..', relativeToRepoRoot);
  const outdir = mkdtempSync(path.join(harnessDir, '.test-tsx-'));
  const outfile = path.join(outdir, 'bundle.mjs');
  try {
    await build({
      entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node22',
      jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'], logLevel: 'silent',
    });
    return await import(outfile) as Record<string, unknown>;
  } finally { rmSync(outdir, { recursive: true, force: true }); }
}

const reportsViewModule = await loadTsx('packages/harness/src/client/ReportsView.tsx');
const groupReports = reportsViewModule.groupReports as (files: readonly RunReportFile[], graph: Pick<PackGraph, 'nodes' | 'view'> | undefined) =>
  readonly { readonly round: number; readonly stations: readonly { readonly key: string; readonly label?: string; readonly nodes: readonly { readonly node: string; readonly label: string }[] }[] }[];
const campaignTabModule = await loadTsx('packages/harness/src/client/CampaignTab.tsx');
const sectionsFor = campaignTabModule.sectionsFor as (contract: { readonly results?: unknown; readonly reports?: unknown } | undefined) => readonly string[];

const file = (node: string, round: number, name: string): RunReportFile =>
  ({ node, round, name, path: `reports/${node}/r${String(round)}/${name}`, bytes: 100 });

test('groupReports groups by round (newest first), then by station in view order, for a checklist station', () => {
  const graph: Pick<PackGraph, 'nodes' | 'view'> = {
    nodes: [{ id: 'reference-build', kind: 'act' }, { id: 'round-build', kind: 'act' }] as PackGraph['nodes'],
    view: {
      title: undefined, hidden: [], metrics: [], deriveEdges: true, edges: [],
      stations: [
        { id: 'rtl2gds', label: 'RTL2GDS flow', checklist: [{ label: 'Reference build', nodes: ['reference-build'] }, { label: 'Round build', nodes: ['round-build'] }] },
      ],
    } as unknown as PackGraph['view'],
  };
  const files = [file('round-build', 2, 'log.txt'), file('reference-build', 1, 'ref.txt'), file('round-build', 1, 'log.txt')];
  const groups = groupReports(files, graph);
  assert.deepEqual(groups.map((g) => g.round), [2, 1], 'newest round first');
  assert.equal(groups[1]!.stations.length, 1, 'both round-1 files share the one declared station');
  assert.deepEqual(groups[1]!.stations[0]!.nodes.map((n) => n.node), ['reference-build', 'round-build'], 'checklist declaration order, not file order');
});

test('groupReports also groups a team station\'s member nodes, by its team declaration order', () => {
  const graph: Pick<PackGraph, 'nodes' | 'view'> = {
    nodes: [{ id: 'review-wat', kind: 'act' }, { id: 'review-dc', kind: 'act' }] as PackGraph['nodes'],
    view: {
      title: undefined, hidden: [], metrics: [], deriveEdges: true, edges: [],
      stations: [{ id: 'reviews', label: 'Consumer review team', checklist: [], team: [{ node: 'review-wat', label: 'WAT test' }, { node: 'review-dc', label: 'DC review' }] }],
    } as unknown as PackGraph['view'],
  };
  const files = [file('review-dc', 1, 'notes.md'), file('review-wat', 1, 'notes.md')];
  const groups = groupReports(files, graph);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.stations[0]!.nodes.map((n) => n.node), ['review-wat', 'review-dc'], 'team declaration order');
  assert.equal(groups[0]!.stations[0]!.label, 'Consumer review team');
});

test('a node no station lists stands on its own, after the stations that place one', () => {
  const graph: Pick<PackGraph, 'nodes' | 'view'> = {
    nodes: [{ id: 'placed', kind: 'act' }, { id: 'orphan', kind: 'act' }] as PackGraph['nodes'],
    view: {
      title: undefined, hidden: [], metrics: [], deriveEdges: true, edges: [],
      stations: [{ id: 'a', label: 'A', checklist: [{ label: 'Placed', nodes: ['placed'] }] }],
    } as unknown as PackGraph['view'],
  };
  const groups = groupReports([file('orphan', 1, 'x.txt'), file('placed', 1, 'y.txt')], graph);
  assert.deepEqual(groups[0]!.stations.map((s) => s.key), ['a', 'node:orphan']);
});

test('sectionsFor: Generations drops out when the Pack declares a results table; Report becomes Reports when it declares a tool-report folder', () => {
  assert.deepEqual(sectionsFor(undefined), ['live', 'generations', 'evidence', 'report']);
  assert.deepEqual(sectionsFor({ results: { columns: [], rows: [] } }), ['live', 'evidence', 'report']);
  assert.deepEqual(sectionsFor({ reports: { dir: 'reports' } }), ['live', 'generations', 'evidence', 'reports']);
  assert.deepEqual(sectionsFor({ results: { columns: [], rows: [] }, reports: { dir: 'reports' } }), ['live', 'evidence', 'reports']);
});
